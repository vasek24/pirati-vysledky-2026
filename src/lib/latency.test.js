import { describe, expect, it } from 'vitest';
import { fmtPragueTime, formatLatencyLine, latencyChain } from './latency.js';

// zone-less ČSÚ čas = pražský čas; 14:03:07 CEST = 12:03:07 UTC (testy běží s TZ=UTC)
const GENERATED = '2026-10-10T14:03:07';
const G = Date.parse('2026-10-10T12:03:07Z');

describe('latencyChain', () => {
    it('computes the whole chain in whole seconds', () => {
        const c = latencyChain({
            generated: GENERATED,
            refreshedAt: G + 12_000,
            servedAt: G + 20_000,
            receivedAt: G + 24_000,
            renderedAt: G + 24_400,
        });
        expect(c).toEqual({ csuToServer: 12, serverToClient: 12, receiveToRender: 0, total: 24 });
    });

    it('parses zone-less generated as Prague time, not runtime zone', () => {
        const c = latencyChain({ generated: GENERATED, refreshedAt: G + 5_000 });
        expect(c.csuToServer).toBe(5);
    });

    it('serverToClient is receivedAt minus refreshedAt, falling back to servedAt', () => {
        expect(latencyChain({ refreshedAt: G, servedAt: G + 3_000, receivedAt: G + 9_000 }).serverToClient).toBe(9);
        expect(latencyChain({ refreshedAt: G, servedAt: G + 3_000 }).serverToClient).toBe(3);
    });

    it('old server without the new fields gives all nulls', () => {
        const c = latencyChain({ generated: GENERATED, receivedAt: G + 5_000, renderedAt: G + 5_100 });
        expect(c).toEqual({ csuToServer: null, serverToClient: null, receiveToRender: 0, total: null });
        expect(latencyChain({})).toEqual({ csuToServer: null, serverToClient: null, receiveToRender: null, total: null });
        expect(latencyChain()).toEqual({ csuToServer: null, serverToClient: null, receiveToRender: null, total: null });
    });

    it('total is null unless every step is known', () => {
        const c = latencyChain({ generated: GENERATED, refreshedAt: G + 12_000, receivedAt: G + 20_000 });
        expect(c.csuToServer).toBe(12);
        expect(c.serverToClient).toBe(8);
        expect(c.receiveToRender).toBeNull();
        expect(c.total).toBeNull();
    });

    it('clamps negatives from client/server clock skew to 0', () => {
        const c = latencyChain({
            generated: GENERATED,
            refreshedAt: G + 10_000,
            servedAt: G + 9_000,
            receivedAt: G + 8_000,
            renderedAt: G + 7_000,
        });
        expect(c).toEqual({ csuToServer: 10, serverToClient: 0, receiveToRender: 0, total: 10 });
        for (const v of Object.values(c)) expect(v).toBeGreaterThanOrEqual(0);
    });

    it('generated in the future relative to refreshedAt clamps to 0', () => {
        const c = latencyChain({
            generated: GENERATED,
            refreshedAt: G - 30_000,
            receivedAt: G - 20_000,
            renderedAt: G - 19_000,
        });
        expect(c.csuToServer).toBe(0);
        expect(c.serverToClient).toBe(10);
        expect(c.total).toBe(11);
    });

    it('garbage inputs do not throw and give null', () => {
        const garbage = [NaN, Infinity, -Infinity, 'abc', '', null, undefined, {}, [], true];
        for (const g of garbage) {
            expect(() => latencyChain({ generated: g, refreshedAt: g, servedAt: g, receivedAt: g, renderedAt: g })).not.toThrow();
            const c = latencyChain({ generated: g, refreshedAt: g, servedAt: g, receivedAt: g, renderedAt: g });
            for (const v of Object.values(c)) expect(v).toBeNull();
        }
        expect(latencyChain({ generated: 'nesmysl', refreshedAt: G }).csuToServer).toBeNull();
        expect(latencyChain({ generated: GENERATED, refreshedAt: '1700000000000' }).csuToServer).toBeNull();
    });

    it('never returns NaN or non-integers', () => {
        const c = latencyChain({ generated: GENERATED, refreshedAt: G + 12_499, receivedAt: G + 24_501, renderedAt: G + 24_999 });
        for (const v of Object.values(c)) expect(Number.isInteger(v)).toBe(true);
    });
});

const LABELS = { generatedLabel: '14:03:07', refreshedLabel: '14:03:19', renderedLabel: '14:03:31' };

describe('formatLatencyLine', () => {
    it('formats the full chain', () => {
        const chain = { csuToServer: 12, serverToClient: 10, receiveToRender: 2, total: 24 };
        expect(formatLatencyLine(chain, LABELS)).toBe(
            'ČSÚ vygenerovalo 14:03:07 → náš server načetl 14:03:19 (+12 s) → váš prohlížeč zobrazil 14:03:31 (+12 s) · celkem 24 s',
        );
    });

    it('works with only two known steps (no browser step, no total)', () => {
        const chain = { csuToServer: 12, serverToClient: null, receiveToRender: null, total: null };
        expect(formatLatencyLine(chain, { generatedLabel: '14:03:07', refreshedLabel: '14:03:19' })).toBe(
            'ČSÚ vygenerovalo 14:03:07 → náš server načetl 14:03:19 (+12 s)',
        );
    });

    it('works with server and browser only (no generated)', () => {
        const chain = { csuToServer: null, serverToClient: 10, receiveToRender: 2, total: null };
        expect(formatLatencyLine(chain, { refreshedLabel: '14:03:19', renderedLabel: '14:03:31' })).toBe(
            'náš server načetl 14:03:19 → váš prohlížeč zobrazil 14:03:31 (+12 s)',
        );
    });

    it('is null with fewer than two known steps', () => {
        const none = { csuToServer: null, serverToClient: null, receiveToRender: null, total: null };
        expect(formatLatencyLine(none, {})).toBeNull();
        expect(formatLatencyLine(none, { generatedLabel: '14:03:07' })).toBeNull();
        expect(formatLatencyLine(none, { renderedLabel: '14:03:31' })).toBeNull();
        expect(formatLatencyLine(undefined, undefined)).toBeNull();
        expect(formatLatencyLine(null, LABELS)).toBeNull();
    });

    it('treats placeholder labels as unknown', () => {
        const chain = { csuToServer: null, serverToClient: null, receiveToRender: null, total: null };
        expect(formatLatencyLine(chain, { generatedLabel: '–', refreshedLabel: '–', renderedLabel: '14:03:31' })).toBeNull();
    });

    it('never prints NaN or negative numbers', () => {
        const chain = { csuToServer: NaN, serverToClient: -3, receiveToRender: Infinity, total: -1 };
        const line = formatLatencyLine(chain, LABELS);
        expect(line).not.toMatch(/NaN|Infinity|-\d/);
    });
});

describe('fmtPragueTime', () => {
    it('formats HH:MM:SS in Europe/Prague regardless of runtime zone', () => {
        expect(fmtPragueTime(G)).toBe('14:03:07');
        expect(fmtPragueTime(Date.parse('2026-10-10T22:00:00Z'))).toBe('00:00:00');
    });
    it('gives a placeholder for invalid input', () => {
        expect(fmtPragueTime(NaN)).toBe('–');
        expect(fmtPragueTime(null)).toBe('–');
        expect(fmtPragueTime('x')).toBe('–');
    });
});
