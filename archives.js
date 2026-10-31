const { exportData } = require('./extract/global');
const extractors = { serenitea: './extract/extractSerenitea', tcg: './extract/extractTcg', miliastra: './extract/extractMiliastra' };
const selected = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(extractors);
for (const category of selected) {
    if (!Object.hasOwn(extractors, category)) throw new Error(`Unknown archive category: ${category}`);
    exportData(category, require(extractors[category]), false, false, ['CHS', 'EN']);
}
