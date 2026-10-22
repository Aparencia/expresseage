> 本条由 AI 生成（代码审查）

# 2026-10-22 · A1 后端核心（cloudfunctions/api 核心域）代码审查 part

- 审查对象：HEAD `9031d14cfc88b0cd8b03527da00ccc1f70a3e635`（全量新增等价基线 = 空树 `4b825dc642cb6eb9a060e54bf8d69288fbee4904`）
- 审查人：review-backend-core（阶段 1 · 标准轴 A1）
- 执行手册：`docs/reviews/_parts/_REVIEW_BRIEF.md`；状态源：`STATE.md`；口径源：`docs/V4_CONTRACT.md` + `docs/V4_DATA_MODEL.md` + `docs/ARCHITECTURE.md`（分层/冻结接口）+ `docs/V4_ENGINEERING.md`（工程/门禁/代码硬标准）
- 唯一写 = 本文件；未改任何代码/配置/测试，未执行 git 写操作（无 add/commit/checkout/stash/reset/tag），未运行 `check.ps1`/`gate.ps1`/`tools/selftest.js`，未派子代理。自检只运行了 Lead 指定的文档门禁两条（`check-docs`/`zero-money-scan`）与只读扫描/探针。
- 门禁补充纪律已执行：D 编号只引用 D1~D22（本文件未引用新的 D）；E 编号 ≤E18；取代废弃正则中的待办标记按 `TO\x44O[:：]` 转义写法；零金额词表敏感词已规避（个别引用口径句做等价改写并标注）。

---

## 0. 派单输入单

- **DESCRIPTION**（task-4）：按 `docs/reviews/_parts/_REVIEW_BRIEF.md` 执行标准轴阶段 1 审查。范围：`cloudfunctions/api/{index,app,router,bootstrap}.js`、`cloudfunctions/api/db/**`、`middleware/**`、`lib/**`、`handlers/{order,message,ai,partner,customer,user,bind,upload,config,health}/**`（约 9.5k 行，实测 93 文件 / 9,626 物理行）。七维逐条给结论 + 条件维 9/11；覆盖地图逐文件；问题清单 P0~P3 每条带证据三件套；安全发现给「入口→传播→终点」三处 `文件:行` 并标"待独立复核"。先查 TECH_DEBT/lessons/STATE 风险避免重复。只读代码，不改任何代码；只写本文件。
- **PLAN_OR_REQUIREMENTS**：`docs/V4_CONTRACT.md`（唯一口径）+ `docs/V4_DATA_MODEL.md` + `docs/V4_UX_CUSTOMER.md`/`docs/V4_UX_PARTNER.md`/`docs/V4_UX_DEVELOPER.md` + `docs/ARCHITECTURE.md` + `docs/V4_ENGINEERING.md`；运行态对照 `STATE.md`、`docs/TECH_DEBT.md`、`docs/lessons/`。
- **BASE_SHA**：`4b825dc642cb6eb9a060e54bf8d69288fbee4904`（全量新增等价基线）
- **HEAD_SHA**：`9031d14cfc88b0cd8b03527da00ccc1f70a3e635`
- **范围（含 93 个 js 文件）**：
  - 入口层：`index.js` / `app.js` / `router.js` / `bootstrap.js`；
  - `db/**`：`dao.js`、`collections.js`、`config.js`、`dto/{full,mask}.js`；
  - `middleware/**`：`index/auth/switch-session/guard-bind/validate/ratelimit/idempotency/audit`；
  - `lib/**`：`errors/respond/time/id-generator/tag-allocator/tx`、`lib/ai/{deepseek,parse,payload,prompt}`；
  - `handlers/order/**`（25 文件，含 `_create/_dto/_store/_parcel/_common` + 19 个动作 + index）、`handlers/message/**`（5）、`handlers/ai/**`（3）、`handlers/partner/**`（11）、`handlers/customer/**`（3）、`handlers/user/**`（5）、`handlers/bind/**`（6）、`handlers/upload/**`（4）、`handlers/config/**`（3）、`handlers/health/**`（1）。
- **不在范围**：`cloudfunctions/api/shared/**`（同步副本，A2 主审；本 part 只作为依赖读其接口）、`handlers/admin/**` 与 `cloudfunctions/cleanup/**`（A2）、前端（B1/B2）、`tools/**`（C）。
- **门禁基线（Lead 实跑，本 part 引用不自跑）**：node v24.21.0；`node tools/check.js` 31/31 PASS（exit 0）；`node tools/check-docs.js --batch 1` 10/10 PASS（exit 0）；`node tools/zero-money-scan.js` 0 命中（exit 0）。机械门禁已覆盖项（行数格式/action 注册表/错误码/集合名/零金额/克隆副本 hash）不重复报违规，只报门禁漏检（见 R-A1-17）。

## 1. 开工回执（九项）

### 1.1 人话复述与落点
本 part 审云函数 `api` 的"骨架 + 身份 + 订单 + 消息 + AI + 兼职/顾客/用户/绑定/上传/配置/健康"这一整块后端核心：入口装配（index→app→router→middleware→handlers→db/dao）是否接上、路由/注册/依赖注入是否一致、鉴权与切换会话（READONLY/TEST_WRITE）是否服务端说了算、订单多步写事务/幂等/乐观锁/状态机是否自洽、全量 DTO 与后台脱敏是否分级、AI 外呼是否只发去敏白名单、日志与隐私口径是否守住。产物 = 本文件；下一步 = Lead 按 `文件:行 + 一句话事实` 去重后汇总裁决，独立验证者从源码复核安全发现。

### 1.2 假设清单
1. 假设 Lead 实跑门禁读数可引用（简报 §0：`check.js` 31/31、`check-docs` 10/10、零金额 0 命中、node v24.21.0）；**若错**则本文件"门禁已覆盖/通过"类结论失效，只保留人工审读结论。
2. 假设本 part 范围 = task-4 列出的 93 个文件（不含 `shared/**`、`handlers/admin/**`、`cleanup/**`）；**若错**（Lead 意图含 admin）则 admin 域的 DTO 脱敏/审计结论缺席，需 A2 覆盖。
3. 假设运行时探针（§1.5 E2/E3/E4，fake DB 注入）只证明"代码分支行为"，不证明真实云 DB 写入语义（fake DB 差异见 ENGINEERING §7.3 / TD-015）；**若错**（fake DB 与真实语义偏差更大），E2~E4 的结论仍以源码分支为准，探针只作佐证。
4. 假设 ARCHITECTURE §4.1（L157）「双角色口径（Lead 冻结）」仍是有效口径；**若错**（该冻结已被后续裁决撤销），R-A1-01 从"违反冻结口径"降为"待产品裁决的功能缺口"。
5. 假设微信 `security.msgSecCheck` v2 的平台参数要求（`openid`/`scene`）以官方平台文档为准；**若错**（平台允许缺省），R-A1-02 的影响降级为"参数不一致/口径风险"，不构成生产故障。
6. 假设本 part 期间无他人改动工作树（`git status` 仅有本轮新增 `docs/research/`、`docs/reviews/` 未跟踪目录）；**若错**，我读到的 HEAD 内容与实际交付不一致，需按 HEAD 重跑关键证据。
7. 假设"建议色/严重级"只给建议（简报 §3.7：审查者只给建议色，裁决是人）；**若错**以 Lead 聚合口径为准。

### 1.3 澄清问题
- 本仓无 `docs/registry/APIS.md` / `registry/DATA_DICT.md`（ENGINEERING E7 已裁）→ 按简报 §1 写 **N/A + 原因**：接口契约唯一源 = `docs/V4_DATA_MODEL.md` §7；action 注册表 = `cloudfunctions/api/shared/actions.js`；错误码 = `shared/error-codes.js`。
- 零金额词表敏感词（简报维度 2 的"计价精度"一句）按 Lead 门禁补充纪律做等价改写（写作"计价精度（本仓零金额）"），语义不变。
- 发现中的"文档漂移"（R-A1-12）涉及 `docs/ARCHITECTURE.md`/`docs/V4_DATA_MODEL.md` 冻结文档回写，本 part 只记录，改动由 Lead 授权单写者执行。

### 1.4 锚点校验
```powershell
git -C D:\Code\expressage_college_v4 rev-parse HEAD
# 9031d14cfc88b0cd8b03527da00ccc1f70a3e635
git -C D:\Code\expressage_college_v4 status --porcelain
# ?? docs/research/      ?? docs/reviews/        （本轮审查新增的未跟踪目录，其余干净）
Select-String -Path D:\Code\expressage_college_v4\STATE.md -Pattern '起点锚点' | Measure-Object -ExpandProperty Count
# 0        （与简报 §0 一致：STATE 无「起点锚点」字段）
node --version
# v24.21.0
```
→ 按简报 §0 以 HEAD 全量新增为基线，不追问锚点（命令原文+输出如上，退出码 0）。

