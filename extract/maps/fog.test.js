const test = require('node:test');
const assert = require('node:assert/strict');
const { fogMaterialFormats } = require('./fog');
const string = value => { const b = Buffer.alloc(4 + Math.ceil(value.length / 4) * 4); b.writeInt32LE(value.length); b.write(value, 4); return b; };
test('fog formats must be adjacent native strings, with a paired outline', () => {
    const data = Buffer.concat([Buffer.alloc(16), string('ART/UI/UIMap/UICloudMask/Material/'), string('Fog_{0}'), string('Fog_{0}_Outline')]);
    assert.equal(fogMaterialFormats(data, 16).mask, 'Fog_{0}');
    assert.throws(() => fogMaterialFormats(data.subarray(0, data.length - 4), 16), /Missing/);
    assert.throws(() => fogMaterialFormats(Buffer.concat([data, data]), 16), /ambiguous/);
});
