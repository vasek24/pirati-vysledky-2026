# Ověření seznamu měst majitele

Seznam majitele (`docs/analysis/mesta-towns.txt`) se **nepovažuje za ověřený**: každé jméno se spáruje s radnicí v registru ČSÚ podle KODZASTUP a pak se pravidly (spec §4.1) rozhodne, zda město zveřejnit. Tři tabulky níže dohromady dávají všechna jména ze seznamu a všechna města navíc. Sloupec **borderline_reason** vyplněný = hraniční město (7 000–9 999 obyvatel), zařazené z uvedeného důvodu.

- Čas stažení zdrojů: 2026-10-10T10:52:37.735Z (UTC). Generátor: `node scripts/mesta-registry.js` (výstup je deterministický, ručně se neupravuje).
- ČSÚ registr kandidátů KV 2026 (kvrzcoco, kvros, kvrk): https://volby.gov.cz/opendata/kv2026/KV2026reg20261007_csv.zip (stažení 2026-10-10T10:42:00.274Z, sha256 `0b3ff9b0bfb9f30e…`)
- ČSÚ číselníky KV 2026 (cvs, cns, cnumnuts): https://volby.gov.cz/opendata/kv2026/KV2026ciselniky20261007_csv.zip (stažení 2026-10-10T10:42:00.275Z, sha256 `f221c13ad3f8e604…`)
- ČSÚ registr a výsledky KV 2022 (kvros): https://volby.gov.cz/opendata/kv2022/KV2022reg20260328_csv.zip (stažení 2026-10-10T10:42:00.279Z, sha256 `de398056124f234f…`)
- ČSÚ senátní obvody 2026 (obvody.json): https://volby.gov.cz/appdata/senat/20261009/navig/obvody.json (stažení 2026-10-10T10:42:00.280Z, sha256 `777b8c7eafea008c…`)
- ČSÚ Počet obyvatel v obcích k 1. 1. 2025 (13007225_data.zip): https://csu.gov.cz/docs/107508/31d73e49-141b-ecbc-3bcc-4089cac638c3/13007225_data.zip?version=1.1 (stažení 2026-10-10T10:52:37.735Z, sha256 `2cef401562d24036…`)
- Počty obyvatel 2025 (kontrola pásma): načteno z tabulky ČSÚ
- Kontrola jmenným seznamem (jmsez): 81 měst

## Počty

- potvrzeno: 76
- zamítnuto ze seznamu majitele: 12
- na seznamu majitele celkem: 88 (soubor `docs/analysis/mesta-towns.txt` má 88 jmen: součet sedí)
- splňují pravidla, ale není na seznamu majitele: 5
- hraniční města zařazená (borderline_reason): 3 (Nové Město na Moravě, Mikulov, Rychvald)
- hraniční města bez důvodu, nezařazená: 6
- mimo soubor seznamu, zmíněno majitelem: Litovel – viz tabulka 2 (nepočítá se do 88)

## 1. Potvrzená města ze seznamu majitele (76)

