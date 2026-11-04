const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const { cacheDirectory, digest, readJSON, atomicJSON, openSnapshot, captureDirectory } = require('./storage');
const { recalculateVersions } = require('./versions');
const { select } = require('./registry');
const project = path.resolve(__dirname, '..');

function git(root, args) { return childProcess.execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true }); }
function files(root) {
    return fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
        const file = path.join(root, entry.name);
        if (entry.isSymbolicLink()) throw new Error(`Symlink in cache input: ${file}`);
        return entry.isDirectory() ? files(file) : entry.isFile() ? [file] : [];
    });
}
function fileHash(file) {
    const crypto = require('node:crypto'), hash = crypto.createHash('sha256');
    const fd = fs.openSync(file, 'r'), buffer = Buffer.alloc(1024 * 1024);
    try { let size; while ((size = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, size)); }
    finally { fs.closeSync(fd); }
    return hash.digest('hex');
}
function codeHash() {
    const paths = ['extract', 'versions', 'cache'].flatMap(dir => files(path.join(project, dir)))
        .filter(file => file.endsWith('.js') && !file.endsWith('.test.js'));
    paths.push(path.join(project, 'runtime-config.js'));
    // Match the package's resources/*.js boundary, including new resource decoders.
    // Never traverse resource inputs, compiled helpers or extraction caches.
    for (const entry of fs.readdirSync(path.join(project, 'resources'), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.name.endsWith('.js') || entry.name.endsWith('.test.js')) continue;
        if (!entry.isFile()) throw new Error(`Invalid resource code input: ${entry.name}`);
        paths.push(path.join(project, 'resources', entry.name));
    }
    return digest(JSON.stringify(paths.map(file => [path.relative(project, file).replaceAll('\\', '/'), fileHash(file)])));
}
function sourceState(sourceRoot) {
    if (path.resolve(git(sourceRoot, ['rev-parse', '--show-toplevel']).trim()) !== sourceRoot) throw new Error('sourceRoot must be the root of the game-data Git repository');
    const inputs = ['ExcelBinOutput', 'BinOutput', 'Readable', 'TextMap'];
    if (git(sourceRoot, ['status', '--porcelain', '--untracked-files=all', '--', ...inputs]).trim())
        throw new Error('Source inputs have uncommitted changes; snapshot preparation requires committed inputs');
    if (git(sourceRoot, ['ls-files', '--others', '--ignored', '--exclude-standard', '--', ...inputs]).trim().split('\n').some(file => /\.(json|txt)$/i.test(file)))
        throw new Error('Source inputs include ignored JSON/text files that are not covered by the Git snapshot');
    const tree = git(sourceRoot, ['ls-tree', '-r', 'HEAD', '--', ...inputs]);
    if (/^120000 /m.test(tree)) throw new Error('Source input symlinks are not supported by snapshot preparation');
    return { head: git(sourceRoot, ['rev-parse', 'HEAD']).trim(), tree: digest(tree) };
}
function runExtractor(config, log) {
    return new Promise((resolve, reject) => {
        const child = childProcess.spawn(process.execPath, [path.join(__dirname, 'extract.js')], {
            cwd: project, windowsHide: true, stdio: ['ignore', log ? 'pipe' : 'inherit', log ? 'pipe' : 'inherit'],
            env: { ...process.env, ...config.resource_caches, GENSHIN_LUA_PATH: config.Lua_folder || '', GENSHIN_DATA_RUNTIME_CONFIG: JSON.stringify(config) },
        });
        if (log) for (const stream of [child.stdout, child.stderr].filter(Boolean)) {
            require('node:readline').createInterface({ input: stream, crlfDelay: Infinity }).on('line', log);
        }
        child.on('error', reject);
        child.on('close', code => code === 0 ? resolve() : reject(new Error(`Extraction failed (${code}); previous snapshot retained`)));
    });
}
function priorSnapshot(root) {
    if (!fs.existsSync(path.join(root, 'current.json'))) return undefined;
    return openSnapshot({ cacheRoot: root });
}
async function prepare(options = {}) {
    const selection = select(options), root = cacheDirectory(options.cacheRoot);
    const sourceRoot = path.resolve(options.sourceRoot || require('../runtime-config').GenshinData_folder || '.');
    const runtime = require('../runtime-config');
    const configuredRefs = runtime.GenshinData_folder && path.resolve(runtime.GenshinData_folder) === sourceRoot ? runtime.textmap_history_refs : undefined;
    const historyRefs = options.historyRefs || configuredRefs || ['HEAD'];
    if (!Array.isArray(historyRefs) || !historyRefs.length || historyRefs.some(ref => typeof ref !== 'string' || !ref || ref.startsWith('-')))
        throw new Error('historyRefs must be a non-empty ordered list of Git refs');
    const overrides = options.versionOverrides || {};
    for (const [ref, version] of Object.entries(overrides)) {
        if (!/^[a-f0-9]{40}$/.test(ref) || typeof version !== 'string' || !/^\d+\.\d+$/.test(version))
            throw new Error('Version overrides must map full commit SHA values to major.minor versions');
    }
    fs.mkdirSync(root, { recursive: true });
    const lock = path.join(root, 'prepare.lock');
    try { fs.mkdirSync(lock); }
    catch (error) { if (error.code === 'EEXIST') throw new Error(`Cache preparation is locked: ${lock}`); throw error; }
    let stage;
    try {
        const source = sourceState(sourceRoot), code = codeHash();
        const luaRoot = selection.folders.includes('tasksubtitles') ? path.resolve(options.luaRoot || process.env.GENSHIN_LUA_PATH || require('../runtime-config').Lua_folder || path.join(project, '.cache/lua')) : undefined;
        const luaState = () => luaRoot ? files(luaRoot).filter(file => /\.(luac|lua|bin|bytes)$/i.test(file)).map(file => [path.relative(luaRoot, file).replaceAll('\\', '/'), fileHash(file)]) : [];
        const lua = luaState();
        if (luaRoot && !lua.length) throw new Error('No task Lua bytecode inputs found');
        const resourceCaches = {};
        if (selection.folders.includes('maps')) {
            resourceCaches.MAP_WORLD_AREA_RESOURCE_CACHE = path.resolve(options.resourceCaches?.worldAreas || process.env.MAP_WORLD_AREA_RESOURCE_CACHE || path.join(project, '.cache/world-areas.json'));
            require('../resources/world-areas').readResourceCache(resourceCaches.MAP_WORLD_AREA_RESOURCE_CACHE);
            resourceCaches.MAP_AREA_CONFIG_RESOURCE_CACHE = path.resolve(options.resourceCaches?.mapAreaConfigs || process.env.MAP_AREA_CONFIG_RESOURCE_CACHE || path.join(project, '.cache/map-area-configs.json'));
            require('../resources/map-area-configs').readResourceCache(resourceCaches.MAP_AREA_CONFIG_RESOURCE_CACHE);
        }
        if (selection.folders.includes('miliastra') && fs.existsSync(path.join(sourceRoot, 'ExcelBinOutput/BeyondCostumeExcelConfigData.json')))
            resourceCaches.MILIASTRA_RESOURCE_CACHE = path.resolve(options.resourceCaches?.miliastra || process.env.MILIASTRA_RESOURCE_CACHE || path.join(project, '.cache/miliastra-resources.json'));
        if (selection.folders.includes('misc') && fs.existsSync(path.join(sourceRoot, 'ExcelBinOutput/ProfileFrameExcelConfigData.json')))
            resourceCaches.PROFILE_FRAME_RESOURCE_CACHE = path.resolve(options.resourceCaches?.profileFrames || process.env.PROFILE_FRAME_RESOURCE_CACHE || path.join(project, '.cache/profile-frame-resources.json'));
        if (selection.folders.includes('maps') && (options.resourceCaches?.maps || process.env.MAP_RESOURCE_CACHE))
            resourceCaches.MAP_RESOURCE_CACHE = path.resolve(options.resourceCaches?.maps || process.env.MAP_RESOURCE_CACHE);
        if (selection.folders.includes('maps') && (options.resourceCaches?.mapIcons || process.env.MAP_ICON_RESOURCE_CACHE))
            resourceCaches.MAP_ICON_RESOURCE_CACHE = path.resolve(options.resourceCaches?.mapIcons || process.env.MAP_ICON_RESOURCE_CACHE);
        if (selection.folders.includes('maps') && (options.resourceCaches?.mapBase || process.env.MAP_BASE_RESOURCE_CACHE))
            resourceCaches.MAP_BASE_RESOURCE_CACHE = path.resolve(options.resourceCaches?.mapBase || process.env.MAP_BASE_RESOURCE_CACHE);
        if (selection.folders.includes('maps') && (options.resourceCaches?.mapFog || process.env.MAP_FOG_RESOURCE_CACHE))
            resourceCaches.MAP_FOG_RESOURCE_CACHE = path.resolve(options.resourceCaches?.mapFog || process.env.MAP_FOG_RESOURCE_CACHE);
        if (selection.folders.includes('maps') && (options.resourceCaches?.levelTags || process.env.MAP_LEVEL_TAG_RESOURCE_CACHE))
            resourceCaches.MAP_LEVEL_TAG_RESOURCE_CACHE = path.resolve(options.resourceCaches?.levelTags || process.env.MAP_LEVEL_TAG_RESOURCE_CACHE);
        const resourceState = () => Object.entries(resourceCaches).map(([name, file]) => {
            const cache = readJSON(file);
            for (const input of cache.inputs || []) if (fileHash(input.file) !== input.sha256) throw new Error(`Stale resource lookup input: ${input.file}`);
            return [name, fileHash(file)];
        });
        const resources = resourceState();
        const extractKey = digest(JSON.stringify({ ...selection, code, sourceTree: source.tree, lua, resources, versionTracking: options.versions !== false }));
        let versionIndex, historyId = null;
        let history;
        if (options.versions !== false) {
            const resolvedRefs = historyRefs.map(ref => git(sourceRoot, ['rev-parse', '--verify', `${ref}^{commit}`]).trim());
            const historyCode = digest(fs.readFileSync(path.join(project, 'versions/textmap.js')));
            const config = { GenshinData_folder: sourceRoot, textmap_history_ref: resolvedRefs, textmap_version_seed: options.historySeedCache,
                textmap_version_overrides: overrides, textmap_version_cache: path.join(root, 'history', digest(JSON.stringify({ sourceRoot, historyCode, overrides, refs: historyRefs }))) };
            versionIndex = await require('../versions/textmap').build(config, options.log || console.log);
            historyId = fileHash(versionIndex);
            const metadata = readJSON(path.join(path.dirname(versionIndex), 'manifest.json'));
            history = { refs: resolvedRefs, snapshots: metadata.snapshots, firstVersion: metadata.firstVersion, lastVersion: metadata.lastVersion };
        }
        const key = digest(JSON.stringify({ extractKey, historyId, history }));
        const plan = { key, extractKey, historyId, history, versionMethod: historyId ? 'chs-en-content-count-min' : 'disabled', source, ...selection };
        const cached = path.join(root, 'plans', `${key}.json`);
        let damaged = false;
        if (!options.force && fs.existsSync(cached)) {
            try {
                const snapshot = openSnapshot({ cacheRoot: root, snapshotId: readJSON(cached).snapshotId });
                snapshot.verify();
                atomicJSON(path.join(root, 'current.json'), { snapshotId: snapshot.snapshotId });
                return snapshot;
            } catch (error) { damaged = true; (options.log || console.warn)(`Rebuilding damaged export cache: ${error.message}`); }
        }
        let previous;
        try { previous = priorSnapshot(root); }
        catch (error) { (options.log || console.warn)(`Cannot reuse previous snapshot: ${error.message}`); }
        if (!options.force && !damaged && previous?.manifest().plan.extractKey === extractKey && historyId) {
            previous.verify();
            return recalculateVersions(root, previous, readJSON(versionIndex), plan);
        }
        const stagingRoot = path.join(root, 'staging');
        fs.mkdirSync(stagingRoot, { recursive: true });
        stage = fs.mkdtempSync(path.join(stagingRoot, 'build-'));
        await runExtractor({ GenshinData_folder: sourceRoot, Lua_folder: luaRoot,
            genshin_output_folder: path.join(stage, 'data'), genshin_export_folder: path.join(stage, 'export'),
            textmap_version_cache: versionIndex && path.dirname(versionIndex), version_tracking: options.versions !== false,
            textmap_version_index_id: historyId,
            resource_caches: resourceCaches,
            cache_selection: selection }, options.log);
        const after = sourceState(sourceRoot);
        if (after.head !== source.head || after.tree !== source.tree || codeHash() !== code || JSON.stringify(luaState()) !== JSON.stringify(lua) || JSON.stringify(resourceState()) !== JSON.stringify(resources))
            throw new Error('Inputs changed during extraction; previous snapshot retained');
        return captureDirectory(root, path.join(stage, 'data'), plan, previous);
    } finally {
        // Only delete the unique work directory created by this invocation.
        if (stage && path.dirname(stage) === path.join(root, 'staging')) fs.rmSync(stage, { recursive: true, force: true });
        fs.rmdirSync(lock);
    }
}
module.exports = { prepare, openSnapshot, cacheDirectory };
