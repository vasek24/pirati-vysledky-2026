import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createPoller } from './poller.js'
import { waiting } from './fixtures/scenarios.js'

const T0 = Date.parse('2026-10-10T16:00:00Z')

const json = (body, { status = 200, headers = {} } = {}) => ({
  ok: status < 400,
  status,
  headers: { get: (k) => ({ 'content-type': 'application/json', ...headers })[k.toLowerCase()] ?? null },
  json: async () => body,
})

function setup({ responses, hidden = false, random = () => 0 }) {
  const calls = []
  let i = 0
  const events = { snaps: [], fails: 0, schedules: [] }
  let isHidden = hidden
  const poller = createPoller({
    fetchFn: async (url) => {
      calls.push(url)
      const r = responses[Math.min(i++, responses.length - 1)]
      if (r instanceof Error) throw r
      return r
    },
    now: () => Date.now(),
    random,
    isHidden: () => isHidden,
    onSnapshot: (s, skew) => events.snaps.push({ s, skew }),
    onFailure: () => { events.fails += 1 },
    onSchedule: (at) => events.schedules.push(at),
  })
  return { poller, calls, events, setHidden: (v) => { isHidden = v } }
}

describe('poller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
  })
  afterEach(() => vi.useRealTimers())

  test('first request goes out at once, next one follows nextRefreshAt (+ tab offset 0)', async () => {
    const snap = { ...waiting(), nextRefreshAt: T0 + 30000 }
    const { poller, calls, events } = setup({ responses: [json(snap, { headers: { 'x-server-now': String(T0 + 2000) } })] })
    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toEqual(['/api/senat'])
    expect(events.snaps).toHaveLength(1)
    expect(events.snaps[0].skew).toBe(2000) // x-server-now − client now
    // server time = T0 + 2000, nextRefreshAt = T0 + 30000 → 28 s later
    await vi.advanceTimersByTimeAsync(27000)
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1100)
    expect(calls).toHaveLength(2)
    poller.stop()
  })

  test('failures (network, 503, wrong version, not JSON) keep trying with backoff, never below 5 s', async () => {
    const bad = [
      new Error('offline'),
      json({ error: 'unavailable' }, { status: 503 }),
      json({ ...waiting(), v: 2 }),
      json({}, { headers: { 'content-type': 'text/html' } }),
    ]
    const { poller, calls, events } = setup({ responses: bad })
    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(events.fails).toBe(1)
    await vi.advanceTimersByTimeAsync(4900)
    expect(calls).toHaveLength(1) // backoff floor is 5 s
    await vi.advanceTimersByTimeAsync(400000)
    expect(calls.length).toBeGreaterThanOrEqual(4)
    expect(events.snaps).toHaveLength(0)
    poller.stop()
  })

  test('a hidden tab loads once, then does not poll until it becomes visible', async () => {
    const { poller, calls, setHidden, events } = setup({ responses: [json({ ...waiting(), nextRefreshAt: T0 + 60000 })], hidden: true })
    poller.start()
    await vi.advanceTimersByTimeAsync(120000)
    expect(calls).toHaveLength(1) // the first load happens even in a background tab
    expect(events.schedules.at(-1)).toBeNull()
    setHidden(false)
    poller.onVisibility()
    await vi.advanceTimersByTimeAsync(1000)
    expect(calls).toHaveLength(2)
    poller.stop()
  })

  test('hiding the tab cancels the pending request', async () => {
    const { poller, calls, setHidden } = setup({ responses: [json({ ...waiting(), nextRefreshAt: T0 + 20000 })] })
    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    setHidden(true)
    poller.onVisibility()
    await vi.advanceTimersByTimeAsync(120000)
    expect(calls).toHaveLength(1)
    poller.stop()
  })

  test('stop prevents further requests', async () => {
    const { poller, calls } = setup({ responses: [json({ ...waiting(), nextRefreshAt: T0 + 6000 })] })
    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    poller.stop()
    await vi.advanceTimersByTimeAsync(120000)
    expect(calls).toHaveLength(1)
  })
  test('final snapshot: polling stops for good (also on visibility / online), a stale final one keeps going', async () => {
    const final = { ...waiting(), phase: 'final', stale: false, nextRefreshAt: T0 + 6000 }
    const { poller, calls, events } = setup({ responses: [json(final)] })
    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(events.snaps).toHaveLength(1)
    expect(events.schedules.at(-1)).toBeNull()
    poller.onVisibility()
    poller.onOnline()
    await vi.advanceTimersByTimeAsync(3600000)
    expect(calls).toHaveLength(1)
    const stale = setup({ responses: [json({ ...final, stale: true })] })
    stale.poller.start()
    await vi.advanceTimersByTimeAsync(60000)
    expect(stale.calls.length).toBeGreaterThan(1)
    stale.poller.stop()
  })
})
