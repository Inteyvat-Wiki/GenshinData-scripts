const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { assetKey, evidence, identity, read } = require('./map-evidence');
const { parseIndex } = require('./miliastra');
const { PROFILE, decodeOutline } = require('../extract/maps/limit-outline');

// Only these client blocks have been checked against independent decoded polygons.
const DESIGN_BLOCKS = new Set([
    'cb1a68de51f3baeba7afc771284d46410a7b6cb993aa3d085a0c8a7813e14768',
    '22d85ebd268b39739563f6e0eb0e184e94f8d4d93a7340d3c34a110f45ec3b0f',
]);
const TABLE = 'ExcelBinOutput/LimitRegionExcelConfigData.json';
const INDEX_DIGESTS = {
    '31049741.blk': ['782aa1208ab3070a567f8907e7f15b8f3ad046b0d661cdd4774ef9af8f81dffc'],
    '31049740.blk': ['216c791b536ce8e4f1f0128c200a791015768491bf23f2a8a9bc618720b6eb7d',
        'c89e8b51eb14359a371f62d07007d60a3adf13fad904649925b55c3e0bf0ae9d'],
};
function address(asset_path) { return { asset_path, ...assetKey(asset_path) }; }
function optionalArtPacks(index, candidates) {
    // parseIndex probes membership while reading entries, then iterates the
    // required keys to resolve their packs. Only matched art keys require a pack.
    const matched = new Set();
    return parseIndex(index, {
        has(key) {
            if (!candidates.has(key)) return false;
            matched.add(key);
            return true;
        },
        [Symbol.iterator]() { return matched.values(); },
    });
}
function indexPayload(proof, reportFile, block) {
    const report = proof.report(reportFile, 'payload');
    assert.equal(report.resources.length, 1);
    const [entry] = report.resources;
    assert(entry.Type === 'MiHoYoBinData' && entry.PathID === '3' && entry.Offset === 0 && path.basename(entry.Source) === block,
        `Invalid client index: ${block}`);
    assert(INDEX_DIGESTS[block].includes(entry.sha256), 'Unsupported limit region index revision');
    return fs.readFileSync(entry.file);
}
function select(plan, proof) {
    const table = proof.file(path.join(plan.sourceRoot, TABLE));
    const ids = new Set();
    const candidates = table.map(({ id, name, type, sceneId }) => {
        assert(Number.isSafeInteger(id) && id > 0 && !ids.has(id) && (sceneId === undefined || Number.isSafeInteger(sceneId) && sceneId > 0)
            && /^[a-zA-Z0-9_]+$/.test(name) && typeof type === 'string', 'Invalid limit region identity');
        ids.add(id);
        return { id, name, type, sceneId,
            geometry: address(`Data/_BinOutput/LevelDesign/SimplePolygons/${name}.MiHoYoBinData`),
            prefab: address(`ART/UI/Menus/Widget/InLevel/MapBack/${name}.GameObject`) };
    });
    assert(candidates.length, 'Empty limit region table');
    const designs = parseIndex(indexPayload(proof, plan.indexReportFile, '31049741.blk'), new Set(candidates.map(row => row.geometry.resource_key)));
    const art = optionalArtPacks(indexPayload(proof, plan.artIndexReportFile, '31049740.blk'), new Set(candidates.map(row => row.prefab.resource_key)));
    // AnimeStudio inventory of the design block(s), independent of the extraction selection.
    const inventory = proof.file(plan.mapFile);
    if (inventory.map) proof.remember({ file: inventory.map, sha256: inventory.sha256 });
    const entries = inventory.AssetEntries || inventory.entries;
    const location = (entry) => [path.basename(entry.Source), entry.Offset, entry.Container].join('/');
    const byLocation = new Map();
    for (const entry of entries.filter(entry => entry.Type === 'MiHoYoBinData')) {
        const key = location(entry);
        if (!byLocation.has(key)) byLocation.set(key, []);
        byLocation.get(key).push(entry);
    }
    return candidates.map(({ id, name, sceneId, type, geometry, prefab }) => {
        const { block, offset } = designs.get(geometry.resource_key).pack;
        const matches = byLocation.get([block + '.blk', offset, geometry.container].join('/')) || [];
        assert.equal(matches.length, 1, `Missing or ambiguous SimplePolygon: ${name}`);
        const [entry] = matches;
        assert(typeof entry.PathID === 'string' || Number.isSafeInteger(entry.PathID), 'Inexact PathID');
        assert.equal(entry.Name, (Number(geometry.container) >>> 0).toString(16).padStart(8, '0'), 'SimplePolygon inventory name mismatch');
        return { id, name, sceneId, type, geometry, prefab, hit: art.get(prefab.resource_key), block, offset,
            entry: { Type: entry.Type, Container: entry.Container, Name: entry.Name, Offset: entry.Offset, Source: entry.Source, PathID: String(entry.PathID) } };
    });
}
function collect(plan) {
    const proof = evidence(), selected = select(plan, proof);
    const report = proof.report(plan.rawReportFile, 'payload');
    const payloads = new Map(report.resources.map(entry => [identity(entry), entry]));
    assert.equal(payloads.size, report.resources.length, 'Duplicate limit outline payload identity');
    const outlines = selected.map(({ id, name, sceneId, type, geometry, prefab, hit, block, offset, entry }) => {
        const raw = payloads.get(identity(entry));
        assert(raw && raw.Container === geometry.container && raw.Name === entry.Name, `Missing verified payload: ${name}`);
        assert(DESIGN_BLOCKS.has(proof.inputs.get(path.resolve(raw.Source))?.sha256), 'Unsupported SimplePolygon client revision');
        const source = { decoder: PROFILE, asset_path: geometry.asset_path, resource_key: geometry.resource_key,
            block, offset, path_id: raw.PathID, sha256: raw.sha256 };
        const polygon = { ...decodeOutline(fs.readFileSync(raw.file)), source };
        if (hit) polygon.map_back_prefab = { asset_path: prefab.asset_path, resource_key: prefab.resource_key,
            block: hit.pack.block, offset: hit.pack.offset, size: hit.pack.size };
        return { id, name, ...(sceneId === undefined ? {} : { sceneId }), type, polygon };
    });
    return { schema: 1, profile: PROFILE, plan, inputs: [...proof.inputs.values()], outlines };
}
function prepare({ sourceRoot, indexReportFile, artIndexReportFile, rawReportFile, mapFile, map, output, studio, game = 'GI', dotnet, timeoutMs = 120000 }) {
    const tools = require('@inteyvat-wiki/resource-tools');
    fs.mkdirSync(output);
    if (!mapFile) {
        const rows = read(path.join(sourceRoot, TABLE));
        const containers = rows.map(row => address(`Data/_BinOutput/LevelDesign/SimplePolygons/${row.name}.MiHoYoBinData`).container);
        mapFile = path.join(output, 'asset-map.json');
        tools.readAssetMap({ studio, map, output: mapFile, types: ['MiHoYoBinData'], containers: [...new Set(['111', ...containers])], dotnet, timeoutMs });
    }
    function extract(entries, folder) {
        const destination = path.resolve(output, folder);
        tools.extractRawResources({ entries, studio, output: destination, game, format: 'payload', dotnet, timeoutMs,
            inputs: [mapFile, path.join(sourceRoot, TABLE)] });
        return path.join(destination, 'extraction-report.json');
    }
    function extractIndex(block) {
        const inventory = read(mapFile);
        const entries = (inventory.entries || inventory.AssetEntries).filter(entry => entry.Type === 'MiHoYoBinData'
            && entry.Offset === 0 && String(entry.PathID) === '3' && path.basename(entry.Source) === block);
        assert.equal(entries.length, 1, `Provide the active index report for ${block}`);
        return extract([{ ...entries[0], PathID: '3' }], path.basename(block, '.blk') + '-index');
    }
    indexReportFile ||= extractIndex('31049741.blk');
    artIndexReportFile ||= extractIndex('31049740.blk');
    if (!rawReportFile) {
        const selected = select({ sourceRoot, indexReportFile, artIndexReportFile, mapFile }, evidence());
        rawReportFile = extract(selected.map(item => item.entry), 'outlines');
    }
    const plan = Object.fromEntries(Object.entries({ sourceRoot, indexReportFile, artIndexReportFile, rawReportFile, mapFile })
        .map(([key, value]) => [key, path.resolve(value)]));
    const cache = collect(plan);
    const file = path.join(output, 'map-limit-outlines.json');
    fs.writeFileSync(file, JSON.stringify(cache), { flag: 'wx' });
    return { file, count: cache.outlines.length };
}
function readResourceCache(file) {
    const cache = read(file);
    const verified = collect(cache.plan);
    assert.deepEqual(cache, verified, 'Stale or modified limit outline cache');
    return verified;
}
module.exports = { prepare, readResourceCache };
