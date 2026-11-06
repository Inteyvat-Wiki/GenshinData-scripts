// Add independently sourced client geometry to an existing snapshot. Keep its
// original table membership and never substitute one version's region for another.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { openSnapshot, putJSON, publish, digest } = require('./storage');
const { readResourceCache } = require('../resources/map-limit-outlines');
const { PROFILE, attachOutline } = require('../extract/maps/limit-outline');

function enrich(cacheRoot, snapshotId, resourceFile) {
    const cache = readResourceCache(resourceFile);
    const outlines = new Map(cache.outlines.map(outline => [outline.id, outline]));
    const lock = path.join(cacheRoot, 'prepare.lock');
    fs.mkdirSync(lock);
    try {
        const previous = openSnapshot({ cacheRoot, snapshotId }), manifest = previous.manifest();
        assert.equal(openSnapshot({ cacheRoot }).snapshotId, snapshotId, 'Pinned snapshot is not current');
        const files = structuredClone(manifest.files);
        for (const language of ['ChineseSimplified', 'English']) {
            for (const key of previous.keys(language, 'maps').filter(key => key.startsWith('limit-region-'))) {
                const record = previous.getRecord(language, 'maps', key), outline = outlines.get(record.data.region_id);
                if (!outline) continue;
                for (const existing of record.data.polygons || []) {
                    for (const field of ['minimum', 'maximum', 'points', 'area_type'])
                        assert.deepEqual(existing[field], outline.polygon[field], `Historical polygon disagrees: ${key}/${field}`);
                }
                attachOutline(record, outline);
                files[`${language}/maps/${key}.json`].hash = putJSON(cacheRoot, record);
            }
        }
        const plan = { ...manifest.plan, mapLimitOutlines: { profile: PROFILE, parent: snapshotId,
            file: path.resolve(resourceFile), sha256: digest(fs.readFileSync(resourceFile)) } };
        plan.key = digest(JSON.stringify(plan));
        return publish(cacheRoot, files, plan, previous);
    } finally { fs.rmdirSync(lock); }
}
if (require.main === module) {
    const result = enrich(...process.argv.slice(2));
    console.log(JSON.stringify({ snapshotId: result.snapshotId, modified: result.manifest().changes.modified.length }));
}
module.exports = { enrich };
