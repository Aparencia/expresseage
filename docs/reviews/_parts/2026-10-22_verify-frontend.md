> 本条由 AI 生成（独立复核）

# 独立复核 · 前端安全发现（B2 R-B2-01 + B1 S1/S2/S3）

## 0. 派单输入与基线

### 0.1 派单输入单
- 任务：`task-11`「独立复核前端安全发现（B2 R-B2-01 + B1 S1~S3）」；复核目标 = **从源码尝试反驳**，不是复述原发现。
- 输入 A：`docs/reviews/_parts/2026-10-22_B2-frontend-partner-admin.md` §3 R-B2-01（该文件 :149-154）。
- 输入 B：`docs/reviews/_parts/2026-10-22_B1-frontend-customer.md` §3.5 S1/S2/S3（该文件 :293-313）。
- 判据来源：`docs/reviews/_parts/_REVIEW_BRIEF.md` §3.2 安全轴四条硬规则（入口→传播→终点三处 `file:line`；`overall_severity ≤ impact`；验证者身份分离）。
- 回报口径：路径 + 行数 + 逐条三态 + 证据摘要（见 §7）。

### 0.2 基线与环境
- `git rev-parse HEAD` → `9031d14cfc88b0cd8b03527da00ccc1f70a3e635`；与 B1/B2 报告 §0 基线一致。
- 复核窗口内工作树有**他方并发修改**：`git status --porcelain` 共 20 项（16 个 ` M` + 4 项未跟踪，含隐私文本/清单/单测的工作树修复与 `docs/reviews/`、`docs/research/`）。本复核**未改任何代码/配置/测试**；唯一写入 = 本文件；对 HEAD 的判定不因工作树改动而变，凡引工作树处均显式标注。
- 环境：pwsh 5.1.22621；本复核未执行 `check.ps1`/`gate.ps1`/`tools/selftest.js`（纪律），未派子代理。

### 0.3 复核者身份分离声明
- 本人本轮此前唯一产出 = `docs/research/CONVENIENCE_2026-10-22.md`（顾客便利研究）；**未参与** B1/B2 前端审查，**未提供**这 4 条发现的任何输入；本文件为首次读这两份 part 与对应源码。
- 本文件只给三态结论与级别建议，不改判、不替代 Lead 裁决。

### 0.4 假设与边界
- 假设 A1：审查对象 = HEAD 9031d14 全量代码（与 B1/B2 基线一致）；若 Lead 改以工作树为基线，S3 的「已修复」状态按 §3.4 重判。
- 假设 A2：微信小程序原生「转发」菜单为**平台行为**：页面声明 `onShareAppMessage` 后右上角菜单出现转发入口，只有 `wx.hideShareMenu()` 才隐藏。该行为无法用本仓代码证明；本次联网抓取微信官方文档被导航壳截断、未取到正文逐字（URL 见 §6 U1），故按「平台语义 + 本仓必要条件证据（3 页声明、业务代码 0 处 hideShareMenu）」判定，并列为真机点检项。
- 边界：只复核这 4 条；B2 其余 18 条、B1 其余 28 条不在本文件范围（不复述、不裁定）；`docs/` 正文文字质量不在安全复核范围。

## 1. 三态判据（本文件口径）
- **成立**：核心事实（入口存在、传播路径可达、终点造成所述影响）全部被源码证实，且未找到有效反驳；引用错误/表述偏差不影响结论时在条内标注需修正处。
- **部分成立**：核心影响成立，但证据链有**事实错误**，或所述影响范围需收窄/修正。
- **不成立**：能给出可执行反驳（源码反例或平台语义不成立）。
- 级别建议：P0 崩溃/数据丢失/安全漏洞；P1 核心功能不可用；P2 边缘功能报错/体验不佳或硬口径违反；P3 拼写/样式/非关键。**建议级别不得高于实际影响**。

## 2. 证据台账（命令原文 / 退出码 / 命中行）

> 说明：PowerShell `Get-ChildItem`/`Select-String`/`git` 属 cmdlet/命令，正常执行即成功（退出码 0）；命中与不命中都不失败，按输出行数判读（与 B1 §3.7 同口径）。`read` 工具以「文件+行号」为命中。以下全部本轮**真实执行**，命令为原文摘要（省略的只是管道排版）。

