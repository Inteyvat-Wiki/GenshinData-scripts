// Select exact circular portrait resources explicitly referenced by stage opponents.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const [source, mapFile, output] = process.argv.slice(2);
assert(output, 'Usage: node resources/prepare-tcg-portraits.js SOURCE IMAGE_MAP NEW_CACHE');
const iconFile = path.resolve(source, 'ExcelBinOutput/GCGTalkDetailIconExcelConfigData.json');
const stageFile = path.resolve(source, 'ExcelBinOutput/GCGGameRewardExcelConfigData.json');
const ids = new Set(JSON.parse(fs.readFileSync(stageFile, 'utf8')).map(row => row.oppoAvatarPicId));
const icons = JSON.parse(fs.readFileSync(iconFile, 'utf8')).filter(row => ids.has(row.id));
const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
assert.equal(digest(map.map), map.sha256, 'Asset map snapshot changed');
const resources = {};
for (const row of icons) {
    const name = row.FLNKMCFIMKJ;
    assert(/^UI_[A-Za-z0-9_]+$/.test(name), `Invalid circular portrait: ${row.id}`);
    const candidates = map.entries.filter(image => image.Name === name && image.Type === 'Sprite');
    assert(candidates.length, `Missing circular portrait: ${row.id}/${name}`);
    for (const image of candidates) resources[`${row.id}:${image.Source}:${image.PathID}`] = { image };
}
const inputs = [iconFile, stageFile, path.resolve(mapFile), map.map].map(file => ({ file, sha256: digest(file) }));
fs.writeFileSync(output, JSON.stringify({ schema: 1, image_selection: 'largest', inputs, resources }, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ portraits: icons.length, output }));
