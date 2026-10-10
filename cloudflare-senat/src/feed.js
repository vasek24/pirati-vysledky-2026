// Upstream feed for the Senate Worker: one conditional GET of odata/vysledky.xml,
// XML -> normalise -> derive (spec §2). The feed holds no validators itself:
// the refresher passes the good snapshot's validators (or none) on every build.
import { parseResultsXml } from './xml.js'
import { normalize } from './normalize.js'
import { derive } from './derive.js'

export const USER_AGENT = 'pirati-senat-zaloha/0.1 (backup mirror; maintainer Vaclav Vislous +420777954389; manages this fork)'
export const REQUEST_TIMEOUT_MS = 8000

export function createSenatFeed({
  baseUrl, fetchImpl = fetch, userAgent = USER_AGENT, manifest, now, pollsCloseR1, pollsCloseR2,
}) {
  const url = `${baseUrl}/odata/vysledky.xml`
  let fetchId = 0 // HTTP 200 responses seen by this instance (never the ETag)

  // 8 s per request, combined with the caller's signal
  async function request(signal, headers) {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(new Error(`timeout ${REQUEST_TIMEOUT_MS} ms`)), REQUEST_TIMEOUT_MS)
    const onAbort = () => ac.abort(signal.reason)
    if (signal) {
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
    try {
      const res = await fetchImpl(url, { headers, signal: ac.signal })
      const text = res.status === 200 ? await res.text() : null
      return { res, text }
    } catch (error) {
      throw new Error(`upstream request failed: ${error?.message || error}`)
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }

  return {
    async build({ signal, validators } = {}) {
      const headers = { 'User-Agent': userAgent, Accept: 'application/xml' }
      if (validators?.etag) headers['If-None-Match'] = validators.etag
      if (validators?.lastModified) headers['If-Modified-Since'] = validators.lastModified

      const { res, text } = await request(signal, headers)
      if (res.status === 304) return { notModified: true }
      if (res.status !== 200) throw new Error(`upstream HTTP ${res.status}`)
      const id = ++fetchId

      let snapshot
      try {
        snapshot = derive(normalize(parseResultsXml(text), { manifest, now: now(), pollsCloseR1, pollsCloseR2 }))
      } catch (error) {
        throw new Error(`upstream XML unusable: ${error?.message || error}`)
      }
      return {
        snapshot,
        validators: { etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified') },
        fetchId: id,
      }
    },

    // The validators live with the good snapshot (refresher), so there is nothing to
    // clear here; the refresher's next fetch after a non-ok outcome is unconditional.
    invalidate() {},
  }
}