### 1.5 diff 读取确认（全量新增基线）
- **已读范围**：§0 范围的 **93 个 js 文件逐文件整文件读取**（行数清单见 §2.1/§2.2；物理行合计 9,626，口径 = `content.split('\n').length - 1`，含注释与空行）。高风险文件（`order/_create` 499 行、`_dto` 434、`_store` 377、`_parcel` 320、`_common` 227、`middleware/auth` 144、`switch-session` 221、`idempotency` 66、`db/dao` 189、`lib/id-generator` 153、`lib/tx` 48、`lib/ai/deepseek` 308、`parse` 245、`payload` 85、`prompt` 91、`message/_common` 293、`partner/_customer` 478、`user/_common` 231、`bind/_common` 157、`upload/_common` 96）全部整文件读。
- **机械扫描覆盖**（本次实跑，退出码均 0；下称 `E#`，结果摘要见各问题"证据"栏）：
  - `E1` 装配与注册表：全量 require 探针经 `app.createApi→router.getRouter()` 加载 11 个域全部 handler 成功；`node -e "…CLIENT_ACTIONS.length"` → `66`（client 动作数）。
  - `E2` 运行时探针 A（双角色）：node stdin 注入 fake DB，调用 `order.listCustomer/order.get/order.accept/user.bootstrap` → 见 R-A1-01 证据。
  - `E3` 运行时探针 B（templateCode）：node stdin 注入 fake DB，`message.send` 带客户端 `templateCode:'BIND_RELEASED'` 后由对方 `message.list` 观察 → 见 R-A1-03 证据。
  - `E4` 运行时探针 C（契约键）：`config.getPublic` 返回键集 = 契约 11 键齐全、无 `aiFallback`、serviceCatalog 无交易类键；`user.bootstrap` 平铺 10 键齐全且键集无 openid/_id/customerId/partnerId → 见 §4.3。
  - `E5` 铁律扫描：`Select-String -Pattern 'db\.collection|wx\.cloud|callFunction|Math\.random|eval\(' …` → **0 命中**（仅 `db/dao.js` 内出现 `collection` 取值）。
  - `E6` 取代废弃扫描：`Select-String -Pattern '_old\b|_legacy|_v2\b|Deprecated|暂时保留|废弃|TO\x44O[:：]\s*(删|remove|delete)' …` → **0 命中**（空输出）。
  - `E7` 无界查询扫描（node 括号配平）：`dao.find` 共 20 处，**缺 `limit` = 0**；`count(... {where:{}})` 仅 1 处（`health/index.js:8` 的配置单文档集合，按 §5.3 口径可接受）。
  - `E8` 精确行数：93 文件、最大 `handlers/order/_create.js` 499 行；源码 >500 行 = **0**（`_customer.js` 478、`_dto.js` 434 均在限内）。
  - `E9` 死导出扫描（node：对每个 module.exports 导出名做全仓引用计数）→ 63 个"仓内零外部引用"导出（其中多为测试接口面）；另定位 11 个"连模块内也零引用"的死代码 → 见 R-A1-08。
  - `E10` 内容安全调用形状：`Select-String -Pattern 'msgSecCheck' …` → 3 种不同参数形状（`user/_common` 四键全、`message/_common` 缺两键、`admin/_test-accounts` 仅 content）→ 见 R-A1-02（admin 侧属 A2，仅作对照）。
  - `E11` 错误码扫描：`Select-String -Pattern "code:\s*'|new AppError\(" …` → 仅 `lib/errors.js:33` 构造与 `index.js:14` 的 `INTERNAL_ERROR`（13 码注册表内），**无自造码**。
  - `E12` 零交易语义：`node tools/zero-money-scan.js --scope source`（Lead 词表单源）→ 0 命中（A1 文件无命中）。
  - `E13` 云函数日志：`Select-String -Pattern 'console\.(log|error|warn|info|debug)' …` → 20 处，参数只含字面量/`requestId`/`action`/耗时/`action`/错误序列化，**未见 L3 值**（残余风险见"依据未复现"#2）。
  - `E14` 备注校验器定位：`Select-String -Pattern 'normalizeOrderNote|validateNote|validateDeliveryNote|validateCancelNote|validatePartnerNote|validateDisplayName' …` → 5 处只有长度/字符集校验、无 `msgSecCheck` → 见 R-A1-04。
  - `E15` 死分支/死属性定位：`Select-String -Pattern 'scope\.targetId|aborted \?' …` → 见 R-A1-09。
  - `E16` 长函数扫描（node 花括号配平）：**15 个函数 >50 行**（最长 `customer/saveProfile.handler` 154 行、`lib/ai/deepseek.createDeepSeekClient` 130、`order/_common.runOrderAction` 117、`db/dao.createBody` 112）→ 见 R-A1-17。
  - `E17` 权威状态：`git rev-parse HEAD`/`git status --porcelain`/`Select-String -Path STATE.md -Pattern '起点锚点'`/`node --version` → 同 §1.4；`Select-String -Path STATE.md -Pattern '并行态|登记簿'` → **0 命中**（无并行态登记簿）。
  - `E18` 降标守卫命令（简报 §3.6 原文两条）：`Select-String -Path tools\*.js,tools\*.ps1 -Pattern '\.skip\(|\.only\(|eslint-disable|ts-ignore|ts-expect-error|noqa|SuppressWarnings'` → **0 命中**；`Select-String -Path tools\*.js -Pattern '(max|limit|budget|threshold|tolerance|timeout|retries|coverage)\w*\s*[:=]\s*\d+'` → 71 命中（抽样 25 行均为 tools/tests 的夹具常量与断言值，非生产阈值放宽）。
- **未覆盖到的地方**：无 ○（93/93 逐文件读取并核对；探针只覆盖抽样动作，但动作分发/中间件链在探针中被整体加载）。

### 1.6 审查范围声明
只审派单范围及其直接关联调用。范围外发现只记录不展开：`handlers/admin/_test-accounts.js:40` 的 msgSecCheck 形状问题属 A2；`tools/check.js`/`tools/selftest-*` 的判据缺口属 C（R-A1-17 只给门禁漏检事实，判据改造交 C）；`shared/**`（order-state/order-view/enums/validate/defaults 等）本 part 只读作依赖，不判其问题。

### 1.7 旧报告
无（`docs/reviews/` 本轮新建）→ 旧问题三态 **N/A（无旧报告）**。

### 1.8 引用检查清单原文（执行依据，来源 `_REVIEW_BRIEF.md` §3；按 Lead 门禁纪律做词表规避）
> **七个固定维度**：1 接入性与装配（每个新增/修改符号有调用点吗；路由/注册/依赖注入接上了吗；三层链路 ①路由/挂载注册 ②入口可达 ③交互绑定 handler 链到业务逻辑，任一层断=P1；前后端加查请求/响应结构与 DATA_MODEL §7 契约一致；仓内路由 = app.json + router.js + shared/actions.js 三处一致）；2 逻辑性（空值/越界/并发重复提交/失败路径不是空 catch/入参校验；多步写事务边界；异步竞态与写接口幂等；时区与日期边界；计价精度（本仓零金额，命中即 P0 级红线））；3 牵连性（先赋值再搜；被修改符号的既有调用方兼容；被删符号零残留；四份文档需同步未同步：DATA_MODEL / CHANGELOG / TECH_DEBT / ARCHITECTURE）；4 性能（N+1 查询/无界查询（缺 LIMIT）/循环内 IO/大列表重复渲染/请求路径同步长任务/无索引 WHERE；资源泄漏）；5 冗余死代码（每个新增符号使用次数；复制粘贴只改名；永远真/假分支；疑似保留必须写理由）；6 开发规范（命名/注释 Why/类型安全/函数 >50 行、文件 >500 行（工具已强制的门禁项不重复报，除非门禁漏检）/提交信息格式/ENGINEERING §7 + AGENTS §4 六条硬标准）；7 安全（鉴权：前端隐藏≠后端校验，查水平越权；注入/参数化；XSS；CSRF（小程序无浏览器 CSRF，写 N/A+原因）；上传验类型大小/路径防 `../`；密码强哈希（本仓无密码，N/A+原因）；密钥硬编码/日志脱敏/CORS/debug/依赖漏洞（本仓云函数仅 `wx-server-sdk`，本机无 node_modules → 无法 audit，N/A+原因并核对 package.json/lockfile）；AI/agent 面（服务端 AI 外呼：工具参数 allowlist/三值策略/审计）；外部内容与凭据面（密钥/token 禁止回显明文）。安全四条硬规则：①每条给「入口→传播→终点」三处 `文件:行`；②`overall_severity ≤ impact.score`；③验证者身份分离——**本 part 只写"待独立复核"**；④格式缺字段直接作废）。
> **条件维（按触发启用，不适用写 N/A + 原因）**：⑧ UI 可访问性（本侧 N/A，无 UI）；⑨ 外部调用（本仓仅服务端 DeepSeek：适配层/显式超时/降级/重试）；⑩ 性能预算（热路径改动时；预算文件=ENGINEERING §2.3 体积预算；无预算 → 按维度 4 六类定性并标注"无预算基线"）；⑪ 数据隐私（订单/头像/昵称/宿舍：字段加密？日志脱敏/用途限定/注销清除）。
> **气味基线（≥6 行）**：长函数（超过 50/500/1000 行阈值）｜重复代码（同一段逻辑出现第 2 次）｜参数过多（>4 个）｜发散式变化（一个文件因多个不相关原因被改）｜霰弹式修改（一个改动要动 >3 个文件）｜命名不达意（读名字猜不出行为）。
> **严重级与建议色**：P0=崩溃/数据丢失/安全漏洞；P1=核心功能不可用（含装配断链）→ 二者必须清零；P2=边缘功能报错/体验不佳；P3=拼写/样式/非关键提示；不确定按 P2。建议色：🔴 红=P0≥1 或 P1≥1 或取代废弃命中；🟡 黄=P0=P1=0 且有 P2/P3；🟢 绿=P0=P1=0 且旧报告 P0/P1 全部核销（本轮 N/A）。**审查者只给建议色，裁决是人。**
> **取代与废弃检查（命中即红灯）**：①并行实现未删（旧文件/旧函数/旧分支/旧常量 + STATE 无登记行；合法保留仅灰度/兼容契约/证据留存三种，证据留存答案=git 历史）；②新增行命中 `_old\b|_legacy|_v2\b|Deprecated|暂时保留|废弃|TO\x44O[:：]\s*(删|remove|delete)`（正文与命令逐字同一正则）→ 必须写保留理由与删除条件，否则红灯。

### 1.9 派单输入单
同 §0（DESCRIPTION / PLAN_OR_REQUIREMENTS / BASE_SHA / HEAD_SHA 已抄录；范围边界见 §0 与 §1.6）。

---

## 2. 覆盖地图

图例：✓ 已审（整文件读取并核对口径）｜△ 关键面抽查｜— N/A（本侧无该口径）｜○ 未审（原因注明）。本 part **无 ○**（93/93 文件逐文件读取）。

### 2.1 高风险文件逐文件（7 维 + 条件维 9/11 + 说明）

