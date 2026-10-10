// Hlavička výsledkové stránky: stav živých dat, odpočet do další kontroly,
// ruční obnovení, pruh okrsků a přepínač zastupitelstev.
import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNow } from '../hooks/useNow';
import { useOnline } from '../hooks/useOnline';
import { useDialog } from '../hooks/useDialog';
import { useIsMobile } from '../hooks/useIsMobile';
import { setMapEnabled, useMapEnabled } from '../hooks/useMapPreference';
import { APP_VERSION } from '../changelog';
import { openChangelog } from '../utils/openChangelog';
import { COUNCILS, POLLS_CLOSE } from '../councils';
import { activeCouncil } from '../volby/council';
import { countdown, fmtPct, fmtTime, parseCsuTime, plural } from '../volby/format';
import { ageSeconds, formatAge, liveState, nextCheckLabel } from '../lib/freshness';
import { fmtPragueTime, formatLatencyLine, latencyChain, latencyVisible } from '../lib/latency';
import { PrecinctStrip } from './Precincts';
import { useChangesContext } from '../hooks/useChanges';

// Když Worker nevrací nic použitelného (503 a žádný snapshot), kam se lidé podívají sami
const ORIGINAL_SITE_URL = 'https://pirati-vysledky-2026.pirati-vysledky-2026-cloudflare.workers.dev';
const CSU_RESULTS_URL = 'https://volby.gov.cz/app/kv2026/';

// Dva obyčejné odkazy, kam se podívat, když Worker nic použitelného nevrací
export function NoDataLinks({ linkClass = 'text-[#FEC900]' }) {
    const cls = `inline-block py-1 font-semibold underline ${linkClass}`;
    return (
        <>
            Mezitím se můžeš podívat na{' '}
            <a href={ORIGINAL_SITE_URL} target="_blank" rel="noopener noreferrer" className={cls}>původní web</a>
            {' '}nebo na{' '}
            <a href={CSU_RESULTS_URL} target="_blank" rel="noopener noreferrer" className={cls}>výsledky ČSÚ</a>.
        </>
    );
}

// `state` (live | pre | final | stale | offline z freshness.liveState) má
// přednost; bez něj se stav odvodí z fáze (Landing)
export function StatusPill({ phase, demo, stale, state }) {
    const base = 'font-condensed rounded px-1.5 py-0.5 text-[11px] font-bold tracking-wider whitespace-nowrap shrink-0';
    const st = state ?? (stale ? 'stale' : phase === 'final' ? 'final' : phase === 'counting' || phase === 'waiting' ? 'live' : 'pre');
    if (demo) return <span className={`${base} bg-[#FEC900] text-black`}>DEMO</span>;
    if (st === 'offline') return <span className={`${base} bg-orange-700 text-white`}>OFFLINE</span>;
    if (st === 'stale') return <span className={`${base} bg-orange-700 text-white`}>ZASTARALÉ</span>;
    if (st === 'final') return <span className={`${base} bg-emerald-500 text-white`}>KONEČNÉ</span>;
    if (st === 'live') {
        return (
            <span className={`${base} inline-flex items-center gap-1 bg-red-600 text-white`}>
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> ŽIVĚ
            </span>
        );
    }
    return <span className={`${base} bg-white/15 text-white/80`}>PŘED VOLBAMI</span>;
}

const fmtWait = (sec) => (sec >= 90 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : `${sec} s`);
// Sekundy do další automatické kontroly (null = pauza ve skryté záložce)
// (nextAt je čas serveru, `now` čas klienta → oprava o live.skew)
const nextInOf = (live, now) => (live.nextAt ? Math.max(0, Math.ceil((live.nextAt - (now + (live.skew || 0))) / 1000)) : null);

// Za jak dlouho se stránka sama obnoví — vedle odpočtu, ať ji nikdo
// neobnovuje ručně (rychleji to nebude, jen to zatěžuje server)
export function AutoRefreshNote({ live, now, long = false }) {
    if (live.fetching) return long ? 'Načítám nová data…' : 'načítám…';
    const nextIn = nextInOf(live, now);
    if (nextIn === null) return null;
    return long
        ? <>Stránka se obnoví sama za <b className="text-white tabular-nums">{fmtWait(nextIn)}</b> — není potřeba ji načítat znovu</>
        : `obnoví se samo za ${fmtWait(nextIn)}`;
}

