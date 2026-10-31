const fs = require('node:fs');
const path = require('node:path');
const { lua_bubble_methods, read_lua, LuaInspector, read_lua_share_config } = require('./lua');
const { bubble_call_identity } = require('./lua_bubble_rules');
const project = path.resolve(__dirname, '../..');
const config = require('../../config.json');
const lua_path = path.resolve(project, process.env.GENSHIN_LUA_PATH || config.Lua_folder || '.cache/lua');
let placements;
function files(folder) {
    if (!fs.existsSync(folder))
        return [];
    return fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(folder, entry.name);
        return entry.isDirectory() ? files(file) : [file];
    }).sort();
}
function has_bubbles(root) {
    return root.constants.some(value => lua_bubble_methods.has(value)) || root.children.some(has_bubbles);
}
function get_task_lua_placements(mode) {
    if (placements)
        return placements[mode];
    if (!fs.existsSync(lua_path))
        throw new Error('Task subtitles require Lua input: configure Lua_folder or GENSHIN_LUA_PATH (' + lua_path + ')');
    placements = { narration: new Map(), speech_bubble: new Map() };
    const chunks = files(lua_path).filter(file => /\.(luac|lua|bytes|bin)$/i.test(file)).flatMap(file => {
        try {
            return [{ file, root: read_lua(file) }];
        }
        catch (error) {
            console.warn(`task Lua: ${file}: ${String(error)}`);
            return [];
        }
    });
    if (!chunks.length) throw new Error(`No Lua bytecode found at ${lua_path}; refusing to export empty task subtitles`);
    const configs = new Map(), ambiguous = new Set();
    for (const { file, root } of chunks) {
        if (!root.constants.includes('MainID'))
            continue;
        try {
            const data = new LuaInspector(path.relative(lua_path, file), root, configs).load();
            if (!Number.isInteger(data.MainID))
                continue;
            if (configs.has(data.MainID))
                ambiguous.add(data.MainID);
            else
                configs.set(data.MainID, data);
        }
        catch (error) {
            console.warn(`task Lua: ${file}: ${String(error)}`);
        }
    }
    for (const id of ambiguous) {
        configs.delete(id);
        console.warn(`task Lua: ambiguous config for Quest ${id}`);
    }
    const shares = new Map(), ambiguous_shares = new Set();
    for (const { file, root } of chunks) {
        try {
            const share = (0, read_lua_share_config)(path.relative(lua_path, file), root);
            if (!share)
                continue;
            if (shares.has(share.id))
                ambiguous_shares.add(share.id);
            else
                shares.set(share.id, share.data);
        }
        catch (error) {
            console.warn(`task Lua: ${file}: ${String(error)}`);
        }
    }
    for (const id of ambiguous_shares) {
        shares.delete(id);
        console.warn(`task Lua: ambiguous share config for Quest ${id}`);
    }
    for (const { file, root } of chunks) {
        const inspector = new LuaInspector(path.relative(lua_path, file), root, configs);
        try {
            inspector.load();
        }
        catch (error) {
            console.warn(`task Lua: ${file}: ${String(error)}`);
            continue;
        }
        if (!inspector.owner)
            continue;
        const bubble = has_bubbles(root);
        // Share-data recovery is scoped to bubbles; preserve the established narration model.
        let bubble_inspector = bubble ? new LuaInspector(path.relative(lua_path, file), root, configs, shares, true) : undefined;
        try {
            bubble_inspector?.load();
        }
        catch (error) {
            console.warn(`task Lua: ${file}:speech_bubble: ${String(error)}`);
            bubble_inspector = undefined;
        }
        for (const method of Object.keys(inspector.actor)) {
            const match = method.match(/^OnSub(Start|Finish|Failed)(\d+)$/);
            if (!match)
                continue;
            for (const kind of ['narration', 'speech_bubble']) {
                if (kind === 'speech_bubble' && !bubble_inspector)
                    continue;
                let calls;
                try {
                    calls = (kind === 'speech_bubble' ? bubble_inspector : inspector).inspect(method, kind);
                }
                catch (error) {
                    console.warn(`task Lua: ${file}:${method}:${kind}: ${String(error)}`);
                    continue;
                }
                const entries = placements[kind].get(inspector.owner) || [];
                for (const call of calls) {
                    if (kind === 'narration' && !/^(QuestNarratorTask|NarratorOnlyTask(?:ByData(?:SpecifyingResumeReminder|WithPriority)?|Legacy)?|NpcNarratorOnlyTaskByData|NarratorTask(?:ByData|Legacy)?|WarningNarratorTask|ShowReminder|SayReminder)$/.test(call.method))
                        continue;
                    // Keep different paths/guards to one bubble site; they are alternatives.
                    const duplicate = entries.some(entry => entry.step === Number(match[2])
                        && entry.event === match[1].toLowerCase() && entry.call.id === call.id
                        && (kind === 'narration' || bubble_call_identity(entry.call) === bubble_call_identity(call)));
                    if (!duplicate)
                        entries.push({ step: Number(match[2]), event: match[1].toLowerCase(), call });
                }
                placements[kind].set(inspector.owner, entries);
            }
        }
    }
    console.log(`task Lua: ${chunks.length} chunks, ${[...placements.narration.values()].reduce((n, entries) => n + entries.length, 0)} narration calls, ${[...placements.speech_bubble.values()].reduce((n, entries) => n + entries.length, 0)} bubble events`);
    return placements[mode];
}

module.exports = { get_task_lua_placements };
