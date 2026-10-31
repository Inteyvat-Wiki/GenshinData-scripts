const fs = require('node:fs');
const path = require('node:path');

// Never let JSON.parse round a uint64 resource reference before it reaches images.
function parseSource(json) {
    return JSON.parse(json, (key, value, context) => {
        if (typeof value !== 'number' || !Number.isInteger(value) || Number.isSafeInteger(value)) return value;
        if (!context?.source || !/^-?\d+$/.test(context.source))
            throw new Error('Exact source integers require JSON.parse reviver context (Node 22+).');
        return context.source;
    });
}

const cache = new Map();
function excel(table) {
    require('../global');
    const file = path.join(config.GenshinData_folder, 'ExcelBinOutput', `${table}.json`);
    if (!cache.has(file)) cache.set(file, parseSource(fs.readFileSync(file, 'utf8')));
    return cache.get(file);
}
function text(language, hash) {
    require('../global');
    return hash == null ? '' : getLanguage(language)[String(hash)] || '';
}

module.exports = { excel, text, parseSource };
