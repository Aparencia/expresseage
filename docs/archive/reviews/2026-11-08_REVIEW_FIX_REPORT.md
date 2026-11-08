# 2026-11-07/08 代码审查与修复报告（批 29/30/31 + 11-07 精简批）

> **性质**：独立代码审查记录 + 代修复证据（2026-11-08）。审查对象 = 2026-11-07 00:00 起的 12 个提交 + 工作树未提交的批 31（服务通知）。
> **口径源**：`docs/contract/V4_CONTRACT.md`（D1~D73）、`docs/engineering/V4_ENGINEERING.md`、`docs/engineering/V4_ARCHITECTURE.md`；真机项只能用户点检（AGENTS §5.5）。
> **纪律**：审查成员全程只读（未改文件、未 git 写、未真实外呼/连云）；修复实现由独立成员/Lead 在互不重叠写作用域内完成；门禁读数为 `powershell -File check.ps1` 真实输出（见 §5）。

## 1. 范围

| 类别 | 内容 |
| :-- | :-- |
| 11-07 提交 | `ad82879`（P1 死代码清理）、`5f9b5f8`（P3 shared 副本最小化）、`2138f43`（P2a format/refresh）、`2b626c0`（P2b list-flow）、`6bf60e6`（收口证据）、`fabc8bb`/`81ef0a5`（识别失败归因修正）、`8382b63`/`f98187d`（AI 401/403 归因 + 收口） |
| 11-08 提交 | `f06f33f`（批 29 D68/D69）、`451c225`（批 30 D70~D72）、`964938f`（批 30 补件：后台站点配置列表+浮层） |
| 工作树 | 批 31 服务通知（D73）全部未提交改动（29 M + 7 ??） |
| 方法 | 5 组独立只读审查（批 31 服务端 / 批 31 客户端 / 批 29/30 服务端与共享层 / 批 29/30 客户端 + 11-07 精简批回归 / 文档·门禁·治理）+ Lead 复核、汇总与修复实现 |

## 2. 结论

- **P0 = 1**：`AGENTS.md` 工作树改动误删「任何 agent 不得执行 `git commit` / `git tag`」禁令（留下双空格，与同文件 §6/§7、ENGINEERING §8.5、RUNBOOK §15 矛盾）→ **已恢复**。
- **P1 = 13**：全部修复或完成文档回写（下表）。
- **P2**：修复 8 项；未修 7 项登记 TD-092~098（见 §4）。
- 机器门禁全绿；真机项（QA §AH/§AI/§AJ）只能用户点检，agent 未代勾、未代宣布通过。

## 3. P0/P1 清单与处置

