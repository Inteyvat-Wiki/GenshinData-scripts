const test = require('node:test');
const assert = require('node:assert/strict');
const { annotateLayerState } = require('./layer-state');
const event = (state = '1', phase = 'finish') => ({ id: `quest-event-7502013-${phase}-3`, kind: 'quest_event',
    data: { action: 'QUEST_EXEC_SET_MAP_LAYER_UNLOCK_STATE', quest_id: 7502013, phase, target_ids: [3460407, 3460408], state } });
test('layer writes preserve batch targets, failure phase and execution order without inventing an initial state', () => {
    const r = annotateLayerState(event());
    assert.deepEqual(r.data.layer_state_change, { profile: 'map-layer-unlock-v1', unlocked: true, execution_order: 3 });
    assert.deepEqual(r.data.target_ids, [3460407, 3460408]);
    assert.equal(annotateLayerState(event('0', 'fail')).data.layer_state_change.unlocked, false);
    assert.equal(Object.hasOwn(r.data, 'initial_state'), false);
    assert.throws(() => annotateLayerState(event('2')), /unlock state/);
    assert.throws(() => annotateLayerState({ ...event(), id: 'quest-event-7502012-finish-3' }), /identity/);
    const duplicate = event(); duplicate.data.target_ids = [1, 1];
    assert.throws(() => annotateLayerState(duplicate), /targets/);
});
