const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parse } = require('./cli');
const { publish, putJSON, digest } = require('./storage');

test('CLI validates commands and values; all expands only implemented extractors', () => {
    assert.equal(parse([]).command, 'help');
    assert.throws(() => parse(['delete']), /Unknown command/);
    assert.throws(() => parse(['prepare', '--cache']), /Missing value/);
    assert.throws(() => parse(['prepare', '--unknown', 'x']), /Unknown option/);
    const { options } = parse(['prepare', '--source', 'source', '--folders', 'all', '--languages', 'CHS,EN', '--no-versions']);
    assert(options.folders.includes('characters'));
    assert(!options.folders.includes('elements'));
    assert.equal(options.versions, false);
    assert.deepEqual(options.languages, ['CHS', 'EN']);
});
test('read-only inspect and verify emit bounded JSON without source input or cache writes', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'genshin-cli-test-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const snapshot = publish(root, { 'English/misc/a.json': { hash: putJSON(root, { id: 1, name: 'One' }), id: 1 },
        'dependencies/misc.json': { hash: putJSON(root, { a: ['11'] }) } }, { key: digest('cli'), versionMethod: 'disabled' });
    const current = fs.readFileSync(path.join(root, 'current.json'), 'utf8');
    for (const command of ['inspect', 'verify']) {
        const output = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, 'cli.js'), command, '--cache', root], { encoding: 'utf8' }));
        assert.equal(output.snapshotId, snapshot.snapshotId);
        assert.deepEqual(output.catalog, [{ language: 'English', folder: 'misc', count: 1 }]);
        assert.equal(output.changes.added, 2);
        assert.equal(output.verified, command === 'verify');
    }
    assert.equal(fs.readFileSync(path.join(root, 'current.json'), 'utf8'), current);
    assert.equal(fs.existsSync(path.join(root, 'prepare.lock')), false);
});
