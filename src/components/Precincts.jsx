// Okrsky: pruh 52 okrsků (sečteno/nesečteno), detail okrsku, přehled
// postupně přicházejících výsledků a ovládání mapy.
import React, { useEffect, useMemo, useRef } from 'react';
import { activeCouncil, colorOnDark, partyMeta } from '../volby/council';
import { baselineShare, precinctShare, precinctWinner } from '../volby/compute';
import { MAP_MODES, getMapMode, mapModesFor } from '../volby/mapModes';
import { useScaleSource } from '../volby/mapScale';
import { textOn, UNCOUNTED_FILL } from '../volby/colors';
import { fmtInt, fmtPct, fmtShortTime } from '../volby/format';
import { Card, Delta, SectionTitle } from './ui';
import { scrollBehavior } from '../utils/motion';

// Pirátská kandidátka a její předchůdce v roce 2022 (null = žádný)
const ourId = () => activeCouncil().pirates;
const ourBaseline = () => partyMeta(ourId()).baseline?.ids || null;

// onOpen = mobil: jednotlivé dílky (pár px) se nedají trefit prstem, takže
// celý pruh je jedno tlačítko, které otevře seznam okrsků
export function PrecinctStrip({ geoJson, snapshot, freshIds, selectedId, onSelect, onOpen }) {
    const ids = useMemo(
        () => (geoJson?.features || []).map((f) => String(f.properties.cislo)).sort(),
        [geoJson],
    );
    const fresh = new Set(freshIds || []);
    const cells = ids.map((id) => {
        const o = snapshot?.okrsky?.[id];
        const w = precinctWinner(o);
        const Tag = onOpen ? 'span' : 'button';
        return (
            <Tag
                key={id}
                {...(onOpen ? {} : { title: `Okrsek ${id}${o ? '' : ' — čeká'}`, 'aria-label': `Okrsek ${id}`, onClick: () => onSelect(id) })}
                className={`flex-1 rounded-[2px] transition-colors duration-700 ${fresh.has(id) ? 'animate-pulse' : ''} ${
                    selectedId === id ? 'ring-2 ring-[#FEC900] ring-offset-1 ring-offset-[#000000]' : ''
                }`}
                // na černé hlavičce mají Piráti žlutou (jejich barva = barva pozadí)
                style={{ backgroundColor: o ? (w ? colorOnDark(w.id) : '#FFFFFF') : 'rgba(255,255,255,0.18)' }}
            />
        );
    });
    if (onOpen) {
        const counted = ids.filter((id) => snapshot?.okrsky?.[id]).length;
        return (
            <button
                type="button"
                onClick={onOpen}
                aria-label={`Sečteno ${counted} z ${ids.length} okrsků — otevřít seznam`}
                className="block w-full py-3 -my-3"
            >
                <span className="flex gap-[2px] h-2.5" aria-hidden="true">{cells}</span>
            </button>
        );
    }
    return (
        <div className="flex gap-[2px] h-2.5" aria-label="Sečtené okrsky">
            {cells}
        </div>
    );
}

