const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const tools = require('@inteyvat-wiki/resource-tools');
const { parseIndex } = require('./miliastra');
const { PROFILE, CONFIG_BLOCK_SHA256, decodeWorldArea } = require('../extract/maps/world-area-binary');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function hash(file) {
    const digest = crypto.createHash('sha256'), fd = fs.openSync(file, 'r'), buffer = Buffer.alloc(1024 * 1024);
    let bytes = 0;
    try { let n; while ((n = fs.readSync(fd, buffer, 0, buffer.length, null))) { digest.update(buffer.subarray(0, n)); bytes += n; } }
    finally { fs.closeSync(fd); }
    return { file: path.resolve(file), bytes, sha256: digest.digest('hex') };
}
function verify(input) {
    const actual = hash(input.file); assert.equal(actual.sha256, input.sha256, `Stale WorldArea input: ${input.file}`);
    if (input.bytes !== undefined) assert.equal(actual.bytes, input.bytes, `WorldArea input size changed: ${input.file}`);
    return actual;
}
const identity = entry => JSON.stringify([path.resolve(entry.Source), entry.Offset, entry.PathID, entry.Type, entry.Name, entry.Container]);
function resourceKey(scene) {
    assert(Number.isSafeInteger(scene) && scene > 0, 'Invalid WorldArea scene');
    const assetPath = `Data/_BinOutput/Scene/WorldArea/scene${scene}_worldArea.MiHoYoBinData`;
    // Path convention verified by full 64-bit design-index hits. The 32-bit
    // Container is only a consistency check within the resolved pack.
    const bytes = Buffer.from(assetPath, 'ascii'), padded = Buffer.alloc(((bytes.length >> 8) + 1) << 8); bytes.copy(padded);
    const digest = crypto.createHash('md5').update(padded).digest();
    return { scene_id: scene, asset_path: assetPath, resource_key: digest.readBigUInt64LE().toString(), container: digest.readInt32LE(1).toString() };
}
function selectResources(rows, index, entries) {
    const requested = [...new Set(rows.map(row => row.sceneID))].sort((a, b) => a - b).map(resourceKey);
    const hits = parseIndex(index, new Set(requested.map(item => item.resource_key)));
    return requested.map(item => {
        const hit = hits.get(item.resource_key);
        const matches = entries.filter(entry => entry.Type === 'MiHoYoBinData' && entry.Offset === hit.pack.offset
            && Number(path.basename(entry.Source, '.blk')) === hit.pack.block && entry.Container === item.container);
        assert.equal(matches.length, 1, `Ambiguous/missing WorldArea resource: ${item.scene_id}`);
        const entry = matches[0]; assert(/^\d+$/.test(entry.PathID), 'WorldArea PathID must be lossless');
        assert.equal(entry.Name.toLowerCase(), (Number(item.container) >>> 0).toString(16).padStart(8, '0'), 'WorldArea name/container mismatch');
        return { ...item, index: hit, entry };
    });
}
function readReport(file, remember) {
    remember(hash(file)); const report = read(file);
    assert.equal(report.kind, 'raw'); assert.equal(report.format, 'payload'); assert.equal(report.status, 'complete');
    assert.equal(report.resources.length, report.entries.length, 'Incomplete WorldArea extraction');
    for (const input of [...report.inputs, report.tool, report.bridge, report.runtime].filter(Boolean)) remember(input);
    for (let i = 0; i < report.resources.length; i++) {
        const resource = report.resources[i]; remember(resource); assert(resource.metadata, 'Missing WorldArea metadata'); remember(resource.metadata);
        const metadata = read(resource.metadata.file);
        assert.equal(metadata.format, 'payload'); assert.equal(metadata.bytes, resource.bytes);
        assert.equal(identity(resource), identity(report.entries[i]), 'WorldArea report origin mismatch');
        assert.equal(identity(resource), identity(metadata.entry), 'WorldArea metadata origin mismatch');
    }
    return report;
}
function buildCache({ sourceRoot, mapFile, indexReportFile, rawReportFile, output }) {
    const inputs = new Map();
    const remember = input => { const file = path.resolve(input.file), prior = inputs.get(file);
        if (prior) assert.equal(prior.sha256, input.sha256, 'Conflicting WorldArea input');
        else inputs.set(file, verify(input)); };
    const tableFile = path.join(sourceRoot, 'ExcelBinOutput/WorldAreaConfigData.json');
    for (const file of [tableFile, mapFile, __filename, require.resolve('../extract/maps/world-area-binary'), require.resolve('./miliastra')]) remember(hash(file));
    const map = read(mapFile); remember({ file: map.map, sha256: map.sha256 });
    const indexReport = readReport(indexReportFile, remember);
    assert.equal(indexReport.resources.length, 1, 'Expected exact design index');
    const indexResource = indexReport.resources[0];
    assert.equal(path.basename(indexResource.Source), '31049741.blk'); assert.equal(indexResource.PathID, '3'); assert.equal(indexResource.Offset, 0);
    const rows = read(tableFile), selected = selectResources(rows, fs.readFileSync(indexResource.file), map.entries);
    const raw = readReport(rawReportFile, remember);
    const scenes = selected.map(item => {
        const matches = raw.resources.filter(resource => identity(resource) === identity(item.entry));
        assert.equal(matches.length, 1, `Missing exact WorldArea payload: ${item.scene_id}`);
        const payload = matches[0], block = inputs.get(path.resolve(payload.Source));
        assert.equal(block?.sha256, CONFIG_BLOCK_SHA256, 'Unsupported client WorldArea revision; verify a new decoder profile first');
        const data = decodeWorldArea(fs.readFileSync(payload.file), PROFILE);
        for (const group of data.level1Areas || []) for (const [level, area] of [[1, group.level1Area], ...(group.level2Areas || []).map(a => [2, a])]) {
            const matching = rows.filter(row => row.sceneID === item.scene_id && row.areaType === `LEVEL_${level}`
                && row.areaID1 === area.id1 && (level === 1 || row.areaID2 === area.id2));
            assert.equal(matching.length, 1, `Unresolved client WorldArea: ${item.scene_id}/${level}/${area.id1}/${area.id2}`);
        }
        return { scene_id: item.scene_id, file: item.asset_path,
            source: { kind: 'client-world-area', resource_key: item.resource_key, block: path.basename(item.entry.Source),
                offset: item.entry.Offset, path_id: item.entry.PathID, sha256: payload.sha256, decoder: PROFILE },
            payload: { file: payload.file, bytes: payload.bytes, sha256: payload.sha256 }, data };
    });
    const cache = { schema: 1, parser: PROFILE, inputs: [...inputs.values()], scenes };
    fs.writeFileSync(output, JSON.stringify(cache, null, 2) + '\n', { flag: 'wx' });
    return cache;
}
function readResourceCache(file) {
    assert(file && fs.existsSync(file), 'Prepare client WorldArea resources and set MAP_WORLD_AREA_RESOURCE_CACHE; legacy JSON fallback is disabled');
    const cache = read(file); assert.equal(cache.schema, 1); assert.equal(cache.parser, PROFILE);
    for (const input of cache.inputs) verify(input);
    for (const code of [__filename, require.resolve('../extract/maps/world-area-binary'), require.resolve('./miliastra')])
        assert(cache.inputs.some(input => path.resolve(input.file) === path.resolve(code) && input.sha256 === hash(code).sha256), 'Rebuild WorldArea cache for current parser');
    const scenes = new Set();
    for (const scene of cache.scenes) {
        assert(!scenes.has(scene.scene_id), 'Duplicate WorldArea scene'); scenes.add(scene.scene_id);
        const key = resourceKey(scene.scene_id);
        assert.equal(scene.file, key.asset_path); assert.equal(scene.source.resource_key, key.resource_key);
        assert.equal(scene.source.kind, 'client-world-area'); assert.equal(scene.source.decoder, PROFILE);
        verify(scene.payload); assert.equal(scene.source.sha256, scene.payload.sha256);
        assert.deepEqual(scene.data, decodeWorldArea(fs.readFileSync(scene.payload.file), PROFILE), 'WorldArea decoded cache mismatch');
    }
    return cache;
}
function prepare({ sourceRoot, studio, map: mapInput, assetMap, output, game = 'GI', timeoutMs = 120000 }) {
    assert(sourceRoot && studio && (mapInput || assetMap) && output, 'Specify sourceRoot, studio, map/assetMap and a new output directory');
    fs.mkdirSync(output);
    const mapFile = assetMap || path.join(output, 'asset-map.json');
    const map = assetMap ? read(assetMap) : tools.readAssetMap({ studio, map: mapInput, output: mapFile, types: ['MiHoYoBinData'], timeoutMs });
    verify({ file: map.map, sha256: map.sha256 });
    const indices = map.entries.filter(entry => entry.Type === 'MiHoYoBinData' && path.basename(entry.Source) === '31049741.blk'
        && entry.PathID === '3' && entry.Offset === 0 && entry.Name === '0000006f');
    assert.equal(indices.length, 1, 'Ambiguous/missing client design index');
    const indexOutput = path.join(output, 'design-index');
    const indexReport = tools.extractRawResources({ entries: indices, studio, game, output: indexOutput, format: 'payload', inputs: [mapFile, map.map], timeoutMs });
    const tableFile = path.join(sourceRoot, 'ExcelBinOutput/WorldAreaConfigData.json');
    const selected = selectResources(read(tableFile), fs.readFileSync(indexReport.resources[0].file), map.entries);
    const rawOutput = path.join(output, 'payloads');
    tools.extractRawResources({ entries: selected.map(item => item.entry), studio, game, output: rawOutput, format: 'payload', inputs: [mapFile, tableFile], timeoutMs });
    const file = path.join(output, 'world-areas.json');
    const cache = buildCache({ sourceRoot, mapFile, indexReportFile: path.join(indexOutput, 'extraction-report.json'),
        rawReportFile: path.join(rawOutput, 'extraction-report.json'), output: file });
    return { file, scenes: cache.scenes.length };
}
module.exports = { resourceKey, selectResources, buildCache, readResourceCache, prepare };
if (require.main === module) {
    assert(process.argv.length === 3, 'Usage: node resources/world-areas.js PLAN.json');
    console.log(JSON.stringify(prepare(read(process.argv[2])), null, 2));
}
