// Region extents are layer activation volumes, never an open-world red border.
// Centered dimensions and Euler order are regression checked against the source
// groups' independent minArea/maxArea (100 complete groups at the 7.1 snapshot).
const BOX = 'HAIFNCHBCNL', ROTATED_BOX = 'AJNJANLLNIB', CYLINDER = 'MDPMIFIJHAP', SPHERE = 'DBKLAGCFMAH';
function rotate([x, y, z], rotation = {}) {
    // Unity extrinsic Euler Z, X, Y in degrees. +90 Y maps +Z to +X.
    const [a, b, c] = ['z', 'x', 'y'].map(axis => (rotation[axis] || 0) * Math.PI / 180);
    [x, y] = [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
    [y, z] = [y * Math.cos(b) - z * Math.sin(b), y * Math.sin(b) + z * Math.cos(b)];
    return [x * Math.cos(c) + z * Math.sin(c), y, -x * Math.sin(c) + z * Math.cos(c)];
}
function hull(points) {
    const sorted = [...new Map(points.map(point => [`${point.x},${point.z}`, point])).values()].sort((a, b) => a.x - b.x || a.z - b.z);
    const cross = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    const half = values => { const result = []; for (const point of values) {
        while (result.length > 1 && cross(result.at(-2), result.at(-1), point) <= 1e-8) result.pop(); result.push(point);
    } return result; };
    return [...half(sorted).slice(0, -1), ...half([...sorted].reverse()).slice(0, -1)];
}
function shapeFootprint(entry) {
    const shape = entry.shape || {}, type = shape.$type, position = entry.pos || {}, rotation = entry.rot || {};
    const p = ['x', 'y', 'z'].map(axis => position[axis] || 0);
    const positive = value => Number.isFinite(value) && value > 0;
    if ([BOX, ROTATED_BOX].includes(type)) {
        if (type === BOX && (shape.centerType !== 'Center' || rotation.x || rotation.z)) return null;
        if (shape.useHeight !== true || ![shape.width, shape.height, shape.length].every(positive)) return null;
        const corners = [];
        for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1])
            corners.push(rotate([x * shape.width / 2, y * shape.height / 2, z * shape.length / 2], rotation).map((value, i) => value + p[i]));
        return { kind: 'polygon', points: hull(corners.map(([x, , z]) => ({ x, z }))),
            height: { minimum: Math.min(...corners.map(value => value[1])), maximum: Math.max(...corners.map(value => value[1])) },
            source: type === BOX ? 'yaw-box' : 'rotated-box' };
    }
    if ([CYLINDER, SPHERE].includes(type)) {
        if (!positive(shape.radius)) return null;
        if (type === CYLINDER && (rotation.x || rotation.z || shape.useHeight !== true || !positive(shape.height))) return null;
        const h = type === SPHERE ? shape.radius : shape.height / 2;
        return { kind: 'circle', center: { x: p[0], z: p[2] }, radius: shape.radius,
            height: { minimum: p[1] - h, maximum: p[1] + h }, source: type === SPHERE ? 'sphere' : 'vertical-cylinder' };
    }
    return null;
}
function polygonFootprint(polygon) {
    if (!Array.isArray(polygon.roadPoints) || polygon.roadPoints.length < 3 || !polygon.minArea || !polygon.maxArea) return null;
    return { kind: 'polygon', points: polygon.roadPoints.map(point => ({ x: point.x || 0, z: point.z || 0 })),
        height: { minimum: polygon.minArea.y || 0, maximum: polygon.maxArea.y || 0 }, source: 'region-polygon' };
}
function validateGroupBounds(group, regions, tolerance = .005) {
    const footprints = regions.flatMap(region => [
        ...(region.regionPolygons || []).map(polygonFootprint), ...(region.limitShapes || []).map(shapeFootprint),
    ]);
    if (footprints.some(value => !value)) return { status: 'partial' };
    if (!footprints.length) return { status: 'empty' };
    if (!group.minArea || !group.maxArea) return { status: 'source-bounds-missing' };
    const values = footprints.flatMap(footprint => {
        const points = footprint.kind === 'polygon' ? footprint.points : [-1, 1].map(sign => ({ x: footprint.center.x + sign * footprint.radius, z: footprint.center.z + sign * footprint.radius }));
        return points.flatMap(point => [footprint.height.minimum, footprint.height.maximum].map(y => ({ ...point, y })));
    });
    const error = Math.max(...['x', 'y', 'z'].flatMap(axis => [
        Math.abs(Math.min(...values.map(value => value[axis])) - group.minArea[axis]),
        Math.abs(Math.max(...values.map(value => value[axis])) - group.maxArea[axis]),
    ]));
    return { status: error <= tolerance ? 'matched' : 'mismatch', maximum_error: error };
}
module.exports = { rotate, shapeFootprint, polygonFootprint, validateGroupBounds };
