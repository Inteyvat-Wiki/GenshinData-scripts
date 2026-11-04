const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeLevelMapNames, anchorPosition, labelId, buildSurfaceLabels, surfaceLabelRecords } = require('./surface-labels');
function fixture() {
    const buffer = Buffer.alloc(1024); let offset = 0;
    const int = n => { buffer.writeInt32LE(n, offset); offset += 4; };
    const float = n => { buffer.writeFloatLE(n, offset); offset += 4; };
    const pointer = (file, id) => { int(file); buffer.writeBigInt64LE(BigInt(id), offset); offset += 8; };
    const string = s => { const bytes = Buffer.from(s); int(bytes.length); bytes.copy(buffer, offset); offset += bytes.length; offset = Math.ceil(offset / 4) * 4; };
    pointer(0, 12); int(1); pointer(0, 34); string(''); int(1);
    for (const key of ['UI_MAP_AREA1_TITLE_1', 'UI_MAP_City1_TITLE_1']) {
        int(0); pointer(3, -99); int(1); int(-2147385347); float(192); float(220); string('1_1'); string(key); int(0);
    }
    return buffer.subarray(0, offset);
}
test('map name lists decode both groups exactly, preserving unknown words and repeated cross-group IDs', () => {
    const bytes = fixture(), decoded = decodeLevelMapNames(bytes);
    assert.equal(decoded.groups.length, 2);
    assert.deepEqual(decoded.groups[0].rows[0], { offset: 56, packedWord: 2147581949, position: [192, 220],
        nameId: '1_1', textKey: 'UI_MAP_AREA1_TITLE_1', trailingWord: 0 });
    assert.notEqual(labelId('component', 0, '1_1'), labelId('component', 1, '1_1'));
    assert.equal(labelId('component', 0, '1_1'), labelId('component', 0, '1_1'));
    assert.throws(() => decodeLevelMapNames(bytes.subarray(0, bytes.length - 1)), /Truncated/);
    assert.throws(() => decodeLevelMapNames(Buffer.concat([bytes, Buffer.alloc(4)])), /trailing/);
    const changed = Buffer.from(bytes); changed.writeFloatLE(NaN, 60);
    assert.throws(() => decodeLevelMapNames(changed), /coordinate/);
});
test('surface anchors share the native base projection including independent-scene origins', () => {
    assert.deepEqual(anchorPosition([192, 220], { scale: 4, offsetX: 2048, offsetZ: -1024 }), { x: 2928, z: -1792 });
    assert.deepEqual(anchorPosition([59.5, -202.5], { scale: 4, offsetX: 512, offsetZ: 512 }), { x: -298, z: 274 });
    assert.throws(() => anchorPosition([0, NaN], { scale: 4, offsetX: 0, offsetZ: 0 }));
});
test('surface labels follow the verified controller root, and changed container transforms fail closed', () => {
    const ref = (field, target) => ({ field, target, status: 'resolved' });
    const transform = { type: 'RectTransform', position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], pivot: [0.5, 0.5], parent: { PathID: '0' } };
    const root = { id: 'root', name: 'NativeRoot', references: [ref('components[0]', 'transform')] };
    const objects = [root, { id: 'transform', decoded: transform, references: [ref('children[0]', 'places'), ref('children[1]', 'areas')] },
        { id: 'places', decoded: structuredClone(transform), references: [ref('gameObject', 'placeGO')] },
        { id: 'areas', decoded: structuredClone(transform), references: [ref('gameObject', 'areaGO')] },
        { id: 'placeGO', name: 'PlaceNames' }, { id: 'areaGO', name: 'AreaNames' },
        { id: 'controller', source: { file: 'controller.bin' }, references: [ref('gameObject', 'root')] },
        { id: 'names', source: { file: 'names.bin' }, entry: { PathID: '88' }, references: [ref('gameObject', 'root')],
            serializedFile: { formatVersion: 17, unityVersion: '2017.4.30f1\n2' },
            decoded: { type: 'MonoBehaviour', className: 'MonoLevelMapNames', namespace: 'MoleMole', assembly: 'Assembly-CSharp.dll',
                gameObject: { fileID: 0, PathID: '12' }, script: { fileID: 0, PathID: '34' } } }];
    const base = { scenes: [{ sceneId: 3, controllerSource: { file: 'controller.bin' }, config: { prefabPath: 'Map/NativeRoot' },
        projection: { scale: 4, offsetX: 2048, offsetZ: -1024 } }] };
    const staticLabel = { id: 'map-label-static', ancestors: [{ id: 'root' }], geometry: {
        coordinateSpace: 'prefab-ui', corners: [[0, 0, 0], [10, 0, 0], [10, 20, 0], [0, 20, 0]] } };
    const prefab = { objects, labels: [staticLabel, { ...staticLabel, id: 'foreign', rootName: 'NativeRoot', ancestors: [{ id: 'other-root' }] }] };
    const result = buildSurfaceLabels(base, prefab, () => fixture());
    assert.equal(result.length, 3); assert(result.every(label => label.sceneId === 3));
    assert.deepEqual(result[0].position, { x: 2088, z: -1044 });
    assert.equal(result[1].nativeLabel.group, 0); assert.equal(result[2].nativeLabel.group, 1);
    objects.find(object => object.id === 'places').decoded.scale = [2, 2, 2];
    assert.throws(() => buildSurfaceLabels(base, prefab, () => fixture()));
});
test('label records join exact text keys, keep originals, and never fabricate visibility from control words', () => {
    const labels = [{ id: 'map-label-abc', textKey: 'UI_MAP_AREA1_TITLE_1', gameObjectName: '1_1', rootName: 'Root',
        sceneId: 3, entry: { PathID: '12' }, position: { x: 2928, z: -1792 }, coordinateOrigin: 'projected-label-anchor', nativeLabel: { packed_word: 2147581949 } }];
    const source = { excel: () => [{ textMapId: labels[0].textKey, textMapContentTextMapHash: 2955715816 }], text: () => '望风角' };
    const record = surfaceLabelRecords(labels, 'verified-base-cache', { source, language: 'CHS' })['map-place-abc'];
    assert.equal(record.name, '望风角'); assert.deepEqual(record.source.hashes, ['2955715816']);
    assert.deepEqual(record.relations, [{ role: 'scene', category: 'maps', id: 'scene-3' }]);
    assert.deepEqual(record.diagnostics, []); assert.equal(record.data.condition, undefined);
    source.text = () => '';
    assert.deepEqual(surfaceLabelRecords(labels, 'cache', { source, language: 'EN' })['map-place-abc'].diagnostics, ['missing_text:name:2955715816']);
});
