const config = require('../runtime-config');
const { extractors } = require('./registry');
const { exportData, exportCurve } = require('../extract/global');
const { folders, languages } = config.cache_selection;
const required = new Set(folders);
if (required.has('stories') || required.has('voiceovers')) required.add('characters');
if (required.has('domains')) required.add('enemies');
for (const [folder, suffix] of Object.entries(extractors)) {
    if (!required.has(folder)) continue;
    exportData(folder, require(`../extract/extract${suffix}`), false, false, languages);
    const curve = { characters: 'AvatarCurveExcelConfigData', weapons: 'WeaponCurveExcelConfigData', enemies: 'MonsterCurveExcelConfigData' }[folder];
    if (curve) exportCurve(folder, curve);
}
if (required.has('domains')) exportData('domains', require('../extract/extractDomainMonsterList'), false, false, languages);
if (required.has('interactions')) {
    if (!require('node:fs').existsSync(require('node:path').join(config.GenshinData_folder, 'BinOutput/InterAction'))) throw new Error('InterAction input directory is missing');
    require('../extract/extractInteraction')();
}
