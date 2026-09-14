-- Move OAuth identities from a duplicate auth.users row onto the household owner.
-- Service-role only. Does not change public.households RLS or owner_user_id.

CREATE OR REPLACE FUNCTION public.ops_relink_auth_identities(
  from_user_id uuid,
  to_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, auth, public
AS $$
DECLARE
  moved_count integer := 0;
BEGIN
  IF from_user_id IS NULL OR to_user_id IS NULL OR from_user_id = to_user_id THEN
    RAISE EXCEPTION 'ops_relink_auth_identities: invalid user ids';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = from_user_id) THEN
    RAISE EXCEPTION 'ops_relink_auth_identities: source user missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = to_user_id) THEN
    RAISE EXCEPTION 'ops_relink_auth_identities: target user missing';
  END IF;

  -- Keep email/password sign-in on the owner when the extra row held the password.
  UPDATE auth.users AS dest
  SET encrypted_password = src.encrypted_password
  FROM auth.users AS src
  WHERE dest.id = to_user_id
    AND src.id = from_user_id
    AND coalesce(dest.encrypted_password, '') = ''
    AND coalesce(src.encrypted_password, '') <> '';

  -- Relink Google (and other OAuth) identities. Skip email/phone so the unique
  -- (provider, provider_id) constraint does not collide with the owner's row.
  UPDATE auth.identities AS extra
  SET user_id = to_user_id,
      updated_at = now()
  WHERE extra.user_id = from_user_id
    AND extra.provider NOT IN ('email', 'phone')
    AND NOT EXISTS (
      SELECT 1
      FROM auth.identities AS owner_ident
      WHERE owner_ident.user_id = to_user_id
        AND owner_ident.provider = extra.provider
        AND owner_ident.provider_id = extra.provider_id
    );

  GET DIAGNOSTICS moved_count = ROW_COUNT;

  DELETE FROM auth.identities
  WHERE user_id = from_user_id
    AND provider NOT IN ('email', 'phone');

  RETURN jsonb_build_object('moved', moved_count);
END;
$$;

REVOKE ALL ON FUNCTION public.ops_relink_auth_identities(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ops_relink_auth_identities(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_relink_auth_identities(uuid, uuid) TO service_role;
