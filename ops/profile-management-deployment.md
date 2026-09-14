# Profile management database deployment

## Pending live application — 2026-09-14, iteration 5

Target: Supabase project `vzsltdvinnqingujsnft` for `biggamesunday.com`.

The existing migration
[`20260914223000_profile_management.sql`](../supabase/migrations/20260914223000_profile_management.sql)
must be executed on the live database. Committing it or deploying the frontend
does not install its functions or triggers.

Application was blocked this iteration: `vault-consumer status` returned
`error_code=vault_locked`, with `armed: false` and `vault_unlocked: false`.
No SQL was executed. The reported commissioner and deletion defects remain
unresolved until this migration is applied.

## Resume

1. Unlock and arm the credential broker for `biggamesunday` so the deployment
   process can lease its Supabase management credential.
2. Execute the entire existing migration, unchanged, on the target project.
   Its transaction installs the guards and RPC, repairs existing commissioner
   flags, grants RPC execution to `authenticated`, and reloads PostgREST's schema.
3. Record successful application here, then have the independent live tester
   verify reassignment, exactly one commissioner, last-player deletion rejection,
   commissioner promotion on deletion, first-player onboarding, and header updates.

Keep the frontend RPC signature `reassign_commissioner(player_id uuid)`.
Never record credentials in this document or in git.
