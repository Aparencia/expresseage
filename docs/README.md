# v4 文档总览与索引（docs/README.md）

> **性质**：`docs/` 的唯一入口与全仓文档总览，**不是口径源、不是状态源**。与设计文档冲突时按 §1 权威顺序判定；状态与待办以根 `STATE.md` 为准。
> **建立**：2026-10-31 文档结构重整。原根 `README.md` 的「文档地图」与 `docs/V4_INTERIM_OVERVIEW.md` 的导航内容合并进本文件；后者已归档到 `docs/archive/overview/V4_INTERIM_OVERVIEW_2026-10-23.md`。
> **维护**：`docs/` 目录结构或文档职责变化时更新本文件（新增/移动/改名必须同步 §3、§10 与 `docs/engineering/V4_ENGINEERING.md` §9.1）。读数每批收口时由 Lead 校正，日常以 §7 命令实时输出为准。
> **盘点基准**：HEAD `78eaadf`（2026-10-30 隐私同意兜底收口）+ 2026-10-31 工作树实测。本文件只记录「快照日期 + 取数命令」，不把一次性读数当永久事实。

## 1. 权威顺序（冲突时谁说了算）

| 顺序 | 文件 | 管什么 | 冲突处理 |
| :-- | :-- | :-- | :-- |
| 1 | `docs/contract/V4_CONTRACT.md` | **唯一口径卡**：角色/术语/字段/编号/集合/状态机/页面地图/隐私/裁决索引 | 一切以它为准；改口径先改它 |
| 2 | `docs/contract/V4_DECISIONS.md` | 用户裁决留痕（D1~D42 原文、推荐与被否方案、代价、落点） | 解释 CONTRACT 的裁决来由 |
| 3 | `docs/data/V4_DATA_MODEL.md` | 集合/字段/索引/API 契约/编号生成/roomTag/安全规则/越权测试 | 字段细节以它为准，集合与动作名以 CONTRACT 为准 |
| 4 | `docs/engineering/V4_ARCHITECTURE.md` | 代码分层、写作用域 S0~S10、客户端/云函数冻结接口 | 结构接口以它为准 |
| 5 | `docs/engineering/V4_ENGINEERING.md` | 工程结构/云资源/测试策略/门禁/部署/批次技术拆分 | 工程规则以它为准 |
| 6 | `docs/ux/V4_UX_CUSTOMER.md` · `V4_UX_PARTNER.md` · `V4_UX_DEVELOPER.md` | 三端逐页交互、状态与验收清单 | 交互细节以 UX 为准，口径以 CONTRACT 为准 |
| 7 | `docs/delivery/V4_QA_CHECKLIST.md` · `V4_RUNBOOK.md` · `V4_REVIEW_MATERIALS.md` · `V4_V3_PARITY.md` | 人工点检、部署运维、提审材料、v3 对照 | 执行步骤以 RUNBOOK 为准；验收勾选只能由人做 |
| 8 | 根 `STATE.md` / `CHANGELOG.md` / `docs/governance/V4_TECH_DEBT.md` / `docs/governance/lessons/` | 唯一状态源 / 版本演进 / 欠账台账 / 踩坑卡 | 状态以 STATE 为准；欠账以台账为准 |
| 9 | `docs/contract/V4_REBUILD_SPEC.md` | **历史规格快照**（v1.0，2026-10-21）：产品/架构/权限/流程/批次/风险/裁决索引 | 与 CONTRACT 冲突处一律以 CONTRACT 为准（文内已加口径更新指针） |
| 附 | 根 `AGENTS.md` · `README.md` · `docs/privacy/` · `docs/archive/` | 仓库 agent 纪律 / 对外入口 / 隐私文本与发布前清单 / 历史归档 | 纪律以 AGENTS 为准；隐私对外文本以 privacy 定稿候选为准 |

## 2. 30 秒总览

**这是什么**：校园快递代取小程序 **v4**——顾客下单、兼职接单履约、开发者治理的三角色工具；数据存微信云开发，按角色隔离。**零金额口径**：程序只做下单、接单与取件信息整理，不承载任何交易环节；服务类型只表达「做什么」。

