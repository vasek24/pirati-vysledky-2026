# Přehled měst a kandidatur Pirátů (review tabulka „města“)

## Co to je

Tato tabulka ukazuje, **která města se na webu „města“ zveřejní** a **jak v nich Piráti kandidují**. Vznikla automaticky z otevřených dat ČSÚ (registr kandidátů pro komunální volby 2026), ne z ruky. Cílem je, abyste ji za pár minut prošel(a) a u sporných měst rozhodl(a). Co v tabulce nesedí, opravíte v souboru `src/mesta/overrides.js` (návod níže), ne v tomto dokumentu.

## Jak číst sloupce

Pod českým názvem sloupce je malým písmem původní technický název (hodí se jen pro vývojáře).

- **kraj, město** – kraj a název obce.
- **zařazení** – proč je město na webu: *zařazeno automaticky* = má aspoň 10 000 obyvatel a Piráti kandidují (typ a nebo b); *zařazeno podle úsudku* = 7 000–9 999 obyvatel a máme důvod (viz **důvod zařazení**); *ručně vynuceno* = zařazeno vaším zásahem v `overrides.js`; *vyřazeno* = na webu nebude.
- **důvod zařazení** – u malých (hraničních) měst důvod, proč je přesto zařazeno (např. „na vašem seznamu“, „Piráti 2022: 11,7 %, 2 mand.“, „sídlo okresu“).
- **obyvatel (2026 / 2025)** – počet obyvatel z registru voleb 2026 (podle něj se rozhoduje) a z tabulky ČSÚ k 1. 1. 2025 (jen kontrola).
- **typ** – **a** = Piráti mají vlastní kandidátku; **b** = Piráti jsou ve společné kandidátce (koalice nebo sdružení); **c** = Piráti jsou jen jednotlivci na cizích kandidátkách; **d** = Piráti tu vůbec nekandidují. Na web se dávají typy a a b.
- **č., název, druh, partneři** – číslo a název kandidátky, druh (strana / koalice / sdružení) a koaliční partneři (NK = nezávislí kandidáti).
- **členové Pirátů na kandidátce** – počet kandidátů, kteří jsou členy Pirátů, a první tři jména. „Nominovaní nečlenové“ jsou lidé, které Piráti navrhli, ale členy nejsou.
- **Piráti na jiných kandidátkách** – členové Pirátů, kteří kandidují za jinou kandidátku.
- **kódy v registru ČSÚ** – čísla, podle kterých lze každý řádek dohledat v datech (kód obce, okres, kandidátka, složení).
- **poznámky generátoru** – upozornění, např. že na pirátské kandidátce není žádný člen Pirátů.
- **jistota** – *vysoká* = město se zveřejní hned; *nízká (skryto)* = viz níže.

## Co znamená „jistota nízká / skryto“

Když si generátor není jistý (hraniční město zařazené jen automatickým důvodem, rozdíl proti druhému zdroji, nejasná kandidátka), dá městu **nízkou jistotu**. Takové město je **skryto**: na webu nemá vlastní stránku a není v seznamu měst, dokud ho nepotvrdíte. Je to pojistka proti omylu, ne verdikt. Řádky „nízká (skryto)“ jsou ty, které je třeba schválit.

## Jak změnit město (`src/mesta/overrides.js`)

V souboru je objekt `towns`. Klíč je kód obce v uvozovkách (najdete ho ve sloupci „kódy v registru ČSÚ“, první číslo) a `name` musí být přesně název z registru. Zkopírujte vhodný příklad do `towns: { … }` (jsou to skutečná města; místo „důvod doplňte“ napište svůj důvod):

```js
export default {
    reviewedAt: null,            // až budete mít vše projité: '2026-10-11' odkryje VŠECHNA skrytá města najednou
    towns: {
        // 1) Schválit skryté město (Mikulov): město se zobrazí
        '584649': { name: 'Mikulov', reviewed: true },

        // 2) Zveřejněné město vyřadit (důvod je povinný)
        '598933': { name: 'Český Těšín', include: false, reason: 'důvod doplňte' },

        // 3) Město zařadit i přes pravidla (důvod je povinný; u typu c/d se zobrazí vysvětlující text)
        '560286': { name: 'Sokolov', include: true, reason: 'důvod doplňte' },

        // 4) Hraniční město (7 000–9 999 obyvatel) zařadit ručním důvodem
        '584002': { name: 'Tišnov', borderlineReason: 'důvod doplňte' },
    },
};
```

Pozor: kód obce a `name` musí sedět s registrem, jinak generátor skončí chybou. Po úpravě pusťte `npm test`; generované soubory se obnoví příkazem `node scripts/mesta-registry.js`.

## Souhrn

| Zařazení | Počet |
|---|---|
| zařazeno automaticky | 75 |
| zařazeno podle úsudku | 3 |
| ručně vynuceno | 0 |
| **zveřejněno celkem** | **78** |
| z toho skryto (nízká jistota, čeká na vaše potvrzení) | 2 |
| hraniční, nezařazeno (nezveřejněno) | 6 |
| zamítnuto z vašeho seznamu | 15 |

| Typ kandidatury (zveřejněná města) | Počet |
|---|---|
| typ a | 12 |
| typ b | 66 |
| typ c | 0 |
| typ d | 0 |

## K rozhodnutí vlastníka

Níže je vše, co generátor nemůže rozhodnout sám. U každé skupiny je otázka a návod, jak odpovědět.

### 1. Hraniční města zařazená automaticky (skrytá): důvodem je výsledek Pirátů v roce 2022

Tato města mají pod 10 000 obyvatel; do výběru se dostala jen z automatického důvodu uvedeného v tabulce, ne kvůli vašemu seznamu. Proto jsou **skrytá**. **Otázka: zveřejnit?** Ano = do `overrides.js` přidat `reviewed: true` (příklad 1 výše), ne = `include: false` (příklad 2).

| Město | Kód obce | Obyvatel | Typ | Důvod zařazení | Jistota |
|---|---|---|---|---|---|
| **Mikulov** | 584649 | 7 552 | b | Piráti 2022: 8,4 %, 2 mand. | nízká (skryto) |
| **Rychvald** | 599107 | 7 823 | b | Piráti 2022: 11,7 %, 2 mand. | nízká (skryto) |

