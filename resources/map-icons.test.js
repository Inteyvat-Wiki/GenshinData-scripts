const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { crc32, validatePng } = require('@inteyvat-wiki/resource-tools');
const { references, selectEntries, buildCache, readResourceCache, attachImages } = require('./map-icons');
const digest = file => ({ file, bytes: fs.statSync(file).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') });
function records() {
    return {
        'point-3-201': { id: 'point-3-201', kind: 'point', data: { icon: 'UntrustedFallback' }, relations: [{ role: 'map_icon', category: 'maps', id: 'map-icon-Test' }] },
        'map-icon-Test': { id: 'map-icon-Test', kind: 'map_icon', data: { icon: 'UI_Test' }, diagnostics: [] },
        'map-icon-Other': { id: 'map-icon-Other', kind: 'map_icon', data: { icon: 'UI_Other' }, diagnostics: [] },
    };
}
function png() {
    const chunk = (type, bytes) => { const raw = Buffer.concat([Buffer.from(type), bytes]), result = Buffer.alloc(raw.length + 8);
        result.writeUInt32BE(bytes.length); raw.copy(result, 4); result.writeUInt32BE(crc32(raw), result.length - 4); return result; };
    const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
    return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(Buffer.from([0,255,255,255,255]))), chunk('IEND', Buffer.alloc(0))]);
}
function fixture(t, origin = 'CAB-exact') {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'map-icon-test-'));
    t.after(() => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); fs.rmSync(root, { recursive: true, force: true }); });
    const write = (name, value) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, Buffer.isBuffer(value) ? value : JSON.stringify(value)); return file; };
    const source = write('source.blk', Buffer.from('source'));
    const entry = { Name: 'UI_Test', Type: 'Sprite', PathID: '-9007199254740999', Source: source, Offset: 10 };
    const assetMap = write('source.map', Buffer.from('map'));
    const mapFile = write('map.json', { map: assetMap, sha256: digest(assetMap).sha256, entries: [entry] });
    const selectionFile = write('selection.json', { names: ['UI_Test'], references: references(records()), inputs: [digest(source)] });
    const raw = write('sprite.bin', Buffer.from('sprite'));
    const metadata = write('metadata.json', { entry, serializedFile: { name: 'CAB-exact' } });
    const rawReportFile = write('raw-report.json', { kind: 'raw', format: 'serialized', status: 'complete', inputs: [digest(source)],
        resources: [{ ...entry, ...digest(raw), metadata: digest(metadata) }] });
    const image = write(`source.blk_export/${origin}/UI_Test.png`, png());
    const item = { name: 'UI_Test', file: image, ...validatePng(fs.readFileSync(image)) };
    const imageReportFile = write('images-report.json', { kind: 'images', status: 'complete', selection: 'preserve', inputs: [digest(source), digest(assetMap)],
        batches: [{ entries: [entry], validation: { candidates: [{ name: 'UI_Test', images: [item] }] } }] });
    return { selectionFile, mapFile, rawReportFile, imageReportFile, output: path.join(root, 'cache.json'), image, source };
}
test('only explicit point-to-icon links request resources; unrelated definitions are not extracted', () => {
    assert.deepEqual(references(records()), [{ point: 'point-3-201', record: 'map-icon-Test', name: 'UI_Test' }]);
    const broken = records(); delete broken['map-icon-Test']; assert.throws(() => references(broken), /Missing referenced/);
});
test('cache CLI keeps map icon resources as a separate explicit input', () => {
    const { options } = require('../cache/cli').parse(['prepare', '--folders', 'maps', '--map-icon-resources', 'icons.json', '--map-resources', 'atlas.json']);
    assert.deepEqual(options.resourceCaches, { mapIcons: 'icons.json', maps: 'atlas.json' });
});
test('exact name resolution rejects ambiguous offsets and missing assets', () => {
    const entry = { Name: 'UI_Test', Type: 'Sprite', Source: 'x', Offset: 10, PathID: '1' };
    assert.equal(selectEntries(['UI_Test'], [entry, { ...entry, Type: 'Texture2D' }]).selected[0].Type, 'Sprite');
    const ambiguous = selectEntries(['UI_Test', 'UI_Missing'], [entry, { ...entry, Offset: 20 }]);
    assert.equal(ambiguous.selected.length, 0);
    assert.deepEqual(ambiguous.diagnostics.map(d => d.code), ['ambiguous-image', 'missing-image']);
});
test('exact serialized origin and PNG identity form the reusable icon cache', t => {
    const fixtureData = fixture(t), cache = buildCache(fixtureData);
    const inputs = new Set(cache.inputs.map(input => path.resolve(input.file)));
    for (const name of ['../extract/maps/schema', '../extract/field-inference'])
        assert(inputs.has(require.resolve(name)), `Missing field inference dependency: ${name}`);
    assert.equal(cache.resources.UI_Test.entry.PathID, '-9007199254740999');
    assert.equal(readResourceCache(fixtureData.output).resources.UI_Test.image.width, 1);
    const output = records(); attachImages(output, cache);
    assert.equal(output['map-icon-Test'].data.image_file, fixtureData.image);
    assert.equal(output['map-icon-Other'].data.image_file, undefined);
    assert.equal(output['point-3-201'].data.image_file, undefined);
    fs.appendFileSync(fixtureData.image, 'changed');
    assert.throws(() => readResourceCache(fixtureData.output), /Stale map icon input/);
});
test('same-name PNG from a different serialized CAB is withheld', t => {
    const cache = buildCache(fixture(t, 'CAB-other'));
    assert.equal(cache.resources.UI_Test, undefined);
    assert.equal(cache.diagnostics[0].code, 'image-origin-mismatch');
    const output = records(); attachImages(output, cache);
    assert.deepEqual(output['map-icon-Test'].diagnostics, ['map_icon_image_unresolved:UI_Test']);
});
test('stale source cannot be turned into a valid icon cache', t => {
    const f = fixture(t); fs.appendFileSync(f.source, 'changed');
    assert.throws(() => buildCache(f), /Stale map icon input/);
    assert(!fs.existsSync(f.output));
});