| Kraj | Město | KODZASTUP | Obyvatel (2026 / 2025) | Typ | Zařazení | borderline_reason | Příznaky | Na seznamu majitele |
|---|---|---|---|---|---|---|---|---|
| Středočeský kraj | **Benešov** | 529303 | 17 025 / 17 043 | b | auto (≥ 10 000, typ a/b) | – | disambiguated-by-druh | ano |
| Středočeský kraj | **Brandýs nad Labem-Stará Boleslav** | 538094 | 20 926 / 20 313 | b | auto (≥ 10 000, typ a/b) | – | dash-normalized | ano |
| Středočeský kraj | **Čelákovice** | 538132 | 12 507 / 12 474 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Středočeský kraj | **Kladno** | 532053 | 69 728 / 69 664 | b | auto (≥ 10 000, typ a/b) | – | disambiguated-by-druh | ano |
| Středočeský kraj | **Kolín** | 533165 | 33 392 / 33 444 | a | auto (≥ 10 000, typ a/b) | – | – | ano |
| Středočeský kraj | **Kutná Hora** | 533955 | 21 787 / 21 642 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Středočeský kraj | **Mladá Boleslav** | 535419 | 47 874 / 47 346 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Středočeský kraj | **Příbram** | 539911 | 32 917 / 32 773 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Středočeský kraj | **Říčany** | 538728 | 17 314 / 17 143 | b | auto (≥ 10 000, typ a/b) | – | disambiguated-by-druh | ano |
| Středočeský kraj | **Vlašim** | 530883 | 11 329 / 11 434 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Jihočeský kraj | **České Budějovice** | 544256 | 97 128 / 97 231 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Jihočeský kraj | **Jindřichův Hradec** | 545881 | 20 369 / 20 540 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Jihočeský kraj | **Písek** | 549240 | 31 002 / 31 121 | a | auto (≥ 10 000, typ a/b) | – | disambiguated-by-druh | ano |
| Jihočeský kraj | **Prachatice** | 550094 | 11 036 / 11 119 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Jihočeský kraj | **Tábor** | 552046 | 34 339 / 34 356 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Plzeňský kraj | **Domažlice** | 553425 | 10 973 / 11 133 | a | auto (≥ 10 000, typ a/b) | – | – | ano |
| Plzeňský kraj | **Plzeň** | 554791 | 187 863 / 187 928 | a | auto (≥ 10 000, typ a/b) | – | – | ano |
| Plzeňský kraj | **Rokycany** | 559717 | 14 248 / 14 381 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Plzeňský kraj | **Sušice** | 557153 | 10 689 / 10 740 | a | auto (≥ 10 000, typ a/b) | – | disambiguated-by-druh | ano |
| Karlovarský kraj | **Cheb** | 554481 | 32 892 / 32 808 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Karlovarský kraj | **Karlovy Vary** | 554961 | 48 788 / 49 073 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Karlovarský kraj | **Mariánské Lázně** | 554642 | 13 921 / 14 052 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Ústecký kraj | **Bílina** | 567451 | 14 401 / 14 497 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Ústecký kraj | **Děčín** | 562335 | 46 003 / 46 376 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Ústecký kraj | **Chomutov** | 562971 | 46 560 / 46 771 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Ústecký kraj | **Kadaň** | 563102 | 18 088 / 18 090 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Ústecký kraj | **Litvínov** | 567256 | 22 258 / 22 387 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Ústecký kraj | **Louny** | 565971 | 18 061 / 18 068 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Ústecký kraj | **Most** | 567027 | 63 160 / 63 474 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Ústecký kraj | **Roudnice nad Labem** | 565555 | 12 561 / 12 668 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Ústecký kraj | **Teplice** | 567442 | 50 856 / 50 912 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Ústecký kraj | **Ústí nad Labem** | 554804 | 90 035 / 90 866 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Ústecký kraj | **Varnsdorf** | 562882 | 14 645 / 14 704 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Ústecký kraj | **Žatec** | 566985 | 18 984 / 18 959 | b | auto (≥ 10 000, typ a/b) | – | disambiguated-by-druh | ano |
| Liberecký kraj | **Česká Lípa** | 561380 | 36 364 / 36 815 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Liberecký kraj | **Jablonec nad Nisou** | 563510 | 46 206 / 46 209 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Liberecký kraj | **Liberec** | 563889 | 108 214 / 108 090 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Liberecký kraj | **Turnov** | 577626 | 14 607 / 14 577 | a | auto (≥ 10 000, typ a/b) | – | – | ano |
| Královéhradecký kraj | **Dvůr Králové nad Labem** | 579203 | 15 316 / 15 322 | b | auto (≥ 10 000, typ a/b) | – | no-members-on-pirate-list | ano |
| Královéhradecký kraj | **Hradec Králové** | 569810 | 93 534 / 94 311 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Královéhradecký kraj | **Jaroměř** | 574121 | 12 487 / 12 483 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Královéhradecký kraj | **Jičín** | 572659 | 16 052 / 16 101 | b | auto (≥ 10 000, typ a/b) | – | kraj-differs-from-owner-list | ano |
| Královéhradecký kraj | **Náchod** | 573868 | 19 649 / 19 827 | b | auto (≥ 10 000, typ a/b) | – | no-members-on-pirate-list | ano |
| Královéhradecký kraj | **Rychnov nad Kněžnou** | 576069 | 11 693 / 11 420 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Pardubický kraj | **Česká Třebová** | 580031 | 14 982 / 15 010 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Pardubický kraj | **Chrudim** | 571164 | 23 562 / 23 564 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Pardubický kraj | **Pardubice** | 555134 | 92 713 / 92 319 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Kraj Vysočina | **Havlíčkův Brod** | 568414 | 23 368 / 23 791 | a | auto (≥ 10 000, typ a/b) | – | – | ano |
| Kraj Vysočina | **Humpolec** | 547999 | 11 487 / 11 522 | a | auto (≥ 10 000, typ a/b) | – | – | ano |
| Kraj Vysočina | **Jihlava** | 586846 | 53 686 / 54 624 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Kraj Vysočina | **Nové Město na Moravě** | 596230 | 9 716 / 9 834 | b | hraniční, zařazeno | na seznamu majitele; Piráti 2022: 6,7 %, 1 mand. | – | ano |
| Kraj Vysočina | **Pelhřimov** | 547492 | 16 233 / 16 206 | a | auto (≥ 10 000, typ a/b) | – | – | ano |
| Kraj Vysočina | **Třebíč** | 590266 | 34 476 / 34 530 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Jihomoravský kraj | **Blansko** | 581283 | 19 900 / 20 002 | a | auto (≥ 10 000, typ a/b) | – | – | ano |
| Jihomoravský kraj | **Brno** | 582786 | 404 296 / 402 739 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Jihomoravský kraj | **Břeclav** | 584291 | 24 583 / 24 538 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Jihomoravský kraj | **Znojmo** | 593711 | 33 989 / 34 172 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Olomoucký kraj | **Olomouc** | 500496 | 105 297 / 103 063 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Olomoucký kraj | **Prostějov** | 589250 | 43 236 / 43 408 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Olomoucký kraj | **Přerov** | 511382 | 40 492 / 40 906 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Olomoucký kraj | **Uničov** | 505587 | 11 060 / 11 237 | b | auto (≥ 10 000, typ a/b) | – | named-cps-but-association | ano |
| Zlínský kraj | **Holešov** | 588458 | 11 544 / 11 616 | b | auto (≥ 10 000, typ a/b) | – | no-members-on-pirate-list | ano |
| Zlínský kraj | **Kroměříž** | 588296 | 27 781 / 27 917 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Zlínský kraj | **Otrokovice** | 585599 | 17 239 / 17 401 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Zlínský kraj | **Rožnov pod Radhoštěm** | 544841 | 15 916 / 16 063 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Zlínský kraj | **Uherské Hradiště** | 592005 | 24 852 / 24 887 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Zlínský kraj | **Uherský Brod** | 592731 | 16 280 / 16 367 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Zlínský kraj | **Zlín** | 585068 | 74 917 / 74 684 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Moravskoslezský kraj | **Frýdek-Místek** | 598003 | 53 164 / 53 590 | a | auto (≥ 10 000, typ a/b) | – | – | ano |
| Moravskoslezský kraj | **Hlučín** | 507016 | 13 245 / 13 352 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Moravskoslezský kraj | **Karviná** | 598917 | 48 684 / 48 937 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Moravskoslezský kraj | **Kopřivnice** | 599565 | 21 245 / 21 374 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Moravskoslezský kraj | **Nový Jičín** | 599191 | 22 740 / 23 005 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Moravskoslezský kraj | **Opava** | 505927 | 54 881 / 55 109 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Moravskoslezský kraj | **Orlová** | 599069 | 27 383 / 27 540 | b | auto (≥ 10 000, typ a/b) | – | – | ano |
| Moravskoslezský kraj | **Ostrava** | 554821 | 280 853 / 283 187 | a | auto (≥ 10 000, typ a/b) | – | – | ano |

