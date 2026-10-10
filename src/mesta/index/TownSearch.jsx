// Vyhledávání: APG editable combobox (list autocomplete, první návrh je aktivní).
// Návrhy jsou překryv pod lepivou lištou (stránka se neposouvá), ≤ 6 na telefonu
// a 8 na desktopu. Hledá se jen ve statickém indexu — žádný dotaz na server.
// Město → /<slug>, kraj → rozbalí sekci, obec mimo přehled / Praha / neověřené
// město → jen informační řádek. V režimu `mine` se vybírá Moje obec.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { MAX_QUERY, search } from '../search.js';
import { moreText, townsText } from '../indexModel.js';

const OPEN_URL = 'https://volby.gov.cz/app/kv2026/cs/20261009/home';
const plural = (n) => (n === 1 ? 'návrh' : n >= 2 && n <= 4 ? 'návrhy' : 'návrhů');

export default function TownSearch({ index, townCount, limit, mode, councilByZastup, viewOf, onOpenTown, onChooseMine, onOpenKraj, onEndMine, say }) {
    const uid = useId();
    const listId = `${uid}-list`;
    const inputRef = useRef(null);
    const [value, setValue] = useState('');
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(0);
    const [info, setInfo] = useState(null); // { text, url }
    const choosing = mode === 'mine';

    const result = useMemo(() => {
        if (!value.trim()) return { items: [], total: 0, fuzzy: false };
        if (!choosing) return search(index, value, { limit });
        // „Změnit": jen města (ne kraj, ne obce mimo přehled), počet „dalších" také jen z měst
        const towns = search(index, value, { limit: 40 }).items.filter((o) => o.kind === 'town');
        return { items: towns.slice(0, limit), total: towns.length, fuzzy: false };
    }, [index, value, limit, choosing]);
    const options = result.items;
    const shown = open && value.trim() !== '';

    // jeden polite stavový řádek: počet návrhů po odmlce 500 ms, ne při každém znaku
    useEffect(() => {
        if (!value.trim()) return undefined;
        const t = setTimeout(() => say(options.length ? `${options.length} ${plural(options.length)}.` : 'Nic nenalezeno.'), 500);
        return () => clearTimeout(t);
    }, [value, options.length, say]);

    // režim „vyberte svou obec": pole dostane fokus, pokyn je odvozený (ne stav)
    useEffect(() => {
        if (choosing) inputRef.current?.focus();
    }, [choosing]);
    const shownInfo = info ?? (choosing ? { text: 'Vyberte svou obec z návrhů.' } : null);

    const clear = () => {
        setValue('');
        setOpen(false);
        setActive(0);
    };

    function choose(o) {
        if (!o) return;
        setOpen(false);
        if (o.kind === 'town') {
            const council = councilByZastup.get(o.zastup);
            clear();
            if (choosing) {
                setInfo(null);
                onChooseMine(council);
            } else onOpenTown(council);
        } else if (o.kind === 'kraj') {
            clear();
            onOpenKraj(o.kraj);
        } else if (o.kind === 'verify') {
            setInfo({ text: `${o.name}: způsob kandidatury Pirátů ještě ověřujeme, výsledky tu ukážeme po ověření.` });
            say(`${o.name}: způsob kandidatury ještě ověřujeme.`);
        } else {
            setInfo({ text: `${o.note}.`, url: o.url });
            say(`${o.name}: ${o.note}.`);
        }
    }

    function onKeyDown(ev) {
        const n = options.length;
        if (ev.key === 'ArrowDown') {
            ev.preventDefault();
            if (!open) setOpen(true);
            else if (n) setActive((active + 1) % n);
        } else if (ev.key === 'ArrowUp') {
            ev.preventDefault();
            if (open && n) setActive(active <= 0 ? n - 1 : active - 1);
        } else if (ev.key === 'Enter') {
            if (shown && n) {
                ev.preventDefault();
                choose(options[Math.min(active, n - 1)]);
            }
        } else if (ev.key === 'Escape') {
            if (shown) setOpen(false);
            else {
                clear();
                if (choosing) { setInfo(null); onEndMine(); }
            }
        } else if (ev.key === 'Tab') setOpen(false);
    }

    const activeId = shown && options.length ? `${uid}-o${Math.min(active, options.length - 1)}` : undefined;
    // šipkami vybraný návrh musí zůstat vidět i v rolujícím popupu
    useEffect(() => {
        if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
    }, [activeId]);

    return (
        <div className="mi-sbar">
            <div
                className="mi-combo"
                onBlur={(ev) => { if (!ev.currentTarget.contains(ev.relatedTarget)) setOpen(false); }}
            >
                <label htmlFor={`${uid}-q`} className="mi-sr">{choosing ? 'Napište svou obec' : 'Najít město nebo okres'}</label>
                <svg className="mi-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 21 21" strokeLinecap="round" /></svg>
                <input
                    ref={inputRef}
                    id={`${uid}-q`}
                    className="mi-inp"
                    type="text"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={shown}
                    aria-controls={listId}
                    aria-activedescendant={activeId}
                    aria-describedby={`${uid}-hint`}
                    placeholder={choosing ? 'Napište svou obec' : 'Najít město nebo okres'}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck="false"
                    enterKeyHint="search"
                    maxLength={MAX_QUERY}
                    value={value}
                    onChange={(ev) => { setValue(ev.target.value); setActive(0); setOpen(true); }}
                    onFocus={() => { if (value.trim()) setOpen(true); }}
                    onKeyDown={onKeyDown}
                />
                <span id={`${uid}-hint`} className="mi-sr">Návrhy se ukazují během psaní, šipkami je vyberete, Enter otevře město.</span>
                {value && (
                    <button type="button" className="mi-clear" aria-label="Vymazat hledání" onClick={() => { clear(); inputRef.current?.focus(); }}>×</button>
                )}
                <div className="mi-pop" hidden={!shown}>
                    <ul id={listId} role="listbox" aria-label="Návrhy">
                        {shown && options.map((o, i) => (
                            <Option key={`${o.kind}-${o.zastup ?? o.kraj ?? o.name}`} id={`${uid}-o${i}`} option={o} selected={i === active} view={o.kind === 'town' ? viewOf(councilByZastup.get(o.zastup)) : null} onChoose={() => choose(o)} />
                        ))}
                    </ul>
                    {shown && <PopNote value={value} options={options} result={result} townCount={townCount} />}
                </div>
            </div>
            {shownInfo && (
                <div className="mi-info">
                    <span>{shownInfo.text}{shownInfo.url && <> <a href={shownInfo.url}>{shownInfo.url.replace('https://', '')}</a></>}</span>
                    <button type="button" aria-label="Zavřít" onClick={() => { setInfo(null); if (choosing) onEndMine(); inputRef.current?.focus(); }}>×</button>
                </div>
            )}
        </div>
    );
}

