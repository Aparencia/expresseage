# v4 临时总体说明（Interim Overview）

> **性质**：临时总览，**不是**最终交付文档，也不替代任何口径或状态文件。
> **生成/更新**：2026-10-22（Asia/Shanghai；**v0.4 = 云环境就绪（envId 回填）+ AI Key 就位后更新**）｜**依据**：`check.ps1` 四步全 PASS、`git ls-files` 565 件（回写提交见 `git log -1`）。
> **权威顺序**：口径 → `docs/V4_CONTRACT.md`；状态与待办 → `STATE.md`；工程规则 → `docs/V4_ENGINEERING.md`；接口与写作用域 → `docs/ARCHITECTURE.md`。本文只做汇总；如与上述文件冲突，以上述文件为准，并回报 Lead 修订本文。
> **维护**：每批收口或重大状态变化时更新，并在 §11 记版本；最终由《交付说明/运维手册》取代。
> **读者**：项目 owner（用户本人）、接手开发者、提审材料准备者。

## 0. 30 秒版

| 问题 | 一句话答案 |
| :-- | :-- |
| 这是什么 | 校园快递代取小程序 **v4**：顾客下单 + 兼职接单履约 + 开发者治理；微信云开发；**零金额**（只做信息与履约，不涉及任何交易语义） |
| 做到哪 | 批 0~9 的**工程侧（离线）全部收口**：30 页、2 个云函数、81 个动作、14 集合、28 套判据 4,151 条断言、门禁四步全绿；已提交，工作树干净 |
| 还差什么 | **真实云环境创建/部署、真机点检、隐私 13 项填写与微信后台声明、审核提审、灰度与回滚演练**——这些只能由你执行，Agent 不代做、不代勾 |
| 你现在做三件事 | ①控制台建 **14 集合/索引/安全规则** → 部署 `api`/`cleanup` → 配环境变量/触发器/存储权限（**云环境已建、envId 已回填、AI Key 已就位**）；②真机点检；③按 §7 推进隐私 → 提审 → 灰度（**D1~D22 已于 2026-10-22 全部裁决**） |
| 想先看效果 | 见**附录 B** 三角色最短体验路径（开发者工具/测试账号即可跑通） |

## 1. 项目是什么

### 1.1 一句话定位

v4 是面向**真实顾客**的校园快递代取小程序：顾客上传取件码截图下单，兼职在自己的「取件清单」里按驿站取件、送达，开发者做邀请码发放、数据查看、异常复核与账号治理。数据存微信云开发，按角色隔离；**程序只整理信息与推进履约，不介入任何交易环节**（用户硬口径 D5/D6）。

### 1.2 三个角色与关键能力

| 角色 | 入口 | 关键能力 | 明确边界 |
| :-- | :-- | :-- | :-- |
| 顾客 | `pages/launch` → `pages/customer/*`、`pkg-customer/*` | 隐私同意 → 微信头像/昵称 → 宿舍资料 → 顾客编号 → 绑定兼职 → 截图下单（AI 兜底）→ 跟踪进度 → 留言/确认/再次下单 | 不能查询其他兼职；不能主动换绑超过规则；编号不可改 |
| 兼职 | `pages/partner/*`、`pkg-partner/*` | 邀请码激活 → 兼职编号 → 工作台取件清单（行级动作/批量/撤销/5 秒撤）→ 客户档案/代客下单 → 单量统计与日报 | **不能绑定顾客**；只能看到绑定自己的顾客与订单；无交易类功能 |
| 开发者 | `pkg-admin/*` | 邀请码生效控制、脱敏数据查看、兼职停启用、异常介入取消、全局配置、识别失败复核、只读视角、测试账号可写切换、审计 | 真实账号**只读**；后台仅异常取消一个写动作；默认脱敏、不展示头像 |

### 1.3 用户硬口径（已定，实现不得自由发挥）

