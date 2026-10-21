# V4_ARCHITECTURE · 代码分层与并行开发冻结接口（批 1 起）

> 冻结时间：2026-10-21（v0.9 口径）。**设计口径唯一来源 = `docs/V4_CONTRACT.md` v0.9**，工程规则来源 = `docs/V4_ENGINEERING.md`。本文只登记**代码级接口、写作用域与自检方法**；与 CONTRACT 冲突时以 CONTRACT 为准，并先回报 Lead，不得自行改口径。

## 1. 分层与数据流

```
pages/  pkg-*/pages/  components/  custom-tab-bar/   展示层：取参、调 api/、setData、事件转发
                │
                ▼
api/（client.js + modules/* + upload.js + privacy.js + mode-guard.js）   唯一云函数出口
store/（内存快照 + 订阅；只读给页面）                    utils/ + shared/（零 wx 纯逻辑）
                │
                ▼
cloudfunctions/api（index → app → router → middleware → handlers → db/dao）
cloudfunctions/cleanup（index → sweeps/*）
                │
                ▼
cloudfunctions/*/shared/（由 shared/** 与 utils/ids.js、utils/room-tag.js 逐字节同步的副本）
```

铁律：客户端不出现集合名与 action 字面量（只允许在 `api/` 与 `shared/`）；云函数不出现 `db.collection`（只允许 `db/dao.js`）；身份只来自服务端（真实 `OPENID` 或切换会话票据解析结果）。

## 2. 本轮并行写作用域（单写者；越界 = 冲突，冲突先报 Lead）

| 工作流 | Owner | 写作用域（只许改这些） |
| :-- | :-- | :-- |
| S0 骨架与集成 | lead | `app.json` `app.js` `app.wxss` `project.config.json` `sitemap.json` `.gitignore` `.tool-versions` `.env.example` `config/env.js` `config/route.js` `api/**` `store/**` `pages/launch/**` `pages/profile/**` `docs/ARCHITECTURE.md` |
| S1 口径纯件 | v3-data-model | `shared/**` `utils/ids.js` `utils/room-tag.js` `config/defaults.js` |
| S1b 云端身份域 | v3-data-model | `cloudfunctions/api/handlers/{user,customer,partner,bind,upload,config}/**` |
| S2 工具链与门禁 | v3-engineering | `tools/**` `check.ps1` `gate.ps1` `doctor.ps1` |
| S3 顾客端 | v3-lifecycle-flow | `pages/role/**` `pages/customer/**` `pkg-customer/**` `utils/recognize/**` `utils/ocr/**` |
| S4 兼职端 | v3-pickup-ux | `pages/partner/**` `pkg-partner/**` `utils/customer-view.js` `utils/order-edit.js` |
| S5 开发者后台页 | v4-developer-console | `pkg-admin/**` |
| S6 仓库文档与隐私件 | v4-privacy-qa | `AGENTS.md` `STATE.md` `CHANGELOG.md` `docs/RUNBOOK.md` `docs/V4_FIXTURES.md` `docs/TECH_DEBT.md` `utils/storage.js` `utils/privacy-policy.js` `utils/avatar.js` |
| S7 云核心 | cloud-core（新） | `cloudfunctions/api/index.js` `app.js` `router.js` `bootstrap.js` `middleware/**` `db/**` `lib/{respond,errors,time,id-generator,tag-allocator}.js` `handlers/health/**` `package.json` `cloudfunctions/cleanup/index.js` `cloudfunctions/cleanup/package.json` |
| S8 云订单与兜底 | cloud-orders（新） | `cloudfunctions/api/handlers/{order,message,ai}/**` `cloudfunctions/api/lib/ai/**` `cloudfunctions/cleanup/sweeps/**` |
| S9 云后台 | cloud-admin（新） | `cloudfunctions/api/handlers/admin/**` `cloudfunctions/api/handlers/admin/dto/**`（如需要） |
| S10 组件与资产 | ui-components（新） | `components/**` `custom-tab-bar/**` `assets/**` |