| 文件 | 1 装配 | 2 逻辑 | 3 牵连 | 4 性能 | 5 冗余 | 6 规范 | 7 安全 | 9/11 | 说明 |
| :-- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-- |
| `index.js`（入口） | ✓ | ✓ | — | — | ✓ | ✓ | ✓ | — | 唯一 SDK 入口；装配异常也回 flat 包络（R-A1-10 日志面） |
| `app.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | 9— 11✓ | 解包/路由/链/handler/包络；部署分支仅 internal（见 §4.3） |
| `router.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | — | 11 域注册 + 启动双向断言（缺一失败关闭） |
| `bootstrap.js` | ✓ | ✓ | — | — | ✓ | ✓ | ✓ | — | cloud.init/getWXContext/deps 组装（R-A1-10） |
| `db/dao.js` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 11✓ | 唯一 db.collection；整值替换语义；条件更新能力存在（R-A1-05） |
| `db/config.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | 11✓ | 默认值单源（shared/defaults）；公开子集取自共享 |
| `db/collections.js` | ✓ | ✓ | — | — | ✓ | ✓ | ✓ | — | 未知集合直接抛错（不落库） |
| `db/dto/full.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | 11✓ | L3 仅本人/当前 ACTIVE 绑定；绑定前不回头像 |
| `db/dto/mask.js` | ✓ | ✓ | — | — | ✓ | ✓ | ✓ | 11✓ | 后台脱敏四函数；无"显示完整"变体 |
| `lib/errors.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | — | 13 码收敛；未知异常→INTERNAL_ERROR |
| `lib/respond.js` | ✓ | ✓ | — | — | ✓ | ✓ | ✓ | — | flat 包络；失败只回 code+人话 |
| `lib/time.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | — | — | UTC+8 自然日；空值兜底 `toMs`=TD-045（已知） |
| `lib/id-generator.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | — | crypto 拒采样 + 唯一索引重试；R-A1-07 首行并发 |
| `lib/tag-allocator.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | — | — | 事务内取号；R-A1-07/R-A1-08 |
| `lib/tx.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | — | — | 冲突判定依赖错误自述=TD-033（已知）；duplicate 不重试→R-A1-07 |
| `lib/ai/deepseek.js` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 9✓ | 唯一外呼出口；超时/重试/熔断/白名单（R-A1-09 死分支） |
| `lib/ai/parse.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | 9✓ | 模型输出不可信，逐字段形态闸 |
| `lib/ai/payload.js` | ✓ | ✓ | — | — | ✓ | ✓ | ✓ | 9✓ | 外发键 = `{ocrTextMasked,hintTrackingTail?,role}`；二次去敏 |
| `lib/ai/prompt.js` | ✓ | ✓ | — | — | ✓ | ✓ | ✓ | 9✓ | 站点表注入、只拼白名单数据 |
| `middleware/index.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | — | 链序 guard-bind 已接入（R-A1-12 文档漂移） |
| `middleware/auth.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | — | 开发者白名单/维护/隐私闸；**R-A1-01**（角色解析） |
| `middleware/switch-session.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | 11✓ | READONLY/TEST_WRITE 双校验/防票据挪用/过期审计 |
| `middleware/guard-bind.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | — | 绑定方向角色守卫（R-A1-01 关联：双角色过度拦截） |
| `middleware/validate.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | — | 写幂等键/expectedVersion 形态闸；R-A1-14（schema 面） |
| `middleware/ratelimit.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | — | 配额表与 CONTRACT §10 一致；R-A1-07 |
| `middleware/idempotency.js` | ✓ | ✓ | — | — | ✓ | ✓ | ✓ | — | 幂等键构造单源；R-A1-08（死导出） |
| `middleware/audit.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | 11✓ | 票据不当后台凭据；requestKey 幂等 |
| `handlers/order/_create.js` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 11✓ | 严格白名单/单事务原子/幂等回放；**R-A1-01/05/07/16** |
| `handlers/order/_dto.js` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 11✓ | 视图模型分级；admin 掩码；时间空值防御（TD-045 已防） |
| `handlers/order/_store.js` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 11✓ | 归属/测试隔离/票据；R-A1-09 死属性；R-A1-16 |
| `handlers/order/_parcel.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | — | 字段归一/服务范围/接单开关；R-A1-04 |
| `handlers/order/_common.js` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | 通用动作引擎；**R-A1-05**（乐观锁 TOCTOU） |
| `handlers/order/listPartner.js` | ✓ | ✓ | ✓ | ✓ | — | ✓ | ✓ | 11✓ | 只走 DTO；窗口降级=TD-043/044（已知） |
| `handlers/order/listCustomer.js` | ✓ | ✓ | ✓ | ✓ | — | ✓ | ✓ | 11✓ | counts 扫描窗=TD-040（已知） |
| `handlers/message/_common.js` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 11✓ | **R-A1-02**（msgSecCheck 形状）/R-A1-03/R-A1-13 |
| `handlers/message/list.js` | ✓ | ✓ | ✓ | ✓ | — | ✓ | ✓ | 11✓ | **R-A1-06**（N+1） |
| `handlers/message/send.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | — | **R-A1-03**（templateCode 入口） |
| `handlers/ai/_common.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | 9✓ 11✓ | 票据不拒绝只标记；配额；R-A1-07 首行并发 |
| `handlers/ai/parseParcel.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | 9✓ 11✓ | 降级 DTO 键集合固定；失败必入队 |
| `handlers/partner/_customer.js` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 11✓ | **R-A1-08**（TD-049 收敛残留死代码） |
| `handlers/partner/activate.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | — | 邀请码事务状态机 + 双角色 union（R-A1-01 触发源） |
| `handlers/customer/saveProfile.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | 11✓ | 首次生成编号/换宿舍事务；R-A1-01 触发源/R-A1-17 长函数 |
| `handlers/user/_common.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | 11✓ | 业务角色守卫（双角色回落正确 → R-A1-01 对照）；R-A1-02 对照 |
| `handlers/bind/_common.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | 11✓ | roomTag 事务/解绑通知；R-A1-13 |
| `handlers/upload/_common.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | 11✓ | 路径服务端生成/票据归属/大小类型闸 |
| `handlers/upload/prepare.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | — | 票据路径不含 openid；用途/大小闸（R-A1-11 在 cancel） |

### 2.2 其余文件按组（全部 ✓ 逐文件读取）

| 文件（组） | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 说明 |
| :-- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-- |
| `handlers/order/{accept,reject,markPicked,unmarkPicked,markDelivered,unmarkDelivered,reportException,resolveException,cancel,confirmDelivery,correct,undo,deleteRecord,imageUrl,get,create,createBatch,index}.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | 均为薄动作壳（19~130 行），状态机/角色/幂等在 `_common` 引擎；cancel 的 admin 审计与 correct 的字段闸已核 |
| `handlers/message/{markRead,index}.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | 已读水位只前进；scope 枚举闸 |
| `handlers/ai/{index}.js` / `handlers/upload/{cancel,index}.js` / `handlers/config/{getPublic,index}.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | 注册表逐字对齐 actions；cancel 契约漂移=R-A1-11 |
| `handlers/partner/{listBindings,getCustomer,stats,unbindCustomer,saveCustomerNote,getPublic,saveProfile,saveServiceConfig,index}.js` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 归属校验/解绑通知/统计时区 | 
| `handlers/user/{bootstrap,acceptPrivacy,deleteAccount,index}.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | 平铺 DTO 契约 E4 通过；注销两阶段 |
| `handlers/customer/{getProfile,index}.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | 本人/切换会话目标视角 |
| `handlers/bind/{create,release,getCurrent,claimGuestOrder,index}.js` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | 方向/自绑/测试×真实隔离；claim 为 P1 占位返回 NOT_FOUND |
| `handlers/health/index.js` | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓ | 内部动作；R-A1-15（version 写死） |

### 2.3 阶段 1 不适用项（N/A + 原因）

| 项 | 结论 | 原因 |
| :-- | :-- | :-- |
| 维度 8 UI 可访问性 | N/A | 本 part 为云函数，无 UI/触摸目标/对比度口径（前端 B1/B2 审） |
| XSS | N/A + 说明 | 云函数只返回 JSON 数据，不生成 HTML/富文本；客户端渲染转义属前端（B1/B2） |
| CSRF | N/A | 小程序无浏览器 Cookie 语义；鉴权走 `OPENID`（`getWXContext`）+ 服务端票据，无跨站请求面 |
| 密码强哈希 | N/A | 本仓无密码/账号口令概念（微信 `OPENID` 身份，D2） |
| 依赖漏洞（npm audit） | N/A + 原因 | 云函数 `package.json` 只 `wx-server-sdk@4.0.2`（精确版本、唯一允许依赖）；本机无 `node_modules`/`package-lock.json`（未安装），无法执行 audit；依赖白名单门禁 #16 已绿 |
| `registry/APIS.md` / `registry/DATA_DICT.md` | N/A + 原因 | 本仓不设 registry 三件套（ENGINEERING E7 已裁）；等效源 = DATA_MODEL §7 + shared/{actions,error-codes} |
| 提交信息格式 | N/A | 本 part 不做任何提交（Lead 统一提交）；HEAD 提交信息格式由门禁/Lead 核对 |
| 被删符号零残留 | N/A | 全量新增基线（BASE_SHA=空树），本范围无"被删符号"（`STATE.md` 亦无并行态登记簿，E17） |
| 条件维 10 性能预算 | N/A + 原因 | 仓内无云函数体积/耗时预算文件（ENGINEERING §2.3 是前端体积预算）；按维度 4 六类定性并标"无预算基线" |
| 阶段 1 无变更跳过 | N/A | 本轮为全量新增覆盖，不适用"无变更"跳过 |

---

## 3. 问题清单

> 格式：`编号 | 级别 | 位置(file:line) | 描述 | 影响(触发条件) | 修复建议 | 证据`。证据 = §1.5 的 `E#`（命令原文+退出码+命中行）或 read 行号内容。P0 = 0。

**R-A1-01 | P1 | cloudfunctions/api/middleware/auth.js:64-73,120（传播：handlers/order/_store.js:24-37,57-75；handlers/order/_common.js:85-97；handlers/order/_create.js:119-125；handlers/order/listPartner.js:283；handlers/ai/_common.js:29-38）**
- 描述：`resolveRole(user)` 只在 `users.roles.length === 1` 时返回角色，**双角色（CUSTOMER+PARTNER）返回空串**；`identity.role = ''` 之后，order 域全部用 `identity.role`（`_store.scopeOf:28`）判断角色与订单侧，不会回落到 `users.roles`。对照：身份域 `handlers/user/_common.js:90-106` 的 `assertBusinessRole` 明确有"roles 含 wanted 即放行"的回落实现，`handlers/partner/getPublic.js:35`、`bind/getCurrent.js:21`、`customer/getProfile.js:12` 也按 `scope.role === ''` 兜底——**同一仓内两套角色解析并存**，order/AI 域用了会拒绝双角色的那一套。
- 影响（触发条件）：任一 openid 同时具备 CUSTOMER+PARTNER 后，`order.create/get/listCustomer/listPartner/accept/...` 与 `ai.parseParcel` 全部 `FORBIDDEN`（实测见证据）。双角色在正常产品流程中可达且被现有测试锁定：`customer.saveProfile` 首存会 union 授予 CUSTOMER（`customer/saveProfile.js:61-85`；`tools/selftest-cloud.js:646-659` 断言 "PARTNER-only 用户首存顾客资料 → roles 同时含 PARTNER+CUSTOMER"），`partner.activate` 会 union 授予 PARTNER（`partner/activate.js:133-137`；`selftest-cloud.js:931-932` 断言"激活追加 PARTNER 不覆盖原 CUSTOMER"）。即：**顾客之后成为兼职（或兼职补顾客资料给同学下单）→ 顾客历史订单/下单、兼职接单/工作台两个方向的订单域全部不可用**，而 `user.bootstrap` 仍回双角色+两套编号，形成"资料能看、订单全挂"的半可用态。违反 ARCHITECTURE §4.1（L157）「同一 openid 同时具备 CUSTOMER+PARTNER 时两类动作都允许，identity.role 按动作域解析」与 CONTRACT（L43）双角色口径。
- 修复建议：在 auth 或 app 编排层做**动作域角色解析**（给 `shared/actions.js` 的 spec 增 `requiredRole`，或在 order 域按动作解析），order 侧 `orderSideOf` 支持"双角色时按订单归属双向判定"（`customerId===effectiveOpenid` → CUSTOMER 侧；`partnerOpenid===effectiveOpenid` → PARTNER 侧；两处都不中才 FORBIDDEN）；补 `selftest` 双角色端到端断言（至少 `order.listCustomer`/`order.get`/`order.accept` 三条正控 + 单人角色反例）。
- 证据：
  - E2（node stdin 探针，注入 fake DB，退出码 0；命令原文见 §1.5）输出：
    ```
    dual order.listCustomer -> {"ok":false,"code":"FORBIDDEN","message":"仅顾客身份可执行该操作"}
    dual order.get(own) -> {"ok":false,"code":"FORBIDDEN","message":"无权查看该订单"}
    dual order.accept(own as partner) -> {"ok":false,"code":"FORBIDDEN","message":"无权操作该订单"}
    baseline single-role CUSTOMER order.listCustomer -> {"ok":true,"code":"","count":0}
    dual user.bootstrap -> {"ok":true,"roles":["CUSTOMER","PARTNER"],"activeRole":"PARTNER",...}
    ```
  - read `middleware/auth.js`：64 `function resolveRole(user) {`；66 `if (roles.length !== 1) {`；67 `return '';`；120 `ctx.identity.role = resolveRole(user);`
  - read `handlers/order/_create.js`：119 `if (scope.role === enums.ROLES.CUSTOMER)`；122 `if (scope.role === enums.ROLES.PARTNER)`；125 `throw errors.forbidden('仅顾客或兼职可以下单');`
  - read `handlers/user/_common.js`：97 `if (scope.role && scope.role !== wanted)`；100-104 回落 `users.roles`（双角色可用）——证明统一实现本可做到。

