// Co se v posledním snapshotu pohnulo oproti předchozímu — na pár sekund pro
// zvýraznění řádků a navíc jedna věta pro čtečku obrazovky.
// Stav se mění jen při skutečné změně čísel a při jejím vypršení (žádný
// timer po sekundách, žádné překreslení stromu při nezměněném dotazu).
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { candidateCueText, changeSignature, diffSnapshots, partyCueText, summarize } from '../lib/changes.js'

export const CHANGE_WINDOW_MS = 4000

export const ChangesContext = createContext({ changes: null, tick: 0 })

// `snapshot` = poslední živý snapshot (null před prvním načtením). První
// snapshot (i obnovený ze sessionStorage) jen zapíše výchozí stav.
export function useChanges(snapshot, summaryOpts) {
    const sig = useMemo(() => changeSignature(snapshot), [snapshot])
    const [state, setState] = useState(() => ({ sig, prev: snapshot, changes: null, tick: 0, summary: '' }))

    // Stav odvozený při renderu (vzor z dokumentace Reactu): bez efektu a bez
    // dalšího vykreslení navíc, když se podpis nezměnil
    if (snapshot && sig !== state.sig) {
        const diff = diffSnapshots(state.prev, snapshot)
        setState(diff.changed
            ? { sig, prev: snapshot, changes: diff, tick: state.tick + 1, summary: summarize(diff, summaryOpts) }
            : { ...state, sig, prev: snapshot })
    }

    const active = !!state.changes
    const { tick } = state
    useEffect(() => {
        if (!active) return undefined
        const t = setTimeout(() => setState((s) => (s.tick === tick ? { ...s, changes: null } : s)), CHANGE_WINDOW_MS)
        return () => clearTimeout(t)
    }, [active, tick])

    return useMemo(() => ({ changes: state.changes, tick: state.tick, summary: state.summary }), [state.changes, state.tick, state.summary])
}

// Třída (blesk řádku) a text šipky pro stranu / kandidáta. Čisté funkce nad
// hodnotou kontextu — volají se i uvnitř map(), proto to nejsou hooky.
// tick střídá dvě varianty animace, ať se při další změně v okně spustí znovu.
const flashClass = (tick) => (tick % 2 ? 'row-flash' : 'row-flash flash-alt')
const NONE = { className: '', cue: '' }

export const useChangesContext = () => useContext(ChangesContext)

export function partyChange({ changes, tick }, partyId) {
    const entry = changes?.parties.get(partyId)
    return entry ? { className: flashClass(tick), cue: partyCueText(entry), entry } : NONE
}

export function candidateChange({ changes, tick }, key) {
    const move = changes?.councilorMoves.get(key)
    return move ? { className: flashClass(tick), cue: candidateCueText(move) } : NONE
}
