// Targeted export uses the same version builder/writer as the ordinary entry point.
require('./versions/textmap').build(require('./config.json'))
    .then(() => {
        const { exportData } = require('./extract/global');
        exportData('misc', require('./extract/extractMisc'), false, false, ['CHS', 'EN']);
        // Remove only the retired, reproducible mail catalogue in this export folder.
        const fs = require('node:fs'), path = require('node:path');
        const root = path.resolve(require('./config.json').genshin_output_folder);
        for (const language of ['ChineseSimplified', 'English']) {
            const directory = path.join(root, language, 'misc');
            for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
                if (entry.isFile() && /^mail_template-\d+\.json$/.test(entry.name)) fs.unlinkSync(path.join(directory, entry.name));
            }
        }
    })
    .catch(error => { console.error(error.stack || error); process.exitCode = 1; });
