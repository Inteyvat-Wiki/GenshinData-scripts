# 地图解析与可核验范围

2026-11-03 分层图任务写入：`extract/maps/layer-state.js` 将 `QUEST_EXEC_SET_MAP_LAYER_UNLOCK_STATE` 的目标关系与 0/1 状态转换为 `data.layer_state_change`（`profile:map-layer-unlock-v1`、`unlocked`、`execution_order`）。保留完成/失败分支及批量图层目标；执行序号只在上游解释，不要求下游拆原始事件 ID。未知参数拒绝转换。任务写入不证明图层的初始状态，也不证明所有玩家解锁行为都来自任务。

核验例：`7502015` 完成开启 `3460403` 并关闭 `3460402`；`7502016` 完成开启 `3460404` 并关闭 `3460403`；`7502001/7502012` 完成开启 `3460408` 并关闭 `3460406`；`7502013` 完成和失败均开启 `3460407` 并关闭 `3460404`。图像沿原生控制器引用、layer 和 floor 关系定位，不按相似文件名配对。当前 Lua 缓存 29,564 个块的常量扫描未找到 `3460401–3460408` 或 `MapLayer` 调用；它不能排除原生代码、其他运行时入口或尚未收集的配置，故不补造初始布尔值。

生产补充快照 `.cache/maps-native-export-20261102` 的 `5ab367e77a3125347114d29ccf0c7f6ccba37cc29cfd70752df0f24f571a4bd9` 基于已核验 7.1 输入，仅补充中英文共 390 条事件的规范化语义，其他记录沿用原快照；核验清单 `.cache/maps-layer-state-20261103/task-writes.json`。

地图游戏语义集中在 `extract/maps/catalogue.js`，`extract/extractMaps.js` 是快照提取入口。`maps` 与既有 `maplayers` 是不同查询目录：前者维护完整证据记录，后者暂时兼容现有地图显示数据。旧地图工具和手工坐标没有作为新解析器的输入。

```js
const source = require('genshindata-scripts');
const snapshot = await source.prepare({
    sourceRoot: 'D:/genshin data',
    cacheRoot: 'D:/GenshinData-scripts/.cache/map-data',
    folders: ['maps', 'maplayers'],
    languages: ['CHS', 'EN'],
    resourceCaches: {
        worldAreas: 'D:/work/world-areas/world-areas.json', // 必需：客户端地区范围
        maps: 'D:/work/map-resources.json', // 可选：Unity 地图图像及布局
    },
});
const floor = snapshot.getRecord('English', 'maps', 'floor-3270303');
```

命令行接受 `--map-resources FILE`，环境变量为 `MAP_RESOURCE_CACHE`。Unity 图像清单仍为可选；地区范围缓存通过 `--world-area-resources FILE` / `MAP_WORLD_AREA_RESOURCE_CACHE` 指定，现为必需输入。缺失或不匹配时停止，不回退到社区 WorldArea JSON。准备快照不会自动运行 AnimeStudio、提取全量图片或猜测缺失资源。资源清单及其声明输入的内容身份纳入快照失效校验。`versions:false` 只用于独立验证，不把提交时间或无历史输出当成内容上线版本。

2026-11-02：一级、二级地区范围全部迁移至客户端 MiHoYoBinData。`resources/world-areas.js` 负责路径索引及核验提取，`extract/maps/world-area-binary.js` 解码字段；`catalogue.js` 按 `sceneID + level + id1 + id2` 精确关联表记录，保存各段轮廓的客户端源键、块、Offset、PathID、载荷哈希和解析器标识。名称、层级和父关联继续来自原始表。高度缺失仍不补值，`roadPoints.y` 不当作范围高度。13 个被地区表引用的客户端场景覆盖 90 个一级、474 个二级地区，共 570 段轮廓；其余 14 个二级地区仍保留为空范围。该范围与可进入世界红色边界、地图图片遮罩无关。

本次生产资源缓存为 `.cache/world-areas-client-20261102/world-areas.json`，默认 `.cache/world-areas.json` 指向同一组已核验载荷。完整快照位于 `.cache/maps-client-areas-20261102`，ID 为 `e38d95a03b49ea38d48ee08d7947cfb439f24cbd8df6c23412d043727726e1f7`；比较报告为同目录 `verification.json`。中英文各新增 147 个有范围地区，旧的 421 段轮廓中 418 段坐标完全一致，果酒湖、明冠山地、明冠峡的 3 段按客户端更新；非区域记录及地区原文、层级关联保持一致。解析器目前只接受已核验的客户端块和 `gi-world-area-cn-7.1-v1` 布局，客户端更新后必须重新核验配置身份及解码规则，禁止沿用旧缓存或回退社区范围。地图 60 项、缓存 10 项及 genshin-db 地图 2 项测试通过。

## 记录与边界

