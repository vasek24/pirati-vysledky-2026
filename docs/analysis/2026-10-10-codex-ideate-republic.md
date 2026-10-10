<!-- codex-ideate run metadata -->
RESULT: RECOMMEND
DATE: 2026-10-10T09:12:22Z
ROUND: 1
DECISION: Should we build the whole-republic Pirate tracker at all, and if so which minimal architecture and phasing (single Worker with path routes vs split Workers; okres-aggregate ingestion; scope per product) gives the best robustness-to-effort for 10,000 visitors without endangering the Prague mirror?
PROBLEM: /tmp/claude-1000/-home-vislousv-SyncThing-70-AI-pirati-elec-tracker/be641ad0-4684-42cb-a25a-58b434828fad/scratchpad/codex-republic-problem.md (bba053119d52)
HEAD-BEFORE: 4e69564daae4157fb4b8df55a1d535af68889846
HEAD-AFTER: 4e69564daae4157fb4b8df55a1d535af68889846

## What exists today

Limits: read-only inspection only. I ran no project code, tests, migrations, builds, or side-effecting commands.

The repository is a Prague-specific application: its registry contains the Magistrát plus 57 districts, assigns every council to okres `1100`, and performs lookups only within that registry (`src/councils.js:18-27`, `src/councils.js:243-264`). The client router recognizes only configured council slugs, while the Worker serves SPA routes matching `/praha` and `/praha-*` (`src/main.jsx:13-21`, `cloudflare/worker.js:31`, `cloudflare/worker.js:323-331`).

The production Worker already implements the reusable reliability core: deterministic per-feed Durable Objects, persisted last-good snapshots, background single-flight refresh, validation/quarantine, edge caching, and a separate last-resort cache (`cloudflare/worker.js:88-131`, `cloudflare/refresh.js:128-210`, `cloudflare/refresh.js:224-299`, `cloudflare/worker.js:183-208`). Twelve feeds are cron-warmed; other councils refresh on demand (`cloudflare/feedClasses.js:1-21`, `cloudflare/worker.js:334-340`).

The current overview still fetches one result file per council with bounded concurrency and partial-result retention (`src/volby/overview.js:94-145`). Feed dispatch supports only `council` and `overview`; there is no Senate feed branch (`cloudflare/feedWiring.js:33-46`). Its validators likewise understand only council and overview snapshots (`src/volby/validate.js:99-112`, `src/volby/validate.js:184-194`).

Political classification is partly generated from list-composition codes, but coalition context and Pirate candidates on other lists are manually configured (`src/councils.js:90-107`, `scripts/build-data.js:151-161`, `scripts/build-data.js:271-305`). The data build processes councils serially without a per-council error boundary, and a thrown build error terminates the run (`scripts/build-data.js:85-90`, `scripts/build-data.js:437-440`).

A deployment rebuilds the SPA and deploys the same Worker, so extending that deployment is not operationally isolated from Prague (`cloudflare/package.json:6-8`). Staging does have separate Worker, DO, KV, and analytics resources (`cloudflare/wrangler.jsonc:32-53`).

## Eliminated

- Extend the existing production Worker during this count — any code or asset deployment shares Prague’s release boundary, violating the Prague-stability constraint.
- Poll every town and big-city district separately — the supplied origin-load estimate creates avoidable risk to the same ČSÚ service used by Prague.
- Immediate feature parity across all three products — maps, candidates, coalition attribution, municipal projections, and Senate projections create correctness obligations the available time and existing Prague-only models cannot satisfy.
- One global national Durable Object — it turns independent okres feeds into one ingestion and recovery failure domain.

## Approaches considered

### status-quo — Keep only the Prague mirror

MECHANISM: Freeze deployments and operate the existing Prague Worker without a republic product.

COST: Almost no new engineering; all national demand goes unanswered.

FORECLOSES: Any useful national artifact for this election and collection of production evidence for the next one.

WRONG IF: A reviewed national overview has durable value beyond tonight and can be built without touching Prague.

### static-snapshot — Publish reviewed results after counting

MECHANISM: Generate a separate static republic overview from final ČSÚ data, manually approve every Pirate/endorsed mapping, and serve it from an isolated Worker route. No polling, estimates, or runtime aggregation.

COST: Small runtime surface but substantial human review. It becomes an archive, not a live tracker.

FORECLOSES: Live election-night value and meaningful validation of the future ingestion architecture.

