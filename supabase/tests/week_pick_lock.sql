-- Exercise kickoff lock as an authenticated household owner.
-- All fixtures are rolled back; no auth users or real household data are changed.
BEGIN;
DO $$
BEGIN
  IF NOT has_function_privilege('authenticated', 'public.lock_open_weeks_past_lock_at()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Authenticated users cannot run the kickoff lock job';
  END IF;
  IF (SELECT count(*) FROM pg_trigger
      WHERE tgrelid IN ('public.card_squares'::regclass, 'public.upset_picks'::regclass)
        AND tgname IN ('deny_card_square_writes_after_lock', 'deny_upset_pick_writes_after_lock')
        AND tgenabled = 'O') <> 2 THEN
    RAISE EXCEPTION 'Pick lock triggers are missing or disabled';
  END IF;
END;
$$;

SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  family uuid;
  player uuid;
  open_week uuid;
  due_week uuid;
  leftover uuid;
  newer uuid;
  finished uuid;
  card_open uuid;
  card_due uuid;
  game_open uuid;
  game_due uuid;
  game_due_2 uuid;
  ev_open uuid;
  ev_due uuid;
  ev_due_2 uuid;
  rejected boolean;
  locked_n integer;
  due_status text;
  due_auto timestamptz;
  fin_status text;
  left_status text;
  future_status text;
BEGIN
  INSERT INTO public.households(name, owner_user_id)
    VALUES ('Lock verification', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
    RETURNING id INTO family;
  INSERT INTO public.profiles(household_id, display_name)
    VALUES (family, 'Pat') RETURNING id INTO player;

  INSERT INTO public.weeks(household_id, season_year, week_number, status, lock_at)
    VALUES (family, 2026, 8, 'open', timezone('utc', now()) + interval '2 hours')
    RETURNING id INTO open_week;
  INSERT INTO public.weeks(household_id, season_year, week_number, status, lock_at, finalized_at)
    VALUES (family, 2026, 9, 'open', timezone('utc', now()) + interval '2 hours', timezone('utc', now()) - interval '3 days')
    RETURNING id INTO due_week;
  INSERT INTO public.weeks(household_id, season_year, week_number, status, lock_at)
    VALUES (family, 2026, 1, 'open', timezone('utc', now()) - interval '1 hour')
    RETURNING id INTO leftover;
  INSERT INTO public.weeks(household_id, season_year, week_number, status, lock_at)
    VALUES (family, 2026, 2, 'locked', timezone('utc', now()) - interval '2 hours')
    RETURNING id INTO newer;
  INSERT INTO public.weeks(household_id, season_year, week_number, status, lock_at, finalized_at)
    VALUES (family, 2026, 7, 'final', timezone('utc', now()) - interval '1 hour', timezone('utc', now()) - interval '10 minutes')
    RETURNING id INTO finished;

  INSERT INTO public.games(household_id, week_id, home_team, away_team, underdog_team, upset_size)
    VALUES (family, open_week, 'Bills', 'Lions', 'Lions', 3)
    RETURNING id INTO game_open;
  INSERT INTO public.games(household_id, week_id, home_team, away_team, underdog_team, upset_size)
    VALUES (family, due_week, 'Bills', 'Lions', 'Lions', 3)
    RETURNING id INTO game_due;
  INSERT INTO public.games(household_id, week_id, home_team, away_team, underdog_team, upset_size)
    VALUES (family, due_week, 'Chiefs', 'Ravens', 'Ravens', 2)
    RETURNING id INTO game_due_2;

  INSERT INTO public.events(household_id, week_id, game_id, description)
    VALUES (family, open_week, game_open, 'First score') RETURNING id INTO ev_open;
  INSERT INTO public.events(household_id, week_id, game_id, description)
    VALUES (family, due_week, game_due, 'First score') RETURNING id INTO ev_due;
  INSERT INTO public.events(household_id, week_id, game_id, description)
    VALUES (family, due_week, game_due_2, 'Next score') RETURNING id INTO ev_due_2;

  INSERT INTO public.cards(household_id, week_id, profile_id)
    VALUES (family, open_week, player) RETURNING id INTO card_open;
  INSERT INTO public.cards(household_id, week_id, profile_id)
    VALUES (family, due_week, player) RETURNING id INTO card_due;
  INSERT INTO public.cards(household_id, week_id, profile_id)
    VALUES (family, leftover, player);
  INSERT INTO public.cards(household_id, week_id, profile_id)
    VALUES (family, finished, player);

  -- Pre-lock writes persist.
  INSERT INTO public.card_squares(card_id, event_id, grid_position)
    VALUES (card_open, ev_open, 0), (card_due, ev_due, 0);
  INSERT INTO public.upset_picks(card_id, game_id, picked_team, upset_size)
    VALUES (card_open, game_open, 'Lions', 3), (card_due, game_due, 'Lions', 3);
  IF (SELECT count(*) FROM public.card_squares WHERE card_id IN (card_open, card_due)) <> 2 THEN
    RAISE EXCEPTION 'Pre-lock squares did not persist';
  END IF;

  -- Clock passes lock_at while status is still open (dirty-open This Sunday).
  UPDATE public.weeks
    SET lock_at = timezone('utc', now()) - interval '1 hour'
    WHERE id = due_week;

  rejected := false;
  BEGIN
    INSERT INTO public.card_squares(card_id, event_id, grid_position)
      VALUES (card_due, ev_due_2, 1);
  EXCEPTION WHEN insufficient_privilege OR raise_exception THEN
    IF SQLERRM <> 'This card is locked — no more edits.' THEN RAISE; END IF;
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'INSERT square after lock_at was allowed'; END IF;

  rejected := false;
  BEGIN
    UPDATE public.card_squares SET grid_position = 2 WHERE card_id = card_due AND grid_position = 0;
    IF NOT FOUND THEN rejected := true; END IF;
  EXCEPTION WHEN insufficient_privilege OR raise_exception THEN
    IF SQLERRM <> 'This card is locked — no more edits.' THEN RAISE; END IF;
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'UPDATE square after lock_at was allowed'; END IF;

  rejected := false;
  BEGIN
    DELETE FROM public.card_squares WHERE card_id = card_due AND grid_position = 0;
    IF NOT FOUND THEN rejected := true; END IF;
  EXCEPTION WHEN insufficient_privilege OR raise_exception THEN
    IF SQLERRM <> 'This card is locked — no more edits.' THEN RAISE; END IF;
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'DELETE square after lock_at was allowed'; END IF;

  rejected := false;
  BEGIN
    DELETE FROM public.upset_picks WHERE card_id = card_due;
    IF NOT FOUND THEN rejected := true; END IF;
  EXCEPTION WHEN insufficient_privilege OR raise_exception THEN
    IF SQLERRM <> 'This card is locked — no more edits.' THEN RAISE; END IF;
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'DELETE upset pick after lock_at was allowed'; END IF;

  rejected := false;
  BEGIN
    INSERT INTO public.upset_picks(card_id, game_id, picked_team, upset_size)
      VALUES (card_due, game_due_2, 'Ravens', 2);
  EXCEPTION WHEN insufficient_privilege OR raise_exception THEN
    IF SQLERRM <> 'This card is locked — no more edits.' THEN RAISE; END IF;
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'INSERT upset pick after lock_at was allowed'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.card_squares WHERE card_id = card_due AND grid_position = 0)
     OR NOT EXISTS (SELECT 1 FROM public.upset_picks WHERE card_id = card_due) THEN
    RAISE EXCEPTION 'Locked picks were removed';
  END IF;

  -- Future lock_at week still accepts writes.
  UPDATE public.card_squares SET grid_position = 1 WHERE card_id = card_open AND grid_position = 0;
  IF NOT EXISTS (SELECT 1 FROM public.card_squares WHERE card_id = card_open AND grid_position = 1) THEN
    RAISE EXCEPTION 'Pre-lock update did not persist';
  END IF;

  SELECT public.lock_open_weeks_past_lock_at() INTO locked_n;
  IF locked_n < 1 THEN RAISE EXCEPTION 'Kickoff lock job locked no open weeks'; END IF;

  SELECT w.status, w.auto_locked_at INTO due_status, due_auto FROM public.weeks w WHERE w.id = due_week;
  IF due_status <> 'locked' OR due_auto IS NULL THEN
    RAISE EXCEPTION 'Due open week was not locked at kickoff';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cards WHERE id = card_due AND locked_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Due card was not stamped locked_at';
  END IF;

  SELECT w.status INTO fin_status FROM public.weeks w WHERE w.id = finished;
  IF fin_status <> 'final' THEN
    RAISE EXCEPTION 'Finalized week was unlocked or relabeled';
  END IF;

  SELECT w.status INTO left_status FROM public.weeks w WHERE w.id = leftover;
  IF left_status <> 'open' THEN
    RAISE EXCEPTION 'Leftover open week behind a newer week was locked';
  END IF;

  SELECT w.status INTO future_status FROM public.weeks w WHERE w.id = open_week;
  IF future_status <> 'open' THEN
    RAISE EXCEPTION 'Future lock_at week was locked early';
  END IF;
END;
$$;

RESET ROLE;
ROLLBACK;
