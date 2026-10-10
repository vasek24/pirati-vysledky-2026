#!/usr/bin/env bash
# Příkazy produktu „mesta“ (mesta.dg12.cz) — package.json se nemění, vše jde sem.
#   bash scripts/mesta.sh build            vite build (vite.mesta.config.js) + kontrola buildu + _headers
#   bash scripts/mesta.sh data [args]      node scripts/build-data.js --product=mesta
#   bash scripts/mesta.sh registry [args]  node scripts/mesta-registry.js
#   bash scripts/mesta.sh check-prague [base]   scripts/check-prague-unchanged.sh
#   bash scripts/mesta.sh deploy-staging   build + záznam nasazení + wrangler deploy --env staging
#   bash scripts/mesta.sh deploy-prod      totéž s prázdným --env= (produkce, workers.dev + cron)
# Špinavý strom: deploy ho odmítne, pokud není MESTA_ALLOW_DIRTY=1.
# Nasazuje se JEN odsud, JEN z větve mesta/main. Nikdy ručně `wrangler deploy`
# v cloudflare/ na větvi mesta/* — výchozí konfigurace tam je konfigurace Prahy.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

die() { echo "mesta.sh: $*" >&2; exit "${2:-1}"; }
usage() { echo "usage: bash scripts/mesta.sh {build|data|registry|check-prague|deploy-staging|deploy-prod} [args]" >&2; exit 2; }

build() {
  npx vite build -c vite.mesta.config.js
  node scripts/mesta-build-check.mjs
  node scripts/mesta-data-check.mjs
  cp cloudflare/_headers .cache/dist-mesta/_headers
}

deploy() { # deploy <staging|prod>
  local target=$1 branch envflag=() stamp
  branch=$(git rev-parse --abbrev-ref HEAD)
  [[ $branch == mesta/main ]] || die "deploy only from branch mesta/main (current: $branch)"
  [[ -z $(git status --porcelain) || ${MESTA_ALLOW_DIRTY:-0} == 1 ]] \
    || die "uncommitted changes in the working tree — commit them (or set MESTA_ALLOW_DIRTY=1)"
  # prod: prázdné --env= (jinak wrangler varuje „multiple environments“ a zvolí top-level)
  if [[ $target == staging ]]; then envflag=(--env staging); else envflag=(--env=); fi

  build
  grep -q '"name": "pirati-mesta"' cloudflare/wrangler.mesta.jsonc \
    || die "cloudflare/wrangler.mesta.jsonc is not the pirati-mesta config — refusing to deploy"

  # Předchozí verze (pro rollback: npx wrangler rollback <id> -c wrangler.mesta.jsonc)
  mkdir -p .cache
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  export WRANGLER_SEND_METRICS=false
  if ! (cd cloudflare && npx wrangler deployments list -c wrangler.mesta.jsonc "${envflag[@]}") 2>&1 | tee ".cache/mesta-deployments-$stamp-$target.txt"; then
    echo "mesta.sh: no previous deployment recorded (first deploy, or wrangler could not list them)" >&2
  fi
  (cd cloudflare && npx wrangler deploy -c wrangler.mesta.jsonc "${envflag[@]}")
}

cmd=${1:-}
[[ -n $cmd ]] || usage
shift
case $cmd in
  build) build ;;
  data) node scripts/build-data.js --product=mesta "$@" ;;
  registry) node scripts/mesta-registry.js "$@" ;;
  check-prague) bash scripts/check-prague-unchanged.sh "$@" ;;
  deploy-staging) deploy staging ;;
  deploy-prod) deploy prod ;;
  *) usage ;;
esac
