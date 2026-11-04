const { putJSON, publish } = require('./storage');
const { compareVersions } = require('../versions/textmap');

// Reuse immutable payload blobs; only the version metadata changes.
function recalculateVersions(root, snapshot, hashVersions, plan) {
    const output = { ...snapshot.manifest().files };
    const dependencies = Object.keys(output).filter(key => key.startsWith('dependencies/') && key.endsWith('.json'));
    if (!dependencies.length && plan.folders.some(folder => folder !== 'interactions')) throw new Error('Snapshot lacks persisted TextMap dependencies; re-extract it');
    for (const file of dependencies) {
        const folder = file.slice('dependencies/'.length, -5), values = {};
        for (const [key, hashes] of Object.entries(snapshot.getAuxiliary('dependencies', folder))) {
            let earliest = '';
            for (const hash of hashes) {
                const version = hashVersions[hash];
                if (!version) throw new Error(`TextMap version missing for used hash ${hash}`);
                if (!earliest || compareVersions(version, earliest) < 0) earliest = version;
            }
            values[key] = earliest;
        }
        output[`version/${folder}.json`] = { hash: putJSON(root, values) };
    }
    return publish(root, output, plan, snapshot);
}
module.exports = { recalculateVersions };
