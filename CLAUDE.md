# pirati-vysledky-2026 — election-night backup mirror

## Purpose
This repo (`vasek24/pirati-vysledky-2026`) is a fork of a live Czech election-results
tracker. It is being turned into a **backup mirror** that serves the same results from
Cloudflare if the original site struggles under election-night load.
The owner is **Václav Vislous**, who manages this fork and its modifications — he is
not the author of the original tracker. Never call him "the author".

**Read first:** the spec and plan in `docs/superpowers/` (`specs/` and `plans/`,
2026-10-10-election-night-backup-*). They define architecture, constants and tasks.

## Commands
- `npm test` — `TZ=UTC vitest run`
- `npm run lint` — eslint
- `npm run build` — vite build (all three must be green before any merge)

## Guards (hard rules)
- Never `git push` to `upstream` (its push URL is disabled), never open PRs or issues
  against `jsemfast/pirati-vysledky-2026`. Only `origin` (`vasek24/...`) is ours.
- Put `GH_TOKEN=$(gh auth token --user vasek24)` in front of **every** `gh` command and
  pass `--repo vasek24/pirati-vysledky-2026`. **Never run `gh auth switch`.**
- No secrets in git. Never set `GITHUB_TOKEN` on any Worker.
- Browser code must never request `volby.gov.cz` (CI greps `dist/assets` for
  `appdata/kv2026`).

## Deploy rules
- `wrangler deploy` only from `cloudflare/`, with `name` = `pirati-volby-zaloha`
  (`-drill` for drills) and `account_id` `741febb7a315a409b83e5a9a1b62954d`.
- **Staging first** (`--env staging`, worker `pirati-volby-zaloha-staging`); production
  only after staging checks pass. Record the previous version id
  (`wrangler deployments list`) before every deploy.
- The KV id `CREATE-IN-TASK-5` is intentionally invalid so an accidental deploy fails
  until Task 5 creates the namespaces.
- Drills with a fake `CSU_BASE` run only under `wrangler dev` or on the `-drill` Worker.

## Conventions
- Plain JS ESM, no TypeScript. UI copy in Czech.
- ČSÚ `generated` is zone-less Prague time: always use `parseCsuTime`
  (`src/volby/format.js`); tests run with `TZ=UTC`.
- Commits: imperative, one logical change each, end with the Co-Authored-By line.
- Maintainer contact: Václav Vislous, phone +420 777 954 389.