### 2. Hraniční města zařazená kvůli vašemu seznamu nebo ručnímu důvodu

| Město | Kód obce | Obyvatel | Typ | Důvod zařazení | Jistota |
|---|---|---|---|---|---|
| **Nové Město na Moravě** | 596230 | 9 716 | b | na vašem seznamu; Piráti 2022: 6,7 %, 1 mand. | vysoká |

Zde stačí potvrdit, že je chcete mít zveřejněná.

### 3. Hraniční města bez důvodu (nezveřejněna)

Piráti tu kandidují (typ a nebo b), ale město má 7 000–9 999 obyvatel a nic z pravidel ho nezařadilo. **Otázka: přidat některé?** Ano = přidat `borderlineReason` (příklad 4 výše).

| Město | Kód obce | Obyvatel | Typ | Poznámka |
|---|---|---|---|---|
| **Černošice** | 539139 | 7 781 | b | 7 781 obyvatel, bez důvodu k zařazení; Piráti 2022: bez pirátské kandidátky |
| **Hořovice** | 531189 | 8 245 | b | 8 245 obyvatel, bez důvodu k zařazení; Piráti 2022: bez pirátské kandidátky |
| **Moravské Budějovice** | 591181 | 7 079 | b | 7 079 obyvatel, bez důvodu k zařazení; Piráti 2022: bez pirátské kandidátky |
| **Slavkov u Brna** | 593583 | 7 294 | b | 7 294 obyvatel, bez důvodu k zařazení; Piráti 2022: bez pirátské kandidátky |
| **Šlapanice** | 583952 | 7 940 | b | 7 940 obyvatel, bez důvodu k zařazení; Piráti 2022: bez pirátské kandidátky |
| **Tišnov** | 584002 | 9 270 | b | 9 270 obyvatel, bez důvodu k zařazení; Piráti 2022: bez pirátské kandidátky |

### 4. Těsně pod hranicí 7 000 podle registru 2026, ale nad ní podle ČSÚ 2025

U těchto měst Piráti kandidují (typ a nebo b). Registr voleb 2026 uvádí méně než 7 000 obyvatel, tabulka ČSÚ k 1. 1. 2025 už 7 000 a víc. Zařazení rozhoduje registr 2026, proto tato města **nejsou zveřejněna**. **Otázka: zařadit některé?** U města pod 7 000 obyvatel to jde jen přes `include: true` (samotný `borderlineReason` by nestačil). Hotový zápis do `towns: { … }`:

| Město | Kód obce | Obyvatel (2026 / 2025) | Typ | Kandidátka | Výsledek 2022 |
|---|---|---|---|---|---|
| **Broumov** | 573922 | 6 998 / 7 108 | b | č. 3 Mladý Broumov | Piráti 2022: 25,3 %, 6 mand. |
| **Napajedla** | 585513 | 6 981 / 7 043 | b | č. 4 Napajedla pro život | Piráti 2022: 12,0 %, 2 mand. |

```js
    '573922': { name: 'Broumov', include: true, reason: 'Piráti 2022: 25,3 %, 6 mand.; 7 108 obyvatel k 1. 1. 2025' },
    '585513': { name: 'Napajedla', include: true, reason: 'Piráti 2022: 12,0 %, 2 mand.; 7 043 obyvatel k 1. 1. 2025' },
```

### 5. Spočítáno, ale není na vašem seznamu (už zveřejněno)

Město splňuje pravidla (aspoň 10 000 obyvatel, Piráti na kandidátce), i když ho váš seznam nemá. **Otázka: ponechat?** Ne = `include: false` s důvodem (příklad 2).

| Město | Kód obce | Obyvatel | Typ | Kandidátka |
|---|---|---|---|---|
| **Klatovy** | 555771 | 22 921 | b | č. 4 KLATOVY21 |
| **Veselí nad Moravou** | 586722 | 10 574 | b | č. 2 ZA NAŠE VESELÍ |
| **Český Těšín** | 598933 | 22 870 | b | č. 2 TĚŠÍN 2.0 |

### 6. Města z vašeho seznamu, která jsme zamítli (15)

**Otázka: souhlasíte?** Pokud některé chcete mít přesto, použijte `include: true` (příklad 3). Typ c/d se pak zobrazí s vysvětlením „Piráti tu nekandidují“ / „jen na cizích kandidátkách“.

| Město | Kód obce | Obyvatel | Důvod zamítnutí |
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
| **Dvůr Králové nad Labem** | 579203 | 15 316 | Vyřazeno ručně: Piráti tu na kandidátce nemají žádného člena (jen nominované nečleny) |
| **Náchod** | 573868 | 19 649 | Vyřazeno ručně: Piráti tu na kandidátce nemají žádného člena (jen nominované nečleny) |
| **Trutnov** | 579025 | 29 337 | typ c: Piráti tu jsou jen na kandidátkách jiných stran; 29 337 obyvatel |
| **Holešov** | 588458 | 11 544 | Vyřazeno ručně: Piráti tu na kandidátce nemají žádného člena (jen nominované nečleny) |
| **Havířov** | 555088 | 67 998 | typ d: Piráti tu nekandidují (podle registru ČSÚ); 67 998 obyvatel |

Mimo soubor vašeho seznamu, zmíněno vámi: **Litovel** – typ d: Piráti tu nekandidují (podle registru ČSÚ); 9 448 obyvatel; Litovel je senátní obvod 66 (volby 2026); případná pirátská vazba patří do Senátu, ne do tohoto produktu; není na vašem seznamu, uvedli jste ho jako příklad.

### 7. Zobrazit nominované nečleny?

V těchto městech je kandidátka označená jako pirátská (koalice nebo sdružení s Piráty), ale **z Pirátů jsou na ní jen lidé, které Piráti navrhli, ale nejsou členy**. Sama kandidátka je přesto stále označená jako pirátská. Dnes se na webu jako „kandidáti Pirátů“ zobrazují jen **členové**, takže u těchto měst nebude uveden nikdo. **Otázka: Zobrazit nominované nečleny?** (Obecně: ve všech zveřejněných městech je 517 nominovaných nečlenů v 51 městech.)

_Žádné město._

### 8. Zveřejněná města, u kterých se zdroje rozcházejí (skrytá)

