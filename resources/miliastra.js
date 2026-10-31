const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const schema = 1;
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const tables = ['BeyondCostumeExcelConfigData', 'BeyondCostumeSuitExcelConfigData', 'BeyondCostumeDrawingExcelConfigData'];

// The eight bytes form ONE little-endian UInt64 key, not a 32-bit Container.
// This layout is snapshot-specific: bounds and exact EOF reject other formats.
function parseIndex(buffer, wanted) {
    let p = 0;
    function skip(n) { assert(Number.isSafeInteger(n) && n >= 0 && p + n <= buffer.length, `Resource index bounds at ${p}`); p += n; }
    function u32() { const start = p; skip(4); return buffer.readUInt32LE(start); }
    const types = u32();
    for (let i = 0; i < types; i++) for (let j = 0; j < 2; j++) { const n = u32(); skip(n); }
    const count = u32(), hits = new Map();
    for (let i = 0; i < count; i++) {
        const byteOffset = p; skip(8); const key = buffer.readBigUInt64LE(byteOffset).toString();
        skip(2); const kind = buffer[p - 2], flag = buffer[p - 1], subAssetId = u32();
        if (kind === 2) skip(5);
        if (wanted.has(key)) {
            assert(!hits.has(key), `Duplicate full resource key ${key}`);
            hits.set(key, { key, index: i, byteOffset, kind, flag, subAssetId });
        }
    }
    const dependencies = u32(); skip(8);
    for (let i = 0; i < dependencies; i++) { u32(); const n = u32(); skip(n * 4); }
    for (let i = 0; i < 2; i++) { const n = u32(); skip(n * 4); }
    const groups = u32();
    for (let i = 0; i < groups; i++) { u32(); const n = u32(); skip(n * 6); }
    const required = new Set([...hits.values()].map(hit => hit.subAssetId)), blocks = new Map();
    const blockCount = u32();
    for (let i = 0; i < blockCount; i++) {
        const block = u32(), n = u32();
        for (let j = 0; j < n; j++) {
            const id = u32(), offset = u32(), size = u32();
            if (required.has(id)) {
                assert(!blocks.has(id), `Duplicate subasset ${id}`);
                blocks.set(id, { block, offset, size });
            }
        }
    }
    const tail = u32(); skip(tail * 4); assert.equal(p, buffer.length, 'Resource index trailing bytes');
    for (const key of wanted) {
        const hit = hits.get(key); assert(hit, `Resource key not found: ${key}`);
        assert(blocks.has(hit.subAssetId), `Missing block for ${key}`);
        hit.pack = blocks.get(hit.subAssetId);
    }
    return hits;
}

function resolve(hits, entries) {
    const packs = new Map();
    for (const entry of entries) {
        if (!['Sprite', 'Texture2D'].includes(entry.Type)) continue;
        const block = /(?:^|[\\/])(\d+)\.blk$/i.exec(entry.Source)?.[1];
        if (!block) continue;
        const id = `${Number(block)}:${entry.Offset}`;
        if (!packs.has(id)) packs.set(id, []);
        packs.get(id).push(entry);
    }
    return Object.fromEntries([...hits].map(([key, hit]) => {
        const candidates = packs.get(`${hit.pack.block}:${hit.pack.offset}`) || [];
        // Container is only a consistency check AFTER exact 64-bit/pack lookup.
        const container = BigInt.asIntN(32, BigInt(key) >> 8n).toString();
        const images = candidates.filter(entry => entry.Container === container);
        const sprites = images.filter(entry => entry.Type === 'Sprite');
        const selected = sprites.length ? sprites : images.filter(entry => entry.Type === 'Texture2D');
        assert.equal(selected.length, 1, `Ambiguous/missing image for full key ${key}`);
        const image = selected[0];
        assert(/^UI_[A-Za-z0-9_]+$/.test(image.Name), `Unsafe resource name: ${image.Name}`);
        assert(/^-?\d+$/.test(image.PathID), 'PathID must be an exact decimal string');
        const stat = fs.statSync(image.Source);
        assert(hit.pack.offset + hit.pack.size <= stat.size, `Pack exceeds block: ${key}`);
        return [key, { ...hit, image }];
    }));
}

function prepare(index, mapFile, output, source, selections = tables.map((table, i) => ({ table, field: i === 0 ? 'MPFOEFGJKAE' : 'iconHash' }))) {
    const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
    assert.equal(digest(map.map), map.sha256, 'Asset map snapshot changed');
    const hashes = new Set();
    const inputs = selections.map(({ table, field }) => {
        const file = path.join(source, 'ExcelBinOutput', table + '.json');
        const rows = JSON.parse(fs.readFileSync(file, 'utf8'), (key, value, context) =>
            typeof value === 'number' && !Number.isSafeInteger(value) && context?.source ? context.source : value);
        for (const row of rows) {
            const value = row[field];
            assert(typeof value === 'string' || Number.isSafeInteger(value), `Imprecise hash in ${table}`);
            const hash = String(value);
            assert(/^\d+$/.test(hash) && BigInt(hash) <= 0xffffffffffffffffn, `Invalid exact hash in ${table}`);
            hashes.add(hash);
        }
        return { file, sha256: digest(file) };
    });
    const resources = resolve(parseIndex(fs.readFileSync(index), hashes), map.entries);
    const cache = { schema, inputs: [...inputs, { file: path.resolve(index), sha256: digest(index) },
        { file: map.map, sha256: map.sha256 }], resources };
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(cache, null, 2) + '\n', { flag: 'wx' });
    return { keys: hashes.size, images: Object.keys(resources).length, output };
}

function readResourceCache(file) {
    assert(fs.existsSync(file), `Prepare resource cache first: ${file}; see resources/README.md`);
    const cache = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(cache.schema, schema, 'Rebuild resource cache for current parser');
    for (const input of cache.inputs) assert.equal(digest(input.file), input.sha256, `Stale resource cache: ${input.file}`);
    return cache;
}
function createResourceLookup(filename) {
    let cache;
    return hash => {
        if (!cache) cache = readResourceCache(filename());
        assert(Object.hasOwn(cache.resources, hash), `Unresolved resource icon ${hash}`);
        return cache.resources[hash];
    };
}
const resourceIcon = createResourceLookup(() => process.env.MILIASTRA_RESOURCE_CACHE || path.resolve(__dirname, '../.cache/miliastra-resources.json'));
module.exports = { parseIndex, resolve, prepare, resourceIcon, readResourceCache, createResourceLookup };
if (require.main === module) {
    const [index, map, output, source] = process.argv.slice(2);
    assert(source, 'Usage: node resources/miliastra.js INDEX IMAGE_MAP_JSON CACHE_OUTPUT RAW_DATA');
    console.log(JSON.stringify(prepare(index, map, output, source)));
}
