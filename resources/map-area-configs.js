const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const tools = require('@inteyvat-wiki/resource-tools');
const { parseIndex } = require('./miliastra');
const { read, hash, verify, identity, evidence, assetKey } = require('./map-evidence');
const { PROFILE, CONFIG_BLOCK_SHA256, decodeMapAreas } = require('../extract/maps/map-area-binary');
const ASSET = 'Data/_BinOutput/Map/MapArea/ConfigMapArea.MiHoYoBinData';
function select(index, entries) {
    const key = assetKey(ASSET), hit = parseIndex(index, new Set([key.resource_key])).get(key.resource_key);
    assert(hit, 'Missing client MapArea design index key');
    const matches = entries.filter(e => e.Type === 'MiHoYoBinData' && e.Container === key.container && e.Offset === hit.pack.offset
        && Number(path.basename(e.Source, '.blk')) === hit.pack.block);
    assert.equal(matches.length, 1, 'Ambiguous/missing client MapArea resource'); return { key, hit, entry: matches[0] };
}
function buildCache({ mapFile, indexReportFile, rawReportFile, output }) {
    const e = evidence(), map = e.file(mapFile); e.remember({ file: map.map, sha256: map.sha256 });
    const index = e.report(indexReportFile, 'payload'); assert.equal(index.resources.length, 1);
    assert.equal(index.resources[0].PathID, '3'); assert.equal(path.basename(index.resources[0].Source), '31049741.blk');
    const selected = select(fs.readFileSync(index.resources[0].file), map.entries), report = e.report(rawReportFile, 'payload');
    const matches = report.resources.filter(r => identity(r) === identity(selected.entry)); assert.equal(matches.length, 1);
    const raw = matches[0]; assert.equal(e.inputs.get(path.resolve(raw.Source))?.sha256, CONFIG_BLOCK_SHA256, 'Unsupported MapArea client revision');
    for (const code of [__filename, require.resolve('./map-evidence'), require.resolve('./miliastra'), require.resolve('../extract/maps/map-area-binary')]) e.remember(hash(code));
    const source = { kind: 'client-map-area', asset_path: ASSET, resource_key: selected.key.resource_key,
        block: path.basename(raw.Source), offset: raw.Offset, path_id: raw.PathID, sha256: raw.sha256, decoder: PROFILE };
    const cache = { schema: 1, parser: PROFILE, inputs: [...e.inputs.values()], source,
        payload: { file: raw.file, sha256: raw.sha256, bytes: raw.bytes }, configs: decodeMapAreas(fs.readFileSync(raw.file)) };
    fs.writeFileSync(output, JSON.stringify(cache, null, 2) + '\n', { flag: 'wx' }); return cache;
}
function readResourceCache(file) {
    assert(file && fs.existsSync(file), 'Prepare client MapArea resources and set MAP_AREA_CONFIG_RESOURCE_CACHE');
    const cache = read(file); assert.equal(cache.schema, 1); assert.equal(cache.parser, PROFILE);
    for (const input of cache.inputs) verify(input);
    for (const code of [__filename, require.resolve('./map-evidence'), require.resolve('../extract/maps/map-area-binary')])
        assert(cache.inputs.some(input => path.resolve(input.file) === path.resolve(code) && input.sha256 === hash(code).sha256), 'Rebuild MapArea resource cache for current parser');
    assert.equal(cache.source.asset_path, ASSET); assert.equal(cache.source.resource_key, assetKey(ASSET).resource_key);
    verify(cache.payload); assert.equal(cache.source.sha256, cache.payload.sha256);
    assert.deepEqual(cache.configs, decodeMapAreas(fs.readFileSync(cache.payload.file)), 'Client MapArea decoded cache mismatch'); return cache;
}
function prepare({ studio, map: mapInput, assetMap, output, timeoutMs = 120000 }) {
    fs.mkdirSync(output); const mapFile = assetMap || path.join(output, 'asset-map.json');
    const map = assetMap ? read(assetMap) : tools.readAssetMap({ studio, map: mapInput, output: mapFile, types: ['MiHoYoBinData'], timeoutMs });
    const entries = map.entries.filter(e => path.basename(e.Source) === '31049741.blk' && e.PathID === '3' && e.Offset === 0 && e.Type === 'MiHoYoBinData'); assert.equal(entries.length, 1);
    const indexOutput = path.join(output, 'design-index'), rawOutput = path.join(output, 'payload');
    const index = tools.extractRawResources({ entries, studio, output: indexOutput, format: 'payload', game: 'GI', timeoutMs });
    const selected = select(fs.readFileSync(index.resources[0].file), map.entries);
    tools.extractRawResources({ entries: [selected.entry], studio, output: rawOutput, format: 'payload', game: 'GI', timeoutMs });
    const file = path.join(output, 'map-area-configs.json'); buildCache({ mapFile, indexReportFile: path.join(indexOutput, 'extraction-report.json'), rawReportFile: path.join(rawOutput, 'extraction-report.json'), output: file }); return { file };
}
module.exports = { buildCache, readResourceCache, prepare, select };
if (require.main === module) { const [command, plan] = process.argv.slice(2); assert(['prepare', 'build'].includes(command) && plan); const options = read(plan);
    const result = command === 'prepare' ? prepare(options) : buildCache(options); console.log(JSON.stringify({ file: result.file || options.output, count: result.configs && Object.keys(result.configs).length })); }
