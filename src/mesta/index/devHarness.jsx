/* eslint-disable react-refresh/only-export-components -- vývojový nástroj, ne produkční modul */
// Vývojová a ověřovací pomůcka (nenačítá ji produkční build): zfalšuje
// /api/kraj?s=<id> nad vývojovými daty (devFixture.jsx) a přidá panel `?dev=1`
// se stavy dat z prototypu — před sčítáním, sčítá se, vyhlášeno, shard selhal.
// Čísla jsou vymyšlená. Spouští ji devEntry.jsx.
import { useEffect, useState } from 'react';
import { FIXTURE_ALL, FIXTURE_SHARDS } from './devFixture.jsx';

const SIM = { mode: 'counting', failKraj: 8100, t0: Date.now(), fast: false, delay: 300, stale: false };
const LOG = [];

const hash = (s) => {
    let x = 2166136261;
    for (const c of String(s)) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); }
    return (x >>> 0) / 4294967296;
};
const simMinute = () => 15 * 60 + 10 + ((Date.now() - SIM.t0) / 1000) * 12 / 60; // 1 s = 12 s „volební noci"
const csuTime = (min) => {
    const m = Math.max(0, Math.floor(min));
    return `2026-10-10T${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`;
};

function summaryOf(c) {
    const total = c.precincts;
    const base = 3 + hash(`${c.zastup}a`) * 19;
    const pirates = (pct, seats) => (c.pirates ? { id: c.pirates, votes: Math.round(pct * 100), pct, seats, passed: pct >= 5, rank: 2 } : null);
    const common = { z: c.zastup, seats: c.seats, votes: 10000, turnout: 41, parties: [] };
    if (SIM.mode === 'pre') return { ...common, phase: 'pre', counted: 0, total, official: false, generated: '2026-10-10T08:00:00', pirates: null };
    if (SIM.mode === 'final') {
        const pct = base + (hash(`${c.zastup}f`) - 0.5) * 2;
        const seats = pct >= 5 ? Math.max(1, Math.round((pct / 100) * c.seats * 1.08)) : 0;
        return { ...common, phase: 'final', counted: total, total, official: true, generated: csuTime(21 * 60 + hash(`${c.zastup}g`) * 260), pirates: pirates(pct, seats) };
    }
    const start = 14 * 60 + 15 + hash(`${c.zastup}b`) * 75;
    const dur = 40 + (0.5 + hash(`${c.zastup}c`) * 0.5) * 220 * Math.min(1, c.population / 80000 + 0.25);
    const now = simMinute();
    const p = Math.max(0, Math.min(1, (now - start) / dur));
    const counted = Math.floor(p * total);
    if (!counted) return { ...common, phase: 'waiting', counted: 0, total, official: false, generated: csuTime(Math.max(14 * 60 + 2, Math.min(now, start))), pirates: null };
    const pct = base + (hash(`${c.zastup}:${counted}`) - 0.5) * 8 * (1 - counted / total);
    return { ...common, phase: 'counting', counted, total, official: false, generated: csuTime(start + (counted / total) * dur), pirates: pirates(pct, Math.max(1, Math.round((pct / 100) * c.seats))) };
}

