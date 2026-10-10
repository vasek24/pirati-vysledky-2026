import { describe, expect, test } from 'vitest'
import { formatAge, fullName, mmss, nf, pc, pragueTime } from './format.js'
import { progressText } from './view.js'

describe('format', () => {
  test('nf / pc use Czech separators', () => {
    expect(nf(1234567).replace(/\s/g, ' ')).toBe('1 234 567')
    expect(pc(12.345, 1)).toBe('12,3 %')
    expect(pc(0, 2)).toBe('0,00 %')
    expect(pc(null, 1)).toBe('0,0 %')
  })

  // ČSÚ procenta ořezává: nikdy nezaokrouhlujeme nahoru (49,96 se nesmí ukázat jako „50,0 %“)
  test('pc: 2 decimals by default, truncates, never rounds up', () => {
    const t = (x, d) => pc(x, d).replace(/\s/g, ' ')
    expect(t(49.96)).toBe('49,96 %')
    expect(t(49.96)).not.toMatch(/50,0/)
    expect(t(50.04)).toBe('50,04 %')
    expect(t(5)).toBe('5,00 %')
    expect(t(100)).toBe('100,00 %')
    expect(t(0)).toBe('0,00 %')
    expect(t(null)).toBe('0,00 %')
    expect(t(undefined)).toBe('0,00 %')
    // computed value with more decimals: truncated
    expect(t(49.999)).toBe('49,99 %')
    expect(t(49.9501)).toBe('49,95 %')
    expect(t(23.3353)).toBe('23,33 %')
    expect(t(99.995)).toBe('99,99 %')
    // binary float noise must not eat a hundredth (4.35 * 100 = 434.99999999999994)
    expect(t(4.35)).toBe('4,35 %')
    expect(t(23.33)).toBe('23,33 %')
    expect(t(0.29)).toBe('0,29 %')
    // explicit decimals truncate as well
    expect(t(49.96, 1)).toBe('49,9 %')
    expect(t(99.5, 0)).toBe('99 %')
  })

  // pozor na 199 z 200 okrsků: na celá procenta se zaokrouhluje dolů
  test('progressText rounds down: 100 only when every precinct is counted', () => {
    const r = (z, c) => ({ okrskyZprac: z, okrskyCelkem: c })
    expect(progressText(r(199, 200))).toBe(99)
    expect(progressText(r(239, 240))).toBe(99)
    expect(progressText(r(1, 200))).toBe(0)
    expect(progressText(r(200, 200))).toBe(100)
    expect(progressText(r(0, 0))).toBe(0)
    expect(progressText(r(0, 200))).toBe(0)
    expect(progressText(null)).toBe(0)
    expect(progressText(r(150, 300))).toBe(50)
  })

  test('fullName keeps registry titles verbatim, post-nominals after a comma', () => {
    expect(fullName({ pre: 'Mgr.', name: 'Adéla Sucharda Šípová', post: '' })).toBe('Mgr. Adéla Sucharda Šípová')
    expect(fullName({ pre: '', name: 'Mariam Szyja', post: null })).toBe('Mariam Szyja')
    expect(fullName({ pre: 'Ing.', name: 'Jan Novák', post: 'CSc.' })).toBe('Ing. Jan Novák, CSc.')
  })

  test('pragueTime formats zone-less ČSÚ time as Europe/Prague regardless of TZ', () => {
    const ms = Date.parse('2026-10-10T15:42:08+02:00') // CEST
    expect(pragueTime(ms, ms + 60000)).toBe('15:42:08')
    expect(pragueTime(Date.parse('2026-12-01T10:00:00Z'), Date.parse('2026-12-01T10:05:00Z'))).toBe('11:00:00') // CET
    // other Prague day than the reference: date goes first
    expect(pragueTime(Date.parse('2026-10-08T16:40:15+02:00'), Date.parse('2026-10-10T12:00:00+02:00'))).toBe('8. 10. 16:40:15')
    // 23:30 Prague is the same Prague day as 00:10 UTC next day would suggest otherwise
    expect(pragueTime(Date.parse('2026-10-10T23:30:00+02:00'), Date.parse('2026-10-10T23:50:00+02:00'))).toBe('23:30:00')
    expect(pragueTime(null)).toBeNull()
    expect(pragueTime(NaN)).toBeNull()
  })

  test('formatAge', () => {
    expect(formatAge(0)).toBe('0 s')
    expect(formatAge(119)).toBe('119 s')
    expect(formatAge(120)).toBe('2 min')
    expect(formatAge(7199)).toBe('119 min')
    expect(formatAge(7200)).toBe('2 h')
    expect(formatAge(null)).toBeNull()
  })

  test('mmss never goes negative and rounds up', () => {
    expect(mmss(46000)).toBe('0:46')
    expect(mmss(45001)).toBe('0:46')
    expect(mmss(61000)).toBe('1:01')
    expect(mmss(-5000)).toBe('0:00')
  })
})
