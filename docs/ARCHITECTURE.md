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
const data = await call('order.confirmDelivery', { orderNo }, { expectedVersion: order.version });
```

- `call(action, data, opts)` → `Promise<data>`；失败抛 `CallError`（`code/message/data/requestId`）。
- 自动注入 `clientRequestId`（16~32 位随机串）与（内存有 `viewContext` 时）`viewTicket`；`opts.readRetry` 默认 `true`（读动作 ≤2 次，300/900ms），写动作默认不重试。
- `opts.clientRequestId`：页面可显式指定幂等键（**重试复用同一 id，内容变更后重新生成**，UX_CUSTOMER §4.8）；形态为 16~32 位 `[A-Za-z0-9_-]`，非法时静默回退自生成（不把格式错误抛给页面；服务端仍按 `shared/validate.validateClientRequestId` 校验）。
- `opts.expectedVersion`：写动作传当前 DTO 的 `version` 做乐观锁（**正整数才进包络顶层 `expectedVersion`，非法静默丢弃**）；服务端不符回 `CONFLICT`，页面 toast 人话并刷新详情后重试（UX_CUSTOMER §10 #4）。
- 超时 10s；校验 flat 包络 `{ok, code?, message?, data?, serverTime, requestId?}`；写 `store.serverTimeSkew` **带 1s 抖动阈值**（`|Δ新|≤1000ms` 既不写也不 notify，分钟级倒计时不受影响；见 §3.4 订阅扇出说明）。
- 页面只 catch 后 toast `err.message`，不得自行拼错误码文案。

### 3.2 `api/modules/*.js`（action 字符串只在这里出现）

每个模块导出对象，方法名 = 动作名去掉模块前缀的 camelCase（`user.bootstrap` → `bootstrap`）：

| 文件 | 导出方法 |
| :-- | :-- |
| `api/modules/user.js` | `bootstrap()`、`acceptPrivacy(version)`、`deleteAccount({confirmText:'注销', reason?})` |
| `api/modules/customer.js` | `saveProfile(payload)`、`getProfile()` |
| `api/modules/partner.js` | `activate({invitationCode,displayName,avatarTicket})`、`saveProfile`、`saveServiceConfig`、`getPublic({partnerNo})`、`listBindings`、`unbindCustomer({bindingId,reason,note})`、`saveCustomerNote({bindingId,note})` |
| `api/modules/bind.js` | `create({partnerNo})`、`release({reason,note})`、`getCurrent()` |
| `api/modules/order.js` | `create(payload, opts?)`（**v1.0 单入口**：`{parcels[], images[], tickets?[], serviceCode, appoint, note, delivery?, guest?/bindingId?, manualEntry?, clientRequestId}`；满足合并窗口时服务端追加到同单）、`get`、`listCustomer`、`listPartner`、`accept`、`reject`、`markPicked`、`unmarkPicked`、`markDelivered`、`unmarkDelivered`、`reportException`、`resolveException`、`cancel`、`confirmDelivery`、`correct`（v1.0 带 `itemIndex` 逐包裹）、`undo`、`deleteRecord`、`imageUrl`（v1.0 `{orderNo,index}` 取 `images[index]`；写动作 `opts.expectedVersion` 透传乐观锁，见 §3.1）。**`createBatch` 已随 v1.0 移除**（一图多码并入 `create`） |
| `api/modules/message.js` | `send`、`list`、`markRead` |
| `api/modules/upload.js` | `prepare({purpose})`、`cancel({uploadTicketId})` |
| `api/modules/config.js` | `getPublic(force?)`（5 分钟缓存）、`prime(configPublic)`（**启动预热**：bootstrap 已回的公开子集灌入同一缓存，本次会话首次 `getPublic` 零云调用，TTL 语义不变）、`getCachedPublic()`、`clearCache()` |
| `api/modules/ai.js` | `parseParcel(payload)`（仅识别失败兜底，不自动重试） |
| `api/modules/admin.js` | `createInvites`、`revokeInvite`、`listInvites`、`listCustomers`、`getCustomer`、`listPartners`、`setPartnerStatus`、`listOrders`、`getOrder`、`listAudit`、`updateConfig`、`stats`、`bootstrap`、`viewAsStart`、`viewAsEnd`、`createTestAccount`、`listTestAccounts`、`deleteTestAccount`、`purgeTestData`、`listRecognitionFailures`、`getRecognitionFailure`、`fixRecognitionFailure`、`ignoreRecognitionFailure` |

### 3.3 `api/upload.js`

- `prepareAndUpload({ purpose, filePath })` → `{ uploadTicketId, cloudPath, fileId }`；内部：**本地校验/压缩（头像按 `store.config.avatarMaxBytes`，截图长边 1440/≤500KB，走 `utils/avatar` 纯件）→ `upload.prepare({purpose,size,contentType})`（服务端 size/类型闸必须收到真实入参：AVATAR 传压缩后 size + 派生 contentType；TICKET 只传 size、不传 contentType 以兼容聊天 gif）→ `wx.cloud.uploadFile`（唯一上传出口）**。失败抛 `CallError`，可重试至票据过期。
- **v1.0 截图（D23/D24）**：下单支持 0~5 张截图（每张一个 ticket），`images[i]` ↔ `tickets[i]` 同序一一对应；截图上传失败/超限仍拒绝单张（不放松 ≤500KB 服务端闸），用户可换图/继续用手填；OCR 帧按 `utils/ocr/frame.js` 长边 ≤1440 降采样后再建画布（P0-10 归 C 批）。0 张=无截图手填（`manualEntry=true`），不产生识别数据。
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
  binding: null | { bindingId, partnerNo, partnerDisplayName, partnerAvatarFileId?, roomTag, status, partnerPublic? },
  config: {}, badges: { workbenchPending: 0, messages: 0 },
  viewContext: null | { viewTicket, viewMode, role, targetNo, targetDisplayName, targetAvatarFileId?, targetIsTest, expiresAt },
  serverTimeSkew: 0
}
```

- 方法：`snapshot()`、`get(key)`、`set(key,value)`、`patch(obj)`、`subscribe(fn)`（返回取消函数）、`hydrateFromBootstrap(data)`、`setViewContext(ctx)`、`clearViewContext()`、`getViewContext()`、`isDeveloper()`。
- `viewContext` **只存内存**，绝不写本地存储、绝不做 URL 参数。
- `hydrateFromBootstrap` 的 `viewContext` 分支**保留本地 `viewTicket`**、其余字段以服务端为准（服务端 `user.bootstrap` 永不回票据）：进入/退出切换会话后由 `utils/session.js` 统一重新拉 `user.bootstrap` 水合目标身份（顾客资料/兼职激活态/绑定），水合不得让票据丢失。
- **启动期绑定水合（P0-3 性能口径）**：`app.js` 启动关键路径只 `await user.bootstrap`；`bind.getCurrent` 在启动后台推进（不阻塞首帧），成功后把 `{binding, partnerPublic}` 一并写入 `store.binding`（`partnerPublic` 为可选字段）。首页首次 `onShow` 在 30 秒窗口内复用同一 `bind.getCurrent` 结果（不再重复发请求）；**切换会话期间禁止复用**（`viewContext` 存在即跳过）；离开首页再回来/下拉刷新仍自行重拉，不做永久缓存。

### 3.5 页面与组件约定

- 页面 `.js` 只做：取参 → 调 `api/` → `setData` → 事件转发。禁止：`wx.cloud.*`、七状态字符串字面量、编号/roomTag 生成或 `random`、拼状态文案、直接读集合名/action 字符串。
- 每个业务页（主包 5 tab + `pkg-customer` 6 页 + `pkg-partner` 7 页）`index.wxml` 根节点第一个子节点必须是 `<switch-bar />`；`pkg-admin` 页面不引用 `switch-bar`/`test-badge`。**v1.0 新增** `pkg-customer/pages/pickup-list/index`（D26 顾客取件清单：独立入口，只读展示本站订单 `parcels[]` 的站点+取件码，本机勾选只经 `utils/storage.pickupChecks`，不回写服务端）。
- 页面 `.json` 只写 `navigationBarTitleText` 等；组件已在 `app.json` 全局注册，页面无需再 `usingComponents`。
- **页面纯件（批 6~8 扩展）**：可测的视图模型/表单校验/文案放同页 `parts/*.js`（纯函数、零 `wx`），页面 `index.js` 只做取参→调 `api/`→`setData`→事件转发；`pkg-admin` 11 页均有 `parts/view-model.js` + `common/copy.js`，`pkg-customer/pkg-partner` 部分页有 `parts/*`。例外组件 `components/maintenance-mask`（维护模式全屏公告）与纯件 `utils/maintenance.js` 采用**页面级 `usingComponents` 注册**（不改 `app.json`；仅 `pages/customer/home`、`pages/partner/workbench` 引用）。
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
| `maintenance-mask`（页面级注册，非全局） | `view`（`{enabled,title,text}`，来自 `utils/maintenance.buildMaintenanceView`） | `ack`（关闭遮罩，仅本页内存态） |

- `app.wxss` 已提供全局工具类：`page-body`、`card`、`row`、`col`、`flex-1`、`between`、`center`、`title`、`section-title`、`subtitle`、`muted`、`small`、`strong`、`ellipsis`、`divider`、`btn`、`btn-primary`、`btn-ghost`、`btn-danger`、`btn-disabled`、`btn-block`、`tag`、`tag-test`、`safe-bottom`、`hidden`、`empty-text`、`form-row`、`form-label`、`form-input`。用到未定义的类必须写进本页 wxss（门禁 #9）。
- `custom-tab-bar`：按 store 渲染 3 格；`setData({ selected, role })`；切格 `wx.switchTab`；无会话按 `activeRole`，有会话按 `viewContext.role`。

### 3.6 `config/route.js` 的 snapshot 形状（供 launch/profile 使用）

`{ hasRole, isDeveloper, activeRole, customer:{profileComplete}, partner:{profileComplete,status}, viewContext }` → `decideLaunchRoute(snapshot)` 返回 `{url, reason}`。

- `reason` 枚举：`VIEW_CONTEXT`（切换会话优先）→ `DEVELOPER` → `NO_ROLE` → `CHOOSE_ROLE`（双角色且无 `activeRole`，回 `role` 由用户选择）→ `CUSTOMER_PROFILE` / `CUSTOMER_READY` / `PARTNER_PROFILE` / `PARTNER_INACTIVE` / `PARTNER_ACTIVE`（单业务角色直进该角色）。
- `config/route.js` 导出（纯函数、零 `wx`/零 storage）：`resolveLaunchRole`、`suggestedRoleOf`（`role` 页「上次使用」建议）、`roleOfDecision`（进入角色后写 `lastRole`，只经 `utils/storage` 白名单键）、`decideLaunchRoute`、`isRolePageAllowed`；**`roles`/`lastRole` 不改变 snapshot 形状、不进 URL**。

## 4. 云函数冻结接口

### 4.1 入口、路由与中间件

- `index.js`：唯一 `require('wx-server-sdk')` 的文件。`exports.main = async (event, context) => { cloud.init({env}); const wx = cloud.getWXContext(); return invoke(event, { db: cloud.database(), cloud, env: process.env, openid: wx.OPENID, requestId: event && event.requestId, now: Date.now }); }`。
- `app.js`：`invoke(event, deps)` → 解包 `{action, data, clientRequestId, expectedVersion, viewTicket}` → `router.getHandler(action)` **按域懒加载**取 handler（未登记/非 client 可见一律 `FORBIDDEN`）→ 中间件链 `auth → switch-session → validate → ratelimit → idempotency → audit` → handler → 统一包络。
- `router.js`：静态域清单 `DOMAIN_NAMES`（十一个域：`user customer partner bind order message upload config admin ai health`）+ `getHandler(action)` 按 action 前缀（`order.accept` → `order`）**只 require 首用域**，模块导出形状仍为 `{ actions: { 'user.bootstrap': fn, ... } }`；域首次加载时校验「导出集 = shared/actions 集」并逐个断言是函数（该域 fail-fast 保留）。全量 `createRouter()/getRouter()` 仅工具/自检使用，不在请求热路径。
  - **性能口径（P0-5）**：首请求不再一次性加载 11 域；未用域的注册错配由 `tools/check.js` #13 构建期静态判据兜住（补偿判据：11 域覆盖全部 client/放行 internal 动作前缀 + 每域导出集双向相等 + 热路径必须走 `getHandler`）。**性能落差登记**：旧实现「缺注册/多注册」在首请求即抛错，现改为「静态构建期全量校验 + 首用域运行期校验」，未用域的手写错误要等首次调用该动作（或跑 check/selftest 全量）才暴露。
- handler 签名：`async (ctx, payload) => data`（返回对象进 `data`；抛 `AppError` 走失败包络）。`ctx = { dao, ids, now, env, cloud, openid, identity, requestId, clientRequestId, expectedVersion, config }`；`identity = { actorOpenid, effectiveOpenid, role, isTestAccount, viewMode, viewTicketId, developerNo }`。
  - **双角色口径（Lead 冻结）**：服务端权限判定只看"`users.roles` 是否包含该动作所需业务角色"（customer.*/bind.create 需 CUSTOMER；partner.*/order.listPartner/兼职统计需 PARTNER），**不依赖客户端 activeRole**；同一 openid 同时具备 CUSTOMER+PARTNER 时两类动作都允许，`activeRole` 仅是客户端展示/导航状态（不落库、不作鉴权）。`identity.role` 按动作域解析，解析不出所需角色 → `FORBIDDEN`。
