const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveMiliastraFields, resolveCostumeIconField, resolveTcgPortraitField, resolveSereniteaLayoutField } = require('./fields');
const { selectPortraits } = require('../../resources/prepare-tcg-portraits');
const fs = require('node:fs');
const vm = require('node:vm');

// Values copied from the source witnesses, deliberately not their property names.
function fixture() {
    return {
        BeyondCostumeExcelConfigData: [
            { costumeId: 260001, u_icon: '3806693058812336722', u_body: ['BODY_GIRL'], u_color: ['White'],
                u_quality: 'Green', u_groups: [{ u_slots: ['UpperCloth'] }, {}] },
            { costumeId: 260002, u_icon: '14425841620430768778' },
            { costumeId: 504601, u_variant: 504401, u_groups: [{ u_slots: ['UpperCloth', 'LowerCloth'] }, {}] },
            { costumeId: 1501401, u_source: 501401 },
        ],
        BeyondCostumeSuitExcelConfigData: [
            { suitId: 265001, u_body: ['BODY_GIRL'], u_color: ['Orange'], u_quality: 'Blue' },
            { suitId: 265044, u_extra: '10709550370493609764' },
            { suitId: 265046, u_variant: 265044 },
            { suitId: 1265014, u_source: 265014 },
        ],
        BeyondCostumeDrawingExcelConfigData: [
            { nameTextMapHash: 2308662065, u_id: 270001, u_targets: [260001], u_quality: 'Green' },
            { nameTextMapHash: 3738529297, u_id: 270002, u_targets: [260002] },
        ],
        BeyondHallExcelConfigData: [
            { u_id: 1, u_name: 1209932345, u_desc: 3795565332, u_archive: 'BeyondHallArchive_1',
                u_image: 'UI_Beyd_HallThemeImg_Mnjc', u_preview: 'UI_Beyd_HallThemePic_Mnjc' },
            { u_id: 2, u_name: 1573620553, u_desc: 1058083676, u_archive: 'BeyondHallArchive_2',
                u_image: 'UI_Beyd_HallThemeImg_Yly', u_preview: 'UI_Beyd_HallThemePic_Yly' },
        ],
        BeyondCostumeUISlotEntryExcelConfigData: [{ configID: 2, u_category: 'Costume' }, { configID: 16, u_category: 'Appearance' }],
        BydCostumeColorTagExcelConfigData: [{ u_tag: 'White', u_name: 4150001616 }, { u_tag: 'Red', u_name: 107381352 }],
    };
}
function transform(value, keyMapper) {
    if (Array.isArray(value)) return value.map(value => transform(value, keyMapper));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).flatMap(([key, value]) =>
        keyMapper(key).map(key => [key, transform(value, keyMapper)])));
}
const resolve = tables => resolveMiliastraFields(name => tables[name] || []);
const leaves = object => Object.values(object).flatMap(value => typeof value === 'object' ? leaves(value) : [value]);

test('every Miliastra field resolves after arbitrary per-table and nested renaming, without cross-source cache', () => {
    for (const prefix of ['revision_a', 'revision_b', 'notAnAlias']) {
        const tables = Object.fromEntries(Object.entries(fixture()).map(([table, rows], index) => [table,
            transform(rows, key => [key.startsWith('u_') ? `${prefix}_${index}_${key}` : key]),
        ]));
        const fields = resolve(tables);
        assert.equal(leaves(fields).length, 26);
        assert(leaves(fields).every(key => key.startsWith(prefix)));
        assert.notEqual(fields.colors.costume, fields.colors.suit);
        assert.notEqual(fields.colors.costume, fields.color_tag);
        assert.notEqual(fields.quality.costume, fields.quality.catalog);
        assert.equal(fields.costume_icon, resolveCostumeIconField(tables.BeyondCostumeExcelConfigData));
        assert.deepEqual(tables.BeyondCostumeExcelConfigData[0][fields.slot_groups][0][fields.slots], ['UpperCloth']);
    }
});