WRONG IF: The product’s value depends mainly on live progress rather than a reliable final overview.

### single-national-worker — Isolate Prague, combine both new products

MECHANISM: Leave Prague untouched. One new Worker serves the splitter, municipal overview, town pages, and Senate pages through path routes. Municipal data uses one last-good DO per okres aggregate plus an overview DO; Senate uses a separate round-keyed DO reading the nationwide feed. Edge caches shield both APIs.

COST: The supplied estimates imply roughly 43–72 developer-days plus political review. One deployment, runbook, and observability surface, but municipal and Senate releases remain coupled.

FORECLOSES: Independent rollback and incident containment between two unrelated election systems.

WRONG IF: Municipal and Senate code can genuinely share a release cadence and failure domain without increasing correctness risk.

### split-product-workers — Defer live launch and isolate all three products

MECHANISM: Keep the Prague Worker unchanged. Add a municipal Worker and a Senate Worker on direct path routes; use no router Worker. The municipal Worker also serves the static splitter. Its ingestion unit is one DO per okres aggregate, with a cached overview assembled from last-good okres snapshots. The Senate Worker keeps one strictly validated nationwide snapshot per election round and derives constituency pages from it. The browser obtains the two headline blocks independently, so either national product can fail stale without taking down the other or Prague.

Scope is deliberately asymmetric:

- Prague: unchanged.
- Municipalities: only the manually approved target councils; overview and list-level town drill-down; no maps, coalition claims, or candidate detail. Show mandates only when official. Enable estimates later only after legal review and full-country historical replay.
- Senate: only the 18 manually approved candidate relationships; votes, reporting progress, and official advancement/election status. No projected winners. Treat a runoff as a new round and schema, not an automatic continuation.
- Main indicator: official seats and verified places won. Omit “estimated” totals until their separate correctness gates pass.

COST: The same core feature effort as `single-national-worker`, plus two configurations, deployments, dashboards, and runbooks. Shared libraries reduce code duplication; operations remain more involved.

FORECLOSES: A single-command deployment of the entire republic product and server-side construction of one atomic cross-product snapshot.

WRONG IF: The national product will remain static, or maintaining two additional release units costs more than independent rollback and fault containment are worth.

## Recommendation

CHOSEN: split-product-workers

WHY: Build the republic product, but not live during the current municipal count or the following runoff. Tonight, choose the effective behavior of `status-quo`: freeze Prague. After counting, publish a reviewed static snapshot as the first deliverable. Build the live architecture for the next scheduled count.

This beats `status-quo` because it retains long-term national value without accepting tonight’s risk. It beats `static-snapshot` because the snapshot becomes a controlled first phase rather than the terminal architecture. It beats `single-national-worker` because municipal and Senate ingestion, validation, UI semantics, and release timing are materially different; a second new Worker is cheap insurance compared with the stated development effort and reputational cost. Ten thousand visitors do not justify splitting for throughput; independent deployment, rollback, storage, and bug containment do.

Use okres aggregates, not town polling. Reuse the existing refresher/cache/last-good concepts, but implement separate municipal and Senate adapters and validators rather than extending the current council/overview switch. Route directly to the three product Workers so no front-door router becomes a fourth runtime dependency.

KILL CRITERIA: Abandon live municipal ingestion for static-only if sampled okres aggregates omit target councils, identifiers, reporting progress, or official mandates; require frequent town-level fallbacks; or cannot be reconciled deterministically with town JSON. Abandon live Senate scope if the runoff schema or official advancement flags cannot be validated from captured fixtures. Abandon the entire republic product if human reviewers cannot approve every Pirate coalition and endorsement mapping before publication.

CHEAPEST TEST: The owner should capture fixtures for one ordinary okres, Brno, Ostrava, Plzeň, the nationwide Senate feed, and several constituency feeds. Produce a hand-reviewed manifest of expected councils, Pirate-containing lists, candidates, progress, and official outcomes; then reconcile aggregate output against the corresponding town/constituency files. This single spike tests the risky assumption—semantic completeness and attribution—not edge capacity. Do it outside the Prague repository and deploy nothing to its Worker.

WHERE I AM GUESSING: The okres XML contains stable identifiers and enough fields for the proposed list-level municipal scope; the Senate runoff will have a safely distinguishable schema; reviewers are available for all target mappings; and the national product retains enough post-election or future-election value to justify roughly 43–72 developer-days.

IDEATE: RECOMMEND split-product-workers