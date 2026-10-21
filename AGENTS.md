# AGENTS.md · v4 仓库级 agent 纪律

> 适用范围：所有在 `D:\Code\expressage_college_v4` 工作的 agent（含并行分身）。
> 修读顺序：`docs/V4_CONTRACT.md`（唯一口径）→ 本文（纪律）→ `docs/ARCHITECTURE.md`（写作用域与冻结接口）→ `docs/V4_ENGINEERING.md`（工程/门禁/部署）。
> 冲突处理：任何文档与 CONTRACT 冲突，以 CONTRACT 为准；**先停手回报 Lead，不得自行改口径**。

## 1. 口径优先级与不可发明

1. 口径唯一源 = `docs/V4_CONTRACT.md`；工程规则源 = `docs/V4_ENGINEERING.md`；代码接口冻结源 = `docs/ARCHITECTURE.md`。
2. 不新增用户需求、不扩展产品范围；超出 SPEC §0 的想法只能进 "P1/P2/不做" 清单并说明理由（CONTRACT §14 第 6 条）。
3. 需要裁决的事项必须显式标 `[D#]`（D1~D21）或 `[E#]`（工程缺口 E1~E12），不许藏在正文里。
4. 文档只写设计与验收，不写实现代码；可给文件树/判据表/伪代码（CONTRACT §14 第 1 条）。

## 2. 分层铁律（引用，不复述）

- 允许依赖方向与各层职责以 `docs/ARCHITECTURE.md` §1、§2.2、§3、§4 为准。
- 三条硬禁止：①页面层零业务判据（不出现 `wx.cloud.*`、状态字符串字面量、编号/roomTag 生成或 `random`）；②客户端不得直连数据库/存储；③云函数不出现 `db.collection`（只经 `db/dao.js`）。
- 共享副本（`cloudfunctions/*/shared/**`）**只由 `node tools/sync-cloud-shared.js` 生成**，任何人不得手写。

## 3. 写作用域与协作

1. **单写者原则**：写作用域以 `docs/ARCHITECTURE.md` §2 的 S0~S10 表为唯一来源；本文件不复述该表。新增文件必须落在自己的作用域内。
2. 跨域只读：可以 `require`/读取他人文件，但**不得修改**；需要改动公共冻结文件（`app.json`、`app.wxss`、`shared/**`、`api/**`、`store/**`）先发 Lead，由单写者合并。
3. 并行写冲突先停手：发现同文件被他人改动/门禁范围重叠，立即回报 Lead，不覆盖、不 `git checkout` 他人改动。
4. **任何 agent 不得执行 `git commit` / `git tag` / 发布 / 提审 / 删库 / 改云控制台配置**；提交、回读 HEAD、跑 `gate.ps1` 由 Lead 统一做（V4_ENGINEERING §8.5）。
5. 不修改 `.gitignore`、`.tool-versions`、`.gitattributes`、`project.private.config.json` 等根配置（Lead 域）；不删除他人文件（即使看起来是残留）。

## 4. 编码与文件纪律

1. 编码：全部 UTF-8 **无 BOM**、**纯 LF**、文件结尾单换行（`.gitattributes` 已钉 `* text eol=lf`）；`*.ps1` 例外——必须带 UTF-8 BOM（门禁 #7/#8 两向）。
2. 行数：源码单文件 ≤500 行、测试文件 ≤1000 行、单函数 ≤50 行（全文本口径，门禁 #18）。
3. 不写未完成占位（英文待办缩写、"以后再补"类措辞、单字占位符）；待定事项用 `[D#]`/`[E#]`/`[R#]`/`P1` 显式编号。
4. 不引入第三方前端依赖；云函数依赖只允许 `wx-server-sdk`；客户端零密钥、零外呼（门禁 #16/#24）。
5. **禁止任何费用/交易语义**（用户硬口径，D5/D6）：具体词表与白名单以 `docs/V4_ENGINEERING.md` §7.6 与 `tools/zero-money-scan.js` 为唯一单源，本文不复述；服务类型只表达"做什么"，不表达任何代价。
6. 文案纪律：失败提示说真话并给下一步；不向用户暴露错误码英文、堆栈、L3 敏感值。
7. 数字不写死：测试条数、性能数字、配额一律给"取数命令"或以控制台/门禁真实输出为准（CONTRACT §14 第 4 条）。
8. 不把真实凭证写进任何仓库文件：开发者白名单只存云函数环境变量；`DEEPSEEK_API_KEY` 只存 `api` 云函数环境变量；仓库只出现键名。

