# 批 31 · 服务通知（一次性订阅）实行方案（2026-11-08）

> **性质**：实施计划 / 工单（**机器侧已于 2026-11-08 收口，D73 已登记**；待部署与真机点检；同日独立审查修复已回写本批：`thing` 字段长度预算、模板 429 判据、skip 日志、接线/重放/看板判据，并**保留**用户可见的「我的 → 微信提醒」状态行与 20004 去设置引导——已补 CONTRACT/UX/QA/CHANGELOG/STATE 回写）。范围经用户 2026-11-08 确认：**顾客端只做「送达通知」；兼职端做「新订单通知」**。
> **口径**：需在 CONTRACT §13 追加一条新裁决（下一可用编号，登记后生效）；**登记前不动代码**。本文只写设计与文件级落点，不写实现代码。
> **模板（用户 2026-11-08 提供，均需在后台确认类型=一次性）**：

| 用途 | 模板 | 模板 ID | 类型 |
| :-- | :-- | :-- | :-- |
| 顾客：送达 | 商品送达通知（模板编号 22224，类目「信息查询」，2026-11-08 已换成 3 字段版） | `zxQ_yQgray66bHuDXPGGYEQTd6Fn-iCndeW6ImPl6ZQ` | 待确认（应为 2=一次性） |
| 兼职：新单 | 新订单通知（模板编号 3988，类目「信息查询」） | `GP0_nOdr_hn-a2UD0LVgHRhsmCkeHDI11C9c5DnDRKc` | 待确认（应为 2=一次性） |

## 0. 结论与范围

**MVP = 2 个模板、2 个触发点、1 个授权策略**：

- 顾客：`DELIVERED` 事件 → 发「商品送达通知」；授权挂在下单提交的点击里，**每单 1 条额度**，送达消耗。
- 兼职：`ORDER_CREATED`（仅 `source='CUSTOMER'`）→ 发「新订单通知」；授权挂在「开启提醒」+ 每次「接单/拒单」的点击里，**接单即续下一条**。
- 不做：顾客接单/取件提醒、异常提醒、转派邀请、复核结果、自动完成/超时、授权状态落库、后台模板管理 UI。
- 站内消息中心 + 轮询仍是主通道；订阅消息只做离线增强。

## 1. 前置 P0（开工前必须闭环）

| # | 事项 | 谁做 | 通过标准 |
| :-- | :-- | :-- | :-- |
| P0-1 | 两个模板的**模板内容 / 关键词 / 示例 / 类型**从「我的模板」复制出来 | 用户 | ✅ 2026-11-08 已提供截图：字段见 §3.1；类型仍需后台确认=2 |
| P0-2 | 确认模板必填字段都能被本项目填上（缺字段时的兜底文本也要能过） | 用户 + Lead | ✅ 2026-11-08 已解决：送达模板换成 3 字段版（去掉地址/电话），新单 3 字段均可填 |
| P0-3 | 10 分钟真机验证：勾「总是保持」后连续静默调用 3 次，云函数连发 3 条 | 用户 | 未做；3 条都成功=每次 +1 成立；第 2 条就 43101=不成立，方案降级 |
| P0-4 | 新裁决登记 CONTRACT §13（范围/模板/开关/公开子集） | Lead | ✅ 2026-11-08 已登记 **D73**（D_MAX 73），check-docs #5 绿 |

> P0-3 不通过时的降级：顾客仍可在下单时弹窗授权（首单有提醒），但「持续无感」不成立；兼职新单只能用「接单后续一条」的滚动额度，不能承诺条条提醒。

## 2. 口径草案（新裁决要点）

1. 顾客通知范围**只保留送达**（不实现接单/取件/异常）；兼职通知范围**只保留新订单**。
2. 模板 ID / 字段映射 / 开关统一进 `config.subscribeTemplates`，代码不硬编码；真实 ID 可随默认值入库（非凭证），`enabled` 默认 **false**。
3. `config.getPublic` **只**下发 `subscribeEnabled` 与两个模板 ID（供客户端 `requestSubscribeMessage`），**不下发字段映射**；同时改写 DATA_MODEL「模板 ID 不下发」的旧句。
4. 通知内容不得含取件码、宿舍号、手机尾号、头像/昵称、截图、识别原文；`page` 用 `pages/launch/index?orderNo=…`（顾客）与 `pages/partner/workbench/index`（兼职）。
5. 测试订单、测试账号、READONLY 会话、注销/删除中用户一律不发；发送失败只记日志，不影响业务。
6. 关闭 TD-012（订阅消息 P1 未实现）与 R6（模板审批）；模板已获用户提供。

