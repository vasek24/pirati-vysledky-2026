// Přehled všech pražských zastupitelstev (/, /api/prehled): za každé jen
// souhrnný soubor vysled/<okres>/<zastup>.json → stav sčítání, hlasy
// a mandáty stran a hlavně výsledek Pirátů. Okrsky ani kandidáti se
// neposílají (kromě Pirátů na jiných kandidátkách) — odpověď má pro všech
// 58 zastupitelstev pár KB.
//
// Stejně jako feed.js běží na serveru (api/prehled.js, podmíněně přes ETag)
// i v prohlížeči (záloha, jen zastupitelstva s Piráty) a v demu.
import { councilByZastup, KV_BASE_URL } from '../councils.js';
import { allocateSeats, computeOutcome } from './compute.js';
import { gaussFrom, mulberry32 } from './random.js';
import { createJsonCache, createLimiter, normalizeResults, pathsFor, phaseOf, sleep } from './feed.js';

export const OVERVIEW_VERSION = 1;

// Piráti na kandidátce jiného uskupení (councils.js pirateCandidates):
// preferenční hlasy a jestli by měli mandát (oficiálně, nebo náš odhad)
function pirateCandidatesOf(council, results) {
    if (!council.pirateCandidates?.length || !results.candidates) return null;
    const { councilors } = computeOutcome(results, { seats: results.seats });
    return council.pirateCandidates.map(({ list, n }) => {
        const c = councilors[list]?.ranked.find((x) => x.n === n);
        return { list, n, votes: c?.votes ?? null, seat: c ? c.seat : null, order: c?.order ?? null };
    });
}

// Souhrn jednoho zastupitelstva z normalizovaného výsledku (normalizeResults).
// Mandáty: oficiální, když je ČSÚ vyhlásil, jinak náš odhad (allocateSeats).
// parties: [[č. kandidátky, hlasy, mandáty], …] seřazené podle hlasů
export function summarizeCouncil(council, results) {
    const ourCandidates = pirateCandidatesOf(council, results);
    const alloc = allocateSeats(results.parties, { seats: results.seats });
    const official = !!results.official && results.parties.some((p) => p.seats !== null);
    const seatsOf = (p) => (official ? p.seats || 0 : alloc.byId[p.id]?.seats || 0);
    const sorted = [...results.parties].sort((a, b) => b.votes - a.votes || a.id - b.id);
    const counted = results.precincts.counted;
    const ours = council.pirates ? results.parties.find((p) => p.id === council.pirates) : null;
    const a = ours ? alloc.byId[ours.id] : null;
    return {
        z: council.zastup,
        generated: results.generated,
        phase: phaseOf({ counted, official }),
        counted,
        total: results.precincts.total,
        official,
        seats: results.seats,
        votes: alloc.total,
        turnout: results.turnout.pct,
        parties: sorted.map((p) => [p.id, p.votes, seatsOf(p)]),
        pirates: ours
            ? {
                id: ours.id,
                votes: ours.votes,
                pct: alloc.total ? a.share : null,
                seats: seatsOf(ours),
                passed: a.passed,
                rank: sorted.indexOf(ours) + 1,
                toNext: official ? null : a.toNext,
                margin: official ? null : a.margin,
                toThreshold: official ? null : a.toThreshold,
            }
            : null,
        ...(ourCandidates ? { pirateCandidates: ourCandidates } : {}),
    };
}

// Snapshot přehledu: souhrny + součty za městské části (Magistrát má stejné
// okrsky, do součtu se nepočítá). official = všechna zastupitelstva vyhlášená
// (expected = kolik jich má být — chybějící souhrn „konečné" nepustí).
export function composeOverview(summaries, { now = Date.now(), demo = false, expected = 1 } = {}) {
    const list = Object.values(summaries);
    const mc = list.filter((s) => !councilByZastup(s.z)?.magistrat);
    const counted = mc.reduce((s, x) => s + x.counted, 0);
    const total = mc.reduce((s, x) => s + x.total, 0);
    const official = list.length >= Math.max(1, expected) && list.every((s) => s.official);
    const phase = phaseOf({ counted, official }, now);
    return {
        v: OVERVIEW_VERSION,
        ...(demo ? { demo: true } : {}),
        fetchedAt: new Date(now).toISOString(),
        generated: list.map((s) => s.generated).filter(Boolean).sort().pop() || null,
        // demo začíná rovnou po uzavření místností
        phase: demo && phase === 'pre' ? 'waiting' : phase,
        precincts: { counted, total, pct: total ? (counted / total) * 100 : 0 },
        official,
        councils: summaries,
    };
}

