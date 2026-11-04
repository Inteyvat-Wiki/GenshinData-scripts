# Resource preparation

The shared resource package documents the complete image/Lua/map workflow in
`@inteyvat-wiki/resource-tools/docs/pipeline.md` (source checkout:
`../Inteyvat-Wiki-resource-tools/docs/pipeline.md`). All game-specific resource
relations and format/version exceptions belong here, not in wiki-data or Wiki.

## Client WorldArea polygons

`node resources/world-areas.js PLAN.json` prepares the mandatory WorldArea cache.
The plan contains `sourceRoot`, `studio`, `map` and a new `output` directory.
An existing verified `readAssetMap` JSON can be supplied as `assetMap` instead
of `map`. Example:

```json
{
  "sourceRoot": "D:/genshin data",
  "studio": "C:/Apps/AnimeStudio",
  "map": "C:/Apps/AnimeStudio/Maps/genshin_7.1.map",
  "output": "D:/GenshinData-scripts/.cache/world-areas-client"
}
```

The preparer selects every scene referenced by `WorldAreaConfigData`, resolves
the full 64-bit path key through the client design index, and asks resource-tools
to extract only the exact MiHoYoBinData payloads. No images or legacy WorldArea
JSON are read. `extract/maps/world-area-binary.js` decodes the game structure;
the resource package does not interpret fields. Block identity, payloads,
metadata, asset map, source table and parser code are hashed. The verified
CN 7.1 decoder is pinned to its config block; other revisions stop until verified.
Unknown masks/counts, incomplete input, trailing bytes and inconsistent bounds
also stop extraction.

Use the resulting `world-areas.json` as `resourceCaches.worldAreas`,
`MAP_WORLD_AREA_RESOURCE_CACHE`, or `--world-area-resources` when preparing maps.
The local default is `.cache/world-areas.json`. Opening an immutable downstream
snapshot does not require the original client installation. Never append these
polygons to old JSON: the client cache replaces each scene's complete geometry,
including changed older areas. Repeated area IDs retain distinct polygon parts.

The resource package now exposes three distinct raw operations:

- `extractLuaResources`: exact TextAsset/MiHoYoBinData bytes with a Lua signature.
- `extractRawResources({format: 'payload', ...})`: unchanged binary config/index
  contents, without assuming JSON or Lua.
- `extractRawResources({format: 'serialized', includeTypeTree: true, ...})`:
  Unity object bytes, CAB/external-reference metadata and an embedded type-tree
  dump only when available. No guessed schema or automatic PPtr traversal.

All raw plans require exact Source/Offset/Type/PathID; PathID remains a string.
`readAssetMap` can filter by `pathIDs` without converting Int64 to JavaScript
numbers. Asset maps need not include every Transform/component, so missing
entries are not proof of missing game objects. `inspectResourceFiles` now reads
object tables directly from explicit source blocks (without class decoding),
including these unnamed components. `createResourceIndex` resolves known PPtrs
using exact local origins and ordered external CAB tables; missing or ambiguous
targets stay explicit. No recursive dependency discovery or game field parsing
is performed by that helper. Raw serialized extraction likewise no longer
requires successful component decoding. Image conversion retains its
separate XML path and documented Offset limitations.

## Lua and map boundary

On 2026-11-01 the shared bridge extracted a real Lua sample byte-identical to
the earlier research cache, and verified a two-entry batch with PATH empty.
This is not yet a full production Lua migration. Keep `GENSHIN_LUA_PATH` on the
verified complete dataset until full input/semantic regression passes; parsing
continues in `extract/subtitles`, never in the resource package.

The map research requires textures plus prefab/component references, transforms,
materials, masks, meshes and conditional display inputs. The shared bridge has
now acquired the raw ConfigMapArea payload and sample map Unity objects with
source metadata; current samples lack embedded field definitions. A future map
module here must resolve these verified references, retain unknown conditions,
and validate projections/rendering before exporting records through the normal
cache and genshin-db chain. Do not infer defaults from minimum IDs, component
order from the scene tree, or rendering from similarly named textures.

No automatic map parser/cache or production map replacement is enabled by this
resource API addition. Existing hand-maintained map data remains a comparison
baseline. Do not restore wiki-map-data as a parallel extraction dependency.

## TCG circular opponent portraits

GCGTalkDetailIcon explicitly names circular portraits. The shared archive field
resolver calibrates that property from Ayaka/Qin's known circular resource names,
not a revision-specific key or filename-suffix inference. Stage opponents
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
2. Install the local `@inteyvat-wiki/resource-tools` npm dependency (the adjacent
   `Inteyvat-Wiki-resource-tools` checkout). Run `npm run build:helper` in that
   source checkout once; distributed tarballs already include the small bridge.
   Map reading reuses AnimeStudio's .NET runtime, without PowerShell. Only
   maintainers compiling the bridge need a .NET SDK.
3. Run `npm exec -- resource-tools read-asset-map --studio STUDIO --map MAP --output OUTPUT_JSON`.
   This exports all Sprite/Texture2D entries without truncating resource keys.
   Use a new output filename. The old .NET 10 `resources/asset-map` launcher
   remains a compatibility adapter delegating to the same npm API.
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

Generic extraction and PNG validation now live in `resource-tools`; the above
wrappers keep game-specific plan interpretation here. Raw Lua byte extraction
is a separate resource-tools API, while Lua parsing and subtitle semantics remain
in `extract/subtitles`. No extraction runs on npm installation or module import.
See the resource-tools README for supported external tool APIs and precise XML
image identity limitations (Offset is retained as evidence, not enforced by XML).

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
