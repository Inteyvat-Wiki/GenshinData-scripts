const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const build = require('../extractMisc');
const source = require('./source');
const tracking = require('../../versions/tracking');

// In-memory extraction only: these tests never call an exporter or generate indices.
const chs = tracking.collate(build, 'CHS'), en = tracking.collate(build, 'EN');
const records = Object.values(chs);
const byType = type => records.filter(item => item.type === type);
const read = table => source.excel(table);
const text = (language, hash) => source.text(language, hash);
const tableIndex = (table, key = 'id') => new Map(read(table).map(row => [row[key] ?? 0, row]));

test('snapshot coverage, real source IDs, bilingual identity, and exact contract', () => {
    assert.deepEqual(Object.keys(chs), Object.keys(en));
    assert.deepEqual(Object.fromEntries(Object.entries(Object.groupBy(records, r => r.type)).map(([type, items]) => [type, items.length])), {
        achievement: 1854, achievement_group: 73, namecard: 293, profile_picture: 188, profile_frame: 12, expedition: 48,
        gallant_path: 13, loading_tip: 995, tutorial: 2268, graeae_message: 28,
    });
    const allowed = ['id', 'order', 'show', 'type', 'name', 'description', 'sections', 'images', 'relations', 'source', 'diagnostics', 'version', 'loading_situations', 'tutorial_category', 'message_thread'];
    for (const [language, data] of [['CHS', chs], ['EN', en]]) for (const [id, item] of Object.entries(data)) {
        assert.equal(id, `${item.type}-${item.source.id}`);
        assert.equal(typeof item.source.id, 'string');
        assert(Number.isInteger(item.order));
        assert.equal(typeof item.show, 'boolean');
        assert.equal(typeof item.name, 'string');
        assert.equal(typeof item.description, 'string');
        assert(Object.keys(item).every(key => allowed.includes(key)), id);
        assert(read(item.source.table).some(row => String(item.type === 'graeae_message' ? row.KEKHMPOIFHO : row.id ?? 0) === item.source.id), id);
        assert(item.source.hashes.every(hash => typeof hash === 'string' && /^\d+$/.test(hash) && Number(hash) <= 0xFFFFFFFF));
        assert((item.source.references || []).every(ref => typeof ref === 'string'));
        for (const img of item.images) {
            assert.equal(typeof img.name, 'string');
            assert(!img.name.includes('://'));
            assert(Object.keys(img).every(key => ['name', 'kind'].includes(key)));
        }
        for (const rel of item.relations) {
            assert.equal(typeof rel.id, 'string');
            assert.equal(typeof rel.name, 'string');
            assert(Object.keys(rel).every(key => ['category', 'id', 'name', 'role', 'source_id'].includes(key)));
            if ('source_id' in rel) assert(Number.isSafeInteger(rel.source_id));
        }
        for (const section of item.sections) {
            assert.equal(typeof section.text, 'string');
            assert(Object.keys(section).every(key => ['title', 'kind', 'text'].includes(key)));
        }
        const dependencies = new Set(item.source.hashes.filter(hash => text(language, hash)));
        assert.deepEqual(tracking.collectHashes(item), dependencies, `version dependencies: ${language}/${id}`);
        const versions = Object.fromEntries([...dependencies].map(hash => [hash, '6.0']));
        assert.equal(tracking.objectVersion(item, versions), dependencies.size ? '6.0' : '');
    }
    assert.deepEqual(records.map(r => r.order), records.map((r, i) => i));
});

