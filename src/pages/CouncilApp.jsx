// Živé výsledky jednoho zastupitelstva (/praha-3, /praha-6, …).
// Desktop: vlevo panel se záložkami, vpravo mapa okrsků s detailem.
// Mobil: obsah podle spodní lišty (Přehled / Mapa / Zastupitelé / Koalice / Okrsky).
// Bez mapy (Magistrát): jen panely na střed. ?demo spustí simulované sčítání.
import React, { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ElectionHeader from '../components/ElectionHeader';
import PartyResults from '../components/PartyResults';
import Councilors, { PirateCandidates } from '../components/Councilors';
import CoalitionPanel, { CoalitionHero, LastSeatCard } from '../components/Coalition';
import Hemicycle from '../components/Hemicycle';
import { ArrivalsFeed, MapControls, PrecinctDetail } from '../components/Precincts';
import { Card, SectionTitle } from '../components/ui';
import { councilSource, useLiveResults } from '../hooks/useLiveResults';
import { useIsMobile } from '../hooks/useIsMobile';
import { setMapEnabled, useMapEnabled } from '../hooks/useMapPreference';
import { useDialog } from '../hooks/useDialog';
import { buildModel, emptySnapshot, precincts2022 } from '../volby/model';
import { createDemoFeed } from '../volby/demo';
import { partyMeta, setActiveCouncil } from '../volby/council';
import { turnout2022 } from '../volby/compute';
import { POLLS_CLOSE } from '../councils';
import { countdown, fmtInt, fmtPct } from '../volby/format';
import { scrollBehavior } from '../utils/motion';

// Mapa (Leaflet + MapLibre, většina velikosti aplikace) se stahuje zvlášť —
// panely s výsledky se ukážou hned, mapa doběhne za nimi
const ResultsMap = lazy(() => import('../components/ResultsMap'));

const params = new URLSearchParams(window.location.search);
const DEMO = params.has('demo');
const DEMO_SECONDS = Number(params.get('demo')) || 150;

const ICONS = {
    overview: 'M4 6h16M4 12h10M4 18h7',
    map: 'M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7',
    councilors: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
    coalition: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4',
    // ne tři čáry — to je ikona menu v hlavičce
    precincts: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
};

// Výška prvku (ResizeObserver) — ovládání a detail okrsku leží přes mapu
// a mapa podle nich posouvá vybraný okrsek do viditelné části
function useHeight() {
    const [height, setHeight] = useState(0);
    const ref = useCallback((el) => {
        if (!el) return undefined;
        const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
        ro.observe(el);
        return () => {
            ro.disconnect();
            setHeight(0);
        };
    }, []);
    return [ref, height];
}

// Otevřená záložka a vybraný okrsek žijí v URL (#mapa:3021) — přežijí
// vynucené obnovení po nasazení nové verze uprostřed sčítání a jdou sdílet
const TAB_HASH = { overview: 'prehled', map: 'mapa', councilors: 'zastupitele', coalition: 'koalice', precincts: 'okrsky' };
function readHash() {
    const [tabSlug, precinct] = window.location.hash.slice(1).split(':');
    const tab = Object.keys(TAB_HASH).find((k) => TAB_HASH[k] === tabSlug) || 'overview';
    return { tab, precinct: precinct ? decodeURIComponent(precinct) : null };
}

// Záložka Mapa na telefonu, dokud si mapu uživatel nezapne (useMapPreference)
function MapOffCard({ onEnable, onOpenList }) {
    return (
        <div className="h-full overflow-y-auto px-3 pt-3 pb-20">
            <Card className="p-4">
                <SectionTitle>Mapa okrsků</SectionTitle>
                <p className="text-sm text-neutral-700">
                    Na telefonu je mapa vypnutá, ať šetří data i baterii. Zapnutí stáhne zhruba <b>1 MB</b> (podkladová
                    mapa a knihovny) a další data při každém posunu.
                </p>
                <button onClick={onEnable} className="mt-3 w-full rounded-xl bg-black text-white py-3 text-sm font-semibold active:bg-neutral-800">
                    Zapnout mapu
                </button>
                <p className="mt-2 text-[11px] text-neutral-500">Zapamatujeme si to — vypnout ji jde zase v mapě nebo v menu.</p>
                {onOpenList && (
                    <button onClick={onOpenList} className="mt-2 py-2.5 text-sm font-semibold text-black hover:underline">
                        Výsledky okrsků jako seznam →
                    </button>
                )}
            </Card>
        </div>
    );
}

// Detail okrsku bez mapy (mapa na telefonu vypnutá): spodní panel přes seznam
function PrecinctSheet({ id, onClose, children }) {
    const ref = useDialog(true, onClose);
    return (
        <div className="fixed inset-0 z-[1300] bg-black/30 flex items-end sm:items-center sm:justify-center" onClick={onClose}>
            <div
                ref={ref}
                tabIndex={-1}
                role="dialog"
                aria-modal="true"
                aria-label={`Okrsek ${id}`}
                className="w-full sm:max-w-md max-h-[70dvh] overflow-y-auto overscroll-contain px-2 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] outline-none"
                onClick={(e) => e.stopPropagation()}
            >
                {children}
            </div>
        </div>
    );
}

function PreElectionCard({ slug }) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 30000);
        return () => clearInterval(t);
    }, []);
    return (
        <Card className="p-4 overflow-hidden relative">
            <div className="absolute inset-y-0 left-0 w-1.5 bg-[#FEC900]" />
            <div className="font-condensed text-xs font-bold uppercase tracking-wider text-neutral-500">Výsledky začnou chodit po 14:00</div>
            <div className="mt-1 font-display text-5xl leading-none text-black">za {countdown(POLLS_CLOSE - now)}</div>
            <p className="mt-2 text-sm text-neutral-600">
                Volební místnosti se zavírají v sobotu 10. 10. ve 14:00. Pak se stránka sama obnovuje každou minutu
                a postupně ukáže sečtené okrsky, mandáty, zvolené zastupitele i možné koalice.
            </p>
            <a href={`/${slug}?demo`} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-black text-white text-sm font-semibold px-3.5 py-2 hover:bg-neutral-800">
                ▶ Vyzkoušet demo sčítání
            </a>
        </Card>
    );
}

