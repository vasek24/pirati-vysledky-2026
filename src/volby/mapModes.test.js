import { describe, it, expect } from 'vitest'
import { adaptiveBreaks } from './mapModes.js'

describe('adaptiveBreaks (průběžná škála mapy)', () => {
    it('málo okrsků nebo skoro stejné hodnoty → null (platí pevná škála)', () => {
        expect(adaptiveBreaks([7, 8, 9])).toBeNull()
        expect(adaptiveBreaks([7, 7.2, 7.4, 7.6, 7.8])).toBeNull()
        expect(adaptiveBreaks([])).toBeNull()
    })
    it('ignoruje okrsky bez hlasů (null)', () => {
        expect(adaptiveBreaks([null, null, 5, 9, 12, 14])).toHaveLength(7)
    })
    it('7 hranic = 8 stejně širokých stupňů od minima po maximum', () => {
        const b = adaptiveBreaks([4, 6, 8, 12, 16, 20])
        expect(b).toEqual([6, 8, 10, 12, 14, 16, 18])
    })
    it('hranice jsou rostoucí a zaokrouhlené na 0,1', () => {
        const b = adaptiveBreaks([5.3, 7.9, 9.1, 11.6, 13.7])
        expect(b.every((x, i) => i === 0 || x > b[i - 1])).toBe(true)
        expect(b.every((x) => Math.abs(x * 10 - Math.round(x * 10)) < 1e-9)).toBe(true)
    })
})
