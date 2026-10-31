const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { get_task_lua_placements } = require('./task_lua');
const { has_dialog_content_field, text_map, get_dialog, get_task_narrations } = require('./task_narration');
const { get_bubble_rule, has_conflicting_bubble_text, bubble_delay_fields, bubble_parameter, bubble_call_identity } = require('./lua_bubble_rules');
const project = path.resolve(__dirname, '../..');
const config = require('../../config.json');
const source = config.GenshinData_folder;
let dialogs;
let names;
const reported = new Set();
function warn(message) {
    if (!reported.has(message)) {
        reported.add(message);
        console.warn(`bubble: ${message}`);
    }
}
function json(file) { return JSON.parse(fs.readFileSync(path.join(source, file), 'utf8')); }
function* tables(value) {
    if (value && typeof value === 'object') {
        if (!Array.isArray(value))
            yield value;
        for (const child of Object.values(value))
            yield* tables(child);
    }
}
function* files(folder) {
    if (!fs.existsSync(folder))
        return;
    for (const entry of fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
        const file = path.join(folder, entry.name);
        if (entry.isDirectory())
            yield* files(file);
        else if (file.endsWith('.json'))
            yield file;
    }
}
function get_dialogs() {
    if (dialogs)
        return dialogs;
    dialogs = new Map();
    const wanted = new Set();
    for (const entries of get_task_lua_placements('speech_bubble').values()) {
        for (const { call } of entries) {
            if (get_bubble_rule(call.method)?.text
                && Number.isSafeInteger(call.args[1]) && call.args[1] > 0)
                wanted.add(call.args[1]);
        }
    }
    const add = (id, raw, file) => {
        if (!wanted.has(id))
            return;
        const entries = dialogs.get(id) || [];
        entries.push({ raw, file });
        dialogs.set(id, entries);
    };
    for (const file of files(path.join(source, 'BinOutput/Talk'))) {
        for (const raw of tables(JSON.parse(fs.readFileSync(file, 'utf8')))) {
            if (Number.isSafeInteger(raw.id) && raw.id > 0 && (has_dialog_content_field(raw)
                || Object.values(raw).some((value) => value?.type?.startsWith('TALK_ROLE_'))))
                add(raw.id, raw, path.relative(source, file).replaceAll('\\', '/'));
        }
    }
    const excel_file = 'ExcelBinOutput/DialogExcelConfigData.json';
    const excel = json(excel_file);
    // Calibrate the obfuscated ID field against an explicit, independently inspected dialog ID.
    const sample = excel.find(row => Object.values(row).includes(20179902));
    const keys = sample && Object.keys(sample).filter(key => sample[key] === 20179902);
    if (keys?.length === 1)
        for (const raw of excel)
            add(raw[keys[0]], raw, excel_file);
    else
        warn('cannot identify DialogExcel ID field; only BinOutput text is used');
    return dialogs;
}
function resolve_dialog(id, npc, lang) {
    const convert = (language) => (get_dialogs().get(id) || []).flatMap(candidate => {
        // A missing Excel hash is not repaired by XOR or approximate numeric matching.
        if (candidate.raw.talkContentTextMapHash && !text_map(language)[String(candidate.raw.talkContentTextMapHash)])
            return [];
        const dialog = get_dialog(candidate.raw, language);
        return dialog ? [{ ...candidate, dialog }] : [];
    });
    const reference = convert('zh_hans');
    // A namespace conflict must not disappear merely because one translation is missing.
    if (has_conflicting_bubble_text(reference.map(candidate => candidate.dialog))) {
        warn(`dialog ${id}: conflicting reference-language content sources; skipped`);
        return;
    }
    const converted = lang === 'zh_hans' ? reference : convert(lang);
    if (!converted.length) {
        warn(`dialog ${id}: no ${lang} text`);
        return;
    }
    if (has_conflicting_bubble_text(converted.map(candidate => candidate.dialog))) {
        warn(`dialog ${id}: conflicting ${lang} content sources; skipped`);
        return;
    }
    const chosen = converted[0];
    if (!names)
        names = new Map(json('ExcelBinOutput/NpcExcelConfigData.json').map(row => [row.id, row.nameTextMapHash]));
    const name = text_map(lang)[String(names.get(npc))];
    const roles = new Map(converted.flatMap(candidate => {
        const role = Object.values(candidate.raw).find((value) => value?.type?.startsWith('TALK_ROLE_'));
        if (!role)
            return [];
        const normalized = { type: role.type, ...(role.id != null ? { id: String(role.id) } : {}) };
        return [[JSON.stringify(normalized), normalized]];
    }));
    const { speaker: _source_speaker, ...dialog } = chosen.dialog;
    return {
        // The bubble's NPC argument controls its attachment, independently of the dialog role.
        dialog: { ...dialog, role: 'npc', ...(name ? { speaker: name } : {}) },
        ...(roles.size === 1 ? { dialog_speaker: roles.values().next().value } : {}),
        text_sources: [...new Set(converted.map(candidate => candidate.file))].sort(),
    };
}
function get_task_bubbles(quest, steps, lang) {
    const result = {};
    const pending = new Map();
    for (const { call, step: raw_step, event } of get_task_lua_placements('speech_bubble').get(quest) || []) {
        const step = steps.get(raw_step);
        if (!step) {
            warn(`Quest ${quest}: step ${raw_step} not exported`);
            continue;
        }
        const rule = get_bubble_rule(call.method);
        if (!rule) {
            warn(`${call.id}: unsupported bubble API ${call.method}; skipped`);
            continue;
        }
        const npc = call.args[0], id = call.args[1];
        if (rule.npc && (!Number.isSafeInteger(npc) || npc <= 0)) {
            warn(`${call.id}: unresolved NPC; skipped`);
            continue;
        }
        if (rule.text && (!Number.isSafeInteger(id) || id <= 0)) {
            warn(`${call.id}: unresolved dialog; skipped`);
            continue;
        }
        const text = rule.text ? resolve_dialog(id, npc, lang) : undefined;
        if (rule.text && !text)
            continue;
        const conditions = [];
        for (const guard of new Map(call.guards.map(guard => [`${guard.id}:${guard.value}`, guard])).values()) {
            conditions.push({ type: 'boolean', id: guard.id, title: 'Lua', subtitle: guard.description, value: guard.value });
            if (conditions.length > 1)
                conditions.push('and');
        }
        const after = call.after && `${event}:${step}:${call.after}`;
        const parent_exists = after && get_task_narrations(quest, steps, lang)[after];
        const common = {
            type: 'speech_bubble', step, event, source: call.id, api: call.method,
            scope: rule.scope,
            conditions,
            ...bubble_delay_fields(call),
            ...(parent_exists ? { after } : call.after ? { after_source: call.after } : {}),
            ...(call.callbacks?.length ? { callbacks: call.callbacks } : {}),
        };
        let bubble;
        if (rule.text && text)
            bubble = { ...common, action: rule.action,
                npc_id: npc, dialog_id: id, ...text,
                ...(rule.action === 'create' ? { parameters: call.args.slice(2).map(bubble_parameter) } : {}), };
        else if (rule.action === 'clear_task')
            bubble = { ...common, scope: 'quest', action: 'clear_task' };
        else
            bubble = { ...common, action: 'clear_npc', npc_id: npc };
        const base = `${event}:${step}:${call.id}`;
        const variants = pending.get(base) || new Map();
        variants.set(bubble_call_identity(call), bubble);
        pending.set(base, variants);
    }
    for (const [base, variants] of pending) {
        for (const [identity, bubble] of [...variants].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
            const key = variants.size === 1 ? base : `${base}:path:${createHash('sha256').update(identity).digest('hex').slice(0, 16)}`;
            if (result[key])
                throw new Error(`Bubble path identity collision: ${key}`);
            result[key] = bubble;
        }
    }
    return result;
}

module.exports = { get_task_bubbles };
