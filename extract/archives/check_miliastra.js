// Raw-source assertions live with extraction, not with Wiki page generation.
const assert = require('node:assert/strict');
const { get_miliastra_export } = require('./miliastra');
const { source_excel, source_text } = require('./archiveSource');
const { resolveMiliastraFields } = require('./fields');
const fields = resolveMiliastraFields(source_excel);
// Check source references only; actual PNG availability belongs to the consumer.
const sources = {
    costume: { table: 'BeyondCostumeExcelConfigData', id: 'costumeId', name: 'nameTextMapHash', description: 'descriptionTextMapHash' },
    suit: { table: 'BeyondCostumeSuitExcelConfigData', id: 'suitId', name: 'nameTextMapHash', description: 'descriptionTextMapHash' },
    catalog: { table: 'BeyondCostumeDrawingExcelConfigData', id: fields.catalog_id, name: 'nameTextMapHash', description: 'descTextMapHash' },
    lore: { table: 'LoadingTipsExcelConfigData', id: 'id', name: 'tipsTitleTextMapHash', description: 'tipsDescTextMapHash' },
    hall: { table: 'BeyondHallExcelConfigData', id: fields.hall_id, name: fields.hall_name, description: fields.hall_description },
};
const rows = Object.fromEntries(Object.entries(sources).map(([type, source]) => [type,
    source_excel(source.table).filter(row => type !== 'lore' || row.stageID === '91' && row.id >= 1928 && row.id <= 1939),
]));
const counts = Object.fromEntries(Object.entries(rows).map(([type, values]) => [type, values.length]));
const expected_ids = Object.entries(rows).flatMap(([type, values]) => values.map(row => `${type}-${row[sources[type].id]}`));
const manual = new Map(source_excel('ManualTextMapConfigData').map(row => [row.textMapId, row.textMapContentTextMapHash]));
const ui_entries = new Map(source_excel('BeyondCostumeUIEntryExcelConfigData').map(row => [row.configID, row]));
const ui_slots = source_excel('BeyondCostumeUISlotEntryExcelConfigData');
const slots = new Map(ui_slots.filter(row => row.slotType).map(row => [row.slotType, row]));
const colors = new Map(source_excel('BydCostumeColorTagExcelConfigData').map(row => [row[fields.color_tag], row[fields.color_name]]));
// Unsafe integer anchors must be strings, not rounded floating-point numbers.
assert.equal(rows.costume.find(row => row.costumeId === 260002)[fields.costume_icon], '14425841620430768778');
assert.equal(rows.suit.find(row => row.suitId === 265001).iconHash, '2417760002026327459');
assert.equal(rows.suit.find(row => row.suitId === 265044)[fields.suit_extra_image], '10709550370493609764');
assert.equal(rows.catalog.find(row => row[fields.catalog_id] === 270001).iconHash, '3806693058812336722');
const results = new Map();
for (const lang of ['zh_hans', 'en']) {
    const result = get_miliastra_export(lang);
    results.set(lang, result);
    const files = new Map(result.files.map(file => [file.id, file.data]));
    const pages = new Map(result.list.map(page => [page.id, page]));
    assert.equal(result.files.length, expected_ids.length);
    assert.deepEqual([...files.keys()].sort(), [...expected_ids].sort(), 'exact source-qualified data IDs');
    assert.deepEqual([...pages.keys()].sort(), [...expected_ids].sort(), 'exact source-qualified page IDs');
    const expected_diagnostics = new Map(result.files.map(file => [file.id, []]));
    const expect_diagnostic = (id, message) => expected_diagnostics.get(id).push(message);
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
            for (const field of [source.name, source.description]) if (!source_text(lang, row[field]))
                expect_diagnostic(id, `missing_text:${lang}:${field}:${row[field]}`);
        }
    }
    const expected_sections = new Map();
    const check_sections = (id, kind, expected) => {
        assert.deepEqual(files.get(id).sections.filter(section => section.kind === kind).map(section => section.text), expected, `${lang}:${id}:${kind}`);
        expected_sections.set(`${id}:${kind}`, expected.length);
    };
    for (const row of rows.costume) {
        const expected = new Map();
        for (const group of row[fields.slot_groups]) for (const slot of group[fields.slots] || []) {
            const label = slots.get(slot), parent = ui_entries.get({ Costume: 1, Appearance: 2 }[label?.[fields.slot_category]]);
            if (parent) expected.set(String(label.configID), { id: String(label.configID), group_id: String(parent.configID),
                group_name: source_text(lang, parent.nameTextMapHash), name: source_text(lang, label.nameTextMapHash) });
        }
        assert.deepEqual(files.get(`costume-${row.costumeId}`).classifications, [...expected.values()], 'classification paths follow source slots');
    }
    assert.equal([...files.values()].filter(item => item.type === 'costume' && !item.classifications.length).length,
        rows.costume.filter(row => !row[fields.slot_groups].some(group => (group[fields.slots] || [])
            .some(slot => ui_entries.has({ Costume: 1, Appearance: 2 }[slots.get(slot)?.[fields.slot_category]])))).length);
    const text = (hash) => source_text(lang, hash);
    const body_labels = { BODY_GIRL: 'UI_BEYOND_GH_PREVIEW_GIRL_TAB', BODY_BOY: 'UI_BEYOND_GH_PREVIEW_BOY_TAB' };
    const quality_labels = {
        Green: 'UI_BEYOND_COSTUME_GREEN', Blue: 'UI_BEYOND_COSTUME_BLUE',
        Purple: 'UI_BEYOND_COSTUME_PURPLE', Orange: 'UI_BEYOND_COSTUME_ORANGE',
    };
    for (const type of ['costume', 'suit', 'catalog']) {
        for (const row of rows[type]) {
            const id = `${type}-${row[sources[type].id]}`;
            if (row[fields.quality[type]] === undefined) expect_diagnostic(id, `absent_classification:${fields.quality[type]}`);
            check_sections(id, 'quality', row[fields.quality[type]] ? [text(manual.get(quality_labels[row[fields.quality[type]]]))] : []);
            if (type === 'catalog') {
                for (const kind of ['body_type', 'slot', 'color', 'category'])
                    check_sections(id, kind, []);
                continue;
            }
            for (const field of [fields.body_types[type], fields.colors[type]])
                if (row[field] === undefined) expect_diagnostic(id, `absent_classification:${field}`);
            check_sections(id, 'body_type', [row[fields.body_types[type]].map((body) => text(manual.get(body_labels[body]))).join('\n')]);
            check_sections(id, 'color', row[fields.colors[type]] ? [row[fields.colors[type]].map((color) => text(colors.get(color))).join('\n')] : []);
            const category_ids = { Costume: 1, Appearance: 2 };
            const categories = new Set();
            let expected_slots;
            if (type === 'suit') {
                const label = ui_slots.find(slot => slot.configID === 1);
                expected_slots = [text(label.nameTextMapHash)];
                categories.add(label[fields.slot_category]);
            }
            else {
                expected_slots = row[fields.slot_groups].flatMap((group, index) => {
                    const names = [];
                    for (const slot of group[fields.slots] || []) {
                        const label = slots.get(slot);
                        if (!label) {
                            assert.ok(files.get(id).diagnostics?.includes(`unresolved_classification:${fields.slot_groups}:${index}:${slot}`));
                            expect_diagnostic(id, `unresolved_classification:${fields.slot_groups}:${index}:${slot}`);
                            continue;
                        }
                        names.push(text(label.nameTextMapHash));
                        if (label[fields.slot_category])
                            categories.add(label[fields.slot_category]);
                        else {
                            assert.ok(files.get(id).diagnostics?.includes(`unresolved_classification:${fields.slot_category}:${slot}`));
                            expect_diagnostic(id, `unresolved_classification:${fields.slot_category}:${slot}`);
                        }
                    }
                    return names.length ? [names.join('\n')] : [];
                });
            }
            check_sections(id, 'slot', expected_slots);
            check_sections(id, 'category', categories.size ? [[...categories].map(category => text(ui_entries.get(category_ids[category]).nameTextMapHash)).join('\n')] : []);
            for (const hash of [...row[fields.body_types[type]].map((body) => manual.get(body_labels[body])),
                ...(row[fields.colors[type]] || []).map((color) => colors.get(color))]) {
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
    for (const [type, field] of [['costume', fields.costume_variant_group], ['costume', fields.costume_source], ['suit', fields.suit_variant_group], ['suit', fields.suit_source]]) {
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
            expect_diagnostic(id, `unresolved_variant_semantics:${field}:${row[field]}`);
        }
    }
    const variant_pairs = Object.values(variant_counts).reduce((sum, count) => sum + count, 0);
    for (const [id, item] of files) {
        const expected = (variants.get(id) || []).sort();
        const role = item.type === 'costume' ? 'costume' : 'suit';
        const actual = item.relations.filter(relation => relation.role === role && relation.id.startsWith(`${item.type}-`)).map(relation => relation.id).sort();
        assert.deepEqual(actual, expected, `only source-pointer variants: ${id}`);
        const variant_sections = item.sections.filter(section => section.kind === 'variant').map(section => section.text);
        assert.deepEqual([...variant_sections].sort(), expected.map(target => files.get(target).name).sort());
        expected_sections.set(`${id}:variant`, expected.length);
    }
    assert.ok(!files.get('suit-265001').relations.some(relation => relation.id === 'suit-265002'), 'same names do not invent variant links');
    const has_image = (id, hash) => {
        if (typeof hash === 'number')
            assert.ok(Number.isSafeInteger(hash), `${id} resource precision`);
        assert.ok(files.get(id).images.some(image => image.name === String(hash)), `${id} retains ${hash}`);
    };
    for (const row of rows.costume)
        has_image(`costume-${row.costumeId}`, row[fields.costume_icon]);
    for (const row of rows.suit) {
        has_image(`suit-${row.suitId}`, row.iconHash);
        if (row[fields.suit_extra_image] !== undefined)
            has_image(`suit-${row.suitId}`, row[fields.suit_extra_image]);
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
        const id = `catalog-${row[fields.catalog_id]}`;
        has_image(id, row.iconHash);
        const expected = row[fields.catalog_targets].map((target) => files.has(`costume-${target}`) ? `costume-${target}` : `suit-${target}`).sort();
        assert.deepEqual(files.get(id).relations.map(relation => relation.id).sort(), expected);
        for (const target of expected)
            assert.ok(files.get(target).relations.some(relation => relation.id === id));
    }
    for (const row of rows.hall) {
        has_image(`hall-${row[fields.hall_id]}`, row[fields.hall_image]);
        if (row[fields.hall_preview])
            has_image(`hall-${row[fields.hall_id]}`, row[fields.hall_preview]);
        assert.equal(row[fields.hall_archive], `BeyondHallArchive_${row[fields.hall_id]}`);
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
    const primary_resources = counts.costume + counts.suit + counts.catalog;
    assert.equal([...files.values()].filter(item => item.images.some(image => image.kind === 'icon' && /^\d+$/.test(image.name))).length, primary_resources);
    assert.equal([...files.values()].filter(item => item.source.references?.some(ref => ref.startsWith('resource64:'))).length,
        primary_resources, 'all primary resource references have verified native provenance');
    for (const item of files.values()) for (const image of item.images.filter(image => image.kind === 'hash_icon')) {
        const hash = item.images.find(image => image.kind === 'icon' && /^\d+$/.test(image.name)).name;
        const evidence = [...files.values()].filter(other => other.images.some(ref => ref.kind === 'icon' && ref.name === hash));
        const names = new Set(evidence.flatMap(other => other.images.filter(ref => ref.kind === 'material_icon').map(ref => ref.name)));
        assert.equal(names.size, 1, 'hash bridge must have one unambiguous original material icon');
        assert(names.has(image.name));
    }
    assert.ok(!files.has('costume-280093'));
    assert.ok(files.get('suit-265348').description.includes('503'), 'numeric story prose retained');
    assert.equal(files.get('suit-265348').description, source_text(lang, rows.suit.find(row => row.suitId === 265348).descriptionTextMapHash), 'full long story retained');
    assert.ok(files.get('suit-265348').description.includes('\\n\\n'), 'raw paragraph separators retained');
    assert.equal(files.get('suit-265001').name, files.get('suit-265002').name, 'same names are not synthesized');
    const diagnostics = result.files.flatMap(file => file.data.diagnostics || []);
    const missing_descriptions = diagnostics.filter(message => message.startsWith(`missing_text:${lang}:descriptionTextMapHash:`));
    for (const [id, expected] of expected_diagnostics) assert.deepEqual([...(files.get(id).diagnostics || [])].sort(),
        [...expected].sort(), `${id}: all source absences and unknown semantics diagnosed, no extras`);
    assert.ok(!diagnostics.some(message => /^(?:missing_variant|unclosed_variant|invalid_classification|missing_classification_text):/.test(message)));
    assert.equal(files.get('costume-264101').description, '');
    const membership_pairs = rows.costume.filter(row => row.suitId !== undefined && files.has(`suit-${row.suitId}`)).length;
    const catalog_pairs = rows.catalog.reduce((sum, row) => sum + new Set(row[fields.catalog_targets]).size, 0);
    assert.equal(result.files.reduce((sum, file) => sum + file.data.relations.length, 0), 2 * (membership_pairs + catalog_pairs + variant_pairs));
    assert.equal(result.files.reduce((sum, file) => sum + file.data.sections.length, 0), [...expected_sections.values()].reduce((sum, count) => sum + count, 0));
    console.log(JSON.stringify({ lang, files: result.files.length, counts,
        relations: result.files.reduce((sum, file) => sum + file.data.relations.length, 0),
        sections: result.files.reduce((sum, file) => sum + file.data.sections.length, 0), variant_pairs,
        images: result.files.reduce((sum, file) => sum + file.data.images.length, 0),
        available_images: result.files.flatMap(file => file.data.images).filter(image => image.url).length,
        missing_descriptions: missing_descriptions.length, diagnostics: diagnostics.length,
    }));
}
assert.deepEqual(results.get('zh_hans').files.map(file => file.id), results.get('en').files.map(file => file.id), 'identical bilingual IDs');
assert.deepEqual(results.get('zh_hans').files.map(file => file.data.relations.map(({ category, id, role }) => ({ category, id, role }))), results.get('en').files.map(file => file.data.relations.map(({ category, id, role }) => ({ category, id, role }))), 'identical bilingual relation keys');
console.log('Miliastra checks passed (no formal JSON exports generated).');
