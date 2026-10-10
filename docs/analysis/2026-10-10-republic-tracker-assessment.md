# Whole-republic Pirate tracker — risk/reward assessment

Date: 2026-10-10 · Final, after challenge by an Opus advisor (corrections folded in) · Inputs: Haiku research (ČSÚ feeds, Cloudflare limits/isolation, existing-code effort), Codex ideation (`2026-10-10-codex-ideate-republic.md`), measured load test of the Prague mirror.
Question: three products behind a splitter (Prague / ~90 other towns / Senate) with national headline indicators ("estimated" seats), assume ~10,000 visitors; do separate Workers help; is it wise?

## 1. Verdict
**Do not build a live republic tracker. Do not touch the Prague mirror's production path for it.** The infrastructure can be made to carry it; that is not the problem. The problems are mandate, correctness of attribution, estimates, and the effort-to-value ratio. The cheapest defensible thing is a **static, official-final-results summary**, not a live product.

## 2. Direct answers
**Can it take 10,000 visitors?** Yes. 10k visitors ≈ 30–170 requests/s at the edge (clients poll once per refresh cycle plus a random 0–25 s offset). Our staging test: ~230 req/s equivalent, 99.6–99.8 % cache hits, p95 46–63 ms, one upstream refresh per feed. Cloudflare Workers Paid has no per-second request cap; DO limits are per object; ~200 feeds = 200 cheap Durable Objects. Caveats: (a) every API request still invokes the Worker even on a cache HIT (≈0.6 M invocations/evening, cheap on Paid; **would break on the Free plan's 100k/day at ~1,500 visitors** — the account is on Paid); (b) the load test was one machine/one colo, three endpoints, pre-count — it proves edge caching, not a 200-key fan-out or ČSÚ latency under load.

**Do separate Workers help?** They give **release isolation, not load isolation.** Separate scripts isolate deploys, rollbacks, bugs, DO storage/schemas and ownership. They do not isolate the real failure points: the single government origin (volby.gov.cz), our shared Cloudflare egress IPs, the shared User-Agent (the code uses an upstream-branded UA — if ČSÚ throttles it, the original site, the mirror and any new product fail together; any new fetcher needs its own UA with a contact), account quotas, the zone's DNS/WAF/DDoS settings. So *if* you build it, put new products in their own Worker scripts so a bug or deploy cannot hurt Prague — **on a separate subdomain** (not path routes on volby.dg12.cz: that hostname is a Custom Domain bound to the Prague Worker; `/` and `/api/*` are Prague's). No router Worker. Do it for blast radius, not throughput.

**Is the whole-republic idea wise?** Not now. Reasons in §4.

## 3. What we know
CONFIRMED today: per-town JSON works for Brno/Ostrava/Plzeň with the same path families as Prague (okres + zastup codes; ETag, `Expires = +60 s`, 304); big cities also have separate district-council feeds (Brno 29, Ostrava 23, Plzeň 10). One XML per okres returns all its municipalities (Brno okres 50 KB, 30 councils) at 60 s, party-level totals (candidate-level votes likely only in per-town JSON — unverified until counting starts). Senate: nationwide + per-constituency JSON/XML exist under `volby.gov.cz/appdata/senat/20261009/…` (27 constituencies), 60 s; no runoff data published yet. No ČSÚ rate-limit guidance; shared egress. Naive per-town polling ≈ 420 req/min; okres aggregates ≈ 40–60/min as a best case (up to ~230/min if every okres hits the 20 s floor). Prague code is hard-wired (okres 1100, `/praha*`, 12 first-class keys, Magistrát-centric Landing, hand-typed council/coalition details); build pipeline aborts on one missing town and mishandles multi-district towns; the overview builds from one fetch per council (58 now; at 150–200 the limit is wall time and snapshot consistency — a national total would add up councils from different minutes — not subrequests). Seat allocation = D'Hondt + one 5 % clause (legal check for municipal coalitions needed). Senate: almost nothing reusable but feed/DO/cache infrastructure.
INFERRED/UNVERIFIED: effort estimates (unmeasured), okres XML completeness, Senate runoff schema, JSON shape once counting starts, ČSÚ candidate-register fields for 2026 (see §5 H), ČSÚ's reuse licence (CC BY 4.0 is *not* confirmed).

