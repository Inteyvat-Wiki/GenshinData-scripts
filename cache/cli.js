const provider = require('../index');
const { extractors } = require('./registry');

function parse(args) {
    const command = args.shift() || 'help', options = {};
    const flags = new Map([['--source', 'sourceRoot'], ['--cache', 'cacheRoot'], ['--lua', 'luaRoot'],
        ['--snapshot', 'snapshotId'], ['--folders', 'folders'], ['--languages', 'languages'],
        ['--history-refs', 'historyRefs'], ['--history-seed', 'historySeedCache'],
        ['--miliastra-resources', 'miliastra'], ['--profile-frame-resources', 'profileFrames'], ['--map-resources', 'maps'], ['--map-icon-resources', 'mapIcons'], ['--world-area-resources', 'worldAreas'],
        ['--map-area-config-resources', 'mapAreaConfigs'], ['--map-base-resources', 'mapBase'], ['--map-fog-resources', 'mapFog'], ['--level-tag-resources', 'levelTags']]);
    while (args.length) {
        const flag = args.shift();
        if (flag === '--no-versions') { options.versions = false; continue; }
        if (flag === '--force') { options.force = true; continue; }
        if (!flags.has(flag)) throw new Error(`Unknown option ${flag}`);
        const value = args.shift();
        if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
        const name = flags.get(flag);
        if (name === 'folders' || name === 'languages' || name === 'historyRefs') options[name] = value.split(',').filter(Boolean);
        else if (['miliastra', 'profileFrames', 'maps', 'mapIcons', 'worldAreas', 'mapAreaConfigs', 'mapBase', 'mapFog', 'levelTags'].includes(name)) (options.resourceCaches ||= {})[name] = value;
        else options[name] = value;
    }
    if (options.folders?.includes('all')) options.folders = [...Object.keys(extractors), 'interactions'];
    if (!['prepare', 'inspect', 'verify', 'help'].includes(command)) throw new Error(`Unknown command ${command}`);
    return { command, options };
}
async function main(args = process.argv.slice(2)) {
    const { command, options } = parse([...args]);
    if (command === 'help') {
        console.log('cache prepare --source PATH --cache PATH --folders characters,misc [--languages CHS,EN] [--no-versions] [--force]\ncache inspect|verify --cache PATH [--snapshot ID]');
        return;
    }
    const snapshot = command === 'prepare'
        ? await provider.prepare({ ...options, log: message => process.stderr.write(message + '\n') })
        : provider.openSnapshot(options);
    if (command === 'verify') snapshot.verify();
    const manifest = snapshot.manifest();
    console.log(JSON.stringify({ snapshotId: snapshot.snapshotId, verified: command === 'verify' || command === 'prepare',
        versionMethod: manifest.plan.versionMethod || 'unknown', source: manifest.plan.source, history: manifest.plan.history, catalog: snapshot.catalog(),
        changes: Object.fromEntries(Object.entries(manifest.changes).map(([kind, keys]) => [kind, keys.length])) }, null, 2));
}
module.exports = { main, parse };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
