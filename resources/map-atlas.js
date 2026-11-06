const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const resources = require('@inteyvat-wiki/resource-tools');
const maps = require('./maps');
const supported = new Set(['GameObject', 'Transform', 'RectTransform', 'MonoBehaviour', 'MonoScript', 'Material', 'Shader', 'Mesh', 'Sprite', 'Texture2D']);
const identity = entry => `${path.resolve(entry.Source)}\0${entry.Offset}\0${entry.PathID}`;
const hashFile = file => { const bytes = fs.readFileSync(file); return { file: path.resolve(file), bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }; };
function parserInputs() {
    return [__filename, require.resolve('../extract/maps/atlas'), require.resolve('../extract/maps/schema'),
        require.resolve('../extract/field-inference')].map(hashFile);
}
function rectangularImages(cache) {
    const objects = new Map(cache.objects.map(object => [object.id, object]));
    return cache.images.filter(image => !objects.get(image.imageObject)?.decoded?.mesh);
}
// The Container in this GI asset-map revision is the signed middle MD5 word of
// the zero-padded asset path. A hash is only a discovery hint: actual root object
// names are checked below, so collisions cannot establish game associations.
function prefabContainer(prefabPath) {
    assert(typeof prefabPath === 'string' && /^[\x20-\x7e]+$/.test(prefabPath), 'Expected an explicit ASCII prefab path');
    const value = Buffer.from(`${prefabPath}.GameObject`, 'ascii');
    const padded = Buffer.alloc(((value.length >> 8) + 1) << 8); value.copy(padded);
    return crypto.createHash('md5').update(padded).digest().readInt32LE(1).toString();
}
function loadCatalogue(data, mapAreaConfigs) {
    const read = name => JSON.parse(fs.readFileSync(path.join(data, name), 'utf8'));
    return { groups: read('ExcelBinOutput/MapLayerGroupExcelConfigData.json'), layers: read('ExcelBinOutput/MapLayerExcelConfigData.json'),
        worldAreas: read('ExcelBinOutput/WorldAreaConfigData.json'), mapAreas: read('ExcelBinOutput/MapAreaConfigData.json'),
        mapConfigs: require('./map-area-configs').readResourceCache(require('../runtime-paths').resourceCachePath('mapAreaConfigs', mapAreaConfigs)).configs,
        limitRegions: read('ExcelBinOutput/LimitRegionExcelConfigData.json') };
}
function verifyExportOrigins(source, report, { output, studio, game, dotnet, timeoutMs }) {
    const pending = new Map();
    for (const batch of report.batches) for (const entry of batch.entries) {
        const original = source.objects.get(identity(entry));
        const candidates = batch.validation.images.filter(image => image.name === entry.Name);
        if (!original || candidates.length !== 1) continue;
        const exportedCab = path.basename(path.dirname(candidates[0].file));
        if (exportedCab === original.metadata.serializedFile.name || entry.Type !== 'Texture2D') continue;
        const files = source.inventory.files.filter(file => file.Source === entry.Source && file.metadata.name === exportedCab
            && file.objects.some(object => object.PathID === entry.PathID && object.Type === entry.Type));
        assert.equal(files.length, 1, 'Exported texture origin is ambiguous');
        for (const value of [entry, { ...entry, Offset: files[0].Offset }]) pending.set(identity(value), value);
    }
    if (!pending.size) return [];
    resources.extractRawResources({ entries: [...pending.values()], output, studio, game, format: 'payload', dotnet, timeoutMs });
    return [path.join(output, 'extraction-report.json')];
}

