# 地图 Unity 资源解析

资源提取由 `@inteyvat-wiki/resource-tools` 完成；本仓库的 `resources/maps.js` 解释地图对象字段及引用，完整记录仍由快照缓存维护。wiki-data 不能调用这里的二进制解析器或自行读取游戏包。

## 独立场景原生边界（2026-11-05）

琉形蜃境 `scene-10` 的 `Penumbra_LevelStreaming → MapPenumbra` 引用已核验。
`UI_Map_Penumbra_{x}_{z}` 的九张 2048×2048 切片与控制器的 `[-1,1] × [-1,1]` 网格一致；
每格对应 1024 游戏坐标单位，使用既有独立场景投影。四个地名来自预制体中的原生文本键。
外围遮挡沿用已验证的材质解析：500 组有效，501–503 组为零面积。
限制区 101002–101004 的 MapBack 是覆盖图，未当作红边；没有从区域多边形补画边界。
`cache/enrich-map-base.js` 可向指定快照添加经完整来源校验的底图，再由既有地名和效果补充入口添加其余记录。

`resources.prepare('mapEffects', plan)` 将已提取的资源解析成 `native-boundary` 和 `outside-fog` 记录。
计划需显式提供 `prefabCacheFile`、`entryCacheFile`、`outlineCacheFile`、`artIndexReportFile`、`sceneIds` 和新的输出 JSON 文件 `output`。
通过 `resourceCaches.mapEffects`、`--map-effects` 或 `MAP_EFFECT_RESOURCE_CACHE` 接入正常地图提取。
已有快照可用 `cache/enrich-map-effects.js CACHE SNAPSHOT RESOURCE` 增补；其他记录保持不变。

场景根对象由 SceneScriptData → MapScriptData 的真实引用及完整美术资源键确定；同名入口只有在全部引用都指向字节相同、脚本类型正确的地图配置时才合并。
红边由 LimitRegion 的 MapBack 地址确定预制体，从中读取 Sprite、材质、组件颜色、祖先变换及 GuideArea 缩放。
拉伸矩形先根据父矩形解析实际宽高；不拿 SimplePolygon 轮廓充当原生红边。普通 alpha 和加法混合分别保留，未验证的 shader 拒绝输出。
wiki-data 显式转换贴图部件，烘焙 RGB tint、保留原始 alpha 和组件透明度，输出普通覆盖图；前端不接收 Unity 字段。

外围遮挡从 MonoLevelMap 的分组引用及材质路径格式定位，按完整资源键和真实 PPtr 校验纹理。
Stencil 与本场景背景材质一致即可，不再固定为 129。分组名不要求与 GameObject 名相同；零面积变换不参与合并。
展示继续使用原生灰度遮罩 0.5 等值线的并集、纯黑背景和青绿色边缘，属于全部区域开放的静态预览。

7.2 本地验证覆盖 8 个独立场景，得到 7 组红边和 7 组外围遮挡。金苹果群岛控制器的外围分组引用为空，未补画外围；希穆兰卡所查 MapBack 是底图替换图，未当作红边。霜月 910 组变换为零面积，已排除。
配置文件中的材质开放值、动画和当前玩家进度不作为这些静态边界的显示条件。

## 地表及独立场景文字（2026-11-03）

`extract/maps/surface-labels.js` 解析 `MonoLevelMapNames` 的两组坐标列表，并接入底图 prefab 的 `MonoLocalizedText`。正常 `collateMaps` 使用已验证的 `MAP_BASE_RESOURCE_CACHE` 及其 prefab 缓存，无新增提取参数。场景由底图控制器的 GameObject 引用确定；静态文字沿已解析祖先引用查找根对象，不按同名 prefab 猜配。

7.1 列表的 32 字节 MonoBehaviour 头后为布局字和两组（控制字、模板 PPtr、数组长度、条目）。每条含 uint32、两个 float32、名称 ID、TextMap 键、末尾 uint32。解析器检查脚本类、Unity 版本、有限坐标、组内 ID 唯一性和字节完全消费；未确认控制字仅保留在 `native_label`，不生成显示条件。稳定 ID 包含组号，避免两组复用 `1_1` 等名称 ID 时覆盖。动态条目的改名规则关联未确认，不按相同 ID 强行关联。

