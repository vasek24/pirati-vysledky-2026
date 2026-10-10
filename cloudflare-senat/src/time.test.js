import { test, expect } from 'vitest'
import { parsePragueTime } from './time.js'

const utc = (...a) => Date.UTC(...a)

test('summer time (+02:00)', () => {
  expect(parsePragueTime('2026-10-10T14:00:00')).toBe(utc(2026, 9, 10, 12, 0, 0))
  expect(parsePragueTime('2026-10-25T01:59:59')).toBe(utc(2026, 9, 24, 23, 59, 59))
})

test('autumn change: ambiguous hour is the first occurrence, 03:00 is winter time', () => {
  expect(parsePragueTime('2026-10-25T02:30:00')).toBe(utc(2026, 9, 25, 0, 30, 0))
  expect(parsePragueTime('2026-10-25T03:00:00')).toBe(utc(2026, 9, 25, 2, 0, 0))
})

test('winter time (+01:00) and the spring change', () => {
  expect(parsePragueTime('2026-12-01T08:00:00')).toBe(utc(2026, 11, 1, 7, 0, 0))
  expect(parsePragueTime('2026-03-29T01:59:59')).toBe(utc(2026, 2, 29, 0, 59, 59))
  expect(parsePragueTime('2026-03-29T03:00:00')).toBe(utc(2026, 2, 29, 1, 0, 0))
})

test('explicit zones are honoured, fractions and a space separator are accepted', () => {
  expect(parsePragueTime('2026-10-10T12:00:00Z')).toBe(utc(2026, 9, 10, 12, 0, 0))
  expect(parsePragueTime('2026-10-10T14:00:00+02:00')).toBe(utc(2026, 9, 10, 12, 0, 0))
  expect(parsePragueTime('2026-10-10 14:00:00.250')).toBe(utc(2026, 9, 10, 12, 0, 0))
})

test('invalid input -> null', () => {
  for (const bad of [null, undefined, '', 'junk', '2026-13-01T00:00:00', '2026-02-30T10:00:00', '2026-10-10T25:00:00', '2026-10-10', 42]) {
    expect(parsePragueTime(bad)).toBeNull()
  }
})
