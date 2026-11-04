const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMaps } = require('./catalogue');
const { FIELDS, fixture } = require('./fixtures/field-inference');
const { parseSource } = require('./source');

function quest(id, steps) { return { id, [FIELDS.quests]: steps }; }
function step(id, actions, phase = FIELDS.finish) {
    return { [FIELDS.questId]: id, [phase]: actions.map(([type, ...param]) => ({ type: `QUEST_EXEC_${type}`, param })) };
}

test('MapArea configuration uses the outer lookup key and preserves absent state', () => {
    const records = buildMaps('EN', fixture({ MapAreaConfigData: [{ id: 18, sceneID: 6, areaID1: [] }, { id: 20, sceneID: 6, areaID1: [] }] },
        { 'Map/MapArea/ConfigMapArea': { 18: { id: 1, prefabPath: 'first' }, 20: { id: 1, prefabPath: 'second' } } }));
    assert.equal(records['map-area-18'].data.config.prefab, 'first');
    assert.equal(records['map-area-20'].data.config.prefab, 'second');
    assert.equal(records['map-area-18'].data.config.id, 1);
    assert.equal(Object.hasOwn(records['map-area-18'].data, 'state'), false);
    assert.ok(records['map-area-18'].diagnostics.includes('config_inner_id_differs_from_lookup_key'));
});

test('points join Layer then Floor, and scene/subarea composite then WorldArea ID', () => {
    const records = buildMaps('EN', fixture({
        WorldAreaConfigData: [{ id: 1107, sceneID: 3, areaType: 'LEVEL_2', areaID1: 1, areaID2: 107 }],
        MapLayerGroupExcelConfigData: [{ id: 7 }],
        MapLayerFloorExcelConfigData: [{ id: 71, [FIELDS.group]: 7, [FIELDS.floorName]: 1 }],
        MapLayerExcelConfigData: [{ id: 73, [FIELDS.floor]: 71 }],
    }, { 'Scene/Point/scene3_point': { points: { 1: { areaId: 1, [FIELDS.pointArea]: 107, [FIELDS.pointFloor]: 73, pos: { x: 0 }, unlocked: false } } } }));
    const point = records['point-3-1'];
    assert.equal(point.data.world_area_id, 1107);
    assert.equal(point.data.layer_id, 73);
    assert.equal(point.data.floor_id, 71);
    assert.equal(point.data.unlocked, false);
    assert.equal(Object.hasOwn(point.data, 'visibility'), false);
    assert.deepEqual(point.data.position, { x: 0 });
});

test('ambiguous subareas remain unresolved rather than choosing a first match', () => {
    const records = buildMaps('EN', fixture({ WorldAreaConfigData: [
        { id: 1, sceneID: 3, areaType: 'LEVEL_2', areaID1: 1, areaID2: 107 },
        { id: 2, sceneID: 3, areaType: 'LEVEL_2', areaID1: 2, areaID2: 107 },
    ] }, { 'Scene/Point/scene3_point': { points: { 1: { [FIELDS.pointArea]: 107 } } } }));
    assert.equal(Object.hasOwn(records['point-3-1'].data, 'world_area_id'), false);
    assert.ok(records['point-3-1'].diagnostics.includes('unresolved_point_subarea:2'));
});

test('building and explicit point marks resolve names, descriptions and icons with traceable hashes', () => {
    const records = buildMaps('EN', fixture({ ManualTextMapConfigData: [
        { textMapId: 'TITLE', textMapContentTextMapHash: 11 },
        { textMapId: 'DESC', textMapContentTextMapHash: 12 },
    ] }, {
        'Global/Mark/ConfigMarkGlobal': { sceneBuildingMarks: { Alchemy: 'MarkAlchemy' },
            markIconConfig: { MarkAlchemy: { title: 'TITLE', desc: 'DESC', iconName: 'UI_MarkAlchemy' } } },
        'Scene/Point/scene3_point': { points: {
            201: { $type: 'CPKNFPOIAPH', buildingType: 'Alchemy' },
            202: { $type: 'KCLOMFJNGIA', markIconTypeName: 'MarkAlchemy' },
        } },
    }, { 11: 'Alchemy', 12: 'Original description\nSecond line' }));
    for (const id of ['point-3-201', 'point-3-202']) {
        const item = records[id];
        assert.equal(item.name, 'Alchemy');
        assert.equal(item.description, 'Original description\nSecond line');
        assert.equal(item.data.icon, 'UI_MarkAlchemy');
        assert.equal(item.data.name_source, 'map_icon');
        assert.equal(item.data.description_source, 'map_icon');
        assert.equal(item.data.map_icon_id, 'MarkAlchemy');
        assert.deepEqual(item.source.hashes, ['11', '12']);
        assert(item.relations.some(r => r.role === 'map_icon' && r.id === 'map-icon-MarkAlchemy'));
    }
    assert.equal(records['map-icon-MarkAlchemy'].data.title_text_id, 'TITLE');
    assert.equal(records['point-3-201'].data.building_type, 'Alchemy');
});

