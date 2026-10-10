// Přehled všech pražských zastupitelstev (/): souhrn Pirátů za Prahu,
// karta každé městské části, kde Piráti kandidují (průběžné procento
// a mandáty i během sčítání), a rozcestník na ostatní MČ. Živá data
// z /api/prehled (src/volby/overview.js), podklady z /data/prehled.json.
// ?demo spustí simulované sčítání celé Prahy.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { COUNCILS, POLLS_CLOSE } from '../councils';
import { OVERVIEW_SOURCE, useLiveResults } from '../hooks/useLiveResults';
import { createOverviewDemoFeed } from '../volby/overview';
import { listLabels } from '../volby/council';
import { countdown, fmtInt, fmtPct, fmtPp, fmtShortTime, fmtTime, parseCsuTime, plural } from '../volby/format';
import { AutoRefreshNote, RefreshButton, StatusPill } from '../components/ElectionHeader';
import { useNow } from '../hooks/useNow';
import { APP_VERSION } from '../changelog';
import { openChangelog } from '../utils/openChangelog';

const params = new URLSearchParams(window.location.search);
const DEMO = params.has('demo');
const DEMO_SECONDS = Number(params.get('demo')) || 150;

const MAGISTRAT = COUNCILS.find((c) => c.magistrat);
const OURS = COUNCILS.filter((c) => !c.magistrat && c.pirates);
// MČ bez pirátské kandidátky, kde Piráti kandidují na kandidátce jiného uskupení
const ALLIES = COUNCILS.filter((c) => !c.magistrat && !c.pirates && c.pirateCandidates.length);
const OTHERS = COUNCILS.filter((c) => !c.magistrat && !c.pirates && !c.pirateCandidates.length);
const EMPTY = '#E5E5E3';

const href = (c) => `/${c.slug}${DEMO ? '?demo' : ''}`;
const seatsWord = (n) => plural(n, 'mandát', 'mandáty', 'mandátů');

// Kandidátky zastupitelstva z prehled.json se zkratkami podle councils.js
function useLists(statics) {
    return useMemo(() => {
        const out = {};
        for (const c of COUNCILS) {
            const st = statics?.councils?.[c.zastup];
            if (!st) continue;
            out[c.zastup] = Object.fromEntries(st.lists.map((l) => [l.id, { ...l, ...listLabels(c, l) }]));
        }
        return out;
    }, [statics]);
}

// Čerstvě změněná zastupitelstva (přibyly okrsky / vyhlášeno) na pár vteřin zvýraznit.
// Zhasnutí běží mimo cleanup efektu — další snapshot bez změn (demo po 4 s,
// ruční obnovení) ho nesmí zrušit, jinak by zvýraznění zůstalo svítit.
function useFresh(snapshot) {
    const prev = useRef(null);
    const clearRef = useRef(null);
    const [fresh, setFresh] = useState(() => new Set());
    useEffect(() => () => clearTimeout(clearRef.current), []);
    useEffect(() => {
        if (!snapshot) return undefined;
        const sig = Object.fromEntries(Object.values(snapshot.councils).map((s) => [s.z, `${s.counted}|${s.official}`]));
        const old = prev.current;
        prev.current = sig;
        if (!old) return undefined;
        const changed = Object.keys(sig).filter((z) => old[z] !== undefined && old[z] !== sig[z]);
        if (!changed.length) return undefined;
        const t0 = setTimeout(() => setFresh(new Set(changed)), 0);
        clearTimeout(clearRef.current);
        clearRef.current = setTimeout(() => setFresh(new Set()), 4000);
        return () => clearTimeout(t0);
    }, [snapshot]);
    return fresh;
}

// Pruh mandátů: políčko za každý mandát v barvě strany, Piráti první
function SeatStrip({ council, summary, lists, className = 'h-2' }) {
    const cells = [];
    if (summary?.votes > 0) {
        const rows = [...summary.parties].sort((a, b) => (b[0] === council.pirates) - (a[0] === council.pirates) || b[2] - a[2] || b[1] - a[1]);
        for (const [id, , seats] of rows) for (let i = 0; i < seats; i++) cells.push(lists?.[id]?.color || '#6B7280');
    }
    return (
        <div className={`flex gap-px ${className}`} aria-hidden="true">
            {Array.from({ length: council.seats }, (_, i) => (
                <div key={i} className="flex-1 first:rounded-l-sm last:rounded-r-sm transition-colors duration-500" style={{ backgroundColor: cells[i] || EMPTY }} />
            ))}
        </div>
    );
}

