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

Keep the `households.owner_user_id` that already owns the family. Do **not** invent a household. Do **not** rewrite household RLS.

`/ops` GET snapshot is read-only (`auth.users` + `households`). It does not relink, delete, or scramble duplicate `auth.users` rows.

Unconfirmed email + Google can still split. Confirm first (resend on `/auth` or `/ops`); automatic linking is the safety net once the address is verified.

## Live check (this iteration)

Inspected `auth.admin.listUsers` and `households` with the service role:

- Operator `jsnhrpr@gmail.com` is a **single** confirmed email user (`email_confirmed_at` set; not banned). Provider: email. No second `auth.users` row and no Google identity on that user.
- `households` is empty — there is no `owner_user_id` to collapse onto.

So there is no split to repair. Confirm-first plus automatic linking is the path if a Google identity is added later.
