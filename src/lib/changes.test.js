import { describe, expect, it } from 'vitest'
import { changeSignature, clearIfTick, diffSnapshots, initialChangeState, nextChangeState, partyCueText, candidateCueText, summarize } from './changes.js'

// Ručně psaný snapshot ve tvaru feed.js (zkráceně): 15 mandátů, 3 kandidátky
const party = (id, votes, extra = {}) => ({ id, name: `S${id}`, votes, candidates: 15, seats: null, ...extra })
const snap = ({ counted = 2, votes = [600, 300, 100], generated = '2026-10-10T16:00:00', fetchedAt = 'a', candidates = {}, zastup = 111, official = false } = {}) => ({
    v: 1,
    zastup,
    fetchedAt,
    generated,
    phase: 'counting',
    seats: 15,
    official,
    precincts: { total: 43, counted, pct: (counted / 43) * 100 },
    turnout: { pct: 50 },
    parties: votes.map((v, i) => party(i + 1, v)),
    candidates,
    okrsky: {},
})

describe('diffSnapshots', () => {
    it('první načtení (prev == null) nic neukáže', () => {
        const d = diffSnapshots(null, snap())
        expect(d.changed).toBe(false)
        expect(d.parties.size).toBe(0)
        expect(d.councilors.size).toBe(0)
        expect(diffSnapshots(undefined, snap()).changed).toBe(false)
    })

    it('stejná data nic neukáží', () => {
        expect(diffSnapshots(snap(), snap()).changed).toBe(false)
    })

    it('změna jen fetchedAt / generated nic neukáže', () => {
        expect(diffSnapshots(snap(), snap({ fetchedAt: 'b' })).changed).toBe(false)
        expect(diffSnapshots(snap(), snap({ generated: '2026-10-10T16:01:00', fetchedAt: 'b' })).changed).toBe(false)
    })

    it('+2 okrsky a víc hlasů jedné straně: změna se správnými delta', () => {
        const d = diffSnapshots(snap(), snap({ counted: 4, votes: [650, 300, 100] }))
        expect(d.changed).toBe(true)
        expect(d.precincts.delta).toBe(2)
        expect(d.parties.get(1)).toMatchObject({ votesDelta: 50, seatsDelta: 0, rankDelta: 0 })
        // ostatním stranám se hlasy nezměnily → nejsou v mapě
        expect(d.parties.has(2)).toBe(false)
        expect(d.parties.has(3)).toBe(false)
    })

    it('prohození pořadí: výš +1, níž −1', () => {
        const d = diffSnapshots(snap({ votes: [600, 300, 100] }), snap({ counted: 3, votes: [600, 100, 300] }))
        expect(d.changed).toBe(true)
        expect(d.parties.get(3).rankDelta).toBe(1)
        expect(d.parties.get(2).rankDelta).toBe(-1)
        expect(d.parties.has(1)).toBe(false)
    })

    it('zisk mandátu (odhad d\'Hondt): seatsDelta +1 u jedné a −1 u druhé', () => {
        // 15 mandátů: 800/200 → 12/3, 700/300 → 11/4 (d'Hondt)
        const d = diffSnapshots(snap({ votes: [800, 200, 0] }), snap({ counted: 3, votes: [700, 300, 0] }))
        expect(d.changed).toBe(true)
        expect(d.parties.get(2).seatsDelta).toBe(1)
        expect(d.parties.get(1).seatsDelta).toBe(-1)
    })

    it('jiné zastupitelstvo nebo kandidát bez shody: bez změny', () => {
        expect(diffSnapshots(snap({ zastup: 111 }), snap({ zastup: 222, counted: 9, votes: [1, 2, 3] })).changed).toBe(false)
    })

    it('počet sečtených okrsků klesl (reset dat ČSÚ): bez změny', () => {
        expect(diffSnapshots(snap({ counted: 30 }), snap({ counted: 0, votes: [0, 0, 0] })).changed).toBe(false)
    })

    it('zvolený kandidát: klíč strana-číslo a posun mandátu', () => {
        // strana 1 s 1 % hlasů pod klauzulí (0 mandátů), pak 50 % (8 mandátů)
        const prev = snap({ votes: [10, 990, 0], candidates: { 1: [{ n: 1, name: 'A', votes: 5 }, { n: 2, name: 'B', votes: 5 }] } })
        const next = snap({ counted: 3, votes: [500, 500, 0], candidates: { 1: [{ n: 1, name: 'A', votes: 100 }, { n: 2, name: 'B', votes: 400 }] } })
        const d = diffSnapshots(prev, next)
        expect(d.changed).toBe(true)
        expect(d.councilors.size).toBeGreaterThan(0)
        expect(d.councilors.has('1-2')).toBe(true)
        expect(d.councilorMoves.get('1-2').seatDelta).toBe(1)
        for (const key of d.councilors) expect(key).toMatch(/^\d+-\d+$/)
    })

    it('nevyhodí na nesmyslném vstupu', () => {
        for (const bad of [{}, [], 'x', 42, { parties: 'x' }, { parties: [null, 3, {}] }, { precincts: null, parties: [{ id: 1, votes: 'a' }] }]) {
            expect(() => diffSnapshots(bad, snap())).not.toThrow()
            expect(() => diffSnapshots(snap(), bad)).not.toThrow()
            expect(diffSnapshots(bad, bad).changed).toBe(false)
        }
        expect(diffSnapshots(snap(), { ...snap(), parties: [{ id: 1, votes: NaN }, null] }).parties).toBeInstanceOf(Map)
    })
})

