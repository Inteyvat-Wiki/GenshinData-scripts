// Convert the resource parser's evidence into ordinary queryable upstream records.
// Rendering coordinates deliberately stay in prefab space until calibrated.
function areaVariantMemberships(cache) {
    const objects = new Map(cache.objects.map(object => [object.id, object]));
    const memberships = new Map();
    for (const object of cache.objects) {
        if (object.decoded?.type !== 'MonoBehaviour' || object.decoded.className !== 'MonoMapArea') continue;
        for (const reference of object.references) {
            const match = /^areaTransforms\[(\d+)\]$/.exec(reference.field);
            if (!match || reference.status !== 'resolved') continue;
            const entries = memberships.get(reference.target) || [];
            entries.push({ controller: object.id, index: Number(match[1]) }); memberships.set(reference.target, entries);
        }
    }
    const result = new Map();
    for (const image of cache.images) {
        const entries = [], seen = new Set(); let transform = objects.get(image.rectTransform);
        while (transform && !seen.has(transform.id)) {
            seen.add(transform.id); entries.push(...memberships.get(transform.id) || []);
            transform = objects.get(transform.references.find(reference => reference.field === 'parent' && reference.status === 'resolved')?.target);
        }
        result.set(image.id, entries);
    }
    return result;
}
function resourceRecords(cache, file, { source, language, catalogue = {} } = {}) {
    const records = {};
    const base = source?.mapBase?.();
    const projections = Object.fromEntries((base?.scenes || []).map(scene => [scene.sceneId, scene.projection]));
    const boundaryProjections = Object.fromEntries((base?.scenes || []).map(scene => [scene.sceneId,
        { ...scene.projection, scale: scene.projection.scale * scene.boundaryScale, profile: `${scene.projection.profile}-guide-area` }]));
    const diagnostic = id => cache.diagnostics.filter(d => d.object === id).map(d => `resource_${d.code}:${d.detail || ''}`);
    for (const object of cache.objects) {
        const id = `resource-object-${object.id.replace(/^map-resource-/, '')}`;
        records[id] = { schema: 1, id, kind: 'resource', name: object.name || '', description: '', texts: [], relations: [],
            data: { category: 'object', status: object.decoded ? 'parsed' : 'unparsed', source_entry: object.entry,
                decoded: object.decoded, references: object.references, serialized_file: object.serializedFile,
                ...(object.geometry ? { layout: object.geometry } : {}), ...(object.material ? { material: object.material } : {}) },
            source: { file, id: object.entry.PathID, hashes: [], fields: [] }, diagnostics: diagnostic(object.id) };
    }
    for (const image of cache.images) {
        const id = `resource-image-${image.id.replace(/^map-image-/, '')}`;
        records[id] = { schema: 1, id, kind: 'resource', name: image.assetName, description: '', texts: [],
            relations: ['imageObject', 'gameObject', 'rectTransform', 'asset'].filter(role => image[role]).map(role => ({
                role: { imageObject: 'image_object', gameObject: 'game_object', rectTransform: 'transform', asset: 'image_asset' }[role],
                category: 'maps', id: `resource-object-${image[role].replace(/^map-resource-/, '')}` })),
            data: { category: 'image', status: image.renderingStatus, source_entry: image.entry,
                visibility_status: image.visibilityStatus, layout: image.geometry, component_color: image.componentColor,
                material: image.material?.parameters || null },
            source: { file, id: image.entry.PathID, hashes: [], fields: [] }, diagnostics: diagnostic(image.imageObject) };
    }
    // Resource tools decode Unity objects; the game-table joins happen here.
    const { buildNativeAtlas, projectLayer, projectGeometry } = require('./atlas');
    const groups = source?.excel('MapLayerGroupExcelConfigData') || [];
    const fields = require('./schema').groupFields(groups);
    const worldAreas = source?.excel('WorldAreaConfigData') || [];
    const atlas = source ? buildNativeAtlas(cache, { groups, worldAreas,
        layers: source.excel('MapLayerExcelConfigData'), mapAreas: source.excel('MapAreaConfigData'),
        mapConfigs: source.bin('Map/MapArea/ConfigMapArea') }) : cache.atlas;
    const variants = areaVariantMemberships(cache);
    for (const image of atlas?.images || []) {
        const id = `resource-atlas-${image.id.replace(/^map-image-/, '')}`;
        const png = cache.atlas?.images.find(candidate => candidate.id === image.id)?.png || image.png;
        const projected = projectLayer(image, projections);
        const members = variants.get(image.id) || [];
        const indices = [...new Set(members.map(member => member.index))].sort((a, b) => a - b);
        const areaVariants = image.areaIds.flatMap(area_id => indices.map(index => ({ area_id, index })));
        const relations = [];
        for (const [field, kind] of [['sceneId', 'scene'], ['groupId', 'layer_group'], ['layerId', 'layer'], ['floorId', 'floor']]) {
            if (image[field] !== undefined) relations.push({ role: kind, category: 'maps', id: `${kind.replaceAll('_', '-')}-${image[field]}` });
        }
        for (const areaId of image.areaIds) relations.push({ role: 'map_area', category: 'maps', id: `map-area-${areaId}` });
        for (const item of Object.values(catalogue)) {
            if (item.kind === 'level_tag' && item.data.map_areas.some(area => image.areaIds.includes(area.area_id))) {
                const exact = item.data.map_areas.some(area => image.areaIds.includes(area.area_id) && area.index !== undefined && indices.includes(area.index));
                relations.push({ role: exact ? 'level_tag' : 'level_tag_context', category: 'maps', id: item.id });
            }
            if (item.kind === 'ability_map' && typeof item.data.prefab_name === 'string'
                && item.data.prefab_name.replaceAll('\\', '/').split('/').at(-1) === image.rootName)
                relations.push({ role: 'ability_control', category: 'maps', id: item.id });
        }
        for (const controller of new Set(members.map(member => member.controller)))
            relations.push({ role: 'variant_controller', category: 'maps', id: `resource-object-${controller.replace(/^map-resource-/, '')}` });
        records[id] = { schema: 1, id, kind: 'resource', name: image.assetName, description: '', texts: [], relations,
            data: { category: 'atlas-image', status: png ? 'image-extracted' : 'image-reference', source_entry: image.entry,
                asset_name: image.assetName, root_name: image.rootName, area_ids: image.areaIds, area_variants: areaVariants,
                ...Object.fromEntries([['sceneId', 'scene_id'], ['groupId', 'group_id'], ['layerId', 'layer_id'], ['floorId', 'floor_id']]
                    .filter(([from]) => image[from] !== undefined).map(([from, to]) => [to, image[from]])),
                layout: image.geometry, component_color: image.componentColor, material: image.material,
                visibility_status: image.visibilityStatus,
                ...(image.renderOrder ? { render_order: { scope: image.renderOrder.scope, hierarchy: image.renderOrder.hierarchy,
                    cross_prefab_order: image.renderOrder.crossPrefabOrder } } : {}),
                ...(projected ? { display_geometry: projected } : {}),
                ...(png ? { image_file: png.file, image_sha256: png.sha256, image_width: png.width, image_height: png.height } : {}) },
            source: { file, id: image.entry.PathID, hashes: [], fields: [] },
            diagnostics: [...(atlas.diagnostics || []).filter(issue => issue.id === image.id).map(issue => `atlas_${issue.code}`),
                ...(!projected ? ['atlas_display_projection_unresolved'] : []),
                ...(image.areaIds.length && !indices.length ? ['area_variant_controller_unresolved'] : []),
                ...(indices.includes(0) && Object.values(catalogue).some(item => item.kind === 'level_tag'
                    && item.data.map_areas.some(area => image.areaIds.includes(area.area_id) && area.index === undefined)) ? ['area_variant_default_index_unverified'] : [])] };
    }
    const textIds = new Map((source?.excel('ManualTextMapConfigData') || []).map(row => [row.textMapId, row.textMapContentTextMapHash]));
    for (const label of cache.labels || []) {
        const id = `map-place-${label.id.replace(/^map-label-/, '')}`;
        const group = groups.find(row => row.id === label.layerGroupId);
        const scenes = group ? [...new Set(worldAreas.filter(row => row.areaType === 'LEVEL_1' && group[fields.groupAreas]?.includes(row.areaID1)).map(row => row.sceneID))] : [];
        const sceneId = scenes.length === 1 ? scenes[0] : undefined;
        const hash = textIds.get(label.textKey), name = hash && source?.text(language, String(hash)) || '';
        const projected = sceneId !== undefined && projectGeometry ? projectGeometry(label.geometry, sceneId, projections) : null;
        const relations = [];
        if (group) relations.push({ role: 'group', category: 'maps', id: `layer-group-${group.id}` });
        if (sceneId !== undefined) relations.push({ role: 'scene', category: 'maps', id: `scene-${sceneId}` });
        // PlaceNameID is a serialized GameObject name, not a generated TextMap
        // key. Only exact names select rules; a similarly named text is no proof.
        const nameRules = label.gameObjectName ? Object.values(catalogue).filter(item => item.kind === 'label' && item.data.place_name_id === label.gameObjectName) : [];
        for (const rule of nameRules) relations.push({ role: 'name_rule', category: 'maps', id: rule.id });
        records[id] = { schema: 1, id, kind: 'map_place', name, description: '',
            texts: hash ? [{ role: 'name', text: name, hash: String(hash) }] : [], relations,
            data: { text_key: label.textKey, root_name: label.rootName, source_entry: label.entry, layout: label.geometry,
                ...(label.gameObjectName ? { place_name_id: label.gameObjectName } : {}),
                ...(group ? { group_id: group.id } : {}), ...(sceneId !== undefined ? { scene_id: sceneId } : {}),
                ...(projected ? { display_geometry: projected,
                    position: { x: projected.corners.reduce((sum, corner) => sum + corner.x, 0) / projected.corners.length,
                        z: projected.corners.reduce((sum, corner) => sum + corner.y, 0) / projected.corners.length },
                    coordinate_origin: 'projected-label-rectangle-center' } : {}) },
            source: { file, id: label.entry.PathID, hashes: hash ? [String(hash)] : [], fields: ['textKey'] },
            diagnostics: [...(!hash ? ['place_text_key_unresolved'] : !name ? [`missing_text:name:${hash}`] : []),
                ...(sceneId === undefined ? ['place_scene_unresolved'] : []), ...(!projected ? ['place_display_projection_unresolved'] : [])] };
    }
    const boundaryEvidence = require('./boundaries').buildNativeBoundaries(cache, { projections: boundaryProjections, limitRegions: Object.values(catalogue)
        .filter(item => item.kind === 'limit_region').map(item => ({ id: item.data.region_id, name: item.name, sceneId: item.data.scene_id })) });
    for (const issue of boundaryEvidence.diagnostics) {
        const target = issue.object.startsWith('map-image-') ? `resource-image-${issue.object.slice('map-image-'.length)}`
            : `resource-object-${issue.object.replace(/^map-resource-/, '')}`;
        if (records[target]) records[target].diagnostics.push(`native_boundary_${issue.code}`);
    }
    for (const boundary of boundaryEvidence.boundaries) {
        const id = `resource-boundary-${boundary.id.replace(/^native-boundary-/, '')}`;
        const png = image => image ? { image_file: image.file, image_sha256: image.sha256 } : {};
        records[id] = { schema: 1, id, kind: 'resource', name: boundary.rootName, description: '', texts: [],
            relations: [{ role: 'scene', category: 'maps', id: `scene-${boundary.sceneId}` },
                { role: 'limit_region', category: 'maps', id: `limit-region-${boundary.limitRegionId}` }],
            data: { category: 'native-boundary', scene_id: boundary.sceneId, limit_region_id: boundary.limitRegionId,
                root_name: boundary.rootName, source_entry: boundary.source, status: boundary.renderingStatus, visibility_status: boundary.visibilityStatus,
                mask: { ...png(boundary.mask.png), image_width: boundary.mask.png?.width, image_height: boundary.mask.png?.height,
                    layout: boundary.mask.geometry, display_geometry: boundary.mask.displayGeometry, component_color: boundary.mask.componentColor,
                    shader_profile: boundary.mask.shaderProfile, shader_sha256: boundary.mask.shaderSha256,
                    noise_image_file: boundary.mask.noise.png?.file, noise_image_sha256: boundary.mask.noise.png?.sha256,
                    noise_scale: boundary.mask.noise.scale, noise_offset: boundary.mask.noise.offset,
                    blend: boundary.mask.blend, render_order: boundary.mask.renderOrder },
                rim: { coordinate_space: boundary.rim.vertices ? 'world-xz' : 'unresolved', native_coordinate_space: boundary.rim.coordinateSpace,
                    native_vertices: boundary.rim.nativeVertices, vertices: boundary.rim.vertices, projection: boundary.rim.projection,
                    triangles: boundary.rim.triangles, uv: boundary.rim.uv, uv_origin: boundary.rim.uvOrigin, ...png(boundary.rim.png),
                    ...(boundary.rim.textureFilter ? { texture_filter: boundary.rim.textureFilter } : {}),
                    ...(boundary.rim.textureWrap ? { texture_wrap: boundary.rim.textureWrap } : {}),
                    ...(boundary.rim.spriteGeometry ? { sprite_geometry: { rect: boundary.rim.spriteGeometry.rect,
                        texture_rect: boundary.rim.spriteGeometry.textureRect, texture_rect_offset: boundary.rim.spriteGeometry.textureRectOffset,
                        uv_transform: boundary.rim.spriteGeometry.uvTransform } } : {}),
                    color: boundary.rim.color, opacity: boundary.rim.opacity, blend: boundary.rim.blend,
                    shader_sha256: boundary.rim.shaderSha256, render_order: boundary.rim.renderOrder } },
            source: { file, id: boundary.source.PathID, hashes: [], fields: [] },
            diagnostics: boundary.diagnostics.map(code => `native_boundary_${code}`) };
        const region = catalogue[`limit-region-${boundary.limitRegionId}`];
        if (region) {
            if (region.data.geometry_status !== 'client-simple-polygon') region.data.geometry_status = 'native-mask-and-rim';
            region.relations.push({ role: 'native_boundary', category: 'maps', id });
            region.diagnostics = region.diagnostics.filter(code => code !== 'playable_boundary_geometry_not_resolved');
            region.diagnostics.push('boundary_runtime_activation_unverified');
        }
    }
    return records;
}
module.exports = { resourceRecords, areaVariantMemberships };
