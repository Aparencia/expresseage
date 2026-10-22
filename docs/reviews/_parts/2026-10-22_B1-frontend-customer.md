> 本条由 AI 生成（代码审查）

# 2026-10-22 · B1 前端顾客侧（阶段 2 前端与接口集成）· 审查报告

> 审查员：review-frontend-customer（Team 审查员）｜共享任务：task-6｜产物：本文件（唯一写入）
> 审查基线：HEAD `9031d14cfc88b0cd8b03527da00ccc1f70a3e635`（全量新增；`git log --oneline -1` 实跑）。
> 未修改任何代码/配置/测试；未执行 `git add/commit/checkout/stash/reset/tag`；未运行 `gate.ps1`/`check.ps1`/`selftest`（按简报禁令）。

## 0. 派单输入单

- **DESCRIPTION**：审查 B1 顾客侧（launch/role/customer/profile + pkg-customer 5 页 + components 16 套 + custom-tab-bar + utils/** + api/** + store + config + app 三件套）；装配三层链路、页面层零业务判据、隐私闸/账号切换、上传与 AI 兜底、轮询/定时器清理、setData 粒度、条件维 8/9/11；只读代码、只写本 part 文件。
- **PLAN_OR_REQUIREMENTS**：`docs/V4_CONTRACT.md`（唯一口径）+ `docs/V4_DATA_MODEL.md` §2/§4/§5/§7 + `docs/V4_UX_CUSTOMER.md` + `docs/ARCHITECTURE.md`（分层/冻结接口）+ `docs/V4_ENGINEERING.md`（工程/门禁/代码硬标准）。
- **BASE_SHA**：`4b825dc642cb6eb9a060e54bf8d69288fbee4904`（空树，全量新增等价基线）。
- **HEAD_SHA**：`9031d14cfc88b0cd8b03527da00ccc1f70a3e635`。

## 1. 开工回执（九项）

### 1.1 人话复述与落点
本 part 审「顾客能看到的全部前端与接口适配层」：页面声明↔入口可达↔handler 链路是否闭合、页面层有没有把业务判据搬回来、隐私闸/头像昵称/绑定/四步下单/订单轮询/消息红点/注销这些链路在空值/弱网/重复提交/会话切换下是否成立。产物 = 本文件；下一步 = Lead 按 `_REVIEW_BRIEF.md` §5/§6 聚合 A1/A2/B2/C/D 与本 part。

### 1.2 假设清单
1. 假设「审查对象 = HEAD 全量新增」；若错（改为审某批 diff），则覆盖地图中「被删符号零残留/牵连性」结论失效。
2. 假设 `docs/V4_CONTRACT.md` v0.9 与三份 UX 为有效规格；若 UX 与 CONTRACT 冲突，本报告一律以 CONTRACT 为准（UX 差异只作 P3 交互偏差）。
3. 假设 `tools/check.js` 31/31、`check-docs` 10/10、零金额 0 命中为真实基线（简报 §0 已给 Read 数，我未复跑）；若门禁实际红，则「门禁已覆盖不重复报」的判断需重算。
4. 假设工作树在审查期间保持基线；实测**不成立**（见 1.5），已按「HEAD 为审查对象、工作树改动另行标注」处理。
5. 假设云函数 handler 侧（A1/A2 范围）按 HEAD 契约实现；本报告只在「页面 ↔ 契约」接缝处引用云函数行为，不对其内部正确性下结论。

### 1.3 澄清问题
- `registry/APIS.md`、`registry/DATA_DICT.md` 不存在（ENGINEERING E7 已裁）→ 本报告写 **N/A + 原因**：接口契约以 `docs/V4_DATA_MODEL.md` §7 + `shared/actions.js` + `shared/error-codes.js` 为等效载体，已据此核对。
- 无其他阻塞判定的问题；`UX_CUSTOMER §11.3 组件清单`与 `ARCHITECTURE §3.5` 冻结组件清单不一致，属文档同步（阶段 3/C 轴），本报告只登记不展开。

### 1.4 锚点校验（命令原文 + 输出）
```
PS> Select-String -Path STATE.md -Pattern '起点锚点'    # 输出：空（无匹配）
PS> git log --oneline -1
9031d14 fix(v4): 测试账号单机验收「无法激活/绑定」…
PS> git status --porcelain      # 基线时：仅 ?? docs/research/  ?? docs/reviews/
```
适配口径：`STATE.md` **无「起点锚点」字段**（空输出已贴），按简报 §0 以「HEAD 全量新增」为基线，不再追问用户。

### 1.5 diff 读取确认（全量新增基线）
- **已读范围（逐文件读 `read` 工具，行数为实读文件行数）**：
  - `pages/launch`(213+wxml58)、`pages/role`(168+52)、`pages/customer/home`(324+81)、`pages/customer/orders`(183+45)、`pages/customer/parts`(format 70 + orders-view 159)、`pages/profile`(500+253+wxml362 抽样)、`pages/profile/parts`(view-model 336 + share-card 32 + ui 35)；
  - `pkg-customer/pages/{bind 164+53, order-create 472+188, order-detail 347+152, messages 170+46, help 141+47}`、`pkg-customer/pages/order-create/parts/{model 383, ocr-flow 286, bootstrap 63, reorder 108}`、`pkg-customer/parts/{poll-policy 77, order-detail-flow 190, status-view 391, format 79, privacy-text 163}`、`messages/parts/message-view 173`；
  - `components/**` 16 套全部 `.js`（avatar-view/switch-bar/test-badge/status-pill/order-row/customer-row/id-text/room-tag-text/failure-image/image-picker/code-editor/empty-state/form-field/section-card/role-switch/maintenance-mask）+ 14/16 的 `.wxml`；
  - `custom-tab-bar`(86+15+59)、`api/**`（client 190、upload 216、privacy 156、mode-guard 92、modules 9 件）、`store/index.js` 212、`config/**`（env 32 + defaults 113 + route 134）、`utils/**`（storage 232、privacy-policy 157、avatar 325、ids 185、room-tag 95、session 58、maintenance 65、customer-view 259、order-edit 142、recognize 4 件 566、ocr 3 件 294）、`app.js 88/app.json 118/app.wxss 203/sitemap 9`、页面 `.json` 10 个。
  - **跨域只读核对（B1 接缝必需）**：`cloudfunctions/api/handlers/{order/listCustomer,get,_dto,_create,_parcel,_store,create,createBatch,customer/saveProfile,getProfile,bind/getCurrent,create,message/list,upload/prepare,upload/_common,user/bootstrap}`、`cloudfunctions/api/middleware/auth.js`、`cloudfunctions/api/db/dto/full.js`、`shared/{order-state,enums}.js`、`docs/V4_UX_CUSTOMER.md` 全文。
- **机械扫描覆盖（命令原文与输出见 §3「取证台账」）**：`wx.cloud.*`/`fetch`/外链（客户端 0 命中，仅 api/client.js:77、api/upload.js:88、app.js:38 为白名单点）、七状态字面量（pages 0、pkg-customer/parts 为 lead 口径允许映射、components 命中 status-pill）、`Math.random`（仅 api/client.js:42）、action 字符串（仅 api/ + mode-guard 白名单点）、集合名（客户端 0）、`viewTicket`（仅 api/client.js:115-116 + store/index.js:140-142）、定时器（19 处逐一定位）、存储 API（仅 utils/storage.js）、`console.*`（仅 api/client.js:149-153，脱敏）、空 `catch`（0 处）、死导出（10 组）、裸色值（195 处 / token 45 处）。
- **审查期间工作树被他人改动（重要，需 Lead 归并）**：审查中 `git status` 从干净变为 4 文件 `M`（`docs/V4_CONTRACT.md`、`docs/privacy/隐私保护指引.md`、`pages/launch/index.js`、`pkg-customer/parts/privacy-text.js`），diff 内容为「剪贴板披露」等隐私文案补充。本报告：①以 HEAD 内容为审查判据；②对这些文件标注「审查期间被改动」；③涉及它们的发现（R-B1-11、R-B1-13）需在最终版本上复核，我不改他人文件、不覆盖。
- 未覆盖（○）：`*.wxss` 未逐行通读（仅抽样 9 文件 + 全量裸色值/触摸区统计）、部分 1-3 行的组件 `.wxml` 未逐字读、`utils/recognize/*` 语料矩阵未逐条跑（无运行许可）。覆盖地图已标 ○ 并给原因。

### 1.6 审查范围声明
只审派单范围及其直接关联调用（页面↔api/↔云函数接缝）。`pages/partner/**`、`pkg-partner/**`、`pkg-admin/**` 属 B2/A2，除接缝证据外不判；发现的范围外问题只在「4.3 未决/移交」登记，不展开。

### 1.7 旧报告
无（`docs/reviews/` 本轮新建；旧问题三态 = N/A）。

### 1.8 引用检查清单原文（执行依据，逐字抄录）
**七个固定维度**：1 接入性与装配；2 逻辑性；3 牵连性；4 性能；5 冗余死代码；6 开发规范；7 安全。
**条件维（按触发启用，不适用写 N/A + 原因）**：⑧ UI 可访问性（前端：状态齐全/对比度/触摸目标 44px/空态错误态）；⑨ 外部调用（本仓仅服务端 DeepSeek：适配层/显式超时/降级/重试）；⑩ 性能预算（热路径改动时；预算文件=ENGINEERING §2.3 体积预算；无预算 → 按维度 4 六类定性并标注"无预算基线"）；⑪ 数据隐私（本仓涉订单/头像/昵称/宿舍：字段加密？日志脱敏/用途限定/注销清除）。
**气味基线（逐行给判据）**：
| 气味 | 判据 |
| :-- | :-- |
| 长函数 | 超过本仓行数上限（50/500/1000 行阈值） |
| 重复代码 | 同一段逻辑出现第 2 次 |
| 参数过多 | 参数 >4 个 |
| 发散式变化 | 一个文件因多个不相关原因被改 |
| 霰弹式修改 | 一个改动要动 >3 个文件 |
| 命名不达意 | 读名字猜不出行为 |
**严重级**：P0 = 崩溃/数据丢失/安全漏洞｜P1 = 核心功能不可用（含装配断链）→ 二者必须清零｜P2 = 边缘功能报错/体验不佳｜P3 = 拼写/样式/非关键提示。不确定按 P2。
**建议色矩阵**：🔴 红 = P0≥1 或 P1≥1 或取代废弃命中；🟡 黄 = P0=P1=0 且有 P2/P3；🟢 绿 = P0=P1=0 且旧报告 P0/P1 全部核销（本轮 N/A）。审查者只给建议色，裁决是人。
**越界与取代废弃检查**：①并行实现未删（旧文件/旧函数/旧分支/旧常量 + STATE 无登记行；合法保留仅灰度/兼容契约/证据留存三种）；②新增行命中 `_old\b|_legacy|_v2\b|Deprecated|暂时保留|废弃|TO\x44O[:：]\s*(删|remove|delete)`（`\x44` = D，正则语义等价；按要求用转义写法）→ 必须写保留理由与删除条件，否则红灯。
**安全轴四条硬规则**：①每条安全发现给「入口 → 传播 → 终点」三处 `文件:行`；②`overall_severity ≤ impact.score`；③验证者身份分离——我只写"待独立复核"；④格式错/缺字段作废重做。

### 1.9 派单输入单
同 §0（DESCRIPTION / PLAN_OR_REQUIREMENTS / BASE_SHA / HEAD_SHA 已逐项抄录）。

## 2. 覆盖地图（文件(组) × 7 维）

图例：✓ 已审；— N/A（附原因）；○ 未审（附原因）。列序 = ①装配 ②逻辑 ③牵连 ④性能 ⑤冗余 ⑥规范 ⑦安全。

| 文件（组） | ① | ② | ③ | ④ | ⑤ | ⑥ | ⑦ | 说明/证据落点 |
| :-- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-- |
| `app.js` / `app.json` / `sitemap.json` | ✓ | ✓ | — | — | — | ✓ | ✓ | 页面声明 30 页与磁盘 30 页一致；tabBar 5 项；无 `wb.cloud.database` |
| `pages/launch/index.js(.wxml)` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | 隐私闸/重试/错误码文案；参数透传缺（R-B1-26） |
| `pages/role/index.js(.wxml)` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | 卡片落地链闭合；兼职身份仍出绑定按钮（R-B1-08 关联） |
| `pages/customer/home/index.js/.wxml` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 订单卡视图映射缺失（R-B1-02）；角标/停用态（R-B1-07/15） |
| `pages/customer/parts/*`（format/orders-view） | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 倒计时对齐 serverTime ✓ |
| `pages/customer/orders/index.js/.wxml` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 空态 CTA 未判绑定（R-B1-08）；READMEONLY 写入口（R-B1-24） |
| `pages/profile/index.js/.wxml` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 注销链（R-B1-14）；订单概览（R-B1-16）；分享（R-B1-06） |
| `pages/profile/parts/*`（view-model/share-card/ui） | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | 头像/昵称边界、解绑原因、share path 单源 |
| `pages/*/index.wxss` | — | — | — | — | — | ○ | ○ | 仅抽样 + 全量裸色值/触摸区统计（R-B1-21/25），未逐行通读 |
| `pkg-customer/pages/bind/*` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 绑定方向/错前缀同源 ✓；资料完整未前置拦截（R-B1-08） |
| `pkg-customer/pages/order-create/index.js/.wxml` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 四步/幂等键/上传票据；无压缩（R-B1-01）、无确认（R-B1-10）、竞态（R-B1-28） |
| `pkg-customer/pages/order-create/parts/*` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 逐件 AI 兜底/指纹/预约（R-B1-19） |
| `pkg-customer/pages/order-detail/index.js/.wxml` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 轮询/退避/动作带 version ✓；onHide 竞态（R-B1-04） |
| `pkg-customer/parts/{status-view,order-detail-flow,poll-policy,format}` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 七状态单源消费 ✓（status-pill 例外见 R-B1-05） |
| `pkg-customer/pages/messages/*` + `parts/message-view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 水位/红点/分页 ✓；TD-023 已知 |
| `pkg-customer/pages/help/*` + `parts/privacy-text.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | 全文单源；D2 冲突（R-B1-11）；剪贴板（R-B1-13） |
| `components/status-pill/*` | ✓ | ✓ | — | — | ✓ | ✓ | — | 文案双源（R-B1-05），门禁漏检 |
| `components/{order-row,customer-row,id-text,room-tag-text,avatar-view}` | ✓ | ✓ | — | — | ✓ | ✓ | ✓ | 锚+键；默认头像兜底；复制进剪贴板（R-B1-13） |
| `components/{switch-bar,test-badge,maintenance-mask}` | ✓ | ✓ | — | ✓ | ✓ | ✓ | ✓ | 黄/蓝条、TEST 角标、维护遮罩 ✓；1s 定时器（R-B1-20） |
| `components/{image-picker,code-editor,empty-state,form-field,section-card,role-switch,failure-image}` | ✓ | ✓ | — | — | ✓ | ✓ | ✓ | 上传唯一出口 ✓；相册权限误用（R-B1-03）；failure-image 禁长按 ✓ |
| `custom-tab-bar/*` | ✓ | ✓ | — | — | ✓ | ✓ | ✓ | 角色三格/switchTab ✓；订单角标缺（R-B1-15） |
| `api/client.js` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 包络/超时/读重试/写不重试/票据注入/校时 ✓ |
| `api/upload.js` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 顺序「校验→prepare→上传」✓；TICKET 无压缩（R-B1-01） |
| `api/{privacy.js,mode-guard.js,modules/*}` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | 权限适配；动作名单硬编码（R-B1-17）；死导出（R-B1-18） |
| `store/index.js` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 票据内存保留分支 ✓ |
| `config/{env,route,defaults}.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | 分流纯函数 ✓；aiFallback 默认（R-B1-12）；参数透传（R-B1-26） |
| `utils/{storage,privacy-policy,session,maintenance}.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | 白名单存储/版本判定/会话水合 ✓；死导出（R-B1-18） |
| `utils/{avatar,ids,room-tag}.js` | ✓ | ✓ | — | — | ✓ | ✓ | ✓ | 纯件、零生成/零 random ✓ |
| `utils/{recognize/**,ocr/**}` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 形态闸/去敏/阶梯去重 ✓ |
| `utils/{customer-view,order-edit}.js` | ✓ | — | — | — | ✓ | ✓ | — | 兼职侧复用（B2 主审），本 part 只查与组件契约 |
| `app.wxss` | ✓ | — | — | — | ✓ | ✓ | ✓ | token 单源 ✓；`.muted/.small` 对比度（R-B1-09） |
| 运行期行为（轮询竞态/识别竞态/时钟偏差） | — | ✓ | — | ○ | — | — | — | 静态推理取证，无运行复现（见 §5 依据未复现 2 条） |

## 3. 问题清单

> 格式：`编号 | 级别 | 位置 | 描述 | 影响/触发条件 | 修复建议 | 证据`。取证台账（命令原文 + 退出码 + 命中行）见 §3.30，证据列以 `[E#]` 引用。

### 3.1 P0（必须清零）
无。

### 3.2 P1（核心功能不可用，必须清零）

**R-B1-01 | P1 | `api/upload.js:160-167` `api/upload.js:169-201`；`components/image-picker/index.js:46-56,58-82` | 截图（TICKET）上传链路无任何压缩，`>500KB` 直接拒绝，下单 Step1 对常见手机截图不可用。**
- 描述：`prepareTicket()` 只做「能读到文件 + ≤500KB」闸（`api/upload.js:160-167`），随后直接 `upload.prepare({purpose,size})` → `wx.cloud.uploadFile`（`:169-201`）；客户端唯一的压缩实现是 `avatar.compressAvatar`（仅 AVATAR 分支，`:141-155`）。`<image-picker>` 调 `wx.chooseMedia`/`wx.chooseMessageFile` 时未传 `sizeType`、未在本地压缩（`components/image-picker/index.js:46-56`），`MAX_TICKET_BYTES=500*1024`（`api/upload.js:13`）。服务端同样以 500KB 拒绝：`cloudfunctions/api/handlers/upload/prepare.js:40-52,72`（`assertImageInput(input, TICKET_MAX_BYTES)`）、`cloudfunctions/api/handlers/order/_store.js:309-311`（`image.size > IMAGE_MAX_BYTES` 拒）。`TICKET_LONG_SIDE_LIMIT`（`:15`）只作为返回值登记（`:200`），无消费方。
- 影响：ARCHITECTURE §3.3 冻结接口要求「本地校验/压缩（截图长边 1440/≤500KB，走 utils/avatar 纯件）」、UX_CUSTOMER §4.2/§3.7.1 要求「压缩（长边≤1440、质量 80、循环至≤500KB、≤3 次）+ 原图≤10MB」、AC-C-09 直接以「压缩后 ≤500KB」验收。现代手机截图常见 1–3MB，用户会卡在 Step1 且被提示「截图文件过大，请重新选择或裁剪后上传」——小程序内并不存在裁剪功能。触发条件明确（所选截图 >500KB）。
- 修复建议：在 `api/upload.js` 增加 TICKET 压缩（复用 `utils/avatar.planCompression` 的阈值/质量阶梯思路，长边 1440、≤3 次），或改 `image-picker` 走 `wx.compressImage` 后复验；同时补 `tools/selftest-profile/order-flow` 静态判据（顺序 + 压缩调用 + 真实 size 入参）。若不改代码，必须登记 TECH_DEBT 并在 UX/AC 回写降级口径（不建议）。
- 证据：`[E12]`（`Select-String api/upload.js -Pattern 'compressAvatar|prepareTicket|TICKET_LONG_SIDE_LIMIT'` 命中 `:12,:15,:141,:143,:160,:182,:200`；`image-picker:66` 无压缩/无 sizeType）；`[E1]` 客户端 `wx.cloud.*` 仅白名单点。

### 3.3 P2（边缘功能报错/体验不佳）

**R-B1-02 | P2 | `pages/customer/home/index.js:206-214`、`pages/customer/home/index.wxml:50` | 首页「进行中的订单」卡把服务端原始 order DTO 直接喂 `order-row`，四个视图字段全空。**
- 描述：`order-row` 读组件视图键 `codeText/customerLine/serviceName/timeText`（`components/order-row/index.wxml:4-9`），列表页用 `pages/customer/parts/orders-view.rowView` 显式组装（`orders-view.js:107-120`），首页却 `setData({order: listData.list[0]})` 原样透传。服务端 DTO 是 `parcel.pickupCode/stationName`、`service.name`、`statusUpdatedAt`（`cloudfunctions/api/handlers/order/_dto.js:351-390`），无上述视图键。
- 影响：首屏主卡只剩状态胶囊，取件码/站点/服务类型/时间全部空白（不报错）；正是 lessons 卡《整对象透传给组件导致字段全空》的再次发生（列表页已修、首页漏修）。
- 修复建议：首页复用 `orders-view.rowView(order,{nowMs,config})` 后再传组件（或把 `rowView` 上移为共享纯件），并补一条「首页订单卡视图字段非空」的纯件断言（防第三次复发）。
- 证据：`[E11]`（`home/index.js:212 order: order`；`home/index.wxml:50 <order-row order="{{order}}">`；`order-row/index.wxml:4-9` 需求键；`_dto.js:363-390` 无视图键）。

**R-B1-03 | P2 | `api/privacy.js:9-10,39-56`；`components/image-picker/index.js:18-27` | 选择相册前请求 `scope.writePhotosAlbum`（保存到相册权限），用户拒绝后无法从相册选图。**
- 描述：`onChooseAlbum()` → `privacy.ensureAlbumAuth()` → `ensureScope('scope.writePhotosAlbum')`；用户拒绝返回 false 后组件直接 `triggerEvent('error', {reason:'PRIVACY_DENIED', message:'需要相册权限才能选择图片…'})` 并 return，不进入 `chooseMedia`。`wx.chooseMedia(sourceType:['album'])` 本身不需要「保存到相册」权限，该 scope 语义是写相册（下载/保存图片），与本场景不符；相机路径反而完全没走 `ensureCameraAuth`（死代码）。
- 影响：用户若在无关的「保存到相册」授权弹窗点拒绝，主路径「从相册选择截图」被客户端硬阻断（拍照/聊天选择仍可用），提示文案误导（说需要相册权限，实际是保存权限）。UX_CUSTOMER §9.2 要求「相册（选择图片）拒绝后改用拍照/聊天/手填，不阻断下单」。
- 修复建议：相册选择改为直接 `chooseMedia`（失败/取消按拒绝处理，不硬拦）；如需前置授权，应按 `wx.getPrivacySetting`/`requirePrivacyAuthorize` 的隐私协议口径，而不是 writePhotosAlbum；删除或接线 `ensureCameraAuth`。
- 证据：`[E6]`（`ensureCameraAuth/openPrivacyContract/checkPrivacySetting` 生产调用为 0）；文件读 `api/privacy.js:9-10,25-48`、`image-picker/index.js:18-27`。

**R-B1-04 | P2 | `pkg-customer/pages/order-detail/index.js:89-127`、`pkg-customer/parts/order-detail-flow.js:87-129` | 页面隐藏瞬间仍有在途 `order.get` 时，迟到响应会把 `poll.running` 恢复为 true 并重新排程，隐藏页继续 10s 轮询。**
- 描述：`onHide()` 先 `clearTimer()` + `flow.stopPoll()`（`index.js:68-76`）；在途请求返回后 `.then` 无条件 `this._session = session` 并 `this.schedule()`（`:101-108,122-127`）；`session` 的 `poll` 来自请求发出时的旧状态（`flow.refresh` 内 `poll.onSuccess(current.poll)`，`order-detail-flow.js:114`，`current.poll.running=true`）。此后每轮都重建 running=true，页面不可见仍持续 10s 轮询（失败时还按 20/40s 退避）。`requestCount` 只拦「更新一轮覆盖前一轮」的乱序，不拦 hidden 后的重排。
- 影响：退出详情页后仍在消耗网络/云函数调用与电量（弱网更明显）；与「onHide/onUnload 停轮询」的验收项（AC-C-29）相悖。
- 修复建议：`schedule()` 前判页面可见性（`this._visible` 在 onShow/onHide 维护），或 `flow.refresh` 用「启动时是否 running」显式门闩，迟到响应不得把 running 从 false 翻回 true；onHide 后再置一个 session 代际号丢弃旧响应。
- 证据：静态推理取证（`read` 命中行如左）；未运行复现 → 计入 §5「依据未复现」。

**R-B1-05 | P2 | `components/status-pill/index.js:2-10,22-30` | 七状态文案/颜色在组件内复制一份，且与 `shared/enums.ORDER_STATUS_TEXT` 不一致；门禁 #21 不覆盖 `components/`。**
- 描述：组件硬编码 `SUBMITTED:'待接单'…PICKED:'已取件', DELIVERED:'已送达', EXCEPTION:'异常'`；单源 `shared/enums.js:51-59` 是 `已取件·配送中 / 已送达·待确认 / 异常·待处理`。详情页同时展示 `status-pill`（组件文案）与 `{{statusText}}`（服务端 DTO 下发 `shared` 文案），同屏出现两套不一致状态词。ENGINEERING §2.2 禁止展示层「拼状态文案」、§5.7 要求 status-pill「文案/映射来自 shared，不写死句子」。门禁 #21 的扫描面只有 `pages/`（`tools/check.js:591-609`，注释明确 pkg-*/parts 允许映射、未提 components）。
- 影响：状态词口径漂移（改一处就双份不一致），且属门禁漏检（组件层业务文案无人守）；订单列表/详情/消息同屏矛盾文案在真机上可见。
- 修复建议：组件改为消费 `shared/enums.ORDER_STATUS_TEXT` + `shared/order-state.STATUS`（组件 require 主包 shared 合法），只保留 tone（颜色）映射；同时把 `check.js #21` 的扫描面扩到 `components/`（或新增一条「组件零状态文案字面量」判据）。
- 证据：`[E2]`（`Select-String components -Pattern "'(SUBMITTED|…)'"` 命中 `status-pill/index.js:4-9`）；`[E1]` 页面层 0 命中；`shared/enums.js:51-59`；`tools/check.js:591-609`。

