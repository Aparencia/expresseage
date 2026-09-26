# VERIFY · V6 口径补缺（规格目录 `20260925_v6_align`）

> 25 卡产物：每条 = 可复现命令 + **真实读数**；⛔ 没跑过的一律写"未验"（教训卡 `2026-09-25_自述范围大于diff.md`）。
> 档位 M（用户已绿）｜范围见同目录 `SCOPE.md`（Must 10 / Won't 7 / 验收 V1~V8）

## 交付面（提交 → 面）
| 提交 | 交付 |
| :-- | :-- |
| `c69bda7` | 批 1：`gate.ps1`（锚点/范围/行数/lockfile）＋ `RESEARCH.md`/`SCOPE.md` |
| `89c97db` | 批 2：`docs/README.md`（机制地图）＋ `docs/RUNBOOK.md` ＋ `docs/PRIVACY.md` ＋ `docs/versions|archive` 占位 |
| `34c69be` | `AGENTS.md §0/§10` 陈旧自述订正 |
| `84686b8` | gate 行数语义（只判本批越线）＋ 教训卡《并行写同一工作树…》 |
| `c35d202` | 批 3+4：registry 三件套补列对齐 ＋ `gate.ps1` 进 `check.js` 骨架/BOM 名单 ＋ `STATE` 补体检计数/并行任务 C |
| `1c3eec0` | 批 3 收口：COMPONENTS 两格搜索词改纯字面量 ＋ 教训卡《PowerShell 的 Split…》 |

## 验收读数（V1~V7）
| # | 验收标准（SCOPE §6） | 实测 |
| :-- | :-- | :-- |
| **V1** | `powershell -File check.ps1` 退出码 0 | ✅ 末行"全部通过（退出码 0）：完成声明成立。"，`CHECK_EXIT=0` |
| **V2** | `selftest` 断言数不降 | ✅ "断言 **337** 条：通过 337，失败 0"（本次批的上限是"不低于 288"） |
| **V3** | `gate.ps1` 在本批范围内判绿 | ✅ 提交后跑 `-Anchor c35d202 -ScopeFiles 'docs/registry/,docs/lessons/,docs/README.md,tools/check.js,STATE.md' -Estimate 300` ⇒ **绿 exit 0**（2 文件全在范围内） |
| **V4** | 变异证伪：四种路径都能被打到 | ✅（副本内，真实树未动）越界 ⇒ **红 9 项**；锚点前已超 ⇒ **黄**；本批越线（给 `reason.js` 灌 520 行）⇒ **红**；干净树 + 给 `-Estimate` ⇒ **绿 exit 0** |
| **V5** | 母版 `_qc/check.ps1:53-63` 的 17 文件 + 6 目录全在 | ✅ "应存在 23 项；缺失 **0** 项（全真）" |
| **V6** | `docs/README.md` 里每条路径 `Test-Path` 为真 | ✅ 逐条落实 19 条"裸名/相对名"（如 `COMPONENTS.md`→`docs/registry/…`、`specs/`→`docs/specs`）**全真**；3 条 grep 误报（表头散文、`（写盘异常）/`、存储键名）人工排除。⛔ 机械化版本 = SCOPE C1 的 `tools/v6-contract.js`，**未写**（Could 档） |
| **V7** | `PRIVACY.md` 的 D3 清单与 `DATA_DICT` 敏感度列逐条对得上 | ✅ 两侧 **7/7 一致**：`building`/`dorm`/`name`/`note`/`chatRoomId`/`pickupCode`/`trackingTail`；存储键那一行（`ex_college_v2.store`）由 `PRIVACY §3` 覆盖 |

## 顺手修掉的三处门禁缺陷（都在本批内，已带实测）
1. 体量判据用 `锚点..HEAD` ⇒ 漏未提交改动（实测"体量 0 行"）⇒ 改用 `git diff --numstat 锚点`（锚点 vs 工作树）。
2. 行数判据对"本批越线"与"锚点前已超"一视同仁 ⇒ 改成只判前者为红、后者为黄（TD-001 不再堵批）。
3. 三处 git 取路径漏 `core.quotepath=false` ⇒ 中文名路径被转义 ⇒ 范围判据假红、`Test-Path` 抛 `Illegal characters` 并**在汇总前终止**（看起来像红）⇒ 全部加 flag + `-ErrorAction SilentlyContinue`。

## 未验与边界（诚实清单）
- **`tools/v6-contract.js` 未写**（SCOPE C1 = Could）：V5/V6 现在是**一次性脚本 + 人工核对**，没有常驻判据。
- **`docs/RUNBOOK.md §6 发布一节"未验证"**、`§7` 三条未验项：本项目从未发布、界面从未真机点过 —— 这是事实，不是缺陷。
- **`storage.js` 606 行**超 AGENTS §11.1（锚点前 522 即已超）⇒ 挂 TD-001，本批只记增量、**未拆**。
- 母版自身的缺口（`template/`、`_archive/V5`）**不属本项目**，本批不动。

## 结论与下一步
25 卡**通过**（V1~V7 全绿，V6 的机械化留给 C1）。下一步：**40 归档**（归档勾选属不可委托清单 = 人执行）→ 之后本项目 `体检计数` 才会从 0 开始累计（≥15 触发 43 卡）。
