// Ruční zásahy majitele do generovaných dat produktu "mesta" (vyhrávají nad generátorem).
// Klíč = KODZASTUP jako řetězec (názvy měst se opakují); `name` musí přesně odpovídat názvu v registru ČSÚ.
// Tvar záznamu (spec §4.3):
//   '<KODZASTUP>': {
//     name: 'Sokolov',                        // povinné
//     include?: true | false, reason?: '…',   // vynucené zařazení / vyřazení (reason nebo note povinné)
//     borderlineReason?: '…',                 // ruční důvod pro město s 7 000–9 999 obyvateli
//     type?: 'a'|'b'|'c'|'d',                 // změna typu kandidatury (reason nebo note povinné)
//     list?: { short?, kind?, partners? },    // oprava kandidátky (reason nebo note povinné); `pirates` se odvodí z list.id
//     pirateCandidates?: [{ list, n, name }], // (reason nebo note povinné)
//     note?: '…', title?: '…',
//     map?: boolean,                          // mapa okrsků (výchozí: true u `featured` zobrazených měst); false ji vypne i s okrskovými soubory
//     lists?: { '<číslo>': { short?, tiny?, color?, note? } },
//     confidence?: 'low', reviewed?: true,    // low jen s `note`; takto skryté město odemkne jen vlastní `reviewed: true`
//   }
// Do ZAŘAZENÍ měst (generátor, scripts/mesta-registry.js) zasahují jen `include` (+ `reason`/`note`) a `borderlineReason`;
// `type`, `list`, `pirateCandidates` ovlivňují jen zobrazení (src/mesta/buildCouncils.js), nikoli to, zda je město zveřejněno.
// `pirates` se nikdy nenastavuje přímo. `reviewedAt`: ISO datum, kdy majitel prošel generované (low) záznamy; null = nikdy.
// Pravidla hlídá `validateOverrides` (scripts/mesta/registryCore.js), test `overrides.test.js`.
// Kosmetické zkratky kandidátek Pirátů u měst s mapou (`lists[<id>].tiny` = popisek v tlačítkách mapy,
// legendě, tooltipech a titulku záložky; ČSÚ `short8` je nečitelný, např. „PirIdeFaktBrGEN“). Ověřeno proti
// public-mesta/data/<slug>/lists.json (složení a název kandidátky).
const tiny = (name, id, label) => ({ name, lists: { [id]: { tiny: label } } });

export default {
    reviewedAt: null,
    towns: {
        582786: tiny('Brno', 15, 'Piráti+Fakt'), // Piráti a Fakt Brno TU! (+ Idealisté, GEN)
        569810: tiny('Hradec Králové', 4, 'Piráti+STAN'), // PIRÁTI a STAROSTOVÉ
        532053: tiny('Kladno', 8, 'Kladeňáci'), // KLADEŇÁCI
        554804: tiny('Ústí nad Labem', 5, 'Jedno Ústí'), // JEDNO ÚSTÍ
        500496: tiny('Olomouc', 9, 'Milujeme OL'), // MILUJEME OLOMOUC - Piráti, TOP 09, Zelení
        567027: tiny('Most', 6, 'Piráti+Zel+STAN'), // Piráti, Zelení a Starostové (Zelení i STAN)
        544256: tiny('České Budějovice', 6, 'Piráti+Bud.'), // Piráti a Budějčáci s podporou Zelených
        563889: tiny('Liberec', 6, 'LOL+Piráti'), // Liberec otevřený lidem a Piráti
        555134: tiny('Pardubice', 3, 'Piráti+TOP'), // Prog. Pard. (Piráti, TOP, ...)
        585068: tiny('Zlín', 5, 'Zlín srdcem'), // ZLÍN SRDCEM a Piráti
        // Majitel (2026-10-10): „show both“ — města 7 000–9 999 obyv. zařazená podle výsledku 2022 jsou odemčena.
        584649: { name: 'Mikulov', reviewed: true },
        599107: { name: 'Rychvald', reviewed: true },
    },
};
