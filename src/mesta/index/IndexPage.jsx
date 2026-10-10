// Stránka indexu mesta.dg12.cz podle docs/analysis/mesta-index-ux-proposal.md.
// Dostává data jako props (COUNCILS = jen zobrazená města, skrytá zvlášť, SHARDS,
// REGIONS, excluded.generated.json), takže ji jde pustit i s jinými daty. Žádné součty za kraj ani republiku; mandáty jen vyhlášené.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNow } from '../../hooks/useNow.js';
import { useOnline } from '../../hooks/useOnline.js';
import {
    allProgress, bestSource, buildRegions, doneSet, featuredShardIds, flatOrder, initialOpenRegions, newlyCounted, regionHeader, rowView, townsText,
} from '../indexModel.js';
import { buildIndex } from '../search.js';
import FeaturedTowns from './FeaturedTowns.jsx';
import IndexHeader from './IndexHeader.jsx';
import IndexStyles from './IndexStyles.jsx';
import ListControls from './ListControls.jsx';
import MyTown from './MyTown.jsx';
import RegionSection from './RegionSection.jsx';
import ShardSubscriber from './ShardSubscriber.jsx';
import TownRow from './TownRow.jsx';
import TownSearch from './TownSearch.jsx';
import { useMediaQuery, useShardSnapshot } from './useRowVisibility.js';
import { useMyTown } from './useMyTown.js';

const NO_IDS = [];
const wideNow = () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;

export default function IndexPage({ councils, hidden = NO_IDS, shards, regions, excluded = NO_IDS, aliases, version, fetchImpl }) {
    const myTown = useMyTown(councils);
    const [onlyDone, setOnlyDone] = useState(false);
    const model = useMemo(() => buildRegions(councils, shards, regions), [councils, shards, regions]);
    const featuredIds = useMemo(() => featuredShardIds(shards), [shards]);
    const allIds = useMemo(() => (onlyDone ? model.flatMap((r) => r.shardIds) : NO_IDS), [onlyDone, model]);
    const mineShard = myTown.mine ? myTown.mine.featured ?? myTown.mine.shard : null;
    return (
        <ShardSubscriber shards={shards} version={version} fetchImpl={fetchImpl} featured={featuredIds} mineShard={mineShard} allIds={allIds}>
            <IndexBody
                councils={councils} hidden={hidden} excluded={excluded} aliases={aliases} model={model}
                myTown={myTown} onlyDone={onlyDone} setOnlyDone={setOnlyDone}
            />
        </ShardSubscriber>
    );
}

