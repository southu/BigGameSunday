# Big Game Sunday — Autopilot cron secret

Date: 2026-09-14
Live host: https://biggamesunday.com
Hook: `POST /api/public/hooks/autopilot` (Vercel Cron also `GET`s the same path)

The scheduled hook runs service-role autopilot (open, lock, resolve scores, Tuesday finalize). It must not accept the browser publishable / anon key.

## Secret

The value never goes in git, never uses a `VITE_*` prefix, and is never imported from a client module.

| Piece | Where |
|---|---|
| Env var | `AUTOPILOT_CRON_SECRET` |
| Prefix | **Never** `VITE_*` (that would embed the secret in the browser bundle) |
| Host | Vercel project `biggamesunday` env: Production, Preview, and Development (type: sensitive) |
| Optional Vault | Same name in Supabase Vault if a later `pg_cron` / `pg_net` job POSTs the header |
| Reader | `src/lib/autopilot-hook.server.ts` via `process.env.AUTOPILOT_CRON_SECRET` |
| Route | `src/routes/api/public/hooks/autopilot.ts` dynamically imports the `.server.ts` handler |
| Header | `x-autopilot-cron-secret` / `autopilot-cron-secret`, or `Authorization: Bearer <secret>` |

Vercel Cron injects `Authorization: Bearer $CRON_SECRET` when `CRON_SECRET` is set. Set **`CRON_SECRET` to the same value as `AUTOPILOT_CRON_SECRET`** so the 10-minute job passes the gate. Do not treat `SUPABASE_ANON_KEY` / `SUPABASE_PUBLISHABLE_KEY` as a fallback.

Local `.env` may include `AUTOPILOT_CRON_SECRET` for `vite dev`; it is gitignored. See `.env.example` (name only).

## Schedule

`vercel.json` `crons`:

```
path: /api/public/hooks/autopilot
schedule: */10 * * * *
```

Production only. Each successful pass writes `autopilot_log` (actions, or a `checked` heartbeat when nothing moved).

## Commissioner "Run autopilot now"

Does **not** use this secret. `runAutopilotNow` in `src/lib/autopilot.functions.ts` requires the signed-in parent's JWT (`requireSupabaseAuth`) and a household row the caller owns. Keep that button; do not route it through the public hook.

## Set / rotate

```
vercel env add AUTOPILOT_CRON_SECRET production,preview,development --yes --sensitive
vercel env add CRON_SECRET production,preview,development --yes --sensitive
```

Use the same generated value for both. Redeploy after changing either. Never commit `.env` or the value.
