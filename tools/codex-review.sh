#!/usr/bin/env bash
# tools/codex-review.sh — bind a Codex adversarial review so it cannot drift.
#
# A REVIEW IS A SCARCE RESOURCE — the quota is small and shared across every
# branch. Spend one only where a second reader could plausibly find a defect you
# cannot: risky, intricate, uncertain work. ONE round is the budget; a second
# needs the operator's express go-ahead (CODEX_ROUND_APPROVED=1). --focus is
# required because a review nobody can aim is a review not worth running.
# Policy + how to decide: docs/ops/codex-review.md § When a review is worth one.
#
# Every precondition below exists because it was skipped in real reviews and cost
# a round: hand-rolled prompts rarely pinned a diff range, stated the spec as
# binding, froze the tree or forbade design alternatives. Rules that must be
# remembered get skipped; this script makes them impossible to skip.
# Vendored from the zradlo / pirati-praha-program repos; NVIDIA NIM backup removed.
#
#   tools/codex-review.sh --scope code --base <ref> --spec <file|none> --focus "<text>"
#   tools/codex-review.sh --scope spec|plan --target <file> --spec <file|none> --focus "<text>"
#
# Required:
#   --focus "<text>"   the uncertain, risky part this run must concentrate on.
#                      Not a wish list, and not "everything": if you cannot name
#                      what might be wrong, the change does not need a review.
# Options:
#   --settled <file>   findings already fixed or rejected, with reasons; the
#                      reviewer is told not to re-report them. This is what stops
#                      a loop from re-raising a settled point every round.
#   --round <n>        round number (default: auto-increment per out-dir). A
#                      second round in one out-dir refuses unless the operator
#                      approved it: CODEX_ROUND_APPROVED=1 as a command prefix.
#   --timeout <sec>    hard wall-clock cap (default 1800)
#   --out-dir <dir>    where prompt + output land (default under $TMPDIR)
#   --paths "<spec>"   space-separated git pathspec limiting the range (code scope).
#                      The reviewer is told the limit, so a narrowed range is a
#                      stated scope rather than a silent omission.
#   --dry-run          write the prompt and print its path, do not call the model
#
# Exit codes:
#   0 clear (verdict: 0 CRITICAL, 0 HIGH in-range) | 1 blocking findings remain
#   2 unbound/usage (no range, empty range, no --spec decision)
#   3 reviewer unavailable (codex CLI missing)
#   4 tree dirty at start (freeze failed)
#   5 tree moved mid-review — output INVALID | 6 no VERDICT trailer (truncated)
set -euo pipefail
export LC_ALL=C

die()   { echo "codex-review: $1" >&2; exit "${2:-2}"; }
usage() { sed -n '/^#   tools\/codex-review.sh --scope code/,/^# Exit codes:/p' "$0" | sed '$d' >&2; exit 2; }

SCOPE=""; BASE=""; TARGET=""; SPEC=""; FOCUS=""; SETTLED=""; ROUND=""; TIMEOUT=1800; OUTDIR=""; DRYRUN=0
PATHS=""

# A value-taking option at the end of the line would `shift 2` with one argument
# left, and set -e would exit 1 — reporting "blocking findings" for a typo.
need_val() { [ $# -ge 2 ] || die "$1 requires a value"; }
# GNU timeout treats 0 as "no limit", so an unvalidated --timeout 0 would silently
# remove the hard cap the option promises.
pos_int()  { case "$1" in ''|*[!0-9]*) return 1 ;; esac; [ "$1" -gt 0 ]; }
while [ $# -gt 0 ]; do
  case "$1" in
    --scope|--base|--target|--spec|--focus|--settled|--round|--timeout|--out-dir|--paths) need_val "$@" ;;
  esac
  case "$1" in
    --scope)    SCOPE="${2:-}";   shift 2 ;;
    --base)     BASE="${2:-}";    shift 2 ;;
    --target)   TARGET="${2:-}";  shift 2 ;;
    --spec)     SPEC="${2:-}";    shift 2 ;;
    --focus)    FOCUS="${2:-}";   shift 2 ;;
    --settled)  SETTLED="${2:-}"; shift 2 ;;
    --round)    ROUND="${2:-}";   shift 2 ;;
    --timeout)  TIMEOUT="${2:-}"; shift 2 ;;
    --out-dir)  OUTDIR="${2:-}";  shift 2 ;;
    --paths)    PATHS="${2:-}";   shift 2 ;;
    --dry-run)  DRYRUN=1;         shift ;;
    -h|--help)  usage ;;
    *) die "unknown argument: $1" ;;
  esac
