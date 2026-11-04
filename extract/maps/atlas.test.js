const test = require('node:test');
const assert = require('node:assert/strict');
const { buildNativeAtlas, projectGeometry } = require('./atlas');
const { prefabContainer, rectangularImages } = require('../../resources/map-atlas');
const { tables: calibration } = require('./fixtures/field-inference');
const ref = (field, target) => ({ field, target, status: 'resolved' });

test('atlas preparation fingerprints field inference as well as image geometry', () => {
    const inputs = require('../../resources/map-atlas').parserInputs();
    for (const name of ['./atlas', './schema', '../field-inference']) {
        const input = inputs.find(input => input.file === require.resolve(name));
        assert(input, `Missing atlas parser dependency: ${name}`);
        assert.match(input.sha256, /^[a-f0-9]{64}$/);
    }
});
test('composite layers use controller ancestry and same-ID base child, not the image filename', () => {
    const objects = [
        { id: 'root', name: 'LayeredMap_7', references: [] },
        { id: 'root-tr', decoded: { parent: { PathID: '0' } }, references: [ref('gameObject', 'root'), ref('children[0]', 'member-tr')] },
        { id: 'member', name: '101', references: [] },
        { id: 'member-tr', decoded: { parent: { PathID: '1' } }, references: [ref('gameObject', 'member'), ref('parent', 'root-tr'), ref('children[0]', 'base-tr'), ref('children[1]', 'effect-tr')] },
        { id: 'base', name: '101', references: [] },
        { id: 'base-tr', decoded: { parent: { PathID: '2' } }, references: [ref('gameObject', 'base'), ref('parent', 'member-tr')] },
        { id: 'effect', name: 'FogEffect', references: [] },
        { id: 'effect-tr', decoded: { parent: { PathID: '2' } }, references: [ref('gameObject', 'effect'), ref('parent', 'member-tr')] },
        { id: 'controller', decoded: { className: 'MonoMultilayerMapLayer', decodeStatus: 'decoded', layerObjects: [{}] }, references: [ref('layerObjects[0]', 'member')] },
    ];
    const images = [{ id: 'base-image', gameObject: 'base', rectTransform: 'base-tr', assetName: 'shared-image', png: { sha256: 'fixture' } },
        { id: 'effect-image', gameObject: 'effect', rectTransform: 'effect-tr', assetName: 'UI_Map_LayeredMap_101' }];
    const result = buildNativeAtlas({ objects, images }, { groups: [...calibration.MapLayerGroupExcelConfigData, { id: 7, HCEGNMLIKLP: [30] }],
        layers: [...calibration.MapLayerExcelConfigData, { id: 101, JBACHLCJFPA: 90 }],
        worldAreas: [{ areaType: 'LEVEL_1', areaID1: 30, sceneID: 3 }], mapAreas: [], mapConfigs: {} });
    assert.equal(result.images.length, 1);
    assert.equal(result.images[0].layerId, 101); assert.equal(result.images[0].floorId, 90); assert.equal(result.images[0].sceneId, 3);
    assert.deepEqual(result.images[0].renderOrder, { scope: 'root', hierarchy: [0, 0], crossPrefabOrder: 'unresolved' });
    assert.equal(result.images[0].png.sha256, 'fixture');
});
test('calibrated map UI preserves corner order and leaves unknown scenes unprojected', () => {
    const profiles = { 3: require('./base').mapProjection({ mapId: 0, frame: [-3072, -2048, 8192, 8192] }, { worldTileSize: 1024, uiTileSize: 256 }) };
    const geometry = { coordinateSpace: 'prefab-ui', corners: [[-1695.24, -907, 0], [-1623.24, -907, 0], [-1623.24, -849, 0], [-1695.24, -849, 0]] };
    const result = projectGeometry(geometry, 3, profiles);
    assert.deepEqual(result.corners[0], { x: -1580, y: 5756.96 });
    assert.deepEqual(result.corners[2], { x: -1348, y: 5468.96 });
    assert.equal(projectGeometry(geometry, 103, profiles), null);
    assert.equal(projectGeometry(geometry, 3), null);
    assert.throws(() => projectGeometry({ ...geometry, corners: [[0, 0, 0], [1, 1, 1]] }, 3, profiles), /Nonplanar/);
});
test('prefab discovery hashes a known full asset path and rejects non-ASCII guesses', () => {
    assert.equal(prefabContainer('ART/UI/Menus/Widget/InLevel/MapLayered/LayeredMap_35102'), '-528301668');
    assert.throws(() => prefabContainer('猜测路径'), /ASCII/);
});
test('production atlas preparation never publishes a MeshImage layout frame as a rectangle', () => {
    const cache = { objects: [{ id: 'mesh-component', decoded: { mesh: { fileID: 1, PathID: '99' } } }, { id: 'image-component', decoded: {} }],
        images: [{ id: 'mesh-frame', imageObject: 'mesh-component' }, { id: 'mask', imageObject: 'image-component' }],
        meshes: [{ id: 'mesh-data' }], imageAssets: [{ id: 'full-texture' }] };
    assert.deepEqual(rectangularImages(cache).map(image => image.id), ['mask']);
    assert.equal(cache.images.length, 2); assert.equal(cache.meshes.length, 1); assert.equal(cache.imageAssets.length, 1);
});