1. **零金额**：程序内不出现任何交易语义——不支付、不收费、不记账、不做代价计算与列表；服务只表达「做什么」。机器判据：`tools/zero-money-scan.js` 源码+页面+文档三范围扫描 0 命中（D5/D6）。
2. **绑定只能顾客发起**：兼职端没有任何绑定/代绑入口，只能分享绑定卡片邀请顾客自己绑定；代客下单不产生绑定（D20，门禁 #28）。
3. **双角色唯一编号**：顾客 `C-XXXX-XXXX`、兼职 `P-XXX-XXX`、开发者 `DEV-01…`；不可改、不复用、错前缀有专门提示（D15）。
4. **roomTag 恒大写**：按（兼职, 宿舍）绑定顺序分配 `A…Z/AA…`，展示如 `D4-522A`（D21）。
5. **头像/昵称最小可见**：昵称必填可改，头像可拒绝→默认头像；仅当前 ACTIVE 绑定的对方可见，解绑/停用/注销后不可见；后台不展示、分享卡片/通知不含（D19）。
6. **账号切换两模式**：真实账号切换=只读（黄条+服务端拒写+审计）；测试账号=可写（蓝条+`TEST` 角标，仅测试数据、不计统计、可清理），用于单机验收两端（D18）。
7. **识别失败兜底**：规则失败 → 服务端调 DeepSeek（只发去敏文本、≤8s、5 次/人/日、静默降级）；仍失败进复核队列，原图仅复核页 5 分钟临时 URL + 逐次审计 + 30 天保留（D16/D17）。
8. **隐私与注销**：资料存云端、按角色隔离、默认脱敏；顾客注销两阶段（申请即解绑+置已注销，下一轮清理匿名化/删文件，30 天物理删除）；兼职注销由后台关闭执行（匿名化+删头像+编号作废）（CONTRACT §11.4）。

### 1.4 明确不做（本期范围外）

- 任何交易/支付/记账/代价计算相关功能与字段；
- 地图路线规划、自动派单/抢单市场、多校区、评分评价（P2）、快递公司接口/电子面单；
- 真实账号的可写视角、应用内切换微信登录账号、真实账号与测试账号互绑/互下单；
- 客户端直连第三方 AI、原图直传第三方；
- v3 历史数据迁移（D11：v4 空库起，v3 仅只读参照）。

## 2. 当前进度

### 2.1 批次台账（工程侧）

| 批 | 名称 | 工程侧状态 | 代码提交 |
| :-- | :-- | :-- | :-- |
| 批 0 | 设计定稿与开工门 | 完成（CONTRACT v0.9、DATA_MODEL、三份 UX、ENGINEERING、DECISIONS、QA、ARCHITECTURE、隐私两件） | 文档提交 |
| 批 1 | 工程骨架与云端基础设施 | 完成并收口 | `d125b42` |
| 批 2 | 账号入口 + 切换会话/测试账号/头像采集 | 离线部分完成并收口 | `619f39a` |
| 批 3 | 绑定方向固化与服务配置 | 离线部分完成并收口 | `c5ad0af` |
| 批 4 | 顾客下单链路（建单引擎/AI 兜底/四步下单） | 离线部分完成并收口 | `a204ed1` |
| 批 5 | 顾客订单闭环（七态动作/轮询/时间线） | 离线部分完成并收口 | `7eac662` |
| 批 6 | 兼职工作台（取件清单/批量/撤销） | 离线部分完成并收口 | `5abf140` |
| 批 7 | 兼职客户档案与单量统计 | 离线部分完成并收口 | `d34e35b` |
| 批 8 | 开发者后台 + 消息通知 + 维护 + 隐私文本 | 离线部分完成并收口 | `08cd421` |
| 批 9 | 联调、合规与发布（注销链路判据/审核材料/v3 对照/灰度演练） | **离线部分完成并收口** | `81c58ba` |

> 收口纪律：每批以 `check.ps1` 真实输出 + `gate.ps1` 红 0/黄 0 为依据；证据串见 `STATE.md` §6、`CHANGELOG.md`。批 9 之后的三次收尾提交为 `ade2f6f`、`66eb96c`（证据回写与勘误）与本文提交。

### 2.2 用户侧阶段（裁决已闭环，执行未开始）

| 阶段 | 内容 | 状态 |
| :-- | :-- | :-- |
| 开工裁决 | D1~D22 全部裁决（D2 沿用 v3 appid；D8 东/西/南/北/翠苑；D13 个人主体+工具类目；D22=A） | ✅ 已闭环（2026-10-22） |
| 云环境 | 建**唯一云环境**（D1 修订：账号只能开 1 个，开发/体验/正式共用一库）、14 集合/索引/安全规则、环境变量、存储权限、定时触发器、部署 | **环境已建 + envId 已回填（2026-10-22）；集合/索引/规则/环境变量/触发器/部署未开始** |
| 真机与联调 | QA 附录 B 批 2~9 分区 + §H12~H17（双端/越权/隐私/弱网/后台/切换会话） | 未开始 |
| 隐私与提审 | 13 项填写、微信后台逐项声明、`privacyVersion` 定稿、审核材料与提审 | 未开始 |
| 灰度与回滚 | RUNBOOK §10：门禁回执、分批放量、观测判停、R1~R7 演练、§10.6 记录表 | 未开始 |
| 验收归档 | v3 对照表勾选、证据留存表 E1~E18 | 未开始 |