- 云函数 `shared/` 副本**任何人不得手写**：由 `node tools/sync-cloud-shared.js` 生成（S2 提供脚本，S1 完成后 Lead 先跑一次）。
- 公共文件一旦冻结（`app.json`、`app.wxss`、`shared/**`、`api/**`、`store/**`）：需要改动先发 Lead，由单写者合并。
- 新增文件必须落在自己的写作用域内；跨域引用只读或走 `require`，不得改他人文件。

## 3. 客户端冻结接口

### 3.1 `api/client.js`（唯一 `wx.cloud.callFunction` 出口）

```js
const { call, CallError } = require('../../api/client');
const data = await call('order.accept', { orderNo, expectedVersion }, { retry: false });
```

- `call(action, data, opts)` → `Promise<data>`；失败抛 `CallError`（`code/message/data/requestId`）。
- 自动注入 `clientRequestId`（16~32 位随机串）与（内存有 `viewContext` 时）`viewTicket`；`opts.readRetry` 默认 `true`（读动作 ≤2 次，300/900ms），写动作默认不重试。
- 超时 10s；校验 flat 包络 `{ok, code?, message?, data?, serverTime, requestId?}`；写 `store.serverTimeSkew`。
- 页面只 catch 后 toast `err.message`，不得自行拼错误码文案。

### 3.2 `api/modules/*.js`（action 字符串只在这里出现）

每个模块导出对象，方法名 = 动作名去掉模块前缀的 camelCase（`user.bootstrap` → `bootstrap`）：

| 文件 | 导出方法 |
| :-- | :-- |
| `api/modules/user.js` | `bootstrap()`、`acceptPrivacy(version)`、`deleteAccount(reason)` |
| `api/modules/customer.js` | `saveProfile(payload)`、`getProfile()` |
| `api/modules/partner.js` | `activate({invitationCode,displayName,avatarFileId})`、`saveProfile`、`saveServiceConfig`、`getPublic({partnerNo})`、`listBindings`、`unbindCustomer({bindingId,reason,note})`、`saveCustomerNote({bindingId,note})` |
| `api/modules/bind.js` | `create({partnerNo})`、`release({reason,note})`、`getCurrent()` |
| `api/modules/order.js` | `create`、`createBatch`、`get`、`listCustomer`、`listPartner`、`accept`、`reject`、`markPicked`、`unmarkPicked`、`markDelivered`、`unmarkDelivered`、`reportException`、`resolveException`、`cancel`、`confirmDelivery`、`correct`、`undo`、`deleteRecord`、`imageUrl` |
| `api/modules/message.js` | `send`、`list`、`markRead` |
| `api/modules/upload.js` | `prepare({purpose})`、`cancel({uploadTicketId})` |
| `api/modules/config.js` | `getPublic()` |
| `api/modules/ai.js` | `parseParcel(payload)`（仅识别失败兜底，不自动重试） |
| `api/modules/admin.js` | `createInvites`、`revokeInvite`、`listInvites`、`listCustomers`、`getCustomer`、`listPartners`、`setPartnerStatus`、`listOrders`、`getOrder`、`listAudit`、`updateConfig`、`stats`、`bootstrap`、`viewAsStart`、`viewAsEnd`、`createTestAccount`、`listTestAccounts`、`deleteTestAccount`、`purgeTestData`、`listRecognitionFailures`、`getRecognitionFailure`、`fixRecognitionFailure`、`ignoreRecognitionFailure` |

### 3.3 `api/upload.js`

- `prepareAndUpload({ purpose, filePath })` → `{ uploadTicketId, cloudPath, fileId }`；内部：`upload.prepare` → 压缩（头像按 `store.config.avatarMaxBytes`，截图长边 1440/≤500KB）→ `wx.cloud.uploadFile`（唯一上传出口）。失败抛 `CallError`，可重试至票据过期。
- `cancelTicket(uploadTicketId)` 调 `upload.cancel`。

### 3.4 `store/index.js`（内存快照，唯一全局状态）

```js
const store = require('../../store/index');
store.get('viewContext'); store.set('badges', {}); store.patch({ badges });
const off = store.subscribe((snapshot) => { this.setData({ vm: snapshot }); });
```

快照形状（`store.snapshot()`）：

