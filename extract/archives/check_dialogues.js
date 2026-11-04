const assert = require('node:assert/strict');
const { source_bin, source_excel, source_text } = require('./archiveSource');
const { getTalkKeys } = require('../dialogue');
const fields = getTalkKeys();
const topicType = 'QUEST_COND_HOMEWORLD_NPC_NEW_TALK';
const topicStates = new Map([0, 1].flatMap(part => source_excel(`TalkExcelConfigData_${part}`))
    .filter(row => row.beginCond?.some(condition => condition.type === topicType))
    .map(row => [row.id, row.beginCond.filter(condition => condition.type === topicType)]));
assert.deepEqual(topicStates.get(6900202), [{ param: ['9002', '6900207', '0', '', ''], type: topicType }], 'known Ayaka unread-topic condition');
let checked = 0;
for (const lang of ['zh_hans', 'en']) {
    const seen = new Set();
    for (const category of ['serenitea', 'tcg']) {
        const result = require(`./${category}`)[`get_${category}_export`](lang);
        for (const { data } of result.files) for (const talk of Object.values(data.talks)) {
            if (!talk.source_dialogue || seen.has(talk.source_id)) continue;
            seen.add(talk.source_id);
            let body;
            for (const kind of ['Npc', 'Quest', 'Activity', 'Gadget', 'NpcOther', 'Coop', 'Blossom', 'Cutscene', 'Storyboard']) {
                body = source_bin(`Talk/${kind}/${talk.source_id}.json`);
                if (body) break;
            }
            assert(body, `Missing source body ${talk.source_id}`);
            if (topicStates.has(talk.source_id)) {
                const actual = talk.source_dialogue.conditions.conditions.filter(condition => condition.type === topicType);
                // Excel pads these three-parameter conditions with empty strings;
                // NPC-group overrides serialize only the three meaningful values.
                for (const condition of actual) assert(condition.params.slice(3).every(value => value === ''), 'no unverified extra topic parameters');
                assert.deepEqual(actual.map(condition => ({ type: condition.type, params: condition.params.slice(0, 3) })),
                    topicStates.get(talk.source_id).map(condition => ({ type: condition.type, params: condition.param.slice(0, 3) })),
                    `Topic state preserved: ${talk.source_id}`);
            }
            const original = body[fields.dialogList] || [];
            assert.equal(talk.source_dialogue.dialogs.length, original.length);
            original.forEach((raw, index) => {
                const dialog = talk.source_dialogue.dialogs[index];
                assert.equal(dialog.id, raw[fields.dialogId]);
                assert.equal(dialog.content, source_text(lang, raw[fields.content]));
                assert.deepEqual(dialog.nextDialogs, raw[fields.next] || []);
            });
            checked += original.length;
        }
    }
}
let conditions = 0;
for (const states of topicStates.values()) {
    for (const condition of states) {
        assert(['0', '1'].includes(condition.param[2]));
        assert(condition.param[0] && condition.param[1]);
        assert(condition.param.slice(3).every(value => value === ''), 'only verified topic parameters or empty serializer padding');
        conditions++;
    }
}
assert(conditions >= topicStates.size && topicStates.size > 0, 'all source topic conditions were verified');
console.log(`${checked} bilingual raw dialogue nodes retain source IDs, original text and next links; ${conditions} topic states verified.`);
