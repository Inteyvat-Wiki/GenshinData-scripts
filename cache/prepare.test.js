const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const child = require('node:child_process');
const { EventEmitter } = require('node:events');
const realSpawn = child.spawn.bind(child);

test('preparation reuses verified snapshots, repairs missing blobs and retains current on failed extraction', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'genshin-prepare-test-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const source = path.join(root, 'source'); fs.mkdirSync(path.join(source, 'TextMap'), { recursive: true });
    const git = (...args) => child.execFileSync('git', ['-c', `safe.directory=${source.replaceAll('\\', '/')}`, '-c', 'commit.gpgsign=false', '-C', source, ...args], { encoding: 'utf8' });
    git('init', '-q');
    fs.writeFileSync(path.join(source, 'TextMap/TextMapEN.json'), '{}\n');
    git('add', 'TextMap'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', '1.4.0');
    let calls = 0, fail = false;
    t.mock.method(child, 'spawn', (command, args, options) => {
        if (command !== process.execPath) return realSpawn(command, args, options);
        calls++;
        const emitter = new EventEmitter();
        queueMicrotask(() => {
            if (fail) { emitter.emit('close', 1); return; }
            const config = JSON.parse(options.env.GENSHIN_DATA_RUNTIME_CONFIG);
            const folder = path.join(config.genshin_output_folder, 'English/misc');
            fs.mkdirSync(folder, { recursive: true });
            fs.writeFileSync(path.join(folder, 'one.json'), JSON.stringify({ id: 1, name: 'One' }));
            emitter.emit('close', 0);
        });
        return emitter;
    });
    const provider = require('./provider');
    const options = { sourceRoot: source, cacheRoot: path.join(root, 'cache'), folders: ['misc'], versions: false, log: () => {} };
    const first = await provider.prepare(options);
    assert.equal(calls, 1);
    assert.equal((await provider.prepare(options)).snapshotId, first.snapshotId);
    assert.equal(calls, 1);
    const hash = first.manifest().files['English/misc/one.json'].hash;
    fs.unlinkSync(path.join(options.cacheRoot, 'objects', hash.slice(0, 2), hash + '.json'));
    const repaired = await provider.prepare(options);
    assert.equal(calls, 2);
    assert.equal(repaired.getRecord('English', 'misc', 1).name, 'One');
    fail = true;
    await assert.rejects(provider.prepare({ ...options, force: true }), /Extraction failed/);
    assert.equal(provider.openSnapshot({ cacheRoot: options.cacheRoot }).snapshotId, repaired.snapshotId);
    assert.equal(fs.existsSync(path.join(options.cacheRoot, 'prepare.lock')), false);
    fs.writeFileSync(path.join(source, 'TextMap/TextMapEN.json'), '{"1":"dirty"}\n');
    await assert.rejects(provider.prepare(options), /uncommitted/);
    fs.mkdirSync(path.join(options.cacheRoot, 'prepare.lock'));
    await assert.rejects(provider.prepare(options), /locked/);
    assert.equal(fs.existsSync(path.join(options.cacheRoot, 'prepare.lock')), true);
});

test('pinned history ignores unrelated branches and recalculates versions without extracting unchanged bodies', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'genshin-history-cache-test-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const source = path.join(root, 'source'); fs.mkdirSync(path.join(source, 'TextMap'), { recursive: true });
    const git = (...args) => child.execFileSync('git', ['-c', `safe.directory=${source.replaceAll('\\', '/')}`, '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', '-C', source, ...args], { encoding: 'utf8' }).trim();
    git('init', '-q');
    function commit(version, data) {
        fs.writeFileSync(path.join(source, 'TextMap/TextMapEN.json'), JSON.stringify(data, null, 2) + '\n');
        git('add', 'TextMap'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', version);
    }
    commit('1.4.0', { 11: 'One' });
    const branch = git('branch', '--show-current');
    git('switch', '-qc', 'unrelated'); commit('9.0.0', { 11: 'Unrelated' }); git('switch', '-q', branch);
    let calls = 0;
    t.mock.method(child, 'spawn', (command, args, options) => {
        if (command !== process.execPath) return realSpawn(command, args, options);
        calls++;
        const emitter = new EventEmitter();
        queueMicrotask(() => {
            const config = JSON.parse(options.env.GENSHIN_DATA_RUNTIME_CONFIG), output = config.genshin_output_folder;
            const values = JSON.parse(fs.readFileSync(path.join(config.textmap_version_cache, 'hashes.json')));
            for (const [file, data] of Object.entries({ 'English/misc/one.json': { id: 1, name: 'One' },
                'dependencies/misc.json': { one: ['11'] }, 'version/misc.json': { one: values[11] } })) {
                fs.mkdirSync(path.dirname(path.join(output, file)), { recursive: true });
                fs.writeFileSync(path.join(output, file), JSON.stringify(data));
            }
            emitter.emit('close', 0);
        });
        return emitter;
    });
    const provider = require('./provider');
    const options = { sourceRoot: source, cacheRoot: path.join(root, 'cache'), folders: ['misc'], log: () => {} };
    const first = await provider.prepare(options);
    assert.equal(first.getAuxiliary('version', 'misc', 'one'), '1.x');
    commit('1.5.0', { 11: 'One', 12: 'One' });
    commit('1.6.0', { 11: 'One' });
    const second = await provider.prepare(options);
    assert.equal(calls, 1);
    assert.equal(second.getAuxiliary('version', 'misc', 'one'), '1.6');
    assert.equal(first.getAuxiliary('version', 'misc', 'one'), '1.x');
    assert.deepEqual(second.manifest().changes.modified, ['version/misc.json']);
});
