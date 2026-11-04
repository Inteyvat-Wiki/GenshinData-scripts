const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeObject, objectPointers, softEdgeAlpha, rectCorners, mapMaterialParameters } = require('./unity');
class Writer {
    constructor() { this.parts = []; this.length = 0; }
    bytes(value) { this.parts.push(value); this.length += value.length; return this; }
    int(value) { const b = Buffer.alloc(4); b.writeInt32LE(value); return this.bytes(b); }
    float(value) { const b = Buffer.alloc(4); b.writeFloatLE(value); return this.bytes(b); }
    vector(values) { values.forEach(value => this.float(value)); return this; }
    pointer(id, fileID = 0) { this.int(fileID); const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(id)); return this.bytes(b); }
    string(value) { const b = Buffer.from(value); this.int(b.length).bytes(b); return this.bytes(Buffer.alloc((4 - this.length % 4) % 4)); }
    buffer() { return Buffer.concat(this.parts); }
}
function metadata(type, bytes) { return { format: 'serialized', bytes: bytes.length, entry: { Type: type }, serializedFile: { formatVersion: 17, endianness: 0, unityVersion: '2017.4.30f1\n2' } }; }
function transform() {
    return new Writer().pointer('9223372036854775806').vector([0, 0, 0, 1]).vector([10, 20, 0]).vector([1, 1, 1])
        .int(0).pointer('0').vector([0.5, 0.5]).vector([0.5, 0.5]).vector([10, 20]).vector([100, 40]).vector([0.5, 0.5]).buffer();
}
test('exact Int64 references and parent-composed rectangle coordinates', () => {
    const b = transform(), decoded = decodeObject(b, metadata('RectTransform', b));
    assert.equal(decoded.gameObject.PathID, '9223372036854775806');
    assert.deepEqual(rectCorners(decoded), [[-40, 0, 0], [60, 0, 0], [60, 40, 0], [-40, 40, 0]]);
    assert.deepEqual(rectCorners(decoded, [{ rotation: [0, 0, 0, 1], position: [5, -2, 0], scale: [2, 2, 1] }])[0], [-75, -2, 0]);
    assert.throws(() => rectCorners({ ...decoded, anchorMax: [1, 1] }), /Stretched/);
});
test('rejects other layouts, payloads, truncated and trailing objects', () => {
    const b = transform(), m = metadata('RectTransform', b);
    assert.throws(() => decodeObject(b, { ...m, format: 'payload' }), /serialized/);
    assert.throws(() => decodeObject(b, { ...m, serializedFile: { ...m.serializedFile, unityVersion: '2022' } }), /Unsupported/);
    const short = b.subarray(0, b.length - 4);
    assert.throws(() => decodeObject(short, metadata('RectTransform', short)), /truncated/);
    const long = Buffer.concat([b, Buffer.alloc(4)]);
    assert.throws(() => decodeObject(long, metadata('RectTransform', long)), /trailing/);
});
test('MonoMapArea preserves component array order, not transform sibling order', () => {
    const b = new Writer().pointer('1').int(1).pointer('2').string('').bytes(Buffer.alloc(100)).int(2).pointer('300').pointer('200').buffer();
    const base = decodeObject(b, metadata('MonoBehaviour', b));
    assert.equal(base.decodeStatus, 'script-unresolved');
    const result = decodeObject(b, metadata('MonoBehaviour', b), { type: 'MonoScript', className: 'MonoMapArea', namespace: 'MoleMole', assembly: 'Assembly-CSharp.dll' });
    assert.deepEqual(result.areaTransforms.map(p => p.PathID), ['300', '200']);
    assert.deepEqual(objectPointers(result).filter(p => p.field.startsWith('areaTransforms')).map(p => p.PathID), ['300', '200']);
});
test('Image component alpha and exact Sprite/Material pointers survive decoding', () => {
    const b = new Writer().pointer('1').int(1).pointer('2').string('').pointer('3', 1).int(0).vector([1, 1, 1, 0.409])
        .bytes(Buffer.alloc(136)).pointer('-9007199254740993', 2).bytes(Buffer.alloc(28)).buffer();
    const result = decodeObject(b, metadata('MonoBehaviour', b), { type: 'MonoScript', className: 'Image', namespace: 'UnityEngine.UI', assembly: 'UnityEngine.UI.dll' });
    assert.equal(result.sprite.PathID, '-9007199254740993');
    assert.equal(result.material.fileID, 1);
    assert(Math.abs(result.color[3] - 0.409) < 1e-7);
});
test('material extra-word variant reads actual named properties and rejects leftovers', () => {
    const b = new Writer().string('sample').pointer('3', 1).string('').int(4).int(1).int(-1).int(0).int(0)
        .int(1).string('_MiniMap').pointer('9007199254740999', 2).vector([1, 1, 0, 0]).int(0)
        .int(3).string('_MapSoftEdge_Toggle').float(1).string('_MapEdgeSoftness').float(4).string('_UseUISmoothMask').float(0)
        .int(1).string('_Color').vector([1, 1, 1, 0.5]).buffer();
    const result = decodeObject(b, metadata('Material', b)), material = mapMaterialParameters(result);
    assert.equal(result.textureLayout, 'extra-word');
    assert.equal(material.texture.PathID, '9007199254740999');
    assert.deepEqual(material.softEdge, { enabled: true, strength: 4 });
    assert.equal(material.smoothMaskEnabled, false);
    assert.equal(material.renderingStatus, 'parameters-only');
    const bad = Buffer.concat([b, Buffer.alloc(4)]);
    assert.throws(() => decodeObject(bad, metadata('Material', bad)), /Unsupported or ambiguous/);
});
test('shader soft edge is separable with a multiplied corner, not uniform alpha', () => {
    const edge = { enabled: true, strength: 4 };
    assert.equal(softEdgeAlpha(0.5, 0.5, edge), 1);
    assert.equal(softEdgeAlpha(0, 0.5, edge), 0);
    assert.equal(softEdgeAlpha(0.0625, 0.5, edge), 0.5);
    assert.equal(softEdgeAlpha(0.0625, 0.0625, edge), 0.25);
    assert.equal(softEdgeAlpha(0, 0, { ...edge, enabled: false }), 1);
    assert.throws(() => softEdgeAlpha(0.5, 0.5, { enabled: true, strength: -1 }), /Invalid/);
});
module.exports = { Writer, metadata, transform };
test('MeshImage carries its exact trailing Mesh pointer and localized text keeps the original key', () => {
    const b = new Writer().pointer('1').int(1).pointer('2').string('').pointer('3', 1).int(0).vector([1, 0.5, 0.5, 0.28])
        .bytes(Buffer.alloc(136)).pointer('4', 2).bytes(Buffer.alloc(28)).pointer('3993041647707304329', 5).buffer();
    const result = decodeObject(b, metadata('MonoBehaviour', b), { type: 'MonoScript', className: 'SmoothMaskClippableMeshImage', namespace: '', assembly: 'Assembly-CSharp.dll' });
    assert.equal(objectPointers(result).find(pointer => pointer.field === 'mesh').PathID, '3993041647707304329');
    const text = new Writer().pointer('1').int(1).pointer('2').string('').string('UI_MAP_AREA25_TITLE_3').bytes(Buffer.alloc(16)).buffer();
    const label = decodeObject(text, metadata('MonoBehaviour', text), { type: 'MonoScript', className: 'MonoLocalizedText', namespace: 'MoleMole', assembly: 'Assembly-CSharp.dll' });
    assert.equal(label.textKey, 'UI_MAP_AREA25_TITLE_3');
});
