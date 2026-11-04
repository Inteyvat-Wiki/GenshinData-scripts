// Reuse the pinned text/task/resource snapshot; do not mix in newer source tables.
const fs = require('node:fs');
const path = require('node:path');
const { openSnapshot, putJSON, publish, digest } = require('./storage');
const { annotateLevelTagStates, PROFILE } = require('../extract/maps/level-tag-groups');
function enrichMapLevelTags(cacheRoot, snapshotId, resourceFile) {
    const resource = require('../resources/level-tag-groups').readResourceCache(resourceFile);
    const lock = path.join(cacheRoot, 'prepare.lock'); fs.mkdirSync(lock);
    try {
        const previous = openSnapshot({cacheRoot,snapshotId}), manifest = previous.manifest();
        if (openSnapshot({cacheRoot}).snapshotId !== snapshotId) throw new Error('Pinned snapshot is not current');
        const files = structuredClone(manifest.files);
        for (const language of ['ChineseSimplified','English']) {
            const records = Object.fromEntries(previous.keys(language,'maps').map(key => [key,previous.getRecord(language,'maps',key)]));
            annotateLevelTagStates(records,resource);
            for (const record of Object.values(records)) if (record.kind === 'map_area' || record.kind === 'quest_event')
                files[`${language}/maps/${record.id}.json`].hash = putJSON(cacheRoot,record);
        }
        const plan = {...manifest.plan, mapLevelTagSemantics:{profile:PROFILE,parent:snapshotId,resource:digest(fs.readFileSync(resourceFile))}};
        plan.key = digest(JSON.stringify(plan)); return publish(cacheRoot,files,plan,previous);
    } finally { fs.rmdirSync(lock); }
}
module.exports = { enrichMapLevelTags };
if (require.main === module) { const [root,id,file] = process.argv.slice(2); const result = enrichMapLevelTags(root,id,file);
    console.log(JSON.stringify({snapshotId:result.snapshotId,modified:result.manifest().changes.modified.length})); }
