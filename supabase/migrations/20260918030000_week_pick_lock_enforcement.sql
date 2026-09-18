BEGIN;

-- Kickoff lock: freeze card_squares / upset_picks when the week is locked/final
-- or now() >= lock_at. Authenticated REST cannot mutate picks after that.
-- Autopilot (and this function) sets status=locked; finalized weeks stay final.

CREATE OR REPLACE FUNCTION public.week_picks_are_locked(_week_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.weeks w
    WHERE w.id = _week_id
      AND (
        w.status IN ('locked', 'final')
        OR (w.lock_at IS NOT NULL AND now() >= w.lock_at)
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.card_picks_are_locked(_card_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT public.week_picks_are_locked(c.week_id)
      FROM public.cards c
      WHERE c.id = _card_id
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.week_picks_are_locked(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.card_picks_are_locked(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.week_picks_are_locked(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.card_picks_are_locked(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.deny_pick_writes_after_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cid uuid;
BEGIN
  -- Service-role maintenance (lock stamps, cascade cleanup) may still write.
  IF COALESCE(auth.role(), '') = 'service_role' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  cid := CASE WHEN TG_OP = 'DELETE' THEN OLD.card_id ELSE NEW.card_id END;
  IF public.card_picks_are_locked(cid) THEN
    RAISE EXCEPTION 'This card is locked — no more edits.'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deny_card_square_writes_after_lock ON public.card_squares;
CREATE TRIGGER deny_card_square_writes_after_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.card_squares
  FOR EACH ROW EXECUTE FUNCTION public.deny_pick_writes_after_lock();

DROP TRIGGER IF EXISTS deny_upset_pick_writes_after_lock ON public.upset_picks;
CREATE TRIGGER deny_upset_pick_writes_after_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.upset_picks
  FOR EACH ROW EXECUTE FUNCTION public.deny_pick_writes_after_lock();

-- RLS is ownership-only today. Keep owner reads; reject pick writes after lock.
DROP POLICY IF EXISTS "Owners manage card squares" ON public.card_squares;
DROP POLICY IF EXISTS "Owners read card squares" ON public.card_squares;
DROP POLICY IF EXISTS "Owners insert card squares" ON public.card_squares;
DROP POLICY IF EXISTS "Owners update card squares" ON public.card_squares;
DROP POLICY IF EXISTS "Owners delete card squares" ON public.card_squares;
CREATE POLICY "Owners read card squares" ON public.card_squares
  FOR SELECT TO authenticated
  USING (public.owns_card(card_id));
CREATE POLICY "Owners insert card squares" ON public.card_squares
  FOR INSERT TO authenticated
  WITH CHECK (public.owns_card(card_id) AND NOT public.card_picks_are_locked(card_id));
CREATE POLICY "Owners update card squares" ON public.card_squares
  FOR UPDATE TO authenticated
  USING (public.owns_card(card_id) AND NOT public.card_picks_are_locked(card_id))
  WITH CHECK (public.owns_card(card_id) AND NOT public.card_picks_are_locked(card_id));
CREATE POLICY "Owners delete card squares" ON public.card_squares
  FOR DELETE TO authenticated
  USING (public.owns_card(card_id) AND NOT public.card_picks_are_locked(card_id));

DROP POLICY IF EXISTS "Owners manage upset picks" ON public.upset_picks;
DROP POLICY IF EXISTS "Owners read upset picks" ON public.upset_picks;
DROP POLICY IF EXISTS "Owners insert upset picks" ON public.upset_picks;
DROP POLICY IF EXISTS "Owners update upset picks" ON public.upset_picks;
DROP POLICY IF EXISTS "Owners delete upset picks" ON public.upset_picks;
CREATE POLICY "Owners read upset picks" ON public.upset_picks
  FOR SELECT TO authenticated
  USING (public.owns_card(card_id));
CREATE POLICY "Owners insert upset picks" ON public.upset_picks
  FOR INSERT TO authenticated
  WITH CHECK (public.owns_card(card_id) AND NOT public.card_picks_are_locked(card_id));
CREATE POLICY "Owners update upset picks" ON public.upset_picks
  FOR UPDATE TO authenticated
  USING (public.owns_card(card_id) AND NOT public.card_picks_are_locked(card_id))
  WITH CHECK (public.owns_card(card_id) AND NOT public.card_picks_are_locked(card_id));
CREATE POLICY "Owners delete upset picks" ON public.upset_picks
  FOR DELETE TO authenticated
  USING (public.owns_card(card_id) AND NOT public.card_picks_are_locked(card_id));

-- Lock every due open week. Never touch status=final. Skip leftover open weeks
-- sitting behind a newer non-draft sibling so This Sunday ranking stays put.
CREATE OR REPLACE FUNCTION public.lock_open_weeks_past_lock_at()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer := 0;
  stamp timestamptz := now();
BEGIN
  UPDATE public.weeks w
  SET
    status = 'locked',
    auto_locked_at = COALESCE(w.auto_locked_at, stamp)
  WHERE w.status = 'open'
    AND w.lock_at IS NOT NULL
    AND stamp >= w.lock_at
    AND COALESCE(w.autopilot_hold, false) IS NOT TRUE
    AND NOT EXISTS (
      SELECT 1
      FROM public.weeks sibling
      WHERE sibling.household_id = w.household_id
        AND sibling.status <> 'draft'
        AND (
          sibling.season_year > w.season_year
          OR (
            sibling.season_year = w.season_year
            AND sibling.week_number > w.week_number
          )
        )
    );
  GET DIAGNOSTICS n = ROW_COUNT;

  UPDATE public.cards c
  SET locked_at = COALESCE(c.locked_at, stamp)
  FROM public.weeks w
  WHERE c.week_id = w.id
    AND w.status = 'locked'
    AND w.lock_at IS NOT NULL
    AND stamp >= w.lock_at
    AND c.locked_at IS NULL;

  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.lock_open_weeks_past_lock_at() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lock_open_weeks_past_lock_at() TO authenticated, service_role;

-- Optional minute job when pg_cron is available. Vercel autopilot still calls this.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(j.jobid)
    FROM cron.job j
    WHERE j.jobname = 'lock_open_weeks_past_lock_at';
    PERFORM cron.schedule(
      'lock_open_weeks_past_lock_at',
      '* * * * *',
      'SELECT public.lock_open_weeks_past_lock_at()'
    );
  END IF;
EXCEPTION
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN NULL;
END;
$cron$;

NOTIFY pgrst, 'reload schema';

COMMIT;
