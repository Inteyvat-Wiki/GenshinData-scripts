const crypto = require('node:crypto');
const schema = require('./schema');
const copy = value => JSON.parse(JSON.stringify(value));
const stable = value => crypto.createHash('sha256').update(value).digest('hex').slice(0, 20);

function walk(value, visit, path = '') {
    if (!value || typeof value !== 'object') return;
    visit(value, path);
    for (const [key, child] of Object.entries(value)) walk(child, visit, `${path}/${key}`);
}

function npcConditions(groups, { npcIds } = {}) {
    if (!Array.isArray(groups) || groups.some(group => !Array.isArray(group))) throw new Error('Unsupported NPC condition grouping');
    return groups.map(group => group.map(condition => {
        const type = condition.$type;
        if (type === 'ICEFINJKEDH' && !npcIds) throw new Error('Missing inferred NPC condition ID field');
        const fields = { CNFIFPJNOKE: ['$type', 'condType', 'paramList'], ICEFINJKEDH: ['$type', npcIds], KEANKLJIJJI: ['$type', 'specialScenes'] }[type];
        if (!fields || Object.keys(condition).some(field => !fields.includes(field))) throw new Error(`Unsupported NPC condition fields: ${type}`);
        if (type === 'CNFIFPJNOKE') return { kind: 'quest', type: condition.condType, parameters: copy(condition.paramList || []), source_type: type };
        if (type === 'KEANKLJIJJI') return { kind: 'scene-list', type: 'special-scenes', parameters: copy(condition.specialScenes || []), source_type: type };
        return { kind: 'id-list', type: 'unresolved', parameters: copy(condition[npcIds] || []), source_type: type };
    }));
}

// A selector edge is source evidence, not an executable guess about end-point
// inclusion or whether its parent ability/modifier currently exists at runtime.
function abilityMaps(file, entries) {
    const output = [];
    for (const [abilityIndex, wrapper] of entries.entries()) for (const [variant, ability] of Object.entries(wrapper)) {
        if (!ability || typeof ability !== 'object') continue;
        const selectors = [], displays = [], actions = [];
        walk(ability, (node, location) => {
            const match = /^\/modifiers\/([^/]+)/.exec(location), owner = match ? match[1] : null;
            if (node.$type === 'AttachModifierToGlobalValueMixin') {
                if (!Array.isArray(node.modifierNameSteps) || !Array.isArray(node.valueSteps) || node.valueSteps.length !== node.modifierNameSteps.length + 1)
                    return; // This unsupported selector never becomes a guessed predicate.
                node.modifierNameSteps.forEach((target, index) => selectors.push({ owner, target, key: node.globalValueKey,
                    lower: node.valueSteps[index], upper: node.valueSteps[index + 1], scope: node.globalValueTarget || null, source_path: location }));
            }
            if (node.$type === 'ShowMapBackMixin') displays.push({ owner, node, location });
            if (node.$type === 'SetActivityMapMark') actions.push({ owner, node, location });
        });
        function paths(target, seen = new Set()) {
            if (target === null) return [[]];
            if (seen.has(target)) return [];
            const next = new Set([...seen, target]), incoming = selectors.filter(edge => edge.target === target);
            if (!incoming.length) return [[{ kind: 'modifier-active', modifier: target }]];
            return incoming.flatMap(edge => paths(edge.owner, next).map(parent => [...parent, { kind: 'global-value-range',
                key: edge.key, lower: edge.lower, upper: edge.upper, scope: edge.scope, endpoint_inclusion: 'unverified', source_path: edge.source_path }]));
        }
        for (const display of displays) output.push({ key: stable(`${file}/${abilityIndex}/${variant}${display.location}`),
            ability_name: ability.abilityName || '', variant, source_path: `${abilityIndex}/${variant}${display.location}`,
            ...(display.owner ? { modifier: display.owner } : {}), prefab_name: display.node.prefabName,
            activation: { kind: display.owner ? 'modifier' : 'ability', paths: paths(display.owner), complete: false },
            operation: 'show-background' });
        for (const action of actions) output.push({ key: stable(`${file}/${abilityIndex}/${variant}${action.location}`),
            ability_name: ability.abilityName || '', variant, source_path: `${abilityIndex}/${variant}${action.location}`,
            ...(action.owner ? { modifier: action.owner } : {}), parameters: copy(action.node),
            activation: { kind: action.owner ? 'modifier' : 'ability', paths: paths(action.owner), complete: false },
            operation: 'activity-marker' });
    }
    return output;
}

