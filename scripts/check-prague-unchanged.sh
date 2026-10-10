#!/usr/bin/env bash
# Guard M1 (spec §3.1): Prague se větví `mesta/*` nezměnil.
#   scripts/check-prague-unchanged.sh [base]     (výchozí: merge-base HEAD origin/main)
# 1. Allow-list: `git diff --name-only <base> HEAD` smí obsahovat jen cesty mesta.
# 2. Bajty: z `git archive` exportu base i HEAD se vyříznou cesty mesta (Tailwind 4
#    skenuje KAŽDÝ soubor repa, takže jinak by commit s dokumentací změnil CSS Prahy),
#    postaví se Praha (`vite build` + `wrangler deploy --dry-run`) a porovnají se
#    sha256 seznamy dist/ a výstupu workeru. Strana base se cachuje v
#    .cache/prague-base-<sha>-<klíč>.sha256; při prvním běhu (bez cache) se build
#    i dry-run navíc opakují na jednom stromu — musí dát stejné hashe (determinismus).
# Výstup: `PRAGUE UNCHANGED` (exit 0) | rozdíly + `PRAGUE CHANGED` (exit 1) |
# nedeterministický build (exit 2) | chyba buildu/uživatele (exit 3+).
# Nic nenasazuje, nic nepushuje; wrangler běží jen s --dry-run.
#
# Testovací háčky (env; používá jen scripts/check-prague-unchanged.test.js):
#   GUARD_ALLOW_REGEX, GUARD_INSTALL_CMD, GUARD_BUILD_CMD, GUARD_WORKER_CMD ($WORKER_OUT),
#   GUARD_SKIP_WORKER=1 (jen dist; výsledek je označený PARTIAL), GUARD_REFRESH=1 (ignoruj cache).
set -euo pipefail

GUARD_VERSION=1

ALLOW_REGEX=${GUARD_ALLOW_REGEX:-'^(src/mesta/|public-mesta/|docs/|scripts/|tools/|placeholder/|cloudflare/mesta-worker\.js$|cloudflare/mestaWiring(\.test)?\.js$|cloudflare/mestaWorker\.drift\.test\.js$|cloudflare/wrangler\.mesta\.jsonc$|vite\.mesta\.config\.js$|\.github/workflows/mesta\.yml$|[^/]*\.md$)'}
# Cesty vyříznuté z obou exportů (= allow-list) + každý *.md mimo src/
STRIP=(src/mesta public-mesta docs scripts tools placeholder
  cloudflare/mesta-worker.js cloudflare/mestaWiring.js cloudflare/mestaWiring.test.js
  cloudflare/mestaWorker.drift.test.js cloudflare/wrangler.mesta.jsonc
  vite.mesta.config.js .github/workflows/mesta.yml)

INSTALL_CMD=${GUARD_INSTALL_CMD:-'npm ci --no-audit --no-fund'}
BUILD_CMD=${GUARD_BUILD_CMD:-'npx vite build && cp cloudflare/_headers dist/_headers'}
WORKER_CMD=${GUARD_WORKER_CMD:-'(cd cloudflare && npm ci --no-audit --no-fund) && (cd cloudflare && WRANGLER_SEND_METRICS=false npx wrangler deploy --dry-run --outdir "$WORKER_OUT")'}
SKIP_WORKER=${GUARD_SKIP_WORKER:-0}

die() { echo "check-prague-unchanged: $*" >&2; exit "${2:-3}"; }

cd "$(git rev-parse --show-toplevel)"
repo=$PWD

base_arg=${1:-}
if [[ -z $base_arg ]]; then
  base_arg=$(git merge-base HEAD origin/main) || die "no merge-base with origin/main (fetch it, or pass a base)"
fi
base=$(git rev-parse --verify --quiet "${base_arg}^{commit}") || die "unknown base: $base_arg"
head=$(git rev-parse HEAD)
git merge-base --is-ancestor "$base" "$head" || echo "warning: base $base is not an ancestor of HEAD; the diff includes the other side's changes too" >&2
[[ -z $(git status --porcelain --untracked-files=no) ]] || echo "warning: uncommitted changes are not covered (the guard checks committed HEAD only)" >&2

# --- 1. allow-list --------------------------------------------------------
bad=$(git diff --name-only --no-renames "$base" "$head" | grep -Ev -- "$ALLOW_REGEX" || true)
if [[ -n $bad ]]; then
  echo "FORBIDDEN: these changed paths are outside the mesta allow-list (base ${base:0:10}..HEAD):" >&2
  echo "$bad" | sed 's/^/  /' >&2
  exit 1
fi
echo "allow-list ok: $(git diff --name-only --no-renames "$base" "$head" | wc -l | tr -d ' ') changed path(s), all mesta-only"

