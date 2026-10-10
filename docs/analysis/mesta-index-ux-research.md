# Mesta index — UX research notes (Haiku web research, 2026-10-10)

Limits: BBC/Guardian/NYT/WaPo/Politico/Wahlen.de hubs and volby.gov.cz/iROZHLAS search could not be verified; NN/g and MDN String.normalize pages 404'd (those points INFERRED).

## Ranked recommendations
1. **Search-first combobox** on top (WAI-ARIA APG editable combobox with list autocomplete: Down Arrow into the popup, Enter accepts, Esc dismisses, `aria-activedescendant`); cap suggestions at 4–8 on mobile (Baymard: mobile problems around 8 items); show "město (okres)" in each suggestion because names repeat (Seznam has two Nová Ves); keep the sticky header compact.
2. **"Moje obec" block** above the search, stored in localStorage (per-viewer convenience: wrap reads/writes in try/catch, render fine without it).
3. **Featured-city chips + kraj selector** — copy Seznam Zprávy 2022: "Vyberte lokalitu" = Celá ČR + 12 large cities; "Vyberte kraj" dropdown of 14; okres-scoped alphabetical list; breadcrumb. https://www.seznamzpravy.cz/p/vysledky-voleb/2022/komunalni-volby/obec/540269-nova-ves
4. **Region browsing without nested accordions** (GOV.UK: accordions hide content, never nested, usually closed, may remember state in sessionStorage; never for content everyone needs). For ~80 towns a sticky region jump bar beats 14 accordions; if disclosure is used, native `<details>/<summary>` with counts in the summary line ("X z Y okrsků").
5. **Filter + sort chips** (NN/g Mobile Tables: narrow before viewing): "Piráti v zastupitelstvu", "Sečteno", "Čeká se na data", sort by size.
6. **Refresh cost**: do not poll hidden tabs (Page Visibility API), catch up on return; reserve row heights/placeholders (CLS ≤ 0.1); at ~80 rows virtualisation is unnecessary.
7. **Announcements**: `aria-live="off"` on the list, one polite status line for user-triggered changes only.
8. **Touch targets** 44 px rows (WCAG 2.2 SC 2.5.8 AA = 24 px min; 2.5.5 AAA = 44 px).
- Geolocation "near me": opt-in button only; use coordinates only to pick a suggestion; do not store.

## Czech search
- Normalise index and query: NFD, strip U+0300–U+036F, lowercase ("Plzen" finds "Plzeň").
- Treat hyphen/dash/space as one separator ("Frýdek Místek" = "Frýdek-Místek"); official "Brandýs nad Labem-Stará Boleslav" with hyphen; index aliases "Brandýs", "Stará Boleslav".
- Declension ("v Plzni", "z Plzně"): hand-made alias table (~80 entries with locative/genitive) beats a stemmer.
- Make okres searchable and use it as grouping/disambiguation key.
- Status line pattern (CNN Prima): "x % okrsků sečteno".

## Examples to imitate
A. Seznam Zprávy municipal results 2022 (lokalita chips, kraj dropdown, okres list, breadcrumb). B. CNN Prima NEWS 2022 https://cnn.iprima.cz/volby/komunalni/podoli (list "Jak se volilo ve vaší obci?" with okres in parentheses, search link, precincts-counted line). C. GOV.UK accordion rules. D. WAI-ARIA APG combobox.

## Anti-patterns
1. One flat 80-row list with no search/chips/jump links (or a native `<select>` with 80 options). 2. Nested accordions / hiding status behind taps. 3. Rebuilding the whole list every minute, announcing every update to screen readers, polling hidden tabs.
