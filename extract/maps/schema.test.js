const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('./schema');
const { buildMaps } = require('./catalogue');
const { buildNativeAtlas } = require('./atlas');
const { resourceRecords } = require('./resources');
const { FIELDS, tables, bins, fixture } = require('./fixtures/field-inference');

function input() { return { ...fixture(tables, bins), extended: true }; }
function visit(value, fn) {
    if (!value || typeof value !== 'object') return;
    fn(value);
    for (const child of Object.values(value)) visit(child, fn);
}
function infer(source) {
    return { ...schema.worldAreaFields(source.excel('WorldAreaConfigData')),
        ...schema.groupFields(source.excel('MapLayerGroupExcelConfigData')),
        ...schema.floorFields(source.excel('MapLayerFloorExcelConfigData')),
        ...schema.layerFields(source.excel('MapLayerExcelConfigData')),
        ...schema.pointFields(source), ...schema.questFields(source), ...schema.regionFields(source), ...schema.npcConditionFields(source) };
}
function renamed(source, prefix) {
    const mapping = Object.fromEntries(Object.values(FIELDS).map((key, i) => [key, `${prefix}_field_${i}`]));
    visit(source.tables, change); visit(source.bins, change);
    function change(row) {
        for (const key of Object.keys(row)) if (mapping[key]) { row[mapping[key]] = row[key]; delete row[key]; }
    }
    return mapping;
}
function normalize(value, mapping) {
    if (typeof value === 'string') return mapping[value] || value;
    if (Array.isArray(value)) return value.map(child => normalize(child, mapping));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalize(child, mapping)]));
    return value;
}

test('all map fields infer after arbitrary renaming, without cross-source cached keys', () => {
    const original = input(), expected = buildMaps('EN', original);
    assert.deepEqual(infer(original), FIELDS);
    for (const prefix of ['first-source', 'different-source']) {
        const source = input(), names = renamed(source, prefix);
        assert.deepEqual(infer(source), Object.fromEntries(Object.entries(FIELDS).map(([label, key]) => [label, names[key]])));
        const reverse = Object.fromEntries(Object.entries(names).map(([a, b]) => [b, a]));
        assert.deepEqual(normalize(buildMaps('EN', source), reverse), expected);
    }
    assert.equal(expected['layer-region-31101-3110101-0'].data.layer_id, 3110101);
    const npc = Object.values(expected).find(row => row.kind === 'npc_instance');
    assert.deepEqual(npc.data.conditions[0][0].parameters, [108502]);
    assert.equal(npc.data.conditions[0][0].type, 'unresolved');
});

for (const [label, key] of Object.entries(FIELDS)) {
    test(`missing and ambiguous map field ${label} fail closed`, () => {
        const missing = input(), ambiguous = input();
        for (const container of [missing.tables, missing.bins]) visit(container, row => { delete row[key]; });
        assert.throws(() => infer(missing), /Cannot resolve (field|row)/);
        for (const container of [ambiguous.tables, ambiguous.bins]) visit(container, row => {
            if (Object.hasOwn(row, key)) row.extraCandidate = structuredClone(row[key]);
        });
        assert.throws(() => infer(ambiguous), /Cannot resolve (field|row).*ambiguous/);
    });
}

test('multiple point witnesses disambiguate identical values and reject inconsistent spellings', () => {
    const source = input(), points = source.bins['Scene/Point/scene3_point'].points;
    points[45].decoy = 205; points[48].decoy = 205;
    assert.equal(schema.pointFields(source).pointArea, FIELDS.pointArea);
    points[48].anotherKey = points[48][FIELDS.pointArea]; delete points[48][FIELDS.pointArea];
    assert.throws(() => schema.pointFields(source), /inconsistent/);
});

test('missing or duplicate calibration rows are errors, not optional-field fallbacks', () => {
    assert.throws(() => schema.groupFields([{ id: 7 }]), /missing witness/);
    assert.throws(() => schema.groupFields([...tables.MapLayerGroupExcelConfigData, ...tables.MapLayerGroupExcelConfigData]), /ambiguous witness/);
    const source = input(); delete source.bins['Quest/353'];
    assert.throws(() => schema.questFields(source), /Cannot resolve/);
});

test('point class values calibrate independently of their spelling, with verified identity', () => {
    const source = input(), before = buildMaps('EN', source), kinds = schema.pointClasses(source);
    const renamedTypes = Object.fromEntries(Object.keys(kinds).map((type, i) => [type, `arbitrary-class-${i}`]));
    visit(source.bins, row => { if (renamedTypes[row.$type]) row.$type = renamedTypes[row.$type]; });
    const reverse = Object.fromEntries(Object.entries(renamedTypes).map(([a, b]) => [b, a]));
    assert.deepEqual(normalize(buildMaps('EN', source), reverse), before);
    const points = source.bins['Scene/Point/scene3_point'].points;
    points[45].$type = points[21].$type;
    assert.throws(() => schema.pointClasses(source), /ambiguous map point class/);
    delete points[45].$type;
    assert.throws(() => schema.pointClasses(source), /Missing or ambiguous/);
    points[45].gadgetId = 0;
    assert.throws(() => schema.pointClasses(source), /Invalid map point class witness/);
});

test('native atlas and label resource joins use inferred current-table keys', () => {
    const source = input(); renamed(source, 'resource-input');
    const reference = (field, target) => ({ field, target, status: 'resolved' });
    const cache = { diagnostics: [], objects: [
        { id: 'root', name: 'LayeredMap_31101', entry: { PathID: '1' }, references: [] },
        { id: 'tr', entry: { PathID: '2' }, decoded: { parent: { PathID: '0' } }, references: [reference('gameObject', 'root')] },
        { id: 'member', name: '3110103', entry: { PathID: '3' }, references: [] },
        { id: 'controller', entry: { PathID: '4' }, decoded: { className: 'MonoMultilayerMapLayer', decodeStatus: 'decoded', layerObjects: [{}] }, references: [reference('layerObjects[0]', 'member')] },
    ], images: [{ id: 'image', imageObject: 'member', gameObject: 'member', rectTransform: 'tr', entry: { PathID: '5' } }],
    labels: [{ id: 'label', textKey: 'LABEL', layerGroupId: 31101, entry: { PathID: '6' } }] };
    source.tables.WorldAreaConfigData.push({ id: 21000, areaType: 'LEVEL_1', areaID1: 11, sceneID: 3 });
    const atlas = buildNativeAtlas(cache, { groups: source.excel('MapLayerGroupExcelConfigData'), layers: source.excel('MapLayerExcelConfigData'),
        worldAreas: source.excel('WorldAreaConfigData'), mapAreas: [], mapConfigs: {} });
    assert.equal(atlas.images[0].floorId, 3110102); assert.equal(atlas.images[0].sceneId, 3);
    const records = resourceRecords(cache, 'test', { source, language: 'EN' });
    assert.equal(records['map-place-label'].data.scene_id, 3);
    assert.equal(records['resource-atlas-image'].data.floor_id, 3110102);
});
