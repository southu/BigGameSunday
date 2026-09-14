# Big Game Sunday — identity merge (email vs Google)

Date: 2026-09-14
Live Supabase project ref: `vzsltdvinnqingujsnft`
Canonical host: `https://biggamesunday.com` (www 301s here)

If a parent signs up with email/password and later uses Google (or the reverse), GoTrue can create **two** `auth.users` rows for the same email. Household RLS keys off `households.owner_user_id = auth.uid()`, so the non-owner row lands on empty onboarding instead of the family.

## Automatic linking (same verified email)

Supabase Auth **automatic linking** attaches a Google identity to the existing `auth.users` row when the email matches and is **verified**. That is the parent finish path: one household, not a second empty one.

| Requirement | Why |
|---|---|
| Confirmed parent email (`email_confirmed_at` set) | GoTrue will not auto-link onto an unverified address (pre-account-takeover). |
| Unique email | Linking needs a single target user. |
| Google provider enabled | Live `external_google_enabled` is true. See `ops/google-oauth.md`. |

Parents confirm from `/auth` (check inbox, or **Resend confirmation**). After the address is confirmed, **Continue with Google** with the same email links to that user instead of inserting another `auth.users` row.

Intended hosted config (also in `supabase/config.toml`):

- `site_url` = `https://biggamesunday.com`
- Email confirmations on
- Google enabled
- Automatic linking is GoTrue default for OAuth + verified email (manual `linkIdentity()` is not required for this path)

`enable_manual_linking` is only for signed-in `linkIdentity()` (different emails). Leave it off unless we add a settings-page connect flow. Do not add other OAuth providers.

## Rule (split already exists)

Collapse extras onto the `households.owner_user_id` that already owns the family. Do **not** invent a household. Do **not** rewrite household RLS.

Handler: `src/lib/ops.server.ts` `collapseDuplicateIdentitiesToHouseholdOwner`, run when an allowlisted operator loads `/ops` (`loadOpsSnapshotHandler`). Planner: `planIdentityCollapse`. Relink RPC: `public.ops_relink_auth_identities(from_user_id, to_user_id)` (migration `supabase/migrations/20260914060000_ops_relink_auth_identities.sql`). `GRANT EXECUTE` is **service_role only**.

When the same email has two (or more) `auth.users` and one of those ids is a `households.owner_user_id`, the handler:

1. Treats that owner row as canonical (does not change `owner_user_id`).
2. Relinks extra OAuth identities (`auth.identities.user_id`, typically Google) onto the owner via `ops_relink_auth_identities`. Email/phone identities are not moved (unique provider+provider_id). If the RPC is missing, it falls back to `schema('auth').from('identities').update`. Metadata-only stamps are not treated as success.
3. Copies extra providers onto the owner `app_metadata.providers`.
4. Confirms the owner email if an extra is already confirmed and the owner is not.
5. Deletes the extra `auth.users` row (`auth.admin.deleteUser`) so a later Google sign-in cannot resolve to the duplicate. If a foreign key blocks delete, the extra email is scrambled and the user is banned.

If there is no household, or no duplicate email, the handler is a no-op.

Unconfirmed email + Google can still split. Confirm first (resend on `/auth`); `/ops` collapse remains the safety net if a split is already in `auth.users`.

## Live check (this iteration)

Inspected `auth.admin.listUsers` and `households` with the service role:

- Operator `jsnhrpr@gmail.com` is a **single** confirmed email user (`email_confirmed_at` set; not banned). Provider: email. No second `auth.users` row and no Google identity on that user.
- `households` is empty — there is no `owner_user_id` to collapse onto.

So merge is a **no-op** until a split exists. The relink path still runs when a split appears: Google sign-in then hits the owner row, not the extra.
