const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const SCHEMA = 1;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function cacheDirectory(directory) {
    if (directory || process.env.GENSHIN_DATA_CACHE) return path.resolve(directory || process.env.GENSHIN_DATA_CACHE);
    const base = process.platform === 'win32' ? (process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData/Local'))
        : process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Caches') : (process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'));
    return path.join(base, 'Inteyvat-Wiki', 'genshin-data');
}
function safeKey(value) {
    if (typeof value !== 'string' || !value || value.includes('\\') || value.split('/').some(part => !part || part === '.' || part === '..') || path.isAbsolute(value))
        throw new Error(`Invalid cache key: ${value}`);
    return value;
}
function readJSON(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function atomicJSON(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(value), { flag: 'wx' });
    try { fs.renameSync(temporary, file); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function objectPath(root, hash) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid cache content hash');
    return path.join(root, 'objects', hash.slice(0, 2), `${hash}.json`);
}
function putJSON(root, value) {
    const bytes = JSON.stringify(value);
    const hash = digest(bytes), file = objectPath(root, hash);
    // Repair a damaged blob only with content whose digest matches its identity.
    if (!fs.existsSync(file) || digest(fs.readFileSync(file)) !== hash) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const temporary = `${file}.${crypto.randomUUID()}.tmp`;
        fs.writeFileSync(temporary, bytes, { flag: 'wx' });
        fs.renameSync(temporary, file);
    }
    return hash;
}
function snapshotCore(manifest) {
    return { schema: manifest.schema, plan: manifest.plan, files: manifest.files };
}
function openSnapshot({ cacheRoot, snapshotId } = {}) {
    const root = cacheDirectory(cacheRoot);
    if (!snapshotId && !fs.existsSync(path.join(root, 'current.json')))
        throw new Error(`No prepared snapshot in ${root}. Run prepare({ sourceRoot, cacheRoot, folders }) first, or pass the correct cacheRoot and snapshotId.`);
    const id = snapshotId || readJSON(path.join(root, 'current.json')).snapshotId;
    if (!/^[a-f0-9]{64}$/.test(id || '')) throw new Error('Invalid snapshot ID');
    if (!fs.existsSync(path.join(root, 'snapshots', `${id}.json`)))
        throw new Error(`Snapshot ${id} is missing from ${root}. Check cacheRoot/snapshotId or prepare the snapshot again.`);
    const manifest = readJSON(path.join(root, 'snapshots', `${id}.json`));
    if (manifest.schema !== SCHEMA || digest(JSON.stringify(snapshotCore(manifest))) !== id) throw new Error('Invalid snapshot manifest');
    const identityMaps = new Map();
    const auxiliaryCache = new Map();
    const keyCache = new Map();
    const read = key => {
        safeKey(key);
        const entry = manifest.files[key];
        if (!entry) return undefined;
        const bytes = fs.readFileSync(objectPath(root, entry.hash));
        if (digest(bytes) !== entry.hash) throw new Error(`Corrupt snapshot record: ${key}`);
        return JSON.parse(bytes);
    };
    const keys = (language, folder) => {
        safeKey(folder); safeKey(language);
        const prefix = folder === 'interactions' ? 'interactions/' : `${language}/${folder}/`;
        if (!keyCache.has(prefix)) keyCache.set(prefix, Object.keys(manifest.files).filter(key => key.startsWith(prefix) && key.endsWith('.json')).map(key => key.slice(prefix.length, -5)));
        return [...keyCache.get(prefix)];
    };
    const snapshot = {
        snapshotId: id,
        manifest: () => structuredClone(manifest),
        catalog() {
            const languages = new Set(Object.values(require('./registry').languages)), groups = new Map();
            for (const file of Object.keys(manifest.files)) {
                if (!file.endsWith('.json')) continue;
                const parts = file.split('/');
                const language = parts[0] === 'interactions' ? 'Shared' : parts[0];
                const folder = parts[0] === 'interactions' ? 'interactions' : parts[1];
                if (language !== 'Shared' && (!languages.has(language) || parts.length < 3)) continue;
                const key = `${language}/${folder}`;
                if (!groups.has(key)) groups.set(key, { language, folder, count: 0 });
                groups.get(key).count++;
            }
            return [...groups.values()].sort((a, b) => `${a.language}/${a.folder}`.localeCompare(`${b.language}/${b.folder}`));
        },
        keys,
        getRecord(language, folder, key) {
            const numericId = typeof key === 'number';
            key = String(key); safeKey(key);
            const prefix = folder === 'interactions' ? 'interactions/' : `${safeKey(language)}/${safeKey(folder)}/`;
            if (!numericId && manifest.files[`${prefix}${key}.json`]) return read(`${prefix}${key}.json`);
            if (!identityMaps.has(prefix)) {
                const ids = new Map();
                for (const name of keys(language, folder)) {
                    const sourceId = manifest.files[`${prefix}${name}.json`].id;
                    if (sourceId !== undefined) ids.set(String(sourceId), [...(ids.get(String(sourceId)) || []), name]);
                }
                identityMaps.set(prefix, ids);
            }
            const matches = identityMaps.get(prefix).get(key) || [];
            if (matches.length > 1) throw new Error(`Ambiguous source ID ${folder}/${key}; use an exact record key`);
            return matches.length ? read(`${prefix}${matches[0]}.json`) : undefined;
        },
        *entries(language, folder) { for (const key of keys(language, folder)) yield { key, data: snapshot.getRecord(language, folder, key) }; },
        getAuxiliary(kind, folder, key) {
            if (!['image', 'stats', 'curve', 'url', 'version', 'dependencies'].includes(kind)) throw new Error(`Unknown auxiliary kind ${kind}`);
            const file = `${kind}/${safeKey(folder)}.json`;
            if (!auxiliaryCache.has(file)) {
                auxiliaryCache.set(file, read(file));
                if (auxiliaryCache.size > 24) auxiliaryCache.delete(auxiliaryCache.keys().next().value);
            }
            const data = auxiliaryCache.get(file);
            // Metadata can be shared internally, but callers must not mutate this snapshot.
            return structuredClone(key === undefined ? data : data?.[key]);
        },
        getInteractionGiving(id) {
            const file = 'interactions.json';
            if (!auxiliaryCache.has(file)) auxiliaryCache.set(file, read(file));
            return structuredClone(auxiliaryCache.get(file)?.givings?.[id]);
        },
        verify() { for (const key of Object.keys(manifest.files)) read(key); return true; },
    };
    return Object.freeze(snapshot);
}
function publish(root, files, plan, previous) {
    files = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
    const core = { schema: SCHEMA, plan, files };
    const snapshotId = digest(JSON.stringify(core));
    const prior = previous?.manifest().files || {};
    const changes = { added: [], modified: [], removed: [] };
    for (const key of Object.keys(files)) {
        if (!prior[key]) changes.added.push(key);
        else if (prior[key].hash !== files[key].hash) changes.modified.push(key);
    }
    changes.removed = Object.keys(prior).filter(key => !files[key]);
    const manifest = { ...core, snapshotId, parent: previous?.snapshotId || null, changes };
    const file = path.join(root, 'snapshots', `${snapshotId}.json`);
    let valid = false;
    try { valid = digest(JSON.stringify(snapshotCore(readJSON(file)))) === snapshotId; } catch {}
    if (!valid) atomicJSON(file, manifest);
    const snapshot = openSnapshot({ cacheRoot: root, snapshotId });
    snapshot.verify();
    atomicJSON(path.join(root, 'plans', `${plan.key}.json`), { snapshotId });
    atomicJSON(path.join(root, 'current.json'), { snapshotId });
    return snapshot;
}
function captureDirectory(root, directory, plan, previous) {
    const files = {};
    function walk(relative = '') {
        for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const name = relative ? `${relative}/${entry.name}` : entry.name;
            if (entry.isSymbolicLink()) throw new Error(`Symlink in export: ${name}`);
            if (entry.isDirectory()) walk(name);
            else if (entry.isFile() && name.endsWith('.json')) {
                const value = readJSON(path.join(directory, name));
                files[name] = { hash: putJSON(root, value) };
                if (value && ['string', 'number'].includes(typeof value.id)) files[name].id = value.id;
            }
        }
    }
    walk();
    if (!Object.keys(files).length) throw new Error('Refusing to publish an empty export');
    return publish(root, files, plan, previous);
}
module.exports = { SCHEMA, digest, cacheDirectory, safeKey, readJSON, atomicJSON, putJSON, openSnapshot, publish, captureDirectory };
