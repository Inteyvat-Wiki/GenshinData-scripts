const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const [cacheFile, destination, studio = 'C:/Apps/AnimeStudio'] = process.argv.slice(2);
assert(destination, 'Usage: node resources/extract-miliastra-images.js CACHE NEW_OUTPUT [STUDIO]');
const { readResourceCache } = require('./miliastra');
const cache = readResourceCache(path.resolve(cacheFile)); // shared snapshot validation, also supports profile frames
fs.mkdirSync(destination); // never overwrite/merge an earlier extraction
const groups = new Map();
for (const record of Object.values(cache.resources)) {
    const image = record.image, key = `${image.Source}:${image.Type}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(image);
}
const directories = new Set([...groups.values()].map(rows => path.dirname(rows[0].Source)));
for (const directory of directories) assert(!fs.readdirSync(directory).some(name => /\.split/i.test(name)), 'Refuse split-file merging');
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
let batch = 0;
for (const rows of groups.values()) for (let start = 0; start < rows.length; start += 80) {
    const entries = rows.slice(start, start + 80), label = String(++batch).padStart(4, '0');
    const xml = path.resolve(destination, `${label}.xml`), output = path.resolve(destination, label);
    const content = entries.map(entry => '  <Asset>\n' + ['Name', 'Container', 'Type', 'PathID', 'Source']
        .map(field => `    <${field}>${escape(entry[field])}</${field}>`).join('\n') + '\n  </Asset>').join('\n');
    fs.writeFileSync(xml, '<?xml version="1.0" encoding="utf-8"?>\n<Assets>\n' + content + '\n</Assets>\n', { flag: 'wx' });
    const types = entries[0].Type === 'Sprite' ? ['Texture2D:Parse', 'Sprite:Both'] : ['Texture2D:Both', 'Sprite:Parse'];
    const names = '\\A(?:' + entries.map(entry => entry.Name).join('|') + ')\\z';
    const log = fs.openSync(path.join(destination, `${label}.log`), 'wx');
    try {
        const result = spawnSync(path.join(studio, 'AnimeStudio.CLI.exe'), [xml, output, '--game', 'GI', '--map_op', 'Load,AssetMap',
            '--map_type', 'XML', '--map_name', xml, '--types', ...types, '--names', names,
            '--group_assets', 'BySource', '--export_type', 'Convert'], { stdio: ['ignore', log, log], windowsHide: true });
        if (result.error) throw result.error;
        assert.equal(result.status, 0, `Extraction failed: ${label}.log`);
    } finally { fs.closeSync(log); }
    console.log(`Batch ${label}: ${entries.length} ${entries[0].Type} requested`);
}
fs.copyFileSync(cacheFile, path.join(destination, 'resource-plan.json'), fs.constants.COPYFILE_EXCL);
