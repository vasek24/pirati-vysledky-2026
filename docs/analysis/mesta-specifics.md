# Přehled měst a kandidatur Pirátů (review tabulka „města“)

## Co to je

Tato tabulka ukazuje, **která města se na webu „města“ zveřejní** a **jak v nich Piráti kandidují**. Vznikla automaticky z otevřených dat ČSÚ (registr kandidátů pro komunální volby 2026), ne z ruky. Cílem je, abyste ji za pár minut prošel(a) a rozhodl(a) u sporných měst. Co v tabulce nesedí, opravíte v souboru `src/mesta/overrides.js` (návod níže), nikoli v tomto dokumentu.

## Jak číst sloupce

- **kraj, město** – kraj a název; **KODZASTUP / OKRES / VSTRANA / SLOZENI** (sloupec „zdroj“) jsou kódy z registru ČSÚ, podle kterých lze vše dohledat.
- **inclusion** – proč je město zařazeno: `auto` = má ≥ 10 000 obyvatel a Piráti kandidují (typ a/b); `hraniční, zařazeno` = 7 000–9 999 obyvatel a máme důvod (viz **borderline_reason**); `vyřazeno` = nezveřejněno.
- **borderline_reason** – u malých (hraničních) měst důvod, proč je přesto zařazeno (např. „na seznamu majitele“, „Piráti 2022: 11,7 %, 2 mand.“, „sídlo okresu“).
- **obyvatel (2026 / 2025)** – počet obyvatel z registru voleb 2026 (rozhoduje o zařazení) a z tabulky ČSÚ k 1. 1. 2025 (jen kontrola pásma).
- **typ** – **a** = Piráti mají vlastní kandidátku; **b** = Piráti jsou ve společné kandidátce (koalice nebo sdružení); **c** = Piráti jsou jen jednotlivci na cizích kandidátkách; **d** = Piráti tu vůbec nekandidují. Zveřejňují se typy a a b.
- **č., název, druh, partneři** – číslo a název kandidátky, druh (strana / koalice / sdružení) a koaliční partneři (NK = nezávislí kandidáti).
- **členové Pirátů na kandidátce** – počet kandidátů, kteří jsou členy Pirátů, a první tři jména. „Nominovaní nečlenové“ jsou lidé, které navrhli Piráti, ale členy nejsou.
- **Piráti na jiných kandidátkách** – členové Pirátů, kteří kandidují za jinou kandidátku.
- **příznaky** – technické poznámky generátoru (např. `borderline-auto`, `no-members-on-pirate-list`, `jmsez-mismatch`).
- **confidence** – jistota generátoru: `high` = zveřejněno hned.

## Co znamená „confidence low / skryto“

Když si generátor není jistý (hraniční město zařazené jen automatickým důvodem, rozdíl proti druhému zdroji, nejasné složení kandidátky), dá městu **confidence low**. Takové město je **skryto**: na webu nemá vlastní stránku a není v seznamu měst, dokud ho nepotvrdíte. Je to pojistka proti omylu, ne verdikt. Řádky označené „low (skryto)“ jsou ty, které je třeba schválit.

## Jak změnit město (`src/mesta/overrides.js`)

V souboru je objekt `towns` (klíč = KODZASTUP v uvozovkách, vždy s `name` přesně jako v registru). Zkopírujte vhodný příklad do `towns: { … }`:

```js
export default {
    reviewedAt: null,            // až budete mít vše projité: '2026-10-11' odkryje VŠECHNA skrytá (low) města najednou
    towns: {
        // 1) Schválit skryté město (např. Mikulov): město se zobrazí
        '584649': { name: 'Mikulov', reviewed: true },

        // 2) Město úplně vyřadit (důvod je povinný)
        '503444': { name: 'Litovel', include: false, reason: 'Piráti tu kandidují jen do Senátu' },

        // 3) Město zařadit i přes pravidla (důvod je povinný; u typu c/d se zobrazí vysvětlující text)
        '511111': { name: 'Příklad', include: true, reason: 'majitel: chceme ho mít' },

        // 4) Hraniční město zařadit ručním důvodem
        '999999': { name: 'Příklad', borderlineReason: 'Domov kandidáta na senátora' },
    },
};
```

Pozor: KODZASTUP a `name` musí sedět s registrem (viz sloupec „zdroj“), jinak generátor skončí chybou. Po úpravě pusťte `npm test`; generované soubory se obnoví příkazem `node scripts/mesta-registry.js`.

## Souhrn

| Zařazení | Počet |
|---|---|
| auto | 78 |
| borderline-included | 3 |
| forced | 0 |
| **zveřejněno celkem** | **81** |
| z toho skryto (low, čeká na potvrzení) | 2 |
| borderline-excluded (nezveřejněno) | 6 |
| zamítnuto ze seznamu majitele | 12 |

| Typ kandidatury (zveřejněná města) | Počet |
|---|---|
| typ a | 12 |
| typ b | 69 |
| typ c | 0 |
| typ d | 0 |

## K rozhodnutí vlastníka

Níže je vše, co generátor nemůže rozhodnout sám. U každé skupiny je otázka a návod, jak odpovědět.

### 1. Hraniční města zveřejněná jen kvůli výsledku 2022 (skryta, dokud je nepotvrdíte)

Tato města mají pod 10 000 obyvatel; do výběru se dostala jen kvůli automatickému důvodu (výsledek Pirátů v roce 2022, sídlo okresu apod.), ne kvůli vašemu seznamu. Proto jsou **skryta**. **Otázka: zveřejnit?** Ano = do `overrides.js` přidat `reviewed: true` (příklad 1 výše), ne = `include: false`.

| Město | KODZASTUP | Obyvatel | Typ | Důvod (borderline_reason) | Stav |
|---|---|---|---|---|---|
| **Mikulov** | 584649 | 7 552 | b | Piráti 2022: 8,4 %, 2 mand. | low (skryto) |
| **Rychvald** | 599107 | 7 823 | b | Piráti 2022: 11,7 %, 2 mand. | low (skryto) |

### 2. Hraniční města zveřejněná kvůli seznamu majitele / ručnímu důvodu

