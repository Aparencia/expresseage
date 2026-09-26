# RCA · 从取件清单建档时会话键丢失（BUG-会话键）

> 触发：用户真机反馈「**修复在取件清单进行建档时，没有会话键的bug**」｜走 30→31 卡｜起点锚点 `48a2bb7`
> ⚠️ 本文只写**证据与结论**；修复见同目录 `RCA_sessionkey.md` §5（同一批的第二个提交）。

---

## 1. 诊断四问

| 问 | 答 |
| :-- | :-- |
| **预期行为** | 从**取件清单**进「录快件」→ 填件 → 保存时归不上客户 ⇒ 当场建档 ⇒ 新档案**带上当前会话键**（`Customer.chatRoomId` = 16 位本地摘要），此后按会话归类/预选能命中它 |
| **实际行为** | 新档案 `chatRoomId` = **`''`**（键没绑上、也没人告诉用户为什么） |
| **报错原文** | **无报错**。这是**静默降级**：建档成功、件也存进了库，只是键为空 |
| **最近一次改动** | 建档绑键的代码自 `e61c388`（范围扩展批）起就是"有则绑、无则为空"，**此后未变**；`pages/recognize/**` 在 2026-09-25 被连续改过三轮（B 条入口两次修复 / 交互改判"保存时裁决" / 「未归类」占位）—— 但都不涉及取键 |

## 2. 复现（卡 30 动作 1：**不做"从代码推断已复现"**）

真机复现只能由用户做；本轮的**同屏等价复现**用**真实零件 + stub storage**（探针脚本见 §6 取数命令），读数如下（原样粘贴）：

```
=== 场景 A：摘要槽有键（用户先在档案页做过会话选择）===
  [A1] readRoomHint(页面注入给建档的 sessionKey) = "78de35a10e586ed5"
       建档 ok = true ｜ 新档案 chatRoomId = "78de35a10e586ed5"     ← 绑定链是好的
=== 场景 B：两个槽都空（冷启动 / 从没做过会话选择 / 清单入口常态）===
  [B1] readRoomHint = ""  ⇒ 新档案 chatRoomId = ""                  ← 用户看到的那种结果
=== 场景 C：只有平台原值槽（N2 老路写的兼容值）===
  [C1] readRoomHint = "open_single_roomid_raw" ⇒ chatRoomId = 同串  ← 见 §4 附带缺陷
=== 场景 D：键存在时，清单入口的 onLoad/onSave 会不会把它用掉或清掉？===
  onLoad: roomId="78de35a10e586ed5" hitId="" targetId=""（清单入口不落值，符合 A 条裁决）
  onSave: gate.mode="need-create" reason="NO_HIT"
  保存后槽还在吗 = "78de35a10e586ed5"                              ← 槽没被清单动线清掉
```

⇒ **A1 证明"绑定链本身是好的"**：只要注入的键非空，建档就会绑上。
⇒ 所以丢键**不在建档那一步**，而在**上游的"键从哪来"**。

## 3. 根因（五问法，逐层到底）

1. **为什么新档案没有键？** → `submitCreateCustomer` 收到的 `sessionKey` 是空串 ⇒ `createCustomerDraft` 落 `chatRoomId: ''`（`pages/recognize/intake-parts.js` 的 `chatRoomId: typeof sessionKey === 'string' ? sessionKey : ''`）。
2. **为什么 `sessionKey` 是空？** → 页面注入的 `readRoomHint({app: getApp()})` 返回空 ⇒ `app.globalData.chatKey` 是空（B1 复现）。
3. **为什么摘要槽是空？** → **全仓只有一处写它**：`pages/archive-list/index.js:195`（`app.globalData.chatKey = folded.key;`），且只在"**从档案页发起会话选择 → 分包页 `chatpick/` 写内存桥 → 档案页消费桥 → `chatTool.pairKeyOf` 折成摘要**"这条链成功后才写。
4. **为什么清单入口写不到它？** → **清单入口结构上没有获取键的动线**：`pages/pickup-list/list-parts.js` 的 `intakeUrl()` 只带 `from=list` 跳 `/pages/recognize/index`；录入页**只读**两个内存槽（`readRoomHint`/`readRoomHintKind`），全页**没有任何发起会话选择的调用**（`startChatPick` 只在档案页与分包页出现）。
5. **为什么做成"只有档案页能取"？** → 键的获取=**聊天工具模式**（`wx.openChatTool` → 独立分包 `chatpick/` 取 `selectGroupMembers` 明文 id），而分包页的返回落点是**写死的** `switchTab` 到档案格（`chatpick/` 属独立分包、require 不到主包，判读与折键必须在主包做）。⇒ **"键的获取"被设计成档案页那条动线独占**，录入页（清单动线）拿不到能力，不是漏写一行。
6. **更深一层（真正的根因）** → **"键的获取"与"键的使用"分在两条动线上，而清单入口只有使用方、没有获取方**；且摘要槽**只活在内存**（`app.js:26`，`onLaunch` 不落盘）⇒ **冷启动 / 重进小程序就没了**。于是"从清单建档带键"在**当前结构下恒不成立**，与用户是否操作正确无关。

