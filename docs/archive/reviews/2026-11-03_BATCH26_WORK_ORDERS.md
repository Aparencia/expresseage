# 批 26 派工单（D58 转派全栈 + D59 服务端/共享冻结）

> **状态：已冻结（Lead 2026-11-03）。** 派工依据 = 本文 + `2026-11-03_BATCH26_27_INTERFACE_DRAFT.md`（下称「草案」）。与 CONTRACT 冲突时以 CONTRACT 为准并先停手回报 Lead。
> 本批**只做批 26**：D58 全栈（服务端/兼职端/顾客端可见性/后台只读）+ D59 服务端与共享冻结。**D59 客户端与 D63 = 批 27，不在本批**。
> 纪律：AGENTS.md §4/§5/§8 全量适用；**任何 agent 不得 `git commit`/`git tag`/跑 `check.ps1`/`gate.ps1`**（Lead 收口）；不得改他人作用域文件；UTF-8 无 BOM + LF；源码单文件 ≤500 行、测试 ≤1000 行、单函数 ≤50 行。

## 0. Lead 裁决（草案 §4 全部关闭，已并入 CONTRACT §13 D58/D59/D63 行）

| # | 裁决 | # | 裁决 |
| :-- | :-- | :-- | :-- |
| Q1 | A 复用 `order.listPartner({view:'transfer'})` + 顶层 `transferPending` | Q9 | A 子队员发起转派限本队；主兼职可转任意 ACTIVE |
| Q2 | A 惰性过期（读到 `PENDING` 且 `now>expiresAt` 先落 `EXPIRED`） | Q10 | A 新分包页 `pkg-partner/pages/team/index`（32→33，批 27 落） |
| Q3 | A `pickedCount>0` 禁止发起转派（`INVALID_STATE`） | Q11 | A 解除隶属 + `SUSPENDED`（`suspendedReason='TEAM_REMOVED'`） |
| Q4 | A 订单离开 `ACCEPTED` → 邀请 `EXPIRED`（`STATE_CHANGED`），确认报 `INVALID_STATE` | Q12 | A 不新增 audit 枚举（证据落 `order_events`/`invitation_codes`/`partners`） |
| Q5 | A 顾客侧只显示 `partnerNo` + `fulfillmentPartnerNo` | Q13 | A 隐私披露 = CONTRACT §11.2 v1.10 新增项（批 27 回写文本） |
| Q6 | A 目标兼职 DTO 不给 `customerNo/displayName/avatarUrl`，给 `roomTag/delivery/parcels/note` | Q14 | A 新增 `TITLES.BIND_CUSTOMER`（批 27） |
| Q7 | A 主兼职可见子队员 `partnerNo`+`displayName`（无头像） | Q15 | A 分享入口只在 `pages/profile`（批 27） |
| Q8 | A 目标只校验 `status==='ACTIVE'` | — | — |

**本批全局红线**：错误码恒 13 个、集合恒 14 个、**只新增 5 个 `TRANSFER_*` 事件（19→24）**；零金额；页面层零业务判据（不出现 `PENDING/ACCEPTED` 等状态字面量、零 `wx.cloud.*`、零编号生成）；云函数零 `db.collection`；`cloudfunctions/*/shared/**` 只由 `node tools/sync-cloud-shared.js` 生成。

## 1. W1 · 冻结层（S1 + S0 + config + 套件接线）

**任务板**：`b26-shared`。**写作用域**：`shared/**`、`config/defaults.js`、`api/modules/{order,partner,index}.js`、`tools/selftest-state.js`、`tools/selftest.js`（仅 SUITES）、`check.ps1`（仅 `SelfTestSuites`）。**不动**：`cloudfunctions/**`、`docs/**`、页面、其他 selftest 套件。

