const assert = require('node:assert/strict');
const { decodeObject } = require('./unity');

// Current client SceneScriptData prefix. Member names are stripped: mapReference
// describes the verified PPtr target, not a recovered C# field name. Do not scan
// arbitrary bytes for matching IDs or infer this reference from scene/map names.
function decodeSceneScript(bytes, metadata) {
    const header = decodeObject(bytes, metadata);
    assert.equal(header.type, 'MonoBehaviour');
    assert.equal(header.gameObject.PathID, '0');
    assert.equal(header.enabled, 1);
    let offset = header.dataOffset;
    function take(n) { assert(Number.isSafeInteger(n) && n >= 0 && offset + n <= bytes.length, 'Truncated SceneScriptData'); const at = offset; offset += n; return at; }
    function string() {
        const size = bytes.readInt32LE(take(4)); assert(size >= 0 && size < 4096, 'Unsupported SceneScriptData string');
        const at = take(size), value = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(at, at + size));
        take((4 - offset % 4) % 4); return value;
    }
    const prefixStrings = Array.from({ length: 6 }, string);
    const prefixVector = Array.from({ length: 3 }, () => bytes.readFloatLE(take(4)));
    assert(prefixVector.every(Number.isFinite));
    const mapReferenceOffset = offset;
    const mapReference = { fileID: bytes.readInt32LE(take(4)), PathID: bytes.readBigInt64LE(take(8)).toString() };
    assert(mapReference.fileID >= 0, 'Invalid SceneScriptData reference');
    const followingString = string();
    return { name: header.name, script: header.script, prefixStrings, prefixVector,
        mapReference, mapReferenceOffset, followingString, unparsedOffset: offset, unparsedBytes: bytes.length - offset };
}

function sceneGroups(rows) {
    assert(Array.isArray(rows)); const groups = new Map(), ids = new Set();
    for (const row of rows) {
        assert(Number.isSafeInteger(row.id) && row.id > 0 && !ids.has(row.id), 'Invalid/duplicate scene ID'); ids.add(row.id);
        const name = row.scriptData || ''; assert.equal(typeof name, 'string');
        if (!groups.has(name)) groups.set(name, { scriptData: name, sceneIds: [], sceneTypes: [] });
        const group = groups.get(name); group.sceneIds.push(row.id);
        if (row.type && !group.sceneTypes.includes(row.type)) group.sceneTypes.push(row.type);
    }
    return [...groups.values()].sort((a, b) => a.scriptData.localeCompare(b.scriptData)).map(group => ({ ...group,
        sceneIds: group.sceneIds.sort((a, b) => a - b), sceneTypes: group.sceneTypes.sort() }));
}

// Tile prefixes are a separate, explicitly verified image naming convention.
// They may restrict supported rendering, but never discover scene/map links.
function selectBaseEntries(entries, tilePrefixes) {
    const unique = new Map();
    for (const entry of entries) {
        if (entry.status !== 'map-config' || !Object.hasOwn(tilePrefixes, entry.config.name)) continue;
        const key = JSON.stringify([entry.mapSource.Source, entry.mapSource.Offset, entry.mapSource.PathID]);
        const prior = unique.get(key);
        if (prior) {
            assert.deepEqual(prior.config, entry.config, 'Conflicting shared map config');
            prior.sceneIds = [...new Set([...prior.sceneIds, ...entry.sceneIds])].sort((a, b) => a - b);
            prior.scriptData.push(entry.scriptData);
        } else unique.set(key, { config: entry.config, mapSource: entry.mapSource,
            sceneIds: [...entry.sceneIds], scriptData: [entry.scriptData], tilePrefix: tilePrefixes[entry.config.name] });
    }
    return [...unique.values()].sort((a, b) => a.config.name.localeCompare(b.config.name));
}
module.exports = { decodeSceneScript, sceneGroups, selectBaseEntries };