test('point-specific text wins and missing translations never fall back to another title', () => {
    const records = buildMaps('EN', fixture({ ManualTextMapConfigData: [
        { textMapId: 'POINT', textMapContentTextMapHash: 10 },
        { textMapId: 'TRANSLATION_MISSING', textMapContentTextMapHash: 20 },
        { textMapId: 'TITLE', textMapContentTextMapHash: 11 },
        { textMapId: 'DESC', textMapContentTextMapHash: 12 },
    ] }, {
        'Global/Mark/ConfigMarkGlobal': { markIconConfig: { Mark: { title: 'TITLE', desc: 'DESC' } } },
        'Scene/Point/scene3_point': { points: {
            1: { titleTextID: 'POINT', descTextID: 'POINT', markIconTypeName: 'Mark' },
            2: { titleTextID: 'TRANSLATION_MISSING', descTextID: 'UNKNOWN', markIconTypeName: 'Mark' },
        } },
    }, { 10: 'Specific', 11: 'Generic', 12: 'Generic description' }));
    assert.equal(records['point-3-1'].name, 'Specific');
    assert.equal(records['point-3-1'].description, 'Specific');
    assert.equal(records['point-3-1'].data.name_source, 'point');
    assert.equal(records['point-3-2'].name, '');
    assert.equal(records['point-3-2'].description, '');
    assert(records['point-3-2'].diagnostics.includes('missing_text:name:20'));
    assert(records['point-3-2'].diagnostics.includes('missing_manual_text:description:UNKNOWN'));
});

test('missing or conflicting point mark associations do not guess by asset-name similarity', () => {
    const records = buildMaps('EN', fixture({}, {
        'Global/Mark/ConfigMarkGlobal': { sceneBuildingMarks: { Known: 'Missing', Conflict: 'Second' },
            markIconConfig: { MarkUnknown: { iconName: 'UI_MarkUnknown' }, First: {}, Second: {} } },
        'Scene/Point/scene3_point': { points: {
            1: { buildingType: 'Unknown' }, 2: { buildingType: 'Known' },
            3: { buildingType: 'Conflict', markIconTypeName: 'First' },
        } },
    }));
    assert(records['point-3-1'].diagnostics.includes('missing_building_mark:Unknown'));
    assert(records['point-3-2'].diagnostics.includes('missing_point_map_icon:Missing'));
    assert(records['point-3-3'].diagnostics.includes('conflicting_point_map_icon:First:Second'));
    for (const id of [1, 2, 3]) {
        assert.equal(records[`point-3-${id}`].data.icon, undefined);
        assert(!records[`point-3-${id}`].relations.some(r => r.role === 'map_icon'));
    }
});

test('dungeon entrance text uses scene plus point ID and public links never use dungeon level IDs', () => {
    const records = buildMaps('EN', fixture({ DungeonEntryExcelConfigData: [
        { id: 1, sceneId: 3, dungeonEntryId: 48, descTextMapHash: 101 },
        { id: 1046, sceneId: 9, dungeonEntryId: 48, descTextMapHash: 102 },
        { id: 2, sceneId: 3, dungeonEntryId: 99, descTextMapHash: 103 },
    ] }, {
        'Scene/Point/scene3_point': { points: { 48: { dungeonIds: [200, 201] }, 99: { dungeonIds: [300] }, 100: { dungeonIds: [99] } } },
        'Scene/Point/scene9_point': { points: { 48: { dungeonIds: [400] } } },
    }, { 101: 'Main world entrance', 102: 'Event scene entrance', 103: 'Unique entrance' }));
    assert.equal(records['point-3-48'].description, 'Main world entrance');
    assert.equal(records['point-9-48'].description, 'Event scene entrance');
    assert.equal(records['point-9-48'].data.dungeon_entry_id, 1046);
    assert.equal(records['point-3-99'].data.description_source, 'dungeon_entry');
    assert.deepEqual(records['point-3-99'].relations.filter(r => r.category === 'dungeons'), [{ role: 'dungeon', category: 'dungeons', id: '99' }]);
    for (const id of ['point-3-48', 'point-9-48']) {
        assert(records[id].diagnostics.includes('ambiguous_dungeon_query_id:48'));
        assert(!records[id].relations.some(r => r.category === 'dungeons'));
    }
    assert.deepEqual(records['point-3-48'].data.dungeon_ids, [200, 201]);
    assert(!records['point-3-100'].relations.some(r => r.category === 'dungeons'));
});

