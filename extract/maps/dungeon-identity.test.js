const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('dungeon extraction preserves unique entrance identity alongside repeated legacy point IDs', () => {
    const table = [
        { id: 2, sceneId: 3, dungeonEntryId: 50, descTextMapHash: 11, descriptionCycleRewardList: [] },
        { id: 1047, sceneId: 9, dungeonEntryId: 50, descTextMapHash: 12, descriptionCycleRewardList: [] },
    ];
    const bins = {
        'Scene/Point/scene3_point': { points: {
            1: { dungeonIds: [4007], titleTextID: 'UI_DUNGEON_ENTRY_1' },
            50: { titleTextID: 'MAIN_ENTRANCE' },
        } },
        'Scene/Point/scene9_point': { points: { 50: { titleTextID: 'EVENT_ENTRANCE' } } },
    };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../extractDungeon.js'), 'utf8'), {
        module, require: name => { assert.equal(name, './global.js'); },
        getExcel: name => name === 'DungeonEntryExcelConfigData' ? table : name === 'ManualTextMapConfigData' ? [
            { textMapId: 'MAIN_ENTRANCE', textMapContentTextMapHash: 1 },
            { textMapId: 'EVENT_ENTRANCE', textMapContentTextMapHash: 2 },
        ] : [],
        getBin: name => bins[name],
        getLanguage: () => ({ 1: 'Cecilia Garden', 2: 'Event entrance', 11: 'Main description', 12: 'Event description' }),
        sanitizeDescription: value => value || '', makeFileName: value => value.toLowerCase().replaceAll(' ', '_'),
    });
    const result = JSON.parse(JSON.stringify(module.exports('EN')));
    assert.equal(result.cecilia_garden.id, 50);
    assert.equal(result.cecilia_garden.entryId, 2);
    assert.equal(result.cecilia_garden.sceneId, 3);
    assert.equal(result.event_entrance.id, 50);
    assert.equal(result.event_entrance.entryId, 1047);
    assert.equal(result.event_entrance.sceneId, 9);
    assert.equal(result.cecilia_garden.description, 'Main description');
    assert.equal(result.event_entrance.description, 'Event description');
});