describe('changeSignature', () => {
    it('stejné číselné údaje = stejný podpis, bez ohledu na fetchedAt', () => {
        expect(changeSignature(snap())).toBe(changeSignature(snap({ fetchedAt: 'jiný' })))
    })
    it('mění se s generated, okrsky i hlasy; null je prázdný řetězec', () => {
        const base = changeSignature(snap())
        expect(changeSignature(snap({ generated: '2026-10-10T16:01:00' }))).not.toBe(base)
        expect(changeSignature(snap({ counted: 3 }))).not.toBe(base)
        expect(changeSignature(snap({ votes: [601, 300, 100] }))).not.toBe(base)
        expect(changeSignature(null)).toBe('')
    })
})

describe('texty', () => {
    it('partyCueText: šipka + text pro hlasy, mandáty i pořadí', () => {
        expect(partyCueText({ votesDelta: 123, seatsDelta: 0, rankDelta: 0 })).toBe('▲ +123')
        expect(partyCueText({ votesDelta: -45, seatsDelta: 0, rankDelta: 0 })).toBe('▼ −45')
        expect(partyCueText({ votesDelta: 0, seatsDelta: 1, rankDelta: 0 })).toBe('▲ +1 místo')
        expect(partyCueText({ votesDelta: 0, seatsDelta: -2, rankDelta: 0 })).toBe('▼ −2 místa')
        expect(partyCueText({ votesDelta: 10, seatsDelta: 0, rankDelta: 2 })).toBe('▲ +10 · pořadí ↑2')
        expect(partyCueText({ votesDelta: 0, seatsDelta: 0, rankDelta: -1 })).toBe('pořadí ↓1')
        expect(partyCueText(null)).toBe('')
    })

    it('candidateCueText', () => {
        expect(candidateCueText({ seatDelta: 1, orderDelta: 0 })).toBe('▲ mandát')
        expect(candidateCueText({ seatDelta: -1, orderDelta: 0 })).toBe('▼ bez mandátu')
        expect(candidateCueText({ seatDelta: 0, orderDelta: 2 })).toBe('pořadí ↑2')
        expect(candidateCueText(undefined)).toBe('')
    })

    it('summarize: jedna věta se sečtenými okrsky a Piráty', () => {
        const d = diffSnapshots(snap({ counted: 29, votes: [600, 300, 100] }), snap({ counted: 31, votes: [700, 300, 100] }))
        const text = summarize(d, { oursId: 1, nameOf: () => 'Piráti' })
        expect(text).toMatch(/^Aktualizace: sečteno 31 z 43 okrsků \(\+2\)/)
        expect(text).toMatch(/Piráti \d+,\d %/)
        expect(text).toMatch(/\(\+\d,\d p\. b\.\)/)
    })

    it('summarize: první hlasy po prázdném stavu bez „+21,7 p. b."', () => {
        const d = diffSnapshots(snap({ counted: 0, votes: [0, 0, 0] }), snap({ counted: 5, votes: [600, 300, 100] }))
        expect(d.changed).toBe(true)
        const text = summarize(d, { oursId: 1, nameOf: () => 'Piráti' })
        expect(text).toBe('Aktualizace: sečteno 5 z 43 okrsků (+5); Piráti 60,0 %, mandáty 10 (+10)')
    })

    it('summarize: bez našich a bez okrsků pořád vrátí větu', () => {
        const d = diffSnapshots(snap({ votes: [600, 300, 100] }), snap({ votes: [601, 300, 100] }))
        expect(summarize(d, {})).toMatch(/^Aktualizace: /)
        expect(summarize({ changed: false }, {})).toBe('')
    })
})

describe('stav useChanges (nextChangeState / clearIfTick)', () => {
    const opts = { oursId: 1, nameOf: () => 'Piráti' }
    it('posloupnost: null → obnovený baseline → shodné → změna → jen čas → změna → zpožděný clear → clear', () => {
        let s = initialChangeState(null)
        expect(s.tick).toBe(0)
        // první snapshot (i obnovený ze sessionStorage) jen zapíše baseline
        const base = snap()
        s = nextChangeState(s, base, opts)
        expect(s).toMatchObject({ tick: 0, changes: null, summary: '', prev: base })
        // shodný (jiný objekt, jiný fetchedAt) = stejný stav, žádné překreslení
        const same = snap({ fetchedAt: 'b' })
        expect(nextChangeState(s, same, opts)).toBe(s)
        // změna čísel
        s = nextChangeState(s, snap({ counted: 4, votes: [650, 300, 100] }), opts)
        expect(s.tick).toBe(1)
        expect(s.changes.changed).toBe(true)
        expect(s.summary).toMatch(/^Aktualizace: sečteno 4 z 43/)
        // jen nové generated: tick i změny zůstávají, baseline se posune
        const timeOnly = snap({ counted: 4, votes: [650, 300, 100], generated: '2026-10-10T16:05:00' })
        const kept = s.changes
        s = nextChangeState(s, timeOnly, opts)
        expect(s.tick).toBe(1)
        expect(s.changes).toBe(kept)
        expect(s.prev).toBe(timeOnly)
        // další změna
        s = nextChangeState(s, snap({ counted: 6, votes: [700, 300, 100], generated: '2026-10-10T16:06:00' }), opts)
        expect(s.tick).toBe(2)
        // zpožděný clear starší změny nic neudělá
        expect(clearIfTick(s, 1)).toBe(s)
        const cleared = clearIfTick(s, 2)
        expect(cleared.changes).toBe(null)
        expect(cleared.summary).toBe('')
        expect(cleared.tick).toBe(2)
        // clear už vyčištěného stavu je no-op
        expect(clearIfTick(cleared, 2)).toBe(cleared)
    })
})
