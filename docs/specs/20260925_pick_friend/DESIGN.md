# DESIGN · 建档入口改判「主包选好友 + 本地摘要键」（规格目录 `20260925_pick_friend`）

> 上游：`RESEARCH.md`（§2/§2.1/§2.2）｜`SCOPE.md`（Must 10 / Won't 7 / 验收 V1~V8，用户已绿）
> 档位 **L**（用户确认）｜本卡产物 = 本文 + `DATA_DICT/APIS/COMPONENTS` 三张 diff（随 23 卡随批提交）
> ⛔ 不动表结构、不执行 SQL/迁移（不可委托清单）；设计获批准才进 23。

## §1 动线状态机（一次选择、两跳）

```
① 档案页点 fab「＋ 新建」
② 主包调 chatTool.startChatPick({wxApi})  → wx.openChatTool({ url: 'chatpick/index' })   ← 不传 roomid（官方 §2.1 方式 1）
③ 平台拉起会话列表 → 用户选 → 进入「聊天工具模式」并打开 chatpick
④ chatpick 调 wx.selectGroupMembers({ maxSelectCount: 1 })
     · 单聊 ⇒ 直接返回双方 group_openid（明文 members[]，不弹选择器）
     · 群聊 ⇒ 本期不支持，直接走降级（SCOPE W1/W5）
⑤ chatpick 把 members 原样放内存桥 app.globalData.chatToolPickup.members，再 wx.switchTab 回档案格
⑥ 档案页 onShow → consumePickup() → 主包算键 chatTool.pairKeyOf(members) → storage.findCustomerByChatKey(key)
     命中 ⇒ 提示「这条会话已建档：<楼区 宿舍 称呼>」，不新建（V4）
     未命中 ⇒ 自动开浮层（带键；顶部状态行 + 指纹行）→ 保存 createCustomer({ chatRoomId: key })
```

**降级矩阵（四路都不阻断建档，SCOPE M6）**：接口不存在 / 用户在会话列表取消 / 非单聊 / members 取不到 ⇒ 一律回到"手填建档"（无键），状态行说明原因并给「重新选择聊天好友」。

**规则单源**：`selectGroupMembers` 只在 `chatpick/` 调；**摘要只在主包算**（分包页引不到主包 ⇒ 分包只转发原样数组，与既有"三态判读在主包"同构）；分包页仍然 **零跨包 `require`**（既有断言不许破）。

## §2 数据设计（DATA_DICT diff；敏感度逐行标）

| 表 | 字段 | 类型 | 校验 | 敏感度 |
| :-- | :-- | :-- | :-- | :-- |
| `ex_college_v2.store` | （无新增键/无新字段） | — | 沿用 | — |
| Customer | `chatRoomId` | string | **语义变更**：平台原值 → **本地摘要键**；类型/长度/字符集**一律不变**（≤64、`^[A-Za-z0-9_-]+$`、`migrate.isChatRoomId` 规则不动） | **D3（保守保留）** |
| 内存槽（不落库） | `globalData.chatToolPickup.members` | `string[]` | 由分包页写入、**消费一次即清**；上屏前一律过 `maskRoomIds` / 只出指纹 | D3 |

**键格式（单源）**：`chatTool.pairKeyOf(members)` → **16 位小写 hex**＝两个 32 位哈希（FNV-1a32 与 djb2）拼接；**无序对**（先对 members 排序再拼串）⇒ 与用户先点谁无关。

- 为什么不做成"原值拼接"：两段 id 合计可能 >64 且字符集不保证 ⇒ 要么改字段约束（🔴 红线）要么截断（碰撞）——两者都否（SCOPE §5-Q1 已裁）。
- 为什么不用 crypto：小程序端无 Node `crypto`、项目零依赖 ⇒ 用两个不同族的 32 位散列拼 64 位，抗**偶然碰撞**足够（本项目量级 = 数百好友，生日界 ~1e-14），且**不是**抗攻击场景。
- **碰撞兜底（不靠概率靠人）**：查重命中时提示里**同时显示已有档案的锚**（楼区 宿舍 称呼）⇒ 若其实是两个人，人当场能看出来（V4 的提示行因此是本设计的碰撞探测器）。
- ⛔ **不收紧形态闸**：`isChatRoomId` 保持宽口径。证据：`tools/selftest.js` 有 7 处内存夹具写着 `'roomBBB'` / `'boundRoom1'` 这类值；且收紧后**旧库**里不合新形态的值会在读盘 `validate` 时把整库判死。