| Město | KODZASTUP | Obyvatel | Typ | Důvod (borderline_reason) | Stav |
|---|---|---|---|---|---|
| **Nové Město na Moravě** | 596230 | 9 716 | b | na seznamu majitele; Piráti 2022: 6,7 %, 1 mand. | high |

Zde stačí potvrdit, že je chcete mít zveřejněná.

### 3. Hraniční města bez důvodu (nezveřejněna)

Piráti tu kandidují (typ a/b), ale město má 7 000–9 999 obyvatel a nic z pravidel ho nezařadilo. **Otázka: přidat některé?** Ano = `include: true` s důvodem (příklad 3).

| Město | KODZASTUP | Obyvatel | Typ | Pozn. |
|---|---|---|---|---|
| **Černošice** | 539139 | 7 781 | b | 7 781 obyvatel, bez důvodu k zařazení; Piráti 2022: nekandidovali |
| **Hořovice** | 531189 | 8 245 | b | 8 245 obyvatel, bez důvodu k zařazení; Piráti 2022: nekandidovali |
| **Moravské Budějovice** | 591181 | 7 079 | b | 7 079 obyvatel, bez důvodu k zařazení; Piráti 2022: nekandidovali |
| **Slavkov u Brna** | 593583 | 7 294 | b | 7 294 obyvatel, bez důvodu k zařazení; Piráti 2022: nekandidovali |
| **Šlapanice** | 583952 | 7 940 | b | 7 940 obyvatel, bez důvodu k zařazení; Piráti 2022: nekandidovali |
| **Tišnov** | 584002 | 9 270 | b | 9 270 obyvatel, bez důvodu k zařazení; Piráti 2022: nekandidovali |

### 4. Spočítáno, ale není na seznamu majitele (už zveřejněno)

Město splňuje pravidla (≥ 10 000 obyvatel, Piráti na kandidátce), i když ho seznam nemá. **Otázka: ponechat?** Ne = `include: false` s důvodem (příklad 2).

| Město | KODZASTUP | Obyvatel | Typ | Kandidátka |
|---|---|---|---|---|
| **Klatovy** | 555771 | 22 921 | b | č. 4 KLATOVY21 |
| **Veselí nad Moravou** | 586722 | 10 574 | b | č. 2 ZA NAŠE VESELÍ |
| **Český Těšín** | 598933 | 22 870 | b | č. 2 TĚŠÍN 2.0 |

### 5. Města ze seznamu majitele, která jsme zamítli (12)

**Otázka: souhlasíte?** Pokud některé chcete mít přesto, použijte `include: true` (příklad 3). Typ c/d se pak zobrazí s vysvětlením „Piráti tu nekandidují“ / „jen na cizích kandidátkách“.

| Město | KODZASTUP | Obyvatel | Důvod zamítnutí |
|---|---|---|---|
| **Kralupy nad Vltavou** | 534951 | 19 138 | typ d: Piráti tu nekandidují (podle registru ČSÚ); 19 138 obyvatel |
| **Mělník** | 534676 | 20 301 | typ c: Piráti tu jsou jen na kandidátkách jiných stran; 20 301 obyvatel |
| **Neratovice** | 535087 | 16 279 | typ d: Piráti tu nekandidují (podle registru ČSÚ); 16 279 obyvatel |
| **Roztoky** | 539627 | 9 147 | typ d: Piráti tu nekandidují (podle registru ČSÚ); 9 147 obyvatel |
| **Slaný** | 532819 | 17 247 | typ c: Piráti tu jsou jen na kandidátkách jiných stran; 17 247 obyvatel |
| **Ostrov** | 555428 | 15 615 | typ c: Piráti tu jsou jen na kandidátkách jiných stran; 15 615 obyvatel |
| **Sokolov** | 560286 | 21 908 | typ c: Piráti tu jsou jen na kandidátkách jiných stran; 21 908 obyvatel |
| **Jirkov** | 563099 | 19 067 | typ c: Piráti tu jsou jen na kandidátkách jiných stran; 19 067 obyvatel |
| **Krupka** | 567639 | 12 731 | typ c: Piráti tu jsou jen na kandidátkách jiných stran; 12 731 obyvatel |
| **Litoměřice** | 564567 | 22 627 | typ c: Piráti tu jsou jen na kandidátkách jiných stran; 22 627 obyvatel |
| **Trutnov** | 579025 | 29 337 | typ c: Piráti tu jsou jen na kandidátkách jiných stran; 29 337 obyvatel |
| **Havířov** | 555088 | 67 998 | typ d: Piráti tu nekandidují (podle registru ČSÚ); 67 998 obyvatel |

Mimo soubor seznamu, zmíněno majitelem: **Litovel** – typ d: Piráti tu nekandidují (podle registru ČSÚ); 9 448 obyvatel; Litovel je senátní obvod 66 (volby 2026); pirátská vazba je podle majitele senátní kandidát (Senát, ne tento produkt); není v souboru seznamu, majitel ho uvedl jako příklad.

### 6. Zobrazit nominované nečleny?

V těchto městech je kandidátka označená jako Pirátská (koalice/sdružení s Piráty), ale **žádný z kandidátů není člen Pirátů** – na ní jsou jen lidé, které Piráti navrhli (nominovali). Dnes se na webu jako „kandidáti Pirátů“ zobrazují jen **členové**, takže tu nebude nikdo. **Otázka: Zobrazit nominované nečleny?** (Platí obecně: v celém výběru je 522 nominovaných nečlenů v 54 městech.)

| Město | KODZASTUP | Kandidátka | Nominovaných nečlenů | Členů Pirátů |
|---|---|---|---|---|
| **Dvůr Králové nad Labem** | 579203 | č. 1 Klíč ke Dvoru | 2 | 0 |
| **Náchod** | 573868 | č. 5 SOUSEDÉ za lepší Náchod | 2 | 0 |
| **Holešov** | 588458 | č. 2 AKCE Holešovských Občanů | 1 | 0 |

### 7. Města označená kontrolou (low, skryta)

Zde se zdroje rozcházejí (jmenný seznam, počet obyvatel 2025, více pirátských kandidátek, neznámý partner).

_Žádná – kontroly sedí._

## Zdroje a kontroly

