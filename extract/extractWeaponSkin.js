require('./global.js');
const { resolveField, resolveCardIcon } = require('./cosmetics');

const xskin = getExcel('AvatarWeaponSkinExcelConfigData');
const xgroup = getExcel('AvatarWeaponSkinGroupExcelConfigData');
const materials = new Map(getExcel('MaterialExcelConfigData').map(row => [row.id, row]));
const sample = xskin.find(row => row.itemId === 341801);
// Material 341801 explicitly grants skin 380001 via ITEM_USE_ADD_WEAPON_SKIN.
const witnessId = Number(materials.get(341801)?.itemUse.find(row => row.useOp === 'ITEM_USE_ADD_WEAPON_SKIN')?.useParam[0]);
if (!Number.isSafeInteger(witnessId) || witnessId <= 0) throw new Error('Missing weapon skin ID witness');
const idField = resolveField('id', sample, witnessId);
const cardField = resolveField('cardIconPath', sample, 'UI_EquipIcon_Catalyst_Kristall_Card');
const skinIds = new Set(xskin.map(row => row[idField]));
if (skinIds.size !== xskin.length || [...skinIds].some(id => !Number.isSafeInteger(id) || id <= 0))
	throw new Error('Invalid or duplicate weapon skin IDs');

const groupsBySkin = new Map();
for (const group of xgroup) {
	// The other numeric skin field is not this group ID. Membership is explicit
	// in AvatarWeaponSkinGroup (including distinct normal/sublimation groups).
	const lists = Object.values(group).filter(value => Array.isArray(value) && value.length);
	if (lists.length !== 1 || lists[0].some(id => !skinIds.has(id)))
		throw new Error(`Invalid weapon skin group members: ${group.groupId}`);
	for (const id of lists[0]) {
		if (!groupsBySkin.has(id)) groupsBySkin.set(id, []);
		groupsBySkin.get(id).push(group);
	}
}

function collateWeaponSkin(lang) {
	const language = getLanguage(lang);
	return xskin.reduce((accum, obj) => {
		const material = materials.get(obj.itemId);
		if (!material) throw new Error(`Missing weapon skin material: ${obj.itemId}`);
		const data = {
			id: obj[idField],
			itemId: obj.itemId,
			name: language[obj.nameTextMapHash] || '',
			descriptionRaw: replaceNewline(language[obj.descTextMapHash] || ''),
			weaponType: obj.weaponType,
			rarity: obj.quality,
			source: getMatSourceText(obj.itemId, language),
			groups: (groupsBySkin.get(obj[idField]) || []).map(group => ({ id: group.groupId, name: language[group.nameTextMapHash] || '' })),
		};
		data.description = sanitizeDescription(data.descriptionRaw);
		// Material.icon is concrete even when iconPath is an element-colour template.
		data.filename_icon = material.icon;
		data.filename_gacha = obj.imagePath;
		data.filename_card = resolveCardIcon(obj[cardField], obj.iconPath, material.icon);
		const filename = makeUniqueFileName(obj.nameTextMapHash, accum) || String(data.id);
		accum[filename] = data;
		return accum;
	}, {});
}

module.exports = collateWeaponSkin;