function Progress({ summary, dark = false }) {
    const pct = summary?.total ? (summary.counted / summary.total) * 100 : 0;
    return (
        <div className={`h-1 rounded-full overflow-hidden ${dark ? 'bg-white/15' : 'bg-neutral-100'}`}>
            <div className="h-full bg-[#FEC900] transition-[width] duration-700" style={{ width: `${pct}%` }} />
        </div>
    );
}

function CountBadge({ summary }) {
    if (!summary || summary.phase === 'pre') return null;
    if (summary.official) return <span className="rounded bg-emerald-600 text-white px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide">konečné</span>;
    if (!summary.counted) return <span className="text-[11px] text-neutral-500 whitespace-nowrap">čeká na okrsky</span>;
    return (
        <span className="text-[11px] tabular-nums text-neutral-500 whitespace-nowrap">
            <b className="text-neutral-900">{summary.counted}</b>/{summary.total} okrsků
        </span>
    );
}

// Karta městské části, kde kandidují Piráti
function PirateCard({ council, summary, lists, fresh }) {
    const list = lists?.[council.pirates];
    const p = summary?.pirates;
    const live = summary?.votes > 0 && p;
    const done = live && (summary.official || summary.counted === summary.total);
    const pct = live ? p.pct : list?.pct2022 ?? null;
    const seats = live ? p.seats : list?.seats2022 ?? null;
    const name = list?.short || `kandidátka č. ${council.pirates}`;
    const coalitionName = list && !/^(Česká pirátská strana|Piráti)$/i.test(name);

    return (
        <a
            href={href(council)}
            className={`group block min-w-0 rounded-2xl bg-white border p-4 shadow-sm hover:shadow-md hover:border-black active:bg-neutral-50 transition ${
                fresh ? 'border-[#FEC900] ring-2 ring-[#FEC900]/60' : 'border-neutral-200'
            }`}
        >
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <div className="font-display text-3xl leading-none tracking-wide">{council.name}</div>
                    <div className="mt-1 text-[11px] text-neutral-500 truncate">
                        č. {council.pirates}{coalitionName ? ` · ${name}` : ''}
                        {list?.note && <span className="text-neutral-400"> ({list.note})</span>}
                    </div>
                </div>
                <div className="shrink-0 pt-0.5"><CountBadge summary={summary} /></div>
            </div>

            <div className="mt-3 flex items-end justify-between gap-3">
                <div className="min-w-0">
                    <div className={`font-display text-5xl leading-none tabular-nums whitespace-nowrap ${live ? 'text-black' : 'text-neutral-400'}`}>{fmtPct(pct)}</div>
                    <div className="mt-1 text-[11px] text-neutral-500 truncate">
                        {!live
                            ? list?.pct2022 !== null && list?.pct2022 !== undefined
                                ? `výchozí stav: KV 2022 (${list.baselineLabel})`
                                : 'bez srovnání s 2022'
                            : done && list?.pct2022 !== null && list?.pct2022 !== undefined
                                ? <><b className={p.pct - list.pct2022 >= 0 ? 'text-emerald-700' : 'text-orange-700'}>{fmtPp(p.pct - list.pct2022)}</b> proti 2022 · {p.rank}. místo</>
                                : <>{p.rank}. místo{list?.pct2022 !== null && list?.pct2022 !== undefined ? ` · 2022: ${fmtPct(list.pct2022)}, ${list.seats2022}` : ''}</>}
                    </div>
                </div>
                <div className={`shrink-0 rounded-xl px-3 py-1.5 text-right ${live ? 'bg-black text-[#FEC900]' : 'bg-neutral-100 text-neutral-400'}`}>
                    <div className="font-display text-4xl leading-none tabular-nums">{seats ?? '–'}</div>
                    <div className={`text-[11px] ${live ? 'text-white/70' : ''}`}>
                        {!live ? `${seatsWord(seats ?? 0)} 2022` : summary.official ? seatsWord(seats) : `${seatsWord(seats)} · odhad`}
                    </div>
                </div>
            </div>

            {live && !p.passed && (
                <div className="mt-2 rounded-lg bg-orange-50 text-orange-800 text-[11px] px-2 py-1">
                    Pod 5% klauzulí{p.toThreshold ? <> — chybí {fmtInt(p.toThreshold)} hlasů</> : ''}
                </div>
            )}
            {live && p.passed && !summary.official && p.toNext !== null && (
                <div className="mt-2 text-[11px] text-neutral-500">
                    Další mandát: chybí <b className="text-neutral-800">{fmtInt(p.toNext)}</b> hl.
                    {p.margin !== null && p.seats > 0 && <> · rezerva {fmtInt(p.margin)} hl.</>}
                </div>
            )}

            <div className="mt-3 space-y-1.5">
                <SeatStrip council={council} summary={summary} lists={lists} />
                {summary && summary.phase !== 'pre' && !summary.official && <Progress summary={summary} />}
            </div>
        </a>
    );
}

