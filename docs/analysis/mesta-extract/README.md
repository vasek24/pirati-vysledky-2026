# mesta registry extract

Deterministic extract of the ČSÚ open data that `scripts/mesta-registry.js` used. It lets a reviewer verify the generated files (`src/mesta/{towns,specifics,excluded}.generated.json`, `docs/analysis/mesta-specifics.md`, `docs/analysis/mesta-list-verification.md`) offline. Regenerate with `node scripts/mesta-registry.js`; do not edit by hand. (The older Haiku probe in `docs/analysis/mesta-registry-extract/` is a different, independent artefact and is not part of this extract.)

Fetched: 2026-10-10T10:52:37.735Z UTC (per-source times are the modification times of the cached downloads; a cache copied from another worktree shows the copy time, not the original download time).

## Sources

| Source | URL | sha256 | Fetched |
|---|---|---|---|
| ČSÚ registr kandidátů KV 2026 (kvrzcoco, kvros, kvrk) | https://volby.gov.cz/opendata/kv2026/KV2026reg20261007_csv.zip | `0b3ff9b0bfb9f30e7c88db75d9290a3d4f0a31da2a16c57dc87f552de1620ba5` | 2026-10-10T10:42:00.274Z |
| ČSÚ číselníky KV 2026 (cvs, cns, cnumnuts) | https://volby.gov.cz/opendata/kv2026/KV2026ciselniky20261007_csv.zip | `f221c13ad3f8e60418a92023360aebc21dff3042fc04be661d9b2010546404f1` | 2026-10-10T10:42:00.275Z |
| ČSÚ registr a výsledky KV 2022 (kvros) | https://volby.gov.cz/opendata/kv2022/KV2022reg20260328_csv.zip | `de398056124f234ff578fefc818a1d2f003a211c010953c77a7face2eb060ba9` | 2026-10-10T10:42:00.279Z |
| ČSÚ senátní obvody 2026 (obvody.json) | https://volby.gov.cz/appdata/senat/20261009/navig/obvody.json | `777b8c7eafea008ce422825aee1682bfa475c113a781fff3197015797ba255b8` | 2026-10-10T10:42:00.280Z |
| ČSÚ Počet obyvatel v obcích k 1. 1. 2025 (13007225_data.zip) | https://csu.gov.cz/docs/107508/31d73e49-141b-ecbc-3bcc-4089cac638c3/13007225_data.zip?version=1.1 | `2cef401562d24036bfd0473f60db4d8992104db1f6316728dc2522524184fafb` | 2026-10-10T10:52:37.735Z |

- Registry zip `csv_od/` files (UTF-8, comma): `kvrzcoco.csv`, `kvros.csv`, `kvrk.csv`. Code lists zip: `cvs.csv`, `cns.csv`, `cnumnuts.csv`.
- Population 2025: sheet 1 of `1300722503.xlsx`, columns B (kód obce = KODZASTUP) and D (počet obyvatel), rows from 7.
- jmsez cross-check: fetched for 78 published towns (none failed), one request per second, URL pattern `https://volby.gov.cz/appdata/kv2026/20261009/jmsez/<okres>/<zastup>.json`.

## Files and filters

| File | Content | Filter applied | Rows |
|---|---|---|---|
| `councils.csv` | `kvrzcoco`: one row per municipality council | `TYPZASTUP 1` (whole municipality), Prague (`DRUHZASTUP 4`) kept for the check, district councils (`TYPZASTUP 2`) dropped; `precincts` = Σ over the council's rows of Σ(MAX−MIN+1) of `MINOKRSEK1..9/MAXOKRSEK1..9, MINOKRSE10/MAXOKRSE10`; `POCOBYV` as in the registry | 6254 |
| `pop-csu-2025.csv` | ČSÚ 1 Jan 2025 population | municipalities (not Prague) whose council has `POCOBYV ≥ 7000` or whose 2025 population is ≥ 7000, or that are in scope below | 193 |
| `lists-720.csv` | `kvros`: candidate lists | all rows nationwide with 720 in `SLOZENI` (result columns dropped: registry has none) | 173 |
| `lists.csv` | `kvros`: all lists of the towns in scope | scope = published towns, all owner-list towns (confirmed and rejected), borderline-excluded towns and towns the owner mentioned (100 towns) | 862 |
| `candidates-720.csv` | `kvrk`: candidates | all rows nationwide with `PSTRANA` or `NSTRANA` = 720, any `PLATNOST` (join to lists on KODZASTUP, COBVODU, POR_STR_HL) | 2084 |
| `lists-2022-720.csv` | `kvros` of KV 2022 | `DATUMVOLEB = 20220923` and 720 in `SLOZENI` (basis of the `pirates-2022` reason) | 177 |
| `cvs.csv` | list code table | rows whose `VSTRANA` occurs in `lists-720.csv` or `lists.csv` | 268 |
| `cns.csv` | nominating-party table | rows whose `NSTRANA` is 720, 80 or occurs in a `SLOZENI` of `lists-720.csv`/`lists.csv` or as `NSTRANA` in `candidates-720.csv` | 134 |
| `regions-okresy.csv` | `cnumnuts` | 4-digit `NUMNUTS` only (regions 2100…8100, okresy 2101…) | 100 |
| `senate-2026.json` | Senate constituencies voting in 2026 (`obvody.json`) | `obvod` and `nazevObvodu` only | 27 |
| `jmsez-pirati.json` | jmsez rows labelled `Piráti` | published towns only; per town the rows with `prislusnost = Piráti` and the generator's `mismatch` verdict | 78 |

All CSV rows are sorted by KODZASTUP (then list number, position) so reruns are byte-identical for the same inputs.

## Reading hints

- `KODZASTUP` is the key everywhere (names repeat, e.g. two Mikulov and two Šlapanice).
- A Pirate is `PSTRANA = 720` (member); `NSTRANA = 720` with another `PSTRANA` is a nominated non-member (`nominatedNonMembers` in `specifics.generated.json`).
- `SLOZENI` is the list composition by nominating-party codes (720 = Piráti, 080 = NK, independents).
