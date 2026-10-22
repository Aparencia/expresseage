# STATE.md · v4 项目当前状态（唯一状态源）

> 口径版本：与 `docs/V4_CONTRACT.md` v0.9 同步。
> 维护人：lead（其他 agent 只回报状态变化，不直接改本文件；每批收口时由 Lead 统一更新）。
> 更新时机：每批开工/收口、用户裁决变化、风险新增或关闭、HEAD 变化需回读。
> 本文只记**状态、待办与下一步**，不重复设计口径（口径看 CONTRACT，工程规则看 ENGINEERING，接口看 ARCHITECTURE）。

**快照时间：2026-10-22（批 9 工程侧收口 + 用户裁决回写 + D1 单环境修订 + 云环境就绪回填）**
> 临时总体说明（全局汇总，非状态源）：[`docs/V4_INTERIM_OVERVIEW.md`](docs/V4_INTERIM_OVERVIEW.md)（2026-10-22 生成/更新 v0.4，依据 HEAD `91d158b` + 云环境回填；状态仍以本文件为准、口径以 CONTRACT 为准）。

## 1. 一句话状态

**批 0 设计定稿完成；批 1 工程骨架与云端基础设施完成并收口（`check.ps1` 4 步全 PASS、退出码 0）；批 2 账号入口/切换会话/测试账号/头像采集的离线部分完成并收口；批 3 绑定与服务配置的离线部分完成并收口；批 4 顾客下单链路的离线部分完成并收口；批 5 顾客订单闭环的离线部分完成并收口（**14 套 2,078 断言全 PASS**、`check.ps1` 退出码 0、check.js 31/31、check-docs 10/10、零金额 0 命中；新增 `selftest-order-lifecycle`（98）与 `selftest-order-customer`（190）；修 12 项真实 UX/契约缺陷：服务端 actions 矩阵缺 confirm/deleteRecord/reorder、终态可留言、listCustomer 无 counts、image 无 cleaned、补码事件不可区分、列表行四字段全空、详情轮询死 setInterval 无退避/无最近更新、页面本地猜按钮、写动作丢 expectedVersion、无再次下单、消息红点不归零、截图/异常/取消分支与回退提示缺失）；批 6 兼职工作台的离线部分完成并收口（**17 套 2,555 断言全 PASS**、`check.ps1` 退出码 0；新增 `selftest-order-partner`（127）、`selftest-order-workbench`（197）、`selftest-order-detail-partner`（153）；修 9 项真实缺陷：workbench 行 DTO 无 actions、batchActionId 静默丢弃、todayCompleted 100 截断探针、keyword 越窗漏单、CLOSED/SUSPENDED 可读工作台、DELIVERED 下发非法 correct、unmark 事件 undoneAction 写错、undo 残留 deliveryNote、DTO 空时间戳变假时间，另修 reject.OTHER 无备注静默通过）；批 7 兼职客户与运营的离线部分完成并收口（**21 套 3,132 断言全 PASS**、`check.ps1` 退出码 0；新增 `selftest-partner-customers`（129）、`selftest-partner-orders`（89）、`selftest-partner-pages`（156）、`selftest-partner-stats`（203）；修 10+ 项真实缺陷：解绑进行中单按兼职全量误拦、绑定列表按字符串序排列（D10 排 D4 前）、listBindings keyword/cursor/limit 全缺、activeOrderCount 混入 isTest、顾客详情用 keyword 冒充按顾客过滤、代客单只能 guest（绑定顾客单顾客不可见）、stats 客户端 4×100 累加近似（超 400 单偏小）、完成率分母 0 显示 0%、空数据画假柱、解绑/备注归属错误码 NOT_FOUND→FORBIDDEN，另修二选一入参静默缺省与重放侧别错判）。批 2/批 3/批 4/批 5/批 6/批 7/批 8 真机项与云环境验收待用户；**批 8 开发者后台 + 切换会话 + 通知 + 隐私文本的离线部分完成并收口**（`check.ps1` 4 步全 PASS、退出码 0；**27 套 4,062 断言全 PASS**；新增 6 套判据 `selftest-{admin,messages,cleanup,admin-pages,message-pages,privacy-text}`；修 30+ 项真实缺陷：TD-046 异常介入取消不可达（隐私闸/身份域两层根因）、维护闸误拦读、`admin.updateConfig` 白名单范围偏差、cleanup 全域运行必崩 + `image.cleanedAt` 未写 + 识别失败原图残留、后台 11 页无权限五态缺失/错误文案说假话/无效启用开关、消息中心公告双份难关/红点欠计/维护遮罩、端内隐私全文滞后；隐私文本升**定稿候选 v1.0**）。**批 9 联调、合规与发布的工程侧（离线部分）完成并收口**（`check.ps1` 4 步全 PASS、退出码 0；**28 套 4,151 断言全 PASS**；新增 `selftest-deletion` 89 断言端到端覆盖注销/数据删除链路，先判据后修 **14 条真实缺陷**：顾客注销阶段一漏清历史 `bindings.partnerNote`、识别失败原图引用未回收，兼职 CLOSED 未匿名化 `displayName/avatarFileId`/未删头像文件/未清 `invitation_codes.usedBy`/识别失败归属未清，治理链非事务与 `users.purgeAt` 空置等登记 TD-053~057；新建 **审核材料与提审体验路径手册** `docs/V4_REVIEW_MATERIALS.md`、**v3→v4 功能对照验收表** `docs/V4_V3_PARITY.md`；RUNBOOK §10 升级为**灰度发布与回滚演练**（分批/门禁回执/观测判停/R1~R7 演练/记录表），QA 批 9 专项 **H12~H17** 与 E15/P6/P18 注销链路强化，附录 E 计数 255；CONTRACT §11.4/DATA_MODEL §10 注销时点与 CLOSED 口径澄清）。**
**用户侧开工门已全部闭环（2026-10-22 用户回复，原文留痕见 `docs/V4_DECISIONS.md` §0.1）**：D1 A；**D2 沿用 v3 appid `wxcb7e5b41b89bc806`**（非推荐 A，代价见 DECISIONS D2 留痕）；D3 A；**D13 个人主体 + 工具类目**（提审风险见 D13 留痕）；**D8 东苑/西苑/南苑/北苑/翠苑**（默认值已进 `shared/zones.js`）；**D22 A**（保持必须先有截图）；其余 D4/D7/D9/D10/D11/D12/D14/D15/D16/D17/D18/D19 按推荐确认；D5/D6/D20/D21 早前已定。**D1 同日修订（2026-10-22）**：用户告知「云开发只能开通一个环境」⇒ **单环境方案**——develop/trial/release 三档同 envId（`config/env.js` 单 `ENV_ID`），开发/体验/正式共用一个库；隔离靠测试账号/`isTest` 标记 + 上线前「单环境清零」（RUNBOOK §10.2.1），风险见 §7 #24。**云环境已创建、envId 已回填 `config/env.js`（2026-10-22；值只在代码里，文档不落）；用户已提供 `DEEPSEEK_API_KEY`（只入 `api` 云函数环境变量，仓库零落值）**；控制台执行进行中（2026-10-22 用户已部署 `api` 并跑通真实调用；14 集合/索引/安全规则、`cleanup` 部署、`ADMIN_OPENIDS`、触发器、存储权限仍按 RUNBOOK §3 补齐）；**首跑暴露并已修复 P0 写库缺陷（§7 #25，待用户重新部署 `api` 后复验）**；**2026-10-22 真机反馈已修：进入测试顾客/兼职会话未按目标身份水合（页面显示「资料未完善/待激活」→ 误判无法激活、无法绑定）**——`utils/session.js` 统一进入/退出 bootstrap 水合 + store 保留本地票据（纯客户端，待用户重新编译复验）；真机项未点检。**批 9 用户侧未开始**：双端真机全场景/越权/隐私/性能/弱网、后台与切换会话回归面检、识别兜底与复核面检、隐私后台逐项声明与 13 项填写、`privacyVersion` 定稿写入、审核材料准备与提审、灰度观测与回滚演练（RUNBOOK §10.6 记录表）、v3 对照验收表用户勾选。

## 2. 批次台账

| 批 | 名称 | 状态 | 说明/证据 |
| :-- | :-- | :-- | :-- |
| 批 0 | 设计定稿与开工门 | **设计定稿完成（2026-10-21）** | CONTRACT v0.9、DATA_MODEL、三份 UX、ENGINEERING、DECISIONS、QA_CHECKLIST、ARCHITECTURE、`docs/privacy/` 两件均落盘；D18~D21 四次修订已回写；**用户侧开工门于 2026-10-22 全部闭环（D1/D2/D3/D13，见 §4）** |
| 批 1 | 工程骨架与云端基础设施 | **完成并收口（2026-10-21）** | 真实证据见 §6：`check.ps1` 退出码 0；`check.js` 31/31、`check-docs` 10/10、零金额 0、`selftest.js` 9 套 1,014 断言全 PASS；sync 16 源×2 套 hash 一致；提交与 gate 见 §7 收口记录 |
| 批 2 | 账号入口 + 切换会话/测试账号/头像采集 | **离线部分完成并收口（2026-10-22）** | 工程侧（代码/判据/文档）已收口（提交 `619f39a`）：5 个离线工作流见 §3b；9 套 selftest **1,279** 断言全 PASS、`check.ps1` 退出码 0；**真机项（E12 头像/昵称能力、切换条视觉、测试账号单机双端验收、开发者 entry）与云环境验收待用户** |
| 批 3 | 绑定与服务配置（绑定方向固化） | **离线部分完成并收口（2026-10-22）** | 工程侧（代码/判据/文档）已收口：绑定方向守卫/自绑/真实×测试拒绝、编号归一新探针与错前缀同源提示、roomTag 大写事务分配（含并发冲突有界重试）、换绑/换宿舍/解绑失联、getPublic 绑定前后头像边界、接单开关 `PARTNER_CLOSED`；新增 `tools/selftest-bind-cloud.js`；`tools/check.js` #28 去注释加固 + 变异首红（TD-031 关闭）；真实 bug 2 个；**真机绑定与换绑待用户** |
| 批 4 | 顾客下单链路 | **离线部分完成并收口（2026-10-22）** | 工程侧（代码/判据/文档）已收口（提交 `a204ed1`，17 文件 +3036/-442）：`order.create/createBatch` 建单引擎（严格入参白名单/逐单 `recognition.failureId` 回填/事务原子/`upload_tickets` 一次性）/上传票据与图片路径/`ai.parseParcel` 兜底（配额/票据/降级 DTO 10 键/入队字段）/四步下单端侧（`clientRequestId` 生命周期、逐件 AI 兜底、逐件预约备注、识别来源快照、识别原文/截图预览/服务类型说明）；新增 `selftest-order`（建单引擎）与 `selftest-order-flow`（端侧流程）两套；**真机项 D1~D12/R1~R4/M1~M3 待用户** |
| 批 5 | 顾客订单闭环 | **离线部分完成并收口（2026-10-22）** | 工程侧（代码/判据/文档）已收口（提交 `7eac662`，37 文件 +3189/-265）：服务端 `order.get` 七态顾客 `actions[]` 单源矩阵（cancel/confirm/deleteRecord/reorder/message；终态无 message）、`listCustomer` 三桶 `counts`、`image{hasImage,cleaned}`、`message.send` 终态闸、`imageUrl` cleaned 拒绝、`order.correct` 补码事件 note、写动作 `expectedVersion` 乐观锁（客户端 `api/client` 透传）；端侧列表 counts/等待倒计时、详情 10s 轮询+失败退避（20s→40s）+最近更新时间、进度异常/取消分支、时间线、截图四态、留言只读归档、再次下单（`?reorder=` 只预填服务类型/站点）、订单号复制、消息红点；新增 `selftest-order-lifecycle`（98）与 `selftest-order-customer`（190）；**真机项 QA E1~E8/E12~E18 与双机 T1~T13 待用户** |
| 批 6 | 兼职工作台 | **离线部分完成并收口（2026-10-22）** | 工程侧（代码/判据/文档）已收口：服务端 workbench 行内 `actions[]` 单源、`batchActionId` 落库+形态闸、完整订单号精确搜索、todayCompleted/keyword 窗口登记 TD、CLOSED/SUSPENDED 读写下线闸、`reject.OTHER` 必填备注、DELIVERED 动作矩阵去非法 correct、undo 清 `deliveryNote`、unmark 事件 `undoneAction` 口径、DTO 空时间戳假时间修复；端侧工作台行级动作/状态筛选服务端化/需查明与筛选空态/多选资格/部分失败保留重试/撤销条批量 id 与部分失败文案/counts 点击筛选/引导+兼职编号/已完结自然日分区/分页+行级 setData+骨架屏+tabBar 红点；详情页补码/异常/送达/凭证卡/只读收敛；新增 3 套判据（`order-partner` 127 / `order-workbench` 197 / `order-detail-partner` 153）；**真机项 QA F1~F15、F21、F23 待用户** |
| 批 7 | 兼职客户与运营 | **离线部分完成并收口（2026-10-22）** | 工程侧（代码/判据/文档）已收口（提交 `d34e35b`，48 文件 +7151/-1032）：服务端 `partner.listBindings` 服务端搜索（昵称/楼栋/宿舍/roomTag/尾号四位/编号）+ 自然序排序（`shared/zones.compareDormKey`，修 D10 排 D4 前）+ 游标分页 + 按顾客 `activeOrderCount`（含 isTest 隔离）；新增 `partner.getCustomer`（bindingId 反查档案/订单/解绑资格，不透传 openid）与 `partner.stats`（今日/本周/本月、完成/进行中/异常/取消、完成率 null、近 7 日 series、recent 日报源，一律排除测试数据）；`order.create/createBatch` 兼职路径 `bindingId`（绑定顾客，顾客可见进度）与 `guest`（新顾客，无顾客访问路径）显式互斥、均不写 bindings；`order.listPartner({view:'customer'})` 顾客维度历史单单一来源；`partner.unbindCustomer` 进行中单改按该顾客判定（修全量误拦）+ 归属 FORBIDDEN；`partner.saveCustomerNote` 归属/ACTIVE/≤100 加固；端侧客户列表（服务端搜索/分页/头像昵称/进行中数/分享卡/复制编号/新绑定刷新）、顾客详情（getCustomer 档案+解绑资格、listPartner view=customer 历史单按自然日分组与「查看更早」、备注仅自己可见、解绑原因必填+二次确认、本人兼职编号）、代客下单（两路径互斥、校验矩阵、幂等、逐条结果块、guest 提示、无任何绑定入口）、统计页（partner.stats 单源、三 tab、四格、7 日自绘柱不画假柱、日报复制、「今日完成」跳工作台参数）；新增 4 套判据（`partner-customers` 129 / `partner-orders` 89 / `partner-pages` 156 / `partner-stats` 203）；**真机项 QA F16/F18/F20/F22 与 stats 跨 tab 跳转、头像昵称互见、guest 单无顾客入口待用户** |
| 批 8 | 开发者后台 + 切换会话 + 通知 + 隐私文本 | **离线部分完成并收口（2026-10-22）** | 工程侧（代码/判据/文档）已收口：`pkg-admin` 11 页达标（五态/脱敏/中文「测试」行标签/危险二次确认/无效启用开关移除）、`admin.*` 23 动作加固（白名单 fail-closed/脱敏 DTO/邀请码生命周期/审计/复核四动作/`updateConfig` 白名单与范围/`stats.developerNo`）、TD-046 异常介入取消可达（隐私闸对 `developerNo` 豁免 + ADMIN 动作域 + 仅 EXCEPTION + 审计）、维护闸改「读放行·写拒绝」、TD-049 收敛（`getCustomer` 去 orders，`listPartner view=customer` 单一来源）、cleanup 13 sweep 审计修复（18 项真实缺陷含全域运行必崩/`image.cleanedAt`/识别失败原图/注销两阶段）、消息中心聚合与水位/红点/公告、维护模式端侧（纯件+遮罩+挂钩）、端内隐私全文单源（`pkg-customer/parts/privacy-text.js` 9 章 64 段）+ launch 弹窗、隐私文本定稿候选 v1.0 + 发布前填写清单 + QA 249 条；新增 6 套判据 **939 断言**；**真机项（QA §G/§V/§T/§R/§P 批 8 分区、后台脱敏截图、切换会话黄蓝条、复核原图、维护模式、隐私版本重同意）与云环境验收待用户** |
| 批 9 | 联调、合规与发布 | **工程侧（离线部分）完成并收口（2026-10-22）** | 交付：`tools/selftest-deletion.js`（A~F 89 断言端到端注销链路，先判据后修 14 条真实缺陷）、`docs/V4_REVIEW_MATERIALS.md`（审核材料与提审体验路径手册 206 行）、`docs/V4_V3_PARITY.md`（v3→v4 功能对照验收表 256 行）、RUNBOOK §10 灰度发布与回滚演练（§10.1~§10.6）、QA §H12~H17 与 E15/P6/P18 强化（附录 E 255 条）；`check.ps1` 4 步全 PASS、**28 套 4,151 断言**全 PASS；TD-053~057 登记、lessons +2 卡；**用户侧（真机/云环境/提审/灰度演练）待用户执行**（见 §4/§5/§9） |

## 3. 批 1 并行交付快照（全部收口）

> 写作用域以 `docs/ARCHITECTURE.md` §2 为准；实现细节见 CHANGELOG 批 1 条目与各 owner 回执。

