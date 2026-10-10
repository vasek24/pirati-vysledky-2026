import { describe, expect, it } from 'vitest';
import {
    assertSafeBase,
    checkContact,
    checkKraj,
    checkLists,
    checkVersion,
    checkVolby,
    chunkRefs,
    createGate,
    entryScript,
    findPragueWording,
    formatReport,
    hasBacklink,
    parseArgs,
    pirateLogo,
    runPool,
    summarize,
} from './mesta-smoke.mjs';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const council = { slug: 'benesov', zastup: 529303, seats: 27, precincts: 23, pirates: 3 };

const goodVolby = () => ({
    payload: {
        zastup: 529303,
        seats: 27,
        precincts: { total: 23, counted: 0, pct: 0 },
        generated: '2026-10-08T16:39:23',
        phase: 'pre',
        refreshedAt: NOW - 60_000,
        nextRefreshAt: NOW + 240_000,
    },
    headers: { 'x-cache': 'HIT', 'x-server-now': String(NOW), 'content-type': 'application/json; charset=utf-8' },
    status: 200,
    bytes: 20_000,
});

describe('parseArgs', () => {
    it('reads base url, towns, concurrency and json', () => {
        expect(parseArgs(['https://x.example/', '--towns=a,b', '--concurrency=3', '--json'])).toEqual({
            baseUrl: 'https://x.example/', towns: ['a', 'b'], concurrency: 3, json: true,
        });
    });
    it('defaults and clamps concurrency to 1..4', () => {
        expect(parseArgs(['https://x.example']).concurrency).toBe(4);
        expect(parseArgs(['https://x.example', '--concurrency=99']).concurrency).toBe(4);
        expect(parseArgs(['https://x.example', '--concurrency=0']).concurrency).toBe(1);
    });
    it('accepts --json=path', () => {
        expect(parseArgs(['https://x.example', '--json=out.json']).json).toBe('out.json');
    });
    it('requires a base url', () => {
        expect(() => parseArgs([])).toThrow(/baseUrl/);
    });
});

describe('assertSafeBase', () => {
    it('returns the origin without a trailing slash', () => {
        expect(assertSafeBase('https://pirati-mesta-staging.vasek24.workers.dev/')).toBe('https://pirati-mesta-staging.vasek24.workers.dev');
    });
    it('refuses praha.dg12.cz in any form', () => {
        expect(() => assertSafeBase('https://praha.dg12.cz')).toThrow(/praha/);
        expect(() => assertSafeBase('https://PRAHA.dg12.cz:443/x')).toThrow(/praha/);
    });
    it('refuses non-http urls', () => {
        expect(() => assertSafeBase('ftp://x')).toThrow();
        expect(() => assertSafeBase('nonsense')).toThrow();
    });
});

describe('createGate', () => {
    it('spaces request starts by at least minGapMs even when called concurrently', async () => {
        const slept = [];
        const gate = createGate({ minGapMs: 100, now: () => 1000, sleep: async (ms) => { slept.push(ms); } });
        await Promise.all([gate(), gate(), gate()]);
        expect(slept).toEqual([100, 200]);
    });
    it('does not wait when enough time has passed', async () => {
        let t = 0;
        const slept = [];
        const gate = createGate({ minGapMs: 100, now: () => t, sleep: async (ms) => slept.push(ms) });
        await gate();
        t = 500;
        await gate();
        expect(slept).toEqual([]);
    });
});

describe('runPool', () => {
    it('never exceeds the concurrency and keeps result order', async () => {
        let active = 0;
        let peak = 0;
        const out = await runPool([1, 2, 3, 4, 5, 6], 2, async (n) => {
            active++;
            peak = Math.max(peak, active);
            await new Promise((r) => setTimeout(r, 5));
            active--;
            return n * 2;
        });
        expect(out).toEqual([2, 4, 6, 8, 10, 12]);
        expect(peak).toBe(2);
    });
});

