// Přesné textové záplaty Prahy pro build `mesta` (spec §3.1, §5). Zdrojáky Prahy
// se nemění: vite.mesta.config.js je při buildu aplikuje v paměti (plugin
// `mesta-patches`, enforce 'pre', takže ještě před JSX transformací).
//
// Každá záplata musí v souboru sedět PŘESNĚ JEDNOU, jinak build spadne — změní-li
// se zdroj Prahy, mesta to oznámí hlasitě (riziko R3), ne tichým rozbitím.
// Kotvy ověřuje i patches.test.js proti skutečným souborům.

const COUNCIL_APP = 'src/pages/CouncilApp.jsx';
const RESULTS_MAP = 'src/components/ResultsMap.jsx';
const PRECINCTS = 'src/components/Precincts.jsx';
const MAP_MODES = 'src/volby/mapModes.js';

// Mapa okrsků měst (T10). Příznaky měst z buildCouncils: `map`, `precinctFiles`, `precinctHistory`.
// `precinctHistory: false` = okrsky 2022 se s okrsky 2026 nemusí krýt → mapa i detail okrsku
// žádné srovnání s 2022 po okrscích neukazují (režim „vs 2022“ zmizí, tooltipy a detail bez „minule“).
const NO_PRECINCT_HISTORY = "activeCouncil().precinctHistory === false";