| 角色 | 入口 | 关键能力 | 边界 |
| :-- | :-- | :-- | :-- |
| 顾客 | `pages/launch` → `pages/customer/*`、`pkg-customer/*` | 隐私同意 → 头像/昵称 → 宿舍资料 → 顾客编号 → 绑定兼职 → 截图下单（AI 兜底）→ 跟踪进度 → 留言/确认/再次下单 → 分享 | 不能查询其他兼职；编号不可改 |
| 兼职 | `pages/partner/*`、`pkg-partner/*` | 邀请码激活 → 兼职编号 → 工作台取件清单（行内动作/批量/撤销）→ 客户档案/代客下单 → 单量统计与日报 → 转发 | 只能看到绑定自己的顾客与订单；不能绑定顾客 |
| 开发者 | `pkg-admin/*` | 邀请码生效控制、脱敏数据查看、兼职停启用、异常介入、全局配置、识别失败复核、只读视角、测试账号可写切换、审计 | 真实账号只读；后台仅异常介入一个写动作；默认脱敏 |

**做到哪**：工程侧批 0~14（含 2026-10-30 隐私同意兜底、2026-10-31 文档结构重整）已收口；四步门禁全绿（读数见 §7 命令，`STATE.md` §6n/§6o 留真实输出）。**还差什么**：真机点检、隐私 13 项填写与微信后台声明、审核提审、灰度与回滚演练——只能由用户执行，agent 不代做、不代勾（`STATE.md` §4/§5/§9）。

## 3. 文档地图（2026-10-31 重整后目录）

```text
docs/
├─ README.md                        本文件：文档总览与索引
├─ contract/                        口径与裁决（唯一事实源）
│  ├─ V4_CONTRACT.md
│  ├─ V4_DECISIONS.md
│  └─ V4_REBUILD_SPEC.md            历史规格快照（根 V4_REBUILD_SPEC.md 迁入）
├─ data/
│  └─ V4_DATA_MODEL.md
├─ engineering/
│  ├─ V4_ENGINEERING.md
│  ├─ V4_ARCHITECTURE.md            原 docs/ARCHITECTURE.md
│  └─ V4_FIXTURES.md
├─ ux/
│  ├─ V4_UX_CUSTOMER.md
│  ├─ V4_UX_PARTNER.md
│  └─ V4_UX_DEVELOPER.md
├─ delivery/                        执行、验收与提审
│  ├─ V4_QA_CHECKLIST.md            原 docs/QA_CHECKLIST.md
│  ├─ V4_RUNBOOK.md                 原 docs/RUNBOOK.md
│  ├─ V4_REVIEW_MATERIALS.md
│  └─ V4_V3_PARITY.md
├─ governance/                      治理台账
│  ├─ V4_TECH_DEBT.md               原 docs/TECH_DEBT.md
│  └─ lessons/                      踩坑卡（≤12 行/卡，先查重）
├─ privacy/                         隐私文本与发布前填写清单（保持原位置）
└─ archive/                         历史归档（仍留在 docs/ 内，保留门禁扫描覆盖）
   ├─ README.md                     归档索引
   ├─ overview/                     临时总览与历史快照
   ├─ research/                     研究与调研（2026-10-22 基线）
   └─ reviews/                      代码审查与反馈定位（含 _parts/）
```

| 分组 | 文档 | 职责 | 主要读者 |
| :-- | :-- | :-- | :-- |
| 口径 | `docs/contract/V4_CONTRACT.md` · `V4_DECISIONS.md` · `V4_REBUILD_SPEC.md` | 唯一口径、裁决留痕、历史规格 | 全体 agent、接手开发者、用户 |
| 数据 | `docs/data/V4_DATA_MODEL.md` | 字段/索引/API 契约/安全规则/越权负向测试 | 后端与云函数开发者 |
| 工程 | `docs/engineering/V4_ENGINEERING.md` · `V4_ARCHITECTURE.md` · `V4_FIXTURES.md` | 工程规则/门禁、分层与冻结接口、识别语料规范 | 全体 agent、接手开发者 |
| 交互 | `docs/ux/V4_UX_CUSTOMER.md` · `V4_UX_PARTNER.md` · `V4_UX_DEVELOPER.md` | 三端逐页规格与验收清单 | 前端开发者、点检人 |
| 交付 | `docs/delivery/V4_QA_CHECKLIST.md` · `V4_RUNBOOK.md` · `V4_REVIEW_MATERIALS.md` · `V4_V3_PARITY.md` | 人工点检、部署运维/灰度、提审材料、v3 对照 | 用户、提审准备者、运维 |
| 治理 | `docs/governance/V4_TECH_DEBT.md` · `lessons/` | 欠账台账、踩坑卡 | 全体 agent、Lead |
| 隐私 | `docs/privacy/隐私保护指引.md` · `发布前填写清单.md` · `补充文档.txt` | 定稿候选文本、发布前 13 项填写、微信后台补充文档 | 用户、提审准备者 |
| 状态 | 根 `STATE.md` · `CHANGELOG.md` · `AGENTS.md` · `README.md` | 唯一状态源、版本演进、agent 纪律、对外入口 | 全体 agent、用户 |
| 归档 | `docs/archive/**` | 历史总览/研究/审查（不作为现行口径） | 追溯者 |

