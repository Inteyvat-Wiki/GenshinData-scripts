require('./global.js');

const xstory = getExcel('FetterStoryExcelConfigData');
let mycharacter;

function collateStory(lang) {
	const language = getLanguage(lang);

	if (!mycharacter) mycharacter = require(`${config.genshin_export_folder}/EN/characters.json`);
	let mystory = Object.entries(mycharacter).reduce((accum, [filename, charObj]) => {
		let data = {};
		data.id = charObj.id;
		data.name = charObj.name;
		const avatar = xplayableAvatar.find(avatar => avatar.id === charObj.id);
		if (avatar) language[avatar.nameTextMapHash]; // Track the copied character name's source.
		data.stories = [];

		let list = xstory.filter(ele => ele.avatarId === charObj.id);
		for (let i = 0; i < list.length; i++) {
			let res = {};
			
			res.title = language[list[i].storyTitle2TextMapHash] || language[list[i].storyTitleTextMapHash];
			res.description = sanitizeDescription(language[list[i].storyContext2TextMapHash] || language[list[i].storyContextTextMapHash]);
			res.descriptionRaw = sanitizer(language[list[i].storyContext2TextMapHash] || language[list[i].storyContextTextMapHash], replaceNewline);
			res.tips = [];
			for (let j of list[i].tips) {
				if (language[j]) {
					res.tips.push(sanitizeDescription(language[j], replaceNewline));
				}
			}

			data.stories.push(res);
		}

		accum[filename] = data;

		return accum;
	}, {});
	return mystory;
}

module.exports = collateStory;
