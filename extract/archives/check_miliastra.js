// Raw-source assertions live with extraction, not with Wiki page generation.
const assert = require('node:assert/strict');
const { get_miliastra_export } = require('./miliastra');
const { source_excel, source_text } = require('./archiveSource');
// Check source references only; actual PNG availability belongs to the consumer.
const sources = {
    costume: { table: 'BeyondCostumeExcelConfigData', id: 'costumeId', name: 'nameTextMapHash', description: 'descriptionTextMapHash' },
    suit: { table: 'BeyondCostumeSuitExcelConfigData', id: 'suitId', name: 'nameTextMapHash', description: 'descriptionTextMapHash' },
    catalog: { table: 'BeyondCostumeDrawingExcelConfigData', id: 'FHIDKAKGMFN', name: 'nameTextMapHash', description: 'descTextMapHash' },
    lore: { table: 'LoadingTipsExcelConfigData', id: 'id', name: 'tipsTitleTextMapHash', description: 'tipsDescTextMapHash' },
    hall: { table: 'BeyondHallExcelConfigData', id: 'OANKFNDIFGE', name: 'NOBNAHLBFEG', description: 'HOCAJGPPDII' },
};
const counts = { costume: 2757, suit: 324, catalog: 411, lore: 12, hall: 20 };
const rows = Object.fromEntries(Object.entries(sources).map(([type, source]) => [type,
    source_excel(source.table).filter(row => type !== 'lore' || row.stageID === '91' && row.id >= 1928 && row.id <= 1939),
]));
for (const type of Object.keys(sources))
    assert.equal(rows[type].length, counts[type], `${type} source count`);
