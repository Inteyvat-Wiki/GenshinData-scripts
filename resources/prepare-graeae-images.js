// Named attachment resources, not UInt64 icon keys. Preserve every exact-name
// Sprite candidate so the common importer can choose the full-resolution image.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const [source, mapFile, output] = process.argv.slice(2);
assert(output, 'Usage: node resources/prepare-graeae-images.js SOURCE ASSET_MAP NEW_CACHE');
const file = path.resolve(source, 'ExcelBinOutput/TpsGlassesChatMessageExcelConfigData.json');
const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
const names = new Set(rows.filter(row => row.FJHBPBFGDNN === 'IMAGE').map(row => {
    assert(typeof row.HCHADPEJPLB === 'string', 'Missing full attachment resource');
    const name = row.HCHADPEJPLB.split('/').at(-1);
    assert(/^UI_[A-Za-z0-9_]+$/.test(name));
    return name;
}));
const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
assert.equal(digest(map.map), map.sha256, 'Asset map snapshot changed');
const resources = {};
for (const name of names) {
    const candidates = map.entries.filter(row => row.Name === name && row.Type === 'Sprite');
    assert(candidates.length, `Missing named attachment: ${name}`);
    for (const image of candidates) {
        assert(/^-?\d+$/.test(image.PathID));
        const key = `${image.Source}:${image.PathID}`;
        assert(!resources[key], 'Duplicate named resource identity');
        resources[key] = { image };
    }
}
const inputs = [file, path.resolve(mapFile), map.map].map(file => ({ file, sha256: digest(file) }));
fs.writeFileSync(output, JSON.stringify({ schema: 1, image_selection: 'largest', inputs, resources }, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ names: names.size, candidates: Object.keys(resources).length, output }));