test('waypoints and statues retain category variants and resolve city text without treating TOWER exits as statues', () => {
    const records = buildMaps('EN', fixture({
        WorldAreaConfigData: [{ id: 1200, sceneID: 3, areaID1: 2, towerPointId: 4 }],
        CityConfigData: [{ cityId: 1, areaIdVec: [2], cityGoddnessNameTextMapHash: 21, cityGoddnessDescTextMapHash: 22 }],
        ManualTextMapConfigData: [{ textMapId: 'WAYPOINT', textMapContentTextMapHash: 23 }],
    }, {
        'Global/Mark/ConfigMarkGlobal': { markIconConfig: {
            MarkTransPoint: { title: 'WAYPOINT', iconName: 'UI_MarkTransPoint' }, MarkTransPointLocked: { iconName: 'UI_MarkTransPoint', materialIndex: 1 },
            MarkGoddessUnlocked: { title: 'InCityData', desc: 'InCityData', iconName: 'UI_MarkGoddess5' }, MarkGoddessLocked: {},
        } },
        'Scene/Point/scene3_point': { points: { 4: { $type: 'BHJILFMHGEE', type: 'TOWER' }, 5: { $type: 'BHJILFMHGEE' } } },
        'Scene/Point/scene1004_point': { points: { 4: { $type: 'BHJILFMHGEE', type: 'TOWER' }, 9: { $type: 'BHJILFMHGEE', subtype: 'MOONTOWER' } } },
    }, { 21: 'Statues of The Seven - Anemo', 22: 'Original statue text', 23: 'Teleport Waypoint' }));
    assert.equal(records['point-3-4'].name, 'Statues of The Seven - Anemo');
    assert.equal(records['point-3-4'].data.name_source, 'city_statue');
    assert.equal(records['point-3-5'].name, 'Teleport Waypoint');
    assert.equal(records['point-3-5'].data.icon_source, 'category-preview');
    assert(records['point-3-5'].relations.some(r => r.role === 'locked_map_icon'));
    assert.equal(records['point-1004-4'].data.map_icon_id, undefined);
    assert.equal(records['point-1004-9'].data.map_icon_id, undefined);
    assert.equal(records['point-1004-9'].name, '');
    assert.equal(records['point-1004-9'].data.transport_subtype, 'MOONTOWER');
    assert(!records['map-icon-MarkGoddessUnlocked'].diagnostics.some(d => d.includes('missing_manual_text')));
});

test('ambiguous cities and untranslated city text never choose another name', () => {
    const make = cities => buildMaps('EN', fixture({ WorldAreaConfigData: [{ id: 1, sceneID: 3, areaID1: 2, towerPointId: 4 }], CityConfigData: cities },
        { 'Scene/Point/scene3_point': { points: { 4: { $type: 'BHJILFMHGEE' } } } }));
    const city = { cityId: 1, areaIdVec: [2], cityGoddnessNameTextMapHash: 21 };
    assert.equal(make([city])['point-3-4'].name, '');
    assert(make([city])['point-3-4'].diagnostics.includes('missing_text:name:21'));
    assert(make([city, { ...city, cityId: 2 }])['point-3-4'].diagnostics.includes('statue_city_unresolved:2'));
});

