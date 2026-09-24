# South African settlement renamings — registry v1.1.0

Generated 2026-09-24 from tile snapshot `20260913_164504_pt`. Decided 2026-09-24. Applied to the map through `overrides.json`, which `scripts/build-overrides.mjs` builds from `registry.v1.json`.

**How to read this.** *Official* is the current gazetted name (for Nieu-Bethesda, Louis Trichardt and Vaalwater it is the former name itself). *Shown* is the name the map draws: the former English or Afrikaans name. The official name stays searchable and is kept as metadata, never as the label. **Map tile** is what OpenFreeMap Liberty draws without an override (it uses `coalesce(name_en, name)`; `name_en` is not the same field as `name:en`).

**Status values.** *gazetted*: approved by the Minister and published in the Government Gazette, or recorded in the DSAC/SAGNC database. *unverified*: known only from secondary sources. **Check** is *verified* when a primary or government source names this exact change, *secondary-source* when only a secondary source does, otherwise *needs-review*.

The main evidence is the DSAC *SAGNC Names – Complete Database* (dated 2024-03-01; copy in `sources/`), plus the Government Gazette notices in `sources/`. Where only the database was available, the date is the database's record date. That date may be the gazette date or a later registration date.

## Decisions (2026-09-24)

The site owner decided the open questions of v1.0.0 as follows.

- Contested 2026 renamings (GG 54101: Robert Sobukwe, KuGompo City, Xamdeboo, Bishop Limba, Ekhephini): applied now; the former names are shown.
- KwaNoheleni was not gazetted; the map shows Nieu-Bethesda, the official name. Recorded as a correction of the OSM label, not a renaming.
- Near-spellings (Tabankulu, Messina, Mafikeng, Teslaarsdal and the other spelling or orthography corrections) are treated as renamings; the former forms are shown.
- Apartheid-era former names are included (Sophiatown shows Triomf, District Six shows Zonnebloem).
- KwaZulu-Natal spelling changes (Tongaat, Umhlanga Rocks, Amanzimtoti, Umkomaas, Umdloti, Mkuze, Ixopo, Umzinto, Gingindlovu, Umbogintwini, Umtentweni, Inchanga, Mtunzini, Congella) show the established former English forms.
- Renamed settlements and farm-named villages (Mpumalanga and elsewhere) are included, not only towns and cities.
- Municipality and metro names stay excluded (not place renamings); registrations of existing or new names stay excluded (no former name); Makhado/Louis Trichardt and Mabatlane/Vaalwater were reverted, so the official name is already the former name and no override is needed; renamings known only from secondary sources (Butterworth, Middledrift, Verwoerdburg) are applied and flagged secondary-source.
- Former English/Afrikaans names are the primary labels on both basemaps and in both languages. Official current names stay searchable and are kept as metadata, never as the primary label. Overrides touch place labels only.

**Match rule.** An override changes a label only when the tile feature has the recorded feature id, the recorded place class and one of the recorded current names. It applies to place labels only (the `place` source layer), never to stations, airports, roads or points of interest. There is no broad text replacement. Each override has a source and an effective period: `effective.from` is the renaming or gazette date (for Nieu-Bethesda, the tile snapshot date) and `effective.to` is empty.

### Applied overrides (94)

