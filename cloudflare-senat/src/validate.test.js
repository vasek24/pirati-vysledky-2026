import { describe, it, expect } from 'vitest';
import { validateCandidate, snapshotHash, baselineApplies } from './validate.js';

const CLOSE = Date.parse('2026-10-10T14:00:00+02:00');
const T_PRE = CLOSE - 3600e3; // 13:00
const T1 = CLOSE + 3600e3; // 15:00
const T2 = T1 + 60e3;
const BASE = 'https://csu.test/senat';

const ctx = (over = {}) => ({ goodRefreshedAt: T1, pollsCloseR1: CLOSE, base: BASE, goodBase: BASE, ...over });

// Minimální snapshot ve tvaru spec §3 (jen pole, která validátor čte).
// obvody: [{ n, z1, c1, z2, c2, cands: [{ no, votes1, votes2, st1, st2 }] }]
function mk({ generatedMs = T1, obvody, warnings = [], meta } = {}) {
    const list = obvody ?? [
        { n: 3, cands: [{ no: 1, votes1: 100 }, { no: 2, votes1: 50 }, { no: 3, votes1: 10 }] },
        { n: 6, cands: [{ no: 1, votes1: 70 }, { no: 2, votes1: 80 }] },
    ];
    const s = {
        v: 1,
        kind: 'senat',
        generated: '2026-10-10T15:00:00',
        generatedMs,
        warnings,
        obvody: list.map((o) => ({
            n: o.n,
            rounds: {
                1: { okrskyCelkem: o.c1 ?? 10, okrskyZprac: o.z1 ?? 5, platneHlasy: 160 },
                ...(o.z2 != null ? { 2: { okrskyCelkem: o.c2 ?? 10, okrskyZprac: o.z2, platneHlasy: 100 } } : {}),
            },
            candidates: o.cands.map((c) => ({
                no: c.no, votes1: c.votes1 ?? 0, votes2: c.votes2 ?? null, st1: c.st1 ?? null, st2: c.st2 ?? null,
            })),
        })),
    };
    if (meta) s.meta = meta;
    return s;
}

// Mění kopii snapshotu: mut(s) upraví hluboký klon
const edit = (s, mut) => {
    const c = structuredClone(s);
    mut(c);
    return c;
};
const ob = (s, n) => s.obvody.find((o) => o.n === n);
const cand = (s, n, no) => ob(s, n).candidates.find((c) => c.no === no);

const rej = (reason, quarantinable) => ({ outcome: 'rejected', reason, quarantinable });

describe('validateCandidate: hard rejects (never quarantinable)', () => {
    const good = mk();
    const cases = [
        ['generated-invalid', (s) => { s.generatedMs = null; }],
        ['generated-invalid', (s) => { s.generatedMs = NaN; }],
        ['obvody-empty', (s) => { s.obvody = []; }],
        ['obvod-no-candidates', (s) => { ob(s, 3).candidates = []; }],
        ['obvod-no-ucast', (s) => { delete ob(s, 3).rounds[1]; }],
        ['negative-or-invalid-number', (s) => { cand(s, 3, 1).votes1 = -1; }],
        ['negative-or-invalid-number', (s) => { cand(s, 3, 1).votes2 = -5; }],
        ['negative-or-invalid-number', (s) => { ob(s, 3).rounds[1].okrskyZprac = -1; }],
        ['negative-or-invalid-number', (s) => { ob(s, 3).rounds[1].okrskyCelkem = null; }],
        ['counted-out-of-range', (s) => { ob(s, 3).rounds[1].okrskyZprac = 11; }],
    ];
    it.each(cases)('%s', (reason, mut) => {
        const bad = edit(good, mut);
        expect(validateCandidate(bad, good, ctx())).toEqual(rej(reason, false));
        expect(validateCandidate(bad, null)).toEqual(rej(reason, false)); // i bez good
    });

    it('round 2 out of range is rejected too', () => {
        const bad = mk({ obvody: [{ n: 3, z2: 12, c2: 10, cands: [{ no: 1 }, { no: 2 }] }] });
        expect(validateCandidate(bad, null).reason).toBe('counted-out-of-range');
    });

    it('applies even when the baseline does not (pre-close good)', () => {
        const preGood = mk({ generatedMs: T_PRE });
        const bad = edit(good, (s) => { s.obvody = []; });
        expect(validateCandidate(bad, preGood, ctx({ goodRefreshedAt: T_PRE }))).toEqual(rej('obvody-empty', false));
    });
});