| 编号 | 命令原文（摘要） | 退出码 | 关键命中行 |
| :-- | :-- | :-: | :-- |
| V1 | `Select-String -Path 'pages/partner/workbench/index.js' -Pattern 'onShareAppMessage\(\) \{' -Context 0,6` | 0 | `index.js:173 onShareAppMessage() {`（:174 partnerNo / :177 path 拼 bind） |
| V2 | `Select-String -Path 'pages/partner/workbench/index.wxml' -Pattern 'open-type="share"'` | 0 | `index.wxml:89 <button wx:if="{{!sessionView}}" … open-type="share">` |
| V3 | `Get-ChildItem pages,pkg-customer,pkg-partner,pkg-admin,components,custom-tab-bar -Recurse -File -Filter *.wxml \| Select-String -Pattern 'open-type\s*=\s*"share"'` | 0 | 3 命中：`partner/customers/index.wxml:81`、`partner/workbench/index.wxml:89`、`profile/index.wxml:161` |
| V4 | `Get-ChildItem . -Recurse -File -Include *.js,*.wxml（排除 node_modules/.git/miniprogram_npm）\| Select-String -Pattern 'hideShareMenu\|showShareMenu\|onShareTimeline\|enableShareAppMessage'` | 0 | `scannedFiles=411 hits=1`，唯一命中为测试正则 `tools/selftest-admin-pages.js:722`；**业务代码 0 处 hideShareMenu** |
| V5 | 同上文件集 `\| Select-String -Pattern 'onShareAppMessage'` | 0 | `pages/partner/customers/index.js:196`、`pages/partner/workbench/index.js:173`、`pages/profile/index.js:493`（另 `share-card.js:4` 注释、`selftest-bind.js:354/355/406/407`、`selftest-admin-pages.js:722`） |
| V6 | `Select-String -Path 'pages/profile/index.js' -Pattern 'onShareAppMessage' -Context 0,6` | 0 | `index.js:493-499` 传 `{isCustomer, viewSession, partnerCard}` 给纯件 |
| V7 | `Select-String -Path 'pages/profile/index.wxml' -Pattern 'open-type="share"'` | 0 | `index.wxml:160 <view wx:if="{{!viewSession}}"…>`、`:161 <button … open-type="share">` |
| V8 | `Select-String -Path 'pages/profile/parts/share-card.js' -Pattern 'shareBind'`；`read` 全文 32 行 | 0 | `share-card.js:22 const shareBind = source.isCustomer === false && source.viewSession !== true && partnerNo !== '';`（:23-25 回通用卡） |
| V9 | `Select-String -Path 'pages/role/index.js' -Pattern 'onCustomerTap' -Context 0,6` | 0 | `role/index.js:119 onCustomerTap() {`、`:121 store.set('activeRole', route.ROLES.CUSTOMER);`、`:123 redirect(…)` |
| V10 | `Select-String -Path 'pages/role/index.wxml' -Pattern 'role-cards\|bindtap="onCustomerTap"\|bindtap="onPartnerTap"'` | 0 | `role/index.wxml:30`、`:31`、`:37`（角色卡无 roles/status 条件，恒渲染） |
| V11 | `Select-String -Path 'utils/session.js'`；`store/index.js`；`cloudfunctions/api/handlers/user/bootstrap.js`；`cloudfunctions/api/middleware/switch-session.js` | 0 | `session.js:12-30`（进入会话先 setViewContext 再 bootstrap 水合）、`store/index.js:99-109`、`bootstrap.js:131 partnerNo: partner ? partner.partnerNo…`、`switch-session.js:80 return { effectiveOpenid: partner.openid, … }` |
| V12 | `Select-String -Path 'cloudfunctions/api/middleware/auth.js' -Pattern 'DEACTIVATED'` | 0 | `auth.js:116 if (user.status … === USER_STATUS.DEACTIVATED && state.action !== 'user.bootstrap')`（:117 FORBIDDEN） |
| V13 | `Select-String -Path 'cloudfunctions/api/handlers/user/deleteAccount.js' -Pattern 'USER_STATUS.DEACTIVATED\|deletionRequestedAt: nowDate'` | 0 | `deleteAccount.js:44 status: enums.USER_STATUS.DEACTIVATED,`、`:45 deletionRequestedAt: nowDate,`（事务内仅这三字段，**未清 roles**） |
| V14 | `Select-String -Path 'cloudfunctions/cleanup/sweeps/accounts.js' -Pattern 'remove\(C.USERS\|remove\(C.CUSTOMERS'` | 0 | `accounts.js:192 await ctx.dao.remove(C.CUSTOMERS, openid);`、`:193 await ctx.dao.remove(C.USERS, openid);`（30 天后物理删） |
| V15 | `Select-String -Path 'cloudfunctions/api/middleware/auth.js' -Pattern 'roles: \[\]'`；`bootstrap.js -Pattern 'roles = rawRoles.filter'` | 0 | `auth.js:39 roles: [],`（ensureUser 懒建）、`bootstrap.js:101 roles = rawRoles.filter(…)` |
| V16 | `git show HEAD:pkg-customer/parts/privacy-text.js \| Select-String -Pattern '剪贴板\|切换会话不能分享'` | 0 | `HEAD:57`「不收集完整手机号…通讯录、通话记录、**剪贴板**、微信好友关系…」；`HEAD:60`「**切换会话不能分享或转发页面**」 |
| V17 | `git show 'HEAD:docs/privacy/发布前填写清单.md' \| Select-String -Pattern '剪贴板\|剪切板'` | 0 | `HEAD:43 \| 2.5 \| 剪切板 \| **不使用** \| 绑定编号支持手动输入/粘贴由系统完成，不读剪贴板 API \|` |
| V18 | `Get-ChildItem pages,pkg-customer,pkg-partner,pkg-admin,components,utils -Recurse -File -Filter *.js \| Select-String -Pattern 'getClipboardData\|setClipboardData'` | 0 | 10 命中：`bind:91`（读）、`id-text:34`、`profile/parts/ui:23`、`order-detail:175`、`customers:187`、`activate:217`、`partner/order-detail:190/200`、`stats:58`、`invite-codes:164`（写） |
| V19 | `Select-String -Path 'pages/profile/index.js' -Pattern 'doDeleteAccount\|reLaunch\|重新登录将创建'` | 0 | `profile/index.js:471 doDeleteAccount() {`、`:480 content: '…重新登录将创建新的顾客资料与编号。'`、`:484 wx.reLaunch({ url: route.ROLE_PAGE })` |
| V20 | `Select-String -Path 'docs/V4_ENGINEERING.md' -Pattern '隐藏分享'`；`docs/V4_UX_PARTNER.md` 同 | 0 | `ENGINEERING:394`（§4.8.3「两种会话都隐藏分享/转发/长按保存入口」）、`ENGINEERING:557`（§5.5 同句）、`UX_PARTNER:644`（§6.2「隐藏分享」） |
| V21 | `Select-String -Path 'pages/partner/workbench/index.js' -Pattern 'require\('`；`customers/index.js` 同 | 0 | workbench 无 `shareCard` require（:6-16 依赖列表）；customers `:7 const shareCard = require('../../profile/parts/share-card');` |
| V22 | `Select-String -Path 'pages/partner/customers/parts/list-model.js' -Pattern 'showShare'` | 0 | `list-model.js:132 showShare: opts.session !== true,`（会话内隐藏客户页分享按钮） |
| V23 | `Select-String -Path 'pages/partner/customers/index.js' -Pattern 'onShareAppMessage' -Context 0,6` | 0 | `customers/index.js:196-202` 已走纯件并传 `viewSession: this.data.session` |

