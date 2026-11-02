# 批 26/27 冻结接口与实施契约草案（D58 转派 / D59 兼职子队员 / D63 顾客邀请顾客）

> **状态：草案 v0.1（2026-11-03），待 Lead 裁决 §4 的 `[Q1]`~`[Q15]` 后冻结。** 冻结后本文即批 26/27 的派工依据，与 CONTRACT 冲突时以 CONTRACT 为准并先停手回报。
> **口径来源**：`docs/contract/V4_CONTRACT.md` §13 D58/D59/D63 三行 + `docs/contract/V4_DECISIONS.md` 同名三节。本文只把"裁决摘要"展开成"可直接派工的冻结契约"，**不新增需求**；登记文本模糊处一律进 §4，不自行拍板。
> **取证（只读）**：AGENTS.md；CONTRACT §1/§2/§3/§5/§5.1/§5.3/§7/§10/§11/§13；DATA_MODEL §2.3/§2.4/§2.5/§2.8/§2.9/§2.10/§2.11/§4.2/§4.8/§5/§7.4/§7.5/§8.4/§10.3/§12；ARCHITECTURE §1/§2/§3/§4；ENGINEERING §6.3/§7.5/§8；UX 三册；代码 `shared/{actions,enums,order-state,collections}.js`、`handlers/{order,bind,partner,user}/**`、`utils/share/**`、`pages/profile/parts/share-card.js`、`tools/selftest.js`、`check.ps1`。
> **与批 25（D61 件级取件 / D62 多站点分组）的关系：只读避让。** 批 25 已落 `shared/order-state.js:40-47`、`handlers/order/_picked.js`（`pickedCount/parcelCount/allPicked`）；D58 只**消费**这些既有派生值，**不改**批 25 任何文件。

---

## 0. 共用冻结约定（三节共用，各节不再重复）

### 0.1 不变量（违反即返工）

| # | 不变量 | 出处 |
| :-- | :-- | :-- |
| 1 | 错误码**恒为 13 个**：`VALIDATION_FAILED/FORBIDDEN/NOT_FOUND/CONFLICT/INVALID_TRANSITION/INVALID_STATE/RATE_LIMITED/INVITE_EXPIRED/INVITE_USED/VIEW_TICKET_EXPIRED/PARTNER_CLOSED/DEPENDENCY_FAILED/INTERNAL_ERROR`；三节**零新增** | CONTRACT §5.3:360 |
| 2 | 集合恒 14 个，三节**零新增集合**；消息中心不建 `notifications` | ARCHITECTURE §4.3:201；CONTRACT §4:206 |
| 3 | 事件类型：**只有 D58 增 5 个 `TRANSFER_*`（19→24）**；D59/D63 零新增 | CONTRACT §4.2:236；DATA_MODEL §8.4:856 |
| 4 | 身份只来自 `OPENID` 或切换票据；客户端传的 openid/编号只当查询条件 | CONTRACT §4:210 |
| 5 | 页面层零业务判据：不出现七状态/转派状态/队伍状态字符串字面量、不生成编号、不 `wx.cloud.*` | AGENTS §2；ENGINEERING §8.2 #21 |
| 6 | 零金额：三节不引入任何交易语义（`D5/D6/D30/D50` 不变） | CONTRACT §0/§3 |
| 7 | D19/D42 头像昵称**只对当前 ACTIVE 绑定的对方**可见；D58 产生的"非绑定履约人"不得取得头像/昵称 | CONTRACT §11:518 |
| 8 | 客户端零直连；云函数零 `db.collection`（只经 `db/dao`）；`cloudfunctions/*/shared/**` 只由 `node tools/sync-cloud-shared.js` 生成 | AGENTS §2；ARCHITECTURE §2:41 |
| 9 | 限流统一 `counters.rl:{scope}:{openid}:{window}`；本草案给**键名**，次数/窗口不写死数字 | CONTRACT §4.2:239；DATA_MODEL §2.9:235 |

### 0.2 规模总览（一眼看清改动量）

| 节 | 新增写 action | 新增读路径 | 新增事件 | 新增字段 | 新增索引 | 新增页面 | 新增 config 键 | 新增判据套件 |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| **D58** | 4（`order.requestTransfer/acceptTransfer/declineTransfer/cancelTransfer`） | 1（见 [Q1]，建议复用 `order.listPartner` 新 view） | **5**（19→24） | `orders.transfer`（1 个对象块，8 子键） | 1 | 0 | 2 组（`transferTtlMinutes`、`transferRate*`） | `selftest-transfer`（36→37 套） |
| **D59** | 4（`partner.createSubInvites/revokeSubInvite/listSubMembers/removeSubMember`） | 0（`listSubMembers` 自含列表） | 0 | `invitation_codes.kind/issuerPartnerId`、`partners.parentPartnerId/teamJoinedAt` | 2 | 0 或 1（[Q10]） | 2 组（`teamMaxMembers`、`subInviteRate*`） | `selftest-team`（37→38 套） |
| **D63** | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0（在 `selftest-share` 内增组，套件数不变） |

### 0.3 批 26 / 批 27 划分与单写者队列

- **批 26 = D58 全栈 + D59 服务端与共享冻结**（`shared/**` 一次改完、只跑一次 `sync-cloud-shared.js`，避免两批各改一次造成第二波冲突）。
- **批 27 = D59 客户端**（团队页/我的入口/隐私文本）+ **D63 全量**（纯客户端，零服务端改动，可与批 26 并行）。
- **单写者队列（必须按序）**：① S1 `shared/{actions,enums,order-state}.js` → ② Lead 跑 `node tools/sync-cloud-shared.js` → ③ S8 `handlers/order/**` → ④ S1b `handlers/partner/**` + S9 `handlers/admin/**` → ⑤ S0 `api/modules/**` → ⑥ S4/S3/S5 页面 → ⑦ S2 判据与门禁 → ⑧ S6 文档回写。
- **硬前置**：批 25 收口（`handlers/order/{_dto,_dto-fields,listPartner}.js`、`shared/{enums,order-state}.js` 落定）后才可开始批 26 的 ①③⑤ 步。**D63 不受此限**（不碰 `shared/**`、`api/**`、`cloudfunctions/**`）。

## 1. D58 已接单订单转派

### 1.1 A · 口径前提与边界

**一句话需求**：订单在 `ACCEPTED` 且**一件未取**时，当前履约兼职凭目标兼职**完整 `partnerNo`** 发起转派邀请；目标在有效期内确认 → 同一事务改写订单归属（`partnerId/partnerOpenid/partnerNo`），**顾客、绑定关系、roomTag、订单号、包裹、配送地址全部不变**；拒收/过期则邀请失效、订单不动。

**明确不做（否定清单）**

| 不做 | 理由/出处 |
| :-- | :-- |
| 直接改派（对方无确认）、退回 `SUBMITTED` | DECISIONS D58 被否项；退回会推翻"接单不可撤销"（CONTRACT §5.1:328） |
| 任何 `bindings` 写入；改 `dorm.roomTag`/`delivery`/`parcels`/`service`/`appoint`/`acceptedAt` | D4/D20；D58 原文"不改订单号/顾客/绑定/roomTag"（转派≠换绑） |
| 转派给非 `ACTIVE`、真实×测试混转、转给自己 | D58 + CONTRACT §4.2:212（测试隔离） |
| 转派后新兼职看顾客头像/昵称/客户档案；"接单奖励"或任何交易语义 | D58 + D19/D42 隐私边界；D5/D6/D50 |

**冲突与修订**：不修订任何既有 D。**两处相交需 Lead 裁决**：① D61 允许 `ACCEPTED` 部分件已取 → [Q3]；② D59 队内推送语义 → [Q9]。

### 1.2 B · 数据模型变更

**1.2.1 新字段 `orders.transfer`（object，可缺省；缺省 = 从未转派）**

| 子键 | 类型 | 必填 | 值域/约束 | 写入方 | 读权限 | 隐私 |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| `status` | string | 是 | `PENDING`/`ACCEPTED`/`DECLINED`/`CANCELLED`/`EXPIRED` | `order.requestTransfer`（写 PENDING）/`acceptTransfer`/`declineTransfer`/`cancelTransfer`/惰性过期 | 见 1.4 | L1 |
| `fromPartnerId`/`fromPartnerNo` | string | 是 | 发起时的原履约兼职 `_id` + 编号快照（D15 形态） | `requestTransfer` | 双方/admin | L2/L1 |
| `toPartnerId`/`toPartnerNo` | string | 是 | 目标兼职 `_id` + 编号快照 | `requestTransfer` | 双方/admin | L2/L1 |
| `requestedAt`/`expiresAt` | Date | 是 | `expiresAt = requestedAt + config.transferTtlMinutes`（D58 登记值 10 分钟） | `requestTransfer` | 双方/admin | L1 |
| `resolvedAt`/`resolveReason` | Date / string | 否 | `''` 或应答时刻；`resolveReason ∈ {TARGET_ACCEPTED, TARGET_DECLINED, FROM_CANCELLED, EXPIRED, STATE_CHANGED}` | 四个动作/惰性过期 | 双方/admin | L1 |