## 4. 附带缺陷（同族，本轮一并修）

`pages/recognize/index.js` 建档处的注释写着「⛔ 只取**摘要槽**（`chatKey`）」，但代码用的是 `readRoomHint` —— 它**带平台原值回落**（C1 实测把 `open_single_roomid_raw` 原样绑进了新档案）。
后果：分类比对（`intake-parts.keyHits` / `aggregate.pickCustomerByRoom`）比的是**摘要** ⇒ 绑了原值的档案是**假键**："看起来有键，却永远匹配不上任何会话"。**空键**至少会被 `resolveSaveTarget` 判成 `NO_KEY` 而当场建档；**假键是静默不生效**，比空键更坏 —— 且它正是"建档时像没有键"的一种形态。

## 5. 修复

**已修（本批，最小改动）**：
1. 新增摘要槽**专用读取器** `form-parts.readSessionKey(deps)`（只认 `chatKey`，⛔ 不回落原值槽；非字符串⇒空串），建档处改用它 ⇒ 代码与注释/设计对齐，**假键不再产生**；归类比对仍用 `readRoomHint`（原值仅兼容，用户裁决②）——两条路口径**刻意不同**，由断言反向守门。
2. `submitCreateCustomer` 回传 **`keyBound`**（由**真实落库值**推出，不是由入参类型猜），`createSubmitPatch` 把"**已绑上会话键 / 这条没带会话键（去哪补）**"写进状态行、键缺失时退屏那句也多提醒一句 ⇒ "没带上键"从**静默降级**变成**上屏事实**（文案单源在零件里）。
3. 断言 11 条（`tools/selftest-wave6.js §16`：摘要槽专用口径 / 有键则绑 / 原值不绑 / 无键照常建档 / 键不是摆设 / 两句文案单源 / 源码级取键口径），三条变异全红。

**未修（属设计，须人裁 —— 候选与取舍）**：

| 候选 | 做法 | 取舍 |
| :-- | :-- | :-- |
| **A. 给清单动线一个"取键"入口** | 录入页发起 `startChatPick`（复用档案页同一套 url 轮盘），并把分包页的返回落点参数化（现在写死回档案格 → 需要改 `chatpick/` 的跨包契约） | 真正满足用户构想；但**平台层大概率不成立**：`selectGroupMembers` 要在聊天工具模式下才给明文，从常驻 tabBar 发起很可能与 url 轮盘同样失败（U-11 至今未验）；且跨包契约改动大 ⇒ 需先取真机读数 |
| **B. 让键跨冷启动存活（落盘）** | 摘要写进本地存储（新字段/新键） | 一处改动即可让"曾取到的键"在清单建档时仍在；但**是数据形态变更（须人批）**，且**陈旧键**会把新档案绑到一次早已结束的会话 ⇒ 需配"带时间戳 + 过期"的口径 |
| **C. 维持现状 + 说清** | 不改获取机制，只把"键从哪来"说清（本批已做） | 零风险、零平台依赖；代价：用户必须先去档案页做一次会话选择 |

## 6. 影响面与取数命令

- 影响：**取件清单入口的"建档带键"整条路径**（`pages/pickup-list/list-parts.js` → `pages/recognize/**` 保存/建档）；连带"按会话键归类"在清单动线**恒不触发**（`resolveSaveTarget` 只会判 `NO_KEY`）。
- 分级：**P1**（用户点名的核心动线不可用；且附带缺陷会造成"假键"静默失效）。依据：卡 30 动作 4 的 P1 = 核心功能不可用。
- 复现探针（只读零件 + stub，不写库）：`node <探针>` → 本轮读数见 §2（脚本落在仓库外 `_tmp_bug30/probe.js`，不入库）。
- 键的唯一写入方（取数）：`Select-String -Path pages\*.js,pages\*\*.js -Pattern 'globalData\.chatKey'` ⇒ 只有 `pages/archive-list/index.js:195` 一处写。
- 断言落点：`node tools/selftest.js` §16。