```js
{
  roles: ['CUSTOMER'|'PARTNER'], activeRole: 'CUSTOMER'|'PARTNER'|null,
  isDeveloper: false,
  me: { displayName, avatarFileId? },
  customer: { profileComplete, customerNo?, displayName?, avatarFileId?, dormKey?, roomTag?, zone?, buildingNo?, room?, phoneTail? },
  partner: { status, profileComplete, partnerNo?, displayName?, avatarFileId?, acceptingOrders? },
  binding: null | { bindingId, partnerNo, partnerDisplayName, partnerAvatarFileId?, roomTag, status },
  config: {}, badges: { workbenchPending: 0, messages: 0 },
  viewContext: null | { viewTicket, viewMode, role, targetNo, targetDisplayName, targetAvatarFileId?, targetIsTest, expiresAt },
  serverTimeSkew: 0
}
```

- 方法：`snapshot()`、`get(key)`、`set(key,value)`、`patch(obj)`、`subscribe(fn)`（返回取消函数）、`hydrateFromBootstrap(data)`、`setViewContext(ctx)`、`clearViewContext()`、`getViewContext()`、`isDeveloper()`。
- `viewContext` **只存内存**，绝不写本地存储、绝不做 URL 参数。

### 3.5 页面与组件约定

- 页面 `.js` 只做：取参 → 调 `api/` → `setData` → 事件转发。禁止：`wx.cloud.*`、七状态字符串字面量、编号/roomTag 生成或 `random`、拼状态文案、直接读集合名/action 字符串。
- 每个业务页（主包 5 tab + `pkg-customer` 5 页 + `pkg-partner` 7 页）`index.wxml` 根节点第一个子节点必须是 `<switch-bar />`；`pkg-admin` 页面不引用 `switch-bar`/`test-badge`。
- 页面 `.json` 只写 `navigationBarTitleText` 等；组件已在 `app.json` 全局注册，页面无需再 `usingComponents`。
- 相对路径深度：`pages/xxx/index.js` 与 `pkg-*/pages/xxx/index.js` 到仓库根都是 `../../../`（`pkg-*/pages/xxx/parts/*` 为 `../../../../../`）；`pages/launch/index.js`、`components/xxx/index.js` 为 `../../`。
- 组件 props/events（冻结）：

| 组件 | props | events |
| :-- | :-- | :-- |
| `switch-bar` | 无（读 store；含 `test-badge`，`TEST_WRITE` 渲染蓝条 + 角标，`READONLY` 黄条，无会话不渲染） | `exit` |
| `test-badge` | 无（读 store，仅 `viewMode=TEST_WRITE` 渲染；`TEST` 字面量只允许在本组件） | — |
| `avatar-view` | `fileId?`、`name?`（默认头像首字）、`size?`（rpx，默认 64） | — |
| `id-text` | `kind`（`CUSTOMER`/`PARTNER`）、`no`（canonical） | `copy` |
| `room-tag-text` | `dormKey`、`tag` | — |
| `status-pill` | `status`（七状态之一） | — |
| `order-row` | `order`（服务端视图模型） | `tap` |
| `customer-row` | `customer` | `tap` |
| `failure-image` | `failureNo` | `loaded`、`error` |
| `image-picker` | `maxCount`（默认 1）、`purpose`（`TICKET`/`AVATAR`） | `change`（`detail.files`） |
| `code-editor` | `value`、`placeholder`、`maxlength` | `change`（`detail.value`） |
| `section-card` | `title` | — |
| `empty-state` | `text`、`actionText?` | `action` |
| `form-field` | `label`、`value`、`type`、`placeholder`、`required` | `change`（`detail.value`） |
| `role-switch` | `activeRole` | `change`（`detail.role`） |

- `app.wxss` 已提供全局工具类：`page-body`、`card`、`row`、`col`、`flex-1`、`between`、`center`、`title`、`section-title`、`subtitle`、`muted`、`small`、`strong`、`ellipsis`、`divider`、`btn`、`btn-primary`、`btn-ghost`、`btn-danger`、`btn-disabled`、`btn-block`、`tag`、`tag-test`、`safe-bottom`、`hidden`、`empty-text`、`form-row`、`form-label`、`form-input`。用到未定义的类必须写进本页 wxss（门禁 #9）。
- `custom-tab-bar`：按 store 渲染 3 格；`setData({ selected, role })`；切格 `wx.switchTab`；无会话按 `activeRole`，有会话按 `viewContext.role`。