## §3 接口契约（APIS diff；每行含错误码与鉴权）

| 路径（本项目＝模块函数） | 方法 | 用途 | 错误码 | 鉴权 |
| :-- | :-- | :-- | :-- | :-- |
| `chatTool.startChatPick(deps)` | 新导出 | 发起"选择聊天好友"（主包调 `wx.openChatTool`，依赖注入 `{wxApi, url}`） | `CHAT_OPEN_FAILED`（无接口/平台拒绝/异常）`CHAT_OPEN_CANCELLED`（用户在会话列表取消） | 无（本机） |
| `chatTool.readPairMembers(res)` | 新导出（纯函数） | 从 `selectGroupMembers` 原样返回里取 `members` 并做形态闸 | `CHAT_MEMBERS_FAILED`（非数组/长度≠2/非字符串）`CHAT_NOT_SINGLE_CHAT`（返回不是单聊双方） | 无 |
| `chatTool.pairKeyOf(members)` | 新导出（纯函数） | 无序对 → 16 hex 摘要键（**唯一生成器**） | `BAD_MEMBERS`（入参不合法，内部码，不上屏） | 无 |
| `storage.findCustomerByChatKey(key)` | 新导出 | 按键查档案（排除软删） | 同 `loadStore` 码 | 无 |
| `storage.rebindCustomerChatKey(id, key)` | 新导出 | 把新键挂到已有档案（**单一用途写入口**，不解禁 `updateCustomer`） | `NOT_FOUND`、`REBIND_CONFLICT`（该键已被另一条档案持有）、`VALIDATION_FAILED` | 无 |

最小 JSON（示例，≤4 行）：
```json
// startChatPick 成功 / 取消
{"ok":true} | {"ok":false,"reason":"CHAT_OPEN_CANCELLED"}
// readPairMembers + pairKeyOf
{"ok":true,"members":["id1","id2"]} → {"ok":true,"key":"a3f1b2c3d4e5f607"}
// findCustomerByChatKey / rebindCustomerChatKey
{"ok":true,"customer":{"id":"c17..","building":"D4","dorm":"522"}} | {"ok":false,"reason":"REBIND_CONFLICT"}
```
**新错误码 6 个**（须三步走：先登记 `APIS.md` → 再补 `utils/reason.js` 文案 → 最后写代码；并同步 `tools/selftest.js:346` 的 `CONTRACT_CODES`，否则第 3 条门禁判红）：`CHAT_OPEN_FAILED`、`CHAT_OPEN_CANCELLED`、`CHAT_MEMBERS_FAILED`、`CHAT_NOT_SINGLE_CHAT`、`REBIND_CONFLICT`、`BAD_MEMBERS`。
**文案回写**：`utils/reason.js:90` 的 `chatRoomId: '聊天会话标识'` 改为指"会话键（本地摘要）"口径。

## §4 组件影响（COMPONENTS diff）

| 页面 | 界面元素 | 人话标识 | 文件 | 影响面 |
| :-- | :-- | :-- | :-- | :-- |
| 用户档案页 | `fab`「＋ 新建」（改行为） | "右下角加号" | `pages/archive-list/index.js` | 由"直接开浮层"改为"先选好友；选不回来照旧手填" |
| 用户档案页 | 会话状态行 `sheet-chat`（既有类扩展） | "它去拉好友列表了" | 同上 + `.wxml/.wxss` | 四态：选择中 / 已绑定（指纹）/ 未取到（原因）/ 平台无此能力 |
| 用户档案页 | 「重新选择聊天好友」`sheet-chat-retry`（**待建行**） | "再选一次" | 同上 | 失败与已绑定都可点 |
| 用户档案页 | 查重提示 `sheet-dup`（**待建行**） | "这个人建过了" | 同上 | 同键命中时出现，带已有档案锚 + "去这条档案" |
| 用户档案页 | 重锚入口 `sheet-rebind`（**待建行**） | "换绑一下" | 同上 | 键变更时把新键挂回原档案 |
| 分包页 | 取键读数行 `state`（内容扩展） | "取到没" | `chatpick/index.js/.wxml` | U-11 仪器：成功（2 个 id + 指纹）/ 无此接口 / 非单聊 |
| 入库/契约 | `createCustomer` / `findCustomerByChatKey` / `rebindCustomerChatKey` | —（无屏上元素） | `utils/storage.js` | 建档口仍是同一个；新增两个查询/重锚口 |

