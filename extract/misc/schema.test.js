const assert = require('node:assert/strict');
const { test } = require('node:test');
const build = require('../extractMisc');
const { parseSource } = require('./source');
const { resolveMaterialSourceFields, resolveProfilePictureFields, resolveLocalLegendFields, resolveLoadingSituationFields } = require('./schema');
const { resolveGraeaeFields } = require('./graeae-schema');
const { attachmentNames, prepareGraeaeImages } = require('../../resources/prepare-graeae-images');

// Entirely in memory: no live source, resource cache, Git, SQLite or exporter.
const fixture = (tables, texts = {}) => ({ excel: table => tables[table] || [], text: (_, hash) => texts[hash] || '' });
const extract = (tables, texts) => build('CHS', fixture(tables, texts));
const defaultUnlock = 'PROFILE_PICTURE_UNLOCK_BY_DEFAULT';
const jumpWitness = key => ({ id: 210001, [key]: [3428310340, 1366389946, 3237647833, 326911317, 696736979, 1009452272, 549049380] });
const legendWitness = (monsters, resource) => ({ id: 101,
    [monsters]: monsters === 'monsterId' ? 22132001 : [22132001], [resource]: '589278960941904205' });
const loadingWitnesses = key => [{ stageID: 65, [key]: [156] }, { stageID: 66, [key]: [149, 150, 151] }];
const profileWitnesses = (avatar, type) => [
    { id: 1, unlockParam: 10000005, [avatar]: 10000005, [type]: 'PROFILE_PICTURE_UNLOCK_BY_AVATAR' },
    { id: 11, unlockParam: 200501, [avatar]: 10000005, [type]: 'PROFILE_PICTURE_UNLOCK_BY_COSTUME' },
];

for (const [avatarField, typeField] of [['HOKCMBCOBAO', 'NLAPNBMECDF'], ['GEMAPGHIKKG', 'FBFBNKHLFAO'], ['HOKCMBCOBAO', 'unlockType'], ['arbitrary_avatar', 'arbitrary_unlock']]) {
    test(`profile fields ${avatarField}/${typeField} retain names and enum-specific joins`, () => {
        const tables = {
            ProfilePictureExcelConfigData: [
                ...[[1, 10000005], [11, 10000005], [2, 10000007], [21, 10000007], [6000, 10000075]].map(([id, avatar]) => ({
                    id, nameTextMapHash: 10, [avatarField]: avatar, [typeField]: defaultUnlock,
                    ...profileWitnesses(avatarField, typeField).find(row => row.id === id),
                })),
                ...['AVATAR', 'COSTUME', 'ITEM', 'PARENT_QUEST'].map((kind, i) => ({ id: 100 + i, nameTextMapHash: 11,
                    [avatarField]: 999, [typeField]: `PROFILE_PICTURE_UNLOCK_BY_${kind}`, unlockParam: 42 })),
                { id: 104, nameTextMapHash: 11, [typeField]: defaultUnlock, unlockParam: 42 },
            ],
            AvatarExcelConfigData: [{ id: 42, nameTextMapHash: 12 }],
            AvatarCostumeExcelConfigData: [{ skinId: 42, nameTextMapHash: 13 }],
            MaterialExcelConfigData: [{ id: 42, nameTextMapHash: 14 }],
            MainQuestExcelConfigData: [{ id: 42, titleTextMapHash: 15 }],
        };
        const texts = { 10: 'Name {0} / {1}', 11: 'Unchanged {0}', 12: 'Avatar', 13: 'Costume', 14: 'Item', 15: 'Quest' };
        const result = extract(tables, texts);
        for (const id of [1, 2, 11, 21, 6000]) {
            const item = result[`profile_picture-${id}`];
            assert.equal(item.name, `Name ${id === 6000 ? '{REALNAME[ID(1)]}' : '{NICKNAME}'} / {1}`);
            assert.deepEqual(item.source.hashes, ['10']);
            if (![1, 11].includes(id)) assert.deepEqual(item.relations, []);
        }
        for (const [i, category, role, name] of [[0, 'character', 'unlock_avatar', 'Avatar'], [1, 'outfit', 'unlock_costume', 'Costume'],
            [2, 'material', 'unlock_material', 'Item'], [3, 'task', 'unlock_quest', 'Quest']]) {
            assert.equal(result[`profile_picture-${100 + i}`].name, 'Unchanged {0}');
            assert.deepEqual(result[`profile_picture-${100 + i}`].relations, [{ category, id: '42', source_id: 42, name, role }]);
        }
        assert.deepEqual(result['profile_picture-104'].relations, []);
        tables.ProfilePictureExcelConfigData[0][avatarField] = 10000075;
        assert.throws(() => extract(tables, texts), /Cannot resolve field ProfilePicture.nameAvatar/);
    });
}