记录采用 `schema:1`，含稳定 `id`、`kind`、原始 `name/description/texts`、显式关系 `relations`、每类业务字段 `data`、来源 `source` 和诊断 `diagnostics`。数据不转义、不替换中文为猜测译文、不生成缺失原文。没有名字时保留空串，由展示层明确决定占位名称。

| kind | 输入及初步解析 |
| --- | --- |
| scene | SceneExcelConfigData：场景类型、脚本、世界/图片场景关联，原始开发名称 |
| world_area | WorldAreaConfigData + 客户端 WorldArea 缓存：区域层级、名字、神像点及定位多边形 |
| map_area | MapAreaConfigData + Map/MapArea/ConfigMapArea：区域状态、资源路径、隐藏点清单、格位置 |
| layer_group / floor / layer | 三张 MapLayer 表：层组、楼层、图片层关联，名字变化条件，已验证少量图片 ID 特判 |
| label | PlaceNameConfigData：地点文字切换及原始条件参数 |
| map_tag / map_icon | MapTagDataConfigData、Global/Mark/ConfigMarkGlobal、ManualTextMapConfigData：标签和图标原始标题、描述、显示参数 |
| point / point_collection | Scene/Point：场景点、原始坐标、图层/区域/秘境关系；非标准空集合明确保留 |
| level_tag / scene_tag | LevelTag、LevelTagMapArea、SceneTag：增加/移除标签、区域资源索引、静态条件 |
| limit_region / open_state | LimitRegion、OpenState：范围类别、开放条件；仅两个已验证符号映射为数字 ID |
| map_settings | Mark/MapGlobal：地图与小地图缩放等展示参数 |
| quest_event | BinOutput/Quest：完成/失败阶段的 18 类地图相关执行动作、目标关系及源步骤条件证据 |
| boundary_geometry | SimplePolygons 中当前 LimitRegion 没有精确引用的历史开放范围，绝不自动作为当前边界 |
| layer_region | MultilayerMapRegion：图层激活体积、形状、位置及三维旋转；不是可进入边界 |
| viewpoint | ViewCodex：原始标题、说明、场景/区域/场景组/实例配置 ID，复用 geographies 正文 |
| npc_instance | SceneNpcBorn / SceneNpcBornNoGroup：NPC 实例位置、旋转、场景组、suite、条件，复用 npcs 正文 |
| ability_map | Ability：ShowMapBackMixin、活动地图标记及完整可追踪的 modifier/global-value 选择链 |
| map_trigger | InterAction 场景标签动作、Talk OpenState 动作、CustomGadgetSlotLevelTag 对应关系 |
| map_place | 可选资源清单中的 MonoLocalizedText 原生标签，经 ManualTextMap 取得中英文原文及原生布局 |
| resource | 可选资源清单：原生 Unity 对象、精确引用、图片组件颜色、预制体坐标与材质证据；atlas-image 含真实控制器关联及已提取 PNG |

`WorldArea` 多边形是区域定位元数据，不能当成实际可进入范围或半透明红色边界。`boundaryPointVec` 以 `boundary_values` 保留，尚未给四个数猜配轴向。Group 的引用楼层不标注为默认楼层。地图覆盖状态、点解锁、标签变化、任务动作相互关联，但没有合成为未经验证的完整显示谓词。

