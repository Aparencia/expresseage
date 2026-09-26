# CODE_20260924_chat_pick_r4 · 卡 24 重审报告（r4 · 波 5 修复批的独立核销 + 文档侧整审）

## 0. 这一轮是谁、审什么、怎么编号

- **审查者**：新鲜上下文的第二名审查者（不认识 r3 那份报告的作者是谁），**真仓库全程只读**，变异注入全在临时副本 `…\Temp\r4_review_sandbox`。
- **输入**：主 agent 声明的"已修清单" = r3 报告（`CODE_20260924_chat_pick.md`）+ 修复 diff `13f0294..HEAD`（HEAD 当时为 `c3f2a48`）。
- **任务**：① 按 `13f0294..HEAD` **逐条独立复核** r3 的 R3-01~R3-16"现状"列（不采信主 agent 填的那一列）；② 补 r3 空缺的**文档/registry 侧整审**（含"数字改口径"是否真落实、`SCOPE §9` 与 `STATE` 是否自洽）；③ 七维全跑；④ 变异复测判据有没有牙。
- **编号口径**（本轮与 r2 不同，说明理由）：
  - **代码侧沿用审查者原编号 `R4-01~R4-05`**（它已被 `STATE.md` 与 `tools/check.js` 第 11 条的注释引用，改名会当场造出一条断链）。
  - **文档侧改用 `R4-D01~R4-D13`**（审查者原写作 `A1~A13`，本节给出映射表，不改内容）。
  - ⚠️ 与 v1 历史报告里裸用的 `R4-xx` **不是同一 namespace**（同族问题见 TD-012；靠本节区分）。

## 1. 回执头（审查者实跑，2026-09-25 装配时原样保留）

- 锚点 `b2a8a066f3607d80775af750b0d192d514ddb1d5` = `git cat-file -t` → `commit` ✓；审查时 HEAD = `c3f2a48`。
- 文档侧 `git diff --shortstat 锚点..HEAD -- docs/ STATE.md CHANGELOG.md README.md AGENTS.md` → 17 files, +974 −83。
- 修复侧 `13f0294..HEAD` → 21 files, +816 −287；波 5→r3 `e0c267a..13f0294` → 29 files, +1638 −245。
- **诚实边界**：审查者没有通读锚点以来的 9,189 行文档侧全量 diff，而是**逐份通读 13 份文档的当前全文** + 定向 `git diff` / `git show <sha>:<file>` 比对；`recognize/index.js` 的 `runRecognize`、`measureMid` 段是**逐行**读的（R4-01 就是这么抓到的）。
- 实跑：`node tools/check.js`（当时 34 项 / 0 失败 / exit 0）、`node tools/selftest.js`（278 条 / exit 0）、`git status --porcelain`（v2 空、v1 空）、`wc -l`、符号残留 `grep`、副本内 8 组变异、以及 **stub `wx`/`getApp` 直接驱动 `chatpick/index.js` 的运行时复现**。
- ⚠️ **任务书给的副本配方本身有坑**：`filter: p => !p.includes('.git')` 连 `.gitignore` 一起排除 ⇒ 副本门禁基线一开就是 exit 1 / 2 项 FAIL（缺 `.gitignore`、没挡住 `.env`）。审查者自己补回文件后才拿到 34/0 基线。已回写教训卡 `docs/lessons/2026-09-11_变异体卫生.md` 补记（配方里被排除的不该只有 `.git` **目录**，且**注入变异前必须先取一次 CONTROL 基线**）。

## 2. B 表：R3-01~R3-16 独立复核（逐条，不采信主 agent 的"现状"列）

