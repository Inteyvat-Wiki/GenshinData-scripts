const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const tools = require('@inteyvat-wiki/resource-tools');
const { read, hash, verify, identity, evidence } = require('./map-evidence');
const { decodeLevelMap, families: tilePrefixes, tileCoordinate, mapProjection } = require('../extract/maps/base');
const { selectBaseEntries } = require('../extract/maps/scene-entry');
const codeFiles = () => [__filename, require.resolve('./map-evidence'), require.resolve('../extract/maps/base')];
function buildCache({ entryCacheFile, prefabCacheFile, rawReportFile, imageReportFile, rawReportFiles, imageReportFiles, output }) {
    assert(entryCacheFile, 'Native base maps require verified SceneScriptData entry links');
    const e = evidence(), entries = require('./map-entries').readResourceCache(entryCacheFile); e.file(entryCacheFile);
    for (const input of entries.inputs) e.remember(input);
    const selected = selectBaseEntries(entries.entries, tilePrefixes); assert(selected.length, 'No supported native base maps');
    const prefab = require('./maps').readResourceCache(prefabCacheFile); e.file(prefabCacheFile);
    for (const input of prefab.inputs) e.remember(input);
    rawReportFiles ||= [rawReportFile]; imageReportFiles ||= [imageReportFile];
    const raw = { resources: rawReportFiles.flatMap(file => e.report(file, 'serialized').resources) };
    const imageReports = imageReportFiles.map(file => e.report(file));
    for (const report of imageReports) {
        assert.equal(report.kind, 'images'); assert.equal(report.selection, 'preserve');
        for (const input of [report.assembly, report.cli].filter(Boolean)) e.remember(input);
    }
    const images = { entries: imageReports.flatMap(r => r.entries), batches: imageReports.flatMap(r => r.batches) };
    const byId = new Map(prefab.objects.map(object => [object.id, object]));
    const target = (object, field) => byId.get(object.references.find(ref => ref.field === field && ref.status === 'resolved')?.target);
    const scenes = [], tiles = [], diagnostics = entries.entries.filter(entry => entry.status === 'map-config' && !Object.hasOwn(tilePrefixes, entry.config.name))
        .map(entry => ({ code: 'unverified-base-tile-family', scriptData: entry.scriptData, sceneIds: entry.sceneIds, mapConfig: entry.config.name }));
    for (const entryLink of selected) {
        const { config, mapSource: origin } = entryLink;
        const rootName = config.prefabPath.split('/').at(-1);
        const controllers = prefab.objects.filter(o => o.decoded?.type === 'MonoBehaviour' && o.decoded.className === 'MonoLevelMap'
            && o.decoded.namespace === 'MoleMole' && target(o, 'gameObject')?.name === rootName);
        assert.equal(controllers.length, 1, `Missing/ambiguous base controller: ${rootName}`);
        const object = controllers[0], controller = decodeLevelMap(fs.readFileSync(object.source.file));
        assert.deepEqual(controller.script, object.decoded.script);
        assert(entryLink.sceneIds.includes(controller.sceneId), `Base controller does not belong to any referring scene: ${config.name}`);
        const root = target(object, 'gameObject'), transform = root.references.map(ref => byId.get(ref.target)).find(o => o?.decoded?.type === 'RectTransform');
        assert(transform); assert.equal(transform.decoded.parent.PathID, '0');
        const guides = prefab.objects.filter(o => o.decoded?.type === 'RectTransform' && target(o, 'parent')?.id === transform.id && target(o, 'gameObject')?.name === 'GuideArea');
        assert.equal(guides.length, 1); const guide = guides[0].decoded;
        assert.deepEqual(guide.position, [0, 0, 0]); assert.deepEqual(guide.rotation, [0, 0, 0, 1]); assert.equal(guide.scale[0], guide.scale[1]);
        scenes.push({ sceneId: controller.sceneId, config, configSource: origin, controller, controllerSource: object.source,
            projection: mapProjection(config, controller), boundaryScale: guide.scale[0],
            referencedSceneIds: entryLink.sceneIds, sceneScripts: entryLink.scriptData });
        const names = new Set();
        for (const entry of images.entries) {
            const coordinate = tileCoordinate(entry.Name, entryLink.tilePrefix); if (!coordinate) continue;
            assert(!names.has(entry.Name), `Duplicate base image: ${entry.Name}`); names.add(entry.Name);
            const origins = raw.resources.filter(r => identity(r) === identity(entry)); assert.equal(origins.length, 1);
            const origin = origins[0], cab = read(origin.metadata.file).serializedFile.name;
            const candidates = images.batches.filter(batch => batch.entries.some(value => identity(value) === identity(entry)))
                .flatMap(batch => batch.validation.images).filter(image => image.name === entry.Name
                    && path.basename(path.dirname(image.file)).toLowerCase() === cab.toLowerCase()
                    && image.file.split(path.sep).includes(path.basename(entry.Source) + '_export'));
            assert.equal(candidates.length, 1, `Base image origin mismatch: ${entry.Name}`);
            const image = candidates[0], png = tools.validatePng(fs.readFileSync(image.file)); e.remember(image);
            assert.equal(png.sha256, image.sha256); assert.equal(png.width, png.height, 'Non-square base tile');
            tiles.push({ sceneId: controller.sceneId, coordinate, worldTileSize: controller.worldTileSize, entry, image: { file: image.file, ...png } });
        }
        assert(names.size, `No native tiles: ${config.name}`);
    }
    assert.equal(scenes.length, selected.length, 'Incomplete discovered map scene configs');
    assert.equal(new Set(scenes.map(scene => scene.sceneId)).size, scenes.length);
    for (const code of codeFiles()) e.remember(hash(code));
    const plan = { entryCacheFile, prefabCacheFile, rawReportFiles, imageReportFiles };
    const cache = { schema: 1, parser: 'gi-map-base-7.1-v2', inputs: [...e.inputs.values()], plan, scenes, tiles, diagnostics };
    if (output) fs.writeFileSync(output, JSON.stringify(cache, null, 2) + '\n', { flag: 'wx' }); return cache;
}
function readResourceCache(file) {
    const cache = read(file); assert.equal(cache.schema, 1); assert.equal(cache.parser, 'gi-map-base-7.1-v2', 'Rebuild base maps from native scene entries');
    for (const input of cache.inputs) verify(input);
    for (const code of codeFiles()) assert(cache.inputs.some(input => path.resolve(input.file) === code && input.sha256 === hash(code).sha256), 'Rebuild native base cache for current parser');
    const actual = buildCache(cache.plan);
    assert.deepEqual(cache.scenes, actual.scenes); assert.deepEqual(cache.tiles, actual.tiles); assert.deepEqual(cache.diagnostics, actual.diagnostics); return cache;
}
function prepare({ data, sceneTableFile, entryCacheFile, studio, map, output, timeoutMs = 180000, maxTiles = 2048 }) {
    output = path.resolve(output); fs.mkdirSync(output);
    entryCacheFile ||= require('./map-entries').prepare({ data, sceneTableFile, studio, map, output: path.join(output, 'entries'), timeoutMs }).file;
    const selected = selectBaseEntries(require('./map-entries').readResourceCache(entryCacheFile).entries, tilePrefixes);
    assert(selected.length, 'No supported native base maps');
    const prefabOutput = path.join(output, 'prefabs');
    require('./map-atlas').prepareAtlas({ studio, assetMap: map, output: prefabOutput, prefabPaths: selected.map(entry => entry.config.prefabPath), maxObjects: 30000, maxSources: 80, timeoutMs });
    const textureMapFile = path.join(output, 'texture-map.json');
    const textureMap = tools.readAssetMap({ studio, map, output: textureMapFile, types: ['Texture2D'], timeoutMs });
    const tiles = textureMap.entries.filter(entry => selected.some(link => tileCoordinate(entry.Name, link.tilePrefix)));
    assert(tiles.length > 0 && tiles.length <= maxTiles, 'Base tile selection exceeds expected bounds');
    assert.equal(new Set(tiles.map(entry => entry.Name)).size, tiles.length, 'Ambiguous base tile asset names');
    const rawOutput = path.join(output, 'serialized'), imageOutput = path.join(output, 'images');
    tools.extractRawResources({ entries: tiles, studio, output: rawOutput, game: 'GI', format: 'serialized', inputs: [textureMapFile, map], timeoutMs });
    tools.extractResources({ entries: tiles, studio, output: imageOutput, game: 'GI', selection: 'preserve', inputs: [textureMapFile, map], timeoutMs });
    const file = path.join(output, 'map-base.json'), cache = buildCache({ entryCacheFile, prefabCacheFile: path.join(prefabOutput, 'map-resources.json'),
        rawReportFile: path.join(rawOutput, 'extraction-report.json'), imageReportFile: path.join(imageOutput, 'extraction-report.json'), output: file });
    return { file, scenes: cache.scenes.length, tiles: cache.tiles.length };
}
module.exports = { buildCache, readResourceCache, prepare };
if (require.main === module) { const args = process.argv.slice(2), command = args.length === 1 ? 'build' : args[0], plan = args.at(-1);
    assert(plan && ['build', 'prepare'].includes(command)); const options = read(plan);
    if (command === 'prepare') console.log(JSON.stringify(prepare(options)));
    else { const cache = buildCache(options); console.log(JSON.stringify({ output: options.output, scenes: cache.scenes.length, tiles: cache.tiles.length })); } }
