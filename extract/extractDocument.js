require('./global.js');
const { getReadableData } = require('./document.js');

const xdocument = getExcel('DocumentExcelConfigData');

function collateDocument(lang) {
	const language = getLanguage(lang);
	const dupeCheck = {};

	return xdocument.reduce((accum, document) => {
		const data = {
			id: document.id,
			alias: `Document ${document.id}`,
			name: language[document.titleTextMapHash] || '',
			content: getReadableData(document, lang).content
		};

		const englishTitle = getLanguage('EN')[document.titleTextMapHash] || '';
		let filename = makeUniqueFileName(document.titleTextMapHash, accum);
		if (!filename && englishTitle) {
			const base = `title_${Array.from(englishTitle).map(char => char.codePointAt(0).toString(16)).join('_')}`;
			filename = base;
			let index = 1;
			while (accum[filename]) filename = `${base}-${String(index++).padStart(2, '0')}`;
		}
		if (!filename) filename = `document_${document.id}`;
		if (data.name) checkDupeName(data, dupeCheck, [], true);
		accum[filename] = data;
		return accum;
	}, {});
}

module.exports = collateDocument;