| # | r3 声称 | r4 实测 |
| :- | :- | :- |
| R3-01 | 已修 + 六条断言 + 两变异 | **真修**。`form-parts.js` 的闸门①／释放②／销毁守卫齐；变异"撤闸门"→红 3、"不释放"→红 3（与报告"红 3/红 3"逐字吻合）。**但这次修复引入了新 P1 = R4-01** |
| R3-02 | 看门狗已修 | **真修**。让 `readRoomId` 永不结算 → `[FAIL] 异步断言链在 20000 毫秒内没有跑完` + `只跑到 227 条，预期 278` + **exit 1**，报告的读数原样复现 |
| R3-03 | 已修，三种拼错全判红 | **部分**。`chatTool`/`chatToolss`/`subPackage`/`windows`/`page`/`sitemapLocations` 全判红 ✓，19 个合法少见顶层键零误报 ✓；**但相邻两字符转置 `cahtTools` 判绿** —— `check.js` 的 `oneEditApart` 不是真编辑距离，转置按 2 次子代算 ⇒ 这条假绿通道只关了一部分（⇒ R4-06） |
| R3-04 | 已修 | **真修**。`chatpick/index.js` 走 `reasonText(created.reason)` |
| R3-05 | 已修 | **真修**。`goArchive` 有 tip 即 `return`，主按钮换字，不自动跳 |
| R3-06 | 已修 | **真修**。删掉那段 ⇒ 红（走 crash 路径，2 红 + 计数闸兜住） |
| R3-07 | 已修：替换 7 处 errorText + 9 处 banner | **虚报（部分）**。描述里**点名的两处原封未动**：`saveDrafts` 的 `this.setData({errorText})`、`applyParse` 多码路径的裸 `setData(patch)`（patch 含 banner）。git 比对：这两处在 `13f0294` 里就是这个形状，装配时一行没动 ⇒ 实为 banner 改了 8 处、errorText 漏 1 处（⇒ R4-02） |
| R3-08 | `createdId` 堵重复建档 | **真修（运行时证）**。stub 后连点 `onSave()` 三次 ⇒ 档案条数 `0→1→1`，第二次起只走 `jumpToArchive` |
| R3-09 | 两个都改成注入 ⇒ 已修 | **部分**。签名确实改了；但**调用侧 `readRoomHint()` 无参**，函数体回落 `getApp()` ⇒ 生产路径照旧直连隐式全局，AGENTS §11.1 只修了可测性、没修纪律（⇒ R4-04） |
| R3-10 | 3 处改名，全仓零命中 | **真修**（wxml/wxss 均指 `measureMid`；"零命中"这句措辞过头 ⇒ 见 §4②） |
| R3-11 | 保留但写清 | 成立（诚实边界注释在位）。**但它没进 `TECH_DEBT`**，报告却写"未修 2 条转挂账"（⇒ R4-D13） |
| R3-12 | 两个不导出 | **真修**（`parcel-drafts.js`） |
| R3-13 | 部分修（编码统一，路径分散挂 TD-013） | **真修且自述诚实**：`pickup-list`、`archive-list` 两处都 `encodeURIComponent` 了 |
| R3-14 | 已修 | **真修**（先清 `bindState:'idle'`） |
| R3-15 | toast + 删 `.btn-wait` | **代码真修，文档没跟**：wxss 已无 `.btn-wait`，但 `COMPONENTS.md` 的类名清单里还留着（⇒ R4-D06） |
| R3-16 | 不 revert，留痕 | 成立，纯文案 |

**核销小结**：真修 **11**（R3-01/04/05/06/08/10/11/12/13/14/15）｜部分或虚报 **3**（R3-03、R3-07、R3-09）｜虚报"改了 A 声称改了 B" **0**（但 R3-07/09 属"改了八成、报成十成"）｜**修复引入新问题 1**（R4-01）。

## 3. 代码侧新问题（R4-01~R4-06）

