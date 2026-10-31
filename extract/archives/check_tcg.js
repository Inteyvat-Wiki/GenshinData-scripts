// Raw-source assertions live with extraction, not with Wiki page generation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { get_tcg_export } = require('./tcg');
const { source_excel, source_text } = require('./archiveSource');
const { source_bin } = require('./archiveSource');
const excel = (name) => source_excel(`${name}ExcelConfigData`);
const results = new Map();
const counts = { card: 629, card_back: 40, card_table: 7, stage: 1411 };
const narrative_ids = new Set(excel('GCGGameReward').map(row => row.levelId));
const details = new Map(excel('GCGTalkDetail').map(row => [row.talkDetailId, row]));
const languages = ['zh_hans', 'en'];
const { getTalkKeys } = require('../dialogue.js');
const dialogue_fields = getTalkKeys();
const visible_roles = new Set(['TALK_ROLE_NPC', 'TALK_ROLE_MATE_AVATAR', 'TALK_ROLE_PLAYER', 'TALK_ROLE_NONE',
    'TALK_ROLE_BLACK_SCREEN', 'TALK_ROLE_NEED_CLICK_BLACK_SCREEN',
    'TALK_ROLE_CONSEQUENT_BLACK_SCREEN', 'TALK_ROLE_CONSEQUENT_NEED_CLICK_BLACK_SCREEN']);
const existing_npc_talks = new Set();
const npcDirectory = path.join(require('../../config.json').genshin_output_folder, 'ChineseSimplified/npcs');
if (fs.existsSync(npcDirectory))
    for (const filename of fs.readdirSync(npcDirectory)) {
        const npc = JSON.parse(fs.readFileSync(path.join(npcDirectory, filename), 'utf8'));
        for (const talk of npc.talks)
            existing_npc_talks.add(talk.id);
    }
