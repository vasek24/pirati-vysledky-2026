// Koalice: současná koalice (podle src/councils.js), skládačka vlastní
// koalice a seznam všech minimálních většinových kombinací.
import React, { useMemo, useRef, useState } from 'react';
import { activeCouncil, partyMeta } from '../volby/council';
import { sumSeats } from '../volby/compute';
import { fmtInt, fmtPct, mandatesLabel } from '../volby/format';
import { Card, ChangeCue, PartyChip, SectionTitle } from './ui';
import { useChangesContext } from '../hooks/useChanges';
import { seatsCueText } from '../lib/changes';
import { scrollBehavior } from '../utils/motion';

// Políčko za každý mandát, barevně podle stran v koalici, značka za většinou
export function SeatBar({ seatsById, members, height = 'h-3' }) {
    const { seats: total, majority } = activeCouncil();
    const cells = [];
    for (const id of members) for (let i = 0; i < (seatsById[id] || 0); i++) cells.push(partyMeta(id).color);
    return (
        <div className="relative">
            <div className={`flex gap-[2px] ${height}`}>
                {Array.from({ length: total }, (_, i) => (
                    <div
                        key={i}
                        className="flex-1 rounded-[2px] transition-colors duration-500"
                        style={{ backgroundColor: cells[i] || '#E5E5E3' }}
                    />
                ))}
            </div>
            <div
                className="absolute -top-1 -bottom-1 w-0.5 bg-neutral-900 rounded"
                style={{ left: `calc(${(majority / total) * 100}% - 1px)` }}
                title={`Většina = ${majority}`}
            />
        </div>
    );
}