test('profile witnesses distinguish avatar from unlockParam and reject mixed source keys', () => {
    const rows = profileWitnesses('avatar', 'type');
    assert.deepEqual(resolveProfilePictureFields(rows), { nameAvatar: 'avatar', unlockType: 'type' });
    rows[1].otherAvatar = rows[1].avatar;
    delete rows[1].avatar;
    assert.throws(() => resolveProfilePictureFields(rows), /Cannot resolve field ProfilePicture.nameAvatar: inconsistent/);
});

test('ambiguous foreign-key targets fail rather than select the last source row', () => {
    assert.throws(() => extract({ AvatarExcelConfigData: [{ id: 42 }, { id: 42 }] }), /Ambiguous misc source ID: AvatarExcelConfigData.id:42/);
    assert.throws(() => extract({ AvatarCostumeExcelConfigData: [{ skinId: 42 }, { skinId: 42 }] }), /Ambiguous misc source ID: AvatarCostumeExcelConfigData.skinId:42/);
});

test('namecard jump-description inference preserves exact prose, not dungeon-shaped decoys', () => {
    const material = { id: 42, materialType: 'MATERIAL_NAMECARD', nameTextMapHash: 10 };
    const run = (acquisition, key) => extract({ MaterialExcelConfigData: [material], MaterialSourceDataExcelConfigData: [jumpWitness(key), acquisition] },
        { 10: 'Card', 11: 'Source', 12: 'Jump', 13: 'Not acquisition' });
    for (const key of ['jumpDescs', 'HNNPIIJLLEK', 'unrelated_new_key']) {
        const item = run({ id: 42, textList: [11], [key]: [12], dungeonList: [13] }, key)['namecard-42'];
        assert.deepEqual(item.sections, [{ kind: 'acquisition', text: 'Source' }, { kind: 'acquisition', text: 'Jump' }]);
        assert.deepEqual(item.source.hashes, ['10', '11', '12']);
    }
});