## 3. 逐条复核

### 3.1 R-B2-01（B2 记 P2；工作台 onShareAppMessage 可外发目标兼职编号）

**原发现摘要**（B2 :149-154）：`pages/partner/workbench/index.js:173-179` 的 `onShareAppMessage` 无条件构造绑定卡、path 恒拼 `partnerNo`、不传 `viewSession`；会话内页内分享按钮虽隐藏，但页面级声明使右上角「转发」可用；全仓无 `wx.hideShareMenu`；与「两种会话隐藏分享/转发」冲突。

**三处证据链复核**
- 入口 `pages/partner/workbench/index.js:173`：`onShareAppMessage() {` 无条件声明，函数体内无任何 session 分支（V1；read 173-179 逐行核对）。工作台同时是主包 tabBar 页（`app.json:7` 声明、`:78` tabBar list），会话进入后 `pages/role/index.js:53-56` 直接 reLaunch 到该页 → 该页是会话内真实可达页。
- 传播 `pages/partner/workbench/index.js:174-177`：`const partnerNo = this.partnerNo()` → `title:'我在做校园代取，凭兼职编号找我下单'` → `path:'/pages/role/index' + (partnerNo ? '?bind=' + encodeURIComponent(partnerNo) : '')`；`partnerNo()`（:181-184）= `store.snapshot().partner.partnerNo`。切换会话时 store 中即**目标**身份：`utils/session.js:24-29` 进入会话先 `setViewContext` 再 `hydrateIdentity`（:12-16）→ `user.bootstrap`；`cloudfunctions/api/middleware/switch-session.js:71-80` READONLY 目标解析为真实 partner 的 `effectiveOpenid`；`cloudfunctions/api/handlers/user/bootstrap.js:41-58,131` 返回目标 `partnerNo`；`store/index.js:99-109` 克隆 `data.partner` 进 `state.partner`。→ 会话内 `this.partnerNo()` 返回**目标兼职编号**（读真实兼职时为真实编号，非空）。
- 终点 `pages/profile/parts/share-card.js:22-28`：同仓已实现「会话内回通用卡、不漏编号」的收紧口径；`pages/partner/customers/index.js:196-202` 已复用（V21/V23）；**工作台未复用**（workbench 依赖列表无语义分享纯件，V21）。转发卡落地页 `pages/role/index.js:97-117` 会 `partnerApi.getPublic({partnerNo})`，`pages/role/index.wxml:13-14` 展示 `displayName`/`partnerNo`/服务与范围文本；`cloudfunctions/api/handlers/partner/getPublic.js:39` 返回 partnerPublic DTO（无头像、无宿舍/尾号/订单）。
- 菜单面：V4 全仓 411 个 js/wxml 文件扫描，**业务代码 0 处 hideShareMenu**（唯一命中是测试正则）；会话内页内按钮确已隐藏（`workbench/index.wxml:89 wx:if="{{!sessionView}}"`，V2）→ 缺口精确为「藏了按钮、没关菜单」。

