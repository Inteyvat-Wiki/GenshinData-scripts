# Resource icons

## TCG circular opponent portraits

GCGTalkDetailIcon.FLNKMCFIMKJ explicitly names circular portraits. Stage opponents
resolve that field through oppoAvatarPicId; player portraits still come only from
their linked stage opponents. There is no filename-suffix inference.
Run `node resources/prepare-tcg-portraits.js RAW_DATA IMAGE_MAP NEW_CACHE`, then
the shared extract-miliastra-images.js and Wiki-data resource-image importer.
The plan includes every exact-name Sprite candidate and selects the largest
validated variant; it never silently chooses a truncated resource hash.

World-player biography time slots are substituted upstream using
GcgWorldWorkTimeExcelConfigData.id = Npc.id. Formatting validates the hour/minute
values, preserves other placeholders, and retains original TextMap dependencies.

## Profile frames

Profile frames reuse the same full UInt64 index, asset map and image extractor.
After preparing the index/map below, run
`node resources/profile-frames.js INDEX IMAGE_MAP_JSON .cache/profile-frame-resources.json RAW_DATA`.
For a different cache filename, set `PROFILE_FRAME_RESOURCE_CACHE` before extraction/export.
Run `node resources/extract-miliastra-images.js .cache/profile-frame-resources.json NEW_OUTPUT [STUDIO]`,
then import with wiki-data's `scripts/import_miliastra_resource_images.cjs NEW_OUTPUT NEW_IMAGE_DIR`.
The historical script names also support profile-frame plans; no Miliastra tables
are required by the image extraction/import steps. Regenerate misc, rebuild the
genshin-db misc index, then regenerate wiki-data and frontend misc data.
All 12 current frames resolve to exact Sprite assets. Original `iconPathHash`
values remain in the records alongside the resolved `resource_icon` and provenance.

## Miliastra

Run resource preparation before exporting Miliastra. Text extraction stays in
GenshinData-scripts; downstream consumers only read genshin-db.

1. Extract the resource index MiHoYoBinData `0000006f` with AnimeStudio. For the
   verified 7.1 snapshot it is in `31049740.blk` (not the design index `31049741`).
2. Build `dotnet build resources/asset-map` (requires .NET 10 and AnimeStudio;
   use `-p:Studio=PATH` for a different installation).
3. Run `dotnet resources/asset-map/bin/Debug/net10.0/AssetMap.dll STUDIO MAP OUTPUT_JSON`.
   This exports all Sprite/Texture2D entries without truncating resource keys.
4. Run `node resources/miliastra.js INDEX OUTPUT_JSON .cache/miliastra-resources.json RAW_DATA`.
   Output is exclusive: use a new cache filename for updates, review it, then set
   `MILIASTRA_RESOURCE_CACHE` to that path. Inputs and generated caches are not committed.
5. Run `node --test resources/*.test.js`, `node extract/archives/check_miliastra.js`,
   then `npm run export:archives -- miliastra` and rebuild genshin-db's Miliastra index.
6. Run `node resources/extract-miliastra-images.js CACHE NEW_OUTPUT [STUDIO]`.
   It groups exact selected assets by block, writes XML plans, extracts with
   AnimeStudio using BySource, and preserves logs and provenance. It rejects
   existing output directories and split-file inputs. In wiki-data, run
   `node scripts/import_miliastra_resource_images.cjs NEW_OUTPUT NEW_IMAGE_DIR`;
   all selected PNGs must pass CRC, decompression and scanline validation before
   import. Then regenerate Miliastra into wiki-data and the frontend data folder.

The parser reads the first eight asset bytes as a little-endian UInt64 decimal
string, follows subasset ID to block and offset, and selects one Sprite (or one
Texture2D when no Sprite exists) within that exact pack. Container is only an
additional consistency check. Missing keys, duplicate keys, ambiguous images,
out-of-range packs, unsupported layouts and stale source/map/index inputs fail
explicitly; there is no name, variant-ID or truncated-hash fallback.

The cache contains SHA-256 input identities and exact block/offset/PathID evidence.
Exported records preserve their numeric hashes and add `resource_icon` names plus
`source.references` audit strings. Secondary suit resources are not treated as
primary icons. The binary layout is snapshot-specific and must be revalidated
when preparation fails on a future game update.