test('achievements flatten every valid stage, retaining duplicate names and preStage FKs', () => {
    const rows = read('AchievementExcelConfigData');
    for (const language of ['CHS', 'EN']) {
        const data = language === 'CHS' ? chs : en;
        const valid = rows.filter(row => !row.isDisuse && row.id !== 84517 && text(language, row.titleTextMapHash)
            && (!row.preStageAchievementId || text(language, row.descTextMapHash)));
        assert.equal(valid.length, 1854);
        for (const row of valid) {
            const item = data[`achievement-${row.id}`];
            assert.equal(item.name, text(language, row.titleTextMapHash));
            assert.equal(item.description, text(language, row.descTextMapHash).replaceAll('{param0}', String(row.progress)));
            assert(!item.sections.some(section => section.kind === 'ps5_title'));
            if (row.ps5TitleTextMapHash && row.ps5TitleTextMapHash !== row.titleTextMapHash
                && row.ps5TitleTextMapHash !== row.descTextMapHash) {
                assert(!item.source.hashes.includes(String(row.ps5TitleTextMapHash)), 'excluded platform titles must not affect versions');
            }
            if (!row.preStageAchievementId) continue;
            const previous = data[`achievement-${row.preStageAchievementId}`];
            assert(previous, `unresolved stage FK: ${row.id}`);
            assert(item.relations.some(rel => rel.role === 'previous_stage' && rel.id === previous.id));
            assert(previous.relations.some(rel => rel.role === 'next_stage' && rel.id === item.id));
        }
    }
    assert(Object.values(Object.groupBy(byType('achievement'), x => x.name)).some(group => group.length > 1));
    assert(chs['achievement-80001']);
    assert(!chs['achievement-84517']);
});

test('achievement description numbers use each stage target without exporting numeric fields', () => {
    const rows = tableIndex('AchievementExcelConfigData');
    for (const [language, data] of [['CHS', chs], ['EN', en]]) {
        let replaced = 0;
        for (const item of Object.values(data).filter(item => item.type === 'achievement')) {
            const row = rows.get(Number(item.source.id)), original = text(language, row.descTextMapHash);
            if (original.includes('{param0}')) {
                replaced++;
                assert(Number.isSafeInteger(row.progress));
                assert.equal(item.description, original.split('{param0}').join(String(row.progress)));
                assert(item.source.hashes.includes(String(row.descTextMapHash)));
            } else assert.equal(item.description, original);
            assert(!/\{param\d+\}/.test(item.description), item.id);
            assert(!('progress' in item));
        }
        assert.equal(replaced, 163);
        for (const [id, target] of [[80197, 30], [80198, 150], [80199, 300]]) {
            assert(data[`achievement-${id}`].description.includes(String(target)));
        }
    }
    for (const progress of [undefined, NaN, -1, 1.5]) {
        const input = { ...source, excel: table => table === 'AchievementExcelConfigData'
            ? source.excel(table).map(row => row.id === 80197 ? { ...row, progress } : row)
            : source.excel(table) };
        assert.throws(() => build('CHS', input), /Invalid achievement description progress: 80197/);
    }
});

test('namecards use material IDs, preserve acquisition hashes and all image references', () => {
    const sources = tableIndex('MaterialSourceDataExcelConfigData');
    for (const row of read('MaterialExcelConfigData').filter(r => r.materialType === 'MATERIAL_NAMECARD')) {
        const item = chs[`namecard-${row.id}`];
        assert.equal(item.name, text('CHS', row.nameTextMapHash));
        assert.equal(item.description, text('CHS', row.descTextMapHash));
        for (const image of [row.icon, ...(row.picPath || [])].filter(Boolean)) assert(item.images.some(i => i.name === image));
        const acquisition = sources.get(row.id);
        for (const hash of [...acquisition.textList, ...acquisition.HNNPIIJLLEK]) {
            assert(item.source.hashes.includes(String(hash)));
            if (text('CHS', hash)) assert(item.sections.some(s => s.kind === 'acquisition' && s.text === text('CHS', hash)));
        }
    }
    assert(chs['namecard-210001'].sections.some(s => s.text === '初次登录游戏获取。'));
});