done

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || die "not in a git repo" 2

cd "$ROOT"

# ── Bind 1: scope must be declared, and its target must be pinned ────────────
case "$SCOPE" in
  code) [ -n "$BASE" ]   || die "--scope code requires --base <ref>. An unpinned review picks its own scope and reports pre-existing debt as branch findings." ;;
  spec|plan) [ -n "$TARGET" ] || die "--scope $SCOPE requires --target <file>" ;;
  "")   die "--scope is required (code|spec|plan)" ;;
  *)    die "--scope must be one of: code, spec, plan" ;;
esac

# ── Bind 0: the review must be aimed, and worth aiming ───────────────────────
# The quota is scarce. An unaimed review spreads a scarce run evenly over
# boilerplate and real risk and comes back with nits. Naming the risk is also the
# honest test of whether the change needs a review at all: if nothing can be
# named, nothing was uncertain.
[ -n "$FOCUS" ] || die "--focus \"<text>\" is required: name the risky, uncertain part this run must concentrate on. If you cannot name one, the change does not earn a review — reviews are scarce (docs/ops/codex-review.md § When a review is worth one)."

# ── Bind 2: the binding-requirements decision must be explicit ───────────────
# A reviewer with no binding spec renegotiates product decisions the owner
# already made. --spec none is allowed, but only as a stated choice.
[ -n "$SPEC" ] || die "--spec <file|none> is required. Pass the file holding the owner's binding requirements, or --spec none to state on the record that there are none."
if [ "$SPEC" != "none" ]; then
  [ -f "$SPEC" ] || die "--spec file not found: $SPEC"
fi
[ "$SCOPE" = "code" ] || { [ -f "$TARGET" ] || die "--target file not found: $TARGET"; }
[ -z "$SETTLED" ] || [ -f "$SETTLED" ] || die "--settled file not found: $SETTLED"
pos_int "$TIMEOUT" || die "--timeout must be a positive whole number of seconds (got: $TIMEOUT)"
{ [ -z "$ROUND" ] || pos_int "$ROUND"; } || die "--round must be a positive whole number (got: $ROUND)"

# ── Bind 3: freeze the tree ─────────────────────────────────────────────────
# 2026-07-20: a review was derailed because tracked files changed underneath it;
# Codex spent the run reconciling instead of reporting. Tracked-only: untracked
# files are user-owned and are reported, not blocked on.
DIRTY="$(git status --porcelain --untracked-files=no)"
[ -z "$DIRTY" ] || { echo "codex-review: tracked files are modified — commit or stash before reviewing:" >&2
                     printf '%s\n' "$DIRTY" >&2; exit 4; }
UNTRACKED="$(git status --porcelain --untracked-files=normal | grep '^??' || true)"
HEAD_BEFORE="$(git rev-parse HEAD)"

