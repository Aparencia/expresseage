# STATE.md · v4 项目当前状态（唯一状态源）

> 口径版本：与 `docs/V4_CONTRACT.md` v0.9 同步。
> 维护人：lead（其他 agent 只回报状态变化，不直接改本文件；批 1 收口前由 Lead 统一更新）。
> 更新时机：每批开工/收口、用户裁决变化、风险新增或关闭、HEAD 变化需回读。
> 本文只记**状态、待办与下一步**，不重复设计口径（口径看 CONTRACT，工程规则看 ENGINEERING，接口看 ARCHITECTURE）。

**快照时间：2026-10-21（批 1 进行中）**

## 1. 一句话状态

**批 0 设计定稿完成；批 1 工程骨架与云端基础设施进行中（多 agent 并行，尚未收口）；批 2 未开工。**
用户侧开工门未闭环：D1/D2/D3/D13 待用户确认，D8 五苑正式展示名待用户给出；云环境尚未创建、云函数尚未部署、门禁尚未由 Lead 统一跑。

## 2. 批次台账

| 批 | 名称 | 状态 | 说明/证据 |
| :-- | :-- | :-- | :-- |
| 批 0 | 设计定稿与开工门 | **设计定稿完成（2026-10-21）** | CONTRACT v0.9、DATA_MODEL、三份 UX、ENGINEERING、DECISIONS、QA_CHECKLIST、ARCHITECTURE、`docs/privacy/` 两件均落盘；D18~D21 四次修订已回写；**用户侧开工门（D1/D2/D3/D13）未闭环** |
| 批 1 | 工程骨架与云端基础设施 | **进行中（2026-10-21 开工）** | 开工提交 `d5ad214`（app.json 页面地图冻结 / ARCHITECTURE 接口冻结 / 根配置改造）；S0~S10 并行写，见 §3；云端资源、部署与门禁待收口 |
| 批 2~批 9 | 见 `docs/V4_ENGINEERING.md` §11 | 未开工 | 范围、依赖与风险以 ENGINEERING §11 为准；批 2 依赖批 1 收口 + E12 真机能力确认 |

## 3. 批 1 并行进度快照（2026-10-21）

> 写作用域以 `docs/ARCHITECTURE.md` §2 为准；收口顺序与每批纪律看 ENGINEERING §10.3/§11。状态随收口更新，冲突以 Lead 裁定为准。

| 工作流 | 交付摘要 | 状态 |
| :-- | :-- | :-- |
| S0 骨架与集成 | 根配置/app.json/app.js/app.wxss、config、api/client、api/upload、api/privacy、api/modules、store、pages/launch、pages/profile | 进行中 |
| S1 口径纯件 | `shared/**`（集合/错误码/action/审计/状态机/校验/config 默认）、`utils/ids.js`、`utils/room-tag.js` | 进行中 |
| S1b 云端身份域 | `cloudfunctions/api/handlers/{user,customer,partner,bind,upload,config}` | 进行中 |
| S2 工具链与门禁 | `tools/**`（check/check-docs/zero-money/selftest/fake-db/sync/seed）、`check.ps1`/`gate.ps1`/`doctor.ps1` | 进行中 |
| S3 顾客端页面 | `pages/role|home|orders|customers`、`pkg-customer/**`、`utils/recognize/**`、`utils/ocr/**` | 进行中 |
| S4 兼职端页面 | `pages/partner/**`、`pkg-partner/**`、`utils/customer-view.js`、`utils/order-edit.js` | 进行中 |
| S5 开发者后台页 | `pkg-admin/**` 11 页（含 `account-switch`、`recognition-review`） | 进行中 |
| **S6 文档与隐私件** | `AGENTS.md`/`STATE.md`/`CHANGELOG.md`/`docs/RUNBOOK.md`/`docs/V4_FIXTURES.md`/`docs/TECH_DEBT.md`；`utils/storage.js`/`privacy-policy.js`/`avatar.js` | **已交付（2026-10-21），待 Lead 收口验证** |
| S7 云核心 | `cloudfunctions/api` 入口/路由/中间件/db/lib/health；`cloudfunctions/cleanup` 入口 | 进行中 |
| S8 云订单与兜底 | 订单动作 handler、`lib/ai/**`、cleanup sweeps | 进行中 |
| S9 云后台 | `handlers/admin/**`（邀请码/脱敏查看/配置/统计/切换会话/测试账号/复核） | 进行中 |
| S10 组件与资产 | `components/**`、`custom-tab-bar/**`、`assets/**` | 进行中 |

