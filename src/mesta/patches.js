// Přesné textové záplaty Prahy pro build `mesta` (spec §3.1, §5). Zdrojáky Prahy
// se nemění: vite.mesta.config.js je při buildu aplikuje v paměti (plugin
// `mesta-patches`, enforce 'pre', takže ještě před JSX transformací).
//
// Každá záplata musí v souboru sedět PŘESNĚ JEDNOU, jinak build spadne — změní-li
// se zdroj Prahy, mesta to oznámí hlasitě (riziko R3), ne tichým rozbitím.
// Kotvy ověřuje i patches.test.js proti skutečným souborům.

const COUNCIL_APP = 'src/pages/CouncilApp.jsx';

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
