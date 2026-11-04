const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMaps } = require('./catalogue');
const { fixture } = require('./fixtures/field-inference');

test('world-map exclusions use explicit point or mark rules, never completeness or model hiding', () => {
    const bins = {
        'Global/Mark/ConfigMarkGlobal': {
            sceneBuildingMarks: { GeneralCargo: 'MarkShop' },
            markIconConfig: {
                MarkShop: { visibilityOnMap: 'Invisible', visibilityOnRadar: 'Around', title: 'NAME', desc: 'DESC', iconName: 'PresentIcon' },
                MarkTransPoint: { visibilityOnMap: 'Invisible' },
                MarkOther: { visibilityOnMap: 'Always' },
            },
        },
        'Scene/Point/scene3_point': { points: {
            1: { $type: 'CPKNFPOIAPH', buildingType: 'GeneralCargo' },
            2: { $type: 'KCLOMFJNGIA', markIconTypeName: 'MarkShop', mapVisibility: 'OnUnlocked' },
            3: { $type: 'NKJPPNFAEEF', mapVisibility: 'Never', titleTextID: 'NAME', descTextID: 'DESC' },
            4: { $type: 'BHJILFMHGEE', KNJICCLDJDF: true },
            5: { $type: 'AIEKKMCCLLN', unlocked: true },
            6: { $type: 'BHJILFMHGEE', mapVisibility: 'OnUnlocked' },
            7: { buildingType: 'GeneralCargo', markIconTypeName: 'MarkOther' },
        } },
    };
    const records = buildMaps('EN', fixture({ ManualTextMapConfigData: [
        { textMapId: 'NAME', textMapContentTextMapHash: 1 }, { textMapId: 'DESC', textMapContentTextMapHash: 2 }],
    }, bins, { 1: 'Name present', 2: 'Description present' }));
    assert.equal(records['point-3-1'].name, 'Name present');
    assert.equal(records['point-3-1'].description, 'Description present');
    assert.equal(records['point-3-1'].data.icon, 'PresentIcon');
    assert.deepEqual([1, 2, 3].map(id => records[`point-3-${id}`].data.map_display), [
        { status: 'excluded', reason: 'explicit-mark-invisible' },
        { status: 'excluded', reason: 'explicit-mark-invisible' },
        { status: 'excluded', reason: 'point-never' },
    ]);
    // A preview icon is not an authoritative runtime mark selection.
    assert.equal(records['point-3-4'].data.icon_source, 'category-preview');
    for (const id of [4, 5, 7]) assert.equal(records[`point-3-${id}`].data.map_display.status, 'unresolved');
    assert.deepEqual(records['point-3-6'].data.map_display, { status: 'conditional', reason: 'point-on-unlocked' });
    assert.equal(records['map-icon-MarkShop'].data.radar_visibility, 'Around');
});