// Ruční obnovení. Do konce odpočtu do další kontroly je ztlumené a kliknutí
// jen řekne, kdy to půjde — dřívější dotaz by zbytečně zatěžoval (data se
// stejně obnovují po minutě).
export function RefreshButton({ live, now, demo = false, showLabel = 'hidden sm:inline' }) {
    const [hint, setHint] = useState(false);
    const nextIn = nextInOf(live, now);
    const blocked = !demo && nextIn !== null && nextIn > 0;
    const onClick = () => {
        if (live.refresh()) return;
        setHint(true);
        setTimeout(() => setHint(false), 3000);
    };
    return (
        <button
            onClick={onClick}
            className={`relative flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 min-h-11 min-w-11 text-xs font-semibold transition-colors ${
                blocked ? 'text-white/45 cursor-not-allowed' : 'text-white/80 hover:text-white hover:bg-white/10'
            }`}
            aria-label={blocked ? `Stránka se obnoví sama za ${fmtWait(nextIn)}` : 'Obnovit výsledky'}
            title={blocked ? `Stránka se obnoví sama za ${fmtWait(nextIn)}` : 'Obnovit výsledky'}
        >
            <svg className={`w-4 h-4 ${live.fetching ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span className={`${showLabel} tabular-nums`}>{nextIn === null ? 'pauza' : fmtWait(nextIn)}</span>
            {hint && (
                <span className="absolute top-full right-0 mt-1 z-10 w-60 rounded bg-white text-neutral-700 text-[11px] text-left font-normal leading-snug px-2 py-1.5 shadow">
                    {nextIn
                        ? <>Stránka se obnoví sama za <b>{fmtWait(nextIn)}</b>. Dřív nová data stejně nebudou — ruční obnovení jen zatěžuje server.</>
                        : 'Zkus to za chvilku'}
                </span>
            )}
        </button>
    );
}

function CouncilMenu({ demo }) {
    const [open, setOpen] = useState(false);
    const close = useCallback(() => setOpen(false), []);
    const panelRef = useDialog(open, close);
    const current = activeCouncil();
    const isMobile = useIsMobile();
    const mapEnabled = useMapEnabled();
    // MČ z druhé půlky seznamu (Praha 11, Zbraslav…) by byla až pod ohybem
    useEffect(() => {
        if (open) panelRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'center' });
    }, [open, panelRef]);
    return (
        <>
            <button
                onClick={() => setOpen(true)}
                aria-label="Vybrat zastupitelstvo"
                aria-expanded={open}
                className="p-2.5 rounded-lg text-white/80 hover:text-white hover:bg-white/10"
            >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
            </button>
            {/* Portál do body: hlavička má vlastní stacking context (relative
                z-[1200]), uvnitř by přes menu přečnívala spodní lišta i brouk */}
            {open && createPortal(
                <div className="fixed inset-0 z-[3000] bg-black/50" onClick={close}>
                    <div
                        ref={panelRef}
                        tabIndex={-1}
                        role="dialog"
                        aria-modal="true"
                        aria-label="Výběr zastupitelstva"
                        className="absolute right-0 top-0 bottom-0 w-[86vw] max-w-sm bg-white shadow-2xl flex flex-col outline-none"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] bg-black text-white flex items-center justify-between">
                            <img src="/brand/logo-full-white.svg" alt="Piráti" className="h-6" />
                            <button onClick={close} aria-label="Zavřít menu" className="p-3 -m-3 text-white/60 hover:text-white">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <nav className="flex-1 overflow-y-auto overscroll-contain p-3 space-y-1">
                            {/* cesta zpátky na přehled hned nahoře, ne až pod 57 MČ */}
                            <a href={demo ? '/?demo' : '/'} className="flex items-center gap-2 rounded-xl px-3 py-3 mb-2 bg-[#FFF6D1] text-neutral-900 font-semibold hover:bg-[#FEC900]">
                                <span aria-hidden="true">←</span> Přehled všech zastupitelstev
                            </a>
                            <div className="font-condensed px-3 pt-1 pb-2 text-xs font-bold uppercase tracking-wider text-neutral-400">Piráti kandidují</div>
                            {COUNCILS.filter((c) => c.pirates).map((c) => {
                                const isCurrent = c.slug === current?.slug;
                                return (
                                    <a
                                        key={c.slug}
                                        href={`/${c.slug}${demo ? '?demo' : ''}`}
                                        aria-current={isCurrent ? 'page' : undefined}
                                        className={`flex items-center justify-between rounded-xl px-3 py-2 ${isCurrent ? 'bg-black text-white' : 'hover:bg-neutral-100 active:bg-neutral-100 text-neutral-800'}`}
                                    >
                                        <span>
                                            <span className="block font-display text-xl leading-none tracking-wide">{c.magistrat ? 'Magistrát' : c.name}</span>
                                            <span className={`block text-[11px] ${isCurrent ? 'text-white/60' : 'text-neutral-500'}`}>
                                                {c.seats} mandátů · {c.precincts} okrsků{c.beta ? ' · beta' : ''}
                                            </span>
                                        </span>
                                        {isCurrent && <span className="text-[#FEC900]">●</span>}
                                    </a>
                                );
                            })}
                            <div className="font-condensed px-3 pt-4 pb-2 text-xs font-bold uppercase tracking-wider text-neutral-400">Piráti na jiných kandidátkách</div>
                            {COUNCILS.filter((c) => !c.pirates && c.pirateCandidates.length).map((c) => {
                                const isCurrent = c.slug === current?.slug;
                                return (
                                    <a
                                        key={c.slug}
                                        href={`/${c.slug}${demo ? '?demo' : ''}`}
                                        aria-current={isCurrent ? 'page' : undefined}
                                        className={`flex items-center justify-between rounded-xl px-3 py-2 ${isCurrent ? 'bg-black text-white' : 'hover:bg-neutral-100 active:bg-neutral-100 text-neutral-800'}`}
                                    >
                                        <span className="min-w-0">
                                            <span className="block font-display text-xl leading-none tracking-wide">{c.name}</span>
                                            <span className={`block text-[11px] truncate ${isCurrent ? 'text-white/60' : 'text-neutral-500'}`}>
                                                {c.pirateCandidates.map((pc) => `${pc.name} (č. ${pc.list})`).join(', ')}
                                            </span>
                                        </span>
                                        {isCurrent && <span className="text-[#FEC900]">●</span>}
                                    </a>
                                );
                            })}
                            <div className="font-condensed px-3 pt-4 pb-2 text-xs font-bold uppercase tracking-wider text-neutral-400">Ostatní městské části</div>
                            <div className="grid grid-cols-2 gap-1">
                                {COUNCILS.filter((c) => !c.pirates && !c.pirateCandidates.length).map((c) => (
                                    <a
                                        key={c.slug}
                                        href={`/${c.slug}${demo ? '?demo' : ''}`}
                                        aria-current={c.slug === current?.slug ? 'page' : undefined}
                                        className={`truncate rounded-lg px-3 py-2.5 text-sm ${c.slug === current?.slug ? 'bg-black text-white' : 'hover:bg-neutral-100 active:bg-neutral-100 text-neutral-700'}`}
                                    >
                                        {c.name.replace(/^Praha-/, '')}
                                    </a>
                                ))}
                            </div>
                            <div className="pt-2 mt-2 border-t border-neutral-100 space-y-1">
                                {isMobile && current?.map && (
                                    // mapa okrsků na telefonu (viz useMapPreference) — vypnutá šetří data
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={mapEnabled}
                                        onClick={() => setMapEnabled(!mapEnabled)}
                                        className="w-full flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-neutral-100 active:bg-neutral-100 text-neutral-800"
                                    >
                                        <span>
                                            <span className="block text-sm font-semibold">Mapa okrsků</span>
                                            <span className="block text-xs text-neutral-500">
                                                {mapEnabled ? 'zapnutá — stahuje podkladovou mapu (~1 MB)' : 'vypnutá — šetří data a baterii'}
                                            </span>
                                        </span>
                                        <span className={`shrink-0 w-11 h-6 rounded-full p-0.5 transition-colors ${mapEnabled ? 'bg-black' : 'bg-neutral-300'}`} aria-hidden="true">
                                            <span className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${mapEnabled ? 'translate-x-5' : ''}`} />
                                        </span>
                                    </button>
                                )}
                                <a href={demo ? `/${current?.slug || ''}` : `/${current?.slug || ''}?demo`} className="block rounded-xl px-3 py-2.5 hover:bg-[#FFF6D1] text-neutral-800">
                                    <div className="text-sm font-semibold">{demo ? 'Ukončit demo' : 'Demo sčítání'}</div>
                                    <div className="text-xs text-neutral-500">
                                        {demo ? 'zpět na skutečná data z volby.gov.cz' : 'simulace večera z dat 2022 — na vyzkoušení'}
                                    </div>
                                </a>
                            </div>
                        </nav>
                        <div className="px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-neutral-100 text-[11px] text-neutral-500 leading-relaxed">
                            Data: ČSÚ (volby.gov.cz). Loga a část fotek: programydovoleb.cz. Mandáty do vyhlášení ČSÚ = odhad.
                            <div className="mt-2 flex items-center justify-between text-xs">
                                <span>Verze {APP_VERSION}</span>
                                <button
                                    onClick={() => {
                                        close();
                                        openChangelog();
                                    }}
                                    className="py-2 -my-2 font-semibold text-black hover:underline"
                                >
                                    Co je nové
                                </button>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body,
            )}
        </>
    );
}

