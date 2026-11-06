// Enrich an explicitly pinned snapshot through the same verified resource parser
// used by collateMaps; unrelated records remain byte-identical.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { openSnapshot, putJSON, publish, digest } = require('./storage');
function enrich(cacheRoot, snapshotId, resourceFile) {
    const cache = require('../resources/map-effects').readResourceCache(resourceFile);
    const lock = path.join(cacheRoot, 'prepare.lock'); fs.mkdirSync(lock);
    try {
        const previous = openSnapshot({ cacheRoot, snapshotId });
        assert.equal(openSnapshot({ cacheRoot }).snapshotId, snapshotId, 'Pinned snapshot is not current');
        const manifest = previous.manifest(), files = structuredClone(manifest.files);
        for (const language of ['ChineseSimplified', 'English']) for (const record of Object.values(cache.records)) {
            assert(previous.getRecord(language, 'maps', `scene-${record.data.scene_id}`), 'Missing snapshot scene');
            if (record.data.limit_region_id) assert(previous.getRecord(language, 'maps', `limit-region-${record.data.limit_region_id}`), 'Missing snapshot limit region');
            const key = `${language}/maps/${record.id}.json`;
            files[key] = { ...files[key], hash: putJSON(cacheRoot, record), id: record.id };
        }
        const plan = { ...manifest.plan, mapEffects: { profile: cache.profile, parent: snapshotId,
            file: path.resolve(resourceFile), sha256: digest(fs.readFileSync(resourceFile)) } };
        plan.key = digest(JSON.stringify(plan)); return publish(cacheRoot, files, plan, previous);
    } finally { fs.rmdirSync(lock); }
}
if (require.main === module) { const result = enrich(...process.argv.slice(2)); console.log(JSON.stringify({ snapshotId: result.snapshotId })); }
module.exports = { enrich };