坐标沿用底图投影：`worldX = uiY * scale + offsetX`、`worldZ = -uiX * scale + offsetZ`。还检查根对象和 `PlaceNames`／`AreaNames` 容器的平移、旋转、缩放及中心枢轴，变化则拒绝解析。静态文字沿用矩形中心。这是文字排版位置，不是地点入口。

实证：`BigWorld_Map` 的组件来自 `03931010.blk`、Offset `29799290`、PathID `-3688014165754499514`，SHA-256 `4980cb9c78afd85966cac65c4110edae016edaa5a55dba1e52f3f50e84e726f4`。第一组偏移 56：`1_1 → UI_MAP_AREA1_TITLE_1 → 2955715816 → 望风角 / Stormbearer Point`。UI `(192,220)` 经 scene 3 比例 4、偏移 `(2048,-1024)` 得 `(2928,-1792)`。第二组偏移 12116 同为名称 ID `1_1`，但对应 `UI_MAP_City1_TITLE_1 → 3922567678 → 坠星山谷 / Starfell Valley`，是另一条记录。

`MapMoonCanon` 的同类组件来自 `11331095.blk`、Offset `28278831`、PathID `-5098054744814997069`，包含 `UI_MAP_AREA900_TITLE_1 → 1319773390 → 伊比尼伯龙之眼`。静态例子 `MapAbyssalPalace` 的 PathID `-8637477107220555099`：`UI_MAP_AREA200_TITLE_4 → 783503514 → 蛇心之地`，UI 中心 `(59.5,-202.5)` 经 scene 5 投影得 `(-298,274)`。

当前列表共 310 条（主世界 297、scene 102 共 13），其他底图根对象共 49 条静态文字，统一输出 `map_place`。`cache/enrich-map-labels.js CACHE SNAPSHOT BASE_CACHE SOURCE_REPO` 可增补已有快照；使用快照 Git 修订的 ManualTextMap、普通及 Medium 双语 TextMap，先核对原有标签的哈希和原文，不重新解析更新后的其他表。显示选择由 wiki-data 显式目录维护。

## 分层地点角标（2026-11-03）

`resources/map-icons.js` 的正常资源准备会同时提取 `UI_MarkPoint_Sign_Inside` 与 `UI_MarkPoint_Sign_Inside02`，
并将通过 CAB 和 PNG 身份校验的图片输出为 `map_icon` 记录，`badge_state` 分别为 `normal`、`active`。
这是一组界面共用资源，不是地点主图标的变体，也不引入地点解锁条件。
客户端教程 `TutorialDetailExcelConfigData` 的 154501 / 154503，及 `TextMap_MediumCHS` 的
1497798120 / 3882857672，明确说明角标表示分层地图归属，当前查看层级的角标以亮蓝色显示。
资源名与两种状态经过原生教程图 `UI_MultiLayerMap_01` / `_03` 逐图核对。

当前 7.1 两张 Sprite 均为 32×32，来自 `08291799.blk`、Offset 1268992、
CAB `15f0bf31e3f2f6ad8b15ad857995dba4`，PathID 分别为 `-6884423950281524040`、`2177331443358354299`。
有界验证缓存为 `.cache/map-layer-badge-CFrc8O/verified-badges/map-icons.json`；生产入口不依赖此实验路径或固定块号。
地点归属继续使用已解析的 `floor_id`，不按高度或图标外观猜测。

## 使用

完整地图资源入口为 `node resources/map-atlas.js PLAN.json`。它由原始表推导候选 prefab 路径，再经 resource-tools 对象清单核验，默认不要求人工提供实验缓存或块编号。一个完整计划示例：

```json
{
  "data": "D:/genshin data",
  "studio": "C:/Apps/AnimeStudio",
  "assetMap": "C:/Apps/AnimeStudio/Maps/genshin_7.1.map",
  "output": "D:/GenshinCache/resources/maps-native-new",
  "extractImages": true,
  "maxObjects": 20000,
  "maxSources": 64,
  "timeoutMs": 240000
}
```