## 3. 配置形状（`config/defaults.js`）

```json
subscribeTemplates: {
  "enabled": false,
  "delivered": {
    "templateId": "zxQ_yQgray66bHuDXPGGYEQTd6Fn-iCndeW6ImPl6ZQ",
    "page": "pages/launch/index?orderNo={orderNo}",
    "fields": {
      "character_string1": "orderNo",
      "time6": "deliveredAt",
      "thing3": "fixed:快递已送达，请及时取件"
    }
  },
  "newOrder": {
    "templateId": "GP0_nOdr_hn-a2UD0LVgHRhsmCkeHDI11C9c5DnDRKc",
    "page": "pages/partner/workbench/index",
    "fields": {
      "thing20": "orderSourceText",
      "thing24": "serviceAreaText",
      "number45": "parcelCount"
    }
  }
}
```

- `fields` 的 **key = 模板关键词**（用户 2026-11-08 截图已确认），**value = 值注册表键**；代码值注册表：`orderNo / deliveredAt / orderSourceText / serviceAreaText / parcelCount / fixed:文本`。
- 未知 key 或模板缺字段 → **fail-closed**（不发、warn 日志），不抛错。
- `readConfig` 对 `subscribeTemplates` 做**一层合并**（DB 只写 `enabled:true` 时不丢默认 ID/字段）——`db/config.js` 现在是浅 `Object.assign`，需补这一处。
- 公开子集新增：`subscribeEnabled`、`subscribeTemplateIds:{delivered,newOrder}`（仅 `enabled=true` 时给 ID）。
- 配置维护：MVP 走控制台 `config/global` 改 `enabled`（参照 `aiFallback` 先例），后台不新增编辑页；模板 ID 变更同理。

### 3.1 模板字段映射（用户 2026-11-08 截图）

**商品送达通知（delivered，2026-11-08 新 3 字段版）**

| 关键词 | 模板字段 | 计划值 | 状态 |
| :-- | :-- | :-- | :-- |
| `character_string1` | 订单编号 | `orderNo` | 可填 |
| `time6` | 送达时间 | `deliveredAt`（如 `2026年11月08日 10:30`） | 可填 |
| `thing3` | 温馨提示 | `fixed:快递已送达，请及时取件` | 可填（11 字） |

**新订单通知（newOrder）**

| 关键词 | 模板字段 | 计划值 | 状态 |
| :-- | :-- | :-- | :-- |
| `thing20` | 订单来源 | `orderSourceText` = `顾客下单`（转派场景另定） | 可填 |
| `thing24` | 服务地址 | `serviceAreaText` = 苑 + 楼栋 + 站点（不含宿舍号） | 可填（多站点取首站或写「多站点」） |
| `number45` | 订单量 | `parcelCount` = 本单件数 | 可填 |

### 3.2 字段核对结论

1. **送达模板已无阻塞**：2026-11-08 换版后只剩 3 个字段（订单编号/送达时间/温馨提示），项目数据都能填；原「配送员电话」「到达地址」字段已随换版消失，隐私面更干净（不违反 CONTRACT §9）。
2. **新单模板的 `服务地址` 只到苑 + 楼栋 + 站点**，不带宿舍号（宿舍号属 L3，CONTRACT §9 通知不得带敏感信息）；如确需带房间号，须先改 CONTRACT 并评估锁屏泄露风险——**不建议**。
3. **模板 `data` 必须覆盖全部关键词**，缺一个就 47003；上面已给出全部字段的建议值，无空缺。


## 4. 授权策略（「无感」模型）

| 角色 | 时机（必须是 tap） | 模板 | 额度 | 说明 |
| :-- | :-- | :-- | :-- | :-- |
| 顾客 | 下单页「提交」tap 内、调 `order.create` 之前 | delivered | 每单 +1 | 首次弹窗；用户勾「总是保持」后静默 |
| 兼职 | 工作台「开启新单提醒」按钮 | newOrder | +1 | 首次授权入口 |
| 兼职 | 每次「接单 / 拒单」tap 内、调写接口之前 | newOrder | +1 | 「接单即续下一条」滚动额度 |

