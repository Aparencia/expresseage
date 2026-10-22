> 本条由 AI 生成（代码审查）

# 2026-10-22 · B2 前端兼职 + 后台侧 代码审查 part

- 审查对象：HEAD `9031d14cfc88b0cd8b03527da00ccc1f70a3e635`（全量新增基线 = 空树 `4b825dc642cb6eb9a060e54bf8d69288fbee4904`）
- 审查人：review-frontend-partner（阶段 2 · 标准轴 B2）
- 执行手册：`docs/reviews/_parts/_REVIEW_BRIEF.md`；状态源：`STATE.md`；口径源：`docs/V4_CONTRACT.md` + 三份 UX + `docs/V4_DATA_MODEL.md` + `docs/ARCHITECTURE.md` + `docs/V4_ENGINEERING.md`
- 唯一写 = 本文件；未改任何代码/配置/测试，未执行 git 写操作，未运行 `check.ps1`/`gate.ps1`/`selftest.js`，未派子代理。

---

## 0. 派单输入单

- **DESCRIPTION**：审查 B2 前端兼职+后台侧（`pages/partner/**` + `pkg-partner/**` + `pkg-admin/**`），七维 + 条件维 8/9/11，产出本 part 文件。
- **PLAN_OR_REQUIREMENTS**：`docs/V4_CONTRACT.md`（唯一口径）+ `docs/V4_DATA_MODEL.md` + `docs/V4_UX_PARTNER.md` + `docs/V4_UX_DEVELOPER.md` + `docs/ARCHITECTURE.md`（分层/冻结接口）+ `docs/V4_ENGINEERING.md`（工程/门禁/代码硬标准）。
- **BASE_SHA**（全量新增等价基线）：`4b825dc642cb6eb9a060e54bf8d69288fbee4904`
- **HEAD_SHA**：`9031d14cfc88b0cd8b03527da00ccc1f70a3e635`
- **范围**：
  - `pages/partner/**`：`workbench`（1 页 + 13 个 parts 纯件）、`customers`（1 页 + `parts/list-model.js`）；
  - `pkg-partner/**`：`activate`、`order-detail`（含 10 个 parts）、`create-on-behalf`（含 `form-model.js`/`result-model.js`）、`customer-detail`（含 parts）、`service-settings`、`stats`（含 parts）、`messages`（含 parts），共 7 页；
  - `pkg-admin/**`：11 页 + `common/{constants,copy,feedback,format}.js` + 10 个 `parts/view-model.js`；
  - 直接关联只读：`app.json`、`custom-tab-bar/index.js`、`api/modules/*`、`api/client.js`、`api/mode-guard.js`、`shared/{actions,enums,order-state,order-view,stations,format,error-copy}.js`、相关云端 handler（仅用于契约对照，不展开）。

## 1. 开工回执（九项）

### 1.1 人话复述与落点
本 part 审「兼职端页面 + 开发者后台页面」这两坨前端：把 app.json 声明 ↔ 入口可达 ↔ handler 链到 `api/` 与云函数 action 的三层链路逐页走通，再逐页核对页面层是否零业务判据、动作是否只消费服务端、切换会话（READONLY/TEST_WRITE）是否前端口径与视觉都到位、危险动作是否二次确认、定时器/订阅是否清理、后台五态/权限/脱敏是否齐全。产物 = 本文件；下一步 = Lead 按 `文件:行 + 一句话事实` 去重后汇总裁决。

### 1.2 假设清单
1. 假设 Lead 已实跑门禁且读数可引用（简报 §0：`check.js` 31/31 PASS、`check-docs` 10/10、零金额 0 命中、node v24.21.0）；若错，则本文件"门禁已覆盖/通过"类结论失效，仅保留人工审读结论。
2. 假设 `pages/profile/**`、`components/**`、`utils/**`、`api/**`、`shared/**`、顾客侧页面归 B1/S0，我只审"我的页 → 兼职分包"的入口可达与只读引用；若错，`share-card.js`/`profile` 相关结论需移交 B1。
3. 假设云端 handler 契约实现与 `docs/V4_DATA_MODEL.md` §7.3/§7.4/§7.5/§7.6 及 `STATE.md` 批 6~8 快照一致（我只读必要 handler 做契约对照，未逐行审云端）；若错，R-B2-04/05/09 中"服务端会拒"的判定需 A 轴复核。
4. 假设门禁 #21 的扫描口径（页面脚本零七状态字面量；parts 允许状态→文案映射）即 Lead 认可口径；若错，`pages/partner/workbench/parts/*` 引用 `shared/enums` 常量的写法需要改判。
5. 假设"建议色/严重级"只给建议（简报 §3.7：审查者只给建议色，裁决是人）；若 Lead 采用不同聚合口径，以 Lead 为准。

### 1.3 澄清问题
- 本仓无 `docs/registry/APIS.md`、无 `registry/DATA_DICT.md` → 按简报 §1 写 **N/A + 原因**（本仓接口契约唯一源 = `docs/V4_DATA_MODEL.md` §7；action 注册表 = `shared/actions.js`；错误码 = `shared/error-codes.js`）。
- 切换会话"隐藏分享"的可实现边界：小程序右上角原生转发菜单只能通过 `wx.hideShareMenu()` 关闭；本 part 按"页面不得构造可外发他人信息的卡片 + 不应提供分享入口"判定（见 R-B2-01），不把平台限制当缺陷。
- 复核页/后台页是否允许展示服务端已脱敏的 `displayName`：按 UX_DEVELOPER §5.2"昵称由服务端 DTO 脱敏"判定，前端原样展示脱敏值是正确做法（见通过项）。

### 1.4 锚点校验
```powershell
Select-String -Path STATE.md -Pattern '起点锚点'   # 空输出（与简报 §0 一致）
```
→ 空输出；按简报 §0 以 HEAD 全量新增为基线，不追问锚点。

