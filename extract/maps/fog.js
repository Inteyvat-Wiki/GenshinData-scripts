const assert = require('node:assert/strict');

// MonoLevelMap has a material directory and two adjacent format strings after
// its tile layout. Read only this verified sub-layout; do not name unknown PPtrs.
function fogMaterialFormats(bytes, offset) {
    const read = at => {
        if (at + 4 > bytes.length) return;
        const length = bytes.readInt32LE(at);
        if (length < 1 || length > 256 || at + 4 + length > bytes.length) return;
        const value = bytes.toString('utf8', at + 4, at + 4 + length);
        if (!/^[\x20-\x7e]+$/.test(value)) return;
        return { value, end: Math.ceil((at + 4 + length) / 4) * 4 };
    };
    const matches = [];
    for (let at = offset; at < bytes.length; at += 4) {
        const directory = read(at);
        if (!directory?.value.endsWith('/Material/')) continue;
        const mask = read(directory.end), outline = mask && read(mask.end);
        if (mask && outline && mask.value.includes('{0}') && outline.value === mask.value + '_Outline')
            matches.push({ directory: directory.value, mask: mask.value, outline: outline.value, offset: at });
    }
    assert.equal(matches.length, 1, 'Missing/ambiguous native fog material formats');
    return matches[0];
}
function fogRecords(cache, file) {
    return Object.fromEntries(cache.scenes.map(scene => {
        const id = `resource-outside-fog-${scene.scene_id}`;
        return [id, { schema: 1, id, kind: 'resource', name: '', description: '', texts: [],
            relations: [{ role: 'scene', category: 'maps', id: `scene-${scene.scene_id}` }],
            data: { category: 'outside-fog', ...scene }, source: { file, id: String(scene.scene_id), hashes: [], fields: [] },
            diagnostics: ['outside_fog_all_areas_open_static_preview', 'outside_fog_runtime_animation_and_color_space_unverified'] }];
    }));
}
module.exports = { fogMaterialFormats, fogRecords };