**R-B1-06 | P2 | `pages/profile/index.js:493-499`、`pages/profile/parts/share-card.js:17-30`、`pages/profile/index.wxml:160-163` | 切换会话（READONLY/TEST_WRITE）下仅隐藏「分享卡片按钮」，未隐藏系统转发菜单，全客户端 0 处 `wx.hideShareMenu`。**
- 描述：`onShareAppMessage` 在 profile 页无条件注册（`index.js:493`），READONLY/TEST_WRITE 仅让 `shareCard` 回落通用卡（`share-card.js:22-25`），页面右上角「转发」菜单依旧可用；ENGINEERING §5.5/§4.8.3 要求「两种会话都隐藏分享/转发入口」。全局证据：客户端范围内 `hideShareMenu` 0 命中（`enableAlertBeforeUnload` 仅在 `pkg-admin/pages/config` 使用）。
- 影响：会话内仍可转发页面（内容为通用标题 + `/pages/role/index`，无票据/PII → 无数据外泄），但不满足「切换会话不能分享或转发」的对外披露与审计口径（隐私文本亦写「切换会话不能分享或转发页面」）。触发条件：开发者在业务页点右上角转发。
- 修复建议：`switch-bar` 或页面 onShow 在 `viewContext` 存在时 `wx.hideShareMenu({menus:['shareAppMessage','shareTimeline']})`，退出/无会话时 `showShareMenu` 恢复；复用 `api/mode-guard` 存判据，页面零新增业务判断。
- 证据：`[E3]`（`hideShareMenu` 客户端 0 命中，4 处命中均为 pkg-admin 的 enableAlertBeforeUnload）；`[E4]`（`onShareAppMessage` 注册点 3 页）；文件读命中行如上。