| # | 级别 | 位置 | 问题 | 后果（用户视角） |
| :- | :- | :- | :- | :- |
| **R4-01** | **P1** | `pages/recognize/index.js` `runRecognize` | 装配 r3 修复时把**早退那半行吃了**：原 `if (!this.hasFormContent()) { this.startRecognize(filePath); return; }` 被换成只剩条件 + 换行的 `wx.showModal(...)` ⇒ **if 体变成了弹窗** | 表单**有**内容时点任一取图按钮并选图 ⇒ 既不识别也不提示，**静默无反应**（`busy` 又被 `complete` 复位，看起来像"微信没理我"）；表单**空**时反倒每次都弹"换图会清掉现在填的内容"（与紧邻注释"空屏还问一次就是拿对话框拦路"正相反）。`git status` 全绿、`check.js` 34/0、`selftest` 278/0 —— **两道门禁同时看不见**（`selftest` 不 require 页面，与 r3 给 R3-01 写的是同一句话）。`git log -S hasFormContent` 定位到 `c3f2a48` |
| **R4-02** | P2 | r3 报告 R3-07 现状列 | **修复范围高报**（"9 处 banner / 7 处 errorText"，实为 8 与 6） | 读者照报告去找那两个收口点，会发现它们仍是原始形态；`SCOPE` 的 M14 结论被一个不存在的完成度撑着 |
| **R4-03** | P3 | `pages/recognize/index.js` 实例字段区 + 文件尾 | `midPending` 已成**死字段**（闸门搬进 `createLayoutMeter` 的 `inFlight` 后没人读），注释却仍写"measureMid 的在途闸门（R3-01）"；文件尾另多出 5 个空行 | 注释把一个已失效的状态说成活的 ⇒ 下轮会照它做判断 |
| **R4-04** | P2 | `pages/recognize/index.js` `onLoad` | **R3-09 高报**：调用侧无参，注入只在测试路径生效 | 生产路径照旧 `getApp()` 直连隐式全局（AGENTS §11.1），而报告说这条纪律已收口 |
| **R4-05** | P3 | `onRecognizeFailed` | 仍手写 `setData` + `measureMid`（行为等价） | 与同文件"别处不再手写 errorText/banner"的自述不符 ⇒ 同一件事两种写法，将来必分叉 |
| **R4-06** | P2 | `tools/check.js` 键名拼错判据 | `oneEditApart` **非真编辑距离** ⇒ 相邻转置（`chatTools`→`cahtTools`）**判绿** | 手打键名最常见的错法正是转置，而它恰好是"能力静默消失、本地完全看不出来"那一类 |

## 4. 文档侧新问题（R4-D01~R4-D13；审查者原编号 `A1~A13`）

