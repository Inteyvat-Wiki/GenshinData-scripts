const assert = require('node:assert/strict');
const PROFILE = 'map-area-bool-v1';

// Historical client enums (ParseMaster 28/32) and hk4e 3.4 server execution:
// MistClose=0, MistOpen=1; changeMapAreaInfo stores param[1] != 0.
// The constructor defaults to MistClose. Preserve the absent raw field separately.
// Current ordinary replacement images corroborate open => visible, but do not
// establish the renderer for LevelTag, erosion or additional parent conditions.
function annotateMapState(record, executionOrder) {
    const data = record.data;
    if (record.kind === 'map_area') {
        assert([undefined, 'MistClose', 'MistOpen'].includes(data.state), `Unknown map-area state: ${data.state}`);
        const modes = { MAP_AREA_TYPE_DEFAULT: 'direct', MAP_AREA_TYPE_LEVEL_TAG: 'level-tag', MAP_AREA_TYPE_EROSION: 'erosion' };
        const mode = data.area_type === undefined ? 'direct' : modes[data.area_type];
        assert(mode, `Unknown map-area type: ${data.area_type}`);
        data.state_model = { profile: PROFILE, initial_open: data.state === 'MistOpen',
            initial_source: data.state === undefined ? 'constructor-default' : 'configured', mode };
    } else if (record.kind === 'quest_event' && data.action === 'QUEST_EXEC_CHANGE_MAP_AREA_STATE') {
        assert(['finish', 'fail'].includes(data.phase), 'Unknown map-area event phase');
        assert(Array.isArray(data.target_ids) && data.target_ids.length === 1 && Number.isSafeInteger(data.target_ids[0]), 'Invalid map-area write target');
        assert(['0', '1', 0, 1].includes(data.state), `Unsupported map-area write: ${data.state}`);
        // Old immutable caches encode this ordinal in the extractor-owned key.
        // Downstream consumers must never recover execution order from raw IDs.
        const match = /^quest-event-(\d+)-(finish|fail)-(\d+)$/.exec(record.id);
        assert(match && Number(match[1]) === data.quest_id && match[2] === data.phase, 'Invalid map-area event identity');
        const ordinal = executionOrder ?? Number(match[3]);
        assert(Number.isSafeInteger(ordinal) && ordinal >= 0 && ordinal === Number(match[3]), 'Invalid map-area execution order');
        data.area_state_change = { profile: PROFILE, open: Number(data.state) !== 0, execution_order: ordinal };
    }
    return record;
}
module.exports = { PROFILE, annotateMapState };