**R-B1-07 | P2 | `pages/customer/home/index.js:115-146,133`、`pages/customer/home/index.wxml:16-34` | 首页只按 `acceptingOrders` 渲染「接单中/暂停接单」，未处理绑定兼职 `SUSPENDED/CLOSED`（停用/注销）。**
- 描述：`applyDerived()` 的禁用原因只有「维护/资料/未绑定/只读/`acceptingOrders===false`」；卡片状态 `tag` 也只有两态；未消费 `partnerPublic.status`（`partnerPublic` 已含 `status`：`cloudfunctions/api/db/dto/full.js:31-47`）。UX_CUSTOMER §3.3/§10#11 要求停用「已停用（暂时不能下单，可换绑其他兼职）」、注销「已注销（请换绑其他兼职）」，并引导换绑；绑定了停用兼职时首页仍显示「接单中」并允许点提交。
- 影响：状态不齐全（条件维 8），用户在必然失败的下单路径上走到提交才收到 `PARTNER_CLOSED`；停用/注销无法从首页辨认。
- 修复建议：`applyDerived` 增加 `partnerPublic.status` 分支（SUSPENDED/CLOSED → 禁止下单 + 换绑引导 + 红色状态标），文案走 `shared/enums.PARTNER_STATUS_LABELS`；补首页状态矩阵纯件断言。
- 证据：文件读命中行如上；`[E11]` 相关 home 行；`dto/full.js:31-47`。

**R-B1-08 | P2 | `pages/customer/orders/index.js:172-178`、`pkg-customer/pages/bind/index.js:40-49`、`pages/role/index.js:145-157` | 「未绑定/资料未完成」入口拦截不完整：订单空态 CTA 直进下单页、bind 页不校验资料完整、兼职身份仍显示顾客绑定按钮。**
- 描述：①orders 页空态「去下单」直接 `navigateTo(order-create)`，未判 `store.binding`/`profileComplete`（首页 CTA 有判据 `home/index.js:128-141`，但列表页没有）；②bind 页 onLoad 不校验资料完整（服务端 `bind/create.js:35-38` 会 `INVALID_STATE`，UX §3.6 要求「不完整先引导去 profile」）；③role 页对兼职身份（如从分享卡直达 role 页的兼职-only 用户）仍渲染「绑定这位兼职」按钮并把 `activeRole` 置为 CUSTOMER（`role/index.js:145-157`），与 AC-C-59「兼职身份落 ?bind= 只显示『这是顾客绑定入口』、无绑定按钮」不符。
- 影响：用户可达页面在提交时才失败（错失引导）；兼职身份会被带入顾客 UI（服务端仍 FORBIDDEN，无越权），属装配/入口判据回流页面（三条判据分散在页面而非纯件）。
- 修复建议：抽纯件 `canEnterCreate(snapshot)`/`canEnterBind(snapshot)`（或直接调 `config/route` 已有角色判据），三处入口统一消费；role 页按 `vm.roles` 判断是否展示绑定入口（无 CUSTOMER 角色不显示按钮并给「这是顾客绑定入口」文案）。
- 证据：文件读命中行如上；`cloudfunctions/api/handlers/bind/create.js:35-38`；UX_CUSTOMER §3.6/AC-C-03/AC-C-04/AC-C-59。

**R-B1-09 | P2 | `app.wxss:15-16,84-92` | 次要文字 `#999999`（白底）对比度约 2.85:1，低于 UX §11.5 要求的 4.5:1；`.muted/.small` 全站使用。**
- 描述：`--v4-text-3: #999999`，`.muted`(26rpx)/`.small`(24rpx) 均用它；白底 #FFFFFF 下相对亮度对比 ≈2.85:1（WCAG AA 正文需 ≥4.5:1，即使按大字号也需 ≥3:1）。UX_CUSTOMER §11.5/§0 设计语言要求「正文对比度 ≥4.5:1」，CONTRACT §8 的 `#999999` 是 token 事实但未覆盖 AA 达标要求。
- 影响：说明类文字（留存期限、状态补充、错误提示、隐私提示）在强光/低亮度屏可读性不足；条件维 8 未达标。
- 修复建议：把 `.muted/.small` 的正文色提为 `#666666`（现有 `--v4-text-2`）或新增 `--v4-text-3-strong:#767676`（4.5:1）并保留 `#999` 仅用于非正文装饰；补一行 token 对比度说明。
- 证据：`[E7]`（token 统计命令；`app.wxss` 读取命中 `:16,84-92`）。

