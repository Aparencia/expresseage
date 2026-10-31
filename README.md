# expressage_college_v4 · 校园快递代取（v4）

> **当前阶段：工程侧收口（2026-10-31 文档结构重整；上一功能批次 2026-10-30 隐私同意兜底）**——四步门禁可自证（见下）；**待用户执行**：真机点检、隐私 13 项填写与微信后台声明、审核提审、灰度与回滚演练。
> 权威入口：**口径** = [`docs/contract/V4_CONTRACT.md`](docs/contract/V4_CONTRACT.md) · **状态** = [`STATE.md`](STATE.md) · **文档总览** = [`docs/README.md`](docs/README.md) · **工程规则** = [`docs/engineering/V4_ENGINEERING.md`](docs/engineering/V4_ENGINEERING.md)。

## 这一版是什么

v4 把 v3 的「兼职单人台账」升级为 **顾客下单 + 兼职接单履约 + 开发者治理** 的小程序，只负责下单、接单与取件信息整理：

- **顾客**：微信登录 → 隐私同意 → 采集微信头像/昵称 → 完善宿舍身份（五苑 + 楼栋 + 宿舍号 + 可选手机尾号，服务端分配同寝室大写标识）→ 获得顾客编号 → 主动绑定兼职（凭兼职编号）→ 上传取件码截图下单（识别失败走服务端 AI 兜底，可手填）→ 跟踪订单进度。
- **兼职**：凭开发者发放的邀请码开通 → 采集头像/昵称 → 获得兼职编号 → 按驿站站点聚合的取件清单（接单/取件/送达/异常处理/批量/撤销）→ 客户档案与代客下单 → 单量统计与日报；只能看到绑定自己的顾客与订单。
- **开发者**：邀请码生效控制、脱敏数据查看、兼职停启用、异常介入、全局配置、识别失败复核（原图+补录/忽略）、只读切换真实账号视角、测试账号可写验收、全程审计。

**零金额口径**：程序内不承载任何交易环节——不做交易、收付、账目、计价类功能；服务类型只表达「做什么」，不表达任何代价（CONTRACT §0/§6，D5/D6）。

**本期不做**：任何交易/账目类功能与字段；地图路线规划；自动派单/抢单市场；多校区；评分评价（P2）；快递公司接口/电子面单；真实账号可写视角；应用内切换微信登录账号；真实账号与测试账号互绑；客户端直连第三方 AI 或原图直传第三方；v3 历史数据迁移（D11）。

## 文档入口

完整文档地图、逐份摘要、按角色阅读路径、代码结构对照与归档索引见 **[`docs/README.md`](docs/README.md)**。

| 你要找 | 去哪 |
| :-- | :-- |
| 唯一口径 / 裁决 | `docs/contract/V4_CONTRACT.md` §13 · `docs/contract/V4_DECISIONS.md` |
| 字段与接口契约 | `docs/data/V4_DATA_MODEL.md` §2/§7 |
| 代码分层与冻结接口 | `docs/engineering/V4_ARCHITECTURE.md` §1~§4 |
| 门禁、测试与部署 | `docs/engineering/V4_ENGINEERING.md` §7~§10 · `docs/delivery/V4_RUNBOOK.md` |
| 三端交互规格 | `docs/ux/V4_UX_CUSTOMER.md` · `V4_UX_PARTNER.md` · `V4_UX_DEVELOPER.md` |
| 真机点检清单 | `docs/delivery/V4_QA_CHECKLIST.md`（人执行，agent 不代勾） |
| 提审材料 | `docs/delivery/V4_REVIEW_MATERIALS.md` · `docs/privacy/` |
| 当前状态 / 待办 / 欠账 | `STATE.md` · `docs/governance/V4_TECH_DEBT.md` · `docs/governance/lessons/` |
| 变更历史 / 历史归档 | `CHANGELOG.md` · `docs/archive/` |
| agent 纪律 | `AGENTS.md` |

## 快速自证

```powershell
# 在仓库根目录执行；唯一「完成」定义 = 退出码 0 + 真实输出
powershell -File check.ps1      # 四步：check.js → check-docs → 零金额扫描 → selftest

# 分步
node tools/check.js
node tools/check-docs.js
node tools/zero-money-scan.js
node tools/selftest.js
```

> 数字不写死：页面数/动作数/集合数/断言数以命令实时输出为准（索引见 `docs/README.md` §7）。
> 真机项、云控制台配置、部署、提审、打 tag、删库只能由用户执行；agent 只给步骤与证据要求。

## 与 v1~v3 的关系

- v1/v2/v3 只读参照，v4 不读取、不写入它们的本机存储键；沿用 v3 appid（D2），发布 v4 即替代 v3。
- v3 数据不迁移（D11），v4 空库起；云开发采用**单环境**（D1 修订：账号只能开 1 个环境），隔离靠测试账号/测试数据标记与上线前清零（`docs/delivery/V4_RUNBOOK.md` §10）。
- 复用 v3 的纯逻辑资产（识别/取件码解析/站点/楼栋），丢弃本机单键存储、无账号模型与任何交易相关实现。
- 新增双角色唯一编号、开发者账号与账号切换、头像/昵称、识别失败兜底与复核、测试账号、消息中心与注销清理。

> 隐私承诺变更：v3 为「数据只存本机」；v4 面向客户必须云端存账号，并新增开发者治理访问、头像/昵称采集与展示、第三方 AI 文本处理与失败原图复核。上线前必须先定稿隐私指引与用户协议（`docs/privacy/`），文本与代码不一致视为假承诺。