- `ctx.ids`（由 `lib/id-generator` 绑定 dao 后注入，handler 不自建随机/编号）：`customerNo()`、`partnerNo()`、`orderNo(nowMs)`、`failureNo()`、`inviteCode()`、`randomId(len)`、`uploadTicket()`；均为同步返回 string（内部冲突重试 ≤5 次，失败抛 `DEPENDENCY_FAILED`）。
- `ctx.dao` 返回形状：`get/findOne` → `doc | null`；`find` → `[]`；`count` → number；`add` → `{ _id }`；`update/updateWhere/remove/removeWhere` → `{ updated }` 或 `{ removed }`；`transaction(fn)` → fn 返回值，fn 收到同接口的 `trxDao`。**写入语义（2026-10-22 云端事故修正）**：`update/updateWhere` 的每个字段值都是**整值替换**——普通对象值由 dao 包成 `command.set`，不交给 `wx-server-sdk` 拍平成点路径（拍平后父字段为 `null` 会 `-502001`，且"部分合并"会残留旧子字段）；标量/`Date`/数组/既有指令（`inc` 等）原样透传。handler 不得自己拼点路径键，也不得假设嵌套对象会被局部合并。
- 失败构造：`const { AppError, errors } = require('./lib/errors')`；`new AppError(code, message, data?)`，code 必须 ∈ 13 码；常用 `errors.validation(field,message)`（自动带 `data.field`）、`errors.forbidden()`、`errors.notFound()`、`errors.invalidState()`、`errors.invalidTransition()`、`errors.conflict()`、`errors.rateLimited()`、`errors.partnerClosed()`、`errors.inviteExpired()`、`errors.inviteUsed()`、`errors.viewTicketExpired()`、`errors.dependencyFailed()`、`errors.internalError()`。
- 幂等键：`ctx.clientRequestId` 即请求包络的 `clientRequestId`；订单创建 `requestKey = {customerId|partnerId}:{clientRequestId}`、订单写动作 `order_events.requestKey = {orderId}:{action}:{clientRequestId}`（均唯一索引兜底）。
- 中间件签名：`async (state) => state`；`state = { action, payload, ctx, meta }`；抛 `AppError` 即终止。
- 包络：`{ ok:true, data, serverTime, requestId }`；失败 `{ ok:false, code, message, data?, serverTime, requestId }`。`serverTime` 由 app.js 统一填。

