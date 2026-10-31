const fs = require('node:fs');
const { lua_bubble_methods, get_lua_callback_rule, is_lua_delay } = require('./lua_bubble_rules');

const lua_opcodes = ('ADD SUB MUL MOD POW DIV IDIV BAND BOR BXOR SHL SHR UNM BNOT NOT LEN '
    + 'CONCAT JMP EQ LT LE MOVE LOADK EXTRAARG LOADBOOL RETURN GETUPVAL SETLIST '
    + 'LOADKX SELF FORLOOP SETTABLE TAILCALL TFORLOOP SETTABUP TESTSET GETTABUP '
    + 'VARARG LOADNIL TFORCALL SETUPVAL GETTABLE FORPREP NEWTABLE CALL CLOSURE TEST').split(' ');
function read_lua(file) {
    const data = fs.readFileSync(file);
    let offset = 0;
    let string_size = 4;
    function take(size) {
        if (size < 0 || offset + size > data.length)
            throw new Error('Truncated Lua bytecode');
        const value = data.subarray(offset, offset + size);
        offset += size;
        return value;
    }
    function count() {
        const value = take(4).readInt32LE();
        if (value < 0 || value > data.length)
            throw new Error('Invalid Lua count');
        return value;
    }
    function string() {
        let size = take(1)[0];
        if (size === 255)
            size = string_size === 4
                ? take(4).readUInt32LE() : Number(take(8).readBigUInt64LE());
        return size ? take(size - 1).toString('utf8') : '';
    }
    function prototype(path, depth) {
        if (depth > 100)
            throw new Error('Lua prototype nesting limit');
        string();
        take(8);
        const [params, , stack] = take(3);
        const code = Array.from({ length: count() }, () => take(4).readUInt32LE());
        const constants = Array.from({ length: count() }, () => {
            const tag = take(1)[0];
            if (tag === 0)
                return null;
            if (tag === 1)
                return !!take(1)[0];
            if (tag === 3)
                return take(8).readDoubleLE();
            if (tag === 19)
                return Number(take(8).readBigInt64LE());
            if (tag === 4 || tag === 20)
                return string();
            throw new Error(`Unknown Lua constant ${tag}`);
        });
        const upvalues = Array.from({ length: count() }, () => [...take(2)]);
        const children = Array.from({ length: count() }, (_, index) => prototype(`${path}_${index}`, depth + 1));
        take(count() * 4);
        for (let remaining = count(); remaining > 0; remaining--) {
            string();
            take(8);
        }
        for (let remaining = count(); remaining > 0; remaining--)
            string();
        return { path, params, stack, code, constants, upvalues, children };
    }
    if (!take(5).equals(Buffer.from([27, 76, 117, 97, 83])))
        throw new Error('Not Lua 5.3 bytecode');
    const format = take(1)[0];
    if (format !== 0 && format !== 1)
        throw new Error(`Unsupported Lua format ${format}`);
    if (!take(6).equals(Buffer.from([25, 147, 13, 10, 26, 10])))
        throw new Error('Invalid Lua signature');
    string_size = format === 1 ? 4 : 8;
    const sizes = format === 1 ? [4, 4, 8, 8] : [4, 8, 4, 8, 8];
    if (!take(sizes.length).equals(Buffer.from(sizes)))
        throw new Error('Unsupported Lua value sizes');
    take(17);
    const root = prototype('0', 0);
    if (offset !== data.length)
        throw new Error('Trailing Lua bytes');
    return root;
}
// Share modules assign literal tables to globals instead of returning a client config.
// Admit straight-line data only: native calls, branches and loops are not evaluated here.
function read_lua_share_config(source, root) {
    if (!root.constants.includes('main_id') || !root.constants.includes('quest_data'))
        return;
    const allowed = new Set(['MOVE', 'LOADK', 'LOADKX', 'LOADBOOL', 'LOADNIL', 'GETUPVAL', 'GETTABUP',
        'GETTABLE', 'SETTABUP', 'SETUPVAL', 'SETTABLE', 'NEWTABLE', 'SETLIST', 'RETURN', 'EXTRAARG']);
    if (root.children.length || root.code.some((word, pc) => !allowed.has(lua_opcodes[word & 63])
        || lua_opcodes[word & 63] === 'LOADBOOL' && !!((word >>> 14) & 511)
        || lua_opcodes[word & 63] === 'RETURN' && pc !== root.code.length - 1))
        return;
    const environment = {};
    new LuaInspector(source, root, new Map()).evaluate({ prototype: root,
        upvalues: root.upvalues.map(() => ({ value: environment })) }, []);
    if (!Number.isSafeInteger(environment.main_id) || environment.main_id <= 0
        || !environment.quest_data || typeof environment.quest_data !== 'object')
        return;
    return { id: environment.main_id, data: { SubIds: environment.sub_ids,
            RewindData: environment.rewind_data, QuestData: environment.quest_data } };
}
// Static evaluation recovers constants and captured config tables; it never executes game Lua.
class LuaInspector {
    source;
    root;
    configs;
    shares;
    static_globals;
    actor = {};
    owner = 0;
    calls = [];
    mode = 'narration';
    global_environment;
    mutable_globals = new Set();
    unknown_global_write = false;
    constructor(source, root, configs, shares = new Map(), static_globals = false) {
        this.source = source;
        this.root = root;
        this.configs = configs;
        this.shares = shares;
        this.static_globals = static_globals;
    }
    lookup(object, key) {
        if (key === 'clientData' && this.owner)
            return this.configs.get(this.owner);
        if (key === 'shareData' && this.owner)
            return this.shares.get(this.owner);
        if (object && object === this.global_environment)
            return !this.unknown_global_write && !this.mutable_globals.has(String(key)) && Object.hasOwn(object, key)
                ? object[key] : { reference: `_G.${key}` };
        if (object?.reference)
            return { reference: `${object.reference}.${key}` };
        return object?.[key];
    }
    guards(prototype, pc, tests) {
        const edges = prototype.code.map((word, index) => {
            const op = lua_opcodes[word & 63];
            const c = (word >>> 14) & 511;
            const target = index + 1 + (word >>> 14) - 131071;
            if (op === 'RETURN' || op === 'TAILCALL')
                return [];
            if (op === 'JMP' || op === 'FORPREP')
                return [target];
            if (op === 'FORLOOP' || op === 'TFORLOOP')
                return [index + 1, target];
            if (['EQ', 'LT', 'LE', 'TEST', 'TESTSET'].includes(op))
                return [index + 1, index + 2];
            return [index + ((op === 'LOADBOOL' && c) || op === 'LOADKX' ? 2 : 1)];
        });
        const reaches = (start, blocked = -1) => {
            const pending = [start], seen = new Set();
            while (pending.length) {
                const node = pending.pop();
                if (node === blocked || seen.has(node))
                    continue;
                if (node === pc)
                    return true;
                seen.add(node);
                pending.push(...(edges[node] || []));
            }
            return false;
        };
        const result = [];
        if (!reaches(0))
            return;
        let alternative_paths = false;
        for (const [index, description] of tests) {
            if (reaches(0, index)) {
                if (reaches(index + 1) !== reaches(index + 2))
                    alternative_paths = true;
                continue;
            }
            const first = reaches(index + 1), second = reaches(index + 2);
            if (first === second)
                continue;
            const word = prototype.code[index], op = lua_opcodes[word & 63];
            const flag = ['TEST', 'TESTSET'].includes(op) ? (word >>> 14) & 511 : (word >>> 6) & 255;
            result.push({ id: `lua:${this.source}:${prototype.path}:${index}`,
                value: first ? !!flag : !flag, description });
        }
        // Necessary branch outcomes alone do not describe an OR-shaped control-flow join.
        if (alternative_paths)
            result.push({ id: `lua:${this.source}:${prototype.path}:call:${pc}`,
                value: true, description: `${prototype.path}:${pc}` });
        return result;
    }
    evaluate(closure, args, context) {
        const prototype = closure.prototype;
        if (context?.stack.includes(prototype.path) || (context?.stack.length || 0) > 30)
            return;
        const registers = Array.from({ length: prototype.stack }, (_, index) => ({ value: args[index] }));
        const tests = new Map();
        const conditional_initialization = !context && this.global_environment && prototype.code.some((word, pc) => {
            const op = lua_opcodes[word & 63];
            return ['JMP', 'FORLOOP', 'FORPREP', 'TFORLOOP', 'EQ', 'LT', 'LE', 'TEST', 'TESTSET'].includes(op)
                || op === 'LOADBOOL' && !!((word >>> 14) & 511)
                || op === 'RETURN' && pc !== prototype.code.length - 1;
        });
        const rk = (value) => value & 256 ? prototype.constants[value & 255] : registers[value]?.value;
        const describe = (value) => value?.reference || (typeof value === 'object' ? '?' : String(value));
        for (let pc = 0; pc < prototype.code.length; pc++) {
            const word = prototype.code[pc], op = lua_opcodes[word & 63];
            if (!op)
                throw new Error(`Unknown Lua opcode ${word & 63}`);
            const a = (word >>> 6) & 255, b = (word >>> 23) & 511, c = (word >>> 14) & 511, bx = word >>> 14;
            const set = (index, value) => { if (registers[index])
                registers[index].value = value; };
            const get = (index) => registers[index]?.value;
            if (op === 'MOVE')
                set(a, get(b));
            else if (op === 'LOADK')
                set(a, prototype.constants[bx]);
            else if (op === 'LOADKX')
                set(a, prototype.constants[prototype.code[++pc] >>> 6]);
            else if (op === 'LOADBOOL')
                set(a, !!b);
            else if (op === 'LOADNIL')
                for (let index = a; index <= a + b; index++)
                    set(index, undefined);
            else if (op === 'GETUPVAL')
                set(a, closure.upvalues[b]?.value);
            else if (op === 'SETUPVAL' && !context)
                closure.upvalues[b].value = get(a);
            else if (op === 'GETTABLE' || op === 'GETTABUP')
                set(a, this.lookup(op === 'GETTABUP' ? closure.upvalues[b]?.value : get(b), rk(c)));
            else if (op === 'NEWTABLE')
                set(a, {});
            else if (op === 'SETTABLE' || op === 'SETTABUP') {
                const object = op === 'SETTABUP' ? closure.upvalues[a]?.value : get(a);
                if (object && !object.reference && !(context && object === this.global_environment))
                    object[rk(b)] =
                        object === this.global_environment && conditional_initialization ? { reference: `_G.${rk(b)}` } : rk(c);
            }
            else if (op === 'SELF') {
                const object = get(b), key = rk(c), value = this.lookup(object, key);
                set(a + 1, object);
                set(a, { reference: `method:${key}`, closure: value?.prototype ? value : undefined });
            }
            else if (op === 'CLOSURE') {
                const child = prototype.children[bx];
                set(a, { prototype: child, upvalues: child.upvalues.map(([stack, index]) => stack ? registers[index] : closure.upvalues[index]) });
            }
            else if (op === 'SETLIST' && b) {
                const table = get(a);
                const block = c || prototype.code[++pc] >>> 6;
                if (table)
                    for (let index = 1; index <= b; index++)
                        table[(block - 1) * 50 + index] = get(a + index);
            }
            else if (op === 'CONCAT') {
                const values = registers.slice(b, c + 1).map(cell => cell.value);
                set(a, values.every(value => ['string', 'number'].includes(typeof value)) ? values.join('') : undefined);
            }
            else if (op === 'CALL' || op === 'TAILCALL') {
                const fn = get(a);
                const values = b ? registers.slice(a + 1, a + b).map(cell => cell.value) : [];
                const reference = fn?.reference;
                const method = reference?.split('.').at(-1)?.replace(/^method:/, '');
                const payload = reference?.startsWith('method:') ? values.slice(1) : values;
                const local_guards = context ? this.guards(prototype, pc, tests) : [];
                const guards = [...(context?.guards || []), ...(local_guards || [])];
                const next = context && local_guards && { ...context, guards, stack: [...context.stack, prototype.path] };
                let result;
                if (method === 'class')
                    result = {};
                else if (method === 'require') {
                    const match = typeof payload[0] === 'string' && payload[0].match(/^Quest\/Client\/Q(\d+)ClientConfig$/);
                    result = match ? this.configs.get(Number(match[1])) : { reference: `module:${payload[0]}` };
                }
                else if (method === 'tostring')
                    result = typeof payload[0] === 'number' ? String(payload[0]) : undefined;
                else {
                    const target = fn?.closure || (fn?.prototype ? fn : undefined);
                    if (target && next)
                        this.evaluate(target, values, next);
                    if (method && next) {
                        const id = `${this.source}:${prototype.path}:${pc}`;
                        if (this.mode === 'speech_bubble' ? lua_bubble_methods.has(method)
                            : /Narrator|^(ShowReminder|SayReminder)$/.test(method))
                            this.calls.push({
                                id, method, args: payload, guards, delay: next.delay, after: next.after,
                                ...(next.delay_unknown ? { delay_unknown: true } : {}),
                                ...(next.callbacks?.length ? { callbacks: next.callbacks } : {}),
                            });
                        const callback_rule = get_lua_callback_rule(method, this.mode);
                        if (callback_rule) {
                            const index = callback_rule.argument;
                            const callback = payload[index];
                            const callback_target = callback?.prototype ? callback : callback?.closure;
                            const delay = next.delay + (callback_rule.kind === 'delay' && is_lua_delay(payload[0]) ? payload[0] : 0);
                            if (callback_target)
                                this.evaluate(callback_target, [this.actor], {
                                    ...next,
                                    delay: is_lua_delay(delay) ? delay : 0,
                                    ...(this.mode === 'speech_bubble' && callback_rule.kind === 'delay' && (!is_lua_delay(payload[0]) || !is_lua_delay(delay))
                                        ? { delay_unknown: true } : {}),
                                    after: callback_rule.kind === 'narration_finish' ? id : next.after,
                                    ...(this.mode === 'speech_bubble' ? { callbacks: [...(next.callbacks || []),
                                            { source: id, method, argument: index, kind: callback_rule.kind }] } : {}),
                                });
                        }
                    }
                    if (method)
                        result = { reference: `${method}(${payload.map(describe).join(', ')})` };
                }
                if (!b || !c)
                    for (let index = a; index < registers.length; index++)
                        set(index, undefined);
                else if (c > 1) {
                    set(a, result);
                    for (let index = a + 1; index < a + c - 1; index++)
                        set(index, undefined);
                }
            }
            else if (op === 'RETURN' && b > 1 && !context)
                return get(a);
            else if (['EQ', 'LT', 'LE', 'TEST', 'TESTSET'].includes(op)) {
                tests.set(pc, ['TEST', 'TESTSET'].includes(op) ? describe(get(a))
                    : `${describe(rk(b))} ${op === 'EQ' ? '==' : op === 'LT' ? '<' : '<='} ${describe(rk(c))}`);
                for (let index = prototype.params; index < registers.length; index++)
                    set(index, undefined);
            }
            else if (['JMP', 'FORLOOP', 'FORPREP', 'TFORLOOP'].includes(op)) {
                for (let index = prototype.params; index < registers.length; index++)
                    set(index, undefined);
            }
            else if (['ADD', 'SUB', 'MUL', 'DIV'].includes(op)) {
                const left = rk(b), right = rk(c);
                set(a, typeof left === 'number' && typeof right === 'number'
                    ? op === 'ADD' ? left + right : op === 'SUB' ? left - right : op === 'MUL' ? left * right : left / right
                    : undefined);
            }
            else if (['VARARG', 'TFORCALL', 'NOT', 'LEN', 'UNM', 'BNOT', 'MOD', 'POW', 'IDIV',
                'BAND', 'BOR', 'BXOR', 'SHL', 'SHR'].includes(op))
                set(a, undefined);
        }
    }
    load() {
        if (this.static_globals)
            this.global_environment = {};
        const root = { prototype: this.root,
            upvalues: this.root.upvalues.map(() => ({ value: this.global_environment || { reference: '_G' } })) };
        const value = this.evaluate(root, []);
        if (value && !value.reference)
            this.actor = value;
        if (this.static_globals) {
            this.mutable_globals.clear();
            this.unknown_global_write = false;
            // Initialization values are usable only if no runtime closure can replace that global.
            const visit = (prototype, environment_upvalues) => {
                if (prototype !== this.root && prototype !== this.actor.OnDataLoaded?.prototype) {
                    for (const word of prototype.code) {
                        if (lua_opcodes[word & 63] !== 'SETTABUP' || !environment_upvalues.has((word >>> 6) & 255))
                            continue;
                        const key = (word >>> 23) & 511;
                        if (key & 256)
                            this.mutable_globals.add(String(prototype.constants[key & 255]));
                        else
                            this.unknown_global_write = true;
                    }
                }
                for (const child of prototype.children)
                    visit(child, new Set(child.upvalues.flatMap(([stack, index], slot) => !stack && environment_upvalues.has(index) ? [slot] : [])));
            };
            visit(this.root, new Set(this.root.upvalues.map((_, index) => index)));
        }
        this.owner = typeof this.actor.defaultAlias === 'string'
            ? Number(this.actor.defaultAlias.match(/^Quest(\d+)$/)?.[1]) || 0 : 0;
        if (this.actor.OnDataLoaded?.prototype)
            this.evaluate(this.actor.OnDataLoaded, [this.actor]);
        return this.actor;
    }
    inspect(entry, mode = 'narration') {
        this.calls = [];
        this.mode = mode;
        const closure = this.actor[entry];
        if (closure?.prototype)
            this.evaluate(closure, [this.actor], { guards: [], delay: 0, stack: [] });
        return this.calls;
    }
}

module.exports = { lua_bubble_methods: require("./lua_bubble_rules").lua_bubble_methods, read_lua, read_lua_share_config, LuaInspector, lua_opcodes };
