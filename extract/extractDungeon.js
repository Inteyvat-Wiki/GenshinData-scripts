require('./global.js');

const xdungeon_entry = getExcel('DungeonEntryExcelConfigData');
const xdungeon = getExcel('DungeonExcelConfigData');
const xtext = getExcel('ManualTextMapConfigData');
const xmaterial_source = getExcel('MaterialSourceDataExcelConfigData');
const xpoint = {
    "3": getBin('Scene/Point/scene3_point'),
}

function collateDungeon(lang) {
    const language = getLanguage(lang);

    const { key_entry, key_dungeon, key_name } = getSceneKey();

    let mydungeons = xdungeon_entry.reduce((accum, obj) => {

        let data = {};

        data.id = obj.dungeonEntryId;

        if (xpoint[obj.sceneId] == undefined) {
            xpoint[obj.sceneId] = getBin(`Scene/Point/scene${obj.sceneId}_point`);
        }

        let name_index = undefined;

        if (xpoint[obj.sceneId][key_entry][obj.dungeonEntryId]) {
            if (obj.id == 1096) { // 「幻剧之书」
                name_index = xtext.find(e => e.textMapId === 'UI_ROLE_COMBAT_MAPMARK_MAGIC_BOOK')?.textMapContentTextMapHash;
            }
            if (xpoint[obj.sceneId][key_entry][obj.dungeonEntryId][key_name] != 'UI_STC_Intee_DungeonEntry') {
                name_index = xtext.find(e => e.textMapId === xpoint[obj.sceneId][key_entry][obj.dungeonEntryId][key_name])?.textMapContentTextMapHash;
            }
        }
        if (name_index) {
            data.name = sanitizeDescription(language[name_index]);
        }

        data.description = sanitizeDescription(language[obj.descTextMapHash]);
        data.filename_image = obj.picPath;

        if (obj.id == 1108) {
            obj.picPath = 'UI_DungeonPic_LeyLineChallenge_01'; // 「幽境危战」
        }

        data.tabs = [];
        let tabs_id = [];
        if (xpoint[obj.sceneId][key_entry][obj.dungeonEntryId]) {
            for (let tab_id of xpoint[obj.sceneId][key_entry][obj.dungeonEntryId][key_dungeon]) {
                tabs_id.push(tab_id);
            }
        }
        
        for (let i of obj.descriptionCycleRewardList) {
            for (let source_id of i) {
                let source_obj = xmaterial_source.find(e => e.id === source_id);
                for (let tab_id of source_obj.dungeonList) {
                    if(tab_id) tabs_id.push(tab_id);
                }
            }
        }

        tabs_id = [...new Set(tabs_id)];
        for (let tab_id of tabs_id) {
            let tab_obj = xdungeon.find(e => e.id === tab_id);

            data.tabs.push({
                id: tab_id,
                name: language[tab_obj.nameTextMapHash],
                description: sanitizeDescription(language[tab_obj.descTextMapHash]),
                // filename_image: tab_obj.entryPicPath != "" ? tab_obj.entryPicPath : undefined,
            });
        }

        let filename = name_index ? makeFileName(getLanguage('EN')[name_index] || `dungeon_${obj.id}`) : `dungeon_${obj.id}`;
        accum[filename] = data;

        return accum;
    }, {});

    return mydungeons;
}

function getSceneKey() {
    let { key_entry, key_dungeon } = (() => {
        for (let key_entry in xpoint[3]) {
            if (xpoint[3][key_entry][1] != undefined) {
                for (let key_dungeon in xpoint[3][key_entry][1]) {
                    if (xpoint[3][key_entry][1][key_dungeon][0] == 4007) {
                        return { key_entry, key_dungeon };
                    }
                }
            }
        }
    })();

    for (let key_name in xpoint[3][key_entry][1]) {
        if (xpoint[3][key_entry][1][key_name] == 'UI_DUNGEON_ENTRY_1') {
            return { key_entry, key_dungeon, key_name };
        }
    }
}

module.exports = collateDungeon;