test('LocalLegend scalar and list schemas preserve every monster, exact resources and icon deduplication', () => {
    const run = (row, monsters = 'monsterIdList', resource = 'CBAPFGGBHEA') => extract({
        LocalLegendExcelConfigData: [{ id: 9, nameTextMapHash: 10, iconHash: '18446744073709551615', prefabName: 'Prefab', ...row }, legendWitness(monsters, resource)],
        MonsterExcelConfigData: [{ id: 41, describeId: 51, nameTextMapHash: 11 }, { id: 42, describeId: 52, nameTextMapHash: 12 },
            { id: 43, describeId: 53, nameTextMapHash: 13 }],
        MonsterDescribeExcelConfigData: [{ id: 51, icon: 'One' }, { id: 52, icon: 'Two' }, { id: 53, icon: 'One' }],
    }, { 10: 'Legend', 11: 'First', 12: 'Second', 13: 'Third' })['gallant_path-9'];
    const old = run({ monsterId: 41, DFBBICALCFF: '9007199254740993' }, 'monsterId', 'DFBBICALCFF');
    assert.deepEqual(run({ monsterIdList: [41], CBAPFGGBHEA: '9007199254740993' }), old);
    assert.deepEqual(run({ renamedMonsters: [41], renamedResource: '9007199254740993' }, 'renamedMonsters', 'renamedResource'), old);
    const multiple = run({ monsterIdList: [41, 42, 43] });
    assert.deepEqual(multiple.relations.map(rel => [rel.source_id, rel.name]), [[41, 'First'], [42, 'Second'], [43, 'Third']]);
    assert.deepEqual(multiple.images, [{ name: 'One', kind: 'monster_icon' }, { name: 'Two', kind: 'monster_icon' }]);
    assert(old.source.references.includes('18446744073709551615'));
    assert(old.source.references.includes('9007199254740993'));
    for (const ids of [[], [41, 41], [0], ['41'], [1.5], null])
        assert.throws(() => run({ monsterIdList: ids }), /Invalid LocalLegend monster IDs/);
    assert.throws(() => run({}), /Invalid LocalLegend monster IDs/);
    assert(run({ monsterIdList: [99] }).diagnostics.includes('missing_relation:MonsterExcelConfigData:99'));
    const missingDescribe = extract({ LocalLegendExcelConfigData: [{ id: 206, monsterIdList: [28021801] }, legendWitness('monsterIdList', 'resource')],
        MonsterExcelConfigData: [{ id: 28021801, describeId: 28021801 }] })['gallant_path-206'];
    assert.deepEqual(missingDescribe.images, []);
    assert.deepEqual(missingDescribe.relations.map(rel => rel.source_id), [28021801]);
    assert(missingDescribe.source.references.includes('MonsterDescribeExcelConfigData:28021801'));
    assert(missingDescribe.diagnostics.includes('missing_monster_describe:28021801'));
    assert.deepEqual(parseSource('{"hash":18446744073709551615}'), { hash: '18446744073709551615' });
});

test('loading dungeon inference joins exact IDs, not the similarly shaped tip selector', () => {
    const run = (situation, key = 'CLKAAOHKPBH') => extract({
        LoadingTipsExcelConfigData: [{ id: 1, tipsTitleTextMapHash: 10, stageID: '7' }],
        LoadingSituationExcelConfigData: [{ stageID: 7, ...situation }, ...loadingWitnesses(key)],
        DungeonExcelConfigData: [{ id: 41, nameTextMapHash: 11 }, { id: 42, nameTextMapHash: 12 }],
    }, { 10: 'Tip', 11: 'First dungeon', 12: 'Second dungeon' })['loading_tip-1'];
    const expected = [{ id: '42', name: 'Second dungeon' }, { id: '41', name: 'First dungeon' }];
    for (const key of ['LLPOIIOJKOC', 'CLKAAOHKPBH', 'new_dungeon_key']) {
        const item = run({ [key]: [42, 41], LLNOODHGHAM: [999], HEIDBEEFNBP: [999] }, key);
        assert.deepEqual(item.loading_situations[0].dungeons, expected);
        assert(item.source.references.includes('DungeonExcelConfigData:42'));
        assert(!item.source.references.some(ref => ref.includes('999')));
    }
    assert.throws(() => run({ CLKAAOHKPBH: [999] }), /Missing loading dungeon: 7:999/);
    assert.equal(run({ HEIDBEEFNBP: [41] }).loading_situations[0].dungeons, undefined);
});

