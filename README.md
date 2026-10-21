# expressage_college_v4 · 校园快递代取（第四次重建 · 面向客户）

> **当前阶段：批 6 完成（2026-10-22 收口）· 工程骨架 + 两个云函数 + 30 页面 + 组件/工具链齐备，`check.ps1` 全绿（4 步、退出码 0；`check.js` 31/31、`check-docs` 10/10、零金额 0 命中、selftest 17 套 2,555 断言）· 待用户闭环 D1/D2/D3/D13（云环境/主体）、D8（苑名）与 D22（上传失败后无截图手填）后进入真机与云端联调**
> 本目录从微信小程序默认模板重建；v1 / v2 / v3 已冻结为只读参照：
> `D:\Code\expresseage\expresseage_college\`（v1）、`D:\Code\expresseage\expresseage_college_v2\`（v2）、`D:\Code\expresseage_college_v3\`（v3）。

## 这一版是什么

v4 把 v3 的「兼职单人台账」升级为 **顾客下单 + 兼职接单履约 + 开发者治理** 的小程序，**只负责下单、接单与信息整理（取件码与站点），不涉及任何金钱交易**：

- **顾客**：微信登录 → 采集**微信头像（`chooseAvatar`，可跳过→默认头像）与微信昵称（`nickname` 输入，必填可改）** → 完善宿舍身份（DXNBC 五苑 + 楼栋 + 宿舍号 + 可选手机尾号，服务端分配同寝室**大写** `A/B/C…` 标识）→ 获得**顾客编号**（`C-XXXX-XXXX`）→ **主动绑定**一位兼职（凭**兼职编号** `P-XXX-XXX`；绑定只能顾客发起）→ 上传取件码截图下单、选择服务类型 → 跟踪订单进度。**无支付/费用环节**。截图识别失败时会自动走 **DeepSeek AI 兜底**（服务端、仅去敏文本、≤8s），仍失败可手填，截图（**含原图**）进入开发者复核队列。
- **兼职人员**：凭**开发者发放的邀请码**开通 → 采集**头像/昵称** → 获得**兼职编号** → 沿用 v3 按驿站站点聚合的取件清单 → 接单/取件/送达/异常处理 → 单量统计；**只能看到绑定自己的顾客与订单**，**不能绑定顾客、只能分享绑定卡片邀请顾客自己绑定**。**无收款/结算/收入功能**。
- **开发者账号**（特殊角色，MVP 建议 1 个，白名单可配 `DEV-01/DEV-02…`）：**邀请码生效控制**（生成/批量/有效期/作废/审计）、**后台数据查看**（顾客/兼职/订单/绑定/审计，默认脱敏、不展示头像）、兼职停启用、异常介入、全局配置、**识别失败复核**（看原图+补录+忽略+通知）、**只读切换到真实顾客/兼职视角**（黄条+服务端拒写+全程审计），以及**切换测试账号（可写）**做单机两端验收（蓝条+`TEST` 角标；测试数据隔离/排除统计/30 天清理）。

**零金钱口径（用户硬性要求）**：不做在线支付、收款、记账、结算，**不计算运费、不做价格表、不出现任何金额字段/计算/文案**；服务只保留"服务类型"（做什么），不表达"多少钱"。

**本期不做**：任何金钱/支付/收费/运费/价格相关；地图路线规划；自动派单/抢单市场；多校区；评分评价（P2）；快递公司接口/电子面单；**真实账号可写视角**（只读；可写只给测试账号）；**应用内切换微信登录账号**（平台不支持）；**真实账号与测试账号互绑/互下单**（严格隔离）；客户端直连第三方 AI（Key 只允许在云函数环境变量）；把原图直传第三方（DeepSeek 当前无视觉 API，原图只留私有云存储供复核）。

## 文档地图（先读这个顺序）

| 顺序 | 文档 | 内容 |
| :-- | :-- | :-- |
| 1 | [`docs/V4_CONTRACT.md`](docs/V4_CONTRACT.md) | **唯一口径卡 v0.9**：角色/术语/编号规格/集合/状态机/页面地图/隐私/账号切换/裁决索引；文档冲突以它为准 |
| 2 | [`V4_REBUILD_SPEC.md`](V4_REBUILD_SPEC.md) | 主规格书：产品/架构/权限/流程/批次/验收/风险/裁决 |
| 3 | [`docs/V4_DECISIONS.md`](docs/V4_DECISIONS.md) | **D1~D22 裁决清单**（开工前要看，含推荐与被否方案；D20/D21 已定；D22 批 4 登记待裁） |
| 4 | [`docs/V4_DATA_MODEL.md`](docs/V4_DATA_MODEL.md) | 集合/字段/索引/云函数 API 契约/编号规则/roomTag/头像/测试账号/识别失败队列/安全规则/越权测试 |
| 5 | [`docs/V4_UX_CUSTOMER.md`](docs/V4_UX_CUSTOMER.md) | 顾客端逐页交互、下单四步、头像昵称采集、AI 兜底态、进度矩阵、异常与验收 |
| 6 | [`docs/V4_UX_PARTNER.md`](docs/V4_UX_PARTNER.md) | 兼职端逐页交互、工作台（取件清单）体验补全、绑定单向/顾客档案头像、代客单 AI 兜底、v3→v4 对照 |
| 7 | [`docs/V4_UX_DEVELOPER.md`](docs/V4_UX_DEVELOPER.md) | 开发者后台逐页交互、邀请码生效控制、后台数据查看、**识别失败复核（含原图）**、**账号切换（真实只读/测试可写）**、审计 |
| 8 | [`docs/V4_ENGINEERING.md`](docs/V4_ENGINEERING.md) | 工程结构、云开发资源、测试/门禁（零金额 + AI 兜底 + v0.9 #28~#31）、部署 runbook、批 0~9 技术拆分 |
| 9 | [`docs/QA_CHECKLIST.md`](docs/QA_CHECKLIST.md) | 真机/双机/测试账号人工点检清单（发布前必须人执行，agent 不代宣布通过） |
| 10 | [`docs/privacy/`](docs/privacy/) | 隐私指引**草案** + 发布前填写清单（含头像/昵称/账号切换披露；上线前由人填写/审核） |
| 附 | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`STATE.md`](STATE.md) · [`docs/RUNBOOK.md`](docs/RUNBOOK.md) · [`AGENTS.md`](AGENTS.md) | 代码分层/冻结接口与写作用域、当前状态唯一源、部署 runbook、仓库级 agent 纪律 |

## 需要你（用户）先裁决的 22 件事

见 [`docs/V4_DECISIONS.md`](docs/V4_DECISIONS.md)。

- **开工门**：D1（后端=微信云开发）、D2（appid=`wxf98c87a293092ef5`）、D3（兼职=邀请码）、D13（主体/类目）。
- **已按你的指示关闭**：D5（服务只分类型、不含价格）、D6（零金钱交易，不算运费、无价格表）、D20（绑定只能顾客发起）、D21（roomTag 恒大写）。
- **二次修订新增**：D14（真实账号视角切换默认只读）、D15（编号样式：`C-XXXX-XXXX` / `P-XXX-XXX` / `DEV-01`）。
- **三次修订新增**：D16（OCR 失败用 DeepSeek 兜底：服务端/去敏文本/8s 超时/5 次每人每日/静默降级）、D17（识别失败原图进后台复核：仅白名单/临时 URL/逐次审计/不批量/保留 30 天）。
- **四次修订新增**：D18（账号切换：真实账号只读 + **测试账号可写**，单机验收两端）、D19（微信头像/昵称采集与可见范围）。
- **批 4 登记**：D22（截图上传失败后是否允许**无截图手填提交**；现状=保持「必须先有截图」，待你裁决，不阻塞离线收口）。
- 其余 D4/D7~D12 无特别说明按推荐执行。

回复格式示例：`D1 A；D2 A；D3 A；D8 五个苑叫 ……；D14 A；D15 A；D16 A；D17 A；D18 A；D19 A；其余按推荐`。

## 与 v1~v3 的关系

- v1/v2/v3 **只读参照**，v4 不读取、不写入它们的任何本机存储键。
- v4 使用**新 appid**（v4 模板里的 `wxf98c87a293092ef5`）⇒ 独立 storage / 独立云开发环境 / 独立隐私声明与审核。
- **v3 数据不迁移**（D11）：v4 空库起；v3 旧小程序可继续留在手机上。
- 复用 v3 的纯逻辑资产（OCR/取件码解析/站点/楼栋/门禁思路），但**丢弃** chatpick 会话键、本机单键存储、无账号模型、以及任何收款/金额相关实现。
- 新增**双角色唯一编号**（顾客 `C-…`、兼职 `P-…`）与**开发者账号/账号切换**——v3 没有这些概念。
- 新增**识别失败兜底与复核**（v0.8）：OCR 失败时服务端调 DeepSeek（只发去敏文本），仍失败则含原图进开发者复核队列；**第三方 AI 仅处理去敏文本，原图不出本程序云存储**。
- 新增**微信头像/昵称**（v0.9，仅绑定双方可见、后台不展示、注销删除）与**测试账号可写切换**（v0.9，后台合成账号、与真实数据严格隔离、不计统计）。
- ⚠️ **隐私承诺变更**：v3 是"数据只存本机、不上传"；v4 面向客户必须存云端账号，并新增开发者后台治理访问（默认脱敏）、只读视角（审计）、**头像/昵称采集与展示**、**第三方 AI 文本处理与识别失败原图复核**。上线前必须先定稿隐私指引与用户协议（先改文本再改代码）。

## 工程现状（批 1 收口 + 批 2/批 3/批 4/批 5/批 6 离线收口，2026-10-22）

- **代码**：511 个文件（`git ls-files` 计数）；小程序端 30 页（主包 7 + `pkg-customer` 5 + `pkg-partner` 7 + `pkg-admin` 11）四件套齐全；`components/` 15 套 + `custom-tab-bar/`（根目录）+ tabbar 资产；`api/`（client 唯一出口 + 10 个域模块 + upload/privacy/mode-guard）、`store/`、`shared/` 13 件口径纯件 + `utils/` 纯件。
- **云端**：`cloudfunctions/api`（index/router/app + 7 中间件 + db/dao + lib + 11 域 handlers 66 个 client 动作 + admin.bootstrap/health.check 内部动作）与 `cloudfunctions/cleanup`（13 个幂等 sweep + 独立 dao），依赖只 `wx-server-sdk`；14 集合/13 错误码/审计枚举三端一致。
- **门禁**（真实输出）：`check.ps1` 4 步全 PASS（退出码 0）——`check.js` 31/31、`check-docs.js --batch 1` 10/10、零金额扫描 0 命中、`selftest.js` **17 套 2,555 条断言**全 PASS（core 58 / state 341 / recognize 187 / cloud 168 / ai 197 / bind 79 / bind-cloud 108 / order 126 / order-flow 135 / order-lifecycle 98 / order-customer 190 / **order-partner 127** / **order-workbench 197** / **order-detail-partner 153** / profile 98 / switch 140 / testaccount 153）；另有 `tools/mutation.ps1` 变异电池（#28/#29/#30/#31 安全判据均有首红证据；批 6 三套新判据另有 5/5、6/6 变异首红）。
- **批 2 离线收口**（提交 `619f39a`/`d79963d`）：账号入口（launch 隐私闸/角色分流/`lastRole` 建议/头像昵称采集/邀请码激活/开发者分流）、切换会话与测试账号（真实只读 + 测试可写 + 四动作 + dryRun 级联 + 审计）、头像上传服务端 size/类型闸（`api/upload` 顺序修正）、`lib/time.isPast` Date 归一；期间修复 2 个真虫（过期邀请码可激活、退出会话必失败）与兼职 READONLY targetId 口径等 10 项缺口。真机项（E12/切换条/测试账号单机双端）待用户点检。
- **批 3 离线收口**：绑定方向固化全链（PARTNER 调用 `FORBIDDEN`/自绑拒绝/真实×测试拒绝/编号归一+错前缀同源提示/roomTag 大写事务分配+并发冲突有界重试/换绑与换宿舍=旧绑定释放+新建/解绑即失联/getPublic 绑定前不回头像/接单开关 `PARTNER_CLOSED`）；绑定卡分享 path 单一来源（`pages/profile/parts/share-card.js`）；新建第 10 套断言套件（`tools/selftest-bind-cloud.js`，拆掉 TD-029 行数红线）；`check.js` #28 改为去注释三条同时命中 + 变异首红（TD-031 关闭）。**真实 bug 2 个**：`order.create/createBatch` 重复预查集合键写小写（`COLLECTIONS.orders`）导致正常下单 100% `INTERNAL_ERROR`（一行修复）；TEST_WRITE 会话未放行 `partner.getPublic` 导致测试账号绑定预览受阻（新增 `TEST_WRITE_READ_ALLOW`，READONLY 不动）。真机绑定/换绑待用户点检。
- **批 4 离线收口**（提交 `a204ed1`，17 文件 +3036/-442）：建单引擎与票据/批量原子性判据（新 `tools/selftest-order.js`）、AI 兜底判据扩到 197 断言（配额/票据五类失效/降级 DTO 10 键/入队去 PII/规则优先）、四步下单端侧（`clientRequestId` 生命周期、同图多单**逐件** `ai.parseParcel`、逐件预约/备注、识别来源快照、识别原文/截图预览/服务类型说明；新 `tools/selftest-order-flow.js`）。**真实缺陷（首红→复绿）**：①跨域 P0 `lib/id-generator.nextOrderNos` 当天首桶只落 `seq=1` → 同日首单拆单后后续下单全 `INTERNAL_ERROR`（`{key,seq:total}` 一行修复）；②`order.create` 未知字段静默忽略→严格白名单；③AI 降级 DTO 越界键 `duplicated`+双出口；④票据过期/已消费漏判；⑤客户端从不发 `clientRequestId`（弱网重试可重复建单）；⑥识别来源快照丢失；⑦同图多码只外呼 1 次；⑧页面级预约/备注覆盖每件；⑨降级后人话/原文/预览/服务说明缺失。真机项 D1~D12/R1~R4/M1~M3 待用户点检。
- **批 5 离线收口**（提交 `7eac662`，37 文件 +3189/-265）：顾客订单闭环——服务端 `order.get` 顾客七态 `actions[]` 单源矩阵（cancel/confirm/deleteRecord/reorder/message，终态无 message）、`listCustomer.counts` 三桶、DTO `image{hasImage,cleaned}`、`message.send` 终态闸、`imageUrl` 已清理拒绝、`order.correct` 补码事件 note、写动作 `expectedVersion` 乐观锁（`api/client` 透传）；端侧列表分组计数与等待接单倒计时、详情 10s 轮询失败退避（20s→40s）+「最近更新」、五节点进度 + 异常/取消分支、事件时间线、截图四态、留言只读归档、再次下单（`?reorder=` 只预填服务类型/站点）、双方编号与订单号复制、首页消息红点；新增第 13/14 套 `tools/selftest-order-lifecycle.js`（98 断言）与 `tools/selftest-order-customer.js`（190 断言）。**真实缺陷 12 项（首红→复绿，均断言锁定）**：actions 矩阵缺键/终态可留言/无分组 counts/image 无 cleaned/补码不可区分/列表 DTO 直喂组件四字段全空/详情轮询死 `setInterval`/页面本地猜按钮/写动作丢 expectedVersion/无再次下单/消息红点不归零/截图异常取消分支缺失。真机项 E1~E8、E12~E18 与双机 T1~T13 待用户点检。
- **批 6 离线收口**（提交 `5abf140`，45 文件 +7326/-762）：兼职工作台——服务端 `order.listPartner({view:'workbench'})` 行内联 `actions[]`（PARTNER 矩阵 + 5s undo 窗）、`batchActionId` 落库 `orders.batchActionId`（形态闸/零落库）、SUSPENDED/CLOSED 读闸、完整订单号唯一索引精确搜索、PARTNER DELIVERED 去非法 correct、`order.undo` 撤送达清 `deliveryNote`、`unmark*` 事件 `undoneAction` 口径、DTO 清空时间戳不再变假时间、`reject.OTHER` 必填备注；端侧工作台 13 个 parts 纯件（行级操作只消费服务端 actions + expectedVersion、状态筛选服务端化 + 需查明/筛选空态、多选资格、批量逐单同 `batchActionId` + 部分失败保留重试、撤销条批量 id/部分失败文案、counts 点击 + tabBar 待接单红点、引导+兼职编号、已完结自然日分区、首屏 30 游标分页 + 轮询行级 setData + 骨架屏）、详情页（补码/改站点 P1~P8 + PICKED 收窄 + DELIVERED 隐藏、异常六原因、送达 note/快捷标签/guest 自动完成、凭证卡、只读收敛）、`pages/profile` 重新看引导；新增 `tools/selftest-order-partner.js`（127）+ `selftest-order-workbench.js`（197）+ `selftest-order-detail-partner.js`（153）。**真实缺陷 10 项（首红→复绿，均断言锁定）**：工作台行无 actions、batchActionId 静默丢弃、todayCompleted 100 截断探针、keyword 越窗漏单、CLOSED 仍可读、DELIVERED 非法 correct、unmark 事件 undoneAction 写错、undo 残留 deliveryNote、空时间戳假时间、reject.OTHER 无备注。真机项 F1~F15/F21/F23 与双机红点/30s 轮询待用户点检。
- **已闭环工程裁决**：`docs/TECH_DEBT.md` TD-017（四档排序归客户端）、TD-018（公开配置含 `viewTicketTtlMinutes`）、TD-007/008/009（upload/privacy 接纯件）、TD-026（上传服务端闸空转）、TD-029（测试文件行数红线，批 3 拆第 10 套）、TD-031（#28 变异首红+加固）、TD-034~039 为批 4 新增跟踪项（逐件 AI 与配额/测试 fetch 注入口/降级 source 语义/严格白名单维护/配额计数时点/**D22 无截图手填待裁**）、TD-040~042（counts 500 截断/写动作幂等键生命周期/补码文案跨端字面量）、TD-043~048 为批 6 新增跟踪项（todayCompleted DAO 窄口/keyword 部分匹配窗口/time.toMs 空值兜底/admin 取消链/listPartner 无 since/终态总数近似）；未闭 TD 为 E5/E12 真机项、D8 苑名、P1 预留、TD-030（后台「测试」行标签）/TD-032（#29 简写静态盲区）/TD-033（真实云事务冲突码待核）。
- **尚未执行（只能用户做）**：`git` 已初始化并提交；云开发环境创建、`config/env.js` 回填 envId、14 集合/索引/安全规则、`ADMIN_OPENIDS`/`DEEPSEEK_API_KEY` 环境变量、定时触发器、存储权限、真机点检（含批 5 `E1~E8`/`E12~E18` 与双机 `T1~T13`、批 6 `F1~F15`/`F21`/`F23` 与双机红点/30s 轮询）、隐私后台声明与提审——按 `docs/RUNBOOK.md` 执行并留证据；未部署前云函数未在真实云环境跑过（fake-DB 单测已覆盖核心路径）。
