const path = require('node:path');
const { cacheDirectory } = require('./cache/storage');

const resourcePaths = {
    miliastra: ['MILIASTRA_RESOURCE_CACHE', 'miliastra-resources.json'],
    profileFrames: ['PROFILE_FRAME_RESOURCE_CACHE', 'profile-frame-resources.json'],
    worldAreas: ['MAP_WORLD_AREA_RESOURCE_CACHE', 'world-areas.json'],
    mapAreaConfigs: ['MAP_AREA_CONFIG_RESOURCE_CACHE', 'map-area-configs.json'],
    maps: ['MAP_RESOURCE_CACHE', 'maps.json'],
    mapIcons: ['MAP_ICON_RESOURCE_CACHE', 'map-icons.json'],
    mapBase: ['MAP_BASE_RESOURCE_CACHE', 'map-base.json'],
    mapFog: ['MAP_FOG_RESOURCE_CACHE', 'map-fog.json'],
    mapEffects: ['MAP_EFFECT_RESOURCE_CACHE', 'map-effects.json'],
    mapLimitOutlines: ['MAP_LIMIT_OUTLINE_RESOURCE_CACHE', 'map-limit-outlines.json'],
    levelTags: ['MAP_LEVEL_TAG_RESOURCE_CACHE', 'level-tag-groups.json'],
};
function sourceDirectory(sourceRoot, config = require('./runtime-config')) {
    const source = sourceRoot || process.env.GENSHIN_DATA_SOURCE || config.GenshinData_folder;
    if (typeof source !== 'string' || !source.trim())
        throw new Error('sourceRoot is required. Pass prepare({ sourceRoot, ... }), set GENSHIN_DATA_SOURCE, or explicitly select a legacy JSON file with GENSHIN_DATA_CONFIG.');
    return path.resolve(source);
}
function luaDirectory(luaRoot, cacheRoot, config = require('./runtime-config')) {
    return path.resolve(luaRoot || process.env.GENSHIN_LUA_PATH || config.Lua_folder || path.join(cacheDirectory(cacheRoot), 'lua'));
}
function resourceCachePath(name, file, cacheRoot) {
    const entry = resourcePaths[name];
    if (!entry) throw new Error(`Unknown resource cache: ${name}`);
    return path.resolve(file || process.env[entry[0]] || path.join(cacheDirectory(cacheRoot), 'resources', entry[1]));
}
module.exports = { sourceDirectory, luaDirectory, resourceCachePath, resourcePaths };