// Živý přehled. Zastupitelstvo, jehož soubor zrovna selže, drží poslední
// známý souhrn; selžou-li všechna a nic v paměti není, build() hodí chybu.
// Neobnoví-li se nic (zdroj neodpovídá), vrací snapshot() poslední přehled
// jako stale.
export function createOverviewFeed({
    councils,
    fetchImpl = (...args) => fetch(...args),
    conditional = true,
    baseUrl = KV_BASE_URL,
    minIntervalMs = 20000,
    concurrency = 6,
    timeoutMs = 8000,
    // jak dlouho build() čeká na soubory, než vrátí přehled z toho, co má
    // (zbytek doběhne na pozadí a přibude příště) — 58 souborů po vlnách
    // s timeoutem by jinak přetáhlo maxDuration serverové funkce (30 s)
    waitMs = 8000,
    headers = {},
} = {}) {
    const getJson = createJsonCache({ fetchImpl, conditional, baseUrl, minIntervalMs, timeoutMs, headers });
    const limit = createLimiter(concurrency);
    const summaries = {};
    const pending = new Map(); // zastup -> běžící stažení (sdílí ho i další build)
    let last = null;
    let inflight = null;

    function refresh(c) {
        if (!pending.has(c.zastup)) {
            pending.set(c.zastup, limit(async () => {
                summaries[c.zastup] = summarizeCouncil(c, normalizeResults(await getJson(pathsFor(c).results), c));
            }).finally(() => pending.delete(c.zastup)));
        }
        return pending.get(c.zastup);
    }

    // Vnitřní build; `last` nemění. strict (pro build()): nic čerstvého = chyba
    // i bez `last` — v paměti zůstalé souhrny nesmí vypadat jako úspěch.
    async function buildSnapshot({ strict = false } = {}) {
        let updated = 0;
        let error = null;
        const jobs = councils.map((c) => refresh(c).then(
            () => {
                updated += 1;
            },
            (e) => {
                error ||= e;
            },
        ));
        await Promise.race([Promise.all(jobs), sleep(waitMs)]);
        if (!Object.keys(summaries).length) throw error || new Error('no-data');
        // Nic čerstvého → chyba, ať snapshot() vrátí poslední přehled jako
        // stale (ne stará data s novým fetchedAt a plnou dobou v CDN)
        if (!updated && (strict || last)) throw error || new Error('timeout');
        return {
            ...composeOverview({ ...summaries }, { expected: councils.length }),
            missing: councils.length - updated,
        };
    }

    const resultPaths = councils.map((c) => pathsFor(c).results);

    // Pro obnovu v Durable Objectu: hodí chybu při selhání, `last` nemění,
    // výsledek nese fetchId (součet verzí souborů — roste jen novým HTTP 200)
    async function build() {
        const snap = await buildSnapshot({ strict: true });
        return { ...snap, fetchId: String(resultPaths.reduce((sum, p) => sum + getJson.version(p), 0)) };
    }

    function invalidate() {
        for (const p of resultPaths) getJson.invalidate(p);
    }

    async function snapshot() {
        if (!inflight) {
            inflight = buildSnapshot().then((snap) => {
                last = snap;
                return snap;
            }).finally(() => {
                inflight = null;
            });
        }
        try {
            return { snapshot: await inflight, stale: false, error: null };
        } catch (error) {
            if (last) return { snapshot: last, stale: true, error };
            throw error;
        }
    }

    return { snapshot, build, invalidate };
}

