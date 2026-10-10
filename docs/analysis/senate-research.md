# Senate 2026 — research note (feeds, rules, Pirate-candidate tracking)

Date: 2026-10-10 (probed 11:30–11:45 CEST, before counting) · Branch `senate/results` · Scope: the Senate results page on `senat.dg12.cz`.
Legend: **[M]** measured today against the live ČSÚ servers · **[D]** read in an official document · **[I]** inferred / not yet observable (flagged where it matters).
All probes used our own User-Agent `pirati-senat-zaloha/0.1 (backup mirror; maintainer Vaclav Vislous +420777954389; manages this fork)`; a handful of requests in total.

## 1. Verdict in four lines
1. Use **one** upstream file: `appdata/senat/20261009/odata/vysledky.xml` (28.5 KB, all 27 constituencies, named attributes, both rounds, official elected/advancing flags). **[M]**
2. The same URL carries the runoff — nothing new to discover, ČSÚ appends round-2 attributes and a second `UCAST` element to the same file (observed on the 2024 election, still published). **[M for 2024, I for 2026]**
3. Party affiliation is **not** in the results files; it comes from the static candidate registry (`serk.json`). The registry matches the XML 154/154 on constituency+number+name. **[M]**
4. "Seats" = official results only. No projections (see §5).

## 2. Feeds (field by field)

Base `https://volby.gov.cz/appdata/senat/20261009/`. Every file: `ETag`, `Last-Modified`, `Expires = Last-Modified + 60 s`, `Cache-Control: no-cache`, `Access-Control-Allow-Origin: *`, a `Set-Cookie: cookiesession1` (load-balancer cookie, ignore). **Conditional GET works**: `If-None-Match` with the real ETag and `If-Modified-Since` both return `304`. No gzip offered on the XML (`Accept-Encoding: gzip` still 28 497 B). **[M]** Today every file is frozen at a 2026-10-08 16:40 pre-election snapshot (`generovano` zone-less Prague time) with 0 counted. **[M]**

| File | Size | Content | Use |
|---|---|---|---|
| `odata/vysledky.xml` | 28.5 KB (2024 final, both rounds: 44.3 KB) | root `VYSLEDKY@DATUM_CAS_GENEROVANI`; per `OBVOD@CISLO,NAZEV`: `KANDIDAT`×n, `UCAST`×1–2; then `CELKEM/UCAST`×1–2 | **primary feed** |
| `vysled/obvod/<n>.json` | 0.3 KB empty → ~1 KB counted | `prehled`, `vysledky`, `postupuje`, `zvoleny` (positional arrays, §2.2) | not used in v1 (cross-check only) |
| `vysled/cr.json` | 0.2 KB | `spocteno`, `ucast` (both `null` pre-count; 2024 final: 100 / 17.54 — the *round 2* turnout) | not used |
| `navig/obvody.json` | 5.2 KB | 27× `{obvod, nazevObvodu, odvolaniKandidati, zvoleno, zvoleno_kolo, existujePDF_K1/K2}` — `zvoleno`/`zvoleno_kolo` give the official "decided + in which round" per constituency (2024 final: `true`, `1` or `2`) | optional cross-check |
| `mapa_vitez.json` | 7.6 KB | per obvod leader: `kandCislo, kandJmeno, stranaZkratka, hlasu, procHlasu, procZprac, ukonceno, stavZvolen, kolo, pocetVitezu` | not used |
| `stav/K1/stavZpracovani.json` (and `K2/…`) | 1.3 KB | per obvod `[obvod, name, …, true/false]`; `K2/` is **404 until round 2 starts** **[M]** (it exists for 2024) | round-2 detection (optional) |
| `nastaveni.json` | 0.6 KB | app switches; `KOLO` (=1 now; =2 in the 2024 final), `ZVOL`, `POST`, `NEPOST`, `UZAV`… | round-2 detection (optional) |
| `odata/obvody/vysledky_obce_obvod_<n>.xml` | 20 KB (Kladno) | per municipality `UCAST` (candidate votes appear after counting, **[I]**) | not in v1 |
| `odata/okrsky/K1/vysledky_okrsky_NNNNN.xml` | batches, 5 min | precinct-level increments; `PORADI_ZPRAC` versioning | not in v1 |
| `aktual/odata/vysledky_celk.xml` | 27.5 KB | the **current** 81 senators with party codes, year elected, votes of their election | phase 2 (chamber composition) |
| `opendata/se2026/SE2026reg20261007_json.zip` → `serk.json` | 13.6 KB zip / 100 KB | candidate registry: `OBVOD, CKAND, VSTRANA, JMENO, PRIJMENI, TITULPRED, VEK, POVOLANI, BYDLISTEN, PSTRANA (membership), NSTRANA (nominating party), PLATNOST, NAZEV_VS, HLASY_K1/K2, ZVOLEN_K1/K2` | **static**; party names via `cpp.json`/`cns.json` code lists |