| # | 原编号 | 级别 | 缺陷（`文档` vs `代码/事实`） |
| :- | :- | :- | :- |
| R4-D01 | A1 | P2 | **README 三处与实码矛盾**：说 `globalData.chatRoomId` "只有读取方、无写入方"，而 `chatpick/index.js` 就是唯一写入方（`ARCHITECTURE`/`APIS`/`COMPONENTS` 三处都已改口，只有 README 没跟）；门禁条数写"九条"（实为 10）；验收写"V1~V15 一条没点"（SCOPE 已有 V1~V18）；标题仍停在 23 卡。**方向是低估、不是冒充已验** ⇒ 不升 P1，但它是新读者的第一入口 |
| R4-D02 | A2 | P2 | **CHANGELOG 波 5 条目尾部整段重复**：531 个字符与上一条 r2 收口批逐字节相同 ⇒ r2 的七件事被算给波 5。同族第 N 次「插入串行」，而那把教训卡（`2026-09-19_插入时锚点行被吃掉.md`）刚写下"残行的特征正是同一条开头出现两次" |
| R4-D03 | A3 | P2 | **"数字改口径"只落实了一半**：STATE/CHANGELOG/APIS/TECH_DEBT 里仍有 8 处实测读数（门禁项数、断言条数、行数、"补 8 条断言"、Must 条数），与 `STATE` 自己那句"本文件不再抄读数"和教训卡直接冲突。**合法项已区分**：计划量（预估分母/暂停线，已自标）、`SCHEMA_VERSION`、存储键名、`EXPECTED_ASSERTIONS`（教训卡第 4 条明文豁免） |
| R4-D04 | A4 | P2 | **`SCOPE §8①` 与 §9 不自洽（高风险①的答案）**：§8① 的恢复条件只写"M13/M14 实现前不许恢复 ✓"，而 M13/M14 现已实现 ⇒ **单读 §8① 就可以恢复 ✓**；§9 的 S1/S3 与 STATE 写的却是"落地**且 V16/V17 通过**"。三处两个口径，**最松的那处正是被引用最多的那处** ⇒ 恢复条件没写死在一处 |
| R4-D05 | A5 | P3 | **`RESEARCH §6` 表头与 H2 粘连**：`## 6. ⛔ 未取证项…` 后面直接跟 `| # | 待证 | …` ⇒ 表格没有独立表头行，**STATE 指定的"开工门唯一清单"整张 U-1~U-6 表不渲染**。§6.1 本体（前置、每步看哪一行、不通退哪条路）**可执行**，缺陷只有 D11/D12 两条措辞 |
| R4-D06 | A6 | P3 | **文档有、代码无（registry 幽灵 class）**：`COMPONENTS.md` 类名清单含 `btn-wait`，而 `chatpick/index.wxss` 23 个类里没有它（R3-15 删的）。第 8 条判据只做 wxml↔wxss，**看不见 registry** ⇒ 这类幽灵 class 无机器闸 |
| R4-D07 | A7 | P3 | **同一元素登记两行**：`COMPONENTS.md` 的"清单快速入库入口"与"清单录入入口"除行名外逐字段相同（同口语指代、同类名、同一段备注）⇒ 订正必然分叉 |
| R4-D08 | A8 | P2 | **三处口径互斥：chat-tool 的出口数**。`APIS`、`ARCHITECTURE`（只列了 4 个、漏"没有那个键"）写"四种"，STATE 写"五种"，RESEARCH 写"四种"却在括号里列了五个 ⇒ 单源被复制成三个版本（高风险②的一部分） |
| R4-D09 | A9 | P3 | **selftest 拆分未回写**：`APIS`/`RESEARCH` 仍把 §10/§11 记在 `tools/selftest.js` 名下，实身在 `tools/selftest-wave5.js`；且 `ARCHITECTURE` 的落点表**没有这个新文件**（AGENTS §7：新建文件先查/登记落点表） |
| R4-D10 | A10 | P3 | **行号引用过期**：`COMPONENTS.md` 两处指旧行号（方法定义与 wxml/wxss 的对应行都漂了） |
| R4-D11 | A11 | P3 | **指向未导出符号**：`RESEARCH §6.1` 写"改的是 `migrate.CHAT_ROOM_ID_SHAPE`"，而它是 `migrate.js` 的**模块内常量、不在 `module.exports`**。作为"改哪一行"能用，作为 `migrate.X` 接口不成立 |
| R4-D12 | A12 | P2 | **验收环境自相矛盾（三条说法）**：`SCOPE` 把 V18 标"模拟器可"，但同表 V9 自己写"模拟器无端侧 OCR ⇒ 真机"；`RESEARCH` 小标题写"两条新验收（模拟器就能点）"下面列了三条、含 ⛔真机的 V17；STATE 是第三种说法。**后果具体**：R-01 那条唯一 P1 的回归钉（V18）因此被排在点不动的环境 ⇒ 25 卡会当场卡住 |
| R4-D13 | A13 | P3 | **TD 指向错**：TD-013 的来源栏把 ②（`check.js` 第 6 条跳过 `tools/`）记在 R3-15 名下（那条是"吞点击/对比度"，与此无关），实为 r3 报告 §3 末"门禁自身的边界"；且 R3-11 报称"转挂账"而债表当时**无对应条目** |

## 5. 三个高风险问题的独立答案（任务书指定必答）

- **① `SCOPE §8①` 那个 ✓ 该不该恢复？** ⇒ **不该**，但**理由是文档不自洽（R4-D04），不是"没实现"**：M13/M14 代码已实现，§8① 单读已经允许恢复 ✓，而 §9 与 STATE 要求 V16/V17 通过。必须先决定恢复条件以哪一处为准（本轮按"最严处为准"写死了 §8①）。
- **② registry 有没有把"代码就位"写成"能力已验"？** ⇒ **没有**。`APIS §2.3/§2.3b` 状态列明写"本列只说明代码存在，不等于能力已验"，K2 行也明写"不等于 K2 成立"，STATE 还有 ⛔ 挡着。**唯二失真在 README（D01）与出口数（D08），不在 APIS。**
- **③ 取证照点清单（`RESEARCH §6.1`）能不能被一个没读过代码的人照着跑完？** ⇒ **能**。步骤/判读/退路三样齐（U-1 三步、U-5 四个读数 + 第五种建档后读数、U-6 后台核对），前置 3 条也在。缺陷只有 D11/D12 两条措辞，不影响照点。