`output` 必须不存在。`data` 只读；提取在输出目录进行。`extractImages` 未开启时不提取 PNG。该命令读取 MapLayerGroup、MapLayer、WorldArea、MapArea、LimitRegion 及 ConfigMapArea；不会扫描或导出全游戏图片。候选路径加 `.GameObject`、补零至下一个 256 字节边界、取 MD5 的第 1–4 字节有符号小端整数，得到此资源版本的 Container 定位线索。然后**必须**核验真实 GameObject 根名称，哈希碰撞不能形成关联。例如 `ART/UI/Menus/Widget/InLevel/MapLayered/LayeredMap_35102` 对应 Container `-528301668`。

初始有界块清单来自候选 Container；名称库存也会发现这些块中的地图根和精确 LimitRegion 同名边界根。随后仅沿 PPtr 补足 Sprite、Texture2D、Material、Shader、Mesh 等依赖。输出保留提取报告、清单、根列表、每个输入及 PNG 的 SHA-256，并报告未找到的期望根。对未来版本无法发现的根应补充明确 `sources` / `prefabPaths`，不能悄悄换成旧版本资源。

原生 MeshImage 的 Sprite 另行读取真实 SpriteRenderData：保留 Sprite 原始矩形、裁剪矩形和 texture PPtr，再提取**完整底层纹理**，不拿裁剪 PNG 直接替代 Mesh 纹理。资源工具只提供这些机械数据，原始表关联和坐标解释在本仓库进行。

以下 `resources/maps.js` 低层入口仍用于有界单例检查或复用既有提取报告。

准备计划是 JSON，包含 `studio`、`sources`、`roots`、`output`；可选 `game`（默认 GI）、`timeoutMs`、`dotnet`、`maxObjects`（默认 512）、`maxRounds`（默认 16）。`sources` 是明确指定的资源块绝对路径，`roots` 每项是准确的 `Source + Offset + Type + PathID`，其中 PathID 为十进制字符串。可先用 resource-tools 的 `readAssetMap` 或 `inspectResourceFiles` 找到根对象。

```text
node resources/maps.js prepare PLAN.json
```

该命令在**不存在的新目录**中检查对象表，再沿已确认的 PPtr 字段逐轮提取依赖。不会搜索整盘、按同名猜图、隐式选择基础包/更新包、执行 Lua 或批量提取 PNG。对象数/轮数超限时停止并保留过程资料。成功写出 `map-resources.json`，其中 unresolved 诊断仍需处理；成功不代表所有显示条件已经解析。

也可以复用已经提取的原始对象：

```text
node resources/maps.js build BUILD_PLAN.json
```

计划包含 `reports`（serialized 提取报告路径数组）、`inventories`（对象清单的 inspection-report.json 路径数组）及 `output`（新的输出文件）。可加 `imageReports`、`meshReports`、`spriteReports`；`texturePayloadReports` 仅用于证明同 PathID 异 CAB 纹理的内容等价。两个模式都验证源块、清单、报告、metadata 和字节文件的 SHA-256。payload 不能代替 serialized；不接受失败或不完整的提取报告。解析代码本身也纳入资源缓存输入身份。

公开资源 ID 使用规范化的块文件名、Offset、精确 PathID 和对象类型，移动客户端安装目录不会改变 ID。内部引用定位仍使用完整绝对路径。两个不同来源路径若拥有相同块文件名，构建立即报告歧义，要求明确选择已验证的资源版本，不按名字合并基础包和更新包。

程序接口：`prepare(options)`、`buildCache(options)`、`readResourceCache(file)`。准备快照时传 `resourceCaches.maps`，或设置 `MAP_RESOURCE_CACHE`；没有缓存时只有表/配置解析结果，不能宣称已有地图图片位置。

## 当前已实现

