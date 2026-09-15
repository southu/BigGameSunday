-- Exercise the installed migration as an authenticated household owner.
-- All fixtures are rolled back; no auth users or real household data are changed.
BEGIN;
DO $$
BEGIN
  IF NOT has_function_privilege('authenticated', 'public.reassign_commissioner(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Authenticated users cannot reassign commissioner';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass
      AND tgname IN ('guard_profile_change', 'check_household_commissioner')
      AND tgenabled = 'O') <> 2 THEN
    RAISE EXCEPTION 'Profile guards are missing or disabled';
  END IF;
  IF EXISTS (SELECT household_id FROM public.profiles GROUP BY household_id
      HAVING count(*) FILTER (WHERE is_commissioner) <> 1) THEN
    RAISE EXCEPTION 'Existing household commissioner flags were not repaired';
  END IF;
END;
$$;

SELECT set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE family uuid; parent uuid; kid uuid; sibling uuid; rejected boolean;
BEGIN
  INSERT INTO public.households(name) VALUES ('Profile migration verification') RETURNING id INTO family;
  INSERT INTO public.profiles(household_id, display_name, is_commissioner)
    VALUES (family, 'Parent', false) RETURNING id INTO parent;
  IF NOT (SELECT is_commissioner FROM public.profiles WHERE id = parent) THEN
    RAISE EXCEPTION 'First player did not become commissioner';
  END IF;
  INSERT INTO public.profiles(household_id, display_name, is_commissioner)
    VALUES (family, 'KidReassign', true) RETURNING id INTO kid;
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;

  UPDATE public.profiles SET display_name = 'Team Captain', avatar = '🧢', color = 'bg-sky'
    WHERE id = kid;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = kid
      AND display_name = 'Team Captain' AND avatar = '🧢' AND color = 'bg-sky'
      AND NOT is_commissioner) THEN
    RAISE EXCEPTION 'Player edit did not persist or changed commissioner';
  END IF;
  INSERT INTO public.profiles(household_id, display_name)
    VALUES (family, 'Sibling') RETURNING id INTO sibling;
  DELETE FROM public.profiles WHERE id = sibling;
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = sibling) OR
      NOT (SELECT is_commissioner FROM public.profiles WHERE id = parent) THEN
    RAISE EXCEPTION 'Deleting a regular player changed commissioner';
  END IF;

  PERFORM public.reassign_commissioner(player_id => kid);
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  IF NOT (SELECT is_commissioner FROM public.profiles WHERE id = kid) OR
      (SELECT count(*) FROM public.profiles WHERE household_id = family AND is_commissioner) <> 1 THEN
    RAISE EXCEPTION 'Commissioner reassignment failed';
  END IF;

  rejected := false;
  BEGIN
    UPDATE public.profiles SET is_commissioner = true WHERE id = parent;
    SET CONSTRAINTS ALL IMMEDIATE;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Your household needs exactly one commissioner.' THEN RAISE; END IF;
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Second commissioner was allowed'; END IF;
  SET CONSTRAINTS ALL DEFERRED;

  DELETE FROM public.profiles WHERE id = kid;
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  IF NOT (SELECT is_commissioner FROM public.profiles WHERE id = parent) THEN
    RAISE EXCEPTION 'Deleting commissioner did not promote remaining player';
  END IF;
  rejected := false;
  BEGIN
    DELETE FROM public.profiles WHERE id = parent;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Keep at least one player in your household.' THEN RAISE; END IF;
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Last player deletion was allowed'; END IF;

  PERFORM set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  rejected := false;
  BEGIN
    PERFORM public.reassign_commissioner(player_id => parent);
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Player not found.' THEN RAISE; END IF;
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Another household could reassign commissioner'; END IF;
END;
$$;
ROLLBACK;
