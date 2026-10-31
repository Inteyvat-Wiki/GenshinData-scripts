# 许可来源与核验证据

核验日期：2026-10-31。这里只记录实际找到的证据；“历史参考版本”不等于原作者当时实际使用的精确版本。

## 上游 ISC 声明

- 项目：[theBowja/GenshinData-scripts](https://github.com/theBowja/GenshinData-scripts)。
- 本地历史中首次引入 `license: "ISC"` 的提交：[5037aa46db244442aef2bbe34578e51575e04e25](https://github.com/theBowja/GenshinData-scripts/blob/5037aa46db244442aef2bbe34578e51575e04e25/package.json)，日期 2022-12-11，作者 theBowja。
- 初始提交 `12965ae26615586d25e9b474bdf13d83971f6c48` 的 package.json 尚无 license 字段；不能把初始版本无字段描述成当前版本也无许可声明。
- 核验时远端 main 为 [101b65b43a8cd2b82dec943d04ea75df9b815dd4](https://github.com/theBowja/GenshinData-scripts/blob/101b65b43a8cd2b82dec943d04ea75df9b815dd4/package.json)。已通过 GitHub API 读取该提交完整、未截断的递归文件树，未发现 LICENSE/LICENCE/COPYING 文件；本地可用历史也未找到这些文件。
- 当前采用分范围说明：组织有权授权的自行创作贡献为 MIT；原代码保留 ISC 来源声明，不将全部代码改标 MIT。ISC 标准条款的参考来源为 [Choose a License](https://choosealicense.com/licenses/isc/)。
- 待核实：原始版权声明、完整上游许可文件和各文件实际适用范围。所附参考文本不能声称是原作者发布的许可证，也不能代替对第三方移植代码的核实。

## 语音解析器：Razmoth / RazTools Audio

### 来源链

1. 本仓库引入语音提取器的提交：[4d54225e073d8faf8d0072baff234319622d2e0d](https://github.com/theBowja/GenshinData-scripts/commit/4d54225e073d8faf8d0072baff234319622d2e0d)，2024-02-19。
2. 上游 README 在 [ef44beeac19a7600e0dc3e9e440364613385b7b2](https://github.com/theBowja/GenshinData-scripts/blob/ef44beeac19a7600e0dc3e9e440364613385b7b2/README.md) 明确称其为 Razmoth/Audio 的部分 JavaScript 翻译。
3. 原署名项目现可在 [RazTools/Audio](https://github.com/RazTools/Audio) 找到。取移植日期之前的参考提交 [56da8d491fadf713a9c95d5936c764e6f0a52129](https://github.com/RazTools/Audio/tree/56da8d491fadf713a9c95d5936c764e6f0a52129)，日期 2024-01-22。
4. 该历史提交已附 [LICENSE.txt](https://github.com/RazTools/Audio/blob/56da8d491fadf713a9c95d5936c764e6f0a52129/LICENSE.txt)：MIT，`Copyright (c) 2023 Razmoth`，早于移植日期。许可证历史提交为 `2b04d309ebdd7d9a8fda14f4f1a84d636ea0b7f2` 与 `7791e65c970e1b9d725c441f15acdc78bc31f868`（2023-11-05）。

### 对应关系

| JavaScript | Audio 历史源码 | 核对内容 |
| --- | --- | --- |
| readPackage / readFolders | Audio/Models/Chunks/Package.cs | endian 标志、四种表长度、依次读表、文件夹基址及表后偏移 |
| readBanks / readSounds | Audio/Models/Entries/Bank.cs、Sound.cs | id、offsetMultiplier、size、offset 与 folder 的顺序及乘法 |
| readExternals | Audio/Models/Entries/External.cs | UInt64 id、UInt32 multiplier/size/offset/folder 的顺序及 External_ 命名 |
| readFolders 的 folder 字段 | Audio/Models/Entries/Folder.cs | offset/id、基址寻址的字符串；JS 的 UTF-16 查找方式不同，不声称逐字移植 |

确认“存在明确改编声明、相应历史解析结构、移植前已有 MIT 许可”后，已保留完整 Razmoth MIT 文本。原作者实际参考的精确提交没有记录，仍不能声称已查明；也不把该有限比对当成所有历史依赖的全量溯源。

## 外部 AnimeStudio

- 本机工具位置：`C:/Apps/AnimeStudio`。资源辅助程序通过外部路径引用其 DLL，不因此把 DLL 当成项目原创代码。
- 复制的是该安装目录根部现有 LICENSE，版权行原样保留：Radu 2016、Perfare 2016–2020、Razmoth 2022–2024、Escartem 2024–2026。
- 原项目参考：[Escartem/AnimeStudio](https://github.com/Escartem/AnimeStudio)。当前复制品证明本机随附了这份声明，不证明安装包精确构建提交或每个 DLL 的许可证。
- 尚未分发外部 DLL；未来若分发，需继续核对 MessagePack、ZstdSharp、其他本机库与实际部署文件的许可，不能只附根部 MIT。

## 许可副本完整性

以下 SHA-256 对原始内容将 CRLF 统一为 LF 后计算；副本仅统一换行/文件末尾换行，不改版权行及许可正文。

| 副本 | 来源 | SHA-256 |
| --- | --- | --- |
| LICENSES/MIT-Inteyvat-Wiki.txt | 现有 wiki-data/LICENSE，组织自行创作贡献的 MIT 范本 | `839a8770d03b823b1b6c3d7f8aa8f8995c4829954a61ec7143948466dac74cec` |
| LICENSES/MIT-Razmoth-Audio.txt | Audio 上述历史提交的 LICENSE.txt | `f12ff8106b197cf652dfb425cec04ba1b267d0ec86ed31984d325a5932680564` |
| LICENSES/MIT-AnimeStudio.txt | 本机 AnimeStudio/LICENSE | `e6a2268c715fce13cdf0979786c51d152b3e67d32a99a67dbbeb592c64d37e29` |

包信息的 `SEE LICENSE IN LICENSE` 指向根部范围说明，不表示已确认的 ISC 来源证据消失，也不表示所有文件都可任选 MIT 或 ISC。发布包应保留 LICENSE、LICENSES、NOTICES 和此溯源记录；本轮未执行 npm 发布。