describe('validateCandidate: ok paths', () => {
    const good = mk();

    it('cold start (no good) needs no ctx', () => {
        expect(validateCandidate(good, null)).toEqual({ outcome: 'ok', quarantinable: false });
    });

    it('identical candidate is ok', () => {
        expect(validateCandidate(structuredClone(good), good, ctx())).toEqual({ outcome: 'ok', quarantinable: false });
    });

    it('same generated, more votes, more counted, new flags is ok', () => {
        const next = edit(good, (s) => {
            ob(s, 3).rounds[1].okrskyZprac = 10;
            cand(s, 3, 1).votes1 = 120;
            cand(s, 3, 1).st1 = '2.KOLO';
            cand(s, 3, 2).st1 = '2.KOLO';
            cand(s, 3, 3).st1 = 'NEZVOLEN';
            s.generatedMs = T2;
        });
        expect(validateCandidate(next, good, ctx())).toEqual({ outcome: 'ok', quarantinable: false });
    });

    it('more obvody / candidates than good is ok', () => {
        const next = edit(good, (s) => {
            ob(s, 3).candidates.push({ no: 4, votes1: 0, votes2: null, st1: null, st2: null });
            s.obvody.push({ ...structuredClone(ob(s, 6)), n: 9 });
        });
        expect(validateCandidate(next, good, ctx()).outcome).toBe('ok');
    });

    it('throws a TypeError for a missing/invalid ctx when a good snapshot is given', () => {
        expect(() => validateCandidate(good, good)).toThrow(TypeError);
        expect(() => validateCandidate(good, good, { ...ctx(), base: undefined })).toThrow(TypeError);
        expect(() => validateCandidate(good, good, { ...ctx(), goodRefreshedAt: NaN })).toThrow(TypeError);
    });
});

describe('validateCandidate: generated in the future (ctx.now)', () => {
    const good = mk();
    const future = (ms) => edit(good, (s) => { s.generatedMs = ms; });

    it('is a hard (non-quarantinable) reject beyond now + 5 min, with and without good', () => {
        const bad = future(T2 + 5 * 60e3 + 1);
        expect(validateCandidate(bad, good, ctx({ now: T2 }))).toEqual(rej('generated-in-future', false));
        expect(validateCandidate(bad, null, { now: T2 })).toEqual(rej('generated-in-future', false));
        expect(validateCandidate(future(9e15), good, ctx({ now: T2 }))).toEqual(rej('generated-in-future', false));
    });

    it('exactly now + 5 min passes; ctx.now is optional', () => {
        expect(validateCandidate(future(T2 + 5 * 60e3), good, ctx({ now: T2 })).outcome).toBe('ok');
        expect(validateCandidate(future(9e15), good, ctx()).outcome).toBe('ok'); // no now -> no check
        expect(validateCandidate(future(9e15), null).outcome).toBe('ok');
    });
});

describe('baselineApplies', () => {
    const good = mk();
    it('requires generated, refresh after close and same base', () => {
        expect(baselineApplies(good, ctx())).toBe(true);
        expect(baselineApplies(mk({ generatedMs: CLOSE - 1 }), ctx())).toBe(false);
        expect(baselineApplies(good, ctx({ goodRefreshedAt: CLOSE - 1 }))).toBe(false);
        expect(baselineApplies(good, ctx({ goodBase: 'https://other' }))).toBe(false);
        expect(baselineApplies(null, ctx())).toBe(false);
        expect(baselineApplies(mk({ generatedMs: CLOSE }), ctx({ goodRefreshedAt: CLOSE }))).toBe(true);
    });
});

describe('validateCandidate: older replica', () => {
    const good = mk();

    it('candidate generated before good is older (not quarantinable)', () => {
        const old = edit(good, (s) => { s.generatedMs = T1 - 1000; cand(s, 3, 1).votes1 = 1; });
        expect(validateCandidate(old, good, ctx())).toEqual({ outcome: 'older', quarantinable: false });
    });

    it('wins over fewer-obvody / regression (a stale replica is not a rejection)', () => {
        const old = edit(good, (s) => { s.generatedMs = T1 - 1000; s.obvody.pop(); });
        expect(validateCandidate(old, good, ctx()).outcome).toBe('older');
    });

    it('does not apply when the baseline does not (test data stamped later must not freeze the page)', () => {
        const testGood = mk({ generatedMs: T_PRE + 600e3 }); // 13:10 test data
        const real = mk({ generatedMs: T_PRE }); // "older" than the test file, still pre-close
        expect(validateCandidate(real, testGood, ctx({ goodRefreshedAt: T_PRE }))).toEqual({ outcome: 'ok', quarantinable: false });
        // good vygenerovaný před 14:00, ale ověřený po 14:00 (zmrazený soubor) → také bez baseline
        expect(validateCandidate(real, testGood, ctx())).toEqual({ outcome: 'ok', quarantinable: false });
    });
});

