> 本条由 AI 生成（代码审查）

# 2026-10-22 代码审查 · D 轴（规格轴）· 需求文档 vs HEAD 实现

> 范围：只报「需求缺失 / 写了一半 / 范围外行为 / 实现与需求不符」，不重复 A1/A2/B1/B2/C 标准的代码气味、安全条目与装配断链；同一事实两轴都提时由 Lead 按「文件:行 + 一句话事实」去重。
> 对标：`docs/V4_CONTRACT.md`（唯一口径）、`docs/V4_DATA_MODEL.md`、`docs/V4_UX_CUSTOMER.md` / `V4_UX_PARTNER.md` / `V4_UX_DEVELOPER.md`、`docs/ARCHITECTURE.md`（冻结接口）。
> 依据 HEAD = `9031d14cfc88b0cd8b03527da00ccc1f70a3e635`（`_REVIEW_BRIEF.md` §0 给定）；只读代码，未改任何代码/测试/配置。

---

## 0. 派单输入单

- `DESCRIPTION`：规格轴独立审查——对照 CONTRACT（唯一口径）/DATA_MODEL/三份 UX/ARCHITECTURE 检查 HEAD 实现的需求缺失、半写、范围外、实现与需求不符；产出本文件。
- `PLAN_OR_REQUIREMENTS`：`docs/V4_CONTRACT.md`（v0.9）+ `docs/V4_DATA_MODEL.md` + `docs/V4_UX_{CUSTOMER,PARTNER,DEVELOPER}.md` + `docs/ARCHITECTURE.md`。
- `BASE_SHA` = 空树 `4b825dc642cb6eb9a060e54bf8d69288fbee4904`（全量新增基线）；`HEAD_SHA` = `9031d14cfc88b0cd8b03527da00ccc1f70a3e635`。
- 写作用域：仅 `docs/reviews/_parts/2026-10-22_D-spec-axis.md`（本文件）。

---

## 1. 开工回执（九项）

### 1.1 人话复述与落点

本 part 审「HEAD 的 v4 实现是否照着需求文档做」：以 CONTRACT 为唯一口径，逐类核对页面/路由/action 注册表/状态机/错误码/隐私承诺/三端 UX 验收点，找的是**需求与实现之间的缺口**（不是代码写得丑不丑）。产物 = 本文件，下一步 = Lead 聚合去重与裁决。

### 1.2 假设清单

1. 我假设 `docs/V4_CONTRACT.md` v0.9（HEAD 内 634 行版本）就是唯一口径；若 Lead 另有更新口径文件未落库，则涉及该口径的条目失效。
2. 我假设 `_REVIEW_BRIEF.md` §0 的基线读数（HEAD、30 页、14 集合、13 码）仍成立；若 HEAD 已前进，行号会漂移，但每条的 `文件:行` 命中原句可复核。
3. 我假设 DATA_MODEL §5.2/§5.3 的查询路径/索引/游标要求是**判据**（不是参考），因此实现走 `skip` + 内存过滤即为规格不符；若 Lead 认为该节只是目标建议，则 R-D-06/R-D-07 降为说明性偏差。
4. 我假设「临时 URL 5 分钟」是**承诺值**（CONTRACT §4.3/D17/§11.3 与 AC-D-25 均写 5 分钟）；因此未显式约束 TTL 的实现不符合承诺，不依赖云开发缺省值是多少。
5. 我假设 ARCHITECTURE §3.2/§3.5 的接口表是**冻结接口**（AGENTS §1.2「代码接口冻结源」），因此表与实现不一致按规格不符报。

### 1.3 澄清问题

- 本仓无 `docs/registry/APIS.md` 三件套（ENGINEERING E7 已裁），API 清单以 DATA_MODEL §7 为准 → 写「N/A + 原因」，不静默跳过。
- `docs/V4_DECISIONS.md` 的 D1~D22 已全部闭环，本轮无待裁决项需向用户追问；本轴发现如涉及口径变更，只建议交 Lead，不代裁决。

### 1.4 锚点校验

```powershell
PS> Select-String -Path STATE.md -Pattern '起点锚点'
(空输出)
```

- 结论：`STATE.md` 无「起点锚点」字段（与 `_REVIEW_BRIEF.md` §0 一致）；按用户指令以 HEAD 全量新增为基线，不向用户追问锚点。

### 1.5 diff 读取确认

- 全量新增基线（BASE=空树）：已读范围见 §2 覆盖地图；机械扫描覆盖：`Select-String`（契约关键字/冻结接口/隐私 API/查询路径）、node 只读盘点脚本（页面/组件/api 模块/action/组件 props-events 清单）。
- 未覆盖处已在 §2 标 ○ 并写原因（页面逐页交互、UX_PARTNER 逐页规格、handler 全量等）。

### 1.6 审查范围声明

- 只审「文档要求 ↔ 代码事实」的对照关系；发现都落在「需求缺失/半写/范围外/不符」四类。
- 页面层交互（五态、可访问性、按钮联调）、云函数安全纵深（鉴权/注入）、工具链判据是否有牙等，分别归 B1/B2、A1/A2、C，本文件不展开；发现如与它们重叠，Lead 去重。
- 本次未改任何代码/测试/配置/口径文档；唯一写入 = 本文件。

### 1.7 旧报告

- 无（`docs/reviews/` 本轮新建）→ 旧问题三态：N/A。

### 1.8 引用检查清单原文（逐字抄自 `_REVIEW_BRIEF.md` §3）

**七个固定维度（逐条给结论，审查对象=新增/修改代码；被删符号确认零残留引用）**

