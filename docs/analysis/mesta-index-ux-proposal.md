# mesta index — UX proposal (independent review, 2026-10-10)

Prototype: `docs/analysis/mesta-index-prototype/index.html` (one static file, real 79 towns from `qualifying-nationwide.tsv`, made-up numbers, `?dev=1` dev panel). Inputs: `mesta-index-ux-research.md`, spec `2026-10-10-mesta-design.md` (§3.3–3.5, §4.2, §5), Prague `Landing.jsx`/`ElectionHeader.jsx`, `placeholder/index.html`.

## (a) How the index fails visitors (79 towns, 13 kraje, 16 + 2 shards)
Personas: **A** "my own town" (the majority, phone, one town, maybe twice per evening), **B** journalist / party member scanning big cities, **C** party official wanting the overall picture without misleading sums.
1. **The town cannot be found the way people type it (A).** "Plzen", "Frýdek Místek", "v Plzni", "Budějky", "Brandýs", or the okres ("Praha-východ"). A prefix-only matcher returns nothing and the visitor decides the site is broken. Worse: **towns we do not cover** (Havířov, Sokolov, Litovel) and **Praha** return a silent empty list.
2. **A wall of sameness (A, B).** 79 rows or 13 accordions with no anchor; "how the Pirates run here" and the counting state are hidden behind second taps (chevrons). Returning visitors must search again each time (no memory).
3. **Partial numbers read as results (B).** 12 % at 4 % counted next to a finished town, times differ per town, a "sort by Pirate result" turns partial counts into a league table and re-orders rows on every refresh (lost place, mis-taps, screenshots out of context).
4. **No honest overview (C).** Sums over different councils are meaningless and forbidden; without them C has nothing, and a failed shard looks like "no data / zero" → panic calls.
5. **The page itself fights the visitor (all).** Rows jump when data arrives (CLS), polling 18 feeds drains phone data and edge capacity, hidden tabs keep polling, skeletons that never resolve when a shard fails.

## (b) Information architecture and first screen (375 px)
Order: compact black header → **sticky search** (64 px) → **Moje obec** (only when set) → **Největší města** (12, live) → **Všechna města** chips → **13 kraje** (collapsed on < 1024 px) → footer (sources, "no sums", Praha link). Every row is the same `TownRow` (72 px, one tap target). Desktop ≥ 1024: left sticky column (search, Moje obec, kraj jump list), right column featured + all kraje expanded, rows in 2 columns (from 700 px).
```
1 FIRST SCREEN                       2 SEARCH OPEN ("v plzni")
┌─────────────────────────────────┐  ┌─────────────────────────────────┐
│ [logo]                  ● ŽIVĚ  │  │ ┌─────────────────────────────┐ │ ← sticky bar
│ PIRÁTI VE MĚSTECH 2026          │  │ │🔍 v plzni                 × │ │
│ Každé město má vlastní čas dat… │  │ └─────────────────────────────┘ │
│ ┌─────────────────────────────┐ │  │ ┌─────────────────────────────┐ │
│ │🔍 Najít město nebo okres    │ │  │ │▌Plzeň                 12,4 %│ │ ← active (Enter)
│ └─────────────────────────────┘ │  │ │ okres Plzeň-město · Plzeň…  │ │
│ NEJVĚTŠÍ MĚSTA 12               │  │ │                   ČSÚ 18:42 │ │
│ BRNO                     12,0 % │  │ └─────────────────────────────┘ │
│ [KOALICE] Piráti a Fakt… průběžně│ │ "plzen" adds ▸ Plzeňský kraj    │
│ ▬▬▬──── sečteno 12 %  ČSÚ 15:11 │  │ none: „xyz" jsme nenašli. Přehled│
│ OSTRAVA …  (8 rows above fold)  │  │ má 79 měst … Ostatní: výsledky ČSÚ│
└─────────────────────────────────┘  └─────────────────────────────────┘
3 REGION EXPANDED (sticky header)    4 MOJE OBEC SET
┌─────────────────────────────────┐  ┌─────────────────────────────────┐
│ [search bar]                    │  │ [search bar]                    │
│█ OLOMOUCKÝ KRAJ               ˄█│  │ MOJE OBEC                       │
│█ Sečteno 1 z 4 měst            █│  │┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓│
│ OLOMOUC                   8,7 % │  │┃BRANDÝS NAD LABEM-STARÁ…  12,1 %┃│
│ [KOALICE] MILUJEME…  průběžně   │  │┃[SDRUŽENÍ] Piráti a Nez. průběžně┃│
│ ▬▬──── sečteno 17 %   ČSÚ 15:11 │  │┃▬──── sečteno 10 %     ČSÚ 15:10┃│
│ PROSTĚJOV                    –  │  │┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛│
│ [SDRUŽENÍ] Prostějov 2:0        │  │ Změnit   Zapomenout   (44 px)   │
│ ──── čeká na první okrsky 15:10 │  │ NEJVĚTŠÍ MĚSTA …                │
└─────────────────────────────────┘  └─────────────────────────────────┘
5 BEFORE COUNTING                   6 DURING COUNTING / FINAL ROW        7 SHARD FAILED
│ PIRÁTI VE MĚSTECH  [PŘED SČÍT.]│  │ PLZEŇ                    17,5 % │  │█ MORAVSKOSLEZSKÝ KRAJ     ˄█│
│ Hlasování končí v sobotu ve 14:00│ │ [VLASTNÍ] Česká pirát. 9 mandátů│  │█ ⚠ Data kraje jsou zastaralá█│
│ BRNO                         –  │  │ ▬▬▬▬▬▬ konečné výsledky ČSÚ 0:17│  │█   — zkouším znovu          █│
│ [KOALICE] Piráti a Fakt Brno TU!│  │ (counting: "průběžně",          │  │ KARVINÁ   15,5 % … ⚠ ČSÚ 15:12│
│ ──── výsledky po 14:00          │  │  "sečteno 34 % okrsků")         │  │ OSTRAVA  ok (from top-1 shard)│
│ kraj header: "5 měst · výsledky │  │  all counted, not declared:     │  │ never loaded: "?" + "data se  │
│  po 14:00"                      │  │  "sečteno vše, čeká na vyhlášení"│ │  nepodařilo načíst"           │
```