## 6. 七维逐条

① **装配** ✗ — 文档→代码断链 3 条（D06 幽灵 class、D01 README 说无写入方而代码有、D09 §10/§11 归错文件）；反向（代码有元素、文档没行）未发现。
② **逻辑** ✗ — R4-01（P1，条件吞早退）。
③ **牵连** ✗ — `measureLayout`/`isStationUnknown`/`applyMultiParse`/`noteForRoom` 代码侧零残留 ✓；`labelOf` 被 r3 误报（§4①）；selftest 拆文件未回写三份注册表（D09）；`form-parts.js` 拆分已正确反映在 `APIS §2.3b` ✓。
④ **性能** N/A — 本窗口只有 `setDataMeasured` 多一次 `measure()`，成本由在途闸门封顶（撤闸门立刻红 3，说明闸门是唯一防线且有效）。
⑤ **冗余** ✗ — R4-03（死字段 + 假注释 + 尾随空行）。
⑥ **规范** ✗ — D02/D03/D05/D07/D10（整段重复、实测数字回流、H2 粘连表格、registry 重复行、行号过期）；`ARCHITECTURE` 与 `AGENTS` 行数在上限内 ✓；所有 `tools/*.js`、`docs/*` 路径引用逐条验存在（无指向不存在的文件；D11 是"存在但未导出"）。
⑦ **安全/隐私** ✓ — `fingerprint`/`maskRoomIds` 两条脱敏变异均红；`roomId` 仍在页面实例字段、不进 `data`；`globalData.chatRoomId` 写入方唯一；分包页不碰 `wx.*Storage*`；零网络零密钥。

**越界检查** ✓ — `c3f2a48` 只落在 r3 清单涉及的文件 + 对应文档；`SCOPE §9` 覆盖全部新文件；Won't 项（左滑删除、归档分区、云端 OCR、群语义、图标资源、多图流水线）在 diff 中无实现体；未触碰 `../expresseage_college/`（v1 `git status` 空）。唯一超范围动作 = R3-16 措辞（已留痕）。宪法与 STATE 重大字段未擅改（`AGENTS §10` 那条只提请）。

## 7. 计数与色

**本报告逐项表为准：新问题 19 条 = P0 0 ｜ P1 1（R4-01）｜ P2 9（R4-02/04/06 + D01/02/03/04/08/12）｜ P3 9（R4-03/05 + D05/06/07/09/10/11/13）。**
> ⚠️ **口径说明**：审查者回执的计数段写的是"15 条 = P1 1 / P2 7 / P3 7"，但它自己的 B 表 5 条 + A 表 13 条 + 转置残留 1 条 = **19**，且它同一句里另写"A 侧 6 + B 侧 3"——三处对不上。**装配时以逐项表为准**（这是"自述数字与清单不符"的又一次实例，处理方式见新教训卡 `docs/lessons/2026-09-25_自述范围大于diff.md` 第 1 条：数量词必须能由一条命令复算）。
**报告自身失真**：r3 报告 4 条（订正已回写在 r3 报告新增的 §6，原行不删）+ r4 自己的计数段 1 条（本段）。
**建议色：🔴 红**（判据：P1 = 1，且**由上一轮修复窗口引入**；另 U-1/U-5/U-6 至今零真机读数，M2/M7 不能算验收）。**裁决权在人。**

## 8. 主 agent 处置（本轮修复批，逐条对账）

