const { resolveField, resolveRow } = require('./field-inference');

function resolveDocumentField(documents) {
    if (!documents.length) return undefined;
    // Document 100110 (Poem1) points to Localization 200001. Other lists in
    // Document may also contain localization IDs (quest-specific/extra pages),
    // so resolve once against this known record, never guess per document.
    const row = resolveRow(documents, 'Document:100110', row => row.id === 100110);
    return resolveField('Document.localizations', [{ row, value: [200001] }]);
}

function localizationIds(document, key) {
    if (!document) return [];
    if (!key) throw new Error(`Missing Document field calibration: ${document.id}`);
    const ids = document[key] ?? [];
    if (!Array.isArray(ids) || ids.some(id => !Number.isSafeInteger(id) || id <= 0))
        throw new Error(`Invalid Document localization references: ${document.id}`);
    return ids;
}

function readablePath(localization, lang) {
    const paths = [...new Set(Object.values(localization || {})
        .filter(value => typeof value === 'string' && value.replaceAll('\\', '/').includes(`/Readable/${lang}/`))
        .map(value => value.replaceAll('\\', '/')))];
    // Two source properties may carry the exact same Chinese path. They are
    // equivalent for reading text; different paths must not be guessed between.
    if (paths.length > 1) throw new Error(`Ambiguous readable path: ${localization.id}/${lang}`);
    return paths[0] || '';
}

function createReadableReader(documents, localizations, read) {
    const key = resolveDocumentField(documents);
    const localizationById = new Map(localizations.map(row => [row.id, row]));
    return (document, lang) => {
        const ids = localizationIds(document, key);
        const paths = ids.map(id => readablePath(localizationById.get(id), lang)).filter(Boolean);
        const content = paths.map(path => read(path.split('/').pop().replace(/\.txt$/i, ''), lang)).filter(Boolean);
        return { localizationIds: ids, readablePaths: paths, content };
    };
}

module.exports = { resolveDocumentField, localizationIds, readablePath, createReadableReader };
