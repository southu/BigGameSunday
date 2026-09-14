# Big Game Sunday — `/ops` allowlist

Date: 2026-09-14
Live host: https://biggamesunday.com

`/ops` is an operator console (users + households, confirmation timestamps, resend). It is **not** in AppShell / Header public nav. Access is allowlisted server-side.

## Mechanism

Operator emails are **not** hard-coded in any client bundle.

| Piece | Where |
|---|---|
| Env var | `OPS_ALLOWLIST` |
| Format | Comma-separated emails, trimmed, compared case-insensitively |
| Prefix | **Never** `VITE_*` (that would embed the list in the browser bundle) |
| Reader | `src/lib/ops.server.ts` via `process.env.OPS_ALLOWLIST` (`opsAllowlist()` / `parseOpsAllowlist()`) |
| Route | `src/pages/ops.astro` (200 HTML shell: users + households tables) |
| API | `src/pages/api/ops/snapshot.ts` (GET), `src/pages/api/ops/resend.ts` (POST) |
| Client boundary | `src/lib/ops.functions.ts` only dynamically imports the `.server.ts` handlers. Route UI never sees the list. |
| Host | Vercel project env: Production, Preview, and Development |

Example (value lives in Vercel env, not in git):

```
OPS_ALLOWLIST=jsnhrpr@gmail.com
```

Multiple operators:

```
OPS_ALLOWLIST=jsnhrpr@gmail.com,other.operator@example.com
```

If `OPS_ALLOWLIST` is unset or empty, the allowlist is empty: every authed session gets not-found. There is no hard-coded fallback address.

Non-allowlisted sessions hitting `/ops` get a not-found from the server function (`throw new Error("Not found")`); the route turns that into the app 404. Unauthenticated visitors are redirected to `/auth?next=/ops`.

When `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_URL` is missing, GET snapshot returns empty tables plus `missingEnv` (the missing names). The `/ops` page shows that notice (`#missingEnv`) instead of listing `auth.users`. Non-allowlisted sessions still get not-found.

## What is not the allowlist

- Do not put operator emails in Astro pages, `src/` client scripts, or any `VITE_*` env.
- Do not add `/ops` to Header / AppShell `NAV`.
- Do not commit `.env` or Vercel secrets.
- Household card/week RLS is unchanged (`owner_user_id = auth.uid()` / `owns_household`). `/ops` uses the service role only to *list* users and households for allowlisted operators and to resend confirmation; GET snapshot does not mutate auth identities. It does not edit other families' cards.

## Set / rotate

```
vercel env add OPS_ALLOWLIST production,preview,development --value '<comma-separated emails>' --yes --sensitive
```

Redeploy after changing the value. Local `.env` may include `OPS_ALLOWLIST` for `astro dev` / `vite dev`; it is gitignored. See `.env.example`.

See also `ops/identity-merge.md` for email vs Google `auth.users` splits.