### 2.1 `vysledky.xml` details **[M]**
- `KANDIDAT`: `PORADOVE_CISLO` (drawn number on the ballot = registry `CKAND`), `JMENO`, `PRIJMENI`, `TITULPRED`, `TITULZA`, `HLASY_1KOLO`, `HLASY_PROC_1KOLO` (truncated to 2 decimals), optional `ZVOLEN_1KOLO` ∈ {`ZVOLEN`, `NEZVOLEN`, `2.KOLO`}, optional `HLASY_2KOLO`, `HLASY_PROC_2KOLO`, `ZVOLEN_2KOLO` ∈ {`ZVOLEN`, `NEZVOLEN`, `NEZVOLEN_SHODA_HLASU`}.
- `UCAST`: `KOLO, OKRSKY_CELKEM, OKRSKY_ZPRAC, OKRSKY_ZPRAC_PROC, ZAPSANI_VOLICI, VYDANE_OBALKY, UCAST_PROC, VOLICSKE_PRUKAZY, ODEVZDANE_OBALKY, PLATNE_HLASY, PLATNE_HLASY_PROC`. `CELKEM` repeats `UCAST` for the whole country.
- 27 `OBVOD`, 154 `KANDIDAT` today (2..9 per constituency, schema max 22).
- Official wording of the doc (SENAT_XML.htm v1.0, 14.09.2026, read decoded from windows-1250) **[D]**: `ZVOLEN_1KOLO` appears only **after the constituency is closed and the protocol officially signed** — "a time lag between the last precinct and publication must be expected". `HLASY_2KOLO`/`HLASY_PROC_2KOLO` appear only during round 2; `ZVOLEN_2KOLO` only after round 2 is closed. New in 2026: `NEZVOLEN_SHODA_HLASU` (tie in round 2 → nobody elected).
- Consequence: **between "100 % counted" and the official flag there is a gap of unknown length** (minutes–hours). The page must say "sečteno, čeká na potvrzení" for that state and never call someone elected from the numbers alone.

### 2.2 JSON per constituency (2024 sample, final data) **[M]**, columns **[I]** from comparison with the XML
```
prehled:  [kolo, okrskyCelkem, okrskyZprac, zpracProc, zapsaniVolici, vydaneObalky, ucastProc, volicskePrukazy, odevzdaneObalky, platneHlasy, platneProc]   (one row per round)
vysledky: [cislo, "Příjmení Jméno Titul", navrhujiciStrana, strana, prislusnost, hlasy1, proc1, hlasy2, proc2, bool, bool]   (the two booleans were false even for the winner: meaning unknown)
postupuje: [2,5]  (candidate numbers; length can exceed 2 on ties)     zvoleny: 5  (or -1/null)
```
The positional layout is verified against XML on obvod 5 (all numbers equal), but because the arrays are unnamed and the last two columns are unexplained, v1 uses the XML only.

### 2.3 Cadence **[D]/[M]**
XML "update time: 60 seconds (web cache)". `Expires = Last-Modified + 60 s`. Precinct batches every 5 min (`obce_d` municipality batches new in 2026, same cadence). Peak processing in 2024-style counting: 800–1 500 precincts per 5 min **[D]**. Expect a Senate count to be fast (4 700 precincts country-wide, 27 constituencies) and mostly done within hours.