## 2. Zamítnutá města ze seznamu majitele (12 + 1 mimo soubor seznamu)

| Kraj | Město | KODZASTUP | Obyvatel (2026 / 2025) | Typ | Zařazení | borderline_reason | Příznaky | Důvod zamítnutí |
|---|---|---|---|---|---|---|---|---|
| Středočeský kraj | **Kralupy nad Vltavou** | 534951 | 19 138 / 19 005 | d | vyřazeno | – | – | typ d: Piráti tu nekandidují (podle registru ČSÚ); 19 138 obyvatel |
| Středočeský kraj | **Mělník** | 534676 | 20 301 / 20 278 | c | vyřazeno | – | – | typ c: Piráti tu jsou jen na kandidátkách jiných stran; 20 301 obyvatel |
| Středočeský kraj | **Neratovice** | 535087 | 16 279 / 16 360 | d | vyřazeno | – | – | typ d: Piráti tu nekandidují (podle registru ČSÚ); 16 279 obyvatel |
| Středočeský kraj | **Roztoky** | 539627 | 9 147 / 9 088 | d | vyřazeno | – | disambiguated-by-druh | typ d: Piráti tu nekandidují (podle registru ČSÚ); 9 147 obyvatel |
| Středočeský kraj | **Slaný** | 532819 | 17 247 / 16 937 | c | vyřazeno | – | – | typ c: Piráti tu jsou jen na kandidátkách jiných stran; 17 247 obyvatel |
| Karlovarský kraj | **Ostrov** | 555428 | 15 615 / 15 681 | c | vyřazeno | – | disambiguated-by-druh | typ c: Piráti tu jsou jen na kandidátkách jiných stran; 15 615 obyvatel |
| Karlovarský kraj | **Sokolov** | 560286 | 21 908 / 22 007 | c | vyřazeno | – | – | typ c: Piráti tu jsou jen na kandidátkách jiných stran; 21 908 obyvatel |
| Ústecký kraj | **Jirkov** | 563099 | 19 067 / 19 240 | c | vyřazeno | – | – | typ c: Piráti tu jsou jen na kandidátkách jiných stran; 19 067 obyvatel |
| Ústecký kraj | **Krupka** | 567639 | 12 731 / 12 793 | c | vyřazeno | – | – | typ c: Piráti tu jsou jen na kandidátkách jiných stran; 12 731 obyvatel |
| Ústecký kraj | **Litoměřice** | 564567 | 22 627 / 22 767 | c | vyřazeno | – | – | typ c: Piráti tu jsou jen na kandidátkách jiných stran; 22 627 obyvatel |
| Královéhradecký kraj | **Trutnov** | 579025 | 29 337 / 29 607 | c | vyřazeno | – | – | typ c: Piráti tu jsou jen na kandidátkách jiných stran; 29 337 obyvatel |
| Olomoucký kraj | **Litovel** | 503444 | 9 448 / 9 510 | d | vyřazeno | – | – | typ d: Piráti tu nekandidují (podle registru ČSÚ); 9 448 obyvatel; Litovel je senátní obvod 66 (volby 2026); pirátská vazba je podle majitele senátní kandidát (Senát, ne tento produkt); není v souboru seznamu, majitel ho uvedl jako příklad (ne – mimo soubor seznamu) |
| Moravskoslezský kraj | **Havířov** | 555088 | 67 998 / 68 674 | d | vyřazeno | – | – | typ d: Piráti tu nekandidují (podle registru ČSÚ); 67 998 obyvatel |

