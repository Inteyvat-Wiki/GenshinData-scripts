# Misc client text catalogue

`extractMisc.js` is a CommonJS collator for the standard `exportData` writer.
`misc.js` is its targeted CHS/EN entry point, using the same TextMap history
builder as `main.js`. Both ordinary and Medium TextMaps come from `getLanguage`.
No Wiki modules, server mail history, game images or Lua are read or copied.

Commands (exports and indexing are deliberately separate):

Prepare the profile-frame resource cache first, following `resources/README.md`.
The export resolves each exact UInt64 `iconPathHash` through that cache, retaining
the original hash and adding a `resource_icon` asset name with block/PathID provenance.
Stale inputs and missing keys fail explicitly; downstream consumers need no raw data.

```text
npm run test:misc
npm run export:misc
```

Tests only extract into memory and read the configured source snapshot. They do
not write exports, build TextMap history, or generate genshin-db indices.
`node --test extract/misc/schema.test.js` runs the hermetic old/current/arbitrarily
renamed schema, missing/ambiguous witness and graph cases without raw data or
resource caches. Its image-plan CLI test writes only a disposable fixture directory.
The full
`node --test extract/misc/*.test.js` additionally checks exact source-derived ID
sets, text, relationships, graph edges and visibility in CHS/EN, not fixed 7.1
row counts. A stale default profile-frame cache still fails: for isolated tests,
prepare a new cache in a temporary directory using `resources/profile-frames.js`
and set `PROFILE_FRAME_RESOURCE_CACHE` to it. Do not edit cache digests or bypass
resource validation. The existing 7.1 index/map resolves all twelve current 7.2
frame keys; this is not a claim that a 7.2 client resource map was inspected.
Exact uint64 parsing requires Node's JSON.parse reviver context (Node 22+);
unsupported runtimes fail rather than stringify an already-rounded number.

## Contract

Each object is keyed by `type-realSourceId` and contains exactly `id`, `order`,
`show`, `type`, `name`, `description`, `sections`, `images`, `relations`, `source`,
and optional `diagnostics`/standard inferred `version`/`loading_situations`,
`tutorial_category` or `message_thread`. There are no ArchiveRecord layout fields,
numeric rewards, progress targets, costs or timestamps.
`source.id` and TextMap hashes are strings. Relations may carry a numeric, safe
integer `source_id`; relation `id` is always a string. No image URLs are emitted.

Achievement descriptions resolve `{param0}` from that stage's `progress` target
and omit PS5-specific titles (including their TextMap version dependencies).
This happens upstream, preserving the original description hash for provenance/version tracking.
The target is not exported as a separate numeric field; missing or invalid targets
fail extraction instead of silently inventing a number. Trigger parameters are not
description parameters. Profile pictures 1, 2, 11 and 21 normalize their name's `{0}` to `{NICKNAME}`;
6000 uses `{REALNAME[ID(1)]}`. Each observed record/avatar pair is validated against
the name-avatar field inferred from the known base/costume portrait values,
while the original TextMap hash remains the version/provenance dependency. Other numeric placeholders stay untouched.
Other TextMap prose is intentionally unmodified, including literal `\n`, markup,
platform tokens and background text. Missing text is never filled from another
language or fabricated from an ID. Unnamed records normally use `show: false`;
tutorials remain visible if they have any platform body text or image, keeping
`name: ''` and the missing-name diagnostic for an explicit consumer UI label.
Apart from the reviewed exceptions below, only tutorials with neither body text
nor images are hidden. Titleless body/image-only membership is checked directly
against platform detail lists and push records; test profile pictures stay hidden.
Seven snapshot-calibrated exceptions in misc/tutorials.js retain their records
and unresolved image references but have show=false: they have no CHS/EN title
or prose and no current image resources. Detail-list or text changes fail the
exception guard so restored content is reviewed, not silently hidden. In
particular, tutorial 1172's missing detail 1172003 is NOT guessed as 117203.
`source.hashes` retains missing TextMap slots as provenance; only resolved hashes
are passed to `versions/tracking.attach`, avoiding false version dependencies.
Non-TextMap resource hashes, asset names, table FKs and raw stage/type references
are in `source.references`. Unsafe integers are parsed from their original JSON
lexemes and remain exact decimal strings, including image names.