**R-B1-10 | P2 | `pkg-customer/pages/order-create/index.js:98-140,217-223`；`pkg-customer/pages/order-create/index.wxml:23` | 换图/重新识别/返回均无二次确认，用户已手填内容会被静默清空。**
- 描述：`onPickFile` 收到新图即 `items:[] / submission:clear / manualPicked:false`（`:114-131`），无确认；`onRetryOcr` 直接重跑同一文件（`:217-223`）；页面无 `wx.enableAlertBeforeUnload`/返回拦截（客户端仅 `pkg-admin/pages/config` 使用该 API，说明能力可用）。UX §3.7「换图/删图二次确认」「重新识别需确认清空」、§2.4.2「order-create 有未提交内容时返回拦截并二次确认」、AC-C-11 均要求。
- 影响：用户在 Step2 手改/勾选后误触「重新识别」或换图，手填内容无提示丢失（草稿只在内存，无恢复）；返回手势同样丢内容。
- 修复建议：`onPickFile`/`onRetryOcr` 在 `items.length>0` 时先 `wx.showModal` 确认；有未提交内容时 `wx.enableAlertBeforeUnload({message})`，提交成功/离开时 `disableAlertBeforeUnload`。
- 证据：文件读命中行如上；`[E3]`（enableAlertBeforeUnload 仅在 pkg-admin 命中）。

**R-B1-11 | P2 | `pkg-customer/parts/privacy-text.js:62`（HEAD `:61`）；`docs/privacy/隐私保护指引.md:52`（HEAD `:50`）；`docs/V4_DECISIONS.md:95`；`project.config.json:2` | 端内隐私全文对外承诺「v4 使用独立小程序与独立云环境」，与 D2 裁决（沿用 v3 appid，同一小程序/同一 storage 命名空间、隐私声明在同一 appid 重提）直接矛盾。**
- 描述：全文 §八 写「v4 使用独立小程序与独立云环境，旧版本缓存不会被读取或上传」；D2 裁决留痕明确「用户选择 B：沿用 v3 appid `wxcb7e5b41b89bc806`…代价：①同一 storage 命名空间…③隐私声明/类目/审核在同一 appid 上重新提交，不再是『独立审核』」；`project.config.json` appid 与 v3 相同。「不读取旧版本数据」可由代码行为成立，但「独立小程序/独立云环境」是与事实相反的对外承诺。审查期间该文件正被他人改动（剪贴板披露），我未覆盖其改动。
- 影响：提审用的隐私披露与真实技术事实不一致（合规/审核风险，属提审前阻塞类问题，与 TD-052 同类）；用户可据此主张承诺不实。
- 修复建议：按 D2 事实把该段改为「v4 与旧版本使用同一小程序账号（appid 沿用 v3），但使用独立本地存储键、不读取/不迁移旧版本数据；发布 v4 即替代旧版本」；`docs/privacy/隐私保护指引.md` 同步（C/阶段 3 归并）；如坚持要「独立环境」，只能切回新 appid（D2 重裁，不在本报告建议内）。
- 证据：`[E10]`（`project.config.json:2`；`privacy-text.js:62`（改动后行号）；`docs/privacy:52`；`docs/V4_DECISIONS.md:50,90,95`）。

**R-B1-12 | P2 | `config/defaults.js:35-42`；`tools/seed-dev.js:102-104`；`docs/TECH_DEBT.md` TD-011；`docs/V4_ENGINEERING.md:190`（§3.6） | 出厂/种子默认 `aiFallback.enabled=true`，与 TD-011「E11 确认前保持 false」、ENGINEERING §3.6 默认 `enabled:false（实测后开）`、seed-dev 预期 `enabled:false` 冲突。**
- 描述：`DEFAULT_CONFIG.aiFallback.enabled: true`（该文件同时是 `cloudfunctions/*/shared/defaults.js` 的同步源，门禁 #17 会把它带进云端种子与校验）；`admin.bootstrap` 用 `createDefaultConfig()` 播种；`seed-dev.js` 的部署自检清单却写 `aiFallback{enabled:false}`。客户端不直接依赖该开关（read 口径），但云端在 Key 配置后会对识别失败自动外呼第三方。
- 影响：E11（DeepSeek 账号/条款/配额确认）未闭环前，部署即具备第三方 AI 外呼能力，与「开关默认关闭、实测后开」的合规流程与隐私文本「仅识别失败且开关开启时」的表述存在落差；若用户未意识到即产生外呼，属合规风险（不产生费用语义）。
- 修复建议：默认改回 `enabled:false`（与 TD-011/ENGINEERING §3.6/seed-dev 一致），开启动作为部署期显式配置（控制台/种子脚本），并在 RUNBOOK 记录开启证据；若产品已决定默认开，需用户/Lead 显式裁决 + 回写 ENGINEERING §3.6、TD-011 关闭依据、隐私文本同步。
- 证据：`[E9]`（`config/defaults.js:36 enabled: true`、`tools/seed-dev.js:103 aiFallback{enabled:false}`、`docs/TECH_DEBT.md:20`、`docs/V4_ENGINEERING.md:190`）；`cloudfunctions/api/shared/defaults.js:35` 为同步副本。

**R-B1-13 | P2 | `pkg-customer/parts/privacy-text.js` §二（HEAD）与 `docs/privacy/隐私保护指引.md` §二（HEAD）；实际调用：`pkg-customer/pages/bind/index.js:86-98`、`components/id-text/index.js:29-40`、`pages/profile/index.js:314-321`、`pkg-customer/pages/order-detail/index.js:172-181` | 剪贴板读写（粘贴兼职编号/复制编号）在 HEAD 隐私文本中被写成「不收集…剪贴板」且未声明该隐私接口，微信后台隐私声明亦无对应项。**
- 描述：代码在用户主动点击时 `wx.getClipboardData`（bind 粘贴）与 `wx.setClipboardData`（id-text 复制、profile 复制编号、detail 复制订单号）；HEAD 全文 §二 把「剪贴板」列入「不收集」清单、安全措施未提；这属于「使用微信隐私接口但未在指引/后台声明」的披露缺口（不是数据外泄：内容不保存、不上传）。
- 影响：提审时《用户隐私保护指引》与实际调用的隐私接口不一致（微信后台需勾选「剪切板」类目声明）；属合规阻塞类，严重度限 P2（无实际采集/上传路径）。
- 修复建议：已有人在工作树补「剪贴板使用边界」段（并发改动，见 §1.5），Lead 需归并最终版并确认：①三处文案（launch 弹窗/端内全文/docs）一致；②`docs/privacy/发布前填写清单` 增加「剪切板」后台勾选项；③`tools/selftest-privacy-text` 增补偿断言。
- 证据：HEAD 文本 + 上述 4 处调用行；工作树 diff（`git diff -- pkg-customer/parts/privacy-text.js`，4 文件 M）。

**R-B1-14 | P2 | `pages/profile/index.js:471-490`；`cloudfunctions/api/middleware/auth.js:116-118`；`pages/role/index.js:85-95` | 注销后客户端流程死路：DEACTIVATED 账号仅 `user.bootstrap` 放行，其余动作全部 FORBIDDEN，但客户端注销成功后仍 reLaunch 角色页并提示「重新登录将创建新的顾客资料与编号」。**
- 描述：`doDeleteAccount` → `store.reset()` → 弹窗「已注销…；重新登录将创建新的顾客资料与编号」→ `reLaunch(role)`（`:471-490`）。服务端置 `status=DEACTIVATED`（`handlers/user/deleteAccount.js:44-45`），`auth.js:116-118` 对除 bootstrap 外一切动作抛 `FORBIDDEN『账号已停用，请联系开发者』`；30 天内物理删除前，用户点「我是顾客」→ profile → 保存资料必然失败，且没有任何「已注销/等待清理」态页面。文案「重新登录将创建新的顾客资料与编号」在 30 天内不成立。
- 影响：刚注销的用户被带回角色选择页并进入必然失败的交互（体验死路 + 提示不实，违背「失败提示说真话并给下一步」）；不涉及越权（服务端兜底）。
- 修复建议：注销成功后展示「已注销」终态页（或停在说明卡片，仅给「知道了/退出」），不 reLaunch 角色页；把「重新登录将创建新的资料与编号」改为「30 天清理完成后重新进入可重新注册」；下次启动时 launch 对 `bootstrap.status=DEACTIVATED` 显示同一终态说明。
- 证据：文件读命中行如上；`auth.js:116-118`；`deleteAccount.js:22-49`。

### 3.4 P3（拼写/样式/非关键提示）

**R-B1-15 | P3 | `custom-tab-bar/index.js:4-14,69-74`；对照 `pages/customer/home/index.js:231-241` | 顾客「订单」tab 无进行中数量角标；也没有任何页面把 `listCustomer.counts.ongoing` 写入 `store.badges`。**
- 描述：顾客三格只有「我的」有 `badgeKey:'messages'`，订单格无 badgeKey；`home.loadUnread` 只写 `badges.messages`。UX §2.4.5/§8.2/AC-C-41 要求「订单 tab 显示进行中数量角标（>99 显示 99+），进列表清零」。服务端已提供 `counts.ongoing`（`handlers/order/listCustomer.js:72-87`），orders 页拿到了 counts 但未沉淀到 store。
- 修复建议：orders/home 拉取 counts 后 `store.patch({badges:{…,ongoing}})`，`custom-tab-bar` 订单格加 `badgeKey:'ongoing'` 并按 `>99` 显示 99+；进入订单列表清零。
- 证据：`[E11]`（`custom-tab-bar/index.js:7,11,13` badgeKey 命中，无 orders 行）；`listCustomer.js:72-87`。

