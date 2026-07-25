require('./global.js');

const xgroup = getExcel('MapLayerGroupExcelConfigData');
const xfloor = getExcel('MapLayerFloorExcelConfigData');
const xlayer = getExcel('MapLayerExcelConfigData');

const floor_keys = (() => {
	let ele = xfloor.find(ele => ele.id === 3270303);
	const language = getLanguage('CHS');
	return {
		name: Object.entries(ele).find(([key, value]) => language[value] == '赤王陵西北·未知区域三')[0],
		name_new: Object.entries(ele).find(([key, value]) => language[value] == '赤王陵西北·岩窟下层')[0],
		floor: Object.entries(ele).find(([key, value]) => value == -3)[0],
		group: Object.entries(ele).find(([key, value]) => value == 32703)[0],
	}
})();
const layer_keys = (() => {
	let ele = xlayer.find(ele => ele.id === 3700102);
	return {
		layer: Object.entries(ele).find(([key, value]) => value == 3700101)[0],
	}
})();

const corrected_map = {
	3380401: 3340107, // 优兰尼娅湖水下
	3440201: 3460601, // 烟山的山心
	3460601: 3440201, // 幻写画之地
	3481101: 3481102, // 传说壁画的洞窟
	3481102: 3481101, // 传说壁画的洞窟
	3490602: 3490603, // 烬火炽燃所其三·窟道
	3490603: 3490602, // 烬火炽燃所其三·古迹
}

function collateMapLayer(lang) {
	const language = getLanguage(lang);

	let group = {};

	let myfloor = xfloor.reduce((accum, floorObj) => {
		let data = {};
		data.id = floorObj.id;
		data.name = language[floorObj[floor_keys.name]];
		data.name_new = language[floorObj[floor_keys.name_new]] || null;
		data.floor = floorObj[floor_keys.floor];
		data.filename_images = [];

		group[data.id] = floorObj[floor_keys.group];

		if (!accum[floorObj[floor_keys.group]]) {
			accum[floorObj[floor_keys.group]] = {
				id: floorObj[floor_keys.group],
				name: String(floorObj[floor_keys.group]),
				layers: [],
			}
		}
		accum[floorObj[floor_keys.group]].layers.push(data);

		return accum;
	}, {});

	for (let layerObj of xlayer) {
		if (group[layerObj[layer_keys.layer]]) {
			const layer = myfloor[group[layerObj[layer_keys.layer]]].layers.find(layer => layer.id === layerObj[layer_keys.layer]);
			if (corrected_map[layerObj.id]) {
				layer.filename_images.push(`UI_Map_LayeredMap_${corrected_map[layerObj.id]}`);
				continue;
			}
			layer.filename_images.push(`UI_Map_LayeredMap_${layerObj.id}`);
		}
	}
	
	return myfloor;
}

module.exports = collateMapLayer;