### 3.6 `config/route.js` 的 snapshot 形状（供 launch/profile 使用）

`{ hasRole, isDeveloper, activeRole, customer:{profileComplete}, partner:{profileComplete,status}, viewContext }` → `decideLaunchRoute(snapshot)` 返回 `{url, reason}`。

## 4. 云函数冻结接口

### 4.1 入口、路由与中间件

- `index.js`：唯一 `require('wx-server-sdk')` 的文件。`exports.main = async (event, context) => { cloud.init({env}); const wx = cloud.getWXContext(); return invoke(event, { db: cloud.database(), cloud, env: process.env, openid: wx.OPENID, requestId: event && event.requestId, now: Date.now }); }`。
- `app.js`：`invoke(event, deps)` → 解包 `{action, data, clientRequestId, expectedVersion, viewTicket}` → `router` 取 handler（未登记/非 client 可见一律 `FORBIDDEN`）→ 中间件链 `auth → switch-session → validate → ratelimit → idempotency → audit` → handler → 统一包络。
- `router.js`：`createRouter()` 返回 `action → handler` 映射；显式列出 `./handlers/<domain>` 的十一个域（`user customer partner bind order message upload config admin ai health`），每个域模块导出 `{ actions: { 'user.bootstrap': fn, ... } }`。
- handler 签名：`async (ctx, payload) => data`（返回对象进 `data`；抛 `AppError` 走失败包络）。`ctx = { dao, now, env, cloud, openid, identity, requestId, config }`，`identity = { actorOpenid, effectiveOpenid, role, isTestAccount, viewMode, viewTicketId, developerNo }`。
- 中间件签名：`async (state) => state`；`state = { action, payload, ctx, meta }`；抛 `AppError` 即终止。
- 包络：`{ ok:true, data, serverTime, requestId }`；失败 `{ ok:false, code, message, data?, serverTime, requestId }`。`serverTime` 由 app.js 统一填。

### 4.2 `db/dao.js`（唯一出现 `db.collection` 的位置）

`createDao(db)` → `{ get, findOne, find({where,orderBy,skip,limit}), count, add, update, updateWhere, remove, removeWhere, transaction(fn), serverDate(), inc(value) }`；集合名一律从 `require('../shared/collections')` 的 `COLLECTIONS.*` 取。

### 4.3 共享注册表（`shared/**`，v3-data-model 产出；两边共同引用）

| 文件 | 内容 |
| :-- | :-- |
| `shared/collections.js` | `COLLECTIONS`：users、customers、partners、bindings、orders、order_events、order_messages、invitation_codes、admin_view_sessions、counters、config、admin_audit、upload_tickets、recognition_failures（14 个） |
| `shared/actions.js` | 全部 action 名 → `{ visibility:'client'|'internal', write:boolean }`；internal 仅 `admin.bootstrap`、`health.check`、`cleanup.*` |
| `shared/error-codes.js` | 13 码唯一集：`VALIDATION_FAILED` `FORBIDDEN` `NOT_FOUND` `CONFLICT` `INVALID_TRANSITION` `INVALID_STATE` `RATE_LIMITED` `INVITE_EXPIRED` `INVITE_USED` `VIEW_TICKET_EXPIRED` `PARTNER_CLOSED` `DEPENDENCY_FAILED` `INTERNAL_ERROR` |
| `shared/error-copy.js` | 13 码 → 中文人话；编号前缀三句提示 |
| `shared/enums.js` | 角色/订单状态/来源/取消原因/异常码/服务类型/绑定状态/审计动作等枚举与中文文案 |
| `shared/audit-actions.js` | 审计枚举：`INVITE_CREATE` `INVITE_REVOKE` `PARTNER_SUSPEND` `PARTNER_RESTORE` `CONFIG_UPDATE` `ORDER_ANOMALY_CANCEL` `BOOTSTRAP` `FAILURE_IMAGE_VIEW` `FAILURE_FIX` `FAILURE_IGNORE` `ACCOUNT_SWITCH_START` `ACCOUNT_SWITCH_END` `ACCOUNT_SWITCH_EXPIRED` `TEST_ACCOUNT_CREATE` `TEST_ACCOUNT_DELETE` `TEST_DATA_PURGE` |
| `shared/order-state.js` | 七状态转移表 + 动作合法起始状态 + 七状态中文文案 |
| `shared/role.js` | 角色判定纯函数 |
| `shared/zones.js` / `shared/stations.js` | 五苑标识与站点 P1~P8（名称/别名归一） |
| `shared/validate.js` | 宿舍身份/尾号/文本上限/编号形态/邀请码形态校验 |
| `shared/format.js` | 时间/编号展示/文本截断 |
| `shared/order-view.js` | 订单视图模型（四档动线排序、状态桶、锚+键） |
| `utils/ids.js` | 编号归一/parse/display（**无生成、无 random**） |
| `utils/room-tag.js` | `toTag/tagRank/formatDormTag/isValidTag/compareByDormTag`（大写 A…Z/AA…，禁字符串排序） |