- 对实际验证的 Unity `2017.4.30f1\n2`、序列化版本 17、小端布局做有界读取，完整对象要求精确结束。其他布局保留诊断，不按偏移硬读后冒充成功。
- GameObject 组件列表和序列化 active；Transform/RectTransform 的旋转、位移、缩放、父子关系、锚点、尺寸、pivot。active 是资源中的值，不能直接当运行时显示条件。
- MonoScript 真实类名/命名空间/程序集；获得脚本身份后才解析 MonoMapArea 的**有序**区域数组、MonoMultilayerMapLayer 的对象数组、240 字节 Image 的 Material/Sprite PPtr 和颜色。
- Material 的 Shader、纹理引用/UV 缩放/偏移、float/color 属性。两种纹理字段布局均要求唯一解析成功且完整消费字节，不靠名字猜布局。
- Sprite/Texture2D/Shader/Mesh 的本地 serialized 解析器只读取可核验的身份部分；完整 PNG、SpriteRenderData 与 Mesh 由 resource-tools 的对应报告提供，并核验对象身份与来源，不把身份记录冒充完整图片或网格。
- 明确指定资源块内的引用解析。重复 CAB、缺失外部文件、缺失对象分别保留诊断。没有依赖闭包时不输出伪坐标。
- Image → 同一 GameObject → 唯一 RectTransform，以及 Image → Material → `_MiniMap` / Image → Sprite 的准确关联。图片计划中的名称来自目标对象，不是控件名。
- 沿父 Transform 合成四角，坐标明确标成 `prefab-ui` / `not-calibrated`。不将它等同于游戏世界坐标或 Wiki 坐标；拉伸矩形暂不计算运行时布局。
- MonoLocalizedText 原始 textKey 及父链位置，交正常文本字典本地化；不会根据地名文字猜场景或条件。
- SmoothMaskClippableMeshImage 的 252 字节布局及尾部 Mesh PPtr；通过通用资源工具读取真实 Mesh 顶点、索引、UV、颜色和子网格。
- `extract/maps/atlas.js` 使用控制器 `layerObjects` 引用识别层图。复合层通过控制器容器的同 ID 子节点识别底图，动画雾组件不会冒充静态底图。`renderOrder.hierarchy` 来自父 RectTransform.children 索引，只有同 `scope` 根内可比较；跨 prefab 顺序未解析。

`objects` 保留上游原始字段证据；`images` 提供可关联的图片记录、组件颜色、材质参数、四角和精确资源条目。下游需要显式选择和重命名字段，不能透传整个 objects。

## 软边与限制

当前已研究 Shader 的 serialized SHA-256 为 `081f89e507d7a1b280fb1f6ed75e0de19ab5e9ebe5e2e88d1f33b86884fefd9a`，100,336 字节。只有相同字节的 Shader 才标记 `open-area-base-map-separable-v1`。素材中出现熟悉的属性名不够证明公式不变。

已确认的软边部分为：开关关闭取 1；打开时 alpha 乘以 `clamp(k*(1-|2u-1|),0,1) * clamp(k*(1-|2v-1|),0,1)`。它是矩形 UV 两方向相乘的渐变，不是手工抠核心区后高斯模糊。`softEdgeAlpha` 仅实现这部分，不承诺复现全局 stencil、clip、动画、运行时颜色改写或红色不可进入边界。

所有 Image 的 `visibilityStatus` 目前仍为 `unresolved`。原生组件引用、序列化 active、Quest 写入事件和地图显示之间不能未经验证地画等号。

## 7.0 全局红边界

`GlobalOpenArea7_0` 已在当前资源中找到，并非因为 SimplePolygons JSON 缺失而推断为服务端资料。根对象位于 `11331095.blk / 27865796 / -3509239610080517809`，CAB 为 `4708f9651eb0796418a2d05516b3d936`；与 `LimitRegion 31028` 同名精确关联。

`extract/maps/boundaries.js` 输出两层静态资料：

- Mask：`UI_BigWorld_GlobalOpenArea_7_0_Mask` 原生 2048² PNG。PNG alpha 几乎全为 1，Shader 以**红通道**计算透明度，不能直接把该 PNG 贴到地图。`UI_OpenArea2` 材质引用 128² 的 `UI_BigWorld_OpenArea2_Point`，重复 280×280。关闭 smooth mask 的当前配置下，RGB 为 `(main.r * color.r + noise.r, main.g * color.g, main.b * color.b)`；alpha 为 `main.r * color.r * color.a`，组件 alpha 为 `0.21176470816135406`，材质 Color 为白色，正常 alpha 混合。Shader serialized SHA-256 为 `e7295659de2643083505deaed1245ab04ec1dddf47489e96d282861974e805fe`，公式由其中 DXBC 程序核验。
- Rim：`Eff_Model_UI_GuideArea_7.FBX`，Mesh PathID `3993041647707304329`，2077 顶点、2075 三角形、UV0，无顶点颜色。组件颜色 `(1, 0.5450980663, 0.5450980663, 0.2823529541)`；`ClippableLightUI` Shader SHA-256 为 `9f7dbb0fa6cf4c4c56b32961d085f0da17065bc538655684bf172c265434d418`，源/目标混合为 SrcAlpha/One。Sprite `Eff_Model_UI` 的原始 rect 是 32²，裁剪 rect 为 `[9.292893,0,13.414214,32]`，底层 Texture2D PathID `-7226240987311836351`。因此保存完整 32² 纹理和原生 UV；PNG 的 14×32 裁剪导出不能直接当完整纹理。

