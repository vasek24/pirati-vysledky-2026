import { describe, it, expect } from 'vitest';
import {
    bandOf, jmsezMismatch, jmsezPirates, toCsv, renderSpecificsTable, renderVerification, extractFiles, reportRows,
} from './reports.js';

const LIST = { id: 3, name: 'Piráti a Nezávislí', short: 'Piráti a Nezávislí', short8: 'Piráti+NK', vstrana: 541, kind: 'association', partners: [], independents: true, nominatedNonMembers: 0 };
const row = (o = {}) => ({
    kraj: 2100, krajName: 'Středočeský kraj', name: 'Alfa', zastup: 1001, okres: 2101, druh: 2, population: 20000, population2025: 19900,
    onOwnerList: true, published: true, inclusion: 'auto', reason: 'population 20000, type b', borderlineReason: '', reasonText: '',
    type: 'b', list: LIST, members: [{ list: 3, n: 1, name: 'Jan Novák' }], others: [], flags: [], confidence: 'high', hidden: false,
    slozeni: '080,720', vstrana: 541, note: '', ...o,
});
const meta = {
    fetchedAt: '2026-10-10T10:00:00.000Z',
    sources: [{ key: 'reg', label: 'Registr KV 2026', url: 'https://example.cz/reg.zip', sha256: 'a'.repeat(64), fetchedAt: '2026-10-10T09:00:00.000Z' }],
    pop2025: { ok: true },
    jmsez: { status: 'ok', fetched: 3, failed: [] },
};

describe('bandOf', () => {
    it('splits at 7 000 and 10 000', () => {
        expect(bandOf(9980)).not.toBe(bandOf(10050));
        expect(bandOf(10000)).toBe(bandOf(50000));
        expect(bandOf(6999)).not.toBe(bandOf(7000));
        expect(bandOf(7000)).toBe(bandOf(9999));
    });
});

describe('jmsezMismatch / jmsezPirates', () => {
    const jmsez = {
        platni: {
            3: { stranaNazev: 'X', seznam: [[1, 'Novák Jan', 40, 'Piráti', 'Piráti'], [2, 'Dvořák Petr', 41, 'Piráti', 'BEZPP']] },
            5: { stranaNazev: 'Y', seznam: [[7, 'Zykán Lukáš', 44, 'STAN', 'Piráti']] },
        },
    };
    it('lists rows labelled Piráti with their list and position', () => {
        expect(jmsezPirates(jmsez).map((r) => [r.list, r.n, r.name])).toEqual([[3, 1, 'Novák Jan'], [5, 7, 'Zykán Lukáš']]);
        expect(jmsezPirates(null)).toEqual([]);
    });
    it('is false when every Piráti label is a member or other', () => {
        const spec = { members: [{ list: 3, n: 1 }], others: [{ list: 5, n: 7 }] };
        expect(jmsezMismatch(jmsez, spec)).toBe(false);
    });
    it('is true when a Piráti label is missing from members and others', () => {
        expect(jmsezMismatch(jmsez, { members: [{ list: 3, n: 1 }], others: [] })).toBe(true);
        expect(jmsezMismatch(jmsez, { members: [], others: [{ list: 5, n: 7 }] })).toBe(true);
    });
    it('is true when a registry member is not labelled Piráti in jmsez (reverse direction)', () => {
        const spec = { members: [{ list: 3, n: 1 }, { list: 3, n: 2 }], others: [{ list: 5, n: 7 }] }; // 3:2 je v jmsez BEZPP
        expect(jmsezMismatch(jmsez, spec)).toBe(true);
        expect(jmsezMismatch(jmsez, { members: [{ list: 3, n: 1 }, { list: 3, n: 99 }], others: [{ list: 5, n: 7 }] })).toBe(true); // pozice 99 v jmsez není
    });
    it('only members count in the reverse direction: others and nominated non-members need no label', () => {
        const spec = { members: [{ list: 3, n: 1 }], others: [{ list: 5, n: 7 }, { list: 5, n: 8 }] }; // 5:8 v jmsez nemá štítek
        expect(jmsezMismatch(jmsez, spec)).toBe(false);
    });
    it('unknown stays unknown: no platni, or a list without data in jmsez, is not a mismatch', () => {
        const spec = { members: [{ list: 3, n: 1 }, { list: 9, n: 1 }], others: [{ list: 5, n: 7 }] }; // kandidátka 9 v jmsez chybí
        expect(jmsezMismatch(jmsez, spec)).toBe(false);
        expect(jmsezMismatch({ platni: {} }, spec)).toBe(false);
        expect(jmsezMismatch({}, spec)).toBe(false);
        expect(jmsezMismatch({ platni: { 9: { seznam: [] } } }, spec)).toBe(false);
    });
    it('no jmsez -> no mismatch', () => {
        expect(jmsezMismatch(null, { members: [], others: [] })).toBe(false);
    });
});

