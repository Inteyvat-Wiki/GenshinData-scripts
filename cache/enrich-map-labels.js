// Add newly decoded labels to an existing map snapshot without reparsing newer
// obfuscated tables. Text comes from the snapshot's pinned Git revision.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { openSnapshot, putJSON, publish, digest } = require('./storage');
const { PROFILE, buildSurfaceLabels, surfaceLabelRecords } = require('../extract/maps/surface-labels');
function enrichMapLabels(cacheRoot, snapshotId, baseFile, sourceRoot) {
    const base = require('../resources/map-base').readResourceCache(baseFile);
    const labels = buildSurfaceLabels(base, JSON.parse(fs.readFileSync(base.plan.prefabCacheFile, 'utf8')));
    const lock = path.join(cacheRoot, 'prepare.lock'); fs.mkdirSync(lock);
    try {
        const previous = openSnapshot({ cacheRoot, snapshotId }), manifest = previous.manifest();
        assert.equal(openSnapshot({ cacheRoot }).snapshotId, snapshotId, 'Pinned snapshot is not current');
        const revision = manifest.plan.source.head; assert(/^[a-f0-9]{40}$/.test(revision));
        const inputs = [];
        const readPinned = file => {
            const bytes = execFileSync('git', ['show', `${revision}:${file}`], { cwd: sourceRoot, maxBuffer: 256 * 1024 * 1024, windowsHide: true });
            inputs.push({ file, revision, sha256: digest(bytes) }); return JSON.parse(bytes);
        };
        const table = readPinned('ExcelBinOutput/ManualTextMapConfigData.json');
        const files = structuredClone(manifest.files);
        for (const [language, suffix] of [['ChineseSimplified', 'CHS'], ['English', 'EN']]) {
            // Match getTextMap(): Medium contains UI names absent from the main file.
            const textMap = Object.assign(readPinned(`TextMap/TextMap${suffix}.json`), readPinned(`TextMap/TextMap_Medium${suffix}.json`));
            const records = Object.fromEntries(previous.keys(language, 'maps').map(key => [key, previous.getRecord(language, 'maps', key)]));
            // Detect a dirty original TextMap or a mismatched historical revision.
            for (const record of Object.values(records).filter(record => record.kind === 'map_place')) {
                const hash = table.find(row => row.textMapId === record.data.text_key)?.textMapContentTextMapHash;
                assert.equal(String(hash), record.texts.find(text => text.role === 'name')?.hash, `Pinned label key mismatch: ${record.id}`);
                assert.equal(textMap[String(hash)], record.name, `Pinned label text mismatch: ${record.id}`);
            }
            const added = surfaceLabelRecords(labels, baseFile, {
                source: { excel: name => { assert.equal(name, 'ManualTextMapConfigData'); return table; }, text: (_lang, hash) => textMap[hash] || '' },
                language, catalogue: records,
            });
            for (const record of Object.values(added)) {
                assert.equal(record.diagnostics.length, 0, `Incomplete surface label: ${record.id}`);
                const key = `${language}/maps/${record.id}.json`;
                assert(!files[key], `Existing label must not be overwritten: ${key}`);
                files[key] = { hash: putJSON(cacheRoot, record), id: record.id };
            }
        }
        const plan = { ...manifest.plan, mapSurfaceLabels: { profile: PROFILE, parent: snapshotId,
            resource: { file: path.resolve(baseFile), sha256: digest(fs.readFileSync(baseFile)) }, inputs,
            code: [__filename, require.resolve('../extract/maps/surface-labels'), require.resolve('../extract/maps/atlas')]
                .map(file => ({ file, sha256: digest(fs.readFileSync(file)) })) } };
        plan.key = digest(JSON.stringify(plan)); return publish(cacheRoot, files, plan, previous);
    } finally { fs.rmdirSync(lock); }
}
module.exports = { enrichMapLabels };
if (require.main === module) {
    const result = enrichMapLabels(...process.argv.slice(2));
    console.log(JSON.stringify({ snapshotId: result.snapshotId, added: result.manifest().changes.added.length }));
}
