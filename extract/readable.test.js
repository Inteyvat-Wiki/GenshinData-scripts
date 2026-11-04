const test = require('node:test');
const assert = require('node:assert/strict');
const { createReadableReader } = require('./readable');

test('readable references and language paths survive independently renamed source keys', () => {
    for (const key of ['questIDList', 'arbitrarilyRenamed']) {
        const read = createReadableReader([{ id: 100110, [key]: [200001] }], [
            { id: 200001, a: 'ART/UI/Readable/CHS/First', b: 'ART/UI/Readable/CHS/First', c: 'ART\\UI\\Readable\\EN\\First_EN.txt' },
            { id: 200002, a: 'ART/UI/Readable/CHS/Second' },
        ], (name, lang) => `${lang}:${name}`);
        const document = { id: 100110, [key]: [200002, 200001], unrelated: [999] };
        assert.deepEqual(read(document, 'CHS'), {
            localizationIds: [200002, 200001], readablePaths: ['ART/UI/Readable/CHS/Second', 'ART/UI/Readable/CHS/First'],
            content: ['CHS:Second', 'CHS:First'],
        });
        assert.deepEqual(read(document, 'EN').content, ['EN:First_EN']);
        assert.deepEqual(read(undefined, 'CHS'), { localizationIds: [], readablePaths: [], content: [] });
    }
});

test('readable inference fails on ambiguous/missing calibration and conflicting paths', () => {
    assert.throws(() => createReadableReader([{ id: 100110, a: [200001], b: [200001] }], [], () => ''), /ambiguous/);
    assert.throws(() => createReadableReader([{ id: 100110, a: [200002] }], [], () => ''), /missing match/);
    const read = createReadableReader([{ id: 100110, a: [200001] }], [{ id: 200001, a: 'ART/UI/Readable/CHS/A', b: 'ART/UI/Readable/CHS/B' }], () => '');
    assert.throws(() => read({ id: 1, a: [200001] }, 'CHS'), /Ambiguous readable path/);
    assert.throws(() => read({ id: 1, a: ['200001'] }, 'CHS'), /Invalid Document/);
    assert.throws(() => read({ id: 1, a: 0 }, 'CHS'), /Invalid Document/);
});

test('other localization lists do not replace the known default list; missing resources stay absent', () => {
    const read = createReadableReader([{ id: 100110, a: [200001] }], [{ id: 200001, path: 'ART/UI/Readable/EN/Poem1_EN' }], name => name);
    assert.deepEqual(read({ id: 101733, a: [200001], questContentLocalizedId: [200002], questIDList: [302912] }, 'EN').content, ['Poem1_EN']);
    assert.deepEqual(read({ id: 120718, a: [240772] }, 'EN'), { localizationIds: [240772], readablePaths: [], content: [] });
});
