#!/usr/bin/env node
// Soukromé shrnutí pro konverzace s Claudem: čte live/*.jsonl + 2022/*.json,
// píše state/<slug>.json (+ state/<slug>.precincts.json s detailem okrsků).
//   node scripts/analysis/summary.mjs [--out <dir>]
// Projekce je NAIVNÍ (swing z už sečtených okrsků přenesený na zbylé okrsky).
// Nic z toho nejde do public/ ani do deploye.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { allocateSeats } from '../../src/volby/compute.js';
import { DEFAULT_OUT } from './record.mjs';
import { readJsonl } from './lib.mjs';

export const SLUGS = [
    { slug: 'magistrat', precinctFile: 'magistrat-precincts.jsonl' },
    { slug: 'praha-9', precinctFile: null },
];
const r1 = (n) => (n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);
const r2 = (n) => (n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);
const sum = (a) => a.reduce((s, x) => s + x, 0);
const mapVals = (o, f) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)]));

export const METHOD = [
    'NAIVE projection, not a forecast.',
    '1) swing[p] = share of list p in already counted precincts (2026) minus the 2022 share of its predecessor list(s) in the SAME precincts (pp).',
    '   If every matched counted precinct has per-precinct votes, swing is the mean of precinct-level swings weighted by 2022 valid votes;',
    '   otherwise it is pooled: (2026 council votes so far / valid votes so far) minus (2022 votes in the same precincts / 2022 valid votes there).',
    '2) For each uncounted precinct: expected share[p] = max(0, share2022[p] + swing[p]), renormalised to 100 %.',
    '   Lists without a 2022 predecessor have share2022 = 0, so they get the pooled counted share.',
    '3) Expected votes in an uncounted precinct = valid votes 2022 of that precinct x k, k = valid votes 2026 / valid votes 2022 in counted precincts.',
    '4) Final = votes counted so far + sum of expected votes of uncounted precincts; seats by the repo allocateSeats (5 % threshold, d\'Hondt).',
    'Not modelled: which precincts are counted first (early precincts are rarely representative), turnout changes by area, preference votes.',
].join('\n');

// Sloučí záznamy: poslední hodnota každého okrsku, hlasy se nepřepisují null
export function mergeCounted(records, precinctRecords = []) {
    const merged = {};
    for (const rec of records) {
        for (const [id, o] of Object.entries(rec.okrsky || {})) {
            merged[id] = { ...merged[id], ...o, votes: o.votes || merged[id]?.votes || null };
        }
    }
    for (const p of precinctRecords) {
        if (merged[p.okrsek]) merged[p.okrsek].votes = p.votes;
    }
    return merged;
}

