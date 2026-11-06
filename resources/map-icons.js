const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const tools = require('@inteyvat-wiki/resource-tools');
// Tutorial 154501/154503 and their native screenshots identify these two
// sprites as the other-floor/current-floor point badges (see map-resources.md).
const LAYER_BADGES = { normal: 'UI_MarkPoint_Sign_Inside', active: 'UI_MarkPoint_Sign_Inside02' };
const hash = file => ({ file: path.resolve(file), bytes: fs.statSync(file).size,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') });
function parserInputs() {
    return [__filename, ...['catalogue', 'point-details', 'source', 'schema'].map(name => require.resolve(`../extract/maps/${name}`)),
        require.resolve('../extract/field-inference')].map(hash);
}
function verify(input) {
    assert.equal(hash(input.file).sha256, input.sha256, `Stale map icon input: ${input.file}`);
}
function references(records) {
    const values = Array.isArray(records) ? records : Object.values(records);
    const byId = new Map(values.map(record => [record.id, record]));
    return values.filter(record => record.kind === 'point').flatMap(point => point.relations
        .filter(relation => ['map_icon', 'locked_map_icon', 'unexplored_map_icon'].includes(relation.role) && relation.category === 'maps')
        .map(relation => {
            const icon = byId.get(relation.id);
            assert(icon?.kind === 'map_icon', `Missing referenced map icon ${relation.id}`);
            return { point: point.id, record: icon.id, name: icon.data.icon || '' };
        }));
}
function selectEntries(names, entries) {
    const selected = [], diagnostics = [];
    for (const name of names) {
        const safe = tools.imageName(name);
        if (safe.name !== name || safe.reason) { diagnostics.push({ name, code: 'unsafe-image-name' }); continue; }
        const matches = tools.selectImageEntries(entries.filter(entry => entry.Name === name));
        const unique = [...new Map(matches.map(entry => [JSON.stringify(entry), entry])).values()];
        // Never select by largest image, first row or filename similarity.
        if (unique.length !== 1) { diagnostics.push({ name, code: unique.length ? 'ambiguous-image' : 'missing-image', candidates: unique.length }); continue; }
        selected.push(unique[0]);
    }
    return { selected, diagnostics };
}
function buildCache({ selectionFile, mapFile, rawReportFile, imageReportFile, output }) {
    const selection = JSON.parse(fs.readFileSync(selectionFile, 'utf8'));
    const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
    const raw = JSON.parse(fs.readFileSync(rawReportFile, 'utf8'));
    const images = JSON.parse(fs.readFileSync(imageReportFile, 'utf8'));
    assert.equal(raw.kind, 'raw'); assert.equal(raw.format, 'serialized'); assert.equal(raw.status, 'complete');
    assert.equal(images.kind, 'images'); assert.equal(images.status, 'complete'); assert.equal(images.selection, 'preserve');
    assert.equal(hash(map.map).sha256, map.sha256, 'Asset map changed');
    const inputs = new Map();
    const remember = input => { verify(input); inputs.set(path.resolve(input.file), input); };
    for (const file of [selectionFile, mapFile, rawReportFile, imageReportFile]) remember(hash(file));
    for (const input of parserInputs()) remember(input);
    for (const input of [...selection.inputs, ...raw.inputs, ...images.inputs, raw.tool, images.tool, images.assembly, images.cli].filter(Boolean)) remember(input);
    const { selected, diagnostics } = selectEntries(selection.names, map.entries);
    const resources = {};
    const identity = entry => JSON.stringify([entry.Name, entry.Type, entry.Source, entry.Offset, entry.PathID]);
    for (const entry of selected) {
        const matches = raw.resources.filter(resource => identity(resource) === identity(entry));
        assert.equal(matches.length, 1, `Missing exact serialized image: ${entry.Name}`);
        const origin = matches[0]; remember(origin); remember(origin.metadata);
        const metadata = JSON.parse(fs.readFileSync(origin.metadata.file, 'utf8'));
        assert.equal(identity(metadata.entry), identity(entry), 'Serialized image identity mismatch');
        const cab = metadata.serializedFile.name.toLowerCase();
        const candidates = images.batches.filter(batch => batch.entries.some(value => identity(value) === identity(entry)))
            .flatMap(batch => batch.validation.candidates.filter(group => group.name === entry.Name).flatMap(group => group.images))
            .filter(image => image.file.split(path.sep).includes(path.basename(entry.Source) + '_export')
                && path.basename(path.dirname(image.file)).toLowerCase() === cab);
        const unique = [...new Map(candidates.map(image => [path.resolve(image.file), image])).values()];
        if (unique.length !== 1) { diagnostics.push({ name: entry.Name, code: 'image-origin-mismatch', candidates: unique.length }); continue; }
        const image = unique[0], png = tools.validatePng(fs.readFileSync(image.file));
        assert.equal(png.sha256, image.sha256, 'Map icon PNG changed'); remember(image);
        resources[entry.Name] = { entry, serializedFile: metadata.serializedFile.name,
            image: { file: path.resolve(image.file), ...png } };
    }
    const cache = { schema: 1, parser: 'gi-map-icons-v1', inputs: [...inputs.values()], references: selection.references,
        resources, diagnostics };
    fs.writeFileSync(output, JSON.stringify(cache, null, 2) + '\n', { flag: 'wx' });
    return cache;
}
function prepare({ sourceRoot, studio, map: mapInput, output, game = 'GI', dotnet, timeoutMs = 120000 }) {
    assert(sourceRoot && studio && mapInput && output, 'Specify sourceRoot, studio, map and a new output directory');
    fs.mkdirSync(output); // Preserve earlier cache and any partial output.
    const { createSource } = require('../extract/maps/source');
    const source = createSource(sourceRoot, () => '', { worldAreas: () => [] });
    const records = require('../extract/maps/catalogue').buildMaps('EN', source);
    const refs = references(records), names = [...new Set([...refs.map(ref => ref.name).filter(Boolean), ...Object.values(LAYER_BADGES)])].sort();
    assert(names.length, 'No explicit point-to-icon references were parsed');
    const inputs = ['BinOutput/Global/Mark/ConfigMarkGlobal.json', ...source.files('Scene/Point').map(file => `BinOutput/${file}.json`)]
        .map(file => hash(path.join(sourceRoot, file)));
    inputs.push(...parserInputs());
    for (const table of ['WorldAreaConfigData', 'CityConfigData', 'DungeonEntryExcelConfigData', 'NewActivityExcelConfigData', 'NewActivityEntryConfigData'])
        inputs.push(hash(path.join(sourceRoot, 'ExcelBinOutput', table + '.json')));
    const selectionFile = path.join(output, 'selection.json');
    fs.writeFileSync(selectionFile, JSON.stringify({ schema: 1, references: refs, names, inputs }, null, 2));
    const mapFile = path.join(output, 'asset-map.json');
    const map = tools.readAssetMap({ studio, map: mapInput, output: mapFile, names, types: ['Sprite', 'Texture2D'], dotnet, timeoutMs });
    const { selected } = selectEntries(names, map.entries);
    assert(selected.length, 'No uniquely mapped point icons were found');
    // A raw read records the exact serialized CAB. PNG paths must match that CAB,
    // because AnimeStudio XML does not enforce the Offset field by itself.
    tools.extractRawResources({ entries: selected, studio, game, output: path.join(output, 'serialized'),
        format: 'serialized', inputs: [selectionFile, mapFile, mapInput], dotnet, timeoutMs });
    tools.extractResources({ entries: selected, studio, game, output: path.join(output, 'images'), selection: 'preserve',
        inputs: [selectionFile, mapFile, mapInput], dotnet, timeoutMs });
    const file = path.join(output, 'map-icons.json');
    const cache = buildCache({ selectionFile, mapFile, rawReportFile: path.join(output, 'serialized/extraction-report.json'),
        imageReportFile: path.join(output, 'images/extraction-report.json'), output: file });
    return { file, references: refs.length, names: names.length, images: Object.keys(cache.resources).length, diagnostics: cache.diagnostics };
}
function readResourceCache(file) {
    const cache = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(cache.schema, 1); assert.equal(cache.parser, 'gi-map-icons-v1');
    for (const input of cache.inputs) verify(input);
    for (const value of Object.values(cache.resources)) {
        const image = value.image; verify(image);
        const png = tools.validatePng(fs.readFileSync(image.file));
        assert.equal(png.width, image.width); assert.equal(png.height, image.height);
    }
    return cache;
}
function attachImages(records, cache) {
    const used = new Set(references(records).map(ref => ref.record));
    for (const record of Object.values(records)) {
        if (record.kind !== 'map_icon' || !used.has(record.id) || !record.data.icon) continue;
        const image = cache.resources[record.data.icon]?.image;
        if (!image) { record.diagnostics.push(`map_icon_image_unresolved:${record.data.icon}`); continue; }
        Object.assign(record.data, { image_file: image.file, image_sha256: image.sha256, image_width: image.width, image_height: image.height });
    }
    Object.assign(records, layerBadgeRecords(cache));
}
function layerBadgeRecords(cache) {
    const records = {};
    for (const [state, name] of Object.entries(LAYER_BADGES)) {
        const resource = cache.resources[name];
        if (!resource) continue; // Old caches remain readable; scene export checks the required pair.
        const { entry, image } = resource, id = `map-icon-layer-marker-${state}`;
        assert.equal(entry.Name, name, 'Layer badge resource identity mismatch');
        records[id] = { schema: 1, id, kind: 'map_icon', name: '', description: '', texts: [], relations: [],
            source: { file: entry.Source, id: entry.PathID, hashes: [], fields: ['Name'] }, diagnostics: [],
            data: { icon: name, badge_state: state, image_file: image.file, image_sha256: image.sha256,
                image_width: image.width, image_height: image.height } };
    }
    return records;
}
module.exports = { references, selectEntries, buildCache, prepare, readResourceCache, attachImages, layerBadgeRecords, parserInputs };
if (require.main === module) {
    const [filename] = process.argv.slice(2);
    assert(filename && process.argv.length === 3, 'Usage: node resources/map-icons.js PLAN.json');
    console.log(JSON.stringify(prepare(JSON.parse(fs.readFileSync(filename, 'utf8'))), null, 2));
}
