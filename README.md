# Big Game Sunday

Family NFL take-home: pick 9 moments, fill a 3x3 grid, and climb the Upset Ladder. No money, no jargon — just trophies.

## Scripts

- `bun run dev` — local app
- `bun run build` — production build
- `bun run test` — active-week selector proof (latest `open`/`locked`, else newest week overall)

Autopilot's public hook is gated by `AUTOPILOT_CRON_SECRET` (Vercel env / Vault — never `VITE_*`). See `ops/autopilot-cron.md`.
