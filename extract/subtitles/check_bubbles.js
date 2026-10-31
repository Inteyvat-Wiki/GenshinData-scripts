const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { lua_opcodes, LuaInspector, read_lua_share_config, read_lua } = require('./lua');
const { get_task_bubbles } = require('./task_bubble');
const { has_dialog_content_field, get_task_narrations } = require('./task_narration');
const { bubble_delay_fields, bubble_parameter, get_bubble_rule, get_lua_callback_rule, has_conflicting_bubble_text, bubble_call_identity } = require('./lua_bubble_rules');
function word(op, a = 0, b = 0, c = 0) {
    return (lua_opcodes.indexOf(op) | a << 6 | c << 14 | b << 23) >>> 0;
}
const event = {
    path: '0_0', params: 1, stack: 8, upvalues: [], children: [],
    constants: ['CreateSpeechBubbleTask', 123, 456],
    code: [word('SELF', 1, 0, 256), word('LOADK', 3, 0, 1), word('LOADK', 4, 0, 2),
        word('CALL', 1, 4, 1), word('RETURN', 0, 1)],
};
const root = {
    path: '0', params: 0, stack: 8, upvalues: [[0, 0]], children: [event],
    constants: ['defaultAlias', 'Quest42', 'OnSubFailed4201'],
    code: [word('NEWTABLE'), word('LOADK', 1, 0, 1), word('SETTABLE', 0, 256, 1),
        word('CLOSURE', 1), word('SETTABLE', 0, 258, 1), word('RETURN', 0, 2)],
};
const inspector = new LuaInspector('bubble-fixture', root, new Map());
const shareRoot = { path: '0', params: 0, stack: 2, upvalues: [[0, 0]], children: [],
    constants: ['main_id', 42, 'quest_data'],
    code: [word('SETTABUP', 0, 256, 257), word('NEWTABLE'), word('SETTABUP', 0, 258, 0), word('RETURN', 0, 1)] };
assert.equal(read_lua_share_config('share-fixture', shareRoot)?.id, 42);
assert.equal(read_lua_share_config('share-fixture', { ...shareRoot, code: [word('CALL'), ...shareRoot.code] }), undefined);
assert.equal(read_lua_share_config('share-fixture', { ...shareRoot, code: [word('JMP'), ...shareRoot.code] }), undefined);
const globalEvent = { ...event, upvalues: [[0, 0]], constants: ['CreateSpeechBubbleTask', 'NpcID', 456],
    code: [word('SELF', 1, 0, 256), word('GETTABUP', 3, 0, 257), word('LOADK', 4, 0, 2),
        word('CALL', 1, 4, 1), word('RETURN', 0, 1)] };
const globalRoot = { ...root, children: [globalEvent], constants: [...root.constants, 'NpcID', 123],
    code: [word('SETTABUP', 0, 259, 260), ...root.code] };
const globalInspector = new LuaInspector('global-fixture', globalRoot, new Map(), new Map(), true);
globalInspector.load();
assert.equal(globalInspector.inspect('OnSubFailed4201', 'speech_bubble')[0].args[0], 123);
const isolatedInspector = new LuaInspector('isolated-fixture', { ...globalRoot, code: root.code }, new Map(), new Map(), true);
isolatedInspector.load();
assert.deepEqual(isolatedInspector.inspect('OnSubFailed4201', 'speech_bubble')[0].args[0], { reference: '_G.NpcID' }, 'initialized globals must never leak between actors');
const guardedInspector = new LuaInspector('guarded-global-fixture', { ...globalRoot,
    code: [word('TEST', 0, 0, 0), word('JMP', 0, 256, 0), ...globalRoot.code] }, new Map(), new Map(), true);
guardedInspector.load();
assert.deepEqual(guardedInspector.inspect('OnSubFailed4201', 'speech_bubble')[0].args[0], { reference: '_G.NpcID' }, 'conditional initialization must not turn a possible NPC assignment into a definite one');
const runtimeEvent = { ...globalEvent, constants: [...globalEvent.constants, 999],
    code: [word('SETTABUP', 0, 257, 259), ...globalEvent.code] };
