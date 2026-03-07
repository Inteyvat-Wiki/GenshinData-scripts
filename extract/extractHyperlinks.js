require('./global.js');

const xstory = getExcel('HyperLinkNameExcelConifgData'); // not 'Config' !!!

function collateStory(lang) {
	const language = getLanguage(lang);
	let myhyperlink = {
        hyperlinks: {
            name: "hyperlinks",
            hyperlinks: [],
        },
    };

    xstory.forEach(obj => {
		myhyperlink.hyperlinks.hyperlinks.push({
			id: obj.id,
			title: language[obj.nameTextMapHash],
            description: sanitizeDescription(language[obj.descTextMapHash]),
            descriptionRaw: sanitizer(language[obj.descTextMapHash], replaceNewline),
            params: obj.descParamList,
            color: obj.color,
		});
	});

	return myhyperlink;
}

module.exports = collateStory;