require('./global.js');

const fs = require('fs');
const path = require('path');
const { getTalkKeys, getText, getNpcName, makeDialog } = require('./dialogue.js');
const { record } = require('../versions/tracking');

const source = config.GenshinData_folder;
const npcById = new Map(getExcel('NpcExcelConfigData').map(npc => [npc.id, npc]));
const talkById = new Map([0, 1].flatMap(index => getExcel(`TalkExcelConfigData_${index}`))
	.map(talk => [talk.id, talk]));
const read = file => JSON.parse(fs.readFileSync(path.join(source, file), 'utf8'),
	(key, value, context) => typeof value === 'number' && !Number.isSafeInteger(value)
		&& context?.source && /^\d+$/.test(context.source) ? context.source : value);
let groups;
let bodies;
let actionKeys;

function findKey(data, predicate, label) {
	const keys = Object.keys(data).filter(key => predicate(data[key]));
	if (keys.length !== 1) throw new Error(`npcs: failed to detect ${label}`);
	return keys[0];
}

function getGroups() {
	if (groups) return groups;
	const index = read('BinOutput/IndexDic/NpcFreeTalkIndex.json');
	const sample = getBin('Talk/NpcGroup/1567');
	const npcKey = findKey(sample, value => value === 1567, 'group npc');
	const talksKey = findKey(sample, value => Array.isArray(value)
		&& value.some(talk => talk.id === 6156701), 'group talks');
	groups = new Map();
	for (const file of fs.readdirSync(path.join(source, 'BinOutput/Talk/NpcGroup')).filter(file => file.endsWith('.json'))) {
		const data = read(`BinOutput/Talk/NpcGroup/${file}`);
		const id = data[npcKey];
		if (!Object.hasOwn(index, id) || !npcById.get(id)?.isDaily || npcById.get(id)?.invisiable) continue;
		if (groups.has(id)) throw new Error(`npcs: duplicate indexed NPC ${id}`);
		groups.set(id, { id, resource: index[id], file: `BinOutput/Talk/NpcGroup/${file}`, talks: data[talksKey] || [] });
	}
	return groups;
}

function getBodies() {
	if (bodies) return bodies;
	const keys = getTalkKeys();
	bodies = new Map();
	for (const folder of ['Npc', 'Quest']) {
		for (const file of fs.readdirSync(path.join(source, `BinOutput/Talk/${folder}`)).filter(file => file.endsWith('.json'))) {
			const data = read(`BinOutput/Talk/${folder}/${file}`);
			const id = data[keys.talkId];
			if (!Number.isInteger(id)) continue;
			const key = `${folder}:${id}`;
			const list = bodies.get(key) || [];
			list.push({ file: `BinOutput/Talk/${folder}/${file}`, data });
			bodies.set(key, list);
		}
	}
	return bodies;
}

function getActionKeys() {
	if (actionKeys) return actionKeys;
	const keys = getTalkKeys();
	const shop = getBin('Talk/Npc/6146501')[keys.dialogList];
	const greeting = getBin('Talk/Npc/6156701')[keys.dialogList][0];
	actionKeys = {
		actionAfter: findKey(shop.find(dialog => dialog[keys.dialogId] === 614650102),
			value => value === 'Shop/shop_open_1012', 'dialog action after'),
		actionWhile: findKey(greeting, value => value === 'TEST/LerpInNpc', 'dialog action while'),
		optionIcon: findKey(shop.find(dialog => dialog[keys.dialogId] === 614650101),
			value => value === 'UI_Icon_Intee_Shop', 'dialog option icon')
	};
	const globalDialogs = getBin('Talk/Quest/GlobalDialog')[keys.dialogList];
	const before = globalDialogs.find(dialog => dialog[keys.dialogId] === 3470101);
	if (before) {
		const candidates = Object.keys(before).filter(key => before[key] === 'TEST/Readable01');
		if (candidates.length === 1) actionKeys.actionBefore = candidates[0];
	}
	return actionKeys;
}