1. **接入性与装配**：每个新增/修改符号有调用点（`文件:行`）吗？路由/注册/依赖注入接上了吗？有 UI 时走三层链路：①路由/挂载注册 ②入口可达（哪个已有界面能点到？说不出=断）③交互元素绑定 handler 且链到业务逻辑。任一层断 = **P1**。前后端项目加查：请求/响应结构与 `docs/V4_DATA_MODEL.md` §7 契约一致（字段名/层级/类型）？仓内路由 = `app.json` 页面声明 + `cloudfunctions/api/router.js` + `shared/actions.js` 三处一致性。
2. **逻辑性**：空值/越界/并发重复提交/失败路径（不是空 catch）/入参校验，逐个新增与被修改函数过一遍；多步写操作事务边界（要么全成要么全败）；异步竞态与写接口幂等（重试/重复提交不产生脏数据）；时区与日期边界；货币精度（本仓零金额，命中即 P0 级红线）。
3. **牵连性**：先赋值再搜（`Select-String` 找全调用方）；被修改符号的既有调用方行为兼容；被删符号零残留；四份文档需同步未同步：`docs/V4_DATA_MODEL.md`（接口/错误码）、`CHANGELOG.md`、`docs/TECH_DEBT.md`、`docs/ARCHITECTURE.md`（冻结接口）——任一不存在写 N/A + 原因。
4. **性能**：六类典型——N+1 查询/无界查询（缺 LIMIT）/循环内 IO/大列表重复渲染/请求路径同步长任务/无索引 WHERE；资源泄漏（未关闭连接/文件/定时器/事件订阅，前端 effect 未清理）。
5. **冗余死代码**：每个新增符号使用次数；复制粘贴只改名；永远真/假分支。疑似保留必须写理由。
6. **开发规范**：命名一致性/注释写 Why 不写 What/类型安全/函数 >50 行、文件 >500 行（工具已强制的门禁项不重复报，除非门禁漏检；测试文件豁免至 ≤1000 行）；提交信息格式（本仓 `^(feat|fix|docs|test|chore)\(v4\):`）；对照 ENGINEERING §7 + AGENTS §4 六条硬标准。
7. **安全**：新接口都鉴权了吗（前端隐藏≠后端校验，查水平越权）；注入/参数化；XSS（用户输入渲染前转义）；CSRF（小程序无浏览器 CSRF，可写 N/A+原因）；上传验类型大小/路径防 `../`；密码强哈希（本仓无密码，写 N/A+原因）；密钥硬编码/日志脱敏/CORS/debug/**依赖漏洞（本仓云函数仅 `wx-server-sdk`，本机无 node_modules → 无法 npm audit，写 N/A + 原因并核对 package.json/lockfile 是否存在）**；AI/agent 面**（本仓有服务端 AI 外呼：工具参数 allowlist/三值策略/审计）**；外部内容与凭据面**（密钥/token 引用禁止回显明文，发现处只记 `kind + 位置 + SHA-256[:8]`）。
   - 安全轴四条硬规则：①每条安全发现给「入口 → 传播 → 终点」三处 `文件:行`（缺一=未验证）；②`overall_severity ≤ impact.score`，未验证不得标严重度；③验证者身份分离：**你只写"待独立复核"**，Lead 派独立验证者从源码反驳；④格式错/缺字段的发现直接作废重做。
8. **条件维（按触发启用，不适用写 N/A + 原因）**：⑧ UI 可访问性（前端：状态齐全/对比度/触摸目标 44px/空态错误态）；⑨ 外部调用（本仓仅服务端 DeepSeek：适配层/显式超时/降级/重试）；⑩ 性能预算（热路径改动时；预算文件=ENGINEERING §2.3 体积预算；无预算 → 按维度 4 六类定性并标注"无预算基线"）；⑪ 数据隐私（本仓涉订单/头像/昵称/宿舍：D3/D4 字段加密？日志脱敏/用途限定/注销清除）。

**气味基线（≥6 行，逐行给判据；判断题，给判断与理由，不给"违规"裁定）**

| 气味 | 判据 |
| :-- | :-- |
| 长函数 | 超过本仓行数上限（50/500/1000 行阈值） |
| 重复代码 | 同一段逻辑出现第 2 次 |
| 参数过多 | 参数 >4 个 |
| 发散式变化 | 一个文件因多个不相关原因被改 |
| 霰弹式修改 | 一个改动要动 >3 个文件 |
| 命名不达意 | 读名字猜不出行为 |

**越界与取代废弃**

- 越界：语义性"顺手/顺便优化"→建议 revert；纯机械格式化→不 revert、说明工具来源、建议拆独立提交；出现 SCOPE 从未讨论的文件 → 红旗（本仓 SCOPE=CONTRACT §7 页面地图 + ARCHITECTURE §2 写作用域，可查）。
- **取代与废弃检查（命中即红灯）**：①并行实现未删（旧文件/旧函数/旧分支/旧常量 + `STATE.md` 无登记行；合法保留仅灰度/兼容契约/证据留存三种，证据留存答案=git 历史，工作树第二份副本即违规）；②新增行命中 `_old\b|_legacy|_v2\b|Deprecated|暂时保留|废弃|TO\x44O[:：]\s*(删|remove|delete)`（其中待办标记用 `TO\x44O` 转义写法写出，正则语义与字面三字母标记等价；正文与命令逐字同一正则）→ 必须写保留理由与删除条件，否则红灯。C 负责全仓扫描并贴命令原文+完整输出（空输出也贴，注明基线断言已通过）。

**严重级与建议色（唯一判据）**

- P0 = 崩溃/数据丢失/安全漏洞｜P1 = 核心功能不可用（含装配断链）→ 二者必须清零｜P2 = 边缘功能报错/体验不佳｜P3 = 拼写/样式/非关键提示。不确定按 P2。
- 建议色矩阵：🔴 红 = P0≥1 或 P1≥1 或取代废弃命中（登记簿缺行/废弃标记未申报）；🟡 黄 = P0=P1=0 且有 P2/P3；🟢 绿 = P0=P1=0 且旧报告 P0/P1 全部核销（本轮 N/A）。**审查者只给建议色，裁决是人。**
- 核销计数：旧问题三态本轮 N/A；新发现每条须三件套（命令原文+退出码+命中行），缺 → 计入"依据未复现"栏，不进 P 级计数；"部分修"不存在（本轮无修复）。
- 去重：Lead 汇总时按 `文件:行 + 一句话事实` 去重；同一事实两轴都提只算一条。

### 1.9 派单输入单

- 见 §0（DESCRIPTION / PLAN_OR_REQUIREMENTS / BASE_SHA / HEAD_SHA 已抄录）。

---

## 2. 覆盖地图

> 规格轴口径：本轴只回答「实现是否符合规格」。7 个标准固定维度里的代码质量结论归 A1/A2/B1/B2/C，本表只记**规格相符性核对**是否覆盖（✓ 已核对 / 部分 / ○ 未覆盖+原因）。

| 文件（组） | 覆盖 | 核对内容与依据 |
| :-- | :-- | :-- |
| `docs/V4_CONTRACT.md`（634 行） | ✓ 全读 | §0/§1/§3/§4/§5/§6/§7/§8/§9/§10/§11/§12/§13/§15 |
| `docs/ARCHITECTURE.md`（225 行） | ✓ 全读 | §2 写作用域、§3.1~§3.6 冻结接口、§4 云函数冻结接口、§5 |
| `docs/V4_DATA_MODEL.md`（998 行） | 部分 | §5（索引/查询/分页）、§7（API 契约）、§10（留存/注销）、§2.10/§2.13/§2.14、§12 节选已读；§1~§4 字段表仅按引用点抽读 |
| `docs/V4_UX_CUSTOMER.md`（799 行） | 部分 | §12.1~§12.5 验收清单全读 + §3/§4 抽读；逐页交互 ○（B1 域） |
| `docs/V4_UX_PARTNER.md`（829 行） | ○ | 仅目录与 §6 会话条款抽读；逐页规格/验收由 B2 覆盖，本轴不重复 |
| `docs/V4_UX_DEVELOPER.md`（799 行） | 部分 | §9 AC-D-01~AC-D-33 全读 + §3.9/§5/§6/§7/§11 抽读；页面渲染 ○（B2 域） |
| `docs/V4_ENGINEERING.md`（1008 行） | 部分 | §4.7 cleanup 判据、§4.10 AI、§4.11 测试章节按引用点抽读；门禁判据是否有牙归 C |
| `cloudfunctions/api/middleware/**` | ✓ | switch-session / ratelimit / (auth 引用点) |
| `cloudfunctions/api/handlers/{user,customer,partner,bind,order,message,upload,config,admin,ai}` | 部分 | 逐项核对约 25 个 handler（get/deleteAccount/prepare/getPublic/updateConfig/stats/viewAsStart/list*/getRecognitionFailure/fix/correct/undo/cancel/reject/markPicked/create 片段等）；其余 ○（A1/A2 域） |
| `cloudfunctions/api/db/**`、`lib/ai/**` | 部分 | dto/full、config、ai/payload 核对；其余 ○ |
| `cloudfunctions/cleanup/sweeps/**` | 部分 | recognitionFailures 全读；storage/orders/accounts/retention/viewSessions/testData/counters/invitations 按常量与口径 grep |
| `shared/**`（13 个纯件） | 部分 | actions/collections/error-codes/error-copy/enums 清单、validate/order-state 关键守卫、defaults 键名 |
| `api/**`（client + 12 modules + upload/privacy/mode-guard） | ✓ | 模块方法清单、viewTicket 注入、TTL/重试常量 |
| 页面 30 个（`pages/` + 三端分包） | ○ | 页面存在性与 app.json 一致性由门禁 #02 覆盖并已 PASS；逐页交互/五态/文案归 B1/B2 |
| `components/**`（16 个） | ✓ | 冻结 props/events 对照 + switch-bar 首子节点检查 |
| `app.json` / `custom-tab-bar/` / `store/` | ✓ | 页面地图、tabBar 三格、viewContext 内存态 |
| `tools/**` 门禁脚本 | ○ | 判据是否有牙/是否空转归 C |
| `docs/privacy/*` | ✓ | 与代码收集点/剪贴板/AI 披露一致性抽核 |
| `docs/QA_CHECKLIST.md` | 部分 | 相关 R/T/P 分区条目抽读（人执行，不代勾） |

