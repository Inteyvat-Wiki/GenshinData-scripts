const assert = require('node:assert/strict');
const PROFILE = 'gi-map-area-cn-7.1-v1';
const CONFIG_BLOCK_SHA256 = '71fbe2d10404655fa20e5d612daf5fa2f2336c1d6250ae209b722c894169aff7';

// Revision-specific field layout, checked against all overlapping named records.
// No resource-name scan, per-record offsets, or legacy coordinates are inputs.
function decodeMapAreas(buffer, profile = PROFILE) {
    assert.equal(profile, PROFILE); let p = 0;
    const take = n => { assert(p + n <= buffer.length, `MapArea EOF at ${p}`); const at = p; p += n; return at; };
    const byte = () => buffer[take(1)];
    const word = () => buffer.readUInt32LE(take(4));
    const count = (constant, max = 1000) => { const value = (word() - constant) >>> 0; assert(value < max, `Invalid MapArea count at ${p}`); return value; };
    const boolean = constant => { const value = byte() ^ constant; assert(value === 0 || value === 1, `Invalid MapArea boolean at ${p}`); return !!value; };
    const float = bits => { const b = Buffer.alloc(4); b.writeUInt32LE(bits >>> 0); const n = b.readFloatLE(); assert(Number.isFinite(n) && Math.abs(n) < 100000); return n; };
    function vector() {
        const flags = byte() ^ 0xd3; assert([0, 0x20, 0x40, 0x60].includes(flags), `Unknown MapArea vector at ${p}`);
        const v = {}; if (flags & 0x40) v.y = float(word() - 0xda670a95);
        if (flags & 0x20) v.x = float(word() ^ 0xd7398bb6); return v;
    }
    function string() {
        const length = buffer.readUInt16LE(take(2)) ^ 0x26d7; assert(length > 0 && length < 1024, 'Invalid MapArea string length');
        const at = take(length), result = Buffer.alloc(length);
        for (let i = 0; i < length; i += 8) {
            const block = Buffer.alloc(8), size = Math.min(8, length - i); buffer.copy(block, 0, at + i, at + i + size);
            block.writeBigUInt64LE(BigInt.asUintN(64, block.readBigUInt64LE() - 0x94be9262c3b2d929n)); block.copy(result, i, 0, size);
        }
        const value = result.toString('utf8'); assert(/^ART\/[\x20-\x7e]+$/.test(value), `Invalid MapArea prefab path at ${at} length ${length}`); return value;
    }
    // This header/count pair is only established for the pinned client revision.
    assert.equal(word(), 0xe85e9ec9, 'Unsupported MapArea dictionary header');
    const configs = {};
    const types = { 0x19: 'FBIKKPDLOAF', 0x16: 'JDEMLDLHEPG', 0x17: 'DAHBPAALFNA', 0x14: 'HBAIOECPCPA' };
    for (let i = 0; i < 137; i++) {
        const key = (word() ^ 0x8ff85141) >>> 0, type = byte(), first = byte(), second = byte();
        assert(key > 0 && key < 10000 && !configs[key], 'Invalid MapArea dictionary key');
        assert(types[type] && [0x9f, 0xbf, 0xdf, 0xff].includes(first) && [0x2f, 0x6e, 0xae, 0xaf, 0xee, 0xef].includes(second), `Unknown MapArea layout ${key}`);
        const value = { $type: types[type] };
        if (!(second & 0x80)) value.showUnlockScenePoint = boolean(0xb9);
        if (second & 1) value.hideScenePointList = Array.from({ length: count(0xe542054d) }, () => (word() - 0xa66bd56e) >>> 0);
        value.prefabPath = string();
        if (!(second & 0x40)) value.sortID = count(0x479bdca6);
        value.id = (word() ^ 0x3778ccbb) >>> 0;
        value.mapPosList = Array.from({ length: count(0xc9585adc) }, vector);
        if (!(first & 0x40)) value.useSubAnchor = boolean(0xad);
        if (first & 0x20) value.needAnim = boolean(0xa3);
        if (type === 0x16) {
            const mask = byte(); assert([0x56, 0x5c].includes(mask), `Unknown MapArea subtype ${key}`);
            if (mask === 0x56) value.index = count(0xb0f07563);
            if (mask === 0x5c) value.isBack = boolean(0xc1);
        }
        configs[key] = value;
    }
    assert.equal(p, buffer.length, 'MapArea trailing bytes'); return configs;
}
module.exports = { PROFILE, CONFIG_BLOCK_SHA256, decodeMapAreas };