### 1.1 `shared/enums.js`
- `ORDER_EVENTS` 追加 5 项（顺序：在 `GUEST_ORDER_CLAIMED` 之后）：`TRANSFER_REQUESTED/TRANSFER_ACCEPTED/TRANSFER_DECLINED/TRANSFER_CANCELLED/TRANSFER_EXPIRED`；`ORDER_EVENT_COUNT = 24`。
- 新增导出：`TRANSFER_STATUS = {PENDING,ACCEPTED,DECLINED,CANCELLED,EXPIRED}`、`TRANSFER_STATUS_TEXT`（待对方确认/已转派/对方已拒收/已撤回/邀请已过期）、`TRANSFER_RESOLVE_REASON = {TARGET_ACCEPTED,TARGET_DECLINED,FROM_CANCELLED,EXPIRED,STATE_CHANGED}`、`MESSAGE_HIDDEN_EVENT_TYPES = ['TRANSFER_REQUESTED','TRANSFER_DECLINED','TRANSFER_CANCELLED','TRANSFER_EXPIRED']`、`INVITATION_KIND = {DEV:'DEV',SUB:'SUB'}`。
- 事件人话文案：若单源在 `shared/enums.js`（`ORDER_EVENT_TEXT` 之类）则补 5 条（`TRANSFER_ACCEPTED` =「由 P-xxx 接手履约」口径、其余为内部事件，文案仍要中性）；**单源若在别处只报告、不跨域改**。
- 不导出「成员状态」新枚举：沿用 `PARTNER_STATUS`。

### 1.2 `shared/actions.js`
- `CLIENT_RULES` +4 `order.*`（`requestTransfer/acceptTransfer/declineTransfer/cancelTransfer` 均 `true`）。
- `CLIENT_RULES` +4 `partner.*`（`createSubInvites/revokeSubInvite/removeSubMember` 为 `true`，`listSubMembers` 为 `false`）。

### 1.3 `shared/order-state.js`
- `ACTION_RULES` +4：`{from:[STATUS.ACCEPTED], to:'SAME', event:'TRANSFER_*', roles:[ROLES.PARTNER], changesStatus:false}`。引擎已支持 `to:'SAME'` 与 `changesStatus:false`（见既有 `order.correct`），**不改引擎**。

### 1.4 `shared/validate.js`
- +`validateTeamNote(value)`：可缺省；非字符串/去空后 >50 字 → 失败；+`validity` 枚举校验 `['24H','72H','7D']`（供 `partner.createSubInvites` 使用；具体导出名与现有文件风格一致即可）。
- 复用既有 `partnerNo` 形态校验，**不新增编号形态**。

### 1.5 `config/defaults.js`（唯一出厂默认源）
- `DEFAULT_CONFIG` +`transferTtlMinutes: 10`、+`transferRate: {perMinute: 3, perDay: 20}`、+`teamMaxMembers: 5`、+`subInviteRate: {perMinute: 3, perDay: 20}`。
- 同步 `CONFIG_LIMITS`（该文件内既有结构）：`transferTtlMinutes: {min:1,max:60}`、`teamMaxMembers: {min:1,max:10}`；两个 rate 对象给 `{perMinute:{min:1,max:30},perDay:{min:1,max:200}}` 形制（若现结构只支持数字，按文件现状最小扩展并保持既有键不变）。
- **不改 `PUBLIC_CONFIG_KEYS`**（四个键都不下发）；**不改** `handlers/admin/updateConfig.js` 白名单（本批只做出厂默认，后台不可改）。
- 完成后 `node tools/sync-cloud-shared.js` 生成副本；`cloudfunctions/*/shared/{enums,actions,order-state,validate,defaults}.js` **不得手写**。

### 1.6 `api/modules/order.js` / `api/modules/partner.js`
- order +4 导出（`requestTransfer/acceptTransfer/declineTransfer/cancelTransfer`，写动作按现有 `call` 形制）；`listPartner` 已透传 payload，确认 `view` 不需改。
- partner +4 导出（`createSubInvites/revokeSubInvite/listSubMembers` 用 `retry:true` 读形制、`removeSubMember` 写形制；以文件内现有形制为准）。
- `api/modules/index.js`：按现状形制确认无需改（若聚合表需补则补）。

### 1.7 套件接线（+2 套，36→38）
- `tools/selftest.js` `SUITES` 末尾 +`'selftest-transfer', 'selftest-team'`（**文件由 W2/W3 创建，你只加名字**）。
- `check.ps1` `$EXPECTED.SelfTestSuites = 38`。
- `tools/selftest-state.js`：事件总数断言 19→24、新常量存在性断言（`TRANSFER_STATUS`/`TRANSFER_RESOLVE_REASON`/`MESSAGE_HIDDEN_EVENT_TYPES`/`INVITATION_KIND`）、`actions` 注册表新 8 条必在（若该套件已有同类断言则并入既有组）；`EXPECTED_ASSERTIONS` 以实跑为准。
- **不改** `docs/**`（批 27 文档统一回写；ENGINEERING §8.1 读数由文档 owner 改）。

### 1.8 自测（只跑这些）
`node --check` 全部改动 js；`node tools/selftest-state.js`；`node tools/sync-cloud-shared.js` 后复跑一次确认副本一致；报告 `git status --short` 清单。**不要跑 check.ps1**。