test('profile name formatting is narrow, bilingual and retains original TextMap provenance', () => {
    for (const [language, data] of [['CHS', chs], ['EN', en]]) for (const row of read('ProfilePictureExcelConfigData')) {
        const item = data[`profile_picture-${row.id}`];
        const token = [1, 2, 11, 21].includes(row.id) ? '{NICKNAME}' : row.id === 6000 ? '{REALNAME[ID(1)]}' : null;
        assert.equal(item.name, token ? text(language, row.nameTextMapHash).replaceAll('{0}', token) : text(language, row.nameTextMapHash));
        assert(item.source.hashes.includes(String(row.nameTextMapHash)));
    }
    const fixture = (id, avatar) => ({
        excel: table => table === 'ProfilePictureExcelConfigData' ? [{ id, HOKCMBCOBAO: avatar, nameTextMapHash: 10 }] : [],
        text: () => 'Original {0} / {1}',
    });
    assert.equal(build('CHS', fixture(123456, 10000005))['profile_picture-123456'].name, 'Original {0} / {1}');
    assert.equal(build('CHS', fixture(1, 10000005))['profile_picture-1'].name, 'Original {NICKNAME} / {1}');
    assert.throws(() => build('CHS', fixture(1, 10000075)), /name avatar changed/);
});

test('profile pictures only link the unlockType-specific FK; test entry hidden, never renamed', () => {
    const mapping = {
        PROFILE_PICTURE_UNLOCK_BY_AVATAR: ['AvatarExcelConfigData', 'id', 'character', 'unlock_avatar'],
        PROFILE_PICTURE_UNLOCK_BY_COSTUME: ['AvatarCostumeExcelConfigData', 'skinId', 'outfit', 'unlock_costume'],
        PROFILE_PICTURE_UNLOCK_BY_ITEM: ['MaterialExcelConfigData', 'id', 'material', 'unlock_material'],
        PROFILE_PICTURE_UNLOCK_BY_PARENT_QUEST: ['MainQuestExcelConfigData', 'id', 'task', 'unlock_quest'],
    };
    for (const row of read('ProfilePictureExcelConfigData')) {
        const item = chs[`profile_picture-${row.id}`], target = mapping[row.NLAPNBMECDF];
        if (!target) { assert.equal(item.relations.length, 0); continue; }
        const [table, key, category, role] = target;
        assert(tableIndex(table, key).has(row.unlockParam), `${row.id}: ${table}/${row.unlockParam}`);
        assert.deepEqual(item.relations.map(rel => [rel.category, rel.role, rel.source_id]), [[category, role, row.unlockParam]]);
    }
    const item = chs['profile_picture-99999'];
    assert.equal(item.show, false);
    assert.equal(item.name, '(test)测试用头像名称');
    assert(item.diagnostics.includes('test_profile_picture'));
    assert(!chs['profile_picture-11'].relations.some(rel => rel.source_id === 10000005));
});

test('uint64 image/reference hashes are exact source lexemes, never rounded numbers', () => {
    const json = '{"below":9007199254740991,"above":9007199254740993,"max":18446744073709551615}';
    assert.deepEqual(source.parseSource(json), { below: 9007199254740991, above: '9007199254740993', max: '18446744073709551615' });
    assert.equal(chs['profile_frame-100000'].images[0].name, '16356042606996875401');
    for (const row of read('ProfileFrameExcelConfigData')) {
        const item = chs[`profile_frame-${row.id}`];
        assert.equal(item.images[0].name, String(row.iconPathHash));
        assert(item.source.references.includes(String(row.iconPathHash)));
        assert(!item.source.hashes.includes(String(row.iconPathHash)));
        const resolved = require('../../resources/profile-frames').resourceIcon(String(row.iconPathHash));
        assert(item.images.some(image => image.kind === 'resource_icon' && image.name === resolved.image.Name));
        assert.equal(resolved.image.Type, 'Sprite');
        assert(item.source.references.some(reference => reference.startsWith(`resource64:${row.iconPathHash};`)));
    }
    const file = path.join(require('../../config.json').GenshinData_folder, 'ExcelBinOutput/LocalLegendExcelConfigData.json');
    const original = fs.readFileSync(file, 'utf8');
    for (const row of read('LocalLegendExcelConfigData')) {
        const item = chs[`gallant_path-${row.id}`];
        for (const hash of [row.iconHash, row.DFBBICALCFF]) {
            assert.equal(typeof hash, 'string');
            assert(original.includes(hash));
            assert(item.source.references.includes(hash));
        }
    }
});