for (const [table, rows] of Object.entries(fixture())) {
    const keys = new Set();
    transform(rows, key => { if (key.startsWith('u_')) keys.add(key); return [key]; });
    for (const key of keys) test(`${table}.${key} rejects missing and ambiguous fields`, () => {
        for (const ambiguity of [false, true]) {
            const tables = fixture();
            tables[table] = transform(tables[table], name => name === key ? ambiguity ? [name, 'duplicate_' + name] : [] : [name]);
            assert.throws(() => resolve(tables), /Cannot resolve (field|row)/);
        }
    });
    test(`${table} rejects missing and duplicate witness rows, but permits an empty table`, () => {
        const missing = fixture();
        missing[table].shift();
        assert.throws(() => resolve(missing), /Cannot resolve row/);
        const duplicated = fixture();
        duplicated[table].push(structuredClone(duplicated[table][0]));
        assert.throws(() => resolve(duplicated), /ambiguous/);
        const empty = fixture();
        empty[table] = [];
        assert.doesNotThrow(() => resolve(empty));
    });
}

test('multiple witnesses disambiguate coincident values; conflicting keys and rounded hashes fail', () => {
    const tables = fixture();
    tables.BeyondCostumeExcelConfigData[0].decoy = '3806693058812336722';
    assert.equal(resolve(tables).costume_icon, 'u_icon');
    tables.BeyondCostumeExcelConfigData[1].otherKey = tables.BeyondCostumeExcelConfigData[1].u_icon;
    delete tables.BeyondCostumeExcelConfigData[1].u_icon;
    assert.throws(() => resolve(tables), /inconsistent/);
    const rounded = fixture().BeyondCostumeExcelConfigData;
    rounded[0].u_icon = Number(rounded[0].u_icon);
    assert.throws(() => resolveCostumeIconField(rounded), /missing match/);
});

const portraits = field => [
    { id: 10000002, iconName: 'UI_AvatarIcon_Ayaka', [field]: 'UI_AvatarIcon_Ayaka_Circle' },
    { id: 10000003, iconName: 'UI_AvatarIcon_Qin', [field]: 'UI_AvatarIcon_Qin_Circle' },
];
test('TCG extraction and resource preparation share the inferred circular portrait', () => {
    for (const field of ['renamedCircle', 'unrelated_123']) {
        const rows = portraits(field);
        const entries = rows.flatMap(row => [
            { Type: 'Sprite', Name: row.iconName, Source: 'block', PathID: '1' },
            { Type: 'Sprite', Name: row[field], Source: 'block', PathID: String(row.id) },
        ]);
        const result = selectPortraits(rows, [{ oppoAvatarPicId: 10000003 }], entries);
        assert.equal(resolveTcgPortraitField(rows), field);
        assert.equal(result.portraits, 1);
        assert.deepEqual(Object.values(result.resources).map(({ image }) => image.Name), ['UI_AvatarIcon_Qin_Circle']);
    }
});
test('TCG missing/ambiguous witnesses reject before filtering, empty tables are allowed', () => {
    const missing = portraits('unknown');
    delete missing[0].unknown;
    const ambiguous = portraits('unknown').map(row => ({ ...row, duplicate: row.unknown }));
    for (const rows of [missing, ambiguous, portraits('unknown').slice(1), [...portraits('unknown'), portraits('unknown')[0]]])
        assert.throws(() => selectPortraits(rows, [], []), /Cannot resolve/);
    assert.deepEqual(selectPortraits([], [], []), { portraits: 0, resources: {} });
    assert.equal(resolveCostumeIconField([]), undefined);
    assert.deepEqual(resolve({}), { quality: {}, body_types: {}, colors: {} });
});

