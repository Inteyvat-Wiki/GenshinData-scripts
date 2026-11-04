const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { putJSON, publish, openSnapshot } = require('./storage');
const { enrichMapStates } = require('./enrich-map-states');
test('pinned enrichment preserves unrelated blobs and refuses concurrent or stale publication', () => {
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'map-state-cache-'));
    try {
        const area={id:'map-area-44',kind:'map_area',data:{area_id:44}};
        const task={name:'Original text',steps:[1,2]};
        const files={'ChineseSimplified/maps/map-area-44.json':{hash:putJSON(root,area)},'ChineseSimplified/tasks/task.json':{hash:putJSON(root,task)}};
        const old=publish(root,files,{key:'test'},undefined);
        fs.mkdirSync(path.join(root,'prepare.lock'));
        assert.throws(()=>enrichMapStates(root,old.snapshotId),/EEXIST/);fs.rmdirSync(path.join(root,'prepare.lock'));
        const next=enrichMapStates(root,old.snapshotId);
        assert.deepEqual(next.manifest().changes.modified,['ChineseSimplified/maps/map-area-44.json']);
        assert.deepEqual(next.getRecord('ChineseSimplified','tasks','task'),task);
        assert.equal(next.manifest().files['ChineseSimplified/tasks/task.json'].hash,files['ChineseSimplified/tasks/task.json'].hash);
        assert.equal(next.getRecord('ChineseSimplified','maps','map-area-44').data.state_model.initial_open,false);
        assert.deepEqual(openSnapshot({cacheRoot:root,snapshotId:old.snapshotId}).getRecord('ChineseSimplified','maps','map-area-44'),area);
        assert.throws(()=>enrichMapStates(root,old.snapshotId),/not current/);assert(!fs.existsSync(path.join(root,'prepare.lock')));
    } finally {
        // Only this freshly created fixture directory is removed.
        assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));
        fs.rmSync(root,{recursive:true});
    }
});
