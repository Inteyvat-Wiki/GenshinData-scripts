# 快照数据提供接口

`require('genshindata-scripts')` 现在只加载接口，不启动提取、不回溯历史，也不创建缓存。`npm start` 等旧入口暂时保留，现有 wiki-data 无需立即改动。

下面的 API 示例在异步函数中执行。

```js
const data = require('genshindata-scripts');
const snapshot = await data.prepare({
    sourceRoot: 'D:/genshin data',
    cacheRoot: 'D:/GenshinCache/data', // 可省略，默认用户缓存目录
    folders: ['characters', 'misc'],
    languages: ['CHS', 'EN'],
});
const character = snapshot.getRecord('English', 'characters', 10000046);
const version = snapshot.getAuxiliary('version', 'characters', 'hu_tao');
for (const { key, data: record } of snapshot.entries('English', 'characters')) {
    // 逐条消费，不在接口内部保留所有记录正文。
}
```

原始 ID 存在多个变体时，按 ID 读取会报歧义；可用 `keys()` 返回的精确记录键区分。语言接受短代码或完整名称；读取接口使用完整语言名。图片、数值、曲线、版本和文本依赖为同一快照的辅助数据，不由下游直接拼路径读取。

## 缓存结构与更新

- `objects/`：按内容 SHA-256 寻址的 JSON 记录，跨快照复用，不再向 genshin-db 写完整记录。
- `snapshots/`：不可变清单，包含计划、每个文件的内容身份、源记录 ID、增删改列表和父快照。
- `plans/`、`current.json`：已完成快照指针。发布前校验全部记录内容；失败不切换 current。
- `history/`：历史 TextMap SQLite 状态及派生索引，与最终 JSON 缓存分开。无需将 SQLite 改成逐条 JSON。
- `staging/`：子进程独立输出目录，完成或失败后仅清理本次创建的目录。
- `prepare.lock`：防止多个准备过程同时修改指针。进程意外终止可能留下锁；确认没有准备进程后才可人工移除，不自动抢占。

默认缓存位置为用户缓存目录下的 `Inteyvat-Wiki/genshin-data`；可用 `GENSHIN_DATA_CACHE` 或 `cacheRoot` 覆盖。不要放入包安装目录、提交 Git 或随 npm 发布。

第一阶段采用保守失效：所选范围内任意提取代码、源数据树、参与的 Lua 或资源映射输入变化就重新提取所选分类，不是逐表/逐条精确增量。当前要求原始 Git 仓库输入已提交；脏输入明确报错，不给未标记的源数据猜版本。原始目录只读。

每次 prepare 校验缓存内容，缺失/损坏时重建；`force: true` 显式重新提取。成功返回的句柄固定在一个 snapshotId，后续 current 切换不会改变旧句柄读到的内容。旧快照和未引用对象目前不自动回收，以免删除仍在使用的数据。

## 历史版本

默认包含版本推断，需要完整源 Git 历史。新入口将 `historyRefs` 中的引用在准备开始时解析为固定提交，按所列顺序拼接各自的 first-parent 序列，并对重叠提交去重。不会扫描无关分支及工具内部引用，也不按版本号猜测历史顺序。已有 3.3 特判保留，可通过 `versionOverrides` 指定覆盖。

实际源仓库的老历史在 master，当前 HEAD 所在 main 只包含 6.7 之后的 7 个快照。因此仅使用 HEAD 并不完整。本地 config.json 已明确设置 `textmap_history_refs: ["refs/remotes/origin/master", "HEAD"]`，合计 81 个快照（1.x–7.1）。也可以在 prepare 中显式传入 `historyRefs`。该本地配置仅在 sourceRoot 与配置源目录相同时使用；其他源仓库默认只选 HEAD，应按实际历史布局配置，不能假定缺失历史会自动出现。

`historySeedCache` 可以指定已有历史缓存目录。只有源目录、模式版本、语言和全部已处理历史前缀完全吻合时才复用；通过只读 SQLite 连接和 VACUUM INTO 一致性复制到新的缓存目录，原数据库不改写，也不只复制可能遗漏 WAL 的裸数据库文件。身份或历史不匹配则报错，不强行接续。

