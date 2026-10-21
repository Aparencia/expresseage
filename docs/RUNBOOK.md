# RUNBOOK · v4 部署与运维操作手册

> 定位：**只写"人怎么操作、按什么顺序、留什么证据"**。设计口径（环境矩阵/云函数分层/集合索引/清理任务/回滚策略）见 `docs/V4_ENGINEERING.md` §3.5、§4.6、§4.7、§10，本文不重复。
> 执行人：**用户**（云开发控制台操作）+ **Lead**（仓库侧命令与冒烟）；其他 agent 只读本文，不得代做发布/提审/删库/tag。
> 现状：批 1 骨架阶段，云开发资源尚未创建；按 §3 的顺序在批 1 收口时执行，执行一项更新 §13 一行。

## 1. 环境矩阵

| 环境 | 云环境 | 用途 | 谁能动 |
| :-- | :-- | :-- | :-- |
| develop（工具内） | dev | 日常开发、单测、本地调试 | Lead/agent（只读联调） |
| trial（体验版） | dev | 双端验收、开发者后台与账号切换演练、测试账号单机验收 | 用户（体验成员 + 开发者微信号） |
| release（线上） | prod | 正式发布 | 仅用户 |

- 切换规则：`develop/trial → dev`、`release → prod`；**禁止用 prod 做开发联调或造测试数据**（ENGINEERING §3.3）。
- 小程序**不能切换微信登录账号**；开发者验收走"真实账号只读 + 测试账号可写"的账号切换（CONTRACT §1.2/§1.3）。

## 2. 前置条件（只能用户完成）

