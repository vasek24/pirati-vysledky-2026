// Mapa okrsků s průběžnými výsledky. Nesečtené okrsky šedě s čárkovaným
// okrajem, čerstvě sečtené krátce zablikají žlutě. Najetí myší = náhled
// (top strany v okrsku), klik = detail okrsku.
import React, { useEffect, useMemo, useRef } from 'react';
import { MapContainer, GeoJSON, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import BaseMapLayer from './BaseMapLayer';
import { getMapMode } from '../volby/mapModes';
import { setScaleSource } from '../volby/mapScale';
import { UNCOUNTED_FILL } from '../volby/colors';
import { activeCouncil, partyMeta } from '../volby/council';
import { baselineShare } from '../volby/compute';
import { fmtPct, fmtShortTime } from '../volby/format';
import { reducedMotion } from '../utils/motion';

function FitBounds({ data, padTop = 12 }) {
    const map = useMap();
    // Odsazení shora (výška ovládání mapy) se na mobilu změří až po mountu —
    // napasování o chvilku později už vezme změřenou hodnotu. Změna výšky
    // ovládání (přepnutí režimu) ale mapu znovu nepasuje, uživatel ji mohl
    // mezitím posunout.
    const padRef = useRef(padTop);
    useEffect(() => {
        padRef.current = padTop;
    }, [padTop]);
    useEffect(() => {
        if (!data) return undefined;
        const bounds = L.geoJSON(data).getBounds();
        // Kontejner může mít při mountu ještě nulovou velikost (mobilní
        // záložka) — přeměřit a napasovat i o chvilku později. Bez animace:
        // Leaflet během běžící animace zoomu další fitBounds ignoruje.
        const fit = () => {
            map.invalidateSize();
            map.fitBounds(bounds, { paddingTopLeft: [6, padRef.current], paddingBottomRight: [6, 6], animate: false });
        };
        fit();
        const t = setTimeout(fit, 200);
        return () => clearTimeout(t);
    }, [data, map]);
    return null;
}

// Vybraný okrsek nesmí zůstat schovaný pod ovládáním mapy nebo pod detailem
// okrsku (na mobilu spodní panel) — posunout ho do viditelného pruhu mezi nimi
function FocusSelected({ data, selectedId, insetTop, insetBottom }) {
    const map = useMap();
    useEffect(() => {
        if (!selectedId || !data) return undefined;
        const feature = data.features.find((f) => String(f.properties.cislo) === selectedId);
        if (!feature) return undefined;
        // počkat, až se panel s detailem vykreslí a změří
        const t = setTimeout(() => {
            const size = map.getSize();
            const top = insetTop;
            const bottom = size.y - insetBottom;
            if (bottom - top < 48) return;
            const p = map.latLngToContainerPoint(L.geoJSON(feature).getBounds().getCenter());
            const dx = p.x < 24 || p.x > size.x - 24 ? p.x - size.x / 2 : 0;
            const dy = p.y < top + 16 || p.y > bottom - 16 ? p.y - (top + bottom) / 2 : 0;
            if (dx || dy) map.panBy([dx, dy], { animate: !reducedMotion() });
        }, 60);
        return () => clearTimeout(t);
    }, [map, data, selectedId, insetTop, insetBottom]);
    return null;
}

// Klepnutí do mapy mimo okrsky zavře detail okrsku
function BackgroundClick({ onClick }) {
    const map = useMap();
    useEffect(() => {
        if (!onClick) return undefined;
        map.on('click', onClick);
        return () => {
            map.off('click', onClick);
        };
    }, [map, onClick]);
    return null;
}

// Po změně velikosti kontejneru (mobil: přepnutí záložek) přepočítat mapu
function SizeWatcher() {
    const map = useMap();
    useEffect(() => {
        const el = map.getContainer();
        const ro = new ResizeObserver(() => map.invalidateSize());
        ro.observe(el);
        return () => ro.disconnect();
    }, [map]);
    return null;
}

function previewHtml(id, okrsek, arrivedAt, results2022, historical) {
    if (!okrsek?.votes) {
        const base = partyMeta(activeCouncil().pirates).baseline;
        const then = base ? baselineShare(results2022, base.ids, id) : null;
        return `<div class="okt"><div class="okt-h">Okrsek ${id}</div><div class="okt-s">čeká na sečtení</div>${
            then !== null ? `<div class="okt-f">2022 ${base.label}: ${fmtPct(then)}</div>` : ''
        }</div>`;
    }
    const total = Object.values(okrsek.votes).reduce((s, v) => s + v, 0) || 1;
    const top = Object.entries(okrsek.votes)
        .map(([pid, v]) => ({ pid: Number(pid), pct: (v / total) * 100 }))
        .filter((r) => r.pid !== 0)
        .sort((a, b) => b.pct - a.pct);
    const rows = top.slice(0, 4);
    const OUR_PARTY = activeCouncil().pirates;
    if (!rows.some((r) => r.pid === OUR_PARTY)) {
        const ours = top.find((r) => r.pid === OUR_PARTY);
        if (ours) rows.push(ours);
    }
    const max = Math.max(...rows.map((r) => r.pct), 1);
    return `<div class="okt">
        <div class="okt-h">Okrsek ${id}<span>${historical ? 'KV 2022' : arrivedAt ? `sečteno ${fmtShortTime(arrivedAt)}` : 'sečteno'}</span></div>
        ${rows.map((r) => {
            const m = partyMeta(r.pid);
            return `<div class="okt-r${r.pid === OUR_PARTY ? ' okt-ours' : ''}"><span class="okt-n">${m.tiny}</span><span class="okt-b"><i style="width:${(r.pct / max) * 100}%;background:${m.color}"></i></span><b>${fmtPct(r.pct)}</b></div>`;
        }).join('')}
        <div class="okt-f">Účast ${fmtPct(okrsek.turnout)}</div>
    </div>`;
}

export default function ResultsMap({
    geoJson,
    snapshot,
    results2022,
    modeId,
    partyId,
    selectedId,
    onSelect,
    freshIds,
    arrivals,
    isMobile,
    historical = false,
    insetTop = 12,
    insetBottom = 0,
    onBackgroundClick,
}) {
    const okrsky = snapshot?.okrsky || {};
    const mode = useMemo(() => getMapMode(modeId, { partyId, results2022, okrsky }), [modeId, partyId, results2022, okrsky]);
    useEffect(() => {
        setScaleSource(okrsky);
        return () => setScaleSource(null);
    }, [okrsky]);
    const fresh = useMemo(() => new Set(freshIds || []), [freshIds]);

    const style = (feature) => {
        const id = String(feature.properties.cislo);
        const o = okrsky[id];
        // „Edita vs 2022" na datech 2022 (před sčítáním) by všude ukázalo 0
        const v = o && (o.votes || modeId === 'turnout') && !(historical && modeId === 'swing') ? mode.value(o, id) : null;
        const selected = selectedId === id;
        const base = {
            weight: selected ? 3.5 : 1.2,
            color: selected ? '#000000' : '#ffffff',
            opacity: 1,
            className: fresh.has(id) ? 'okrsek-fresh' : '',
        };
        if (v === null || v === undefined || !o) {
            return { ...base, fillColor: UNCOUNTED_FILL, fillOpacity: 0.6, dashArray: selected ? null : '4 4', color: selected ? '#000000' : '#78716C' };
        }
        return {
            ...base,
            fillColor: mode.color(v),
            fillOpacity: mode.opacity ? mode.opacity(v) : 0.82,
        };
    };

    const onEachFeature = (feature, layer) => {
        const id = String(feature.properties.cislo);
        if (!isMobile) {
            layer.bindTooltip(() => previewHtml(id, okrsky[id], arrivals?.[id], results2022, historical), {
                direction: 'top',
                sticky: true,
                className: 'okrsek-tooltip',
                opacity: 1,
            });
        }
        layer.on({
            click: () => onSelect(id),
            mouseover: (e) => {
                if (selectedId !== id) e.target.setStyle({ weight: 2.5, color: '#000000' });
                e.target.bringToFront();
            },
            mouseout: (e) => {
                if (selectedId !== id) e.target.setStyle(style(feature));
            },
        });
    };

    // GeoJSON v react-leaflet styl ani handlery neaktualizuje — přemountovat
    // při každé změně dat/režimu (52 polygonů, levné)
    const version = `${snapshot?.fetchedAt || 'x'}-${modeId}-${partyId}-${selectedId}-${isMobile}-${historical}`;

    return (
        // zoomSnap 0.25: Praha 3 je na šířku telefonu těsně širší než zoom 13,
        // s celými kroky by fitBounds spadl až na 12 (městská část jako známka)
        <MapContainer center={[50.083, 14.46]} zoom={13} zoomSnap={0.25} zoomDelta={0.5} maxZoom={19} zoomControl={!isMobile} style={{ height: '100%', width: '100%' }}>
            <BaseMapLayer />
            <SizeWatcher />
            {geoJson && (
                <>
                    {/* bubblingMouseEvents: klik na okrsek nesmí probublat do mapy (ta detail zavírá) */}
                    <GeoJSON key={version} data={geoJson} style={style} onEachFeature={onEachFeature} bubblingMouseEvents={false} />
                    <FitBounds data={geoJson} padTop={insetTop} />
                    <FocusSelected data={geoJson} selectedId={selectedId} insetTop={insetTop} insetBottom={insetBottom} />
                    <BackgroundClick onClick={onBackgroundClick} />
                </>
            )}
        </MapContainer>
    );
}