export const PATCHES = [
    // --- CouncilApp: banner „Jak tu kandidují Piráti“ nahoře v přehledovém sloupci
    {
        file: COUNCIL_APP,
        from: "import { POLLS_CLOSE } from '../councils';",
        to: "import { POLLS_CLOSE } from '../councils';\nimport MestaArrangement from '../mesta/MestaArrangement.jsx';",
    },
    {
        file: COUNCIL_APP,
        from: '    const overview = (\n        <div className="space-y-3">\n',
        to: '    const overview = (\n        <div className="space-y-3">\n            <MestaArrangement council={council} model={model} />\n',
    },
    // --- CouncilApp: „Piráti tu nekandidují“ a seznam kandidátů řeší banner
    {
        file: COUNCIL_APP,
        from: '{!council.pirates && !council.pirateCandidates.length && (',
        to: '{false && (',
    },
    {
        file: COUNCIL_APP,
        from: '{!council.pirates && <PirateCandidates model={model} />}',
        to: '{null}',
    },
    // --- CouncilApp: název záložky — u koalice jméno kandidátky, ne holá „Piráti“
    {
        file: COUNCIL_APP,
        from: '` · Piráti ${fmtPct(model.ours.share)}`',
        to: '` · ${partyMeta(council.pirates).tiny} ${fmtPct(model.ours.share)}`',
    },
    // --- CouncilApp: patička
    {
        file: COUNCIL_APP,
        from: 'Záložní kopie originálu jsemfast/pirati-vysledky-2026 · správce kopie: Václav Vislous ·',
        to: 'Postaveno na kódu jsemfast/pirati-vysledky-2026 · správce: Václav Vislous ·',
    },
    {
        file: COUNCIL_APP,
        from: 'výpočet ověřený na výsledcích 2022',
        to: 'výpočet ověřený na pražských výsledcích 2022',
    },
    // --- CouncilApp: mapa okrsků. Před sčítáním se NEukazují okrsky 2022 (jiná čísla kandidátek,
    // jiné okrsky) — všechny okrsky jsou šedé, dokud je ČSÚ nesečte.
    {
        file: COUNCIL_APP,
        from: "        if (counted > 0) return snapshot;\n        return { ...snapshot, fetchedAt: 'kv2022', okrsky: precincts2022(statics.results2022) };",
        to: '        return snapshot;',
    },
    {
        file: COUNCIL_APP,
        from: 'Ještě se nesčítá — mapa zatím ukazuje <b className="text-[#FEC900]">komunální volby 2022</b> (předchůdci dnešních kandidátek).',
        to: 'Ještě se nesčítá — okrsky se na mapě obarví, jakmile je sečte ČSÚ.',
    },
    // prázdná kolekce okrsků (výpadek dat, město bez polygonů) = žádná mapa, jen panely
    {
        file: COUNCIL_APP,
        from: 'const mapData = !!council.map && !!statics?.geoJson;',
        to: 'const mapData = !!council.map && !!statics?.geoJson?.features?.length;',
    },
    // --- ResultsMap
    {
        file: RESULTS_MAP,
        from: "import { reducedMotion } from '../utils/motion';",
        to: "import { reducedMotion } from '../utils/motion';\nimport { PENDING_FILL, isPending } from '../mesta/mapUi.js';",
    },
    // L.geoJSON(prázdná kolekce).getBounds() je neplatné → fitBounds by hodil „Bounds are not valid“
    {
        file: RESULTS_MAP,
        from: 'const bounds = L.geoJSON(data).getBounds();',
        to: 'const bounds = L.geoJSON(data).getBounds();\n        if (!bounds.isValid()) return undefined;',
    },
    // sečtený okrsek, jehož hlasy se ještě dotahují, není „čeká na sečtení“
    {
        file: RESULTS_MAP,
        from: "            return { ...base, fillColor: UNCOUNTED_FILL, fillOpacity: 0.6, dashArray: selected ? null : '4 4', color: selected ? '#000000' : '#78716C' };",
        to: "            if (isPending(o, modeId)) return { ...base, fillColor: PENDING_FILL, fillOpacity: 0.7, dashArray: selected ? null : '2 3', color: selected ? '#000000' : '#B45309' };\n            return { ...base, fillColor: UNCOUNTED_FILL, fillOpacity: 0.6, dashArray: selected ? null : '4 4', color: selected ? '#000000' : '#78716C' };",
    },
    {
        file: RESULTS_MAP,
        from: '<div class="okt-s">čeká na sečtení</div>',
        to: '<div class="okt-s">${okrsek ? \'sečteno — hlasy se dotahují\' : \'čeká na sečtení\'}</div>',
    },
    {
        file: RESULTS_MAP,
        from: 'const then = base ? baselineShare(results2022, base.ids, id) : null;',
        to: `const then = base && !(${NO_PRECINCT_HISTORY}) ? baselineShare(results2022, base.ids, id) : null;`,
    },
    // --- mapModes: bez 2022 po okrscích není „Piráti vs 2022“
    {
        file: MAP_MODES,
        from: "m.id === 'ours' || m.id === 'swing' ? !!council?.pirates",
        to: "m.id === 'ours' || m.id === 'swing' ? !!council?.pirates && !(m.id === 'swing' && council?.precinctHistory === false)",
    },
    // --- Precincts: ovládání mapy a detail okrsku
    {
        file: PRECINCTS,
        from: "import { scrollBehavior } from '../utils/motion';",
        to: "import { scrollBehavior } from '../utils/motion';\nimport { PENDING_FILL, oursButtonLabel, oursLongLabel } from '../mesta/mapUi.js';",
    },
    {
        file: PRECINCTS,
        from: 'const ourBaseline = () => partyMeta(ourId()).baseline?.ids || null;',
        to: `const ourBaseline = () => (${NO_PRECINCT_HISTORY} ? null : partyMeta(ourId()).baseline?.ids || null);`,
    },
    {
        file: PRECINCTS,
        from: 'const then = meta.baseline ? baselineShare(results2022, meta.baseline.ids, id) : null;',
        to: `const then = meta.baseline && !(${NO_PRECINCT_HISTORY}) ? baselineShare(results2022, meta.baseline.ids, id) : null;`,
    },
    {
        file: PRECINCTS,
        from: 'const r22 = results2022?.okrsky?.[id];',
        to: `const r22 = ${NO_PRECINCT_HISTORY} ? null : results2022?.okrsky?.[id];`,
    },
    {
        file: PRECINCTS,
        from: '<div className="mt-2 text-[11px] text-neutral-500">Změna = proti předchůdci kandidátky v KV 2022 v tomto okrsku.</div>',
        to: `{!(${NO_PRECINCT_HISTORY}) && <div className="mt-2 text-[11px] text-neutral-500">Změna = proti předchůdci kandidátky v KV 2022 v tomto okrsku.</div>}`,
    },
    {
        file: PRECINCTS,
        from: "{ourId() ? 'Procento = Piráti, změna proti jejich výsledku v KV 2022 ve stejném okrsku.' : 'Procento = vítěz okrsku.'}",
        to: `{ourId() ? (${NO_PRECINCT_HISTORY} ? 'Procento = podíl kandidátky s Piráty v okrsku.' : 'Procento = Piráti, změna proti jejich výsledku v KV 2022 ve stejném okrsku.') : 'Procento = vítěz okrsku.'}`,
    },
    {
        file: PRECINCTS,
        from: '{m.label}',
        to: "{m.id === 'ours' ? oursButtonLabel(partyMeta(ourId()), m.label) : m.label}",
    },
    {
        file: PRECINCTS,
        from: '{MAP_MODES.find((m) => m.id === modeId)?.long}',
        to: "{modeId === 'ours' ? oursLongLabel(partyMeta(ourId()), MAP_MODES.find((m) => m.id === modeId)?.long) : MAP_MODES.find((m) => m.id === modeId)?.long}",
    },
    {
        file: PRECINCTS,
        from: '<span className="w-3 h-3 rounded-sm border border-dashed border-neutral-500" style={{ backgroundColor: UNCOUNTED_FILL }} /> čeká na sečtení',
        to: '<span className="w-3 h-3 rounded-sm border border-dashed border-neutral-500" style={{ backgroundColor: UNCOUNTED_FILL }} /> čeká na sečtení\n                    <span className="ml-1 w-3 h-3 rounded-sm border border-dashed border-amber-700" style={{ backgroundColor: PENDING_FILL }} /> sečteno, hlasy se dotahují',
    },
    {
        file: PRECINCTS,
        from: '<span className="shrink-0 w-2.5 h-2.5 rounded-sm border border-dashed border-neutral-500" style={{ backgroundColor: UNCOUNTED_FILL }} title="čeká na sečtení" />',
        to: '<span className="shrink-0 w-2.5 h-2.5 rounded-sm border border-dashed border-neutral-500" style={{ backgroundColor: UNCOUNTED_FILL }} title="čeká na sečtení" />\n                    <span className="shrink-0 w-2.5 h-2.5 rounded-sm border border-dashed border-amber-700" style={{ backgroundColor: PENDING_FILL }} title="sečteno, hlasy se dotahují" />',
    },
    // --- ElectionHeader: „Mezitím se můžeš podívat na původní web“ by u měst vedlo na pražský tracker
    {
        file: 'src/components/ElectionHeader.jsx',
        from: '            <a href={ORIGINAL_SITE_URL} target="_blank" rel="noopener noreferrer" className={cls}>původní web</a>\n            {\' \'}nebo na{\' \'}\n',
        to: '',
    },
    // --- Councilors
    {
        file: 'src/components/Councilors.jsx',
        from: 'Pirátská kandidátka — prvních 10.',
        to: 'Kandidátka s Piráty — prvních 10.',
    },
    // --- WelcomeGuide
    {
        file: 'src/components/WelcomeGuide.jsx',
        from: 'komunálních voleb 2026 v Praze',
        to: 'komunálních voleb 2026 ve městech',
    },
    {
        file: 'src/components/WelcomeGuide.jsx',
        from: 'pro celou MČ typické',
        to: 'pro celé město typické',
    },
    // --- ElectionHeader
    {
        file: 'src/components/ElectionHeader.jsx',
        from: 'Ostatní městské části',
        to: 'Ostatní města',
    },
];

