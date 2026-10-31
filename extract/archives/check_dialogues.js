const assert = require('node:assert/strict');
const { source_bin, source_excel, source_text } = require('./archiveSource');
const { getTalkKeys } = require('../dialogue');
const fields = getTalkKeys();
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
for (const row of [0, 1].flatMap(part => source_excel(`TalkExcelConfigData_${part}`))) {
    for (const condition of row.beginCond || []) if (condition.type === 'QUEST_COND_HOMEWORLD_NPC_NEW_TALK') {
        assert(['0', '1'].includes(condition.param[2]));
        assert(condition.param[0] && condition.param[1]);
        conditions++;
    }
}
assert.equal(conditions, 720);
console.log(`${checked} bilingual raw dialogue nodes retain source IDs, original text and next links; ${conditions} topic states verified.`);