### 1.5 diff 读取确认（全量新增基线）
- **已读范围**：
  - 全读：`pages/partner/workbench/index.js` + parts `action-flow / batch-view / filter-view / group-view / history-view / load-view / page-actions / row-actions / selection-flow / undo-view`；`pages/partner/customers/index.js` + `index.wxml` + `parts/list-model.js`；`pkg-partner/pages/order-detail/index.js` + parts `actions / view-model / order-view`；`pkg-partner/pages/create-on-behalf/index.js` + `parts/form-model.js`（主体）；`pkg-partner/pages/stats/index.js` + `index.wxml`；`pkg-admin/pages/{overview,account-switch,config,recognition-review}/index.js` + `overview/account-switch/config/recognition-review` 的 `parts/view-model.js`（或对应部分）；`pkg-admin/common/{constants,copy,feedback,format}.js`。
  - 机械扫描（全目录 126 文件）：页面层 `wx.cloud.*`/action 字符串/集合名/七状态字面量/`Math.random`/storage 扫描；`setInterval/setTimeout` 与清理点；`share|clipboard|preview|console|openid|avatar` 面；`catch(()=>{})` 面；`_old|_legacy|_v2|Deprecated|暂时保留|废弃|TO\x44O[:：]\s*(删|remove|delete)` 面；四件套；模块方法交叉校验；入口可达性。
  - 证据脚本（本次实跑，退出码 0；下称 `EV#`，结果摘要见各问题"证据"栏）：
    - `EV1` 分享：`Select-String -Path pages\partner\workbench\index.js,pages\partner\customers\index.js,pages\profile\parts\share-card.js -Pattern 'onShareAppMessage|viewSession|path: route.ROLE_PAGE'`
    - `EV2` 设备时钟：`Select-String -Path pkg-partner\pages\order-detail\index.js,pages\partner\workbench\parts\page-actions.js,pages\partner\workbench\index.js,pages\partner\workbench\parts\history-view.js,pkg-admin\pages\recognition-review\index.js,pkg-partner\pages\stats\index.js -Pattern 'Date\.now\(\)|serverNow'`
    - `EV3` 补码面板：`Select-String -Path pages\partner\workbench\parts\row-actions.js,pages\partner\workbench\index.wxml -Pattern "panel: 'code'|取件码（必填|panel.type === 'code'"`
    - `EV4` 服务端字段闸：`Select-String -Path cloudfunctions\api\handlers\order\correct.js -Pattern 'PICKED_ALLOWED_FIELDS|illegal'`
    - `EV5` 批量改站点：`Select-String -Path pages\partner\workbench\parts\batch-view.js,cloudfunctions\api\handlers\order\_dto.js -Pattern "key: 'correct'|eligibleRows|pushAction\(actions, 'correct'\)"`
    - `EV6` isGuest：`Select-String -Path pkg-partner\pages\order-detail\index.js,pkg-partner\pages\order-detail\parts\view-model.js,pkg-partner\pages\order-detail\index.wxml -Pattern 'isGuest'`
    - `EV7` 留言空 catch：`Select-String -Path pkg-partner\pages\order-detail\index.js -Pattern 'loadMessages|messages: \[\]'`
    - `EV8` 单件确认：`Select-String -Path pages\partner\workbench\parts\page-actions.js,pages\partner\workbench\parts\row-actions.js,pages\partner\workbench\index.wxml,pkg-partner\pages\order-detail\index.js -Pattern "kind === 'write'|panel: 'deliver'|panel: 'reason'|onPanelSubmit|保存|wx.showModal\(\{"`
    - `EV9` AI 入参：`Select-String -Path pkg-partner\pages\create-on-behalf\index.js,pkg-partner\pages\create-on-behalf\index.wxml -Pattern "ocrTextMasked|onRecognizeTap|识别失败兜底"`
    - `EV10` 预置绑定：`Select-String -Path pkg-partner\pages\create-on-behalf\index.js,pkg-partner\pages\create-on-behalf\parts\form-model.js -Pattern 'applyPresetBinding|customerMode: bindingOptions'`
    - `EV11` 预约：`Select-String -Path pkg-partner\pages\create-on-behalf\parts\form-model.js,cloudfunctions\api\handlers\order\_parcel.js -Pattern 'startHour|startAt < nowMs'`
    - `EV12` readRetry：`Select-String -Path docs\ARCHITECTURE.md,api\client.js -Pattern 'readRetry|options\.retry|isRetryAction'`
    - `EV13` 批量重试：`Select-String -Path pages\partner\workbench\parts\batch-view.js,pages\partner\workbench\parts\page-actions.js -Pattern '沿用同一 batchActionId|client.createRequestId\(\)'`
    - `EV14` 配置键绕行：`Select-String -Path pkg-admin\common\constants.js,pkg-admin\pages\config\parts\view-model.js,tools\check.js -Pattern 'CONFIG_TTL_KEY|viewTicketTtlMinutes|只拦裸 viewTicket'`
    - `EV15` no-op：`Select-String -Path pages\partner\workbench\parts\row-actions.js -Pattern "replace\('1 ', '1 '\)"`
    - `EV16` 未捕获 rethrow：`Select-String -Path pkg-admin\pages\overview\index.js,pkg-admin\pages\config\index.js -Pattern 'throw err|loadAll\(\);|loadConfig\(\);'`
    - `EV17` FORBIDDEN：`Select-String -Path pkg-admin\pages\account-switch\index.js,pkg-admin\pages\config\index.js,pkg-admin\pages\recognition-review\index.js -Pattern 'feedback.toast\(\(err && err.message\)|feedback.toast\(err && err.message\)'`
    - `EV18` 注释漂移：`Select-String -Path api\modules\partner.js,cloudfunctions\api\handlers\partner\getCustomer.js -Pattern '订单分页|不返回 orders'`
    - `EV19` 分片定时器：`Select-String -Path pages\partner\workbench\index.js -Pattern 'appendChunks|_chunkToken|setTimeout|clearTimeout'`
    - `EV20` 隐藏分享 API：`grep 'hideShareMenu'`（全仓）→ 0 命中
    - `EV21` 模块方法交叉校验（node 脚本）：页面引用的 `orderApi/partnerApi/messageApi/admin/aiApi/configApi/client.*` 方法全部存在 → `OK: all referenced module methods exist`
    - `EV22` 入口可达性（node/PowerShell 脚本）：app.json 30 页逐页找 `'/path'` 引用 → 除 tab 页（由 `custom-tab-bar` 以无前导斜杠 pagePath 承载）与启动入口外全部 ok。
    - `EV23` 四件套：`pages\partner` 2/2、`pkg-partner` 7/7、`pkg-admin` 11/11 页 `index.js/json/wxml/wxss` 齐全。
    - `EV24` `node --check` 抽检 7 个高风险页面 js → 7/7 PASS（exit 0）。
- **未覆盖到的地方**见 §2 覆盖地图 ○。

### 1.6 审查范围声明
只审派单范围及其直接关联调用。范围外发现只记录不展开：R-B2-11（`api/client.js` 冻结接口）、R-B2-17（`api/modules/partner.js` 注释）属 S0/Lead 域，已标注移交；`cloudfunctions/**` 只做契约对照不判 A 轴问题。

### 1.7 旧报告
无（`docs/reviews/` 本轮新建）。→ 旧问题三态 **N/A（无旧报告）**。

### 1.8 引用检查清单原文（执行依据，来源 `_REVIEW_BRIEF.md` §3）
> **七个固定维度**：1 接入性与装配（三层链路：路由/挂载注册、入口可达、handler 绑定；任一层断=P1；前端加查请求/响应结构与 DATA_MODEL §7 契约一致；app.json 页面声明 + router + shared/actions 三处一致）；2 逻辑性（空值/越界/并发重复提交/失败路径不是空 catch/入参校验；多步写事务边界；异步竞态与写接口幂等；时区与日期边界；货币精度=本仓零金额）；3 牵连性（先赋值再搜；被修改符号调用方兼容；被删符号零残留；DATA_MODEL/CHANGELOG/TECH_DEBT/ARCHITECTURE 同步）；4 性能（N+1/无界查询/循环内 IO/大列表重复渲染/同步长任务/无索引 WHERE；资源泄漏=定时器/事件订阅/effect 未清理）；5 冗余死代码（使用次数/复制粘贴改名/永远真或假分支/疑似保留写理由）；6 开发规范（命名/注释 Why/类型安全/函数>50 行、文件>500 行、测试文件>1000；提交信息；ENGINEERING §7 + AGENTS §4 六条硬标准）；7 安全（鉴权/水平越权；注入；XSS；CSRF=N/A；上传；密码=N/A；密钥/日志脱敏/依赖漏洞；AI/agent 面；外部内容与凭据面。安全四条硬规则：①每条给「入口→传播→终点」三处 `文件:行`；②`overall_severity ≤ impact.score`；③验证者身份分离——**本 part 只写"待独立复核"**；④格式缺字段作废）。
> **条件维**：⑧ UI 可访问性（状态齐全/对比度/触摸目标 44px/空态错误态）；⑨ 外部调用（本仓仅服务端 DeepSeek：适配层/超时/降级/重试；**本侧应零外呼**）；⑩ 性能预算（无预算文件 → 按维度 4 六类定性并标注"无预算基线"）；⑪ 数据隐私（D3/D4 字段加密？日志脱敏/用途限定/注销清除；本 side：后台不展示头像/昵称脱敏、openid 零出现、日志脱敏）。
> **气味基线**：长函数（>50/500/1000 行阈值）｜重复代码（同一逻辑第 2 次）｜参数过多（>4 个）｜发散式变化（一文件因多个不相关原因被改）｜霰弹式修改（一改动要动 >3 文件）｜命名不达意（读名字猜不出行为）。
> **严重级**：P0=崩溃/数据丢失/安全漏洞｜P1=核心功能不可用（含装配断链）→二者必须清零；P2=边缘功能报错/体验不佳；P3=拼写/样式/非关键提示；不确定按 P2。**建议色**：🔴 红=P0≥1 或 P1≥1 或取代废弃命中；🟡 黄=P0=P1=0 且有 P2/P3；🟢 绿=P0=P1=0 且旧报告 P0/P1 全部核销（本轮 N/A）。
> **取代与废弃检查（命中即红灯）**：①并行实现未删（旧文件/旧函数/旧分支/旧常量 + STATE 无登记行）；②新增行命中 `_old\b|_legacy|_v2\b|Deprecated|暂时保留|废弃|TO\x44O[:：]\s*(删|remove|delete)` → 必须写保留理由与删除条件。