describe('toCsv', () => {
    it('quotes commas, quotes and newlines and fills missing columns', () => {
        expect(toCsv(['A', 'B'], [{ A: 'x,y', B: 'say "hi"' }, { A: 1 }])).toBe('A,B\n"x,y","say ""hi"""\n1,\n');
    });
});

describe('renderVerification', () => {
    const confirmed = [row({ name: 'Alfa' }), row({ name: 'Nové Město na Moravě', zastup: 5, population: 9716, inclusion: 'borderline-included', borderlineReason: 'na seznamu majitele' })];
    const rejected = [
        row({ name: 'Sokolov', zastup: 9, published: false, inclusion: 'excluded', type: 'c', list: null, reasonText: 'typ c: Piráti jen na cizích kandidátkách (21 908 obyvatel)' }),
        row({ name: 'Litovel', zastup: 10, published: false, inclusion: 'excluded', onOwnerList: false, type: 'd', list: null, population: 9448, reasonText: 'typ d: Piráti tu nekandidují', note: 'Senát: obvod 66 – Litovel' }),
    ];
    const added = [row({ name: 'Klatovy', zastup: 7, onOwnerList: false })];
    const borderlineExcluded = [row({ name: 'Tišnov', zastup: 8, published: false, inclusion: 'borderline-excluded', population: 8000, onOwnerList: false })];
    const md = renderVerification({ confirmed, rejected, added, borderlineExcluded, notes: ['Pozn. 1'] }, meta);

    it('has the three headed tables and the borderline_reason column', () => {
        expect(md).toMatch(/^## 1\. .*potvrzen/im);
        expect(md).toMatch(/^## 2\. .*zamítnut/im);
        expect(md).toMatch(/^## 3\. .*nejsou na vašem seznamu/im);
        expect(md.match(/borderline_reason/g).length).toBeGreaterThanOrEqual(3);
        expect(md).toContain('na seznamu majitele');
    });
    it('counts: owner names = confirmed + rejected from the list; Litovel is outside the 88', () => {
        expect(md).toMatch(/potvrzeno: 2/);
        expect(md).toMatch(/zamítnuto z vašeho seznamu: 1/);
        expect(md).toMatch(/na vašem seznamu celkem: 3/);
        expect(md).toMatch(/Litovel[^\n]*mimo soubor seznamu/);
    });
    it('Litovel row carries the reason and the Senate note', () => {
        const line = md.split('\n').find((l) => l.includes('Litovel') && l.startsWith('|'));
        expect(line).toMatch(/Senát/);
        expect(line).toMatch(/typ d/);
    });
    it('lists borderline-excluded towns and the notes', () => {
        expect(md).toMatch(/Tišnov/);
        expect(md).toMatch(/Pozn\. 1/);
        expect(md).toMatch(/Klatovy/);
    });
});

describe('renderSpecificsTable', () => {
    const rows = [
        row({ name: 'Alfa', zastup: 1, members: [{ list: 3, n: 1, name: 'A' }, { list: 3, n: 2, name: 'B' }, { list: 3, n: 3, name: 'C' }, { list: 3, n: 4, name: 'D' }] }),
        row({ name: 'Mikulov', zastup: 584649, population: 7552, inclusion: 'borderline-included', borderlineReason: 'Piráti 2022: 8,4 %, 2 mand.', onOwnerList: false, flags: ['borderline-auto'], confidence: 'low', hidden: true }),
        row({ name: 'Náchod', zastup: 3, members: [], list: { ...LIST, nominatedNonMembers: 7 }, flags: ['no-members-on-pirate-list'] }),
        row({ name: 'Klatovy', zastup: 4, onOwnerList: false }),
        row({ name: 'Sokolov', zastup: 9, published: false, inclusion: 'excluded', type: 'c', list: null, members: [], others: [{ list: 2, listName: 'STAN', n: 5, name: 'Zykán Lukáš', nominatedBy: 'STAN' }], reasonText: 'typ c: jen na cizích kandidátkách (21 908 obyvatel)' }),
        row({ name: 'Tišnov', zastup: 8, published: false, inclusion: 'borderline-excluded', population: 8000, onOwnerList: false, reasonText: 'hraniční, bez důvodu' }),
    ];
    const md = renderSpecificsTable(rows, meta);

    it('starts with a Czech intro: what it is, columns, confidence low/hidden, overrides example', () => {
        const head = md.slice(0, md.indexOf('## K rozhodnutí vlastníka'));
        expect(head).toMatch(/^# /);
        expect(head).toMatch(/Jak číst sloupce/);
        expect(head).toMatch(/jistota/);
        expect(head).toMatch(/skryt/);
        expect(head).toContain('src/mesta/overrides.js');
        expect(head).toMatch(/```js[\s\S]*name: 'Mikulov'[\s\S]*```/);
        expect(head).toContain("'598933': { name: 'Český Těšín', include: false");
        expect(head).not.toMatch(/Litovel/);
        expect(head).not.toMatch(/spec §|KODZASTUP|confidence/);
        expect(head).toMatch(/reviewed: true/);
    });
    it('has counts per inclusion and type', () => {
        expect(md).toMatch(/\| zařazeno automaticky \| 3 \|/);
        expect(md).toMatch(/\| zařazeno podle úsudku \| 1 \|/);
        expect(md).toMatch(/\| typ b \| 4 \|/);
    });
    it('K rozhodnutí vlastníka lists the decision groups', () => {
        const sec = md.slice(md.indexOf('## K rozhodnutí vlastníka'), md.indexOf('## Tabulka'));
        expect(sec).toMatch(/Mikulov/);
        expect(sec).toMatch(/Tišnov/);
        expect(sec).toMatch(/Klatovy/);
        expect(sec).toMatch(/Sokolov/);
        expect(sec).toMatch(/Zobrazit nominované nečleny\?/);
        expect(sec).toMatch(/Náchod[^\n]*7/);
        expect(sec).not.toMatch(/Alfa/);
    });
    it('main table: published first, then excluded owner-list towns; members count with first 3 names', () => {
        const table = md.slice(md.indexOf('## Tabulka'));
        expect(table.indexOf('Alfa')).toBeLessThan(table.indexOf('Sokolov'));
        expect(table).toMatch(/Alfa[^\n]*4 \(A, B, C, \+1\)/);
        expect(table).toMatch(/20 000 \/ 19 900/);
        expect(table).toMatch(/nízká \(skryto\)/);
        expect(table).toMatch(/\| sdružení \|/);
        expect(table).toMatch(/hraniční, zařazeno jen automaticky/);
        expect(table).not.toMatch(/\| Tišnov/);
    });
    it('escapes pipes in cell text', () => {
        const out = renderSpecificsTable([row({ name: 'A|B' })], meta);
        expect(out).toContain('A\\|B');
    });
});

describe('renderSpecificsTable: new groups and wording', () => {
    const off = row({
        name: 'Broumov', zastup: 573922, published: false, inclusion: 'excluded', population: 6998, population2025: 7108, onOwnerList: false, offBand: true,
        p2022: { pct: 8.35, seats: 2 }, reasonText: '6 998 obyvatel (pod hranicí 7 000)',
    });
    const rows = [row({ name: 'Alfa' }), off, row({ name: 'Náchod', zastup: 3, members: [], list: { ...LIST, nominatedNonMembers: 2 } })];

    it('group 4 lists off-band towns generically with 2026/2025, 2022 result, list name and a ready snippet', () => {
        const md = renderSpecificsTable(rows, meta);
        const g = md.slice(md.indexOf('### 4. Těsně pod hranicí 7 000'), md.indexOf('### 5.'));
        expect(g).toMatch(/Broumov[^\n]*6 998 \/ 7 108[^\n]*Piráti a Nezávislí[^\n]*Piráti 2022: 8,4 %, 2 mand\./);
        expect(g).toContain("'573922': { name: 'Broumov', include: true, reason: 'Piráti 2022: 8,4 %, 2 mand.; 7 108 obyvatel k 1. 1. 2025' },");
        expect(g).toMatch(/include: true/);
    });
    it('group 4 empty -> "Žádné"; group 8 does not claim all is fine while group 4 is open', () => {
        const none = renderSpecificsTable([row({ name: 'Alfa' })], meta);
        expect(none.slice(none.indexOf('### 4.'), none.indexOf('### 5.'))).toMatch(/_Žádné\._/);
        expect(none.slice(none.indexOf('### 8.'))).not.toMatch(/Otevřená zůstává/);
        const open = renderSpecificsTable(rows, meta);
        expect(open.slice(open.indexOf('### 8.'), open.indexOf('## Zdroje'))).toMatch(/Otevřená zůstává skupina 4/);
    });
    it('nominated non-members wording and the auto-borderline heading with the real reason', () => {
        const md = renderSpecificsTable([...rows, row({ name: 'Mikulov', zastup: 9, inclusion: 'borderline-included', borderlineReason: 'Piráti 2022: 8,4 %, 2 mand.', flags: ['borderline-auto'], confidence: 'low', hidden: true })], meta);
        expect(md).toContain('z Pirátů jsou na ní jen lidé, které Piráti navrhli, ale nejsou členy');
        expect(md).toMatch(/Sama kandidátka je přesto stále označená jako pirátská/);
        expect(md).toMatch(/### 1\. Hraniční města zařazená automaticky \(skrytá\): důvodem je výsledek Pirátů v roce 2022/);
    });
    it('borderline-excluded points to borderlineReason; no 2022 list reads "bez pirátské kandidátky"', () => {
        const md = renderSpecificsTable([row({ name: 'Tišnov', zastup: 8, published: false, inclusion: 'borderline-excluded', onOwnerList: false, reasonText: '9 270 obyvatel, bez důvodu k zařazení; Piráti 2022: bez pirátské kandidátky' })], meta);
        const g = md.slice(md.indexOf('### 3.'), md.indexOf('### 4.'));
        expect(g).toMatch(/borderlineReason/);
        expect(g).not.toMatch(/include: true/);
        expect(g).toMatch(/Piráti 2022: bez pirátské kandidátky/);
    });
});

describe('reportRows', () => {
    const council = (zastup, name, population) => ({ zastup, name, kraj: 2100, krajName: 'Středočeský kraj', okres: 2101, druh: 2, population });
    const cls = (type, list = null) => ({ type, list, members: [], others: [], flags: [] });
    const res = {
        records: [
            { council: council(1, 'Alfa', 20000), cls: cls('b', LIST), reasons: [], dec: { inclusion: 'auto', reason: 'population 20000, type b' }, flags: [], onOwnerList: true, listRow: { VSTRANA: '541', SLOZENI: '080,720' } },
            { council: council(2, 'Beta', 8000), cls: cls('b', LIST), reasons: [{ text: 'sídlo okresu Beta' }], dec: { inclusion: 'borderline-included', reason: 'sídlo okresu Beta' }, flags: ['borderline-auto'], onOwnerList: false, listRow: null },
            { council: council(3, 'Gama', 21908), cls: cls('c'), reasons: [], dec: { inclusion: 'excluded', reason: 'type c' }, flags: [], onOwnerList: true, listRow: null },
            { council: council(4, 'Delta', 7500), cls: cls('b', LIST), reasons: [], dec: { inclusion: 'borderline-excluded', reason: 'borderline, no reason' }, flags: [], onOwnerList: false, listRow: null },
            { council: council(5, 'Eta', 12000), cls: cls('d'), reasons: [], dec: { inclusion: 'excluded', reason: 'type d' }, flags: [], onOwnerList: false, listRow: null },
        ],
        towns: [{ zastup: 1, population: 20000, populationCsu2025: 19990 }, { zastup: 2, population: 8000, populationCsu2025: null }],
        specifics: [
            { zastup: 1, type: 'b', confidence: 'high', list: LIST, members: [], others: [], flags: ['dash-normalized'] },
            { zastup: 2, type: 'b', confidence: 'low', list: LIST, members: [], others: [], flags: ['borderline-auto'] },
        ],
        pirates2022: new Map([[4, { pct: 4.1, seats: 0 }]]),
    };
    const rows = reportRows(res, { overrides: { reviewedAt: null, towns: {} }, extra: { 5: 'poznámka' } });

    it('keeps published, owner-list, borderline-excluded and extra towns only', () => {
        expect(rows.map((r) => r.name)).toEqual(['Alfa', 'Beta', 'Gama', 'Delta', 'Eta']);
        expect(reportRows(res, { overrides: { reviewedAt: null, towns: {} } }).map((r) => r.name)).toEqual(['Alfa', 'Beta', 'Gama', 'Delta']);
    });
    it('fills borderline_reason only for borderline towns, hidden from confidence, 2025 population and source columns', () => {
        const [alfa, beta, gama, delta, eta] = rows;
        expect(alfa).toMatchObject({ published: true, borderlineReason: '', hidden: false, population2025: 19990, slozeni: '080,720', vstrana: 541, flags: ['dash-normalized'] });
        expect(beta).toMatchObject({ published: true, borderlineReason: 'sídlo okresu Beta', hidden: true, confidence: 'low' });
        expect(gama).toMatchObject({ published: false, type: 'c', onOwnerList: true });
        expect(gama.reasonText).toMatch(/typ c/);
        expect(gama.reasonText).toMatch(/21 908/);
        expect(delta.reasonText).toMatch(/Piráti 2022: 4,1 %, 0 mand\./);
        expect(eta.note).toBe('poznámka');
    });
    it('flags an unpublished a/b town below 7 000 in 2026 and at/above 7 000 in 2025 (offBand), generically', () => {
        const more = {
            ...res,
            records: [...res.records, { council: council(6, 'Zeta', 6990), cls: cls('b', LIST), reasons: [], dec: { inclusion: 'excluded', reason: 'population 6990' }, flags: [], onOwnerList: false, listRow: null },
                { council: council(7, 'Eta2', 6990), cls: cls('d'), reasons: [], dec: { inclusion: 'excluded', reason: 'population 6990' }, flags: [], onOwnerList: false, listRow: null },
                { council: council(8, 'Theta', 6900), cls: cls('b', LIST), reasons: [], dec: { inclusion: 'excluded', reason: 'population 6900' }, flags: [], onOwnerList: false, listRow: null }],
            pop2025: new Map([[6, { name: 'Zeta', population: 7001 }], [7, { name: 'Eta2', population: 7100 }], [8, { name: 'Theta', population: 6950 }]]),
            pirates2022: new Map([[6, { pct: 9.1, seats: 1 }]]),
        };
        const out = reportRows(more, { overrides: { reviewedAt: null, towns: {} } }).filter((r) => r.offBand);
        expect(out.map((r) => r.name)).toEqual(['Zeta']);
        expect(out[0]).toMatchObject({ population: 6990, population2025: 7001, p2022: { pct: 9.1, seats: 1 } });
    });
    it('a reviewedAt in overrides un-hides a generator-low town', () => {
        const un = reportRows(res, { overrides: { reviewedAt: '2026-10-10', towns: {} } });
        expect(un[1].hidden).toBe(false);
    });
});

describe('extractFiles', () => {
    const kvrzcoco = [
        { KRAJ: '2100', OKRES: '2101', TYPZASTUP: '1', DRUHZASTUP: '2', KODZASTUP: '1001', NAZEVZAST: 'Alfa', POCOBYV: '20000', MINOKRSEK1: '1', MAXOKRSEK1: '5' },
        { KRAJ: '2100', OKRES: '2101', TYPZASTUP: '1', DRUHZASTUP: '2', KODZASTUP: '1001', NAZEVZAST: 'Alfa', POCOBYV: '20000', MINOKRSEK2: '6', MAXOKRSEK2: '8' },
        { KRAJ: '1100', OKRES: '1100', TYPZASTUP: '1', DRUHZASTUP: '4', KODZASTUP: '554782', NAZEVZAST: 'Praha', POCOBYV: '1397880', MINOKRSEK1: '1', MAXOKRSEK1: '9' },
        { KRAJ: '1100', OKRES: '1100', TYPZASTUP: '2', DRUHZASTUP: '5', KODZASTUP: '500001', NAZEVZAST: 'Praha 1', POCOBYV: '30000', MINOKRSEK1: '1', MAXOKRSEK1: '2' },
        { KRAJ: '2100', OKRES: '2101', TYPZASTUP: '1', DRUHZASTUP: '1', KODZASTUP: '1002', NAZEVZAST: 'Ves', POCOBYV: '300', MINOKRSEK1: '1', MAXOKRSEK1: '1' },
    ];
    const kv = (z, por, slozeni, extra = {}) => ({ OKRES: '2101', KODZASTUP: String(z), NAZEVZAST: 'Alfa', COBVODU: '1', POR_STR_HL: String(por), OSTRANA: '1', VSTRANA: '541', NAZEVCELK: 'Piráti, NK', ZKRATKAO30: 'P', ZKRATKAO8: 'P', POCSTR_SLO: '2', SLOZENI: slozeni, HLASY_STR: '', PROCHLSTR: '', MAND_STR: '', ...extra });
    const kvros = [kv(1001, 3, '080,720'), kv(1001, 4, '053', { VSTRANA: '53' }), kv(1002, 1, '053'), kv(555, 1, '720', { NAZEVZAST: 'Jinde' })];
    const kvrk = [
        { OKRES: '2101', KODZASTUP: '1001', COBVODU: '1', POR_STR_HL: '3', PORCISLO: '1', JMENO: 'Jan', PRIJMENI: 'Novák', PSTRANA: '720', NSTRANA: '720', PLATNOST: 'A', POVOLANI: 'x' },
        { OKRES: '2101', KODZASTUP: '1001', COBVODU: '1', POR_STR_HL: '4', PORCISLO: '2', JMENO: 'Eva', PRIJMENI: 'Nová', PSTRANA: '99', NSTRANA: '99', PLATNOST: 'A', POVOLANI: 'x' },
        { OKRES: '2101', KODZASTUP: '1001', COBVODU: '1', POR_STR_HL: '4', PORCISLO: '3', JMENO: 'Ota', PRIJMENI: 'Nový', PSTRANA: '99', NSTRANA: '720', PLATNOST: 'N', POVOLANI: 'x' },
    ];
    const src = {
        kvrzcoco, kvros, kvrk,
        cvs: [{ VSTRANA: '541', NAZEVCELK: 'Piráti, NK', TYPVS: 'D' }, { VSTRANA: '53', NAZEVCELK: 'ODS', TYPVS: 'S' }],
        cns: [{ NSTRANA: '80', ZKRATKAN8: 'NK' }, { NSTRANA: '720', ZKRATKAN8: 'Piráti' }, { NSTRANA: '53', ZKRATKAN8: 'ODS' }, { NSTRANA: '999', ZKRATKAN8: 'Nepoužito' }],
        cnumnuts: [{ NUMNUTS: '0', NUTS: 'CZ', NAZEVNUTS: 'Česká republika', KODCIS: '105', CHODNOTA: 'CZ' }, { NUMNUTS: '2100', NUTS: 'CZ020', NAZEVNUTS: 'Středočeský kraj', KODCIS: '108', CHODNOTA: 'CZ020' }, { NUMNUTS: '2101', NUTS: 'CZ0201', NAZEVNUTS: 'Benešov', KODCIS: '109', CHODNOTA: 'CZ0201' }, { NUMNUTS: '210123', NUTS: 'CZ0201x', NAZEVNUTS: 'Něco', KODCIS: '1', CHODNOTA: 'x' }],
        kvros2022: [
            { DATUMVOLEB: '20220923', OKRES: '2101', KODZASTUP: '1001', NAZEVZAST: 'Alfa', COBVODU: '1', POR_STR_HL: '2', VSTRANA: '541', NAZEVCELK: 'P', SLOZENI: '720', HLASY_STR: '10', PROCHLSTR: '11.7', MAND_STR: '2' },
            { DATUMVOLEB: '20240316', OKRES: '2101', KODZASTUP: '1001', NAZEVZAST: 'Alfa', COBVODU: '1', POR_STR_HL: '2', VSTRANA: '541', NAZEVCELK: 'P', SLOZENI: '720', HLASY_STR: '10', PROCHLSTR: '30', MAND_STR: '9' },
            { DATUMVOLEB: '20220923', OKRES: '2101', KODZASTUP: '1001', NAZEVZAST: 'Alfa', COBVODU: '1', POR_STR_HL: '5', VSTRANA: '53', NAZEVCELK: 'O', SLOZENI: '053', HLASY_STR: '10', PROCHLSTR: '40', MAND_STR: '9' },
        ],
        senate: { id: 'x', generovano: 't', obvody: [{ obvod: 66, nazevObvodu: 'Litovel', zvoleno: false }, { obvod: 3, nazevObvodu: 'Cheb', zvoleno: false }] },
        pop2025: new Map([[1001, { name: 'Alfa', population: 19990 }], [1002, { name: 'Ves', population: 310 }], [7777, { name: 'Velké', population: 8000 }], [8888, { name: 'Malé', population: 500 }]]),
        jmsez: new Map([[1001, { generovano: '2026-10-08T16:40:22', platni: { 3: { stranaNazev: 'P', seznam: [[1, 'Novák Jan', 40, 'Piráti', 'Piráti']] } } }]]),
    };
    const res = {
        towns: [{ zastup: 1001, name: 'Alfa', okres: 2101 }],
        specifics: [{ zastup: 1001, members: [{ list: 3, n: 1 }], others: [] }],
        records: [{ council: { zastup: 1001 }, onOwnerList: true, dec: { inclusion: 'auto' } }, { council: { zastup: 1002 }, onOwnerList: true, dec: { inclusion: 'excluded' } }],
        popAvailable: true,
    };
    const mt = { ...meta, jmsez: { status: 'ok', fetched: 1, failed: [] }, pop2025: { ok: true, sourceName: '1300722503.xlsx' } };
    const files = extractFiles({ src, res, meta: mt });

    it('writes the fixed file set', () => {
        expect(Object.keys(files).sort()).toEqual([
            'README.md', 'candidates-720.csv', 'cns.csv', 'councils.csv', 'cvs.csv', 'jmsez-pirati.json', 'lists-2022-720.csv', 'lists-720.csv',
            'lists.csv', 'pop-csu-2025.csv', 'regions-okresy.csv', 'senate-2026.json',
        ]);
    });
    it('councils.csv: one row per TYPZASTUP 1 council incl. Prague, precincts summed over rows, no district rows', () => {
        expect(files['councils.csv']).toBe([
            'KRAJ,OKRES,TYPZASTUP,DRUHZASTUP,KODZASTUP,NAZEVZAST,POCOBYV,precincts',
            '2100,2101,1,2,1001,Alfa,20000,8', '2100,2101,1,1,1002,Ves,300,1', '1100,1100,1,4,554782,Praha,1397880,9', '',
        ].join('\n'));
    });
    it('lists-720.csv: all nationwide rows with 720 in SLOZENI; lists.csv: all rows of towns in scope', () => {
        expect(files['lists-720.csv'].trim().split('\n').map((l) => l.split(',')[1])).toEqual(['KODZASTUP', '555', '1001']);
        expect(files['lists.csv'].trim().split('\n').map((l) => l.split(',')[1])).toEqual(['KODZASTUP', '1001', '1001', '1002']);
    });
    it('candidates-720.csv: PSTRANA or NSTRANA 720 only, with PLATNOST, no extra columns', () => {
        const lines = files['candidates-720.csv'].trim().split('\n');
        expect(lines[0]).toBe('OKRES,KODZASTUP,COBVODU,POR_STR_HL,PORCISLO,JMENO,PRIJMENI,PSTRANA,NSTRANA,PLATNOST');
        expect(lines).toHaveLength(3);
        expect(lines[2]).toBe('2101,1001,1,4,3,Ota,Nový,99,720,N');
    });
    it('lists-2022-720.csv: only the 2022 election with 720', () => {
        const lines = files['lists-2022-720.csv'].trim().split('\n');
        expect(lines).toHaveLength(2);
        expect(lines[1]).toContain('11.7');
    });
    it('cvs/cns: only the rows used; regions: regions and okresy; senate: names only', () => {
        expect(files['cvs.csv'].trim().split('\n').map((l) => l.split(',')[0])).toEqual(['VSTRANA', '53', '541']);
        expect(files['cns.csv'].trim().split('\n').map((l) => l.split(',')[0])).toEqual(['NSTRANA', '53', '80', '720']);
        expect(files['regions-okresy.csv'].trim().split('\n').map((l) => l.split(',')[0])).toEqual(['NUMNUTS', '2100', '2101']);
        expect(JSON.parse(files['senate-2026.json']).obvody).toEqual([{ obvod: 66, nazevObvodu: 'Litovel' }, { obvod: 3, nazevObvodu: 'Cheb' }]);
    });
    it('pop-csu-2025.csv: municipalities that matter (council >= 7 000 either way or in scope)', () => {
        const lines = files['pop-csu-2025.csv'].trim().split('\n');
        expect(lines[0]).toBe('KODOBCE,NAZEV,OBYVATEL');
        expect(lines.slice(1).map((l) => l.split(',')[0]).sort()).toEqual(['1001', '1002', '7777']);
    });
    it('jmsez-pirati.json: Piráti rows per published town, mismatch flag', () => {
        const j = JSON.parse(files['jmsez-pirati.json']);
        expect(j.status).toBe('ok');
        expect(j.towns['1001']).toMatchObject({ name: 'Alfa', okres: 2101, mismatch: false });
        expect(j.towns['1001'].rows).toEqual([{ list: 3, n: 1, name: 'Novák Jan', prislusnost: 'Piráti' }]); // bez věku a navrhovatele (data minimisation)
    });
    it('jmsez-pirati.json says not-run when the fetch was skipped', () => {
        const j = JSON.parse(extractFiles({ src: { ...src, jmsez: null }, res, meta: { ...mt, jmsez: { status: 'not-run', reason: 'síť nedostupná' } } })['jmsez-pirati.json']);
        expect(j).toMatchObject({ status: 'not-run', reason: 'síť nedostupná' });
        expect(j.towns).toBeUndefined();
    });
    it('README: source URLs, sha256, fetch time, filters', () => {
        const r = files['README.md'];
        expect(r).toContain('https://example.cz/reg.zip');
        expect(r).toContain('a'.repeat(64));
        expect(r).toContain('2026-10-10T09:00:00.000Z');
        expect(r).toMatch(/filter/i);
        expect(r).toContain('jmsez');
    });
    it('is deterministic', () => {
        expect(extractFiles({ src, res, meta: mt })).toEqual(files);
    });
});