| Type | Source table | Selection / special handling |
| --- | --- | --- |
| achievement | AchievementExcelConfigData | Legacy valid-stage selection, never same-name merging; reciprocal previous_stage/next_stage relations |
| achievement_group | AchievementGoalExcelConfigData | Source orderId order; default ID 0; reciprocal links to all retained member achievements |
| namecard | MaterialExcelConfigData | MATERIAL_NAMECARD; text/acquisition from MaterialSourceDataExcelConfigData; ID is material ID |
| profile_picture | ProfilePictureExcelConfigData | Test 99999 kept with original name and show=false; no renamed avatar fallback |
| profile_frame | ProfileFrameExcelConfigData | Original name, unlock text, exact iconPathHash plus resolved resource_icon |
| expedition | ExpeditionDataExcelConfigData | Text, picture, city name/relation only |
| gallant_path | LocalLegendExcelConfigData | Only this catalogue, not all named enemies; all Monster→MonsterDescribe icons marked monster_icon |
| loading_tip | LoadingTipsExcelConfigData | 1940–1948 deferred; 12 lore rows 1928–1939 retained and related to miliastra |
| tutorial | TutorialExcelConfigData | All rows except those with explicit By[d] resource evidence |
| graeae_message | TpsGlassesChatTopicExcelConfigData | Named topics with text/images visible; empty topics retained upstream |
Client mail templates are no longer exported. Historical character letters remain unimplemented; Mail source inputs are not removed.

## Foreign keys and source-field calibration

`schema.js` and `graeae-schema.js` infer keys using `resolveRow` and `resolveField`
from `extract/field-inference.js`. Exact source-known values identify witness rows
and property keys; multiple witnesses intersect their candidates where one row
is ambiguous. There is no runtime old/new alias list, preferred spelling or fallback.
Missing witnesses, duplicate witness rows and multiple candidate keys fail,
including two keys with identical values. Ordinary protobuf-default omissions
outside calibration witnesses retain their existing optional-field behavior.
Duplicate indexed source identities also fail instead of choosing the last row.

Both schema modules are pure: no global/source loading and no inferred-key cache.
Call them with the current table's rows, not a different snapshot's rows or an
arbitrary filtered subset without the witnesses. An empty table returns `{}`;
a nonempty table without the required calibration evidence fails explicitly.
`resolveMaterialSourceFields(rows) -> { jumpDescs: key }` is also exported for
other upstream material/quest consumers. Full arrays use exact deep equality;
unrelated arrays, broad numeric namespaces and translated strings are not semantic
evidence. Enum values such as `TEXT`/`IMAGE` are values, not property-key aliases.
Unconsumed obfuscated fields gain no guessed semantics from this calibration.

The following witnesses were checked against raw-source commits `c5ef717b774`
(7.1) and `bd35e243fa4` (7.2):

| Table / inferred fields | Source-known witnesses |
| --- | --- |
| MaterialSource jump descriptions | ID 210001: `[3428310340,1366389946,3237647833,326911317,696736979,1009452272,549049380]` |
| ProfilePicture name avatar / unlock type | IDs 1 and 11 both have name-avatar 10000005, but unlock types AVATAR/COSTUME and unlockParam 10000005/200501; intersection distinguishes avatar from unlockParam |
| LocalLegend resource / monsters | ID 101: exact UInt64 string `589278960941904205`; monster 22132001, scalar or singleton list |
| LoadingSituation dungeon IDs | stageID 65: `[156]`; stageID 66: `[149,150,151]` |
| Graeae Topic ID / title / icon | Title hash 562223715 locates topic 1001; topic 1 names the exact chat icon resource |
| Graeae Message identity / graph / text | Full hash 3421014762 locates message 100101 (topic 1001, position 1, next 2, preview 505105052); message 100102 has position 3 and requires option 1001011, distinguishing position from characterId |
| Graeae Message kind / attachments / location | Message 15005 has kind IMAGE and exact TreasureMap full/thumbnail paths; message 5008 has location hash 1008191327 and quest reference 77130 |
| Graeae Option ID / graph / text | Text hash 4069531165 locates option 1001011 (topic 1001, position 2, next 3); option 10010 requires 10002 |
| Graeae Character name / icon | characterId 1: name hash 1264548403 and exact GreyEye NPC icon path |

The historical field correspondences were calibrated against `c5ef717b774` (7.1)
and `bd35e243fa4` (7.2), matching unique record IDs, then comparing every shared
row's values and field presence. All mapped values agreed: 188 profile rows
(five name-avatar fields), 13 legends (scalar IDs equal singleton lists), 107
loading situations (two dungeon selectors), 28 Graeae topics, 421 messages,
49 options and four characters. Current-source tests separately verify the
actual target-table joins, including new records; these historical counts are
calibration evidence, not test expectations.

