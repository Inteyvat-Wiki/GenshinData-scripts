const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { evidence } = require('./map-evidence');
const { parseIndex } = require('./miliastra');

// Containers from an older inventory are discovery hints. Callers still resolve
// every dependency by its current serialized CAB and exact Int64 PathID.
function referenceIndex(indexReportFile, blockRoots) {
    const proof = evidence(), report = proof.report(indexReportFile, 'payload');
    assert.equal(report.resources.length, 1);
    const bytes = fs.readFileSync(report.resources[0].file);
    assert(Array.isArray(blockRoots) && blockRoots.length);
    const files = new Map();
    for (const root of blockRoots) {
        for (const shard of fs.readdirSync(root, { withFileTypes: true }).filter(item => item.isDirectory())) {
            for (const filename of fs.readdirSync(path.join(root, shard.name)).filter(name => /^\d+\.blk$/.test(name))) {
                const id = Number(path.basename(filename, '.blk'));
                if (!files.has(id)) files.set(id, path.join(root, shard.name, filename));
            }
        }
    }
    function packs(entries) {
        const containers = new Set(entries.map(entry => entry.Container).filter(value => /^-?\d+$/.test(value)));
        const matched = new Set();
        const hits = parseIndex(bytes, {
            has(key) {
                const container = BigInt.asIntN(32, BigInt(key) >> 8n).toString();
                if (!containers.has(container)) return false;
                matched.add(key); return true;
            },
            [Symbol.iterator]() { return matched.values(); },
        });
        return [...hits.values()].map(hit => {
            const source = files.get(hit.pack.block);
            assert(source, `Missing active resource block ${hit.pack.block}`);
            return { ...hit, Source: source, Offset: hit.pack.offset };
        });
    }
    return { inputs: [...proof.inputs.values()], sources: entries => [...new Set(packs(entries).map(hit => hit.Source))] };
}
module.exports = { referenceIndex };
