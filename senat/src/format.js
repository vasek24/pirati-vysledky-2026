// Formátování pro zobrazení (čeština, čas Europe/Prague). Nic se tu neodvozuje.
const nfmt = new Intl.NumberFormat('cs-CZ')
const clock = new Intl.DateTimeFormat('cs-CZ', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
const day = new Intl.DateTimeFormat('cs-CZ', { timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric' })
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague' })

export const nf = (n) => nfmt.format(n)

export const pc = (x, d = 1) =>
  `${(x ?? 0).toLocaleString('cs-CZ', { minimumFractionDigits: d, maximumFractionDigits: d })} %`

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
