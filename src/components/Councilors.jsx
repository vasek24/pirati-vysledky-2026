// Zvolení zastupitelé (odhad podle průběžných čísel, po vyhlášení oficiální).
// Pirátská kandidátka má fotky (vlastní nebo z programydovoleb.cz), „na hraně" a celé
// pořadí preferenčních hlasů; ostatní strany kompaktní seznam.
import React, { useEffect, useMemo, useState } from 'react';
import { partyMeta } from '../volby/council';
import { fmtInt, fmtPct, mandatesLabel } from '../volby/format';
import Hemicycle from './Hemicycle';
import { Avatar, Card, ChangeCue, PartyLogo, Pill, SectionTitle } from './ui';
import { candidateChange, useChangesContext } from '../hooks/useChanges';
import { scrollBehavior } from '../utils/motion';

const cardId = (p) => `cand-${p.partyId}-${p.n}`;

function PersonCard({ person, hasVotes, focused }) {
    const change = candidateChange(useChangesContext(), `${person.partyId}-${person.n}`);
    return (
        <div
            id={cardId(person)}
            className={`flex items-center gap-3 rounded-xl border p-2.5 bg-white transition-shadow ${change.className} ${
                focused ? 'border-[#000000] ring-2 ring-[#FEC900]' : 'border-neutral-200'
            }`}
        >
            <ChangeCue text={change.cue} />
            <Avatar person={person} size={52} />
            <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-neutral-900 leading-tight truncate">{person.display}</div>
                <div className="text-[11px] text-neutral-500 truncate">{person.job || person.affiliation}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                    <Pill>{person.n}. na listině</Pill>
                    {hasVotes && <Pill tone="stone">{fmtInt(person.votes)} hl. · {fmtPct(person.pct)}</Pill>}
                    {person.jumped && <Pill tone="green">↑ preferencemi</Pill>}
                </div>
            </div>
        </div>
    );
}

function CompactRow({ person, hasVotes, focused, muted = false }) {
    const change = candidateChange(useChangesContext(), `${person.partyId}-${person.n}`);
    return (
        <div
            id={cardId(person)}
            className={`flex items-center gap-2.5 py-1.5 px-1.5 rounded-lg ${change.className} ${focused ? 'bg-[#FFF6D1] ring-1 ring-[#FEC900]' : ''} ${muted ? 'opacity-70' : ''}`}
        >
            <ChangeCue text={change.cue} className="-top-1.5 right-1" />
            <Avatar person={person} size={28} />
            <div className="min-w-0 flex-1">
                <div className="text-sm text-neutral-800 truncate">
                    {person.display}
                    {person.jumped && <span className="ml-1 text-[10px] font-bold text-emerald-700">↑</span>}
                    {/* člen(ka) Pirátů na kandidátce jiného uskupení */}
                    {person.affiliation === 'Piráti' && <span className="ml-1.5 rounded bg-[#FEC900] px-1 py-px text-[10px] font-bold text-black">Piráti</span>}
                </div>
            </div>
            <span className="text-[11px] text-neutral-500 tabular-nums">#{person.n}</span>
            {hasVotes && <span className="text-xs tabular-nums text-neutral-600 w-16 text-right">{fmtInt(person.votes)}</span>}
        </div>
    );
}

