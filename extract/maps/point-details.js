// Category portraits are reference images, not a simulation of player unlock state.
// The current dungeonEntryType adapter is checked against the named historical
// field in cbe446c9e60 (scene 3 points 45 and 48, same gadget and position).
const PROFILES = {
    transport: ['MarkTransPoint', 'MarkTransPointLocked'],
    statue: ['MarkGoddessUnlocked', 'MarkGoddessLocked'],
    Daily: ['MarkDailyDungeonEntry', 'MarkDailyDungeonEntryLocked', 'MarkDailyDungeonEntryToBeExplored'],
    Tower: ['MarkTowerDungeonEntry', 'MarkTowerDungeonEntryLocked', 'MarkTowerDungeonEntryToBeExplored'],
    Weekly: ['MarkWeeklyDungeonEntry', 'MarkWeeklyDungeonEntryLocked'],
    RoleCombat: ['MarkRoleCombatDungeonEntry', 'MarkRoleCombatDungeonEntryLock'],
    domain: ['MarkDungeonEntry', 'MarkDungeonEntryLocked'],
};
function categoryProfile(row, kind, entryCategory, entryTypeField) {
    if (kind === 'statue') return PROFILES.statue;
    // Interior exits also use SceneTransPoint/TOWER; these are not waypoints.
    if (kind === 'transport' && !row.subtype && (!row.type || row.type === 'NORMAL')) return PROFILES.transport;
    if (kind === 'domain-entry') {
        // The scene field is absent on the 13 current trounce entrances. Their
        // composite-matched entrance rows use TRIAL (e.g. scene 3 point 38,
        // entrance 1006). This is a category portrait, not a runtime selector.
        const category = { DUNGEON_ENTRY_TYPE_TRIAL: 'Weekly', DUNGEON_ENTRY_TYPE_OBSCURAE: 'Tower',
            DUNGEN_ENTRY_TYPE_RELIQUARY: 'Daily', DUNGEN_ENTRY_TYPE_WEAPON_PROMOTE: 'Daily',
            DUNGEN_ENTRY_TYPE_AVATAR_TALENT: 'Daily' }[entryCategory];
        return PROFILES[row[entryTypeField]] || PROFILES[category] || PROFILES.domain;
    }
}
function enrichPointDetails({ item, row, entry, worldAreas, rows, text, entryTypeField }) {
    if (row.subtype !== undefined) {
        item.data.transport_subtype = row.subtype;
        item.source.fields.push('subtype');
        item.diagnostics.push('special_transport_profile_unresolved');
    }
    if (row[entryTypeField] !== undefined) {
        item.data.dungeon_entry_type = row[entryTypeField];
        item.source.fields.push(entryTypeField);
    }
    if (item.data.point_class === 'statue') {
        const areas = worldAreas.filter(area => area.sceneID === item.data.scene_id && area.towerPointId === item.data.point_id);
        const candidates = rows('CityConfigData').filter(city => areas.some(area => city.areaIdVec?.includes(area.areaID1)));
        // All references must agree, including an area with no city match.
        if (candidates.length === 1 && areas.every(area => candidates[0].areaIdVec.includes(area.areaID1))) {
            const city = candidates[0];
            item.data.statue_city_id = city.cityId;
            for (const [role, field, direct] of [['name', 'cityGoddnessNameTextMapHash', 'titleTextID'], ['description', 'cityGoddnessDescTextMapHash', 'descTextID']]) {
                if (row[direct] || item.data[`${role}_source`] || !city[field]) continue;
                item[role] = text(item, city[field], role);
                item.data[`${role}_source`] = 'city_statue';
            }
        } else item.diagnostics.push(`statue_city_unresolved:${candidates.length}`);
    }
    if (entry) {
        item.data.dungeon_entry_category = entry.type;
        item.data.entry_access = {
            conditions: (entry.satisfiedCond || []).filter(c => c.type).map(c => ({ type: c.type,
                ...(Object.hasOwn(c, 'param1') ? { parameter_1: c.param1 } : {}),
                ...(Object.hasOwn(c, 'param2') ? { parameter_2: c.param2 } : {}) })),
            ...(entry.condComb ? { combination: entry.condComb } : {}),
            ...(Object.hasOwn(entry, 'isDefaultOpen') ? { default_open: entry.isDefaultOpen } : {}),
        };
    }
    // An activity may reuse a permanent entrance. Keep references as context,
    // never turn a shared dungeon ID or a missing activity row into a lifetime.
    const linked = rows('NewActivityExcelConfigData').filter(activity =>
        (row.dungeonIds || []).some(id => activity.dungeonIdList?.includes(id)));
    item.data.presence = {
        classification: entry?.type === 'DUNGEON_ENTRY_TYPE_ACTIVITY' || linked.length ? 'activity-associated' : 'unresolved',
        lifetime: 'unresolved',
        activities: linked.map(activity => {
            const entryRows = rows('NewActivityEntryConfigData').filter(e => e.id === activity.activityId && e.activityType === activity.activityType);
            return { id: activity.activityId, name: text(item, activity.nameTextMapHash, 'activity_name'),
                dungeon_ids: (row.dungeonIds || []).filter(id => activity.dungeonIdList.includes(id)),
                ...(entryRows.length === 1 && Object.hasOwn(entryRows[0], 'duration') ? { configured_duration: entryRows[0].duration } : {}) };
        }),
    };
}
function linkPointControls(output) {
    for (const source of Object.values(output)) {
        const role = source.kind === 'quest_event' ? 'quest_control' : source.kind === 'map_area' ? 'map_area_control' : undefined;
        if (!role) continue;
        for (const target of source.relations) {
            if (target.category !== 'maps' || !['target', 'hidden_point'].includes(target.role)) continue;
            const point = output[target.id];
            if (point?.kind === 'point' && !point.relations.some(r => r.role === role && r.id === source.id))
                point.relations.push({ role, category: 'maps', id: source.id });
        }
    }
}
// Eligibility for a world-map marker, not entity existence or minimap visibility.
// Text/image completeness, model hiding and technical point classes are not gates.
function pointMapDisplay(item, icon) {
    if (item.data.visibility === 'Never') return { status: 'excluded', reason: 'point-never' };
    if (['point', 'building'].includes(item.data.icon_source) && icon?.data.map_visibility === 'Invisible')
        return { status: 'excluded', reason: 'explicit-mark-invisible' };
    if (item.data.visibility === 'OnUnlocked') return { status: 'conditional', reason: 'point-on-unlocked' };
    return { status: 'unresolved', reason: 'visibility-unresolved' };
}
module.exports = { categoryProfile, enrichPointDetails, linkPointControls, pointMapDisplay };