### 4.4 客户端与云端的编号/roomTag 分工

- 编号生成只在云端 `lib/id-generator.js`（唯一索引兜底 + 冲突重试）；roomTag 分配只在云端 `lib/tag-allocator.js`（事务 + `counters` 自增，大写）。
- 客户端只做归一化/展示/校验（`utils/ids.js`、`utils/room-tag.js`）；页面不得自行拼编号或 roomTag。

## 5. 编码与协作纪律

1. 编码：全部 UTF-8 **无 BOM**、**纯 LF**、文件结尾单换行；`*.ps1` 必须带 UTF-8 BOM（两向门禁见 ENGINEERING §8.2 #7/#8）。
2. 行长：源码单文件 ≤500 行、测试文件 ≤1000 行；超过就拆文件（handler 单动作一文件）。
3. 文案：失败提示必须说真话并给下一步；不出现任何金钱交易语义（门禁 #22 扫描源码与页面文案）；不写未完成占位标记、不写 `TODO`。
4. 不手写共享副本；`cloudfunctions/*/shared/**` 只由 `tools/sync-cloud-shared.js` 生成。
5. **任何 agent 不得执行 `git commit` / `git tag`**：提交与回读由 Lead 统一做；工作树就是共享交付物。
6. 完成自检（各自的域）：`node --check <file>.js`（逐文件）、JSON 可 `node -e "JSON.parse(require('fs').readFileSync('x.json','utf8'))"`；页面四件套齐全；不跑全量门禁（工具链由 S2 建，联调由 Lead 统一跑）。
7. 回报格式（发给 Lead）：`文件清单 + 各自行数 + 已跑命令与真实输出 + 未决问题/风险 + 是否有跨域改动需求`。只报真实输出，不报"应该没问题"。

## 6. 本批完成判据（Lead 统一验收）

- `node tools/check.js` 汇总行存在且 0 失败；`node tools/check-docs.js --batch 0` 0 失败；`tools/selftest*.js` 全绿（EXPECTED_ASSERTIONS 闸通过）。
- 30 个页面四件套齐全且与 `app.json` 双向一致；14 集合注册表、13 错误码、action 注册表双向一致。
- 零金额扫描 0 命中（真实输出）；v0.9 门禁 #28~#31 判据已登记（对象批次补"必须真红"证据）。
- 云函数可在 fake DB 下跑通 `health.check` 与 `admin.bootstrap`；真实云环境联调等用户完成 D1/D2 前置后再做。

## 7. 与文档的对应关系

| 代码域 | 权威文档 |
| :-- | :-- |
| 角色/权限/绑定方向/切换会话 | `docs/V4_CONTRACT.md` §1、§4.2、§10、§12、§15 |
| 字段/索引/API 契约/编号/roomTag | `docs/V4_DATA_MODEL.md` §2、§4、§5、§7、§9 |
| 云函数分层/action/错误码/门禁/批次 | `docs/V4_ENGINEERING.md` §4、§7、§8、§11 |
| 页面/组件/导航/交互 | `docs/V4_UX_CUSTOMER.md`、`V4_UX_PARTNER.md`、`V4_UX_DEVELOPER.md` |
| 隐私与发布 | `docs/privacy/*`、`docs/QA_CHECKLIST.md` |