**反驳尝试（逐条给结果）**
1. 「会话内 store.partner 未水合 → partnerNo 为空 → path 无编号」→ **反驳失败**：V11 链路证明目标身份被水合进 store。
2. 「页内分享按钮已按 sessionView 隐藏 → 无分享入口」→ **反驳失败**：原生菜单由页面声明 `onShareAppMessage` 启用，与页内按钮是两条通道；全仓 0 处 `hideShareMenu`（V4）。
3. 「tabBar 页不能转发」→ **反驳失败**：平台支持页面转发，是否 tab 页不影响（平台语义，见 §6 U1）。
4. 「最多只是编号，不算隐私问题」→ **部分成立**：卡片与 path 只含 partnerNo；落地页只给公开 DTO（昵称/服务/范围），无头像、无宿舍/尾号/订单。但编号是目标账号识别符，接收方可凭编号预览昵称并**发起绑定请求**（邀请卡机制本身被他人触发），对 READONLY 真实兼职即「他人编号外发 + 第三方可发绑定请求」；不构成 P0/P1，**不升级**。
5. **引用纠错①（成功）**：B2 以 UX_PARTNER §6.4 支撑「两种会话都隐藏分享」——§6.4（`docs/V4_UX_PARTNER.md:660-661`）实为**读接口白名单**，不含隐藏分享口径；正确出处是 §6.2（`:644`）+ `docs/V4_ENGINEERING.md:557`（§5.5）/`:394`（§4.8.3）。
6. **引用纠错②（成功）**：B2 引 §0 原则 5「头像/昵称/编号不进分享卡片」——原文（`docs/V4_UX_PARTNER.md:23`）只写「头像/昵称不进分享卡片」；§7（`:677`）明确卡片内容 = 标题 + `partnerNo`。故「编号不进分享卡片」不是本仓口径，真实冲突点 = **会话内不得分享/转发（§6.2）**。

