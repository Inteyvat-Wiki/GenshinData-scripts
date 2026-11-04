const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveField, createStoryReader, resolveCardIcon } = require('./cosmetics');

test('cosmetic stories follow Document and Localization, not skin ID or guessed filenames', () => {
	const calls = [];
	const story = createStoryReader([{ id: 100110, scrambled: [200001] }, { id: 340001, scrambled: [900, 700] }], [
		{ id: 900, a: 'ART/UI/Readable/CHS/Costume_Unrelated_Name', b: 'ART/UI/Readable/CHS/Costume_Unrelated_Name', enPath: 'ART/UI/Readable/EN/First_EN' },
		{ id: 700, a: 'ART/UI/Readable/CHS/Second.txt', enPath: 'ART/UI/Readable/EN/Second_EN' },
	], (name, lang) => { calls.push([name, lang]); return name === 'Second_EN' ? '' : `<i>${name}</i>\n${lang}`; });
	assert.equal(story(200301, 'CHS'), '');
	assert.equal(story(undefined, 'CHS'), '');
	assert.equal(story(340001, 'CHS'), '<i>Costume_Unrelated_Name</i>\nCHS\n\n<i>Second</i>\nCHS');
	assert.equal(story(340001, 'EN'), '<i>First_EN</i>\nEN');
	assert.equal(story(340001, 'JP'), '');
	assert.deepEqual(calls, [['Costume_Unrelated_Name', 'CHS'], ['Second', 'CHS'], ['First_EN', 'EN'], ['Second_EN', 'EN']]);
});

test('ambiguous or broken story relations fail instead of inventing a story', () => {
	assert.throws(() => createStoryReader([{ id: 100110, a: [200001], b: [200001] }], [], () => ''), /ambiguous/);
	assert.throws(() => createStoryReader([{ id: 1, a: [2] }], [], () => ''), /missing/);
	assert.throws(() => createStoryReader([{ id: 100110, a: [200001] }], [{ id: 200001, a: 'ART/UI/Readable/EN/A', b: 'ART/UI/Readable/EN/B' }], () => '')(100110, 'EN'), /Ambiguous readable/);
});

test('obfuscated fields require an unambiguous source witness', () => {
	assert.throws(() => resolveField('id', { id: 1, other: 1 }, 1), /ambiguous/);
	assert.equal(resolveField('id', { scrambled: 1, other: 2 }, 1), 'scrambled');
	assert.throws(() => resolveField('id', { a: 1, b: 1 }, 1), /Cannot resolve/);
	assert.throws(() => resolveField('id', undefined, 1), /Cannot resolve/);
});

test('weapon card variants use a witnessed Material icon and never guess an element', () => {
	assert.equal(resolveCardIcon('UI_Test_Card_{0}', 'UI_Test_{0}', 'UI_Test_Ice'), 'UI_Test_Card_Ice');
	assert.equal(resolveCardIcon('UI_Test_Card', 'UI_Test', 'UI_Test'), 'UI_Test_Card');
	assert.equal(resolveCardIcon('UI_Test_Card_{0}', 'UI_Test_{0}', 'Other_Fire'), undefined);
	assert.equal(resolveCardIcon('UI_Test_Card_{0}', 'UI_Test_{0}', undefined), undefined);
	assert.equal(resolveCardIcon('UI_Test_Card_{1}', 'UI_Test_{0}', 'UI_Test_Ice'), undefined);
	assert.equal(resolveCardIcon('UI_Test_Card_{0}', 'UI_Test_{0}', 'UI_Test_{0}'), undefined);
});
