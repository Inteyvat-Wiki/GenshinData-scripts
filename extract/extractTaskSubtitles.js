const { get_task_lua_placements } = require('./subtitles/task_lua');
const { get_task_narrations, has_dialog_content_field } = require('./subtitles/task_narration');
const { get_task_bubbles } = require('./subtitles/task_bubble');
const { record } = require('../versions/tracking');

module.exports = function collateTaskSubtitles(language) {
    const lang = { CHS: 'zh_hans', EN: 'en' }[language];
    if (!lang) throw new Error(`Unsupported task subtitle language: ${language}`);
    const narrations = get_task_lua_placements('narration');
    const bubbles = get_task_lua_placements('speech_bubble');
    // Calibrate source fields outside an individual quest's version dependency frame.
    has_dialog_content_field({});
    const quests = new Set([...narrations.keys(), ...bubbles.keys()]);
    const result = {};
    for (const id of [...quests].sort((a, b) => a - b)) {
        const entries = [...narrations.get(id) || [], ...bubbles.get(id) || []];
        const steps = new Map(entries.map(entry => [entry.step, entry.step]));
        // Keep raw subquest IDs in the database. Wiki-local step numbers are not source data.
        const value = record(() => ({ id, name: '',
            narrations: get_task_narrations(id, steps, lang),
            bubbles: get_task_bubbles(id, steps, lang),
        }));
        if (Object.keys(value.narrations).length || Object.keys(value.bubbles).length) result[id] = value;
    }
    return result;
};