## 2. W2 · D58 服务端（S8 + S9 订单投影 + S2 测试）

**任务板**：`b26-order-server`。**写作用域**：`cloudfunctions/api/handlers/order/**`、`handlers/message/list.js`、`handlers/admin/{_dto,listOrders,getOrder}.js`、`tools/selftest-transfer.js`（新）、`tools/selftest-messages.js`（如需）、`tools/lib/order-transfer-cases.js`（可拆）。**不动**：`shared/**`、`api/**`、`config/**`、`tools/selftest.js`、`check.ps1`、页面、docs。
**依赖**：W1 的 shared 符号。若 `require` 报 undefined，轮询（`sleep 20` + grep `shared/enums.js`）等 W1，最多 15 分钟；仍未就绪 → 报告阻塞条件，不自行改 shared。

### 2.1 新增 handlers（`handlers/order/`）
`requestTransfer/acceptTransfer/declineTransfer/cancelTransfer.js` + 纯共用 `_transfer.js`（守卫/惰性过期/事件/入参校验；单文件 ≤500 行、单函数 ≤50 行）。契约 = 草案 §1.2~§1.4 + 裁决 Q1~Q12。要点：
- `requestTransfer`：`orderNo/toPartnerNo/clientRequestId`；守卫链=本人是履约人且 ACTIVE → `order.status==='ACCEPTED'` → `pickedCount===0`（D61 派生值；未取件；`itemIndex` 逐件取过的 `pickedCount>0` 一律拒）→ 无 PENDING 邀请 → 目标 `partnerNo` 形态闸 → 目标存在且 `ACTIVE`（`SUSPENDED`→`PARTNER_CLOSED`）→ 非自己/非原履约人 → 真实×测试一致（否则 `FORBIDDEN`）→ 子队员（`parentPartnerId!==''`）目标限本队（主兼职/子队员均可转给主兼职或同队子队员；主兼职不限）。事务写 `orders.transfer` 块 + `TRANSFER_REQUESTED` 事件 + `version+1/updatedAt`；`order.status/statusUpdatedAt/partnerId/acceptedAt/dorm/delivery/parcels` **零改动**。返回 `{order, transfer, duplicated?}`。
- `acceptTransfer`：`transfer.toPartnerId===me`（**不是**当前 `partnerId`）；过期/订单不再 ACCEPTED → 先惰性落 `EXPIRED`（`STATE_CHANGED`/`EXPIRED`）再 `INVALID_STATE`；自己 `ACTIVE`（`SUSPENDED`→`PARTNER_CLOSED`）。事务**唯一归属改写点**：`partnerId/partnerOpenid/partnerNo` 改为本人，`transfer.status='ACCEPTED'/resolvedAt/resolveReason='TARGET_ACCEPTED'`，写 `TRANSFER_ACCEPTED` 事件；`status/statusUpdatedAt/acceptedAt` 不变。
- `declineTransfer`/`cancelTransfer`：只改 `transfer.status/resolvedAt/resolveReason`（`TARGET_DECLINED`/`FROM_CANCELLED`）+1 事件，归属零改动。
- 幂等：`order_events.requestKey = {orderId}:{action}:{clientRequestId}`；四动作都用 `requestKeyExists` 预查 → 命中返回当前 DTO + `duplicated:true`。限流：`rl:transfer:{effectiveOpenid}:{wYYYYMMDDHHmm}` 与 `:d{YYYYMMDD}`，阈值读 `config.transferRate`（W1 出厂默认；读不到用出厂默认，不写死数字字面量——通过 `config` 读取）。
- 惰性过期单源：`_transfer.js` 导出 `normalizeTransfer(o, now)`，所有读路径（`get`/`listPartner`/`_dto` 构造前）先调用；过期时落一次 `EXPIRED`+事件（幂等，重复读不再写）。

