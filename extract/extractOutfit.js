require('./global.js');
const { resolveField, createStoryReader } = require('./cosmetics');

const xmat = getExcel('MaterialExcelConfigData');
const xcostume = getExcel('AvatarCostumeExcelConfigData');
const xavatar = getExcel('AvatarExcelConfigData');
const story = createStoryReader(getExcel('DocumentExcelConfigData'), getExcel('LocalizationExcelConfigData'), getReadable);
const defaultCard = getExcel('ConstValueExcelConfigData').find(row => row.name === 'CONST_VALUE_DEFAULT_COSTUME_ICON')?.value[0];

// for AvatarCostumeExcelConfigData
// Jean's summer outfit remains a witness when rows are reordered or keys obfuscated.
const sample = xcostume.find(row => row.itemId === 340001);
const propertyMap = {
	id: resolveField('skinId', sample, 200301),
	avatarId: resolveField('characterId', sample, 10000003),
	iconName: resolveField('frontIconName', sample, 'UI_AvatarIcon_QinCostumeSea'),
};

// taken from collateCharacter.js
const playerIdToTextMapHash = { 10000005: 4041832592, 10000007: 3652968845 };

function collateOutfit(lang) {
	const language = getLanguage(lang);
	let myoutfit = xcostume.reduce((accum, obj) => {

		let data = {};
		data.id = obj[propertyMap.id];

		data.name = language[obj.nameTextMapHash] || '';
		data.descriptionRaw = replaceNewline(language[obj.descTextMapHash] || '');
		data.description = sanitizeDescription(data.descriptionRaw);
		data.story = story(obj.itemId, lang);

		data.isDefault = obj.isDefault === true;

		const AvatarId = obj[propertyMap.avatarId];
		const avatar = xavatar.find(ele => ele.id === AvatarId);
		if (!avatar) throw new Error(`Missing costume avatar: ${data.id}/${AvatarId}`);
		if(playerIdToTextMapHash[AvatarId])
			data.characterName = language[playerIdToTextMapHash[AvatarId]];
		else
			data.characterName = language[avatar.nameTextMapHash] || '';
		data.characterId = AvatarId;

		if(obj.itemId) {
			data.source = getMatSourceText(obj.itemId, language);

			data.filename_card = xmat.find(ele => ele.id === obj.itemId).icon;
		} else {
			data.filename_card = defaultCard;
		}

		if(obj[propertyMap.iconName]) {
			data.filename_icon = obj[propertyMap.iconName];
			const name = data.filename_icon.slice(data.filename_icon.lastIndexOf('_')+1);

			data.filename_iconCircle = `UI_AvatarIcon_${name}_Circle`;
			data.filename_splash = `UI_Costume_${name}`;
		} else {
			// The avatar's actual icon is available even when the costume has no custom artwork.
			const iconnametemp = avatar.iconName;
			data.filename_icon = iconnametemp;
			const name = iconnametemp.slice(iconnametemp.lastIndexOf('_')+1);
			data.filename_iconCircle = `UI_AvatarIcon_${name}_Circle`;
		}

		data.filename_sideIcon = obj.sideIconName || avatar.sideIconName;



		// data.nameicon = obj.icon;
		// data.namebanner = obj.useParam[0] !== "" ? obj.useParam[0] : undefined;
		// data.namebackground = obj.useParam[1];

		// Keep named defaults and source placeholders; never silently overwrite duplicate names.
		let filename = makeUniqueFileName(obj.nameTextMapHash, accum) || String(data.id);
		if(playerIdToTextMapHash[AvatarId])
			filename += makeFileName(getLanguage('EN')[playerIdToTextMapHash[AvatarId]]);
		if(accum[filename] !== undefined) throw new Error('Duplicate costume filename: ' + filename);
		accum[filename] = data;
		return accum;
	}, {});

	return myoutfit;
}

module.exports = collateOutfit;
