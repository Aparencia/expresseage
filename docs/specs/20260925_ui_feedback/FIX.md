# FIX · 2026-09-25 真机反馈批（A~F 六项）

> 卡 31 产物 ｜ 根因见同目录 `RCA.md` ｜ 起点锚点 = `ee10dba1ddbb57caee6ae52d18e897cd50a7fd77`
> ⛔ 本批只做到"**代码就位 + 断言绿 + 变异证伪**"；真机复验清单见 §5（**没点过的一律不算验过**）

## 1. A：加"来源闸门"——会话键不再自动绑定（P1）

| 改动 | 落点 |
| :-- | :-- |
| 新纯函数 `resolveTarget(query, hitId)`：**只有显式 `customerId` 才落值**；`hitId` 一律不参与（`boundBySession` 恒 `false`） | `pages/recognize/form-parts.js` |
| 新纯函数 `sourceOf(query)`：`from=list` 才算清单入口 | 同上 |
| `preselectNote(..., source)`：**清单入口不显示会话命中文案**；命中文案改成"系统不会替你选 + 要按会话归类怎么走" | 同上 |
| 页面 `onLoad` 改用 `resolveTarget`；说明行的标签取**命中者自己**的标签 | `pages/recognize/index.js` |
| 清单页入口**不再携带 `customerId`**（M13 的"唯一客户带着走"被本次裁决取代，见 §4） | `pages/pickup-list/index.js` |

固定读数（`node -e` 实测）：`resolveTarget({from:'list'},'k1')` ⇒ `targetId:''`｜`resolveTarget({customerId:'c1'},'k1')` ⇒ `'c1'`。

## 2. B：零档案也能进录入页（P1）

- 新零件 `pages/pickup-list/list-parts.js`：`intakeTarget({hasCustomers})` ⇒ **只要读库成功就给 URL**（`hasCustomers:false` 同样放行）；读库失败（`null`）才不导航，且文案说"读不出来"而不是"还没有"。
- 入口 URL 带来源标记：`/pages/recognize/index?from=list`。
- 清单页空态文案同步改（不再叫人先绕去档案页建档）。
- ⚠️ 为什么新建文件：`selftest` 不 require 页面（TD-016）⇒ 这条判据必须住在可断言的地方（先例 `form-parts.js` / `sheet-flow.js`）。

## 3. C：站点回填加"第二道" + 把"没认出来"说出来（P2）

- 新纯函数 `stationPrefillFromTexts(texts)`：拿**整段识别原文**过 `stations.matchBuiltinStation`（包含且仅包含一个正式名才命中）⇒ 命中回填**规范名 + 「已命中内置站点」**；⛔ **命不中不返回原文**（原文是一整行 OCR，写进站点格是污染不是回填）。
- `fillFromParse(draft, found, texts)`：第一道（解析器给的正式名）优先；第二道只在站点格仍为空时参与；**站点格已有值 ⇒ 一律不覆盖**（"只往空框里填"的老纪律不许被破坏）。
- 新增 `stationMissed`：**认出了码/柜号却没认出站点 ⇒ 必答**（banner 明确说"站点没认出来 + 怎么手填或点选"，并自动展开"识别原文"卡 —— 那也正是将来扩规则要的真机样本出处）。
- ⚠️ 诚实边界：解析器规则表**仍是转录样本长出来的**（TD-023 已登记，扩规则要真机 OCR 原文）。

## 4. D：回收站两步按钮 + 全部彻底删除（P2）

