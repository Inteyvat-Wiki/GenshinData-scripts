const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { read, hash, verify, evidence, assetKey } = require('./map-evidence');
const { PROFILE, SHA256, decodeLevelTagGroups } = require('../extract/maps/level-tag-groups');
const ASSET = 'Data/_ExcelBinOutput/LevelTagGroupsExcelConfigData.MiHoYoBinData';
function buildCache({ rawReportFile, output }) {
    const e = evidence(), report = e.report(rawReportFile, 'payload');
    const matches = report.resources.filter(resource => resource.Container === assetKey(ASSET).container && resource.sha256 === SHA256);
    assert.equal(matches.length, 1, 'Missing exact LevelTagGroups resource');
    const payload = matches[0];
    for (const file of [__filename, require.resolve('../extract/maps/level-tag-groups')]) e.remember(hash(file));
    const cache = { schema: 1, parser: PROFILE, inputs: [...e.inputs.values()],
        source: { asset: ASSET, resource_key: assetKey(ASSET).resource_key, sha256: payload.sha256, block: path.basename(payload.Source), path_id: payload.PathID },
        payload: { file: payload.file, bytes: payload.bytes, sha256: payload.sha256 }, groups: decodeLevelTagGroups(fs.readFileSync(payload.file)) };
    fs.writeFileSync(output, JSON.stringify(cache, null, 2) + '\n', {flag:'wx'}); return cache;
}
function readResourceCache(file) {
    const cache = read(file); assert.equal(cache.schema, 1); assert.equal(cache.parser, PROFILE);
    for (const input of cache.inputs) verify(input);
    for (const file of [__filename, require.resolve('../extract/maps/level-tag-groups')])
        assert(cache.inputs.some(input => path.resolve(input.file) === path.resolve(file) && input.sha256 === hash(file).sha256), 'Rebuild level-tag cache for current parser');
    assert.equal(cache.source.asset, ASSET); assert.equal(cache.source.sha256, SHA256); verify(cache.payload);
    assert.deepEqual(cache.groups, decodeLevelTagGroups(fs.readFileSync(cache.payload.file)));
    return cache;
}
module.exports = { buildCache, readResourceCache };
if (require.main === module) { const [report, output] = process.argv.slice(2); console.log(JSON.stringify({groups:buildCache({rawReportFile:report,output}).groups.length})); }
