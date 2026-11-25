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
cloudfunctions/*/shared/（按各云函数静态 require 闭包，从 shared/** 与 utils/ids.js、utils/room-tag.js、config/defaults.js 逐字节同步的**最小子集**副本；清单唯一源 = tools/sync-cloud-shared.js 的 SHARED_MANIFEST）
```

铁律：客户端不出现集合名与 action 字面量（只允许在 `api/` 与 `shared/`）；云函数不出现 `db.collection`（只允许 `db/dao.js`）；身份只来自服务端（真实 `OPENID` 或切换会话票据解析结果）。

## 2. 本轮并行写作用域（单写者；越界 = 冲突，冲突先报 Lead）

| 工作流 | Owner | 写作用域（只许改这些） |
| :-- | :-- | :-- |
| S0 骨架与集成 | lead | `app.json` `app.js` `app.wxss` `project.config.json` `sitemap.json` `.gitignore` `.tool-versions` `.env.example` `config/env.js` `config/route.js` `api/**` `store/**` `pages/launch/**` `pages/profile/**` `utils/share/**` `utils/workspace.js`（D86 工作区切换单源） `docs/engineering/V4_ARCHITECTURE.md` |
| S1 口径纯件 | v3-data-model | `shared/**` `utils/ids.js` `utils/room-tag.js` `utils/order-scope.js`（C 批 TD-068 下沉的服务范围预检单源） `config/defaults.js` |
| S1b 云端身份域 | v3-data-model | `cloudfunctions/api/handlers/{user,customer,partner,bind,upload,config}/**` |
| S2 工具链与门禁 | v3-engineering | `tools/**` `check.ps1` `gate.ps1` `doctor.ps1` |
| S3 顾客端 | v3-lifecycle-flow | `pages/role/**` `pages/customer/**` `pkg-customer/**` `utils/recognize/**` `utils/ocr/**` |
| S4 兼职端 | v3-pickup-ux | `pages/partner/**` `pkg-partner/**` `utils/customer-view.js` `utils/order-edit.js` `utils/order-sort.js`（D100 排序单源） |
| S5 开发者后台页 | v4-developer-console | `pkg-admin/**` |
| S6 仓库文档与隐私件 | v4-privacy-qa | `AGENTS.md` `STATE.md` `CHANGELOG.md` `docs/delivery/V4_RUNBOOK.md` `docs/engineering/V4_FIXTURES.md` `docs/governance/V4_TECH_DEBT.md` `utils/storage.js` `utils/privacy-policy.js` `utils/avatar.js` |
| S7 云核心 | cloud-core（新） | `cloudfunctions/api/index.js` `app.js` `router.js` `bootstrap.js` `middleware/**` `db/**` `lib/{respond,errors,time,id-generator,tag-allocator}.js` `handlers/health/**` `package.json` `cloudfunctions/cleanup/index.js` `cloudfunctions/cleanup/package.json` |
| S8 云订单与兜底 | cloud-orders（新） | `cloudfunctions/api/handlers/{order,message,ai}/**` `cloudfunctions/api/lib/ai/**` `cloudfunctions/cleanup/sweeps/**` |
| S9 云后台 | cloud-admin（新） | `cloudfunctions/api/handlers/admin/**` `cloudfunctions/api/handlers/admin/dto/**`（如需要） |
| S10 组件与资产 | ui-components（新） | `components/**` `custom-tab-bar/**` `assets/**` |

- **2026-11-08 D68/D69 新增/改动文件（顾客停用恢复 + 退出登录；均在既有作用域内，无新页面）**：S1 `shared/{enums,audit-actions,actions}.js`（`USER_STATUS` +`SUSPENDED`/`USER_STATUS_LABELS`、审计 `CUSTOMER_SUSPEND/CUSTOMER_RESTORE`（16→18）、action `admin.setCustomerStatus`）；S9 `handlers/admin/setCustomerStatus.js`（新）+ `handlers/admin/{index,listCustomers,getCustomer,_dto}.js`；S7 `middleware/auth.js`（SUSPENDED/DEACTIVATED 文案分流）；S8 `handlers/order/_store.js`（停用顾客禁代客下单）；S1b `handlers/partner/{listBindings,getCustomer}.js`（行 DTO +`status`）；S0 `api/modules/admin.js`、`store/index.js`（`accountStatus`）、`pages/launch/**`（状态页/退出态）、`pages/profile/**`（退出登录入口 + 拆件 `parts/{logout,delete-account}.js`）；S6 `utils/storage.js`（`loggedOut` + `isLoggedOut/setLoggedOut/clearSession`）；S5 `pkg-admin/common/{constants,customer-status}.js`、`pkg-admin/pages/{customers,customer-detail}/**`；S2 `tools/lib/{admin-customer-cases,admin-customer-ui-cases}.js` 与 `tools/selftest-{admin,admin-pages,profile,switch,testaccount,partner-customers,partner-orders,query-window,deletion}.js`。
- 云函数 `shared/` 副本**任何人不得手写**：由 `node tools/sync-cloud-shared.js` 生成（S2 提供脚本，S1 完成后 Lead 先跑一次）。副本按各云函数的**静态 require 闭包**生成最小子集（清单唯一源 = 脚本导出的 `SHARED_MANIFEST`）：闭包 ⊄ 清单（漏同步）或清单 ⊄ 闭包（陈旧清单）均 fail-closed 中止；门禁 #17 按同一清单逐目标对帐，多余副本文件同样判红。
- **批 16 组件删减（S10 域说明）**：`components/customer-row/`、`components/form-field/`、`components/role-switch/`、`components/section-card/` 四个全局注册组件在全仓 WXML 零使用，批 16 删除目录并从 `app.json` 全局 `usingComponents` 移除（`app.json` 该次改动由 Lead 授权 S2 执行）。S10 写作用域（`components/**`、`custom-tab-bar/**`、`assets/**`）不变；后续新增全局组件仍须登记本节 §3.5 组件表 + ENGINEERING §5.7，并同时进 `app.json` 注册与门禁 #36 扫描范围。
- 公共文件一旦冻结（`app.json`、`app.wxss`、`shared/**`、`api/**`、`store/**`）：需要改动先发 Lead，由单写者合并。
- 新增文件必须落在自己的写作用域内；跨域引用只读或走 `require`，不得改他人文件。
- **批 25 新增文件（D61 件级取件 / D62 多站点按件分组，均在既有作用域内，不新增作用域/全局组件/app.json 条目）**：S8 `cloudfunctions/api/handlers/order/_picked.js`（件级判定/聚合/写回归一纯件）；S4 `pages/partner/workbench/parts/{order-row,piece-actions,piece-flow}.js`、`pages/partner/pick-list/parts/*` 内件级视图（既有文件扩展）；S3 `pages/customer/orders/parts/pickup-tag.js`、`pkg-customer/pages/order-detail/parts/parcel-view.js`（扩展）；S2 判据辅助 `tools/lib/{workbench-picked-cases,order-customer-pickup-cases}.js`。**Lead 授权的一次跨域写**：S3 `pkg-customer/parts/status-view.js` 仅补 2 条事件人话映射（D61 事件上屏，其它逻辑零改动）。
- **批 30（D70/D71/D72，2026-11-08）新增/改动文件（均在既有作用域内，不新增页面/分包）**：S1 `shared/station-rules.js`（**新**：站点顺序/别名/取件码格式 DSL/写层校验/读层净化/`matchCodeStation`，纯函数零 wx）+ `shared/stations.js`（`stationsFromConfig` 顺序化与别名入表、`inferStationFromCode`、`stationInferOf`、`listStations` 仍只回 id/name）+ `config/defaults.js`（`stationInfer` 公开子集、P3 出厂格式）；S2 `tools/sync-cloud-shared.js`（清单 + station-rules）、`tools/{selftest-core,selftest-recognize,selftest-ai,selftest-order-flow,selftest-admin-pages}.js`；S3 `utils/recognize/{codes,index,station}.js`、`pkg-customer/pages/order-create/{index.js,parts/model.js,parts/ocr-flow.js}`；S4 `pkg-partner/pages/create-on-behalf/{index.js,parts/recognize-model.js,parts/recognize-flow.js}`；S5 `pkg-admin/pages/config/**`（顺序/别名/格式/双判据开关；**批 30 补件 964938f：列表 + 底部浮层编辑、草稿制与行内即时校验**）；S8 `cloudfunctions/api/lib/ai/parse.js`、`handlers/ai/_common.js`、`handlers/admin/{updateConfig,_dto}.js`（S9）；S6 文档（本文件/CONTRACT/DECISIONS/DATA_MODEL/UX×2/QA/CHANGELOG/STATE）。**无新增集合/索引/触发器/云函数单元；`cloudfunctions/*/shared/station-rules.js` 由 sync 脚本生成，不得手写。**
- **批 44（D86，2026-11-16）新增/改动文件（均在既有作用域内，不新增页面/分包）**：S1 `shared/role.js`（`pickActiveRole` 默认顾客）；S1b `handlers/user/bootstrap.js`（`preferredRole` 入参 + 投影按偏好）；S0 `api/modules/user.js`（`bootstrap(preferredRole)`）、`app.js`（启动带 `lastRole`）、`config/route.js`（`workspaceHomeOf`）、`utils/workspace.js`（**新**：`otherRoleOf/canSwitch/switchTo`，可注入依赖）、`pages/launch/index.js`（bind 上下文补一次水合）、`pages/role/**`（任务式文案/绑定卡按 roles 判定）、`pages/profile/**`（一处切换行 + `onSwitchRole`）、7 处页面守卫（`workspaceHomeOf` 回退）；S2 `tools/{check.js,check-docs.js,zero-money-scan.js}` + `tools/lib/{fsutil,dead-code-core,workspace-cases,role-workspace-cases}.js`（`.agents` 跳过 + D86 判据）、`tools/selftest-{cloud,profile,performance}.js`；S6 文档（CONTRACT/DECISIONS/DATA_MODEL/ARCHITECTURE/ENGINEERING/UX×2/QA §AM/REVIEW_MATERIALS/CHANGELOG/STATE）。**无新增集合/索引/触发器/云函数单元；`cloudfunctions/api/shared/role.js` 由 sync 脚本生成。**
- **批 31（D73，2026-11-08）新增/改动文件（均在既有作用域内，不新增页面/分包）**：S1 `config/defaults.js`（`subscribeTemplates` 两模板 + 字段映射 + `enabled:false`；公开子集启用时下发 `subscribeTemplateIds`）；S2 `tools/selftest-cloud-fixtures.js`（订阅发送桩）、`tools/{selftest-messages,selftest-message-pages,selftest-privacy-text,check-docs}.js`；S3 `utils/subscribe.js`（**新**：授权包装/`statusesOf`/`acceptedOf`/`resultText`/20004 场景引导，页面零 `wx.requestSubscribeMessage`）、`pkg-customer/pages/order-create/parts/submit.js`（提交 tap 内授权）、`pages/profile/{index.js,index.wxml,index.wxss,parts/subscribe-row.js（**新**）}`（「我的 → 微信提醒」状态行/再次授权/去设置）、`pages/partner/workbench/{index.wxml,parts/page-actions.js,parts/subscribe-wiring.js（**新**）}`（开启新单提醒/接单拒单续订）；S4 `cloudfunctions/api/lib/subscribe-message.js`（**新**：发送闸/字段长度预算/失败降级）、`handlers/order/{_common,_create}.js`（DELIVERED/ORDER_CREATED 事务后发送）、`db/config.js`（`subscribeTemplates` 一层合并）、`cloudfunctions/api/config.json`（**新**：`permissions.openapi`，部署后约 10 分钟生效）、`cloudfunctions/cleanup/config.json`（**新入库**：触发器声明）；S6 文档（本文件/CONTRACT/DATA_MODEL/ENGINEERING/RUNBOOK/UX×2/QA §AJ/隐私 v1.11/CHANGELOG/STATE）。**无新增集合/索引/触发器/云函数单元；`cloudfunctions/*/shared/defaults.js` 由 sync 脚本生成。**
- **批 30 冻结接口**：`shared/stations` 新增 `stationInferOf(options)`（`{fromImage,fromCode}`，缺省 true）与 `inferStationFromCode(code, options)`（`{id,name,pattern,by:'code'}|null`，唯一命中才接）；`shared/station-rules` 导出 `normalizeStations(rawList, defaults)`、`validateStationConfig(rawList, defaults)`（返回错误键）、`stationErrorText(code)`、`cleanCodePattern`、`matchCodeStation(code, stations)`；`config.stations[]` 增 `aliases[]`/`codePatterns[]` 且顺序即展示序；`config.stationInfer` 为公开子集新键；`admin.updateConfig` 白名单增 `stationInfer`（`stations` 整表形状扩展）。识别层：`parseOcrText(options)` 的 `options.stationInfer` 可关单判据；`applyAiSuggestion/adoptAiSuggestion` 增第 3 参 `options`（旧调用不传=仅默认表、零破坏）。
- **批 26/27 新增/改动文件（D58 转派 / D59 子队员 / D63 顾客邀请顾客，v1.10；均在既有作用域内，新增 1 个分包页）**：S1 `shared/{enums,actions,order-state,validate}.js`（`ORDER_EVENTS` 19→24、`TRANSFER_STATUS/TRANSFER_RESOLVE_REASON/TRANSFER_STATUS_TEXT/MESSAGE_HIDDEN_EVENT_TYPES/INVITATION_KIND`、8 个新 action、4 条 `to:'SAME'` 转移规则、`validateTeamNote`/`validity` 枚举）+ `config/defaults.js`（`transferTtlMinutes/transferRate/teamMaxMembers/subInviteRate`，均不进公开子集）；S0 `api/modules/{order,partner}.js`（+4/+4 方法）、`utils/share/index.js`（`buildAppMessage` +`boundPartnerNo`、`TITLES.BIND_CUSTOMER`）、`pages/profile/{index.js,index.wxml,parts/share-card.js}`、`pages/role/**`（落地提示文案）；S8 `cloudfunctions/api/handlers/order/{requestTransfer,acceptTransfer,declineTransfer,cancelTransfer,_transfer}.js`（新）+ `handlers/order/{index,get,listPartner,_dto,_dto-fields}.js`、`handlers/message/list.js`、`handlers/admin/{_dto,listOrders,getOrder}.js`；S1b `cloudfunctions/api/handlers/partner/{createSubInvites,revokeSubInvite,listSubMembers,removeSubMember,_team}.js`（新）+ `handlers/partner/{index,activate,getPublic}.js`、`handlers/bind/create.js`、`handlers/order/_create.js`、`handlers/admin/{setPartnerStatus,listInvites,invite-codes/_dto}.js`；S4 `pkg-partner/pages/team/**`（**新分包页，第 33 页**：四件套 + `parts/**` 纯件）、`pages/partner/workbench/parts/transfer.js` 与 `pkg-partner/pages/order-detail/parts/transfer.js`（新纯件）、`pages/partner/workbench/**`、`pkg-partner/pages/order-detail/**`、`pkg-partner/pages/service-settings/**`（团队入口行）；S3 `pkg-customer/pages/order-detail/**`（顾客侧「由 P-XXX-XXX 接手履约」）；S5 `pkg-admin/pages/{orders,order-detail,invite-codes}/**`（只读留痕/`kind` 列）；S2 `tools/selftest-transfer.js`、`tools/selftest-team.js`（新，SUITES 36→38）、`tools/{selftest-order-workbench,selftest-order-detail-partner,selftest-order-customer,selftest-admin-pages,selftest-share,selftest-partner-pages,selftest-state,selftest-messages}.js`、`tools/lib/{order-transfer-cases,share-pages}.js`、`tools/check.js`（#3 页数口径随新页）；S6 文档（本文件/`CONTRACT`/`DATA_MODEL`/`ENGINEERING`/`UX×3`/`QA`/`RUNBOOK`/隐私/`STATE`/`CHANGELOG`）。**新增页 = 页数 32→33，联动 `app.json`/`tools/lib/project.js` `ALL_PAGES`/CONTRACT §7/§6 判据/`check-docs` #2（由 Lead 收口）**。
- **D87 改动文件（2026-11-17，转派候选检索 + 文字卡片；零新增页面/集合/索引）**：S1 `shared/actions.js`（+1 client 读动作 `partner.searchTransferTargets`）+ `config/defaults.js`（+`transferSearchRate`，不进公开子集/不进 `updateConfig` 白名单）；S8 `cloudfunctions/api/handlers/partner/{searchTransferTargets.js（新）,index.js,_team.js}`（`_team` 导出 `minuteWindowKeyOf`/`bumpRateCounters` 供复用）；S0 `api/modules/partner.js`（+1 方法）；S4 `pkg-partner/pages/order-detail/{index.js,index.wxml,index.wxss,parts/transfer.js,parts/transfer-candidates.js（新）,parts/transfer-flow.js（新）}`；S2 `tools/selftest-transfer.js`（拆 T15 到 `tools/lib/transfer-search-cases.js` 控 1000 行）、`tools/lib/partner-transfer-ui-cases.js`（K63~K73）、`tools/check-docs.js`（`D_MAX` 86→87）；文档回写 CONTRACT §5.3/§11.2/§13、DATA_MODEL §2.3/§2.10/§7、ENGINEERING §4.2/§7.5、UX_PARTNER §3.3、QA §G/§AL6、隐私三处、`STATE`/`CHANGELOG`。**共享副本由 `node tools/sync-cloud-shared.js` 生成**。
- **D88 改动文件（2026-11-17，转派码；零新增页面/集合/索引）**：S1 `shared/actions.js`（+2 动作：`partner.createTransferCode` 写 / `partner.resolveTransferCode` 读）+ `config/defaults.js`（+`transferCodeTtlMinutes`/`transferCodeRate`，不进公开子集/后台白名单）；S8 `cloudfunctions/api/handlers/partner/{createTransferCode.js（新）,resolveTransferCode.js（新）,_transfer-code.js（新）, _transfer-target.js（新）,searchTransferTargets.js,index.js}`（`_transfer-target` 抽走 `isTestOpenid/inTeamScopeOf/canReach`，检索与解析共用一份判定）；S0 `api/modules/partner.js`（+2 方法）；S4 `pkg-partner/pages/order-detail/{parts/transfer-candidates.js,parts/transfer-flow.js,index.wxml,index.wxss}` + `pkg-partner/pages/service-settings/{index.js,index.wxml,index.wxss}`（「我的转派码」签发卡片）；S2 `tools/lib/transfer-code-cases.js`（新，T16/T16b 20 条）+ `tools/lib/partner-transfer-ui-cases.js`（K74~K78）；文档回写 CONTRACT §5.3/§11.2/§13、DATA_MODEL §2.3/§2.10/§7、ENGINEERING §7.5（M39）、UX_PARTNER §3.3、QA §AL、隐私三处、`STATE`/`CHANGELOG`。
- **D89 改动文件（2026-11-17，转派后边界与可发现性；零新增动作/集合/索引）**：S8 `handlers/order/{requestTransfer.js（禁止二次转派）,_transfer.js（+isAccepted）,_dto.js（ACCEPTED 后不下发 requestTransfer）}`；S4 `pkg-partner/pages/order-detail/{parts/transfer.js（away 状态条纯件）,parts/view-model.js,index.js,index.wxml,index.wxss}`、`pages/partner/workbench/index.wxml`（已转出标题条数 + 说明）；S2 `selftest-transfer`（P0-1/K32b/K74 反转 + P2-11/P2-11b）、`tools/lib/partner-transfer-ui-cases.js`（K79~K82）；文档回写 CONTRACT §5.3/§13、DATA_MODEL §2.5/§6、ENGINEERING §7.5（M40）、UX_PARTNER §3.3、QA §AL15、`STATE`/`CHANGELOG`。
- **D90 改动文件（2026-11-17，转派候选「最近使用」；零新增集合/索引）**：S1 `shared/actions.js`（+1 client 读动作 `partner.recentTransferTargets`）；S8 `cloudfunctions/api/handlers/partner/{recentTransferTargets.js（新）,index.js}`（派生自 `orders.transfer.fromPartnerId`，复用 `idx_transfer_from`）；S0 `api/modules/partner.js`（+1 方法）；S4 `pkg-partner/pages/order-detail/{parts/transfer-candidates.js（cardsOfRecent/mergeCards）,parts/transfer-flow.js（loadTransferCandidates 并行拉取）,index.js（改为编排调用）}`；S2 `tools/lib/transfer-recent-cases.js`（新，T18 11 条）+ `tools/lib/partner-transfer-ui-cases.js`（K83~K86）；文档回写 CONTRACT §5.3/§13、DATA_MODEL §7、ENGINEERING §7.5（M41）、UX_PARTNER §3.3、QA §AL16、`STATE`/`CHANGELOG`。
- **D93~D96 改动文件（2026-11-19，订单号结构化 / 配送地址补字母编号 / 转派双口径统计 / 取件清单锚码同域；零新增集合与页面，新增 1 个共享纯件 + 1 个索引）**：S1 `shared/order-no.js`（**新**：`partsOf`/`compose`/`isOrderNo`，D93 格式唯一单源；`tools/sync-cloud-shared.js` 清单 +`order-no.js`，副本 `cloudfunctions/api/shared/order-no.js` 由脚本生成，不得手写）；S8 `cloudfunctions/api/lib/id-generator.js`（`nextOrderNos` 增第 4 参 `dorm`，缺省仍出旧格式以兼容旧调用）、`handlers/order/{_create.js（空间锚=下单人宿舍快照 + 校验）, _store.js（读路径双格式）, listPartner.js（精确搜索双格式）, _dto-fields.js（`delivery.roomTag` 派生）}`、`handlers/{message,admin}/_common.js`（订单号读路径双格式）；S3 `pages/partner/workbench/{index.js,index.wxml,parts/handover.js,parts/handover-view.js,parts/overlay.wxss}`（常驻入口 + 行内徽标 + 首屏自动拉取）、`pages/partner/pick-list/{index.wxml,index.wxss,parts/pick-view.js}`（锚码同域 + 闭合容器 + 件行从属线）、`pkg-partner/pages/{stats（双口径指标 + 转派卡）,order-detail/parts/order-view.js（地址字母）,stats/parts/{view-model,daily-report}.js}`、`pkg-customer/pages/order-create/parts/delivery.js`（本人宿舍展示补字母）；S2 `tools/{selftest-order,selftest-order-workbench,selftest-pick-list,selftest-partner-customers,selftest-partner-stats,selftest-transfer}.js` 与 `tools/lib/*` 断言回写、`tools/check-docs.js`（`D_MAX` 92→96）；S6 文档（CONTRACT/DATA_MODEL/ARCHITECTURE/UX×2/QA/RUNBOOK/CHANGELOG/STATE）。
- **D101 改动文件（2026-11-24，有截图即可下单：站点/取件码/运单尾号可留空、兼职审核按截图补全；零新增页面/集合/索引）**：S8 `cloudfunctions/api/handlers/order/{_parcels-input.js（`images.length>0` 放宽站点/码/尾号必填，无截图手填保持原严格文案）, _parcel.js（注释口径）}`；S2 `pkg-customer/pages/order-create/{index.js（goStep2Next/submitFingerprint 用截图快照，页面仍只转发）, index.wxml（Step1/Step2 提示、缺站点/缺码灰字、Step4 摘要）, index.wxss（`.shot-tip`）, parts/{model.js（`canSubmit` 增 `options.allowIncomplete`）, submit.js（截图快照进指纹/载荷）, files-flow.js（`imageSnapshotOf`/`imagesFromFiles`）, recognize-aggregate.js（失败分支保留 `perImage`）}`；S2 判据 `tools/{selftest-order（M 组 8 条）,selftest-order-flow（T 组 14 条）}` + `tools/check-docs.js`（`D_MAX` 96→97）；S6 文档（CONTRACT/DECISIONS/DATA_MODEL/UX_CUSTOMER/QA/ARCHITECTURE/CHANGELOG/STATE）。
- **D92 改动文件（2026-11-18，审核域：订单级两级状态 + 件数增删；零新增集合/索引/页面/事件类型）**：S1 `shared/order-state.js`（`REVIEW_STATUS/REVIEW_STATUS_TEXT` 单源 + 3 条 `to:'SAME'` 规则，事件复用 `ORDER_CORRECTED`；`shared/enums.js` 已顶 500 行门禁**不再加枚举**）+ `shared/actions.js`（+3 写动作）；S0 `api/modules/order.js`（+3 方法）；S8 `cloudfunctions/api/handlers/order/{_review.js（新）,reviewMark.js（新）,reviewReopen.js（新）,reviewParcels.js（新）,index.js,_create.js（建单写 review 初值）,_dto.js（兼职侧 review 投影）}`；S4 `pkg-partner/pages/review/{index.js,index.wxml,parts/review-model.js}`；S2 `tools/selftest-order.js`（J 组 13 条）、`tools/selftest-review.js`（+7）、`tools/selftest-order-partner-cases.js`（行 DTO 白名单 +`review`）；文档回写 CONTRACT §5.3/§13、DATA_MODEL §2.5/§7、ENGINEERING §7.5（M42）、UX_PARTNER §3.13、QA §AL17、`STATE`/`CHANGELOG`。
- **D91 改动文件（2026-11-17，送达自动完成 22:30 + 该时刻及之后送达即完成 + 读路径兜底；零新增页面/集合/索引/触发器）**：S1 `shared/auto-complete.js`（**新**：`cutoffOf`/`isDue`，零 require、UTC+8 显式换算）+ `config/defaults.js`（`autoCompleteAt` 默认改 `22:30`，副本由 sync 生成）+ `tools/sync-cloud-shared.js`（两套清单 +`auto-complete.js`）；S8 `cloudfunctions/cleanup/sweeps/{_util.js,orders.js}`（cutoff 公式改为委托共享件，禁止本地重算）、`cloudfunctions/api/handlers/order/{_auto-complete.js（新）,markDelivered.js,get.js,listCustomer.js,listPartner.js}`（**送达即完成**＝同一事务内条件更新 + `AUTO_COMPLETED`；**读路径兜底**＝`order.get`/`listPartner`/`listCustomer` 对已过该单日结时刻的 `DELIVERED` 单「读到即补完成」，单次读 ≤5 单）；S0/S4 文案：`pkg-customer/parts/status-view.js`、`pkg-partner/pages/order-detail/parts/delivery-panel.js`、`pkg-partner/pages/create-on-behalf/parts/result-model.js`、`pages/partner/workbench/parts/batch-view.js`（统一「该时刻前送达的当天完成；该时刻及之后送达的送达即完成」）；S2 `tools/lib/cleanup-auto-complete-cases.js`（22:30 全量改判 + 判据单源断言 36→37）、`tools/selftest-order-partner.js`（新增 J1~J11，170→182）、`tools/lib/order-day-cases.js`（读路径兜底 +1 断言）、`tools/lib/{cloud-config-clock,order-workbench,admin-config-clock}-cases.js`、`tools/selftest-{state,order-workbench,order-detail-partner,partner-pages,cleanup}.js`、`tools/check-docs.js`（`D_MAX` 89→91）；S6 文档（CONTRACT/DATA_MODEL/ENGINEERING/ARCHITECTURE/UX×3/QA/RUNBOOK/DECISIONS/CHANGELOG/STATE）；**`cloudfunctions/*/shared/auto-complete.js` 由 `node tools/sync-cloud-shared.js` 生成，不得手写**。
- **D97~D100 改动文件（2026-11-23，送达图片 / 取件截图 / 已转出并入 / 订单卡统一；新增 1 个排序纯件，零新增页面/组件/集合/索引/action）**：S1 `shared/enums.js`（`UPLOAD_PURPOSE` +`PROOF`）；S8 `cloudfunctions/api/handlers/upload/{prepare,_common}.js`（`proofs/{ticket}/image.jpg` 路径、校验与用途闸）、`handlers/order/{markDelivered,markPicked,unmarkPicked,unmarkDelivered,imageUrl,_proof.js（新：票据消费/DTO 摘要/清理引用）,_list-merged.js（新：D99 已转出并入）,listPartner,_list-handover,_dto,_dto-fields}.js`；S4 `utils/order-sort.js`（新）、`pages/partner/workbench/**`、`pages/partner/pick-list/**`、`pkg-partner/pages/order-detail/**`；S3 `pkg-customer/pages/order-detail/**`（查看送达/取件照片）；S2 `tools/selftest-{order,order-partner,order-workbench,pick-list,order-detail-partner,order-customer,cleanup,cloud}.js` 与 `tools/lib/*`；S6 文档。**照片字段落 `orders`，不新增集合；共享件副本由 `node tools/sync-cloud-shared.js` 生成**。

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
| `api/modules/partner.js` | `activate({invitationCode,displayName,avatarTicket})`（**D59：SUB 码激活由服务端写 `parentPartnerId/teamJoinedAt`，客户端零变化**）、`saveProfile`、`saveServiceConfig`、`getPublic({partnerNo})`、`listBindings`、`getCustomer({bindingId})`（批 7 只读：档案 + 解绑资格，参数一律 `bindingId`）、`stats({range?'today'|'week'|'month'})`（批 7 只读：单量统计，服务端聚合、排除测试数据）、`unbindCustomer({bindingId,reason,note})`、`saveCustomerNote({bindingId,note})`、**`createSubInvites({count,validity,note?})`（D59，写动作）、`revokeSubInvite({batchId})`（D59，**批次级作废**）、`listSubMembers()`（读，`retry:true`）、`removeSubMember({partnerNo})`（写动作）** |
| `api/modules/bind.js` | `create({partnerNo})`、`release({reason,note})`、`getCurrent()` |
| `api/modules/order.js` | `create(payload, opts?)`（**v1.0 单入口**：`{parcels[], images[], tickets?[], serviceCode, appoint, note, delivery?, guest?/bindingId?, manualEntry?, clientRequestId}`；满足合并窗口时服务端追加到同单）、`get`、`listCustomer`、`listPartner`（**D58：`view='transfer'` 与 `workbench/day/history/customer` 并列，顶层多 `transferPending`**）、`accept`、`reject`、`markPicked`、`unmarkPicked`、`markDelivered`、`unmarkDelivered`、`reportException`、`resolveException`、`cancel`、**`requestTransfer({orderNo,toPartnerNo})`、`acceptTransfer({orderNo})`、`declineTransfer({orderNo})`、`cancelTransfer({orderNo})`（D58 写动作，走统一 `call` 包络）**、`confirmDelivery`、`correct`（v1.0 带 `itemIndex` 逐包裹）、`undo`、`deleteRecord`、`imageUrl`（v1.0 `{orderNo,index}` 取 `images[index]`；写动作 `opts.expectedVersion` 透传乐观锁，见 §3.1）。**`createBatch` 已随 v1.0 移除**（一图多码并入 `create`） |
| `api/modules/message.js` | `send`、`list`、`markRead` |
| `api/modules/upload.js` | `prepare({purpose})`、`cancel({uploadTicketId})` |
| `api/modules/config.js` | `getPublic(force?)`（5 分钟缓存）、`prime(configPublic)`（**启动预热**：bootstrap 已回的公开子集灌入同一缓存，本次会话首次 `getPublic` 零云调用，TTL 语义不变）、`getCachedPublic()`、`clearCache()` |
| `api/modules/ai.js` | `parseParcel(payload)`（仅识别失败兜底，不自动重试） |
| `api/modules/admin.js` | `createInvites`、`revokeInvite`、`listInvites`、`listCustomers`、`getCustomer`、`listPartners`、`setPartnerStatus`、`setCustomerStatus`（**D68**：顾客停用/恢复）、`listOrders`、`getOrder`、`listAudit`、`updateConfig`、`stats`、`viewAsStart`、`viewAsEnd`、`createTestAccount`、`listTestAccounts`、`deleteTestAccount`、`purgeTestData`、`listRecognitionFailures`、`getRecognitionFailure`、`fixRecognitionFailure`、`ignoreRecognitionFailure` |

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
  // D68：accountStatus: 'ACTIVE'|'SUSPENDED'|'DEACTIVATED'（来自 user.bootstrap.status；launch 据此渲染专用状态页）
  // D69：loggedOut 不进 store（本机标记在 utils/storage；store.reset() 即清内存身份）
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
- **D58/D59 不进全局 store 快照（v1.10）**：转派待接收角标 `transferPending` 由工作台 `order.listPartner` 响应顶层加带（**`view='workbench'`/`'day'` 才加带**；`view='transfer'` 自带=本次结果条数；`history`/`customer` 不带）驱动、页面自管，**不写入 `store.badges`**（避免 30s 轮询额外扇出）；团队页数据直读 `partner.listSubMembers`（主兼职全队 / 子队员摘要，响应同形状），`store` **不新增 `team` 字段**（可选快照不实现）。

### 3.5 页面与组件约定

- 页面 `.js` 只做：取参 → 调 `api/` → `setData` → 事件转发。禁止：`wx.cloud.*`、七状态字符串字面量、编号/roomTag 生成或 `random`、拼状态文案、直接读集合名/action 字符串。
- 每个业务页（主包 9 页：5 真实 tab + `customer/pickcodes` / `partner/pick-list` 两个伪 tab + `launch`/`role`；`pkg-customer` 5 页 + `pkg-partner` **9 页（D59 `team/index`；2026-11-08 新增 `review/index`；`pick-list` 迁主包）** + `pkg-admin` 11 页；**全仓 34 页**）`index.wxml` 根节点第一个子节点必须是 `<switch-bar />`；`pkg-admin` 页面不引用 `switch-bar`/`test-badge`。**D64（2026-11-02）**：`pkg-customer/pages/pickup-list/index`（D26/D57）迁主包为 `pages/customer/pickcodes/index`——只保留「我的取件码（本机）」区（D57 边界不变：只存本机/上传零外呼/上限 50/去重/READONLY 拒写），**删除 D26 订单区**（订单取件码仍在订单详情逐件展示）；该页为**伪 tab**：底部栏视觉由共用组件 `components/tab-bar-view` 提供、页面内自绘并 `reLaunch` 进入，`app.json` tabBar.list 仍 5 项；本页不挂分享。底部安全区类：tab 页（含伪 tab 页）根节点叠加 `page-body--tab`，有底部固定条的页面叠加 `page-body--bar`（D65，token 定义见 `app.wxss`）。**v1.8 批 21（D57）**：本机清单——纯件 `parts/local-view.js`（行/汇总/只读判断，零 wx）+ 页面零件 `parts/local-ocr.js`（`wx.chooseMedia` 选图 → 端侧 OCR → 文本；零上传零外呼）；解析纯件 `utils/recognize/local-codes.js`（`parseCodeText`/`mergeEntries`，零 wx）；本地持久化只经 `utils/storage` 的 `loadLocalCodes/addLocalCodes/removeLocalCode/setLocalCodeChecked/clearLocalCodes`（键 `ex_college_v4.pickcodes`，D57 唯一 L3 本机例外）；端侧 OCR 平台适配器抽到 `utils/ocr/wx-platform.js`（`hasVision/imageInfo/frameSizeOf/framePlanOf/canvasFrame/runVision/ocrDeps/VISION_MAX_EDGE`），下单页 `parts/ocr-flow.js` 改为 require 该模块（行为等价，原有导出名保留）。**v1.4 批 17 新增** `pages/partner/pick-list/index`（D46 独立楼层配送清单：苑→栋→楼层分组展示已取件待送达单，纯件在 `pages/partner/pick-list/parts/view-model.js`，分页/分片 ≤20 行、不做定时轮询、复用工作台批量送达纯件，无服务端改动；**D55（批 20）升级双阶段**：待取件（ACCEPTED，按站点 P1~P8，只读可复制）/待送达（PICKED，原楼层分组），纯件拆为 `pages/partner/pick-list/parts/pick-view.js`、`parts/stage-flows.js`）。
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
| `image-picker` | `maxCount`（默认 1；**WXML 绑定按 kebab-case 写 `max-count`**，TD-069）、`purpose`（`TICKET`/`AVATAR`/**`PROOF`（D97/D98，现场照片）**） | `change`（`detail.files`） |
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

- `reason` 枚举：`VIEW_CONTEXT`（切换会话优先）→ `DEVELOPER` → `NO_ROLE` → `CHOOSE_ROLE`（双角色且无 `activeRole`，回 `role` 由用户选择；**D86 起服务端按 `preferredRole`/默认顾客给出 `activeRole`，正常链路不再进入该分支，仅保留兜底**）→ `CUSTOMER_PROFILE` / `CUSTOMER_READY` / `PARTNER_PROFILE` / `PARTNER_INACTIVE` / `PARTNER_ACTIVE`（单业务角色直进该角色）。
- `config/route.js` 导出（纯函数、零 `wx`/零 storage）：`resolveLaunchRole`、`suggestedRoleOf`（`role` 页「上次使用」建议）、`roleOfDecision`（进入角色后写 `lastRole`，只经 `utils/storage` 白名单键）、`workspaceHomeOf`（**D86**：工作区不匹配时回当前工作区首页，`null/未知`才回 `role`）、`decideLaunchRoute`、`isRolePageAllowed`；**`roles`/`lastRole` 不改变 snapshot 形状、不进 URL**。
- **D86 工作区偏好**：`user.bootstrap` 可选 `preferredRole`（本机 `lastRole`，必须属于 `users.roles`）；服务端据此返回 `activeRole` 与对应 `binding/me` 投影，双角色无偏好默认顾客；客户端 `utils/workspace.switchTo(role)` = 目标水合 → `reLaunch` 目标首页 → 成功后写 `lastRole`，**不经过角色页**。

## 4. 云函数冻结接口

### 4.1 入口、路由与中间件

- `index.js`：唯一 `require('wx-server-sdk')` 的文件。`exports.main = async (event, context) => { cloud.init({env}); const wx = cloud.getWXContext(); return invoke(event, { db: cloud.database(), cloud, env: process.env, openid: wx.OPENID, requestId: event && event.requestId, now: Date.now }); }`。
- `app.js`：`invoke(event, deps)` → 解包 `{action, data, clientRequestId, expectedVersion, viewTicket}` → `router.getHandler(action)` **按域懒加载**取 handler（未登记/非 client 可见一律 `FORBIDDEN`）→ 中间件链 `auth → switch-session → validate → ratelimit → idempotency → audit` → handler → 统一包络。
- `router.js`：静态域清单 `DOMAIN_NAMES`（十一个域：`user customer partner bind order message upload config admin ai health`）+ `getHandler(action)` 按 action 前缀（`order.accept` → `order`）**只 require 首用域**，模块导出形状仍为 `{ actions: { 'user.bootstrap': fn, ... } }`；域首次加载时校验「导出集 = shared/actions 集」并逐个断言是函数（该域 fail-fast 保留）。全量 `createRouter()/getRouter()` 仅工具/自检使用，不在请求热路径。
  - **性能口径（P0-5）**：首请求不再一次性加载 11 域；未用域的注册错配由 `tools/check.js` #13 构建期静态判据兜住（补偿判据：11 域覆盖全部 client/放行 internal 动作前缀 + 每域导出集双向相等 + 热路径必须走 `getHandler`）。**性能落差登记**：旧实现「缺注册/多注册」在首请求即抛错，现改为「静态构建期全量校验 + 首用域运行期校验」，未用域的手写错误要等首次调用该动作（或跑 check/selftest 全量）才暴露。
- handler 签名：`async (ctx, payload) => data`（返回对象进 `data`；抛 `AppError` 走失败包络）。`ctx = { dao, ids, now, env, cloud, openid, identity, requestId, clientRequestId, expectedVersion, config }`；`identity = { actorOpenid, effectiveOpenid, role, isTestAccount, viewMode, viewTicketId, developerNo }`。
  - **双角色口径（Lead 冻结）**：服务端权限判定只看"`users.roles` 是否包含该动作所需业务角色"（customer.*/bind.create 需 CUSTOMER；partner.*/order.listPartner/兼职统计需 PARTNER），**不依赖客户端 activeRole**；同一 openid 同时具备 CUSTOMER+PARTNER 时两类动作都允许，`activeRole` 仅是客户端展示/导航状态（不落库、不作鉴权）。`identity.role` 按动作域解析，解析不出所需角色 → `FORBIDDEN`。**D86 补充**：`preferredRole` 只影响 `bootstrap` 返回的展示投影（`activeRole/binding/me`），**不进入任何鉴权判定**；双角色默认顾客、单角色直进、切换会话忽略偏好。
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
| `shared/order-view.js` | 订单视图模型：`bucketOf`（状态桶，生产消费点 = `pages/partner/workbench/parts/{group-view,day-view,order-row}.js`）+ counts 六项键名/模板 + 状态文案查询；**四档动线排序生产实现 = `pages/partner/workbench/parts/group-view.js sortRowsForRoute` + `parts/parcel-view.js tierOfPieces`（吃服务端 DTO；**D62 起按「本站件」定档**，跨站点单在每件所属站点组各出现一次）；旧单件排序/文案簇生产 0 引用（`sortByPickupRoute` 等，其中 5 项登记 `tools/dead-export-baseline.json` 分类 `test-only`），单源收敛见 TD-082** |
| `utils/ids.js` | 编号归一/parse/display（**无生成、无 random**） |
| `utils/room-tag.js` | `toTag/tagRank/formatDormTag/isValidTag/compareByDormTag`（大写 A…Z/AA…，禁字符串排序） |
| `shared/auto-complete.js` | 送达单自动完成时刻判据（D91）：`cutoffOf(deliveredAtMs, clockText)` / `isDue(nowMs, deliveredAtMs, clockText)`，UTC+8 显式偏移换算、零 require；cleanup 日结批与 api「送达即完成/读路径补完成」共用唯一公式（时刻文本归一仍由调用方走 `config/defaults.normalizeClockText`） |
| `config/defaults.js`（同步为 `cloudfunctions/*/shared/defaults.js`） | 云端种子与配置校验的唯一默认值来源；`tools/sync-cloud-shared.js` 的第 18 个源（`shared/**` 15 件 + `ids.js` + `room-tag.js` + `defaults.js`），hash 门禁 `tools/check.js` #17 覆盖该副本 |