describe('checkVolby', () => {
    it('accepts a good payload', () => {
        expect(checkVolby({ council, ...goodVolby(), nowMs: NOW })).toEqual([]);
    });
    it('reports every mismatch verbatim', () => {
        const r = goodVolby();
        Object.assign(r.payload, { zastup: 1, seats: 30, phase: 'weird', generated: 'nonsense' });
        r.payload.precincts.total = 24;
        const problems = checkVolby({ council, ...r, nowMs: NOW });
        expect(problems).toContain('zastup 1 != 529303');
        expect(problems).toContain('seats 30 != 27');
        expect(problems).toContain('precincts.total 24 != 23 (towns.generated.json)');
        expect(problems).toContain('phase "weird" is not one of pre|waiting|counting|final');
        expect(problems).toContain('generated "nonsense" does not parse with parseCsuTime');
    });
    it('flags non-200, oversized payload and missing headers', () => {
        const r = { ...goodVolby(), status: 503, bytes: 1_600_000, headers: {} };
        const problems = checkVolby({ council, ...r, nowMs: NOW });
        expect(problems).toContain('status 503, expected 200');
        expect(problems).toContain('payload 1600000 B >= 1500000 B');
        expect(problems).toContain('missing x-cache header');
        expect(problems).toContain('missing x-server-now header');
    });
    it('flags insane refreshedAt/nextRefreshAt', () => {
        const r = goodVolby();
        r.payload.nextRefreshAt = r.payload.refreshedAt - 1;
        expect(checkVolby({ council, ...r, nowMs: NOW }).join()).toMatch(/nextRefreshAt/);
        const r2 = goodVolby();
        r2.payload.refreshedAt = NOW + 3_600_000;
        expect(checkVolby({ council, ...r2, nowMs: NOW }).join()).toMatch(/refreshedAt/);
        const r3 = goodVolby();
        r3.payload.refreshedAt = NOW - 3 * 3_600_000;
        expect(checkVolby({ council, ...r3, nowMs: NOW }).join()).toMatch(/refreshedAt/);
    });
    it('reports a non-JSON body', () => {
        expect(checkVolby({ council, status: 200, headers: { 'x-cache': 'MISS', 'x-server-now': String(NOW) }, payload: null, bytes: 5, nowMs: NOW })).toContain('body is not a JSON object');
    });
});

describe('checkKraj', () => {
    const shard = { id: '62-1', zastups: [1, 2, 3] };
    const summary = (z, counted = 0, total = 5) => ({ z, counted, total });
    const good = (extra = {}) => ({
        status: 200,
        headers: { 'x-cache': 'HIT', 'x-server-now': String(NOW), 'content-type': 'application/json; charset=utf-8' },
        bytes: 2000,
        payload: { councils: { 1: summary(1), 2: summary(2), 3: summary(3) } },
        ...extra,
    });
    it('accepts a payload whose keys equal the shard membership', () => {
        expect(checkKraj({ shard, hidden: [], nowMs: NOW, ...good() })).toEqual([]);
    });
    it('reports missing, extra and hidden towns', () => {
        const r = good();
        delete r.payload.councils[2];
        r.payload.councils[9] = summary(9);
        const problems = checkKraj({ shard, hidden: [3], nowMs: NOW, ...r });
        expect(problems).toContain('councils missing: 2');
        expect(problems).toContain('councils unexpected: 9');
        expect(problems.some((p) => p.startsWith('hidden towns leak'))).toBe(false);
    });
    it('allows a hidden town in the shard only with neutral (pirates null) data', () => {
        const r = good();
        r.payload.councils[3] = { ...summary(3), pirates: null };
        expect(checkKraj({ shard, hidden: [3], nowMs: NOW, ...r })).toEqual([]);
        r.payload.councils[3] = { ...summary(3), pirates: { pct: 8, seats: 2 } };
        expect(checkKraj({ shard, hidden: [3], nowMs: NOW, ...r })).toContain('hidden towns leak Pirate figures: 3');
    });
    it('flags counted > total', () => {
        const r = good();
        r.payload.councils[1] = summary(1, 6, 5);
        expect(checkKraj({ shard, hidden: [], nowMs: NOW, ...r })).toContain('council 1: counted 6 > total 5');
    });
    it('flags non-200', () => {
        expect(checkKraj({ shard, hidden: [], nowMs: NOW, ...good({ status: 400 }) })).toContain('status 400, expected 200');
    });
});