### 2.3 最近一次门禁读数（截至本快照）

| 命令 | 结果 |
| :-- | :-- |
| `powershell -File check.ps1` | **4 步全 PASS，退出码 0** |
| `node tools/check.js` | 通过 **31** 项；失败 0 项 |
| `node tools/check-docs.js --batch 1` | 通过 **10** 项；失败 0 项 |
| `node tools/zero-money-scan.js` | **0 命中**（白名单精确项 136） |
| `node tools/selftest.js` | **28 套 / 4,151 条断言全 PASS**，失败 0、SKIP 0 |
| `node tools/sync-cloud-shared.js --check` | 写 0/删 0/已一致 **32** 件；16 源 × 2 套 hash 对帐 OK |
| `powershell -File gate.ps1 -Anchor <批前HEAD> …` | 红色 **0** 项；黄色 **0** 项（退出码 0） |

## 3. 系统全貌

### 3.1 端侧（微信小程序，30 页）

| 包 | 页数 | 页面 |
| :-- | :-- | :-- |
| 主包 | 7 | `launch`（隐私闸/分流）、`role`（角色选择）、`customer/home`、`customer/orders`、`partner/workbench`、`partner/customers`、`profile`（我的） |
| `pkg-customer` | 5 | `bind`、`order-create`、`order-detail`、`messages`、`help` |
| `pkg-partner` | 7 | `activate`、`order-detail`、`create-on-behalf`、`customer-detail`、`service-settings`、`stats`、`messages` |
| `pkg-admin` | 11 | `overview`、`invite-codes`、`customers`、`customer-detail`、`partners`、`orders`、`order-detail`、`config`、`account-switch`、`messages`、`recognition-review` |

- 组件 **16 套**（含维护遮罩 `maintenance-mask`）+ 根 `custom-tab-bar/` + tabbar 资产。
- `api/`：`client.js` 唯一网络出口 + 10 个域模块 + `upload/privacy/mode-guard`；`store/` 内存快照；`shared/` 13 件口径纯件；`utils/` 9 件纯件（识别/OCR/编号/roomTag/头像/隐私策略/维护等）。
- 页面层零业务判据：不出现 `wx.cloud.*`、不直连数据库/存储、不拼状态字符串；写动作带 `expectedVersion` 乐观锁。

### 3.2 云端（微信云开发，2 个云函数）

- `cloudfunctions/api`：入口/router/app + **7 个中间件**（auth/audit/validate/idempotency/ratelimit/guard-bind/switch-session）+ `db/dao` + `lib`（编号/时间/事务/AI）+ **11 域 handlers**（user/customer/partner/bind/order/message/upload/config/admin/ai/health）。
- `cloudfunctions/cleanup`：独立 dao + **13 个幂等 sweep**（订单超时/截图与文件清理/识别失败留存/注销两阶段/测试账号与测试数据/会话过期/计数与统计等），10 分钟定时触发器。
- **14 个集合**：`users`、`customers`、`partners`、`bindings`、`orders`、`order_events`、`order_messages`、`invitation_codes`、`admin_view_sessions`、`counters`、`config`、`admin_audit`、`upload_tickets`、`recognition_failures`。
- **81 个动作**（CONTRACT §5.3 与 `shared/actions.js` 同源）：user 3 / customer 2 / partner 9 / bind 4 / order 19 / message 3 / upload 2 / config 1 / ai 1 / admin 23 / health 1 / cleanup 13。
- **13 个错误码**、**16 个审计枚举**，端/云/文档三端一致（`check.js #3/#4`、`check-docs #4/#10` 双向核对）。
- 云存储：`avatars/`（头像，全部角色通用按角色分目录）、`orders/`（取件码截图），私有读、服务端鉴权发 5 分钟临时 URL；不含 openid 的路径命名。
- 第三方：仅 DeepSeek 文本 API，Key 只在 `api` 环境变量；原图不出本程序云存储。

### 3.3 数据流与安全边界（一句话版）

页面 →（只经 `api/client.js`，带登录态与 `expectedVersion`）→ `api` 云函数（中间件鉴权/审计/幂等/限流）→ handlers → `db/dao` → 集合；文件走「本地校验/压缩 → `upload.prepare` 取票 → 云存储」；AI 只由服务端在规则失败后调用；所有敏感读写按角色与绑定关系在服务端判定，客户端不持有任何密钥、不直连数据库。

