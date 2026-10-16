const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawn } = require('node:child_process');
const readline = require('node:readline');

const LANGUAGES = ['CHS', 'CHT', 'DE', 'EN', 'ES', 'FR', 'ID', 'IT', 'JP', 'KR', 'PT', 'RU', 'TH', 'TR', 'VI'];
const VERSION_LANGUAGES = ['CHS', 'EN'];
const VERSION_TEXTMAP_PATHS = VERSION_LANGUAGES.map(lang => `:(glob)TextMap/Text*${lang}*.json`);
const SCHEMA = 2;
const KNOWN_VERSION_OVERRIDES = Object.freeze({
    // Mislabeled as 3.0: adds chapter 1307 (倾落伽蓝), Italian and Turkish TextMaps.
    '1a6597f5a67382119494beae22a4039a1cefc8e1': '3.3',
});

function git(root, args) {
    return execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, '-C', root, ...args], {
        encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
}

function versionOf(subject, ref) {
    if (Object.hasOwn(KNOWN_VERSION_OVERRIDES, ref)) return KNOWN_VERSION_OVERRIDES[ref];
    const releases = [...subject.matchAll(/(\d+)\.(\d+)\.\d+/g)];
    const match = releases.at(-1);
    return match ? `${Number(match[1])}.${Number(match[2])}` : null;
}

function normalizeVersion(version) {
    const [major, minor] = version.split('.').map(Number);
    return major === 1 && minor <= 4 ? '1.x' : `${major}.${minor}`;
}

function compareVersions(a, b) {
    const parse = value => value === '1.x' ? [1, 0] : value.split('.').map(Number);
    const aa = parse(a), bb = parse(b);
    return aa[0] - bb[0] || aa[1] - bb[1];
}

function textPath(file) {
    const match = file.match(/^TextMap\/Text(?:Map)?(_Medium)?(CHS|CHT|DE|EN|ES|FR|ID|IT|JP|JA|KR|KO|PT|RU|TH|TR|VI)(?:_(\d+))?\.json$/);
    if (!match) return null;
    const lang = { JA: 'JP', KO: 'KR' }[match[2]] || match[2];
    if (!VERSION_LANGUAGES.includes(lang)) return null;
    return { file, lang: VERSION_LANGUAGES.indexOf(lang), modern: file.startsWith('TextMap/TextMap'), priority: (match[1] ? 100 : 0) + (match[3] === undefined ? 0 : Number(match[3]) + 1) };
}

function selectPaths(files) {
    const candidates = files.map(textPath).filter(Boolean);
    return candidates.filter(row => row.modern || !candidates.some(other => other.lang === row.lang && other.modern));
}

function tree(root, ref) {
    return git(root, ['ls-tree', '-r', ref, '--', 'TextMap']).trim().split('\n').filter(Boolean).map(line => {
        const [header, file] = line.split('\t');
        return { file, blob: header.split(' ')[2] };
    });
}

function history(root, overrides = {}, log = console.log) {
    if (git(root, ['rev-parse', '--is-shallow-repository']).trim() === 'true') throw new Error('TextMap history requires a non-shallow source repository.');
    const lines = git(root, ['log', '--all', '--reverse', '--topo-order', '--format=%ct%x09%H%x09%s', '--', 'TextMap']).trim().split('\n').filter(Boolean);
    const entries = lines.map((line, order) => {
        const [time, ref, ...subject] = line.split('\t');
        return { time: Number(time), ref, order, version: versionOf(subject.join('\t'), ref), subject: subject.join('\t') };
    }).sort((a, b) => a.time - b.time || a.order - b.order);
    let previous;
    return entries.map(entry => {
        entry.version = overrides[entry.ref] || entry.version;
        if (previous && entry.version && compareVersions(entry.version, previous) < 0) {
            log(`WARNING: source release label regresses ${previous} -> ${entry.version} at ${entry.ref}. Set textmap_version_overrides if the commit label is incorrect.`);
        }
        previous = entry.version || previous;
        if (!previous) throw new Error(`Cannot determine source version for ${entry.ref}: ${entry.subject}`);
        return { ...entry, version: previous };
    });
}

function token(text) {
    // Each language occupies its own fixed slot; missing and empty are distinct.
    return crypto.createHash('sha256').update(text, 'utf8').digest().subarray(0, 16);
}