const runtimeInspector = new LuaInspector('runtime-global-fixture', { ...globalRoot, children: [runtimeEvent] }, new Map(), new Map(), true);
runtimeInspector.load();
assert.deepEqual(runtimeInspector.inspect('OnSubFailed4201', 'speech_bubble')[0].args[0], { reference: '_G.NpcID' }, 'a runtime-writable global must not be exported as its initial NPC value');
inspector.load();
assert.deepEqual(inspector.inspect('OnSubFailed4201'), []);
assert.deepEqual(inspector.inspect('OnSubFailed4201', 'speech_bubble').map(call => [call.method, call.args]), [['CreateSpeechBubbleTask', [123, 456]]]);
// One branch returns; only the other branch may register the bubble.
event.code = [word('TEST', 0, 0, 0), word('JMP', 0, 256, 1), word('RETURN', 0, 1), ...event.code];
assert.equal(inspector.inspect('OnSubFailed4201', 'speech_bubble')[0].guards.length, 1);
event.code = [word('RETURN', 0, 1), ...event.code];
assert.deepEqual(inspector.inspect('OnSubFailed4201', 'speech_bubble'), []);
// Unknown native closure arguments are not assumed to execute.
event.code = [word('SELF', 1, 0, 259), word('CLOSURE', 3), word('CALL', 1, 3, 1), word('RETURN', 0, 1)];
event.constants[3] = 'UnknownNativeCallback';
event.children = [{ ...event, path: '0_0_0', children: [], constants: ['TriggerNpcSpeechBubble', 123, 456],
        code: [word('SELF', 1, 0, 256), word('LOADK', 3, 0, 1), word('LOADK', 4, 0, 2),
            word('CALL', 1, 4, 1), word('RETURN', 0, 1)] }];
assert.deepEqual(inspector.inspect('OnSubFailed4201', 'speech_bubble'), []);
event.constants[3] = 'ActionSafeCall';
const safe = inspector.inspect('OnSubFailed4201', 'speech_bubble');
assert.equal(safe.length, 1);
assert.equal(safe[0].callbacks?.[0].method, 'ActionSafeCall');
assert.equal(safe[0].callbacks?.[0].kind, 'safe_call');
// A similar-looking name is not a verified native callback contract.
event.constants[3] = 'ArbitraryNarratorTask';
assert.deepEqual(inspector.inspect('OnSubFailed4201', 'speech_bubble'), []);
event.constants[3] = 'NarratorOnlyTaskByDataWithPriority';
assert.deepEqual(inspector.inspect('OnSubFailed4201', 'speech_bubble'), []);
// NarratorTask has pause/resume arguments BEFORE its fourth-argument completion callback.
event.constants = ['NarratorTask', {}, 16, 8];
event.code = [word('SELF', 1, 0, 256), word('LOADK', 3, 0, 1), word('LOADK', 4, 0, 2),
    word('LOADK', 5, 0, 3), word('CLOSURE', 6), word('CALL', 1, 6, 1), word('RETURN', 0, 1)];
const completion = inspector.inspect('OnSubFailed4201', 'speech_bubble');
assert.equal(completion.length, 1);
assert.equal(completion[0].callbacks?.[0].argument, 3);
assert.equal(completion[0].callbacks?.[0].kind, 'narration_finish');
assert.equal(completion[0].after, 'bubble-fixture:0_0:5');
event.constants = ['CallDelay', { reference: 'runtimeDelay' }];
event.code = [word('SELF', 1, 0, 256), word('LOADK', 3, 0, 1), word('CLOSURE', 4),
    word('CALL', 1, 4, 1), word('RETURN', 0, 1)];
assert.equal(inspector.inspect('OnSubFailed4201', 'speech_bubble')[0].delay_unknown, true);
event.constants[1] = 2.5;
const delayed = inspector.inspect('OnSubFailed4201', 'speech_bubble')[0];
assert.equal(delayed.delay, 2.5);
assert.equal(delayed.delay_unknown, undefined);
event.constants[1] = -1;
assert.equal(inspector.inspect('OnSubFailed4201', 'speech_bubble')[0].delay_unknown, true);
assert.deepEqual(bubble_delay_fields({ delay: 2.5, delay_unknown: true }), { delay_unknown: true });
assert.deepEqual(bubble_delay_fields({ delay: 0 }), {});
assert.deepEqual(bubble_parameter(Infinity), { unknown: true });
assert.equal(get_bubble_rule('constructor'), undefined);
assert.equal(get_lua_callback_rule('constructor', 'speech_bubble'), undefined);
assert.equal(get_bubble_rule('StopQuestSpeechBubbleByNpc')?.scope, 'quest');
assert.equal(get_bubble_rule('ClearNpcSpeechBubble')?.scope, 'npc');
assert.equal(has_conflicting_bubble_text([{ content: '相同文本' }, { content: '相同文本' }]), false);
assert.equal(has_conflicting_bubble_text([{ content: '同号甲' }, { content: '同号乙' }]), true);
const identity = { method: 'CreateSpeechBubbleTask', args: [123, 456], delay: 0,
    guards: [{ id: 'b', value: false }, { id: 'a', value: true }] };