### Witness-inference validation (2026-11-04)

- `node --test extract/misc/*.test.js`: 36/36 passed (19 live + 17 hermetic).
  Two independent per-table renamings of all private keys, plus the formerly
  aliased semantic keys, preserve full CHS/EN records and version dependencies.
  Missing/ambiguous fields and rows fail; multi-row disambiguation and input
  isolation are exercised without changing enum values.
- Read-only Git-source checks of all eight affected tables at both revisions:
  7.1 has 28 Graeae topics / 421 messages / 49 options; 7.2 has 33 / 462 / 55.
  Each revision's affected-record output remains deeply equal in CHS/EN after
  arbitrary table-local renaming. The two full attachment names in each revision
  match an independent raw-field oracle before and after renaming.
- The resource preparer's actual CLI handles renamed message fields, preserves
  every exact Sprite variant, records input digests, and rejects missing/duplicate
  resources, stale maps and an existing output file. No client image re-extraction
  or downstream export is performed by these checks.

### Earlier compatibility validation (2026-11-04, before witness inference)

- Old full input: read all 44 required tables plus ordinary/Medium CHS/EN
  TextMaps directly from raw Git `c5ef717b774`. The changed collator and the
  original collator/Graeae parser from GDS `d3beed75d6bc0557c9b7ce643601b95bd7a0f742`
  produced deeply equal records and equal version-dependency sets: 5,772 records
  per language. No checkout or exported files were used.
- Current full input: raw Git `bd35e243fa4`, 5,914 records per language;
  `node --test extract/misc/*.test.js` passes 30/30 (18 live + 12 hermetic).
- Verification-only cache:
  `.cache/misc-schema-verification-20261104-c86bfc34/profile-frames.json`, a fresh
  Git-ignored target. Set `PROFILE_FRAME_RESOURCE_CACHE` to its absolute path.
  It was built by `resources/profile-frames.js`, not by editing an old cache.
  Every current `(ProfileFrame.id, full iconPathHash)` pair equals its 7.1 pair;
  all 12 full-key lookups resolve uniquely to Sprites, and the fresh resource
  mappings deeply equal the previously recorded mappings (subasset/block/offset/
  exact PathID included). No 7.2 asset map is available locally; this validates
  unchanged current raw keys against the available, digest-checked 7.1 resources,
  not a fresh 7.2 client asset extraction.
- Default-cache blocker remains explicit: its recorded ProfileFrame source hash
  is `1ae31a302128e78aa57d7f602c7b9142b9e0c73ec1008942d41243245b1883ae`,
  not the current source hash below. Running without the override still fails
  stale-cache validation. The isolated verification did not overwrite the default cache.

After confirming all twelve resource mappings were unchanged, the 2026-11-04
engineering fix atomically refreshed `.cache/profile-frame-resources.json` from
that verified cache. Its previous contents remain at
`.cache/misc-schema-verification-20261104-c86bfc34/previous-default-profile-frames.json`.
The ordinary `npm run test:misc` now passes without an environment override;
the resource provenance is still the verified 7.1 client input, not a claim of 7.2 assets.

SHA-256 provenance for that verification run:

| Input / artifact | SHA-256 |
| --- | --- |
| Current ProfileFrameExcelConfigData.json | `0da543b47641d7088f205eec6c5ee579d1af9511753b179cf16897145477a582` |
| .cache/miliastra-resource-index-7.1.bin | `a9b58bd78c2edd96083b640665b6eece390497016795028ca8323a81689b3144` |
| C:/Apps/AnimeStudio/Maps/genshin_7.1.map | `6f3e6dbae79661eca0660b1092d89f68793d7969a85674762f7c0113d343f0e8` |
| .cache/miliastra-image-map-7.1.json | `b9605e2f903f7b8816b4e3fabd4629ffb0d145de4b9a0d4eab596f514a3f8b1e` |
| New verification profile-frames.json | `d89122f9cb72ff0ba1db3a8e6634561af851ad0a93b2efe44c072cbf7919e85c` |
| Unchanged .cache/profile-frame-resources.json | `6afbcbfcc2783555d1928ba6e85e3f47af5f9db2ac9b54ef687862c249e2aff8` |

### Source relationships

- Achievement `preStageAchievementId` links individual misc records; `goalId`
  links `AchievementGoalExcelConfigData`. Missing goalId represents source group
  0 (the first source goal also omits its default ID), not a made-up new group.