- **不落 `toPartnerOpenid`**（避免 openid 二次散布）：确认时按 `toPartnerId` 读 `partners` 现取 `openid` 写订单快照。
- **单值覆盖语义**：`orders.transfer` 只保留"最近一次"（连续转派 A→B→C 时覆盖为 C 的记录）；**全量历史只落 `order_events`**，不新增 `transferHistory[]`（避免订单文档无界增长）。
- **旧数据兼容**：历史订单无该字段 ⇒ 读取按 `null`，DTO 恒返回 `transfer: null`；**零迁移**。
- **匿名化与留存影响**：`anonymizeOrder` 增清 `transfer.fromPartnerNo`/`transfer.toPartnerNo`（保留 `status`/`resolveReason` 供审计计数），回写 DATA_MODEL §10.3。

**1.2.2 新 config 键（`config._id='global'`）**

| 键 | 类型 | 默认 | 说明 | 公开子集 |
| :-- | :-- | :-- | :-- | :-- |
| `transferTtlMinutes` | number | **10**（D58 登记值） | 转派邀请有效期（分钟） | ❌ 不下发 |
| `transferRate` | object | 值以 CONTRACT §4 登记为准 | `{perMinute, perDay}`：单兼职发起转派的窗口/日上限，落 `rl:transfer:{effectiveOpenid}:{wYYYYMMDDHHmm}` 与 `:d{YYYYMMDD}` | ❌ 不下发 |

**1.2.3 索引（云控制台创建，只能用户执行 → RUNBOOK）**

| 索引 | 用途 | 退化方案 |
| :-- | :-- | :-- |
| `idx_transfer_target(transfer.toPartnerId, transfer.status, status, transfer.requestedAt desc)` | 目标兼职待接收列表（[Q1] 若选 `listPartner view=transfer`） | 控制台不支持四段复合时退为 `(transfer.toPartnerId, transfer.status)` + 服务端 `where(status:'ACCEPTED')` 下推；**仍服务端过滤，禁止客户端过滤**；退化登记 TD |

**1.2.4 事件（`order_events.type` 19→24，需 CONTRACT §4.2 与 DATA_MODEL §8.4 同批改）**

| type | fromStatus→toStatus | payload | actorRole | 顾客消息中心可见 |
| :-- | :-- | :-- | :-- | :-- |
| `TRANSFER_REQUESTED` | `ACCEPTED`→`ACCEPTED` | `{fromPartnerNo,toPartnerNo,expiresAt}` | `PARTNER` | ❌（避免"还没定"误导顾客） |
| `TRANSFER_ACCEPTED` | `ACCEPTED`→`ACCEPTED` | `{fromPartnerNo,toPartnerNo}` | `PARTNER` | ✅（D58 "通知顾客"落点） |
| `TRANSFER_DECLINED` | `ACCEPTED`→`ACCEPTED` | `{fromPartnerNo,toPartnerNo}` | `PARTNER` | ❌ |
| `TRANSFER_CANCELLED` | `ACCEPTED`→`ACCEPTED` | `{fromPartnerNo,toPartnerNo}` | `PARTNER` | ❌ |
| `TRANSFER_EXPIRED` | `ACCEPTED`→`ACCEPTED` | `{fromPartnerNo,toPartnerNo}` | `SYSTEM` | ❌ |

- **顾客消息中心机制 = D29 既有红点，零新集合**：`message.list` 现为"本单最近 N 条 `order_events` 全量下发"（`handlers/message/list.js:124-131`），若不处理，5 个 `TRANSFER_*` 会全部进顾客消息中心并计入未读。**冻结做法**：在 `shared/enums.js` 增 `MESSAGE_HIDDEN_EVENT_TYPES = ['TRANSFER_REQUESTED','TRANSFER_DECLINED','TRANSFER_CANCELLED','TRANSFER_EXPIRED']`，`message.list` 构造事件项时跳过；**只拉黑 D58 新增的 4 个私有事件，不触碰任何存量事件类型**（零存量行为变化）。

### 1.3 C · 服务端 actions（4 个写动作 + 1 条读路径，全部落在 CONTRACT §5.3 `order.*` 命名风格）

| 动作 | 允许角色 | 入参 | 状态守卫（不过 → 错误码） | 写事件 | 幂等键 | 限流 | 返回体 |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| `order.requestTransfer` | PARTNER（`order.partnerId==me`、自身 `status=ACTIVE`） | `{orderNo, toPartnerNo, clientRequestId}` | `order.status==='ACCEPTED'` 且 `pickedCount===0`（[Q3]）→否则 `INVALID_STATE`；无 `transfer.status==='PENDING'` →`INVALID_STATE`；`toPartnerNo` 形态闸 →`VALIDATION_FAILED(field='toPartnerNo')`；目标不存在/已 CLOSED →`NOT_FOUND`；目标 `SUSPENDED`→`PARTNER_CLOSED`；目标=自己/原兼职→`VALIDATION_FAILED`；真实×测试→`FORBIDDEN` | `TRANSFER_REQUESTED` | `order_events.requestKey={orderId}:order.requestTransfer:{clientRequestId}`；同 (from,to) 重放→返回当前 `transfer`+`duplicated:true` | `rl:transfer:{openid}:{w…}`+`:d…`（次数见 `config.transferRate`） | `{order, transfer, duplicated?}` |
| `order.acceptTransfer` | PARTNER（`transfer.toPartnerId==me`；**不是**当前 `partnerId`） | `{orderNo, clientRequestId}` | `transfer.status==='PENDING'` 且 `now<=expiresAt`（过期则先落 `EXPIRED` 再 `INVALID_STATE`）；`order.status==='ACCEPTED'`（否则落 `EXPIRED/STATE_CHANGED` + `INVALID_STATE`）；自己 `status=ACTIVE`（`SUSPENDED`→`PARTNER_CLOSED`） | `TRANSFER_ACCEPTED` | 同上（`:order.acceptTransfer:`） | 同桶 | `{order}` |
| `order.declineTransfer` | PARTNER（`transfer.toPartnerId==me`） | `{orderNo, clientRequestId}` | `transfer.status==='PENDING'` 且未过期（否则 `INVALID_STATE`） | `TRANSFER_DECLINED` | 同上 | 同桶 | `{order}` |
| `order.cancelTransfer` | PARTNER（`order.partnerId==me`，即原兼职且仍是履约人） | `{orderNo, clientRequestId}` | `transfer.status==='PENDING'` 且未过期 | `TRANSFER_CANCELLED` | 同上 | 同桶 | `{order}` |
| **读：待接收列表** | 见 [Q1] | 建议 `order.listPartner({view:'transfer',cursor,limit})` | 读，不写 | — | — | 无（读） | `{list,nextCursor,counts(六项零值模板),transferPending}` |

**事务步骤（伪代码，按 DATA_MODEL §4.8 风格；四个动作都是"单订单文档 + 1 条事件"同事务）**

```
requestTransfer(ctx,{orderNo,toPartnerNo,clientRequestId}):
  o=loadOrderByNo(orderNo); assert o.partnerId==me && o.status=='ACCEPTED' && pickedCount(o)==0
  t=loadPartnerByNo(toPartnerNo)                      # 前缀/形态闸先于读库
  assert t && t.status=='ACTIVE' && t._id!=o.partnerId && t._id!=me
  assert isTestOf(me)==isTestOf(t.openid)             # 真实×测试 → FORBIDDEN
  if event_exists({orderId:o._id}:order.requestTransfer:{clientRequestId}) → return view(o)+{duplicated:true}
  if o.transfer?.status=='PENDING' → INVALID_STATE('已有转派进行中')
  db.runTransaction(tx):
    tx.orders.doc(o._id).update({transfer:{status:'PENDING',fromPartnerId:me,fromPartnerNo:myNo,
      toPartnerId:t._id,toPartnerNo:t.partnerNo,requestedAt:now,expiresAt:now+ttl,resolvedAt:'',resolveReason:''},
      version:o.version+1,updatedAt:now})             # status/statusUpdatedAt/partnerId 全不变
    addEvent(tx,o,'TRANSFER_REQUESTED','ACCEPTED','ACCEPTED',{fromPartnerNo:myNo,toPartnerNo:t.partnerNo,expiresAt})
  return {order:view(o'),transfer:o'.transfer}

acceptTransfer(ctx,{orderNo,clientRequestId}):
  o=loadOrderByNo(orderNo); tr=o.transfer
  assert tr && tr.status=='PENDING' && tr.toPartnerId==me
  if now>tr.expiresAt → expire(o,reason='EXPIRED'); INVALID_STATE('邀请已过期')
  if o.status!='ACCEPTED' → expire(o,reason='STATE_CHANGED'); INVALID_STATE
  db.runTransaction(tx):
    tx.orders.doc(o._id).update({partnerId:me,partnerOpenid:myOpenid,partnerNo:myNo,   # ← 唯一归属改写点
      transfer:{...tr,status:'ACCEPTED',resolvedAt:now,resolveReason:'TARGET_ACCEPTED'},
      version:o.version+1,updatedAt:now})             # 不改 status/statusUpdatedAt/acceptedAt/dorm/delivery
    addEvent(tx,o,'TRANSFER_ACCEPTED','ACCEPTED','ACCEPTED',{fromPartnerNo:tr.fromPartnerNo,toPartnerNo:myNo})
  return {order:view(o')}
# decline/cancel 同形：只改 transfer.* + 1 条事件，订单归属零改动
```