| 工作流 | 交付摘要 | 状态 |
| :-- | :-- | :-- |
| S0 骨架与集成 | 根配置/app.json/app.js/app.wxss、config、api（client/upload/privacy/mode-guard/10 域模块）、store、launch/profile 页由 S16 接管细化 | 已交付 |
| S1 口径纯件 | `shared/**` 13 件（集合/错误码/action/审计/状态机/校验/配置默认/站点/苑/角色/格式/订单视图）、`utils/ids.js`、`utils/room-tag.js` | 已交付 |
| S1b 云端身份域 | `handlers/{user,customer,partner,bind,upload,config}`（19 动作，含首存授予 CUSTOMER、bind 重放幂等） | 已交付 |
| S2 工具链与门禁 | `tools/**` 17 件 + `check.ps1`/`gate.ps1`/`doctor.ps1`（UTF-8 BOM） | 已交付 |
| S3 顾客端页面 | 主包 role/home/orders + `pkg-customer` 5 页 + `utils/recognize/**`、`utils/ocr/**`；页面已按真实 handler DTO 对齐 | 已交付 |
| S4 兼职端页面 | 主包 workbench/customers + `pkg-partner` 7 页；工作台四档排序在客户端零件层、消费真实 DTO | 已交付 |
| S5 开发者后台页 | `pkg-admin` 11 页（含 account-switch、recognition-review） | 已交付 |
| S6 文档与纯件 | `AGENTS.md`/`STATE.md`/`CHANGELOG.md`/`docs/{RUNBOOK,V4_FIXTURES,TECH_DEBT}.md`、`utils/{storage,privacy-policy,avatar}.js` | 已交付 |
| S7 云核心 | `cloudfunctions/api` 入口/路由/中间件/db/lib/health、`cleanup` 入口与独立 dao、两个 package.json | 已交付 |
| S8 云订单与兜底 | 19 订单动作 + message + ai + `lib/ai/**` + `cleanup/sweeps` 13 个幂等 sweep | 已交付 |
| S9 云后台 | `handlers/admin/**` 23 动作（邀请码/脱敏查看/配置/统计/切换会话/测试账号/复核） | 已交付 |
| S10 组件与资产 | `components/**` 15 套 + `custom-tab-bar/` + tabbar 10 张 PNG | 已交付 |
| S12~S16 测试与细化 | 9 套 selftest（1,014 断言）、launch/profile 隐私闸与资料编辑细化、双端页面按真实 DTO 对齐、order.listPartner 隐私修复 | 已交付 |

## 3b. 批 2 离线交付快照（工程侧收口）

| 工作流 | 交付摘要 | 状态 |
| :-- | :-- | :-- |
| 批2-A 云端身份域 | `partner.activate` 修「Date 型 `expiresAt` 恒判未过期」安全缺口（过期码可激活）；头像票据 `usedAt` 统一 Date；`selftest-cloud` 身份域 +41 断言（bootstrap/acceptPrivacy/saveProfile/activate/upload 五组，EXPECTED 125→166） | 已交付 |
| 批2-B 端侧入口 | `config/route.js` 角色解析单源（`activeRole > 单角色直进 > 双角色 CHOOSE_ROLE`，route 纯件零 storage）；`lastRole` 接入 launch/role/profile/activate（TD-008 剩余项关闭，只走 `utils/storage` 白名单）；profile 头像预览断图兜底；activate 成功结果块/显式跳过头像/输入禁用；`avatar-view` 默认头像改走 `utils/avatar` 纯件；`selftest-profile` +45 断言（47→92） | 已交付 |
| 批2-C 切换会话/测试账号 | 修两个真虫：①退出会话必失败（票据只在包络、handler 读 payload + adminScope 拒会话身份）→ 中间件 EXIT 注入 + `requireAdmin(allowViewMode)`；②兼职 READONLY targetId 口径错（`partners.openid` vs `_id`）→ 分模式存 id + 交叉校验 `targetId===effectiveOpenid`。另修 dryRun 条数/真实引用闸/purge 失败原图与会话/审计重放误判/配额错误码/dryRun 二次确认等 8 项；`selftest-switch` 74→140、`selftest-testaccount` 48→153（含后台 DTO 脱敏行为 18 条） | 已交付 |
| 批2-D 变异电池 | `tools/mutation.ps1`（366 行/BOM/LF，锚点唯一→注入→首红→SHA256 还原→复跑）+#31（页面注入孤立 `TEST`）/#30（删 switch-session 目标 `isTestAccount` 校验）首红证据；M21 复验暴露并修掉**门禁 #29 空集全绿**（check.js 脱敏件路径写死不存在 → 缺失判红 + `_dto.js` 禁词 + admin handler 键扫描；selftest-testaccount +18 行为断言）；TD-002 关闭 | 已交付 |
| 批2-E 上传/时间闸 | `api/upload.js` 顺序改「本地校验/压缩 → `upload.prepare({purpose,size,contentType})` → 上传」，关闭「服务端 size/类型闸空转」（TD-026）；`lib/time.isPast` 归一 Date/字符串；变异电池 5/5 红、SHA256 还原复跑全绿；`selftest-cloud` 166→168、`selftest-profile` 92→98 | 已交付 |

## 3c. 批 3 离线交付快照（工程侧收口）

| 工作流 | 交付摘要 | 状态 |
| :-- | :-- | :-- |
| 批3-A 云端绑定域 | `bind.create`/`partner.getPublic` 非法编号改「同源错前缀三句提示」（`shared/error-copy.PREFIX_HINT`，C→顾客编号 / DEV→开发者编号 / 其它→格式）；新建 `lib/tx.js`（`retryOnConflict` 默认 3 次、只重试事务冲突、非冲突立即抛；唯一索引冲突显式排除不重试），`bind.create` 与 `customer.saveProfile` 换宿舍事务接入；`getPublic` 补 `deletedAt` 判空；核对 `acceptingOrders` 写读口径 | 已交付 |
| 批3-B 云端绑定域断言套件 | 新建 `tools/selftest-bind-cloud.js`（TD-029 行数红线拆分；A~H 共 108 断言：方向守卫/自绑/真实×测试、编号归一+错前缀、roomTag 大写/顺序/隔离/不复用/tagKey 唯一、换绑/换宿舍、解绑失联 DTO、getPublic 头像边界与 TEST_WRITE 路由级放行、接单开关 `PARTNER_CLOSED`、事务冲突重试 3 vs 1 边界、`COLLECTIONS.<小写>` 静态回归闸）；`tools/selftest.js` 注册为第 10 套 | 已交付 |
| 批3-C 端侧绑定/分享卡 | 新建纯件 `pages/profile/parts/share-card.js`（绑定卡分享 path 单一来源、统一 `encodeURIComponent`、标题零 PII）；`pages/profile` 与 `pages/partner/customers` 分享改调纯件；修 bind 页 `prefixHint` 返回对象被直接塞进 data 的真实 bug（改取 `.message`，与云端同句）；READONLY 按钮 disabled + 事件层再挡；`selftest-bind` 48→79 断言（含全页面层零自拼分享 path 静态扫描） | 已交付 |
| 批3-D 判据取证与加固 | `tools/mutation.ps1` 对 #28 两轮变异：M1（删角色守卫）加固前 check.js 与行为套**双绿=空转**（旧判据被文件头注释里的 CUSTOMER/FORBIDDEN 满足）；加固 `check.js` #28 为「去注释后同时命中 角色守卫调用 + 真实 `errors.forbidden(` + 自绑比较」，M1/M2 复验 check.js 首红 + SHA256 还原 + 复跑全绿；新增踩坑卡 | 已交付 |
| 批3-E 真实 bug 修复（跨域） | ①`handlers/order/_create.js:239` `COLLECTIONS.orders`（小写=undefined）→ `order.create/createBatch` 重复预查 100% `INTERNAL_ERROR`，一行修复；②`middleware/switch-session.js` TEST_WRITE 未放行 `partner.getPublic` → 开发者测试会话无法预览兼职（绑定流程受阻），新增 `TEST_WRITE_READ_ALLOW`（READONLY 不动）；由新套件首红定位后修复并复验 | 已交付 |

## 3d. 批 4 离线交付快照（工程侧收口）

| 工作流 | 交付摘要 | 状态 |
| :-- | :-- | :-- |
| 批4-A 建单引擎与票据判据 | 新建 `tools/selftest-order.js`（126 断言 A~H：单件快乐路径/幂等重放/票据与图片闸/批量原子性与回滚/守卫/字段闸/逐单失败关联/静态回归）；修 `_create.js` 严格入参白名单（未知键 `VALIDATION_FAILED`，DATA_MODEL §12 #12）+ 逐单 `items[i].recognition.failureId` 解析/回填 + `recognition.source` 回退写 `parcel.recognitionSource`；**跨域 P0**：`lib/id-generator.nextOrderNos` 当天首桶只落 1 个（首单拆单后同日全挂）→ `{key, seq: total}` 一行修复（Lead 授权）+ D5b/D5c 回归断言 | 已交付 |
| 批4-B AI 兜底判据 | `tools/selftest-ai.js` 86→197 断言（外呼闸/配额/票据/降级 DTO/入队字段/规则优先/静态唯一出口）；修 `lib/ai/parse.js` 降级 DTO 越界键 `duplicated`（恰 10 键）+ 重放分支统一 `buildDegradedDto`；修 `handlers/ai/_common.js` 票据**过期/已消费**漏判 `ticketInvalid`（DATA_MODEL §2.14 要求仍入队供排查） | 已交付 |
| 批4-C 四步下单端侧 | `api/client.js` 支持 `opts.clientRequestId`（16~32 位，非法静默回退）+ `api/modules/order.js` create/createBatch 透传；`parts/model.js` 新增 submission id 生命周期（指纹不变复用/变更重生成/成功清空）、识别来源快照（MANUAL>AI来源>RULE）、逐件 AI 决策纯件 `applyAiFallbacks`；`parts/ocr-flow.js` 逐件 `ai.parseParcel`（同图多单按单调用、独立 failureId、只填空字段）；页面 Step3 逐件预约/备注、逐件 AI 降级提示、识别原文折叠、截图预览、服务类型说明；新建 `tools/selftest-order-flow.js`（135 断言 A~I，含 fake DB+真实 handler 联调证明 `recognitionSource` 落库、未知键被拒） | 已交付 |

## 3e. 批 5 离线交付快照（工程侧收口）

| 工作流 | 交付摘要 | 状态 |
| :-- | :-- | :-- |
| 批5-A 云端订单闭环（cloud-orders task-63/66） | `_dto.js` 顾客七态 `actions[]` 单源矩阵（SUBMITTED/ACCEPTED cancel+message；PICKED message；DELIVERED confirm+message；COMPLETED deleteRecord（未软删）+reorder；CANCELLED reorder；EXCEPTION message+依 `exception.fromStatus` cancel；**终态两侧均无 message**）+ `image{hasImage,cleaned}`；`listCustomer` 增 `counts{ongoing,completed,cancelled}`（排除软删/isTest 隔离）；`message.send` 终态闸（进行中五态才可发）；`imageUrl` 对 `image.cleanedAt` → NOT_FOUND 隐私文案；`order.correct` `NEED_CODE→OK` 写事件 `note='兼职已补齐取件码'`；新建 `tools/selftest-order-lifecycle.js`（98 断言 A~I：DTO/行动矩阵/列表分页计数/cancel/confirm/delete/越权/留言矩阵/imageUrl/补码 note，含变异电池首红） | 已交付 |
| 批5-B 顾客端闭环（v3-lifecycle-flow task-64/67） | 新建纯件 `pkg-customer/parts/poll-policy.js`（10s 基线/失败 20s→40s 封顶/成功复位/stop 不排程）、`parts/order-detail-flow.js`（拉取→视图合并：失败保留旧数据、最近更新时间、写后立即重绘）、`pages/customer/parts/orders-view.js`（counts→tab/行视图/serverTimeSkew 倒计时/软删防御）、`order-create/parts/reorder.js`（只预填服务类型/站点，绝不复制码/图）、`order-create/parts/bootstrap.js`；重写 `pkg-customer/pages/order-detail`（只消费服务端 actions、进度异常/取消分支、时间线、截图四态、留言只读归档、订单号复制、再次下单、写动作 `expectedVersion`）、`pages/customer/orders`（服务端 counts tab、等待接单秒级倒计时、下拉刷新成功提示、错误条保留旧数据）、home 消息红点、messages 已读清零、`status-view.js` 扩展；新建 `tools/selftest-order-customer.js`（190 断言 A~G：七状态视图矩阵/轮询退避/倒计时/列表视图/reorder/静态纪律/真实 DTO 联调） | 已交付 |
| 批5-C 口径/文档回写 | `api/client.js` 增 `opts.expectedVersion` 透传（正整数才进包络，非法静默丢弃）+ `api/modules/order.js` 写动作 `(payload, opts?)`；ARCHITECTURE §3.1/§3.2、DATA_MODEL §7.5（`order.get/listCustomer/imageUrl/message.send` 行 + 批 5 只增约定）、ENGINEERING §7.1/§7.2/§6.2/§11、TECH_DEBT TD-040~042、lessons 2 卡、零金额白名单同步；`tools/selftest.js` 注册第 13/14 套 | 已交付 |

## 3f. 批 6 离线交付快照（工程侧收口）

| 工作流 | 交付摘要 | 状态 |
| :-- | :-- | :-- |
| 批6-A 云端兼职域（cloud-orders task-68） | `listPartner`：workbench 行内联 `actions[]`（复用 PARTNER 矩阵+5s undo 窗；history 不发、listCustomer 不动）、SUSPENDED/CLOSED 读闸 `PARTNER_CLOSED`、完整订单号走 `uk_order_no` 精确搜索、`todayCompleted` 精确计数探针（DAO 窄口登记 TD-043）、keyword 窗口降级登记（TD-044）；`runOrderAction` 接收 §7.3 四动作 `batchActionId` 并落 `orders.batchActionId`（形态闸、缺省清旧、零落库）；`_dto` PARTNER DELIVERED 去非法 `correct`、`isoOf/msOf` 拒空值（假时间修复）；`undo` 撤销送达清 `deliveryNote`；`unmarkPicked/unmarkDelivered` 事件 `undoneAction` 改为被撤销动作；`reject.OTHER` 必填备注；`_create` batchActionId 统一形态闸；新建 `selftest-order-partner`（127 断言 A~H + `-cases` 夹具，变异电池 5/5 红） | 已交付 |
| 批6-B 工作台端侧（v3-lifecycle-flow task-69） | 页面拆 13 个 parts 纯件（行视图/动作面板/批量/撤销/增量加载/筛选/引导/已完结）：行级接单/拒单/取件/送达/撤销/异常/补码只消费服务端 actions[] 且写动作带 `expectedVersion`；状态 chip 服务端 `status` 筛选、需查明 chip、筛选说明与筛空/真空分离、换筛选退多选；多选资格排除 DELIVERED/COMPLETED/CANCELLED；批量逐单+同一 `batchActionId`、部分失败保留失败勾选+单号/原因+一键重试；撤销条 5s/批量同 id/部分失败文案；counts 6 项点击跳筛选+tabBar `workbenchPending` 红点（`store.patch`，不碰 S10）；引导三步+兼职编号（`ids.isPartnerNo` 校验防造假）+空态重看；已完结 `view:'history'+from/to` 今天/昨天分区+取消单灰显；首屏 30 游标分页、轮询行级 `setData`、分片 20、骨架屏、错误态上次成功时间；新建 `selftest-order-workbench`（197 断言 A~G，变异电池 6/6 红） | 已交付 |
| 批6-C 详情端侧（v3-pickup-ux task-70） | 动作条 100% 服务端 `order.actions[]`（未知 key 忽略、label 取服务端）；补码/改站点面板（P1~P8、码≤40/柜号/尾号 5 位、PICKED 字段收窄、DELIVERED 隐藏+文案、`expectedVersion`）；异常六原因+备注≤200+OTHER 必填、解除按 `exception.fromStatus` 渲染；送达 deliveryNote≤100+三快捷标签、guest 24h 自动完成文案、5s 撤销条、顾客已确认撤销被拒文案；凭证卡（orderNo/站点/服务/四时间/deliveryNote/顾客确认时间+自动完成标识）；顾客/本人编号小字；READONLY 置灰+事件层再挡（transport 零调用）、TEST_WRITE 提示；三面板首红→复绿；新建 `selftest-order-detail-partner`（153 断言 A~G，DELIVERED 无 correct 反例锁） | 已交付 |
| 批6-D Lead 集成与回写 | `tools/selftest.js` 注册 3 套（17 套）；`pages/profile` 增「重新看新手引导」（`storage.clearGuideSeen` 白名单键，S0 域）；DATA_MODEL §2.5/§7.3（batchActionId 落库、workbench 行 actions/CLOSED 读闸/批 6 只增约定）、ENGINEERING §7/§11 批 6 回写；TECH_DEBT TD-043~048、lessons +2 卡；零金额白名单校验与门禁全绿 | 已交付 |

## 3g. 批 7 离线交付快照（工程侧收口）

