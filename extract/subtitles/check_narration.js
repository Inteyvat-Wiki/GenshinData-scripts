const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { lua_opcodes, LuaInspector, read_lua } = require('./lua');
function instruction(op, a = 0, b = 0, c = 0) {
    return (lua_opcodes.indexOf(op) | a << 6 | c << 14 | b << 23) >>> 0;
}
function prototype(code, constants, children = []) {
    return { path: '0', params: 0, stack: 8, code, constants, children, upvalues: [[0, 0]] };
}
const event = prototype([
    instruction('SELF', 1, 0, 256), instruction('LOADK', 3, 0, 1),
    instruction('CALL', 1, 3, 1), instruction('RETURN', 0, 1),
], ['QuestNarratorTask', { narratorId: 42 }]);
event.params = 1;
event.path = '0_0';
event.upvalues = [];
const root = prototype([
    instruction('NEWTABLE'), instruction('LOADK', 1, 0, 1),
    instruction('SETTABLE', 0, 256, 1), instruction('CLOSURE', 1),
    instruction('SETTABLE', 0, 258, 1), instruction('RETURN', 0, 2),
], ['defaultAlias', 'Quest42', 'OnSubStart4201'], [event]);
const inspector = new LuaInspector('fixture', root, new Map());
inspector.load();
assert.equal(inspector.owner, 42);
assert.deepEqual(inspector.inspect('OnSubStart4201').map(call => [call.method, call.args[0], call.guards]), [['QuestNarratorTask', { narratorId: 42 }, []]]);
// A return in one branch must not erase the other branch or expose dead calls.
event.code = [instruction('TEST', 0, 0, 0), instruction('JMP', 0, 256, 1),
    instruction('RETURN', 0, 1), ...event.code];
assert.equal(inspector.inspect('OnSubStart4201').length, 1);
assert.equal(inspector.calls[0].guards.length, 1);
event.code = [instruction('RETURN', 0, 1), ...event.code];
assert.equal(inspector.inspect('OnSubStart4201').length, 0);
const fixture_path = path.resolve(__dirname, '../../.cache/lua');
for (const [actor, config, owner, method, narrator] of [
    [18538, 22661, 76202, 'OnSubStart7620210', 7620203],
    [15316, 19523, 20005, 'OnSubStart2000502', undefined],
    [18829, 22952, 79022, 'OnSubFailed7902210', undefined],
    [14781, 19528, 2000, 'OnSubFinish200009', 200002],
]) {
    if (!fs.existsSync(path.join(fixture_path, `${actor}.luac`)))
        continue;
    const configs = new Map();
    const data = new LuaInspector(String(config), read_lua(path.join(fixture_path, `${config}.luac`)), configs).load();
    assert.equal(data.MainID, owner);
    configs.set(owner, data);
    const probe = new LuaInspector(String(actor), read_lua(path.join(fixture_path, `${actor}.luac`)), configs);
    probe.load();
    const calls = probe.inspect(method);
    assert.equal(probe.owner, owner);
    assert.equal(calls.length, 1);
    if (narrator)
        assert.equal(calls[0].args[0].narratorId, narrator);
    else
        assert.equal(calls[0].args[0][1].dialogID, owner === 20005 ? 200050701 : 790229901);
    if (owner === 2000)
        assert.equal(calls[0].delay, 2);
}
console.log('Narration checks passed');
