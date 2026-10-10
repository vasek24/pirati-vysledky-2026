import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createJsonCache, createKvFeed, pathsFor } from './feed.js'
import { createOverviewFeed } from './overview.js'

const BASE = 'https://csu.test'
const T0 = Date.parse('2026-10-10T16:00:00+02:00')

// Ručně psaný JSON ve tvaru ČSÚ (viz komentáře u normalizeResults v feed.js)
const council = { zastup: 111, okres: 1100, seats: 15, precincts: 5, pirates: 1, precinctFiles: false }
const council2 = { zastup: 222, okres: 1100, seats: 15, precincts: 5, pirates: 1, precinctFiles: false }

const resultsJson = (counted = 2, votes = 600) => ({
    generovano: '10.10.2026 16:00:00',
    zvoleno: false,
    prehled: [15, 1, 5, counted, (counted / 5) * 100, 1000, 700, 70, 0, 700, 700, 100, 700],
    vysledky: [
        [1, 'Piráti', votes, 60, 15, 0, 0],
        [2, 'Ostatní', 100, 40, 15, 0, 0],
    ],
    hlasy: {},
})
const turnoutJson = () => ({
    generovano: '10.10.2026 16:00:10',
    okrsky: [[1, 1000, 700, 70, 0, 700, 700, 100, 700, null]],
})

// Falešný volby.gov.cz: path -> { body, etag, status, reject }; podmíněné dotazy
// přes If-None-Match, každý dotaz se zaznamená do calls
function fakeCsu(files) {
    const calls = []
    const fetchImpl = async (url, init = {}) => {
        const path = url.slice(BASE.length + 1)
        const headers = init.headers || {}
        calls.push({ path, ifNoneMatch: headers['If-None-Match'] })
        const f = files[path]
        if (!f) return { status: 404, ok: false, headers: { get: () => null }, json: async () => ({}) }
        if (f.reject) throw new Error('network down')
        if (f.status && f.status !== 200) {
            return { status: f.status, ok: false, headers: { get: () => null }, json: async () => ({}) }
        }
        if (f.etag && headers['If-None-Match'] === f.etag) {
            return { status: 304, ok: false, headers: { get: () => null }, json: async () => ({}) }
        }
        return {
            status: 200,
            ok: true,
            headers: { get: (k) => (k.toLowerCase() === 'etag' ? f.etag || null : null) },
            json: async () => {
                if (f.badJson) throw new SyntaxError('Unexpected token <')
                return f.body
            },
        }
    }
    return { fetchImpl, calls }
}

const kvFiles = () => {
    const p = pathsFor(council)
    return { [p.results]: { body: resultsJson(), etag: '"r1"' }, [p.turnout]: { body: turnoutJson(), etag: '"t1"' } }
}
const overviewFiles = () => ({
    [pathsFor(council).results]: { body: resultsJson(), etag: '"a1"' },
    [pathsFor(council2).results]: { body: resultsJson(), etag: '"b1"' },
})

beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
})
afterEach(() => {
    vi.useRealTimers()
})

describe('createJsonCache: version() a invalidate()', () => {
    it('version() roste jen při HTTP 200 (ne při 304 ani při opakování z cache)', async () => {
        const files = { 'a.json': { body: { x: 1 }, etag: '"e"' } }
        const { fetchImpl, calls } = fakeCsu(files)
        const getJson = createJsonCache({ fetchImpl, baseUrl: BASE, minIntervalMs: 20000 })
        expect(getJson.version('a.json')).toBe(0)
        await getJson('a.json')
        expect(getJson.version('a.json')).toBe(1)
        await getJson('a.json') // v rámci minIntervalMs — z paměti
        expect(calls).toHaveLength(1)
        expect(getJson.version('a.json')).toBe(1)
        vi.setSystemTime(T0 + 25000)
        await getJson('a.json') // podmíněný dotaz → 304
        expect(calls).toHaveLength(2)
        expect(calls[1].ifNoneMatch).toBe('"e"')
        expect(getJson.version('a.json')).toBe(1)
        files['a.json'] = { body: { x: 2 }, etag: '"e2"' }
        vi.setSystemTime(T0 + 50000)
        await getJson('a.json')
        expect(getJson.version('a.json')).toBe(2)
    })

    it('invalidate() smaže záznam: další volání stahuje bez If-None-Match i uvnitř minIntervalMs', async () => {
        const { fetchImpl, calls } = fakeCsu({ 'a.json': { body: { x: 1 }, etag: '"e"' } })
        const getJson = createJsonCache({ fetchImpl, baseUrl: BASE, minIntervalMs: 20000 })
        await getJson('a.json')
        getJson.invalidate('a.json')
        await getJson('a.json')
        expect(calls).toHaveLength(2)
        expect(calls[1].ifNoneMatch).toBeUndefined()
        expect(getJson.version('a.json')).toBe(2) // 200, ne 304
    })
})