test('expedition city FKs and LocalLegend-specific monster/describe icons are not guessed', () => {
    const cities = tableIndex('CityConfigData', 'cityId'), monsters = tableIndex('MonsterExcelConfigData');
    const describes = tableIndex('MonsterDescribeExcelConfigData');
    for (const row of read('ExpeditionDataExcelConfigData')) {
        const item = chs[`expedition-${row.id}`], city = cities.get(row.cityId);
        assert(city);
        assert.equal(item.description, text('CHS', row.descriptionTextMapHash));
        assert(item.images.some(img => img.name === row.picture));
        assert(item.relations.some(rel => rel.role === 'region' && rel.source_id === row.cityId && rel.name === text('CHS', city.cityNameTextMapHash)));
    }
    for (const row of read('LocalLegendExcelConfigData')) {
        const item = chs[`gallant_path-${row.id}`], monster = monsters.get(row.monsterId), describe = describes.get(monster.describeId);
        assert(monster && describe);
        assert.equal(item.description, text('CHS', row.descTextMapHash));
        assert.deepEqual(item.images, [{ name: describe.icon, kind: 'monster_icon' }]);
        assert(item.source.references.includes(row.prefabName));
        assert(item.diagnostics.includes('dedicated_illustration_unresolved'));
        assert(item.relations.some(rel => rel.source_id === monster.id && rel.role === 'monster'));
    }
});

test('loading stage FKs keep multiple backgrounds; malformed stages are not partially parsed', () => {
    const situations = tableIndex('LoadingSituationExcelConfigData', 'stageID');
    const areaIndex = tableIndex('WorldAreaConfigData');
    let multiple = 0, malformed = 0;
    for (const row of read('LoadingTipsExcelConfigData')) {
        if (row.id >= 1940 && row.id <= 1948) { assert(!chs[`loading_tip-${row.id}`]); continue; }
        const item = chs[`loading_tip-${row.id}`];
        assert.equal(item.description, text('CHS', row.tipsDescTextMapHash));
        if (!row.stageID) { assert(item.diagnostics.includes('missing_stage')); continue; }
        assert(item.source.references.includes(`stageID:${row.stageID}`));
        if (!/^[1-9]\d*(?:,[1-9]\d*)*$/.test(row.stageID)) {
            malformed++;
            assert.equal(item.images.length, 0);
            assert.equal(item.relations.length, 0);
            assert(item.diagnostics.includes(`invalid_stage:${row.stageID}`));
            continue;
        }
        const expected = [...new Set(row.stageID.split(',').map(Number).map(id => situations.get(id)?.picPath).filter(Boolean))];
        assert.deepEqual(item.images.map(img => img.name), expected);
        for (const language of ['CHS', 'EN']) {
            const result = (language === 'CHS' ? chs : en)[item.id];
            const stages = [...new Set(row.stageID.split(',').map(Number))].filter(id => situations.has(id));
            assert.deepEqual((result.loading_situations || []).map(value => value.id), stages.map(String));
            for (const value of result.loading_situations || []) {
                const raw = situations.get(Number(value.id));
                assert.equal(value.action, raw.loadingSituationType);
                assert.equal(value.terrain, raw.areaTerrainType);
                assert.deepEqual(value.image, raw.picPath ? { name: raw.picPath, kind: 'loading_background' } : undefined);
                assert.deepEqual(value.scene_ids, raw.sceneID?.length ? raw.sceneID.map(String) : undefined);
                assert.equal(value.dungeon_type, raw.dungeonType);
                assert.deepEqual(value.dungeons?.map(value => value.id), raw.LLPOIIOJKOC?.map(String));
                assert.equal(value.areas.length, (raw.area1ID || []).length);
                for (const area of value.areas) {
                    const sourceArea = areaIndex.get(Number(area.id));
                    assert(raw.area1ID.includes(sourceArea.areaID1));
                    assert.equal(area.name, text(language, sourceArea.areaNameTextMapHash));
                    assert(result.source.hashes.includes(String(sourceArea.areaNameTextMapHash)));
                }
            }
        }
        if (expected.length > 1) multiple++;
    }
    assert(multiple > 0);
    assert.equal(malformed, 2);
    for (let id = 1928; id <= 1939; id++) assert(chs[`loading_tip-${id}`].relations.some(r => r.category === 'miliastra'));
});