Mask 纹理为 BC7、mipCount 1、双线性、Clamp；噪点为 DXT1、mipCount 8、双线性、Repeat；Rim 为 BC7、mipCount 1、双线性、Clamp。当前公开对象未保留色彩空间标志。烘焙 Mask 是静态分辨率预览，不等于运行时每个缩放级别的噪点 mip 采样。MeshImage 自定义代码如何重映射 Sprite UV、CanvasGroup 动画和实际激活时机仍未核实，分别保留 `mesh-sprite-uv-mapping-unverified`、`canvas-group-animation-not-reproduced` 和 `runtime-activation-unresolved`。

边界投影现在从客户端地图配置及 `GuideArea` 的原生 Transform 推导：`MonoLevelMap` 网格比为 `1024/256=4`，`GuideArea` 缩放为 `0.5`，合成为 2。scene 3 的地图框给出原点 `(2048,-1024)`，因此 `worldX = 2*v + 2048`、`worldZ = -2*u - 1024`。缺失原生投影时不再回退人工校准。早期与旧图最大差 3.8 的比较只作为历史回归记录，不是生产输入。7.0 保留真实变更后的 v 位置，范围为 X `[-8584,16056]`、Z `[-7148.200195,17491.799805]`；仍不承诺运行时逐像素复现。

## 2026-11-02：原生底图、场景框与 MapArea

生产链路已移除旧手工图、手工坐标、手工裁剪及手工红边兜底。

- `resources/map-area-configs.js` 从客户端设计索引定位 `Data/_BinOutput/Map/MapArea/ConfigMapArea.MiHoYoBinData`，完整 UInt64 key 为 `12915921689267179158`。资源在 `24230448.blk / offset 0 / PathID 44279`；当前版本解析器钉住块 SHA-256，解出 137 条配置，读取到文件末尾。与社区 JSON 重叠的 60 条记录、336 个已有字段逐项一致。137 是已验证当前布局，不将它当未来版本通用格式。
- 真实关联例：MapArea `71` → `Map_Natlan_Grp_52_01`；`110` → scene `103` → `Map_Firmament_Grp_1000_01`，`sortID=1`、`useSubAnchor=true`。通过实际预制体控制器、Image、Sprite 引用关联，名称相似度不参与。
- `resources/map-base.js` 核对 `MoleMole.MapScriptData` 的真实 MonoScript 身份、配置 → 根 GameObject → `MonoLevelMap` 的引用、PNG 导出 CAB 及 SHA-256。保留各自场景 ID，不能用 MapScriptData 的 map ID 或复制遗留的 WorldArea 路径冒充 scene ID。
- `extract/maps/base.js` 将原生切片整数编号投到世界网格。一个格子为 1024 世界单位，UI 格子为 256；PNG 可能是 64、1024 或 2048 像素，不能据 PNG 尺寸放大世界坐标。`UI_Map_Fairybook_700_01_GenerateMipMaps` 是覆盖图，带补零的 `01` 不符合切片整数格式，不会生成远处的假底图。
- 大世界的初始矩形使用中心布局：BigWorldMap frame 为 `[-3072,-2048,8192,8192]`，得到 `(2048,-1024)`；独立地图使用原点布局，frame `[-512,512,4096,4096]` 得到 `(512,512)`。比例取原生网格比。希穆兰卡不再因 2048 像素素材而误用 8 倍；空之神殿不再沿用人工偏移。布局规则与原生地名、地点及图像位置交叉核对，配置字段的原始数字也完整保留。
- 底图清单覆盖 scene `3/5/6/9/11/100/101/102/103`，503 张原生切片。全量 atlas 有 431 个分层图像、175 个其他地图图像放置，606 个放置全部有核验 PNG；其中 5 个几何关系、3 个场景关联尚未解出。其他未支持场景的投影仍保持未解析。`BigWorld_Fog_DQTsurumi_05` 根依然未找到，不猜配。