### 3.4 目录结构（顶层）

```
expressage_college_v4/
├─ pages/           主包 7 页
├─ pkg-customer/    顾客分包 5 页
├─ pkg-partner/     兼职分包 7 页
├─ pkg-admin/       开发者后台分包 11 页
├─ components/      16 套组件
├─ api/             client 唯一出口 + 域模块 + upload/privacy
├─ store/           内存快照
├─ shared/          13 件口径纯件（集合/错误码/动作/审计/状态机/校验/配置/站点/苑/角色/格式/订单视图）
├─ utils/           9 件纯件（识别/OCR/编号/roomTag/头像/存储/隐私策略/视图）
├─ cloudfunctions/  api/ 与 cleanup/
├─ tools/           门禁/判据/变异/同步（check.js、check-docs、zero-money-scan、selftest、gate、mutation、doctor、sync）
├─ docs/            口径/设计/验收/操作文档 + lessons/
└─ 根配置与脚本     app.json/app.js/app.wxss/project.config.json/check.ps1/gate.ps1/doctor.ps1
```

### 3.5 分层铁律（写代码前必读）

以 `docs/ARCHITECTURE.md` §1~§4 为准，三条硬禁止：①页面层零业务判据（不出现 `wx.cloud.*`、状态字符串字面量、编号/roomTag 生成或随机数）；②客户端不得直连数据库/存储；③云函数不出现 `db.collection`（只经 `db/dao.js`）。共享副本 `cloudfunctions/*/shared/**` 只由 `node tools/sync-cloud-shared.js` 生成，禁止手写。

## 4. 质量证据：凭什么说「工程侧收口」

### 4.1 判据规模（`node tools/selftest.js`，28 套 4,151 条）

| 分组 | 套件（断言数） |
| :-- | :-- |
| 底座 | core 58、state 341、recognize 187 |
| 身份/绑定/会话 | cloud 168、bind 79、bind-cloud 108、profile 98、switch 140、testaccount 153 |
| 订单（顾客/兼职/详情/生命周期） | order 126、order-flow 135、order-lifecycle 98、order-customer 190、order-partner 127、order-workbench 197、order-detail-partner 153 |
| 兼职客户/统计 | partner-customers 120、partner-orders 89、partner-pages 156、partner-stats 203 |
| 后台/消息/清理/隐私 | admin 220、messages 89、cleanup 183、admin-pages 145、message-pages 138、privacy-text 164 |
| AI 兜底 | ai 197 |
| 注销/数据删除 | deletion 89 |

### 4.2 判据有牙与一致性

- **变异电池**：`tools/mutation.ps1` 对安全面判据做「注入变异 → 首红 → SHA256 逐字节还原 → 复跑绿」；批 2/3/5/6/7/8/9 均有首红证据（门禁 #28~#31 与各新判据）。
- **双副本对帐**：`shared/**` → `cloudfunctions/*/shared/**` 由同步脚本生成并 hash 对帐（32 件一致）。
- **门禁/提交纪律**：每批 `check.ps1` 四步 + `gate.ps1`（锚点/范围/行数/lockfile/体量/提交信息）+ `doctor.ps1`；没有真实汇总输出不写「完成」。
- **数字不写死**：本文所有计数均可由文末 §9 的命令复跑核对；口径见 CONTRACT §14 第 4 条。

### 4.3 证据边界（重要）

以上全部是**离线证据**：云函数未在真实云环境部署运行，fake DB 与真实云在事务/唯一索引冲突/分页/时间类型上可能有差异（TD-015、TD-033）；真机项（头像能力、识别吐字、存储规则、性能与弱网）**尚未点检**。因此结论只能写「工程侧收口」，不能写「可发布」。

## 5. 文档地图（37 份 Markdown，按用途分三组）

> 完整清单：`git ls-files -- '*.md'`。文档冲突一律以 CONTRACT 为准；状态一律以 `STATE.md` 为准。

