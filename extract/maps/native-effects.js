const assert = require('node:assert/strict');
const { rectCorners } = require('./unity');

// sizeDelta is not the drawable size of a stretched RectTransform. Resolve the
// parent layout, while preserving the client's serialized position/rotation.
function layoutCorners(rect, ancestors) {
    function size(node, parents) {
        assert.equal(node.type, 'RectTransform');
        const span = node.anchorMax.map((n, i) => n - node.anchorMin[i]);
        if (span.every(n => n === 0)) return node.size;
        assert(parents.length, 'Stretched root has no known parent layout');
        const parent = size(parents[0], parents.slice(1));
        return node.size.map((n, i) => n + parent[i] * span[i]);
    }
    const resolved = size(rect, ancestors);
    assert(resolved.every(n => Number.isFinite(n) && n >= 0), 'Invalid resolved rectangle size');
    return rectCorners({ ...rect, size: resolved, anchorMax: rect.anchorMin }, ancestors);
}

function graph(cache) {
    const objects = new Map(cache.objects.map(o => [o.id, o]));
    const target = (o, field) => objects.get(o?.references.find(r => r.field === field && r.status === 'resolved')?.target);
    const transform = go => {
        const found = go?.references.map(r => objects.get(r.target)).filter(o => o?.decoded?.type === 'RectTransform') || [];
        assert.equal(found.length, 1, 'Expected one RectTransform'); return found[0];
    };
    const chain = rect => {
        const result = [], seen = new Set();
        while (rect) {
            assert(!seen.has(rect.id), 'Transform cycle'); seen.add(rect.id); result.push(rect);
            if (rect.decoded.parent.PathID === '0') return result;
            rect = target(rect, 'parent');
        }
        throw new Error('Missing transform parent');
    };
    const geometry = rect => ({ coordinateSpace: 'prefab-ui', corners: layoutCorners(rect.decoded, chain(rect).slice(1).map(o => o.decoded)) });
    const root = rect => target(chain(rect).at(-1), 'gameObject');
    const image = o => { const png = cache.imageAssets.find(i => i.id === o?.id)?.png; assert(png, `Missing verified PNG: ${o?.name}`); return png; };
    return { objects, target, transform, chain, geometry, root, image };
}
module.exports = { layoutCorners, graph };