describe('checkLists', () => {
    it('matches slug and zastup', () => {
        expect(checkLists(council, { slug: 'benesov', zastup: 529303 })).toEqual([]);
        expect(checkLists(council, { slug: 'x', zastup: 1 })).toEqual(['lists.slug "x" != "benesov"', 'lists.zastup 1 != 529303']);
        expect(checkLists(council, null)).toEqual(['lists.json is not a JSON object']);
    });
});

describe('pirateLogo', () => {
    const lists = { lists: [{ id: 1, logos: ['/media/a.webp'] }, { id: 3, logos: ['/media/p.webp?v=1', '/media/p2.webp'] }] };
    it('returns the first logo of the pirate list', () => {
        expect(pirateLogo(council, lists)).toEqual({ path: '/media/p.webp?v=1' });
    });
    it('explains why there is none', () => {
        expect(pirateLogo({ ...council, pirates: null }, lists)).toEqual({ skip: 'město nemá pirátskou kandidátku' });
        expect(pirateLogo(council, { lists: [{ id: 3, logos: [] }] })).toEqual({ error: 'pirate list 3 has no logos' });
        expect(pirateLogo(council, { lists: [] })).toEqual({ error: 'pirate list 3 not found in lists.json' });
    });
});

describe('findPragueWording', () => {
    it('finds forbidden phrases', () => {
        expect(findPragueWording('a Magistrát b Záložní kopie c praha.dg12.cz')).toEqual(['Magistrát', 'Záložní kopie', 'praha.dg12.cz']);
    });
    it('is clean on mesta text', () => {
        expect(findPragueWording('Volby 2026 · Piráti ve městech')).toEqual([]);
    });
});

describe('contact and version', () => {
    it('requires name and phone', () => {
        expect(checkContact('Name: Václav Vislous\nPhone: +420 777 954 389')).toEqual([]);
        expect(checkContact('nobody')).toEqual(['missing "Václav Vislous"', 'missing "+420 777 954 389"']);
    });
    it('requires mesta- version', () => {
        expect(checkVersion('{"version":"mesta-74b828b-b65de1"}')).toEqual([]);
        expect(checkVersion('{"version":"abc"}')).toEqual(['version "abc" does not start with "mesta-"']);
        expect(checkVersion('<html>')).toEqual(['version.json is not JSON']);
    });
});

describe('bundle inspection', () => {
    const html = '<script type="module" crossorigin src="/assets/index-AAA.js"></script>';
    it('finds the entry script', () => {
        expect(entryScript(html)).toBe('/assets/index-AAA.js');
        expect(entryScript('<html>')).toBeNull();
    });
    it('finds MestaIndex and CouncilApp chunk names in the entry', () => {
        const js = 'import("./MestaIndex-DxJpLQmH.js");x=["assets/CouncilApp-CyMJECQG.js","assets/CouncilApp-CyMJECQG.js"]';
        expect(chunkRefs(js)).toEqual({ MestaIndex: ['MestaIndex-DxJpLQmH.js'], CouncilApp: ['CouncilApp-CyMJECQG.js'] });
    });
    it('detects the backlink in JSX source and minified form', () => {
        expect(hasBacklink('<a href="https://volby.dg12.cz">')).toBe(true);
        expect(hasBacklink('r.jsx("a",{href:"https://volby.dg12.cz",children:1})')).toBe(true);
        expect(hasBacklink('href:"https://volby.dg12.cz/x"')).toBe(false);
        expect(hasBacklink('nothing')).toBe(false);
    });
});

describe('summarize / formatReport', () => {
    const results = [
        { check: 1, subject: '/', ok: true },
        { check: 1, subject: '/a', ok: false, problems: ['status 500, expected 200'] },
        { check: 2, subject: 'hidden x', ok: null, info: ['status 200'] },
    ];
    it('fails when any result failed', () => {
        expect(summarize(results)).toMatchObject({ pass: false, fail: 1, ok: 1, info: 1 });
        expect(summarize([results[0], results[2]])).toMatchObject({ pass: true });
    });
    it('prints per-check table, failures verbatim and a final line', () => {
        const text = formatReport(results, { 1: 'Stránky', 2: 'API' });
        expect(text).toMatch(/Stránky/);
        expect(text).toContain('/a: status 500, expected 200');
        expect(text).toContain('hidden x: status 200');
        expect(text.trim().split('\n').pop()).toBe('FAIL (1 selhání, 1 OK, 1 info)');
    });
});
