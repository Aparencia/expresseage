# docs/README.md · 机制文档地图（≤35 行）
> 本文件回答一件事：**要找的东西在哪**。找不到就先查这里，再决定新建 —— 禁止平行新建（AGENTS §2.2）。

## 三层读取节奏（按 token 成本分层，别一层层全读）
1. **常驻层（每会话必读）**：`AGENTS.md`（宪法）、`STATE.md`（状态仪表盘）。
2. **现行状态层（按需查，改动前必查）**：`docs/registry/`（`COMPONENTS.md` 界面元素｜`DATA_DICT.md` 键与字段｜`APIS.md` 模块函数与错误码）、`docs/TECH_DEBT.md`（欠账与被否方案）、`docs/pool/IDEAS.md`（想法池）、`.tool-versions`（环境口径）、`docs/privacy/`（**用户可见**的隐私文案草案 + 发布前填写清单；发布前必读，TD-020）。
3. **留存历史层（归档后不读，按症状检索）**：`docs/specs/`（一个任务一个目录：RESEARCH / SCOPE / DESIGN / VERIFY）、`docs/reviews/`（CODE_*.md 审查报告）、`docs/decisions/`（IDEA_* / STACK_*）、`docs/lessons/`（教训卡，按症状找）、`docs/versions/`（版本文档，41 卡产出）、`docs/archive/`（40 卡归档快照）。

## 数字口径（教训卡 `2026-09-24_散文里写实测数字.md`）
本目录的文档**不写实测数字**（行数 / 文件数 / 断言条数 / 门禁项数），只写取数命令：
`node tools/check.js` ｜ `node tools/selftest.js` ｜ `powershell -File check.ps1` ｜ `powershell -File gate.ps1 -Anchor <锚点> -ScopeFiles <本批> -Estimate <预估>` ｜ `git diff --shortstat <锚点>`。

## 机械闸在哪（"完成"只认它们的退出码）
`check.ps1`（收工仪式：`check.js` + `selftest.js`，退出码 0 才算完成）｜`gate.ps1`（锚点 / 范围 / 行数 / lockfile，0=绿 1=红 2=黄）｜`doctor.ps1`（环境自检）｜审查判据清单在 `check.ps1` 头部注释与 `tools/check.js` 内逐条列名。

## 防膨胀（40 卡执行，平时不用记）
`specs/` 超 30 天未动提示归档；`lessons/`、`decisions/` 超 30 张时最旧且 90 天无引用的移入 `archive/`；`COMPONENTS.md` **每个应用页面 ≤30 行**；`README.md` / `ARCHITECTURE.md` / `RUNBOOK.md` 定期做过期检查（启动命令还跑得通吗？模块图与目录一致吗？`.env` 键都有解释吗？）。

## 登记在案的口径差异（防下一个人照 V6 模板对齐时踩空）
- **registry 列头**：v2 是自定 6 列版式（`组件/元素｜用户口语指代｜所在页｜类名｜备注｜最近确认`），V6 契约的列集合是它的超集但缺「文件 / 搜索词 / 影响面」三列 ⇒ 已裁「**补列不重写**」（见 `docs/specs/20260925_v6_align/`）。✅ **批 3 已完成**：`COMPONENTS.md` 追加 `文件/搜索词/影响面` 三列（32 行逐行填、`文件` 全部 `Test-Path` 为真、`搜索词` 真 `grep` 命中）；`DATA_DICT.md` 补「`表` 列由分区标题表达」的口径说明；`APIS.md` §1 列序对齐契约、§2 补列口径映射（`函数`≈`路径`、`失败码`≈`错误码`）。三处都是**保留 v2 现有列**的超集。
- **条件文档**：`PRIVACY.md` 已按 D3 字段触发出具；`USER_GUIDE` / `LICENSE` / `openapi.yaml` 未触发（发布与对外接口都还没到，见 `RUNBOOK.md §6`）。
- **`chatRoomId` 语义**：自 `pick_friend` 起该字段存**本地摘要键**（不可逆），不是平台原值；类型与形态闸未变，敏感度保守仍按 D3（详见 `docs/specs/20260925_pick_friend/DESIGN.md §2`）。
