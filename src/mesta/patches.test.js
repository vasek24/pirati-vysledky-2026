import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP_VERSION, CHANGELOG } from './changelog.js';
import { HTML_PATCHES, PATCHES, applyHtmlPatches, applyPatches } from './patches.js';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const count = (text, needle) => text.split(needle).length - 1;

const COUNCIL_APP = 'src/pages/CouncilApp.jsx';
const WELCOME = 'src/components/WelcomeGuide.jsx';
const HEADER = 'src/components/ElectionHeader.jsx';
const COUNCILORS = 'src/components/Councilors.jsx';
const RESULTS_MAP = 'src/components/ResultsMap.jsx';
const PRECINCTS = 'src/components/Precincts.jsx';
const MAP_MODES = 'src/volby/mapModes.js';

describe('patch list (spec §5)', () => {
    it('has CouncilApp x10, ResultsMap x5, Precincts x10, mapModes x1, WelcomeGuide x2, ElectionHeader x2, Councilors x1', () => {
        const per = (file) => PATCHES.filter((p) => p.file === file).length;
        expect(per(COUNCIL_APP)).toBe(10);
        expect(per(RESULTS_MAP)).toBe(5);
        expect(per(PRECINCTS)).toBe(10);
        expect(per(MAP_MODES)).toBe(1);
        expect(per(WELCOME)).toBe(2);
        expect(per(HEADER)).toBe(2);
        expect(per(COUNCILORS)).toBe(1);
        expect(PATCHES).toHaveLength(31);
    });

    it('every anchor occurs exactly once in the real Prague file', () => {
        for (const p of PATCHES) {
            expect(count(read(p.file), p.from), `${p.file}: ${p.from}`).toBe(1);
        }
    });

    it('every replacement differs from its anchor', () => {
        for (const p of PATCHES) expect(p.to).not.toBe(p.from);
    });
});

describe('applyPatches on the real files', () => {
    it('CouncilApp: banner once, Prague-only strings gone', () => {
        const out = applyPatches(COUNCIL_APP, read(COUNCIL_APP));
        expect(count(out, '<MestaArrangement council={council} model={model} />')).toBe(1);
        expect(out).toContain("import MestaArrangement from '../mesta/MestaArrangement.jsx';");
        expect(out).not.toContain('!council.pirates && !council.pirateCandidates.length && (');
        expect(out).toContain('{false && (');
        expect(out).not.toContain('<PirateCandidates model={model} />');
        expect(out).not.toContain('· Piráti ${fmtPct');
        expect(out).toContain('${partyMeta(council.pirates).tiny} ${fmtPct(model.ours.share)}');
        expect(out).not.toContain('Záložní kopie originálu');
        expect(out).toContain('Postaveno na kódu jsemfast/pirati-vysledky-2026 · správce: Václav Vislous');
        expect(out).toContain('pražských výsledcích 2022');
        expect(out).not.toContain('na výsledcích 2022');
    });

    it('CouncilApp: the banner sits at the top of the overview column', () => {
        const out = applyPatches(COUNCIL_APP, read(COUNCIL_APP));
        const i = out.indexOf('const overview = (');
        const banner = out.indexOf('<MestaArrangement', i);
        const preCard = out.indexOf("model.snapshot.phase === 'pre'", i);
        expect(banner).toBeGreaterThan(i);
        expect(banner).toBeLessThan(preCard);
    });

    it('CouncilApp: map on town data — no 2022 precincts before counting, no map for an empty geojson', () => {
        const out = applyPatches(COUNCIL_APP, read(COUNCIL_APP));
        expect(out).not.toContain("fetchedAt: 'kv2022'");
        expect(out).not.toContain('komunální volby 2022</b>');
        expect(out).toContain('Ještě se nesčítá — okrsky se na mapě obarví, jakmile je sečte ČSÚ.');
        expect(out).toContain('const mapData = !!council.map && !!statics?.geoJson?.features?.length;');
        // mapSnapshot vždy vrací živý snapshot
        const i = out.indexOf('const mapSnapshot = useMemo(');
        const body = out.slice(i, out.indexOf('[snapshot, ready, statics, counted]', i));
        expect(body).toContain('        return snapshot;');
        expect(body).not.toContain('precincts2022');
    });

    it('ResultsMap: pending style, no per-precinct 2022 line in the tooltip, guard imports', () => {
        const out = applyPatches(RESULTS_MAP, read(RESULTS_MAP));
        expect(out).toContain("import { PENDING_FILL, isPending } from '../mesta/mapUi.js';");
        expect(out).toContain('if (isPending(o, modeId)) return');
        expect(out).toContain('fillColor: UNCOUNTED_FILL'); // nesečtené zůstávají šedé
        expect(out).toContain("const then = base && !(activeCouncil().precinctHistory === false) ? baselineShare(");
        expect(out).toContain("okrsek ? 'sečteno — hlasy se dotahují' : 'čeká na sečtení'");
    });

    it('Precincts: 2022 comparisons off for precinctHistory:false, Pirate mode named after a joint list', () => {
        const out = applyPatches(PRECINCTS, read(PRECINCTS));
        expect(out).toContain('const ourBaseline = () => (activeCouncil().precinctHistory === false ? null :');
        expect(out).toContain('const r22 = activeCouncil().precinctHistory === false ? null :');
        expect(out).toContain('meta.baseline && !(activeCouncil().precinctHistory === false) ?');
        expect(out).toContain("{m.id === 'ours' ? oursButtonLabel(partyMeta(ourId()), m.label) : m.label}");
        expect(out).toContain('PENDING_FILL');
        // původní texty o 2022 zůstávají pro Prahu, jen podmíněně
        expect(out).toContain('Změna = proti předchůdci kandidátky v KV 2022 v tomto okrsku.');
        expect(out).toContain("{!(activeCouncil().precinctHistory === false) && <div");
    });

    it('Councilors: coalition-neutral heading', () => {
        const out = applyPatches(COUNCILORS, read(COUNCILORS));
        expect(out).toContain('Kandidátka s Piráty — prvních 10.');
        expect(out).not.toContain('Pirátská kandidátka — prvních 10.');
    });

    it('WelcomeGuide: no "v Praze", no "MČ"', () => {
        const out = applyPatches(WELCOME, read(WELCOME));
        expect(out).not.toContain('v Praze');
        expect(out).toContain('komunálních voleb 2026 ve městech');
        expect(out).toContain('pro celé město typické');
    });

    it('ElectionHeader: other towns', () => {
        const out = applyPatches(HEADER, read(HEADER));
        expect(out).toContain('Ostatní města');
        expect(out).not.toContain('Ostatní městské části');
    });

    it('leaves an unrelated file unchanged', () => {
        const code = read('src/pages/Landing.jsx');
        expect(applyPatches('src/pages/Landing.jsx', code)).toBe(code);
        expect(applyPatches('src/mesta/whatever.js', 'x')).toBe('x');
    });

    it('accepts Windows separators and ids with a query', () => {
        const out = applyPatches('src\\components\\Councilors.jsx', read(COUNCILORS));
        expect(out).toContain('Kandidátka s Piráty');
    });
});