| Province | Name shown (en / af) | Official name | Match key (id · class · current names) | Source | Effective from | Check |
|---|---|---|---|---|---|---|
| Eastern Cape | Bisho | Bhisho | 2627193131 · town · Bhisho | SAGNC-DB | 2005-02-25 | needs-review |
| Eastern Cape | Adendorp | Bishop Limba | 2627190451 · village · Bishop Limba, KwaMseki Bishop Limba | [GG54101 GN7111](https://www.gov.za/sites/default/files/gcis_document/202602/54101gon7111.pdf) | 2026-02-06 | verified |
| Eastern Cape | Lady Frere | Cacadu | 2627084301 · town · Cacadu | SAGNC-DB | 2016-02-09 | verified |
| Eastern Cape | Kentani | Centane | 2627046251 · suburb · Centane | SAGNC-DB | 2006-07-27 | needs-review |
| Eastern Cape | Alice | Dikeni | 2626946931 · town · Alice, Dikeni | SAGNC-DB | 2016-06-17 | verified |
| Eastern Cape | Idutywa | Dutywa | 543374411 · town · Dutywa | SAGNC-DB | 2006-07-27 | needs-review |
| Eastern Cape | Barkly East / Barkly-Oos | Ekhephini | 2626949511 · town · Ekhephini, Ekhepini | [GG54101 GN7110](https://www.gov.za/sites/default/files/gcis_document/202602/54101gon7110.pdf) | 2026-02-06 | verified |
| Eastern Cape | Cradock | Enxuba | 259198581 · town · Nxuba, Enxuba | SAGNC-DB | 2022-08-26 | verified |
| Eastern Cape | Butterworth | Gcuwa | 539825301 · town · Gcuwa (Butterworth), Gcuwa | [en.wikipedia.org](https://en.wikipedia.org/wiki/List_of_renamed_places_in_South_Africa) | 2004 | secondary-source |
| Eastern Cape | Port Elizabeth | Gqeberha | 254701001 · city · Gqeberha | SAGNC-DB | 2021-02-22 | verified |
| Eastern Cape | Morgan's Bay / Morganbaai | Gxarha | 2627124021 · suburb · Gxarha | SAGNC-DB | 2022-08-26 | verified |
| Eastern Cape | Jamestown | James Calata | 2627206821 · town · James Calata | SAGNC-DB | 2015-09-11 | verified |
| Eastern Cape | Uitenhage | Kariega | 9460251541 · town · Kariega | SAGNC-DB | 2021-02-22 | verified |
| Eastern Cape | Elliot | Khowa | 2627200371 · town · Khowa | SAGNC-DB | 2016-02-09 | verified |
| Eastern Cape | Queenstown | Komani | 598666311 · town · Komani | SAGNC-DB | 2016-02-09 | verified |
| Eastern Cape | East London / Oos-Londen | KuGompo City | 302113831 · city · KuGompo City, KuGompo | [GG54101 GN7111](https://www.gov.za/sites/default/files/gcis_document/202602/54101gon7111.pdf) | 2026-02-06 | verified |
| Eastern Cape | Mount Frere | KwaBhaca | 2627126251 · town · KwaBhaca (Mount Frere), KwaBhaca | SAGNC-DB | 2016-02-09 | verified |
| Eastern Cape | Fort Beaufort | KwaMaqoma | 1463506961 · town · KwaMaqoma | SAGNC-DB | 2023-03-13 | verified |
| Eastern Cape | Somerset East / Somerset-Oos | KwaNojoli | 2627161381 · town · KwaNojoli | SAGNC-DB | 2023-03-13 | verified |
| Eastern Cape | Grahamstown / Grahamstad | Makhanda | 302298771 · city · Makhanda | SAGNC-DB | 2018-06-29 | verified |
| Eastern Cape | Aliwal North / Aliwal-Noord | Maletswai | 362315891 · town · Maletswai | SAGNC-DB | 2015-09-11 | needs-review |
| Eastern Cape | Mount Ayliff | MaXesibeni | 2627126211 · town · eMaXesibeni (Mount Ayliff), MaXesibeni, eMaxesibeni | SAGNC-DB | 2016-02-09 | verified |
| Eastern Cape | Bizana | Mbizana | 2626952131 · town · Bizana, Mbizana | SAGNC-DB | 2013-12-06 | verified |
| Eastern Cape | Umtata | Mthatha | 2627223331 · city · Mthatha | SAGNC-DB | 2006-07-27 | needs-review |
| Eastern Cape | Engcobo | Ngcobo | 2627058671 · town · Ngcobo | SAGNC-DB | 2006-07-27 | needs-review |
| Eastern Cape | Nieu-Bethesda | Nieu-Bethesda | 2627216491 · town · Kwa Noheleni, Nieu-Bethesda | [gov.za](https://www.gov.za/news/media-statements/minister-gayton-mckenzie-approval-21-geographical-name-changes-29-jan-2026) | 2026-09-13 | verified |
| Eastern Cape | Maclear | Nqanqarhu | 2627089071 · town · Nqanqarhu | SAGNC-DB | 2021-02-22 | verified |
| Eastern Cape | Kirkwood | Nqweba | 1647584041 · town · Nqweba | [GG50326 GN4547](https://www.gov.za/sites/default/files/gcis_document/202403/50326gon4547.pdf) | 2024-03-22 | verified |
| Eastern Cape | Tabankulu | Ntabankulu | 2438360531 · town · Tabankulu, Ntabankulu | SAGNC-DB | 2005-02-25 | needs-review |
| Eastern Cape | Berlin / Berlyn | Ntabozuko | 2626951291 · town · Ntabozuko | SAGNC-DB | 2021-02-22 | verified |
| Eastern Cape | King William's Town | Qonce | 468994141 · town · Qonce | SAGNC-DB | 2021-02-22 | verified |
| Eastern Cape | Graaff-Reinet | Robert Sobukwe | 302117011 · town · Robert Sobukwe Town, Robert Sobukwe | [GG54101 GN7111](https://www.gov.za/sites/default/files/gcis_document/202602/54101gon7111.pdf) | 2026-02-06 | verified |
| Eastern Cape | Mount Fletcher | Tlokoeng | 2627126241 · town · Tlokoeng | SAGNC-DB | 2021-03-16 | verified |
| Eastern Cape | Aberdeen | Xamdeboo | 468374811 · town · Xamdeboo, Xamdebo | [GG54101 GN7111](https://www.gov.za/sites/default/files/gcis_document/202602/54101gon7111.pdf) | 2026-02-06 | verified |
| Eastern Cape | Middledrift / Middeldrif | Xesi | 2627101331 · village · Middledrift, Xesi | SAGNC-DB | 2016 | secondary-source |
| Free State | Clocolan | Hlohlolwane | 2627046991 · town · Hlohlolwane (Clocolan), Hlohlolwane | SAGNC-DB | 2015-12-09 | verified |
| Free State | Petrus Steyn | Mamafubedu | 2627219131 · town · Petrus Steyn, Mamafubedu | SAGNC-DB | 2012-11-02 | verified |
| Free State | Brandfort | Winnie Mandela | 2627194371 · town · Winnie Mandela (Brandfort), Winnie Mandela | SAGNC-DB | 2021-08-06 | verified |
| Gauteng | Verwoerdburg | Centurion | 2627196361 · town · Centurion | [en.wikipedia.org](https://en.wikipedia.org/wiki/List_of_renamed_places_in_South_Africa) | 1995 | secondary-source |
| Gauteng | Tembisa | Thembisa | 2627222561 · town · Thembisa | SAGNC-DB | 2016-06-17 | verified |
| Gauteng | Tokoza | Thokoza | 2627179691 · suburb · Thokoza | SAGNC-DB | 2016-06-17 | verified |
| KwaZulu-Natal | Amanzimtoti | eManzimtoti | 2626948041 · suburb · Amanzimtoti, eManzimtoti | SAGNC-DB | 2010-10-01 | verified |
| KwaZulu-Natal | Umdloti | eMdloti | 632813721 · village · Umdloti / eMdloti, eMdloti | SAGNC-DB | 2010-10-01 | verified |
| KwaZulu-Natal | Umkomaas | eMkhomazi | 2627223311 · town · Umkomaas, eMkhomazi | SAGNC-DB | 2010-10-01 | verified |
| KwaZulu-Natal | Mkuze | eMkhuze | 2627101651 · village · Mkuze, eMkhuze | SAGNC-DB | 2011-10-07 | verified |
| KwaZulu-Natal | Umtentweni | eMthenteni | 2627181211 · village · Umtentweni, eMthenteni | [GG28458](https://www.gov.za/sites/default/files/gcis_document/201409/28458a.pdf) | 2011-10-07 | verified |
| KwaZulu-Natal | Melmoth | eMthonjaneni | 2627100461 · town · Melmoth, eMthonjaneni | SAGNC-DB | 2017-12-15 | verified |
| KwaZulu-Natal | Mtunzini | eMthunzini | 2627127181 · village · Mtunzini, eMthunzini | SAGNC-DB | 2011-10-07 | verified |
| KwaZulu-Natal | Umzinto | eMuziwezinto | 2627181431 · suburb · Umzinto, eMuziwezinto | SAGNC-DB | 2013-10-02 | verified |
| KwaZulu-Natal | Inchanga | eNtshangwe | 2627071741 · suburb · Inchanga, eNtshangwe | SAGNC-DB | 2011-10-07 | verified |
| KwaZulu-Natal | Ixopo | eXobho | 2627072391 · village · Ixopo, eXobho | SAGNC-DB | 2011-10-07 | verified |
| KwaZulu-Natal | Umbogintwini | eZimbokodweni | 2627223291 · town · Umbogintwini, eZimbokodweni | SAGNC-DB | 2010-10-01 | verified |
| KwaZulu-Natal | Stanger | KwaDukuza | 2627222081 · town · KwaDukuza | [GG28458](https://www.gov.za/sites/default/files/gcis_document/201409/28458a.pdf) | 2006-02-10 | verified |
| KwaZulu-Natal | Gingindlovu | KwaGingindlovu | 2627066021 · village · Gingindlovu, KwaGingindlovu | SAGNC-DB | 2009-09-18 | verified |
| KwaZulu-Natal | Congella | KwaKhangela | 2627047241 · suburb · Congella, KwaKhangela | SAGNC-DB | 2010-10-01 | verified |
| KwaZulu-Natal | Tongaat | oThongathi | 2627222921 · town · oThongathi | SAGNC-DB | 2010-10-01 | verified |
| KwaZulu-Natal | Pomeroy | Solomon Linda | 2627149011 · village · Pomeroy, Solomon Linda | SAGNC-DB | 2022-08-26 | verified |
| KwaZulu-Natal | Umhlanga Rocks | uMhlanga Rocks | 2627223301 · town · Umhlanga Rocks, uMhlanga Rocks | SAGNC-DB | 2010-10-01 | verified |
| KwaZulu-Natal | Ladysmith | uMnambithi | 517459221 · city · uMnambithi | [GG50326 GN4547](https://www.gov.za/sites/default/files/gcis_document/202403/50326gon4547.pdf) | 2024-03-22 | verified |
| Limpopo | Warmbaths / Warmbad | Bela-Bela | 2626950061 · town · Bela-Bela | SAGNC-DB | 2006-07-27 | needs-review |
| Limpopo | Ellisras | Lephalale | 2627086301 · town · Lephalale | SAGNC-DB | 2002-05-01 | verified |
| Limpopo | Nylstroom | Modimolle | 2627217731 · town · Modimolle | SAGNC-DB | 2002-05-01 | verified |
| Limpopo | Duiwelskloof | Modjadjiskloof | 2627102461 · village · Modjadjiskloof | SAGNC-DB | 2006-07-27 | needs-review |
| Limpopo | Dendron | Mogwadi | 2627050511 · town · Mogwadi | SAGNC-DB | 2002-10-01 | verified |
| Limpopo | Potgietersrus | Mokopane | 521324831 · city · Mokopane | SAGNC-DB | 2002-05-01 | verified |
| Limpopo | Naboomspruit | Mookgophong | 601191021 · town · Mookgophong, Mookgopong | SAGNC-DB | 2006-11-24 | verified |
| Limpopo | Soekmekaar | Morebeng | 2627161351 · village · Soekmekaar (Morebeng), Morebeng | SAGNC-DB | 2002-10-01 | verified |
| Limpopo | Messina | Musina | 489124181 · city · Musina | SAGNC-DB | 2002-05-01 | needs-review |
| Limpopo | Pietersburg | Polokwane | 3045776921 · city · Polokwane | SAGNC-DB | 2002-05-01 | verified |
| Limpopo | Bochum | Senwabarwana | 80706524971 · town · Senwabarwana | SAGNC-DB | 2006-07-27 | needs-review |
| Limpopo | Vrieskraal | Thabana | 2627176951 · suburb · Thabana | [GG28458](https://www.gov.za/sites/default/files/gcis_document/201409/28458a.pdf) | 2006-02-10 | verified |
| Mpumalanga | Belfast | eMakhazeni | 2524375611 · town · eMakhazeni | [sanews.gov.za](https://www.sanews.gov.za/features/nelspruit-be-officially-renamed-mbombela) | 2009-10-16 | needs-review |
| Mpumalanga | Witbank | eMalahleni | 303241591 · city · eMalahleni, Emalahleni | [GG28458](https://www.gov.za/sites/default/files/gcis_document/201409/28458a.pdf) | 2006-02-10 | verified |
| Mpumalanga | Badplaas | eManzana | 2626949261 · town · Badplaas, eManzana | SAGNC-DB | 2009-09-18 | verified |
| Mpumalanga | Waterval Boven / Waterval-Boven | Emgwenya | 2627185601 · town · Waterval Boven, Emgwenya | [sanews.gov.za](https://www.sanews.gov.za/features/nelspruit-be-officially-renamed-mbombela) | 2009-10-16 | needs-review |
| Mpumalanga | Hectorspruit | Emjejane | 2627069771 · village · Hectorspruit, Emjejane | SAGNC-DB | 2005-02-25 | needs-review |
| Mpumalanga | Piet Retief | eMkhondo | 560045031 · town · Piet Retief, eMkhondo | SAGNC-DB | 2010-01-29 | verified |
| Mpumalanga | Amsterdam | eMvelo | 2286743661 · town · Amsterdam, eMvelo | SAGNC-DB | 2019-12-17 | verified |
| Mpumalanga | Machadodorp | eNtokozweni | 2627088971 · town · Machadodorp, eNtokozweni | [sanews.gov.za](https://www.sanews.gov.za/features/nelspruit-be-officially-renamed-mbombela) | 2009-10-16 | needs-review |
| Mpumalanga | Kriel | Ga-Nala | 2627078541 · town · Kriel, Ga-Nala | [GG28458](https://www.gov.za/sites/default/files/gcis_document/201409/28458a.pdf) | 2006-02-10 | verified |
| Mpumalanga | Jeppe's Reef / Jeppesrif | Magogeni | 2627072721 · town · Jeppe's Reef, Magogeni | SAGNC-DB | 2003-05-15 | needs-review |
| Mpumalanga | Malelane | Malalane | 2627092691 · town · Malalane | [GG28458](https://www.gov.za/sites/default/files/gcis_document/201409/28458a.pdf) | 2006-02-10 | verified |
| Mpumalanga | Lydenburg | Mashishing | 2627088651 · town · Lydenburg, Mashishing | SAGNC-DB | 2006-06-30 | verified |
| Mpumalanga | Nelspruit | Mbombela | 302118831 · city · Mbombela, Mbombela (Nelspruit) | SAGNC-DB | 2009-10-16 | verified |
| Mpumalanga | Buffelspruit | Mhlambanyatsi | 2627044041 · suburb · Buffelspruit, Mhlambanyatsi | SAGNC-DB | 2003-05-15 | verified |
| Mpumalanga | Greenside | Mmaduma | 2627068351 · suburb · Greenside, Mmaduma | SAGNC-DB | 2005-02-25 | needs-review |
| Mpumalanga | Greylingstad | Nthorwane | 2627068391 · town · Greylingstad, Nthorwane, Nthrowane | SAGNC-DB | 2013-03-28 | verified |
| Mpumalanga | Grootvlei | Thaba-Kgwali | 2627068581 · village · Grootvlei, Thaba-Kgwali | SAGNC-DB | 2013-03-28 | verified |
| Mpumalanga | Leandra | Thuli Fakude | 2627084911 · suburb · Leandra, Thuli Fakude | SAGNC-DB | 2016-02-09 | verified |
| North West | Hartbeesfontein | Lethabong | 2627069671 · suburb · Hartbeesfontein, Lethabong | SAGNC-DB | 2004-05-28 | needs-review |
| North West | Mafikeng | Mahikeng | 599537381 · city · Mahikeng | SAGNC-DB | 2010-01-29 | needs-review |
| Western Cape | Schotschekloof | Bo-Kaap | 384642251 · suburb · Bo-Kaap (Schotschekloof), Bo-Kaap | SAGNC-DB | 2016 | needs-review |
| Western Cape | Zonnebloem | District Six | 384641991 · suburb · District Six | SAGNC-DB | 2019-12-17 | verified |
| Western Cape | Teslaarsdal | Tesselaarsdal | 2627176901 · village · Tesselaarsdal | SAGNC-DB | 2016-12-09 | needs-review |

### Entries with no override (9)

- **Triomf** (official Sophiatown, Gauteng): pending (not in tiles). The place is not in the place layer of the tiles; it is still searchable.
- **Loskop** (official eMangweni, KwaZulu-Natal): pending (not in tiles). The place is not in the place layer of the tiles; it is still searchable.
- **Louis Trichardt** (official Louis Trichardt, Limpopo): reverted, no override. The renaming to Makhado was reversed, so the official name is already the former name.
- **Vaalwater** (official Vaalwater, Limpopo): reverted, no override. The renaming to Mabatlane was reversed, so the official name is already the former name.
- **Langeloop** (official Emtfuntini, Mpumalanga): pending (not in tiles). The place is not in the place layer of the tiles; it is still searchable.
- **Hartebeeskop** (official Etjelembube, Mpumalanga): pending (not in tiles). The place is not in the place layer of the tiles; it is still searchable.
- **Schoemansdal** (official Kamatsamo, Mpumalanga): pending (not in tiles). The place is not in the place layer of the tiles; it is still searchable.
- **Oshoek** (official Maphundlwane, Mpumalanga): pending (not in tiles). The place is not in the place layer of the tiles; it is still searchable.
- **Goedgewonden** (official Rentse Village, North West): pending (not in tiles). The place is not in the place layer of the tiles; it is still searchable.

## Entries by province

### Eastern Cape

| Official | Shown (en / af) | Date | Status | Check | Map tile | Override | Sources |
|---|---|---|---|---|---|---|---|
| Bhisho | Bisho | 2005-02-25 | gazetted | needs-review | Bhisho (town, 10/590/611) | id | SAGNC-DB |
| Bishop Limba | Adendorp | 2026-02-06 · GG 54101, GN 7111 | gazetted | verified | Bishop Limba (village, 10/581/609) | id | [GG54101 GN7111](https://www.gov.za/sites/default/files/gcis_document/202602/54101gon7111.pdf), [pmg.org.za](https://pmg.org.za/committee-question/37684/) |
| Cacadu | Lady Frere | 2016-02-09 | gazetted | verified | Cacadu (town, 10/589/607) | id | SAGNC-DB |
| Centane | Kentani | ? | gazetted | needs-review | Centane (suburb, 12/2370/2439) | id | SAGNC-DB, [en.wikipedia.org](https://en.wikipedia.org/wiki/List_of_renamed_places_in_South_Africa) |
| Dikeni | Alice | 2016-06-17 | gazetted | verified | Alice (town, 10/588/610) | id | SAGNC-DB |
| Dutywa | Idutywa | ? | gazetted | needs-review | Dutywa (town, 10/592/608) | id | SAGNC-DB, [en.wikipedia.org](https://en.wikipedia.org/wiki/List_of_renamed_places_in_South_Africa) |
| Ekhephini | Barkly East / Barkly-Oos | 2026-02-06 · GG 54101, GN 7110 | gazetted | verified | Ekhephini (town, 10/590/604) | id | [GG54101 GN7110](https://www.gov.za/sites/default/files/gcis_document/202602/54101gon7110.pdf), [pmg.org.za](https://pmg.org.za/committee-question/37684/) |
| Enxuba | Cradock | 2022-08-26 | gazetted | verified | Nxuba (town, 10/584/608) | id | SAGNC-DB |
| Gcuwa | Butterworth | ? | unverified | secondary-source | Gcuwa (Butterworth) (town, 10/592/609) | id | [en.wikipedia.org](https://en.wikipedia.org/wiki/List_of_renamed_places_in_South_Africa) |
| Gqeberha | Port Elizabeth | 2021-02-22 | gazetted | verified | Gqeberha (city, 10/584/614) | id | SAGNC-DB |
| Gxarha | Morgan's Bay / Morganbaai | 2022-08-26 | gazetted | verified | Gxarha (suburb, 12/2370/2442) | id | SAGNC-DB |
| James Calata | Jamestown | 2015-09-11 | gazetted | verified | James Calata (town, 10/588/605) | id | SAGNC-DB |
| Kariega | Uitenhage | 2021-02-22 | gazetted | verified | Kariega (town, 10/584/614) | id | SAGNC-DB |
| Khowa | Elliot | 2016-02-09 | gazetted | verified | Khowa (town, 10/591/605) | id | SAGNC-DB |
| Komani | Queenstown | 2016-02-09 | gazetted | verified | Komani (town, 10/588/607) | id | SAGNC-DB |
| KuGompo City | East London / Oos-Londen | 2026-02-06 · GG 54101, GN 7111 | gazetted | verified | KuGompo City (city, 10/591/611) | id | [GG54101 GN7111](https://www.gov.za/sites/default/files/gcis_document/202602/54101gon7111.pdf), [pmg.org.za](https://pmg.org.za/committee-question/37684/), [theherald.co.za](https://www.theherald.co.za/news/2026-07-23-legal-battles-loom-over-renaming-of-east-london-graaff-reinet/) |
| KwaBhaca | Mount Frere | 2016-02-09 | gazetted | verified | KwaBhaca (Mount Frere) (town, 10/594/604) | id | SAGNC-DB |
| KwaMaqoma | Fort Beaufort | 2023-03-13 | gazetted | verified | KwaMaqoma (town, 10/587/610) | id | SAGNC-DB |
| KwaNojoli | Somerset East / Somerset-Oos | 2023-03-13 | gazetted | verified | KwaNojoli (town, 10/584/610) | id | SAGNC-DB |
| Makhanda | Grahamstown / Grahamstad | 2018-06-29 | gazetted | verified | Makhanda (city, 10/587/612) | id | SAGNC-DB |
| Maletswai | Aliwal North / Aliwal-Noord | 2015-09-11 | gazetted | needs-review | Maletswai (town, 10/587/603) | id | SAGNC-DB |
| MaXesibeni | Mount Ayliff | 2016-02-09 | gazetted | verified | eMaXesibeni (Mount Ayliff) (town, 10/595/604) | id | SAGNC-DB |
| Mbizana | Bizana | 2013-12-06 | gazetted | verified | Bizana (town, 10/596/604) | id | SAGNC-DB |
| Mthatha | Umtata | ? | gazetted | needs-review | Mthatha (city, 10/593/606) | id | SAGNC-DB, [en.wikipedia.org](https://en.wikipedia.org/wiki/List_of_renamed_places_in_South_Africa) |
| Ngcobo | Engcobo | ? | gazetted | needs-review | Ngcobo (town, 10/591/607) | id | SAGNC-DB, [en.wikipedia.org](https://en.wikipedia.org/wiki/List_of_renamed_places_in_South_Africa) |
| Nieu-Bethesda | Nieu-Bethesda | ? | not gazetted (official name unchanged) | verified | Kwa Noheleni (town, 10/581/607) | id | [timeslive.co.za](https://www.timeslive.co.za/news/south-africa/2026-02-11-communities-given-a-month-to-object-to-new-town-names/), [GG54101 GN7111](https://www.gov.za/sites/default/files/gcis_document/202602/54101gon7111.pdf), [gov.za](https://www.gov.za/news/media-statements/minister-gayton-mckenzie-approval-21-geographical-name-changes-29-jan-2026) |
| Nqanqarhu | Maclear | 2021-02-22 | gazetted | verified | Nqanqarhu (town, 10/592/605) | id | SAGNC-DB |
| Nqweba | Kirkwood | 2024-03-22 · GG 50326, GN 4547 | gazetted | verified | Nqweba (town, 10/584/612) | id | [GG50326 GN4547](https://www.gov.za/sites/default/files/gcis_document/202403/50326gon4547.pdf) |
| Ntabankulu | Tabankulu | 2005-02-25 | gazetted | needs-review | Tabankulu (town, 10/595/604) | id | SAGNC-DB |
| Ntabozuko | Berlin / Berlyn | 2021-02-22 | gazetted | verified | Ntabozuko (town, 10/590/611) | id | SAGNC-DB |
| Qonce | King William's Town | 2021-02-22 | gazetted | verified | Qonce (town, 10/589/611) | id | SAGNC-DB |
| Robert Sobukwe | Graaff-Reinet | 2026-02-06 · GG 54101, GN 7111 | gazetted | verified | Robert Sobukwe Town (town, 10/581/609) | id | [GG54101 GN7111](https://www.gov.za/sites/default/files/gcis_document/202602/54101gon7111.pdf), [pmg.org.za](https://pmg.org.za/committee-question/37684/), [iol.co.za](https://iol.co.za/news/2026-05-27-afriforum-drags-mckenzie-to-court-over-graaff-reinet-name-change-to-robert-sobukwe-town/), [theherald.co.za](https://www.theherald.co.za/news/2026-07-23-legal-battles-loom-over-renaming-of-east-london-graaff-reinet/) |
| Tlokoeng | Mount Fletcher | 2021-03-16 | gazetted | verified | Tlokoeng (town, 10/593/603) | id | SAGNC-DB |
| Xamdeboo | Aberdeen | 2026-02-06 · GG 54101, GN 7111 | gazetted | verified | Xamdeboo (town, 10/580/609) | id | [GG54101 GN7111](https://www.gov.za/sites/default/files/gcis_document/202602/54101gon7111.pdf), [pmg.org.za](https://pmg.org.za/committee-question/37684/) |
| Xesi | Middledrift / Middeldrif | ? | unverified | secondary-source | Middledrift (village, 10/588/610) | id | [en.wikipedia.org](https://en.wikipedia.org/wiki/List_of_renamed_places_in_South_Africa), SAGNC-DB |

### Free State

| Official | Shown (en / af) | Date | Status | Check | Map tile | Override | Sources |
|---|---|---|---|---|---|---|---|
| Hlohlolwane | Clocolan | 2015-12-09 | gazetted | verified | Hlohlolwane (Clocolan) (town, 10/590/597) | id | SAGNC-DB |
| Mamafubedu | Petrus Steyn | 2012-11-02 | gazetted | verified | Petrus Steyn (town, 10/592/593) | id | SAGNC-DB |
| Winnie Mandela | Brandfort | 2021-08-06 | gazetted | verified | Winnie Mandela (Brandfort) (town, 10/587/597) | id | SAGNC-DB |

### Gauteng

| Official | Shown (en / af) | Date | Status | Check | Map tile | Override | Sources |
|---|---|---|---|---|---|---|---|
| Centurion | Verwoerdburg | ? | unverified | secondary-source | Centurion (town, 10/592/588) | id | [en.wikipedia.org](https://en.wikipedia.org/wiki/List_of_renamed_places_in_South_Africa) |
| Sophiatown | Triomf | 2016-06-17 | gazetted | needs-review | none | none | SAGNC-DB |
| Thembisa | Tembisa | 2016-06-17 | gazetted | verified | Thembisa (town, 10/592/588) | id | SAGNC-DB |
| Thokoza | Tokoza | 2016-06-17 | gazetted | verified | Thokoza (suburb, 12/2368/2359) | id | SAGNC-DB |

### KwaZulu-Natal

| Official | Shown (en / af) | Date | Status | Check | Map tile | Override | Sources |
|---|---|---|---|---|---|---|---|
| eMangweni | Loskop | 2011-10-07 | gazetted | verified | none | none | SAGNC-DB |
| eManzimtoti | Amanzimtoti | 2010-10-01 | gazetted | verified | Amanzimtoti (suburb, 12/2399/2406) | id | SAGNC-DB |
| eMdloti | Umdloti | 2010-10-01 | gazetted | verified | Umdloti / eMdloti (village, 10/600/600) | id | SAGNC-DB |
| eMkhomazi | Umkomaas | 2010-10-01 | gazetted | verified | Umkomaas (town, 10/599/602) | id | SAGNC-DB |
| eMkhuze | Mkuze | 2011-10-07 | gazetted | verified | Mkuze (village, 10/603/593) | id | SAGNC-DB |
| eMthenteni | Umtentweni | 2011-10-07 | gazetted | verified | Umtentweni (village, 10/598/603) | id | SAGNC-DB, [GG28458](https://www.gov.za/sites/default/files/gcis_document/201409/28458a.pdf) |
| eMthonjaneni | Melmoth | 2017-12-15 | gazetted | verified | Melmoth (town, 10/601/596) | id | SAGNC-DB |
| eMthunzini | Mtunzini | 2011-10-07 | gazetted | verified | Mtunzini (village, 10/602/598) | id | SAGNC-DB |
| eMuziwezinto | Umzinto | 2013-10-02 | gazetted | verified | Umzinto (suburb, 12/2396/2410) | id | SAGNC-DB |
| eNtshangwe | Inchanga | 2011-10-07 | gazetted | verified | Inchanga (suburb, 12/2397/2402) | id | SAGNC-DB |
| eXobho | Ixopo | 2011-10-07 | gazetted | verified | Ixopo (village, 10/597/602) | id | SAGNC-DB |
| eZimbokodweni | Umbogintwini | 2010-10-01 | gazetted | verified | Umbogintwini (town, 10/599/601) | id | SAGNC-DB |
| KwaDukuza | Stanger | 2006-02-10 · GG 28458, GN 113 | gazetted | verified | KwaDukuza (town, 10/601/599) | id | [GG28458](https://www.gov.za/sites/default/files/gcis_document/201409/28458a.pdf), SAGNC-DB |
| KwaGingindlovu | Gingindlovu | 2009-09-18 | gazetted | verified | Gingindlovu (village, 10/601/598) | id | SAGNC-DB |
| KwaKhangela | Congella | 2010-10-01 | gazetted | verified | Congella (suburb, 12/2400/2404) | id | SAGNC-DB |
| oThongathi | Tongaat | 2010-10-01 | gazetted | verified | oThongathi (town, 10/600/600) | id | SAGNC-DB |
| Solomon Linda | Pomeroy | 2022-08-26 | gazetted | verified | Pomeroy (village, 10/598/596) | id | SAGNC-DB |
| uMhlanga Rocks | Umhlanga Rocks | 2010-10-01 | gazetted | verified | Umhlanga Rocks (town, 10/600/600) | id | SAGNC-DB |
| uMnambithi | Ladysmith | 2024-03-22 · GG 50326, GN 4547 | gazetted | verified | uMnambithi (city, 10/596/596) | id | [GG50326 GN4547](https://www.gov.za/sites/default/files/gcis_document/202403/50326gon4547.pdf) |

### Limpopo

| Official | Shown (en / af) | Date | Status | Check | Map tile | Override | Sources |
|---|---|---|---|---|---|---|---|
| Bela-Bela | Warmbaths / Warmbad | 2006-07-27 | gazetted | needs-review | Bela-Bela (town, 10/592/585) | id | SAGNC-DB, [news24.com](https://www.news24.com/all-but-2-limpopo-towns-renamed-20050628) |
| Lephalale | Ellisras | 2002-05-01 | gazetted | verified | Lephalale (town, 10/590/581) | id | SAGNC-DB |
| Louis Trichardt | Louis Trichardt | 2014-11-25 | reversed | verified | Louis Trichardt (city, 10/597/579) | none | [GG38244 GN945](https://www.gov.za/sites/default/files/gcis_document/201411/38244gon945.pdf) |
| Modimolle | Nylstroom | 2002-05-01 | gazetted | verified | Modimolle (town, 10/592/584) | id | SAGNC-DB |
| Modjadjiskloof | Duiwelskloof | ? | unverified | needs-review | Modjadjiskloof (village, 10/597/581) | id | SAGNC-DB, [news24.com](https://www.news24.com/all-but-2-limpopo-towns-renamed-20050628) |
| Mogwadi | Dendron | 2002-10-01 | gazetted | verified | Mogwadi (town, 10/595/580) | id | SAGNC-DB |
| Mokopane | Potgietersrus | 2002-05-01 | gazetted | verified | Mokopane (city, 10/594/582) | id | SAGNC-DB |
| Mookgophong | Naboomspruit | 2006-11-24 | gazetted | verified | Mookgophong (town, 10/593/583) | id | SAGNC-DB |
| Morebeng | Soekmekaar | 2002-10-01 | gazetted | verified | Soekmekaar (Morebeng) (village, 10/597/580) | id | SAGNC-DB |
| Musina | Messina | 2002-05-01 | gazetted | needs-review | Musina (city, 10/597/577) | id | SAGNC-DB |
| Polokwane | Pietersburg | 2002-05-01 | gazetted | verified | Polokwane (city, 10/595/582) | id | SAGNC-DB, [news24.com](https://www.news24.com/all-but-2-limpopo-towns-renamed-20050628) |
| Senwabarwana | Bochum | ? | unverified | needs-review | Senwabarwana (town, 10/594/580) | id | SAGNC-DB, [news24.com](https://www.news24.com/all-but-2-limpopo-towns-renamed-20050628) |
| Thabana | Vrieskraal | 2006-02-10 · GG 28458, GN 113 | gazetted | verified | Thabana (suburb, 12/2379/2342) | id | [GG28458](https://www.gov.za/sites/default/files/gcis_document/201409/28458a.pdf), SAGNC-DB |
| Vaalwater | Vaalwater | ? | reversed | secondary-source | Vaalwater (town, 10/591/583) | none | [en.wikipedia.org](https://en.wikipedia.org/wiki/Vaalwater) |

### Mpumalanga

| Official | Shown (en / af) | Date | Status | Check | Map tile | Override | Sources |
|---|---|---|---|---|---|---|---|
| eMakhazeni | Belfast | 2009-10-16 | gazetted | needs-review | eMakhazeni (town, 10/597/587) | id | [sanews.gov.za](https://www.sanews.gov.za/features/nelspruit-be-officially-renamed-mbombela) |
| eMalahleni | Witbank | 2006-02-10 · GG 28458, GN 113 | gazetted | verified | eMalahleni (city, 10/595/588) | id | [GG28458](https://www.gov.za/sites/default/files/gcis_document/201409/28458a.pdf), SAGNC-DB |
| eManzana | Badplaas | 2009-09-18 | gazetted | verified | Badplaas (town, 10/598/588) | id | SAGNC-DB |
| Emgwenya | Waterval Boven / Waterval-Boven | 2009-10-16 | gazetted | needs-review | Waterval Boven (town, 10/598/587) | id | [sanews.gov.za](https://www.sanews.gov.za/features/nelspruit-be-officially-renamed-mbombela) |
| Emjejane | Hectorspruit | ? | unverified | needs-review | Hectorspruit (village, 10/602/586) | id | SAGNC-DB |
| eMkhondo | Piet Retief | 2010-01-29 | gazetted | verified | Piet Retief (town, 10/599/591) | id | SAGNC-DB |
| Emtfuntini | Langeloop | 2005-02-25 | gazetted | verified | none | none | SAGNC-DB |
| eMvelo | Amsterdam | 2019-12-17 | gazetted | verified | Amsterdam (town, 10/599/590) | id | SAGNC-DB |
| eNtokozweni | Machadodorp | 2009-10-16 | gazetted | needs-review | Machadodorp (town, 10/598/587) | id | [sanews.gov.za](https://www.sanews.gov.za/features/nelspruit-be-officially-renamed-mbombela) |
| Etjelembube | Hartebeeskop | 2011-10-07 | gazetted | verified | none | none | SAGNC-DB |
| Ga-Nala | Kriel | 2006-02-10 · GG 28458, GN 113 | gazetted | verified | Kriel (town, 10/595/589) | id | [GG28458](https://www.gov.za/sites/default/files/gcis_document/201409/28458a.pdf), SAGNC-DB |
| Kamatsamo | Schoemansdal | 2006-02-10 · GG 28458, GN 113 | gazetted | verified | none | none | [GG28458](https://www.gov.za/sites/default/files/gcis_document/201409/28458a.pdf) |
| Magogeni | Jeppe's Reef / Jeppesrif | 2003-05-15 | gazetted | needs-review | Jeppe's Reef (town, 10/601/587) | id | SAGNC-DB |
| Malalane | Malelane | 2006-02-10 | gazetted | verified | Malalane (town, 10/601/587) | id | [GG28458](https://www.gov.za/sites/default/files/gcis_document/201409/28458a.pdf) |
| Maphundlwane | Oshoek | 2011-10-07 | gazetted | verified | none | none | SAGNC-DB |
| Mashishing | Lydenburg | 2006-06-30 | gazetted | verified | Lydenburg (town, 10/598/585) | id | SAGNC-DB |
| Mbombela | Nelspruit | 2009-10-16 | gazetted | verified | Mbombela (Nelspruit) (city, 10/600/586) | id | SAGNC-DB, [sanews.gov.za](https://www.sanews.gov.za/features/nelspruit-be-officially-renamed-mbombela) |
| Mhlambanyatsi | Buffelspruit | 2003-05-15 | gazetted | verified | Buffelspruit (suburb, 12/2405/2349) | id | SAGNC-DB |
| Mmaduma | Greenside | 2005-02-25 | gazetted | needs-review | Greenside (suburb, 12/2370/2344) | id | SAGNC-DB |
| Nthorwane | Greylingstad | 2013-03-28 | gazetted | verified | Greylingstad (town, 10/593/591) | id | SAGNC-DB |
| Thaba-Kgwali | Grootvlei | 2013-03-28 | gazetted | verified | Grootvlei (village, 10/593/591) | id | SAGNC-DB |
| Thuli Fakude | Leandra | 2016-02-09 | gazetted | verified | Leandra (suburb, 12/2377/2359) | id | SAGNC-DB |

### North West

| Official | Shown (en / af) | Date | Status | Check | Map tile | Override | Sources |
|---|---|---|---|---|---|---|---|
| Lethabong | Hartbeesfontein | 2004-05-28 | gazetted | needs-review | Hartbeesfontein (suburb, 12/2348/2364) | id | SAGNC-DB |
| Mahikeng | Mafikeng | 2010-01-29 | gazetted | needs-review | Mahikeng (city, 10/584/588) | id | SAGNC-DB |
| Rentse Village | Goedgewonden | 2010-10-01 | gazetted | verified | none | none | SAGNC-DB |

### Western Cape

| Official | Shown (en / af) | Date | Status | Check | Map tile | Override | Sources |
|---|---|---|---|---|---|---|---|
| Bo-Kaap | Schotschekloof | ? | gazetted | needs-review | Bo-Kaap (Schotschekloof) (suburb, 12/2257/2458) | id | SAGNC-DB |
| District Six | Zonnebloem | 2019-12-17 | gazetted | verified | District Six (suburb, 12/2257/2458) | id | SAGNC-DB |
| Tesselaarsdal | Teslaarsdal | 2016-12-09 | gazetted | needs-review | Tesselaarsdal (village, 10/567/616) | id | SAGNC-DB |

## Excluded: not applied

| Name on map | Former / municipality | Province | Category | Reason | Ruling |
|---|---|---|---|---|---|
| Pretoria | Tshwane | Gauteng | municipality-only | City of Tshwane is the metro name; SAGNC DB 2010-01-29 registers 'Tshwane' as 'Registration of a municipality'; Pretoria not renamed. | Stays excluded (2026-09-24): a municipality or metro name, not a place renaming. |
| Durban | eThekwini | KwaZulu-Natal | municipality-only | eThekwini is the metro name; no town renaming record in the SAGNC DB. | Stays excluded (2026-09-24): a municipality or metro name, not a place renaming. |
| Bloemfontein | Mangaung | Free State | municipality-only | Mangaung is the metro name; no town renaming record in the SAGNC DB. | Stays excluded (2026-09-24): a municipality or metro name, not a place renaming. |
| Potchefstroom | Tlokwe | North West | municipality-only | Tlokwe was the local municipality (now JB Marks); no town renaming record. | Stays excluded (2026-09-24): a municipality or metro name, not a place renaming. |
| Klerksdorp | Matlosana | North West | municipality-only | City of Matlosana is the municipality; no town renaming record. | Stays excluded (2026-09-24): a municipality or metro name, not a place renaming. |
| Phalaborwa | Ba-Phalaborwa | Limpopo | municipality-only | Ba-Phalaborwa is the municipality (press listed it as a town change in 2005); no town renaming record in the DB. | Stays excluded (2026-09-24): a municipality or metro name, not a place renaming. |
| Pietermaritzburg | Msunduzi | KwaZulu-Natal | municipality-only | Msunduzi is the municipality; no town renaming record. | Stays excluded (2026-09-24): a municipality or metro name, not a place renaming. |
| Kimberley | Sol Plaatje | Northern Cape | municipality-only | Sol Plaatje is the municipality; no town renaming record. | Stays excluded (2026-09-24): a municipality or metro name, not a place renaming. |
| Lulama Hlanjwa | — | Eastern Cape | newly-registered | GG 54101 GN 7110: 'registration of new name' (settlement); no former name. | Stays excluded (2026-09-24): registration of an existing or new name; there is no former name. |
| Nkululeko | — | Eastern Cape | newly-registered | GG 54101 GN 7110: 'registration of new name' (settlement); no former name. | Stays excluded (2026-09-24): registration of an existing or new name; there is no former name. |
| Ray Nkonyeni LM village/river names (12) | — | KwaZulu-Natal | newly-registered | GG 54101 GN 7109: registrations of existing names; no former names. | Stays excluded (2026-09-24): registration of an existing or new name; there is no former name. |
| Mbombela-area settlements (Gutshwa, Mvangatini, Mgcobaneni, Mbonisweni …) | — | Mpumalanga | newly-registered | GG 50326 GN 4547: 'Registration of existing name'. | Stays excluded (2026-09-24): registration of an existing or new name; there is no former name. |
| Tshoxa | — | Eastern Cape | newly-registered | SAGNC DB 2019-03-22: 'Registration of a long standing name'. | Stays excluded (2026-09-24): registration of an existing or new name; there is no former name. |

## Coverage

| Province | Entries | Excluded | Gaps |
|---|---|---|---|
| Eastern Cape | 35 | 3 | ~120 village/area-level respellings and renamings (2004–2021) in the SAGNC DB not processed (mostly Xhosa orthography corrections).<br>Remaining notices of the 21 names approved 2026-01-26 not all located (only GN 7109/7110/7111).<br>Butterworth→Gcuwa, Middledrift→Xesi, Braunschweig→Eluphendweni not verifiable from primary sources.<br>No SAGNC DB extract after 2024-03-01; only gazettes found by search were checked for 2024–2026. |
| Free State | 3 | 1 | Botshabelo section renamings (2015) and small settlements not processed. |
| Gauteng | 4 | 1 | ~45 township/settlement respellings (2016) in the DB not processed; Verwoerdburg→Centurion (1995) unverified.<br>Sophiatown and Triomf not present in the place layer of the tiles. |
| KwaZulu-Natal | 19 | 3 | ~200 village-level e-/Kwa- respellings in the DB not processed individually; only notable towns listed as corrections.<br>Remaining KZN names of the Jan-2026 batch beyond GN 7109 not located. |
| Limpopo | 14 | 1 | Original 2002–2005 gazette notices not located; dates rest on the SAGNC DB.<br>Duiwelskloof→Modjadjiskloof and Bochum→Senwabarwana lack a primary record.<br>~25 village renamings (2005) not processed.<br>Hoedspruit→Marulaneng reported as pending in 2005; status unknown. |
| Mpumalanga | 22 | 1 | 16 Oct 2009 gazette (42 names) not located; Belfast/Machadodorp/Waterval Boven rely on SAnews.<br>~90 village/farm-name renamings (2005–2021) not processed individually.<br>Hectorspruit→Emjejane unconfirmed. |
| North West | 3 | 2 | Village renamings (2008–2016) such as Austrey→Mosinki not processed. |
| Northern Cape | 0 | 1 | No settlement renamings found in the SAGNC DB (9 rows, none with a previous name) or Wikipedia list; not independently searched in provincial gazettes. |
| Western Cape | 3 | 0 | Provincial gazette not searched; only the SAGNC DB and Wikipedia list checked. |

Sources checked in every province: the DSAC SAGNC Names Complete Database (to 2024-03-01); the Wikipedia *List of renamed places in South Africa*, used only as an index of candidates; and the Government Gazette notices found by search (GG 28458/2006, GG 38244/2014, GG 50326/2024, GG 54101/2026). Provincial gazettes were **not** searched systematically. **This registry is not complete.** Several hundred village-level changes in the database are listed as gaps, not processed.

## Open research questions (per entry)

These do not change what the map shows; they are about dates and spellings.

- **Enxuba** (Eastern Cape): Official spelling Enxuba (DB) vs Nxuba (OSM/press).
- **Maletswai** (Eastern Cape): Maletswai was also the pre-2016 local municipality name; confirm the town notice (DB says town).
- **Robert Sobukwe** (Eastern Cape): Official name 'Robert Sobukwe' vs 'Robert Sobukwe Town'?
- **Bela-Bela** (Limpopo): Original gazette date (2002?) not located.
- **Modjadjiskloof** (Limpopo): No primary record linking Duiwelskloof → Modjadjiskloof found.
- **Polokwane** (Limpopo): Confirm gazette date (DB 2002-05-01 vs press 2003/2005).
- **eMakhazeni** (Mpumalanga): Gazette number of the 16 Oct 2009 notice not located.
- **Magogeni** (Mpumalanga): DB says 'Jeppes Rust'; OSM/common usage 'Jeppe's Reef' – same place?
- **Nthorwane** (Mpumalanga): Official spelling Nthrowane (DB) vs Nthorwane (press).
- **Lethabong** (North West): Did the town itself get renamed, or only the township?
- **Bo-Kaap** (Western Cape): Date missing in DB.
