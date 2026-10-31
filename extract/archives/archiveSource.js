const fs = require('node:fs');
const path = require('node:path');
require('../global');
const { getTalkKeys, makeDialog } = require('../dialogue');
const tracking = require('../../versions/tracking');

const source = path.resolve(config.GenshinData_folder);
const cache = new Map();
const languages = { zh_hans: 'CHS', en: 'EN' };

function read(relative) {
    const target = path.resolve(source, relative);
    if (!target.startsWith(source + path.sep)) throw new Error(`Invalid source path: ${relative}`);
    if (!cache.has(target)) {
        cache.set(target, JSON.parse(fs.readFileSync(target, 'utf8'), (key, value, context) =>
            typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)
                && context?.source && /^-?\d+$/.test(context.source) ? context.source : value));
    }
    return cache.get(target);
}

function source_excel(name) { return read(`ExcelBinOutput/${name.replace(/\.json$/, '')}.json`); }
function source_bin(relative) {
    const file = `BinOutput/${relative.replace(/^BinOutput[\\/]/, '')}`;
    try { return read(file); }
    catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
}
function textmap(lang) {
    if (!languages[lang]) throw new Error(`Archive language not configured: ${lang}`);
    return getLanguage(languages[lang]);
}
function source_text(lang, hash) { return hash == null ? '' : textmap(lang)[String(hash)] || ''; }

function make_archive_item(table, id, type, name, description, hashes = []) {
    return { name, type, description, sections: [], images: [], relations: [], talks: {}, entry_talks: [],
        source: { table, id: String(id), hashes: [...new Set(hashes.filter(hash => hash != null).map(String))] } };
}
function archive_image(reference, category, id, kind = 'image') {
    // Extraction exports resource references, never paths into a particular Wiki checkout.
    return reference ? { name: String(reference), kind } : null;
}
function archive_export(files) {
    for (const { data } of files) {
        const hashes = data.source.hashes.filter(hash => /^\d+$/.test(hash) && Number(hash) <= 0xFFFFFFFF);
        const references = data.source.hashes.filter(hash => !hashes.includes(hash));
        if (references.length) data.source.references = [...new Set([...(data.source.references || []), ...references])];
        data.source.hashes = hashes;
    }
    return { files, list: files.map(({ id, data }) => ({ id, name: data.name, type: data.type, show: true })) };
}
function archive_external_relation(category, id, lang, role) {
    if (!id) return null;
    const tables = { character: 'AvatarExcelConfigData', npc: 'NpcExcelConfigData', task: 'MainQuestExcelConfigData',
        quest_item: 'MaterialExcelConfigData', book: 'MaterialExcelConfigData' };
    const row = source_excel(tables[category]).find(row => row.id === id);
    // Store the explicit source identity even if the Wiki has no matching page.
    // Page existence, aliases and public URLs are resolved by the consumer.
    return { category, id: String(id), source_id: id, name: source_text(lang, row?.nameTextMapHash), role };
}

let talk_index;
function get_talk_index() {
    return talk_index ||= new Map([0, 1].flatMap(part => source_excel(`TalkExcelConfigData_${part}`)).map(talk => [talk.id, talk]));
}
function metadata(talk) {
    const values = Object.values(talk);
    return { ...talk,
        initDialog: talk.initDialog || values.find(value => typeof value === 'number' && String(value).startsWith(String(talk.id)) && value !== talk.id),
        performCfg: talk.performCfg || values.find(value => typeof value === 'string' && value.startsWith('QuestDialogue/')) || '',
        nextTalks: talk.nextTalks || values.find(value => Array.isArray(value) && value.length && value.every(id => typeof id === 'number' && id > 100000)) || [],
        beginCond: talk.beginCond || values.find(value => Array.isArray(value) && value.some(item => item?.type?.startsWith('QUEST_COND_'))) || [],
        beginCondComb: talk.beginCondComb || values.find(value => typeof value === 'string' && value.startsWith('LOGIC_')) || 'LOGIC_AND',
        beginWay: talk.beginWay || values.find(value => typeof value === 'string' && value.startsWith('TALK_BEGIN_')),
    };
}