### 2.4 How the runoff appears **[M for 2024; I for 2026]**
The 2024 folder `appdata/senat/20240920/` holds both rounds — i.e. **round 2 reuses the round-1 folder and URLs**. In the final 2024 XML (obvod 5 Chomutov): all 7 candidates keep `HLASY_1KOLO` + `ZVOLEN_1KOLO` (`NEZVOLEN` ×5, `2.KOLO` ×2); the two finalists additionally carry `HLASY_2KOLO`, `HLASY_PROC_2KOLO`, `ZVOLEN_2KOLO`; the `OBVOD` has two `UCAST` (KOLO 1, KOLO 2); `CELKEM` has two `UCAST`. A constituency decided in round 1 (obvod 17 Praha 12) has one `UCAST` and no round-2 attributes. `nastaveni.KOLO` becomes 2, `stav/K2/…` appears, `navig/obvody.json zvoleno_kolo` carries the round of decision. Not observable today: the exact moment/ordering of these changes in 2026 and the `NEZVOLEN_SHODA_HLASU` XML (inferred from the doc). **Design rule: derive the round from the data (presence of `UCAST KOLO=2` / `HLASY_2KOLO`), never from the date.** `datumvoleb.json` lists only 09.–10.10.2026 and will not get a runoff entry **[M]** (2024: no separate entry either).

## 3. Rules **[D]** (ČSÚ "Postup přidělování mandátů", 30 June 2026; Act 247/1995 §§ 75–76)
- 81 senators, 6-year term, a third elected every 2 years; 27 single-member constituencies now (26 elected in 2020 + Brno-město by-election 2025 — measured in the current-composition file).
- Round 1: elected if **more than half of the valid votes cast in the constituency**. Otherwise round 2 with the **two** best; ties for 1st → all tied first-placed advance (only them); tie for 2nd → the 1st + all tied second-placed; a finalist who withdraws / loses eligibility / dies and fewer than 2 remain → next best by round-1 votes (ties: all). **So "advancing" can be 1, 2 or ≥3 candidates; the model must not assume exactly two.**
- Round 2: most valid votes wins; **tie → nobody elected, repeat election** (feed: `NEZVOLEN_SHODA_HLASU`).
- Round 2 dates: **Fri 16 Oct 2026 14:00–22:00, Sat 17 Oct 8:00–14:00** (MV ČR "informace o způsobu hlasování", mzv.gov.cz pages; "statutory a week later" is true as Friday-to-Friday, formally the vote starts the 6th day after round 1 closes). If a finalist drops out, a runoff can slip to 23–24 Oct (mzv.gov.cz). **[D, secondary]** Czech summer time ends 25 Oct 03:00 → no DST issue for either date, but the generic zone code must handle it anyway.

## 4. What "current vs estimated seats" can responsibly mean
| Quantity | Source | Ship? |
|---|---|---|
| **Constituencies decided** (official `ZVOLEN`, either round) / 27 | XML flags | **yes — the headline** |
| **In runoff** (official `2.KOLO`) / awaiting official flag / still counting | XML flags + `OKRSKY_ZPRAC` | yes |
| **Pirate-backed: elected / in runoff / not advancing / counting** (of 18) | same + owner manifest | **yes** |
| Current rank & share while counting | counted votes (not an estimate: raw rank of what is counted) | yes, labelled "podle sečtených okrsků X %" |
| Chamber composition after decided seats ("kdo má kolik křesel") | `aktual/…/vysledky_celk.xml`: 54 retained seats (by party membership today: 23 no party, 9 ODS, 8 ANO, 5 KDU-ČSL, 2 Starostové pro Liberecký kraj, 1 each ProMOST, TOP 09, STAN, MY, Nestraníci, PŘÍSAHA, ČSSD) + newly decided | **phase 2**, counts only decided seats, nobody is a "Pirate senator" unless the registry says so (only Šípová, constituency 30, is flagged 720 among current senators) |
| **Projected / "estimated" seats, win probabilities, "likely to win"** | would be our own model | **no, not shipped** |
Reasons for "no": (a) §16 of Act 247/1995 bans publishing election-poll results from 3 days before the first voting day until polls close (NSS case law applies it also to social-media posts); for round 2 that is ~Tue 13 Oct → Sat 17 Oct 14:00 (my reading of the general rule; the paragraph number differs between sources — **check the consolidated text before anyone reasons about it**). A projection from round-1 numbers is at best a grey zone. (b) Round-1 rank is a weak predictor of round 2 (2024 Chomutov: the round-1 leader Komínek, 23.33 %, lost the runoff to the round-1 runner-up Rabas, 20.73 %, who won with 52.95 %). (c) The party's earlier assessment already ruled out national estimates. Republishing ČSÚ's *counted* numbers is not a poll and is allowed in the moratorium; the page must therefore show only counted results and never anything labelled forecast. A legal point to flag, not a blocker: **between ~13 Oct and 17 Oct the page must not gain any predictive element.**

