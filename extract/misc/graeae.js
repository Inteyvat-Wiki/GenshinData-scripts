const assert = require('node:assert/strict');

// Snapshot-calibrated keys. Local positions and global record IDs are separate namespaces.
const fields = { topic: 'KEKHMPOIFHO', title: 'LBCPBPBJDAB', message: 'AEFJCKAJMFL',
    thread: 'HAOFOHIJENC', position: 'JJGAICEDLNP', next: 'LICNBELGBCN', requires: 'PADEPANADLD',
    full: 'GEJENCICCEC', preview: 'DBMAKNMIGLP', kind: 'FJHBPBFGDNN',
    option: 'HANOBLDBAPA', optionPosition: 'BHLEPODADCG', optionText: 'KLDJCKFKAKI' };

module.exports = function extractGraeae(input, helpers) {
    const { create, text, image, reference, fk, diagnose } = helpers;
    const messages = input.excel('TpsGlassesChatMessageExcelConfigData');
    const options = input.excel('TpsGlassesChatOptionExcelConfigData');
    const characters = new Map(input.excel('TpsGlassesChatCharacterExcelConfigData').map(row => [row.characterId, row]));
    for (const topic of input.excel('TpsGlassesChatTopicExcelConfigData')) {
        const id = topic[fields.topic];
        const item = create('graeae_message', { id }, topic[fields.title]);
        const selected = messages.filter(row => row[fields.thread] === id);
        const replies = options.filter(row => row[fields.thread] === id);
        const nodes = [], positions = new Map();
        const add = (row, node, position) => {
            assert(Number.isSafeInteger(position) && position > 0, `Invalid Graeae position: ${id}`);
            assert(!nodes.some(entry => entry.node.id === node.id), `Duplicate Graeae node: ${id}/${node.id}`);
            nodes.push({ row, node, position });
            if (!positions.has(position)) positions.set(position, []);
            positions.get(position).push(node.id);
        };
        for (const row of selected) {
            fk(item, 'TpsGlassesChatMessageExcelConfigData', row[fields.message]);
            const kind = row[fields.kind] || 'CONTROL';
            assert(['TEXT', 'CONTROL', 'IMAGE', 'LOCATION', 'HESPERIDES_MAP'].includes(kind), `Unknown Graeae message kind: ${kind}`);
            const node = { id: `message-${row[fields.message]}`, kind, text: text(item, row[fields.full], 'message.full'), next: [] };
            const preview = text(item, row[fields.preview], 'message.preview');
            if (preview) node.preview = preview;
            if (row.characterId) {
                const character = characters.get(row.characterId);
                assert(character, `Missing Graeae character: ${row.characterId}`);
                fk(item, 'TpsGlassesChatCharacterExcelConfigData', row.characterId);
                node.speaker = text(item, character.HALPCBNIPJP, 'message.speaker');
                reference(item, character.IMPGHHNHBBD);
            }
            if (row[fields.requires]) node.requires = `option-${row[fields.requires]}`;
            if (kind === 'IMAGE' && row.HCHADPEJPLB) {
                image(item, row.HCHADPEJPLB, 'illustration');
                node.image = { name: row.HCHADPEJPLB, kind: 'illustration' };
                reference(item, row.HEEHCBAOFIK); // thumbnail stays provenance, not a second illustration
            }
            if (kind === 'LOCATION') node.location = text(item, row.PJIDDONOIGK, 'message.location');
            // Coordinates, delays and rewards aren't prose. Keep only identifiers as audit references.
            if (row.EDGLCIBPKNJ) reference(item, `GraeaeLocationQuest:${row.EDGLCIBPKNJ}`);
            add(row, node, row[fields.position]);
        }
        for (const row of replies) {
            fk(item, 'TpsGlassesChatOptionExcelConfigData', row[fields.option]);
            const node = { id: `option-${row[fields.option]}`, kind: 'OPTION',
                text: text(item, row[fields.optionText], 'message.option'), next: [] };
            if (row[fields.requires]) node.requires = `option-${row[fields.requires]}`;
            add(row, node, row[fields.optionPosition]);
        }
        for (const { row, node } of nodes) {
            if (row[fields.next]) {
                assert(positions.has(row[fields.next]), `Missing Graeae successor: ${id}/${node.id}`);
                node.next = [...positions.get(row[fields.next])];
            }
            if (node.requires) assert(nodes.some(entry => entry.node.id === node.requires && entry.node.kind === 'OPTION'), `Missing Graeae option: ${id}/${node.id}`);
        }
        item.message_thread = { initial: positions.get(1) || [], nodes: nodes.sort((a, b) => a.position - b.position).map(entry => entry.node) };
        reference(item, topic.DGKPMJKEGDO);
        item.show = !!item.name && item.message_thread.nodes.some(node => node.text || node.image);
        if (!item.show) diagnose(item, 'empty_graeae_topic');
    }
};