| 工作流 | 交付摘要 | 状态 |
| :-- | :-- | :-- |
| 批7-A 云端客户/统计域（v3-data-model task-71） | 新建 `handlers/partner/_customer.js`（归属守卫/进行中单计数/关键词/游标/UTC+8 日周月窗口）；`listBindings` 重构（服务端搜索+`compareDormKey` 自然序+游标分页+按顾客 activeOrderCount+isTest 隔离）；新建 `getCustomer`（bindingId 反查、越权 FORBIDDEN、不透传 openid）与 `stats`（三区间/完成率 null/近 7 日/最近 10 单/排 isTest/异常按 `exception.at`）；`unbindCustomer` 进行中单按顾客判定（修全量误拦）；`saveCustomerNote` 归属/ACTIVE/≤100 加固；新建 `selftest-partner-customers`（129 断言 A~F，变异电池 5 处首红）；授权更新 `selftest-bind-cloud` E12 期望 FORBIDDEN | 已交付 |
| 批7-B 云端代客下单（cloud-orders task-72） | `_create.js` 顶层白名单增 `bindingId`、上下文拆三函数、绑定顾客身份/编号/dorm/roomTag 一次装配、requestKey 归属（绑定=customerId、guest=partnerId）、重放侧别修正；`_parcel.js` 二选一互斥/批量条目 guest 互斥/顾客单禁止 selector；`_store.js` binding 归属/ACTIVE/注销/测试侧；`listPartner` 增 `view:'customer'`（bindingId 归属、按 customerId 过滤、不发 counts/actions）；新建 `selftest-partner-orders`（89 断言 A~G + 首红 3 缺陷 + 变异电池 5 处） | 已交付 |
| 批7-C 端侧客户档案（v3-pickup-ux task-73） | 客户列表服务端搜索/游标触底/头像昵称/进行中数/分享卡片/复制编号/空态引导/新绑定刷新；顾客详情 `getCustomer` 档案+解绑资格、`order.listPartner({view:'customer'})` 历史单自然日分组+「查看更早」、备注仅自己可见、解绑原因必填+二次确认、本人兼职编号；代客下单两路径互斥、字段校验矩阵、`clientRequestId`、逐条结果块、guest 提示、零绑定入口；`utils/customer-view.js` 扩展；新建 `selftest-partner-pages`（156 断言 A~G，变异电池 3 处） | 已交付 |
| 批7-D 端侧统计（v3-lifecycle-flow task-74） | 统计页改 `partner.stats` 单源（删除旧 4×100 客户端累加 `summary.js`、补 `view-model.js` 322 行 + `daily-report.js` 92 行）、三 tab/四格/7 日 view 自绘柱（空数据不画假柱）/日报复制/骨架/空/错态/READONLY 可读；`pages/partner/workbench` 仅增 `completedDate` 入参解析用于「今日完成」跳转；新建 `selftest-partner-stats`（203 断言 A~G，变异电池 3 处） | 已交付 |
| 批7-E Lead 集成与回写 | 口径增补写 CONTRACT §5.3（getCustomer/stats）与 DATA_MODEL §7.4/§7.5/§4.8（Batch 7 只增约定、exception.at、UTC+8、`view:'customer'`、bindingId/guest 互斥）、UX_PARTNER §9（服务端单源）；`shared/actions.js` +`partner.getCustomer/stats`（sync 一致）、`switch-session` READONLY 读白名单、`tools/lib/project.js` 注册表、`api/modules/partner.js` 适配；`tools/selftest.js` 注册 4 套（21 套）；DATA_MODEL 批 7⑦（`getCustomer.orders` 双源→页面统一 listPartner）；ENGINEERING §6.2/§7.1/§11；TECH_DEBT TD-049/050；lessons +3 卡 | 已交付 |

## 3h. 批 8 离线交付快照（工程侧收口）

| 工作流 | 交付摘要 | 状态 |
| :-- | :-- | :-- |
| 批8-A 后台服务端（cloud-core task-75/81） | TD-046 修复（隐私闸对 `developerNo` 豁免 + 按动作域解析 ADMIN + `order.cancel` 仅 EXCEPTION + `cancelledBy=ADMIN` + `ORDER_ANOMALY_CANCEL` 审计；后台仅此一个 client 写动作）；维护闸改「只拦写」（读 bootstrap/config.getPublic/message.list 放行，写 `INVALID_STATE`）；`admin.updateConfig` 白名单/范围按 DATA_MODEL §7.6 定稿（`avatarMaxBytes` 102400~204800、`privacyVersion` 文本键、`testAccount*`/`testData*` 收口、仅 `aiFallback` 拒写）；message 域三缺陷（公告 enabled 闸、unread 与游标解耦、ADMIN 不可改他人已读）；`admin.stats.developerNo`；TD-049 `getCustomer` 去 `orders/nextCursor`；新增 `selftest-admin` 220 / `selftest-messages` 89，变异电池 3 组 | 已交付 |
| 批8-B cleanup 定时清理（cloud-orders task-76） | 新增可注入执行器 `cleanup/run.js`（部分失败隔离 + 每轮 `CLEANUP` 汇总审计）+ `cleanup/db/collections.js`（修全域运行必崩 `assertCollection`）；逐 sweep 修 18 项真实缺陷（`image.cleanedAt` 未写、识别失败 IGNORED 原图残留/自引用、files 批遮挡、orderTimeout 锚点、tickets 已消费不删、rateLimits 前缀、viewSessions 混扫、retention 三查询拆分、accountDeletion 两阶段立即匿名化、testAccountsDeletion 孤儿级联、testData 重跑重复审计、stats.todayOrders 少算、CLEANUP 审计缺失）；新增 `selftest-cleanup` 183（时间旅行/重跑幂等/失败隔离/不变量），变异电池 2 组 | 已交付 |
| 批8-C 后台端侧 11 页（v4-developer-console task-77/82） | 新增 `pkg-admin/common/copy.js` + 10 页 `parts/view-model.js`；修 13 项真实缺陷（订单总览 `buildEmptyText` 未定义必崩、11 页无权限五态缺失、错误文案硬编码网络句、服务类型无效启用开关移除、维护关闭无确认、识别失败留存改可编辑 7~30、邀请码作废按中文标签误判、非 ACTIVE 兼职可切换、真实兼职搜索未限 ACTIVE、后台消息计数被分页截断、AI 排障码未映射、创建测试账号无说明确认等）；TD-030 行标签补齐；抬头消费 `admin.stats.developerNo`、卡片改「顾客」；新增 `selftest-admin-pages` 145，变异电池 5 组 | 已交付 |
| 批8-D 通知与维护端侧（v3-pickup-ux task-78） | 新增单源纯件 `utils/maintenance.js` + `components/maintenance-mask` 四件套（页面级注册）+ 工作台维护挂钩；消息中心两页修复（公告单源可关闭、首页 announcement.enabled、顾客身份闸/水位/追加态、兼职分类 chip + 30s 轮询 + READONLY 置灰 + 追加去重、红点欠计）；custom-tab-bar 两角色「我的」格补 `badgeKey:'messages'`，我的页消息入口改红点；新增 `selftest-message-pages` 138，变异电池 4 组 | 已交付 |
| 批8-E 隐私文本与 QA（v4-privacy-qa task-79 + v3-lifecycle-flow task-80） | 隐私指引草案 v0.4 → **定稿候选 v1.0**（17 项数据表/留存/可见范围/AI/测试账号/消息与日志/未成年人/权利，仅剩 13 项用户填写）；发布前填写清单对齐 config 默认值；QA 238→249 条批 8 校正；端内全文单源 `pkg-customer/parts/privacy-text.js`（9 章 64 段 6270 字）+ help 章节渲染 + launch 弹窗 7 条重写（scroll-view）+ 版本注入；新增 `selftest-privacy-text` 164，变异电池 5 组；docs 注销路径按真实 UI 修正 | 已交付 |
| 批8-F Lead 集成与回写 | 口径回写 CONTRACT §1.1（CLOSED 兜底口径）、DATA_MODEL §2.10/§7.4/§7.5/§7.6（avatarMaxBytes 200KB 上限/privacyVersion 白名单/getCustomer 去 orders/admin.stats developerNo）、UX_DEVELOPER §3.1/§3.8/§5.2/§7.2/§7.4、ARCHITECTURE §3.5/§4.2（parts 纯件/维护组件/cleanup 执行器）、ENGINEERING §4.7（TD-051）/§7.1/§7.2；`config/defaults.js` 头像上限 500KB→200KB + sync；`tools/check.js` #24 隐私披露单文件窄豁免+补偿断言；TECH_DEBT 关闭 TD-030/046/049/052、新增 TD-051/052；RUNBOOK §7 无主文件/§8 privacyVersion/§9 冒烟 12~17；`tools/selftest.js` 注册 6 套（27 套） | 已交付 |

## 3i. 批 9 工程侧交付快照（离线部分收口）

| 工作流 | 交付摘要 | 状态 |
| :-- | :-- | :-- |
| 批9-A 注销/数据删除端到端判据（cloud-core task-83） | 新建 `tools/selftest-deletion.js`（A~F 89 断言：`user.deleteAccount` handler / cleanup 阶段一匿名化与文件删除 / 阶段二 30 天物理删与幂等 / 兼职 CLOSED 全链 / 修复回归与失败隔离 / 端侧静态），**先判据后修 14 条真实缺陷**：顾客注销阶段一漏清历史 `bindings.partnerNote`、识别失败 `uploaderOpenid/fileId` 未清且原图引用未回收；兼职 CLOSED 只改状态（未匿名化 `displayName/avatarFileId`/停用与关闭原因、未删头像文件、未清 `invitation_codes.usedBy`、未清识别失败归属）；`deleteAccount`/`accounts` 阶段一/阶段二复用同一 helper + 引用计数删图；3 组变异电池首红 + SHA256 还原 | 已交付 |
| 批9-B 审核材料与提审路径（v4-privacy-qa task-84） | 新建 `docs/V4_REVIEW_MATERIALS.md`（206 行）：§1 提审前置 P0-1~P0-16、§2 顾客/兼职/开发者三路径与单微信号降级、§3 可粘贴审核说明模板（完整版+简版）、§4 驳回点与应对 13 行、§5 证据留存表 E1~E18、§6 QA §H1~§H17 映射、§7 未决项（2026-10-22 裁决后仅余提审阶段演示方式与填写项）；zero-money docs 0 命中、check-docs 10/10 | 已交付 |
| 批9-C v3 功能对照验收表（v3-engineering task-85） | 新建 `docs/V4_V3_PARITY.md`（256 行）：v3 真实盘点（4 主包页 + chatpick 独立分包、零云函数）→ 页面级逐页对照（4 改进 + chatpick 取舍不迁）+ v4 30 页反向覆盖（7 改进/23 新增，无来源不明页）+ 19 类业务能力（8 改进/9 新增/2 取舍）+ v3 12 张工程教训与 6 条业务教训逐条承接 + 剩余项与用户勾选栏 + 盘点取数命令（数字不写死） | 已交付 |
| 批9-D 灰度回滚演练与 QA 批 9 点检（v3-lifecycle-flow task-86） | RUNBOOK §10 从「回滚预案」升级为「灰度发布与回滚演练」（10.1 分批策略 G0→G1→G2、10.2 发布前门禁回执 8 项、10.3 观测指标与判停阈值 7 类、10.4 原六条保留、10.5 演练脚本 R1~R7、10.6 演练记录表）；QA 新增 §H12~H17（灰度观测/回滚演练/审核材料/注销链路/测试账号清理/隐私回执），重写 E15/P6/P18 注销与头像文件删除口径，附录 B 批 9 行、附录 E 255 条（取数命令核对），新增批 9 判定补充与两条取证纪律 | 已交付 |
| 批9-E Lead 集成与回写 | `tools/selftest.js` 注册第 28 套 `selftest-deletion`；新建两文档登记进 `tools/lib/project.js` DESIGN_DOCS + CONTRACT §12/ENGINEERING §9.1/README 文档地图；CONTRACT §11.4 注销时点与兼职 CLOSED 执行细化，DATA_MODEL §10.3/§10.4/§7.6/§12#4 口径澄清（两阶段时点、partners 匿名化与 openid 保留、binding 幂等分支可达性、CLOSED 编号 NOT_FOUND）；ENGINEERING §8.2 批 9 判据补充 + §11 批 9 行 + §10.4 审核材料引用；TECH_DEBT TD-053~057；lessons +2 卡；README/CHANGELOG/STATE 同步 | 已交付 |

## 4. 用户待办（阻塞项）

| # | 事项 | 阻塞什么 | 来源 | 状态 |
| :-- | :-- | :-- | :-- | :-- |
| 1 | **D1** 开通云开发 + 创建**唯一云环境**（D1 修订：账号只能开 1 个；三档同 envId，envId 交 Lead 填 `config/env.js`） | 云资源、部署、批 2 联调 | ENGINEERING §6.1 #2、§10.2 | 已裁决 A + 单环境修订；**环境已创建、envId 已回填 `config/env.js`（2026-10-22）**；待建集合/索引/规则与部署 |
| 2 | **D2** appid 沿用 `wxcb7e5b41b89bc806`（2026-10-22 已裁决；`project.config.json` 已改）；确认该 appid 主体可用 | 开工门/真机 | ENGINEERING §6.1 #1 | 已裁决；待确认主体 |
| 3 | **D3** 兼职准入用邀请码（2026-10-22 已裁决 A） | 批 2 激活流程锁定 | CONTRACT §13 | 已闭环 |
| 4 | **D13** 主体/类目：个人主体 + 工具类目（2026-10-22 已裁决；提审前在微信后台确认类目可选 + 完成备案） | 批 9 提审 | ENGINEERING §6.1 #3 | 已裁决；类目可选性待确认 |
| 5 | **D8** 五苑展示名：东苑/西苑/南苑/北苑/翠苑（2026-10-22 已裁决；默认值已进 `shared/zones.js`，两个云函数副本已同步） | `config.zoneLabels` 与展示文案 | CONTRACT §13 D8 | 已闭环 |
| 6 | 配置 `ADMIN_OPENIDS`（JSON 映射，含 `DEV-01`） | `admin.*`、切换会话/测试账号冒烟 | ENGINEERING §6.1 #4 | 未完成 |
| 7 | 云存储权限设置（私有、上传可用） | 截图/头像上传链路 | ENGINEERING §6.1 #5、§3.5 | 未完成 |
| 8 | 14 集合 + 安全规则 + 全部索引（控制台建，`seed-dev.js` 可给清单） | 批 2 云资源验收 | ENGINEERING §4.6、§10.2 | 未完成 |
| 9 | `DEEPSEEK_API_KEY` 与 E11（DeepSeek 账号/条款/配额确认） | AI 兜底上线；未确认前保持关闭 | ENGINEERING §6.1 #9、§13 E11 | **Key 已由用户提供（2026-10-22；只入控制台环境变量，仓库零落值）**；E11 条款/配额确认未完成，`aiFallback.enabled` 保持 false |
| 10 | 定时触发器（10 分钟 cleanup）与云函数超时/内存按 RUNBOOK 配置 | cleanup 生效 | ENGINEERING §4.7、RUNBOOK | 未完成 |
| 11 | **E12** 头像/昵称隐私接口与基础库能力真机实测 | 批 2 头像/昵称采集验收 | ENGINEERING §6.1 #10、§13 E12 | 未做 |
| 12 | 《用户隐私保护指引》微信后台逐项声明（含头像/昵称/第三方 AI） | 批 9 提审 | ENGINEERING §6.1 #6、§10.4 | 未做 |
| 13 | **D22** 截图上传失败后是否允许**无截图手填提交**（2026-10-22 裁决 **A**：保持必须先有截图；上传失败只能重试/换图，OCR/阅读失败仍可手填 `NEED_CODE`；UX §4.5 已限定、TD-039 已关闭） | 上传失败用户的出路；兼职无图核对口径 | UX_CUSTOMER §4.2/§4.5/§10、DATA_MODEL §2.5 | 已闭环 |
| 14 | **隐私文本 13 项用户填写/确认**（对外名称/联系方式/变更通知方式/主体类型与类目/备案状态/用户协议是否另发/微信后台逐项声明/第三方服务按 DeepSeek 申报/DeepSeek 账号条款限额/头像昵称采集声明/账号切换说明进提审材料/审计保留期限/privacyVersion 最终值） | 批 9 提审与隐私承诺生效 | `docs/privacy/` 定稿候选 v1.0 附录 B、发布前填写清单 §1 | 未填写 |
| 15 | **`privacyVersion` 定稿写入**：发布前由 Lead/用户经部署配置脚本或 `admin.updateConfig`（白名单文本键）一次性写入并与隐私文本一致（首次发布保持 `v4.0.0`；体验版已同意旧文本才 bump） | 隐私同意闸与端内版本一致性 | RUNBOOK §3.8/§8、QA P20 | 未执行 |
| 16 | **云存储无主文件人工核对（TD-051）**：MVP 无文件列举 API，每月控制台「存储 → 文件」核对 `avatars/`、`orders/` 孤儿文件并记录 | 隐私留存兜底 | ENGINEERING §4.7、RUNBOOK §7 | 未开始 |
| 17 | **审核材料准备与提审**：按 `docs/V4_REVIEW_MATERIALS.md` §1 P0-1~P0-16 逐项准备（类目/备案/隐私定稿与 `privacyVersion`/后台逐项声明/填写清单/审核专用邀请码批次/测试账号与失败演示数据/素材/备注/证据表），§3 审核说明模板填占位符后提审；其中审核邀请码生成环境、是否提供演示兼职真实编号、后台演示形式（§7 #1~#3）**待用户裁决** | 批 9 提审 | `docs/V4_REVIEW_MATERIALS.md`、ENGINEERING §6.1 #8/§10.4 | 未开始 |
| 18 | **灰度发布与回滚演练（批 9）**：按 RUNBOOK §10 执行——门禁回执 8 项、按 10.1 分批放量、按 10.3 观测判停、按 10.5 演练 R1/R3/R4/R5/R6 并填 §10.6 记录表；记录表为空不得全量发布 | 发布与回滚能力 | RUNBOOK §10、QA H12/H13 | 未开始 |
| 19 | **批 9 双端真机全量回归**：QA 附录 B 批 9 行（全表）+ H12~H17；含双端全场景/越权/隐私/性能/弱网、后台与切换会话全链路回归、识别兜底与复核面检、注销链路（E15/P6/P18）、测试账号清理链路（T9~T11） | 批 9 发布前置 | QA_CHECKLIST 附录 B/§H12~H17 | 未开始 |
| 20 | **单环境清零（发布前，D1 修订）**：按 RUNBOOK §10.2.1 导出 14 集合 JSON 备份 → `admin.purgeTestData`（dryRun→confirm）→ 删/留测试账号 → 控制台核对集合与云存储无测试残留 → 留少量审核邀请码；未清零不得发布（QA 批 9 判定补充按【阻塞】处理） | 首次发布 | RUNBOOK §10.2.1、QA H16/批 9 判定补充 | 未开始 |