**判定：成立**（核心事实、传播链、影响与口径冲突均成立）；需修正上述两处文档引用。**建议级别：P2**（=影响，不高于影响，与 B2 原级别一致）。加分证据：`tools/selftest-bind.js:354-355/406-407` 只锁 profile/customers 的 `onShareAppMessage` 走纯件，**未锁 workbench**——修复时应补断言，否则回归无牙。

### 3.2 S1（B1 记 P3 影响；切换会话内的系统转发入口未关闭）

**原发现摘要**（B1 :297-301）：会话内仅隐藏「分享绑定卡片」按钮，`onShareAppMessage` 仍无条件注册；`hideShareMenu` 缺失不构成审计口径破口；无数据外泄路径（不可标 P0/P1），但违反 ENGINEERING §5.5/§4.8.3「两种会话隐藏分享/转发」。

**三处证据链复核**
- 入口 `pages/profile/index.wxml:160-163`（`wx:if="{{!viewSession}}"` 只包页内卡片）+ `pages/profile/index.js:493-499`（`onShareAppMessage` 无条件注册，但传 `{isCustomer, viewSession, partnerCard}` 给纯件）。
- 传播 `pages/profile/parts/share-card.js:17-30`：`shareBind = isCustomer===false && viewSession!==true && partnerNo!==''`（:22）；会话内 → 通用卡 `{title:'校园快递代取', path: route.ROLE_PAGE}`（:23-25）。**内容已收紧**（无编号/PII）。
- 终点 `pages/role/index.js:47-64`：仅带 `?bind` 才 `loadBindCard`；通用卡无 bind，落地页无票据、无 PII。
- 菜单面：V4 业务代码 0 处 `hideShareMenu` → 页内按钮虽在会话内全隐藏（profile `:160`、workbench `:89`、customers `list-model.js:132`，V2/V7/V22），右上角菜单仍可用 → `ENGINEERING:557`/`:394`、`UX_PARTNER:644`「两种会话都隐藏所有分享/转发/长按保存入口」未满足。
- 审计面：全仓审计动作无分享相关项（`shared/audit-actions.js` 无 share 条目）→ 「hideShareMenu 缺失不构成**审计口径**破口」这句成立；但存在**对外文本与实现矛盾**：HEAD `pkg-customer/parts/privacy-text.js:60` 写「切换会话不能分享或转发页面」（V16）；工作树同句在 `:61` 未改（见 §3.4 工作树 diff 复核）。

**反驳尝试**
1. 「页内按钮都藏了 → 入口已关闭」→ **反驳失败**：原生菜单独立于按钮（0 hideShareMenu）。
2. 「分享内容已收紧 → 无外泄路径」→ **成立**（对 profile 与 customers 两页成立，属通用卡、无 PII）；但工作台页是同一根因下的另一表现，内容不同（见 R-B2-01），故 S1 的「无数据外泄路径」需限定页面范围。
3. 「只是软要求」→ **反驳失败**：ENGINEERING §5.5 与 UX §6.2 均为硬口径（「必须/都隐藏」）。

**判定：成立**（入口未关闭 + 硬口径违反属实；「无数据外泄路径」对其自身页面成立）。**建议级别：P3**（无 PII 外发，仅口径/UI 违规，与 B1 记的 P3 影响一致，不升级）。**跨 part 去重建议**：S1 与 R-B2-01 同一根因（业务代码 0 处 hideShareMenu），汇总时按「1 条根因 + 2 条表现」计（工作台编号卡 P2、其余页通用卡 P3），避免同一事实两处计级。

### 3.3 S2（B1 记 P2 影响；注销后 DEACTIVATED 的客户端可继续进入业务页）

**原发现摘要**（B1 :303-307）：注销成功后客户端 reLaunch 角色页；bootstrap 对 DEACTIVATED 仍放行、角色卡可点、客户端置位角色；服务端除 `user.bootstrap` 外一律 FORBIDDEN；属体验死路 + 提示不实（R-B1-14）而非安全漏洞。

