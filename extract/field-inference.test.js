const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveField, resolveRow } = require('./field-inference');

test('field inference follows known values after arbitrary renaming and reordering', () => {
    for (const name of ['oldKey', 'unrelatedNewKey', 'nameTextMapHash']) {
        const rows = [{ id: 2, [name]: 900, noise: 17 }, { noise: 23, [name]: 800, id: 1 }];
        const sample = resolveRow(rows, 'example:1', row => row.id === 1);
        assert.equal(resolveField('example.name', [{ row: sample, value: 800 }]), name);
    }
});

test('multiple known records disambiguate coincident values without key preferences', () => {
    assert.equal(resolveField('example.avatar', [
        { row: { unknownA: 100, unknownB: 100 }, value: 100 },
        { row: { unknownA: 101, unknownB: 201 }, value: 101 },
    ]), 'unknownA');
    assert.throws(() => resolveField('example.avatar', [{ row: { avatar: 100, other: 100 }, value: 100 }]), /ambiguous/);
});

test('structured values and predicates can calibrate nested fields without truncating integers', () => {
    assert.equal(resolveField('example.list', [{ row: { a: [3, 1], b: [1, 3] }, value: [1, 3] }]), 'b');
    assert.equal(resolveField('example.nested', [{ row: { a: { x: 1 }, b: { x: 2 } }, value: { x: 2 } }]), 'b');
    assert.equal(resolveField('example.path', [{ row: { a: null, b: 'UI_Icon_Witness' }, match: value => value === 'UI_Icon_Witness' }]), 'b');
    assert.equal(resolveField('example.hash', [{ row: { a: '18446744073709551615', b: 18446744073709552000 }, value: '18446744073709551615' }]), 'a');
});

test('absent, conflicting and malformed witnesses stop resolution', () => {
    assert.throws(() => resolveField('missing', [{ row: { a: 2 }, value: 1 }]), /missing match/);
    assert.throws(() => resolveField('conflict', [{ row: { a: 1, b: 2 }, value: 1 }, { row: { a: 1, b: 2 }, value: 2 }]), /inconsistent/);
    for (const witnesses of [[], undefined, [{ value: 1 }], [{ row: {}, value: undefined }], [{ row: {}, value: 1, match: () => true }]])
        assert.throws(() => resolveField('bad', witnesses), /Cannot resolve field bad/);
    assert.throws(() => resolveRow([], 'absent', () => true), /missing witness/);
    assert.throws(() => resolveRow([{}, {}], 'duplicate', () => true), /ambiguous witness/);
});