## 5. 待真机 / 待实测项（agent 不能代验）

| 项 | 内容 | 取证批次 | 来源 | 状态 |
| :-- | :-- | :-- | :-- | :-- |
| E5 | 云存储安全规则可选项 + 三分包是否改独立分包 | 批 1 / 批 9 | ENGINEERING §13 | 待实测 |
| R2 | `wx.cloud.uploadFile` + 私有存储"仅创建者可写"真机链路 | 批 1 / 批 4 | ENGINEERING §12 | 待实测 |
| R3 | VisionKit 在目标机型真实吐字（识别形态闸依据） | 批 4 | ENGINEERING §12 | 待用户真机取证 |
| E12 | `chooseAvatar` / `nickname` 输入 / 隐私弹窗 / 真机压缩到上限内 | 批 2 | ENGINEERING §13 | 待实测 |
| R6 | 订阅消息模板审批（P1） | 批 9 | ENGINEERING §12 | 未申请 |
| R9 | 校园运营/校方/驿站要求（线下确认） | 批 9 | ENGINEERING §12 | 待用户确认 |
| R13 | 云开发配额/成本按真实单量估算 | 批 9 | ENGINEERING §12 | 未估算 |
| R12 | `docs/QA_CHECKLIST.md` 全部"人（真机）"条目 | 每批 | ENGINEERING §12、QA_CHECKLIST | 待用户点检 |
| 批4 真机 | QA `D1~D12`（截图→核对→服务→提交、一图多码拆单、手填兜底、结果块）、`R1~R4`（造假失败图→AI 等待态/成功预填/不覆盖手填/静默降级）、`M1~M3`（零金额页面巡检） | 批 4 | QA_CHECKLIST 附录 B | 待用户点检 |
| 批5 真机 | QA `E1~E8`（双机进度 10s 内同步/确认送达/取消与原因/超时与自动完成）、`E12~E18`（留言、消息中心红点、删除记录、编号复制、弱网重试与最近成功时间、订单无头像昵称快照）、双机 `T1~T13` | 批 5 | QA_CHECKLIST 附录 B | 待用户点检 |
| 批6 真机 | QA `F1~F15`（首用引导/站点聚合/四档动线/需查明补齐/接单拒单/单件取件撤销/批量取件/批量送达/批量改站点改码/搜索/筛选/长列表/弱网/新单提醒/顾客取消）、`F21`（切换角色）、`F23`（兼职端无绑定入口）；双机新单红点与 30s 轮询、tabBar 角标、骨架屏/长列表性能 | 批 6 | QA_CHECKLIST 附录 B | 待用户点检 |
| 批7 真机 | QA `F16`（客户档案/备注：只看到绑定顾客、`partnerNote` 仅兼职可见、解绑后不再显示头像昵称）、`F18`（代客下单：已绑定顾客单顾客可见进度、guest 单顾客看不到、绑定后只看新单）、`F20`（统计页只有单量、无费用字段、测试数据不计入）、`F22`（客户档案头像+昵称+编号、guest 默认头像+"代客单"标签）；另点检：客户列表服务端搜索/分页、顾客详情「查看更早」、解绑原因必填与二次确认、统计「今日完成」跨 tab 跳工作台（reLaunch 带参）、头像/昵称 onShow 重取 | 批 7 | QA_CHECKLIST 附录 B | 待用户点检 |
| 批8 真机 | QA §G（开发者后台与治理，G1~G17：后台默认脱敏、邀请码批次/作废/过期、停用/恢复、异常介入取消、config 白名单与二次确认、审计区块）、§V（只读视角 V1~V20：黄条+拒写+审计+Hidden 分享）、§T（账号切换与测试账号 T1~T17：两模式/三 tab/黄蓝条/TEST 角标/退出/过期/覆盖/dryRun/purge/新建→验收→删除）、§R（识别兜底与复核 R5~R15：原图 5 分钟 URL/逐次审计/补录回填/忽略备注/到期清理）、§P（隐私 P8/P10/P19~P22：隐私全文/弹窗/版本重同意/后台声明）、§S 隔离负向 S11~S12/S15~S26；另点检：维护模式（读可用写拒绝+端侧公告）、消息中心红点/公告/已读、我的 tab 红点、后台抬头 developerNo | 批 8 | QA_CHECKLIST 附录 B | 待用户点检 |
| 批9 真机与发布 | QA 附录 B 批 9 行（全表）+ **H12~H17**：H12 灰度观测六类指标读数、H13 回滚演练（R1/R3/R4/R5/R6+§10.6 记录表）、H14 审核材料齐、H15 注销与数据删除链路（E15/P6/P18：顾客两阶段+兼职 CLOSED 匿名化/删头像/编号作废/usedBy 置空）、H16 测试账号清理链路（T9~T11）、H17 隐私填写回执；另点检双端全场景/越权/隐私/性能/弱网、后台与切换会话全链路、识别兜底与复核面检、灰度放量读数与回滚演练证据 | 批 9 | QA_CHECKLIST 附录 B、RUNBOOK §10 | 待用户执行 |

## 6. 批 1 收口证据（真实输出）

| 命令 | 结果 |
| :-- | :-- |
| `powershell -File check.ps1` | **4 步全 PASS，退出码 0** |
| `node tools/check.js` | 通过 **31 项**；失败 0 项 |
| `node tools/check-docs.js --batch 1` | 通过 **10 项**；失败 0 项 |
| `node tools/zero-money-scan.js` | **0 命中**（白名单 136 项精确项） |
| `node tools/selftest.js` | 运行 **9 套**；失败 0 套；SKIP 0；**1,014 断言全 PASS**（core 58 / state 341 / recognize 187 / cloud 125 / ai 86 / bind 48 / profile 47 / switch 74 / testaccount 48） |
| `node tools/sync-cloud-shared.js` | 16 源 × 2 套逐字节 hash 一致 |
| `node tools/doctor.ps1` | 通过 15 / 告警 1（envId 占位待回填）/ 失败 0 |
| `gate.ps1 -Anchor 71341c9 -ScopeFiles "api/,cloudfunctions/,docs/,pages/,pkg-customer/,pkg-partner/,tools/,utils/,README.md,STATE.md,CHANGELOG.md" -Estimate 2400`（复跑回读；只传 `-Anchor` 会因缺 `-ScopeFiles`/`-Estimate` 报 2 条黄色，黄色不是绿） | 红色 **0** 项；黄色 **0** 项（退出码 0）；变更集 61 件、范围 11 前缀全匹配、新增 3033 行 ≤ 2400×1.5=3600 |
| 收口提交 | `d125b42`（批 1 收口；gate 回读 HEAD 一致） |

- 代码规模：471 文件 / 46,784 行；页面 30 个；云函数 163 文件；工具 17 件；文档 14 件。
- 已关闭工程裁决：TD-017（四档排序归客户端）、TD-018（公开配置含 `viewTicketTtlMinutes`）、TD-007/008/009（upload/privacy 接纯件）；新增跟踪 TD-019~TD-024（详见 `docs/TECH_DEBT.md`）。

## 6b. 批 2 离线收口证据（真实输出）

| 命令 | 结果 |
| :-- | :-- |
| `powershell -File check.ps1` | **4 步全 PASS，退出码 0** |
| `node tools/check.js` | 通过 **31 项**；失败 0 项 |
| `node tools/check-docs.js --batch 1` | 通过 **10 项**；失败 0 项 |
| `node tools/zero-money-scan.js` | **0 命中**（白名单 136 项；allowlist 由 682 行 pretty-print 压成 138 行「一条一行」以过 gate 行数门禁） |
| `node tools/selftest.js` | 运行 **9 套**；失败 0 套；SKIP 0；**1,279 断言全 PASS**（core 58 / state 341 / recognize 187 / cloud 168 / ai 86 / bind 48 / profile 98 / switch 140 / testaccount 153） |
| 批 2 代码收口提交 | `619f39a`（39 文件 +1740/-286；批 2 离线收口） |
| `gate.ps1 -Anchor 2b0bbe5 -ScopeFiles "api/,cloudfunctions/,components/,config/,docs/,pages/,pkg-admin/,pkg-partner/,tools/" -Estimate 1500` | 红色 **0** 项；首次回读黄色 1（`zero-money-allowlist.json` 682 行 > 500，锚点前已超线）→ 已把 allowlist 压成 138 行后复跑 |

- 突变/首红证据：task-48 activate 过期判定（旧 `time.isPast(number)` 对 Date 恒 false）临时回退→2 条判据红；task-52 上传顺序/time 归一变异 5/5 红 + SHA256 逐字节还原后复跑全绿；task-51/53 `tools/mutation.ps1` 变异电池——**#31**（业务页注入孤立 `TEST`）check.js 首红、**#30**（删 switch-session 目标 `isTestAccount` 校验）selftest-switch 首红、**M21** 首轮判绿暴露 **#29 空集全绿**（check.js 读不存在的 `handlers/admin/dto/mask.js` 且 null 时跳过）→ 修后 M21 复验 exit 0（两条测试首红 + SHA256 还原 + 复跑全绿）。
- 关闭债务：TD-002（#28~#31 判据必须有牙，批 2 取 #29/#30/#31；#28 转 TD-031）、TD-008 剩余项（lastRole 生产接入）、TD-010（privacyConsent 进 store）、TD-017/020/021（排序/模型/隐私 DTO）、TD-026（上传服务端闸空转）、TD-028（DATA_MODEL 事务措辞）；新增 TD-027（票据一次性 vs 幂等重放，接受为预期）、TD-029（selftest-cloud 999/1000 行红线）、TD-030（后台「测试」行标签待批 8 补）、TD-031（#28 变异留批 3）、TD-032（#29 静态扫描 `{ avatarFileId }` 简写盲区，行为套兜底）。
- 文档回写：ARCHITECTURE §3.3 上传顺序 + §3.6 reason/导出；DATA_MODEL §2.10/§7.3/§7.7 + 23 处「测试」标签口径；CONTRACT §1.3 后台行标签裁决；UX_CUSTOMER §3.1 分流顺序；UX_DEVELOPER/QA_CHECKLIST 同步。

## 6c. 批 3 离线收口证据（真实输出）

| 命令 | 结果 |
| :-- | :-- |
| `powershell -File check.ps1` | **4 步全 PASS，退出码 0** |
| `node tools/check.js` | 通过 **31 项**；失败 0 项 |
| `node tools/check-docs.js --batch 1` | 通过 **10 项**；失败 0 项 |
| `node tools/zero-money-scan.js` | **0 命中**（白名单 136 项） |
| `node tools/selftest.js` | 运行 **10 套**；失败 0 套；SKIP 0；**1,418 断言全 PASS**（core 58 / state 341 / recognize 187 / cloud 168 / ai 86 / bind 79 / bind-cloud 108 / profile 98 / switch 140 / testaccount 153） |
| `node tools/selftest-bind-cloud.js` | 断言 **108/108**；失败 0 项 |
| `node tools/sync-cloud-shared.js --check` | 16 源 × 2 套 32 件 hash 一致 |
| 批 3 代码收口提交 | `c5ad0af`（15 文件 +1232/-44；批 3 代码/判据） |
| 变异电池 #28（M1/M2） | `tools/mutation.ps1` 注入→首红→SHA256 逐字节还原→复跑绿；M1 加固前双绿=判据空转已修 |

- 新增/修改代码文件（批 3）：`cloudfunctions/api/lib/tx.js`（41 行，新）、`handlers/bind/create.js`、`handlers/partner/getPublic.js`、`handlers/customer/saveProfile.js`、`handlers/order/_create.js`（1 行）、`middleware/switch-session.js`、`pages/profile/parts/share-card.js`（32 行，新）、`pages/profile/index.js`、`pages/partner/customers/index.js`、`pkg-customer/pages/bind/*`、`tools/selftest-bind-cloud.js`（939+ 行，新）、`tools/selftest.js`、`tools/selftest-bind.js`、`tools/check.js`（#28 加固 +18/-10）。
- 关闭债务：TD-029（selftest-cloud 行数红线 → 拆出第 10 套）；TD-031（#28 变异首红取证 + 判据加固）。新增 TD-033（真实云 DB 事务冲突码/重试在真实环境未验证）。

## 6d. 批 4 离线收口证据（真实输出）

| 命令 | 结果 |
| :-- | :-- |
| `powershell -File check.ps1` | **4 步全 PASS，退出码 0** |
| `node tools/check.js` | 通过 **31 项**；失败 0 项 |
| `node tools/check-docs.js --batch 1` | 通过 **10 项**；失败 0 项 |
| `node tools/zero-money-scan.js --scope all` | **0 命中**（白名单 136 项） |
| `node tools/selftest.js` | 运行 **12 套**；失败 0 套；SKIP 0；**1,790 断言全 PASS**（core 58 / state 341 / recognize 187 / cloud 168 / ai 197 / bind 79 / bind-cloud 108 / order 126 / order-flow 135 / profile 98 / switch 140 / testaccount 153） |
| `node tools/selftest-order.js` | 断言 **126/126**；失败 0 项 |
| `node tools/selftest-order-flow.js` | 断言 **135/135**；失败 0 项 |
| `node tools/selftest-ai.js` | 断言 **197/197**；失败 0 项 |
| `node tools/sync-cloud-shared.js --check` | 16 源 × 2 套 32 件 hash 一致（共享副本未改） |
| 批 4 代码收口提交 | `a204ed1`（17 文件 +3036/-442；批 4 代码/判据） |

- 新增/修改代码文件（批 4）：`tools/selftest-order.js`（894 行，新）、`tools/selftest-order-flow.js`（761 行，新）、`cloudfunctions/api/handlers/order/{_create.js,_parcel.js}`、`cloudfunctions/api/handlers/ai/{_common.js,parseParcel.js}`、`cloudfunctions/api/lib/{ai/parse.js,id-generator.js}`、`api/{client.js,modules/order.js}`、`pkg-customer/pages/order-create/{index.js,index.wxml,index.wxss,parts/model.js,parts/ocr-flow.js}`、`tools/{selftest-ai.js,selftest.js}`。
- 真实缺陷（首红→复绿，均断言锁定）：①**跨域 P0** `nextOrderNos` 首桶只落 1 个 → 当天首单拆单后同日后续下单全挂（`INTERNAL_ERROR`）；②`order.create` 未知顶层字段静默忽略（DATA_MODEL §12 #12）；③AI 降级 DTO 多返 `duplicated` 越界键 + 重放分支第二份手写降级实现；④`ai.parseParcel` 票据过期/已消费漏判 `ticketInvalid`；⑤客户端幂等键每次调用现生成（弱网重试可重复建单）；⑥`buildPayload` 丢识别来源快照；⑦一图多码只外呼 1 次（违反 DATA_MODEL §4.9 按单调用）；⑧页面级预约/备注覆盖每件（违反 UX §3.7）；⑨降级后人话/识别原文/截图预览/服务类型说明缺失。
- 口径回写：ARCHITECTURE §3.1 `call(opts.clientRequestId)` + §3.2 order 模块签名；ENGINEERING §4.10.1 第 2/5/6 条（逐单调用、fileId 入队可为空、服务端不补建记录）与 §4.10.5 降级矩阵（`aiErrorCode` 值域以 DATA_MODEL §2.14 为单源）；DATA_MODEL §2.14 `fileId` 行补「入队可空、建单回填」；ENGINEERING §11 批 4 证据列补两套新套件。
- 新增债务：TD-034（逐件 AI 与 5 次/日配额）、TD-035（handler 测试无 fetch 注入口）、TD-036（降级 `source=NONE` 语义缝隙）、TD-037（下单入参严格白名单维护成本）、TD-038（AI 配额计数时点待产品确认）、TD-039（D22 无截图手填待用户裁决）；新增踩坑卡 2 张（计数器首桶、幂等键生命周期）。

## 6e. 批 5 离线收口证据（真实输出）

