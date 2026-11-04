const { isDeepStrictEqual } = require('node:util');
const { resolveField, resolveRow } = require('../field-inference');

// These witnesses were checked in ExcelBinOutput and BinOutput. Resolve anew for
// each input; two tables sharing a key in one revision is not a schema contract.
const rowBy = (rows, table, key, value) => resolveRow(rows, `${table}:${value}`, row => row[key] === value);
const field = (label, row, value) => resolveField(label, [{ row, value }]);

function resolveCostumeIconField(rows) {
    if (!rows.length) return undefined;
    return resolveField('BeyondCostume.icon', [
        { row: rowBy(rows, 'BeyondCostume', 'costumeId', 260001), value: '3806693058812336722' },
        { row: rowBy(rows, 'BeyondCostume', 'costumeId', 260002), value: '14425841620430768778' },
    ]);
}

function resolveMiliastraFields(excel) {
    const fields = { quality: {}, body_types: {}, colors: {} };
    const costumes = excel('BeyondCostumeExcelConfigData');
    if (costumes.length) {
        const basic = rowBy(costumes, 'BeyondCostume', 'costumeId', 260001);
        const variant = rowBy(costumes, 'BeyondCostume', 'costumeId', 504601);
        const trial = rowBy(costumes, 'BeyondCostume', 'costumeId', 1501401);
        fields.costume_icon = resolveCostumeIconField(costumes);
        fields.body_types.costume = field('BeyondCostume.body_types', basic, ['BODY_GIRL']);
        fields.colors.costume = field('BeyondCostume.colors', basic, ['White']);
        fields.quality.costume = field('BeyondCostume.quality', basic, 'Green');
        // The exact known slot lists identify the group, not merely its shape.
        const groups = [[basic, ['UpperCloth']], [variant, ['UpperCloth', 'LowerCloth']]];
        fields.slot_groups = resolveField('BeyondCostume.slot_groups', groups.map(([row, slots]) => ({
            row, match: value => Array.isArray(value) && value.length === 2
                && isDeepStrictEqual(value[1], {}) && value[0] && typeof value[0] === 'object'
                && Object.values(value[0]).some(value => isDeepStrictEqual(value, slots)),
        })));
        fields.slots = resolveField('BeyondCostume.slots', groups.map(([row, value]) => ({
            row: row[fields.slot_groups][0], value,
        })));
        fields.costume_variant_group = field('BeyondCostume.variant_group', variant, 504401);
        fields.costume_source = field('BeyondCostume.source_link', trial, 501401);
    }
    const suits = excel('BeyondCostumeSuitExcelConfigData');
    if (suits.length) {
        const basic = rowBy(suits, 'BeyondCostumeSuit', 'suitId', 265001);
        fields.body_types.suit = field('BeyondCostumeSuit.body_types', basic, ['BODY_GIRL']);
        fields.colors.suit = field('BeyondCostumeSuit.colors', basic, ['Orange']);
        fields.quality.suit = field('BeyondCostumeSuit.quality', basic, 'Blue');
        fields.suit_extra_image = field('BeyondCostumeSuit.extra_image',
            rowBy(suits, 'BeyondCostumeSuit', 'suitId', 265044), '10709550370493609764');
        fields.suit_variant_group = field('BeyondCostumeSuit.variant_group',
            rowBy(suits, 'BeyondCostumeSuit', 'suitId', 265046), 265044);
        fields.suit_source = field('BeyondCostumeSuit.source_link',
            rowBy(suits, 'BeyondCostumeSuit', 'suitId', 1265014), 265014);
    }
    const catalogs = excel('BeyondCostumeDrawingExcelConfigData');
    if (catalogs.length) {
        const basic = rowBy(catalogs, 'BeyondCostumeDrawing', 'nameTextMapHash', 2308662065);
        const other = rowBy(catalogs, 'BeyondCostumeDrawing', 'nameTextMapHash', 3738529297);
        fields.catalog_id = resolveField('BeyondCostumeDrawing.id', [
            { row: basic, value: 270001 }, { row: other, value: 270002 },
        ]);
        fields.catalog_targets = resolveField('BeyondCostumeDrawing.targets', [
            { row: basic, value: [260001] }, { row: other, value: [260002] },
        ]);
        fields.quality.catalog = field('BeyondCostumeDrawing.quality', basic, 'Green');
    }
    const halls = excel('BeyondHallExcelConfigData');
    if (halls.length) {
        const basic = resolveRow(halls, 'BeyondHall:archive_1', row => Object.values(row).includes('BeyondHallArchive_1'));
        const other = resolveRow(halls, 'BeyondHall:archive_2', row => Object.values(row).includes('BeyondHallArchive_2'));
        for (const [name, first, second] of [
            ['id', 1, 2], ['name', 1209932345, 1573620553], ['description', 3795565332, 1058083676],
            ['archive', 'BeyondHallArchive_1', 'BeyondHallArchive_2'],
            ['image', 'UI_Beyd_HallThemeImg_Mnjc', 'UI_Beyd_HallThemeImg_Yly'],
            ['preview', 'UI_Beyd_HallThemePic_Mnjc', 'UI_Beyd_HallThemePic_Yly'],
        ]) fields[`hall_${name}`] = resolveField(`BeyondHall.${name}`, [
            { row: basic, value: first }, { row: other, value: second },
        ]);
    }
    const slots = excel('BeyondCostumeUISlotEntryExcelConfigData');
    if (slots.length) fields.slot_category = resolveField('BeyondCostumeUISlotEntry.category', [
        { row: rowBy(slots, 'BeyondCostumeUISlotEntry', 'configID', 2), value: 'Costume' },
        { row: rowBy(slots, 'BeyondCostumeUISlotEntry', 'configID', 16), value: 'Appearance' },
    ]);
    const colors = excel('BydCostumeColorTagExcelConfigData');
    if (colors.length) {
        const white = resolveRow(colors, 'BydCostumeColorTag:White', row => Object.values(row).includes('White'));
        const red = resolveRow(colors, 'BydCostumeColorTag:Red', row => Object.values(row).includes('Red'));
        fields.color_tag = resolveField('BydCostumeColorTag.tag', [{ row: white, value: 'White' }, { row: red, value: 'Red' }]);
        fields.color_name = resolveField('BydCostumeColorTag.name', [{ row: white, value: 4150001616 }, { row: red, value: 107381352 }]);
    }
    return fields;
}

