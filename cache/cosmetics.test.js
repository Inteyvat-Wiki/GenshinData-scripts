const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const child = require('node:child_process');
const provider = require('./provider');

test('prepare extracts costumes, gliders and weapon skins through the public cache with no history', async t => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'genshin-cosmetics-'));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const source = path.join(root, 'source');
	function write(file, value) {
		const target = path.join(source, file);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value));
	}
	const excel = (name, value) => write(`ExcelBinOutput/${name}.json`, value);
	excel('AvatarExcelConfigData', [{ id: 10000003, nameTextMapHash: 1, iconName: 'UI_AvatarIcon_Qin', sideIconName: 'UI_AvatarIcon_Side_Qin' }]);
	excel('AvatarSkillDepotExcelConfigData', []);
	excel('ManualTextMapConfigData', ['Fire', 'Water', 'Grass', 'Electric', 'Wind', 'Ice', 'Rock',
		'WEAPON_SWORD_ONE_HAND', 'WEAPON_CATALYST', 'WEAPON_CLAYMORE', 'WEAPON_BOW', 'WEAPON_POLE'].map((textMapId, index) => ({ textMapId, textMapContentTextMapHash: 500 + index })));
	excel('CityConfigData', [{ cityId: 1, cityNameTextMapHash: 900 }, { cityId: 2, cityNameTextMapHash: 901 }]);
	excel('ConstValueExcelConfigData', [{ name: 'CONST_VALUE_DEFAULT_COSTUME_ICON', value: ['UI_AvatarIcon_Costume_Card'] }]);
	// The witness is intentionally not the first row. Duplicate default names must survive.
	excel('AvatarCostumeExcelConfigData', [
		{ skinId: 200300, characterId: 10000003, nameTextMapHash: 2, descTextMapHash: 3, isDefault: true },
		{ skinId: 200301, characterId: 10000003, nameTextMapHash: 4, descTextMapHash: 5, itemId: 340001, frontIconName: 'UI_AvatarIcon_QinCostumeSea', sideIconName: 'UI_AvatarIcon_Side_QinCostumeSea' },
		{ skinId: 211700, characterId: 10000003, nameTextMapHash: 10, isDefault: true },
		{ skinId: 211800, characterId: 10000003, nameTextMapHash: 10, isDefault: true },
	]);
	excel('AvatarFlycloakExcelConfigData', [{ materialId: 140001, nameTextMapHash: 6, descTextMapHash: 7, icon: 'UI_Gacha_FlycloakIcon_Glider' }]);
	excel('AvatarWeaponSkinExcelConfigData', [
		{ scrambledId: 380001, itemId: 341801, nameTextMapHash: 8, descTextMapHash: 9, quality: 4, weaponType: 'WEAPON_CATALYST', iconPath: 'UI_EquipIcon_Catalyst_Kristall', imagePath: 'UI_Gacha_EquipIcon_Catalyst_Kristall', scrambledCard: 'UI_EquipIcon_Catalyst_Kristall_Card' },
		{ scrambledId: 390003, itemId: 341903, nameTextMapHash: 8, descTextMapHash: 11, quality: 5, weaponType: 'WEAPON_SWORD_ONE_HAND', iconPath: 'UI_Test_{0}', imagePath: 'UI_Gacha_Test', scrambledCard: 'UI_Test_Card_{0}' },
	]);
	excel('AvatarWeaponSkinGroupExcelConfigData', [{ groupId: 1002, nameTextMapHash: 12, scrambledMembers: [390003] }]);
	excel('MaterialExcelConfigData', [
		{ id: 340001, icon: 'UI_AvatarIcon_QinCostumeSea_Card' },
		{ id: 140001, icon: 'UI_FlycloakIcon_Glider', rankLevel: 4 },
		{ id: 341801, icon: 'UI_EquipIcon_Catalyst_Kristall', itemUse: [{ useOp: 'ITEM_USE_ADD_WEAPON_SKIN', useParam: ['380001'] }] },
		{ id: 341903, icon: 'UI_Test_Ice' },
	]);
	excel('MaterialSourceDataExcelConfigData', [
		...[340001, 140001, 341801, 341903].map(id => ({ id, textList: [13], scrambledJumpDescriptions: [14] })),
		{ id: 210001, scrambledJumpDescriptions: [3428310340, 1366389946, 3237647833, 326911317, 696736979, 1009452272, 549049380] },
	]);
	excel('DocumentExcelConfigData', [{ id: 100110, scrambledPages: [200001] }, { id: 340001, scrambledPages: [400002] }, { id: 140001, scrambledPages: [310001] }]);
	excel('LocalizationExcelConfigData', [
		{ id: 400002, chs: 'ART/UI/Readable/CHS/ActualCostume', enPath: 'ART/UI/Readable/EN/ActualCostume_EN' },
		{ id: 310001, chs: 'ART/UI/Readable/CHS/ActualGlider', enPath: 'ART/UI/Readable/EN/ActualGlider_EN' },
	]);
	for (const lang of ['CHS', 'EN']) {
		write(`TextMap/TextMap${lang}.json`, { 1: lang === 'EN' ? 'Jean' : '琴', 2: 'Wind and Snow', 3: '<i>Default</i>\\nText',
			4: 'Sea Breeze', 5: '<color=#FFFFFF>Costume</color>', 6: 'Wings', 7: '<i>Glider</i>',
			8: lang === 'EN' ? 'Shared Skin Name' : '同名幻化', 9: '<i>First skin</i>\\nText', 10: 'Default Outfit',
			11: '<i>Second skin</i>', 12: 'Source group', 13: 'Source text', 14: 'Jump description', 900: 'Mondstadt', 901: 'Snezhnaya' });
		write(`TextMap/TextMap_Medium${lang}.json`, {});
		const suffix = lang === 'CHS' ? '' : '_EN';
		write(`Readable/${lang}/ActualCostume${suffix}.txt`, `\r\n<i>Costume story ${lang}</i>\r\nSecond line\r\n`);
		write(`Readable/${lang}/ActualGlider${suffix}.txt`, `Glider story ${lang}`);
	}
	const git = (...args) => child.execFileSync('git', ['-c', `safe.directory=${source.replaceAll('\\', '/')}`, '-c', 'commit.gpgsign=false', '-C', source, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
	git('init', '-q');
	git('add', '.');
	git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Cosmetics fixture');
	const options = { sourceRoot: source, cacheRoot: path.join(root, 'cache'), folders: ['outfits', 'windgliders', 'weaponskins'], languages: ['CHS', 'EN'], versions: false, log: () => {} };
	const snapshot = await provider.prepare(options);
	assert.equal(snapshot.verify(), true);
	assert.equal((await provider.prepare(options)).snapshotId, snapshot.snapshotId);
	for (const language of ['English', 'ChineseSimplified']) {
		assert.equal(snapshot.keys(language, 'outfits').length, 4);
		assert.equal(snapshot.keys(language, 'windgliders').length, 1);
		assert.equal(snapshot.keys(language, 'weaponskins').length, 2);
		const outfit = snapshot.getRecord(language, 'outfits', 200300);
		assert.equal(outfit.isDefault, true);
		assert.equal(outfit.descriptionRaw, '<i>Default</i>\nText');
		assert.equal(outfit.description, 'Default\nText');
		assert.equal(outfit.story, '');
		assert.match(snapshot.getRecord(language, 'outfits', 200301).story, /^<i>Costume story (CHS|EN)<\/i>\nSecond line$/);
		assert.match(snapshot.getRecord(language, 'windgliders', 140001).story, /^Glider story (CHS|EN)$/);
		const skin = snapshot.getRecord(language, 'weaponskins', 390003);
		assert.deepEqual(skin.source, ['Source text', 'Jump description']);
		assert.equal(skin.id, 390003);
		assert.equal(skin.itemId, 341903);
		assert.deepEqual(skin.groups, [{ id: 1002, name: 'Source group' }]);
		assert.equal(snapshot.getRecord(language, 'weaponskins', 380001).descriptionRaw, '<i>First skin</i>\nText');
	}
	assert.equal(snapshot.getAuxiliary('image', 'outfits', 'wind_and_snow').filename_icon, 'UI_AvatarIcon_Qin');
	assert.equal(snapshot.getAuxiliary('image', 'weaponskins', 'shared_skin_name-01').filename_icon, 'UI_Test_Ice');
	assert.equal(snapshot.getAuxiliary('image', 'weaponskins', 'shared_skin_name-01').filename_card, 'UI_Test_Card_Ice');
	assert(snapshot.getAuxiliary('dependencies', 'weaponskins', 'shared_skin_name-01').includes('11'));
	assert(snapshot.getAuxiliary('dependencies', 'weaponskins', 'shared_skin_name-01').includes('12'));
	assert.equal(snapshot.manifest().plan.versionMethod, 'disabled');
	assert(!fs.existsSync(path.join(options.cacheRoot, 'history')));
});