Kontrola jmenným seznamem ČSÚ, počtem obyvatel 2025, více pirátskými kandidátkami a neznámým partnerem.

_U žádného zveřejněného města se zdroje nerozcházejí._ Otevřená zůstává skupina 4 výše (města těsně pod hranicí 7 000).

## Zdroje a kontroly

- Stav dat: soubory v cache k 2026-10-10T10:52:37.735Z (UTC). Vše vzniká automaticky příkazem `node scripts/mesta-registry.js`, ručně se neupravuje.
- ČSÚ registr kandidátů KV 2026 (kvrzcoco, kvros, kvrk): https://volby.gov.cz/opendata/kv2026/KV2026reg20261007_csv.zip (čas souboru v cache 2026-10-10T10:42:00.274Z, sha256 `0b3ff9b0bfb9f30e…`)
- ČSÚ číselníky KV 2026 (cvs, cns, cnumnuts): https://volby.gov.cz/opendata/kv2026/KV2026ciselniky20261007_csv.zip (čas souboru v cache 2026-10-10T10:42:00.275Z, sha256 `f221c13ad3f8e604…`)
- ČSÚ registr a výsledky KV 2022 (kvros): https://volby.gov.cz/opendata/kv2022/KV2022reg20260328_csv.zip (čas souboru v cache 2026-10-10T10:42:00.279Z, sha256 `de398056124f234f…`)
- ČSÚ senátní obvody 2026 (obvody.json): https://volby.gov.cz/appdata/senat/20261009/navig/obvody.json (čas souboru v cache 2026-10-10T10:42:00.280Z, sha256 `777b8c7eafea008c…`)
- ČSÚ Počet obyvatel v obcích k 1. 1. 2025 (13007225_data.zip): https://csu.gov.cz/docs/107508/31d73e49-141b-ecbc-3bcc-4089cac638c3/13007225_data.zip?version=1.1 (čas souboru v cache 2026-10-10T10:52:37.735Z, sha256 `2cef401562d24036…`)
- Počty obyvatel k 1. 1. 2025 (kontrola pásma): načteno z tabulky ČSÚ
- Kontrola jmenným seznamem kandidátů (jmsez): 78 měst

## Tabulka všech měst

Nejdřív zveřejněná města (podle kraje a abecedy), na konci města z vašeho seznamu, která jsme vyřadili. Členy Pirátů registr ČSÚ vede u kandidáta; **příznivci bez členství se z dat poznat nedají** – ty byste doplnili v `overrides.js` (`pirateCandidates`).

