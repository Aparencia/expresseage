# SCOPE · V6 口径补缺（规格目录 `20260925_v6_align`）

> 起点锚点：`53a7d3bf54269fd6bf69e3533b908078e961df94`｜档位 **M**｜预估改动 ≈475 行（暂停线 ×1.5 ≈ 712 行）
> 调研：`docs/specs/20260925_v6_align/RESEARCH.md`（缺口清单与方案对比）

## §1 Must（本期必须有，逐条带落点）

| # | Must | 落点 |
| :-- | :-- | :-- |
| M1 | 锚点门禁：锚点/范围/行数/lockfile 四件机械判定，红=1、黄=2、绿=0 | 新建 `gate.ps1`（≤70 行，UTF-8 带 BOM） |
| M2 | 机制文档地图：什么在哪／三层读取节奏／防膨胀／本批登记的口径差异 | 新建 `docs/README.md`（≤35 行） |
| M3 | 运维手册：启动、检查、数据处置、故障先看哪（无后端 ⇒ 部署一节写"人执行"口径） | 新建 `docs/RUNBOOK.md`（≤80 行） |
| M4 | D3 字段清单 + "只存本机" + 删除口径 | 新建 `docs/PRIVACY.md` |
| M5 | 版本详情与归档的落点目录（空目录进不了 git ⇒ 各放一行占位） | 新建 `docs/versions/.gitkeep`、`docs/archive/.gitkeep` |
| M6 | registry 列头对齐契约：COMPONENTS 补「文件／搜索词／影响面」三列（28 行逐行填真值）；DATA_DICT 登记「表」由分区表达；APIS §1 列序对齐契约 + §2 列口径映射 | `docs/registry/COMPONENTS.md`、`DATA_DICT.md`、`APIS.md` |
| M7 | STATE 回写：补「体检计数」字段、并行批标注、起点锚点、最近完成滚动 5 条、未决更新 | `STATE.md` |
| M8 | CHANGELOG「未发布」加一行 | `CHANGELOG.md` |
| M9 | `AGENTS.md §10` 陈旧行订正（用户明示授权；只改一行事实，不动其他条款） | `AGENTS.md` |
| M10 | 门禁回写：把 `gate.ps1` 纳入骨架必需文件与 BOM 清单（否则新脚本没有编码闸） | `tools/check.js`（2 处，只加文件名） |
| M11 | 本批产物：调研 + 范围 | `docs/specs/20260925_v6_align/{RESEARCH,SCOPE}.md` |

## §2 Should

- **S1** 在 `docs/README.md` 登记两条观察项：`docs/lessons/` 已 28 张（防膨胀线 30，淘汰需 43/40 卡裁决）；registry 列头差异与"补列不删列"的裁决留痕。

## §3 Could

- **C1** 把 V6 契约对帐（SCOPE V5）做成常驻脚本 `tools/v6-contract.js`。本期不写：一次性对帐够用，常驻判据要自带变异测试，另立卡。

## §4 Won't（本期明确不做 + 为什么）

- **W1 改任何业务代码**——本批只补骨架；扫描中发现的问题一律登记 `docs/TECH_DEBT.md`，不许顺手修（AGENTS §2.1）。
- **W2 改 `.tool-versions` 的 node 版本**——STATE 未决 6 等人裁；环境变更必须在归档回执里单独说明。
- **W3 把 registry 三件套重写成契约版式并删掉 v2 额外列**——会丢信息、旧报告引用集体漂移（RESEARCH §3-C）。
- **W4 动母版 `template/` 与 `_archive/V5/`**——属母版工作区自己的缺口（另一个项目）。
- **W5 增删 `tools/selftest.js` 断言**——无代码变更就不该动 `EXPECTED_ASSERTIONS`（现 288）；断言数只许因真实代码改动而变。
- **W6 补 `20260923_chat_pick` 的验收或归档**——那是未归档的在建任务（等 U-5/U-6/U-7 真机读数），本批与它并行但零文件重叠。

## §5 澄清问题与用户回答（原文引用）

| # | 问题 | 用户裁决原文 |
| :-- | :-- | :-- |
| ① | registry 三件套列头与 V6 契约不同怎么处理？ | 「按 V6 契约补「文件/搜索词/影响面」三列」 |
| ② | `AGENTS.md §10` 陈旧自述（宪法文件）怎么办？ | 「授权我改：把 §10 那句陈旧自述换成实测口径（推荐）」 |
| ③ | 与未归档的 chat_pick 怎么摆？ | 「并行：本批只新增文件 + 只改 STATE 非「下一步」字段（推荐）」 |
| ④ | `docs/PRIVACY.md` 要不要并进本批？ | 「并进本批：建 docs/PRIVACY.md（D3 字段清单 + 只存本机 + 删除口径）（推荐）」 |
| ⑤ | 范围裁决 | 「绿：按上述 Must 开批（含各题推荐项）」 |

## §6 验收标准（每条都是可观察行为）

| # | 打开哪 → 做什么 → 应看到什么 |
| :-- | :-- |
| V1 | 项目根 → `powershell -File check.ps1` → 退出码 **0**，末行"全部通过（退出码 0）：完成声明成立。" |
| V2 | 项目根 → `node tools/selftest.js \| Select-Object -Last 2` → "断言 288 条：通过 288，失败 0"（**不降**） |
| V3 | 项目根 → `powershell -File gate.ps1 -Anchor 53a7d3b -ScopeFiles <本批文件> -Estimate 475` → 退出码 **0**，输出含"范围检查…全部在本批 ScopeFiles 内" |
| V4 | **副本**里制造越界（把 `pages/pickup-list/index.js` 纳入变更、或从 `-ScopeFiles` 里摘掉一个真实变更文件）→ gate.ps1 判**红**（退出码 1）；把 `package.json` 挪进变更 → 判**黄**（退出码 2）。判据打不红 = 判据没牙（教训卡 `2026-09-17_变异不红的两种含义.md`） |
| V5 | 项目根 → 对母版 `_qc/check.ps1:53-63` 的 17 个模板文件 + 6 个 docs 子目录逐项 `Test-Path` → **全真** |
| V6 | 打开 `docs/README.md` → 其中提到的每条路径 `Test-Path` 为真（防悬空引用；`.tool-versions`/`AGENTS §0` 指 `RUNBOOK.md` 的两处引用同时消解） |
| V7 | 打开 `docs/PRIVACY.md` → 其 D3 字段清单与 `docs/registry/DATA_DICT.md` 敏感度列**逐条对得上**（不新增、不遗漏） |

## §7 UI 描述

N/A —— 本批无界面改动（W1）。

## §8 范围合规五查（24 卡会照此复核）

① 每条 Must 都有落点 ✓（§1 逐条）｜② 无 Could/Won't 混入 Must ✓｜③ Won't 清单本期零代码 ✓｜④ 验收 7 条全是可观察行为（命令 + 期望输出）✓｜⑤ 用户已逐条看过并回「绿」✓

## §9 预估与暂停线

新增 ≈200（spec 两件 + gate.ps1）+ ≈175（docs 三件 + 两个占位）+ ≈60（registry 列头）+ ≈40（回写四件）≈ **475 行** ⇒ ×1.5 = **712 行**，碰到即停（23 卡条件触发暂停）。
