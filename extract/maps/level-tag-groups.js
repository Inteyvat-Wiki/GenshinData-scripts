const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const PROFILE = 'level-tag-groups-7.1-v1';
const SHA256 = '87ecf6c68d6bb02e5e1871e2d75882d17a1b9acb438516fd8472cb432fab0d72';

// Exact client payload profile. The layout/encoding matches all 31 legacy rows
// (including large IDs), consumes all 71 native rows, and checks membership and
// initial values. It is NOT a general reader for unverified future revisions.
function decodeLevelTagGroups(bytes) {
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), SHA256, 'Unsupported LevelTagGroups payload');
    let cursor = 0;
    const uint = () => { const value = bytes.readUInt32LE(cursor); cursor += 4; return value; };
    assert.equal(uint(), 0xf78e940f);
    const rows = [], seen = new Set();
    while (cursor < bytes.length) {
        const offset = cursor;
        assert.equal(bytes.readUInt16LE(cursor), 0x4c69); cursor += 2;
        const count = uint() - 0x759b6241; assert.equal(count, 1);
        const initial = Array.from({length: count}, () => uint() - 0xa72da958);
        const groupCount = uint() - 0xacb49dc4; assert.equal(groupCount, 3);
        const groups = Array.from({length: groupCount}, () => {
            const flag = bytes[cursor++]; assert([8, 136].includes(flag));
            if (flag === 136) return [];
            const n = uint() - 0xefa6009a; assert(n > 0 && n < 1000);
            return Array.from({length: n}, () => uint() - 0x267b8a11);
        }).filter(group => group.length);
        const cooldown = uint() - 0x384c4920, id = uint() - 0x79a33c71;
        assert.equal(groups.length, initial.length);
        for (const [index, members] of groups.entries()) {
            assert(members.includes(initial[index]));
            for (const member of members) { assert(Number.isSafeInteger(member) && member > 0 && !seen.has(member)); seen.add(member); }
        }
        rows.push({ id, groups, initial, cooldown, offset, bytes: cursor - offset });
    }
    assert.equal(cursor, bytes.length); assert.equal(rows.length, 71);
    assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
    return rows;
}

// Normalized metadata only; no story names or front-end IDs are used here.
// A missing image index is resolved only for a single native index-0 image
// group. Multi-image controllers retain their unresolved selection semantics.
function annotateLevelTagStates(records, cache) {
    const values = Object.values(records), byTag = new Map();
    for (const event of values.filter(record => record.kind === 'quest_event' && record.data.action === 'QUEST_EXEC_CHANGE_SCENE_LEVEL_TAG')) {
        // One shipped action contains leading whitespace (" 144"). Numeric
        // conversion accepts it; retain the original parameter as source evidence.
        const parameter = event.data.parameters?.[0];
        if (typeof parameter === 'string' && /^\s*\d+\s*$/.test(parameter)) {
            const id = Number(parameter); assert(Number.isSafeInteger(id) && id > 0);
            assert(!event.data.target_ids?.length || event.data.target_ids.length === 1 && event.data.target_ids[0] === id);
            event.data.target_ids = [id];
            if (!event.relations.some(link => link.role === 'target' && link.id === `level-tag-${id}`))
                event.relations.push({role:'target',category:'maps',id:`level-tag-${id}`});
        }
    }
    for (const row of cache.groups) for (const [group, members] of row.groups.entries()) for (const id of members)
        byTag.set(id, { series: row.id, group, members, initial: row.initial[group] });
    for (const area of values.filter(record => record.kind === 'map_area')) {
        delete area.data.level_tag_state;
        if (area.data.state_model?.mode !== 'level-tag' || !area.data.state_model.initial_open || area.data.scene_point_id) continue;
        const tags = values.filter(record => record.kind === 'level_tag' && record.data.map_areas.some(link => link.area_id === area.data.area_id));
        if (!tags.length) continue;
        const series = byTag.get(tags[0].data.tag_id);
        if (!series || tags.some(tag => byTag.get(tag.data.tag_id) !== series
            && (byTag.get(tag.data.tag_id)?.series !== series.series || byTag.get(tag.data.tag_id)?.group !== series.group))) continue;
        if (series.members.some(id => !records[`level-tag-${id}`])) continue;
        const images = values.filter(record => record.kind === 'resource' && record.data.category === 'atlas-image'
            && record.relations.some(link => link.role === 'map_area' && link.id === area.id));
        if (!images.length || images.some(image => image.data.area_variants?.length !== 1
            || image.data.area_variants[0].area_id !== area.data.area_id || image.data.area_variants[0].index !== 0)) continue;
        if (tags.some(tag => tag.data.map_areas.some(link => link.area_id === area.data.area_id && link.index !== undefined && link.index !== 0))) continue;
        const controllers = new Set(images.flatMap(image => image.relations.filter(link => link.role === 'variant_controller').map(link => link.id)));
        if (controllers.size !== 1 || images.some(image => image.relations.filter(link => link.role === 'variant_controller').length !== 1)) continue;
        // Non-quest writers and direct gate writes need another state dimension.
        const targets = new Set(series.members.map(id => `level-tag-${id}`));
        if (values.some(record => (record.kind === 'map_trigger' || record.kind === 'quest_event' && record.data.action !== 'QUEST_EXEC_CHANGE_SCENE_LEVEL_TAG')
            && record.relations.some(link => link.role === 'target' && (targets.has(link.id) || link.id === area.id)))) continue;
        area.data.level_tag_state = { profile: PROFILE, series_id: series.series, group_index: series.group,
            members: series.members, visible_tags: tags.map(tag => tag.data.tag_id),
            initial_visible: tags.some(tag => tag.data.tag_id === series.initial), image_index: 0,
            image_binding: 'sole-native-group', source_sha256: cache.source.sha256 };
    }
    for (const event of values.filter(record => record.kind === 'quest_event' && record.data.action === 'QUEST_EXEC_CHANGE_SCENE_LEVEL_TAG')) {
        delete event.data.level_tag_change;
        const ids = event.data.target_ids; assert(Array.isArray(ids) && ids.length === 1, 'Unsupported level-tag write targets');
        const series = byTag.get(ids[0]); if (!series) continue;
        const match = /^quest-event-(\d+)-(finish|fail)-(\d+)$/.exec(event.id);
        assert(match && Number(match[1]) === event.data.quest_id && match[2] === event.data.phase, 'Invalid level-tag event identity');
        event.data.level_tag_change = { profile: PROFILE, series_id: series.series, group_index: series.group,
            tag_id: ids[0], execution_order: Number(match[3]) };
    }
    return records;
}
module.exports = { PROFILE, SHA256, decodeLevelTagGroups, annotateLevelTagStates };