**过期机制**：**惰性判定**（任何读到 `transfer.status==='PENDING'` 且 `now>expiresAt` 的路径先落 `EXPIRED` 再返回），**不新增 cleanup sweep**（[Q2] 若 Lead 选批量过期，则须加 `cleanup.transferExpire`，并同批改 CONTRACT §5.3 `cleanup` 行与 `shared/actions.js` 的 internal 段）。

**审计**：**不新增 `admin_audit.action`**（`admin_audit` 是治理动作账本，转派是业务动作，证据在 `order_events`）；admin 只在异常介入取消时沿用既有 `ORDER_ANOMALY_CANCEL`（[Q12]）。

### 1.4 D · DTO 增字段与角色可见性矩阵

**新增只读派生键（两条，均 L1）**：①`order.transfer`（对象或 `null`）；②`order.fulfillmentPartnerNo`（=`orders.partnerNo` 快照，顾客据此看到"当前实际履约的是谁"）。

| 字段 | 顾客 | 发起方兼职（PENDING） | 目标兼职（PENDING） | 完成后·原兼职 | 完成后·目标兼职 | 同队其他子队员 | admin | READONLY 视角 |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| 整单 `order.get` 可读性 | ✅ | ✅ | ✅ | ❌ `FORBIDDEN`（已非履约人） | ✅ | ❌ `FORBIDDEN` | ✅ 脱敏 | 按目标本人 |
| `transfer.status` / `expiresAt` | ✅ 仅 `ACCEPTED`（结果态） | ✅ | ✅ | — | ✅（终态） | ❌ | ✅ | 同目标 |
| `transfer.fromPartnerNo` | ❌（无意义，防混淆） | ✅ | ✅ | — | ✅ | ❌ | ✅ | 同目标 |
| `transfer.toPartnerNo` | ✅ 仅在 `ACCEPTED` 后（=履约人变更） | ✅ | ✅（=自己） | — | ✅ | ❌ | ✅ | 同目标 |
| `transfer.resolveReason` | ❌ | ✅ | ✅ | — | ✅ | ❌ | ✅ | 同目标 |
| `fulfillmentPartnerNo` | ✅ | ✅ | ✅ | — | ✅ | ❌ | ✅ | 同目标 |
| `counterpart.displayName`/`avatarUrl`（顾客昵称头像） | — | ✅ 仅当自己是绑定兼职 | ❌ **必须不返回**（D58 明示 + D19/D42） | — | ❌ **必须不返回** | ❌ | ❌（脱敏单源） | 同目标 |
| `customerNo` | 自己 | ✅（绑定顾客） | ❌（[Q6]：建议不返回，仅留 `roomTag`） | — | ❌ | ❌ | ✅（脱敏） | 同目标 |
| `delivery`/`parcels`/`dorm.roomTag`/`note` | ✅ 本人 | ✅ | ✅ **履约必需**（D58 允许） | — | ✅ | ❌ | 脱敏（苑+楼栋） | 同目标 |
| `transfer` 块键集合（白名单断言） | `status,toPartnerNo` | `status,fromPartnerNo,toPartnerNo,requestedAt,expiresAt,resolvedAt,resolveReason` | 同左 | — | 同左 | — | 同左（无 openid） | 同左 |
| 内部 id 泄漏禁令 | 不得出现 `_id/partnerId/toPartnerId/fromPartnerId/openid`（编号用 `partnerNo`） | 同 | 同 | — | 同 | — | 同 | 同 |

### 1.5 E · 共享冻结文件改动清单（由 Lead 指派单写者先改）

| 文件 | 域 | 改动 | 是否多批共用 |
| :-- | :-- | :-- | :-- |
| `shared/actions.js` | S1 | `CLIENT_RULES` +4 条：`order.requestTransfer/acceptTransfer/declineTransfer/cancelTransfer` 均 `write:true`；`order.listPartner` 不变 | **是**（D59 同批也加 4 条 → 必须同一人一次改完） |
| `shared/enums.js` | S1 | `ORDER_EVENTS` +5（`TRANSFER_*`）；新增 `TRANSFER_STATUS`（5 值）、`TRANSFER_RESOLVE_REASON`（5 值）及中文文案；新增 `MESSAGE_HIDDEN_EVENT_TYPES`（见 1.2.4） | **是**（D59 加 `INVITATION_KIND`；批 25 也在改本文件 → 冲突高，排队见 §0.3） |
| `shared/order-state.js` | S1 | `ACTION_RULES` +4 条：`{from:['ACCEPTED'], to:'SAME', event:'TRANSFER_*', roles:[ROLES.PARTNER], changesStatus:false}`；`canAct` 对 `to:'SAME'` 已有通路，无需改引擎 | **是**（批 25 已改本文件 → 必须最后改） |
| `shared/collections.js`、`shared/error-codes.js`、`shared/error-copy.js`、`shared/audit-actions.js` | S1 | **一律不改**（14 集合、13 错误码、既有文案与审计枚举均不变；见 [Q12]） | — |
| `api/modules/order.js` | S0 | +4 导出（`requestTransfer/acceptTransfer/declineTransfer/cancelTransfer`），`listPartner` 透传 `view`；`api/modules/index.js` 按现状形制补 | 是（多 action 同文件） |
| `app.json`/`app.wxss`/`store/index.js`/`api/mode-guard.js` | S0 | **一律不改**（零新页面；转派不入全局快照；`write:true` 自动进 READONLY 拒绝集） | — |

### 1.6 F · 写作用域与文件清单（S0~S10）

| 域 | Owner | 新增文件 | 改动文件（含冲突标注） | 风险 |
| :-- | :-- | :-- | :-- | :-- |
| S1 | v3-data-model | — | `shared/{actions,enums,order-state}.js`（**多批共用/最高冲突**） | 与 D59、批 25 三方抢同一文件 → 由 Lead 串行 |
| S7 | cloud-core | — | 无（不新增域；`router` 靠 `handlers/<domain>` 导出集自动覆盖） | 需确认 `handlers/order/index.js` 导出表 | 
| S8 | cloud-orders | `handlers/order/{requestTransfer,acceptTransfer,declineTransfer,cancelTransfer,_transfer}.js` | `handlers/order/{index.js,_dto.js,_dto-fields.js,get.js,listPartner.js}`（`_dto*.js` **与批 25 冲突**） | 单函数 ≤50 行、单文件 ≤500 行；`_transfer.js` 放共用守卫/过期/事件 |
| S1b | v3-data-model | — | 无（`partner.getPublic` 不参与转派） | — |
| S9 | cloud-admin | — | `handlers/admin/{_dto.js,listOrders.js,getOrder.js}`（增 `transfer` 只读投影，无 openid） | 脱敏单源 `db/dto/mask.js` 不动 |
| S0 | lead | — | `api/modules/order.js`（+4） | 冻结文件，需 Lead 合并 |
| S4 | v3-pickup-ux | `pages/partner/workbench/parts/transfer.js`（纯件：剩余时间/文案）、`pkg-partner/pages/order-detail/parts/transfer.js` | `pages/partner/workbench/{index.js,index.wxml,index.json}`、`pkg-partner/pages/order-detail/**`（四件套视需要） | 工作台 `index.js` 已 499/500 行 → **必须先拆件再改** |
| S3 | v3-lifecycle-flow | — | `pkg-customer/pages/order-detail/{index.js,wxml}`（"由 X 接手履约"提示 + `fulfillmentPartnerNo`） | 页面零判据：状态文案由 DTO 下发 |
| S5 | v4-developer-console | — | `pkg-admin/pages/{orders,order-detail}/**`（只读显示转派留痕） | 不得显示 openid、不得显示顾客昵称 |
| S2 | v3-engineering | `tools/selftest-transfer.js` | `tools/selftest.js`（SUITES +1 → 改 `check.ps1` `SelfTestSuites` 36→37）、`tools/check.js`（如需）、`docs/engineering/V4_ENGINEERING.md` §8 | 套件数常量必须同批改，否则 `check.ps1` exit 1 |
| S6 | v4-privacy-qa | — | `STATE.md`、`CHANGELOG.md`、`docs/delivery/V4_QA_CHECKLIST.md`（新分区 §AF） | 真机项只用户点检 |

### 1.7 G · 判据与测试清单（首红策略：先合法基线，再"只有该闸能挡"的反例）

**新套件 `tools/selftest-transfer.js`（register + `EXPECTED_ASSERTIONS`；注册进 `tools/selftest.js` SUITES 36→37）**