| 组 | 文档 | 用途 |
| :-- | :-- | :-- |
| 口径与设计 | `docs/V4_CONTRACT.md` | **唯一口径卡 v0.9**：角色/术语/编号/集合/状态机/页面地图/隐私/裁决索引 |
| | `V4_REBUILD_SPEC.md`（根） | 主规格书：产品/架构/权限/流程/批次/验收/风险/裁决 |
| | `docs/V4_DECISIONS.md` | D1~D22 裁决清单（含推荐、代价、被否方案、落点） |
| | `docs/V4_DATA_MODEL.md` | 集合/字段/索引/云函数 API 契约/编号/roomTag/头像/测试账号/识别失败队列/安全规则 |
| | `docs/V4_UX_CUSTOMER.md` · `V4_UX_PARTNER.md` · `V4_UX_DEVELOPER.md` | 三端逐页交互与验收 |
| | `docs/ARCHITECTURE.md` | 代码分层、冻结接口、S0~S10 写作用域 |
| | `docs/V4_ENGINEERING.md` | 工程结构/云资源/测试与门禁/部署 runbook/批 0~9 技术拆分 |
| | `docs/V4_FIXTURES.md` | 识别测试语料与判据夹具 |
| 执行与验收 | `docs/QA_CHECKLIST.md` | 真机/双机/测试账号人工点检清单（**255 条**；agent 不代勾） |
| | `docs/RUNBOOK.md` | 云环境搭建、部署、冒烟、隐私版本、灰度发布与回滚演练（§10） |
| | `docs/V4_REVIEW_MATERIALS.md` | 提审前置 P0 清单、三角色体验路径、审核说明模板、驳回应对、证据留存 |
| | `docs/V4_V3_PARITY.md` | v3→v4 功能对照验收表与用户勾选栏 |
| | `docs/privacy/隐私保护指引.md` · `发布前填写清单.md` | 隐私文本定稿候选 v1.0 + 13 项发布前填写清单 |
| 状态与记录 | `STATE.md`（根） | **唯一状态源**：批次台账、用户待办、真机项、收口证据、风险 |
| | `CHANGELOG.md`（根） | 用户可见变更 + 工程细节（按批） |
| | `docs/TECH_DEBT.md` | 技术债台账 TD-001~TD-061（状态/影响/计划/来源，以台账为准） |
| | `docs/lessons/`（17 张卡） | 踩坑卡（≤12 行/卡，先查重再建） |
| | `AGENTS.md`（根） | 仓库级 agent 纪律（写作用域/口径优先级/提交约束） |

**建议读法**：只想知道项目到哪 → 本文；要开工/部署 → CONTRACT §13 → DECISIONS → RUNBOOK §1~§9；要改代码 → ARCHITECTURE §2~§4 → ENGINEERING §5~§8；要提审 → REVIEW_MATERIALS → QA → privacy。

## 6. 裁决、欠账与未实测

### 6.1 22 条裁决的状态（2026-10-22 已全部闭环）

| 状态 | 条目 | 落地 |
| :-- | :-- | :-- |
| 开工门（4，已闭环） | D1 A 云开发；**D2 沿用 v3 appid `wxcb7e5b41b89bc806`**；D3 A 邀请码；D13 个人主体+工具类目 | `project.config.json` 已改；云环境待建；类目可选性提审前确认 |
| 用户新增（已定） | **D8 东苑/西苑/南苑/北苑/翠苑**（C=翠苑）；**D22 A**（上传失败必须先有截图） | `shared/zones.js` 默认值已改并同步云副本；UX §4.5 已限定 |
| 早前已定（4） | D5 服务只分类型、D6 零金额、D20 绑定只能顾客发起、D21 roomTag 大写 | 已关闭 |
| 按推荐确认（12） | D4、D7、D9、D10、D11、D12、D14、D15、D16、D17、D18、D19 | 无改动；按原设计执行 |

> 原文留痕与代价记录见 `docs/V4_DECISIONS.md` §0.1（含 D2 同 appid 的代价与 D13 提审风险）。

### 6.2 技术欠账（TD 台账：状态与条数以 `docs/TECH_DEBT.md` 为准）

下列为上线前最值得关注的一批（完整表见 `docs/TECH_DEBT.md`；TD-059~061 为 2026-10-22 隐私后台填报核查新增）：

| 编号 | 问题 | 当前处理 |
| :-- | :-- | :-- |
| TD-051 | 云存储「无主文件」无列举 API，无法自动清理 | 降级为每月控制台人工核对（RUNBOOK §7） |
| TD-053 | 兼职注销后 `partners.openid` 保留作身份锚点 | 文档已声明；P1 用标记位替代后再清 |
| TD-054 | `users.purgeAt` 未写入（功能按 `deletionRequestedAt` 正常） | 二选一收口，列 P1 |
| TD-055 | 兼职 CLOSED 治理链非事务 | 可重放收敛 + cleanup 兜底 |
| TD-033 | 真实云事务冲突码未核对 | 部署冒烟时核对（`lib/tx.js`） |
| TD-015 | fake DB 与真实云行为差异未对照 | 首次部署在唯一环境（测试账号）对照关键路径 |
| TD-040/043/044/050/057 | 历史量极大时计数/搜索/批量有扫描窗上限（如 500 单） | 已在文档声明降级；真实量级评估后再扩 DAO 窄口 |
| TD-038/034 | AI 配额计数时点、逐件兜底与每日配额关系 | 待产品确认；当前按实现锁定 |

