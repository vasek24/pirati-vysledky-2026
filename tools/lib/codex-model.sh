# tools/lib/codex-model.sh — sourced by tools/codex-review.sh and tools/codex-ideate.sh.
#
# Which model a Codex run uses, so nobody pins a slug by hand again. ~/.codex/config.toml
# can name a model the logged-in ChatGPT account refuses (HTTP 400 before any work), and a
# hand-typed CODEX_*_MODEL goes stale the day a new generation ships. This resolves the
# NEWEST model of one line (default "sol": gpt-5.6-sol -> gpt-6.1-sol -> ...) from the
# catalog the CLI itself reports for THIS account, so availability is checked every run.
#
#   codex_resolve_model <explicit-override> <tag>
#     prints the model slug on stdout (nothing printed = leave codex to its own config)
#     explains itself on stderr, prefixed with <tag>
#
# Precedence: explicit override (CODEX_REVIEW_MODEL / CODEX_IDEATE_MODEL) > newest of the
# line > nothing (codex falls back to config.toml). The line is CODEX_MODEL_LINE
# (sol | terra | luna | ...). A model qualifies only when the catalog marks it
# visibility=list and supported_in_api=true. Never fatal: a resolver failure must not block
# a review someone is waiting on.
codex_resolve_model() {
  local override="${1:-}" tag="${2:-codex}" line="${CODEX_MODEL_LINE:-sol}" json picked
  if [ -n "$override" ]; then printf '%s' "$override"; return 0; fi
  command -v python3 >/dev/null 2>&1 || { echo "$tag: python3 missing, model left to config.toml" >&2; return 0; }
  # Live catalog first (refreshes the cache); the cached copy if the live call fails.
  json="$(timeout 30 codex debug models 2>/dev/null || true)"
  if ! printf '%s' "$json" | python3 -c 'import json,sys; json.load(sys.stdin)' >/dev/null 2>&1; then
    json="$(cat "${CODEX_HOME:-$HOME/.codex}/models_cache.json" 2>/dev/null || true)"
  fi
  picked="$(printf '%s' "$json" | LINE="$line" python3 -c '
import json, os, re, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
ms = d.get("models", []) if isinstance(d, dict) else d
pat = re.compile(r"^gpt-(\d+(?:\.\d+)*)-" + re.escape(os.environ["LINE"]) + r"$")
best = None
for m in ms:
    mt = pat.match(str(m.get("slug", "")))
    if not mt or m.get("visibility") != "list" or not m.get("supported_in_api"):
        continue
    v = tuple(int(x) for x in mt.group(1).split("."))
    if best is None or v > best[0]:
        best = (v, m["slug"])
if best:
    print(best[1])
' 2>/dev/null || true)"
  if [ -n "$picked" ]; then
    echo "$tag: model=$picked (newest of the '$line' line available to this account)" >&2
    printf '%s' "$picked"
  else
    echo "$tag: no '$line' model found in the Codex catalog — leaving the model to ~/.codex/config.toml" >&2
  fi
  return 0
}
