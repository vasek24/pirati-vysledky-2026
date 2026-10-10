// Zavření volebních místností aktuálního kola: kdy a za jak dlouho (hlavička před koncem
// hlasování, stejná věta jako na praha.dg12.cz). Čas je pevný, stejně jako POLLS_CLOSE_R1/R2
// ve workeru; kdyby se 2. kolo posunulo (env override ve workeru), upraví se tady.
export const POLLS_CLOSE = {
  1: Date.parse('2026-10-10T14:00:00+02:00'),
  2: Date.parse('2026-10-17T14:00:00+02:00'),
}
// Obě kola končí v sobotu ve 14:00 (text „v sobotu … ve 14:00“ je v T.closesBefore)
export const CLOSE_DATE = { 1: '10. 10.', 2: '17. 10.' }

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
function runoffExpected(snapshot) {
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
//  - po 17. 10. ve 14:00 nic (zůstává jen řádek čerstvosti).
export function closingModel(snapshot, serverNow) {
  if (!Number.isFinite(serverNow)) return null
  const round = serverNow < POLLS_CLOSE[1] ? 1 : runoffExpected(snapshot) ? 2 : null
  if (round == null) return null
  const ms = POLLS_CLOSE[round] - serverNow
  return ms > 0 ? { round, date: CLOSE_DATE[round], left: remaining(ms) } : null
}
