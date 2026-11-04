const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { projectGeometry } = require('./atlas');

const PROFILE = 'gi-surface-map-labels-7.1-v1';
// MonoLevelMapNames is distinct from MonoLocalizedText. Decode its complete
// player layout only after verifying the MonoScript identity in the resource cache.
function decodeLevelMapNames(bytes) {
    let offset = 0;
    const take = n => { assert(Number.isSafeInteger(n) && n >= 0 && offset + n <= bytes.length, 'Truncated map names'); const at = offset; offset += n; return at; };
    const int = () => bytes.readInt32LE(take(4));
    const uint = () => bytes.readUInt32LE(take(4));
    const pointer = () => ({ fileID: int(), PathID: bytes.readBigInt64LE(take(8)).toString() });
    const float = () => { const n = bytes.readFloatLE(take(4)); assert(Number.isFinite(n), 'Invalid map name coordinate'); return n; };
    const string = () => { const n = int(); assert(n >= 0 && n <= 4096); const at = take(n);
        const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(at, at + n)); take((4 - offset % 4) % 4); return value; };
    const gameObject = pointer(); assert.equal(int(), 1); const script = pointer(); assert.equal(string(), '');
    const layoutWord = uint(); assert.equal(layoutWord, 1, 'Unknown map names layout');
    const groups = Array.from({ length: 2 }, () => {
        const groupWord = uint(), prefab = pointer(), count = int(); assert(count >= 0 && count <= 10000);
        const rows = Array.from({ length: count }, () => {
            const at = offset, packedWord = uint(), position = [float(), float()], nameId = string(), textKey = string(), trailingWord = uint();
            assert(nameId && textKey); return { offset: at, packedWord, position, nameId, textKey, trailingWord };
        });
        assert.equal(new Set(rows.map(row => row.nameId)).size, rows.length, 'Ambiguous map name identity within group');
        return { groupWord, prefab, rows };
    });
    assert.equal(offset, bytes.length, 'Unknown map names trailing fields');
    return { gameObject, script, layoutWord, groups };
}
function anchorPosition([u, v], projection) {
    assert([u, v, projection.scale, projection.offsetX, projection.offsetZ].every(Number.isFinite) && projection.scale > 0);
    return { x: v * projection.scale + projection.offsetX, z: -u * projection.scale + projection.offsetZ };
}
function labelId(objectId, group, nameId) {
    // Group is part of identity: place and area collections reuse name IDs.
    return 'map-label-' + createHash('sha256').update(JSON.stringify([objectId, group, nameId])).digest('hex').slice(0, 24);
}
function buildSurfaceLabels(base, prefab, readBytes = fs.readFileSync) {
    const objects = new Map(prefab.objects.map(object => [object.id, object]));
    const target = (object, field) => objects.get(object?.references.find(ref => ref.field === field && ref.status === 'resolved')?.target);
    const roots = new Map();
    for (const scene of base.scenes) {
        const controllers = prefab.objects.filter(object => object.source?.file === scene.controllerSource.file);
        assert.equal(controllers.length, 1, 'Base label controller evidence missing');
        const root = target(controllers[0], 'gameObject'); assert(root);
        assert.equal(root.name, scene.config.prefabPath.split('/').at(-1));
        assert(!roots.has(root.id)); roots.set(root.id, scene);
    }
    const labels = [];
    for (const label of prefab.labels || []) {
        // The last verified ancestor is the root GameObject, not a name guess.
        const scene = roots.get(label.ancestors?.at(-1)?.id); if (!scene) continue;
        assert(label.geometry, 'Missing static label geometry');
        const displayGeometry = projectGeometry(label.geometry, scene.sceneId, { [scene.sceneId]: scene.projection });
        labels.push({ ...label, sceneId: scene.sceneId, displayGeometry,
            position: { x: displayGeometry.corners.reduce((sum, p) => sum + p.x, 0) / displayGeometry.corners.length,
                z: displayGeometry.corners.reduce((sum, p) => sum + p.y, 0) / displayGeometry.corners.length },
            coordinateOrigin: 'projected-label-rectangle-center' });
    }
    for (const object of prefab.objects) {
        if (object.decoded?.type !== 'MonoBehaviour' || object.decoded.className !== 'MonoLevelMapNames') continue;
        const root = target(object, 'gameObject'), scene = roots.get(root?.id); if (!scene) continue;
        assert.equal(object.decoded.namespace, 'MoleMole'); assert.equal(object.decoded.assembly, 'Assembly-CSharp.dll');
        assert.equal(object.serializedFile.formatVersion, 17); assert.equal(object.serializedFile.unityVersion, '2017.4.30f1\n2');
        const transforms = root.references.map(ref => objects.get(ref.target)).filter(o => o?.decoded?.type === 'RectTransform');
        assert.equal(transforms.length, 1); const transform = transforms[0];
        assert.equal(transform.decoded.parent.PathID, '0');
        // Both native name containers use the root's centred UI coordinates.
        // Refuse a changed hierarchy instead of applying a silent manual offset.
        for (const tr of [transform, ...['PlaceNames', 'AreaNames'].map(name => {
            const found = transform.references.filter(ref => /^children\[/.test(ref.field)).map(ref => objects.get(ref.target))
                .filter(child => target(child, 'gameObject')?.name === name);
            assert.equal(found.length, 1, `Missing native name container: ${name}`); return found[0];
        })]) {
            assert.deepEqual(tr.decoded.position, [0, 0, 0]); assert.deepEqual(tr.decoded.rotation, [0, 0, 0, 1]);
            assert.deepEqual(tr.decoded.scale, [1, 1, 1]); assert.deepEqual(tr.decoded.pivot, [0.5, 0.5]);
        }
        const decoded = decodeLevelMapNames(readBytes(object.source.file));
        assert.deepEqual(decoded.script, object.decoded.script); assert.deepEqual(decoded.gameObject, object.decoded.gameObject);
        for (const [groupIndex, group] of decoded.groups.entries()) for (const row of group.rows) {
            labels.push({ id: labelId(object.id, groupIndex, row.nameId), textKey: row.textKey, gameObjectName: row.nameId,
                rootName: root.name, entry: object.entry, sceneId: scene.sceneId,
                position: anchorPosition(row.position, scene.projection), coordinateOrigin: 'projected-label-anchor',
                // Preserve unconfirmed words as evidence; they are not visibility conditions.
                nativeLabel: { profile: PROFILE, component: object.id, group: groupIndex, offset: row.offset,
                    layout_word: decoded.layoutWord, group_word: group.groupWord, prefab: group.prefab,
                    packed_word: row.packedWord, trailing_word: row.trailingWord, position: row.position } });
        }
    }
    assert.equal(new Set(labels.map(label => label.id)).size, labels.length, 'Duplicate surface map labels');
    return labels;
}
function surfaceLabelRecords(labels, file, { source, language, catalogue = {} }) {
    const textIds = new Map(source.excel('ManualTextMapConfigData').map(row => [row.textMapId, row.textMapContentTextMapHash]));
    return Object.fromEntries(labels.map(label => {
        const id = `map-place-${label.id.replace(/^map-label-/, '')}`, hash = textIds.get(label.textKey);
        const name = hash ? source.text(language, String(hash)) || '' : '';
        const relations = [{ role: 'scene', category: 'maps', id: `scene-${label.sceneId}` }];
        // Static objects retain the existing exact GameObject-name association.
        // List entries do not establish which name-rule target type is used.
        if (!label.nativeLabel) for (const rule of Object.values(catalogue).filter(record => record.kind === 'label'
            && record.data.place_name_id === label.gameObjectName)) relations.push({ role: 'name_rule', category: 'maps', id: rule.id });
        return [id, { schema: 1, id, kind: 'map_place', name, description: '',
            texts: hash ? [{ role: 'name', text: name, hash: String(hash) }] : [], relations,
            data: { text_key: label.textKey, root_name: label.rootName, source_entry: label.entry, scene_id: label.sceneId,
                ...(label.gameObjectName ? { place_name_id: label.gameObjectName } : {}),
                ...(label.geometry ? { layout: label.geometry, display_geometry: label.displayGeometry } : {}),
                ...(label.nativeLabel ? { native_label: label.nativeLabel } : {}),
                position: label.position, coordinate_origin: label.coordinateOrigin },
            source: { file, id: label.entry.PathID, hashes: hash ? [String(hash)] : [], fields: ['textKey'] },
            diagnostics: !hash ? ['place_text_key_unresolved'] : !name ? [`missing_text:name:${hash}`] : [] }];
    }));
}
module.exports = { PROFILE, decodeLevelMapNames, anchorPosition, labelId, buildSurfaceLabels, surfaceLabelRecords };
