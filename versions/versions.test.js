const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const textmap = require('./textmap');
const tracking = require('./tracking');

test('release normalization, numeric ordering, legacy names and overlays', () => {
    assert.equal(textmap.versionOf('1.3.2 -> 1.4.0'), '1.4');
    assert.equal(textmap.normalizeVersion('1.3'), '1.x');
    assert.equal(textmap.normalizeVersion('1.5'), '1.5');
    assert.ok(textmap.compareVersions('1.10', '1.9') > 0);
    assert.deepEqual(textmap.VERSION_LANGUAGES, ['CHS', 'EN']);
    assert.equal(textmap.textPath('TextMap/TextCHS.json').lang, 0);
    assert.equal(textmap.textPath('TextMap/TextJA.json'), null);
    assert.equal(textmap.textPath('TextMap/TextMapIT.json'), null);
    assert.equal(textmap.LANGUAGES.length, 15); // Normal translated data exports stay unchanged.
    assert.equal(path.basename(textmap.cachePaths({}).directory), 'textmap-versions-chs-en');
    assert.deepEqual(textmap.selectPaths(['TextMap/TextEN.json', 'TextMap/TextMapEN.json']).map(x => x.file), ['TextMap/TextMapEN.json']);
    assert.ok(textmap.textPath('TextMap/TextMap_MediumEN_1.json').priority > textmap.textPath('TextMap/TextMapEN_1.json').priority);
    assert.deepEqual(textmap.parseEntry('  "4294967295": "a\\n\\\"b",'), [4294967295, 'a\n"b']);
    assert.equal(textmap.parseEntry('{}'), null);
});

test('only the verified mislabeled source commit is corrected to 3.3', () => {
    const ref = '1a6597f5a67382119494beae22a4039a1cefc8e1';
    const subject = 'OSRELWin3.0.0_R11806263_S11787575_D11806263';
    assert.equal(textmap.versionOf(subject, ref), '3.3');
    assert.equal(textmap.versionOf(subject), '3.0');
    assert.equal(textmap.versionOf(subject, '45c509efd76550b17e394774fd90bec248ccefdb'), '3.0');
    assert.equal(textmap.versionOf(subject, ref.slice(0, 11)), '3.0');
    assert.equal(textmap.versionOf('OSRELWin3.2.0_R11078128', 'e7c944395d00f0dc1848a66703c73d9763dfc5cc'), '3.2');
    assert.equal(textmap.versionOf('Update README.md', 'unrelated'), null);
});

