-- Serialize profile changes within a household, including onboarding.
CREATE FUNCTION public.guard_profile_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE family uuid; replacement uuid;
BEGIN
  family := CASE WHEN TG_OP = 'DELETE' THEN OLD.household_id ELSE NEW.household_id END;
  PERFORM 1 FROM public.households WHERE id = family FOR UPDATE;
  -- Allow the existing household cascade delete.
  IF NOT FOUND AND TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND NEW.household_id <> OLD.household_id THEN
    RAISE EXCEPTION 'Players must stay in their household.';
  END IF;
  IF TG_OP = 'INSERT' AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE household_id = family) THEN
    NEW.is_commissioner := true;
  END IF;
  IF TG_OP = 'DELETE' THEN
    SELECT id INTO replacement FROM public.profiles
      WHERE household_id = family AND id <> OLD.id ORDER BY created_at, id LIMIT 1;
    IF replacement IS NULL THEN RAISE EXCEPTION 'Keep at least one player in your household.'; END IF;
    IF OLD.is_commissioner THEN
      UPDATE public.profiles SET is_commissioner = true WHERE id = replacement;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- Repair existing households deterministically, preferring their current commissioner.
WITH chosen AS (
  SELECT DISTINCT ON (household_id) household_id, id FROM public.profiles
  ORDER BY household_id, is_commissioner DESC, created_at, id
)
UPDATE public.profiles p SET is_commissioner = (p.id = chosen.id)
FROM chosen WHERE p.household_id = chosen.household_id;

CREATE TRIGGER guard_profile_change BEFORE INSERT OR UPDATE OR DELETE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_change();

CREATE FUNCTION public.check_household_commissioner() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE family uuid;
BEGIN
  family := CASE WHEN TG_OP = 'DELETE' THEN OLD.household_id ELSE NEW.household_id END;
  IF EXISTS (SELECT 1 FROM public.households WHERE id = family) AND
     (SELECT count(*) FROM public.profiles WHERE household_id = family AND is_commissioner) <> 1 THEN
    RAISE EXCEPTION 'Your household needs exactly one commissioner.';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER check_household_commissioner
AFTER INSERT OR UPDATE OR DELETE ON public.profiles DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.check_household_commissioner();

-- Invoker permissions retain the existing household-owner RLS boundary.
CREATE FUNCTION public.reassign_commissioner(player_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE family uuid;
BEGIN
  SELECT household_id INTO family FROM public.profiles WHERE id = player_id;
  IF family IS NULL THEN RAISE EXCEPTION 'Player not found.'; END IF;
  PERFORM 1 FROM public.households WHERE id = family FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = player_id AND household_id = family) THEN
    RAISE EXCEPTION 'Player not found.';
  END IF;
  UPDATE public.profiles SET is_commissioner = (id = player_id) WHERE household_id = family;
END;
$$;
REVOKE ALL ON FUNCTION public.reassign_commissioner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reassign_commissioner(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
