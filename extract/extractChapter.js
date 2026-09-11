require('./global.js');

const xchapter = getExcel('ChapterExcelConfigData');
const xmainquest = getExcel('MainQuestExcelConfigData');

function getText(language, textMapHash) {
	return textMapHash && language[textMapHash] ? language[textMapHash] : '';
}

function collateChapter(lang) {
	const language = getLanguage(lang);
	const mainQuestIdsByChapterId = new Map();
	const dupeCheck = {};

	for (const mainQuest of xmainquest) {
		if (!mainQuest.chapterId) continue;
		if (!mainQuestIdsByChapterId.has(mainQuest.chapterId)) {
			mainQuestIdsByChapterId.set(mainQuest.chapterId, []);
		}
		mainQuestIdsByChapterId.get(mainQuest.chapterId).push(mainQuest.id);
	}

	return xchapter.reduce((accum, chapter) => {
		const taskIds = mainQuestIdsByChapterId.get(chapter.id) || [];
		const filename = makeUniqueFileName(chapter.chapterTitleTextMapHash, accum);
		const name = getText(language, chapter.chapterTitleTextMapHash);
		const numberName = getText(language, chapter.chapterNumTextMapHash);

		if (!filename) return accum;
		if (taskIds.length === 0) return accum;

		const data = {
			id: chapter.id,
			name,
			numberName,
			filename_icon: chapter.chapterIcon || '',
			taskIds
		};
		checkDupeName(data, dupeCheck);
		accum[filename] = data;

		return accum;
	}, {});
}

module.exports = collateChapter;