describe('applyPatches failure modes', () => {
    it('throws when an anchor is missing', () => {
        expect(() => applyPatches(COUNCILORS, 'nothing here')).toThrow(/0×/);
    });

    it('throws when an anchor is duplicated', () => {
        const code = read(COUNCILORS);
        expect(() => applyPatches(COUNCILORS, code + '\n' + code)).toThrow(/2×/);
    });

    it('does not re-scan its own output (replacement containing the anchor is safe)', () => {
        const out = applyPatches(COUNCILORS, read(COUNCILORS));
        expect(count(out, 'Kandidátka s Piráty — prvních 10.')).toBe(1);
    });
});

describe('index.html patches', () => {
    const html = read('index.html');

    it('every anchor occurs exactly once', () => {
        for (const p of HTML_PATCHES) expect(count(html, p.from), p.from).toBe(1);
    });

    it('swaps entry, title and description; Prague entry is gone', () => {
        const out = applyHtmlPatches(html);
        expect(out).toContain('src="/src/mesta/main.jsx"');
        expect(out).not.toContain('"/src/main.jsx"');
        expect(out).toContain('<title>Volby 2026 · Piráti ve městech</title>');
        expect(out).not.toContain('Piráti Praha');
        expect(out).not.toContain('Praha 3, Praha 6, Praha 11');
        expect(out).toMatch(/<meta name="description" content="[^"]*městech/);
    });

    it('leaves no Prague "backup copy" wording in the HTML, keeps the phone and the tel: link', () => {
        const out = applyHtmlPatches(html);
        expect(out).not.toContain('Záložní kopie');
        expect(out).not.toContain('spravuje tuto kopii');
        expect(out).toContain('<!-- Postaveno na kódu jsemfast/pirati-vysledky-2026 · správce: Václav Vislous, +420 777 954 389 -->');
        expect(out).toContain('Postaveno na kódu jsemfast/pirati-vysledky-2026 · správce: Václav Vislous ·');
        expect(out).toContain('<a href="tel:+420777954389" style="color:inherit">777 954 389</a>');
    });

    it('throws on a missing anchor', () => {
        expect(() => applyHtmlPatches('<html></html>')).toThrow(/0×/);
    });
});

describe('mesta changelog', () => {
    it('has one entry in Prague\'s shape and a mesta- version', () => {
        expect(APP_VERSION).toMatch(/^mesta-/);
        expect(CHANGELOG).toHaveLength(1);
        const [entry] = CHANGELOG;
        expect(entry.version).toBe(APP_VERSION);
        expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(entry.title).toContain('Piráti ve městech'); // značka, kterou hledá mesta-build-check
        for (const item of entry.items) {
            expect(['new', 'improved', 'fixed']).toContain(item.type);
            expect(item.text.length).toBeGreaterThan(0);
        }
    });
});