## 4. 按角色阅读路径

- **用户（项目 owner）**：`README.md` → 本文件 §2 → `STATE.md` §4/§5/§9（待办与真机项）→ `docs/delivery/V4_RUNBOOK.md`（部署/灰度）→ `docs/delivery/V4_REVIEW_MATERIALS.md`（提审）→ `docs/privacy/`（填写 13 项）。
- **接手开发者（先看懂再改）**：`docs/contract/V4_CONTRACT.md` → `docs/engineering/V4_ARCHITECTURE.md` §1~§4 → `docs/engineering/V4_ENGINEERING.md` §2/§5/§7/§8 → `docs/data/V4_DATA_MODEL.md` §7 → 对应角色 `docs/ux/*`。
- **后端/云函数**：`docs/data/V4_DATA_MODEL.md` §2/§6/§7/§12 → `docs/contract/V4_CONTRACT.md` §4/§5/§5.3 → `docs/engineering/V4_ARCHITECTURE.md` §4。
- **前端**：`docs/ux/*` 逐页规格 → `docs/engineering/V4_ARCHITECTURE.md` §3 → `docs/ux/*` §验收清单 → `docs/delivery/V4_QA_CHECKLIST.md` 对应分区。
- **提审/合规**：`docs/delivery/V4_REVIEW_MATERIALS.md` §1 P0 清单 → `docs/privacy/发布前填写清单.md` → `docs/delivery/V4_QA_CHECKLIST.md` §P/§H → `docs/delivery/V4_RUNBOOK.md` §10。
- **门禁/维护**：`docs/engineering/V4_ENGINEERING.md` §8（判据）→ `tools/`（实现）→ `STATE.md` §6（真实证据串）→ 本文件 §8（文档卫生）。
- **排查历史问题**：`docs/delivery/V4_RUNBOOK.md` §11~§12 → `docs/governance/V4_TECH_DEBT.md` → `docs/governance/lessons/`（先查重）→ `docs/archive/reviews/`。

## 5. 逐份内容摘要（1~3 行/份）

### 5.1 口径与规格

| 文档 | 摘要 |
| :-- | :-- |
| `docs/contract/V4_CONTRACT.md` | 唯一口径卡 v1.3：角色与账号（含账号切换两模式）、术语与字段唯一拼写、14 集合摘要、订单状态机七态、action 表 81 动作与 13 错误码、31 页页面地图、权限矩阵、隐私与留存、裁决索引 D1~D42、写作纪律。门禁直接解析其 §4/§5.3/§7/§13 等章节。 |
| `docs/contract/V4_DECISIONS.md` | D1~D42 裁决台账：每条含用户原文留痕、推荐与被否方案、代价与落点；是理解「为什么这样设计」的第一手材料。 |
| `docs/contract/V4_REBUILD_SPEC.md` | 重建主规格（v1.0 / 2026-10-21）：产品定义、铁律、架构、角色权限、流程、批次验收、风险。**历史快照**：与 CONTRACT 冲突处按 CONTRACT，文内冲突点已加更新指针。 |

### 5.2 数据与工程