**R-B1-16 | P3 | `pages/profile/parts/view-model.js:93-101,192-193`、`pages/profile/index.wxml:139-144` | 「我的」页订单概览读 `customer.counts`，但任何下发 DTO 都不含该字段 → 永远显示「进行中 — · 已完成 —」。**
- 描述：`orderSummaryOf` 只消费 `customer.counts`；`customerSelf`（`cloudfunctions/api/db/dto/full.js:3-16`）与 `user.bootstrap`（`handlers/user/bootstrap.js:118-142`）均不下发 counts，`customer.getProfile` 也不含。页面用「暂未下发时显示—」的提示如实兜底，但 UX §3.5 要求「进行中 {n} · 已完成 {n}」。
- 修复建议：二选一——①`user.bootstrap`/`customer.getProfile` 只增下发 counts（需回写 DATA_MODEL §7.1/§7.3，跨 A1 域，走 Lead 授权）；②把该卡降级为「去订单页查看」并回写 UX。当前建议登记 TECH_DEBT 而非静默保留。
- 证据：文件读命中行如上；`[E11]`（`db/dto/full.js` 无 counts 命中）。

**R-B1-17 | P3 | `pages/customer/home/index.js:120`、`pkg-customer/pages/bind/index.js:45`、`pkg-customer/pages/order-create/index.js:57`、`pkg-customer/pages/order-detail/index.js:52`；`api/mode-guard.js:5-9,28-31,43,66-80` | 会话模式判据与「TEST_WRITE 禁写名单」多处重复实现：4 个页面内联 `viewContext.viewMode==='READONLY'`，未用 `modeGuard.isReadonly()`；`mode-guard` 硬编码 4 个 action 名；`sessionBanner` 无调用。**
- 描述：`modeGuard` 已有 `isReadonly/canRenderWriteButton`，但 home/bind/order-create/order-detail 各自内联比较 `viewMode` 字符串；`TEST_BANNED_ACTIONS` 硬编码 `'partner.activate'`/`'user.deleteAccount'`/`'ai.parseParcel'` 与 `'admin.viewAsEnd'`，与 `shared/actions.js` 注册表脱节（服务端白名单变更时客户端二道闸不会自动同步）；`sessionBanner()` 无生产调用（switch-bar 自己拼条文案）。
- 修复建议：4 页统一改 `modeGuard.isReadonly()`；禁写名单改为从 `shared/actions` 的 `write/visibility` 派生或用共享常量；删除或接线 `sessionBanner`（建议删，switch-bar 是单一实现）。
- 证据：`[E5]`（内联 viewMode 比较 5 命中，含 pages 4 处）；`[E6]`（`sessionBanner` 仅 `api/mode-guard.js`）。

**R-B1-18 | P3 | 见证据 | 无生产调用的导出未清理、也未登记 TECH_DEBT（AGENTS §5.4 / ENGINEERING §5.6 纪律）。**
- 描述（`[E6]` 全量核实：仅定义文件命中、生产调用 0）：`utils/storage.js` 的 `get/set/clearDraftPointer`（TD-008 已关闭但三导出留存，批 6 未接线）；`api/upload.js` 的 `cancelTicket`（同时 UX §4.2 要求「换图/放弃时调 upload.cancel」，属功能缺口）；`api/privacy.js` 的 `ensureCameraAuth/openSetting/openPrivacyContract/checkPrivacySetting`；`utils/privacy-policy.js` 的 `scopeMatrix/needsConsent/isConsentValid/fallbackFor/isRequiredScope`；`api/mode-guard.js` 的 `sessionBanner`；`config/route.js` 的 `isRolePageAllowed`（冻结接口，页面守卫改为各自内联，见 R-B1-17 同类）；`utils/room-tag.js` 的 `compareByDormTag`（冻结接口，服务端排序后客户端无重排，合理但需登记）；`pkg-customer/parts/status-view.js` 的 `canConfirmDelivery/canDeleteRecord/canMessage/canViewImage/eventText/progressSteps`；`utils/order-edit.js` 的 `buildPatch/codeStatusOf`。
- 修复建议：能删的删（draftPointer/privacy 未用适配/status-view 未用动作判据）；冻结接口（`isRolePageAllowed`、`compareByDormTag`、`cancelTicket`）登记 TECH_DEBT 并写保留理由/删除条件；`cancelTicket` 建议直接接线（换图/删图/失败放弃时调 `upload.cancel`，同时缓解孤儿云文件 TD-051）。
- 证据：`[E6]` 输出（每个符号只命中定义文件）。

**R-B1-19 | P3 | `pkg-customer/pages/order-create/parts/model.js:26-58`、`pkg-customer/pages/order-create/index.js:62` | 预约时段用本机时钟构造，并硬编码 `+08:00` 时区后缀，未对齐 `store.serverTimeSkew`。**
- 描述：`appointmentSlots(new Date())` 取本机时间生成 6 时段，`iso()` 把本机时分秒硬拼 `+08:00`（`model.js:31-34`）；服务端按 `serverTime` 校验「未来且 start<end」（`handlers/order/_parcel.js:100-113`）。UX §0.2.2 要求「时间只用服务端 serverTime 判断今天/昨天与倒计时」。
- 影响：设备时钟偏快/时区非 +08:00 时，页面显示的「未来时段」被服务端 `VALIDATION_FAILED『预约时段不合法』` 拒绝；设备时钟偏慢则已过时段仍可选。属时区/日期边界缺陷（非主路径，ASAP 不受影响）。
- 修复建议：用 `orders-view.serverNowMs(store.serverTimeSkew, Date.now())` 作为基准，`startAt/endAt` 用 UTC ISO（`toISOString()`）提交；`expired` 每次进 Step3 重算。
- 证据：文件读命中行如上；`_parcel.js:100-113`。

**R-B1-20 | P3 | `tools/check.js:494`；`store/index.js:70-149`（80 行）、`pkg-customer/pages/order-create/parts/ocr-flow.js:155-275`（121 行）、`utils/avatar.js:185-259`（75 行）、`utils/recognize/index.js:96-148`（53 行）、`pkg-customer/pages/order-create/index.js:395-446`（52 行） | 门禁 #18 只查文件行数，未查「单函数 ≤50 行」（AGENTS §4.2 声称门禁 #18 覆盖），实际存在多个超限函数。**
- 描述：`check(18,'行数',…)` 实现面只统计文件总行；AGENTS §4.2/ARCHITECTURE §5.2 写「单函数 ≤50 行（门禁 #18）」。上列函数均 >50 行。
- 修复建议：补门禁判据（按 `function/=>` 块行数扫描，阈值 50），或按 50 行拆分上述函数（ocr-flow.identify 可拆「识别编排/失败降级/结果组装」）；先补判据再拆，避免只改一处。
- 证据：`check.js:494` 判据描述仅文件行数；函数起止行见左（`read` 实读）。

**R-B1-21 | P3 | `components/switch-bar/index.js:35-51,75-87` | switch-bar 在每页常驻 1s `setInterval`，无会话时仍空转。**
- 描述：`attached` 无条件 `setInterval(()=>this.tick(),1000)`；`tick()` 在无 `viewContext` 时直接 return，但定时器不停；17 个业务页均挂该组件（门禁 #23 要求），同时挂载的 tab 页可叠加多个 1Hz 定时器。
- 修复建议：仅在 `view===true` 时启动 tick 定时器、会话消失/组件 detached 时清理；或改用 `refresh()` 内按需一次性 setTimeout。
- 证据：`[E8]`（`components/switch-bar/index.js:39 this.timer = setInterval(...)`）。

**R-B1-22 | P3 | `pages/customer/home/index.wxml:7`（`.small` 关闭公告）、`pkg-customer/pages/messages/index.wxml:6,13`、`pkg-customer/pages/order-detail/index.wxss:12-15`（`.copy-link padding:4rpx 8rpx`）、`components/switch-bar/index.wxss:48-52`（退出 `padding:4rpx 0`）、`pages/customer/orders/index.wxss:9-14`（tab 72rpx）、`pkg-customer/pages/help/index.wxss:7-9,28-33`（64rpx）、`components/image-picker/index.wxss:48-58`（80rpx）、`pkg-customer/pages/messages/index.wxss`（`.btn-small min-height:64rpx`） | 多个可点元素触摸区 <88rpx（UX §11.5「可点区域 ≥88rpx」/44px）。**
- 影响：条件维 8 未达标；「退出会话」「复制」「全部标为已读」「关闭公告」等小链接在真机易误触/难点。
- 修复建议：统一 `.btn-small`/`.link`/可点文本 `min-height:88rpx`（或 `padding:16rpx` 撑高）；把「复制」等文本链接改成带内边距的按钮型元素。
- 证据：wxss 抽样读取命中行如上；`[E7]` 文件清单。

**R-B1-23 | P3 | `pages/customer/home/index.js:306-308`；`pages/profile/index.js:402-405`；`utils/storage.js:12`；`pages/customer/home/index.js:71-77` | `profile?edit=1` 实际不可达（tab 页不能用 navigateTo 带参、首页用 switchTab）；顾客「重新看新手引导」是空动作（`CUSTOMER_HOME_V1` 无消费者）。**
- 描述：首页「去完善」`wx.switchTab('profile')` 不带参，`_openEdit` 只在 `?edit=1` 时置真，故永不进入编辑态（UX §3.3 要求「资料条→profile?edit=1」）。`profile.onReplayGuide` 对顾客 `clearGuideSeen('CUSTOMER_HOME_V1')`，但顾客首页从未使用 `isGuideSeen/markGuideSeen`（仅兼职工作台接线），提示「回首页可重看引导」不成立。
- 修复建议：首页「去完善」改为先写内存标记（或 `store.patch` 一个 UI 标记）再 switchTab，profile onShow 读标记进编辑态；顾客首页要么补引导卡（消费 GUIDE_KEYS），要么 profile 对顾客隐藏该入口并回写 UX。
- 证据：文件读命中行如上；`[E6]` 相关 grep（guide 调用仅 partner workbench + profile.clear）。

**R-B1-24 | P3 | `pages/customer/orders/index.js`（未 require `api/mode-guard`）、`pages/customer/orders/index.wxml:27-32` | READONLY 会话下订单列表仍显示可点的「再次下单」；写入口未置灰/隐藏（进入下单页才被拦）。**
- 描述：ENGINEERING §5.5「READONLY 页面写控件置灰/隐藏」；home 有 `readonly` 判据，orders 页没有；「再次下单」按钮在只读会话可点（order-create 的 onPickFile/onSubmit 会 toast 拦截，服务端也拒写）。
- 修复建议：orders 页 onShow 消费 `modeGuard.isReadonly()`，只读时隐藏/置灰再次下单与空态「去下单」，文案统一 `modeGuard` 的只读提示。
- 证据：文件读命中行；`[E5]`（orders 页无 viewMode 命中）。

