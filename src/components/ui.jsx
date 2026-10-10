// Drobné sdílené prvky výsledkové stránky
import React, { useState } from 'react';
import { partyMeta } from '../volby/council';
import { textOn } from '../volby/colors';
import { fmtPp } from '../volby/format';

export function PartyDot({ id, className = 'w-2.5 h-2.5' }) {
    return (
        <span
            className={`inline-block rounded-full shrink-0 ${className}`}
            style={{ backgroundColor: partyMeta(id).color }}
        />
    );
}

// Logo kandidátky (u koalic loga členských stran přes sebe), jinak barevná tečka
export function PartyLogo({ id, size = 20, className = '' }) {
    const meta = partyMeta(id);
    const [failed, setFailed] = useState(false);
    if (!meta.logos.length || failed) {
        return <PartyDot id={id} className={`w-2.5 h-2.5 ${className}`} />;
    }
    return (
        <span className={`inline-flex shrink-0 items-center ${className}`} title={meta.name}>
            {meta.logos.slice(0, 3).map((src, i) => (
                <img
                    key={src}
                    src={src}
                    alt=""
                    loading="lazy"
                    onError={() => setFailed(true)}
                    className="rounded bg-white object-contain ring-1 ring-black/5"
                    style={{ height: size, maxWidth: size * 2.2, marginLeft: i ? -size * 0.25 : 0, zIndex: 10 - i }}
                />
            ))}
        </span>
    );
}

export function PartyChip({ id, active = true, onClick, children, size = 'sm' }) {
    const meta = partyMeta(id);
    const Tag = onClick ? 'button' : 'span';
    return (
        <Tag
            onClick={onClick}
            className={`inline-flex items-center gap-1.5 rounded-full border font-medium transition-colors ${
                size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-3 py-2'
            } ${active ? 'border-transparent' : 'bg-white text-neutral-500 border-neutral-200 hover:border-neutral-400'}`}
            style={active ? { backgroundColor: meta.color, color: textOn(meta.color) } : undefined}
        >
            {!active && <PartyDot id={id} className="w-2 h-2" />}
            {children ?? meta.short}
        </Tag>
    );
}

export function Card({ className = '', children, accent = false }) {
    return (
        <section
            className={`bg-white rounded-2xl border ${accent ? 'border-[#FEC900] ring-2 ring-[#FEC900]/50' : 'border-neutral-200/80'} shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${className}`}
        >
            {children}
        </section>
    );
}

export function SectionTitle({ children, right }) {
    return (
        <div className="flex items-center justify-between mb-2">
            <h3 className="font-condensed text-xs font-bold uppercase tracking-wider text-neutral-500">{children}</h3>
            {right}
        </div>
    );
}

// Šipka s textem u řádku, kterému se právě pohnula čísla (viz hooks/useChanges).
// Plave přes okraj řádku (absolute), takže nic neposouvá; text je „▲ +123",
// barva tedy není jediná nápověda. Čtečka dostane jednu větu jinde (aria-live).
export function ChangeCue({ text, className = '-top-2 right-2' }) {
    if (!text) return null;
    return (
        <span
            aria-hidden="true"
            className={`pointer-events-none absolute z-10 max-w-[92%] truncate whitespace-nowrap rounded-full bg-black px-1.5 py-px text-[10px] font-bold leading-4 tabular-nums text-[#FEC900] shadow ${className}`}
        >
            {text}
        </span>
    );
}

export function Delta({ value, className = '' }) {
    if (value === null || value === undefined) return null;
    const tone = value > 0.05 ? 'text-emerald-700' : value < -0.05 ? 'text-orange-700' : 'text-neutral-500';
    return <span className={`tabular-nums ${tone} ${className}`}>{fmtPp(value)}</span>;
}

// Fotka kandidáta, nebo iniciály v barvě strany (i když se fotka nenačte)
export function Avatar({ person, size = 40, ring = false }) {
    const [failed, setFailed] = useState(false);
    const meta = partyMeta(person.partyId);
    const style = { width: size, height: size };
    if (person.photo && !failed) {
        return (
            <img
                src={person.photo}
                alt={person.display}
                loading="lazy"
                onError={() => setFailed(true)}
                className={`rounded-full object-cover object-top shrink-0 bg-neutral-100 ${ring ? 'ring-2 ring-[#FEC900]' : ''}`}
                style={style}
            />
        );
    }
    return (
        <span
            className={`rounded-full shrink-0 inline-flex items-center justify-center font-bold ${ring ? 'ring-2 ring-[#FEC900]' : ''}`}
            style={{ ...style, backgroundColor: meta.color, color: textOn(meta.color), fontSize: Math.round(size * 0.36) }}
        >
            {person.initials}
        </span>
    );
}

export function Pill({ tone = 'stone', children, className = '' }) {
    const tones = {
        stone: 'bg-neutral-100 text-neutral-600',
        green: 'bg-emerald-50 text-emerald-700',
        amber: 'bg-amber-50 text-amber-800',
        yellow: 'bg-[#FEC900] text-[#000000]',
        red: 'bg-red-50 text-red-700',
        dark: 'bg-[#000000] text-white',
    };
    return (
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${tones[tone]} ${className}`}>
            {children}
        </span>
    );
}