function IndexBody({ councils, hidden, excluded, aliases, model, myTown, onlyDone, setOnlyDone }) {
    const snapshot = useShardSnapshot();
    const online = useOnline();
    const now = useNow(30_000) + (snapshot.skew || 0);
    const active = useMemo(() => new Set(snapshot.active), [snapshot.active]);
    const wide = useMediaQuery('(min-width: 1024px)');

    const [view, setView] = useState('kraje');
    const [open, setOpen] = useState(() => new Set(wideNow() ? initialOpenRegions(model) : []));
    const [doneSnap, setDoneSnap] = useState(() => new Set());
    const [searchMode, setSearchMode] = useState('search');
    const [status, setStatus] = useState('');
    const [toast, setToast] = useState('');
    const pendingFocus = useRef(null);
    const sayTimer = useRef(0);
    const toastTimer = useRef(0);

    const councilByZastup = useMemo(() => new Map(councils.map((c) => [c.zastup, c])), [councils]);
    const shown = useMemo(() => new Set(councils.map((c) => c.zastup)), [councils]);
    const index = useMemo(
        () => buildIndex(councils, aliases, excluded, { unverified: hidden }),
        [councils, aliases, excluded, hidden],
    );
    const featured = useMemo(() => councils.filter((c) => c.featured).sort((a, b) => b.population - a.population), [councils]);

    // hodnoty všech řádků (79 měst — levné); řádek se překreslí jen při změně viewKey
    const { views, summaries } = useMemo(() => {
        const v = new Map();
        const s = {};
        for (const c of councils) {
            const src = bestSource(c, snapshot);
            if (src.summary) s[c.zastup] = src.summary;
            v.set(c.zastup, rowView(c, src.summary, now, { status: src.status, stale: src.stale }));
        }
        return { views: v, summaries: s };
    }, [councils, snapshot, now]);
    const viewOf = useCallback((c) => views.get(c.zastup), [views]);

    const say = useCallback((text) => {
        clearTimeout(sayTimer.current);
        setStatus('');
        sayTimer.current = setTimeout(() => setStatus(text), 30);
    }, []);
    const showToast = useCallback((text) => {
        setToast(text);
        clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(''), 3500);
    }, []);
    useEffect(() => () => { clearTimeout(sayTimer.current); clearTimeout(toastTimer.current); }, []);
    useEffect(() => { document.title = 'Piráti ve městech 2026 · Komunální volby'; }, []);

    // po rozbalení kraje z hledání / seznamu skoků: srolovat a zaostřit hlavičku
    useEffect(() => {
        const kraj = pendingFocus.current;
        if (kraj === null) return;
        pendingFocus.current = null;
        const section = document.getElementById(`kraj-${kraj}`);
        if (!section) return;
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        section.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
        section.querySelector('button')?.focus({ preventScroll: true });
    });

    const openRegion = useCallback((kraj) => {
        setView('kraje');
        setOpen((o) => new Set(o).add(kraj));
        pendingFocus.current = kraj;
        const r = model.find((x) => x.kraj === kraj);
        if (r) say(`${r.name}: ${townsText(r.zastups.length)}, načítám výsledky.`);
    }, [model, say]);

    const toggleRegion = useCallback((kraj) => {
        const expanding = !open.has(kraj);
        setOpen((o) => {
            const n = new Set(o);
            if (n.has(kraj)) n.delete(kraj);
            else n.add(kraj);
            return n;
        });
        const r = model.find((x) => x.kraj === kraj);
        if (r) say(expanding ? `${r.name}: ${townsText(r.zastups.length)}, načítám výsledky.` : `${r.name}: sbaleno.`);
        if (expanding && document.getElementById(`kraj-${kraj}`).getBoundingClientRect().top < 0) pendingFocus.current = kraj;
    }, [model, open, say]);

    // první město otevřené z indexu se zapamatuje jako Moje obec
    const { rememberIfEmpty, set: setMine } = myTown;
    const onOpenTown = useCallback((c) => { rememberIfEmpty(c); }, [rememberIfEmpty]);
    const openFromSearch = useCallback((c) => {
        const remembered = rememberIfEmpty(c);
        say(`Otevírám ${c.name}.${remembered ? ` Uloženo jako Moje obec: ${c.name}.` : ''}`);
        window.location.assign(`/${c.slug}`);
    }, [rememberIfEmpty, say]);
    const chooseMine = useCallback((c) => {
        setMine(c);
        setSearchMode('search');
        showToast(`${c.name} je teď vaše obec (jen v tomto prohlížeči).`);
        say(`Uloženo jako Moje obec: ${c.name}.`);
    }, [setMine, say, showToast]);

    const toggleDone = () => {
        if (onlyDone) {
            setOnlyDone(false);
            say('Zobrazena všechna města.');
            return;
        }
        // filtr hned podle známých dat; co se dočte, nabídne tlačítko v rezervovaném pruhu
        const snap = doneSet(summaries, councils);
        setDoneSnap(snap);
        setOnlyDone(true);
        say(`Zobrazeno ${townsText(snap.size)}. Načítám stav ostatních krajů.`);
    };
    const showNew = () => {
        const snap = doneSet(summaries, councils);
        setDoneSnap(snap);
        say(`Přidáno: ${townsText(newlyCounted(summaries, councils, doneSnap).length)}.`);
    };
    const fresh = onlyDone ? newlyCounted(summaries, councils, doneSnap) : NO_IDS;
    const progress = onlyDone ? allProgress(model, snapshot.shards) : { text: null };
    const bar = progress.text ? { fresh: 0, text: progress.text } : { fresh: fresh.length, text: 'Seznam sečtených měst je aktuální.' };
    const pass = (c) => !onlyDone || doneSnap.has(c.zastup);
    const emptyText = 'Zatím žádné sečtené město.';

    const rowFor = (c) => <TownRow key={c.zastup} council={c} view={views.get(c.zastup)} watchShard={c.featured ?? c.shard} onOpen={onOpenTown} />;
    const flat = view === 'kraje' ? NO_IDS : flatOrder(councils, view).filter(pass);

    return (
        <div className="mi-root">
            <IndexStyles />
            <IndexHeader townCount={councils.length} now={now} online={online} />
            <div className="mi-layout">
                <div className="mi-side">
                    <TownSearch
                        index={index} townCount={councils.length} limit={wide ? 8 : 6} mode={searchMode} councilByZastup={councilByZastup} viewOf={viewOf}
                        onOpenTown={openFromSearch} onChooseMine={chooseMine} onOpenKraj={openRegion} onEndMine={() => setSearchMode('search')} say={say}
                    />
                    {myTown.mine && (
                        <MyTown
                            council={myTown.mine} view={views.get(myTown.mine.zastup)}
                            onChange={() => setSearchMode('mine')}
                            onForget={() => { const n = myTown.mine.name; myTown.forget(); say(`Moje obec zapomenuta (${n}).`); }}
                        />
                    )}
                    <nav className="mi-regnav" aria-label="Skok na kraj">
                        <h2>Kraje</h2>
                        <ul>
                            {model.map((r) => (
                                <li key={r.kraj}>
                                    <a href={`#kraj-${r.kraj}`} onClick={(ev) => { ev.preventDefault(); openRegion(r.kraj); }}>
                                        {r.name.replace(/ kraj$/, '').replace(/^Kraj /, '')}<span>{r.zastups.length}</span>
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </nav>
                </div>

                <main className="mi-main">
                    <FeaturedTowns councils={featured} views={views} onOpen={onOpenTown} />

                    <section className="mi-sec" aria-labelledby="mi-all-h">
                        <h2 className="mi-sec-h" id="mi-all-h">Všechna města <small>{councils.length}</small></h2>
                        <ListControls
                            view={view} onView={(v) => { setView(v); say(v === 'kraje' ? 'Města po krajích.' : v === 'velikost' ? 'Města seřazená podle počtu obyvatel.' : 'Města podle abecedy.'); }}
                            onlyDone={onlyDone} onToggleDone={toggleDone} bar={bar} onShowNew={showNew}
                        />
                        {view === 'kraje' ? (
                            <div aria-live="off">
                                {model.map((r) => {
                                    const rows = r.councils.filter(pass);
                                    return (
                                        <RegionSection
                                            key={r.kraj} region={r} expanded={open.has(r.kraj)} onToggle={toggleRegion}
                                            header={regionHeader(r, { shown, summaries, shards: snapshot.shards, now, active })}
                                        >
                                            {rows.map(rowFor)}
                                            {onlyDone && !rows.length && <div className="mi-empty">{emptyText}</div>}
                                        </RegionSection>
                                    );
                                })}
                            </div>
                        ) : (
                            <>
                                <div className="mi-list mi-g2" aria-live="off">{flat.map(rowFor)}</div>
                                {onlyDone && !flat.length && <div className="mi-empty">{emptyText}</div>}
                            </>
                        )}
                    </section>

                    <footer className="mi-foot">
                        <p>
                            Zdroj: ČSÚ (volby.gov.cz), u každého města s jeho vlastním časem. Žádné součty ani odhady za kraje nebo republiku. Mandáty ukazujeme, až je ČSÚ vyhlásí.
                            {' '}Praha je na <a href="https://praha.dg12.cz">praha.dg12.cz</a>.
                        </p>
                        <p>Správce: Václav Vislous · <a href="tel:+420777954389">777 954 389</a></p>
                    </footer>
                </main>
            </div>
            <p className="mi-sr" role="status" aria-live="polite">{status}</p>
            {toast && <div className="mi-toast" aria-hidden="true">{toast}</div>}
        </div>
    );
}