function parseEntry(line) {
    const match = line.match(/^\s*"(\d+)"\s*:\s*("(?:[^"\\]|\\.)*")\s*,?\s*$/);
    if (match) return [Number(match[1]), JSON.parse(match[2])];
    if (/^\s*(?:[{}]|\{\s*\})\s*$/.test(line) || !line.trim()) return null;
    throw new Error(`Unsupported TextMap JSON layout: ${line.slice(0, 100)}`);
}

async function gitLines(root, args, onLine) {
    const child = spawn('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, '-C', root, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let error = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { error += chunk; });
    const completed = new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('close', code => code === 0 ? resolve() : reject(new Error(`git ${args[0]} failed (${code}): ${error}`)));
    });
    // Attach a handler immediately, including while the stream is being consumed.
    completed.catch(() => {});
    try {
        for await (const line of readline.createInterface({ input: child.stdout, crlfDelay: Infinity })) onLine(line);
        await completed;
    } catch (error) {
        child.kill();
        await completed.catch(() => {});
        throw error;
    }
}

function initialize(db) {
    db.exec(`
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=NORMAL;
        CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE IF NOT EXISTS entries (file TEXT, hash INTEGER, token BLOB, PRIMARY KEY(file, hash)) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS entries_hash ON entries(hash);
        CREATE TABLE IF NOT EXISTS paths (file TEXT PRIMARY KEY, lang INTEGER, priority INTEGER);
        CREATE TABLE IF NOT EXISTS state (hash INTEGER PRIMARY KEY, signature BLOB);
        CREATE TABLE IF NOT EXISTS counts (signature BLOB PRIMARY KEY, count INTEGER, version TEXT) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS staging (file TEXT, hash INTEGER, token BLOB, PRIMARY KEY(file, hash)) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS affected (hash INTEGER PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS deltas (signature BLOB PRIMARY KEY, delta INTEGER) WITHOUT ROWID;
    `);
}

function applyCounts(db, version) {
    const delta = db.prepare('INSERT INTO deltas VALUES (?, ?) ON CONFLICT(signature) DO UPDATE SET delta=delta+excluded.delta');
    const before = db.prepare('SELECT signature FROM state WHERE hash=?');
    const put = db.prepare('INSERT INTO state VALUES (?, ?) ON CONFLICT(hash) DO UPDATE SET signature=excluded.signature');
    const remove = db.prepare('DELETE FROM state WHERE hash=?');
    // Force the small changed-hash set to drive the join. Scanning every
    // language entry for every tiny patch would make incremental builds slow.
    // Higher-priority overlays overwrite the same language slot last.
    const values = db.prepare(`SELECT a.hash,p.lang,e.token FROM affected a
        CROSS JOIN entries e ON e.hash=a.hash CROSS JOIN paths p ON e.file=p.file
        ORDER BY a.hash,p.lang,p.priority,p.file`);
    let hash, signature;
    const finish = () => {
        if (hash === undefined) return;
        put.run(hash, signature);
        delta.run(signature, 1);
    };
    for (const row of db.prepare('SELECT hash FROM affected').iterate()) {
        const old = before.get(row.hash);
        if (old) delta.run(old.signature, -1);
        remove.run(row.hash);
    }
    for (const row of values.iterate()) {
        if (hash !== row.hash) {
            finish(); hash = row.hash; signature = Buffer.alloc(VERSION_LANGUAGES.length * 16);
        }
        Buffer.from(row.token).copy(signature, row.lang * 16);
    }
    finish();
    db.prepare(`INSERT INTO counts SELECT signature,delta,? FROM deltas WHERE delta != 0
        ON CONFLICT(signature) DO UPDATE SET count=count+excluded.count,version=excluded.version`).run(normalizeVersion(version));
    db.exec('DELETE FROM affected; DELETE FROM staging; DELETE FROM deltas;');
}