describe('validateCandidate: quarantinable structural changes', () => {
    const good = mk();

    it('fewer obvody than good', () => {
        const next = edit(good, (s) => { s.obvody.pop(); });
        expect(validateCandidate(next, good, ctx())).toEqual(rej('obvody-fewer', true));
    });

    it('withdrawal: candidate count -1 in an obvod', () => {
        const next = edit(good, (s) => { ob(s, 3).candidates.pop(); });
        expect(validateCandidate(next, good, ctx())).toEqual(rej('candidates-fewer', true));
    });

    it('M1: a replaced / renamed obvod (same count, different set) is caught', () => {
        const next = edit(good, (s) => { ob(s, 6).n = 9; });
        expect(validateCandidate(next, good, ctx())).toEqual(rej('obvody-changed', true));
        // the review's case: obvod 3 replaced by a second copy of obvod 6
        const copy = edit(good, (s) => { s.obvody[0] = { ...structuredClone(ob(s, 6)) }; });
        expect(validateCandidate(copy, good, ctx()).outcome).toBe('rejected');
    });

    it('is not applied without the baseline (pre-close good replaced by a smaller set)', () => {
        const preGood = mk({ generatedMs: T_PRE });
        const next = edit(good, (s) => { s.obvody.pop(); });
        expect(validateCandidate(next, preGood, ctx({ goodRefreshedAt: T_PRE }))).toEqual({ outcome: 'ok', quarantinable: false });
    });
});

