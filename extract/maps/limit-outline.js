const assert = require('node:assert/strict');

const PROFILE = 'simple-polygon-7.2-v1';

function decodeOutline(bytes) {
    let offset = 0;
    const bits = Buffer.alloc(4);
    function word() {
        const value = bytes.readUInt32LE(offset);
        offset += 4;
        return value;
    }
    function float(word) {
        bits.writeUInt32LE(word >>> 0);
        const value = bits.readFloatLE();
        assert(Number.isFinite(value), 'Non-finite SimplePolygon coordinate');
        return value;
    }
    function vector() {
        const fields = bytes[offset++];
        assert(fields === 0xda || fields === 0xba, 'Unsupported SimplePolygon vector');
        const z = float(word() ^ 0xf5636099);
        const y = fields === 0xda ? float((word() - 0x01fc97c8) ^ 0x5e4901a6) : undefined;
        const x = float(word() - 0x0278a78d);
        return y === undefined ? { x, z } : { x, y, z };
    }
    const flags = bytes[offset++];
    assert([0x25, 0x21, 0xa5, 0xa1].includes(flags), 'Unsupported SimplePolygon layout');
    const minimum = vector();
    const count = ((word() - 108774649) ^ 285) >>> 0;
    assert(count >= 3 && count <= (bytes.length - offset - 9) / 9, 'Invalid SimplePolygon point count');
    const points = Array.from({ length: count }, vector);
    if (flags & 0x80) assert.equal(bytes[offset++], 0xd6, 'Unsupported SimplePolygon marker');
    const outside = !(flags & 4);
    if (outside) assert.equal(word(), 0xebd4b223, 'Unsupported SimplePolygon area type');
    const maximum = vector();
    assert.equal(offset, bytes.length, 'Trailing SimplePolygon bytes');
    for (const axis of ['x', 'z']) {
        assert.equal(points.reduce((min, point) => Math.min(min, point[axis]), Infinity), minimum[axis], 'SimplePolygon minimum mismatch');
        assert.equal(points.reduce((max, point) => Math.max(max, point[axis]), -Infinity), maximum[axis], 'SimplePolygon maximum mismatch');
    }
    return { minimum, maximum, points, ...(outside ? { area_type: 'POLYGON_AREA_TYPE_OUTSIDE' } : {}) };
}

function attachOutline(record, outline) {
    const data = record.data;
    assert(record.kind === 'limit_region' && data.region_id === outline.id && data.scene_id === outline.sceneId
        && record.name === outline.name && data.region_type === outline.type, `Mismatched limit region: ${record.id}`);
    data.polygons = [outline.polygon];
    data.geometry_status = 'client-simple-polygon';
    record.diagnostics = record.diagnostics.filter(code => code !== 'playable_boundary_geometry_not_resolved');
    if (!record.diagnostics.includes('boundary_rendering_and_activation_unverified'))
        record.diagnostics.push('boundary_rendering_and_activation_unverified');
}

module.exports = { PROFILE, decodeOutline, attachOutline };