| # | 级别 | 位置 | 问题 | 处置 |
| :-- | :-- | :-- | :-- | :-- |
| 1 | P0 | `AGENTS.md:25` | 误删 `git commit` / `git tag` 禁令 | 恢复原文（双空格消除），与 ENGINEERING §8.5/RUNBOOK §15 一致 |
| 2 | P1 | `cloudfunctions/api/lib/subscribe-message.js` | 新订单模板 `thing24`=苑+楼栋+站点名，超平台 20 字时 `buildData` 返回 null → 整条通知静默不发且无日志（默认 P5 站点必现、P4 10 栋单必现） | `serviceAreaTextOf` 按 20 字预算裁剪（保苑+楼栋、截站点名）；skip 六路径补日志；`selftest-messages` +11（默认 8 站点×楼栋 1/5/10、P5 专条、钩子/重放/`touser`/停用） |
| 3 | P1 | `handlers/ai/_common.js`、`lib/ai/parse.js`、`parseParcel.js` | D70 双判据开关在服务端 AI 链路形同虚设（关开关后规则快照与 AI 输出仍按码反推站点） | 统一 `stationInferOf(config)` 门控 `fromImage`/`fromCode`；`selftest-ai` +10 负向断言 + 2 条透传接线断言 |
| 4 | P1 | `utils/recognize/index.js`、`pkg-customer/pages/order-create/parts/model.js` | 采纳 AI 建议时以码反推覆盖用户手选站点（违反 D70 被否项「手填优先，只补空」；`stationBy` 只写不读） | 入口先捕获手选态再改写来源；手选站点跳过码同步；`stationBy='code'` 例外保留码可更新；`withManualEdit` 手选写 `stationBy='manual'`；`selftest-order-flow` +5 反例 |
| 5 | P1 | `utils/customer-view.js`、`pages/partner/customers/**`、`pkg-partner/pages/{customer-detail,create-on-behalf}/**` | D68 服务端已下发 `status`，兼职端「已停用」标注/代客下单前置提示整体未消费（提交信息声称已交付） | 行 DTO 增 `status/statusText/isSuspended/...`（文案单源 `shared/enums.USER_STATUS_LABELS`）；列表/详情标状态并隐藏代客下单；代客下单选项禁选+本地拦；断言 +3/+12 |
| 6 | P1 | `pkg-partner/pages/create-on-behalf/parts/form-model.js` 等 | D71 兼职代客下单站点选择器恒用内置默认表（后台改名/调序不生效） | `stationOptionsOf(config)` 走 `stations.listStations({stations:config.stations})`；`createInitialState` 传 config；`recognize-model` 同源 |
| 7 | P1 | `utils/subscribe.js`、`pages/profile/parts/subscribe-row.js`、`pages/partner/workbench/parts/subscribe-wiring.js` | 授权结果未区分 accept/reject/ban/filter：用户拒绝仍提示「已开启」（假成功） | 增纯件 `statusesOf/acceptedOf/resultText`；两处按钮仅在 accept 时提示成功；拒绝/ban/filter 按真实原因提示；`selftest-message-pages` +13 纯件/接线断言 |
| 8 | P1 | `tools/selftest-messages.js` 等 | 批 31 判据只测纯件，方案 §7 要求的「`order.create` 钩子=1 / 代客单=0 / 重放=0 / `touser`」全缺（改坏接线不会首红） | 按方案补齐断言（见 #2），含变异电池首红 |
| 9 | P1 | `docs/delivery/V4_QA_CHECKLIST.md` | 无 D73 真机条目；附录 E 计数漂移（362，实际 374） | 新增 §AJ1~AJ6（授权/送达/新单/拒绝不阻断/20004/P0-3）+ 补 §AH/§AI 索引回填；计数 380 |
| 10 | P1 | `STATE.md`、`CHANGELOG.md` | 批 31 收口读数失真（message-pages 写 157，实际 164；后续测试补齐后 177）；批 30 补件证据未回填 | 按真实输出改写 §30/§31；§29 补 964938f 证据；CHANGELOG 同步 |
| 11 | P1 | `docs/contract/V4_CONTRACT.md` §9 | 仍写「P1：新订单/状态/异常提醒」，与 D73「只送达+新单、不做异常」冲突 | §2 D10 与 §9 改为 D73 收窄口径；UX_CUSTOMER §9.2 同批改 |
| 12 | P1 | `docs/privacy/*`、`CONTRACT §11.2` | D73 兼职新单提醒未回写隐私文本三处与 §11.2（研究稿明确要求） | 用户裁定补写 → 文本 v1.11（2026-11-08 用户确认）、三处同源、`privacyVersion` 保持 v4.0.0（不新增信息类型/第三方/保存期限）；`CONTRACT §11.2` 增 v1.11 披露段 |
| 13 | P1 | `pages/profile/**`、`utils/subscribe.js` | 「我的 → 微信提醒」状态行与 20004 去设置引导超出方案 §4/§6 范围且无任何文档 | 用户裁定**保留并补文档**：CONTRACT D73/UX_CUSTOMER/UX_PARTNER/QA/CHANGELOG/STATE 回写；调试 errCode 弹窗收紧为仅开发版 |
| 14 | P1 | `docs/engineering/V4_ARCHITECTURE.md`、`DECISIONS`、`TECH_DEBT` | 批 31 新增/改动文件未登记；D68/D69/D73 未进 DECISIONS；新欠账未登记 | ARCHITECTURE §2 增批 31 文件清单；DECISIONS 补 D68/D69/D73；TECH_DEBT 补 TD-092~098 |
| 15 | P1 | `docs/README.md`、`docs/archive/README.md` | 归档索引状态陈旧（「批 30 方案待开工」「进行中」「待裁决」）。注：T5 报告 12 项 P1，本文按根因合并为 13 类 | 按 D73 已收口/已实施且默认关闭改写 |
| 16 | P2 | `utils/recognize/text.js` | D72③「尾号」标签未进优先词表（多行截图可能取错尾号） | 优先词补「尾号」+ 3 条多行语料；`selftest-recognize` 305→308 |
| 17 | P2 | `pkg-admin/pages/config/parts/view-model.js` | 浮层即时校验放过「别名=本站正式名」「名称撞他行别名」，保存才被整表拒绝 | 与写层同判（名称跨站唯一、名称不得撞他行别名）+ 2 条反例 |
| 18 | P2 | `pkg-admin/common/constants.js` | AI 归因 `DISABLED` 缺 `failureCode==='LLM_ERROR'` 限定 → 低置信记录被误标「规则未认出」 | 按 `failureCode` 分流（LOW_CONFIDENCE→「可信度低（兜底未开启）」）+3 断言 |
| 19 | P2 | `pages/launch/index.js` | 已注销页文案略去「30 天内不可用」，承诺「退出后按新用户重进」在清理前不成立 | 文案补时限（行为不变）+ 静态断言 |
| 20 | P2 | `pkg-admin/pages/customer-detail/index.wxml` | 停用/恢复按钮 `loading` 写在 `<view>`（无效） | 改真 `<button loading disabled>` + 处理中文案；头注释更新 |
| 21 | P2 | `pages/partner/workbench/index.wxml` | 出厂 `enabled:false` 时「开启新单提醒」是死按钮 | 增 `subscribeEnabled` 数据键，未启用/缺 ID 时隐藏 |
| 22 | P2 | `pkg-customer/pages/order-create/parts/submit.js` | TEST_WRITE 会话仍请求授权 | 用 `modeGuard.isTestWrite()` 跳过；订阅关闭不再每次 warn；请求移入 try（15s 兜底防 submitting 卡死） |
| 23 | P2 | `project.config.json`、`docs/README.md` | 文件结尾换行丢失；README 归档行批号写「批 30 方案待 P0」 | 恢复结尾换行（键序按用户选择保留）；批号/状态改批 31 已收口 |