### 2.2 改动既有 handlers
- `index.js`：+4 动作注册（键名逐字对齐 `shared/actions.js`）。
- `get.js`：**放宽读取权限**——当前履约人、顾客、**PENDING 邀请的目标兼职**（`transfer.toPartnerId===me && transfer.status==='PENDING'`）可读；他人仍 `FORBIDDEN`；转派完成后原履约人失联（`FORBIDDEN`）。目标兼职视图按 §2.3 遮蔽。
- `listPartner.js`：新增 `view='transfer'`（目标兼职待接收：`WHERE transfer.toPartnerId={myPartnerId} AND transfer.status='PENDING' AND order.status='ACCEPTED'`，按 `transfer.requestedAt desc` 游标；服务端过滤，客户端零过滤）；顶层响应 +`transferPending`（**六项 counts 形状不变**）；其余 view 行为零变化；`view` 枚举校验同步。
- `_dto.js`/`_dto-fields.js`：`order.transfer`（可按角色剪裁的对象）+`order.fulfillmentPartnerNo`；可见性矩阵严格按草案 §1.4：顾客仅 `ACCEPTED` 后见 `transfer{status,toPartnerNo}`；收发双方见白名单键 `status/fromPartnerNo/toPartnerNo/requestedAt/expiresAt/resolvedAt/resolveReason`；**目标兼职视图不返回 `counterpart.displayName/avatarUrl/customerNo`**（保留 `roomTag/delivery/parcels/note`）；任何视图不出现 `_id/partnerId/toPartnerId/fromPartnerId/openid`；`transfer` 恒返回（无则 `null`）。历史订单无字段 → `null`，零迁移。
- `handlers/message/list.js`：事件项构造跳过 `MESSAGE_HIDDEN_EVENT_TYPES`（4 个私有事件）；`TRANSFER_ACCEPTED` **保留可见**（顾客消息中心/红点，D29 机制）。
- `handlers/admin/{_dto,listOrders,getOrder}.js`：只读 `transfer` 投影（`status/fromPartnerNo/toPartnerNo/expiresAt/resolveReason`，无 openid、无内部 id）。
- 匿名化（`handlers/order/...` 或 `db` 内既有 anonymizeOrder 调用点，按现状定位）：清 `transfer.fromPartnerNo/toPartnerNo` 为 `''`，保留 `status/resolveReason`。

### 2.3 测试 `tools/selftest-transfer.js`（新，register + `EXPECTED_ASSERTIONS`）
按草案 §1.7 T1~T13 建组（每条注明"挡什么"）。必须覆盖：归属改写/不变字段逐字段、目标独占、状态守卫（含 `pickedCount>0`）、真实×测试隔离、惰性过期只落一次、幂等 `duplicated:true`+事件恰 1 条+`version` 只 +1、限流、DTO 键白名单（字符串级不含 `displayName/avatarUrl/customerNo/openid/toPartnerId`）、顾客侧 `counterpart` 仍=绑定兼职、完成后原兼职 `order.get` FORBIDDEN + 不再出现在 `listPartner`、统计按当前归属、匿名化清编号、静态闸（`handlers/order/**` 零 `db.collection`）。fake DB 注入形制抄同目录既有套件（`tools/selftest-order-partner.js`/`tools/selftest-cloud.js`）。**不新增 check.js 判据**。

### 2.4 自测
`node --check`；`node tools/selftest-transfer.js`（全绿）；`node tools/selftest-order-partner.js`、`node tools/selftest-messages.js`、`node tools/selftest-cloud.js`（回归）。报告行数与真实输出。

## 3. W3 · D59 服务端（S1b + S9 邀请码投影）

**任务板**：`b26-team-server`。**写作用域**：`cloudfunctions/api/handlers/partner/**`、`handlers/bind/create.js`、`handlers/order/_create.js`、`handlers/admin/{setPartnerStatus,listInvites,invite-codes/_dto}.js`、`tools/selftest-team.js`（新）。**不动**：`shared/**`、`api/**`、`config/**`、`tools/selftest.js`、`check.ps1`、docs、页面。
**依赖**：同 W2（W1 的 shared 符号；轮询，不自行改 shared）。

