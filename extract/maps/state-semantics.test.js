const test = require('node:test');
const assert = require('node:assert/strict');
const { annotateMapState } = require('./state-semantics');
test('area state defaults preserve absent source fields and separate special renderers', () => {
    const area = {kind:'map_area',data:{}}; annotateMapState(area);
    assert.equal(area.data.state, undefined); assert.equal(area.data.state_model.initial_open,false);
    assert.equal(area.data.state_model.initial_source,'constructor-default');
    for (const state of ['MistOpen','MistClose']) {
        const row={kind:'map_area',data:{state,area_type:'MAP_AREA_TYPE_LEVEL_TAG'}}; annotateMapState(row);
        assert.equal(row.data.state_model.initial_open,state==='MistOpen'); assert.equal(row.data.state_model.mode,'level-tag');
    }
    assert.throws(()=>annotateMapState({kind:'map_area',data:{state:'new-state'}}),/Unknown/);
    assert.throws(()=>annotateMapState({kind:'map_area',data:{area_type:'new-kind'}}),/Unknown/);
});
test('writes preserve source action ordinal and reject mismatched cached identities', () => {
    const row={id:'quest-event-100-fail-7',kind:'quest_event',data:{quest_id:100,phase:'fail',action:'QUEST_EXEC_CHANGE_MAP_AREA_STATE',target_ids:[41],state:'0'}};
    annotateMapState(row); assert.deepEqual(row.data.area_state_change,{profile:'map-area-bool-v1',open:false,execution_order:7});
    assert.throws(()=>annotateMapState({...row,id:'quest-event-101-fail-7'}),/identity/);
    assert.throws(()=>annotateMapState(row,2),/order/);
    assert.throws(()=>annotateMapState({...row,data:{...row.data,state:'2'}}),/Unsupported/);
});
