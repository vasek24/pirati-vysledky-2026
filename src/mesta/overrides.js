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
export default {
    reviewedAt: null,
    towns: {},
};
