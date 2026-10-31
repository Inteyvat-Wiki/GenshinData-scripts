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
6000 uses `{REALNAME[ID(1)]}`. Each observed record/avatar pair is validated against `HOKCMBCOBAO`,
while the original TextMap hash remains the version/provenance dependency. Other numeric placeholders stay untouched.
Other TextMap prose is intentionally unmodified, including literal `\n`, markup,
platform tokens and background text. Missing text is never filled from another
language or fabricated from an ID. Unnamed records normally use `show: false`;
tutorials remain visible if they have any platform body text or image, keeping
`name: ''` and the missing-name diagnostic for an explicit consumer UI label.
Only tutorials with neither body text nor images are hidden. All 212 CHS / 220 EN
titleless tutorials with body text, and 169 CHS / 200 EN titleless image-only
tutorials remain visible; test profile pictures stay hidden.
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

| Type | Source table | Current count | Selection / special handling |
| --- | --- | ---: | --- |
| achievement | AchievementExcelConfigData | 1854 | Legacy valid-stage selection, never same-name merging; reciprocal previous_stage/next_stage relations |
| achievement_group | AchievementGoalExcelConfigData | 73 | Source orderId order; default ID 0; reciprocal links to all retained member achievements |
| namecard | MaterialExcelConfigData | 293 | MATERIAL_NAMECARD; text/acquisition from MaterialSourceDataExcelConfigData; ID is material ID |
| profile_picture | ProfilePictureExcelConfigData | 188 | Test 99999 kept with original name and show=false; no renamed avatar fallback |
| profile_frame | ProfileFrameExcelConfigData | 12 | Original name, unlock text, exact iconPathHash plus resolved resource_icon |
| expedition | ExpeditionDataExcelConfigData | 48 | Text, picture, city name/relation only |
| gallant_path | LocalLegendExcelConfigData | 13 | Only this catalogue, not all named enemies; Monster→MonsterDescribe icon marked monster_icon |
| loading_tip | LoadingTipsExcelConfigData | 995 | 1940–1948 deferred; 12 lore rows 1928–1939 retained and related to miliastra |
| tutorial | TutorialExcelConfigData | 2268 | All rows except 8 with explicit By[d] resource evidence |
| graeae_message | TpsGlassesChatTopicExcelConfigData | 28 | 24 translated topics visible; 4 empty topics retained upstream |
Client mail templates are no longer exported. Historical character letters remain unimplemented; Mail source inputs are not removed.

## Foreign keys and source-field calibration

- Achievement `preStageAchievementId` links individual misc records; `goalId`
  links `AchievementGoalExcelConfigData`. Missing goalId represents source group
  0 (the first source goal also omits its default ID), not a made-up new group.
- Namecard source text lists are `textList` and this revision's `HNNPIIJLLEK`
  (legacy `jumpDescs`). Missing padding slots stay in source hashes/diagnostics;
  only resolved acquisition prose becomes a section. No conditions or dungeons
  are decoded as text. Real source assertions cover every selected material.
- ProfilePicture `NLAPNBMECDF` is the unlockType enum. `unlockParam` is interpreted
  ONLY through that enum: AVATAR→Avatar.id (`character`, `unlock_avatar`),
  COSTUME→AvatarCostume.skinId (`outfit`, `unlock_costume`), ITEM→Material.id
  (`material`, `unlock_material`), PARENT_QUEST→MainQuest.id (`task`, `unlock_quest`).
  DEFAULT creates no relation. `HOKCMBCOBAO` is not an unlock FK.
- Expedition `cityId`→CityConfigData.cityId (`region`, `region`).
- LocalLegend `monsterId`→Monster.id (`enemy`, `monster`), then
  Monster.describeId→MonsterDescribe.id. The original iconHash, DFBBICALCFF
  resource hash and prefabName are retained, but unverified dedicated resources
  are not presented as illustrations. Every entry diagnoses the unresolved
  dedicated illustration. A generic monster icon is only `kind: monster_icon`.
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
  LLPOIIOJKOC selector resolves exact DungeonExcelConfigData IDs (149/150/151/156),
  retaining source names/hashes without a guessed display-name fallback. Missing
  dungeon FKs fail. LLNOODHGHAM contains loading-tip IDs, NOT dungeon IDs; it is
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
The activity table recovers 107 previously missing titles in each language;
maintained downstream page IDs are deliberately unchanged.

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

graeae.js joins Topic, Message, Option and Character tables. Full message text is
GEJENCICCEC; DBMAKNMIGLP is only a preview and is retained separately. Source
message/option global IDs become distinct `message-` / `option-` node IDs.
JJGAICEDLNP / BHLEPODADCG and LICNBELGBCN are topic-local positions and next
positions, not global IDs. PADEPANADLD references a required selected option.
Textless control nodes survive so the downstream browser follows the exact graph.
All edges and selected-option requirements are validated within their topic.
Images use HCHADPEJPLB (full attachment), not HEEHCBAOFIK (thumbnail); location
labels are retained without guessing coordinates, tasks or numerical rewards.

To extract the named attachment variants, use the shared extractor/importer:
`node resources/prepare-graeae-images.js SOURCE ASSET_MAP NEW_CACHE`, then
`node resources/extract-miliastra-images.js NEW_CACHE NEW_OUTPUT`.
The plan records exact Sprite identities and snapshot digests, requesting both
same-name variants. Its explicit `image_selection: largest` policy lets the
common Wiki-data importer select by pixel area, encoded size, then path; all
candidates remain in the extraction directory and validation report.