// Karta MČ, kde Piráti kandidují na kandidátce jiného uskupení: jak si vede
// kandidátka a jestli by na ní naše kandidátka / náš kandidát měli mandát
function AllyCard({ council, summary, lists, fresh }) {
    const live = summary?.votes > 0;
    return (
        <a
            href={href(council)}
            className={`group block min-w-0 rounded-2xl bg-white border p-4 shadow-sm hover:shadow-md hover:border-black active:bg-neutral-50 transition ${
                fresh ? 'border-[#FEC900] ring-2 ring-[#FEC900]/60' : 'border-neutral-200'
            }`}
        >
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 font-display text-3xl leading-none tracking-wide truncate">{council.name.replace(/^Praha-/, '')}</div>
                <div className="shrink-0 pt-0.5"><CountBadge summary={summary} /></div>
            </div>
            {council.pirateCandidates.map((pc) => {
                const list = lists?.[pc.list];
                const row = live ? summary.parties.find(([id]) => id === pc.list) : null;
                const status = live ? summary.pirateCandidates?.find((x) => x.list === pc.list && x.n === pc.n) : null;
                const has2022 = list?.pct2022 !== null && list?.pct2022 !== undefined;
                const pct = row ? (row[1] / summary.votes) * 100 : has2022 ? list.pct2022 : null;
                const seats = row ? row[2] : list?.seats2022 ?? null;
                return (
                    <div key={`${pc.list}-${pc.n}`}>
                        <div className="mt-2 text-sm font-semibold text-neutral-900 truncate">{pc.name}</div>
                        <div className="text-[11px] text-neutral-500 truncate" title={list?.short}>
                            <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ backgroundColor: list?.color || '#6B7280' }} />
                            {pc.n}. na kandidátce č. {pc.list}{list ? ` · ${list.short}` : ''}
                        </div>

                        <div className="mt-3 flex items-end justify-between gap-3">
                            <div className="min-w-0">
                                <div className={`font-display text-4xl leading-none tabular-nums whitespace-nowrap ${live ? 'text-black' : 'text-neutral-400'}`}>{fmtPct(pct)}</div>
                                <div className="mt-1 text-[11px] text-neutral-500 truncate">
                                    {live
                                        ? `kandidátka · ${seats} ${seatsWord(seats)} z ${council.seats}`
                                        : has2022
                                            ? `KV 2022 (${list.baselineLabel}) · ${seats} ${seatsWord(seats)}`
                                            : 'nová kandidátka, bez srovnání s 2022'}
                                </div>
                            </div>
                            {status?.seat !== null && status?.seat !== undefined ? (
                                <div className={`shrink-0 rounded-xl px-3 py-1.5 text-right ${status.seat ? 'bg-black text-[#FEC900]' : 'bg-neutral-100 text-neutral-600'}`}>
                                    <div className="text-sm font-bold leading-tight whitespace-nowrap">{status.seat ? 'má mandát' : 'bez mandátu'}</div>
                                    <div className={`text-[11px] ${status.seat ? 'text-white/70' : 'text-neutral-500'}`}>{summary.official ? 'oficiálně' : 'odhad'}</div>
                                </div>
                            ) : (
                                <div className="shrink-0 rounded-xl px-3 py-1.5 text-right bg-neutral-100 text-neutral-400">
                                    <div className="font-display text-4xl leading-none tabular-nums">{pc.n}.</div>
                                    <div className="text-[11px]">na listině</div>
                                </div>
                            )}
                        </div>
                        {status?.votes !== null && status?.votes !== undefined && (
                            <div className="mt-2 text-[11px] text-neutral-500">
                                Preferenční hlasy: <b className="text-neutral-800">{fmtInt(status.votes)}</b>
                                {status.order !== null && status.order !== pc.n && <> · {status.order < pc.n ? 'posun' : 'pokles'} z {pc.n}. na {status.order}. místo</>}
                            </div>
                        )}
                    </div>
                );
            })}
            <div className="mt-3 space-y-1.5">
                <SeatStrip council={council} summary={summary} lists={lists} />
                {summary && summary.phase !== 'pre' && !summary.official && <Progress summary={summary} />}
            </div>
        </a>
    );
}