**R-A1-02 | P2（安全/内容安全，待独立复核） | handlers/message/_common.js:127-142（调用 135）**
- 描述：内容安全 v2 的云调用参数形状在仓内有两套：`handlers/user/_common.js:204` 传 `{ openid: scope.openid, scene: 2, version: 2, content: text }`（四键齐全），`handlers/message/_common.js:135` 只传 `{ content: text, version: 2 }`，**缺 v2 必填的 `openid`/`scene`**。微信 `security.msgSecCheck` v2 要求 openid+scene，缺失时平台会返回非 0 errCode；本封装把 errCode≠0 与异常统一转成 `DEPENDENCY_FAILED('内容检测暂时不可用')`（:136-142），即留言发送会直接失败而不是降级。
- 影响（触发条件）：生产环境顾客/兼职发送订单留言（`message.send`）时，平台若因缺参报错 → 留言功能 100% 不可用（双方沟通断）。现有测试无法发现：单测桩 `tools/selftest-cloud-fixtures.js:22` 与各 `selftest-order-*` 的 `msgSecCheck` 桩**忽略入参恒返回 pass**；`tools/check.js:821` 只做 `msgSecCheck` 字符串存在性判定——判据对"参数形状"空转。
- 修复建议：`message/_common.checkContentSecurity` 改为与 `user/_common.assertTextSafe` 同参数（`{openid: scope.openid, scene: 2, version: 2, content: text}`），最好把两处合并成唯一封装（user/_common 或新 lib 纯件）；补一条**入参形状断言**（桩记录调用参数并断言四键齐全），并给 `check.js` 增设形状判据或移交 C。
- 证据：E10 → `handlers/user/_common.js:204 result = await security.msgSecCheck({ openid: scope.openid, scene: 2, version: 2, content: text });`、`handlers/message/_common.js:135 result = await security.msgSecCheck({ content: text, version: 2 });`（命令：`Select-String -Recurse -Filter *.js -Pattern 'msgSecCheck'`，退出码 0）。
- 安全三处（入口→传播→终点）：①入口 `handlers/message/send.js:26`（`await common.checkContentSecurity(...)`，留言唯一送检点）→②传播 `handlers/message/_common.js:127-142`（缺参调用+异常一律 dependencyFailed）→③终点 `handlers/message/send.js:49`（送检失败即抛错，不写 `order_messages`，客户端收到 `DEPENDENCY_FAILED`）。**待独立复核**（真实微信端是否必然报错未在真实环境复现，见 §5 ②）。

**R-A1-03 | P2（安全：内容信任边界，待独立复核） | handlers/message/send.js:42-44（入口）→ handlers/message/_common.js:163-167（传播）→ handlers/message/_common.js:169-183（终点；经 handlers/message/list.js:22,151 下发）**
- 描述：`message.send` 接受客户端任意 `templateCode`（仅 `trim().slice(0,40)` 后落库，`send.js:42-44`）；而消息域用 `templateCode === 'BIND_RELEASED'` 判定"系统通知"（`_common.js:165`），`buildMessageItem` 据此把普通留言渲染为 `type:'NOTICE'`、标题"系统通知"、`fromRole:'SYSTEM'`（:174-175,180）。服务端真正的系统通知（`bind/_common.js:77-99` 解绑通知）恰好复用同一可写字段，未使用独立的服务端标记。
- 影响（触发条件）：订单任一参与方调用 `message.send({templateCode:'BIND_RELEASED', text:'...'})`，对方在订单留言/消息中心看到的是"系统通知"而非对方留言（实测见证据），可用于冒充官方话术做社会工程（如诱导交出取件码）；伪造通知 `read=false` 呈未读，更易被点开。不越权读写、不涉订单状态。
- 修复建议：系统通知与快捷模板彻底分离——系统通知由服务端写 `fromId='SYSTEM'`（`SYSTEM_FROM` 已存在）且 DTO 只按 `fromId` 判定；客户端 `templateCode` 收窄为白名单枚举（或干脆不再接受客户端传值，只由服务端模板生成）；补 selftest：合同方带 `templateCode:'BIND_RELEASED'` 的普通留言不得渲染为 NOTICE/不得改 `read` 语义。
- 证据：E3（node stdin 探针，退出码 0）输出：
  ```
  message.send with client templateCode -> {"ok":true,"title":"系统通知","type":"NOTICE","fromRole":"SYSTEM"}
  counterpart sees -> {"type":"NOTICE","title":"系统通知","text":"请把取件码发我：A123"}
  stored doc -> {"fromRole":"CUSTOMER","fromId":"openid-c","templateCode":"BIND_RELEASED",...}
  ```
  read `handlers/message/_common.js`：165 `|| message.templateCode === BIND_RELEASED_TEMPLATE`；174 `type: system ? 'NOTICE' : 'MESSAGE',`；175 `title: system ? '系统通知' : messageTitleOf(fromRole),`；180 `fromRole: system ? SYSTEM_FROM : fromRole,`。**安全三处已给全**（入口/传播/终点如位置栏）。**待独立复核**。

**R-A1-04 | P2（内容安全口径） | handlers/order/_parcel.js:282-285,262-279；handlers/order/_create.js:135；handlers/order/markDelivered.js:11-16；handlers/order/cancel.js:22,44-48；handlers/order/reject.js:12-19；handlers/partner/saveCustomerNote.js:21**
- 描述：CONTRACT（L513）与 DATA_MODEL（L623）要求"留言/备注/昵称过 `security.msgSecCheck` v2"，实现只对顾客/兼职 `displayName`（`user/_common.js:187-216`）与订单留言（`message/_common.js:127`）送检；以下用户可写文本**全部未送检**，只做长度/字符集：订单备注 `note`（`_create.js:135` → `_parcel.normalizeOrderNote` → `validate.validateNote`）、送达备注 `deliveryNote`（`markDelivered.js:13` → `validateDeliveryNote`）、取消/拒单备注（`cancel.js:22,46`、`reject.js:17` → `validateNote/validateCancelNote`）、兼职私有备注 `partnerNote`（`saveCustomerNote.js:21`）、代客单单据顾客名 `guest.displayName`（`_parcel.js:268` → 仅 `validateDisplayName`）。
- 影响（触发条件）：任何用户在订单备注/送达备注/取消备注/兼职备注/代客顾客名写入不当文本都会**绕过内容安全闸**入库，并在对方 DTO、后台列表、订单事件 note 中展示；属 UGC 内容安全与提审风险（不是越权，也不影响零金额红线）。
- 修复建议：在 `_parcel.normalizeOrderNote`/`normalizeGuest`、`markDelivered` guard、`cancel/reject` 的 note、`saveCustomerNote` 落库前调用统一 `assertTextSafe(ctx, text, field)`（`user/_common.js:187` 已有，单测无 cloud 桩时自动放行不影响现有套件）；补断言"桩被调用"（记录调用）而非只断言"通过"。
- 证据：E14 → `handlers/order/_parcel.js:282 function normalizeOrderNote(value) {`（:283 只 `validate.validateNote`）、`handlers/order/markDelivered.js:13 common.validate.validateDeliveryNote(...)`、`handlers/order/cancel.js:22/46`、`handlers/order/reject.js:17`、`handlers/partner/saveCustomerNote.js:21`、`handlers/order/_parcel.js:268 validateDisplayName(guest.displayName)`（命令：`Select-String -Pattern 'normalizeOrderNote|validateNote|validateDeliveryNote|validateCancelNote|validatePartnerNote|validateDisplayName'`，退出码 0；对照 `msgSecCheck` 命中仅 displayName/留言两处）。
- 安全三处（入口→传播→终点）：①入口 `_create.js:135`（订单 note 入参）与 `markDelivered.js:13`（送达备注入参）→②传播 `_parcel.js:283`/`validate.js` 只做长度/字符集、无平台送检 →③终点 `_create.js:284`（`note` 落 `orders.note`）与 `_dto.js:366`（`note` 原样进 DTO 下发给双方/后台）。口径类发现，非越权漏洞（不标"待独立复核"，但建议 Lead 派 C 复核内容安全面）。

**R-A1-05 | P2 | handlers/order/_common.js:117-120,148-176（关键 159）**
- 描述：订单状态动作的乐观锁是 **check-then-act**：`expectedVersion` 只在事务外与 `order.version` 比较（:117-120），随后事务内 `trx.update(ORDERS, order._id, patch)`（:159）**不带 version 条件**。两个并发请求各自读到同一 version 都能通过校验，各自写 `version+1` 与自己的事件，后写覆盖前写。
- 影响（触发条件）：双方同时操作同一订单（顾客 `order.cancel` vs 兼职 `order.markPicked/markDelivered`；或同一操作被双击/重试成两个不同 `clientRequestId`）。后果：订单 `status` 被后写覆盖，但两条 `order_events` 都已落库（事件与状态不一致）；例如顾客取消成功后订单仍可能变成 PICKED/DELIVERED（或反之），"`expectedVersion` 乐观锁"对外宣称与实际不符。数据不丢、非资损，但状态机口径被并发破坏。
- 修复建议：事务内重读订单并做**条件更新**：`trx.updateWhere(ORDERS, { _id: order._id, version: order.version }, patch)` 后校验 `updated === 1`，否则抛 `CONFLICT`（`db/dao.js:115-121` 已提供 updateWhere 且返回 `{updated}`；`db/dao.js:147-170` 事务接口可直接用）；或事务内 `trx.get` 后校验 version 再写。补并发/重放断言。
- 证据：read `handlers/order/_common.js`：117 `const expectedVersion = typeof ctx.expectedVersion === 'number' ? ctx.expectedVersion : null;`；118 `if (expectedVersion !== null && expectedVersion !== order.version) {`；119 `throw errors.conflict(...)`；149 `await ctx.dao.transaction(async (trx) => {`；159 `await trx.update(store.COLLECTIONS.ORDERS, order._id, patch);`（patch 只含 status/version/statusUpdatedAt 等，无 where 条件）。read `db/dao.js`：115-121 `body.updateWhere = async (collection, where, data) => { … return { updated }; }`（能力已存在，未用）。

