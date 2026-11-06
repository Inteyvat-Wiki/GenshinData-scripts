// Importing the provider is read-only. Extraction is explicit through prepare().
module.exports = require('./cache/provider');
Object.defineProperty(module.exports, 'resources', { enumerable: true, get: () => require('./resources') });