// Historical encodings exist only as independent test fixtures, never fallbacks.
const graeaeKeys = {
    old: {
        Topic: ['KEKHMPOIFHO', 'LBCPBPBJDAB', 'DGKPMJKEGDO'],
        Message: ['AEFJCKAJMFL', 'HAOFOHIJENC', 'JJGAICEDLNP', 'LICNBELGBCN', 'PADEPANADLD', 'GEJENCICCEC', 'DBMAKNMIGLP',
            'FJHBPBFGDNN', 'HCHADPEJPLB', 'HEEHCBAOFIK', 'PJIDDONOIGK', 'EDGLCIBPKNJ'],
        Option: ['HANOBLDBAPA', 'HAOFOHIJENC', 'BHLEPODADCG', 'LICNBELGBCN', 'PADEPANADLD', 'KLDJCKFKAKI'],
        Character: ['HALPCBNIPJP', 'IMPGHHNHBBD'],
    },
    current: {
        Topic: ['CNMPAADJIFL', 'JDMOCEGAAGK', 'OEOMPAGFEJM'],
        Message: ['JCAHMOFECFE', 'DILKJNMPNFL', 'PKHEFFOICKC', 'HLFBKDKAAGG', 'OLFMIDDKIKO', 'AHDCIPDCMFP', 'CHDGFMBOPPP',
            'FGICGCKEFAK', 'HLFGNGHKCJD', 'EAKBCADOOLA', 'HNEAFCKDCMA', 'OAPNJMAJKBM'],
        Option: ['MEEMNJEJMPJ', 'DILKJNMPNFL', 'CPONCLDGFED', 'HLFBKDKAAGG', 'OLFMIDDKIKO', 'MDJJHKLDBJE'],
        Character: ['AMPOJAAMOBL', 'AKMEGJBMBMP'],
    },
};
const graeaeTexts = { 10: 'Topic', 11: 'Full message longer than preview', 12: 'Preview', 13: 'Location',
    14: 'Go here', 15: 'Reply one', 16: 'Reply two', 17: 'Speaker' };
function graeaeFixture(version) {
    const encode = (kind, values) => Object.fromEntries(values.flatMap((value, i) => value === undefined ? [] : [[graeaeKeys[version][kind][i], value]]));
    return {
        TpsGlassesChatTopicExcelConfigData: [encode('Topic', [7, 10, 'TopicIcon']),
            encode('Topic', [1001, 562223715]),
            encode('Topic', [1, 602891992, 'ART/UI/Atlas/LS/TPS/TPSGlasses/UI_Icon_TpsGlassesChatPage_Chat']),
            ...[5, 10, 15].map(id => encode('Topic', [id, 0]))],
        TpsGlassesChatMessageExcelConfigData: [
            { ...encode('Message', [701, 7, 1, 2, undefined, 11, 12, 'TEXT']), characterId: 3 },
            encode('Message', [702, 7, 3, 4, 7031, 0, 0, 'IMAGE', 'FullImage', 'Thumbnail']),
            encode('Message', [703, 7, 4, 5, undefined, 14, 0, 'LOCATION', undefined, undefined, 13, 45]),
            encode('Message', [704, 7, 5, 6]), // omitted kind is a real control node
            encode('Message', [705, 7, 6, undefined, undefined, 0, 0, 'HESPERIDES_MAP']),
            // Source-calibrated witnesses plus minimal graph-completing nodes.
            { ...encode('Message', [100101, 1001, 1, 2, undefined, 3421014762, 505105052, 'TEXT']), characterId: 1 },
            encode('Message', [100102, 1001, 3, undefined, 1001011, 1710348866, 761503324, 'TEXT']),
            encode('Message', [15005, 15, 5, undefined, undefined, 4287232919, 2956968944, 'IMAGE',
                'ART/UI/Atlas/LS/TPS/TPSGlasses/TPSGlassesChatImg/UI_Img_GlassesChat_TreasureMap',
                'ART/UI/Atlas/LS/TPS/TPSGlasses/TPSGlassesChatPic/UI_Img_GlassesChat_TreasureMap']),
            encode('Message', [5008, 5, 8, undefined, 5002, 82166551, 867739624, 'LOCATION', undefined, undefined, 1008191327, 77130]),
            encode('Message', [10011, 10, 11]),
        ],
        TpsGlassesChatOptionExcelConfigData: [encode('Option', [7031, 7, 2, 3, undefined, 15]), encode('Option', [7032, 7, 2, 3, 7031, 16]),
            encode('Option', [1001011, 1001, 2, 3, undefined, 4069531165]),
            encode('Option', [10010, 10, 10, 11, 10002, 959818708]),
            encode('Option', [10002, 10, 1, 10]), encode('Option', [5002, 5, 1, 8])],
        TpsGlassesChatCharacterExcelConfigData: [{ characterId: 3, ...encode('Character', [17, 'SpeakerIcon']) },
            { characterId: 1, ...encode('Character', [1264548403, 'ART/UI/Atlas/NPCIcon/UI_NPC_Snezhnaya_GreyEye_Circle']) }],
    };
}

