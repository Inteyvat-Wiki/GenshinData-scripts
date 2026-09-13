require('./global.js');

const xbooks = getExcel('BooksCodexExcelConfigData');
const xmaterial = getExcel('MaterialExcelConfigData');
const xsuit = getExcel('BookSuitExcelConfigData');
const xdocument = getExcel('DocumentExcelConfigData');
const xlocalization = getExcel('LocalizationExcelConfigData');

const materialById = new Map(xmaterial.map(obj => [obj.id, obj]));
const suitById = new Map(xsuit.map(obj => [obj.id, obj]));
const documentById = new Map(xdocument.map(obj => [obj.id, obj]));
const localizationById = new Map(xlocalization.map(obj => [obj.id, obj]));

const books = xbooks;

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

function getFilename(book, material, accum) {
	const filename = makeUniqueFileName(material.nameTextMapHash, accum);
	return filename || `book_${book.id}`;
}

function collateBook(lang) {
	const language = getLanguage(lang);

	return books.reduce((accum, book) => {
		const material = materialById.get(book.materialId);
		if (!material) return accum;

		const name = getText(language, material.nameTextMapHash);

		const suit = material.setID === undefined ? undefined : suitById.get(material.setID);
		const document = documentById.get(material.id);
		const localizationIds = document ? document.questIDList || [] : [];
		const readablePaths = localizationIds.map(id => localizationById.get(id))
			.filter(localization => localization !== undefined)
			.map(localization => getReadablePath(localization, lang))
			.filter(path => path !== '');
		const content = readablePaths
			.map(path => getReadable(getReadableName(path), lang))
			.filter(text => text !== '')
			.join('\n\n');

		const data = {
			id: material.id,
			materialId: book.materialId,
			name,
			description: getText(language, material.descTextMapHash),
			setId: material.setID,
			setName: getText(language, suit && suit.suitNameTextMapHash),
			codexId: book.id,
			sortOrder: book.sortOrder,
			isDisuse: book.isDisuse,
			materialType: material.materialType,
			typeText: getText(language, material.typeDescTextMapHash),
			gadgetId: material.gadgetId,
			documentId: document && document.id,
			documentTitle: getText(language, document && document.titleTextMapHash),
			localizationIds,
			readablePaths,
			previewPath: document ? document.previewPath : '',
			splitType: document ? document.splitType : '',
			content,
			filename_icon: material.icon
		};

		const filename = getFilename(book, material, accum);
		accum[filename] = data;
		return accum;
	}, {});
}

module.exports = collateBook;
