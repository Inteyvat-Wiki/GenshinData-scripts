const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const tools = require('@inteyvat-wiki/resource-tools');
const maps = require('./maps');
const { read, hash, verify, evidence } = require('./map-evidence');
const { decodeObject } = require('../extract/maps/unity');
const { decodeMapScript } = require('../extract/maps/base');
const { decodeSceneScript, sceneGroups } = require('../extract/maps/scene-entry');
const key = e => `${path.resolve(e.Source)}\0${e.Offset}\0${e.PathID}`;
const codeFiles = () => [__filename, require.resolve('./maps'), require.resolve('./map-evidence'),
    require.resolve('../extract/maps/scene-entry'), require.resolve('../extract/maps/unity'), require.resolve('../extract/maps/base')];
const expectedScript = (script, name) => script?.type === 'MonoScript' && script.className === name
    && script.namespace === 'MoleMole' && script.assembly === 'Assembly-CSharp.dll';

function linkEntries(rows, candidates, source) {
    const index = tools.createResourceIndex(source.inventory);
    const resolve = (object, pointer) => index.resolve({ ...object.entry, ...pointer });
    function typed(object, className) {
        const header = decodeObject(object.bytes, object.metadata);
        assert.equal(header.type, 'MonoBehaviour');
        const ref = resolve(object, header.script);
        assert.equal(ref.status, 'resolved', `Unresolved ${className} script: ${ref.status}`);
        const script = source.objects.get(key(ref.entry)); assert(script, `Missing ${className} script bytes`);
        assert(expectedScript(decodeObject(script.bytes, script.metadata), className), `Wrong ${className} MonoScript identity`);
        return header;
    }
    const origin = object => ({ ...object.entry, ...object.source });
    return sceneGroups(rows).map(group => {
        const result = { ...group };
        if (!group.scriptData) return { ...result, status: 'missing-script-data' };
        const matches = candidates.filter(e => e.Name === group.scriptData);
        if (matches.length !== 1) return { ...result, status: matches.length ? 'ambiguous-scene-script' : 'missing-scene-script', candidates: matches };
        const object = source.objects.get(key(matches[0]));
        if (!object) return { ...result, status: 'missing-scene-bytes', candidate: matches[0] };
        result.sceneSource = origin(object);
        try {
            typed(object, 'SceneScriptData');
            const config = decodeSceneScript(object.bytes, object.metadata);
            assert.equal(config.name, group.scriptData, 'SceneScriptData name mismatch');
            result.sceneConfig = config;
            const target = resolve(object, config.mapReference); result.mapReference = target;
            if (target.status === 'null') return { ...result, status: 'no-map-reference' };
            if (target.status !== 'resolved') return { ...result, status: 'unresolved-map-reference' };
            const map = source.objects.get(key(target.entry)); assert(map, 'Missing map reference target bytes');
            typed(map, 'MapScriptData');
            result.config = decodeMapScript(map.bytes); result.mapSource = origin(map);
            return { ...result, status: 'map-config' };
        } catch (error) { return { ...result, status: 'unsupported-entry', detail: error.message }; }
    });
}

function buildCache({ sceneTableFile, sceneMapFile, reportFiles, inventoryFiles, output }) {
    const e = evidence(), rows = e.file(sceneTableFile), candidates = e.file(sceneMapFile);
    const source = maps.loadSources(reportFiles, inventoryFiles);
    for (const input of source.inputs) e.remember(input);
    const entries = linkEntries(rows, candidates.entries, source);
    for (const file of codeFiles()) e.remember(hash(file));
    const cache = { schema: 1, parser: 'gi-scene-map-entries-7.1-v1', inputs: [...e.inputs.values()],
        plan: { sceneTableFile, sceneMapFile, reportFiles, inventoryFiles }, entries };
    if (output) fs.writeFileSync(output, JSON.stringify(cache, null, 2) + '\n', { flag: 'wx' });
    return cache;
}
function readResourceCache(file) {
    const cache = read(file); assert.equal(cache.schema, 1); assert.equal(cache.parser, 'gi-scene-map-entries-7.1-v1');
    for (const input of cache.inputs) verify(input);
    for (const file of codeFiles()) assert(cache.inputs.some(input => path.resolve(input.file) === file && input.sha256 === hash(file).sha256), 'Rebuild scene-map entry cache for current parser');
    assert.deepEqual(cache.entries, buildCache(cache.plan).entries); return cache;
}

