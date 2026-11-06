const fs = require('node:fs');
const path = require('node:path');

// Legacy configuration is opt-in. Never discover config in the installed package
// or an adjacent checkout. Child extraction options override this legacy input.
const file = process.env.GENSHIN_DATA_CONFIG;
function readConfig() {
    if (!file) return {};
    try { return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')); }
    catch (error) { throw new Error(`Cannot read GENSHIN_DATA_CONFIG at ${file}: ${error.message}`, { cause: error }); }
}
module.exports = {
    ...readConfig(),
    ...(process.env.GENSHIN_DATA_RUNTIME_CONFIG ? JSON.parse(process.env.GENSHIN_DATA_RUNTIME_CONFIG) : {}),
};
