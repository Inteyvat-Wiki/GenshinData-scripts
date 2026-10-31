// Raw-source assertions live with extraction, not with Wiki page generation.
const assert = require('node:assert/strict');
const { get_serenitea_export } = require('./serenitea');
const { source_excel, source_text, source_bin } = require('./archiveSource');
// Source extraction has no local image-copy side effects.
const furniture_rows = source_excel('HomeWorldFurnitureExcelConfigData');
const furniture_types = new Map(source_excel('HomeWorldFurnitureTypeExcelConfigData').map(row => [row.typeID, row]));
const suite_rows = source_excel('FurnitureSuiteExcelConfigData');
const companion_rows = source_excel('HomeWorldNPCExcelConfigData');
const events = source_excel('HomeWorldEventExcelConfigData');
const direct_ids = new Set([
    ...companion_rows.flatMap(row => row.talkIDs || []),
    ...events.flatMap(row => row.talkID ? [row.talkID] : []),
]);
assert.equal(direct_ids.size, 594);
function graph(item) {
    for (const key of item.entry_talks)
        (0, assert)(item.talks[key], `Missing entry ${key}`);
    const reached = new Set();
    const pending = [...item.entry_talks];
    for (let index = 0; index < pending.length; index++) {
        const key = pending[index];
        if (reached.has(key))
            continue;
        reached.add(key);
        const talk = item.talks[key];
        for (const next of talk.next_talks) {
            (0, assert)(item.talks[next], `Missing talk ${talk.source_id} -> ${next}`);
            pending.push(next);
        }
        for (const next of talk.initial_dialogs || [])
            (0, assert)(talk.dialogs[next.dialog]);
        for (const dialog of Object.values(talk.source_dialogue ? {} : talk.dialogs)) {
            for (const next of dialog.next_dialogs)
                (0, assert)(talk.dialogs[next.dialog]);
        }
    }
    assert.equal(reached.size, Object.keys(item.talks).length, `Unreachable talk on ${item.type}:${item.name}`);
}
const results = [];
const host_failures = [];
for (const lang of ['zh_hans', 'en']) {
    const result = get_serenitea_export(lang);
    results.push(result);
    const files = new Map(result.files.map(file => [file.id, file.data]));
    for (const row of furniture_rows) assert.equal(files.get(`furniture-${row.id}`).furniture_type, row.specialFurnitureType || '');
    assert.equal(files.size, result.files.length);
    assert.equal(result.list.length, result.files.length);
    const counts = {};
    const talk_ids = new Set();
    const talk_dialog_counts = new Map();
    let dialogs = 0, positions = 0, images = 0, available_images = 0, diagnostics = 0;
    for (const { id, data } of result.files) {
        counts[data.type] = (counts[data.type] || 0) + 1;
        (0, assert)(id.startsWith(`${data.type}-`));
        (0, assert)(!('reward' in data) && !('cost' in data) && !('damage' in data));
        graph(data);
        for (const relation of data.relations) {
            if (relation.category === 'serenitea')
                (0, assert)(files.has(relation.id), `Missing relation: ${relation.id}`);
            else
                (0, assert)(relation.source_id, `Missing source identity: ${relation.id}`);
        }
        for (const image of data.images) {
            images++;
            assert(!('url' in image), 'source extraction must not attach Wiki image URLs');
        }
        for (const talk of Object.values(data.talks)) {
            talk_ids.add(talk.source_id);
            talk_dialog_counts.set(talk.source_id, Object.keys(talk.dialogs).length);
            dialogs += Object.keys(talk.dialogs).length;
        }
        diagnostics += data.diagnostics?.length || 0;
        for (const entry of data.layout || []) {
            positions++;
            (0, assert)(files.has(entry.item));
            (0, assert)(entry.position.length === 3 && entry.position.every(Number.isFinite));
            if (entry.rotation)
                (0, assert)(entry.rotation.length === 3 && entry.rotation.every(Number.isFinite));
        }
    }
    assert.deepEqual(counts, { furniture: 2513, realm: 8, companion: 121, suite: 111, host: 2 });
    assert.equal(result.files.length, 2755);
    for (const row of furniture_rows) {
        const item = files.get(`furniture-${row.id}`);
        assert.equal(item.name, source_text(lang, row.nameTextMapHash));
        assert.equal(item.description, source_text(lang, row.descTextMapHash));
        assert.deepEqual(item.classifications, [...new Set((row.furnType || []).filter(Boolean))].map(id => {
            const type = furniture_types.get(id);
            assert(type, `Missing source classification ${id}`);
            return { id: String(id), group_id: type.typeCategoryID == null ? '' : String(type.typeCategoryID),
                group_name: source_text(lang, type.typeNameTextMapHash), name: source_text(lang, type.typeName2TextMapHash) };
        }), `Classification source fidelity: ${row.id}`);
        if (row.roomSceneID || row.surfaceType === 'Animal') {
            (0, assert)(!item.sections.some(section => section.text === item.description), `Repeated furnishing description: ${row.id}`);
        }
    }
    for (const row of suite_rows) {
        const item = files.get(`suite-${row.suiteID}`);
        assert.equal(item.description, source_text(lang, row.suiteDescTextMapHash));
        const raw = source_bin(`HomeworldFurnitureSuit/${row.jsonName}.json`);
        assert.equal(item.layout?.length, raw.HHDPMDCFCPK.length);
        raw.HHDPMDCFCPK.forEach((entry, index) => {
            const position = entry.position || {};
            assert.deepEqual(item.layout[index].position, [position.x || 0, position.y || 0, position.z || 0]);
            if (entry.rotation)
                assert.deepEqual(item.layout[index].rotation, [entry.rotation.x || 0, entry.rotation.y || 0, entry.rotation.z || 0]);
        });
        const components = new Map();
        for (const entry of raw.HHDPMDCFCPK)
            components.set(entry.furnitureID, (components.get(entry.furnitureID) || 0) + 1);
        for (const [id, count] of components)
            (0, assert)(item.relations.some(relation => relation.role === 'component'
                && relation.id === `furniture-${id}` && relation.count === count));
        for (const event of events.filter(event => event.furnitureSuitID === row.suiteID)) {
            if (event.talkID)
                (0, assert)(Object.values(item.talks).some(talk => talk.source_id === event.talkID));
            else
                (0, assert)(item.diagnostics?.some(message => message.endsWith(`:${event.eventID}`)));
        }
    }
    for (const id of direct_ids)
        (0, assert)(talk_ids.has(id), `Missing direct HomeWorld talk ${id}`);
    assert.equal([...direct_ids].reduce((count, id) => count + (talk_dialog_counts.get(id) || 0), 0), 7388);
    try {
        assert.equal(files.get('host-1001').name, lang === 'zh_hans' ? '阿圆' : 'Tubby');
        assert.equal(files.get('host-2000').name, lang === 'zh_hans' ? '阿嘟' : 'Chubby');
        (0, assert)(Object.values(files.get('host-1001').talks).some(talk => talk.source_id === 6890101));
        (0, assert)(Object.values(files.get('host-2000').talks).some(talk => talk.source_id === 6890501));
        for (const [host, entry, name_hash] of [[1001, 6890101, 1329823275], [2000, 6890501, 3190395835]]) {
            const item = files.get(`host-${host}`);
            const anchor = source_bin(`Talk/Gadget/${entry}.json`).PCIAMAFDDAA[0];
            assert.deepEqual(anchor.KBPOBGFGLKN, { id: String(host), type: 'TALK_ROLE_GADGET' });
            assert.equal(anchor.DPHNNJJCFAN, name_hash);
            assert.equal(item.name, source_text(lang, name_hash));
            for (const talk of Object.values(item.talks)) {
                const raw = source_bin(`Talk/Gadget/${talk.source_id}.json`).PCIAMAFDDAA;
                assert.equal(Object.keys(talk.dialogs).length, raw.length, `Filtered host reply: ${talk.source_id}`);
                (0, assert)(Object.keys(talk.dialogs).length > 0);
            }
            const greeting = Object.values(item.talks).find(talk => talk.source_id === entry);
            (0, assert)(greeting.source_dialogue.dialogs.some(dialog => dialog.roleType === 'TALK_ROLE_NPC' && (dialog.speakerTitle || dialog.speakerName) === item.name));
        }
    }
    catch (error) {
        host_failures.push(`${lang}: ${error.message}`);
    }
    (0, assert)(!talk_ids.has(6890601) && !talk_ids.has(6890701));
    // HomeWorld's historical conditional menu branches remain in scope even when
    // their actual body is stored under Talk/Activity. No generic quest body is copied.
    const kazuha = files.get('companion-9047');
    (0, assert)(Object.values(kazuha.talks).some(talk => talk.source_id === 6904701));
    (0, assert)(Object.values(kazuha.talks).some(talk => talk.source_id === 6904705));
    for (const id of [6904712, 6904713, 6904716, 6904720]) {
        (0, assert)(Object.values(kazuha.talks).some(talk => talk.source_id === id));
    }
    (0, assert)(kazuha.name && Object.values(kazuha.talks).some(talk => Object.values(talk.dialogs).some(dialog => dialog.content)));
    console.log(JSON.stringify({ lang, counts, direct_talks: direct_ids.size, unique_talks: talk_ids.size,
        direct_dialogs: [...direct_ids].reduce((count, id) => count + (talk_dialog_counts.get(id) || 0), 0),
        unique_talk_dialogs: [...talk_dialog_counts.values()].reduce((count, size) => count + size, 0),
        dialogs_including_suite_references: dialogs, layout_instances: positions,
        image_references: images, available_images, diagnostics,
        hosts: result.files.filter(file => file.data.type === 'host').map(({ id, data }) => ({
            id, name: data.name, talks: Object.keys(data.talks).length,
            dialogs: Object.values(data.talks).reduce((count, talk) => count + Object.keys(talk.dialogs).length, 0),
        })) }));
}
assert.deepEqual(results[0].files.map(file => file.id), results[1].files.map(file => file.id));
for (let index = 0; index < results[0].files.length; index++) {
    const first = results[0].files[index].data, second = results[1].files[index].data;
    assert.deepEqual(first.layout, second.layout);
    assert.deepEqual(Object.values(first.talks).map(talk => talk.source_id), Object.values(second.talks).map(talk => talk.source_id));
}
assert.equal(host_failures.length, 0, `Host dialogue verification failed:\n${host_failures.join('\n')}`);
console.log('Serenitea source text, IDs, layout, real relations, dialogue closure and bilingual parity passed.');
