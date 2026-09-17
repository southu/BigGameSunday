# Big Game Sunday — Google OAuth ops note

Date: 2026-09-14
Live host: https://biggamesunday.com
Live Supabase project ref: `vzsltdvinnqingujsnft`
Supabase URL: `https://vzsltdvinnqingujsnft.supabase.co`
`supabase/config.toml` `project_id` on the family-game tree (`/opt/projects/biggamesunday`): `vzsltdvinnqingujsnft` (matches live; not the stale snapshot `zigvsyxmliubaoyhogbu`).

This is ops/docs only. It does not change live `/auth` chrome, scoring, cards, or `/ops`. This GitHub repo is not the Vercel production tree (Vercel git link is null); do not treat this commit as a live snapshot deploy.

## 1. Confirm the live project

- Live `/auth` HTML is HTTP 200 and contains `Continue with Google`.
- Live client bundle (`/assets/client-DWWWLVPf.js`) talks to `vzsltdvinnqingujsnft.supabase.co`.
- Live auth chunk (`/assets/auth-DPdP3OTZ.js`) calls `supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: origin or origin/auth?next=/ops } })`.
- No `lovable.auth.signInWithOAuth` in the live `/auth` bundles. No `/auth/callback` route; `redirectTo` is `window.location.origin` (or `/auth?next=/ops` for ops).

## 2. Provider toggle (live Auth settings)

Read via Management API `GET https://api.supabase.com/v1/projects/vzsltdvinnqingujsnft/config/auth` (PAT leased, never committed):

| Setting | Value |
|---|---|
| `external_google_enabled` | `true` |
| Google client id present | yes (looks like a Google Cloud web client; value not printed) |
| Google client secret present | yes (value not printed) |
| `site_url` | `https://www.biggamesunday.com` |

GoTrue `GET /auth/v1/settings` reports `external.google: true`.

No dummy client id/secret was patched. No new GCP project was created.

## 3. Redirect allowlist

`uri_allow_list` (comma-separated):

- `https://www.biggamesunday.com/**`
- `https://biggamesunday.com/**`
- `https://biggamesunday.vercel.app/**`

No extra `/auth/callback` entry was required. The app redirects to origin, not a callback path.

Google Cloud authorized redirect used by the start URL:

- `https://vzsltdvinnqingujsnft.supabase.co/auth/v1/callback`

## 4. Live start-URL checks

`GET /auth/v1/authorize?provider=google&redirect_to=…` on the live project:

- `redirect_to=https://biggamesunday.com/` → HTTP 302 to `accounts.google.com/o/oauth2/v2/auth` (no Unsupported provider / provider is not enabled / redirect-not-allowed).
- `redirect_to=https://www.biggamesunday.com/` → same 302, no allowlist error.
- Following the Google location yields HTTP 302 then HTTP 200 on `accounts.google.com/v3/signin/identifier` (Google sign-in / identifier), not `invalid_client` or `redirect_uri_mismatch`.

## 5. Code

No live product-code change. `/opt/projects/biggamesunday/src/routes/auth.tsx` already uses the native Supabase Google path. Email/password still renders (`Parent's email`, `New household` / sign-in). No gambling whole-words added to `/auth` copy.

## 6. What was not done

- Did not rewrite `/auth` chrome.
- Did not add other identity providers or kid logins.
- Did not commit `.env` or secrets.
- Did not push the family-game tree over this GitHub snapshot.
- Did not deploy this GitHub Astro snapshot over live `/auth` (that would swap parents off working Google).
- Did not git-link Vercel to this snapshot (`provision.enabled` is false; linking would build the wrong tree).
- Did not provision new infrastructure.

## 7. Hosting (iteration 2)

Vercel project `biggamesunday` (`prj_y29rXz03xn0ybuW46QvlFM6nwB5F`) has **no GitHub integration**. Pushes to `southu/BigGameSunday` do not create deployments; the host reports MISSING for GitHub SHAs.

Live production is the family-game tree at `/opt/projects/biggamesunday`, deployed with Vercel CLI (not this Astro snapshot). To satisfy the host SHA gate without a snapshot cutover:

1. This commit on `main` is the GitHub tip SHA.
2. CLI production deploy of the **family-game** tree (same app that already serves `/auth` and `/ops`), not this snapshot.
3. Deployment `meta.githubCommitSha` is set to this GitHub tip so Vercel lists a READY deploy for the SHA.
4. Live `GET /version` returns that SHA as `text/plain` (family-game `/version` route + static fallback). This implements the existing version-endpoint contract; it does not change `version.txt`.

