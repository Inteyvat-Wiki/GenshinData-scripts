// Resolve game references only; publication choices belong to consumers.
const { resolveField: inferField } = require('./field-inference');
const { createReadableReader } = require('./readable');
function resolveField(name, sample, value) {
	return inferField(`cosmetics.${name}`, [{ row: sample, value }]);
}

function createStoryReader(documents, localizations, read) {
	const documentById = new Map(documents.map(row => [row.id, row]));
	const readable = createReadableReader(documents, localizations, read);
	return (itemId, lang) => {
		const document = documentById.get(itemId);
		if (!document) return '';
		return readable(document, lang).content.join('\n\n');
	};
}

// Only substitute an icon template when its value is witnessed in Material.icon.
// Do not assume an element, or emit an unresolved template as a downloadable image.
function resolveCardIcon(template, iconTemplate, materialIcon) {
	if (!template) return undefined;
	if (!template.includes('{')) return template;
	if (!iconTemplate || typeof materialIcon !== 'string') return undefined;
	const parts = iconTemplate.split('{0}');
	if (parts.length !== 2 || parts.some(part => /[{}]/.test(part))) return undefined;
	const [start, end] = parts;
	if (!materialIcon.startsWith(start) || !materialIcon.endsWith(end)) return undefined;
	const variant = materialIcon.slice(start.length, end ? -end.length : undefined);
	if (!variant || /[{}]/.test(variant)) return undefined;
	const result = template.replaceAll('{0}', variant);
	return /[{}]/.test(result) ? undefined : result;
}

module.exports = { resolveField, createStoryReader, resolveCardIcon };