# The spec, the review target, and the settled list are snapshotted into the
# prompt, so they must be frozen too — and an untracked, brand-new plan doc is
# invisible to the git checks above. Hash them directly.
#
# Each file is hashed separately so a path containing spaces is never word-split,
# and an unreadable file yields a DIFFERENT hash rather than a failure: under
# pipefail a failing sha256sum would kill the script at exit 1 ("blocking
# findings") before the movement check could stamp the run INVALID and exit 5.
# Deleting the review target mid-run is exactly a case that must reach exit 5.
inputs_hash() {
  { [ "$SPEC" = "none" ] || sha256sum -- "$SPEC" || echo "SPEC-UNREADABLE"
    [ -z "$TARGET" ]     || sha256sum -- "$TARGET" || echo "TARGET-UNREADABLE"
    [ -z "$SETTLED" ]    || sha256sum -- "$SETTLED" || echo "SETTLED-UNREADABLE"; } \
    2>/dev/null | sha256sum | cut -d' ' -f1
}
INPUTS_BEFORE="$(inputs_hash)"

# ── Bind 4: the range must be non-empty and enumerated ───────────────────────
if [ "$SCOPE" = "code" ]; then
  git rev-parse --verify --quiet "$BASE" >/dev/null || die "--base ref does not resolve: $BASE"
  MERGE_BASE="$(git merge-base "$BASE" HEAD)" || die "no merge-base between $BASE and HEAD"
  RANGE="$MERGE_BASE..$HEAD_BEFORE"
  if [ -n "$PATHS" ]; then
    # Split on whitespace into an array: `read -ra` neither glob-expands nor
    # re-splits, so a pattern like 'src/*.js' reaches git as a literal pathspec.
    # Consequence: a path containing a space is not supported.
    read -ra _pathspec <<<"$PATHS"
    DIFFSTAT="$(git diff --stat "$RANGE" -- "${_pathspec[@]}")"
    [ -n "$DIFFSTAT" ] || die "empty diff for $RANGE limited to: $PATHS"
    FILES="$(git diff --name-only "$RANGE" -- "${_pathspec[@]}")"
  else
    DIFFSTAT="$(git diff --stat "$RANGE")"
    [ -n "$DIFFSTAT" ] || die "empty diff for $RANGE — nothing to review"
    FILES="$(git diff --name-only "$RANGE")"
  fi
  NFILES="$(printf '%s\n' "$FILES" | grep -c . || true)"
else
  RANGE="(n/a — document review)"; DIFFSTAT=""; FILES="$TARGET"; NFILES=1
fi

# ── Output location ─────────────────────────────────────────────────────────
if [ -z "$OUTDIR" ]; then
  OUTDIR="${TMPDIR:-/tmp}/codex-review-$(basename "$ROOT")-$(git rev-parse --abbrev-ref HEAD | tr '/' '-')"
fi
mkdir -p "$OUTDIR"
# The default path is predictable, so refuse a directory that is a symlink or that
# someone else owns — otherwise a pre-planted symlink turns our writes into an
# overwrite of whatever it points at.
[ ! -L "$OUTDIR" ] && [ -d "$OUTDIR" ] && [ -O "$OUTDIR" ] \
  || die "output dir is a symlink or not owned by us: $OUTDIR" 4
chmod 700 "$OUTDIR" 2>/dev/null || true

# Claim the round atomically. Concurrent reviews in one out-dir would otherwise
# both see round N free and then race on the same three filenames.
# An explicit --round deliberately reuses its slot (that is what it is for, e.g.
# redoing round 3), so it is not claimed. Running the same explicit round twice
# at once races, and is user error rather than something to defend against.
AUTO_ROUND=0
if [ -z "$ROUND" ]; then
  AUTO_ROUND=1
  ROUND=1
  until (set -o noclobber; : > "$OUTDIR/codex-review-$SCOPE-r$ROUND.md") 2>/dev/null; do
    ROUND=$((ROUND + 1))
    [ "$ROUND" -le 99 ] || die "could not claim a round number in $OUTDIR"
  done
fi

