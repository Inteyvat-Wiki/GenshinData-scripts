const test = require('node:test');
const assert = require('node:assert/strict');
const { abilityMaps, extendMaps, npcConditions } = require('./extended');
const { pointClasses } = require('./schema');
const { fixture, bins } = require('./fixtures/field-inference');

test('ability map background recovers both selector axes without inventing runtime availability', () => {
    const entries = [{ Default: { abilityName: 'MapAbility', modifiers: {
        Handler: { modifierMixins: [{ $type: 'AttachModifierToGlobalValueMixin', globalValueKey: 'Started', valueSteps: [-.5, .5, 1.5], modifierNameSteps: ['Idle', 'Started'] }] },
        Started: { modifierMixins: [{ $type: 'AttachModifierToGlobalValueMixin', globalValueKey: 'Level', valueSteps: [.5, 1.5], modifierNameSteps: ['Level1'] }] },
        Level1: { modifierMixins: [{ $type: 'ShowMapBackMixin', prefabName: 'ExactBackground' }] },
    } } }];
    const [record] = abilityMaps('fixture', entries);
    assert.equal(record.prefab_name, 'ExactBackground');
    assert.deepEqual(record.activation.paths[0].map(x => x.kind), ['modifier-active', 'global-value-range', 'global-value-range']);
    assert.deepEqual(record.activation.paths[0].slice(1).map(x => [x.key, x.lower, x.upper]), [['Started', .5, 1.5], ['Level', .5, 1.5]]);
    assert.equal(record.activation.complete, false);
    assert.equal(record.activation.paths[0][1].endpoint_inclusion, 'unverified');
});
test('selector cycles never turn into unconditional rules and mismatched arrays are not guessed', () => {
    const [record] = abilityMaps('fixture', [{ Default: { modifiers: { Loop: { modifierMixins: [
        { $type: 'AttachModifierToGlobalValueMixin', globalValueKey: 'x', valueSteps: [0, 1], modifierNameSteps: ['Loop'] },
        { $type: 'ShowMapBackMixin', prefabName: 'A' },
    ] } } } }]);
    assert.deepEqual(record.activation.paths, []);
    assert.equal(record.activation.complete, false);
});
function context() {
    const output = {
        'limit-region-1': { kind: 'limit_region', name: 'CurrentBoundary', data: { scene_id: 3 }, diagnostics: ['playable_boundary_geometry_not_resolved'] },
        'limit-region-2': { kind: 'limit_region', name: 'GlobalOpenArea7_0', data: { scene_id: 3 }, diagnostics: ['playable_boundary_geometry_not_resolved'] },
    };
    const files = { 'LevelDesign/SimplePolygons': ['LevelDesign/SimplePolygons/CurrentBoundary', 'LevelDesign/SimplePolygons/GlobalOpenArea4_6'],
        MultilayerMapRegion: [], 'Scene/SceneNpcBorn': [], 'Scene/SceneNpcBornNoGroup': [] };
    const polygon = { minArea: { x: -1, z: -2 }, maxArea: { x: 2, z: 3 }, roadPoints: [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 0, z: 1 }] };
    return { output, input: { files: directory => files[directory], walkFiles: () => [], bin: () => polygon }, rows: () => [],
        create(kind, id, file) { return output[`${kind}-${id}`] = { kind, id, data: {}, source: { file }, diagnostics: [] }; },
        geometry: row => ({ points: row.roadPoints }), key: (kind, id) => `${kind}-${id}`, text() {}, relation() {}, vector: value => value };
}
test('only exact active LimitRegion references select boundaries, not the newest available filename', () => {
    const ctx = context(); extendMaps(ctx);
    assert.equal(ctx.output['limit-region-1'].data.polygons.length, 1);
    assert.equal(ctx.output['limit-region-1'].data.geometry_status, 'exact-resource-name');
    assert.equal(ctx.output['limit-region-2'].data.polygons, undefined);
    const history = Object.values(ctx.output).find(row => row.kind === 'boundary_geometry');
    assert.equal(history.data.active_reference, false);
    assert(history.diagnostics.includes('unreferenced_boundary_not_current'));
});
test('named historical point-class adapters distinguish interior quit points from transport points', () => {
    const POINT_CLASSES = pointClasses(fixture({}, bins));
    assert.equal(POINT_CLASSES.BHJILFMHGEE, 'transport');
    assert.equal(POINT_CLASSES.AIEKKMCCLLN, 'domain-quit');
    assert.equal(POINT_CLASSES.NKJPPNFAEEF, 'domain-entry');
    assert.equal(POINT_CLASSES.FCMFBNFCCFG, undefined);
});
test('NPC conditions preserve nested grouping and do not guess the namespace of unresolved IDs', () => {
    const result = npcConditions([[{ $type: 'CNFIFPJNOKE', condType: 'QUEST_COND_STATE_EQUAL', paramList: [1, 3] },
        { $type: 'ICEFINJKEDH', OBGFDDLJKKI: [108502] }], [{ $type: 'KEANKLJIJJI', specialScenes: [3] }], []], { npcIds: 'OBGFDDLJKKI' });
    assert.equal(result.length, 3); assert.deepEqual(result[2], []);
    assert.equal(result[0][0].kind, 'quest'); assert.deepEqual(result[0][0].parameters, [1, 3]);
    assert.equal(result[0][1].kind, 'id-list'); assert.equal(result[0][1].type, 'unresolved');
    assert.equal(result[1][0].kind, 'scene-list'); assert.deepEqual(result[1][0].parameters, [3]);
    assert.throws(() => npcConditions([[{ $type: 'ICEFINJKEDH', OBGFDDLJKKI: [1], newField: 2 }]], { npcIds: 'OBGFDDLJKKI' }), /Unsupported NPC condition fields/);
});