可重复准备底图：`node resources/map-base.js prepare PLAN.json`。计划显式提供 `data`（原始表目录，或改为提供 `sceneTableFile`）、`studio`、`map`、全新 `output`。也可传入已经核验的 `entryCacheFile`。入口自行定位配置、预制体、切片及脚本对象。资源提取只调用 resource-tools，游戏布局解释在 GDS 中。已有核验报告可通过 `build` 模式重建解析缓存，不能直接修改缓存中的哈希绕过校验。

### 场景底图入口

`resources/map-entries.js` 从 `SceneExcelConfigData.scriptData` 查找唯一同名的 `MoleMole.SceneScriptData`，核验真实 MonoScript 类型，解析其地图对象 PPtr，再由 resource-tools 按当前序列化文件的 externals、目标 CAB 和完整 Int64 PathID 定位 `MoleMole.MapScriptData`。随后读取真实 `prefabPath`。不再用底图名称名单发现场景入口，也不从场景名称拼接地图名。

该客户端剥离了类型树，解析器的 `mapReference` 是内部命名，未声称恢复原始 C# 成员名。只解码已核验的 SceneScriptData 前缀并保留其余字节；布局变化、错误脚本类型、目标缺失和冲突均保留诊断。空 PPtr 单独记为 `no-map-reference`，不能扩大解释为任何运行状态下都没有地图。

`node resources/map-entries.js prepare PLAN.json` 可单独生成入口缓存，参数为 `data` 或 `sceneTableFile`、`studio`、`map`、全新 `output`。`build` 的参数为 `sceneTableFile`、`sceneMapFile`、`reportFiles`、`inventoryFiles`、全新 `output`。所有表、资源对象、对象清单和解析器均进入来源校验。入口缓存不按 Wiki 导出目录过滤，保留共用配置的全部场景、空引用和未解析项。

`map-base` v2 必须提供这份入口缓存。多份 SceneScriptData 引用相同 MapScriptData 时先合并，再由 `MonoLevelMap.sceneId` 验证实际底图所属场景；不把每个共用配置的副本场景重复导出，不使用 MapScriptData.mapId 或遗留 worldAreaPath 充当 scene ID。切片前缀目前仍是 `extract/maps/base.js` 中的已核验图片命名映射，独立于入口发现；其他地图配置保留在入口缓存中，并产生 `unverified-base-tile-family` 诊断，不能仅凭配置存在就认定已有可展示底图。Wiki 的场景选择继续由 wiki-data 显式目录控制。

实例：scene 3 的 `BigWorld_LevelStreaming` 在自身字节偏移 304 保存 PPtr `{fileID:1, PathID:"-5526943833772309601"}`，指向 CAB `981fb2424d3dd762125a4982c6163ddd` 内的 `BigWorldMap`；其预制体为 `ART/UI/Menus/Widget/InLevel/MapBack/BigWorld_Map`。scene 102 同样通过原生 PPtr 指向 `MapMoonCanon`；其 worldAreaPath 仍写着 scene5，不能据此错误归属场景。

MapArea 使用 `node resources/map-area-configs.js prepare PLAN.json`，参数同样提供 `studio`、`map`、全新 `output`。随后 `resources/map-atlas.js` 的计划提供 `data` 和 `mapAreaConfigs`，使用客户端的完整预制体引用。准备查询快照时传入 `--map-area-config-resources`、`--map-base-resources`、`--map-resources`、`--world-area-resources`、`--map-icon-resources`。公开选项对应 `resourceCaches.mapAreaConfigs/mapBase/maps/worldAreas/mapIcons`；环境变量分别为 `MAP_AREA_CONFIG_RESOURCE_CACHE`、`MAP_BASE_RESOURCE_CACHE`、`MAP_RESOURCE_CACHE`、`MAP_WORLD_AREA_RESOURCE_CACHE`、`MAP_ICON_RESOURCE_CACHE`。