**批 25 共享件变更（D61 件级取件，无新增共享文件）**：`shared/enums.js` 的 `ORDER_EVENTS` 增至 **19 种**（新增 `PARCEL_PICKED`/`PARCEL_PICKED_REVERTED`）；`shared/order-state.js` 的 `order.unmarkPicked` 允许起始状态增 `ACCEPTED`（仅逐件撤销；整单仍仅 `PICKED`），`order.markPicked` 保持 `ACCEPTED` 起。两文件均由 `node tools/sync-cloud-shared.js` 生成 `cloudfunctions/{api,cleanup}/shared/**` 副本（hash 门禁 #17 覆盖）；事件人话映射由客户端 S3 `pkg-customer/parts/status-view.js` 与 S4 `pkg-partner/pages/order-detail/parts/event-view.js` 各自补齐。

**批 26/27 共享件变更（D58/D59，v1.10；无新增共享文件）**：`shared/enums.js` 的 `ORDER_EVENTS` 19→**24 种**（+`TRANSFER_REQUESTED/ACCEPTED/DECLINED/CANCELLED/EXPIRED`），新增 `TRANSFER_STATUS`、`TRANSFER_STATUS_TEXT`、`TRANSFER_RESOLVE_REASON`、`MESSAGE_HIDDEN_EVENT_TYPES`、`INVITATION_KIND`；`shared/actions.js` `CLIENT_RULES` +8 条（`order.{requestTransfer,acceptTransfer,declineTransfer,cancelTransfer}` 写、`partner.{createSubInvites,revokeSubInvite,removeSubMember}` 写 + `partner.listSubMembers` 读）；`shared/order-state.js` `ACTION_RULES` +4 条 `{from:['ACCEPTED'], to:'SAME', event:'TRANSFER_*', roles:[PARTNER], changesStatus:false}`（引擎零改动，沿用既有 `to:'SAME'` 通路）；`shared/validate.js` +`validateTeamNote`（≤50）与 `validity` 枚举（`24H/72H/7D`）；`config/defaults.js` +`transferTtlMinutes/transferRate/teamMaxMembers/subInviteRate`（出厂默认，**不入公开子集、不改 `admin.updateConfig` 白名单**）。以上均由 `node tools/sync-cloud-shared.js` 生成 `cloudfunctions/{api,cleanup}/shared/**` 副本（hash 门禁 #17 覆盖）；**`shared/collections.js`/`error-codes.js`/`error-copy.js`/`audit-actions.js` 零改动**（14 集合 / 13 错误码 / 16 审计枚举不变；D58/D59 不新增审计枚举）。

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
- **34 个页面四件套齐全且与 `app.json` 双向一致（主包 9 + 3 分包 25：`pkg-customer` 5 / `pkg-partner` 9（含 D59 `pages/team/index`、2026-11-08 `pages/review/index`）/ `pkg-admin` 11；含两个伪 tab：`pages/customer/pickcodes/index`（D64 由 `pkg-customer/pages/pickup-list` 迁入）与 `pages/partner/pick-list/index`（2026-11-08 由 `pkg-partner/pages/pick-list` 迁入））；14 集合注册表、13 错误码、action 注册表双向一致；selftest 套件 **38**（含批 26 新增 `selftest-transfer`/`selftest-team`），`tools/check.js` 判据 **39 条**（批 24 起，本批不新增判据号）。
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
