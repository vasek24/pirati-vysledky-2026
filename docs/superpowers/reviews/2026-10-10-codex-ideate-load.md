<!-- codex-ideate run metadata -->
RESULT: RECOMMEND
DATE: 2026-10-10T07:21:23Z
ROUND: 2
DECISION: Which ordered, minimal set of changes makes this app survive election-night load, with no client ever hitting ČSÚ directly, and show council-level updates as soon as ČSÚ publishes them, buildable before 14:00 today?
PROBLEM: /tmp/claude-1000/-home-vislousv-SyncThing-70-AI-pirati-elec-tracker/be641ad0-4684-42cb-a25a-58b434828fad/scratchpad/codex-load-problem.md (5acd5b3a1094)
HEAD-BEFORE: 98d6bc669f5760b72a13e8d5c644c96ea413b6c8
HEAD-AFTER: 98d6bc669f5760b72a13e8d5c644c96ea413b6c8

## What exists today

The browser normally requests `/api/volby` or `/api/prehled`, but it also constructs browser-side ČSÚ feeds and switches to them immediately on an initial proxy failure or after two later failures (`src/hooks/useLiveResults.js:35-65`, `src/hooks/useLiveResults.js:230-254`).

Successful counting polls use a 60-second interval with ±15% jitter, while error backoff has no jitter and online events retry immediately (`src/hooks/useLiveResults.js:23-27`, `src/hooks/useLiveResults.js:150-155`, `src/hooks/useLiveResults.js:345-352`). The browser abandons proxy requests after 15 seconds, although the overview builder may wait 20 seconds (`src/hooks/useLiveResults.js:27`, `src/volby/overview.js:101-105`).

The Worker normalizes feed URLs, checks its per-colo Cache API, and routes misses to one named Durable Object per normalized feed (`cloudflare/worker.js:121-149`). Only successful responses are cached, with the counting TTL derived as 30 seconds (`api/_http.js:8-13`, `cloudflare/worker.js:158-172`).

The feed already coalesces concurrent refreshes and can return a last-good snapshot after failure, but both the coalescing promise and last snapshot exist only in process memory (`src/volby/feed.js:244-245`, `src/volby/feed.js:321-334`). The Durable Object currently invokes the existing handlers without persisting result state (`cloudflare/worker.js:83-86`).

Any successful upstream JSON response is installed in the file cache before semantic validation, while missing result fields normalize to zeros or empty collections (`src/volby/feed.js:54-95`, `src/volby/feed.js:197-213`). Precinct correction retries are already capped at five, so that safeguard should not be reimplemented (`src/volby/feed.js:241-264`).

A detected deployment version currently forces visible tabs to reload after 2.5 seconds, retrying every five seconds until they are not editing (`src/components/UpdateManager.jsx:83-114`). The Worker is already configured with a SQLite-backed `Feed` Durable Object, so storing snapshot records does not require adding another database binding (`cloudflare/wrangler.jsonc:19-22`).

## Eliminated

- Browser or CDN-only failover to ČSÚ — violates the absolute prohibition on client-origin traffic and loses global refresh coordination because the Cache API is per-colo.
- Supabase Postgres/Realtime — requires a new database integration under a no-migration deadline. It does not improve ČSÚ ingestion; it adds another dependency and failure boundary.
- SSE/WebSocket push — materially reduces delivery delay, but changing connection lifecycle, reconnect behavior, fan-out, and deployment handling cannot reasonably be built and reviewed before 14:00.
- One global Durable Object for every council — concentrates all reads and refresh work in one bottleneck, conflicting with the load-survival priority.

## Approaches considered

### status-quo — Hybrid proxy caching with browser-side origin failover

MECHANISM: Browsers poll the Worker, per-colo cache misses converge on feed-specific Durable Objects, and browsers construct their own ČSÚ feed when the proxy fails (`src/hooks/useLiveResults.js:230-254`, `cloudflare/worker.js:135-172`).

COST: No build work, but proxy incidents turn viewer concurrency into ČSÚ concurrency, and deployment loses the feed’s in-memory last-good state (`src/volby/feed.js:244-245`, `src/volby/feed.js:321-334`).

FORECLOSES: An enforceable backend-only data boundary and dependable stale service through Worker restarts or deployments.

WRONG IF: No browser may contact ČSÚ directly. That condition is settled, so this cannot be selected.

### demand-coalesced-do — Backend-only pull-through refresh with a durable last-good snapshot

MECHANISM: Every browser calls only the Worker. Each existing feed-specific Durable Object owns a persisted snapshot, `nextRefreshAt`, and one in-flight refresh promise. The first request after the source becomes due performs one conditional refresh; concurrent requests join it. A candidate snapshot is validated and persisted before publication, while failures return the persisted last-good response as stale. A short edge TTL absorbs reads without becoming the refresh authority.