### 1.9 派单输入单
同 §0（DESCRIPTION / PLAN_OR_REQUIREMENTS / BASE_SHA / HEAD_SHA 已抄录）。

---

## 2. 覆盖地图

图例：✓ 已审（读了实现并核对口径）｜△ 关键面抽查 + 机械扫描｜— N/A（本侧无该口径）｜○ 未审（原因注明）。
"机械扫描"= §1.5 的 EV1~EV24 全目录覆盖（126 文件），不逐格重复。

| 文件（组） | 装配 | 逻辑 | 牵连 | 性能 | 冗余 | 规范 | 安全 | 条件 8/9/11 | 说明 |
| :-- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-- |
| `pages/partner/workbench/index.js` | ✓ | ✓ | ✓ | ✓ | — | ✓ | ✓ | 8✓ 9✓ 11✓ | 页面仅接线；R-B2-01/02/18 |
| `…/workbench/index.wxml` | ✓ | ✓ | — | ✓ | — | ✓ | ✓ | 8✓ | 行/空态/浮层/引导结构已核 |
| `…/workbench/index.json` | ✓ | — | — | — | — | ✓ | — | — | maintenance-mask 页面级注册正确 |
| `…/workbench/index.wxss` | ○ | ○ | — | ○ | — | ○ | — | 8○ | 未逐行读（样式非本轮重点；未见越界用法） |
| `…/workbench/parts/action-flow.js` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | 意图纯件；未知 key 忽略 |
| `…/workbench/parts/batch-view.js` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | R-B2-05/12 |
| `…/workbench/parts/filter-view.js` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | 筛选/空态/多选资格（bucket 单源） |
| `…/workbench/parts/group-view.js` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | 行 DTO/四档排序/行级补丁 |
| `…/workbench/parts/history-view.js` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | 自然日分区；R-B2-02（设备钟） |
| `…/workbench/parts/load-view.js` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | 分页/轮询增量/分片/红点/banner |
| `…/workbench/parts/page-actions.js` | ✓ | ✓ | ✓ | ✓ | ✓ | △ | ✓ | — | R-B2-02/08/18；parts 含 wx 调用（见通过项说明） |
| `…/workbench/parts/row-actions.js` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | R-B2-04/08/14 |
| `…/workbench/parts/selection-flow.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | — | — | 仅供多选；未见越界 |
| `…/workbench/parts/undo-view.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | — | — | 5s 撤销条纯件；reasonOf 依赖文案（气味级） |
| `…/workbench/parts/guide-view.js` | △ | △ | — | — | ✓ | ✓ | — | 8△ | 仅读空态动作/引导状态构造 |
| `…/workbench/parts/maintenance-hook.js` | ○ | ○ | — | — | — | — | — | — | 未读（45 行；维护闸由 R-B2-15/通过项外覆盖不足，如实标 ○） |
| `pages/partner/customers/index.js` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 8✓ 11✓ | 分享已按会收缩紧（对照用） |
| `…/customers/index.wxml` / `parts/list-model.js` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 8✓ | 服务端搜索/游标/分享显隐 |
| `pkg-partner/pages/order-detail/index.js` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 8✓ 9✓ 11✓ | R-B2-02/07 |
| `…/order-detail/index.wxml` | ✓ | ✓ | — | — | — | ✓ | ✓ | 8✓ | 面板/凭证/撤销条结构已核 |
| `…/order-detail/parts/{actions,view-model,order-view}.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | — | — | R-B2-06；服务端 label 单源 |
| `…/order-detail/parts/{correct-panel,delivery-panel,exception-panel,reason-panel,undo,event-view,voucher}.js` | △ | △ | — | — | — | — | — | — | 只经页面调用点与 grep 关键分支核对（提交装配/expectedVersion），未逐行读全部 7 件 |
| `pkg-partner/pages/create-on-behalf/index.js` + `parts/form-model.js` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 8✓ 9✓ 11✓ | R-B2-03/09/10；两路径互斥/幂等键已核 |
| `…/create-on-behalf/parts/result-model.js` / wxml / wxss | △ | — | — | — | — | — | — | — | 结果块/表单模板抽查 |
| `pkg-partner/pages/customer-detail/**` | △ | △ | — | — | — | — | ✓ | 11✓ | 只做关键面（解绑二次确认/只读/备注归属）；R-B2-08 佐证 |
| `pkg-partner/pages/service-settings/**` | △ | △ | — | — | — | — | — | — | 保存/回滚/只读分支抽查（catch 自述失败） |
| `pkg-partner/pages/stats/index.js` + `wxml` + `parts/view-model.js` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | 9✓ 11✓ | 单一来源/完成率 null/不画假柱/服务端校时（标准范式，见通过项） |
| `pkg-partner/pages/stats/parts/daily-report.js` | △ | △ | — | — | — | — | — | 11✓ | 只核日报字段集（无 L3） |
| `pkg-partner/pages/messages/index.js` | △ | △ | — | — | — | — | ✓ | 8△ 11✓ | 只核 30s 轮询清理/已读/红点/角色分流入口；未逐行读渲染件 |
| `pkg-partner/pages/activate/index.js` | △ | △ | — | — | — | — | ✓ | 8△ 11✓ | 只核激活态分流/跳转定时器清理/头像昵称 |
| `pkg-admin/common/constants.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | — | 枚举单源；R-B2-13 |
| `pkg-admin/common/copy.js` | ✓ | ✓ | — | — | ✓ | ✓ | — | 8✓ | 错误文案说真话/不拼错误码 |
| `pkg-admin/common/feedback.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | 8✓ 11✓ | 五态集中出口（FORBIDDEN 清数据+回首页） |
| `pkg-admin/common/format.js` | ✓ | ✓ | — | — | ✓ | ✓ | — | 11✓ | 展示格式化；脱敏由服务端 DTO 完成 |
| `pkg-admin/pages/overview/**` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 8✓ 11✓ | 统计卡/审计/红点；R-B2-15 |
| `pkg-admin/pages/account-switch/**` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 8✓ 11✓ | 两 tab/额度/dryRun/双条件；R-B2-16 |
| `pkg-admin/pages/config/**` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 8✓ | 白名单/范围/维护确认/未保存拦截；R-B2-13/16 |
| `pkg-admin/pages/recognition-review/**` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 8✓ 11✓ | 按单原图/补录/忽略/五态；R-B2-02/16 |
| `pkg-admin/pages/customers|customer-detail|partners|orders|order-detail|invite-codes|messages/**` | △ | △ | — | — | — | △ | △ | 8△ 11✓ | 只做机械扫描 + 关键面抽查（11/11 页四态钩子齐全、危险确认 `feedback.confirm` 命中、无权 `forbidden` 块齐全、分享零入口）；未逐行审，如实标 △ |

---

## 3. 问题清单

> 格式：`编号 | 级别 | 位置 | 描述 | 影响（触发条件）| 修复建议 | 证据`。证据 = §1.5 证据脚本编号 + 命中行；全部命令本次实跑成功、退出码 0（`EV20` 空输出已注明）。

**R-B2-01 | P2（安全/隐私，待独立复核） | pages/partner/workbench/index.js:173-179**
- 描述：工作台 `onShareAppMessage` 无条件构造绑定卡片：只要 `store.partner.partnerNo` 有值，`path` 恒为 `/pages/role/index?bind=<partnerNo>`，没有像客户列表页那样传 `viewSession`。同仓 `pages/partner/customers/index.js:196-201` 与 `pages/profile/parts/share-card.js:22-28` 已经实现"切换会话→回通用分享、不漏 partnerNo"的收紧口径，工作台未复用。
- 影响：READONLY/TEST_WRITE 切换会话下（尤其开发者只读查看真实兼职），页面虽用 `wx:if="{{!sessionView}}"` 隐藏了空态分享按钮（index.wxml:89），但页面级 `onShareAppMessage` 使小程序右上角「转发」菜单仍可用——开发者可把携带**目标兼职编号**的卡片转给第三方，与 UX_PARTNER §6.2/§6.4「两种会话都隐藏分享/转发」、§0 原则 5「头像/昵称/编号不进分享卡片与后台列表」冲突；全仓无任何 `wx.hideShareMenu`（EV20 0 命中）。
- 修复建议：`onShareAppMessage` 改调 `shareCard.buildShareMessage({ isCustomer:false, viewSession:this.data.sessionView, partnerCard:{ partnerNo:this.partnerNo() } })`，并（可选）在 `syncMode` 检测到 `sessionView` 时调用 `wx.hideShareMenu()` 收紧原生菜单；补 `selftest-order-workbench` 断言。
- 安全轴三处证据（入口→传播→终点）：①入口 `pages/partner/workbench/index.js:173`（声明 `onShareAppMessage` 即启用原生转发）②传播 `pages/partner/workbench/index.js:174-178`（无 `viewSession` 守卫、path 直接拼 `partnerNo`）③终点 `pages/profile/parts/share-card.js:22-28`（同仓既有收紧实现，落地页 `/pages/role/index?bind=`）。
- 证据：EV1 → `index.js:173 onShareAppMessage() {`、`customers/index.js:199 viewSession: this.data.session,`、`share-card.js:22 const shareBind = ... viewSession !== true ...`；EV20 → `empty output`（无 `hideShareMenu`）。

**R-B2-02 | P2 | pkg-partner/pages/order-detail/index.js:131,166；pages/partner/workbench/parts/page-actions.js:308,312,325,329；pages/partner/workbench/index.js:32,109,323**
- 描述：多处把**设备时钟** `Date.now()` 直接当作服务端时间基准：详情页装配撤销条 `viewModel.buildView(..., { nowMs: Date.now() })`（:131）与每秒 `undoPart.buildBar(..., Date.now())`（:166），用于判断服务端 5 秒撤销窗；工作台已完结摘要/展开/更早三处 `historyView.*Query(Date.now())` + `historyStateOf(..., Date.now())` 构造 `from/to` 自然日窗口与"今天/昨天"分区。同仓已存在正确范式：`pkg-partner/pages/stats/index.js:66,92` 与 `pages/customer/orders/index.js:56` 用 `store.get('serverTimeSkew')` 校时；本侧未用。
- 影响：设备时间被手动改/漂移（学生机常见）时：①撤销条与服务端 5s 窗口不一致——可能提前消失（用户没机会撤）或显示可撤销但服务端已过窗（点了必失败，UX §4.7 规定"5 秒窗由服务端判定"）；②"已完结 · 今天/昨天"分区与 `from/to` 窗口错位，可能漏单或把旧单显示成今天；③复核页"近 7 天"筛选（recognition-review/index.js:79 同因）窗口偏移。属 UX_PARTNER §0 原则 1「状态与倒计时一律服务端口径」的服务端时间子项。
- 修复建议：抽 `serverNow(skew)`（`pkg-partner/pages/stats/parts/view-model.js:68` 已有同实现）供本侧复用；页面统一传 `nowMs: serverNow(store.get('serverTimeSkew'))`；`history-view.js` 内 `Date.now()` 兜底改为必传参数（缺参时抛/回退 0），纯件由测试锁定。
- 证据：EV2 → `pkg-partner/.../order-detail/index.js:131 nowMs: Date.now()`、`:166 ... Date.now()`、`page-actions.js:308/325 historyView.expandQuery/olderQuery(Date.now())`、`workbench/index.js:32 now = ... : Date.now()`、`:109 naturalDayKeyOf(Date.now())`、`:323 historyView.summaryQuery(Date.now())`；对照 `stats/index.js:66 serverNow(store.get('serverTimeSkew'))`、`:92`。

**R-B2-03 | P2 | pkg-partner/pages/create-on-behalf/parts/form-model.js:113-129**
- 描述：代客下单预约选项恒构造"今天上午/下午/晚上"三个时段，**不过滤已经过去的时段**，且时段绝对时间用设备本地时区/时钟从 `nowMs` 展开（`new Date(base.getFullYear(), …)`）。服务端 `cloudfunctions/api/handlers/order/_parcel.js:109-110` 对 `startAt < nowMs` 或 `endAt <= startAt` 直接 `VALIDATION_FAILED`「预约时段不合法，请选择未来的时间段」。
- 影响：晚上 20:00 打开代客下单，用户可点"今天上午 08:00-12:00"，提交后必被服务端拒（页面 `failureText` 显示真实错误，流程可重选但体验差、且易误判为系统故障）；设备时区非 UTC+8 时 `startAt` 绝对时刻整体偏移，可能"选了上午却被判过去/被记录成错误时段"。
- 修复建议：构造前过滤 `startAt <= serverNow` 的时段；用 `serverNow + UTC+8` 口径展开（与 workbench `naturalDayKeyOf` 同公式），或在 DTO 服务端下发可选时段（更彻底，需契约增量）。
- 证据：EV11 → `form-model.js:119/120/121 三个 startHour`、`:124 new Date(base.getFullYear(), …)`；`_parcel.js:109 if (!startAt || !endAt || startAt < nowMs || endAt <= startAt)`。

**R-B2-04 | P2 | pages/partner/workbench/parts/row-actions.js:172-187,229-255；pages/partner/workbench/index.wxml:191-204**
- 描述：行内补码面板 `openPanel('code', row)` 恒构造取件码字段（:172-187），`validatePanel` 对 `type:'code'` 恒要求"取件码必填"（:229-236），wxml 也恒渲染"取件码（必填）"输入（:191-204）。但服务端 `cloudfunctions/api/handlers/order/correct.js:12,47-51` 对 **PICKED** 状态只允许 `lockerNo/trackingTail`（改 `pickupCode` 抛 `INVALID_TRANSITION`）；同时 `cloudfunctions/api/handlers/order/markPicked.js:17-19` 只对"有取件码或服务类型=代寄（DROP_OFF）"放行取件，因此 **DROP_OFF 代寄单被取件后取件码必为空**，而面板仍要求取件码必填。
- 影响：①PICKED 行 UI 仍允许编辑取件码，客户端校验放行、提交后服务端 100% 拒（"已取件后只允许修改柜号或运单尾号"）——必失败入口；②代寄（DROP_OFF，无需取件码）单取件后，用户想只改柜号/运单尾号（服务端允许）会被前端"取件码必填"拦死，合法操作不可达。UX_PARTNER §3.3/§4.4 明确"PICKED 只允许柜号/运单尾号；DELIVERED 及之后不可补码"。
- 修复建议：由服务端在 `correct` 动作元数据/行 DTO 下发字段能力（如 `correctFields:['lockerNo','trackingTail']`），页面按能力渲染；或后端给 PICKED 行下发更窄的动作键（如 `correctPickupTail`）。前端不应靠猜状态收窄（保持页面层零判据）。补 workbench 断言。
- 证据：EV3 → `row-actions.js:69 panel: 'code'`、`:229 if (panel.type === 'code') {`、`index.wxml:191`、`:193 取件码（必填，最多 40 字符）`；EV4 → `correct.js:12 PICKED_ALLOWED_FIELDS = ['lockerNo','trackingTail']`、`:48-49 illegal → throw`。

**R-B2-05 | P2 | pages/partner/workbench/parts/batch-view.js:37-43,53-56,69**
- 描述：批量动作"改站点"的资格 `eligibleRows('correct', rows)` 只按 `row.actions` 是否含 `correct` 求交集（:49-56），而服务端 PICKED 行**也**下发 `correct`（`_dto.js:280`，但字段能力收窄为柜号/尾号）。批量改站点提交 `patch.stationId` 时，PICKED 行必被 `correct.js:47-51` 拒。
- 影响：勾选含 PICKED 的一批点「改站点」→ 结果弹窗显示"N 单成功、M 单失败：<单号> 已取件后只允许修改柜号或运单尾号"，并且"重试失败项"必然再次失败（不是暂时失败）。违反 UX_PARTNER §4.6（改站点允许状态 `SUBMITTED/ACCEPTED/EXCEPTION`，PICKED 仅柜号/尾号）与"部分失败可重试"的暗示。
- 修复建议：与 R-B2-04 同源修复——服务端在行 DTO 下发 `correctFields`，批量改站点过滤掉不含 `stationId` 能力的行；或服务端为"站点更正"单独下发动作键，前端只按 key 求交集。前端不得按状态字面量判断。
- 证据：EV5 → `batch-view.js:37 key: 'correct'`、`:54 function eligibleRows(key, rows)`（只查 actions）、`:69 const queue = eligibleRows(key, rows)`；`_dto.js:280 pushAction(actions, 'correct')`（PICKED 分支）；EV4 服务端字段闸同上。

**R-B2-06 | P2 | pkg-partner/pages/order-detail/parts/view-model.js:53；pkg-partner/pages/order-detail/index.js:132-145；pkg-partner/pages/order-detail/index.wxml:24**
- 描述：`buildView` 返回顶层 `isGuest`（view-model.js:53，来自 `order-view.buildDetail` 的 `source === PARTNER`），但页面 `applyDetail` 的 `setData` 白名单里**没有** `isGuest`（index.js:132-145），wxml 却用顶层 `{{isGuest}}`（index.wxml:24）决定是否渲染"代客单/顾客未绑定，进度需线下告知"行。
- 影响：`guest` 单（`source='PARTNER'`、无 `counterpart`）详情页永远不渲染"代客单·未绑定"标记行，回落到 `wx:else` 的"顾客编号 —"；UX_PARTNER §3.3/§4.2 要求代客单显示"代客单·未绑定"标记 + 默认头像/标签、并提示线下告知顾客进度。`deliveredChip`/`guestAutoHint` 仍在，故非全丢，但关键身份标识缺失（P2 体验/口径）。
- 修复建议：`applyDetail` 补 `isGuest: view.isGuest`（或 wxml 改读 `order.isGuest`——`order` 已并入 detail）；顺带清理 view-model 未被消费的 `counterpartText/counterpartAvatarFileId/partnerNoText` 输出（冗余）。
- 证据：EV6 → `view-model.js:53 isGuest: detail.isGuest,`；`index.wxml:24 <view wx:if="{{isGuest}}" ...>`；`index.js:132-145` 的 setData 键集无 `isGuest`（EV6 命中仅 view-model/wxml 两处，index.js 无命中）。

**R-B2-07 | P2 | pkg-partner/pages/order-detail/index.js:150-154**
- 描述：留言轮询/首载 `loadMessages()` 的失败路径写成 `.catch(() => this.setData({ messages: [] }))`——空 catch + 清空已加载留言。
- 影响：首屏失败时用户看到"还没有留言"（假真空态）而非错误；轮询一次抖动就把已展示的留言清空，违反 UX 通用态「网络错误保留已加载数据 + 上次成功时间」与工程纪律「失败路径不是空 catch / 不说假话」。也丢失了排障所需错误信息（非日志化）。
- 修复建议：失败时保留旧 `messages`，置 `messageError` + 上次成功时间并在留言区给"重试"；错误对象至少 `console.warn`（脱敏，不含正文）。
- 证据：EV7 → `index.js:150 loadMessages() {`、`:153 .catch(() => this.setData({ messages: [] }));`。

**R-B2-08 | P2 | pages/partner/workbench/parts/row-actions.js:23-29,47-49,72-79；pages/partner/workbench/parts/page-actions.js:108-110；pages/partner/workbench/index.wxml:231-234；pkg-partner/pages/order-detail/index.js:403-432**
- 描述：单件不可逆/跨状态动作缺二次确认：①工作台单件"送达"进 `deliver` 面板，面板"保存"（index.wxml:233）→ `onPanelSubmit` → `kind:'write'` → `executeSingle` 直接发 `order.markDelivered`（page-actions.js:108-110），无"确认已送达？顾客会看到进度到'已送达'"的确认框；②工作台单件"取消订单/拒单"同理（reason 面板保存即写，`row-actions.js:23-29/72-79`）；③详情页取消/拒单 `onReasonSubmit` 直接 `submitWrite`（order-detail/index.js:419-432）也无二次确认。对照：详情页"送达"有 `wx.showModal` 确认（:385-400）；批量路径有 `wx.showModal` 确认（page-actions.js:163-174）。
- 影响：UX_PARTNER §0 原则 4「不可逆/跨状态动作强确认：用"后果句 + 二次确认"」、§3.3「送达…确认"确认已送达？…"」、§4.13「取消…二次确认，顾客看到取消原因」未满足；误点"保存"即把订单推到终态（取消不可恢复）或 DELIVERED（虽有 5s 撤销但依赖 R-B2-02 的时钟问题）。
- 修复建议：面板提交后统一套 `wx.showModal`（文案取 UX 逐字后果句），或至少对 `deliver/cancel/reject` 三个 key 走 `confirmAndRun`；补 selftest 断言"单件三类不可逆动作均先弹确认"。
- 证据：EV8 → `row-actions.js:25 panel: 'reason'`、`:48 panel: 'deliver'`、`:74 panel: 'reason'`；`page-actions.js:108 if (intent.kind === 'write')`；`index.wxml:233 保存`；`order-detail/index.js:387 wx.showModal`（送达有）→ `:405 panel: 'reason'`（取消/拒单无 modal）。

**R-B2-09 | P2 | pkg-partner/pages/create-on-behalf/index.js:272-303,286；index.wxml:127-128**
- 描述：代客下单的"识别失败兜底"按钮调 `aiApi.parseParcel({ ocrTextMasked: '', hintTrackingTail, uploadTicketId, role:'PARTNER' })`——**没有端侧 OCR/规则文本来源**（`pkg-partner` 全目录无 `utils/recognize/**`、`utils/ocr/**` 引用，grep 0 命中），发给云端 AI 的可解析文本为空；失败文案为"识别没完成，可以直接手填"（:297），与 UX §3.4 规定的"已反馈开发者复核"不一致，按钮名"识别失败兜底"也不在 UX 文案集内。
- 影响：该按钮实际不可能产出预填（AI 拿不到可解析文本，必然降级），点按一次就是一次失败兜底调用；按 D16「失败必入队」会向 `recognition_failures` 写入含原图的记录，污染开发者复核页；兼职端"识别预填"能力名存实亡。主流程（手填）可用，故非 P1。UX_PARTNER §3.4 要求"端侧 OCR + 规则解析后仍失败才走 AI 兜底"。
- 修复建议：接入客户侧同口径 `utils/recognize/**` 产生去敏文本后再调 `ai.parseParcel`；若本批不做，隐藏该入口并把"兼职端无 OCR 文本来源"登记 `docs/TECH_DEBT.md`（P1 再实现），同时失败文案改为 UX 逐字"已反馈开发者复核"。
- 证据：EV9 → `index.js:286 ocrTextMasked: '',`、`:272 onRecognizeTap()`、`index.wxml:127 ... '识别失败兜底'`；`grep 'utils/recognize|utils/ocr' pkg-partner` → 0 命中（仅 form-model 的 `applyRecognition` 消费 DTO）。

**R-B2-10 | P2 | pkg-partner/pages/create-on-behalf/index.js:101-112；parts/form-model.js:138,153-157**
- 描述：从客户列表带 `?bindingId=` 进入本页时 `applyPresetBinding` 只在前 50 条绑定选项里找（`BINDING_OPTIONS_LIMIT=50`，index.js:13,78-98）；找不到就**什么都不做**（注释写"找不到不猜，留给用户手选/新顾客"），但初始状态 `customerMode: bindingOptions.length ? 'BOUND' : 'GUEST'`（form-model.js:138）会把页面留在"已绑定"路径且默认选中第 0 位顾客（`currentBinding` 索引默认 0，:153-157）。
- 影响：绑定数 >50 或服务端窗口收窄（TD-049/TD-050 已知降级）时，顾客列表某行的「代客下单」会把页面预置成**另一位顾客**：用户若未逐字核对下拉框就提交，会为错误顾客建单（订单归属不可改，只能取消重下）。与注释"不猜"矛盾。
- 修复建议：预置失败/选项缺失时显式回落 `GUEST` 并提示"未找到该顾客档案，已切换为新顾客"；或按 `bindingId` 单拉 `partner.getCustomer` 补齐选项（服务端已有该能力）；>50 的窗口问题登记/复用 TD-050。
- 证据：EV10 → `index.js:92 applyPresetBinding(textOf(presetBindingId))`、`:101 applyPresetBinding(bindingId) {`；`form-model.js:138 customerMode: bindingOptions.length ? 'BOUND' : 'GUEST',`。

**R-B2-11 | P3（范围外：api/S0，移交） | docs/ARCHITECTURE.md:55 vs api/client.js:155-159**
- 描述：冻结接口 `api/client.js` §3.1 文档写 `opts.readRetry` 默认 `true`（读动作 ≤2 次，300/900ms），实现只认 `opts.retry`（:159 `options.retry === true || (options.retry !== false && isRetryAction(action))`），没有读取 `readRetry`。全仓 grep `readRetry` 仅 ARCHITECTURE 1 处（当前无调用方），行为上读动作仍默认重试 2 次、写动作不重试，故未造成现网错误。
- 影响：页面若按冻结合约传 `{readRetry:false}` 不生效（未来接入会踩）；属文档/实现漂移。
- 修复建议：`api/client.js` 增加 `readRetry` 兼容读取，或经 Lead 授权回写 ARCHITECTURE §3.1（冻结接口变更需单写者）。
- 证据：EV12 → `ARCHITECTURE.md:55 ... opts.readRetry 默认 true ...`；`client.js:62 function isRetryAction(action)`、`:159 const attempts = options.retry === true || ...`。

**R-B2-12 | P3 | pages/partner/workbench/parts/batch-view.js:144-157；page-actions.js:178**
- 描述：`retryPlan` 注释写"沿用同一 batchActionId（同批审计分组）"，但页面 `runBatch` 每次都 `batchActionId: plan.batch ? client.createRequestId() : ''`（page-actions.js:178）重新生成——重试批次拿到新 id，与原批审计分组断开。
- 影响：审计/排障时同一批动作被拆成两个 `batchActionId`（功能可用、订单数据无错）；注释与实现不一致会误导后续维护。
- 修复建议：`runBatch(plan, values, opts)` 支持显式复用 `_lastBatch.plan.batchActionId`（retry 传入），或改注释承认新批 id 并由测试锁定。
- 证据：EV13 → `batch-view.js:144 沿用同一 batchActionId`；`page-actions.js:178 client.createRequestId()`。

**R-B2-13 | P3（开发规范） | pkg-admin/common/constants.js:172-173,177；pkg-admin/pages/config/parts/view-model.js:180-186**
- 描述：把公开配置键拆成 `['view','TicketTtlMinutes'].join('')`，注释称"避免后台页面源码出现票据变量名（门禁 #23 的子串扫描）"。实际门禁 #23 明确放行该公开键：`tools/check.js:634`「只拦裸 viewTicket 字面量；公开配置键 `viewTicketTtlMinutes`/`view_ticket` 合法」（正则 `(?<![A-Za-z0-9_])viewTicket(?![A-Za-z0-9])` 不会命中）。分片拼装纯属无必要绕行，且注释与门禁事实相反（易被后人当成"必须绕"）。
- 影响：不违规、无安全影响；可读性/维护性下降，后续改配置键名时两处联动易漏。
- 修复建议：直接使用 `viewTicketTtlMinutes` 公开键并删除分片注释；若担心未来门禁收紧，改为在常量表集中声明一次（仍可读），不搞运行期拼接。
- 证据：EV14 → `constants.js:173 const CONFIG_TTL_KEY = ['view', 'TicketTtlMinutes'].join('');`、`:177 Number(config && config[CONFIG_TTL_KEY])`；`check.js:634 只拦裸 viewTicket 字面量；公开配置键 viewTicketTtlMinutes / view_ticket 合法`。

**R-B2-14 | P3 | pages/partner/workbench/parts/row-actions.js:330-336**
- 描述：`confirmTextOf` 末行 `return def.confirmText.replace('1 ', '1 ');` 是无效果替换（同串替换），疑似"按单数/数量定制文案"的意图丢失成空操作。
- 影响：无功能影响（单件确认文案本就写死"1 单"），属死代码/误导；若未来批量复用该函数会得到错误文案。
- 修复建议：删除 `.replace(...)`，或实现真实占位替换（如 `{count}`）；同函数加单测。
- 证据：EV15 → `row-actions.js:335 return def.confirmText.replace('1 ', '1 ');`。

**R-B2-15 | P3 | pkg-admin/pages/overview/index.js:31-33,59-62；pkg-admin/pages/config/index.js:28,56-59**
- 描述：首屏加载函数在失败时 `feedback.handleError(...)` 之后又 `throw err`（overview:61、config:58），但 `onLoad` 调用处未 catch（overview:32、config:28），产生未处理的 Promise rejection。
- 影响：错误已上屏（UI 正常），但真机/开发者工具会出现 unhandled rejection 噪音；某些基础库会触发 `onUnhandledRejection`，长期易掩盖真实异常。
- 修复建议：`onLoad` 改 `this.loadAll().catch(function () {})`（与 `onRetry` 同写法），或首屏函数不 rethrow、由调用方决定。
- 证据：EV16 → `overview/index.js:32 this.loadAll();`、`:61 throw err;`；`config/index.js:28 this.loadConfig();`、`:58 throw err;`。

**R-B2-16 | P3（安全边缘：会话/权限失效） | pkg-admin/pages/account-switch/index.js:300-303；pkg-admin/pages/recognition-review/index.js:269-272,303-306；pkg-admin/pages/config/index.js:179-182**
- 描述：首屏加载走 `feedback.handleError`（FORBIDDEN → 清数据 + 整页说明 + 回首页），但**二级/写请求**的失败只 `feedback.toast(err.message)`：`account-switch` 的 `loadTestAccounts`、`recognition-review` 的 `submitFix/submitIgnore`、`config` 的 `submit` 等。
- 影响：白名单被运维移除/票据被覆盖等 FORBIDDEN 场景下，页面停在原界面继续展示已加载数据、只闪一个 toast，不满足 UX_DEVELOPER §0.3/§5.5「无权限 → 整页说明 + 回 overview、不展示任何后台数据」；属防线后退（前端展示态问题，服务端仍拒绝写，无越权）。
- 修复建议：写/二级请求的 catch 统一先判 `err.code === feedback.FORBIDDEN_CODE` 再走 `feedback.handleError`（可抽 `feedback.handleActionError`），其余才 toast。
- 证据：EV17 → `account-switch/index.js:300 }).catch((err) => {` → `:302 feedback.toast(err && err.message);`；`recognition-review/index.js:269 > :271`、`:303 > :305`；`config/index.js:179 > :181`。

**R-B2-17 | P3（范围外：api/S0，移交） | api/modules/partner.js:20**
- 描述：`getCustomer` 注释仍写"顾客详情（档案 + 该顾客订单分页 + 解绑资格）"，但 TD-049 已关闭：`getCustomer` 删除 `orders/nextCursor` 与 `cursor/from/to`，只返回 `customer/activeOrderCount/unbindEligibility/partnerNo`（`cloudfunctions/api/handlers/partner/getCustomer.js:4,25-32`）；本侧页面也已统一走 `order.listPartner({view:'customer'})`。
- 影响：注释与冻结契约漂移，后续若有人照注释接入会误判入参/出参。
- 修复建议：S0 单写者把注释改为"档案 + 解绑资格（不含订单；历史订单唯一来源 = order.listPartner view=customer）"。
- 证据：EV18 → `api/modules/partner.js:20 // 顾客详情（档案 + 该顾客订单分页 + 解绑资格）...`；`getCustomer.js:4 // TD-049：本接口不返回 orders ...`。

**R-B2-18 | P3 | pages/partner/workbench/index.js:293-309,359-378,123-130**
- 描述：首屏分片 `appendChunks` 用 `setTimeout` 逐帧追加（:293-309），只靠 `_chunkToken` 防串行；`applyFilter`（:359-378）切筛选时清空 `groups` 但不递增 `_chunkToken`、`onUnload`（:123-130）也不清除已排的 chunk 定时器。
- 影响：在分片尚未追完时切换筛选/离开页面，旧筛选的剩余分片可能被追加到新列表（视觉上出现不属于当前筛选的行；下次加载自愈），卸载后 setData 属无效调用告警。低概率（分片缺口 16ms×N）。
- 修复建议：`applyFilter/onUnload/onHide` 统一 `this._chunkToken += 1` 并 `clearTimeout(this._chunkTimer)`；`appendChunks` 保存 timer id。
- 证据：EV19 → `index.js:287 this.appendChunks(result.chunk.rest);`、`:297-298 token`、`:305/:308 setTimeout`、`:398 clearTimeout(this.searchTimer)`（仅搜索定时器被清）。

**R-B2-19 | P3 | pages/partner/workbench/index.wxml:90；pages/partner/workbench/parts/page-actions.js:294-296**
- 描述：空态入口"代客下单"按钮（index.wxml:90）没有 `!readonly`/`!sessionView` 条件，`onEmptyCreate`（page-actions.js:294-296）也无 `readonly` 拦截；同页多选按钮、行工具、撤销条、空态分享按钮都已按会话/只读收紧。客户列表页对此有正确处理（`list-model.buildSnapshot` 的 `showCreateEntry: opts.readonly !== true`）。
- 影响：READONLY 会话（开发者只读查看无单的真实兼职）下可点入代客下单页，违背 UX_PARTNER §6.2/§6.3「READONLY 隐藏代客下单入口、点击置灰 toast『开发者只读视角不能操作』不发请求」——实际写请求仍被 `api/mode-guard` 兜住（无数据风险），属入口层漏挡/体验不一致。
- 修复建议：空态按钮 `wx:if="{{!readonly && !sessionView}}"`；`onEmptyCreate` 加 `modeGuard.canRenderWriteButton()` 判断并 toast。
- 证据：wxml:90 `<view ... bindtap="onEmptyCreate">{{empty.actions.createOnBehalfText}}</view>`；page-actions.js:294-296 无判据；对照 `customers/parts/list-model.js:131 showCreateEntry: opts.readonly !== true`。

---

## 4. 通过项

### 4.1 七维 + 条件维逐条结论
1. **接入性与装配：通过（无 P1）**。①app.json 声明 ↔ 文件：`pkg-partner` 7 页、`pkg-admin` 11 页全部四件套齐全且被 app.json 声明（EV23）；②入口可达：工作台行/tab→订单详情、工作台/客户页→代客下单、客户行→顾客档案、我的→服务/统计/消息、后台总览→10 个功能页、消息/列表→详情（EV22 与 `pkg-admin` `PAGE_URLS` 使用点逐一核对，无断链；`pages/partner/customers` 为 tabBar 页由 `custom-tab-bar` 以无前导斜杠 `pagePath` 承载，非断链）；③handler 绑定：页面 `xxxApi.method` 与 `api/modules/*` 导出全交叉校验通过（EV21），页面无直拼 action 字符串（`tools/check.js` 的集合名/action 注册表与页面零判据扫描已绿，本 part 抽查 0 命中）。tabBar 红点：`custom-tab-bar/index.js:7/11/13` 的 `badgeKey` 为 `workbenchPending`/`messages`，工作台 `load-view.badgePatch` 只改 `workbenchPending` 且保留 `messages`，消息页 `message-view.badgePatchOf` 只改 `messages` 且保留 `workbenchPending`（互不覆盖），30s 轮询/onShow 更新，服务端测试数据已隔离。后台页无 tabBar，`navigateTo`/`navigateBack` 返回栈合规（`feedback.go` 统一 `navigateTo`，切换会话用 `reLaunch` 回 `account-switch`）。
2. **逻辑性：发现 10 条 P2**（R-B2-02~10 等），其中批量部分失败/同一 batchActionId/失败保留勾选/重试、游标分页、30s 轮询行级补丁、5s 撤销条区段逻辑整体正确（详见 4.2）；问题集中在设备时钟、PICKED 字段能力、会话分享、二次确认、guest 标记、空 catch、代客识别/预置绑定。
3. **牵连性：基本通过**。被移除/收敛项无残留：`order.listPartner view=customer` 单源（顾客详情页面已不消费 `getCustomer.orders`，`detail-view`/页面只调 `listPartner`）；`VIEW_AS_*` 在 B2 范围 0 命中（审计名统一 `ACCOUNT_SWITCH_*`，`constants.js` 用共享审计枚举）；`data-model`/`TECH_DEBT`/`CHANGELOG` 的 B2 相关条目已在 STATE 批 6~8 快照登记（TD-044/047/048/049/050 为该侧口径降级，非本轮新问题）。漂移项已记 R-B2-11/17。
4. **性能：通过**。工作台服务端游标分页（首屏 30）+ 首屏分片 setData（20 行/片）+ 轮询按 orderNo/version 客户端合并并只对变化字段发 `groups[g].rows[r].field` 行级补丁（`load-view.resultPatch`/`group-view.diffRowPatches`，签名不变才 patch）；列表/卡片均为服务端分页，无 N+1 客户端循环请求（批量是显式逐单，UX 规定语义，非 N+1；顺序循环避免并发压云函数）；无同步长任务；10 个轮询/防抖定时器均在 `onHide`/`onUnload` 清理（workbench poller/searchTimer/undoTimer、detail messageTimer/undoTimer、messages poller、admin 三页搜索 `this.timer`、config 离开拦截 `disableAlertBeforeUnload`）；遗留 R-B2-18（分片定时器）。无性能预算文件 → 按"无预算基线"定性。
5. **冗余/死代码：轻微**。R-B2-14（no-op replace）、R-B2-06 附带的 view-model 未消费输出（`counterpartText/counterpartAvatarFileId/partnerNoText`）、`group-view.toRow` 内 `actionsOf(item)` 计算两次（:99 局部变量未被使用、:119 再次赋值）；`constants.CONFIG_TTL_KEY` 属 R-B2-13。其余新增导出均有生产调用（页面/parts 互调），未见永远真/假分支。
6. **开发规范：基本通过**。命名与注释整体清晰（Why 注释占比高，契约/UX 章节引用到具体条款）；单文件均 ≤500 行（最大 `pkg-partner/order-detail/index.js` 486 行、`pages/partner/workbench/index.js` 493 行、`pkg-admin/account-switch/index.js` 492 行）；页面四件套齐全；`node --check` 抽检 7/7 PASS；无未完成占位标记/`TO\x44O`（取代废弃扫描命令见 §5④，0 命中）；后台/兼职端页面文案无费用语义（门禁 #22 已绿）；跨端重复已知项（TD-042 补码文案）不重复报。
7. **安全：无 P0/P1；1 条待独立复核的 P2**（R-B2-01）。鉴权/越权：前端只做展示态，写动作由 `api/mode-guard.assertWritable` + 服务端票据双重拦截；页面未见 `wx.cloud.*`/集合名/action 直拼；`openid` 在 B2 范围 0 出现（grep 复核：仅 `pkg-partner/pages/messages/index.js:63` 读 `snapshot.viewContext`，非 openid；`pkg-admin` 零命中）；后台 11 页无头像位、无 `avatarFileId` 展示（仅配置项"头像大小上限"），昵称取服务端脱敏 DTO 原样展示；剪贴板仅复制编号/订单号/日报（无 L3 取件码/截图 URL）；`previewImage` 仅兼职本人订单截图（临时 URL，本人数据）；无 `console.log` 明文（后台错误文案统一 `copy.errorText` 人话）。
8. **条件维 8（UI 可访问性）：部分通过**。四态/五态齐全：后台 11/11 页 `loading/error/empty/forbidden` 钩子齐（EV23 扫描）、`empty-state` 组件统一；工作台骨架屏/筛空与真空文案分离/错误态带上次成功时间/只读行说明；空态入口/按钮 `≥88rpx` 由全局样式与既有组件保证（本 part 未逐页量真机像素，属 QA 真机项）。缺口：R-B2-08（缺确认）、R-B2-19（只读入口）。条件维 9（外部调用）：**通过**——B2 页面零外呼（无 `wx.request/fetch/wx.cloud`），AI 仅经 `api/modules/ai`→云函数，上传仅经 `api/upload`（`image-picker` 组件）；客户端无 Key/端点（门禁 #24 已绿）。条件维 11（数据隐私）：**通过（除 R-B2-01）**——后台列表/详情不展示头像、昵称取服务端掩码值、openid 零出现、日志零明文、分享卡片除工作台问题外只带编号；测试账号会话下测试数据由服务端隔离、统计/红点排除（TD-030 行标签已由后端 DTO 下发 `isTest` 渲染）。
- 条件维 10（性能预算）：**N/A + 原因**（仓内无预算文件；按维度 4 定性并标注"无预算基线"）。

### 4.2 明确通过项（抽样证据）
- 装配：app.json 30 页 ↔ 文件 ↔ 入口 ↔ api 方法四向一致（EV21/EV22/EV23）；`pages/profile` → 兼职三入口（消息/服务/统计）路径经 grep 核对存在（`pages/profile/index.js:23-25,383-395`）。
- 工作台服务端判据：行内 `actions[]` 只消费服务端（`row-actions.knownActions` 丢弃未知 key、`label` 优先服务端）、多选资格只读服务端 `bucket`（`filter-view.canSelect`）、状态筛选走服务端 `status` 入参（`load-view.queryOf`）、四档排序在 `shared/order-view` 单源（TD-017 已裁决）。
- 批量语义：客户端循环逐单 + 同一 `batchActionId`（`client.createRequestId`）、逐单结果不聚合成功、失败逐单给单号+原因并保留失败勾选可重试（`batch-view.run/summary/retryPlan` + `finishBatchIntent`）；接单按契约不带 `batchActionId`。
- 撤销条：仅 pick/deliver 后出现（`undo-view.META`）、5s 倒计时、`onHide` 清空、READONLY 不出现、批量同 id 调 `order.undo`（batchActionId 透传）。
- 分页/轮询/骨架：首屏 30、触底游标、轮询无变化也更新 `counts`/红点、行级补丁、骨架屏、错误态上次成功时间（`load-view` 全套断言已被 `selftest-order-workbench` 锁定）。
- 详情写动作：`expectedVersion` 统一进 `opts` 包络（correct/delivery/exception/actions 五处），冲突 `INVALID_TRANSITION/CONFLICT` 自动重拉；READONLY 事件层再挡（`guardReadonly` + `modeGuard`）且 `canRenderWriteButton` 控制按钮；TEST_WRITE 成功文案带"（将写入测试数据）"。
- 客户列表：服务端 keyword 搜索 + 游标分页 + 无本地排序/过滤；新绑定横幅仅在已有基线后比较；READONLY 隐藏代客下单入口、会话内隐藏分享（`list-model.buildSnapshot`）。
- 代客下单：两路径互斥（BOUND 只传 `bindingId`、GUEST 逐条 `guest`，均不写 bindings）、逐件校验矩阵、`clientRequestId` 生命周期（同签名复用/变更重生成，签名含 image/ticket/recognition）、逐条结果块（`result-model`）、`PARTNER_CLOSED/VALIDATION_FAILED` 人话映射。
- 统计页：`partner.stats` 单源、完成率 `null`→"暂无"、空数据不画假柱（`hasBar` 门）、`serverNow` 校时、请求 token 防竞态、旧值保留+错误提示（本轮标准范式）。
- 后台：11/11 页五态（`forbidden` 卡 + 清数据 + 回首页）、危险动作二次确认（邀请码作废/停用恢复/配置保存/维护开关/复核补录忽略/删除测试账号/dryRun + 输入双条件/清空测试数据/异常介入取消）、后台零分享入口（`selftest-admin-pages` 断言 + 本 part grep 复核）、测试账号额度/dryRun/审计文案、识别失败原图仅按单查看（`failure-image` 组件，无缩略图/批量/下载）。
- 后台每页 `onShow`/首屏请求均服务端校验；`feedback.clearLoadedData` 覆盖各页数据键，无"后台空壳"残留。

---

## 5. 结论

① **各级计数**：P0 = **0**；P1 = **0**；P2 = **10**（R-B2-01~10）；P3 = **9**（R-B2-11~19）；合计 **19**。
② **依据未复现条数**：**0**（19 条均给出命令/读取命中行；R-B2-01 的"原生转发菜单可用"为平台行为推断 + 同仓无 `hideShareMenu` 事实，已在安全轴标注"待独立复核"，不计入未复现）。
③ **旧问题三态**：**N/A（无旧报告）**。
④ **取代与废弃检查**：
- 并行态登记簿：`STATE.md` **无"并行态"登记簿**（按简报 §1/§5），按取代与废弃检查直接判；
- 废弃标记命中：**0**（命令：`Get-ChildItem -Recurse -File -Include *.js,*.wxml,*.wxss,*.json -Path pages\partner,pkg-partner,pkg-admin | Select-String -Pattern '_old\b|_legacy|_v2\b|Deprecated|暂时保留|废弃|TO\x44O[:：]\s*(删|remove|delete)'` → 空输出，退出码 0；命令中待办标记按 `TO\x44O` 转义写法书写，`\x44`=D，正则语义与字面三字母标记等价）；
- 各条已申报判定：N/A（无命中）；B2 范围未见并行实现残留（旧 `view-as` 页、旧 `summary.js` 等按 STATE 批 7/8 已删除，`pkg-partner`/`pkg-admin` 无旧文件）。
⑤ **建议色**：🟡 **黄**（P0=P1=0，且存在 P2/P3；旧报告 P0/P1 核销本轮 N/A，不构成绿的条件）。**审查者只给建议色，裁决是人**。
⑥ **本轮发现**：**19 条**；可行动 **19 条**（10 条 P2 建议本批消化，9 条 P3 建议随手修/登记；R-B2-01 属安全/隐私口径，建议 Lead 优先派独立验证者按"入口→传播→终点"复核）。

**移交/后续**：
- R-B2-11 / R-B2-17 属 `api/`、`docs/ARCHITECTURE.md` 域（S0/Lead），本 part 只记录不移交修改；
- 未审覆盖（§2 的 ○/△ 项，尤其 `pkg-admin` 7 个列表/详情页未逐行、`pages/partner/workbench/parts/maintenance-hook.js` 未读、`order-detail` 7 个面板件只抽查）建议 Lead 按需二次分派或由其它 part 补位；本 part 未对其下任何结论。
- 已知降级项不重复论证：TD-041（详情写动作每次换幂等键）、TD-042（补码文案双源）、TD-044/TD-050（keyword/窗口限制）、TD-047（轮询无 since）本轮只作对照引用。