**三处证据链复核**
- 入口 `pages/profile/index.js:471-490`：`doDeleteAccount` 成功 → `store.reset()`（:477）→ 弹窗（:478-486，文案 :480「…重新登录将创建新的顾客资料与编号。」）→ `wx.reLaunch(route.ROLE_PAGE)`（:484）。
- 传播 `pages/role/index.js:85-95`（`hydrateBootstrap` 调 `user.bootstrap`，经 `auth.js:116` 白名单放行）→ `pages/role/index.wxml:30-43` 角色卡**无 roles/status 条件恒渲染**（V10）、`pages/role/index.js:119-124` `onCustomerTap` 客户端 `store.set('activeRole', …)` 后 redirect 到顾客首页/我的 → 可继续进入业务页。
- **事实纠正（一处）**：B1 称 bootstrap 回 `roles:[]` —— `cloudfunctions/api/handlers/user/deleteAccount.js:43-47` 只更新 `status/deletionRequestedAt/updatedAt`，**不清 `roles`**；`bootstrap.js:100-102` 原样过滤 `user.roles` → 实际回 `['CUSTOMER']`（V13/V15）。但角色卡与 roles 取值无关恒渲染，故「可点/可进」机制不依赖 `roles:[]`，结论不受影响。
- 终点 `cloudfunctions/api/middleware/auth.js:116-118`：DEACTIVATED 下除 `user.bootstrap` 外一律 `FORBIDDEN('账号已停用，请联系开发者')` → 业务读/写全拒；无越权、无写入、无数据读出。

**反驳尝试**
1. 「能进页面 = 越权」→ **反驳失败**：页面进入仅是客户端导航；全部业务读/写在服务端被拒。
2. 「DEACTIVATED 可重注册/绕过」→ **反驳失败**：`auth.js:31-35` `ensureUser` 对既有文档直接返回 DEACTIVATED 文档；非 bootstrap action 在 `:116` 拦截；`customer/saveProfile.js:87-99` 需过 `assertWritable`，不可达。
3. 「清理后 ensureUser 懒建保留旧角色」→ **反驳失败**：`cleanup/sweeps/accounts.js:192-193` 30 天后物理删 `customers`/`users`；重登时 `auth.js:37-49` 懒建 `roles:[]`；角色只能由 `customer/saveProfile.js:59-85` 首存时 union 授予 → 新编号、新资料（CONTRACT §11.4:521-522）。
4. 「提示不实」→ **成立**：`:480` 文案在注销后 30 天内不成立（服务端全拒），与 R-B1-14 同条。

**判定：部分成立**：核心（客户端可进业务页、服务端统一拒绝、非安全漏洞、无越权/无写入、清理后不保留旧角色）成立；证据链有 **1 处事实错误**（`roles` 实际未清空，bootstrap 回 `['CUSTOMER']`）。**建议级别：P2**（=R-B1-14 体验项，与 S2 自评一致）；汇总时与 R-B1-14 合并为 1 条，不重复计 P 级。

### 3.4 S3（B1 记 P2 影响；剪贴板隐私接口未在 HEAD 隐私文本/后台声明）

**原发现摘要**（B1 :309-313）：`wx.getClipboardData`（粘贴兼职编号）与多处 `wx.setClipboardData`（复制编号/订单号）实际使用，但 HEAD 隐私文本写「不收集…剪贴板」、微信后台无对应声明；无采集/上传，属披露与后台声明缺口。