function makeNpcDialog(language, dialog) {
	const result = makeDialog(language, dialog);
	for (const [name, key] of Object.entries(getActionKeys())) {
		if (dialog[key]) result[name] = dialog[key];
	}
	return result;
}

function makeConditions(talk) {
	const stateNames = ['QUEST_STATE_NONE', 'QUEST_STATE_UNSTARTED', 'QUEST_STATE_UNFINISHED', 'QUEST_STATE_FINISHED', 'QUEST_STATE_FAILED'];
	return {
		logic: talk.beginCondComb || '',
		conditions: (talk.beginCond || []).filter(condition => condition.type).map(condition => {
			const params = [...(condition.param || [])];
			while (params.at(-1) === '') params.pop();
			const state = /^QUEST_COND_(?:QUEST_)?STATE_(?:NOT_)?EQUAL$/.test(condition.type);
			return {
				type: condition.type,
				rawParams: params,
				...(state ? { stepId: Number(params[0]), stateName: stateNames[Number(params[1])] } : {})
			};
		})
	};
}

function collateNpc(language, group) {
	const diagnostics = [];
	const configured = new Set(group.talks.map(talk => talk.id));
	const pending = [...configured];
	const talks = [];
	const keys = getTalkKeys();
	for (let index = 0; index < pending.length; index++) {
		const id = pending[index];
		const talk = talkById.get(id);
		if (!talk || !(talk.npcId || []).includes(group.id)) {
			diagnostics.push({ type: 'missing_talk', id });
			continue;
		}
		const folders = configured.has(id) ? ['Npc', 'Quest'] : talk.questId ? ['Quest', 'Npc'] : ['Npc', 'Quest'];
		const candidates = folders.flatMap(folder => getBodies().get(`${folder}:${id}`) || []);
		const body = candidates.find(body => (body.data[keys.dialogList] || [])
			.some(dialog => dialog[keys.dialogId] === talk.initDialog));
		if (!body) {
			diagnostics.push({ type: 'missing_initial_dialog', id, dialog: talk.initDialog });
			continue;
		}
		const nextTalks = (talk.nextTalks || []).filter(id => id > 0);
		for (const next of nextTalks) if (!pending.includes(next)) pending.push(next);
		const raw = group.talks.find(item => item.id === id);
		talks.push({
			id,
			...(talk.questId ? { questId: talk.questId } : {}),
			priority: talk.priority || 0,
			beginWay: talk.beginWay || '',
			activeMode: raw?.activeMode || talk.activeMode || '',
			...(raw?.activeMode && talk.activeMode && raw.activeMode !== talk.activeMode
				? { excelActiveMode: talk.activeMode } : {}),
			initDialog: talk.initDialog,
			nextTalks,
			beginConditions: makeConditions(talk),
			performCfg: talk.performCfg || '',
			finishExec: (talk.finishExec || []).filter(action => action.type),
			trigger: { objectIds: talk.npcId || [], objectNames: (talk.npcId || []).map(id => getNpcName(language, id)).filter(Boolean), points: [] },
			source: body.file,
			dialogs: (body.data[keys.dialogList] || []).map(dialog => makeNpcDialog(language, dialog))
		});
	}
	const available = new Set(talks.map(talk => talk.id));
	const incoming = new Set(talks.flatMap(talk => talk.nextTalks));
	const entryTalks = [...configured].filter(id => available.has(id) && !incoming.has(id));
	return {
		id: group.id,
		name: getNpcName(language, group.id) || getNpcName(getLanguage('CHS'), group.id),
		alias: `NPC ${group.id}`,
		source: { group: group.file, resource: group.resource },
		entryTalks,
		talks,
		diagnostics
	};
}

function collateNpcs(languageCode = 'CHS') {
	getTalkKeys();
	getActionKeys();
	getBodies();
	const language = getLanguage(languageCode);
	const result = {};
	for (const group of getGroups().values()) {
		const npc = record(() => collateNpc(language, group));
		if (npc.name && npc.entryTalks.length) result[`npc_${group.id}`] = npc;
	}
	return result;
}

module.exports = collateNpcs;