| 组 | 断言（每条挡什么） | 首红构造 |
| :-- | :-- | :-- |
| T1 合法基线 | A（`ACCEPTED`）发起→B 确认：`partnerId/partnerOpenid/partnerNo` 改为 B；`orderNo/customerId/bindingId` 引用/`dorm.roomTag`/`delivery`/`parcels` **逐字段不变**；`status` 仍 `ACCEPTED`、`statusUpdatedAt` 不变；`version+1`；`transfer.status='ACCEPTED'` | 注入"事务里顺手改 status"→ 挡 |
| T2 目标独占 | 非 `transfer.toPartnerId` 的兼职确认 → `FORBIDDEN`（且不写库） | 删 `toPartnerId==me` 校验 → 挡 |
| T3 状态守卫 | `SUBMITTED/PICKED/DELIVERED/EXCEPTION/COMPLETED/CANCELLED` 发起 → `INVALID_STATE`；`cancelTransfer` 在 `ACCEPTED` 后 → `INVALID_STATE` | 放开 `from:ACTIVE_STATUSES` → 挡 |
| T4 隔离 | 真实兼职→测试兼职 / 测试→真实 → `FORBIDDEN`，`orders` 零写入 | 删 `isTestOf` 比较 → 挡 |
| T5 过期 | `now>expiresAt` 确认 → `INVALID_STATE` 且 `transfer` 落 `EXPIRED` **一次**（重复调用不二次写事件） | 去掉过期判定 → 挡 |
| T6 幂等 | 同 `clientRequestId` 重放四个动作 → `duplicated:true`、事件恰 1 条、`version` 只 +1 | 删 requestKey 预查 → 挡 |
| T7 限流 | fake DAO 计数打满 `rl:transfer:*` → `RATE_LIMITED`，零业务写 | 删限流 → 挡 |
| T8 DTO 键白名单 | `transfer` 块键集合恰等于 1.4 表所列；**目标兼职视图内断言字符串级不含 `displayName`/`avatarUrl`/`customerNo`/`openid`/`toPartnerId`** | DTO 回带 `counterpart` → 挡 |
| T9 顾客侧 | `fulfillmentPartnerNo` = 新 `partnerNo`；`counterpart` 仍等于**绑定兼职**（不是履约人）；`transfer.status` 仅 `ACCEPTED` 后可见 | 顾客侧按 `order.partnerId` 取 counterpart → 挡 |
| T10 完成后失联 | 原兼职 `order.get` → `FORBIDDEN`；`order.listPartner` 不再返回该单；`partner.listBindings` 行不变 | 用 `transfer.fromPartnerId` 放行读 → 挡 |
| T11 统计归属 | `order.listPartner counts` 与 `partner.stats` 按**当前** `partnerId` 计；原兼职计数 -1、目标 +1 | 统计读 `transfer.fromPartnerId` → 挡 |
| T12 匿名化 | `anonymizeOrder` 后 `transfer.fromPartnerNo/toPartnerNo=''`，`status/resolveReason` 保留 | 漏清编号快照 → 挡 |
| T13 静态闸 | `handlers/order/**` 零 `db.collection`；页面层零 `'PENDING'/'ACCEPTED'(转派态)` 字面量、零 `random` | 页面写 `transfer.status==='PENDING'` → check #21 红 |

**变异电池（追加 ENGINEERING §7.5，M25~M30，全部"必须变红"）**：M25 `acceptTransfer` 去掉 `toPartnerId===me`→T2；M26 允许 `PICKED`/部分件已取转派→T3；M27 去掉真实×测试一致性校验→T4；M28 确认事务连带改 `status/statusUpdatedAt`→T1；M29 不写 `TRANSFER_ACCEPTED` 事件→T1/T9（顾客收不到通知）；M30 DTO 给目标兼职回 `counterpart.displayName`→T8（D19/D42 破坏）。

**静态门禁**（均为既有判据，不新增判据号）：`check #13`（action 注册表双向：`handlers/order` 导出集 = 注册表集）、`#20`（错误码恰 13）、`#21`（页面零判据）、`#22`（零金额）、`#18`（行数）、`#35/#36`（死导出/页面死函数，新 `parts/transfer.js` 必须有生产引用）、`check.ps1` `$EXPECTED.SelfTestSuites` 36→37。

### 1.8 H · 文档回写点

| 文档 | 回写内容 |
| :-- | :-- |
| CONTRACT §5.3 / §5.1 / §5 状态表 | `order` 行 +4 动作与 `listPartner` `view='transfer'`（若 [Q1]）；补偿动作表 +"转派"行；`ACCEPTED` 行"可执行动作"加"转派（凭 `partnerNo`）" |
| CONTRACT §4.2:236/§4.2:239/§10/§13 D58 行 | 事件 19→24（+5 `TRANSFER_*`）；限流 scope +`transfer`；权限矩阵 +"发起/确认/拒收/撤回转派"行；D58 行补 `pickedCount===0` 闸、惰性过期、待接收读路径、顾客侧只显示编号 |
| DATA_MODEL §2.5/§2.6/§8.4/§5.1/§5.2/§7.5/§10.3/§12 | `orders.transfer` 字段表；事件 19→24 + payload；新索引；新查询路径行；4 动作入参出参；匿名化清编号；负向用例 #47~#51（目标独占/过期/隔离/DTO 遮蔽/完成后失联） |
| UX_PARTNER §3.3（订单详情）、§4.12（红点）、§4.16（多包裹行） | 转派入口位置、待接收区、`剩余 N 分钟` 文案、拒收/撤回二次确认 |
| UX_CUSTOMER §3.8、§5.1 | "由 P-XXX-XXX 接手履约"提示；顾客侧只显示编号、不显示头像昵称 |
| UX_DEVELOPER §3.6、§3.7 | 后台订单列表/详情只读显示转派留痕（编号级、无 openid） |
| QA | 新分区 **§AF（AF1~AF6）**，全部"人（真机）"项，**agent 不代勾**：发起/确认/过期/撤回/顾客提示/统计归属 |
| ARCHITECTURE §3.2、§4.3、§6 | `api/modules/order.js` 新函数；`shared` 注册表 3 处；判据与套件数 36→37 |
| ENGINEERING §4.2、§7.5、§8.1、§8.2 #13 | 路由表 4 动作；变异 M25~M30；`SelfTestSuites` 常量 |
| STATE.md / CHANGELOG.md | 批次台账与"先红后绿"证据串 |

### 1.9 I · 本节未决问题

`[Q1]` 待接收列表读路径；`[Q2]` 过期机制；`[Q3]` 部分件已取能否转派；`[Q4]` PENDING 期间状态变化处理；`[Q5]` 顾客侧可见字段粒度；`[Q6]` 目标兼职 DTO 遮蔽范围；`[Q8]` 目标接单开关/服务范围是否作闸；`[Q9]` 子队员发起转派是否限本队；`[Q12]` "审计"落点。**逐条选项/推荐/影响面见 §4**。

## 2. D59 兼职子队员

### 2.1 A · 口径前提与边界

**一句话需求**：主兼职可发**一次性子邀请码**开**独立子账号**（`partnerNo`/昵称/头像/服务配置各自独立），`partners.parentPartnerId` 记录**仅一层**隶属；**顾客只能绑主兼职、不能绑子队员**；子队员的订单来源只有 D58 转派且限本队。

**明确不做（否定清单）**

| 不做 | 理由/出处 |
| :-- | :-- |
| 多层嵌套（子队员再发子码）；子队员共享主兼职的客户/订单列表/统计 | D59"层级仅一层"；D59 未授权（D54/D19 边界） |
| 顾客绑定子队员 / 子队员出现在 `partner.getPublic` 可预览范围 | D59 + 隐私面不扩大 |
| 子队员代客下单（`order.create` 的 `bindingId`/`guest` 两条兼职路径）；子队员继承主兼职 `roomTag` 空间 | D59 明示；`roomTag` 作用域=（兼职, dormKey）⇒ 独立 tag 空间 |
| 记录任何"队员贡献/收益/分成"语义 | D5/D6 零交易 |

**修订**：D59 修订 **D3**（"兼职准入 = 开发者发码"→"开发者发主码、主兼职可发子码"）、CONTRACT §1.1（邀请码能力归属）、§10（邀请码生成权限行）。**不改** D4/D12/D19/D20/D42。

### 2.2 B · 数据模型变更

**2.2.1 `invitation_codes` 增字段**

| 字段 | 类型 | 必填 | 值域/约束 | 写入方 | 读权限 | 隐私 |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| `kind` | string | 是 | `'DEV'`（开发者主码）/`'SUB'`（主兼职子码）；**旧记录缺该字段按 `'DEV'` 处理（兼容，零迁移）** | `admin.createInvites`（写 DEV）/`partner.createSubInvites`（写 SUB） | admin；主兼职仅见**自己发的** SUB 码 | L1 |
| `issuerPartnerId` | string | 否（DEV 为 `''`） | SUB 必填 = 发码主兼职 `partners._id`；DEV 恒 `''` | `partner.createSubInvites` | admin；该主兼职 | L2 |

- 其余字段（`code/status/batchId/expiresAt/usedBy/usedAt/note/createdBy/createdAt`）语义不变；`createdBy` 对 SUB 码写 `'PARTNER:' + partnerNo`（保留 `developerNo` 语义不变，避免改动字段含义）。
- **激活写 `partners.parentPartnerId` = 该码 `issuerPartnerId`**；并发/重放按 `partner.activate` 既有幂等（`uk_code` + 状态机）。

**2.2.2 `partners` 增字段**

| 字段 | 类型 | 必填 | 值域/约束 | 写入方 | 读权限 | 隐私 |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| `parentPartnerId` | string | 是 | `''` = 主兼职/独立；否则 = 主兼职 `_id`。**服务端强制仅一层**：发码者必须 `parentPartnerId===''` | `partner.activate`（SUB 码）；`partner.removeSubMember`（[Q11]） | 本人/主兼职/admin | L2 |
| `teamJoinedAt` | Date | 否 | 加入队伍时刻（SUB 激活时写）；`''` = 非队员 | `partner.activate` | 本人/主兼职/admin | L1 |

