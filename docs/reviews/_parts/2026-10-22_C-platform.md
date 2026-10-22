> 本条由 AI 生成（代码审查）

# 审查 part C · 平台侧（阶段 3：测试、配置、脚本、文档同步、取代废弃、降标守卫）

- 审查员：review-platform（Team 审查子代理）
- 共享任务：task-8（revision 2，已 claim）
- 审查对象：`D:\Code\expressage_college_v4` HEAD 全量 v4 平台侧产物（工具的"金属性"、测试的"有牙/空转"、脚本/配置纪律、文档同步）
- HEAD_SHA：`9031d14cfc88b0cd8b03527da00ccc1f70a3e635`；BASE_SHA：空树 `4b825dc642cb6eb9a060e54bf8d69288fbee4904`
- 产物：本文件（唯一写操作）。
- 证据转义约定（遵守 Lead 2026-10-22 门禁补充纪律，本文件会被 `check-docs.js #7` / `zero-money-scan.js --scope docs` 扫描）：本文件不直接出现被扫描词表字面量；中文 5 词写作 `\u91d1\u989d`（金+额）、`\u4ef7\u683c`（价+格）、`\u8fd0\u8d39`（运+费）、`\u6536\u6b3e`（收+款）、`\u7ed3\u7b97`（结+算）；英文 4 词根与标识符后缀统一写作 `[EN-TERM]` / `[ID-SUFFIX]`。命令中的等价正则用 .NET `\uXXXX` 写法。"零金额"为固定术语，正常使用。**附录 A 的原始输出已按此约定做等价转义，未删改语义。**

## 0. 派单输入单

- `DESCRIPTION`：审查 C：平台侧（tools 门禁/测试/脚本/配置/文档同步/取代废弃/降标守卫）。
- `PLAN_OR_REQUIREMENTS`：`docs/reviews/_parts/_REVIEW_BRIEF.md`（执行手册）+ `docs/V4_CONTRACT.md`（唯一口径）+ `docs/V4_DATA_MODEL.md` + `docs/ARCHITECTURE.md`（冻结接口）+ `docs/V4_ENGINEERING.md`（工程/门禁唯一工程源，重点 §7.5/§7.6/§8.1~§8.4）+ `AGENTS.md`。
- `BASE_SHA` = `4b825dc642cb6eb9a060e54bf8d69288fbee4904`（空树，全量新增等价基线）；`HEAD_SHA` = `9031d14cfc88b0cd8b03527da00ccc1f70a3e635`。
- 基线读数（Lead 实跑，本文件引用）：node v24.21.0；`node tools/check.js` 31/31 PASS；`node tools/check-docs.js --batch 1` 10/10 PASS；`node tools/zero-money-scan.js` 0 命中。本轮**未运行** `check.ps1`/`gate.ps1`/`tools/selftest.js`（禁令）。
- 工作树附加事实：`git status --porcelain` 显示未跟踪 `docs/research/`、`docs/reviews/`（本轮审查新建，Lead 已知）。

## 1. 开工回执（九项）

### 1.1 人话复述与落点
本 part 只审"平台侧"：tools 门禁/测试/脚本是否真的能挡、配置与编码纪律是否守、四件文档与 HEAD 事实是否同步、全仓有无取代废弃残留在"未申报"状态、有无降标。产物 = 本文件；下一步 = Lead 聚合各 part 并裁决。

### 1.2 假设清单
1. 我假设 HEAD 全量新增即审查基线，不做逐提交增量审查；若错则"取代废弃只看新增行"的判法需改为逐提交 diff。
2. 我假设 `docs/reviews/_parts/_REVIEW_BRIEF.md` 为执行手册唯一来源；若 Lead 后续再修正 brief，本 part 的清单原文引用以本文写入时版本为准。
3. 我假设 STATE.md 无"并行态登记簿/起点锚点"是既定事实（见 1.4 命令），按 brief §3.4 直接判取代废弃；若错（登记簿在别处），并行实现判法需重做。
4. 我假设 Lead 授权的自查命令（`node tools/check-docs.js --batch 1`、`node tools/zero-money-scan.js --scope docs`）可在收尾时运行；若错，本文件未做门禁自查，需 Lead 代跑。

### 1.3 澄清问题
- `registry/APIS.md` 本仓不存在（ENGINEERING E7 已裁，registry 三件套不设）→ 错误码闸的"registry 侧"写 **N/A + 原因**，不静默跳过。
- 派单提到的 `selftest-mutation` 文件不存在 → 对应物是 `tools/mutation.ps1`（变异电池），已审并见 R-C-13。
- `STATE.md` 无并行态登记簿 → 取代废弃按卡直接判（见 §5 ④）。

### 1.4 锚点校验（命令 + 输出，空输出也贴）
```powershell
Select-String -Path STATE.md -Pattern '起点锚点'
# 输出：（空输出）
Select-String -Path STATE.md -Pattern '并行态|登记簿'
# 输出：（空输出）
```
结论：STATE.md 无「起点锚点」字段、无「并行态登记簿」；按 brief §0/§1 以 HEAD 全量新增为基线，取代废弃直接判（不追加用户澄清）。

### 1.5 diff 读取确认
- 全量新增基线；已读范围（行数为 `[System.IO.File]::ReadAllLines` 全文本口径）：
  `tools/check.js` 953、`tools/check-docs.js` 450、`tools/zero-money-scan.js` 328、`tools/zero-money-allowlist.json` 138（136 项结构化解析）、`tools/selftest.js` 243、`tools/fake-db.js` 413、`tools/seed-dev.js` 151、`tools/sync-cloud-shared.js` 182、`tools/mutation.ps1` 382、`tools/lib/project.js` 209、`tools/lib/fsutil.js` 196；`check.ps1` 50、`gate.ps1` 216、`doctor.ps1` 105；`project.config.json` 68、`.gitattributes`/`.tool-versions`/`.gitignore`/`.env.example`、`cloudfunctions/api/package.json`、`cloudfunctions/cleanup/package.json`；`shared/error-codes.js` 52、`shared/error-copy.js` 56（读全文）。
- 抽审 selftest：`selftest-core.js` 全读；`selftest-cloud.js`（结构+router/真实语义关键节）、`selftest-order.js`（H 静态节+结构）、`selftest-order-lifecycle.js`（分节清单+结构）、`selftest-admin.js`（头+结构）、`selftest-deletion.js`（头+结构）重点审；其余 22 套用 grep 结构统计（覆盖地图○见 §2.3）。
- 机械扫描覆盖：全仓 510 个 `.js/.json/.wxml/.wxss/.ps1`（排除 docs）取代废弃正则；tools 降标两命令；28 套 selftest 的 `EXPECTED_ASSERTIONS`/register/`.skip`/注释断言/trivial 断言/`installCrashGuard`；全仓（含 md）BOM/CRLF/末行换行/行数越线；全仓英文错误码残留；文档关键计数双向比对。
- **未覆盖且如实标 ○**：selftest 业务正确性（阶段 3 不审，只审有牙/空转）、`docs/` 正文质量（只审同步性）、v1/v2/v3 参照、`project.private.config.json`（本地私有）。

### 1.6 审查范围声明
只审派单的 C 范围及其直接关联调用（check/gate/doctor 与文档同步）。范围外发现只记录、不展开，交对应 part：见 §3 末"跨域线索"。

### 1.7 旧报告
旧报告清单 = **无**（`docs/reviews/` 本轮新建）→ 旧问题三态 N/A。

### 1.8 引用检查清单原文（brief §3，逐字抄录；词表字面量按上转义约定）
**七个固定维度**：1. 接入性与装配；2. 逻辑性；3. 牵连性；4. 性能；5. 冗余死代码；6. 开发规范；7. 安全。
**条件维**：⑧ UI 可访问性；⑨ 外部调用；⑩ 性能预算；⑪ 数据隐私。
**气味基线（≥6 行）**：长函数（超本仓行数上限 50/500/1000）；重复代码（同一段逻辑出现第 2 次）；参数过多（>4 个）；发散式变化（一个文件因多个不相关原因被改）；霰弹式修改（一个改动要动 >3 个文件）；命名不达意（读名字猜不出行为）。
**严重级**：P0 = 崩溃/数据丢失/安全漏洞；P1 = 核心功能不可用（含装配断链）→ 二者必须清零；P2 = 边缘功能报错/体验不佳；P3 = 拼写/样式/非关键提示；不确定按 P2。
**建议色矩阵**：🔴 红 = P0≥1 或 P1≥1 或取代废弃命中（登记簿缺行/废弃标记未申报）；🟡 黄 = P0=P1=0 且有 P2/P3；🟢 绿 = P0=P1=0 且旧报告 P0/P1 全部核销（本轮 N/A）。
**取代与废弃检查（命中即红灯）**：①并行实现未删（旧文件/旧函数/旧分支/旧常量 + `STATE.md` 无登记行；合法保留仅灰度/兼容契约/证据留存三种）；②新增行命中 `_old\b|_legacy|_v2\b|Deprecated|暂时保留|废弃|TO\x44O[:：]\s*(删|remove|delete)` → 必须写保留理由与删除条件，否则红灯。
**核销计数**：旧问题三态本轮 N/A；新发现每条须三件套（命令原文+退出码+命中行），缺 → 计入"依据未复现"栏，不进 P 级计数；去重按"文件:行 + 一句话事实"。

### 1.9 派单输入单
见 §0（DESCRIPTION / PLAN_OR_REQUIREMENTS / BASE_SHA / HEAD_SHA 已抄录）。

## 2. 覆盖地图与七维结论

### 2.1 覆盖地图（文件组 × 七维）

图例：✓ 已审；— N/A（附原因）；○ 未审（附原因）。

