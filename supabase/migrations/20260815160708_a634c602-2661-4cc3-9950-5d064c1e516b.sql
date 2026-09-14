REVOKE ALL ON FUNCTION public.owns_household(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owns_card(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owns_household(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owns_card(uuid) TO authenticated, service_role;