wiki-data 只查询记录并显式映射 `resource/category:base-tile` 的四角、图片身份及尺寸；前端没有 MapScriptData、MonoLevelMap 或原始资源键。图片条件、软边 Shader、全局裁剪及动画的验证范围仍分别记录，不把“原生图片已提取”当作“完整游戏显示已复现”。

## 早期实测范围（由上节的新链路取代）

2026-11-01 的当前表有 190 个 LayeredMap group、431 个 layer。190 个根均找到，431 层均通过真实控制器关联原生图；加 91 个覆盖图共 522 个原生放置，全部有已验证 PNG，图片实际去重为 519 个。额外保留 232 个原生文字锚点。早先缺少的 `1029000306`、`1029001001`、`1029001002` 是复合容器；后两者共享同一个真实 Sprite，没有补造图片。

当前已校准的 layer/cover scene 为 3、11、100、101，共 417 放置。scene 9 的 19 个活动覆盖图、scene 102 的 19 个层图、scene 103 的 27 个层图没有旧人工图的精确资源名锚点，40 个覆盖图尚无可靠场景关联；这 105 项不自动套 scene 3 投影。原生角点是 UI BL/BR/TR/TL，wiki-data 的地图展示按 `[3,2,1,0]` 转为屏幕 TL/TR/BR/BL。

旧人工层图的 318 个精确资源名匹配中，315 个有效位置与原生投影最大差 4.274 单位；另 3 个旧框以 `(0,0)` 为占位：3460502、3460503、116000302，现用原生位置。手工参考不再参与这些原生位置的生产计算。当前全量候选查找仍未找到 `BigWorld_Fog_DQTsurumi_05` 根，保留缺口，不替换同名或历史资源。

独立从上述计划复跑时，按当前表定位的块产生 431 层图和 85 个覆盖图（516 个放置）。前述 522 个检查结果额外保留了早先明确检查的 6 个无 MapArea/scene 关联根：Natlan 52_01～52_04、53_03、NodKrai 71_05；这些额外资源不会因名称而自动归入场景 3。新入口会明确排除 MeshImage 的矩形 frame，但完整 objects、Mesh、Sprite 和纹理记录仍保留，避免把三角形网格误画成一张矩形覆盖图。

## 验证

### 2026-11-03：红色边界外的原生雾层

外围不透明遮挡来自 `BigWorld_Map/MapArea/OpenArea_Fog`，与 `GuideArea/GlobalOpenArea7_0` 的红色范围独立。
当前资源的 `MonoLevelMap` 在偏移 6024 保存材质目录 `ART/UI/UIMap/UICloudMask/Material/`，随后是
`UI_Fog_BigWorld_{0}`、`UI_Fog_BigWorld_{0}_Outline`。64 个控制器分组各有两个 RectTransform 引用；
这 128 份材质均已定位，纹理和 Shader 通过 CAB + PathID 关联，不按相似名称猜配。

完整例：分组 1 → RectTransform `5651295450326059574` → 材质 `-4385233983576899232`
（`05497902.blk / 1420654`）→ `_Mask` Texture2D `-667781633078626812`
（`16170614.blk / 29453295`，CAB `a00a0ae24d5fbb89862c07328835d9e9`）。
其原生矩形投影为 X `[1195.197294,3755.197237]`、Z `[-2771.199965,-211.200022]`。
外围 Fog 组件引用材质 `1111683050428173355`（`11877482.blk / 26622129`）。
全部对象及图像的校验证据在 `.cache/map-outside-fog-20261103/`；生产入口不硬编码此目录。

三个 Shader 的序列化 SHA-256：

- clip mask：`40af7ea7572e7608824a2672c11963fc70072d7141d1d6c4005b9774d51b51cd`；
- outline：`3434b726f5adb327c35d23a3c52f6c54f392b03968d33425c15d2d658b5f3293`；
- fog：`214a562537432aeea0d1da970171e520988f96b7580060ecaecd8ec3e539e8b6`。