function layouts(field) {
    return Object.fromEntries([
        ['Home_Suite_Camp_01', [372301, 374102, 373113, 370504, 370503, 372405, 374102, 374102, 374102, 374102, 374102, 372405]],
        ['Home_Suite_Exterior_03', [374102, 372405, 372301, 370207, 372405, 374102, 374102]],
    ].map(([name, ids]) => [`HomeworldFurnitureSuit/${name}.json`, {
        [field]: ids.map(furnitureID => ({ furnitureID })), decoy: [{ furnitureID: 1, position: {} }],
    }]));
}
test('Serenitea layout uses known component identities, not any array-shaped field', () => {
    for (const key of ['unknownLayout', 'anotherLayout']) {
        const data = layouts(key);
        assert.equal(resolveSereniteaLayoutField(name => data[name]), key);
        const duplicate = structuredClone(data);
        for (const row of Object.values(duplicate)) row.duplicate = row[key];
        assert.throws(() => resolveSereniteaLayoutField(name => duplicate[name]), /ambiguous/);
        delete Object.values(data)[0][key];
        assert.throws(() => resolveSereniteaLayoutField(name => data[name]), /missing match/);
    }
    assert.throws(() => resolveSereniteaLayoutField(() => null), /invalid witness/);
});

function extractor(name, tables, bins = {}) {
    const archive = {
        source_excel: table => tables[table] || [], source_bin: file => bins[file] || null,
        source_text: (lang, hash) => hash == null ? '' : `text:${hash}`,
        archive_image: (reference, category, id, kind) => ({ name: String(reference), kind }),
        archive_external_relation: () => null,
        archive_dialogue: () => ({ talks: {}, entry_talks: [], diagnostics: [] }),
        make_archive_item: (table, id, type, name, description, hashes = []) => ({ name, type, description,
            sections: [], images: [], relations: [], talks: {}, entry_talks: [], source: { table, id: String(id), hashes: hashes.map(String) } }),
        archive_export: files => ({ files, list: files.map(({ id, data }) => ({ id, name: data.name, type: data.type, show: true })) }),
    };
    const context = { module: { exports: {} }, require(dependency) {
        if (dependency === './archiveSource') return archive;
        if (dependency === '../../resources/miliastra') return { resourceIcon: hash => ({
            image: { Name: `UI_Fixture_${hash}`, PathID: '1' }, subAssetId: 1, pack: { block: 1, offset: 0 },
        }) };
        return require(dependency);
    } };
    vm.runInNewContext(fs.readFileSync(require.resolve(`./${name}`), 'utf8'), context);
    return context.module.exports[`get_${name}_export`]('en');
}
// Diagnostics intentionally identify the current source keys. Compare exported
// content without those spellings, while still requiring equal diagnostic counts.
const content = value => JSON.parse(JSON.stringify(value, (key, value) => key === 'diagnostics' ? value.length : value));
function exportFixture() {
    const tables = fixture();
    const costumes = tables.BeyondCostumeExcelConfigData;
    costumes.push({ costumeId: 500101, suitId: 265001 });
    for (const row of costumes) Object.assign(row, {
        nameTextMapHash: row.costumeId === 260001 ? 2098177674 : row.costumeId,
        descriptionTextMapHash: row.costumeId === 260001 ? 33590983 : row.costumeId + 1,
        u_icon: row.u_icon || '123',
    });
    costumes[2].suitId = 265046;
    costumes[3].suitId = 1265014;
    for (const row of tables.BeyondCostumeSuitExcelConfigData) Object.assign(row, {
        nameTextMapHash: row.suitId === 265001 ? 2405268140 : row.suitId,
        descriptionTextMapHash: row.suitId === 265001 ? 1780222704 : row.suitId + 1,
        iconHash: row.suitId === 265001 ? '2417760002026327459' : '456',
    });
    for (const row of tables.BeyondCostumeDrawingExcelConfigData) Object.assign(row, {
        descTextMapHash: row.u_id === 270001 ? 1051860642 : 889970578,
        iconHash: row.u_id === 270001 ? '3806693058812336722' : '14425841620430768778',
    });
    tables.BeyondCostumeUIEntryExcelConfigData = [{ configID: 1, nameTextMapHash: 1229270749 }, { configID: 2, nameTextMapHash: 1555233741 }];
    tables.BeyondCostumeUISlotEntryExcelConfigData = [
        { configID: 1, nameTextMapHash: 1529563972, u_category: 'Costume' },
        { configID: 2, slotType: 'UpperCloth', nameTextMapHash: 2093996, u_category: 'Costume' },
        { configID: 16, slotType: 'Hairstyle', nameTextMapHash: 2235062916, u_category: 'Appearance' },
    ];
    tables.ManualTextMapConfigData = [
        ['UI_BEYOND_GH_PREVIEW_GIRL_TAB', 609493285], ['UI_BEYOND_GH_PREVIEW_BOY_TAB', 3827955177],
        ['UI_BEYOND_COSTUME_GREEN', 17359971], ['UI_BEYOND_COSTUME_BLUE', 10],
    ].map(([textMapId, textMapContentTextMapHash]) => ({ textMapId, textMapContentTextMapHash }));
    tables.LoadingTipsExcelConfigData = Array.from({ length: 12 }, (_, index) => ({
        id: 1928 + index, stageID: '91', tipsTitleTextMapHash: 1999678687 + index, tipsDescTextMapHash: 3996501198 + index,
    }));
    return tables;
}
test('Miliastra extraction preserves content, classifications, images and relations after per-table renaming', () => {
    const tables = exportFixture();
    const baseline = extractor('miliastra', tables);
    for (const prefix of ['input_a', 'input_b']) {
        const renamed = Object.fromEntries(Object.entries(tables).map(([table, rows], i) => [table,
            transform(rows, key => [key.startsWith('u_') ? `${prefix}_${i}_${key}` : key]),
        ]));
        assert.deepEqual(content(extractor('miliastra', renamed)), content(baseline));
    }
    const costume = baseline.files.find(file => file.id === 'costume-260001').data;
    assert.equal(costume.classifications.length, 1);
    assert.deepEqual(Array.from(costume.sections, section => section.kind).sort(), ['body_type', 'category', 'color', 'quality', 'slot']);
    assert(baseline.files.find(file => file.id === 'catalog-270001').data.relations.some(relation => relation.id === 'costume-260001'));
});
test('TCG extraction consumes renamed portrait field, sharing resource-selection semantics', () => {
    for (const field of ['inputACircle', 'inputBCircle']) {
        const result = extractor('tcg', {
            GCGTalkDetailIconExcelConfigData: portraits(field),
            GCGGameRewardExcelConfigData: [{ levelId: 1, oppoAvatarPicId: 10000002, levelNameTextMapHash: 5, levelDecTextMapHash: 6 }],
        });
        assert.equal(result.files[0].data.images.find(image => image.kind === 'opponent').name, 'UI_AvatarIcon_Ayaka_Circle');
    }
});
test('Serenitea extraction consumes renamed layouts, retaining component quantities and positions', () => {
    let baseline;
    for (const field of ['inputALayout', 'inputBLayout']) {
        const bins = layouts(field);
        const tables = { FurnitureSuiteExcelConfigData: Object.keys(bins).map((file, i) => ({
            suiteID: i + 1, jsonName: file.split('/').pop().replace('.json', ''), suiteNameTextMapHash: i + 5, suiteDescTextMapHash: i + 7,
        })), HomeWorldFurnitureExcelConfigData: [...new Set(Object.values(bins).flatMap(row => row[field].map(unit => unit.furnitureID)))].map(id => ({ id })) };
        Object.values(bins)[0][field][0].position = { x: 1, z: 3 };
        const result = extractor('serenitea', tables, bins);
        if (baseline) assert.deepEqual(content(result), content(baseline));
        else baseline = result;
        const suite = result.files.find(file => file.id === 'suite-1').data;
        assert.deepEqual(Array.from(suite.layout[0].position), [1, 0, 3]);
        assert.equal(suite.layout.length, 12);
        assert.equal(suite.relations.find(relation => relation.id === 'furniture-374102').count, 6);
    }
});