function prepare({ data, sceneTableFile = path.join(data || '.', 'ExcelBinOutput/SceneExcelConfigData.json'), studio, map,
    output, maxSources = 32, maxObjects = 3000, timeoutMs = 180000 }) {
    const groups = sceneGroups(read(sceneTableFile));
    output = path.resolve(output); fs.mkdirSync(output);
    const sceneMapFile = path.join(output, 'scene-map.json');
    const candidates = tools.readAssetMap({ studio, map, output: sceneMapFile, types: ['MonoBehaviour'],
        names: groups.map(g => g.scriptData).filter(Boolean), timeoutMs });
    const roots = groups.flatMap(g => {
        const found = candidates.entries.filter(e => e.Name === g.scriptData); return found.length === 1 ? found : [];
    });
    assert(roots.length, 'No unique SceneScriptData candidates');
    const inventoryFiles = [], reportFiles = [], inspected = new Set(), extracted = new Set();
    let inventory = { schema: 1, files: [] }, source;
    function inspect(sources) {
        const pending = [...new Set(sources)].filter(s => !inspected.has(s)); if (!pending.length) return;
        assert(inspected.size + pending.length <= maxSources, 'Scene-map source limit exceeded');
        const directory = path.join(output, `inventory-${inventoryFiles.length}`);
        const result = tools.inspectResourceFiles({ sources: pending, studio, game: 'GI', output: directory, timeoutMs });
        inventory.files.push(...result.inventory.files); inventoryFiles.push(path.join(directory, 'inspection-report.json'));
        pending.forEach(s => inspected.add(s));
    }
    function extract(entries) {
        const unique = [...new Map(entries.filter(e => !extracted.has(key(e))).map(e => [key(e), e])).values()];
        if (!unique.length) return;
        assert(extracted.size + unique.length <= maxObjects, 'Scene-map object limit exceeded');
        const directory = path.join(output, `objects-${reportFiles.length}`);
        tools.extractRawResources({ entries: unique, studio, game: 'GI', output: directory, format: 'serialized', timeoutMs,
            inputs: [sceneTableFile, sceneMapFile, map] });
        reportFiles.push(path.join(directory, 'extraction-report.json')); unique.forEach(e => extracted.add(key(e)));
        source = maps.loadSources(reportFiles, inventoryFiles);
    }
    // Resolve by CAB + Int64 PathID. Asset-map PathID matches only locate possible
    // blocks; they never establish identity when an external CAB is unavailable.
    let lookup = 0;
    function follow(refs) {
        let index = tools.createResourceIndex(inventory);
        let resolved = refs.map(r => index.resolve({ ...r.entry, ...r.pointer }));
        const ids = refs.filter((_, i) => resolved[i].status === 'missing-file').map(r => r.pointer.PathID);
        if (ids.length) {
            const found = tools.readAssetMap({ studio, map, output: path.join(output, `reference-candidates-${lookup++}.json`),
                pathIDs: [...new Set(ids)], types: ['MonoBehaviour', 'MonoScript'], timeoutMs });
            inspect(found.entries.map(e => e.Source)); index = tools.createResourceIndex(inventory);
            resolved = refs.map(r => index.resolve({ ...r.entry, ...r.pointer }));
        }
        extract(resolved.filter(r => r.status === 'resolved' && ['MonoBehaviour', 'MonoScript'].includes(r.entry.Type)).map(r => r.entry));
        return resolved;
    }
    inspect(roots.map(e => e.Source)); extract(roots);
    const rootObjects = roots.map(e => source.objects.get(key(e)));
    follow(rootObjects.map(o => ({ entry: o.entry, pointer: decodeObject(o.bytes, o.metadata).script })));
    const refs = [];
    const index = tools.createResourceIndex(inventory);
    for (const object of rootObjects) {
        try {
            const h = decodeObject(object.bytes, object.metadata), r = index.resolve({ ...object.entry, ...h.script });
            const s = r.status === 'resolved' && source.objects.get(key(r.entry));
            if (s && expectedScript(decodeObject(s.bytes, s.metadata), 'SceneScriptData'))
                refs.push({ entry: object.entry, pointer: decodeSceneScript(object.bytes, object.metadata).mapReference });
        } catch { /* buildCache preserves unsupported layouts as diagnostics */ }
    }
    const targets = follow(refs);
    const scripts = targets.filter(r => r.status === 'resolved' && r.entry.Type === 'MonoBehaviour').flatMap(r => {
        const object = source.objects.get(key(r.entry));
        try { return [{ entry: object.entry, pointer: decodeObject(object.bytes, object.metadata).script }]; } catch { return []; }
    });
    follow(scripts);
    const file = path.join(output, 'map-entries.json');
    const cache = buildCache({ sceneTableFile, sceneMapFile, reportFiles, inventoryFiles, output: file });
    return { file, entries: cache.entries.length, maps: cache.entries.filter(e => e.status === 'map-config').length,
        diagnostics: cache.entries.filter(e => !['map-config', 'no-map-reference'].includes(e.status)).length };
}
module.exports = { prepare, buildCache, readResourceCache, linkEntries };
if (require.main === module) {
    const [command, file] = process.argv.slice(2); assert(['prepare', 'build'].includes(command) && file);
    const options = read(file), cache = command === 'prepare' ? prepare(options) : buildCache(options);
    console.log(JSON.stringify(command === 'prepare' ? cache : { output: options.output, entries: cache.entries.length }));
}