`layer_region.polygons` 保留原生 `regionPolygons`，`footprints` 另提供世界 xz 投影及高度范围：盒体完整尺寸的一半为中心到面的距离，旋转盒使用全部八角点投影的凸包，球和竖直圆柱保留精确圆及半径。Unity 旋转采用 Z、X、Y 外旋顺序，正 Y 的 90° 将正 Z 转到正 X，参见 [Unity 旋转文档](https://docs.unity3d.com/cn/2023.1/Manual/QuaternionAndEulerRotationsInUnity.html)。源配置的独立 `minArea/maxArea` 用于复核尺寸、中心和三维旋转：119 个配置中 117 个完整匹配，最大容差 0.005；另外 2 个含未知形状或空多边形，标为 partial。共 986 个可显示 footprint；12 个 `ACOLPJIAONA` 形状与 3340108 的空多边形保留未解析诊断，不能当成零尺寸或套圆柱公式。此范围用于图层对照，仍不是可进入边界。

场景点两个重要命名空间已全量验证：`EABBCMGNLEL` 属于 `areaID2`，通过 `sceneID + areaID1 + areaID2` 匹配唯一 `WorldArea.id`；`IOAKKHJPFEI` 指向 `MapLayer.id`，再由层表关联 `MapLayerFloor.id`。缺失和歧义保留诊断，不选择第一条候选。

### 地点名称、说明和图标

2026-11-01 后续补充位于 `extract/maps/point-details.js`。普通传送点取得 `MarkTransPoint` 的通用原文；`WorldArea.sceneID+towerPointId` 确认的神像，沿 `areaID1 → CityConfigData.areaIdVec` 唯一关联 `cityGoddnessNameTextMapHash/cityGoddnessDescTextMapHash`。`InCityData` 是此来源指示，不作为 ManualTextMap 键查找。点自身的文字优先；城市原文缺译仍保持缺失。实际例子 `point-3-4 → WorldArea 1200 → City 1 → 272562616/3971725780` 为“七天神像-风”及其说明；`point-3-5 → MarkTransPoint → 3495190929/3489192193` 为“传送锚点”及通用说明。

`NPFLMLBMDLL` 对应历史具名的 `dungeonEntryType`，以历史 `cbe446c9e60` 与当前场景 3 的点 45/48 的位置、物件编号和类型值核对。入口表的 `DUNGEON_ENTRY_TYPE_TRIAL` 是当前 13 个征讨领域入口（例如 `point-3-38 → DungeonEntry 1006`），不是角色试用；`DUNGEON_ENTRY_TYPE_OBSCURAE` 对应 `point-3-45` 深境螺旋。这两类及每日秘境可按已关联类别选择参考图标。

新增 `icon_source:category-preview` 明确表示类别参考图标；不是已经还原的运行时状态选择。`locked_map_icon/unexplored_map_icon` 分别保留配置变体，PNG 按关系复用。锚点锁定与解锁可共用 PNG 而通过 `materialIndex:1` 区分，未模拟该材质。带 `subtype` 的特殊传送点不套用普通锚点资料：当前 `MOONTOWER` 有 9 个点，例如 `point-102-9/23`；同样，未被 WorldArea 神像引用确认的 `type:TOWER` 室内传送点也不作为神像。静态名称、图标引用和玩家状态分别保留。

### 地点出现条件与常驻／限时证据

2026-11-02 大地图展示筛选：`point-details.js` 的 `pointMapDisplay` 为全部地点生成 `data.map_display.status/reason`。仅两种证据得到 `excluded`：地点自身明确 `mapVisibility:Never`，或经 `markIconTypeName`／`sceneBuildingMarks` 明确关联的标记配置为 `visibilityOnMap:Invisible`。类别参考图标不用于排除；缺少名称、说明、图片、默认可见性、场景类型、模型隐藏及交互开关均不是排除依据。`OnUnlocked` 得到 `conditional`，其余为 `unresolved`，不宣称始终显示。原始记录、任务关联及标记的小地图规则完整保留。

当前 4,925 个点中，341 个由点自身规则排除，8 个由明确标记规则排除，145 个属于解锁条件，其余 4,431 个尚不能排除。8 个标记规则实例为场景 3 的 `63/160/423/726/1040/1383/1686/2170`，路径为 `buildingType:GeneralCargo → sceneBuildingMarks.GeneralCargo:MarkGeneralCargo → visibilityOnMap:Invisible`；`visibilityOnRadar:Around` 独立保留，不能写成大小地图均不显示。全部 349 个排除点与当前任务的 `UNHIDE_SCENE_POINT` 目标无交集；这不表示已经模拟全部客户端脚本。核验清单位于 `.cache/maps-display-filter-20261102/classification.json`。

当前接入的条件资料分成四条独立路径，不能把任一条直接当作完整出现条件：

- 点的 `mapVisibility` 保留 `Never/OnUnlocked` 等原始含义；缺省不补为始终显示。`unlocked` 与“常驻”没有等价关系。
- `quest_control` 反向指向实际针对该点执行的任务动作，保留锁定、解锁、隐藏、取消隐藏及发生阶段。例如 `point-3-1662 → quest-event-4021128-finish-0` 是步骤 4021128 完成时 `LOCK_POINT(3,1662)`；源步骤的完成条件是离开场景 20282。这是一次状态写入，不是“任务未完成时地点始终显示”的逆向推论。
- `map_area_control` 反向指向 `ConfigMapArea.hideScenePointList` 的区域记录；区域是否激活及状态切换继续使用原有资料，不猜测组合逻辑。
- `entry_access` 来自精确匹配的秘境入口 `satisfiedCond/condComb/isDefaultOpen`。例如 `point-3-50 → DungeonEntry 2` 保存等阶条件 10、任务条件 35802 与 `LOGIC_OR`。这些是入口使用条件，不自动改变地图标记可见性。

`presence` 目前只输出 `classification:activity-associated|unresolved`，`lifetime` 固定为 `unresolved`。其中活动关联来源为入口明确的 `DUNGEON_ENTRY_TYPE_ACTIVITY`，或 `point.dungeonIds ∩ NewActivityExcelConfigData.dungeonIdList` 的非空交集。交集逐个保留关卡 ID；活动原名来自其 `nameTextMapHash`。`NewActivityEntryConfigData.id + activityType` 一致时另保留 `configured_duration`，但不拿活动入口界面时长推算地点本身的有效日期、时区或关闭动作。

真实例子：`point-10-16 → dungeonIds 9301–9304 → NewActivity 2023`，活动原名“清夏！乐园？大秘境！”，活动入口配置 `duration:43`；`point-3-1662 → dungeonId 1260 → NewActivity 2043`，原名“参究故墟·稳健知行”，`duration:17`。后者同时有上述任务锁点动作和 `mapVisibility:Never`，可见活动关联、入口状态及地图标记可见性确实是不同维度。未关联活动的点不因此标为常驻。

其他已检查但尚未合成为地点期限的线索：`SceneTagConfigData.cond` 有指定活动开启、活动内容开启、任务全局变量和任务完成四类；`ClientSceneTagConfigData.sceneTagExpression` 有组合表达式，例如 ID 1001 排除多个节庆标签。`NewActivityCondExcelConfigData` 当前有 130 类非空条件，含活动天数上下限、任务、阶段、玩法完成、等阶等；其中 `condId:2005052` 的 `UNLOCKED_ALL_LISTED_SCENE_POINTS(4,8,9,10)` 是活动条件依赖地点解锁，不能反过来当作这些点的出现条件。上述标签／活动需要再关联到具体实例加载、标记控制和时间基准，才能证明某地点只在活动期间存在。当前没有据此断言缺口属于服务端，也没有把提交时间当作活动日期。

最终验证快照 `cf828713c56e68272aa396589b17c1698195331ca84aaefd9652ff3348da7cde` 位于 `.cache/maps-point-details-20261101-final`，相对上一地点补充快照：简中新补 907 个地点名称、909 段说明，英文新补 896 个名称、898 段说明。当前 82 个神像点均唯一关联城市配置；1,645 个地点可使用核验 PNG。37 个点有活动关联证据，其中 24 个可沿共用关卡关联到活动原名；456 个点有针对它的任务状态操作，21 个点有区域隐藏配置，38 个入口有非空使用条件。这些类别可以重叠，不作为地点数相加。

图标资源清单 `.cache/map-icons-points-20261101/map-icons-verified.json` 覆盖 111 个引用名中的 109 个 PNG，保留此前两项旧活动资源缺口。更新类型引用时先重新解析引用清单；资源名集合相同后复用原始对象和图片提取报告重新校验，不修改旧清单来伪装来源。解析与资源测试 53 项通过；查询接口测试 2 项通过。版本推断在该独立验证快照中关闭。

地点正文继续优先保留 `Scene/Point/scene{scene}_point.json` 的 `titleTextID/descTextID → ManualTextMapConfigData.textMapId → textMapContentTextMapHash → TextMap + TextMap_Medium`。两种文本文件须合并读取；许多地图说明位于 `TextMap_Medium`。原始文本 ID 保存在 `data.title_text_id/description_text_id`，实际文本哈希保存在 `texts` 与 `source.hashes`。若直接文本 ID 存在但该语言原文缺失，保持缺失和诊断，不用其他文案代替未提供的翻译。

另有两条已验证的地点图标引用：

- 建筑点的 `buildingType → BinOutput/Global/Mark/ConfigMarkGlobal.json.sceneBuildingMarks[buildingType] → markIconConfig`。
- 虚拟传送等点直接提供的 `markIconTypeName → markIconConfig`。

两条路径均以显式字典键为准，不根据资源名相似度匹配。`data.building_type` 保留建筑类型，`data.map_icon_id` 是原始 mark key（例如 `MarkAlchemy`），`map_icon` 关系才指向完整目录 ID（例如 `map-icon-MarkAlchemy`）。`data.icon` 是关联定义的原始 `iconName`，仅表示可靠资源引用；PNG 提取及来源校验仍由资源链路完成。没有点自身文本引用时，从关联图标的 `title/desc` 取得原文；`data.name_source/description_source` 显式标记 `point`、`map_icon` 或 `dungeon_entry`。图标记录也保留 `title_text_id/description_text_id`，可以沿关系复核完整 ManualText 路径。两条图标路径冲突时拒绝择一，建筑映射缺失时也不自行构造 `Mark{buildingType}`。

真实示例均来自当前输入：

| 点记录 | 显式引用 | 名称 / 描述哈希 | 图标 |
| --- | --- | --- | --- |
| `point-3-201` | `buildingType:Alchemy → sceneBuildingMarks.Alchemy:MarkAlchemy` | `1336186061`（炼金 / Alchemy） / `2094860333` | `UI_MarkPoint_Combine` |
| `point-3-54` | `buildingType:Knights → MarkKnights` | `2558532677`（西风骑士团 / Knights of Favonius） / `31459557` | `UI_MarkPoint_Knights` |
| `point-3-55` | `buildingType:Church → MarkChurch` | `4125182298`（西风大教堂 / Favonius Cathedral） / `2227244338` | `UI_MarkPoint_Church` |
| `point-3-56` | `buildingType:Pub → MarkPub` | `2268549335`（天使的馈赠 / Angel's Share） / `2686215559` | `UI_MarkPoint_Pub` |
| `point-3-1468` | `markIconTypeName:MarkNTBallon01` | `1774358799`（悬浮小屋 / Floating Hut） / `1733574927` | `UI_MarkPoint_NatlanWq_Balloon` |

秘境说明使用 `DungeonEntryExcelConfigData.sceneId + dungeonEntryId` 精确关联场景点，再读取 `descTextMapHash`。例如 `point-3-48` 对应入口表 `id:1`，`descTextMapHash:1612886129` 是仲夏庭园的说明；`point-9-48` 对应 `id:1046`、哈希 `2432468097`，是金苹果群岛活动空间的另一段说明，不能只按 `48` 合并。`data.dungeon_entry_id` 保留入口表 ID。现有 `dungeons` 查询使用的是入口点 ID，点的 `dungeonIds` 却是秘境关卡 ID，故只在入口点 ID 全局唯一时建立 `dungeon → dungeons` 复用关系；跨场景的 `48/50/52` 暂不建立此查询关系，并保留 `ambiguous_dungeon_query_id`。原始关卡 ID 仍完整保存在 `data.dungeon_ids`，不伪装成入口查询 ID。

2026-11-02 为完整复用秘境页面，`extractDungeon.js` 在 `dungeons` 记录中新增 `entryId`（入口配置表的唯一 `id`）和 `sceneId`，保留旧 `id = dungeonEntryId` 的查询兼容性。地图的 `data.dungeon_entry_id` 已由场景与地点的精确关联取得，可与新增 `entryId` 对接，并用 `scene_id / point_id` 复核 `sceneId / id`。这条路径不依赖旧的全局唯一点号关系，也不使用文本同名推断。例：`point-3-50 → entryId 2 / sceneId 3 / id 50` 对应塞西莉亚苗圃；`point-9-50 → entryId 1047 / sceneId 9 / id 50` 是独立活动入口。仲夏庭园同理使用 `point-3-48 → entryId 1`，与活动入口 `entryId 1046` 分开。旧 `ambiguous_dungeon_query_id` 只描述旧编号查询的歧义，不再意味着无法通过入口身份链接。

2026-11-01 完整快照 `e91140a7b12f4f65eb0583a0abff1b3a8385c9bf17be533566d8f4beed2a5051` 与此前快照逐条比较：两种语言均新增 211 个点的名称和 303 段说明，其中 99 段新增说明来自秘境入口配置。301 个点有非空图标引用，其中 299 个接入已核验 PNG。310 个建筑点中 255 个有显式映射；其余 55 个没有 `sceneBuildingMarks` 条目，记录 `missing_building_mark`，另有 27 个点引用了当前未找到的 mark 定义，不据此断言原生资源中缺失。`Default` 或空 `iconName` 不被包装成可显示图标。锚点、神像及秘境不同锁定状态的客户端图标选择规则尚未在这两条显式路径中证明，不能把相似 mark 名称当成完整关联规则。

地点图标的资源入口为 `resources/map-icons.js`：向 `prepare({ sourceRoot, studio, map, output })` 提供游戏数据目录、AnimeStudio 目录、明确版本的 `.map` 和新的输出目录，也可将这些参数写入 JSON 后运行 `node resources/map-icons.js PLAN.json`。它从已解析地点的明确关系收集需要的图标名，只对精确且唯一的 Sprite/Texture2D 条目提取。原生序列化对象确认 CAB 后再核对导出 PNG 的来源，不把图片 XML 中未约束的 Offset 当成已验证。源点配置、解析器、资源映射、提取报告、原生对象和 PNG 都纳入输入身份校验。

将输出 `map-icons.json` 通过 `resourceCaches.mapIcons`、`MAP_ICON_RESOURCE_CACHE` 或 `--map-icon-resources` 传给缓存准备入口，与 `resourceCaches.maps` 的地图布局资源相互独立。图片元数据只附到 `map_icon.data.image_file/image_sha256/image_width/image_height`；地点沿既有关系复用，不复制 PNG。当前核验缓存 `.cache/map-icons-7.1-20261101/map-icons-final.json` 提取了 104 个非空引用名中的 102 个；两项旧活动名 `UI_MarkPoint_IslandParty`、`UI_MarkPoint_MichiaeMatsuri` 在指定 7.1 映射中未找到，保留 `map_icon_image_unresolved`。没有配置此可选缓存时，名称、说明和资源名关联仍可正常解析。

`ConfigMapArea` 通过外层键关联表 ID，不能使用重复的内部 `id`。例如外键 18 和 20 的内部 `id` 都为 1，仍是两份不同记录。原始缺省字段仍保留为未提供；已核实的运行默认值放入独立的解释字段，不回填原始字段。

2026-11-03：`extract/maps/state-semantics.js` 增加 `map-area-bool-v1` 解释。历史客户端枚举明确 `MistClose=0 / MistOpen=1`，历史 3.4 服务端构造器默认 MistClose，登录仅初始化没有存档值的区域，任务第二参数按非零为真直接覆盖持久状态。区域的 `state_model` 分开记录初始 bool、显式配置或构造器默认的来源、普通／LevelTag／侵蚀模式；事件的 `area_state_change` 保存 bool 和动作数组序号。普通替换图开启对应显示的方向由区域 40～43 的实际图片及巨像移动任务交叉印证，仍标为渲染推断，不能推及全部控制器。证据和来源哈希保存在 `.cache/map-state-semantics-20261103`。

`node cache/enrich-map-states.js CACHE_ROOT SNAPSHOT_ID` 可为固定旧快照补充上述解释，保留非地图正文及旧快照；无需混入新版任务或重新提取图片。它只接受当前快照并使用准备锁。旧事件的执行序号由上游自身维护的事件键恢复，wiki-data 和 Wiki 不解析这些原始 ID。缺省 LevelTag 图像索引仍未补 0。

覆盖图通过 `ConfigMapArea.prefabPath` 精确根名关联地图区域，通过真实 `MonoMapArea.areaTransforms[index]` 指针及图片祖先链得到 `resource.data.area_variants`。例如 `Map_DreamIsland_Grp_400` 的 `UI_Map_DreamIsland_LT8` 位于控制器索引 3，对应 `LevelTagMapAreaConfigData(mapAreaID=30,index=3,levelTagID=8)`；这一关系标为 `level_tag`。同 prefab 的其他标签只标为 `level_tag_context`，不冒充该图片的选择条件。索引 0 的图片存在，而源表部分对应项省略 index，这些缺省仍保留未验证诊断。资源名匹配到 Ability.prefabName 时另给 `ability_control`，不能凭相似图片名关联。

任务动作的参数按动作分别解析：地图区域、层、层组等使用第一参数；点与 SceneTag 使用第一参数的场景和第二参数的目标。`SET_ABYSS_WAR_LIMIT_REGION_STATE`、批量 OpenState 等未完成目标空间验证的参数保留上游并标记未解释，不强行关联相同数字 ID。

原生资源坐标以 `layout` 原样保留为 `prefab-ui`，经过校准的图层另给 `display_geometry`（`world-xz`）。这是 Wiki 的显示坐标约定，不能把它称为游戏原生世界投影；未知场景不套用其他场景的变换。材质属性存在不等于已经重建完整渲染；只有验证过的 shader 字节匹配才标注相应柔边公式证据。

能力背景控制以 `activation.paths` 保存所有可追溯选择链。比如 OneLineShoot 的 Started 和 Level 两级选择必须同时保留；选择区间端点归属以及 ability/modifier 本身何时存在尚未证明，因此 `complete:false`，绝不把只有能力名称的动作变成无条件显示。循环选择链也不会被简化为无条件。

`quest_event.condition_evidence` 保存源步骤中 `QUEST_COND_*` / `QUEST_CONTENT_*` 条件的字段和参数；`state_dependencies` 只提取明确状态相等/不等引用。未知来源字段的阶段为 `unspecified`，未猜配条件间逻辑。任务完成时的状态写入并不等价于“该任务完成”这一永久显示谓词。交互和对话动作也只是状态写入证据。

当前资料中 89 个 LimitRegion 可按名字精确关联 SimplePolygons。示例 `limit-region-31017` → `GlobalOpenArea4_4_LXS` → `BinOutput/LevelDesign/SimplePolygons/GlobalOpenArea4_4_LXS.json`。当前 `limit-region-31028` 引用 `GlobalOpenArea7_0`，源数据目录虽无这个多边形，现已从原生同名 prefab 精确关联红色遮罩纹理与边缘网格，输出 `resource/category:native-boundary` 及 `native_boundary` 关系。该资源分别保留 mask 的普通透明混合、噪声采样和 rim 的网格 UV/加法混合；已有 4.6 多边形没有替代它。`geometry_status:native-mask-and-rim` 说明原生几何已找到，运行时开放状态、画布动画仍单独保留未验证诊断。

场景点类型用历史命名配置核验当前混淆类型：例如历史 `cbe446c9e60` 中相同场景/点 ID、gadget、位置与当前记录匹配，区分 DungeonEntry、SceneTransPoint、DungeonQuitPoint 等。`type:TOWER` 不是七天神像的充分条件，因为室内退出点也存在这个值；只有 `WorldArea.sceneID+towerPointId` 精确指向的点标为 `statue`。

观景点目前有 268 条原始资料，但其场景组位置尚未找到可靠来源。已扫描现有 29,564 份 Lua 字节码的常量（含子原型），没有发现这些 ViewCodex 的 groupId；这只说明当前提取集合没有对应常量，不能推断全部属于服务端。NPC 实例有坐标但缺可靠楼层时保留未知，不把地下实例默认放到地表。地图记录复用 geographies、npcs、dungeons、tasks 的关联，不复制其正文。

NPC 实例条件保留原始二维分组，并上游规范化为 `{kind,type,parameters,source_type}`；组内/组间逻辑为 `condition_logic:unverified`。当前包含 1,062 条任务条件（13 个实际枚举）、123 条尚未核实 ID 命名空间的列表和 5 条特殊场景列表，后两类不能按任务条件猜配。下游只映射明确的 kind/type/parameters，不透传 source_type 或原始混淆键。

## 验证

2026-11-03 补充关卡状态组：`extract/maps/level-tag-groups.js` 解码已提取的
`Data/_ExcelBinOutput/LevelTagGroupsExcelConfigData.MiHoYoBinData`，当前 profile
`level-tag-groups-7.1-v1` 仅接受 SHA-256
`87ecf6c68d6bb02e5e1871e2d75882d17a1b9acb438516fd8472cb432fab0d72`。
客户端有 71 行；仓库 JSON 只有前 31 行。前 31 行的成员、初始值、冷却值逐项一致，
原生载荷 3375 字节完整消费。后 40 行不能从旧 JSON 缺失推断为服务端信息。
编码常量按这一份载荷验证，尚未恢复可跨版本复用的客户端读取函数；不同载荷拒绝套用。

原生第 45 行字节范围 `[2344,2385)` 给出成员 `[108,109,110]`、初始值 `108`。
`LevelTagMapAreaConfigData` 分别关联区域 `51/52/53`；三个原生控制器各只有一个索引 0 图像组。
缺失的原始 `index` 仍保持缺失，只针对这个“唯一原生图像组”条件归一化图像关联，
不会把多图控制器的缺失索引全补成 0。`7405349` 完成动作序号 4 写入 `109`，
`7405369` 完成动作序号 4 写入 `110`；下游分别转换为
`fontaine_research_institute_stagnating_in_the_rubble:40 / :59`。
每个区域都接收同组的全部写入，包括关闭自己、改为显示其他阶段的写入。

组内替换及初始值补齐依据社区保存的 3.4 服务端实现：
`Havesten/hk4e-sources@d12e0ae8dbe6012aefca71128d4c13e48113b68d` 的
`LevelTagExcelConfigMgr::rewriteLevelTagGroupsConfig`、
`PlayerSceneComp::changeToTargetLevelTag/getCurLevelTagIdVec`。
本地证据在 `.cache/map-state-semantics-20261103/level-tag-sources.json` 及
`player_scene_comp.cpp`（27831–27874、28486–28511）。这是历史运行逻辑与当前配置的交叉验证，
不冒充已完整还原当前客户端的全部绘制条件，导出仍标记 `evidence: inferred`。
同组存在非任务触发、区域开关混合写入、无法关联的任务、非唯一图像组时不启用此自动计算。

使用 `resources/level-tag-groups.js RAW_EXTRACTION_REPORT OUTPUT_CACHE` 将 resource-tools
已提取并校验的载荷整理成资源缓存，再通过 `--level-tag-resources` 或
`MAP_LEVEL_TAG_RESOURCE_CACHE` 交给地图解析。`cache/enrich-map-level-tags.js CACHE SNAPSHOT RESOURCE_CACHE`
可以补充固定快照，只修改地图区域和执行动作，保留任务正文、图片及其他原始记录。
当前使用 `.cache/level-tag-groups-20261103-v2.json` 和快照
`569497b783b5517d0c80d76042bd32502df8e2f3d74a69218759bcf1308d13ff`。

`npm run test:maps` 检查外层键关联、Layer/Floor 命名空间、区域复合关联、歧义拒配、动作参数与完成/失败阶段、原始名称切换、64 位资源 ID、字段变化失败、能力选择链、历史边界拒代以及原生 Unity 解析。真实数据验证使用当前源快照，2026-11-01 不含可选资源时共 17,796 条，含 4,925 个点、431 个图片层、316 个楼层、190 个层组、142 个地图区域、1,714 个任务执行动作、3,594 个 NPC 实例、268 个观景点、264 个图层区域、34 个能力背景/标记控制以及 40 个其他地图状态触发器。

这些数量是当前输入的核验结果，不是未来版本的硬编码预期。下游需要显式映射和校验每类输出，不应将 `data/source` 原样透传到 Wiki。

### 2026-11-04：按输入校准混淆字段与地点类型

`extract/maps/schema.js` 复用 `extract/field-inference.js` 的严格交集校准，共覆盖 22 个被地图解析实际读取的属性键。
catalogue、atlas、资源标签、地点补充、NPC 条件和多层区域均使用当前输入得到的键；没有旧/新属性名 fallback，也没有跨输入的进程级缓存。
非空资料族缺少校准行、匹配值缺失或候选键不唯一时直接报错。原本可选的逐行字段仍保持可选，不因校准而补造数据。
以下已知值同时核对过真实 7.1 提交 `c5ef717b774` 与 7.2 提交 `bd35e243fa4`：

| 资料族 | 校准记录与独立已知值 |
| --- | --- |
| WorldArea | `1100/1101` 的配置文本哈希 `1333393882/3060720010` |
| MapLayerGroup | `31101` 的区域列表 `[11]` 与参考楼层 `3110101`，仍不是默认楼层 |
| MapLayerFloor | `3110101` 的组 `31101`、层数 `-1`、名称哈希 `282263247/417561169`；`3200501` 的名称条件 `MAP_FLOOR_NAME_CHANGE_QUEST([7306622])` |
| MapLayer | `3110103 → 3110102`；刻意使用层 ID 与楼层 ID 不相等的记录消歧 |
| Scene Point | 场景 3 点 `45/48` 的子区域 `205/106` 和入口种类 `Tower/Daily` 双行交集；点 `1304 → layer 3460401` |
| Quest | `35302` 的描述哈希 `3726907551`、序号 `3`、失败回滚 `35302`；`35311` 的完成动作依次设置 OpenState `2/1`，各状态为 `1` |
| MultilayerMapRegion | 文件 `31101` 的组 `31101`、包含已知层 `3110101/3110102` 的列表及其层号；不按“某个数组”猜字段 |
| NPC 条件 | `scene1085_npcborn_nogroup` 的 `_id:405100000/_configId:5100`，已知列表 `[108502]`；ID 命名空间仍未核实 |

地点 `$type` 是值，不是属性名；现在也不再依赖固定类型枚举表。当前输入的十类值由历史命名版本 `cbe446c9e60` 的独立样本校准：
场景 3 点 `45/21/8/27/55/317/439` 分别为入口、出口、传送、个人场景跳转、建筑、载具召唤、虚拟传送；
场景 1006 点 `1/4/5` 分别为秘境锚点、退出、滑落复活。
每个样本必须保持同一场景/点号、gadget 和世界坐标；历史 float32 展开与当前 JSON 舍入的坐标差小于 `0.001`。
类型值缺失、两个独立类别得到同一值或样本身份漂移均报错。其余未知类型保留 `unresolved`，不根据属性形状猜测。

7.2 真源检查结果：597 个 WorldArea、204 个层组、342 个楼层、458 个图层；
34,249 个任务步骤、26,046 条完成/失败动作全部通过字段检查。
5,124 个场景点中，十类已校准类型覆盖 5,110 个；其余 11 个 `$type:HOIHJEHIGML` 和 3 个缺少 `$type`，保持未分类。
NPC 条件为 1,062 条任务条件、123 条未核实命名空间的 ID 列表、5 条特殊场景列表。

本次明确保留的固定混淆字面量仅是下列类型/二进制枚举，不是待推断 JSON 属性键：

- `extended.js`：`CNFIFPJNOKE / ICEFINJKEDH / KEANKLJIJJI` 是 NPC 条件 `$type`。当前真源仍使用这些值；没有新增独立命名类型证据，因此维持既有分类，未知类拒绝解析。
- `regions.js`：`HAIFNCHBCNL / AJNJANLLNIB / MDPMIFIJHAP / DBKLAGCFMAH` 是既有盒、旋转盒、柱、球形状 `$type`。本次未扩充形状语义。7.2 分别投影 `659/69/106/4` 个，119 组中 117 组与独立 min/max 边界一致、2 组为部分覆盖。另有 `ACOLPJIAONA` 的 12 个源形状继续未投影，未编造旋转或几何解释。
- `map-area-binary.js`：`FBIKKPDLOAF / JDEMLDLHEPG / DAHBPAALFNA / HBAIOECPCPA` 是固定、带修订校验的二进制类型标记输出；不是 JSON 键，本次不改二进制解码协议。

验证命令：

```powershell
npm run test:maps
node extract/maps/check-fields.js 'D:/genshin data'
node extract/maps/check-fields.js 'D:/genshin data' --catalogue
```

地图测试 109 项通过，包括 22 个属性逐项缺失/多义拒绝、全体任意改名、同进程两套输入隔离、
类型任意改名、样本身份漂移，以及 catalogue/atlas/资源标签/区域/NPC 的消费回归。
前两条命令不要求开发者的旧资源缓存可用；第二条为只读真源校准与全资料族检查，不声称已验证图片资源或翻译。
第三条保留正常缓存校验：本次被旧 WorldArea 缓存的 7.1 源指纹拒绝；既有图标专用无 WorldArea 几何入口也被
MapArea 缓存中已变动的 `resources/miliastra.js` 指纹拒绝。没有绕过校验或重写旧清单。

资源缓存重建后再跑完整地图导出。主线已把 `extract/maps/schema.js` 和 `extract/field-inference.js`
纳入 `resources/map-icons.js`、`resources/map-atlas.js` 的解析器指纹，并用单元测试检查依赖覆盖；
修改推断逻辑后不会继续沿用按旧逻辑制作的图标选择或 atlas 图片选择缓存。