契约 = 草案 §2.2~§2.4 + 裁决。要点：
- 新 handlers：`partner.createSubInvites`（ACTIVE 且 `parentPartnerId===''`；`count 1~5/validity 24H|72H|7D/note≤50`；当前队员数 ≥`config.teamMaxMembers` → `VALIDATION_FAILED`；`rl:subInvite:*` 限流；`kind='SUB'`、`issuerPartnerId=me`、`batchId='TB'+yyyyMMdd+seq`、`createdBy='PARTNER:'+myNo`；完整码只在创建响应）、`revokeSubInvite`（**批次级作废**：入参 `{batchId, clientRequestId}`，作废该主兼职该批全部未用码，返回 `{batchId, revokedCount}`；他人批次/不存在一律 `NOT_FOUND`；该批无未用码→`INVALID_STATE`）、`listSubMembers`（主兼职返回 `members[{partnerNo,displayName,status,teamJoinedAt}]`+`pendingInvites[{codeTail(后4位),expiresAt,batchId}]`+`quota{used,max}`；子队员只返回自己的队伍摘要 `parentPartnerNo+memberCount`）、`removeSubMember`（目标 `parentPartnerId===me`；有进行中订单 → `INVALID_STATE`；写 `parentPartnerId=''`+`status='SUSPENDED'`+`suspendedReason='TEAM_REMOVED'`，并结束该目标 PENDING 转派邀请为 `CANCELLED`）。共用 `_team.js`（单文件 ≤500 行）。
- `partner.activate`：`kind==='SUB'` 时事务内写 `parentPartnerId=code.issuerPartnerId`、`teamJoinedAt=now`；`kind==='DEV'` 或缺失 → 现状零改动（旧码兼容）；不新增 action。
- `partner.getPublic`：目标 `parentPartnerId!==''` → `NOT_FOUND`（不暴露存在性）。`bind.create`：子队员目标 → `NOT_FOUND`（同码同文案）。`order.create` 兼职路径（`bindingId`/`guest`）：子队员 `FORBIDDEN`（顾客路径不变）。
- `admin.setPartnerStatus`：`SUSPENDED`/`CLOSED` 分支级联同 `parentPartnerId` 子队员；同时把相关 PENDING 转派邀请落 `CANCELLED`（`reason=STATE_CHANGED`）；CLOSED 走既有分页事务+幂等。
- `handlers/admin/listInvites`/`invite-codes/_dto`：列表增 `kind` 列与 `issuerPartnerNo`（本页批量查，不 N+1）；admin 对 SUB 码**只读**（不可作废）。
- 测试 `tools/selftest-team.js`（新）：草案 §2.7 U1~U11 全组（仅一层、上限边界 `>=`、顾客不可绑、禁代客单、级联、旧码兼容、作废边界、限流、DTO 键白名单含 `codeTail` 长度 4、静态闸）。
- 自测：`node --check`；`node tools/selftest-team.js`；回归 `node tools/selftest-partner.js`（若存在）、`selftest-bind.js`、`selftest-order-flow.js`、`selftest-admin.js`、`selftest-cloud.js`。报告真实输出。

## 4. W4 · D58 兼职端（S4 + S2 测试）

**任务板**：`b26-partner-ui`。**写作用域**：`pages/partner/workbench/**`、`pkg-partner/pages/order-detail/**`、`tools/selftest-order-workbench.js`、`tools/selftest-order-detail-partner.js`（+ 其 cases 库）。**不动**：`shared/**`、`api/**`、`cloudfunctions/**`、`app.json`、`docs/**`。
契约 = 草案 §1.4/§1.8（UX_PARTNER §3.3/§4.12）+ 裁决。要求：
- **工作台 `index.js` 现 499/500 行：先拆件再改**（纯件进 `pages/partner/workbench/parts/`；`parts/transfer.js` 放 "待接收" 行的剩余时间/文案/排序等纯逻辑，页面层零状态字面量——状态文案由 DTO 下发）。工作台顶部「待接收转派（N）」入口/区块：数据来自 `order.listPartner({view:'transfer'})` 的 `transferPending`（服务端下发，客户端不自行计数），行点进订单详情；红点/角标复用既有红点机制。
- 订单详情（`pkg-partner/pages/order-detail/**`）：
  - 发起区：仅当 DTO `actions[]` 含 `order.requestTransfer`（**页面零判据**，不判状态字符串）显示「转派给其他兼职」→ 输入目标完整 `partnerNo` → 二次确认（免责说明：转派后你将失去该单）→ `api.order.requestTransfer`；错误文案用服务端 `message`。
  - 邀请卡（目标兼职视角）：DTO `transfer.status` 由服务端下发中文文案；显示发起方编号与「剩余 N 分钟」（纯件按 `expiresAt - now` 计算，文案在纯件；页面只渲染）+「确认接收/拒收」→ `acceptTransfer/declineTransfer`；过期/已被撤回时只读提示。
  - 发起方视角：`PENDING` 时显示「等待对方确认（剩余 N 分钟）」+「撤回转派」→ `cancelTransfer`；结果态 `ACCEPTED/DECLINED/CANCELLED/EXPIRED` 显示对应文案；转派成功后原兼职刷新列表（该单消失/只读）。
  - 目标兼职打开详情：DTO 已按服务端遮蔽（无顾客昵称头像/客户编号），页面不得自行补取。