## §5 迁移与破坏性分级

- **迁移三件套：N/A** —— 证据：v2 **没有 `migrations/` 目录**（那是 v1 的），本设计无建表/改列/加约束（§2 逐行确认）。
- **四证④（down 人空跑）：N/A** —— 无 down 可跑；同族先例 = `chat_pick` 的 DESIGN §7「四证④ 本期 N/A」已获用户批准。⛔ **不冒充"已通过"**。
- **破坏性分级：🟢 L1（纯追加）** —— 新增函数/文案/元素；复用既有字段与形态闸；不升 `SCHEMA_VERSION`、不写迁移、不动 `chatTools` 四项渲染栈。

## §6 与 `chat_pick`（并行任务）的取代关系

| chat_pick 的项 | 本任务处理 |
| :-- | :-- |
| M2 / V6 的"动线"（分包页 → 手动点「去建档」→ 档案格） | **被取代**：改由 `fab` 发起 + 自动回 + 浮层自动带键（旧入口保留，见 W6） |
| M7 / V7（录入页按会话预选） | **保留**，但比对对象从"平台原值"变成**本地摘要键**（同一份 `aggregate.pickCustomerByRoom` 逻辑不变） |
| U-9（`switchTab`） | 结论沿用（官方已闭合），本任务只做真机确认 |
| chat_pick 的 25 卡验收清单 | **不由本任务改**（SCOPE W5）；本任务完成后在它那张卡里按取代关系订正 |

## §7 测试与门禁设计（23 卡要落地的断言）

新增 `selftest` 断言（≥8）：① `pairKeyOf` 与顺序无关 ② 同一对恒定 ③ 不同对不相同（含一组已知向量）④ 键形态＝16 hex ⑤ `findCustomerByChatKey` 命中/未命中/软删排除 ⑥ `rebindCustomerChatKey` 成功/`REBIND_CONFLICT`/`NOT_FOUND` ⑦ 无键仍能建档（降级不许退化）⑧ 同键第二次选择不产生第二条档案。`EXPECTED_ASSERTIONS` 同步。
**变异证伪计划**：M1 打乱输入顺序 ⇒ 应**仍绿**（无序对的性质，绿是预期）；M2 改散列常数 ⇒ 已知向量**判红**；M3 关掉查重 ⇒ 同键建档断言**判红**。
**门禁**：`check.ps1` 退出码 0；`tools/check.js` 既有判据自然覆盖新文件（**不新增判据**——避免"把未取证假设写成规则"，教训卡 `2026-09-25_判据不许编码未取证假设.md`）。

## §8 设计通过四证自检

① DATA_DICT diff 每行标了敏感度 ✓｜② APIS 每行含错误码与鉴权 ✓｜③ 组件影响清单已列出（含 3 处"待建行"）✓｜④ down 人空跑 = **N/A**（§5 已说明，不冒充通过）⇒ 待用户在设计批准时一并裁决 N/A。

## §9 预估与 23 卡分批建议

预估 **≈600 行**（暂停线 ×1.5 = 900）。批次：**批 1** = 取键（`chatpick` 探针 + `readPairMembers/pairKeyOf` + 断言，含 U-11 仪器）；**批 2** = 入口状态机 + 查重（`fab`/浮层/`startChatPick`/`findCustomerByChatKey`）；**批 3** = 重锚（`rebindCustomerChatKey` + UI）；**批 4** = 回写（三张 registry diff + `reason.js` + `CONTRACT_CODES` + STATE/CHANGELOG）。批 1 与批 2 必须**先跑真机**（U-2 / U-11）再合入可用路径。

## §10 实现期补充与待裁（批 1/批 2 落地后追加，2026-09-25）

