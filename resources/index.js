// Lazy public namespaces: importing this API never reads resource/game inputs.
const modules = {
    worldAreas: './world-areas', mapAreaConfigs: './map-area-configs',
    mapIcons: './map-icons', mapAtlas: './map-atlas', maps: './maps',
    mapEntries: './map-entries', mapBase: './map-base', mapFog: './map-fog',
    mapLimitOutlines: './map-limit-outlines', mapEffects: './map-effects',
    levelTags: './level-tag-groups', miliastra: './miliastra',
    profileFrames: './profile-frames', tcgPortraits: './prepare-tcg-portraits',
    graeaeImages: './prepare-graeae-images', images: './extract-miliastra-images',
};
for (const [name, file] of Object.entries(modules))
    Object.defineProperty(exports, name, { enumerable: true, get: () => require(file) });
exports.cachePath = require('../runtime-paths').resourceCachePath;

// No automatic discovery plan. Each adapter delegates to the verified game
// preparer; required roots, scene IDs and raw report inputs remain explicit.
exports.supportedKinds = Object.freeze(Object.keys(modules));
exports.prepare = function prepare(kind, options = {}) {
    if (!Object.hasOwn(modules, kind))
        throw new Error(`Unsupported resource kind: ${kind}. Supported kinds: ${exports.supportedKinds.join(', ')}`);
    const path = require('node:path');
    const output = options.output || options.destination;
    if (typeof output !== 'string' || !output.trim())
        throw new Error(`Resource preparation (${kind}) requires an explicit new output path.`);
    const api = exports[kind];
    const source = options.sourceRoot || options.source || options.data;
    let result, file;
    switch (kind) {
        case 'miliastra':
        case 'profileFrames':
            result = api.prepare(options.index, options.mapFile, output, source, options.selections);
            file = output;
            break;
        case 'tcgPortraits':
            result = api.prepare(source, options.mapFile, output);
            file = output;
            break;
        case 'graeaeImages':
            result = api.prepareGraeaeImages(source, options.mapFile, output);
            file = output;
            break;
        case 'images':
            result = api.run(options.cacheFile, output, options.studio, { dotnet: options.dotnet, game: options.game, timeoutMs: options.timeoutMs });
            file = path.join(output, 'extraction-report.json');
            break;
        case 'levelTags':
            result = api.buildCache({ ...options, output });
            file = output;
            break;
        case 'mapAtlas':
            result = api.prepareAtlas({ ...options, data: source, output });
            file = result.file;
            break;
        default:
            result = api.prepare({ ...options, sourceRoot: source, data: source, output });
            file = result.file || (kind === 'mapFog' ? path.join(output, 'map-fog.json') : undefined);
    }
    return { kind, cachePath: file && path.resolve(file), result };
};