assert.equal(bubble_call_identity(identity), bubble_call_identity({ ...identity, guards: [...identity.guards].reverse() }));
assert.notEqual(bubble_call_identity(identity), bubble_call_identity({ ...identity, args: [124, 456] }));
event.constants = ['ClearSpeechBubbleTask'];
event.children = [];
event.code = [word('SELF', 1, 0, 256), word('CALL', 1, 2, 1), word('RETURN', 0, 1)];
assert.deepEqual(inspector.inspect('OnSubFailed4201', 'speech_bubble').map(call => [call.method, call.args]), [['ClearSpeechBubbleTask', []]]);
const lua = path.resolve(__dirname, '../../.cache/lua');
if (fs.existsSync(path.join(lua, '14798.luac'))) {
    const share = read_lua_share_config('23982.luac', read_lua(path.join(lua, '23982.luac')));
    assert.equal(share?.id, 398);
    assert.equal(share?.data.QuestData['39805'].npcs[1].id, 140901);
    const sharedNpcBubbles = Object.values(get_task_bubbles(398, new Map([[39801, 1]]), 'zh_hans'))
        .filter(item => item.action === 'create');
    assert.equal(sharedNpcBubbles.length, 2, 'shared NPC config must resolve attachment without bypassing missing text');
    assert.deepEqual(sharedNpcBubbles.map(item => item.npc_id).sort((a, b) => a - b), [140901, 142901]);
    assert.ok(sharedNpcBubbles.every(item => item.dialog_id !== 3980305));
    // API NPC attachment is sufficient even when GlobalDialog has an empty original role.
    const roleless = Object.values(get_task_bubbles(20001, new Map([[2000101, 1], [2000102, 2]]), 'zh_hans'))
        .filter(item => item.dialog_id === 200080501);
    assert.equal(roleless.length, 2);
    assert.ok(roleless.every(item => item.npc_id === 140301 && item.dialog?.content === '救，救命啊！'));
    assert.ok(roleless.every(item => item.action === 'create' && item.dialog_speaker === undefined));
    assert.equal(has_dialog_content_field({ id: 200080501, order: 1804819201 }), false, 'an arbitrary numeric metadata field is not proof of a content hash');
    const data = get_task_bubbles(2017, new Map([[201711, 11]]), 'zh_hans');
    const bubble = Object.values(data).find(item => item.dialog_id === 20179902);
    assert.ok(bubble, 'real task bubble must resolve');
    assert.equal(bubble.step, 11);
    assert.equal(bubble.event, 'start');
    assert.equal(bubble.action, 'create');
    assert.equal(bubble.scope, 'quest');
    assert.equal(bubble.npc_id, 12260);
    assert.equal(bubble.dialog?.content, '好像是神像那边…');
    assert.equal(bubble.dialog_speaker?.id, '12139');
    assert.deepEqual(bubble.parameters, [5, true, 2, 3, true]);
    assert.deepEqual(bubble.dialog?.next_dialogs, [], 'one bubble must not expand the next-dialog chain');
    const english = Object.values(get_task_bubbles(2017, new Map([[201711, 11]]), 'en')).find(item => item.dialog_id === 20179902);
    assert.ok(english?.dialog?.content && english.dialog.content !== bubble.dialog.content);
    assert.deepEqual(get_task_bubbles(2017, new Map(), 'zh_hans'), {}, 'unexported steps must not be guessed');
    const lifecycle = Object.values(get_task_bubbles(2017, new Map([[201711, 11], [201713, 13], [201715, 15]]), 'zh_hans'));
    // SneakClear is shared by three START entries, not a presumed step-finish cleanup.
    const clears = lifecycle.filter(item => item.action === 'clear_task');
    assert.deepEqual(clears.map(item => item.step).sort((a, b) => a - b), [11, 13, 15]);
    assert.ok(clears.every(item => item.event === 'start' && item.source.endsWith(':0_15:17')));
    assert.ok(clears.every(item => item.scope === 'quest' && !item.dialog && item.npc_id === undefined));
    // Existing narration extraction remains independent of bubble indexing.
    const narration = get_task_narrations(76202, new Map([[7620210, 10]]), 'zh_hans');
    assert.ok(Object.values(narration).some(item => Object.values(item.dialogs).some(dialog => dialog.content === '…茶还是温的呢。嗯，真美味。')));
}
console.log('Bubble checks passed');