| 命令 | 结果 |
| :-- | :-- |
| `powershell -File check.ps1` | **4 步全 PASS，退出码 0** |
| `node tools/check.js` | 通过 **31 项**；失败 0 项 |
| `node tools/check-docs.js --batch 1` | 通过 **10 项**；失败 0 项 |
| `node tools/zero-money-scan.js --scope all` | **0 命中**（白名单 136 项） |
| `node tools/selftest.js` | 运行 **14 套**；失败 0 套；SKIP 0；**2,078 断言全 PASS**（core 58 / state 341 / recognize 187 / cloud 168 / ai 197 / bind 79 / bind-cloud 108 / order 126 / order-flow 135 / **order-lifecycle 98（新）** / **order-customer 190（新）** / profile 98 / switch 140 / testaccount 153） |
| `node tools/selftest-order-lifecycle.js` | 断言 **98/98**；失败 0 项（A~I：DTO/行动矩阵/列表分页计数/cancel/confirm/delete/越权/留言矩阵/imageUrl/补码 note） |
| `node tools/selftest-order-customer.js` | 断言 **190/190**；失败 0 项（A~G：七状态视图矩阵/轮询退避/倒计时/列表视图/reorder/静态纪律/真实 DTO 联调） |
| `node tools/sync-cloud-shared.js --check` | 16 源 × 2 套 32 件 hash 一致（共享副本未改） |
| 批 5 代码/判据提交 | `7eac662`（37 文件 +3189/-265；批 5 代码/判据/接口文档） |
| `gate.ps1 -Anchor 7ac53b5 -ScopeFiles "api/,cloudfunctions/,docs/,pages/,pkg-customer/,tools/" -Estimate 2400` | 红色 **0** 项；黄色 **0** 项（退出码 0）；变更集 37 件、范围 6 前缀全匹配、体量 **3,189 行 ≤ 3,600**、提交信息格式合规 |

- 新增/修改代码文件（批 5）：`tools/selftest-order-lifecycle.js`（968 行，新）、`tools/selftest-order-customer.js`（697 行，新）、`cloudfunctions/api/handlers/order/{_dto.js,listCustomer.js,imageUrl.js,correct.js}`、`cloudfunctions/api/handlers/message/send.js`、`api/{client.js,modules/order.js}`、`pkg-customer/parts/{poll-policy.js,order-detail-flow.js,status-view.js,format.js}`（前两件新）、`pages/customer/parts/orders-view.js`（新）、`pkg-customer/pages/{order-detail,order-create,order-create/parts/{reorder.js,bootstrap.js},messages}`、`pages/customer/{home,orders}`、`tools/{selftest.js,selftest-order.js,zero-money-allowlist.json}`。
- 真实缺陷（首红→复绿，均断言锁定）：①服务端顾客 `actions[]` 矩阵缺 `confirm/deleteRecord/reorder`，COMPLETED/CANCELLED 仍下发 `message`；②`message.send` 对终态订单仍可写（违反 CONTRACT §5 留言矩阵）；③`listCustomer` 无分组 `counts`（列表 tab 无计数）；④DTO `image` 只有 `hasImage`，无 `cleaned`（截图已清理仍可签发 URL）；⑤`order.correct` 补码事件无 `note`，「首屏即已补码」无法区分「补齐取件码」与普通更正（Lead 补丁契约）；⑥列表把 order DTO 直喂 `order-row` 组件导致取件码/站点/服务/时间四项全空；⑦详情轮询是死 `setInterval(10s)`、失败静默无退避/无「最近更新」（AC-C-29/E17）；⑧详情页本地按状态猜按钮（与服务端 actions 单源冲突）；⑨取消/确认/删除写动作不带 `expectedVersion`（并发覆盖无兜底）；⑩「再次下单」不存在（order-create 不读 `?reorder=`）；⑪消息中心「全部标为已读」不更新 store 红点、首页从不设置红点（E13）；⑫截图/异常/取消分支、回退与补码提示条缺失（§5.2/§5.5）。
- 口径回写：ARCHITECTURE §3.1（`opts.expectedVersion` 乐观锁与非法丢弃）+ §3.2 order 模块签名；DATA_MODEL §7.5（`order.get` actions/image、`listCustomer` counts、`message.send` 终态闸、`imageUrl` cleaned、批 5 只增约定）；ENGINEERING §6.2/§7.1/§7.2/§11 批 5；TECH_DEBT TD-040~042；`docs/lessons/` +2 卡（整对象透传字段全空、只增字段打红全等断言）；零金额白名单同步（V4_DATA_MODEL 行内容变更）。
- 新增债务：TD-040（`counts` 单次 find 500 条截断）、TD-041（详情写动作 `clientRequestId` 每次自生成，人工重试换键）、TD-042（补码文案跨端字面量，受 `shared/**` 冻结约束）；关闭债务：无（批 4 遗留明账继续跟踪）。

## 6f. 批 6 离线收口证据（真实输出）

| 命令 | 结果 |
| :-- | :-- |
| `powershell -File check.ps1` | **4 步全 PASS，退出码 0**（见 §8 收口记录，含提交后复跑） |
| `node tools/check.js` | 通过 **31 项**；失败 0 项 |
| `node tools/check-docs.js --batch 1` | 通过 **10 项**；失败 0 项 |
| `node tools/zero-money-scan.js --scope all` | **0 命中**（白名单 136 项） |
| `node tools/selftest.js` | 运行 **17 套**；失败 0 套；SKIP 0；**2,555 断言全 PASS**（core 58 / state 341 / recognize 187 / cloud 168 / ai 197 / bind 79 / bind-cloud 108 / order 126 / order-flow 135 / order-lifecycle 98 / order-customer 190 / **order-partner 127（新）** / **order-workbench 197（新）** / **order-detail-partner 153（新）** / profile 98 / switch 140 / testaccount 153） |
| `node tools/selftest-order-partner.js` | 断言 **127/127**；失败 0 项（A~H：listPartner counts/搜索/动作矩阵/CLOSED/批量 id/undo 窗/越权/静态；变异电池 5/5 红） |
| `node tools/selftest-order-workbench.js` | 断言 **197/197**；失败 0 项（A~G：选择资格/批量部分失败重试/撤销策略/筛选合并分页/引导/行级 actions/静态；变异电池 6/6 红） |
| `node tools/selftest-order-detail-partner.js` | 断言 **153/153**；失败 0 项（A~G：服务端动作矩阵七态/补码收窄/异常/送达/撤销/凭证/只读静态） |
| `node tools/sync-cloud-shared.js --check` | 16 源 × 2 套 32 件 hash 一致（共享副本未改） |
| 批 6 代码/判据提交 | `5abf140`（45 文件 +7326/-762；批 6 代码/判据/端侧） |
| `gate.ps1 -Anchor 39c9e49 -ScopeFiles "cloudfunctions/,docs/,pages/,pkg-partner/,tools/,STATE.md,README.md,CHANGELOG.md" -Estimate 5200` | 红色 **0** 项；黄色 **0** 项（退出码 0）；变更集 53 件、8 前缀全匹配、体量 **7,404 行 ≤ 7,800**、提交信息格式合规（收口终态 HEAD=`cdd3b81`） |

- 新增/修改代码文件（批 6）：服务端 `cloudfunctions/api/handlers/order/{_common.js,_dto.js,_create.js,listPartner.js,markPicked.js,markDelivered.js,unmarkPicked.js,unmarkDelivered.js,undo.js,reject.js,correct.js}`；端侧 `pages/partner/workbench/{index.js,index.wxml,index.wxss,parts/*}`（13 parts + 新套件）、`pkg-partner/pages/order-detail/**`（页面 + 10 parts）、`pages/profile/{index.js,index.wxml}`（重新看引导）；`tools/{selftest.js,selftest-order-partner.js,selftest-order-partner-cases.js,selftest-order-workbench.js,selftest-order-detail-partner.js}`。
- 真实缺陷（首红→复绿，均断言锁定）：①workbench 行 DTO 无 `actions[]`（行级操作无法单源）；②`batchActionId` 契约四动作被静默丢弃（批量分组不可审计，且非法 id 不拒）；③`todayCompleted` 100 截断探针暴露（DAO 无时间范围查询，TD-043）；④keyword 只搜 300 条窗口、完整订单号也漏（改唯一索引精确查询）；⑤SUSPENDED/CLOSED 仍能读工作台（`PARTNER_CLOSED` 补齐）；⑥PARTNER DELIVERED 下发非法 `correct`（点击必 `INVALID_TRANSITION`）；⑦`unmarkPicked/unmarkDelivered` 事件 `undoneAction` 写成自己（与 `order.undo` 两入口不一致）；⑧`order.undo` 撤销送达残留 `deliveryNote`；⑨DTO 把清空的 `pickedAt/deliveredAt` 序列化成真实时钟假时间；⑩`reject.OTHER` 无备注静默通过；端侧另修「非法 partnerNo 渲染造假」「DELIVERED 仍可补码建模」两处；工作台/详情按 UX §4 补齐 10+ 项达标点（行级动作、服务端筛选、批量部分失败保留重试、撤销条批量 id、counts 点击、引导编号、已完结分区、分页/行级 setData/骨架屏、凭证卡、面板）。
- 口径回写：DATA_MODEL §2.5（`batchActionId` 回填/形态闸）+ §7.3（`listPartner` workbench 行 actions/CLOSED 读闸 + 批 6 只增约定 ①~⑦）；ENGINEERING §7.1/§7.2（3 套命令）+ §11 批 6 行；TECH_DEBT TD-043~048；`docs/lessons/` +2 卡（契约入参静默丢弃、清空时间戳假时间）。
- 新增债务：TD-043（todayCompleted 精确计数需 DAO 窄口）、TD-044（keyword 部分匹配窗口）、TD-045（`lib/time.toMs` 空值兜底）、TD-046（admin 异常取消链不可达）、TD-047（listPartner 无 `since` 增量）、TD-048（终态总数/绑定空态数据源）；关闭债务：无（批 5 遗留明账继续跟踪）。

## 6g. 批 7 离线收口证据（真实输出）

| 命令 | 结果 |
| :-- | :-- |
| `powershell -File check.ps1` | **4 步全 PASS，退出码 0** |
| `node tools/check.js` | 通过 **31 项**；失败 0 项 |
| `node tools/check-docs.js --batch 1` | 通过 **10 项**；失败 0 项 |
| `node tools/zero-money-scan.js --scope all` | **0 命中**（白名单 136 项） |
| `node tools/selftest.js` | 运行 **21 套**；失败 0 套；SKIP 0；**3,132 断言全 PASS**（core 58 / state 341 / recognize 187 / cloud 168 / ai 197 / bind 79 / bind-cloud 108 / order 126 / order-flow 135 / order-lifecycle 98 / order-customer 190 / order-partner 127 / order-workbench 197 / order-detail-partner 153 / **partner-customers 129（新）** / **partner-orders 89（新）** / **partner-pages 156（新）** / **partner-stats 203（新）** / profile 98 / switch 140 / testaccount 153） |
| `node tools/selftest-partner-customers.js` | 断言 **129/129**；失败 0 项（A~F：listBindings 搜索/排序/分页/activeOrderCount、getCustomer 越权与订单过滤、stats 三区间与 isTest 排除、解绑按顾客判定、备注、静态；变异电池 5 处首红） |
| `node tools/selftest-partner-orders.js` | 断言 **89/89**；失败 0 项（A~G：bindingId 建单身份/guest 建单身份/互斥与白名单/批量原子/view=customer/DTO 隐私/静态；变异电池 5 处） |
| `node tools/selftest-partner-pages.js` | 断言 **156/156**；失败 0 项（A~G：列表视图/详情装配与自然日分组/解绑流程/两路径 payload/校验矩阵/READONLY/静态；变异电池 3 处） |
| `node tools/selftest-partner-stats.js` | 断言 **203/203**；失败 0 项（A~G：请求 payload/指标映射/7 日柱/日报文本/空错态/静态；变异电池 3 处） |
| `node tools/sync-cloud-shared.js --check` | 16 源 × 2 套 32 件 hash 一致（sync 后 30 件已一致） |
| 批 7 代码/判据提交 | `d34e35b`（48 文件 +7151/-1032；批 7 代码/判据/端侧） |
| `gate.ps1 -Anchor 2514cbb -ScopeFiles "api/,cloudfunctions/,docs/,pages/,pkg-partner/,shared/,tools/,utils/,README.md,STATE.md,CHANGELOG.md" -Estimate 5200`（终态回读，HEAD=`0dae5ba`） | 红色 **0** 项；黄色 **0** 项（退出码 0）；变更集 **59 件**、11 前缀全匹配、体量 **7,247 行 ≤ 7,800**、提交信息格式合规 |

- 新增/修改代码文件（批 7）：服务端 `cloudfunctions/api/handlers/partner/{_customer,getCustomer,stats,listBindings,unbindCustomer,saveCustomerNote,index}.js`、`handlers/order/{_create,_parcel,_store,listPartner}.js`；端侧 `pages/partner/customers/**`（+parts/list-model）、`pkg-partner/pages/{customer-detail,create-on-behalf,stats}/**`（+parts）、`pages/partner/workbench/index.js`（仅 completedDate 入参）、`utils/customer-view.js`；基础设施 `shared/actions.js`、`tools/lib/project.js`、`switch-session.js`、`api/modules/partner.js`；测试 `tools/selftest-partner-{customers,customers-cases,orders,orders-cases,pages,stats}.js`、`tools/selftest.js`、`tools/selftest-bind-cloud.js`。
- 真实缺陷（首红→复绿，均断言锁定）：①`partner.unbindCustomer` 进行中单按兼职全量误拦（他人有单导致本顾客不能解绑）；②`listBindings` 依赖 DB 字符串序（D10 排 D4 前）；③keyword/cursor/limit 服务端搜索分页全缺、activeOrderCount 混入 isTest；④`saveCustomerNote`/`unbindCustomer` 归属错误码 NOT_FOUND（§7.4 要求 FORBIDDEN 不泄露存在性）；⑤顾客详情用 `order.listPartner({keyword: customerNo})` 冒充按顾客过滤；⑥代客单只能 guest（绑定顾客单 `customerId=''`，顾客看不到进度）；⑦顾客单/批量 items 传 guest 被静默接受；⑧幂等重放 DTO 侧别按 customerId 判等（guest/绑定单回放成顾客视图）；⑨统计页 4×100 history 客户端累加（>400 单偏小）、完成率分母 0 显示 0%、异常按本地时区猜；⑩空数据画假柱；⑪「今日完成」无跳转协议；⑫解绑空原因可提交。
- 口径回写：CONTRACT §5.3 partner 行（getCustomer/stats）；DATA_MODEL §7.4 表与批 7 段（search/cursor/getCustomer/stats/解绑按顾客/隐私）、§7.5 表与批 7 段（bindingId/guest 互斥、view=customer、guest 内联）、§4.8 A（绑定顾客代客分支）、§4.7（requestKey 归属沿用）；UX_PARTNER §9（stats 服务端单源）；ENGINEERING §6.2/§7.1/§7.2/§11 批 7；TECH_DEBT TD-049/050；`docs/lessons/` +3 卡（关键词冒充过滤、二选一入参互斥、文档字段名漂移）。
- 新增债务：TD-049（`getCustomer.orders` 与 `listPartner view=customer` 双源，页面已统一 listPartner）、TD-050（partner 域扫描窗 100/300，DAO 无范围查询）；关闭债务：无（批 5/6 遗留明账继续跟踪）。

## 6h. 批 8 离线收口证据（真实输出）

| 命令 | 结果 |
| :-- | :-- |
| `powershell -File check.ps1` | **4 步全 PASS，退出码 0** |
| `node tools/check.js` | 通过 **31 项**；失败 0 项 |
| `node tools/check-docs.js --batch 1` | 通过 **10 项**；失败 0 项 |
| `node tools/zero-money-scan.js --scope all` | **0 命中**（白名单 136 项） |
| `node tools/selftest.js` | 运行 **27 套**；失败 0 套；SKIP 0；**4,062 断言全 PASS**（core 58 / state 341 / recognize 187 / cloud 168 / ai 197 / bind 79 / bind-cloud 108 / order 126 / order-flow 135 / order-lifecycle 98 / order-customer 190 / order-partner 127 / order-workbench 197 / order-detail-partner 153 / partner-customers 120 / partner-orders 89 / partner-pages 156 / partner-stats 203 / profile 98 / switch 140 / testaccount 153 / **admin 220（新）** / **messages 89（新）** / **cleanup 183（新）** / **admin-pages 145（新）** / **message-pages 138（新）** / **privacy-text 164（新）**） |
| `node tools/selftest-admin.js` | 断言 **220/220**；失败 0 项（A 白名单与维护闸 / B 脱敏 DTO / C 邀请码 / D 列表·config·stats·developerNo / E TD-046 异常介入取消 / F 复核四动作 / G 负向+注册表；变异电池 3 组） |
| `node tools/selftest-messages.js` | 断言 **89/89**；失败 0 项（聚合/水位/未读/markRead/分页/公告/权限/静态） |
| `node tools/selftest-cleanup.js` | 断言 **183/183**；失败 0 项（14 组：时间旅行阈值前后、重跑幂等、批上限、失败隔离、不变量、shared 副本 hash；变异电池 2 组） |
| `node tools/selftest-admin-pages.js` | 断言 **145/145**；失败 0 项（11 页视图模型/五态/脱敏/行标签/危险确认/抬头 developerNo；变异电池 5 组） |
| `node tools/selftest-message-pages.js` | 断言 **138/138**；失败 0 项（消息视图模型/水位/红点/公告/维护纯件/transport/静态；变异电池 4 组） |
| `node tools/selftest-privacy-text.js` | 断言 **164/164**；失败 0 项（A~G：docs 定稿关键条目 ⊆ 端内全文、launch/FAQ 同口径、版本注入、静态；变异电池 5 组） |
| `node tools/sync-cloud-shared.js --check` | 16 源 × 2 套 32 件 hash 一致 |
| `powershell -File gate.ps1 -Anchor 7134555 -ScopeFiles "api/,changelog.md,cloudfunctions/,components/,config/,custom-tab-bar/,docs/,pages/,pkg-admin/,pkg-customer/,pkg-partner/,readme.md,shared/,state.md,tools/,utils/" -Estimate 6000` | 红色 **0** 项；黄色 **0** 项（退出码 0）；变更集 **120 件**、16 前缀全匹配、体量 **8,180 行 ≤ 9,000**、提交信息格式合规 |