### 6.3 未实测项（Agent 不能代验）

| 编号 | 内容 | 何时验 |
| :-- | :-- | :-- |
| E5 | 云存储安全规则可选项、三分包是否改独立分包 | 部署/真机 |
| E11 | DeepSeek 账号、条款、配额与用途确认 | 上线前（默认可关闭） |
| E12 | `chooseAvatar`/`nickname`/隐私弹窗/压缩上限真机能力 | 批 2 真机 |
| R2/R3 | 私有存储上传链路、VisionKit 真机吐字 | 批 1/批 4 真机 |
| R6 | 订阅消息模板审批（P1） | 上线后 |
| R9/R13/R12 | 校园运营/校方/驿站要求、云配额成本、QA 全部人检项 | 发布前 |

### 6.4 隐私收尾清单

- `docs/privacy/隐私保护指引.md` 为**定稿候选 v1.0（2026-10-22 剪贴板/后台口径校准）**，仅剩 **13 项**由你填写/确认（对外名称、联系方式（**邮箱为主**）、主体类目、备案、用户协议、微信后台逐项声明、DeepSeek 对外提供披露、头像昵称声明、账号切换说明、审计保留期、`privacyVersion` 最终值等）；变更通知方式已定为**小程序内公告/弹窗**。
- 微信后台「用户隐私保护指引」按官方模板逐项声明（**昵称、头像（同一项）/选中的照片或视频信息/摄像头/选中的文件/剪切板**；地址如后台提供则如实勾选；自开发无第三方 SDK 栏，DeepSeek 写用途/对外提供/补充文档）；`privacyVersion` 发布前一次性写入并与端内文本一致（RUNBOOK §3.8/§8、QA P20）。

## 7. 你（用户）的下一步（建议顺序）

| 步骤 | 你要做的事 | 产出/证据 | 参考 |
| :-- | :-- | :-- | :-- |
| ① 裁决 ✅ | 已于 2026-10-22 回复完毕：D1 A；D2 沿用 v3 appid `wxcb7e5b41b89bc806`；D3 A；D13 个人主体+工具类目；D8 东/西/南/北/翠苑；D22 A；其余按推荐 | 裁决留痕与代价记录（Lead 已回写 CONTRACT/DECISIONS/README/STATE 等） | `docs/V4_DECISIONS.md` §0.1 |
| ② 云环境 | ✅ 环境已建、envId 已回填、`doctor.ps1` 已无占位告警（2026-10-22）；**待做**：建 14 集合/索引/安全规则/存储权限；配 `ADMIN_OPENIDS` 与 `DEEPSEEK_API_KEY`（Key 已提供）；配 10 分钟触发器；部署 2 个云函数并冒烟 `health.check`/`admin.bootstrap` | RUNBOOK §3/§13 截图/配置清单 | `docs/RUNBOOK.md`、ENGINEERING §6.1 |
| ③ 冒烟与真机 | 按 RUNBOOK §9 冒烟；按 QA 附录 B 批 2~9 分区 + §H12~H17 双端点检（含越权、隐私、弱网、切换会话、注销链路） | QA 勾选记录 + 证据截图（表 E1~E18） | `docs/QA_CHECKLIST.md` |
| ④ 隐私与提审 | 填完 13 项；微信后台逐项声明；写入 `privacyVersion`；按 REVIEW_MATERIALS P0-1~P0-16 备料并提审 | 隐私文本定稿 + 后台声明截图 + 审核材料包 | `docs/V4_REVIEW_MATERIALS.md`、`docs/privacy/` |
| ⑤ 灰度与回滚 | 按 RUNBOOK §10 取门禁回执 → 分批放量 G0→G1→G2 → 观测判停 → 演练 R1/R3/R4/R5/R6 | §10.6 记录表（为空不得全量） | `docs/RUNBOOK.md` §10 |
| ⑥ 验收归档 | 勾选 `V4_V3_PARITY.md` 对照表；留存提审/发布/回滚证据；每月云存储人工核对 | 归档目录 + 记录表 | `docs/V4_V3_PARITY.md`、TECH_DEBT TD-051 |