DXBC 与常量缓冲区元数据共同验证：mask 先用 `_WarpMask` 的 R/G 扰动 UV，再取 `_Mask.r`。
`saturate(r * _FogRGBA.r * _OpenAreaLerp) >= _Clip + 0.01` 的片元写入 stencil 129；
它输出零 RGBA，但这不是普通透明贴图。Fog 和 Outline 都只在 stencil 不等于 129 时绘制。
因此必须先合并所有开放区域，再绘制外围，不能逐区域分别用黑底覆盖。
Outline 的值为 `pow(saturate(r * _OpenAreaLerp), _OulineFadeRange)`，高于 `_OutlineRange` 时为实色，
否则按该值衰减颜色和 alpha。外围 Fog 的 shader 最终 alpha 为 1；不是红色 alpha 的扩大版本。

`resources/map-fog.js prepare PLAN.json` 按 `baseCacheFile`、`sceneIds`、`studio`、`map`、全新 `output`
有界提取；只提供计划文件时从已有报告重新构建。缓存通过 `--map-fog-resources` / `MAP_FOG_RESOURCE_CACHE`
接入地图解析，输出 `resource/outside-fog`。wiki-data 显式转换成普通地图覆盖图，Wiki 不接收 Unity 字段。

### 限制区轮廓

`resources.prepare('mapLimitOutlines', { sourceRoot, studio, map, output })` 从限制区表的每个资源名生成 SimplePolygons 和 MapBack 的完整资源键。设计索引确定几何所在的块与包内偏移，再以对象清单确定 PathID。美术索引命中时附上预制体地址及包位置。同名资源仍按完整键定位。当前解码配置已核验 7.2 客户端的基础包和热更新包。

已有资源清单时可传 `mapFile`，也可用 `indexReportFile`、`artIndexReportFile` 指定当前客户端的两个索引提取报告。若同时给出 `rawReportFile`，则直接校验并解析已提取的二进制。将结果传给 `resourceCaches.mapLimitOutlines` 或 `--map-limit-outlines`，限制区记录的 `data.polygons` 即包含原始顺序的顶点、极值和来源。场景 ID 缺失时保留空关联。Wiki 的固定边界由场景导出目录选择，预制体命中只提供美术定位依据。

外围遮挡采用静态全开放预览（`_OpenAreaLerp=1`、time=0），独立场景的接入见本文开头。
材质中保存的开放值有 0/1 两种，不能将其当作当前玩家状态；大世界 64 组全部开放是 Wiki 的预览选择，
不是从任务完成状态推断出的结论。
动画、相机相关噪声/视差、mip 选择、色彩空间及开启过程仍不承诺逐像素一致。
固定采样分辨率只影响导出清晰度，不决定遮挡轮廓或扩边距离。没有使用旧人工图形、裁剪和距离参数。

```text
node --test extract/maps/unity.test.js resources/maps.test.js
```

测试覆盖 Int64 引用、元数据/字节边界、组件顺序、alpha、材质变体、父变换、软边四角乘积和缓存失效。测试夹具是合成数据，不打包游戏资源。

2026-11-01 的早期有界检查通过 resource-tools 显式读取 `03983187.blk`、`15224338.blk`、`11932507.blk`，从神的棋盘材质和 DreamIsland LT14 矩形开始，取得 48 个对象。解出材质 `Eff_UI_Map_Deshret_32_05` 的 `_MapEdgeSoftness=3.998499631881714`、开关 1、全局 smooth-mask 开关 0；MonoMapArea 的 10 个有序条目及 10 个 Image → Sprite 关联均成立。该次检查未提取 PNG；后续全量提取及 Wiki 接入范围见上文。

本次得到的 LT14 RectTransform 为 108 字节，PathID `-4012989001982442076`，所属 CAB `3fb6e2202f4071eae55357eab806a84b`；它通过真实 GameObject 关联 Sprite `-82408439499387811`，不是按名称猜配。原有本地实验缓存仅用于复核，不写进生产代码默认路径。

另从 `.map` 精确定位 `MonoMultilayerMapLayer` PathID `-3970295201862027629`，在明确指定的 `06977816.blk` 解出 61 个对象。其 88 字节对象包含两个有序 GameObject 引用（3510201、3510203 的控件）和末尾 RectTransform 引用，与研究结果一致。只提供这一个块时，三个 Sprite 外部 CAB 缺失；解析器准确报告 `missing-file`，没有按控件名补配图片。一般 UI 文字、组控制器和运行时拉伸矩形仍保留未解析诊断。