test('loading regions use scene-constrained level-one FKs, not images or translated names', () => {
    const tables = {
        LoadingTipsExcelConfigData: [{ id: 1, tipsTitleTextMapHash: 10, stageID: '1' }],
        LoadingSituationExcelConfigData: [{ stageID: 1, sceneID: [3], area1ID: [1], loadingSituationType: 'SITUATION_TYPE_COMMON_TRANSPORT' }],
        WorldAreaConfigData: [{ id: 100, areaID1: 1, sceneID: 3, areaType: 'LEVEL_1', areaNameTextMapHash: 20 },
            { id: 101, areaID1: 1, sceneID: 5, areaType: 'LEVEL_1', areaNameTextMapHash: 21 }],
    };
    const fixture = { excel: table => tables[table] || [], text: (_, hash) => ({ 10: 'Tip', 20: 'Correct', 21: 'Other scene' }[hash] || '') };
    assert.deepEqual(build('CHS', fixture)['loading_tip-1'].loading_situations[0].areas, [{ id: '100', name: 'Correct' }]);
    tables.LoadingSituationExcelConfigData[0].sceneID = [];
    assert.throws(() => build('CHS', fixture), /Ambiguous\/missing loading area/);
});

test('tutorial details and images follow actual platform lists, including missing/image-only sections', () => {
    const details = tableIndex('TutorialDetailExcelConfigData');
    const pushes = Object.groupBy([...read('PushTipsConfigData'), ...read('NewActivityPushTipsConfigData')], p => p.tutorialId);
    const excluded = [], platforms = { PC: 'detailIdList', Mobile: 'mobileDetailIdList', PS: 'joypadDetailIdList' };
    let missing = 0, imageOnly = 0, sharedPlatformImage = 0;
    for (const row of read('TutorialExcelConfigData')) {
        const rawDetails = Object.values(platforms).flatMap(key => row[key] || []).map(id => details.get(id));
        // Independent exact resource evidence, not names, translated text, or an ID range.
        const beyond = rawDetails.some(d => d?.imageNameList?.some(n => n.startsWith('UI_Tutorial_Byd') || n.startsWith('UI_Activity_Byd')));
        if (beyond) { excluded.push(row.id); assert(!chs[`tutorial-${row.id}`]); continue; }
        for (const [language, data] of [['CHS', chs], ['EN', en]]) {
            const item = data[`tutorial-${row.id}`];
            assert(item);
            const titleHashes = (pushes[row.id] || []).map(p => p.titleTextMapHash);
            assert(!item.name || titleHashes.some(hash => item.name === text(language, hash)));
            for (const [platform, key] of Object.entries(platforms)) {
                const ids = row[key] || [], sections = item.sections.filter(s => s.kind === platform);
                assert.deepEqual(sections, ids.map(id => ({ kind: platform, title: platform, text: text(language, details.get(id)?.descriptTextMapHash) })));
                const expectedImages = [...new Set(ids.flatMap(id => details.get(id)?.imageNameList || []))];
                assert.deepEqual(item.images.filter(img => img.kind === platform).map(img => img.name), expectedImages);
                for (const id of ids) {
                    assert(item.source.references.includes(`TutorialDetailExcelConfigData:${id}`));
                    const detail = details.get(id);
                    if (!detail) { missing++; assert(item.diagnostics.includes(`missing_tutorial_detail:${platform}:${id}`)); }
                    else {
                        if (detail.descriptTextMapHash) assert(item.source.hashes.includes(String(detail.descriptTextMapHash)));
                        if (!text(language, detail.descriptTextMapHash) && detail.imageNameList?.length) {
                            imageOnly++;
                            assert(item.diagnostics.includes(`missing_tutorial_text:${platform}:${id}`));
                        }
                    }
                }
            }
            if (item.images.some(a => a.kind === 'PC' && item.images.some(b => a.name === b.name && b.kind === 'Mobile'))) sharedPlatformImage++;
            assert.equal(item.show, !item.diagnostics?.includes('unavailable_tutorial_source')
                && (item.sections.some(s => Object.hasOwn(platforms, s.kind) && Boolean(s.text)) || item.images.length > 0));
            if (!item.name) assert(item.diagnostics.some(d => d.startsWith('missing_name:')));
        }
    }
    assert.deepEqual(excluded, [2419, 2420, 2430, 2556, 2557, 2659, 2660, 2661]);
    assert(missing > 0 && imageOnly > 0 && sharedPlatformImage > 0);
    assert(chs['tutorial-1771']); // Title comes from PushTips, NOT assumed detailId arithmetic.
    assert(chs['tutorial-1451']); // Old UGC creator event is not Miliastra.
});

