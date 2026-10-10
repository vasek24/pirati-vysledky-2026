# Hardening backlog

Odloženo při tvorbě záložní kopie (zdroj: SDD ledger `progress.md`, položky „minor (deferred)",
„follow-up", rulings s náklady). Deduplikováno; `soubor:řádek` je podle stavu v době review a
může se posunout. Priority: **P1** = může zabolet ve volební noci, **P2** = vyleštění,
**P3** = nice to have. Čísla jsou stabilní ID (po přeřazení mezi prioritami se nemění). Tag v závorce = původ (Task/Phase).

## P1 — může zabolet ve volební noci
1. **Ověřit na skutečných sečtených datech (po ~15:00)** — `scripts/compare-original.mjs`, logy
   `wrangler tail` (`warmup-ok` x12), `x-cache: HIT`. Dosud ověřeno jen před sčítáním. (completion check)
2. **Pomalý/zavěšený Durable Object** — každý miss posílá jeden RPC na colo po dobu 13 s okna;
   throttle je per isolate, ne per klíč (`cloudflare/worker.js`). Zvážit sdílené okno per klíč. (T9)
3. **Rezerva cold startu**: RPC timeout 13 s vs. build 12 s — téměř žádná rezerva. (T9)
4. **Nedokončený `put` do DO storage**: nekonečně čekající zápisy se hromadí; po ~60 s selhání
   rehydratace stavět v paměti bez `put`. (T8 `cloudflare/refresh.js`)
6. **`fetchId` čten až po čekání na okrsky** (`src/volby/feed.js:330-333`): zachytit hned po
   `Promise.all`; `invalidate()` neruší běžící fetch; chybí `build()` test s `precinctFiles`. (T7)
8. **Nasazení přes GitHub Actions nebylo nikdy spuštěno naostro**: první běh `deploy.yml` dát jako
   `target=staging`; `CLOUDFLARE_API_TOKEN` musí být repo secret; do té doby nasazovat ručně
   podle runbooku. `environment.url` hrana. (T12)
9. **Nasazení mění RPC kontrakt DO/Worker neatomicky** — zpětně kompatibilní změny tvaru
   `run()` nebo nasazení mimo špičku (už v runbooku; hlídat při každé změně). (T11)

## P2 — vyleštění
5. **Trvale `complete:false` přehled** — po N minutách to vzdát a zalogovat `error`: z velké části pokryto
   logováním `INCOMPLETE_ERROR_MS` (`cloudflare/refresh.js:257-261`). Zbývá: logovat, když sloučený hash == good hash
   a všechny rady byly zkopírovány (zmizelý signál `older` na úrovni přehledu). (T6/T8)
7. **`validate.js` VOLATILE neobsahuje `firstSeenAt`** → změna jen v `firstSeenAt` může vypadat jako
   změna obsahu; chybí test karantény pro stejné `generated`. Ověřit a doplnit. (P2-C)
11. Chybí hook-level test napojení `clampTimeout`/`nextSkew` v `src/hooks/useLiveResults.js`
    (ochrana proti těsné smyčce); `lastDelayRef` míchá hodiny; `task-10-report` concern 4 zastaralý. (T10)
12. `cloudflare/worker.js:12-13` hlavička nezmiňuje `x-cache: UNAVAILABLE`; odpověď 405 obchází
    `reply()`; content-type 503 vs `JSON_TYPE`. (T4/T9)
13. Test časového limitu warm-upu použít s `concurrency 1` (důkaz, že lane pokračuje);
    komentář, že DO po RPC timeoutu běží dál. (T4)
14. `nextLatency` porovnává jen rovnost — starší replika přepíše řetězec; po reloadu je první
    odpověď „nové spatření"; neplatný skew při prvním spatření zahodí krok prohlížeče;
    popisek kroku „prohlížeč" zahrnuje čekání na poll při čerstvém načtení. (P2-B/C)
15. Stejné souhrny v jednom okně se znovu neoznámí; hranice `fmtPp` 0,05; `Provider` JSX neodsazen;
    vizuální kontrola P2-A. (P2-A)
16. Spec §3.1 neuvádí `firstSeenAt`; přeformátovaný literál `meta`; pořadí polí `get().meta`. (P2-C)
17. `deploy.yml` znovu buildí po grepu; chybí render test Landing hero. (T12)
18. `contact.test.js`: kontrola „žádný autor" se nevztahuje na JSX; `noscript` regex ověřuje jen
    telefon; kontaktní `<p>` v Landing je mimo `<footer>`. (T3)
19. `validateCandidate` JSDoc říká, že ctx je povinný; rozbitý kandidát + nenulové good + špatné ctx
    vrací `rejected` místo TypeError. (T6)
20. Duplicitní řádky komentáře ve větvi `older`. (T8)

## P3 — nice to have
21. `nextRefreshAt` starší než 1 h → fallback 60 s (záměrné zpřísnění proti spec 5–10 s); zvážit
    jemnější fallback. (T10)
22. Server-side `firstSeenAt` je hotové (P2-C); další zpřesnění latenčního řetězce
    (per-colo repliky) až po volbách. (R11)
23. Role `status` na pill „ZASTARALÉ" — rozhodnuto přeskočit; vrátit se, pokud bude přístupnostní audit. (T2)
24. Úklid scratch větve `ci/main-check` (mazání větví vyžaduje souhlas vlastníka). (completion check)

## Už vyřešeno (není v backlogu)
`UpdateManager.jsx`: `tryReload` znovu ověřuje `shouldAutoReload` (`src/components/UpdateManager.jsx:121`;
`setInterval` na :125) — R7/T10 (zbývá jen to, že test je regex nad zdrojem, viz položka o testech T10).
Zastaralý komentář `wrangler.jsonc`, staging Analytics dataset, `ci.yml` `test -d dist/assets &&`,
deploy bez stagingu (T1 -> T5/T12); mrtvý span `direct` na `Landing.jsx:358` (R6/T3);
`LAST_RESORT_TTL` 1200 s (R10); zákaz druhého kola Codexu (R12).
