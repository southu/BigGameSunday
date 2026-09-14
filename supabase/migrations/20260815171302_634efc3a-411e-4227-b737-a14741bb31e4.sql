ALTER TABLE public.weeks
  ADD COLUMN IF NOT EXISTS auto_created_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS auto_opened_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS auto_locked_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS autopilot_checked_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS finalized_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS commissioner_edited_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS autopilot_hold boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.autopilot_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  week_id uuid REFERENCES public.weeks(id) ON DELETE CASCADE,
  action text NOT NULL,
  detail text,
  status text NOT NULL DEFAULT 'ok',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, DELETE ON public.autopilot_log TO authenticated;
GRANT ALL ON public.autopilot_log TO service_role;

ALTER TABLE public.autopilot_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners read their autopilot log"
ON public.autopilot_log FOR SELECT TO authenticated
USING (public.owns_household(household_id));

CREATE POLICY "Owners clear their autopilot log"
ON public.autopilot_log FOR DELETE TO authenticated
USING (public.owns_household(household_id));

CREATE INDEX IF NOT EXISTS autopilot_log_household_created_idx
  ON public.autopilot_log (household_id, created_at DESC);