| kraj | město | zařazení<br><sub>inclusion</sub> | důvod zařazení<br><sub>borderline_reason</sub> | obyvatel (2026 / 2025) | typ | č. | název kandidátky | druh | partneři | členové Pirátů na kandidátce | Piráti na jiných kandidátkách | kódy v registru ČSÚ<br><sub>KODZASTUP / OKRES / VSTRANA / SLOZENI</sub> | poznámky generátoru<br><sub>flags</sub> | jistota<br><sub>confidence</sub> |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Středočeský kraj | Benešov | zařazeno automaticky | – | 17 025 / 17 043 | b | 3 | Piráti s podporou lidovců pro Benešov | sdružení | KDU-ČSL, NK | 5 (Petr Chaluš, Magdaléna Machová, Nikola Elšíková Franková, +2) · nominovaných nečlenů: 14 | – | 529303 / 2101 / 571 / 001,080,720 | jméno má víc obcí, vybráno město | vysoká |
| Středočeský kraj | Brandýs nad Labem-Stará Boleslav | zařazeno automaticky | – | 20 926 / 20 313 | b | 5 | Piráti a Nezávislí | sdružení | NK | 2 (Patrick Zandl, Jan Prokop) | – | 538094 / 2109 / 541 / 080,720 | název z vašeho seznamu upraven (pomlčka) | vysoká |
| Středočeský kraj | Čelákovice | zařazeno automaticky | – | 12 507 / 12 474 | b | 3 | SPOLEČNĚ pro Čelákovice | koalice | KDU-ČSL, TOP 09 | 1 (Petr Petřík) · nominovaných nečlenů: 6 | – | 538132 / 2109 / 1577 / 001,720,721 | – | vysoká |
| Středočeský kraj | Kladno | zařazeno automaticky | – | 69 728 / 69 664 | b | 8 | KLADEŇÁCI | sdružení | KDU-ČSL, Zelení, STAN, NK | 4 (Martin Kodera, Michal Hažlinský, Barbora Částová, +1) · nominovaných nečlenů: 5 | – | 532053 / 2103 / 1696 / 001,005,080,166,720 | jméno má víc obcí, vybráno město | vysoká |
| Středočeský kraj | Kolín | zařazeno automaticky | – | 33 392 / 33 444 | a | 6 | Česká pirátská strana | strana | – | 2 (Svatopluk Boček, Jiří Snížek) · nominovaných nečlenů: 9 | – | 533165 / 2104 / 720 / 720 | – | vysoká |
| Středočeský kraj | Kutná Hora | zařazeno automaticky | – | 21 787 / 21 642 | b | 2 | LIPISTAN - LIDOVCI, PIRÁTI, STAROSTOVÉ, NEZÁVISLÍ | sdružení | KDU-ČSL, STAN, NK | 4 (Milan Zelený, Vít Šnajdr, Robin Jiráň, +1) · nominovaných nečlenů: 4 | – | 533955 / 2105 / 1833 / 001,080,166,720 | – | vysoká |
| Středočeský kraj | Mladá Boleslav | zařazeno automaticky | – | 47 874 / 47 346 | b | 4 | Šance pro Mladou Boleslav | sdružení | KDU-ČSL, Zelení, NK | 1 (Michal Javůrek) · nominovaných nečlenů: 6 | – | 535419 / 2107 / 1370 / 001,005,080,720 | – | vysoká |
| Středočeský kraj | Příbram | zařazeno automaticky | – | 32 917 / 32 773 | b | 1 | Příbram zdola - sdružení Pirátů, Zelených a nezávislých kandidátů | sdružení | Zelení, NK | 3 (Simona Luftová, Antonín Schejbal, Jiří Kotlan) · nominovaných nečlenů: 4 | – | 539911 / 2111 / 529 / 005,080,720 | – | vysoká |
| Středočeský kraj | Říčany | zařazeno automaticky | – | 17 314 / 17 143 | b | 4 | Piráti se Zelení a nestranní | sdružení | Zelení, NK | 3 (Aleš Chán, Libor Dušek, Vojtěch Mihulka) · nominovaných nečlenů: 6 | – | 538728 / 2109 / 529 / 005,080,720 | jméno má víc obcí, vybráno město | vysoká |
| Středočeský kraj | Vlašim | zařazeno automaticky | – | 11 329 / 11 434 | b | 6 | Piráti pro Vlašim | sdružení | NK | 3 (Petr Švingr, Lukáš Pacholík, Jan Brabenec) | – | 530883 / 2101 / 541 / 080,720 | – | vysoká |
| Jihočeský kraj | České Budějovice | zařazeno automaticky | – | 97 128 / 97 231 | b | 6 | Piráti a Budějčáci s podporou Zelených | koalice | Zelení | 11 (Pavel Tůma, Pavla Heyduková, Erik Ferchenbauer, +8) · nominovaných nečlenů: 25 | – | 544256 / 3101 / 1066 / 005,720 | – | vysoká |
| Jihočeský kraj | Jindřichův Hradec | zařazeno automaticky | – | 20 369 / 20 540 | b | 1 | Společně s Piráty | sdružení | NK | 1 (Václav Urban) · nominovaných nečlenů: 4 | – | 545881 / 3103 / 541 / 080,720 | – | vysoká |
| Jihočeský kraj | Písek | zařazeno automaticky | – | 31 002 / 31 121 | a | 6 | Česká pirátská strana | strana | – | 6 (Josef Soumar, Tomáš Posekaný, Petr Soušek, +3) · nominovaných nečlenů: 21 | – | 549240 / 3104 / 720 / 720 | jméno má víc obcí, vybráno město | vysoká |
| Jihočeský kraj | Prachatice | zařazeno automaticky | – | 11 036 / 11 119 | b | 7 | Živé Prachatice | sdružení | Zelení, STAN, NK | 1 (Barbora Koritenská) | – | 550094 / 3105 / 562 / 005,080,166,720 | – | vysoká |
| Jihočeský kraj | Tábor | zařazeno automaticky | – | 34 339 / 34 356 | b | 7 | Živý Tábor | sdružení | Zelení, NK | 5 (Martin Mareda, Jan Příbramský, Václav Klecanda, +2) · nominovaných nečlenů: 4 | – | 552046 / 3107 / 529 / 005,080,720 | – | vysoká |
| Plzeňský kraj | Domažlice | zařazeno automaticky | – | 10 973 / 11 133 | a | 5 | Česká pirátská strana | strana | – | 5 (Jan Pachl, Jan Kincler, Jan Soldán, +2) · nominovaných nečlenů: 16 | – | 553425 / 3201 / 720 / 720 | – | vysoká |
| Plzeňský kraj | Klatovy | zařazeno automaticky; spočteno, není na vašem seznamu | – | 22 921 / 22 763 | b | 4 | KLATOVY21 | sdružení | KDU-ČSL, NK | 1 (Stanislav Haviar) | – | 555771 / 3202 / 571 / 001,080,720 | – | vysoká |
| Plzeňský kraj | Plzeň | zařazeno automaticky | – | 187 863 / 187 928 | a | 11 | Česká pirátská strana | strana | – | 38 (Pavel Bosák, Marek Habruň, Vanessa Evelynn, +35) · nominovaných nečlenů: 9 | – | 554791 / 3203 / 720 / 720 | – | vysoká |
| Plzeňský kraj | Rokycany | zařazeno automaticky | – | 14 248 / 14 381 | b | 1 | Naše Rokycany | sdružení | NK | 1 (Jakub Frühauf) | – | 559717 / 3206 / 541 / 080,720 | – | vysoká |
| Plzeňský kraj | Sušice | zařazeno automaticky | – | 10 689 / 10 740 | a | 4 | Česká pirátská strana | strana | – | 3 (Jan Janda, Lucie Mikulová, Věra Mikušová) · nominovaných nečlenů: 16 | – | 557153 / 3202 / 720 / 720 | jméno má víc obcí, vybráno město | vysoká |
| Karlovarský kraj | Cheb | zařazeno automaticky | – | 32 892 / 32 808 | b | 6 | Koalice pro Cheb | sdružení | KDU-ČSL, Zelení, TOP 09, NK | 2 (Ladislav Tkaczyszyn, Barbora Kaprálová) · nominovaných nečlenů: 2 | – | 554481 / 4101 / 1523 / 001,005,080,720,721 | – | vysoká |
| Karlovarský kraj | Karlovy Vary | zařazeno automaticky | – | 48 788 / 49 073 | b | 4 | VARY+ | koalice | KDU-ČSL, KOA, TOP 09 | 4 (Jindřich Čermák, Bohdan Vaněk, Karel Špecián, +1) · nominovaných nečlenů: 5 | – | 554961 / 4102 / 1961 / 001,182,720,721 | – | vysoká |
| Karlovarský kraj | Mariánské Lázně | zařazeno automaticky | – | 13 921 / 14 052 | b | 9 | Za lepší Mariánské Lázně | sdružení | NK | 6 (Vojtěch Franta, Josef Pavlovic, Žaneta Pivcová, +3) | – | 554642 / 4101 / 541 / 080,720 | – | vysoká |
| Ústecký kraj | Bílina | zařazeno automaticky | – | 14 401 / 14 497 | b | 10 | MOJE BÍLINA s podporou Pirátů | sdružení | TOP 09, NK | 1 (Antonín Budaj) | – | 567451 / 4206 / 1331 / 080,720,721 | – | vysoká |
| Ústecký kraj | Děčín | zařazeno automaticky | – | 46 003 / 46 376 | b | 2 | HLAS DĚČÍNA (Piráti Děčín + Hlas regionů) | koalice | HR | 4 (Martin Strnad, Petr Andráš, Jan Maixner, +1) · nominovaných nečlenů: 21 | – | 562335 / 4201 / 1930 / 720,1715 | – | vysoká |
| Ústecký kraj | Chomutov | zařazeno automaticky | – | 46 560 / 46 771 | b | 5 | JsmePRO! Chomutov | sdružení | KDU-ČSL, Zelení, TOP 09, JsmePRO!, NK | 1 (František Kindl) | – | 562971 / 4202 / 1825 / 001,005,080,720,721,1126 | – | vysoká |
| Ústecký kraj | Kadaň | zařazeno automaticky | – | 18 088 / 18 090 | b | 3 | Spojení pro změnu | sdružení | NK | 3 (Jana Hladová, Hana Vodrážková, Jiří Kopica) · nominovaných nečlenů: 3 | – | 563102 / 4202 / 541 / 080,720 | – | vysoká |
| Ústecký kraj | Litvínov | zařazeno automaticky | – | 22 258 / 22 387 | b | 2 | Litvínov DO TOHO! | sdružení | Zelení, NK | 2 (Filip Marko, Matyáš Šimon Tvrzník) | – | 567256 / 4205 / 529 / 005,080,720 | – | vysoká |
| Ústecký kraj | Louny | zařazeno automaticky | – | 18 061 / 18 068 | b | 5 | LOUNY SPOLEČNĚ: Piráti, Zelení, nezávislí | sdružení | Zelení, NK | 3 (Pavel Nadolecki, Radek Miličevič, Petr Felix Šťastný) · nominovaných nečlenů: 5 | – | 565971 / 4204 / 529 / 005,080,720 | – | vysoká |
| Ústecký kraj | Most | zařazeno automaticky | – | 63 160 / 63 474 | b | 6 | Piráti, Zelení a Starostové | koalice | Zelení, STAN | 1 (Jakub Zlata) · nominovaných nečlenů: 9 | – | 567027 / 4205 / 1894 / 005,166,720 | – | vysoká |
| Ústecký kraj | Roudnice nad Labem | zařazeno automaticky | – | 12 561 / 12 668 | b | 6 | Tým Roudnice | sdružení | NK | 2 (Miroslav Hrstka, Milan Majerčík) | – | 565555 / 4203 / 541 / 080,720 | – | vysoká |
| Ústecký kraj | Teplice | zařazeno automaticky | – | 50 856 / 50 912 | b | 9 | Volba pro Teplice | sdružení | KDU-ČSL, Zelení, NK | 1 (Martin Sobek) · nominovaných nečlenů: 1 | – | 567442 / 4206 / 1370 / 001,005,080,720 | – | vysoká |
| Ústecký kraj | Ústí nad Labem | zařazeno automaticky | – | 90 035 / 90 866 | b | 5 | JEDNO ÚSTÍ | sdružení | Zelení, STAN, TOP 09, UFO, NČ, NK | 4 (Jiří Baudis, Vladimír Kozák, Lukáš Blažej Chorovský, +1) | – | 554804 / 4207 / 1933 / 005,080,166,720,721,1012,1722 | – | vysoká |
| Ústecký kraj | Varnsdorf | zařazeno automaticky | – | 14 645 / 14 704 | b | 6 | NÁŠ VARNSDORF | sdružení | STAN, NK | 1 (Zdeněk Štěpánek) | – | 562882 / 4201 / 1483 / 080,166,720 | – | vysoká |
| Ústecký kraj | Žatec | zařazeno automaticky | – | 18 984 / 18 959 | b | 5 | Piráti a nezávislí pro Žatec | sdružení | NK | 6 (Tobiáš Bartoš, Vladimír Vlach, Marta Koutecká Kalousová, +3) · nominovaných nečlenů: 9 | – | 566985 / 4204 / 541 / 080,720 | jméno má víc obcí, vybráno město | vysoká |
| Liberecký kraj | Česká Lípa | zařazeno automaticky | – | 36 364 / 36 815 | b | 8 | Piráti a Zelení | koalice | Zelení | 3 (Ondřej Víteček, Kateřina Halamová, Stanislav Martyčák) · nominovaných nečlenů: 10 | – | 561380 / 5101 / 1066 / 005,720 | – | vysoká |
| Liberecký kraj | Jablonec nad Nisou | zařazeno automaticky | – | 46 206 / 46 209 | b | 4 | Piráti a nezávislí | sdružení | NK | 10 (Jaroslav Šída, Kateřina Žáková, Veronika Drápalíková, +7) · nominovaných nečlenů: 5 | – | 563510 / 5102 / 541 / 080,720 | – | vysoká |
| Liberecký kraj | Liberec | zařazeno automaticky | – | 108 214 / 108 090 | b | 6 | Liberec otevřený lidem a Piráti | koalice | Zelení | 12 (Jan Hruška, Jiřina Macháčková, Petr Slanina, +9) · nominovaných nečlenů: 3 | – | 563889 / 5103 / 1066 / 005,720 | – | vysoká |
| Liberecký kraj | Turnov | zařazeno automaticky | – | 14 607 / 14 577 | a | 2 | Česká pirátská strana | strana | – | 3 (Vratislav Slavík, Daniel Havlík, František Poslušný) · nominovaných nečlenů: 24 | – | 577626 / 5104 / 720 / 720 | – | vysoká |
| Královéhradecký kraj | Hradec Králové | zařazeno automaticky | – | 93 534 / 94 311 | b | 4 | PIRÁTI a STAROSTOVÉ | koalice | STAN | 11 (Kamil Kubica, Aleš Dohnal, Vít Luštinec, +8) · nominovaných nečlenů: 8 | – | 569810 / 5201 / 1350 / 166,720 | – | vysoká |
| Královéhradecký kraj | Jaroměř | zařazeno automaticky | – | 12 487 / 12 483 | b | 6 | Nová vlna pro Jaroměř | sdružení | Zelení, NK | 1 (Marek Picek) | – | 574121 / 5203 / 529 / 005,080,720 | – | vysoká |
| Královéhradecký kraj | Jičín | zařazeno automaticky | – | 16 052 / 16 101 | b | 9 | JIČÍN SRDCEM s podporou Pirátů | sdružení | NK | 1 (Jan Ent) | – | 572659 / 5202 / 541 / 080,720 | kraj se liší od vašeho seznamu | vysoká |
| Královéhradecký kraj | Rychnov nad Kněžnou | zařazeno automaticky | – | 11 693 / 11 420 | b | 3 | PROSTOR 516 01 s podporou Pirátů a Starostů | sdružení | STAN, NK | 1 (Věra Králová) | – | 576069 / 5204 / 1483 / 080,166,720 | – | vysoká |
| Pardubický kraj | Česká Třebová | zařazeno automaticky | – | 14 982 / 15 010 | b | 2 | Stateční & Piráti | sdružení | TOP 09, NK | 4 (Jiří Ducháček, Martin Saifrt, Martin Herman, +1) | – | 580031 / 5304 / 1331 / 080,720,721 | – | vysoká |
| Pardubický kraj | Chrudim | zařazeno automaticky | – | 23 562 / 23 564 | b | 7 | Lidi z Chrudimi - Piráti a nezávislí | sdružení | NK | 7 (Daniel Lebduška, Ivo Diblík, Jiří Blažek, +4) · nominovaných nečlenů: 19 | – | 571164 / 5301 / 541 / 080,720 | – | vysoká |
| Pardubický kraj | Pardubice | zařazeno automaticky | – | 92 713 / 92 319 | b | 3 | Progresivní Pardubice (Piráti a TOP 09 s podporou Zelených a nezávislých osobností) | koalice | TOP 09 | 11 (Stanislav Klát, Žaneta Havlenová, Vojtěch Jirsa, +8) · nominovaných nečlenů: 12 | – | 555134 / 5302 / 1897 / 720,721 | – | vysoká |
| Kraj Vysočina | Havlíčkův Brod | zařazeno automaticky | – | 23 368 / 23 791 | a | 7 | Česká pirátská strana | strana | – | 5 (Petr Vozáb, Jan Pošvář, Jiří Svoboda, +2) · nominovaných nečlenů: 20 | – | 568414 / 6101 / 720 / 720 | – | vysoká |
| Kraj Vysočina | Humpolec | zařazeno automaticky | – | 11 487 / 11 522 | a | 6 | Česká pirátská strana | strana | – | 1 (Martin Hendrych) · nominovaných nečlenů: 20 | – | 547999 / 6103 / 720 / 720 | – | vysoká |
| Kraj Vysočina | Jihlava | zařazeno automaticky | – | 53 686 / 54 624 | b | 1 | Piráti a Fórum Jihlava s podporou Zelených | sdružení | Zelení, NK | 8 (Daniel Škarka, Tereza Kafková, Vít Žáček, +5) · nominovaných nečlenů: 10 | – | 586846 / 6102 / 529 / 005,080,720 | – | vysoká |
| Kraj Vysočina | Nové Město na Moravě | zařazeno podle úsudku | na vašem seznamu; Piráti 2022: 6,7 %, 1 mand. | 9 716 / 9 834 | b | 5 | Piráti a nezávislí | sdružení | NK | 3 (Tomáš Blažek, Šimon Mareček, René Mayer) | – | 596230 / 6105 / 541 / 080,720 | – | vysoká |
| Kraj Vysočina | Pelhřimov | zařazeno automaticky | – | 16 233 / 16 206 | a | 7 | Česká pirátská strana | strana | – | 6 (Pavel Knežik, Zdeňka Lišková, Tomáš Bitman, +3) · nominovaných nečlenů: 15 | – | 547492 / 6103 / 720 / 720 | – | vysoká |
| Kraj Vysočina | Třebíč | zařazeno automaticky | – | 34 476 / 34 530 | b | 7 | Piráti - Břehy - Zelení | sdružení | Zelení, NK | 4 (Aleš Novák, Adam Urban, Anna Kohoutová, +1) · nominovaných nečlenů: 9 | – | 590266 / 6104 / 529 / 005,080,720 | – | vysoká |
| Jihomoravský kraj | Blansko | zařazeno automaticky | – | 19 900 / 20 002 | a | 1 | Česká pirátská strana | strana | – | 6 (Ondřej Haváč, Žaneta Němcová, Zbyněk Pokorný, +3) · nominovaných nečlenů: 19 | – | 581283 / 6201 / 720 / 720 | – | vysoká |
| Jihomoravský kraj | Brno | zařazeno automaticky | – | 404 296 / 402 739 | b | 15 | Piráti a Fakt Brno TU! | koalice | Idealisté, Fakt Brno, GEN | 22 (Adam Zemek, Jitka Bidlová, Marek Lahoda, +19) · nominovaných nečlenů: 5 | – | 582786 / 6202 / 1870 / 720,1233,1246,1297 | – | vysoká |
| Jihomoravský kraj | Břeclav | zařazeno automaticky | – | 24 583 / 24 538 | b | 1 | MLADÍ A NEKLIDNÍ BŘECLAV | sdružení | STAN, NK | 6 (Petr Vlasák, Petr Holobrádek, Jan Marek, +3) · nominovaných nečlenů: 2 | – | 584291 / 6204 / 1483 / 080,166,720 | – | vysoká |
| Jihomoravský kraj | Mikulov | zařazeno podle úsudku; spočteno, není na vašem seznamu | Piráti 2022: 8,4 %, 2 mand. | 7 552 / 7 577 | b | 2 | Piráti Mikulov | sdružení | NK | 2 (Ivo Hrdlička, Josef Bárta) | – | 584649 / 6204 / 541 / 080,720 | hraniční, zařazeno jen automaticky | nízká (skryto) |
| Jihomoravský kraj | Veselí nad Moravou | zařazeno automaticky; spočteno, není na vašem seznamu | – | 10 574 / 10 623 | b | 2 | ZA NAŠE VESELÍ | sdružení | NK | 1 (Lukáš Habarta) | – | 586722 / 6205 / 541 / 080,720 | – | vysoká |
| Jihomoravský kraj | Znojmo | zařazeno automaticky | – | 33 989 / 34 172 | b | 7 | ZNOJMO JSI TY! | sdružení | NK | 4 (Pavel Nevrkla, Petr Ilgner, Karolína Trojanová, +1) · nominovaných nečlenů: 3 | – | 593711 / 6207 / 541 / 080,720 | – | vysoká |
| Olomoucký kraj | Olomouc | zařazeno automaticky | – | 105 297 / 103 063 | b | 9 | MILUJEME OLOMOUC - Piráti, TOP 09, Zelení | koalice | Zelení, TOP 09 | 9 (Zdeněk Žák, Michal Langer, Vlastimil Bednařík, +6) · nominovaných nečlenů: 13 | – | 500496 / 7102 / 1369 / 005,720,721 | – | vysoká |
| Olomoucký kraj | Prostějov | zařazeno automaticky | – | 43 236 / 43 408 | b | 1 | Prostějov 2:0 | sdružení | NK | 11 (Jan Mochťák, Adéla Čečmanová, Petr Lysek, +8) | – | 589250 / 7103 / 541 / 080,720 | – | vysoká |
| Olomoucký kraj | Přerov | zařazeno automaticky | – | 40 492 / 40 906 | b | 2 | Změna pro Přerov | sdružení | STAN, NK | 12 (Petr Dostalík, Jaroslav Krejčí, David Hošek, +9) · nominovaných nečlenů: 5 | – | 511382 / 7104 / 1483 / 080,166,720 | – | vysoká |
| Olomoucký kraj | Uničov | zařazeno automaticky | – | 11 060 / 11 237 | b | 6 | Česká pirátská strana | sdružení | NK | 3 (Hana Koppová, Tomáš Fabrik, Jan Motal) · nominovaných nečlenů: 2 | – | 505587 / 7102 / 541 / 080,720 | jmenuje se „Česká pirátská strana“, ale je to sdružení | vysoká |
| Zlínský kraj | Kroměříž | zařazeno automaticky | – | 27 781 / 27 917 | b | 7 | První volba pro Kroměříž a místní části | sdružení | NK | 4 (Hana Ančincová, Jana Knapková, Marcela Válková, +1) · nominovaných nečlenů: 4 | – | 588296 / 7201 / 541 / 080,720 | – | vysoká |
| Zlínský kraj | Otrokovice | zařazeno automaticky | – | 17 239 / 17 401 | b | 1 | Občané OE s podporou Pirátů | sdružení | NK | 4 (Petr Ťopek, Pavel Beznoska, Michal Bartík, +1) | – | 585599 / 7204 / 541 / 080,720 | – | vysoká |
| Zlínský kraj | Rožnov pod Radhoštěm | zařazeno automaticky | – | 15 916 / 16 063 | b | 4 | Zdravý Rožnov s podporou Pirátů | sdružení | NK | 2 (Libor Adámek, Marie Babincová) | – | 544841 / 7203 / 541 / 080,720 | – | vysoká |
| Zlínský kraj | Uherské Hradiště | zařazeno automaticky | – | 24 852 / 24 887 | b | 2 | TOŽ HRADIŠTĚ s podporou Pirátů | sdružení | NK | 3 (František Elfmark, Jaroslav Ševčík, Dušan Jurčík) · nominovaných nečlenů: 3 | – | 592005 / 7202 / 541 / 080,720 | – | vysoká |
| Zlínský kraj | Uherský Brod | zařazeno automaticky | – | 16 280 / 16 367 | b | 3 | Mladí Broďani - zlepsimebrod.cz | sdružení | NK | 3 (Štěpán Vráblík, Marek Houser, Petr Kroča) | – | 592731 / 7202 / 541 / 080,720 | – | vysoká |
| Zlínský kraj | Zlín | zařazeno automaticky | – | 74 917 / 74 684 | b | 5 | ZLÍN SRDCEM a Piráti | sdružení | ZS, NK | 7 (Jiří Jaroš, Václav Křapáček, Sandra Slobodian, +4) · nominovaných nečlenů: 1 | – | 585068 / 7204 / 1949 / 080,720,1751 | – | vysoká |
| Moravskoslezský kraj | Český Těšín | zařazeno automaticky; spočteno, není na vašem seznamu | – | 22 870 / 23 075 | b | 2 | TĚŠÍN 2.0 | sdružení | NK | 2 (Lubomír Lukšík, Vlastimil Petráš) | – | 598933 / 8103 / 541 / 080,720 | – | vysoká |
| Moravskoslezský kraj | Frýdek-Místek | zařazeno automaticky | – | 53 164 / 53 590 | a | 4 | Česká pirátská strana | strana | – | 5 (Michaela Davidová, Michaela Moricová, Martin Škapa, +2) · nominovaných nečlenů: 38 | – | 598003 / 8102 / 720 / 720 | – | vysoká |
| Moravskoslezský kraj | Hlučín | zařazeno automaticky | – | 13 245 / 13 352 | b | 7 | Hlučíňáci | sdružení | NK | 1 (Rostislav Matuška) | – | 507016 / 8105 / 541 / 080,720 | – | vysoká |
| Moravskoslezský kraj | Karviná | zařazeno automaticky | – | 48 684 / 48 937 | b | 4 | Srdcem pro Karvinou - koalice STAN, ODS, PIRÁTI a TOP 09 | koalice | ODS, STAN, TOP 09 | 3 (Marek Božoň, Michal Klus, Emil Adámek) · nominovaných nečlenů: 8 | – | 598917 / 8103 / 1912 / 053,166,720,721 | – | vysoká |
| Moravskoslezský kraj | Kopřivnice | zařazeno automaticky | – | 21 245 / 21 374 | b | 4 | Pro Zdraví a Piráti | koalice | PRO Zdraví | 2 (Tomáš Hof, Ladislav Stehlík) · nominovaných nečlenů: 8 | – | 599565 / 8104 / 1802 / 720,785 | – | vysoká |
| Moravskoslezský kraj | Nový Jičín | zařazeno automaticky | – | 22 740 / 23 005 | b | 5 | Zelení/Piráti/TOP 09/STAN | koalice | Zelení, STAN, TOP 09 | 4 (Andrej Droščín, Anna Himmerová, Jan Faluši, +1) · nominovaných nečlenů: 3 | – | 599191 / 8104 / 1351 / 005,166,720,721 | – | vysoká |
| Moravskoslezský kraj | Opava | zařazeno automaticky | – | 54 881 / 55 109 | b | 7 | VIZE PRO OPAVU | sdružení | TOP 09, NK | 5 (Pavel Kořízek, Hana Brňáková, Martin Rell, +2) | – | 505927 / 8105 / 1331 / 080,720,721 | – | vysoká |
| Moravskoslezský kraj | Orlová | zařazeno automaticky | – | 27 383 / 27 540 | b | 9 | Sousedi Orlová | sdružení | ODS, NK | 2 (Miroslav Sedláček, Lukáš Neri) · nominovaných nečlenů: 12 | – | 599069 / 8103 / 1821 / 053,080,720 | – | vysoká |
| Moravskoslezský kraj | Ostrava | zařazeno automaticky | – | 280 853 / 283 187 | a | 12 | Česká pirátská strana | strana | – | 23 (Rostislav Řeha, Martina Dušková, Jakub Vontroba, +20) · nominovaných nečlenů: 32 | – | 554821 / 8106 / 720 / 720 | – | vysoká |
| Moravskoslezský kraj | Rychvald | zařazeno podle úsudku; spočteno, není na vašem seznamu | Piráti 2022: 11,7 %, 2 mand. | 7 823 / 7 787 | b | 2 | „Opozice 26“ | koalice | ODS, TOP 09 | 1 (Eliška Polochová) | – | 599107 / 8103 / 1820 / 053,720,721 | hraniční, zařazeno jen automaticky | nízká (skryto) |
| Středočeský kraj | Kralupy nad Vltavou | vyřazeno: typ d: Piráti tu nekandidují (podle registru ČSÚ); 19 138 obyvatel | – | 19 138 / 19 005 | d | – | – | – | – | 0 | – | 534951 / 2106 | – | – |
| Středočeský kraj | Mělník | vyřazeno: typ c: Piráti tu jsou jen na kandidátkách jiných stran; 20 301 obyvatel | – | 20 301 / 20 278 | c | – | – | – | – | 0 | 1: Oliver Krejza (č. 6/7, navrhl NK) | 534676 / 2106 | – | – |
| Středočeský kraj | Neratovice | vyřazeno: typ d: Piráti tu nekandidují (podle registru ČSÚ); 16 279 obyvatel | – | 16 279 / 16 360 | d | – | – | – | – | 0 | – | 535087 / 2106 | – | – |
| Středočeský kraj | Roztoky | vyřazeno: typ d: Piráti tu nekandidují (podle registru ČSÚ); 9 147 obyvatel | – | 9 147 / 9 088 | d | – | – | – | – | 0 | – | 539627 / 2110 | jméno má víc obcí, vybráno město | – |
| Středočeský kraj | Slaný | vyřazeno: typ c: Piráti tu jsou jen na kandidátkách jiných stran; 17 247 obyvatel | – | 17 247 / 16 937 | c | – | – | – | – | 0 | 2: Vendula Kučerová (č. 10/5, navrhl NK); Petr Číhal (č. 10/21, navrhl NK) | 532819 / 2103 | – | – |
| Karlovarský kraj | Ostrov | vyřazeno: typ c: Piráti tu jsou jen na kandidátkách jiných stran; 15 615 obyvatel | – | 15 615 / 15 681 | c | – | – | – | – | 0 | 1: Tomáš Sedlmajer (č. 3/5, navrhl NK) | 555428 / 4102 | jméno má víc obcí, vybráno město | – |
| Karlovarský kraj | Sokolov | vyřazeno: typ c: Piráti tu jsou jen na kandidátkách jiných stran; 21 908 obyvatel | – | 21 908 / 22 007 | c | – | – | – | – | 0 | 4: Lukáš Zykán (č. 7/5, navrhl STAN); Tereza Zykánová (č. 7/12, navrhl STAN); Petra Zámečníková (č. 7/18, navrhl STAN); +1 | 560286 / 4103 | – | – |
| Ústecký kraj | Jirkov | vyřazeno: typ c: Piráti tu jsou jen na kandidátkách jiných stran; 19 067 obyvatel | – | 19 067 / 19 240 | c | – | – | – | – | 0 | 1: Milan Buresch (č. 8/8, navrhl NK) | 563099 / 4202 | – | – |
| Ústecký kraj | Krupka | vyřazeno: typ c: Piráti tu jsou jen na kandidátkách jiných stran; 12 731 obyvatel | – | 12 731 / 12 793 | c | – | – | – | – | 0 | 1: Petr Duda (č. 7/7, navrhl NK) | 567639 / 4206 | – | – |
| Ústecký kraj | Litoměřice | vyřazeno: typ c: Piráti tu jsou jen na kandidátkách jiných stran; 22 627 obyvatel | – | 22 627 / 22 767 | c | – | – | – | – | 0 | 1: Jiří Rotter (č. 9/20, navrhl SEN 21) | 564567 / 4203 | – | – |
| Královéhradecký kraj | Dvůr Králové nad Labem | vyřazeno: Vyřazeno ručně: Piráti tu na kandidátce nemají žádného člena (jen nominované nečleny) | – | 15 316 / 15 322 | b | 1 | Klíč ke Dvoru | sdružení | KDU-ČSL, Zelení, NK | 0 (nominovaných nečlenů: 2) | – | 579203 / 5205 / 1370 / 001,005,080,720 | na pirátské kandidátce není žádný člen Pirátů | – |
| Královéhradecký kraj | Náchod | vyřazeno: Vyřazeno ručně: Piráti tu na kandidátce nemají žádného člena (jen nominované nečleny) | – | 19 649 / 19 827 | b | 5 | SOUSEDÉ za lepší Náchod | sdružení | KDU-ČSL, Zelení, TOP 09, NK | 0 (nominovaných nečlenů: 2) | – | 573868 / 5203 / 1523 / 001,005,080,720,721 | na pirátské kandidátce není žádný člen Pirátů | – |
| Královéhradecký kraj | Trutnov | vyřazeno: typ c: Piráti tu jsou jen na kandidátkách jiných stran; 29 337 obyvatel | – | 29 337 / 29 607 | c | – | – | – | – | 0 | 1: Pavel Volk (č. 3/5, navrhl NK) | 579025 / 5205 | – | – |
| Zlínský kraj | Holešov | vyřazeno: Vyřazeno ručně: Piráti tu na kandidátce nemají žádného člena (jen nominované nečleny) | – | 11 544 / 11 616 | b | 2 | AKCE Holešovských Občanů | sdružení | TOP 09, NK | 0 (nominovaných nečlenů: 1) | – | 588458 / 7201 / 1331 / 080,720,721 | na pirátské kandidátce není žádný člen Pirátů | – |
| Moravskoslezský kraj | Havířov | vyřazeno: typ d: Piráti tu nekandidují (podle registru ČSÚ); 67 998 obyvatel | – | 67 998 / 68 674 | d | – | – | – | – | 0 | – | 555088 / 8103 | – | – |