test('titleless tutorials stay visible; activity titles are resolved without inventing names', () => {
    for (const [data, missingNames, bodyCount] of [[chs, 399, 212], [en, 439, 220]]) {
        const titleless = Object.values(data).filter(item => item.type === 'tutorial' && item.name === '');
        assert.equal(titleless.length, missingNames);
        const withBody = titleless.filter(item => item.sections.some(s => ['PC', 'Mobile', 'PS'].includes(s.kind) && s.text));
        assert.equal(withBody.length, bodyCount);
        for (const item of withBody) {
            assert.equal(item.show, true, item.id);
            assert.equal(item.name, '');
            assert(item.diagnostics.some(d => d.startsWith('missing_name:')));
        }
        const imageOnly = titleless.filter(item => item.images.length && !withBody.includes(item));
        assert.equal(imageOnly.length, data === chs ? 169 : 200);
        assert(imageOnly.every(item => item.show || item.diagnostics.includes('unavailable_tutorial_source')));
        assert.equal(imageOnly.filter(item => !item.show).length, 7);
    }
    assert.equal(chs['profile_picture-99999'].show, false);
});

test('Graeae topics preserve full messages, options and exact graph edges in both languages', () => {
    const rawMessages = read('TpsGlassesChatMessageExcelConfigData'), rawOptions = read('TpsGlassesChatOptionExcelConfigData');
    for (const [language, data] of [['CHS', chs], ['EN', en]]) {
        const topics = Object.values(data).filter(item => item.type === 'graeae_message');
        assert.equal(topics.filter(item => item.show).length, 24);
        assert.equal(topics.flatMap(item => item.message_thread.nodes).length, rawMessages.length + rawOptions.length);
        for (const item of topics) {
            const nodes = new Map(item.message_thread.nodes.map(node => [node.id, node]));
            for (const node of nodes.values()) {
                assert(node.next.every(id => nodes.has(id)));
                if (node.requires) assert.equal(nodes.get(node.requires)?.kind, 'OPTION');
                const raw = node.kind === 'OPTION' ? rawOptions.find(row => `option-${row.HANOBLDBAPA}` === node.id)
                    : rawMessages.find(row => `message-${row.AEFJCKAJMFL}` === node.id);
                assert.equal(String(raw.HAOFOHIJENC), item.source.id);
                assert.equal(node.text, text(language, raw.GEJENCICCEC ?? raw.KLDJCKFKAKI));
                const targets = raw.LICNBELGBCN ? [...rawMessages.filter(row => row.HAOFOHIJENC === raw.HAOFOHIJENC && row.JJGAICEDLNP === raw.LICNBELGBCN).map(row => `message-${row.AEFJCKAJMFL}`),
                    ...rawOptions.filter(row => row.HAOFOHIJENC === raw.HAOFOHIJENC && row.BHLEPODADCG === raw.LICNBELGBCN).map(row => `option-${row.HANOBLDBAPA}`)] : [];
                assert.deepEqual(node.next, targets);
            }
        }
        assert(data['graeae_message-3'].message_thread.nodes[0].text.length > data['graeae_message-3'].message_thread.nodes[0].preview.length, 'never substitute preview for full text');
        assert.equal(data['tutorial-1167'].name, text(language, read('NewActivityPushTipsConfigData').find(row => row.tutorialId === 1167).titleTextMapHash));
        for (const item of Object.values(data).filter(item => item.type === 'tutorial')) assert(['CODEX_ELEMENT','CODEX_ENEMY','CODEX_SYSTEM','CODEX_ADVENTURE','TUTORIAL_ACTIVITY','TUTORIAL_OTHER'].includes(item.tutorial_category));
        assert.equal(data['tutorial-1000'].tutorial_category, 'TUTORIAL_OTHER');
        assert.equal(data['tutorial-303'].tutorial_category, 'CODEX_ELEMENT');
        assert.equal(data['tutorial-1711'].tutorial_category, 'TUTORIAL_ACTIVITY');
    }
});