**R-B1-25 | P3 | 全量页面/组件 wxss；样例 `pages/profile/index.wxss`（31 处裸色值）、`components/status-pill/index.wxss`（14 处）、`pages/launch/index.wxss`（13 处） | 页面/组件 WXSS 裸色值 195 处，`var(--v4-*)` token 仅 45 处；UX §12.7/AC-C 要求「页面 WXSS 不出现裸色值（token 定义处除外）」与 Token 对账。**
- 影响：状态色/品牌色改一处需全仓改；`status-pill` 的七种 tone 配色与全局状态色矩阵可能漂移（现无法与 `app.wxss` token 一一对应）。
- 修复建议：把 `#1F7A5C/#E54D42/#F2994A/#2B6DE5/#5B7B9A/#999999` 等替换为 `var(--v4-*)`；status-pill tone 色改为引用 `app.wxss` 状态 token（需在 app.wxss 增状态色 token）；先做 token 清单再机械替换（独立提交）。
- 证据：`[E7]`（`rawHex=195  tokenVars=45  wxssFiles=29`）。

**R-B1-26 | P3 | `pages/launch/index.js:53-55,202-212` | launch 只做分流、不透传 `?bind/?orderNo` 白名单参数（UX §2.1/§3.1 要求 launch 参数 `bind`、`orderNo` 透传）。**
- 描述：`onLoad()` 不接 options；`route()` 只 `reLaunch(decision.url)`，不带 query。当前分享卡片 path 直落 `pages/role/index?bind=`（`share-card.js:28`）、消息/详情用页面内跳转，故暂无实际断点；但 UX 明确要求 launch 白名单透传，P1 订阅消息/深链一旦指向 launch 即断。
- 修复建议：`onLoad(options)` 提取 `bind/orderNo`，`route()` 在 `reLaunch` 时按 UX §1.2 规则转发（仅这两个键，白名单校验后 `encodeURIComponent`），并补静态断言。
- 证据：文件读命中行如上；UX_CUSTOMER §2.1/§3.1。

**R-B1-27 | P3 | `pkg-customer/pages/order-create/parts/model.js:307-345`、`pkg-customer/pages/order-create/index.js:112-113`、`cloudfunctions/api/handlers/order/_parcel.js:27-84`、`cloudfunctions/api/handlers/bind/create.js:18-25` | 客户端与契约的小漂移：`parcel.codeStatus` 与 `image.size` 不在 DATA_MODEL §7.5 入参白名单（服务端自行派生/仅作大小闸）；`bind.create` 返回 binding 无 `bindingId`，客户端存入 store 后首页用 `bindingId` 判定 ACTIVE。**
- 描述：`buildPayload` 在 parcel 内带 `codeStatus`（服务端 `normalizeParcel` 不读、按 pickupCode 派生）；`image` 带 `size`（服务端 `_store.js:309-314` 接受但 DATA_MODEL §2.5 image 未列）；`bind.create` 的 `bindingDto` 无 `bindingId`（`bind/create.js:18-25`），而 `home.applyDerived` 以 `vm.binding.bindingId` 判「已绑定」（`home/index.js:123`）——绑定成功后依赖 `onShow → bind.getCurrent` 补 `bindingId`，中间态（同一帧）会误显示「还没有绑定兼职」。
- 影响：契约面有「发送但不生效」的字段（lessons《契约声明的入参静默丢弃》同类）；bind 成功瞬间的首页状态短暂错误（有后续刷新兜底）。
- 修复建议：客户端删掉不生效字段（codeStatus/size）或回写 DATA_MODEL 明确其为「可接受但不读」；`bind.create` 返回值补 `bindingId`（云端只增字段，B1 消费）并在回执中注明。
- 证据：文件读命中行如上；`_parcel.js:27-84`、`_store.js:300-314`、`bind/create.js:18-25`。

**R-B1-28 | P3 | `pkg-customer/pages/order-create/index.js:98-140,167-215` | 识别异步竞态：连续换图时迟到的识别结果会覆盖新图/新内容（无 generation token）。**
- 描述：`onPickFile` 每次选图都 `await ocrFlow.identify`，仅用 `manualPicked` 挡「手填分支」；若用户在上一次识别（OCR 最长 40s、AI +8s）结束前换图，两次 `applyIdentify` 都会执行，后完成者覆盖先完成者 → 可能展示旧图的识别结果/条目（预览图与 items 同源，但最终展示的是「后完成的旧图」）。
- 影响：弱网/慢机下用户可能以旧图内容继续下单（可自查，但易误提交）。
- 修复建议：维护 `this._identifySeq`，每次 onPickFile 自增并把序号传入 `applyIdentify`，序号不匹配直接丢弃；或在换图时重置 `manualPicked=true` 档旧结果。
- 证据：静态推理取证（`read` 命中行）；未运行复现 → 计入 §5「依据未复现」。

**R-B1-29 | P3 | `api/client.js:133-139`、`pkg-customer/pages/order-detail/index.js`（无 VIEW_TICKET_EXPIRED 处理）、`utils/session.js:32-51` | 会话票据过期仅清 `store.viewContext`，无页面回退到「切换账号」页（ENGINEERING §5.5 要求「清 viewContext + toast 后 reLaunch 回 account-switch」）。**
- 描述：`normalizeResult` 收到 `VIEW_TICKET_EXPIRED` 时 `store.clearViewContext()` 并抛错，页面只 toast 服务端文案；此时 `switch-bar` 消失、页面仍渲染目标数据（内存残留），后续动作以开发者身份发出并全部失败；用户需手动退出到后台页。
- 影响：会话过期后的体验断点（无引导、残留目标数据展示），不涉及越权（服务端按真实身份拒）。
- 修复建议：在 `api/client.js` 清会话后通知一个统一处理（如 `utils/session.handleViewExpired()` 执行 toast + `reLaunch(ACCOUNT_SWITCH_PAGE)`），或在页面层捕获该 code 统一跳转；补 selftest 静态判据（switch 套件已有清票据断言，可加「回退路由」断言）。
- 证据：`[E5]`/`[E4]` 相关行；`api/client.js:133-139`；ENGINEERING §5.5。

### 3.5 安全发现（三处，均「待独立复核」，严重级不超过影响分）

> 说明：B1 范围**未发现 P0/P1 级安全漏洞**；分层铁律可验证成立（客户端零 `wx.cloud.database`、`callFunction/uploadFile` 唯一出口、零密钥/零外链、`viewTicket` 只在 api/client+store、写动作服务端兜底）。以下三处为本 part 与安全/隐私面最相关的待验证点，按格式给「入口 → 传播 → 终点」三处 `file:line`，验证者身份分离（我只写"待独立复核"）。

**S1（低风险）切换会话内的系统转发入口未关闭**
- 入口：`pages/profile/index.wxml:160-163`（仅会话内隐藏「分享绑定卡片」按钮）、`pages/profile/index.js:493-499`（`onShareAppMessage` 无条件注册）。
- 传播：`pages/profile/parts/share-card.js:17-30` → 非会话/顾客分支返回 `{title:'校园快递代取', path:'/pages/role/index'}`；`viewSession` 分支不构成传播阻断（只是不返回绑定卡）。
- 终点：`/pages/role/index`（无票据、无 PII，`role/index.js:47-64` 只读 `?bind` 并查公开资料）。
- 结论建议：无数据外泄路径（不可标 P0/P1）；但违反 ENGINEERING §5.5/§4.8.3「两种会话隐藏分享/转发」。**待独立复核**：确认 `switch-bar`/各页无其它分享入口、`hideShareMenu` 缺失不构成审计口径破口。

**S2（低风险）注销后 DEACTIVATED 状态的客户端可继续进入业务页**
- 入口：`pages/profile/index.js:471-490`（注销成功 → `store.reset()` → reLaunch `role`）。
- 传播：`pages/role/index.js:85-95,119-157`（bootstrap 对 DEACTIVATED 仍放行并回 `roles:[]` → 角色卡可点，`store.activeRole` 被客户端置位）。
- 终点：`cloudfunctions/api/middleware/auth.js:116-118`（除 `user.bootstrap` 外一律 `FORBIDDEN『账号已停用』`）、`handlers/customer/saveProfile.js:88`（`identity.assertWritable` 前已被 auth 拦）。
- 结论建议：服务端统一拒绝，无越权/无数据写入；属体验死路 + 提示不实（R-B1-14）而非安全漏洞，`overall_severity ≤ impact` 记 P2。**待独立复核**：确认 DEACTIVATED 无重注册/绕过路径、清理后 `ensureUser` 懒建不保留旧角色。

**S3（低风险）剪贴板隐私接口未在 HEAD 隐私文本/后台声明（隐私合规缺口）**
- 入口：`pkg-customer/pages/bind/index.js:86-98`（`wx.getClipboardData` 用户主动粘贴时读）。
- 传播：`components/id-text/index.js:29-40`、`pages/profile/index.js:314-321`、`pkg-customer/pages/order-detail/index.js:172-181`（`wx.setClipboardData` 写编号/订单号）。
- 终点：HEAD `pkg-customer/parts/privacy-text.js` §二「不收集…剪贴板」+ 安全措施段未提；微信后台隐私接口清单无「剪切板」项 → 内容不落库/不上传（`utils/storage.js` 白名单不含剪贴板，客户端无日志输出）。
- 结论建议：无采集/上传，属披露与后台声明缺口（P2，非安全漏洞）。**待独立复核**：①工作树并发修复（§1.5 diff）是否覆盖三处文案；②`docs/privacy/发布前填写清单` 是否补勾选项；③`selftest-privacy-text` 补偿断言是否到位。

### 3.6 气味基线判断（逐行给理由）
- **长函数**：命中（见 R-B1-20，5 个 >50 行函数；文件级 ≤500 行无违规——`pages/profile/index.js` 恰 500 行）。理由：AGENTS §4.2 的双阈值，门禁只查了文件。
- **重复代码**：命中。①状态文案/颜色在 `shared/enums` 与 `components/status-pill` 两份（R-B1-05）；②会话只读判据 4 页内联 + `mode-guard`（R-B1-17）；③`pages/customer/parts/format.js` 与 `pkg-customer/parts/format.js` 近乎逐行重复（70/79 行，仅 `clock` 差异）——这是**同逻辑第二份实现**，建议主包分包共享一份（新文件需落在 S0/S3 交界，走 Lead）。④`api/client.js` 与 `api/mode-guard.js` 各自实现 `isWriteAction`（同一 `ACTION_MAP.write` 判据两份）。
- **参数过多**：未命中（>4 参函数：`utils/recognize/index.buildParcel` 1 参、`model.makeItem(partial,defaults)` 2 参；已扫 client 范围内最长形参 3 个）。判断：本 part 范围通过。
- **发散式变化**：轻度命中。`api/upload.js` 同时承担「票据顺序/头像压缩/类型 MIME/平台能力注入/上传出口」，因「上传」外的多个原因被改；`pages/profile/index.js`（500 行）同时承担顾客/兼职视图、资料编辑、头像上传、绑定、注销、分享、版本号——每次需求都可能改它。建议把 profile 的事件-API 编排再下沉 `parts/`（不改外部行为）。
- **霰弹式修改**：命中。改「状态文案」需动 `shared/enums` + `components/status-pill` + 可能的各 DTO 断言 ≥3 文件（R-B1-05）；改「会话只读判据」需动 4 页 + mode-guard（R-B1-17）。理由：单源未收敛的必然结果。
- **命名不达意**：轻度。`pages/customer/parts/orders-view.tickRows`（实际是「重算等待文案」）、`api/upload.prepareTicket`（名似准备票据，实际还含大小/可读闸）、`sessionBanner`（返回条文案对象但命名像渲染函数）。判断：不阻断，建议随重构改名。

