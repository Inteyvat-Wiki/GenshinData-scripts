const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { evidence, read, hash, assetKey } = require('./map-evidence');
const { parseIndex } = require('./miliastra');
const { graph } = require('../extract/maps/native-effects');
const { decodeLevelMap, mapProjection } = require('../extract/maps/base');
const { fogMaterialFormats } = require('../extract/maps/fog');
const { projectGeometry } = require('../extract/maps/atlas');
const PROFILE = 'gi-native-map-effects-v1';
const shaders = {
    image: '6485c9365b19f8a56995a8a39e5d1488b6383bc56486f8ffc02a52dd1b828911',
    mask: '40af7ea7572e7608824a2672c11963fc70072d7141d1d6c4005b9774d51b51cd',
    outline: '3434b726f5adb327c35d23a3c52f6c54f392b03968d33425c15d2d658b5f3293',
    fog: '214a562537432aeea0d1da970171e520988f96b7580060ecaecd8ec3e539e8b6',
};
const codeFiles = () => [__filename, require.resolve('../extract/maps/native-effects'), require.resolve('../extract/maps/base'),
    require.resolve('../extract/maps/fog'), require.resolve('../extract/maps/atlas'), require.resolve('./map-evidence')];
const parameters = m => Object.fromEntries([...m.decoded.floats, ...m.decoded.colors].map(v => [v.name, v.value]));
function buildCache(plan) {
    const proof = evidence();
    const load = (file, module) => { const cache = require(module).readResourceCache(file); proof.file(file); cache.inputs.forEach(proof.remember); return cache; };
    const cache = load(plan.prefabCacheFile, './maps'), entries = load(plan.entryCacheFile, './map-entries');
    const limits = load(plan.outlineCacheFile, './map-limit-outlines');
    const indexReport = proof.report(plan.artIndexReportFile, 'payload'); assert.equal(indexReport.resources.length, 1);
    const indexBytes = fs.readFileSync(indexReport.resources[0].file);
    const g = graph(cache), { target, transform, root, geometry, image } = g;
    const selected = entries.entries.filter(e => e.sceneIds.some(id => plan.sceneIds.includes(id)));
    assert(selected.length && selected.every(e => e.status === 'map-config'), 'Selected scene map entry is unresolved');
    const requests = new Set(selected.map(e => assetKey(e.config.prefabPath + '.GameObject').resource_key));
    for (const o of cache.objects.filter(o => o.decoded?.className === 'MonoLevelMap' && target(o, 'gameObject'))) {
        const controller = decodeLevelMap(fs.readFileSync(o.source.file));
        if (!plan.sceneIds.includes(controller.sceneId) || controller.groups.every(group => group.references.every(p => p.PathID === '0'))) continue;
        const formats = fogMaterialFormats(fs.readFileSync(o.source.file), controller.unparsedOffset);
        for (const group of controller.groups) for (const format of [formats.mask, formats.outline])
            requests.add(assetKey(formats.directory + format.replace('{0}', group.id) + '.Material').resource_key);
    }
    const packs = parseIndex(indexBytes, requests);
    const inPack = (o, pack) => Number(path.basename(o.entry.Source, '.blk')) === pack.block && o.entry.Offset === pack.offset;
    const address = (asset, type) => {
        const pack = packs.get(assetKey(asset).resource_key)?.pack; assert(pack, `Missing indexed asset: ${asset}`);
        return cache.objects.filter(o => o.entry.Type === type && inPack(o, pack));
    };
    const checkShader = (material, kind) => assert.equal(target(material, 'shader')?.source.sha256, shaders[kind], `Unsupported ${kind} shader`);
    const records = {}, diagnostics = [];
    const record = (id, scene, data, source, relations = []) => ({ schema: 1, id, kind: 'resource', name: '', description: '', texts: [],
        relations: [{ role: 'scene', category: 'maps', id: `scene-${scene}` }, ...relations], data: { ...data, scene_id: scene },
        source: { file: path.resolve(plan.prefabCacheFile), id: source.entry.PathID, hashes: [], fields: [] }, diagnostics: [] });
    for (const link of selected) {
        const roots = address(link.config.prefabPath + '.GameObject', 'GameObject').filter(o => transform(o).decoded.parent.PathID === '0');
        assert.equal(roots.length, 1, 'Map prefab root is ambiguous'); const sceneRoot = roots[0];
        const components = sceneRoot.references.map(r => g.objects.get(r.target));
        const controllers = components.filter(o => o?.decoded?.className === 'MonoLevelMap'); assert.equal(controllers.length, 1);
        const controllerObject = controllers[0], controller = decodeLevelMap(fs.readFileSync(controllerObject.source.file));
        const scene = controller.sceneId; assert(link.sceneIds.includes(scene));
        const projection = mapProjection(link.config, controller), projections = { [scene]: projection };
        const guides = cache.objects.filter(o => o.decoded?.type === 'RectTransform' && target(o, 'parent')?.id === transform(sceneRoot).id
            && target(o, 'gameObject')?.name === 'GuideArea');
        assert.equal(guides.length, 1); const guide = guides[0].decoded;
        assert.deepEqual(guide.position, [0, 0, 0]); assert.deepEqual(guide.rotation, [0, 0, 0, 1]); assert.equal(guide.scale[0], guide.scale[1]);
        const boundaryProjection = { [scene]: { ...projection, scale: projection.scale * guide.scale[0] } };
        for (const limit of limits.outlines.filter(o => o.sceneId === scene && o.polygon.map_back_prefab)) {
            const prefab = limit.polygon.map_back_prefab;
            const candidates = cache.objects.filter(o => o.entry.Type === 'GameObject' && inPack(o, prefab)
                && transform(o).decoded.parent.PathID === '0');
            if (!candidates.length) continue; assert.equal(candidates.length, 1);
            const boundaryRoot = candidates[0], parts = [];
            function walk(rect) {
                const go = target(rect, 'gameObject');
                if (go.decoded.active === false) return;
                for (const ref of go.references) {
                    const o = g.objects.get(ref.target);
                    if (!o?.decoded?.sprite || !o.decoded.enabled || o.decoded.mesh) continue;
                    assert.equal(o.decoded.decodeStatus, 'decoded');
                    const mat = target(o, 'material'); let blend = 'normal';
                    if (mat) {
                        checkShader(mat, 'image'); const p = parameters(mat);
                        assert.equal(p._UseUISmoothMask, 0); assert.equal(p._StencilComp, 8);
                        assert.equal(p._SrcBlendMode, 5); assert([1, 10].includes(p._DstBlendMode));
                        assert.equal(p._ColorScaler, 1); assert.deepEqual(p._Color, [1, 1, 1, 1]);
                        blend = p._DstBlendMode === 1 ? 'additive' : 'normal';
                    }
                    const png = image(target(o, 'sprite'));
                    parts.push({ id: o.id, image_file: png.file, image_sha256: png.sha256,
                        display_geometry: projectGeometry(geometry(rect), scene, boundaryProjection), color: o.decoded.color,
                        blend, order: parts.length, source: o.source });
                }
                for (const ref of rect.references.filter(r => r.field.startsWith('children['))) walk(g.objects.get(ref.target));
            }
            walk(transform(boundaryRoot));
            // MapBack also contains full map replacement images (e.g. Fairybook).
            // Only a verified additive border material establishes this family.
            if (!parts.some(p => p.blend === 'additive')) { diagnostics.push({ scene, limit: limit.id, code: 'not-a-sprite-boundary' }); continue; }
            const id = `resource-boundary-${boundaryRoot.id.replace('map-resource-', '')}`;
            records[id] = record(id, scene, { category: 'native-boundary', status: 'static-serialized-state',
                shader_profile: 'native-sprite-boundary-v1', parts, limit_region_id: limit.id }, boundaryRoot,
            [{ role: 'limit_region', category: 'maps', id: `limit-region-${limit.id}` }]);
        }
        if (controller.groups.every(group => group.references.every(p => p.PathID === '0'))) {
            diagnostics.push({ scene, code: 'no-native-fog-references' }); continue;
        }
        const formats = fogMaterialFormats(fs.readFileSync(controllerObject.source.file), controller.unparsedOffset);
        const fogs = cache.objects.filter(o => o.decoded?.className === 'SmoothMaskClipableImage' && target(o, 'gameObject')?.name === 'Fog'
            && root(transform(target(o, 'gameObject'))).id === sceneRoot.id);
        assert.equal(fogs.length, 1); const fog = fogs[0], fogMaterial = target(fog, 'material'); checkShader(fogMaterial, 'fog');
        const fp = parameters(fogMaterial); assert.equal(fp._StencilComp, 6); assert.equal(fp._StencilOp, 0);
        assert.equal(fp._UseUISmoothMask, 0); assert.equal(fp._SrcBlendMode, 5); assert.equal(fp._DstBlendMode, 10);
        const groups = [];
        for (const group of controller.groups) {
            const parts = group.references.map((pointer, i) => {
                assert.equal(pointer.fileID, 0);
                const rects = cache.objects.filter(o => o.entry.Source === controllerObject.entry.Source && o.entry.Offset === controllerObject.entry.Offset
                    && o.entry.PathID === pointer.PathID && o.entry.Type === 'RectTransform'); assert.equal(rects.length, 1);
                const rect = rects[0]; assert.equal(root(rect).id, sceneRoot.id);
                const name = [formats.mask, formats.outline][i].replace('{0}', group.id);
                const mats = address(formats.directory + name + '.Material', 'Material'); assert.equal(mats.length, 1);
                const mat = mats[0], p = parameters(mat); checkShader(mat, i ? 'outline' : 'mask');
                assert.equal(p._Stencil, fp._Stencil); assert.equal(p._StencilReadMask, fp._Stencil);
                assert.equal(p._StencilComp, 6); assert.equal(p._StencilOp, i ? 0 : 2);
                assert.equal(p._SrcBlendMode, 5); assert.equal(p._DstBlendMode, 10); assert.equal(p._UseUISmoothMask, 0);
                assert.deepEqual(p._FogRGBA, [1, 0, 0, 0]);
                const texture = mat.decoded.textures.find(t => t.name === '_Mask');
                assert.deepEqual(texture.scale, [1, 1]); assert.deepEqual(texture.offset, [0, 0]);
                return { geometry: projectGeometry(geometry(rect), scene, projections), mask: image(target(mat, 'textures._Mask')),
                    ...(i ? { edge_color: p._OutlineColor } : {}), sources: { transform: rect.source, material: mat.source } };
            });
            const points = parts[0].geometry.corners;
            if (new Set(points.map(p => p.x)).size < 2 || new Set(points.map(p => p.y)).size < 2) {
                diagnostics.push({ scene, group: group.id, code: 'zero-area-fog-transform' }); continue;
            }
            groups.push({ area_id: group.id, mask: parts[0], outline: parts[1] });
        }
        assert(groups.length);
        const id = `resource-outside-fog-${scene}`;
        records[id] = record(id, scene, { category: 'outside-fog', shader_profile: 'open-area-stencil-fog-7.1-v1',
            projection, preview: 'all-areas-open-time-zero', groups,
            fog: { geometry: projectGeometry(geometry(transform(target(fog, 'gameObject'))), scene, projections) },
            sources: { controller: controllerObject.source, formats, stencil: fp._Stencil } }, controllerObject);
    }
    for (const file of codeFiles()) proof.remember(hash(file));
    return { schema: 1, profile: PROFILE, plan, inputs: [...proof.inputs.values()], records, diagnostics };
}
function prepare(options) {
    const { output, ...plan } = options; const cache = buildCache(plan);
    fs.writeFileSync(output, JSON.stringify(cache), { flag: 'wx' });
    return { file: path.resolve(output), records: Object.keys(cache.records).length, diagnostics: cache.diagnostics };
}
function readResourceCache(file) {
    const cache = read(file); assert.equal(cache.profile, PROFILE); assert.equal(cache.schema, 1);
    const rebuilt = buildCache(cache.plan); assert.deepEqual(cache, rebuilt, 'Stale or modified map effects cache'); return cache;
}
module.exports = { prepare, buildCache, readResourceCache };