async function applySnapshot(db, root, snapshot, previous, files, log = () => {}, prefix) {
    const selected = selectPaths(files.map(row => row.file));
    const priorPaths = db.prepare('SELECT file FROM paths').all().map(row => row.file);
    const selectedFiles = new Set(selected.map(row => row.file));
    const active = new Set([...priorPaths, ...selectedFiles]);
    const stage = db.prepare('INSERT INTO staging VALUES (?,?,?) ON CONFLICT(file,hash) DO UPDATE SET token=COALESCE(excluded.token,staging.token)');
    const affected = db.prepare('INSERT OR IGNORE INTO affected VALUES (?)');
    db.exec('BEGIN');
    try {
        const completed = db.prepare('SELECT value FROM metadata WHERE key=?').get('completed')?.value || null;
        if (completed !== (previous || null)) throw new Error('TextMap cache advanced in another process; retry after that build completes.');
        if (!previous) {
            for (const row of selected) {
                log(`  loading ${row.file}`);
                await gitLines(root, ['show', `${snapshot.ref}:${row.file}`], line => {
                    const entry = parseEntry(line);
                    if (entry) { stage.run(row.file, entry[0], token(entry[1])); affected.run(entry[0]); }
                });
            }
        } else {
            let file;
            await gitLines(root, ['diff', '--no-ext-diff', '--no-renames', '--no-color', '--unified=0', previous, snapshot.ref, '--', ...active], line => {
                if (line.startsWith('diff --git ')) {
                    const match = line.match(/ b\/(TextMap\/[^ ]+)$/); file = match?.[1];
                } else if (file && active.has(file) && /^[+-]/.test(line) && !/^(---|\+\+\+)/.test(line)) {
                    const entry = parseEntry(line.slice(1));
                    if (entry) { stage.run(file, entry[0], line[0] === '+' ? token(entry[1]) : null); affected.run(entry[0]); }
                }
            });
            // A legacy file may become effective without changing its blob.
            for (const row of selected.filter(row => !priorPaths.includes(row.file))) {
                db.prepare('DELETE FROM staging WHERE file=?').run(row.file);
                await gitLines(root, ['show', `${snapshot.ref}:${row.file}`], line => {
                    const entry = parseEntry(line);
                    if (entry) { stage.run(row.file, entry[0], token(entry[1])); affected.run(entry[0]); }
                });
            }
        }
        for (const file of priorPaths.filter(file => !selectedFiles.has(file))) {
            db.prepare('INSERT OR IGNORE INTO affected SELECT hash FROM entries WHERE file=?').run(file);
            db.prepare('DELETE FROM entries WHERE file=?').run(file);
        }
        db.exec(`DELETE FROM entries WHERE (file,hash) IN (SELECT file,hash FROM staging);
            INSERT OR REPLACE INTO entries SELECT file,hash,token FROM staging WHERE token IS NOT NULL;
            DELETE FROM paths;`);
        const putPath = db.prepare('INSERT INTO paths VALUES (?,?,?)');
        for (const row of selected) putPath.run(row.file, row.lang, row.priority);
        applyCounts(db, snapshot.version);
        db.prepare('INSERT OR REPLACE INTO metadata VALUES (?,?)').run('completed', snapshot.ref);
        if (prefix) db.prepare('INSERT OR REPLACE INTO metadata VALUES (?,?)').run('prefix', prefix);
        db.exec('COMMIT');
    } catch (error) {
        db.exec('ROLLBACK'); throw error;
    }
}

function cachePaths(config) {
    const directory = config.textmap_version_cache || path.join(__dirname, '..', '.cache', 'textmap-versions-chs-en');
    return { directory, database: path.join(directory, 'history.sqlite'), index: path.join(directory, 'hashes.json'), manifest: path.join(directory, 'manifest.json') };
}