**三处证据链复核**
- 入口 `pkg-customer/pages/bind/index.js:86-98`：仅用户点「粘贴」时 `wx.getClipboardData`（:91）；READONLY 先拒绝（:87-90）→ **无后台读取**。
- 传播（用户主动复制时写剪贴板）：`components/id-text/index.js:29-40`（:34）、`pages/profile/parts/ui.js:19-29`（:23，经 `pages/profile/index.js:314-321` 两个复制 handler 调用）、`pkg-customer/pages/order-detail/index.js:172-181`（:175）；另有 `pages/partner/customers/index.js:187`、`pkg-partner/pages/activate/index.js:217`、`pkg-partner/pages/order-detail/index.js:190/200`、`pkg-partner/pages/stats/index.js:58`、`pkg-admin/pages/invite-codes/index.js:164`。全仓 10 个调用点（1 读 9 写，V18）；B1 列 4 处为代表性、清单不完整（不影响结论）。
- 终点（HEAD 文本与清单自相矛盾）：`git show HEAD:pkg-customer/parts/privacy-text.js` :57「不收集…通讯录、通话记录、**剪贴板**、微信好友关系…」；`git show HEAD:docs/privacy/隐私保护指引.md` :46 同句；`git show HEAD:docs/privacy/发布前填写清单.md` :43 甚至写「剪切板 **不使用**（…不读剪贴板 API）」（V16/V17）——与 `bind/index.js:91` 直接矛盾。剪贴板内容不落库/不上传/无日志（复制值只进系统剪贴板与输入框；本地存储走白名单），故属披露与后台声明缺口，非数据外泄。
- 微信后台声明：仓库内**不可验证**（控制台人工项；`发布前填写清单.md:126` 的「后台声明剪切板」为待用户在控制台勾选项，AGENTS §7 只能用户执行，本复核不代勾）。

**工作树并发修复复核（非本复核写入；任务要求的三点）**
- ① 三处文案覆盖：**✓** `pkg-customer/parts/privacy-text.js:58`（新增「剪贴板：我们不会后台读取…不保存、不上传」）、`:71`（安全措施补「剪贴板内容不保存、不上传」）、`docs/privacy/隐私保护指引.md:6/48/130`（口径澄清、§二 披露、附录 A 行 + 后台声明提示）。
- ② 发布前填写清单补项：**✓** `:45`（2.5 改为「使用」并写明漏声明报错）、`:56`（核对方式）、`:65`（3.4 扫描口径）、`:71`（3.10 同意前不读写）、`:126`（5.14 必查项）。
- ③ selftest 补偿断言：**部分到位**——`tools/selftest-privacy-text.js:281-294` 只断言「文档/端内文本/补充文档均含『剪贴板』」的存在性，**未断言**错误否定句「不收集…剪贴板」不得再出现、未锁清单 2.5 行取值 → 回归防护偏弱（建议补 2 条否定式断言）；且该断言依赖工作树未跟踪文件 `docs/privacy/补充文档.txt`（`git status` 为 `??`），提交时须一并纳入。

**判定：成立（以 HEAD 9031d14 为基线）**；**建议级别：P2**（披露/合规缺口，影响=提审被拒或向用户告知不实，不高于影响）。工作树已有修复但**未提交**，最终定级由 Lead 按工作树口径裁：若修复随本批提交并通过门禁，可降为 P3 收口项（关闭需保留「后台声明」人工项）。

## 4. 结论汇总

| 编号 | 原级别（B1/B2 记） | 三态 | 建议级别 | 一句话 | 合并建议 |
| :-- | :-- | :-: | :-- | :-- | :-- |
| R-B2-01 | P2 | **成立** | **P2** | 会话内工作台卡片携带目标兼职编号且业务代码 0 处 hideShareMenu；两处 UX 引用需修正 | 与 S1 同根因，按「1 根因 + 2 表现」计 |
| S1 | P3（影响） | **成立** | **P3** | 会话内页内分享按钮已藏、原生转发菜单未关；profile 页卡片内容已收紧无外泄 | 同上（合并后根因归 P2 表现） |
| S2 | P2（影响） | **部分成立** | **P2**（并入 R-B1-14） | 可进业务页/服务端全拒均属实；`roles:[]` 一处事实错误 | 与 R-B1-14 合并为 1 条 |
| S3 | P2（影响） | **成立**（HEAD） | **P2** → 工作树修复后 P3 收口 | HEAD 文本/清单与剪贴板实调用矛盾；工作树已修，后台声明仍待人工 | 独立，不与其他合并 |

- 计数：**成立 2、部分成立 1、不成立 0**；无 P0/P1 级；建议级别均不高于各条影响分。
- 四条均**未发现可推翻核心结论的源码反例**；共给出 3 类需修正项：R-B2-01 两处 UX 引用、S2 一处 `roles` 事实、S3 调用点清单不完整。

