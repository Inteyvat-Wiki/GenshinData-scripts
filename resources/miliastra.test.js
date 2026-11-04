const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseIndex, resolve } = require('./miliastra');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
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

test('prepare uses input-scoped icon inference, preserves exact UInt64 hashes and accepts empty tables', () => {
    const keys = ['3806693058812336722', '14425841620430768778'];
    let rows, written;
    const source = path.resolve('memory-source');
    const mapBytes = Buffer.from('fixture asset map');
    const sha256 = crypto.createHash('sha256').update(mapBytes).digest('hex');
    const map = { map: 'asset-map', sha256, entries: keys.map((key, i) => ({
        Source: '12342470.blk', Offset: 100, Container: BigInt.asIntN(32, BigInt(key) >> 8n).toString(),
        Type: 'Sprite', Name: `UI_Exact_${i}`, PathID: String(i),
    })) };
    const memoryFs = {
        readFileSync(file) {
            if (file === 'asset-map') return mapBytes;
            if (file === 'image-map') return JSON.stringify(map);
            if (file === 'index') return fixture(keys);
            if (file === path.join(source, 'ExcelBinOutput/BeyondCostumeExcelConfigData.json')) return JSON.stringify(rows);
            if (file.startsWith(source + path.sep)) return '[]';
            throw new Error(`Unexpected test input: ${file}`);
        },
        statSync: () => ({ size: 120 }), mkdirSync: () => {},
        writeFileSync: (file, value, options) => { assert.equal(options.flag, 'wx'); written = JSON.parse(value); },
    };
    const context = { module: { exports: {} }, require(name) {
        if (name === 'node:fs') return memoryFs;
        if (name === '../extract/archives/fields') return require('../extract/archives/fields');
        return require(name);
    } };
    vm.runInNewContext(fs.readFileSync(require.resolve('./miliastra'), 'utf8'), context);
    const prepare = context.module.exports.prepare;
    for (const field of ['arbitraryResourceA', 'arbitraryResourceB']) {
        rows = keys.map((hash, i) => ({ costumeId: 260001 + i, [field]: hash }));
        assert.equal(prepare('index', 'image-map', 'new-cache', source).keys, 2);
        assert.deepEqual(Object.keys(written.resources).sort(), [...keys].sort());
        assert.equal(written.resources[keys[1]].image.Name, 'UI_Exact_1');
    }
    rows = [{ costumeId: 260001, unknown: keys[0] }];
    assert.throws(() => prepare('index', 'image-map', 'new-cache', source), /missing witness/);
    rows = keys.map((hash, i) => ({ costumeId: 260001 + i, first: hash, second: hash }));
    assert.throws(() => prepare('index', 'image-map', 'new-cache', source), /ambiguous/);
    rows = [];
    assert.equal(prepare('index', 'image-map', 'new-cache', source).keys, 0);
    assert.deepEqual(written.resources, {});
});
