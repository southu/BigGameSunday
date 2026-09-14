-- Run with psql -v ON_ERROR_STOP=1 after the schema and profile migration.
-- All fixtures roll back. No auth users are created.
BEGIN;
INSERT INTO public.households (id, name, owner_user_id)
VALUES ('11111111-1111-1111-1111-111111111111', 'Profile checks', '00000000-0000-0000-0000-000000000001');
INSERT INTO public.profiles (id, household_id, display_name)
VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'First');
SET CONSTRAINTS ALL IMMEDIATE;
DO $$ BEGIN
  ASSERT (SELECT is_commissioner FROM public.profiles WHERE id = '22222222-2222-2222-2222-222222222222'), 'First player must be commissioner';
  BEGIN
    DELETE FROM public.profiles WHERE id = '22222222-2222-2222-2222-222222222222';
    RAISE EXCEPTION 'Last-player deletion was allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Keep at least one player in your household.' THEN RAISE; END IF;
  END;
END $$;
SET CONSTRAINTS ALL DEFERRED;
INSERT INTO public.profiles (id, household_id, display_name)
VALUES ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'Second');
UPDATE public.profiles SET display_name = 'Renamed', avatar = '🦄', color = 'bg-sky'
WHERE id = '33333333-3333-3333-3333-333333333333';
SELECT public.reassign_commissioner('33333333-3333-3333-3333-333333333333');
SET CONSTRAINTS ALL IMMEDIATE;
DO $$ BEGIN
  ASSERT (SELECT count(*) = 1 FROM public.profiles WHERE household_id = '11111111-1111-1111-1111-111111111111' AND is_commissioner);
  ASSERT (SELECT is_commissioner AND display_name = 'Renamed' AND avatar = '🦄' AND color = 'bg-sky' FROM public.profiles WHERE id = '33333333-3333-3333-3333-333333333333');
END $$;
SET CONSTRAINTS ALL DEFERRED;
DO $$ BEGIN
  BEGIN
    UPDATE public.profiles SET is_commissioner = true WHERE id = '22222222-2222-2222-2222-222222222222';
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'Multiple commissioners were allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Your household needs exactly one commissioner.' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.profiles SET is_commissioner = false WHERE household_id = '11111111-1111-1111-1111-111111111111';
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'Zero commissioners were allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Your household needs exactly one commissioner.' THEN RAISE; END IF;
  END;
END $$;
DELETE FROM public.profiles WHERE id = '33333333-3333-3333-3333-333333333333';
SET CONSTRAINTS ALL IMMEDIATE;
DO $$ BEGIN
  ASSERT (SELECT is_commissioner FROM public.profiles WHERE id = '22222222-2222-2222-2222-222222222222'), 'Deleting commissioner must promote remaining player';
END $$;
-- Preserve the existing parent-owned household cascade.
DELETE FROM public.households WHERE id = '11111111-1111-1111-1111-111111111111';
ROLLBACK;
