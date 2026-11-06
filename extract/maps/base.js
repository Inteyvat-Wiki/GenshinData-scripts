const assert = require('node:assert/strict');

// Player layouts observed in the 7.1 client. The raw objects and MonoScript
// identities are verified by resources/map-base before these decoders run.
class Reader {
    constructor(bytes, offset = 0) { this.bytes = bytes; this.offset = offset; }
    take(n) { assert(Number.isSafeInteger(n) && n >= 0 && this.offset + n <= this.bytes.length, 'Truncated native map layout'); const at = this.offset; this.offset += n; return at; }
    int() { return this.bytes.readInt32LE(this.take(4)); }
    float() { const n = this.bytes.readFloatLE(this.take(4)); assert(Number.isFinite(n)); return n; }
    pointer() { return { fileID: this.int(), PathID: this.bytes.readBigInt64LE(this.take(8)).toString() }; }
    string() { const n = this.int(); assert(n >= 0 && n < 4096); const at = this.take(n), text = new TextDecoder('utf-8', { fatal: true }).decode(this.bytes.subarray(at, at + n)); this.take((4 - this.offset % 4) % 4); return text; }
    count() { const n = this.int(); assert(n >= 0 && n <= 10000); return n; }
}
function decodeMapScript(bytes) {
    const r = new Reader(bytes); r.pointer(); assert.equal(r.int(), 1);
    const script = r.pointer(), name = r.string(), frame = Array.from({ length: 4 }, () => r.float());
    const prefabPath = r.string(), mapId = r.int(), managerPath = r.string(), extraPath = r.string();
    const levelLayoutPath = r.string(), worldAreaPath = r.string();
    const extras = Array.from({ length: r.count() }, () => [r.int(), r.float(), r.float(), r.float()]);
    assert.equal(r.offset, bytes.length, 'Unknown MapScriptData trailing fields');
    assert(frame[2] > 0 && frame[3] > 0);
    return { name, script, frame, prefabPath, mapId, managerPath, extraPath, levelLayoutPath, worldAreaPath, extras };
}
function decodeLevelMap(bytes) {
    const r = new Reader(bytes); r.pointer(); assert.equal(r.int(), 1); const script = r.pointer(); assert.equal(r.string(), '');
    const sceneId = r.int(), reserved = r.int(); assert.equal(reserved, 0);
    const groups = Array.from({ length: r.count() }, () => {
        const id = r.int(), value = r.float(), references = [r.pointer(), r.pointer()];
        const tiles = Array.from({ length: r.count() }, () => [r.float(), r.float()]);
        assert(tiles.flat().every(Number.isSafeInteger)); return { id, value, references, tiles };
    });
    const scale = [r.float(), r.float()], uiTileSize = r.int(), worldTileSize = r.int();
    assert.deepEqual(scale, [1, 1]); assert.equal(uiTileSize, 256); assert.equal(worldTileSize, 1024);
    // Later fields concern fog objects/effects. They stay in the evidence cache;
    // tile geometry never interprets their PPtrs as floats or guesses field names.
    return { script, sceneId, groups, uiTileSize, worldTileSize, unparsedOffset: r.offset };
}
const families = {
    BigWorldMap: 'UI_MapBack', MapAbyssalPalace: 'UI_MapBack_AbyssalPalace', MapTheChasm: 'UI_MapBack_TheChasm',
    MapDeepSea: 'UI_MapBack_DeepSea', MapVolcano: 'UI_Map_Volcano', MapFairybook: 'UI_Map_Fairybook', MapFirmament: 'UI_Map_Firmament',
    MapDreamIsland: 'UI_Map_DreamIsland', MapPenumbra: 'UI_Map_Penumbra', MapMoonCanon: 'UI_Map_MoonCanon',
};
function tileCoordinate(name, prefix) {
    const match = new RegExp(`^${prefix}_(-?\\d+)_(-?\\d+)(?:_GenerateMipMaps)?$`).exec(name);
    if (!match) return null;
    // e.g. Fairybook_700_01 is a cover, not tile (700,1). Runtime tile integer
    // formatting has no zero padding; matching two digit strings alone is unsafe.
    if (String(Number(match[1])) !== match[1] || String(Number(match[2])) !== match[2]) return null;
    return [Number(match[1]), Number(match[2])];
}
function mapProjection(config, controller) {
    const scale = controller.worldTileSize / controller.uiTileSize;
    const [left, top, width, height] = config.frame;
    // The original large-world layout centres its initial rectangle; standalone
    // scenes use the configured origin. This is a layout rule, not a calibration
    // copied from the old Wiki images. Values come from MapScriptData/MonoLevelMap.
    const centered = config.mapId === 0;
    return { scale, offsetX: top + (centered ? height / 2 : 0), offsetZ: -left - (centered ? width / 2 : 0),
        profile: centered ? 'client-map-centered-frame-v1' : 'client-map-origin-v1' };
}
function tileGeometry([x, z], size) {
    assert([x, z, size].every(Number.isSafeInteger) && size > 0);
    // Native image BL,BR,TR,TL. Image right points toward decreasing world Z;
    // image up points toward increasing world X. Pixel resolution is independent.
    return { space: 'world-xz', corners: [{ x: x * size, y: (z + 1) * size }, { x: x * size, y: z * size },
        { x: (x + 1) * size, y: z * size }, { x: (x + 1) * size, y: (z + 1) * size }], profile: 'client-map-tile-grid-v1' };
}
function baseRecords(cache, file) {
    return Object.fromEntries(cache.tiles.map(tile => {
        const id = `resource-base-${tile.sceneId}-${tile.coordinate.join('-')}`;
        return [id, { schema: 1, id, kind: 'resource', name: tile.entry.Name, description: '', texts: [],
            relations: [{ role: 'scene', category: 'maps', id: `scene-${tile.sceneId}` }],
            data: { category: 'base-tile', status: 'image-extracted', scene_id: tile.sceneId, source_entry: tile.entry,
                image_file: tile.image.file, image_sha256: tile.image.sha256, image_width: tile.image.width, image_height: tile.image.height,
                display_geometry: tileGeometry(tile.coordinate, tile.worldTileSize) },
            source: { file, id: tile.entry.PathID, hashes: [], fields: [] }, diagnostics: [] }];
    }));
}
module.exports = { decodeMapScript, decodeLevelMap, families, tileCoordinate, tileGeometry, mapProjection, baseRecords };