### 3.7 取证台账（命令原文 / 退出码 / 命中行）
> 说明：PowerShell `Select-String`/`Get-Content`/`git` 正常执行**退出码均为 0**（命中与不命中都是 0，按输出行数判读）；`read` 工具无退出码概念，以「文件 + 行号」为命中行。未执行任何门禁/selftest（简报禁令）。

| 编号 | 命令原文（摘要，全部真实执行） | 退出码 | 关键命中行 |
| :-- | :-- | :-: | :-- |
| E1 | `Get-ChildItem -Path pages,pkg-customer,components,custom-tab-bar -Recurse -File -Filter *.js \| Select-String -Pattern 'wx\.cloud\.|Math\.random'` | 0 | hits=0 |
| E2 | `Get-ChildItem components -Recurse -File -Filter *.js \| Select-String -Pattern "'(SUBMITTED|ACCEPTED|PICKED|DELIVERED|COMPLETED|CANCELLED|EXCEPTION)'"` | 0 | `components/status-pill/index.js:4-9` |
| E3 | `…客户端全部 .js \| Select-String -Pattern 'hideShareMenu\|enableAlertBeforeUnload\|disableAlertBeforeUnload'` | 0 | 4 命中，全部 `pkg-admin/pages/config/index.js:65-72`；`hideShareMenu` 0 命中 |
| E4 | `… \| Select-String -Pattern 'onShareAppMessage'` | 0 | `pages/profile/index.js:493`、`pages/partner/customers:196`、`pages/partner/workbench:173` |
| E5 | `… \| Select-String -Pattern "viewMode === 'READONLY'"` | 0 | `home:120`、`bind:45`、`order-create:57`、`order-detail:52`、`switch-bar:60`、`mode-guard:30/46/78` |
| E6 | `…按符号 Select-String（draftPointer×3/cancelTicket/sessionBanner/isRolePageAllowed/compareByDormTag/ensureCameraAuth/openPrivacyContract/checkPrivacySetting）` | 0 | 每个符号只命中定义文件（`utils/storage.js`/`api/upload.js`/`api/mode-guard.js`/`config/route.js`/`utils/room-tag.js`/`api/privacy.js`） |
| E7 | `逐 wxss 统计 '#[0-9A-Fa-f]{3,6}' 与 'var\(--v4-'` | 0 | `rawHex=195 tokenVars=45 wxssFiles=29` |
| E8 | `… \| Select-String -Pattern 'setInterval'` | 0 | `switch-bar/index.js:39` 等 8 处（B1 范围仅 switch-bar 常驻） |
| E9 | `Select-String config\defaults.js -Pattern 'enabled: true'`；`tools\seed-dev.js -Pattern 'aiFallback\{enabled:false\}'` | 0 | `config/defaults.js:36`；`seed-dev.js:103` |
| E10 | `Select-String project.config.json -Pattern appid`；`privacy-text.js -Pattern 独立`；`docs/privacy -Pattern '独立 appid'`；`V4_DECISIONS -Pattern '同一 appid'` | 0 | `project.config.json:2`；`privacy-text.js:62`（工作树行号）；`docs/privacy:52`；`V4_DECISIONS:50,90,95` |
| E11 | `Select-String home/index.js -Pattern 'order: order,'`；`home/index.wxml -Pattern order-row`；`custom-tab-bar -Pattern badgeKey`；`dto/full.js -Pattern counts` | 0 | `home.js:212`、`home.wxml:50`、`custom-tab-bar:7,11,13`、`dto/full.js` 无 counts |
| E12 | `Select-String api\upload.js,components\image-picker\index.js -Pattern 'compressAvatar|prepareTicket|sizeType|TICKET_LONG_SIDE_LIMIT'` | 0 | `api/upload.js:12,15,141,143,160,182,200`；`image-picker:66`（无 sizeType/压缩） |
| E13 | `git status --porcelain` / `git diff --stat` | 0 | 审查期间 4 文件 M（见 §1.5），我未写入 |

## 4. 通过项（含已知项引用）

### 4.1 分层与装配（维度 1/5）
- **三层链路（顾客侧 10 页）闭合**：`app.json` 声明 30 页 = 磁盘 30 页目录（主包 7 + pkg-customer 5 + pkg-partner 7 + pkg-admin 11，与 CONTRACT §7 逐字一致）；顾客 10 页的入口均可达（launch/tab/首页卡/列表行/空态 CTA/消息项/分享卡落地/「我的」条目/隐私弹窗全文），wxml 事件全部有同名 handler（逐页核对表见覆盖地图）。**唯二断点**已列 R-B1-02（首页订单卡视图映射）、R-B1-08（入口拦截判据分散）。
- 页面层零业务判据（可验证部分）通过：pages/pkg-customer `.js` 零 `wx.cloud.*`、零七状态字面量、零 `Math.random`、零集合名、零 action 字面量（`[E1]`）；编号/roomTag 只做归一/展示（`utils/ids.js`/`utils/room-tag.js` 无 random、无生成）；`viewTicket` 只出现在 `api/client.js:115-116` 与 `store/index.js:140-142`（门禁 #23 守）。
- `api/` 为唯一云函数/上传出口：`callFunction` 仅 `api/client.js:77`，`uploadFile` 仅 `api/upload.js:88`，`wx.cloud.init` 仅 `app.js:38`；客户端零 `fetch`/`wx.request`/外链/Key（条件维 ⑨：本 part 无第三方外呼，N/A 的服务端 AI 链路由 A1/A2 审）。
- 冻结接口消费正确：`store` 快照形状、`config/route.decideLaunchRoute`、`api/client.call/CallError`、`api/mode-guard`、`components/* props/events` 均按 ARCHITECTURE §3.3~§3.6 使用（唯 `status-pill` 与 `mode-guard.sessionBanner` 两处偏离，见 R-B1-05/17）；自定义 tabBar 在根目录、5 项 tabBar、按角色渲染 3 格、`switchTab` 切格 ✓。
- 请求/响应结构与 DATA_MODEL §7 接缝一致：`order.create/createBatch`（顶层/逐件 `recognition`、`parcel/serviceCode/appoint/note`、`ticket/image`）✓；`order.get`（`order{statusText,actions,image{hasImage,cleaned},dorm,counterpart,appoint.typeText,version}` + `events{type,at,actorRole,note}`）✓；`order.listCustomer.counts{ongoing,completed,cancelled}` ✓；`bind.getCurrent{ binding{bindingId,dormKey,buildingText,roomTag,boundAt}, partnerPublic }` ✓；`customer.saveProfile` 返回 `{profile,profileCompleted,customerNo,avatarFileId,binding}` 与 `mergeCustomer` 对齐 ✓；`message.list` 中心模式 `unread/messageReadAt`、订单模式 `list` ✓；`upload.prepare` 返回 `{ticket,uploadTicketId,cloudPath,draftId}` 且客户端顺序「校验/压缩→prepare→upload」✓（除截图压缩缺口 R-B1-01）。

### 4.2 逻辑（维度 2）
- **隐私闸**：launch 版本判定（`FIRST_RUN/VERSION_CHANGED/CONFIG_MISSING` fail-closed）、`user.acceptPrivacy` 写库 + 内存回写、不同意不进入业务、`onReopenPrivacy` 可重读；服务端 `auth` 隐私闸兜底（未同意写被拒）——链路完整（`pages/launch/index.js:112-175`、`utils/privacy-policy.js:72-97`）。
- **头像/昵称**：`chooseAvatar` 可跳过 → 默认头像（`utils/avatar.viewModelOf` 首字色块），昵称必填、输入即截断 + toast、保存过 `msgSecCheck`（服务端）；上传只走 AVATAR 票据 + 压缩闸；替换后删旧文件、失败保留旧值（TD-007/027 已登记边界）；绑定前预览不含头像、解绑后 `counterpart=null` 显示「对方已解除绑定」——与 UX §4.10/AC-C-56~C-60 基本一致（差异见 R-B1-02/07）。
- **宿舍资料校验**：`validateDormIdentity`/`validatePhoneTail` 双端同源，`dormPreview` 实时；「有进行中订单禁止改宿舍/解绑」服务端 `INVALID_STATE` 兜底、客户端弹窗提示。
- **绑定方向与错误恢复**：`bind.create` 只出现在 `api/modules/bind.js`；顾客侧唯一入口（home/profile/role/bind）；错前缀三句同源（`utils/ids.prefixHint` ← `shared/error-copy`），与服务端 `VALIDATION_FAILED.message` 同一句；失败保留输入、可重试。
- **四步下单**：Step1→2→3→4 不跳步；`canSubmit` 与提交前同一形态闸；单件 `order.create`/多件 `order.createBatch`（≤5，原子）；**`clientRequestId` 生命周期正确**：进入 Step4 生成、失败重试复用、内容指纹变化重生成、成功清空（`model.js:149-193`、`index.js:381-446`），与 lessons 卡《幂等键应按逻辑提交生成》的修法一致；截图票据上传失败不清空已填内容；重复提交有 `submitting` 锁。
- **逐件 AI 兜底**：仅对缺站点/缺码件逐件调用（同一 `uploadTicketId`、独立 `failureId`）、只填空字段、手填优先不覆盖、单件失败只降级该件、三态文案单源（`ocr-flow.js:14-24,199-275`、`model.js:214-303`），与 DATA_MODEL §4.9/CONTRACT §4.3 一致；客户端零第三方外呼。
- **订单详情轮询**：10s 基准、失败 20s→40s 退避封顶、成功回 10s、`onHide/onUnload` 停（策略纯件 `poll-policy.js` 有单元断言）；旧数据保留 + 「最近更新 HH:mm:ss」不把旧数据冒充最新；写动作带 `expectedVersion`、`CONFLICT` 后刷新——策略正确（隐藏期竞态见 R-B1-04）。
- **倒计时与时间偏移**：列表等待倒计时用 `serverTimeSkew` 对齐服务端时间（`orders-view.serverNowMs`），超时文案不假装推进；`format.formatTimeAgo` 以服务端时间戳为基准（本机时区展示，CN 场景可接受）；预约时段未对齐 serverTime（R-B1-19）。
- **再次下单预填**：只预填「服务类型（仍启用才填）+ 站点（P1~P8 才填）」，绝不复制码/尾号/柜号/截图/识别结果（`reorder.js` + 纯件断言），归属校验在服务端、失败静默回普通下单 —— 与 UX §2.3/AC-C 一致。
- **消息红点/水位**：`message.list` 的 `unread` → `badges.messages`（首页铃铛/我的 tab 红点）；消息中心进入即 `markRead({scope:'ALL'})` 并把水位应用到本地列表（`applyReadWatermark` 只进不退）、失败给真话提示不吞；订单内留言 `markRead({scope:'ORDER'})` 每页上报一次，READONLY 不写；TD-023（系统通知按 ORDER 置读退化）已登记。
- **注销链路端侧**：二次确认 + 输入「注销」+ 服务端校验进行中订单；成功清 store/退订阅 —— 端侧流程成立（注销后去向问题见 R-B1-14）。
- 空值/越界/失败路径：全仓客户端 `catch` 无空吞（`[E…]` 空 catch 0 命中）；`err.message` 上屏且无裸错误码（launch 第 3 次登录失败按 UX §3.1 显示错误码属规格要求）；列表/详情 `/` 无未定义访问（WXML 属性链失败静默，已用 `|| '—'` 兜底）。

