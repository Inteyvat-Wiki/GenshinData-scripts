const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeMapAreas } = require('./map-area-binary');
const u32 = value => { const b = Buffer.alloc(4); b.writeUInt32LE(value >>> 0); return b; };
function prefab(text) {
    const source = Buffer.from(text), length = Buffer.alloc(2); length.writeUInt16LE(source.length ^ 0x26d7);
    const encoded = Buffer.alloc(source.length);
    for (let i = 0; i < source.length; i += 8) {
        const block = Buffer.alloc(8); source.copy(block, 0, i, i + 8);
        block.writeBigUInt64LE(BigInt.asUintN(64, block.readBigUInt64LE() + 0x94be9262c3b2d929n)); block.copy(encoded, i, 0, Math.min(8, source.length - i));
    }
    return Buffer.concat([length, encoded]);
}
function fixture() {
    return Buffer.concat([u32(0xe85e9ec9), ...Array.from({ length: 137 }, (_, i) => Buffer.concat([
        u32((i + 1) ^ 0x8ff85141), Buffer.from([0x19, 0xdf, 0xee]), prefab(`ART/Fixture/Area_${i + 1}`),
        u32((i + 1) ^ 0x3778ccbb), u32(0xc9585add), Buffer.from([0xb3]), // x+y vector
        u32(0xda670a95 + 0x40000000), u32(0xd7398bb6 ^ 0xbf800000),
    ]))]);
}
test('MapArea client decoder preserves all IDs, string remainders, and signed vector components', () => {
    const result = decodeMapAreas(fixture()); assert.equal(Object.keys(result).length, 137);
    assert.equal(result[137].prefabPath, 'ART/Fixture/Area_137'); assert.equal(result[10].id, 10);
    assert.deepEqual(result[1].mapPosList, [{ y: 2, x: -1 }]);
    assert.equal(result[1].useSubAnchor, undefined);
});
test('MapArea client revision and malformed inputs fail closed', () => {
    const bytes = fixture(); assert.throws(() => decodeMapAreas(bytes.subarray(0, -1)), /EOF/);
    assert.throws(() => decodeMapAreas(Buffer.concat([bytes, Buffer.from([0])])), /trailing/);
    const bad = Buffer.from(bytes); bad[0] ^= 1; assert.throws(() => decodeMapAreas(bad), /header/);
    const duplicate = Buffer.from(bytes); duplicate.writeUInt32LE(0x8ff85141, 4); assert.throws(() => decodeMapAreas(duplicate), /key/);
});