for (const version of ['old', 'current']) {
    test(`Graeae ${version} fields preserve complete graph, branches, speakers and attachments`, () => {
        const item = extract(graeaeFixture(version), graeaeTexts)['graeae_message-7'];
        assert.equal(item.name, 'Topic');
        assert.equal(item.show, true);
        assert.deepEqual(item.message_thread, { initial: ['message-701'], nodes: [
            { id: 'message-701', kind: 'TEXT', text: graeaeTexts[11], preview: 'Preview', speaker: 'Speaker', next: ['option-7031', 'option-7032'] },
            { id: 'option-7031', kind: 'OPTION', text: 'Reply one', next: ['message-702'] },
            { id: 'option-7032', kind: 'OPTION', text: 'Reply two', requires: 'option-7031', next: ['message-702'] },
            { id: 'message-702', kind: 'IMAGE', text: '', requires: 'option-7031', image: { name: 'FullImage', kind: 'illustration' }, next: ['message-703'] },
            { id: 'message-703', kind: 'LOCATION', text: 'Go here', location: 'Location', next: ['message-704'] },
            { id: 'message-704', kind: 'CONTROL', text: '', next: ['message-705'] },
            { id: 'message-705', kind: 'HESPERIDES_MAP', text: '', next: [] },
        ] });
        assert.deepEqual(item.images, [{ name: 'FullImage', kind: 'illustration' }]);
        for (const ref of ['TopicIcon', 'SpeakerIcon', 'Thumbnail', 'GraeaeLocationQuest:45']) assert(item.source.references.includes(ref));
        assert.deepEqual(item, extract(graeaeFixture(version === 'old' ? 'current' : 'old'), graeaeTexts)['graeae_message-7']);
    });
}

test('every Graeae field rejects missing and ambiguous evidence, including optional fields', () => {
    for (const version of ['old', 'current']) for (const [kind, keys] of Object.entries(graeaeKeys[version])) for (const key of keys) {
        const table = `TpsGlassesChat${kind}ExcelConfigData`, original = graeaeFixture(version)[table];
        for (const ambiguity of [false, true]) {
            const rows = structuredClone(original);
            for (const row of rows) if (Object.hasOwn(row, key)) {
                if (ambiguity) row.unexpectedTwin = row[key];
                else delete row[key];
            }
            assert.throws(() => resolveGraeaeFields(kind, rows), ambiguity ? /ambiguous/ : /missing/, `${version}/${kind}/${key}`);
        }
    }
});

test('Graeae missing/duplicate identities and broken graph links fail in both schemas', () => {
    for (const version of ['old', 'current']) {
        const keys = graeaeKeys[version];
        const rejects = (mutate, pattern) => {
            const tables = graeaeFixture(version);
            mutate(tables);
            assert.throws(() => extract(tables, graeaeTexts), pattern);
        };
        for (const kind of ['Topic', 'Message', 'Option', 'Character']) rejects(tables => {
            const rows = tables[`TpsGlassesChat${kind}ExcelConfigData`]; rows.push({ ...rows[0] });
        }, /Duplicate Graeae/);
        rejects(tables => { delete tables.TpsGlassesChatTopicExcelConfigData[0][keys.Topic[0]]; }, /Invalid Graeae Topic ID/);
        rejects(tables => { tables.TpsGlassesChatMessageExcelConfigData[0][keys.Message[1]] = 99; }, /Missing Graeae topic/);
        rejects(tables => { tables.TpsGlassesChatOptionExcelConfigData[0][keys.Option[1]] = 99; }, /Missing Graeae topic/);
        rejects(tables => { tables.TpsGlassesChatMessageExcelConfigData[0][keys.Message[2]] = 0; }, /Invalid Graeae position/);
        rejects(tables => { tables.TpsGlassesChatMessageExcelConfigData[0][keys.Message[3]] = 701; }, /Missing Graeae successor/);
        rejects(tables => { tables.TpsGlassesChatMessageExcelConfigData[1][keys.Message[4]] = 701; }, /Missing Graeae option/);
        rejects(tables => { tables.TpsGlassesChatMessageExcelConfigData[0].characterId = 99; }, /Missing Graeae character/);
        rejects(tables => { tables.TpsGlassesChatMessageExcelConfigData[0][keys.Message[7]] = 'UNKNOWN'; }, /Unknown Graeae message kind/);
    }
});

