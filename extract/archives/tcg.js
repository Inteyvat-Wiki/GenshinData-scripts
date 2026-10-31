// Source extraction belongs here; wiki-data consumes the exported genshin-db records.
const { source_excel, source_text, archive_image, source_bin, archive_dialogue, archive_external_relation, make_archive_item, archive_export } = require('./archiveSource');
const excel = (name) => source_excel(`${name}ExcelConfigData`);
const by_id = (rows) => new Map(rows.map(row => [row.id, row]));
const { work_time_text } = require('./tcg_work_time');
const supported = ['zh_hans', 'en'];
const battle_fields = ['happyTalkId', 'sadTalkId', 'toughTalkId', 'elementBrustTalkId',
    'lowHealthTalkId', 'highHealthTalkId'];
// GCG portrait actor IDs are a separate namespace. These explicit companion identities
// bridge to real NPC name hashes; the icon guard prevents silently reusing a changed ID.
const actor_npcs = new Map([
    [30000003, { icon: 'UI_AvatarIcon_Aozi', npc: 10012 }],
    [24000024, { icon: 'UI_Gcg_NPC_Sumeru_Jeht', npc: 20723 }],
    [24000025, { icon: 'UI_Gcg_NPC_Sumeru_Djinn', npc: 17013 }],
    [30000004, { icon: 'UI_NPC_Natlan_Ajaw', npc: 9582 }],
    [30000005, { icon: 'UI_NPC_Natlan_Galah', npc: 9596 }],
]);
function label(lang, key) {
    const labels = {
        story: ['故事与题词', 'Story and inscription'],
        biography: ['牌手小传', 'Player profile'],
        happyTalkId: ['得意时', 'Elated'], sadTalkId: ['受挫时', 'Disheartened'],
        toughTalkId: ['陷入困境时', 'Under pressure'], elementBrustTalkId: ['元素爆发时', 'Elemental Burst'],
        lowHealthTalkId: ['生命值较低时', 'Low health'], highHealthTalkId: ['生命值较高时', 'High health'],
        battle: ['对局台词', 'Duel dialogue'],
        normalWinTalk: ['友好对局胜利对白', 'Friendly duel victory dialogue'],
        normalLossTalk: ['友好对局落败对白', 'Friendly duel defeat dialogue'],
        hardWinTalk: ['认真胜负胜利对白', 'Serious showdown victory dialogue'],
        hardLossTalk: ['认真胜负落败对白', 'Serious showdown defeat dialogue'],
    };
    return labels[key]?.[lang === 'zh_hans' ? 0 : 1] || key;
}
function diagnostic(item, message) {
    if (!item.diagnostics)
        item.diagnostics = [];
    if (!item.diagnostics.includes(message))
        item.diagnostics.push(message);
}
function hashes(item, values) {
    for (const value of values) {
        if (value !== undefined && value !== null && !item.source.hashes.includes(String(value))) {
            item.source.hashes.push(String(value));
        }
    }
}
function references(item, values) {
    if (!item.source.references)
        item.source.references = [];
    for (const value of values) {
        if (!item.source.references.includes(value))
            item.source.references.push(value);
    }
}
function text(item, lang, hash, field) {
    hashes(item, [hash]);
    const result = source_text(lang, hash);
    if (hash && !result)
        diagnostic(item, `missing_text:${lang}:${field}:${hash}`);
    return result;
}
function image(item, id, reference, kind) {
    if (reference === undefined || reference === null || reference === '' || reference === 0)
        return;
    const name = String(reference);
    if (item.images.some(image => image.name === name && image.kind === kind))
        return;
    const result = archive_image(name, 'tcg', id, kind);
    if (result)
        item.images.push(result);
}
// Keep the actual resource references, including unextracted prefabs, spines and 64-bit hashes.
// They are not evidence that a PNG is missing from the game's resources.
function resources(item, id, row, prefix) {
    if (!row)
        return;
    for (const [field, value] of Object.entries(row)) {
        const opaque_hash = typeof value === 'string' && /^\d{16,20}$/.test(value);
        if (!opaque_hash && !/imageHash$|picHash$|staticImageHash$|imageNameHash$|Prefab|prefab|skinEffectJsonConfig/i.test(field))
            continue;
        for (const reference of Array.isArray(value) ? value : [value]) {
            image(item, id, reference, `${prefix}:${field}`);
        }
    }
}
function group_talks(npc_id) {
    const group = source_bin(`Talk/NpcGroup/${npc_id}.json`);
    return group ? Object.values(group)
        .find(value => Array.isArray(value) && value.some(talk => typeof talk?.id === 'number')) || [] : [];
}
function is_gcg_entry(talk) {
    return Object.values(talk).some(value => typeof value === 'string' && /(?:QuestDialogue\/GCG\/|(?:^|\/)GCG\/)/i.test(value)
        || Array.isArray(value) && value.some(condition => /^QUEST_COND_GCG_/.test(condition?.type || '')));
}
// archive_dialogue also loads other NPC-group roots when there is no GCG perform namespace.
// Retain only the requested GCG roots and their successor closure, with its original keys intact.
function dialogue(item, ids, npc_id, lang) {
    if (!ids.length)
        return;
    const result = archive_dialogue([...new Set(ids)], lang, [npc_id]);
    const roots = new Set(ids);
    const selected = new Set(Object.entries(result.talks)
        .filter(([, talk]) => roots.has(talk.source_id)).map(([key]) => Number(key)));
    const pending = [...selected];
    for (let index = 0; index < pending.length; index++) {
        for (const next of result.talks[pending[index]].next_talks) {
            if (!selected.has(next)) {
                selected.add(next);
                pending.push(next);
            }
        }
    }
    item.talks = Object.fromEntries(Object.entries(result.talks).filter(([key]) => selected.has(Number(key))));
    references(item, Object.values(item.talks).map(talk => `Talk:${talk.source_id}`));
    const incoming = new Set(Object.values(item.talks).flatMap(talk => talk.next_talks));
    item.entry_talks = [...selected].filter(key => !incoming.has(key));
    if (!item.entry_talks.length && selected.size)
        item.entry_talks = [pending[0]];
    for (const id of roots) {
        if (!Object.values(item.talks).some(talk => talk.source_id === id))
            diagnostic(item, `missing_talk:${id}`);
    }
    for (const message of result.diagnostics) {
        const id = Number(message.split(':')[1]);
        if (!Number.isFinite(id) || roots.has(id) || Object.values(item.talks).some(talk => talk.source_id === id)) {
            diagnostic(item, message);
        }
    }
}
function get_tcg_export(lang) {
    if (!supported.includes(lang))
        throw new Error(`TCG archive language not configured: ${lang}`);
    const deck_cards = excel('GCGDeckCard'), cards = by_id([...excel('GCGCard'), ...excel('GCGChar')]);
    const views = by_id(excel('GCGCardView')), faces = by_id(excel('GCGCardFace'));
    const tags = new Map(excel('GCGTag').map((row, order) => [row.type, { ...row, order }]));
    const manual = new Map(source_excel('ManualTextMapConfigData').map(row => [row.textMapId, row]));
    const card_types = { GCG_CARD_CHARACTER: 'CHAR', GCG_CARD_MODIFY: 'EQUIP', GCG_CARD_EVENT: 'EVENT', GCG_CARD_ASSIST: 'SUPPORT' };
    const materials = by_id(excel('Material')), npcs = by_id(excel('Npc')), avatars = by_id(excel('Avatar'));
    const worlds = excel('GCGWorldLevel'), characters = excel('GCGCharacterLevel'), weeks = excel('GCGWeekLevel');
    const bosses = excel('GCGBossLevel'), quests = excel('GCGQuestLevel'), others = excel('GcgOtherLevel');
    const stages = excel('GCGGameReward'), games = by_id(excel('GCGGame')), decks = by_id(excel('GCGDeck'));
    const battle_rows = excel('GCGTalk'), details = new Map(excel('GCGTalkDetail').map(row => [row.talkDetailId, row]));
    const icons = by_id(excel('GCGTalkDetailIcon'));
    const work_times = by_id(source_excel('GcgWorldWorkTimeExcelConfigData'));
    const talk_rows = [0, 1].flatMap(part => source_excel(`TalkExcelConfigData_${part}`));
    const talk_index = by_id(talk_rows);
    const files = [], items = new Map();
    const add = (id, data) => { files.push({ id, data }); items.set(id, data); return data; };
    const relation = (item, id, role) => {
        const target = items.get(id);
        if (target && !item.relations.some(relation => relation.category === 'tcg' && relation.id === id && relation.role === role)) {
            item.relations.push({ category: 'tcg', id, name: target.name, role });
        }
    };
    const external = (item, category, id, role) => {
        if (!id)
            return;
        const result = archive_external_relation(category, id, lang, role);
        if (result && !item.relations.some(relation => relation.category === category && relation.id === result.id && relation.role === role)) {
            item.relations.push(result);
        }
    };
    for (const row of deck_cards) {
        const id = `card-${row.id}`, card = cards.get(row.id);
        const item = add(id, make_archive_item('GCGDeckCardExcelConfigData', row.id, 'card', '', ''));
        item.name = text(item, lang, card?.nameTextMapHash, 'card.name');
        if (!card)
            diagnostic(item, `missing_card_metadata:${row.id}`);
        const type_key = card_types[card?.cardType];
        if (!type_key) throw new Error(`Unknown deck card type: ${row.id}:${card?.cardType}`);
        const type_label = manual.get(`UI_GCG_CARD_TYPE_${type_key}`);
        item.card_type = { id: card.cardType, name: text(item, lang, type_label?.textMapContentTextMapHash, 'card.type') };
        if (!item.card_type.name) throw new Error(`Missing card type label: ${lang}:${card.cardType}`);
        item.tags = [...new Set(card.tagList || [])].filter(tag => tag !== 'GCG_TAG_NONE').map(id => {
            const tag = tags.get(id);
            if (!tag) throw new Error(`Missing card tag: ${row.id}:${id}`);
            const name = text(item, lang, tag.nameTextMapHash, 'card.tag');
            if (!name) throw new Error(`Missing card tag label: ${lang}:${id}`);
            references(item, [`GCGTagExcelConfigData:${id}`]);
            return { id, name, order: tag.order, ...(tag.isHidden ? { hidden: true } : {}) };
        });
        const title = text(item, lang, row.storyTitleTextMapHash, 'story.title');
        item.description = text(item, lang, row.storyDescTextMapHash, 'story.description');
        item.sections.push({ kind: 'story', title, text: item.description });
        // GCGCard.desc and GCGCardFace.desc are effects / generic skin text, not more stories.
        image(item, id, materials.get(row.itemID)?.icon, 'card');
        resources(item, id, views.get(row.id), 'card_view');
        for (const face_id of row.faceIdList || []) {
            const face = faces.get(face_id);
            if (!face || face.cardId !== row.id) {
                diagnostic(item, `missing_card_face:${face_id}`);
                continue;
            }
            const kind = `card_face:${face.cardFaceType}:${face.id}`;
            image(item, id, materials.get(face.itemId)?.icon, kind);
            references(item, [`GCGCardFaceExcelConfigData:${face.id}:${face.cardFaceType}`]);
        }
        external(item, 'character', row.relatedCharacterId, 'character');
    }
    for (const [table, type] of [['GCGDeckBack', 'card_back'], ['GCGDeckField', 'card_table']]) {
        for (const row of excel(table)) {
            // itemId is present even for the protobuf-default row with omitted id.
            const id = `${type}-${row.itemId}`;
            const item = add(id, make_archive_item(`${table}ExcelConfigData`, row.itemId, type, '', ''));
            item.name = text(item, lang, row.nameTextMapHash, 'name');
            item.description = text(item, lang, row.descTextMapHash, 'description');
            image(item, id, materials.get(row.itemId)?.icon, 'icon');
            resources(item, id, row, type);
            if (type === 'card_table') {
                const tables = by_id(excel('GCGTable'));
                resources(item, id, tables.get(row.battleTableId), 'battle_table');
                resources(item, id, tables.get(row.diceTableId), 'dice_table');
            }
        }
    }
    const npc_ids = new Set([...worlds, ...characters, ...weeks, ...excel('GCGSceneConstNpc')].map(row => row.npcId));
    bosses.forEach(row => npc_ids.add(row.catId));
    const other_npcs = new Map();
    for (const row of others) {
        const ids = new Set((row.talkId || []).flatMap((id) => talk_index.get(id)?.npcId || []));
        other_npcs.set(row.levelId, ids);
        ids.forEach(id => npc_ids.add(id));
    }
    // QuestDialogue/GCG includes invite greetings not listed as win/loss talks.
    talk_rows.filter(row => /QuestDialogue\/GCG\//i.test(row.performCfg || ''))
        .forEach(row => (row.npcId || []).forEach((id) => npc_ids.add(id)));
    for (const npc_id of [...npc_ids].filter(Boolean).sort((a, b) => a - b)) {
        const id = `player-${npc_id}`, npc = npcs.get(npc_id);
        const item = add(id, make_archive_item('NpcExcelConfigData', npc_id, 'player', '', ''));
        item.name = text(item, lang, npc?.nameTextMapHash, 'player.name');
        if (!npc)
            diagnostic(item, `missing_npc:${npc_id}`);
        const biographies = worlds.filter(row => row.npcId === npc_id);
        for (const row of biographies) {
            const raw_description = text(item, lang, row.levelDecTextMapHash, `biography.${row.id}`);
            const description = work_time_text(raw_description, work_times.get(npc_id));
            if (description !== raw_description) references(item, [`GcgWorldWorkTimeExcelConfigData:${npc_id}`]);
            const title = text(item, lang, row.levelTitleTextMapHash, `biography_title.${row.id}`);
            // Keep every source record, including untranslated / empty records in both languages.
            item.sections.push({ kind: `biography:${row.id}`, title: title || label(lang, 'biography'), text: description });
            if (!item.description && description)
                item.description = description;
            if (!item.name && title)
                item.name = title;
        }
        const invites = characters.filter(row => row.npcId === npc_id);
        const group = group_talks(npc_id);
        const seed_ids = [
            ...group.filter(is_gcg_entry).map(row => row.id),
            ...talk_rows.filter(row => row.npcId?.includes(npc_id) && is_gcg_entry(row)).map(row => row.id),
            ...biographies.map(row => row.talkId),
            ...invites.flatMap(row => [row.normalWinTalk, row.normalLossTalk, row.hardWinTalk, row.hardLossTalk]),
            ...others.filter(row => other_npcs.get(row.levelId)?.has(npc_id)).flatMap(row => row.talkId || []),
        ].filter((id) => typeof id === 'number' && id > 0);
        dialogue(item, seed_ids, npc_id, lang);
        for (const invite of invites) {
            external(item, 'character', invite.avatarId, 'character');
            for (const field of ['normalWinTalk', 'normalLossTalk', 'hardWinTalk', 'hardLossTalk']) {
                const talk = Object.values(item.talks).find(talk => talk.source_id === invite[field]);
                if (talk)
                    talk.title = `${label(lang, field)}${talk.title ? ` · ${talk.title}` : ''}`;
            }
        }
        external(item, 'npc', npc_id, 'npc');
    }
    const stage_players = new Map();
    const link_player = (stage_id, npc_id) => {
        if (!npc_id)
            return;
        if (!stage_players.has(stage_id))
            stage_players.set(stage_id, new Set());
        stage_players.get(stage_id).add(npc_id);
    };
    for (const row of worlds)
        link_player(row.levelId, row.npcId);
    for (const row of characters) {
        for (const id of [row.normalLevelId, row.hardLevelId, ...(row.normalLevelList || []).map((level) => level.levelId)]) {
            link_player(id, row.npcId);
        }
    }
    for (const row of weeks)
        for (const level of row.levelCondList || [])
            link_player(level.levelId, row.npcId);
    for (const row of excel('GCGSceneConstNpc'))
        link_player(row.levelId, row.npcId);
    for (const row of bosses) {
        link_player(row.normalLevelId, row.catId);
        link_player(row.hardLevelId, row.catId);
    }
    for (const [id, ids] of other_npcs)
        ids.forEach(npc_id => link_player(id, npc_id));
    // Synthetic GCG talk actors (cats / story NPCs) are not Avatar or Npc IDs.
    // Resolve their names only through an explicit portrait -> game opponent association.
    const actor_names = new Map();
    for (const row of stages) {
        const name = source_text(lang, games.get(row.levelId)?.oppoPlayerNameTextMapHash);
        if (!row.oppoAvatarPicId || !name)
            continue;
        if (!actor_names.has(row.oppoAvatarPicId))
            actor_names.set(row.oppoAvatarPicId, new Set());
        actor_names.get(row.oppoAvatarPicId).add(name);
    }
    for (const row of stages) {
        const id = `stage-${row.levelId}`;
        const item = add(id, make_archive_item('GCGGameRewardExcelConfigData', row.levelId, 'stage', '', ''));
        item.name = text(item, lang, row.levelNameTextMapHash, 'stage.name');
        item.description = text(item, lang, row.levelDecTextMapHash, 'stage.description');
        image(item, id, row.loadingImage, 'stage_loading');
        const portrait = icons.get(row.oppoAvatarPicId);
        // The source supplies both regular and circular portraits explicitly.
        // Never derive the circular resource by appending a filename suffix.
        image(item, id, portrait?.FLNKMCFIMKJ || portrait?.iconName || avatars.get(row.oppoAvatarPicId)?.iconName, 'opponent');
        hashes(item, [games.get(row.levelId)?.oppoPlayerNameTextMapHash]);
        external(item, 'character', row.oppoAvatarPicId, 'opponent');
        for (const npc_id of stage_players.get(row.levelId) || []) {
            relation(item, `player-${npc_id}`, other_npcs.get(row.levelId)?.has(npc_id) ? 'dialogue_participant' : 'player');
            relation(items.get(`player-${npc_id}`), id, 'stage');
        }
        for (const quest of quests.filter(quest => quest.levelId === row.levelId)) {
            external(item, 'task', Math.floor(quest.questId / 100), 'quest');
            references(item, [`GCGQuestLevelExcelConfigData:${quest.questId}`]);
        }
        const game = games.get(row.levelId);
        for (const [field, role] of [['cardGroupId', 'player_card'], ['enemyCardGroupId', 'opponent_card']]) {
            const deck = decks.get(game?.[field]);
            for (const card_id of new Set([...(deck?.characterList || []), ...(deck?.cardList || []), ...(deck?.waitingCharacterList || [])])) {
                relation(item, `card-${card_id}`, role);
            }
        }
        // No ruleDec, rewardDec, skill groups, costs, states, summons or keyword effects.
        // The original level description is retained intact, including any embedded hint or digits.
    }
    // Player portraits come exclusively from explicitly linked stage opponents.
    // Dialogue participation is not proof of who sits on the other side of a duel.
    for (const file of files.filter(file => file.data.type === 'player')) {
        const candidates = new Map();
        for (const stage of files.filter(file => file.data.type === 'stage')) {
            if (!stage.data.relations.some(relation => relation.category === 'tcg' && relation.id === file.id && relation.role === 'player')) continue;
            for (const icon of stage.data.images.filter(icon => icon.kind === 'opponent')) {
                if (!candidates.has(icon.name)) candidates.set(icon.name, []);
                candidates.get(icon.name).push(stage.id);
            }
        }
        if (candidates.size === 1) {
            const [name, stages] = [...candidates][0];
            image(file.data, file.id, name, 'player');
            references(file.data, stages.map(id => `tcg:${id}:opponent_portrait`));
        } else if (candidates.size > 1) {
            diagnostic(file.data, 'ambiguous_stage_opponent_portrait');
        }
    }
    function battle(item, row, field) {
        const detail_id = row[field];
        if (!detail_id)
            return;
        const detail = details.get(detail_id);
        if (!detail) {
            diagnostic(item, `missing_gcg_talk_detail:${detail_id}`);
            return;
        }
        const trigger = `GCGTalk:${row.gameID}:${field}`;
        references(item, [trigger]);
        hashes(item, detail.talkContent || []);
        const slots = (detail.talkContent || []).map((hash, slot) => ({
            hash, slot, actor: detail.talkCharacterId?.[slot] || 0, voice: detail.talkVoiceId?.[slot] || 0,
            active: !!detail.talkCharacterId?.[slot] || !!detail.talkVoiceId?.[slot]
                || supported.some(lang => !!source_text(lang, hash)),
            test: supported.some(lang => /(?:\(\s*test\s*\)|（\s*test\s*）|^\s*test\b)/i.test(source_text(lang, hash))),
        })).filter((slot) => slot.active);
        if (slots.some((slot) => slot.test)) {
            // These prototype lines belong to games 11/12, outside the narrative stage table.
            // Never let a translated / untranslated test slot enter a normal duel conversation.
            diagnostic(item, `test_gcg_talk_detail_excluded:${detail_id}`);
            return;
        }
        const existing = Object.values(item.talks).find(talk => talk.source_id === detail_id
            && talk.trigger_ids.some(id => id.endsWith(`:${field}`)));
        if (existing) {
            if (!existing.trigger_ids.includes(trigger))
                existing.trigger_ids.push(trigger);
            return;
        }
        const talk = {
            source_id: detail_id, title: `${label(lang, 'battle')} · ${label(lang, field)}`,
            priority: 0, begin_way: null, next_talks: [], trigger_ids: [trigger],
            trigger_points: [], objects: [], conditions: [], dialogs: {}, initial_dialogs: [],
        };
        for (let index = 0; index < slots.length; index++) {
            const slot = slots[index];
            const candidates = actor_names.get(slot.actor);
            const bridge = actor_npcs.get(slot.actor);
            const npc_id = bridge?.icon === icons.get(slot.actor)?.iconName ? bridge?.npc : undefined;
            const stage = stages.find(stage => stage.levelId === row.gameID);
            // Fennec's portrait is also used for Little Rose. A concrete game's opponent
            // identity takes precedence over a global portrait-name guess.
            const opponent = stage?.oppoAvatarPicId === slot.actor
                ? source_text(lang, games.get(row.gameID)?.oppoPlayerNameTextMapHash) : '';
            const speaker = source_text(lang, avatars.get(slot.actor)?.nameTextMapHash)
                || source_text(lang, npcs.get(slot.actor)?.nameTextMapHash)
                || source_text(lang, npcs.get(npc_id)?.nameTextMapHash)
                || opponent
                || (candidates?.size === 1 ? [...candidates][0] : '');
            const provenance = `GCGTalkDetail:${detail_id}:slot:${slot.slot}:actor:${slot.actor}:voice:${slot.voice}:emoji:${detail.talkEmoji?.[slot.slot] || ''}`;
            references(item, [provenance]);
            hashes(item, [avatars.get(slot.actor)?.nameTextMapHash, npcs.get(slot.actor)?.nameTextMapHash]);
            if (opponent)
                hashes(item, [games.get(row.gameID)?.oppoPlayerNameTextMapHash]);
            if (npc_id) {
                references(item, [`GCGTalkDetailIcon:${slot.actor}:NpcExcelConfigData:${npc_id}`]);
                hashes(item, [npcs.get(npc_id)?.nameTextMapHash]);
            }
            if (!speaker)
                diagnostic(item, `unresolved_gcg_speaker:${detail_id}:${slot.slot}:${slot.actor}`);
            talk.dialogs[String(index + 1)] = {
                role: 'npc', content: text(item, lang, slot.hash, `gcg_talk.${detail_id}.${slot.slot}`),
                ...(speaker ? { speaker } : {}),
                next_dialogs: index + 1 < slots.length ? [{ dialog: index + 2 }] : [],
            };
        }
        if (!slots.length) {
            diagnostic(item, `empty_gcg_talk_detail:${detail_id}`);
            return;
        }
        talk.initial_dialogs = [{ dialog: 1 }];
        const key = Math.max(0, ...Object.keys(item.talks).map(Number)) + 1;
        item.talks[key] = talk;
        item.entry_talks.push(key);
    }
    for (const row of battle_rows) {
        const stage = items.get(`stage-${row.gameID}`);
        if (!stage)
            continue; // Games 11/12 are test prototypes, not extra narrative stages.
        const owners = [stage, ...[...(stage_players.get(row.gameID) || [])]
                .flatMap(id => items.get(`player-${id}`) || [])];
        for (const item of owners)
            for (const field of battle_fields)
                battle(item, row, field);
    }
    // Earlier player records were created before stage pages; every relation now points to a real file.
    const result = archive_export(files);
    for (const page of result.list) {
        if (page.type !== 'stage')
            continue;
        const item = items.get(page.id);
        if (supported.some(lang => /(?:\(\s*test\s*\)|测试)/i.test(source_text(lang, stages.find(row => `stage-${row.levelId}` === page.id)?.levelNameTextMapHash)))) {
            diagnostic(item, 'test_stage');
            page.show = false;
        }
    }
    return result;
}

module.exports = { get_tcg_export };