// Piráti na kandidátce jiného uskupení (MČ bez pirátské kandidátky,
// councils.js pirateCandidates): jestli by měli mandát a kolik mají hlasů
export function PirateCandidates({ model }) {
    const { hasVotes, official } = model;
    const people = (model.council.pirateCandidates || [])
        .map((pc) => model.councilors[pc.list]?.list.find((c) => c.n === pc.n))
        .filter(Boolean);
    if (!people.length) return null;
    return (
        <Card className="p-4" accent>
            <SectionTitle>Piráti na jiné kandidátce</SectionTitle>
            <div className="text-xs text-neutral-500 mb-3">Vlastní kandidátku tu nemáme — naši lidé kandidují za místní uskupení.</div>
            <div className="space-y-3">
                {people.map((person) => (
                    <div key={cardId(person)} className="flex items-center gap-3">
                        <Avatar person={person} size={52} ring />
                        <div className="min-w-0 flex-1">
                            <div className="text-sm font-bold text-neutral-900 leading-tight truncate">{person.display}</div>
                            <div className="text-[11px] text-neutral-500 truncate">{person.n}. na kandidátce {partyMeta(person.partyId).short}</div>
                            {hasVotes && (
                                <div className="mt-1 flex flex-wrap items-center gap-1">
                                    <Pill tone={person.seat ? 'yellow' : 'stone'}>{person.seat ? 'má mandát' : 'bez mandátu'}{official ? '' : ' · odhad'}</Pill>
                                    <Pill>{fmtInt(person.votes)} hl. · {fmtPct(person.pct)}</Pill>
                                    {person.jumped && <Pill tone="green">↑ preferencemi</Pill>}
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </Card>
    );
}

export default function Councilors({ model }) {
    const { hasVotes, official, councilors, byId } = model;
    const [focus, setFocus] = useState(null);
    const [showAll, setShowAll] = useState(false);

    const oursId = model.council.pirates;
    const ours = councilors[oursId];
    const oursParty = byId[oursId];
    const oursElected = ours ? ours.list.filter((c) => c.seat) : [];
    const oursNext = ours ? ours.list.filter((c) => !c.seat).slice(0, 3) : [];
    const others = model.parties.filter((p) => p.id !== oursId && p.seats > 0);

    // Celá kandidátka seřazená podle preferenčních hlasů
    const byVotes = useMemo(
        () => (ours ? [...ours.list].sort((a, b) => b.votes - a.votes || a.n - b.n) : []),
        [ours],
    );

    useEffect(() => {
        if (!focus) return;
        document.getElementById(cardId(focus))?.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
    }, [focus]);

    const isFocused = (p) => focus && focus.partyId === p.partyId && focus.n === p.n;

    return (
        <div className="space-y-3">
            <Card className="p-4">
                <SectionTitle right={<span className="text-[11px] text-neutral-500">{official ? 'oficiálně zvolení' : hasVotes ? 'odhad' : ''}</span>}>
                    Zastupitelstvo
                </SectionTitle>
                <Hemicycle model={model} onSelectPerson={setFocus} />
            </Card>

            {!ours && <PirateCandidates model={model} />}

            {ours && (
                <Card className="p-4" accent>
                    <SectionTitle
                        right={hasVotes && <span className="text-xs font-bold text-[#000000]">{mandatesLabel(oursParty.seats)}</span>}
                    >
                        <span className="inline-flex items-center gap-2">
                            <PartyLogo id={oursId} size={18} />
                            {partyMeta(oursId).short}
                        </span>
                    </SectionTitle>

                    {!hasVotes ? (
                        <>
                            <div className="text-xs text-neutral-500 mb-2">Pirátská kandidátka — prvních 10. Po sečtení prvních okrsků se tu ukáže, kdo by byl zvolen.</div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {ours.list.slice(0, 10).map((c) => (
                                    <PersonCard key={c.n} person={c} hasVotes={false} focused={isFocused(c)} />
                                ))}
                            </div>
                        </>
                    ) : (
                        <>
                            {oursElected.length === 0 ? (
                                <div className="text-sm text-neutral-500">Podle aktuálního stavu bez mandátu.</div>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {oursElected.map((c) => (
                                        <PersonCard key={c.n} person={c} hasVotes focused={isFocused(c)} />
                                    ))}
                                </div>
                            )}

                            {oursNext.length > 0 && (
                                <div className="mt-3 pt-3 border-t border-neutral-100">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">Na hraně</span>
                                        {oursParty.toNext !== null && !official && (
                                            <span className="text-[11px] text-neutral-500">další mandát: chybí {fmtInt(oursParty.toNext)} hl.</span>
                                        )}
                                    </div>
                                    {oursNext.map((c) => (
                                        <CompactRow key={c.n} person={c} hasVotes focused={isFocused(c)} muted />
                                    ))}
                                </div>
                            )}

                            <div className="mt-3 pt-3 border-t border-neutral-100">
                                <button onClick={() => setShowAll((v) => !v)} className="py-2.5 -my-2.5 text-sm font-semibold text-[#000000] hover:underline">
                                    {showAll ? 'Skrýt' : 'Zobrazit'} pořadí podle preferenčních hlasů
                                </button>
                                {showAll && (
                                    <div className="mt-2">
                                        {ours.limit !== null && (
                                            <div className="text-[11px] text-neutral-500 mb-1">
                                                Hranice pro posun vpřed: <b>{fmtInt(Math.ceil(ours.limit))}</b> hlasů (110 % průměru na kandidáta)
                                            </div>
                                        )}
                                        <ol className="divide-y divide-neutral-100">
                                            {byVotes.map((c, i) => (
                                                <li key={c.n} className="flex items-center gap-2 py-1 text-sm">
                                                    <span className="w-5 text-[11px] text-neutral-500 tabular-nums">{i + 1}.</span>
                                                    <Avatar person={c} size={22} />
                                                    <span className={`flex-1 truncate ${c.seat ? 'font-semibold text-neutral-900' : 'text-neutral-600'}`}>{c.display}</span>
                                                    <span className="text-[11px] text-neutral-500 tabular-nums">#{c.n}</span>
                                                    {c.preferred && <span className="text-[10px] font-bold text-emerald-700">nad hranicí</span>}
                                                    <span className="w-14 text-right tabular-nums text-xs">{fmtInt(c.votes)}</span>
                                                </li>
                                            ))}
                                        </ol>
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </Card>
            )}

            {others.map((p) => (
                <Card key={p.id} className="p-4">
                    <SectionTitle right={<span className="text-xs font-bold text-neutral-700">{mandatesLabel(p.seats)}</span>}>
                        <span className="inline-flex items-center gap-1.5">
                            <PartyLogo id={p.id} size={16} />
                            {p.meta.short}
                        </span>
                    </SectionTitle>
                    {councilors[p.id].list.filter((c) => c.seat).map((c) => (
                        <CompactRow key={c.n} person={c} hasVotes={hasVotes} focused={isFocused(c)} />
                    ))}
                </Card>
            ))}
        </div>
    );
}
