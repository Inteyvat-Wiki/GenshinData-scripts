require('./global.js');

const xmaterial = getExcel('MaterialExcelConfigData');
const xsource = getExcel('MaterialSourceDataExcelConfigData');
const xarchive = getExcel('MaterialCodexExcelConfigData');
const xdocument = getExcel('DocumentExcelConfigData');
const xlocalization = getExcel('LocalizationExcelConfigData');
const xgadgetinteract = getExcel('GadgetInteractExcelConfigData');

const sourceById = new Map(xsource.map(obj => [obj.id, obj]));
const archiveByMaterialId = new Map(xarchive.map(obj => [obj.materialId, obj]));
const documentById = new Map(xdocument.map(obj => [obj.id, obj]));
const localizationById = new Map(xlocalization.map(obj => [obj.id, obj]));
const gadgetInteractionsByItemId = new Map();

const readablePathProperties = {
	CHS: ['DEFNEHAFMMA', 'JDNBKKPEFAI'],
	CHT: ['tcPath'],
	DE: ['dePath'],
	EN: ['enPath'],
	ES: ['esPath'],
	FR: ['frPath'],
	ID: ['idPath'],
	IT: ['itPath'],
	JP: ['jpPath'],
	KR: ['krPath'],
	PT: ['ptPath'],
	RU: ['ruPath'],
	TH: ['thPath'],
	TR: ['trPath'],
	VI: ['viPath']
};

xgadgetinteract.forEach(interaction => {
	(interaction.costItems || []).forEach(costItem => {
		if (costItem.id === undefined) return;
		if (!gadgetInteractionsByItemId.has(costItem.id)) gadgetInteractionsByItemId.set(costItem.id, []);
		gadgetInteractionsByItemId.get(costItem.id).push({ interaction, costItem });
	});
});

function getText(language, textMapHash) {
	return textMapHash === undefined || textMapHash === null ? '' : language[textMapHash] || '';
}

function getReadablePath(localization, lang) {
	const properties = readablePathProperties[lang] || [];
	for (const property of properties) {
		if (localization[property]) return localization[property];
	}
	return '';
}

function getReadableName(path) {
	return path.substring(path.lastIndexOf('/') + 1).replaceAll('\\', '/');
}

function getFilename(material, accum) {
	const filename = makeUniqueFileName(material.nameTextMapHash, accum);
	return filename || `quest_item_${material.id}`;
}

function getReadableData(document, lang, language) {
	const localizationIds = document ? document.questIDList || [] : [];
	const readablePaths = localizationIds.map(id => localizationById.get(id))
		.filter(localization => localization !== undefined)
		.map(localization => getReadablePath(localization, lang))
		.filter(path => path !== '');
	const content = readablePaths
		.map(path => getReadable(getReadableName(path), lang))
		.filter(text => text !== '');

	return {
		documentId: document && document.id,
		documentTitle: getText(language, document && document.titleTextMapHash),
		localizationIds,
		readablePaths,
		previewPath: document ? document.previewPath : '',
		splitType: document ? document.splitType : '',
		content
	};
}

function getSourceTexts(source, language) {
	if (!source) return [];

	const hashes = ['textList', 'jumpList', 'jumpDescs'].flatMap(property => {
		return Array.isArray(source[property]) ? source[property] : [];
	});
	return hashes.map(hash => getText(language, hash)).filter(text => text !== '');
}

function getItemUses(material) {
	const itemUses = (material.itemUse || []).filter(itemUse => itemUse.useOp !== undefined);
	return itemUses.length > 0 ? itemUses : undefined;
}

function getGadgetInteractions(itemId, language) {
	const entries = gadgetInteractionsByItemId.get(itemId) || [];
	return entries.map(({ interaction, costItem }) => ({
		interactId: interaction.interactId,
		param1: interaction.param1,
		uiDesc: getText(language, interaction.uiDescTextMapHash),
		count: costItem.count,
		actionList: interaction.actionList,
		condList: interaction.condList,
		isMpModeInteract: interaction.isMpModeInteract
	}));
}

function collateQuestItem(lang) {
	const language = getLanguage(lang);
	const dupeCheck = {};

	return xmaterial.reduce((accum, material) => {
		if (material.materialType !== 'MATERIAL_QUEST') return accum;

		let data = {};
		data.id = material.id;
		data.alias = `QuestItem ${material.id}`;
		data.name = getText(language, material.nameTextMapHash);
		if (data.name === '') return accum;

		data.sortRank = material.rank;
		data.description = sanitizeDescription(getText(language, material.descTextMapHash));
		data.category = material.materialType.slice(9);
		data.materialType = material.materialType;
		data.typeText = getText(language, material.typeDescTextMapHash);
		if (material.rankLevel !== undefined) data.rarity = material.rankLevel;
		if (material.stackLimit !== undefined) data.stackLimit = material.stackLimit;
		if (material.weight !== undefined) data.weight = material.weight;

		const archive = archiveByMaterialId.get(material.id);
		data.fullDescription = archive ? sanitizeDescription(getText(language, archive.descTextMapHash)) : '';

		const sourceTexts = getSourceTexts(sourceById.get(material.id), language);
		data.sources = sourceTexts;

		const itemUses = getItemUses(material);
		if (itemUses !== undefined) data.itemUse = itemUses;
		if (material.gadgetId !== undefined) data.gadgetId = material.gadgetId;
		if (material.effectGadgetID !== undefined) data.effectGadgetId = material.effectGadgetID;
		if (material.maxUseCount !== undefined) data.maxUseCount = material.maxUseCount;
		if (material.useOnGain !== undefined) data.useOnGain = material.useOnGain;
		if (material.useTarget !== undefined) data.useTarget = material.useTarget;

		const interactionTitle = getText(language, material.interactionTitleTextMapHash);
		if (interactionTitle !== '') data.interactionTitle = interactionTitle;

		const document = documentById.get(material.id);
		Object.assign(data, getReadableData(document, lang, language));

		const gadgetInteractions = getGadgetInteractions(material.id, language);
		if (gadgetInteractions.length > 0) data.gadgetInteractions = gadgetInteractions;

		data.filename_icon = material.icon;
		if (!data.filename_icon) console.log(data.name+' has no icon');

		let filename = getFilename(material, accum);
		checkDupeName(data, dupeCheck);
		accum[filename] = data;
		return accum;
	}, {});
}

module.exports = collateQuestItem;
