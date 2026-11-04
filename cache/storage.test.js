const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { digest, publish, putJSON, openSnapshot, captureDirectory, atomicJSON } = require('./storage');
const { recalculateVersions } = require('./versions');
const tracking = require('../versions/tracking');

function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'genshin-cache-test-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    return directory;
}
function plan(key = 'one') { return { key: digest(key), extractKey: 'same-inputs', folders: ['misc'], languages: ['CHS', 'EN'] }; }
function records(root, data = { id: 1, name: 'A' }) {
    return { 'English/misc/a.json': { hash: putJSON(root, data), id: data.id },
        'dependencies/misc.json': { hash: putJSON(root, { a: ['11', '12'] }) },
        'version/misc.json': { hash: putJSON(root, { a: '1.x' }) } };
}
test('provider import does not execute the extraction entry point', () => {
    const api = require('..');
    assert.equal(typeof api.prepare, 'function');
    assert.equal(typeof api.openSnapshot, 'function');
    assert.equal(require.cache[require.resolve('../main')], undefined);
    assert.equal(require.cache[require.resolve('../extract/global')], undefined);
});
test('immutable snapshots support IDs, iteration, changes and defensive manifests', t => {
    const root = fixture(t), first = publish(root, records(root), plan());
    assert.equal(first.getRecord('English', 'misc', 1).name, 'A');
    assert.deepEqual([...first.entries('English', 'misc')].map(item => item.key), ['a']);
    first.manifest().files['English/misc/a.json'].hash = 'bad';
    first.getRecord('English', 'misc', 'a').name = 'mutated';
    assert.equal(first.getRecord('English', 'misc', 'a').name, 'A');
    const second = publish(root, records(root, { id: 1, name: 'B' }), plan('two'), first);
    assert.equal(openSnapshot({ cacheRoot: root }).snapshotId, second.snapshotId);
    assert.equal(first.getRecord('English', 'misc', 1).name, 'A');
    assert.deepEqual(second.manifest().changes.modified, ['English/misc/a.json']);
    assert.throws(() => second.getRecord('English', 'misc', '../a'), /Invalid cache key/);
});
test('corrupt records fail loudly and content-addressed writes can repair them', t => {
    const root = fixture(t), snapshot = publish(root, records(root), plan());
    const hash = snapshot.manifest().files['English/misc/a.json'].hash;
    const file = path.join(root, 'objects', hash.slice(0, 2), hash + '.json');
    fs.writeFileSync(file, '{}');
    assert.throws(() => snapshot.getRecord('English', 'misc', 1), /Corrupt/);
    putJSON(root, { id: 1, name: 'A' });
    assert.equal(snapshot.verify(), true);
    fs.writeFileSync(path.join(root, 'snapshots', snapshot.snapshotId + '.json'), '{}');
    assert.throws(() => openSnapshot({ cacheRoot: root }), /Invalid snapshot manifest/);
    assert.equal(publish(root, records(root), plan()).snapshotId, snapshot.snapshotId);
});
test('version-only recalculation preserves payloads and old readers; missing hashes do not publish', t => {
    const root = fixture(t), first = publish(root, records(root), plan());
    const next = recalculateVersions(root, first, { 11: '3.0', 12: '4.0' }, plan('two'));
    assert.equal(next.getAuxiliary('version', 'misc', 'a'), '3.0');
    assert.equal(first.getAuxiliary('version', 'misc', 'a'), '1.x');
    assert.equal(next.manifest().files['English/misc/a.json'].hash, first.manifest().files['English/misc/a.json'].hash);
    assert.throws(() => recalculateVersions(root, next, { 11: '3.0' }, plan('three')), /missing.*12/);
    assert.equal(openSnapshot({ cacheRoot: root }).snapshotId, next.snapshotId);
});
test('dependencies persist as plain metadata and same-path version changes invalidate memory cache', t => {
    const root = fixture(t), data = { a: { name: 'A' } }, deps = {};
    tracking.attach(data.a, new Set(['11', '12']));
    tracking.accumulateDependencies(deps, data);
    tracking.writeDependencies('misc', deps, { genshin_output_folder: root, genshin_export_folder: root });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'dependencies/misc.json'))), { a: ['11', '12'] });
    const config = { textmap_version_cache: root };
    fs.writeFileSync(path.join(root, 'hashes.json'), '{"11":"3.0"}');
    assert.equal(tracking.loadVersions(config)[11], '3.0');
    // The history builder replaces this file atomically rather than editing it in place.
    atomicJSON(path.join(root, 'hashes.json'), { 11: '4.0' });
    assert.equal(tracking.loadVersions(config)[11], '4.0');
});
test('capture rejects malformed JSON without replacing current; deleted records are tracked', t => {
    const root = fixture(t), first = publish(root, records(root), plan());
    const directory = path.join(root, 'export'); fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'broken.json'), '{');
    assert.throws(() => captureDirectory(root, directory, plan('two'), first));
    assert.equal(openSnapshot({ cacheRoot: root }).snapshotId, first.snapshotId);
    const files = records(root); delete files['English/misc/a.json'];
    const next = publish(root, files, plan('two'), first);
    assert.deepEqual(next.manifest().changes.removed, ['English/misc/a.json']);
});
