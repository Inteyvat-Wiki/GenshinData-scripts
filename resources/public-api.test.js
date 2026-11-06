const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const fs = require('node:fs');

test('unified resource API delegates exact plans and reports each actual output cache path', () => {
    const calls = [], exported = {};
    const stub = file => new Proxy({}, { get: (_, method) => (...args) => {
        calls.push({ file, method, args });
        return file === './map-fog' ? { schema: 1 } : { file: 'prepared.json' };
    } });
    vm.runInNewContext(fs.readFileSync(require.resolve('./index'), 'utf8'), { exports: exported, require(file) {
        if (file === 'node:path') return path;
        if (file === '../runtime-paths') return require('../runtime-paths');
        return stub(file);
    } });
    assert.throws(() => exported.prepare('lua', {}), /Unsupported resource kind/);
    assert.throws(() => exported.prepare('maps', {}), /explicit new output path/);
    assert.equal(Object.isFrozen(exported.supportedKinds), true);
    const cases = {
        worldAreas: ['./world-areas', 'prepare'], mapAreaConfigs: ['./map-area-configs', 'prepare'],
        mapIcons: ['./map-icons', 'prepare'], maps: ['./maps', 'prepare'], mapAtlas: ['./map-atlas', 'prepareAtlas'],
        mapEntries: ['./map-entries', 'prepare'], mapBase: ['./map-base', 'prepare'], mapFog: ['./map-fog', 'prepare'],
        mapLimitOutlines: ['./map-limit-outlines', 'prepare'], mapEffects: ['./map-effects', 'prepare'],
        levelTags: ['./level-tag-groups', 'buildCache'], miliastra: ['./miliastra', 'prepare'],
        profileFrames: ['./profile-frames', 'prepare'], tcgPortraits: ['./prepare-tcg-portraits', 'prepare'],
        graeaeImages: ['./prepare-graeae-images', 'prepareGraeaeImages'], images: ['./extract-miliastra-images', 'run'],
    };
    for (const [kind, [file, method]] of Object.entries(cases)) {
        const plan = { sourceRoot: 'source', index: 'explicit-index', mapFile: 'exported-map.json', map: 'client.map',
            output: 'new-output', studio: 'studio', dotnet: 'explicit-dotnet', game: 'GI', timeoutMs: 123, sceneIds: [123], sources: ['explicit.blk'], roots: [{ PathID: '9223372036854775807' }], cacheFile: 'input-cache.json' };
        const result = exported.prepare(kind, plan), call = calls.at(-1);
        assert.equal(result.kind, kind);
        assert.equal(call.file, file); assert.equal(call.method, method);
        if (['miliastra', 'profileFrames'].includes(kind)) assert.deepEqual(Array.from(call.args.slice(0, 4)), [plan.index, plan.mapFile, plan.output, plan.sourceRoot]);
        else if (['tcgPortraits', 'graeaeImages'].includes(kind)) assert.deepEqual(Array.from(call.args), [plan.sourceRoot, plan.mapFile, plan.output]);
        else if (kind === 'images') {
            assert.deepEqual(Array.from(call.args.slice(0, 3)), [plan.cacheFile, plan.output, plan.studio]);
            assert.equal(call.args[3].dotnet, plan.dotnet);
            assert.equal(call.args[3].game, plan.game);
            assert.equal(call.args[3].timeoutMs, plan.timeoutMs);
        }
        else {
            assert.equal(call.args[0].roots, plan.roots);
            assert.equal(call.args[0].sceneIds, plan.sceneIds);
            assert.equal(call.args[0].map, plan.map);
            assert.equal(call.args[0].dotnet, plan.dotnet);
        }
        const expected = ['miliastra', 'profileFrames', 'tcgPortraits', 'graeaeImages', 'levelTags'].includes(kind) ? plan.output
            : kind === 'images' ? path.join(plan.output, 'extraction-report.json')
            : kind === 'mapFog' ? path.join(plan.output, 'map-fog.json') : 'prepared.json';
        assert.equal(result.cachePath, path.resolve(expected));
    }
});

test('profile frame public preparer uses only the established profile table and icon field', () => {
    let received;
    const context = { module: { exports: {} }, require(name) {
        if (name === './miliastra') return { prepare: (...args) => { received = args; return { output: args[2] }; }, createResourceLookup: () => () => {} };
        return require(name);
    } };
    vm.runInNewContext(fs.readFileSync(require.resolve('./profile-frames'), 'utf8'), context);
    context.module.exports.prepare('index', 'map', 'output', 'source');
    assert.deepEqual(Array.from(received.slice(0, 4)), ['index', 'map', 'output', 'source']);
    assert.equal(JSON.stringify(received[4]), JSON.stringify([{ table: 'ProfileFrameExcelConfigData', field: 'iconPathHash' }]));
});

test('every native bridge call explicitly forwards the configured dotnet host', () => {
    let count = 0;
    for (const file of ['world-areas', 'map-area-configs', 'map-icons', 'map-atlas', 'map-entries', 'map-base', 'map-fog', 'map-limit-outlines', 'maps']) {
        const source = fs.readFileSync(require.resolve('./' + file), 'utf8');
        const calls = source.matchAll(/(?:tools|resources)\.(readAssetMap|inspectResourceFiles|extractRawResources|extractResources|extractSpriteResources|extractMeshResources)\(\{([\s\S]*?)\}\)/g);
        for (const [, method, argumentsText] of calls) {
            count++;
            assert.match(argumentsText, /\bdotnet\b/, `${file}.${method} drops dotnet`);
        }
    }
    assert(count >= 30, 'Expected to check every bridge call site');
});

test('image extraction passes explicit runtime, game and timeout without changing process env', () => {
    let called;
    const context = { module: { exports: {} }, require(name) {
        if (name === 'node:fs') return { constants: { COPYFILE_EXCL: 1 }, copyFileSync() {} };
        if (name === './miliastra') return { readResourceCache: () => ({ resources: { a: { image: { PathID: '9223372036854775807' } } } }) };
        if (name === '@inteyvat-wiki/resource-tools') return { extractResources: options => { called = options; return {}; } };
        return require(name);
    } };
    vm.runInNewContext(fs.readFileSync(require.resolve('./extract-miliastra-images'), 'utf8'), context);
    const before = JSON.stringify(process.env);
    context.module.exports.run('cache', 'output', 'studio', { dotnet: 'explicit-dotnet', game: 'GI', timeoutMs: 456 });
    assert.equal(called.dotnet, 'explicit-dotnet');
    assert.equal(called.game, 'GI');
    assert.equal(called.timeoutMs, 456);
    assert.equal(called.entries[0].PathID, '9223372036854775807');
    assert.equal(JSON.stringify(process.env) === before, true, 'Image preparation must not mutate process.env');
});