- Čas stažení zdrojů: 2026-10-10T10:52:37.735Z (UTC). Generátor: `node scripts/mesta-registry.js` (výstup je deterministický, ručně se neupravuje).
- ČSÚ registr kandidátů KV 2026 (kvrzcoco, kvros, kvrk): https://volby.gov.cz/opendata/kv2026/KV2026reg20261007_csv.zip (stažení 2026-10-10T10:42:00.274Z, sha256 `0b3ff9b0bfb9f30e…`)
- ČSÚ číselníky KV 2026 (cvs, cns, cnumnuts): https://volby.gov.cz/opendata/kv2026/KV2026ciselniky20261007_csv.zip (stažení 2026-10-10T10:42:00.275Z, sha256 `f221c13ad3f8e604…`)
- ČSÚ registr a výsledky KV 2022 (kvros): https://volby.gov.cz/opendata/kv2022/KV2022reg20260328_csv.zip (stažení 2026-10-10T10:42:00.279Z, sha256 `de398056124f234f…`)
- ČSÚ senátní obvody 2026 (obvody.json): https://volby.gov.cz/appdata/senat/20261009/navig/obvody.json (stažení 2026-10-10T10:42:00.280Z, sha256 `777b8c7eafea008c…`)
- ČSÚ Počet obyvatel v obcích k 1. 1. 2025 (13007225_data.zip): https://csu.gov.cz/docs/107508/31d73e49-141b-ecbc-3bcc-4089cac638c3/13007225_data.zip?version=1.1 (stažení 2026-10-10T10:52:37.735Z, sha256 `2cef401562d24036…`)
- Počty obyvatel 2025 (kontrola pásma): načteno z tabulky ČSÚ
- Kontrola jmenným seznamem (jmsez): 81 měst

## Tabulka všech měst

Nejdřív zveřejněná města (podle kraje a abecedy), na konci města ze seznamu majitele, která jsme vyřadili. Členy Pirátů registr ČSÚ vede u kandidáta (PSTRANA 720); **příznivci bez členství se z dat poznat nedají** – ty by majitel doplnil v `overrides.js` (`pirateCandidates`).

