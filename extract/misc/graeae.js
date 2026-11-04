const assert = require('node:assert/strict');
const { resolveGraeaeFields } = require('./graeae-schema');

function rows(input, kind) {
    const table = `TpsGlassesChat${kind}ExcelConfigData`;
    const source = input.excel(table), fields = resolveGraeaeFields(kind, source);
    const ids = new Set();
    return source.map(row => {
        const normalized = { characterId: row.characterId,
            ...Object.fromEntries(Object.entries(fields).map(([name, key]) => [name, row[key]])) };
        const id = normalized.id;
        assert(Number.isSafeInteger(id) && id > 0, `Invalid Graeae ${kind} ID: ${id}`);
        assert(!ids.has(id), `Duplicate Graeae ${kind} ID: ${id}`);
        ids.add(id);
        return normalized;
    });
}

module.exports = function extractGraeae(input, helpers) {
    const { create, text, image, reference, fk, diagnose } = helpers;
    const topics = rows(input, 'Topic');
    const messages = rows(input, 'Message');
    const options = rows(input, 'Option');
    const characters = new Map(rows(input, 'Character').map(row => [row.id, row]));
    const topicIds = new Set(topics.map(row => row.id));
    for (const row of [...messages, ...options])
        assert(topicIds.has(row.topic), `Missing Graeae topic: ${row.topic}`);
    for (const topic of topics) {
        const id = topic.id;
        const item = create('graeae_message', { id }, topic.title);
        const selected = messages.filter(row => row.topic === id);
        const replies = options.filter(row => row.topic === id);
        const nodes = [], positions = new Map();
        const add = (row, node, position) => {
            assert(Number.isSafeInteger(position) && position > 0, `Invalid Graeae position: ${id}`);
            assert(!nodes.some(entry => entry.node.id === node.id), `Duplicate Graeae node: ${id}/${node.id}`);
            nodes.push({ row, node, position });
            if (!positions.has(position)) positions.set(position, []);
            positions.get(position).push(node.id);
        };
        for (const row of selected) {
            fk(item, 'TpsGlassesChatMessageExcelConfigData', row.id);
            const kind = row.kind || 'CONTROL';
            assert(['TEXT', 'CONTROL', 'IMAGE', 'LOCATION', 'HESPERIDES_MAP'].includes(kind), `Unknown Graeae message kind: ${kind}`);
            const node = { id: `message-${row.id}`, kind, text: text(item, row.full, 'message.full'), next: [] };
            const preview = text(item, row.preview, 'message.preview');
            if (preview) node.preview = preview;
            if (row.characterId) {
                const character = characters.get(row.characterId);
                assert(character, `Missing Graeae character: ${row.characterId}`);
                fk(item, 'TpsGlassesChatCharacterExcelConfigData', row.characterId);
                node.speaker = text(item, character.name, 'message.speaker');
                reference(item, character.icon);
            }
            if (row.requires) node.requires = `option-${row.requires}`;
            if (kind === 'IMAGE' && row.image) {
                image(item, row.image, 'illustration');
                node.image = { name: row.image, kind: 'illustration' };
                reference(item, row.thumbnail); // thumbnail stays provenance, not a second illustration
            }
            if (kind === 'LOCATION') node.location = text(item, row.location, 'message.location');
            // Coordinates, delays and rewards aren't prose. Keep only identifiers as audit references.
            if (row.quest) reference(item, `GraeaeLocationQuest:${row.quest}`);
            add(row, node, row.position);
        }
        for (const row of replies) {
            fk(item, 'TpsGlassesChatOptionExcelConfigData', row.id);
            const node = { id: `option-${row.id}`, kind: 'OPTION',
                text: text(item, row.text, 'message.option'), next: [] };
            if (row.requires) node.requires = `option-${row.requires}`;
            add(row, node, row.position);
        }
        for (const { row, node } of nodes) {
            if (row.next) {
                assert(positions.has(row.next), `Missing Graeae successor: ${id}/${node.id}`);
                node.next = [...positions.get(row.next)];
            }
            if (node.requires) assert(nodes.some(entry => entry.node.id === node.requires && entry.node.kind === 'OPTION'), `Missing Graeae option: ${id}/${node.id}`);
        }
        item.message_thread = { initial: positions.get(1) || [], nodes: nodes.sort((a, b) => a.position - b.position).map(entry => entry.node) };
        reference(item, topic.icon);
        item.show = !!item.name && item.message_thread.nodes.some(node => node.text || node.image);
        if (!item.show) diagnose(item, 'empty_graeae_topic');
    }
};
