// Formátování pro zobrazení (čeština, čas Europe/Prague). Nic se tu neodvozuje.
const nfmt = new Intl.NumberFormat('cs-CZ')
const clock = new Intl.DateTimeFormat('cs-CZ', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
const day = new Intl.DateTimeFormat('cs-CZ', { timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric' })
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague' })

export const nf = (n) => nfmt.format(n)

// Jediný formátovač podílů a procent: ČSÚ procenta ořezává (nezaokrouhluje), takže 49,96 se nikdy
// nesmí ukázat jako „50,0 %“. Hodnotu ze serveru bereme tak, jak je (2 desetinná místa); delší
// (dopočtenou) hodnotu ořízneme, nikdy nezaokrouhlíme nahoru. Epsilon chrání před 4,35*100 = 434,999….
export function truncTo(x, d) {
  const k = 10 ** d
  return Math.floor((x ?? 0) * k + 1e-7) / k
}

// Chybějící podíl (null) je „–“, ne „0,00 %“.
export const pc = (x, d = 2) =>
  x == null ? '–' : `${truncTo(x, d).toLocaleString('cs-CZ', { minimumFractionDigits: d, maximumFractionDigits: d })} %`

// Titul před jménem a za jménem tak, jak je v registru (např. „Ing. Jan Novák, CSc.“)
export const fullName = (c) => {
  const head = [c.pre, c.name].filter(Boolean).join(' ')
  return c.post ? `${head}, ${c.post}` : head
}

// „17:42:08“; s datem („8. 10. 16:40:15“), když `ms` není ve stejný pražský den jako `refMs`
export function pragueTime(ms, refMs) {
  if (!Number.isFinite(ms)) return null
  const t = clock.format(ms)
  if (!Number.isFinite(refMs) || dayKey.format(ms) === dayKey.format(refMs)) return t
  return `${day.format(ms)} ${t}`
}

// Stáří údajů: „14 s“, od 2 min „N min“, od 2 h „N h“
export function formatAge(sec) {
  if (!Number.isFinite(sec)) return null
  if (sec < 120) return `${sec} s`
  if (sec < 7200) return `${Math.floor(sec / 60)} min`
  return `${Math.floor(sec / 3600)} h`
}

// Odpočet „M:SS“ (nikdy záporný)
export function mmss(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
