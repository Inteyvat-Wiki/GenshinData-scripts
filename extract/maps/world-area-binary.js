const assert = require('node:assert/strict');

// Independently verified against 20 extracted files and 418 unchanged legacy
// polygons. Field transforms/order are revision-specific, not a generic BinOutput codec.
const PROFILE = 'gi-world-area-cn-7.1-v1';
const CONFIG_BLOCK_SHA256 = '71fbe2d10404655fa20e5d612daf5fa2f2336c1d6250ae209b722c894169aff7';
function decodeWorldArea(buffer, profile) {
    assert.equal(profile, PROFILE, 'Unsupported WorldArea decoder profile');
    assert(Buffer.isBuffer(buffer));
    let p = 0;
    function byte() { assert(p < buffer.length, `WorldArea EOF at ${p}`); return buffer[p++]; }
    function word() { assert(p + 4 <= buffer.length, `WorldArea EOF at ${p}`); const n = buffer.readUInt32LE(p); p += 4; return n; }
    function expect(n) { const at = p; assert.equal(byte(), n, `Unsupported WorldArea layout at ${at}`); }
    function float(n) {
        const bits = Buffer.alloc(4); bits.writeUInt32LE(n >>> 0); const value = bits.readFloatLE();
        assert(Number.isFinite(value) && Math.abs(value) < 1e8, `Invalid WorldArea float at ${p}`);
        return value;
    }
    function vector() {
        const mask = byte() ^ 0x98;
        assert([5, 7].includes(mask), `Unsupported WorldArea vector mask at ${p - 1}`);
        const result = {};
        // Presence is preserved: absent height is not a serialized zero.
        if (mask & 2) result.y = float((word() - 0x99274ed9) ^ 0x3e98c6be);
        result.z = float(word() - 0xda087e21);
        result.x = float(word() ^ 0xdf729864);
        return result;
    }
    function polygon() {
        expect(0x42);
        const minArea = vector(), maxArea = vector();
        const count = ((word() - 0xa36b60ab) ^ 0xc3) >>> 0;
        // Only this interval is established by the known-plaintext comparison.
        assert(count >= 3 && count < 256, `Unsupported WorldArea point count ${count}`);
        const roadPoints = Array.from({ length: count }, vector);
        for (const axis of ['x', 'z']) {
            assert.equal(Math.min(...roadPoints.map(v => v[axis])), minArea[axis], `WorldArea minimum ${axis} mismatch`);
            assert.equal(Math.max(...roadPoints.map(v => v[axis])), maxArea[axis], `WorldArea maximum ${axis} mismatch`);
        }
        if (minArea.y !== undefined && maxArea.y !== undefined) assert(minArea.y <= maxArea.y, 'Inverted WorldArea height');
        // Vertex y is not the vertical interval; do not clamp it to min/max y.
        return { minArea, maxArea, roadPoints };
    }
    function area(level) {
        expect(level === 1 ? 0x88 : 0xa8);
        const polygonData = polygon(), id1 = (word() - 0x84b5865c) >>> 0;
        assert(id1 > 0 && id1 < 10000, `Invalid WorldArea id1 ${id1}`);
        const result = { id1, polygonData };
        if (level === 2) {
            result.id2 = (word() ^ 0xb3b8156d) >>> 0;
            assert(result.id2 > 0 && result.id2 < 1e7, `Invalid WorldArea id2 ${result.id2}`);
        }
        return result;
    }
    const rootMask = byte();
    if (rootMask === 0x4b) { assert.equal(p, buffer.length, 'WorldArea trailing bytes'); return {}; }
    assert.equal(rootMask, 0xcb, 'Unsupported WorldArea root');
    const count = (word() - 0x6e49a4bb) >>> 0;
    assert(count > 0 && count < 1000, `Invalid WorldArea group count ${count}`);
    const level1Areas = [];
    for (let i = 0; i < count; i++) {
        const mask = byte(); assert([0xff, 0].includes(mask), `Unsupported WorldArea group at ${p - 1}`);
        const level1Area = area(1), group = { level1Area };
        if (mask === 0xff) {
            const children = (word() ^ 0xfbd01bce) >>> 0;
            assert(children < 1000, `Invalid WorldArea child count ${children}`);
            group.level2Areas = Array.from({ length: children }, () => {
                const child = area(2); assert.equal(child.id1, level1Area.id1, 'WorldArea parent mismatch'); return child;
            });
        }
        level1Areas.push(group);
    }
    assert.equal(p, buffer.length, 'WorldArea trailing bytes');
    return { level1Areas };
}
module.exports = { PROFILE, CONFIG_BLOCK_SHA256, decodeWorldArea };