test('activity references and entrance requirements are not promoted to point lifetimes or visibility', () => {
    const records = buildMaps('EN', fixture({
        DungeonEntryExcelConfigData: [{ id: 1, sceneId: 3, dungeonEntryId: 48, type: 'DUNGEON_ENTRY_TYPE_ACTIVITY',
            isDefaultOpen: true, condComb: 'LOGIC_OR', satisfiedCond: [{ type: 'DUNGEON_ENTRY_CONDITION_LEVEL', param1: 10 }, { type: 'DUNGEON_ENTRY_CONDITION_QUEST', param1: 35802 }] }],
        NewActivityExcelConfigData: [{ activityId: 7, activityType: 'TEST', dungeonIdList: [100], nameTextMapHash: 41 }],
        NewActivityEntryConfigData: [{ id: 7, activityType: 'TEST', duration: 14 }],
    }, {
        'Global/Mark/ConfigMarkGlobal': { markIconConfig: { MarkDailyDungeonEntry: {}, MarkDailyDungeonEntryLocked: {}, MarkDailyDungeonEntryToBeExplored: {} } },
        'Scene/Point/scene3_point': { points: { 48: { $type: 'NKJPPNFAEEF', NPFLMLBMDLL: 'Daily', dungeonIds: [100] }, 49: { dungeonIds: [101] } } },
        'Quest/1': quest(1, [step(101, [['HIDE_SCENE_POINT', '3', '48']])]),
    }, { 41: 'Event <name>' }));
    const point = records['point-3-48'];
    assert.equal(point.data.map_icon_id, 'MarkDailyDungeonEntry');
    assert.equal(point.data.entry_access.combination, 'LOGIC_OR');
    assert.equal(point.data.presence.classification, 'activity-associated');
    assert.equal(point.data.presence.lifetime, 'unresolved');
    assert.equal(point.data.presence.activities[0].configured_duration, 14);
    assert.equal(point.data.visibility, undefined);
    assert.equal(records['point-3-49'].data.presence.classification, 'unresolved');
    assert(point.relations.some(r => r.role === 'quest_control' && r.id === 'quest-event-101-finish-0'));
});

test('trounce category portraits use the composite entrance record when scene entry type is absent', () => {
    const records = buildMaps('EN', fixture({ DungeonEntryExcelConfigData: [
        { id: 1006, sceneId: 3, dungeonEntryId: 38, type: 'DUNGEON_ENTRY_TYPE_TRIAL' },
    ] }, {
        'Global/Mark/ConfigMarkGlobal': { markIconConfig: { MarkWeeklyDungeonEntry: {}, MarkDungeonEntry: {} } },
        'Scene/Point/scene3_point': { points: { 38: { $type: 'NKJPPNFAEEF' } } },
        'Scene/Point/scene9_point': { points: { 38: { $type: 'NKJPPNFAEEF' } } },
    }));
    assert.equal(records['point-3-38'].data.map_icon_id, 'MarkWeeklyDungeonEntry');
    assert.equal(records['point-9-38'].data.map_icon_id, 'MarkDungeonEntry');
    assert.equal(records['point-3-38'].data.presence.lifetime, 'unresolved');
});

test('quest map, tag and point actions have distinct parameter namespaces and phases', () => {
    const records = buildMaps('EN', fixture({}, { 'Quest/75020': quest(75020, [
        step(7502006, [['UNLOCK_POINT', '3', '1304'], ['ADD_SCENE_TAG', '3', '102'], ['CHANGE_MAP_AREA_STATE', '56', '1'], ['SET_MAP_LAYER_UNLOCK_STATE', '3460401;3460402', '0']]),
        step(7502013, [['SET_MAP_LAYER_UNLOCK_STATE', '3460407', '1']], FIELDS.fail),
    ]) }));
    const point = records['quest-event-7502006-finish-0'];
    assert.ok(point.relations.some(r => r.id === 'point-3-1304'));
    const tag = records['quest-event-7502006-finish-1'];
    assert.ok(tag.relations.some(r => r.id === 'scene-tag-102'));
    assert.equal(tag.data.scene_id, 3);
    assert.equal(Object.hasOwn(tag.data, 'state'), false);
    const area = records['quest-event-7502006-finish-2'];
    assert.ok(area.relations.some(r => r.id === 'map-area-56'));
    assert.equal(area.data.state, '1');
    assert.deepEqual(records['quest-event-7502006-finish-3'].data.target_ids, [3460401, 3460402]);
    assert.equal(records['quest-event-7502013-fail-0'].data.phase, 'fail');
    assert.ok(point.diagnostics.includes('mutation_is_not_complete_visibility_predicate'));
});

test('unverified AbyssWar and batch state parameter spaces are retained without guessed links', () => {
    const records = buildMaps('EN', fixture({}, { 'Quest/1': quest(1, [step(101, [
        ['SET_ABYSS_WAR_LIMIT_REGION_STATE', '20238006', '4'], ['BATCH_SET_OPEN_STATE', '6001,6002', '1,1'],
    ])]) }));
    for (const record of Object.values(records).filter(r => r.kind === 'quest_event' && r.data.parent_quest_id === 1)) {
        assert.deepEqual(record.data.target_ids, []);
        assert.ok(record.diagnostics.includes('action_parameters_retained_without_target_guess'));
    }
});