export default function ElectionHeader({ live, snapshot, demo, geoJson, selectedId, onSelectPrecinct, onOpenPrecincts }) {
    const now = useNow(1000);
    // nová data: štítek jednou cinkne, počet okrsků se podbarví a ukáže „▲ +2"
    const { changes, tick: changeTick } = useChangesContext();
    const d = changes?.precincts.delta;
    const newPrecincts = d > 0 ? <> · <span aria-hidden="true">▲</span> +{d} {plural(d, 'okrsek', 'okrsky', 'okrsků')}</> : null;
    const online = useOnline();
    // čas serveru: hodiny klienta + rozdíl z x-server-now (rychlé/pomalé hodiny)
    const nowC = now + (live.skew || 0);
    const council = activeCouncil();
    const phase = snapshot?.phase || 'pre';
    const p = snapshot?.precincts;
    const dataTime = demo ? snapshot?.fetchedAt : parseCsuTime(snapshot?.generated);
    // Worker nevrací nic použitelného: chyba a žádný živý snapshot (ani z reloadu);
    // `snapshot` z props může být jen náhradní (emptySnapshot z kandidátek)
    const unavailable = !live.snapshot && live.status === 'error';
    const pillState = unavailable
        ? 'offline'
        : liveState({ snapshot: snapshot && { ...snapshot, stale: live.stale }, now: nowC, pollsClose: POLLS_CLOSE, online });
    const hasCsuTime = !demo && phase !== 'pre' && !!dataTime;
    const age = hasCsuTime ? ageSeconds(nowC, snapshot.generated) : 0;
    const nextLabel = live.fetching ? null : nextCheckLabel(live.nextAt, nowC);
    // řetězec zpoždění ČSÚ → server → prohlížeč; bez `refreshedAt` (starší Worker) nic
    const lat = live.latency;
    // jen pro první odpověď s tímto `generated`; mimo final/stale/pre/demo skryté
    const latencyLine = hasCsuTime && latencyVisible({ demo, phase, stale: live.stale, latency: lat })
        ? formatLatencyLine(latencyChain(lat), {
            generatedLabel: fmtPragueTime(parseCsuTime(lat.generated)?.getTime()),
            refreshedLabel: fmtPragueTime(lat.refreshedAt),
            // bez použitelných hodin serveru čas prohlížeče neukazujeme
            renderedLabel: lat.skewValid ? fmtPragueTime(lat.renderedAt) : undefined,
        })
        : null;

    // shortLine = telefon: vedle se musí vejít, kdy se stránka sama obnoví
    let line;
    let shortLine;
    if (!snapshot || unavailable) line = live.status === 'error' ? 'Výsledky se nepodařilo načíst — zkusím to znovu.' : 'Načítám výsledky…';
    else if (phase === 'pre') {
        line = `Místnosti se zavírají v sobotu 10. 10. ve 14:00 · za ${countdown(POLLS_CLOSE - nowC)}`;
        shortLine = `Konec voleb v so 14:00 · za ${countdown(POLLS_CLOSE - nowC)}`;
    } else if (phase === 'waiting') {
        line = 'Volby skončily — čekáme na první okrskové komise';
        shortLine = 'Čekáme na první okrsky';
    } else {
        line = `Sečteno ${p.counted} z ${p.total} okrsků (${fmtPct(p.pct)}) · účast ${fmtPct(snapshot.turnout.pct)}`;
        shortLine = `${p.counted}/${p.total} okrsků (${fmtPct(p.pct)}) · účast ${fmtPct(snapshot.turnout.pct)}`;
    }

    return (
        <header className="bg-black text-white shrink-0 z-[1200] relative">
            <div className="px-4 pt-3 pb-2.5 md:px-5 short:pt-1.5 short:pb-1.5">
                <div className="flex items-center gap-3">
                    <a href={demo ? '/?demo' : '/'} className="shrink-0 py-2.5 -my-2.5 px-2.5 -mx-2.5" aria-label="Přehled zastupitelstev">
                        {/* pod 360 px (iPhone SE) jen vlajka — celé logo by vytlačilo název MČ */}
                        <picture>
                            <source media="(max-width: 359px)" srcSet="/brand/favicon.svg" />
                            <img src="/brand/logo-full-white.svg" alt="Piráti" className="h-6 sm:h-7 md:h-8 short:h-6" />
                        </picture>
                    </a>
                    <div className="min-w-0 flex-1 border-l border-white/20 pl-3">
                        <div className="flex items-center gap-2">
                            <span key={changeTick} className={`shrink-0 ${changes ? 'pill-ping' : 'inline-flex'}`}>
                                <StatusPill phase={phase} demo={demo} stale={live.stale} state={pillState} />
                            </span>
                            {/* na telefonu se vedle štítku stavu nevejde (useklo by se na „23 MANDÁ…“);
                                počet mandátů je i v půlkruhu a v menu */}
                            <span className="hidden sm:inline font-condensed text-[11px] uppercase tracking-wider text-white/50 truncate">
                                Komunální volby 2026 · {council?.seats} mandátů
                            </span>
                        </div>
                        <h1 className="font-display text-2xl md:text-3xl short:text-2xl leading-none tracking-wide truncate mt-0.5">
                            {/* na telefonu bez „Praha-“, jinak se dlouhé MČ (Dolní Počernice) useknou */}
                            <span className={`sm:hidden ${(council?.name.replace(/^Praha-/, '').length || 0) > 12 ? 'text-xl' : ''}`}>
                                {council?.name.replace(/^Praha-/, '')}
                            </span>
                            <span className="hidden sm:inline">{council?.name} <span className="text-[#FEC900]">·</span> výsledky</span>
                        </h1>
                    </div>
                    {/* odpočet je ve druhém řádku („obnoví se samo za …“) */}
                    <RefreshButton live={live} now={now} demo={demo} showLabel="hidden" />
                    <CouncilMenu demo={demo} />
                </div>

                <div className="mt-2 short:mt-1 text-[11px] text-white/80 truncate">
                    <span key={`s${changeTick}`} className={`sm:hidden ${changes ? 'text-ping' : ''}`}>{shortLine || line}{newPrecincts}</span>
                    <span key={`l${changeTick}`} className={`hidden sm:inline ${changes ? 'text-ping' : ''}`}>{line}{newPrecincts}</span>
                </div>
                {!demo && (
                    // čerstvost dat — na telefonu i na desktopu (title na dotyku není vidět)
                    <div className="mt-1 short:mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] leading-snug text-white/80 tabular-nums">
                        {hasCsuTime && (
                            <span>
                                ČSÚ data z <b className="font-semibold text-white">{fmtTime(dataTime)}</b>
                                <span className="text-white/60"> · </span>
                                <span className="font-semibold text-white">{formatAge(age)}</span>
                            </span>
                        )}
                        <span>
                            {live.fetching
                            ? 'načítám nová data…'
                            : nextLabel
                                ? <>další kontrola za <b className="font-semibold text-white">{nextLabel}</b></>
                                // bez termínu: skrytá záložka = pauza; při prvním vykreslení zatím nic
                                : document.hidden ? 'kontrola pozastavena' : null}
                        </span>
                    </div>
                )}
                {!demo && pillState === 'live' && (
                    <div className="mt-0.5 short:hidden text-[11px] leading-snug text-white/65">
                        ČSÚ zveřejňuje data zhruba jednou za minutu; stránka se obnovuje sama.
                    </div>
                )}
                {latencyLine && (
                    <details className="mt-0.5 short:hidden text-[11px] leading-snug text-white/80">
                        <summary className="cursor-pointer select-none py-1 text-white/70 hover:text-white">Jak čerstvá jsou data?</summary>
                        <div className="pb-1 tabular-nums">{latencyLine}</div>
                        <div className="pb-1 text-white/65">Kontrola každou minutu, při zpoždění ČSÚ každých 20 s</div>
                    </details>
                )}
                {unavailable && (
                    <div className="mt-1.5 text-xs leading-snug text-white/85">
                        <NoDataLinks />
                    </div>
                )}
                {snapshot && phase !== 'pre' && geoJson && (
                    <div className="mt-2">
                        <PrecinctStrip geoJson={geoJson} snapshot={snapshot} freshIds={live.freshIds} selectedId={selectedId} onSelect={onSelectPrecinct} onOpen={onOpenPrecincts} />
                    </div>
                )}
                {snapshot && phase !== 'pre' && !geoJson && p && (
                    <div className="mt-2 h-1.5 rounded-full bg-white/15 overflow-hidden">
                        <div className="h-full bg-[#FEC900] transition-[width] duration-700" style={{ width: `${p.pct}%` }} />
                    </div>
                )}
            </div>
            {live.stale && live.error && (
                <div className="bg-orange-700 text-white text-xs px-4 py-1.5 leading-snug">
                    Zdroj teď neodpovídá — ukazuji poslední načtená data
                    {hasCsuTime ? ` (ČSÚ data z ${fmtTime(dataTime)}, ${formatAge(age)})` : ''}, zkouším to znovu.
                </div>
            )}
        </header>
    );
}