describe('validateCandidate: regression (quarantinable)', () => {
    const good = mk({
        obvody: [
            { n: 3, z1: 6, cands: [{ no: 1, votes1: 100, st1: '2.KOLO' }, { no: 2, votes1: 90, st1: '2.KOLO' }, { no: 3, votes1: 10, st1: 'NEZVOLEN' }] },
            { n: 6, z1: 10, z2: 4, cands: [{ no: 1, votes1: 70, votes2: 40 }, { no: 2, votes1: 80, votes2: 50 }] },
        ],
    });

    it('okrskyZprac decrease, round 1', () => {
        const next = edit(good, (s) => { ob(s, 3).rounds[1].okrskyZprac = 5; });
        expect(validateCandidate(next, good, ctx())).toEqual(rej('counted-decreased', true));
    });

    it('okrskyZprac decrease, round 2', () => {
        const next = edit(good, (s) => { ob(s, 6).rounds[2].okrskyZprac = 3; });
        expect(validateCandidate(next, good, ctx())).toEqual(rej('counted-decreased', true));
    });

    it('round 2 disappearing after it had counted precincts', () => {
        const next = edit(good, (s) => { delete ob(s, 6).rounds[2]; });
        expect(validateCandidate(next, good, ctx())).toEqual(rej('counted-decreased', true));
    });

    it('votes1 decrease', () => {
        const next = edit(good, (s) => { cand(s, 3, 3).votes1 = 9; });
        expect(validateCandidate(next, good, ctx())).toEqual(rej('votes-decreased', true));
    });

    it('votes2 decrease', () => {
        const next = edit(good, (s) => { cand(s, 6, 2).votes2 = 49; });
        expect(validateCandidate(next, good, ctx())).toEqual(rej('votes-decreased', true));
    });

    it('votes2 disappearing (null) counts as a decrease', () => {
        const next = edit(good, (s) => { cand(s, 6, 1).votes2 = null; });
        expect(validateCandidate(next, good, ctx())).toEqual(rej('votes-decreased', true));
    });

    it('official flag disappearing', () => {
        const next = edit(good, (s) => { cand(s, 3, 1).st1 = null; });
        expect(validateCandidate(next, good, ctx())).toEqual(rej('official-flag-changed', true));
    });

    it('2.KOLO -> NEZVOLEN change is quarantinable', () => {
        const next = edit(good, (s) => { cand(s, 3, 2).st1 = 'NEZVOLEN'; });
        expect(validateCandidate(next, good, ctx())).toEqual(rej('official-flag-changed', true));
    });

    it('st2 flag changing', () => {
        const g2 = edit(good, (s) => { cand(s, 6, 2).st2 = 'ZVOLEN'; });
        const next = edit(g2, (s) => { cand(s, 6, 2).st2 = 'NEZVOLEN'; });
        expect(validateCandidate(next, g2, ctx())).toEqual(rej('official-flag-changed', true));
        const gone = edit(g2, (s) => { cand(s, 6, 2).st2 = null; });
        expect(validateCandidate(gone, g2, ctx())).toEqual(rej('official-flag-changed', true));
    });

    it('a new flag appearing (null -> value) is fine', () => {
        const next = edit(good, (s) => { cand(s, 6, 2).st2 = 'ZVOLEN'; });
        expect(validateCandidate(next, good, ctx()).outcome).toBe('ok');
    });

    it('M2: a candidate that carried an official flag vanishing (same count, replaced) is official-flag-changed', () => {
        const flagged = mk({ obvody: [{ n: 3, z1: 10, cands: [{ no: 1, votes1: 60, st1: 'ZVOLEN' }, { no: 2, votes1: 40, st1: 'NEZVOLEN' }] }] });
        const next = edit(flagged, (s) => {
            ob(s, 3).candidates = [{ no: 2, votes1: 40, votes2: null, st1: 'NEZVOLEN', st2: null }, { no: 5, votes1: 0, votes2: null, st1: null, st2: null }];
        });
        expect(validateCandidate(next, flagged, ctx())).toEqual(rej('official-flag-changed', true));
        // st2-only flag too
        const f2 = mk({ obvody: [{ n: 6, z1: 10, z2: 10, cands: [{ no: 1, votes1: 5, votes2: 9, st2: 'ZVOLEN' }, { no: 2, votes1: 6, votes2: 8 }] }] });
        const n2 = edit(f2, (s) => { cand(s, 6, 1).no = 7; });
        expect(validateCandidate(n2, f2, ctx())).toEqual(rej('official-flag-changed', true));
    });

    it('an unflagged candidate replaced by a different number (same count) is not judged by votes', () => {
        const next = edit(good, (s) => {
            const c = cand(s, 6, 2); // obvod 6 carries no official flags
            c.no = 4; c.votes1 = 0; c.votes2 = null;
        });
        expect(validateCandidate(next, good, ctx()).outcome).toBe('ok');
    });
});

describe('validateCandidate: scenarios around the close of polls', () => {
    it('pre-close good is replaced by a lower/zero candidate (ok)', () => {
        const preGood = mk({ generatedMs: T_PRE, obvody: [{ n: 3, z1: 5, cands: [{ no: 1, votes1: 500 }, { no: 2, votes1: 400 }] }] });
        const zero = mk({ generatedMs: T1, obvody: [{ n: 3, z1: 0, cands: [{ no: 1 }, { no: 2 }] }] });
        expect(validateCandidate(zero, preGood, ctx({ goodRefreshedAt: T_PRE }))).toEqual({ outcome: 'ok', quarantinable: false });
        // i když good dostal po 14:00 jen 304 (refreshedAt po uzavření), jeho generated je před ním
        expect(validateCandidate(zero, preGood, ctx({ goodRefreshedAt: T1 }))).toEqual({ outcome: 'ok', quarantinable: false });
    });

    it('test data then reset to zero: frozen file after close is replaced by real data, then regression applies', () => {
        // 13:59 stažen testovací soubor s hlasy, ověřován dál i po 14:00 (304)
        const testGood = mk({ generatedMs: T_PRE, obvody: [{ n: 3, z1: 9, cands: [{ no: 1, votes1: 900 }, { no: 2, votes1: 800 }] }] });
        const ctxAfter = ctx({ goodRefreshedAt: CLOSE + 60e3 });
        // reset na nuly po 14:00 se přijme (baseline neplatí) …
        const reset = mk({ generatedMs: T1, obvody: [{ n: 3, z1: 0, cands: [{ no: 1 }, { no: 2 }] }] });
        expect(validateCandidate(reset, testGood, ctxAfter).outcome).toBe('ok');
        // … a od té chvíle je baseline reset (stažen i vygenerován po 14:00) a hlídá regresi
        const real = mk({ generatedMs: T1 + 60e3, obvody: [{ n: 3, z1: 4, cands: [{ no: 1, votes1: 300 }, { no: 2, votes1: 250 }] }] });
        expect(validateCandidate(real, reset, ctx({ goodRefreshedAt: T1 })).outcome).toBe('ok');
        const back = mk({ generatedMs: T1 + 120e3, obvody: [{ n: 3, z1: 0, cands: [{ no: 1 }, { no: 2 }] }] });
        expect(validateCandidate(back, real, ctx({ goodRefreshedAt: T1 + 60e3 }))).toEqual(rej('counted-decreased', true));
    });

    it('a different base never keeps the baseline', () => {
        const good = mk();
        const next = edit(good, (s) => { cand(s, 3, 1).votes1 = 0; s.generatedMs = T1 - 5000; });
        expect(validateCandidate(next, good, ctx({ goodBase: 'https://old' })).outcome).toBe('ok');
    });
});