- 真实缺陷（首红→复绿，均断言锁定）：①**TD-046 两层根因**（隐私闸未豁免 `developerNo` → 开发者写动作全 `INVALID_STATE`；`identity.role` 对开发者恒空 → 订单侧解析不出 ADMIN）→ 隐私闸豁免 + `ADMIN_BUSINESS_ACTIONS` 动作域解析 + admin 仅 EXCEPTION 取消 + 审计；②**维护闸误拦读**（连 bootstrap/config.getPublic 都拒）→ 只拦写（读放行）；③**admin 越权面**（ADMIN 可 resolveException、cancel 允许全部进行中态）→ 后台仅 cancel、仅 EXCEPTION；④**`admin.updateConfig` 范围/白名单偏差**（avatarMaxBytes 上限 512000、隐私/测试账号键被误删）→ 按 DATA_MODEL §7.6 收口；⑤**message 域三缺陷**（unread 受分页游标影响、公告 enabled=false 仍下发、ADMIN 可改他人已读）；⑥**cleanup 全域运行必崩**（`assertCollection is not a function`）+ `image.cleanedAt` 未写 + 识别失败 IGNORED 原图残留/自引用/同轮二次处理；⑦cleanup 另 15 项（files 批遮挡、orderTimeout 锚点、tickets 已消费不删、rateLimits 前缀、viewSessions 混扫、retention 混扫、注销两阶段、孤儿级联、testData 重复审计、todayOrders 少算、CLEANUP 汇总审计缺失）；⑧后台端侧 13 项（订单总览必崩、11 页无权限五态、错误文案说假话、无效启用开关、维护关闭无确认、识别失败留存只读、邀请码/兼职/消息计数/AI 排障码等）；⑨消息/通知端侧 8 项（公告双份难关、announcement.enabled、兼职消息页分类/轮询/READONLY/去重、红点欠计、我的格无红点、我的页数字非红点）；⑩隐私文本端侧 6 项（全文滞后、launch 窄口径、FAQ 留存不全、版本未对齐、弹窗溢出、注销路径与真实 UI 不符）。
- 口径回写：CONTRACT §1.1（CLOSED 兜底口径）；DATA_MODEL §2.10（avatarMaxBytes 上限 204800）/§7.4/§7.5（getCustomer 去 orders）/§7.6（admin.stats developerNo、updateConfig 白名单）；UX_DEVELOPER §3.1（抬头数据源/「顾客」卡）/§3.8/§5.2（昵称 3 星）/§7.2（CLOSED）/§7.4（去展示开关）；ARCHITECTURE §3.5（parts 纯件/维护组件）/§4.2（cleanup 执行器）；ENGINEERING §4.7（TD-051 无主文件）/§7.1（批 8 测试层）/§7.2（取数）；RUNBOOK §7/§8/§9（12~17）；`config/defaults.js` 头像上限 500KB→200KB（sync 32 件一致）；`tools/check.js` #24 披露单文件窄豁免+补偿断言；TECH_DEBT 关闭 TD-030/046/049/052、新增 TD-051/052；`docs/lessons/` +N 卡。
- 新增债务：TD-051（云文件无主兜底不可自动实现，人工核对）；TD-052（端内隐私文本双源）批 8 内已关闭（单源 + 判据）；关闭债务：TD-030「测试」行标签、TD-046 异常介入取消、TD-049 getCustomer 双源、TD-052 隐私文本双源。

## 6i. 批 9 工程侧收口证据（真实输出）

| 命令 | 结果 |
| :-- | :-- |
| `powershell -File check.ps1` | **4 步全 PASS，退出码 0**（提交后复跑回读见 §8） |
| `node tools/check.js` | 通过 **31 项**；失败 0 项 |
| `node tools/check-docs.js --batch 1` | 通过 **10 项**；失败 0 项（文档范围含批 9 新增两件） |
| `node tools/zero-money-scan.js --scope all` | **0 命中**（白名单 136 项） |
| `node tools/selftest.js` | 运行 **28 套**；失败 0 套；SKIP 0；**4,151 断言全 PASS**（27 套 4,062 + **deletion 89（新）**） |
| `node tools/selftest-deletion.js` | 断言 **89/89**；失败 0 项（A `user.deleteAccount` handler / B cleanup 阶段一 / C 阶段二 30 天物理删与幂等 / D 兼职 CLOSED 全链 / E 修复回归与失败隔离 / F 端侧静态；先判据后修：首跑 14 条缺陷红；变异电池 3 组首红 + SHA256 还原） |
| `node tools/sync-cloud-shared.js --check` | 16 源 × 2 套 32 件 hash 一致（shared 未改） |
| QA 条目计数 | `(Select-String -Path docs\QA_CHECKLIST.md -Pattern '^\| [A-Z]+\d+ \|').Count` → **255**（批 8 后 249，批 9 增 H12~H17 共 6 条，分区合计与附录 E 自洽） |
| 批 9 代码/判据提交 | `81c58ba`（19 文件 +1633/-43；代码/判据/文档） |
| `powershell -File gate.ps1 -Anchor a07a4f5 -ScopeFiles "cloudfunctions/,docs/,readme.md,state.md,changelog.md,tools/" -Estimate 1200` | 红色 **0** 项；黄色 **0** 项（退出码 0）；变更集 **19 件**、6 前缀全匹配、体量 **1,635 行 ≤ 1,800**、提交信息格式合规；回读 HEAD=`ade2f6f`（代码/判据/文档 `81c58ba` → 证据回写 `ade2f6f` → 本勘误提交） |

- 新增/修改文件（批 9）：`tools/selftest-deletion.js`（838 行，新）、`tools/selftest.js`（注册第 28 套）、`tools/lib/project.js`（DESIGN_DOCS +2）；`cloudfunctions/api/handlers/user/deleteAccount.js`（52 行）、`cloudfunctions/api/handlers/admin/setPartnerStatus.js`（275 行）、`cloudfunctions/cleanup/sweeps/accounts.js`（270 行）；`docs/V4_REVIEW_MATERIALS.md`（206 行，新）、`docs/V4_V3_PARITY.md`（256 行，新）、`docs/RUNBOOK.md`（+83 行 §10 重写）、`docs/QA_CHECKLIST.md`（+11 行、H12~H17、E15/P6/P18 强化）、`docs/V4_CONTRACT.md`/`docs/V4_DATA_MODEL.md`/`docs/V4_ENGINEERING.md`/`docs/TECH_DEBT.md`/`docs/lessons/` 两张新卡/`README.md`/`CHANGELOG.md`/`STATE.md`。
- 真实缺陷（首红→复绿，均断言锁定）：①顾客注销阶段一漏清历史 `bindings.partnerNote`（含已释放行）；②注销/CLOSED 未清识别失败 `fileId`、原图引用未按引用计数回收；③兼职 `admin.setPartnerStatus(CLOSED)` 只写状态：未清 `displayName/avatarFileId`、未清停用与关闭原因、未删头像云文件、未清 `invitation_codes.usedBy`、未清识别失败 `uploaderOpenid`；④重复 CLOSED 幂等分支不保持空值。均修并断言锁定（14 条首红）。口径澄清：§7.6 注销幂等 vs 中间件 DEACTIVATED（端到端 FORBIDDEN、`duplicated` 仅 handler 直调可达）、§12#4 CLOSED 绑定返回 `NOT_FOUND`（编号作废不暴露存在性）、§10.4 两阶段时点（事务只做绑定释放+状态变更，匿名化/删图下一轮 cleanup）。
- 口径回写：CONTRACT §11.4（注销时点/兼职 CLOSED 执行细化/文件与 openid 保留理由）；DATA_MODEL §2.1 `purgeAt`、§7.6 幂等、§10.3/§10.4、§12#4；ENGINEERING §8.2 批 9 判据补充、§9.1 文档地图 +2、§10.4 审核材料引用、§11 批 9 行；README 文档地图 +2 与批 9 条目；TECH_DEBT 新增 TD-053~057；`docs/lessons/` +2 卡（注销链路多源 PII 漏清、文档立即与异步清理时点）。
- 新增债务：TD-053（`partners.openid` 保留作不可再激活锚点）、TD-054（`users.purgeAt` 未写）、TD-055（治理链非事务）、TD-056（兼职 CLOSED 会话结束审计时点）、TD-057（`moveOrdersToException` 500 单上限）；关闭债务：无。

## 7. 当前风险与红灯（如实记录）

1. **云端仅环境就绪**：唯一云环境已创建、envId 已回填（2026-10-22），但**集合、索引、安全规则、环境变量、触发器、存储权限、云函数部署均未在真实控制台执行**；批 1~批 9 的"绿"全部来自 fake-DB/纯件/静态门禁，**不等于云端已跑通**。任何"部署成功/联调成功"必须以 RUNBOOK §13 证据为准。
2. **云函数未在真实云环境部署**：`api`/`cleanup` 首次部署与 `health.check`/`admin.bootstrap` 冒烟是**当前第一阻塞项**（envId 已就绪，可立即执行；控制台无 OPENID 调 internal 动作走 `DEPLOY` 通道）。
3. **AI 兜底处于关闭状态**：`config.aiFallback.enabled` 初始 false，`DEEPSEEK_API_KEY` 未配置属预期降级。
4. **隐私文本为定稿候选**：`docs/privacy/隐私保护指引` 已升**定稿候选 v1.0**（端内全文单源 + 判据锁一致性），仍有 13 项用户填写/确认（§4 #14）与 `privacyVersion` 定稿写入（§4 #15）；批 9 提审前必须完成并逐项微信后台声明。
5. **D8 已裁决（2026-10-22）**：五苑展示名 = 东苑 / 西苑 / 南苑 / 北苑 / 翠苑；默认值已进 `shared/zones.js`（两个云函数副本已同步），后台仍可经 `config.zoneLabels` 覆盖。
6. **真机项全部未验证**：E5/E12/R2/R3 与 QA_CHECKLIST 人点检（含批 2 切换条/测试账号、批 3 绑定换绑、批 4 下单与识别兜底 D1~D12/R1~R4/M1~M3）均由用户执行，agent 不代勾、不代宣布通过。
7. **已知口径差异/欠账**：`docs/TECH_DEBT.md` 开放/跟踪中项（E5/E12、AI 兜底、订阅消息、cleanup 成本、fake DB 差异、TD-019、TD-022~025、TD-027、TD-032~045、TD-047/048、TD-050/051、TD-053~058）均为明账；不阻塞离线收口。
8. **测试文件行数余量变小**：`selftest-cloud` 保持 999 行（TD-029 关闭方式=不追加）；`selftest-ai` 892 行、`selftest-order` 895 行、`selftest-order-flow` 761 行、`selftest-order-lifecycle` 968 行、`selftest-order-customer` 697 行；批 6 新增 `selftest-order-partner` 997 行（夹具拆到 `-cases` 396 行）+ `selftest-order-workbench` 736 行 + `selftest-order-detail-partner` 650 行，后续批 7+ 新增断言应新开套件或先拆 `-cases`/压减，不能硬追加过 1000 行（门禁 #18）。
9. **安全判据自检**：批 3 已取 #28 变异首红并加固；`check.js` #29 admin 静态扫描不覆盖 `{ avatarFileId }` 简写（TD-032，`_dto.js` 整文件禁词 + selftest-testaccount 行为递归键集已覆盖输出面）。
10. **新增 TD-033**：`lib/tx.js` 的「事务冲突」判定依赖错误自述（`-50200x`/conflict 文案），真实云 DB 冲突码未在真实环境核对过；部署后按 RUNBOOK 冒烟时核对一次日志。
11. **批 4 遗留明账**：逐件 AI 调用会更快撞「5 次/人/日」配额（TD-034，已按 CONTRACT 逐单口径实现）；AI 配额计数时点为外呼前「失败也占次数」（TD-038，待产品确认）；handler 级 AI 测试用 `globalThis.fetch` 替换而非显式注入口（TD-035）；严格白名单新增字段需同步维护（TD-037）。
12. **D22 已裁决 A（2026-10-22）**：截图上传失败后**不允许**无截图手填提交（必须先有截图，上传失败只能重试/换图）；OCR/阅读失败仍可手填 `NEED_CODE`；UX §4.5 已限定，TD-039 关闭。
13. **批 5 遗留明账**：`order.listCustomer.counts` 单次 find 上限 500 截断（TD-040，极端历史量 tab 计数偏小）；详情写动作 `clientRequestId` 每次自生成（TD-041，靠状态机/乐观锁兜底）；补码文案 `CODE_FILLED_NOTE` 云端/端侧各一份字面量（TD-042，两端套件双向锁一致）。均不阻塞离线收口。
14. **批 6 遗留明账**：`todayCompleted` 仍 100 截断（TD-043，需冻结件 `db/dao.js` 查询运算符，Lead 未授权前不硬改）；keyword 非订单号部分匹配受 300 条窗口限制（TD-044，口径已声明降级）；`lib/time.toMs` 空值兜底 `Date.now()` 根因在他域（TD-045，DTO 层已防御）；admin 异常介入取消链不可达（TD-046，批 8 裁决）；`listPartner` 无 `since` 增量入参（TD-047，端侧已做行级合并）；已完结终态总数/绑定空态数据源缺口（TD-048，工作台以近似文案表达）。均不阻塞离线收口。
15. **批 6 判据有牙**：三套新判据均带变异电池首红（A 组 5/5、B 组 6/6、C 组由首轮 132/153 与 20 红→复绿）；`selftest-order-detail-partner` 的 DELIVERED `correct` 以「服务端误下发→页面不渲染」反例锁双保险，不依赖服务端现状。
16. **批 7 遗留明账**：`partner.getCustomer.orders` 与 `order.listPartner({view:'customer'})` 双源（页面已统一走后者，TD-049）；`partner.listBindings`/`activeOrderCount`/`partner.stats` 受等值查询扫描窗限制（绑定 100/每状态 300，TD-050，与 TD-043/044 合并立项）；解绑原因枚举由端侧固定 `PARTNER_INITIATED`、用户填写说明落 `releaseNote`（契约 reason 命中枚举，未提供枚举选择器）；统计「今日完成」跳工作台用 `wx.reLaunch` 带 `completedDate` 跨 tab（`switchTab` 不能带参，真机待验）。均不阻塞离线收口。
17. **批 7 判据有牙**：四套新判据均带变异电池首红（customers 5 处、orders 5 处、pages 3 处、stats 3 处，均 SHA256 还原后复跑绿）；first-red 共 31+20+12+35 条；`selftest-partner-orders` 以「顾客单传 guest 仍 ok」反例锁二选一互斥，`selftest-partner-pages` G5 静态锁 `view:'customer'` 包络。
18. **批 8 遗留明账**：TD-051（云文件无主/无引用无法自动发现→控制台人工月度核对，RUNBOOK §7；P1 票据回写 fileID 后自动化）；TD-032（#29 静态扫描 `{ avatarFileId }` 简写盲区，行为套兜底）继续开放；TD-036（AI 降级 DTO `source=NONE` 语义缝隙，复核页已把排障码映射中文，语义待批 9 复核页真机确认）；TD-033/TD-035/TD-037/TD-038/TD-040~045/TD-047/048/050 继续明账。均不阻塞离线收口。
19. **批 8 判据有牙**：6 套新判据均带变异电池首红（admin 3 组 / messages 行为断言 / cleanup 2 组 / admin-pages 5 组 / message-pages 4 组 / privacy-text 5 组，均 SHA256 逐字节还原后复跑绿）；`selftest-admin` 以「非白名单调用 / 他人票据 / 模式篡改 / TEST_WRITE 调禁用动作」负向矩阵锁越权，`selftest-cleanup` 以「阈值前不动 + 重跑 acted 收敛」锁时间旅行与幂等，`selftest-privacy-text` A 组以「docs 关键条目 ⊆ 端内全文」锁双源。
20. **批 8 工程口径**：`tools/check.js` #24 对端内隐私全文（`pkg-customer/parts/privacy-text.js`）做**单文件窄豁免**（同时补偿断言锁零 Key/端点/URL/require/fetch/wx.cloud/ai.parseParcel），因 CONTRACT §11.2 要求端内明文披露第三方 AI 服务名；`admin.stats` 返回 `developerNo`（仅抬头/审计展示、不参与鉴权）；cleanup `run.js` 每轮写一条 `CLEANUP` 汇总审计（10 分钟一轮，严格按 ENGINEERING §10.2 步骤 11；如嫌刷屏 P1 可降噪）。
21. **批 9 注销链路遗留明账**：TD-053（`partners.openid` 保留作不可再激活身份锚点，DATA_MODEL §10.3 的 openid 匿名化待 users 侧标记方案）、TD-054（`users.purgeAt` 未写，cleanup 按 `deletionRequestedAt` 扫描）、TD-055（`admin.setPartnerStatus(CLOSED)` 治理链非事务，文件删除在事务外）、TD-056（兼职 CLOSED 后既有切换会话未立即 `endedAt`，靠 viewSessions sweep 到期）、TD-057（`moveOrdersToException` 500 单上限）；另：§7.6 注销幂等（端到端被中间件 DEACTIVATED 拦截为 `FORBIDDEN`，`duplicated` 仅 handler 直调可达）、兼职 CLOSED 订单不随关闭立即匿名化（终态 180 天留存口径）已在文档澄清。均不阻塞离线收口，但不可当作「注销链路已真机验证」。
22. **批 9 判据有牙**：`selftest-deletion` 首跑 14 条缺陷红（先判据后修），修后 3 组变异电池（删 partnerNote 清除行 / 删阶段一清 partnerNote 调用 / 删 clearInvitationUsage 调用）均首红 + SHA256 逐字节还原 + 复跑 89/89 PASS；套件以 `EXPECTED_ASSERTIONS=89` 完整性闸防漏算。
23. **批 9 文档为「用户执行清单」不是验收结论**：`docs/V4_REVIEW_MATERIALS.md`、`docs/V4_V3_PARITY.md`、RUNBOOK §10.6 演练记录表、QA H12~H17 均需用户执行/填写；agent 不代提审、不代勾、不宣布通过；发布前置为 D13 类目可选性/备案、隐私后台声明、13 项填写、`privacyVersion` 写入、灰度观测与回滚演练记录非空。
24. **单环境无 staging（D1 修订，2026-10-22）**：账号只能开通 1 个云环境 ⇒ 开发/体验/正式**共用一个库与存储**，上线后没有可随意试错的独立环境。缓解：测试账号/`isTest` 标记隔离 + 上线前「单环境清零」（RUNBOOK §10.2.1）+ 结构/数据变更前导出 JSON 备份（R7）+ 发布侧用体验版验收与平台分阶段发布做灰度；已登记 TD-058。**不得在正式库随意造测试数据**。
25. **云端首跑 P0 写库缺陷（已修，用户已重新部署并复验通过）**：2026-10-22 用户首次真实调用即暴露——「同意隐私政策」稳定 `INTERNAL_ERROR`，云函数日志 `-502001 Cannot create field 'at' in element {privacyConsent: null}`（`users.privacyConsent` 初值 `null`，嵌套对象 update 被 `wx-server-sdk` 拍平成点路径 `$set`）。已修：两个 `db/dao.js` 的 `update/updateWhere` 统一整值替换（`command.set`）；`tools/fake-db.js` 复刻真实拍平/空父级语义并新增 `db.command.set`；判据 +6（cloud 169→174、order-partner 127→128）；变异首红取证。**复验**：用户重新部署 `api` 后「同意隐私政策」与后台总览均可用（部署后另见 26）。**残余风险**：①`cleanup` 云函数含同一 dao 修复，建议同步重新部署（未部署不阻塞已复验功能）；②同类"嵌套对象写在 null/标量父级"写点已按 dao 统一语义覆盖，但**真实云 DB 的其它行为差异**（如事务冲突码、`-50200x` 文案）仍需按 RUNBOOK 冒烟逐一核对（TD-033）。
26. **后台总览 `-502005`（控制台手建集合名拼错，用户侧已修正）**：2026-10-22 后台总览 `admin.stats` 稳定 `INTERNAL_ERROR`；云端日志 `-502005 ... Db or Table not exist: invitation_codes`——控制台集合名被手打为 `inbitation_codes`（拼错的集合无代码引用，创建时不会报错）。用户在控制台删除拼错集合、按正确名字新建并补权限/索引后总览恢复。RUNBOOK §3.5 已补「集合名逐字复制 + `missingCollections: []` 自检 + 拼错集合清场」（提交 `a06a20d`）与 lessons 卡；代码无需改动。
27. **「成为兼职」邀请码输入即清空（已修，待用户重新编译复验）**：2026-10-22 真机输入第一个字符后输入框立刻变空、无法输入（不报错）。根因：激活页 `onCodeInput` 用 `validateInvitationCode(raw).canonical` 做实时回显，该校验在"未满 12 位/含字母表外字符"时返回 `ok:false` 且不带 `canonical` → 回显被清空。已修：新增纯件 `pkg-partner/pages/activate/parts/code-input-model.js`（`stateOfInput` 用可部分归一的 `canonicalCode` + 4 位分组 + 12 位截断；`isValid` 整串校验作提交闸）；判据 `selftest-partner-pages` +9（156→165），变异回旧实现 4 条首红 + SHA256 还原；**纯客户端改动，用户重新编译模拟器即可复验，无需重新部署云函数**。
28. **测试文件行数余量**：拆出 `tools/selftest-cloud-fixtures.js`（夹具 85 行）后 `selftest-cloud` 994 行、`selftest-order-partner` 1000 行（均 ≤1000，门禁 #18）；后续新增断言须先拆夹具/新开套件，不能硬追加。