| 文档 | 摘要 |
| :-- | :-- |
| `docs/data/V4_DATA_MODEL.md` | 14 集合逐字段表、索引与分页路径、编号/roomTag/测试账号生成、云函数 API 契约（§7）、安全模型与 DTO 脱敏、留存与注销迁移、越权负向测试清单（§12）、验收清单（§14）。 |
| `docs/engineering/V4_ENGINEERING.md` | 工程规则源：仓库结构、云开发资源与 2 个云函数、配置约定、测试策略与实现级规定、门禁（check.ps1/check.js/check-docs/gate/doctor）、文档体系、部署 runbook、批 0~12 技术拆分、未取证风险（R#）、工程缺口（E#）。 |
| `docs/engineering/V4_ARCHITECTURE.md` | 代码分层与数据流、写作用域 S0~S10、客户端冻结接口（api/store/shared/utils/页面零件）、云函数冻结接口（router/中间件/dao/handlers）、编码协作纪律。 |
| `docs/engineering/V4_FIXTURES.md` | 识别层语料与指纹规范：与 v3 的承接、三条纪律、取数与复核命令、指纹登记格式、新增语料流程。**现状**：规范语料内联在 `tools/selftest-recognize.js`（含 sha256 指纹钉），`tools/fixtures/` 未建立。 |

### 5.3 交互（三端逐页规格）

| 文档 | 摘要 |
| :-- | :-- |
| `docs/ux/V4_UX_CUSTOMER.md` | 顾客端：首次旅程、信息架构、逐页规格、下单四步（截图/识别/AI 兜底/核对/预约备注）、七状态进度矩阵、绑定场景、隐私交互、异常路径、设计 token、可逐条点检的验收清单。 |
| `docs/ux/V4_UX_PARTNER.md` | 兼职端：邀请码旅程、工作台（取件清单）专章（四档动线/批量/撤销/轮询）、代客下单两路径、客户档案、单量统计与日报、绑定卡分享、切换会话表现、真机验收清单。 |
| `docs/ux/V4_UX_DEVELOPER.md` | 开发者后台 11 页逐页规格：邀请码生效控制、脱敏查看、账号切换（真实只读/测试可写）、识别失败复核（原图+补录/忽略）、审计、治理动作、安全隐私、验收清单 AC-D。 |

### 5.4 交付与验收

| 文档 | 摘要 |
| :-- | :-- |
| `docs/delivery/V4_QA_CHECKLIST.md` | 真机/双机/测试账号人工点检清单：A~Y 分区（账号准入、编号、绑定、下单、订单闭环、工作台、后台、只读视角、切换会话、识别兜底、隔离负向、隐私、发布收尾、批 11/12 增补）+ 证据模板 + 每批最小点检范围 + 取数命令 + 附录 E 条目索引。**人执行，agent 不代勾。** |
| `docs/delivery/V4_RUNBOOK.md` | 云环境（单环境）、首次部署顺序、云函数配置基线、数据库/存储要点、运行时配置、冒烟清单、灰度发布与回滚演练（§10）、故障排查、安全基线、本地 OCR 排查、待实测项、禁区。 |
| `docs/delivery/V4_REVIEW_MATERIALS.md` | 提审前置 P0 清单、三角色审核体验路径、审核说明模板、常见驳回点应对、证据留存表、与 QA_CHECKLIST 的交叉映射。 |
| `docs/delivery/V4_V3_PARITY.md` | v3→v4 页面/能力/教训对照验收表（等价/改进/新增/取舍不迁）、不迁项理由、剩余项汇总、用户勾选栏。**文档级对照 ≠ 真机验收。** |

### 5.5 治理、隐私与状态

| 文档 | 摘要 |
| :-- | :-- |
| `docs/governance/V4_TECH_DEBT.md` | 技术债台账 TD-###：已知偏差、待取证、临时方案、判据缺口；含状态/影响/计划/关闭依据。新条目只增不改语义，编号连续不复用。 |
| `docs/governance/lessons/` | 踩坑卡（≤12 行/卡，先查重）：每条=现象/根因/修法/判据固化，按日期命名。 |
| `docs/privacy/隐私保护指引.md` · `发布前填写清单.md` · `补充文档.txt` | 隐私文本定稿候选 v1.3（文本版本标签，`privacyVersion` 出厂 v4.0.0 不升版）；发布前 13 项用户填写；微信后台补充文档（端内全文派生物，随文本重新生成）。 |
| `STATE.md`（根） | **唯一状态源**：一句话状态、批次台账、用户待办、真机/实测项、收口证据（真实输出）、风险、最近更新、下一步。 |
| `CHANGELOG.md`（根） | 用户可见变更 + 工程细节两段，按 Keep a Changelog；条目可追溯到 CONTRACT §/D#、ENGINEERING §/E# 或提交哈希。 |
| `AGENTS.md`（根） | 仓库级 agent 纪律：口径优先级、分层铁律、写作用域与协作、编码文件纪律、测试与 DoD、提交回写、禁止清单、回报格式。 |
| `README.md`（根） | 对外入口：项目一句话、当前阶段与链接、零金额口径、文档入口、快速自证命令。 |