describe('snapshotHash', () => {
    const a = mk({ warnings: ['sum-mismatch:3:1', 'attribution-mismatch:6:2'], meta: { refreshedAt: 1, stale: false } });

    it('is stable and deterministic', () => {
        expect(snapshotHash(a)).toBe(snapshotHash(structuredClone(a)));
        expect(snapshotHash(a)).toMatch(/^[0-9a-f]{14}$/);
    });

    it('ignores generated, generatedMs, meta and the order of warnings', () => {
        const b = edit(a, (s) => {
            s.generated = '2026-10-10T16:00:00';
            s.generatedMs += 60e3;
            s.meta = { refreshedAt: 99, stale: true };
            s.warnings = [...s.warnings].reverse();
        });
        expect(snapshotHash(b)).toBe(snapshotHash(a));
        const { meta, ...noMeta } = a; // eslint-disable-line no-unused-vars
        expect(snapshotHash(noMeta)).toBe(snapshotHash(a));
    });

    it('ignores object key order', () => {
        const b = { ...a, obvody: a.obvody.map((o) => ({ candidates: o.candidates, rounds: o.rounds, n: o.n })) };
        expect(snapshotHash(b)).toBe(snapshotHash(a));
    });

    it('changes with votes, flags and warnings content', () => {
        expect(snapshotHash(edit(a, (s) => { cand(s, 3, 1).votes1 += 1; }))).not.toBe(snapshotHash(a));
        expect(snapshotHash(edit(a, (s) => { cand(s, 3, 1).st1 = 'ZVOLEN'; }))).not.toBe(snapshotHash(a));
        expect(snapshotHash(edit(a, (s) => { s.warnings.push('x'); }))).not.toBe(snapshotHash(a));
    });
});

describe('validateCandidate: L7 manifest obvod set on a cold start (ctx.requireManifestSet)', () => {
    const W = 'obvody-set-differs-from-manifest';
    const differs = mk({ warnings: [W] });
    const strict = { now: T1, requireManifestSet: true };

    it('no good + requireManifestSet === true + the normalize warning = hard reject, never quarantinable', () => {
        expect(validateCandidate(differs, null, strict)).toEqual(rej(W, false));
    });

    it('without the flag (or with a truthy non-true value) the warning stays soft', () => {
        expect(validateCandidate(differs, null, { now: T1 })).toEqual({ outcome: 'ok', quarantinable: false });
        expect(validateCandidate(differs, null, { now: T1, requireManifestSet: false })).toEqual({ outcome: 'ok', quarantinable: false });
        expect(validateCandidate(differs, null, { now: T1, requireManifestSet: 1 })).toEqual({ outcome: 'ok', quarantinable: false });
        expect(validateCandidate(differs, null)).toEqual({ outcome: 'ok', quarantinable: false });
    });

    it('no warning (same set, or an empty manifest, for which normalize emits none) passes even with the flag', () => {
        expect(validateCandidate(mk(), null, strict)).toEqual({ outcome: 'ok', quarantinable: false });
        expect(validateCandidate(mk({ warnings: ['sum-mismatch:3:1'] }), null, strict)).toEqual({ outcome: 'ok', quarantinable: false });
    });

    it('with a good snapshot the structural checks decide, not this one', () => {
        const good = mk();
        expect(validateCandidate(differs, good, { ...ctx(), ...strict })).toEqual({ outcome: 'ok', quarantinable: false });
    });
});
