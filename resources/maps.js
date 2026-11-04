const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const resources = require('@inteyvat-wiki/resource-tools');
const { decodeObject, objectPointers, mapMaterialParameters, rectCorners } = require('../extract/maps/unity');
const schema = 1;
const supported = new Set(['GameObject', 'Transform', 'RectTransform', 'MonoBehaviour', 'MonoScript', 'Material', 'Shader', 'Mesh', 'Sprite', 'Texture2D']);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function identity(entry) { return `${path.resolve(entry.Source)}\0${entry.Offset}\0${entry.PathID}`; }
function sourceName(source) { return source.replaceAll('\\', '/').split('/').at(-1).toLowerCase(); }
function publicId(entry) {
    // Paths select exact local inputs, but moving an installation must not rename
    // public records. Distinct sources with the same basename are rejected below.
    return `map-resource-${sha(`${sourceName(entry.Source)}\0${entry.Offset}\0${entry.PathID}\0${entry.Type}`).slice(0, 24)}`;
}
function fileHash(file) { const bytes = fs.readFileSync(file); return { file: path.resolve(file), bytes: bytes.length, sha256: sha(bytes) }; }
function verify(input) {
    const current = fileHash(input.file);
    assert.equal(current.sha256, input.sha256, `Stale map resource: ${input.file}`);
    if (input.bytes !== undefined) assert.equal(current.bytes, input.bytes, `Map resource length changed: ${input.file}`);
    return current;
}
function loadSources(reportFiles, inventoryFiles) {
    const inputs = new Map(), objects = new Map(), inventory = { schema: 1, files: [] }, sourceNames = new Map();
    const rememberSource = source => {
        const name = sourceName(source), full = path.resolve(source), prior = sourceNames.get(name);
        assert(!prior || prior === full, `Ambiguous map source basename: ${name}; select one verified source revision`);
        sourceNames.set(name, full);
    };
    const remember = input => { const checked = verify(input), prior = inputs.get(checked.file); assert(!prior || prior.sha256 === checked.sha256, 'Conflicting map resource inputs'); inputs.set(checked.file, checked); };
    const read = file => { const input = fileHash(file); remember(input); return JSON.parse(fs.readFileSync(file, 'utf8')); };
    for (const filename of inventoryFiles) {
        const report = read(filename);
        assert.equal(report.kind, 'inventory'); assert.equal(report.status, 'complete');
        for (const input of report.inputs) remember(input);
        remember(report.inventory);
        const data = read(report.inventory.file);
        assert.equal(data.schema, 1);
        for (const file of data.files) rememberSource(file.Source);
        inventory.files.push(...data.files);
    }
    // Preserve duplicate CABs at distinct origins: resource-tools reports ambiguity.
    const seenFiles = new Map();
    const core = file => JSON.stringify({ ...file, objects: file.objects.map(({ Name, nameError, ...object }) => object) });
    inventory.files = inventory.files.filter(file => { const key = `${file.Source}\0${file.Offset}`, prior = seenFiles.get(key);
        if (prior) { assert.equal(core(file), core(prior), `Conflicting repeated inventory origin: ${key}`); return false; }
        seenFiles.set(key, file); return true; });
    for (const filename of reportFiles) {
        const report = read(filename);
        assert.equal(report.kind, 'raw'); assert.equal(report.format, 'serialized'); assert.equal(report.status, 'complete');
        for (const input of report.inputs) remember(input);
        assert(Array.isArray(report.resources) && report.resources.length === report.entries.length, 'Incomplete map extraction report');
        for (let i = 0; i < report.resources.length; i++) {
            const resource = report.resources[i]; remember(resource); assert(resource.metadata, 'Missing map metadata'); remember(resource.metadata);
            const metadata = read(resource.metadata.file), entry = metadata.entry;
            rememberSource(entry.Source);
            assert.equal(identity(resource), identity(entry), 'Map metadata identity mismatch');
            assert.equal(identity(report.entries[i]), identity(entry), 'Map extraction order mismatch');
            assert.equal(resource.Type, entry.Type, 'Map type mismatch');
            const key = identity(entry), prior = objects.get(key);
            assert(!prior || prior.source.sha256 === resource.sha256, 'Conflicting map object bytes');
            objects.set(key, { id: publicId(entry), entry, metadata, source: { file: resource.file, bytes: resource.bytes, sha256: resource.sha256 }, bytes: fs.readFileSync(resource.file) });
        }
    }
    return { inputs: [...inputs.values()], objects, inventory };
}
function decodeSources(source) {
    const index = resources.createResourceIndex(source.inventory), decoded = new Map(), diagnostics = [];
    for (const [key, object] of source.objects) {
        try { decoded.set(key, decodeObject(object.bytes, object.metadata)); }
        catch (error) { diagnostics.push({ object: object.id, code: 'unsupported-layout', detail: error.message }); }
    }
    function resolve(object, pointer) { return index.resolve({ Source: object.entry.Source, Offset: object.entry.Offset, ...pointer }); }
    for (const [key, object] of source.objects) {
        const value = decoded.get(key);
        if (value?.type !== 'MonoBehaviour') continue;
        const target = resolve(object, value.script);
        const script = target.status === 'resolved' ? decoded.get(identity(target.entry)) : undefined;
        if (!script) continue;
        try { decoded.set(key, decodeObject(object.bytes, object.metadata, script)); }
        catch (error) { diagnostics.push({ object: object.id, code: 'unsupported-component-layout', detail: error.message }); }
    }
    const objects = [...source.objects].map(([key, object]) => {
        const value = decoded.get(key);
        const references = objectPointers(value || {}).map(pointer => {
            const result = resolve(object, pointer);
            return { field: pointer.field, fileID: pointer.fileID, PathID: pointer.PathID, status: result.status,
                ...(result.status === 'resolved' ? { target: publicId(result.entry), entry: result.entry, extracted: source.objects.has(identity(result.entry)) } : {}) };
        });
        if (value?.decodeStatus && value.decodeStatus !== 'decoded') diagnostics.push({ object: object.id, code: value.decodeStatus, detail: value.className || value.type });
        for (const reference of references) if (!['resolved', 'null'].includes(reference.status)) diagnostics.push({ object: object.id, code: reference.status, detail: reference.field });
        return { id: object.id, kind: 'unity-object', name: value?.name || object.entry.Name || object.id, entry: object.entry, serializedFile: object.metadata.serializedFile,
            source: object.source, decoded: value || null, references,
            ...(value?.type === 'Material' ? { material: mapMaterialParameters(value) } : {}) };
    });
    const byId = new Map(objects.map(object => [object.id, object]));
    const target = (object, field) => {
        const ref = object.references.find(ref => ref.field === field && ref.status === 'resolved');
        return ref && byId.get(ref.target);
    };
    for (const object of objects) {
        if (!object.material) continue;
        const shader = target(object, 'shader');
        // This byte-identical shader was independently inspected during the map
        // study. A familiar property/name in a new shader is not enough evidence.
        if (shader?.source.sha256 === '081f89e507d7a1b280fb1f6ed75e0de19ab5e9ebe5e2e88d1f33b86884fefd9a') {
            object.material.softEdgeProfile = 'open-area-base-map-separable-v1';
            object.material.shaderStatus = 'verified-shader-bytes';
        } else object.material.shaderStatus = 'unverified-shader';
    }
    for (const object of objects) {
        if (object.decoded?.type !== 'RectTransform') continue;
        const ancestors = [], visited = new Set([object.id]); let current = object;
        try {
            while (current.decoded.parent.PathID !== '0') {
                const ref = current.references.find(ref => ref.field === 'parent');
                assert(ref?.status === 'resolved' && ref.extracted, 'Map transform parent is missing');
                assert(!visited.has(ref.target), 'Map transform parent cycle'); visited.add(ref.target);
                current = byId.get(ref.target); assert(['Transform', 'RectTransform'].includes(current?.decoded?.type), 'Map transform parent layout is unsupported');
                ancestors.push(current.decoded);
            }
            object.geometry = { coordinateSpace: 'prefab-ui', corners: rectCorners(object.decoded, ancestors), projectionStatus: 'not-calibrated' };
        } catch (error) { diagnostics.push({ object: object.id, code: 'geometry-unresolved', detail: error.message }); }
    }
    const images = [];
    for (const object of objects) {
        if (!object.decoded?.sprite || object.decoded.decodeStatus !== 'decoded') continue;
        const gameObject = target(object, 'gameObject');
        const transforms = gameObject?.references.filter(ref => ref.status === 'resolved').map(ref => byId.get(ref.target)).filter(value => value?.decoded?.type === 'RectTransform') || [];
        if (transforms.length !== 1) {
            diagnostics.push({ object: object.id, code: 'image-transform-unresolved', detail: `Expected one RectTransform, got ${transforms.length}` });
            continue;
        }
        const transform = transforms[0], material = target(object, 'material'), sprite = target(object, 'sprite');
        const texture = material && target(material, 'textures._MiniMap');
        // A missing material dependency must not turn a mask's fallback Sprite
        // into its actual map texture. Keep that image unresolved instead.
        const requiresMaterial = object.decoded.material?.PathID !== '0';
        const requiresMinimap = material?.material?.texture && material.material.texture.PathID !== '0';
        const image = requiresMaterial && !material ? undefined : requiresMinimap ? texture : sprite;
        if (!image || !['Sprite', 'Texture2D'].includes(image.entry.Type) || !image.decoded?.name) {
            diagnostics.push({ object: object.id, code: 'image-asset-unresolved', detail: 'Neither exact material MiniMap nor Sprite is available' });
            continue;
        }
        images.push({ id: `map-image-${object.id.slice('map-resource-'.length)}`, imageObject: object.id, gameObject: gameObject.id, rectTransform: transform.id,
            asset: image.id, assetName: image.decoded.name, entry: { ...image.entry, Name: image.decoded.name },
            componentColor: object.decoded.color, geometry: transform.geometry || null,
            material: material ? { id: material.id, parameters: material.material || null } : null,
            visibilityStatus: 'unresolved', renderingStatus: material ? 'material-parameters-only' : 'sprite-and-component-color' });
    }
    const labels = [];
    for (const object of objects) {
        if (object.decoded?.className !== 'MonoLocalizedText' || !object.decoded.textKey) continue;
        const gameObject = target(object, 'gameObject');
        const transforms = gameObject?.references.filter(ref => ref.status === 'resolved').map(ref => byId.get(ref.target)).filter(value => value?.decoded?.type === 'RectTransform') || [];
        if (transforms.length !== 1 || !transforms[0].geometry) continue;
        let current = transforms[0]; const visited = new Set(), ancestors = [];
        while (current?.decoded?.parent?.PathID !== '0') {
            if (!current || visited.has(current.id)) { current = null; break; }
            visited.add(current.id); current = target(current, 'parent');
            const ancestor = current && target(current, 'gameObject');
            if (ancestor) ancestors.push({ id: ancestor.id, name: ancestor.name });
        }
        const root = current && target(current, 'gameObject');
        const group = /^LayeredMap_(\d+)$/.exec(root?.name || '');
        labels.push({ id: `map-label-${object.id.slice('map-resource-'.length)}`, textKey: object.decoded.textKey,
            geometry: transforms[0].geometry, entry: object.entry, gameObjectName: gameObject.name, ancestors, rootName: root?.name || '',
            ...(group ? { layerGroupId: Number(group[1]) } : {}) });
    }
    return { objects, images, labels, diagnostics };
}
function attachImages(source, parsed, imageReports, texturePayloadReports = []) {
    const images = new Map(), inputs = [], payloads = new Map();
    const remember = input => { const checked = verify(input); inputs.push(checked); };
    for (const filename of texturePayloadReports) {
        remember(fileHash(filename));
        const report = JSON.parse(fs.readFileSync(filename, 'utf8'));
        assert.equal(report.kind, 'raw'); assert.equal(report.format, 'payload'); assert.equal(report.status, 'complete');
        for (const input of report.inputs) remember(input);
        for (const resource of report.resources) {
            assert.equal(resource.Type, 'Texture2D'); remember(resource); remember(resource.metadata);
            const metadata = JSON.parse(fs.readFileSync(resource.metadata.file, 'utf8'));
            assert.equal(identity(metadata.entry), identity(resource)); assert(metadata.texture, 'Missing texture payload layout');
            payloads.set(identity(resource), { ...resource, texture: metadata.texture, cab: metadata.serializedFile.name });
        }
    }
    for (const filename of imageReports) {
        remember(fileHash(filename));
        const report = JSON.parse(fs.readFileSync(filename, 'utf8'));
        assert.equal(report.kind, 'images'); assert.equal(report.status, 'complete');
        assert.equal(report.selection, 'preserve', 'Native map images must preserve original alpha');
        for (const input of [...report.inputs, report.tool, report.assembly, report.cli]) if (input) remember(input);
        for (const batch of report.batches) {
            for (const entry of batch.entries) {
                const object = source.objects.get(identity(entry));
                assert(object && object.entry.Type === entry.Type, 'Image has no verified serialized source');
                const cab = object.metadata.serializedFile.name.toLowerCase();
                let matches = batch.validation.images.filter(image => image.name === entry.Name
                    && path.basename(path.dirname(image.file)).toLowerCase() === cab);
                let equivalence;
                // AnimeStudio's XML image export can select a duplicate PathID at
                // another block offset. Accept it only after exact payload reads
                // prove the same encoded pixels, dimensions, format and mip count.
                if (!matches.length && entry.Type === 'Texture2D') {
                    const requested = payloads.get(identity(entry));
                    const candidates = batch.validation.images.filter(image => image.name === entry.Name);
                    if (requested && candidates.length === 1) {
                        const imageCab = path.basename(path.dirname(candidates[0].file));
                        const alternatives = [...payloads.values()].filter(value => value.Source === entry.Source && value.PathID === entry.PathID && value.cab === imageCab
                            && value.sha256 === requested.sha256 && JSON.stringify(value.texture) === JSON.stringify(requested.texture));
                        if (alternatives.length === 1) {
                            matches = candidates;
                            equivalence = { method: 'equal-texture-payload-and-layout', sha256: requested.sha256,
                                requestedOffset: entry.Offset, exportedOffset: alternatives[0].Offset };
                        }
                    }
                }
                if (matches.length !== 1) {
                    parsed.diagnostics.push({ object: publicId(entry), code: 'image-export-origin-mismatch', detail: `No unique PNG from the exact serialized CAB for ${entry.Name}` });
                    continue;
                }
                const image = matches[0]; remember(image);
                const png = { file: path.resolve(image.file), bytes: image.bytes, sha256: image.sha256, width: image.width, height: image.height,
                    ...(equivalence ? { equivalence } : {}) };
                const key = identity(entry), prior = images.get(key);
                assert(!prior || prior.sha256 === png.sha256, 'Conflicting native image output');
                images.set(key, png);
            }
        }
    }
    for (const image of parsed.images) {
        const png = images.get(identity(image.entry));
        if (png) image.png = png;
    }
    return { inputs, assets: [...images].map(([key, png]) => ({ id: publicId(source.objects.get(key).entry), entry: source.objects.get(key).entry, png })) };
}
function buildCache({ reports, inventories, imageReports = [], texturePayloadReports = [], meshReports = [], spriteReports = [], output }) {
    assert(Array.isArray(reports) && reports.length, 'Specify serialized extraction reports');
    assert(Array.isArray(inventories) && inventories.length, 'Specify inspection reports');
    const source = loadSources(reports, inventories), parsed = decodeSources(source);
    const imageData = attachImages(source, parsed, imageReports, texturePayloadReports), meshInputs = [], meshes = [], sprites = [];
    for (const filename of [...meshReports, ...spriteReports]) {
        meshInputs.push(fileHash(filename)); const report = JSON.parse(fs.readFileSync(filename, 'utf8'));
        assert.equal(report.status, 'complete'); assert(['mesh', 'sprite'].includes(report.format));
        for (const input of report.inputs) meshInputs.push(verify(input));
        for (const resource of report.resources) {
            const object = source.objects.get(identity(resource)); assert(object && object.entry.Type === (report.format === 'mesh' ? 'Mesh' : 'Sprite'), 'Geometry has no serialized source');
            meshInputs.push(verify(resource), verify(resource.metadata));
            const metadata = JSON.parse(fs.readFileSync(resource.metadata.file, 'utf8'));
            assert.equal(identity(metadata.entry), identity(resource));
            const geometry = JSON.parse(fs.readFileSync(resource.file, 'utf8'));
            assert.equal(geometry.kind, report.format); assert.equal(geometry.schema, 1);
            (report.format === 'mesh' ? meshes : sprites).push({ id: object.id, entry: object.entry, source: { file: resource.file, bytes: resource.bytes, sha256: resource.sha256 }, geometry });
        }
    }
    const parser = fileHash(path.join(__dirname, '../extract/maps/unity.js'));
    const cache = { schema, parser: 'gi-map-unity-2017-v1', inputs: [...new Map([...source.inputs, ...imageData.inputs, ...meshInputs, parser, fileHash(__filename)].map(input => [input.file, input])).values()], objects: parsed.objects, images: parsed.images, imageAssets: imageData.assets, meshes, sprites, labels: parsed.labels, diagnostics: parsed.diagnostics };
    fs.writeFileSync(output, JSON.stringify(cache, null, 2) + '\n', { flag: 'wx' });
    return cache;
}
function readResourceCache(file) {
    const cache = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(cache.schema, schema, 'Rebuild map resources for this parser');
    assert.equal(cache.parser, 'gi-map-unity-2017-v1');
    for (const input of cache.inputs) verify(input);
    assert(Array.isArray(cache.objects) && Array.isArray(cache.images) && Array.isArray(cache.diagnostics), 'Invalid map resource manifest');
    return cache;
}
// Walk only actual decoded pointer fields within the caller's explicit sources.
// No disk scan, implicit base/update preference, execution or image extraction.
function prepare({ sources, roots, output, studio, game = 'GI', maxObjects = 512, maxRounds = 16, timeoutMs, dotnet }) {
    assert(Array.isArray(sources) && sources.length && Array.isArray(roots) && roots.length, 'Specify sources and exact root entries');
    assert(Number.isSafeInteger(maxObjects) && maxObjects > 0 && Number.isSafeInteger(maxRounds) && maxRounds > 0, 'Invalid map traversal limits');
    const destination = path.resolve(output);
    for (const source of sources) {
        const relative = path.relative(path.dirname(path.resolve(source)), destination);
        assert(relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative), 'Map output must be outside source directories');
    }
    fs.mkdirSync(output); // exclusive root; preserve all partial work on failure
    const inspection = resources.inspectResourceFiles({ sources, output: path.join(output, 'inventory'), studio, game, timeoutMs, dotnet });
    const inventoryFile = path.join(output, 'inventory', 'inspection-report.json');
    const index = resources.createResourceIndex(inspection.inventory);
    let pending = roots.map(root => {
        const result = index.resolve({ Source: root.Source, Offset: root.Offset, fileID: 0, PathID: root.PathID });
        assert.equal(result.status, 'resolved', 'Map root could not be resolved'); assert.equal(result.entry.Type, root.Type, 'Map root type mismatch'); return result.entry;
    });
    const reports = [], seen = new Set(); let parsed;
    for (let round = 0; pending.length; round++) {
        assert(round < maxRounds, 'Map dependency round limit exceeded; partial files retained');
        pending = pending.filter(entry => !seen.has(identity(entry)) && supported.has(entry.Type));
        if (!pending.length) break;
        const unique = new Map(pending.map(entry => [identity(entry), entry])); pending = [...unique.values()];
        assert(seen.size + pending.length <= maxObjects, 'Map dependency object limit exceeded; partial files retained');
        const directory = path.join(output, `objects-${String(round).padStart(2, '0')}`);
        resources.extractRawResources({ entries: pending, output: directory, studio, game, format: 'serialized', includeTypeTree: true, timeoutMs, dotnet });
        reports.push(path.join(directory, 'extraction-report.json')); pending.forEach(entry => seen.add(identity(entry)));
        parsed = decodeSources(loadSources(reports, [inventoryFile]));
        pending = parsed.objects.flatMap(object => object.references.filter(ref => ref.status === 'resolved' && !ref.extracted && supported.has(ref.entry.Type)).map(ref => ref.entry));
    }
    const filename = path.join(output, 'map-resources.json');
    const cache = buildCache({ reports, inventories: [inventoryFile], output: filename });
    return { file: filename, objects: cache.objects.length, diagnostics: cache.diagnostics.length };
}
module.exports = { prepare, buildCache, readResourceCache, loadSources, decodeSources, publicId };
if (require.main === module) {
    const [command, filename] = process.argv.slice(2);
    assert(['prepare', 'build'].includes(command) && filename && process.argv.length === 4, 'Usage: node resources/maps.js prepare|build PLAN.json');
    const options = JSON.parse(fs.readFileSync(filename, 'utf8'));
    const result = command === 'prepare' ? prepare(options) : buildCache(options);
    console.log(JSON.stringify(command === 'prepare' ? result : { output: options.output, objects: result.objects.length, diagnostics: result.diagnostics.length }));
}
