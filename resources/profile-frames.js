const assert = require('node:assert/strict');
const { prepare: prepareMiliastra, createResourceLookup } = require('./miliastra');

const resourceIcon = createResourceLookup(() => require('../runtime-paths').resourceCachePath('profileFrames'));
function prepare(index, imageMap, output, source) {
    return prepareMiliastra(index, imageMap, output, source,
        [{ table: 'ProfileFrameExcelConfigData', field: 'iconPathHash' }]);
}
module.exports = { resourceIcon, prepare };
if (require.main === module) {
    const [index, imageMap, output, source] = process.argv.slice(2);
    assert(source, 'Usage: node resources/profile-frames.js INDEX IMAGE_MAP_JSON NEW_CACHE RAW_DATA');
    console.log(JSON.stringify(prepare(index, imageMap, output, source)));
}