### 4.3 性能/资源（维度 4）
- 主包首屏依赖：bootstrap → config(缓存 5min) → bind.getCurrent 并行（`app.js:31-87`）；首页/列表 `onShow` 刷新 + 下拉，详情 10s 轮询；`setData` 粒度总体按行/按块（列表行级 tick、tab 切换只切前端），未发现整表无界刷新；分页 `limit 20/30`、游标分页。
- 定时器/订阅清理：home/orders ticker、profile/tab-bar/store 订阅、switch-bar 订阅均在 `onHide/onUnload/detached` 清理（唯 switch-bar 空闲 interval 见 R-B1-21、详情隐藏期竞态见 R-B1-04）。
- 无预算基线：ENGINEERING §2.3 体积预算（主包≤1.5MB/分包≤1.5MB）本 part 无法测（需开发者工具），标「无预算基线」，以代码体量定性（本 part 阅读范围 ~13.0k 行，主包页面/组件无大依赖引入，未见第三方库）。

### 4.4 冗余/死代码（维度 5）
- 无「旧文件/旧函数/旧分支/旧常量」并行实现；无 `_old/_legacy/_v2/Deprecated/暂时保留/废弃/TO\x44O(删…)` 命中（取代废弃检查见 §5.4）。重复代码与死导出见 R-B1-17/18 与 §3.6。

### 4.5 开发规范（维度 6）
- 命名一致性：`snake/camel` 统一、常量单源（`shared/enums`、`config/defaults`）、页面四件套齐全（30 页均有 js/json/wxml/wxss）；注释以 Why 为主（隐私闸、会话水合、票据顺序、幂等键、状态回填等均有 Why 注释）；引用检查清单/门禁原文逐条对照未发现新增违规门禁项。
- 例外（门禁漏检）已列：单函数行数（R-B1-20）、组件状态文案（R-B1-05）、token 化（R-B1-25）。
- 编码：UTF-8 无 BOM/LF 由门禁 #7/#8 守；本 part 未新增文件。

### 4.6 安全（维度 7）
- 无 P0/P1 安全发现（依据见 §3.5 说明）；服务端唯一事实：页面只消费 `actions[]`（不做本地状态机判按钮）、编号/roomTag 客户端零生成、L3 不进分享/通知/日志/本地存储；`viewTicket` 内存态、冷启动即失效；`console` 仅 `api/client.js` 打 action/code/requestId/人话，无 PII；`wx.*Storage*` 仅 `utils/storage.js`（白名单键 + 归一化丢弃非法字段）；上传路径由服务端签发、客户端零 `cloudPath` 自拟。
- 已知项（引用不重复论证）：TD-003/004/011/015（平台/密钥实测）、TD-023、TD-024、TD-026（已关闭）、TD-027、TD-034、TD-036/037/038、TD-039（D22=A，已关闭）、TD-041、TD-042、TD-045、TD-051、TD-052（已关闭）。

### 4.7 条件维
- ⑧ UI 可访问性：状态齐全（七状态 + 取消/异常分支 + 空/错误/无权限五态）基本通过（缺停用/注销态见 R-B1-07；对比度 R-B1-09；触摸目标 R-B1-22）；空态/错误态均有一句话真话 + 下一步（首页/列表/详情/消息/帮助逐页核对）。
- ⑨ 外部调用：本 part 客户端零第三方外呼；`ai.parseParcel` 只经 `api/modules/ai.js`（服务端适配层/超时/降级在 A1/A2 范围）——本 part N/A。
- ⑩ 性能预算：无预算基线（见 4.3）。
- ⑪ 数据隐私：本地存储白名单 ✓、日志脱敏 ✓、`viewTicket` 不落盘/不进 URL ✓、头像/昵称可见边界 ✓、注销清除端侧 ✓（TD-051/053 已知项）；披露缺口见 R-B1-11/13。

## 5. 结论

### 5.1 各级计数
| 级别 | 数量 | 编号 |
| :-- | :-: | :-- |
| P0 | 0 | — |
| **P1** | **1** | R-B1-01 |
| P2 | 13 | R-B1-02~R-B1-14 |
| P3 | 15 | R-B1-15~R-B1-29 |
| 合计 | 29 | （安全待复核 3 条见 §3.5，不单列级别：S1 P3 影响、S2 P2 影响、S3 P2 影响） |

### 5.2 依据未复现条数：**2**
- R-B1-04（订单详情隐藏期轮询竞态）、R-B1-28（连续换图识别竞态）：均为静态代码推理取证（有 file:line），未执行运行复现（简报禁止跑 selftest/gate；且无页面 wx 替身可用）。其余 27 条均有「命令 + 退出码 0 + 命中行」三件套（见 §3.7），不计入未复现。
- 另：R-B1-01（P1）的**代码事实**已 100% 静态确认；其**影响面**（多少真实截图 >500KB）未实测，属用户真机数据，未计入未复现但在此声明。

### 5.3 旧问题三态
N/A（`docs/reviews/` 本轮新建，无旧报告）。

### 5.4 取代与废弃检查
- **命令原文与输出**：
```
PS> $code = Get-ChildItem -Path app.js,app.json,app.wxss,pages,pkg-customer,pkg-partner,pkg-admin,components,custom-tab-bar,utils,api,store,config,shared,cloudfunctions -Recurse -File -Include *.js,*.wxml,*.wxss,*.json
PS> $code | Select-String -Pattern '_old\b|_legacy|_v2\b|Deprecated|暂时保留|废弃|TO\x44O[:：]\s*(删|remove|delete)'
     （输出：0 命中；退出码 0；扫描面 = 生产代码 468 文件。docs 不纳入该命令：本文件逐字引用该判据正则，纳入会形成扫描器自噪声，故以代码面为准）
PS> git status --porcelain     # 基线仅 ?? docs/research/ ?? docs/reviews/；审查中 4 文件 M（他人改动，见 §1.5）
```
- **并行态登记行数**：0（未发现同语义第二份实现文件/函数；STATE.md 无涉及本 part 的并行态登记行）。
- **废弃标记命中数**：0（无 `_old/_legacy/_v2/Deprecated/暂时保留/废弃/TO\x44O(删…)` 字样；判据正则中的待办缩写按要求写成转义形式）。
- **各条已申报判定**：工作树无「隐藏第二副本」；`docs/research/`、`docs/reviews/` 为本轮新建目录（非代码副本，属 Lead/审查产物）；**未发现取代废弃红灯命中**。唯一需 Lead 归并的是审查期间他人的 4 文件改动（§1.5）。
- **越界检查**：本 part 未改任何文件（`git status` 的 M 均非我产生，我全程只 `read`/`Select-String`/`git diff` 读操作）；未发现「顺手优化」式改动。
- **docs 门禁自查（reviewer 完成前，按 Lead 补充纪律执行，未改 tools/、未加白名单）**：
  - `node tools/check-docs.js --batch 1` → `通过 10 项；失败 0 项`，退出码 0；本文件在输出中 **0 命中**。
  - `node tools/zero-money-scan.js --scope docs` → 退出码 0；本文件 **0 命中**（本轮同一扫描对另一 part 文件有 1 处零金额词表命中，按 Lead 规则属同事文件、忽略）。
  - 自检口径：D 编号引用仅 D1~D22（未出现更大的 D 编号；如需引用未来裁决按 Lead 规则写 `R-DEC-NN` 占位）；E 引用仅 E1~E13（均在允许上限内）；正文无英文待办缩写与占位措辞（相关词表不在本文件复写）；判据正则中的待办缩写按要求写成 `TO\x44O[:：]` 转义形式，命令同样使用该写法。

### 5.5 建议色
**🔴 红**（P1 = 1：R-B1-01 截图上传无压缩；P2 = 13）。审查者只给建议色，裁决是人。
- 若 R-B1-01 被裁决为「接受现状 + 回写 UX/AC 降级口径」并登记 TECH_DEBT，则 P1 清零后可降为 🟡；但按 HEAD 代码与现有 AC-C-09/ARCHITECTURE §3.3 口径，当前判红。

### 5.6 本轮发现
- 发现 **29** 条（P0 0 / P1 1 / P2 13 / P3 15）；可行动 **26** 条（全部可在 B1/S0 写域内改或登记 TECH_DEBT）；**3** 条需 Lead/用户裁决或回写文档（R-B1-11 隐私承诺与 D2 取舍、R-B1-12 aiFallback 默认值产品裁决、R-B1-16 订单概览数据源跨域只增字段）。
- 建议 Lead 优先处置顺序：R-B1-01（P1）→ R-B1-02/03/04/07/08（主路径与体验）→ R-B1-11/12/13（合规/隐私承诺，与工作树并发改动一并归并）→ 其余 P2/P3。
- 明确移交：`pages/partner/**`、`pkg-partner/**`、`pkg-admin/**` 的行为问题（含 `components/customer-row` 消费 `customerNoDisplay` 而 `utils/customer-view.buildListRow` 未产出该键、`pkg-admin` 是唯一使用 `enableAlertBeforeUnload` 的地方）→ 交 B2/A2 复核；`docs/privacy` 与四文件并发改动 → 交 C/阶段 3 与 Lead 归并；`UX_CUSTOMER §11.3` 组件清单与 `ARCHITECTURE §3.5` 不一致 → 交 C/阶段 3。