describe('createKvFeed: build()', () => {
    it('vrací snapshot s fetchId a exponuje { snapshot, build, invalidate }', async () => {
        const { fetchImpl } = fakeCsu(kvFiles())
        const feed = createKvFeed({ council, fetchImpl, baseUrl: BASE })
        expect(Object.keys(feed).sort()).toEqual(['build', 'invalidate', 'snapshot'])
        const snap = await feed.build()
        expect(snap.fetchId).toBe('1.1')
        expect(snap.zastup).toBe(111)
        expect(snap.parties).toHaveLength(2)
    })

    it('(a) build() hodí chybu při selhání (500 / síť / JSON / chybějící soubor), snapshot() vrací staré last jako stale', async () => {
        const files = kvFiles()
        const p = pathsFor(council)
        const { fetchImpl } = fakeCsu(files)
        const feed = createKvFeed({ council, fetchImpl, baseUrl: BASE })
        const first = await feed.snapshot()
        expect(first.stale).toBe(false)

        for (const broken of [{ status: 500 }, { reject: true }, { badJson: true, body: {} }]) {
            vi.setSystemTime(Date.now() + 25000) // po minIntervalMs i po záporné paměti selhání
            files[p.results] = { ...broken }
            await expect(feed.build()).rejects.toThrow()
            const again = await feed.snapshot()
            expect(again.stale).toBe(true)
            expect(again.error).toBeTruthy()
            expect(again.snapshot).toBe(first.snapshot)
        }

        vi.setSystemTime(Date.now() + 25000)
        delete files[p.results] // soubor zmizel (404)
        await expect(feed.build()).rejects.toThrow()
    })

    it('(a) build() hodí chybu i bez předchozího last, když selže turnout', async () => {
        const files = kvFiles()
        files[pathsFor(council).turnout] = { status: 500 }
        const { fetchImpl } = fakeCsu(files)
        const feed = createKvFeed({ council, fetchImpl, baseUrl: BASE })
        await expect(feed.build()).rejects.toThrow(/500/)
    })

    it('(b) fetchId se mění jen při novém HTTP 200 (opakování z cache i 304 ho nemění)', async () => {
        const files = kvFiles()
        const p = pathsFor(council)
        const { fetchImpl, calls } = fakeCsu(files)
        const feed = createKvFeed({ council, fetchImpl, baseUrl: BASE })
        const a = await feed.build()
        const b = await feed.build() // uvnitř minIntervalMs — replay
        expect(calls).toHaveLength(2)
        expect(b.fetchId).toBe(a.fetchId)

        vi.setSystemTime(T0 + 25000)
        const c = await feed.build() // podmíněné dotazy → 304
        expect(calls).toHaveLength(4)
        expect(c.fetchId).toBe(a.fetchId)

        files[p.results] = { body: resultsJson(3, 650), etag: '"r2"' }
        vi.setSystemTime(T0 + 50000)
        const d = await feed.build() // results 200, turnout 304
        expect(d.fetchId).toBe('2.1')
        expect(d.fetchId).not.toBe(a.fetchId)
    })

    it('(c) invalidate() vynutí při dalším build() nový dotaz bez If-None-Match', async () => {
        const { fetchImpl, calls } = fakeCsu(kvFiles())
        const feed = createKvFeed({ council, fetchImpl, baseUrl: BASE })
        await feed.build()
        vi.setSystemTime(T0 + 25000)
        await feed.build()
        expect(calls.slice(2).every((c) => c.ifNoneMatch)).toBe(true) // běžný průběh: podmíněně

        feed.invalidate()
        const before = calls.length
        const snap = await feed.build() // ani minIntervalMs ho neobejde
        const fresh = calls.slice(before)
        expect(fresh.map((c) => c.path).sort()).toEqual([pathsFor(council).results, pathsFor(council).turnout].sort())
        expect(fresh.every((c) => c.ifNoneMatch === undefined)).toBe(true)
        expect(snap.fetchId).toBe('2.2')
    })

    it('(d) build() nemění last: snapshot() před/po vrací totéž, build() ho nenaplní', async () => {
        const files = kvFiles()
        const p = pathsFor(council)
        const { fetchImpl } = fakeCsu(files)
        const feed = createKvFeed({ council, fetchImpl, baseUrl: BASE })

        // build() na čerstvém feedu nenastaví last → po selhání není co vrátit
        await feed.build()
        vi.setSystemTime(T0 + 25000)
        files[p.results] = { status: 500 }
        await expect(feed.snapshot()).rejects.toThrow()

        // snapshot() nastaví last; následný build() s novými daty ho nepřepíše
        files[p.results] = { body: resultsJson(2, 600), etag: '"r1"' }
        vi.setSystemTime(T0 + 50000)
        const s1 = await feed.snapshot()
        files[p.results] = { body: resultsJson(4, 900), etag: '"r9"' }
        vi.setSystemTime(T0 + 75000)
        const built = await feed.build()
        expect(built.precincts.counted).toBeGreaterThan(s1.snapshot.precincts.counted)
        files[p.results] = { status: 500 }
        vi.setSystemTime(T0 + 100000)
        const s2 = await feed.snapshot()
        expect(s2.stale).toBe(true)
        expect(s2.snapshot).toBe(s1.snapshot) // last je pořád z posledního snapshot(), ne z build()
    })

    it('(f) snapshot() zůstává beze změny: žádné fetchId, stale:false při úspěchu', async () => {
        const { fetchImpl } = fakeCsu(kvFiles())
        const feed = createKvFeed({ council, fetchImpl, baseUrl: BASE })
        const res = await feed.snapshot()
        expect(res.stale).toBe(false)
        expect(res.error).toBeNull()
        expect(res.snapshot).not.toHaveProperty('fetchId')
    })
})

