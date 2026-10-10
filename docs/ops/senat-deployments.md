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

| 2026-10-10 14:08 | **production** `pirati-senat-zaloha` | `b7911dad-2427-4171-bc6c-13a908578f30` | none (first deploy) | 201e3ec | custom domain `senat.dg12.cz` attached, cron `* * * * *`; owner go-ahead given in session |
| 2026-10-10 14:10 | front door `pirati-rozcestnik` (volby.dg12.cz) | `71f90bee-4c70-4fec-b0db-dc41f33bf2a4` | `0ef0861e-5e97-4af5-82e6-9ef7cfe428b1` | `senate/front-door` d13b2ec | Senát card activated (link to senat.dg12.cz); deployed from an export of that branch, not yet merged to main (PR) |
| 2026-10-10 14:17 | front door `pirati-rozcestnik` | `2848dd53-4442-4a53-b5f7-27934141285a` | `7aabef86-bcd6-4370-8e07-316595b8bee5` (other workstream's deploy from main at 14:09 had reverted the Senát card) | `senate/front-door-live` (on origin/main b0c6262) | Praha + Města + Senát cards live; PR open, not merged |
| 2026-10-10 14:31 | staging | `4aefd026-ebc4-4e12-9ac2-4598a5d530f0` | `b7661191-e700-4d7e-a09e-3614777eae54` | 952ec89 | remaining Codex fixes |
| 2026-10-10 14:31 | **production** `pirati-senat-zaloha` | `06ee5103-8c07-4d70-9642-e25a6e9d7247` | `b7911dad-2427-4171-bc6c-13a908578f30` | 952ec89 | remaining Codex fixes (round-2 votes w/o UCAST, missing pct, country range check, client countdown follows Worker closes) |
| 2026-10-10 14:47 | staging | `321e6685-54f5-4f82-ab3e-d52a1b0f2f7e` | `4aefd026-ebc4-4e12-9ac2-4598a5d530f0` | cd31caf | status `early` below 25 % counted |
| 2026-10-10 14:48 | **production** `pirati-senat-zaloha` | `0a350dc4-dbbc-4de0-8328-85ae1644fa53` | `06ee5103-8c07-4d70-9642-e25a6e9d7247` | cd31caf | emergency fix: no mandate/advance/lead claims below 25 % of precincts counted (obvod 48 at 1/242 showed 'mandát'); truth check fails on failed ČSÚ fetches |

Rollback production: `cd cloudflare-senat && npx wrangler rollback <previous id> --env=""` (none before the first deploy: to take the page down remove the custom domain / disable the Worker). Front door rollback: `wrangler rollback 0ef0861e-5e97-4af5-82e6-9ef7cfe428b1 -c wrangler.placeholder.jsonc` from `cloudflare/`.
