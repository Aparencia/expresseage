> 本条由 AI 生成（代码审查）

# 2026-10-22 · A2 后端治理审查（admin 23 动作 + cleanup 13 sweep + shared 纯件 + 云端副本/依赖）

## 0. 派单输入单

| 项 | 内容 |
| :-- | :-- |
| DESCRIPTION | 按 `docs/reviews/_parts/_REVIEW_BRIEF.md` 执行标准轴阶段 1 审查。范围：`cloudfunctions/api/handlers/admin/**`（26 文件）、`cloudfunctions/cleanup/**`（19 文件，不含生成副本）、`shared/**`（13 件纯件）、`cloudfunctions/*/shared/**` 生成副本一致性（只读核对 sync 脚本判据/哈希口径）、两个 `package.json` 依赖策略。 |
| PLAN_OR_REQUIREMENTS | `docs/V4_CONTRACT.md`（唯一口径）+ `docs/V4_DATA_MODEL.md`（字段/API/cleanup/审计）+ `docs/V4_UX_DEVELOPER.md`（后台页验收）+ `docs/ARCHITECTURE.md`（分层/冻结接口）+ `docs/V4_ENGINEERING.md`（§4.7/§4.8/§4.10/§4.11/§7 硬标准）+ `AGENTS.md`（§4/§5 纪律）+ `STATE.md`/`docs/TECH_DEBT.md`/`docs/lessons/`（查重）。 |
| BASE_SHA | `4b825dc642cb6eb9a060e54bf8d69288fbee4904`（空树；HEAD 全量新增等价基线）。 |
| HEAD_SHA | `9031d14cfc88b0cd8b03527da00ccc1f70a3e635`（开工实测 `git rev-parse HEAD` 一致）。 |
| 审查对象 | HEAD 全量新增 v4 生产代码（只读；未修改任何代码/配置，未做 git 写操作）。 |
| 基线读数（Lead 实跑，可引用） | node v24.21.0；`node tools/check.js` 31/31 PASS；`node tools/check-docs.js --batch 1` 10/10 PASS；`node tools/zero-money-scan.js` 0 命中。 |
| 本 part 产出 | 唯一写：`docs/reviews/_parts/2026-10-22_A2-backend-admin.md`（本文件）。 |
| 范围外 | `order/message/ai` 等业务域（A1）、前端页面（B1/B2）、`tools/**` 判据本体（C）、`docs/` 正文质量（阶段 3，规格轴 D）。范围外发现只记录不展开（见 §3.6）。 |

## 1. 开工回执（九项）

### 1.1 人话复述与落点

一句话：本 part 审「开发者后台治理面（23 个 admin 动作）+ 定时清理面（13 个 sweep）+ 全仓口径纯件（13 件 shared）+ 云端副本一致性 + 两个云函数依赖策略」，落点在本文件 §2 覆盖地图与 §3 问题清单，下一步 = Lead 聚合裁决（含 §5 未决项）。

### 1.2 假设清单

- 假设 1：`ADMIN_OPENIDS` 只存在云函数环境变量、由 `api` 云函数进程读取；若改由客户端/数据库取值则 §4 通过项中「ADMIN 身份解析」结论失效。
- 假设 2：`cleanup` 云函数只由定时触发器与云控制台调用（部署按 RUNBOOK §3.6 执行）；若另有客户端/HTTP 触达通道，§3.2 的 R-A2-06 影响面升级。
- 假设 3：真实云数据库支持 `db.command`（`gt/lt/gte/exists/in/neq/and/set`）与事务内 `where().update()`；若不支持，cleanup 部分 sweep 的到期条件会退化（已登记 TD-015，本 part 不重复论证，只引用）。
- 假设 4：审查期间其他并行审查者不修改本 part 范围代码（开工 `git status --porcelain` 仅见未跟踪的 `docs/research/`、`docs/reviews/`，无已跟踪文件改动；本 part 结束前未再改代码）。
- 假设 5：派单要求的「生成副本只做一致性核对、不逐行审业务」成立；若要求逐行审副本业务，§2.4 的覆盖口径改为部分覆盖。

### 1.3 澄清问题

- 本仓无 `docs/registry/APIS.md`/`docs/registry/DATA_DICT.md`（ENGINEERING E7 已裁）→ 按 N/A 处理，改用 `docs/V4_DATA_MODEL.md` §7 + `shared/error-codes.js` + `shared/actions.js` 作为契约对照（见 §4 错误码闸）。
- 识别失败「FIXED 记录到期处理」存在文档口径冲突（CONTRACT §11.1/§11.4/隐私文本 vs ENGINEERING §4.7 vs DATA_MODEL §10.2）→ 已在 §5 未决项单列，需 Lead 裁决后定 R-A2-01 的修复方式；不影响「当前实现与最高优先级文档不一致」这一事实。
- 后台列表页大小：DATA_MODEL §5.3 写 `admin 50`，UX_DEVELOPER 各页写「分页 20」，实现为 20 → 文档间冲突，按 §5 未决项交 Lead 裁决，不单独计问题（不重复报实现）。

### 1.4 锚点校验

```powershell
Select-String -Path STATE.md -Pattern '起点锚点'   # 空输出（EXIT=0）→ 本仓无「起点锚点」字段
git rev-parse HEAD                                  # EXIT=0 → 9031d14cfc88b0cd8b03527da00ccc1f70a3e635
git status --porcelain                              # EXIT=0 → 仅 "?? docs/research/" "?? docs/reviews/"
```

结论：按简报 §0 适配（无起点锚点字段、旧报告清单无）→ 以 HEAD 全量新增为基线，不向用户追问锚点。

### 1.5 diff 读取确认

- 全量新增基线，已读范围（逐行通读，行数=含空行的准确行数）：
  - `cloudfunctions/api/handlers/admin/**` **26 文件 / 3,828 行**（`_common 402`、`_dto 326`、`_test-account-ops 405`、`_test-accounts 205`、`_review 71` + 23 动作文件）；
  - `cloudfunctions/cleanup/**` **16 文件 / 1,846 行**（`index 41`、`run 150`、`db/{collections 26,dao 181}`、`sweeps/** 12 文件 1,448 行`）+ `package.json`；
  - `shared/**` **13 文件 / 2,024 行**（`actions 155`、`audit-actions 37`、`collections 38`、`enums 447`、`error-codes 48`、`error-copy 50`、`format 129`、`order-state 218`、`order-view 167`、`role 71`、`stations 128`、`validate 403`、`zones 133`）；
  - 关联只读：`api/router.js`、`api/app.js`、`api/bootstrap.js`、`api/index.js`、`middleware/{auth,audit,switch-session,validate,idempotency,ratelimit,index}.js`、`db/{config,dao,dto/mask}.js`、`lib/{errors,time}.js`、`cloudfunctions/api/shared/**`（16 件）、`cloudfunctions/cleanup/shared/**`（16 件）、`tools/sync-cloud-shared.js`、`tools/check.js`（#16/#17/#18/#23~#31）、`tools/selftest-admin.js`/`selftest-cleanup.js`（仅抽看断言口径，不审业务正确性）。
- 机械扫描覆盖：`node tools/sync-cloud-shared.js --check`（EXIT=0，16 源 × 2 套 hash 一致）；`Get-FileHash -Algorithm SHA256` 独立 32 项逐对比（全部 equal=True）；`npm view wx-server-sdk version`（EXIT=0，=4.0.2）；`node -e` 读取 `shared/actions` 计数（ALL 81 / CLIENT 66 / INTERNAL 15 / ADMIN_ALL 23 / CLEANUP 13，EXIT=0）。
- 未覆盖到的地方：本 part 无 ○；生成副本按派单只做一致性核对（业务逻辑以 `shared/**` 源件为准），依赖的 `node_modules` 不存在故未跑 `npm audit`（写 N/A+原因，见 §4）。

### 1.6 审查范围声明

只审本 part 派单范围及其直接关联调用（`api` 路由/中间件/`db/dto/mask`/`lib/{errors,time}`/副本同步脚本/两个 package.json）。前端页面（`pkg-admin/**`）、`tools/` 判据本体、`cloudfunctions/api/handlers/{order,message,ai,partner,...}` 不在本 part 展开；发现只记录在 §3.6「跨域观测（不计入本 part）」。

### 1.7 旧报告

无旧报告（`docs/reviews/` 本轮新建；`docs/reviews/_parts/` 开工时仅 `_REVIEW_BRIEF.md`）→ 旧问题三态 N/A。

### 1.8 引用检查清单原文

> 以下为本简报 §3 的判据原文（执行依据；术语“零金额”整体放行口径按本仓零金额门禁，标记词按门禁要求转义）。分节标题与条目文字照抄，仅对受文档门禁限制的字面做转义/固定术语替换，并在受影响处标注“（门禁转义）”。

**§3.2 七个固定维度（逐条给结论，审查对象=新增/修改代码；被删符号确认零残留引用）**