---

## 3. 问题清单

> 格式：`编号 | 级别 | 位置 | 描述 | 影响 | 修复建议`；证据（命令原文+退出码+命中行）集中在 §3.2，逐条对应。P 级判据见 §1.8（严重级与建议色）。

### 3.1 清单

| 编号 | 级别 | 位置（文件:行） | 描述（需求 vs 实现） | 影响 / 触发条件 | 修复建议 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| R-D-01 | P2 | `cloudfunctions/api/handlers/admin/getRecognitionFailure.js:32`；对照 `cloudfunctions/api/handlers/order/imageUrl.js:17` | 需求（CONTRACT §4.3 / D17 / §11.3 / §10 权限矩阵、AC-D-25、DATA_MODEL §2.14/§7.9、RUNBOOK §11）：复核页原图「临时 URL 5 分钟」。实现签发时**未传 `maxAge`**，仅把响应里的 `expiresAt` 按 5 分钟计算；同仓另一处签发点 `order.imageUrl` 明确 `maxAge: URL_TTL_SECONDS(300)` → 两处口径不一致，5 分钟承诺在复核页**没有实现保障** | 原图链接实际有效期取决于云开发缺省值，可能显著长于 5 分钟且页面仍显示 5 分钟 → 隐私承诺（D17/隐私指引「临时链接约 5 分钟」）落空 | 复核页签发改为 `fileList: [{ fileID: fileId, maxAge: 300 }]`（与 `order/imageUrl` 对齐），并补断言「签发参数含 maxAge=300」 |
| R-D-02 | P2 | `cloudfunctions/cleanup/sweeps/recognitionFailures.js:65`；`cloudfunctions/api/handlers/admin/fixRecognitionFailure.js:121`~`:127`；`cloudfunctions/cleanup/sweeps/_util.js:151` | 需求（CONTRACT §4.3「保留期…到期 cleanup 删原图引用并把记录置 IGNORED」、§11.1「识别失败原图默认 30 天删除」、DATA_MODEL §2.14/§10.1/§10.2 步骤 3b、隐私指引「默认 30 天后删除」）：**到期删原图引用**。实现 cleanup 只处理 `IGNORED/PENDING` 两态，**`FIXED` 记录被排除**；`fixRecognitionFailure` 置 FIXED 时**不清 `fileId`**；而删文件前会统计 `recognition_failures.fileId` 引用数 → FIXED 记录永久持有引用，原图**永远不会被删**。另：ENGINEERING §4.7 写的到期条件是「`status≠FIXED`」，与 CONTRACT/DATA_MODEL/隐私指引冲突，实现跟了 ENGINEERING | 上传者仍为活跃账号、其失败记录被补录后：原图超出 30 天承诺长期保留（可达账号存续期），且后台复核页仍可继续查看该原图（R-D-01 叠加）→ 违反对外留存承诺；审核/抽查对照隐私指引即可发现不一致 | ①统一口径：以 CONTRACT/DATA_MODEL 为准，`FIXED` 同样到期删原图引用（可保留记录与脱敏文字）；②`fixRecognitionFailure` 在 FIXED 时同时把 `fileId` 置空并按引用计数回收文件；③同步 ENGINEERING §4.7 条件 |
| R-D-03 | P3 | `cloudfunctions/api/middleware/switch-session.js:16`~`:29`；对照 `docs/V4_CONTRACT.md:76`、`docs/V4_DATA_MODEL.md:732` | 需求（CONTRACT §1.2「只读视角允许的读接口（服务端登记白名单）」= **10 个**；DATA_MODEL §7.7 同写 10 个）：实现为 **12 个**，多出 `partner.getCustomer`、`partner.stats`。DATA_MODEL §7.4 批 7 已写「READONLY 可读 listBindings/getCustomer/stats」，但**唯一口径 CONTRACT §1.2 与 §7.7 未回写** | 安全边界口径落后于实现：按 CONTRACT 复核/写测试的人会认为这两项应被拒；换实现方按旧口径做会与现网行为冲突 | 由 Lead 回写 CONTRACT §1.2 与 DATA_MODEL §7.7 白名单为 12 项（或裁决收窄实现），并补一条「READONLY 白名单 = 实现常量」的机器断言 |
| R-D-04 | P2 | `pages/partner/workbench/index.js:173`~`:179`；全仓 `hideShareMenu` 0 命中 | 需求（CONTRACT §1.2「只读视角下隐藏所有页面的分享/转发/长按保存入口」、§1.3 测试会话同、§15 O3、AC-D-12/AC-D-28/AC-C-61「隐藏分享」、UX_PARTNER §6.2）：切换会话下**隐藏分享/转发入口**。实现：①全仓无 `wx.hideShareMenu` 调用；②`workbench.onShareAppMessage` **不判会话**，切换会话下仍以目标兼职编号拼 `?bind=` 卡片分享（`customers`/`profile` 两处有会话降级，`workbench` 没有）；③仅 wxml 分享按钮加了 `wx:if="{{!sessionView}}"`，右上角菜单转发仍可用 | 开发者只读/测试会话中，仍可通过右上角「转发」把含目标兼职编号的页面卡片发出去（对象资料/编号被转发），违反 O3 防转发的目的；审核点检 AC-D-12 会失败 | ①业务页在 `viewContext` 存在时调 `wx.hideShareMenu({menus:['shareAppMessage','shareTimeline']})`（进入会话与 `onShow` 时执行，退出恢复）；②`workbench.onShareAppMessage` 复用 `pages/profile/parts/share-card.js` 的会话降级逻辑；③补机器断言「session 下 hideShareMenu 被调用」 |
| R-D-05 | P3 | `cloudfunctions/api/handlers/admin/viewAsStart.js:142`~`:158`；`cloudfunctions/api/handlers/user/_common.js:167`~`:183`；`components/switch-bar/index.js:69` | 需求（CONTRACT §1.3 固定文案「测试账号 · 顾客 C-…（测试） · **由 DEV-01 切换** · 退出」、§15 O10 多开发者后台抬头显示 `developerNo`、AC-D-28/AC-C-61 逐字）：蓝条文案含 `developerNo`。实现：`viewAsStart` 响应（`sessionPayload`）与 `user.bootstrap` 的 `viewContext`（`buildViewContext`）**都不下发 `developerNo`**（票据文档里有，但从未进 DTO/客户端内存），`switch-bar` 只能回落为「由开发者切换」 | 蓝条文案与验收逐字要求不符；多开发者（DEV-02…）场景下客户端无法显示/区分当前是哪个开发者的会话（审计侧仍可查，界面不可见） | ①`sessionPayload`/`buildViewContext` 增 `developerNo`（非敏感，仅展示编号）；②DATA_MODEL §7.6 `viewAsStart` 出参与 ARCHITECTURE §3.4 `viewContext` 形状同步补该字段；③`switch-bar` 用例断言逐字文案 |
| R-D-06 | P2 | `cloudfunctions/api/handlers/admin/_common.js:18`、`:288`、`:340`；`cloudfunctions/api/handlers/admin/listCustomers.js:74`；`cloudfunctions/api/handlers/admin/listPartners.js:60` | 需求（DATA_MODEL §5.2「admin 顾客列表：`customerNo` 精确（`uk_customer_no`）/`dormKey` 精确（`idx_dorm_key`）/`displayName` 前缀（`idx_display_name`）」、§5.3「游标分页、禁止 `skip`」「禁止 `where({})` 全表扫描与客户端过滤」「每个新增查询必须登记 §5.2 并命中索引」）：实现 `admin.listCustomers` 用 `where({})` + `findPage(skip)` + **扫描后在内存匹配**（`MAX_SCAN=500`），`admin.listPartners` 的关键词同样内存匹配；均未走文档声明的索引 | ①后台搜索**可能漏结果**：目标记录不在前 500 条扫描窗内时搜索返回空（假阴性）；②分页用 skip，深翻页成本随 offset 增长；③DATA_MODEL §5.2 的索引判据在代码里不可验证（门禁无法据此断言） | ①按 §5.2 改为索引查询：`customerNo` 走 `uk_customer_no` 精确、`D4`/`D4-522` 走 `idx_dorm_key`（前缀）、`displayName` 走 `idx_display_name`；`partners` 关键词走 `uk_partner_no`；②分页改游标；③补「admin 查询必须 where 非空 + 命中登记索引」的断言（或把 §5.2 降级为建议并在文档写明扫描窗上限，二者择一，不能既不实现也不改口径） |
| R-D-07 | P3 | `cloudfunctions/api/handlers/admin/_common.js:296`、`:332`；对照 `docs/V4_DATA_MODEL.md:628` | 需求（DATA_MODEL §7.1「分页统一 `{cursor?:{sortValue,orderNo}, limit?}` → `{list,nextCursor\|null}`」）：实现后台列表的 cursor 为 `{offset}`（`parsePage` 读 `cursor.offset`，`nextCursor:{offset}`） | 契约形状不符：按 §7.1 写客户端/测试会取不到 `sortValue`；不同来源分页语义不一致（用户侧用 sortValue 游标，后台用 offset） | 二选一：实现改为 `sortValue` 游标（与 §5.3 一致），或回写 DATA_MODEL §7.1 明确「后台列表允许 offset 游标 + 扫描上限」 |
| R-D-08 | P3 | `components/maintenance-mask/index.js:5`~`:10`；`components/switch-bar/index.js:89`；`components/code-editor/index.js:17`；`components/image-picker/index.js:77`；`components/form-field/index.js:9`~`:10`；对照 `docs/ARCHITECTURE.md:118`~`:137` | 需求（ARCHITECTURE §3.5 冻结组件 props/events 表）：①`maintenance-mask` props 应为 `view`（`{enabled,title,text}`，来自 `utils/maintenance.buildMaintenanceView`），实现为 4 个扁平 props `enabled/title/text/actionText`，页面 wxml 也按扁平传参（功能可用，但冻结接口与实现/文档三方不一致）；②`switch-bar` 表登记 events `exit`，实现无 `triggerEvent`（内部调 `session.exitViewContext()`），`exit` 事件不存在；③`code-editor` 表只登记 `change`，实现另有 `blur`；④`image-picker` 表只登记 `change`，实现另有 `error`；⑤`form-field` 表 props 只登记 5 个，实现另有 `maxlength`/`error` | 冻结接口文档不可作为实现契约使用（照文档写的页面会传错 props/绑定不存在的 event）；后续并行开发以表为准会踩空 | 以实现为准回写 ARCHITECTURE §3.5（maintenance-mask 改扁平 props 或实现改 `view` 对象——建议改文档，因页面已按扁平上线；补齐 `switch-bar.exit` 删除或实现事件；登记 `blur`/`error`/`maxlength` 等） |
| R-D-09 | P3 | `api/modules/partner.js:21`、`:25`；`api/modules/admin.js`（无 `bootstrap`）；对照 `docs/ARCHITECTURE.md:69`、`:76` | 需求（ARCHITECTURE §3.2 客户端冻结接口表）：`partner` 模块登记的方法缺 `getCustomer`、`stats`（实现与 CONTRACT §5.3 有）；`admin` 模块登记了 `bootstrap`（实现未导出，且 ARCHITECTURE §4.3/`shared/actions.js` 把 `admin.bootstrap` 标为 internal → 表与表自相矛盾） | 冻结接口表与实际可调用方法不一致；按表做的客户端会调用不存在的方法/漏掉存在的方法 | 回写 ARCHITECTURE §3.2：`partner` 补 `getCustomer/stats`，`admin` 去掉 `bootstrap`（保留 §4.3 internal 说明） |
| R-D-10 | P3 | `cloudfunctions/api/handlers/admin/viewAsStart.js:32`、`:188`；`shared/validate.js:367`~`:372`；对照 `docs/V4_CONTRACT.md:71` 与 `:352` | 需求（CONTRACT §1.2 签名 `admin.viewAsStart({role, targetNo, mode='READONLY'})` → mode 默认 READONLY）：实现 `parseMode` 直接 `validateViewMode(value)`，**无缺省值**，不传 `mode` → `NOT_ALLOWED`/`VALIDATION_FAILED`。且 CONTRACT §5.3 的动作表写法（`{role,targetNo,mode:'READONLY'|'TEST_WRITE'}`）未写默认值 → CONTRACT 内部两处不一致 | 契约默认值未实现；按 §1.2 省略 mode 的调用方（后台脚本/测试）会被拒；文档读者无法确定哪个口径为准 | 二选一：实现补默认 `READONLY`（推荐，与 §1.2 一致，且真实账号只读更安全），或回写 §1.2 去掉默认值并统一 §5.3 |
| R-D-11 | P3 | `pkg-admin/pages/invite-codes/index.js:164`；`pkg-partner/pages/stats/index.js:58`；对照 `docs/V4_CONTRACT.md:503`、`docs/privacy/隐私保护指引.md:48` | 需求（CONTRACT §11.2「剪贴板…**仅用于两个明确动作**——①用户点击「复制」时把订单号/唯一编号写入系统剪贴板；②绑定页点击「粘贴」时读取兼职编号」）：实现除两类动作外，还向剪贴板写入**邀请码批次**（`onCopyAll`）与**日报摘要**（`onCopyReport`） | 隐私披露/微信后台「剪切板」声明与实际使用用途不一致（声明只写订单号/编号）；复盘/审核逐条对照时会认为实现越界 | 二选一：①口径补登（CONTRACT §11.2 与隐私指引补「复制邀请码、复制日报摘要」两类用途并说明不保存不上传）；②实现收敛（邀请码改为页面内展示不放剪贴板；日报改为站内分享卡片或文本选择复制） |
| R-D-12 | P3 | `cloudfunctions/api/handlers/admin/listCustomers.js:26`~`:41`；对照 `docs/V4_DATA_MODEL.md:529` | 需求（DATA_MODEL §5.2：admin 顾客列表 `customerNo` **精确**（`uk_customer_no`）、`displayName` **前缀**（`idx_display_name`））：实现为 `customerNo` **前缀**匹配（`indexOf(...) === 0`）、`displayName` **全等**匹配（`===`）；宿舍关键词只匹配「苑+楼栋」（`D4`），不支持 `D4-522` 的 `dormKey` 精确 | 搜索语义与文档相反：按编号前缀能搜到多个（文档要求精确）、按昵称前缀搜不到（文档要求前缀）、按完整 `dormKey` 搜不到（文档要求 dormKey 精确）；AC-D-10「顾客按编号/苑+楼栋/昵称」与文档细节不一致 | 统一到一个口径并写进 §5.2/§7.6：建议 `customerNo` 精确或前缀二选一并注明、`displayName` 前缀、`dormKey` 支持 `D4` 与 `D4-522` 两级；同步 UX_DEVELOPER §5.4 搜索说明 |
| R-D-13 | P3 | `cloudfunctions/api/handlers/upload/prepare.js:59`~`:85`；对照 `docs/V4_CONTRACT.md:213`、`docs/V4_DATA_MODEL.md:698` | 需求（CONTRACT §4.1：`upload.prepare`「入参 `purpose:'TICKET'\|'AVATAR'`」+ 校验身份/配额）：实现实际要求 `size`（并按 size 比对上限）与 `contentType`（AVATAR 必传、TICKET 兼容聊天 gif 时可不传），DATA_MODEL §7.6 已写 `{purpose,draftId,contentType,size}`，ARCHITECTURE §3.3 也写了真实入参 → **唯一口径 CONTRACT §4.1 只写了一半**（缺关键入参契约与「TICKET 可不传 contentType」的例外） | 按 CONTRACT 实现的客户端会漏传 `size`/`contentType` 导致 `VALIDATION_FAILED`；照 §4.1 写测试无法覆盖真实校验面 | 回写 CONTRACT §4.1：入参改为 `{purpose,size,contentType?}`（说明 TICKET 可不传 contentType 的原因），并把 `draftId` 是否必传写清（实现侧有/无行为需同步核对） |

