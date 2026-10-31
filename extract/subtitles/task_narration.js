const fs = require('node:fs');
const path = require('node:path');
const { get_task_lua_placements } = require('./task_lua');
const project = path.resolve(__dirname, '../..');
const config = require('../../config.json');
const source_path = config.GenshinData_folder;
const language_codes = {
    zh_hans: 'CHS', zh_hant: 'CHT', en: 'EN', de: 'DE', es: 'ES', fr: 'FR',
    id: 'ID', it: 'IT', ja: 'JP', ko: 'KR', pt: 'PT', ru: 'RU', th: 'TH', tr: 'TR', vi: 'VI',
};
let placements;
const text_maps = new Map();
const groups = new Map();
const dialogs = new Map();
const wanted_dialogs = new Set();
let dialog_index_loaded = false;
let npc_names;
const reported = new Set();
let reminders;
const chains = new Map();
function get_reminders() {
    return reminders ??= json('ExcelBinOutput/ReminderExcelConfigData.json');
}
function warn(message) {
    if (!reported.has(message)) {
        reported.add(message);
        console.warn(`narration: ${message}`);
    }
}
function json(file) {
    return JSON.parse(fs.readFileSync(path.join(source_path, file), 'utf8'));
}
function files(folder) {
    if (!fs.existsSync(folder))
        return [];
    return fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(folder, entry.name);
        return entry.isDirectory() ? files(file) : [file];
    }).sort();
}
function get_placements() {
    if (placements)
        return placements;
    placements = get_task_lua_placements('narration');
    for (const entries of placements.values()) {
        for (const { call } of entries) {
            const argument = call.args[call.method === 'NpcNarratorOnlyTaskByData'
                || call.method === 'WarningNarratorTask' ? 1 : 0];
            const list = argument?.dialogList || argument;
            if (list && typeof list === 'object' && !list.reference && !list.narratorId) {
                for (const [key, value] of Object.entries(list)) {
                    if (!/^\d+$/.test(key))
                        continue;
                    const id = typeof value === 'number' ? value : value?.dialogID;
                    if (Number.isInteger(id))
                        wanted_dialogs.add(id);
                }
            }
        }
    }
    return placements;
}
function text_map(lang) {
    let map = text_maps.get(lang);
    if (!map) {
        for (const language of text_maps.keys())
            if (language !== 'zh_hans')
                text_maps.delete(language);
        map = {};
        const code = language_codes[lang];
        const names = fs.readdirSync(path.join(source_path, 'TextMap')).filter(name => new RegExp(`^TextMap(?:_Medium)?${code}(?:_\\d+)?\\.json$`).test(name)).sort();
        for (const name of names)
            Object.assign(map, json(`TextMap/${name}`));
        map = require('../../versions/tracking').languageProxy(map);
        text_maps.set(lang, map);
    }
    return map;
}
function dialog_list(data) {
    if (Array.isArray(data))
        return data;
    return Object.values(data).find(value => Array.isArray(value)
        && value.some(dialog => dialog && typeof dialog.id === 'number')) || [];
}
function narrator_group(id) {
    if (groups.has(id))
        return groups.get(id);
    for (const folder of ['FreeGroup', 'Quest']) {
        const file = `BinOutput/Talk/${folder}/${id}.json`;
        if (!fs.existsSync(path.join(source_path, file)))
            continue;
        const data = json(file);
        if (data.type !== 'NARRATOR')
            continue;
        const list = dialog_list(data);
        groups.set(id, list);
        return list;
    }
    groups.set(id, []);
    warn(`NARRATOR group ${id} not found`);
    return [];
}
function find_dialog(id) {
    if (!dialog_index_loaded) {
        dialog_index_loaded = true;
        for (const folder of ['FreeGroup', 'Quest']) {
            for (const file of files(path.join(source_path, `BinOutput/Talk/${folder}`))) {
                if (!file.endsWith('.json'))
                    continue;
                for (const dialog of dialog_list(JSON.parse(fs.readFileSync(file, 'utf8')))) {
                    if (wanted_dialogs.has(dialog.id) && !dialogs.has(dialog.id))
                        dialogs.set(dialog.id, dialog);
                }
            }
        }
        for (const file of files(path.join(source_path, 'BinOutput/Talk')).filter(file => /GlobalDialog.*\.json$/i.test(file))) {
            for (const dialog of dialog_list(JSON.parse(fs.readFileSync(file, 'utf8')))) {
                if (wanted_dialogs.has(dialog.id))
                    dialogs.set(dialog.id, dialog);
            }
        }
    }
    return dialogs.get(id);
}
function read_chain(call) {
    const argument = call.args[call.method === 'NpcNarratorOnlyTaskByData' || call.method === 'WarningNarratorTask' ? 1 : 0];
    if (/^(ShowReminder|SayReminder)$/.test(call.method)) {
        const by_id = new Map(get_reminders().map(item => [item.id, item]));
        const seen = new Set(), result = [];
        let current = by_id.get(argument);
        while (current && !seen.has(current.id)) {
            seen.add(current.id);
            result.push({ dialog: { ...current, reminder: true }, duration: current.showTime });
            current = by_id.get(current.nextReminderId);
        }
        return result;
    }
    if (argument?.narratorId)
        return narrator_group(argument.narratorId).map(dialog => ({ dialog }));
    const list = argument?.dialogList || argument;
    if (!list || typeof list !== 'object' || list.reference) {
        warn(`${call.id}: unresolved ${call.method} argument; client config may be missing`);
        return [];
    }
    const chain = Object.entries(list).filter(([key]) => /^\d+$/.test(key))
        .sort(([left], [right]) => Number(left) - Number(right))
        .map(([, value]) => {
        const id = typeof value === 'number' ? value : value?.dialogID;
        const dialog = Number.isInteger(id) ? find_dialog(id) : undefined;
        if (!dialog) {
            warn(`${call.id}: dialog ${id} not found`);
            return undefined;
        }
        return { dialog, duration: value?.duration };
    });
    return chain.some(item => !item) ? [] : chain;
}
function get_chain(call) {
    let chain = chains.get(call.id);
    if (!chain) {
        chain = read_chain(call);
        chains.set(call.id, chain);
    }
    return chain;
}
const content_keys = new Set();
let speaker_title_key;
let reminder_content_key;
let reminder_speaker_key;
function find_text_key(sample, text) {
    return sample && Object.keys(sample).find(key => text_map('zh_hans')[sample[key]] === text);
}
function detect_text_keys() {
    if (content_keys.size)
        return;
    const narrator = narrator_group(7620203).find(item => item.id === 762029906);
    const talk = dialog_list(json('BinOutput/Talk/Quest/303401.json')).find(item => item.id === 30340101);
    for (const key of [find_text_key(narrator, '…茶还是温的呢。嗯，真美味。'),
        find_text_key(talk, '#{NICKNAME}、派蒙，好久不见。')])
        if (key)
            content_keys.add(key);
    const title = dialog_list(json('BinOutput/Talk/Quest/7504417.json')).find(item => item.id === 750441701);
    speaker_title_key = find_text_key(title, '依稀可以辨认的布告');
    const reminder = get_reminders().find(item => item.id === 1004360000);
    reminder_content_key = find_text_key(reminder, '快看！前面好像出现了一座岛？');
    reminder_speaker_key = find_text_key(reminder, '派蒙');
}
// A valid text record may omit its original role: bubble attachment comes from the API's NPC.
function has_dialog_content_field(raw) {
    detect_text_keys();
    return ['talkContentTextMapHash', ...content_keys].some(key => Number.isSafeInteger(raw[key]) && raw[key] > 0);
}
function get_dialog(raw, lang) {
    const chinese = text_map('zh_hans'), localized = text_map(lang);
    detect_text_keys();
    const hashes = Object.entries(raw).filter(([key, value]) => key !== 'id' && typeof value === 'number' && chinese[String(value)]);
    const speaker = Object.values(raw).find((value) => value?.type?.startsWith('TALK_ROLE_'));
    // Fixed texts and IDs identify fields, not version-specific hashes or obfuscated keys.
    const key = raw.reminder ? reminder_content_key : raw.talkContentTextMapHash
        ? 'talkContentTextMapHash' : [...content_keys].find(key => raw[key]);
    const content_hash = key && raw[key] || (hashes.length === 1 ? hashes[0][1] : undefined);
    if (!content_hash) {
        warn(`dialog ${raw.id}: ambiguous content field`);
        return;
    }
    const content = localized[String(content_hash)]?.replace(/\\n/g, '\n');
    if (!content) {
        warn(`dialog ${raw.id}: missing ${lang} text`);
        return;
    }
    if (!npc_names)
        npc_names = new Map(json('ExcelBinOutput/NpcExcelConfigData.json').map(npc => [npc.id, npc.nameTextMapHash]));
    const name_hash = speaker && npc_names.get(Number(speaker.id));
    const name = raw.reminder ? localized[String(raw[reminder_speaker_key])]
        : localized[String(raw[speaker_title_key])] || localized[String(name_hash)]
            || (speaker?.type === 'TALK_ROLE_PLAYER' ? '#{NICKNAME}' : undefined);
    return { content, role: speaker?.type === 'TALK_ROLE_BLACK_SCREEN' ? 'black_screen' : name ? 'npc' : 'text',
        ...(name ? { speaker: name } : {}), next_dialogs: [] };
}
function get_task_narrations(quest, steps, lang) {
    const result = {};
    for (const entry of get_placements().get(quest) || []) {
        const step = steps.get(entry.step);
        if (!step) {
            warn(`Quest ${quest}: step ${entry.step} not exported`);
            continue;
        }
        const chain = get_chain(entry.call);
        if (!chain.length)
            continue;
        const converted = chain.map(item => get_dialog(item.dialog, lang));
        if (converted.some(dialog => !dialog))
            continue;
        const conditions = [];
        const guards = new Map(entry.call.guards.map(guard => [guard.id, guard]));
        for (const guard of guards.values()) {
            conditions.push({ type: 'boolean', id: guard.id, title: 'Lua', subtitle: guard.description, value: guard.value });
            if (conditions.length > 1)
                conditions.push('and');
        }
        const key = `${entry.event}:${step}:${entry.call.id}`;
        result[key] = {
            type: 'narration', step, event: entry.event, source: entry.call.id, conditions,
            ...(entry.call.delay ? { delay: entry.call.delay } : {}),
            ...(entry.call.after ? { after: `${entry.event}:${step}:${entry.call.after}` } : {}),
            dialogs: Object.fromEntries(converted.map((dialog, index) => [index + 1, {
                    ...dialog, next_dialogs: index + 1 < converted.length ? [{ dialog: index + 2 }] : [],
                    ...(chain[index].duration ? { duration: chain[index].duration } : {}),
                }])),
        };
    }
    return result;
}

module.exports = { text_map, has_dialog_content_field, get_dialog, get_task_narrations };
