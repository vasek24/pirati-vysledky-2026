# Senate Worker — deployment log

Worker `pirati-senat-zaloha` (production, custom domain `senat.dg12.cz`, **not deployed**) and `pirati-senat-zaloha-staging`
(`https://pirati-senat-zaloha-staging.vasek24.workers.dev`). Deployed from `cloudflare-senat/` (see its README).

| When (CEST) | Env | Version id | Previous | Commit | Notes |
|---|---|---|---|---|---|
| 2026-10-10 12:37 | staging | `0adf14fa-8ebd-4ef4-8b39-4e339dd111e8` | none (first deploy) | f466b22 | first staging deploy, frozen feed |
| 2026-10-10 12:49 | staging | `16a82977-ef35-4eeb-b659-81d642c62f78` | `0adf14fa` | 80fb2bd | Codex findings fixed (client round detection, outlook, numeric rejects, attribution log, x-server-now) |
| 2026-10-10 13:05 | staging | `a0598cbf-c358-4cad-b63b-6d5980fa1a09` | `16a82977` | f7208bd | back-link to volby.pirati.cz, mobile-first layout |
| 2026-10-10 13:00 | staging | `3a744ce0-9eae-4371-adb7-e976cbe000c3` | `a0598cbf` | see git log | back-link now points to volby.dg12.cz |

Production: nothing deployed. Production and the custom domain need the owner's explicit go-ahead.