### 3.2 证据（命令原文 + 退出码 + 命中行）

- **R-D-01**
  ```powershell
  PS> Select-String -Path cloudfunctions\api\handlers\admin\getRecognitionFailure.js -Pattern 'getTempFileURL'
  cloudfunctions\api\handlers\admin\getRecognitionFailure.js:32:const result = await cloud.getTempFileURL({ fileList: [fileId] });
  PS> Select-String -Path cloudfunctions\api\handlers\order\imageUrl.js -Pattern 'maxAge'
  cloudfunctions\api\handlers\order\imageUrl.js:17:result = await cloud.getTempFileURL({ fileList: [{ fileID: fileId, maxAge: URL_TTL_SECONDS }] });
  ```
  退出码 0。需求原文：CONTRACT `:60`「临时 URL 5 分钟」、`:270`、`:474`、`:519`、`:586`（D17）、`docs/QA_CHECKLIST.md:239` R6。

- **R-D-02**
  ```powershell
  PS> Select-String -Path cloudfunctions\cleanup\sweeps\recognitionFailures.js -Pattern 'const statuses'
  cloudfunctions\cleanup\sweeps\recognitionFailures.js:65:  const statuses = [util.enums.FAILURE_STATUS.IGNORED, util.enums.FAILURE_STATUS.PENDING];
  PS> Select-String -Path cloudfunctions\api\handlers\admin\fixRecognitionFailure.js -Pattern 'fileId'
  cloudfunctions\api\handlers\admin\fixRecognitionFailure.js:88:  const order = await scope.dao.findOne(COLLECTIONS.ORDERS, { where: { 'image.failureId': record._id }, limit: 1 });
  PS> Select-String -Path cloudfunctions\cleanup\sweeps\_util.js -Pattern 'refs.failures'
  cloudfunctions\cleanup\sweeps\_util.js:151:  if (refs.orders > 0 || refs.failures > 0) {
  ```
  退出码 0。需求原文：CONTRACT `:273`「保留期…到期 `cleanup` 删原图引用并把记录置 `IGNORED`（备注 `EXPIRED`）」、`:496`、DATA_MODEL `:837`（§10.1）、`:845`（§10.2 步骤 3b）；冲突源：ENGINEERING `:362`「且 `status≠FIXED`」。