- 旧数据：历史 `partners` 无 `parentPartnerId` ⇒ 读取按 `''`（视为主兼职）；**零迁移**。
- **主兼职停用/注销级联**：`admin.setPartnerStatus` 的 `SUSPENDED`/`CLOSED` 分支增"同 `parentPartnerId` 的子队员一并停用/关闭"（CLOSED 走既有分页事务 + 幂等重试，见 DATA_MODEL §10.4 执行语义）；级联同时把该队 `PENDING` 转派邀请落 `CANCELLED`（reason 复用 `STATE_CHANGED`）。
- **匿名化**：子队员 CLOSED 沿用既有 `partners` PII 匿名化；`parentPartnerId` **保留**（层级审计），主兼职 CLOSED 后 `listSubMembers` 按 `status` 过滤不返回。

**2.2.3 `config` 增键**

| 键 | 类型 | 默认 | 说明 | 公开子集 |
| :-- | :-- | :-- | :-- | :-- |
| `teamMaxMembers` | number | **5**（D59 登记值） | 每主兼职队员上限；超限 `VALIDATION_FAILED`（同 `testAccountMaxPerRole` 形制）；值域 1~10（草案建议值，CONTRACT §4 登记时定稿） | ❌ |
| `subInviteRate` | object | 值以 CONTRACT §4 登记为准 | `{perDay, perMinute}`：主兼职发子码的窗口/日上限 | ❌ |

**2.2.4 索引**：`invitation_codes.idx_issuer(issuerPartnerId, createdAt desc)`（团队页待使用子码列表、作废校验）；`partners.idx_parent(parentPartnerId, status)`（`listSubMembers`、级联停用扫描，每页 ≤100）。

### 2.3 C · 服务端 actions

| 动作 | 允许角色 | 入参 | 守卫（不过 → 错误码） | 事务步骤（伪代码级） | 事件 | 幂等键 | 限流 | 返回体 |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| `partner.createSubInvites` | PARTNER（ACTIVE，`parentPartnerId===''`） | `{count(1~5), validity('24H'\|'72H'\|'7D'), note?(≤50), clientRequestId}` | 自己是子队员 → `FORBIDDEN`；当前队员数 ≥`teamMaxMembers` → `VALIDATION_FAILED`；`SUSPENDED/CLOSED` → `PARTNER_CLOSED` | `count` 次 `insertUnique(invitation_codes{kind:'SUB',issuerPartnerId:me,batchId:'TB'+yyyyMMdd+seq,expiresAt,status:'UNUSED',createdBy:'PARTNER:'+myNo})`；**完整码只在本次响应返回**（同 `admin.createInvites` 口径） | 无（邀请码域无事件） | 自然幂等：同 `clientRequestId` 重放返回同批（`batchId` 派生自请求键） | `rl:subInvite:{openid}:{w…}`+`:d…` | `{batchId, codes[], expiresAt}` |
| `partner.revokeSubInvite` | PARTNER（码的 `issuerPartnerId===me`） | `{code, clientRequestId}` | 码不存在/非本队 → `NOT_FOUND`（**不区分"他人码"，防枚举**）；`status!=='UNUSED'` → `INVALID_STATE` | `update status='REVOKED', revokedAt, revokedBy=myNo` | 无 | `requestKey` 走 `counters` 无条件幂等（同码重复作废返回成功） | 同上 | `{code, status:'REVOKED'}` |
| `partner.listSubMembers` | PARTNER（ACTIVE） | `{}` | 自己是子队员 → 返回自己的队伍摘要（`parentPartnerNo` + `memberCount`）而非全队成员；主兼职返回全队 | 读：`partners WHERE parentPartnerId=me AND status in(ACTIVE,SUSPENDED)`（`idx_parent`，页 ≤100）+ `invitation_codes WHERE issuerPartnerId=me AND status='UNUSED'`（`idx_issuer`，页 ≤50） | 无 | 读 | 无 | `{members[{partnerNo,displayName,status,teamJoinedAt}], pendingInvites[{codeTail(后4位),expiresAt,batchId}], quota:{used,max}}` |
| `partner.removeSubMember` | PARTNER（主兼职，目标 `parentPartnerId===me`） | `{partnerNo, clientRequestId}` | 目标不存在/非本队 → `NOT_FOUND`；目标名下有进行中订单 → `INVALID_STATE`（同解绑闸口径） | 见 [Q11] 裁决；草案默认：`parentPartnerId=''` + `status='SUSPENDED'`（`suspendedReason='TEAM_REMOVED'`）+ 结束该目标的 `PENDING` 转派邀请 | 无 | `requestKey` 无条件幂等 | 同上 | `{partnerNo, status}` |

- **`partner.activate` 改动**：读到 `kind==='SUB'` 的码时，事务内额外写 `parentPartnerId=code.issuerPartnerId`、`teamJoinedAt=now`；`kind==='DEV'`（含字段缺失）维持现状零改动。**不新增 action**。
- **`partner.getPublic` 改动**：目标 `parentPartnerId!==''` ⇒ `NOT_FOUND`（D59 明示，与 DATA_MODEL §12#4"作废即不存在"同口径，不暴露存在性）。
- **`bind.create` 改动**：目标子队员 ⇒ `NOT_FOUND`（与 `getPublic` 同码同文案，防"编号存在但不可绑"的枚举信号）；其余守卫顺序不变。
- **`order.create` 兼职路径**：子队员调 `bindingId`/`guest` 两路均 `FORBIDDEN`（D59"不可代客下单"）；**顾客路径不变**（顾客绑的永远是主兼职）。
- **审计**：不新增 `admin_audit.action`；留痕落 `invitation_codes{kind,issuerPartnerId,batchId,revokedAt/By}` + `partners{parentPartnerId,teamJoinedAt}`（[Q12]）。

### 2.4 D · DTO 增字段与角色可见性矩阵

**新增键**：`user.bootstrap.partner.team`（对象或 `null`）。

| 字段 | 子队员本人 | 主兼职（队长） | 其他主兼职 | 绑定该主兼职的顾客 | admin | READONLY 视角 |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| `team.parentPartnerNo` | ✅（知道自己在谁的队里） | ❌（自己无上级） | ❌ | ❌ | ✅ | 同目标本人 |
| `team.memberCount` | ✅ | ✅ | ❌ | ❌ | ✅ | 同目标 |
| `team.quota{used,max}` | ❌ | ✅ | ❌ | ❌ | ✅ | 同目标 |
| `members[].partnerNo` | ❌（见自己即可） | ✅ | ❌ | ❌ | ✅ | 同目标 |
| `members[].displayName` | — | ✅ 仅本队（[Q7]）（**不展示头像**） | ❌ | ❌ | 脱敏 | 同目标 |
| `members[].status` | — | ✅ | ❌ | ❌ | ✅ | 同目标 |
| `pendingInvites[].codeTail` | — | ✅（**后 4 位**，完整码只在创建响应） | ❌ | ❌ | ✅（完整码） | 同目标 |
| `partner.getPublic` 命中子队员 | — | — | — | ❌ `NOT_FOUND` | — | ❌ `NOT_FOUND` |
| 禁令 | 不出现 `openid/parentPartnerId`（用编号表达）；不出现头像 fileId | 同 | 同 | 同 | 同 | 同 |

### 2.5 E · 共享冻结文件改动清单

| 文件 | 域 | 改动 | 多批共用 |
| :-- | :-- | :-- | :-- |
| `shared/actions.js` | S1 | `CLIENT_RULES` +4 条 `partner.*`（均 `write:true`，`listSubMembers` 为 `write:false`） | **是**（与 D58 同批一次改完） |
| `shared/enums.js` | S1 | +`INVITATION_KIND={DEV:'DEV',SUB:'SUB'}`、`TEAM_STATUS` 文案（沿用 `PARTNER_STATUS`）、`memberStatusText` | **是** |
| `shared/audit-actions.js` | S1 | **不改**（[Q12]：D59 无管理动作） | — |
| `shared/collections.js` | S1 | **不改** | — |
| `shared/validate.js` | S1 | +`validateTeamNote`（≤50）与 `validity` 枚举校验；**不新增编号形态** | 是 |
| `shared/order-state.js` | S1 | **不改** | — |
| `app.json` | S0 | **仅当 [Q10] 选"新页"**：`pkg-partner/pages/team/index` 注册（32→33 页，联动见 2.6） | 是 |
| `app.wxss` | S0 | 不改（复用既有卡片/列表样式与 `.page-body`） | — |
| `api/modules/partner.js` | S0 | +4 导出 | 是 |
| `api/modules/order.js` | S0 | 不改（转派在 D58） | — |
| `store/index.js` | S0 | +`team` 快照字段（可选；团队页可直读 `user.bootstrap`） | 是 |

### 2.6 F · 写作用域与文件清单（S0~S10）

