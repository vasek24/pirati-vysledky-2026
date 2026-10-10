import React from 'react';
import { mapNoteText } from './mapUi.js';

// Jedna věta pod ovládáním mapy: které městské části chybí na mapě (jen když něco chybí)
export default function MestaMapNote({ geoJson }) {
    const text = mapNoteText(geoJson?.droppedDistricts);
    if (!text) return null;
    return (
        <div className="mt-2 rounded-xl bg-white/95 backdrop-blur border border-neutral-200 shadow px-3 py-2 text-[11px] leading-snug text-neutral-600">
            {text}
        </div>
    );
}