- 顾客「一单一条」正好覆盖送达；取消/未送达的订单会留下结余，可给后续订单用（有盈余、无缺口风险）。
- 兼职是**滚动 1 条**：接单后补下一条；多单并发时只有第一条新单会推送，其余靠 30s 轮询——这是范围决定，需在 UX 文案里说清。
- 代客单/guest 单：顾客没有提交 tap，无法授权；guest 单不发；绑定顾客的代客单可在详情页加「开启送达提醒」按钮（P1 可选，本批不做）。
- 拒绝/失败/20004（关闭主开关）一律不阻断；P1 再做「去设置页」引导。
- **不做应用内「不再提醒」开关**：它只会让通知静默停掉；用平台自带的「总是保持」+ 系统设置。

## 5. 服务端改造

| 文件 | 改动 |
| :-- | :-- |
| `cloudfunctions/api/lib/subscribe-message.js`（新） | 纯件：`buildData(fields, values)`、模板/值校验、`send(ctx,{openid,templateId,page,data})`；`catch + console.warn`，不抛、不重试；日志只含 `templateKey/errcode/orderNo 尾号`，不写 openid/正文 |
| `cloudfunctions/api/handlers/order/_common.js` | `runOrderAction` 事务成功后、构造 DTO 前：`eventType==='DELIVERED'` → 发顾客；用事务内最新 order（含 `customerOpenid`） |
| `cloudfunctions/api/handlers/order/_create.js` | 事务提交后（`:401` 之后）：`source==='CUSTOMER'` 且 `partnerOpenid` 非空 → 发兼职；`PARCELS_APPENDED` 不发 |
| `cloudfunctions/api/config.json`（新） | `permissions.openapi:["subscribeMessage.send"]`；部署后 10 分钟权限缓存 |
| `cloudfunctions/api/db/config.js` | `subscribeTemplates` 一层合并（见 §3） |

**发送闸（按序短路）**：`enabled` → 模板 ID/字段非空 → `order.isTest!==true` → 目标 openid 非空 → `users.status==='ACTIVE'` 且未删除 → 构造 data 成功 → 调 openapi。
**错误码**：43101 静默（无额度/拒收）；43107/43108/45168/47003 `warn`（不重试、不弹用户）；发送 `await` 加 1.5s 超时，超时只记日志。
**幂等**：只在非 `duplicated` 路径发送（`runOrderAction`/`_create` 重放分支已提前返回），无需新表。

## 6. 客户端改造

| 文件 | 改动 |
| :-- | :-- |
| `utils/subscribe.js`（新） | `request(tmplIds)` 包装 `wx.requestSubscribeMessage`（15s 兜底、绝不 reject）+ 纯件：`planForOrderSubmit/planForPartnerTap`、`statusesOf/acceptedOf/resultText`（accept/reject/ban/filter 真值判定，禁止假成功）、`isMainSwitchOff/openSetting/guideMainSwitch(scene)`（20004 去设置引导，文案按 customer/partner/profile 场景）；无 storage、无 wx.cloud |
| `pkg-customer/pages/order-create/index.js` | 提交 tap 内、创建请求前调 `subscribe.request`；失败继续；按钮不额外加 |
| `pages/profile/{index,index.wxml,index.wxss,parts/subscribe-row.js（新）}` | 「我的 → 微信提醒」状态行：读 `wx.getSetting` 显示已开启/未开启/已关闭；点击可再次授权/去设置；READONLY/TEST_WRITE 隐藏；开发版才显示 errCode 排障 |
| `pages/partner/workbench/index.js` + `parts/{page-actions,subscribe-wiring}.js` + `index.wxml` | 页头「开启新单提醒」（订阅未启用时隐藏）；接单/拒单 tap 内先调授权再写；只有 accept 才提示已开启 |
| `pkg-customer/pages/order-detail`（P1） | 代客单「开启送达提醒」入口（本批不做） |

- READONLY/TEST_WRITE：不显示授权入口；测试账号合成 openid 收不到，不发送。
- 授权文案（示例）：「开启送达提醒？送达时可在微信里收到通知，每单一条。」/「暂不开启」/拒绝后：「没开启也能在订单详情看进度。」

## 7. 判据与测试