| kraj | město | inclusion | borderline_reason | obyvatel (2026 / 2025) | typ | č. | název | druh | partneři | členové Pirátů na kandidátce | Piráti na jiných kandidátkách | zdroj (KODZASTUP / OKRES / VSTRANA / SLOZENI) | příznaky | confidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Středočeský kraj | Benešov | auto (≥ 10 000, typ a/b) | – | 17 025 / 17 043 | b | 3 | Piráti s podporou lidovců pro Benešov | association | KDU-ČSL, NK | 5 (Petr Chaluš, Magdaléna Machová, Nikola Elšíková Franková, +2) · nominovaných nečlenů: 14 | – | 529303 / 2101 / 571 / 001,080,720 | disambiguated-by-druh | high |
| Středočeský kraj | Brandýs nad Labem-Stará Boleslav | auto (≥ 10 000, typ a/b) | – | 20 926 / 20 313 | b | 5 | Piráti a Nezávislí | association | NK | 2 (Patrick Zandl, Jan Prokop) | – | 538094 / 2109 / 541 / 080,720 | dash-normalized | high |
| Středočeský kraj | Čelákovice | auto (≥ 10 000, typ a/b) | – | 12 507 / 12 474 | b | 3 | SPOLEČNĚ pro Čelákovice | coalition | KDU-ČSL, TOP 09 | 1 (Petr Petřík) · nominovaných nečlenů: 6 | – | 538132 / 2109 / 1577 / 001,720,721 | – | high |
| Středočeský kraj | Kladno | auto (≥ 10 000, typ a/b) | – | 69 728 / 69 664 | b | 8 | KLADEŇÁCI | association | KDU-ČSL, Zelení, STAN, NK | 4 (Martin Kodera, Michal Hažlinský, Barbora Částová, +1) · nominovaných nečlenů: 5 | – | 532053 / 2103 / 1696 / 001,005,080,166,720 | disambiguated-by-druh | high |
| Středočeský kraj | Kolín | auto (≥ 10 000, typ a/b) | – | 33 392 / 33 444 | a | 6 | Česká pirátská strana | party | – | 2 (Svatopluk Boček, Jiří Snížek) · nominovaných nečlenů: 9 | – | 533165 / 2104 / 720 / 720 | – | high |
| Středočeský kraj | Kutná Hora | auto (≥ 10 000, typ a/b) | – | 21 787 / 21 642 | b | 2 | LIPISTAN - LIDOVCI, PIRÁTI, STAROSTOVÉ, NEZÁVISLÍ | association | KDU-ČSL, STAN, NK | 4 (Milan Zelený, Vít Šnajdr, Robin Jiráň, +1) · nominovaných nečlenů: 4 | – | 533955 / 2105 / 1833 / 001,080,166,720 | – | high |
| Středočeský kraj | Mladá Boleslav | auto (≥ 10 000, typ a/b) | – | 47 874 / 47 346 | b | 4 | Šance pro Mladou Boleslav | association | KDU-ČSL, Zelení, NK | 1 (Michal Javůrek) · nominovaných nečlenů: 6 | – | 535419 / 2107 / 1370 / 001,005,080,720 | – | high |
| Středočeský kraj | Příbram | auto (≥ 10 000, typ a/b) | – | 32 917 / 32 773 | b | 1 | Příbram zdola - sdružení Pirátů, Zelených a nezávislých kandidátů | association | Zelení, NK | 3 (Simona Luftová, Antonín Schejbal, Jiří Kotlan) · nominovaných nečlenů: 4 | – | 539911 / 2111 / 529 / 005,080,720 | – | high |
| Středočeský kraj | Říčany | auto (≥ 10 000, typ a/b) | – | 17 314 / 17 143 | b | 4 | Piráti se Zelení a nestranní | association | Zelení, NK | 3 (Aleš Chán, Libor Dušek, Vojtěch Mihulka) · nominovaných nečlenů: 6 | – | 538728 / 2109 / 529 / 005,080,720 | disambiguated-by-druh | high |
| Středočeský kraj | Vlašim | auto (≥ 10 000, typ a/b) | – | 11 329 / 11 434 | b | 6 | Piráti pro Vlašim | association | NK | 3 (Petr Švingr, Lukáš Pacholík, Jan Brabenec) | – | 530883 / 2101 / 541 / 080,720 | – | high |
| Jihočeský kraj | České Budějovice | auto (≥ 10 000, typ a/b) | – | 97 128 / 97 231 | b | 6 | Piráti a Budějčáci s podporou Zelených | coalition | Zelení | 11 (Pavel Tůma, Pavla Heyduková, Erik Ferchenbauer, +8) · nominovaných nečlenů: 25 | – | 544256 / 3101 / 1066 / 005,720 | – | high |
| Jihočeský kraj | Jindřichův Hradec | auto (≥ 10 000, typ a/b) | – | 20 369 / 20 540 | b | 1 | Společně s Piráty | association | NK | 1 (Václav Urban) · nominovaných nečlenů: 4 | – | 545881 / 3103 / 541 / 080,720 | – | high |
| Jihočeský kraj | Písek | auto (≥ 10 000, typ a/b) | – | 31 002 / 31 121 | a | 6 | Česká pirátská strana | party | – | 6 (Josef Soumar, Tomáš Posekaný, Petr Soušek, +3) · nominovaných nečlenů: 21 | – | 549240 / 3104 / 720 / 720 | disambiguated-by-druh | high |
| Jihočeský kraj | Prachatice | auto (≥ 10 000, typ a/b) | – | 11 036 / 11 119 | b | 7 | Živé Prachatice | association | Zelení, STAN, NK | 1 (Barbora Koritenská) | – | 550094 / 3105 / 562 / 005,080,166,720 | – | high |
| Jihočeský kraj | Tábor | auto (≥ 10 000, typ a/b) | – | 34 339 / 34 356 | b | 7 | Živý Tábor | association | Zelení, NK | 5 (Martin Mareda, Jan Příbramský, Václav Klecanda, +2) · nominovaných nečlenů: 4 | – | 552046 / 3107 / 529 / 005,080,720 | – | high |
| Plzeňský kraj | Domažlice | auto (≥ 10 000, typ a/b) | – | 10 973 / 11 133 | a | 5 | Česká pirátská strana | party | – | 5 (Jan Pachl, Jan Kincler, Jan Soldán, +2) · nominovaných nečlenů: 16 | – | 553425 / 3201 / 720 / 720 | – | high |
| Plzeňský kraj | Klatovy | auto (≥ 10 000, typ a/b); vypočteno, není na seznamu majitele | – | 22 921 / 22 763 | b | 4 | KLATOVY21 | association | KDU-ČSL, NK | 1 (Stanislav Haviar) | – | 555771 / 3202 / 571 / 001,080,720 | – | high |
| Plzeňský kraj | Plzeň | auto (≥ 10 000, typ a/b) | – | 187 863 / 187 928 | a | 11 | Česká pirátská strana | party | – | 38 (Pavel Bosák, Marek Habruň, Vanessa Evelynn, +35) · nominovaných nečlenů: 9 | – | 554791 / 3203 / 720 / 720 | – | high |
| Plzeňský kraj | Rokycany | auto (≥ 10 000, typ a/b) | – | 14 248 / 14 381 | b | 1 | Naše Rokycany | association | NK | 1 (Jakub Frühauf) | – | 559717 / 3206 / 541 / 080,720 | – | high |
| Plzeňský kraj | Sušice | auto (≥ 10 000, typ a/b) | – | 10 689 / 10 740 | a | 4 | Česká pirátská strana | party | – | 3 (Jan Janda, Lucie Mikulová, Věra Mikušová) · nominovaných nečlenů: 16 | – | 557153 / 3202 / 720 / 720 | disambiguated-by-druh | high |
| Karlovarský kraj | Cheb | auto (≥ 10 000, typ a/b) | – | 32 892 / 32 808 | b | 6 | Koalice pro Cheb | association | KDU-ČSL, Zelení, TOP 09, NK | 2 (Ladislav Tkaczyszyn, Barbora Kaprálová) · nominovaných nečlenů: 2 | – | 554481 / 4101 / 1523 / 001,005,080,720,721 | – | high |
| Karlovarský kraj | Karlovy Vary | auto (≥ 10 000, typ a/b) | – | 48 788 / 49 073 | b | 4 | VARY+ | coalition | KDU-ČSL, KOA, TOP 09 | 4 (Jindřich Čermák, Bohdan Vaněk, Karel Špecián, +1) · nominovaných nečlenů: 5 | – | 554961 / 4102 / 1961 / 001,182,720,721 | – | high |
| Karlovarský kraj | Mariánské Lázně | auto (≥ 10 000, typ a/b) | – | 13 921 / 14 052 | b | 9 | Za lepší Mariánské Lázně | association | NK | 6 (Vojtěch Franta, Josef Pavlovic, Žaneta Pivcová, +3) | – | 554642 / 4101 / 541 / 080,720 | – | high |
| Ústecký kraj | Bílina | auto (≥ 10 000, typ a/b) | – | 14 401 / 14 497 | b | 10 | MOJE BÍLINA s podporou Pirátů | association | TOP 09, NK | 1 (Antonín Budaj) | – | 567451 / 4206 / 1331 / 080,720,721 | – | high |
| Ústecký kraj | Děčín | auto (≥ 10 000, typ a/b) | – | 46 003 / 46 376 | b | 2 | HLAS DĚČÍNA (Piráti Děčín + Hlas regionů) | coalition | HR | 4 (Martin Strnad, Petr Andráš, Jan Maixner, +1) · nominovaných nečlenů: 21 | – | 562335 / 4201 / 1930 / 720,1715 | – | high |
| Ústecký kraj | Chomutov | auto (≥ 10 000, typ a/b) | – | 46 560 / 46 771 | b | 5 | JsmePRO! Chomutov | association | KDU-ČSL, Zelení, TOP 09, JsmePRO!, NK | 1 (František Kindl) | – | 562971 / 4202 / 1825 / 001,005,080,720,721,1126 | – | high |
| Ústecký kraj | Kadaň | auto (≥ 10 000, typ a/b) | – | 18 088 / 18 090 | b | 3 | Spojení pro změnu | association | NK | 3 (Jana Hladová, Hana Vodrážková, Jiří Kopica) · nominovaných nečlenů: 3 | – | 563102 / 4202 / 541 / 080,720 | – | high |
| Ústecký kraj | Litvínov | auto (≥ 10 000, typ a/b) | – | 22 258 / 22 387 | b | 2 | Litvínov DO TOHO! | association | Zelení, NK | 2 (Filip Marko, Matyáš Šimon Tvrzník) | – | 567256 / 4205 / 529 / 005,080,720 | – | high |
| Ústecký kraj | Louny | auto (≥ 10 000, typ a/b) | – | 18 061 / 18 068 | b | 5 | LOUNY SPOLEČNĚ: Piráti, Zelení, nezávislí | association | Zelení, NK | 3 (Pavel Nadolecki, Radek Miličevič, Petr Felix Šťastný) · nominovaných nečlenů: 5 | – | 565971 / 4204 / 529 / 005,080,720 | – | high |
| Ústecký kraj | Most | auto (≥ 10 000, typ a/b) | – | 63 160 / 63 474 | b | 6 | Piráti, Zelení a Starostové | coalition | Zelení, STAN | 1 (Jakub Zlata) · nominovaných nečlenů: 9 | – | 567027 / 4205 / 1894 / 005,166,720 | – | high |
| Ústecký kraj | Roudnice nad Labem | auto (≥ 10 000, typ a/b) | – | 12 561 / 12 668 | b | 6 | Tým Roudnice | association | NK | 2 (Miroslav Hrstka, Milan Majerčík) | – | 565555 / 4203 / 541 / 080,720 | – | high |
| Ústecký kraj | Teplice | auto (≥ 10 000, typ a/b) | – | 50 856 / 50 912 | b | 9 | Volba pro Teplice | association | KDU-ČSL, Zelení, NK | 1 (Martin Sobek) · nominovaných nečlenů: 1 | – | 567442 / 4206 / 1370 / 001,005,080,720 | – | high |
| Ústecký kraj | Ústí nad Labem | auto (≥ 10 000, typ a/b) | – | 90 035 / 90 866 | b | 5 | JEDNO ÚSTÍ | association | Zelení, STAN, TOP 09, UFO, NČ, NK | 4 (Jiří Baudis, Vladimír Kozák, Lukáš Blažej Chorovský, +1) | – | 554804 / 4207 / 1933 / 005,080,166,720,721,1012,1722 | – | high |
| Ústecký kraj | Varnsdorf | auto (≥ 10 000, typ a/b) | – | 14 645 / 14 704 | b | 6 | NÁŠ VARNSDORF | association | STAN, NK | 1 (Zdeněk Štěpánek) | – | 562882 / 4201 / 1483 / 080,166,720 | – | high |
| Ústecký kraj | Žatec | auto (≥ 10 000, typ a/b) | – | 18 984 / 18 959 | b | 5 | Piráti a nezávislí pro Žatec | association | NK | 6 (Tobiáš Bartoš, Vladimír Vlach, Marta Koutecká Kalousová, +3) · nominovaných nečlenů: 9 | – | 566985 / 4204 / 541 / 080,720 | disambiguated-by-druh | high |
| Liberecký kraj | Česká Lípa | auto (≥ 10 000, typ a/b) | – | 36 364 / 36 815 | b | 8 | Piráti a Zelení | coalition | Zelení | 3 (Ondřej Víteček, Kateřina Halamová, Stanislav Martyčák) · nominovaných nečlenů: 10 | – | 561380 / 5101 / 1066 / 005,720 | – | high |
| Liberecký kraj | Jablonec nad Nisou | auto (≥ 10 000, typ a/b) | – | 46 206 / 46 209 | b | 4 | Piráti a nezávislí | association | NK | 10 (Jaroslav Šída, Kateřina Žáková, Veronika Drápalíková, +7) · nominovaných nečlenů: 5 | – | 563510 / 5102 / 541 / 080,720 | – | high |
| Liberecký kraj | Liberec | auto (≥ 10 000, typ a/b) | – | 108 214 / 108 090 | b | 6 | Liberec otevřený lidem a Piráti | coalition | Zelení | 12 (Jan Hruška, Jiřina Macháčková, Petr Slanina, +9) · nominovaných nečlenů: 3 | – | 563889 / 5103 / 1066 / 005,720 | – | high |
| Liberecký kraj | Turnov | auto (≥ 10 000, typ a/b) | – | 14 607 / 14 577 | a | 2 | Česká pirátská strana | party | – | 3 (Vratislav Slavík, Daniel Havlík, František Poslušný) · nominovaných nečlenů: 24 | – | 577626 / 5104 / 720 / 720 | – | high |
| Královéhradecký kraj | Dvůr Králové nad Labem | auto (≥ 10 000, typ a/b) | – | 15 316 / 15 322 | b | 1 | Klíč ke Dvoru | association | KDU-ČSL, Zelení, NK | 0 (nominovaných nečlenů: 2) | – | 579203 / 5205 / 1370 / 001,005,080,720 | no-members-on-pirate-list | high |
| Královéhradecký kraj | Hradec Králové | auto (≥ 10 000, typ a/b) | – | 93 534 / 94 311 | b | 4 | PIRÁTI a STAROSTOVÉ | coalition | STAN | 11 (Kamil Kubica, Aleš Dohnal, Vít Luštinec, +8) · nominovaných nečlenů: 8 | – | 569810 / 5201 / 1350 / 166,720 | – | high |
| Královéhradecký kraj | Jaroměř | auto (≥ 10 000, typ a/b) | – | 12 487 / 12 483 | b | 6 | Nová vlna pro Jaroměř | association | Zelení, NK | 1 (Marek Picek) | – | 574121 / 5203 / 529 / 005,080,720 | – | high |
| Královéhradecký kraj | Jičín | auto (≥ 10 000, typ a/b) | – | 16 052 / 16 101 | b | 9 | JIČÍN SRDCEM s podporou Pirátů | association | NK | 1 (Jan Ent) | – | 572659 / 5202 / 541 / 080,720 | kraj-differs-from-owner-list | high |
| Královéhradecký kraj | Náchod | auto (≥ 10 000, typ a/b) | – | 19 649 / 19 827 | b | 5 | SOUSEDÉ za lepší Náchod | association | KDU-ČSL, Zelení, TOP 09, NK | 0 (nominovaných nečlenů: 2) | – | 573868 / 5203 / 1523 / 001,005,080,720,721 | no-members-on-pirate-list | high |
| Královéhradecký kraj | Rychnov nad Kněžnou | auto (≥ 10 000, typ a/b) | – | 11 693 / 11 420 | b | 3 | PROSTOR 516 01 s podporou Pirátů a Starostů | association | STAN, NK | 1 (Věra Králová) | – | 576069 / 5204 / 1483 / 080,166,720 | – | high |
| Pardubický kraj | Česká Třebová | auto (≥ 10 000, typ a/b) | – | 14 982 / 15 010 | b | 2 | Stateční & Piráti | association | TOP 09, NK | 4 (Jiří Ducháček, Martin Saifrt, Martin Herman, +1) | – | 580031 / 5304 / 1331 / 080,720,721 | – | high |
| Pardubický kraj | Chrudim | auto (≥ 10 000, typ a/b) | – | 23 562 / 23 564 | b | 7 | Lidi z Chrudimi - Piráti a nezávislí | association | NK | 7 (Daniel Lebduška, Ivo Diblík, Jiří Blažek, +4) · nominovaných nečlenů: 19 | – | 571164 / 5301 / 541 / 080,720 | – | high |
| Pardubický kraj | Pardubice | auto (≥ 10 000, typ a/b) | – | 92 713 / 92 319 | b | 3 | Progresivní Pardubice (Piráti a TOP 09 s podporou Zelených a nezávislých osobností) | coalition | TOP 09 | 11 (Stanislav Klát, Žaneta Havlenová, Vojtěch Jirsa, +8) · nominovaných nečlenů: 12 | – | 555134 / 5302 / 1897 / 720,721 | – | high |
| Kraj Vysočina | Havlíčkův Brod | auto (≥ 10 000, typ a/b) | – | 23 368 / 23 791 | a | 7 | Česká pirátská strana | party | – | 5 (Petr Vozáb, Jan Pošvář, Jiří Svoboda, +2) · nominovaných nečlenů: 20 | – | 568414 / 6101 / 720 / 720 | – | high |
| Kraj Vysočina | Humpolec | auto (≥ 10 000, typ a/b) | – | 11 487 / 11 522 | a | 6 | Česká pirátská strana | party | – | 1 (Martin Hendrych) · nominovaných nečlenů: 20 | – | 547999 / 6103 / 720 / 720 | – | high |
| Kraj Vysočina | Jihlava | auto (≥ 10 000, typ a/b) | – | 53 686 / 54 624 | b | 1 | Piráti a Fórum Jihlava s podporou Zelených | association | Zelení, NK | 8 (Daniel Škarka, Tereza Kafková, Vít Žáček, +5) · nominovaných nečlenů: 10 | – | 586846 / 6102 / 529 / 005,080,720 | – | high |
| Kraj Vysočina | Nové Město na Moravě | hraniční, zařazeno | na seznamu majitele; Piráti 2022: 6,7 %, 1 mand. | 9 716 / 9 834 | b | 5 | Piráti a nezávislí | association | NK | 3 (Tomáš Blažek, Šimon Mareček, René Mayer) | – | 596230 / 6105 / 541 / 080,720 | – | high |
| Kraj Vysočina | Pelhřimov | auto (≥ 10 000, typ a/b) | – | 16 233 / 16 206 | a | 7 | Česká pirátská strana | party | – | 6 (Pavel Knežik, Zdeňka Lišková, Tomáš Bitman, +3) · nominovaných nečlenů: 15 | – | 547492 / 6103 / 720 / 720 | – | high |
| Kraj Vysočina | Třebíč | auto (≥ 10 000, typ a/b) | – | 34 476 / 34 530 | b | 7 | Piráti - Břehy - Zelení | association | Zelení, NK | 4 (Aleš Novák, Adam Urban, Anna Kohoutová, +1) · nominovaných nečlenů: 9 | – | 590266 / 6104 / 529 / 005,080,720 | – | high |
| Jihomoravský kraj | Blansko | auto (≥ 10 000, typ a/b) | – | 19 900 / 20 002 | a | 1 | Česká pirátská strana | party | – | 6 (Ondřej Haváč, Žaneta Němcová, Zbyněk Pokorný, +3) · nominovaných nečlenů: 19 | – | 581283 / 6201 / 720 / 720 | – | high |
| Jihomoravský kraj | Brno | auto (≥ 10 000, typ a/b) | – | 404 296 / 402 739 | b | 15 | Piráti a Fakt Brno TU! | coalition | Idealisté, Fakt Brno, GEN | 22 (Adam Zemek, Jitka Bidlová, Marek Lahoda, +19) · nominovaných nečlenů: 5 | – | 582786 / 6202 / 1870 / 720,1233,1246,1297 | – | high |
| Jihomoravský kraj | Břeclav | auto (≥ 10 000, typ a/b) | – | 24 583 / 24 538 | b | 1 | MLADÍ A NEKLIDNÍ BŘECLAV | association | STAN, NK | 6 (Petr Vlasák, Petr Holobrádek, Jan Marek, +3) · nominovaných nečlenů: 2 | – | 584291 / 6204 / 1483 / 080,166,720 | – | high |
| Jihomoravský kraj | Mikulov | hraniční, zařazeno; vypočteno, není na seznamu majitele | Piráti 2022: 8,4 %, 2 mand. | 7 552 / 7 577 | b | 2 | Piráti Mikulov | association | NK | 2 (Ivo Hrdlička, Josef Bárta) | – | 584649 / 6204 / 541 / 080,720 | borderline-auto | low (skryto) |
| Jihomoravský kraj | Veselí nad Moravou | auto (≥ 10 000, typ a/b); vypočteno, není na seznamu majitele | – | 10 574 / 10 623 | b | 2 | ZA NAŠE VESELÍ | association | NK | 1 (Lukáš Habarta) | – | 586722 / 6205 / 541 / 080,720 | – | high |
| Jihomoravský kraj | Znojmo | auto (≥ 10 000, typ a/b) | – | 33 989 / 34 172 | b | 7 | ZNOJMO JSI TY! | association | NK | 4 (Pavel Nevrkla, Petr Ilgner, Karolína Trojanová, +1) · nominovaných nečlenů: 3 | – | 593711 / 6207 / 541 / 080,720 | – | high |
| Olomoucký kraj | Olomouc | auto (≥ 10 000, typ a/b) | – | 105 297 / 103 063 | b | 9 | MILUJEME OLOMOUC - Piráti, TOP 09, Zelení | coalition | Zelení, TOP 09 | 9 (Zdeněk Žák, Michal Langer, Vlastimil Bednařík, +6) · nominovaných nečlenů: 13 | – | 500496 / 7102 / 1369 / 005,720,721 | – | high |
| Olomoucký kraj | Prostějov | auto (≥ 10 000, typ a/b) | – | 43 236 / 43 408 | b | 1 | Prostějov 2:0 | association | NK | 11 (Jan Mochťák, Adéla Čečmanová, Petr Lysek, +8) | – | 589250 / 7103 / 541 / 080,720 | – | high |
| Olomoucký kraj | Přerov | auto (≥ 10 000, typ a/b) | – | 40 492 / 40 906 | b | 2 | Změna pro Přerov | association | STAN, NK | 12 (Petr Dostalík, Jaroslav Krejčí, David Hošek, +9) · nominovaných nečlenů: 5 | – | 511382 / 7104 / 1483 / 080,166,720 | – | high |
| Olomoucký kraj | Uničov | auto (≥ 10 000, typ a/b) | – | 11 060 / 11 237 | b | 6 | Česká pirátská strana | association | NK | 3 (Hana Koppová, Tomáš Fabrik, Jan Motal) · nominovaných nečlenů: 2 | – | 505587 / 7102 / 541 / 080,720 | named-cps-but-association | high |
| Zlínský kraj | Holešov | auto (≥ 10 000, typ a/b) | – | 11 544 / 11 616 | b | 2 | AKCE Holešovských Občanů | association | TOP 09, NK | 0 (nominovaných nečlenů: 1) | – | 588458 / 7201 / 1331 / 080,720,721 | no-members-on-pirate-list | high |
| Zlínský kraj | Kroměříž | auto (≥ 10 000, typ a/b) | – | 27 781 / 27 917 | b | 7 | První volba pro Kroměříž a místní části | association | NK | 4 (Hana Ančincová, Jana Knapková, Marcela Válková, +1) · nominovaných nečlenů: 4 | – | 588296 / 7201 / 541 / 080,720 | – | high |
| Zlínský kraj | Otrokovice | auto (≥ 10 000, typ a/b) | – | 17 239 / 17 401 | b | 1 | Občané OE s podporou Pirátů | association | NK | 4 (Petr Ťopek, Pavel Beznoska, Michal Bartík, +1) | – | 585599 / 7204 / 541 / 080,720 | – | high |
| Zlínský kraj | Rožnov pod Radhoštěm | auto (≥ 10 000, typ a/b) | – | 15 916 / 16 063 | b | 4 | Zdravý Rožnov s podporou Pirátů | association | NK | 2 (Libor Adámek, Marie Babincová) | – | 544841 / 7203 / 541 / 080,720 | – | high |
| Zlínský kraj | Uherské Hradiště | auto (≥ 10 000, typ a/b) | – | 24 852 / 24 887 | b | 2 | TOŽ HRADIŠTĚ s podporou Pirátů | association | NK | 3 (František Elfmark, Jaroslav Ševčík, Dušan Jurčík) · nominovaných nečlenů: 3 | – | 592005 / 7202 / 541 / 080,720 | – | high |
| Zlínský kraj | Uherský Brod | auto (≥ 10 000, typ a/b) | – | 16 280 / 16 367 | b | 3 | Mladí Broďani - zlepsimebrod.cz | association | NK | 3 (Štěpán Vráblík, Marek Houser, Petr Kroča) | – | 592731 / 7202 / 541 / 080,720 | – | high |
| Zlínský kraj | Zlín | auto (≥ 10 000, typ a/b) | – | 74 917 / 74 684 | b | 5 | ZLÍN SRDCEM a Piráti | association | ZS, NK | 7 (Jiří Jaroš, Václav Křapáček, Sandra Slobodian, +4) · nominovaných nečlenů: 1 | – | 585068 / 7204 / 1949 / 080,720,1751 | – | high |
| Moravskoslezský kraj | Český Těšín | auto (≥ 10 000, typ a/b); vypočteno, není na seznamu majitele | – | 22 870 / 23 075 | b | 2 | TĚŠÍN 2.0 | association | NK | 2 (Lubomír Lukšík, Vlastimil Petráš) | – | 598933 / 8103 / 541 / 080,720 | – | high |
| Moravskoslezský kraj | Frýdek-Místek | auto (≥ 10 000, typ a/b) | – | 53 164 / 53 590 | a | 4 | Česká pirátská strana | party | – | 5 (Michaela Davidová, Michaela Moricová, Martin Škapa, +2) · nominovaných nečlenů: 38 | – | 598003 / 8102 / 720 / 720 | – | high |
| Moravskoslezský kraj | Hlučín | auto (≥ 10 000, typ a/b) | – | 13 245 / 13 352 | b | 7 | Hlučíňáci | association | NK | 1 (Rostislav Matuška) | – | 507016 / 8105 / 541 / 080,720 | – | high |
| Moravskoslezský kraj | Karviná | auto (≥ 10 000, typ a/b) | – | 48 684 / 48 937 | b | 4 | Srdcem pro Karvinou - koalice STAN, ODS, PIRÁTI a TOP 09 | coalition | ODS, STAN, TOP 09 | 3 (Marek Božoň, Michal Klus, Emil Adámek) · nominovaných nečlenů: 8 | – | 598917 / 8103 / 1912 / 053,166,720,721 | – | high |
| Moravskoslezský kraj | Kopřivnice | auto (≥ 10 000, typ a/b) | – | 21 245 / 21 374 | b | 4 | Pro Zdraví a Piráti | coalition | PRO Zdraví | 2 (Tomáš Hof, Ladislav Stehlík) · nominovaných nečlenů: 8 | – | 599565 / 8104 / 1802 / 720,785 | – | high |
| Moravskoslezský kraj | Nový Jičín | auto (≥ 10 000, typ a/b) | – | 22 740 / 23 005 | b | 5 | Zelení/Piráti/TOP 09/STAN | coalition | Zelení, STAN, TOP 09 | 4 (Andrej Droščín, Anna Himmerová, Jan Faluši, +1) · nominovaných nečlenů: 3 | – | 599191 / 8104 / 1351 / 005,166,720,721 | – | high |
| Moravskoslezský kraj | Opava | auto (≥ 10 000, typ a/b) | – | 54 881 / 55 109 | b | 7 | VIZE PRO OPAVU | association | TOP 09, NK | 5 (Pavel Kořízek, Hana Brňáková, Martin Rell, +2) | – | 505927 / 8105 / 1331 / 080,720,721 | – | high |
| Moravskoslezský kraj | Orlová | auto (≥ 10 000, typ a/b) | – | 27 383 / 27 540 | b | 9 | Sousedi Orlová | association | ODS, NK | 2 (Miroslav Sedláček, Lukáš Neri) · nominovaných nečlenů: 12 | – | 599069 / 8103 / 1821 / 053,080,720 | – | high |
| Moravskoslezský kraj | Ostrava | auto (≥ 10 000, typ a/b) | – | 280 853 / 283 187 | a | 12 | Česká pirátská strana | party | – | 23 (Rostislav Řeha, Martina Dušková, Jakub Vontroba, +20) · nominovaných nečlenů: 32 | – | 554821 / 8106 / 720 / 720 | – | high |
| Moravskoslezský kraj | Rychvald | hraniční, zařazeno; vypočteno, není na seznamu majitele | Piráti 2022: 11,7 %, 2 mand. | 7 823 / 7 787 | b | 2 | „Opozice 26“ | coalition | ODS, TOP 09 | 1 (Eliška Polochová) | – | 599107 / 8103 / 1820 / 053,720,721 | borderline-auto | low (skryto) |
| Středočeský kraj | Kralupy nad Vltavou | vyřazeno: typ d: Piráti tu nekandidují (podle registru ČSÚ); 19 138 obyvatel | – | 19 138 / 19 005 | d | – | – | – | – | 0 | – | 534951 / 2106 | – | – |
| Středočeský kraj | Mělník | vyřazeno: typ c: Piráti tu jsou jen na kandidátkách jiných stran; 20 301 obyvatel | – | 20 301 / 20 278 | c | – | – | – | – | 0 | 1: Oliver Krejza (č. 6/7, navrhl NK) | 534676 / 2106 | – | – |
| Středočeský kraj | Neratovice | vyřazeno: typ d: Piráti tu nekandidují (podle registru ČSÚ); 16 279 obyvatel | – | 16 279 / 16 360 | d | – | – | – | – | 0 | – | 535087 / 2106 | – | – |
| Středočeský kraj | Roztoky | vyřazeno: typ d: Piráti tu nekandidují (podle registru ČSÚ); 9 147 obyvatel | – | 9 147 / 9 088 | d | – | – | – | – | 0 | – | 539627 / 2110 | disambiguated-by-druh | – |
| Středočeský kraj | Slaný | vyřazeno: typ c: Piráti tu jsou jen na kandidátkách jiných stran; 17 247 obyvatel | – | 17 247 / 16 937 | c | – | – | – | – | 0 | 2: Vendula Kučerová (č. 10/5, navrhl NK); Petr Číhal (č. 10/21, navrhl NK) | 532819 / 2103 | – | – |
| Karlovarský kraj | Ostrov | vyřazeno: typ c: Piráti tu jsou jen na kandidátkách jiných stran; 15 615 obyvatel | – | 15 615 / 15 681 | c | – | – | – | – | 0 | 1: Tomáš Sedlmajer (č. 3/5, navrhl NK) | 555428 / 4102 | disambiguated-by-druh | – |
| Karlovarský kraj | Sokolov | vyřazeno: typ c: Piráti tu jsou jen na kandidátkách jiných stran; 21 908 obyvatel | – | 21 908 / 22 007 | c | – | – | – | – | 0 | 4: Lukáš Zykán (č. 7/5, navrhl STAN); Tereza Zykánová (č. 7/12, navrhl STAN); Petra Zámečníková (č. 7/18, navrhl STAN); +1 | 560286 / 4103 | – | – |
| Ústecký kraj | Jirkov | vyřazeno: typ c: Piráti tu jsou jen na kandidátkách jiných stran; 19 067 obyvatel | – | 19 067 / 19 240 | c | – | – | – | – | 0 | 1: Milan Buresch (č. 8/8, navrhl NK) | 563099 / 4202 | – | – |
| Ústecký kraj | Krupka | vyřazeno: typ c: Piráti tu jsou jen na kandidátkách jiných stran; 12 731 obyvatel | – | 12 731 / 12 793 | c | – | – | – | – | 0 | 1: Petr Duda (č. 7/7, navrhl NK) | 567639 / 4206 | – | – |
| Ústecký kraj | Litoměřice | vyřazeno: typ c: Piráti tu jsou jen na kandidátkách jiných stran; 22 627 obyvatel | – | 22 627 / 22 767 | c | – | – | – | – | 0 | 1: Jiří Rotter (č. 9/20, navrhl SEN 21) | 564567 / 4203 | – | – |
| Královéhradecký kraj | Trutnov | vyřazeno: typ c: Piráti tu jsou jen na kandidátkách jiných stran; 29 337 obyvatel | – | 29 337 / 29 607 | c | – | – | – | – | 0 | 1: Pavel Volk (č. 3/5, navrhl NK) | 579025 / 5205 | – | – |
| Moravskoslezský kraj | Havířov | vyřazeno: typ d: Piráti tu nekandidují (podle registru ČSÚ); 67 998 obyvatel | – | 67 998 / 68 674 | d | – | – | – | – | 0 | – | 555088 / 8103 | – | – |
