const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('voice switches use source avatar icons after exported image fields are separated', () => {
	const character = { id: 10000100, name: 'Display Name' };
	const line = { avatarId: character.id, voiceFile: 'hello', fetterId: 100, type: 1,
		voiceTitleTextMapHash: 1, voiceFileTextTextMapHash: 2, openConds: [] };
	const context = {
		module: { exports: {} }, console,
		config: { genshin_export_folder: '/export', GenshinData_folder: '/source' },
		xplayableAvatar: [{ id: character.id, nameTextMapHash: 3, iconName: 'UI_AvatarIcon_InternalName' }],
		getExcel: name => name === 'FettersExcelConfigData' ? [line] : [],
		getLanguage: () => ({ 1: 'Hello', 2: 'Hello there.', 3: character.name }),
		sanitizeDescription: value => value,
		require: name => {
			if (name === './global.js') return {};
			if (name === 'fs') return { readdirSync: () => ['voices.json'] };
			if (name === '/export/EN/characters.json') return { displayname: character };
			if (name === '/source/BinOutput/Voice/Items/voices.json') return {
				hello: { GameTrigger: 'Fetter', gameTriggerArgs: 'hello', sourceFileName: 'unused',
					sourceNames: [{ avatarName: 'Switch_internalname', sourceFileName: 'vo/hello.wem', rate: 1, emotion: '' }] },
			};
			throw new Error(`Unexpected fixture dependency: ${name}`);
		},
	};
	vm.runInNewContext(fs.readFileSync(require.resolve('./extractVoiceover'), 'utf8'), context);
	const result = context.module.exports('EN').displayname;
	assert.equal(result.id, character.id);
	assert.equal(result.friendLines[0].voicefile, 'vo/hello');
	assert.equal(result.friendLines[0].description, 'Hello there.');
});
