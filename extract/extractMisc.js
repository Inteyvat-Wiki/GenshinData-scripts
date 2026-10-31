// Text-only client catalogues. No ArchiveRecord, Lua, rewards, or Wiki dependency.
const source = require('./misc/source');
const tracking = require('../versions/tracking');

const tables = {
    achievement: 'AchievementExcelConfigData', achievement_group: 'AchievementGoalExcelConfigData', namecard: 'MaterialExcelConfigData',
    profile_picture: 'ProfilePictureExcelConfigData', profile_frame: 'ProfileFrameExcelConfigData',
    expedition: 'ExpeditionDataExcelConfigData', gallant_path: 'LocalLegendExcelConfigData',
    loading_tip: 'LoadingTipsExcelConfigData', tutorial: 'TutorialExcelConfigData', graeae_message: 'TpsGlassesChatTopicExcelConfigData',
};
const platforms = { PC: 'detailIdList', Mobile: 'mobileDetailIdList', PS: 'joypadDetailIdList' };
// Resource namespace, NOT translated titles or generic UGC (older UGC events stay).
const beyondImage = /^UI_(?:Tutorial|Activity)_Byd/i;

function buildMisc(language, input = source) {
    if (!['CHS', 'EN'].includes(language)) throw new Error(`Unsupported misc language: ${language}`);
    const output = {};
    let order = 0;
    const rows = table => input.excel(table);
    const index = (table, key = 'id') => new Map(rows(table).map(row => [row[key] ?? 0, row]));
    const diagnose = (item, message) => {
        if (!(item.diagnostics ||= []).includes(message)) item.diagnostics.push(message);
    };
    const reference = (item, value) => {
        if (value == null || value === '') return;
        if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('Imprecise misc resource reference');
        const ref = String(value);
        if (!(item.source.references ||= []).includes(ref)) item.source.references.push(ref);
    };
    const fk = (item, table, id) => reference(item, `${table}:${id}`);
    const text = (item, hash, field) => {
        if (hash == null || String(hash) === '0') return '';
        const key = String(hash);
        if (!/^\d+$/.test(key) || !Number.isSafeInteger(Number(key)) || Number(key) > 0xFFFFFFFF)
            throw new Error(`Invalid misc TextMap hash: ${item.id}:${field}:${key}`);
        if (!item.source.hashes.includes(key)) item.source.hashes.push(key);
        const value = input.text(language, key);
        if (!value) diagnose(item, `missing_text:${language}:${field}:${key}`);
        return value;
    };
    const create = (type, row, nameHash, descriptionHash) => {
        if (!Number.isSafeInteger(row.id) || row.id < 0 || row.id === 0 && type !== 'achievement_group') throw new Error(`Invalid misc source ID: ${type}:${row.id}`);
        const id = `${type}-${row.id}`;
        if (output[id]) throw new Error(`Duplicate misc source ID: ${id}`);
        const item = { id, order: order++, show: true, type, name: '', description: '',
            sections: [], images: [], relations: [], source: { table: tables[type], id: String(row.id), hashes: [] } };
        item.name = text(item, nameHash, 'name');
        item.description = text(item, descriptionHash, 'description');
        if (!item.name) { item.show = false; diagnose(item, `missing_name:${language}`); }
        output[id] = item;
        return item;
    };
    const section = (item, hash, kind, title) => {
        const value = { kind, text: text(item, hash, kind) };
        if (title !== undefined) value.title = title;
        item.sections.push(value);
    };
    const image = (item, value, kind) => {
        if (value == null || value === '' || value === 0) return;
        reference(item, value);
        const name = String(value);
        if (!item.images.some(img => img.name === name && img.kind === kind)) item.images.push({ name, kind });
    };
    const relation = (item, category, target, table, sourceId, nameHash, role) => {
        fk(item, table, sourceId);
        if (!target) diagnose(item, `missing_relation:${table}:${sourceId}`);
        item.relations.push({ category, id: String(sourceId), source_id: sourceId,
            name: text(item, nameHash, `relation.${role}`), role });
    };

    const achievements = rows(tables.achievement);
    const achievementById = new Map(achievements.map(row => [row.id, row]));
    const goals = index('AchievementGoalExcelConfigData');
    for (const row of achievements) {
        // Match the legacy collator's valid stages, but do not merge names or stages.
        // Membership is bilingual, so a missing translation cannot change the ID set.
        if (row.isDisuse || row.id === 84517) continue;
        if (!['CHS', 'EN'].some(lang => input.text(lang, row.titleTextMapHash))) continue;
        if (row.preStageAchievementId && !['CHS', 'EN'].some(lang => input.text(lang, row.descTextMapHash))) continue;
        const item = create('achievement', row, row.titleTextMapHash, row.descTextMapHash);
        // The client fills this description parameter from this individual stage's
        // progress target, not triggerConfig.paramList (which contains trigger FKs).
        if (item.description.includes('{param0}')) {
            if (!Number.isSafeInteger(row.progress) || row.progress < 0)
                throw new Error(`Invalid achievement description progress: ${row.id}:${row.progress}`);
            item.description = item.description.replaceAll('{param0}', String(row.progress));
        }
        const goalId = row.goalId || 0, goal = goals.get(goalId);
        if (!goal) throw new Error(`Missing achievement collection: ${row.id}:${goalId}`);
        fk(item, tables.achievement_group, goalId);
        item.relations.push({ category: 'misc', id: `achievement_group-${goalId}`,
            name: text(item, goal.nameTextMapHash, 'relation.group'), role: 'group' });
        image(item, goal?.iconPath, 'group_icon');
        // isShow is an in-game spoiler condition, not a reason to drop a valid page.
        if (row.isShow) reference(item, `isShow:${row.isShow}`);
    }
    for (const row of achievements) {
        const item = output[`achievement-${row.id}`];
        if (!item || !row.preStageAchievementId) continue;
        const previousId = `achievement-${row.preStageAchievementId}`, previous = output[previousId];
        fk(item, tables.achievement, row.preStageAchievementId);
        item.relations.push({ category: 'misc', id: previousId, source_id: row.preStageAchievementId,
            name: previous?.name || '', role: 'previous_stage' });
        if (!previous) diagnose(item, `missing_previous_stage:${row.preStageAchievementId}`);
        else {
            text(item, achievementById.get(row.preStageAchievementId)?.titleTextMapHash, 'previous_stage');
            previous.relations.push({ category: 'misc', id: item.id, source_id: row.id, name: item.name, role: 'next_stage' });
            text(previous, row.titleTextMapHash, 'next_stage');
            fk(previous, tables.achievement, row.id);
        }
    }

    // Protobuf-default goal ID 0 is 天地万象, not a missing foreign key.
    for (const row of [...goals.values()].sort((a, b) => a.orderId - b.orderId)) {
        const item = create('achievement_group', { ...row, id: row.id ?? 0 }, row.nameTextMapHash);
        image(item, row.iconPath, 'group_icon');
        for (const member of achievements.filter(member => (member.goalId ?? 0) === (row.id ?? 0))
            .sort((a, b) => (a.orderId ?? 0) - (b.orderId ?? 0) || a.id - b.id)) {
            const achievement = output[`achievement-${member.id}`];
            if (!achievement) continue; // Do not reintroduce disused or excluded stages.
            fk(item, tables.achievement, member.id);
            item.relations.push({ category: 'misc', id: achievement.id,
                name: text(item, member.titleTextMapHash, 'relation.achievement'), role: 'achievement' });
        }
    }

    const materials = index(tables.namecard), sources = index('MaterialSourceDataExcelConfigData');
    for (const row of materials.values()) {
        if (row.materialType !== 'MATERIAL_NAMECARD') continue;
        const item = create('namecard', row, row.nameTextMapHash, row.descTextMapHash);
        image(item, row.icon, 'icon');
        (row.picPath || []).forEach((value, i) => image(item, value, i === 0 ? 'banner' : 'background'));
        const acquisition = sources.get(row.id);
        fk(item, 'MaterialSourceDataExcelConfigData', row.id);
        if (!acquisition) diagnose(item, `missing_relation:MaterialSourceDataExcelConfigData:${row.id}`);
        // HNNPIIJLLEK is this revision's jump-description TextMap list. Do not
        // interpret the other arrays (dungeons/conditions) as text or rewards.
        for (const hash of [...(acquisition?.textList || []), ...(acquisition?.jumpDescs || acquisition?.HNNPIIJLLEK || [])]) {
            const value = text(item, hash, 'acquisition');
            if (value && !item.sections.some(s => s.kind === 'acquisition' && s.text === value)) item.sections.push({ kind: 'acquisition', text: value });
        }
    }

    const avatars = index('AvatarExcelConfigData'), costumes = index('AvatarCostumeExcelConfigData', 'skinId');
    const quests = index('MainQuestExcelConfigData');
    const unlocks = {
        PROFILE_PICTURE_UNLOCK_BY_AVATAR: [avatars, 'AvatarExcelConfigData', 'character', 'nameTextMapHash', 'unlock_avatar'],
        PROFILE_PICTURE_UNLOCK_BY_COSTUME: [costumes, 'AvatarCostumeExcelConfigData', 'outfit', 'nameTextMapHash', 'unlock_costume'],
        PROFILE_PICTURE_UNLOCK_BY_ITEM: [materials, 'MaterialExcelConfigData', 'material', 'nameTextMapHash', 'unlock_material'],
        PROFILE_PICTURE_UNLOCK_BY_PARENT_QUEST: [quests, 'MainQuestExcelConfigData', 'task', 'titleTextMapHash', 'unlock_quest'],
    };
    // These five names format a mutable character name, not a numeric parameter.
    // Keep the original TextMap hash and normalize only the observed avatar/record pairs.
    const nameFormats = {
        1: [10000005, '{NICKNAME}'], 11: [10000005, '{NICKNAME}'],
        2: [10000007, '{NICKNAME}'], 21: [10000007, '{NICKNAME}'],
        6000: [10000075, '{REALNAME[ID(1)]}'],
    };
    for (const row of rows(tables.profile_picture)) {
        const item = create('profile_picture', row, row.nameTextMapHash, row.unlockDescTextMapHash);
        if (Object.hasOwn(nameFormats, row.id) && item.name.includes('{0}')) {
            const [avatarId, token] = nameFormats[row.id];
            if (row.HOKCMBCOBAO !== avatarId) throw new Error(`Profile picture name avatar changed: ${row.id}`);
            item.name = item.name.replaceAll('{0}', token);
        }
        image(item, row.iconPath, 'icon');
        const unlockType = row.unlockType || row.NLAPNBMECDF;
        reference(item, `unlockType:${unlockType}`);
        if (unlocks[unlockType]) {
            const [targets, table, category, key, role] = unlocks[unlockType], target = targets.get(row.unlockParam);
            relation(item, category, target, table, row.unlockParam, target?.[key], role);
        } else if (unlockType !== 'PROFILE_PICTURE_UNLOCK_BY_DEFAULT') diagnose(item, `unknown_unlock_type:${unlockType}`);
        // Keep the actual test title. Never substitute a character/material name.
        if (['CHS', 'EN'].some(lang => /\(test\)|测试/i.test(input.text(lang, row.nameTextMapHash)))) {
            item.show = false;
            diagnose(item, 'test_profile_picture');
        }
    }
    for (const row of rows(tables.profile_frame)) {
        const item = create('profile_frame', row, row.nameTextMapHash, row.unlockDescTextMapHash);
        image(item, row.iconPathHash, 'icon');
        const hash = String(row.iconPathHash);
        const resolved = require('../resources/profile-frames').resourceIcon(hash);
        image(item, resolved.image.Name, 'resource_icon');
        reference(item, `resource64:${hash};subasset:${resolved.subAssetId};block:${resolved.pack.block};offset:${resolved.pack.offset};pathid:${resolved.image.PathID}`);
    }
    const cities = index('CityConfigData', 'cityId');
    for (const row of rows(tables.expedition)) {
        const item = create('expedition', row, row.nameTextMapHash, row.descriptionTextMapHash);
        image(item, row.picture, 'illustration');
        const city = cities.get(row.cityId);
        relation(item, 'region', city, 'CityConfigData', row.cityId, city?.cityNameTextMapHash, 'region');
    }
    const monsters = index('MonsterExcelConfigData'), describes = index('MonsterDescribeExcelConfigData');
    for (const row of rows(tables.gallant_path)) {
        const item = create('gallant_path', row, row.nameTextMapHash, row.descTextMapHash);
        // LocalLegend hashes/prefab are unextracted dedicated resources. A monster
        // icon is explicitly marked as such and must not masquerade as artwork.
        for (const value of [row.iconHash, row.DFBBICALCFF, row.prefabName]) reference(item, value);
        const monster = monsters.get(row.monsterId), describe = describes.get(monster?.describeId);
        relation(item, 'enemy', monster, 'MonsterExcelConfigData', row.monsterId, monster?.nameTextMapHash, 'monster');
        if (monster?.describeId) fk(item, 'MonsterDescribeExcelConfigData', monster.describeId);
        if (!describe) diagnose(item, `missing_monster_describe:${monster?.describeId}`);
        image(item, describe?.icon, 'monster_icon');
        diagnose(item, 'dedicated_illustration_unresolved');
    }

    const situations = index('LoadingSituationExcelConfigData', 'stageID');
    const loadingAreas = rows('WorldAreaConfigData').filter(area => area.areaType === 'LEVEL_1');
    const loadingDungeons = index('DungeonExcelConfigData');
    for (const row of rows(tables.loading_tip)) {
        if (row.id >= 1940 && row.id <= 1948) continue; // Deferred Miliastra operations.
        const item = create('loading_tip', row, row.tipsTitleTextMapHash, row.tipsDescTextMapHash);
        if (row.stageID == null || row.stageID === '') diagnose(item, 'missing_stage');
        else {
            reference(item, `stageID:${row.stageID}`);
            if (!/^[1-9]\d*(?:,[1-9]\d*)*$/.test(row.stageID)) diagnose(item, `invalid_stage:${row.stageID}`);
            else for (const stage of new Set(row.stageID.split(',').map(Number))) {
                const situation = situations.get(stage);
                relation(item, 'loading_situation', situation, 'LoadingSituationExcelConfigData', stage, undefined, 'stage');
                image(item, situation?.picPath, 'loading_background');
                if (situation) {
                    const areas = (situation.area1ID || []).map(id => {
                        const matches = loadingAreas.filter(area => area.areaID1 === id
                            && (!situation.sceneID?.length || situation.sceneID.includes(area.sceneID)));
                        if (matches.length !== 1) throw new Error(`Ambiguous/missing loading area: ${stage}:${id}`);
                        const area = matches[0];
                        fk(item, 'WorldAreaConfigData', area.id);
                        return { id: String(area.id), name: text(item, area.areaNameTextMapHash, `situation.${stage}.area`) };
                    });
                    (item.loading_situations ||= []).push({ id: String(stage), action: situation.loadingSituationType, areas,
                        ...(situation.picPath ? { image: { name: situation.picPath, kind: 'loading_background' } } : {}),
                        ...(situation.areaTerrainType ? { terrain: situation.areaTerrainType } : {}),
                        ...(situation.sceneID?.length ? { scene_ids: situation.sceneID.map(String) } : {}),
                        ...(situation.dungeonType ? { dungeon_type: situation.dungeonType } : {}),
                        ...(situation.LLPOIIOJKOC?.length ? { dungeons: situation.LLPOIIOJKOC.map(id => {
                            const dungeon = loadingDungeons.get(id);
                            if (!dungeon) throw new Error(`Missing loading dungeon: ${stage}:${id}`);
                            fk(item, 'DungeonExcelConfigData', id);
                            return { id: String(id), name: text(item, dungeon.nameTextMapHash, `situation.${stage}.dungeon`) };
                        }) } : {}),
                    });
                }
            }
        }
        if (row.id >= 1928 && row.id <= 1939) {
            item.relations.push({ category: 'miliastra', id: `lore-${row.id}`, source_id: row.id, name: item.name, role: 'lore' });
        }
    }

    const details = index('TutorialDetailExcelConfigData');
    const tutorialMetadata = require('./misc/tutorials')(input);
    const pushes = new Map();
    for (const push of [...rows('PushTipsConfigData'), ...tutorialMetadata.activityPushes]) {
        if (!push.tutorialId) continue;
        if (!pushes.has(push.tutorialId)) pushes.set(push.tutorialId, []);
        pushes.get(push.tutorialId).push(push);
    }
    for (const row of rows(tables.tutorial)) {
        const detailIds = Object.values(platforms).flatMap(key => row[key] || []);
        if (detailIds.some(id => details.get(id)?.imageNameList?.some(name => beyondImage.test(name)))) continue;
        const titles = pushes.get(row.id) || [], primary = titles.find(p => input.text(language, p.titleTextMapHash)) || titles[0];
        const item = create('tutorial', row, primary?.titleTextMapHash);
        item.tutorial_category = tutorialMetadata.category(row.id);
        if (!titles.length) diagnose(item, 'missing_push_tips_title');
        for (const push of titles) {
            fk(item, push.activityId ? 'NewActivityPushTipsConfigData' : 'PushTipsConfigData', push.pushTipsId);
            const title = text(item, push.titleTextMapHash, 'push_title');
            if (title && title !== item.name && !item.sections.some(s => s.kind === 'alternate_title' && s.text === title))
                item.sections.push({ kind: 'alternate_title', text: title });
            const subtitle = text(item, push.subtitleTextMapHash, 'push_subtitle');
            if (subtitle && !item.sections.some(s => s.kind === 'subtitle' && s.text === subtitle)) item.sections.push({ kind: 'subtitle', text: subtitle });
            image(item, push.showIcon || push.tabIcon, 'icon');
        }
        const descriptions = [];
        for (const [platform, key] of Object.entries(platforms)) for (const id of row[key] || []) {
            fk(item, 'TutorialDetailExcelConfigData', id);
            const detail = details.get(id);
            if (!detail) diagnose(item, `missing_tutorial_detail:${platform}:${id}`);
            // Keep an empty section for missing text/rows, alongside available images.
            section(item, detail?.descriptTextMapHash, platform, platform);
            const value = item.sections.at(-1).text;
            if (!value) diagnose(item, `missing_tutorial_text:${platform}:${id}`);
            if (platform === 'PC' && value) descriptions.push(value);
            for (const name of detail?.imageNameList || []) image(item, name, platform);
        }
        item.description = descriptions.join('\n\n');
        // A source title is not a prerequisite for preserving usable tutorial prose
        // or pictures in the catalogue. The consumer may label an empty name in UI.
        item.show = item.sections.some(s => Object.hasOwn(platforms, s.kind) && Boolean(s.text)) || item.images.length > 0;
        if (tutorialMetadata.unavailable(row)) {
            if (item.name || item.sections.some(section => section.text)) throw new Error(`Unavailable tutorial regained text: ${row.id}`);
            item.show = false;
            diagnose(item, 'unavailable_tutorial_source');
        }
    }

    require('./misc/graeae')(input, { create, text, image, reference, fk, diagnose });
    for (const item of Object.values(output)) {
        // Standard exporter version aggregation uses this explicit per-record set.
        // Missing TextMap slots remain provenance, but are not invented dependencies.
        tracking.attach(item, new Set(item.source.hashes.filter(hash => input.text(language, hash))));
    }
    return output;
}

module.exports = buildMisc;