**R-A1-06 | P2 | handlers/message/list.js:59-82,84-97,100-117,134-153**
- 描述：消息中心（`message.list` 无 `orderNo` 分支）单次请求串行 N+1：先 `myOrders` 取 ≤20 单（:59-82），随后 `for` 循环内**每单 2 次串行 find**（events :137-141 + messages :145-149）≤40 次；`systemNoticeItems` 再 find 历史 bindings ≤20（:85-88），然后**逐 binding** `dao.get(partners)` ≤20 次（:90-95），再 find messages ≤30（:108-112）。
- 影响（触发条件）：活跃用户（近 20 单 + 多条历史绑定）打开消息中心，最坏约 63 次串行 DB 往返；云函数客户端 10s 超时、云端慢查询下首屏可能显著变慢甚至超时（属体验/性能风险；无预算基线、未压测，量化见 §5 ②）。
- 修复建议：①消息中心改为"先按时间窗取全局 messages/events 再按 orderId 归属过滤"（避免逐单查询），或给冻结件 `db/dao.js` 增 `in`/范围查询窄口（需 Lead 授权，与 TD-050 合并立项）；②`systemNoticeItems` 改为一次 find bindings + 一次批量取 partners；③补"查询次数"断言（fake DB 计数）防止回退。
- 证据：read `handlers/message/list.js`：134 `for (let i = 0; i < recentOrders.length; i += 1) {`；137-141 `const events = await ctx.dao.find(… ORDER_EVENTS …, limit: common.EVENTS_PER_ORDER);`；145-149 `const messages = await ctx.dao.find(… ORDER_MESSAGES …, limit: common.MESSAGES_PER_ORDER);`；90-95 `for (…bindings…) { const partner = await ctx.dao.get(COLLECTIONS.PARTNERS, bindings[i].partnerId); … }`；108-112 `const rows = await ctx.dao.find(… ORDER_MESSAGES …, limit: 30);`。E7 已确认所有 find 都带 limit（问题在调用次数，不在无界）。

**R-A1-07 | P2 | lib/id-generator.js:74-100；lib/tag-allocator.js:13-32；middleware/ratelimit.js:52-64；handlers/ai/_common.js:198-213；lib/tx.js:13-28**
- 描述：4 处"计数器无行 → `add` 建行"模式（订单日序号 / roomTag 序号 / 限流日计数 / AI 配额计数）在 `counters.uk_key(key,unique)`（DATA_MODEL §5.1 L505）下，并发首次请求时后到事务的 `add` 会命中 duplicate key；而 `lib/tx.isTransactionConflict` 明确把 duplicate 判为"不是事务冲突、不重试"（tx.js:19-21），各调用方也**没有** duplicate→读回重试分支：`order.create` 的 catch 只按 `orders.requestKey` 找回放（`_create.js:390-397`，counters 冲突时回放为空 → 继续上抛）；`bind/create.js:95-108` 把任何 duplicate 当 activeKey 冲突（可能误报"你已绑定兼职"）；`ratelimit.js:110-115` 对写动作直接 `INTERNAL_ERROR`；`ai/_common.countQuota`（:225-228）无 try，抛错会突破 `ai.parseParcel` "一切失败静默降级"的契约（`parseParcel.js:134`）。
- 影响（触发条件）：某计数器 key **首次建行时的并发**——当日首两笔订单、同一 (兼职,dormKey) 首两个绑定、同一用户当日首批请求、全局首个 AI 调用并发。后果：个别请求收到 `INTERNAL_ERROR` 或误导性 `CONFLICT`（重试可恢复、无脏数据）；AI 首并发会返回错误包络而非 `ok:true+recognized:false`，违反 CONTRACT §4.3 降级语义。
- 修复建议：①计数器建行改为 `add` 失败且 `isDuplicateError` 时读回并重试（有界 2 次）；②或给 `lib/tx` 增加按 duplicate 判定重试的专用入口（保留"唯一索引冲突不重试"的既有语义，只用于计数器）；③`ai` 的 `countQuota` 包 try/catch，失败按"无额度"静默降级。
- 证据：read 4 处同构代码，例：`lib/id-generator.js:78 const row = await trx.findOne(COLLECTIONS.COUNTERS, { where: { key } });` / `:83 await trx.add(COLLECTIONS.COUNTERS, { key, seq: total, updatedAt: nowMs });`；`lib/tag-allocator.js:21 if (!row) {` / `:22 await trx.add(COLLECTIONS.COUNTERS, …)`；`middleware/ratelimit.js:55-58`；`handlers/ai/_common.js:205-208`；`lib/tx.js:19-21 if (fields.some((field) => DUPLICATE_RE.test(textOf(field)))) { return false; }`；DATA_MODEL §5.1 L505 `counters：uk_key(key,unique)`。

**R-A1-08 | P3 | handlers/partner/_customer.js:239,263,287,298,313,324,333,460-467；handlers/bind/_common.js:144-146；handlers/user/_common.js:237-239；lib/tag-allocator.js:34-36；middleware/idempotency.js:30-35**
- 描述：TD-049 收敛（`partner.getCustomer` 删除订单分页/游标）后，`_customer.js` 遗留 7 个订单分页函数成为死代码：`orderRowOf(:239)`、`orderAnchorMs(:263)`、`inTimeRange(:287)`、`parseOrderCursor(:298)`、`isAfterOrderCursor(:313)`、`orderCursorOf(:324)`、`loadCustomerOrders(:333)`——全部"定义 + 导出"后零引用（约 100 行，仍留在 `module.exports` :460-467）；另有 4 个孤立导出：`customerSelfDto`（bind/_common:144-146）、`isActivePartnerDoc`（user/_common:237-239）、`allocateRoomTagWithDao`（tag-allocator:34-36）、`findReplay`（idempotency:30-35）。AGENTS §5.4 要求"新增导出必须有生产调用，或先登记 TECH_DEBT"。
- 影响：维护误导（后来者按旧函数名接入会踩已收敛口径）、`_customer.js` 已 478/500 行接近红线；无运行时影响。
- 修复建议：删除上述 7 个死函数与 4 个孤立导出；若确需保留（测试面）须登记 TD 并写保留理由与删除条件；顺带给 C 增加"死导出"静态判据。
- 证据：E9 → node 扫描输出 `TOTAL_DEAD_EXPORTS=63`（仓内零外部引用导出），其中 `module-internal refs=2`（仅定义+导出，模块内也零引用）的 11 项含上述 7+4 项；另 `Select-String -Pattern '\borderRowOf\b|…'` 每个名字只命中"定义行 + module.exports 行"（hits=2，命令与输出见 E9）。

**R-A1-09 | P3 | lib/ai/deepseek.js:248-253；handlers/order/_store.js:70-74**
- 描述：①`deepseek.js:251` `aborted ? AI_ERROR_CODES.TIMEOUT : AI_ERROR_CODES.TIMEOUT`——三元两个分支同值（永远真/假分支，无信息量），且网络错误与超时无法区分（注释语义想区分）；②`_store.js:71-73` `if (!partner && scope.targetId)` 引用的 `scope.targetId` 在 `scopeOf`（:24-37）中从未赋值，恒 `undefined`，属死分支（TEST_WRITE 下 `effectiveOpenid` 已是合成 openid，本不需要 fallback）。
- 影响：排障码信息损失、维护噪音；无功能影响。
- 修复建议：①非超时网络错误归 `HTTP_5XX` 或新增内部排障码（`aiErrorCode` 是记录字段、非业务码，可扩），三元改双分支或直接删除；②删除死分支（或补注释说明保留原因与触发条件）。
- 证据：E15 → read `lib/ai/deepseek.js`：246 `} catch (err) {`；248 `const aborted = !!(err && (err.name === 'AbortError' || err.code === 'ABORT_ERR'));`；251 `errorCode: aborted ? AI_ERROR_CODES.TIMEOUT : AI_ERROR_CODES.TIMEOUT,`；read `handlers/order/_store.js`：70 `let partner = await getPartnerByOpenid(ctx, scope.openid);`；71 `if (!partner && scope.targetId) {`；`Select-String -Pattern 'scope\.targetId'` 仅命中该行（`scopeOf` 返回值 :27-36 无 targetId 键）。

**R-A1-10 | P3（安全：日志注入面，待独立复核） | cloudfunctions/api/bootstrap.js:22；app.js:73-78,99,159,169,178**
- 描述：`requestId` 优先取客户端 `event.requestId`（`bootstrap.js:22` 透传），`app.js:73-78` 的 `makeRequestId` 优先使用 `deps.requestId`，随后作为响应 `requestId` 回显（`respond.success/failure`）并写入全部 `console.log`；DATA_MODEL §7.1（L628）写"`requestId` 服务端生成、只用于排障"，且客户端传入值**没有长度/字符白名单**（可含换行/超长）。ARCHITECTURE §4.1（L153）冻结的入口恰好是 `requestId: event && event.requestId`，两文档口径冲突。
- 影响（触发条件）：客户端可伪造 requestId 使排障对账失真（响应里看到的不是服务端生成的），或注入换行污染云函数日志（日志注入面）。不涉数据/权限。
- 修复建议：二选一收口——a) 服务端忽略客户端 requestId，只用 `respond.newRequestId()`；或 b) 保留透传但加 `^[A-Za-z0-9_-]{8,64}$` 形态闸，并把 DATA_MODEL §7.1 / ARCHITECTURE §4.1 两处文档改成一致口径（属 Lead 授权回写）。
- 证据：read `bootstrap.js`：22 `requestId: event && typeof event.requestId === 'string' ? event.requestId : '',`；read `app.js`：74 `if (deps && typeof deps.requestId === 'string' && deps.requestId.length > 0) {`；77 `return respond.newRequestId();`；99 `const requestId = makeRequestId(deps);`；159/169/178 三处 `console.log('[api]', …, requestId, …)`。
- 安全三处：①入口 `bootstrap.js:22`/`app.js:104`（客户端 event.requestId）→②传播 `app.js:73-78,99`（meta.requestId 生成/注入）→③终点 `app.js:159,169,178`（日志）与 `lib/respond.js:24,42`（响应回显）。**待独立复核**（不越权，仅日志/对账面）。

**R-A1-11 | P3 | handlers/upload/cancel.js:13-22（对照 DATA_MODEL §7.6 L699）**
- 描述：契约写 `upload.cancel` 的"不存在/非本人 → `NOT_FOUND`、已消费 → `INVALID_STATE`"；实现对"票据不存在"与"入参为空/非串"返回 `ok:true,{cancelled:false}`（:14-20），只有"他人票据"返回 `NOT_FOUND`（:21-23）。
- 影响：契约不一致，客户端无法区分"已撤销/不存在/参数缺失"；无安全影响。
- 修复建议：按契约返回 `NOT_FOUND`（保留已消费 `INVALID_STATE`），或回写 DATA_MODEL §7.6 说明"取消不存在票据按自然幂等返回 cancelled:false"并锁断言。
- 证据：read `handlers/upload/cancel.js`：13 `const ticketId = input.uploadTicketId || input.ticket || '';`；14-16 `if (typeof ticketId !== 'string' || ticketId.trim() === '') { return { cancelled: false }; }`；18-20 `if (!ticket) { return { cancelled: false }; }`；read `docs/V4_DATA_MODEL.md` L699 `upload.cancel … 特有错误 NOT_FOUND/FORBIDDEN`。