| 域 | Owner | 新增文件 | 改动文件 | 风险/易冲突 |
| :-- | :-- | :-- | :-- | :-- |
| S1 | v3-data-model | — | `shared/{actions,enums,validate}.js` | 与 D58/批 25 抢文件 |
| S1b | v3-data-model | `handlers/partner/{createSubInvites,revokeSubInvite,listSubMembers,removeSubMember,_team}.js` | `handlers/partner/{index.js,activate.js,getPublic.js}`、`handlers/bind/create.js`、`handlers/order/_create.js`（子队员禁代客单） | `activate.js` 179 行、`_create.js` 与批 25 相邻 → 排队 |
| S9 | cloud-admin | — | `handlers/admin/{listInvites,invite-codes/_dto}`（列表增 `kind` 列 + `issuerPartnerNo`；admin 仍可对 SUB 码作废吗 → 本草案：**不可**，由主兼职管理，admin 只能看） | `admin.createInvites` 写 `kind:'DEV'` |
| S0 | lead | — | `api/modules/partner.js`；`app.json`（[Q10]）；`pages/profile/{index.js,wxml}`（团队入口，[Q15 同源冲突见 D63]） | `pages/profile/**` 同时被 D63 改 → **必须同一写者顺序改** |
| S4 | v3-pickup-ux | `pkg-partner/pages/team/**`（四件套，[Q10]）或 `pkg-partner/pages/service-settings/parts/team.js` | `pkg-partner/pages/service-settings/**`（若复用） | 新页 = 页数 33，联动 check #3/#4/#36、CONTRACT §7、ARCHITECTURE §6 |
| S3 | v3-lifecycle-flow | — | `pages/role/index.js`（邀请卡文案："顾客绑定主兼职"提示不变） | 与 D63 同文件 → 合并写者 |
| S5 | v4-developer-console | — | `pkg-admin/pages/invite-codes/**`（`kind` 列；SUB 码只读） | — |
| S2 | v3-engineering | `tools/selftest-team.js` | `tools/selftest.js`（SUITES 37→38）、`check.ps1`（`SelfTestSuites` 37→38）、`tools/check.js` #3 若加页 | 常量三处联动 |
| S6 | v4-privacy-qa | — | `docs/privacy/*`（协作履约披露）、`docs/delivery/V4_QA_CHECKLIST.md` §AF、`STATE.md`、`CHANGELOG.md` | 隐私文本只能用户终审 |

### 2.7 G · 判据与测试清单

**新套件 `tools/selftest-team.js`（register + `EXPECTED_ASSERTIONS`；SUITES 37→38）**

| 组 | 断言 | 首红构造 |
| :-- | :-- | :-- |
| U1 基线 | 主兼职发 2 个 SUB 码 → 子账号激活：`parentPartnerId=主兼职_id`、`teamJoinedAt` 有值、独立 `partnerNo`/`serviceConfig`；码变 `USED` | 激活漏写 `parentPartnerId` → 挡 |
| U2 仅一层 | 子队员调 `createSubInvites` → `FORBIDDEN`，零落库 | 删"发码者必须 `parentPartnerId===''`" → 挡 |
| U3 上限 | 已达 `teamMaxMembers` 再发 → `VALIDATION_FAILED`；恰好等于上限时可发最后一码 | 用 `>` 代替 `>=` → 挡 |
| U4 顾客不可绑 | `partner.getPublic({子队员 partnerNo})` → `NOT_FOUND`；`bind.create({子队员 partnerNo})` → `NOT_FOUND`；`bindings` 零写入 | 删 `getPublic` 子队员闸 → 挡 |
| U5 禁代客单 | 子队员调 `order.create`（`bindingId` 路径与 `guest` 路径）→ `FORBIDDEN`，`orders` 零写入 | 删该守卫 → 挡 |
| U6 级联停用 | 主兼职 `setPartnerStatus(SUSPENDED)` → 子队员 `status=SUSPENDED`；`CLOSED` → 子队员 `CLOSED` 且其 `PENDING` 转派邀请 `CANCELLED` | 级联不执行 → 挡 |
| U7 兼容 | 构造无 `kind` 的历史码 → 激活按 DEV 处理（不写 `parentPartnerId`）；`admin.createInvites` 新码 `kind='DEV'` | 默认值写成 `'SUB'` → 挡 |
| U8 作废边界 | 他人码作废 → `NOT_FOUND`；已用码 → `INVALID_STATE`；本队未用码 → `REVOKED` + `revokedBy` 有值 | 去掉 `issuerPartnerId===me` → 挡 |
| U9 限流 | fake DAO 打满 `rl:subInvite:*` → `RATE_LIMITED` | 删限流 → 挡 |
| U10 DTO 键白名单 | `members[]` 键集合 = `{partnerNo,displayName,status,teamJoinedAt}`；**不含 `openid/parentPartnerId/avatarFileId`**；`pendingInvites[].codeTail` 长度 4 | 给 members 加头像 fileId → 挡 |
| U11 静态闸 | `pkg-partner/**` 零 `bind.create`/`bind.release`（沿用 check #28 语义）；页面层零 `'UNUSED'/'ACTIVE'` 队伍状态字面量 | 页面判 `code.status==='UNUSED'` → 挡 |

**变异电池（ENGINEERING §7.5，M31~M34）**：M31 去掉二层守卫 → U2；M32 去掉 `getPublic`/`bind.create` 子队员闸 → U4；M33 级联停用不执行 → U6；M34 `kind` 默认写 `'SUB'` → U7。

**静态门禁**：`check #13`（`handlers/partner` 导出集 = 注册表）、`#18`（`_team.js`/页面行数）、`#35/#36`（新导出必须有生产引用）、若 [Q10] 新页则 `#3/#4/#36` + `check-docs #2` 页数 32→33 同步。

### 2.8 H · 文档回写点

| 文档 | 回写内容 |
| :-- | :-- |
| CONTRACT §1.1 第 2 条 / §4:190/§4:195/§4:198 / §10 | "邀请码只能开发者生成"→"开发者发主码（`kind=DEV`）、主兼职可发子码（`kind=SUB`，一次性、24h/72h/7d、可作废、上限 `teamMaxMembers`）"；`invitation_codes` +`kind/issuerPartnerId`、`partners` +`parentPartnerId/teamJoinedAt`、`config` +`teamMaxMembers/subInviteRate`；权限矩阵"邀请码生成/作废"行拆为开发者/主兼职两行 + "顾客不可绑子队员"行 |
| CONTRACT §11.2 / §13 D59 行 | 新增披露项（v1.10）**"订单可能由你绑定兼职的协作队员协助履约"** + 队内昵称可见范围（隐私文本只能用户终审）；D59 行补：仅一层、`removeSubMember` 语义、审计落点、级联范围 |
| DATA_MODEL §2.3/§2.8/§2.9/§2.10/§4.3/§5.1/§5.2/§7.4/§10.4/§12 | 字段表、邀请码 kind 状态机、config 键、索引、查询路径（团队页）、4 动作契约、CLOSED 级联、负向用例 #52~#55 |
| UX_PARTNER §3.10/新页 §3.12；UX_CUSTOMER §3.6/§6.2；UX_DEVELOPER §3.2 | 团队入口/成员列表/发码/作废/移除交互与人数文案；绑定页"编号不可绑定"文案（子队员 `NOT_FOUND` 同"编号不存在"）；邀请码列表 `kind` 列（DEV/SUB）、SUB 码只读 |
| QA §AF（AF7~AF12）；ARCHITECTURE §2/§3.2/§4.3/§6；ENGINEERING §4.2/§7.5/§8.1/#3 | 人（真机）项 **agent 不代勾**；新 handler 文件、`api/modules/partner.js`、`shared` 注册表、页数与套件数；路由表 4 动作、M31~M34、套件常量、页数 |

### 2.9 I · 本节未决问题

`[Q7]` 主兼职可见子队员哪些字段；`[Q9]` 与 D58 的队内转派；`[Q10]` 团队页载体；`[Q11]` `removeSubMember` 语义；`[Q12]` 审计落点；`[Q13]` 隐私披露版本与落点。**见 §4**。

## 3. D63 顾客邀请顾客

### 3.1 A · 口径前提与边界

**一句话需求**：顾客在自己有 **ACTIVE 绑定**时，可生成"**该兼职的绑定卡**"（复用现有 bind 卡，只带 `partnerNo`）；被邀请人落地后走 **D37 隐私闸 → 邀请卡 → D38 自动绑定**；**不记录任何邀请关系**。

**明确不做**：不新增集合/字段/接口/统计（"不记录"是硬边界）；卡片不带邀请者 `customerNo`/昵称/头像/宿舍/尾号；不改 D36 两种卡型；不做邀请奖励（D5/D6）；不新增 `?inviter=` 等 query 参数（`launch` 只认 `bind`/`orderNo`，CONTRACT §7:429）。

**修订**：无。依赖 D37（隐私闸）+ D38（自动绑定）+ D39（限流）既有口径，**全部零改动**。**服务端零改动**是本节的硬结论。

### 3.2 B · 数据模型变更

**无。** 无新集合、无新字段、无新索引、无新 config 键、无迁移、无匿名化/留存影响。唯一"数据形状"变化是纯件入参（不落库）：`utils/share/index.js#buildAppMessage` 增可选入参 `boundPartnerNo`。

### 3.3 C · 服务端 actions

**零新增、零改动、零限流键。** 既有闸门全部复用：`partner.getPublic`（预览限流与"绑定前只回昵称"不变）、`bind.create`（顾客本人发起 + 资料完整 + 无进行中订单 + 自绑拒绝 + 测试隔离 + 滚动 60 秒/5 次）、`launch` 参数白名单只认 `bind`/`orderNo`（新增参数会被丢弃，**不得**为 D63 扩白名单）。
**落地链路（记录口径以确认"服务端无新分支"）**：分享卡 `path=/pages/launch/index?bind=P-XXX-XXX` → `launch` 读 `bind` → 隐私闸 → `role?bind=` → 隐私同意 + 资料完整 → 客户端自动 `bind.create({partnerNo})` → 已绑同号 `duplicated:true`（提示"已绑定·去下单"）/ 已绑异号 `CONFLICT`（走 D28 一次确认换绑）/ 兼职停用 `PARTNER_CLOSED`、CLOSED `NOT_FOUND`（既有文案）。

