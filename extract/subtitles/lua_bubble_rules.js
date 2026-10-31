const bubble_rules = {
    CreateSpeechBubbleTask: { action: 'create', scope: 'quest', npc: true, text: true },
    TriggerNpcSpeechBubble: { action: 'trigger', scope: 'npc', npc: true, text: true },
    ClearSpeechBubbleTask: { action: 'clear_task', scope: 'quest', npc: false, text: false },
    StopQuestSpeechBubbleByNpc: { action: 'clear_npc', scope: 'quest', npc: true, text: false },
    ClearNpcSpeechBubble: { action: 'clear_npc', scope: 'npc', npc: true, text: false },
};
const lua_bubble_methods = new Set(Object.keys(bubble_rules));
function get_bubble_rule(method) {
    return Object.hasOwn(bubble_rules, method) ? bubble_rules[method] : undefined;
}
// Zero-based actual arguments, excluding self. Verified against the Lua wrappers.
const callbacks = {
    CallDelay: { argument: 1, kind: 'delay' },
    AfterMainPageActiveSafeCall: { argument: 0, kind: 'safe_call' },
    ActionSafeCall: { argument: 0, kind: 'safe_call' },
    QuestNarratorTask: { argument: 1, kind: 'narration_finish' },
    NarratorOnlyTask: { argument: 1, kind: 'narration_finish' },
    NarratorOnlyTaskLegacy: { argument: 1, kind: 'narration_finish' },
    NarratorOnlyTaskByData: { argument: 1, kind: 'narration_finish' },
    NarratorOnlyTaskByDataSpecifyingResumeReminder: { argument: 1, kind: 'narration_finish' },
    NarratorTaskByData: { argument: 1, kind: 'narration_finish' },
    NpcNarratorOnlyTaskByData: { argument: 2, kind: 'narration_finish' },
    NarratorTask: { argument: 3, kind: 'narration_finish' },
    NarratorTaskLegacy: { argument: 3, kind: 'narration_finish' },
    WarningNarratorTask: { argument: 3, kind: 'narration_finish' },
};
function get_lua_callback_rule(method, mode) {
    if (method === 'ActionSafeCall' && mode !== 'speech_bubble')
        return;
    return Object.hasOwn(callbacks, method) ? callbacks[method] : undefined;
}
function is_lua_delay(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
function bubble_delay_fields(call) {
    if (call.delay_unknown || !is_lua_delay(call.delay))
        return { delay_unknown: true };
    return call.delay ? { delay: call.delay } : {};
}
function bubble_parameter(value) {
    if (value === null || typeof value === 'boolean' || typeof value === 'string')
        return value;
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    return typeof value?.reference === 'string' ? { reference: value.reference } : { unknown: true };
}
// Only context/arguments affect path identity; translated text and source traversal order do not.
function bubble_call_identity(call) {
    const guards = [...new Map(call.guards.map(guard => [`${guard.id}:${guard.value}`, { id: guard.id, value: guard.value }])).values()]
        .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : Number(left.value) - Number(right.value));
    return JSON.stringify([call.method, call.args.map(bubble_parameter), guards, call.delay,
        call.delay_unknown || false, call.after || null, call.callbacks || []]);
}
function has_conflicting_bubble_text(candidates) {
    return new Set(candidates.map(candidate => candidate.content)).size > 1;
}

module.exports = { get_bubble_rule, get_lua_callback_rule, is_lua_delay, bubble_delay_fields, bubble_parameter, bubble_call_identity, has_conflicting_bubble_text, lua_bubble_methods };
