# Big Game Sunday — `/ops` allowlist

Date: 2026-09-14
Live host: https://biggamesunday.com
Live family-game tree: `/opt/projects/biggamesunday` (Vercel project `biggamesunday`, not this Astro snapshot)

`/ops` is an operator console (users + households, confirmation timestamps, resend). It is **not** in AppShell public nav. Access is allowlisted server-side.

## Mechanism

Operator emails are **not** hard-coded in any client bundle.

| Piece | Where |
|---|---|
| Env var | `OPS_ALLOWLIST` |
| Format | Comma-separated emails, trimmed, compared case-insensitively |
| Prefix | **Never** `VITE_*` (that would embed the list in the browser bundle) |
| Reader | Family-game `src/lib/ops.server.ts` via `process.env.OPS_ALLOWLIST` |
| Client | `src/lib/ops.functions.ts` only dynamically imports the `.server.ts` handlers. Route UI never sees the list. |
| Host | Vercel project env: Production, Preview, and Development |

Example (value lives in Vercel env, not in git):

```
OPS_ALLOWLIST=jsnhrpr@gmail.com
```

Multiple operators:

```
OPS_ALLOWLIST=jsnhrpr@gmail.com,other.operator@example.com
```

If `OPS_ALLOWLIST` is unset or empty on a deploy, the **server-only** module falls back to the live operator email so `/ops` cannot 404 the operator. That fallback is in `ops.server.ts`, not in a client module.

Non-allowlisted sessions hitting `/ops` get a not-found from the server function (`throw new Error("Not found")`); the route turns that into the app 404. Unauthenticated visitors are redirected to `/auth?next=/ops`.

## What is not the allowlist

- This GitHub Astro snapshot does not serve live `/ops`. Do not put operator emails in Astro pages, `src/` client scripts, or any `VITE_*` env.
- Do not add `/ops` to AppShell `NAV`.
- Do not commit `.env` or Vercel secrets.
- Household card/week RLS is unchanged (`owner_user_id = auth.uid()` / `owns_household`). `/ops` uses the service role only to *list* users and households for allowlisted operators; it does not edit other families' cards.

## Set / rotate

From the family-game tree (already linked to Vercel project `prj_y29rXz03xn0ybuW46QvlFM6nwB5F`):

```
vercel env add OPS_ALLOWLIST production,preview,development --value '<comma-separated emails>' --yes --sensitive
```

Redeploy the family-game tree after changing the value. Local `.env` may include `OPS_ALLOWLIST` for `vite dev`; it is gitignored.

See also `ops/identity-merge.md` for email vs Google `auth.users` splits.