**已落地（可回退）**
- 批 1 `96d8df8`：`readPairMembers` / `pairKeyOf`（16 位 hex、无序对、单一生成器）+ 分包页 U-11 仪器（**与 `getChatToolInfo` 通道互相独立**，两行读数分别截图）+ 12 条断言 + registry 回写。
- 批 2 `86732d3`：`chatTool.startChatPick`（不传 roomid；`isCancel` 单源；看门狗与既有口径同一条）｜`storage.findCustomerByChatKey`（只读、空键不是错误、**排除软删**）｜`fab` 先拉起选好友、**失败/取消一律降级**为照旧手填｜`consumePickup` 拆成 `applySessionKey` / `applyLegacyRoomId`｜查重挡板 + `onGoDup` / `onForceNew` / `onChatRetry`｜断言 300 → **318**（`check.js` 33 项 0 失败、`check.ps1` 退出码 0）。键仍只走**页面实例字段**。

**实现期口径 ①（采用，用户可否决）**：命中已有档案后点「仍要新建」时，**新档案不带键**（键留在原档案）。
理由：键必须保持"**一个键最多一条档案**"这条不变量，否则 `findCustomerByChatKey` 会多命中、归类当场二义，V4 也就不可判。副作用（已知并接受）：那条新档案失去自动归类能力，要靠手选。

**待裁 ②（已裁 = A，2026-09-25 用户原文「A（默认，已实现）：双语义共存」）**：`Customer.chatRoomId` **继续单一字段承载两种语义**（写入序 `chatKey ‖ 平台原值 ‖ ''`）——
- 选项 A（**已采纳**）：并存。旧路径（`chat_pick` 的 `chatRoomId` 明文）仍可落库 ⇒ 录入页"按会话预选"（M7）照旧可用；代价是同一字段两种含义（已知并接受）。
- 选项 B（未采纳）：字段只允许存摘要键 ⇒ 语义单源，但 M7 预选必须改成比摘要键（要能拿到同一对 id），可用面收窄、还要改 `chat_pick` 的 25 卡验收口径。

**记账（已完成）**：`storage.js` 522 → 541 行（`findCustomerByChatKey` 落在既有文件、不新增写盘口）⇒ **增量记入 TD-001**；页面层"查重挡板零断言"（变异 `if(false)` 仍全绿）⇒ 立 **TD-016**（= TD-014 ① 的第二个实例）。

**批 3（`b61fe2d`，2026-09-25）**：`storage.rebindCustomerChatKey`（NOT_FOUND **含软删**｜冲突时**一个字节都不改**并带回 `holder` 摘要｜自己重绑自己 ⇒ 幂等 `unchanged` 且不写盘｜`''` ⇒ 解绑｜形态闸复用 `migrate.isChatRoomId`）｜行内「换绑」（新容器类 `row-acts`）｜`startPick` 抽成"＋新建"与"换绑"共用（含重入闸，连点第二下不回调）｜`applyRebind` 三态落点；本批门禁读数**实跑但不抄条数**（`node tools/check.js` / `node tools/selftest.js` / `powershell -File check.ps1` —— 报告 R-13/R-19 两次抓到散文里的数字漂了，本文件不再抄）。页面当时 482 非空行 ⇒ 未拆零件，**后由修复批按 R-11 拆出 `pages/archive-list/sheet-flow.js`**（见本节的修复批记录）。

**批 3 的四条实现期口径（Lead 已核销，可否决）**
1. **软删档案也算键持有者**（冲突判定的 filter 不过滤 `deletedAt`）：否则"被删掉的人"手里的键可以转给活人，他一恢复就出现两条同键档案。与存储层既有口径"软删档案也算存在"一致 ⇒ **采用**。
2. **幂等优先于冲突**：自己已持有该键 ⇒ 直接 `unchanged` 早退（不写盘、不算冲突）。⇒ 副作用（已如实记录）：这条幂等由**早退分支**保证，删掉它就只剩"不报冲突却照样写盘"
3. `APIS.md §2.3` 被批 1/批 2 的空行切成三段 ⇒ 本轮接回一张连续表。**留**：这是修我们自己造的缺陷（文件在本批回写范围内），实测 12 行连续、唯一空行在表后。
4. `storage.js` **不在批 4 拆**：拆分属重构，须专门立项（AGENTS §2.4 / TD-001）；增量 541 → **606** 已记 TD-001。