function MajorityBadge({ seats }) {
    const diff = seats - activeCouncil().majority;
    if (diff >= 0) {
        return (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 text-white text-xs font-bold px-2.5 py-1">
                ✓ většina{diff > 0 ? ` (+${diff})` : ' (těsná)'}
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1 rounded-full bg-orange-600 text-white text-xs font-bold px-2.5 py-1">
            chybí {mandatesLabel(-diff)}
        </span>
    );
}

export function CoalitionHero({ model }) {
    const { coalition, seatsById, hasVotes, official, ours, snapshot, council } = model;
    const baseLabel = ours?.meta.baseline?.label || 'předchůdce';
    // změna mandátů Pirátů za poslední aktualizaci (šipka nad číslem, nic neposouvá)
    const changeCtx = useChangesContext();
    const seatCue = ours ? seatsCueText(changeCtx.changes?.parties.get(ours.id)) : '';
    // Společná kandidátka (Piráti a Starostové, Piráti, PRAHA 3 SOBĚ a Edita
    // Janečková…) má vlastní název — pirátské logo nad ním by bez něj tvrdilo,
    // že jde o samotné Piráty
    const listName = ours && !/^(Česká pirátská strana|Piráti)$/i.test(ours.meta.name || '') ? ours.meta.name : null;
    if (!ours && !council.coalition) return null;
    return (
        <Card className="overflow-hidden">
            {ours && (
                <div className="bg-[#000000] text-white px-4 pt-4 pb-3">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <img src="/brand/logo-full-white.svg" alt="Piráti" className="h-5" />
                                <span className="font-condensed text-xs font-bold uppercase tracking-wider text-[#FEC900]">
                                    kandidátka č. {ours.id}
                                </span>
                            </div>
                            {listName && <div className="mt-1.5 text-sm font-semibold leading-snug text-white">{listName}</div>}
                            {ours.meta.note && <div className="mt-0.5 text-[11px] text-white/60">{ours.meta.note}</div>}
                            {/* procento ani změna se nesmí zalomit (na 320 px se lámalo „20,4 / %“) */}
                            <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
                                <span className={`font-display text-5xl min-[360px]:text-6xl leading-none tabular-nums whitespace-nowrap ${hasVotes ? '' : 'text-white/35'}`}>{fmtPct(hasVotes ? ours.share : ours.baseline)}</span>
                                {hasVotes && ours.delta !== null && (
                                    <span className={`text-sm font-bold tabular-nums whitespace-nowrap ${ours.delta >= 0 ? 'text-emerald-300' : 'text-orange-300'}`}>
                                        {ours.delta >= 0 ? '▲' : '▼'} {fmtPct(Math.abs(ours.delta)).replace(' %', '')} p. b.
                                    </span>
                                )}
                            </div>
                            <div className="text-xs text-white/60 mt-0.5">
                                {ours.baseline === null
                                    ? 'Bez srovnatelného výsledku z roku 2022'
                                    : !hasVotes
                                        ? `Výchozí stav: KV 2022 (${baseLabel})`
                                        : model.baselineScope
                                            ? `2022 ve stejných ${model.baselineScope} okrscích: ${fmtPct(ours.baseline)} · celkem ${fmtPct(ours.baselineTotal)}, ${mandatesLabel(ours.baselineSeats || 0)}`
                                            : `2022 (${baseLabel}): ${fmtPct(ours.baseline)} · ${mandatesLabel(ours.baselineSeats || 0)}`}
                            </div>
                        </div>
                        <div className="relative text-right shrink-0">
                            <ChangeCue text={seatCue} className="-top-3 right-0" />
                            <div className={`font-display text-5xl min-[360px]:text-6xl leading-none tabular-nums ${hasVotes ? 'text-[#FEC900]' : 'text-[#FEC900]/35'}`}>{hasVotes ? ours.seats : ours.baselineSeats ?? '–'}</div>
                            <div className="text-[11px] text-white/60">{!hasVotes ? 'mandátů v 2022' : official ? 'mandátů' : 'mandátů (odhad)'}</div>
                        </div>
                    </div>
                    {hasVotes && !official && ours.passed && (
                        <div className="mt-2 text-[11px] text-white/70">
                            {ours.toNext !== null && <>Další mandát: chybí <b className="text-white">{fmtInt(ours.toNext)}</b> hlasů (≈ {fmtInt(Math.ceil(ours.toNext / ours.candidates))} voličů s „velkým křížkem")</>}
                            {ours.margin !== null && ours.seats > 0 && <> · rezerva posledního: <b className="text-white">{fmtInt(ours.margin)}</b> hl.</>}
                        </div>
                    )}
                </div>
            )}

            {council.coalition && (
                <div className="p-4">
                    <div className="flex items-center justify-between gap-2">
                        <div className="font-condensed text-xs font-bold uppercase tracking-wider text-neutral-500">Současná koalice</div>
                        {hasVotes ? <MajorityBadge seats={coalition.seats} /> : <span className="text-[11px] text-neutral-500">čeká na výsledky</span>}
                    </div>
                    <div className="mt-1 flex items-baseline gap-2">
                        <span className={`font-display text-5xl leading-none tabular-nums ${hasVotes ? 'text-neutral-900' : 'text-neutral-400'}`}>{hasVotes ? coalition.seats : coalition.seats2022}</span>
                        <span className="text-sm text-neutral-500">/ {hasVotes ? council.seats : coalition.seatsTotal2022} mandátů{hasVotes ? '' : ' v 2022'}</span>
                        {hasVotes && <span className="ml-auto text-[11px] text-neutral-500">2022: {coalition.seats2022}/{coalition.seatsTotal2022}</span>}
                    </div>
                    <div className="mt-2.5">
                        <SeatBar seatsById={hasVotes ? seatsById : {}} members={coalition.members} />
                    </div>
                    <div className="mt-1.5 text-[11px] text-neutral-500">{coalition.label} · většina {coalition.majority} z {council.seats}</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        {coalition.members.map((id) => (
                            <PartyChip key={id} id={id}>
                                {partyMeta(id).short} {hasVotes ? `· ${seatsById[id] || 0}` : ''}
                            </PartyChip>
                        ))}
                    </div>
                    {hasVotes && !official && (
                        <div className="mt-2 text-[11px] text-neutral-500">
                            Odhad z {snapshot.precincts.counted} / {snapshot.precincts.total} sečtených okrsků — může se ještě hýbat.
                        </div>
                    )}
                </div>
            )}
        </Card>
    );
}

export function LastSeatCard({ model }) {
    if (!model.lastSeat) return null;
    const { holder, challenger } = model.lastSeat;
    return (
        <Card className="p-4">
            <SectionTitle>Boj o poslední mandát</SectionTitle>
            <div className="text-sm text-neutral-700 space-y-1.5">
                <div className="flex items-start gap-2">
                    <span className="w-2.5 h-2.5 mt-1.5 rounded-full shrink-0" style={{ backgroundColor: holder.meta.color }} />
                    <span>{activeCouncil().seats}. mandát teď drží <b>{holder.meta.short}</b>{holder.margin !== null && <> (rezerva {fmtInt(holder.margin)} hl.)</>}</span>
                </div>
                {challenger && (
                    <div className="flex items-start gap-2">
                        <span className="w-2.5 h-2.5 mt-1.5 rounded-full shrink-0" style={{ backgroundColor: challenger.meta.color }} />
                        <span>
                            Nejblíž dalšímu: <b>{challenger.meta.short}</b> — chybí {fmtInt(challenger.toNext)} hl.
                            <span className="text-neutral-500"> (≈ {fmtInt(Math.ceil(challenger.toNext / challenger.candidates))} voličů)</span>
                        </span>
                    </div>
                )}
            </div>
        </Card>
    );
}

export default function CoalitionPanel({ model }) {
    const { seatsById, coalitions, hasVotes, parties, council, coalition } = model;
    const [picked, setPicked] = useState(coalition.members);
    const [onlyOurs, setOnlyOurs] = useState(!!council.pirates);

    const pickedSeats = sumSeats(seatsById, picked);
    const list = useMemo(
        () => coalitions.filter((c) => !onlyOurs || c.members.includes(council.pirates)),
        [coalitions, onlyOurs, council.pirates],
    );
    const isCurrent = (members) =>
        members.length === coalition.members.length && coalition.members.every((id) => members.includes(id));
    const toggle = (id) => setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    // Výběr ze seznamu přepíše skládačku nad ním — ta bývá odrolovaná mimo
    // obrazovku, tak k ní posunout, ať je vidět, co se stalo
    const builderRef = useRef(null);
    const isPicked = (members) => members.length === picked.length && members.every((id) => picked.includes(id));
    const pick = (members) => {
        setPicked(members);
        const el = builderRef.current;
        if (el && el.getBoundingClientRect().top < 0) {
            el.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
        }
    };

    // Kdo z koalice je nejblíž dalšímu mandátu (kde se vyplatí přidat)
    const nearest = hasVotes
        ? coalition.members.map((id) => model.byId[id]).filter((p) => p?.passed && p.toNext > 0).sort((a, b) => a.toNext - b.toNext)
        : [];

    return (
        <div className="space-y-3">
            <CoalitionHero model={model} />

            {nearest.length > 0 && (
                <Card className="p-4">
                    <SectionTitle>Koalici do dalšího mandátu chybí</SectionTitle>
                    <div className="space-y-1.5">
                        {nearest.map((p) => (
                            <div key={p.id} className="flex items-center gap-2 text-sm">
                                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.meta.color }} />
                                <span className="flex-1 text-neutral-700">{p.meta.short}</span>
                                <span className="tabular-nums font-semibold text-neutral-900">{fmtInt(p.toNext)} hl.</span>
                                <span className="tabular-nums text-[11px] text-neutral-500 w-24 text-right">≈ {fmtInt(Math.ceil(p.toNext / p.candidates))} voličů</span>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            <div ref={builderRef} className="scroll-mt-3">
                <Card className="p-4">
                    <SectionTitle>Sestav si koalici</SectionTitle>
                    <div className="flex flex-wrap gap-1.5">
                        {parties.map((p) => (
                            <PartyChip key={p.id} id={p.id} active={picked.includes(p.id)} onClick={() => toggle(p.id)} size="md">
                                {p.meta.short}{hasVotes ? ` · ${p.seats}` : ''}
                            </PartyChip>
                        ))}
                    </div>
                    <div className="mt-3 flex items-baseline gap-2">
                        <span className="font-display text-4xl leading-none tabular-nums">{hasVotes ? pickedSeats : '—'}</span>
                        <span className="text-sm text-neutral-500">/ {council.seats}</span>
                        <span className="ml-auto">{hasVotes && picked.length > 0 && <MajorityBadge seats={pickedSeats} />}</span>
                    </div>
                    <div className="mt-2">
                        <SeatBar seatsById={hasVotes ? seatsById : {}} members={picked} />
                    </div>
                    {hasVotes && picked.length > 0 && (
                        <div className="mt-2 text-[11px] text-neutral-500">
                            Hlasy stran v koalici: {fmtPct(picked.reduce((s, id) => s + (model.byId[id]?.share || 0), 0))}
                        </div>
                    )}
                </Card>
            </div>

            <Card className="p-4">
                <SectionTitle
                    right={council.pirates && (
                        <label className="flex items-center gap-2 py-2.5 -my-2.5 pl-3 text-xs text-neutral-600 cursor-pointer">
                            <input type="checkbox" checked={onlyOurs} onChange={(e) => setOnlyOurs(e.target.checked)} className="w-4 h-4 accent-[#000000]" />
                            jen s Piráty
                        </label>
                    )}
                >
                    Možné většinové koalice
                </SectionTitle>
                {!hasVotes ? (
                    <div className="text-sm text-neutral-400">Spočítá se z prvních výsledků.</div>
                ) : list.length === 0 ? (
                    <div className="text-sm text-neutral-500">Podle aktuálního odhadu žádná většinová koalice{onlyOurs ? ' s Piráty' : ''} neexistuje.</div>
                ) : (
                    <ul className="divide-y divide-neutral-100">
                        {list.map((c) => (
                            <li key={c.members.join('-')}>
                                <button
                                    onClick={() => pick(c.members)}
                                    aria-pressed={isPicked(c.members)}
                                    className={`w-full flex items-center gap-2 py-2.5 text-left rounded-lg px-1.5 ${
                                        isPicked(c.members) ? 'bg-[#FFF6D1]' : 'hover:bg-neutral-50 active:bg-neutral-100'
                                    }`}
                                >
                                    <div className="flex flex-wrap gap-1 flex-1">
                                        {[...c.members]
                                            .sort((a, b) => (seatsById[b] || 0) - (seatsById[a] || 0))
                                            .map((id) => (
                                                <PartyChip key={id} id={id}>
                                                    {partyMeta(id).tiny} {seatsById[id]}
                                                </PartyChip>
                                            ))}
                                    </div>
                                    {isCurrent(c.members) && <span className="text-[10px] font-bold text-[#000000] bg-[#FEC900] rounded-full px-2 py-0.5 shrink-0">současná</span>}
                                    <span className="text-sm font-bold tabular-nums w-14 text-right shrink-0">
                                        {c.seats} <span className="text-[11px] font-semibold text-neutral-500">+{c.seats - coalition.majority}</span>
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                <div className="mt-2 text-[11px] text-neutral-500">
                    Minimální koalice = odchodem kterékoli strany by o většinu ({coalition.majority}) přišla. Seřazeno od nejmenšího počtu stran.
                </div>
            </Card>
        </div>
    );
}