function resolveTcgPortraitField(rows) {
    if (!rows.length) return undefined;
    return resolveField('GCGTalkDetailIcon.circular_portrait', [
        { row: rowBy(rows, 'GCGTalkDetailIcon', 'id', 10000002), value: 'UI_AvatarIcon_Ayaka_Circle' },
        { row: rowBy(rows, 'GCGTalkDetailIcon', 'id', 10000003), value: 'UI_AvatarIcon_Qin_Circle' },
    ]);
}

function resolveSereniteaLayoutField(bin) {
    // Exact component order in the two source suites; unrelated point arrays
    // cannot qualify just because they too contain objects or coordinates.
    const witnesses = [
        ['Home_Suite_Camp_01', [372301, 374102, 373113, 370504, 370503, 372405, 374102, 374102, 374102, 374102, 374102, 372405]],
        ['Home_Suite_Exterior_03', [374102, 372405, 372301, 370207, 372405, 374102, 374102]],
    ];
    return resolveField('HomeworldFurnitureSuit.components', witnesses.map(([name, ids]) => ({
        row: bin(`HomeworldFurnitureSuit/${name}.json`),
        match: value => Array.isArray(value) && isDeepStrictEqual(value.map(unit => unit?.furnitureID), ids),
    })));
}

module.exports = { resolveCostumeIconField, resolveMiliastraFields, resolveTcgPortraitField, resolveSereniteaLayoutField };