async function build(config, log = console.log) {
    const root = path.resolve(config.GenshinData_folder);
    const dirty = git(root, ['status', '--porcelain', '--', ...VERSION_TEXTMAP_PATHS]).trim();
    if (dirty) throw new Error('TextMap contains uncommitted changes; commit the source snapshot with its release version before building versions.');
    const snapshots = history(root, config.textmap_version_overrides, log);
    if (!snapshots.length) throw new Error('No versioned TextMap history found.');
    const head = git(root, ['rev-parse', 'HEAD']).trim();
    if (git(root, ['diff', '--name-only', snapshots.at(-1).ref, head, '--', ...VERSION_TEXTMAP_PATHS]).trim()) {
        throw new Error('HEAD TextMap differs from the last dated history snapshot.');
    }
    const paths = cachePaths(config);
    const current = fs.readdirSync(path.join(root, 'TextMap')).filter(file => textPath(`TextMap/${file}`)).sort().map(file => {
        const stat = fs.statSync(path.join(root, 'TextMap', file));
        return [file, stat.size, stat.mtimeMs];
    });
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ schema: SCHEMA, root, languages: VERSION_LANGUAGES, snapshots, current })).digest('hex');
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(paths.manifest, 'utf8')); } catch {}
    if (manifest?.fingerprint === fingerprint && fs.existsSync(paths.index)) { log('TextMap versions: cache is current.'); return paths.index; }
    fs.mkdirSync(paths.directory, { recursive: true });
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(paths.database);
    try {
        initialize(db);
        const identity = JSON.stringify({ schema: SCHEMA, root, languages: VERSION_LANGUAGES });
        if (db.prepare('SELECT value FROM metadata WHERE key=?').get('identity')?.value !== identity) {
            db.exec('DELETE FROM entries; DELETE FROM paths; DELETE FROM state; DELETE FROM counts; DELETE FROM staging; DELETE FROM affected; DELETE FROM deltas; DELETE FROM metadata;');
            db.prepare('INSERT INTO metadata VALUES (?,?)').run('identity', identity);
        }
        const completed = db.prepare('SELECT value FROM metadata WHERE key=?').get('completed')?.value;
        const resume = completed ? snapshots.findIndex(row => row.ref === completed) : -1;
        if (completed && resume < 0) throw new Error('Cached history no longer belongs to the source refs; use a fresh textmap_version_cache directory.');
        const prefix = JSON.stringify(snapshots.slice(0, resume + 1).map(row => [row.ref, row.version]));
        if (completed && db.prepare('SELECT value FROM metadata WHERE key=?').get('prefix')?.value !== prefix) {
            throw new Error('Cached history order or version labels changed; use a fresh textmap_version_cache directory.');
        }
        let previous = resume >= 0 ? completed : null;
        for (let i = resume + 1; i < snapshots.length; i++) {
            const snapshot = snapshots[i];
            log(`TextMap versions: ${i + 1}/${snapshots.length} ${snapshot.version} ${snapshot.ref.slice(0, 11)}`);
            await applySnapshot(db, root, snapshot, previous, tree(root, snapshot.ref), log, JSON.stringify(snapshots.slice(0, i + 1).map(row => [row.ref, row.version])));
            previous = snapshot.ref;
        }
        // A dirty source snapshot cannot be assigned a release version reliably.
        if (head !== previous) {
            // HEAD may be a non-TextMap commit; its effective blobs must match.
            const diff = git(root, ['diff', '--name-only', previous, head, '--', ...VERSION_TEXTMAP_PATHS]).trim();
            if (diff) throw new Error('HEAD TextMap differs from the last dated history snapshot.');
        }
        const temporary = paths.index + '.tmp';
        const fd = fs.openSync(temporary, 'w');
        let count = 0;
        try {
            fs.writeSync(fd, '{\n');
            for (const row of db.prepare('SELECT s.hash,c.version FROM state s JOIN counts c ON c.signature=s.signature ORDER BY s.hash').iterate()) {
                fs.writeSync(fd, `${count++ ? ',\n' : ''}  ${JSON.stringify(String(row.hash))}: ${JSON.stringify(row.version)}`);
            }
            fs.writeSync(fd, '\n}\n');
        } finally { fs.closeSync(fd); }
        fs.renameSync(temporary, paths.index);
        fs.writeFileSync(paths.manifest, JSON.stringify({ fingerprint, languages: VERSION_LANGUAGES, snapshots: snapshots.length, hashes: count, rule: 'latest-multilingual-content-count-change', sourceHead: head }, null, 2));
        log(`TextMap versions: recorded ${count} hashes.`);
        return paths.index;
    } finally { db.close(); }
}

module.exports = { LANGUAGES, VERSION_LANGUAGES, versionOf, normalizeVersion, compareVersions, textPath, selectPaths, token, parseEntry, initialize, applyCounts, applySnapshot, cachePaths, build };

if (require.main === module) build(require('../config.json')).catch(error => { console.error(error.stack); process.exitCode = 1; });
