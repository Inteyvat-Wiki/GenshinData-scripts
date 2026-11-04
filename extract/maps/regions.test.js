const test = require('node:test');
const assert = require('node:assert/strict');
const { rotate, shapeFootprint, validateGroupBounds } = require('./regions');
const near = (a, b) => assert(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
test('Unity yaw rotates forward to right and full box dimensions remain centered', () => {
    const forward = rotate([0, 0, 1], { y: 90 }); near(forward[0], 1); near(forward[2], 0);
    const shape = shapeFootprint({ pos: { x: 10, y: 20, z: 30 }, rot: { y: 90 },
        shape: { $type: 'HAIFNCHBCNL', centerType: 'Center', useHeight: true, width: 2, height: 4, length: 6 } });
    near(Math.min(...shape.points.map(p => p.x)), 7); near(Math.max(...shape.points.map(p => p.x)), 13);
    near(Math.min(...shape.points.map(p => p.z)), 29); near(Math.max(...shape.points.map(p => p.z)), 31);
    assert.deepEqual(shape.height, { minimum: 18, maximum: 22 });
});
test('rotated box projects all eight corners including its height, not only a horizontal slice', () => {
    const shape = shapeFootprint({ rot: { z: 90 }, shape: { $type: 'AJNJANLLNIB', useHeight: true, width: 2, height: 4, length: 6 } });
    near(Math.min(...shape.points.map(p => p.x)), -2); near(Math.max(...shape.points.map(p => p.x)), 2);
    near(shape.height.minimum, -1); near(shape.height.maximum, 1);
});
test('sphere and cylinder preserve exact circles, unknown rotated primitives stay unresolved', () => {
    const sphere = shapeFootprint({ pos: { y: 10 }, shape: { $type: 'DBKLAGCFMAH', radius: 3 } });
    assert.equal(sphere.kind, 'circle'); assert.deepEqual(sphere.height, { minimum: 7, maximum: 13 });
    assert.equal(shapeFootprint({ shape: { $type: 'ACOLPJIAONA', radius: 3, height: 5 } }), null);
    assert.equal(shapeFootprint({ rot: { x: 10 }, shape: { $type: 'MDPMIFIJHAP', useHeight: true, radius: 3, height: 5 } }), null);
});
test('independent source bounds catch dimension/rotation drift and partial coverage never reports matched', () => {
    const row = { NGGJDLACPDL: [{ limitShapes: [{ pos: { x: 10, y: 20, z: 30 }, shape: { $type: 'DBKLAGCFMAH', radius: 3 } }] }],
        minArea: { x: 7, y: 17, z: 27 }, maxArea: { x: 13, y: 23, z: 33 } };
    assert.equal(validateGroupBounds(row, row.NGGJDLACPDL).status, 'matched'); row.maxArea.x = 14;
    assert.equal(validateGroupBounds(row, row.NGGJDLACPDL).status, 'mismatch'); row.NGGJDLACPDL[0].limitShapes.push({ shape: { $type: 'Unknown' } });
    assert.equal(validateGroupBounds(row, row.NGGJDLACPDL).status, 'partial');
});