## 4. Risks (ranked)
1. **(Resolved by the owner, 2026-10-10)** Mandate/licence/brand: the owner is a senior party official and states everything is above board. Not a gating risk; no sign-off step. (Only residual point: a republic page with seat numbers reads as party communication, so numbers must be right — see 2 and 3.)
2. **Wrong political attribution** (which lists/coalitions/candidates are "Pirates" in ~90 towns; "Pirate" = member vs nominee). Reputational harm. Needs a human-approved manifest per town/constituency, or ČSÚ's own affiliation fields.
3. **Estimates.** National sums of D'Hondt projections across towns at different counting progress are misleading; once screenshotted they become misinformation pinned on the party. Senate round 1 rarely elects anyone outright, so "estimated Senate seats" is a runoff prediction. Coalition thresholds and preferential votes also decide who sits. **No national estimates in this product — not "later after a replay test".**
4. **Moratorium/legal (uncertain, check with a lawyer):** Czech election law restricts publishing polls in the days before voting and until polls close; the ban applies again before the Senate runoff; a projection from round-1 results may fall in a grey zone. Avoid Senate projections entirely.
5. **Value vs effort.** Code-exploration estimates (unmeasured): other towns 15–25 days, Senate 20–35, overview 8–12, ≈43–72 total plus human review. The Senate share is disproportionate: of the 18 Pirate-linked races likely 0–3 reach a runoff. Audience attention is mostly within ~24 h of the election; next municipal elections are 2030, next Senate 2028 (alongside regional elections). Live "for the next count" has little reuse.
6. **Endangering Prague.** It is not yet proven on real counted data; any shared deploy boundary is a risk (option F below).
7. **One-person on-call.** Every extra Worker adds alerts/runbook; Prague tonight plus a runoff on workdays.
8. **Upstream fan-in** on ČSÚ (shared UA/IPs, no guidance) — okres aggregates, conditional GETs, jitter, last-good snapshots, kill switch, own UA with contact.
9. Smaller: SEO/confusion with the author's tracker; mobile weight (no national maps); accessibility (colour not the only cue); keep "Zdroj: ČSÚ" and verify ČSÚ's terms.

## 5. Options
| Option | Idea | Risk to Prague | Verdict |
|---|---|---|---|
| A. Nothing | Prague mirror only | none | fine tonight |
| B. Capture | read-only local recorder of ČSÚ feeds | none | low value (final data stays published); only as a local 5-minute script with its own UA, never at the cost of on-call |
| G. Link-out | one static page linking Prague tracker + volby.gov.cz for other towns/Senate | none | **near-zero cost; do if you want a "whole country" entry point** |
| H. Static national summary | script run locally from ČSÚ's candidate-register/affiliation open data (historically per candidate: nominating party, party membership, elected/mandate flag after results — *unverified for 2026, check*), official FINAL results only, uploaded as static assets on its own subdomain; no DOs, no cron, no estimates | none | **the one product I'd defend: "Pirate councillors elected nationwide vs 2022" with ČSÚ's own attribution, 1–2 days with this method (5–10 with hand manifests), after sign-off** |
| E. Live split Workers | towns Worker + Senate Worker + splitter | low | **drop as a target**: wrong time, low reuse; revisit only for a future cycle, as a separate project |
| F. Extend the Prague Worker | add towns/Senate to the live Worker | **high** | no |
| D. Live single new Worker | splitter + towns + Senate in one script | low | worse than E |

## 6. Recommended path
- **Tonight:** Prague only; I watch the live results, compare with the original site, fix issues. No new products.
- **Sun–Mon:** check ČSÚ's candidate-register fields; compute Pirate councillors by membership and by nomination (2026 vs 2022) and the Senate table from final official data (H).
- **Tue:** party-side review of the definitions (who counts as a Pirate: member vs nominee; coalition lists) — a correctness review, not a permission step.
- **Wed–Thu:** generate the static page on a separate subdomain, labelled "official final results", with timestamp and ČSÚ attribution. One regeneration after the Senate runoff (statutory one week after round 1; ČSÚ runoff data paths not yet published).
- **Kill criteria:** ČSÚ affiliation data unusable and hand attribution can't be reviewed in time; legal doubt about publishing; any need to touch the Prague Worker.
- Reject Codex's "build live architecture for the next count" for now (agree with its "freeze Prague tonight", "okres aggregates", "no estimates at first", "split Workers if ever live").