## (c) Component specs
**Search (APG editable combobox, list autocomplete with automatic selection).** `<input role=combobox aria-autocomplete=list aria-expanded aria-controls aria-activedescendant>`, visually hidden `<label>`, 16 px font (no iOS zoom), × clear (44 px). Popup listbox under the sticky bar, ≤ 6 options on mobile / 8 desktop, option ≥ 52 px: name, "okres X · Kraj", live % + ČSÚ time if that town's data is already loaded (search never fetches). ↓/↑ move, Enter opens active (first by default), Esc closes then clears, Tab closes, tap selects (mousedown default prevented to keep focus). Polite status after 500 ms: "3 návrhy" / "Nic nenalezeno".
Normalise both sides: NFD, strip U+0300–036F, lowercase, `[‐-―-_.,/()„"']` → space, collapse spaces. Query tried as-is and with one leading preposition stripped (`v|ve|z|ze|do|na|u|k|ke|pro|o|po|za` + ≥ 2 chars). **Ranking:** 0 exact name > 1 name prefix > 2 word prefix (" boleslav", "mistek") > 3 alias / auto initials (exact only) > 4 okres word prefix > 5 substring (≥ 3 chars) > 6 typo (OSA ≤ 1, ≤ 2 from 7 chars; shown only if nothing better, with "Přesnou shodu nemáme — myslíte…"). Tie-break: published town before not-covered entry, then population desc. One **kraj option** appended when a kraj word starts with the query (≥ 3 chars) → opens/scrolls that section. **Not-covered entries** (Praha → praha.dg12.cz; no Pirate list; other lists only; < 10 000) and **low-confidence towns** ("způsob kandidatury ještě ověřujeme") appear as non-navigating options that open an info line. Empty: copy below + link to ČSÚ results app.
**Featured "Největší města".** 12 most populous (top-1, top-2), always mounted while the tab is visible; same rows; 1 column < 700 px, 2 columns ≥ 700. Kept in their kraj too.
**Region navigation — choice: disclosure sections on < 1024 px, expanded sections + sticky jump list on ≥ 1024.** For 79 towns a horizontal jump bar of 13 long kraj names scrolls off-screen on phones; 13 collapsed headers (58 px) *are* the jump list (≈ 1.3 screens) and give lazy polling a natural "opened" signal. Not nested; several may be open; `h3 > button[aria-expanded][aria-controls]` (APG accordion; native `<details>` acceptable but harder to control from React and to keep sticky). Expanded header sticks under the search (`top: 64px`, `scroll-padding-top` set so focus is never covered). Header line 2 (fixed 17 px): "N měst" → "N měst · načítám…" → "Sečteno k z N měst" (only when **all** that kraj's shards are loaded; towns with counted ≥ total > 0) → "⚠ Data kraje jsou zastaralá — zkouším znovu" / "⚠ Data se nepodařilo načíst — zkouším znovu". Desktop: 13 links "Středočeský 10" in the left column; click expands + scrolls + focuses the header.
**TownRow anatomy (fixed 72 px, padding 14 px, whole row one `<a href="/<slug>">`).** Grid `1fr | 84px`; L1 26 px: name (display font 23 px, ellipsis) | Pirate list % (24 px, tabular) or "–". L2 17 px: kind badge `VLASTNÍ` (black/yellow) · `KOALICE` (light yellow) · `SDRUŽENÍ` (grey) + list short name (ellipsis) | "průběžně" or "N mandátů" (only `official`). L3 16 px: 48 px progress bar + "sečteno 34 % okrsků" / "čeká na první okrsky" / "sečteno vše, čeká na vyhlášení" / "konečné výsledky" (green) / "výsledky po 14:00" / "načítám…" | own time "ČSÚ 18:42" (orange "⚠ ČSÚ …" when its shard is failing). States: skeleton (grey blocks, pulse off under reduced motion), error "?", stale, final. Screen-reader text "Piráti:" before the %. Data = freshest `generated` of the town's region shard and top shard.
**Chips** (`role=group`, `aria-pressed`, 44 px): `Kraje` (default) · `Velikost` · `A–Z` — flat lists are built from static `towns.generated.json`, live values lazy-fill per visible row, order never changes on refresh. Toggle `Jen sečtené`: filters immediately on known data; loads all region shards once (≈ 15 requests), then every 3 min while on; newly counted towns are offered in a reserved 44 px bar "Ukázat 2 nově sečtená města" (no reflow on refresh). **No "Podle výsledku Pirátů"** on election night (see h).
**Moje obec.** localStorage `mesta.mojeObec = <zastup>` (try/catch; without storage the page behaves the same). Set automatically on the first town opened from the index (toast + polite status "… si pamatujeme jako Moje obec (jen v tomto prohlížeči)"), or via `Změnit` (search in "vyberte svou obec" mode). `Zapomenout` removes it. Shown above featured on mobile, in the left column on desktop. Mounts only its own shard (`top-*` if it is a big town → no extra request).
**Empty / error / skeleton.** Rows exist from static data at first paint (names, badges, list names) → only value boxes skeleton. Shard error: keep last good per town (stale time), header line orange, retry 15 → 30 → 60 s; never a banner that pushes content. Offline: pill `OFFLINE`.
**Copy deck (Czech).** Title "Piráti ve městech 2026"; lead "Každé město má vlastní čas dat ČSÚ. Obnovujeme jen to, co máte na obrazovce." / pre: "Hlasování končí v sobotu ve 14:00. Výsledky 79 měst, kde Piráti kandidují."; pills `PŘED SČÍTÁNÍM` `ŽIVĚ` `OFFLINE`; search placeholder "Najít město nebo okres", label "Najít město nebo okres", clear "Vymazat hledání", hint "Návrhy se ukazují během psaní, šipkami je vyberete, Enter otevře město."; option sub "okres {okres} · {kraj}", kraj option "{N měst} · otevřít v seznamu", verify "Způsob kandidatury Pirátů ještě ověřujeme", not covered "Piráti tu letos nemají vlastní ani koaliční kandidátku" / "Piráti tu jsou jen na kandidátkách jiných stran — přehled je nezahrnuje" / "Pod 10 000 obyvatel — přehled je zatím nezahrnuje" / "Praha má vlastní přehled → praha.dg12.cz"; no result "„{q}" jsme nenašli. Přehled má 79 měst nad 10 000 obyvatel, kde Piráti kandidují samostatně nebo v koalici. Ostatní obce: výsledky ČSÚ."; fuzzy "Přesnou shodu nemáme — myslíte některé z těchto?"; more "+ {n} další — upřesněte hledání"; sections "Moje obec", "Změnit", "Zapomenout", "Napište svou obec", "Vyberte svou obec z návrhů.", "Největší města", "Všechna města", chips "Kraje" "Velikost" "A–Z" "Jen sečtené", "Načítám stav všech krajů: {k} z {n}…", "Ukázat {n} nově sečtená města", "Seznam sečtených měst je aktuální.", "Zatím žádné sečtené město."; region lines above; row lines above; footer "Data ČSÚ (volby.gov.cz), u každého města s jeho vlastním časem. Žádné součty ani odhady za kraje nebo republiku. Mandáty ukazujeme, až je ČSÚ vyhlásí." Plurals: 1 město, 2–4 města, 5+ měst; "Sečteno k z N měst" always genitive "měst".

## (d) Data and load
| Interaction | Shard feeds fetched | Polled afterwards |
|---|---|---|
| First visit, phone | `top-1`, `top-2` (+ Moje obec's region shard if not top-12) = **2–3** | same, every 60 s + per-tab offset 0–25 s |
| First visit, desktop 1280×800 | `top-1`, `top-2` (first kraj rows start at y ≈ 755 → below fold) = **2** (3 with Moje obec) | + shards of rows that become visible |
| Type in search / open suggestions | 0 (index is static; cached % only) | – |
| Expand a kraj / choose kraj suggestion | its 1–2 shards once a row is visible ≥ 400 ms | while ≥ 1 row visible; dropped 3 s after collapse/scroll-away |
| Fast scroll / smooth jump across kraje | only where the eye stops (dwell 400 ms) | – |
| `Velikost` / `A–Z` | shards of visible rows (typ. 1–3 per screen) | while visible |
| `Jen sečtené` on | all not-fresh region shards once (≤ 16, measured 15) | all every 3 min + visible every 60 s |
| Tab hidden | 0 | none; on return mounted shards older than the interval, staggered 300 ms |
| Shard error | retry 15 → 30 → 60 s | last good kept per town |
Before 14:00 the server should answer with `nextRefreshAt` ≈ 5 min (prototype keeps 60 s). Typical viewer ≈ 3 req/min, consistent with spec §3.4.
**Alias table.** Hand file `src/mesta/aliases.js`: `export default { '554791': { name: 'Plzeň', forms: ['Plzni', 'Plzně', 'Pilsen'] }, … }` keyed by KODZASTUP with a `name` typo guard (like overrides), ~1–6 forms per town (locative/genitive after v/z, nicknames "Budějky", "Mariánky", partial names "Stará Boleslav"). `search.js#buildIndex(towns, aliases, notCovered)` derives from `towns.generated.json`: normalized name, word list, okres, kraj, **auto initials** for 2–3 significant words (ČB, HK, KV, FM, UH; collisions such as Česká Třebová / Český Těšín "ct" dropped). Not-covered entries need a small generator output, e.g. `src/mesta/notCovered.generated.json` `[{ zastup, name, reason: 'no-pirate-list'|'other-lists-only'|'below-10k' }]` from the excluded / borderline-excluded sets, plus a static Praha entry (open question 2).

## (e) Accessibility and testing checklists
A11y: one `h1`; `h2` sections, `h3` kraj headers with `button[aria-expanded][aria-controls]`; combobox per APG (above); list containers `aria-live="off"`; exactly one `role=status` polite line (search counts, kraj opened, Moje obec set, filter result) — never on refresh; focus ring 3 px yellow; `scroll-padding-top` so sticky bars never hide focus (WCAG 2.4.11); targets ≥ 44 px (rows 72, headers 58, chips/links 44; desktop side links 36 px ≥ 24 AA); status never by colour alone (⚠ + text, "průběžně", "konečné výsledky"); contrast ≥ 4.5:1 for text (badge yellow-on-black, grey #5f5f5b on white); reduced motion disables pulse/smooth scroll; lang `cs`; skeletons have text ("načítám…").
Real phones: iPhone SE/13 mini Safari (320/375), mid-range Android Chrome, one old Android (Chrome 90+); VoiceOver + TalkBack: search → suggestion → open, expand kraj, hear one status line; 200 % text size (rows must not clip the name/value — check), landscape 667×375 (sticky bars ≤ 30 % of height), on-screen keyboard covering suggestions (6 options must remain reachable), dynamic toolbar and `100dvh`, back from town page restores scroll/open kraje, 3G throttling (first paint without data), airplane mode → OFFLINE + stale times, background tab for 5 min → no requests (DevTools network), battery saver.

## (f) Measures of success (checkable tonight) — prototype results 2026-10-10
| Measure | Target | Prototype (Browser pane) |
|---|---|---|
| Shard requests on first load | ≤ 3 | 375×812: 2 (no Moje obec), 3 with Moje obec Brandýs (`top-1, top-2, 21-1`); 1280×800: 2 |
| Horizontal scroll | none at 320/375/768/1280 | scrollWidth = viewport at 320, 375, 768 (753 + scrollbar), 1280 |
| CLS | ≤ 0.1 | 0.000 on load, refresh, kraj expand, `Jen sečtené` with real clicks (programmatic clicks show 0.058 — not user input) |
| Tap targets | ≥ 44 px | no interactive element < 44 px at 320 (footer inline links excepted) |
| Find a town | ≤ 3 taps/keystroke groups, ≤ 10 s | tap search, type 4–7 letters, Enter; test with Plzeň ("plzen"), Frýdek-Místek ("frydek"), Plzeň ("v Plzni"), Brandýs ("Brandys"), Olomouc → all first result |
| Console | clean | no messages |
| Dwell | smooth jump past 9 kraje | 3 extra fetches (only kraje where the view stopped) |
Tonight with people: 5 testers × 5 towns (Plzeň, Frýdek-Místek, Brandýs n. L.-St. B., Kopřivnice, Nové Město na Moravě) on their own phones; record time to the town page and wrong taps; success = median ≤ 10 s, ≤ 1 wrong tap per tester.

## (g) Risks and trade-offs
- **Auto "Moje obec"** may store a journalist's first click; mitigated by one-tap "Zapomenout"/"Změnit"; alternative is an explicit star on the town page (open question 1).
- **Lazy polling** means 300–700 ms skeleton after expanding; rows out of view can be minutes old — acceptable because each row shows its own ČSÚ time.
- **Desktop expanded kraje** on tall screens (≥ 1000 px) can make the first load 3–4 requests; dwell limits it; fallback: start collapsed on desktop too.
- **`Jen sečtené`** costs ≈ 15 requests per activation + 16 per 3 min per such viewer; drop it if edge load matters more than C's overview.
- **Alias table** is hand work (~120 strings) — guarded by tests; missing forms degrade to fuzzy/word-prefix, not to failure.
- **Long names** (Brandýs nad Labem-Stará Boleslav) are truncated in the display font; the accessible name and suggestion show the full name.
- **Running %** can still be quoted out of context; mitigations: "průběžně", progress, own time, no ranking, no sums.
- Mock data: `Sdružení` vs `Koalice` in the prototype is guessed from partners; real `kind` comes from `specifics.generated.json`.

## (h) Differences from the main designer's sketch
1. **Compact rows (~56 px, chevron expands details) — MODIFY.** Keep compact rows, but 72 px fixed with three lines and **one** tap target; drop the in-row chevron (two targets per 56 px row cause mis-taps; details belong on the town page). Kind badge + list name and the row's own ČSÚ time are always visible (the "how the Pirates run" rule).
2. **Sticky search that hides the sections while typing — MODIFY.** Keep sticky; use an APG popup (≤ 6) over the page instead of replacing the page (no reflow, place kept), add okres, aliases/declension, kraj option, typo tolerance, not-covered towns and the Praha redirect.
3. **Featured "Největší města" (12, always live) — ADOPT**, rendered with the same row component (not cards) so numbers align vertically for B; 2 columns from 700 px.
4. **Kraje collapsed on mobile, lazy shard polling — ADOPT, refine:** visibility per row with 400 ms dwell / 3 s grace (not per section), failure and progress in the fixed header line (no banners), Moje obec mounts only its shard, desktop expanded + left jump list. Same "Sečteno N z M měst only when all shards loaded" rule.
5. **Chips — MODIFY.** `Podle krajů` ✓ (as `Kraje`), `Podle velikosti` ✓ (+ `A–Z`); the note "seřazeno z načtených krajů" becomes unnecessary because rows are static and fill lazily. **REJECT `Podle výsledku Pirátů`** tonight: ranks partial counts (league table / projection by another name), re-orders on every refresh (CLS, lost place) and invites misleading screenshots; reconsider after all towns are official. `Jen sečtené` ✓ but as an explicit "load all once" action with snapshot + "Ukázat N nově sečtených" (no reflow).
6. **Additions not in the sketch:** Moje obec; not-covered/Praha answers in search; kraj option in search; per-row stale marker.

## (i) Implementation notes (React, `src/mesta/`)
Components: `MestaIndex.jsx` (layout, view/filter state, `useRowVisibility` single IntersectionObserver → visible shard ids with dwell/grace), `IndexHeader.jsx` (reuse `StatusPill`), `TownSearch.jsx` (combobox), `MyTown.jsx` + `useMyTown()` (localStorage try/catch), `FeaturedTowns.jsx`, `RegionSection.jsx`, `TownRow.jsx` (pure, memoised on `generated|counted|official|status`), `ListControls.jsx` (chips + reserved new-bar), `ShardSubscriber.jsx` (one `useLiveResults({key:'kraj.<id>', url:'/api/kraj?s=<id>', version: OVERVIEW_VERSION, arrivals:false})` per **active** id — rendering it = mounted, unrendering = unmounted, as spec §3.4; results into a small context store).
Pure, unit-tested: `indexModel.js` — `activeShards({featured, mineShard, visibleShardIds, allOnce})`, `freshest(town, shardStates)`, `rowView(summary, shardStatus)` → `{val, seats, txt, time, bar, state}`, `regionLine(towns, shardStates)`, `doneSet(...)`, `flatOrder(towns, 'velikost'|'az')` (cs collator). `search.js` — `norm`, `stripPrep`, `osa`, `buildIndex`, `search(index, q, {limit})`.
Normaliser tests (input → expected): `norm('Plzeň')→'plzen'`; `norm('  PLZEŇ ')→'plzen'`; `norm('Frýdek-Místek')→'frydek mistek'`; `norm('Frýdek – Místek')→'frydek mistek'`; `norm('Brandýs nad Labem-Stará Boleslav')→'brandys nad labem stara boleslav'`; `norm('Ústí n. L.')→'usti n l'`; `norm('Ústí n/L')→'usti n l'`; `norm('„Praha 7"')→'praha 7'`; `norm('Dvůr Králové nad Labem')→'dvur kralove nad labem'`; `stripPrep('v plzni')→'plzni'`; `stripPrep('ve zline')→'zline'`; `stripPrep('z plzne')→'plzne'`; `stripPrep('u')→'u'`; `stripPrep('usti')→'usti'`; `stripPrep('nachod')→'nachod'`.
Search tests (query → names, in order; all verified in the prototype): `plzen→[Plzeň, Plzeňský kraj]`; `v Plzni→[Plzeň]`; `z Plzně→[Plzeň]`; `frydek→[Frýdek-Místek]`; `Frýdek Místek→[Frýdek-Místek]`; `Brandys→[Brandýs n. L.-St. B.]`; `Stará Boleslav→[Brandýs…]`; `Boleslav→[Mladá Boleslav, Brandýs…]`; `Olomouc→[Olomouc, Uničov, Olomoucký kraj]`; `olomuc→[Olomouc]` (typo); `Karvina→[Karviná, Orlová, Český Těšín]`; `Praha-východ→[Brandýs…, Říčany, Čelákovice]`; `Praha 7→[Praha]` and `v Praze→[Praha]` (→ praha.dg12.cz); `Havířov→[Havířov (not covered)]`; `CB→[České Budějovice]`; `budejky→[České Budějovice]`; `hk→[Hradec Králové]`; `Hradec→[Hradec Králové, Jindřichův Hradec]`; `Kralove→[Hradec Králové, Dvůr Králové n. L., Královéhradecký kraj]`; `Mostě→[Most]`; `ve Zlíně→[Zlín]`; `ústí n. l.→[Ústí nad Labem]`; `ustecky→[Ústecký kraj]`; `vysocina→[Kraj Vysočina]`; `xyzabc→[]`. Plus table tests: every alias's first result is its own town; no alias equals another town's name/okres; dropped initials are not ambiguous.

## Open questions for the owner
1. Moje obec set automatically on first open (proposed) or only explicitly?
2. May the generator emit `notCovered.generated.json` (excluded/borderline-excluded names + reason) so search can answer "Havířov"/"Sokolov"/"Litovel" instead of nothing?
3. Keep `Jen sečtené` (≈ 15 extra requests per use) or drop it for edge headroom?
4. Desktop: kraje expanded (proposed) or collapsed like mobile (strict ≤ 3 on tall screens)?
5. `Podle výsledku Pirátů`: never, or enable after all towns are official?
