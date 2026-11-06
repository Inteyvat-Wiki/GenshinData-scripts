const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeSceneScript, sceneGroups, selectBaseEntries } = require('./scene-entry');
const { linkEntries } = require('../../resources/map-entries');
const i = n => { const b = Buffer.alloc(4); b.writeInt32LE(n); return b; };
const f = n => { const b = Buffer.alloc(4); b.writeFloatLE(n); return b; };
const s = text => { const b = Buffer.from(text); return Buffer.concat([i(b.length), b, Buffer.alloc((4 - b.length % 4) % 4)]); };
const p = (fileID, id) => { const b = Buffer.alloc(12); b.writeInt32LE(fileID); b.writeBigInt64LE(BigInt(id), 4); return b; };
const header = name => [p(0, 0), i(1), p(0, 33), s(name)];
function fixture({ nullMap = false, rootClass = 'SceneScriptData', mapClass = 'MapScriptData' } = {}) {
    const scene = Buffer.concat([...header('ArbitraryScene'), ...['示例场景', 'sector', '', '', '', 'sss'].map(s), ...[0, 2, 3].map(f),
        p(nullMap ? 0 : 1, nullMap ? 0 : '-5526943833772309601'), s('Data/Lua/Level.lua'), i(17)]);
    const map = Buffer.concat([...header('UnrelatedMapName'), ...[0, 0, 1024, 1024].map(f), s('ART/UI/NativeMap'), i(99), ...['', '', '', ''].map(s), i(0)]);
    const script = name => Buffer.concat([s(name), i(0), Buffer.alloc(16), s(name), s('MoleMole'), s('Assembly-CSharp.dll'), Buffer.from([0])]);
    const objects = new Map(), files = [];
    function file(Source, cab, externals, entries) {
        const metadata = { name: cab, unityVersion: '2017.4.30f1\n2', formatVersion: 17, endianness: 0, externals };
        const listed = [];
        for (const [Name, Type, PathID, bytes] of entries) {
            const entry = { Name, Type, Source, Offset: 0, PathID };
            objects.set(`${Source}\0${0}\0${PathID}`, { entry, bytes, source: { file: `${Source}.${PathID}.bin` },
                metadata: { format: 'serialized', bytes: bytes.length, entry, serializedFile: metadata } });
            listed.push({ Name, Type, PathID, bytes: bytes.length, byteStart: '0', classID: Type === 'MonoScript' ? 115 : 114 });
        }
        files.push({ Source, Offset: 0, metadata, objects: listed });
    }
    const path = require('node:path');
    const root = path.resolve('fixture-scene.blk'), target = path.resolve('fixture-map.blk');
    file(root, 'scene-cab', [{ fileID: 1, fileName: 'map-cab' }], [['ArbitraryScene', 'MonoBehaviour', '1', scene], ['', 'MonoScript', '33', script(rootClass)]]);
    file(target, 'map-cab', [], [['UnrelatedMapName', 'MonoBehaviour', '-5526943833772309601', map], ['', 'MonoScript', '33', script(mapClass)]]);
    return { scene, objects, inventory: { schema: 1, files }, candidates: [{ Name: 'ArbitraryScene', Type: 'MonoBehaviour', Source: root, Offset: 0, PathID: '1' }],
        rows: [{ id: 3, scriptData: 'ArbitraryScene', type: 'SCENE_WORLD' }, { id: 20180, scriptData: 'ArbitraryScene', type: 'SCENE_DUNGEON' }] };
}
const links = x => linkEntries(x.rows, x.candidates, x);

test('scene entry uses the external CAB and lossless PPtr, independent of scene/config names and mapId', () => {
    const x = fixture(), [entry] = links(x);
    assert.equal(entry.status, 'map-config'); assert.equal(entry.config.name, 'UnrelatedMapName');
    assert.deepEqual(entry.sceneIds, [3, 20180]); assert.equal(entry.config.mapId, 99);
    assert.equal(entry.sceneConfig.mapReference.PathID, '-5526943833772309601');
    assert.equal(entry.sceneConfig.prefixStrings[0], '示例场景'); assert.equal(entry.sceneConfig.unparsedBytes, 4);
});
test('null map pointers do not infer a map from a resource name', () => {
    const [entry] = links(fixture({ nullMap: true })); assert.equal(entry.status, 'no-map-reference'); assert.equal(entry.config, undefined);
});
test('duplicate scene names are accepted only when all typed map targets have the same verified bytes', () => {
    const x = fixture(), original = x.objects.values().next().value;
    for (const o of x.objects.values()) o.source.sha256 = require('node:crypto').createHash('sha256').update(o.bytes).digest('hex');
    const copy = structuredClone(original); copy.bytes = Buffer.from(copy.bytes); copy.entry.PathID = '2'; copy.metadata.entry.PathID = '2';
    x.objects.set(`${copy.entry.Source}\0${0}\0${2}`, copy);
    x.inventory.files[0].objects.push({ ...x.inventory.files[0].objects[0], PathID:'2' });
    x.candidates.push(copy.entry);
    assert.equal(links(x)[0].status, 'map-config'); assert.equal(links(x)[0].equivalentSceneSources.length, 2);
    x.objects.delete(`${copy.entry.Source}\0${0}\0${2}`);
    assert.equal(links(x)[0].status, 'ambiguous-scene-script');
});
test('wrong CAB and duplicate CAB cannot be resolved through the same PathID in another asset', () => {
    const missing = fixture(); missing.inventory.files[0].metadata.externals[0].fileName = 'wrong-cab';
    assert.equal(links(missing)[0].mapReference.status, 'missing-file');
    const duplicate = fixture(), copy = structuredClone(duplicate.inventory.files[1]); copy.Source = require('node:path').resolve('duplicate-map.blk');
    duplicate.inventory.files.push(copy); assert.equal(links(duplicate)[0].mapReference.status, 'ambiguous-file');
});
test('ambiguous scene names and wrong native MonoScript types remain explicit unresolved entries', () => {
    const x = fixture(); x.candidates.push({ ...x.candidates[0], PathID: '2' }); assert.equal(links(x)[0].status, 'ambiguous-scene-script');
    assert.equal(links(fixture({ rootClass: 'OtherData' }))[0].status, 'unsupported-entry');
    assert.equal(links(fixture({ mapClass: 'OtherData' }))[0].status, 'unsupported-entry');
});
test('truncated scene layout is rejected before following any apparent map reference', () => {
    const x = fixture(), object = x.objects.values().next().value;
    const b = x.scene.subarray(0, 80); assert.throws(() => decodeSceneScript(b, { ...object.metadata, bytes: b.length }), /Truncated/);
});
test('shared native map references produce one render entry and retain all referring scene IDs', () => {
    const [entry] = links(fixture());
    const other = { ...entry, scriptData: 'AnotherScene', sceneIds: [4] };
    const selected = selectBaseEntries([entry, other], { UnrelatedMapName: 'NativeTiles' });
    assert.equal(selected.length, 1); assert.deepEqual(selected[0].sceneIds, [3, 4, 20180]);
    assert.equal(selectBaseEntries([{ ...entry, status: 'unsupported-entry' }], { UnrelatedMapName: 'NativeTiles' }).length, 0);
    assert.equal(selectBaseEntries([entry], {}).length, 0);
    assert.throws(() => sceneGroups([{ id: 3 }, { id: 3 }]), /duplicate/);
});
