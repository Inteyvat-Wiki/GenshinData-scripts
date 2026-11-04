const test = require('node:test');
const assert = require('node:assert/strict');
const { resourceRecords, areaVariantMemberships } = require('./resources');
const { tables: calibration } = require('./fixtures/field-inference');

test('map variants use controller pointer-array indexes, including descendants, rather than sibling order', () => {
    const reference = (field, target) => ({ field, status: 'resolved', target });
    const cache = { objects: [
        { id: 'controller', decoded: { type: 'MonoBehaviour', className: 'MonoMapArea' }, references: [reference('areaTransforms[3]', 'branch'), reference('areaTransforms[0]', 'other')] },
        { id: 'branch', references: [] }, { id: 'other', references: [] },
        { id: 'child', references: [reference('parent', 'branch')] },
        { id: 'unrelated', references: [] },
    ], images: [{ id: 'image', rectTransform: 'child' }, { id: 'other-image', rectTransform: 'other' }, { id: 'unknown', rectTransform: 'unrelated' }] };
    const result = areaVariantMemberships(cache);
    assert.deepEqual(result.get('image'), [{ controller: 'controller', index: 3 }]);
    assert.deepEqual(result.get('other-image'), [{ controller: 'controller', index: 0 }]);
    assert.deepEqual(result.get('unknown'), []);
});

test('native labels resolve exact manual text keys and preserve unresolved groups', () => {
    const geometry = { coordinateSpace: 'prefab-ui', corners: [[0, 0, 0], [2, 0, 0], [2, 2, 0], [0, 2, 0]] };
    const cache = { objects: [], images: [], diagnostics: [], labels: [
        { id: 'map-label-a', textKey: 'UI_TEST', layerGroupId: 10, rootName: 'LayeredMap_10', entry: { PathID: '1' }, geometry },
        { id: 'map-label-b', textKey: 'UI_MISSING', layerGroupId: 99, rootName: 'LayeredMap_99', entry: { PathID: '2' }, geometry },
    ] };
    const tables = { MapLayerGroupExcelConfigData: [...calibration.MapLayerGroupExcelConfigData, { id: 10, HCEGNMLIKLP: [5] }],
        WorldAreaConfigData: [{ areaID1: 5, areaType: 'LEVEL_1', sceneID: 3 }],
        ManualTextMapConfigData: [{ textMapId: 'UI_TEST', textMapContentTextMapHash: 123 }] };
    const source = { excel: table => tables[table] || [], bin: () => ({}), text: (language, hash) => language === 'EN' && hash === '123' ? 'Original place name' : '' };
    const records = resourceRecords(cache, 'manifest.json', { source, language: 'EN' });
    assert.equal(records['map-place-a'].name, 'Original place name');
    assert.equal(records['map-place-a'].data.scene_id, 3);
    assert.deepEqual(records['map-place-a'].source.hashes, ['123']);
    assert.equal(records['map-place-b'].name, '');
    assert.equal(records['map-place-b'].data.scene_id, undefined);
    assert(records['map-place-b'].diagnostics.includes('place_text_key_unresolved'));
    assert(records['map-place-b'].diagnostics.includes('place_scene_unresolved'));
});