**R-A1-12 | P3（文档/实现漂移，移交 Lead 授权回写） | docs/ARCHITECTURE.md:154；docs/V4_DATA_MODEL.md:680,732；cloudfunctions/api/middleware/index.js:10-18；middleware/switch-session.js:16-29；handlers/order/_common.js:100-102**
- 描述：3 处冻结文档与实现漂移：①ARCHITECTURE §4.1（L154）中间件链写 `auth → switch-session → validate → ratelimit → idempotency → audit`，实现多 `guard-bind`（`middleware/index.js:10-18`）；②DATA_MODEL §7.7（L732）READONLY 读白名单列 10 个，实现 12 个（`switch-session.js:16-29` 多 `partner.getCustomer`/`partner.stats`，而 §7.4 批 7 段（L662）已允许——文档内部不一致）；③DATA_MODEL §7.5 `order.resolveException` 行（L680）权限写"该兼职/admin（EXCEPTION）"，实现按 CONTRACT §1.1 第 4 条把 ADMIN 订单写动作收敛为仅 `order.cancel`（`order/_common.js:100-102`），admin 调 resolveException 得 `FORBIDDEN`。
- 影响：后续按文档接入/评审会误判（尤其权限白名单），文档内部也自相矛盾；不涉运行时。
- 修复建议：由 Lead 授权单写者回写 DATA_MODEL §7.5/§7.7 与 ARCHITECTURE §4.1（冻结接口文档变更需单写者）；或实现改回文档（不推荐，与 CONTRACT 冲突）。
- 证据：E5/E10 同类 Select-String：`ARCHITECTURE.md:154 … auth → switch-session → validate → ratelimit → idempotency → audit …`；`DATA_MODEL.md:732 … 只读白名单：… config.getPublic；`（10 项）vs read `switch-session.js:16-29` 的 12 项；`DATA_MODEL.md:680 | order.resolveException | … | 该兼职/admin（EXCEPTION） |` vs read `order/_common.js:100-102 if (actorRole === enums.CANCELLED_BY.ADMIN && spec.action !== 'order.cancel') { throw errors.forbidden('后台仅可介入取消异常订单'); }`。

**R-A1-13 | P3 | handlers/bind/_common.js:77-99（通知写入 83-93）；handlers/message/_common.js:113-117**
- 描述：`notifyCustomerReleased` 写解绑系统通知时**未派生 `isTest` 字段**（:83-93 的 doc 无 isTest），而消息中心 `systemNoticeItems` 按 `(row.isTest === true) === isTestSession(ctx)` 过滤（:114）。TEST_WRITE 会话下 `isTestSession=true` 而该通知 `isTest` 为 undefined → 被过滤不可见；真实会话因绑定双方同侧不受影响。
- 影响：测试会话（开发者切换测试账号验收）里"解绑通知"看起来没实现，真机/测试账号验收会误判；无数据错误。
- 修复建议：写通知时传 `isTest: scope.testWrite`（或由调用方传参与方 `isTest`）；补 selftest 断言 TEST_WRITE 解绑后消息中心可见该通知。
- 证据：read `handlers/bind/_common.js`：83 `await ctx.dao.add(COLLECTIONS.ORDER_MESSAGES, {` … 90 `isTest: opts.isTest === true,`（调用方 `partner/unbindCustomer.js:46-51` 与 `bind` 域均未传 isTest）；read `handlers/message/_common.js`：114 `.filter((row) => (row.isTest === true) === common.isTestSession(ctx))`。

**R-A1-14 | P3 | handlers/order/_create.js:16-29,349,405,414（对照 DATA_MODEL §6.5 L623）**
- 描述：DATA_MODEL §6.5 要求"统一 schema 校验、未登记字段拒绝并带 `data.field`"，实现只有 `order.create/createBatch` 维护严格白名单（66 个 client 动作中 2 个）；其余 62 个动作（如 `customer.saveProfile`、`message.send`、`partner.saveServiceConfig`）对未知/多余键**静默忽略**。TD-037 只登记了 create 白名单的维护成本，未覆盖该口径缺口。
- 影响：客户端契约漂移（字段名拼错/旧字段）被静默掩盖、排障困难；零金额红线未破（未知字段不落库）。属契约一致性/可维护性。
- 修复建议：在 middleware/validate 层按 ACTION_MAP 增补"每动作顶层字段白名单"或至少"未知顶层键拒绝"的通用闸；先登记 TD 评估改造面（避免一次改 60+ 动作）。
- 证据：E1 → `CLIENT_ACTIONS.length = 66`；E6 类 Select-String `assertKnownFields` 仅命中 `_create.js:22,349,405,414` 四处（handler/lib/middleware 全目录扫描）。

**R-A1-15 | P3 | handlers/health/index.js:11**
- 描述：`health.check` 返回 `version: 'v4-batch1'` 写死，批 1 之后未随批次更新（STATE 当前工程侧批 9 收口）；RUNBOOK §13 冒烟把 `health.check`/`admin.bootstrap` 返回原文作为部署证据。
- 影响：部署冒烟无法从 version 判断实际部署批次/是否旧包（可观测性缺陷）；不影响业务。
- 修复建议：version 从构建期注入（`package.json` version 或环境变量）或每次发版手动更新；RUNBOOK 冒烟证据要求写明 version。
- 证据：read `handlers/health/index.js`：11 `version: 'v4-batch1',`（与 `STATE.md` §3i"批 9 工程侧交付"对照）。

**R-A1-16 | P3（并发/审计口径，待独立复核） | handlers/order/_store.js:286-298（loadUploadTicket）；handlers/order/_create.js:385-387,464-466（usedAt 写入）**
- 描述：截图票据"一次性"实现为"事务外读 `usedAt` → 事务内**无条件**写 `usedAt`"：两个并发 `order.create/createBatch` 使用同一 ticket（不同 `clientRequestId`）都能通过读取校验并各自建单，同一截图被两单使用。
- 影响（触发条件）：同一上传票据并发两次下单（双击/脚本化）。后果：重复订单共享同一截图（订单零金额可取消，不构成资损），破坏"票据一次性"审计口径；不越权。
- 修复建议：事务内条件更新 `trx.updateWhere(UPLOAD_TICKETS, { _id: ticket._id, usedAt: null }, { usedAt: nowDate })` 并断言 `updated === 1`，否则 `INVALID_STATE`（dao.updateWhere 已有）。
- 证据：read `handlers/order/_store.js`：286 `async function loadUploadTicket(ctx, ticketId, nowMs) {`；291 `if (ticket.usedAt || time.toMs(ticket.expiresAt) <= nowMs) {`（事务外判断）；read `_create.js`：385-387 `if (imageCtx.ticket) { await trx.update(COLLECTIONS.UPLOAD_TICKETS, imageCtx.ticket._id, { usedAt: nowDate }); }`（无 where 条件）。**待独立复核**（并发交错未实测，见 §5 ②）。

**R-A1-17 | P3（门禁漏检，移交 C + Lead 裁决） | tools/check.js:494-508 vs AGENTS.md §4.2；A1 范围 15 个 >50 行函数（清单见证据）**
- 描述：AGENTS §4.2 写"单函数 ≤50 行（全文本口径，门禁 #18）"，实测 `check.js` #18 只统计**文件行数**（:494-508，`limit = isTool ? 1000 : 500`），不检查函数长度 → 该纪律**无门禁兜底**；A1 范围内 15 个函数 >50 行：`customer/saveProfile.handler`(154)、`lib/ai/deepseek.createDeepSeekClient`(130)、`order/_common.runOrderAction`(117)、`db/dao.createBody`(112)、`bind/create.handler`(88)、`order/_create.createBatch`(87)、`app.invokeCore`(86)、`switch-session.middleware`(66)、`user/bootstrap.handler`(65)、`order/_dto.buildOrderDto`(63)、`partner/activate.handler`(62)、`order/_parcel.normalizeParcel`(58)、`message/list.listCenter`(55)、`order/_create.createOne`(55)、`order/correct.applyPatch`(53)。
- 影响：纪律与门禁不一致（写"门禁 #18 覆盖"但实际不检），长函数长期无约束；本 part 不判这些函数"违规"（门禁口径未落地），只报漏检事实与清单。
- 修复建议：C 轴二选一收口——a) `check.js` 增"单函数 ≤50 行"判据（需排除夹具/测试/`handlers` 薄壳）；b) Lead 回写 AGENTS §4.2 明确该条为建议性、门禁只查文件行数。两者都要留真实输出。
- 证据：E16 → node 花括号配平扫描输出 `TOTAL_FUNCTIONS_OVER_50=15` 及上表清单（命令原文见 §1.5 E16，退出码 0）；read `tools/check.js`：494 `check(18, '行数', …)`、501 `const limit = isTool ? 1000 : 500;`、504 `const n = F.countLines(path.join(ROOT, rel));`（只比文件行数）；`AGENTS.md` §4.2 原文「单函数 ≤50 行（全文本口径，门禁 #18）」。

> 说明：R-A1-01 为 P1（核心功能不可用），本 part 建议色因此为红；P0 未发现（未发现崩溃/数据丢失/越权读写）。安全面发现 R-A1-02/03/10/16 均不高于实际影响，且均标"待独立复核"。

---

## 4. 通过项

