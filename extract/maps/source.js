const fs = require('node:fs');
const path = require('node:path');
function parseSource(json) {
    return JSON.parse(json, (key, value, context) => {
        if (typeof value !== 'number' || Number.isSafeInteger(value) || !Number.isInteger(value)) return value;
        if (!context?.source) throw new Error('Exact map source integers require Node 22+');
        // Float sentinel values (e.g. -3.4028235E+38) are not integer IDs.
        return /^-?\d+$/.test(context.source) ? context.source : value;
    });
}

// Reading is separate from semantic parsing so fixtures never load the real game.
function createSource(root, text, options = {}) {
    const cache = new Map();
    let worldAreas, mapAreaConfigs, mapBase;
    function areaConfigs() {
        if (options.mapAreaConfigs) return options.mapAreaConfigs();
        return mapAreaConfigs ||= require('../../resources/map-area-configs').readResourceCache(require('../../runtime-paths').resourceCachePath('mapAreaConfigs'));
    }
    function read(file) {
        if (!cache.has(file)) cache.set(file, parseSource(fs.readFileSync(path.join(root, file), 'utf8')));
        return cache.get(file);
    }
    function walkFiles(directory) {
        return fs.readdirSync(path.join(root, 'BinOutput', directory), { recursive: true, withFileTypes: true })
            .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
            .map(entry => path.relative(path.join(root, 'BinOutput'), path.join(entry.parentPath, entry.name)).replaceAll('\\', '/').slice(0, -5)).sort();
    }
    return {
        extended: true,
        excel: table => read(`ExcelBinOutput/${table}.json`),
        bin: file => {
            if (/^Scene\/WorldArea(?:\/|$)/i.test(file)) throw new Error('WorldArea geometry must come from client resources');
            if (file === 'Map/MapArea/ConfigMapArea') return areaConfigs().configs;
            return read(`BinOutput/${file}.json`);
        },
        mapAreaConfigs: areaConfigs,
        mapBase: () => {
            if (options.mapBase) return options.mapBase();
            if (!process.env.MAP_BASE_RESOURCE_CACHE) return undefined;
            return mapBase ||= require('../../resources/map-base').readResourceCache(process.env.MAP_BASE_RESOURCE_CACHE);
        },
        files: directory => {
            if (/^Scene\/WorldArea(?:\/|$)/i.test(directory)) throw new Error('WorldArea geometry must come from client resources');
            return fs.readdirSync(path.join(root, 'BinOutput', directory), { withFileTypes: true })
                .filter(entry => entry.isFile() && entry.name.endsWith('.json')).map(entry => `${directory}/${entry.name.slice(0, -5)}`).sort();
        },
        worldAreas: () => {
            // Icon-only discovery explicitly omits geometry; normal map extraction
            // always requires the verified client cache and never reads legacy JSON.
            if (options.worldAreas) return options.worldAreas();
            if (!worldAreas) {
                const file = require('../../runtime-paths').resourceCachePath('worldAreas');
                worldAreas = require('../../resources/world-areas').readResourceCache(file).scenes;
                const required = [...new Set(read('ExcelBinOutput/WorldAreaConfigData.json').map(row => row.sceneID))].sort((a, b) => a - b);
                require('node:assert/strict').deepEqual(worldAreas.map(scene => scene.scene_id).sort((a, b) => a - b), required, 'WorldArea client scene coverage mismatch');
            }
            return worldAreas;
        },
        walkFiles,
        matchingFiles: (directory, needles) => walkFiles(directory).filter(file => {
            const content = fs.readFileSync(path.join(root, 'BinOutput', file + '.json'), 'utf8');
            return needles.some(needle => content.includes(needle));
        }),
        text,
    };
}
module.exports = { createSource, parseSource };