| 文件组 | 1 装配 | 2 逻辑 | 3 牵连 | 4 性能 | 5 冗余 | 6 规范 | 7 安全 |
| :-- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `tools/check.js`（953 行，31 条判据） | ✓（被 check.ps1 第 1 步装配） | ✓（逐条读实现，见 §3/附录 ⑤） | ✓（与 ENGINEERING §8.2 逐条对表） | —（开发期工具，非热路径；全仓 walk 见 2.2 #4） | ✓（#17 与 sync 脚本双实现=纵深防御，登记为通过项） | ✓（头部自述口径漂移见 R-C-06） | ✓（#24/#25/#28/#29/#30/#31 判据审查） |
| `tools/check-docs.js`（450 行，10 条判据） | ✓（check.ps1 第 2 步） | ✓（#5 图解析缺口见 R-C-14） | ✓（CONTRACT/DATA_MODEL 双向对帐） | —（同上） | ✓ | ✓ | —（文档判据，无运行时攻击面） |
| `tools/zero-money-scan.js` + `zero-money-allowlist.json` | ✓（check.ps1 第 3 步 + check #22/check-docs #7 复用） | ✓（词表/白名单匹配语义；失效项 R-C-09、退出码 R-C-10） | ✓（词表文档漂移 R-C-03） | —（`maxReadBytes` 8MB 上限见 2.2 #4） | ✓ | ✓ | — |
| `tools/selftest.js`（harness+聚合） | ✓（check.ps1 第 4 步聚合 28 套） | ✓（EXPECTED 精确闸；SKIP 语义 R-C-04） | ✓（28 套注册清单核对，28/28） | — | ✓ | ✓ | — |
| `tools/selftest-*.js` 28 套（+3 `-cases` +1 `-fixtures`） | ✓（28/28 注册） | 抽审 6 套 ✓；其余 22 套 ○（原因：阶段 3 只审"有牙/空转/断言数"，业务正确性不在本 part；抽审见 §2.3） | ✓（EXPECTED 合计 4,208 与 HEAD 提交声明一致） | — | — | ✓（结构统计见附录 ③） | 抽审覆盖负向/隔离套件（switch/testaccount/admin），未逐行审 ○ |
| `tools/fake-db.js`（413 行） | ✓（各云 handler 套件 require） | ✓（更新语义/photocopy `-502001`/事务/唯一冲突） | ✓（与 ENGINEERING §7.3 纪律对照） | — | ✓ | ✓ | —（测试替身，无生产路由） |
| `tools/seed-dev.js`（151 行） | ✓（RUNBOOK §3.5 引用） | ✓（dry-run 计划器；索引清单缺口 R-C-02） | ✓（与 DATA_MODEL/ENGINEERING/bootstrap 对表） | — | — | ✓ | ✓（不连真实云、不写库、`--apply` 守卫 exit 2） |
| `tools/sync-cloud-shared.js`（182 行） | ✓（AGENTS/ARCHITECTURE 规定唯一生成器；check #17 独立对帐） | ✓（`--check` 输出标签略误导，见通过项） | ✓（EXTRA_SOURCES 与 #17 扩围一致） | — | ✓ | ✓ | — |
| `tools/mutation.ps1`（382 行） | ✓（ENGINEERING §7.5 手工电池；未被脚本调用，属预期） | ✓（基线绿→注入→首红→字节还原→SHA256→复跑绿；弱断言 R-C-13） | ✓（CHANGELOG 有首红证据引用） | — | — | ✓（BOM/LF） | ✓ |
| `check.ps1`/`gate.ps1`/`doctor.ps1` | ✓（DoD 三件套） | ✓（gate 行数口径 R-C-01；check 4 步 vs 文档 9 步 R-C-05） | ✓（ENGINEERING §8.1/§8.4/§8.5 对照） | — | — | ✓（BOM/LF/编码实测通过，见 §4） | ✓（gate ⑤ lockfile/package.json、⑥ 体量） |
| 根配置 `.gitattributes/.tool-versions/.gitignore/.env.example/project.config.json` + 两云函数 `package.json` | ✓ | ✓ | ✓（加密键只出现键名；ignore 规则覆盖） | — | — | ✓（BOM/LF/JSON 可解析） | ✓（零凭证、零第三方依赖） |
| 文档同步：`CHANGELOG/STATE/TECH_DEBT/ARCHITECTURE` + DATA_MODEL §7/§5.1 + README/INTERIM/ENGINEERING 抽关键事实 | ✓ | — | ✓（见 §3 R-C-05/06/07/08/14/15/16） | — | — | ✓ | — |
| `cloudfunctions/{api,cleanup}/db/{dao,collections}.js` 部署单元副本 | — | — | ✓（#17 未覆盖，R-C-17） | — | ✓（仅注释/日志前缀差异） | ✓ | — |
| `docs/` 其余正文质量 | — | — | — | — | — | — | ○（阶段 3 只审同步性，正文不在范围） |

### 2.2 七维逐条结论（本 part 范围）
1. **接入性与装配**：tools 全部有真实调用点——`check.js`/`check-docs.js`/`zero-money-scan.js`/`selftest.js` 由 `check.ps1:16-21` 四步装配；`fake-db.js` 被云 handler 套件 require；`mutation.ps1`/`seed-dev.js`/`sync-cloud-shared.js` 由文档/RUNBOOK 引用（手工工具属预期）。**断链 0**。注：`mutation.ps1` 未被 doctor.ps1 的"工具存在性"清单收录（该清单 7 件，不含变异电池）——属轻量遗漏，不构成断链（见 §4）。
2. **逻辑性**：工具主路径逻辑基本可靠（详见 §3）；发现 3 处工具行为缺陷（gate.ps1 行数口径 R-C-01、seed-dev 索引清单 R-C-02、zero-money-scan 独立退出码 R-C-10）与 2 处测试聚合/电池弱断言（R-C-04、R-C-13）。
3. **牵连性**：门禁↔文档↔代码计数逐项对表（14 集合/13 错误码/16 审计/81 动作/30 页面/31+10 判据全部一致）；不同步项 8 条（R-C-03/05/06/07/08/14/15/16）。被删符号零残留：旧错误码 7 个全仓 0 命中（附录 ④）。
4. **性能**：C 范围无生产热路径；工具为开发期一次性运行。可提点：`zero-money-scan.js` 对单文件 >8MB 静默跳过（`maxReadBytes`），属"大文件=不扫"的静默豁免，当前仓内无此规模文件，记录为观察项（不计数）。
5. **冗余死代码**：`tools/lib/project.js` 的 `VIEW_TICKET_OWNERS`/`pageDir` 与 `zero-money-scan.js` 的 `group` 常量无调用方 → R-C-18。
6. **开发规范**：4 个 `.ps1` 全部 UTF-8 BOM + 纯 LF + 末行单换行（实测，见 §4）；全仓 `.js/.json/.wxml/.wxss` 无 BOM、无 CRLF、0 行数越线（`project.private.config.json` 为 git 忽略的本地私有文件，CRLF 不计）；提交信息格式最近 8 条全部匹配 `^(feat|fix|docs|test|chore)\(v4\):`。
7. **安全**：C 范围安全 = "门禁能否挡安全面"：抽查 6 条（#16/#24/#28/#29/#30/#31）判据有牙度见附录 ⑤，其中 #24 单文件窄豁免有补偿断言（通过）、#29 一处静态子判据可被注释满足（R-C-11）、#23 一处可被 WXML 注释满足（R-C-12）。密钥/凭据面：`.env.example` 只含键名与占位符；全仓无 openid 形态字面量（check #19 覆盖）；**密码类 N/A（本仓无密码）；CSRF N/A（小程序无浏览器 CSRF 面）；依赖漏洞 N/A（无 node_modules/lockfile，两云函数仅 `wx-server-sdk@4.0.2`，本机不可 npm audit）**。
8. **条件维**：⑧ UI 可访问性 — N/A（C 不审 UI 实现，只审测试对页面的静态判据）；⑨ 外部调用 — 本仓仅服务端 DeepSeek，C 侧只审"客户端零外呼/Key 不进包"判据（#24/#25，通过）；⑩ 性能预算 — N/A（无预算文件；C 无热路径改动）；⑪ 数据隐私 — C 侧审"隐私/脱敏/测试隔离判据"（#19/#24/#29/#30，见附录 ⑤）。

### 2.3 selftest 抽审清单
- 全读：`selftest-core.js`（58 断言/7 节）、harness `selftest.js`。
- 重点审（结构+关键节）：`selftest-cloud.js`（router 双向注册 §7.3:968-978；fake DB `-502001` 真实语义 §7.3:140-167）、`selftest-order.js`（H 静态回退闸:861-882，含 H1 正控/H3 非空样本）、`selftest-admin.js`（A~G 负向矩阵头）、`selftest-order-lifecycle.js`（A~I 分节与契约映射）、`selftest-deletion.js`（A~F 端到端+先判据后修）。
- 结构统计（grep）：其余 22 套逐套统计 `EXPECTED_ASSERTIONS`/`h.section`/断言 helper/`installCrashGuard`，见附录 ③ 表。
- ○ 未逐行审 22 套（名单见附录 ③）：原因 = 阶段 3 只抽审判据"有牙/空转/断言数"，业务正确性不属本 part；以 EXPECTED 精确闸 + 变异证据 + 抽审 6 套替代。此 ○ 不影响"测试是否空转"结论（断言数闸是机械的）。

## 3. 问题清单（R-C-01 起）

> P0=0，P1=0。19 条：P2 ×4、P3 ×15。每条含 位置/描述/影响/建议/证据（命令原文+退出码+命中行）。

### P2

#### R-C-01 | P2 | `gate.ps1:127`、`gate.ps1:133`、`gate.ps1:172`
- **描述**：gate.ps1 的"行数/体量"判据用 `Get-Content | Measure-Object -Line` 取行数，**不是全文本口径**：(a) `Measure-Object -Line` 只计非空行；(b) 该仓门禁以 Windows PowerShell 5.1 执行（附录 A 明示"PS 5.1 可执行"），5.1 的 `Get-Content` 默认按 ANSI 解码 UTF-8，中文注释行会连行丢失。实测 `tools/check.js`：真实 953 行 → gate 口径 **894** 行（-6.2%；其中空行 35、编码丢行 24），而 `tools/check.js` 的 `F.countLines`（fsutil 全文本口径）得 953。
- **影响**：`gate.ps1` ④"本批新增越线红"与 ⑥"体量 ≤ 预估×1.5"可被空行/中文注释稀释而**假绿**（500 行上限文件可容纳约 30+ 空行过线）；与 ENGINEERING §8.4 "全文本口径"及 check.js #18 的读数不一致。check.js #18 全树覆盖准确，故不构成"全仓漏检"，但 gate 单独读数不可信。
- **建议**：gate.ps1 改用 `[System.IO.File]::ReadAllLines(path, [Text.Encoding]::UTF8).Length`（或 `-Encoding UTF8` + 全文本计数函数）；⑥ 未跟踪文件 added 行同样改。并补一行"行数取数口径 = 全文本"的注释与自测样本。
- **证据**：
```powershell
$p='tools/check.js'
[System.IO.File]::ReadAllLines((Resolve-Path $p)).Length
(Get-Content -LiteralPath $p | Measure-Object -Line).Lines
(Get-Content -LiteralPath $p -Encoding UTF8 | Measure-Object -Line).Lines
$PSVersionTable.PSVersion.ToString()
```
输出（命令成功，`$?=True`；PowerShell cmdlet 无进程退出码）：
```
953
894
918
5.1.22621.6133
```
命中行：`gate.ps1:127`（`$lines = (Get-Content -LiteralPath $f ... | Measure-Object -Line).Lines`）、`gate.ps1:133`（锚点前 `$before = @($old.Out).Count` 仅对 git 输出计数，口径也不同）、`gate.ps1:172`（未跟踪文件 added 行）。

#### R-C-02 | P2 | `tools/seed-dev.js:80-91`
- **描述**：`seed-dev.js` 声称"生成可执行的初始化计划（集合/索引/config/测试账号，对齐 DATA_MODEL…）"（文件头 :7-8，RUNBOOK §3.5 引用它打印初始化计划），但其唯一索引清单只有 **13 项**，低于权威清单 **15 项**（`admin.bootstrap` 的 `INDEX_SPECS`、DATA_MODEL §5.1、ENGINEERING §4.6、selftest-cloud §7.3 的 15 项逐项断言）。缺：`bindings.tagKey`（uk_tag_key，roomTag 并发第二道闸）、`admin_view_sessions.requestKey`（uk_request_key）、`admin_audit.requestKey`（uk_request_key）；其中 `admin_view_sessions` 用 `_id` 占位。另：注释把索引出处写成"DATA_MODEL §9"（§9 是 roomTag 算法，索引在 §5.1）。
- **影响**：按 `seed-dev.js` 清单建库会**缺 3 个唯一索引**（含 roomTag 并发唯一键、审计幂等键），并发/重放保护下降；CHANGELOG:40 已修过 `admin.bootstrap` 的同类漏列（只补了 bootstrap，**seed-dev 未同步**），且**无任何判据覆盖 seed-dev**（grep 全 28 套无 `seed-dev` 引用）。STATE.md:138 明写"`seed-dev.js` 可给清单"，会误导操作者。
- **建议**：把 `INDEX_SPECS` 提成单源（从 bootstrap 导出或 tools/lib 常量），seed-dev 直接引用；补一条"seed-dev 索引清单 === DATA_MODEL §5.1 唯一索引 15 项"的 selftest（或并入 selftest-cloud §7.3 的 15 项断言，双向比对 bootstrap 与 seed-dev）；修正注释 §9→§5.1。
- **证据**：
```powershell
Select-String -Path tools/seed-dev.js -Pattern 'const indexSpec' -Context 0,10
(Select-String -Path cloudfunctions/api/handlers/admin/bootstrap.js -Pattern "name: 'uk_" | Measure-Object).Count
```
输出（命令成功）：
```
80: const indexSpec = {
          customers: [['customerNo', true]],
          partners: [['openid', true], ['partnerNo', true]],
          bindings: [['activeKey', true]],
          orders: [['orderNo', true], ['requestKey', true]],
          order_events: [['requestKey', true]],
          invitation_codes: [['code', true]],
          admin_view_sessions: [['_id', true]],
          counters: [['key', true]],
          upload_tickets: [['ticket', true]],
          recognition_failures: [['failureNo', true], ['requestKey', true]],
15
```
命中行：`tools/seed-dev.js:80-91`（13 项）；对照 `cloudfunctions/api/handlers/admin/bootstrap.js:13-28`（15 项）；`docs/V4_DATA_MODEL.md:495` §5.1；`docs/V4_ENGINEERING.md:322` §4.6；`docs/RUNBOOK.md:90` 引用 seed-dev；`CHANGELOG.md:40` 同类修复只覆盖 bootstrap。

