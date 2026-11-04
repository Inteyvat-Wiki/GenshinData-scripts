require('./global.js');
const { createStoryReader } = require('./cosmetics');

const xmat = getExcel('MaterialExcelConfigData');
const xfly = getExcel('AvatarFlycloakExcelConfigData');
const story = createStoryReader(getExcel('DocumentExcelConfigData'), getExcel('LocalizationExcelConfigData'), getReadable);

function collateWindGlider(lang) {
	const language = getLanguage(lang);
	const dupeCheck = {};
	let mydata = xfly.reduce((accum, obj) => {
		let data = {};
		data.id = obj[getPropMaterialId()];

		data.name = language[obj.nameTextMapHash];
		data.descriptionRaw = replaceNewline(language[obj.descTextMapHash] || '');
		data.description = sanitizeDescription(data.descriptionRaw);

		data.story = story(data.id, lang);

		let flymat = xmat.find(ele => ele.id === obj[getPropMaterialId()]) || {};

		data.rarity = flymat.rankLevel;
		// data.sortorder = obj[getPropMaterialId()];
		data.isHidden = obj.hide ? true : undefined;

		// let sauce = xsource.find(ele => ele.id === obj.id);
		// data.source = sauce.textList.map(ele => language[ele]).filter(ele => ele !== '');
		data.source = getMatSourceText(obj[getPropMaterialId()], language);

		data.filename_icon = flymat.icon;
		data.filename_gacha = obj.icon;


		let filename = makeUniqueFileName(obj.nameTextMapHash, accum) || String(data.id);
		checkDupeName(data, dupeCheck);
		accum[filename] = data;
		return accum;
	}, {});

	return mydata;
}

let propMaterialId = undefined;
function getPropMaterialId() {
	if(propMaterialId !== undefined) return propMaterialId;
	for (let [key, value] of Object.entries(xfly[0])) {
		if (typeof value === 'number' && value === 140001) {
			propMaterialId = key;
			return propMaterialId;
		}
	}
}


module.exports = collateWindGlider;
