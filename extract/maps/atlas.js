const assert = require('node:assert/strict');
const { groupFields, layerFields } = require('./schema');

/** Associate only real controller references, never similarly named texture files. */
function buildNativeAtlas(cache, { groups, layers, worldAreas, mapAreas, mapConfigs }) {
    const fields = { ...groupFields(groups), ...layerFields(layers) };
    const objects = new Map(cache.objects.map(object => [object.id, object]));
    const target = (object, field) => {
        const reference = object?.references.find(ref => ref.field === field && ref.status === 'resolved');
        return reference && objects.get(reference.target);
    };
    const rootOf = transform => {
        let current = transform; const seen = new Set();
        while (current?.decoded?.parent?.PathID !== '0') {
            if (!current || seen.has(current.id)) return;
            seen.add(current.id); current = target(current, 'parent');
        }
        return target(current, 'gameObject');
    };
    const hierarchyOrder = transform => {
        const result = [], seen = new Set(); let current = transform;
        while (current?.decoded?.parent?.PathID !== '0') {
            if (!current || seen.has(current.id)) return null;
            seen.add(current.id); const parent = target(current, 'parent');
            if (!parent) return null;
            const child = parent.references.find(ref => ref.target === current.id && /^children\[\d+\]$/.test(ref.field));
            if (!child) return null;
            result.unshift(Number(child.field.match(/\d+/)[0])); current = parent;
        }
        return result;
    };
    const memberships = new Map();
    for (const object of cache.objects) {
        if (object.decoded?.className !== 'MonoMultilayerMapLayer' || object.decoded?.decodeStatus !== 'decoded') continue;
        for (const [index] of object.decoded.layerObjects.entries()) {
            const member = target(object, `layerObjects[${index}]`);
            if (!member || !/^\d+$/.test(member.name)) continue;
            const id = Number(member.name);
            if (!layers.some(layer => layer.id === id)) continue;
            const values = memberships.get(member.id) || [];
            values.push(id); memberships.set(member.id, values);
        }
    }
    const images = [], diagnostics = [];
    for (const image of cache.images) {
        const transform = objects.get(image.rectTransform), root = rootOf(transform);
        if (!root) { diagnostics.push({ id: image.id, code: 'root-unresolved' }); continue; }
        const groupMatch = /^LayeredMap_(\d+)$/.exec(root.name);
        const group = groupMatch && groups.find(group => group.id === Number(groupMatch[1]));
        let memberIds = memberships.get(image.gameObject) || [];
        if (!memberIds.length) {
            // Composite layer roots can hold their same-ID base image below an
            // effect container. Confirm both the ancestor controller pointer and
            // this child's explicit numeric name; animated effect images remain
            // in the raw cache and are not treated as the static map image.
            const imageObject = objects.get(image.gameObject), seen = new Set();
            let parent = target(transform, 'parent');
            while (parent && !seen.has(parent.id)) {
                seen.add(parent.id);
                const owner = target(parent, 'gameObject');
                const ids = memberships.get(owner?.id) || [];
                if (ids.length) { memberIds = ids.filter(id => String(id) === imageObject?.name); break; }
                parent = target(parent, 'parent');
            }
        }
        const membership = [...new Set(memberIds)];
        const layer = membership.length === 1 ? layers.find(layer => layer.id === membership[0]) : undefined;
        const configs = Object.entries(mapConfigs).filter(([, config]) => config.prefabPath?.replaceAll('\\', '/').split('/').at(-1) === root.name);
        // Configured fog/parcel roots do not all follow the Map_*_Grp naming
        // convention. Only exact client prefab references establish membership.
        if (!layer && !configs.length && !/^Map_.*_Grp/.test(root.name)) continue;
        const areaIds = configs.map(([key]) => Number(key)).filter(id => mapAreas.some(area => area.id === id));
        const scenes = group ? worldAreas.filter(area => area.areaType === 'LEVEL_1' && group[fields.groupAreas]?.includes(area.areaID1)).map(area => area.sceneID)
            : areaIds.map(id => mapAreas.find(area => area.id === id).sceneID);
        const sceneIds = [...new Set(scenes)];
        const result = { id: image.id, rootName: root.name, assetName: image.assetName, entry: image.entry,
            ...(group ? { groupId: group.id } : {}), ...(layer ? { layerId: layer.id, floorId: layer[fields.floor] } : {}),
            ...(sceneIds.length === 1 ? { sceneId: sceneIds[0] } : {}), areaIds,
            geometry: image.geometry, componentColor: image.componentColor, material: image.material?.parameters || null,
            renderOrder: { scope: root.id, hierarchy: hierarchyOrder(transform), crossPrefabOrder: 'unresolved' },
            ...(image.png ? { png: image.png } : {}), visibilityStatus: image.visibilityStatus };
        if (!image.geometry) diagnostics.push({ id: image.id, code: 'geometry-unresolved' });
        if (sceneIds.length !== 1) diagnostics.push({ id: image.id, code: 'scene-unresolved' });
        images.push(result);
    }
    return { schema: 1, images, diagnostics };
}

// A verified native base-map cache supplies the scene frame and grid ratio.
// Missing resource evidence never falls back to an old hand-aligned image.
function projectGeometry(geometry, sceneId, profiles = {}) {
    const profile = profiles[sceneId];
    if (!profile || !geometry?.corners) return null;
    assert.equal(geometry.coordinateSpace, 'prefab-ui');
    const { scale, offsetX, offsetZ } = profile;
    assert([scale, offsetX, offsetZ].every(Number.isFinite) && scale > 0);
    const depths = geometry.corners.map(corner => corner[2]);
    assert(Math.max(...depths) - Math.min(...depths) < 0.001, 'Nonplanar map image');
    return { space: 'world-xz', corners: geometry.corners.map(([u, v]) => {
        return { x: scale * v + offsetX, y: -scale * u + offsetZ };
    }), profile: profile.profile };
}
function projectImage(image, profiles) { return projectGeometry(image.geometry, image.sceneId, profiles); }
module.exports = { buildNativeAtlas, projectGeometry, projectImage, projectLayer: projectImage };