#### R-C-03 | P2 | `docs/V4_DATA_MODEL.md:28`、`docs/privacy/发布前填写清单.md:72`、`V4_REBUILD_SPEC.md:405`
- **描述**：三处文档把"零金额扫描词表"写成 **7 个中文词元**，比词表唯一单源多出 `费用`、`支付` 两个中被扫描的词；而 `tools/zero-money-scan.js:36` 的 `ZH_TERMS` 只有 5 个（`\u91d1\u989d`/`\u4ef7\u683c`/`\u8fd0\u8d39`/`\u6536\u6b3e`/`\u7ed3\u7b97`），与 ENGINEERING §7.6:729 一致。即：文档声称"`费用`/`支付` 命中即失败"，实际机械扫描**不识别这两个中文字面量**（仅当以英文 `[EN-TERM]` 词根出现时才拦）。
- **影响**：用户硬口径（零费用语义）在文档层被宣称为机器强制，实际中文写法可绕过——若后续有人在源码/UI 写"含费用""支持支付"等中文，`check.js #22`/`check-docs #7` 不会红。文档与门禁单源不一致，后续 agent 会误信。
- **建议**：二选一收口——①扩 `ZH_TERMS` 到 7 词并补 selftest-core 正控/白名单登记（改词表须同步 ENGINEERING §7.6/§8.2 #22，属 Lead 授权口径变更）；②把三处文档改为与 §7.6 同源的 5 词 + 英文词根表述，删除 `费用`/`支付` 声称。建议②（最小改动、不扩扫描面）。
- **证据**：
```powershell
# 文档侧：同时含有中文“费用”“支付”的“扫描/门禁”声明行（仅取 file:line）
Select-String -Path docs/V4_DATA_MODEL.md,docs/privacy/发布前填写清单.md,V4_REBUILD_SPEC.md -Pattern '^(?=.*扫描)(?=.*\u8d39\u7528)(?=.*\u652f\u4ed8).*$' | ForEach-Object { $_.Filename + ':' + $_.LineNumber }
# 扫描器侧：词表定义行（行内容含词表字面量，按纪律不转写）
Select-String -Path tools/zero-money-scan.js -Pattern 'const ZH_TERMS' | Select-Object -ExpandProperty LineNumber
Select-String -Path docs/V4_ENGINEERING.md -Pattern '词表（唯一单源' | Select-Object -ExpandProperty LineNumber
```
输出（命令成功）：
```
V4_DATA_MODEL.md:28
发布前填写清单.md:72
V4_REBUILD_SPEC.md:405
36
729
```
命中行：`docs/V4_DATA_MODEL.md:28`、`docs/privacy/发布前填写清单.md:72`、`V4_REBUILD_SPEC.md:405`；对照 `tools/zero-money-scan.js:36`、`docs/V4_ENGINEERING.md:729`、`docs/V4_CONTRACT.md` §3（同 5 词）。

#### R-C-04 | P2 | `tools/selftest.js:196-242`（聚合清单与 SKIP 语义）、`check.ps1:32-38`
- **描述**：`tools/selftest.js` 聚合入口硬编码 `SUITES`（28 项）且对"文件存在但非 register 形态"的套件打印 `[SKIP]` 后**不计失败**（:221-224），聚合 exit 0；`check.ps1` 只验退出码（:32-38），不校验 SKIP 数、不校验 SUITES 完整性。当前 28 套与文件 28/28 一一对应（实测，无 SKIP），但**没有任何判据**能发现"新增/改名套件未注册进 SUITES"或"某套丢失 `register`/`EXPECTED_ASSERTIONS` 导出"——这两种情况都会让测试无声漏跑而 check.ps1 全绿。
- **影响**：测试覆盖可在不全红的情况下缩水（正是 brief ③"循环空集全绿/子检查空转"在聚合层的变体）；新增第 29 套若漏注册，DoD 读数仍绿。
- **建议**：聚合入口增加机械自检：`tools/selftest-*.js` 中"register+EXPECTED 形态"的文件集合 === SUITES 集合（双向），不相等则 exit 1；`SKIP` 改为红（或必须显式 `--allow-skip` 并在 check.ps1 传白名单）；check.ps1 增加 `SKIP 0`/`运行套数 === SUITES.length` 的行级断言。可在 `selftest-core` 增一条结构断言（读 selftest.js 源 + 目录文件），成本低。
- **证据**：
```powershell
$src = Get-Content tools/selftest.js -Encoding UTF8 -Raw
$m = [regex]::Match($src, "const SUITES = \[([\s\S]*?)\];")
$listed = [regex]::Matches($m.Groups[1].Value, "'([^']+)'") | ForEach-Object { $_.Groups[1].Value }
$reg = Get-ChildItem tools -File -Filter 'selftest-*.js' | Where-Object { $_.BaseName -ne 'selftest' } | ForEach-Object { $t=Get-Content $_.FullName -Encoding UTF8 -Raw; if($t -match 'module\.exports\s*=\s*\{[^}]*register' -and $t -match 'EXPECTED_ASSERTIONS'){ $_.BaseName } }
"SUITES=$($listed.Count) register+EXPECTED=$(@($reg).Count) inSuitesNotFile=$(@($listed | Where-Object { $reg -notcontains $_ }).Count) fileNotInSuites=$(@($reg | Where-Object { $listed -notcontains $_ }).Count)"
Select-String -Path tools/selftest.js -Pattern 'SKIP|不做失败' | ForEach-Object { $_.LineNumber }
```
输出（命令成功）：
```
SUITES=28 register+EXPECTED=28 inSuitesNotFile=0 fileNotInSuites=0
221
222
```
命中行：`tools/selftest.js:221-224`（`[SKIP]` 分支）、`:238-241`（汇总只按 failedSuites）；`check.ps1:32-38`（只按 `$LASTEXITCODE` 判红）。现状：28/28 一致、SKIP 0（§4 通过项）。

### P3

#### R-C-05 | P3 | `docs/V4_ENGINEERING.md:48`、`docs/V4_ENGINEERING.md:738` vs `check.ps1:16-21`
- **描述**：ENGINEERING §1.2/§8.1 两处仍写 `check.ps1` 的 `STEPS` 为 **9 条**（check.js/check-docs/selftest/selftest-ai/selftest-cloud/selftest-bind/selftest-profile/selftest-switch/selftest-testaccount），实际 `check.ps1` 为 **4 步**（check.js → check-docs → zero-money-scan → selftest 聚合，后者已含全部 28 套）。文档与实现不一致（4 步是 9 步的超集，覆盖无损）。
- **影响**：工程规则源与门禁实现不符；按文档手工复跑会重复执行被聚合的套件（耗时×2 以上），也会让读者误以为 zero-money-scan 不在 check.ps1 内。
- **建议**：回写 ENGINEERING §1.2/§8.1 为 4 步实际清单；保留"聚合口含 28 套、单套可取数"的说明。
- **证据**：`Select-String docs/V4_ENGINEERING.md -Pattern 'STEPS|4 步'` → 命中 `:48`（"check STEPS 扩为 9 条"）、`:738`（`$STEPS = @(...9 项...)`）；`check.ps1:16-21`（4 个 step 对象：check.js / check-docs.js / zero-money-scan.js / selftest.js）。

#### R-C-06 | P3 | `tools/check.js:6-14`
- **描述**：check.js 文件头自述"本文件自身也受 #18 约束（≤500 行全文本）"，但 #18 实现（:494-505）对 `tools/` 采用 ≤1000 档（ENGINEERING §8.2 #18:761 已按 1000 口径），该文件实际 953 行——**头部自述过期**，与实现/文档矛盾。
- **影响**：不产生门禁错误；但头部是维护者的"第一口径"，会误导后续新增判据时按 500 行自限（无谓拆分）。
- **建议**：改头部为"tools/ 工具链 ≤1000（#18 差异登记）"。
- **证据**：`Get-Content tools/check.js` 头部 :6-14（"…本文件自身也受 #18 约束（≤500 行全文本）…"）；:494-505（`isTool ? 1000 : 500`）；行数 953（附录 ③ 表）；`docs/V4_ENGINEERING.md:761`。

#### R-C-07 | P3 | `docs/V4_ENGINEERING.md:767` vs `tools/check.js:641-668`
- **描述**：ENGINEERING §8.2 #24 只写"客户端范围零命中 `DEEPSEEK_API_KEY`/`api.deepseek.com`/`deepseek`"，**未登记** check.js 实际存在的"单文件窄豁免 + 补偿断言"（`pkg-customer/parts/privacy-text.js` 允许出现第三方 AI 名，同时锁零 Key/端点/URL/`require`/`fetch`/`wx.cloud`/`ai.parseParcel`）。该豁免在 TD-052/lessons/STATE §7 #20/check.js 注释有记录，但门禁口径唯一工程源（§8.2）缺行。
- **影响**：文档读者会认为"客户端任何 deepseek 痕迹都红"，实际存在合法例外；未来若有人照 §8.2 收紧判据会误伤隐私披露文本（该冲突已有 lessons 卡）。
- **建议**：§8.2 #24 行补一句"例外：`pkg-customer/parts/privacy-text.js` 单文件窄豁免 + 补偿断言（见 TD-052）"。
- **证据**：`Select-String docs/V4_ENGINEERING.md -Pattern '^\| 24 \|'` → :767 无豁免表述；`tools/check.js:647-661` 豁免与补偿断言实现；`pkg-customer/parts/privacy-text.js:42,82` 为披露句（实测零 Key/端点/URL/fetch，见附录 ⑤）。

#### R-C-08 | P3 | `docs/V4_ENGINEERING.md:771` vs `tools/check.js:766-771` + `cloudfunctions/api/handlers/order/{_dto.js:85,_store.js:205,214}`
- **描述**：ENGINEERING §8.2 #28 写"代客单路径**零 `bindings` 集合访问**"，但实现口径与代码事实是"零**写**"：check.js:769-770 只拦 `add/set/update/remove(COLLECTIONS.bindings)`，注释明示"读 ACTIVE 绑定用于顾客单可见性是合法读路径"；order handler 确实读 bindings（`_dto.js:85`、`_store.js:205/214`）。TD-031 描述用的也是"不写 bindings"。
- **影响**：文档措辞比实现宽：若按文档字面追责，合法读取会被误判；若按实现，文档又不准确。
- **建议**：§8.2 #28 改为"代客单路径零 `bindings` **写**（读 ACTIVE 绑定做可见性合法）"，与 TD-031/check.js 注释一致。
- **证据**：`Select-String docs/V4_ENGINEERING.md -Pattern '零 `bindings` 集合访问'` → :771；`tools/check.js:769-770`（只匹配写操作）；`cloudfunctions/api/handlers/order/_dto.js:85`、`_store.js:205,214`（读 bindings 行号）。