> 纪律提醒：发布、提审、打 tag、删库、改云控制台、配环境变量/触发器/索引只能由你执行；Agent 只给步骤与证据要求。

## 8. 已知边界与风险

| 风险 | 说明 | 缓解 |
| :-- | :-- | :-- |
| 未连真实云 | 云函数只在 fake DB 单测过；事务冲突码/分页/时间类型可能有差异 | 首次部署在唯一环境跑冒烟（测试账号）+ TD-015/TD-033 对照一次 |
| 单环境无 staging | 账号只能开 1 个云环境（D1 修订）：开发/体验/正式共用一个库，上线后没有可随意试错的环境 | 测试账号/`isTest` 标记隔离 + 发布前「单环境清零」（RUNBOOK §10.2.1）+ 结构/数据变更前导出备份；将来可开第二环境时按 `config/env.js` 拆 dev/prod |
| 未真机 | 头像能力、VisionKit 吐字、存储规则、性能/弱网均未点检 | QA 附录 B 全量 + H12~H17 |
| 合规主体 | D13 已裁决个人主体+工具类目；类目可选性/审核仍可能不通过 | 提审前在后台确认类目可选 + 完成备案；驳回按 DECISIONS D13 顺序处理 |
| 第三方 AI | DeepSeek 可用性/条款/配额未确认（E11） | 默认关闭兜底开关，确认后再开（RUNBOOK） |
| 极端量近似 | 历史单/绑定超过扫描窗时计数与搜索偏小 | 文档已声明；真实量级评估后扩 DAO 窄口（TD-040/043/044/050/057） |
| 隐私最小化缺口 | `partners.openid` 保留、无主文件人工核对、`purgeAt` 空置 | TD-051/053/054，P1 收口；披露与留存已入隐私文本 |
| 单开发者账号 | MVP 建议 1 个开发者；邀请码/审计/白名单可扩展 | 运营上先单人治理，后续按 RUNBOOK 扩 `DEV-02…` |
| 轮询成本 | 顾客 10s、兼职 30s 轮询 + 10 分钟 cleanup | 上线后按控制台用量评估（TD-013/R13） |

## 9. 复跑与自证（不需要懂代码也能跑）

```powershell
# 在仓库根目录 D:\Code\expressage_college_v4 执行
powershell -File check.ps1          # 四步门禁：必须看到「全部通过（4 步，退出码 0）」
node tools/selftest.js              # 判据套件：应看到「运行 28 套；失败 0 套」与各套断言数
node tools/zero-money-scan.js       # 零金额扫描：应看到「0 命中（白名单 136 项）」
node tools/sync-cloud-shared.js --check  # 共享副本对帐：应看到「hash 对帐 OK（16 件 × 2 套）」
powershell -File tools/doctor.ps1   # 环境体检：envId 占位会告警（D1 未闭环的预期结果）
git log --oneline -5                # 当前提交历史
```

数字取数命令（避免手抄）：

```powershell
(git ls-files | Measure-Object).Count                                     # 跟踪文件数（当前快照 564）
(Select-String -Path docs\QA_CHECKLIST.md -Pattern '^\| [A-Z]+\d+ \|').Count  # QA 条目总数（255）
node -e "console.log(require('./tools/lib/project.js').ALL_PAGES.length)"    # 页面数（30）
node -e "const a=require('./shared/actions.js');console.log(Object.keys(a.ACTION_MAP).length)"  # 动作数（81）
node tools/selftest.js | Select-String '运行'                              # 套件与失败数
```

读法：任何一步非 0 → 「完成」不成立，按输出定位；`gate.ps1` 退出码 2 = 只有黄色告警，黄色不是绿。云函数真实运行结果只能在部署后由 RUNBOOK §9 冒烟给出。

## 10. 术语表