test('all misc calibrations require unique field and row witnesses', () => {
    const cases = [
        [resolveMaterialSourceFields, [jumpWitness('jump')], ['jump']],
        [resolveProfilePictureFields, profileWitnesses('avatar', 'unlock'), ['avatar', 'unlock']],
        [resolveLocalLegendFields, [legendWitness('monsters', 'resource')], ['monsters', 'resource']],
        [resolveLoadingSituationFields, loadingWitnesses('dungeons'), ['dungeons']],
    ];
    for (const [resolve, original, keys] of cases) {
        assert.deepEqual(resolve([]), {});
        for (const key of keys) for (const ambiguous of [false, true]) {
            const rows = structuredClone(original);
            for (const row of rows) {
                if (ambiguous) row.twin = row[key];
                else delete row[key];
            }
            assert.throws(() => resolve(rows), ambiguous ? /ambiguous/ : /missing/, `${resolve.name}/${key}`);
        }
        assert.throws(() => resolve([...original, { ...original[0] }]), /Cannot resolve row .*ambiguous/);
        const missing = original.length > 1 ? original.slice(1) : [{ id: -1 }];
        assert.throws(() => resolve(missing), /Cannot resolve row .*missing/);
        const renamed = original.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [keys.includes(key) ? `new_${key}` : key, value])));
        const expected = resolve(original);
        assert.deepEqual(resolve(renamed), Object.fromEntries(Object.entries(expected).map(([name, key]) => [name, `new_${key}`])));
        assert.deepEqual(resolve(original), expected, 'another input must not poison the next resolution');
    }
    const both = { ...legendWitness('monsterId', 'resource'), monsterIdList: [22132001] };
    assert.throws(() => resolveLocalLegendFields([both]), /LocalLegend.monsters: ambiguous/);
});

test('Graeae arbitrary table-local renaming preserves the graph and never caches another input', () => {
    const original = graeaeFixture('old'), expected = extract(original, graeaeTexts);
    for (const revision of ['alpha', 'beta']) {
        const renamed = Object.fromEntries(Object.entries(original).map(([table, rows], t) => {
            const keys = [...new Set(rows.flatMap(Object.keys))].filter(key => key !== 'characterId');
            const names = Object.fromEntries(keys.map((key, i) => [key, `field_${revision}_${t}_${i}`]));
            return [table, rows.map(row => Object.fromEntries(Object.entries(row).reverse().map(([key, value]) => [names[key] || key, value])))];
        }));
        assert.deepEqual(extract(renamed, graeaeTexts), expected);
        assert.deepEqual(extract(original, graeaeTexts), expected);
    }
    for (const kind of ['Topic', 'Message', 'Option', 'Character']) {
        const table = `TpsGlassesChat${kind}ExcelConfigData`, rows = original[table];
        const key = kind === 'Character' ? 'characterId' : graeaeKeys.old[kind][0];
        const id = { Topic: 1001, Message: 100101, Option: 1001011, Character: 1 }[kind];
        const anchor = rows.find(row => row[key] === id);
        assert.throws(() => resolveGraeaeFields(kind, rows.filter(row => row !== anchor)), /Cannot resolve row .*missing/);
        assert.throws(() => resolveGraeaeFields(kind, [...rows, { ...anchor }]), /Cannot resolve row .*ambiguous/);
    }
});

