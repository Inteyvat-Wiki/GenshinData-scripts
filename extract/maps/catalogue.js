// This is an evidence catalogue, not a client-state simulator. Missing values
// stay missing; a quest mutation is never promoted to a full visibility rule.
const TABLES = {
    scene: 'SceneExcelConfigData', world_area: 'WorldAreaConfigData', map_area: 'MapAreaConfigData',
    layer_group: 'MapLayerGroupExcelConfigData', floor: 'MapLayerFloorExcelConfigData', layer: 'MapLayerExcelConfigData',
    label: 'PlaceNameConfigData', map_tag: 'MapTagDataConfigData', level_tag: 'LevelTagExcelConfigData',
    scene_tag: 'SceneTagConfigData', limit_region: 'LimitRegionExcelConfigData', open_state: 'OpenStateConfigData',
};
const schema = require('./schema');
const IMAGE_CORRECTIONS = { 3380401: 3340107, 3380102: 3380103, 3380103: 3380102,
    3440201: 3460601, 3460601: 3440201, 3481101: 3481102, 3481102: 3481101,
    3490602: 3490603, 3490603: 3490602 };
const { categoryProfile, enrichPointDetails, linkPointControls, pointMapDisplay } = require('./point-details');
const prefix = kind => kind.replaceAll('_', '-');
const key = (kind, id) => `${prefix(kind)}-${id}`;
const copy = value => JSON.parse(JSON.stringify(value));
function scalarId(value, context) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid map ID: ${context}:${value}`);
    return value;
}
function vector(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid map vector');
    const result = {};
    for (const axis of ['x', 'y', 'z']) if (Object.hasOwn(value, axis)) {
        if (!Number.isFinite(value[axis])) throw new Error(`Invalid map coordinate ${axis}`);
        result[axis] = value[axis];
    }
    return result;
}
function geometry(row) {
    return { ...(row.minArea ? { minimum: vector(row.minArea) } : {}),
        ...(row.maxArea ? { maximum: vector(row.maxArea) } : {}),
        ...(row.roadPoints ? { points: row.roadPoints.map(vector) } : {}) };
}
function buildMaps(language, input) {
    if (!['CHS', 'EN'].includes(language)) throw new Error(`Unsupported map language: ${language}`);
    const output = {}, tables = new Map();
    const rows = name => { if (!tables.has(name)) tables.set(name, input.excel(name)); return tables.get(name); };
    const raw = kind => rows(TABLES[kind]);
    const pointFiles = input.files('Scene/Point'), questFiles = input.files('Quest');
    const hasPoints = pointFiles.some(file => /scene(-?\d+)_point$/i.test(file));
    const pointTypes = hasPoints ? schema.pointClasses(input) : {};
    const fields = { ...schema.worldAreaFields(raw('world_area')), ...schema.groupFields(raw('layer_group')),
        ...schema.floorFields(raw('floor')), ...schema.layerFields(raw('layer')),
        ...(hasPoints ? schema.pointFields(input) : {}),
        ...(questFiles.length ? schema.questFields(input) : {}) };
    const create = (kind, id, file, sourceId = id) => {
        const item = { schema: 1, id: key(kind, id), kind, name: '', description: '', texts: [], relations: [], data: {},
            source: { file, id: String(sourceId), hashes: [], fields: [] }, diagnostics: [] };
        if (output[item.id]) throw new Error(`Duplicate map record: ${item.id}`);
        output[item.id] = item;
        return item;
    };
    const tableItem = (kind, row) => create(kind, scalarId(row.id, kind), `ExcelBinOutput/${TABLES[kind]}.json`);
    const field = (item, row, from, to, convert = value => value) => {
        if (!Object.hasOwn(row, from)) return;
        item.source.fields.push(from);
        item.data[to] = convert(row[from]);
    };
    const text = (item, hash, role) => {
        if (!hash) return '';
        if (!Number.isSafeInteger(hash) || hash < 0 || hash > 0xffffffff) throw new Error(`Invalid map text hash ${item.id}:${hash}`);
        const h = String(hash), value = input.text(language, h) || '';
        if (!item.source.hashes.includes(h)) item.source.hashes.push(h);
        item.texts.push({ role, text: value, hash: h });
        if (!value) item.diagnostics.push(`missing_text:${role}:${h}`);
        return value;
    };
    const relation = (item, role, kind, id, category = 'maps') => {
        if (id === undefined || id === null || id === '') return;
        const target = category === 'maps' ? key(kind, id) : String(id);
        if (!item.relations.some(r => r.role === role && r.category === category && r.id === target))
            item.relations.push({ role, category, id: target });
    };
    const rawText = (item, role, value) => {
        if (value) item.texts.push({ role, text: value });
        return value || '';
    };
    const condition = value => ({ ...(value.type ? { type: value.type } : {}),
        ...(value.paramList ? { parameters: copy(value.paramList) } : {}) });
    const textIds = new Map(rows('ManualTextMapConfigData').map(row => [row.textMapId, row.textMapContentTextMapHash]));
    const manual = (item, id, role) => {
        if (!id) return '';
        if (!textIds.has(id)) { item.diagnostics.push(`missing_manual_text:${role}:${id}`); return ''; }
        return text(item, textIds.get(id), role);
    };

    for (const row of raw('scene')) {
        const item = tableItem('scene', row);
        item.name = rawText(item, 'developer_name', row.comment);
        for (const [from, to] of Object.entries({ id: 'scene_id', type: 'scene_type', scriptData: 'script', worldSceneId: 'world_scene_id',
            imageSceneId: 'image_scene_id', sceneFixTime: 'fixed_time', isAllowMapMarkPoint: 'allow_map_mark' })) field(item, row, from, to);
        if (row.boundaryPointVec) field(item, row, 'boundaryPointVec', 'boundary_values', copy);
        relation(item, 'world_scene', 'scene', row.worldSceneId);
        relation(item, 'image_scene', 'scene', row.imageSceneId);
    }
    const worldAreas = raw('world_area');
    for (const row of worldAreas) {
        const item = tableItem('world_area', row);
        item.name = text(item, row.areaNameTextMapHash, 'name');
        if (row[fields.configurationName]) text(item, row[fields.configurationName], 'configuration_name');
        for (const [from, to] of Object.entries({ id: 'area_id', sceneID: 'scene_id', areaType: 'level', areaID1: 'area_1_id',
            areaID2: 'area_2_id', towerPointId: 'tower_point_id', minimapScale: 'minimap_scale' })) field(item, row, from, to);
        relation(item, 'scene', 'scene', row.sceneID);
        if (row.towerPointId !== undefined) relation(item, 'statue', 'point', `${row.sceneID}-${row.towerPointId}`);
        if (row.areaType === 'LEVEL_2') {
            const parents = worldAreas.filter(p => p.sceneID === row.sceneID && p.areaType === 'LEVEL_1' && p.areaID1 === row.areaID1);
            if (parents.length === 1) relation(item, 'parent_area', 'world_area', parents[0].id);
            else item.diagnostics.push(`ambiguous_parent_area:${parents.length}`);
        }
    }
    // Spatial WorldArea polygons locate areas, not the red playable-map boundary.
    for (const { scene_id: sceneId, file, source, data } of input.worldAreas()) {
        for (const group of data.level1Areas || []) for (const [level, area] of [['LEVEL_1', group.level1Area], ...(group.level2Areas || []).map(a => ['LEVEL_2', a])]) {
            if (!area?.polygonData) continue;
            const matches = worldAreas.filter(row => row.sceneID === sceneId && row.areaType === level && row.areaID1 === area.id1 && (level === 'LEVEL_1' || row.areaID2 === area.id2));
            if (matches.length === 1) {
                const item = output[key('world_area', matches[0].id)];
                (item.data.polygons ||= []).push({ file, source: copy(source), ...geometry(area.polygonData) });
            } else throw new Error(`Unresolved client WorldArea: ${sceneId}/${level}/${area.id1}/${area.id2}`);
        }
    }
    const configs = input.bin('Map/MapArea/ConfigMapArea');
    for (const row of raw('map_area')) {
        const item = tableItem('map_area', row);
        item.name = rawText(item, 'developer_name', row.name);
        for (const [from, to] of Object.entries({ id: 'area_id', sceneID: 'scene_id', areaID1: 'area_1_ids', mapAreaState: 'state', type: 'area_type', scenePointID: 'scene_point_id' })) field(item, row, from, to);
        relation(item, 'scene', 'scene', row.sceneID);
        if (row.scenePointID !== undefined) relation(item, 'point', 'point', `${row.sceneID}-${row.scenePointID}`);
        for (const areaId of row.areaID1 || []) for (const area of worldAreas.filter(a => a.sceneID === row.sceneID && a.areaType === 'LEVEL_1' && a.areaID1 === areaId)) relation(item, 'world_area', 'world_area', area.id);
        const config = configs[String(row.id)];
        if (config) {
            item.data.config = { key: String(row.id) };
            if (input.mapAreaConfigs) item.data.config.source = copy(input.mapAreaConfigs().source);
            for (const [from, to] of Object.entries({ id: 'id', $type: 'type', prefabPath: 'prefab', sortID: 'sort', index: 'index', hideScenePointList: 'hidden_point_ids', useSubAnchor: 'use_sub_anchor' }))
                if (Object.hasOwn(config, from)) item.data.config[to] = copy(config[from]);
            if (config.mapPosList) item.data.config.map_positions = config.mapPosList.map(vector);
            if (config.id !== row.id) item.diagnostics.push('config_inner_id_differs_from_lookup_key');
            for (const point of config.hideScenePointList || []) relation(item, 'hidden_point', 'point', `${row.sceneID}-${point}`);
        } else item.diagnostics.push('missing_map_area_config');
    }
    const groups = raw('layer_group'), floors = raw('floor'), layers = raw('layer');
    for (const row of groups) {
        const item = tableItem('layer_group', row);
        field(item, row, 'id', 'group_id'); field(item, row, fields.groupAreas, 'area_ids'); field(item, row, fields.groupReference, 'reference_floor_id');
        item.data.floor_ids = floors.filter(f => f[fields.group] === row.id).map(f => f.id);
        const areaMatches = (row[fields.groupAreas] || []).map(id => worldAreas.filter(area => area.areaType === 'LEVEL_1' && area.areaID1 === id));
        const sceneIds = [...new Set(areaMatches.flat().map(area => area.sceneID))];
        if (areaMatches.length && areaMatches.every(matches => matches.length) && sceneIds.length === 1) {
            item.data.scene_id = sceneIds[0]; relation(item, 'scene', 'scene', sceneIds[0]);
        } else item.diagnostics.push('layer_group_scene_unresolved');
        for (const id of item.data.floor_ids) relation(item, 'floor', 'floor', id);
        relation(item, 'reference_floor', 'floor', row[fields.groupReference]);
        item.diagnostics.push('reference_floor_is_not_verified_default');
    }
    for (const row of floors) {
        if (!Object.hasOwn(row, fields.group) || !Object.hasOwn(row, fields.floorName)) throw new Error(`Unsupported map floor fields: ${row.id}`);
        const item = tableItem('floor', row);
        item.name = text(item, row[fields.floorName], 'name');
        item.data.alternate_name = text(item, row[fields.floorNewName], 'alternate_name');
        field(item, row, 'id', 'floor_id'); field(item, row, fields.group, 'group_id'); field(item, row, fields.floorNumber, 'number');
        const sceneId = output[key('layer_group', row[fields.group])]?.data.scene_id;
        if (sceneId !== undefined) item.data.scene_id = sceneId;
        if (row[fields.floorCondition] && Object.keys(row[fields.floorCondition]).length) {
            item.data.name_condition = condition(row[fields.floorCondition]);
            if (row[fields.floorCondition].type === 'MAP_FLOOR_NAME_CHANGE_QUEST')
                for (const id of row[fields.floorCondition].paramList || []) relation(item, 'name_change_quest', '', id, 'quest_step');
        }
        item.data.layer_ids = layers.filter(layer => layer[fields.floor] === row.id).map(layer => layer.id);
        relation(item, 'group', 'layer_group', row[fields.group]);
        for (const id of item.data.layer_ids) relation(item, 'layer', 'layer', id);
    }
    for (const row of layers) {
        if (!Object.hasOwn(row, fields.floor)) throw new Error(`Unsupported map layer fields: ${row.id}`);
        const item = tableItem('layer', row);
        field(item, row, 'id', 'layer_id'); field(item, row, fields.floor, 'floor_id');
        const sceneId = output[key('floor', row[fields.floor])]?.data.scene_id;
        if (sceneId !== undefined) item.data.scene_id = sceneId;
        item.data.image_name = `UI_Map_LayeredMap_${IMAGE_CORRECTIONS[row.id] || row.id}`;
        item.data.image_name_method = IMAGE_CORRECTIONS[row.id] ? 'verified_sprite_correction' : 'name_convention';
        relation(item, 'floor', 'floor', row[fields.floor]);
        item.diagnostics.push('native_layout_and_visibility_required');
    }
    for (const row of raw('label')) {
        const item = tableItem('label', row);
        item.name = text(item, row.switchNameTextMapHash, 'replacement_name');
        for (const [from, to] of Object.entries({ id: 'label_id', placeNameID: 'place_name_id', subAreaID: 'sub_area_id', actionType: 'action', mapTagType: 'map_tag_type', type: 'target_type' })) field(item, row, from, to);
        item.data.condition = { type: row.conditionType, parameters: [row.conditionParam1, row.conditionParam2].filter(v => v !== undefined) };
        if (row.conditionType === 'MapArea' || row.conditionType === 'ErosionArea') relation(item, 'condition_area', 'map_area', row.conditionParam1);
        else if (row.conditionType === 'Quest') relation(item, 'condition_quest', '', row.conditionParam1, 'quest_step');
        else if (row.conditionType === 'MultiQuest') {
            for (const id of String(row.conditionParam1 || '').split(',').filter(value => /^\d+$/.test(value))) relation(item, 'condition_quest', '', id, 'quest_step');
        }
        if (row.type === 'SubArea') {
            const targets = worldAreas.filter(area => area.areaType === 'LEVEL_2' && area.areaID2 === row.subAreaID);
            if (targets.length === 1) {
                item.data.world_area_id = targets[0].id;
                relation(item, 'target_world_area', 'world_area', targets[0].id);
                relation(output[key('world_area', targets[0].id)], 'name_rule', 'label', row.id);
            } else item.diagnostics.push(`label_subarea_unresolved:${targets.length}`);
        }
        item.diagnostics.push('condition_parameters_preserved_without_state_guess');
    }
    for (const row of raw('map_tag')) {
        const item = tableItem('map_tag', row);
        item.name = text(item, row.nameTextMapHash, 'name'); text(item, row.nameWithRubyTextTextMapHash, 'ruby_name');
        for (const [from, to] of Object.entries({ id: 'tag_id', type: 'tag_type', icon: 'icon', sceneIdList: 'scene_ids', hideBeforeUnlock: 'hide_before_unlock', transPointID: 'point_id', sortID: 'sort' })) field(item, row, from, to);
        for (const sceneId of row.sceneIdList || []) relation(item, 'scene', 'scene', sceneId);
    }
    const markFile = 'Global/Mark/ConfigMarkGlobal', mark = input.bin(markFile);
    for (const [id, row] of Object.entries(mark.markIconConfig || {})) {
        const item = create('map_icon', id, `BinOutput/${markFile}.json`);
        // InCityData directs the client to CityConfigData; it is not a text ID.
        item.name = row.title === 'InCityData' ? '' : manual(item, row.title, 'name');
        item.description = row.desc === 'InCityData' ? '' : manual(item, row.desc, 'description');
        field(item, row, 'title', 'title_text_id'); field(item, row, 'desc', 'description_text_id');
        for (const [from, to] of Object.entries({ iconName: 'icon', effectName: 'effect', markType: 'mark_type', markLayer: 'layer', visibilityOnRadar: 'radar_visibility', visibilityOnMap: 'map_visibility', showOnLockedArea: 'show_on_locked_area', showHeightOnRadar: 'show_height', materialIndex: 'material_index' })) field(item, row, from, to);
    }
    const dungeonEntries = rows('DungeonEntryExcelConfigData');
    const entriesByPoint = new Map(), entriesByQueryId = new Map();
    for (const entry of dungeonEntries) {
        const id = `${entry.sceneId}-${entry.dungeonEntryId}`;
        if (!entriesByPoint.has(id)) entriesByPoint.set(id, []);
        entriesByPoint.get(id).push(entry);
        if (!entriesByQueryId.has(entry.dungeonEntryId)) entriesByQueryId.set(entry.dungeonEntryId, []);
        entriesByQueryId.get(entry.dungeonEntryId).push(entry);
    }
    function pointIcon(item, row) {
        const direct = row.markIconTypeName;
        const building = row.buildingType && mark.sceneBuildingMarks?.[row.buildingType];
        if (row.buildingType && !building) item.diagnostics.push(`missing_building_mark:${row.buildingType}`);
        if (direct && building && direct !== building) {
            item.diagnostics.push(`conflicting_point_map_icon:${direct}:${building}`);
            return;
        }
        const profile = !direct && !building ? categoryProfile(row, item.data.point_class, item.data.dungeon_entry_category, fields.entryType) : undefined;
        const id = direct || building || profile?.[0];
        if (!id) return;
        if (typeof id !== 'string') throw new Error(`Invalid point map icon: ${item.id}`);
        item.data.map_icon_id = id;
        item.data.icon_source = direct ? 'point' : building ? 'building' : 'category-preview';
        if (profile) {
            item.diagnostics.push('map_icon_runtime_state_unresolved');
            for (const [index, variant] of profile.entries()) if (index && output[key('map_icon', variant)])
                relation(item, index === 1 ? 'locked_map_icon' : 'unexplored_map_icon', 'map_icon', variant);
        }
        if (direct) item.source.fields.push('markIconTypeName');
        const icon = output[key('map_icon', id)];
        if (!icon) { item.diagnostics.push(`missing_point_map_icon:${id}`); return; }
        relation(item, 'map_icon', 'map_icon', id);
        if (icon.data.icon) item.data.icon = icon.data.icon;
        for (const role of ['name', 'description']) {
            // An untranslated point-specific text is not replaced by a generic
            // mark translation. Only an absent direct text reference falls back.
            const directText = role === 'name' ? row.titleTextID : row.descTextID;
            if (directText || item.data[`${role}_source`] || item[role] || !icon[role]) continue;
            item[role] = icon[role]; item.data[`${role}_source`] = 'map_icon';
            for (const evidence of icon.texts.filter(value => value.role === role)) {
                item.texts.push(copy(evidence));
                if (evidence.hash && !item.source.hashes.includes(evidence.hash)) item.source.hashes.push(evidence.hash);
            }
        }
    }
    for (const file of pointFiles) {
        const match = /scene(-?\d+)_point$/i.exec(file); if (!match) continue;
        const sceneId = Number(match[1]), data = input.bin(file);
        if (Array.isArray(data) || Array.isArray(data.points)) {
            const item = create('point_collection', sceneId, `BinOutput/${file}.json`);
            item.data = { scene_id: sceneId, count: (Array.isArray(data) ? data : data.points).length };
            item.diagnostics.push('nonstandard_point_array_not_interpreted');
            continue;
        }
        for (const [pointId, row] of Object.entries(data.points || {})) {
            scalarId(Number(pointId), 'point');
            const item = create('point', `${sceneId}-${pointId}`, `BinOutput/${file}.json`, pointId);
            item.data.scene_id = sceneId; item.data.point_id = Number(pointId);
            item.data.point_class = pointTypes[row.$type] || 'unresolved';
            if (worldAreas.some(area => area.sceneID === sceneId && area.towerPointId === Number(pointId))) item.data.point_class = 'statue';
            item.name = manual(item, row.titleTextID, 'name'); item.description = manual(item, row.descTextID, 'description');
            field(item, row, 'titleTextID', 'title_text_id'); field(item, row, 'descTextID', 'description_text_id');
            field(item, row, 'buildingType', 'building_type');
            if (row.titleTextID) item.data.name_source = 'point';
            if (row.descTextID) item.data.description_source = 'point';
            const entries = entriesByPoint.get(`${sceneId}-${pointId}`) || [];
            if (entries.length === 1) {
                const entry = entries[0];
                item.data.dungeon_entry_id = scalarId(entry.id, 'dungeon_entry');
                if (!row.descTextID && entry.descTextMapHash) {
                    item.description = text(item, entry.descTextMapHash, 'description');
                    item.data.description_source = 'dungeon_entry';
                }
                // The existing dungeons query indexes entrances by point ID,
                // not DungeonExcel level IDs. Cross-scene collisions cannot
                // safely identify one existing public record.
                if (entriesByQueryId.get(entry.dungeonEntryId).length === 1)
                    relation(item, 'dungeon', '', entry.dungeonEntryId, 'dungeons');
                else item.diagnostics.push(`ambiguous_dungeon_query_id:${entry.dungeonEntryId}`);
            } else if (entries.length > 1) item.diagnostics.push(`ambiguous_dungeon_entry:${entries.length}`);
            enrichPointDetails({ item, row, entry: entries.length === 1 ? entries[0] : undefined, worldAreas, rows, text, entryTypeField: fields.entryType });
            pointIcon(item, row);
            rawText(item, 'alias', row.alias);
            if (Object.hasOwn(row, 'type')) item.data.transport_type = row.type;
            for (const [from, to] of Object.entries({ $type: 'point_type', areaId: 'area_id', [fields.pointArea]: 'sub_area_id', [fields.pointFloor]: 'layer_id', gadgetId: 'gadget_id', dungeonIds: 'dungeon_ids', mapVisibility: 'visibility', unlocked: 'unlocked', forbidSimpleUnlock: 'forbid_simple_unlock', showLevel: 'show_level', entryPointId: 'entry_point_id' })) field(item, row, from, to);
            item.data.map_display = pointMapDisplay(item, output[key('map_icon', item.data.map_icon_id)]);
            for (const [from, to] of Object.entries({ pos: 'position', rot: 'rotation', tranPos: 'trans_position', tranRot: 'trans_rotation' })) field(item, row, from, to, vector);
            relation(item, 'scene', 'scene', sceneId); relation(item, 'layer', 'layer', row[fields.pointFloor]);
            if (row[fields.pointFloor] !== undefined) {
                const layer = output[key('layer', row[fields.pointFloor])];
                if (layer) { item.data.floor_id = layer.data.floor_id; relation(item, 'floor', 'floor', layer.data.floor_id); }
            }
            // The point's subarea namespace is areaID2, not WorldArea.id.
            if (row[fields.pointArea] !== undefined) {
                const areas = worldAreas.filter(a => a.sceneID === sceneId && a.areaType === 'LEVEL_2'
                    && a.areaID2 === row[fields.pointArea] && (row.areaId === undefined || a.areaID1 === row.areaId));
                if (areas.length === 1) { item.data.world_area_id = areas[0].id; relation(item, 'world_area', 'world_area', areas[0].id); }
                else item.diagnostics.push(`unresolved_point_subarea:${areas.length}`);
            }
            if (row.entryPointId !== undefined) relation(item, 'entry_point', 'point', `${sceneId}-${row.entryPointId}`);
        }
    }
    const tagAreas = rows('LevelTagMapAreaConfigData');
    for (const row of raw('level_tag')) {
        const item = tableItem('level_tag', row);
        item.name = rawText(item, 'developer_name', row.levelTagName);
        for (const [from, to] of Object.entries({ id: 'tag_id', sceneId: 'scene_id', addSceneTagIdList: 'add_scene_tags', removeSceneTagIdList: 'remove_scene_tags', levelTagFixedEnviroTime: 'fixed_time', levelTagCanFixTime: 'can_fix_time' })) field(item, row, from, to);
        item.data.map_areas = tagAreas.filter(r => r.levelTagID === row.id).map(r => ({ area_id: r.mapAreaID, ...(Object.hasOwn(r, 'index') ? { index: r.index } : {}) }));
        relation(item, 'scene', 'scene', row.sceneId);
        for (const id of row.addSceneTagIdList || []) relation(item, 'added_scene_tag', 'scene_tag', id);
        for (const id of row.removeSceneTagIdList || []) relation(item, 'removed_scene_tag', 'scene_tag', id);
        for (const value of item.data.map_areas) relation(item, 'map_area', 'map_area', value.area_id);
    }
    for (const row of raw('scene_tag')) {
        const item = tableItem('scene_tag', row);
        item.name = rawText(item, 'developer_name', row.sceneTagName);
        for (const [from, to] of Object.entries({ id: 'tag_id', sceneId: 'scene_id', isDefaultValid: 'default_valid', isIndependent: 'independent' })) field(item, row, from, to);
        item.data.conditions = (row.cond || []).filter(c => Object.keys(c).length).map(copy);
        relation(item, 'scene', 'scene', row.sceneId);
    }
    for (const row of raw('limit_region')) {
        const item = tableItem('limit_region', row);
        item.name = rawText(item, 'resource_name', row.name);
        for (const [from, to] of Object.entries({ id: 'region_id', sceneId: 'scene_id', type: 'region_type', order: 'order', hidePaimon: 'hide_paimon', openstate: 'open_state_name', reminderID: 'reminder_id' })) field(item, row, from, to);
        relation(item, 'scene', 'scene', row.sceneId);
        // Only these symbol -> numeric-ID links have been independently verified.
        const resolved = { OPEN_STATE_LIMIT_REGION_GLOBAL: 48, OPEN_STATE_LIMIT_REGION_FRESHMEAT: 47 }[row.openstate];
        if (resolved !== undefined) { item.data.open_state_id = resolved; relation(item, 'open_state', 'open_state', resolved); }
        else if (row.openstate) item.diagnostics.push('open_state_symbol_unresolved');
        item.diagnostics.push('playable_boundary_geometry_not_resolved');
    }
    for (const row of raw('open_state')) {
        const item = tableItem('open_state', row);
        field(item, row, 'id', 'state_id'); field(item, row, 'allowClientOpen', 'allow_client_open');
        item.data.conditions = (row.cond || []).filter(c => Object.keys(c).length).map(copy);
    }
    const globalFile = 'Mark/MapGlobal', global = input.bin(globalFile), globalItem = create('map_settings', 'global', `BinOutput/${globalFile}.json`);
    for (const [from, to] of Object.entries({ miniMapUIRadius: 'minimap_ui_radius', miniMapSightRadius: 'minimap_sight_radius', miniMapScaleDefault: 'minimap_scale', miniMapScaleRanks: 'minimap_scales', levelMapScaleDefault: 'map_scale', levelMapScaleMin: 'map_scale_min', levelMapScaleMax: 'map_scale_max', markNearThreshold: 'mark_near_threshold' })) field(globalItem, global, from, to);

    const actions = new Set(['CHANGE_MAP_AREA_STATE', 'CHANGE_SCENE_LEVEL_TAG', 'SET_MAP_LAYER_UNLOCK_STATE', 'SHOW_MAP_LAYER_GROUP',
        'SET_LIMIT_REGION_STATE', 'SET_ABYSS_WAR_LIMIT_REGION_STATE', 'HIDE_SCENE_POINT', 'UNHIDE_SCENE_POINT', 'UNLOCK_POINT', 'LOCK_POINT',
        'UNLOCK_AREA', 'UNLOCK_PLAYER_WORLD_SCENE', 'SET_OPEN_STATE', 'SET_OPEN_STATE_V2', 'BATCH_SET_OPEN_STATE', 'ADD_SCENE_TAG', 'DEL_SCENE_TAG', 'MODIFY_DUNGEON_EXIT_POINT']);
    for (const file of questFiles) {
        const quest = input.bin(file);
        const steps = quest[fields.quests];
        if (!Array.isArray(steps)) continue;
        for (const step of steps) for (const [phase, sourceField] of [['finish', fields.finish], ['fail', fields.fail]]) {
            if (!Object.hasOwn(step, sourceField)) continue;
            for (const [ordinal, execution] of step[sourceField].entries()) {
                const action = execution.type?.replace(/^QUEST_EXEC_/, ''); if (!actions.has(action)) continue;
                const questId = step[fields.questId];
                scalarId(questId, 'quest'); scalarId(quest.id, 'parent quest');
                const item = create('quest_event', `${questId}-${phase}-${ordinal}`, `BinOutput/${file}.json`, questId);
                item.name = text(item, step[fields.questName], 'quest_description');
                item.data = { quest_id: questId, parent_quest_id: quest.id, phase, action: execution.type, parameters: copy(execution.param || []), target_ids: [] };
                // These are evidence about the source step, not an equivalent
                // predicate for the eventual map state. In particular a finish
                // mutation can outlive the step which emitted it.
                item.data.condition_evidence = Object.entries(step).filter(([, value]) => Array.isArray(value)
                    && value.some(condition => /^QUEST_(?:CONTENT|COND)_/.test(condition?.type))).map(([field, values]) => ({
                    source_field: field, phase: field === 'finishCond' ? 'finish' : field === 'failCond' ? 'fail' : 'unspecified',
                    conditions: values.map(condition => ({ type: condition.type, parameters: copy(condition.param || []),
                        ...(Object.hasOwn(condition, 'count') ? { count: condition.count } : {}) })),
                }));
                item.data.state_dependencies = item.data.condition_evidence.flatMap(group => group.conditions.flatMap(condition => {
                    if (!/^QUEST_(?:CONTENT_QUEST|COND)_STATE_(?:EQUAL|NOT_EQUAL)$/.test(condition.type)) return [];
                    const [target, state] = condition.parameters.map(value => Number(value));
                    if (!Number.isSafeInteger(target) || !Number.isSafeInteger(state)) return [];
                    return [{ quest_id: target, state, comparison: condition.type.endsWith('NOT_EQUAL') ? 'not-equal' : 'equal', source_field: group.source_field }];
                }));
                if (step[fields.questOrder] !== undefined) item.data.order = step[fields.questOrder];
                item.source.fields = [sourceField, fields.questId];
                relation(item, 'quest', '', quest.id, 'tasks'); relation(item, 'quest_step', '', questId, 'quest_step');
                const p = execution.param || [], ids = value => typeof value === 'string' && /^\d+(?:;\d+)*$/.test(value) ? value.split(';').map(Number) : [];
                const targetKind = { CHANGE_MAP_AREA_STATE: 'map_area', CHANGE_SCENE_LEVEL_TAG: 'level_tag', SET_MAP_LAYER_UNLOCK_STATE: 'layer', SHOW_MAP_LAYER_GROUP: 'layer_group', SET_LIMIT_REGION_STATE: 'limit_region', SET_OPEN_STATE: 'open_state', SET_OPEN_STATE_V2: 'open_state' }[action];
                if (targetKind) {
                    item.data.target_ids = ids(p[0]);
                    for (const id of item.data.target_ids) relation(item, 'target', targetKind, id);
                    if (p[1] !== undefined) item.data.state = p[1];
                } else if (['HIDE_SCENE_POINT', 'UNHIDE_SCENE_POINT', 'UNLOCK_POINT', 'LOCK_POINT', 'ADD_SCENE_TAG', 'DEL_SCENE_TAG'].includes(action)) {
                    if (/^\d+$/.test(p[0] || '')) {
                        item.data.scene_id = Number(p[0]); item.data.target_ids = ids(p[1]);
                        for (const id of item.data.target_ids) {
                            if (action === 'ADD_SCENE_TAG' || action === 'DEL_SCENE_TAG') relation(item, 'target', 'scene_tag', id);
                            else relation(item, 'target', 'point', `${p[0]}-${id}`);
                        }
                    }
                } else item.diagnostics.push('action_parameters_retained_without_target_guess');
                item.diagnostics.push('mutation_is_not_complete_visibility_predicate');
            }
        }
    }
    if (input.extended) require('./extended').extendMaps({ input, output, rows, create, text, relation, vector, geometry, key });
    linkPointControls(output);
    for (const item of Object.values(output)) require('./state-semantics').annotateMapState(item);
    for (const item of Object.values(output)) require('./layer-state').annotateLayerState(item);
    for (const item of Object.values(output)) for (const rel of item.relations) if (rel.category === 'maps' && !output[rel.id])
        item.diagnostics.push(`missing_relation:${rel.role}:${rel.id}`);
    return output;
}
module.exports = { buildMaps, TABLES, IMAGE_CORRECTIONS };