describe('createOverviewFeed: build()', () => {
    const councils = [council, council2]

    it('vrací přehled s fetchId = součet verzí; exponuje { snapshot, build, invalidate }', async () => {
        const { fetchImpl } = fakeCsu(overviewFiles())
        const feed = createOverviewFeed({ councils, fetchImpl, baseUrl: BASE })
        expect(Object.keys(feed).sort()).toEqual(['build', 'invalidate', 'snapshot'])
        const snap = await feed.build()
        expect(snap.fetchId).toBe('2')
        expect(Object.keys(snap.councils).sort()).toEqual(['111', '222'])
        expect(snap.missing).toBe(0)
    })

    it('fetchId se mění jen při novém 200; invalidate() stahuje bez If-None-Match', async () => {
        const files = overviewFiles()
        const { fetchImpl, calls } = fakeCsu(files)
        const feed = createOverviewFeed({ councils, fetchImpl, baseUrl: BASE })
        const a = await feed.build()
        const b = await feed.build() // replay
        expect(calls).toHaveLength(2)
        expect(b.fetchId).toBe(a.fetchId)
        vi.setSystemTime(T0 + 25000)
        const c = await feed.build() // 304
        expect(c.fetchId).toBe(a.fetchId)
        files[pathsFor(council).results] = { body: resultsJson(3, 650), etag: '"a2"' }
        vi.setSystemTime(T0 + 50000)
        const d = await feed.build()
        expect(d.fetchId).toBe('3')

        feed.invalidate()
        const before = calls.length
        const e = await feed.build()
        expect(calls.slice(before)).toHaveLength(2)
        expect(calls.slice(before).every((x) => x.ifNoneMatch === undefined)).toBe(true)
        expect(e.fetchId).toBe('5')
    })

    it('(a) build() hodí chybu, když všechny souhrny selžou, i když v paměti zůstaly starší; snapshot() vrací staré last jako stale', async () => {
        const files = overviewFiles()
        const { fetchImpl } = fakeCsu(files)
        const feed = createOverviewFeed({ councils, fetchImpl, baseUrl: BASE })
        const first = await feed.snapshot()
        expect(first.stale).toBe(false)
        vi.setSystemTime(T0 + 25000)
        for (const c of councils) files[pathsFor(c).results] = { status: 500 }
        await expect(feed.build()).rejects.toThrow(/500/)
        const again = await feed.snapshot()
        expect(again.stale).toBe(true)
        expect(again.snapshot).toBe(first.snapshot)
    })

    it('(a) build() bez jediného souhrnu (síť) hodí chybu', async () => {
        const files = overviewFiles()
        for (const c of councils) files[pathsFor(c).results] = { reject: true }
        const { fetchImpl } = fakeCsu(files)
        const feed = createOverviewFeed({ councils, fetchImpl, baseUrl: BASE })
        await expect(feed.build()).rejects.toThrow('network down')
    })

    it('(d) build() nenastavuje last: po selhání snapshot() vrací přehled z posledního snapshot(), ne z build()', async () => {
        const files = overviewFiles()
        const { fetchImpl } = fakeCsu(files)
        const feed = createOverviewFeed({ councils, fetchImpl, baseUrl: BASE })
        const s1 = await feed.snapshot()
        files[pathsFor(council).results] = { body: resultsJson(4, 900), etag: '"a9"' }
        vi.setSystemTime(T0 + 25000)
        const built = await feed.build()
        expect(built.precincts.counted).toBeGreaterThan(s1.snapshot.precincts.counted)
        for (const c of councils) files[pathsFor(c).results] = { status: 500 }
        vi.setSystemTime(T0 + 50000)
        const s2 = await feed.snapshot()
        expect(s2.stale).toBe(true)
        expect(s2.snapshot).toBe(s1.snapshot)
    })

    it('(e) výchozí waitMs je 8000', async () => {
        const never = () => new Promise(() => {})
        const feed = createOverviewFeed({ councils, fetchImpl: never, baseUrl: BASE })
        let outcome = 'pending'
        feed.build().then(() => (outcome = 'ok'), () => (outcome = 'rejected'))
        await vi.advanceTimersByTimeAsync(7999)
        expect(outcome).toBe('pending')
        await vi.advanceTimersByTimeAsync(1)
        expect(outcome).toBe('rejected')
    })

    it('(f) snapshot() přehledu zůstává beze změny: žádné fetchId', async () => {
        const { fetchImpl } = fakeCsu(overviewFiles())
        const feed = createOverviewFeed({ councils, fetchImpl, baseUrl: BASE })
        const res = await feed.snapshot()
        expect(res.stale).toBe(false)
        expect(res.snapshot).not.toHaveProperty('fetchId')
    })
})
