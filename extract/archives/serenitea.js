// Source extraction belongs here; wiki-data consumes the exported genshin-db records.
const { source_text, archive_image, archive_dialogue, source_excel, make_archive_item, archive_external_relation, source_bin, archive_export } = require('./archiveSource');
function diagnostic(item, message) {
    item.diagnostics ??= [];
    if (!item.diagnostics.includes(message))
        item.diagnostics.push(message);
}
function text(item, lang, hash) {
    if (hash === undefined || hash === null || hash === 0)
        return '';
    const key = String(hash);
    if (!item.source.hashes.includes(key))
        item.source.hashes.push(key);
    const value = source_text(lang, hash);
    if (!value)
        diagnostic(item, `missing_text:${lang}:${key}`);
    return value;
}
function labels(lang) {
    return lang === 'zh_hans' ? {
        classification: '源分类', sources: '获取途径', unlock: '解锁说明',
        preferred: '偏好角色',
    } : {
        classification: 'Source classification', sources: 'Sources', unlock: 'Unlock description',
        preferred: 'Favored companions',
    };
}
function image(item, id, reference, kind) {
    if (!reference || item.images.some(image => image.name === reference))
        return;
    const result = archive_image(reference, 'serenitea', id, kind);
    if (result)
        item.images.push(result);
}
function relation(item, value) {
    if (value && !item.relations.some(existing => existing.category === value.category
        && existing.id === value.id && existing.role === value.role))
        item.relations.push(value);
}
function internal(item, file, role, count) {
    if (file)
        relation(item, { category: 'serenitea', id: file.id, name: file.data.name, role,
            ...(count === undefined ? {} : { count }) });
}
function classify(item, row, types, lang) {
    const names = [];
    item.classifications = [];
    for (const id of (row.furnType || []).filter(Boolean)) {
        const type = types.get(id);
        if (!type) {
            diagnostic(item, `missing_furniture_type:${id}`);
            continue;
        }
        const group_name = text(item, lang, type.typeNameTextMapHash);
        const name = text(item, lang, type.typeName2TextMapHash);
        if (!item.classifications.some(entry => entry.id === String(id))) {
            item.classifications.push({ id: String(id), group_id: type.typeCategoryID == null ? '' : String(type.typeCategoryID),
                group_name, name });
        }
        const label = [group_name, name].filter(Boolean).join(' / ');
        if (label && !names.includes(label))
            names.push(label);
    }
    if (names.length)
        item.sections.push({ title: labels(lang).classification, kind: 'classification', text: names.join('\n') });
    else
        diagnostic(item, 'unclassified_source');
}
function vector(value) {
    // Omitted axes in the source serializer are zero, not unknown coordinates.
    return [value.x ?? 0, value.y ?? 0, value.z ?? 0];
}
function home_talk(row) {
    // Historic giving-event responses are still home dialogue when their explicit
    // namespace is HomeWorld. Their Activity storage folder is not a scope rule.
    return /^QuestDialogue\/HomeWorld\//i.test(row.performCfg || '')
        && !/\/test(?:[\/_]|$)/i.test(row.performCfg);
}
function dialogue(item, ids, allowed, lang, npc_ids = []) {
    const result = archive_dialogue([...new Set(ids)], lang, npc_ids);
    const retained = new Set(Object.entries(result.talks)
        .filter(([, talk]) => allowed.has(talk.source_id)).map(([key]) => Number(key)));
    const pending = [...retained];
    for (let index = 0; index < pending.length; index++) {
        for (const next of result.talks[pending[index]].next_talks) {
            if (retained.has(next))
                continue;
            retained.add(next);
            pending.push(next);
        }
    }
    item.talks = Object.fromEntries(Object.entries(result.talks).filter(([key]) => retained.has(Number(key))));
    const incoming = new Set();
    for (const talk of Object.values(item.talks)) {
        talk.next_talks = talk.next_talks.filter(key => {
            if (retained.has(key)) {
                incoming.add(key);
                return true;
            }
            const excluded = result.talks[key];
            if (excluded)
                diagnostic(item, `excluded_non_homeworld_talk:${excluded.source_id}`);
            return false;
        });
    }
    item.entry_talks = [...retained].filter(key => !incoming.has(key));
    if (!item.entry_talks.length && retained.size)
        item.entry_talks = [[...retained][0]];
    for (const message of result.diagnostics)
        diagnostic(item, message);
    for (const id of new Set(ids)) {
        if (!Object.values(item.talks).some(talk => talk.source_id === id))
            diagnostic(item, `missing_selected_talk:${id}`);
    }
}
/** Source IDs, rather than localized names, define the same catalogue in both languages. */
function get_serenitea_export(lang) {
    const realm_rows = source_excel('HomeworldModuleExcelConfigData');
    const furniture_rows = source_excel('HomeWorldFurnitureExcelConfigData');
    const suite_rows = source_excel('FurnitureSuiteExcelConfigData');
    const companion_rows = source_excel('HomeWorldNPCExcelConfigData');
    const events = source_excel('HomeWorldEventExcelConfigData');
    const type_rows = new Map(source_excel('HomeWorldFurnitureTypeExcelConfigData').map(row => [row.typeID, row]));
    const avatars = new Map(source_excel('AvatarExcelConfigData').map(row => [row.id, row]));
    const talks = [0, 1].flatMap(part => source_excel(`TalkExcelConfigData_${part}`));
    const files = [];
    const furniture = new Map();
    const by_avatar = new Map();
    const headings = labels(lang);
    for (const row of furniture_rows) {
        const item = make_archive_item('HomeWorldFurnitureExcelConfigData', row.id, 'furniture', '', '');
        item.furniture_type = row.specialFurnitureType || '';
        item.name = text(item, lang, row.nameTextMapHash);
        // The home-specific mansion/animal text is displayed once, as the description.
        item.description = text(item, lang, row.descTextMapHash);
        classify(item, row, type_rows, lang);
        const sources = [...new Set((row.sourceTextList || []).map((hash) => text(item, lang, hash)).filter(Boolean))];
        if (sources.length)
            item.sections.push({ title: headings.sources, kind: 'source', text: sources.join('\n') });
        const file = { id: `furniture-${row.id}`, data: item };
        image(item, file.id, row.icon, 'icon');
        image(item, file.id, row.itemIcon, 'item_icon');
        image(item, file.id, row.effectIcon, 'effect');
        files.push(file);
        furniture.set(row.id, file);
    }
    for (const row of realm_rows) {
        const item = make_archive_item('HomeworldModuleExcelConfigData', row.id, 'realm', '', '');
        item.name = text(item, lang, row.moduleNameTextMapHash);
        item.description = text(item, lang, row.moduleDescTextMapHash);
        const unlock = text(item, lang, row.unlockTipIfUnFreeTextMapHash);
        if (unlock)
            item.sections.push({ title: headings.unlock, kind: 'unlock', text: unlock });
        const file = { id: `realm-${row.id}`, data: item };
        image(item, file.id, row.bigImageAddr, 'landscape');
        image(item, file.id, row.smallImageAddr, 'icon');
        for (const mansion of furniture_rows.filter(furn => furn.roomSceneID
            && (row.optionalRoomSceneIdVec || []).includes(furn.roomSceneID)))
            internal(item, furniture.get(mansion.id), 'component');
        files.push(file);
    }
    for (const row of companion_rows) {
        const item = make_archive_item('HomeWorldNPCExcelConfigData', row.npcID, 'companion', '', '');
        const furnishing = furniture.get(row.furnitureID);
        // The NPC table's legacy hashes are unresolved in current TextMaps; use the exact
        // source-linked furniture/avatar name, never a guessed name or cross-language fallback.
        item.name = text(item, lang, row.showNameTextMapHash) || furnishing?.data.name
            || text(item, lang, avatars.get(row.avatarID)?.nameTextMapHash) || '';
        item.description = text(item, lang, row.descTextMapHash) || furnishing?.data.description || '';
        if (furnishing)
            item.source.hashes.push(...furnishing.data.source.hashes.filter(hash => !item.source.hashes.includes(hash)));
        const file = { id: `companion-${row.npcID}`, data: item };
        internal(item, furnishing, 'component');
        internal(furnishing?.data || item, file, 'dialogue');
        if (row.avatarID)
            relation(item, archive_external_relation('character', row.avatarID, lang, 'character'));
        image(item, file.id, row.frontIcon, 'portrait');
        image(item, file.id, avatars.get(row.avatarID)?.iconName, 'portrait');
        image(item, file.id, avatars.get(row.avatarID)?.sideIconName, 'side_portrait');
        files.push(file);
        if (row.avatarID)
            by_avatar.set(row.avatarID, file);
        const gifts = events.filter(event => event.avatarID === row.avatarID && event.talkID);
        const selected = talks.filter(talk => (talk.npcId || []).includes(row.npcID) && home_talk(talk)).map(talk => talk.id);
        const ids = [...(row.talkIDs || []), ...selected, ...gifts.map(event => event.talkID)];
        dialogue(item, ids, new Set(ids), lang, [row.npcID]);
        if (!Object.keys(item.talks).length)
            diagnostic(item, 'no_companion_dialogue');
    }
    for (const row of suite_rows) {
        const item = make_archive_item('FurnitureSuiteExcelConfigData', row.suiteID, 'suite', '', '');
        item.name = text(item, lang, row.suiteNameTextMapHash);
        item.description = text(item, lang, row.suiteDescTextMapHash);
        classify(item, row, type_rows, lang);
        const file = { id: `suite-${row.suiteID}`, data: item };
        image(item, file.id, row.itemIcon, 'icon');
        image(item, file.id, row.mapIcon, 'map_icon');
        const layout_path = `HomeworldFurnitureSuit/${row.jsonName}.json`;
        const layout = source_bin(layout_path);
        if (!Array.isArray(layout?.HHDPMDCFCPK))
            diagnostic(item, `missing_suite_layout:${layout_path}`);
        else {
            item.layout = [];
            const counts = new Map();
            for (const component of layout.HHDPMDCFCPK) {
                if (!component.furnitureID) {
                    diagnostic(item, `invalid_suite_component:${JSON.stringify(component)}`);
                    continue;
                }
                item.layout.push({ item: `furniture-${component.furnitureID}`, position: vector(component.position || {}),
                    ...(component.rotation ? { rotation: vector(component.rotation) } : {}) });
                counts.set(component.furnitureID, (counts.get(component.furnitureID) || 0) + 1);
            }
            for (const [id, count] of counts) {
                const component = furniture.get(id);
                if (!component) {
                    diagnostic(item, `missing_suite_furniture:${id}`);
                    continue;
                }
                internal(item, component, 'component', count);
                internal(component.data, file, 'suite', count);
            }
        }
        const suite_events = events.filter(event => event.furnitureSuitID === row.suiteID);
        const favorite_ids = [...new Set([...(row.favoriteNpcExcelIdVec || []), ...suite_events.map(event => event.avatarID)])];
        const favorite_names = [];
        for (const avatar of favorite_ids) {
            const companion = by_avatar.get(avatar);
            const external = archive_external_relation('character', avatar, lang, 'character');
            relation(item, external);
            internal(item, companion, 'dialogue');
            if (companion)
                internal(companion.data, file, 'suite');
            const name = companion?.data.name || external?.name || text(item, lang, avatars.get(avatar)?.nameTextMapHash);
            if (name && !favorite_names.includes(name))
                favorite_names.push(name);
            if (!companion)
                diagnostic(item, `missing_preferred_companion:${avatar}`);
        }
        if (favorite_names.length)
            item.sections.push({ title: headings.preferred, kind: 'preferred_characters', text: favorite_names.join('\n') });
        const gift_ids = suite_events.filter(event => event.talkID).map(event => event.talkID);
        if (gift_ids.length)
            dialogue(item, gift_ids, new Set(gift_ids), lang);
        for (const event of suite_events.filter(event => !event.talkID))
            diagnostic(item, `event_without_talk:HomeWorldEventExcelConfigData:${event.eventID}`);
        files.push(file);
    }
    // Host gadgets are source-bound to home load marks. Do not include nearby minigame
    // gadgets (68906/68907), quest introductions, or similarly named overworld NPCs.
    const host_groups = [
        { id: 1001, marks: [1001, 1002, 1003, 1004] },
        { id: 2000, marks: [2000] },
    ];
    for (const host of host_groups) {
        const selected = talks.filter(talk => talk.loadType === 'TALK_GADGET' && !talk.questId
            && (talk.extraLoadMarkId || []).includes(999999900)
            && host.marks.includes(talk.extraLoadMarkId?.[0]));
        const item = make_archive_item('TalkExcelConfigData', selected[0]?.id ?? host.id, 'host', '', '');
        const file = { id: `host-${host.id}`, data: item };
        dialogue(item, selected.map(talk => talk.id), new Set(selected.map(talk => talk.id)), lang);
        const greeting = Object.values(item.talks).find(talk => talk.source_id === selected[0]?.id);
        // The actor name comes from the actual gadget dialogue, not a fabricated NPC link.
        item.name = Object.values(greeting?.dialogs || {}).find(dialog => dialog.speaker)?.speaker || '';
        if (!item.name)
            diagnostic(item, `missing_host_speaker:${host.id}`);
        if (!Object.keys(item.talks).length)
            diagnostic(item, `missing_host_dialogue:${host.id}`);
        files.push(file);
    }
    return archive_export(files);
}

module.exports = { get_serenitea_export };
