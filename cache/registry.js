const extractors = {
    characters: 'Character', constellations: 'Constellation', talents: 'Talent', hyperlinks: 'Hyperlinks',
    stories: 'Story', chapters: 'Chapter', tasks: 'Task', npcs: 'Npc', serenitea: 'Serenitea', tcg: 'Tcg',
    miliastra: 'Miliastra', misc: 'Misc', tasksubtitles: 'TaskSubtitles', weapons: 'Weapon', artifacts: 'Artifact',
    foods: 'Food', questitems: 'QuestItem', materials: 'Material', books: 'Book', documents: 'Document',
    domains: 'Domain', enemies: 'Enemy', outfits: 'Outfit', windgliders: 'WindGlider', weaponskins: 'WeaponSkin', animals: 'Animal',
    namecards: 'Namecard', geographies: 'Geography', dungeons: 'Dungeon', maplayers: 'MapLayer', maps: 'Maps',
    achievements: 'Achievement', achievementgroups: 'AchievementGroup', adventureranks: 'AdventureRank',
    crafts: 'Craft', emojis: 'Emoji', emojisets: 'EmojiSet', voiceovers: 'Voiceover',
};
const languages = { CHS: 'ChineseSimplified', CHT: 'ChineseTraditional', DE: 'German', EN: 'English', ES: 'Spanish',
    FR: 'French', ID: 'Indonesian', IT: 'Italian', JP: 'Japanese', KR: 'Korean', PT: 'Portuguese', RU: 'Russian', TH: 'Thai', TR: 'Turkish', VI: 'Vietnamese' };
const archives = new Set(['serenitea', 'tcg', 'miliastra', 'misc', 'tasksubtitles', 'maps']);
function select(options) {
    if (!Array.isArray(options.folders) || !options.folders.length) throw new Error('Specify non-empty folders to prepare');
    const folders = [...new Set(options.folders)].sort();
    for (const folder of folders) if (!Object.hasOwn(extractors, folder) && folder !== 'interactions') throw new Error(`Unsupported extractor ${folder}`);
    const requested = options.languages || ['CHS', 'EN'];
    if (!Array.isArray(requested) || !requested.length) throw new Error('Specify non-empty languages');
    const selected = [...new Set(requested.map(value => Object.hasOwn(languages, value) ? value : Object.keys(languages).find(key => languages[key] === value)))];
    if (selected.includes(undefined)) throw new Error('Unknown extraction language');
    if (folders.some(folder => archives.has(folder)) && selected.some(value => !['CHS', 'EN'].includes(value))) throw new Error('Research catalogues currently support CHS and EN only');
    // Version dependencies and cross-folder joins require both languages even for a single-language request.
    if (options.versions !== false) selected.push('CHS', 'EN');
    if (folders.some(folder => ['stories', 'voiceovers', 'domains'].includes(folder))) selected.push('EN');
    return { folders, languages: [...new Set(selected)].sort() };
}
module.exports = { extractors, languages, select };
