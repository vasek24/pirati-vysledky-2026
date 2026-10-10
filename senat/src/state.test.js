import { describe, expect, test } from 'vitest'
import { connectionNotice, initialState, isSnapshot, reducer } from './state.js'
import { waiting } from './fixtures/scenarios.js'

describe('state', () => {
  test('isSnapshot accepts only v === 1 with the expected shape', () => {
    expect(isSnapshot(waiting())).toBe(true)
    expect(isSnapshot({ ...waiting(), v: 2 })).toBe(false)
    expect(isSnapshot({ ...waiting(), obvody: undefined })).toBe(false)
    expect(isSnapshot({ v: 1 })).toBe(false)
    expect(isSnapshot({ error: 'unavailable' })).toBe(false)
    expect(isSnapshot(null)).toBe(false)
    expect(isSnapshot('x')).toBe(false)
  })

  test('reducer: ok resets failures and keeps skew, fail keeps the last snapshot', () => {
    const s0 = initialState(null)
    expect(s0).toMatchObject({ snapshot: null, skew: 0, failures: 0, nextAt: null })
    const snap = waiting()
    const s1 = reducer(s0, { type: 'ok', snapshot: snap, skew: 1500 })
    expect(s1).toMatchObject({ snapshot: snap, skew: 1500, failures: 0 })
    const s2 = reducer(reducer(s1, { type: 'fail', skew: 1500 }), { type: 'fail', skew: 1600 })
    expect(s2.snapshot).toBe(snap)
    expect(s2.failures).toBe(2)
    expect(s2.skew).toBe(1600)
    expect(reducer(s2, { type: 'ok', snapshot: snap, skew: 1600 }).failures).toBe(0)
  })

  test('reducer: next is a no-op for the same value', () => {
    const s = initialState(null)
    expect(reducer(s, { type: 'next', nextAt: null })).toBe(s)
    expect(reducer(s, { type: 'next', nextAt: 5 }).nextAt).toBe(5)
    expect(reducer(s, { type: 'unknown' })).toBe(s)
  })

  test('initialState takes the cached snapshot and skew', () => {
    const snap = waiting()
    expect(initialState({ snapshot: snap, skew: -40 })).toMatchObject({ snapshot: snap, skew: -40 })
  })

  test('connectionNotice', () => {
    const snap = waiting()
    expect(connectionNotice({ snapshot: null, failures: 0 })).toBe('loading')
    expect(connectionNotice({ snapshot: null, failures: 2 })).toBe('error')
    expect(connectionNotice({ snapshot: snap, failures: 1 })).toBe('offline')
    expect(connectionNotice({ snapshot: { ...snap, stale: true }, failures: 0 })).toBe('stale')
    expect(connectionNotice({ snapshot: { ...snap, stale: true }, failures: 1 })).toBe('offline')
    expect(connectionNotice({ snapshot: snap, failures: 0 })).toBeNull()
  })
})