// Dlaždice MČ, kde Piráti nekandidují: stav sčítání a kdo vede. Dva
// sloupce i na telefonu — 36 řádků přes celou šířku bylo přes dva metry rolování.
function OtherRow({ council, summary, lists, fresh }) {
    const live = summary?.votes > 0;
    const [leadId, leadVotes, leadSeats] = live ? summary.parties[0] : [];
    const lead = live ? lists?.[leadId] : null;
    return (
        <a
            href={href(council)}
            className={`block min-w-0 rounded-xl px-3 py-2.5 bg-white border hover:border-black active:bg-neutral-50 transition ${fresh ? 'border-[#FEC900] ring-1 ring-[#FEC900]' : 'border-neutral-200'}`}
        >
            <div className="text-sm font-semibold text-neutral-900 truncate">{council.name.replace(/^Praha-/, '')}</div>
            <div className="text-[11px] text-neutral-500 truncate">
                {live ? (
                    <>
                        <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ backgroundColor: lead?.color || '#6B7280' }} />
                        {lead?.tiny || `č. ${leadId}`} {fmtPct((leadVotes / summary.votes) * 100)} · {leadSeats}/{council.seats}
                    </>
                ) : (
                    `${council.seats} mandátů · ${council.precincts} ${plural(council.precincts, 'okrsek', 'okrsky', 'okrsků')}`
                )}
            </div>
            {summary && summary.phase !== 'pre' && <div className="mt-1"><CountBadge summary={summary} /></div>}
        </a>
    );
}