export function buildState({ baseline, records, precinctRecords = [], computedAt = null }) {
    const base = baseline.precincts;
    const pirateId = baseline.piratesList2026 ? String(baseline.piratesList2026.id) : null;
    const lists = baseline.lists2026;
    const name = Object.fromEntries(lists.map((l) => [String(l.id), l.short || l.name]));
    const latest = records[records.length - 1] || null;
    const header = {
        v: 1,
        PRIVATE: 'Soukromá analýza — nikdy nezveřejňovat ani nenasazovat',
        slug: baseline.slug,
        name: baseline.name,
        computedAt,
        seats: baseline.seats2026,
        piratesListId: pirateId,
        lists: lists.map((l) => ({
            id: l.id, short: l.short, name: l.name, pirate: l.pirate, candidates: l.candidates,
            predecessors2022: l.predecessors2022?.label || null, share2022Pct: l.share2022Pct,
        })),
    };
    if (!latest || !latest.precincts?.counted) {
        return { state: { ...header, asOf: latest ? { fetchedAt: latest.fetchedAt, generated: latest.generated, phase: latest.phase } : null,
            status: 'no-precincts-counted-yet', timeline: timeline(records, lists) }, detail: null };
    }

    const merged = mergeCounted(records, precinctRecords);
    const countedIds = Object.keys(merged);
    const matched = countedIds.filter((id) => base[id]);
    const unmatched = countedIds.filter((id) => !base[id]);
    const remainingIds = Object.keys(base).filter((id) => !merged[id]);
    const caveats = [];
    if (unmatched.length) caveats.push(`Counted precincts without a 2022 baseline (new/renumbered): ${unmatched.join(', ')}`);

    // 2026 hlasy sečtených okrsků (celé zastupitelstvo) bez okrsků bez základu
    const totals = { ...latest.parties };
    let valid26 = sum(Object.values(totals));
    const m26 = { ...totals };
    let v26 = valid26;
    for (const id of unmatched) {
        const o = merged[id];
        if (o.votes) {
            for (const [p, v] of Object.entries(o.votes)) m26[p] = (m26[p] || 0) - v;
            v26 -= sum(Object.values(o.votes));
        } else caveats.push(`Unmatched precinct ${id} has no per-precinct votes; its votes stay in the pooled 2026 numbers.`);
    }
    // 2022 stejné okrsky
    const valid22M = sum(matched.map((id) => base[id].validVotes || 0));
    const eq22 = {};
    for (const l of lists) eq22[l.id] = sum(matched.map((id) => base[id].votes2026Equiv[l.id] || 0));
    const hasBase = (l) => !!l.predecessors2022;

    const withVotes = matched.filter((id) => merged[id].votes && (merged[id].validVotes || 0) > 0);
    const perPrecinct = matched.length > 0 && withVotes.length === matched.length;
    const swing = {};
    const share26 = {};
    const share22 = {};
    for (const l of lists) {
        const id = String(l.id);
        share26[id] = v26 ? ((m26[id] || 0) / v26) * 100 : 0;
        share22[id] = valid22M ? (eq22[l.id] / valid22M) * 100 : 0;
    }
    const precinctSwing = {}; // okrsek -> { id: pp }
    if (perPrecinct) {
        const w = sum(matched.map((id) => base[id].validVotes || 0));
        for (const l of lists) swing[l.id] = 0;
        for (const id of matched) {
            const o = merged[id];
            const t = sum(Object.values(o.votes));
            precinctSwing[id] = {};
            for (const l of lists) {
                const s26 = t ? ((o.votes[l.id] || 0) / t) * 100 : 0;
                const s22 = base[id].validVotes ? ((base[id].votes2026Equiv[l.id] || 0) / base[id].validVotes) * 100 : 0;
                precinctSwing[id][l.id] = s26 - (hasBase(l) ? s22 : 0);
                swing[l.id] += (w ? (base[id].validVotes || 0) / w : 0) * precinctSwing[id][l.id];
            }
        }
    } else {
        for (const l of lists) swing[l.id] = share26[l.id] - (hasBase(l) ? share22[l.id] : 0);
    }

    // k = platné hlasy 2026 / 2022 ve stejných okrscích
    const val26M = sum(matched.map((id) => merged[id].validVotes || 0));
    const k = valid22M ? val26M / valid22M : 1;

    // projekce zbylých okrsků
    const detail = { counted: {}, remaining: {} };
    const expVotes = {};
    for (const l of lists) expVotes[l.id] = 0;
    const remaining = remainingIds.map((id) => {
        const b = base[id];
        const raw = {};
        for (const l of lists) {
            const s22 = hasBase(l) && b.validVotes ? ((b.votes2026Equiv[l.id] || 0) / b.validVotes) * 100 : 0;
            raw[l.id] = Math.max(0, s22 + swing[l.id]);
        }
        const tot = sum(Object.values(raw)) || 1;
        const w = (b.validVotes || 0) * k;
        const exp = {};
        const s22map = {};
        for (const l of lists) {
            exp[l.id] = (raw[l.id] / tot) * 100;
            expVotes[l.id] += (exp[l.id] / 100) * w;
            s22map[l.id] = b.validVotes ? ((b.votes2026Equiv[l.id] || 0) / b.validVotes) * 100 : null;
        }
        detail.remaining[id] = { voters2022: b.voters, validVotes2022: b.validVotes, turnoutPct2022: b.turnoutPct,
            pct2022: mapVals(s22map, r1), expectedPct: mapVals(exp, r1), expectedValidVotes: Math.round(w) };
        return { okrsek: id, validVotes2022: b.validVotes, turnoutPct2022: b.turnoutPct,
            pirates2022Pct: pirateId ? r1(s22map[pirateId]) : null, piratesExpectedPct: pirateId ? r1(exp[pirateId]) : null };
    });

    const counted = countedIds.map((id) => {
        const o = merged[id];
        const b = base[id];
        const t = o.votes ? sum(Object.values(o.votes)) : 0;
        const p26 = o.votes ? Object.fromEntries(lists.map((l) => [l.id, t ? ((o.votes[l.id] || 0) / t) * 100 : 0])) : null;
        const p22 = b ? Object.fromEntries(lists.map((l) => [l.id, b.validVotes ? ((b.votes2026Equiv[l.id] || 0) / b.validVotes) * 100 : null])) : null;
        detail.counted[id] = { voters: o.voters, validVotes: o.validVotes, in2022: b ? { voters: b.voters, turnoutPct: b.turnoutPct, validVotes: b.validVotes } : null,
            pct2026: p26 && mapVals(p26, r1), pct2022: p22 && mapVals(p22, r1), swingPp: precinctSwing[id] ? mapVals(precinctSwing[id], r1) : null };
        return { okrsek: id, voters: o.voters, validVotes: o.validVotes, matched2022: !!b, hasPrecinctVotes: !!o.votes,
            pirates2026Pct: p26 && pirateId ? r1(p26[pirateId]) : null, pirates2022Pct: p22 && pirateId ? r1(p22[pirateId]) : null,
            piratesSwingPp: precinctSwing[id] && pirateId ? r1(precinctSwing[id][pirateId]) : null };
    });

    // finální odhad
    const finalVotes = {};
    for (const l of lists) finalVotes[l.id] = (totals[l.id] || 0) + expVotes[l.id];
    const finalTotal = sum(Object.values(finalVotes));
    const alloc = allocateSeats(lists.map((l) => ({ id: l.id, votes: finalVotes[l.id], candidates: l.candidates || baseline.seats2026 })), { seats: baseline.seats2026 });

    // hrubá nejistota: rozptyl swingů mezi okrsky (jen když jsou okrskové hlasy)
    const wAll = sum(matched.map((id) => base[id].validVotes || 0));
    const allValid22 = sum(Object.values(base).map((b) => b.validVotes || 0));
    const remShare = allValid22 ? 1 - valid22M / allValid22 : 0;
    const nRem = remainingIds.length || 1;
    const crudeSe = {};
    if (perPrecinct && matched.length >= 5) {
        for (const l of lists) {
            let v = 0;
            for (const id of matched) v += ((base[id].validVotes || 0) / wAll) * (precinctSwing[id][l.id] - swing[l.id]) ** 2;
            const sd = Math.sqrt(v);
            crudeSe[l.id] = r2(remShare * sd * Math.sqrt(1 / nRem + 1 / matched.length));
        }
    }
    const t26 = latest.turnout.voters ? (latest.turnout.envelopes / latest.turnout.voters) * 100 : null;
    const t22M = (() => {
        const v = sum(matched.map((id) => base[id].voters || 0));
        return v ? (sum(matched.map((id) => base[id].envelopes || 0)) / v) * 100 : null;
    })();
    const shareCounted22 = allValid22 ? (valid22M / allValid22) * 100 : null;

    const parties = lists.map((l) => {
        const id = String(l.id);
        const pred = l.predecessors2022;
        return {
            id: l.id, short: l.short, pirate: l.pirate,
            votes2026SoFar: totals[id] || 0,
            pct2026SoFar: r2(valid26 ? ((totals[id] || 0) / valid26) * 100 : 0),
            pct2022SameCountedPrecincts: pred ? r2(share22[id]) : null,
            pct2022WholeCouncil: l.share2022Pct,
            swingPp: r2(swing[id]),
            swingNote: pred ? (pred.exact ? null : 'predecessor list is not an exact match (coalition/merger)') : 'no 2022 predecessor: swing = pooled share',
            NAIVE_expectedFinalVotes: Math.round(finalVotes[id]),
            NAIVE_expectedFinalPct: r2(finalTotal ? (finalVotes[id] / finalTotal) * 100 : 0),
            NAIVE_crudeSePp: crudeSe[id] ?? null,
            NAIVE_expectedSeats: alloc.byId[l.id]?.seats ?? null,
            seats2022Predecessors: pred ? sum(pred.ids.map((p) => baseline.lists2022.find((x) => x.id === p)?.seats || 0)) : null,
        };
    });

    const state = {
        ...header,
        asOf: { fetchedAt: latest.fetchedAt, generated: latest.generated, phase: latest.phase, official: latest.official },
        progress: {
            countedPrecincts: countedIds.length,
            totalPrecincts: latest.precincts.total,
            countedPctByPrecinctCount: r1(latest.precincts.total ? (countedIds.length / latest.precincts.total) * 100 : null),
            countedPctOf2022ValidVotes: r1(shareCounted22),
            precinctsWithPerPrecinctVotes: withVotes.length,
            matchedTo2022: matched.length,
            remainingListedFrom2022: remainingIds.length,
        },
        turnout: { pctSoFar2026: r1(t26), pct2022SameCountedPrecincts: r1(t22M), swingPp: r1(t26 !== null && t22M !== null ? t26 - t22M : null) },
        swingMethodUsed: perPrecinct ? 'per-precinct weighted by 2022 valid votes' : 'pooled totals',
        validVotesRatio2026to2022_k: r2(k),
        parties,
        NAIVE_projection: {
            label: 'NAIVE — not a forecast',
            method: METHOD,
            uncertainty: [
                `Only ${r1(shareCounted22)} % of 2022 valid votes are counted so far; the lower this is, the less the swing says about the rest.`,
                'NAIVE_crudeSePp (when present) is a sampling-style 1-sigma from the spread of precinct swings; it ignores that precincts are counted in non-random order, so real error is larger.',
                'Seats are from the naive final votes; close seats (see lastSeat margins) can flip with <1 pp.',
            ].join(' '),
            lastSeat: alloc.lastSeat ?? null,
            nextSeat: alloc.nextSeat ?? null,
        },
        caveats,
        counted,
        remaining,
        timeline: timeline(records, lists),
    };
    return { state, detail };
}

