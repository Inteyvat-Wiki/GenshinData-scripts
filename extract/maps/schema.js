const { isDeepStrictEqual } = require('node:util');
const { resolveField, resolveRow } = require('../field-inference');

// Values checked in the 7.1/7.2 source snapshots; see docs/maps.md. These
// functions deliberately have no module-level field cache: every caller supplies
// the current table/source. A nonempty family must contain its calibration rows.
const byId = (rows, label, id) => resolveRow(rows, `${label}:${id}`, row => row.id === id);
const valueField = (label, row, value) => resolveField(`maps.${label}`, [{ row, value }]);

function worldAreaFields(rows) {
    if (!rows.length) return {};
    return { configurationName: resolveField('maps.worldArea.configurationName', [
        { row: byId(rows, 'WorldArea', 1100), value: 1333393882 },
        { row: byId(rows, 'WorldArea', 1101), value: 3060720010 },
    ]) };
}
function groupFields(rows) {
    if (!rows.length) return {};
    const row = byId(rows, 'MapLayerGroup', 31101);
    return { groupAreas: valueField('group.areas', row, [11]),
        groupReference: valueField('group.referenceFloor', row, 3110101) };
}
function floorFields(rows) {
    if (!rows.length) return {};
    const row = byId(rows, 'MapLayerFloor', 3110101);
    return { group: valueField('floor.group', row, 31101),
        floorName: valueField('floor.name', row, 282263247),
        floorNewName: valueField('floor.alternateName', row, 417561169),
        floorNumber: valueField('floor.number', row, -1),
        floorCondition: valueField('floor.nameCondition', byId(rows, 'MapLayerFloor', 3200501),
            { type: 'MAP_FLOOR_NAME_CHANGE_QUEST', paramList: [7306622] }) };
}
function layerFields(rows) {
    if (!rows.length) return {};
    // Unlike 3110101, this layer's id differs from its floor id.
    return { floor: valueField('layer.floor', byId(rows, 'MapLayer', 3110103), 3110102) };
}
function pointFields(input) {
    const points = input.bin('Scene/Point/scene3_point').points;
    return {
        pointFloor: valueField('point.layer', points?.[1304], 3460401),
        pointArea: resolveField('maps.point.subarea', [
            { row: points?.[45], value: 205 }, { row: points?.[48], value: 106 },
        ]),
        entryType: resolveField('maps.point.dungeonEntryType', [
            { row: points?.[45], value: 'Tower' }, { row: points?.[48], value: 'Daily' },
        ]),
    };
}
function pointClasses(input) {
    // Independently named classes in cbe446c9e60, matched by scene/point,
    // gadget and position. Coordinates below are the current JSON's rounded
    // representation of the same float32 values (historical error < .001).
    const witnesses = [
        [3, 45, 'domain-entry', 70120008, [1638.538, 194.375, -2666.921]],
        [3, 21, 'domain-exit', 70010002, [2120.139, 204.8979, -1157.901]],
        [3, 8, 'transport', 70110002, [2197.455, 214.8022, -1122.173]],
        [3, 27, 'personal-scene-jump', 70010002, [2243.504, 238.643, -778.8833]],
        [3, 55, 'building', 70010001, [2355.06, 261.0227, -684.8734]],
        [3, 317, 'vehicle-summon', 70370273, [-3290.632, 200.6837, -3647.401]],
        [3, 439, 'virtual-transport', 70010001, [-389.5971, 214.4649, -1146.736]],
        [1006, 1, 'domain-waypoint', 70120003, [11.6215, -3.071995, 50.15282]],
        [1006, 4, 'domain-quit', 70120004, [166.2599, 81.45801, -22.14835]],
        [1006, 5, 'domain-revive', 70010006, [-32.59365, 1, 53.14494]],
    ];
    const result = Object.create(null);
    for (const [scene, id, kind, gadget, position] of witnesses) {
        const row = input.bin(`Scene/Point/scene${scene}_point`).points?.[id];
        if (!row || row.gadgetId !== gadget || !['x', 'y', 'z'].every((axis, i) =>
            Number.isFinite(row.pos?.[axis]) && Math.abs(row.pos[axis] - position[i]) < .001))
            throw new Error(`Invalid map point class witness: ${scene}/${id}`);
        if (typeof row.$type !== 'string' || !row.$type || Object.hasOwn(result, row.$type))
            throw new Error(`Missing or ambiguous map point class: ${scene}/${id}`);
        result[row.$type] = kind;
    }
    return result;
}
function questFields(input) {
    const quest = input.bin('Quest/353');
    // The step's known description selects the row without first assuming its
    // id property. No generic "array of objects" or QUEST_EXEC shape heuristic.
    const quests = resolveField('maps.quest.steps', [{ row: quest, match: value => Array.isArray(value)
        && value.some(row => row && Object.values(row).includes(3726907551)) }]);
    const step = resolveRow(quest[quests], 'Quest:353/35302', row => Object.values(row).includes(3726907551));
    const questId = valueField('quest.stepId', step, 35302);
    const finish = resolveRow(quest[quests], 'Quest:353/35311', row => row[questId] === 35311);
    return { quests, questId, questName: valueField('quest.description', step, 3726907551),
        questOrder: valueField('quest.order', step, 3),
        fail: valueField('quest.failExec', step, [{ type: 'QUEST_EXEC_ROLLBACK_QUEST', param: ['35302'] }]),
        finish: valueField('quest.finishExec', finish, [
            { type: 'QUEST_EXEC_SET_OPEN_STATE', param: ['2', '1'] },
            { type: 'QUEST_EXEC_SET_OPEN_STATE', param: ['1', '1'] },
        ]) };
}
function regionFields(input) {
    const row = input.bin('MultilayerMapRegion/31101');
    const regions = resolveField('maps.region.layers', [{ row, match: value => Array.isArray(value)
        && value.some(region => region && Object.values(region).includes(3110101)) }]);
    const first = resolveRow(row[regions], 'MapRegion:31101/3110101', region => Object.values(region).includes(3110101));
    const second = resolveRow(row[regions], 'MapRegion:31101/3110102', region => Object.values(region).includes(3110102));
    return { regionGroup: valueField('region.group', row, 31101), regions,
        regionLayer: resolveField('maps.region.layer', [{ row: first, value: 3110101 }, { row: second, value: 3110102 }]) };
}
function npcConditionFields(input) {
    const data = input.bin('Scene/SceneNpcBornNoGroup/scene1085_npcborn_nogroup');
    const row = resolveRow(data.bornPosList, 'NpcBorn:1085/405100000', row => row._id === 405100000 && row._configId === 5100);
    const condition = resolveRow(row.preConditions?.flat(), 'NpcBorn:1085/405100000/id-list',
        row => Object.values(row).some(value => isDeepStrictEqual(value, [108502])));
    return { npcIds: valueField('npc.conditionIds', condition, [108502]) };
}
module.exports = { worldAreaFields, groupFields, floorFields, layerFields, pointFields, pointClasses, questFields, regionFields, npcConditionFields };