## 6. 代码结构对照（读代码前先看这节）

| 层 | 真实结构（2026-10-31 盘点） | 口径/文档对应 |
| :-- | :-- | :-- |
| 页面 | **31 页** = 主包 7（launch/role/customer home/orders/partner workbench/customers/profile）+ `pkg-customer` 6（bind/order-create/order-detail/pickup-list/messages/help）+ `pkg-partner` 7（activate/order-detail/create-on-behalf/customer-detail/service-settings/stats/messages）+ `pkg-admin` 11（overview/invite-codes/customers/customer-detail/partners/orders/order-detail/config/account-switch/messages/recognition-review） | `docs/contract/V4_CONTRACT.md` §7（`check-docs` #2 校验它 = `app.json`） |
| 组件/工具 | `components/` 16 套（含维护遮罩、切换条、测试角标、头像、空态/骨架等）+ 根 `custom-tab-bar/`；`api/` 唯一网络出口 + 10 个域模块 + upload/privacy/mode-guard；`store/` 内存快照；`shared/` 口径纯件；`utils/` 纯件（识别/OCR/编号/roomTag/头像/存储/隐私策略等） | `docs/engineering/V4_ARCHITECTURE.md` §3 |
| 云函数 | `cloudfunctions/api`（入口/router/app + 7 中间件 + db/dao + lib + 11 域 handlers）与 `cloudfunctions/cleanup`（13 个幂等 sweep + 独立 dao）；依赖只 `wx-server-sdk` | `docs/engineering/V4_ARCHITECTURE.md` §4、`V4_ENGINEERING.md` §4 |
| 数据 | 14 集合（users/customers/partners/bindings/orders/order_events/order_messages/invitation_codes/admin_view_sessions/counters/config/admin_audit/upload_tickets/recognition_failures）、13 错误码、16 审计枚举、81 动作（client 与 internal 分级） | `docs/contract/V4_CONTRACT.md` §4/§5.3、`docs/data/V4_DATA_MODEL.md` §1~§7 |
| 门禁 | `check.ps1`（4 步）→ `tools/check.js`（33 条）、`tools/check-docs.js`（10 条）、`tools/zero-money-scan.js`（3 范围）、`tools/selftest.js`（33 套断言）；另 `tools/mutation.ps1` 变异电池、`tools/sync-cloud-shared.js` 副本对帐、`gate.ps1` 范围/体量闸、`doctor.ps1` 环境体检 | `docs/engineering/V4_ENGINEERING.md` §8 |
| 分层铁律 | ①页面层零业务判据（不出现 `wx.cloud.*`/状态字符串字面量/编号或 roomTag 生成/随机数）；②客户端不直连数据库/存储；③云函数不出现 `db.collection`（只经 `db/dao.js`）；共享副本只由 `tools/sync-cloud-shared.js` 生成 | `docs/engineering/V4_ARCHITECTURE.md` §1~§4、根 `AGENTS.md` §2 |

## 7. 门禁与自证（取数命令）

```powershell
# 唯一「完成」定义：退出码 0 + 真实输出（四步；任一步非 0 即未完成）
powershell -File check.ps1

# 分步读数
node tools/check.js                 # 代码/配置门禁（通过 N 项；失败 M 项）
node tools/check-docs.js            # 设计文档门禁（10 条；汇总行必须存在）
node tools/zero-money-scan.js       # 零金额扫描（三范围；0 命中 + 白名单项数）
node tools/selftest.js              # 全部断言套件（运行 N 套；失败 0 套）

# 结构/口径取数
node -e "console.log(require('./tools/lib/project.js').ALL_PAGES.length)"   # 页面数
node -e "const a=require('./shared/actions.js');console.log(Object.keys(a.ACTION_MAP).length)"  # 动作数
node -e "const c=require('./shared/collections.js');console.log(c.ALL_COLLECTIONS.length)"      # 集合数
git ls-files '*.md' | wc -l                                                # 文档份数

# 部署/环境体检（真机与云控制台项只能用户执行）
powershell -File tools/doctor.ps1
```

