const test = require('node:test');
const assert = require('node:assert/strict');
const { transformVertices, projectBoundaryGeometry } = require('./boundaries');
const projections = { 3: { ...require('./base').mapProjection({ mapId: 0, frame: [-3072, -2048, 8192, 8192] }, { worldTileSize: 1024, uiTileSize: 256 }), scale: 2 } };
test('boundary mesh preserves native rotation, scale and translation before projection', () => {
    const native = transformVertices([1, 2, 0], [{ rotation: [0, 1, 0, 0], scale: [10, 10, 10], position: [100, 200, 0] }]);
    assert.deepEqual(native, [[90, 220, 0]]);
    assert.deepEqual(projectBoundaryGeometry({ coordinateSpace: 'prefab-ui', corners: native }, 3, projections).corners, [{ x: 2488, y: -1204 }]);
});
test('GlobalOpenArea requires the native GuideArea projection', () => {
    const bounds = projectBoundaryGeometry({ coordinateSpace: 'prefab-ui', corners: [[-9257.89990234375, -7695.4000244140625, 0], [3062.10009765625, 4624.5999755859375, 0]] }, 3, projections);
    assert(Math.abs(bounds.corners[0].x - -13341) < 2);
    assert(Math.abs(bounds.corners[1].x - 11301) < 4);
    assert.equal(projectBoundaryGeometry({ coordinateSpace: 'prefab-ui', corners: [[0, 0, 0]] }, 103), null);
});