- **R-D-03**
  ```powershell
  PS> Select-String -Path cloudfunctions\api\middleware\switch-session.js -Pattern "'partner\."
  :19:'partner.listBindings',
  :20:'partner.getCustomer',
  :21:'partner.stats',
  :34:const TEST_WRITE_READ_ALLOW = Object.freeze(['partner.getPublic']);
  ```
  退出码 0。需求原文：CONTRACT `:76`（列举 10 个）；DATA_MODEL `:732`（列举 10 个）；冲突源：DATA_MODEL `:662`（批 7 写 READONLY 可读 getCustomer/stats）。

- **R-D-04**
  ```powershell
  PS> (Get-ChildItem -Recurse -File -Include *.js,*.wxml -Path pages,pkg-customer,pkg-partner,pkg-admin,components | Select-String -Pattern 'hideShareMenu').Count
  0
  PS> Select-String -Path pages\partner\workbench\index.js -Pattern 'onShareAppMessage' -Context 0,5
  pages\partner\workbench\index.js:173:  onShareAppMessage() {
  :176:      title: '我在做校园代取，凭兼职编号找我下单',
  :177:      path: '/pages/role/index' + (partnerNo ? '?bind=' + encodeURIComponent(partnerNo) : '')
  ```
  退出码 0。需求原文：CONTRACT `:73`「隐藏所有页面的分享/转发/长按保存入口」、`:619`（O3）、`:735`；AC-D-12 / AC-D-28 / AC-C-61。