> 纪律：没有汇总输出 = 读数作废；禁止用 SKIP/空集把退出码骗成 0；真机项只能用户点检（`docs/delivery/V4_QA_CHECKLIST.md`）；云环境部署与提审只能用户执行（`docs/delivery/V4_RUNBOOK.md`）。

## 8. 文档现状与维护

### 8.1 2026-10-31 整顿记录（本次已修）

- **结构**：docs 由平铺改为按职责分组（contract/data/engineering/ux/delivery/governance/privacy/archive）；根 `V4_REBUILD_SPEC.md` 迁入 `docs/contract/` 并标注历史快照；`ARCHITECTURE.md`→`V4_ARCHITECTURE.md`、`QA_CHECKLIST.md`→`V4_QA_CHECKLIST.md`、`RUNBOOK.md`→`V4_RUNBOOK.md`、`TECH_DEBT.md`→`V4_TECH_DEBT.md` 统一前缀；`docs/lessons/` 归入 `docs/governance/lessons/`；research/reviews 归入 `docs/archive/`。
- **合并**：根 README 的文档地图 + `V4_INTERIM_OVERVIEW.md` 的导航内容 → 本文件；临时总览归档，不再单独维护。
- **门禁联动**：`tools/lib/project.js` 的 DESIGN_DOCS、`tools/check-docs.js` 的文档路径、4 个读取文档内容的 selftest 套件、`tools/zero-money-allowlist.json` 的文件字段与整行原文同步更新；门禁判据未弱化（check-docs 仍 10 条、校验章节未变）。
- **内容校正（漂移清理）**：裁决范围统一 D1~D42；旧拆单/旧页数（30→31）/旧截图张数/旧阈值等过时表述按现行口径回写；隐私补充文档中的真实联系方式改为占位符；STATE 头部快照与内部矛盾（D22 改判、部署状态）对齐；TECH_DEBT 补 TD-067 与文档治理欠账。
- **收口提交**：内容漂移修正 `c43bd02`、结构重整 `b9d966a`、证据回填 `7685936`（`git log --oneline -3` 可查；门禁读数见 `STATE.md` §6o）。

### 8.2 仍开放（已登记台账，本轮不改）

- 文档数字/快照漂移没有门禁判据（只有取数纪律）——见 `docs/governance/V4_TECH_DEBT.md` TD-078。
- check-docs 两处结构盲点（DATA_MODEL §7 标题缺失会静默跳过、ENGINEERING §13 E13~E18 无定义仍放行）——见同台账 TD-079。
- 三份文档的批次台账/风险表仍有部分历史快照文字；最新状态以 `STATE.md` 为准。
- 三份 UX 验收清单与 QA 清单存在双轨描述；执行以 QA 为准（UX 侧已标注）。

### 8.3 文档卫生规则（新增文档时必须遵守）

1. **登记**：新增/移动/改名文档 → 同步本文件 §3/§5、`docs/engineering/V4_ENGINEERING.md` §9.1；若属于门禁必需文档 → 改 `tools/lib/project.js` DESIGN_DOCS（并跑 `check.ps1`）。
2. **单源**：同一事实只在一处定义，其他文档引用 §/D#（CONTRACT 编号）而非复述；数字给取数命令、不写死。
3. **编码**：UTF-8 无 BOM、纯 LF、文件结尾单换行；`.ps1` 例外必须是 UTF-8 BOM（门禁 #7/#8）。
4. **禁词/占位**：不得新增费用或交易语义（词表唯一单源 `tools/zero-money-scan.js`）；不写未完成占位标记；待定事项用 `[D#]`/`[E#]`/`[R#]`/`P1`/`P2` 显式编号。
5. **归档**：历史文档只进 `docs/archive/`（仍在 `docs/` 内以保留门禁扫描覆盖），顶部标注「已归档 + 日期 + 现行口径去哪看」；归档文档不作为验收证据。
6. **回写**：改动类型 → 必须同步的文档按 `docs/engineering/V4_ENGINEERING.md` §8.6 执行；版本写 CHANGELOG、状态写 STATE、欠账写 TECH_DEBT、踩坑写 lessons。