- 存储层新增 `storage.purgeAllDeleted()`：只处理**已软删**档案；真删它们**名下全部快件**（保持 `migrate.validate` 不出现 `PARCEL_CUSTOMER_MISSING` 悬空引用）。
- `pages/archive-list/recycle.js`：`purgeButtonText(armed)`（`彻底删除` → `确认：不可逆删除`）、`purgeAllButtonText(armed,count)`、`purgeAllQuestion(rows)`（摊开"几位 / 名下共几件 / 不可逆 / 没有备份"）、`purgeTotals(rows)`；**撤掉逐字确认词**（`PURGE_CONFIRM_WORD` / `purgeConfirmed` 一并删除 —— 用户裁决"第二次确认由按钮承担"）。
- 页面（`row-actions.js` + `index.wxml`）：逐条与"全部"都是**同颗按钮点两下**（第一下 arm 摊开后果，第二下才真删）；一次只 arm 一个。
- ⛔ 红线：删除动作只由用户点击触发；agent 不执行任何删除（AGENTS §4）。

## 5. E：主行与页头接上单源标签（P3）

- `sheet-flow.toRowViews` 新增 `label`（= `aggregate.customerLabel`）与 `subName`（派生名时**为空**，避免同一串字出现两遍）。
- 档案行主行改 `{{item.label}}`、副行改 `{{item.subName}}`；详情页页头改 `{{header}}`（`aggregate.customerLabel(form)`，编辑时同步）。
- 实测：`{D4,555,'D4 555 A'}` ⇒ 主行 `D4 555 A`、副行空；`{D4,522,'小王'}` ⇒ 主行 `D4 522 小王`、副行 `小王`。

## 6. F：口径降级（不改代码）

`STATE.md` 与 `docs/specs/20260923_chat_pick/DESIGN.md` 记录：主路径 = 手动/内联建档 + 本地摘要键；聊天工具链（`openChatTool` / url 轮盘 / 分包页 U 读数）为**可选增强**，不阻塞验收。

## 7. 读数（本批必跑）

| 读数 | 结果 |
| :-- | :-- |
| `node tools/check.js` | 通过 44 项、失败 0、警告 0 |
| `node tools/selftest.js` | **547/547**（517 → +30） |
| `powershell -File check.ps1` | 退出码 0 |
| 四条变异（副本内，注入前盘上核实） | **全红**：M1 恢复会话绑定 ⇒ A①/A③ 红；M2 零档案拦回入口 ⇒ B① 红；M3 站点命中不回填 ⇒ C①/C② 红；M4 全部删除连未软删一起删 ⇒ 7 条红（含"未软删的那位一个字都没被碰"） |

## 8. 真机复验清单（⛔ 只有用户点过才算验过）

1. **A**：从**取件清单**「＋ 录快件」⇒ 「给谁录」应为**空**、且**没有**那句会话命中说明；手选一位后**不被覆写**；从**档案行**「＋ 录快件」进 ⇒ 直接是那一行那位。
2. **B**：把库里客户全删（或新装）⇒ 点「＋ 录快件」**能进录入页**，且在录入页能当场建客户、建完自动选中、已填内容不丢、能保存。
3. **C**：选一张能识别出站点的图 ⇒ 站点格应出现**规范名 + 「已命中内置站点」**；再选一张认不出的 ⇒ 站点格为空但 banner **明确说"站点没认出来"** 并展开识别原文（把这屏截图发回 ⇒ 我们据此扩规则）。
4. **D**：回收站里点「彻底删除」⇒ 按钮**换字**并摊开后果，**再点一下**才真删；「全部彻底删除」⇒ 同样两步，文案里有"几位 / 共几件 / 不可逆 / 没有备份"。
5. **E**：档案列表主行应显示 `D4 555 A` 这类**带后缀**的标签；详情页页头同样。

## 9. 未做 / 未验（诚实边界）

- ⛔ **真机全零**：以上五条全是"代码就位 + 断言绿 + 变异证伪"，按 AGENTS §1 **不算通**。
- **解析器规则未扩**：C 只加了第二道回填与"没认出来"的提示，**没有**动 `STATION_RULES`（要真机样本，TD-023）。
- **wxml 层无机器闸**：「零档案时那颗内联新建按钮是否渲染」属页面层（TD-016 同族），本批只把**入口判据**搬进零件（B①）。
- **CHANGELOG 未回写**：本批写盘范围不含 `CHANGELOG.md`（派单明令），留待收口批统一补。