- 测试：`selftest-order-workbench.js`（待接收入口/计数/行文案/红点/零判据静态扫）、`selftest-order-detail-partner.js`（发起/邀请/撤回/结果态/文案/不可越权入口）；`EXPECTED_ASSERTIONS` 实跑为准。
- 自测：`node --check` 全部改动 js；两个套件全绿；报告行数（工作台拆件后每文件行数）。

## 5. W5 · D58 顾客端 + 后台（S3 + S5 + S2 测试）

**任务板**：`b26-customer-admin`。**写作用域**：`pkg-customer/pages/order-detail/**`（+ 消息中心相关页面若需事件文案）、`pkg-admin/pages/orders/**`、`pkg-admin/pages/order-detail/**`、`tools/selftest-order-customer.js`、`tools/selftest-admin-pages.js`、`tools/selftest-message-pages.js`（如需）。**不动**：`shared/**`、`api/**`、`cloudfunctions/**`、docs、兼职端页面。
契约 = 草案 §1.4/§1.8（UX_CUSTOMER §3.8/§5、UX_DEVELOPER §3.6/§3.7）+ 裁决。要求：
- 顾客订单详情：当服务端下发 `transfer.status==='ACCEPTED'` 时显示「由 P-XXX-XXX 接手履约」提示（只显示编号，**不显示**头像昵称）；`fulfillmentPartnerNo` 仅编号；页面零判据（状态文案/是否显示由 DTO 字段驱动，可判字段存在性但不写状态字面量——若现有页面已有同类消费形制则沿用）。
- 事件人话：顾客详情时间线/消息中心对 `TRANSFER_ACCEPTED` 的事件文案（服务端若已下发中文 `text` 则直接渲染，否则在页面既有文案映射单源补 1 条，**不碰 shared**）。`TRANSFER_REQUESTED/DECLINED/CANCELLED/EXPIRED` 不出现在顾客消息中心（服务端已拉黑，页面不特判）。
- 后台（只读）：订单列表/详情显示转派留痕（发起/接收方编号 + 状态 + 时间；无 openid、无顾客昵称头像）；列表不新增列导致布局破坏则放详情。
- 测试：`selftest-order-customer.js`（顾客提示文案/编号脱敏/不显示昵称头像/事件文案）、`selftest-admin-pages.js`（只读留痕/无 openid/脱敏）；`EXPECTED_ASSERTIONS` 实跑为准。
- 自测：`node --check`；两个套件全绿；报告真实输出。

## 6. 回报格式（全部 owner 必填）

文件清单（路径 + 行数）+ 已跑命令与**真实输出**（含失败项原文）+ 未决问题/风险 + 跨域需求（禁止自行改）。**不报"应该没问题"**。若被阻塞：写清缺哪个符号/哪个文件被占/哪个环境不可用，并保持可恢复（不要半成品推送）。

## 7. 收口顺序（Lead）

W1 共享冻结 → W2/W3/W4/W5 并行实现 → Lead 整合修复 → 批 27（D59 客户端 + D63 + 文档回写）→ `check.ps1`/`gate.ps1` 全绿 → 全仓代码审查/变异电池 → 提交并推送远端。

---

# 第二部分 · 批 27 并行工单（D59 客户端 / D63 / 全量文档回写）

> 批 27 与批 26 可并行：D63 纯客户端零服务端改动；D59 客户端只消费批 26 服务端 DTO/API；文档回写按已冻结口径先行。**所有 owner 同样禁止 git commit / check.ps1 / gate.ps1 / 改他人作用域**。

## 8. W6 · D63 顾客邀请顾客（S0 + S3 + S2 测试）

