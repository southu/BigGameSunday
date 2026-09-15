# Profile management database deployment

## Pending live application — 2026-09-15, iteration 6

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

## 2026-09-15 follow-up

The deployment script was retried and still reported a locked or unarmed vault;
no live SQL was executed. The migration and expanded profile CRUD checks passed
on a temporary local PostgreSQL database with authenticated household RLS.
The frontend now switches players after refreshing profile data and selects the
database-appointed commissioner after deletion. Header chip labels include the
current commissioner role. Production build, 61 Node tests, and lint for the
changed components passed. Live application still requires the resume steps above.

## 2026-09-15 mission iteration 2 — still blocked

Retried `python3 scripts/deploy-profile-management.py` from the builder checkout.
The broker reports `armed: false`, `vault_unlocked: false`, and
`arm_pending_unlock: false`; the script stopped before requesting a lease or
executing SQL. The vault's documented Arm flow requires the master password,
which is not available in this session. The project environment contains no
Supabase management token or database connection credential.

An operator must use **Arm for N hours** in the vault UI, then rerun the existing
deployment script. The migration and frontend RPC remain unchanged. All 61 Node
tests and the production build passed again, but these checks do not establish
that the live database defects are fixed. Live SQL application remains pending.

## 2026-09-15 mission iteration 4 — operator action required

Retried `python3 scripts/deploy-profile-management.py`; it exited with status 1:
`Vault is locked or unarmed. Use Arm for N hours in the vault UI first.`
The script stopped before leasing a credential or sending any SQL. BUG-1 remains
unresolved; this documentation commit does not apply the migration.

Operator action: unlock the vault and select **Arm for N hours**, then run
`python3 scripts/deploy-profile-management.py` from the checkout containing the
existing migration on madcat. The script applies the SQL unchanged and runs the
database checks. The independent tester must then verify the live RPC and chips.
All 61 local Node tests passed on this attempt. No application or SQL changes
were needed or made.

## 2026-09-15 mission iteration 6 — live SQL still blocked

Retried `python3 scripts/deploy-profile-management.py` from `main` at
`5d3f22dd766787cd4dd3ccb312ec10a5395d3b88`. It exited with status 1:
`Vault is locked or unarmed. Use Arm for N hours in the vault UI first.`
The script stopped before requesting a lease or executing live SQL.

BUG-1 remains unresolved: the tester reports that live PostgREST cannot find
`public.reassign_commissioner(player_id uuid)` (PGRST202). AC4 and the
reassignment portion of AC6 still require migration application and live testing.
The existing migration and application code remain unchanged.

Requested operator action: unlock the vault and select **Arm for N hours** for
`biggamesunday`, then rerun `python3 scripts/deploy-profile-management.py`.
All 61 local Node tests and the production build passed. These checks and this
documentation commit do not establish a live fix.
