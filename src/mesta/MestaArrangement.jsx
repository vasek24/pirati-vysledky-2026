// Banner „Jak tu kandidují Piráti" na začátku přehledu městské stránky.
// Logika je v arrangement.js; tady jen vykreslení (mobil first, bez barvy jako jediné nápovědy).
import React from 'react';
import { arrangementView } from './arrangement.js';

const HEADING_ID = 'mesta-arr-heading';

function Row({ p }) {
    return (
        <li className="flex items-start justify-between gap-3 py-2">
            <div className="min-w-0">
                <div className="text-sm font-bold text-neutral-900 leading-tight break-words">{p.name}</div>
                <div className="text-xs text-neutral-600 leading-snug break-words">{p.where}</div>
            </div>
            {p.votesLabel && (
                <div className="shrink-0 text-right">
                    <div className="text-xs tabular-nums text-neutral-700">{p.votesLabel}</div>
                    <span
                        className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4 ${
                            p.seat ? 'bg-[#FEC900] text-black' : 'bg-neutral-100 text-neutral-600'
                        }`}
                    >
                        {p.seatLabel}
                    </span>
                </div>
            )}
        </li>
    );
}

export default function MestaArrangement({ council, model }) {
    const view = arrangementView({ council, model });
    if (!view) return null;
    const settled = !view.pending && view.people.length > 0;
    return (
        <section
            aria-labelledby={HEADING_ID}
            className={`rounded-2xl border bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${
                view.neutral ? 'border-neutral-300' : 'border-[#FEC900] ring-2 ring-[#FEC900]/50'
            }`}
        >
            <h2 id={HEADING_ID} className="font-display text-2xl leading-none tracking-wide text-black">
                {view.heading}
            </h2>
            <p className="mt-2 text-sm font-semibold text-neutral-900 leading-snug">{view.title}</p>
            {view.lines.map((line) => (
                <p key={line} className="mt-1 text-sm text-neutral-700 leading-snug">{line}</p>
            ))}
            {settled && (
                <div className="mt-3 border-t border-neutral-100 pt-3">
                    <h3 className="font-condensed text-xs font-bold uppercase tracking-wider text-neutral-600">{view.peopleTitle}</h3>
                    <ul className="mt-1 divide-y divide-neutral-100">
                        {view.people.map((p) => <Row key={p.key} p={p} />)}
                    </ul>
                    {view.moreLabel && <p className="pt-2 text-sm text-neutral-700">{view.moreLabel}</p>}
                </div>
            )}
            {view.alsoElsewhere && <p className="mt-3 text-xs text-neutral-700 leading-snug">{view.alsoElsewhere}</p>}
            <p className="mt-3 text-xs text-neutral-600 leading-snug">{view.footer}</p>
        </section>
    );
}