| # | 处置 | 证据（可复算） |
| :- | :- | :- |
| R4-01 | **已修**：恢复早退体 `{ this.startRecognize(filePath); return; }`，并把成因写进紧邻注释 | `grep -c "^    if (!hasFormContent" pages/recognize/index.js` ⇒ **1**（同一行的字符串在上一行的注释里也出现一次，所以判据锚定行首，别用裸字符串计数）｜ 新增 `check.js` 第 11 条"没有悬挂的 `if`"（**P-B 待批**，见 STATE 未决 12）：把这一行还原成坏形状 ⇒ **判红** |
| R4-02 / R4-04 / R4-05 | **已修**：`applyParse` 多码路径与 `saveDrafts` 的 `errorText` 改走 `setDataMeasured`；`onRecognizeFailed` 同；`readRoomHint` 调用点显式传 `{ app: getApp() }` | `grep -c setDataMeasured pages/recognize/index.js` ｜ `grep -n "readRoomHint({ app" pages/recognize/index.js` |
| R4-03 | **已修**：删死字段 `midPending`（含假注释）、删 `onUnload` 里对它的复位、删文件尾 5 个空行；注释改指 `createLayoutMeter` 的在途闸门 | `grep -c midPending pages/recognize/index.js` ⇒ **0** |
| R4-06 | **已修**：`check.js` 补 `swappedAdjacent`（相邻转置），拼错判定改成 `oneEditApart` **或** `swappedAdjacent` | 变异：`cahtTools` ⇒ 红；`chatTool` / `chatToolss` ⇒ 红；19 个合法少见键 ⇒ **不误报** |
| R4-D01 | **已修**：README 现状整段重写（写入方、门禁条数改口径、V1~V18、标题） | `grep -n "只有读取方" README.md` ⇒ 0 |
| R4-D02 | **已修**：删掉波 5 条目尾部重复的 531 字符 | `node` 逐字节比对重复 = false |
| R4-D03 | **已修**：状态类文档的实测读数换成取数命令（审查者点名的每一处逐条处理，**不在这里复述处数**——处数会随下一次提交过期） | `grep -n "断言 [0-9]* 条\|门禁 [0-9]* 项" STATE.md CHANGELOG.md docs/registry/APIS.md docs/registry/COMPONENTS.md docs/TECH_DEBT.md` ⇒ **0 命中**（"报告类快照"按教训卡豁免，不在此列） |
| R4-D04 | **已修**：**取消"两处各写一份条件"** —— `SCOPE §8①` 不再自带恢复条件，句末只留指针"…本行不另立口径"；条件本身只存在于 §9 的 S1/S3 两行（S3 写的是"M13/M14 落地 **且 V16/V17 通过**"，并注明 V16 模拟器、V17 ⛔ 真机） | `grep -n "本行不另立口径" docs/specs/20260923_chat_pick/SCOPE.md` ⇒ 只命中 §8① 那一行 ｜ `grep -c "V16" docs/specs/20260923_chat_pick/SCOPE.md` ⇒ 3（§9 两行 + 验收表 V16 行） |
| R4-D05 | **已修**：§6 标题与表格拆开（独立表头行） | 渲染检查：表头行单独成行 |
| R4-D06 / D07 | **已修**：`COMPONENTS.md` 删幽灵 `btn-wait`、合并重复的两行录入入口 | `grep -c "btn-wait" docs/registry/COMPONENTS.md` ⇒ **0**（全仓 `grep -rn btn-wait docs/` 仍会在 r3/r4 两份报告里命中，那是**描述缺陷的历史文本**，不算登记项）｜ `grep -c "清单快速入库入口\|清单录入入口" docs/registry/COMPONENTS.md` ⇒ 只剩一行 |
| R4-D08 | **已修**：状态类与架构类文档的出口数统一成"五种"，五种名字逐处列全（`ARCHITECTURE` 补上漏掉的"没有那个键"） | `grep -rn "四种出口" --include=*.md . \| grep -v "docs/reviews"` ⇒ **0 命中**（⚠️ 命令要排除 `docs/reviews/`：**本报告自己复述这条缺陷时必然再次写出那五个字**，不排除就是自我命中）｜ 反向取数：`grep -rn "有键但空" STATE.md CHANGELOG.md docs/ARCHITECTURE.md docs/specs/20260923_chat_pick/RESEARCH.md` ⇒ 四份文档都在（这一项是五种里最容易被漏掉的那个，用它当哨兵） |
| R4-D09 | **已修**：`APIS`/`RESEARCH` 的 §10/§11 改指 `tools/selftest-wave5.js`；`ARCHITECTURE` 落点表补这一行 | `grep -rn selftest-wave5 docs/` |
| R4-D10 | **已修**：`COMPONENTS.md` 两处行号引用改成"符号名 + 取数命令"（行号不再入表） | `grep -n "index.js:[0-9]" docs/registry/COMPONENTS.md` ⇒ 0 |
| R4-D11 | **已修**：`RESEARCH §6.1` 改写为"`utils/migrate.js` 里的 `CHAT_ROOM_ID_SHAPE` 常量（模块内、**没有导出**，改值不接口）" | 该行原文即证据 |
| R4-D12 | **已修**：V18 环境改成"⛔ 真机（要端侧识别）；**等价路径模拟器可**：手填 3 行草稿、故意一行不选取件点再点全部保存"；`RESEARCH` 小标题改"三条"并逐条标环境；STATE 同口径 | `grep -n "等价路径模拟器可" docs/specs/20260923_chat_pick/SCOPE.md` |
| R4-D13 | **已修**：TD-013 来源栏改指"r3 报告 §3 末（门禁自身的边界）"，并把 R3-11 写进同一来源栏 | `grep -n "R3-11" docs/TECH_DEBT.md` |