- **R-D-05**
  ```powershell
  PS> Select-String -Path cloudfunctions\api\handlers\admin\viewAsStart.js -Pattern 'function sessionPayload' -Context 0,17
  :142:function sessionPayload(session, duplicated) {  …（字段仅 viewTicket/viewMode/role/targetNo/targetDisplayName/targetIsTest/expiresAt(+targetAvatarFileId)，无 developerNo）
  PS> Select-String -Path cloudfunctions\api\handlers\user\_common.js -Pattern 'function buildViewContext' -Context 0,16
  :167:function buildViewContext(session) {  …（字段仅 viewMode/role/targetNo/targetDisplayName/targetIsTest/expiresAt(+targetAvatarFileId)，无 developerNo）
  PS> Select-String -Path components\switch-bar\index.js -Pattern 'developerText'
  :69:  developerText: view.developerNo ? '由 ' + view.developerNo + ' 切换' : '由开发者切换',
  ```
  退出码 0。需求原文：CONTRACT `:98`（蓝条固定文案）、`:626`（O10）、AC-D-28 / AC-C-61。

- **R-D-06**
  ```powershell
  PS> Select-String -Path cloudfunctions\api\handlers\admin\_common.js -Pattern 'MAX_SCAN =|skip: offset|offset\.offset'
  :18:const MAX_SCAN = 500;
  :296:  if (input.cursor && typeof input.cursor === 'object' && Number.isFinite(Number(input.cursor.offset))) {
  :340:    skip: offset,
  PS> Select-String -Path cloudfunctions\api\handlers\admin\listCustomers.js -Pattern 'findPage'
  :74:    const batch = await findPage(scope, COLLECTIONS.CUSTOMERS, {}, [['createdAt', 'desc']], page.offset + scanned, size);
  PS> Select-String -Path cloudfunctions\api\handlers\admin\listPartners.js -Pattern 'findPage'
  :60:    const batch = await findPage(scope, COLLECTIONS.PARTNERS, where, [['createdAt', 'desc']], page.offset + scanned, size);
  ```
  退出码 0。需求原文：DATA_MODEL `:529`（索引路径）、`:540`（「禁止 `skip`」「禁止 `where({})` 全表扫描与客户端过滤」）。