1. **接入性与装配**：每个新增/修改符号有调用点（`文件:行`）吗？路由/注册/依赖注入接上了吗？有 UI 时走三层链路：①路由/挂载注册 ②入口可达（哪个已有界面能点到？说不出=断）③交互元素绑定 handler 且链到业务逻辑。任一层断 = **P1**。前后端项目加查：请求/响应结构与 `docs/V4_DATA_MODEL.md` §7 契约一致（字段名/层级/类型）？仓内路由 = `app.json` 页面声明 + `cloudfunctions/api/router.js` + `shared/actions.js` 三处一致性。
2. **逻辑性**：空值/越界/并发重复提交/失败路径（不是空 catch）/入参校验，逐个新增与被修改函数过一遍；多步写操作事务边界（要么全成要么全败）；异步竞态与写接口幂等（重试/重复提交不产生脏数据）；时区与日期边界；『零金额』精度（本仓零金额口径，命中即 P0 级红线）。
3. **牵连性**：先赋值再搜（`Select-String` 找全调用方）；被修改符号的既有调用方行为兼容；被删符号零残留；四份文档需同步未同步：`docs/V4_DATA_MODEL.md`（接口/错误码）、`CHANGELOG.md`、`docs/TECH_DEBT.md`、`docs/ARCHITECTURE.md`（冻结接口）——任一不存在写 N/A + 原因。
4. **性能**：六类典型——N+1 查询/无界查询（缺 LIMIT）/循环内 IO/大列表重复渲染/请求路径同步长任务/无索引 WHERE；资源泄漏（未关闭连接/文件/定时器/事件订阅，前端 effect 未清理）。
5. **冗余死代码**：每个新增符号使用次数；复制粘贴只改名；永远真/假分支。疑似保留必须写理由。
6. **开发规范**：命名一致性/注释写 Why 不写 What/类型安全/函数 >50 行、文件 >500 行（工具已强制的门禁项不重复报，除非门禁漏检；测试文件豁免至 ≤1000 行）；提交信息格式（本仓 `^(feat|fix|docs|test|chore)\(v4\):`）；对照 ENGINEERING §7 + AGENTS §4 六条硬标准。
7. **安全**：新接口都鉴权了吗（前端隐藏≠后端校验，查水平越权）；注入/参数化；XSS（用户输入渲染前转义）；CSRF（小程序无浏览器 CSRF，可写 N/A+原因）；上传验类型大小/路径防 `../`；密码强哈希（本仓无密码，写 N/A+原因）；密钥硬编码/日志脱敏/CORS/debug/**依赖漏洞（本仓云函数仅 `wx-server-sdk`，本机无 node_modules → 无法 npm audit，写 N/A + 原因并核对 package.json/lockfile 是否存在）**；AI/agent 面**（本仓有服务端 AI 外呼：工具参数 allowlist/三值策略/审计）**；外部内容与凭据面**（密钥/token 引用禁止回显明文，发现处只记 `kind + 位置 + SHA-256[:8]`）。
   - 安全轴四条硬规则：①每条安全发现给「入口 → 传播 → 终点」三处 `文件:行`（缺一=未验证）；②`overall_severity ≤ impact.score`，未验证不得标严重度；③验证者身份分离：**你只写“待独立复核”**，Lead 派独立验证者从源码反驳；④格式错/缺字段的发现直接作废重做。
8. **条件维（按触发启用，不适用写 N/A + 原因）**：⑧ UI 可访问性（前端：状态齐全/对比度/触摸目标 44px/空态错误态）；⑨ 外部调用（本仓仅服务端 DeepSeek：适配层/显式超时/降级/重试）；⑩ 性能预算（热路径改动时；预算文件=ENGINEERING §2.3 体积预算；无预算 → 按维度 4 六类定性并标注“无预算基线”）；⑪ 数据隐私（本仓涉订单/头像/昵称/宿舍：D3/D4 字段加密？日志脱敏/用途限定/注销清除）。

**§3.3 气味基线（≥6 行，逐行给判据；判断题，给判断与理由，不给“违规”裁定）**

| 气味 | 判据 |
| :-- | :-- |
| 长函数 | 超过本仓行数上限（50/500/1000 行阈值） |
| 重复代码 | 同一段逻辑出现第 2 次 |
| 参数过多 | 参数 >4 个 |
| 发散式变化 | 一个文件因多个不相关原因被改 |
| 霰弹式修改 | 一个改动要动 >3 个文件 |
| 命名不达意 | 读名字猜不出行为 |

**§3.4 越界与取代废弃**

- 越界：语义性“顺手/顺便优化”→建议 revert；纯机械格式化→不 revert、说明工具来源、建议拆独立提交；出现 SCOPE 从未讨论的文件 → 红旗（本仓 SCOPE=CONTRACT §7 页面地图 + ARCHITECTURE §2 写作用域，可查）。
- **取代与废弃检查（命中即红灯）**：①并行实现未删（旧文件/旧函数/旧分支/旧常量 + `STATE.md` 无登记行；合法保留仅灰度/兼容契约/证据留存三种，证据留存答案=git 历史，工作树第二份副本即违规）；②新增行命中 `_old\b|_legacy|_v2\b|Deprecated|暂时保留|废弃|TO\x44O[:：]\s*(删|remove|delete)`（正文与命令逐字同一正则；`\x44`=D，门禁转义写法，正则语义等价）→ 必须写保留理由与删除条件，否则红灯。C 负责全仓扫描并贴命令原文+完整输出（空输出也贴，注明基线断言已通过）。

**§3.5 错误码闸**

新增错误码必须能在 `shared/error-codes.js` 与 `docs/V4_DATA_MODEL.md` §7 查到（给 `Select-String` 输出）。本仓无 `docs/registry/APIS.md` → 写 N/A + 原因（不静默跳过）。

**§3.6 降标守卫五查（C 全仓跑；其他人遇修复 diff 时跑，本轮无修复 diff 则写 N/A）**

①阈值被挪（行数/覆盖率/超时/重试/预算上限变大且无裁决）②测试变简单（`.skip/.only`、注释/删测试、精确断言换“不抛错就算过”）③检查器被静音（`ts-ignore`/`eslint-disable`/`noqa`/`SuppressWarnings`/报错吞空 catch）④阈值文件与失败功能同一次提交 ⑤工件大小放宽。

**§3.7 严重级与建议色（唯一判据）**

- P0 = 崩溃/数据丢失/安全漏洞｜P1 = 核心功能不可用（含装配断链）→ 二者必须清零｜P2 = 边缘功能报错/体验不佳｜P3 = 拼写/样式/非关键提示。不确定按 P2。
- 建议色矩阵：🔴 红 = P0≥1 或 P1≥1 或取代废弃命中（登记簿缺行/废弃标记未申报）；🟡 黄 = P0=P1=0 且有 P2/P3；🟢 绿 = P0=P1=0 且旧报告 P0/P1 全部核销（本轮 N/A）。**审查者只给建议色，裁决是人。**
- 核销计数：旧问题三态本轮 N/A；新发现每条须三件套（命令原文+退出码+命中行），缺 → 计入“依据未复现”栏，不进 P 级计数；“部分修”不存在（本轮无修复）。
- 去重：Lead 汇总时按 `文件:行 + 一句话事实` 去重；同一事实两轴都提只算一条。

### 1.9 派单输入单

见 §0（DESCRIPTION/PLAN_OR_REQUIREMENTS/BASE_SHA/HEAD_SHA 四要素逐字已录；不再重复）。

## 2. 覆盖地图

> 口径：`✓` 已审（含通读+机械核对）；`△` 已审且发现问题（见问题编号）；`—` 该文件在该维无审查对象（注册表/纯数据/部署配置行等）或条件维 9 全局 N/A（原因见 §3.0），非“未审”；`○` 未审（本 part 无）。行数为含空行准确行数（`[System.IO.File]::ReadAllLines` 计数）。条件维 9=外部调用、11=数据隐私；条件维 8/10 不适用（无前端 UI/无体量预算），在 §3.0 写 N/A 原因。
>
> 文档行号说明：本文件对 `docs/**` 的行号均为“审查时工作树快照”行号；审查期间并行同事修改了部分设计文档（`git status` 见 `M docs/V4_CONTRACT.md` 等），聚合时请以「§章节号 + 原文短语」为准，行号可能漂移。

### 2.1 `cloudfunctions/api/handlers/admin/**`（26 文件 / 3,828 行）

| 文件 | 行数 | 1 接入 | 2 逻辑 | 3 牵连 | 4 性能 | 5 冗余 | 6 规范 | 7 安全 | 9 | 11 | 备注/问题 |
| :-- | --: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-- |
| `index.js` | 31 | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | — | — | 23 动作注册与 router 双向核对通过 |
| `_common.js` | 402 | ✓ | △ | ✓ | △ | △ | △ | ✓ | — | — | R-A2-02/13/21/22/26；admin 闸/审计/分页共用件逐函数过 |
| `_dto.js` | 326 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ | 脱敏键集逐键过（无 openid/avatarFileId/L3） |
| `_review.js` | 71 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ | 上传者脱敏、通知幂等 |
| `_test-accounts.js` | 205 | ✓ | ✓ | ✓ | △ | ✓ | ✓ | ✓ | — | ✓ | R-A2-24（limit 100 全局） |
| `_test-account-ops.js` | 405 | ✓ | △ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ | R-A2-07/15（级联顺序/覆盖范围） |
| `bootstrap.js` | 95 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ | 15 唯一索引与实际索引清单一致（含 uk_tag_key） |
| `createInvites.js` | 136 | ✓ | ✓ | ✓ | ✓ | ✓ | △ | ✓ | — | — | R-A2-21（handler 58 行） |
| `revokeInvite.js` | 57 | ✓ | △ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | R-A2-08/13（条件更新/重放核对） |
| `listInvites.js` | 58 | ✓ | ✓ | ✓ | △ | ✓ | ✓ | ✓ | — | — | R-A2-02（offset 分页） |
| `listCustomers.js` | 91 | ✓ | △ | ✓ | △ | ✓ | ✓ | ✓ | — | ✓ | R-A2-02/03 |
| `getCustomer.js` | 70 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ | 脱敏详情；订单概览 7+1 查询 |
| `listPartners.js` | 93 | ✓ | △ | ✓ | △ | ✓ | ✓ | ✓ | — | ✓ | R-A2-02/03 |
| `setPartnerStatus.js` | 270 | ✓ | △ | ✓ | ✓ | ✓ | △ | ✓ | — | ✓ | R-A2-21（handler 90 行）；TD-055（非事务，引用不重复） |
| `listOrders.js` | 102 | ✓ | ✓ | ✓ | △ | ✓ | ✓ | ✓ | — | ✓ | R-A2-02 |
| `getOrder.js` | 44 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ | 脱敏详情+裁剪时间线 |
| `listAudit.js` | 91 | ✓ | △ | ✓ | △ | ✓ | ✓ | ✓ | — | ✓ | R-A2-02/04/18 |
| `updateConfig.js` | 192 | ✓ | △ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | R-A2-11/16 |
| `stats.js` | 145 | ✓ | ✓ | ✓ | △ | ✓ | ✓ | ✓ | — | ✓ | R-A2-04/24；统计排除测试数据 |
| `viewAsStart.js` | 235 | ✓ | ✓ | ✓ | ✓ | ✓ | △ | ✓ | — | ✓ | R-A2-21（handler 56 行）；签发/单活/限流/审计通过 |
| `viewAsEnd.js` | 43 | ✓ | △ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ | R-A2-05（失效目标不可达） |
| `testAccounts.js` | 274 | ✓ | △ | ✓ | ✓ | ✓ | △ | ✓ | — | ✓ | R-A2-13/14/21；dry-run/配额/审计通过 |
| `listRecognitionFailures.js` | 88 | ✓ | ✓ | ✓ | △ | ✓ | ✓ | ✓ | — | ✓ | R-A2-02 |
| `getRecognitionFailure.js` | 73 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ | 临时 URL+逐次审计通过（门禁 #27） |
| `fixRecognitionFailure.js` | 150 | ✓ | △ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ | R-A2-01（FIXED 不清原图引用） |
| `ignoreRecognitionFailure.js` | 81 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ | 备注必填/终态/审计通过 |

### 2.2 `cloudfunctions/cleanup/**`（16 文件 / 1,846 行 + package.json）

| 文件 | 行数 | 1 接入 | 2 逻辑 | 3 牵连 | 4 性能 | 5 冗余 | 6 规范 | 7 安全 | 9 | 11 | 备注/问题 |
| :-- | --: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-- |
| `index.js` | 41 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | △ | — | — | R-A2-06（入口无调用方鉴权） |
| `run.js` | 150 | ✓ | △ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | R-A2-12/25（静默跳过/审计 target 类型） |
| `db/collections.js` | 26 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | 未知集合名 fail-fast 通过 |
| `db/dao.js` | 181 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | 与 `api/db/dao.js` 语义成对（含 command.set 包裹） |
| `sweeps/index.js` | 33 | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | — | — | 13 个 sweep 注册数与契约一致 |
| `sweeps/_util.js` | 259 | ✓ | ✓ | ✓ | ✓ | △ | ✓ | ✓ | — | — | 引用计数/审计幂等/前缀区间过；eventDoc 8 参与气味项 |
| `sweeps/orders.js` | 140 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | 条件更新+事务+事件幂等通过 |
| `sweeps/storage.js` | 71 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | image.fileId 非空条件防批遮挡通过；TD-051 引用 |
| `sweeps/retention.js` | 161 | ✓ | △ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ | R-A2-09（单订单只清前 100 条留言/事件） |
| `sweeps/accounts.js` | 257 | ✓ | △ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ | R-A2-10/27（partnerNote 批量无进展/兜底 sweep 语义） |
| `sweeps/invitations.js` | 38 | ✓ | △ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | R-A2-08（非条件更新） |
| `sweeps/viewSessions.js` | 110 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ | 过期补写+一次性审计+7 天物理删通过 |
| `sweeps/counters.js` | 43 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | rl: 前缀区间+startsWith 兜底通过 |
| `sweeps/recognitionFailures.js` | 117 | ✓ | △ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ | R-A2-01（FIXED 不在到期分支） |
| `sweeps/testData.js` | 130 | ✓ | △ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ | R-A2-07/22/23（partner 侧绑定/UTC 日桶/断引用删文件） |
| `sweeps/stats.js` | 89 | ✓ | △ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | R-A2-23（>100 兼职时重算不收敛） |
| `package.json` | 9 | ✓ | — | ✓ | — | — | ✓ | ✓ | — | — | 依赖策略见 §2.5 |

### 2.3 `shared/**` 口径纯件（13 文件 / 2,024 行）

| 文件 | 行数 | 结论 | 覆盖说明 |
| :-- | --: | :-: | :-- |
| `actions.js` | 155 | ✓ | 81 动作（66 client + 15 internal）；23 admin 动作与 CONTRACT §5.3 同名同数；router 启动双向断言 |
| `audit-actions.js` | 37 | △ | 16 值对齐 CONTRACT/ENGINEERING 审计枚举（`P.AUDIT_ACTIONS` 门禁 #10 覆盖）；缺 CLEANUP 见 R-A2-18 |
| `collections.js` | 38 | ✓ | 14 集合与 CONTRACT §4/CONTRACT 表一致；单文档 config 固定 `_id='global'` |
| `enums.js` | 447 | ✓ | 七状态/取消原因/异常码/服务类型/七种编号/roomTag 大写字母表/审计外枚举等逐项与 DATA_MODEL §2/§8 对照 |
| `error-codes.js` | 48 | ✓ | 13 码与 DATA_MODEL §7.2 精确一致（见 §4 错误码闸） |
| `error-copy.js` | 50 | △ | 13 码文案齐全；RATE_LIMITED 文案见 R-A2-19；错前缀三句与 ids 口径同源 |
| `format.js` | 129 | ✓ | 时间/相对时间/锚+键/尾号展示；编号展示不在本文件重复拼装（与 ENGINEERING §5.3 一致） |
| `order-state.js` | 218 | △ | 七态转移表/动作矩阵/undo 5s/异常恢复与 CONTRACT §5/§8 一致；event:'UNDO' 见 R-A2-17 |
| `order-view.js` | 167 | ✓ | 四档排序唯一源（TD-017 关闭依据）、counts 六键、状态桶 |
| `role.js` | 71 | ✓ | 角色判定/兼职 ACTIVE/绑定方向/资料完整闸；无 admin 落库角色 |
| `stations.js` | 128 | △ | P1~P8 + 10 条别名（TD-025 已登记缺别名，不重复报）；多解归一缺陷见 R-A2-20 |
| `validate.js` | 403 | ✓ | 文本/编号/宿舍/取件码/尾号/取消/解绑/异常/确认文案/幂等键/版本号校验逐函数与 DTO 契约对照；截断策略与 §6.5 一致 |
| `zones.js` | 133 | ✓ | 五苑固定序与 D8 展示名；`canonicalRoom`/`parseDormKey`/`compareDormKey` 规则与 §4.5/§9 一致 |

### 2.4 生成副本一致性（2 × 16 件，只做一致性核对，不逐行审业务）

| 目标 | 文件数 | 结论 | 证据 |
| :-- | --: | :-: | :-- |
| `cloudfunctions/api/shared/**` | 16 | ✓ | `node tools/sync-cloud-shared.js --check` EXIT=0；独立 SHA256 逐件 equal=True |
| `cloudfunctions/cleanup/shared/**` | 16 | ✓ | 同上；`--check` 输出「写 0 件、删 0 件、已一致 32 件；hash 对帐 OK（16 件 × 2 套）」 |
| 源清单 | 16 = 13（shared）+ 3 别名源（`utils/ids.js`、`utils/room-tag.js`、`config/defaults.js`） | ✓ | `tools/sync-cloud-shared.js` `EXTRA_SOURCES` 逐项 |

### 2.5 依赖策略（两个 package.json）

| 文件 | 依赖 | 锁文件 | node_modules | 结论 |
| :-- | :-- | :-: | :-: | :-- |
| `cloudfunctions/api/package.json` | 仅 `wx-server-sdk: "4.0.2"`（精确锁版本，无 `^`） | 无 | 无 | ✓ 依赖白名单通过（门禁 #16 覆盖）；`npm audit` N/A（无 node_modules/lockfile，无法审计；已用 `npm view wx-server-sdk version` 实测 4.0.2 存在且为 registry 当前版本，EXIT=0） |
| `cloudfunctions/cleanup/package.json` | 仅 `wx-server-sdk: "4.0.2"` | 无 | 无 | 同上 |

### 2.6 覆盖缺口（○）

无。§2.1~§2.5 全部文件已通读/机械核对；条件维不适用项在 §3.0 写 N/A 原因。

## 3. 七维逐条结论

> 逐维给「结论 + 依据 + 问题编号」。P0=0；P1=1；P2=11；P3=16（详见 §3.1）。

1. **接入性与装配：通过。** 23 个 admin 动作用 `shared/actions.js` 唯一注册表：`node -e` 计数 `ADMIN_ALL=23`（含 `admin.bootstrap`）、`CLIENT 66`、`INTERNAL 15`（`admin.bootstrap`+`health.check`+13 个 `cleanup.*`）；`api/router.js:32-59` 启动时双向断言（缺注册/多注册/内部动作越界均 fail-closed），`handlers/admin/index.js:7-31` 与 registry 一一对应；`admin.bootstrap` 在 `INTERNAL_ALLOWED` 内且 handler 存在；13 个 cleanup 动作 = `shared/actions.js:102-116` 13 条 = `cleanup/sweeps/index.js:16-30` 13 个 sweep；两云函数 package.json 依赖与入口 `index.js` 对齐。问题：无 P1 级装配断链。
2. **逻辑性：有问题（1 P1 + 8 P2 + 4 P3）。** 逐函数过空值/越界/失败路径/幂等/事务/时区：`_common.requireAdmin` fail-closed、写动作幂等键统一 `auditRequestKey`、`viewAsStart` 单活覆盖/重放、`setPartnerStatus` 条件更新订单转异常（事务内）均通过；但存在识别失败 FIXED 到期分支缺失（R-A2-01）、列表查询内存过滤截断（R-A2-02）、昵称搜索语义（R-A2-03）、邀请码非条件更新（R-A2-08）、匿名化批次不收敛（R-A2-09/10）、审计重放跨动作（R-A2-13）、二次确认可绕过（R-A2-14）、级联顺序与注释相反（R-A2-15）、时区不单源（R-A2-23）、清理静默跳过（R-A2-12）等。
3. **牵连性：通过（含文档同步偏差）。** 被修改符号调用方已按 `Select-String` 全仓核对：`_common` 的导出除内部使用外，`scanPaged/maskText/truncateDetail` 零调用（R-A2-21）；`shared/**` 改动经 sync 脚本统一生成，两副本 hash 一致（§2.4）；`shared/audit-actions.js` 的审计值与 `admin.listAudit`/`cleanup/_util` 调用面一致但不含 CLEANUP（R-A2-18 已单列）。文档同步：DATA_MODEL §7/§10 与实现存在 3 处口径冲突（FIXED 留存、admin 页大小、测试账号删除 marker），均在 §5 未决项；`CHANGELOG.md`/`docs/TECH_DEBT.md`/`docs/ARCHITECTURE.md` 存在（无 N/A）。
4. **性能：有问题（3 P2 + 2 P3）。** 后台列表 5 个 handler 为「全表/大范围扫描 + 内存过滤 + offset/skip 翻页 + 扫描上限 500」（R-A2-02）；`getCustomer` 订单概览 7 次 count（可接受但非索引分桶）；cleanup `recomputeStats` 每轮最多 100 兼职且未变不推进游标（R-A2-23）；`testAccountsOfDeveloper`/`stats.testAccountsOf` 全局 limit 100 后内存过滤（R-A2-24）；无未关闭资源/定时器（云函数短生命周期；cleanup 未发现连接泄漏）。`stats.inviteBatches` 只取最近 100 条邀请码，批次计数为近似（归入 §5 未决观察项，未单列问题）。
5. **冗余死代码：有问题（1 P3）。** `_common.js` 的 `scanPaged`/`maskText`/`truncateDetail` 均为「定义+导出」零调用（命令见 R-A2-21），违反「新增导出必须有生产调用或先登记 TD」（AGENTS §5.4）；其余符号调用点齐全（`_test-account-ops` 专供 `testAccounts.js`，不属并行实现；`mask.js` 单源无旧副本）。
6. **开发规范：有问题（1 P3，门禁漏检项）。** 文件行数全部 ≤500（准确行数见 §2），但**函数 ≤50 行门禁 #18 仅做文件级**（`tools/check.js:494-506`），本 part 范围实测 5 个函数 >50 行（R-A2-21）；命名一致性：`_test-accounts.js`/`_test-account-ops.js` 与 `testAccounts.js` 分名语义可读；注释多为 Why，个别注释与实现不符（R-A2-15）；提交信息格式属 Lead 聚合项，本 part 不裁决。
7. **安全：有问题（1 P1 + 2 P2）。** 逐动作鉴权/越权/脱敏/审计矩阵见 §4：①`admin.*` 入口双重闸（`middleware/auth.js:127-132` + `_common.requireAdmin`）且不接受切换票据；②READONLY 拒写 + TEST_WRITE 仅测试目标由 `switch-session.js` + 每请求交叉校验实现；③后台 DTO 无 openid/avatarFileId/L3，审计 detail 禁值未命中；④日志零 PII（本 part 全部 `console.*` 已列，只含 action/sweep 名/错误码/requestId）；⑤18 处危险写动作均落 `admin_audit`（见 §4 矩阵）。问题：识别失败 FIXED 原图引用超期不清理（R-A2-01，隐私/安全，待独立复核）、cleanup 入口无调用方鉴权（R-A2-06，安全，待独立复核）、多开发者审计可见性（R-A2-04，治理隔离，待独立复核）。

### 3.0 条件维结论

- ⑧ UI 可访问性：**N/A**（本 part 无页面源码；后台页面属 B2）。
- ⑨ 外部调用：**N/A + 原因**——admin 域仅用平台能力 `cloud.getTempFileURL`/`cloud.deleteFile`（微信云开发 SDK，非第三方服务）；cleanup 域零外呼（`cloudfunctions/cleanup/**` 无 `fetch`/`https`/第三方 SDK；`Select-String -Path cloudfunctions\cleanup\**\*.js -Pattern 'fetch\(|https://'` 空输出，EXIT=0）。AI 外呼在 `handlers/ai` 与 `lib/ai`（A1 范围），本 part 无外呼面。
- ⑩ 性能预算：**N/A + 原因**——后端无体积预算文件；本 part 性能结论按维 4 六类定性（无预算基线）。
- ⑪ 数据隐私：**有问题**（R-A2-01/04/09/10 与 §4 隐私通过项）。本仓无字段级加密（DATA_MODEL §6.5 未要求；D3/D4 非加密裁决），隐私风险集中在「留存期限/后台脱敏/日志脱敏/注销清除/测试数据隔离」，本 part 逐项核过：日志零 PII、后台 DTO 脱敏、注销两阶段链、头像/截图引用计数删除均通过（已登记 TD-053/054/055/056/057/051 的已知缺口只引用不重复）。

### 3.1 问题清单汇总（编号-级别-位置）

| 编号 | 级别 | 位置（主） | 一句话事实 |
| :-- | :-: | :-- | :-- |
| R-A2-01 | P1 | `cleanup/sweeps/recognitionFailures.js:65`、`admin/fixRecognitionFailure.js:121-127`、`cleanup/sweeps/_util.js:139-155` | 识别失败 FIXED 记录的原图引用永不清理、记录本体永不物理删，与 CONTRACT §11.1/隐私文本「默认 30 天到期删除」不符（文档口径冲突待裁决） |
| R-A2-02 | P2 | `admin/listCustomers.js:65-67`、`listOrders.js:74-96`、`listPartners.js:56-79`、`listRecognitionFailures.js:59-74`、`listAudit.js:63-86`、`_common.js:18/289-300/336-343` | 后台列表全表/大范围扫描+内存过滤+offset/skip+扫描上限 500，违反 DATA_MODEL §5.3「禁止 skip/where({}) 全表扫描与客户端过滤」，数据量增长后搜索/翻页会静默漏结果 |
| R-A2-03 | P2 | `admin/listCustomers.js:41`、`listPartners.js:44` | 昵称搜索实现为完全相等，UX_DEVELOPER §5.1「昵称模糊搜索由服务端匹配」不可用 |
| R-A2-04 | P2 | `admin/listAudit.js:63-65/88`、`admin/stats.js:119-122/141` | 多开发者场景下审计默认全量可见（无 actor 过滤），与 UX_DEVELOPER AC-D-02「会话与审计互不可见」不符 |
| R-A2-05 | P2 | `middleware/switch-session.js:183-195`、`handlers/admin/viewAsEnd.js:21-24` | 目标账号失效后 `viewAsEnd` 不可达且不置 endedAt，黄条退出失败、会话滞留到过期（与已登记 TD-056 相邻但独立路径） |
| R-A2-06 | P2 | `cleanup/index.js:9-16`、`cleanup/run.js:96-113/123-142` | cleanup 云函数入口未校验调用来源（无 OPENID/触发器判断），具备该 appid 调试能力者可直调全量清理并写审计（安全，待独立复核） |
| R-A2-07 | P2 | `cleanup/sweeps/testData.js:20-23`、`:49-55` | 测试数据清理只按 `customerId` 收绑定，测试兼职侧（`partnerId`）绑定不清；失败原图删除无引用计数，可产生断引用 |
| R-A2-08 | P2 | `cleanup/sweeps/invitations.js:26-29`、`admin/revokeInvite.js:43-48` | 邀请码状态更新均 read-modify-write by `_id`，无 `status` 条件；DATA_MODEL §10.2 明确要求条件更新，并发下可产生 USED 被覆盖为 EXPIRED/REVOKED 的非法组合 |
| R-A2-09 | P2 | `cleanup/sweeps/retention.js:44/59-66` | 单订单匿名化只清首批 100 条留言/事件，写 anonymizedAt 后不再重访；>100 条时留言文本/fromId 在物理删前 30 天窗口残留 |
| R-A2-10 | P2 | `cleanup/sweeps/accounts.js:60-76` | `clearPartnerNotesOfCustomer` 每轮取前 100 条已清空行仍占位，未过滤 `partnerNote` 非空/未推进游标；顾客绑定 >100 条时第 101 条起永远清不到 |
| R-A2-11 | P2 | `admin/updateConfig.js:171-177/184-189` | CONFIG_UPDATE 审计 detail 只记 key 名（`{changed:true}`），不记变更前后关键值，DATA_MODEL §2.11「变更前后关键字段」不可追溯 |
| R-A2-12 | P2 | `cleanup/run.js:27-39` | `loadSweeps()` 吞 require 异常返回空数组 → 全量清理静默空转（仅一行 warn，runAll 仍 ok:true），无显式失败信号 |
| R-A2-13 | P3 | `admin/revokeInvite.js:29-32`、`updateConfig.js:166-170`、`setPartnerStatus.js:168-198`、`testAccounts.js:160-169` | 审计重放判定未核对 action/target，跨动作复用同一 clientRequestId 时出现假成功/审计缺失（`testAccounts.js:33-39` 是正确样例） |
| R-A2-14 | P3 | `admin/testAccounts.js:24-29` | 危险动作二次确认可被 `confirm:true` 布尔捷径绕过（契约要求 `confirmText` 文本确认） |
| R-A2-15 | P3 | `admin/_test-account-ops.js:259-298`（注释 `:3`） | 级联删除实际「先删数据、后结束会话」，与文件头注释及 ENGINEERING §4.8.3「先结束会话再删数据」相反；并发 TEST_WRITE 可留孤儿测试数据 |
| R-A2-16 | P3 | `admin/updateConfig.js:59-75/101-117`、`admin/_test-accounts.js:123` | 配置校验边界：`announcement` 接受 string（契约 object 含 updatedAt，写出即类型漂移且丢 updatedAt）；`zoneLabels` 放行任意字母键；苑列表在 admin 域硬编码两处，未取 `shared/zones.ZONES` 单源 |
| R-A2-17 | P3 | `shared/order-state.js:75`、`shared/enums.js:276-294` | `order.undo` 的 `event:'UNDO'` 不在 ORDER_EVENTS 16 值内（当前被 `order/undo.js` 的 `eventType` 覆盖掩盖），状态机单源存在非法事件类型 |
| R-A2-18 | P3 | `shared/audit-actions.js:8-34`、`cleanup/run.js:11`、`admin/listAudit.js:36-48`、DATA_MODEL §2.11 `:248` | 审计动作枚举缺 `CLEANUP`（系统任务），cleanup 自造常量；`admin.listAudit` 无法按 CLEANUP 过滤（会报 VALIDATION_FAILED） |
| R-A2-19 | P3 | `shared/error-copy.js:15`、`middleware/ratelimit.js:118` | RATE_LIMITED 兜底文案「半小时后」与全部按日配额不符（服务端当前显式传「明天再试」，一旦漏传即说假话） |
| R-A2-20 | P3 | `shared/stations.js:97-108` | 别名命中且文本同时包含多个正式名时只比较 `contained[0]`，可把多解文本归一为单一站点，违背「多解一律 ok:false」 |
| R-A2-21 | P3 | `admin/_common.js:303/351/362`、`:406/409/411`；`tools/check.js:494-506` | 冗余死代码 3 个函数零调用；函数 ≤50 行门禁漏检，本 part 5 个 handler 超限（setPartnerStatus 90 / deleteTestAccount 61 / createInvites 58 / purgeTestData 56 / viewAsStart 56 行） |
| R-A2-22 | P3 | `admin/_common.js:345-349`、`cleanup/sweeps/testData.js:111-112`、`lib/time.js:6/22`、`cleanup/sweeps/stats.js:65` | 时区不单源：admin.stats「今日」用服务器本地时区 `setHours(0,0,0,0)`；testData 审计日桶用 UTC；而同仓已固定 UTC+8（cleanup/stats 已正确实现），跨自然日边界可能错桶 |
| R-A2-23 | P3 | `cleanup/sweeps/stats.js:66-88` | recomputeStats 每轮只扫 `updatedAt asc` 前 100 兼职；stats 未变化不写库也不推进时间戳 → >100 兼职时第 101 起永不重算（统计缓存陈旧） |
| R-A2-24 | P3 | `admin/_test-accounts.js:58-65`、`admin/stats.js:29-45` | 测试账号列表/统计用「全局 limit 100 后在内存按开发者过滤/扣减」，多开发者或 >100 测试账号时配额、列表、统计计数偏低 |
| R-A2-25 | P3 | `cleanup/run.js:100`、DATA_MODEL §2.11 `:249` | CLEANUP 汇总审计的 `target.type='sweep_batch'` 不在契约 target 枚举（partner/customer/order/invitation_code/view_session/config/recognition_failure/test_account）内 |
| R-A2-26 | P3 | `admin/_common.js:130-142` 与各写 handler（`createInvites.js:116-132`、`updateConfig.js:178-189` 等） | admin 业务写与 admin_audit 非同一事务：审计写失败时副作用已生效并返回 INTERNAL_ERROR（治理审计缺口；重试可能重复副作用） |
| R-A2-27 | P3 | `cleanup/sweeps/accounts.js:231-264`、DATA_MODEL §7.8 `:741` | `testAccountsDeletion` 实现为「`TEST-` 前缀孤儿 customers 扫描清理」，与契约「被 `admin.deleteTestAccount` 标记的测试账号→级联删除」语义不一致（测试兼职孤儿无 customers 行不在兜底范围） |
| R-A2-28 | P3 | `.tool-versions`、ENGINEERING §4.4 `:210` | 两 package.json 已按精确版本 4.0.2 锁定（`npm view` 实测即当前版本），但 ENGINEERING §4.4 要求把实测版本回填 `.tool-versions`，当前该文件无 `wx-server-sdk` 行 |

计数：**P0=0 / P1=1 / P2=11 / P3=16，合计 28 条**；全部带证据三件套（见 §3.2~§3.4），必填依据缺失 0 条。安全类 3 条（R-A2-01/04/06）附「入口→传播→终点」三处定位与「待独立复核」（§3.5）。可行动（有明确修复落点）26 条；需 Lead 先裁决口径 2 条（R-A2-01/04）。

### 3.2 P1 问题

#### R-A2-01 · P1 · 识别失败 FIXED 记录的原图引用永不清理、记录本体永不物理删

- **位置**：`cloudfunctions/cleanup/sweeps/recognitionFailures.js:65`（到期分支状态集）、`cloudfunctions/api/handlers/admin/fixRecognitionFailure.js:121-127`（FIXED 写入且不触 `fileId`）、`cloudfunctions/cleanup/sweeps/_util.js:139-155`（引用计数/删文件）。
- **描述**：`activePass` 的到期处理状态集只有 `[IGNORED, PENDING]`；`anonymizedPass` 只覆盖 `uploaderOpenid===''`（上传者已注销）的记录。因此「已复核补录（FIXED）且上传者仍在」的记录：① `createdAt` 超过 `recognitionFailureRetentionDays` 后没有任何 sweep 处理；② 其 `fileId` 永不置空 → `countFileRefs` 中 `recognition_failures` 引用数永不为 0 → `deleteFileIfUnreferenced` 永不删云文件；③ 该记录文档本体的 `ocrTextMasked` 也永不物理删。这与 CONTRACT §11.1「识别失败原图与复核记录…默认 30 天…到期删除」、`docs/privacy/隐私保护指引.md:23`「到期由定时任务删除原图引用并置为已处理」不一致；但 ENGINEERING §4.7 `:362` 写「到期条件…且 `status≠FIXED`」、DATA_MODEL §10.2 `:845` 写「到期置 IGNORED 保留记录」，两处与 CONTRACT 冲突，且 `tools/selftest-cleanup.js:794` 已把「FIXED 终态不动」写成断言 → 属**文档口径冲突 + 实现跟随低优先级文档**，需 Lead 裁决。按 AGENTS §1「任何文档与 CONTRACT 冲突，以 CONTRACT 为准」判为 P1（隐私承诺偏差；若裁决认 ENGINEERING 优先，则降 P2 并同步改隐私文本）。
- **影响**：识别失败复核是失败路径的常态闭环（开发者通常补录成 FIXED），大多数原图（L3 截图）将永久留在云存储并持续被记录引用；后台复核页仍可按 `failureNo` 签发临时 URL 查看超期原图；对外隐私承诺「30 天删除」不成立。
- **修复建议**：到期分支纳入 FIXED（至少 `fileId` 置空 + 未引用即删文件；记录本体是否物理删按裁决）；同步 `tools/selftest-cleanup.js` §L 断言与 CONTRACT/ENGINEERING/DATA_MODEL/隐私文本口径；若保留 FIXED 记录，需在隐私文本写明例外。
- **证据**（命令 + 退出码 + 命中行）：
  ```powershell
  Select-String -Path cloudfunctions\cleanup\sweeps\recognitionFailures.js -Pattern 'const statuses = '   # EXIT=0 → :65
  Select-String -Path cloudfunctions\api\handlers\admin\fixRecognitionFailure.js -Pattern 'FAILURE_STATUS.FIXED'  # EXIT=0 → :107/:122/:144（:121-127 update 无 fileId）
  Select-String -Path cloudfunctions\cleanup\sweeps\_util.js -Pattern 'failures = await ctx.dao.count'  # EXIT=0 → :142
  Select-String -Path cloudfunctions\cleanup\sweeps\recognitionFailures.js -Pattern 'uploaderOpenid === '  # EXIT=0 → :77（未匿名记录才处理）
  Select-String -Path docs\V4_ENGINEERING.md -Pattern 'status≠FIXED'  # EXIT=0 → :362
  Select-String -Path docs\V4_CONTRACT.md -Pattern '识别失败原图与复核记录'  # EXIT=0 → :496
  Select-String -Path docs\privacy\隐私保护指引.md -Pattern '识别失败原图与复核记录'  # EXIT=0 → :23
  Select-String -Path tools\selftest-cleanup.js -Pattern 'FIXED 终态不动'  # EXIT=0 → :794（断言已锁定现行为）
  ```
- **安全发现（三处）**：入口 = `handlers/admin/fixRecognitionFailure.js:121-127`（FIXED 终态写入、不触 `fileId`）；传播 = `cleanup/sweeps/recognitionFailures.js:63-73`（到期状态集排除 FIXED 且 `:77` 排除匿名记录）；终点 = `cleanup/sweeps/_util.js:146-155`（引用计数含 FIXED 记录 → 永不为 0，文件不删）。**待独立复核。**

### 3.3 P2 问题

#### R-A2-02 · P2 · 后台列表查询模式：全表/大范围扫描 + 内存过滤 + offset/skip + 扫描上限 500

- **位置**：`cloudfunctions/api/handlers/admin/_common.js:18`（`MAX_SCAN=500`）、`:289-300`（`parsePage` 默认 20）、`:336-343`（`findPage` 用 `skip: offset`）；`listCustomers.js:65-67`（`findPage(..., {}, ...)` 全表 where）、`:71-81`（内存测试标记/关键词过滤）、`:88`；`listOrders.js:74-96`；`listPartners.js:56-79`；`listRecognitionFailures.js:59-74`；`listAudit.js:63-86`（action 过滤在内存）。
- **描述**：DATA_MODEL §5.3 `:539` 明确「游标分页、禁止 `skip`」「页大小…admin 50」，`:540` 明确「每个新增查询必须登记 §5.2 并命中索引…禁止 `where({})` 全表扫描与客户端过滤」。实现为：默认 `limit=20`（与 UX 各页「分页 20」一致、与 DATA_MODEL admin 50 冲突，属文档冲突）、游标形态 `{offset}` + `skip`、`where({})` 全集合扫描、关键词/测试标记/action 在内存过滤，并用 `MAX_SCAN=500` 截断。当集合行数或过滤前的行数超过 500 时，循环耗尽后 `nextCursor=null` → 后台搜索/翻页**静默漏结果**（尤其 `listAudit` 按 action 过滤、`listOrders` 关键字/状态过滤）；同时反模式带来每页多次大范围读。
- **影响**：数据量增长后后台治理/审计检索结果不完整且无报错；与后台“可枚举/可追溯”定位相悖；真实云 DB 慢查询成本上升。
- **修复建议**：按 DATA_MODEL §5.2 为每页查询建立索引命中路径（如 audit `action,at desc`、orders `status,statusUpdatedAt`/`isTest,status,statusUpdatedAt`、customers `customerNo` 精确/`dormKey` 精确/`displayName` 前缀、partners `partnerNo` 精确），游标改 `(sortValue,orderNo)`；测试数据过滤进 where；页大小按裁决统一后回写 DATA_MODEL/UX。
- **证据**：
  ```powershell
  Select-String -Path cloudfunctions\api\handlers\admin\_common.js -Pattern 'MAX_SCAN = |skip: offset|function parsePage'   # EXIT=0 → :18/:340/:289
  Select-String -Path cloudfunctions\api\handlers\admin\listCustomers.js -Pattern 'findPage\(scope'                          # EXIT=0 → :67（where={}）
  Select-String -Path cloudfunctions\api\handlers\admin\listOrders.js,cloudfunctions\api\handlers\admin\listPartners.js -Pattern 'findPage\(scope'  # EXIT=0 → :78/:60
  Select-String -Path docs\V4_DATA_MODEL.md -Pattern '禁止 `skip`'                                                          # EXIT=0 → :539
  Select-String -Path docs\V4_DATA_MODEL.md -Pattern '全表扫描与客户端过滤'                                                  # EXIT=0 → :540
  ```

#### R-A2-03 · P2 · 顾客/兼职昵称搜索实现为完全相等，UX 要求服务端模糊匹配

- **位置**：`cloudfunctions/api/handlers/admin/listCustomers.js:41`、`cloudfunctions/api/handlers/admin/listPartners.js:44`。
- **描述**：`row.displayName === keyword`（去首尾空白后完全相等才命中）。UX_DEVELOPER `:209`/`:438` 写明「昵称模糊搜索由服务端匹配、列表只显示脱敏昵称」。由于昵称列表本身脱敏展示，管理员只能靠“记得完整昵称”检索，实际不可用。
- **影响**：后台按昵称定位顾客/兼职失败（排障与治理效率），易被误判为“数据不存在”。
- **修复建议**：改为服务端包含匹配（`db.RegExp`/前缀索引方案按 DAO 能力；若 DAO 暂不支持，登记 TD 并在页面文案如实说明），同时保持列表脱敏。
- **证据**：
  ```powershell
  Select-String -Path cloudfunctions\api\handlers\admin\listCustomers.js,cloudfunctions\api\handlers\admin\listPartners.js -Pattern '=== keyword'   # EXIT=0 → :41/:44
  Select-String -Path docs\V4_UX_DEVELOPER.md -Pattern '昵称模糊搜索'                                                                              # EXIT=0 → :209
  ```

#### R-A2-04 · P2 · 多开发者场景审计默认全量可见，与 UX「会话与审计互不可见」不符

- **位置**：`cloudfunctions/api/handlers/admin/listAudit.js:63-65`（`where` 默认为空）、`:88`（action 过滤在内存）；`cloudfunctions/api/handlers/admin/stats.js:119-122/141`（`recentAudit` 无 actor 过滤）。
- **描述**：CONTRACT §1.1 `:50` 写明多开发者「各自登录、各自独立会话与审计（`admin_view_sessions` 按 `adminOpenid` 隔离）」；UX_DEVELOPER `:126`/`:634` 验收口径为「`DEV-01`/`DEV-02` 会话与审计互不可见」。实现 `listAudit` 只有可选的 `developerNo` 入参（且可主动传他人编号查询），默认返回全部开发者审计；`stats.recentAudit` 同样全量。会话侧无列表接口、仅 `activeSwitchSessions` 聚合计数（无个体泄漏），审计是唯一可见性缺口。
- **影响**：多开发者部署时（P1 可配 `DEV-02…`），不同开发者可读取彼此的治理操作目标/detail；审计归因虽在 `developerNo` 字段，但可见性隔离未实现。
- **修复建议**：按裁决默认 `where.developerNo = scope.developerNo`，或仅当显式许可时跨开发者查询；`stats.recentAudit` 同步过滤；补 selftest 多开发者断言；回写 CONTRACT/UX 口径。
- **证据**：
  ```powershell
  Select-String -Path cloudfunctions\api\handlers\admin\listAudit.js -Pattern 'const where = \{\}|if \(developerNo\)'   # EXIT=0 → :63-65
  Select-String -Path cloudfunctions\api\handlers\admin\stats.js -Pattern 'recentAuditRows'                            # EXIT=0 → :119/:141
  Select-String -Path docs\V4_UX_DEVELOPER.md -Pattern '审计互不可见'                                                   # EXIT=0 → :126/:634
  ```
- **安全发现（三处）**：入口 = `admin/listAudit.js:50-90`（handler 无 actor 约束）；传播 = `:63-65`（空 where 全量查询）→ `_dto.auditBrief:205-214`（返回 target/detail）；终点 = `admin/stats.js:119-141`（总览内嵌最近审计同样全量）。**待独立复核。**

#### R-A2-05 · P2 · 目标账号失效后 `admin.viewAsEnd` 不可达且会话不置 endedAt

- **位置**：`cloudfunctions/api/middleware/switch-session.js:183-195`（EXIT 动作同样先 `resolveReadonlyTarget`/`resolveTestWriteTarget`）、`:58-83`（目标校验失败抛 `targetNotFound`）、`cloudfunctions/api/handlers/admin/viewAsEnd.js:21-24`（handler 永远收不到该请求，除非中间件通过）。
- **描述**：`isExit` 分支只放宽动作范围（`assertModeScope` 跳过），但目标解析在 `:183-185` 仍然执行；READONLY 顾客/兼职在会话有效期内被停用/注销（如 `admin.setPartnerStatus(SUSPENDED)`）后，退出请求先命中 `targetNotFound`（NOT_FOUND），`viewAsEnd` handler 不可达 → `endedAt` 不写、`ACCOUNT_SWITCH_END` 不落；客户端只在 `VIEW_TICKET_EXPIRED` 清 `viewContext`（`api/client.js:134-135`），收到 NOT_FOUND 不清内存票据 → 黄条退出持续失败直到票据过期。另：DATA_MODEL §2.13 `:284` 不变量③要求「目标仍 ACTIVE，否则 FORBIDDEN 并置 endedAt」，实现对失效目标既不置 endedAt 也不是 FORBIDDEN（ENGINEERING §4.8.2 `:37` 又写 NOT_FOUND），属文档冲突下实现取舍。
- **影响**：只读视角“黄条退出”在目标失效时不可用（体验），会话数虚高、审计缺 END 记录；与已登记 TD-056（兼职 CLOSED 后会话不立即 endedAt）相邻，但本条是“失效后退出路径不可达”，修复点不同（不在 `setPartnerStatus` 而在中间件/客户端），故单列。
- **修复建议**：EXIT 动作跳过目标解析（直接校验票据发起人后放行到 handler）；或在目标解析失败时仍执行 `endedAt` 写入 + 记 END（reason=TARGET_INVALID）后再抛；客户端对 NOT_FOUND 的会话失效清 `viewContext`（B2 域，引用）。
- **证据**：
  ```powershell
  Select-String -Path cloudfunctions\api\middleware\switch-session.js -Pattern 'const isExit|const target = session'   # EXIT=0 → :172/:183-185
  Select-String -Path cloudfunctions\api\middleware\switch-session.js -Pattern 'async function resolveReadonlyTarget'  # EXIT=0 → :58
  Select-String -Path docs\V4_DATA_MODEL.md -Pattern '目标仍 `ACTIVE`'                                                 # EXIT=0 → :284
  Select-String -Path api\client.js -Pattern 'VIEW_TICKET_EXPIRED'                                                    # EXIT=0 → :134-135
  ```

#### R-A2-06 · P2 · cleanup 云函数入口无调用方鉴权（安全）

- **位置**：`cloudfunctions/cleanup/index.js:9-16`（`exports.main` 直接 `cloud.init` → 组装 ctx → `runner.runAll`；未取 `getWXContext`、未校验触发器/部署来源）、`cloudfunctions/cleanup/run.js:96-113`（写 CLEANUP 审计）、`:123-142`（无条件执行全部 sweep）。
- **描述**：两云函数同环境部署；小程序端 `wx.cloud.callFunction({name})` 不限定函数名，具备该 appid 开发者工具/云调用能力的人可直调 `cleanup` 函数。cleanup 为 internal 能力（`shared/actions.js:99-116` 全部 internal；ENGINEERING §4.2 `:227` 要求「不对客户端开放」），但该边界只在 `api` router 内生效，cleanup 部署单元入口自身没有任何调用方校验：一次调用会跑全部 13 个 sweep 并写一条 CLEANUP 审计。影响限于成本/审计灌水/加速到期清理（到期条件仍幂等、不读业务数据、结果仅返回聚合计数），不具备数据外泄能力。
- **影响**：非授权触发内部任务（可反复调用造成云函数调用量与审计写入放大；审计表可被灌水）。
- **修复建议**：入口校验 `cloud.getWXContext().OPENID` 为空（触发器/控制台无 OPENID）或 `event.Type === 'Timer'`/部署令牌，否则返回 `FORBIDDEN` 且不执行 sweep；在 RUNBOOK 部署节写明该防护。
- **证据**：
  ```powershell
  Get-Content cloudfunctions\cleanup\index.js | Select-Object -First 20        # 无 getWXContext/类型判断（见 :9-16）
  (Get-ChildItem cloudfunctions\cleanup -Recurse -File -Filter *.js | Where-Object { $_.FullName -notmatch '\\shared\\' } | Select-String -Pattern 'getWXContext|TriggerName|event\.Type').Count   # EXIT=0 → 0
  Select-String -Path cloudfunctions\cleanup\run.js -Pattern 'async function runAll'   # EXIT=0 → :123
  Select-String -Path shared\actions.js -Pattern "'cleanup\."                          # EXIT=0 → :103-115（13 条 internal）
  ```
- **安全发现（三处）**：入口 = `cloudfunctions/cleanup/index.js:9-16`（无身份/来源校验）；传播 = `cloudfunctions/cleanup/run.js:123-142`（无条件遍历执行 13 个 sweep）；终点 = `cloudfunctions/cleanup/run.js:86-121`（写 admin_audit）+ 各 sweep 删/改到期数据（如 `sweeps/storage.js:50-73`、`sweeps/retention.js:80-152`）。**待独立复核。**

#### R-A2-07 · P2 · cleanup.testData 未清测试兼职侧绑定 + 原图删除无引用计数

- **位置**：`cloudfunctions/cleanup/sweeps/testData.js:20`（`bindings` 只按 `customerId=openid` 查）、`:16-19`（订单已按 partnerId 双查，绑定未同步）、`:49-55`（失败记录 `fileId` 直接 `deleteFileSafe`，未走 `_util.countFileRefs`）；契约要求见 DATA_MODEL §7.8 `:741`（逐测试账号清「订单/事件/留言/绑定/失败记录/头像文件」）。
- **描述**：测试**兼职**账号的绑定关系在 `bindings.partnerId` 侧，`testDataOf` 只收 `customerId` 侧 → 测试兼职的绑定永不清理（若对侧测试顾客先被清理会顺带清掉，否则残留）。同时失败原图文件直接删、未做引用计数：同一 `fileId` 被多张测试订单/多条失败记录共享时（一图多码场景），删除仅覆盖前 100 条记录后即删文件，其余未清记录/订单的 `image.fileId` 变悬空引用。
- **影响**：测试数据超 30 天清理承诺不完整（合成数据，无真实隐私泄漏）；断引用导致后续图片读取失败（仅测试面）。
- **修复建议**：绑定查询补 `partnerId = partner._id` 并合并去重；原图删除改用 `_util.deleteFileIfUnreferenced`；补 selftest-cleanup 正反例。
- **证据**：
  ```powershell
  Select-String -Path cloudfunctions\cleanup\sweeps\testData.js -Pattern 'const bindings =|partnerOrders = '   # EXIT=0 → :20/:18
  Select-String -Path cloudfunctions\cleanup\sweeps\testData.js -Pattern 'deleteFileSafe'                      # EXIT=0 → :53/:66
  Select-String -Path cloudfunctions\cleanup\sweeps\_util.js -Pattern 'function deleteFileIfUnreferenced'      # EXIT=0 → :146（存在但未被 testData 使用）
  Select-String -Path docs\V4_DATA_MODEL.md -Pattern '逐 个测试账号清其'                                      # EXIT=0 → :741
  ```

#### R-A2-08 · P2 · 邀请码状态更新缺少条件更新（cleanup 与 revokeInvite）

- **位置**：`cloudfunctions/cleanup/sweeps/invitations.js:26-29`（按 `_id` 无条件 update 为 EXPIRED）、`cloudfunctions/api/handlers/admin/revokeInvite.js:43-48`（按 `_id` 无条件 update 为 REVOKED；判断在 `:37-42` 读后做）。
- **描述**：DATA_MODEL §10.2 `:842` 明确「`status='UNUSED' && expiresAt<now → 条件更新 EXPIRED`」；DATA_MODEL §4.3 `:369` 状态机要求仅 UNUSED 可作废。实现是 read-modify-write：扫描时 UNUSED，随后 `partner.activate` 事务写 USED，cleanup 再按 `_id` 覆盖为 EXPIRED（或 admin 作废覆盖为 REVOKED）→ 产生「USED/EXPIRED/REVOKED 同时带 usedBy」的非法组合。窗口小（sweep 每 10 分钟、事务毫秒级）但为真实竞态。
- **影响**：邀请码状态机被破坏，后台状态与实际使用不一致，审计/排查误导。
- **修复建议**：两处改 `updateWhere({_id, status: UNUSED}, {...})` 并按 `updated===1` 判定（命中 0 视为对手先动，跳过）；补 selftest-cleanup 并发反例。
- **证据**：
  ```powershell
  Select-String -Path cloudfunctions\cleanup\sweeps\invitations.js -Pattern 'await ctx.dao.update'   # EXIT=0 → :26
  Select-String -Path cloudfunctions\api\handlers\admin\revokeInvite.js -Pattern 'await scope.dao.update'  # EXIT=0 → :43
  Select-String -Path docs\V4_DATA_MODEL.md -Pattern '条件更新 EXPIRED'                              # EXIT=0 → :842
  ```

#### R-A2-09 · P2 · 匿名化对单订单只清首批 100 条留言/事件后不再重访

- **位置**：`cloudfunctions/cleanup/sweeps/retention.js:59-66`（`find` 均 `limit: util.BATCH=100`），`:44`（同一次调用即写 `anonymizedAt`），`:84-98`（`anonymizePass` 以 `anonymizedAt` 存在为幂等键，不再重访）。
- **描述**：DATA_MODEL §10.3 `:856` 要求 `order_messages.text='[已删除]'`、`fromId=''`、`order_events.actorId=''`、`payload` 只留非 PII。单订单若留言/事件 >100 条，匿名化只清前 100 条且记录已置 `anonymizedAt` → 其余条目的 `fromId`（openid）/留言文本会保留到 30 天后订单物理删；此窗口内匿名化不彻底。
- **影响**：隐私留存口径偏差（极端量级：单订单留言上限 30 条/日、多日订单或多次改码可超 100 条）。
- **修复建议**：匿名化改为循环分批至清空（以「是否仍有匹配行」为游标，而非一次 limit），或在订单物理删前的每轮 retention 增加「已匿名化订单仍残留 messages/events」补清 pass；补 selftest 反例（>100 条）。
- **证据**：
  ```powershell
  Select-String -Path cloudfunctions\cleanup\sweeps\retention.js -Pattern 'ORDER_MESSAGES|ORDER_EVENTS|limit: util.BATCH|anonymizedAt: nowDate'  # EXIT=0 → :59/:61/:63/:65/:44
  Select-String -Path docs\V4_DATA_MODEL.md -Pattern "text='\[已删除\]'"                                                                        # EXIT=0 → :856
  ```

#### R-A2-10 · P2 · 顾客注销的 bindings.partnerNote 批量清理无进展过滤

- **位置**：`cloudfunctions/cleanup/sweeps/accounts.js:60-76`（`find` where `{customerId}` + `orderBy boundAt asc` + `limit 100`；`:69-71` 对已清空行 `continue`，无 offset/条件推进）。
- **描述**：DATA_MODEL §10.3 `:856` / CONTRACT §11.4 `:520` 要求顾客注销时清空历史（含 RELEASED）`bindings.partnerNote`。实现每轮固定取「boundAt 最早 100 条」；这批清空后仍满足查询条件（`partnerNote` 为空也命中），下一轮依旧返回同 100 条并全部 `continue` → 第 101 条起永不清理。
- **影响**：绑定 >100 条的顾客注销后，兼职私有备注（L2，可能含个人约定/称呼）残留至 30 天物理删。
- **修复建议**：查询加 `partnerNote` 非空条件（`command.neq('')` 或退化为按 `_id` 游标分页直到不命中），并补 selftest-deletion 数据量反例。
- **证据**：
  ```powershell
  Select-String -Path cloudfunctions\cleanup\sweeps\accounts.js -Pattern 'function clearPartnerNotesOfCustomer|if \(!rows\[i\]\.partnerNote\)|limit: util.BATCH'  # EXIT=0 → :60/:69/:65
  Select-String -Path docs\V4_DATA_MODEL.md -Pattern '顾客注销删 `partnerNote`'                                                                                   # EXIT=0 → :856
  ```

#### R-A2-11 · P2 · CONFIG_UPDATE 审计不记变更前后关键值

- **位置**：`cloudfunctions/api/handlers/admin/updateConfig.js:171-177`（`changes[key] = { changed: true }`）、`:184-189`（写审计 detail）。
- **描述**：DATA_MODEL §2.11 `:250` 规定 `admin_audit.detail` = 「变更前后关键字段」。CONFIG_UPDATE 是最高风险的治理动作之一（留存期限/头像上限/隐私版本/维护模式），当前审计只能看出“哪些 key 改过”，看不出改成了什么，事后无法从审计还原配置（需另查库快照）。
- **影响**：治理可追溯性缺口（US-D6）；若配置被误改，审计不能自证变更内容。
- **修复建议**：detail 记脱敏后的 before/after 关键值（长度/枚举/数值，长文本只记长度/摘要），如 `{key:{before,after}}`；补 selftest 断言。
- **证据**：
  ```powershell
  Select-String -Path cloudfunctions\api\handlers\admin\updateConfig.js -Pattern 'changes\[key\] = '   # EXIT=0 → :176
  Select-String -Path docs\V4_DATA_MODEL.md -Pattern '变更前后关键字段'                              # EXIT=0 → :250
  ```

#### R-A2-12 · P2 · cleanup 注册表加载失败被静默吞掉（全量清理空转仍返回 ok）

- **位置**：`cloudfunctions/cleanup/run.js:27-39`（`loadSweeps()` `catch` 后 `console.warn` 返回 `[]`）、`:123-142`（`runAll` 用空列表照常汇总并写 CLEANUP 审计，返回 `ok:true`）。
- **描述**：若任一 sweep 模块在冷启动 require 阶段抛错（语法/依赖/Node 版本不兼容），`loadSweeps` 会返回空数组 → 本轮 0 个 sweep、`total:0/failed:0`、写一条 CLEANUP 审计、函数返回成功。清理任务（截图留存/注销删除/会话过期/识别失败原图）全部静默停摆，运维只能从一行 warn 日志发现；RUNBOOK 观测口径依赖 `failed>0`/两轮 acted，此处都不会出现。与 lessons「cleanup 域无测试 = 全域运行必崩」同类风险的另一面（从“崩”变“静默空转”）。
- **影响**：清理链路静默失效，隐私留存承诺/数据膨胀无显式失败信号。
- **修复建议**：sweeps 源或数量为 0 时本轮返回失败（`ok:false`/抛错）并告警，或至少写 `failed:1` 的 CLEANUP 审计；入口 `index.js` 已区分装配失败，注册表失败也应同等级。
- **证据**：
  ```powershell
  Select-String -Path cloudfunctions\cleanup\run.js -Pattern 'sweeps 注册表未就绪|function loadSweeps|function runAll'  # EXIT=0 → :36/:27/:123
  Select-String -Path tools\selftest-cleanup.js -Pattern 'SWEEPS'                                                       # EXIT=0（测试注入替身，不复现注册表缺失）
  ```

### 3.4 P3 问题

#### R-A2-13 · P3 · 审计重放判定未核对 action/target（跨动作复用幂等键时假成功/审计缺失）

- **位置**：`admin/revokeInvite.js:29-32`（任一审计命中即返回 `REVOKED duplicated`，不核对 action/detail）、`admin/updateConfig.js:166-170`、`admin/setPartnerStatus.js:168-198`（`replayOf` 只按 `target.id` 找 partner，不核对 action）、`admin/testAccounts.js:160-169`（`deleteTestAccount` 重放不核对目标）；正确样例 `testAccounts.js:33-39`（显式核对 `record.action === action`）。
- **描述**：`admin_audit.requestKey` 唯一键 = `{adminOpenid}:{clientRequestId}`（`middleware/idempotency.js:20-22`），跨 admin 写动作共用同一命名空间。若客户端对两个不同动作复用同一 `clientRequestId`（shipped 页面不会，防御性场景），后一动作会命中前一动作的审计记录：revokeInvite 返回假 `REVOKED` 而实际未作废且不写审计；updateConfig 返回 `duplicated` 但配置未改；setPartnerStatus 会把前一动作 target 当作本次结果返回。业务副作用静默丢失。
- **影响**：低频/防御性幂等缺陷；治理动作被静默 no-op 且无审计，属可追溯性风险（不构成越权：调用者须已通过 admin 白名单）。
- **修复建议**：统一 helper 核 `record.action === action`（必要时再核 target id），与 `testAccounts.js` 口径一致；补 selftest 反例。
- **证据**：
  ```powershell
  Select-String -Path cloudfunctions\api\handlers\admin\revokeInvite.js,cloudfunctions\api\handlers\admin\updateConfig.js -Pattern 'const replay = await scope.findAudit'  # EXIT=0 → :29/:167
  Select-String -Path cloudfunctions\api\middleware\idempotency.js -Pattern 'function auditRequestKey'  # EXIT=0 → :20-22
  Select-String -Path cloudfunctions\api\handlers\admin\testAccounts.js -Pattern 'record.action !== action'  # EXIT=0 → :35（正确样例）
  ```

#### R-A2-14 · P3 · 危险动作二次确认可被 `confirm:true` 绕过

- **位置**：`cloudfunctions/api/handlers/admin/testAccounts.js:24-29`（`confirmedBy` 在 `input.confirm === true` 时直接通过）。
- **描述**：DATA_MODEL §7.6 `:718-719` 规定 `deleteTestAccount` 需 `confirmText:'删除'`、`purgeTestData` 需 `confirmText:'清空'`；实现额外接受布尔 `confirm:true` 捷径，等价于取消“文本二次确认”的服务端约束（后台页面实际发送 confirmText，见 `pkg-admin/pages/account-switch/index.js:424`，因此该捷径无调用方）。
- **影响**：契约偏差（危险动作确认闸被弱化）；仅白名单开发者可触发，非越权。
- **修复建议**：删除布尔捷径，只认 `confirmText`；补断言：`confirm:true` 无 confirmText → `VALIDATION_FAILED`。
- **证据**：
  ```powershell
  Select-String -Path cloudfunctions\api\handlers\admin\testAccounts.js -Pattern 'input.confirm === true'   # EXIT=0 → :25
  Select-String -Path docs\V4_DATA_MODEL.md -Pattern "confirmText:'删除'"                                   # EXIT=0 → :718
  ```

#### R-A2-15 · P3 · 测试账号级联「先结束会话」注释与实现相反（并发可留孤儿）

- **位置**：`cloudfunctions/api/handlers/admin/_test-account-ops.js:259-298`（实现顺序：删订单/事件/留言/绑定/失败/票据 → `:281` 结束会话 → `:282-286` 删资料/users；文件头注释 `:3` 与 ENGINEERING §4.8.3 `:42` 要求「先结束会话再删数据」）。
- **描述**：会话在数据删除后才结束；若该测试账号的 TEST_WRITE 请求在删除窗口内通过 `switch-session` 校验并写入（下单/绑定），可能产生指向已删账号的孤儿测试数据（cleanup 侧因 users 已删不会回收）。窗口毫秒级，且仅测试数据。
- **影响**：极端并发下测试数据残留/孤儿订单（合成数据，不入统计）。
- **修复建议**：按注释与契约顺序，先 `endSessionsOfAccount` 再删数据；或级联外层加账号 `status:'DELETING'` 标记使 switch-session 拒绝。
- **证据**：
  ```powershell
  Select-String -Path cloudfunctions\api\handlers\admin\_test-account-ops.js -Pattern 'async function cascadeDelete|endSessionsOfAccount\(scope, user\)|remove\(COLLECTIONS.USERS'  # EXIT=0 → :259/:281/:286
  Select-String -Path docs\V4_ENGINEERING.md -Pattern '删除测试账号时先结束会话'  # EXIT=0 → :42
  ```

#### R-A2-16 · P3 · updateConfig 校验边界：announcement 类型/updatedAt、zoneLabels 键域与苑列表单源

- **位置**：`cloudfunctions/api/handlers/admin/updateConfig.js:101-117`（`normalizeAnnouncement` 接受 string 并原样返回；object 分支返回 `{enabled,title,text}` 丢掉 `updatedAt`）、`:59-75`（`zoneLabels` 键校验允许任意字母表中的字母，不限 `D/X/N/B/C`）、`:65` 与 `cloudfunctions/api/handlers/admin/_test-accounts.js:123`（苑列表 `['D','X','N','B','C']` 硬编码两处，未取 `shared/zones.ZONES`）。
- **描述**：DATA_MODEL §2.10 `:229` 规定 `announcement`/`maintenance` 为 object（announcement 含 `updatedAt`），`:227` 规定 `zoneLabels` 键为五苑；实现接受 string 会写出类型漂移值（且 admin 端渲染/客户端取用会不一致）、丢 `updatedAt`；`zoneLabels` 可写入未知字母键。苑列表硬编码违反「枚举字面量只在 enums 出现一次」纪律（`zones.js` 才是单源）。
- **影响**：配置类型/可追溯字段偏差；两处硬编码存在漂移风险（当前值一致）。
- **修复建议**：announcement 只收 object 并补 `updatedAt`；zoneLabels 键限定 `zones.ZONES`；苑列表改 `require('../../shared/zones').ZONES`；补断言。
- **证据**：
  ```powershell
  Select-String -Path cloudfunctions\api\handlers\admin\updateConfig.js -Pattern "typeof value === 'string'|function normalizeAnnouncement"  # EXIT=0 → :102/:101
  Select-String -Path cloudfunctions\api\handlers\admin\updateConfig.js,cloudfunctions\api\handlers\admin\_test-accounts.js -Pattern "'D', 'X', 'N', 'B', 'C'"  # EXIT=0 → :65/:123
  Select-String -Path docs\V4_DATA_MODEL.md -Pattern 'announcement`/`maintenance'  # EXIT=0 → :229
  ```

#### R-A2-17 · P3 · `order.undo` 的事件类型 `'UNDO'` 不在 16 种事件枚举内

- **位置**：`shared/order-state.js:75`（`event:'UNDO'`）、`shared/enums.js:276-294`（`ORDER_EVENTS` 16 值，无 UNDO）。
- **描述**：状态机动作表为 `order.undo` 登记的事件 `'UNDO'` 不是合法 `order_events.type`。当前生产路径被 `handlers/order/undo.js:57` 的 `eventType: input.checked.undo.event`（来自 `UNDO_TARGETS` 的 `PICKED_REVERTED/DELIVERED_REVERTED`）覆盖，`_common.js:137` 的 `built.eventType || rule.event` 因此不会用到该值；一旦未来省略 override 即写出非法事件类型。作为“状态机与事件类型单源”文件，应去掉该非法值或改为 `UNDO_TARGETS` 语义说明。
- **影响**：潜在非法事件类型（当前不可达）；单源文件自相矛盾，后续维护风险。
- **修复建议**：`order.undo` 的 `event` 改 `null`（注释说明由 UNDO_TARGETS 决定），或删除该字段并在 `nextStatus` 注释；补 selftest 断言事件类型 ∈ ORDER_EVENTS。
- **证据**：
  ```powershell
  Select-String -Path shared\order-state.js -Pattern "event: 'UNDO'"   # EXIT=0 → :75
  Select-String -Path shared\enums.js -Pattern "'UNDO'"                # EXIT=0 → 空（无该枚举值）
  Select-String -Path cloudfunctions\api\handlers\order\undo.js -Pattern 'eventType'  # EXIT=0 → :57（覆盖路径）
  ```

#### R-A2-18 · P3 · 审计动作枚举缺 CLEANUP；listAudit 无法按 CLEANUP 过滤

- **位置**：`shared/audit-actions.js:8-34`（16 值，无 CLEANUP）、`cloudfunctions/cleanup/run.js:11`（自造 `CLEANUP_AUDIT_ACTION`）、`cloudfunctions/api/handlers/admin/listAudit.js:36-48`（`normalizeAction` 仅接受 `AUDIT_ACTION_LIST`，CLEANUP 会 `VALIDATION_FAILED`）；契约要求见 DATA_MODEL §2.11 `:248`（action 含 `CLEANUP`（系统任务））。
- **描述**：审计动作枚举作为“唯一单源”漏了系统任务 CLEANUP，cleanup 只能在 run.js 再写一份常量；`admin.listAudit({action:'CLEANUP'})` 被拒，而后台审计区块可能想按系统清理过滤。该项也意味着共享枚举对“系统任务”与“管理动作”两类语义未分层（可接受，但需登记并在文档写明）。
- **影响**：过滤能力缺失（低）；审计动作单源纪律偏差。
- **修复建议**：`AUDIT_ACTIONS` 增 `CLEANUP`（若担心 admin 动作面，另建 `SYSTEM_AUDIT_ACTIONS` 子集并在 listAudit 白名单合并）；cleanup/run.js 改引用 shared 常量。
- **证据**：
  ```powershell
  node -e "const a=require('./shared/audit-actions');console.log(a.AUDIT_ACTION_COUNT,Object.keys(a.AUDIT_ACTIONS).join(','))"   # EXIT=0 → 16 值无 CLEANUP
  Select-String -Path cloudfunctions\cleanup\run.js -Pattern 'CLEANUP_AUDIT_ACTION'   # EXIT=0 → :11
  Select-String -Path docs\V4_DATA_MODEL.md -Pattern 'CLEANUP.*系统任务'              # EXIT=0 → :248
  ```

#### R-A2-19 · P3 · RATE_LIMITED 兜底文案与按日配额不符

- **位置**：`shared/error-copy.js:15`（`'操作太频繁，请半小时后再试'`）、`cloudfunctions/api/middleware/ratelimit.js:118`（实际显式 message = `'操作太频繁，请明天再试'`）；配额均为按日窗口（CONTRACT §10 `:478`）。
- **描述**：全部限流规则按“日”窗口（bind 5/日、getPublic 5/日、下单 20/日、留言 30/日/订单、切换会话 20/日、头像 5/日、改码 20/日/订单）；兜底文案写“半小时后”为假话。当前服务端所有 RATE_LIMITED 都显式传 message（客户端优先用 `result.message`），故暂不透出，但单源文案一旦被复用即误导用户（违反“失败提示说真话”）。
- **影响**：潜在文案错误（当前不可达）；单源文案不可信。
- **修复建议**：文案改「操作太频繁，请明天再试」或按 scope 动态生成；补断言。
- **证据**：
  ```powershell
  Select-String -Path shared\error-copy.js -Pattern 'RATE_LIMITED'                       # EXIT=0 → :15
  Select-String -Path cloudfunctions\api\middleware\ratelimit.js -Pattern 'rateLimited\('  # EXIT=0 → :118
  Select-String -Path docs\V4_CONTRACT.md -Pattern '5 次/日/顾客'                         # EXIT=0 → :478
  ```

#### R-A2-20 · P3 · `normalizeStation` 别名命中时多解保护不完整

- **位置**：`shared/stations.js:97-108`（`contained = STATIONS.filter(raw.indexOf(item.name)!==-1)`；`aliasIds.length===1` 分支只比较 `contained[0].id`）。
- **描述**：文件头声明「多解或未命中一律 ok:false」。实际：当文本同时包含多个正式名（如 OCR 文本出现两个站点）且其中第一个与别名指向一致时，`contained.length>1` 不进入歧义分支 → 归一为单站点。多解保护只有在“无别名命中”时才检查 `contained.length>1`。
- **影响**：极端 OCR 文本出现两个站点名时误归一（违背“判不准留空手选”硬口径）。
- **修复建议**：`aliasIds.length===1` 分支改判 `contained.length > 1 → ambiguous`（取并集后比较所有 id）。
- **证据**：
  ```powershell
  Select-String -Path shared\stations.js -Pattern 'const contained = |if \(contained.length > 1\)|contained\[0\]\.id !== aliasIds\[0\]'   # EXIT=0 → :97/:107/:99
  ```

#### R-A2-21 · P3 · 冗余死代码 3 处 + 函数 ≤50 行门禁漏检（5 个超限 handler）

- **位置**：`cloudfunctions/api/handlers/admin/_common.js:303`（`scanPaged`）、`:351`（`maskText`）、`:362`（`truncateDetail`），导出 `:406/:409/:411`；函数超限：`setPartnerStatus.js:184-273`（≈90 行）、`testAccounts.js:153-213`（61）、`testAccounts.js:215-270`（56）、`createInvites.js:77-134`（58）、`viewAsStart.js:183-238`（56）。
- **描述**：AGENTS §5.4「新增导出必须有生产调用，或先登记 TECH_DEBT」；CONTRACT §12 `:534` 与 AGENTS §4.2 规定单函数 ≤50 行。三个函数在 admin 域及全仓（`Get-ChildItem ... | Select-String`）仅有定义+导出两处命中，零调用；`tools/check.js:494-506` 的 #18 只统计文件行数（未解析函数体），故 5 个 >50 行 handler 未被门禁发现（门禁漏检）。
- **影响**：死代码误导维护；超长函数可读性/可测性风险（并非功能缺陷）。
- **修复建议**：删除 3 个死函数或登记 TD；拆分 5 个超长 handler（内部用 `_common` 组合）；若要求机械判据，可在 `check.js` 之外登记“函数级行数”为人工评审项/或用可维护的 AST 检查（C 域）。
- **证据**：
  ```powershell
  Get-ChildItem cloudfunctions\api\handlers\admin -File -Filter *.js | Select-String -Pattern 'scanPaged|maskText|truncateDetail'   # EXIT=0 → 仅 _common.js:303/351/362/406/409/411（各 2 处=定义+导出）
  Select-String -Path cloudfunctions\api\handlers\admin\setPartnerStatus.js -Pattern 'async function handler|module.exports'         # EXIT=0 → :184/:275（handler ≈90 行）
  Select-String -Path cloudfunctions\api\handlers\admin\createInvites.js -Pattern 'async function handler|module.exports'            # EXIT=0 → :77/:136
  Select-String -Path cloudfunctions\api\handlers\admin\viewAsStart.js -Pattern 'async function handler|module.exports'              # EXIT=0 → :183/:240
  Select-String -Path cloudfunctions\api\handlers\admin\testAccounts.js -Pattern 'async function (deleteTestAccount|purgeTestData)'   # EXIT=0 → :153/:215
  Select-String -Path tools\check.js -Pattern "check\(18"                                                                             # EXIT=0 → :494（仅文件级）
  ```

#### R-A2-22 · P3 · 时区不单源（admin.stats「今日」与 cleanup testData 审计日桶）

- **位置**：`cloudfunctions/api/handlers/admin/_common.js:345-349`（`startOfDayMs` 用 `date.setHours(0,0,0,0)`＝进程本地时区）、`cloudfunctions/cleanup/sweeps/testData.js:111-112`（`Math.floor(ctx.now / DAY_MS)`＝UTC 日）；对照同仓已固定 UTC+8 的实现：`cloudfunctions/api/lib/time.js:6/22-25`（`TZ_OFFSET_MS`/`dayKey`）、`cloudfunctions/cleanup/sweeps/stats.js:65`（UTC+8 日界）。
- **描述**：DATA_MODEL §7.4 `:662` 要求“自然日/周/月与 series 均按 serverTime 与 lib/time 固定 UTC+8（与 cleanup/自然日分区同源，非 config 字段）”。云函数运行时区不保证为 UTC+8（SCF 容器 TZ 以平台为准），`startOfDayMs` 依赖本地时区会产生 8 小时偏差（“今日订单”区间错桶）；`testData` 审计的日桶用 UTC，与 UTC+8 自然日不一致（跨日 8 小时内同一天可能写两条审计或反之）。
- **影响**：统计/审计的日边界在时区非 UTC+8 的运行环境下错误（低概率但口径违反）。
- **修复建议**：统一用 `lib/time.dayKey`/新增 `lib/time.startOfDayMs`（UTC+8 常量）替换两处本地时区算法；cleanup shared 副本同步（改 `shared` 或 `lib` 时按单源流程）。
- **证据**：
  ```powershell
  Select-String -Path cloudfunctions\api\handlers\admin\_common.js -Pattern 'function startOfDayMs|date.setHours'   # EXIT=0 → :345/:347
  Select-String -Path cloudfunctions\cleanup\sweeps\testData.js -Pattern 'dayBucket = Math.floor'                   # EXIT=0 → :111
  Select-String -Path cloudfunctions\api\lib\time.js -Pattern 'TZ_OFFSET_MS|function dayKey'                       # EXIT=0 → :6/:22
  Select-String -Path docs\V4_DATA_MODEL.md -Pattern '固定 \*\*UTC\+8\*\*'                                          # EXIT=0 → :662
  ```

#### R-A2-23 · P3 · recomputeStats 每轮只扫前 100 兼职且不推进游标（>100 时永久陈旧）

- **位置**：`cloudfunctions/cleanup/sweeps/stats.js:66`（`find` `orderBy updatedAt asc` + `limit BATCH=100`）、`:74-82`（stats 未变化 `continue`，不写库也不改 `updatedAt`）。
- **描述**：partners.stats 是可重算缓存；`updatedAt` 同时是扫描游标。对“stats 恰好没变”的兼职（大多数），每轮都排在最前 100 且不推进 → 第 101 个兼职 stats 永远不会被重算；单量统计（兼职端）长期陈旧。
- **影响**：>100 兼职时统计缓存错误（当前规模可能 <100，属可扩展性缺陷）。
- **修复建议**：按 `_id` 游标分页跨轮推进，或每轮固定全量（若规模可接受），或独立的 `statsVersion` 触发重算。
- **证据**：
  ```powershell
  Select-String -Path cloudfunctions\cleanup\sweeps\stats.js -Pattern 'const partners = await|if \(sameStats'   # EXIT=0 → :66/:75
  ```

#### R-A2-24 · P3 · 测试账号列表/统计先全局 limit 100 再内存过滤/扣减

- **位置**：`cloudfunctions/api/handlers/admin/_test-accounts.js:58-65`（`find({isTestAccount:true}, limit:100)` 后按 `createdByDeveloperNo` 过滤）、`cloudfunctions/api/handlers/admin/stats.js:29-45`（test 计数同样 limit 100）。
- **描述**：单开发者上限 6，多开发者合计 >16 时测试账号总数 >100，列表只返回前 100 再过滤 → 某开发者的账号可能整批缺失；`stats.test` 计数偏低导致 `counts.users/customers/partners` 扣减不足（后台总览计数偏大）。
- **影响**：多开发者 + 大量测试账号时后台计数/列表不准（当前单开发者 MVP 不触发）。
- **修复建议**：查询直接带 `createdByDeveloperNo`（索引 `idx_test_owner(isTestAccount,createdByDeveloperNo)` 已登记）并分页；统计改用 `count(where)` 分桶而非扣减。
- **证据**：
  ```powershell
  Select-String -Path cloudfunctions\api\handlers\admin\_test-accounts.js -Pattern 'where: \{ isTestAccount: true \}|createdByDeveloperNo === scope'  # EXIT=0 → :60/:64
  Select-String -Path cloudfunctions\api\handlers\admin\stats.js -Pattern 'where: \{ isTestAccount: true \}'                                       # EXIT=0 → :31
  Select-String -Path docs\V4_DATA_MODEL.md -Pattern 'idx_test_owner'                                                                              # EXIT=0 → :496
  ```

#### R-A2-25 · P3 · CLEANUP 审计 target.type='sweep_batch' 不在契约枚举

- **位置**：`cloudfunctions/cleanup/run.js:100`（`target: { type: 'sweep_batch', ... }`）；契约见 DATA_MODEL §2.11 `:249`（target type 枚举：partner/customer/order/invitation_code/view_session/config/recognition_failure/test_account，另 `MANUAL_DB_FIX†` 属控制台人工处置说明）。
- **描述**：每轮 CLEANUP 汇总审计写入未登记的 target 类型。审计台账消费方（后台/排查）若按契约枚举解析会遇到未知类型。
- **影响**：审计字段值域越界（低；不影响功能）。
- **修复建议**：选用既有枚举（如 `{type:'config', id:'cleanup'}`）或按流程先在 DATA_MODEL 登记新类型再实现。
- **证据**：
  ```powershell
  Select-String -Path cloudfunctions\cleanup\run.js -Pattern "sweep_batch"     # EXIT=0 → :100
  Select-String -Path docs\V4_DATA_MODEL.md -Pattern "target.*object.*是"      # EXIT=0 → :249
  ```

#### R-A2-26 · P3 · admin 业务写与 admin_audit 非同一事务

- **位置**：`cloudfunctions/api/handlers/admin/_common.js:130-142`（`writeAudit` 独立 `dao.add`；失败抛 `INTERNAL_ERROR`），调用方如 `createInvites.js:116-132`（先插入邀请码再写审计）、`updateConfig.js:178-189`（先写配置再写审计）、`revokeInvite.js:43-55`。
- **描述**：审计是治理动作的硬要求（CONTRACT §1.1 `:63`「全部操作写 admin_audit」；DATA_MODEL §2.11）。当前业务写与审计写不在同一事务：审计写失败时业务副作用已生效，handler 返回 INTERNAL_ERROR（客户端可能重试 → 新幂等键重复副作用或 NOT_FOUND）。云 DB 异常概率低，但“已生效未审计”对治理台账是空洞。
- **影响**：极端故障下治理审计缺口/重试二义性（非数据丢失）。
- **修复建议**：能事务的动作（revokeInvite/updateConfig/deleteTestAccount 等）把审计写纳入 `dao.transaction`；不能事务的动作（邀请码批量逐条 insertUnique）在审计失败时记降级日志并让运维可对账（或先写“进行中”审计后补结果）。
- **证据**：
  ```powershell
  Select-String -Path cloudfunctions\api\handlers\admin\_common.js -Pattern 'async function writeAudit'        # EXIT=0 → :130
  Select-String -Path cloudfunctions\api\handlers\admin\createInvites.js -Pattern 'writeAudit'                 # EXIT=0 → :116（在 13 段插入之后）
  Select-String -Path cloudfunctions\api\handlers\admin\updateConfig.js -Pattern 'writeAudit|dao.update'       # EXIT=0 → :179/:184
  ```

#### R-A2-27 · P3 · `testAccountsDeletion` sweep 语义与契约不一致（无 marker 机制；兼职孤儿不在兜底范围）

- **位置**：`cloudfunctions/cleanup/sweeps/accounts.js:231-264`（扫 `_id` 前缀 `TEST-` 的 customers，users 缺失或非测试时清其订单/绑定/票据/customer）、DATA_MODEL §7.8 `:741`（「`testAccountsDeletion`：被 `admin.deleteTestAccount` 标记的测试账号 → 级联删除并结束其会话（同步审计）」）。
- **描述**：契约描述的是“标记后级联”的 sweep 兜底，但 `users` schema（DATA_MODEL §2.1/§4.10）无 marker 字段，`admin.deleteTestAccount` 是同步删除、不写标记；实现改为扫描 `TEST-` 前缀孤儿 customer。该兜底只覆盖“测试顾客孤儿”，测试兼职（partners 行 + users 已删）没有 customers 行，不在扫描范围。属文档与实现的机制不一致（需么补 marker 字段/要么回写文档）。
- **影响**：极端中断场景下测试兼职孤儿数据无兜底（合成数据、不入统计，风险低）。
- **修复建议**：回写 DATA_MODEL 为实际的“孤儿前缀扫描”语义并补 partner 侧扫描；或引入 `users.testDeletePending` 标记后按契约实现。
- **证据**：
  ```powershell
  Select-String -Path cloudfunctions\cleanup\sweeps\accounts.js -Pattern 'runTestAccountsDeletion|keyPrefixWhere|user.isTestAccount !== true'  # EXIT=0 → :231/:233/:246
  Select-String -Path docs\V4_DATA_MODEL.md -Pattern '被 `admin.deleteTestAccount` 标记'                                                    # EXIT=0 → :741
  ```

#### R-A2-28 · P3 · `.tool-versions` 未登记 `wx-server-sdk` 实测版本

- **位置**：仓库根 `.tool-versions`（仅 `node/npm/cloudfunction-runtime/miniprogram-lib` 四行）；ENGINEERING §4.4 `:210`（「版本 `npm view wx-server-sdk version` 实测后锁定并回填 `.tool-versions`」）。
- **描述**：两 `package.json` 已精确锁 4.0.2，且 `npm view wx-server-sdk version` 实测返回 4.0.2（EXIT=0，锁版本即 registry 当前版本）；但“实测后回填 `.tool-versions`”的工程纪律未执行，部署/排查时缺一个可核对的版本记录点。
- **影响**：流程/文档回填缺口（不影响运行）。
- **修复建议**：`.tool-versions` 增 `wx-server-sdk 4.0.2` 行（或按 ENGINEERING 意图登记到等价配置），并在 RUNBOOK 部署节引用。
- **证据**：
  ```powershell
  Get-Content .tool-versions          # EXIT=0 → 无 wx-server-sdk 行
  npm view wx-server-sdk version      # EXIT=0 → 4.0.2
  Select-String -Path docs\V4_ENGINEERING.md -Pattern '回填 `.tool-versions`'  # EXIT=0 → :210
  ```

### 3.5 安全发现独立复核表（三处定位 + 待独立复核）

| 编号 | 级别 | 入口 | 传播 | 终点 | 复核要求 | 影响上限 |
| :-- | :-: | :-- | :-- | :-- | :-- | :-- |
| R-A2-01 | P1 | `handlers/admin/fixRecognitionFailure.js:121-127`（FIXED 终态写入，不触 fileId） | `cleanup/sweeps/recognitionFailures.js:63-73`（到期状态集排除 FIXED；:77 排除匿名记录） | `cleanup/sweeps/_util.js:146-155`（引用计数含 FIXED → 文件不删）+ 记录不物理删 | 请独立验证者从源码反驳“FIXED 记录原图永久保留”；并裁决 CONTRACT §11.1 vs ENGINEERING §4.7 口径 | 隐私留存承诺偏差（L3 截图超期） |
| R-A2-04 | P2 | `handlers/admin/listAudit.js:50-90`（无 actor 约束） | `:63-65` 空 where 全量查询 → `_dto.auditBrief:205-214` | `handlers/admin/stats.js:119-141` 总览最近审计全量 | 请独立复核“多开发者审计互不可见”是否属硬验收项（UX AC-D-02 机器项） | 治理面横向可见（白名单开发者之间） |
| R-A2-06 | P2 | `cloudfunctions/cleanup/index.js:9-16`（无调用方/来源校验） | `cloudfunctions/cleanup/run.js:123-142`（无条件跑全部 sweep） | `run.js:86-121` 写审计 + 各 sweep 到期删除 | 请独立验证者确认部署形态下 `wx.cloud.callFunction('cleanup')` 的可达性与实际影响 | 成本/审计灌水；不读业务数据 |

### 3.6 跨域观测（不计入本 part 计数，交 Lead 分派）

1. **`pkg-admin/pages/order-detail/index.js:43`**：`admin.getOrder({orderNo})` 未传 `includeTest`，而 `handlers/admin/getOrder.js:25-27` 对测试单要求 `includeTest:true` → 后台从“含测试数据”列表点进测试单详情会 `NOT_FOUND`（B2 页面域；服务端契约按 DATA_MODEL §7.6 实现，非服务端缺陷）。
2. **`tools/check.js:855-862`（#30）**：`testFilterTargets` 含 `'cloudfunctions/api/handlers/admin/listTestAccounts.js'`，该路径不存在（实现在 `testAccounts.js`）；`if (!exists(rel)) return;` 使该子检查静默跳过，与 lessons「判据写死路径导致子检查空转」同类（C/门禁域，建议改为 `testAccounts.js` 并缺失判红）。
3. **`pkg-admin/common/constants.js:159-168`**：`CONFIG_RANGE` 与后端白名单范围不一致（`orderTimeoutMin:10` vs 后端 5；`autoCompleteMax:168` vs 后端 72；`maintenanceTextMax:200` vs 后端 500）→ 后台页面可提交/被拦范围与服务端不一致（B2 域；以 DATA_MODEL §7.6 为准）。
4. **`api/client.js:133-136`**：仅 `VIEW_TICKET_EXPIRED` 清 `viewContext`；NOT_FOUND（目标失效）不清（与 R-A2-05 联动，B1/S0 域）。
5. **UX_DEVELOPER `:247`**：订单页「异常工单置顶」在服务端（`listOrders` 按 `createdAt desc`）与页面视图模型均未实现（B2 或服务端排序口径冲突，交 Lead 裁决）。
6. **DATA_MODEL §7.8 `:741` 用名 `switchSessions`**，实际 action/文件为 `cleanup.viewSessions`/`sweeps/viewSessions.js`（ENGINEERING §4.7 用 viewSessions）→ 文档命名漂移（C 文档同步）。
7. **`docs/V4_DATA_MODEL.md §5.3:539` 的「admin 50」 vs `docs/V4_UX_DEVELOPER.md:198/247/347/392/438` 的「分页 20」**：文档间冲突，实现 20（见 §5 未决）。
8. **`docs/V4_CONTRACT.md §1.1:61-62`**：`CLOSED` 注销在后台页面未提供入口（CONTRACT 写明“后台页面不提供入口、为运维兜底能力”），实现 `admin.setPartnerStatus` 支持但页面无入口 → 符合契约，无需处理（记录以证已核）。

## 4. 通过项

### 4.1 鉴权 / ADMIN 身份解析 / 越权矩阵（安全维通过项）

- **ADMIN 身份只在服务端环境变量解析**：`middleware/auth.js:12-29`（`ADMIN_OPENIDS` 每次请求重查、缺失/非法 JSON fail-closed 返回 `''`；`:119` 写 `identity.developerNo`）；`admin.*` 入口两道闸：中间件 `:127-132`（internal 仅 dev/部署者；`admin.` 前缀必须 dev）+ `_common.requireAdmin:61-77`（fail-closed，默认拒绝切换票据身份；仅 `admin.viewAsEnd` 允许 `allowViewMode`）。
- **ADMIN 动作域边界**：后台唯一业务写动作 = `order.cancel`（`middleware/auth.js:9` `ADMIN_BUSINESS_ACTIONS`；`order/_common.js:98-102` 收敛为仅异常介入），其余业务写不得以 ADMIN 执行；后台读一律走 `admin.*` 脱敏接口（不走 `order.get` 等业务读）。TD-046 关闭依据已核（引用不重复）。
- **真实×测试 / 只读×可写**：`middleware/switch-session.js` 全链实现——票据归属/白名单/过期/单活；READONLY 拒一切写（`:122-131`）、读白名单 12 项；TEST_WRITE 额外只放行 `partner.getPublic`（`:34`）、阻断 `partner.activate/user.deleteAccount/ai.parseParcel`（`:37-41`）、后台动作一律拒（`:136-138`）；每次请求 `targetIsTest`/`targetId===effectiveOpenid` 交叉校验（`:183-195`）；`admin.viewAsStart` 对真实目标 `TEST_WRITE` → FORBIDDEN（`viewAsStart.js:55-60/101-103`），READONLY 拒绝测试目标（`:58-60`）。
- **后台 DTO 脱敏**：`_dto.js` 全量核过——顾客/兼职/订单/审计/邀请码/测试账号/识别失败/配置各 DTO 均无 `openid`/`avatarFileId`/完整取件码/完整昵称/完整宿舍；`mask.js:3-42` 与 DATA_MODEL §7.7 四函数逐字一致；`failureBrief` 无 `fileId/uploaderOpenid`；`getRecognitionFailure` 才对原图签发临时 URL（5 分钟）并逐次写 `FAILURE_IMAGE_VIEW`（`getRecognitionFailure.js:27-64`）。门禁 #27/#29 覆盖并由 selftest 行为套兜底（引用）。
- **危险动作**：`admin.setPartnerStatus`/`updateConfig`/`viewAsStart/End`/测试账号四动作/复核两动作均要求合法 `clientRequestId`（`_common.requireClientRequestId:79-86`、validate 中间件统一闸）；`deleteTestAccount`/`purgeTestData` 有 `dryRun` 计数 + `confirmText` 二次确认 + 有真实引用即拒（`_test-account-ops.js:56-109/93-97`）+ 前后条数审计（`testAccounts.js:194-206/252-263`）。
- **测试账号隔离**：创建事务内三处同值合成 `openid='TEST-<random>'`（`_test-accounts.js:133-173`）；编号/默认资料/服务配置按契约（`:96-131`）；配额每角色 ≤config、合计 ≤6（`testAccounts.js:87-91`）；治理动作拒测试目标（`setPartnerStatus.js:203-205`）；后台列表默认排除测试（5 个列表 handler 的 `includeTest` 默认 false，`loadTestFlags`）；统计扣减测试账号（`stats.js:128-140`）；测试数据不进红点/邀请码/报表（本域核对 `stats.js`/`listOrders`/`listCustomers`/`listPartners` 过滤口径）。
- **`admin.bootstrap` 内部动作**：仅部署上下文（无 OPENID）或白名单开发者可执行（`app.js:143-161` internal 分支 + `bootstrap.js:69-73` 双 scope），审计 SYSTEM/开发者编号；15 条唯一索引清单与 DATA_MODEL §5.1 唯一索引全量一致（含历史教训「漏列 uk_tag_key」已修）。
- **日志脱敏**：本 part 全部 `console.*` 命中已列（admin 8 处 + cleanup 8 处）：只含 action/sweep 名/错误码/requestId/计数，无 openid/fileId/取件码/昵称/cloudPath（`Select-String -Path cloudfunctions\api\handlers\admin,cloudfunctions\cleanup -Pattern 'console\.(log|warn|error)'`，EXIT=0，命中行逐条读过）。

### 4.2 审计落库矩阵（写动作 → 审计）

| admin 写动作 | 审计 action | 落库位置 | 结论 |
| :-- | :-- | :-- | :-- |
| createInvites | INVITE_CREATE（batchId/count/hours/codeTails） | `createInvites.js:116-126` | ✓ 无完整码 |
| revokeInvite | INVITE_REVOKE（codeTail/reason） | `revokeInvite.js:49-54` | ✓ |
| setPartnerStatus | PARTNER_SUSPEND/PARTNER_RESTORE（from/to/reason/affected） | `setPartnerStatus.js:249-266` | ✓（CLOSED 用 SUSPEND + detail.to，符合 §7.6） |
| updateConfig | CONFIG_UPDATE（keys/changes） | `updateConfig.js:184-189` | △ detail 值缺失见 R-A2-11 |
| viewAsStart | ACCOUNT_SWITCH_START（viewMode/role/targetNo/targetIsTest） | `viewAsStart.js:225-236` + 旧票 END(REPLACED) `:109-128` | ✓ |
| viewAsEnd | ACCOUNT_SWITCH_END（reason=EXIT） | `viewAsEnd.js:32-43` | ✓ |
| createTestAccount | TEST_ACCOUNT_CREATE（role/targetNo/displayNameMasked） | `testAccounts.js:93-103` | ✓ 昵称脱敏 |
| deleteTestAccount | TEST_ACCOUNT_DELETE（before/after/sessionsEnded）+ 会话 END | `testAccounts.js:194-206`、`_test-account-ops.js:227-249` | ✓ |
| purgeTestData | TEST_DATA_PURGE（before/after/accounts） | `testAccounts.js:252-263` | ✓ |
| fixRecognitionFailure | FAILURE_FIX（fields/orderPatched/notified） | `fixRecognitionFailure.js:131-141` | ✓ 无原图/OCR/openid |
| ignoreRecognitionFailure | FAILURE_IGNORE（noteLength/notified） | `ignoreRecognitionFailure.js:64-73` | ✓ 不记备注原文 |
| getRecognitionFailure（读，例外） | FAILURE_IMAGE_VIEW（failureNo/sourceRole/uploaderNo/expires） | `getRecognitionFailure.js:52-64` | ✓ 每次查看一条 |
| bootstrap | BOOTSTRAP | `bootstrap.js:74-84` | ✓ |

### 4.3 cleanup 13 sweep 幂等/失败隔离/边界（逐 sweep）

| sweep | 幂等判据 | 部分失败隔离 | 批 100 | 结论 |
| :-- | :-- | :-: | :-: | :-: |
| orderTimeout | `where {_id,status:SUBMITTED}` 条件更新 + 事件 requestKey | ✓ | ✓ | ✓（并发对手先动→跳过） |
| autoComplete | `where {_id,status:DELIVERED}` + 事件 requestKey | ✓ | ✓ | ✓ |
| files | 写 `image.cleanedAt` 幂等 + 引用计数归零删 | ✓ | ✓ | ✓（image.fileId 非空条件防批遮挡） |
| tickets | 票据记录删除幂等 | ✓ | ✓ | ✓（无主文件 TD-051 引用；未重复报） |
| retention | `anonymizedAt` 幂等 + 三查询拆分 | ✓ | ✓ | ✓（批内二次清理见 R-A2-09） |
| accountDeletion | 阶段一 `customer.anonymizedAt`/`anonymizedAt exists false` 幂等；阶段二 `deletionRequestedAt+30d` | ✓ | ✓ | ✓（partnerNote 见 R-A2-10） |
| testAccountsDeletion | 按“账号是否仍存在”收敛 | ✓ | ✓ | △ 语义见 R-A2-27 |
| invitationCodes | 仅 UNUSED→EXPIRED | ✓ | ✓ | △ 条件更新见 R-A2-08 |
| viewSessions | 过期补 endedAt + 每票一条审计（requestKey 幂等）+ 结束 7 天删 | ✓ | ✓ | ✓ |
| rateLimits | 只清 `rl:` 前缀（键区间 + startsWith 双保险） | ✓ | ✓ | ✓ |
| recognitionFailures | 到期置 IGNORED + fileId 清空幂等 | ✓ | ✓ | △ FIXED 见 R-A2-01 |
| testData | 计数全 0 不写审计、账务按账号收敛 | ✓ | ≤6/轮 | △ 绑定/引用见 R-A2-07 |
| recomputeStats | stats 未变不写库 | ✓ | ✓ | △ 游标见 R-A2-23 |

补充通过项：`cleanup/run.js` 单 sweep 失败只记 `failed` 不阻断后续；每轮一条 CLEANUP 汇总审计（`requestKey='cleanup:'+requestId` 幂等）；`cleanup/db/dao.js` 与 `api/db/dao.js` 写入语义成对（普通对象包 `command.set`，防嵌套更新 -502001）；所有 sweep 使用注入 `ctx.now` 做时间边界（可测试、未读系统时钟）；`testData` 账号保留/数据清空/审计摘要保留符合 §7.8。

### 4.4 shared 纯件单源与错误码闸

- **动作注册表单源**：`node -e "const a=require('./shared/actions');console.log(a.ACTION_COUNT,a.CLIENT_ACTIONS.length,a.INTERNAL_ACTIONS.length)"` → `81 66 15`（EXIT=0）；23 个 admin 动作（含 bootstrap）与 CONTRACT §5.3 admin 行逐名一致；13 个 cleanup 动作 = 13 个 sweep；`ai.parseParcel`/`health.check` 在册。
- **错误码闸（本仓无 registry/APIS.md → N/A + 原因；改用 DATA_MODEL §7 + shared 单源对照）**：
  ```powershell
  # 从 shared/error-codes.js 抽 13 码，从 DATA_MODEL §7.2 行 630 抽码集，双向差集为空（EXIT=0）
  # shared 13：VALIDATION_FAILED, FORBIDDEN, NOT_FOUND, CONFLICT, INVALID_TRANSITION, INVALID_STATE,
  #            RATE_LIMITED, INVITE_EXPIRED, INVITE_USED, VIEW_TICKET_EXPIRED, PARTNER_CLOSED,
  #            DEPENDENCY_FAILED, INTERNAL_ERROR
  # DATA_MODEL 行内另出现 READONLY/TEST_WRITE 两词为语境词（非错误码），不计差集
  ```
  另扫废弃码/未知码：`Select-String -Path cloudfunctions\**\*.js -Pattern 'INVALID_PARAM|CODE_EXPIRED|CODE_USED|PAYMENT_|NOT_AUTHORIZED|UNAUTHORIZED|SERVER_ERROR|DB_ERROR'` → **空输出（EXIT=0）**；`lib/errors.js` 只从 shared 13 码构造（`:1-30`）；`error-copy.js` 与 13 码逐一对应。
- **集合/审计/状态机/校验单源**：`shared/collections.js` 14 集合与 DATA_MODEL §1 一致；`shared/audit-actions.js` 16 值对齐（缺 CLEANUP 见 R-A2-18）；`shared/order-state.js` 转移表/动作矩阵/undo/异常恢复与 DATA_MODEL §8 一致（R-A2-17 单列）；`shared/validate.js` 与各 DTO 上限（note 200/deliveryNote 100/partnerNote 100/msg 200/lockerNo 10/displayName 20/releaseNote 100/failureNote 100）逐项一致；`shared/zones.js` D8 五苑默认名与固定序一致。
- **副本一致性**：见 §2.4（32/32 hash equal；sync `--check` EXIT=0）。
- **依赖策略**：见 §2.5（仅 wx-server-sdk 4.0.2、无 lockfile/node_modules → npm audit N/A+原因；`npm view` 实测版本存在；`.tool-versions` 回填缺口 R-A2-28）。

### 4.5 已知问题登记引用（不重复论证）

- **TD-055**（`admin.setPartnerStatus(CLOSED)` 治理链非事务、文件删除在事务外）：本 part 复核代码与登记一致，不重复报。
- **TD-056**（兼职 CLOSED 后切换会话未立即 endedAt）：本 part 只引用；R-A2-05 是相邻但独立的“失效后退出路径”缺陷。
- **TD-057**（`moveOrdersToException` 500 单上限）、**TD-051**（无主云文件无法自动扫描/删除）、**TD-053**（`partners.openid` 保留）、**TD-054**（`users.purgeAt` 未写入）、**TD-058**（单环境无 dev/prod 隔离）、**TD-013**（cleanup 10 分钟频次成本）、**TD-015**（fake DB 与真实云差异/事务）、**TD-019**（未建单失败记录无原图）、**TD-025**（stations 别名缺口）、**TD-029**（测试文件行数红线）、**TD-032**（`check.js` #29 简写扫描盲区）均已登记：本 part 复核到对应代码/判据与登记一致，不重复计问题。
- **`pkg-admin` 页面域缺陷（脱敏截图/权限五态等）**：不在本 part 判据范围，交 B2/Lead。

## 5. 结论

### 5.1 计数

| 指标 | 数值 |
| :-- | :-- |
| P0 | 0 |
| P1 | 1（R-A2-01） |
| P2 | 11 |
| P3 | 16 |
| 本轮发现合计 N | **28** |
| 可行动（有明确修复落点） | 26（R-A2-01/R-A2-04 需先裁决口径，见 5.4） |
| 依据未复现（缺三件套） | **0** |
| 旧问题三态 | N/A（无旧报告） |

### 5.2 建议色

**🔴 红**（P1≥1：R-A2-01 隐私留存承诺偏差）。若 Lead 裁决“ENGINEERING §4.7 `status≠FIXED` 为有意设计并同步修改 CONTRACT/隐私文本”，则 R-A2-01 降为 P2、本 part 变黄（P0=P1=0）；本条为本 part 建议色唯一红色触发点。

### 5.3 取代与废弃检查结论

- 本 part 范围扫描（`cloudfunctions/api/handlers/admin/**`、`cloudfunctions/cleanup/**`（含 shared 副本）、`shared/**`）：
  ```powershell
  Get-ChildItem cloudfunctions\api\handlers\admin, cloudfunctions\cleanup, shared -Recurse -File -Filter *.js |
    Select-String -Pattern '_old\b|_legacy|_v2\b|Deprecated|暂时保留|废弃|TO\x44O[:：]\s*(删|remove|delete)' -Encoding utf8
  # EXIT=0；完整输出为空（无命中）
  ```
  → 并行实现未删 0 处、废弃标记命中 0 处；`STATE.md` 无需登记行（未发现并行态）。合法保留核对：`cloudfunctions/{api,cleanup}/db/dao.js` 与 `{api,cleanup}/shared/**` 为“部署单元独立”的契约性副本（ARCHITECTURE §4.2/§4.3 明确允许，且 shared 副本由 sync 脚本生成并有 hash 判据），不属于“工作树第二份副本”违规。
- 无越界改动证据（本 part 只读审查；工作树 `git status` 仅见未跟踪的审查/研究文档目录）。

### 5.4 未决项（交 Lead 裁决/分派）

1. **口径冲突 A（影响 R-A2-01）**：识别失败记录到期处理——CONTRACT §11.1 `:496`/§11.4 `:524` 与 `docs/privacy/隐私保护指引.md:23`「到期删除」 vs ENGINEERING §4.7 `:362`「`status≠FIXED`」+ DATA_MODEL §10.2 `:845`「置 IGNORED 保留」+ selftest 断言“FIXED 不动”。请裁决后统一 4 处文档 + selftest + 实现。
2. **口径冲突 B（影响 R-A2-04）**：多开发者审计可见性——CONTRACT §1.1 `:50`「各自独立…审计」 vs UX_DEVELOPER `:126`/`:634`「审计互不可见」；单开发者 MVP 下不可见差异，需裁决是否在 P1 多开发者前收紧。
3. **口径冲突 C（不计问题）**：后台列表页大小——DATA_MODEL §5.3 `:539`「admin 50」 vs UX_DEVELOPER 各页「分页 20」 vs 实现 20；建议按 UX 回写 DATA_MODEL 或反之。
4. **cleanup 内部入口防护（R-A2-06）**：需在 RUNBOOK §3.6 部署节补充“入口来源校验”要求，属代码+部署双落点，请 Lead 决定是否纳入本轮修复批。
5. **识别失败记录本体（非原图）是否到期物理删**：并入 5.4.1 裁决；若保留记录，需在隐私文本写明“原图到期删、记录保留供审计”的例外。
6. **真实云环境行为未复现**：本 part 全部结论均基于 HEAD 静态源码 + 只读命令（未连真实云环境、未跑 selftest/gate，遵守派单纪律）；R-A2-06/R-A2-01/R-A2-04 三条安全发现已标“待独立复核”，请 Lead 派独立验证者从源码反驳。
7. **观察项（未单列问题）**：`admin.stats.inviteBatches` 只统计最近 100 条邀请码（批次计数近似）；`admin.getOrder` 事件时间线截断 100 条；后台订单页“异常工单置顶”未实现（见 §3.6-5）——均无明确 P 级判据，列为后续观察，交 Lead 决定是否登记 TD。
8. **证据可复现性**：全部命令均在本机 `D:\Code\expressage_college_v4` 只读执行（PowerShell 7 / node v24.21.0），命令原文与关键命中行已贴入 §3.2~§3.4；未运行时/网络依赖项（`npm view` 除外，EXIT=0）。
