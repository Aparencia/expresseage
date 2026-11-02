# V4_ARCHITECTURE · 代码分层与并行开发冻结接口（批 1 起）

> 冻结时间：2026-10-21（初版 v0.9 口径；D23~D42 增量已回写 §3.2/§4.3，S0~S10 写作用域与分层铁律未变）。**设计口径唯一来源 = `docs/contract/V4_CONTRACT.md` 当前版本（增量以 CONTRACT §13 为准）**，工程规则来源 = `docs/engineering/V4_ENGINEERING.md`。本文只登记**代码级接口、写作用域与自检方法**；与 CONTRACT 冲突时以 CONTRACT 为准，并先回报 Lead，不得自行改口径。

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
cloudfunctions/*/shared/（由 shared/** 与 utils/ids.js、utils/room-tag.js、config/defaults.js 逐字节同步的副本）
```

铁律：客户端不出现集合名与 action 字面量（只允许在 `api/` 与 `shared/`）；云函数不出现 `db.collection`（只允许 `db/dao.js`）；身份只来自服务端（真实 `OPENID` 或切换会话票据解析结果）。

## 2. 本轮并行写作用域（单写者；越界 = 冲突，冲突先报 Lead）

| 工作流 | Owner | 写作用域（只许改这些） |
| :-- | :-- | :-- |
| S0 骨架与集成 | lead | `app.json` `app.js` `app.wxss` `project.config.json` `sitemap.json` `.gitignore` `.tool-versions` `.env.example` `config/env.js` `config/route.js` `api/**` `store/**` `pages/launch/**` `pages/profile/**` `utils/share/**` `docs/engineering/V4_ARCHITECTURE.md` |
| S1 口径纯件 | v3-data-model | `shared/**` `utils/ids.js` `utils/room-tag.js` `utils/order-scope.js`（C 批 TD-068 下沉的服务范围预检单源） `config/defaults.js` |
| S1b 云端身份域 | v3-data-model | `cloudfunctions/api/handlers/{user,customer,partner,bind,upload,config}/**` |
| S2 工具链与门禁 | v3-engineering | `tools/**` `check.ps1` `gate.ps1` `doctor.ps1` |
| S3 顾客端 | v3-lifecycle-flow | `pages/role/**` `pages/customer/**` `pkg-customer/**` `utils/recognize/**` `utils/ocr/**` |
| S4 兼职端 | v3-pickup-ux | `pages/partner/**` `pkg-partner/**` `utils/customer-view.js` `utils/order-edit.js` |
| S5 开发者后台页 | v4-developer-console | `pkg-admin/**` |
| S6 仓库文档与隐私件 | v4-privacy-qa | `AGENTS.md` `STATE.md` `CHANGELOG.md` `docs/delivery/V4_RUNBOOK.md` `docs/engineering/V4_FIXTURES.md` `docs/governance/V4_TECH_DEBT.md` `utils/storage.js` `utils/privacy-policy.js` `utils/avatar.js` |
| S7 云核心 | cloud-core（新） | `cloudfunctions/api/index.js` `app.js` `router.js` `bootstrap.js` `middleware/**` `db/**` `lib/{respond,errors,time,id-generator,tag-allocator}.js` `handlers/health/**` `package.json` `cloudfunctions/cleanup/index.js` `cloudfunctions/cleanup/package.json` |
| S8 云订单与兜底 | cloud-orders（新） | `cloudfunctions/api/handlers/{order,message,ai}/**` `cloudfunctions/api/lib/ai/**` `cloudfunctions/cleanup/sweeps/**` |
| S9 云后台 | cloud-admin（新） | `cloudfunctions/api/handlers/admin/**` `cloudfunctions/api/handlers/admin/dto/**`（如需要） |
| S10 组件与资产 | ui-components（新） | `components/**` `custom-tab-bar/**` `assets/**` |

- 云函数 `shared/` 副本**任何人不得手写**：由 `node tools/sync-cloud-shared.js` 生成（S2 提供脚本，S1 完成后 Lead 先跑一次）。
- **批 16 组件删减（S10 域说明）**：`components/customer-row/`、`components/form-field/`、`components/role-switch/`、`components/section-card/` 四个全局注册组件在全仓 WXML 零使用，批 16 删除目录并从 `app.json` 全局 `usingComponents` 移除（`app.json` 该次改动由 Lead 授权 S2 执行）。S10 写作用域（`components/**`、`custom-tab-bar/**`、`assets/**`）不变；后续新增全局组件仍须登记本节 §3.5 组件表 + ENGINEERING §5.7，并同时进 `app.json` 注册与门禁 #36 扫描范围。
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
| `api/modules/user.js` | `bootstrap()`、`avatarUrl()`（**D42**：本人头像 5 分钟临时 URL；无头像返回空）、`acceptPrivacy(version)`、`deleteAccount({confirmText:'注销', reason?})` |
| `api/modules/customer.js` | `saveProfile(payload)`、`getProfile()` |
| `api/modules/partner.js` | `activate({invitationCode,displayName,avatarTicket})`、`saveProfile`、`saveServiceConfig`、`getPublic({partnerNo})`、`listBindings`、`getCustomer({bindingId})`（批 7 只读：档案 + 解绑资格，参数一律 `bindingId`）、`stats({range?'today'|'week'|'month'})`（批 7 只读：单量统计，服务端聚合、排除测试数据）、`unbindCustomer({bindingId,reason,note})`、`saveCustomerNote({bindingId,note})` |
| `api/modules/bind.js` | `create({partnerNo})`、`release({reason,note})`、`getCurrent()` |
| `api/modules/order.js` | `create(payload, opts?)`（**v1.0 单入口**：`{parcels[], images[], tickets?[], serviceCode, appoint, note, delivery?, guest?/bindingId?, manualEntry?, clientRequestId}`；满足合并窗口时服务端追加到同单）、`get`、`listCustomer`、`listPartner`、`accept`、`reject`、`markPicked`、`unmarkPicked`、`markDelivered`、`unmarkDelivered`、`reportException`、`resolveException`、`cancel`、`confirmDelivery`、`correct`（v1.0 带 `itemIndex` 逐包裹）、`undo`、`deleteRecord`、`imageUrl`（v1.0 `{orderNo,index}` 取 `images[index]`；写动作 `opts.expectedVersion` 透传乐观锁，见 §3.1）。**`createBatch` 已随 v1.0 移除**（一图多码并入 `create`） |
| `api/modules/message.js` | `send`、`list`、`markRead` |
| `api/modules/upload.js` | `prepare({purpose})`、`cancel({uploadTicketId})` |
| `api/modules/config.js` | `getPublic(force?)`（5 分钟缓存）、`prime(configPublic)`（**启动预热**：bootstrap 已回的公开子集灌入同一缓存，本次会话首次 `getPublic` 零云调用，TTL 语义不变）、`getCachedPublic()`、`clearCache()` |
| `api/modules/ai.js` | `parseParcel(payload)`（仅识别失败兜底，不自动重试） |
| `api/modules/admin.js` | `createInvites`、`revokeInvite`、`listInvites`、`listCustomers`、`getCustomer`、`listPartners`、`setPartnerStatus`、`listOrders`、`getOrder`、`listAudit`、`updateConfig`、`stats`、`viewAsStart`、`viewAsEnd`、`createTestAccount`、`listTestAccounts`、`deleteTestAccount`、`purgeTestData`、`listRecognitionFailures`、`getRecognitionFailure`、`fixRecognitionFailure`、`ignoreRecognitionFailure` |

- **内部动作无客户端模块方法**：`admin.bootstrap`、`health.check`、`cleanup.*` 在 `shared/actions.js` 标 `visibility='internal'`，router 不对客户端开放，因此不出现在上表 `api/modules/*.js` 导出中；另 `bind.claimGuestOrder` 为 P1 预留（服务端 handler 已登记，`api/modules/bind.js` 不导出、页面无入口）。`api/modules` 的调用必须 ⊆ 注册表 `client` 集（门禁 `tools/check.js` #13 校验）。

### 3.3 `api/upload.js`

- `prepareAndUpload({ purpose, filePath })` → `{ uploadTicketId, cloudPath, fileId }`；内部：**本地校验/压缩（头像按 `store.config.avatarMaxBytes`，截图长边 1440/≤500KB，走 `utils/avatar` 纯件）→ `upload.prepare({purpose,size,contentType})`（服务端 size/类型闸必须收到真实入参：AVATAR 传压缩后 size + 派生 contentType；TICKET 只传 size、不传 contentType 以兼容聊天 gif）→ `wx.cloud.uploadFile`（唯一上传出口）**。失败抛 `CallError`，可重试至票据过期。
- **v1.0 截图（D23/D24）**：下单支持 0~10 张截图（每张一个 ticket，D40），`images[i]` ↔ `tickets[i]` 同序一一对应；截图上传失败/超限仍拒绝单张（不放松 ≤500KB 服务端闸），用户可换图/继续用手填；OCR 帧按 `utils/ocr/frame.js` 长边 ≤1440 降采样后再建画布（P0-10 归 C 批）。0 张=无截图手填（`manualEntry=true`），不产生识别数据。
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
  me: { displayName, avatarFileId?, avatarUrl? },
  customer: { profileComplete, customerNo?, displayName?, avatarFileId?, avatarUrl?, dormKey?, roomTag?, zone?, buildingNo?, room?, phoneTail?, gender?, genderManual? },
  partner: { status, profileComplete, partnerNo?, displayName?, avatarFileId?, avatarUrl?, acceptingOrders? },
  binding: null | { bindingId, partnerNo, partnerDisplayName, partnerAvatarFileId?, partnerAvatarUrl?, roomTag, status, partnerPublic? },
  config: {}, badges: { workbenchPending: 0, messages: 0, ordersOngoing: 0 },
  viewContext: null | { viewTicket, viewMode, role, targetNo, targetDisplayName, targetAvatarFileId?, targetIsTest, expiresAt },
  serverTimeSkew: 0
}
```

- `badges` = 客户端派生角标（服务端 bootstrap 可下发 `workbenchPending`/`messages`，客户端按页面 `onShow` 刷新；**无轮询**）：
  - `workbenchPending`：兼职端工作台 tab 数量角标 = 待接单数量（不清零）；
  - `messages`：「我的」格红点 = 未读留言 + 未读状态事件（D29），进消息中心/对应订单详情后归零；
  - `ordersOngoing`：顾客端「订单」tab 数量角标 = `order.listCustomer` 的 `counts.ongoing`（P1-5；**数量角标不清零**，与红点语义区分；完成/取消后由页面 `onShow` 刷新，不承诺实时）。
  - 页面更新方式：`store.patch({ badges: Object.assign({}, store.get('badges'), { <key>: <n> }) })`（保留其他键，不互相覆盖）。

- 方法：`snapshot()`、`get(key)`、`set(key,value)`、`patch(obj)`、`subscribe(fn)`（返回取消函数）、`hydrateFromBootstrap(data)`、`setViewContext(ctx)`、`clearViewContext()`、`getViewContext()`、`isDeveloper()`。
- `viewContext` **只存内存**，绝不写本地存储、绝不做 URL 参数。
- `hydrateFromBootstrap` 的 `viewContext` 分支**保留本地 `viewTicket`**、其余字段以服务端为准（服务端 `user.bootstrap` 永不回票据）：进入/退出切换会话后由 `utils/session.js` 统一重新拉 `user.bootstrap` 水合目标身份（顾客资料/兼职激活态/绑定），水合不得让票据丢失。
- **启动期绑定水合（P0-3 性能口径）**：`app.js` 启动关键路径只 `await user.bootstrap`；`bind.getCurrent` 在启动后台推进（不阻塞首帧），成功后把 `{binding, partnerPublic}` 一并写入 `store.binding`（`partnerPublic` 为可选字段）。首页首次 `onShow` 在 30 秒窗口内复用同一 `bind.getCurrent` 结果（不再重复发请求）；**切换会话期间禁止复用**（`viewContext` 存在即跳过）；离开首页再回来/下拉刷新仍自行重拉，不做永久缓存。
- **首页对方卡兜底（v1.1）**：home 视图用纯件 `partnerCardOf(binding, partnerPublic)`——`partnerPublic` 优先；未到达时允许用 `store.binding` 的启动期字段 `partnerNo/partnerDisplayName/partnerAvatarFileId` 作合法展示回退（首帧不空卡、不错误显示默认「代」）；`bind.getCurrent` 到达后覆盖；**不得**用顾客本人资料冒充对方。
- **tabBar 选中格 per-page 同步（v1.1；D64 修订）**：每个真实 tab 页 `onShow` 显式 `getTabBar().setData({selected})`（顾客 home=0/orders=1/profile=3，兼职 workbench=0/customers=1/profile=2）；伪 tab 页 `pages/customer/pickcodes/index` 不调 `getTabBar()`，由页内共用底部栏组件按 `selected=2` 渲染；`custom-tab-bar` 路径未命中（伪 tab 页）时保留页面显式值、不回落 0 覆盖。

### 3.5 页面与组件约定

- 页面 `.js` 只做：取参 → 调 `api/` → `setData` → 事件转发。禁止：`wx.cloud.*`、七状态字符串字面量、编号/roomTag 生成或 `random`、拼状态文案、直接读集合名/action 字符串。
- 每个业务页（主包 8 页：5 真实 tab + `customer/pickcodes` 伪 tab + `launch`/`role`；`pkg-customer` 5 页 + `pkg-partner` 8 页）`index.wxml` 根节点第一个子节点必须是 `<switch-bar />`；`pkg-admin` 页面不引用 `switch-bar`/`test-badge`。**D64（2026-11-02）**：`pkg-customer/pages/pickup-list/index`（D26/D57）迁主包为 `pages/customer/pickcodes/index`——只保留「我的取件码（本机）」区（D57 边界不变：只存本机/上传零外呼/上限 50/去重/READONLY 拒写），**删除 D26 订单区**（订单取件码仍在订单详情逐件展示）；该页为**伪 tab**：底部栏视觉由共用组件 `components/tab-bar-view` 提供、页面内自绘并 `reLaunch` 进入，`app.json` tabBar.list 仍 5 项；本页不挂分享。底部安全区类：tab 页（含伪 tab 页）根节点叠加 `page-body--tab`，有底部固定条的页面叠加 `page-body--bar`（D65，token 定义见 `app.wxss`）。**v1.8 批 21（D57）**：本机清单——纯件 `parts/local-view.js`（行/汇总/只读判断，零 wx）+ 页面零件 `parts/local-ocr.js`（`wx.chooseMedia` 选图 → 端侧 OCR → 文本；零上传零外呼）；解析纯件 `utils/recognize/local-codes.js`（`parseCodeText`/`mergeEntries`，零 wx）；本地持久化只经 `utils/storage` 的 `loadLocalCodes/addLocalCodes/removeLocalCode/setLocalCodeChecked/clearLocalCodes`（键 `ex_college_v4.pickcodes`，D57 唯一 L3 本机例外）；端侧 OCR 平台适配器抽到 `utils/ocr/wx-platform.js`（`hasVision/imageInfo/frameSizeOf/framePlanOf/canvasFrame/runVision/ocrDeps/VISION_MAX_EDGE`），下单页 `parts/ocr-flow.js` 改为 require 该模块（行为等价，原有导出名保留）。**v1.4 批 17 新增** `pkg-partner/pages/pick-list/index`（D46 独立楼层配送清单：苑→栋→楼层分组展示已取件待送达单，纯件在 `pkg-partner/pages/pick-list/parts/view-model.js`，分页/分片 ≤20 行、不做定时轮询、复用工作台批量送达纯件，无服务端改动；**D55（批 20）升级双阶段**：待取件（ACCEPTED，按站点 P1~P8，只读可复制）/待送达（PICKED，原楼层分组），纯件拆为 `pkg-partner/pages/pick-list/parts/pick-view.js`、`parts/stage-flows.js`）。
- 页面 `.json` 只写 `navigationBarTitleText` 等；组件已在 `app.json` 全局注册，页面无需再 `usingComponents`。
- **页面纯件（批 6~8 扩展）**：可测的视图模型/表单校验/文案放同页 `parts/*.js`（纯函数、零 `wx`），页面 `index.js` 只做取参→调 `api/`→`setData`→事件转发；`pkg-admin` 11 页均有 `parts/view-model.js` + `common/copy.js`，`pkg-customer/pkg-partner` 部分页有 `parts/*`。例外组件 `components/maintenance-mask`（维护模式全屏公告）与纯件 `utils/maintenance.js` 采用**页面级 `usingComponents` 注册**（不改 `app.json`；仅 `pages/customer/home`、`pages/partner/workbench` 引用）。
- **服务范围预检单源（TD-068）**：`utils/order-scope.js`（零 `wx` 纯件）是「苑归一 / 服务范围文案 / 范围判定」的唯一实现——导出 `SCOPE_ALL_TEXT`、`RANGE_BLOCK_TEXT`、`zonesOf`、`zoneTableOf`、`zoneKeyOf`、`scopeTextOf`、`zoneAllowedOf`；`pages/customer/home/parts/home-view.js` 与 `pkg-customer/pages/order-create/parts/precheck.js` 只 `require` 该件并 re-export 原导出名（两份重复实现清零，拦截文案同源）。服务端 `order.create` 的 `assertServiceRange` 仍是唯一权威，本地预检只省一次必失败请求。
- **分享事件（v1.2/D36）**：页面 `onShareAppMessage`/`onShareTimeline` 只允许 `return` 纯件结果——身份/会话/卡片/封面判据全在 `utils/share/{index,handlers}.js`（页面零自拼 `title/path/imageUrl`、零 `assets/share/` 路径）；朋友圈仅 role/home/help 三页（单页模式静态可自洽）；切换会话禁分享由 `components/switch-bar` 统一调 `utils/share/platform.syncSession`（唯一收口，页面/组件不直写 `wx.hideShareMenu`）；**分享卡 path 统一经 `config/route` 指向 `launch`（D37）**；单页模式（scene=1154）启动降级在 `app.js`。判据：`tools/check.js` #33 + `tools/selftest-share.js`。
- 相对路径深度：`pages/xxx/index.js` 与 `pkg-*/pages/xxx/index.js` 到仓库根都是 `../../../`（`pkg-*/pages/xxx/parts/*` 为 `../../../../../`）；`pages/launch/index.js`、`components/xxx/index.js` 为 `../../`。
- 组件 props/events（冻结）：

| 组件 | props | events |
| :-- | :-- | :-- |
| `switch-bar` | 无（读 store；含 `test-badge`，`TEST_WRITE` 渲染蓝条 + 角标，`READONLY` 黄条，无会话不渲染） | `exit` |
| `test-badge` | 无（读 store，仅 `viewMode=TEST_WRITE` 渲染；`TEST` 字面量只允许在本组件） | — |
| `avatar-view` | `src?`（**D42** 临时 URL，优先；加载失败可重试，不永久锁死）、`fileId?`（回退键，仅当 `src` 为空时用）、`name?`（默认头像首字）、`size?`（rpx，默认 64；默认头像首字字号按 `size` 等比 ≈0.42×size 下发，不写死页面字号） | `retry`（用户点默认头像位重试时触发） |
| `id-text` | `kind`（`CUSTOMER`/`PARTNER`）、`no`（canonical） | `copy` |
| `room-tag-text` | `dormKey`、`tag` | — |
| `status-pill` | `status`（七状态之一） | — |
| `order-row` | `order`（服务端视图模型） | `tap` |
| `failure-image` | `failureNo` | `loaded`、`error` |
| `image-picker` | `maxCount`（默认 1；**WXML 绑定按 kebab-case 写 `max-count`**，TD-069）、`purpose`（`TICKET`/`AVATAR`） | `change`（`detail.files`） |
| `code-editor` | `value`、`placeholder`、`maxlength` | `change`（`detail.value`） |
| `empty-state` | `text`、`actionText?` | `action` |
| `maintenance-mask`（页面级注册，非全局） | `view`（`{enabled,title,text}`，来自 `utils/maintenance.buildMaintenanceView`） | `ack`（关闭遮罩，仅本页内存态） |
| `tab-bar-view`（D64，全局） | `tabs`（`[{pagePath,text,icon,activeIcon,badgeKey?}]`）、`selected`（index）、`badges`（store badges 快照）、`pseudo`（bool：当前页为伪 tab 页时，非 tabBar 目标用 `reLaunch` 跳转） | `tap`（`detail:{index,pagePath}`，由使用方执行 `switchTab`/`reLaunch`） |
| `bottom-bar`（D65，全局） | 无 props（slot 提供内容）；组件自带 `env(safe-area-inset-bottom)` 底垫 + `ready` 实测条高占位（CSS min-height = `--v4-inset-bar`+24rpx 兜底）；`z-index:600` 高于 `custom-tab-bar`(500) | — |

- `status-pill` 文案单源（批 16）：短文案/色调由组件内纯件 `components/status-pill/meta.js` 从 `shared/enums.ORDER_STATUS_TEXT` 派生（如「已取件·配送中」→「已取件」），组件 `index.js` 零硬编码七状态中文；色调只做视觉编码，不承载业务判据。

- `app.wxss` 已提供全局工具类：`page-body`、`page-body--tab`（D65：tab 页/伪 tab 页根节点必用，补足自定义 tabBar 100rpx+safe 高度）、`page-body--bar`（D65：有底部固定条页面用）、`card`、`row`、`col`、`flex-1`、`between`、`center`、`title`、`section-title`、`subtitle`、`muted`、`small`、`strong`、`ellipsis`、`divider`、`btn`、`btn-primary`、`btn-ghost`、`btn-danger`、`btn-disabled`、`btn-block`、`tag`、`tag-test`、`safe-bottom`、`hidden`、`empty-text`、`form-row`、`form-label`、`form-input`。**D65 底部安全区 token**：`--v4-tabbar-h`/`--v4-safe-b`/`--v4-inset-tab`/`--v4-inset-bar`（只允许用 token 组合，页面禁止自造底垫数值；门禁 #37~#39 机械校验）。用到未定义的类必须写进本页 wxss（门禁 #9）。
- `custom-tab-bar`（D64 修订）：平台唯一入口组件，内部复用 `components/tab-bar-view` 渲染视觉；按 store 渲染顾客 4 格（首页/订单/取件码/我的）或兼职 3 格（工作台/客户/我的），`setData({ selected, role })`；真实 tab 切格 `wx.switchTab`，伪 tab 页（取件码）用 `wx.reLaunch`；无会话按 `activeRole`，有会话按 `viewContext.role`；**v1.1 起 `selected` 由各真实 tab 页 `onShow` 显式同步（见 §3.4），组件只在首次挂载/会话变化时推断，不覆盖页面显式值**。

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

> 查询指令工厂（批 10 / M-10，Lead 已授权）：`ctx.dao.command(name, value)` 返回 SDK 查询指令（`gte/lt/gt/neq/in/exists`），供服务端范围/前缀查询使用（仍由唯一 `db/dao.js` 构造指令对象，业务层不出现 `db`/`db.command`）。`api/db/dao.js` 与 `cleanup/db/dao.js` 两处补丁文本必须逐字一致；已知调用点 = `cloudfunctions/api/handlers/admin/_paging.js`（`fetchOrderedPage`/`fetchPrefixPage`）、`handlers/order/listCustomer.js`（`command('in')`/`command('gt')` 三桶计数）、`handlers/order/listPartner.js`（`command('gte')` 今日完成）、`handlers/partner/listBindings.js`（`command('in')` 批量补顾客资料）、`handlers/partner/stats.js`（`command('gte')`/`command('gt')` 区间计数）。
> 全量精度窄口（B 批 · 查询窗口簇 TD-040/043/050）：**`db/dao.js` 本轮未改**——既有 `count(collection,{where})`、`command(name,value)` 与 `find(collection,{where,orderBy,skip,limit})` 已足够表达「count 精确计数 + 范围 where + 固定批全量扫描」，原设想的 `countRange` 新窄口不需要新增。新增调用点 = `handlers/order/listCustomer.js`（顾客三桶 `count` 精确计数）、`handlers/order/listPartner.js`（今日完成单 `count`）、`handlers/partner/listBindings.js`（绑定/顾客资料按 `_id` 升序固定批扫描 + `command('in')`）、`handlers/partner/stats.js`（区间 `count` + 近 7 日边界 `count`）、`handlers/partner/_customer.js`（进行中单按状态 `skip` 固定批扫描）。

> 事务平台约束（D 批 TD-055）：`transaction(fn)` 的 fn 受 CloudBase 平台限制——**单事务 ≤100 操作、执行时间 ≤30 秒、仅支持 `doc` 方法（不支持 `where`，官方文档口径）**；调用方必须按「每页独立事务 + 最终关键段小事务」组织写（典型 = `admin.setPartnerStatus(CLOSED)`：分批页 ops ≤100、最终段 2 ops 原子；工程规则与残余风险见 ENGINEERING §4.13/R26）。**事务内分页取数的真实可用性待部署实测**：事务内仍按 dao 统一接口调用（`createTransactionDao` 复用同一 body），若真实 SDK 拒绝事务内 `where`，实现改为「事务外分页取 `_id` → 事务内逐 `doc` 写」，接口形状不变。

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
| `shared/enums.js` | 角色/订单状态/来源/取消原因/异常码/服务类型/绑定状态/审计动作等枚举与中文文案；**显式常量单源（TD-070）**：`CUSTOM_SERVICE_CODE='CUSTOM'`（「其他代办」）由客户端预检与服务端备注校验共用，不从 `SERVICES` 顺序推导，随 `tools/sync-cloud-shared.js` 生成两套云函数副本 |
| `shared/audit-actions.js` | 审计枚举：`INVITE_CREATE` `INVITE_REVOKE` `PARTNER_SUSPEND` `PARTNER_RESTORE` `CONFIG_UPDATE` `ORDER_ANOMALY_CANCEL` `BOOTSTRAP` `FAILURE_IMAGE_VIEW` `FAILURE_FIX` `FAILURE_IGNORE` `ACCOUNT_SWITCH_START` `ACCOUNT_SWITCH_END` `ACCOUNT_SWITCH_EXPIRED` `TEST_ACCOUNT_CREATE` `TEST_ACCOUNT_DELETE` `TEST_DATA_PURGE` |
| `shared/order-state.js` | 七状态转移表 + 动作合法起始状态 + 七状态中文文案 |
| `shared/role.js` | 角色判定纯函数 |
| `shared/zones.js` / `shared/stations.js` | 五苑标识与站点 P1~P8（名称/别名归一；v1.1/D32 起站点名称可由 `config.stations` 覆盖，匹配命中归一） |
| `shared/gender.js` | 顾客性别枚举 + 「苑+楼栋」推断/归一/展示名（v1.1/D31；纯件，无 wx） |
| `shared/validate.js` | 宿舍身份/尾号/文本上限/编号形态/邀请码形态校验 |
| `shared/format.js` | 时间/编号展示/文本截断 |
| `shared/order-view.js` | 订单视图模型：`bucketOf`（状态桶，生产唯一消费点 = `pages/partner/workbench/parts/group-view.js`）+ counts 六项键名/模板 + 状态文案查询；**四档动线排序生产实现 = `pages/partner/workbench/parts/group-view.js sortForRoute`（吃服务端 DTO、按整单最差件定档）；旧单件排序/文案簇生产 0 引用（`sortByPickupRoute` 等，其中 5 项登记 `tools/dead-export-baseline.json` 分类 `test-only`），单源收敛见 TD-082** |
| `utils/ids.js` | 编号归一/parse/display（**无生成、无 random**） |
| `utils/room-tag.js` | `toTag/tagRank/formatDormTag/isValidTag/compareByDormTag`（大写 A…Z/AA…，禁字符串排序） |
| `config/defaults.js`（同步为 `cloudfunctions/*/shared/defaults.js`） | 云端种子与配置校验的唯一默认值来源；`tools/sync-cloud-shared.js` 的第 17 个源（`shared/**` 14 件 + `ids.js` + `room-tag.js` + `defaults.js`），hash 门禁 `tools/check.js` #17 覆盖该副本 |

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
- 32 个页面四件套齐全且与 `app.json` 双向一致（主包 8 + 3 分包 24：`pkg-customer` 5 / `pkg-partner` 8 / `pkg-admin` 11；含 `pages/customer/pickcodes/index`（D64 由 `pkg-customer/pages/pickup-list` 迁入）与 `pkg-partner/pages/pick-list/index`）；14 集合注册表、13 错误码、action 注册表双向一致。
- 零金额扫描 0 命中（真实输出）；v0.9/v1.x 门禁 #28~#33 判据已登记（对象批次补"必须真红"证据）。
- 云函数可在 fake DB 下跑通 `health.check` 与 `admin.bootstrap`；真实云环境联调等用户完成 D1/D2 前置后再做。

## 7. 与文档的对应关系

| 代码域 | 权威文档 |
| :-- | :-- |
| 角色/权限/绑定方向/切换会话 | `docs/contract/V4_CONTRACT.md` §1、§4.2、§10、§12、§15 |
| 字段/索引/API 契约/编号/roomTag | `docs/data/V4_DATA_MODEL.md` §2、§4、§5、§7、§9 |
| 云函数分层/action/错误码/门禁/批次 | `docs/engineering/V4_ENGINEERING.md` §4、§7、§8、§11 |
| 页面/组件/导航/交互 | `docs/ux/V4_UX_CUSTOMER.md`、`V4_UX_PARTNER.md`、`V4_UX_DEVELOPER.md` |
| 隐私与发布 | `docs/privacy/*`、`docs/delivery/V4_QA_CHECKLIST.md` |