## 5. Pirate-backed candidate tracking
- **Source of truth: the owner's list (18).** All 18 resolved against the registry by constituency + surname, **one unique match each**, constituency numbers match `navig/obvody.json` (all 18 are among the 27):
  `30 Kladno #2 Adéla Sucharda Šípová` (PS 99 bez př., **NS 720 Česká pirátská strana**) · `18 Příbram #5 Simona Luftová` (PS 720, NS 720) · `75 Karviná #2 Mariam Szyja` (PS 99, **NS 720**) — **the three "Pirate ticket" candidates are exactly the three with nominating party 720 in the registry** ✓.
  Endorsed (nominating party shown on the page, because it is ČSÚ's public fact and omitting it would mislead): 21 Praha 5 #2 Zdeněk Šarapatka (TOP 09) · 24 Praha 9 #2 David Smoljak (STAN) · 27 Praha 1 #7 Jiří Padevět (STAN) · 3 Cheb #1 Miroslav Plevný (STAN; sitting senator) · 6 Louny #4 Ivana Hluštíková (Zelení) · 33 Děčín #5 Miroslav Štross (Zelení) · 45 Hradec Králové #7 Martin Dvořák (STAN) · 48 Rychnov n. K. #2 Jan Grulich (TOP 09) · 51 Žďár n. S. #4 Radek Černý (ODS) · 54 Znojmo #2 Tomáš Třetina (TOP 09) · 57 Vyškov #2 Jan Grolich (KDU-ČSL) · 60 Brno-město #1 Zdeněk Papoušek (ODS nominee, bez př.) · 66 Litovel #1 Michael Kohajda (KDU-ČSL nominee) · 69 Frýdek-Místek #6 Helena Pešatová (STAN nominee) · 72 Ostrava-město #3 Ondřej Šimetka (ODS nominee).
- Note the registry spells the Kladno candidate "Sucharda Šípová" — **match by (constituency, ballot number), verify by surname containment, never by name string equality.**
- Manifest = `[{obvod, no, relation: 'ticket'|'endorsed'}]` generated from the registry + owner list, checked in; the Worker joins it to the XML by (obvod, no) **and refuses the attribution when the XML surname does not contain the manifest surname** (logs an error; page shows the candidate without the Pirate label rather than a wrong one).
- Not published by ČSÚ and not needed for v1: photos, social links, programme. Registry gives age, occupation, residence — shown small.

## 6. Open points / what I could not verify yet
- The exact 2026 XML during counting (we only have the frozen file; 2024 shows only the final state) — **to verify after ~15:00 today** (compare with the app and `vysledky.xml`).
- Lag between "100 % counted" and official flags; whether `ZVOLEN_1KOLO` appears for all constituencies at once.
- Whether ČSÚ throttles: no guidance published; one file per minute with conditional GET is negligible next to the two-minute polling of the public app (each viewer polls the same URLs).
- Poll-ban paragraph numbering (see §4) and whether a lawyer wants the "not a poll" statement on the page.
- `K2/…` and `nastaveni.KOLO` semantics for 2026 (only the 2024 end state seen).
