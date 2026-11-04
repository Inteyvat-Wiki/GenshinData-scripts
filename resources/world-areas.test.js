const test = require('node:test');
const assert = require('node:assert/strict');
const { resourceKey, readResourceCache } = require('./world-areas');
const { createSource } = require('../extract/maps/source');
const { parse } = require('../cache/cli');

test('WorldArea paths resolve exact client full UInt64 keys and preserve signed containers', () => {
    assert.deepEqual(resourceKey(3), { scene_id: 3, asset_path: 'Data/_BinOutput/Scene/WorldArea/scene3_worldArea.MiHoYoBinData', resource_key: '10662376625415199788', container: '210980124' });
    assert.equal(resourceKey(101).resource_key, '3713855103054728295');
    assert.equal(resourceKey(101).container, '-1978345140');
    assert.throws(() => resourceKey(-1));
});
test('missing client data cannot silently fall back to the community WorldArea JSON', () => {
    assert.throws(() => readResourceCache(), /fallback is disabled/);
    const source = createSource('does-not-exist', () => '');
    assert.throws(() => source.bin('Scene/WorldArea/scene3_worldArea'), /client resources/);
    assert.throws(() => source.files('Scene/WorldArea'), /client resources/);
    assert.deepEqual(parse(['prepare', '--folders', 'maps', '--world-area-resources', 'client.json']).options.resourceCaches, { worldAreas: 'client.json' });
});