export function MapControls({ modeId, onMode, partyId, onParty, parties, compact = false }) {
    const okrsky = useScaleSource();
    const mode = getMapMode(modeId, { partyId, okrsky });
    // Mobil: režimy jsou vodorovně posuvný pruh — aktivní režim (i ten
    // zapnutý zvenku, např. klepnutím na stranu v Přehledu) posunout do záběru
    const rowRef = useRef(null);
    useEffect(() => {
        const row = rowRef.current;
        const active = row?.querySelector('[aria-pressed="true"]');
        if (!compact || !active) return;
        const left = active.offsetLeft - (row.clientWidth - active.offsetWidth) / 2;
        row.scrollTo({ left, behavior: scrollBehavior() });
    }, [modeId, compact]);
    return (
        <div className={`bg-white/95 backdrop-blur rounded-xl shadow-lg border border-neutral-200 ${compact ? 'p-2' : 'p-2.5'}`}>
            <div
                ref={rowRef}
                // na mobilu pravý okraj vybledne — je vidět, že pruh pokračuje
                className={`relative flex gap-1 ${compact ? 'overflow-x-auto -mx-1 px-1 [scrollbar-width:none] [mask-image:linear-gradient(to_right,black_85%,transparent)]' : 'flex-wrap'}`}
            >
                {mapModesFor(activeCouncil()).map((m) => (
                    <button
                        key={m.id}
                        onClick={() => onMode(m.id)}
                        aria-pressed={modeId === m.id}
                        className={`rounded-lg font-semibold transition-colors whitespace-nowrap shrink-0 ${compact ? 'px-3 py-2 text-sm' : 'px-2 py-1 text-xs'} ${
                            modeId === m.id ? 'bg-[#000000] text-white' : 'text-neutral-600 hover:bg-neutral-100'
                        }`}
                    >
                        {m.label}
                    </button>
                ))}
            </div>
            {modeId === 'party' && (
                <select
                    aria-label="Strana na mapě"
                    value={partyId}
                    onChange={(e) => onParty(Number(e.target.value))}
                    className="mt-2 w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm bg-white"
                >
                    {parties.map((p) => (
                        <option key={p.id} value={p.id}>{p.meta.short}</option>
                    ))}
                </select>
            )}
            {!compact && (
                <div className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                    {MAP_MODES.find((m) => m.id === modeId)?.long}
                </div>
            )}
            {mode.legend && compact && (
                // mobil: legenda jako jeden pruh se dvěma krajními popisky
                <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-neutral-500">
                    <span className="shrink-0">{mode.legend[mode.legend.length - 1].label}</span>
                    <span className="flex-1 flex h-2.5 rounded overflow-hidden">
                        {[...mode.legend].reverse().map((l) => (
                            <span key={l.label} className="flex-1" style={{ backgroundColor: l.color }} />
                        ))}
                    </span>
                    <span className="shrink-0">{mode.legend[0].label}</span>
                    <span className="shrink-0 w-2.5 h-2.5 rounded-sm border border-dashed border-neutral-500" style={{ backgroundColor: UNCOUNTED_FILL }} title="čeká na sečtení" />
                </div>
            )}
            {mode.legend && !compact && (
                <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5">
                    {mode.legend.map((l) => (
                        <div key={l.label} className="flex items-center gap-1.5 text-[10px] text-neutral-600">
                            <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: l.color }} />
                            {l.label}
                        </div>
                    ))}
                </div>
            )}
            {modeId === 'winner' && (
                <div className={`mt-1.5 grid ${compact ? 'grid-cols-3' : 'grid-cols-2'} gap-x-3 gap-y-0.5`}>
                    {parties.filter((p) => p.share).slice(0, 6).map((p) => (
                        <div key={p.id} className="flex items-center gap-1.5 text-[10px] text-neutral-600">
                            <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: p.meta.color }} />
                            {p.meta.tiny}
                        </div>
                    ))}
                </div>
            )}
            {(!compact || !mode.legend) && (
                <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-neutral-500">
                    <span className="w-3 h-3 rounded-sm border border-dashed border-neutral-500" style={{ backgroundColor: UNCOUNTED_FILL }} /> čeká na sečtení
                </div>
            )}
        </div>
    );
}