const manual = new Map(source_excel('ManualTextMapConfigData').map(row => [row.textMapId, row.textMapContentTextMapHash]));
const ui_entries = new Map(source_excel('BeyondCostumeUIEntryExcelConfigData').map(row => [row.configID, row]));
const ui_slots = source_excel('BeyondCostumeUISlotEntryExcelConfigData');
const slots = new Map(ui_slots.filter(row => row.slotType).map(row => [row.slotType, row]));
const colors = new Map(source_excel('BydCostumeColorTagExcelConfigData').map(row => [row.AAFJPEDPGJE, row.GLOCLKABHBC]));
// Unsafe integer anchors must be strings, not rounded floating-point numbers.
assert.equal(rows.costume.find(row => row.costumeId === 260002).MPFOEFGJKAE, '14425841620430768778');
assert.equal(rows.suit.find(row => row.suitId === 265001).iconHash, '2417760002026327459');
assert.equal(rows.suit.find(row => row.suitId === 265044).OLKBFAJMKNF, '10709550370493609764');
assert.equal(rows.catalog.find(row => row.FHIDKAKGMFN === 270001).iconHash, '3806693058812336722');
const results = new Map();
for (const lang of ['zh_hans', 'en']) {
    const result = get_miliastra_export(lang);
    results.set(lang, result);
    const files = new Map(result.files.map(file => [file.id, file.data]));
    const pages = new Map(result.list.map(page => [page.id, page]));
    assert.equal(result.files.length, 3524);
    assert.equal(files.size, 3524, 'unique stable data IDs');
    assert.equal(pages.size, 3524, 'unique stable page IDs');
    for (const [type, source] of Object.entries(sources)) {
        assert.equal(result.files.filter(file => file.data.type === type).length, counts[type]);
        for (const row of rows[type]) {
            const id = `${type}-${row[source.id]}`;
            const item = files.get(id);
            assert.ok(item, id);
            assert.equal(item.type, type);
            assert.equal(item.source.table, source.table);
            assert.equal(item.source.id, String(row[source.id]));
            assert.equal(item.name, source_text(lang, row[source.name]), `${lang}:${id} unmodified name`);
            assert.equal(item.description, source_text(lang, row[source.description]), `${lang}:${id} full raw description/story`);
            assert.ok(item.source.hashes.includes(String(row[source.name])));
            assert.ok(item.source.hashes.includes(String(row[source.description])));
            const page = pages.get(id);
            assert.ok(page.show);
            assert.equal(page.name, item.name);
            assert.equal(page.type, item.type);
            assert.deepEqual(item.talks, {});
            assert.deepEqual(item.entry_talks, []);
            for (const image of item.images) {
                assert.ok(image.name);
                assert(!('url' in image), 'source extraction must not attach Wiki image URLs');
            }
            for (const relation of item.relations) {
                assert.equal(relation.category, 'miliastra');
                assert.ok(['component', 'suit', 'costume', 'catalog'].includes(relation.role), 'stable untranslated role key');
                assert.ok(files.has(relation.id), `resolvable relation: ${id} -> ${relation.id}`);
                assert.equal(relation.name, files.get(relation.id).name);
            }
            if (!item.description) {
                assert.ok(item.diagnostics?.includes(`missing_text:${lang}:${source.description}:${row[source.description]}`));
            }
        }
    }
    const check_sections = (id, kind, expected) => assert.deepEqual(files.get(id).sections.filter(section => section.kind === kind).map(section => section.text), expected, `${lang}:${id}:${kind}`);
    for (const row of rows.costume) {
        const expected = new Map();
        for (const group of row.NIHIONHKJFH) for (const slot of group.NIGAGANHPHI || []) {
            const label = slots.get(slot), parent = ui_entries.get({ Costume: 1, Appearance: 2 }[label?.LOPKMKDOKMM]);
            if (parent) expected.set(String(label.configID), { id: String(label.configID), group_id: String(parent.configID),
                group_name: source_text(lang, parent.nameTextMapHash), name: source_text(lang, label.nameTextMapHash) });
        }
        assert.deepEqual(files.get(`costume-${row.costumeId}`).classifications, [...expected.values()], 'classification paths follow source slots');
    }
    assert.equal([...files.values()].filter(item => item.type === 'costume' && !item.classifications.length).length, 10);
    const text = (hash) => source_text(lang, hash);
    const body_labels = { BODY_GIRL: 'UI_BEYOND_GH_PREVIEW_GIRL_TAB', BODY_BOY: 'UI_BEYOND_GH_PREVIEW_BOY_TAB' };
    const quality_labels = {
        Green: 'UI_BEYOND_COSTUME_GREEN', Blue: 'UI_BEYOND_COSTUME_BLUE',
        Purple: 'UI_BEYOND_COSTUME_PURPLE', Orange: 'UI_BEYOND_COSTUME_ORANGE',
    };
    for (const type of ['costume', 'suit', 'catalog']) {
        for (const row of rows[type]) {
            const id = `${type}-${row[sources[type].id]}`;
            check_sections(id, 'quality', row.NGHBBIBFLBC ? [text(manual.get(quality_labels[row.NGHBBIBFLBC]))] : []);
            if (type === 'catalog') {
                for (const kind of ['body_type', 'slot', 'color', 'category'])
                    check_sections(id, kind, []);
                continue;
            }
            check_sections(id, 'body_type', [row.JKOKOGCFAKF.map((body) => text(manual.get(body_labels[body]))).join('\n')]);
            check_sections(id, 'color', row.AAFJPEDPGJE ? [row.AAFJPEDPGJE.map((color) => text(colors.get(color))).join('\n')] : []);
            const category_ids = { Costume: 1, Appearance: 2 };
            const categories = new Set();
            let expected_slots;
            if (type === 'suit') {
                const label = ui_slots.find(slot => slot.configID === 1);
                expected_slots = [text(label.nameTextMapHash)];
                categories.add(label.LOPKMKDOKMM);
            }
            else {
                expected_slots = row.NIHIONHKJFH.flatMap((group, index) => {
                    const names = [];
                    for (const slot of group.NIGAGANHPHI || []) {
                        const label = slots.get(slot);
                        if (!label) {
                            assert.ok(files.get(id).diagnostics?.includes(`unresolved_classification:NIHIONHKJFH:${index}:${slot}`));
                            continue;
                        }
                        names.push(text(label.nameTextMapHash));
                        if (label.LOPKMKDOKMM)
                            categories.add(label.LOPKMKDOKMM);
                        else
                            assert.ok(files.get(id).diagnostics?.includes(`unresolved_classification:LOPKMKDOKMM:${slot}`));
                    }
                    return names.length ? [names.join('\n')] : [];
                });
            }
            check_sections(id, 'slot', expected_slots);
            check_sections(id, 'category', categories.size ? [[...categories].map(category => text(ui_entries.get(category_ids[category]).nameTextMapHash)).join('\n')] : []);
            for (const hash of [...row.JKOKOGCFAKF.map((body) => manual.get(body_labels[body])),
                ...(row.AAFJPEDPGJE || []).map((color) => colors.get(color))]) {
                assert.ok(files.get(id).source.hashes.includes(String(hash)), 'classification hash provenance');
            }
        }
    }
    check_sections('costume-260001', 'category', [text(1229270749)]);
    check_sections('costume-260001', 'slot', [text(2093996)]);
    check_sections('costume-260001', 'color', [text(4150001616)]);
    assert.equal(files.get('costume-264101').sections.find(section => section.kind === 'slot').text, text(2996921892), 'skin tone uses real slot label');
    const variants = new Map();
    const variant_counts = {};
    for (const [type, field] of [['costume', 'CMEFDJHHIAI'], ['costume', 'NMJEHOJJBGC'], ['suit', 'BONBCELOAFJ'], ['suit', 'AENKJPHOPNO']]) {
        variant_counts[field] = 0;
        for (const row of rows[type]) {
            const source_id = row[sources[type].id];
            if (!row[field] || row[field] === source_id)
                continue;
            const id = `${type}-${source_id}`, target = `${type}-${row[field]}`;
            assert.ok(files.has(target), `real source-linked variant: ${id} -> ${target}`);
            variant_counts[field]++;
            variants.set(id, [...(variants.get(id) || []), target]);
            variants.set(target, [...(variants.get(target) || []), id]);
            assert.ok(files.get(id).relations.some(relation => relation.id === target && relation.role === type));
            assert.ok(files.get(target).relations.some(relation => relation.id === id && relation.role === type));
            assert.ok(files.get(id).diagnostics?.includes(`unresolved_variant_semantics:${field}:${row[field]}`), 'do not guess precise variant mode');
        }
    }
    assert.deepEqual(variant_counts, { CMEFDJHHIAI: 139, NMJEHOJJBGC: 461, BONBCELOAFJ: 18, AENKJPHOPNO: 68 });
    for (const [id, item] of files) {
        const expected = (variants.get(id) || []).sort();
        const role = item.type === 'costume' ? 'costume' : 'suit';
        const actual = item.relations.filter(relation => relation.role === role && relation.id.startsWith(`${item.type}-`)).map(relation => relation.id).sort();
        assert.deepEqual(actual, expected, `only source-pointer variants: ${id}`);
        assert.deepEqual(item.sections.filter(section => section.kind === 'variant').map(section => section.text).sort(), expected.map(target => files.get(target).name).sort());
    }
    assert.ok(!files.get('suit-265001').relations.some(relation => relation.id === 'suit-265002'), 'same names do not invent variant links');
    const has_image = (id, hash) => {
        if (typeof hash === 'number')
            assert.ok(Number.isSafeInteger(hash), `${id} resource precision`);
        assert.ok(files.get(id).images.some(image => image.name === String(hash)), `${id} retains ${hash}`);
    };
    for (const row of rows.costume)
        has_image(`costume-${row.costumeId}`, row.MPFOEFGJKAE);
    for (const row of rows.suit) {
        has_image(`suit-${row.suitId}`, row.iconHash);
        if (row.OLKBFAJMKNF !== undefined)
            has_image(`suit-${row.suitId}`, row.OLKBFAJMKNF);
        const expected = rows.costume.filter(costume => costume.suitId === row.suitId)
            .map(costume => `costume-${costume.costumeId}`).sort();
        const actual = files.get(`suit-${row.suitId}`).relations.filter(relation => relation.role === 'component')
            .map(relation => relation.id).sort();
        assert.deepEqual(actual, expected, `reverse suit membership: ${row.suitId}`);
        for (const id of expected)
            assert.ok(files.get(id).relations.some(relation => relation.id === `suit-${row.suitId}`));
    }
    assert.deepEqual(files.get('suit-265001').relations.filter(relation => relation.id.startsWith('costume-'))
        .map(relation => relation.id).sort(), ['costume-500101', 'costume-500102', 'costume-500103', 'costume-500105', 'costume-500112']);
    assert.ok(!files.get('suit-265001').relations.some(relation => relation.id === 'costume-262529'), 'preset is not membership');
    for (const row of rows.catalog) {
        const id = `catalog-${row.FHIDKAKGMFN}`;
        has_image(id, row.iconHash);
        const expected = row.BABILFMJJME.map((target) => files.has(`costume-${target}`) ? `costume-${target}` : `suit-${target}`).sort();
        assert.deepEqual(files.get(id).relations.map(relation => relation.id).sort(), expected);
        for (const target of expected)
            assert.ok(files.get(target).relations.some(relation => relation.id === id));
    }
    for (const row of rows.hall) {
        has_image(`hall-${row.OANKFNDIFGE}`, row.KEFEGFKMPAP);
        if (row.HPJNFBOHCKD)
            has_image(`hall-${row.OANKFNDIFGE}`, row.HPJNFBOHCKD);
        assert.equal(row.MFPAIDPNDCG, `BeyondHallArchive_${row.OANKFNDIFGE}`);
    }
    assert.deepEqual(result.files.filter(file => file.data.type === 'lore').map(file => file.id), Array.from({ length: 12 }, (_, index) => `lore-${1928 + index}`));
    for (let id = 1940; id <= 1948; id++)
        assert.ok(!files.has(`lore-${id}`), 'operational tip excluded');
    // Do not confuse BydMaterial IDs with their actual costume/suit/drawing targets.
    const material_operations = {
        BYD_MATERIAL_USE_GAIN_COSTUME: 'costume',
        BYD_MATERIAL_USE_GAIN_COSTUME_SUIT: 'suit',
        BYD_MATERIAL_USE_GAIN_TRIAL_COSTUME_SUIT: 'suit',
        BYD_MATERIAL_USE_GAIN_COSTUME_DRAWING: 'catalog',
    };
    for (const material of source_excel('BydMaterialExcelConfigData')) {
        for (const use of material.itemUse || []) {
            const type = material_operations[use.useOp];
            if (type && material.icon && files.has(`${type}-${use.useParam[0]}`))
                has_image(`${type}-${use.useParam[0]}`, material.icon);
        }
    }
    has_image('costume-552005', 'UI_Beyd_Avatar_Boy_Headwear_S0194'); // material ID is 280093
    // This trial outfit's icon is S0058, not a filename inferred from suit S0014.
    has_image('costume-1501401', 'UI_Beyd_Avatar_Girl_Top_S0058');
    assert.equal([...files.values()].filter(item => item.source.references?.some(ref => ref.startsWith('resource64:'))).length, 3492);
    for (const item of files.values()) for (const image of item.images.filter(image => image.kind === 'hash_icon')) {
        const hash = item.images.find(image => image.kind === 'icon' && /^\d+$/.test(image.name)).name;
        const evidence = [...files.values()].filter(other => other.images.some(ref => ref.kind === 'icon' && ref.name === hash));
        const names = new Set(evidence.flatMap(other => other.images.filter(ref => ref.kind === 'material_icon').map(ref => ref.name)));
        assert.equal(names.size, 1, 'hash bridge must have one unambiguous original material icon');
        assert(names.has(image.name));
    }
    assert.ok(!files.has('costume-280093'));
    assert.ok(files.get('suit-265348').description.includes('503'), 'numeric story prose retained');
    assert.equal(files.get('suit-265348').description.length, lang === 'en' ? 1579 : 476, 'full long story retained');
    assert.ok(files.get('suit-265348').description.includes('\\n\\n'), 'raw paragraph separators retained');
    assert.equal(files.get('suit-265001').name, files.get('suit-265002').name, 'same names are not synthesized');
    const diagnostics = result.files.flatMap(file => file.data.diagnostics || []);
    const missing_descriptions = diagnostics.filter(message => message.startsWith(`missing_text:${lang}:descriptionTextMapHash:`));
    assert.equal(missing_descriptions.length, 14, 'known empty skin-color descriptions remain explicit');
    assert.equal(diagnostics.filter(message => message.startsWith('absent_classification:')).length, 28);
    assert.equal(diagnostics.filter(message => message.startsWith('unresolved_classification:NIHIONHKJFH:')).length, 176);
    assert.equal(diagnostics.filter(message => message === 'unresolved_classification:LOPKMKDOKMM:All').length, 10);
    assert.equal(diagnostics.filter(message => message.startsWith('unresolved_variant_semantics:')).length, 686);
    assert.equal(diagnostics.length, 914, 'all known incomplete classifications/semantics diagnosed');
    assert.ok(!diagnostics.some(message => /^(?:missing_variant|unclosed_variant|invalid_classification|missing_classification_text):/.test(message)));
    assert.equal(files.get('costume-264101').description, '');
    assert.equal(result.files.reduce((sum, file) => sum + file.data.relations.length, 0), 6210);
    assert.equal(result.files.reduce((sum, file) => sum + file.data.sections.length, 0), 17237);
    console.log(JSON.stringify({ lang, files: result.files.length, counts,
        relations: result.files.reduce((sum, file) => sum + file.data.relations.length, 0),
        sections: result.files.reduce((sum, file) => sum + file.data.sections.length, 0), variant_pairs: 686,
        images: result.files.reduce((sum, file) => sum + file.data.images.length, 0),
        available_images: result.files.flatMap(file => file.data.images).filter(image => image.url).length,
        missing_descriptions: missing_descriptions.length, diagnostics: diagnostics.length,
    }));
}
assert.deepEqual(results.get('zh_hans').files.map(file => file.id), results.get('en').files.map(file => file.id), 'identical bilingual IDs');
assert.deepEqual(results.get('zh_hans').files.map(file => file.data.relations.map(({ category, id, role }) => ({ category, id, role }))), results.get('en').files.map(file => file.data.relations.map(({ category, id, role }) => ({ category, id, role }))), 'identical bilingual relation keys');
console.log('Miliastra checks passed (no formal JSON exports generated).');
