const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function hash(file) {
    const digest = crypto.createHash('sha256'), fd = fs.openSync(file, 'r'), buffer = Buffer.alloc(1024 * 1024); let bytes = 0;
    try { let n; while ((n = fs.readSync(fd, buffer, 0, buffer.length, null))) { digest.update(buffer.subarray(0, n)); bytes += n; } }
    finally { fs.closeSync(fd); }
    return { file: path.resolve(file), bytes, sha256: digest.digest('hex') };
}
function verify(input) { const actual = hash(input.file); assert.equal(actual.sha256, input.sha256, `Stale map resource input: ${input.file}`);
    if (input.bytes !== undefined) assert.equal(actual.bytes, input.bytes); return actual; }
const identity = e => JSON.stringify([path.resolve(e.Source), e.Offset, e.PathID, e.Type]);
function evidence() {
    const inputs = new Map();
    const remember = input => { const file = path.resolve(input.file), previous = inputs.get(file);
        if (previous) assert.equal(previous.sha256, input.sha256, `Conflicting input: ${file}`); else inputs.set(file, verify(input)); };
    const file = name => { const input = hash(name); remember(input); return read(name); };
    function report(name, format) {
        const r = file(name); assert.equal(r.status, 'complete'); if (format) assert.equal(r.format, format);
        for (const input of [...r.inputs || [], r.tool, r.bridge, r.runtime].filter(Boolean)) remember(input);
        for (const resource of r.resources || []) { remember(resource); if (resource.metadata) {
            remember(resource.metadata); const m = read(resource.metadata.file); assert.equal(identity(resource), identity(m.entry));
            assert.equal(m.bytes, resource.bytes); if (format) assert.equal(m.format, format);
        } }
        return r;
    }
    return { inputs, remember, file, report };
}
function assetKey(assetPath) { const bytes = Buffer.from(assetPath, 'ascii'), padded = Buffer.alloc(((bytes.length >> 8) + 1) << 8); bytes.copy(padded);
    const digest = crypto.createHash('md5').update(padded).digest(); return { resource_key: digest.readBigUInt64LE().toString(), container: digest.readInt32LE(1).toString() }; }
module.exports = { read, hash, verify, identity, evidence, assetKey };
