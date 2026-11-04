const fs = require('node:fs');
const path = require('node:path');

// Child extraction processes receive isolated paths; never edit an installed package's config.
const file = path.join(__dirname, 'config.json');
module.exports = {
    ...(fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}),
    ...(process.env.GENSHIN_DATA_RUNTIME_CONFIG ? JSON.parse(process.env.GENSHIN_DATA_RUNTIME_CONFIG) : {}),
};