## 4. 未修项（已登记 TECH_DEBT）

| 编号 | 内容 | 处置 |
| :-- | :-- | :-- |
| TD-092 | 批量送达通知延迟叠加（每单事务后 await 1.5s 上限；批量=客户端逐单循环） | 开放；上线后按云日志 P99 评估再改 |
| TD-093 | 云函数 `config.json` 与 shared 闭包无机械门禁（权限写错只在部署后 -604101 暴露；`sync --check` 不在 check.ps1） | 开放；后续在 check.js #1/#17 增判据（须首红） |
| TD-094 | 站点写层不防「撞内置默认名/静态别名」与非数组入参 | 开放；后台 UI 正常操作不产生，P2 延后 |
| TD-095 | `admin.listCustomers` 默认路径每行两次读 users（D68 回归） | 开放；改 `_id in` 批量取 |
| TD-096 | 后台配置「变更清单」未按旧值→新值展示（UX_DEVELOPER §7.4 承诺） | 开放；实现或经用户裁决缩减措辞 |
| TD-097 | 取件码格式语义重叠不检测（多命中静默不猜） | 开放；契约未要求 |
| TD-098 | 订单 `stationName` 快照未用后台配置名（既有行为） | 开放；涉及快照口径先确认 CONTRACT |

## 5. 判据与真实证据

```text
$ powershell -File check.ps1
PASS  check.js 代码/配置门禁（39 条）
PASS  check-docs.js 设计文档门禁（--batch 1）
PASS  zero-money-scan.js 零金额扫描（源码+页面+文档）
PASS  selftest.js 全部断言 suite（EXPECTED_ASSERTIONS 闸）
selftest：运行 38 套；失败 0 套；SKIP 0 套（无）；完整性 0 项；非聚合辅助文件 4 件（已声明）
check.ps1：全部通过（4 步，退出码 0）
```

- 判据净增：`selftest-messages` 108→**140**、`selftest-message-pages` 149→**177**、`selftest-ai` 255→**272**、`selftest-order-flow` 277→**286**、`selftest-recognize` 295→**308**、`selftest-partner-customers` 129→**140**、`selftest-partner-pages` 347→**359**、`selftest-admin-pages` 246→**259**、`selftest-profile` 199→**200**、`selftest-privacy-text` 305→**311**；QA 条目 362→**380**。
- 变异电池（先红→原样恢复→复绿）：①关闭 `thing` 预算 → messages I2/I3 首红（P4/10 栋、P5 各栋）；②去 D70 `fromCode` 门控 → ai 4 条红；③去 `fromImage` 门控 → ai 3 条红；④去 `parse.normalizeAiFields` 两门控 → ai 3/2 条红；⑤去手选站点守卫 → order-flow 2 条红（P2→P3）；⑥原有 M1~M4（enabled/isTest/users.status/关闭仍下发 ID）保持首红。
- `node tools/sync-cloud-shared.js --check`：已一致 25 件，hash 对帐 OK（25 件次 / 2 套）。
- 审查成员自证：5 组成员均报告「审查前后 `git status` 一致、未改文件/未 git 写」；修复成员均未 git add/commit、未跑 check.ps1/gate（Lead 域）。

## 6. 真机/用户项（agent 不代勾）

- QA §AH1~AH5（D68/D69）、§AI1~AI7（D70~D72）、§AJ1~AJ6（D73 订阅消息；含模板类型=2 与 P0-3「总是保持」连续 3 条额度）。
- 订阅消息启用前置：用户重部署 `api`（含 `config.json` 权限，约 10 分钟生效）→ 控制台 `config/global` 置 `enabled=true` → 按 QA §AJ 点检；未确认前保持 `enabled:false`、不得宣布生效。
- 行数贴边提醒：`selftest-profile` 999/1000、`selftest-partner-pages` 950/950、`pkg-partner/.../form-model.js` 与 `pkg-admin/.../view-model.js` 499/500——下一批触碰前先拆件（门禁 #18 不放宽）。