test('content counts use only CHS and EN; other language additions and edits have no effect', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'genshin-version-test-'));
    const git = (...args) => execFileSync('git', ['-c', `safe.directory=${directory.replaceAll('\\', '/')}`, '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', '-C', directory, ...args], { encoding: 'utf8' }).trim();
    git('init', '-q');
    fs.mkdirSync(path.join(directory, 'TextMap'));
    const db = new DatabaseSync(':memory:');
    textmap.initialize(db);
    let previous;
    const snapshot = async (version, files) => {
        for (const file of fs.readdirSync(path.join(directory, 'TextMap'))) fs.unlinkSync(path.join(directory, 'TextMap', file));
        for (const [file, data] of Object.entries(files)) fs.writeFileSync(path.join(directory, 'TextMap', file), JSON.stringify(data, null, 2) + '\n');
        git('add', 'TextMap');
        git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '--allow-empty', '-m', `${version}.0`);
        const ref = git('rev-parse', 'HEAD');
        await textmap.applySnapshot(db, directory, { ref, version }, previous, Object.keys(files).map(file => ({ file: `TextMap/${file}` })));
        previous = ref;
    };
    const version = hash => db.prepare('SELECT c.version FROM state s JOIN counts c ON s.signature=c.signature WHERE s.hash=?').get(hash)?.version;
    await snapshot('1.4', { 'TextEN.json': { 1: 'A', 2: 'B' }, 'TextCHS.json': { 1: '甲', 2: '乙' } });
    assert.equal(version(1), '1.x');
    await snapshot('1.5', { 'TextEN.json': { 1: 'A', 2: 'B', 3: 'A' }, 'TextCHS.json': { 1: '甲', 2: '乙', 3: '甲' } });
    assert.equal(version(1), '1.5'); // Even unchanged hash 1 advances when a duplicate appears.
    await snapshot('1.6', { 'TextMapEN.json': { 1: 'A', 2: 'B', 4: 'A' }, 'TextMapCHS.json': { 1: '甲', 2: '乙', 4: '甲' } });
    assert.equal(version(4), '1.5'); // 3 -> 4, same content count, no advance.
    await snapshot('2.0', { 'TextMapEN.json': { 1: 'A', 2: 'B', 4: 'A' }, 'TextMapCHS.json': { 1: '甲', 2: '乙', 4: '改' } });
    assert.equal(version(1), '2.0'); // Count decreases as one translation changes.
    assert.equal(version(4), '2.0');
    assert.equal(version(2), '1.x');
    await snapshot('2.1', { 'TextMapEN.json': { 1: 'A', 2: 'B', 4: 'A' }, 'TextMapCHS.json': { 1: '甲', 2: '乙', 4: '改' }, 'TextMap_MediumEN.json': { 1: 'overlay' } });
    assert.equal(version(1), '2.1');
    await snapshot('2.2', { 'TextMapEN.json': { 1: 'A', 2: 'B', 4: 'A' }, 'TextMapCHS.json': { 1: '甲', 2: '乙', 4: '改' }, 'TextMap_MediumEN.json': { 1: 'overlay' }, 'TextMapIT.json': { 2: '', 99: 'IT only' }, 'TextMapJP.json': { 1: '日本語' } });
    assert.equal(version(2), '1.x');
    assert.equal(version(1), '2.1');
    assert.equal(version(99), undefined); // Hashes present only in other languages are excluded.
    await snapshot('2.3', { 'TextMapEN.json': { 1: 'A', 2: 'B', 4: 'A' }, 'TextMapCHS.json': { 1: '甲', 2: '乙', 4: '改' }, 'TextMap_MediumEN.json': { 1: 'overlay' }, 'TextMapIT.json': { 2: 'changed' }, 'TextMapJP.json': { 1: '修正' } });
    assert.equal(version(1), '2.1');
    assert.equal(version(2), '1.x');
    await snapshot('2.4', { 'TextMapEN.json': { 1: 'A', 2: 'B', 4: 'A' }, 'TextMapCHS.json': { 1: '甲', 2: '乙', 4: '改' }, 'TextMap_MediumEN.json': { 1: 'overlay', 2: '' } });
    assert.equal(version(2), '2.4'); // English changes still count.
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM counts WHERE count<0').get().n, 0);
    db.close();
    const config = { GenshinData_folder: directory, textmap_version_cache: path.join(directory, 'cache') };
    const index = await textmap.build(config, () => {});
    const values = JSON.parse(fs.readFileSync(index, 'utf8'));
    assert.deepEqual(JSON.parse(fs.readFileSync(textmap.cachePaths(config).manifest, 'utf8')).languages, ['CHS', 'EN']);
    assert.equal(values[1], '2.1');
    assert.equal(values[2], '2.4');
    const logs = [];
    await textmap.build(config, message => logs.push(message));
    assert.deepEqual(logs, ['TextMap versions: cache is current.']);
    fs.unlinkSync(textmap.cachePaths(config).manifest);
    await textmap.build(config, () => {}); // Resume without reprocessing completed snapshots.
    assert.deepEqual(JSON.parse(fs.readFileSync(index, 'utf8')), values);
    await assert.rejects(textmap.build({ ...config, textmap_version_overrides: { [previous]: '3.0' } }, () => {}), /history order or version labels changed/);
    // Only this fixture-created directory is removed.
    assert.ok(directory.startsWith(path.join(os.tmpdir(), 'genshin-version-test-')));
    fs.rmSync(directory, { recursive: true });
});

test('object attribution isolates records and keeps nested primitive reductions', () => {
    const lang = tracking.languageProxy({ 1: 'first', 2: 'second', 3: 'nested', 4: 'variant', 0: '' });
    const result = tracking.collate(() => [1, 2].reduce((acc, hash) => {
        const value = { name: lang[hash], detail: [3].reduce((text, id) => text + lang[id], '') };
        acc[hash] = value;
        if (hash === 2) acc.variant = { name: lang[4] };
        return acc;
    }, {}), 'EN');
    assert.deepEqual([...tracking.collectHashes(result[1])].sort(), ['1', '3']);
    assert.deepEqual([...tracking.collectHashes(result[2])].sort(), ['2', '3']);
    assert.deepEqual([...tracking.collectHashes(result.variant)], ['4']);
    assert.equal(tracking.objectVersion(result[1], { 1: '4.0', 3: '1.x' }), '1.x');
    assert.equal(tracking.objectVersion({}, {}), '');
    assert.throws(() => tracking.objectVersion(result[1], {}), /missing/);
});

test('invalid manually attached hashes are ignored, real missing hashes still fail', () => {
    const value = {};
    tracking.attach(value, new Set([undefined, 'undefined', null, 'null', '', 'name', 0, '0', false, NaN, -1, 1.5, {}, 10, '11']));
    assert.deepEqual([...tracking.collectHashes(value)], ['10', '11']);
    assert.equal(tracking.objectVersion(value, { 10: '3.3', 11: '3.2' }), '3.2');
    assert.throws(() => tracking.objectVersion(value, { 10: '3.3' }), /missing for used hash 11/);
    const empty = {};
    tracking.attach(empty, new Set([undefined, 'undefined', 0]));
    assert.equal(tracking.objectVersion(empty, {}), '');
});