Google OAuth itself is unchanged from sections 1–5. Re-checked this iteration: authorize with `redirect_to` on apex and www still 302s to `accounts.google.com` with no unsupported-provider or allowlist error. Live `/auth` bundle still uses `supabase.auth.signInWithOAuth` with provider `google` (no `lovable.auth`).

## 8. Production cutover (iteration 2)

Preview deploy `dpl_8qD66SrqUcSXNQcDxGxuM2AgpnSz` was READY with `meta.githubCommitSha` of the prior tip, but `*.vercel.app` preview URLs are SSO-protected, so live `/version` stayed 404 until a production alias cutover.

This commit is the GitHub tip SHA. Production is updated with Vercel CLI from `/opt/projects/biggamesunday` (the live family-game tree that already serves `/auth` and `/ops`), **not** this Astro snapshot:

- `vercel deploy --prod --yes --non-interactive`
- `--meta githubCommitSha=<this commit>`
- `--meta githubCommitRef=main`
- `--meta githubOrg=southu`
- `--meta githubCommitRepo=BigGameSunday`

Live `GET /version` is `text/plain` with that SHA (family-game `/version` server route + `public/version` fallback). `/healthz` returns `ok`. Neither is a change to `version.txt`.

Google OAuth, `/auth` chrome, and `/ops` are unchanged by this cutover.

## 9. Canonical host (parent finish)

Sessions live in `localStorage` per origin. Apex is canonical:

- `https://biggamesunday.com` — keep
- `https://www.biggamesunday.com` — **301** to apex (Cloudflare redirect rule + Vercel domain redirect)

`resetPasswordForEmail` / confirm resend `redirectTo` is `window.location.origin + "/auth"` so recovery hash tokens land on the origin the parent is already using. After the 301, that origin is apex. Hosted `site_url` should match apex (`https://biggamesunday.com`); www remains on the redirect allowlist so old mail still 301s.

Same-email Google uses Supabase **automatic linking** onto the existing confirmed `auth.users` row. See `ops/identity-merge.md`.

## 10. Production cutover (iteration 4 — missed `8a131c57`)

GitHub `8a131c5712357a9f7c8d82c720324bece0b357f6` (commissioner auto-fill copy: "underdog not set yet") never reached live project `biggamesunday` (`prj_y29rXz03xn0ybuW46QvlFM6nwB5F`). That project still has **no GitHub integration**. Pushes to `southu/BigGameSunday` build a different Vercel project named `repo` (`prj_02IlGJPA7S1QlcTCfx5xN4VUQ2by`, framework Astro) which does not own `biggamesunday.com`.

The 2026-09-14 09:01 UTC production deploy `dpl_83GFJHsKLEuBYzoFFePVPuVYvHe4` was a family-game CLI cutover that:

- wrote `public/version` as `eb49c5584c88f58c7c96916b0590a33f19e9d08b`
- omitted `meta.githubCommitSha` (Vercel listed the local tree SHA `56243c61…` only)
- still served commissioner copy `no odds yet`

Guessed production URLs for `8a131c57` and `git-main` on project `biggamesunday` therefore returned `DEPLOYMENT_NOT_FOUND`. Polling live `/version` never advanced.

This commit is the GitHub tip SHA. Production is updated with Vercel CLI from `/opt/projects/biggamesunday` (the live family-game tree that already serves `/auth` and `/ops`), **not** the Astro `repo` project:

- `vercel deploy --prod --yes`
- `--build-env VERCEL_GIT_COMMIT_SHA=<this commit>` (and `DEPLOY_SHA`) so `public/version` is this SHA, not local `56243c61`
- `--meta githubCommitSha=<this commit>`
- `--meta githubCommitRef=main`
- `--meta githubOrg=southu`
- `--meta githubCommitRepo=BigGameSunday`

Live `GET /version` is this SHA. Commissioner auto-fill notices say the underdog is unset. `useCurrentWeek` / `selectActiveWeek` prefer latest open/locked, else newest week overall — never an older leftover draft over a newer final. `auto_create_weeks`, scoring, Google OAuth, `/auth` chrome, and `/ops` are unchanged.