test('shared inference imports do not load global or source', () => {
    const { execFileSync } = require('node:child_process');
    const output = execFileSync(process.execPath, ['-e', `
        require('./extract/misc/schema'); require('./extract/misc/graeae-schema'); require('./resources/prepare-graeae-images');
        const loaded = Object.keys(require.cache).map(file => file.replaceAll('\\\\', '/'));
        if (loaded.some(file => file.endsWith('/extract/global.js') || file.endsWith('/misc/source.js'))) process.exit(1);
        process.stdout.write('pure');
    `], { cwd: require('node:path').resolve(__dirname, '../..'), encoding: 'utf8' });
    assert.equal(output, 'pure');
});

test('Graeae image plans share inference, keep exact Sprite variants and reject stale/duplicate resources', t => {
    const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
    const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'graeae-inference-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const excel = path.join(root, 'ExcelBinOutput'); fs.mkdirSync(excel);
    const sourceFile = path.join(excel, 'TpsGlassesChatMessageExcelConfigData.json');
    const mapBinary = path.join(root, 'source.map'), mapFile = path.join(root, 'map.json'), output = path.join(root, 'plan.json');
    fs.writeFileSync(mapBinary, 'fixture map');
    const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    let expected;
    for (const version of ['old', 'current']) {
        const rows = graeaeFixture(version).TpsGlassesChatMessageExcelConfigData, keys = graeaeKeys[version].Message;
        rows[1][keys[8]] = 'ART/Full/UI_FullImage'; rows[1][keys[9]] = 'ART/Thumbnail/UI_ThumbnailOnly';
        const renamed = rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key === 'characterId' ? key : `renamed_${keys.indexOf(key)}`, value])));
        const names = attachmentNames(rows);
        assert.deepEqual(names, new Set(['UI_FullImage', 'UI_Img_GlassesChat_TreasureMap']));
        assert.deepEqual(attachmentNames(renamed), names);
        if (expected) assert.deepEqual(names, expected);
        expected = names;
        const invalid = structuredClone(renamed); delete invalid[1].renamed_8;
        assert.throws(() => attachmentNames(invalid), /Missing full attachment resource/);
        const ambiguous = renamed.map(row => ({ ...row, duplicatedKind: row.renamed_7 }));
        assert.throws(() => attachmentNames(ambiguous), /Graeae.Message.kind: ambiguous/);
        fs.writeFileSync(sourceFile, JSON.stringify(renamed));
    }
    const entries = [...expected].flatMap((Name, i) => [1, 2].map(variant => ({ Name, Type: 'Sprite', Source: `block${variant}`, PathID: String(i * 10 + variant) })));
    const map = { map: mapBinary, sha256: sha256(mapBinary), entries };
    fs.writeFileSync(mapFile, JSON.stringify(map));
    const { execFileSync } = require('node:child_process');
    const result = JSON.parse(execFileSync(process.execPath, [path.resolve(__dirname, '../../resources/prepare-graeae-images.js'), root, mapFile, output], { encoding: 'utf8' }));
    assert.equal(result.names, 2); assert.equal(result.candidates, 4);
    const plan = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(plan.image_selection, 'largest');
    assert.deepEqual(Object.values(plan.resources).map(row => row.image), entries);
    assert.deepEqual(plan.inputs, [sourceFile, mapFile, mapBinary].map(file => ({ file, sha256: sha256(file) })));
    const original = fs.readFileSync(output, 'utf8');
    assert.throws(() => prepareGraeaeImages(root, mapFile, output), /EEXIST/);
    assert.equal(fs.readFileSync(output, 'utf8'), original);
    const unused = path.join(root, 'never-written.json');
    map.entries.push(entries[0]); fs.writeFileSync(mapFile, JSON.stringify(map));
    assert.throws(() => prepareGraeaeImages(root, mapFile, unused), /Duplicate named resource identity/);
    map.entries = []; fs.writeFileSync(mapFile, JSON.stringify(map));
    assert.throws(() => prepareGraeaeImages(root, mapFile, unused), /Missing named attachment/);
    fs.writeFileSync(mapBinary, 'changed map');
    assert.throws(() => prepareGraeaeImages(root, mapFile, unused), /Asset map snapshot changed/);
    assert(!fs.existsSync(unused));
});
