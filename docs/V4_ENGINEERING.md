# V4_ENGINEERING · v4 工程结构 / 环境 / 测试 / 门禁 / 部署设计

> 版本：v1.0 草案（2026-10-22 批 10 回写：**D23~D26 C 批**一单多包裹/合并窗口/无截图手填/每单配送地址/顾客取件清单；**D28/D29 B 批**换绑一体化/状态事件未读红点/AI 低置信不写入；**性能 P0 采纳**（P0-1~P0-11）；**代码审查非重叠修复**（M-01/M-02 P1 等）；页面 31 页、门禁 #32 单函数行数机械兜底、识别兜底记录粒度=包裹×截图）｜维护：lead｜状态：**D1~D26、D28~D29 已裁决**（D27 定位方案待研究结论后裁决）；E5/E12 平台实测与 E11 用户确认仍待做
> 上游（冲突以它们为准）：`docs/V4_CONTRACT.md` **v0.9**（唯一口径）、`V4_REBUILD_SPEC.md` §9.1/§10、`docs/V4_DATA_MODEL.md`（字段/索引/API 契约细节；**v0.9 字段增量以 CONTRACT §4.2 补充字段为准**，DATA_MODEL 回写后同版）、`docs/V4_DECISIONS.md`、`docs/V4_UX_CUSTOMER.md` / `V4_UX_PARTNER.md` / `V4_UX_DEVELOPER.md`。
> 引用规则：口径用 CONTRACT `§/D#`；字段/索引/action 入参出参以 DATA_MODEL 为契约载体（残差由 `tools/check-docs.js` 双向兜底）；工程缺口标 `[E#]`（§13）；引用 v3 用"文件 + 函数名"（不写行号）；数字给取数命令。
> 版本标注约定（v0.9 统一）：正文"（v0.5/v0.6/v0.7 定稿）"= 该口径在 CONTRACT v0.5/v0.6/v0.7 冻结、v0.9 未改；"（v0.8）"= 三次修订新增；"（v0.9）"= 四次修订新增/变更；本文自身版本 = v0.9。**UX 页面上的版本号一律运行时取**（App 版本取 `wx.getAccountInfoSync().miniProgram.version`，隐私版本取 `config.getPublic.privacyVersion`），文档与代码不写死。
> 基线（2026-10-21 实测）：v4 模板 appid `wxf98c87a293092ef5`，**无 git / tools / 门禁**；v3 只读参照 `D:\Code\expresseage_college_v3\`（实测 `node tools/check.js` 82 检查项、`node tools/selftest.js` 383 条断言；v4 写"以实跑读数为准"）。**2026-10-22 用户裁决 D2：项目 appid 沿用 v3 `wxcb7e5b41b89bc806`**（`project.config.json` 已改；同一 storage 命名空间，v4 只读写自己的键）。
> 本文只写设计与验收，不写实现代码；实现从批 1 开始（§11）。

---
## 0. 文档定位与口径（先读这一节）

- 本文回答"**怎么搭、怎么测、怎么卡、怎么发**"：工程结构、配置、云资源、客户端架构、开发调试、测试、门禁、文档维护、部署、批次技术拆分、风险、待裁。
- 不回答：产品规则（CONTRACT）、逐字段/索引/action 入参（DATA_MODEL）、逐页交互（三份 UX）、裁决理由（DECISIONS）。
- 三种口径状态：①已定稿（CONTRACT v0.9 / DATA_MODEL（v0.9 字段增量待其回写，最新字段口径以 CONTRACT 为准）/ UX 三份）；②工程提案（本文 `[E#]`，仅余 E5/E12 平台实测、E11 待用户确认）；③已裁决（D1~D22 于 2026-10-22 全部闭环，见 CONTRACT §13 与 `docs/V4_DECISIONS.md` §0.1；D5/D6/D20/D21 早前已定）。
- **零金额铁律（v0.7）**：本程序不涉及任何费用收付；全部工程产物（源码/页面文案/DTO/`config`/审计/测试/文档）不得出现费用语义。全文只在"口径声明、门禁定义、已废弃说明"处出现相关词，且这些行统一登记进零金额白名单（§8.2 #22）；实现侧一律以门禁扫描结果为准。
- 数据敏感级别统一写 **L1/L2/L3**（L3=取件码/手机尾号/门牌/截图等），**不写 "D3"**（避免与裁决编号 D1~D22 混淆）；L3 明文字段禁入本地存储/日志/通知/分享卡片；**开发者后台默认脱敏（不展示头像、昵称脱敏），完整 L3 只经 READONLY 只读视角（带审计）**。
- **编号规格单源**：`utils/ids.js`（格式/校验/展示/错前缀提示，纯件零 `wx`）同步为云函数 `shared/ids.js`；随机生成只在云端（§5.3）。
- **AI 兜底铁律（v0.8）**：仅当端侧 OCR + 规则解析不出站点或取件码时触发；外呼**只在云函数层**（`ai.parseParcel`），客户端零外呼、零 Key（`DEEPSEEK_API_KEY` 只存云函数环境变量）；**只发去敏文本**（字段白名单，不发原图/openid/订单归属）；8s 超时、仅网络/5xx 重试 1 次、连续 5 次失败熔断 10 分钟、5 次/人/日 + 全局日配额；任何失败/超限**静默降级**（返回 `recognized=false`）且**不新增错误码**；失败必写 `recognition_failures`，原图只在复核页临时 URL 查看并逐次审计。
- **识别失败复核（v0.8）**：开发者后台 `pkg-admin/pages/recognition-review/index` 一页；补录只回填订单识别字段（不改状态/归属、不建单）；忽略须备注；原图仅白名单开发者 + 5 分钟临时 URL + 每次 `FAILURE_IMAGE_VIEW` 审计；不批量/不下载/不导出。
- **绑定方向铁律（v0.9，CONTRACT §4.2）**：只能**顾客**发起绑定；兼职端零绑定入口、`bind.create` 对 PARTNER 一律 `FORBIDDEN`；代客单路径不得写 `bindings`；解绑/停用/注销后 DTO 不再返回对方头像与昵称；**真实账号×测试账号互绑/互下单必须 `FORBIDDEN`**。
- **账号切换铁律（v0.9，CONTRACT §1.3）**：小程序**不能切换微信登录账号**；应用内只做"账号代理切换"——`viewMode=READONLY`（真实账号，只读，写全拒）与 `viewMode=TEST_WRITE`（仅 `users.isTestAccount=true` 的合成测试账号可写）。测试数据 `isTest=true`、写动作记 `impersonatedBy`、统计/红点/邀请码报表排除、30 天未使用清数据；票据内存态、不落本地存储、单人单活、默认 30 分钟。
- **头像昵称铁律（v0.9，CONTRACT §4.1/§4.2）**：头像只经 `upload.prepare({purpose:'AVATAR'})` 上传到 `avatars/{role}/{random}.jpg`（≤`config.avatarMaxBytes`、jpg/png），替换即删旧文件、注销/删测试账号删文件；昵称 ≤20 字 + `security.msgSecCheck` v2；**仅本人与当前 ACTIVE 绑定的对方可见**；后台 DTO 无 `avatarFileId`、昵称脱敏；分享卡片/通知/日志不含头像与完整昵称。
- **roomTag 大写铁律（v0.9，CONTRACT D7/D21）**：`A…Z/AA…`（Excel 列名式）恒大写；生成/排序只用 `utils/room-tag.js`（`shared/room-tag.js` 同步副本），展示 `D4-522A`；**任何小写后缀写法视为缺陷（大小写必须逐字一致）**（文档判据见 §8.3 #10 旧口径禁词与 roomTag 大写项）。
- 维护：本文改口径时必须同步 SPEC §9.1/§10 与 CONTRACT §12 文档地图；数字不写死，给取数命令。

---
## 1. 工程目标与 v3 资产继承
### 1.1 工程目标（可验收）
1. **服务端唯一事实**：业务判据只在云函数与 `shared/` 纯件；页面层只取参/setData/事件转发（v3 TD-016 的 v4 版）。
2. **权限最小化可证伪**：每个返回数据的 action 查询必带身份范围；越权由负向测试 + 安全规则变异测试证明。
3. **可测试**：纯件零 `wx` 直测；云函数 handler 依赖注入 + 内存 fake DB 单测；不建整页 `wx` 替身（§6.3）。
4. **可门禁可运维**：每批 `check.ps1` 退出码 0 + 真实输出；`gate.ps1` 管锚点/范围/体量；判据不写死条数；云函数可版本回滚、cleanup 可重入/可重跑、客户端旧版本在审核窗口内兼容（§10.4）。
5. **零金额可扫（v0.7）**：源码/页面文案/文档三范围扫描命中 0；`config`/DTO/审计事件无费用字段。
6. **编号唯一可证（v0.7）**：两种样式编号服务端随机生成 + 唯一索引 + 碰撞重试；客户端只校验/展示，永不生成、永不作鉴权。
7. **开发者可审计（v0.7；v0.9 扩）**：邀请码全生命周期留痕；后台默认脱敏；切换会话 = 票据 + 白名单 + READONLY 服务端拒写 / TEST_WRITE 仅测试账号可写 + `admin_audit`。
8. **识别兜底可降级可复核（v0.8）**：AI 外呼只在云函数、失败静默降级、失败必入 `recognition_failures`；复核补录只改识别字段并全程审计；原图不出本程序云存储、不进顾客/兼职页面。
9. **AI 外呼可证伪（v0.8）**：客户端包内零 Key/零 AI 端点；外发 payload 键集合 = 白名单（单测 + 门禁 #24~#25）；失败路径零静默丢弃（#26）；复核原图访问零无审计读取（#27）。
10. **绑定方向可证伪（v0.9）**：`bind.create` 只对 CUSTOMER 放行（服务端角色守卫 + 中间件）；兼职端静态零绑定入口；代客单代码路径零 `bindings` 写；真实×测试互绑/互下单负向全红。
11. **切换会话可证伪（v0.9）**：票据解析出目标身份；READONLY 一切写 `FORBIDDEN`；TEST_WRITE 仅 `isTestAccount=true` 目标可写；写请求交叉校验 `targetId/targetIsTest/impersonatedBy`；票据内存态、单人单活、TTL 可配、过期可审计。
12. **测试数据隔离可证伪（v0.9）**：测试账号为**合成身份**（`openid='TEST-<random>'`，无真实微信资料），且只能与测试账号互通；`orders.isTest`/`impersonatedBy` 落库；统计/红点/邀请码/搜索默认排除；`cleanup` 30 天清数据、删除测试账号级联删头像与数据。
13. **头像昵称安全可证伪（v0.9）**：上传只走 AVATAR 票据与固定路径；≤200KB/类型/路径校验；替换删旧、注销删文件；昵称过 `msgSecCheck` 并截断 ≤20 字；后台/卡片/通知零 `avatarFileId`；解绑后 DTO 不再返回对方头像昵称。
14. **roomTag 大写可测（v0.9）**：`utils/room-tag.js` 纯件对 1→A、26→Z、27→AA 与 Excel 序排序有断言；服务端分配只经 `lib/tag-allocator`；小写/跳空/复用旧 tag 判红。
### 1.2 v3 资产三清单（文件级）
| v3 资产 | v4 落点 | 处理 | 改造点 / 理由 |
| :-- | :-- | :-- | :-- |
| `AGENTS.md`（94 行宪法） | `AGENTS.md` | 改造 | 保留 DoD/范围四禁/回写/红线/代码硬标准；删 v3 本机数据红线，加"云开发/双角色/零金额/隐私承诺变更"；仍守 ≤200 行 |
| `check.ps1` / `gate.ps1` / `doctor.ps1` | 同名三件 | 改造 | check STEPS 扩为 **9 条**（`check.js`/`check-docs.js`/`selftest.js`/`selftest-ai.js`/`selftest-cloud.js`/`selftest-bind.js`/`selftest-profile.js`/`selftest-switch.js`/`selftest-testaccount.js`；零金额并入 `check.js` #22）+ UTF-8 BOM；gate 保留六项、行数统一全文本（修 TD-062）；doctor 新增 git 身份检查（v3 教训：未配身份提交静默失败） |
| `tools/check.js`（11 条判据） | `tools/check.js` | 改造 | 按 v4 重列为 **31 条**（§8.2）：集合/action 注册表、客户端禁直连、shared+ids/room-tag 副本 hash、BOM 双向、**零金额扫描 #22**、**切换会话接入 #23**、**AI 外呼/白名单/必入队/原图审计 #24~#27**、**绑定方向 #28**、**头像昵称 #29**、**账号切换与测试数据隔离 #30**、**测试视觉 #31** |
| `tools/selftest.js`（harness） | `tools/selftest.js` | 改造 | 保留"计数器 + EXPECTED_ASSERTIONS 完整性闸 + 崩溃也打印总数 + 分节 run({check,eq})"；断言按 v4 语义全部重写 |
| `tools/selftest-parse.js`+`parse-fixtures.js`、`tools/selftest-*.js`（5 个波次件） | `selftest-recognize.js` + `fixtures/v3-parse.js` + core/state/recognize 三件 | 复制+改造 | v3 语料与 sha256 指纹照搬、输出改 DTO；历史源码字面量钉丢弃，按主题重写 |
| `utils/stations.js`、`utils/buildings.js` | `shared/stations.js` + `shared/zones.js` + `utils/building-parse.js` | 复制+改造 | P1~P8 与别名归一原样；zone/buildingNo/room/dormKey 解析、zoneLabels 走 config（D8） |
| `utils/parse*.js`（4 件）、`utils/ocr*.js`（3 件） | `utils/recognize/`（4 件）、`utils/ocr/`（3 件） | 复制+改造 | 输出订单字段 DTO、形态闸单源；VisionKit 阶梯/帧诊断保留、只留有调用方导出（TD-059） |
| `utils/customer-input.js`、`utils/reason.js` | `shared/validate.js` + `shared/error-codes.js` + `error-copy.js` | 改造 | 宿舍身份/尾号/displayName + **`partnerNo`/`invitationCode` 形态**；13 码→人话单源、禁回显 L3 |
| `utils/privacy.js`、`utils/aggregate*.js`（2 件）、`utils/parcel-edit.js` | `api/privacy.js` + `shared/order-view.js` + `utils/customer-view.js` + `utils/order-edit.js` | 改造 | 三类隐私接口/拒绝降级；**头像选择（`open-type="chooseAvatar"`）与昵称输入（`input type="nickname"`）接入：头像可拒绝→默认头像、不阻断，昵称必填可手填**；站点分组+四档排序+锚+键；行内改码/柜号/运单尾号（校验调 shared）；识别失败时告知"去敏文本将发第三方 AI"（v0.8）；微信后台隐私声明项同步（头像/昵称，v0.9） |
| `utils/parcel-remove.js`、`parcel-drafts.js`、`utils/storage*.js`（4 件）、`migrate.js`、`chat-tool.js`、`chatpick/**` | 仅 `utils/storage.js` | 丢弃为主 | 订单不可硬删/无草稿集合；云端 DB 无本地迁移，本地只留会话提示键、**`viewContext` 不落盘（v0.7）**；v4 不做聊天工具 |
| **（v4 新增）编号零件** | `utils/ids.js` + 云函数 `shared/ids.js`（同步副本）+ `cloudfunctions/api/lib/id-generator.js` | **新建** | 编号规格单源（C+8 / P+6 / DEV-01）：normalize/校验/展示分组/错前缀提示；**生成只在云端** |
| **（v4 新增）AI 兜底适配（v0.8）** | `cloudfunctions/api/lib/ai/`（deepseek 传输 + prompt/parse/payload 纯件）+ `cloudfunctions/api/handlers/ai/parseParcel.js` + `pkg-admin/pages/recognition-review/` | **新建** | 只在云函数外呼、Key 只在环境变量、外发字段白名单、失败必入队、复核只回填识别字段（§4.10） |
| **（v4 新增）账号切换与测试账号（v0.9）** | `api/mode-guard.js` + `cloudfunctions/api/middleware/switch-session.js` + `handlers/admin/{accountSwitch,testAccounts}.js` + `pkg-admin/pages/account-switch/` + `components/{switch-bar,test-badge}/` + `tools/selftest-{switch,testaccount}.js` | **新建** | 票据→目标身份；READONLY 拒写、TEST_WRITE 仅 `isTestAccount` 可写；合成测试账号创建/删除/清数据（级联）；黄条/蓝条/TEST 角标；写动作落 `impersonatedBy`（§4.8/§4.11/§5.5） |
| **（v4 新增）头像/昵称与 roomTag 零件（v0.9）** | `utils/avatar.js`（压缩/校验/默认头像策略）+ `components/avatar-view/` + `utils/room-tag.js`（大写 `A…Z/AA…`、排序，纯件）+ 云函数 `shared/room-tag.js`（同步副本）+ `cloudfunctions/api/lib/tag-allocator.js` | **新建** | 头像只走 `upload.prepare({purpose:'AVATAR'})`（`avatars/{role}/{random}.jpg`、≤200KB）；昵称 `msgSecCheck` + ≤20 字；roomTag 大写生成/排序单源（§4.12/§5.3b） |
| `pages/pickup-list/*`、`pages/recognize/*` + create/save 零件 | `pkg-partner/pages/workbench/parts/` + `pkg-customer/pages/order-create/parts/` + `pkg-partner/pages/create-on-behalf/parts/` | 改造 | Order 聚合/四档排序/批量/撤销/行级补丁；下单四步 + 代客单（guest 快照）；识别纯件在 `utils/recognize/` |
| `pages/customer-detail/parts.js`、`archive-list/*` 交互件 | `pkg-partner/pages/customer-detail/parts/` 等 | 改造 | 档案→客户视图（显示顾客编号）；备注走 `bindings.partnerNote`；回收/滑动/批量按 UX |
| `docs/lessons/` 42 张、`docs/FIXTURES.md`、`docs/registry/*`、v3 计划/STATE 叙事 | `docs/lessons/`（选 12 张）+ `docs/V4_FIXTURES.md` + `docs/V4_DATA_MODEL.md` | 复制/改造/丢弃 | 只搬框架无关卡（§9.3）；v4 不设 registry 三件套（E7 已裁）；v3 历史不搬 |
### 1.3 继承原则
- **只搬"能被 v4 判据验证"的部分**：v3 断言/文档叙事按 v4 语义重写，不做"先复制再逐条改红"。
- **不搬 v3 的对外承诺文本**：v4 从"数据只存本机"变为"云端按角色隔离"（CONTRACT §11.2），隐私文本先定稿再写代码。
- **不搬 v3 的费用相关能力（若有）**：v4 是零金额程序（CONTRACT §0/D6），带费用语义的旧零件一律不迁、不进清单。
- **不写死 v3 数字**：v3 的 383 断言/82 检查项只是历史读数，v4 用取数命令（附录 A）。

---
## 2. 仓库结构
### 2.1 完整目录树（批 1 结束时达到此形态）
```
expressage_college_v4/
├── AGENTS.md  README.md  STATE.md  CHANGELOG.md
├── check.ps1  gate.ps1  doctor.ps1
├── app.js  app.json  app.wxss  sitemap.json
├── project.config.json  project.private.config.json(gitignored)
├── .gitignore  .tool-versions  .env.example
├── config/               # env.js（envVersion→envId）/ defaults.js（zoneLabels/服务类型/超时兜底）/ route.js（启动分流纯函数）
├── shared/               # 客户端与云函数共用纯 JS（零 wx）
│   ├── collections.js  actions.js  audit-actions.js  error-codes.js  error-copy.js  enums.js  validate.js
│   ├── stations.js  zones.js  order-state.js  order-view.js  format.js  role.js
│   └── ids.js  room-tag.js  # 由 utils/ids.js、utils/room-tag.js 同步的副本（云端口径单源）
├── api/                  # 客户端适配层：唯一云函数出口
│   ├── client.js         # 包络/响应校验/超时/重试/错误映射 + 切换会话 viewTicket 注入
│   ├── upload.js  privacy.js  mode-guard.js
│   └── modules/          # user/customer/partner/bind/order/message/upload/config/ai/admin.js
├── store/index.js        # 全局快照 + 订阅（roles/activeRole/me/binding/config/badges/viewContext 内存）
├── pages/                # 主包 7 页（5 tab + launch/role；CONTRACT §7 逐字）
│   ├── launch/index.*  role/index.*  customer/home/index.*  customer/orders/index.*
│   ├── partner/workbench/index.*  partner/customers/index.*
│   └── profile/index.*   # 我的（顾客/兼职共用；展示头像/昵称与对应编号）
├── pkg-customer/pages/   # 5 页：bind / order-create / order-detail / messages / help
├── pkg-partner/pages/    # 7 页：activate / order-detail / create-on-behalf / customer-detail / service-settings / stats / messages
├── pkg-admin/pages/      # 11 页（v0.9 用 account-switch 取代旧视角页）：overview / invite-codes / customers / customer-detail / partners / orders / order-detail / config / account-switch / messages / recognition-review
├── custom-tab-bar/       # 必须在项目根目录（平台硬要求）；5 tab 按角色渲染 3 格（切换会话渲染目标角色）
├── components/           # switch-bar（黄条 READONLY / 蓝条 TEST_WRITE + TEST 角标）/ avatar-view（默认头像兜底）/ id-text（编号）/ room-tag-text（大写标签）/ failure-image（复核原图）/ 跨页展示组件
├── utils/                # ids.js / room-tag.js（纯件）/ recognize/（4 件）/ ocr/（3 件）/ avatar.js / customer-view.js / order-edit.js /
│                         # storage.js（唯一本地写口，不存 viewContext/L3）/ privacy-policy.js / building-parse.js
├── cloudfunctions/
│   ├── api/              # index.js（唯一 require wx-server-sdk）/ router.js / middleware/（auth·switch-session·validate·
│   │                     # ratelimit·idempotency·audit）/ handlers/（user/customer/partner/bind/order/message/upload/
│   │                     # config/admin/ai/health）/ db/（collections·dao·transaction·dto/mask·dto/full）/
│   │                     # lib/（respond·errors·time·id-generator·tag-allocator）/ lib/ai/（deepseek·prompt·parse·payload）/
│   │                     # shared/（同步副本，hash 对帐）/ package.json
│   └── cleanup/          # index.js + sweeps/{orders,retention,storage,accounts,invitations,viewSessions,counters,recognitionFailures,testData}.js + shared/ + package.json
├── tools/                # check.js / check-docs.js / zero-money-scan.js / zero-money-allowlist.json /
│                         # selftest.js + selftest-{core,state,recognize,cloud,ai,bind,profile,switch,testaccount}.js / fake-db.js / fixtures/ /
│                         # sync-cloud-shared.js / seed-dev.js（单环境种子+测试账号+环境断言）/ mutation.ps1
├── assets/               # 自绘 tabbar 81×81 PNG、默认头像（首字色块，本地绘制）、品牌图；不引第三方图标库
└── docs/                 # V4_CONTRACT / V4_DATA_MODEL / 三份 V4_UX_* / V4_ENGINEERING / V4_DECISIONS /
                          # V4_FIXTURES / QA_CHECKLIST / ARCHITECTURE / RUNBOOK / TECH_DEBT / privacy/ / lessons/
```
> `V4_REBUILD_SPEC.md`/`README.md` 在仓库根（与 CONTRACT §12、SPEC 附录 B 一致）。
### 2.2 目录职责与边界
| 目录 | 职责 | 禁止 |
| :-- | :-- | :-- |
| `pages/`、`pkg-*/pages/`、`custom-tab-bar/`、`components/` | 取参、调 `api/`、setData、事件转发；页面零件放同目录 `parts/`；统一组件（`switch-bar` 双色会话条、`avatar-view` 默认头像、`id-text` 编号、`room-tag-text` 大写标签）props 进事件出 | 业务判据、直接 `wx.cloud.*`、拼状态文案、自行生成编号/roomTag、读store 业务字段 |
| `api/` | 唯一云函数/上传/隐私出口；请求包络、错误码→人话、超时/幂等键、**切换会话票据注入、READONLY 写动作本地禁用、TEST_WRITE 仅测试账号身份放行** | 业务判据、页面导航、生成编号 |
| `store/` | 全局内存快照 + 订阅；页面只读/订阅 | 持久化业务数据、放 L3 明文、放 `viewContext` 到本地存储 |
| `utils/`、`shared/` | 纯逻辑（零 `wx`），可直测；`utils/ids.js` 为编号规格单源、`utils/room-tag.js` 为 roomTag 大写/排序单源（同步 `shared/ids.js`、`shared/room-tag.js`） | 依赖页面、持有全局状态 |
| `cloudfunctions/api/` | 鉴权/**切换会话校验**/**绑定方向角色守卫**/校验/业务/DB/事件流水/审计；`lib/id-generator` 唯一编号生成、`lib/tag-allocator` 唯一 roomTag 分配 | handler 直接 `db.collection`（只经 dao）；handler 自行生成编号/roomTag |
| `handlers/admin/{accountSwitch,testAccounts}.js`（v0.9） | 切换会话开启/结束、测试账号创建/删除/清数据（合成 `users` + 级联）；只回答"以谁的身份、是否可写" | 在业务 handler 内写"if 视角"分支；删真实账号/真实数据；绕过 adminGuard/审计 |
| `cloudfunctions/cleanup/` | `cleanup.*` 定时任务（幂等、可重跑、分批；含邀请码过期、会话票据、测试数据 30 天清理） | 接受客户端调用、返回业务数据 |
| `cloudfunctions/api/lib/ai/` + `handlers/ai/`（v0.8） | DeepSeek 外呼适配（`fetch` 注入、超时/重试/熔断）、prompt 构造、响应解析、payload 白名单纯件；`handlers/ai` 负责二次去敏、写失败队列 | 访问 DB（只经注入的 dao）/接收原图/openid/订单归属；出现在客户端、页面或 `shared/` 副本 |
| `pkg-admin/pages/` | 开发者后台：邀请码/用户/订单/配置/审计/**账号切换（真实只读/测试可写/测试账号管理）**/识别失败复核；默认脱敏 | 作为安全边界（白名单只认服务端）、展示完整 L3（除 READONLY 只读视角）、展示头像或完整昵称 |
| `tools/`、`docs/` | 门禁/自测/同步/种子/变异/零金额扫描；设计/运行/债务/教训 | 放业务代码（会绕过分层判据）；与 CONTRACT 冲突的口径（先改 CONTRACT） |
### 2.3 分包与共享代码规则
- 三分包 `pkg-customer`、`pkg-partner`、`pkg-admin` **均非独立分包**（不设 `independent:true`），可 `require` 主包 `shared/`、`utils/`、`api/`；[E5] 若未来做独立分包需复制共享代码并加 hash 判据。
- 主包只放 7 页 + `custom-tab-bar` + `shared/` + `api/` + `store/` + `utils/`；`pkg-admin` 也走分包、**无 tabBar**。
- 体积预算：主包目标 ≤1.5MB、每分包 ≤1.5MB（不写死平台上限，以开发者工具提示为准；超限属验收失败）。
- **分包预下载 `preloadRule`（P0-7 性能口径，`network` 已由 Lead 选定 `"all"`：体验优先——弱网首进分包页也不等待下载，代价是首次进主包即预下载两分包流量）**：`app.json` 配 `pages/customer/home/index → pkg-customer`、`pages/partner/workbench/index → pkg-partner`（两分包均非独立分包，可预下载；仅此两页，不夹带其他页）；`tools/selftest-performance.js` 的 I1/I2 断言实际注入值（键集合/packages/network∈{all,wifi}）。预下载只影响"首次进分包页的下载等待"，不改变分包归属与体积预算。

---
## 3. 配置约定
### 3.1 `project.config.json`（批 1 改造模板）
| 字段 | v4 值 / 规则 | 理由 |
| :-- | :-- | :-- |
| `appid` | `wxcb7e5b41b89bc806`（D2 用户裁决：沿用 v3 appid） | 同一 storage 命名空间（v4 只读写自己的 `ex_college_v4.store`，不碰 v1/v2/v3 键）；云环境=**唯一环境**（D1 修订：账号只能开 1 个）；发布 v4 替代 v3 |
| `compileType`/`projectname` | `miniprogram` / `expressage_college_v4` | — |
| `cloudfunctionRoot` | `cloudfunctions/` | 云开发必需；模板无此字段，批 1 新增 |
| `miniprogramRoot` | `./` | 不另建 `miniprogram/` 子目录 |
| `setting.es6/enhance/postcss/minified` | 全 `true` | 与 v3 一致；`urlCheck:false`（无自建域名请求） |
| `setting.minifyWXSS/minifyWXML/uploadWithSourceMap` | `true` | 发布可追溯 |
| `packOptions.ignore` | `cloudfunctions`、`docs`、`tools`、`.git`、`node_modules`、`*.md` | 工程文件不进小程序包 |
| `condition`/`editorSetting` | 空 | 不提交个人调试条件 |
### 3.2 其他配置文件
| 文件 | 内容 | 规则 |
| :-- | :-- | :-- |
| `project.private.config.json` | `libVersion`（实测可用）、编译热重载等 | **gitignore**（机器私有）；基础库版本回填 `.tool-versions` |
| `.tool-versions` | 本地 node/npm、云函数运行时、基础库版本、无 DB 版本 | 改任意一行 = 环境变更，回执说明 |
| `.env.example` | 只键名+注释：`ADMIN_OPENIDS={"<openid>":"DEV-01","<openid2>":"DEV-02"}`（云函数环境变量，非 .env，JSON 映射）、`DEEPSEEK_API_KEY`（v0.8，仅 `api` 云函数环境变量） | 真实值永不提交；客户端无任何密钥；**订阅消息模板 ID/开关/文案、`viewTicketTtlMinutes`、`avatarMaxBytes`、`testAccountMaxPerRole`、`testDataRetentionDays` 全放 `config`（admin.updateConfig 维护）；`aiFallback` 也在 `config` 但 MVP 后台只读（改值走部署配置脚本/控制台）；均不进环境变量、不硬编码** |
| `.gitignore` | `.env*`、`project.private.config.json`、`node_modules/`、`cloudfunctions/*/node_modules/`、`.dsh-code-index/`、`coverage/`、`*.log` | v3 教训：`.dsh-code-index` 误提交致 gate 假红/体量虚高 |
| `sitemap.json` | 默认 `allow *`（无搜索需求） | 与 v3 一致 |
| `app.json` 性能配置 | `networkTimeout.request=10000`（与 `api/client.js` 10s 超时口径一致）、`networkTimeout.uploadFile=60000`（大图上传弱网余量）；**`networkTimeout` 不约束 `wx.cloud.callFunction`**（云调用超时仍由 `api/client.js` 竞速控制）；`preloadRule` 见 §2.3 | 只改值不改结构；由 Lead 单写者维护并在改后跑一次工具编译确认无警告 |
### 3.3 云环境（`config/env.js`；**单环境方案**，D1 修订）
- 内容形如 `{ develop:'<envId>', trial:'<envId>', release:'<envId>' }`——**三档填同一个 envId**（账号只能开通 1 个云环境；envId 不是密钥，可入库）。保留 envVersion→envId 映射形状：将来若可开第二环境，只改本文件拆成 dev/prod，调用方零改动。
- `app.js` 启动 `wx.cloud.init({ env, traceUser:true })`；envId 缺失/未开通 ⇒ 启动页显示可操作错误（fail-closed），不得静默用默认环境。
- **单环境纪律**：开发版/体验版/正式版共用同一个库与存储。因此：①任何联调都按"生产操作"对待，能本地的先本地（fake-DB 单测/纯件判据）；②必须上真机的只用**测试账号**（`isTest` 标记，不计统计、后台默认排除）；③上线前执行「单环境清零」（`admin.purgeTestData`→删测试账号→控制台核对 14 集合与云存储无测试残留），发布前导出 JSON 备份；④发布侧灰度用体验版 + 平台分阶段发布，不靠第二环境；⑤上线后结构/数据变更前先导出备份，事故按 RUNBOOK §10.4 R6 处置。
### 3.4 `ADMIN_OPENIDS`（开发者白名单，v0.9 支持多开发者）
- 位置：**云开发控制台 → 云函数 → `api` → 函数配置 → 环境变量**（以控制台实际界面为准，批 1 记录截图）；值 = **JSON 映射** `{"<openid>":"DEV-01","<openid2>":"DEV-02"}`（MVP 建议 1 个，可配多个；**一个 openid 对应一个编号**）。
- 代码只读 `process.env.ADMIN_OPENIDS` 并 `JSON.parse`；缺失/空/解析失败 ⇒ 所有 `admin.*` 返回 `FORBIDDEN`（fail-closed）并记告警日志（**不泄露白名单内容**）。
- `developerNo` 由映射给出，只用于后台抬头与审计，**不是登录凭据**（CONTRACT §1.1）；⛔ 不进仓库、不进前端、不落 `users.roles`（ADMIN 不落库，避免改库提权）；`check.js` 扫 openid 形态字面量（§8.2 #19）。
- 每次请求都按 `OPENID` 重查映射（不缓存到进程级全局；如需缓存，TTL ≤60s 且失效即关闭 admin 通道）。
- **多开发者（v0.9）**：不同开发者各自微信登录、**各自独立会话与审计**（`admin_view_sessions.adminOpenid`、`admin_audit.adminOpenid` 隔离，**不共享票据**；`ACCOUNT_SWITCH_START` 的 `detail` 带 `developerNo`）；后台抬头显示当前 `developerNo`；`DEV-02…` 与 `DEV-01` 权限相同（同一套 admin 动作）；新增/移除开发者只改环境变量（用户操作）并跑 `admin.bootstrap` 冒烟。

**`DEEPSEEK_API_KEY`（v0.8，第三条"只存环境变量"铁律）**
- 位置：云开发控制台 → 云函数 → **`api`** → 函数配置 → 环境变量；`cleanup` 不需要该 Key（不调 AI）。
- 代码只读 `process.env.DEEPSEEK_API_KEY`；**缺失/空 ⇒ 不发起外呼、静默降级并写失败队列**（应用可正常启动）；日志/审计/`config`/数据库**永不落 Key**。
- 客户端（`pages/`、`pkg-*/`、`api/`、`utils/`、`shared/`、`components/`、`config/`）**零出现**该 Key 与 `api.deepseek.com`（门禁 #24）；文档只出现键名（#24/#25）。
- 轮换/吊销 = 控制台改环境变量后重新部署生效（不改代码）；事故处置：先关 `config.aiFallback.enabled`（降级）再换 Key。
### 3.5 云存储权限
- 目录（v0.6 统一，v0.7 不变）：`orders/{ticket}/image.jpg`（ticket = 服务端签发的不可猜随机串；**不用 orderId**，建单前不存在）；上传/查看/清理都按该路径与引用计数执行；查看一律经 `order.imageUrl` 换 5 分钟临时 URL。
- **头像目录（v0.9）**：`avatars/{role}/{random}.jpg`（`role ∈ CUSTOMER/PARTNER`；openid 用服务端身份，测试账号用 `targetId`；`random` 不可猜）；**只允许 `upload.prepare({purpose:'AVATAR'})` 签发该前缀路径**，路径与票据 `cloudPath` 逐字节相等才可用；≤`config.avatarMaxBytes`（默认 200KB）、jpg/png、建议 200×200；展示用 DTO 下发的 fileID 换 5 分钟临时 URL（不缓存、不落本地）；**替换头像/注销/删除测试账号即删旧文件**，cleanup `storage` 兜底扫无主 `avatars/` 文件。
- 权限落法：控制台存储"权限设置"优先选**仅创建者可读写**；若需禁创建者直读，改自定义安全规则（read=false、write 仅登录用户）。两种都以批 1 真机实测 `wx.cloud.uploadFile` 可用为准 [E5][R2]。
- never：公开读、永久 URL、截图/头像进通知/分享卡片/日志；**后台不提供截图直链、后台 DTO 不含 `avatarFileId`**；完整截图只在 READONLY 只读视角经 `order.imageUrl` 查看（审计）；**头像只经 DTO 下发给本人/当前绑定对方，不提供匿名直链，替换即删旧文件**。
### 3.6 全局配置 `config`（唯一运行时口径源，无费用项）
| 键 | 用途 | 默认/范围 | 谁能改 |
| :-- | :-- | :-- | :-- |
| `zoneLabels` | 五苑展示名（D8） | `D/X/N/B/C → 东苑/西苑/南苑/北苑/翠苑`（D8 已裁决；仍可由后台配置覆盖） | admin.updateConfig |
| `serviceCatalog` | 服务类型目录 `[{code,name,desc}]`（**只有类型名与说明**） | CONTRACT §6 五类 | admin.updateConfig |
| `announcement` / `maintenance` | 公告 / 维护模式开关+文案 | `''` / `{enabled:false,text:''}` | admin.updateConfig |
| `orderTimeoutMinutes` | 未接单超时 | 120 | admin.updateConfig |
| `autoCompleteHours` | 送达自动完成 | 24 | admin.updateConfig |
| `screenshotRetentionDays` | 截图留存 | 7 | admin.updateConfig |
| `viewTicketTtlMinutes` | **切换会话票据时长（v0.7；v0.9 两模式共用）** | 30，范围 5~60 | admin.updateConfig |
| `recognitionFailureRetentionDays`（v0.8） | **识别失败原图/记录保留** | 30，范围 7~30 | admin.updateConfig |
| `avatarMaxBytes`（v0.9） | **头像文件大小上限**（客户端压缩目标从 `config.getPublic` 取） | `200*1024`（200KB，范围 100KB~200KB；上限=隐私承诺 ≤200KB，不得放宽） | admin.updateConfig |
| `testAccountMaxPerRole`（v0.9） | **每位开发者每角色测试账号上限** | 3（范围 1~3；合计 ≤6） | admin.updateConfig |
| `testDataRetentionDays`（v0.9） | **测试数据保留天数**（超期未使用清空业务数据、账号保留） | 30（范围 7~90） | admin.updateConfig |
| `aiFallback`（v0.8） | **AI 兜底开关与限额**：`{enabled,model,timeoutMs,maxPerUserPerDay,dailyQuota,cooldownMinutes}` | 默认 `{enabled:false（实测后开）, model:'deepseek-chat', timeoutMs:8000, maxPerUserPerDay:5, dailyQuota:<按运营量定>, cooldownMinutes:10}`；值为次数/毫秒/布尔，**不含任何交易语义** | MVP **后台只读展示**（`admin.updateConfig` 白名单不含该键，P1 再开）；改值走部署配置脚本/控制台，且与隐私文本同步 |
| `privacyVersion` | 隐私版本号 | 由隐私文本定稿回填（文本键，非空≤32） | admin.updateConfig（隐私定稿流程；后台 config 页不提供编辑入口） |
| `subscribe`（P1） | 订阅消息 `{enabled,templates:{newOrder,status,exception}}` | 默认关闭 | admin.updateConfig |
- 客户端只经 `config.getPublic` 取公开子集（不含 `subscribe.templates` 的模板 ID、不含 `aiFallback` 的任何密钥类信息；**公开子集含 `avatarMaxBytes`（压缩目标）与 `viewTicketTtlMinutes`（黄条/蓝条倒计时），均为只读数值**）；`config` 缓存 TTL 5 分钟 + onShow 刷新；AI 开关/限额变更仅服务端生效（客户端不依赖开关做安全判断）；**`aiFallback` 不经 `admin.updateConfig`**（MVP 后台只读），改值走部署配置脚本/控制台并与隐私文本同步。
---
## 4. 云开发资源设计
### 4.1 云函数与代码分层
| 部署单元 | 分层 | 职责 |
| :-- | :-- | :-- |
| `cloudfunctions/api` | `index.js` | `cloud.init` + `getWXContext().OPENID` + 解包 → `createApi(deps)`（**唯一 require wx-server-sdk 的文件**） |
| | `router.js` | `action → handler` 纯分发；未登记 action 返回 `FORBIDDEN`；`visibility=internal`（`admin.bootstrap`/`health.check`/`cleanup.*`）仅放行部署脚本、定时触发器或 ADMIN_OPENIDS；**`viewAsStart/viewAsEnd` 为 client 可见但受 adminGuard 限制**（动作名沿用 CONTRACT §5.3，页面名与审计名用 account-switch 口径） |
| | `middleware/*` | auth → **switch-session** → validate → ratelimit → idempotency → audit（§4.3）；`switch-session` 负责票据解析、READONLY 拒写、TEST_WRITE 目标校验与 `actorOpenid/effectiveOpenid` 分流 |
| | `handlers/*` | 纯函数式业务：`handler(ctx, payload)`，deps 注入（db/now/openid/env/cloud），不 require sdk；**不感知会话**（只认中间件解析后的 `ctx.identity`） |
| | `db/*` | 集合注册表/dao/事务 + `dto/mask.js`（后台脱敏：**不含 `avatarFileId`、昵称脱敏**）/`dto/full.js`（本人/当前绑定对方视角）；**代码中唯一出现 `db.collection` 的位置** |
| | `lib/*` | `respond`/`errors`/`time` + **`id-generator.js`：唯一编号随机生成与碰撞重试** + **`tag-allocator.js`：roomTag 大写分配（A…Z/AA…）** |
| | `lib/ai/*`（v0.8） | DeepSeek 外呼适配（`fetch` 传输可注入）+ prompt 构造 + JSON 解析 + **payload 白名单**纯件；**不访问 DB、不感知身份**；全仓唯一允许出现 `api.deepseek.com`/`DEEPSEEK_API_KEY` 的云函数文件 |
| | `handlers/admin/{accountSwitch,testAccounts}.js`（v0.9） | 切换会话开启/结束（两模式共用 `admin_view_sessions`）、测试账号创建/删除/清数据（合成 `openid='TEST-<random>'` + 级联）；只解决"以谁的身份、是否可写"，不写业务规则 |
| `cloudfunctions/cleanup` | `index.js` + `sweeps/*` | `cleanup.*` 定时入口；每个 sweep 注入 `now/db/cloud`，返回 `{scanned, acted, failed}` 日志 |
| 共享代码 | `tools/sync-cloud-shared.js` | `shared/**` + **`utils/ids.js → shared/ids.js`** + **`utils/room-tag.js → shared/room-tag.js`** 复制到两云函数；**副本逐字节 hash 对帐**（check.js #17）；上传前必跑 |
- 云函数目录各自独立部署（不能 require 兄弟目录）⇒ 共享代码复制 + hash 门禁，禁止"服务端引用仓库根"。
- 依赖：每个 `package.json` **只有 `wx-server-sdk`**（版本 `npm view wx-server-sdk version` 实测后锁定并回填 `.tool-versions`）；不引第三方库。AI 外调用运行时内置 `fetch`（Node 18+）或 `https` 模块，**不新增 npm 依赖**；批 1 实测运行时能力并回填 RUNBOOK。
- 超时/内存/环境变量按控制台配置，全部记录进 `docs/RUNBOOK.md`。
### 4.2 action 路由表（CONTRACT v0.9 §5.3 定稿命名）
**表 4.2a 模块与动作（客户端可调用 + 已登记内部动作；CONTRACT v0.9 §5.3 全集）**
| 模块 | 动作 | 路由落点 | 说明 |
| :-- | :-- | :-- | :-- |
| `user` | `user.bootstrap`、`user.acceptPrivacy`、`user.deleteAccount` | `handlers/user/` | bootstrap 返回角色/资料完成度/绑定摘要/**`isDeveloper`**/切换会话上下文 `viewContext{viewMode,role,target}`，**不返回 openid**；`TEST_WRITE` 下返回目标测试账号上下文；注销排期（`deletionRequestedAt`，有进行中订单则拒；**TEST_WRITE 禁调**） |
| `customer` | `customer.saveProfile`、`customer.getProfile` | `handlers/customer/` | **首次保存成功即生成 `customerNo`（幂等）**；`saveProfile` 含 `displayName`/`avatarFileId`（**先签发 AVATAR ticket、保存时校验 ticket 归属+路径+大小/类型**）；宿舍身份仅"无进行中订单"时可改（`INVALID_STATE`）；头像/昵称只返回本人与当前绑定对方 |
| `partner` | `partner.activate`（入参 `invitationCode` + 昵称）、`partner.saveProfile`、`partner.saveServiceConfig`、`partner.getPublic`、`partner.listBindings`、`partner.unbindCustomer`、`partner.saveCustomerNote` | `handlers/partner/` | **激活成功建 `partners` 时生成 `partnerNo`**；`activate` **TEST_WRITE 禁调**；`saveProfile` 昵称/头像可改（同头像/昵称闸）；`getPublic` 凭完整 `partnerNo`、未绑定可调、只回公开字段（**含头像/昵称**）、**测试账号返回 `NOT_FOUND`**；`listBindings` 仅在 ACTIVE 绑定时返回对方头像/昵称；**零绑定入口（无添加/导入顾客动作）** |
| `bind` | `bind.create`（**仅顾客可调**；凭完整 `partnerNo`）、`bind.release`、`bind.getCurrent`、`bind.claimGuestOrder`（P1） | `handlers/bind/` | create 由**角色守卫**断言业务角色 CUSTOMER（PARTNER → `FORBIDDEN`）、**拒绝自绑**（`partner.openid === caller.openid`）、**拒绝真实×测试互绑**；限流 5 次/日/顾客；**绑定成功时分配大写 roomTag**；release reason 必填 + note≤100；`getCurrent` 返回 ACTIVE 摘要 + partner 公开资料（头像/昵称）+ roomTag；**解绑后不再返回对方头像/昵称** |
| `order` | `order.create`、`order.get`、`order.listCustomer`、`order.listPartner`（返回列表+`counts`）、`order.accept`、`order.reject`、`order.markPicked`、`order.unmarkPicked`、`order.markDelivered`、`order.unmarkDelivered`、`order.reportException`、`order.resolveException`、`order.cancel`、`order.confirmDelivery`、`order.correct`、`order.undo`、`order.deleteRecord`、`order.imageUrl` | `handlers/order/` | 状态动作见 4.2b；`listPartner` 返回列表 + `counts` **6 项**；**v1.0 单入口 `order.create`（一单多包裹），`order.createBatch` 已移除**；**无专用 batch 云函数**：批量=客户端循环+同一 `batchActionId`；**无任何费用类动作（v0.7）**；**guest 代客单路径不写 `bindings`**；TEST_WRITE 下 `orders.isTest` 服务端派生、事件/订单写 `impersonatedBy` |
| `message` | `message.send`、`message.list`、`message.markRead` | `handlers/message/` | 留言/消息中心聚合/已读水位；30 条/日/单；TEST_WRITE 下 `fromId=effectiveOpenid` |
| `upload` | `upload.prepare`、`upload.cancel` | `handlers/upload/` | `purpose ∈ {TICKET, AVATAR}`；TICKET → `orders/{ticket}/image.jpg`，AVATAR → `avatars/{role}/{random}.jpg`（**不含 openid**）；ticket 5 分钟 + 服务端构建路径 + `draftId`；AVATAR ≤`config.avatarMaxBytes`、jpg/png；**TEST_WRITE 下票据归属 `effectiveOpenid`** |
| `config` | `config.getPublic` | `handlers/config/` | 公开配置：zoneLabels、serviceCatalog（**仅 code/name/desc**）、announcement、maintenance、screenshotRetentionDays、orderTimeoutMinutes、autoCompleteHours、privacyVersion、`subscribeEnabled`（P1）、**`avatarMaxBytes` 与 `viewTicketTtlMinutes`（只读数值，v0.9）**；模板 ID/文案仅服务端使用、不下发客户端 |
| `health` | `health.check` | `handlers/health/` | 部署自检（**内部动作**：仅部署者/云函数内部可调，不对客户端开放） |
| `admin` | v0.8 全集（`createInvites/revokeInvite/listInvites/listCustomers/getCustomer/listPartners/setPartnerStatus/listOrders/getOrder/listAudit/updateConfig/stats/bootstrap` + **`viewAsStart/viewAsEnd`（`{role,targetNo,mode ∈ {READONLY, TEST_WRITE}}`，真实账号只允许 `READONLY`）** + 复核四动作）+ **v0.9 增 `createTestAccount`/`listTestAccounts`/`deleteTestAccount`/`purgeTestData`** | `handlers/admin/` | 仅 ADMIN_OPENIDS（JSON 映射 → `developerNo`）；逐动作写 `admin_audit`；后台 DTO 一律脱敏（§4.9，**不含头像、昵称脱敏**）；**`listCustomers/listPartners/listOrders` 默认排除测试账号与 `isTest` 数据**（显式切换才含，审计记 `includeTest`）；`viewAs*` 见 §4.8；测试账号四动作见 §4.11 |
| `ai` | `ai.parseParcel`（**v0.8 受控兜底唯一外呼出口**） | `handlers/ai/` + `lib/ai/` | 入参 `{ocrTextMasked≤2000, hintTrackingTail?, uploadTicketId, role}`；须登录且 role ∈ CUSTOMER/PARTNER；**切换会话（READONLY/TEST_WRITE）一律 `FORBIDDEN`**（v0.9：切会话不外呼、不产生测试复核记录）；外呼失败/超时/熔断/超配额**静默降级**、**不新增错误码**；失败必写 `recognition_failures`（§4.10） |
| `cleanup` | 内部 `cleanup.*`（orderTimeout/autoComplete/files/tickets/viewSessions/retention/accountDeletion/invitationCodes/rateLimits/recomputeStats/recognitionFailures/**testData（v0.9）**） | `cloudfunctions/cleanup/` | **不对客户端开放**；router 对非客户端注册表 action 返回 `FORBIDDEN` |

- **动作注册纪律**：`shared/actions.js` 收录 CONTRACT §5.3 **全部**动作并带 `visibility`（`client`/`internal`）与 **`write` 标记**（v0.9：供 `switch-session` 判 READONLY 拒写、TEST_WRITE 白名单）；`internal` = `admin.bootstrap`/`health.check`/`cleanup.*`；router 只对 `client` 开放；**禁止未登记 handler、禁止 handler 自行命名 action**；`ai.parseParcel` 仅限识别失败兜底（不是通用 AI 网关：不做自由问答/图像理解/批量识别）。
- **TEST_WRITE 写白名单（v0.9，CONTRACT §1.3）**：允许业务写（订单/留言/绑定/资料/服务配置/上传）；**禁止** `admin.*`、`partner.activate`、`user.deleteAccount`、`ai.parseParcel`；READONLY 拒绝一切写（含上述）。
- **编号纪律（v0.7）**：任何 handler 不得接受客户端传入的编号作为身份或唯一性依据；编号只由 `lib/id-generator` 生成、只由唯一索引兜底（§4.5）。
**表 4.2b 订单动作矩阵（状态 × 事件；语义以 CONTRACT v0.9 §5 + DATA_MODEL §8.2 为准）**
| action | 允许起始状态 | 目标/副作用 | 事件 | 幂等键 |
| :-- | :-- | :-- | :-- | :-- |
| `order.create` | 资料完整 + ACTIVE 绑定（guest 由兼职）+ 目标兼职 `serviceConfig.acceptingOrders=true`（关闭 ⇒ `PARTNER_CLOSED`，零建单） | SUBMITTED（一单内 1~10 件包裹同事务原子写） | `ORDER_CREATED`（合并窗口追加时为 `PARCELS_APPENDED`） | `orders.requestKey` 唯一 |
| `order.accept` | SUBMITTED，该兼职工的 | ACCEPTED | `ACCEPTED` | `order_events.requestKey` |
| `order.reject` | SUBMITTED | CANCELLED（reason 必填） | `REJECTED` | 同上 |
| `order.markPicked` | ACCEPTED（码非空或 DROP_OFF） | PICKED | `PICKED` | 同上 |
| `order.unmarkPicked` | PICKED（5 秒窗/未撤销过） | ACCEPTED，清 pickedAt | `PICKED_REVERTED` | 同上 |
| `order.markDelivered` | PICKED | DELIVERED（deliveryNote ≤100） | `DELIVERED` | 同上 |
| `order.unmarkDelivered` | DELIVERED（同窗口） | PICKED | `DELIVERED_REVERTED` | 同上 |
| `order.reportException` | ACCEPTED/PICKED/DELIVERED | EXCEPTION（记 exception.fromStatus） | `EXCEPTION_REPORTED` | 同上 |
| `order.resolveException` | EXCEPTION | 回 fromStatus（仅 ACCEPTED/PICKED/DELIVERED，否则 ACCEPTED） | `EXCEPTION_RESOLVED` | 同上 |
| `order.cancel` | 顾客：`SUBMITTED`/`ACCEPTED`，或 `EXCEPTION` 且 `exception.fromStatus ∈ {SUBMITTED, ACCEPTED}`；`PICKED`/`DELIVERED` 顾客不可直接取消；兼职：非终态；admin：仅异常介入（原因必填+审计） | CANCELLED（cancelReason+cancelledBy） | `CANCELLED`；系统超时 `TIMEOUT_CANCELLED` | 同上 |
| `order.confirmDelivery` | DELIVERED，顾客本人 | COMPLETED | `COMPLETED` | 同上 |
| `order.correct` | SUBMITTED/ACCEPTED/EXCEPTION 全字段；PICKED 仅柜号/运单尾号 | 状态不变（补码→codeStatus=OK） | `ORDER_CORRECTED` | 同上 + batchActionId |
| `order.undo` | **仅** `markPicked`/`markDelivered` 后 5 秒内且无后续状态变化 | 回退到各自动作前状态 | `PICKED_REVERTED`/`DELIVERED_REVERTED`；**`ACCEPTED → SUBMITTED` 不在撤销范围**（误接单走 `order.cancel`） | 同上 + batchActionId |
| `order.deleteRecord` | COMPLETED，顾客本人 | 只写 `deletedByCustomerAt`（7 天后物理删），不硬删 | `DELETED_BY_CUSTOMER` | 同上 |
| `order.get` / `order.listCustomer` / `order.listPartner` / `order.imageUrl` | 读 | — | — | — |

- 身份只来自 `OPENID`（真实会话）或**服务端票据解析出的 `effectiveOpenid`（切换会话）**；客户端传的 orderNo/partnerId/编号只当查询条件（CONTRACT §4 铁律）。
- **测试数据标记（v0.9）**：`orders.isTest` 由服务端按参与账号 `isTestAccount` **派生**（不接受客户端传值）；TEST_WRITE 会话额外写 `impersonatedBy=developerNo`；测试订单/事件/留言全部标测试来源，统计与红点默认排除。
- 每次写：`orders.version` 乐观锁（带 `expectedVersion` 不符 → `CONFLICT`）+ 同一事务内写 `order_events`；重放返回原结果视图（不重复写事件）。
- 批量：**不设专用 batch 云函数**；取件/送达/纠正/撤销由客户端循环逐单调用并携带同一 `batchActionId`，服务端逐单返回，客户端汇总"成功 N/失败 M"如实上屏；**下单侧一图多码/多图合并已并入 `order.create` 的一单多包裹**（同事务原子写，不再有批量建单动作）。
- 代客单（guest）：`customerId/customerOpenid/customerNo=''` + `guest{...}` 快照；**不产生绑定、不写 `bindings`**；无顾客确认路径，`DELIVERED` 后由自动完成任务（含 guest）转 `COMPLETED`；MVP 不提供认领；展示默认头像 + "代客单"标签。
- **绑定方向（v0.9）**：`bind.create` 仅顾客发起；兼职端零入口；代客单只是"替没有 app 的顾客建单"，**不能因此产生绑定**；解绑 ≠ 重新绑定（重新绑定只能顾客本人发起）。
- **接单开关**：`partner.serviceConfig.acceptingOrders=false` ⇒ `order.create` 一律 `PARTNER_CLOSED`（文案"该兼职暂不接单"）；恢复开关后自动可下单；顾客端下单入口按 `partner.getPublic.acceptingOrders` 置灰（前端只是提示，服务端仍拦）。
### 4.3 请求协议与中间件链
**协议（CONTRACT v0.9 §5.3 定稿）**：请求 `{ action, data, clientRequestId(16~32), expectedVersion?, viewTicket? }`；响应 **flat `{ ok, code?, message?, data?, serverTime, requestId? }`**（`requestId` 服务端生成、仅用于日志排障，客户端不解释；字段级校验错误用 `data.field` 指字段名；重复写请求返回 `ok:true` + 当前对象，不再报错）。
**`viewTicket` 只允许由 `api/client.js` 从内存 `viewContext` 注入**；页面/组件不得出现该字段；服务端只接受"发起人仍在 ADMIN_OPENIDS 白名单且票据 `adminOpenid` 匹配"的票据。
| 顺序 | 中间件 | 做什么 | 失败返回 |
| :-- | :-- | :-- | :-- |
| 1 | `trace` | 生成 `requestId`、计时、解包 | `VALIDATION_FAILED` |
| 2 | `auth` | OPENID → users（懒建）→ roles/status；admin 查 env 白名单并注入 `developerNo`；DEACTIVATED 拒 | `FORBIDDEN` |
| 3 | `switch-session`（v0.9） | 请求带 `viewTicket` 时：票据存在/未过期/`endedAt` 空/发起人仍白名单/`adminOpenid` 匹配；`READONLY` ⇒ 写动作一律 `FORBIDDEN`；`TEST_WRITE` ⇒ 目标 `users.isTestAccount=true` 且 `status=ACTIVE`，写动作按 §4.2 白名单放行；**交叉校验 `targetId/targetIsTest/impersonatedBy` 与票据一致**（票据不可挪用到其他账号/模式）；通过后 `ctx.identity={actorOpenid(开发者), effectiveOpenid(目标), role, isTest, impersonatedBy}`；目标已删除/停用 ⇒ `NOT_FOUND` | `FORBIDDEN` / `NOT_FOUND` / `VIEW_TICKET_EXPIRED` |
| 4 | `validate` | 按 `actions.js` schema 校验并剥离未知字段；枚举/长度/字符集/文本上限；**编号按 `shared/ids.js` 归一化、roomTag 按 `^[A-Z]+$` 校验、昵称按 ≤20 字闸**（错前缀给统一提示） | `VALIDATION_FAILED`（`data.field`） |
| 5 | `ratelimit` | `counters.rl:{scope}:{openid}:{window}`（scope 至少 `bind/activate/order/message/accountSwitch/avatarUpload/ai`）；**切换会话按 `effectiveOpenid` 计（测试配额独立）**；超限拒；**`ai.parseParcel` 例外：不抛错，见本节链路差异** | `RATE_LIMITED`（AI 兜底不在此层返回） |
| 6 | `idempotency` | `orders.requestKey` / `order_events.requestKey` 预查；命中返回原结果 | 成功式重放；键归属不符 → `CONFLICT` |
| 7 | `handler` | 纯业务（deps 注入），返回 data | 13 码集内的业务错误码 |
| 8 | `audit` | 订单事件/管理审计 append-only（`ACCOUNT_SWITCH_*`/`TEST_ACCOUNT_*`/`TEST_DATA_PURGE`；`VIEW_AS_*` 已作废） | 审计失败不静默吞（`INTERNAL_ERROR` + 告警日志） |
| 9 | `respond` | 统一 flat 包络；未知异常 → `INTERNAL_ERROR`（不泄露堆栈/细节） | — |

- 写动作必传 `clientRequestId`（缺失/格式错 → `VALIDATION_FAILED`）；读动作不需要；`cleanup.*` 只允许定时触发器调用（客户端调用 → `FORBIDDEN`）。
- 限流配额来源 `config`（默认取 CONTRACT §10）；限流/审计基础设施失败时**失败关闭**（拒绝写）并记日志。
- **切换会话读白名单（v0.9，CONTRACT §1.2/§1.3）**：`user.bootstrap`、`customer.getProfile`、`partner.listBindings`、`bind.getCurrent`、`order.get`、`order.listCustomer`、`order.listPartner`、`message.list`、`order.imageUrl`、`config.getPublic`；其他读动作一律拒绝（含 admin 动作：**票据不能当后台凭据**）。`READONLY` 只走上列白名单；**`TEST_WRITE` 额外放行读动作 `partner.getPublic`**（测试兼职预览，真实顾客仍 `NOT_FOUND`；`switch-session.js` 的 `TEST_WRITE_READ_ALLOW` 单源）**+ §4.2 的业务写白名单**。
- **身份传播（v0.9）**：`admin_audit.adminOpenid` = `actorOpenid`；业务/限流/`upload_tickets.openid`/`order_messages.fromId`/`order_events.actorId` = `effectiveOpenid`；`impersonatedBy=developerNo` 只落订单与事件；**handler 只读 `ctx.identity`，不得自行解析票据或写"if 视角"分支**。
- **绑定方向角色守卫（v0.9）**：`auth` 后由 `guard-bind` 断言 `bind.create` 的业务角色 = CUSTOMER（TEST_WRITE 下取目标测试账号角色）；PARTNER 调用一律 `FORBIDDEN`；守卫在 validate 前执行（先拒后校验，避免通过报错差异探测）。
- **AI 兜底的链路差异（v0.8）**：`ai.parseParcel` 同样走 trace/auth/validate/handler/respond，但 **`ratelimit` 中间件不对它抛 `RATE_LIMITED`**——配额在 handler 内用 `counters.rl:ai:{openid}:{day}` 与 `counters.rl:ai:global:{day}` 判定，超限**不发外呼**、直接降级并写队列（用户侧静默）；`validate` 剥离未知字段，`ocrTextMasked` 超长 → `VALIDATION_FAILED`；**READONLY/TEST_WRITE 调 `ai.parseParcel` → `FORBIDDEN`**（写队列，不属于读白名单且会污染复核数据）。
- **`user.bootstrap` 读并行（P0-4 性能口径）**：会话/`users`/`customers`/`partners`/`bindings` 五读互不依赖，handler 内一次 `Promise.all` 并行（少 4 个串行 DB RTT）；`boundPartner` 依赖 `binding.partnerId` 结果仍在其后取；失败语义不变（任一读失败与旧实现同路径抛错，不新增降级分支）。DB 读次数与返回 DTO 形状均不变。
- **`db/config` 同请求复用（P0-9 口径）**：每请求固定 1 次 `config` 读（`app.js` 的 `loadRuntimeConfig`），全部 handler 只经 `ctx.config` / `configCommon.loadRuntimeConfig(ctx)` 复用；跨请求 TTL 缓存**不做**（会让 `admin.updateConfig` 生效延迟，待裁决）。新增 handler 不得在请求内二次 `readConfig`。
### 4.4 错误码（唯一集 = CONTRACT v0.9 §5.3 的 13 个）
`shared/error-codes.js` **只允许**以下 13 个 code（check.js #20 与 CONTRACT 双向校验，旧码零命中）：
`VALIDATION_FAILED`（参数/长度/枚举/文本超限/编号格式；`data.field` 指字段）｜`FORBIDDEN`（越权/角色/停用/维护/未登记 action/切换会话写操作：READONLY 全部写、TEST_WRITE 禁项）｜`NOT_FOUND`（资源不存在或不在身份范围）｜`CONFLICT`（版本/唯一键/状态冲突）｜`INVALID_TRANSITION`（非法状态流转）｜`INVALID_STATE`（业务前提不满足：资料/绑定/服务范围/撤销窗/换宿舍有进行中订单等）｜`RATE_LIMITED`｜`INVITE_EXPIRED`（邀请码已过期）｜`INVITE_USED`（邀请码已被使用）｜`VIEW_TICKET_EXPIRED`（只读视角票据过期）｜`PARTNER_CLOSED`（兼职注销/停用，或 `acceptingOrders=false` 暂不接单）｜`DEPENDENCY_FAILED`（云依赖/编号耗尽/重试耗尽）｜`INTERNAL_ERROR`（兜底，不泄露细节）。
**旧码 → 新码映射（代码/文档一律禁止再出现旧名）**
| 旧码 | 映射 |
| :-- | :-- |
| `INVALID_PARAM`、`INVALID_REQUEST_ID` | `VALIDATION_FAILED` |
| `INTERNAL` | `INTERNAL_ERROR`；`VERSION_CONFLICT`、`ALREADY_BOUND`、`TICKET_USED`、`INVITE_CONFLICT` → `CONFLICT` |
| `PROFILE_INCOMPLETE`、`NO_ACTIVE_BINDING`、`SERVICE_*`、`ORDER_ACTIVE`、`NOTHING_TO_UNDO`、`CODE_REQUIRED`、`DELIVERY_NOTE_REQUIRED` | `INVALID_STATE` |
| `PARTNER_INACTIVE` | `PARTNER_CLOSED`（CLOSED/SUSPENDED 同码，`message` 区分停用/注销） |
| `CODE_EXPIRED` / `CODE_USED`（v0.6 旧名） | `INVITE_EXPIRED` / `INVITE_USED` |
| `CODE_INVALID/REVOKED`（邀请码不存在/已作废） | `NOT_FOUND` |
| `VIEW_TICKET_INVALID/FORBIDDEN`、`TICKET_INVALID/FORBIDDEN`、`TICKET_EXPIRED` | `FORBIDDEN`/`NOT_FOUND`；**切换会话票据过期 → `VIEW_TICKET_EXPIRED`** |
| `UPLOAD_TOO_LARGE`、`UNSUPPORTED_TYPE`、`CONTENT_REJECTED` | `VALIDATION_FAILED` |
| `ORDER_NO_EXHAUSTED`、`PARTNER_NO_EXHAUSTED`、`NUMBER_EXHAUSTED` | `DEPENDENCY_FAILED` |
| `UNAUTHENTICATED`、`UNKNOWN_ACTION`、`ACCOUNT_DISABLED`、`MAINTENANCE` | `FORBIDDEN` |

- **邀请码错误映射（v0.7 统一，CONTRACT §4.2）**：不存在/已作废 → `NOT_FOUND`；已过期 → `INVITE_EXPIRED`；已使用 → `INVITE_USED`；格式错误 → `VALIDATION_FAILED`（`data.field=invitationCode`）。
- **编号错误**：格式/长度/字母表不符 → `VALIDATION_FAILED`（`data.field` 按场景 = `partnerNo`/`invitationCode`）；错前缀（顾客编号/开发者编号）同样 `VALIDATION_FAILED` 但 `message` 用 §5.3 的统一前缀提示，**不暴露该编号是否存在**。
- **AI 兜底不新增码（v0.8）**：`ai.parseParcel` 在外呼失败/超时/熔断/超配额/JSON 解析失败时仍返回 **`ok:true` + `recognized:false`**（可带 `failureId`），**不占用 13 码**；入参非法 → `VALIDATION_FAILED`；无登录/无业务角色/切换会话调用 → `FORBIDDEN`。`recognition_failures.failureCode`（5 枚举）是**记录字段**，不是业务错误码。
- **账号切换/测试账号不新增码（v0.9）**：真实账号传 `TEST_WRITE`、真实×测试互绑/互下单、切换会话调禁用动作 → `FORBIDDEN`；票据问题沿用 `VIEW_TICKET_EXPIRED`；目标被删除/停用 → `NOT_FOUND`；删除/清空测试数据前置不满足（真实引用/确认不全）→ `INVALID_STATE`；`ACCOUNT_SWITCH_*`/`TEST_ACCOUNT_*`/`TEST_DATA_PURGE` 是**审计枚举**，不是业务错误码。
- 与费用相关的旧码已随零金额口径**整体删除**，不在映射表列出（代码/文档零残留，check.js #20 + 零金额门禁双向校验）。
- 客户端不写死文案：`shared/error-copy.js` 按 13 码映射（唯一文案处）；页面只决定展示位置/是否给"下一步"。
- 每个失败响应必带 `serverTime`；`requestId` 可有可无（有则只进日志/反馈定位）。
### 4.5 数据访问层、事务与幂等
- **集合注册表**：`shared/collections.js` 列 **14 集合**（v0.8 增 `recognition_failures`）；handlers/sweeps 只经 `db/dao` 访问。
- **查询必带范围**：顾客 = `customerId/customerOpenid = 自己`；兼职 = `partnerId/partnerOpenid = 自己`；admin = 白名单 + 后台脱敏（默认排除测试数据）；**切换会话 = 中间件解析出的 `effectiveOpenid`（与本人查询同一条路径，禁止 handler 内写"if 视角"分支）**；"按 id 取单"必须再校验归属（代客单 guest 仅创建兼职工可读）；**测试账号查询附加 `isTest/isTestAccount` 条件，真实查询强制 `isTest=false`**。
- **编号生成（v0.7，唯一性三保险）**：
  1. **生成**：`lib/id-generator.js` 用 `crypto.randomBytes` + 拒绝采样映射 32 字母表（`23456789ABCDEFGHJKLMNPQRSTUVWXYZ`，剔除 `0/1/I/O`），`customerNo`=`C`+8、`partnerNo`=`P`+6；不取自 openid、不自增、不排序。
  2. **时机**：`customerNo` 在顾客资料**首次创建成功**时生成（`user.bootstrap` 懒建 / `customer.saveProfile` 内 create-if-absent，幂等：已存在即返回，不换号）；`partnerNo` 在**邀请码激活成功、创建 `partners` 文档时**生成（同一事务内）。
  3. **兜底**：唯一索引 `uk_customer_no`/`uk_partner_no`；插入冲突 → 重新生成 **≤5 次**；仍失败 → `DEPENDENCY_FAILED`。编号**不可修改、不复用、注销作废**。
- **服务端不信任客户端编号**：客户端传的 `customerNo/partnerNo` 只作查询条件/展示提示，绝不作为身份或唯一性判据；绑定/激活以服务端查询到的记录为准（CONTRACT §3.1 规则 5）。
- **测试账号身份（v0.9）**：合成 `openid='TEST-<random>'`（**非空、不可猜**）；`users._id`、`customers._id`（测试顾客）、`partners.openid` 同值；切换会话写动作全部以该 `effectiveOpenid` 为业务身份；`users.isTestAccount=true`、`createdByDeveloperNo`、`testLastUsedAt`；**测试账号数据永不进入真实查询/统计/红点**，真实×测试互操作一律 `FORBIDDEN`。
- **roomTag 大写分配（v0.9）**：`lib/tag-allocator.js` 在绑定事务内取 `counters.tag:{partnerId}:{dormKey}` 自增 → `toTag(seq)`（`A…Z/AA…`）写 `bindings.roomTag`；排序用 `tagRank`（Excel 列名序，**不能按字符串比较**）；换宿舍重新分配、旧 tag 保留历史不复用；**落库/展示前断言 `^[A-Z]+$`**。
- **测试数据标记派生（v0.9）**：`orders.isTest` = 参与账号 `isTestAccount` 快照（服务端派生，客户端不可传）；`orders/order_events.impersonatedBy` 仅 TEST_WRITE 写入；`admin.stats`/`partners.stats`/后台红点/邀请码统计查询强制 `isTest=false` 且排除 `isTestAccount=true` 账号。
- **事务与计数器**：`counters` 三键族——`orderNo:YYYYMMDD`（当日全局序号）、`tag:{partnerId}:{dormKey}`（roomTag 序号，**绑定成功时**分配；旧 tag 不复用/允许空洞）、`rl:{scope}:{openid}:{window}`（限流，cleanup 每日清过期）。**换宿舍**：仅"无进行中订单"时可改，事务内旧 binding `RELEASED` → 新建 binding → 新 `dormKey` 下重分配 roomTag；**禁止原地改 `bindings.dormSnapshot`**，已存在订单保留创建时快照。
- **乐观锁**：`orders.version`；带 `expectedVersion` 不符 → `CONFLICT`；不带也在事务内读最新校验状态。
- **唯一冲突处理**：`requestKey` 重复 → 校验 actor 后返回已存在对象（幂等成功）；`activeKey` 重复 → 事务重试 ≤3 次或返回现有绑定；`orderNo` 冲突 → 重试取号（≤3）；`customerNo/partnerNo` 冲突 → 重生成（≤5）；`invitation_codes.code` 冲突 → 重生成（≤5）。
- **分页与排序（服务端定稿，客户端不重排）**：`limit ≤100`、默认 20，游标 `(sortValue,id)` 禁 skip；顾客"进行中"按 `statusUpdatedAt desc`、"已完成/已取消"按 `completedAt/cancelledAt desc`；兼职工作台返回"状态桶 + 站点 + 四档动线"视图；`order.listPartner` 同时返回 `counts`（6 项）；游标用 `(statusUpdatedAt, orderNo)` / `(completedAt, orderNo)`；兼职客户列表按 `dormKey` 升序、同宿舍按 `roomTag` 升序；后台列表按编号/宿舍/称呼搜索 + 分页（`limit ≤100`）。
- **列表 DTO 分级（v0.7；v0.9 增头像/昵称）**：①本人（顾客/兼职）返回完整取件码/尾号/宿舍/编号 + 自己的头像/昵称；②**切换会话**返回与目标本人一致的 DTO（READONLY 只读；TEST_WRITE 额外可写测试数据；审计在入口层，不在 DTO 层）；③admin 后台默认脱敏（`dto/mask.js`：取件码打码、尾号仅后 2 位、宿舍只到苑+楼栋、**不返回 openid、不返回 `avatarFileId`、昵称脱敏**、不提供"显示完整"变体）；④日志/通知/分享卡片一律 L3 脱敏且不含头像/昵称。**头像/昵称只随"当前 ACTIVE 绑定关系"返回给绑定对方**（`bind.getCurrent`/`partner.listBindings`/客户档案/订单详情），解绑/停用/注销后立即不再返回。
- **读屏蔽**：任何列表不返回 openid/partnerId/clientRequestId/requestKey；`partner.listBindings` 不返回顾客 openid；编号快照仅用于展示/搜索。
- **编号快照**：`orders.customerNo/partnerNo` 在建单/接单时写入；后续编号不可变，快照即历史真值；guest 单 `customerNo=''`。
### 4.6 集合、索引、安全规则与初始化
**安全规则（14 集合全部）**：控制台 → 数据库 → 集合 → 权限设置 → **自定义安全规则**：`{"read": false, "write": false}`（客户端读写全拒；云函数 admin 权限绕过）。**没有任何集合对客户端开放**（含 `recognition_failures`：原图引用与失败文本只经复核动作读取）。

| 集合（索引全集见 DATA_MODEL §5.1） | 唯一索引（必须） | 清理/查询关键索引 |
| :-- | :-- | :-- |
| `users` | `_id` 内置（测试账号为合成 `openid='TEST-<random>'`） | `idx_deletion(deletionRequestedAt)`（注销 30 天排期）、**`idx_test_account(isTestAccount,testLastUsedAt)`（测试数据 30 天清理）** |
| `customers` | `_id` 内置、**`uk_customer_no(customerNo)`** | `idx_zone_building`（后台按苑/楼栋筛选） |
| `partners` | `uk_openid(openid)`、**`uk_partner_no(partnerNo)`** | `idx_status` |
| `bindings` | `uk_active_key(activeKey)`、`uk_tag_key(tagKey)` | `idx_partner_status`、`idx_customer_status` |
| `orders` | `uk_order_no(orderNo)`、`uk_request_key(requestKey)` | `idx_status_created`、`idx_finalized`、`idx_deleted_customer`、`idx_image_file`、`idx_customer`/`idx_partner`（归属查询）、**`idx_istest_created(isTest,createdAt)`（测试数据排除与清理）** |
| `order_events` | `uk_request_key(requestKey)` | `idx_order_at`、`idx_orderNo_at` |
| `order_messages` | — | `idx_order_created`、`idx_order_read` |
| `invitation_codes` | **`uk_code(code)`** | `idx_status_expire`（cleanup 置 EXPIRED / 后台按状态筛选） |
| `admin_view_sessions` | `_id=viewTicket` 内置 / 以 `adminOpenid` 判重用（同开发者单活） | `idx_expire(expiresAt)`、`idx_ended(endedAt)`、**`idx_mode_expire(viewMode,expiresAt)`**、**`idx_target(targetId)`（删除测试账号时结束会话）** |
| `counters` | `uk_key(key)` | — |
| `config` | `_id=global` 内置 | — |
| `admin_audit` | — | `idx_action_at`、`idx_admin_at`、`idx_target` |
| `upload_tickets` | `uk_ticket(ticket)` | `idx_expire` |
| `recognition_failures`（v0.8） | **`uk_failure_no(failureNo)`、`uk_request_key(requestKey)`** | `idx_status_created(status,createdAt)`、`idx_uploader(uploaderOpenid)`、`idx_order(orderId)`、`idx_created(createdAt)`（复核保留期 cleanup） |

**初始化步骤（批 1；用户 + agent 分工）**
1. 【用户】确认 appid 主体/类目可用；开通云开发并创建**唯一云环境**（D1 修订：账号只能开 1 个环境），envId 交 agent 填 `config/env.js` 三档（D1/D2 开工门）。
2. 【用户/agent 同屏】控制台创建 **14 个集合**（名称严格按 DATA_MODEL §1 集合总览；`config` 用 `_id='global'`；`recognition_failures` 为 v0.8 新增；**v0.9 不新增集合**——测试账号是 `users`/`customers`/`partners` 里的合成文档，头像复用云存储与 `upload_tickets`）。
3. 【用户】每集合权限设置自定义安全规则 read/write 均 false，截图存档。
4. 【用户】按 DATA_MODEL §5.1 建全部索引（`unique` 必须建，**含 `uk_customer_no`/`uk_partner_no`/`uk_code`**；存量冲突先清场），导出/截图索引清单作为批 1 退出证据。
5. 【agent】部署 `api` → 调 `admin.bootstrap`（**内部动作**：幂等、仅 ADMIN_OPENIDS/部署脚本）：幂等建/校验 **14 集合**与索引并返回 `{collections,indexes,configSeeded}` 清单（平台不支持代码建索引时列出缺失项，不替代控制台步骤；缺失项由部署者补齐）、写 `config/_id='global'` 种子（§3.6 全部键，含 `viewTicketTtlMinutes=30`、`avatarMaxBytes=204800`、`testAccountMaxPerRole=3`、`testDataRetentionDays=30`、`recognitionFailureRetentionDays=30`、`aiFallback{enabled:false,...}`、`serviceCatalog` 仅 code/name/desc）；重复调用结果一致。
6. 【用户】配置 `api` 环境变量 `ADMIN_OPENIDS`（**JSON 映射，MVP 含 `DEV-01`；多开发者加 `DEV-02…`**）与 `DEEPSEEK_API_KEY`（v0.8；可先留空以验证"未配置即降级"）；【agent】admin openid 跑 `health.check` + `admin.createInvites` + `admin.createTestAccount/listTestAccounts` 冒烟。
7. 【用户】配置云存储权限（§3.5）；【agent/用户】真机验证"上传→临时 URL→7 天清理"链路（批 4/批 8）。
8. 【agent】把"索引/安全规则/环境变量/触发器"实测截图与命令写进 `docs/RUNBOOK.md`。
9. 【用户/agent】测试账号冒烟（v0.9）：后台创建测试顾客/测试兼职 → 以 `TEST_WRITE` 各走一次下单/接单/送达/确认 → 确认 `admin.stats`/红点不计数、真实列表不可见 → `deleteTestAccount` 先 `dryRun` 看计数再删除 → 审计 `TEST_ACCOUNT_*` 可查；同时验证真实账号传 `TEST_WRITE` → `FORBIDDEN`。
### 4.7 `cleanup` 定时任务（内部 `cleanup.*`；单触发器定稿）
| 任务（内部 action） | 到期条件（幂等） | 动作 | 上限 |
| :-- | :-- | :-- | :-- |
| `cleanup.orderTimeout` | `SUBMITTED` 且超 `orderTimeoutMinutes` 未接单 | CANCELLED + `TIMEOUT_CANCELLED`（SYSTEM） | 每轮 100 条 |
| `cleanup.autoComplete` | `DELIVERED` 且超 `autoCompleteHours` 未确认（**含 guest 单**） | COMPLETED + `AUTO_COMPLETED`（SYSTEM） | 100 |
| `cleanup.files` | 终态超 `screenshotRetentionDays`（默认 7） | 按 `image.fileId` 引用计数归零删云文件（`orders/{ticket}/image.jpg`）并写 `orders.image.cleanedAt`、清订单图片引用；**无主 `avatars/` 自动清 MVP 不可行（TD-051，见本节末）** | 100 |
| `cleanup.tickets` | `upload_tickets` 过期（宽限 24h，含已使用） | 删票据（无主文件扫描 MVP 不可行，TD-051） | 100 |
| `cleanup.viewSessions`（v0.7） | 票据 `expiresAt` 已过或 `endedAt` 超 7 天 | 过期未结束 → 补写 `endedAt` + 记一条 `ACCOUNT_SWITCH_EXPIRED`（每票至多一条）；结束超 7 天 → 物理删会话 | 100 |
| `cleanup.retention` | 终态超 180 天且 `anonymizedAt` 空 → 匿名化；`anonymizedAt`+30 天或 `deletedByCustomerAt`+7 天 → 物理删 | 匿名化（去 openid/昵称/尾号/宿舍/截图/留言文本/事件 payload PII/编号快照）+ 级联删订单/留言/事件 | 100/类 |
| `cleanup.accountDeletion` | `users.deletionRequestedAt` + 30 天 | 物理删 customers/partners/bindings/tickets/**头像文件**；编号作废不回收；**识别失败记录：`uploaderOpenid` 置空（匿名化）、原图按引用计数删、`ocrTextMasked` 保留至到期（默认 30 天）后物理删；复核审计日志保留**（CONTRACT §11.4） | 100 |
| `cleanup.invitationCodes`（v0.7） | `UNUSED` 且 `expiresAt` 过期 | 置 `EXPIRED`（已使用/已作废不动，不可"重新生效"） | 100 |
| `cleanup.recognitionFailures`（v0.8；M-02 批 10 修订） | `createdAt` 超 `recognitionFailureRetentionDays`（7~30，默认 30）且 `status∈{PENDING,IGNORED,FIXED}` | **按 CONTRACT §11.1 优先修正**：到期删原图引用（`fileId` 置空；引用计数 0 才删云文件）；`PENDING` → 置 `IGNORED` + `resolution.note='EXPIRED'`；**`IGNORED/FIXED` 保留状态与复核结果、只清原图引用**（修旧实现 FIXED 永不清理）；同一 fileId 仍被订单引用则按订单截图规则（§4.1） | 100 |
| `cleanup.testData`（v0.9） | `users.isTestAccount=true` 且 `testLastUsedAt` 超 `testDataRetentionDays`（默认 30） | 清空该测试账号业务数据（订单/事件/留言/绑定/上传票据/头像文件），**账号保留**；写 `admin_audit{action:'CLEANUP', detail:{sweep:'testData',accountId,counts}}`；重跑幂等 | 100/类 |
| `cleanup.rateLimits` | `rl:*` 窗口过期 | 删除计数文档 | 100 |
| `cleanup.recomputeStats` | 每次运行 | 重算 `partners.stats`（**只含单量：todayOrders/totalOrders/completedOrders**，无费用字段）；写 `admin_audit{action:'CLEANUP', detail:{counts}}` | — |

- **调度**：`cleanup` **只配一条定时触发器，每 10 分钟**；每次按"到期条件"幂等执行全部任务，**不要求多触发器**。代价 = 高频查询（索引覆盖 + 每轮限 100 条）；上线后按控制台调用日志评估是否降频，结论写 `docs/RUNBOOK.md`。
- **无主文件兜底（批 8 实测限制，TD-051）**：`upload_tickets` 只存 `cloudPath` 不存 fileID，`wx-server-sdk` 无"列举文件"API ⇒ §4.7 `files/tickets` 的"无引用文件/无主 `avatars/` 扫描删除"**MVP 不可自动实现**；当前按「订单 `image.fileId` 引用计数 + 票据/账号删除时已知 fileID」清理，残留由用户在控制台人工清理（RUNBOOK §7）；P1 方案 = api 消费票据时把 fileID 回写 `upload_tickets` 再交 cleanup 自动清理。`CLEANUP` 汇总审计按 §10.2 步骤 11 每轮一条（10 分钟一轮，幂等 requestKey）。
- **异常单超时提醒不落库、不发送**：工作台/管理端按 `exception.at + 阈值` 查询派生；P1 订阅消息另做（模板 ID/开关/文案在 `config`）。
- **留存时间线**：终态 180 天匿名化 → +30 天物理删；软删 COMPLETED 7 天物理删；截图 7 天；**头像替换即删旧文件、注销/删测试账号删文件**；切换会话结束/过期后 7 天删；**识别失败原图/记录 `recognitionFailureRetentionDays`（默认 30，到期删引用；PENDING→`IGNORED(EXPIRED)`、IGNORED/FIXED 保留状态与复核结果只清原图引用）**；**测试数据 30 天未使用清空（账号保留）**；注销=立即匿名化 + 删截图/头像/partnerNote + **识别失败记录清 `uploaderOpenid`、原图按引用计数删、`ocrTextMasked` 到期删** + 30 天内物理删（复核审计日志按审计策略保留，CONTRACT §11.4）。
### 4.8 开发者切换会话（云侧，v0.9；READONLY / TEST_WRITE）
**一句话**：小程序**不能切换微信登录账号**；后台「切换账号」用**服务端票据 + 目标身份解析**实现两种会话——真实账号 `READONLY`（只读、审计）与测试账号 `TEST_WRITE`（可写、隔离、标记）。两模式共用 `admin_view_sessions` 与同一中间件；审计名 `ACCOUNT_SWITCH_*`（`VIEW_AS_*` 已作废）。

**4.8.1 开启与票据**
1. `admin.viewAsStart({role,targetNo,mode})` → adminGuard 校验白名单 → `targetNo` 用 `shared/ids.js` 归一化 + 角色前缀校验（CUSTOMER 需 `C` 前缀、PARTNER 需 `P` 前缀，否则 `VALIDATION_FAILED`）→ 目标查询：READONLY = ACTIVE 顾客/ACTIVE 兼职；TEST_WRITE = `users.isTestAccount=true` 且 `status=ACTIVE` 的测试账号；查不到统一 `NOT_FOUND`（文案"该用户当前不可查看"，防枚举）。
2. **真实账号只允许 `mode=READONLY`**；对真实目标传 `TEST_WRITE` → `FORBIDDEN`（服务端判定，前端隐藏不算）。`mode=TEST_WRITE` 的目标必须 `isTestAccount=true`，否则 `FORBIDDEN`。
3. `crypto` 生成 **32 位不可猜 `viewTicket`**，`admin_view_sessions` 落 `_id=ticket`（`adminOpenid/developerNo/viewMode/role/targetId/targetNo/targetDisplayName/targetAvatarFileId?/targetIsTest/createdAt/expiresAt/endedAt`），TTL = `config.viewTicketTtlMinutes`（默认 30，范围 5~60）；**同一开发者只保留一张有效票据**（新开时旧票 `endedAt=now` 并记 `ACCOUNT_SWITCH_END`）；返回票据 + `expiresAt` + 目标摘要（含 `viewMode/targetIsTest`）。
4. 审计 `ACCOUNT_SWITCH_START`（detail `{viewMode,role,targetNo,targetIsTest,developerNo}`）；开启限流 20 次/日/开发者（`counters.rl:accountSwitch:{adminOpenid}:{day}`）。
5. 客户端只存内存（§5.5），不写本地存储、不做 URL 参数；冷启动即失效。
6. **客户端进入/退出会话必须按身份水合（批 10）**：`admin.viewAsStart` 只签发票据，不代表页面数据已就绪；客户端统一经 `utils/session.js` —— 进入：先写内存 `viewContext` → `user.bootstrap`（请求带票据、服务端按目标身份返 DTO）→ `hydrateFromBootstrap` → `reLaunch`；退出：`viewAsEnd` → 清 `viewContext` → 再 `user.bootstrap` 复位开发者身份 → 回「账号切换」。服务端 `viewContext` 永不回 `viewTicket`，`hydrateFromBootstrap` 必须**保留本地票据**；否则测试顾客显示「资料未完善」、测试兼职显示「待激活」，切换后页面对目标身份不可用。

**4.8.2 每请求校验与身份传播（中间件 §4.3 #3）**
- 校验：票据存在、未过期、`endedAt` 空、发起人仍白名单且 `adminOpenid` 匹配；目标 `status=ACTIVE` 且（TEST_WRITE）`isTestAccount=true`；**交叉校验 `targetId/targetIsTest/impersonatedBy` 与票据一致**（票据不可挪用到其他账号或模式）。
- `READONLY`：一切写动作 `FORBIDDEN`（"开发者只读视角不能操作"）；读动作仅 §4.3 白名单；`ai.parseParcel` 拒；不影响开发者后台自己的写动作（邀请码/停用/配置/开启结束会话）。
- `TEST_WRITE`：写动作按 §4.2 白名单放行、**仅以测试账号身份执行**；`admin.*`/`partner.activate`/`user.deleteAccount`/`ai.parseParcel` 一律 `FORBIDDEN`；读写都只作用于测试数据。
- **身份传播**：`ctx.identity={actorOpenid(开发者真实 openid), effectiveOpenid(测试账号合成 openid), role, isTest, impersonatedBy}`；业务身份/限流键/`upload_tickets.openid`/`order_messages.fromId`/`order_events.actorId` 全用 `effectiveOpenid`；`admin_audit.adminOpenid` 用 `actorOpenid`；`orders.isTest` 服务端派生、`orders/order_events.impersonatedBy=developerNo`；**handler 只读 `ctx.identity`**。
- 票据过期 → `VIEW_TICKET_EXPIRED`；目标被删除/停用 → `NOT_FOUND`（客户端清 `viewContext` 回后台）。

**4.8.3 结束、清理与安全边界**
- `admin.viewAsEnd({viewTicket})` → `endedAt=now` + `ACCOUNT_SWITCH_END`，幂等；非本人票据 `FORBIDDEN`（不泄露存在性）。
- `cleanup.viewSessions`：过期未结束 → 补 `endedAt` + 一条 `ACCOUNT_SWITCH_EXPIRED`（每票至多一条）；结束超 7 天物理删会话。
- **删除测试账号时先结束会话**：该 `targetId` 的全部会话置 `endedAt` 并记 `ACCOUNT_SWITCH_END`，再删数据（§4.11）；客户端下次请求收 `NOT_FOUND` 后清 `viewContext` 退出。
- 限制：不能查看开发者自己/其他开发者；目标只能是 ACTIVE；票据不能当后台凭据（调 `admin.*` → `FORBIDDEN`）；已被删除的目标不可再开启（统一 `NOT_FOUND`）。
- 视觉（客户端 §5.5 + 门禁 #31）：READONLY 黄条（`#FFF4CE`）、TEST_WRITE 蓝条（`#E8F0FF`）+ 右上角 `TEST` 角标；两种会话都隐藏分享/转发/长按保存入口。
### 4.9 开发者后台与脱敏（工程口径；v0.9 增测试账号管理）
- **handler 拆分**：`handlers/admin/{invites,customers,partners,orders,config,audit,accountSwitch,testAccounts,bootstrap,stats,recognition}.js`；统一 `adminGuard`（白名单 + `developerNo` 注入 + 审计包装），不允许任何 admin handler 绕过。
- **invites**：`createInvites`（批量 ≤50、有效期枚举 24h/72h/7d/30d 默认 7d、`note≤50`、整批可复制、code 冲突重生成 ≤5）、`revokeInvite`（**仅 `UNUSED`**，其余 `INVALID_STATE`）、`listInvites`（状态/批次/有效期/使用人=兼职编号+昵称/使用时间；**测试账号不消耗邀请码、不出现为使用人**）；审计 `INVITE_CREATE`/`INVITE_REVOKE`。
- **users/orders 后台**：列表/详情全部经 `dto/mask.js` 输出（**接口层不存在 full 变体**）；搜索按顾客编号/宿舍/昵称（昵称可匹配但不回显完整值）；不返回 openid；**后台 DTO 不含 `avatarFileId`、昵称脱敏（首字 + `*`）**；**`listCustomers/listPartners/listOrders` 默认排除测试账号与 `isTest` 数据**（显式 `includeTest:true` 才含，审计 detail 记 `includeTest`）；不提供导出/批量复制敏感数据。
- **测试账号管理（v0.9，四动作）**：
  - `listTestAccounts`：按角色/最近使用列出（编号、昵称、角色、`createdByDeveloperNo`、`testLastUsedAt`），**只在本页展示，不混入真实列表**。
  - `createTestAccount({role,displayName})`：昵称过同一昵称闸（≤20 字 + `msgSecCheck`）；每位开发者每角色 ≤`config.testAccountMaxPerRole`（默认 3）、合计 ≤6；生成合成 `openid='TEST-<random>'`、编号、默认资料；不消耗邀请码、不走激活；审计 `TEST_ACCOUNT_CREATE`。
  - `deleteTestAccount({testAccountId,confirm:true})`：**双条件**（页面二次确认 + 请求 `confirm:true`）；可先 `dryRun:true` 返回将删条数；**真实数据引用即拒绝**（任何 `isTest=false` 的订单/绑定/留言引用该账号 → `INVALID_STATE`）；先结束其会话再级联删账号+资料+头像+订单/事件/留言/绑定/上传票据；审计 `TEST_ACCOUNT_DELETE`（detail 含 **前后条数** 与 `dryRun`）。
  - `purgeTestData({confirm:true,dryRun?})`：只清全部测试业务数据、保留测试账号；同样双条件 + 前后条数 + 审计 `TEST_DATA_PURGE`；**不影响任何真实数据**。
- **治理动作边界**：`setPartnerStatus` 只改真实兼职 `SUSPENDED`/`ACTIVE`（停用返回受影响未完成订单数，不自动改单）；异常介入取消走 `order.cancel`（`cancelledBy='ADMIN'` + 原因必填 + 审计 `ORDER_ANOMALY_CANCEL`）；**不代确认送达、不创建订单、不修改订单归属**；`updateConfig` 全量审计 `CONFIG_UPDATE`（白名单不含 `aiFallback`）。
- **审计动作**：`INVITE_CREATE / INVITE_REVOKE / PARTNER_SUSPEND / PARTNER_RESTORE / CONFIG_UPDATE / ORDER_ANOMALY_CANCEL / ACCOUNT_SWITCH_START / ACCOUNT_SWITCH_END / ACCOUNT_SWITCH_EXPIRED / BOOTSTRAP / FAILURE_IMAGE_VIEW / FAILURE_FIX / FAILURE_IGNORE`（v0.8 后三项）/ **`TEST_ACCOUNT_CREATE / TEST_ACCOUNT_DELETE / TEST_DATA_PURGE`（v0.9）** / `CLEANUP`；**`VIEW_AS_*` 已作废（check-docs 双向枚举校验，零残留）**；字段 `adminOpenid/developerNo/action/target/detail/at`；审计区块并入 overview（MVP 不单独建页）。
### 4.10 AI 识别兜底与失败复核（云侧，v0.8；v1.0 粒度修订）

> **v1.0/D23/D24 粒度修订**：识别失败记录粒度 = **包裹 × 截图**（订单 `parcels[itemIndex].failureId` 逐件关联；同图多件共享 `fileId`、`failureId` 按件独立）；`NO_TEXT` 不外呼 AI 但**必须入队**并给端侧手填引导（修旧实现 NO_TEXT 静默丢弃缺口）；**无截图手填单（`manualEntry=true`）不进入识别链路**（不调 AI、不入队）；订单创建时把失败记录回填到对应包裹（`orderId/failureId`）。
**一句话**：端侧识别不出站点/取件码时，客户端调 `ai.parseParcel`；云函数外呼 DeepSeek 只发去敏文本、返回统一 DTO 做预填；仍失败/低置信 ⇒ 写 `recognition_failures`，开发者在复核页看原图并补录/忽略，全程审计。

**三条硬判据（门禁落地）**：①**外发白名单**——外呼 payload 键集合 = `AI_PAYLOAD_KEYS`（§4.10.3）；②**失败必入队**——任何降级/异常路径都写 `recognition_failures`，禁止静默丢弃（§4.10.5）；③**原图访问必审计**——每次查看原图落 `FAILURE_IMAGE_VIEW`（§4.10.6）。

**4.10.1 数据流（唯一路径）**
1. 客户端 `utils/recognize/` 端侧 OCR + 规则解析（v3 阶梯保留）；站点或取件码缺失/不可信（`NEED_CODE`、`stationId=''`、结果与 OCR 文本冲突）时进入兜底。
2. 客户端 `api/modules/ai.js` 调 `ai.parseParcel`（**唯一外呼出口；客户端不直连任何第三方**），入参先过长/去敏闸：`ocrTextMasked ≤2000`、`hintTrackingTail?`、`uploadTicketId`、`role`；**写动作幂等键 `clientRequestId` 必传**（落 `recognition_failures.requestKey`）。**同图多单时按单调用**（DATA_MODEL §4.9）：每张缺码/缺站点的订单各调一次（同一 `uploadTicketId`、各自独立 `clientRequestId` 与 `failureId`），非缺字段件不外呼（规则优先）。
3. 云函数 `handlers/ai/parseParcel.js`：auth → 二次去敏（手机号/身份证/连续长数字掩码；姓名行保留但不带详细门牌）→ 配额/开关/熔断判定 → `lib/ai/deepseek.js` 外呼 → `lib/ai/parse.js` 校验并裁剪 DTO。
4. 成功且 `recognized=true`：返回 DTO 供本页**预填建议**；客户端合并策略 = 用户已手填字段优先（AI 不覆盖），用户可改可弃。
5. 仍失败/低置信/LLM 异常：写 `recognition_failures`（含 `uploadTicketId`；`fileId` 入队时可为 `''`，建单后由下单动作回填；**未建单时 `orderId=''` 也保留记录**）→ 返回 `recognized=false` + `failureId`；客户端静默降级为手填，不阻断下单（`NEED_CODE` 机制不变）。
6. 订单创建时可携可选 `recognition:{source:'RULE'|'DEEPSEEK'|'MANUAL', failureId?}`（**逐单顶层一份**；v1.0 一单多包裹时，逐件失败关联写在 `parcels[i].failureId`（见 DATA_MODEL §4.9），顶层 `recognition.failureId` 只对应首件/整单）：服务端校验 `failureId` 的 `uploaderOpenid` 与本人一致（形态/归属非法静默丢弃、不阻断建单，只做快照/关联，不参与鉴权），写 `orders.parcels[i].recognitionSource/confidence?`、本单 `orders.images[j].failureId?`；建单成功后回填该记录的 `orderId`/`fileId`（每单只回填**本单自己**那条记录）。**同图多单的记录粒度由调用粒度保证**：客户端对每张缺码/缺站点订单各调一次 `ai.parseParcel`（同一 `uploadTicketId`、各自独立 `clientRequestId`/`failureId`，见 DATA_MODEL §4.9）；**服务端不在建单时补建失败记录**（写入唯一入口仍是 `ai.parseParcel`）。
7. 开发者后台复核：红点 + 首屏 `PENDING` 列表 → 原图（临时 URL 5 分钟、逐次审计）→ 补录/忽略/通知上传者。
8. `cleanup.recognitionFailures` 到期清理；订单截图 7 天规则不受影响（§4.1/§4.7）。

**4.10.2 外呼适配层与凭据（`lib/ai/`）**
- `deepseek.js`：`https://api.deepseek.com/chat/completions`；`model=config.aiFallback.model`（默认 `deepseek-chat`）；`temperature=0`；`response_format={type:'json_object'}`；**`fetch` 由参数注入**（单测替身，零真实外呼）；`DEEPSEEK_API_KEY` 只从 `process.env` 读。
- 超时 `config.aiFallback.timeoutMs`（默认 8000）；**仅网络错误/5xx 重试 1 次**，4xx/解析失败不重试；连续 5 次失败 → 熔断 `config.aiFallback.cooldownMinutes`（默认 10 分钟）内不再外呼。
- 开关：`config.aiFallback.enabled=false` ⇒ 不外呼、直接降级；`DEEPSEEK_API_KEY` 缺失/空 ⇒ 同上（应用可正常启动）。**MVP `aiFallback` 后台只读展示、不开放编辑**（`admin.updateConfig` 白名单不含该键；P1 再开）；改值走部署配置脚本/控制台，且必须与隐私文本同步（CONTRACT §4.3）。
- 日志只记 `aiErrorCode/耗时/成功与否/模型`；**不落响应全文、不落 Key、不落 `ocrTextMasked` 原文**。

**4.10.3 只发去敏文本（外发白名单，CONTRACT §11.3）**
- 外发 payload 键集合**恰好等于** `AI_PAYLOAD_KEYS = ['ocrTextMasked','hintTrackingTail','role']`（`lib/ai/payload.js` 单源，`buildAiPayload()` 是唯一构造器）；多键/少键/手拼 body 均判红（门禁 #25 + 单测 §7.3 #21）。
- **不发**：原图/`fileId`/openid/订单归属/编号/宿舍全值/联系方式；`lib/ai/**` 源码不得出现 `fileId`/`openid`/`orderId` 字面量。
- 二次去敏在云函数内做（客户端去敏只是第一道，**服务端不信任客户端**）；去敏后的文本随失败记录存 `ocrTextMasked`（≤2000）。

**4.10.4 返回 DTO 与合并策略（客户端只认这一份，CONTRACT §4.3）**
| 字段 | 服务端校验 |
| :-- | :-- |
| `recognized` | 布尔；`false` 必带 `failureId` |
| `stationId/stationName` | `stationId` 必须 ∈ P1~P8 否则置 `''`；名称由服务端按站点表回填（不信任模型输出） |
| `pickupCode` | 去空格/连字符后必须过码格式闸（4~12 位字母数字）否则置 `''` |
| `trackingTail/lockerNo` | 可空；形态闸沿用 v3 规则 |
| `confidence` | `HIGH/MEDIUM/LOW`；`LOW` ⇒ `needsReview=true` |
| `source` | `RULE/DEEPSEEK/NONE`（`NONE` = 兜底未产出可用字段） |
| `needsReview/failureId` | `recognized=false` 或 `LOW` ⇒ `needsReview=true` 并入队 |

- 字段白名单返回，额外键一律剥离；**AI 结果只做预填建议**，用户手填优先、不得覆盖；仍允许以 `NEED_CODE` 提交订单。

**4.10.5 失败入队（禁止静默丢弃）**
- `failureCode` 5 枚举：`NO_TEXT`（OCR 无文本）/`PARSE_MISS`（有文本但规则+AI 均缺站点或码）/`LOW_CONFIDENCE`/`LLM_ERROR`（AI 不可用/超限/熔断/解析失败）/`IMAGE_UNREADABLE`（图片打不开/压缩失败）。
- 写入字段：`failureNo(唯一)/requestKey(唯一：{uploaderOpenid}:{clientRequestId})/failureCode/sourceRole/uploaderOpenid/uploadTicketId/fileId/orderId?(未建单为 '')/ocrTextMasked/ruleResult/aiTried/aiModel/aiResult/aiErrorCode/status='PENDING'/createdAt`。
- **写入幂等**：`requestKey` 唯一；同键重放返回已有 `failureId`（客户端重试/连点必须复用同一 `clientRequestId`，不重复入队）；不同 `clientRequestId` 各自成记录（**同图多单逐单调用即不同 `clientRequestId`**，服务端不按文本相似度合并、也不在 `order.create` 时补建记录）。
- 降级矩阵（`aiErrorCode` 值域以 `DATA_MODEL §2.14` 为唯一单源）：开关关闭 → `LLM_ERROR`（`aiTried=false`，`aiErrorCode='DISABLED'`）；Key 缺失 → `LLM_ERROR`（`DISABLED`）；超时 → `LLM_ERROR`（`TIMEOUT`）；网络/5xx → `LLM_ERROR`（`HTTP_5XX`）；熔断 → `LLM_ERROR`（`CIRCUIT_OPEN`）；配额超限 → `LLM_ERROR`（`QUOTA_EXCEEDED`，**不外呼**）；解析失败 → `LLM_ERROR`（`PARSE_ERROR`）/`PARSE_MISS`。全部返回 `ok:true + recognized:false`，对用户静默。

**4.10.6 复核队列与后台动作（开发者）**
- `admin.listRecognitionFailures`：按 `status/failureCode/时间` 筛选分页（`limit ≤100`）；`admin.getRecognitionFailure`：返回**原图临时 URL（5 分钟）+ 审计 `FAILURE_IMAGE_VIEW`（每次查看一条）**、脱敏上传人、`ocrTextMasked`、AI 尝试结果、关联订单。
- `admin.fixRecognitionFailure`（`{stationId?,stationName?,pickupCode?,note?,notifyUploader?}`）：补录 → 只回填关联订单 `parcel` 的识别字段（**不改订单状态、不代确认、不建单、不改归属**），审计 `FAILURE_FIX`；无关联订单时只改队列记录。
- `admin.ignoreRecognitionFailure`（`{note,notifyUploader?}`）：备注**必填**（空 → `VALIDATION_FAILED`），审计 `FAILURE_IGNORE`；记录置 `IGNORED`。
- 通知上传者：**不单拆动作**，作为上述两动作的可选参数 `notifyUploader:true`（站内消息必做；P1 订阅消息模板 ID 进 `config`）。
- 原图可见性：仅白名单开发者在复核页、临时 URL、单次审计；不进顾客/兼职页面；**不提供批量/下载/导出**。

**4.10.7 与切换会话/隐私的边界**
- 复核页路径 `pkg-admin/pages/recognition-review/index`（开发者后台，无 tabBar）；**切换会话（READONLY/TEST_WRITE）不开放任何 AI/复核动作**，且 `ai.parseParcel` 在切换会话下一律 `FORBIDDEN`，故不产生测试复核记录。
- 原图"例外可见"仅限复核页（CONTRACT §1.1 例外条款）；非失败单原图仍只能走只读视角 + `order.imageUrl`。
- 隐私披露：`docs/privacy/` 必须写明"识别失败时把去敏 OCR 文本发给 DeepSeek；原图不出本程序云存储；失败原图进入开发者复核（临时查看+审计+30 天删除）"（CONTRACT §11.2）。
- **注销/停用口径（CONTRACT §11.4）**：上传者注销 → 清 `uploaderOpenid`（匿名化）、原图按引用计数删、`ocrTextMasked` 保留至到期（默认 30 天）后物理删；兼职 `CLOSED` 同口径；复核审计日志按审计策略保留（≥180 天）。

### 4.11 测试账号（合成身份）与测试数据隔离（v0.9）
**一句话**：测试账号是开发者后台创建的**合成账号**（无真实微信资料），用于一个微信号单机验收顾客/兼职两端真实操作；与真实账号严格隔离、永不计入经营数据、可一键清理。

**4.11.1 身份与数据形态**
- **身份键**：`openid='TEST-<random>'`（**非空、不可猜**）；`users._id`、测试顾客的 `customers._id`、测试兼职的 `partners.openid` 三者同值；`users.isTestAccount=true`、`createdByDeveloperNo`、`testLastUsedAt`；`roles` 与真实账号同构（CUSTOMER/PARTNER）。
- **编号**：`customerNo/partnerNo` 用同一生成器与唯一索引（样式一致），但**不进入真实用户可见范围**（`partner.getPublic` 对测试账号 `NOT_FOUND`、真实列表默认排除）。
- **默认资料**：测试顾客资料完整（可改宿舍演示 roomTag 重分配）；测试兼职 `serviceConfig` 全开、范围=全部苑、`acceptingOrders=true`；**头像=默认头像**（无微信头像可采，不创建 avatar 文件）。
- **允许互动**：测试顾客 × 测试兼职可完整走绑定→下单→接单→取件→送达→确认（单机双端验收）；**真实×测试**任何绑定/下单/留言/查询一律 `FORBIDDEN`（文案"测试账号与真实账号不能互相绑定"）；测试账号不能被真实顾客凭编号绑定。

**4.11.2 写入与统计口径**
- `orders.isTest` 由服务端按参与账号 `isTestAccount` **派生**（客户端不可传）；`orders/order_events.impersonatedBy=developerNo`；`order_events.actorId`、`order_messages.fromId` 用 `effectiveOpenid`。
- `admin.stats`、`partners.stats`、后台红点、邀请码使用/统计、消息中心计数**全部排除**测试账号与 `isTest` 订单（服务端查询条件强制，不靠前端过滤）。
- 搜索/列表：真实用户端零出现；后台 `listTestAccounts` 单独列；`listCustomers/listPartners/listOrders` 默认排除（显式切换才含）。

**4.11.3 创建、删除、清理（后台四动作）**
- 创建：`createTestAccount({role,displayName})`；昵称同闸（≤20 字 + `msgSecCheck`）；每角色 ≤`config.testAccountMaxPerRole`（默认 3）、每开发者合计 ≤6；不消耗邀请码、不走激活、不进真实列表；审计 `TEST_ACCOUNT_CREATE`。
- 删除：`deleteTestAccount({testAccountId,confirm:true})`——**双条件**（页面二次确认 + 请求 `confirm:true`）+ **dryRun 先看计数** + **真实引用即拒绝**（`isTest=false` 数据引用该账号 → `INVALID_STATE`）；级联：`users`/`customers`/`partners`/`bindings`/`orders`/`order_events`/`order_messages`/`upload_tickets`/头像文件/会话（先 `endedAt`）；审计 `TEST_ACCOUNT_DELETE` 带前后条数；失败以 `testAccountId` 为键重试幂等。
- 清数据：`purgeTestData({confirm:true,dryRun?})` 只清测试业务数据、保留账号，审计 `TEST_DATA_PURGE`；`cleanup.testData` 每日清超 `testDataRetentionDays`（默认 30）未使用的测试数据（账号保留），记 `CLEANUP` 审计。
- 测试账号不进入隐私主体清单、不参与邀请码、不共享真实限流配额（按 `effectiveOpenid` 独立计）；**TEST_WRITE 禁调动作**见 §4.2。全程零金额语义。

### 4.12 头像/昵称与 roomTag 工程（v0.9）
**一句话**：头像只走一条受限上传链路、昵称只走一条校验链路、roomTag 只有云端一个分配器——CONTRACT / 本文 / `utils/*` / 云端 `shared/*` 四处口径必须逐字一致。

**4.12.1 头像上传（复用 upload ticket，不建第二套链路）**
- `upload.prepare({purpose:'AVATAR'})`：校验登录 + 业务角色；路径 `avatars/{role}/{random}.jpg`（**不含 openid、不含 orderId**；`role` 取当前业务角色，TEST_WRITE 用 `effectiveOpenid` 但路径仍只含 role）；ticket 5 分钟，落 `upload_tickets{purpose,openid,cloudPath,expiresAt}`，`openid` 取 `effectiveOpenid`。
- 客户端压缩到 ≤`config.avatarMaxBytes`（默认 200KB）、jpg/png、建议 200×200；上传唯一出口 `api/upload.js`（`wx.cloud.uploadFile` 只允许在此）。
- 保存：`customer.saveProfile`/`partner.saveProfile` 收到 `avatarFileId` 时校验 **ticket 归属（`effectiveOpenid`）+ 路径一致 + 大小/类型/图片可解码**；**任一失败不写 `avatarFileId`（回滚保留旧头像）**，成功后才写库。
- 替换：成功写入后删旧文件（best-effort，失败交 `cleanup.files` 兜底）；**并发替换以最后一次成功写为准**（事务内读改写 + `profileUpdatedAt`）。
- 删除：注销（`cleanup.accountDeletion`）、删除测试账号、头像被替换三处删文件；默认头像不占存储（客户端本地绘制首字色块）。
- 可见性：仅本人与当前 ACTIVE 绑定对方经 DTO 下发；后台 DTO/日志/通知/分享卡片零 `avatarFileId`；fileID 不落本地存储，展示用 5 分钟临时 URL 且不缓存。

**4.12.2 昵称**
- `displayName`：trim 后 **≤20 字截断**（超长截断不报错）；必填；首次从微信昵称一键填入、可改/手填；保存前过 `security.msgSecCheck` v2，命中违规 → `VALIDATION_FAILED`（`data.field=displayName`）且**不落库**。
- 展示：头像+昵称+编号成对展示；后台昵称脱敏；分享卡片/通知不含完整昵称；解绑/停用/注销后不再返回。

**4.12.3 roomTag（恒大写）**
- 纯件 `utils/room-tag.js`（`shared/room-tag.js` 同步副本）：`toTag(seq)`（1→A、26→Z、27→AA、52→AZ、53→BA…）、`tagRank(tag)`（Excel 列名序）、`formatDormTag(dormKey,tag)`（`D4-522A`）、`isValidTag`（`^[A-Z]+$`）。
- 生成：`lib/tag-allocator.js` 在绑定事务内取 `counters.tag:{partnerId}:{dormKey}` 自增 → `toTag(seq)` 写 `bindings.roomTag`；换宿舍=新 dormKey 重新分配；旧 tag 保留在历史绑定**不复用**。
- 排序：客户列表按 `dormKey` 升序 + `tagRank(roomTag)` 升序（**不能按字符串排序**，否则 `AA < Z`）；服务端排序、客户端不重排。
- 门禁：落库/展示前断言 `^[A-Z]+$`；任何小写后缀视为缺陷（#29 含 roomTag 校验）。
---
## 5. 客户端架构
### 5.1 app.js 与启动分流
- `app.js`：`wx.cloud.init`（env 来自 `config/env.js`）→ `user.bootstrap` → `store` 水合 → `config/route.js` 纯函数决定 `reLaunch` 目标（launch 只分流）。
- `globalData` 只放启动时间/环境版本等非业务值；角色/资料/绑定/红点/`viewContext` 全部在 `store`（内存快照 + 订阅），**不放 L3 明文（尾号/取件码/openid）**。
- 分流决策（纯函数，可测）：
  1. **内存有 `viewContext`** → `reLaunch` 目标角色首页（顾客 `pages/customer/home/index`；兼职 `pages/partner/workbench/index`），按 `viewMode` 常驻黄条（READONLY）或蓝条 + `TEST` 角标（TEST_WRITE）；
  2. `bootstrap.isDeveloper=true` → `reLaunch /pkg-admin/pages/overview/index`（**不看 `?admin=1`，白名单是唯一门槛**；开发者页面无 tabBar）；
  3. 无 users → `pages/role`；有角色无资料 → `pages/profile` 资料表单；资料完整未绑定 → 顾客首页引导；兼职 ACTIVE → 工作台；SUSPENDED/CLOSED → 停用提示。
- 每个角色 tab 页 `onShow` 再执行守卫（前端二道闸，不是安全边界）：无 `viewContext` 时角色不匹配 → `reLaunch` 回本角色首页；有 `viewContext` 时允许目标角色页面渲染，且不得把 `activeRole` 写回本地存储。
- **冷启动 / 杀进程即丢票据**（`viewContext` 不落盘，CONTRACT §1.2）；`user.bootstrap` 在未携票据时返回 `viewContext=null`，不作为恢复机制（想继续看就重新开启）。
- **页面版本号运行时取**（§头部约定），不写死。
### 5.2 自定义 tabBar 与页面守卫（v0.7）
- 平台事实：`tabBar.list` 只允许 2~5 项；自定义组件必须在**项目根目录 `custom-tab-bar/`**。
- 定稿：`app.json` 的 `tabBar.custom=true`，`list` **恰好 5 项**：`pages/customer/home/index`、`pages/customer/orders/index`、`pages/partner/workbench/index`、`pages/partner/customers/index`、`pages/profile/index`（双方共用）。
- `custom-tab-bar` 组件按 store 渲染：无 `viewContext` 时按 `activeRole` 渲染顾客三格（首页/订单/我的）或兼职三格（工作台/客户/我的）；**有 `viewContext` 时按 `viewContext.role` 渲染目标角色三格（两模式同）**；工作台格显示待处理红点/数字。
- **开发者无 tabBar**：全部页面在 `pkg-admin` 分包内，用页面内导航/返回栈；从切换会话退出也 `reLaunch` 回 account-switch。
- 导航：同角色内切格用 `wx.switchTab`；跨角色/角色不匹配守卫用 `wx.reLaunch` 回本角色首页；进入/退出切换会话一律 `wx.reLaunch`（避免 tabBar 顶替与栈残留）；`pages/launch`、`pages/role` 不在 tabBar。
- **列表与排序**：顾客进行中/已完成分列表按 `statusUpdatedAt desc`、`completedAt/cancelledAt desc` 由服务端返回；兼职工作台由服务端返回按"状态桶+站点"过滤的 list+counts（不保证档内顺序），**四档动线排序在客户端零件层由 `shared/order-view.sortByPickupRoute` 执行**（CONTRACT §5.2 为准；排序规则单源，页面不另写）。
- **文本上限**：`orders.note` ≤200、`deliveryNote` ≤100、`partnerNote` ≤100、`msg.text` ≤200、`exception.text` ≤200、`lockerNo` ≤10（字符串）；超限服务端返回 `VALIDATION_FAILED`（`data.field`），前端只提示不二次截断。
- **取消原因枚举**：顾客 `CHANGED_MIND/WRONG_INFO/DUPLICATE/PARTNER_UNREACHABLE/OTHER`；兼职 `TOO_BUSY/OUT_OF_RANGE/SERVICE_OFF/OTHER`；系统 `TIMEOUT_UNACCEPTED`；`OTHER` 必填备注；中文文案服务端下发。
- **结果页**：下单结果内嵌 `pkg-customer/pages/order-create/index` 第 4 步（不新增 result 子页）；一图多码在同一结果块列出 N 张订单号与入口。
- **接单开关**：下单入口按 `partner.getPublic({partnerNo}).acceptingOrders` 置灰、提交被拒展示 `PARTNER_CLOSED` 并刷新公开预览。
### 5.3 唯一编号零件 `utils/ids.js`（v0.7）
**规格（与 CONTRACT §3.1 逐字一致）**
| 角色 | 字段 | 组成 | 展示样式 | 示例 | canonical 正则 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| 顾客 | `customerNo` | `C` + 8 位 | `C-XXXX-XXXX`（4+4） | `C-7K2M-9QX4` | `^C[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$` |
| 兼职 | `partnerNo` | `P` + 6 位 | `P-XXX-XXX`（3+3） | `P-7K2-M9X` | `^P[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$` |
| 开发者 | `developerNo` | 白名单映射 | `DEV-01` | `DEV-01` | `^DEV-\d{2}$`（由 `ADMIN_OPENIDS` 给出，不参与用户输入） |

- **归一化顺序**：`trim` → 全角→半角（数字/字母/连字符）→ 去所有空白与连字符/分隔符 → 大写；**前缀必填**（漏 `C`/`P` 即格式错）；长度必须精确（C=9 字符 canonical、P=7 字符 canonical）；字母表外字符（含 `0/1/I/O`）→ 格式错误。
- **导出 API（纯函数，零 `wx`）**：`normalizeInput(raw)`、`parseNo(raw)` → `{ok, kind:'CUSTOMER'|'PARTNER'|'DEVELOPER'|'UNKNOWN', canonical, display, reason?}`；`displayNo(kind,canonical)`（幂等：`displayNo(parseNo(display))===display`）；`isCustomerNo/isPartnerNo/isDeveloperNo`；`prefixHint(raw)`。
- **错误原因与文案单源**：`reason ∈ {FORMAT, CUSTOMER_PREFIX, DEVELOPER_PREFIX}`；文案在 `shared/error-copy.js`：顾客前缀 →"这是顾客编号，请向兼职索取 P 开头的兼职编号"；开发者前缀 →"这是开发者编号，不能用于绑定"；其他 →"兼职编号是 P 开头、共 6 位字母数字，请核对"。页面本地显示同源文案，服务端 `VALIDATION_FAILED.message` 下发同一句（不暴露存在性）。
- **生成在云端**（§4.5）：客户端**没有任何生成函数**；`utils/ids.js` 若出现 `random` 调用即判红（check.js #22 之外由 selftest 断言）。
- **展示规则**：顾客"我的"显示 `customerNo`（可复制）；兼职"我的"显示 `partnerNo`（可复制/分享绑定卡片，卡片只带编号，不带宿舍/尾号/称呼/头像/昵称）；订单详情小字显示对方编号；后台列表/详情显示编号但**不显示 openid**；编号独立行、等宽感，不缩写、不嵌进文案句。
- **selftest 用例（`selftest-core.js`，先合法基线、再逐闸反例、样本非空）**：①合法 C/P 归一与展示往返；②长度差 1（8/6 位边界）；③错前缀（`C…` 传入绑定 → `CUSTOMER_PREFIX`；`DEV-01` → `DEVELOPER_PREFIX`）；④小写 → canonical 大写；⑤全角（`Ｃ－７Ｋ２Ｍ－９ＱＸ４`）→ 归一；⑥空格/多连字符/首尾分隔符；⑦空串/纯分隔符/纯字母表外字符（`0O1I`）；⑧开发者编号 `DEV-01/DEV-02` 合法、`DEV-1` 非法；⑨`display → parse → display` 等值；⑩生成器侧（云单测）：同前缀长度正确、随机不重复样本、强制唯一索引冲突时重试路径。
### 5.3b roomTag 零件 `utils/room-tag.js`（v0.9）
- **纯件（零 `wx`）**：`toTag(seq)`、`tagRank(tag)`、`formatDormTag(dormKey,tag)`、`isValidTag(tag)`、`compareByDormTag(a,b)`；`shared/room-tag.js` 为同步副本（hash 门禁 #17），云端只 require 副本。
- **规则**：序号从 1 起 → `A`…`Z`（1~26）、`AA`…`AZ`（27~52）、`BA`…；只允许大写字母；展示 `D4-522A`（dormKey + tag）。
- **排序**：`tagRank` 按 Excel 列名序（A=1…Z=26、AA=27），`compareByDormTag` 先 dormKey 再 rank；**禁止字符串排序**（`AA` 会排到 `Z` 前）。
- **selftest（`selftest-core.js` 新节点）**：①1→A、26→Z、27→AA、52→AZ、53→BA；②`tagRank(toTag(n))===n`；③小写/空/非法字符 → `isValidTag=false`；④排序样本 `['AA','Z','A','AB']` → `['A','Z','AA','AB']`；⑤`formatDormTag('D4-522','A')='D4-522A'`；⑥云端分配只经 `tag-allocator`（`selftest-cloud` 断言）。
- **门禁**：`utils/room-tag.js` 出现 `random` 或大小写转换即判红；生产代码零字符串拼 roomTag。
### 5.4 API 适配层（`api/`，v0.9 注入切换会话票据）
- `api/client.js`：`wx.cloud.callFunction` 唯一出口。职责：请求组装 `{action,data,clientRequestId,expectedVersion?}`、**有 `viewContext` 时自动注入 `viewTicket`**、校验 flat 包络 `{ok,code?,message?,data?,serverTime,requestId?}`、10s 超时、读动作重试（≤2 次，300/900ms 指数退避）、写动作**不自动重试**（页面用同一 `clientRequestId` 重试）、`serverTime` 校时、13 码→人话、`requestId` 只写 console/反馈定位。
- `api/mode-guard.js`（v0.9，原 readonly-guard）：读白名单与 §4.3 服务端白名单**同源引用**；`viewMode=READONLY` ⇒ 写动作不发请求、直接返回"开发者只读视角不能操作"；`viewMode=TEST_WRITE` ⇒ 仅拦截 §4.2 禁写动作（`admin.*`/`partner.activate`/`user.deleteAccount`/`ai.parseParcel`），其余业务写放行并提示"将写入测试数据"；服务端仍兜底拒绝。
- `api/modules/*.js`：按域封装 action 名（action 字符串只出现在这里）、入参组装、DTO 裁剪；`admin.js` 额外封装 `viewAsStart/viewAsEnd`、测试账号四动作、复核四动作；`ai.js` 仅封装 `ai.parseParcel`（**仅识别失败时调用、不自动重试**；切换会话下不调用）。
- `api/upload.js`：唯一 `wx.cloud.uploadFile` 出口；`upload.prepare({purpose})` → 压缩 → 上传 → 交付 ticket；**TICKET** 长边 1440/≤500KB；**AVATAR** ≤`config.avatarMaxBytes`（默认 200KB）、jpg/png、建议 200×200；失败可重试至 ticket 过期。
- `api/privacy.js`：隐私授权（相册/摄像头/文件选择）+ **头像 `open-type="chooseAvatar"`（可拒绝→默认头像、不阻断）+ 昵称 `input type="nickname"`（可手填）**；隐私文案与微信后台声明同步头像/昵称；拒绝后降级不阻断主流程。
- 门禁：`wx.cloud.callFunction` 只允许在 `api/client.js`；`wx.cloud.uploadFile` 只允许在 `api/upload.js`；**`viewTicket` 字符串只允许出现在 `api/client.js` 与 `store/`**；页面/组件不得出现集合名、action 字符串、编号或 roomTag 生成逻辑；**客户端范围零 `DEEPSEEK_API_KEY`/`api.deepseek.com`**（§8.2 #12/#13/#14/#23/#24/#29）。
### 5.5 开发者切换会话（客户端，v0.9）
- **`viewContext` 形状**：`{viewTicket, viewMode:'READONLY'|'TEST_WRITE', role:'CUSTOMER'|'PARTNER', targetNo, targetDisplayName, targetAvatarFileId?, targetIsTest, expiresAt}`（编号 canonical、展示 display）；**只存内存**（`store`），不写 `wx.*Storage*`、不做 URL 参数传递（避免日志/分享泄漏）。
- **入口**：后台 `pkg-admin/pages/account-switch/index`（真实账号 tab / 测试账号 tab）→ 选角色 → 按完整编号搜索或从列表选人 → 确认摘要（角色/编号/昵称/模式）→ `admin.viewAsStart({role,targetNo,mode})` → 写 `store.viewContext` → `reLaunch` 目标角色首页；测试账号 tab 同时承载新建/查看/删除/清数据（§4.11）。
- **页面表现**：所有业务页（主包 5 tab + `pkg-customer` 5 页 + `pkg-partner` 7 页）顶部必须引用 `components/switch-bar`：READONLY 渲染黄条 `开发者只读视角 · 顾客 C-XXXX-XXXX 小王 · 退出`；TEST_WRITE 渲染蓝条 `测试账号 · 顾客 C-…（测试） · 由 DEV-01 切换 · 退出`，且右上角常驻 `TEST` 角标（`components/test-badge`）；两条都不可关闭、不遮挡状态栏；`custom-tab-bar` 按 `viewContext.role` 渲染目标三格；**两种会话都隐藏分享/转发/长按保存入口**。
- **写限制（双保险）**：READONLY 页面写控件置灰/隐藏并提示"开发者只读视角不能操作"；TEST_WRITE 允许业务写控件并提示"将写入测试数据"（禁项见 §4.2）；`readonly`/`isTestMode` 来自 store，页面不得自行判断 admin 身份；`api/mode-guard` 本地拦截 + 服务端 `FORBIDDEN` 兜底。
- **TTL 与过期**：会话条显示剩余时长（`viewTicketTtlMinutes`）；剩余 ≤5 分钟提示；请求返回 `VIEW_TICKET_EXPIRED`/`NOT_FOUND` ⇒ 清 `viewContext` + toast 后 `reLaunch` 回 `account-switch`。
- **退出**：会话条「退出」→ `admin.viewAsEnd`（失败也本地清）→ 清 `viewContext` → `reLaunch` 回 `account-switch`；开发者后台自己的写动作（邀请码/停用/配置/测试账号管理）不受会话限制。
- **测试视觉纪律**：`TEST` 角标与蓝条**只在 `viewMode=TEST_WRITE` 渲染**；READONLY 只黄条；测试数据零出现在真实页面；分享入口两种会话都隐藏（门禁 #31）。
- **审计感知**：页面不展示审计细节；帮助/隐私页说明"开发者后台默认脱敏；真实账号只读查看，测试账号为后台合成账号，均留审计"。
### 5.6 store 与本地存储
- `store/index.js`：单例内存快照 `{roles,activeRole,me,customer,partner,binding,config,badges,messageReadAt,serverTimeSkew,viewContext}` + `get/set/patch/subscribe`；页面按 key 订阅做行级 `setData` 补丁。
- 本地存储只允许一个键 `ex_college_v4.store`（lastRole、引导已读、草稿指针），由 `utils/storage.js` 单一出口读写；⛔ **不存 `viewContext`/`viewTicket`/`viewMode`/`targetIsTest`**、不读不写 v1/v2/v3 键（D2）；**L3 敏感字段（尾号/取件码/openid）不入本地存储**。
- `config` 缓存 TTL 5 分钟 + onShow 刷新；维护模式只读放行。
### 5.7 组件清单
| 组件 | 职责 | 约束 |
| :-- | :-- | :-- |
| `custom-tab-bar/`（根） | 5 tab 按角色渲染 3 格（切换会话渲染目标角色）+ 红点 | 只读 store；不调 api |
| `switch-bar`（v0.9，取代旧会话条） | 会话条：READONLY 黄条 / TEST_WRITE 蓝条（角色/编号/昵称/剩余时长/退出 + TEST 角标） | 只读 store；无 `viewContext` 渲染空；不得可关闭；两色只在自身 wxss |
| `test-badge`（v0.9） | 右上角 `TEST` 角标 | 仅 `viewMode=TEST_WRITE` 渲染；`TEST` 字面量只允许出现在此组件 |
| `avatar-view`（v0.9） | 头像圆形展示 + 默认头像兜底（首字色块）、加载失败不裂图 | 列表 64rpx/详情 96rpx；fileID 来自 DTO；不缓存 fileID/临时 URL |
| `id-text`（v0.7） | 编号展示（canonical→display 分组、独立行、复制） | 只用 `utils/ids.js`；不自行拼格式 |
| `room-tag-text`（v0.9） | roomTag 大写标签（`D4-522A`） | 只用 `utils/room-tag.js`；不转小写 |
| `failure-image`（v0.8） | 复核页原图预览：每次进入取一次 5 分钟临时 URL，失败可重试 | 只经 `api/modules/admin` 取 URL；禁长按保存/批量/导出；URL 不缓存、不落本地存储 |
| `status-pill` | 七状态 + 异常/取消分支 | 文案/映射来自 shared，不写死句子 |
| `order-row` | 工作台/订单列表行（锚+键、四档标记） | 数据来自 `order-view` 视图模型 |
| `customer-row` | 顾客档行（`D4-522A · 尾号6678 · 小王`）+ 顾客编号 + 头像/昵称 | 锚+键配对；不显示 openid；头像/昵称只来自当前 ACTIVE 绑定 DTO |
| `image-picker` / `code-editor` | 相册/拍照/聊天选择 + 压缩；取件码/柜号/运单尾号行内编辑 | 只调 `api/upload` 与隐私层；校验走 `shared/validate` |
| `section-card`/`empty-state`/`form-field`/`role-switch` | 展示/表单/角色切换 | 无业务判据 |
### 5.8 v3 utils / 零件 → v4 落点（文件级）
| v3 文件 | v4 落点 | 改造点 | 测试承接 |
| :-- | :-- | :-- | :-- |
| `utils/buildings.js`、`utils/stations.js` | `shared/zones.js` + `utils/building-parse.js` + `shared/stations.js` | D/X/N/B/C、buildingNo 1~10、room≥100、dormKey（zoneLabels 走 config）；P1~P8 与别名归一原样、禁止自建站点 | `selftest-core` |
| `utils/parse*.js`（4 件）、`utils/ocr*.js`（3 件） | `utils/recognize/{index,text,codes,station}.js` + `utils/ocr/{index,frame,vision}.js` | 输入=OCR 文本行、输出订单字段 DTO、形态闸单源、无页面依赖；VisionKit 阶梯/帧诊断保留、只留有调用方导出 | `selftest-recognize` + v3 语料；`selftest-core` |
| `utils/customer-input.js`、`utils/reason.js` | `shared/validate.js` + `shared/error-codes.js` + `error-copy.js` | 宿舍身份/尾号/displayName + **`partnerNo`/`invitationCode` 形态**；13 码→人话单源、禁回显 L3 值、编号前缀提示同源 | `selftest-core` |
| `utils/aggregate.js`/`aggregate-customers.js`、`utils/parcel-edit.js` | `shared/order-view.js` + `utils/customer-view.js` + `utils/order-edit.js` | Parcel→Order；站点分组 + 四档排序；锚+键+编号；改码/柜号/运单尾号（校验调 shared） | `selftest-state` |
| `utils/privacy.js` | `api/privacy.js`（+`utils/privacy-policy.js`） | 三类隐私接口/拒绝降级/版本号；**头像 `chooseAvatar`（可拒绝→默认头像）与昵称输入接入**；微信后台声明含头像/昵称（v0.9） | `selftest-core`（纯部分） |
| **（新增）** — | `utils/ids.js` | 编号归一/校验/展示/前缀提示（§5.3） | `selftest-core` |
| **（新增 v0.9）** — | `utils/room-tag.js` | roomTag 大写生成/排序/格式/校验（§5.3b） | `selftest-core` |
| **（新增 v0.9）** — | `utils/avatar.js` + `components/avatar-view` | 头像压缩/大小校验/默认头像策略/圆形展示兜底 | `selftest-profile` |
| `pages/pickup-list/*`、`pages/recognize/parse-patch.js` 等识别零件 | `pkg-partner/pages/workbench/parts/` + `pkg-customer/pages/order-create/parts/` | Order 聚合/批量/撤销/搜索/行级补丁；下单四步视图模型、失败可手填 | `selftest-state` |
| `pages/recognize/create-*`、`pages/customer-detail/parts.js` | `pkg-partner/pages/create-on-behalf/parts/` + `pkg-partner/pages/customer-detail/parts/` | 代客单（guest 快照，不建 customer）；客户视图 + partnerNote + 顾客编号 | `selftest-state` + 云单测 |
| `pages/recognize/{session-key-flow,pick-arrival,resume-flow,round-token,share-flow}.js`、`utils/chat-tool.js`、`chatpick/**` | — | 聊天相关，丢弃 | — |
| `utils/storage*.js`、`migrate.js`、`utils/parcel-drafts.js`、`parcel-remove.js`、`tools/selftest*.js` 旧断言 | `utils/storage.js`（最小）+ 按主题重写（§7） | 只留会话提示键、无本地 schema、不存 `viewContext`/L3；订单不可硬删/无草稿集合；旧断言不搬源码字面量钉 | `selftest-core`；自身 |
---
## 6. 开发与调试
### 6.1 用户前置操作（**只能用户做**，批 0/批 1 开工门）
| # | 事项 | 为什么只能用户 | 何时 | 证据 |
| :-- | :-- | :-- | :-- | :-- |
| 1 | 确认 appid `wxcb7e5b41b89bc806` 主体可用（D2 已裁决沿用 v3 appid） | 账号持有者 | 批 0 | 公众平台截图 |
| 2 | 开通云开发 + 创建**唯一云环境**（D1 修订：单环境，账号限制 1 个） | 管理员权限/计费确认 | 批 0 | 控制台环境页截图 + envId |
| 3 | 确认主体/类目（D13 已裁决：个人主体 + 工具类目；提审前在后台确认类目可选并完成备案） | 主体资质 | 批 0（阻塞批 9 提审） | 类目页截图 |
| 4 | 配置 `ADMIN_OPENIDS`（JSON 映射含 `DEV-01`） | 控制台权限 | 批 1 | 环境变量截图 + admin 冒烟 |
| 5 | 云存储权限设置（§3.5） | 控制台权限 | 批 1 | 权限截图 |
| 6 | 微信后台《用户隐私保护指引》逐项声明（按官方模板：**昵称、头像**（同一项）/ **选中的照片或视频信息** / **摄像头** / **选中的文件** / **剪切板**；地址如后台提供则如实勾选；自开发无「第三方服务/SDK」栏，DeepSeek 对外提供写进对应「用途」/「信息对外提供」（如可编辑）/补充文档；头像可拒绝→默认头像，不阻断；`privacy_list ⊆ setting_list`） | 必须主体账号操作 | 批 2（头像/昵称）/批 8（隐私文本定稿）/批 9 提审 | 声明页截图 + `docs/privacy/发布前填写清单` §2 勾选 |
| 7 | 设备与账号：**开发者微信号 1 个**即可用测试账号单机验收顾客/兼职两端（默认路径）；真实双机联调可选额外微信号（顾客/兼职），不作为开工门 | 设备与账号 | 批 2 起每批 | `docs/QA_CHECKLIST.md` 点检 |
| 8 | 审核材料准备（测试邀请码批次、审核说明：如何以顾客/兼职身份体验、类目资质、识别失败复核演示） | 主体账号 | 批 9 | 提审记录 |
| 9 | **DeepSeek 账号与 `DEEPSEEK_API_KEY`**（谁注册、配额/服务条款确认；E11）；Key 只配进 `api` 云函数环境变量 | 账号与密钥持有者 | 批 4（可先留空跑降级） | 环境变量截图（键名可见、值打码）+ E11 结论 |
| 10 | **头像/昵称隐私接口与基础库能力实测**（`chooseAvatar` 按钮/`nickname` 输入/隐私弹窗/真机压缩到 ≤200KB；E12） | 平台能力与基础库版本 | 批 2 | 真机录屏 + 基础库版本记入 `.tool-versions`；测结论回填 §4.12 |
### 6.2 开发者工具与本地调试
- 导入 `D:\Code\expressage_college_v4\`（GUI，无 CLI）；首次确认 `cloudfunctionRoot` 被识别、云环境可选。
- 本地跑测试（零依赖、秒级）：`node tools/selftest.js`、`node tools/selftest-ai.js`、`node tools/selftest-cloud.js`、`node tools/selftest-bind.js`、`node tools/selftest-order.js`、`node tools/selftest-order-flow.js`、`node tools/selftest-order-lifecycle.js`、`node tools/selftest-order-customer.js`、`node tools/selftest-order-partner.js`、`node tools/selftest-order-workbench.js`、`node tools/selftest-order-detail-partner.js`、`node tools/selftest-partner-customers.js`、`node tools/selftest-partner-orders.js`、`node tools/selftest-partner-pages.js`、`node tools/selftest-partner-stats.js`、`node tools/selftest-profile.js`、`node tools/selftest-switch.js`、`node tools/selftest-testaccount.js`、`node tools/check.js`、`node tools/check-docs.js`、`node tools/zero-money-scan.js --scope all`；**不需要** npm 依赖（fake DB 是仓库内零依赖件）。
- 云函数本地调试：开发者工具右键 `cloudfunctions/api` →「本地调试」（或远端调试），仅用于联调；**机器门禁以 `tools/selftest-cloud.js` 的 handler 单测为准**。
- 多账号调试：单机验收用测试账号（下一条）；真实双机时用开发者工具"多账号调试"分别登录顾客/兼职；真机一律「预览扫码」，模拟器读数不算数（v3 教训）；云环境为**单环境**（D1 修订）：联调一律视为生产操作，能本地的先在本地 fake-DB/纯件判据跑，必须上真机的只用测试账号，不在真实口径造数据（§10）。
- **切换会话调试（v0.9）**：开发版（唯一环境）用开发者微信号进后台 → `account-switch` → 真实账号 tab（黄条、写控件置灰）或测试账号 tab（蓝条 + `TEST` 角标）→ 选目标进业务页；验证服务端拒写时，用控制台/工具直接带票据调写 action（票据仅内存，切后台被杀即失效需重开）；真实账号传 `TEST_WRITE` 必须 `FORBIDDEN`。
- **测试账号单机验收（v0.9）**：`createTestAccount` 建测试顾客 + 测试兼职 → 测试账号 tab 分别以两端身份切换进入 → 绑定/下单/接单/送达/确认 → 退出后确认统计与红点不计数 → 删除测试账号（先 `dryRun` 看计数）。全程只需一个微信号。
### 6.3 决策：**不建客户端 `wx` 全局 mock**（ADR）
- 背景：v3 的 `tools/selftest.js` 用内存 `wx` 替身跑页面零件（383 条断言）。v4 业务判据已下沉云函数 + `shared/` 纯件，页面只剩取参/setData/事件转发。
- 决策：v4 **不构建整页可跑的 `wx` 全局替身**，也不 mock `Page()`/`Component()`；唯一允许的桩是 `api/client.js` 的 transport 注入点（测试内一行函数），不提供全局 `wx`。
- 理由：①判别力低——mock 页面"绿"证明不了真机行为（v3 页面层零断言的根因不是缺 mock，而是判据放错层）；②v3 教训"替身比真环境宽松"会造假绿；③双套替身面对平台 API 漂移是长期负债；④交互/隐私弹窗/真机性能只能人工点检。
- 替代：纯件无 `wx` 直接断言；`api/client.js` 测试注入 `transport` 函数（不 mock `wx` 对象，只测包络/重试/错误映射/票据注入）；云函数 handler 注入 fake DB；真机走 `docs/QA_CHECKLIST.md` 人工点检（agent 不代宣布）。
- 边界：唯一允许的桩是 `api/client.js` 的 transport 注入点（测试内一行函数），不提供全局 `wx`。

---
## 7. 测试策略
### 7.1 测试分层
| 层 | 文件 | 覆盖 | 禁止 |
| :-- | :-- | :-- | :-- |
| 纯件（shared/utils/config） | `tools/selftest.js` + `selftest-core.js`、`selftest-state.js` | 校验/枚举/状态表/四档排序/roomTag/**编号 ids**/时间格式/路由分流（含 isDeveloper）/视图模型/切换会话白名单集合 | 依赖 `wx`/页面/网络 |
| 识别规则 | `tools/selftest-recognize.js` | 码/站点/柜号/运单尾号/形态闸 + v3 真机语料（sha256 指纹钉） | 新增未取证规则（无样本不加规则） |
| 识别兜底（v0.8） | `tools/selftest-ai.js` + `selftest-cloud.js` | 外发 payload 键集合 = 白名单、二次去敏、超时/重试/熔断/配额降级、失败必入队、DTO 字段闸、复核动作审计 | 真实外呼（一律注入 `fetch` 替身）；mock `wx` |
| v0.9 专项（绑定/资料/切换/测试账号） | `tools/selftest-{bind,profile,switch,testaccount}.js` | 绑定角色/方向/自绑/真实×测试互斥；昵称截断+`msgSecCheck`+头像 payload 白名单；票据解析/READONLY 拒写/TEST_WRITE 白名单/统计排除；测试账号上限/`dryRun`/级联删除 | 真实外呼/真库/真实微信 |
| 云函数 handler | `tools/selftest-cloud.js` + `fake-db.js` | 状态矩阵/幂等/唯一冲突/越权/限流/**编号生成/邀请码/切换会话/测试账号**/cleanup 时间旅行 | 直连真实云环境/真库 |
| 订单闭环（批 4/5） | `tools/selftest-{order,order-flow,order-lifecycle,order-customer}.js` + `fake-db.js` / transport 注入 | 建单引擎与票据/批量原子/严格入参；**顾客闭环**（`order.get` 七态 actions 矩阵、`listCustomer` 三桶+counts+游标、cancel/confirmDelivery/deleteRecord 事件流水、越权负向、`expectedVersion`=CONFLICT、`message.send` 终态闸、`imageUrl` cleaned）；端侧视图矩阵/轮询退避/再次下单/消息红点/补码文案 | 真库/真实云；mock 全局 wx |
| 开发者后台与通知（批 8） | `tools/selftest-{admin,messages,cleanup,admin-pages,message-pages,privacy-text}.js` + `fake-db.js` / transport 注入 | 后台 23 动作白名单与脱敏 DTO/邀请码生命周期/审计/复核四动作/异常介入取消（ADMIN 分支）/维护闸「读放行·写拒绝」边界；消息中心聚合与 `messageReadAt` 水位、`markRead`；cleanup 13 sweep 时间旅行/重跑幂等/部分失败隔离；后台 11 页五态/脱敏/「测试」行标签/危险二次确认；消息页 + 红点 + 公告 + 维护遮罩端侧；端内隐私全文与 docs 定稿关键条目一致性/版本注入 | 真库/真实云；mock 全局 wx |
| API 适配层 | `selftest-core.js`（注入 transport） | 请求包络、响应校验、错误码映射、读重试/写不重试、**viewTicket 注入与写拦截** | mock `wx` 对象 |
| 页面零件 | `selftest-state.js`（require `parts/`） | 纯函数视图模型 | `require` 页面（`Page()` 注册） |
| 零金额门禁 | `check.js` #22、`check-docs.js` #7、`zero-money-scan.js` 自测 | 代码/文案/文档三范围命中 0；扫描器对注入样本必须红 | 用白名单整文件放行 |
| 人工 | `docs/QA_CHECKLIST.md` | 真机上传/OCR/**识别兜底与失败复核**/双机进度/开发者后台/切换会话/隐私弹窗/性能/弱网 | agent 代宣布通过 |
### 7.2 harness 设计（v4 `tools/selftest.js`）
- 计数器 + `EXPECTED_ASSERTIONS` 完整性闸（少算/多算都判红）；分节统一 `run({check,eq})` 注入，计数器只在 harness；`uncaughtException/unhandledRejection` 也打印总数并 exit 1；每条断言文字带 `§节号`。
- 三条纪律沿用 v3：**有判别力**（先合法基线、再只有该闸能挡的反例）、**不许空集全绿**（先断言样本非空）、**期望值不抄现状**（修 bug 时同步改断言并记 CHANGELOG）。
- 取数：`node tools/selftest.js | Select-Object -Last 2`、`node tools/selftest-ai.js | Select-Object -Last 2`、`node tools/selftest-cloud.js | Select-Object -Last 2`、`node tools/selftest-bind.js | Select-Object -Last 2`、`node tools/selftest-order.js | Select-Object -Last 2`、`node tools/selftest-order-lifecycle.js | Select-Object -Last 2`、`node tools/selftest-order-customer.js | Select-Object -Last 2`、`node tools/selftest-order-partner.js | Select-Object -Last 2`、`node tools/selftest-order-workbench.js | Select-Object -Last 2`、`node tools/selftest-order-detail-partner.js | Select-Object -Last 2`、`node tools/selftest-partner-customers.js | Select-Object -Last 2`、`node tools/selftest-partner-orders.js | Select-Object -Last 2`、`node tools/selftest-partner-pages.js | Select-Object -Last 2`、`node tools/selftest-partner-stats.js | Select-Object -Last 2`、`node tools/selftest-switch.js | Select-Object -Last 2`、`node tools/selftest-admin.js | Select-Object -Last 2`、`node tools/selftest-messages.js | Select-Object -Last 2`、`node tools/selftest-cleanup.js | Select-Object -Last 2`、`node tools/selftest-admin-pages.js | Select-Object -Last 2`、`node tools/selftest-message-pages.js | Select-Object -Last 2`、`node tools/selftest-privacy-text.js | Select-Object -Last 2`；条数不写死进文档。
- 测试文件预算：单文件 ≤1000 行、单函数 ≤50 行（AGENTS 口径）；新增导出必须有生产调用或登记 TECH_DEBT。
### 7.3 云函数 handler 单测（fake DB）
- DI：`createApi({ db, now, openid, env, cloud, requestId })` → `call(action, payload)`；`db` 为内存 fake（`collection/where/orderBy/limit/skip/get/add/update/remove/count`、`db.command.{inc,set,remove}`、事务提交/回滚、唯一索引冲突模拟）。
- **更新语义须与真实云 DB 同形**（2026-10-22 隐私同意事故教训）：普通对象值按 `wx-server-sdk` 语义拍平成点路径 `$set`（部分合并），点路径穿过 `null`/标量父级时抛 `-502001 Cannot create field ...`；整值替换只认 `db.command.set`（`dao.update/updateWhere` 统一包装，见 ARCHITECTURE §4.2）。测试禁止直连 fake collection 写嵌套对象来绕过该语义。
- 必测清单（对齐 CONTRACT v0.9 + DATA_MODEL §8/§10）：
  1. **状态转移矩阵**：七状态 × 全部写动作（accept/reject/markPicked/unmarkPicked/markDelivered/unmarkDelivered/reportException/resolveException/cancel/confirmDelivery/correct/undo/deleteRecord），合法成功、非法 `INVALID_TRANSITION`（表驱动）；**不存在费用类动作/事件**。
  2. **requestKey 幂等**：同键重放返回同一订单、不重复写事件；跨 actor 同键 → `CONFLICT`/`FORBIDDEN`，不泄露他人订单。
  3. **activeKey 唯一**：重复绑定返回现有绑定或 `CONFLICT`；换绑先 `RELEASED` 再 `ACTIVE`。
  4. **roomTag**：同（兼职,宿舍）并发/顺序得 A/B/C（大写）；换宿舍新 tag；解绑后**不复用**旧 tag；事务冲突重试 ≤3。
  5. **CLOSED/SUSPENDED/接单开关**：不可接单、不可被新绑定、不可被顾客发现 → `PARTNER_CLOSED`（CLOSED）/`FORBIDDEN`（SUSPENDED）；`acceptingOrders=false` 时 `order.create` → `PARTNER_CLOSED`（零建单），恢复后自动可下单。
  6. **guest 代客单**：`customerId/customerOpenid/customerNo=''`；只有创建兼职能读；顾客任何查询路径不可见、不可认领（P1）；`DELIVERED` 后由 `cleanup.autoComplete` 自动完成。
  7. **匿名化后不可查**：cleanup 匿名化后按原 openid/partnerId/编号查询不得返回该单。
  8. **越权矩阵**：兼职 A 查 B 的订单/顾客/绑定；顾客改 partnerId 查他人单；未激活 openid 调兼职接口；顾客枚举兼职 → `FORBIDDEN`/`NOT_FOUND`。
  9. **限流**：按 §10 配额打满后 `RATE_LIMITED`；跨日重置（now 注入）；含 `activate` 失败 5 次/日/openid、`bind` 5 次/日/顾客、`accountSwitch` 20 次/日/开发者（READONLY/TEST_WRITE 共用）、`avatarUpload` 5 次/日/人。
  10. **cleanup 单触发器**：注入 `now` 验证 orderTimeout/autoComplete/files/tickets/**viewSessions**/retention/accountDeletion/**invitationCodes**/rateLimits/recomputeStats/**testData** 全部按到期条件执行（含 guest 自动完成、邀请码置 `EXPIRED`、过期票据补 `ACCOUNT_SWITCH_EXPIRED` 至多一条）；重跑第二次 acted=0。
  11. **undo 边界**：仅 `markPicked`/`markDelivered` 两类可在 5 秒窗内撤销；`ACCEPTED` 误接单不可 undo（走 cancel）；超时/有后续变化 → `INVALID_STATE`。
  12. **批量语义**：客户端循环逐单 + 同一 `batchActionId` 逐单返回；下单侧一单内多包裹为**同事务原子写**（任一非法→整单零建 `VALIDATION_FAILED`）；部分失败如实。
  13. **上传 ticket**：越权/过期/路径不符/大小类型不符全拒（`VALIDATION_FAILED`/`CONFLICT` 按语义）；路径必须 = `orders/{ticket}/image.jpg` 且与票据 `cloudPath` 逐字节相等；成功置 `usedAt`；**AVATAR ticket 校验路径 `avatars/{role}/{random}.jpg`（无 openid）**。
  14. **唯一索引冲突处理**：`orderNo`、`requestKey`、`activeKey`、`ticket`、`invitation_codes.code`、**`customerNo`、`partnerNo`** 冲突路径均有断言。
  15. **错误码唯一集**：handler 全部失败路径的 code ∈ **13 码集**（源码扫描 + 断言），旧码零命中；每次响应含 `ok/serverTime`，失败含 `code/message`，字段错误含 `data.field`。
  16. **v0.5/v0.6 口径断言**：文本上限、取消原因枚举（`OTHER` 必填、无费用类原因）、服务端排序与游标、`listPartner` 返回 `counts`（6 项）、四档排序在服务端完成、`bind.getCurrent` 返回摘要+公开资料+roomTag、`config.getPublic` 字段齐全、列表 DTO 分级（本人完整/admin 脱敏）、EXCEPTION 顾客取消条件、换宿舍 = RELEASED + 新建 binding + 重分配 roomTag。
  17. **v0.7 编号**：`customerNo` 首次资料创建生成且幂等（重复 bootstrap/saveProfile 不换号）；`partnerNo` 激活成功生成；随机样本落在字母表内且长度正确；唯一索引冲突 → 重生成 ≤5 次，仍失败 `DEPENDENCY_FAILED`；**客户端传编号不作鉴权**（传他人编号不能读数据）；错前缀 → `VALIDATION_FAILED` 且 `message` 为统一提示、不暴露存在性。
  18. **v0.7 邀请码生命周期**：`createInvites` 批量 ≤50/有效期枚举/默认 7 天/`note≤50`/整批可复制；`revokeInvite` 仅 `UNUSED` 可作废（其余 `INVALID_STATE`）；状态机 `UNUSED→USED/REVOKED/EXPIRED`；`partner.activate` 只认 `invitationCode`；错误映射 `INVITE_EXPIRED`/`INVITE_USED`/`NOT_FOUND`/`VALIDATION_FAILED`；失败限流 5 次/日/openid；成功写 `usedBy/usedAt` 且重放幂等；cleanup 过期置 `EXPIRED`、不可"重新生效"。
  19. **v0.7 开发者与只读视角**：非白名单 openid 调任意 `admin.*` → `FORBIDDEN`；`viewAsStart` 目标必须 ACTIVE 且非开发者（否则 `NOT_FOUND`/`FORBIDDEN`）；票据 32 位、落 `admin_view_sessions`、**同一开发者单活**（新开旧票立即失效）；TTL 取 `config.viewTicketTtlMinutes`；白名单内读动作带票据 → 返回**与目标本人一致**的完整 DTO；白名单外读动作 → `FORBIDDEN`；任意写动作带票据 → `FORBIDDEN`；他人票据/已结束票据 → `FORBIDDEN`、过期票据 → `VIEW_TICKET_EXPIRED`；票据调 `admin.*` → `FORBIDDEN`；审计 `ACCOUNT_SWITCH_START/END/EXPIRED` 各正确落库；`user.bootstrap` 返回 `isDeveloper`。
  20. **零金额断言**：handler 入参/DTO 键集/config/审计事件/事件枚举均无费用字段（键集合白名单断言）；`config.getPublic` 的 `serviceCatalog` 只有 `{code,name,desc}`；`partners.stats` 只有单量；页面层扫描 0 命中（与门禁 #22 双向）。
  21. **v0.8 AI 外呼与降级**：外呼只发生在 `lib/ai/deepseek.js`（注入 `fetch` 替身断言调用次数；开关关闭/Key 缺失/配额超限/熔断期内 **零外呼**）；payload 键集合严格等于白名单（多键/少键都红）；二次去敏后手机号/身份证/连号数字被掩码；8s 超时、网络/5xx 重试 1 次、4xx/解析失败不重试；连续 5 次失败熔断 10 分钟（时间注入）；**每条失败路径都写 `recognition_failures`（fake DB 断言写入 1 条）**；`requestKey` 同键重放不新增（幂等返回同一 `failureId`）；不同单各成记录，拆单补建记录按 `:{itemIndex}` 后缀唯一；无空 catch。
  22. **v0.8 DTO 闸**：`stationId` 非 P1~P8 → `''`（名称由服务端按站点表回填）；`pickupCode` 不过码格式闸 → `''`；`confidence/source/needsReview` 枚举合法；`recognized=false` 或 `LOW` ⇒ `needsReview=true` + `failureId`；额外键被剥离；`source=NONE` 不写订单识别字段。
  23. **v0.8 复核动作**：`getRecognitionFailure` 返回临时 URL 且写 `FAILURE_IMAGE_VIEW`；`fixRecognitionFailure` 只写 `parcel.stationId/stationName/pickupCode`（**断言订单 status/归属/订单集合无其他写**）并写 `FAILURE_FIX`；`ignoreRecognitionFailure` 空备注 → `VALIDATION_FAILED`、成功写 `FAILURE_IGNORE`；两者 `notifyUploader=true` 时写站内消息、不额外拆动作；`cleanup.recognitionFailures` 到期删引用 + 置 `IGNORED(EXPIRED)`、订单仍引用时不清订单图片；`failureNo` 唯一冲突重试 ≤5。
  24. **v0.9 绑定方向**：`bind.create` 仅 CUSTOMER（PARTNER → `FORBIDDEN`）；自绑（`partner.openid === caller.effectiveOpenid`）拒绝；真实×测试互绑拒绝；代客单链路零 `bindings` 写；解绑后 `bind.getCurrent`/`partner.listBindings`/订单 DTO 不返回对方头像/昵称。
  25. **v0.9 切换会话**：READONLY 任意写 → `FORBIDDEN`（读白名单内读成功且 DTO 与本人一致）；`TEST_WRITE` 仅 `isTestAccount=true` 目标可签发，真实账号传 `TEST_WRITE` → `FORBIDDEN`；`admin.*`/`partner.activate`/`user.deleteAccount`/`ai.parseParcel` 在 TEST_WRITE 下 `FORBIDDEN`；票据交叉校验（他人票据/改 targetId/改模式）→ `FORBIDDEN`；过期 → `VIEW_TICKET_EXPIRED`；删除测试账号后原票据 → `NOT_FOUND`。
  26. **v0.9 测试数据隔离**：测试订单 `isTest=true`、事件 `impersonatedBy=developerNo`；`admin.stats`/`partners.stats`/红点/邀请码统计零测试数据；真实×测试下单/留言 `FORBIDDEN`；`createTestAccount` 超上限（每角色 3/合计 6）→ `INVALID_STATE`；`deleteTestAccount` 双条件/真实引用拒绝/`dryRun` 计数/级联删头像与会话；`purgeTestData` 只清测试数据、审计前后条数。
  27. **v0.9 头像/昵称**：AVATAR ticket 路径 `avatars/{role}/{random}.jpg`（零 openid）、大小/类型/路径不符全拒；保存失败不落 `avatarFileId`；替换删旧文件、注销/删测试账号删文件；`displayName` 超 20 字截断、`msgSecCheck` 命中 → `VALIDATION_FAILED` 不落库；后台 DTO 无 `avatarFileId`、昵称脱敏；解绑后不返回对方头像/昵称。
  28. **v0.9 roomTag 大写**：`toTag` 边界（1/26/27/52/53）与 `tagRank` 单调；分配 `A/B/C` 大写、换宿舍重分配、旧 tag 不复用；列表按 `dormKey + tagRank` 排序；落库 `^[A-Z]+$`。
- fake DB 只放 `tools/`（不进小程序包），不 require wx-server-sdk。
- fake DB 的"宽松替换语义"曾掩盖真实故障：2026-10-22 云端首跑「同意隐私政策」100% `-502001`（`privacyConsent: null` 上写嵌套对象），本地 4,1xx 断言全绿。修法 = ①dao 层统一整值替换（`command.set`）②fake DB 复刻拍平/空父级报错语义 ③判据双向锁（dao 写入探针 + 真实语义反例 + `selftest-order-partner` G6b「exception 恢复后再上报」），见 `docs/lessons/` 同名卡；后续任何"fake DB 与真实 SDK 行为差异"都必须以真实云日志为准登记并补判据。
### 7.4 越权/负向测试矩阵（与 CONTRACT §4/§10 对齐）
| 场景 | 期望 | 断言位置 |
| :-- | :-- | :-- |
| 兼职 A 读兼职 B 的订单/顾客/绑定；顾客传他人 id 查询 | `FORBIDDEN` 或 `NOT_FOUND`，不泄露他人数据 | `selftest-cloud` |
| 未激活 openid 调 `partner.*`；顾客枚举兼职 | `FORBIDDEN`/`PARTNER_CLOSED`；无接口且不暴露存在性 | 同上 |
| 编号当凭据/错前缀（C 当 P、DEV 当绑定） | `VALIDATION_FAILED` + 统一前缀提示；不作身份、不泄露存在性 | 同上 |
| 邀请码负向映射（v0.7） | 已用 `INVITE_USED`、过期 `INVITE_EXPIRED`、不存在/已作废 `NOT_FOUND`、格式错 `VALIDATION_FAILED` | 同上 |
| 非 admin 调 `admin.*`；无票据/伪造票据调 admin | `FORBIDDEN`（前端隐藏不算） | 同上 |
| CLOSED/SUSPENDED 兼职接单/被新绑；`acceptingOrders=false` 时下单 | `PARTNER_CLOSED`/`FORBIDDEN` | 同上 |
| 异常单顾客取消 | `fromStatus ∈ {SUBMITTED,ACCEPTED}` 可取消；`PICKED/DELIVERED` → `INVALID_STATE` | 同上 |
| 列表 DTO 分级 | 本人列表含完整值；`admin.listOrders` 脱敏（码打码、尾号后 2 位、无完整宿舍、无 openid） | 同上 |
| 他人/过期/已结束 `viewTicket`；READONLY 调写；目标 SUSPENDED/注销/开发者 | `FORBIDDEN`/`VIEW_TICKET_EXPIRED`；写全拒且前端禁用；目标 `NOT_FOUND`（统一文案） | 同上 + 真机 |
| 顾客查代客单 / 匿名化订单按原身份查 | 不存在（无访问路径）/ 查不到 | 同上 |
| 重复 requestKey / batchActionId 重放 | 幂等成功或逐单如实 | 同上 |
| AI 兜底负向（v0.8） | 开关关闭/Key 空/配额超限 → 零外呼 + `recognized=false` + 仍入队；切换会话调用 → `FORBIDDEN`；未登录/无角色 → `FORBIDDEN`；超长 `ocrTextMasked` → `VALIDATION_FAILED` | 同上 |
| 复核动作负向（v0.8） | 非白名单调四动作 → `FORBIDDEN`；补录不存在的 failure → `NOT_FOUND`；空备注忽略 → `VALIDATION_FAILED`；补录他人 uploadTicket 关联记录 → `FORBIDDEN` | 同上 |
| 绑定方向负向（v0.9） | 兼职调 `bind.create`（含带票据）→ `FORBIDDEN`；自绑 → `FORBIDDEN`；真实顾客绑测试兼职/测试顾客绑真实兼职 → `FORBIDDEN`；代客单后 `bindings` 零新增 | `selftest-bind` + `selftest-cloud` |
| 切换会话负向（v0.9） | 真实账号 `mode=TEST_WRITE` → `FORBIDDEN`；READONLY 调写 → `FORBIDDEN`；TEST_WRITE 调禁用动作 → `FORBIDDEN`；他人/改目标/改模式票据 → `FORBIDDEN`；过期 → `VIEW_TICKET_EXPIRED` | `selftest-switch` + 真机 |
| 测试账号负向（v0.9） | 超上限创建 → `INVALID_STATE`；真实引用时删除 → `INVALID_STATE`；缺 `confirm` → `VALIDATION_FAILED`；统计/红点/搜索零测试数据 | `selftest-testaccount` + `selftest-cloud` |
### 7.5 关键安全判据的变异测试（每批涉及安全面时跑）
| # | 变异 | 期望（必须变红） |
| :-- | :-- | :-- |
| M1 | 去掉订单查询的 openid 过滤 | 越权用例红 |
| M2 | 允许 `PICKED → COMPLETED` 直跳 | 转移矩阵红 |
| M3 | roomTag 不递增/复用旧 tag | roomTag 断言红 |
| M4 | 去掉 ticket 归属/过期校验 | 上传负向用例红 |
| M5 | 去掉 requestKey 预查/唯一冲突处理 | 幂等断言红 |
| M6 | 允许 CLOSED 兼职接单/被绑 | CLOSED 用例红 |
| M7 | 留言/详情去掉归属校验 | 越权用例红 |
| M8 | 终态匿名化/物理删不执行 | cleanup 时间旅行红 |
| M9 | 编号生成不建唯一索引/直接信任客户端编号 | 编号断言红 |
| M10 | undo 不校验 5 秒窗口 | undo 断言红 |
| M11 | 去掉 `acceptingOrders` 守卫 | 开关关闭时下单用例红（`PARTNER_CLOSED`） |
| M12 | READONLY 写接口放行（switch-session 不拦） | 切换会话负向用例红 |
| M13 | 后台脱敏失效（返回完整取件码/openid） | 脱敏断言红 |
| M14 | 往 DTO/config 注入费用字段 | 零金额扫描/断言红 |
| M15 | 放宽外发白名单（多发 `fileId`/`openid` 或原图内容） | payload 键集合断言 + check #25 红 |
| M16 | 失败路径直接返回、不写 `recognition_failures` | 必入队断言 + check #26 红 |
| M17 | 复核页看原图不写 `FAILURE_IMAGE_VIEW` 审计 | 审计断言 + check #27 红 |
| M18 | `bind.create` 去掉 CUSTOMER 角色守卫 | 绑定方向负向用例红（check #28 红） |
| M19 | READONLY 会话写动作不拦（switch-session 放行） | 切换会话负向 + check #30 红 |
| M20 | 统计/红点/邀请码查询去掉 `isTest`/`isTestAccount` 过滤 | 测试数据隔离断言红 |
| M21 | 后台 `dto/mask.js` 漏出 `avatarFileId`/完整昵称 | 头像昵称断言 + check #29 红 |
| M22 | roomTag 分配改小写/字符串排序 | roomTag 断言 + check #29 红 |

- 流程：`Copy-Item` 复制被测文件 → 注入变异（锚点尽量 ASCII）→ 跑目标测试记录首红断言 → 还原 → SHA256 逐字节比对 → 复跑全绿；证据（首红 + hash 相等）写进 CHANGELOG。判绿的变异 = 判据没牙，当场补断言。
### 7.6 零金额扫描判据设计（v0.7，门禁自身可测）
- **扫描范围三处**：①源码（`**/*.js|json|wxml|wxss`，含 `cloudfunctions/`）；②页面文案（wxml/js 里的人话字符串）；③文档（根 `*.md` + `docs/**/*.md`，含 CONTRACT/DATA_MODEL/三份 UX/本文/QA/隐私）。
- **词表（唯一单源，写在 `tools/zero-money-scan.js`）**：中文 `金额`（**例外**：固定术语「零金额」整体放行）、`价格`、`运费`、`收款`、`结算`；英文大小写不敏感 token：`price(s)`、`fee(s)`、`pay`/`pays`/`paid`/`payment(s)`/`payStatus`、`amount(s)`、以及标识符后缀 `*Fen`（如 `totalFen`）。英文按 token/标识符边界匹配，**不因子串误报**（`payload` 等不是命中，但词表本身不放宽）。
- **白名单**：`tools/zero-money-allowlist.json`，每项 `{file, string, reason}` 精确到"文件 + 字符串 + 理由"；只允许三类：①口径声明（"本程序不涉及任何费用收付"）②门禁定义块（本文 §7.6/§8.2 #22 与 CONTRACT §3 词表行）③固定术语「零金额」；**禁止整文件/整目录通配**；新增白名单项必须回写本表。
- **判据输出**：命中 → 打印 `file:line:match` 并 exit 1；零命中 → 打印"零金额扫描：0 命中（白名单 N 项）"。**没有汇总输出 = 读数作废**（v3 教训）。
- **判据自测**：`selftest-core` 注入一个含词样本 → 扫描器必须红；删除样本 → 必须绿（证明扫描器真的有牙，不是空集全绿）。
- **DoD 挂钩**：每批 `check.ps1` 输出必须同时含 `check.js` 汇总行、`check-docs` 汇总行与零金额 0 命中行；三者缺一视为"未完成"。

---
## 8. 门禁与检查
### 8.1 `check.ps1`（收工仪式）
- `$STEPS = @('node tools/check.js','node tools/check-docs.js','node tools/selftest.js','node tools/selftest-ai.js','node tools/selftest-cloud.js','node tools/selftest-bind.js','node tools/selftest-profile.js','node tools/selftest-switch.js','node tools/selftest-testaccount.js')`；任一步非 0 ⇒ exit 1，"完成"不成立；全过 ⇒ exit 0 + 粘贴真实输出。
- `check.ps1`/`gate.ps1`/`doctor.ps1` 必须 UTF-8 BOM；被小程序编译的 js/wxml/wxss/json **必须无 BOM**（两向判据都要有，v3 只做了 .ps1 一向）。
- 设计阶段（批 0）：`node tools/check-docs.js --batch 0` 单跑（豁免"批 1 才建立"的文件，§8.3 #1）+ **人工按 §7.6 词表跑一次零金额扫描并留输出**（工具在批 1 建立，批 0 由人执行）；实施阶段五步全跑，目标总耗时 <5s。
### 8.2 `tools/check.js` 判据（v4，逐条）
| # | 判据 | 失败含义 | 来源 |
| :-- | :-- | :-- | :-- |
| 1 | JSON 可解析：app.json/sitemap/project.config + **全部页面 .json** | 配置写坏=白屏/静默失效 | v3 第 1 条扩展 |
| 2 | JS 语法：客户端 + `shared/` + `api/` + `store/` + `utils/` + `tools/` + `cloudfunctions/**`（vm 编译） | 语法错误别等真机/部署 | v3 第 2 条扩展 |
| 3 | 页面四件套：主包 **7 页** + 3 分包 **24 页**（顾客 6 / 兼职 7 / 开发者 11；CONTRACT §7 逐字路径，**v1.0 含 `account-switch`、`recognition-review`、`pkg-customer/pages/pickup-list/index`**） | 声明了缺文件=白屏 | v3 第 3 条扩展（v1.0 页数） |
| 4 | 反向登记：`pages/` 与各 `pkg-*/pages/` 下每个"js+同名 wxml"页面必须在 app.json 声明（`custom-tab-bar/` 组件不算页面） | 漏登记=navigateTo 静默失败 | v3 第 3b 条 |
| 5 | 必需文件：README/AGENTS/STATE/CHANGELOG/check/gate/doctor/.gitignore/.tool-versions/.env.example/两云函数 package.json/设计文档（CONTRACT §12 清单，含 `V4_UX_DEVELOPER.md`） | 骨架缺失 | v3 第 4 条扩展 |
| 6 | `.gitignore` 挡 `.env*`、`project.private.config.json`、`node_modules/`、`.dsh-code-index/` | 密钥/机器配置/缓存泄露 | v3 第 5 条扩展 |
| 7 | PowerShell 脚本必须带 UTF-8 BOM | PS 5.1 解析崩 | v3 第 7 条 |
| 8 | **编译产物不得带 BOM**：js/wxml/wxss/json 首三字节非 EF BB BF | 微信编译器报 unexpected \uFEFF | v3 缺（教训卡 2026-09-20） |
| 9 | WXML class 在同页 WXSS 或 app.wxss 定义（含组件 4 件套） | 用了没定义=真机静默无样式 | v3 第 8 条扩展 |
| 10 | tabBar↔pages：`list` 恰好 5 项、pagePath 均为主包页、`custom-tab-bar/` 在根目录、每角色 3 格可解析、**`pkg-admin` 页面不在 list 内** | 切格失败/自定义 tabBar 不渲染/后台误入 tab | v4 新增（CONTRACT §7） |
| 11 | 全局 `window.navigationStyle` 禁止（页面局部 json 才允许） | 全站失去系统导航（v1 踩过） | v3 第 9 条 |
| 12 | 集合名注册表：`cloudfunctions/**` 的 `db.collection('…')` 字面量 ∈ `shared/collections.js`；客户端任何位置不得出现集合名字面量 | 集合写错/客户端直连 | v4 新增 |
| 13 | action 注册表：`shared/actions.js` 覆盖 CONTRACT §5.3 全集并标 `visibility`（client/internal）与 `write`；internal = `admin.bootstrap`/`health.check`/`cleanup.*`；client 含 `bind.getCurrent`/`ai.parseParcel`/`admin.viewAsStart`/`admin.viewAsEnd`/复核四动作/**测试账号四动作**；`api/modules` 调用 ⊆ client 集；router 只开放 client；handler 与注册表双向相等；**router 静态注册表（P0-5，批 10 扩围）**：11 域覆盖全部 client/放行 internal 动作前缀、每域 `handlers/<domain>` 导出集 = 注册表集且逐个为函数、`cloudfunctions/api/app.js` 热路径必须走 `router.getHandler(`（首请求只加载首用域；运行期域级 fail-fast 保留） | 路由漏配/内部动作外泄/懒加载退回全量 | v4 新增（v0.9 全量；批 10 P0-5 扩围） |
| 14 | 客户端禁直连：`wx.cloud.database` 全仓零命中；`callFunction` 仅 `api/client.js`；`uploadFile` 仅 `api/upload.js` | 绕过服务端鉴权 | v4 新增（CONTRACT §4 铁律） |
| 15 | 本地存储唯一写口：`wx.*Storage*` 仅在 `utils/storage.js`（剥注释后比对；空集判红）；**`viewTicket`/`viewContext`/`viewMode`/`targetIsTest` 不得出现在 storage** | 第二份写盘/票据落盘 | v3 第 11 条改造 + v0.9 |
| 16 | 云函数依赖白名单：两 `package.json` 依赖只允许 `wx-server-sdk`；非相对 require 只允许 sdk | 引第三方/部署失败 | v4 新增 |
| 17 | shared 副本对帐：`shared/**` + **`utils/ids.js → shared/ids.js`** + **`utils/room-tag.js → shared/room-tag.js`** + **`config/defaults.js → shared/defaults.js`** 与两云函数 `shared/` 逐字节 hash 相等 | 两端口径漂移（编号/roomTag/错误码/默认配置） | v4 新增（v0.9 扩围） |
| 18 | 行数：小程序源码（pages/pkg/api/shared/utils/store/config/cloudfunctions）≤500；`tools/*.js` 与测试文件 ≤1000（**全文本口径**；docs 由 check-docs 管） | 文件过长难审/超预算 | v3 AGENTS §11.1 + 修 TD-062 |
| 19 | 敏感字面量：openid 形态 `o[A-Za-z0-9_-]{27}` 生产代码零命中；云环境 ID 只在 `config/env.js`；`ADMIN_OPENIDS` 只读 `process.env`、不落库/不进前端 | 凭证/身份硬编码 | v4 新增 |
| 20 | 错误码注册表：代码引用的 code 与 `shared/error-codes.js` 双向相等，且**恰好 = CONTRACT v0.9 §5.3 的 13 码**（旧码 UNAUTHENTICATED/UNKNOWN_ACTION/INVALID_PARAM/VERSION_CONFLICT/CODE_EXPIRED/CODE_USED 等零残留；AI 兜底失败、账号切换/测试账号均不新增码）；`error-copy` 每码有文案 | 未知码上屏/裸英文报错 | v4 新增（v0.9 修） |
| 21 | 页面层零判据（启发式）：`pages/`、`pkg-*/pages/` 的 .js 不出现 `wx.cloud.*`、不出现七状态字符串字面量、**不出现编号/roomTag 生成或 `random`** | 判据回流页面（TD-016 复发） | v4 新增（v0.9 扩） |
| 22 | **零金额扫描**：源码 + 页面文案按 §7.6 词表扫描命中 0；白名单只认 `zero-money-allowlist.json` 精确项 | 费用语义回潮（用户硬口径） | v4 新增（v0.7） |
| 23 | **切换会话接入（v0.9）**：主包 5 个 tab 页 + `pkg-customer` 6 页（v1.0 含 `pickup-list`）+ `pkg-partner` 7 页的 wxml 必须引用 `switch-bar`（黄条/蓝条 + TEST 角标）；`pkg-admin` 页面不得引用 `switch-bar`/`test-badge`；`viewTicket` 字符串只允许出现在 `api/client.js` 与 `store/` | 会话条缺失/票据外泄/后台误判 | v4 新增（v0.9 扩；v1.0 页数） |
| 24 | **客户端零 AI 外呼/零 Key**（v0.8）：客户端范围（`pages/`、`pkg-*/`、`api/`、`store/`、`utils/`、`components/`、`config/`、`shared/`）零命中 `DEEPSEEK_API_KEY`、`api.deepseek.com`、`deepseek`；`ai.parseParcel` 只经 `api/client.js`/`api/modules/`，页面不直接拼 action | Key 进小程序包/绕过服务端外呼 | v4 新增（v0.8，CONTRACT §12） |
| 25 | **AI 外发白名单**（v0.8）：`https`/`fetch`/`api.deepseek.com` 只允许在 `cloudfunctions/api/lib/ai/deepseek.js`；外发请求体只能由 `buildAiPayload()` 构造且键集合 === `AI_PAYLOAD_KEYS`；`lib/ai/**` 零 `fileId`/`openid`/`orderId` 字面量 | 原图/身份/归属外泄 | v4 新增（v0.8） |
| 26 | **失败必入队**（v0.8）：`handlers/ai/**` 每个 `recognized:false` 返回点都必须有 `recordFailure(`（失败分支数 ≤ 入队调用数，少一个即红）；`catch` 不得空吞直接 return；`shared/collections.js` 必须含 `recognition_failures` | 失败静默丢弃、无法复核 | v4 新增（v0.8） |
| 27 | **复核原图访问必审计**（v0.8）：`admin.getRecognitionFailure` 内 `getTempFileURL` 与 `FAILURE_IMAGE_VIEW` 审计同函数出现；复核页零 `getTempFileURL`（只经 `api/`）；`fix/ignore` 必写 `FAILURE_FIX`/`FAILURE_IGNORE` | 原图被无审计读取 | v4 新增（v0.8） |
| 28 | **绑定方向（v0.9）**：`bind.create` handler **去注释后必须同时命中**「角色守卫调用（`canInitiateBind`/`ROLES.CUSTOMER`）」「真实 `errors.forbidden(`」「自绑比较 `partner.openid === effectiveOpenid`」，实现文件缺失判红（批 3 加固：旧口径被文件头注释里的 CUSTOMER/FORBIDDEN 字样满足 → 删真守卫仍全绿）；代客单路径零 `bindings` 集合访问；`pkg-partner/**` 零 `bind.create`/`bind.release` 调用与"绑定顾客/添加顾客/导入顾客"文案；业务写点为 `handlers/bind`（测试数据清理走 `handlers/admin/testAccounts` 专用 purge，不经业务路径） | 兼职越权绑定/代客单隐式绑定 | v4 新增（v0.9，CONTRACT §12）；批 3 修空转（TD-031） |
| 29 | **头像昵称（v0.9）**：`avatars/` 路径只在 `handlers/upload` 与 `api/upload.js`，模板 `avatars/{role}/{random}.jpg`（**零 openid**）；`avatarFileId` 不出现于**脱敏单源 `cloudfunctions/api/db/dto/mask.js`（文件缺失即判红，缺失≠跳过）**、`handlers/admin/_dto.js`（去注释后整文件禁词）、其它 admin handler 的返回/赋值键（`avatarFileId: ''` 默认空头像写入豁免）、`pkg-admin/**`；昵称截断 + `msgSecCheck` 在 customer/partner 保存路径；roomTag 落库前 `^[A-Z]+$`、`utils/room-tag.js` 零 `random` | 头像外泄/昵称违规/小写 tag | v4 新增（v0.9）；批 2 修 #29 空集全绿 |
| 30 | **账号切换与测试数据隔离（v0.9）**：`admin_view_sessions` 写入含 `viewMode/targetIsTest`；TEST_WRITE 签发处断言 `isTestAccount`；统计/红点/邀请码/后台列表查询含 `isTest`/`isTestAccount` 过滤；`orders` 写入含 `isTest` 派生与 `impersonatedBy`；`shared/audit-actions.js` 枚举 = 本文 §4.9 列表（`ACCOUNT_SWITCH_*`/`TEST_ACCOUNT_*`/`TEST_DATA_PURGE` 在册，`VIEW_AS_*` 零残留） | 测试数据污染真实统计 | v4 新增（v0.9，CONTRACT §12） |
| 31 | **测试视觉（v0.9）**：`TEST` 字面量只允许在 `components/test-badge`；蓝条/黄条颜色常量只在 `components/switch-bar` wxss；`pkg-admin/**` 零引用两组件；角标渲染受 `viewMode=TEST_WRITE` 条件控制 | 测试会话视觉混入真实页面 | v4 新增（v0.9） |
| 32 | **单函数 ≤50 行（批 10，M-57 机械兜底）**：`tools/check-functions.js` 按花括号配平扫描函数跨度；存量违例登记 `tools/function-length-baseline.json`（file+函数名+行数基线），**超基线或新增 >50 行函数判红**；由 `tools/check.js` #32 挂载（`check.ps1` 仍 4 步） | 长函数回流、纪律无牙 | 批 10 新增（AGENTS §4.2 判据侧） |

- **批 3 补充的行为/静态回归判据**（`tools/selftest-bind-cloud.js`，第 10 套；`check.js` 仍 31 条不扩容）：A 方向守卫（顾客基线/PARTNER→`FORBIDDEN`/自绑→`FORBIDDEN`/真实×测试→`FORBIDDEN`）；B 编号归一并复用 `shared/error-copy.PREFIX_HINT` 三句同源提示（`data.field='partnerNo'`）；C roomTag 大写/顺序/隔离/旧号不复用/`tagKey` 唯一；D 换绑与换宿舍（旧 ACTIVE→RELEASED+新 binding）；E 解绑失联与通知；F `partner.getPublic`/`bind.getCurrent`/`listBindings` 头像昵称边界与 TEST_WRITE 路由级放行（READONLY 仍拒）；G 接单开关 `PARTNER_CLOSED` + **全仓 `cloudfunctions/**/*.js` 去注释后 `COLLECTIONS.<小写键>` 零命中**（批 3 P0 回归闸：`handlers/order/_create.js` 曾写 `COLLECTIONS.orders`，下单快乐路径全挂）；H 事务冲突重试边界（默认 3 次、只重试冲突、唯一索引冲突不重试）。
- **批 9 补充的注销/数据删除端到端判据**（`tools/selftest-deletion.js`，register+`EXPECTED_ASSERTIONS` 聚合形态；`check.js` 仍 31 条不扩容）：A `user.deleteAccount` handler（确认文本/进行中订单闸/事务释放绑定并清 `partnerNote`/DEACTIVATED/READONLY 与非顾客拒绝/隐私与维护闸/handler 幂等分支）；B `cleanup.accountDeletion` 阶段一（customers PII+头像文件、订单立即匿名化含 EXCEPTION、截图与留言/事件、识别失败 `uploaderOpenid/fileId` 清空并按引用计数删原图、票据、会话 `ACCOUNT_SWITCH_END(reason=TARGET_DELETED)` 幂等、历史 `bindings.partnerNote`）；C 阶段二（+30 天物理删 users/customers/bindings/票据+头像兜底、重跑 acted 收敛 0、批上限 100 可重入）；D 兼职 CLOSED（释放绑定+订单转异常、partners PII 匿名化+删头像文件+`invitation_codes.usedBy` 置空、识别失败匿名化、`getPublic` NOT_FOUND/`activate` CONFLICT/不可恢复）；E 修复回归与失败隔离；F 端侧注销静态判据。**先判据后修**：首跑 14 条缺陷红（partnerNote 漏清、CLOSED 匿名化/头像/邀请码/识别失败缺失、原图引用未回收）→ 修后全绿；3 组变异电池首红 + SHA256 逐字节还原复跑。
- 汇总行必须存在（"通过 N 项；失败 M 项"）；**没有汇总输出 = 读数作废**，不许当红/绿用（v3 教训）。
- **批 10 补充的性能判据**（`tools/selftest-performance.js`，register+`EXPECTED_ASSERTIONS` 聚合形态；`check.js` 仍 31 条不扩容，`#13` 扩围覆盖 router 静态注册表）：A 启动链（只 await `user.bootstrap`、不 await 绑定摘要、`prime` 预热、复用窗口与切换会话闸）；B config `prime` 动态（预热后首次 `getPublic` 的 transport 计数 = 0、`prime(null)` 不写缓存、TTL 仍 5 分钟）；C `store.binding.partnerPublic` 可选字段与首页复用接线；D bootstrap 五读并行（延迟 fake DB 断言并发窗口 + 静态 `Promise.all` 形态）；E router 懒加载（首用 `user.bootstrap` 只加载 user 域、`cleanup.*` 拒绝、全量域导出双向相等）；F setData 收口（`orders` 1s ticker 行级 path 补丁且无变化零 setData、workbench 角标判等后 patch、`api/client` 校时 1s 阈值）；G `db/config` 同请求只读 1 次（fake DB 读计数）；H 定时器/加载态（workbench `searchTimer` 清理、switch-bar 可见性启停、home/orders ≥300ms 加载态）。
### 8.3 `tools/check-docs.js`（设计阶段门禁）
1. 文档地图列出的文件**按批次分阶段校验**：**批 0 豁免**"批 1 才建立"的 `AGENTS.md`、`STATE.md`、`CHANGELOG.md`、`docs/ARCHITECTURE.md`、`docs/RUNBOOK.md`、`docs/V4_FIXTURES.md`（六件批 1 收口时必须存在）；批 0 必须存在 = `V4_REBUILD_SPEC.md`、`docs/V4_CONTRACT.md`、`docs/V4_DATA_MODEL.md`、三份 UX（含 **`docs/V4_UX_DEVELOPER.md`**）、本文、`docs/V4_DECISIONS.md`、`docs/QA_CHECKLIST.md`、`docs/privacy/*`；**批 ≥1 不豁免**。批次由显式参数 `--batch N` 传入（**默认 1 = 严格不豁免**；批 0 必须显式传 `--batch 0`）。
2. CONTRACT §7 页面路径全集 = app.json 声明（主包 7 + 分包 24 = 31 页；批 1 后生效，v1.0 含 `pickup-list`）。
3. CONTRACT §5.3 action 表 = `shared/actions.js`（双向；`visibility=internal` 单列，不对客户端开放；**`admin.createInvites/revokeInvite/listInvites/listCustomers/getCustomer/listPartners/setPartnerStatus/listOrders/getOrder/listAudit/updateConfig/stats/viewAsStart/viewAsEnd/createTestAccount/listTestAccounts/deleteTestAccount/purgeTestData/listRecognitionFailures/getRecognitionFailure/fixRecognitionFailure/ignoreRecognitionFailure`、`ai.parseParcel` 全部在册**）；DATA_MODEL §7 的 action 名 ⊆ CONTRACT 表。
4. CONTRACT §4 集合表 = `shared/collections.js`（**14 集合**，含 `invitation_codes`、`admin_view_sessions`、`recognition_failures`）；`shared/error-codes.js` **恰好等于** CONTRACT §5.3 的 13 码（双向，旧码零命中；AI 兜底失败不入码）。
5. D#/E# 引用可解析（CONTRACT §13 的 **D1~D29** 与本文 §13 的 E# 存在对应条目）。
6. 正文无未完成占位标记（英文待办缩写、\"以后再补\"类措辞、单字占位符）；`[E#]`、`[R#]`、`P1/P2`、`[D#]`、`⏳` 不算占位。
7. **零金额文档扫描**：docs/ + 根 md 按 §7.6 词表命中 0（白名单精确项例外），失败输出 `file:line`。
8. **编号规格一致性**：CONTRACT §3.1 表 = 本文 §5.3 表 = `utils/ids.js` 导出的字母表/长度/展示分组常量；错前缀三句文案在 `shared/error-copy.js` 存在且被引用；`developerNo` 只来自 `ADMIN_OPENIDS` 映射。
9. **AI 兜底文档判据（v0.8）**：CONTRACT §4.3/§11.3/§12 与本文 §4.10 必须同时覆盖**三项语义**（外发字段 = 白名单、失败必写 `recognition_failures`、原图访问必落 `FAILURE_IMAGE_VIEW` 审计；按关键词集合匹配，不要求逐字同句）；`failureCode` 5 枚举两侧逐字一致；`config.aiFallback` 键名一致；复核页路径在 CONTRACT §7 = `pkg-admin/pages/recognition-review/index`；文档只出现 `DEEPSEEK_API_KEY` 键名、绝无明文 Key。
10. **v0.9/v1.0 文档一致性**：①旧口径禁词表（旧头像采集声明、旧双机验收说法、旧单账号说明、小写 roomTag 后缀变量、旧视角页名）在 docs/ + 根 md 零命中——**词表唯一单源在 `tools/check-docs.js`，文档不重复字面量**；②D# 引用可全部解析到 CONTRACT §13 的 D1~D29；③审计枚举双向：`shared/audit-actions.js` = CONTRACT §4.2 列表（`ACCOUNT_SWITCH_*`/`TEST_ACCOUNT_*`/`TEST_DATA_PURGE` 在册，`VIEW_AS_*` 零残留）；④roomTag：CONTRACT D7/§3 = 本文 §5.3b/§4.12 = `utils/room-tag.js` 四端一致且大写；⑤切换会话：`viewMode ∈ {READONLY,TEST_WRITE}`、真实只读、测试可写、票据不落盘、删除测试账号结束会话五条同时覆盖；⑥QA_CHECKLIST 的 v0.9 点检项（账号切换/测试账号/头像/绑定方向）存在。
### 8.4 `gate.ps1` 适配
- 入参不变：`-Anchor <哈希> -ScopeFiles "<逗号串>" -Estimate <行数>`；退出码 0 绿 / 1 红 / 2 黄。
- 六项：①锚点可解析 ②变更集 = 锚点..HEAD + 工作区（`-uall`、`git -c core.quotepath=false`）③范围前缀匹配（含 `cloudfunctions/`、`docs/`、`shared/`、**`utils/ids.js`**、**`utils/room-tag.js`**、`assets/`）④行数（**全文本口径**；`tools/` 档 ≤1000 与 #18 一致、其余 ≤500；本批新增越线红、锚点前已超黄）⑤lockfile/package.json 变更黄（`cloudfunctions/*/package.json` 也算）⑥体量 ≤ 预估×1.5。
- 纪律（v3 教训）：并行写只走 `git worktree`；同树并行声明并集；锚点 = 本批真实前驱（开工自取 `HEAD`），提交后回读 `git rev-parse --short HEAD`；零变更 = 黄不是绿。
- 提交信息必须匹配 `^(feat|fix|docs|test|chore)\(v4\):`（`git log --format=%s` 检查）。
### 8.5 git 身份与提交规范
- 批 1 `git init` 后**显式配置** `user.name/user.email`（v3 历史提交是 `agent <agent@local>` 但未写入 config；v4 由 lead 定名并回填 AGENTS）。`doctor.ps1` 与 `gate.ps1` 前置检查 `git var GIT_AUTHOR_IDENT`。
- 提交信息：`<type>(v4): <批名> <一句话>（证据: selftest N/N + check 0 + 零金额 0 命中 + gate 绿）`；不提交 `project.private.config.json`；不 `git tag`（不可委托）；每批收工顺序 = 更新 CHANGELOG/文档 → 提交 → 回读 HEAD → 跑 gate（锚点=批前 HEAD）→ 贴真实输出。
### 8.6 CHANGELOG/回写义务（v4 版）
| 改动 | 必须同步 |
| :-- | :-- |
| 页面/交互 | `docs/V4_UX_CUSTOMER.md` / `V4_UX_PARTNER.md` / `V4_UX_DEVELOPER.md` |
| 集合/字段/索引/API/错误码 | `docs/V4_DATA_MODEL.md`（API 契约与数据字典） |
| 编号规则/前缀/展示 | `docs/V4_CONTRACT.md` §3.1 + DATA_MODEL + 本文 §5.3 + `utils/ids.js`（**四处同时改，否则门禁红**） |
| 开发者后台/切换会话/测试账号 | `docs/V4_UX_DEVELOPER.md` + DATA_MODEL + 本文 §4.8/§4.9/§4.11/§5.5 |
| 零金额口径/白名单 | 全部文档 + `tools/zero-money-allowlist.json` 登记理由 |
| OCR 识别兜底/外发字段/失败码（v0.8） | `docs/V4_CONTRACT.md` §4.3/§11.2 + `docs/V4_DATA_MODEL.md` + 本文 §4.10 + `cloudfunctions/api/lib/ai/payload.js` + `docs/privacy/`（第三方 AI 披露） |
| 识别失败复核页/后台动作/审计（v0.8） | `docs/V4_UX_DEVELOPER.md` + `docs/V4_DATA_MODEL.md` + 本文 §4.10 + §8.2 #27 |
| 账号切换/测试账号工程（v0.9） | CONTRACT §1.3/§5.3 + DATA_MODEL（`viewMode/targetIsTest`、`TEST_ACCOUNT_*`、`isTest/impersonatedBy`）+ 本文 §4.8/§4.11 + `docs/V4_UX_DEVELOPER.md`（account-switch）+ QA 清单账号切换节 |
| 头像/昵称/roomTag（v0.9） | CONTRACT §4.1/§4.2 + DATA_MODEL（`avatarFileId`、头像路径无 openid、`roomTag` 大写）+ 本文 §4.12/§5.3b + `utils/room-tag.js`/`shared/room-tag.js` + `docs/privacy/` + QA 清单头像节 |
| 工程结构/门禁/测试/部署 | 本文 `docs/V4_ENGINEERING.md` |
| 技术决策 | `docs/V4_DECISIONS.md`（D#）；工程缺口 `[E#]` 本文 §13 |
| 踩坑 / 欠账与被否方案 | `docs/lessons/`（先查重，≤12 行/卡）+ `docs/TECH_DEBT.md`（v4 编号从 TD-001 起） |
| 版本演进 / 状态/下一步 | `CHANGELOG.md`（分「用户可见变更 / 工程细节」两段）+ `STATE.md`（唯一状态源） |

---
## 9. 文档体系与维护
### 9.1 文档地图与职责
| 文档 | 职责 | 更新时机 |
| :-- | :-- | :-- |
| `V4_REBUILD_SPEC.md`（根） | 产品/架构/权限/状态机/批次/验收/风险/裁决索引 | 产品范围变化时 |
| `docs/V4_CONTRACT.md` | **唯一口径卡**：角色/字段/编号/页面/隐私/D# | 口径变更唯一入口；改完同步所有引用 |
| `docs/V4_DATA_MODEL.md` | 集合/字段/索引/API 契约/编号生成与索引/roomTag/安全规则/越权测试 | 字段/索引/action 变更时 |
| `docs/V4_UX_CUSTOMER.md` / `V4_UX_PARTNER.md` | 逐页交互/验收清单（顾客/兼职） | UI 与交互变更时 |
| `docs/V4_UX_DEVELOPER.md`（v0.7 新增；v0.8 增识别失败复核；**v0.9 增账号切换/测试账号管理**） | 开发者后台/邀请码/数据查看/审计/**账号切换（真实只读/测试可写/测试账号管理）**/识别失败复核（原图+补录/忽略）逐页交互与验收 | 开发者能力或后台变更时 |
| `docs/V4_ENGINEERING.md` | 工程结构/环境/测试/门禁/部署/批次技术拆分 | 本文 |
| `docs/V4_DECISIONS.md` | **D1~D22** 裁决卡（D16/D17 三次修订、D18~D21 四次修订、D22 批 4 登记待裁） | 用户裁决时 |
| `docs/V4_FIXTURES.md` / `docs/privacy/` | 识别层真机语料与指纹 / 隐私指引草案 + 发布前填写清单（**含第三方 AI 与复核原图披露**） | 批 1 建骨架、批 4 落语料；上线前人执行 |
| `docs/ARCHITECTURE.md` / `docs/RUNBOOK.md` | 分层铁律与落点表 / 启动/检查/环境变量/部署/故障/未验证清单 | 架构或部署变化时（批 1 建立） |
| `docs/QA_CHECKLIST.md` | 真机/**测试账号单机验收**/开发者后台/**切换会话（只读/测试可写）**/识别兜底与复核/**头像昵称/绑定方向**/隐私/性能点检清单 | 每批新增验收项 |
| `docs/V4_REVIEW_MATERIALS.md`（**批 9 新增**） | 提审前置清单/分角色审核体验路径/审核说明模板/驳回应对/证据留存（用户提审用；agent 不代提审、不代勾） | 提审流程、隐私声明或审核体验路径变化时 |
| `docs/V4_V3_PARITY.md`（**批 9 新增**） | v3→v4 页面/能力/教训对照验收、不迁项理由与剩余项汇总（用户勾选底稿；文档级对照 ≠ 真机验收） | v3 盘点结果或 v4 能力范围变化时 |
| `docs/TECH_DEBT.md` / `docs/lessons/` | 欠账台账 / 踩坑卡 | 发现即登记 |
| `AGENTS.md`/`STATE.md`/`CHANGELOG.md`/`README.md` | 宪法/状态源/版本/对外说明 | 批 1 建立/改造；对应触发条件 |

> [E7 已裁] SPEC §10 与 CONTRACT §12 文档地图已统一：**保留 ARCHITECTURE/RUNBOOK，不设 registry 三件套**（数据字典/API 契约并入 DATA_MODEL，组件清单按需建轻量 COMPONENTS）。
### 9.2 写作与引用纪律（沿用 CONTRACT §14）
- 只写设计与验收，不写实现代码；可给文件树/判据表/伪代码。
- 引用口径用 CONTRACT 编号（§/D#）；工程缺口用本文 `[E#]`；引用 v3 用"文件 + 函数名"，不写行号。
- 数字不写死（测试条数/性能/配额给取数命令或"以控制台为准"）；所有"待定"显式编号；每份文档至少含：目标 / 清单 / 状态与边界 / 异常与失败路径 / 验收 / 待裁决。
- **零金额纪律（v0.7）**：本程序不涉及任何费用收付；任何文档不得新增费用语义；引用旧口径必须标"已废弃（v0.7）"；专属声明行登记零金额白名单。
- **AI 兜底纪律（v0.8，CONTRACT §14 第 8 条）**：写 DeepSeek/OCR 兜底必须同时写清 **发什么/不发什么/超时与重试/限额与降级/失败入队/是否审计/Key 放哪**；禁止只写"调用 AI 自动识别"一句话；AI 只做预填建议、不覆盖用户手填；外呼不得在客户端发起。
- **v0.9 纪律（绑定/切换/头像/roomTag，CONTRACT §14 第 9 条）**：写绑定必须写"只能顾客发起、兼职无入口、代客单不产生绑定、解绑后不再互见头像昵称"；写切换必须区分真实账号只读/测试账号可写并写明平台限制；写头像必须写采集方式/可拒绝/可见范围/默认头像/后台不展示/注销删除；roomTag 一律大写。
### 9.3 v3 lessons 搬迁清单（只搬框架无关卡）
`数字口径与CRLF`、`UTF-16LE编码破坏`、`PowerShell写文件会加BOM`、`编辑器改ps1会吃掉BOM`、`假exit码`、`门禁参数串成一个`、`空集上的全绿`、`并行写同一工作树会让范围门禁误报`、`非ASCII路径被git转义`、`相对路径喂给NET静态方法会读空`、`变异不红的两种含义`、`git未配身份会让提交静默失败`。其余 v3 业务卡按 v4 需要单独立卡。

---
## 10. 部署发布 runbook
### 10.1 环境矩阵（**单环境**，D1 修订）
| 版本 | 云环境 | 用途 | 谁能动 |
| :-- | :-- | :-- | :-- |
| develop（工具内） | **唯一环境** | 日常开发/单测/本地调试（**共用生产库，数据一律走测试账号/测试数据**） | agent + 用户 |
| trial（体验版） | 同上 | 双端验收/开发者后台与切换会话演练（READONLY/TEST_WRITE）/**识别失败复核演练**/**头像/昵称/测试账号演练** | 用户（体验成员 + 开发者微信号） |
| release（线上） | 同上 | 发布 | 仅用户 |

- 用户 2026-10-22 确认「账号只能开通 1 个云环境」⇒ **不存在 dev/prod 两套库**：隔离靠测试账号/`isTest` 标记（§4.11）+ 上线前「单环境清零」（RUNBOOK §10.2.1）；发布侧灰度用体验版验收 + 平台分阶段发布（§10.4）。
- 上线后禁止在正式库造测试数据；结构/数据变更前必须先导出 JSON 备份（§10.4 回滚条）。
### 10.2 首次部署（批 1 收口，按序）
1. 【用户】开通**唯一云环境**（§4.6 步骤 1；D1 修订：账号只能开 1 个环境）→ envId 交 agent 填 `config/env.js` 三档。
2. 【agent】`git init` + 配身份；`.gitignore`/`.tool-versions`/`.env.example`/`project.config.json` 就位；`check.ps1` 跑 0。
3. 【用户】建 **14 集合** + 安全规则 + 全部索引（§4.6 步骤 2~4），截图/导出存档。
4. 【agent】`node tools/sync-cloud-shared.js` → 上传部署 `cloudfunctions/api`（云端安装依赖）→ 【用户】配 `ADMIN_OPENIDS`（JSON 映射含 `DEV-01`）与 `DEEPSEEK_API_KEY`（v0.8，可先留空验证降级）→ 调 `health.check`/`admin.bootstrap`（内部动作：集合/索引校验 + config 种子）冒烟。
5. 【agent】上传部署 `cleanup` → 【用户】控制台配**一条**定时触发器（每 10 分钟，按 §4.7 幂等跑全部到期任务，含邀请码过期与视角票据清理）。
6. 【用户】云存储权限设置（§3.5）。
7. 【agent】`node tools/seed-dev.js` 输出**单环境初始化计划**（config 键含 `aiFallback`、`recognitionFailureRetentionDays`、**`avatarMaxBytes`/`testAccountMaxPerRole`/`testDataRetentionDays`**，服务类型目录、**测试邀请码批次**、**测试顾客与兼职资料**、**各 1 个测试账号（可选）**；脚本只做 dry-run 计划与环境断言，不写真实库；真实初始化由用户/部署机按 RUNBOOK 执行）；【证据】环境页/集合/索引/权限/环境变量（含 Key 键名脱敏截图）/触发器截图 + 冒烟输出，写入 `docs/RUNBOOK.md`。
8. 【用户】配置 `config.viewTicketTtlMinutes`（默认 30）、`avatarMaxBytes`（200KB）、`testAccountMaxPerRole`（3）、`testDataRetentionDays`（30）与 `serviceCatalog`（无费用项）；【agent】用开发者微信号跑一次 `viewAsStart(READONLY)→读→viewAsEnd→审计可查` 冒烟；**v0.8 追加**：造假失败图 → `ai.parseParcel` 返回 `recognized` 或 `failureId` → 复核页看原图（审计）→ 补录回填 → `FAILURE_FIX` 可查；**v0.9 追加**：测试账号 `TEST_WRITE` 两端各走一单 → 统计不计数 → 头像上传/替换删旧 → 删除测试账号（dryRun→确认）→ 审计 `ACCOUNT_SWITCH_*`/`TEST_ACCOUNT_*` 可查。
9. 【用户/agent】账号切换与头像冒烟（v0.9）：真实账号 READONLY 进目标页（黄条 + 写拒绝）→ 测试账号 TEST_WRITE 两端各走一单（蓝条 + `TEST` 角标）→ 统计/红点不计数 → 上传头像（替换后旧文件已删、保存失败不落 `avatarFileId`）→ 删除测试账号（dryRun→确认）→ 审计 `ACCOUNT_SWITCH_*`/`TEST_ACCOUNT_*` 可查。
### 10.3 每批部署（实施期）
1. 本地：`powershell -File check.ps1` 0（含零金额 0 命中）→ `sync-cloud-shared` → 上传 `api`（若改）。
2. 环境冒烟（测试账号）：`health.check` + 本批新增 action 的最小链路（用户真机或 agent 调云函数）；**批 2/3 冒烟编号生成/账号切换与测试账号（含头像上传）、批 4 冒烟识别兜底降级（关开关/造假失败图）、批 8 冒烟邀请码全生命周期 + 后台脱敏 + 切换会话读写边界与测试数据隔离 + 复核补录与审计**。
3. 更新 `CHANGELOG.md`「未发布/工程细节」+ 文档回写 → 提交 → `gate.ps1` 绿 → 贴输出。
4. 体验版只在批 5/6/8/9 发（用户操作）；每批验收项写 `docs/QA_CHECKLIST.md`；**agent 不代勾"账号切换/测试账号/头像/脱敏/邀请码"等人执行项**。
### 10.4 发布、灰度与回滚
- 发布前置：D13 类目可选性与备案确认（个人主体 + 工具类目，见 DECISIONS D13 留痕）；隐私指引后台逐项声明完成（**按官方模板：昵称、头像（同一项）、选中的照片或视频信息、摄像头、选中的文件、剪切板；地址如后台提供则如实勾选；DeepSeek 对外提供写进对应「用途」/「信息对外提供」（如可编辑）/补充文档：只发去敏文本、原图不出本程序云存储、失败原图进复核并 30 天删除；`privacy_list ⊆ setting_list` 无缺项**）；`docs/privacy/发布前填写清单` 全勾；审核材料齐（**按 `docs/V4_REVIEW_MATERIALS.md` §1 P0 清单准备**：测试邀请码批次 + 测试账号演示说明 + 审核说明：如何以顾客/兼职身份体验、如何进入开发者后台做只读切换与识别失败复核、测试账号如何创建/清理，含测试编号/邀请码示例；§3 审核说明模板、§4 驳回应对、§5 证据留存表）。
- 客户端兼容窗口：审核/发布不同步 ⇒ **API 只增不删、字段只加不改语义**；破坏性变更用新 action 名 + 旧 action 保留至少一个发布周期；服务端读客户端版本决定兼容分支。
- **开发者白名单运维**：`ADMIN_OPENIDS` 变更属控制台操作（用户执行）；变更后冒烟 `admin.bootstrap`；**不把白名单写进任何仓库文件**；多开发者各自微信登录、会话/审计隔离；**开发者账号不作为业务测试账号**——真实操作走测试账号（单机）或额外微信号（真实双机，可选）。
- 回滚：①云函数在控制台"版本与配置"回滚到上一版本（或重传上一提交）；②数据库变更前先导出备份（控制台导出 JSON），cleanup 只做可重跑操作；③客户端问题重新提交上一版本（审核延迟属已知成本）；④回滚后跑冒烟 + 记录 CHANGELOG；⑤**AI 事故先降级不先回滚**：关 `config.aiFallback.enabled`（或清 `DEEPSEEK_API_KEY`）⇒ 静默降级 + 失败仍入队，再决定是否回滚云函数版本；⑥**测试数据事故先清不先删库**：`purgeTestData`（`dryRun`→`confirm`）清测试业务数据、保留账号与真实数据，事后核对审计前后条数。
- 禁止：agent 执行发布/提审/tag/删库（不可委托清单）。

---
## 11. 实施批次技术拆分（与 SPEC §9.1 对齐）

| 批 | 依赖 | 技术交付（工程侧） | 验证与证据 | 主要风险 |
| :-- | :-- | :-- | :-- | :-- |
| **批 0** 设计定稿与开工门 | — | 本文/各设计文档定稿（含 `V4_UX_DEVELOPER.md`）；**D1~D22 裁决留痕（2026-10-22 全部闭环）**；v3 复制清单确认；`docs/privacy` 草案（**含头像/昵称采集、第三方 AI 披露、账号切换说明**）；云环境可用性确认；人工零金额扫描留输出 | `node tools/check-docs.js --batch 0`；环境截图；裁决台账勾选；零金额人工 0 命中输出 | 开工门已闭环（D1/D2/D3/D13）；D8 苑名=东/西/南/北/翠苑；无待裁项阻塞开工 |
| **批 1** 工程骨架与云端基础设施 | 批 0 | `git init`+身份；check/gate/doctor/check.js/check-docs/**zero-money-scan**；selftest harness + fake DB + selftest-cloud/selftest-ai 骨架 + **selftest-{bind,profile,switch,testaccount} 骨架**（EXPECTED_ASSERTIONS 闸先立）；`shared/` 注册表与校验件（**含 `actions.js` 的 `write` 标记**）；`utils/ids.js`/`utils/room-tag.js` 规格件 + `lib/id-generator`/`tag-allocator` 骨架；`lib/ai/` 适配层骨架；`api`/`cleanup` 骨架 + `health.check`/`admin.bootstrap`；**14 集合**+索引+安全规则；`config/env.js`/种子（含 `aiFallback`、`viewTicketTtlMinutes`、`avatarMaxBytes`、`testAccountMaxPerRole`、`testDataRetentionDays`）；`DEEPSEEK_API_KEY` 环境变量记录；sync 脚本；RUNBOOK | `check.ps1` 0（含零金额 0 命中 + AI 门禁 #24~#27；**#28~#31 判据骨架已登记，对象批次必须真红**）；`check-docs` 0；云函数调通 `health.check`；集合/索引导出证据 | 云环境未开/索引唯一冲突；限流键族；DeepSeek 账号未就绪（可留空降级） |
| **批 2** 账号入口 + 切换会话/测试账号/头像采集（v0.9 前移） | 批 1 | `user.bootstrap`（`isDeveloper` + `viewContext{viewMode,role,target}`）/users；`api/client` 包络 + `api/mode-guard`；`store`；`launch`/`role`/`profile` 骨架；`custom-tab-bar`；顾客资料 →**`customerNo` 首次生成** + **头像/昵称采集（chooseAvatar / nickname 输入 / msgSecCheck / AVATAR ticket）**；隐私同意；**邀请码激活 + `partnerNo` 生成**；**开发者分流**；**`switch-session` 中间件 + `admin_view_sessions` + 黄条/蓝条/TEST 角标 + 测试账号四动作 + `account-switch` 页** | 纯件/云单测（编号生成/激活映射/票据解析/头像 payload/昵称截断）；真机双角色切换；邀请码负向；**测试账号单机双端验收（绑定→下单→确认）**；真实账号传 `TEST_WRITE` → `FORBIDDEN`；开发者 entry 真机 | tabBar 平台约束；隐私声明前置；白名单误配；头像/昵称接口能力 [E12] |
| **批 3** 绑定与服务配置（绑定方向固化，v0.9） | 批 2 | `bind.create`（**仅顾客 + 完整 `partnerNo` + 错前缀提示 + 自绑/真实×测试拒绝**）/`release`/`getCurrent` + `activeKey` + **roomTag 绑定成功时事务分配（大写 `A…Z/AA…`）**；`bind` 页/绑定卡片（只带 `partnerNo`，无头像昵称）；`partner.getPublic`（含头像/昵称、测试账号 `NOT_FOUND`）；`partner.saveServiceConfig`（接单开关）；改宿舍 = RELEASED + 新建 binding；**解绑后 DTO 不再返回对方头像/昵称** | 云单测：绑定角色守卫（PARTNER → `FORBIDDEN`）、**#28 静态检查**、roomTag 并发/大写/不复用/换绑/解绑/改宿舍、解绑失联；`acceptingOrders=false` 下单 `PARTNER_CLOSED`；编号归一/错前缀用例；真机绑定与换绑 | 事务冲突；进行中订单时解绑/换绑拦截 |
| **批 4** 顾客下单链路 | 批 3 | `upload.prepare`/`upload.cancel` + 存储权限（路径 `orders/{ticket}/image.jpg`）+ `api/upload`；识别层移植（`utils/recognize`）；`order-create` 四步/多码拆单/手填兜底/结果内嵌第 4 步；**`ai.parseParcel`（v0.8 兜底：只发去敏文本/超时重试熔断/配额静默降级/失败入队）+ 识别来源快照**；`order.create`/`order.createBatch`（≤5 单原子建，受 acceptingOrders 守卫）；站点 P1~P8 选择器；**服务类型选择只有类型名与说明** | `selftest-recognize`（v3 语料）；`selftest-ai`（payload/DTO/降级/入队/配额/票据）；新增 `selftest-order`（建单引擎：幂等/ticket 路径/批量原子性/守卫/字段闸/逐单失败回填）与 `selftest-order-flow`（四步端侧：幂等键生命周期/逐件 AI/识别来源/逐件预约备注）；真机截图→订单全通；关开关/造假失败图降级冒烟；零金额扫描 0 命中 | OCR 真机形态 [R3]；截图隐私 [R5]；AI 误预填/外部可用性 [R20] |
| **批 5** 顾客订单闭环 | 批 4 | 顾客订单列表/详情/进度轮询；取消/确认送达；留言（终态只读归档）；异常展示；`order.confirmDelivery/cancel` + 事件流水；顾客编号展示与复制；**服务端 `actions[]` 七态单源矩阵、`listCustomer.counts` 三桶、`image{hasImage,cleaned}`、`message.send` 终态闸、写动作 `expectedVersion` 乐观锁、`order.correct` 补码 note**；端侧轮询策略纯件（10s/失败 20s→40s 退避/最近更新）、进度异常/取消分支、截图四态、`?reorder=` 预填、消息红点 | 七状态顾客视角走通；双机进度对照；越权负向；**新增 `selftest-order-lifecycle`（服务端 A~I）与 `selftest-order-customer`（端侧 A~G）** | 轮询与弱网；状态竞态 |
| **批 6** 兼职工作台（v3 清单 + 补全） | 批 5 | 工作台：服务端状态桶+站点过滤+行内 `actions[]` 单源（`view:'workbench'`）；四档动线排序在客户端零件层（`shared/order-view`，CONTRACT §5.2/TD-017）；行级接单/拒单/取件/送达/异常/改码/撤销；批量=客户端循环+同一 `batchActionId`（服务端落 `orders.batchActionId` 并形态闸）；部分失败保留失败选中+逐单原因+一键重试；撤销条（`order.undo` 仅取件/送达 5s、批量共享 id、部分失败文案）；状态筛选服务端化；30s 轮询行级 setData+游标分页；骨架屏/首用引导+兼职编号/已完结自然日分区；`order.unmarkPicked`/`order.unmarkDelivered`/`order.correct` 判据；CLOSED/SUSPENDED 读写下线闸；`order.reject.OTHER` 必填备注 | 真机跑站动线；批量部分失败如实；四档排序断言；CLOSED/SUSPENDED 用例；**新增 `selftest-order-partner`（服务端 A~H）、`selftest-order-workbench`（端侧 A~G）、`selftest-order-detail-partner`（详情 A~G）** | 批量部分失败；撤销并发；弱网轮询 |
| **批 7** 兼职客户与运营（**无费用模块，v0.7**） | 批 6 | 客户档案/详情/`partnerNote`/**顾客编号展示**；代客下单（**已绑定顾客走正常订单 `bindingId` + 新顾客 guest 两条路径，二者互斥、均不写 `bindings`**）；**单量统计（今日/本周/本月完成量、状态分布、异常/取消、完成率、近 7 日；无收入类字段；服务端聚合、排除测试数据）**；绑定卡片分享/解绑；`partner.listBindings`（**服务端搜索+自然序排序+游标分页+按顾客进行中单数**）、**新增 `partner.getCustomer`/`partner.stats` 只读动作**、`partner.unbindCustomer`（**进行中单按该顾客判定**）、`partner.saveCustomerNote`、`order.listPartner({view:'customer'})`（顾客维度历史单单一来源） | 代客单（绑定顾客）→ 顾客可见进度闭环；guest 单无顾客访问路径（`customerId=''`）；统计只含单量且排测试数据；绑定卡片只带 `partnerNo`；**新增 `selftest-partner-customers`（服务端 A~F）、`selftest-partner-orders`（服务端 A~G）、`selftest-partner-pages`（端侧 A~G）、`selftest-partner-stats`（端侧 A~F）**；`check.ps1` 4 步 0 | guest 单归属与后续认领衔接（本批不做认领）；绑定数百/单量扫描窗（TD-050）；统计时区/字段名漂移（已回写 `exception.at`） |
| **批 8** 开发者后台 + 切换会话 + 通知 + 隐私文本（v0.9） | 批 7 | **`pkg-admin` 11 页**（overview/invite-codes/customers/customer-detail/partners/orders/order-detail/config/**account-switch**/messages/**recognition-review**）；`admin.*` 全量（含 **v0.8 复核四动作** + **v0.9 测试账号四动作**）+ 后台脱敏 DTO（**无 `avatarFileId`、昵称脱敏、默认排除测试数据**）；**`admin.viewAsStart/End` 两模式 + `switch-session` + 黄条/蓝条/TEST 角标 + READONLY 拒写 + TEST_WRITE 白名单 + `cleanup.viewSessions` + `cleanup.testData`**；`cleanup.*` 其余任务 + 单定时触发器；消息中心聚合/已读水位/红点（含识别失败红点）；公告；**`docs/privacy/` 头像/昵称/账号切换/第三方 AI 文本定稿** | 发码→激活；邀请码批次/作废/过期；**开发者负向（非白名单 admin/他人票据/过期/模式篡改/测试会话调禁用动作）**；后台脱敏截图；READONLY/TEST_WRITE 三 tab+条+角标+退出+审计；**测试账号：新建→验收→dryRun→删除/purge→审计**；复核：原图→审计→补录回填→忽略→cleanup 到期；cleanup 时间旅行与重跑幂等 | 越权类高风险（M12/M13/M17/M18~M22）；测试数据隔离；10 分钟轮询成本；原图滥用 |
| **批 9** 联调、合规与发布 | 批 8 | **工程侧已交付（2026-10-22）**：注销/数据删除链路端到端判据 `tools/selftest-deletion.js`（顾客 handler+两阶段 cleanup+兼职 CLOSED+端侧静态，89 断言；先判据后修 14 条真实缺陷：多源 PII 漏清/`partners` 匿名化/头像文件/邀请码 `usedBy`/识别失败原图引用）；**审核材料与提审体验路径手册** `docs/V4_REVIEW_MATERIALS.md`（前置清单/分角色体验/审核说明模板/驳回应对/证据留存）；**v3→v4 功能对照验收表** `docs/V4_V3_PARITY.md`（5 页/19 能力/12+6 教训对照+剩余项+用户勾选栏）；**灰度发布与回滚演练**（RUNBOOK §10 分批策略/门禁回执/观测判停/演练 R1~R7/记录表）；QA 批 9 专项 H12~H17 与 E15/P6/P18 注销链路强化；全链路零金额扫描与门禁终态复核 | `tools/selftest.js` **28 套全 PASS**（含新套件）、`check.ps1` 4 步 0、零金额 0 命中、`gate.ps1` 绿 + 真实输出回读；**用户侧仍待**：`docs/QA_CHECKLIST.md` 人点检全绿（批 9 附录 B 与 H12~H17、§R 与 v0.9 各节）、双端真机全场景/越权/隐私/性能/弱网、后台与切换会话回归面检、识别兜底与复核面检、隐私后台声明与 13 项填写、灰度与回滚演练（§10.6 记录）、提审记录 | D13 类目；审核周期；回滚演练；DeepSeek 条款/审核；测试数据残留 |
| **批 10** 用户裁决第二批（C→B→A） | 批 9 | **C 批（D23~D26）**：`orders` v1.0 一单多包裹（`parcels[]`/`images[]`/`manualEntry`/`delivery`）、`order.create` 单入口+合并窗口（`config.orderMergeWindowMinutes` 默认 10/0=关闭）+`PARCELS_APPENDED`、`createBatch` 已移除（未登记动作 → `FORBIDDEN`「不支持的操作」）、`order.correct(itemIndex)`/`imageUrl(index)`、顾客端多图批量/无截图手填/每单配送地址/取件清单页、兼职端多包裹展示与逐件纠错、后台/清理多图引用与无截图标记、`NO_TEXT` 必入队修复；**B 批（D28/D29，已实现提交 `62da7f3`）**：换绑一体化（`utils/rebind.js` + bind 页一次确认 `release`→`create`、单步恢复）、状态事件计入未读红点（`unread`=留言+事件、`markRead` 事务 CAS、`ALL` 置读）、AI 低置信不写入（建议条+采纳）；**性能 P0-1~P0-11**（启动并行化/config 预热/router 域懒加载/整表 setData 收口/预下载/超时/定时器/OCR 降采样与截图压缩）；**审查修复** M-01 双角色、M-02 识别失败 FIXED 清理、M-10/M-11 后台列表服务端分页与前缀搜索、工具链 M-43/44/45/46/57 等 | `check.ps1` 4 步 0（check.js **32** 条含 #32 函数行数；check-docs 10 项；零金额 0 命中；selftest **31 套 4,660** 断言含 cloud-dual/performance/tools 全 PASS；check-functions 违规 0；sync 32 件 hash 一致）；`gate.ps1` 绿 + 真实输出；变异/首红证据按各任务报告 | 并行写冲突与共享冻结面；v1.0 破坏式升级（依赖 D11 空库起）；真机项（预下载/压缩/多包裹 UI/红点打扰度）只能用户点检 |

**v0.9 批次调整**：账号切换/测试账号/头像采集**前移批 2**（单机验收不再依赖额外微信号）；绑定方向守卫与 roomTag 大写**落批 3**；后台切换会话、测试账号管理与隐私文本定稿**落批 8**；QA 清单 v0.9 点检项随批 9 收口。

**每批纪律**：范围四禁；DoD = `check.ps1` 0 + 真实输出（含零金额 0 命中 + AI 门禁 #24~#27 + v0.9 门禁 #28~#31）+ 本批验收逐条打勾；CHANGELOG「未发布」+ 回写义务（§8.6）；新增导出必须有生产调用或登记 TECH_DEBT；真机项只能用户点检、agent 不代宣布。

---
## 12. 未取证与风险清单

| # | 风险/未取证 | 影响 | 缓解/取证动作 | 批次 |
| :-- | :-- | :-- | :-- | :-- |
| R1 | 云环境是否已开通、appid 是否可用（D1/D2；D1 修订=**单环境**：账号只能开 1 个，无 dev/prod 两套库） | 阻塞批 1 | 开工门确认 + RUNBOOK 记录 envId + 单环境清零清单（RUNBOOK §10.2.1） | 0/1 |
| R2 | 云存储安全规则能否支持"仅创建者可写、不可读"且 `wx.cloud.uploadFile` 可用 | 上传链路/隐私 | 批 1 真机实测；不可行则改云函数代理上传（≤500KB）并登记 | 1/4 |
| R3 | VisionKit 在顾客机型真实吐字（v3 未取证） | 识别体验 | 保留手填兜底；真机取证后再扩规则（无样本不加规则） | 4 |
| R4 | 云函数冷启动/弱网/超时 | 下单/刷新等待 | 加载态、读重试、写幂等、关键页预拉取；真机实测 | 4/5 |
| R5 | 截图含姓名/手机号/地址 | 合规/信任 | 压缩、私有存储、7 天删除、日志脱敏、后台默认脱敏 | 4/8 |
| R6 | 订阅消息模板审批（P1） | 通知体验 | 站内轮询兜底；模板 ID/开关/文案进 config，不进环境变量 | 9 |
| R7 | 兼职数据隔离漏洞 | 严重信任问题 | 服务端过滤 + 越权矩阵 + M1/M7 变异 | 3~8 |
| R8 | 双端并发状态冲突 | 状态错乱 | 合法转移表 + `version` 乐观锁 + 幂等 + 刷新提示 | 5/6 |
| R9 | 校园运营/校方/驿站要求 | 上线风险 | 用户线下确认；工具定位不承诺快递经营 | 9 |
| R10 | **邀请码**外泄/滥用 | 未授权访问 | 一次性/有效期/作废/限流/审计/批次追溯；禁硬编码 | 2/8 |
| R11 | v3 老用户数据迁移期望 | 用户困惑 | 明确 v4 空库起；如需导入另立项（D11） | 9 |
| R12 | 真机项只能人做 | 验收延迟 | 先出 QA_CHECKLIST 按批点检 | 全程 |
| R13 | 云开发配额/计费（调用/存储/数据库读写） | 成本/中断 | 上线前按真实单量估算并记 RUNBOOK；控制台告警 | 9 |
| R14 | 环境变量/触发器/索引仅控制台可配，未在仓库固化；基础库/自定义 tabBar 兼容 | 环境漂移/真机白屏 | 全部步骤写 RUNBOOK + 截图；`admin.bootstrap` 幂等复建 config；固定实测版本并真机回归（check.js #10 兜底结构） | 1/2/8 |
| R15/R16（v0.7；v0.9 扩） | 切换会话票据泄露/重放/提权（含 TEST_WRITE 模式篡改）；编号碰撞/唯一索引漏建/客户端伪造编号 | 越权读 L3/数据错乱/冒认 | 票据：32 位随机 + 单活 + TTL(5~60) + 不落盘 + 每请求校验发起人 + 不得调 admin + M12 变异 + 审计留痕。编号：`crypto` 生成 + 唯一索引 + 重试 ≤5 + `DEPENDENCY_FAILED` + `admin.bootstrap` 校验索引 + 服务端不信任客户端编号 + M9 变异 | 1/2/8/9 |
| R17~R19（v0.7） | 后台脱敏失效/开发者越权看完整 L3；零金额口径回潮；开发者账号误当业务账号/白名单误配 | 隐私事故/违反用户硬口径/权限风险 | 脱敏 `dto/mask.js` 单一出口（无 full 变体、**无 avatarFileId、昵称脱敏**）+ M13；零金额 #22/#7 + 白名单精确登记 + 每批 DoD + M14；白名单只存环境变量、开发者默认不建顾客/不激活兼职、**真实操作走测试账号（默认单机）或额外微信号（可选）** | 1/8/9/全程 |
| R20~R22（v0.8） | DeepSeek 可用性/服务条款/地区与用途合规/审核（第三方 AI 声明）；外发文本去敏不彻底或 Key 误入客户端；复核页原图滥用/审计缺失 | 兜底失效/隐私事故/审核被拒 | 开关+Key 缺失即降级、超时/重试/熔断/配额、失败必入队（#26）；payload 白名单 + 二次去敏 + Key 只存环境变量（#24/#25 + M15）；原图临时 URL 5 分钟 + 逐次审计 + 不可批量（#27 + M17）+ 保留期可配；上线前用户确认 DeepSeek 账号与条款（E11）、隐私指引声明后再提审 | 4/8/9 |
| R23（v0.9） | **测试账号越权/测试数据混入真实**：TEST_WRITE 目标非测试账号、票据挪用/模式篡改、`isTest` 漏标、统计/红点/邀请码/搜索混入测试数据、删除时误删真实数据 | 真实经营数据被污染/越权写 | 签发处断言 `isTestAccount` + 票据交叉校验（targetId/targetIsTest/impersonatedBy）；`orders.isTest` 服务端派生 + `impersonatedBy` 落库；统计/红点查询强制过滤（M20）；delete/purge 双条件 + dryRun + 真实引用即拒绝 + 前后条数审计；检查 #30 + selftest-switch/testaccount | 2/8/9 |
| R24（v0.9） | **头像外泄与缓存**：`avatarFileId` 进后台/日志/卡片、头像路径含 openid 可枚举、旧头像未删、临时 URL 缓存导致换头像后仍显示旧图、解绑后仍展示对方头像昵称 | 隐私事故/体验不一致 | 路径 `avatars/{role}/{random}.jpg`（无 openid）+ ticket 归属校验；DTO 分级（仅本人/绑定对方）+ 后台 DTO 零 `avatarFileId` + 昵称脱敏；替换/注销/删测试账号删文件 + cleanup 兜底；临时 URL 不缓存、store 失联即清绑定摘要；检查 #29 + M21 | 2/8/9 |

---
## 13. 待裁决项（v1.0：D1~D26、D28~D29 已闭环，D27 定位方案待裁决；工程侧仅余平台实测 E5/E12 与 E11 用户确认）

**继承 CONTRACT §13（D1~D26、D28~D29，2026-10-22 全部闭环；D27 待裁决；D22 已改判 B→D24）**：D1 云开发、D2 appid（**沿用 v3 `wxcb7e5b41b89bc806`**）、D3 邀请码、D4 一顾客一兼职、D5 服务只分类型（**已定：无定价**）、D6 **零金钱交易（已定）**、D7 roomTag（**v0.9 恒大写**）、**D8 苑名=东苑/西苑/南苑/北苑/翠苑**、D9 截图、D10 通知、D11 不迁移、D12 代客单（**不产生绑定**）、**D13 主体/类目=个人主体+工具类目**、**D14 开发者只读视角**、**D15 双角色编号样式（C+8 / P+6 / DEV-01）**、**D16 OCR 失败用 DeepSeek 兜底**、**D17 识别失败原图在开发者复核页可见**、**D18 账号切换（真实账号只读 + 测试账号可写）**、**D19 头像/昵称采集与可见范围**、**D20 绑定方向（只能顾客发起）**、**D21 roomTag 恒大写**、**D22 → D24 无截图手填（改判 B）**、**D23 批量下单+合并窗口（一单多包裹）**、**D24 无截图手填**、**D25 每单配送地址**、**D26 顾客取件清单**、**D28 换绑一体化**、**D29 状态事件计入未读红点 + AI 低置信不写入**。

**已关闭（CONTRACT v0.5/v0.6/v0.7 裁决、v0.8 复核；由 `tools/check-docs.js` 持续验证）**
| # | 原缺口 | 落点 / 关闭依据 |
| :-- | :-- | :-- |
| E1 | DATA_MODEL 与 CONTRACT 命名/字段漂移 | DATA_MODEL 按 CONTRACT 重写（action/集合/字段/编号逐字）；check-docs #3/#4/#8 双向对帐 |
| E2 | 包络/错误码两套口径 | 定稿 flat 包络 + **13 码唯一集**；旧码→新码映射见 §4.4；check.js #20 双向校验 |
| E3 | 动作表缺隐私/注销/已读/软删/配置/健康检查 | CONTRACT §5.3 已补全；v0.7 再补 `admin.createInvites/revokeInvite/listInvites/listCustomers/getCustomer/listOrders/getOrder/listAudit/viewAsStart/viewAsEnd`；§4.2a 已接入 |
| E4 | 批量取件/送达语义不定 | **无专用 batch 云函数**，客户端循环 + 同一 `batchActionId` 逐单返回；`order.createBatch` 仅一图多码原子建单；§4.2b 已更新 |
| E6 | `upload.prepare` 的 `draftId` 防刷口径 | ticket 一次性 + `counters.rl:*` 配额；实现落 §4.5/§4.7 |
| E8 | cleanup 多触发器 vs 单触发器 | **单定时触发器每 10 分钟**、按到期条件幂等执行全部任务；§4.7 已改 |
| E9/E10 | 响应 `requestId` + `config` 刷新 | 包络含可选 `requestId`；`config.getPublic` 返回公开子集，刷新走 getPublic；§4.3/§4.2a 已改 |
**v0.6 一致性修复（已回写，不再是缺口）**：`admin.bootstrap`（internal）/`bind.getCurrent`（client）登记；订阅消息模板 ID/开关/文案进 `config`；截图路径统一 `orders/{ticket}/image.jpg`；邀请码错误映射；`acceptingOrders` 在 `serviceConfig` 且关闭 ⇒ `PARTNER_CLOSED`；`config.getPublic` 返回 screenshotRetentionDays/orderTimeoutMinutes/autoCompleteHours/privacyVersion；列表 DTO 分级；EXCEPTION 顾客取消条件；check-docs 批 0 豁免；隐私级别统一 L1~L3（**v0.9：头像/昵称采集口径见 §4.12，旧头像声明作废**）。

**v0.7 新增落地（设计定稿，非缺口）**：①零金额——删全链路费用语义 + 新增扫描门禁（§7.6/#22/#7）；②双角色编号——`utils/ids.js` + 云端生成 + 唯一索引 + 碰撞重试 + `customerNo/partnerNo/developerNo`（§3.1/§4.5/§5.3）；③开发者账号——邀请码（`invitation_codes` + `INVITE_*` 错误码 + cleanup）、后台 10 页（v0.8 增复核页共 11 页）+ 脱敏 DTO、只读视角（v0.9 升级为切换会话：票据/中间件/双条/TEST 角标/拒写白名单/审计/cleanup）（§4.8/§4.9/§5.5）。落点：§1.2/§2.1/§3.4/§4.2~§4.9/§5.1~§5.8/§7/§8/§11。

**v0.8 新增落地（设计定稿，非缺口）**：①识别兜底——`ai.parseParcel` 唯一外呼 + `lib/ai/`（deepseek/prompt/parse/payload）+ `config.aiFallback` + `DEEPSEEK_API_KEY`；②失败复核——`recognition_failures`（第 14 号集合）+ 后台复核页 + 四动作 + `cleanup.recognitionFailures`；③门禁——#24~#27 + check-docs #9；④隐私——第三方 AI 披露与复核原图例外（CONTRACT §11.2/§1.1）。落点：§0/§1.1/§1.2/§2/§3.2/§3.4/§3.6/§4.2~§4.10/§5.4/§5.7/§7/§8/§9/§10/§11/§12（QA 清单同步 §R）。
**v0.9 新增落地（设计定稿，非缺口）**：①绑定方向——`bind.create` 角色守卫 + 兼职端零入口 + 代客单不写 `bindings` + 真实×测试拒绝（#28）；②账号切换——`viewMode=READONLY|TEST_WRITE`、`switch-session` 中间件、`effectiveOpenid` 传播、`ACCOUNT_SWITCH_*` 审计、`cleanup.viewSessions`；③测试账号——合成 `openid='TEST-<random>'`、四动作（create/list/delete/purge）、`isTest`/`impersonatedBy`、统计排除、`cleanup.testData`（#30）；④头像/昵称——AVATAR ticket（`avatars/{role}/{random}.jpg`，无 openid）、≤200KB、替换删旧、昵称 `msgSecCheck` + ≤20 字、默认头像（#29）；⑤roomTag 大写——`utils/room-tag.js` + `lib/tag-allocator`（#29 含校验）；⑥视觉——黄条/蓝条/TEST 角标（#31）。落点：§0/§1/§2/§3.2/§3.5/§3.6/§4.2~§4.12/§5/§6/§7/§8/§9/§10/§11/§12（QA 清单同步 v0.9 节）。

**仍开放（E5/E12 平台实测、E11 用户确认）**
| # | 缺口/冲突 | 影响 | 建议 | 需谁裁 |
| :-- | :-- | :-- | :-- | :-- |
| E5 | 云存储安全规则具体可选项（仅创建者读写/自定义规则）与三分包是否独立 | 上传链/共享代码策略 | 批 1 真机实测后回填本文 §3.5/§2.3；默认三分包非独立 | lead + 用户实测 |
| E11 | DeepSeek 账号/服务条款/地区与用途合规（谁注册、配额与计费方式、是否允许本场景）；`DEEPSEEK_API_KEY` 由用户配置进云函数环境变量 | 兜底不能上线/审核被拒 | 上线前由用户确认并写入 `docs/RUNBOOK.md`；未确认前保持 `aiFallback.enabled=false`（兜底降级路径可先上线） | 用户 + lead |
| E12 | **头像/昵称隐私接口与基础库能力**（`chooseAvatar` 按钮/`nickname` 输入/隐私弹窗在目标基础库与审核环境的行为；真机压缩到 ≤200KB；多开发者白名单 `DEV-02…` 实测） | 头像/昵称采集可能降级 | 批 2 真机实测后回填 §4.12/§5.4；不可用则头像保持默认头像、昵称手填（不阻断上线） | lead + 用户实测 |

---
## 附录 A · 命令速查（PS 5.1 可执行）
```powershell
# 收工闸（唯一"完成"定义：退出码 0 + 真实输出）
powershell -File check.ps1

# 单跑
node tools/check.js
node tools/check-docs.js --batch 0   # 批 0；批 ≥1 传 --batch 1（不再豁免）
node tools/selftest.js
node tools/selftest-ai.js             # v0.8 识别兜底纯件/适配层（注入 fetch 替身）
node tools/selftest-cloud.js
node tools/selftest-bind.js            # v0.9 绑定方向/角色/真实×测试互斥
node tools/selftest-profile.js         # v0.9 昵称截断 + 头像 payload 白名单
node tools/selftest-switch.js          # v0.9 票据解析/写权限/统计排除
node tools/selftest-testaccount.js     # v0.9 测试账号上限/dryRun/级联删除

# 零金额扫描（三范围；命中行会打印 file:line）
node tools/zero-money-scan.js --scope all

# 取数（不写死条数）
node tools/selftest.js | Select-Object -Last 2
node tools/selftest-ai.js | Select-Object -Last 2
node tools/selftest-cloud.js | Select-Object -Last 2
node tools/selftest-bind.js | Select-Object -Last 2
node tools/selftest-switch.js | Select-Object -Last 2

# 每批门禁（锚点=本批真实前驱；ScopeFiles 传单个逗号串）
powershell -File gate.ps1 -Anchor <起点哈希> -ScopeFiles "cloudfunctions/,shared/,pages/,pkg-partner/,pkg-admin/,utils/ids.js,utils/room-tag.js" -Estimate 600

# 环境自检
powershell -File doctor.ps1

# 云函数共享代码同步（上传前必跑；含 utils/ids.js → shared/ids.js、utils/room-tag.js → shared/room-tag.js）
node tools/sync-cloud-shared.js

# 变异电池（安全判据；M9 编号 / M12 会话写 / M13 脱敏 / M14 零金额 / M15 外发白名单 / M16 失败入队 / M17 原图审计 / M18 绑定方向 / M19 只读拒写 / M20 测试数据 / M21 头像昵称 / M22 roomTag）
powershell -File tools/mutation.ps1 -Case M12
powershell -File tools/mutation.ps1 -Case M18
powershell -File tools/mutation.ps1 -Case M19
```
## 附录 B · 一句话记住十四条（工程版）
1. 业务判据只在云函数与 `shared/` 纯件；页面零判据。
2. 客户端只经 `api/` 出网；DB 安全规则对客户端全拒。
3. 身份只来自 `OPENID`（或票据解析出的 `effectiveOpenid`）；客户端传的 id/编号只当查询条件。
4. 写动作必传 `clientRequestId`；订单用 `requestKey`、事件用 `event.requestKey` 唯一幂等。
5. 状态七态 + 合法转移表 + `version` 乐观锁；非法一律 `INVALID_TRANSITION`。
6. 编号与 roomTag 只由云端生成/分配、唯一索引兜底、客户端只校验与展示；roomTag 恒大写。
7. 本程序不涉及任何费用收付；零金额扫描 0 命中是每批硬门。
8. 不建客户端 wx mock；纯件直测 + fake DB + 真机点检。
9. 共享代码复制 + hash 门禁；门禁先于用户发现错误；没有汇总输出 = 读数作废。
10. 真机/发布/授权只能人做；agent 只出草案与证据。
11. AI 兜底只在云函数外呼、Key 只在环境变量；只发去敏文本、失败必入队、超限静默降级。
12. 原图只在复核页临时可见且每次审计；复核只回填识别字段，AI 只做预填、不覆盖手填。
13. 绑定只能顾客发起；真实账号只读、测试账号可写，测试数据永不混入统计与真实页面。
14. 头像/昵称仅绑定双方可见、默认头像兜底；后台/卡片/通知不展示，注销与替换即删文件。
