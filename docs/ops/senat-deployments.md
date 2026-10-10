# Senate Worker — deployment log

Worker `pirati-senat-zaloha` (production, custom domain `senat.dg12.cz`, **not deployed**) and `pirati-senat-zaloha-staging`
(`https://pirati-senat-zaloha-staging.vasek24.workers.dev`). Deployed from `cloudflare-senat/` (see its README).

| When (CEST) | Env | Version id | Previous | Commit | Notes |
|---|---|---|---|---|---|
| 2026-10-10 12:37 | staging | `0adf14fa-8ebd-4ef4-8b39-4e339dd111e8` | none (first deploy) | f466b22 | first staging deploy, frozen feed |
| 2026-10-10 12:49 | staging | `16a82977-ef35-4eeb-b659-81d642c62f78` | `0adf14fa` | 80fb2bd | Codex findings fixed (client round detection, outlook, numeric rejects, attribution log, x-server-now) |
| 2026-10-10 13:05 | staging | `a0598cbf-c358-4cad-b63b-6d5980fa1a09` | `16a82977` | f7208bd | back-link to volby.pirati.cz, mobile-first layout |
| 2026-10-10 13:00 | staging | `3a744ce0-9eae-4371-adb7-e976cbe000c3` | `a0598cbf` | see git log | back-link now points to volby.dg12.cz |
| 2026-10-10 13:34 | staging | `2a4390b4-5791-4da6-9927-894ccbe9c2ef` | `3a744ce0` | 6ab238f | re-skin to the Prague Pirate identity |
| 2026-10-10 13:49 | staging | `a44ffb54-f73f-44a8-83bc-94be618ee69d` | `2a4390b4` | 310d5c8 | pre-prod review fixes (2-decimal shares, floor progress, countdown, contrast, security headers) |
| 2026-10-10 13:53 | staging | `b7661191-e700-4d7e-a09e-3614777eae54` | `a44ffb54` | f1fd209 | nosniff on the Worker's own replies |


Production: nothing deployed. Production and the custom domain need the owner's explicit go-ahead.
