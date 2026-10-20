// Zavření volebních místností aktuálního kola: kdy a za jak dlouho (hlavička před koncem
// hlasování, stejná věta jako na praha.dg12.cz). Čas bere z odpovědi serveru (`snapshot.closes`,
// tedy i s přepisem POLLS_CLOSE_R2 ve workeru); tyto konstanty jsou jen záloha (starší odpověď,
// ještě nic nenačteno) a musí odpovídat výchozím POLLS_CLOSE_R1/R2 ve workeru.
export const POLLS_CLOSE = {
  1: Date.parse('2026-10-10T14:00:00+02:00'),
  2: Date.parse('2026-10-17T14:00:00+02:00'),
}

// „17. 10.“ z času zavření (pražské datum, ne UTC: 24. 10. ve 00:30 v Praze je ještě 23. 10. v UTC)
const dayFmt = new Intl.DateTimeFormat('cs-CZ', { timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric' })
export function closeDate(ms) {
  const p = Object.fromEntries(dayFmt.formatToParts(ms).map((x) => [x.type, x.value]))
  return `${p.day}. ${p.month}.`
}
// Výchozí data (text „v sobotu … ve 14:00“ je v T.closesBefore)
export const CLOSE_DATE = { 1: closeDate(POLLS_CLOSE[1]), 2: closeDate(POLLS_CLOSE[2]) }

// Časy zavření ze serveru, jen když dávají smysl (konečná čísla, 2. kolo po 1.), jinak výchozí konstanty
export function closesOf(snapshot) {
  const c = snapshot?.closes
  const ok = c && Number.isFinite(c[1]) && Number.isFinite(c[2]) && c[2] > c[1]
  return ok ? { 1: c[1], 2: c[2] } : POLLS_CLOSE
}

// „43 min“, „1 h 5 min“, „6 d 22 h“ (nikdy „0 min“)
export function remaining(ms) {
  const min = Math.floor(ms / 60000)
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  if (d > 0) return `${d} d ${h} h`
  if (h > 0) return `${h} h ${m} min`
  return `${Math.max(1, m)} min`
}

// Čeká se ještě na 2. kolo? Server do zavření místností 2. kola žádná data 2. kola neposílá
// (snapshot.round zůstává 1 celý týden), takže se soudí podle stavu 1. kola: je obvod, který míří
// do 2. kola (nebo shoda hlasů) podle oficiálních příznaků ČSÚ — dokud nic takového není, neodpočítáváme.
export function runoffExpected(snapshot) {
  if (!snapshot) return false
  const sum = snapshot.summary
  if (sum && (sum.runoff ?? 0) + (sum.ties ?? 0) > 0) return true
  if ((snapshot.obvody ?? []).some((o) => o.state === 'runoff' || o.state === 'runoff-counting')) return true
  // nic nerozhodnuté neznamená 2. kolo: odpočet se ukáže až když ČSÚ oficiálně pošle postup do 2. kola
  return false
}

// null = nic neodpočítáváme, jinak { round, date, left }:
//  - před zavřením místností 1. kola odpočet do 1. kola,
//  - mezi koly odpočet do zavření 2. kola, pokud se 2. kolo čeká (viz runoffExpected),
//  - po zavření 2. kola (výchozí 17. 10. ve 14:00) nic (zůstává jen řádek čerstvosti).
export function closingModel(snapshot, serverNow) {
  if (!Number.isFinite(serverNow)) return null
  const closes = closesOf(snapshot)
  const round = serverNow < closes[1] ? 1 : runoffExpected(snapshot) ? 2 : null
  if (round == null) return null
  const ms = closes[round] - serverNow
  return ms > 0 ? { round, date: closeDate(closes[round]), left: remaining(ms) } : null
}