### 3.4 D · DTO 增字段与角色可见性矩阵

**DTO 零改动。** 卡片取值只来自已有 DTO：顾客侧 `bind.getCurrent().partnerPublic.partnerNo`（`store.binding.partnerPublic`，`store/index.js:11-13` 已水合）。

| 卡片内容 | 谁能生成 | 顾客侧可见 | 兼职侧可见 | 被邀请人可见 | admin/READONLY |
| :-- | :-- | :-- | :-- | :-- | :-- |
| `title`（中性）+ 固定封面 + `path=/pages/launch/index?bind=<partnerNo>` | 顾客（有 ACTIVE 绑定）/ 兼职 | ✅ | ✅ | ✅ | 后台零分享入口（check #33③） |
| 邀请者 `customerNo`/昵称/头像/宿舍/尾号；订单号/取件码/宿舍/票据/截图 | **任何人** | ❌ 永不出现 | ❌ | ❌ | — |

### 3.5 E · 共享冻结文件改动清单

| 文件 | 域 | 改动 | 多批共用 |
| :-- | :-- | :-- | :-- |
| `utils/share/index.js` | S0 | `buildAppMessage(input)` 入参 +`boundPartnerNo`；放行式改为 `(isCustomer===false && partnerNo!=='') \|\| (isCustomer===true && boundPartnerNo!=='')`，且 `viewSession===true` 一律回通用卡（现状优先级不变）；新增 `TITLES.BIND_CUSTOMER`（[Q14]） | 是（S0 冻结） |
| `pages/profile/parts/share-card.js` | S0 | 透传入参（薄封装不变形制） | — |
| `pages/profile/index.js` | S0 | 数据装配：顾客用 `store.binding.partnerPublic.partnerNo` 填 `partnerCard`；无绑定则空 | **与 D59 团队入口同文件 → 同一写者顺序改** |
| `pages/role/index.js` | S3 | 邀请卡文案（仅当 [Q15] 采纳"落地页提示"时） | 与 D59 同文件 |
| `shared/**`、`api/**`、`cloudfunctions/**`、`app.json`、`app.wxss`、`store/**` | — | **全部不改**（错误码、动作、集合、页面均不变） | — |

### 3.6 F · 写作用域与文件清单

| 域 | Owner | 新增 | 改动 | 易冲突 |
| :-- | :-- | :-- | :-- | :-- |
| S0 | lead | — | `utils/share/index.js`、`pages/profile/{index.js,index.wxml,parts/share-card.js}` | 与 D59 团队入口同文件（`pages/profile/**`） |
| S3 | v3-lifecycle-flow | — | `pages/role/{index.js,index.wxml}`（文案） | 与 D59 同文件 |
| S2 | v3-engineering | — | `tools/lib/check-share.js`（卡片 path 形态白名单）、`tools/selftest-share.js`（+S 组）、`tools/lib/share-pages.js`（**清单不变**，profile/role 已在册） | 若改断言数须同批改 `EXPECTED_ASSERTIONS` |
| S6 | v4-privacy-qa | — | `docs/ux/V4_UX_CUSTOMER.md`、QA §AF、`CHANGELOG.md` | — |

### 3.7 G · 判据与测试清单（套件数不变，`selftest-share` 内 +S 组）

| 断言 | 挡什么 | 首红构造 |
| :-- | :-- | :-- |
| S1 基线-兼职 | 兼职身份 + 有编号 → 绑定卡（`path=launch?bind=P-XXX-XXX`） | 改放行式误伤兼职 → 挡 |
| S2 基线-顾客 | 顾客 + `boundPartnerNo` → **同一**绑定卡（同 path、同 query 键） | 顾客回通用卡（=D63 未落地）→ 挡 |
| S3 无绑定 | 顾客无绑定 → 通用卡（零 query） | 无绑定也拼 `?bind=` → 挡 |
| S4 切会话 | `viewSession===true`（哪怕有 `boundPartnerNo`）→ 通用卡 | 切会话泄漏目标编号 → 挡 |
| S5 零泄漏 | 卡片对象序列化后不含 `customerNo/inviter/orderNo/pickupCode/dormKey/phoneTail/displayName/avatarFileId/viewTicket` | 加 `inviter=` → 挡 |
| S6 静态 | `utils/share/index.js` 零 `wx.`；`pages/profile/**` 不自拼 path/title（沿用 check #33⑤⑥） | 页面里拼 `?bind=` → 挡 |
| S7 门禁 | `tools/lib/check-share.js`：卡片 path ∈ {`/pages/launch/index`、`/pages/launch/index?bind=<partnerNo 形态>`}；`bind` 值必须过 `^P[2-9A-Z]{6}$` 归一 | 加入任意新 query → 挡 |

**变异电池（M35~M37）**：M35 放行"顾客无绑定也发绑定卡" → S3；M36 path 拼 `?inviter=` → S5/S7；M37 切会话不禁分享 → S4。

### 3.8 H · 文档回写点

| 文档 | 回写内容 |
| :-- | :-- |
| CONTRACT §8（分享与朋友圈）、§13 D63 行 | 卡片生成主体从"兼职"扩为"兼职或**有 ACTIVE 绑定的顾客**"；明确"不记录邀请关系、卡片零邀请者信息" |
| CONTRACT §11.2 | 声明**零新增披露**（无新采集、无新对外提供），并注明 D63 不改变隐私边界 |
| DATA_MODEL | 显式写"本节无数据模型变更"（避免后续被误加字段） |
| UX_CUSTOMER §3.5（我的）、§3.6（绑定落地）、§6.3（分享卡） | 顾客侧分享入口与文案；落地后各分支提示（同号/异号/停用/注销） |
| UX_PARTNER §7（绑定卡分享） | 说明顾客也可发同一张卡（兼职侧行为不变） |
| QA §AF（AF13~AF15） | 人（真机）：顾客分享→新顾客自动绑定同一兼职；真机分享只用户点检 |
| ARCHITECTURE §3（`utils/share` 入参形状） | `buildAppMessage` 入参增 `boundPartnerNo`（冻结接口变更，S0 单写者） |
| ENGINEERING §8.2 #33 | 判据⑤⑥口径补"顾客侧放行"，断言在 `selftest-share`/`check-share` |
| STATE.md / CHANGELOG.md | 台账与"先红后绿"证据 |

### 3.9 I · 本节未决问题

`[Q14]` 顾客生成卡的标题文案；`[Q15]` 顾客端入口位置。**见 §4**。

## 4. 未决问题 `[Q#]`（Lead 开工前裁决；裁决后并入 CONTRACT §13 对应 D 行，`[Q#]` 即作废）