function TurnoutCard({ snapshot, results2022 }) {
    const t = snapshot.turnout;
    const t22 = turnout2022(results2022);
    return (
        <Card className="p-4">
            <SectionTitle>Účast (sečtené okrsky)</SectionTitle>
            <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                    <div className="font-display text-3xl leading-none tabular-nums">{fmtPct(t.pct)}</div>
                    <div className="mt-1 text-[11px] text-neutral-500">účast{t22 !== null && ` · 2022: ${fmtPct(t22)}`}</div>
                </div>
                <div>
                    <div className="font-display text-3xl leading-none tabular-nums">{fmtInt(t.envelopes)}</div>
                    <div className="mt-1 text-[11px] text-neutral-500">voličů přišlo</div>
                </div>
                <div>
                    <div className="font-display text-3xl leading-none tabular-nums">{fmtInt(t.validVotes)}</div>
                    <div className="mt-1 text-[11px] text-neutral-500">platných hlasů</div>
                </div>
            </div>
        </Card>
    );
}

export default function CouncilApp({ council }) {
    const isMobile = useIsMobile();
    const mapEnabled = useMapEnabled();
    const [statics, setStatics] = useState(null);
    const [tab, setTab] = useState(() => readHash().tab);
    const [selectedId, setSelectedId] = useState(() => readHash().precinct);
    const [mapMode, setMapMode] = useState(council.pirates ? 'ours' : 'winner');
    const [mapParty, setMapParty] = useState(council.pirates);

    // Statické podklady: každý zvlášť a s opakováním — výpadek jednoho
    // souboru nesmí nechat stránku viset na „Načítám…". Kandidátky (lists)
    // jsou povinné, ostatní jen přidávají (mapa, srovnání s 2022, jména).
    useEffect(() => {
        const files = {
            lists: `/data/${council.slug}/lists.json`,
            kandidati: `/data/${council.slug}/kandidati.json`,
            results2022: `/data/${council.slug}/results2022.json`,
            ...(council.map ? { geoJson: `/data/${council.slug}/okrsky.geojson` } : {}),
        };
        let cancelled = false;
        let timer;
        const load = async (keys, attempt) => {
            const settled = await Promise.allSettled(keys.map((k) => fetch(files[k]).then((r) => {
                if (!r.ok) throw new Error(`${r.status} ${files[k]}`);
                return r.json();
            })));
            if (cancelled) return;
            const loaded = {};
            const missing = [];
            settled.forEach((r, i) => {
                if (r.status === 'fulfilled') loaded[keys[i]] = r.value;
                else missing.push(keys[i]);
            });
            // Metadata kandidátek musí být nastavená dřív, než se cokoli vykreslí
            if (loaded.lists) setActiveCouncil(council, loaded.lists);
            setStatics((prev) => ({ geoJson: null, kandidati: null, results2022: null, lists: null, ...prev, ...loaded }));
            if (missing.length && attempt < 5) {
                console.warn('Nepodařilo se načíst podklady, zkusím znovu:', missing);
                timer = setTimeout(() => load(missing, attempt + 1), 3000 * (attempt + 1));
            }
        };
        load(Object.keys(files), 0);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [council]);

    const ready = !!statics?.lists;
    const demoResults = statics?.results2022;
    const demoKandidati = statics?.kandidati;
    const demoFeed = useMemo(
        () => (DEMO && ready && demoResults && demoKandidati
            ? createDemoFeed({ results2022: demoResults, kandidati: demoKandidati, durationMs: DEMO_SECONDS * 1000 })
            : null),
        [ready, demoResults, demoKandidati],
    );
    const live = useLiveResults({ source: councilSource(council), demo: DEMO, demoFeed });
    const kandidati = statics?.kandidati;
    // Když se živá data vůbec nenačtou, ukázat aspoň odpočet, kandidátky
    // a výchozí stav 2022 (náhradní snapshot z kandidátek)
    const snapshot = useMemo(
        () => live.snapshot || (live.status === 'error' && ready && kandidati ? emptySnapshot(kandidati) : null),
        [live.snapshot, live.status, ready, kandidati],
    );
    const model = useMemo(
        () => (snapshot && ready ? buildModel(snapshot, statics) : null),
        [snapshot, ready, statics],
    );

    // Než se začne sčítat, mapa ukazuje KV 2022 (ať není prázdná)
    const counted = snapshot?.precincts?.counted || 0;
    const mapSnapshot = useMemo(() => {
        if (!snapshot || !ready) return null;
        if (counted > 0) return snapshot;
        return { ...snapshot, fetchedAt: 'kv2022', okrsky: precincts2022(statics.results2022) };
    }, [snapshot, ready, statics, counted]);

    // Titulek záložky: stav sčítání a výsledek Pirátů — vidět i z jiné záložky
    useEffect(() => {
        if (!model) {
            document.title = `${council.name} · Volby 2026 · Piráti`;
            return;
        }
        const p = model.snapshot.precincts;
        document.title = model.hasVotes
            ? `${p.counted}/${p.total}${model.ours ? ` · Piráti ${fmtPct(model.ours.share)}` : ''} · ${council.name}`
            : `${council.name} · Volby 2026 · Piráti`;
    }, [model, council.name]);

    const [controlsRef, controlsH] = useHeight();
    const [sheetRef, sheetH] = useHeight();
    const closePrecinct = useCallback(() => setSelectedId(null), []);

    // Každá záložka si pamatuje, kam byla odrolovaná (jinak se nová záložka
    // otevřela v půlce, na pozici té předchozí). Klepnutí na už otevřenou
    // záložku vyroluje nahoru — jako v nativních aplikacích.
    const scrollRef = useRef(null);
    const scrollPos = useRef({});
    const switchTab = (id) => {
        if (id === tab) {
            scrollRef.current?.scrollTo({ top: 0, behavior: scrollBehavior() });
            return;
        }
        if (scrollRef.current) scrollPos.current[tab] = scrollRef.current.scrollTop;
        setTab(id);
    };
    useLayoutEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollPos.current[tab] || 0;
    }, [tab]);

    useEffect(() => {
        const hash = tab === 'overview' && !selectedId ? '' : `#${TAB_HASH[tab]}${selectedId ? `:${encodeURIComponent(selectedId)}` : ''}`;
        if (hash !== window.location.hash) history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`);
    }, [tab, selectedId]);

    // Mapa: data (okrsky.geojson) a jestli se opravdu kreslí — na telefonu
    // jen když si ji uživatel zapnul, jinak se MapLibre ani dlaždice nestahují
    const mapData = !!council.map && !!statics?.geoJson;
    const showMap = mapData && (!isMobile || mapEnabled);

    // Detail okrsku na mobilu je spodní panel (přes mapu, nebo bez mapy přes
    // seznam) — brouk by v něm zakrýval čísla (viz BugReportWidget, body[data-sheet])
    const sheetOpen = isMobile && !!selectedId && (!showMap || tab === 'map');
    useEffect(() => {
        if (!sheetOpen) return undefined;
        document.body.dataset.sheet = '';
        return () => {
            delete document.body.dataset.sheet;
        };
    }, [sheetOpen]);

    const selectPrecinct = (id) => {
        setSelectedId(id);
        // bez mapy (vypnutá na telefonu, výpadek okrsky.geojson) zůstat na místě —
        // detail se ukáže jako spodní panel
        if (isMobile && showMap) switchTab('map');
    };

    if (!ready || !model) {
        return (
            <div className="h-dvh flex flex-col bg-[#F3F3F1]">
                <ElectionHeader live={live} snapshot={null} demo={DEMO} geoJson={null} selectedId={null} onSelectPrecinct={() => {}} />
                <div className="flex-1 flex items-center justify-center text-sm text-neutral-500">
                    {live.status === 'error' ? 'Výsledky se nepodařilo načíst — zkouším to znovu…' : 'Načítám výsledky…'}
                </div>
            </div>
        );
    }

    const withMap = mapData;
    const hasPrecincts = council.precinctFiles !== false;

    const map = showMap && (
        <div className="relative h-full w-full">
            <Suspense fallback={<div className="h-full w-full bg-[#E5E5E3] animate-pulse" />}>
                <ResultsMap
                    geoJson={statics.geoJson}
                    snapshot={mapSnapshot}
                    historical={counted === 0}
                    results2022={statics.results2022}
                    modeId={mapMode}
                    partyId={mapParty ?? model.parties[0]?.id}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    freshIds={live.freshIds}
                    arrivals={live.arrivals}
                    isMobile={isMobile}
                    // na mobilu ovládání přes celou šířku nahoře a detail okrsku přes celou šířku dole
                    insetTop={isMobile && controlsH ? controlsH + 16 : 12}
                    insetBottom={isMobile && sheetH ? sheetH + 12 : 0}
                    onBackgroundClick={closePrecinct}
                />
            </Suspense>
            <div ref={controlsRef} className={`absolute z-[1000] ${isMobile ? 'top-2 left-2 right-2' : 'top-3 right-3 w-64 lg:w-72'}`}>
                <MapControls
                    modeId={mapMode}
                    onMode={setMapMode}
                    partyId={mapParty ?? model.parties[0]?.id}
                    onParty={setMapParty}
                    parties={model.parties}
                    compact={isMobile}
                />
            </div>
            {counted === 0 && !selectedId && (
                <div className={`absolute z-[1000] ${isMobile ? 'bottom-2 left-2 right-16' : 'bottom-6 left-3'} rounded-xl bg-black/90 text-white text-xs px-3 py-2 shadow-lg`}>
                    Ještě se nesčítá — mapa zatím ukazuje <b className="text-[#FEC900]">komunální volby 2022</b> (předchůdci dnešních kandidátek).
                </div>
            )}
            {isMobile && !selectedId && (
                // vypnout mapu jde i přímo tady (nad bannerem „Ještě se nesčítá")
                <button
                    onClick={() => setMapEnabled(false)}
                    className={`absolute z-[1000] left-2 ${counted === 0 ? 'bottom-[4.5rem]' : 'bottom-6'} rounded-full bg-white/95 backdrop-blur border border-neutral-200 shadow-lg px-3.5 py-2.5 text-xs font-semibold text-neutral-800 active:bg-neutral-100`}
                >
                    Vypnout mapu
                </button>
            )}
            {selectedId && (
                <div
                    ref={isMobile ? sheetRef : undefined}
                    className={`absolute z-[1000] overflow-y-auto overscroll-contain ${
                        isMobile ? 'left-2 right-2 bottom-2 max-h-[55%] short:left-auto short:w-[22rem] short:max-h-[70%]' : 'top-3 left-3 w-80 max-h-[calc(100%-1.5rem)]'
                    }`}
                >
                    <PrecinctDetail
                        id={selectedId}
                        snapshot={snapshot}
                        results2022={statics.results2022}
                        arrivals={live.arrivals}
                        onClose={closePrecinct}
                    />
                </div>
            )}
        </div>
    );

    const overview = (
        <div className="space-y-3">
            {model.snapshot.phase === 'pre' && !DEMO && <PreElectionCard slug={council.slug} />}
            {DEMO && (
                <div className="rounded-xl bg-[#FFF6D1] border border-[#FEC900] text-neutral-900 text-xs px-3 py-2">
                    <b>Demo</b> — simulované sčítání odvozené z výsledků 2022, ne skutečná data ani predikce.{' '}
                    <a href={`/${council.slug}?demo`} className="inline-block py-1.5 -my-1.5 underline font-semibold">Spustit znovu</a> · <a href={`/${council.slug}`} className="inline-block py-1.5 -my-1.5 underline">Skutečné výsledky</a>
                </div>
            )}
            {!council.pirates && !council.pirateCandidates.length && (
                <div className="rounded-xl bg-white border border-neutral-200 text-neutral-600 text-xs px-3 py-2">
                    V této městské části Piráti letos nekandidují — stránka ukazuje výsledky všech kandidátek.
                </div>
            )}
            {!council.pirates && <PirateCandidates model={model} />}
            {council.beta && (
                <div className="rounded-xl bg-white border border-neutral-200 text-neutral-600 text-xs px-3 py-2">
                    <b>Beta:</b> {council.title} běží v lehkém režimu — bez mapy {council.precincts} okrsků. Mandáty, zastupitelé a koalice fungují.
                </div>
            )}
            <CoalitionHero model={model} />
            <PartyResults
                model={model}
                // Klepnutí na stranu ji ukáže na mapě — na mobilu je mapa ve
                // vlastní záložce, tak se na ni rovnou přepne
                selectedParty={mapMode === 'party' ? mapParty : null}
                onSelectParty={showMap ? (id) => {
                    setMapMode(id === council.pirates ? 'ours' : 'party');
                    setMapParty(id);
                    if (isMobile) switchTab('map');
                } : undefined}
            />
            <Card className="p-4">
                <SectionTitle right={<button onClick={() => switchTab('councilors')} className="py-2.5 -my-2.5 pl-3 text-xs font-semibold text-black hover:underline">Kdo sedí kde →</button>}>
                    Rozdělení mandátů
                </SectionTitle>
                {council.coalition ? (
                    <Hemicycle model={model} highlight={model.coalition.members} centerLabel="současná koalice" />
                ) : (
                    <Hemicycle model={model} highlight={council.pirates ? [council.pirates] : null} centerLabel={council.pirates ? partyMeta(council.pirates).tiny : undefined} />
                )}
            </Card>
            <LastSeatCard model={model} />
            {model.hasVotes && <TurnoutCard snapshot={snapshot} results2022={statics.results2022} />}
            <div className="text-[11px] text-neutral-500 px-1 pb-2 leading-relaxed">
                Zdroj: ČSÚ, volby.gov.cz. Mandáty a zvolení jsou do vyhlášení ČSÚ odhad podle zákona (5% klauzule,
                d'Hondt, 10% preferenční hranice) — výpočet ověřený na výsledcích 2022. Loga a část fotek: programydovoleb.cz.
                <div className="mt-1 text-neutral-400">
                    Záložní kopie originálu jsemfast/pirati-vysledky-2026 · správce kopie: Václav Vislous ·{' '}
                    <a href="tel:+420777954389" className="underline">777 954 389</a>
                </div>
            </div>
        </div>
    );

    const panels = {
        overview,
        councilors: <Councilors model={model} />,
        coalition: <CoalitionPanel model={model} />,
        precincts: (
            <ArrivalsFeed
                snapshot={snapshot}
                arrivals={live.arrivals}
                results2022={statics.results2022}
                freshIds={live.freshIds}
                onSelect={selectPrecinct}
            />
        ),
    };

    const tabs = [
        { id: 'overview', label: 'Přehled' },
        ...(withMap && isMobile ? [{ id: 'map', label: 'Mapa' }] : []),
        { id: 'councilors', label: 'Zastupitelé' },
        { id: 'coalition', label: 'Koalice' },
        ...(hasPrecincts ? [{ id: 'precincts', label: 'Okrsky' }] : []),
    ];
    const activeTab = tabs.some((t) => t.id === tab) ? tab : 'overview';

    return (
        <div className="h-dvh flex flex-col bg-[#F3F3F1] text-neutral-900">
            <ElectionHeader
                live={live}
                snapshot={snapshot}
                demo={DEMO}
                geoJson={withMap ? statics.geoJson : null}
                selectedId={selectedId}
                onSelectPrecinct={selectPrecinct}
                onOpenPrecincts={isMobile ? () => switchTab(hasPrecincts ? 'precincts' : 'map') : undefined}
            />

            {isMobile ? (
                <>
                    <main className="flex-1 min-h-0 relative">
                        {activeTab === 'map' ? (
                            showMap ? map : <MapOffCard onEnable={() => setMapEnabled(true)} onOpenList={hasPrecincts ? () => switchTab('precincts') : null} />
                        ) : (
                            <div ref={scrollRef} className="h-full overflow-y-auto px-3 pt-3 pb-20">{panels[activeTab]}</div>
                        )}
                    </main>
                    <nav
                        aria-label="Sekce výsledků"
                        className="shrink-0 bg-white border-t border-neutral-200 grid pb-[env(safe-area-inset-bottom)] z-[1200]"
                        style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
                    >
                        {tabs.map((t) => (
                            <button
                                key={t.id}
                                onClick={() => switchTab(t.id)}
                                aria-current={activeTab === t.id ? 'page' : undefined}
                                className={`flex flex-col items-center gap-0.5 py-2 active:bg-neutral-50 font-condensed text-[11px] font-bold short:flex-row short:justify-center short:gap-1.5 short:py-1.5 short:text-xs ${activeTab === t.id ? 'text-black' : 'text-neutral-500'}`}
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICONS[t.id]} />
                                </svg>
                                {t.label}
                                <span className={`h-0.5 w-6 rounded-full short:hidden ${activeTab === t.id ? 'bg-[#FEC900]' : 'bg-transparent'}`} />
                            </button>
                        ))}
                    </nav>
                </>
            ) : (
                <main className="flex-1 min-h-0 flex">
                    {/* tablet na výšku: užší panel, ať mapě zbyde místo i pro ovládání vedle zoomu */}
                    <aside className={`${withMap ? 'w-[360px] lg:w-[440px] xl:w-[480px] shrink-0 border-r border-neutral-200' : 'flex-1'} flex flex-col bg-[#F3F3F1]`}>
                        <div className={`flex gap-1 px-3 pt-3 ${withMap ? '' : 'w-full max-w-3xl mx-auto'}`}>
                            {tabs.map((t) => (
                                <button
                                    key={t.id}
                                    onClick={() => switchTab(t.id)}
                                    aria-current={activeTab === t.id ? 'page' : undefined}
                                    className={`flex-1 rounded-lg px-2 py-1.5 font-condensed text-sm font-bold uppercase tracking-wide transition-colors ${
                                        activeTab === t.id ? 'bg-black text-white' : 'text-neutral-500 hover:bg-white'
                                    }`}
                                >
                                    {t.label}
                                </button>
                            ))}
                        </div>
                        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3">
                            <div className={withMap ? '' : 'max-w-3xl mx-auto'}>{panels[activeTab]}</div>
                        </div>
                    </aside>
                    {withMap && <section className="flex-1 min-w-0">{map}</section>}
                </main>
            )}
            {!showMap && selectedId && (
                <PrecinctSheet id={selectedId} onClose={closePrecinct}>
                    <PrecinctDetail
                        id={selectedId}
                        snapshot={snapshot}
                        results2022={statics.results2022}
                        arrivals={live.arrivals}
                        onClose={closePrecinct}
                    />
                </PrecinctSheet>
            )}
        </div>
    );
}
