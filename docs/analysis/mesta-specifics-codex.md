# Codex review of the Města specifics (spec §6.2)

Run 2026-10-10 via tools/codex-review.sh, model gpt-5.6-sol, one pass, read-only. Range 889d50f..59e114b (before the T1b symmetric-jmsez fix).

LIMITS: Read-only sandbox; tests and builds were not run. No files were modified.

### [HIGH] jmsez mismatch detection ignores Pirate members missing from jmsez
SCOPE: in-range  
WHERE: scripts/mesta/reports.js:34; scripts/mesta-registry.js:226  
WHY IT IS WRONG: The cross-check only detects Pirate-labelled jmsez positions absent from `members ∪ others`. The reverse discrepancy is ignored. If the registry classifies a candidate as a Pirate member but jmsez omits that label, the function returns false, so `jmsez-mismatch` is not added and the town remains high-confidence instead of being hidden. Source disagreement is a realistic input explicitly handled by this confidence gate.  
EVIDENCE: `return jmsezPirates(jmsez).some((r) => !have.has(\`${r.list}:${r.n}\`));` only iterates jmsez rows. The resulting boolean exclusively controls `jmsez-mismatch`: `jmsezMismatch(...) ? [...s.flags, 'jmsez-mismatch'] : s.flags`.

VERDICT: 0 CRITICAL, 1 HIGH
## Triage
- HIGH jmsez one-directional: confirmed real as a gap; fixed in 8ac441a (symmetric check). Regenerated: no town changes (jmsez-mismatch none for all 81), data byte-identical. Verdict after fix: PASS (no blockers; data unchanged).