export function PrecinctDetail({ id, snapshot, results2022, arrivals, onClose }) {
    const o = snapshot?.okrsky?.[id];
    const r22 = results2022?.okrsky?.[id];
    const rows = useMemo(() => {
        if (!o?.votes) return [];
        const total = Object.values(o.votes).reduce((s, v) => s + v, 0) || 1;
        return Object.entries(o.votes)
            .filter(([pid]) => pid !== '0')
            .map(([pid, v]) => {
                const meta = partyMeta(Number(pid));
                const then = meta.baseline ? baselineShare(results2022, meta.baseline.ids, id) : null;
                const pct = (v / total) * 100;
                return { id: Number(pid), meta, votes: v, pct, delta: then === null ? null : pct - then };
            })
            .sort((a, b) => b.votes - a.votes);
    }, [o, results2022, id]);
    const max = Math.max(...rows.map((r) => r.pct), 1);
    const coalition = precinctShare(o, activeCouncil().coalition?.lists || []);
    const ours22 = ourBaseline() ? baselineShare(results2022, ourBaseline(), id) : null;

    return (
        <Card className="p-4 shadow-xl">
            <div className="flex items-start justify-between gap-2">
                <div>
                    <div className="text-lg font-extrabold text-neutral-900">Okrsek {id}</div>
                    <div className="text-[11px] text-neutral-500">
                        {o ? (arrivals?.[id] ? `sečteno v ${fmtShortTime(arrivals[id])}` : 'sečteno') : 'čeká na sečtení'}
                        {o && ` · účast ${fmtPct(o.turnout)}`}
                        {r22?.voters > 0 && ` (2022: ${fmtPct((r22.envelopes / r22.voters) * 100)})`}
                    </div>
                </div>
                <button onClick={onClose} aria-label="Zavřít detail okrsku" className="p-3 -m-3 text-neutral-400 hover:text-neutral-700">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            {!o?.votes ? (
                <div className="mt-3 text-sm text-neutral-600">
                    {o ? 'Okrsek je sečtený, rozpad po stranách se ještě načítá.' : 'Komise okrsek ještě nesečetla.'}
                    {ours22 !== null && (
                        <div className="mt-1 text-xs text-neutral-500">Minule (2022) {partyMeta(ourId()).baseline?.label}: <b>{fmtPct(ours22)}</b></div>
                    )}
                </div>
            ) : (
                <>
                    <div className="mt-3 space-y-1.5">
                        {rows.map((r) => (
                            <div key={r.id} className={`text-xs ${r.id === ourId() ? 'font-bold' : ''}`}>
                                <div className="flex items-center gap-2">
                                    <span className="w-20 truncate text-neutral-700">{r.meta.tiny}</span>
                                    <span className="flex-1 h-2 rounded-full bg-neutral-100 overflow-hidden">
                                        <span className="block h-full rounded-full" style={{ width: `${(r.pct / max) * 100}%`, backgroundColor: r.meta.color }} />
                                    </span>
                                    <span className="w-12 text-right tabular-nums">{fmtPct(r.pct)}</span>
                                    {r.delta === null ? <span className="w-20" /> : <Delta value={r.delta} className="w-20 text-right text-[11px]" />}
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className={`mt-3 pt-2 border-t border-neutral-100 grid ${activeCouncil().coalition ? 'grid-cols-3' : 'grid-cols-2'} gap-2 text-center`}>
                        {activeCouncil().coalition && (
                            <div>
                                <div className="text-[11px] text-neutral-500">Současná koalice</div>
                                <div className="text-sm font-bold tabular-nums">{fmtPct(coalition)}</div>
                            </div>
                        )}
                        <div>
                            <div className="text-[11px] text-neutral-500">Voličů</div>
                            <div className="text-sm font-bold tabular-nums">{fmtInt(o.voters)}</div>
                        </div>
                        <div>
                            <div className="text-[11px] text-neutral-500">Obálek</div>
                            <div className="text-sm font-bold tabular-nums">{fmtInt(o.envelopes)}</div>
                        </div>
                    </div>
                    <div className="mt-2 text-[11px] text-neutral-500">Změna = proti předchůdci kandidátky v KV 2022 v tomto okrsku.</div>
                </>
            )}
        </Card>
    );
}

export function ArrivalsFeed({ snapshot, arrivals, results2022, onSelect, freshIds }) {
    const fresh = new Set(freshIds || []);
    const items = Object.keys(snapshot?.okrsky || {})
        .map((id) => ({ id, at: arrivals?.[id] ?? null, o: snapshot.okrsky[id] }))
        .sort((a, b) => (b.at ?? 0) - (a.at ?? 0) || a.id.localeCompare(b.id));
    const total = snapshot?.precincts?.total || 52;

    return (
        <Card className="p-4">
            <SectionTitle right={<span className="text-[11px] text-neutral-500 tabular-nums">{items.length} / {total}</span>}>
                Sečtené okrsky
            </SectionTitle>
            {items.length === 0 ? (
                <div className="text-sm text-neutral-400 py-4 text-center">Zatím žádný okrsek. Komise začnou posílat výsledky po 14:00.</div>
            ) : (
                <ul className="divide-y divide-neutral-100">
                    {items.map(({ id, at, o }) => {
                        // bez Pirátů v zastupitelstvu ukázat podíl vítěze okrsku
                        const ours = ourId() ? precinctShare(o, ourId()) : null;
                        const then = ourBaseline() ? baselineShare(results2022, ourBaseline(), id) : null;
                        const w = precinctWinner(o);
                        return (
                            <li key={id}>
                                <button
                                    onClick={() => onSelect(id)}
                                    className={`w-full flex items-center gap-2.5 py-2 px-1 text-left rounded-lg hover:bg-neutral-50 active:bg-neutral-100 ${fresh.has(id) ? 'bg-[#FFF6D1]' : ''}`}
                                >
                                    <span className="w-11 text-[11px] text-neutral-500 tabular-nums">{at ? fmtShortTime(at) : '—'}</span>
                                    <span className="text-sm font-bold text-neutral-900 tabular-nums">{id}</span>
                                    {w && (
                                        <span className="text-[10px] font-semibold rounded px-1.5 py-0.5" style={{ backgroundColor: partyMeta(w.id).color, color: textOn(partyMeta(w.id).color) }}>
                                            {partyMeta(w.id).tiny}
                                        </span>
                                    )}
                                    <span className="ml-auto text-right">
                                        <span className="text-sm font-semibold tabular-nums text-[#000000]">{fmtPct(ourId() ? ours : w?.pct)}</span>
                                        {ours !== null && then !== null && <Delta value={ours - then} className="block text-[11px]" />}
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
            <div className="mt-2 text-[11px] text-neutral-500">
                Čas = kdy okrsek poprvé viděl tento prohlížeč.{' '}
                {ourId() ? 'Procento = Piráti, změna proti jejich výsledku v KV 2022 ve stejném okrsku.' : 'Procento = vítěz okrsku.'}
            </div>
        </Card>
    );
}
