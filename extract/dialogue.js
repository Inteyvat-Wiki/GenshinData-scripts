require('./global.js');

const npcById = new Map(getExcel('NpcExcelConfigData').map(npc => [String(npc.id), npc]));
let talkKeys;

const sampleDialogText = '#{NICKNAME}、派蒙，好久不见。';
const sampleSubtitleText = '内心的「错谬」';
const sampleSpeakerTitleText = '依稀可以辨认的布告';

function isObject(value) {
	return value && typeof value === 'object' && !Array.isArray(value);
}

function findKey(obj, predicate, label) {
	const key = Object.keys(obj).find(key => predicate(obj[key], key));
	if (!key) throw new Error(`tasks: failed to detect ${label} field`);
	return key;
}

function textMapValueEquals(language, value, text) {
	return value && language[value] === text;
}

function objectHasValue(obj, expected) {
	return Object.values(obj).includes(expected);
}

function objectHasTextValue(language, obj, text) {
	return Object.values(obj).some(value => textMapValueEquals(language, value, text));
}

function getTalkKeys() {
	if (talkKeys) return talkKeys;

	const chinese = getLanguage('CHS');
	const sampleTalk = getBin('Talk/Quest/303401');
	const dialogList = findKey(sampleTalk, value =>
		Array.isArray(value) && value.some(dialog =>
			isObject(dialog) &&
			objectHasValue(dialog, 30340101) &&
			objectHasTextValue(chinese, dialog, sampleDialogText)
		), 'talk dialog list');
	const sampleDialog = sampleTalk[dialogList].find(dialog => objectHasValue(dialog, 30340101));

	const subtitleTalk = getBin('Talk/Quest/4024526');
	const subtitleDialogs = subtitleTalk[dialogList];
	const subtitleDialog = subtitleDialogs.find(dialog => objectHasValue(dialog, 402452601));
	const speakerTitleTalk = getBin('Talk/Quest/7504417');
	const speakerTitleDialogList = findKey(speakerTitleTalk, value =>
		Array.isArray(value) && value.some(dialog =>
			isObject(dialog) && objectHasValue(dialog, 750441701)
		), 'speaker title dialog list');
	const speakerTitleDialog = speakerTitleTalk[speakerTitleDialogList]
		.find(dialog => objectHasValue(dialog, 750441701));
	const selectTalk = getBin('Talk/Quest/7715404');
	const selectDialog = Object.values(selectTalk)
		.find(value => Array.isArray(value) && value.some(dialog =>
			isObject(dialog) && objectHasValue(dialog, 771540406)))
		.find(dialog => objectHasValue(dialog, 771540406));

	talkKeys = {
		talkId: findKey(sampleTalk, value => value === 303401, 'talk id'),
		dialogList,
		dialogId: findKey(sampleDialog, value => value === 30340101, 'dialog id'),
		content: findKey(sampleDialog, value => textMapValueEquals(chinese, value, sampleDialogText), 'dialog content'),
		next: findKey(sampleDialog, value => Array.isArray(value) && value.includes(30340102), 'next dialogs'),
		speaker: findKey(sampleDialog, value => isObject(value) && value.type === 'TALK_ROLE_NPC', 'speaker'),
		subtitle: findKey(subtitleDialog, value => textMapValueEquals(chinese, value, sampleSubtitleText), 'speaker subtitle'),
		speakerTitle: findKey(speakerTitleDialog,
		value => textMapValueEquals(chinese, value, sampleSpeakerTitleText), 'speaker title'),
		showType: findKey(selectDialog,
			value => value === 'TALK_SHOW_FORCE_SELECT',
			'dialog show type')
	};

	return talkKeys;
}

function getText(language, textMapHash) {
	const text = textMapHash && language[textMapHash] ? language[textMapHash] : '';
	return text
		? sanitizer(text, replaceNewline, replaceNonBreakSpace, replaceLayoutPC, removeSprite, removeTimezone)
		: '';
}

function getNpcName(language, npcId) {
	const npc = npcById.get(String(npcId));
	return npc ? getText(language, npc.nameTextMapHash) : '';
}

function getVisibleNpcName(language, npcId) {
	const npc = npcById.get(String(npcId));
	if (!npc || npc.invisiable) return '';
	return getText(language, npc.nameTextMapHash);
}

function makeDialog(language, dialog) {
	const keys = getTalkKeys();
	const speakerInfo = dialog[keys.speaker] || {};
	const roleType = speakerInfo.type || speakerInfo._type || '';
	const speakerName = roleType === 'TALK_ROLE_NPC'
		? getNpcName(language, speakerInfo.id || speakerInfo._id)
		: roleType === 'TALK_ROLE_PLAYER'
			? '#{NICKNAME}'
			: '';
	const speakerTitle = getText(language, dialog[keys.speakerTitle]);
	const speakerSubtitle = getText(language, dialog[keys.subtitle]);
	const data = {
		id: dialog[keys.dialogId],
		content: getText(language, dialog[keys.content]),
		roleType,
		nextDialogs: dialog[keys.next] || []
	};

	if (dialog[keys.showType]) data.showType = dialog[keys.showType];
	if (speakerName) data.speakerName = speakerName;
	if (speakerTitle) data.speakerTitle = speakerTitle;
	if (speakerSubtitle) data.speakerSubtitle = speakerSubtitle;

	return data;
}

module.exports = { getTalkKeys, getText, getNpcName, getVisibleNpcName, makeDialog };