test('state dependencies retain their source conditions and never replace a mutation predicate', () => {
    const sourceStep = step(201, [['CHANGE_MAP_AREA_STATE', '56', '1']]);
    sourceStep.finishCond = [{ type: 'QUEST_CONTENT_QUEST_STATE_EQUAL', param: [200, 3] }];
    sourceStep.unknownActivationField = [{ type: 'QUEST_COND_STATE_NOT_EQUAL', param: ['199', '2'] }];
    const item = buildMaps('EN', fixture({}, { 'Quest/2': quest(2, [sourceStep]) }))['quest-event-201-finish-0'];
    assert.deepEqual(item.data.state_dependencies, [
        { quest_id: 200, state: 3, comparison: 'equal', source_field: 'finishCond' },
        { quest_id: 199, state: 2, comparison: 'not-equal', source_field: 'unknownActivationField' },
    ]);
    assert.equal(item.data.condition_evidence[1].phase, 'unspecified');
    assert.equal(item.data.state, '1');
    assert(item.diagnostics.includes('mutation_is_not_complete_visibility_predicate'));
});

test('both floor names and the actual name-change quest survive; reference floor is not default', () => {
    const records = buildMaps('EN', fixture({
        MapLayerGroupExcelConfigData: [{ id: 32703, [FIELDS.groupReference]: 3270303 }],
        MapLayerFloorExcelConfigData: [{ id: 3270303, [FIELDS.group]: 32703, [FIELDS.floorName]: 11,
            [FIELDS.floorNewName]: 12, [FIELDS.floorNumber]: -3,
            [FIELDS.floorCondition]: { type: 'MAP_FLOOR_NAME_CHANGE_QUEST', paramList: [7305442] } }],
    }, {}, { 11: 'Unknown area', 12: 'Lower caverns' }));
    assert.equal(records['floor-3270303'].name, 'Unknown area');
    assert.equal(records['floor-3270303'].data.alternate_name, 'Lower caverns');
    assert.deepEqual(records['floor-3270303'].data.name_condition.parameters, [7305442]);
    assert.equal(Object.hasOwn(records['layer-group-32703'].data, 'default_floor'), false);
});

test('source IDs remain exact and float sentinels are not mistaken for resource integers', () => {
    const value = parseSource('{"resource":18446744073709551615,"position":-3.4028235E+38}');
    assert.equal(value.resource, '18446744073709551615');
    assert.equal(typeof value.position, 'number');
});

test('schema drift in layer links fails rather than exporting unrelated floor assignments', () => {
    assert.throws(() => buildMaps('EN', fixture({ MapLayerExcelConfigData: [{ id: 1, changedField: 2 }] })), /Unsupported map layer fields/);
    assert.throws(() => buildMaps('JP', fixture()), /Unsupported map language/);
});

test('client WorldArea parts replace the geometry source and retain empty named areas', () => {
    const input = fixture({ WorldAreaConfigData: [
        { id: 770000, sceneID: 102, areaType: 'LEVEL_1', areaID1: 900 },
        { id: 770002, sceneID: 102, areaType: 'LEVEL_2', areaID1: 900, areaID2: 90002 },
        { id: 770099, sceneID: 102, areaType: 'LEVEL_2', areaID1: 900, areaID2: 99999 },
    ] });
    const real = require('./fixtures/world-area-client.json').find(f => f.scene === 102).expected;
    const group = real.level1Areas[0];
    const source = { kind: 'client-world-area', resource_key: '380174828993227051', block: '24230448.blk', offset: 0, path_id: '59164', sha256: 'a'.repeat(64), decoder: 'gi-world-area-cn-7.1-v1' };
    input.worldAreas = () => [{ scene_id: 102, file: 'Data/_BinOutput/Scene/WorldArea/scene102_worldArea.MiHoYoBinData', source,
        data: { level1Areas: [{ level1Area: group.level1Area, level2Areas: group.level2Areas.filter(a => a.id2 === 90002) }] } }];
    const files = input.files, bin = input.bin;
    input.files = dir => { assert.notEqual(dir, 'Scene/WorldArea'); return files(dir); };
    input.bin = file => { assert(!file.startsWith('Scene/WorldArea')); return bin(file); };
    const records = buildMaps('EN', input);
    assert.equal(records['world-area-770002'].data.polygons.length, 2);
    assert.deepEqual(records['world-area-770002'].data.polygons[0].source, source);
    assert.equal(records['world-area-770099'].data.polygons, undefined);
    assert(records['world-area-770099'].relations.some(r => r.role === 'parent_area' && r.id === 'world-area-770000'));
});
