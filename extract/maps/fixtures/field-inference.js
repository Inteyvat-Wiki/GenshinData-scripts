// Synthetic fixtures retaining the former property spellings. Witness values
// are copied from the real source records documented in docs/maps.md.
const FIELDS = { group: 'EJBIMCMCAGN', floorName: 'KGGGIELJAEE', floorNewName: 'BGNMBLPLPCO',
    floorNumber: 'ALFNKAMMBLD', floorCondition: 'FPJOHFEDDKL', floor: 'JBACHLCJFPA',
    groupAreas: 'HCEGNMLIKLP', groupReference: 'AINEPEKKEDH', pointFloor: 'IOAKKHJPFEI',
    pointArea: 'EABBCMGNLEL', quests: 'JIJKODHIEED', questId: 'NFGFDHPPBIF',
    questName: 'NBOJMAHCCGM', questOrder: 'GBFIFKGFKHD', finish: 'FAPCNCGCEBJ', fail: 'CNPOFCKIBDL',
    configurationName: 'GEBLJONICEL', entryType: 'NPFLMLBMDLL', regionGroup: 'IHNCACBAGEH',
    regions: 'NGGJDLACPDL', regionLayer: 'PHNBMMHNELF', npcIds: 'OBGFDDLJKKI' };
const tables = {
    WorldAreaConfigData: [{ id: 1100, areaID1: 1, sceneID: 3, areaType: 'LEVEL_1', [FIELDS.configurationName]: 1333393882 },
        { id: 1101, areaID1: 1, areaID2: 101, sceneID: 3, areaType: 'LEVEL_2', [FIELDS.configurationName]: 3060720010 }],
    MapLayerGroupExcelConfigData: [{ id: 31101, [FIELDS.groupAreas]: [11], [FIELDS.groupReference]: 3110101 }],
    MapLayerFloorExcelConfigData: [{ id: 3110101, [FIELDS.group]: 31101, [FIELDS.floorNumber]: -1,
        [FIELDS.floorName]: 282263247, [FIELDS.floorNewName]: 417561169, [FIELDS.floorCondition]: {} },
        { id: 3200501, [FIELDS.group]: 32005, [FIELDS.floorNumber]: -1, [FIELDS.floorName]: 573230639,
            [FIELDS.floorNewName]: 3837892241, [FIELDS.floorCondition]: { type: 'MAP_FLOOR_NAME_CHANGE_QUEST', paramList: [7306622] } }],
    MapLayerExcelConfigData: [{ id: 3110103, [FIELDS.floor]: 3110102 }],
};
const bins = {
    'Scene/Point/scene3_point': { points: {
        8: { $type: 'BHJILFMHGEE', gadgetId: 70110002, pos: { x: 2197.455, y: 214.8022, z: -1122.173 } },
        21: { $type: 'KLKMMEJFBDC', gadgetId: 70010002, pos: { x: 2120.139, y: 204.8979, z: -1157.901 } },
        27: { $type: 'GENHLJIPFFM', gadgetId: 70010002, pos: { x: 2243.504, y: 238.643, z: -778.8833 } },
        45: { $type: 'NKJPPNFAEEF', gadgetId: 70120008, pos: { x: 1638.538, y: 194.375, z: -2666.921 }, [FIELDS.pointArea]: 205, [FIELDS.entryType]: 'Tower' },
        48: { [FIELDS.pointArea]: 106, [FIELDS.entryType]: 'Daily' },
        55: { $type: 'CPKNFPOIAPH', gadgetId: 70010001, pos: { x: 2355.06, y: 261.0227, z: -684.8734 } },
        317: { $type: 'JCPGFFBDJBD', gadgetId: 70370273, pos: { x: -3290.632, y: 200.6837, z: -3647.401 } },
        439: { $type: 'KCLOMFJNGIA', gadgetId: 70010001, pos: { x: -389.5971, y: 214.4649, z: -1146.736 } },
        1304: { [FIELDS.pointFloor]: 3460401 },
    } },
    'Scene/Point/scene1006_point': { points: {
        1: { $type: 'DLMGIOABAKF', gadgetId: 70120003, pos: { x: 11.6215, y: -3.071995, z: 50.15282 } },
        4: { $type: 'AIEKKMCCLLN', gadgetId: 70120004, pos: { x: 166.2599, y: 81.45801, z: -22.14835 } },
        5: { $type: 'LLAENFGPFDI', gadgetId: 70010006, pos: { x: -32.59365, y: 1, z: 53.14494 } },
    } },
    'Quest/353': { id: 353, [FIELDS.quests]: [
        { [FIELDS.questId]: 35302, [FIELDS.questName]: 3726907551, [FIELDS.questOrder]: 3,
            [FIELDS.fail]: [{ type: 'QUEST_EXEC_ROLLBACK_QUEST', param: ['35302'] }] },
        { [FIELDS.questId]: 35311, [FIELDS.finish]: [{ type: 'QUEST_EXEC_SET_OPEN_STATE', param: ['2', '1'] },
            { type: 'QUEST_EXEC_SET_OPEN_STATE', param: ['1', '1'] }] },
    ] },
    'MultilayerMapRegion/31101': { [FIELDS.regionGroup]: 31101,
        [FIELDS.regions]: [{ [FIELDS.regionLayer]: 3110101 }, { [FIELDS.regionLayer]: 3110102 }] },
    'Scene/SceneNpcBornNoGroup/scene1085_npcborn_nogroup': { sceneId: 1085, bornPosList: [
        { _id: 405100000, _configId: 5100, preConditions: [[{ $type: 'ICEFINJKEDH', [FIELDS.npcIds]: [108502] }]] },
    ] },
};
function fixture(inputTables = {}, inputBins = {}, texts = {}) {
    const data = { tables: structuredClone(inputTables), bins: structuredClone(inputBins) };
    for (const [name, anchors] of Object.entries(tables)) if (data.tables[name]?.length) {
        const ids = new Set(data.tables[name].map(row => row.id));
        data.tables[name].push(...structuredClone(anchors.filter(row => !ids.has(row.id))));
    }
    if (Object.keys(data.bins).some(file => /^Scene\/Point\/scene.*_point$/.test(file))) {
        const file = 'Scene/Point/scene3_point', original = data.bins[file]?.points || {};
        data.bins[file] = { points: { ...structuredClone(bins[file].points), ...original } };
        for (const [id, anchor] of Object.entries(bins[file].points)) data.bins[file].points[id] = { ...anchor, ...data.bins[file].points[id] };
        data.bins['Scene/Point/scene1006_point'] ||= structuredClone(bins['Scene/Point/scene1006_point']);
    }
    if (Object.keys(data.bins).some(file => file.startsWith('Quest/'))) data.bins['Quest/353'] ||= structuredClone(bins['Quest/353']);
    return { ...data, excel: name => data.tables[name] || [], bin: name => data.bins[name] || {},
        files: dir => Object.keys(data.bins).filter(name => name.startsWith(`${dir}/`)),
        walkFiles: () => [], worldAreas: () => [], text: (_language, hash) => texts[hash] || '' };
}
module.exports = { FIELDS, tables, bins, fixture };