### 4.1 七维 + 条件维逐条结论（覆盖范围 = §0 的 93 文件 / 9,626 行，逐文件读取）
1. **接入性与装配：通过（装配无断链）**。①入口：`index.js`（唯一 `wx-server-sdk`）→ `bootstrap.invoke`（`cloud.init`/`getWXContext`/`deps` 组装）→ `app.invokeCore`（解包→`router.getRouter()`→`middleware.CHAIN`→handler→flat 包络）；②注册：`router.js:32-59` 启动时做"client 动作 + `admin.bootstrap`/`health.check` 双向一致"断言，缺一/多一即抛（失败关闭）；11 域 handler 全部被 `domains` 列表 require（E1 探针经该路径加载成功）；③依赖注入：`ctx = {dao, ids, now, env, cloud, openid, identity, requestId, clientRequestId, expectedVersion, config}` 与 ARCHITECTURE §4.1 一致；`ctx.ids.orderNo` 为 Promise（走 counters 事务）、其余同步，符合 §4.2 备注；④契约：`config.getPublic` 11 键齐全（无 `aiFallback`、无交易类键）、`user.bootstrap` 平铺 10 键齐全且**键集无 openid/_id/customerId/partnerId**（E4 探针，退出码 0），与 DATA_MODEL §7.3/§7.6 一致；动作—handler 键名逐字一致（各域 `index.js` 注册表已核）。
2. **逻辑性：发现 1 条 P1（R-A1-01 角色解析）+ 4 条 P2（R-A1-05 乐观锁 TOCTOU、R-A1-06 消息 N+1 归性能、R-A1-07 计数器首行并发、R-A1-16 票据并发为 P3）**。通过面：`order.create/createBatch` 单事务原子创建（订单+事件+票据消费同事务，`_create.js:369-389,445-468`）；幂等键单源（`idempotency.js:9-27`，`orders.requestKey`/`order_events.requestKey`/`bindings.activeKey`/`admin_audit.requestKey` 唯一索引兜底）；状态机单源 `shared/order-state`（动作合法起始状态/角色矩阵/`canCustomerCancel`/`resolveExceptionTo`）由 `_common.runOrderAction:121-123` 统一执行；测试/真实隔离谓词（`isTest` 服务端派生、`assertTestOrderVisible`）；时间统一服务端注入 `ctx.now`（`lib/time` UTC+8）；失败路径无空 catch（`switch-session.markExpired`/`bootstrap.lastLoginAt`/`tryDeleteFile`/`ratelimit.decrement` 均为"降级告警不静默"）；`user.deleteAccount` 事务内释放绑定+置 DEACTIVATED（`deleteAccount.js:32-48`）；`customer.saveProfile` 换宿舍事务（旧 RELEASED+新分配 roomTag）。已知降级见 §4.8（TD-040/041/043/044/045/050 不重复论证）。
3. **牵连性：通过（无被删符号残留；文档漂移已记 R-A1-12）**。全量新增基线（BASE_SHA=空树）→ 无"被删符号"；`order.listPartner` 已按 TD-021 删除 `groups`（响应仅 `{list,nextCursor,counts}`，代码中无 `groups` 下发）；`partner.getCustomer` 已按 TD-049 收敛（无 orders/nextCursor）；`VIEW_AS_*`/`激活码` 等旧口径在 A1 代码 0 命中（`shared/audit-actions` 只用 `ACCOUNT_SWITCH_*`）；四份文档同步检查：DATA_MODEL/ARCHITECTURE 有 3 处漂移（R-A1-12），CHANGELOG/TECH_DEBT 本 part 未产生新欠账（建议 Lead 把 R-A1-05/06/07 登记 TD）。
4. **性能：通过（有界查询）+ 1 条 P2（R-A1-06）**。E7：`dao.find` 20 处**全部带 limit**，无无界查询；`count(...{where:{}})` 唯一 1 处为 `health` 的 config 单文档集合；列表扫描上限显式（订单 300/500、绑定 100、消息 30、审计/后台 20~50），无索引 WHERE 由 DATA_MODEL §5.1 索引清单覆盖；无同步长任务（AI 外呼在 handler 内、有 8s 超时）；资源无泄漏面（云函数无定时器/连接池；`switch-session`/`ratelimit`/`ai` 的 write 均作用域内事务）。遗留：R-A1-06（消息中心串行 N+1）；"无预算基线"（条件维 10 N/A）。
5. **冗余死代码：发现 2 条 P3（R-A1-08 死导出、R-A1-09 死分支）**。此外核查：`db/dao.js` 的 `inc/serverDate` 属 ARCHITECTURE §4.2 冻结接口面、生产 0 调用但属"冻结接口预留"（合法保留）；`app.js` 部署分支无审计/限流 finish 属 internal 专用路径（见下）。未见"复制粘贴只改名"的大段重复（role 守卫三处实现差异已由 R-A1-01 覆盖）。
6. **开发规范：基本通过（1 条门禁漏检 R-A1-17）**。命名/注释整体清晰（Why 注释 + 契约条款引用到位）；单文件行数全部 ≤500（最大 `_create.js` 499、`_customer.js` 478、`_dto.js` 434，E8）；编码/换行/BOM 由门禁覆盖；`package.json` 依赖白名单通过（只 `wx-server-sdk@4.0.2`，精确版本，无 `node_modules`/lockfile，npm audit N/A）；无未完成占位标记（E6 0 命中）；无交易类语义字段（零金额扫描 E12 0 命中；命中仅注释中的口径说明）；`console` 无 L3（E13）；函数 >50 行为门禁漏检（R-A1-17，移交 C/Lead）。
7. **安全：无 P0/P1；3 条 P2/P3 安全面发现（R-A1-02/03/10，均"待独立复核"）**。鉴权：所有 client 动作经 middleware 链（auth→switch-session→guard-bind→validate→ratelimit→idempotency→audit），`admin.*` 需 `developerNo`（`auth.js:130-132`+`audit.js:62-64`），internal 动作需开发者或部署者（`auth.js:127-129`），票据不能当后台凭据（`audit.js:59-61`）；水平越权：order 域全部按 `orderSideOf`/`customerScope`/`loadScopePartner` 做归属校验且"不返回空集"（NOT_FOUND/FORBIDDEN 口径）；customer/partner/bind/upload 各域均先取本人资料/绑定再查目标（`bind.create` 自绑拦截 `create.js:52-56`、测试×真实 `:60-63`）；READONLY 写动作服务端拒（`switch-session.assertModeScope`），TEST_WRITE 防票据挪用双校验（`:186-192`）；上传：路径服务端生成（`upload/_common.buildCloudPath`，不含 openid、ticket/random 来自 32 字母表 crypto），AVATAR 票据归属+路径前缀+≤maxBytes+jpg 校验（`assertAvatarFile:59-79`），TICKET 用途/归属/过期/已用校验（`_store.loadUploadTicket`）；注入：无字符串拼 SQL（云 DB 命令式 API）、`validate.sanitizePayload` 剥离 `__proto__/constructor/prototype`；密钥：`DEEPSEEK_API_KEY`/`ADMIN_OPENIDS` 只从 `ctx.env` 读、仓库只有键名（`deepseek.js:15/keyEnvir`、`.env.example`），无硬编码；CORS/debug 端点：云函数无 HTTP 触发器、无 express/debug 模块（N/A+原因）。AI/外部内容面：外发 payload 三重白名单（`payload.buildAiPayload`→`assertPayloadKeys`→`buildRequestBody` 逐键复核）+ 服务端二次去敏（手机号/身份证/长数字/门牌/姓名行）+ Key 只 env + 日志只记错误码/耗时/成功与否。数据安全：见条件维 11。
- **条件维 9（外部调用）：通过（设计面）/待真实环境验证**。仓内唯一外呼 = `lib/ai/deepseek.js`（`ENDPOINT`/`KEY_ENV_NAME` 仅此文件）；传输层 `fetch` 参数注入（`createDeepSeekClient({fetchImpl})`，单测替身零真实外呼）；显式超时 `AbortController+setTimeout(config.aiFallback.timeoutMs，默认 8000ms)`；重试 = 仅网络/5xx 一次（`MAX_ATTEMPTS=2`，`retryable = status>=500`；4xx/解析失败不重试）；熔断 = 连续 5 次失败 10 分钟（进程内实例级，注释已声明 best-effort，跨实例不共享）；降级 = 任何失败静默 `ok:true+recognized:false` 且必写 `recognition_failures`（唯一写入口 `ai/_common.recordFailure`，requestKey 幂等）；开关关闭/Key 缺失零外呼；超限不返回 `RATE_LIMITED`；外发键集合严格 `{ocrTextMasked,hintTrackingTail?,role}`；`ai.parseParcel` 在 READONLY/TEST_WRITE 一律 FORBIDDEN（`ai/_common.assertBusinessRole:34-36`，对齐 ENGINEERING L226/L298）。未验证：真实网络超时/熔断行为（TD-011 Key 未配置，无真实外呼）；8s 超时在真实环境是否足够（无预算基线）。
- **条件维 11（数据隐私）：通过（除 R-A1-02/04）**。DTO 分级：本人 L3 走 `db/dto/full.js`，后台走 `db/dto/mask.js`（昵称首字+`***`、取件码首末位、尾号后 2 位、宿舍到苑+楼栋），`order/_dto.applyAdminMask` 同时清 `actions`；头像/昵称只在"当前 ACTIVE 绑定"内下发（`_dto.resolveCounterpart:91-126`、`full.partnerPublic(bound)`），解绑后 `bind.getCurrent`/`partner.listBindings` 不再返回；日志仅 `requestId/action/错误码/耗时/openid 不出现在 A1 日志`（E13）；完整 openid 不出现在任何 DTO（E4 探针键集 + TD-021 断言面）；切换会话票据只在请求包络/服务端文档，`user.bootstrap` 只回 `viewContext` 摘要不回票据（`user/_common.buildViewContext`）；注销两阶段（`user.deleteAccount` 事务只做解绑+状态，匿名化/删文件交 cleanup；TD-053/TD-054/TD-055/TD-056 为批 9 已登记明账）；上传路径不含 openid（`avatars/{role}/{random}.jpg`、`orders/{ticket}/image.jpg`）；AI 外发二次去敏（`payload.maskSensitiveText`）。问题：内容安全缺口 R-A1-04、msgSecCheck 形状 R-A1-02、requestId 客户端可控 R-A1-10；日志中可能出现的 DB 错误文案透传见"依据未复现"#2。
- **条件维 8（UI 可访问性）/条件维 10（性能预算）：N/A + 原因**：见 §2.3。

### 4.2 通过项明细（抽样证据，均可复核）
- **装配**：`router.js:32-59` 双向断言；`app.js:104-111` 未登记动作 `FORBIDDEN`、`getRouter()` 缓存；middleware 链 7 段（`middleware/index.js:10-18`）；`bootstrap.js:12-25` SDK 未注入即抛（入口 `index.js:6-19` 兜底为 flat 包络，不把堆栈抛给客户端）。
- **部署/控制台分支**：无 OPENID 时仅 `spec.visibility==='internal'`（`admin.bootstrap`/`health.check`）走"validate→handler"最小链路（`app.js:143-161`），且客户端调用云函数必带 OPENID、API 无 HTTP 触发器 → 客户端不可达该分支（判为设计正确；internal 动作本身不落业务数据）。
- **幂等**：`order.create` 重放返回原单+`duplicated:true`（`_create.js:358-363,390-397`）；`createBatch` 逐条 `requestKey`、全命中回放/部分命中 CONFLICT（`:426-439,469-479`）；订单动作事件 `requestKey=[orderId,action,clientRequestId]` 唯一索引 + 先查重放（`_common.js:110-116,177-182`）；`bind.create` 同顾客同兼职重放 `duplicated`（`bind/create.js:65-78,95-108`）；`message.send` 同 `clientRequestId` 重放（`send.js:27-32`）；`upload.prepare` 每次新票据、`upload.cancel` 自然幂等（R-A1-11 仅错误码口径）。
- **事务边界**：`order.create`（订单+事件+票据）、`createBatch`（N 单+事件+票据）、`bind.create`（binding+counters tag+唯一键）、`bind.release`、`unbindCustomer`、`customer.saveProfile` 换宿舍（资料+旧绑定 RELEASED+新绑定）、`partner.activate`（激活+邀请码状态+roles）、`user.deleteAccount`（解绑+状态）、`ai.recordFailure`（失败入队唯一索引）——均"要么全成要么全败"（文件/审计等不可回滚副作用放事务外并降级告警）。
- **切换会话（READONLY/TEST_WRITE）**：`switch-session.js` 校验票据归属（`adminOpenid===ctx.openid`）、白名单（12 读）+ 写拒/测试写白名单、`endedAt`/`expiresAt`（过期一次性审计 `ACCOUNT_SWITCH_EXPIRED`，requestKey 幂等）、`targetIsTest` 与目标一致性、TEST_WRITE 防挪用（`targetId===effectiveOpenid`）、EXIT 注入票据（`:172-182`）；`user.bootstrap` 在切换视图回 `isDeveloper=false`+`viewContext` 摘要（`user/bootstrap.js:96-103`）。
- **AI 兜底**：`ai.parseParcel` 降级 DTO 键集合固定（`lib/ai/parse.buildDegradedDto` 恰 10 键）、失败必入队（NO_TEXT/配额/开关关闭/外呼失败/解析失败/低置信全部 `recordFailure`）、同 `clientRequestId` 重放同 `failureId`（`parseParcel.js:77-83`）、`uploadTicketId` 失效只标记不拒绝（`ai/_common.ticketStatusOf:99-123`）、`stationName` 由服务端站点表回填（不信任模型）、`confidence` 非法按 LOW（保守触发复核）。
- **内容/日志口径**：`lib/errors` 未知异常一律 `INTERNAL_ERROR` 且响应只回人话（`app.js:171-180`、`respond.failure:31-47`）；`serializeErrorForLog` 只进云函数日志、截断 stack 4 行；`console` 20 处无 L3（E13）；`middleware/validate.sanitizePayload` 剥离危险键。
- **配置公开面**：`config/_common.buildPublicConfig` 委托 `shared/defaults.pickPublicConfig`（云端/端侧同源），额外只补 `subscribeEnabled`；`db/config.readConfig` 失败回默认值并告警（可用性优先；见"依据未复现"#3 的维护闸降级说明）。
- **发现/入队等副作用**：`recognition_failures` 单写入口、`admin_audit` 单写入口（`audit.writeRecord/writeOnce`，duplicate 幂等、非 duplicate 失败抛 INTERNAL_ERROR 不静默）。