function raw_dialogs(talk_ids) {
    const result = new Set();
    for (const id of talk_ids) {
        const body = source_bin(`Talk/Npc/${id}.json`) || source_bin(`Talk/Quest/${id}.json`)
            || source_bin(`Talk/Activity/${id}.json`);
        for (const dialog of body?.[dialogue_fields.dialogList] || []) {
            // Count source Dialog IDs, never local renumbered keys or repeated page copies.
            const speaker = dialog[dialogue_fields.speaker] || {};
            const source_id = dialog[dialogue_fields.dialogId];
            if (typeof source_id === 'number' && visible_roles.has(speaker.type || speaker._type))
                result.add(source_id);
        }
    }
    return result;
}
{
    for (const lang of languages) {
        const result = get_tcg_export(lang);
        results.set(lang, result);
        const files = new Map(result.files.map(file => [file.id, file.data]));
        assert.equal(files.size, result.files.length);
        assert.deepEqual(result.list.map(page => page.id), result.files.map(file => file.id));
        for (const [type, count] of Object.entries(counts)) {
            assert.equal(result.files.filter(file => file.data.type === type).length, count, `${lang}:${type}`);
        }
        for (const row of excel('GCGDeckCard')) {
            const item = files.get(`card-${row.id}`);
            (0, assert)(item);
            const card = [...excel('GCGCard'), ...excel('GCGChar')].find(card => card.id === row.id);
            assert.equal(item.card_type.id, card.cardType);
            const suffix = { GCG_CARD_CHARACTER: 'CHAR', GCG_CARD_MODIFY: 'EQUIP', GCG_CARD_EVENT: 'EVENT', GCG_CARD_ASSIST: 'SUPPORT' }[card.cardType];
            const label = source_excel('ManualTextMapConfigData').find(label => label.textMapId === `UI_GCG_CARD_TYPE_${suffix}`);
            assert.equal(item.card_type.name, source_text(lang, label.textMapContentTextMapHash));
            assert.deepEqual(item.tags.map(tag => tag.id), [...new Set(card.tagList)].filter(id => id !== 'GCG_TAG_NONE'));
            for (const tag of item.tags) {
                const raw = excel('GCGTag').find(raw => raw.type === tag.id);
                assert.equal(tag.name, source_text(lang, raw.nameTextMapHash));
                assert.equal(!!tag.hidden, !!raw.isHidden);
                assert.equal(tag.order, excel('GCGTag').findIndex(raw => raw.type === tag.id));
            }
            assert.equal(item.description, source_text(lang, row.storyDescTextMapHash));
            assert.deepEqual(item.sections, [{ kind: 'story', title: source_text(lang, row.storyTitleTextMapHash), text: item.description }]);
            assert.equal(item.images.filter(image => image.kind?.startsWith('card_face:')).length, row.faceIdList.length);
            (0, assert)(!('skills' in item));
        }
        for (const row of excel('GCGWorldLevel')) {
            const item = files.get(`player-${row.npcId}`);
            (0, assert)(item, `missing player ${row.npcId}`);
            const work = source_excel('GcgWorldWorkTimeExcelConfigData').find(time => time.id === row.npcId);
            const expected = work ? source_text(lang, row.levelDecTextMapHash).replace('{0}', '06:00').replace('{1}', '19:00')
                : source_text(lang, row.levelDecTextMapHash);
            (0, assert)(item.sections.some(section => section.kind === `biography:${row.id}`
                && section.text === expected));
        }
        for (const row of excel('GCGCharacterLevel')) {
            const item = files.get(`player-${row.npcId}`);
            for (const field of ['normalWinTalk', 'normalLossTalk', 'hardWinTalk', 'hardLossTalk']) {
                (0, assert)(Object.values(item.talks).some(talk => talk.source_id === row[field]), `${lang}:${row.npcId}:${field}`);
            }
        }
        for (const row of excel('GCGGameReward')) {
            const stage = files.get(`stage-${row.levelId}`);
            const portrait = excel('GCGTalkDetailIcon').find(icon => icon.id === row.oppoAvatarPicId);
            if (portrait?.FLNKMCFIMKJ) assert(stage.images.some(image => image.kind === 'opponent' && image.name === portrait.FLNKMCFIMKJ));
            assert.equal(stage.name, source_text(lang, row.levelNameTextMapHash));
            assert.equal(stage.description, source_text(lang, row.levelDecTextMapHash));
            (0, assert)(!('ruleDec' in stage));
            (0, assert)(!('rewardDec' in stage));
        }
        const emitted_details = new Set();
        const shared_talks = new Set();
        let slots = 0, pictures = 0;
        const diagnostics = {};
        for (const { id, data } of result.files) {
            (0, assert)(/^[a-zA-Z0-9_-]+$/.test(id));
            for (const relation of data.relations) {
                if (relation.category === 'tcg')
                    (0, assert)(files.has(relation.id), `dangling relation ${id}:${relation.id}`);
            }
            for (const key of data.entry_talks)
                (0, assert)(data.talks[key], `dangling entry ${id}:${key}`);
            for (const talk of Object.values(data.talks)) {
                for (const key of talk.next_talks)
                    (0, assert)(data.talks[key], `dangling talk ${id}:${key}`);
                for (const next of talk.initial_dialogs || [])
                    (0, assert)(talk.dialogs[next.dialog]);
                const battle = talk.trigger_ids.some(trigger => trigger.startsWith('GCGTalk:'));
                if (!battle) {
                    shared_talks.add(talk.source_id);
                    assert.equal(Object.keys(talk.dialogs).length, raw_dialogs(new Set([talk.source_id])).size, `source Dialog accounting disagrees with emitted dialogs: ${talk.source_id}`);
                }
                for (const dialog of Object.values(talk.source_dialogue ? {} : talk.dialogs)) {
                    for (const next of dialog.next_dialogs)
                        (0, assert)(talk.dialogs[next.dialog]);
                    if (battle)
                        (0, assert)(dialog.speaker, `missing battle speaker ${id}:${talk.source_id}`);
                }
                if (!battle)
                    continue;
                (0, assert)(![1, 2, 3, 4].includes(talk.source_id), 'test prototype entered real dialogue');
                emitted_details.add(talk.source_id);
                const detail = details.get(talk.source_id);
                const active_slots = detail.talkContent.map((hash, slot) => ({ hash, slot }))
                    .filter(({ hash, slot }) => detail.talkCharacterId[slot]
                    || detail.talkVoiceId[slot] || languages.some(lang => source_text(lang, hash)));
                assert.equal(Object.keys(talk.dialogs).length, active_slots.length);
                active_slots.forEach(({ hash, slot }, index) => {
                    const dialog = talk.dialogs[String(index + 1)];
                    assert.equal(dialog.content, source_text(lang, hash));
                    (0, assert)(data.source.references?.some(value => value.startsWith(`GCGTalkDetail:${talk.source_id}:slot:${slot}:actor:${detail.talkCharacterId[slot]}:`)));
                });
                if (data.type === 'stage')
                    slots += active_slots.length;
            }
            for (const image of data.images) {
                (0, assert)(image.name);
                assert(!('url' in image), 'source extraction must not attach Wiki image URLs');
            }
            if (data.type === 'player') {
                const candidates = new Set(result.files.filter(file => file.data.type === 'stage'
                    && file.data.relations.some(relation => relation.category === 'tcg' && relation.id === id && relation.role === 'player'))
                    .flatMap(file => file.data.images.filter(image => image.kind === 'opponent').map(image => image.name)));
                assert(data.images.every(image => image.kind === 'player'), 'no invite/week image references on players');
                assert.deepEqual(data.images.map(image => image.name), candidates.size === 1 ? [...candidates] : []);
            }
            for (const message of data.diagnostics || []) {
                const kind = message.split(':')[0];
                diagnostics[kind] = (diagnostics[kind] || 0) + 1;
            }
            (0, assert)(data.source.hashes.every(hash => /^\d+$/.test(hash)), `non-TextMap provenance in hashes: ${id}`);
        }
        const referenced = new Set(excel('GCGTalk').filter(row => narrative_ids.has(row.gameID))
            .flatMap(row => ['happyTalkId', 'sadTalkId', 'toughTalkId', 'elementBrustTalkId', 'lowHealthTalkId', 'highHealthTalkId']
            .map(field => row[field]).filter(Boolean)));
        assert.deepEqual([...emitted_details].sort((a, b) => a - b), [...referenced].sort((a, b) => a - b));
        const biography_count = result.files.flatMap(file => file.data.sections)
            .filter(section => section.kind?.startsWith('biography:') && section.text).length;
        assert.equal(biography_count, 109);
        const resource = files.get('card-1101').images.find(image => image.kind === 'card_view:cardStaticImageHash');
        (0, assert)(/^\d{17,20}$/.test(resource.name), 'resource hash was not preserved');
        const prince = files.get('stage-20001');
        (0, assert)(Object.values(prince.talks).some(talk => Object.values(talk.dialogs)
            .some(dialog => dialog.speaker === (lang === 'zh_hans' ? '小王子' : 'Prince'))));
        const fischl = files.get('stage-30112');
        const oz = Object.values(fischl.talks).find(talk => talk.source_id === 3011203);
        assert.equal(oz.dialogs['2'].speaker, lang === 'zh_hans' ? '奥兹' : 'Oz');
        assert.equal(diagnostics.unresolved_gcg_speaker || 0, 0);
        const unique_slots = [...emitted_details].reduce((count, id) => {
            const detail = details.get(id);
            return count + detail.talkContent.filter((hash, slot) => detail.talkCharacterId[slot]
                || detail.talkVoiceId[slot] || languages.some(lang => source_text(lang, hash))).length;
        }, 0);
        const unique_dialogs = raw_dialogs(shared_talks);
        const reused_dialogs = raw_dialogs(new Set([...shared_talks].filter(id => existing_npc_talks.has(id))));
        const invite_npcs = new Set(excel('GCGCharacterLevel').map(row => row.npcId));
        const invitation_talks = new Set(result.files.filter(file => invite_npcs.has(Number(file.data.source.id)) && file.data.type === 'player')
            .flatMap(file => Object.values(file.data.talks).filter(talk => !talk.trigger_ids.some(id => id.startsWith('GCGTalk:'))).map(talk => talk.source_id)));
        console.log(JSON.stringify({ lang, files: result.files.length,
            types: Object.fromEntries([...new Set(result.files.map(file => file.data.type))]
                .map(type => [type, result.files.filter(file => file.data.type === type).length])),
            biographies: biography_count, card_faces: result.files.flatMap(file => file.data.images)
                .filter(image => image.kind?.startsWith('card_face:')).length,
            unique_shared_talks: shared_talks.size, unique_battle_details: emitted_details.size,
            unique_source_dialogs: unique_dialogs.size, existing_npc_dialogs: reused_dialogs.size,
            not_in_existing_npc_dialogs: [...unique_dialogs].filter(id => !reused_dialogs.has(id)).length,
            invitation_unique_source_dialogs: raw_dialogs(invitation_talks).size,
            unique_battle_slots: unique_slots, stage_battle_slots: slots,
            backed_image_references: pictures, diagnostics }, null, 2));
    }
    assert.deepEqual(results.get('zh_hans').files.map(file => file.id), results.get('en').files.map(file => file.id));
    for (const { id, data } of results.get('zh_hans').files) {
        const english = results.get('en').files.find(file => file.id === id).data;
        assert.deepEqual(Object.keys(data.talks), Object.keys(english.talks), `language-dependent dialogue keys: ${id}`);
        assert.deepEqual(data.entry_talks, english.entry_talks);
    }
    console.log('TCG bilingual source coverage, stable IDs, graph closure, slot speakers and resource references passed.');
}