# ── Bind 0 (cont.): one round is the budget ─────────────────────────────────
# A review that came back with a verdict is a spend. Fixing what it found is
# ordinary work; paying for a second opinion on the fix is another spend, and
# that is the operator's call, not the agent's. Counted from completed outputs in
# this out-dir FOR THIS SCOPE (a completed plan/spec pass must not block the later
# code pass: one pass on spec+plan and one on the diff are both in budget), so a --dry-run, a truncated run (exit 6) and a tree-moved run
# (exit 5) — none of which produced a usable review — do not consume the budget.
DONE_ROUNDS=0
for _prev in "$OUTDIR"/codex-review-"$SCOPE"-r*.md; do
  # The prompt files live here too and match the glob — and every one of them
  # quotes the VERDICT trailer verbatim, so an unfiltered count reads each
  # commissioned round as a completed one.
  case "$_prev" in *.prompt.md) continue ;; esac
  [ -f "$_prev" ] && [ -s "$_prev" ] || continue
  grep -q '^VERDICT:' "$_prev" || continue
  grep -q 'INVALID — the tree moved' "$_prev" && continue
  DONE_ROUNDS=$((DONE_ROUNDS + 1))
done
if [ "$DONE_ROUNDS" -gt 0 ] && [ "${CODEX_ROUND_APPROVED:-}" != "1" ]; then
  [ "$AUTO_ROUND" = "1" ] && rm -f -- "$OUTDIR/codex-review-$SCOPE-r$ROUND.md"
  echo "codex-review: $DONE_ROUNDS $SCOPE review(s) already completed in $OUTDIR." >&2
  echo "codex-review: one round is the budget — fix what it found and move on." >&2
  echo "codex-review: another round needs the operator's express go-ahead, then:" >&2
  echo "codex-review:   CODEX_ROUND_APPROVED=1 $0 ... --settled <file>" >&2
  die "second round not approved (docs/ops/codex-review.md § The loop, and when to stop)"
fi
PROMPT_FILE="$OUTDIR/codex-review-$SCOPE-r$ROUND.prompt.md"
OUT_FILE="$OUTDIR/codex-review-$SCOPE-r$ROUND.md"
LOG_FILE="$OUTDIR/codex-review-$SCOPE-r$ROUND.stream.log"
for _f in "$PROMPT_FILE" "$OUT_FILE" "$LOG_FILE"; do
  [ ! -L "$_f" ] || die "refusing to write through a symlink: $_f" 4
done