**任务板**：`b27-d63`。**写作用域**：`utils/share/index.js`、`pages/profile/{index.js,index.wxml,parts/share-card.js}`、`pages/role/{index.js,index.wxml}`（仅邀请卡文案若需要）、`tools/selftest-share.js`、`tools/lib/check-share.js`。**不动**：`shared/**`、`api/**`、`cloudfunctions/**`、`app.json`、docs、其他页面。契约 = 草案 §3 + 裁决 Q14=A/Q15=A。
- `utils/share/index.js#buildAppMessage(input)` 入参 +`boundPartnerNo`；放行式 = `(isCustomer===false && partnerNo!=='') || (isCustomer===true && boundPartnerNo!=='')`；`viewSession===true` 一律通用卡（优先级不变）；+`TITLES.BIND_CUSTOMER`（如「校园快递代取｜凭兼职编号。可绑定下单」，中性、无奖励/无邀请者信息）。卡片 path 只允许 `/pages/launch/index?bind=<partnerNo>`，**零新增 query**、不带邀请者编号/昵称/头像/宿舍/尾号/订单/取餐码。
- `pages/profile`：顾客有 ACTIVE 绑定时用 `store.binding.partnerPublic.partnerNo` 填 `partnerCard`（无绑定为空/通用卡）；薄封装 `parts/share-card.js` 只透传。页面层零 path/title 自拼（沿用 check #33⑤⑥）。
- `pages/role`：落地页提示文案（未绑定→邀请卡；同号已绑→「已绑定·去下单」等既有分支不改）。
- 测试 `tools/selftest-share.js` +S1~S7 组（草案 §3.7）与 `tools/lib/check-share.js` path 白名单；`EXPECTED_ASSERTIONS` 实跑为准。静态：`utils/share/index.js` 零 `wx.`。
- 自测：`node --check`、`node tools/selftest-share.js` 全绿；不跑 check.ps1。

## 9. W7 · D59 客户端团队页（S4 + S2 测试）

**任务板**：`b27-team-ui`。**写作用域**：新建 `pkg-partner/pages/team/**`（四件套 + `parts/**` 纯件）、`pkg-partner/pages/service-settings/**`（仅加「我的团队」入口行）、`tools/selftest-partner-pages.js`（+cases）。**不动**：`app.json`（Lead 注册）、`pages/profile/**`（Lead/顺序写者合并，避免与 D63 抢同一文件）、`shared/**`、`api/**`、`cloudfunctions/**`、docs、顾客端/后台页面。
- 团队页：主兼职视角=成员列表（`partnerNo`+`displayName`+状态+加入时间，**不显示头像/fileId**）+ 发子邀请码（数量 1~5、有效期 24H/72H/7D、备注可选、创建后完整码仅在本次响应显示并提示「一次性，请当面告知」）+ 待使用子码列表（只显示尾 4 位/批次/到期）+ 作废（二次确认）+ 移除成员（二次确认，说明「移除后对方被停用，需联系管理员恢复」）；名额 `quota{used,max}` 展示（达到上限禁用发码并给原因）。子队员视角：只显示「所属队伍：P-XXX / 成员数 N」。
- 交互全部走 `api.partner.createSubInvites/revokeSubInvite/listSubMembers/removeSubMember`（W1 添加）；页面层零业务判据（不写 `'UNUSED'/'ACTIVE'/'SUB'` 等字面量，状态文案/DTO 字段驱动；列表过滤用 DTO 已分组字段而非自行判状态）；零 `wx.cloud.*`、零编号生成。
- 测试：`tools/selftest-partner-pages.js` 新组（渲染/状态文案来自 DTO/发码校验转发/无头像无 fileId/零判据静态扫/页四件套齐全）+ 既有组保持绿；`EXPECTED_ASSERTIONS` 实跑为准。新页在 `app.json` 注册由 Lead 做——你的测试不要断言 app.json 页数（Lead 另补）。
- 自测：`node --check` 全部改动 js、`node tools/selftest-partner-pages.js` 全绿。不跑 check.ps1。

## 10. W8 · 全量文档回写（S6）