### 4.3 气味基线（判断题，给判断与理由）
| 气味 | 判据与判断 |
| :-- | :-- |
| 长函数 | **有（15 个 >50 行）**：`customer/saveProfile.handler` 154 行、`lib/ai/deepseek.createDeepSeekClient` 130、`order/_common.runOrderAction` 117、`db/dao.createBody` 112 等（E16 清单）。虽被门禁漏检（R-A1-17），但可读性与单职责尚可（注释分段清晰）；建议后续拆分而非本轮返工。 |
| 重复代码 | **有（2 处值得关注）**：①角色解析两套实现（`user/_common.assertBusinessRole` 回落 roles vs `order/_store.scopeOf` 只看单角色）——正是 R-A1-01 根因；②内容安全两套封装（`user/_common.assertTextSafe` vs `message/_common.checkContentSecurity`）——正是 R-A1-02 根因。其余"薄动作壳"（19 个 order 动作各 19~130 行）属契约形状，非复制粘贴改名。 |
| 参数过多 | **有（6 处 >4 参数，未达需重构程度）**：`runOrderAction(ctx,payload,spec)` 的 spec/guard/build 入参包、`ai/_common.recordFailure(ctx,input)`、`switch-session.middleware(state)` 等以对象/IoC 形式承载，参数本身不多；`_create.buildOrderDocument(options)` 用 options 包。判断：可接受（对象参数非"参数过多"典型气味）。 |
| 发散式变化 | **有 1 个**：`app.js` 同时承担装配/部署分支/日志/包络/测试注入入口（231 行）；`_create.js` 同时承担 create 与 createBatch（499 行）。判断：在单人小仓可控，但 `_create.js` 已到行数上限边缘，后续扩字段易越界。 |
| 霰弹式修改 | **有 1 处风险**：新增下单入参字段须同步 `_create.js` 三份白名单（TD-037 已登记）+ selftest 断言；本 part 未新增字段，不判违规。 |
| 命名不达意 | **轻微**：`tx.js` 的 `retryOnConflict` 不含 duplicate 重试（语义与名字边界需看注释）；`db/dao.js` 的 `inc/serverDate` 是冻结接口但生产零调用（易误解为在用）；`_store.js` 的死属性 `scope.targetId` 名字像有值实际恒空（R-A1-09）。其余命名（`orderSideOf`/`assertTestOrderVisible`/`loadWritablePartner`）达意。 |

### 4.4 越界与取代废弃
- 越界：本 part 只读代码，未发现"顺手优化"式越界改动；A1 范围与 S7/S8 写作用域一致（ARCHITECTURE §2）。
- 取代与废弃检查（命中即红灯）：
  - 并行态登记簿：`STATE.md` **无"并行态"登记簿**（E17 命令输出 0 命中）→ 按取代与废弃检查直接判。
  - 废弃标记命中：**0**（命令：`Select-String -Pattern '_old\b|_legacy|_v2\b|Deprecated|暂时保留|废弃|TO\x44O[:：]\s*(删|remove|delete)'`，A1 93 文件，空输出、退出码 0）。
  - 各条已申报判定：N/A（无命中）；A1 未见并行实现未删（旧文件/旧函数/旧分支）；死代码问题 R-A1-08 属"TD-049 收敛残留"，非"旧实现并行保留"，但依 AGENTS §5.4 仍需删除或登记。
- 结论：**未触发红灯**（建议色不由取代废弃决定）。

### 4.5 错误码闸
- 13 码唯一集核对：`shared/error-codes.js` `ERROR_CODES/ERROR_CODE_MAP/ERROR_CODE_COUNT=13`；E11 扫描 A1 代码中 `code:` 字面量仅 `index.js:14` 的 `INTERNAL_ERROR`（注册表内），`lib/errors.js` 全部构造经 `CODE`（来自注册表），无自造码；`errors.forbidden/invalidState/...` 与 DATA_MODEL §7.2 的 13 码一一对应。
- `docs/registry/APIS.md` 不存在 → 错误码闸的等效源 = `shared/error-codes.js` + `docs/V4_DATA_MODEL.md` §7.2（N/A + 原因已写 §2.3）。

### 4.6 降标守卫五查（本轮无修复 diff → N/A；命令仍实跑留证，见 E18）
- ①阈值被挪：N/A（本轮无修复 diff）；②测试变简单：N/A（未改测试）；③检查器被静音：N/A（未改门禁）；④阈值文件与失败功能同一次提交：N/A（无提交）；⑤工件大小放宽：N/A（未改）。
- 命令原文与输出：E18 → CMD1 `Select-String -Path tools\*.js,tools\*.ps1 -Pattern '\.skip\(|\.only\(|eslint-disable|ts-ignore|ts-expect-error|noqa|SuppressWarnings'` → **空输出（0 命中）**，退出码 0；CMD2 `Select-String -Path tools\*.js -Pattern '(max|limit|budget|threshold|tolerance|timeout|retries|coverage)\w*\s*[:=]\s*\d+'` → 71 命中（抽样 25 行为 tools/tests 夹具与断言常量，非生产阈值放宽），退出码 0。

### 4.7 已知项引用（不重复论证，只引用编号）
- TD-015（fake DB 与真实云差异）；TD-033（`lib/tx` 事务冲突判定依赖错误自述）；TD-035（handler 级 AI 测试用 `globalThis.fetch` 替换）；TD-036（降级 DTO `source=NONE` 语义缝隙）；TD-037（create 白名单维护成本）；TD-038（AI 配额计数时点）；TD-040（listCustomer counts 500 截断）；TD-041（详情写动作每次换幂等键）；TD-043（todayCompleted 100 截断）；TD-044（关键词 300 窗口）；TD-045（`lib/time.toMs` 空值兜底 `Date.now()`；`_dto` 已防御）；TD-046（已关闭，admin 异常介入取消链）；TD-050（等值查询扫描窗）；TD-053~TD-057（注销/CLOSED 链路明账，cleanup/admin 域）；TD-058（单环境无 staging）。
- lessons 引用（已修/已登记，不重复报）：小写集合键（`COLLECTIONS` 大小写已统一）、嵌套对象整值替换、计数器首次取号预留 total（第 2 次并发建行仍见 R-A1-07）、二选一入参显式互斥、契约入参静默丢弃（batchActionId 已落库）、维护闸只拦写、清空时间戳兜底。
- STATE 风险节引用：风险 25/27（真实云首跑缺陷已修/复验）、风险 12（TD-033/TD-035/TD-037/TD-038 明账）——本 part 未重复论证。

---

## 5. 结论

① **各级计数**：P0 = **0**；P1 = **1**（R-A1-01）；P2 = **6**（R-A1-02~07）；P3 = **10**（R-A1-08~17）；合计 **17** 条。
② **依据未复现条数**：**4 条**（均已在问题影响栏注明"待验证"，不计入 P 级证据缺失）：
   1. R-A1-02"生产 100% 失败"为推断（缺微信真实端调用；代码形状证据已给）→ 待独立复核；
   2. R-A1-15 之外的"DB 错误文案透传日志可能含完整 openid"（`app.js:81-93,176`、`index.js:11` 会记录原始 `error.message/errMsg`，duplicate key/`-50200x` 文案可能带字段值；未触发真实 DB 错误获取原文）→ 未立 P 级，仅记录；
   3. R-A1-05/R-A1-07/R-A1-16 的并发交错未实测（fake DB 不模拟真实事务交错；静态证据为"无条件写/无 duplicate 重试分支"）→ 建议部署后在真实环境做一次并发冒烟（RUNBOOK 冒烟项）；
   4. R-A1-06 的"N+1 是否导致 10s 超时"缺真实环境时序（无预算基线、未压测）→ 上线观测慢查询/耗时后回填。
③ **旧问题三态**：**N/A（无旧报告）**。
④ **取代与废弃检查**：并行态登记簿 **0 行**（STATE 无该登记簿，E17）；废弃标记命中 **0**（E6 命令原文见上，空输出、退出码 0）；各条已申报判定 N/A；A1 未见旧实现并行保留（R-A1-08 是收敛残留死代码，已单列）。**未触发红灯**。
⑤ **建议色**：🔴 **红**（P1=1 ≥1，按简报 §3.7 矩阵；P0=0 但 P1 必须清零）。**审查者只给建议色，裁决是人**。
⑥ **本轮发现**：**17 条**；可行动 **17 条**（P1×1 建议本批清零；P2×6 建议本批消化或登记 TD；P3×10 建议随手修/登记/移交）。

**移交 / 未决 / 待独立复核**：
- **待独立复核（安全轴，入口→传播→终点已给全）**：R-A1-03（templateCode 伪造系统通知，已有运行时探针证据）、R-A1-02（msgSecCheck v2 缺参的生产影响）、R-A1-10（requestId 客户端可控/日志注入面）、R-A1-16（票据一次性并发面）。
- **建议 Lead 派独立验证者从源码反驳**：R-A1-01（双角色 P1，建议同时由 B1/B2 复核前端是否真的存在双角色入口）、R-A1-05（乐观锁并发）。
- **新欠账建议登记**：R-A1-05（乐观锁条件写）、R-A1-06（消息中心 N+1）、R-A1-07（计数器首行并发）、R-A1-14（schema 严格性）建议登记 `docs/TECH_DEBT.md`；R-A1-12 的文档回写需 Lead 授权单写者；R-A1-17 移交 C 轴（门禁漏检）。
- **已闭环不重复**：TD-040/041/043/044/045/050 等已知降级只作对照引用，未在本 part 重复论证。
- **范围外记录（属 A2/C）**：`handlers/admin/_test-accounts.js:40` 的 `msgSecCheck({content})` 参数形状（与 R-A1-02 同类，admin 域由 A2 判）；`tools/check.js` 判据缺口（R-A1-17 移交 C）。