test('achievement collections retain default ID zero, source ordering and exact bidirectional membership; no mail templates', () => {
    const goals = [...read('AchievementGoalExcelConfigData')].sort((a, b) => a.orderId - b.orderId);
    for (const [language, data] of [['CHS', chs], ['EN', en]]) {
        const groups = Object.values(data).filter(item => item.type === 'achievement_group');
        assert.deepEqual(groups.map(item => item.id), goals.map(goal => `achievement_group-${goal.id ?? 0}`));
        for (const group of groups) {
            const raw = goals.find(goal => (goal.id ?? 0) === Number(group.source.id));
            assert.equal(group.name, text(language, raw.nameTextMapHash));
            assert.equal(group.description, '');
            const expected = read('AchievementExcelConfigData').filter(row => (row.goalId ?? 0) === Number(group.source.id) && data[`achievement-${row.id}`])
                .sort((a, b) => (a.orderId ?? 0) - (b.orderId ?? 0) || a.id - b.id).map(row => `achievement-${row.id}`);
            assert.deepEqual(group.relations.map(relation => relation.id), expected);
            for (const relation of group.relations) assert(data[relation.id].relations.some(back => back.category === 'misc' && back.role === 'group' && back.id === group.id));
        }
        assert(data['achievement_group-0']);
        assert(!Object.keys(data).some(id => id.startsWith('mail_template-')));
    }
});

test('ordinary and Medium TextMaps merge exactly; resolved Medium-only prose is version-tracked', () => {
    const root = require('../../config.json').GenshinData_folder;
    for (const language of ['CHS', 'EN']) {
        const ordinary = JSON.parse(fs.readFileSync(path.join(root, `TextMap/TextMap${language}.json`), 'utf8'));
        const medium = JSON.parse(fs.readFileSync(path.join(root, `TextMap/TextMap_Medium${language}.json`), 'utf8'));
        const data = language === 'CHS' ? chs : en;
        let used = 0;
        for (const item of Object.values(data)) for (const hash of item.source.hashes) {
            if (!medium[hash]) continue;
            assert.equal(text(language, hash), medium[hash]);
            assert(tracking.collectHashes(item).has(hash));
            if (!ordinary[hash]) used++;
        }
        assert(used > 0, `${language}: must exercise Medium-only text`);
    }
});

