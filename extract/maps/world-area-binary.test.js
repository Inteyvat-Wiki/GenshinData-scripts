const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fixtures = require('./fixtures/world-area-client.json');
const { PROFILE, decodeWorldArea } = require('./world-area-binary');

test('real client payloads decode complete groups, heights and multiple parts without JSON input', () => {
    for (const fixture of fixtures) {
        const bytes = Buffer.from(fixture.base64, 'base64');
        assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), fixture.sha256);
        assert.deepEqual(decodeWorldArea(bytes, PROFILE), fixture.expected);
    }
    const scene102 = decodeWorldArea(Buffer.from(fixtures.find(f => f.scene === 102).base64, 'base64'), PROFILE);
    assert.equal(scene102.level1Areas.length, 3);
    assert.equal(scene102.level1Areas[0].level2Areas.filter(a => a.id2 === 90002).length, 2);
    assert.deepEqual(decodeWorldArea(Buffer.from([0x4b]), PROFILE), {});
});
test('client decoder rejects truncation, trailing bytes, incompatible profiles and field layouts', () => {
    for (const fixture of fixtures) {
        const bytes = Buffer.from(fixture.base64, 'base64');
        assert.throws(() => decodeWorldArea(bytes.subarray(0, -1), PROFILE));
        assert.throws(() => decodeWorldArea(Buffer.concat([bytes, Buffer.from([0])]), PROFILE), /trailing/);
        assert.throws(() => decodeWorldArea(bytes, 'unknown'), /profile/);
        const changed = Buffer.from(bytes); changed[8] = 0x90;
        assert.throws(() => decodeWorldArea(changed, PROFILE));
        const count = Buffer.from(bytes); count[1] ^= 1;
        assert.throws(() => decodeWorldArea(count, PROFILE));
    }
});