function archive_dialogue(ids, lang, npc_ids = []) {
    const index = new Map(get_talk_index()), diagnostics = [], group_ids = [];
    for (const npc of npc_ids) {
        const group = source_bin(`Talk/NpcGroup/${npc}.json`);
        const entries = group && Object.values(group).find(value => Array.isArray(value) && value.some(talk => talk?.id));
        for (const talk of entries || []) { index.set(talk.id, metadata({ ...index.get(talk.id), ...talk })); group_ids.push(talk.id); }
    }
    const namespace = ids.map(id => metadata(index.get(id) || {}).performCfg).find(value => /\/(HomeWorld|GCG)\//.test(value))?.match(/\/(HomeWorld|GCG)\//)?.[1];
    const selected = new Map();
    const pending = [...new Set([...ids, ...group_ids.filter(id => !namespace || metadata(index.get(id) || {}).performCfg.includes(`/${namespace}/`))])];
    for (let position = 0; position < pending.length; position++) {
        const id = pending[position];
        if (selected.has(id)) continue;
        const meta = metadata(index.get(id) || { id });
        if (/^TEST\//i.test(meta.performCfg)) { diagnostics.push(`test_talk:${id}`); continue; }
        let body;
        for (const folder of ['Npc', 'Quest', 'Activity', 'Gadget', 'NpcOther', 'Coop', 'Blossom', 'Cutscene', 'Storyboard']) {
            body = source_bin(`Talk/${folder}/${id}.json`);
            if (body) break;
        }
        if (!body) { diagnostics.push(`missing_talk:${id}`); continue; }
        selected.set(id, { meta, body });
        for (const next of meta.nextTalks) if (!pending.includes(next)) pending.push(next);
    }
    const keys = new Map([...selected.keys()].map((id, index) => [id, index + 1]));
    const incoming = new Set(), menu_options = new Set([...selected.values()].flatMap(({ meta }) => meta.nextTalks));
    const fields = getTalkKeys();
    const talks = Object.fromEntries([...selected].map(([id, { meta, body }]) => {
        const text_hashes = new Set();
        const dialogs = (body[fields.dialogList] || []).map(dialog => {
            const result = makeDialog(textmap(lang), dialog);
            result.content = source_text(lang, dialog[fields.content]);
            for (const key of [fields.content, fields.speakerTitle, fields.subtitle]) {
                if (source_text(lang, dialog[key])) text_hashes.add(String(dialog[key]));
            }
            if (result.roleType === 'TALK_ROLE_GADGET') result.roleType = 'TALK_ROLE_NPC';
            return result;
        });
        const next_talks = meta.nextTalks.flatMap(next => {
            const key = keys.get(next);
            if (key === undefined) { diagnostics.push(`missing_next_talk:${id}:${next}`); return []; }
            incoming.add(next); return [key];
        });
        const conditions = { logic: meta.beginCondComb, conditions: meta.beginCond.filter(condition => condition.type)
            .map(condition => ({ type: condition.type, params: condition.param || [] })) };
        const labels = [];
        for (const condition of conditions.conditions) {
            let title = '', subtitle = '';
            if (condition.type === 'QUEST_COND_HOMEWORLD_NPC_EVENT') {
                const event = source_excel('HomeWorldEventExcelConfigData').find(row => row.eventID === Number(condition.params[0]));
                const avatar = event && source_excel('AvatarExcelConfigData').find(row => row.id === event.avatarID);
                const suite = event && source_excel('FurnitureSuiteExcelConfigData').find(row => row.suiteID === event.furnitureSuitID);
                title = [source_text(lang, avatar?.nameTextMapHash), source_text(lang, suite?.suiteNameTextMapHash)].filter(Boolean).join(' · ');
                subtitle = event?.eventType === 'HOME_AVATAR_REWARD_EVENT' ? lang === 'zh_hans' ? '赠礼事件' : 'Gift event'
                    : event?.eventType === 'HOME_AVATAR_SUMMON_EVENT' ? lang === 'zh_hans' ? '邀请事件' : 'Invitation event'
                        : lang === 'zh_hans' ? '角色套装事件' : 'Companion furnishing set event';
            } else if (condition.type === 'QUEST_COND_HOMEWORLD_NPC_NEW_TALK') {
                title = dialogs[0]?.content || '';
                subtitle = lang === 'zh_hans' ? '新话题状态' : 'New topic state';
            }
            if (title) labels.push({ condition, title, subtitle });
        }
        const talk = {
            source_id: id, title: dialogs.find(dialog => dialog.id === meta.initDialog)?.content || dialogs[0]?.content || '',
            priority: meta.priority || 0,
            begin_way: meta.beginWay === 'TALK_BEGIN_MANUAL' ? 'manual' : meta.beginWay === 'TALK_BEGIN_AUTO' ? 'auto' : null,
            next_talks, trigger_ids: [], trigger_points: [], objects: [],
            source_dialogue: { dialogs, initial_dialog: meta.initDialog, perform_cfg: meta.performCfg,
                menu_option: menu_options.has(id), conditions, labels },
            // Temporary names for the source catalogue's host-name derivation. The
            // collator removes these summaries before publishing the raw dialogue.
            dialogs: Object.fromEntries(dialogs.map((dialog, index) => [index + 1, {
                content: dialog.content, speaker: dialog.speakerTitle || dialog.speakerName,
            }])),
        };
        tracking.attach(talk, text_hashes);
        return [String(keys.get(id)), talk];
    }));
    let entry_talks = [...selected.keys()].filter(id => !incoming.has(id)).map(id => keys.get(id));
    if (!entry_talks.length && keys.size) entry_talks = [1];
    return { talks, entry_talks, diagnostics: [...new Set(diagnostics)] };
}

function collate(category, language) {
    const lang = Object.keys(languages).find(lang => languages[lang] === language);
    if (!lang) throw new Error(`Unsupported archive language: ${language}`);
    const result = require(`./${category}`)[`get_${category}_export`](lang);
    const pages = new Map(result.list.map(page => [page.id, page]));
    return Object.fromEntries(result.files.map(({ id, data }, order) => {
        for (const talk of Object.values(data.talks)) if (talk.source_dialogue) delete talk.dialogs;
        const value = { id, order, show: pages.get(id).show, ...data };
        tracking.attach(value, new Set(data.source.hashes.filter(hash => source_text(lang, hash))));
        return [id, value];
    }));
}

module.exports = { source_excel, source_bin, source_text, make_archive_item, archive_image,
    archive_export, archive_external_relation, archive_dialogue, collate };