# ── The binding contract ────────────────────────────────────────────────────
{
  cat <<EOF
You are an ADVERSARIAL reviewer. Find defects. Do not praise, do not summarise
approvingly, do not propose redesigns.

## 1. Scope — BINDING, do not widen
Review scope: **$SCOPE**
Diff range:   $RANGE
Files in scope ($NFILES):
$(printf '%s\n' "$FILES" | sed 's/^/  - /')

Anything outside these files is OUT OF SCOPE. If you find a real defect outside
the range, you may report it, but you MUST label it PRE-EXISTING; it does not
count toward the blocking verdict and it is not this branch's job to fix.
EOF

  if [ -n "$DIFFSTAT" ]; then
    printf '\nDiff stat:\n%s\n' "$DIFFSTAT"
    if [ -n "$PATHS" ]; then
      printf '\nInspect the exact change with: git diff %s -- %s\n' "$RANGE" "$PATHS"
      printf 'The range is deliberately limited to those paths. Everything else in\n'
      printf 'this branch is out of scope for this round and is not your omission.\n'
    else
      printf '\nInspect the exact change with: git diff %s\n' "$RANGE"
    fi
  fi

  cat <<'EOF'

## 2. Your limits — state them, do not exceed them
You run in a READ-ONLY sandbox. You CANNOT run tests or the build.
Never write "verified by running" — you did not run anything. Every claim must
cite `path:line` from the actual file. If you cannot cite it, do not claim it.
Do not modify any file.

## 3. Severity — use exactly these
- CRITICAL — data loss, data corruption, auth bypass, or money computed wrong.
- HIGH     — incorrect behaviour on a realistic input; a race that can actually fire.
- MEDIUM   — wrong only on an unlikely path, or a real defect with a trivial blast radius.
- LOW      — style, naming, nits.
Only CRITICAL and HIGH that are IN-RANGE block the merge. Do not inflate severity
to make a point; do not report a preference as a defect.

## 4. Not your call
Do NOT propose design alternatives. Do NOT argue the specification. Do NOT
suggest a different architecture, library, or file layout. The design is settled;
your job is defects against it. A finding of the form "I would have done X
instead" is out of contract — drop it.
EOF

  if [ "$SPEC" != "none" ]; then
    cat <<EOF

## 5. Binding requirements — NOT OPEN TO RENEGOTIATION
The following is the owner's specification. It is a decision already made, not a
proposal. Judge the code against it. If you believe a requirement is itself
wrong, you may add ONE line under "NOTE TO OWNER:" immediately BEFORE the final
VERDICT line — but you may NOT report it as a defect, and you may NOT assume it
will change.

--- BEGIN BINDING SPEC ($SPEC) ---
$(cat -- "$SPEC")
--- END BINDING SPEC ---
EOF
  else
    cat <<'EOF'

## 5. Binding requirements
None supplied for this run. Therefore you may NOT infer intent and report
deviations from your own assumed design. Report only defects that are wrong on
their own terms: crashes, corruption, auth holes, incorrect arithmetic, races.
EOF
  fi

  [ "$SCOPE" = "code" ] || printf '\n## 6. Document under review\n\n%s\n\n--- BEGIN ---\n%s\n--- END ---\n' \
    "Verify EVERY factual claim it makes against the real code. A claim that does not match the code is a defect." "$(cat -- "$TARGET")"

  [ -z "$SETTLED" ] || cat <<EOF

## Already settled — do NOT re-report
Each entry below was examined in an earlier round and either fixed or rejected
with a stated reason. Re-raising one is out of contract and does not count toward
the verdict. If you are convinced one is still live, add a single line under
"DISPUTED:" immediately BEFORE the final VERDICT line, and leave it out of the
counts.

--- BEGIN SETTLED ($SETTLED) ---
$(cat -- "$SETTLED")
--- END SETTLED ---
EOF

  cat <<EOF

## Where the risk is — spend the run here
$FOCUS

This is why the review was commissioned, and it is the only reason the run is
being paid for. Read the whole range for context, but concentrate your effort
above. Do NOT pad the report with boilerplate, formatting, naming, import order,
or mechanical edits: nits against a diff whose real risk is named here are a
failed review, not a thorough one. Finding nothing in the named area is a
legitimate result — say so and stop.
EOF

  cat <<'EOF'

## Required output format
For each finding, in descending severity:

  ### [SEVERITY] <one-line title>
  SCOPE: in-range | PRE-EXISTING
  WHERE: path:line
  WHY IT IS WRONG: <the defect, and the input/state that triggers it>
  EVIDENCE: <the code, quoted>

End your response with EXACTLY this trailer, on its own line, nothing after it
(any NOTE TO OWNER / DISPUTED line goes immediately above it, never below):

VERDICT: <n> CRITICAL, <n> HIGH

counting IN-RANGE findings only. If you found nothing blocking, the line is
`VERDICT: 0 CRITICAL, 0 HIGH`. The trailer is parsed by a script — emit it
verbatim or the run is treated as truncated.
EOF
} > "$PROMPT_FILE"

echo "codex-review: scope=$SCOPE round=$ROUND range=$RANGE files=$NFILES"
echo "codex-review: prompt -> $PROMPT_FILE"
[ -z "$UNTRACKED" ] || { echo "codex-review: NOTE untracked files present (not reviewed, left alone):" >&2
                         printf '%s\n' "$UNTRACKED" >&2; }

if [ "$DRYRUN" = "1" ]; then
  echo "codex-review: --dry-run, not invoking the reviewer"; exit 0
