// Compatibility CLI: resource-cache interpretation remains upstream.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { extractResources } = require('@inteyvat-wiki/resource-tools');
const { readResourceCache } = require('./miliastra');
function run(cacheFile, destination, studio = 'C:/Apps/AnimeStudio') {
    const cache = readResourceCache(path.resolve(cacheFile));
    const report = extractResources({entries: Object.values(cache.resources).map(record => record.image),
        output: path.resolve(destination), studio, game: 'GI', selection: cache.image_selection || 'preserve',
        inputs: [path.resolve(cacheFile)]});
    fs.copyFileSync(cacheFile, path.join(destination, 'resource-plan.json'), fs.constants.COPYFILE_EXCL);
    return report;
}
module.exports = {run};
if (require.main === module) {
    try {
        const [cacheFile, destination, studio] = process.argv.slice(2);
        assert(destination, 'Usage: node resources/extract-miliastra-images.js CACHE NEW_OUTPUT [STUDIO]');
        const report = run(cacheFile, destination, studio);
        console.log(JSON.stringify({status: report.status, output: report.output}));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