function timeline(records, lists) {
    return records.map((r) => {
        const tot = sum(Object.values(r.parties || {}));
        return {
            fetchedAt: r.fetchedAt, generated: r.generated, counted: r.precincts?.counted, total: r.precincts?.total,
            turnoutPct: r.turnout?.pct, validVotes: r.turnout?.validVotes,
            pct: Object.fromEntries(lists.map((l) => [l.id, tot ? r2(((r.parties[l.id] || 0) / tot) * 100) : null])),
        };
    });
}

export function run({ outDir = DEFAULT_OUT, computedAt = new Date().toISOString() } = {}) {
    const written = [];
    for (const t of SLUGS) {
        const bf = path.join(outDir, '2022', `${t.slug}.json`);
        if (!fs.existsSync(bf)) {
            console.error(`chybí ${bf} — spusť nejdřív export-2022.mjs`);
            continue;
        }
        const baseline = JSON.parse(fs.readFileSync(bf, 'utf8'));
        const records = readJsonl(path.join(outDir, 'live', `${t.slug}.jsonl`))
            .sort((a, b) => String(a.generatedRaw).localeCompare(String(b.generatedRaw)) || String(a.fetchedAt).localeCompare(String(b.fetchedAt)));
        const precinctRecords = t.precinctFile ? readJsonl(path.join(outDir, 'live', t.precinctFile)) : [];
        const out = buildState({ baseline, records, precinctRecords, computedAt });
        const dir = path.join(outDir, 'state');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${t.slug}.json`), `${JSON.stringify(out.state, null, 1)}\n`);
        if (out.detail) fs.writeFileSync(path.join(dir, `${t.slug}.precincts.json`), `${JSON.stringify(out.detail)}\n`);
        written.push(path.join(dir, `${t.slug}.json`));
    }
    return written;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const i = process.argv.indexOf('--out');
    for (const w of run({ outDir: i > 0 ? path.resolve(process.argv[i + 1]) : DEFAULT_OUT })) console.log(w);
}