### 4.2 `db/dao.js`（唯一出现 `db.collection` 的位置）

`createDao(db)` → `{ get, findOne, find({where,orderBy,skip,limit}), count, add, update, updateWhere, remove, removeWhere, transaction(fn), serverDate(), inc(value), command(name, value) }`；集合名一律从 `require('../shared/collections')` 的 `COLLECTIONS.*` 取。返回值形状见 §4.1。

> 查询指令工厂（批 10 / M-10，Lead 已授权）：`ctx.dao.command(name, value)` 返回 SDK 查询指令（`gte/lt/gt/neq/in/exists`），供服务端范围/前缀查询使用（仍由唯一 `db/dao.js` 构造指令对象，业务层不出现 `db`/`db.command`）。`api/db/dao.js` 与 `cleanup/db/dao.js` 两处补丁文本必须逐字一致；已知调用点 = `cloudfunctions/api/handlers/admin/_paging.js`（`fetchOrderedPage`/`fetchPrefixPage`）。

> 写入语义补充（2026-10-22，真实云环境首跑事故）：`update/updateWhere` 的字段值语义 = **整值替换**（dao 内 `normalizeUpdateData` 把普通对象包成 `command.set`；对象字段不会再被 SDK 拍平成点路径，也不会与库内旧子字段合并）。真实故障：`users.privacyConsent` 初值为 `null` 时，写 `{version, at}` 被拍成 `privacyConsent.at` → MongoDB `-502001 Cannot create field 'at' in element {privacyConsent: null}`，导致「同意隐私政策」100% 失败；同理适用于 `orders.exception`（恢复后被置 `null` 再上报）等所有"嵌套对象字段可能从 null/标量起步"的写点。fake DB 已同步复刻该语义（见 ENGINEERING §7.3）。