对象在中英文提取时读取的 TextMap 哈希集合现在写入内部 `dependencies/<folder>.json`。若原始有效内容及提取规则不变、只有历史推断结果变化，prepare 直接从这些依赖重算版本，正文 blob 复用。已通过“新增重复文本后再删掉，当前正文恢复不变但推断版本前进”的测试。

清单中的 `versionMethod` 表明这是文本启发式推断，不是真实上线日期。数值 ID 有多个变体时严格报歧义；字符串与精确记录键相同时优先视为记录键。

`versions: false` 可用于没有完整历史的明确测试场景，但结果没有推断版本，不能冒充完整正式导出。版本开启/关闭是不同缓存计划。`historyId` 是版本索引内容哈希，也用于进程内缓存失效。

## Lua 与资源解析输入

任务字幕使用 `luaRoot` 或 `GENSHIN_LUA_PATH`，输入字节码内容哈希纳入计划。不会执行游戏 Lua，也不负责从资源包提取字节码。

千星奇域和头像框的外部资源映射可以通过以下配置传入：

```js
resourceCaches: {
    miliastra: 'D:/GenshinCache/assets/miliastra-resources.json',
    profileFrames: 'D:/GenshinCache/assets/profile-frame-resources.json',
    worldAreas: 'D:/GenshinCache/assets/world-areas/world-areas.json', // maps 必需
}
```

对应环境变量仍为 `MILIASTRA_RESOURCE_CACHE` 和 `PROFILE_FRAME_RESOURCE_CACHE`。开发目录中原有 `.cache` 路径仅作兼容回退；npm 包不携带这些资源映射。映射及其声明的来源文件都要通过哈希校验，旧映射不会因最终输出缓存命中而被默默接受。

地图一级、二级地区范围只使用客户端资源缓存：`resourceCaches.worldAreas` / `MAP_WORLD_AREA_RESOURCE_CACHE` / CLI `--world-area-resources`，未指定时查找开发目录 `.cache/world-areas.json`。选择 `maps` 时必需通过该缓存校验；缺失、过期或客户端版本不受支持都会停止准备，不再回退到社区仓库的 `BinOutput/Scene/WorldArea`。显式打开已经生成的只读快照仍不需要客户端在线。资源准备见 `resources/README.md`。

## 当前边界

- 保留旧导出命令的双目录输出作为过渡；只有新 prepare 接口保证完整数据由上游缓存独占维护。
- 包名尚未更换为组织作用域，genshin-db 暂以本地 npm 依赖连接；不要直接执行继承的 npm 发布脚本。
- 历史的分支拼接、种子迁移、增量和版本重算均有独立 Git/SQLite 测试；真实数据验证使用独立测试缓存，不覆盖正式输出。不要将仅从 6.7 起始的不完整历史当成完整历史。
- 已完成真实历史验证：显式拼接得到 81 个快照、861,831 个哈希，迁移后 hashes.json 与原索引逐字节一致；268 条观景点对象版本与原表完全一致。原 SQLite 通过只读连接复制，正式数据目录未写入。
- 现有源数据的部分数值/地区字段已有适配缺口。例如当前旧查询胡桃的数值计算已为 NaN；本轮不把新旧同为 NaN 当成数值正确性通过，另用独立数值夹具验证接口接线。

## 命令行与目录摘要

```text
npm run cache:prepare -- --source "D:/genshin data" --cache D:/GenshinCache/data --folders characters,misc --languages CHS,EN
npm run cache:inspect -- --cache D:/GenshinCache/data
npm run cache:verify -- --cache D:/GenshinCache/data
```

prepare 还支持 `--history-refs refs/remotes/origin/master,HEAD`、`--history-seed PATH`、`--lua PATH`、资源映射选项、`--force` 和明确测试用途的 `--no-versions`。`--folders all` 仅展开已实现提取器，不从 genshin-db 旧目录补数据。

inspect 只读清单；verify 会读取并校验正文，但两者均不提取、不改 current、不要求原始源目录在线。直接运行 `node cache/cli.js` 时，stdout 是有界 JSON 摘要，准备进度写到 stderr。通过 npm 调用时，npm 默认还会输出命令头，自动化可使用静默模式。

`snapshot.catalog()` 返回语言、分类和数量，下游无需解析清单中的存储路径。`keys()` 返回防御性副本，不会因为调用方修改列表而污染后续读取。