COST: Small, localized changes to the existing browser hook, Durable Object wrapper, response caching, snapshot validation, and election-night reload policy. Workers Paid is required; the repository already documents that the 58-source overview exceeds Free’s 50-subrequest ceiling (`cloudflare/README.md:42-47`).

FORECLOSES: Truly push-based delivery. A feed with no readers is not refreshed until its next request, although it retains its persisted snapshot.

WRONG IF: A priority feed can receive no request for longer than 60 seconds during counting yet must still be refreshed proactively.

### scheduled-do-publisher — Durable Object alarms publish snapshots independently of readers

MECHANISM: Each active feed Durable Object schedules a minute alarm, conditionally reads ČSÚ, validates and persists a snapshot, and reschedules itself. HTTP requests only read the published record and never initiate upstream work.

COST: Adds alarm initialization, recovery, rescheduling, final-state shutdown, and observability to a class that currently exposes only request-driven feed and bug methods (`cloudflare/worker.js:83-103`). It can reuse the existing SQLite Durable Object binding (`cloudflare/wrangler.jsonc:19-22`).

FORECLOSES: Cheap inactivity; activated council feeds continue polling until explicitly stopped. It also creates another lifecycle that must be correct during a same-day emergency deploy.

WRONG IF: Election-night demand already guarantees a request in every refresh window, making alarms extra implementation and review risk without improving hot-feed freshness.

## Recommendation

CHOSEN: demand-coalesced-do

WHY: It preserves the repository’s existing per-feed coordination and edge-cache topology while removing the dangerous browser failover. It beats `status-quo` by making the backend the sole ČSÚ caller and persisting the last-good response. It beats `scheduled-do-publisher` because continuous election-night demand supplies the refresh trigger without adding an alarm lifecycle before today’s deadline.

Implement this ordered minimal set:

1. Remove both browser-side `direct` feed constructors and every `goDirect` branch. On API failure, retain the session-cached snapshot and retry only the Worker with full jitter; add a small random delay to online and visibility retries, which currently can run immediately (`src/hooks/useLiveResults.js:35-65`, `src/hooks/useLiveResults.js:230-254`, `src/hooks/useLiveResults.js:345-352`).

2. Make the existing named Durable Object the only refresh authority. Store `{response, refreshedAt, nextRefreshAt, etag}` in Durable Object storage; use one `refreshPromise`; allow at most one upstream refresh per feed per 60-second window; and persist a validated response before replacing memory. On timeout, invalid JSON, invalid structure, or upstream failure, return the stored snapshot with `stale: true`, never a browser escape hatch. This replaces the current memory-only protection (`src/volby/feed.js:321-334`, `cloudflare/worker.js:83-86`).

3. Reject structurally empty or regressive successful responses before publication. At minimum validate version, council identity, finite precinct totals, `0 <= counted <= total`, required collections, nondecreasing generation time, and preservation of previously nonempty party data. The existing cache otherwise accepts every successful JSON body (`src/volby/feed.js:197-213`).

4. Separate origin cadence from delivery cadence. Refresh ČSÚ no more than once per 60 seconds, but use a five-second Cache API TTL during waiting/counting. Return `nextRefreshAt`; have tabs make one backend request per minute at a stable per-tab offset spread across roughly 30 seconds after that boundary. This removes stacked random cache delays without increasing each tab’s normal request rate above the existing minute cadence (`src/hooks/useLiveResults.js:23-27`, `api/_http.js:8-13`).

5. Make one final pre-14:00 deployment, warm `/api/prehled`, Magistrát, and Praha 9, then disable automatic election-night reloads in the new bundle and show a manual update button instead. The current forced reload would synchronize open tabs after a mid-count deployment (`src/components/UpdateManager.jsx:83-114`). Do not add Supabase.

KILL CRITERIA: Abandon this choice for `scheduled-do-publisher` if staging shows that either priority endpoint can go a full refresh window without a request, or that the first due request plus refresh cannot publish within the acceptable delivery window. Abandon the five-second edge TTL if Durable Object request latency or cost rises materially under the boundary burst.

CHEAPEST TEST: The owner should deploy a staging Worker with one temporary structured log around upstream refresh. Warm the three priority endpoints, then issue a concurrent burst at a refresh boundary. Confirm exactly one refresh per feed window, identical snapshot/ETag delivery to all callers, zero browser requests to `volby.gov.cz`, and continued HTTP 200 stale delivery when the upstream fetch is deliberately failed.

WHERE I AM GUESSING: Priority feeds will receive continuous election-night demand; a roughly 30-second client spread after backend refresh is acceptable; and the proposed monotonicity rules match ČSÚ correction behavior. If legitimate ČSÚ corrections can reduce counted totals or generation timestamps, validation needs a narrowly documented exception.

IDEATE: RECOMMEND demand-coalesced-do