## 8. 最近更新

| 日期 | 事件 |
| :-- | :-- |
| 2026-10-21 | 批 0 设计定稿（CONTRACT v0.9 及全部设计文档；D18~D21 四次修订回写；隐私两件升草案） |
| 2026-10-21 | 批 1 开工提交 `d5ad214`：app.json 页面地图冻结、ARCHITECTURE 接口冻结、根配置改造 |
| 2026-10-21 | 批 1 并行开发（S0~S16）：云端/页面/组件/工具链/测试全部落盘；期间关闭多项门禁裁决与 bug（fake-db 三处、listPartner raw 文档泄露、saveProfile 角色死锁、bind 幂等、四档排序归属等） |
| 2026-10-21 | **批 1 收口提交 `d125b42`**：`check.ps1` 4 步全 PASS（退出码 0）、9 套 selftest 1,014 断言全 PASS、`gate.ps1` 红色 0 / 黄色 0（退出码 0）、`doctor.ps1` 15 通过 1 告警 0 失败；批 2 未开工 |
| 2026-10-21 | **计数勘误（仅文档）**：收口条目首版误记 selftest 合计 1,011（cloud 122）；按 `node tools/selftest.js` 实跑与 `d125b42` 内 `tools/selftest-cloud.js`（`EXPECTED_ASSERTIONS=125`）修正为 **1,014**（cloud 125），STATE/README/CHANGELOG 三处同步；代码与门禁结论不变 |
| 2026-10-21 | **计数勘误提交 `86d9ac6`**（docs-only，3 文件 +8/-6）：`check.ps1` 复跑 4 步全 PASS（退出码 0）、selftest 9 套 1,014 断言全 PASS；`gate.ps1 -Anchor 9c97e6d -ScopeFiles "STATE.md,README.md,CHANGELOG.md" -Estimate 10` 红色 0 / 黄色 0（退出码 0） |
| 2026-10-22 | **批 2 离线开工**（Agent Team 并行 task-48/49/50/52）：云端身份域、端侧入口、切换会话/测试账号、上传/时间闸四个工作流；D1/D2 未到前只做离线代码与机器判据，真机项不代验 |
| 2026-10-22 | **批 2 离线收口提交 `619f39a`**（39 文件 +1740/-286）：修 2 个真虫（activate 过期码可激活、退出会话必失败）+ 兼职 READONLY targetId 口径 + 上传服务端闸空转 + 后台测试账号 8 项缺口；9 套 selftest 1,261 断言、`check.ps1` 退出码 0；文档回写 ARCHITECTURE/DATA_MODEL/CONTRACT/UX_CUSTOMER/UX_DEVELOPER/QA/TECH_DEBT |
| 2026-10-22 | **批 2 证据回写**（docs-only）：STATE/CHANGELOG 同步 1,261 断言与 TD 关闭；`zero-money-allowlist.json` 压成 138 行以过 gate 500 行门禁；批 2-D 变异电池（task-51）随后补 |
| 2026-10-22 | **批 2 变异电池 + 门禁 #29 自检修复**：新增 `tools/mutation.ps1`（366 行/BOM/LF，支持 `-File` 逗号串多命令）与 `docs/lessons/` 首卡；#31/#30 首红取证；M21 暴露并修复 **#29 空集全绿**（脱敏件路径 `db/dto/mask.js` 缺失判红 + `_dto.js` 禁词 + admin 键扫描 + selftest-testaccount +18 行为断言，135→153）；`gate.ps1` 行数档对齐 `check.js #18`（`tools/` ≤1000）；TD-002 关闭、TD-031/032 登记；9 套 **1,279** 断言全 PASS、`check.ps1` 退出码 0 |
| 2026-10-22 | **批 3 离线开工**（Agent Team 并行 task-55/56/57/58/59）：云端绑定域代码、新断言套件、端侧分享卡/绑定页、#28 变异电池、兼职客户页分享收口五个工作流 |
| 2026-10-22 | **批 3 真实 bug 修复**：①`handlers/order/_create.js:239` `COLLECTIONS.orders` 小写 → undefined，`order.create/createBatch` 重复预查 100% `INTERNAL_ERROR`（新套件 G1/G2/G6 首红定位，一行修复）；②`switch-session.js` TEST_WRITE 未放行 `partner.getPublic` → 测试会话绑定预览受阻（新增 `TEST_WRITE_READ_ALLOW`，READONLY 不动）；③bind 页 `prefixHint` 对象直接进 data（改取 `.message`） |
| 2026-10-22 | **批 3 #28 判据空转取证与加固（TD-031）**：变异 M1（删角色守卫）加固前 check.js 与行为套双绿=空转（旧判据被文件头注释满足）；`check.js` #28 改「去注释后 守卫调用 + 真实 `errors.forbidden(` + 自绑比较」三条同时命中；M1/M2 复验首红 + SHA256 还原 + 复跑绿 |
| 2026-10-22 | **批 3 离线收口**：`check.ps1` 4 步全 PASS（退出码 0）——check.js 31/31、check-docs 10/10、零金额 0 命中、selftest **10 套 1,418 断言**全 PASS（新增 `selftest-bind-cloud` 108）；TD-029/TD-031 关闭、新增 TD-033；CONTRACT/DATA_MODEL/ENGINEERING/README/TECH_DEBT/lessons 回写 |
| 2026-10-22 | **批 4 离线开工**（Agent Team 并行 task-60/61/62）：建单引擎与票据判据、AI 兜底判据、四步下单端侧三个工作流；D1/D2 未到前只做离线代码与机器判据 |
| 2026-10-22 | **批 4 真实缺陷修复（首红定位）**：①跨域 P0 `lib/id-generator.nextOrderNos` 首桶只落 `seq=1`（首单拆单后当天后续下单全 `INTERNAL_ERROR`）→ `{key,seq:total}` 一行修复（Lead 授权，D5b/D5c 回归断言）；②`order.create` 未知字段静默忽略 → 严格白名单 `VALIDATION_FAILED`；③`recognition.source=DEEPSEEK` 被忽略 → 落库/DTO 均可透传；④批量仅首单关联 failureId → 逐单 `items[i].recognition.failureId` 解析+回填；⑤AI 降级 DTO 多返 `duplicated` + 重放第二份手写降级 → 统一 `buildDegradedDto`（恰 10 键）；⑥票据过期/已消费漏判 `ticketInvalid` → 补判；⑦客户端从不发 `clientRequestId`（重试可重复建单）→ submission id 生命周期；⑧`buildPayload` 丢识别来源 → 逐单 `recognition.source`；⑨同图多单只外呼 1 次 → 逐件 `ai.parseParcel`（DATA_MODEL §4.9）；⑩页面级预约/备注覆盖每件 → 逐件独立 |
| 2026-10-22 | **批 4 离线收口**：`check.ps1` 4 步全 PASS（退出码 0）——check.js 31/31、check-docs 10/10、零金额 0 命中、selftest **12 套 1,790 断言**全 PASS（新增 `selftest-order` 126、`selftest-order-flow` 135；`selftest-ai` 86→197）；提交 `a204ed1`（17 文件 +3036/-442）；TD-034~039 登记、lessons +2 卡；ARCHITECTURE/ENGINEERING/DATA_MODEL/README/CHANGELOG 回写；D22 登记待用户裁决 |
| 2026-10-22 | **批 5 离线开工**（Agent Team 并行 task-63/64/66/67）：云端订单闭环（actions 矩阵/counts/终态留言闸/image.cleaned/乐观锁/补码 note）+ 顾客端闭环（列表 counts 与倒计时、详情轮询退避与进度分支、再次下单、消息红点）两个工作流 + Lead 补码 note 联动补丁；D1/D2 未到前只做离线代码与机器判据 |
| 2026-10-22 | **批 5 真实缺陷修复（首红定位）**：①服务端顾客 `actions[]` 缺 confirm/deleteRecord/reorder 且终态仍下发 message；②`message.send` 终态可写（违反 CONTRACT §5 留言矩阵）；③列表无分组 counts；④image 无 cleaned（已清理截图仍签 URL）；⑤补码事件无 note 无法区分；⑥列表 DTO 直喂组件四字段全空；⑦详情轮询死 setInterval 无退避/无最近更新；⑧页面本地猜按钮违 actions 单源；⑨写动作丢 expectedVersion；⑩无再次下单（`?reorder=` 未接）；⑪消息红点不归零、首页从不设红点；⑫截图/异常/取消分支与回退/补码提示条缺失。均修并断言锁定 |
| 2026-10-22 | **批 6 离线开工**（Agent Team 并行 task-68/69/70）：云端兼职域（workbench 行 actions/batchActionId/搜索/CLOSED）、工作台端侧（行级动作/批量/撤销/筛选/性能/引导）、详情端侧（补码/异常/送达/凭证/只读）三个工作流 + Lead 集成（`tools/selftest.js` 注册 3 套、`pages/profile` 重新看引导、文档回写）；D1/D2 未到前只做离线代码与机器判据 |
| 2026-10-22 | **批 6 真实缺陷修复（首红定位）**：①workbench 行 DTO 无 `actions[]`；②§7.3 四动作 `batchActionId` 静默丢弃（批量分组不可审计 + 非法 id 不拒）；③`todayCompleted` 100 截断探针；④keyword 完整订单号也漏（改唯一索引精确查询）；⑤SUSPENDED/CLOSED 仍可读工作台；⑥PARTNER DELIVERED 下发非法 `correct`；⑦`unmark*` 事件 `undoneAction` 写错；⑧`undo` 撤销送达残留 `deliveryNote`；⑨DTO 清空时间戳变真实时钟假时间；⑩`reject.OTHER` 无备注静默通过；端侧另修「非法 partnerNo 渲染造假」「DELIVERED 仍可补码建模」，并按 UX §4 补齐行级动作/服务端筛选/部分失败重试/撤销条批量 id/引导编号/已完结分区/分页行级 setData/骨架屏/凭证卡等达标点 |
| 2026-10-22 | **批 6 离线收口**：`check.ps1` 4 步全 PASS（退出码 0）——check.js 31/31、check-docs 10/10、零金额 0 命中、selftest **17 套 2,555 断言**全 PASS（新增 `selftest-order-partner` 127、`selftest-order-workbench` 197、`selftest-order-detail-partner` 153）；提交：代码/判据 `5abf140`（45 文件 +7326/-762）+ 证据回写 `cdd3b81`；`gate.ps1 -Anchor 39c9e49` 红色 0 / 黄色 0（53 件、体量 7,404 行 ≤ 7,800）；TD-043~048 登记、lessons +2 卡；DATA_MODEL/ENGINEERING/README/CHANGELOG 回写 |
| 2026-10-22 | **批 7 离线开工**（Agent Team 并行 task-71/72/73/74）：云端客户/统计域（listBindings 重构 + getCustomer + stats + 解绑修复）、云端代客下单（bindingId/guest 双路径 + listPartner view=customer）、端侧客户档案三页、端侧统计与日报四个工作流；Lead 先冻结批 7 接口口径（CONTRACT §5.3 + DATA_MODEL §7.4/§7.5/§4.8 + UX §9 + shared/actions/project 注册）再派发；D1/D2 未到前只做离线代码与机器判据 |
| 2026-10-22 | **批 7 真实缺陷修复（首红定位）**：①unbind 进行中单全量误拦；②listBindings 字符串序（D10→D4 前）；③keyword/cursor/limit 全缺 + activeOrderCount 混 isTest；④归属错误码 NOT_FOUND→FORBIDDEN；⑤顾客详情 keyword 冒充按顾客过滤；⑥代客单只能 guest；⑦顾客单/批量 guest 静默接受；⑧重放侧别错判；⑨统计 4×100 累加近似/完成率 0%/本地时区；⑩空数据假柱；⑪今日完成无跳转协议；⑫解绑空原因可提交。均修并断言锁定 |
| 2026-10-22 | **批 7 离线收口**：`check.ps1` 4 步全 PASS（退出码 0）——check.js 31/31、check-docs 10/10、零金额 0 命中、selftest **21 套 3,132 断言**全 PASS（新增 `selftest-partner-customers` 129、`selftest-partner-orders` 89、`selftest-partner-pages` 156、`selftest-partner-stats` 203）；提交：代码/判据 `d34e35b`（48 文件 +7151/-1032）+ 证据回写 `0dae5ba`；`gate.ps1 -Anchor 2514cbb` 红色 0 / 黄色 0（59 件、体量 7,247 行 ≤ 7,800）；TD-049/050 登记、lessons +3 卡；CONTRACT/DATA_MODEL/UX_PARTNER/ENGINEERING/README/CHANGELOG 回写 |
| 2026-10-22 | **批 8 离线开工**（Agent Team 并行 task-75/76/77/78/79 + 80/81/82）：服务端后台/消息中心、cleanup 13 sweep、后台 11 页、通知与维护、隐私文本与 QA 六个工作流；Lead 先回写 CONTRACT/DATA_MODEL/UX/ARCHITECTURE 口径与 `config/defaults.js`/`check.js` #24 后再派发；D1/D2 未到前只做离线代码与机器判据 |
| 2026-10-22 | **批 8 真实缺陷修复（首红定位）**：①TD-046 两层根因（隐私闸未豁免开发者 → 全链 `INVALID_STATE`；`identity.role` 对开发者恒空 → 订单侧解析不出 ADMIN）；②维护闸误拦读（连 bootstrap/config.getPublic 都拒 → 端侧公告无法展示）；③admin 越权面（ADMIN 可 resolveException、cancel 允许全部进行中态）；④`admin.updateConfig` 范围/白名单偏差（avatarMaxBytes 上限 512000、隐私/测试账号键被误删）；⑤message 三缺陷（unread 受游标影响、公告 enabled=false 仍下发、ADMIN 可改他人已读）；⑥cleanup 全域运行必崩（`assertCollection is not a function`）+ `image.cleanedAt` 未写 + 识别失败 IGNORED 原图残留/自引用；⑦cleanup 另 15 项（files 批遮挡、orderTimeout 锚点、tickets 已消费不删、rateLimits 前缀、viewSessions/retention 混扫、注销两阶段、孤儿级联、testData 重复审计、todayOrders 少算、CLEANUP 汇总审计缺失）；⑧后台端侧 13 项（订单总览必崩、11 页无权限五态、错误文案说假话、无效启用开关、维护关闭无确认、识别失败留存只读、邀请码/兼职/消息计数/AI 排障码等）；⑨消息/通知端侧 8 项（公告双份难关、announcement.enabled、兼职消息分类/轮询/READONLY/去重、红点欠计、我的格无红点、我的页数字非红点）；⑩隐私端侧 6 项（全文滞后、launch 窄口径、FAQ 留存不全、版本未对齐、弹窗溢出、注销路径与真实 UI 不符）。均修并断言锁定 |
| 2026-10-22 | **批 8 离线收口**：`check.ps1` 4 步全 PASS（退出码 0）——check.js 31/31、check-docs 10/10、零金额 0 命中、selftest **27 套 4,062 断言**全 PASS（新增 `selftest-admin` 220、`selftest-messages` 89、`selftest-cleanup` 183、`selftest-admin-pages` 145、`selftest-message-pages` 138、`selftest-privacy-text` 164）；提交：代码/判据 `08cd421`（117 文件 +8118/-1565）+ 证据回写 `ae9a8ab`；`gate.ps1 -Anchor 7134555` 红色 0 / 黄色 0（120 件、体量 8,180 行 ≤ 9,000）；TD-030/046/049 关闭、TD-051/052 登记（052 已关闭）、lessons +3 卡；CONTRACT/DATA_MODEL/UX_DEVELOPER/ARCHITECTURE/ENGINEERING/RUNBOOK/README/CHANGELOG 回写 |
| 2026-10-22 | **批 8 收口证据勘误/终态记录**：gate 终态 120 件/8,180 行，`gate.ps1` 红色 0 / 黄色 0（退出码 0）；收口终态 HEAD=`ae9a8ab`（代码 `08cd421` → 证据 `ae9a8ab` → 本勘误提交） |
| 2026-10-22 | **批 9 工程侧开工**（4 条并行线复用既有 Team 分身）：云端注销链路端到端判据（cloud-core）、审核材料手册（v4-privacy-qa）、v3 对照验收表（v3-engineering）、灰度回滚演练与 QA 批 9（v3-lifecycle-flow）；Lead 同步做文档地图/证据与门禁集成；D1/D2/D3 未到前只做离线代码/判据/文档 |
| 2026-10-22 | **批 9 真实缺陷修复（首红定位）**：新建 `selftest-deletion` 先判据后修 14 条红——①顾客注销阶段一漏清历史 `bindings.partnerNote`（含已释放行）；②注销/CLOSED 未清识别失败 `fileId` 与原图引用；③兼职 CLOSED 只写状态（未清 `displayName/avatarFileId`、未删头像文件、未清 `invitation_codes.usedBy`、未清识别失败 `uploaderOpenid`）；④重复 CLOSED 不保持匿名化空值；并回写 CONTRACT §11.4 注销时点与 DATA_MODEL §10.3/§10.4/§7.6/§12#4 口径 |
| 2026-10-22 | **批 9 工程侧收口**：`check.ps1` 4 步全 PASS（退出码 0）——check.js 31/31、check-docs 10/10、零金额 0 命中、selftest **28 套 4,151 断言**全 PASS（新增 `selftest-deletion` 89）；交付 `docs/V4_REVIEW_MATERIALS.md`（206 行）、`docs/V4_V3_PARITY.md`（256 行）、RUNBOOK §10 灰度/回滚演练、QA §H12~H17（附录 E 255 条）；TD-053~057 登记、lessons +2 卡；README/CONTRACT/DATA_MODEL/ENGINEERING/CHANGELOG 回写 |
| 2026-10-22 | **批 9 收口提交**：代码/判据/文档提交 `81c58ba`（19 文件 +1633/-43）；证据回写提交 `ade2f6f`；`gate.ps1 -Anchor a07a4f5` 红色 **0** / 黄色 **0**（退出码 0；变更 19 件、体量 **1,635 行 ≤ 1,800**、HEAD=`ade2f6f`）；本勘误提交补 gate 终态 |
| 2026-10-22 | **批 9 证据回写**：提交 `ade2f6f` 更新 STATE §6i/§8、CHANGELOG 批 9 工程细节与 README 现状计数；`check.ps1` 4 步复跑全 PASS 后进入发布前用户侧 |
| 2026-10-22 | **用户裁决回写（D1~D22 全部闭环）**：用户回复 D1 A；**D2 沿用 v3 appid `wxcb7e5b41b89bc806`**；D3 A；D13 个人主体+工具类目；D8 东/西/南/北/翠苑；D22 A；其余按推荐。落地：`project.config.json` appid、`shared/zones.js` 默认苑名（两个云函数副本已 sync）、`utils/storage.js` 注释；CONTRACT/DECISIONS/README/ENGINEERING/DATA_MODEL/三份 UX/RUNBOOK/TECH_DEBT/REVIEW_MATERIALS/V3_PARITY/REBUILD_SPEC/INTERIM 回写；TD-005（D8）、TD-039（D22）关闭；`check.ps1` 4 步全 PASS |
| 2026-10-22 | **D1 单环境修订**：用户告知「云开发我只能开通一个环境」→ 单环境方案落地（选项 A 不变）：`config/env.js` 改单 `ENV_ID`（三档同值、保留映射形状）、`doctor.ps1`/`tools/seed-dev.js` 占位断言改 `__ENV_ID__`；CONTRACT §2/§13、DECISIONS D1 修订留痕、ENGINEERING §3.3/§4.6/§6.1/§6.2/§10.1~§10.3、RUNBOOK §1/§2/§3.1/§3.8/§4/§10/§12/§13（新增 §10.2.1 单环境清零）、QA Q1/H8/附录 A/批 9 判定、REVIEW H8、V3_PARITY、INTERIM v0.3、README、REBUILD_SPEC、TECH_DEBT TD-058 回写；`check.ps1` 4 步全 PASS |
| 2026-10-22 | **云端首跑 P0 写库缺陷（修复 + 判据 + 回写）**：用户首次真实调用暴露「同意隐私政策」稳定 `INTERNAL_ERROR`；云函数日志定位 `-502001 Cannot create field 'at' in element {privacyConsent: null}`（`users.privacyConsent` 初值 `null`，嵌套对象 update 被 `wx-server-sdk` 拍平成点路径）。修：api/cleanup 两个 `db/dao.js` 的 `update/updateWhere` 统一整值替换（`command.set`）；`tools/fake-db.js` 复刻真实拍平/空父级语义 + `db.command.set`，夹具拆到 `selftest-cloud-fixtures.js`；判据 +6（cloud 169→174：dao 写入探针 + 空父级反例 + null 父级整值替换；order-partner 127→128：G6b exception 恢复后再上报）；变异首红（去掉 dao 包装 → cloud 6 红，含真实报错同形文案）；ARCHITECTURE §4.1/§4.2、ENGINEERING §7.3、lessons 新卡、CHANGELOG 回写；**用户重新部署 `api` 后复验通过（隐私同意可用）** |
| 2026-10-22 | **后台总览 `-502005` 排查（控制台集合名拼错）**：云端日志 `Db or Table not exist: invitation_codes` → 控制台手建集合名被拼成 `inbitation_codes`；用户删除拼错集合、按正确名字新建并补权限/索引后总览恢复；RUNBOOK §3.5 增「集合名逐字复制 + `missingCollections: []` 自检 + 拼错集合清场」与 lessons 卡（提交 `a06a20d`）；代码未改 |
| 2026-10-22 | **「成为兼职」邀请码输入即清空（修复 + 判据）**：真机输入首字符输入框即变空；根因激活页用 `validateInvitationCode(raw).canonical` 做实时回显（未满 12 位时该校验不带 `canonical` → 清空）。修：新增纯件 `pkg-partner/pages/activate/parts/code-input-model.js`（`stateOfInput` 可部分归一 + 4 位分组 + 12 位截断，`isValid` 作提交闸）；`selftest-partner-pages` +9（156→165），变异回旧实现 4 条首红 + SHA256 还原 + 复跑绿；纯客户端改动，**待用户重新编译模拟器复验** |
| 2026-10-22 | **测试账号切换未水合身份（修复 + 判据；用户真机反馈「测试账号无法激活、无法绑定」）**：进入后台测试顾客/兼职会话后页面沿用开发者空身份（测试顾客显示「资料未完善」、测试兼职「我的」显示「待激活」且无编号）。根因：`account-switch` 只写 `viewContext` 就 reLaunch、从未 `user.bootstrap`；且 `store.hydrateFromBootstrap` 会被服务端 `viewContext`（永不回票据）覆盖导致丢 `viewTicket`。修：新增 `utils/session.js` 统一进入/退出水合（进入=写 viewContext→bootstrap→hydrate→reLaunch；退出=viewAsEnd→清→bootstrap 复位→回账号切换），`store` 水合保留本地票据；判据 `selftest-switch` +23（140→163）、`selftest-testaccount` +18 固定测试对端到端（153→171：创建固定测试顾客+测试兼职→TEST_WRITE→直接绑定→双向可见→会话内激活被拒），变异三处首红（4/1/1）+ SHA256 还原复跑绿；ARCHITECTURE/ENGINEERING/UX_DEVELOPER/CHANGELOG/lessons 回写；纯客户端改动，**待用户重新编译模拟器复验** |

