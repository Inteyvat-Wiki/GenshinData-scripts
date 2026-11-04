const test = require('node:test');
const assert = require('node:assert/strict');
const { tileCoordinate, tileGeometry, mapProjection, decodeMapScript, decodeLevelMap } = require('./base');
test('base tile discovery rejects zero-padded cover numbers and retains signed grid coordinates', () => {
    assert.deepEqual(tileCoordinate('UI_Map_Fairybook_-2_1_GenerateMipMaps', 'UI_Map_Fairybook'), [-2, 1]);
    assert.equal(tileCoordinate('UI_Map_Fairybook_700_01_GenerateMipMaps', 'UI_Map_Fairybook'), null);
    assert.equal(tileCoordinate('UI_Map_Firmament_Grp_1000_01', 'UI_Map_Firmament'), null);
    assert.equal(tileCoordinate('UI_MapBack_0_01', 'UI_MapBack'), null);
});
test('native grid puts adjacent image edges at identical world coordinates, regardless of texture resolution', () => {
    const a = tileGeometry([-1, 2], 1024).corners, b = tileGeometry([-1, 3], 1024).corners;
    assert.deepEqual(a[0], b[1]); assert.deepEqual(a[3], b[2]);
    assert.deepEqual(a, [{ x: -1024, y: 3072 }, { x: -1024, y: 2048 }, { x: 0, y: 2048 }, { x: 0, y: 3072 }]);
    assert.throws(() => tileGeometry([1.2, 0], 1024));
});
test('scene projection derives scale and origin from native frame and grid, never PNG size', () => {
    const grid = { worldTileSize: 1024, uiTileSize: 256 };
    assert.deepEqual(mapProjection({ mapId: 0, frame: [-3072, -2048, 8192, 8192] }, grid),
        { scale: 4, offsetX: 2048, offsetZ: -1024, profile: 'client-map-centered-frame-v1' });
    for (const mapId of [100, 101, 103]) assert.deepEqual(mapProjection({ mapId, frame: [-512, 512, 4096, 4096] }, grid),
        { scale: 4, offsetX: 512, offsetZ: 512, profile: 'client-map-origin-v1' });
});
test('native map decoders reject truncated layout instead of inventing defaults', () => {
    assert.throws(() => decodeMapScript(Buffer.alloc(4)), /Truncated/);
    assert.throws(() => decodeLevelMap(Buffer.alloc(4)), /Truncated/);
});