## 5. 补充观察（不计入原发现，交 Lead 路由）

1. **根因合并**：S1 与 R-B2-01 是同一根因（业务代码 0 处 `hideShareMenu`）的两种表现；汇总时建议按 1 条根因 + 2 处表现（工作台编号卡 P2 / 其余页通用卡 P3）计，避免同一事实两处计级。
2. **修复闭环建议（不动代码，仅方向）**：①工作台 `onShareAppMessage` 复用 `pages/profile/parts/share-card.js` 并传 `viewSession`（与 `pages/partner/customers/index.js:196-202` 同构）；②会话进入/退出统一 `wx.hideShareMenu()/wx.showShareMenu()`（`utils/session.js` 是唯一进入/退出口，可挂此处）；③同步 HEAD `pkg-customer/parts/privacy-text.js:60`「切换会话不能分享或转发页面」与实现或措辞。
3. **断言缺口**：`tools/selftest-bind.js:354-355/406-407` 只锁 profile/customers，未锁 workbench；`tools/selftest-privacy-text.js:289-293` 为存在性断言、缺否定式断言（见 §3.4）。建议修复时一并补，防「判据没牙」。
4. **长按保存面**：全仓唯一显式关闭为 `components/failure-image/index.wxml:7 show-menu-by-longpress="{{false}}"`；其余截图经 `wx.previewImage`（`pkg-customer/pages/order-create/index.wxml:43/63/173`「点击查看截图」），属 UX §6.2 明确可用的「截图查看」读操作；预览页是否可保存为平台行为，超出 S1 原述 → 建议加入真机点检，不在此判缺陷。
5. **引用修正**：见 §3.1（R-B2-01 两处）、§3.3（S2 一处）、§3.4（S3 清单）——原 B1/B2 part 文件不改，由 Lead 汇总时决定是否回写。

## 6. 未决与真机项

- **U1（真机，人点检）**：READONLY/TEST_WRITE 会话进入工作台后，右上角是否出现「转发」。平台行为无法用本仓代码证明（本次联网抓取微信官方文档仅得导航壳、未取到正文逐字；参考 <https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/share.html> 与 <https://developers.weixin.qq.com/miniprogram/dev/reference/api/Page.html>）。属「人（真机）」项，agent 不代勾；建议 `docs/QA_CHECKLIST.md` 增一条：会话内逐页检查右上角菜单无「转发」入口。
- **U2（人工，控制台）**：微信后台《用户隐私保护指引》「剪切板」声明是否已勾选——只能用户执行（AGENTS §7；见 `docs/privacy/发布前填写清单.md:126`）。
- **U3（提交）**：工作树隐私修复（16 个 ` M` 中的 4 件 + 未跟踪 `docs/privacy/补充文档.txt`）未提交，S3 的「已修复」不构成 HEAD 事实；由 Lead 统一提交、回读 HEAD 并跑门禁。
- **U4（本复核边界）**：本文件未跑 `check.ps1`/`gate.ps1`/`selftest.js`；门禁结果以 Lead 统一运行为准。

## 7. 回报字段（供 Lead 汇总取用）
- 产物：`docs/reviews/_parts/2026-10-22_verify-frontend.md`（本文件；171 行，UTF-8 无 BOM / 纯 LF / 末尾单换行；门禁自查见 §7 末行）。
- 逐条三态：R-B2-01 成立（P2）；S1 成立（P3）；S2 部分成立（P2，并入 R-B1-14）；S3 成立（HEAD 基线；P2，工作树修复后 P3 收口）。
- 证据：入口→传播→终点三处 `file:line` 见 §3；命令原文/退出码/命中行见 §2（V1~V23）。
- 未决：U1 真机转发菜单、U2 后台剪贴板声明、U3 工作树修复未提交、U4 门禁由 Lead 跑。
- 本复核实跑的门禁自查（不替代 Lead 统一运行）：`node tools/check-docs.js --batch 1` → 通过 10 项 / 失败 0 项（exit 0）；`node tools/zero-money-scan.js --scope docs` → 0 命中（白名单 136 项，exit 0）。
