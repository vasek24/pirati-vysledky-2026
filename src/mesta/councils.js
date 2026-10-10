// Zastupitelstva produktu „mesta“ — náhrada za src/councils.js (Praha) v buildu
// mesta. Stejné API jako Pražský modul + ALL_COUNCILS, allCouncilByZastup,
// SHARDS a REGIONS. Plugin pro výměnu modulů tento soubor přeskakuje, proto
// konstanty Prahy bere přímo z '../councils.js'.
//
// COUNCILS = jen zobrazená města (trasy, menu, index, hledání); skrytá
// (nízká důvěra, dokud je nikdo neověří) jsou jen v ALL_COUNCILS, SHARDS
// a allCouncilByZastup (Worker, shardy, datový build) a mají pirates: null.
//
// Pozor (T6): SHARDS[…].zastups obsahují i skrytá města (shardy se nikdy
// nepřeskládávají). Řádky „Největší města“ proto brát z
// COUNCILS.filter((c) => c.featured), ne ze SHARDS['top-*'].zastups.

import towns from './towns.generated.json';
import specifics from './specifics.generated.json';
import overrides from './overrides.js';
import { buildCouncils, deriveShards, deriveRegions } from './buildCouncils.js';

export { KV_DATE, KV_BASE_URL, POLLS_CLOSE, PIRATES_CODE, majorityOf } from '../councils.js';

export const ALL_COUNCILS = buildCouncils(towns, specifics, overrides);
export const COUNCILS = ALL_COUNCILS.filter((c) => c.shown);

export const councilBySlug = (slug) => COUNCILS.find((c) => c.slug === slug) || null;
export const councilByZastup = (zastup) => COUNCILS.find((c) => c.zastup === Number(zastup)) || null;
export const allCouncilByZastup = (zastup) => ALL_COUNCILS.find((c) => c.zastup === Number(zastup)) || null;

export const SHARDS = deriveShards(ALL_COUNCILS);
export const REGIONS = deriveRegions(COUNCILS);