- **R-D-07**
  ```powershell
  PS> Select-String -Path cloudfunctions\api\handlers\admin\_common.js -Pattern 'nextCursor'
  :332:    nextCursor: rows.length >= limit ? { offset: nextOffset } : null
  ```
  退出码 0。需求原文：DATA_MODEL `:628`（§7.1 统一 cursor 形状）。

- **R-D-08**
  ```powershell
  PS> Select-String -Path components\maintenance-mask\index.js -Pattern 'enabled|title|actionText|triggerEvent'
  index.js:6:    enabled: { type: Boolean, value: false },
  index.js:7:    title: { type: String, value: '系统维护中' },
  index.js:9:    actionText: { type: String, value: '知道了' },
  index.js:14:    this.triggerEvent('ack', {});
  PS> Select-String -Path components\switch-bar\index.js -Pattern 'triggerEvent|onExit'
  :89:    onExit() {   （全文无 triggerEvent）
  PS> Select-String -Path components\code-editor\index.js -Pattern 'triggerEvent'
  :12:    this.triggerEvent('change', { value });
  :17:    this.triggerEvent('blur', { value });
  PS> Select-String -Path components\image-picker\index.js -Pattern 'triggerEvent'
  :21/:77:    this.triggerEvent('error', …)
  PS> Select-String -Path components\form-field\index.js -Pattern 'maxlength|error'
  :9:    maxlength: { type: Number, value: 200 },
  :10:    error: { type: String, value: '' }
  ```
  退出码 0。需求原文：ARCHITECTURE `:118`~`:137`（冻结表）。

- **R-D-09**
  ```powershell
  PS> Select-String -Path api\modules\partner.js -Pattern 'getCustomer|stats'
  :21:  getCustomer(payload) {
  :25:  stats(payload) {
  PS> Select-String -Path api\modules\admin.js -Pattern 'bootstrap'
  (空输出)
  ```
  退出码 0。需求原文：ARCHITECTURE `:69`、`:76`、`:181`（internal 清单）。

- **R-D-10**
  ```powershell
  PS> Select-String -Path shared\validate.js -Pattern 'function validateViewMode' -Context 0,5
  :367:function validateViewMode(value) {
  :368:  if (enums.VIEW_MODE_LIST.indexOf(value) === -1) {
  :369:    return fail('mode', 'NOT_ALLOWED');   （无缺省分支）
  PS> Select-String -Path docs\V4_CONTRACT.md -Pattern "mode='READONLY'"
  :71:（`admin.viewAsStart({role, targetNo, mode='READONLY'})` 校验白名单 …）
  ```
  退出码 0。

- **R-D-11**
  ```powershell
  PS> Select-String -Path pkg-admin\pages\invite-codes\index.js -Pattern 'setClipboardData'
  :164:    wx.setClipboardData({   （onCopyAll：复制整批邀请码）
  PS> Select-String -Path pkg-partner\pages\stats\index.js -Pattern 'setClipboardData'
  :58:    wx.setClipboardData({   （onCopyReport：复制日报摘要）
  ```
  退出码 0。需求原文：CONTRACT `:503`；隐私指引 `:48`。

- **R-D-12**
  ```powershell
  PS> Select-String -Path cloudfunctions\api\handlers\admin\listCustomers.js -Pattern 'indexOf\(noCheck|displayName ==='
  :29:    return typeof row.customerNo === 'string' && row.customerNo.indexOf(noCheck.canonical) === 0;
  :41:    return typeof row.displayName === 'string' && row.displayName === keyword;
  PS> Select-String -Path docs\V4_DATA_MODEL.md -Pattern 'indexOf\(noCheck'
  （无输出；需求原文在 DATA_MODEL :529）
  ```
  退出码 0。

- **R-D-13**
  ```powershell
  PS> Select-String -Path cloudfunctions\api\handlers\upload\prepare.js -Pattern 'assertImageInput|contentType|size'
  :40:function assertImageInput(input, maxBytes) {   …（:41 校验 contentType、:46 校验 size）
  :68:    assertImageInput(input, uploadCommon.avatarMaxBytes(config));
  :72:    assertImageInput(input, uploadCommon.TICKET_MAX_BYTES);
  ```
  退出码 0。需求原文：CONTRACT `:213`（只写 `purpose`）；补充口径：DATA_MODEL `:698`、ARCHITECTURE `:80`。

---

## 4. 通过项 / 已知项

以下为本次**已核对且符合规格**的项（只列可复跑证据的要点；命令统一退出码 0）：