**没修的（登记，不静默）**：
- **P-B**（`check.js` 第 11 条"悬挂的 if"）是**新增判据**，等批；不批就删。它的**能力边界已写进 STATE 未决 12**：拦得住"这一行被改坏"，拦不住"条件本身写反"。
- **页面事件层零判据**这一层缺陷**没有被消掉**，只是被绕过去了（r3 R3-01 的成因是同一句话）。要真消掉得引入页面级测试框架 ⇒ 与"零依赖"决策卡冲突，本轮不做 ⇒ 挂 TD-014，25 卡的 V16~V18 是这一层唯一的实际防线。
- **registry 幽灵 class（D06 的根）** 只修了当轮那一条实例，**没加"registry ↔ wxss 对帐"判据**（要给 `check.js` 再加第 12 条，属新增判据，本轮不擅自加）⇒ 挂 TD-011 组。

## 8b. 修复批的变异复测（装配方 = 主 agent，2026-09-25，副本 `%TEMP%\r4fix_mut`，真仓库全程只读）

> 配方按 §1 那条坑订正过：排除项匹配**目录边界**（`/.git/`）而不是裸子串，且**注入前先取一次 CONTROL 基线**。基线不绿就不进入变异——这次基线 exit 0 / 35 项，才往下走。

| # | 注入 | 读数 | 结论 |
| :- | :- | :- | :- |
| CONTROL | 无（干净副本） | 35 项 / 0 失败 / exit 0 | 基线成立，下面两侧读数可比 |
| M1 | `app.json` 的 `chatTools` → `cahtTools`（**相邻转置**，正是 r4 报的 R4-06） | **exit 1**，34/1，报"顶层键拼错" | ✓ R4-06 的假绿通道已关 |
| M2 | `chatTools` → `chatToolss` | **exit 1**，34/1 | ✓ 原有判据没退化 |
| M3 | 同时加 4 个**合法**少见顶层键（`subpackages`/`permission`/`entryPagePath`/`resizable`） | **exit 0**，35/0 | ✓ 转置判据不带来误报（`subpackages` 与 `subPackages` 只差转置，正是最容易误杀的一对） |
| M4 | 把 `runRecognize` 那一行**还原成 R4-01 的坏形状**（删掉 `{ …; return; }`） | **exit 1**，报 `[FAIL] 悬挂的 if：pages/recognize/index.js:252 … 下一行 \`wx.showModal({\` 会变成它的体` | ✓ 第 11 条**认得**它要防的那个形状（P-B 待批） |
| M5 | 同一行**只把条件取反**（`!hasFormContent` → `hasFormContent`） | **exit 0**，35/0 | ⛔ **这是已声明的盲区，不是这次的漏网**：第 11 条查"这一行被改坏"，不查"条件写反"。页面事件层零判据 ⇒ 记进 STATE 未决 12 与 TD-014 |
| RESTORE | 全部还原后复跑 | exit 0，35/0 | 副本未污染真仓库 |

⚠️ **M4 的第一版读数为"作废"**：注入锚点用了 `'\n'`，而 `pages/recognize/index.js` 是 **CRLF** 文件 ⇒ `String.replace` 静默没命中，脚本自己报了"锚点没命中"。改成行级正则（只换行内容、不动行尾）后才拿到上面这条读数。**同族**：`2026-09-20_变异脚本静默空跑.md`（变异不红有两种含义：判据没牙 / 变异根本没进去）。

