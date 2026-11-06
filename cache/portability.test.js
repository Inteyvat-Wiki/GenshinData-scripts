const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const child = require('node:child_process');

const project = path.resolve(__dirname, '..');
function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'genshin-portable-test-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    return root;
}
function env(extra = {}) {
    const values = { ...process.env };
    for (const key of Object.keys(values)) if (/^(GENSHIN_|MAP_.*RESOURCE_CACHE$|MILIASTRA_RESOURCE_CACHE$|PROFILE_FRAME_RESOURCE_CACHE$)/.test(key)) delete values[key];
    return { ...values, ...extra };
}
function run(script, extra = {}) {
    return child.execFileSync(process.execPath, ['-e', script], { cwd: project, encoding: 'utf8', env: env(extra), windowsHide: true });
}

test('public imports are read-only and never discover package-local config or resource inputs', () => {
    run(`const fs = require('node:fs'), assert = require('node:assert/strict');
        const original = fs.readFileSync;
        fs.readFileSync = function(file, ...args) {
            const value = String(file).replaceAll('\\\\', '/');
            if (/\\/config\\.json$|\\/\\.cache\\//.test(value)) throw new Error('Implicit input read: ' + value);
            return original.call(this, file, ...args);
        };
        for (const name of ['mkdirSync', 'writeFileSync', 'renameSync']) fs[name] = () => { throw new Error('Write on import'); };
        const api = require('@inteyvat-wiki/genshin-data-scripts');
        const resources = require('@inteyvat-wiki/genshin-data-scripts/resources');
        assert.equal(api.resources, resources);
        assert(resources.supportedKinds.includes('profileFrames'));
        assert(!Object.keys(require.cache).some(file => file.includes('resource-tools')));`);
});

test('no sourceRoot fails before creating cache; explicit env and legacy config stay opt-in', t => {
    const root = fixture(t), cache = path.join(root, 'cache');
    run(`const assert = require('node:assert/strict');
        require('./index').prepare({ folders: ['misc'], versions: false, cacheRoot: ${JSON.stringify(cache)} })
            .then(() => { throw new Error('Expected missing source'); }, error => assert.match(error.message, /sourceRoot is required/));`);
    assert.equal(fs.existsSync(cache), false);
    const config = path.join(root, 'legacy.json');
    fs.writeFileSync(config, JSON.stringify({ GenshinData_folder: root, textmap_history_refs: ['older', 'HEAD'], Lua_folder: path.join(root, 'old-lua') }));
    const check = `const paths = require('./runtime-paths'), config = require('./runtime-config');
        console.log(JSON.stringify({ source: paths.sourceDirectory(), refs: config.textmap_history_refs, lua: paths.luaDirectory() }));`;
    const legacy = JSON.parse(run(check, { GENSHIN_DATA_CONFIG: config }));
    assert.equal(legacy.source, root);
    assert.deepEqual(legacy.refs, ['older', 'HEAD']);
    assert.equal(legacy.lua, path.join(root, 'old-lua'));
    const explicit = JSON.parse(run(check, { GENSHIN_DATA_CONFIG: config, GENSHIN_DATA_SOURCE: path.join(root, 'other') }));
    assert.equal(explicit.source, path.join(root, 'other'));
});

test('Lua, resource and history defaults follow external user cache roots', t => {
    const root = fixture(t);
    const values = JSON.parse(run(`const api = require('./index'), paths = require('./runtime-paths');
        console.log(JSON.stringify({ cache: api.cacheDirectory(), lua: paths.luaDirectory(),
            resources: Object.fromEntries(Object.keys(paths.resourcePaths).map(key => [key, api.resources.cachePath(key)])),
            history: require('./versions/textmap').cachePaths({}).directory }));`, { GENSHIN_DATA_CACHE: root }));
    assert.equal(values.cache, root);
    assert.equal(values.lua, path.join(root, 'lua'));
    assert.equal(values.resources.worldAreas, path.join(root, 'resources/world-areas.json'));
    assert.equal(values.resources.profileFrames, path.join(root, 'resources/profile-frame-resources.json'));
    assert.equal(values.history, path.join(root, 'history/textmap-versions-chs-en'));
    assert.equal(fs.readdirSync(root).length, 0);
    const defaults = JSON.parse(run(`const paths = require('./runtime-paths'); console.log(JSON.stringify({ cache: require('./index').cacheDirectory(), lua: paths.luaDirectory() }));`));
    assert.equal(defaults.lua, path.join(defaults.cache, 'lua'));
    assert(!defaults.cache.startsWith(project));
});

test('missing Lua and mandatory resource caches identify the external path and corrective option', t => {
    const root = fixture(t), source = path.join(root, 'source'), cache = path.join(root, 'cache');
    fs.mkdirSync(path.join(source, 'ExcelBinOutput'), { recursive: true });
    fs.writeFileSync(path.join(source, 'ExcelBinOutput/ProfileFrameExcelConfigData.json'), '[]');
    const git = (...args) => child.execFileSync('git', ['-c', `safe.directory=${source.replaceAll('\\', '/')}`, '-c', 'commit.gpgsign=false', '-C', source, ...args], { encoding: 'utf8', windowsHide: true });
    git('init', '-q'); git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', '1.0.0');
    for (const [folder, option, suffix] of [['tasksubtitles', 'luaRoot', 'lua'], ['misc', 'resourceCaches.profileFrames', 'resources/profile-frame-resources.json'], ['maps', 'resourceCaches.worldAreas', 'resources/world-areas.json']]) {
        run(`const assert = require('node:assert/strict');
            require('./index').prepare({ sourceRoot: ${JSON.stringify(source)}, cacheRoot: ${JSON.stringify(cache)}, folders: [${JSON.stringify(folder)}], versions: false })
                .then(() => { throw new Error('Expected missing input'); }, error => {
                    assert(error.message.includes(${JSON.stringify(option)}), error.message);
                    assert(error.message.includes(${JSON.stringify(path.join(cache, suffix))}), error.message);
                });`);
        assert.equal(fs.existsSync(path.join(cache, 'prepare.lock')), false);
    }
});