## 4. 用户待办（阻塞项）

| # | 事项 | 阻塞什么 | 来源 | 状态 |
| :-- | :-- | :-- | :-- | :-- |
| 1 | **D1** 开通云开发 + 创建 dev/prod 两个环境（envId 交 Lead 填 `config/env.js`） | 云资源、部署、批 1 收口 | ENGINEERING §6.1 #2、§10.2 | 未完成 |
| 2 | **D2** 确认 appid `wxf98c87a293092ef5` 主体可用 | 批 1 开工门 | ENGINEERING §6.1 #1 | 未完成 |
| 3 | **D3** 兼职准入用邀请码（推荐方案待回复） | 批 2 激活流程、邀请码设计锁定 | CONTRACT §13 | 未确认 |
| 4 | **D13** 主体/类目确认（快递/跑腿类目资质） | 批 9 提审 | ENGINEERING §6.1 #3 | 未完成 |
| 5 | **D8** 五苑正式展示名与 C 的含义 | 配置 `zoneLabels` 与全部展示文案（不阻塞编码） | CONTRACT §13 D8 | 待用户给名称 |
| 6 | 配置 `ADMIN_OPENIDS`（JSON 映射，含 `DEV-01`） | `admin.*`、切换会话/测试账号冒烟 | ENGINEERING §6.1 #4 | 未完成 |
| 7 | 云存储权限设置（私有、上传可用） | 截图/头像上传链路 | ENGINEERING §6.1 #5、§3.5 | 未完成 |
| 8 | 14 集合 + 安全规则 + 全部索引（控制台建） | 批 1 云资源验收 | ENGINEERING §4.6、§10.2 | 未完成 |
| 9 | `DEEPSEEK_API_KEY` 与 E11（DeepSeek 账号/条款/配额确认） | AI 兜底上线；未确认前保持关闭 | ENGINEERING §6.1 #9、§13 E11 | 未确认 |
| 10 | **E12** 头像/昵称隐私接口与基础库能力真机实测 | 批 2 头像/昵称采集验收 | ENGINEERING §6.1 #10、§13 E12 | 未做 |
| 11 | 《用户隐私保护指引》微信后台逐项声明（含头像/昵称/第三方 AI） | 批 9 提审 | ENGINEERING §6.1 #6、§10.4 | 未做 |

## 5. 待真机 / 待实测项（agent 不能代验）

| 项 | 内容 | 取证批次 | 来源 | 状态 |
| :-- | :-- | :-- | :-- | :-- |
| E5 | 云存储安全规则可选项 + 三分包是否改独立分包 | 批 1 / 批 9 | ENGINEERING §13 | 待实测 |
| R2 | `wx.cloud.uploadFile` + 私有存储"仅创建者可写"真机链路 | 批 1 / 批 4 | ENGINEERING §12 | 待实测 |
| R3 | VisionKit 在目标机型真实吐字（识别形态闸依据） | 批 4 | ENGINEERING §12 | 待用户真机取证 |
| E12 | `chooseAvatar` / `nickname` 输入 / 隐私弹窗 / 真机压缩到上限内 | 批 2 | ENGINEERING §13 | 待实测 |
| R6 | 订阅消息模板审批（P1） | 批 9 | ENGINEERING §12 | 未申请 |
| R9 | 校园运营/校方/驿站要求（线下确认） | 批 9 | ENGINEERING §12 | 待用户确认 |
| R13 | 云开发配额/成本按真实单量估算 | 批 9 | ENGINEERING §12 | 未估算 |
| R12 | `docs/QA_CHECKLIST.md` 全部"人（真机）"条目 | 每批 | ENGINEERING §12、QA_CHECKLIST | 待用户点检 |

