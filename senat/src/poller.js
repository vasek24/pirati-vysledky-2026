// Plánovač dotazů na /api/senat bez Reactu a bez DOM (vše se vkládá zvenku).
// Další dotaz podle `nextRefreshAt` ze serveru + náhodný posun záložky, chyba =
// backoff, skrytá záložka nedotazuje. Hodiny serveru z hlavičky `x-server-now`.
import { MIN_GAP_MS, backoffDelay, clampTimeout, nextPollDelay, nextSkew, pickOffset, visibilityDelay } from './schedule.js'
import { isSnapshot } from './state.js'

const TIMEOUT_MS = 25_000

export function createPoller({
  url = '/api/senat',
  fetchFn = (...a) => fetch(...a),
  now = Date.now,
  random = Math.random,
  isHidden = () => false,
  skew: initialSkew = 0,
  onSnapshot,
  onFailure,
  onSchedule,
}) {
  const offset = pickOffset(random()) // jednou za záložku
  let skew = initialSkew
  let errors = 0
  let timer = null
  let dueAt = null // čas serveru
  let lastAttempt = 0
  let inFlight = false
  let stopped = false

  const serverNow = () => now() + skew

  function arm(ms) {
    clearTimeout(timer)
    const wait = clampTimeout(Math.max(ms, MIN_GAP_MS - (now() - lastAttempt), 0))
    dueAt = serverNow() + wait
    if (isHidden()) {
      onSchedule(null)
      return
    }
    onSchedule(dueAt)
    timer = setTimeout(run, wait)
  }

  async function run() {
    if (inFlight || stopped) return
    inFlight = true
    clearTimeout(timer)
    lastAttempt = now()
    const sent = now()
    let delay
    try {
      const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(TIMEOUT_MS) : undefined
      const res = await fetchFn(url, { headers: { Accept: 'application/json' }, signal })
      skew = nextSkew(skew, res.headers.get('x-server-now'), (sent + now()) / 2)
      if (!(res.headers.get('content-type') || '').includes('application/json')) throw new Error('not-json')
      const body = await res.json()
      if (!res.ok || !isSnapshot(body)) throw new Error('bad-snapshot')
      errors = 0
      onSnapshot(body, skew)
      delay = nextPollDelay({ nextRefreshAt: body.nextRefreshAt, now: serverNow(), offset, random: random() })
    } catch {
      errors += 1
      onFailure(skew)
      delay = backoffDelay(errors, random())
    }
    inFlight = false
    if (!stopped) arm(delay)
  }

  return {
    start: () => arm(0),
    stop() {
      stopped = true
      clearTimeout(timer)
    },
    // záložka zase vidět: když už je na čase, dotaz s náhodným zpožděním, jinak počkat do termínu
    onVisibility() {
      if (stopped) return
      if (isHidden()) {
        clearTimeout(timer)
        onSchedule(null)
        return
      }
      const left = dueAt === null ? 0 : dueAt - serverNow()
      arm(left > 0 ? left : visibilityDelay(random()))
    },
    // zpět online: znovu jen když se zrovna nedaří nebo už je na čase
    onOnline() {
      if (stopped || isHidden()) return
      if (errors > 0 || (dueAt !== null && dueAt <= serverNow())) arm(visibilityDelay(random()))
    },
  }
}