| # | 问题 | 选项 | 推荐 | 影响面 |
| :-- | :-- | :-- | :-- | :-- |
| Q1 | D58 待接收列表的读路径（D58 登记"4 个 action"，未含读） | A 复用 `order.listPartner({view:'transfer'})`；B 新增读 action `order.listTransfers`；C 塞进 `user.bootstrap` 摘要 | **A**（零新增 action，与 D52 `view=day` 同形制；顶层只增 `transferPending` 角标，`counts` 六项形状不变） | DATA_MODEL §7.5 `view` 枚举、CONTRACT §5.3 §10、`api/modules/order`、工作台 |
| Q2 | 10 分钟过期谁来落库 | A 惰性判定（读到时补写 `EXPIRED`）；B 新增 `cleanup.transferExpire` 批；C 两者都做 | **A**（零新 sweep、零新 action；代价=不读则记录停在 PENDING，需 H 文档写明） | 若选 B：CONTRACT §5.3 `cleanup` 行、`shared/actions.js` internal、cleanup 套件、`$EXPECTED` 不变但 sweep 数变 |
| Q3 | `ACCEPTED` 但已部分取件（D61）能否转派 | A 禁止（`pickedCount>0` → `INVALID_STATE`）；B 允许，已取件随之交接；C 允许但要求目标确认件级明细 | **A**（忠实 D58"未取件"原文；实物已在原兼职手上，交接语义未定义） | `_transfer.js` 守卫、UX_PARTNER 文案、T3 断言、CONTRACT D58 行补句 |
| Q4 | PENDING 期间订单离开 `ACCEPTED`（原兼职取件/异常/取消） | A 邀请自动 `EXPIRED`（`reason=STATE_CHANGED`），确认时 `INVALID_STATE`；B PENDING 期间冻结 `markPicked` 等动作；C 自动 `CANCELLED` 但不报错给目标 | **A**（不冻结接单后的正常工作流；与 1.3 守卫自洽） | `_transfer.js` 惰性判定、`markPicked/reportException/cancel` 是否需挂钩、T3/T5 断言 |
| Q5 | 顾客侧"当前履约兼职"显示粒度 | A 只显示 `partnerNo`（+文案"由该兼职接手履约"）；B 编号 + `displayName`；C 编号 + 昵称 + 头像 | **A**（D19/D42：头像昵称只对绑定对方；履约人可能不是绑定人） | DTO `fulfillmentPartnerNo`、UX_CUSTOMER §3.8、T9 断言（B/C 需先改 D19 口径，不推荐） |
| Q6 | 目标兼职 DTO 遮蔽范围 | A 不给 `customerNo/displayName/avatarUrl`，保留 `roomTag`+`delivery`+`parcels`+`note`；B 保留 `customerNo`（便于报单）；C 保留昵称 | **A**（D58"不展示顾客头像/昵称/客户档案"；`customerNo` 只在客服场景需要，且会带来顾客可被反查风险） | `_dto.js` counterpart 分支、T8 断言、DATA_MODEL §2.4 读屏蔽 |
| Q7 | 主兼职可见子队员哪些字段 | A `partnerNo`+`displayName`（无头像）；B 仅 `partnerNo`；C 编号+昵称+头像 | **A**（队内管理必需识别成员；头像按 D19 从严不给。选 B 则团队页无法区分同名队员） | §2.4 矩阵、U10 断言、CONTRACT §11.2 披露句 |
| Q8 | 转派目标是否校验接单开关/服务范围 | A 只校验 `status==='ACTIVE'`（照 D58 原文）；B 另校验 `acceptingOrders=true`；C B + `zones` 覆盖本单 `delivery.zone` | **A**（原文"任意 ACTIVE 兼职"；目标是主动确认方，开关由目标自行判断；B/C 会引入 D58 未登记的拒绝面） | 守卫链、错误码选用（B/C 需用 `PARTNER_CLOSED`/`VALIDATION_FAILED`）、T3 断言 |
| Q9 | D58×D59：子队员发起的转派是否限本队 | A 仅子队员受限（只能转给主兼职 + 同队子队员）；主兼职可转任意 ACTIVE；B 所有转派都限本队；C 全部不限（D59"限本队"仅指推送展示，不设硬闸） | **A**（同时满足 D58"任意 ACTIVE"与 D59"限本队"，且不缩主兼职权限） | `_transfer.js` 目标集合计算、`partners.idx_parent` 查询、U 组/T 组断言、CONTRACT D58/D59 行补句 |
| Q10 | D59 团队页载体 | A 新分包页 `pkg-partner/pages/team/index`（32→33 页）；B 并入 `service-settings` 页内区块；C 并入 `pages/profile` 区块 | **A**（成员列表/发码/作废/移除四类交互塞进配置页会超 500 行且职责混乱；代价是页数联动 4 处） | `app.json`、check #3/#4/#36、`check-docs #2`、CONTRACT §7、ARCHITECTURE §6、`tools/lib/share-pages.js` |
| Q11 | `partner.removeSubMember` 语义 | A 解除隶属（`parentPartnerId=''`）+ `status='SUSPENDED'`（`TEAM_REMOVED`），恢复需 admin；B 只解除隶属、保持 ACTIVE（随即变成可被顾客绑定的普通兼职）；C 仅隐藏不落库 | **A**（唯一能同时守住"顾客不绑子队员"与"层级仅一层"的方案；B 会悄悄扩大隐私面） | `_team.js`、`admin.setPartnerStatus` 恢复路径、U6 断言、CONTRACT D59 行 |
| Q12 | D58/D59 文字里的"审计"落点 | A 不新增 `admin_audit.action`（业务证据落 `order_events`/`invitation_codes` 留痕）；B 新增 `TRANSFER_*`、`SUB_INVITE_*` 审计枚举；C 只给 D59 加 | **A**（`admin_audit` 语义=管理动作，混入业务动作会让 AC-D 审计页口径失真；且 B 需改 `shared/audit-actions.js` + check #30） | `shared/audit-actions.js`、check #30、UX_DEVELOPER §3.1 审计区块、DATA_MODEL §2.11 |
| Q13 | D59 隐私披露落点与版本 | A 作为 CONTRACT §11.2 的 **v1.10 新增披露项**（协作履约一句话 + 队内昵称可见）；B 并入下一次批量隐私修订；C 不改隐私文本（仅页面提示） | **A**（D59 明文要求"隐私文本新增披露"；不披露即上线风险） | `docs/privacy/*`、CONTRACT §11.2、`selftest-privacy-text`、`config.privacyVersion`、提审材料 |
| Q14 | 顾客生成绑定卡的标题文案 | A 新增 `TITLES.BIND_CUSTOMER`（如"校园快递代取｜凭兼职编号可绑定下单"）；B 复用兼职标题「我在做校园代取…」；C 一律回通用卡标题 | **A**（卡片类型/字段/路径都不变，只多一条中性文案常量；B 会让顾客说出"我在做代取"的错话） | `utils/share/index.js`、`TITLES` 单源、`selftest-share` S2、UX_CUSTOMER §6.3 |
| Q15 | 顾客侧分享入口位置 | A 只在 `pages/profile`（我的）主入口；B 我的 + 顾客首页；C 我的 + 订单详情（每单可邀） | **A**（与 D36"可见入口=首页/帮助/我的"一致，且不把分享塞进高频业务页；C 会把分享入口与订单绑定，易被误解为"邀请有奖励"） | `pages/profile/**`、`pages/customer/home/**`、`tools/lib/share-pages.js`（**清单不变**，仅页面内入口）、UX_CUSTOMER §3.3/§3.5 |

## 5. 发现的不一致与现状冲突（供 Lead 收口，本文不改动它们）

| # | 位置 | 问题 | 建议 |
| :-- | :-- | :-- | :-- |
| 1 | `docs/contract/V4_CONTRACT.md:653`（D58 行）vs `:236`（事件清单 19 种）与 `docs/data/V4_DATA_MODEL.md:856`（标题"19 种"） | D58 要求写 5 个 `TRANSFER_*` 事件，但事件全集仍写 19 种、未含 `TRANSFER_*` | 批 26 同批把 §4.2:236 与 §8.4:856 改为 24 种 |
| 2 | `docs/contract/V4_CONTRACT.md:653`（"订单 `ACCEPTED`（未取件）"）vs `shared/order-state.js:40-47` + `cloudfunctions/api/handlers/order/_picked.js:64-68`（D61 已落件级取件） | 存在"`ACCEPTED` 但已取 N 件"的合法状态，D58 未定义该状态下能否转派 | 见 [Q3] |
| 3 | `docs/contract/V4_CONTRACT.md:239` vs `docs/data/V4_DATA_MODEL.md:235` | 两处限流 scope 列表不一致（一处缺 `ai`，另一处有）；D58/D59 新增 `transfer`/`subInvite` 需同批统一 | 批 26 同批统一为一份列表 |
| 4 | `docs/engineering/V4_ENGINEERING.md:793` vs `:839` 与 `check.ps1:29` | §8.1 行仍写 `CheckCriteria=36`/`SelfTestSuites=36`，实际已是 39/36（批 24 未回改 §8.1） | 批 26 同批修 §8.1 的 36→39 |
| 5 | `docs/data/V4_DATA_MODEL.md:726` | `order.listPartner` 的 `view` 枚举仍写 `workbench\|history\|customer`，未含 D52 已裁决的 `view='day'`（存量漂移） | 批 26 补 `day`，并与 [Q1] 的 `transfer` 一次写全 |
| 6 | `cloudfunctions/api/handlers/message/list.js:124-131` | 事件项构造**无类型白名单**（全量下发本单最近 N 条事件），与 CONTRACT §9"状态类事件"口径不符；D58 的 4 个私有事件会进顾客消息中心并计入未读 | 本文已按最小改动处理（黑名单 4 个新事件），存量泛化问题单列 TD，不在本批扩大 |
| 7 | `utils/share/index.js:39` | 放行条件 `source.isCustomer === false` 与已裁决的 D63（顾客可发绑定卡）**直接冲突** | 批 27 按 3.5 改（S0 单写者） |
| 8 | `docs/contract/V4_CONTRACT.md:392/397` vs `docs/contract/V4_DECISIONS.md:683` | 顾客"取件码"格位表述不一致（CONTRACT 说"视觉同级第 3 格"，DECISIONS 说"底部第 4 格"） | 与本文无关，登记供 D64 收口 |
| 9 | `docs/contract/V4_CONTRACT.md:195`（`invitation_codes` 集合行）/`:190`（`partners` 行） | 尚未含 D59 的 `kind/issuerPartnerId`、`parentPartnerId/teamJoinedAt` | 批 26 按 2.8 回写（属计划内变更，非冲突） |
| 10 | `ENGINEERING §8.2 #3`（`:801`）+ `check.js #3` | 硬编码"主包 8 页 + 分包 24 页"；[Q10] 若选新页必须同批改代码与文档，否则 `check.ps1` 直接红 | 选 A 时把页数联动写进批 27 工单 |

## 6. 交付自检（本文档自身）

- 唯一新增文件：本文件；未修改任何既有文件、未执行任何 git 命令、未运行 `check.ps1`。
- 结构：D58/D59/D63 各含 A~I 九项；§4 未决 15 条（≤15）；§5 现状冲突 10 条（含 `file:line`）。
- 纪律：错误码 13 个不变；集合 14 个不变；事件只 D58 +5（已标注需 CONTRACT/DATA_MODEL 同批改）；零金额（无交易语义表述）；页面层零判据；未写实现代码（仅伪代码/表/文件树）；真机项全部标注"人（真机），agent 不代勾"。
