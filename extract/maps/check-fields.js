// Read-only real-source verification. Kept separate from hermetic unit tests.
const assert = require('node:assert/strict');
const path = require('node:path');
const { createSource } = require('./source');
const schema = require('./schema');
const { shapeFootprint, validateGroupBounds } = require('./regions');
const { npcConditions } = require('./extended');

function checkSourceFields(source) {
    const world = source.excel('WorldAreaConfigData'), groups = source.excel('MapLayerGroupExcelConfigData');
    const floors = source.excel('MapLayerFloorExcelConfigData'), layers = source.excel('MapLayerExcelConfigData');
    const fields = { ...schema.worldAreaFields(world), ...schema.groupFields(groups), ...schema.floorFields(floors),
        ...schema.layerFields(layers), ...schema.pointFields(source), ...schema.questFields(source),
        ...schema.regionFields(source), ...schema.npcConditionFields(source) };
    const report = { fields, tables: { worldAreas: world.length, groups: groups.length, floors: floors.length, layers: layers.length },
        pointClasses: {}, unknownPointTypes: {}, shapeTypes: {}, bounds: {}, questSteps: 0, questExecutions: 0, npcConditions: {} };
    const increment = (map, key) => { map[key] = (map[key] || 0) + 1; };
    const kinds = schema.pointClasses(source);
    for (const row of floors) {
        assert(Number.isSafeInteger(row[fields.group]), `Missing floor group: ${row.id}`);
        assert(Number.isSafeInteger(row[fields.floorName]), `Missing floor name: ${row.id}`);
    }
    for (const row of layers) assert(Number.isSafeInteger(row[fields.floor]), `Missing layer floor: ${row.id}`);
    for (const file of source.files('Scene/Point')) {
        if (!/scene(-?\d+)_point$/i.test(file)) continue;
        const data = source.bin(file); if (Array.isArray(data) || Array.isArray(data.points)) continue;
        for (const row of Object.values(data.points || {})) {
            increment(report.pointClasses, kinds[row.$type] || 'unresolved');
            if (!kinds[row.$type]) increment(report.unknownPointTypes, row.$type || '<absent>');
        }
    }
    for (const file of source.files('MultilayerMapRegion')) {
        const group = source.bin(file), regions = group[fields.regions];
        assert(Number.isSafeInteger(group[fields.regionGroup]) && Array.isArray(regions), `Invalid group: ${file}`);
        increment(report.bounds, validateGroupBounds(group, regions).status);
        for (const region of regions) {
            assert(Number.isSafeInteger(region[fields.regionLayer]), `Missing region layer: ${file}`);
            for (const shape of region.limitShapes || []) {
                const type = shape.shape?.$type || '<absent>';
                const counts = report.shapeTypes[type] ||= { total: 0, projected: 0 };
                counts.total++; if (shapeFootprint(shape)) counts.projected++;
            }
        }
    }
    for (const file of source.files('Quest')) {
        const steps = source.bin(file)[fields.quests]; if (!Array.isArray(steps)) continue;
        for (const step of steps) {
            assert(Number.isSafeInteger(step[fields.questId]), `Missing quest step ID: ${file}`);
            report.questSteps++;
            for (const key of [fields.finish, fields.fail]) if (step[key] !== undefined) {
                assert(Array.isArray(step[key]), `Invalid quest execution list: ${file}`);
                report.questExecutions += step[key].length;
            }
        }
    }
    for (const dir of ['Scene/SceneNpcBorn', 'Scene/SceneNpcBornNoGroup']) for (const file of source.files(dir))
        for (const row of source.bin(file).bornPosList || []) if (row.preConditions)
            for (const condition of npcConditions(row.preConditions, fields).flat()) increment(report.npcConditions, condition.kind);
    return report;
}
module.exports = { checkSourceFields };
if (require.main === module) {
    assert(process.argv[2], 'Usage: node extract/maps/check-fields.js SOURCE_ROOT [--catalogue]');
    const source = createSource(path.resolve(process.argv[2]), () => '');
    const report = checkSourceFields(source);
    console.log(JSON.stringify(report, null, 2));
    if (process.argv.includes('--catalogue')) {
        // Normal resource validators remain in force. A stale/missing client
        // cache must fail, never silently substitute repository geometry.
        const records = require('./catalogue').buildMaps('EN', source), counts = {};
        for (const row of Object.values(records)) counts[row.kind] = (counts[row.kind] || 0) + 1;
        console.log(JSON.stringify({ catalogue: counts, total: Object.keys(records).length }, null, 2));
    }
}