fi

command -v codex >/dev/null 2>&1 || die "codex CLI not found on PATH" 3

# ── Canonical invocation — one form, always ─────────────────────────────────
# --output-last-message isolates the FINAL answer. Codex streams its reasoning to
# stdout, and that stream quotes the required trailer verbatim; parsing the stream
# would let a mid-thought "VERDICT: 0 CRITICAL, 0 HIGH" read as the real one.
# Clear first: with an explicit --round, a prior run's result is sitting there,
# and an invocation that dies before Codex writes would otherwise be parsed as if
# it were this run's output.
: > "$OUT_FILE"; : > "$LOG_FILE"
# Model override. ~/.codex/config.toml pins one model globally, but which models
# are available depends on the ACCOUNT codex is logged into — a ChatGPT-account
# login rejects some with a 400 ("model is not supported when using Codex with a
# ChatGPT account") before doing any work. Without a per-run override the whole
# harness is unusable on such an account. Affects WHO reviews, never WHAT is
# bound: range, freeze, spec and verdict parsing are untouched.
# Resolved by tools/lib/codex-model.sh: CODEX_REVIEW_MODEL wins, else the newest model of
# the CODEX_MODEL_LINE (default sol) this account can use, else config.toml.
# shellcheck source=tools/lib/codex-model.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/codex-model.sh"
_model_args=()
_resolved_model="$(codex_resolve_model "${CODEX_REVIEW_MODEL:-}" codex-review)"
[ -n "$_resolved_model" ] && _model_args=(-m "$_resolved_model")

set +e
timeout "$TIMEOUT" codex exec \
  --sandbox read-only \
  -C "$ROOT" \
  ${_model_args[@]+"${_model_args[@]}"} \
  -c "model_reasoning_effort=${CODEX_REASONING_EFFORT:-medium}" \
  --output-last-message "$OUT_FILE" \
  - < "$PROMPT_FILE" > "$LOG_FILE" 2>&1
RC=$?
set -e
if [ "$RC" -eq 124 ]; then echo "codex-review: TIMED OUT after ${TIMEOUT}s — output is partial" >&2
elif [ "$RC" -ne 0 ]; then echo "codex-review: codex exited $RC — see $LOG_FILE" >&2; fi
[ -s "$OUT_FILE" ] || { echo "codex-review: Codex produced no final message (rc=$RC). Stream: $LOG_FILE" >&2; exit 6; }

# ── Bind 3 (cont.): did the tree move under the review? ─────────────────────
# HEAD is read on both sides of the status call: a commit landing between the two
# would otherwise leave a stale-but-matching HEAD next to an already-clean status,
# and the review of a tree that moved would pass.
HEAD_AFTER="$(git rev-parse HEAD)"
DIRTY_AFTER="$(git status --porcelain --untracked-files=no)"
HEAD_AFTER2="$(git rev-parse HEAD)"
INPUTS_AFTER="$(inputs_hash)"
if [ "$HEAD_AFTER" != "$HEAD_BEFORE" ] || [ "$HEAD_AFTER2" != "$HEAD_BEFORE" ] \
   || [ -n "$DIRTY_AFTER" ] || [ "$INPUTS_AFTER" != "$INPUTS_BEFORE" ]; then
  {
    echo
    echo "=============================================================="
    echo "INVALID — the tree moved while Codex was reviewing it."
    echo "  HEAD before: $HEAD_BEFORE"
    echo "  HEAD after:  $HEAD_AFTER"
    [ "$INPUTS_AFTER" = "$INPUTS_BEFORE" ] || echo "  spec/target file(s) changed mid-review"
    [ -z "$DIRTY_AFTER" ] || { echo "  dirty after:"; printf '%s\n' "$DIRTY_AFTER" | sed 's/^/    /'; }
    echo "This review reflects a tree that no longer exists. DISCARD it and"
    echo "re-run against a stable commit. Do not act on these findings."
    echo "=============================================================="
  } >> "$OUT_FILE"
  echo "codex-review: INVALID — tree moved mid-review (see $OUT_FILE)" >&2
  exit 5