## 9. 本轮诚实边界（没做什么）

1. **没跑真机、没跑开发者工具** ⇒ `chatTools` 是否被平台接受、`getChatToolInfo` 的真实字段名、个人主体是否开放，**仍未判**（U-1/U-5/U-6 零读数）。
2. **没点检任何一条 V**（那是 25 卡的活）⇒ 本报告不构成验收，"已修"只表示静态层面与副本变异层面成立。
3. **上表的"证据"列是命令、不是读数**——按 2026-09-24 的口径，装配后我自己复算了每一条，但**没把复算结果写死在这里**（会过期）；下一名审查者照命令重跑即可。
4. 本轮**变异复测**在副本做（真仓库全程只读），复跑结果见 STATE"最近完成"那一条的取数命令。

**重审范围（如果还有 r5）**：`c3f2a48..HEAD` 这一批（r4 修复批）跑①②⑤⑥四维 + 逐条核销 R4-01~06 与 R4-D01~13 + **专查 §8 处置表有没有"改了八成报成十成"**（本轮新教训卡第 2 条：用漏检项收尾，不用完成项收尾）。

## 10. 裁决回写（2026-09-25 · 报告定稿之后发生，不改上面任何一节的判定）

用户裁决原文：**「按建议删掉 check.js 第 10、11 条」** ⇒ 两条候选判据 **P-A（`chatTools` 形态对帐）与 P-B（"没有悬挂的 `if`"）全部删除**，本报告里凡写"待批"的地方以此为最终结果。

**删除后的实测量级（副本 `%TEMP%\del_gates_mut`，先取 CONTROL 基线 exit 0 / 33 项）**

| 探针 | 注入 | 删除后的读数 | 说明 |
| :- | :- | :- | :- |
| CONTROL | 无 | exit 0，**33 项**（原 35，两条各占一项） | 基线成立 |
| M1 | `chatTools`→`cahtTools`（转置） | **exit 1**（32/1） | ✅ 保留的那条（顶层键拼错 + r4 补的转置）**没被牵连** |
| M3 | 把 R4-01 那一行还原成坏形状 | **exit 0**，且 `node --check` 同样 exit 0 | ⛔ §8 里那条"P-B 认得这个形状"的能力**随裁决一起没了**；R4-01 回到**零机器防线** ⇒ TD-014 ① |
| N1 | `chatTools[0].root` 指向不存在的包 | **exit 0** | ⛔ 无人看 ⇒ TD-014 ③ |
| N2 | `chatTools[0].entryPagePath` 写歪 | **exit 0** | ⛔ 无人看 |
| N3 | 分包带 `independent:true` | **exit 0** | ⛔ 方案 N3 的支点当场没了，且编译期不报错（真机点进那一页才白屏） |
| N4 | 分包带 `renderer:"skyline"` | **exit 0** | ⛔ 无人看 |
| —（对照） | `subPackages[0].root` 写歪 | **exit 1**：三件套报"页面缺文件 `chatpick-typo/index.*`" | ⚠️ **别误读成"还有闸"**：那是页面文件判据顺带撞上，不是 `chatTools` 对帐；`chatTools` 自己那一侧（N1~N4）全绿 |
| RESTORE | 全部还原 | exit 0，33 项 | 真仓库全程只读 |

**因此本报告下面这两处的最终结论要按此重读**：§8 处置表 R4-01 行里"新增第 11 条判据"这半句**已失效**（修复本身仍在，吃掉的早退体已恢复）；§7 建议色 🔴 的判据不受影响（P1 是行为缺陷，不是闸的有无）。
**放弃机器闸之后，防线只剩两条**：① **每批必须有 r 轮新鲜上下文复核装配 diff**（§9 已写成下一轮的第一份工作，也是本轮 P1 唯一的实际发现途径）；② 25 卡的 V16~V18 真机点检 + `RESEARCH §6.1` 照点清单——**U-1 是唯一会撞上 N1~N4 的环节**，所以取证不再是"可拖可拖的手续"，它是这四条配置错误的唯一探测器。
