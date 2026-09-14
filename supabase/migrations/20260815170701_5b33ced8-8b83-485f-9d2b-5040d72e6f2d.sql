ALTER TABLE public.households
  ADD COLUMN IF NOT EXISTS auto_create_weeks boolean NOT NULL DEFAULT true;

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS espn_event_id text;

ALTER TABLE public.weeks
  ADD COLUMN IF NOT EXISTS auto_created_at timestamp with time zone;

CREATE UNIQUE INDEX IF NOT EXISTS games_week_espn_event_idx
  ON public.games (week_id, espn_event_id)
  WHERE espn_event_id IS NOT NULL;