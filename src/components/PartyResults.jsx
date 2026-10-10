// Výsledky stran: podíl hlasů, mandáty (odhad / oficiální), srovnání s 2022
import React, { useState } from 'react';
import { fmtInt, fmtPct } from '../volby/format';
import { Card, ChangeCue, Delta, PartyLogo, SectionTitle } from './ui';
import { partyChange, useChangesContext } from '../hooks/useChanges';

// U kandidátek, jejichž předchůdce se rozdělil, jen informace bez změny v p. b.
function SplitInfo({ split }) {
    return (
        <span className="tabular-nums" title="Kandidátky z roku 2022 se letos přeskupily — změnu nelze férově spočítat">
            2022 {split.map((s) => `${s.label} ${fmtPct(s.share)}`).join(' · ')}
        </span>
    );
}

export default function PartyResults({ model, onSelectParty, selectedParty }) {
    const { parties, hasVotes, official, threshold, council } = model;
    const changeCtx = useChangesContext();
    // U Magistrátu (24 kandidátek) schovat drobné strany pod „další"
    const [showAll, setShowAll] = useState(false);
    const many = parties.length > 12;
    const visible = many && !showAll
        ? parties.filter((p, i) => i < 10 || p.seats > 0 || p.id === council.pirates)
        : parties;
    const maxShare = Math.max(30, ...parties.map((p) => p.share || 0), ...parties.map((p) => p.baseline || 0));
    const scale = (v) => `${Math.min(100, ((v || 0) / maxShare) * 100)}%`;

    return (
        <Card className="p-4">
            <SectionTitle
                right={
                    <span className="text-[11px] text-neutral-500">
                        {hasVotes ? (official ? 'oficiální mandáty' : 'mandáty = odhad z průběžných čísel') : 'v závorce KV 2022'}
                    </span>
                }
            >
                Strany
            </SectionTitle>
            <div className="space-y-1">
                {visible.map((p) => {
                    const ours = p.meta.pirates;
                    const below = hasVotes && !p.passed;
                    const selected = selectedParty === p.id;
                    const exact = p.meta.baseline?.exact;
                    // Bez mapy (Magistrát) klepnutí na stranu nemá co ukázat — pak jen řádek
                    const Row = onSelectParty ? 'button' : 'div';
                    const change = partyChange(changeCtx, p.id);
                    return (
                        <Row
                            key={p.id}
                            {...(onSelectParty ? { type: 'button', onClick: () => onSelectParty(p.id), 'aria-pressed': selected } : {})}
                            className={`block w-full text-left rounded-xl px-2.5 py-2 transition-colors ${change.className} ${
                                ours ? 'bg-[#FFF6D1]' : selected ? 'bg-neutral-100' : onSelectParty ? 'hover:bg-neutral-50 active:bg-neutral-100' : ''
                            } ${below ? 'opacity-60' : ''}`}
                        >
                            <ChangeCue text={change.cue} />
                            <div className="flex items-center gap-2">
                                <PartyLogo id={p.id} size={20} />
                                {/* celý název kandidátky, nejvýš na dva řádky (na telefonu se dlouhé názvy useknou) */}
                                <span className={`text-sm leading-tight line-clamp-2 break-words min-w-0 flex-1 ${ours ? 'font-bold text-black' : 'font-semibold text-neutral-800'}`} title={p.fullName}>
                                    {p.meta.short}
                                </span>
                                {hasVotes ? (
                                    <>
                                        <span className="text-sm font-bold tabular-nums text-neutral-900">{fmtPct(p.share)}</span>
                                        <span
                                            className={`ml-1 min-w-[2.75rem] text-right text-sm tabular-nums ${p.seats ? 'font-extrabold text-neutral-900' : 'text-neutral-400'}`}
                                            title={official ? 'Mandáty' : 'Odhad mandátů'}
                                        >
                                            {p.seats}
                                            <span className="text-[11px] font-semibold text-neutral-500 ml-0.5">m.</span>
                                        </span>
                                    </>
                                ) : (
                                    <span className="text-xs tabular-nums text-neutral-400">
                                        {p.baseline !== null ? `(${fmtPct(p.baseline)})` : p.split2022 ? '–' : 'nová'}
                                    </span>
                                )}
                            </div>

                            <div className="relative h-2 mt-1.5 rounded-full bg-neutral-100 overflow-hidden">
                                {p.baseline !== null && (
                                    <div
                                        className="absolute inset-y-0 left-0 border-r-2 border-neutral-400/70"
                                        style={{ width: scale(p.baseline) }}
                                        title="KV 2022"
                                    />
                                )}
                                <div
                                    className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700"
                                    style={{ width: scale(p.share), backgroundColor: p.meta.color }}
                                />
                                <div className="absolute inset-y-0 w-px bg-red-400/70" style={{ left: scale(threshold) }} title={`Hranice ${threshold} %`} />
                            </div>

                            {!hasVotes && (p.meta.note || p.split2022) && (
                                <div className="mt-1 text-[11px] text-neutral-500">
                                    {p.meta.note}
                                    {p.meta.note && p.split2022 && ' · '}
                                    {p.split2022 && <SplitInfo split={p.split2022} />}
                                </div>
                            )}

                            {hasVotes && (
                                <div className="flex flex-wrap items-center gap-x-2 mt-1 text-[11px] text-neutral-500">
                                    <span className="tabular-nums">{fmtInt(p.votes)} hl.</span>
                                    {p.baseline !== null && (
                                        <>
                                            <span className="text-neutral-300">·</span>
                                            <span className="tabular-nums">
                                                {exact ? '2022' : `2022 ≈ ${p.meta.baseline.label}`}: {fmtPct(p.baseline)}
                                            </span>
                                            <Delta value={p.delta} className="font-semibold" />
                                        </>
                                    )}
                                    {p.split2022 && (
                                        <>
                                            <span className="text-neutral-300">·</span>
                                            <SplitInfo split={p.split2022} />
                                        </>
                                    )}
                                    {below && <span className="ml-auto font-semibold text-red-600">pod {threshold} %</span>}
                                </div>
                            )}
                        </Row>
                    );
                })}
            </div>
            {many && (
                <button onClick={() => setShowAll((v) => !v)} className="mt-1 py-2.5 text-sm font-semibold text-black hover:underline">
                    {showAll ? 'Skrýt menší kandidátky' : `Zobrazit všech ${parties.length} kandidátek`}
                </button>
            )}
            <div className="mt-2 flex items-center gap-3 text-[11px] text-neutral-500">
                <span className="flex items-center gap-1">
                    <span className="inline-block w-3 border-t-2 border-neutral-400/70" />
                    KV 2022{model.baselineScope ? ` (stejných ${model.baselineScope} okrsků)` : ''}
                </span>
                <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-px bg-red-400" /> hranice {threshold} %</span>
            </div>
        </Card>
    );
}