## 9. 归档索引（`docs/archive/`）

| 范围 | 内容 | 时效与用法 |
| :-- | :-- | :-- |
| `docs/archive/overview/` | `V4_INTERIM_OVERVIEW_2026-10-23.md`（临时总览 v1.3，2026-10-23/28 快照） | 已由本文件取代；仅用于追溯当时的进度/门禁读数。 |
| `docs/archive/research/` | `CONVENIENCE_2026-10-22.md`（便利性调研）、`LOCATION_2026-10-22.md` + `_v2`（D27 位置方案调研，**D27 仍待用户裁决**）、`PERFORMANCE_2026-10-22.md`（性能基线）、`_BRIEF.md`（调研简报） | 2026-10-22 基线；D27 未决前「不采集定位」口径不变。 |
| `docs/archive/reviews/` | `CODE_2026-10-22_v4-full.md` + `_parts/`（10 份分域审查）、`2026-10-28_USER_FEEDBACK_TRIAGE.md`（用户反馈定位报告） | 历史审查证据；P1×3 已修，M-03 无单独收口记录；反馈项多已由 c9af8cd / D37~D42 落地，遗留四项见 TECH_DEBT。 |
| `docs/governance/lessons/`（非归档，持续更新） | 28 张踩坑卡（2026-10-22 ~ 2026-10-30） | 按主题：口径/数据一致性、门禁与工具链、UI 与组件、平台能力（OCR/分享/编码）、清理与注销。新增前先查重。 |

> 归档原则：归档文档只保留历史价值，**不参与验收、不冒充现行口径**；归档目录留在 `docs/` 内，继续受 `check-docs` 与零金额扫描覆盖（移出 `docs/` 会退出扫描，属门禁假绿，禁止）。

## 10. 迁移映射（2026-10-31，供旧引用/旧提交追溯）

| 迁移前 | 迁移后 |
| :-- | :-- |
| `V4_REBUILD_SPEC.md`（根） | `docs/contract/V4_REBUILD_SPEC.md` |
| `docs/V4_CONTRACT.md` | `docs/contract/V4_CONTRACT.md` |
| `docs/V4_DECISIONS.md` | `docs/contract/V4_DECISIONS.md` |
| `docs/V4_DATA_MODEL.md` | `docs/data/V4_DATA_MODEL.md` |
| `docs/V4_ENGINEERING.md` | `docs/engineering/V4_ENGINEERING.md` |
| `docs/ARCHITECTURE.md` | `docs/engineering/V4_ARCHITECTURE.md` |
| `docs/V4_FIXTURES.md` | `docs/engineering/V4_FIXTURES.md` |
| `docs/V4_UX_CUSTOMER.md` / `V4_UX_PARTNER.md` / `V4_UX_DEVELOPER.md` | `docs/ux/` 下同名文件 |
| `docs/QA_CHECKLIST.md` | `docs/delivery/V4_QA_CHECKLIST.md` |
| `docs/RUNBOOK.md` | `docs/delivery/V4_RUNBOOK.md` |
| `docs/V4_REVIEW_MATERIALS.md` | `docs/delivery/V4_REVIEW_MATERIALS.md` |
| `docs/V4_V3_PARITY.md` | `docs/delivery/V4_V3_PARITY.md` |
| `docs/TECH_DEBT.md` | `docs/governance/V4_TECH_DEBT.md` |
| `docs/lessons/` | `docs/governance/lessons/` |
| `docs/V4_INTERIM_OVERVIEW.md` | `docs/archive/overview/V4_INTERIM_OVERVIEW_2026-10-23.md` |
| `docs/research/` | `docs/archive/research/` |
| `docs/reviews/` | `docs/archive/reviews/` |
| 根 `README.md` 文档地图 | 本文件 §3~§5（根 README 只保留入口与链接） |

> 历史提交/归档审查中的旧路径与行号是当时快照；追溯以 `git log --follow` 为准。

## 11. 版本记录

| 版本 | 日期 | 变更 |
| :-- | :-- | :-- |
| v1.0 | 2026-10-31 | 建立：docs 结构重整后的唯一入口与总览，合并原根 README 文档地图与临时总览；补代码结构对照、门禁取数、文档卫生规则、归档索引与迁移映射。 |