- Namecard source text lists are `textList` and `jumpDescs` / `HNNPIIJLLEK`.
  Missing padding slots stay in source hashes/diagnostics;
  only resolved acquisition prose becomes a section. No conditions or dungeons
  are decoded as text. Real source assertions cover every selected material.
- ProfilePicture `unlockType` / `NLAPNBMECDF` / `FBFBNKHLFAO` is the unlockType enum.
  `unlockParam` is interpreted
  ONLY through that enum: AVATAR→Avatar.id (`character`, `unlock_avatar`),
  COSTUME→AvatarCostume.skinId (`outfit`, `unlock_costume`), ITEM→Material.id
  (`material`, `unlock_material`), PARENT_QUEST→MainQuest.id (`task`, `unlock_quest`).
  DEFAULT creates no relation. `HOKCMBCOBAO` / `GEMAPGHIKKG` is not an unlock FK.
  For the five formatted names, its avatar matches either the AVATAR unlock FK
  or the COSTUME unlock target's `characterId`; every avatar exists in Avatar.
- Expedition `cityId`→CityConfigData.cityId (`region`, `region`).
- LocalLegend `monsterId` (old scalar) / `monsterIdList` (current ordered list)
  →Monster.id (`enemy`, `monster`), then Monster.describeId→MonsterDescribe.id.
  Preserve every member, including current legend 205's three explicit monsters;
  deduplicate images only, not member relationships. The original iconHash,
  `DFBBICALCFF` / `CBAPFGGBHEA`
  resource hash and prefabName are retained, but unverified dedicated resources
  are not presented as illustrations. Every entry diagnoses the unresolved
  dedicated illustration. A generic monster icon is only `kind: monster_icon`.
  Current legend 206 points to Monster 28021801, whose describeId 28021801 has
  no MonsterDescribe row. Keep the FK and `missing_monster_describe:28021801`
  diagnostic with no invented icon. Tests assert exact source-derived missing
  descriptions as well as every available icon; they do not skip broken links.
- Loading `stageID` accepts only a complete comma-separated list of positive IDs
  and joins LoadingSituation.stageID. Preserve all distinct picPath backgrounds.
  Malformed rows 1049/1238 keep their raw stage expression and diagnose it;
  do not partially split/guess spreadsheet expressions. Missing stages diagnose
  separately. Valid but unmatched stage IDs retain their FKs and diagnose them.
  Resolved stages also expose `loading_situations` with the original behavior enum,
  optional terrain enum, and plain region names. `area1ID` joins only LEVEL_1 rows
  in WorldAreaConfigData, constrained by sceneID when present; non-unique/missing
  area matches fail explicitly. Region TextMap hashes participate in provenance
  and version tracking. These three dimensions are not a full trigger evaluator:
  scene, dungeon and other situation conditions must still be consulted upstream.
  Situation scene IDs and dungeonType are retained explicitly. This snapshot's
  `LLPOIIOJKOC` / `CLKAAOHKPBH` selector resolves exact DungeonExcelConfigData IDs,
  retaining source names/hashes without a guessed display-name fallback. Missing
  dungeon FKs fail. `LLNOODHGHAM` / `HEIDBEEFNBP` contains loading-tip IDs, NOT dungeon IDs; it is
  deliberately not interpreted as a dungeon selector or a replacement for stageID.
  Each situation's optional `image` is its own picPath reference, also retained in
  the record-wide deduplicated images list. Wiki-data resolves it through the same
  image pipeline; consumers must not infer the association from names or array order.
- Other relation categories (`outfit`, `region`, `enemy`,
  `loading_situation`, `miliastra`) are explicit source identities, not assurances
  of Wiki pages. Consumers may keep them unresolved; no guessed page aliases.

## Tutorial fidelity and deferral boundary

Titles follow PushTipsConfigData / NewActivityPushTipsConfigData.tutorialId→Tutorial.id. Multiple push records
are preserved as source references with alternate title/subtitle sections.
Tutorial 1771 deliberately points to detail IDs 177001–177003: no ID arithmetic.
The activity table supplies additional source titles; maintained downstream page
IDs are deliberately unchanged.