test('grouped layers, alternate recipes, explicit records and failure restoration', () => {
    const lang = tracking.languageProxy({ 1: 'one', 2: 'two', 3: 'three' });
    const result = tracking.collate(() => [1, 2].reduce((acc, hash) => {
        const layer = { name: lang[hash] };
        if (!acc.group) acc.group = { layers: [] };
        acc.group.layers.push(layer);
        return acc;
    }, {}));
    assert.deepEqual([...tracking.collectHashes(result.group)].sort(), ['1', '2']);
    const recipe = tracking.record(() => ({ name: lang[3] }));
    assert.deepEqual([...tracking.collectHashes(recipe)], ['3']);
    const reduce = Array.prototype.reduce;
    assert.throws(() => tracking.collate(() => { throw Error('expected'); }));
    assert.equal(Array.prototype.reduce, reduce);
});

test('normal exports replace stale versions; enrichers preserve and minimize', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'genshin-version-output-'));
    const config = { genshin_output_folder: directory, genshin_export_folder: directory };
    tracking.writeVersions('sample', { a: '2.0', stale: '1.x' }, config);
    tracking.writeVersions('sample', { a: '3.0' }, config);
    const read = () => JSON.parse(fs.readFileSync(path.join(directory, 'version', 'sample.json')));
    assert.deepEqual(read(), { a: '3.0' });
    tracking.writeVersions('sample', { a: '', b: '4.0' }, config, true);
    tracking.writeVersions('sample', { b: '2.0' }, config, true);
    assert.deepEqual(read(), { a: '3.0', b: '2.0' });
    assert.ok(directory.startsWith(path.join(os.tmpdir(), 'genshin-version-output-')));
    fs.rmSync(directory, { recursive: true });
});

test('exportData writes compatible version maps and version-only mode leaves bodies unchanged', {
    skip: !fs.existsSync(path.join(require('../config.json').GenshinData_folder, 'TextMap')),
}, () => {
    const { exportData, exportCurve } = require('../extract/global');
    const originalConfig = global.config;
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'genshin-version-integration-'));
    const lang = tracking.languageProxy({ 10: 'Alpha', 11: 'Beta', 12: 'Ignored for version inference' });
    fs.writeFileSync(path.join(directory, 'hashes.json'), JSON.stringify({ 10: '2.0', 11: '1.x' }));
    global.config = { ...originalConfig, genshin_output_folder: path.join(directory, 'db'),
        genshin_export_folder: path.join(directory, 'export'), textmap_version_cache: directory };
    const collate = outputLang => [10, 11].reduce((acc, hash) => {
        acc[String(hash)] = { name: lang[hash], stats: { attack: 100 }, filename_icon: 'test',
            otherText: textmap.VERSION_LANGUAGES.includes(outputLang) ? undefined : lang[12] };
        return acc;
    }, {});
    try {
        exportData('fixture', collate);
        const read = root => JSON.parse(fs.readFileSync(path.join(directory, root, 'version', 'fixture.json')));
        assert.deepEqual(read('db'), { 10: '2.0', 11: '1.x' });
        assert.deepEqual(read('export'), read('db'));
        assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'db', 'German', 'fixture', '10.json'))).otherText,
            'Ignored for version inference');
        const body = path.join(directory, 'db', 'English', 'fixture', '10.json');
        const before = fs.readFileSync(body, 'utf8');
        global.versionExport = { language: 'EN', merge: false };
        exportData('fixture', collate);
        exportCurve('fixture', 'ThisFileMustNotBeRead');
        assert.equal(fs.readFileSync(body, 'utf8'), before);
        assert.deepEqual(read('db'), { 10: '2.0', 11: '1.x' });
    } finally {
        global.config = originalConfig;
        delete global.versionExport;
        assert.ok(directory.startsWith(path.join(os.tmpdir(), 'genshin-version-integration-')));
        fs.rmSync(directory, { recursive: true });
    }
});

test('domain enrichment resolves enemy hashes from source, not exported enemy fields', {
    skip: !fs.existsSync(path.join(require('../config.json').genshin_export_folder, 'EN', 'enemies.json')) ||
        !fs.existsSync(path.join(require('../config.json').genshin_export_folder, 'CHS', 'domains.json')),
}, () => {
    const config = require('../config.json');
    const enemies = JSON.parse(fs.readFileSync(path.join(config.genshin_export_folder, 'EN', 'enemies.json')));
    assert.ok(Object.values(enemies).some(enemy => enemy.nameTextMapHash === undefined));
    const data = tracking.collate(require('../extract/extractDomainMonsterList'), 'CHS');
    const enriched = Object.values(data).filter(domain => tracking.collectHashes(domain).size);
    assert.ok(enriched.length > 0);
    const sourceHashes = new Set(JSON.parse(fs.readFileSync(path.join(config.GenshinData_folder,
        'ExcelBinOutput', 'MonsterDescribeExcelConfigData.json'))).map(row => String(row.nameTextMapHash)));
    for (const domain of enriched) {
        assert.ok(domain.monsterlist.length > 0);
        assert.ok(domain.monsterlist.every(name => typeof name === 'string' && name.length));
        for (const hash of tracking.collectHashes(domain)) {
            assert.match(hash, /^\d+$/);
            assert.ok(sourceHashes.has(hash));
        }
    }
});
