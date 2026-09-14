CREATE TABLE public.households (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_user_id uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.households TO authenticated;
GRANT ALL ON public.households TO service_role;
ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage their household" ON public.households FOR ALL TO authenticated
  USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.owns_household(_household_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.households h
    WHERE h.id = _household_id AND h.owner_user_id = auth.uid()
  )
$$;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  avatar text NOT NULL DEFAULT '🏈',
  color text NOT NULL DEFAULT 'bg-gold',
  is_commissioner boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage household profiles" ON public.profiles FOR ALL TO authenticated
  USING (public.owns_household(household_id)) WITH CHECK (public.owns_household(household_id));

CREATE TABLE public.weeks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  week_number integer NOT NULL,
  featured_game_id uuid,
  lock_at timestamptz,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','locked','final')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, season_year, week_number)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.weeks TO authenticated;
GRANT ALL ON public.weeks TO service_role;
ALTER TABLE public.weeks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage household weeks" ON public.weeks FOR ALL TO authenticated
  USING (public.owns_household(household_id)) WITH CHECK (public.owns_household(household_id));

CREATE TABLE public.games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  week_id uuid NOT NULL REFERENCES public.weeks(id) ON DELETE CASCADE,
  home_team text NOT NULL,
  away_team text NOT NULL,
  kickoff_at timestamptz,
  underdog_team text,
  upset_size numeric NOT NULL DEFAULT 0,
  home_score integer,
  away_score integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.games TO authenticated;
GRANT ALL ON public.games TO service_role;
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage household games" ON public.games FOR ALL TO authenticated
  USING (public.owns_household(household_id)) WITH CHECK (public.owns_household(household_id));

ALTER TABLE public.weeks
  ADD CONSTRAINT weeks_featured_game_fkey FOREIGN KEY (featured_game_id)
  REFERENCES public.games(id) ON DELETE SET NULL;

CREATE TYPE public.resolution_source AS ENUM ('auto_score','manual');

CREATE TABLE public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  week_id uuid NOT NULL REFERENCES public.weeks(id) ON DELETE CASCADE,
  game_id uuid REFERENCES public.games(id) ON DELETE CASCADE,
  description text NOT NULL,
  is_longshot boolean NOT NULL DEFAULT false,
  result text CHECK (result IN ('hit','miss')),
  resolved_at timestamptz,
  resolution_source public.resolution_source NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.events TO authenticated;
GRANT ALL ON public.events TO service_role;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage household events" ON public.events FOR ALL TO authenticated
  USING (public.owns_household(household_id)) WITH CHECK (public.owns_household(household_id));

CREATE TABLE public.cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  week_id uuid NOT NULL REFERENCES public.weeks(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (week_id, profile_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cards TO authenticated;
GRANT ALL ON public.cards TO service_role;
ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage household cards" ON public.cards FOR ALL TO authenticated
  USING (public.owns_household(household_id)) WITH CHECK (public.owns_household(household_id));

CREATE OR REPLACE FUNCTION public.owns_card(_card_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.cards c
    JOIN public.households h ON h.id = c.household_id
    WHERE c.id = _card_id AND h.owner_user_id = auth.uid()
  )
$$;

CREATE TABLE public.card_squares (
  card_id uuid NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  grid_position smallint NOT NULL CHECK (grid_position BETWEEN 0 AND 8),
  PRIMARY KEY (card_id, grid_position),
  UNIQUE (card_id, event_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.card_squares TO authenticated;
GRANT ALL ON public.card_squares TO service_role;
ALTER TABLE public.card_squares ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage card squares" ON public.card_squares FOR ALL TO authenticated
  USING (public.owns_card(card_id)) WITH CHECK (public.owns_card(card_id));

CREATE TABLE public.upset_picks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  game_id uuid NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  picked_team text NOT NULL,
  upset_size numeric NOT NULL DEFAULT 0,
  UNIQUE (card_id, game_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.upset_picks TO authenticated;
GRANT ALL ON public.upset_picks TO service_role;
ALTER TABLE public.upset_picks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage upset picks" ON public.upset_picks FOR ALL TO authenticated
  USING (public.owns_card(card_id)) WITH CHECK (public.owns_card(card_id));

CREATE TABLE public.weekly_scores (
  card_id uuid PRIMARY KEY REFERENCES public.cards(id) ON DELETE CASCADE,
  hits integer NOT NULL DEFAULT 0,
  lines integer NOT NULL DEFAULT 0,
  grid_score integer NOT NULL DEFAULT 0,
  upset_score numeric NOT NULL DEFAULT 0,
  rank integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.weekly_scores TO authenticated;
GRANT ALL ON public.weekly_scores TO service_role;
ALTER TABLE public.weekly_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage weekly scores" ON public.weekly_scores FOR ALL TO authenticated
  USING (public.owns_card(card_id)) WITH CHECK (public.owns_card(card_id));

CREATE INDEX idx_profiles_household ON public.profiles(household_id);
CREATE INDEX idx_weeks_household ON public.weeks(household_id);
CREATE INDEX idx_games_week ON public.games(week_id);
CREATE INDEX idx_events_week ON public.events(week_id);
CREATE INDEX idx_cards_week ON public.cards(week_id);