/** Discover only map-prefab CABs in explicit blocks, then follow exact references. */
function prepareAtlas({ data, mapAreaConfigs, sources = [], prefabPaths = [], rootEntries, referenceIndexReport, blockRoots, output, studio, assetMap, catalogue, extractImages = false, extractAllImages = false, game = 'GI', maxObjects = 20000, maxSources = 64, dotnet, timeoutMs = 180000 }) {
    if (data) {
        catalogue = loadCatalogue(data, mapAreaConfigs);
        prefabPaths = [...new Set([...prefabPaths, ...catalogue.groups.map(group => `ART/UI/Menus/Widget/InLevel/MapLayered/LayeredMap_${group.id}`),
            ...Object.values(catalogue.mapConfigs).map(config => config.prefabPath).filter(Boolean)])];
    }
    assert(Array.isArray(sources) && Array.isArray(prefabPaths) && (sources.length || prefabPaths.length), 'Specify map-prefab sources or paths');
    assert(!extractImages || catalogue, 'Image extraction requires the map catalogue to select verified map images');
    output = path.resolve(output);
    assert(!fs.existsSync(output), 'Atlas output must be new');
    for (const source of sources) {
        const relative = path.relative(path.dirname(path.resolve(source)), output);
        assert(relative.startsWith('..') || path.isAbsolute(relative), 'Atlas output overlaps source directory');
    }
    fs.mkdirSync(output);
    const discoveryInputs = parserInputs();
    const references = referenceIndexReport && require('./map-reference-index').referenceIndex(referenceIndexReport, blockRoots);
    if (references) discoveryInputs.push(...references.inputs, hashFile(require.resolve('./map-reference-index')));
    if (prefabPaths.length) {
        assert(assetMap, 'Prefab discovery requires an exact asset map');
        const filename = path.join(output, 'prefab-candidates.json');
        const result = resources.readAssetMap({ studio, map: assetMap, output: filename, types: ['MonoBehaviour'],
            containers: [...new Set(prefabPaths.map(prefabContainer))], dotnet, timeoutMs });
        const mapInput = hashFile(assetMap); assert.equal(mapInput.sha256, result.sha256);
        discoveryInputs.push(mapInput, hashFile(filename));
        sources = [...new Set([...sources, ...result.entries.map(entry => entry.Source)])];
    }
    const inventories = [], reports = [], inspected = new Set(), seen = new Set();
    function inspect(files, named) {
        const unique = [...new Set(files.map(file => path.resolve(file)))].filter(file => !inspected.has(file));
        if (!unique.length) return;
        assert(inspected.size + unique.length <= maxSources, 'Atlas source bound exceeded');
        const directory = path.join(output, `inventory-${inventories.length}`);
        resources.inspectResourceFiles({ sources: unique, studio, game, output: directory, dotnet, timeoutMs,
            nameTypes: named ? ['GameObject', 'MonoScript'] : [] });
        inventories.push(path.join(directory, 'inspection-report.json'));
        unique.forEach(file => inspected.add(file));
    }
    inspect(sources, true);
    const inventory = JSON.parse(fs.readFileSync(path.join(output, 'inventory-0/inventory.json'), 'utf8'));
    const expectedNames = new Set(prefabPaths.map(value => value.replaceAll('\\', '/').split('/').at(-1)));
    const boundaryNames = new Set((catalogue?.limitRegions || []).map(region => region.rootName || region.name));
    const exactRoots = rootEntries && new Set(rootEntries.map(identity));
    const matchesRoot = (object, file) => exactRoots
        ? exactRoots.has(identity({ ...object, Source: file.Source, Offset: file.Offset }))
        : object.Type === 'GameObject' && (expectedNames.has(object.Name) || boundaryNames.has(object.Name) || /^(LayeredMap_\d+|Map_.*_Grp.*)$/.test(object.Name || ''));
    const mapFiles = inventory.files.filter(file => file.objects.some(object => matchesRoot(object, file)));
    const roots = mapFiles.flatMap(file => file.objects.filter(object => matchesRoot(object, file))
        .map(object => ({ Name: object.Name, Type: object.Type, PathID: object.PathID, Source: file.Source, Offset: file.Offset })));
    if (exactRoots) assert.equal(roots.length, exactRoots.size, 'Missing exact map resource root');
    fs.writeFileSync(path.join(output, 'roots.json'), JSON.stringify(roots, null, 2));
    let pending = mapFiles.flatMap(file => file.objects.filter(object => supported.has(object.Type))
        .map(object => ({ Name: object.Name || '', Type: object.Type, PathID: object.PathID, Source: file.Source, Offset: file.Offset })));
    for (let round = 0; round < 12; round++) {
        const unique = new Map(pending.filter(entry => !seen.has(identity(entry))).map(entry => [identity(entry), entry]));
        pending = [...unique.values()];
        if (!pending.length) break;
        assert(seen.size + pending.length <= maxObjects, 'Atlas object bound exceeded');
        const directory = path.join(output, `objects-${round}`);
        resources.extractRawResources({ entries: pending, output: directory, studio, game, format: 'serialized', dotnet, timeoutMs });
        reports.push(path.join(directory, 'extraction-report.json')); pending.forEach(entry => seen.add(identity(entry)));
        let parsed = maps.decodeSources(maps.loadSources(reports, inventories));
        const missing = [...new Set(parsed.objects.flatMap(object => object.references.filter(ref => ref.status === 'missing-file').map(ref => ref.PathID)))];
        if (missing.length && assetMap) {
            const found = resources.readAssetMap({ studio, map: assetMap, output: path.join(output, `dependencies-${round}.json`), pathIDs: missing,
                types: ['Sprite', 'Texture2D', 'Material', 'Shader', 'MonoScript', 'Mesh'], dotnet, timeoutMs });
            inspect(references ? references.sources(found.entries) : found.entries.map(entry => entry.Source), false);
            parsed = maps.decodeSources(maps.loadSources(reports, inventories));
        }
        pending = parsed.objects.flatMap(object => object.references.filter(ref => ref.status === 'resolved' && !ref.extracted && supported.has(ref.entry.Type)).map(ref => ref.entry));
    }
    assert(!pending.length, 'Atlas reference depth limit exceeded');
    const imageReports = [], meshReports = [], spriteReports = []; let texturePayloadReports = [];
    if (extractImages) {
        let source = maps.loadSources(reports, inventories), parsed = maps.decodeSources(source);
        const initialObjects = new Map(parsed.objects.map(object => [object.id, object]));
        const spriteEntries = extractAllImages
            ? parsed.objects.filter(object => object.entry.Type === 'Sprite').map(object => ({ ...object.entry, Name: object.decoded.name }))
            : [...new Map(parsed.objects.filter(object => object.decoded?.mesh).map(object => {
            const sprite = initialObjects.get(object.references.find(ref => ref.field === 'sprite' && ref.status === 'resolved')?.target);
            return sprite && { ...sprite.entry, Name: sprite.decoded.name };
        }).filter(Boolean).map(entry => [identity(entry), entry])).values()];
        const fullTextures = new Map();
        if (spriteEntries.length) {
            const spriteOutput = path.join(output, 'sprites');
            const spriteReport = resources.extractSpriteResources({ entries: spriteEntries, output: spriteOutput, studio, game, dotnet, timeoutMs });
            spriteReports.push(path.join(spriteOutput, 'extraction-report.json'));
            const index = resources.createResourceIndex(source.inventory);
            for (const resource of spriteReport.resources) {
                const geometry = JSON.parse(fs.readFileSync(resource.file, 'utf8'));
                const resolved = index.resolve({ ...resource, ...geometry.texture });
                assert.equal(resolved.status, 'resolved', 'Mesh Sprite texture pointer must resolve exactly');
                assert.equal(resolved.entry.Type, 'Texture2D'); fullTextures.set(identity(resolved.entry), resolved.entry);
            }
            const missing = [...fullTextures.values()].filter(entry => !source.objects.has(identity(entry)));
            if (missing.length) {
                const rawOutput = path.join(output, 'sprite-texture-objects');
                resources.extractRawResources({ entries: missing, output: rawOutput, studio, game, format: 'serialized', dotnet, timeoutMs });
                reports.push(path.join(rawOutput, 'extraction-report.json'));
                source = maps.loadSources(reports, inventories); parsed = maps.decodeSources(source);
            }
        }
        const atlas = require('../extract/maps/atlas').buildNativeAtlas({ ...parsed, images: rectangularImages(parsed) }, catalogue);
        const byId = new Map(parsed.objects.map(object => [object.id, object]));
        const target = (object, field) => byId.get(object?.references.find(ref => ref.field === field && ref.status === 'resolved')?.target);
        const rootName = image => {
            let transform = byId.get(image.rectTransform); const seen = new Set();
            while (transform?.decoded?.parent?.PathID !== '0') {
                if (!transform || seen.has(transform.id)) return null;
                seen.add(transform.id); transform = target(transform, 'parent');
            }
            return target(transform, 'gameObject')?.name;
        };
        const boundaryImages = parsed.images.filter(image => boundaryNames.has(rootName(image)));
        const extraTextures = boundaryImages.map(image => target(byId.get(image.material?.id), 'textures._SecTex')).filter(Boolean)
            .map(object => ({ ...object.entry, Name: object.decoded.name }));
        const fullTextureEntries = parsed.objects.filter(object => fullTextures.has(identity(object.entry))).map(object => ({ ...object.entry, Name: object.decoded.name }));
        const additionalImages = extractAllImages ? parsed.objects.filter(object => ['Sprite', 'Texture2D'].includes(object.entry.Type))
            .map(object => ({ ...object.entry, Name: object.decoded.name })) : [];
        const entries = [...new Map([...atlas.images, ...boundaryImages].map(image => image.entry).concat(extraTextures, fullTextureEntries, additionalImages).map(entry => [identity(entry), entry])).values()];
        assert(entries.length, 'No verified map images found');
        const imageReport = resources.extractResources({ entries, output: path.join(output, 'images'), studio, game, selection: 'preserve', dotnet, timeoutMs });
        texturePayloadReports = verifyExportOrigins(maps.loadSources(reports, inventories), imageReport,
            { output: path.join(output, 'image-payloads'), studio, game, dotnet, timeoutMs });
        imageReports.push(path.join(output, 'images/extraction-report.json'));
        const meshEntries = parsed.objects.filter(object => object.entry.Type === 'Mesh').map(object => ({ ...object.entry, Name: object.decoded.name }));
        if (meshEntries.length) {
            resources.extractMeshResources({ entries: meshEntries, output: path.join(output, 'meshes'), studio, game, dotnet, timeoutMs });
            meshReports.push(path.join(output, 'meshes/extraction-report.json'));
        }
    }
    const file = path.join(output, 'map-resources.json');
    const result = maps.buildCache({ reports, inventories, imageReports, texturePayloadReports, meshReports, spriteReports, output: file });
    // RectTransform is a layout frame for MeshImage, not its drawable geometry.
    // Retain the component, mesh and texture assets, but never advertise its
    // rectangular frame as a 2D image placement to the semantic atlas builder.
    result.images = rectangularImages(result);
    result.inputs.push(...discoveryInputs, hashFile(path.join(output, 'roots.json')));
    result.discovery = { expectedPrefabPaths: prefabPaths, missingRootNames: [...expectedNames].filter(name => !roots.some(root => root.Name === name)),
        boundaryRootNames: roots.filter(root => boundaryNames.has(root.Name)).map(root => root.Name) };
    fs.writeFileSync(file, JSON.stringify(result, null, 2) + '\n');
    return { file, roots: roots.length, objects: result.objects.length, images: result.images.length, diagnostics: result.diagnostics.length, missingRootNames: result.discovery.missingRootNames };
}
module.exports = { prepareAtlas, prefabContainer, loadCatalogue, rectangularImages, parserInputs };
if (require.main === module) {
    assert(process.argv.length === 3, 'Usage: node resources/map-atlas.js PLAN.json');
    console.log(JSON.stringify(prepareAtlas(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')))));
}