test('reward/progress/cost numerics never leak anywhere in a record', () => {
    const forbidden = /^(?:reward.*|progress|costs?|count|itemCount|expireDays|weight|minLevel|posX|posY|orderId|watcherIdList|unlockParam|priority)$/i;
    const visit = value => {
        if (!value || typeof value !== 'object') return;
        for (const [key, child] of Object.entries(value)) {
            assert(!forbidden.test(key), key);
            visit(child);
        }
    };
    visit(chs); visit(en);
});

test('missing translations, broken source FKs and unnamed image-only rows stay explicit', () => {
    const tables = {
        ProfilePictureExcelConfigData: [{ id: 1, nameTextMapHash: 10, unlockDescTextMapHash: 11,
            NLAPNBMECDF: 'PROFILE_PICTURE_UNLOCK_BY_COSTUME', unlockParam: 200501, iconPath: 'Portrait' }],
        TutorialExcelConfigData: [{ id: 5, detailIdList: [77], mobileDetailIdList: [88], joypadDetailIdList: [99] }],
        TutorialDetailExcelConfigData: [{ id: 77, descriptTextMapHash: 12, imageNameList: ['ImageOnly'] },
            { id: 99, descriptTextMapHash: 13, imageNameList: ['PSImage'] }],
        PushTipsConfigData: [{ tutorialId: 5, pushTipsId: 90, titleTextMapHash: 14 }],
    };
    const fixture = { excel: table => tables[table] || [], text: (language, hash) => ({ 13: '#raw {LAYOUT_PS#原文}\\n背景', 14: 'Title' }[hash] || '') };
    const result = build('CHS', fixture), tutorial = result['tutorial-5'];
    assert.equal(result['profile_picture-1'].name, '');
    assert.equal(result['profile_picture-1'].show, false);
    assert(result['profile_picture-1'].diagnostics.includes('missing_relation:AvatarCostumeExcelConfigData:200501'));
    assert.equal(tutorial.sections.find(s => s.kind === 'PC').text, '');
    assert.equal(tutorial.sections.find(s => s.kind === 'Mobile').text, '');
    assert.equal(tutorial.sections.find(s => s.kind === 'PS').text, '#raw {LAYOUT_PS#原文}\\n背景');
    assert(tutorial.images.some(img => img.name === 'ImageOnly' && img.kind === 'PC'));
    assert(tutorial.images.some(img => img.name === 'PSImage' && img.kind === 'PS'));
    assert(tutorial.source.hashes.includes('12'));
    assert(tutorial.diagnostics.includes('missing_text:CHS:PC:12'));
    assert(tutorial.diagnostics.includes('missing_tutorial_detail:Mobile:88'));
});

test('titleless image-only tutorials are visible, while empty rows alone stay hidden', () => {
    const tables = {
        TutorialExcelConfigData: [{ id: 1, detailIdList: [11] }, { id: 2, detailIdList: [22] }],
        TutorialDetailExcelConfigData: [{ id: 11, descriptTextMapHash: 100, imageNameList: ['TextlessImage'] }],
    };
    const fixture = { excel: table => tables[table] || [], text: () => '' };
    const result = build('CHS', fixture);
    assert.equal(result['tutorial-1'].name, '');
    assert.equal(result['tutorial-1'].show, true);
    assert.equal(result['tutorial-1'].description, '');
    assert(result['tutorial-1'].images.some(image => image.name === 'TextlessImage' && image.kind === 'PC'));
    assert(result['tutorial-1'].diagnostics.includes('missing_name:CHS'));
    assert.equal(result['tutorial-2'].show, false);
    assert(result['tutorial-2'].diagnostics.includes('missing_tutorial_detail:PC:22'));
});