**Lead 收口（2026-09-25，批 3 之后）—— 含一条自我纠错**：我先前写"`data.rebindTarget` 是死字段"是**误判**：`data` 在本页 73 行就闭合了，`chatRoomId` / `picking` / `rebindTarget` 都是**页面实例属性**（块首注释明写"刻意都不进 `data`"）。据此误判，`6602d20` 还**误删了 `chatKey: ''` 这条合法声明**（功能无害——代码先赋值后使用——但丢了显式声明）⇒ **本批已恢复**，并在原位写了自纠注释；`rebindTarget: null` 保留（合法实例字段）。判定依据已换成"看花括号闭合"，方法与教训见教训卡 `2026-09-25_grep行号不等于代码结构.md`。

**r2 修复批（2026-09-25；24 卡 r2 = 🟡 黄 / P0 0 / P1 0 / 新 P2 3 / P3 6 之后）**：
① **R-14**：两条上屏路的证据文本**共用同一份脱敏器** `sheetFlow.redactEvidence`（已知候选 → 指纹；漏网的 → 按形状隐去；**脱敏器不可用 ⇒ 原文一个字都不上屏**）—— 原先老路在 `roomId === ''` 时 `maskRoomIds` 是恒等函数，平台原文里的会话标识会**原样上屏**；
② **R-16**：平台原值与会话键**同一条生命周期**（`abandonKey()` 一并清 `this.chatRoomId`；页面层没有断言能力 ⇒ 用 §11b-5b 的**源码扫描**把这条不变量钉住）；
③ **R-03 的判据搬进零件**（`sheetFlow.pickupPathOf`，页面只调它）；
④ **两组"判据没牙"补牙**：r2 的变异 M4（判据改回"键存在"）与 M5b（摘掉老路三处 `maskRoomIds`）本批之后**判红**；
⑤ **R-15**：`sheet-flow.js` 的 11 个导出登记进 `APIS §2.3b`（含调用方与断言落点）；
⑥ **R-13/R-19**：STATE/DESIGN/TD-001 里的实测数字改成**取数命令**（不再抄）；
⑦ **R-17** 挂 TD-019；新增 **TD-021**（`runFormPartsSection` 146 行，旧节，未顺手改）。断言条数取数：`node tools/selftest.js`（正文不抄）。

## §11 键的可核对性 + 按键归类（范围扩展批；用户裁决①②③）

**槽的拆分（先解决一个语义混杂）**：原来**一个**内存槽承载两种东西 —— 摘要（新路径写）与平台原值（N2 老路写）⇒ 录入页分不清这次比对用的是什么。本批拆成两个：`globalData.chatKey`（**只放摘要**，**会话级存活**：M7 预选发生在用户稍后打开录入页时，不能像 `chatToolPickup` 那样消费一次即清）与 `globalData.chatRoomId`（**只放平台原值**，仅兼容分支、用完即清）。写入方仍是档案页（消费内存桥、算出摘要之后）。

**可核对性的两档**（摘要不可逆 ⇒ 允许上屏，这是**口径放宽**，与 D3 原值纪律不冲突）：
- 列表副行 = **短键** `会话键 …后6位`（`sheetFlow.shortChatKey`）——给人一眼认出"同一条会话的两条档案"；
- 浮层会话区 = **完整摘要** `本地摘要 <16hex>`（`sheetFlow.fullChatKey`）——给人逐字符核对。
两个格式化函数与行对象映射（`toRowViews`）都住在 `pages/archive-list/sheet-flow.js`：**页面层零断言（TD-016）**，所以"短键拼错/字段漏一个"只有把它们搬进零件才拦得住。

**归类的优先级**（`pages/recognize/form-parts.js` 单源）：`readRoomHint()` 摘要优先 → 回退平台原值 → 都无则空串（M7 的"未命中"，**不猜**）；`readRoomHintKind()` 把来源带出来，`preselectNote()` 据此说"按会话键预选"或"按旧口径的会话标识预选"——⛔ 两种文案都不许出现键本身。归类本身**仍只认** `aggregate.pickCustomerByRoom`（喂摘要即可命中；零/多命中一律返回空 ⇒ 不猜），本批**未改**该函数。

**机器闸**：`selftest` §11c（槽优先级 / 来源标记 / 三段文案 / 文案不含键）+ §11b-9（短键与完整摘要格式、行对象、以及两条**源码级**断言：⛔ 平台原值不进 `setData`、`chatKeyDigest` 的每处赋值只来自 `fullChatKey()` 或空串）。两条源码级断言刻意"钉粗的"：24 卡 r2 证明过这一族不变量一旦没有直接断言的调用点，改回去仍会全绿。