const realFetch = window.fetch.bind(window);
export function installMockApi() {
    // ?at=15:45 posune hodiny stránky na tenhle čas volební soboty (pražský čas)
    const at = /^(\d{1,2}):(\d{2})$/.exec(new URLSearchParams(window.location.search).get('at') || '');
    if (at) {
        const shift = Date.parse(`2026-10-10T${at[1].padStart(2, '0')}:${at[2]}:00+02:00`) - Date.now();
        const realNow = Date.now.bind(Date);
        Date.now = () => realNow() + shift;
    }
    SIM.t0 = Date.now();
    window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input.url;
        const m = /^\/api\/kraj\?s=([\w-]+)$/.exec(url);
        if (!m) return realFetch(input, init);
        const id = m[1];
        LOG.push({ id, at: Math.round(performance.now()), hidden: document.hidden });
        window.dispatchEvent(new Event('mesta-dev-log'));
        await new Promise((r) => setTimeout(r, SIM.delay + Math.random() * 60));
        const shard = FIXTURE_SHARDS.find((s) => s.id === id);
        const headers = { 'content-type': 'application/json', 'x-server-now': String(Date.now()) };
        if (!shard) return new Response(JSON.stringify({ error: 'unknown-shard' }), { status: 400, headers });
        if (SIM.mode === 'fail' && shard.kraj === SIM.failKraj) return new Response(JSON.stringify({ error: 'upstream' }), { status: 503, headers });
        const councils = {};
        for (const z of shard.zastups) councils[z] = summaryOf(FIXTURE_ALL.find((c) => c.zastup === z));
        const now = Date.now();
        // součty za shard (jako composeOverview) — index je nesmí nikde ukázat
        const body = {
            v: 1, refreshedAt: now, nextRefreshAt: now + (SIM.fast ? 10_000 : 60_000), servedAt: now, stale: SIM.stale, complete: true, refreshing: false,
            phase: SIM.mode === 'final' ? 'final' : 'counting', generated: csuTime(simMinute()), missing: 0,
            precincts: { counted: 99999, total: 100000, pct: 99.999 }, official: true, councils,
        };
        return new Response(JSON.stringify(body), { status: 200, headers });
    };
}

export const devLog = () => LOG;
export function setSim(patch) { Object.assign(SIM, patch, patch.mode ? { t0: Date.now() } : {}); }

// CLS bez posunů po vstupu uživatele (jako DevTools); sbírá se od načtení stránky
let cls = 0;
try {
    new PerformanceObserver((l) => {
        for (const e of l.getEntries()) if (!e.hadRecentInput) cls += e.value;
        window.dispatchEvent(new Event('mesta-dev-log'));
    }).observe({ type: 'layout-shift', buffered: true });
} catch { /* starší prohlížeč */ }
window.__devCls = () => cls;
window.__devSim = (patch) => setSim(patch);
window.__devLog = () => LOG.map((l) => l.id);
window.__devLogFull = () => LOG.map((l) => ({ ...l }));

export function DevPanel() {
    const [, bump] = useState(0);
    const [open, setOpen] = useState(true);
    useEffect(() => {
        const on = () => bump((n) => n + 1);
        window.addEventListener('mesta-dev-log', on);
        return () => window.removeEventListener('mesta-dev-log', on);
    }, []);
    return (
        <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} style={{ position: 'fixed', right: 8, bottom: 8, zIndex: 60, width: 300, background: '#111', color: '#eee', font: '12px/1.4 ui-monospace,monospace', border: '1px solid #444', borderRadius: 10, padding: 8 }}>
            <summary>dev · shardy {LOG.length} · CLS {cls.toFixed(3)}</summary>
            <div>{LOG.map((l) => l.id).join(', ') || '—'}</div>
            <div>šířka {innerWidth}px · scrollWidth {document.documentElement.scrollWidth}px</div>
            {[['pre', 'před sčítáním'], ['counting', 'sčítá se'], ['final', 'vyhlášeno'], ['fail', 'shard selhal (Moravskoslezský)']].map(([v, l]) => (
                <label key={v} style={{ display: 'block' }}><input type="radio" name="dvm" defaultChecked={v === SIM.mode} onChange={() => setSim({ mode: v })} /> {l}</label>
            ))}
            <label style={{ display: 'block' }}><input type="checkbox" onChange={(e) => setSim({ fast: e.target.checked })} /> rychlé obnovování (10 s)</label>
            <label style={{ display: 'block' }}><input type="checkbox" onChange={(e) => setSim({ stale: e.target.checked })} /> server hlásí stale</label>
        </details>
    );
}
