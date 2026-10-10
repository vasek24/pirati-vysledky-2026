// ČSÚ sends zone-less Europe/Prague local time. CEST (+02:00) runs from the last Sunday of
// March 01:00 UTC to the last Sunday of October 01:00 UTC, else CET (+01:00).
const HOUR = 3600000

function lastSundayUtc(year, month) {
  const last = new Date(Date.UTC(year, month + 1, 0))
  return Date.UTC(year, month, last.getUTCDate() - last.getUTCDay(), 1)
}

// -> epoch ms, or null when invalid. A nonexistent spring-forward hour resolves to CET; the
// ambiguous autumn hour resolves to its first occurrence (CEST).
export function parsePragueTime(str) {
  if (typeof str !== 'string') return null
  const s = str.trim()
  if (/(?:Z|[+-]\d\d:?\d\d)$/i.test(s)) {
    const ms = Date.parse(s)
    return Number.isNaN(ms) ? null : ms
  }
  const m = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)(?::(\d\d)(?:\.\d+)?)?$/.exec(s)
  if (!m) return null
  const [y, mo, d, h, mi, sec] = m.slice(1).map((x) => Number(x ?? 0))
  const local = Date.UTC(y, mo - 1, d, h, mi, sec)
  const back = new Date(local)
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d ||
      back.getUTCHours() !== h || back.getUTCMinutes() !== mi || back.getUTCSeconds() !== sec) return null
  const asCest = local - 2 * HOUR
  const cest = asCest >= lastSundayUtc(y, 2) && asCest < lastSundayUtc(y, 9)
  return local - (cest ? 2 : 1) * HOUR
}