function extendMaps({ input, output, rows, create, text, relation, vector, geometry, key }) {
    const { shapeFootprint, polygonFootprint, validateGroupBounds } = require('./regions');
    // Exact filename references in LimitRegion select polygons. Old unreferenced
    // GlobalOpenArea files remain inspectable, never substituted for current 7.x.
    const polygonFiles = new Map(input.files('LevelDesign/SimplePolygons').map(file => [file.split('/').pop(), file]));
    const referenced = new Set();
    for (const item of Object.values(output).filter(item => item.kind === 'limit_region')) {
        const file = polygonFiles.get(item.name);
        if (!file) continue;
        const row = input.bin(file);
        if (!Array.isArray(row.roadPoints) || row.roadPoints.length < 3) continue;
        item.data.polygons = [{ ...geometry(row), file: `BinOutput/${file}.json`,
            ...(row.polygonAreaType ? { area_type: row.polygonAreaType } : {}) }];
        item.data.geometry_status = 'exact-resource-name';
        item.diagnostics = item.diagnostics.filter(code => code !== 'playable_boundary_geometry_not_resolved');
        item.diagnostics.push('boundary_rendering_and_activation_unverified');
        referenced.add(file);
    }
    for (const file of polygonFiles.values()) {
        if (referenced.has(file) || !/(?:GlobalOpenArea|OpenArea_)/.test(file)) continue;
        const row = input.bin(file);
        if (!Array.isArray(row.roadPoints) || row.roadPoints.length < 3) continue;
        const item = create('boundary_geometry', stable(file), `BinOutput/${file}.json`);
        item.name = file.split('/').pop();
        item.data = { polygons: [{ ...geometry(row), ...(row.polygonAreaType ? { area_type: row.polygonAreaType } : {}) }], active_reference: false };
        item.diagnostics.push('unreferenced_boundary_not_current');
    }
    // Original layer activation volumes; not a map texture rectangle or an
    // impassable boundary. Preserve shape fields and rotations without flattening.
    const regionFiles = input.files('MultilayerMapRegion');
    const fields = regionFiles.length ? schema.regionFields(input) : {};
    for (const file of regionFiles) {
        const row = input.bin(file);
        if (!Number.isSafeInteger(row[fields.regionGroup]) || !Array.isArray(row[fields.regions])) throw new Error(`Unsupported layer region ${file}`);
        const bounds = validateGroupBounds(row, row[fields.regions]);
        for (const [index, region] of row[fields.regions].entries()) {
            if (!Number.isSafeInteger(region[fields.regionLayer])) throw new Error(`Unsupported layer region ID ${file}:${index}`);
            const item = create('layer_region', `${row[fields.regionGroup]}-${region[fields.regionLayer]}-${index}`, `BinOutput/${file}.json`);
            item.data = { group_id: row[fields.regionGroup], layer_id: region[fields.regionLayer], shapes: (region.limitShapes || []).map(entry => ({
                ...(entry.pos ? { position: vector(entry.pos) } : {}), ...(entry.rot ? { rotation: vector(entry.rot) } : {}),
                shape: copy(entry.shape),
            })) };
            item.data.polygons = (region.regionPolygons || []).map(geometry);
            item.data.footprints = [
                ...(region.regionPolygons || []).map(polygonFootprint), ...(region.limitShapes || []).map(shapeFootprint),
            ].filter(Boolean);
            item.data.bounds_validation = bounds;
            for (const [shapeIndex, shape] of (region.limitShapes || []).entries()) if (!shapeFootprint(shape))
                item.diagnostics.push(`layer_region_shape_projection_unresolved:${shapeIndex}:${shape.shape?.$type || 'unknown'}`);
            for (const [polygonIndex, polygon] of (region.regionPolygons || []).entries()) if (!polygonFootprint(polygon))
                item.diagnostics.push(`layer_region_polygon_projection_unresolved:${polygonIndex}`);
            if (bounds.status === 'mismatch') item.diagnostics.push('layer_region_bounds_mismatch');
            const sceneId = output[key('layer_group', row[fields.regionGroup])]?.data.scene_id;
            if (sceneId !== undefined) item.data.scene_id = sceneId;
            relation(item, 'group', 'layer_group', row[fields.regionGroup]); relation(item, 'layer', 'layer', region[fields.regionLayer]);
            item.diagnostics.push('layer_volume_not_playable_boundary');
        }
    }
    for (const row of rows('ViewCodexExcelConfigData')) {
        const item = create('viewpoint', row.id, 'ExcelBinOutput/ViewCodexExcelConfigData.json', row.id);
        item.name = text(item, row.nameTextMapHash, 'name'); item.description = text(item, row.descTextMapHash, 'description');
        item.data = { viewpoint_id: row.id, scene_id: row.sceneId, world_area_id: row.worldAreaId, group_id: row.groupId,
            config_id: row.configId, gadget_id: row.gadgetId, image_name: row.image,
            ...(Object.hasOwn(row, 'showOnlyUnlocked') ? { show_only_unlocked: row.showOnlyUnlocked } : {}),
            ...(Object.hasOwn(row, 'isDisuse') ? { disused: row.isDisuse } : {}) };
        relation(item, 'scene', 'scene', row.sceneId); relation(item, 'world_area', 'world_area', row.worldAreaId);
        relation(item, 'geography', '', row.id, 'geographies');
        item.diagnostics.push('viewpoint_instance_position_unresolved');
    }
    const npcs = new Map(rows('NpcExcelConfigData').map(row => [row.id, row]));
    let npcFields;
    for (const directory of ['Scene/SceneNpcBorn', 'Scene/SceneNpcBornNoGroup']) for (const file of input.files(directory)) {
        const data = input.bin(file);
        for (const [ordinal, row] of (data.bornPosList || []).entries()) {
            if (row.preConditions?.flat().some(condition => condition.$type === 'ICEFINJKEDH'))
                npcFields ||= schema.npcConditionFields(input);
            const npc = npcs.get(row._configId), item = create('npc_instance', `${data.sceneId}-${row._configId}-${stable(`${file}/${row._id}/${ordinal}`)}`, `BinOutput/${file}.json`, row._configId);
            item.name = npc ? text(item, npc.nameTextMapHash, 'name') : '';
            item.data = { npc_id: row._configId, instance_id: row._id, scene_id: data.sceneId,
                ...(row._pos ? { position: vector(row._pos) } : {}), ...(row._rot ? { rotation: vector(row._rot) } : {}),
                ...(row._groupId !== undefined ? { group_id: row._groupId } : {}), ...(row.roomId !== undefined ? { room_id: row.roomId } : {}),
                ...(row.suiteIdList ? { suite_ids: copy(row.suiteIdList) } : {}),
                ...(row.preConditions ? { conditions: npcConditions(row.preConditions, npcFields), condition_logic: 'unverified' } : {}),
                ...(Object.hasOwn(npc || {}, 'disableShowName') ? { hide_name: npc.disableShowName } : {}),
                ...(Object.hasOwn(npc || {}, 'invisiable') ? { invisible: npc.invisiable } : {}) };
            relation(item, 'scene', 'scene', data.sceneId); relation(item, 'npc', '', row._configId, 'npcs');
            item.diagnostics.push('instance_presence_requires_runtime_state');
        }
    }
    // All ability files are searched, not a frozen list of six known filenames.
    const abilities = input.matchingFiles ? input.matchingFiles('Ability', ['ShowMapBackMixin', 'SetActivityMapMark']) : input.walkFiles('Ability');
    for (const file of abilities) {
        const value = input.bin(file);
        if (!Array.isArray(value)) continue;
        for (const data of abilityMaps(file, value)) {
            const item = create('ability_map', data.key, `BinOutput/${file}.json`, data.source_path);
            item.name = data.ability_name; item.data = { ...data }; delete item.data.key;
            item.diagnostics.push('ability_activation_not_complete_visibility');
        }
    }
    const interactions = input.matchingFiles ? input.matchingFiles('InterAction', ['CHANGE_SCENE_TAG']) : [];
    for (const file of interactions) walk(input.bin(file), (action, location) => {
        if (action.$type !== 'ConfigChangeSceneTagInterAction' || action.type !== 'CHANGE_SCENE_TAG') return;
        const item = create('map_trigger', stable(`${file}/${location}`), `BinOutput/${file}.json`, action.actionId ?? location);
        item.data = { source_kind: 'interaction', operation: 'scene-tag', scene_tag_id: action.sceneTagId, source_path: location,
            ...(action.questId !== undefined ? { quest_id: action.questId } : {}),
            ...(Object.hasOwn(action, 'isAdd') ? { is_add: action.isAdd } : {}) };
        relation(item, 'target', 'scene_tag', action.sceneTagId); relation(item, 'quest_step', '', action.questId, 'quest_step');
        item.diagnostics.push('trigger_activation_not_complete_visibility');
    });
    for (const table of ['TalkExcelConfigData_0', 'TalkExcelConfigData_1']) for (const row of rows(table)) {
        for (const [index, action] of (row.finishExec || []).entries()) {
            if (action.type !== 'TALK_EXEC_CHANGE_OPENSTATE') continue;
            const item = create('map_trigger', `dialogue-${row.id}-${index}`, `ExcelBinOutput/${table}.json`, row.id);
            item.data = { source_kind: 'dialogue', operation: 'open-state', dialogue_id: row.id, parameters: copy(action.param || []) };
            if (/^\d+$/.test(action.param?.[0] || '')) { item.data.state_id = Number(action.param[0]); relation(item, 'target', 'open_state', item.data.state_id); }
            item.diagnostics.push('trigger_activation_not_complete_visibility');
        }
    }
    for (const row of rows('CustomGadgetSlotLevelTagConfigData')) {
        const item = create('map_trigger', `gadget-slot-${row.id}`, 'ExcelBinOutput/CustomGadgetSlotLevelTagConfigData.json', row.id);
        item.data = { source_kind: 'gadget', operation: 'gadget-slot', gadget_id: row.gadgetId, level_tag_id: row.levelTagID,
            slots: (row.slotMap || []).filter(slot => Object.keys(slot).length).map(slot => ({ identifier: slot.slotIdentifier, ids: copy(slot.slotList || []) })) };
        relation(item, 'target', 'level_tag', row.levelTagID); item.diagnostics.push('trigger_activation_not_complete_visibility');
    }
}
module.exports = { extendMaps, abilityMaps, npcConditions };
