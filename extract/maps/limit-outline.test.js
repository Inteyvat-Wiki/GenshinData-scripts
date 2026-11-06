const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeOutline, attachOutline } = require('./limit-outline');

// 7.2 MoonCanon, limit 1021001, design block 24230448, PathID 45025.
const bytes = Buffer.from('25da727e32336ed9519af80777c812c67b06baf1e8333374913748ba9e28e3b3021a3748baf1ece3b3249974c8ba727e3233f80777c8daf1ece3b36ed9d11a74913748', 'hex');
test('reads optional-height vectors and validates the entire client polygon', () => {
    const outline = decodeOutline(bytes);
    assert.equal(outline.points.length, 4);
    assert.deepEqual(outline.points[0], { x: 6109.23779296875, z: -13346.1015625 });
    assert.deepEqual(outline.minimum, { x: -8140.05224609375, y: -10000, z: -13383.7294921875 });
    assert.throws(() => decodeOutline(bytes.subarray(0, -1)));
    assert.throws(() => decodeOutline(Buffer.concat([bytes, Buffer.from([0])])), /Trailing/);
    const malformed = Buffer.from(bytes); malformed.writeUInt32LE(0, 14);
    assert.throws(() => decodeOutline(malformed), /point count/);
    const outside = Buffer.concat([bytes.subarray(0, -13), Buffer.from('d623b2d4eb', 'hex'), bytes.subarray(-13)]);
    outside[0] = 0xa1;
    assert.equal(decodeOutline(outside).area_type, 'POLYGON_AREA_TYPE_OUTSIDE');
    outside[outside.length - 14] ^= 1;
    assert.throws(() => decodeOutline(outside), /area type/);
});
test('joins region ID, resource name, scene and type before replacing geometry', () => {
    const row = { id: 1021001, name: 'BigWorld_MoonCanon_OpenArea_001', sceneId: 102,
        type: 'LIMIT_REGION_TYPE_BIGWORLD', polygon: decodeOutline(bytes) };
    const record = { kind: 'limit_region', name: row.name, data: { scene_id: row.sceneId, region_id: row.id, region_type: row.type },
        diagnostics: ['playable_boundary_geometry_not_resolved'] };
    for (const mismatch of [{ id: 1 }, { name: 'another' }, { sceneId: 103 }, { type: 'another' }])
        assert.throws(() => attachOutline(record, { ...row, ...mismatch }), /Mismatched/);
    attachOutline(record, row); attachOutline(record, row);
    assert.deepEqual(record.data.polygons, [row.polygon]);
    assert.deepEqual(record.diagnostics, ['boundary_rendering_and_activation_unverified']);
});
