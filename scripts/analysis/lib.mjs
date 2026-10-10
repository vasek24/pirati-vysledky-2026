// Sdílené čisté funkce pro soukromou analytickou vrstvu (scripts/analysis/).
// Nic odtud nejde do public/ ani do buildu — výstupy žijí v analysis-private/.
import fs from 'node:fs';
import path from 'node:path';
import { parseCsuTime } from '../../src/volby/format.js';

export const USER_AGENT = 'pirati-analysis/1.0 (+420 777 954 389)';
export const MIN_INTERVAL_MS = 60_000;

export const num = (v) => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
};

// Date -> ISO 8601 v pražském čase s offsetem (např. 2026-10-10T14:31:05+02:00)
export function toPragueIso(date) {
    if (!date) return null;
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return null;
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Prague',
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'longOffset',
    }).formatToParts(d).map((p) => [p.type, p.value]));
    const off = (parts.timeZoneName || 'GMT+00:00').replace('GMT', '') || '+00:00';
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${off}`;
}

export const csuToIso = (s) => toPragueIso(parseCsuTime(s));

// Klíč záznamu: nový řádek jen při nové hodnotě `generated` (nebo změně počtu
// sečtených okrsků / platných hlasů při stejném `generated`)
export const recordKey = (r) => `${r.generatedRaw}|${r.precincts?.counted}|${r.turnout?.validVotes}`;

// Snapshot z našeho /api/volby -> kompaktní řádek JSONL
export function buildRecord(snap, slug, fetchedAt = new Date()) {
    const parties = {};
    const seats = {};
    for (const p of snap.parties || []) {
        parties[p.id] = p.votes;
        if (p.seats !== null && p.seats !== undefined) seats[p.id] = p.seats;
    }
    const okrsky = {};
    for (const [id, o] of Object.entries(snap.okrsky || {})) {
        okrsky[id] = { voters: o.voters, validVotes: o.validVotes, votes: o.votes || null };
    }
    const rec = {
        v: 1,
        slug,
        zastup: snap.zastup,
        fetchedAt: toPragueIso(fetchedAt),
        refreshedAt: snap.refreshedAt ? toPragueIso(snap.refreshedAt) : null,
        generated: csuToIso(snap.generated),
        generatedRaw: snap.generated || null,
        phase: snap.phase,
        official: !!snap.official,
        precincts: { total: snap.precincts?.total ?? null, counted: snap.precincts?.counted ?? 0 },
        turnout: {
            voters: snap.turnout?.voters ?? 0,
            envelopes: snap.turnout?.envelopes ?? 0,
            pct: snap.turnout?.pct ?? 0,
            validVotes: snap.turnout?.validVotes ?? 0,
        },
        parties,
        okrsky,
    };
    if (Object.keys(seats).length) rec.seats = seats;
    return rec;
}

// Načte JSONL; poslední nedopsaný (utržený) řádek se přeskočí
export function readJsonl(file) {
    if (!fs.existsSync(file)) return [];
    const out = [];
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
            out.push(JSON.parse(line));
        } catch {
            /* utržený řádek po pádu */
        }
    }
    return out;
}

// Append-only zápis jednoho řádku; když soubor nekončí \n (pád uprostřed
// zápisu), nejdřív doplní konec řádku, aby se nespojily dva záznamy.
export function appendJsonl(file, obj) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let prefix = '';
    if (fs.existsSync(file)) {
        const size = fs.statSync(file).size;
        if (size > 0) {
            const fd = fs.openSync(file, 'r');
            const b = Buffer.alloc(1);
            fs.readSync(fd, b, 0, 1, size - 1);
            fs.closeSync(fd);
            if (b[0] !== 10) prefix = '\n';
        }
    }
    fs.appendFileSync(file, `${prefix}${JSON.stringify(obj)}\n`);
}

// ucast/obec/<okres>/<zastup>.json -> [{ okrsek, voters, envelopes, validVotes }] jen sečtené
export function countedRows(turnoutJson) {
    const rows = [];
    for (const r of turnoutJson?.okrsky || []) {
        if (!Array.isArray(r) || !(num(r[1]) > 0)) continue;
        rows.push({ okrsek: String(r[0]), voters: num(r[1]), envelopes: num(r[2]), validVotes: num(r[8]) });
    }
    return rows;
}

// vysled/okrsek/<okres>/<zastup>_<okrsek>.json -> redukovaný záznam nebo null
export function reducePrecinct(json, row) {
    const rows = json?.vysledky || [];
    if (!rows.length) return null;
    const votes = {};
    for (const r of rows) votes[num(r[0])] = num(r[2]);
    const sum = Object.values(votes).reduce((s, v) => s + v, 0);
    const p = json.prehled || [];
    return {
        okrsek: row.okrsek,
        generated: csuToIso(json.generovano),
        voters: num(p[0]) || row.voters,
        envelopes: num(p[1]) || row.envelopes,
        validVotes: num(p[7]) || row.validVotes,
        votes,
        consistent: row.validVotes > 0 ? sum === row.validVotes : true,
    };
}
