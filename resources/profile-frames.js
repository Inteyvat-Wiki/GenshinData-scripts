const path = require('node:path');
const assert = require('node:assert/strict');
const { prepare, createResourceLookup } = require('./miliastra');

const resourceIcon = createResourceLookup(() => process.env.PROFILE_FRAME_RESOURCE_CACHE
    || path.resolve(__dirname, '../.cache/profile-frame-resources.json'));
module.exports = { resourceIcon };
if (require.main === module) {
    const [index, imageMap, output, source] = process.argv.slice(2);
    assert(source, 'Usage: node resources/profile-frames.js INDEX IMAGE_MAP_JSON NEW_CACHE RAW_DATA');
    console.log(JSON.stringify(prepare(index, imageMap, output, source,
        [{ table: 'ProfileFrameExcelConfigData', field: 'iconPathHash' }])));
}