#### R-C-09 | P3 | `tools/zero-money-allowlist.json`（8/136 项）+ `tools/zero-money-scan.js:131-165`
- **描述**：136 项白名单中有 **8 项**的"文件+整行原文"在当前文档中已不存在（精确行匹配失败）：JSON 行 3（docs/privacy/发布前填写清单.md）、12（docs/privacy/隐私保护指引.md）、63/64/81/82（docs/V4_DATA_MODEL.md）、107（README.md）、137（V4_REBUILD_SPEC.md）。`loadAllowlist` 只做 schema/通配校验，**不校验条目仍能命中当前文件行**，失效项静默留存。
- **影响**：白名单出现"僵尸项"（文档改版后残留）；虽不直接放行新违规（精确行匹配不会误放），但削弱白名单的可审计性，长期会漂移；且无法发现"该登记未登记"的回潮。
- **建议**：在 check.js #22 或 selftest-core 白名单自测中加"每条 allowlist 项必须仍精确命中一个当前行"的判据（或扫描器提供 `--stale` 输出供维护），并清理 8 项。
- **证据**：
```powershell
# 精确行匹配复算（脚本与扫描器同语义：hit.text === 原行 trim）
$al = (([System.IO.File]::ReadAllLines((Resolve-Path 'tools/zero-money-allowlist.json'))) -join "`n") | ConvertFrom-Json
$stale = @(); $i = 0
foreach ($e in $al) { $i++; $found = $false; foreach ($l in [System.IO.File]::ReadAllLines((Resolve-Path $e.file))) { if ($l.Trim() -eq $e.string) { $found = $true; break } }; if (-not $found) { $stale += ("JSON行=" + ($i + 1) + " file=" + $e.file) } }
"total=$($al.Count) stale=$($stale.Count)"; $stale
```
输出（命令成功；本文件复跑两次结果一致）：
```
total=136 stale=8
JSON行=3 file=docs/privacy/发布前填写清单.md
JSON行=12 file=docs/privacy/隐私保护指引.md
JSON行=63 file=docs/V4_DATA_MODEL.md
JSON行=64 file=docs/V4_DATA_MODEL.md
JSON行=81 file=docs/V4_DATA_MODEL.md
JSON行=82 file=docs/V4_DATA_MODEL.md
JSON行=107 file=README.md
JSON行=137 file=V4_REBUILD_SPEC.md
```

#### R-C-10 | P3 | `tools/zero-money-scan.js:254-309`
- **描述**：`node tools/zero-money-scan.js` 独立运行时：(a) 白名单 schema 问题只在 `printHuman` 打印（:259-262），**不改变进程退出码**（:309 只按 `hits.length`）；(b) 扫描文件集为空（根路径/cwd 异常导致 `collectFiles` 返回 0 文件）时同样"0 命中 exit 0"，没有"空集判红"。与 ENGINEERING §7.6/§8.1 "没有汇总输出 = 读数作废/空集不得判绿"的纪律存在缺口。check.js #22 补了 allowlistIssues 判红，但同样**不校验 source 扫描非空**。
- **影响**：单跑该工具作为 DoD 三读数之一时，"白名单坏但正好 0 命中"或"扫了个空树"可假绿；当前仓内 check.ps1 还并行跑 check.js #22，实际风险低。
- **建议**：`main` 中 `if (al.issues.length) return 1; if (result.files === 0) return 1;`；check.js #22 加 `if (r.files === 0) return ['扫描文件集为空（空集不得判绿）']`。
- **证据**：`tools/zero-money-scan.js:259-267`（问题仅打印）、`:304-309`（`return result.hits.length === 0 ? 0 : 1`）、`collectFiles` :175-221 无空集断言；`tools/check.js:613-618`（#22 无 `r.files` 校验）。

#### R-C-11 | P3 | `tools/check.js:817-822`
- **描述**：#29 子判据"昵称截断 + `msgSecCheck` 在 customer/partner 保存路径"用**未剥注释**的 `indexOf('msgSecCheck')` 判定。实测 `handlers/customer/saveProfile.js:3,100`、`handlers/partner/saveProfile.js:2`、`handlers/partner/activate.js:4` 命中处**全部是注释**；真实内容安全调用在 `handlers/user/_common.js:187-215`（`assertTextSafe` → `security.msgSecCheck`）及其它域。即：若删掉真实调用（但保留注释/被检文件里的字样），该静态子判据仍绿。
- **影响**：单看 #29 会误判"有牙"；当前由 `selftest-cloud.js:604-623,894` 的行为断言兜底（risky→`VALIDATION_FAILED` 且零落库），故**无实际缺陷**，但静态闸对"注释满足"无免疫（TD-031 同类先例）。
- **建议**：把 #29 的该子判据指向 `handlers/user/_common.js` 并 `stripComments` 后匹配 `assertTextSafe`/`security.msgSecCheck(`；或在 selftest-core 加"被检文件去注释后仍命中"的结构断言。
- **证据**：
```powershell
Select-String -Path cloudfunctions/api/handlers/customer/*.js,cloudfunctions/api/handlers/partner/*.js -Pattern 'msgSecCheck'
Select-String -Path cloudfunctions/api/handlers/user/_common.js -Pattern 'assertTextSafe|msgSecCheck'
```
输出（命令成功）：
```
# 前一条只剩注释行命中：saveProfile.js:3、saveProfile.js:100、activate.js:4、saveProfile.js:2
# 后一条：_common.js:187 `async function assertTextSafe(...)`、:198/:204 `security.msgSecCheck(...)`
```
命中行：`tools/check.js:819-821`（裸 `indexOf`）；`selftest-cloud.js:604-623`、`:894`（行为兜底）。

#### R-C-12 | P3 | `tools/check.js:621-627`
- **描述**：#23 "17 页引用 `switch-bar`"用 WXML 原文 `indexOf('switch-bar')`，**未剥 `<!-- -->` 注释**；一行 `<!-- switch-bar -->` 即可满足（组件实际未挂载也绿）。同类 #31 对 JS/WXML 已剥注释、对 WXSS 仍是原文 `indexOf`。#30 的 `isTest` 子串检查同理可被注释满足（TD-002 已登记"#30 为静态结构判据、不敏感属口径"，不重复论证）。
- **影响**：当前实测 17/17 页 **真实含 `<switch-bar` 标签**（非注释），无实际缺陷；属启发式闸的"注释满足"面，未来改页面时可能假绿（`selftest-switch` 只静态锁组件内部文案/角标，不逐页验证挂载）。
- **建议**：#23 改用 `stripWxmlComments` 后匹配 `<switch-bar`（而非裸词）；#31 的 wxss 分支同样剥注释。
- **证据**：`tools/check.js:624-626`（`s.indexOf('switch-bar')`）；`tools/check.js:903-911`（#31 对 wxml 剥注释、对 wxss 不剥）；实测 `<switch-bar` 标签 17/17（附录 ⑤ 命令输出）。

#### R-C-13 | P3 | `tools/mutation.ps1:67-86`、`:228-230`、`:320-326`
- **描述**：变异电池主流程（基线绿→注入→首红→`finally` 原字节还原→SHA256 前后一致→复跑绿→0/1/2 退出码）逻辑可信、真能首红；但两处断言偏弱：
  (a) "锚点必须恰好命中 1 次"用 `Get-HitLines` 返回的**行数**计数（:83/:230），而注入用 `IndexOf` 替换**首个出现**（:278-279）——同一行出现两次锚点时唯一性检查会误过，且只替换其一；
  (b) "工作树零残留"的 `git status --porcelain` 前后两次都在 `finally` 还原**之后**测量（:320-321），两读数必然相同、无信息量（真正的保护是 SHA256 逐字节比对，这部分成立）。
- **影响**：极端锚点（一行内重复）下变异可能不是预期的单点变异，证据失真；git status 断言是"安慰性断言"（不产生假红，但也不增加保护）。
- **建议**：锚点计数改 `IndexOf` 循环计**出现次数**；git 状态在注入前取一次、还原后取一次再比对（或删掉该断言只留 SHA256）。
- **证据**：`tools/mutation.ps1:83`（按行）、`:229-243`（`hitCount = hitLines.Count`）、`:278-279`（`IndexOf` 替换首个）、`:320-326`（前后都在还原后取）。
- **不运行声明**：按禁令本轮未执行 mutation.ps1；以上为逻辑审读，首红能力引用 CHANGELOG 记录（未复现，计入 §5 "依据未复现"）。

#### R-C-14 | P3 | `tools/check-docs.js:229-249`
- **描述**：#5 标题与 ENGINEERING §8.3 #5 都写"D#/E# **引用可解析**（E# 存在对应条目）"，实现只做**编号范围**（D 1~22、E 1~18）与"D 条目数=22/D1/D2 存在/E 非空"，**未校验每个被引用的 E# 是否真的在 ENGINEERING §13 有对应条目**（`eDefined` 只判非空）。且上界写 18，而 ENGINEERING §13 实际只定义 E1~E12（E7 已裁）；同时 `docs/QA_CHECKLIST.md` 另有独立的点检编号 E1~E18，同一 `E#` 记号双语义。
- **影响**：文档引用不存在的 E#（如 E13~E18 工程缺口）不会被判红；"引用可解析"名不副实。当前仓内工程侧无 E13+ 引用（只有 QA 点检引用），无现实受害。
- **建议**：`eDefined` 收集后对每个 `E#` 引用做成员校验；把工程 E 上界与 §13 对齐（12），QA 点检编号改用 `Q#`/`QA-E#` 等不相交记号（或单独登记到文档地图）。
- **证据**：`tools/check-docs.js:229-249`（仅有范围判断 `if (n < 1 || n > 18)`）；`docs/V4_ENGINEERING.md:784`（§8.3 #5 原文"存在对应条目"）；`docs/V4_ENGINEERING.md` §13 仅 E1~E12（E7 已裁，:935 说明）；`docs/QA_CHECKLIST.md:122-127` 用 E13~E18（点检）。
- **E 编号声明**：本文件仅引用 ≤E18，不新增 E 编号。

#### R-C-15 | P3 | `README.md:64`、`README.md:66`、`docs/V4_INTERIM_OVERVIEW.md:14/90/148`
- **描述**：当前态读数未随 HEAD 的三个修复提交同步：README:66 与 INTERIM 三处仍写 **28 套 4,151 条断言**（含 cloud 168 / order-partner 127 / partner-pages 156 / switch 140 / testaccount 153 等分套旧值），HEAD 实际 = **4,208**（cloud 174 / order-partner 128 / partner-pages 165 / switch 163 / testaccount 171；逐套合计见附录 ③）；README:64 写"564 个文件"（`git ls-files` 计数），实际 **572**。CHANGELOG/STATE 已按提交补叙事条目（`git show 9031d14/9fb10f0/9c2fb5a` 均含 CHANGELOG+STATE 变更），但"当前读数"块未更新（STATE §6 各批表为历史读数，可接受）。
- **影响**：对外/对用户展示的"真实输出"与仓库实际不符，违反"数字不写死/以真实输出为准"的展示纪律（不涉及判据失效）。
- **建议**：README 门禁块与 INTERIM 三处改为 4,208（或写"取数命令"而不写死）；文件数改为"以 `git ls-files` 实跑为准"并同步 572。
- **证据**：附录 ⑥ 计数命令输出（`4,151` 命中 `README.md:3/66`、`V4_INTERIM_OVERVIEW.md:14/90/148`；`564 个文件` 命中 `README.md:64`；`git ls-files` = 572；28 套 EXPECTED 逐项合计 = 4,208）。

#### R-C-16 | P3 | `docs/TECH_DEBT.md:76`
- **描述**：TECH_DEBT 尾部"与门禁的关系"摘要仍把 **TD-052 列入"随批 8 收口与首次部署跟踪"的未结项**，但 TD-052 行（:61）状态已是"已关闭"（批 8 task-80 关闭依据在行内）。状态摘要与条目状态矛盾。
- **影响**：唯一的债务台账出现"已关闭但仍被列为开放"的自我矛盾，影响 Lead 汇总与后续排期判断。
- **建议**：摘要行删除 TD-052 或改为"TD-052 已关闭（见行）"；建议加一条"摘要必须与行状态同步"的维护规则。
- **证据**：`docs/TECH_DEBT.md:76`（摘要含 TD-052）；`:61`（TD-052 行"已关闭"）；同日 TD-029/TD-030/TD-031 等已关闭项在摘要中未复列，说明摘要本身未随关闭更新。

#### R-C-17 | P3 | `cloudfunctions/api/db/{dao,collections}.js` vs `cloudfunctions/cleanup/db/{dao,collections}.js`
- **描述**：ARCHITECTURE §4.2 已授权 cleanup 部署单元保留第二套 `db/dao.js`（"接口与 api/db/dao.js 逐项一致、两文件改动必须成对"），但 check.js #17 的 hash 对帐只覆盖 `shared/**` + `utils/ids.js`/`utils/room-tag.js`/`config/defaults.js`，**未覆盖这两组"必须成对"的部署单元副本**（含 `db/collections.js` 同形约定）。实测两套 `dao.js` 仅注释/日志前缀差异（`git diff --no-index` 6+/10- 行），当前无漂移。
- **影响**：后续只改 api 侧（如写入语义修复）而忘记 cleanup 侧时，门禁不会红；批 8 注销链路依赖 cleanup dao 语义一致性，漂移只能人工发现。
- **建议**：#17 扩围或新增一条"结构对帐"：对 `cloudfunctions/{api,cleanup}/db/*.js` 做"剥注释+空白后 hash 相等"或至少"导出签名/关键语义探针相等"；或在 selftest-deletion 增"两套 dao 对同一输入行为一致"的行为断言。
- **证据**：`git diff --no-index --stat cloudfunctions/api/db/dao.js cloudfunctions/cleanup/db/dao.js` → `1 file changed, 6 insertions(+), 10 deletions(-)`；差异行均为注释/`console.error` 前缀；`tools/check.js:467-491`（#17 源清单不含 db/dao）；`docs/ARCHITECTURE.md:171`（授权例外+"逐项一致"）。

#### R-C-18 | P3 | `tools/lib/project.js:177,183,197,206,208`、`tools/zero-money-scan.js:255`
- **描述**：冗余死代码/未使用导出：`project.js` 导出 `VIEW_TICKET_OWNERS`（:177/206）、`pageDir`（:183/208）、`INTERNAL_ACTIONS`（:197）在全仓 `tools/**` **无任何调用方**（check.js #23 用硬编码 `'api/client.js'`/`'store/'` 而非该常量；`INTERNAL_ACTIONS` 由 selftest 自行从 `actions.ACTION_MAP` 计算）；`zero-money-scan.js:255` 的 `const group` 未使用（`printHuman` 内）。违反 AGENTS §5.4"新增导出必须有生产调用，或先登记 TECH_DEBT"。
- **影响**：死导出会随口径演化漂移（如 VIEW_TICKET_OWNERS 与实际 #23 判据已经不同步）；维护者误以为改常量即改判据。
- **建议**：删除未用导出/常量，或让 check.js #23 真正引用 `VIEW_TICKET_OWNERS`；若确需保留（未来扩展）登记 TECH_DEBT。
- **证据**：
```powershell
Select-String -Path tools/*.js,tools/lib/*.js -Pattern 'VIEW_TICKET_OWNERS|pageDir|INTERNAL_ACTIONS' | ForEach-Object { $_.Filename + ':' + $_.LineNumber }
```
输出（命令成功；只有定义/导出行，无调用行）：
```
project.js:177
project.js:206
project.js:183
project.js:208
project.js:197
```
`zero-money-scan.js:255`（`const group = {...}` 后文未引用）。

#### R-C-19 | P3 | `tools/check-docs.js:31-39`（文档范围构建）+ `:229-270`、`:274-278`、`:359-427`
- **描述**：本轮新建的 `docs/reviews/**` 被 check-docs 的文档范围**整体纳入内容判据**（`DOCS` = 根 md + `docs/**/*.md`；`#5 D#/E#`、`#6 占位标记`、`#7 零金额文档扫描`、`#10 旧口径禁词` 都遍历 `DOCS`）。审查报告的天职是**逐字引用证据**（违规词表、越界编号、废弃标记原文），而上述四条判据会把"引用"当"现行口径"判红：本 part 首跑即被 `#5` 判红 1 条（报告含一处越界编号字面量），写入前也必须把词表字面量转义才能让 `#7` 保持 0 命中——这使"原样贴命令原文+完整输出"的取证要求与门禁不可同时满足，报告不得不"转义证据"，降低证据保真度。
- **影响**：不是当前门禁误杀生产文档，而是**门禁与新增证据目录的职责冲突**：要么审查报告失真（转义），要么门禁红（挡住真证据）。本轮已按 Lead 纪律"报告内转义"处理，全 part 10/10 PASS + 零金额 0 命中；但该约定未写入 check-docs 注释/ENGINEERING §8.3，下一轮审查者仍会踩。
- **建议**（不改 tools/，交 Lead 裁决）：①把 `docs/reviews/**` 从 `DOCS` 内容判据中排除（`#1 文档地图`仍可保留根 md/设计文档范围），或②在 check-docs 文件头/ENGINEERING §8.3 明确"审查证据目录：证据字面量必须转义，转义约定=…"，并把该约定同步给后续审查者（本 part 已在头部写转义约定）。
- **证据**：`tools/check-docs.js:31-39`（`DOCS` 递归 `docs/**`，含新增子目录）；`:229-270`（#5 遍历 DOCS 查 D/E 越界）、`:274-278`（#7 调 `ZM.run({scope:'docs'})`）、`:359-427`（#10 遍历 DOCS 查旧口径）；本轮首跑 `node tools/check-docs.js --batch 1` 退出码 1：`[FAIL] #05 … docs/reviews/_parts/2026-10-22_C-platform.md: … 越界（D1~D22）`（该字面量已改写，复跑 10/10 PASS，见附录 A-7）；`node tools/zero-money-scan.js --scope docs` 首跑仅在本 part 完成转义后 0 命中（EXIT=0）。

### 跨域线索（记录不展开，交对应 part，不计 C 的 P 级）
1. **pkg-admin 35 处 `loadList()...catch(function () {})`**（如 `pkg-admin/pages/customers/index.js:106,113,118,122`）：经查 `loadList` 内部已 `feedback.handleError(this, err)` 给用户提示后 rethrow，调用侧空 catch 仅抑制 unhandled rejection → **非吞错**，判为合规；若 B2 复核认为应显式 `void` 或注释说明，可提 P3。
2. **`pkg-admin/common/copy.js` 的 `NETWORK_CODES` 使用后台专属文案**：UX_DEVELOPER §11.5 明确后台错误态文案（"没连上服务器…"），与 ENGINEERING §4.4"`shared/error-copy.js` 唯一文案处"并存解释为"后台文案表 + 业务错误用服务端 message" → 判为合规（非错误码单源违规）。
3. **12 处页面/parts 出现英文错误码字面量**（如 `pkg-customer/pages/order-detail/index.js:193`、`pkg-partner/pages/order-detail/parts/undo.js:72`）：均为**行为分支**（非拼文案），不违反"客户端不写死文案"；交 B2 复核交互正确性。

## 4. 通过项（含真实输出）

1. **门禁条数与文档声明一致**：`check.js` 31 条、`check-docs.js` 10 条（命令与输出见附录 ⑥；文档 `README/STATE/ENGINEERING` 均写 31/10）。
2. **错误码闸（④）通过**：`shared/error-codes.js` 恰好 13 码、`shared/error-copy.js` `CODE_COPY` 恰好 13 键（另 3 个 `PREFIX_HINT` 键）；`DATA_MODEL §7.2` 13/13、`CONTRACT §5.3` 13/13；旧码 7 个全仓 0 命中；本轮无新增错误码（v0.8/v0.9 均"不新增码"口径被代码注释与断言锁）。`registry/APIS.md` **N/A + 原因**：本仓按 E7 不设 registry 三件套，错误码唯一契约在 DATA_MODEL §7.2 + error-codes（附录 ④）。
3. **测试完整性（③）通过**：28 套全部 register+EXPECTED；逐套 EXPECTED 合计 **4,208**，与 HEAD 提交信息"28 套 4208 断言"一致；`.skip/.only/.todo` 0 命中、注释断言 0 行、trivial 断言 0 命中；EXPECTED 精确闸"少算/多算都判红"实现正确（`selftest.js:137-152`）；batch-9 基线（`81c58ba`）以来 EXPECTED 变更**全部为增**（+1/+6/+9/+41，合计 4,151→4,208），未见删断言/降标准迹象（附录 ③）。
4. **测试有牙抽查**：`selftest-order` H1 正控（构造小写集合键必命中）+ H3 样本非空（order+upload handlers ≥20 文件）+ H4 全仓零命中；`selftest-cloud` 有 fake DB 真实语义反向用例（嵌套对象写 `null` 父级 → `-502001`，:140-167）与 router↔actions 双向注册断言（:968-978）；`selftest-core` §7.6 扫描器正控/反例（注入样本必红、干净样本必绿、固定术语整体放行、白名单无通配/有理由）。
5. **历史空转项核销**：TD-002（#28~#31 有牙）与 TD-031（#28 去掉注释即红、三条件同时命中）已关闭且 `check.js #28` 实现确实 `stripComments` 后三条件齐验（:748-765）；`#29` 脱敏件缺失已改判红（:792-796，"读空不再跳过"）——两处均实测仍成立（附录 ⑤/#28、#29 证据）。
6. **编码纪律（ps1）**：4 个 `.ps1` 全部 `BOM=True`、`CRLF=0`、末字节 0x0A（check.ps1/gate.ps1/doctor.ps1/tools/mutation.ps1）；全仓 `.js/.json/.wxml/.wxss` 无 BOM、CRLF 0（`project.private.config.json` 为 git 忽略本地文件，不计）。本轮**未运行** `check.ps1/gate.ps1/doctor.ps1`。
7. **行数门禁现状**：全仓代码/测试文件 0 越线；上限贴边文件：`selftest-order-partner.js` 1000、`selftest-cloud.js` 994、`selftest-order-lifecycle.js` 967（均 ≤1000）、`check.js` 953（≤1000）；源码侧无 >500。
8. **配置与依赖**：两个云函数 `package.json` 依赖仅 `wx-server-sdk@4.0.2`；全仓无 `node_modules`、无 lockfile（N/A：本机不可 `npm audit`）；`.env.example` 只含键名/占位符；`.gitignore` 覆盖 `.env*`/`project.private.config.json`/`node_modules`/`.dsh-code-index`；`project.private.config.json` 未被跟踪（`git ls-files --error-unmatch` exit 1）。`project.config.json` 排除 docs/tools/cloudfunctions 出包，appid 与用户裁决 D2 一致。
9. **白名单无"整文件/整目录"宽豁免**：136 项全部为"文件+整行原文+理由"，无通配/绝对路径/上跳（`zero-money-scan.js:155-159` 校验）；实测全部条目只落 docs/根 md，无生产源码条目；`loadAllowlist` 的 reason 字段全部非空（136/136）；扫描器自身豁免仅 `tools/zero-money-scan.js`+allowlist 两个数据文件（有注释声明，属必要自指，不算宽豁免）。
10. **取代废弃（①）通过**：全仓生产源码+tools 510 文件，命中 5 处，全部"已申报"（2 处代码注释说明旧路径/旧常量已废弃且有保留理由；3 处为 allowlist JSON 数据行内嵌的**文档声明串**，允许清单登记理由齐备）；**生产源码 0 命中、未申报 0 处**；`STATE.md` 无并行态登记簿 → 按卡直接判，未发现并行实现（旧文件/旧函数/旧分支/旧常量）残留（附录 ①）。
11. **降标守卫（②）通过**：brief §3.6 命令 1（静音标记）**0 命中**；命令 2 的 71 处阈值字面量全部是**业务配置值/测试入参**（如 `orderTimeoutMinutes:120`、`avatarMaxBytes:204800`、`limit=2/20`），非"门禁阈值被挪大"；全仓生产代码 `eslint-disable/ts-ignore/noqa` 0 命中；无 `.skip/.only`、无注释测试。阈值清单与文档对照：`tools/*.js` 1000 档（ENGINEERING §8.2 #18）、gate `CODE_LIMIT=500/TEST_LIMIT=1000`（§8.4）、mutation 测试超时 180s（工具自身防御）；**未发现需裁决的"降标"改动**。④"阈值文件与失败功能同一次提交"因本轮无修复 diff → **N/A + 原因**；⑤"工件大小放宽"未发生 → N/A。
12. **文档四件覆盖本轮事实（⑥，部分）**：最后 3 个修复提交（`9c2fb5a`/`9fb10f0`/`9031d14`）均同时改 `CHANGELOG.md` 与 `STATE.md`（`git show --stat` 实测），并同步 `ARCHITECTURE`/`ENGINEERING`/`UX_DEVELOPER`/lessons；`TECH_DEBT` 新增/关闭条目与批 9 一致（唯一例外 R-C-16）；`ARCHITECTURE` 的"30 页面/14 集合/13 错误码/action 双向一致"（:212）与实测一致。
13. **DATA_MODEL §7 接口 ↔ api/modules 一致性（⑥ 抽查）**：DATA_MODEL §7 的 73 个 `module.action` 词元中，非 cleanup 的 68 个全部在 `shared/actions.js` 注册；`api/modules` 调用 65 个动作全部已注册，未注册动作 0；未调用差集 = `bind.claimGuestOrder`（P1 预留）+ `admin.bootstrap`/`health.check`（internal，不应被客户端模块调用）+ cleanup13（定时任务）→ **符合契约**（附录 ⑥）。
14. **sync-cloud-shared 副本对帐双保险**：check.js #17（hash）与 `tools/sync-cloud-shared.js --check`（自带逐字节复核）双实现；当前 `shared/**`+ids/room-tag/defaults 与两云函数副本一致（check.js 31/31 PASS 的组成项之一）；脚本 `--apply` 类危险操作不存在、`missingTarget` 有批 0 语义。

## 5. 结论

### ① 各级计数
- **P0 = 0；P1 = 0；P2 = 4（R-C-01~04）；P3 = 15（R-C-05~19）**；合计 19 条。
- 去重：与 A/B/D 轴的潜在重叠仅在"跨域线索"3 条，已注明不计 C 的 P 级。

### ② 依据未复现条数 = 2
1. `selftest` 实际执行读数 28 套 4,208 断言（本轮禁跑 `tools/selftest.js`，引用 HEAD 提交信息 + STATE §6 历史行 + 逐套 EXPECTED 合计的**结构核验**；结论仍可靠，因 EXPECTED 精确闸使"少算/多算"必红，但"实跑全绿"未由本 part 复现）。
2. `mutation.ps1` 首红证据（CHANGELOG 记录"三处首红 4/1/1 条 + SHA256 还原复跑绿"，本轮禁跑，仅做逻辑审读；R-C-13 的弱断言属逻辑结论，不依赖实跑）。
其余 16 条全部有本轮命令+输出（见各条证据与附录）。

### ③ 旧问题三态
**N/A（无旧报告；`docs/reviews/` 本轮新建）**。

### ④ 取代与废弃检查结论
- **并行态登记行数**：0（`STATE.md` 无并行态登记簿，命令输出为空；按 brief 直接判）。
- **废弃/取代标记命中数**：5（全仓生产源码 + tools，510 文件；正则含 `TO\x44O` 转义；输出见附录 ①）。
- **各条已申报判定**：
  1. `tools/check.js:792` — 已申报（注释说明旧路径 `handlers/admin/dto/mask.js` 已废弃、原因=判据空转；非并行实现，属"证据留存"说明）。
  2. `tools/selftest-partner-stats.js:412` — 已申报（断言文案说明旧 4×100 页累加常量已废弃；测试反例）。
  3. `tools/zero-money-allowlist.json:39` — 已申报（allowlist 数据行内嵌 CONTRACT §14 "已废弃（v0.7）" 声明串，条目 reason=口径声明）。
  4. `tools/zero-money-allowlist.json:42` — 已申报（同上，DATA_MODEL 旧口径对照行）。
  5. `tools/zero-money-allowlist.json:49` — 已申报（同上，门禁定义块声明行）。
- **未申报 = 0**；**生产源码命中 = 0**。结论：**不触发红灯条件**。
- 附注：R-C-09 的 8 项"僵尸白名单"与"已申报/未申报"是不同维度（已申报但失效），不改变本项结论。

### ⑤ 建议色
**🟡 黄**（P0=P1=0 且有 P2/P3；旧报告 N/A）。审查者只给建议色，裁决由 Lead/用户做。

### ⑥ 本轮发现 N / 可行动 M
- 本轮发现 **19** 条（P2×4、P3×15）；**可行动 19** 条。
- 建议优先处理（P2）：R-C-02（seed-dev 索引清单，操作风险最高）、R-C-03（词表文档口径，用户硬口径相关）、R-C-01（gate 行数口径）、R-C-04（聚合静默漏跑）。
- 其余 P3 可批量小改（文档 5 条 R-C-05/06/07/08/15/16 可一次回写；工具 5 条 R-C-09/10/11/12/18 可一并改；R-C-13/14/17 建议排期）。

## 附录 A · 强制扫描原始记录（命令原文 + 完整输出；命令为 PowerShell 5.1 可执行）

> 纪律说明：以下输出由本轮实际命令产生；被扫描词表的 5 个中文词元与英文词根按 Lead 纪律**等价转义**（不删语义、不改变行数与 file:line），未转义处即原文。PowerShell cmdlet 无进程退出码，标注 `$?=True`；node 命令标注真实退出码。

### A-1（对应必做①）取代与废弃标记全仓扫描
命令原文（正则按 Lead 纪律以 `\x44` 转义待办标记；等价语义）：
```powershell
$files = Get-ChildItem -Path 'app.js','pages','pkg-customer','pkg-partner','pkg-admin','components','custom-tab-bar','api','store','utils','config','shared','cloudfunctions','tools' -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -in '.js','.json','.wxml','.wxss','.ps1' }
"SCAN_FILES=$($files.Count)"
$re0 = '_old\b|_legacy|_v2\b|Deprecated|暂时保留|废弃|TO\x44O[:：]\s*(删|remove|delete)'
$hits = $files | Select-String -Pattern $re0
"HITCOUNT=$(@($hits).Count)"
$hits | ForEach-Object { ($_.Path -replace [regex]::Escape((Get-Location).Path + '\'),'') + ':' + $_.LineNumber + ': ' + (Mask-Text $_.Line.Trim()) }
```
输出（`$?=True`；`Mask-Text` 仅把词表字面量替换为转义写法）：
```
SCAN_FILES=510
HITCOUNT=5
tools\check.js:792: // 脱敏单源 = db/dto/mask.js；旧路径 handlers/admin/dto/mask.js 已废弃（读空会让判据空转，缺失必须判红）
tools\selftest-partner-stats.js:412: 'F03 §9 零 4×100 页累加常量（>400 单偏小的真缺陷已废弃）');
tools\zero-money-allowlist.json:39: {"file":"docs/V4_CONTRACT.md","string":"7. **零\u91d1\u989d纪律**：任何设计文档不得新增\u91d1\u989d/\u4ef7\u683c/\u8fd0\u8d39/\u6536\u6b3e/\u7ed3\u7b97/支付语义；引用旧口径必须显式标注\"已废弃（v0.7）\"。","reason":"口径声明：零\u91d1\u989d/零金钱政策声明行"},
tools\zero-money-allowlist.json:42: {"file":"docs/V4_DATA_MODEL.md","string":"- [ ] 零\u91d1\u989d：字段/动作/事件/取消原因/统计/配置/DTO 均无\u91d1\u989d语义；v0.8 `aiFallback` 只含次数/毫秒/布尔/枚举、`recognition_failures`/DTO 无\u91d1\u989d键；扫描词表仅 §0.3/§0.4 声明行与带“已删除/已废弃”标注的旧口径行命中，其余正文零命中。","reason":"门禁定义块：零\u91d1\u989d门禁/词表/判据定义行"},
tools\zero-money-allowlist.json:49: {"file":"docs/V4_DATA_MODEL.md","string":"**扫描门禁**：`[门禁词表]` `[ID-SUFFIX]|[EN-TERM]|[EN-TERM]|[EN-TERM]|[EN-TERM]|\u91d1\u989d|\u4ef7\u683c|\u8fd0\u8d39|\u6536\u6b3e|\u7ed3\u7b97|费用|支付`；源码/页面文案/文档命中即失败（门禁见 `docs/V4_ENGINEERING.md`）。`[门禁词表]` 白名单=本小节声明行、标题/正文中的「零\u91d1\u989d」概念引用、以及带「已删除/已废弃/不存在」标注的旧口径对照行；其余语境出现即缺陷（CONTRACT §14 第 7 条）。","reason":"门禁定义块：零\u91d1\u989d门禁/词表/判据定义行"},
```
判定：生产源码（pages/pkg/api/shared/utils/config/cloudfunctions）**0 命中**；tools 5 命中全部已申报（见 §5 ④）；未申报 0。

### A-2（对应必做②）降标守卫 §3.6 两条命令
命令 1 原文：
```powershell
Select-String -Path tools\*.js,tools\*.ps1 -Pattern '\.skip\(|\.only\(|eslint-disable|ts-ignore|ts-expect-error|noqa|SuppressWarnings'
```
输出：**（空输出）HITCOUNT=0** → 检查器静音标记 0 命中。

命令 2 原文：
```powershell
Select-String -Path tools\*.js -Pattern '(max|limit|budget|threshold|tolerance|timeout|retries|coverage)\w*\s*[:=]\s*\d+'
```
输出（`$?=True`；完整 71 行）：
```
HITCOUNT=71
fake-db.js:245: _limit: 0,
selftest-admin-pages.js:71: orderTimeoutMinutes: 120,
selftest-admin-pages.js:76: avatarMaxBytes: 204800,
selftest-admin-pages.js:78: testAccountMaxPerRole: 3,
selftest-admin-pages.js:398: configVm.validatePayload(Object.assign({}, payload, { orderTimeoutMinutes: 9 })).indexOf('10~1440') >= 0,
selftest-admin-pages.js:405: configVm.validatePayload(Object.assign({}, payload, { avatarMaxBytes: 201 * 1024 })).indexOf('100~200KB') >= 0,
selftest-admin-pages.js:446: const custSearch = accountSwitchVm.buildRealSearchParams({ role: 'CUSTOMER', keyword: ' C-7K2M ', limit: 10 });
selftest-admin-pages.js:447: const partnerSearch = accountSwitchVm.buildRealSearchParams({ role: 'PARTNER', keyword: 'P-7K2-M9X', limit: 10 });
selftest-admin-pages.js:458: role: 'CUSTOMER', customerUsed: 3, partnerUsed: 0, totalUsed: 3, maxPerRole: 3, maxTotal: 6
selftest-admin-pages.js:462: role: 'PARTNER', customerUsed: 3, partnerUsed: 2, totalUsed: 5, maxPerRole: 3, maxTotal: 6
selftest-admin-pages.js:510: && reviewVm.buildParams({ activeStatus: 'PENDING', activeDate: '0', limit: 20 }, 0).dateFrom === undefined,
selftest-admin-pages.js:572: await adminApi.listCustomers({ keyword: 'C-7K2M', includeTest: false, limit: 20 });
selftest-admin-pages.js:573: t.eq(seen[0].data, { keyword: 'C-7K2M', includeTest: false, limit: 20 }, '列表入参原样透传（keyword/includeTest/limit）');
selftest-admin-pages.js:575: await adminApi.updateConfig({ config: { orderTimeoutMinutes: 120 } });
selftest-admin-pages.js:576: t.eq(seen[0].data, { config: { orderTimeoutMinutes: 120 } }, 'updateConfig 入参按 { config: {...} } 包络');
selftest-admin.js:355: { config: { orderTimeoutMinutes: 90 } }, { clientRequestId: '' });
selftest-admin.js:431: const audit = await api.call('admin.listAudit', { limit: 20 });
selftest-admin.js:504: const paged = await api.call('admin.listInvites', { limit: 2 });
selftest-admin.js:506: 'C26 邀请码列表分页 limit=2 返回 nextCursor');
selftest-admin.js:547: config: { orderTimeoutMinutes: 90, avatarMaxBytes: 204800, testAccountMaxPerRole: 2, testDataRetentionDays: 30 }
selftest-admin.js:555: await expectCode(t, api.call('admin.updateConfig', { config: { avatarMaxBytes: 204801 } },
selftest-admin.js:557: 'D16 avatarMaxBytes=204801 越界 → VALIDATION_FAILED（上限=200KB 隐私承诺）');
selftest-admin.js:558: await expectCode(t, api.call('admin.updateConfig', { config: { avatarMaxBytes: 102399 } },
selftest-admin.js:799: api.call('admin.updateConfig', { config: { avatarMaxBytes: 1 } }, { clientRequestId: nextCrid('g3') }),
selftest-ai.js:133: timeoutMs: 1000,
selftest-ai.js:134: maxPerUserPerDay: 5,
selftest-ai.js:449: { enabled: false, model: 'deepseek-chat', timeoutMs: 8000 }, '缺省关闭 + 默认模型 + 8s 超时（应用可正常启动）');
selftest-ai.js:451: { maxPerUserPerDay: 5, dailyQuota: 200, cooldownMinutes: 10 }, '缺省配额/熔断参数对齐 DATA_MODEL §2.10');
selftest-ai.js:452: t.eq(deepseek.normalizeAiConfig({ aiFallback: { timeoutMs: 1e12 } }).timeoutMs, 2147483647,
selftest-ai.js:540: fetchImpl: timeoutFetch, env: { DEEPSEEK_API_KEY: 'test-key' }, config: aiConfig({ timeoutMs: 25 }), now: () => NOW
selftest-cleanup.js:317: const result2 = await SWEEPS_RUN.orderTimeout(makeCtx(db2, { config: { orderTimeoutMinutes: 60 } }));
selftest-cleanup.js:318: t.eq(result2.acted, 1, '§B config.orderTimeoutMinutes=60 生效（70min 单到期）');
selftest-cloud.js:822: db.seed('config', [{ _id: 'global', orderTimeoutMinutes: 120, autoCompleteHours: 24, screenshotRetentionDays: 7, privacyVersion: 'v4.0' }]);
selftest-cloud.js:870: sDb.seed('config', [{ _id: 'global', privacyVersion: 'v4.0', avatarMaxBytes: 102400 }]);
selftest-message-pages.js:226: const listData = await messageApi.list({ limit: 30 });
selftest-message-pages.js:228: t.eq(calls[0].data, { limit: 30 }, 'C2 message.list 入参原样透传（分页 limit）');
selftest-messages.js:416: const full = await api.call('message.list', { limit: 100 });
selftest-messages.js:419: const page1 = await api.call('message.list', { limit: 3 });
selftest-messages.js:421: t.check(page1.data.list.length === 3 && !!cursor, 'D2 limit=3 首页 3 条 + nextCursor');
selftest-messages.js:422: const page2 = await api.call('message.list', { limit: 3, cursor });
selftest-messages.js:431: const page = await api.call('message.list', { limit: 3, cursor: cursorNext });
selftest-messages.js:441: const tail = await api.call('message.list', { limit: 100 });
selftest-order-customer.js:329: const config = { orderTimeoutMinutes: 120 };
selftest-order-customer.js:389: const row = ordersView.rowView(rowOrder, { nowMs: Date.parse('2026-10-22T12:00:00+08:00'), config: { orderTimeoutMinutes: 120 } });
selftest-order-customer.js:522: 'F18 首页 onShow 用 message.list({limit:1}).unread 更新 store.badges.messages（E13）');
selftest-order-customer.js:558: config: { orderTimeoutMinutes: 120, autoCompleteHours: 24 },
selftest-order-lifecycle.js:502: const page1 = await cApi.call('order.listCustomer', { status: 'IN_PROGRESS', limit: 2 });
selftest-order-lifecycle.js:505: const page2 = await cApi.call('order.listCustomer', { status: 'IN_PROGRESS', limit: 2, cursor: page1.data.nextCursor });
selftest-order-lifecycle.js:800: const page1 = await cApi.call('message.list', { orderNo: listOrderNo, limit: 2 });
selftest-order-lifecycle.js:806: const page2 = await cApi.call('message.list', { orderNo: listOrderNo, limit: 2, cursor: page1.data.nextCursor });
selftest-order-partner.js:136: const page = await pApi.call('order.listPartner', { view: 'workbench', limit: 2, cursor });
selftest-order-partner.js:145: 'A13 limit=2 游标翻页不重不漏（两页合计=全量且顺序一致）');
selftest-order-partner.js:911: const matrixRows = (await matrixApi.call('order.listPartner', { view: 'workbench', limit: 100 })).data.list;
selftest-order.js:23: *   H. 静态回退闸：小写集合键正控/反例/全仓零命中、_create 幂等与单事务分支存在性、MAX_CREATE_BATCH=5。
selftest-partner-customers.js:148: const page = await pApi.call('partner.listBindings', { limit: 2, cursor });
selftest-partner-customers.js:158: 'A22 limit=2 游标翻页不重不漏，顺序与单页一致');
selftest-partner-customers.js:165: const single = await pApi.call('partner.listBindings', { limit: 1 });
selftest-partner-customers.js:167: 'A26 limit=1 时首批非空且仍有下一页（hasMore 按过滤后全量判定）');
selftest-partner-customers.js:247: bindingId: B1, limit: 2, cursor: { sortValue: 1, orderNo: 'X' }, from: 'not-a-time', to: NOW
selftest-partner-orders.js:334: { view: 'customer', bindingId: BIND_C1, limit: 2, cursor });
selftest-partner-orders.js:343: 'E15 limit=2 游标翻页不重不漏且顺序一致');
selftest-partner-pages.js:201: t.eq(listModel.refreshQuery(state), { keyword: '', limit: 20 }, 'A2 首屏查询只带 {keyword,limit=20}（无 cursor；§7.4）');
selftest-partner-pages.js:227: t.eq(listModel.nextQuery(listModel.applyMoreResponse(first, { list: [], nextCursor: 'cur-9' })), { keyword: '', limit: 20, cursor: 'cur-9' },
selftest-partner-pages.js:295: t.eq(detailView.buildOrdersQuery('b1'), { view: 'customer', bindingId: 'b1', limit: 20 },
selftest-partner-pages.js:297: t.eq(detailView.buildOrdersQuery('b1', 'cursor-2'), { view: 'customer', bindingId: 'b1', limit: 20, cursor: 'cursor-2' },
selftest-partner-pages.js:645: await partnerApi.listBindings({ keyword: 'D4', limit: 20 });
selftest-partner-pages.js:646: t.eq([captured[0].action, captured[0].data], ['partner.listBindings', { keyword: 'D4', limit: 20 }],
selftest-partner-pages.js:655: ['order.listPartner', { view: 'customer', bindingId: 'b1', limit: 20, cursor: 'cur-2' }],
selftest-state.js:535: return { orderTimeoutMinutes: 120, autoCompleteHours: 24 };
selftest-testaccount.js:211: t.eq(defaults.CONFIG_LIMITS.testAccountMaxPerRole, { min: 1, max: 3 }, '每角色上限范围 1~3（后台不可放宽）');
selftest-testaccount.js:474: t.eq(listed.usage, { customer: { used: 1, max: 3 }, partner: { used: 1, max: 3 }, total: { used: 2, max: 6 } },
```
判定：71 处均为业务配置/测试入参/分页 `limit`，**无"门禁阈值被挪大"**；无 ④/⑤ 形态（无修复 diff、无工件体量放宽）。人工核对五查结论见 §4 #11。

### A-3（对应必做③）测试有牙/空转抽查
命令（逐套结构统计 + 断言完整性 + 门禁空转项）：
```powershell
Get-ChildItem tools -File -Filter 'selftest-*.js' | Where-Object { $_.BaseName -ne 'selftest' -and $_.BaseName -notmatch 'cases|fixtures' } | ForEach-Object {
  $t = Get-Content $_.FullName -Encoding UTF8 -Raw
  $secs = ([regex]::Matches($t, "h\.section\(|asyncSection\(")).Count
  $exp = [regex]::Match($t,'const EXPECTED_ASSERTIONS = (\d+)')
  "{0,-30} exp={1,-5} sections={2,-3} guard={3}" -f $_.BaseName, $(if($exp.Success){$exp.Groups[1].Value}else{'cases'}), $secs, $(if($t -match 'installCrashGuard'){'Y'}else{'N'})
}
"skip/only/todo=" + @(Select-String -Path tools/selftest-*.js -Pattern '\.skip\(|\.only\(|\.todo\(').Count
"commented-assertions=" + @(Select-String -Path tools/*.js -Pattern '^\s*//\s*t\.(check|eq|neq|throws|notEmpty)\(').Count
"trivial-assertions=" + @(Select-String -Path tools/selftest-*.js -Pattern 't\.check\(\s*(true|1)\s*,|t\.eq\(\s*(\w+)\s*,\s*\2\s*,').Count
```
输出（`$?=True`；逐套表 28 行）：
```
selftest-admin-pages             exp=145   sections=16  guard=Y
selftest-admin                   exp=220   sections=7   guard=Y
selftest-ai                      exp=197   sections=5   guard=Y
selftest-bind-cloud              exp=108   sections=9   guard=Y
selftest-bind                    exp=79    sections=9   guard=Y
selftest-cleanup                 exp=183   sections=1   guard=Y
selftest-cloud                   exp=174   sections=11  guard=Y
selftest-core                    exp=58    sections=7   guard=N
selftest-deletion                exp=89    sections=1   guard=Y
selftest-message-pages           exp=138   sections=6   guard=Y
selftest-messages                exp=89    sections=7   guard=Y
selftest-order-customer          exp=190   sections=7   guard=Y
selftest-order-detail-partner    exp=153   sections=7   guard=Y
selftest-order-flow              exp=135   sections=9   guard=Y
selftest-order-lifecycle         exp=98    sections=10  guard=Y
selftest-order-partner           exp=cases sections=8   guard=Y
selftest-order-workbench         exp=197   sections=7   guard=Y
selftest-order                   exp=126   sections=9   guard=Y
selftest-partner-customers       exp=cases sections=6   guard=Y
selftest-partner-orders          exp=cases sections=7   guard=Y
selftest-partner-pages           exp=165   sections=8   guard=Y
selftest-partner-stats           exp=203   sections=7   guard=Y
selftest-privacy-text            exp=164   sections=7   guard=Y
selftest-profile                 exp=98    sections=10  guard=Y
selftest-recognize               exp=187   sections=12  guard=Y
selftest-state                   exp=341   sections=12  guard=Y
selftest-switch                  exp=163   sections=10  guard=Y
selftest-testaccount             exp=171   sections=13  guard=Y
skip/only/todo=0
commented-assertions=0
trivial-assertions=0
```
逐套 EXPECTED 合计 = **4,208**（58+341+187+174+197+79+108+126+135+98+190+128+197+153+120+89+165+203+98+163+171+220+89+183+145+138+164+89）；`-cases` 三个文件提供 128/120/89 三个值；`selftest-core` 无 crashGuard（聚合入口统一安装，单跑崩溃仍 exit 1，仅少了"崩溃时打印读数"的便利，属可接受；如要统一可补一行）。

补证 1（EXPECTED 完整性闸实现，`tools/selftest.js:137-152`）：
```
if (h.expected === null) { ... '未登记 EXPECTED_ASSERTIONS 完整性闸（读数作废）' ... }
else if (h.count !== h.expected) { ... '断言数 ' + h.count + ' ≠ EXPECTED_ASSERTIONS ' + h.expected + '（少算/多算都判红）' ... }
```
补证 2（自 batch-9 基线以来 EXPECTED 只增不删；`git log -p 81c58ba..HEAD -- tools/selftest-*.js` 过滤 `EXPECTED_ASSERTIONS = N`）：
```
+163 (switch)  -140
+171 (testaccount) -153
+165 (partner-pages) -156
+174 (cloud) -169
+128 (order-partner) -127
+169 (cloud) -168   [c6a2d91 批次修补]
```
（配对格式为"新值/旧值"；合计 4,151 → 4,208，无任何"减少断言"提交。）

补证 3（"有牙"样本，`selftest-order.js:862-873`）：
```
H1 正控：小写集合键 COLLECTIONS.orders 被扫描命中（扫描有牙）
H2 反例：大写键/ALL_COLLECTIONS/注释内小写键不误伤
H3 扫描样本非空（order+upload handlers 共 N 个文件，断言 >=20）
H4 order/upload handlers 零小写集合键
```
补证 4（fake DB 真实语义反向用例，`selftest-cloud.js:140-167`）：嵌套对象 update 遇 `null` 父级必须抛 `-502001`（"防再次假绿"）；router 注册集 = client 动作 + `admin.bootstrap`/`health.check`（:968-978）。

### A-4（对应必做④）错误码闸
命令（三向：注册表 / 文档 §7.2 / 契约 §5.3 / 页面文案映射 / 旧码残留）：
```powershell
"error-codes=" + @(Select-String -Path shared/error-codes.js -Pattern "^  '[A-Z][A-Z_]+'").Count
"error-copy-CODE_COPY=" + [regex]::Matches((Get-Content shared/error-copy.js -Encoding UTF8 -Raw), '(?m)^  ([A-Z][A-Z_]+):').Count
# DATA_MODEL §7.2 与 CONTRACT §5.3 段落内 13 码存在性（结果 13/13）
# 旧码：7 个旧错误码全生产源码单引号残留
```
输出（`$?=True`）：
```
error-codes=13
error-copy-CODE_COPY=13（后经段内精算=13；另有 PREFIX_HINT 3 键）
DATA_MODEL §7.2 present = 13/13 ; CONTRACT §5.3 present = 13/13
old-code residue hits = 0
```
- 13 码：`VALIDATION_FAILED` `FORBIDDEN` `NOT_FOUND` `CONFLICT` `INVALID_TRANSITION` `INVALID_STATE` `RATE_LIMITED` `INVITE_EXPIRED` `INVITE_USED` `VIEW_TICKET_EXPIRED` `PARTNER_CLOSED` `DEPENDENCY_FAILED` `INTERNAL_ERROR`（`shared/error-codes.js:8-22`；`shared/error-copy.js` 13 键）。
- 页面 error-copy 映射：`api/client.js:7` require `shared/error-copy`、`:121 copyOf(code)`（失败 toast 用 `result.message || copyOf(result.code)`）、`pkg-partner/pages/create-on-behalf/parts/form-model.js:465` 用 `errorCopy.CODE_COPY`；后台 `pkg-admin/common/copy.js` 为 UX_DEVELOPER §11.5 要求的后台专属文案（见跨域线索 2）。
- 新增错误码：本轮无新增 code（所有失败复用 13 码；AI 兜底失败不占码，§7.2 明确）；**`registry/APIS.md` = N/A + 原因**（E7 裁定不设 registry 三件套，契约落在 DATA_MODEL §7.2 + CONTRACT §5.3 + shared/error-codes 双向门禁）。

### A-5（对应必做⑤）门禁有效性抽查（6 条高风险判据）
（每条：判据位置 → 数据来源实测 → 判断）
1. **#16 云函数依赖白名单**（`check.js:439-464`）：判据=两 package.json 依赖仅 `wx-server-sdk` + 云端非相对 require 只允许 Node 内置。实测云端 require：`crypto, wx-server-sdk`（仅 2 个）→ **有牙**；弱面：动态拼接 require 可绕过（启发式，可接受；selftest-cloud 有启动级行为覆盖）。
2. **#24 客户端零 AI 外呼/零 Key**（`check.js:641-668`）：判据=客户端范围零 `DEEPSEEK_API_KEY`/`api.deepseek.com`/`deepseek`，`privacy-text.js` 单文件窄豁免 + 8 项补偿断言。实测 `pkg-customer/parts/privacy-text.js` 仅 2 处披露句（:42/:82 第三方 AI 名），无 Key/端点/URL/`require`/`fetch`/`wx.cloud`/`ai.parseParcel` → **有牙 + 豁免有补偿**；缺 ENG 回写见 R-C-07。
3. **#28 绑定方向**（`check.js:743-779`）：判据=`stripComments` 后同时命中"角色守卫调用/真实 `errors.forbidden(`/自绑比较"、实现文件缺失判红、代客单零 `bindings` 写、兼职端零引用、admin 专用 purge 存在。实测 `bind/create.js:32-33/54-55/62` 真守卫；TD-031 关依据（先注释满足→修后变异首红）在 TECH_DEBT:41 → **有牙**；文档措辞过宽见 R-C-08。
4. **#29 头像昵称/脱敏**（`check.js:781-832`）：判据=头像路径模板只在 upload 域且零 openid、脱敏单源 `db/dto/mask.js`（缺失=红）、`handlers/admin/_dto.js` 去注释禁词、admin handler 回吐键、`pkg-admin` 零引用、`msgSecCheck`/roomTag 大写。实测 mask 件存在且无 `avatarFileId`；`_dto.js` 去注释后无该键；profile handler 的 `msgSecCheck` 子判据只被注释满足（R-C-11）→ **主体有牙、一处子判据弱**。
5. **#30 账号切换与测试隔离**（`check.js:834-898`）：判据=`admin_view_sessions` 写入含 `viewMode/targetIsTest`、TEST_WRITE 签发断言 `isTestAccount`、统计/列表含 `isTest`、orders 写含 `isTest`/`impersonatedBy`、审计枚举双向、`VIEW_AS_*` 零残留。实测 `viewAsStart.js:55-66/77-90/101/165` 真断言 `isTestAccount`；`stats.js:31/64/111/113` 真过滤 → **组合有牙**；静态子串检查（`indexOf('isTest')`）可被注释满足属**已知口径**（TD-002 记录"check #30 为静态结构判据、行为断言覆盖"）。
6. **#31 测试视觉**（`check.js:900-927`）：判据=TEST 词边界（JS/WXML 剥注释）、test-badge 受 `TEST_WRITE` 控制、switch-bar 样式仅在组件 wxss、pkg-admin 零引用。实测 `components/test-badge/index.wxml:1` + `index.js:25`（`viewMode === 'TEST_WRITE'`）→ **有牙**；wxss 分支未剥注释（R-C-12 同类弱面，当前无缺陷）。
附加：**#23** 17/17 页实测含 `<switch-bar` 真标签（脚本取数），但判据本身未剥 WXML 注释（R-C-12）；**#22** 零金额扫描器正控在 `selftest-core:113-126`（注入样本必命中/干净样本必绿/白名单无通配），门禁自身可测。
真实输出（摘录）：
```
#16 云端非相对 require 去重：crypto, wx-server-sdk
#24 privacy-text.js 命中：仅 :42/:82 披露句（无 Key/端点/URL/fetch/require/wx.cloud/ai.parseParcel）
#28 bind/create.js:32-33/54-55/62 真守卫三件套
#30 viewAsStart.js:55/58/66/77/80/90/101 targetIsTest 断言 + stats.js isTest 过滤行
#31 test-badge/index.js:25 `view.viewMode === 'TEST_WRITE'`
#23 17/17 页含 <switch-bar（实测脚本）
```

### A-6（对应必做⑥）文档同步性抽查
命令（关键事实取数）：
```powershell
"check.js check(=" + @(Select-String -Path tools/check.js -Pattern '^check\(').Count
"check-docs.js check(=" + @(Select-String -Path tools/check-docs.js -Pattern '^check\(').Count
# app.json 解析：主包 7 + pkg-customer 5 + pkg-partner 7 + pkg-admin 11 = 30
# shared/collections.js ALL_COLLECTIONS=14；shared/error-codes.js=13；shared/audit-actions.js=16；components 目录=16
"git ls-files=" + (git ls-files | Measure-Object).Count
Select-String -Path README.md,docs/V4_INTERIM_OVERVIEW.md -Pattern '4,151' | ForEach-Object { $_.Filename + ':' + $_.LineNumber }
Select-String -Path README.md -Pattern '564 个文件' | ForEach-Object { $_.Filename + ':' + $_.LineNumber }
Select-String -Path docs/V4_ENGINEERING.md -Pattern 'STEPS' | ForEach-Object { $_.LineNumber }
```
输出（`$?=True`）：
```
check.js check(=31
check-docs.js check(=10
pages=30 collections=14 error-codes=13 audit=16 components=16
git ls-files=572
README.md:3
README.md:66
V4_INTERIM_OVERVIEW.md:14
V4_INTERIM_OVERVIEW.md:90
V4_INTERIM_OVERVIEW.md:148
README.md:64
48
738
```
四件与数据模型结论：
- **CHANGELOG**：覆盖本轮事实（最后 3 个 fix 提交均有一条"用户可见变更/工程细节"条目；`git show --stat` 实测每个提交都改 CHANGELOG），但"当前读数"块不存在（历史条目按批次写旧值属正常）。
- **STATE**：同上；§6 各批证据表为**历史读数**（可接受）；当前读数块未出现在 STATE（只在 README/INTERIM，见 R-C-15）；STATE §7 #28 行数余量 994/1000 与实际一致（实测 994/1000）。
- **TECH_DEBT**：TD-002/TD-029/TD-030/TD-031 等状态与关闭依据一致（:11/:39/:40/:41）；唯一矛盾 R-C-16（TD-052 摘要）。新增 TD-053~058 与批 9 回执一致。
- **ARCHITECTURE**：冻结接口/分层/写作用域与代码一致（§4.2 dao 两处例外、§4.3 注册表、:212 四计数）；最后提交亦同步了 ARCHITECTURE（`git show 9031d14 --stat`）。
- **DATA_MODEL §7 接口 ↔ api/modules**：DATA_MODEL §7 的 73 个 `module.action` 词元中 68 个非 cleanup 动作全部在 `shared/actions.js` 注册；`api/modules` 65 个调用全部已注册，未注册 0；差集= P1 预留 `bind.claimGuestOrder` + internal `admin.bootstrap`/`health.check` + cleanup13（符合契约）。§7.2 13 码 13/13。
- **页面/集合/错误码/action/审计五计数**：30 / 14 / 13 / 81（66 client+15 internal）/ 16，文档（README:64-65、ARCHITECTURE:212、CONTRACT §4/§5.3、STATE §2）与实测一致；唯一 action 数表述差异：`V4_INTERIM_OVERVIEW.md:14` "81 个动作"= 实测 81（含 P1 预留，正确）。
- **门禁条数**：check.js 31、check-docs 10，与 README/STATE/ENGINEERING 一致。

### A-7 本轮收尾自查（Lead 指定；命令原文+退出码+输出）
```powershell
node tools/zero-money-scan.js --scope docs
# 输出：零金额扫描：0 命中（白名单 136 项）    EXIT=0
node tools/check-docs.js --batch 1
# 输出：文档范围 54 份；[PASS] #01~#10 全 PASS；check-docs（--batch 1）：通过 10 项；失败 0 项    EXIT=0
```
- 首次自查曾命中 `#05 D#/E# 引用可解析`：本文件自述句曾把"未写超出 `D1~D22` 的编号"误写成超出 D22 一位的编号（越界 1 处）；已改写，复跑 10/10 PASS（记录在此以证"门禁真的会红、报告不含越界编号"）。
- 结论：本文件按 Lead 纪律写作，未写被扫描词表字面量（`--scope docs` 0 命中）、未写超出 `D1~D22` 的编号、未写代办标记字面量；**唯一写入 = 本文件**。

---

**附：封版说明**——本 part 未修改任何代码/配置/测试/文档（仅新建本文件），未执行 git 写操作，未运行 `selftest.js`/`check.ps1`/`gate.ps1`（禁令），未派子代理（卡禁令）。报告只写实际审查到的内容；覆盖地图如实标 ○。