// index.html: vstupní skript, titulek, popis. Musí proběhnout PŘED tím, než Vite
// vstup zparsuje (transformIndexHtml order 'pre'), jinak se zabalí main.jsx Prahy.
export const HTML_PATCHES = [
    { from: 'src="/src/main.jsx"', to: 'src="/src/mesta/main.jsx"' },
    { from: '<title>Volby 2026 · Piráti Praha</title>', to: '<title>Volby 2026 · Piráti ve městech</title>' },
    {
        from: 'content="Živé výsledky komunálních voleb 2026 — Praha 3, Praha 6, Praha 11. Mandáty, zvolení zastupitelé, koalice a mapa okrsků."',
        to: 'content="Živé výsledky komunálních voleb 2026 ve městech, kde kandidují Piráti. Mandáty, zvolení zastupitelé a koalice."',
    },
    // komentář a <noscript>: jinak by mesta tvrdila, že je „záložní kopií originálu“
    {
        from: '<!-- Záložní kopie originálu jsemfast/pirati-vysledky-2026.\n         Václav Vislous spravuje tuto kopii a její úpravy: +420 777 954 389 (tel:+420777954389) -->',
        to: '<!-- Postaveno na kódu jsemfast/pirati-vysledky-2026 · správce: Václav Vislous, +420 777 954 389 -->',
    },
    {
        from: 'Záložní kopie originálu jsemfast/pirati-vysledky-2026 ·\n        Václav Vislous spravuje tuto kopii a její úpravy ·',
        to: 'Postaveno na kódu jsemfast/pirati-vysledky-2026 · správce: Václav Vislous ·',
    },
];

const occurrences = (text, needle) => text.split(needle).length - 1;

function replaceOnce(code, { from, to }, where) {
    const n = occurrences(code, from);
    if (n !== 1) {
        throw new Error(`mesta patch: anchor in ${where} matches ${n}× (expected exactly 1): ${JSON.stringify(from.slice(0, 80))}`);
    }
    // Funkce, ne řetězec: `$` ve výměně (šablonové řetězce) se nesmí vyložit jako vzor.
    return code.replace(from, () => to);
}

// relFile: cesta k souboru od kořene repa (lomítka i zpětná lomítka); soubor bez
// záplat se vrací beze změny.
export function applyPatches(relFile, code) {
    const file = relFile.replace(/\\/g, '/').replace(/^\.\//, '');
    return PATCHES.filter((p) => p.file === file).reduce((out, p) => replaceOnce(out, p, file), code);
}

export function applyHtmlPatches(html) {
    return HTML_PATCHES.reduce((out, p) => replaceOnce(out, p, 'index.html'), html);
}

export const PATCHED_FILES = [...new Set(PATCHES.map((p) => p.file))];