## 3. Splňují pravidla, ale není na seznamu majitele (5)

Spočteno z registru; v generovaných datech jsou zařazena (po kontrole majitelem je lze odebrat přes `include: false`).

| Kraj | Město | KODZASTUP | Obyvatel (2026 / 2025) | Typ | Zařazení | borderline_reason | Příznaky | Na seznamu majitele |
|---|---|---|---|---|---|---|---|---|
| Plzeňský kraj | **Klatovy** | 555771 | 22 921 / 22 763 | b | auto (≥ 10 000, typ a/b) | – | – | ne |
| Jihomoravský kraj | **Mikulov** | 584649 | 7 552 / 7 577 | b | hraniční, zařazeno | Piráti 2022: 8,4 %, 2 mand. | borderline-auto | ne |
| Jihomoravský kraj | **Veselí nad Moravou** | 586722 | 10 574 / 10 623 | b | auto (≥ 10 000, typ a/b) | – | – | ne |
| Moravskoslezský kraj | **Český Těšín** | 598933 | 22 870 / 23 075 | b | auto (≥ 10 000, typ a/b) | – | – | ne |
| Moravskoslezský kraj | **Rychvald** | 599107 | 7 823 / 7 787 | b | hraniční, zařazeno | Piráti 2022: 11,7 %, 2 mand. | borderline-auto | ne |

## 4. Hraniční města bez důvodu, nezařazená (6)

| Kraj | Město | KODZASTUP | Obyvatel (2026 / 2025) | Typ | borderline_reason | Poznámka |
|---|---|---|---|---|---|---|
| Středočeský kraj | **Černošice** | 539139 | 7 781 / 7 712 | b | – (žádný důvod) | 7 781 obyvatel, bez důvodu k zařazení; Piráti 2022: nekandidovali |
| Středočeský kraj | **Hořovice** | 531189 | 8 245 / 8 055 | b | – (žádný důvod) | 8 245 obyvatel, bez důvodu k zařazení; Piráti 2022: nekandidovali |
| Kraj Vysočina | **Moravské Budějovice** | 591181 | 7 079 / 7 098 | b | – (žádný důvod) | 7 079 obyvatel, bez důvodu k zařazení; Piráti 2022: nekandidovali |
| Jihomoravský kraj | **Slavkov u Brna** | 593583 | 7 294 / 7 258 | b | – (žádný důvod) | 7 294 obyvatel, bez důvodu k zařazení; Piráti 2022: nekandidovali |
| Jihomoravský kraj | **Šlapanice** | 583952 | 7 940 / 7 915 | b | – (žádný důvod) | 7 940 obyvatel, bez důvodu k zařazení; Piráti 2022: nekandidovali |
| Jihomoravský kraj | **Tišnov** | 584002 | 9 270 / 9 225 | b | – (žádný důvod) | 9 270 obyvatel, bez důvodu k zařazení; Piráti 2022: nekandidovali |

## Poznámky

- Skryto do ověření majitelem (confidence low): Mikulov [borderline-auto]; Rychvald [borderline-auto].
- Nezveřejněná města, kde Piráti kandidují a tabulka ČSÚ 2025 dává jiné pásmo než registr 2026 (zařazení rozhoduje registr 2026, příznak population-band-differs se tu nepoužívá): Broumov (6 998 / 7 108), Napajedla (6 981 / 7 043).