**任务板**：`b27-docs`。**写作用域**：`docs/contract/**`、`docs/data/**`、`docs/engineering/**`（不含 `tools/check.js` 代码）、`docs/ux/**`、`docs/delivery/**`、`docs/privacy/**`、`docs/governance/**`、`STATE.md`、`CHANGELOG.md`、`docs/README.md`。**不动**：任何 `.js/.json/.wxml/.wxss/.ps1`（`tools/check.js` 的页数常量由 Lead 改）、`shared/**`、`config/**`、`app.json`。
按草案 §1.8（D58）+ §2.8（D59）+ §3.8（D63）+ 本文 §0 裁决逐项回写。必须覆盖：
1. **CONTRACT**：§4 集合行（`invitation_codes` +`kind/issuerPartnerId`、`partners` +`parentPartnerId/teamJoinedAt`、`orders` +`transfer`）；§4.2 事件 19→24（5 个 `TRANSFER_*` + payload/可见性）；§4.2 限流 scope 统一一份（含 `ai`、`transfer`、`subInvite`，消除两处不一致）；§5.1 状态表 `ACCEPTED` 可执行动作 +转派（未取件）；§5.3 动作表 +`order.{requestTransfer,acceptTransfer,declineTransfer,cancelTransfer}`、+`partner.{createSubInvites,revokeSubInvite,listSubMembers,removeSubMember}`、`order.listPartner` +`view='transfer'`/`transferPending`；补偿动作表 + 转派行；§7 页面 32→33（`pkg-partner/pages/team/index`）与 `launch` query 白名单不变；§8 分享卡生成主体扩为「兼职或有 ACTIVE 绑定的顾客」+零邀请者信息；§10 权限矩阵 +8 动作行 +「顾客不可绑子队员/主兼职发子码」行；§11.2 `v1.10` 新增披露「订单可能由你绑定兼职的协作队员协助履约」+ 零新增采集/对外提供；§13 D58/D59/D63 行只补细节、不改已冻结结论；顺手修草案 §5 的存量不一致 #1（事件数）、#3（限流 scope）、#4（ENGINEERING §8.1 读数 39/38）、#5（DATA_MODEL `view` 补 `day`+`transfer`）；#8（D64 取件码格位）先核对实现再对齐，无法确定只登记不改。
2. **DATA_MODEL**：§2.3/§2.5/§2.8/§2.9/§2.10 字段与 config 键（`transferTtlMinutes=10`/`transferRate{perMinute:3,perDay:20}`/`teamMaxMembers=5`/`subInviteRate{perMinute:3,perDay:20}`，均不入公开子集、后台白名单不变）；§2.6/§8.4 事件 24 种 + payload；§2.11 审计不新增（业务证据落 `order_events`/`invitation_codes`）；§4.8 转派事务、激活/级联事务；§5.1 索引 +`idx_transfer_target`/`idx_issuer`/`idx_parent`（标注「用户控制台创建」）；§5.2/§7.4/§7.5 查询路径（`view='transfer'`、团队页、待接收计数）；§8.2 可见性矩阵；§10.3 匿名化（清 `transfer` 编号快照、保留 status/resolveReason；`parentPartnerId` 保留）；§10.4 级联；§12 负向用例 #47~#55。
3. **ARCHITECTURE**：§2 作用域（S1 文件变更、S8/S1b 新 handler 文件、S4 新页面/纯件、S2 新套件）；§3.2 `api/modules/{order,partner}` 新函数、`utils/share` 入参；§4.3 `shared` 注册表变更；§6 页数 33、套件数 38、check 判据 39 不变。
4. **ENGINEERING**：§4.2 路由表 +8 动作；§7.5 变异电池 M25~M37（D58 M25~M30、D59 M31~M34、D63 M35~M37）；§8.1 常量 `CheckCriteria=39`/`SelfTestSuites=38`；§8.2 #3 页数（8+25=33）与 #13 注册表口径；§8.6 回写表若有新增类型则补。
5. **UX**：UX_PARTNER 转派入口/待接收区/邀请卡/撤回/剩余时间文案 + 团队页（§3.10/§3.12）与红点；UX_CUSTOMER 顾客侧「由 P-XXX 接手履约」+只显示编号 + D63 分享入口（仅「我的」）与落地提示；UX_DEVELOPER 后台订单转派留痕（编号级、无 openid/昵称）与邀请码 `kind` 列（SUB 只读）。
6. **QA**：批 25 已占用 §AF（AF1~AF7）。**新增分区从 §AG 起**：D58/D59/D63 真机项（发起/确认/过期/撤回/顾客提示/统计归属/发子码/子账号激活/顾客不可绑/级联停用/移除成员/顾客分享自动绑定），全部标「人（真机）」，**agent 不代勾、不宣布通过**；判定补充写进既有判定区。
7. **RUNBOOK**：新增索引创建步骤（3 个索引 + 退化方案）+ 「无新增集合/触发器/云函数」说明；D58/D59 真机验收清单。
8. **隐私**：CONTRACT §11.2 v1.10 披露 + `docs/privacy/**` 对应文本（按现有版本演进格式）；**隐私文本只能用户终审**——写「待用户终审」不写「已通过」；`privacyVersion` 配置值如需变更**只报告不改代码**。
9. **STATE.md / CHANGELOG.md / docs/README.md**：批 26/27 台账与证据串占位（真读数待 Lead 收口后回填/Gate 输出为准，不写死测试条数）；快照行读数改 39/12/38。
10. 文档纪律：UTF-8 无 BOM/LF；不写实现代码（可伪代码/表）；不新增 D 编号（D_MAX=67）；不引入 P0 外需求；「待定」只留 `P1/P2/[R#]/TD-###` 显式编号形式。完成后回报：改动文件清单+行数+逐条覆盖点+**未能核实/需 Lead 决策**清单。