# --- 2. byte comparison ---------------------------------------------------
tmp=$(mktemp -d "${TMPDIR:-/tmp}/prague-guard.XXXXXX")
cleanup() { if [[ -n ${tmp:-} && -d $tmp ]]; then rm -rf -- "$tmp"; fi; }
trap cleanup EXIT
work=$tmp/work # jedna cesta pro obě strany: cesty ve výstupech (sourcemapy) se nesmí lišit

hash_dir() { (cd "$1" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum); }

step() { # step <label> <cmd>   (běží v $work; log do $tmp, na chybě poslední řádky)
  local label=$1 cmd=$2 t0=$SECONDS log
  log=$tmp/log-${label// /_}.txt
  if ! (cd "$work" && eval "$cmd") >"$log" 2>&1; then
    echo "FAILED: $label (last lines of its log):" >&2
    tail -n 25 "$log" >&2
    exit 3
  fi
  echo "[timing] $label $((SECONDS - t0))s"
}

build_side() { # build_side <rev> <name> <record-file> <determinism 0|1>
  local rev=$1 name=$2 record=$3 det=$4
  rm -rf "$work" && mkdir -p "$work"
  git archive "$rev" | tar -x -C "$work"
  (cd "$work" && rm -rf -- "${STRIP[@]}" && find . -name '*.md' -not -path './src/*' -not -path './node_modules/*' -delete)
  step "$name install" "$INSTALL_CMD"
  step "$name build" "$BUILD_CMD"
  hash_dir "$work/dist" >"$tmp/$name.dist"
  if [[ $SKIP_WORKER != 1 ]]; then
    export WORKER_OUT=$tmp/worker-$name
    step "$name worker dry-run" "$WORKER_CMD"
    hash_dir "$WORKER_OUT" >"$tmp/$name.worker"
  fi
  if [[ $det == 1 ]]; then
    step "$name build (determinism re-run)" "$BUILD_CMD"
    hash_dir "$work/dist" >"$tmp/$name.dist2"
    if ! diff -u "$tmp/$name.dist" "$tmp/$name.dist2" >"$tmp/det.diff"; then
      cat "$tmp/det.diff" >&2
      die "Prague build is not deterministic (same tree, two builds, different dist/) — the guard cannot be trusted" 2
    fi
    if [[ $SKIP_WORKER != 1 ]]; then
      export WORKER_OUT=$tmp/worker-$name-2
      step "$name worker dry-run (determinism re-run)" "$WORKER_CMD"
      hash_dir "$WORKER_OUT" >"$tmp/$name.worker2"
      if ! diff -u "$tmp/$name.worker" "$tmp/$name.worker2" >"$tmp/det.diff"; then
        cat "$tmp/det.diff" >&2
        die "wrangler dry-run output is not deterministic (same tree, two runs) — the guard cannot be trusted" 2
      fi
    fi
    if [[ $SKIP_WORKER == 1 ]]; then echo "determinism ok for dist/ (worker not checked)"; else echo "determinism ok (dist/ and worker output identical on a second run)"; fi
  fi
  { sed 's/^/dist /' "$tmp/$name.dist"; if [[ $SKIP_WORKER != 1 ]]; then sed 's/^/worker /' "$tmp/$name.worker"; fi; } >"$record"
}

keyhash=$(printf '%s' "$GUARD_VERSION|${STRIP[*]}|$INSTALL_CMD|$BUILD_CMD|$WORKER_CMD|$SKIP_WORKER" | sha256sum | cut -c1-8)
cache=$repo/.cache/prague-base-$base-$keyhash.sha256
if [[ -s $cache && ${GUARD_REFRESH:-0} != 1 ]]; then
  echo "base ${base:0:10}: cached ($cache)"
  cp "$cache" "$tmp/base.rec"
else
  build_side "$base" base "$tmp/base.rec" 1
  mkdir -p "$repo/.cache"
  cp "$tmp/base.rec" "$cache.tmp.$$" && mv "$cache.tmp.$$" "$cache"
fi
build_side "$head" head "$tmp/head.rec" 0

if diff -u "$tmp/base.rec" "$tmp/head.rec" >"$tmp/final.diff"; then
  if [[ $SKIP_WORKER == 1 ]]; then
    echo "PRAGUE UNCHANGED (PARTIAL: dist/ only — the wrangler dry-run was skipped, so the worker bundle is NOT verified)"
  else
    echo "PRAGUE UNCHANGED"
  fi
else
  cat "$tmp/final.diff"
  echo "PRAGUE CHANGED: the stripped Prague build differs between ${base:0:10} and HEAD" >&2
  exit 1
fi
