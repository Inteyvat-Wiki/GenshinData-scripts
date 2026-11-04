const { resolveField, resolveRow } = require('../field-inference');

// Pure, input-scoped calibration; importing this module never loads global/source.
// Values below were checked in both 7.1 c5ef717b774 and 7.2 bd35e243fa4.
const byId = (rows, table, id, key = 'id') => resolveRow(rows, `${table}:${id}`, row => row[key] === id);

function resolveMaterialSourceFields(rows) {
    if (!rows.length) return {};
    return { jumpDescs: resolveField('MaterialSource.jumpDescs', [{
        row: byId(rows, 'MaterialSource', 210001),
        value: [3428310340, 1366389946, 3237647833, 326911317, 696736979, 1009452272, 549049380],
    }]) };
}

function resolveProfilePictureFields(rows) {
    if (!rows.length) return {};
    const boy = byId(rows, 'ProfilePicture', 1), costume = byId(rows, 'ProfilePicture', 11);
    return {
        // The base portrait's unlockParam equals the avatar; the costume's does not.
        nameAvatar: resolveField('ProfilePicture.nameAvatar', [{ row: boy, value: 10000005 }, { row: costume, value: 10000005 }]),
        unlockType: resolveField('ProfilePicture.unlockType', [
            { row: boy, value: 'PROFILE_PICTURE_UNLOCK_BY_AVATAR' },
            { row: costume, value: 'PROFILE_PICTURE_UNLOCK_BY_COSTUME' },
        ]),
    };
}

function resolveLocalLegendFields(rows) {
    if (!rows.length) return {};
    const row = byId(rows, 'LocalLegend', 101);
    return {
        resource: resolveField('LocalLegend.resource', [{ row, value: '589278960941904205' }]),
        monsters: resolveField('LocalLegend.monsters', [{ row,
            match: value => value === 22132001 || Array.isArray(value) && value.length === 1 && value[0] === 22132001 }]),
    };
}

function resolveLoadingSituationFields(rows) {
    if (!rows.length) return {};
    return { dungeons: resolveField('LoadingSituation.dungeons', [
        { row: byId(rows, 'LoadingSituation', 65, 'stageID'), value: [156] },
        { row: byId(rows, 'LoadingSituation', 66, 'stageID'), value: [149, 150, 151] },
    ]) };
}

function monsterIds(row, key) {
    const value = row[key], ids = Array.isArray(value) ? value : [value];
    if (!Array.isArray(ids) || !ids.length || ids.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length)
        throw new Error(`Invalid LocalLegend monster IDs: ${row.id}`);
    return ids;
}

module.exports = { resolveMaterialSourceFields, resolveProfilePictureFields, resolveLocalLegendFields, resolveLoadingSituationFields, monsterIds };
