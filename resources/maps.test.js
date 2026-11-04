const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildCache, readResourceCache, publicId } = require('./maps');
const digest = file => { const b = fs.readFileSync(file); return { file, bytes: b.length, sha256: crypto.createHash('sha256').update(b).digest('hex') }; };
function fixture(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'map-resources-test-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const write = (name, value) => { const file = path.join(dir, name); fs.writeFileSync(file, Buffer.isBuffer(value) ? value : JSON.stringify(value)); return file; };
    const source = write('source.blk', Buffer.from('synthetic'));
    const entry = { Source: source, Offset: 10, Type: 'GameObject', PathID: '-9007199254740999', Name: '' };
    const b = Buffer.alloc(15); // components=0, layer=0, name empty, tag=0, active=1
    b[14] = 1;
    const data = write('raw.bin', b);
    const metadata = { format: 'serialized', bytes: b.length, entry, serializedFile: { name: 'CAB-11111111111111111111111111111111', unityVersion: '2017.4.30f1\n2', formatVersion: 17, endianness: 0, targetPlatform: 'StandaloneWindows64', externals: [] } };
    const meta = write('metadata.json', metadata);
    const report = write('raw-report.json', { kind: 'raw', format: 'serialized', status: 'complete', inputs: [digest(source)], entries: [entry], resources: [{ ...entry, ...digest(data), metadata: digest(meta) }] });
    const inventory = write('inventory.json', { schema: 1, files: [{ Source: source, Offset: 10, metadata: metadata.serializedFile, objects: [{ Type: entry.Type, PathID: entry.PathID, classID: 1, byteStart: '0', bytes: b.length }] }] });
    const inspection = write('inspection.json', { kind: 'inventory', status: 'complete', inputs: [digest(source)], inventory: digest(inventory) });
    return { dir, data, source, report, inspection, output: path.join(dir, 'cache.json') };
}
test('map manifest verifies source, extraction metadata and raw object identity', t => {
    const f = fixture(t), cache = buildCache({ reports: [f.report], inventories: [f.inspection], output: f.output });
    assert.equal(cache.objects.length, 1);
    assert.equal(cache.objects[0].entry.PathID, '-9007199254740999');
    assert.equal(cache.objects[0].decoded.active, true);
    assert.equal(readResourceCache(f.output).objects.length, 1);
    fs.appendFileSync(f.data, 'changed');
    assert.throws(() => readResourceCache(f.output), /Stale map resource/);
});
test('public resource IDs survive installation moves and preserve exact object identity', () => {
    const entry = { Source: 'D:\\game\\blocks\\00\\01234567.blk', Offset: 100, Type: 'Sprite', PathID: '-9007199254740999' };
    assert.equal(publicId(entry), publicId({ ...entry, Source: '/another-installation/blocks/01234567.BLK' }));
    assert.notEqual(publicId(entry), publicId({ ...entry, Offset: 101 }));
    assert.notEqual(publicId(entry), publicId({ ...entry, Type: 'Texture2D' }));
    assert.notEqual(publicId(entry), publicId({ ...entry, PathID: '-9007199254740998' }));
});
test('same block basename at different source paths is explicitly ambiguous', t => {
    const first = fixture(t), second = fixture(t);
    assert.throws(() => buildCache({ reports: [first.report, second.report], inventories: [first.inspection, second.inspection], output: first.output }), /Ambiguous map source basename/);
    assert(!fs.existsSync(first.output));
});
test('stale input cannot create a usable map cache', t => {
    const f = fixture(t);
    fs.appendFileSync(f.source, 'changed');
    assert.throws(() => buildCache({ reports: [f.report], inventories: [f.inspection], output: f.output }), /Stale map resource/);
    assert(!fs.existsSync(f.output));
});
test('failed extraction report cannot create a usable map cache', t => {
    const f = fixture(t), report = JSON.parse(fs.readFileSync(f.report));
    report.status = 'failed'; fs.writeFileSync(f.report, JSON.stringify(report));
    assert.throws(() => buildCache({ reports: [f.report], inventories: [f.inspection], output: f.output }));
    assert(!fs.existsSync(f.output));
});
test('parser reports unsupported Unity layout and does not invent object fields', t => {
    const f = fixture(t), report = JSON.parse(fs.readFileSync(f.report));
    const metadata = JSON.parse(fs.readFileSync(report.resources[0].metadata.file));
    metadata.serializedFile.unityVersion = 'other';
    fs.writeFileSync(report.resources[0].metadata.file, JSON.stringify(metadata));
    report.resources[0].metadata = digest(report.resources[0].metadata.file);
    fs.writeFileSync(f.report, JSON.stringify(report));
    const cache = buildCache({ reports: [f.report], inventories: [f.inspection], output: f.output });
    assert.equal(cache.objects[0].decoded, null);
    assert(cache.diagnostics.some(d => d.code === 'unsupported-layout'));
});
