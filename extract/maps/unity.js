const assert = require('node:assert/strict');

// Only the player serialization layout actually checked against the current GI
// client is accepted. Type names alone are not a schema/version guarantee.
function checkMetadata(metadata, bytes) {
    assert.equal(metadata.format, 'serialized', 'Map object needs serialized bytes, not payload');
    assert.equal(metadata.bytes, bytes.length, 'Map object length mismatch');
    const file = metadata.serializedFile;
    assert.equal(file.formatVersion, 17, 'Unsupported map serialization version');
    assert.equal(file.endianness, 0, 'Unsupported map byte order');
    assert.equal(file.unityVersion, '2017.4.30f1\n2', 'Unsupported GI map Unity layout');
}
class Reader {
    constructor(bytes) { this.bytes = bytes; this.offset = 0; }
    take(size) { assert(Number.isSafeInteger(size) && size >= 0 && this.offset + size <= this.bytes.length, `Map object truncated at ${this.offset}`); const start = this.offset; this.offset += size; return start; }
    int() { return this.bytes.readInt32LE(this.take(4)); }
    float() { const value = this.bytes.readFloatLE(this.take(4)); assert(Number.isFinite(value), 'Non-finite map number'); return value; }
    byte() { return this.bytes[this.take(1)]; }
    align() { this.take((4 - this.offset % 4) % 4); }
    string() { const size = this.int(); assert(size >= 0 && size <= 1024 * 1024, 'Invalid map string length'); const start = this.take(size); const value = new TextDecoder('utf-8', { fatal: true }).decode(this.bytes.subarray(start, start + size)); this.align(); return value; }
    pointer() { const fileID = this.int(); assert(fileID >= 0, 'Negative map fileID'); return { fileID, PathID: this.bytes.readBigInt64LE(this.take(8)).toString() }; }
    vector(size) { return Array.from({ length: size }, () => this.float()); }
    list(read, minBytes = 1) { const size = this.int(); assert(size >= 0 && size <= 100000 && size * minBytes <= this.bytes.length - this.offset, 'Invalid map array length'); return Array.from({ length: size }, () => read()); }
    end() { assert.equal(this.offset, this.bytes.length, 'Unsupported trailing map object fields'); }
}
function parseMaterial(r, extraTextureWord) {
    const name = r.string(), shader = r.pointer(), keywords = r.string();
    const lightmapFlags = r.int(), flags = r.int(), renderQueue = r.int();
    const tags = r.list(() => ({ name: r.string(), value: r.string() }), 8);
    const disabledPasses = r.list(() => r.string(), 4);
    const textures = r.list(() => {
        const value = { name: r.string(), texture: r.pointer(), scale: r.vector(2), offset: r.vector(2) };
        if (extraTextureWord) value.extraWord = r.int();
        return value;
    }, 32);
    const floats = r.list(() => ({ name: r.string(), value: r.float() }), 8);
    const colors = r.list(() => ({ name: r.string(), value: r.vector(4) }), 20);
    for (const entries of [textures, floats, colors]) assert.equal(new Set(entries.map(e => e.name)).size, entries.length, 'Duplicate material property');
    r.end();
    return { type: 'Material', name, shader, keywords, lightmapFlags, flags, renderQueue, tags, disabledPasses, textures, floats, colors, textureLayout: extraTextureWord ? 'extra-word' : 'standard' };
}
function decodeObject(bytes, metadata, script) {
    checkMetadata(metadata, bytes);
    const r = new Reader(bytes), type = metadata.entry.Type;
    let value;
    if (type === 'GameObject') {
        value = { type, components: r.list(() => r.pointer(), 12), layer: r.int(), name: r.string() };
        value.tag = r.bytes.readUInt16LE(r.take(2));
        const active = r.byte(); assert(active === 0 || active === 1, 'Invalid GameObject active value'); value.active = active === 1;
    } else if (type === 'Transform' || type === 'RectTransform') {
        value = { type, gameObject: r.pointer(), rotation: r.vector(4), position: r.vector(3), scale: r.vector(3), children: r.list(() => r.pointer(), 12), parent: r.pointer() };
        if (type === 'RectTransform') Object.assign(value, { anchorMin: r.vector(2), anchorMax: r.vector(2), anchoredPosition: r.vector(2), size: r.vector(2), pivot: r.vector(2) });
    } else if (type === 'MonoScript') {
        value = { type, name: r.string(), executionOrder: r.int() }; r.take(16);
        Object.assign(value, { className: r.string(), namespace: r.string(), assembly: r.string(), editorScript: r.byte() });
    } else if (type === 'Material') {
        // Both observed GI serialization variants must consume the entire object;
        // ambiguous success is rejected instead of guessing from a property name.
        const successes = [];
        for (const extra of [false, true]) { try { successes.push(parseMaterial(new Reader(bytes), extra)); } catch {} }
        assert.equal(successes.length, 1, 'Unsupported or ambiguous map material layout');
        return successes[0];
    } else if (type === 'MonoBehaviour') {
        value = { type, gameObject: r.pointer(), enabled: r.byte() }; r.align();
        value.script = r.pointer(); value.name = r.string(); value.dataOffset = r.offset;
        if (!script) return { ...value, decodeStatus: 'script-unresolved', unparsedBytes: bytes.length - r.offset };
        assert.equal(script.type, 'MonoScript', 'Expected a decoded MonoScript');
        Object.assign(value, { className: script.className, namespace: script.namespace, assembly: script.assembly });
        if (script.assembly !== 'Assembly-CSharp.dll' && script.assembly !== 'UnityEngine.UI.dll') return { ...value, decodeStatus: 'unsupported-script', unparsedBytes: bytes.length - r.offset };
        if (script.className === 'MonoMapArea' && script.namespace === 'MoleMole') {
            assert.equal(r.offset, 32, 'Unsupported MonoMapArea base');
            r.take(100); value.areaTransforms = r.list(() => r.pointer(), 12);
        } else if (script.className === 'MonoMultilayerMapLayer' && script.namespace === 'MoleMole') {
            assert.equal(r.offset, 32, 'Unsupported map layer base');
            r.take(16); value.layerObjects = r.list(() => r.pointer(), 12); value.rectTransform = r.pointer();
        } else if (['Image', 'SmoothMaskClipableImage', 'SmoothMaskClippableMeshImage'].includes(script.className)) {
            assert.equal(r.offset, 32, 'Unsupported map Image base');
            const meshImage = script.className === 'SmoothMaskClippableMeshImage';
            assert.equal(bytes.length, meshImage ? 252 : 240, 'Unsupported map Image layout');
            value.material = r.pointer(); r.take(4); value.color = r.vector(4);
            r.take(136); value.sprite = r.pointer(); r.take(28);
            if (meshImage) value.mesh = r.pointer();
        } else if (script.className === 'MonoLocalizedText' && script.namespace === 'MoleMole') {
            assert.equal(r.offset, 32, 'Unsupported localized text base');
            value.textKey = r.string();
            // Four trailing configuration words are preserved in the raw object;
            // their meaning is not needed to identify the original text key.
            r.take(16);
        } else {
            return { ...value, decodeStatus: 'unsupported-script', unparsedBytes: bytes.length - r.offset };
        }
        value.decodeStatus = 'decoded';
    } else if (['Sprite', 'Texture2D', 'Shader', 'Mesh'].includes(type)) {
        // Identity only: streamed texture/mesh/shader content is not decoded here.
        return { type, name: r.string(), decodeStatus: 'identity-only', unparsedBytes: bytes.length - r.offset };
    } else {
        throw new Error(`Unsupported map object type ${type}`);
    }
    r.end(); return value;
}
function objectPointers(object) {
    const result = [];
    function add(field, pointer) { if (pointer) result.push({ field, ...pointer }); }
    for (const key of ['gameObject', 'parent', 'script', 'rectTransform', 'material', 'sprite', 'shader', 'mesh']) add(key, object[key]);
    for (const key of ['components', 'children', 'areaTransforms', 'layerObjects']) (object[key] || []).forEach((pointer, i) => add(`${key}[${i}]`, pointer));
    for (const entry of object.textures || []) add(`textures.${entry.name}`, entry.texture);
    return result;
}
function mapMaterialParameters(material) {
    assert.equal(material.type, 'Material');
    const floats = Object.fromEntries(material.floats.map(p => [p.name, p.value]));
    const texture = material.textures.find(p => p.name === '_MiniMap');
    const color = material.colors.find(p => p.name === '_Color');
    return {
        texture: texture?.texture || null, textureScale: texture?.scale || null, textureOffset: texture?.offset || null,
        color: color?.value || null,
        softEdge: Object.hasOwn(floats, '_MapSoftEdge_Toggle') && Object.hasOwn(floats, '_MapEdgeSoftness')
            ? { enabled: floats._MapSoftEdge_Toggle !== 0, strength: floats._MapEdgeSoftness } : null,
        smoothMaskEnabled: Object.hasOwn(floats, '_UseUISmoothMask') ? floats._UseUISmoothMask !== 0 : null,
        // These are observations, not a claim that stencil/animation are reproduced.
        renderingStatus: 'parameters-only',
    };
}
function softEdgeAlpha(u, v, { enabled, strength }) {
    assert([u, v, strength].every(Number.isFinite) && strength >= 0, 'Invalid soft-edge inputs');
    const clamp = value => Math.min(1, Math.max(0, value));
    return enabled ? clamp(strength * (1 - Math.abs(2 * u - 1))) * clamp(strength * (1 - Math.abs(2 * v - 1))) : 1;
}
// Compose actual serialized transforms; do not replace them with per-scene guessed
// offsets. The caller projects these UI coordinates only after calibrating its map.
function rectCorners(rect, ancestors = []) {
    assert.equal(rect.type, 'RectTransform');
    assert.deepEqual(rect.anchorMin, rect.anchorMax, 'Stretched RectTransform needs parent layout evaluation');
    assert(rect.size.every(value => value >= 0), 'Negative RectTransform size');
    const points = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => [(u - rect.pivot[0]) * rect.size[0], (v - rect.pivot[1]) * rect.size[1], 0]);
    for (const transform of [rect, ...ancestors]) {
        const [qx, qy, qz, qw] = transform.rotation;
        assert(Math.abs(qx * qx + qy * qy + qz * qz + qw * qw - 1) < 0.0001, 'Invalid transform quaternion');
        for (const p of points) {
            const x = p[0] * transform.scale[0], y = p[1] * transform.scale[1], z = p[2] * transform.scale[2];
            const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
            p[0] = x + qw * tx + qy * tz - qz * ty + transform.position[0];
            p[1] = y + qw * ty + qz * tx - qx * tz + transform.position[1];
            p[2] = z + qw * tz + qx * ty - qy * tx + transform.position[2];
        }
    }
    return points;
}
module.exports = { decodeObject, objectPointers, mapMaterialParameters, softEdgeAlpha, rectCorners };
