// Read-only, current-source calibration check. Does not require snapshot counts,
// resource caches or output exports. Pass a source directory as the first arg.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveMiliastraFields, resolveTcgPortraitField, resolveSereniteaLayoutField } = require('./fields');
const source = process.argv[2] || require('../../runtime-config').GenshinData_folder;
const read = relative => JSON.parse(fs.readFileSync(path.join(source, relative), 'utf8'), (key, value, context) =>
    typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value) ? context.source : value);
const tables = new Map();
const excel = name => {
    if (!tables.has(name)) tables.set(name, read(`ExcelBinOutput/${name}.json`));
    return tables.get(name);
};
const fields = resolveMiliastraFields(excel);
const roles = {
    BeyondCostumeExcelConfigData: ['costume_icon', 'body_types.costume', 'colors.costume', 'quality.costume', 'slot_groups', 'slots', 'costume_variant_group', 'costume_source'],
    BeyondCostumeSuitExcelConfigData: ['body_types.suit', 'colors.suit', 'quality.suit', 'suit_extra_image', 'suit_variant_group', 'suit_source'],
    BeyondCostumeDrawingExcelConfigData: ['catalog_id', 'catalog_targets', 'quality.catalog'],
    BeyondHallExcelConfigData: ['hall_id', 'hall_name', 'hall_description', 'hall_archive', 'hall_image', 'hall_preview'],
    BeyondCostumeUISlotEntryExcelConfigData: ['slot_category'],
    BydCostumeColorTagExcelConfigData: ['color_tag', 'color_name'],
};
const keyFor = (fields, role) => role.split('.').reduce((value, part) => value[part], fields);
function rename(value, keys) {
    if (Array.isArray(value)) return value.map(value => rename(value, keys));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, value]) => [keys[key] || key, rename(value, keys)]));
}
const renamed = new Map();
const renames = new Map();
for (const [table, names] of Object.entries(roles)) {
    const keys = Object.fromEntries(names.map((role, i) => [keyFor(fields, role), `${table}_arbitrary_${i}`]));
    renamed.set(table, rename(excel(table), keys));
    renames.set(table, keys);
}
const changed = resolveMiliastraFields(name => renamed.get(name));
for (const [table, names] of Object.entries(roles)) {
    for (const role of names) assert.equal(keyFor(changed, role), renames.get(table)[keyFor(fields, role)], role);
    // Reversing only the inferred keys must exactly reproduce every source row.
    const inverse = Object.fromEntries(Object.entries(renames.get(table)).map(([a, b]) => [b, a]));
    assert.deepEqual(rename(renamed.get(table), inverse), excel(table), table);
}
const icons = excel('GCGTalkDetailIconExcelConfigData');
const portrait = resolveTcgPortraitField(icons);
const changedIcons = rename(icons, { [portrait]: 'arbitraryCircleKey' });
assert.equal(resolveTcgPortraitField(changedIcons), 'arbitraryCircleKey');
assert(icons.every(row => /^UI_[A-Za-z0-9_]+$/.test(row[portrait])), 'all circular portraits use exact source resource names');
const bin = relative => read(`BinOutput/${relative}`);
const layout = resolveSereniteaLayoutField(bin);
assert.equal(resolveSereniteaLayoutField(relative => rename(bin(relative), { [layout]: 'arbitraryLayoutKey' })), 'arbitraryLayoutKey');
let components = 0;
const suites = excel('FurnitureSuiteExcelConfigData');
for (const suite of suites) {
    const value = bin(`HomeworldFurnitureSuit/${suite.jsonName}.json`);
    assert(Array.isArray(value[layout]), suite.jsonName);
    assert(value[layout].every(unit => Number.isSafeInteger(unit.furnitureID)), suite.jsonName);
    components += value[layout].length;
}
console.log(JSON.stringify({ miliastra_fields: Object.values(roles).flat().length,
    tables: Object.fromEntries([...tables].map(([name, rows]) => [name, rows.length])),
    circular_portraits: icons.length, suites: suites.length, components,
    arbitrary_renaming: 'passed', writes: 0 }));
