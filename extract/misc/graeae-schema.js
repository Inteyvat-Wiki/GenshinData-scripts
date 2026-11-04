const { resolveField, resolveRow } = require('../field-inference');

// Exact witnesses verified against 7.1 c5ef717b774 and 7.2 bd35e243fa4.
// A text hash locates the initial row when even the record ID is obfuscated.
// No field names or inferred keys are shared between input snapshots/tables.
function resolveGraeaeFields(kind, rows) {
    if (!rows.length) return {};
    const label = `Graeae.${kind}`;
    const contains = value => resolveRow(rows, `${label}:value=${value}`, row => Object.values(row).includes(value));
    const one = (name, row, value) => resolveField(`${label}.${name}`, [{ row, value }]);
    const anchor = kind === 'Topic' ? contains(562223715)
        : kind === 'Message' ? contains(3421014762)
        : kind === 'Option' ? contains(4069531165)
        : kind === 'Character' ? resolveRow(rows, `${label}:1`, row => row.characterId === 1)
        : null;
    if (!anchor) throw new Error(`Unknown Graeae table: ${kind}`);
    const id = kind === 'Character' ? 'characterId'
        : one('id', anchor, { Topic: 1001, Message: 100101, Option: 1001011 }[kind]);
    const row = value => resolveRow(rows, `${label}:${value}`, entry => entry[id] === value);
    if (kind === 'Topic') return { id,
        title: one('title', anchor, 562223715),
        icon: one('icon', row(1), 'ART/UI/Atlas/LS/TPS/TPSGlasses/UI_Icon_TpsGlassesChatPage_Chat'),
    };
    if (kind === 'Character') return { id,
        name: one('name', anchor, 1264548403),
        icon: one('icon', anchor, 'ART/UI/Atlas/NPCIcon/UI_NPC_Snezhnaya_GreyEye_Circle'),
    };
    if (kind === 'Option') return { id,
        topic: one('topic', anchor, 1001), position: one('position', anchor, 2), next: one('next', anchor, 3),
        requires: one('requires', row(10010), 10002), text: one('text', anchor, 4069531165),
    };
    const second = row(100102), picture = row(15005), location = row(5008);
    return { id,
        topic: one('topic', anchor, 1001),
        // characterId and local position both equal 1 on the first message.
        position: resolveField(`${label}.position`, [{ row: anchor, value: 1 }, { row: second, value: 3 }]),
        next: one('next', anchor, 2), requires: one('requires', second, 1001011),
        full: one('full', anchor, 3421014762), preview: one('preview', anchor, 505105052),
        kind: resolveField(`${label}.kind`, [{ row: anchor, value: 'TEXT' }, { row: picture, value: 'IMAGE' }]),
        image: one('image', picture, 'ART/UI/Atlas/LS/TPS/TPSGlasses/TPSGlassesChatImg/UI_Img_GlassesChat_TreasureMap'),
        thumbnail: one('thumbnail', picture, 'ART/UI/Atlas/LS/TPS/TPSGlasses/TPSGlassesChatPic/UI_Img_GlassesChat_TreasureMap'),
        location: one('location', location, 1008191327), quest: one('quest', location, 77130),
    };
}

module.exports = { resolveGraeaeFields };
