# Codex wrappers (`tools/codex-review.sh`, `tools/codex-ideate.sh`)

Codex je u nás **omezený a drahý zdroj**: používá se jen přes tyto skripty, nikdy ručně
sestaveným promptem. Skripty jsou převzaté z repozitářů `zradlo` a `pirati-praha-program`
(model-resolution z commitu `a3ec3db8`, volba `--paths` z `pirati-praha-program`);
záložní reviewer NVIDIA NIM byl odstraněn. Pipeline: Haiku prozkoumá, Sonnet implementuje,
Opus kontroluje adverzárně, Codex jen jako vázaný druhý čtenář.

## When a review is worth one
Review se vyplatí jen tam, kde druhý čtenář může najít vadu, kterou ty nenajdeš: riziková,
spletitá nebo nejistá práce (sdílený stav, časování, cache, nasazení). Pravidla:

1. **Jedno kolo na spec + plán**, **jedno kolo na celý diff**. Žádné „pro jistotu".
2. Další kolo jen s výslovným ano od operátora (`CODEX_ROUND_APPROVED=1` jako prefix příkazu).
3. `--focus` je povinný: pojmenuj rizikovou část. Nelze-li ji pojmenovat, review není potřeba.
4. Opravy nálezů jsou běžná práce, ne důvod ke druhému kolu.

## The loop, and when to stop
Review -> oprava nálezů CRITICAL/HIGH -> zapsat do `docs/superpowers/reviews/` -> hotovo.
Pokud operátor schválí další kolo, předej už vyřízené nálezy přes `--settled <soubor>`
(opraveno / zamítnuto s důvodem), jinak je reviewer znovu nahlásí. Skript sám odmítne druhé
dokončené kolo ve stejném `--out-dir`, dokud není `CODEX_ROUND_APPROVED=1`.

## Model (known gotcha)
Výchozí model v `~/.codex/config.toml` (`gpt-6-luna`) **odmítá náš ChatGPT login**
(HTTP 400 „model is not supported when using Codex with a ChatGPT account") dřív, než Codex
cokoli udělá. `tools/lib/codex-model.sh` proto při každém běhu vybere nejnovější model řady
`CODEX_MODEL_LINE` (výchozí `sol`) z katalogu, který hlásí `codex debug models`
(jen `visibility=list` a `supported_in_api`), s fallbackem na `~/.codex/models_cache.json`.
`~/.codex/config.toml` se nikdy neupravuje. Pořadí:

1. `CODEX_REVIEW_MODEL` / `CODEX_IDEATE_MODEL` (explicitní, vyhrává vždy),
2. nejnovější model řady `CODEX_MODEL_LINE`,
3. nic -> Codex použije `config.toml` (a pravděpodobně selže, viz výše).

Pokud automaticky vybraný model selže, vynuť jiný, např. nejsilnější z cache:
`CODEX_REVIEW_MODEL=gpt-5.6-sol tools/codex-review.sh ...`. Hloubku úvahy řídí
`CODEX_REASONING_EFFORT` (výchozí `medium`).

## Command lines (this repo)
Vždy z čistého stromu (tracked soubory commitnuté); skript zmrazí strom a po běhu ověří,
že se nepohnul.

```sh
# review spec + plánu (jedno kolo)
CODEX_REVIEW_MODEL=gpt-5.6-sol tools/codex-review.sh --scope plan \
  --target docs/superpowers/plans/<plan>.md \
  --spec docs/superpowers/specs/<spec>.md \
  --focus "<riziková část>"

# review celého diffu větve (jedno kolo); --paths zúží rozsah
CODEX_REVIEW_MODEL=gpt-5.6-sol tools/codex-review.sh --scope code --base main \
  --spec docs/superpowers/specs/<spec>.md \
  --focus "<riziková část>" [--paths "cloudflare src"]

# bez závazné specifikace: --spec none (výslovné rozhodnutí)
# jen vygenerovat prompt, model nevolat:
tools/codex-review.sh --scope code --base main --spec none --focus "x" --dry-run

# ideace: vrací rozhodnutí, ne přehled (problem.md musí mít "## Constraints" s odrážkou)
CODEX_IDEATE_MODEL=gpt-5.6-sol tools/codex-ideate.sh --problem problem.md \
  --decision "<jedno rozhodnutí v jedné větě>" [--spec <soubor>] [--settled <soubor>]
```
Další volby: `--settled`, `--round`, `--timeout <s>` (výchozí 1800), `--out-dir`. Výstup a prompt
končí v `$TMPDIR/codex-review-<repo>-<větev>/`.

## Exit codes
`codex-review.sh`: `0` čisto (0 CRITICAL, 0 HIGH v rozsahu) | `1` zbývají blokující nálezy |
`2` chybné/nenavázané zadání (rozsah, `--spec`, `--focus`, druhé kolo bez schválení) |
`3` reviewer nedostupný (chybí `codex`) | `4` špinavý strom nebo nebezpečný out-dir |
`5` strom se pohnul během běhu (výstup je INVALID, zahodit) | `6` chybí řádek `VERDICT:`
(zkráceno / timeout; nebrat jako čisté).

`codex-ideate.sh`: `0` RECOMMEND (spotřebuje kolo) | `1` INSUFFICIENT (nespotřebuje) |
`2` zadání | `3` selhal provider (chybí CLI, timeout, prázdná odpověď) | `4` nebezpečný out-dir |
`5` vstupy se změnily, INVALID | `6` odpověď porušila kontrakt.

Každý review končí řádkem `VERDICT: <n> CRITICAL, <n> HIGH`; skript ho porovná s vypsanými
nálezy a při rozporu vezme vyšší počet.

## Recording reviews
Po běhu zkopíruj výstup (`codex-review-<scope>-r<n>.md` z out-dir) do
`docs/superpowers/reviews/<YYYY-MM-DD>-codex-<scope>-review-r<n>.md` a commitni zvlášť.
Ke každému CRITICAL/HIGH nálezu připiš do commit message nebo souboru `*-settled.md`, zda byl
opraven, nebo zamítnut a proč. Ideace: `<YYYY-MM-DD>-codex-ideate-<téma>.md`. Historické
soubory v `docs/superpowers/reviews/` se nepřepisují.

## Testy
`tools/__tests__/codex-model.test.js` (součást `npm test`) testuje výběr modelu pomocí falešného
`codex` v `PATH`; Codex k tomu nemusí být nainstalovaný. Skripty ověř `bash -n tools/*.sh`
(a `shellcheck`, je-li k dispozici).
