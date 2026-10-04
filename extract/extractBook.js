require('./global.js');
const { getReadableData } = require('./document.js');

const xbooks = getExcel('BooksCodexExcelConfigData');
const xmaterial = getExcel('MaterialExcelConfigData');
const xsuit = getExcel('BookSuitExcelConfigData');
const xdocument = getExcel('DocumentExcelConfigData');

const materialById = new Map(xmaterial.map(obj => [obj.id, obj]));
const suitById = new Map(xsuit.map(obj => [obj.id, obj]));
const documentById = new Map(xdocument.map(obj => [obj.id, obj]));

const books = xbooks;

function getText(language, textMapHash) {
	return textMapHash === undefined || textMapHash === null ? '' : language[textMapHash] || '';
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
		const { localizationIds, readablePaths, content } = getReadableData(document, lang);

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
			content: content.join('\n\n'),
			filename_icon: material.icon
		};

		const filename = getFilename(book, material, accum);
		data.alias = [`Book ${book.id}`, filename];
		accum[filename] = data;
		return accum;
	}, {});
}

module.exports = collateBook;
