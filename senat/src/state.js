// Stav hooku useSnapshot jako čistý reducer (testovatelný bez Reactu).
export const SNAPSHOT_VERSION = 1

// Přijímáme jen tělo s v === 1 (a tvarem, na kterém stránka stojí)
export const isSnapshot = (b) =>
  !!b && typeof b === 'object' && b.v === SNAPSHOT_VERSION && Array.isArray(b.obvody) && !!b.summary?.pirates

export const initialState = (cached) => ({
  snapshot: cached?.snapshot ?? null,
  skew: cached?.skew ?? 0, // čas serveru − čas klienta (ms)
  failures: 0, // dotazy neúspěšné za sebou
  nextAt: null, // plánovaný další dotaz (čas serveru), null = nic nečeká
})

export function reducer(state, action) {
  switch (action.type) {
    case 'ok':
      return { ...state, snapshot: action.snapshot, skew: action.skew, failures: 0 }
    case 'fail':
      return { ...state, skew: action.skew, failures: state.failures + 1 }
    case 'next':
      return state.nextAt === action.nextAt ? state : { ...state, nextAt: action.nextAt }
    default:
      return state
  }
}

// Co banner ukáže: 'loading' | 'error' (nic k zobrazení) | 'offline' | 'stale' | null
export function connectionNotice(state) {
  if (!state.snapshot) return state.failures > 0 ? 'error' : 'loading'
  if (state.failures > 0) return 'offline'
  return state.snapshot.stale ? 'stale' : null
}
