const { buildMaps } = require('./maps/catalogue');
const { createSource } = require('./maps/source');
let source;
function collateMaps(language) {
    require('./global');
    source ||= createSource(config.GenshinData_folder, (lang, hash) => getLanguage(lang)[String(hash)] || '');
    const records = buildMaps(language, source);
    if (process.env.MAP_LIMIT_OUTLINE_RESOURCE_CACHE) {
        const outlines = require('../resources/map-limit-outlines').readResourceCache(process.env.MAP_LIMIT_OUTLINE_RESOURCE_CACHE).outlines;
        const limits = Object.values(records).filter(record => record.kind === 'limit_region');
        if (limits.length !== outlines.length) throw new Error('Limit outline cache and source table have different region counts');
        for (const outline of outlines) require('./maps/limit-outline').attachOutline(records[`limit-region-${outline.id}`], outline);
    }
    const base = source.mapBase();
    if (base) {
        Object.assign(records, require('./maps/base').baseRecords(base, process.env.MAP_BASE_RESOURCE_CACHE));
        const labels = require('./maps/surface-labels');
        // mapBase() verifies the prefab cache and all serialized source hashes.
        const prefab = JSON.parse(require('node:fs').readFileSync(base.plan.prefabCacheFile, 'utf8'));
        Object.assign(records, labels.surfaceLabelRecords(labels.buildSurfaceLabels(base, prefab),
            process.env.MAP_BASE_RESOURCE_CACHE, { source, language, catalogue: records }));
    }
    if (process.env.MAP_FOG_RESOURCE_CACHE) Object.assign(records, require('./maps/fog').fogRecords(
        require('../resources/map-fog').readResourceCache(process.env.MAP_FOG_RESOURCE_CACHE), process.env.MAP_FOG_RESOURCE_CACHE));
    if (process.env.MAP_ICON_RESOURCE_CACHE) {
        const icons = require('../resources/map-icons');
        icons.attachImages(records, icons.readResourceCache(process.env.MAP_ICON_RESOURCE_CACHE));
    }
    const resources = process.env.MAP_RESOURCE_CACHE;
    if (resources) {
        Object.assign(records, require('./maps/resources').resourceRecords(require('../resources/maps').readResourceCache(resources), resources, { source, language, catalogue: records }));
        for (const layer of Object.values(records).filter(record => record.kind === 'layer')) {
            const images = Object.values(records).filter(record => record.kind === 'resource' && record.data.category === 'atlas-image' && record.data.layer_id === layer.data.layer_id);
            for (const image of images) layer.relations.push({ role: 'native_image', category: 'maps', id: image.id });
            if (!images.length) layer.diagnostics.push('layer_native_image_unresolved');
        }
    }
    const effects = process.env.MAP_EFFECT_RESOURCE_CACHE;
    if (effects) Object.assign(records, require('../resources/map-effects').readResourceCache(effects).records);
    const levelTags = process.env.MAP_LEVEL_TAG_RESOURCE_CACHE;
    if (levelTags) require('./maps/level-tag-groups').annotateLevelTagStates(records, require('../resources/level-tag-groups').readResourceCache(levelTags));
    for (const record of Object.values(records)) {
        require('../versions/tracking').attach(record, new Set(record.source.hashes.filter(hash => source.text(language, hash))));
    }
    return records;
}
module.exports = collateMaps;
