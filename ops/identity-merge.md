# Big Game Sunday — identity merge (email vs Google)

Date: 2026-09-14
Live Supabase project ref: `vzsltdvinnqingujsnft`

If a parent signs up with email/password and later uses Google (or the reverse), GoTrue can create **two** `auth.users` rows for the same email. Household RLS keys off `households.owner_user_id = auth.uid()`, so the non-owner row lands on empty onboarding instead of the family.

## Rule

Collapse extras onto the `households.owner_user_id` that already owns the family. Do **not** invent a household. Do **not** rewrite household RLS.

Handler: `src/lib/ops.server.ts` `collapseDuplicateIdentitiesToHouseholdOwner`, run when an allowlisted operator loads `/ops` (`loadOpsSnapshotHandler`). Planner: `planIdentityCollapse`.

When the same email has two (or more) `auth.users` and one of those ids is a `households.owner_user_id`, the handler:

1. Treats that owner row as canonical (does not change `owner_user_id`).
2. Copies extra providers onto the owner `app_metadata.providers`.
3. Confirms the owner email if an extra is already confirmed and the owner is not.
4. Stamps each extra with `app_metadata.merged_into = <owner id>` via `auth.admin.updateUserById`.
5. Does **not** delete extra `auth.users` rows (that would drop an identity we cannot reattach without GoTrue SQL/PAT).

If there is no household, or no duplicate email, the handler is a no-op.

## Live check (this iteration)

Inspected `auth.admin.listUsers` and `households` with the service role:

- Operator `jsnhrpr@gmail.com` is a **single** confirmed email user (`email_confirmed_at` set; not banned). Provider: email. No second `auth.users` row and no Google identity on that user.
- `households` is empty — there is no `owner_user_id` to collapse onto.

So merge is a **no-op** until a split exists. Automatic Google linking for a later Google sign-in with the same confirmed email is left to live GoTrue settings (Google provider is already enabled; see `ops/google-oauth.md`).