One coarse classification is emitted: CODEX_ELEMENT, CODEX_ENEMY, CODEX_SYSTEM,
CODEX_ADVENTURE, TUTORIAL_ACTIVITY or TUTORIAL_OTHER. Effective codex entries take
priority. Activity membership uses explicit activity-push/preview and calibrated
gameplay-table foreign keys (see tutorials.js), never name/ID heuristics.
This is not a permanent/limited-time lifecycle assertion. Downstream maps these
six source keys explicitly to its own namespace and exposes one filter only.

`detailIdList`, `mobileDetailIdList`, `joypadDetailIdList` are read separately,
with section kind/title `PC`, `Mobile`, `PS` and image kind of the same platform.
No fallback to PC details or cross-platform image deduplication is performed.
Within a platform, sections retain detail-list order, even for absent rows or
missing descriptions. Images from textless details survive. All detail FKs and
available description hashes are retained. The primary/default detail list is
used for the combined description; all platform prose remains in sections.

This source exposes no uniform Miliastra-only tutorial classification. The
current proven exclusions are Tutorial→Detail image references in the explicit
`UI_Tutorial_Byd*` / `UI_Activity_Byd*` namespace: 2419, 2420, 2430, 2556, 2557,
2659, 2660, 2661. Tests independently verify this evidence. Titles, ID ranges and
generic `UGC` are never exclusion criteria; older UGC event tutorials stay.
This does NOT claim complete identification of hypothetical text-only exclusive
tutorials without resource/classification evidence. BeyondInstructionManual
contains web-manual links, not a Tutorial foreign key, and is not crawled.

## Eye of Graeae messages

graeae.js joins Topic, Message, Option and Character tables using the keys inferred
by `graeae-schema.js` from source-known witnesses. Full message text and preview
are distinct fields; the preview is retained separately. Source
message/option global IDs become distinct `message-` / `option-` node IDs.
Message/option positions and next positions are topic-local, not global IDs.
The required-option field references a selected option's global ID.
Textless control nodes survive so the downstream browser follows the exact graph.
All edges and selected-option requirements are validated within their topic.
Images use the inferred full-attachment field, not the thumbnail field; location
labels are retained without guessing coordinates, tasks or numerical rewards.

The following 7.1→7.2 table is historical evidence only, not a runtime alias
table. Neither spelling is used by the production resolver, collator or image
preparer. Topic, message, option and character IDs must each be unique; orphan
messages/options, missing successors/required options and unknown kinds fail.
Multiple options at the same local position are valid branches, not duplicate IDs.

| Meaning | 7.1 | 7.2 |
| --- | --- | --- |
| Topic ID / title / icon | KEKHMPOIFHO / LBCPBPBJDAB / DGKPMJKEGDO | CNMPAADJIFL / JDMOCEGAAGK / OEOMPAGFEJM |
| Message ID / topic / position | AEFJCKAJMFL / HAOFOHIJENC / JJGAICEDLNP | JCAHMOFECFE / DILKJNMPNFL / PKHEFFOICKC |
| Next position / required option | LICNBELGBCN / PADEPANADLD | HLFBKDKAAGG / OLFMIDDKIKO |
| Full text / preview / kind | GEJENCICCEC / DBMAKNMIGLP / FJHBPBFGDNN | AHDCIPDCMFP / CHDGFMBOPPP / FGICGCKEFAK |
| Full image / thumbnail | HCHADPEJPLB / HEEHCBAOFIK | HLFGNGHKCJD / EAKBCADOOLA |
| Location label / quest reference | PJIDDONOIGK / EDGLCIBPKNJ | HNEAFCKDCMA / OAPNJMAJKBM |
| Option ID / position / text | HANOBLDBAPA / BHLEPODADCG / KLDJCKFKAKI | MEEMNJEJMPJ / CPONCLDGFED / MDJJHKLDBJE |
| Character name / icon | HALPCBNIPJP / IMPGHHNHBBD | AMPOJAAMOBL / AKMEGJBMBMP |

To extract the named attachment variants, use the shared extractor/importer:
`node resources/prepare-graeae-images.js SOURCE ASSET_MAP NEW_CACHE`, then
`node resources/extract-miliastra-images.js NEW_CACHE NEW_OUTPUT`.
The preparer calls the same pure `resolveGraeaeFields('Message', rows)` function
as the collator; it must receive the complete message table with its witnesses.
It never loads global, guesses IMAGE keys from their spelling or falls back to
historical full-image/thumbnail aliases.
The plan records exact Sprite identities and snapshot digests, requesting both
same-name variants. Its explicit `image_selection: largest` policy lets the
common Wiki-data importer select by pixel area, encoded size, then path; all
candidates remain in the extraction directory and validation report.