- 服务端扩 `tools/selftest-messages.js`（现 108→扩至 150+ 断言，含审查补齐；余量按 1000 行门禁动态判断）：扩 `cloudStub` 的 `subscribeMessage.send`，断言：
  1. `enabled=false` / ID 或字段缺失 → 0 次；
  2. `isTest` / 测试账号 / `users.status!=ACTIVE` / 空 openid → 0 次；
  3. `DELIVERED` → 恰好 1 次，`templateId/data/page/touser` 键集合正确；默认 8 站点×楼栋字段长度全部合规（thing≤20 字，P5 16 字站点名不再整条丢）；
  4. `ORDER_CREATED(source=CUSTOMER)` → 1 次且 touser=partnerOpenid；`source=PARTNER`/代客单 → 0 次；
  5. `send` 抛错 / 返回 43101 → 业务成功、不抛、不重试；
  6. 重放（duplicated，`order.create`/`markDelivered` 同 clientRequestId）→ 0 次；
  7. 未知字段映射 → 0 次 + warn；skip 六路径有日志（不含 openid/L3）。
- 客户端扩 `tools/selftest-message-pages.js`：`planForOrderSubmit/planForPartnerTap/statusesOf/acceptedOf/resultText` 纯件 + 三处接线静态断言（授权先于下单/先于 dispatch、工作台 `subscribeEnabled`、profile 行受 `subscribeVisible` 控制、TEST_WRITE 隐藏）与 READONLY 静态断言。
- 变异电池（5 组）：去 `isTest` 闸 / 去 `enabled` 闸 / 事务内发送 / 失败抛出 / 关闭时仍下发 ID——均应首红，SHA256 还原复绿。
- `check.ps1` 判据/套件条数不动（39/12/38）；`selftest.js` 的 `EXPECTED_ASSERTIONS` 同步。

## 8. 文档回写（按 ENGINEERING §8.6）

CONTRACT §9 + §13 新裁决；DATA_MODEL `config` 行/公开子集/`page` 参数；ENGINEERING §4.2 config 行 + §7.2 套件；UX_CUSTOMER §8.4（只送达）+ 授权文案；UX_PARTNER（新单提醒/接单续订）；RUNBOOK（配置开关、`config.json` 部署、真机验证）；QA 新增（授权弹窗/送达通知/新单通知/拒绝不阻断）；TECH_DEBT 关闭 TD-012；R6 关闭（模板已获批）；STATE/CHANGELOG。

## 9. 分批与排期

| 批 | 内容 | 出口 |
| :-- | :-- | :-- |
| 批 31（本批） | P0 → 口径 → 配置/公开子集 → 客户端授权 → 服务端发送 → 判据 → 文档 → `check.ps1` | **机器侧已收口（2026-11-08，含独立审查修复）**；用户部署 `api` + 控制台置 `enabled=true` + 真机点检（QA §AJ；模板类型=2 与 P0-3 未确认前保持关闭） |
| 批 31（P2） | 后台模板管理、顾客「开启送达提醒」补入口、异常/转派提醒、授权状态落库、失败观测 | 视用户反馈 |

## 10. 风险与回退

| # | 风险 | 回退 |
| :-- | :-- | :-- |
| R1 | 送达模板换版后仍有字段对不上 | §3.1 已核对：3 字段均可填；字段再变时按 fail-closed 停发并更新映射 |
| R2 | 「总是保持」后不累计额度（P0-3 失败） | 顾客保留下单弹窗；兼职退化为「接单后续一条」；登记欠账 |
| R3 | 兼职新单只有滚动 1 条，多单漏 | 文案写明；站内轮询兜底；不承诺条条提醒 |
| R4 | 单环境误发真实通知 | `enabled` 默认 false；部署后由用户手动开；`isTest` 闸 |
| R5 | 发送拖慢订单接口 | 1.5s 超时 + 只发 1 条；超时记日志不重试 |
| R6 | 模板 ID 进仓库 | 模板 ID 非凭证，允许；如用户要求改放 DB，P2 支持 |
| R7 | 云调用权限缺失 `-604101` | `config.json` 声明 + 部署后等 10 分钟；RUNBOOK 写步骤 |

## 11. 开工前待用户提供

1. ✅ 两个模板的字段/关键词（2026-11-08 截图已提供，送达已换 3 字段版）；**仍需后台确认类型=2（一次性）**；
2. ✅ 送达模板已无「配送员电话/到达地址」，字段阻塞解除；
3. ⏳ **新单模板 `服务地址` 粒度确认**：只到苑 + 楼栋 + 站点（不含宿舍号），是否接受；
4. ⏳ P0-3 真机验证结果（勾「总是保持」后连续 3 条是否都成功）；
5. ⏳ 用户一句「开工」+ 对 §2 口径点确认（只做送达 + 新订单、模板 ID 走 config 默认关闭）。

> 1、2、3、5 齐了即可登记新裁决并开工；4 决定「持续无感」能否成立。