## 6. 当前风险与红灯（如实记录）

1. **批 1 期间门禁红灯属正常**：多 agent 并行写入、文件未收口时 `check.js`/`check-docs.js`/`selftest*` 可能失败；**不收口不宣布完成**，以 Lead 收口时的真实输出为准（ENGINEERING §8.1）。
2. **云端一切未执行**：云环境、集合、索引、安全规则、环境变量、触发器、存储权限均未在真实控制台创建；任何"跑通/联调成功"的声明必须等 D1/D2 完成后按 `docs/RUNBOOK.md` 取证。
3. **AI 兜底处于关闭状态**：`config.aiFallback.enabled` 初始为 `false`，`DEEPSEEK_API_KEY` 未配置属预期降级；E11 未确认前不得开启正式外呼。
4. **隐私文本仍是草案**：`docs/privacy/` 两件为 v0.4 草案，批 9 提审前必须与真实采集一致并逐项声明。
5. **D8 未给正式苑名期间**：五苑展示名用配置默认值；改名只动 `config.zoneLabels`，不改代码（CONTRACT D8）。
6. **S6 交付的隐私/存储/头像纯件尚无生产调用方**：页面接入计划在批 2，欠账已登记 `docs/TECH_DEBT.md`。

## 7. 最近更新

| 日期 | 事件 |
| :-- | :-- |
| 2026-10-21 | 批 0 设计定稿（CONTRACT v0.9 及全部设计文档；D18~D21 四次修订回写；隐私两件升 v0.4 草案） |
| 2026-10-21 | 批 1 开工提交 `d5ad214`：app.json 页面地图冻结、ARCHITECTURE 接口冻结、根配置改造 |
| 2026-10-21 | 批 1 并行写：S1/S1b/S2/S3/S4/S5/S7/S8/S9/S10 进行中；S6 文档六件与三个纯件交付 |

## 8. 下一步（按序）

1. **Lead 收口批 1**：逐项跑 `node tools/check.js`、`node tools/check-docs.js --batch 1`、全部 `tools/selftest-*.js`、`node tools/zero-money-scan.js --scope all`；修红灯；提交后回读 HEAD、跑 `gate.ps1`；更新本文件与 CHANGELOG 的"未发布"节。
2. **用户闭环开工门**：D1/D2/D3/D13 + D8；创建云环境与 14 集合/索引/安全规则，配置 `ADMIN_OPENIDS`、存储权限（以及可选的 `DEEPSEEK_API_KEY`）；证据按 `docs/RUNBOOK.md` 采集。
3. **首次部署冒烟**：`node tools/sync-cloud-shared.js` → 部署 `api`/`cleanup` → `health.check`/`admin.bootstrap` → 配单条 10 分钟定时触发器 → 冒烟清单（RUNBOOK "首次部署"节）。
4. **批 2 开工门**：E12 真机能力确认 + 隐私文本同步 + 测试账号单机验收方案（单微信号）。

## 9. 维护规则

1. 本文件是**唯一状态源**；其他文档不写"当前进度"叙述，只写设计与验收。
2. 只有 Lead（或 Lead 明确指派者）更新本文件；其他 agent 发现状态变化时回报 Lead。
3. 与 `CHANGELOG.md` 同日条目保持一致；风险/欠账与 `docs/TECH_DEBT.md` 编号互链。
4. 数字不写死：进度以任务板与门禁真实输出为准，本文不抄测试条数。
