# RESEARCH · V6 口径补缺（规格目录 `20260925_v6_align`）

> 任务：把 `expresseage_college_v2` 的项目骨架按 **V6 契约**补齐（用户裁决 = **不跑 12 接入卡**，走结构补缺批）。
> 调研方式：全只读扫描 + 既有门禁实跑，**未改任何业务代码**。
> 定档 **M**（>3 文件；不碰业务代码、不碰表结构、不新增依赖）｜预估改动 ≈475 行（暂停线 = ×1.5 ≈ 712 行）。

## 1. 现状扫描（命令 → 实测摘要）

| 命令（项目根跑） | 实测 |
| :-- | :-- |
| `git rev-parse HEAD` | `53a7d3bf54269fd6bf69e3533b908078e961df94` |
| `git status --short` | 空（工作树干净，无未提交改动） |
| `powershell -File check.ps1` | 退出码 **0**（`node tools/check.js` + `node tools/selftest.js` 两步全过） |
| `node tools/selftest.js` 末两行 | 断言 **288 条：通过 288，失败 0** |
| 文件行数（`Get-Content \| Measure-Object -Line`，不计空行） | README 28 ／ AGENTS 64 ／ STATE 81 ／ check.ps1 38 ／ doctor.ps1 27 ／ .env.example 9 ／ .gitignore 25 ／ CHANGELOG 22 ／ ARCHITECTURE 63 ／ TECH_DEBT 32 ／ COMPONENTS 35 ／ DATA_DICT 47 ／ APIS 105 ／ pool/IDEAS 5 |
| `docs/` 子目录存在性 | registry / pool / specs / decisions / reviews / lessons **在**；**versions、archive 不在** |
| `Select-String STATE.md -Pattern 体检计数` | **False**（该字段不存在） |

## 2. 缺口清单（契约来源可逐条回指）

| 契约项 | 契约来源 | v2 实测 | 判定 |
| :-- | :-- | :-- | :-- |
| `gate.ps1`（锚点/范围/行数/lockfile） | 母版 `_qc/check.ps1:53-54`（模板清单 + ≤70 行）+ `design/v6-design.md §4`「机械检查一律下沉 gate.ps1」 | 文件不存在 | ❌ 缺（STATE 未决 2 与 TD-003 自认"未建、用 `git diff` 手工替代"） |
| `docs/README.md`（机制文档地图 ≤35 行） | design §5「三层读取模型」 | 不存在 | ❌ 缺 |
| `docs/RUNBOOK.md`（≤80 行） | design §5 + `_qc/check.ps1:54` | 不存在；`.tool-versions:5` 与 `AGENTS.md §0` **两处都指向它** ⇒ 悬空引用 | ❌ 缺 |
| `docs/versions/`、`docs/archive/` | `_qc/check.ps1:61-63` | 均不存在 | ❌ 缺 |
| STATE 字段「体检计数」 | design §7（40 卡累计，≥15 触发 43 卡） | 无此字段 | ❌ 缺 |
| registry 三件套列头 | 12 卡动作 5 的列头契约 | COMPONENTS 缺「文件/搜索词/影响面」三列；DATA_DICT 用分区表表达「表」；APIS §1 列序与契约不同 | ⚠️ 口径差异（用户裁决：补列对齐） |
| `AGENTS.md §10` 自述 | 实测：门禁 33 项 + 自测已接回（M12） | 该行仍写"八条机械判据、行为自测尚未接回"（r2 的 R2-D10 判定须由人改） | ⚠️ 陈旧（用户已授权订正一行） |
| 条件文档 `PRIVACY` | design §5「条件文档（触发才建）…PRIVACY(D3D4 字段触发)」 | `DATA_DICT` 里 building/dorm/name/note/chatRoomId/pickupCode/trackingTail 共 7 个字段标 **D3**，无对应文档 | ⚠️ 触发成立（用户裁决：并进本批） |
| `docs/lessons/` 防膨胀线 | design §5：>30 张时淘汰最旧且 90 天无引用 | 28 张 | ⚠️ 逼近线，本批只登记（S1），不做淘汰 |

## 3. 方案对比

- **A 最小补缺**：只补 12 卡口径里缺的 5 件（`gate.ps1`、`docs/README.md`、`docs/RUNBOOK.md`、`docs/versions/`、`docs/archive/`）。
- **B = A + 用户裁决项（采纳）**：并入 registry 列头对齐（COMPONENTS 补三列）、`docs/PRIVACY.md`、STATE 补「体检计数」、`AGENTS §10` 陈旧行订正（用户明示授权）。
- **C 把 registry 三件套重写成契约版式并删掉 v2 的额外列**（**被否**）：会丢「空值语义／备注／状态／最近确认」等信息，且 r1~r4 报告里的列引用与行号会集体漂移。契约要的是列**集合**，v2 现状是超集但缺三列 ⇒ **补列**即可，不必重写。
- **D 顺手把母版 `template/`、`_archive/V5/` 也重建**（**被否**）：那是母版工作区自己的缺口（母版 `_qc/check.ps1` 实测 67 通过 / 24 失败），属另一个项目，本批出界。
- **E 把 V6 对帐做成常驻脚本 `tools/v6-contract.js`**（**降级为 Could，本期不写**）：一次性的对帐（SCOPE V5）已够；常驻脚本要自带判据与变异测试，属另一张卡。

## 4. 影响面（谁在什么时候用这批文件）

| 产物 | 谁用 | 用在哪一步 |
| :-- | :-- | :-- |
| `gate.ps1` | 23 卡 | 每批提交前后跑锚点/范围/行数/lockfile，替代人工念五查①④ |
| `docs/README.md` | 每个 agent 会话 | 三层读取模型的地图（"找不到先查再建，禁止平行新建"） |
| `docs/RUNBOOK.md` | 41 卡、故障排查 | 发布、回滚、数据处置、故障先看哪 |
| `docs/PRIVACY.md` | 41 卡、备案与隐私接口 | D3 字段清单与"只存本机"口径的唯一出处 |
| `docs/versions/`、`docs/archive/` | 41 卡、40 卡 | 版本详情与归档快照的落点 |
| STATE「体检计数」 | 00 卡、43 卡 | 累计 ≥15 触发流程体检 |
| registry 三列 | 50 卡（UI 改动）、24 卡 | 反查文件与影响面，不再靠记忆 |

## 5. 档位与 gate 形态

- 档位 **M**：>3 个文件；无依赖、无表结构、不碰业务代码；判据全部机械可验。
- 24 卡**不适用"人审替代车道"**：该车道前提是 M 档以下且 diff ≤150 行，本批预估 475 行 ⇒ 必须由**新鲜上下文审查者**独立核销（V6 design §4 gate 三形态）。