1. **页面地图（30 页）与 app.json / CONTRACT §7 一致**：门禁 `node tools/check-docs.js --batch 1` #02 PASS（30 页）；`custom-tab-bar/` 在根目录、开发者页无 tabBar。
2. **action 注册表三处一致**：`shared/actions.js` 46 个 client + 11 个 internal action，与 CONTRACT §5.3 / router 一致；门禁 #03 PASS；`api/modules/*` 方法与 CONTRACT §5.3 逐域对照（唯一缺口见 R-D-09）。
3. **状态机与动作矩阵**：`shared/order-state.js` ↔ handlers ↔ 页面消费一致——`order.undo` 仅 markPicked/markDelivered 且 5 秒窗（`handlers/order/undo.js:41`）；`order.correct` PICKED 仅柜号/尾号（`correct.js:12`、`:47`~`:51`）；顾客取消 EXCEPTION 依赖 `exception.fromStatus`、admin 仅 EXCEPTION 介入并写 `ORDER_ANOMALY_CANCEL`（`cancel.js:31`~`:33`、`:52`~`:58`）；`order.markPicked` 无码须 DROP_OFF（`markPicked.js:17`~`:18`）；`order.reject` OTHER 必填备注（`reject.js:20`~`:24`）。
4. **错误码**：`shared/error-codes.js` = 13 码；`shared/error-copy.js` 13 码 + 错前缀三句；门禁 #04 PASS。
5. **隐私承诺与代码收集点一致**：位置/通讯录/手机号/身份证/好友/相册外等 API 全仓 0 命中（`wx.getLocation`/`getPhoneNumber`/`chooseAddress`/`getUserProfile`/`saveImageToPhotosAlbum`/`scanCode` 均为 0）；`wx.getClipboardData` 仅绑定页粘贴 1 处（边界问题见 R-D-11）；AI 外发键集合 = `['ocrTextMasked','hintTrackingTail','role']`（`lib/ai/payload.js:14`，与 CONTRACT §4.3/§11.3 白名单逐字一致）。
6. **后台脱敏**：`handlers/admin/_dto.js` 头部声明并实现「无 avatarFileId、昵称脱敏、码打码、尾号后 2 位、无 openid」；`maskDisplayName/maskPickupCode/maskPhoneTail/maskDorm` 在 `db/dto/mask.js`。
7. **留存链路与 CONTRACT §11.4 / DATA_MODEL §10 一致**：截图 `screenshotRetentionDays(7)` + 引用计数（`cleanup/sweeps/storage.js:23`~`:24`）；订单 180 天匿名化→30 天物理删、软删 7 天（`retention.js:10`~`:12`）；注销 30 天（`accounts.js:14`）；切换会话结束 7 天清理（`viewSessions.js:9`）；测试数据 30 天（`testData.js:8`）；识别失败记录 30 天（见 R-D-02 例外）。
8. **AI 兜底规格**：超时 8000ms、仅网络/5xx 重试 1 次、连续 5 次失败熔断 10 分钟、5 次/人/日 + 全局配额（`lib/ai/deepseek.js:22`~`:24`、`:65`~`:68`）；失败静默降级不占错误码；`config.aiFallback` 不在 `admin.updateConfig` 白名单（`updateConfig.js:1`~`:8`、`:25`~`:37`）。
9. **切换会话基础语义**：`READONLY` 写动作由 `shared/actions.js` 的 `write` 标记拒绝；`TEST_WRITE` 目标必须 `isTestAccount=true` 且票据交叉校验（`viewAsStart.js:55`~`:58`、`switch-session.js:190`）；票据只存内存（`store/index.js:108` 注释、`ARCHITECTURE §3.4`；`utils/storage.js` 无票据键）。
10. **限流表与 CONTRACT §10 对齐**：`RATE_RULES` 10 条（bind 5/日、partnerPublic 5/日、activate 5/日、order 20/日、message 30/日/单、correct 20/日/单、TICKET 30/日、AVATAR 5/日、切会话 20/日；AI 5/人/日 + 全局配额在 `lib/ai`）。
11. **组件装配规则**：18 个业务页 wxml 均以 `<switch-bar />` 为首子节点；`pkg-admin` 页零 `switch-bar`/`test-badge`；`custom-tab-bar` 按角色 3 格。
12. **轮询**：顾客详情基数 10s（`pkg-customer/parts/poll-policy.js:9`~`:11`，失败 20/40s 退避）；兼职工作台 `onShow` 刷新 + `setInterval(loadView.POLL_MS)`（`pages/partner/workbench/index.js:206`~`:212`）。
13. **隐私文本覆盖 v0.9 四类**：头像/昵称、第三方 AI、失败原图复核、账号切换均在 `docs/privacy/隐私保护指引.md` 有专门段落（`:9`、`:35`~`:41`、`:48`~`:51`、`:76`~`:79`），与代码收集点一致（剪贴板用途差异见 R-D-11）。
14. **已知项（不重复论证）**：无主文件清理为 TD-051 已登记限制（ENGINEERING §4.7 旁注）；`partners` openid 匿名化为 TD-053；`users.purgeAt` 预留为 TD-054。以上均已在 `docs/TECH_DEBT.md` 登记，本轮不重复计发现。

---

## 5. 结论

### 5.1 计数

- **P0 = 0；P1 = 0；P2 = 4（R-D-01/02/04/06）；P3 = 9（R-D-03/05/07/08/09/10/11/12/13）**。
- 本轮发现 **13** 条，均可行动（每条给了修复建议）；无「部分修」。
- **依据未复现 2 条（不进 P 级计数，附原因）**：
  1. R-D-01 的「云开发 `getTempFileURL` 未传 `maxAge` 时缺省有效期具体值」未在本轮取证（无真实云环境、官方默认值未取）；**已复现的事实**是「该签发点未显式限制 TTL、与 `order.imageUrl` 的 `maxAge=300` 不一致、无实现保障 5 分钟」——据此仍报规格不符，严重度按「承诺无实现保障」定 P2，若 Lead 要求更严可上调。
  2. R-D-06 的「500 条扫描窗外搜索假阴性」为**代码推演**（无真实库/数据量实测）；查询路径与 `skip`/内存过滤事实已复现，影响为逻辑必然（`MAX_SCAN=500` + `break`），但未做运行态复现。

### 5.2 旧问题三态

- N/A（无旧报告，`docs/reviews/` 本轮新建）。

### 5.3 取代与废弃检查

- N/A（本 part 无修复 diff；按 `_REVIEW_BRIEF.md` §3.6/§5，全仓替换与废弃扫描、降标守卫由 C part 执行并贴命令原文+完整输出）。本次审查范围内未发现并行实现/废弃标记的规格线索；如 C 报告命中，以 C 的为准。

### 5.4 建议色

- **🟡 黄**：P0=P1=0，存在 4 条 P2 + 9 条 P3（无取代废弃命中、无旧报告核销缺口）。审查者只给建议色，裁决是人。

### 5.5 未覆盖 / 需他人续接

- 页面逐页交互与五态/可访问性（B1/B2）、云函数安全纵深（A1/A2）、门禁判据是否有牙与全仓扫描（C）、UX_PARTNER 逐页验收（B2）——本轴未重复，见 §2 覆盖地图 ○/部分。
- 真机/后台/控制台可验证项（临时 URL 实际过期现象、扫描窗实测、类目与审核）只能由用户按 `docs/QA_CHECKLIST.md` 点检，agent 不代勾。
