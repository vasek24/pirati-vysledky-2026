// Změny mezi dvěma po sobě jdoucími snapshoty jednoho zastupitelstva: co se
// pohnulo (okrsky, hlasy, mandáty, pořadí stran, zvolení kandidáti), aby se to
// dalo na pár sekund zvýraznit a jednou oznámit čtečce. Čisté funkce.
// Nikdy nehlásí změnu při prvním načtení (prev == null), u jiného
// zastupitelstva, při poklesu sečtených okrsků (reset dat ČSÚ) ani když se
// změnil jen čas (generated / fetchedAt) — bez pohybu čísel není co ukazovat.
import { computeOutcome } from '../volby/compute.js'
import { fmtInt, fmtPct, plural } from '../volby/format.js'

const num = (v) => (Number.isFinite(v) ? v : 0)
const isSnapshot = (s) => !!s && typeof s === 'object' && Array.isArray(s.parties)

function unchanged() {
    return { changed: false, precincts: { delta: 0, counted: 0, total: 0 }, parties: new Map(), councilors: new Set(), councilorMoves: new Map() }
}

// Podpis číselného obsahu: když se nezměnil, není co porovnávat (každý
// úspěšný dotaz totiž vrací nový objekt snapshotu, i když se nic nepohnulo)
export function changeSignature(s) {
    if (!isSnapshot(s)) return ''
    const votes = s.parties.map((p) => num(p?.votes)).join(',')
    return `${s.zastup ?? ''}|${s.generated ?? ''}|${num(s.precincts?.counted)}|${s.official ? 1 : 0}|${votes}`
}

function validParties(s) {
    return s.parties.filter((p) => p && typeof p === 'object' && Number.isFinite(p.id))
}

// Pořadí stran podle hlasů (stejně jako model.js: hlasy sestupně, pak id)
function ranks(parties, ids) {
    const sorted = parties.filter((p) => ids.has(p.id)).sort((a, b) => num(b.votes) - num(a.votes) || a.id - b.id)
    return new Map(sorted.map((p, i) => [p.id, i + 1]))
}

function outcomeOf(s) {
    try {
        return computeOutcome(s, { seats: s.seats })
    } catch {
        return { seatsById: {}, councilors: {} }
    }
}

function diff(prev, next) {
    if (!isSnapshot(prev) || !isSnapshot(next)) return unchanged()
    if (prev.zastup !== undefined && next.zastup !== undefined && prev.zastup !== next.zastup) return unchanged()
    const before = num(prev.precincts?.counted)
    const after = num(next.precincts?.counted)
    if (after < before) return unchanged()

    const out = unchanged()
    out.precincts = { delta: after - before, counted: after, total: num(next.precincts?.total) }

    const pp = validParties(prev)
    const np = validParties(next)
    const prevById = new Map(pp.map((p) => [p.id, p]))
    const common = new Set(np.filter((p) => prevById.has(p.id)).map((p) => p.id))
    const prevRank = ranks(pp, common)
    const nextRank = ranks(np, common)
    const prevOut = outcomeOf(prev)
    const nextOut = outcomeOf(next)
    const prevTotal = pp.reduce((s, p) => s + num(p.votes), 0)
    const nextTotal = np.reduce((s, p) => s + num(p.votes), 0)

    for (const p of np) {
        const old = prevById.get(p.id)
        if (!old) continue
        const votesDelta = num(p.votes) - num(old.votes)
        const seats = num(nextOut.seatsById?.[p.id])
        const seatsDelta = seats - num(prevOut.seatsById?.[p.id])
        const rankDelta = (prevRank.get(p.id) ?? 0) - (nextRank.get(p.id) ?? 0)
        if (!votesDelta && !seatsDelta && !rankDelta) continue
        const share = nextTotal ? (num(p.votes) / nextTotal) * 100 : 0
        const oldShare = prevTotal ? (num(old.votes) / prevTotal) * 100 : 0
        out.parties.set(p.id, { votesDelta, seatsDelta, rankDelta, votes: num(p.votes), seats, share, shareDelta: prevTotal ? share - oldShare : null })
    }

    // Kandidáti: jen ti, kdo mají nebo měli mandát (jinak by se u velkých
    // kandidátek zvýrazňovala pořadí na dně při každé aktualizaci)
    for (const [pid, nextList] of Object.entries(nextOut.councilors || {})) {
        const prevList = new Map((prevOut.councilors?.[pid]?.ranked || []).map((c) => [c.n, c]))
        for (const c of nextList.ranked || []) {
            const old = prevList.get(c.n)
            if (!old) continue
            const seatDelta = Number(!!c.seat) - Number(!!old.seat)
            const orderDelta = (c.seat || old.seat) ? num(old.order) - num(c.order) : 0
            if (!seatDelta && !orderDelta) continue
            const key = `${pid}-${c.n}`
            out.councilors.add(key)
            out.councilorMoves.set(key, { seatDelta, orderDelta })
        }
    }

    out.changed = out.precincts.delta !== 0 || out.parties.size > 0 || out.councilors.size > 0
    return out
}