function Hero({ snapshot, live, lists }) {
    // odpočet tiká jen v hlavičce — ne celá stránka (desítky karet) každou vteřinu
    const now = useNow(1000);
    const phase = snapshot?.phase || (now < POLLS_CLOSE ? 'pre' : 'waiting');
    const s = snapshot?.councils || {};
    const mag = s[MAGISTRAT.zastup];
    const magList = lists[MAGISTRAT.zastup]?.[MAGISTRAT.pirates];
    const magLive = mag?.votes > 0 && mag.pirates;
    const withData = OURS.filter((c) => s[c.zastup]?.votes > 0);
    const seatsMc = withData.reduce((sum, c) => sum + (s[c.zastup].pirates?.seats || 0), 0);
    const passed = withData.filter((c) => s[c.zastup].pirates?.passed).length;
    const seats2022 = OURS.reduce((sum, c) => sum + (lists[c.zastup]?.[c.pirates]?.seats2022 || 0), 0);
    const anyLive = withData.length > 0;
    const allOfficial = anyLive && withData.length === OURS.length && withData.every((c) => s[c.zastup].official);
    const p = snapshot?.precincts;
    const dataTime = DEMO ? snapshot?.fetchedAt : parseCsuTime(snapshot?.generated);

    let line;
    if (phase === 'pre') line = <>Místnosti se zavírají v sobotu 10. 10. ve 14:00 — za <b className="text-[#FEC900] whitespace-nowrap">{countdown(POLLS_CLOSE - now)}</b></>;
    else if (phase === 'waiting' || !p?.counted) line = 'Volby skončily — čekáme na první okrskové komise';
    else line = <>Sečteno <b className="text-white">{fmtInt(p.counted)}</b> z {fmtInt(p.total)} okrsků v MČ ({fmtPct(p.pct)})</>;

    return (
        <header className="bg-black text-white">
            <div className="max-w-5xl mx-auto px-4 md:px-5 pt-5 pb-8 md:pt-7 md:pb-12">
                <div className="flex items-center gap-3">
                    <img src="/brand/logo-full-white.svg" alt="Česká pirátská strana" className="h-8 md:h-10" />
                    <div className="ml-auto flex items-center gap-2">
                        <StatusPill phase={phase} demo={DEMO} stale={live.stale} />
                        <RefreshButton live={live} now={now} demo={DEMO} showLabel="" />
                    </div>
                </div>

                <h1 className="mt-6 font-display text-5xl md:text-7xl leading-[0.85] tracking-wide">
                    Komunální volby <span className="text-[#FEC900]">2026</span> v Praze
                </h1>
                <div className="mt-3 text-sm text-white/70">{line}</div>
                {phase !== 'pre' && p?.total > 0 && <div className="mt-2 max-w-md"><Progress summary={{ counted: p.counted, total: p.total }} dark /></div>}
                {(live.fetching || live.nextAt) && (
                    <div className="mt-2 flex items-start gap-1.5 text-xs text-white/60">
                        <svg className="w-3.5 h-3.5 mt-px shrink-0 text-[#FEC900]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        <span><AutoRefreshNote live={live} now={now} long /></span>
                    </div>
                )}

                <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl bg-white/[0.07] border border-white/10 p-4">
                        <div className="font-condensed text-xs font-bold uppercase tracking-wider text-[#FEC900]">Piráti v městských částech</div>
                        <div className="mt-2 flex items-baseline gap-2">
                            <span className={`font-display text-6xl leading-none tabular-nums ${anyLive ? '' : 'text-white/35'}`}>{anyLive ? seatsMc : seats2022}</span>
                            <span className="text-sm text-white/60">
                                {anyLive ? `${seatsWord(seatsMc)}${allOfficial ? '' : ' (odhad)'}` : `${seatsWord(seats2022)} v roce 2022`}
                            </span>
                        </div>
                        <div className="mt-1 text-xs text-white/55">
                            {anyLive
                                ? `Nad 5 % v ${passed} z ${withData.length} MČ s výsledky · 2022: ${seats2022} ${seatsWord(seats2022)}`
                                : `Kandidujeme v ${OURS.length} z ${OURS.length + ALLIES.length + OTHERS.length} MČ, v dalších ${ALLIES.length} na jiných kandidátkách`}
                        </div>
                    </div>
                    <a href={href(MAGISTRAT)} className="group rounded-2xl bg-white/[0.07] border border-white/10 hover:border-[#FEC900] active:bg-white/[0.12] p-4 transition">
                        <div className="flex items-center justify-between gap-2">
                            <div className="font-condensed text-xs font-bold uppercase tracking-wider text-[#FEC900]">Magistrát · kandidátka č. {MAGISTRAT.pirates}</div>
                            <span className="text-white/40 group-hover:text-[#FEC900]">→</span>
                        </div>
                        <div className="mt-2 flex items-baseline gap-4">
                            <span className={`font-display text-6xl leading-none tabular-nums ${magLive ? '' : 'text-white/35'}`}>{fmtPct(magLive ? mag.pirates.pct : magList?.pct2022)}</span>
                            <span className={`font-display text-4xl leading-none tabular-nums ${magLive ? 'text-[#FEC900]' : 'text-[#FEC900]/35'}`}>
                                {magLive ? mag.pirates.seats : magList?.seats2022 ?? '–'}
                                <span className="ml-1 font-sans text-xs text-white/55">
                                    / {MAGISTRAT.seats} {magLive && !mag.official ? '· odhad' : ''}
                                </span>
                            </span>
                        </div>
                        <div className="mt-1 text-xs text-white/55">
                            {magLive
                                ? `${mag.pirates.rank}. místo · sečteno ${mag.counted} z ${mag.total} okrsků${magList?.pct2022 !== null && magList?.pct2022 !== undefined ? ` · 2022: ${fmtPct(magList.pct2022)}, ${magList.seats2022}` : ''}`
                                : `Výchozí stav: KV 2022 · ${MAGISTRAT.seats} mandátů`}
                        </div>
                    </a>
                </div>

                <div className="mt-3 flex items-center gap-3 text-[11px] text-white/70 tabular-nums">
                    {phase !== 'pre' && dataTime && <span>ČSÚ {fmtTime(dataTime)}</span>}
                    {live.lastSuccess && <span>kontrola {fmtShortTime(live.lastSuccess)}</span>}
                </div>
            </div>
            {live.error && (live.stale || live.status === 'error') && (
                <div className="bg-orange-500/90 text-white text-[11px] px-4 py-1 text-center">
                    {live.stale
                        ? 'Zdroj teď neodpovídá — ukazuji poslední načtená data, zkouším to znovu.'
                        : 'Výsledky se nepodařilo načíst — zkouším to znovu.'}
                </div>
            )}
        </header>
    );
}