| 术语 | 含义 |
| :-- | :-- |
| C / P / DEV 编号 | 顾客/兼职/开发者唯一编号（D15），不可改、不复用 |
| roomTag | 同一兼职下同寝室顾客的大写区分标识（A…Z/AA…），展示如 `D4-522A` |
| binding | 顾客主动建立、指向某兼职的关系；决定双方可见范围 |
| guest 单 | 兼职为未绑定新顾客代下的单，`customerId=''`，顾客无访问路径 |
| 视角切换 / READONLY / TEST_WRITE | 开发者切到目标角色的两种会话：只读（真实账号）/可写（测试账号） |
| 测试账号 | 后台合成账号（无真实 openid），数据隔离、不计统计、可清理 |
| 单环境 / 单环境清零 | **D1 修订**：账号只能开 1 个云环境，开发/体验/正式共用一个库；靠测试账号 + `isTest` 标记隔离，发布前用 `purgeTestData` 等清零（RUNBOOK §10.2.1） |
| NEED_CODE / 补码 | 订单缺取件码或站点待补的状态与动作（顾客手填、兼职补码） |
| recognition_failures / 复核 | 识别失败队列；开发者在后台看原图、补录/忽略、通知上传者 |
| upload_tickets | 上传票据（一次性、短时有效），防止绕过服务端校验直接上传 |
| purge / 注销两阶段 | 申请即解绑+置已注销；下一轮清理匿名化/删文件；30 天物理删除 |
| sweep | `cleanup` 云函数里的幂等清理任务（一轮失败不影响其它任务） |
| 门禁四步 | check.js（代码/配置 31 条）→ check-docs（文档 10 条）→ 零金额扫描 → selftest（28 套断言） |
| 变异电池 | 故意注入缺陷验证判据会「红」，再逐字节还原并复跑绿 |
| gate 红/黄 | 红=失败（exit 1）；黄=告警（exit 2），黄不等于绿 |

## 11. 版本记录

| 版本 | 日期 | 变更 |
| :-- | :-- | :-- |
| v0.1 | 2026-10-22 | 初版：批 0~9 工程侧收口后的临时总览（进度/系统/门禁/文档地图/裁决与欠账/用户下一步/自证命令） |
| v0.2 | 2026-10-22 | 用户裁决回写：D1~D22 全部闭环（D2 沿用 v3 appid；D8 东/西/南/北/翠苑；D13 个人主体+工具类目；D22=A）；更新进度表/裁决表/下一步/风险；TD 关闭数更新为 19 |
| v0.3 | 2026-10-22 | **D1 单环境修订**：账号只能开 1 个云环境 → 三档同 envId；更新下一步②/进度表/风险（单环境无 staging）/术语表；发布前新增「单环境清零」步骤（RUNBOOK §10.2.1） |
| v0.4 | 2026-10-22 | **云环境就绪**：用户创建唯一环境 + envId 回填 `config/env.js`（doctor 占位告警转 PASS）；`DEEPSEEK_API_KEY` 已提供（只入云函数环境变量，仓库零落值）；更新 30 秒版/进度表/下一步②/风险；下一步=控制台资源与首部署冒烟 |

## 附录 A · 关键文件索引

| 你要找 | 文件 |
| :-- | :-- |
| 项目一句话与文档地图 | `README.md` |
| 口径与裁决索引 | `docs/V4_CONTRACT.md` §13、`docs/V4_DECISIONS.md` |
| 数据字段与接口契约 | `docs/V4_DATA_MODEL.md` §2/§6/§7 |
| 代码分层与冻结接口 | `docs/ARCHITECTURE.md` §2~§4 |
| 门禁与部署 | `docs/V4_ENGINEERING.md` §8/§10、`docs/RUNBOOK.md` |
| 真机点检 | `docs/QA_CHECKLIST.md` 附录 B |
| 提审材料 | `docs/V4_REVIEW_MATERIALS.md` |
| 隐私文本与填写 | `docs/privacy/` |
| 当前状态与待办 | `STATE.md` §4/§5/§6 |
| 技术债与教训 | `docs/TECH_DEBT.md`、`docs/lessons/` |
| 变更历史 | `CHANGELOG.md` |

## 附录 B · 三角色最短体验路径（自测/审核演示用）

1. **开发者**：微信登录 → 进入开发者后台 → 生成邀请码（记录批次）→ 创建测试账号（顾客/兼职各一）→ 切换测试账号顾客端。
2. **顾客（测试账号）**：完善宿舍资料 → 查看顾客编号 → 上传截图下单（或手填）→ 绑定兼职（用测试兼职编号）→ 订单列表/详情看进度。
3. **兼职（测试账号）**：激活（用邀请码）→ 工作台看到新单 → 接单/取件/送达 → 顾客端确认 → 统计页看单量。
4. **治理链路**：后台看脱敏列表 → 识别失败复核（若有）→ 邀请码作废 → 测试账号清理（`dryRun` 预览 → 执行）→ 审计记录核对。

> 体验路径细节与审核说明模板见 `docs/V4_REVIEW_MATERIALS.md` §2~§3；真机/双端点检见 `docs/QA_CHECKLIST.md`。