1. 确认 appid `wxf98c87a293092ef5` 主体可用（D2）。
2. 开通云开发并创建 **dev、prod 两个环境**（D1），把两个 envId 交 Lead 填入 `config/env.js`（envId 不是密钥，可入库）。
3. 确认主体/类目（D13，快递/跑腿资质；阻塞批 9 提审）。
4. 准备一个开发者微信号（用于白名单）与一个可扫码真机；**单机验收只需一个微信号**（测试账号覆盖顾客/兼职两端）。
5. 本机安装微信开发者工具（GUI），导入仓库根目录 `D:\Code\expressage_college_v4\`，确认 CloudBase 云开发面板可打开、`cloudfunctionRoot` 被识别。

## 3. 首次部署顺序（批 1 收口，按序执行）

### 3.1 建环境

- 位置：微信开发者工具 → 顶部「云开发」→ 开通 → 新建环境（dev）/再建 prod；记录每个环境的 envId。
- 期望：两个环境状态"正常"；envId 与实际环境一一对应。
- 证据：控制台环境页截图（envId 可见）+ 填好的 `config/env.js`。
- 失败处理：主体未认证/额度不足按控制台提示处理，不绕过。

### 3.2 仓库侧就位

- 命令：`git var GIT_AUTHOR_IDENT`（身份应为 `lead <lead@local>`）、`powershell -File check.ps1`（批 1 收口时为绿）。
- 确认 `.gitignore` 挡住 `.env*`/`project.private.config.json`/`node_modules/`；`project.private.config.json` 只在本地存在。
- 记录基础库版本到 `.tool-versions`（以工具「详情 → 本地设置」实际值为准）。

### 3.3 同步共享代码并部署 `api`

- 位置：微信开发者工具 → 资源管理器 → `cloudfunctions/api` 右键 →「上传并部署：云端安装依赖」。
- 前置命令：`node tools/sync-cloud-shared.js`（把 `shared/**` 与 `utils/ids.js`、`utils/room-tag.js` 同步到云函数 shared 副本；上传前必跑）。
- 期望：部署成功；云函数日志出现启动记录、无 require 报错。
- 证据：部署成功弹窗 + 云函数版本页截图。

### 3.4 配置 `api` 云函数（控制台）

- 位置：云开发控制台 → 云函数 → `api` → 函数配置。
- 运行时：`Nodejs18.15`（以控制台可选列表为准）；超时/内存按控制台可选项设置，**实际值截图并记入 §13**（仓库不硬编码具体数值）。
- 环境变量：
  - `ADMIN_OPENIDS`：JSON 映射，如 `{"<openid>":"DEV-01"}`；真实 openid 只存在于控制台，**永不进仓库/文档/截图明文**。
  - `DEEPSEEK_API_KEY`：可先留空（留空 = AI 兜底静默降级，应用可正常启动）；E11 确认后再填。
- 证据：环境变量页截图（键名可见、值打码）。
- 失败处理：`admin.*` 全 `FORBIDDEN` 时优先检查该变量是否为合法 JSON、当前 openid 是否在映射内。

### 3.5 建数据库资源（用户，控制台）

- 位置：云开发控制台 → 数据库。
- 建 **14 个集合**（名称见 ENGINEERING §4.6；v0.9 不新增集合）。
- 每个集合 → 权限设置 → **自定义安全规则**：`{"read": false, "write": false}`（客户端全部拒绝）。
- 按 DATA_MODEL §5.1 建全部索引；**唯一索引必须建**（如 `uk_customer_no`、`uk_partner_no`、`uk_active_key`、`uk_order_no`、`uk_request_key`、`uk_code`、`uk_failure_no`）。
- 证据：集合列表截图 + 索引导出/截图 + 每个集合安全规则截图。
- 失败处理：存量冲突先清场再建唯一索引；控制台不支持代码建索引时以控制台为准，`admin.bootstrap` 只做校验与缺失项提示。

### 3.6 部署 `cleanup` 并配定时触发器

- 位置：`cloudfunctions/cleanup` 右键上传部署；随后 云开发控制台 → 云函数 → `cleanup` → 触发管理 → 添加定时触发器。
- 配置：**只配一条**，每 10 分钟执行一次（单触发器跑全部到期任务，幂等；ENGINEERING §4.7）。
- 证据：触发器配置截图（频率/下一次执行时间）+ 首次执行日志。
- 失败处理：不执行时检查触发器是否启用、函数版本是否最新、日志里是否有超时；可先在控制台手工测试调用一次。

### 3.7 配置云存储权限

- 位置：云开发控制台 → 存储 → 权限设置。
- 选择"仅创建者可读写"；若平台不满足"禁创建者直读"，改用自定义安全规则（`read=false`、`write` 仅登录用户）。批 1 需真机实测上传可用性（E5/R2）。
- 目录约定：截图 `orders/{ticket}/image.jpg`；头像 `avatars/{role}/{random}.jpg`（不含 openid）。查看一律临时 URL 5 分钟，不公开读、不用永久链接。
- 证据：权限页截图 + 真机上传成功记录（自检/体验版）。

### 3.8 配置种子与冒烟

- 用户：在 `config` 集合写 `_id='global'` 的种子（或由 `admin.bootstrap` 幂等建/校验），键与默认值见 ENGINEERING §3.6；`privacyVersion` 随隐私文本定稿回填。
- Lead/用户：云开发控制台 → 云函数 → `api` → 测试 → 调用内部动作 `health.check`、`admin.bootstrap`（仅在开发者白名单下可用）；期望返回集合/索引清单、`configSeeded`，重复调用结果一致。
- Lead：`node tools/seed-dev.js` 写 dev 种子（内置环境断言，prod 拒绝运行；含服务类型目录、测试邀请码批次、测试顾客/兼职资料）。
- 冒烟：`account-switch` 开 READONLY 读写边界；测试账号走 `TEST_WRITE` 两端各一单；头像上传/替换；删除测试账号（先 `dryRun` 看计数）；审计 `ACCOUNT_SWITCH_*`/`TEST_ACCOUNT_*` 可查。详细清单见 §9。
- 证据：命令/接口返回原文 + 后台截图。

## 4. 每批部署（实施期）

1. Lead：本地 `powershell -File check.ps1` 绿（含 `check.js`、`check-docs.js`、全部 `selftest*`、无费用语义扫描）→ `node tools/sync-cloud-shared.js` → 如改动云函数则上传部署。
2. dev 冒烟：`health.check` + 本批新增动作的最小链路（用户真机或 Lead 调云函数）；批 2/3/4/8 的专项冒烟见 ENGINEERING §10.3。
3. 更新 `CHANGELOG.md`"未发布"与 `STATE.md` → Lead 提交 → 回读 HEAD → `gate.ps1` 绿 → 保留真实输出。
4. 体验版只在批 5/6/8/9 由用户发布；每批验收项写入 `docs/QA_CHECKLIST.md`；**agent 不代勾人执行项**。

## 5. 云函数配置基线（记录实际值，不写死）

| 项 | 值/规则 | 位置 | 记录到 |
| :-- | :-- | :-- | :-- |
| `api` 运行时 | Nodejs18.15（以控制台可选为准） | 云函数 → api → 函数配置 | §13 |
| `api` 超时/内存 | 控制台可选项；按实测冷启动与耗时选择 | 同上 | §13 |
| `api` 环境变量 | `ADMIN_OPENIDS`（JSON 映射）、`DEEPSEEK_API_KEY`（可空） | 同上 | §13（键名可见、值打码） |
| `cleanup` 触发器 | 一条，每 10 分钟 | 云函数 → cleanup → 触发管理 | §13 |
| 函数日志保留 | 控制台日志设置（最短可用期限） | 云开发控制台 → 日志 | §13 |
| 调用配额/告警 | 按真实单量评估后设置告警 | 云开发控制台 → 用量/告警 | §13（批 9 评估） |

## 6. 数据库与安全规则要点

- 14 集合、索引全集、唯一索引以 `docs/V4_ENGINEERING.md` §4.6 与 `docs/V4_DATA_MODEL.md` §5.1 为准；**本文件不复制清单**。
- 所有集合对客户端读写全拒；云函数用 admin 权限并按 openid 过滤（CONTRACT §11.3）。
- 变更数据库结构前先导出 JSON 备份；手工改数据仅限故障处置，且必须：记录时间/操作人/原因/前后值，并在 `admin_audit` 留痕。
- `admin.bootstrap` 是自检手段，不替代控制台建索引；返回缺失项时由部署者补齐后复跑。

## 7. 云存储要点

- 私有存储；截图与头像都经服务端票据签发路径；`wx.cloud.uploadFile` 只允许出现在 `api/upload.js`。
- 展示用临时 URL（5 分钟）且不缓存、不落本地存储；后台不提供截图直链、后台 DTO 不含头像 fileID。
- 清理：`cleanup.files`/`cleanup.tickets` 按引用计数与过期时间清理（含无主头像文件）；删除账号/测试账号时立即删头像文件。
- 上传失败排查顺序：存储权限 → 票据是否过期 → 路径是否与票据一致 → 文件大小/类型是否超限。

## 8. 运行时配置（`config` 集合，无费用项）

| 键 | 默认/范围 | 谁能改 |
| :-- | :-- | :-- |
| `viewTicketTtlMinutes` | 30（5~60） | admin.updateConfig |
| `avatarMaxBytes` | 204800（100KB~500KB） | admin.updateConfig |
| `testAccountMaxPerRole` | 3（每开发者合计 ≤6） | admin.updateConfig |
| `testDataRetentionDays` | 30 | admin.updateConfig |
| `recognitionFailureRetentionDays` | 30（7~30） | admin.updateConfig |
| `orderTimeoutMinutes` / `autoCompleteHours` / `screenshotRetentionDays` | 120 / 24 / 7 | admin.updateConfig |
| `zoneLabels` / `serviceCatalog` / `announcement` / `maintenance` | 五苑展示名 / 五类服务 / 公告 / 维护开关 | admin.updateConfig |
| `privacyVersion` | 随《隐私保护指引》定稿回填 | admin.updateConfig |
| `aiFallback` | `{enabled:false, timeoutMs:8000, maxPerUserPerDay:5, ...}` | **后台只读**；改值走部署配置脚本/控制台，并与隐私文本同步 |

- 客户端只经 `config.getPublic` 取公开子集；缓存 TTL 5 分钟 + onShow 刷新（ENGINEERING §3.6）。
- 改任何配置必须：`admin_audit{CONFIG_UPDATE}` 可查、`CHANGELOG`/`STATE` 记录、涉及隐私承诺时同步 `docs/privacy/`。

## 9. 冒烟清单（每次部署）

| # | 冒烟项 | 期望 | 执行人 | 证据 |
| :-- | :-- | :-- | :-- | :-- |
| 1 | `health.check` / `admin.bootstrap` | ok；集合/索引/config 校验通过；重复调用一致 | Lead/用户 | 返回原文 |
| 2 | `config.getPublic` | 字段齐全、`privacyVersion` 非空；无费用字段 | Lead | 返回原文 |
| 3 | `user.bootstrap` | 返回 `isDeveloper`；不返回身份标识；`viewContext` 为空或恢复自服务端 | Lead | 返回原文 |
| 4 | 真实账号 READONLY | 读白名单内读成功；任意写 `FORBIDDEN`；黄条渲染 | 用户 | 录屏 |
| 5 | 测试账号 TEST_WRITE | 目标为测试账号才签发；业务写成功、禁用动作 `FORBIDDEN`；蓝条 + `TEST` 角标 | 用户 | 录屏 |
| 6 | 测试数据隔离 | 统计/红点/邀请码/后台列表不计测试数据 | Lead/用户 | 截图 |
| 7 | 头像链路 | 上传 → 保存 → 展示；替换后旧文件已删；失败不落 fileID；≤上限 | 用户 | 录屏 |
| 8 | 删除测试账号 | `dryRun` 先看计数 → 二次确认 → 级联删；审计含前后条数 | 用户 | 截图 |
| 9 | `cleanup` | 触发器到点执行，日志 `scanned/acted/failed` 正常；重跑幂等 | Lead | 日志 |
| 10 | AI 兜底降级 | `aiFallback.enabled=false` 或 Key 为空时零外呼、返回 `recognized=false` 且失败入队 | Lead | 返回 + 队列截图 |
| 11 | 复核页 | 原图临时 URL 5 分钟、每次访问有审计；补录/忽略写审计 | 用户 | 后台截图 |

## 10. 回滚预案

1. **云函数回滚**：控制台 → 云函数 → `api`/`cleanup` → 版本与配置 → 回滚到上一版本（或重传上一提交）。
2. **数据库**：结构变更前先导出 JSON 备份；`cleanup.*` 只做可重跑操作；回滚后按 §9 复跑冒烟。
3. **客户端**：问题版本重新提交上一版本（审核延迟属已知成本）；API 只增不删、字段只加不改语义（ENGINEERING §10.4）。
4. **AI 事故先降级后回滚**：先关 `config.aiFallback.enabled`（或清空 `DEEPSEEK_API_KEY`）→ 静默降级且失败仍入队 → 再判断是否回滚云函数版本。
5. **测试数据事故先清不先删库**：`admin.purgeTestData`（`dryRun` → `confirm`）清测试业务数据、保留账号与真实数据；核对审计前后条数。
6. **回滚记录**：回滚原因/版本/时间写 `CHANGELOG` 与 `STATE`，并保留冒烟输出。

## 11. 故障排查

| 现象 | 优先检查 | 处置 |
| :-- | :-- | :-- |
| 启动提示"云环境未配置" | `config/env.js` 是否仍是未填写状态 | 填入真实 envId 后重编译 |
| 启动"云开发初始化失败" | 基础库版本、当前环境、网络 | 更新基础库/切换环境后重试；仍失败看工具 console |
| `admin.*` 全部 `FORBIDDEN` | `ADMIN_OPENIDS` 是否缺失/JSON 非法/当前 openid 不在映射 | 控制台改正后重试，重跑 `admin.bootstrap` 冒烟 |
| 建单/绑定报唯一冲突或索引缺失 | 唯一索引是否建齐、存量冲突 | 按 `admin.bootstrap` 提示补齐索引；清场后重建 |
| 上传失败 | 存储权限、票据过期、路径不一致、大小/类型超限 | 按 §7 顺序排查；重新 `upload.prepare` 换票 |
| 定时任务未执行 | 触发器是否启用、函数版本、执行日志 | 手工触发一次看日志，再修复触发器 |
| `VIEW_TICKET_EXPIRED` / `NOT_FOUND` | 会话过期、目标被删、模式/目标被篡改 | 重新开启会话；客户端按约定清会话上下文并回后台 |
| 头像不更新 | 旧 fileID 缓存、保存是否真的写库、替换是否删旧 | `onShow` 重拉；核对保存返回的 `avatarFileId`；异常文件交 `cleanup.files` |
| AI 兜底无结果 | 开关关闭、Key 为空、配额/熔断 | 属预期降级：手填可继续；看云函数日志错误码（不落全文/Key） |
| 页面白屏/样式异常 | 页面四件套、`app.json` 登记、基础库 | 按 `check.js`/真机 console 定位；不以模拟器为准 |

- 排查纪律：用 `requestId` 关联日志；**工单/日志不贴敏感值**（取件码、尾号、宿舍、头像/昵称、身份标识全值、Key）。

## 12. 安全与权限纪律（操作层）

1. 真实值只存在控制台：开发者白名单、第三方 Key、真实 openid 永不进仓库/文档/截图明文；证据截图必须打码。
2. 环境隔离：dev 联调、prod 只发布；不在 prod 造测试数据；控制台操作使用开发者本人微信，留操作痕迹。
3. 最小权限：云开发管理员只授予项目负责人；开发者白名单变更后立即跑 `admin.bootstrap` 冒烟。
4. 数据库手工改仅限故障处置，且记录原因/时间/前后值并落审计。
5. 上传/下载敏感文件（截图、复核原图）只在受控页面，不导出、不批量、不转发。

## 13. 证据与记录（当前执行状态）

| 项 | 期望证据 | 当前状态 |
| :-- | :-- | :-- |
| 云环境创建（dev/prod） | 环境页截图 + envId 填入 `config/env.js` | 未执行（D1 待用户） |
| 集合/索引/安全规则 | 集合列表截图 + 索引导出 + 规则截图 | 未执行 |
| 环境变量 | 键名可见、值打码的截图 | 未执行 |
| 定时触发器 | 触发管理截图 + 首次执行日志 | 未执行 |
| 云存储权限 | 权限页截图 + 真机上传记录 | 未执行（E5 待实测） |
| 云函数部署与冒烟 | 部署成功截图 + `health.check`/`admin.bootstrap` 返回原文 | 未执行（批 1 收口时） |
| 账号切换/测试账号/头像 | 用户录屏 + 审计查询截图 | 未执行（批 2 起） |
| 真机点检 | `docs/QA_CHECKLIST.md` 勾选 + 录屏/截图 | 未执行（用户执行） |

> 本表随执行逐项更新；证据截图存档在项目负责人本地，仓库只记录**结论与日期**，不写真实 envId/openid/Key。

## 14. 待实测与开放项

| 项 | 内容 | 批次 | 来源 |
| :-- | :-- | :-- | :-- |
| E5 | 云存储安全规则可选项 + 三分包是否改独立分包 | 批 1 / 批 9 | ENGINEERING §13 |
| E12 | 头像/昵称隐私接口与基础库能力、真机压缩 | 批 2 | ENGINEERING §13 |
| R2 | 私有存储"仅创建者可写" + 上传链路 | 批 1 / 批 4 | ENGINEERING §12 |
| R3 | VisionKit 真机识别形态 | 批 4 | ENGINEERING §12 |
| R6 | 订阅消息模板审批（P1） | 批 9 | ENGINEERING §12 |
| R13 | 云开发配额/成本估算与告警 | 批 9 | ENGINEERING §12 |
| E11 | DeepSeek 账号/条款/合规确认 | 批 4 前 | ENGINEERING §13 |

## 15. 禁区（agent 不可委托）

- 发布、提审、打 tag、删库、改云开发控制台、配置环境变量/触发器/索引、导出真实数据。
- 在真实环境执行单测/批量造数；把真实用户数据写入本地或日志。
- 关闭或弱化门禁后上线；在仓库记录任何真实凭证或身份标识。
