const test = require('node:test'), assert = require('node:assert/strict');
const { annotateLevelTagStates, decodeLevelTagGroups, PROFILE, SHA256 } = require('./level-tag-groups');
function fixture() {
    const records = {};
    for (const [index, tag] of [108,109,110].entries()) {
        const area = 51+index;
        records[`map-area-${area}`] = {id:`map-area-${area}`,kind:'map_area',relations:[],data:{area_id:area,state_model:{mode:'level-tag',initial_open:true}}};
        records[`level-tag-${tag}`] = {id:`level-tag-${tag}`,kind:'level_tag',relations:[],data:{tag_id:tag,map_areas:[{area_id:area}]}};
        records[`image-${area}`] = {id:`image-${area}`,kind:'resource',relations:[{role:'map_area',id:`map-area-${area}`},{role:'variant_controller',id:`controller-${area}`}],
            data:{category:'atlas-image',area_variants:[{area_id:area,index:0}]}};
    }
    for (const [step,tag] of [[7405349,109],[7405369,110]]) records[`quest-event-${step}-finish-4`] = {id:`quest-event-${step}-finish-4`,kind:'quest_event',
        relations:[{role:'target',category:'maps',id:`level-tag-${tag}`}],data:{action:'QUEST_EXEC_CHANGE_SCENE_LEVEL_TAG',quest_id:step,phase:'finish',parameters:[String(tag)],target_ids:[tag]}};
    return records;
}
const cache = {source:{sha256:SHA256},groups:[{id:45,groups:[[108,109,110]],initial:[108]}]};
test('native level series supplies initial and sibling state writes without guessing missing indices', () => {
    const records = fixture(); annotateLevelTagStates(records,cache);
    assert.deepEqual([51,52,53].map(id => records[`map-area-${id}`].data.level_tag_state.initial_visible),[true,false,false]);
    assert.deepEqual(records['map-area-51'].data.level_tag_state.members,[108,109,110]);
    assert.equal(records['quest-event-7405349-finish-4'].data.level_tag_change.tag_id,109);
    assert.equal(records['quest-event-7405369-finish-4'].data.level_tag_change.execution_order,4);
    assert.equal(records['level-tag-108'].data.map_areas[0].index,undefined); // original omission preserved
    const before = JSON.stringify(records); annotateLevelTagStates(records,cache); assert.equal(JSON.stringify(records),before);
    records['image-51'].data.area_variants.push({area_id:51,index:1}); annotateLevelTagStates(records,cache);
    assert.equal(records['map-area-51'].data.level_tag_state,undefined);
    records.extra = {kind:'map_trigger',relations:[{role:'target',id:'level-tag-109'}],data:{}}; annotateLevelTagStates(records,cache);
    assert.equal(records['map-area-52'].data.level_tag_state,undefined);
    assert.throws(()=>decodeLevelTagGroups(Buffer.alloc(4)),/Unsupported/);
});
test('numeric quest target whitespace is normalized without rewriting raw parameters', () => {
    const records=fixture(), event=records['quest-event-7405349-finish-4'];
    event.data.parameters=[' 109'];event.data.target_ids=[];event.relations=[];
    annotateLevelTagStates(records,cache);
    assert.deepEqual(event.data.parameters,[' 109']);assert.deepEqual(event.data.target_ids,[109]);
    assert.equal(event.data.level_tag_change.profile,PROFILE);assert.equal(event.relations[0].id,'level-tag-109');
});
