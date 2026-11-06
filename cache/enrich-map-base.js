// Add a verified scene's base tiles without rebuilding unrelated snapshot data.
// The same baseRecords converter is used by the full map extraction pipeline.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { openSnapshot, putJSON, publish, digest } = require('./storage');

function enrich(cacheRoot, snapshotId, resourceFile) {
    const base = require('../resources/map-base').readResourceCache(resourceFile);
    const records = require('../extract/maps/base').baseRecords(base, path.resolve(resourceFile));
    const lock = path.join(cacheRoot, 'prepare.lock'); fs.mkdirSync(lock);
    try {
        const previous = openSnapshot({ cacheRoot, snapshotId }), manifest = previous.manifest();
        assert.equal(openSnapshot({ cacheRoot }).snapshotId, snapshotId, 'Pinned snapshot is not current');
        const files = structuredClone(manifest.files);
        for (const language of ['ChineseSimplified', 'English']) for (const record of Object.values(records)) {
            assert(previous.getRecord(language, 'maps', `scene-${record.data.scene_id}`), 'Missing snapshot scene');
            const key = `${language}/maps/${record.id}.json`;
            assert(!files[key], `Existing base tile must not be overwritten: ${key}`);
            files[key] = { hash: putJSON(cacheRoot, record), id: record.id };
        }
        const plan = { ...manifest.plan, mapBaseAddition: { parent: snapshotId,
            file: path.resolve(resourceFile), sha256: digest(fs.readFileSync(resourceFile)) } };
        plan.key = digest(JSON.stringify(plan)); return publish(cacheRoot, files, plan, previous);
    } finally { fs.rmdirSync(lock); }
}
module.exports = { enrich };
if (require.main === module) console.log(JSON.stringify({ snapshotId: enrich(...process.argv.slice(2)).snapshotId }));
