require('./global.js');

const xlocalization = getExcel('LocalizationExcelConfigData');
const localizationById = new Map(xlocalization.map(obj => [obj.id, obj]));

const readablePathProperties = {
	CHT: 'tcPath', DE: 'dePath', EN: 'enPath', ES: 'esPath', FR: 'frPath',
	ID: 'idPath', IT: 'itPath', JP: 'jpPath', KR: 'krPath', PT: 'ptPath',
	RU: 'ruPath', TH: 'thPath', TR: 'trPath', VI: 'viPath'
};

function getReadablePath(localization, lang) {
	if (!localization) return '';
	if (lang === 'CHS') {
		// The Chinese field names change between versions; the resource language does not.
		return Object.values(localization).find(value =>
			typeof value === 'string' && value.replaceAll('\\', '/').includes('/Readable/CHS/')) || '';
	}
	return localization[readablePathProperties[lang]] || '';
}

function getReadableData(document, lang) {
	const localizationIds = document ? document.questIDList || [] : [];
	const readablePaths = localizationIds
		.map(id => getReadablePath(localizationById.get(id), lang))
		.filter(path => path !== '');
	const content = readablePaths.map(path => {
		const name = path.replaceAll('\\', '/').split('/').pop().replace(/\.txt$/i, '');
		return getReadable(name, lang);
	}).filter(text => text !== '');
	return { localizationIds, readablePaths, content };
}

module.exports = { getReadableData };