> 说明：上表最后两行为收口当天记录，提交哈希与 gate 终态以仓库 `git log` 与门禁真实输出为准（本文件不在提交内自引用哈希）。

## 9. 下一步（按序）

1. **云环境部署（进行中）**：`api` 已部署并经「隐私同意 + 后台总览」真实调用复验；剩余按序核对——14 集合/索引/安全规则（集合名已逐字核对、`uk_code` 已补）、`cleanup` 部署与 10 分钟触发器、存储权限、`admin.bootstrap` 冒烟（`missingCollections: []`）与 15 项唯一索引逐项核对；证据按 `docs/RUNBOOK.md` §3 采集并逐行更新 §13。发布前按 RUNBOOK §10.2.1 做「单环境清零」。
2. **首次部署冒烟**：`node tools/sync-cloud-shared.js` → 部署 `api`/`cleanup` → `health.check`/`admin.bootstrap` → 单条 10 分钟定时触发器 → RUNBOOK「首次部署」清单。
3. **批 2 真机点检**（只能用户）：E12 头像/昵称能力、隐私弹窗、切换条黄/蓝与退出、测试账号单机双端（绑定→下单→确认）、邀请码负向、开发者 entry；按 `docs/QA_CHECKLIST.md` 批 2 分区（A1~A10、A13~A14、B1~B5、Q5、Q7、P9、P13~P14）取证。
4. **批 3 真机点检**：绑定/换绑/解绑、roomTag 大写与并发（B6~B9、C1~C13）。
5. **批 4 真机点检**：D1~D12（截图→核对→服务→提交、一图多码拆单、手填兜底、结果块）、R1~R4（造假失败图→AI 等待态/成功预填/不覆盖手填/静默降级）、M1~M3（零金额巡检）；真实云部署后补 D8/D9/D12 控制台项与 R2/R3 真机取证。
6. **批 5 真机点检**：E1~E8（双机 10s 内进度同步、确认送达、取消与原因、拒单原因、超时自动取消/24h 自动完成）、E12~E18（留言与只读归档、消息中心红点、删除记录、双方编号复制、弱网重试与「最近更新」、订单无头像昵称快照）、双机 T1~T13；按 `docs/QA_CHECKLIST.md` 批 5 分区取证。
7. **批 6 真机点检**（只能用户）：QA `F1~F15`/`F21`/`F23`——首用引导、站点聚合、四档动线、需查明补齐、接单拒单、单件取件撤销、批量取件/送达/改站点改码、搜索、筛选、长列表、弱网、新单提醒、顾客取消、切换角色、兼职端无绑定入口；双机新单红点与 30s 轮询、tabBar 角标、骨架屏/长列表性能；按 `docs/QA_CHECKLIST.md` 批 6 分区取证。
8. **批 7 真机点检**（只能用户）：QA `F16`（客户档案/备注：只看到绑定自己顾客、`partnerNote` 顾客不可见、解绑后不再显示头像昵称）、`F18`（代客下单：已绑定顾客单顾客可见进度、guest 单顾客看不到进度、绑定后只看新单）、`F20`（统计页只有单量、无费用字段、测试数据不计入）、`F22`（客户档案头像+昵称+编号、guest 默认头像+"代客单"标签）；另点检客户列表服务端搜索/分页、详情「查看更早」、解绑原因必填与二次确认、统计「今日完成」跨 tab 跳工作台（`reLaunch` 带参）、头像/昵称 onShow 重取；按 `docs/QA_CHECKLIST.md` 批 7 分区取证。
9. **批 8 真机点检**（只能用户）：QA §G（开发者后台与治理 G1~G17）、§V（只读视角 V1~V20）、§T（账号切换与测试账号 T1~T17）、§R（识别兜底与复核 R5~R15）、§P（隐私 P8/P10/P19~P22）、§S 隔离负向；另点检维护模式（读可用/写拒绝+端侧公告）、消息中心红点/公告/已读、我的 tab 红点、后台抬头 developerNo 与脱敏截图、审计可查；并完成 §4 #14 隐私 13 项填写、#15 privacyVersion 写入、#16 每月无主文件核对；按 `docs/QA_CHECKLIST.md` 批 8 分区取证。
10. **批 9 工程侧已收口，剩余为纯用户侧**：a) 首次部署冒烟（§9 第 1~2 步；D1~D22 已全部裁决，D1 已修订为单环境）——**2026-10-22 首跑已暴露 P0 写库缺陷并修复（§7 #25），需重新「上传并部署：云端安装依赖」`api` 后复验「同意隐私政策」，并把 `cleanup` 一并部署**；b) 按 `docs/V4_REVIEW_MATERIALS.md` §1 准备审核材料，§7 三项演示方式裁决后填 §3 模板并提审；c) 按 RUNBOOK §10 跑门禁回执（含 10.2.1 单环境清零）→ 灰度分批 → 观测判停 → R1/R3/R4/R5/R6 回滚演练并填 §10.6（记录表为空不得全量）；d) 批 2~9 真机点检（QA 附录 B 各批分区 + §H12~H17）与隐私 13 项填写/微信后台逐项声明/`privacyVersion` 写入；e) 发布后按 `docs/V4_V3_PARITY.md` §5.3 勾选归档，更新 CHANGELOG/STATE；f) **测试账号单机验收复验（本次修复）**：重新编译模拟器（纯客户端，无需重新部署云函数）→ 后台「切换账号 → 测试账号」建 1 个测试顾客 + 1 个测试兼职 → 进入测试顾客会话（应直接显示资料完整/无「待激活」假状态）→ 首页输入测试兼职编号 → 查询 → 确认绑定（固定测试对直接绑定成功）→ 切测试兼职会话，客户列表应见该测试顾客。
11. **每批 DoD 不变**：`check.ps1` 退出码 0 + 真实输出 + 本批验收逐条打勾 + 文档回写；真机/控制台/提审/发布项只能用户执行，agent 不代勾、不代宣布通过。

## 10. 维护规则

1. 本文件是**唯一状态源**；其他文档不写"当前进度"叙述，只写设计与验收。
2. 只有 Lead（或 Lead 明确指派者）更新本文件；其他 agent 发现状态变化时回报 Lead。
3. 与 `CHANGELOG.md` 同日条目保持一致；风险/欠账与 `docs/TECH_DEBT.md` 编号互链。
4. 数字不写死：进度以任务板与门禁真实输出为准，本文不抄测试条数（收口证据表除外，须与真实输出同源）。