> 部署单元例外（Lead 已授权）：`cloudfunctions/cleanup` 不能 require `cloudfunctions/api/db/dao.js`，因此 `cloudfunctions/cleanup/db/dao.js` 是**第二处**允许出现 `db.collection` 的位置，接口与 `api/db/dao.js` 逐项一致；同部署单元内 `cleanup/db/collections.js`（集合名校验）与 `cleanup/run.js`（可注入执行器：loadSweeps/runAll/汇总审计）为批 8 收口新增，仍属同一例外范围；两处之外禁止出现 `db.collection`。
> 编号生成补充：`ctx.ids.orderNo(nowMs)` 因走 `counters` 事务必须返回 Promise；`customerNo/partnerNo/failureNo` 为同步字符串，插入冲突重试由 `lib/id-generator.js` 的 `insertUnique(dao, collection, {field, generate, build})` 包裹（≤5 次，仍失败 `DEPENDENCY_FAILED`），handler 不得自建重试循环。
> Shared 同步扩围（Lead 已授权，v3-engineering 实现）：`tools/sync-cloud-shared.js` 除 `shared/**` 与 `utils/ids.js`、`utils/room-tag.js` 外，再把 `config/defaults.js` 同步为 `cloudfunctions/*/shared/defaults.js`（云端种子/配置校验的唯一默认值来源；hash 门禁 #17 覆盖该副本）。
> AI 兜底来源标识：`shared/enums.js` 的 `RECOGNITION_SOURCE` 只含 `RULE/MANUAL`（客户端零第三方 token）；`DEEPSEEK` 标识由 `cloudfunctions/api/lib/ai/**` 自持，订单/识别 DTO 必须由服务端下发 `recognitionSourceLabel` 中文文案，客户端不识别来源 token。`config.aiFallback.model` 默认留空串，云侧 `lib/ai` 在 model 为空时使用自身默认模型名（该差异登记 TECH_DEBT）。

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