function Option({ id, option: o, selected, view, onChoose }) {
    const live = view && view.piratePct !== null;
    return (
        <li
            id={id}
            role="option"
            aria-selected={selected}
            className={`mi-opt mi-o-${o.kind}`}
            onMouseDown={(ev) => ev.preventDefault()}
            onClick={onChoose}
        >
            <span className="mi-o-name">{o.name}</span>
            {live && <span className="mi-o-side">{view.val}<small>{view.timeLabel}</small></span>}
            <span className="mi-o-sub">
                {o.kind === 'town' && o.sub}
                {o.kind === 'kraj' && `${townsText(o.count)} · otevřít v seznamu`}
                {o.kind === 'verify' && o.note}
                {o.kind === 'other' && (o.url ? `${o.note} → ${o.url.replace('https://', '')}` : o.note)}
            </span>
        </li>
    );
}

function PopNote({ value, options, result, townCount }) {
    if (!options.length) {
        return (
            <div className="mi-pop-note">
                <b>{`„${value.trim()}“ jsme nenašli.`}</b><br />
                Přehled má {townsText(townCount)}, kde Piráti kandidují samostatně nebo v koalici. Ostatní obce: <a href={OPEN_URL}>výsledky ČSÚ</a>.
            </div>
        );
    }
    if (result.fuzzy) return <div className="mi-pop-note">Přesnou shodu nemáme — myslíte některé z těchto?</div>;
    if (result.total > options.length) return <div className="mi-pop-note">{moreText(result.total - options.length)}</div>;
    return null;
}
