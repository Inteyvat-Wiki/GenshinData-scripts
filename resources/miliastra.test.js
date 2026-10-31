const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseIndex, resolve } = require('./miliastra');
function fixture(keys = ['12062732331644947321']) {
    const chunks = [];
    const u32 = value => { const b = Buffer.alloc(4); b.writeUInt32LE(value); chunks.push(b); };
    u32(0); u32(keys.length);
    for (const key of keys) {
        const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(key)); chunks.push(b);
        chunks.push(Buffer.from([2, 0])); u32(42); chunks.push(Buffer.alloc(5));
    }
    u32(0); chunks.push(Buffer.alloc(8)); u32(0); u32(0); u32(0);
    u32(1); u32(12342470); u32(1); u32(42); u32(100); u32(20); u32(0);
    return Buffer.concat(chunks);
}
test('preserves all 64 bits and reads kind-2 extension', () => {
    const key = '12062732331644947321';
    assert.deepEqual(parseIndex(fixture(), new Set([key])).get(key).pack, { block: 12342470, offset: 100, size: 20 });
});
test('never aliases keys with the same middle 32 bits', () => {
    const key = '12062732331644947321';
    const alias = (BigInt(key) ^ (1n << 63n)).toString();
    assert.throws(() => parseIndex(fixture(), new Set([alias])), /not found/);
});
test('rejects duplicates, truncation, trailing bytes and unknown layout', () => {
    const key = '12062732331644947321', wanted = new Set([key]), b = fixture();
    assert.throws(() => parseIndex(fixture([key, key]), wanted), /Duplicate/);
    assert.throws(() => parseIndex(b.subarray(0, -1), wanted), /bounds/);
    assert.throws(() => parseIndex(Buffer.concat([b, Buffer.alloc(1)]), wanted), /trailing/);
    assert.throws(() => parseIndex(Buffer.from('not an index'), wanted), /bounds/);
});
test('requires exact block/offset before checking Container; rejects ambiguities', () => {
    const key = '12062732331644947321';
    const hits = parseIndex(fixture(), new Set([key]));
    const unrelated = { Source: '12342470.blk', Offset: 101, Container: '620777739', Type: 'Sprite', Name: 'UI_Wrong', PathID: '1' };
    assert.throws(() => resolve(hits, [unrelated]), /missing image/);
    const samePack = { ...unrelated, Offset: 100 };
    assert.throws(() => resolve(hits, [samePack, { ...samePack, PathID: '2' }]), /Ambiguous/);
    assert.throws(() => resolve(hits, [{ ...samePack, Container: '0' }]), /missing image/);
});
