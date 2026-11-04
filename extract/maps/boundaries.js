const assert = require('node:assert/strict');
const shaderProfiles = {
    mask: 'e7295659de2643083505deaed1245ab04ec1dddf47489e96d282861974e805fe',
    rim: '9f7dbb0fa6cf4c4c56b32961d085f0da17065bc538655684bf172c265434d418',
};
function projectBoundaryGeometry(geometry, sceneId, projections = {}) {
    if (!projections[sceneId] || !geometry?.corners) return null;
    assert.equal(geometry.coordinateSpace, 'prefab-ui');
    assert(geometry.corners.every(point => Math.abs(point[2]) < 0.001), 'Nonplanar boundary');
    // GuideArea's serialized scale is already composed with the native map grid.
    return require('./atlas').projectGeometry(geometry, sceneId, projections);
}
function transformVertices(vertices, transforms) {
    assert(vertices.length % 3 === 0);
    const points = Array.from({ length: vertices.length / 3 }, (_, i) => vertices.slice(i * 3, i * 3 + 3));
    for (const transform of transforms) {
        const [qx, qy, qz, qw] = transform.rotation;
        assert(Math.abs(qx * qx + qy * qy + qz * qz + qw * qw - 1) < 0.0001);
        for (const p of points) {
            const [x, y, z] = p.map((v, i) => v * transform.scale[i]);
            const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
            p[0] = x + qw * tx + qy * tz - qz * ty + transform.position[0];
            p[1] = y + qw * ty + qz * tx - qx * tz + transform.position[1];
            p[2] = z + qw * tz + qx * ty - qy * tx + transform.position[2];
        }
    }
    return points;
}
/** limitRegions are explicitly normalized {id,name,sceneId} records from tables. */
function buildNativeBoundaries(cache, { limitRegions, projections }) {
    const objects = new Map(cache.objects.map(object => [object.id, object]));
    const target = (object, field) => objects.get(object?.references.find(ref => ref.field === field && ref.status === 'resolved')?.target);
    const asset = object => cache.imageAssets?.find(asset => asset.id === object?.id)?.png;
    const transformFor = component => {
        const go = target(component, 'gameObject');
        const transforms = go?.references.map(ref => objects.get(ref.target)).filter(value => value?.decoded?.type === 'RectTransform') || [];
        return transforms.length === 1 ? transforms[0] : undefined;
    };
    const parents = transform => {
        const list = [], visited = new Set(); let current = transform;
        while (current) {
            assert(!visited.has(current.id), 'Boundary transform cycle'); visited.add(current.id); list.push(current);
            if (current.decoded.parent.PathID === '0') return list;
            current = target(current, 'parent');
        }
        return null;
    };
    const boundaries = [], diagnostics = [];
    for (const component of cache.objects.filter(object => object.decoded?.className === 'SmoothMaskClippableMeshImage' && object.decoded.decodeStatus === 'decoded')) {
        const transform = transformFor(component), hierarchy = transform && parents(transform);
        if (!hierarchy) continue;
        const root = target(hierarchy.at(-1), 'gameObject');
        const matches = limitRegions.filter(region => region.name === root?.name);
        if (matches.length !== 1) {
            if (/^GlobalOpenArea/.test(root?.name || '')) diagnostics.push({ object: component.id, code: 'boundary-limit-region-unresolved' });
            continue;
        }
        const region = matches[0], meshObject = target(component, 'mesh'), mesh = cache.meshes?.find(mesh => mesh.id === meshObject?.id)?.geometry;
        const material = target(component, 'material'), shader = target(material, 'shader'), texture = target(component, 'sprite');
        const spriteGeometry = cache.sprites?.find(sprite => sprite.id === texture?.id)?.geometry;
        const texturePointer = spriteGeometry?.texture;
        const textureCab = texturePointer?.fileID === 0 ? texture?.serializedFile.name
            : texture?.serializedFile.externals.find(external => external.fileID === texturePointer?.fileID)?.fileName;
        const textureObjects = texturePointer && textureCab ? cache.objects.filter(object => object.entry.Type === 'Texture2D'
            && object.entry.PathID === texturePointer.PathID && object.serializedFile.name.toLowerCase() === textureCab.toLowerCase()) : [];
        const fullTexture = textureObjects.length === 1 ? textureObjects[0] : undefined;
        const maskCandidates = cache.images.filter(image => image.imageObject !== component.id).filter(image => {
            const chain = parents(objects.get(image.rectTransform)); return chain && target(chain.at(-1), 'gameObject')?.id === root.id;
        });
        if (!mesh || maskCandidates.length !== 1 || shader?.source.sha256 !== shaderProfiles.rim) {
            diagnostics.push({ object: component.id, code: 'boundary-geometry-or-shader-unresolved' }); continue;
        }
        const mask = maskCandidates[0], maskMaterial = objects.get(mask.material?.id), maskShader = target(maskMaterial, 'shader');
        if (maskShader?.source.sha256 !== shaderProfiles.mask) { diagnostics.push({ object: mask.id, code: 'boundary-mask-shader-unresolved' }); continue; }
        assert(mesh.indices.length % 3 === 0 && mesh.subMeshes.every(sub => sub.topology === 'Triangles'));
        assert(mesh.uv0.length === mesh.vertexCount * 2 && mesh.colors.length === 0, 'Unsupported boundary vertex attributes');
        const floats = Object.fromEntries(material.decoded.floats.map(value => [value.name, value.value]));
        const maskFloats = Object.fromEntries(maskMaterial.decoded.floats.map(value => [value.name, value.value]));
        assert.deepEqual(material.decoded.colors.find(value => value.name === '_Color')?.value, [1, 1, 1, 1], 'Unsupported boundary material tint');
        assert.deepEqual(maskMaterial.decoded.colors.find(value => value.name === '_Color')?.value, [1, 1, 1, 1], 'Unsupported boundary mask tint');
        assert.equal(floats._ColorScaler, 1, 'Unsupported boundary color scaler');
        assert.equal(floats._SrcBlendMode, 5); assert.equal(floats._DstBlendMode, 1);
        assert.equal(maskFloats._SrcBlendMode, 5); assert.equal(maskFloats._DstBlendMode, 10);
        assert.equal(floats._UseUISmoothMask, 0); assert.equal(maskFloats._UseUISmoothMask, 0);
        const nativeVertices = transformVertices(mesh.vertices, hierarchy.map(item => item.decoded));
        const projected = projectBoundaryGeometry({ coordinateSpace: 'prefab-ui', corners: nativeVertices }, region.sceneId, projections);
        const noiseSetting = maskMaterial.decoded.textures.find(value => value.name === '_SecTex');
        const noiseObject = target(maskMaterial, 'textures._SecTex');
        boundaries.push({ id: `native-boundary-${root.id.slice('map-resource-'.length)}`, rootName: root.name, rootId: root.id,
            limitRegionId: region.id, sceneId: region.sceneId, source: root.entry,
            mask: { png: mask.png, geometry: mask.geometry, displayGeometry: projectBoundaryGeometry(mask.geometry, region.sceneId, projections),
                componentColor: mask.componentColor, shaderProfile: 'open-area-red-channel-v1', shaderSha256: maskShader.source.sha256,
                noise: { png: asset(noiseObject), scale: noiseSetting.scale, offset: noiseSetting.offset }, blend: 'normal', renderOrder: 0 },
            rim: { coordinateSpace: 'prefab-ui', nativeVertices, vertices: projected?.corners || null,
                projection: projected?.profile || null, triangles: Array.from({ length: mesh.indices.length / 3 }, (_, i) => mesh.indices.slice(i * 3, i * 3 + 3)),
                uv: Array.from({ length: mesh.vertexCount }, (_, i) => mesh.uv0.slice(i * 2, i * 2 + 2)), uvOrigin: 'bottom-left',
                png: asset(fullTexture), spriteGeometry: spriteGeometry || null,
                ...(fullTexture?.source.sha256 === 'ed7c0578c6fee6a769d36b87e3a66ee36d1bc6c71b610873d12f8267657f9233'
                    ? { textureFilter: 'bilinear', textureWrap: 'clamp' } : {}),
                color: component.decoded.color.slice(0, 3), opacity: component.decoded.color[3], blend: 'additive',
                shaderSha256: shader.source.sha256, renderOrder: 1 },
            renderingStatus: 'static-serialized-state', visibilityStatus: 'runtime-activation-unresolved',
            diagnostics: ['canvas-group-animation-not-reproduced', 'mesh-sprite-uv-mapping-unverified', ...(!projected ? ['boundary-projection-unresolved'] : []),
                ...(!asset(fullTexture) ? ['boundary-full-texture-unresolved'] : [])] });
    }
    return { boundaries, diagnostics };
}
module.exports = { buildNativeBoundaries, transformVertices, projectBoundaryGeometry, shaderProfiles };