export function diffSnapshots(prev, next) {
    try {
        return diff(prev, next)
    } catch {
        return unchanged()
    }
}

const signed = (n) => `${n > 0 ? '+' : '−'}${Math.abs(n)}`
const arrow = (n) => (n > 0 ? '▲' : '▼')

// „▲ +1 místo" (jen změna mandátů)
export function seatsCueText(entry) {
    if (!entry?.seatsDelta) return ''
    return `${arrow(entry.seatsDelta)} ${signed(entry.seatsDelta)} ${plural(Math.abs(entry.seatsDelta), 'místo', 'místa', 'míst')}`
}

// Krátký text k řádku strany: „▲ +123 · ▲ +1 místo · pořadí ↑2"
export function partyCueText(entry) {
    if (!entry) return ''
    const parts = []
    if (entry.votesDelta) parts.push(`${arrow(entry.votesDelta)} ${entry.votesDelta > 0 ? '+' : '−'}${fmtInt(Math.abs(entry.votesDelta))}`)
    if (entry.seatsDelta) parts.push(seatsCueText(entry))
    if (entry.rankDelta) parts.push(`pořadí ${entry.rankDelta > 0 ? '↑' : '↓'}${Math.abs(entry.rankDelta)}`)
    return parts.join(' · ')
}

export function candidateCueText(move) {
    if (!move) return ''
    if (move.seatDelta > 0) return '▲ mandát'
    if (move.seatDelta < 0) return '▼ bez mandátu'
    if (move.orderDelta) return `pořadí ${move.orderDelta > 0 ? '↑' : '↓'}${Math.abs(move.orderDelta)}`
    return ''
}

// Jediná věta pro čtečku obrazovky (aria-live): „Aktualizace: sečteno 31 z 43
// okrsků (+2); Piráti 14,2 % (+0,3 p. b.)". Bez změny prázdný řetězec.
export function summarize(d, { oursId, nameOf } = {}) {
    if (!d?.changed) return ''
    const parts = []
    if (d.precincts?.delta) {
        parts.push(`sečteno ${d.precincts.counted} z ${d.precincts.total} okrsků (${signed(d.precincts.delta)})`)
    }
    const ours = oursId !== undefined && oursId !== null ? d.parties?.get(oursId) : null
    if (ours) {
        const name = (typeof nameOf === 'function' && nameOf(oursId)) || 'Naše kandidátka'
        // první hlasy po prázdném stavu: změna oproti nule nic neříká
        let text = `${name} ${fmtPct(ours.share)}`
        if (ours.shareDelta !== null) {
            const pp = Math.round(ours.shareDelta * 10) / 10
            text += ` (${pp === 0 ? '±0,0' : `${pp > 0 ? '+' : '−'}${fmtPct(Math.abs(pp)).replace(' %', '')}`} p. b.)`
        }
        if (ours.seatsDelta) text += `, mandáty ${ours.seats} (${signed(ours.seatsDelta)})`
        parts.push(text)
    }
    return `Aktualizace: ${parts.length ? parts.join('; ') : 'výsledky se změnily'}`
}
