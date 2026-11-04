const assert = require('node:assert/strict');

const PROFILE = 'map-layer-unlock-v1';
/** A quest writes a layer's persistent unlock flag; it does not specify its initial value. */
function annotateLayerState(record) {
    if (record.kind !== 'quest_event' || record.data.action !== 'QUEST_EXEC_SET_MAP_LAYER_UNLOCK_STATE') return record;
    const data = record.data;
    assert(['finish', 'fail'].includes(data.phase), 'Unsupported map-layer event phase');
    assert(Array.isArray(data.target_ids) && data.target_ids.length > 0
        && data.target_ids.every(id => Number.isSafeInteger(id) && id > 0)
        && new Set(data.target_ids).size === data.target_ids.length, 'Invalid map-layer targets');
    assert([0, 1, '0', '1'].includes(data.state), 'Unsupported map-layer unlock state');
    const match = /^quest-event-(\d+)-(finish|fail)-(\d+)$/.exec(record.id);
    assert(match && Number(match[1]) === data.quest_id && match[2] === data.phase, 'Invalid map-layer event identity');
    data.layer_state_change = { profile: PROFILE, unlocked: Number(data.state) === 1, execution_order: Number(match[3]) };
    return record;
}
module.exports = { PROFILE, annotateLayerState };