// Demo přehledu (/?demo): každé zastupitelstvo se „sčítá" po svém (malé MČ
// rychle, velké déle), podíly vychází z KV 2022 s mírným posunem a během
// sčítání kolísají. Podklady = public/data/prehled.json. Čísla NEJSOU predikce.
export function createOverviewDemoFeed({ councils, statics, durationMs = 150000, seed = Date.now() }) {
    const rand = mulberry32(seed);
    const gauss = gaussFrom(rand);
    const startedAt = Date.now();
    const sims = councils.filter((c) => statics?.councils?.[c.zastup]).map((c) => {
        const st = statics.councils[c.zastup];
        const span = c.magistrat ? durationMs : durationMs * (0.35 + 0.5 * Math.min(1, c.precincts / 130));
        const start = 3000 + (c.magistrat ? 0 : rand() * (durationMs - span) * 0.7);
        // rozdělená kandidátka 2022 (bez pct2022) → dílem mezi nástupce (est2022)
        const raw = st.lists.map((l) => Math.max(0.004, ((l.pct2022 ?? l.est2022 ?? 3) / 100)
            * (l.id === c.pirates ? 1.06 : 1) * (1 + 0.1 * gauss())));
        const sum = raw.reduce((s, v) => s + v, 0);
        return {
            council: c,
            lists: st.lists,
            start,
            end: start + span,
            final: raw.map((v) => v / sum),
            wobble: st.lists.map(() => gauss()),
            votes: Math.max(1000, st.votes2022) * (1.03 + 0.05 * gauss()),
            turnout: 42 + 6 * gauss(),
            // preferenční hlasy jen pro kandidátky s Piráty z jiného uskupení
            prefs: Object.fromEntries(c.pirateCandidates.map(({ list }) => [list, Array.from(
                { length: st.lists.find((l) => l.id === list)?.candidates || c.seats },
                (_, i) => Math.max(0.3, 1 + (i === 0 ? 0.4 : 0) + 0.25 * gauss()),
            )])),
        };
    });
    const lastEnd = Math.max(...sims.map((s) => s.end), 0);

    function snapshotAt(now) {
        const elapsed = now - startedAt;
        const summaries = {};
        for (const s of sims) {
            const x = Math.max(0, Math.min(1, (elapsed - s.start) / (s.end - s.start)));
            const eased = x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
            const counted = Math.round(s.council.precincts * eased);
            const done = counted / s.council.precincts;
            const shares = s.final.map((f, i) => Math.max(0, f * (1 + 0.3 * s.wobble[i] * (1 - done))));
            const sum = shares.reduce((a, b) => a + b, 0) || 1;
            const total = Math.round(s.votes * done);
            const parties = s.lists.map((l, i) => ({
                id: l.id,
                votes: Math.round((shares[i] / sum) * total),
                candidates: l.candidates || s.council.seats,
                seats: null,
            }));
            // hlasy strany = součet hlasů jejích kandidátů
            const candidates = Object.fromEntries(Object.entries(s.prefs).map(([id, w]) => {
                const votes = parties.find((p) => p.id === Number(id))?.votes || 0;
                const wsum = w.reduce((a, b) => a + b, 0);
                return [id, w.map((x, i) => ({ n: i + 1, votes: Math.round((votes * x) / wsum), elected: null }))];
            }));
            const official = done === 1 && elapsed > s.end + 8000;
            if (official) {
                const alloc = allocateSeats(parties, { seats: s.council.seats });
                for (const p of parties) p.seats = alloc.byId[p.id].seats;
            }
            const summary = summarizeCouncil(s.council, {
                generated: new Date(now).toISOString(),
                seats: s.council.seats,
                precincts: { total: s.council.precincts, counted },
                turnout: { pct: counted ? s.turnout : 0 },
                official,
                parties,
                candidates,
            });
            if (summary.phase === 'pre') summary.phase = 'waiting';
            summaries[s.council.zastup] = summary;
        }
        return composeOverview(summaries, { now, demo: true });
    }

    return {
        startedAt,
        endsAt: startedAt + lastEnd + 8000,
        snapshot: async () => ({ snapshot: snapshotAt(Date.now()), stale: false, error: null }),
    };
}