fi

# ── Verdict contract ────────────────────────────────────────────────────────
# The trailer must BE the last non-empty line and must end there — a verdict with
# content after it means the response was truncated mid-thought or went off-contract.
# `|| true`: an all-whitespace file makes grep exit 1, and under pipefail that
# would kill the script at exit 1 ("blocking findings") instead of reaching the
# exit-6 branch below where a contentless run belongs.
VERDICT="$(grep -v '^[[:space:]]*$' "$OUT_FILE" | tail -1 || true)"
if ! printf '%s' "$VERDICT" | grep -qE '^VERDICT:[[:space:]]*[0-9]+[[:space:]]+CRITICAL,[[:space:]]*[0-9]+[[:space:]]+HIGH[[:space:]]*$'; then
  echo "codex-review: no VERDICT trailer as the final line of $OUT_FILE — run truncated, timed out, or off-contract." >&2
  echo "codex-review: last line was: ${VERDICT:0:120}" >&2
  echo "codex-review: do NOT treat this as a clean review. Re-run." >&2
  exit 6
fi
NCRIT="$(printf '%s' "$VERDICT" | sed -E 's/^VERDICT:[[:space:]]*([0-9]+).*/\1/')"
NHIGH="$(printf '%s' "$VERDICT" | sed -E 's/.*,[[:space:]]*([0-9]+)[[:space:]]+HIGH.*/\1/')"
NPRE="$(grep -c '^[[:space:]]*SCOPE:[[:space:]]*PRE-EXISTING' "$OUT_FILE" || true)"

# Reconcile the declared trailer against the findings actually listed: a report
# that details an in-range HIGH and then trails "0 CRITICAL, 0 HIGH" would
# otherwise exit 0. Each finding heading is paired with its own SCOPE line, and
# the larger of declared/counted wins — disagreement fails closed.
# Leading whitespace is allowed on both patterns: the output template in this very
# script indents its example headings, so a reviewer mirroring it exactly would
# otherwise be counted as reporting nothing.
COUNTED="$(awk '
  /^[[:space:]]*#+[[:space:]]*\[(CRITICAL|HIGH)\]/ { pending = ($0 ~ /\[CRITICAL\]/) ? "C" : "H"; next }
  pending != "" && /^[[:space:]]*SCOPE:/ {
    if ($0 !~ /PRE-EXISTING/) { if (pending == "C") c++; else h++ }
    pending = ""
  }
  END { printf "%d %d", c+0, h+0 }' "$OUT_FILE")"
CCRIT="${COUNTED%% *}"; CHIGH="${COUNTED##* }"
if [ "$CCRIT" -ne "$NCRIT" ] || [ "$CHIGH" -ne "$NHIGH" ]; then
  echo "codex-review: verdict/findings MISMATCH — trailer says ${NCRIT}C/${NHIGH}H, listed in-range findings are ${CCRIT}C/${CHIGH}H." >&2
  echo "codex-review: taking the higher count. Read $OUT_FILE yourself before trusting either." >&2
  [ "$CCRIT" -le "$NCRIT" ] || NCRIT="$CCRIT"
  [ "$CHIGH" -le "$NHIGH" ] || NHIGH="$CHIGH"
fi

echo "codex-review: output -> $OUT_FILE"
echo "codex-review: $VERDICT  (pre-existing, non-blocking: $NPRE)"
if [ "$NCRIT" -eq 0 ] && [ "$NHIGH" -eq 0 ]; then
  echo "codex-review: CLEAR to proceed for this round."
  exit 0
fi
echo "codex-review: BLOCKING findings remain — triage per docs/ops/codex-review.md before fixing." >&2
exit 1
