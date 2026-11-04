// Enrich a pinned snapshot without reading newer source tables or replacing
// unrelated task/text/resource records. All previous immutable blobs survive.
const fs = require('node:fs');
const path = require('node:path');
const { openSnapshot, putJSON, publish, digest } = require('./storage');
const { PROFILE, annotateMapState } = require('../extract/maps/state-semantics');
function enrichMapStates(cacheRoot, snapshotId) {
    const lock = path.join(cacheRoot, 'prepare.lock');
    fs.mkdirSync(lock); // Never steal another prepare process's lock.
    try {
        const previous = openSnapshot({ cacheRoot, snapshotId }), manifest = previous.manifest();
        if (openSnapshot({cacheRoot}).snapshotId !== snapshotId) throw new Error('Pinned snapshot is not current; use a separate cache instead of overwriting another preparation');
        const files = structuredClone(manifest.files);
        for (const language of ['ChineseSimplified', 'English']) for (const key of previous.keys(language, 'maps')) {
            if (!key.startsWith('map-area-') && !key.startsWith('quest-event-')) continue;
            const record = previous.getRecord(language, 'maps', key);
            annotateMapState(record);
            files[`${language}/maps/${key}.json`].hash = putJSON(cacheRoot, record);
        }
        const plan = { ...manifest.plan, mapStateSemantics: { profile: PROFILE, parent: previous.snapshotId,
            code: digest(fs.readFileSync(path.join(__dirname, '../extract/maps/state-semantics.js'))) } };
        plan.key = digest(JSON.stringify(plan));
        return publish(cacheRoot, files, plan, previous);
    } finally { fs.rmdirSync(lock); }
}
if (require.main === module) {
    if (process.argv.length !== 4) throw new Error('Usage: node cache/enrich-map-states.js CACHE_ROOT SNAPSHOT_ID');
    const snapshot = enrichMapStates(path.resolve(process.argv[2]), process.argv[3]);
    console.log(JSON.stringify({ snapshotId: snapshot.snapshotId, changes: snapshot.manifest().changes.modified.length }));
}
module.exports = { enrichMapStates };
