const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const tools = require('@inteyvat-wiki/resource-tools');
const { evidence, read, hash, verify, identity, assetKey } = require('./map-evidence');
const { decodeObject } = require('../extract/maps/unity');
const { fogMaterialFormats } = require('../extract/maps/fog');
const { projectGeometry } = require('../extract/maps/atlas');
const profiles = {
    mask: '40af7ea7572e7608824a2672c11963fc70072d7141d1d6c4005b9774d51b51cd',
    outline: '3434b726f5adb327c35d23a3c52f6c54f392b03968d33425c15d2d658b5f3293',
    fog: '214a562537432aeea0d1da970171e520988f96b7580060ecaecd8ec3e539e8b6',
};
const codeFiles = () => [__filename, require.resolve('../extract/maps/fog'), require.resolve('./map-evidence')];
function buildCache({ baseCacheFile, materialReportFile, textureReportFile, imageReportFile, shaderReportFile, output }) {
    const e = evidence(), base = require('./map-base').readResourceCache(baseCacheFile);
    e.file(baseCacheFile); for (const input of base.inputs) e.remember(input);
    const prefab = e.file(base.plan.prefabCacheFile), byId = new Map(prefab.objects.map(o => [o.id, o]));
    const target = (o, field) => byId.get(o?.references.find(r => r.field === field && r.status === 'resolved')?.target);
    const roots = o => { const seen = new Set(); while (o?.decoded.parent?.PathID !== '0') { assert(o && !seen.has(o.id)); seen.add(o.id); o = target(o, 'parent'); } return target(o, 'gameObject'); };
    const raw = [materialReportFile, textureReportFile, shaderReportFile].flatMap(file => e.report(file, 'serialized').resources)
        .map(o => ({ ...o, metadataValue: read(o.metadata.file), decoded: decodeObject(fs.readFileSync(o.file), read(o.metadata.file)) }));
    const pictures = e.report(imageReportFile); assert.equal(pictures.kind, 'images'); assert.equal(pictures.selection, 'preserve');
    const resolve = (origin, pointer) => {
        const metadata = origin.metadataValue?.serializedFile || origin.serializedFile;
        const cab = pointer.fileID ? metadata.externals.find(v => v.fileID === pointer.fileID)?.fileName : metadata.name;
        assert(cab, 'Fog pointer has no serialized-file identity');
        const found = raw.filter(o => o.PathID === pointer.PathID && o.metadataValue.serializedFile.name.toLowerCase() === cab.toLowerCase());
        if (found.length === 1) return found[0];
        const existing = prefab.objects.filter(o => o.entry.PathID === pointer.PathID && o.serializedFile.name.toLowerCase() === cab.toLowerCase());
        assert.equal(existing.length, 1, 'Fog reference must resolve by CAB and PathID'); return existing[0];
    };
    const parameters = material => Object.fromEntries([...material.decoded.floats, ...material.decoded.colors].map(p => [p.name, p.value]));
    const image = object => {
        const entry = object.entry || object, cab = object.metadataValue?.serializedFile.name || object.serializedFile.name;
        const matches = pictures.batches.filter(b => b.entries.some(item => identity(item) === identity(entry)))
            .flatMap(b => b.validation.images).filter(p => p.name === object.decoded.name && path.basename(path.dirname(p.file)).toLowerCase() === cab.toLowerCase());
        assert.equal(matches.length, 1, 'Fog PNG origin mismatch');
        const png = matches[0]; e.remember(png); const checked = tools.validatePng(fs.readFileSync(png.file)); assert.equal(checked.sha256, png.sha256);
        return { file: png.file, sha256: png.sha256, width: checked.width, height: checked.height };
    };
    const texture = (material, name) => {
        const value = material.decoded.textures.find(v => v.name === name); assert(value);
        return { image: image(resolve(material, value.texture)), scale: value.scale, offset: value.offset };
    };
    const shader = (material, kind) => {
        const resolved = resolve(material, material.decoded.shader), source = resolved.source || resolved;
        assert.equal(source.sha256, profiles[kind], `Unverified ${kind} fog shader`);
        return source.sha256;
    };
    const scenes = [];
    for (const scene of base.scenes) {
        // Select by serialized material references, not a scene-ID exception.
        const materials = raw.filter(o => o.Type === 'Material');
        if (!scene.controller.groups.some(group => group.references.some(pointer => prefab.objects.some(o => o.entry.PathID === pointer.PathID
            && o.entry.Type === 'RectTransform' && materials.some(m => m.Name === target(o, 'gameObject')?.name))))) continue;
        const formats = fogMaterialFormats(fs.readFileSync(scene.controllerSource.file), scene.controller.unparsedOffset);
        const selected = scene.controller.groups.flatMap(group => [formats.mask, formats.outline].map(format => format.replace('{0}', group.id)));
        if (!selected.some(name => materials.some(m => m.Name === name))) continue;
        const rootName = scene.config.prefabPath.split('/').at(-1);
        const projections = { [scene.sceneId]: scene.projection };
        const geometry = transform => { assert.equal(roots(transform)?.name, rootName); const result = projectGeometry(transform.geometry, scene.sceneId, projections); assert(result); return result; };
        const layers = scene.controller.groups.map(group => {
            const parts = group.references.map((pointer, index) => {
                assert.equal(pointer.fileID, 0);
                const transforms = prefab.objects.filter(o => o.entry.PathID === pointer.PathID && o.entry.Type === 'RectTransform' && roots(o)?.name === rootName);
                assert.equal(transforms.length, 1); const transform = transforms[0];
                const name = [formats.mask, formats.outline][index].replace('{0}', group.id);
                assert.equal(target(transform, 'gameObject')?.name, name);
                const found = materials.filter(m => m.Name === name); assert.equal(found.length, 1, `Incomplete fog material selection: ${name}`);
                const material = found[0]; assert.equal(material.Container, assetKey(formats.directory + name + '.Material').container);
                const params = parameters(material); shader(material, index ? 'outline' : 'mask');
                assert.deepEqual(params._FogRGBA, [1, 0, 0, 0]); assert.equal(params._UseUISmoothMask, 0);
                assert.equal(params._Stencil, 129); assert.equal(params._StencilReadMask, 129); assert.equal(params._StencilComp, 6);
                assert.equal(params._StencilOp, index ? 0 : 2); assert.equal(params._SrcBlendMode, 5); assert.equal(params._DstBlendMode, 10);
                const mask = texture(material, '_Mask'), warp = texture(material, '_WarpMask');
                return { geometry: geometry(transform), mask: mask.image, warp,
                    render_order: target(transform, 'parent').decoded.children.findIndex(p => p.PathID === transform.entry.PathID),
                    flow: params._FlowLine, warp_tiling: params._WarpMaskTilling, clip: params._Clip,
                    serialized_open: params._OpenAreaLerp,
                    ...(index ? { edge_threshold: params._OutlineRange, edge_power: params._OulineFadeRange,
                        edge_color: params._OutlineColor, fade_color: params._OutlineFadeColor } : {}),
                    sources: { transform: transform.source, material: { file: material.file, sha256: material.sha256 } } };
            });
            return { area_id: group.id, mask: parts[0], outline: parts[1] };
        });
        const fogImages = prefab.objects.filter(o => o.decoded?.className === 'SmoothMaskClipableImage'
            && target(o, 'gameObject')?.name === 'Fog' && roots(target(o, 'gameObject')?.references.map(r => byId.get(r.target)).find(t => t?.entry.Type === 'RectTransform'))?.name === rootName);
        assert.equal(fogImages.length, 1); const component = fogImages[0], material = target(component, 'material'); assert(material);
        const fogTransform = target(component, 'gameObject').references.map(r => byId.get(r.target)).find(t => t?.entry.Type === 'RectTransform');
        const params = parameters(material); shader(material, 'fog');
        assert.equal(params._Stencil, 129); assert.equal(params._StencilComp, 6); assert.equal(params._StencilOp, 0);
        assert.equal(params._UseUISmoothMask, 0); assert.equal(params._SrcBlendMode, 5); assert.equal(params._DstBlendMode, 10);
        scenes.push({ scene_id: scene.sceneId, shader_profile: 'open-area-stencil-fog-7.1-v1', projection: scene.projection,
            preview: 'all-areas-open-time-zero', groups: layers, fog: { geometry: geometry(fogTransform),
                textures: Object.fromEntries(['_WarpCloud', '_StarMap', '_StarMask', '_StarCloudMap', '_NoiseMap', '_CloudMap01', '_CloudMap02'].map(name => [name, texture(material, name)])),
                parameters: params, component_color: component.decoded.color, sources: { material: material.source, transform: fogTransform.source } },
            sources: { controller: scene.controllerSource, formats, shaders: profiles } });
    }
    assert(scenes.length, 'No complete native fog scene');
    for (const code of codeFiles()) e.remember(hash(code));
    const plan = { baseCacheFile, materialReportFile, textureReportFile, imageReportFile, shaderReportFile };
    const cache = { schema: 1, parser: 'gi-map-outside-fog-7.1-v1', inputs: [...e.inputs.values()], plan, scenes };
    if (output) fs.writeFileSync(output, JSON.stringify(cache, null, 2) + '\n', { flag: 'wx' }); return cache;
}
function readResourceCache(file) {
    const cache = read(file); assert.equal(cache.schema, 1); assert.equal(cache.parser, 'gi-map-outside-fog-7.1-v1');
    for (const input of cache.inputs) verify(input);
    for (const code of codeFiles()) assert(cache.inputs.some(input => path.resolve(input.file) === code && input.sha256 === hash(code).sha256), 'Rebuild outside fog cache for current parser');
    assert.deepEqual(cache.scenes, buildCache(cache.plan).scenes); return cache;
}
/** Exact, bounded discovery from MonoLevelMap, followed by material PPtrs. */
function prepare({ baseCacheFile, sceneIds, studio, map, output, timeoutMs = 240000 }) {
    assert(Array.isArray(sceneIds) && sceneIds.length && sceneIds.every(Number.isSafeInteger));
    const base = require('./map-base').readResourceCache(baseCacheFile), prefab = read(base.plan.prefabCacheFile);
    const scenes = base.scenes.filter(s => sceneIds.includes(s.sceneId)); assert.equal(scenes.length, new Set(sceneIds).size);
    output = path.resolve(output); fs.mkdirSync(output);
    const names = scenes.flatMap(scene => {
        const formats = fogMaterialFormats(fs.readFileSync(scene.controllerSource.file), scene.controller.unparsedOffset);
        return scene.controller.groups.flatMap(group => [formats.mask, formats.outline].map(format => format.replace('{0}', group.id)));
    });
    const found = tools.readAssetMap({ studio, map, output: path.join(output, 'materials-map.json'), names, types: ['Material'], timeoutMs });
    assert.equal(found.entries.length, names.length, 'Incomplete fog material discovery');
    const materials = tools.extractRawResources({ entries: found.entries, studio, game: 'GI', format: 'serialized', output: path.join(output, 'materials'), timeoutMs });
    const decoded = materials.resources.map(o => ({ ...o, metadata: read(o.metadata.file), decoded: decodeObject(fs.readFileSync(o.file), read(o.metadata.file)) }));
    const inventories = prefab.inputs.filter(input => path.basename(input.file) === 'inventory.json').map(input => read(input.file));
    const shaders = new Map();
    for (const material of decoded) {
        const pointer = material.decoded.shader, cab = material.metadata.serializedFile.externals.find(x => x.fileID === pointer.fileID)?.fileName;
        const matches = inventories.flatMap(i => i.files.filter(f => f.metadata.name.toLowerCase() === cab?.toLowerCase())
            .flatMap(f => f.objects.filter(o => o.PathID === pointer.PathID && o.Type === 'Shader')
                .map(o => ({ Name: '', Type: o.Type, PathID: o.PathID, Source: f.Source, Offset: f.Offset }))));
        const unique = new Map(matches.map(entry => [identity(entry), entry])); assert.equal(unique.size, 1, 'Fog shader origin missing from verified inventories');
        for (const [key, entry] of unique) shaders.set(key, entry);
    }
    tools.extractRawResources({ entries: [...shaders.values()], studio, game: 'GI', format: 'serialized', output: path.join(output, 'shaders'), timeoutMs });
    // The background material is already part of the base prefab's reference closure.
    const fogMaterials = prefab.objects.filter(o => o.entry.Type === 'Material' && o.decoded.name === 'Fog');
    const ids = [...new Set([...decoded.flatMap(o => o.decoded.textures.filter(t => ['_Mask', '_WarpMask'].includes(t.name)).map(t => t.texture.PathID)),
        ...fogMaterials.flatMap(o => o.decoded.textures.map(t => t.texture.PathID))].filter(id => id !== '0'))];
    const textures = tools.readAssetMap({ studio, map, output: path.join(output, 'textures-map.json'), pathIDs: ids, types: ['Texture2D'], timeoutMs });
    assert.equal(textures.entries.length, ids.length, 'Incomplete fog texture discovery');
    tools.extractRawResources({ entries: textures.entries, studio, game: 'GI', format: 'serialized', output: path.join(output, 'textures'), timeoutMs });
    tools.extractResources({ entries: textures.entries, studio, game: 'GI', selection: 'preserve', output: path.join(output, 'images'), timeoutMs });
    const plan = { baseCacheFile, materialReportFile: path.join(output, 'materials/extraction-report.json'), textureReportFile: path.join(output, 'textures/extraction-report.json'),
        imageReportFile: path.join(output, 'images/extraction-report.json'), shaderReportFile: path.join(output, 'shaders/extraction-report.json'), output: path.join(output, 'map-fog.json') };
    fs.writeFileSync(path.join(output, 'plan.json'), JSON.stringify(plan, null, 2) + '\n');
    return buildCache(plan);
}
module.exports = { buildCache, readResourceCache, prepare };
if (require.main === module) {
    const args = process.argv.slice(2), plan = read(args.at(-1)), cache = args[0] === 'prepare' ? prepare(plan) : buildCache(plan);
    console.log(JSON.stringify({ output: plan.output, scenes: cache.scenes.length, groups: cache.scenes.reduce((n, s) => n + s.groups.length, 0) }));
}