## 5. 测试与完成定义（DoD）

1. 完成定义 = `powershell -File check.ps1` 退出码 0 **且**粘贴真实输出；没有汇总输出 = 读数作废（ENGINEERING §8.1/#22 纪律）。分域自检至少 `node --check <file>.js`；页面四件套齐全。
2. 纯逻辑进 `utils/`/`shared/` 并写进 `tools/selftest-*.js`；云函数业务进 handler 单测（注入 fake DB）；**不 mock 全局 `wx`**（ENGINEERING §6.3 ADR），唯一允许的桩是 `api/client.js` 的 transport 注入点。
3. 判据必须有牙：先合法基线、再只有该闸能挡的反例；不许空集全绿；期望值不抄现状（改判据必须同步改断言并记 CHANGELOG）。安全面改动按 ENGINEERING §7.5 跑变异电池，判绿即"判据没牙"，当场补断言并留首红证据。
4. 新增导出必须有生产调用，或先登记 `docs/TECH_DEBT.md`（编号 TD-###）。
5. **真机项只能用户点检**：`docs/QA_CHECKLIST.md` 里"人（真机）"条目、账号切换/测试账号/头像/隐私弹窗/性能等，agent 不得代勾、不得代宣布通过。
6. 不真实外呼第三方、不连真实云环境/真库做单测；AI 外呼一律注入 `fetch` 替身。

## 6. 提交、版本与回写

1. git 身份：`lead <lead@local>`（批 1 已显式配置；`doctor.ps1`/`gate.ps1` 前置检查 `git var GIT_AUTHOR_IDENT`）。
2. 提交信息格式、锚点取法、收工顺序以 `docs/V4_ENGINEERING.md` §8.4/§8.5 为准（本文不复述证据串模板）；提交信息必须匹配 `^(feat|fix|docs|test|chore)\(v4\):`。
3. 不提交 `project.private.config.json`；不 `git tag`；不改写历史；并行写不共享同一工作树（需要时由 Lead 排期）。
4. 回写义务：改动类型 → 必须同步的文档/代码，按 `docs/V4_ENGINEERING.md` §8.6 执行；版本演进写 `CHANGELOG.md`，状态变更写 `STATE.md`（唯一状态源），欠账写 `docs/TECH_DEBT.md`，踩坑写 `docs/lessons/`（≤12 行/卡，先查重）。

## 7. 禁止清单（不可委托/不可绕过）

- 发布、提审、打 tag、删库、改云开发控制台、配置环境变量/触发器/索引 —— 只能用户执行；agent 只给操作步骤与证据要求（`docs/RUNBOOK.md`）。
- 关闭、弱化、跳过任何门禁判据；给零金额扫描加"整文件/整目录"白名单；把测试条数写死。
- 读取/写入 v1/v2/v3 的本机存储键；把切换会话票据、视角上下文、L3 敏感值写进本地存储或 URL（ENGINEERING §5.6/#15）。
- 采集/上传与任务无关的用户数据；把截图、头像、昵称发到通知/分享卡片/日志/后台列表。
- 在客户端出现任何第三方服务密钥或直连外呼。

## 8. 交付与回报格式

1. 回给 Lead：**文件清单 + 每个文件行数 + 已跑命令与真实输出 + 未决问题/风险 + 是否有跨域改动需求**（ARCHITECTURE §5 第 7 条）。
2. 只报真实输出，不报"应该没问题"；红灯如实报，附失败项与位置。
3. 超时/被阻塞先报告具体条件（缺哪个裁决、哪个文件被占、哪个环境不可用），不静默等待。

## 9. 与本文相关的回写触发器

| 触发 | 动作 |
| :-- | :-- |
| 新增/调整写作用域或冻结接口 | 先改 `docs/ARCHITECTURE.md`，再动代码 |
| 口径变更（角色/字段/编号/隐私/错误码） | 先改 `docs/V4_CONTRACT.md`，再按 §8.6 回写全部引用 |
| 工程结构/门禁/部署变化 | 改 `docs/V4_ENGINEERING.md` + 本文相关条目 |
| 发现欠账/风险 | 登记 `docs/TECH_DEBT.md` 或 `STATE.md` 风险节 |
