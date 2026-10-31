// Source extraction belongs here; wiki-data consumes the exported genshin-db records.
const { archive_image, source_excel, source_text, make_archive_item, archive_export } = require('./archiveSource');
const { resourceIcon } = require('../../resources/miliastra');
const tables = {
    costume: 'BeyondCostumeExcelConfigData',
    suit: 'BeyondCostumeSuitExcelConfigData',
    catalog: 'BeyondCostumeDrawingExcelConfigData',
    lore: 'LoadingTipsExcelConfigData',
    hall: 'BeyondHallExcelConfigData',
};
// Explicit mappings for this source revision, checked against independent anchors below.
// FKLBIDGKEJK is a preset outfit, NOT the complete membership of a suit.
const fields = {
    costume_icon: 'MPFOEFGJKAE',
    suit_extra_image: 'OLKBFAJMKNF',
    catalog_id: 'FHIDKAKGMFN',
    catalog_targets: 'BABILFMJJME',
    hall_id: 'OANKFNDIFGE',
    hall_name: 'NOBNAHLBFEG',
    hall_description: 'HOCAJGPPDII',
    hall_archive: 'MFPAIDPNDCG',
    hall_image: 'KEFEGFKMPAP',
    hall_preview: 'HPJNFBOHCKD',
    body_types: 'JKOKOGCFAKF',
    colors: 'AAFJPEDPGJE',
    quality: 'NGHBBIBFLBC',
    slot_groups: 'NIHIONHKJFH',
    slots: 'NIGAGANHPHI',
    slot_category: 'LOPKMKDOKMM',
    color_name: 'GLOCLKABHBC',
    costume_variant_group: 'CMEFDJHHIAI',
    costume_source: 'NMJEHOJJBGC',
    suit_variant_group: 'BONBCELOAFJ',
    suit_source: 'AENKJPHOPNO',
};
function source_id(value, context) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`Invalid Miliastra source ID: ${context}: ${String(value)}`);
    }
    return value;
}
function resource_hash(value, context) {
    // Do not stringify an already-rounded Number and silently publish a different resource.
    if (typeof value === 'number' && !Number.isSafeInteger(value)) {
        throw new Error(`Imprecise Miliastra resource hash: ${context}; source_excel must preserve the original integer`);
    }
    const hash = String(value);
    if (!/^\d+$/.test(hash))
        throw new Error(`Invalid Miliastra resource hash: ${context}: ${hash}`);
    return hash;
}
function index_rows(rows, key, table) {
    const index = new Map();
    for (const row of rows) {
        const id = source_id(row[key], `${table}.${key}`);
        if (index.has(id))
            throw new Error(`Duplicate Miliastra source ID: ${table}:${id}`);
        index.set(id, row);
    }
    return index;
}
function anchor(index, id, expected, table) {
    const row = index.get(id);
    for (const [key, value] of Object.entries(expected)) {
        if (!row || JSON.stringify(row[key]) !== JSON.stringify(value)) {
            throw new Error(`Miliastra field anchor changed: ${table}:${id}.${key}`);
        }
    }
}
function diagnose(item, message) {
    (item.diagnostics ||= []).push(message);
}
function add_image(file, reference, kind) {
    if (!reference || file.data.images.some(image => image.name === reference))
        return;
    const image = archive_image(reference, 'miliastra', file.id, kind);
    if (image)
        file.data.images.push(image);
}
function relate(from, to, role) {
    if (from.data.relations.some(relation => relation.id === to.id && relation.role === role))
        return;
    from.data.relations.push({ category: 'miliastra', id: to.id, name: to.data.name, role });
}
function get_miliastra_export(lang) {
    const costumes = index_rows(source_excel(tables.costume), 'costumeId', tables.costume);
    const suits = index_rows(source_excel(tables.suit), 'suitId', tables.suit);
    const catalogs = index_rows(source_excel(tables.catalog), fields.catalog_id, tables.catalog);
    const halls = index_rows(source_excel(tables.hall), fields.hall_id, tables.hall);
    const tips = index_rows(source_excel(tables.lore), 'id', tables.lore);
    const ui_entries = index_rows(source_excel('BeyondCostumeUIEntryExcelConfigData'), 'configID', 'BeyondCostumeUIEntryExcelConfigData');
    const ui_slots = index_rows(source_excel('BeyondCostumeUISlotEntryExcelConfigData'), 'configID', 'BeyondCostumeUISlotEntryExcelConfigData');
    const slot_names = new Map([...ui_slots.values()].filter(row => row.slotType).map(row => [row.slotType, row]));
    const color_names = new Map(source_excel('BydCostumeColorTagExcelConfigData').map(row => [row[fields.colors], row]));
    const manual = new Map(source_excel('ManualTextMapConfigData').map(row => [row.textMapId, row]));
    anchor(costumes, 260001, { nameTextMapHash: 2098177674, descriptionTextMapHash: 33590983 }, tables.costume);
    anchor(costumes, 500101, { suitId: 265001 }, tables.costume);
    anchor(costumes, 260001, { JKOKOGCFAKF: ['BODY_GIRL'], AAFJPEDPGJE: ['White'],
        NIHIONHKJFH: [{ NIGAGANHPHI: ['UpperCloth'] }, {}], NGHBBIBFLBC: 'Green' }, tables.costume);
    anchor(costumes, 504601, { CMEFDJHHIAI: 504401, suitId: 265046 }, tables.costume);
    anchor(costumes, 1501401, { NMJEHOJJBGC: 501401, suitId: 1265014 }, tables.costume);
    anchor(suits, 265001, { nameTextMapHash: 2405268140, descriptionTextMapHash: 1780222704 }, tables.suit);
    anchor(suits, 265046, { BONBCELOAFJ: 265044 }, tables.suit);
    anchor(suits, 1265014, { AENKJPHOPNO: 265014 }, tables.suit);
    anchor(ui_entries, 1, { nameTextMapHash: 1229270749 }, 'BeyondCostumeUIEntryExcelConfigData');
    anchor(ui_entries, 2, { nameTextMapHash: 1555233741 }, 'BeyondCostumeUIEntryExcelConfigData');
    anchor(ui_slots, 1, { nameTextMapHash: 1529563972, LOPKMKDOKMM: 'Costume' }, 'BeyondCostumeUISlotEntryExcelConfigData');
    anchor(ui_slots, 2, { slotType: 'UpperCloth', nameTextMapHash: 2093996, LOPKMKDOKMM: 'Costume' }, 'BeyondCostumeUISlotEntryExcelConfigData');
    anchor(ui_slots, 16, { slotType: 'Hairstyle', nameTextMapHash: 2235062916, LOPKMKDOKMM: 'Appearance' }, 'BeyondCostumeUISlotEntryExcelConfigData');
    if (color_names.get('White')?.[fields.color_name] !== 4150001616
        || manual.get('UI_BEYOND_GH_PREVIEW_GIRL_TAB')?.textMapContentTextMapHash !== 609493285
        || manual.get('UI_BEYOND_GH_PREVIEW_BOY_TAB')?.textMapContentTextMapHash !== 3827955177
        || manual.get('UI_BEYOND_COSTUME_GREEN')?.textMapContentTextMapHash !== 17359971) {
        throw new Error('Miliastra classification text anchors changed');
    }
    anchor(catalogs, 270001, { BABILFMJJME: [260001], nameTextMapHash: 2308662065 }, tables.catalog);
    anchor(halls, 1, {
        NOBNAHLBFEG: 1209932345, HOCAJGPPDII: 3795565332,
        MFPAIDPNDCG: 'BeyondHallArchive_1', KEFEGFKMPAP: 'UI_Beyd_HallThemeImg_Mnjc',
        HPJNFBOHCKD: 'UI_Beyd_HallThemePic_Mnjc',
    }, tables.hall);
    anchor(tips, 1928, { stageID: '91', tipsTitleTextMapHash: 1999678687, tipsDescTextMapHash: 3996501198 }, tables.lore);
    if (resource_hash(costumes.get(260002)?.[fields.costume_icon], 'costume:260002') !== '14425841620430768778'
        || resource_hash(suits.get(265001)?.iconHash, 'suit:265001') !== '2417760002026327459'
        || resource_hash(catalogs.get(270001)?.iconHash, 'catalog:270001') !== '3806693058812336722'
        || resource_hash(suits.get(265044)?.[fields.suit_extra_image], 'suit:265044') !== '10709550370493609764') {
        throw new Error('Miliastra resource hash anchors changed');
    }
    const files = [];
    const by_id = new Map();
    const create = (type, id, row, name_key, description_key, images = []) => {
        for (const key of [name_key, description_key]) {
            if (!/^(?:0|[1-9]\d*)$/.test(String(row[key]))) {
                throw new Error(`Missing Miliastra text hash field: ${tables[type]}:${id}.${key}`);
            }
        }
        const name = source_text(lang, row[name_key]);
        const description = source_text(lang, row[description_key]);
        const data = make_archive_item(tables[type], id, type, name, description, [row[name_key], row[description_key], ...images.map(image => image.reference).filter(value => value && /^\d+$/.test(value))]);
        const file = { id: `${type}-${id}`, data };
        // Missing translations never change the source-based membership or invent a title.
        if (!name)
            diagnose(data, `missing_text:${lang}:${name_key}:${row[name_key]}`);
        if (!description)
            diagnose(data, `missing_text:${lang}:${description_key}:${row[description_key]}`);
        for (const image of images)
            add_image(file, image.reference, image.kind);
        files.push(file);
        by_id.set(file.id, file);
        return file;
    };
    for (const [id, row] of costumes) {
        create('costume', id, row, 'nameTextMapHash', 'descriptionTextMapHash', [
            { reference: resource_hash(row[fields.costume_icon], `costume:${id}`), kind: 'icon' },
        ]);
    }
    for (const [id, row] of suits) {
        const images = [{ reference: resource_hash(row.iconHash, `suit:${id}`), kind: 'icon' }];
        if (row[fields.suit_extra_image] !== undefined)
            images.push({
                reference: resource_hash(row[fields.suit_extra_image], `suit:${id}.${fields.suit_extra_image}`), kind: 'resource',
            });
        // The description contains both the introductory paragraph and the full story.
        // Keep the raw TextMap string, including literal \n, formatting, and numeric prose.
        create('suit', id, row, 'nameTextMapHash', 'descriptionTextMapHash', images);
    }
    for (const [id, row] of catalogs) {
        create('catalog', id, row, 'nameTextMapHash', 'descTextMapHash', [
            { reference: resource_hash(row.iconHash, `catalog:${id}`), kind: 'icon' },
        ]);
    }
    // The nine operational tips (1940–1948) are intentionally not archive lore.
    for (let id = 1928; id <= 1939; id++) {
        const row = tips.get(id);
        if (!row || row.stageID !== '91')
            throw new Error(`Miliastra lore scope changed: ${id}`);
        create('lore', id, row, 'tipsTitleTextMapHash', 'tipsDescTextMapHash');
    }
    for (const [id, row] of halls) {
        if (row[fields.hall_archive] !== `BeyondHallArchive_${id}`) {
            throw new Error(`Miliastra hall ID/archive mismatch: ${id}`);
        }
        for (const key of [fields.hall_image, fields.hall_preview]) {
            if (row[key] !== undefined && typeof row[key] !== 'string') {
                throw new Error(`Invalid Miliastra hall image field: ${id}.${key}`);
            }
        }
        const file = create('hall', id, row, fields.hall_name, fields.hall_description, [
            { reference: row[fields.hall_image], kind: 'theme' },
            { reference: row[fields.hall_preview], kind: 'preview' },
        ]);
        const theme = row[fields.hall_image], preview = row[fields.hall_preview];
        if (theme?.startsWith('UI_Beyd_HallThemeImg_') && preview === theme.replace('UI_Beyd_HallThemeImg_', 'UI_Beyd_HallThemePic_')) {
            file.data.images.find(image => image.kind === 'preview').replaces = theme;
        }
    }
    const titles = {
        category: ['分类', 'Category'], body_type: ['适用体型', 'Body type'],
        color: ['色系', 'Color scheme'], quality: ['品阶', 'Quality'], slot: ['部件类型', 'Costume slots'],
        variant: ['源关联变体', 'Source-linked variants'],
    };
    const section = (file, kind, hashes) => {
        if (!hashes.length)
            return;
        const text = hashes.map(hash => {
            if (!file.data.source.hashes.includes(String(hash)))
                file.data.source.hashes.push(String(hash));
            const value = source_text(lang, hash);
            if (!value)
                diagnose(file.data, `missing_classification_text:${lang}:${kind}:${hash}`);
            return value;
        }).join('\n');
        file.data.sections.push({ kind, title: titles[kind][lang === 'en' ? 1 : 0], text });
    };
    const manual_hash = (file, key) => {
        const row = manual.get(key);
        if (!row) {
            diagnose(file.data, `unresolved_classification:ManualTextMap:${key}`);
            return [];
        }
        return [row.textMapContentTextMapHash];
    };
    const category_entries = { Costume: 1, Appearance: 2 };
    const bodies = { BODY_GIRL: 'UI_BEYOND_GH_PREVIEW_GIRL_TAB', BODY_BOY: 'UI_BEYOND_GH_PREVIEW_BOY_TAB' };
    const qualities = {
        Green: 'UI_BEYOND_COSTUME_GREEN', Blue: 'UI_BEYOND_COSTUME_BLUE',
        Purple: 'UI_BEYOND_COSTUME_PURPLE', Orange: 'UI_BEYOND_COSTUME_ORANGE',
    };
    const tags = (file, row, field) => {
        if (row[field] === undefined) {
            diagnose(file.data, `absent_classification:${field}`);
            return [];
        }
        if (!Array.isArray(row[field]) || !row[field].every(value => typeof value === 'string')) {
            diagnose(file.data, `invalid_classification:${field}`);
            return [];
        }
        return row[field];
    };
    for (const [type, rows] of [['costume', costumes], ['suit', suits], ['catalog', catalogs]]) {
        for (const [id, row] of rows) {
            const file = by_id.get(`${type}-${id}`);
            if (type === 'costume') file.data.classifications = [];
            if (row[fields.quality] === undefined)
                diagnose(file.data, `absent_classification:${fields.quality}`);
            else {
                const key = qualities[row[fields.quality]];
                if (key)
                    section(file, 'quality', manual_hash(file, key));
                else
                    diagnose(file.data, `unresolved_classification:${fields.quality}:${row[fields.quality]}`);
            }
            // Catalogs have no body/color/slot fields of their own; their targets remain linked.
            if (type === 'catalog')
                continue;
            section(file, 'body_type', tags(file, row, fields.body_types).flatMap(body => {
                if (bodies[body])
                    return manual_hash(file, bodies[body]);
                diagnose(file.data, `unresolved_classification:${fields.body_types}:${body}`);
                return [];
            }));
            section(file, 'color', tags(file, row, fields.colors).flatMap(color => {
                const label = color_names.get(color);
                if (label)
                    return [label[fields.color_name]];
                diagnose(file.data, `unresolved_classification:${fields.colors}:${color}`);
                return [];
            }));
            const categories = new Set();
            if (type === 'suit') {
                section(file, 'slot', [ui_slots.get(1).nameTextMapHash]);
                categories.add(ui_slots.get(1)[fields.slot_category]);
            }
            else if (Array.isArray(row[fields.slot_groups])) {
                // Preserve source group boundaries. Do not reinterpret multiple groups
                // as simultaneous equipment, and do not give the unmapped None a label.
                for (const [group_id, group] of row[fields.slot_groups].entries()) {
                    if (group && typeof group === 'object' && !Object.keys(group).length)
                        continue;
                    if (!group || typeof group !== 'object') {
                        diagnose(file.data, `invalid_classification:${fields.slot_groups}:${group_id}`);
                        continue;
                    }
                    const hashes = tags(file, group, fields.slots).flatMap(slot => {
                        const label = slot_names.get(slot);
                        if (!label) {
                            diagnose(file.data, `unresolved_classification:${fields.slot_groups}:${group_id}:${slot}`);
                            return [];
                        }
                        const parent = ui_entries.get(category_entries[label[fields.slot_category]]);
                        if (type === 'costume' && parent && !file.data.classifications.some(value => value.id === String(label.configID))) {
                            file.data.classifications.push({ id: String(label.configID), group_id: String(parent.configID),
                                group_name: source_text(lang, parent.nameTextMapHash), name: source_text(lang, label.nameTextMapHash) });
                        }
                        if (label[fields.slot_category])
                            categories.add(label[fields.slot_category]);
                        else
                            diagnose(file.data, `unresolved_classification:${fields.slot_category}:${slot}`);
                        return [label.nameTextMapHash];
                    });
                    section(file, 'slot', hashes);
                }
            }
            else
                diagnose(file.data, `invalid_classification:${fields.slot_groups}`);
            section(file, 'category', [...categories].flatMap(category => {
                const entry = ui_entries.get(category_entries[category]);
                if (entry)
                    return [entry.nameTextMapHash];
                diagnose(file.data, `unresolved_classification:${fields.slot_category}:${category}`);
                return [];
            }));
        }
    }
    // The reverse suitId link is authoritative, including the non-preset components.
    for (const [id, row] of costumes) {
        if (row.suitId === undefined)
            continue;
        const costume = by_id.get(`costume-${id}`);
        const suit = by_id.get(`suit-${source_id(row.suitId, `costume:${id}.suitId`)}`);
        if (!suit) {
            diagnose(costume.data, `missing_suit:${row.suitId}`);
            continue;
        }
        relate(suit, costume, 'component');
        relate(costume, suit, 'suit');
    }
    for (const [id, row] of catalogs) {
        const catalog = by_id.get(`catalog-${id}`);
        if (!Array.isArray(row[fields.catalog_targets]) || !row[fields.catalog_targets].length) {
            throw new Error(`Invalid Miliastra catalog target field: ${id}.${fields.catalog_targets}`);
        }
        for (const target of row[fields.catalog_targets]) {
            const target_id = source_id(target, `catalog:${id}.${fields.catalog_targets}`);
            const costume = by_id.get(`costume-${target_id}`) || by_id.get(`suit-${target_id}`);
            if (!costume) {
                diagnose(catalog.data, `missing_catalog_target:${target_id}`);
                continue;
            }
            relate(catalog, costume, 'costume');
            relate(costume, catalog, 'catalog');
        }
    }
    for (const variant of [
        { type: 'costume', rows: costumes, field: fields.costume_variant_group, group: true, suit_field: fields.suit_variant_group },
        { type: 'costume', rows: costumes, field: fields.costume_source, group: false, suit_field: fields.suit_source },
        { type: 'suit', rows: suits, field: fields.suit_variant_group, group: true },
        { type: 'suit', rows: suits, field: fields.suit_source, group: false },
    ]) {
        for (const [id, row] of variant.rows) {
            if (row[variant.field] === undefined || row[variant.field] === id)
                continue;
            const file = by_id.get(`${variant.type}-${id}`);
            const target_id = source_id(row[variant.field], `${file.id}.${variant.field}`);
            const target = variant.rows.get(target_id);
            if (!target) {
                diagnose(file.data, `missing_variant:${variant.field}:${target_id}`);
                continue;
            }
            if (JSON.stringify(row[fields.body_types]) !== JSON.stringify(target[fields.body_types])
                || variant.group && target[variant.field] !== target_id
                || variant.type === 'costume' && suits.get(row.suitId)?.[variant.suit_field] !== target.suitId) {
                diagnose(file.data, `unclosed_variant:${variant.field}:${target_id}`);
                continue;
            }
            const other = by_id.get(`${variant.type}-${target_id}`);
            // Keep the four frontend role keys; variant-specific context belongs in
            // sections. Names are source text, not synthesized names for duplicate items.
            relate(file, other, variant.type);
            relate(other, file, variant.type);
            section(file, 'variant', [target.nameTextMapHash]);
            section(other, 'variant', [row.nameTextMapHash]);
            // The ID linkage closes, but these obfuscated fields do not prove the
            // precise mode (e.g. recolor vs. refinement, or all trial unlock rules).
            diagnose(file.data, `unresolved_variant_semantics:${variant.field}:${target_id}`);
        }
    }
    // BydMaterial is only an icon bridge. It is not an additional archive category,
    // and neither costs, balance values, consumables nor unrelated assets are exported.
    const operations = {
        BYD_MATERIAL_USE_GAIN_COSTUME: 'costume',
        BYD_MATERIAL_USE_GAIN_COSTUME_SUIT: 'suit',
        BYD_MATERIAL_USE_GAIN_TRIAL_COSTUME_SUIT: 'suit',
        BYD_MATERIAL_USE_GAIN_COSTUME_DRAWING: 'catalog',
    };
    for (const material of source_excel('BydMaterialExcelConfigData')) {
        for (const use of material.itemUse || []) {
            const type = operations[use.useOp];
            if (!type || !/^\d+$/.test(use.useParam?.[0] || ''))
                continue;
            const file = by_id.get(`${type}-${use.useParam[0]}`);
            if (file && typeof material.icon === 'string')
                add_image(file, material.icon, 'material_icon');
        }
    }
    // Catalogs share their resource with the target costume; retain actual target
    // icon names too, so an extracted PNG can be used without fabricating a URL.
    for (const [id, row] of catalogs) {
        const catalog = by_id.get(`catalog-${id}`);
        for (const target of row[fields.catalog_targets]) {
            const costume = by_id.get(`costume-${target}`) || by_id.get(`suit-${target}`);
            for (const image of costume?.data.images || []) {
                if (image.kind === 'material_icon')
                    add_image(catalog, image.name, 'costume_icon');
            }
        }
    }
    // An identical primary resource hash is stronger evidence than a translated
    // name or variant FK. Only bridge hashes with one unambiguous material name.
    const icon_names = new Map();
    for (const file of files) {
        const hash = file.data.images.find(image => image.kind === 'icon' && /^\d+$/.test(image.name))?.name;
        if (!hash) continue;
        for (const image of file.data.images.filter(image => image.kind === 'material_icon')) {
            if (!icon_names.has(hash)) icon_names.set(hash, new Set());
            icon_names.get(hash).add(image.name);
        }
    }
    for (const file of files) {
        const hash = file.data.images.find(image => image.kind === 'icon' && /^\d+$/.test(image.name))?.name;
        const names = icon_names.get(hash);
        if (names?.size === 1 && !file.data.images.some(image => image.kind === 'material_icon'))
            add_image(file, [...names][0], 'hash_icon');
    }
    // Full UInt64 -> native subasset -> exact block/offset -> main Sprite.
    // Retain the numeric reference for auditing; never infer names from outfit IDs.
    for (const file of files) {
        const hash = file.data.images.find(image => image.kind === 'icon' && /^\d+$/.test(image.name))?.name;
        if (!hash) continue;
        const resolved = resourceIcon(hash);
        add_image(file, resolved.image.Name, 'resource_icon');
        file.data.source.references = [...(file.data.source.references || []),
            `resource64:${hash};subasset:${resolved.subAssetId};block:${resolved.pack.block};offset:${resolved.pack.offset};pathid:${resolved.image.PathID}`];
    }
    return archive_export(files);
}

module.exports = { get_miliastra_export };