export default function Landing() {
    const [statics, setStatics] = useState(null);
    const [sort, setSort] = useState('mc');

    // Podklady přehledu (zkratky, barvy, výsledky 2022) — s opakováním,
    // bez nich se karty vykreslí jen s čísly
    useEffect(() => {
        let cancelled = false;
        let timer;
        const load = async (attempt) => {
            try {
                const r = await fetch('/data/prehled.json');
                if (!r.ok) throw new Error(String(r.status));
                const json = await r.json();
                if (!cancelled) setStatics(json);
            } catch (err) {
                console.warn('Nepodařilo se načíst prehled.json', err);
                if (!cancelled && attempt < 5) timer = setTimeout(() => load(attempt + 1), 3000 * (attempt + 1));
            }
        };
        load(0);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, []);

    const demoFeed = useMemo(
        () => (DEMO && statics ? createOverviewDemoFeed({ councils: COUNCILS, statics, durationMs: DEMO_SECONDS * 1000 }) : null),
        [statics],
    );
    const live = useLiveResults({ source: OVERVIEW_SOURCE, demo: DEMO, demoFeed });
    const snapshot = live.snapshot;
    const lists = useLists(statics);
    const fresh = useFresh(snapshot);
    const s = useMemo(() => snapshot?.councils || {}, [snapshot]);
    const anyLive = OURS.some((c) => s[c.zastup]?.votes > 0);

    const ours = useMemo(() => {
        if (sort === 'mc' || !anyLive) return OURS;
        const pct = (c) => s[c.zastup]?.pirates?.pct ?? -1;
        const seats = (c) => s[c.zastup]?.pirates?.seats ?? -1;
        return [...OURS].sort((a, b) => (sort === 'seats' ? seats(b) - seats(a) : 0) || pct(b) - pct(a));
    }, [sort, anyLive, s]);

    // Titulek záložky: mandáty Pirátů — vidět i z jiné záložky
    useEffect(() => {
        const mag = s[MAGISTRAT.zastup];
        const seatsMc = OURS.reduce((sum, c) => sum + (s[c.zastup]?.votes > 0 ? s[c.zastup].pirates?.seats || 0 : 0), 0);
        document.title = anyLive
            ? `Piráti: MČ ${seatsMc} · Magistrát ${mag?.votes > 0 ? mag.pirates?.seats ?? '–' : '–'} · ${fmtPct(snapshot?.precincts?.pct)} sečteno`
            : 'Volby 2026 · Piráti Praha';
    }, [s, anyLive, snapshot]);

    return (
        <div className="min-h-dvh bg-[#F3F3F1] text-neutral-900 overflow-y-auto">
            <Hero snapshot={snapshot} live={live} lists={lists} />

            <main className="max-w-5xl mx-auto px-4 md:px-5 pt-5 pb-24">
                {DEMO && (
                    <div className="mb-4 rounded-xl bg-[#FFF6D1] border border-[#FEC900] text-neutral-900 text-xs px-3 py-2">
                        <b>Demo</b> — simulované sčítání odvozené z výsledků 2022, ne skutečná data ani predikce.{' '}
                        <a href="/?demo" className="inline-block py-1.5 -my-1.5 underline font-semibold">Spustit znovu</a> · <a href="/" className="inline-block py-1.5 -my-1.5 underline">Skutečné výsledky</a>
                    </div>
                )}

                {/* na telefonu se řazení zalomí pod nadpis, místo aby ho stlačilo do dvou řádků */}
                <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
                    <h2 className="font-display text-3xl md:text-4xl tracking-wide leading-none">
                        Městské části s Piráty <span className="text-neutral-400">{OURS.length}</span>
                    </h2>
                    {anyLive && (
                        <div className="flex rounded-lg bg-white border border-neutral-200 p-0.5 text-xs font-semibold">
                            {[['mc', 'MČ'], ['pct', '%'], ['seats', 'Mandáty']].map(([id, label]) => (
                                <button
                                    key={id}
                                    onClick={() => setSort(id)}
                                    aria-pressed={sort === id}
                                    className={`px-3 py-2 rounded-md ${sort === id ? 'bg-black text-white' : 'text-neutral-500 hover:text-black'}`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {ours.map((c) => (
                        <PirateCard key={c.slug} council={c} summary={s[c.zastup]} lists={lists[c.zastup]} fresh={fresh.has(String(c.zastup))} />
                    ))}
                </div>
                <p className="mt-2 text-[11px] text-neutral-500">
                    Procenta a mandáty jsou do vyhlášení ČSÚ odhad z průběžně sečtených okrsků. Srovnání s 2022 = výsledek
                    předchůdců kandidátky v celé MČ{anyLive ? '; změnu v p. b. ukazujeme až po sečtení všech okrsků' : ''}.
                </p>

                <h2 className="mt-8 font-display text-3xl md:text-4xl tracking-wide leading-none">
                    Piráti na jiných kandidátkách <span className="text-neutral-400">{ALLIES.length}</span>
                </h2>
                <p className="mt-1 text-xs text-neutral-500">
                    Vlastní kandidátku tu nemáme — naši lidé kandidují na kandidátkách místních uskupení. Mandáty jsou do vyhlášení ČSÚ odhad.
                </p>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {ALLIES.map((c) => (
                        <AllyCard key={c.slug} council={c} summary={s[c.zastup]} lists={lists[c.zastup]} fresh={fresh.has(String(c.zastup))} />
                    ))}
                </div>

                <h2 className="mt-8 font-display text-3xl tracking-wide leading-none">
                    Ostatní městské části <span className="text-neutral-400">{OTHERS.length}</span>
                </h2>
                <p className="mt-1 text-xs text-neutral-500">Piráti tu letos nekandidují — výsledky všech kandidátek po rozkliknutí.</p>
                <div className="mt-3 grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
                    {OTHERS.map((c) => (
                        <OtherRow key={c.slug} council={c} summary={s[c.zastup]} lists={lists[c.zastup]} fresh={fresh.has(String(c.zastup))} />
                    ))}
                </div>

                <section className="mt-10 grid gap-6 md:grid-cols-3 text-sm text-neutral-600">
                    <div>
                        <h2 className="font-display text-2xl tracking-wide text-black">Odkud jsou data</h2>
                        <p className="mt-1">
                            Z ČSÚ (volby.gov.cz) přes náš server — stejné soubory, ze kterých čte oficiální výsledková aplikace.
                            Loga stran a část fotek kandidátů z programydovoleb.cz.
                        </p>
                    </div>
                    <div>
                        <h2 className="font-display text-2xl tracking-wide text-black">Mandáty a zvolení</h2>
                        <p className="mt-1">
                            Do vyhlášení ČSÚ je počítáme sami podle zákona: 5% klauzule, d'Hondt a 10% hranice pro
                            preferenční hlasy. Výpočet sedí na všech výsledcích voleb 2022.
                        </p>
                    </div>
                    <div>
                        <h2 className="font-display text-2xl tracking-wide text-black">Vyzkoušet předem</h2>
                        <p className="mt-1">
                            Přehled i každá stránka mají demo sčítání (<a href="/?demo" className="underline"><code className="text-xs bg-white px-1 rounded">?demo</code></a>) — simulaci
                            večera z dat 2022. Čísla v demu nejsou predikce.
                        </p>
                    </div>
                </section>
                <footer className="mt-10 pt-4 border-t border-neutral-200 flex items-center justify-between text-xs text-neutral-400">
                    <span>Verze {APP_VERSION} · data ČSÚ (volby.gov.cz)</span>
                    <button onClick={openChangelog} className="py-2 -my-2 font-semibold text-black hover:underline">Co je nové</button>
                </footer>
                <p className="mt-3 text-[11px] leading-relaxed text-neutral-400/80">
                    Záložní kopie originálu jsemfast/pirati-vysledky-2026 · správce kopie: Václav Vislous ·{' '}
                    <a href="tel:+420777954389" className="underline">777 954 389</a>
                </p>
            </main>
        </div>
    );
}
