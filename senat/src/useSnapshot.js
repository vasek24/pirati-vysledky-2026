// Hook: snapshot ze /api/senat (plánování viz poller.js). Poslední platný
// snapshot drží sessionStorage (klíč senat.snap.v1), přístup vždy v try/catch.
import { useEffect, useReducer, useState } from 'react'
import { createPoller } from './poller.js'
import { initialState, isSnapshot, reducer } from './state.js'

const KEY = 'senat.snap.v1'

function readCached() {
  try {
    const c = JSON.parse(sessionStorage.getItem(KEY) || 'null')
    return c && isSnapshot(c.snapshot) && Number.isFinite(c.skew) ? c : null
  } catch {
    return null
  }
}

function writeCached(entry) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(entry))
  } catch {
    /* soukromý režim / plná kvóta — po reloadu se data stáhnou znovu */
  }
}

export function useSnapshot() {
  const [state, dispatch] = useReducer(reducer, undefined, () => initialState(readCached()))
  useEffect(() => {
    const poller = createPoller({
      isHidden: () => document.hidden,
      skew: state.skew,
      onSnapshot: (snapshot, skew) => {
        dispatch({ type: 'ok', snapshot, skew })
        writeCached({ snapshot, skew })
      },
      onFailure: (skew) => dispatch({ type: 'fail', skew }),
      onSchedule: (nextAt) => dispatch({ type: 'next', nextAt }),
    })
    const onVisibility = () => poller.onVisibility()
    const onOnline = () => poller.onOnline()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('online', onOnline)
    poller.start()
    return () => {
      poller.stop()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('online', onOnline)
    }
    // jednou za mount: počáteční skew je jen výchozí hodnota pollera
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return state
}

// Aktuální čas klienta pro odpočty, obnovovaný po `ms` (skrytá záložka stojí)
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden) setNow(Date.now())
    }, ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}
