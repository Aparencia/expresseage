# DESIGN · 档案详情页 + 左滑软删 + 回收站（`20260925_detail_delete`）

> 上游：`SCOPE.md`（Must 10 / Won't 5 / 验收 V1~V8）｜档位 **M**｜四证④ **N/A**（无表结构变更、无 down 可跑）

## §1 动线
```
档案行 ──点整行──→ pages/customer-detail/index?customerId=<id>
                    ├ 展示：楼区/宿舍号/称呼/备注（可改）＋ 会话键（短键+完整摘要）＋ 名下快件（按站点分组）
                    └ 操作区：换绑（转档案页的同一条流程）/ 软删（二次确认）/ 恢复（已删态才出现）

档案行 ──右→左滑──→ 露出「删除」──点击──→ 二次确认（名下 N 件会一起隐藏、可恢复）──→ softDeleteCustomer
档案页底部「已删除（N）」──→ 回收站浮层 ──每行──→ 「恢复」 restoreCustomer ｜「彻底删除」 purgeCustomer（强确认）
```

## §2 数据设计（DATA_DICT diff）
**本次无结构变更**：软删所需的 `Customer.deletedAt` / `deleteBatch`、`Parcel.deletedAt` / `deleteBatch` **都已存在**（`DATA_DICT §2/§3`）。
⇒ 不加字段、不改类型、不改形态闸；`Customer.chatRoomId` 的语义仍按上一批的裁决（新路径只写**摘要**，平台原值仅兼容）。

## §3 接口契约（APIS diff）
| 路径（= 模块函数） | 用途 | 错误码 | 鉴权 |
| :-- | :-- | :-- | :-- |
| `storage.purgeCustomer(id)` | 回收站的**第二步**：真删已软删档案 **+ 其名下全部快件** | `NOT_FOUND`（档案不存在）`PURGE_REQUIRES_SOFT_DELETE`（**未软删 ⇒ 拒绝**，引导先软删）`VALIDATION_FAILED`/`WRITE_FAILED`/`QUOTA_EXCEEDED`（继承 `saveStore`） | 无（本机） |

**⚠️ 与派单字面要求的一处偏离（有据）**：派单写"真删该档案 + **同 `deleteBatch` 串**的名下快件（与 `restoreCustomer` 的批次语义一致）"，本设计改为**删该档案名下全部快件**。依据（实测代码）：`utils/migrate.js` 的归属判据是
`if (!knownCustomerIds[item.customerId]) return 'PARCEL_CUSTOMER_MISSING';`，而"软删档案也算存在"⇒ 若只删同批次，**任何一条"单独删过、批次串不同"的快件都会变成悬空引用** ⇒ 整库 `validate` 失败 ⇒ **连读盘都读不出来**（不是"少一条记录"，而是"应用不可用"）。
`restoreCustomer` 的批次语义解决的是"恢复时不要连坐"，与"删除时不能留悬空"是两件事 ⇒ **两个方向的口径本就不同**，不是不一致。
**纵深防御**：`saveStore` 会对整库跑 `validate` ⇒ 万一将来这条逻辑被改坏，写盘会**直接失败**（什么都不发生），而不是留下坏库。

**新错误码 1 个**（三步走：先登记 `APIS.md` → 补 `utils/reason.js` 文案 → 再写代码；并同步 `tools/selftest.js` 的 `CONTRACT_CODES`）：`PURGE_REQUIRES_SOFT_DELETE`。

## §4 破坏性分级 + 迁移
- **🟢 L1（纯追加）**：新增一个写入口 + 新页面 + 新零件 + 一段左滑手势；**不改字段、不加字段、不升 `SCHEMA_VERSION`**。
- **迁移三件套：N/A**（v2 是初版库、无结构变更）；**四证④（down 空跑）：N/A** —— 无 down 可跑，不冒充"已通过"（同 `chat_pick` / `pick_friend` 先例）。

## §5 组件影响（COMPONENTS diff）
| 页面 | 界面元素 | 人话标识 | 文件 | 影响面 |
| :-- | :-- | :-- | :-- | :-- |
| 用户档案页 | 整行可点 | "点进去看这个人" | `pages/archive-list/index.wxml` | 进详情页；⛔ 行内「＋ 录快件」「换绑」仍是 `catchtap`，不许被整行点击吃掉 |
| 用户档案页 | 左滑露出的「删除」`row-del`（**待建行**） | "往左一划那个红的" | 同上 + `.wxss` | 只软删；二次确认；一次只开一行 |
| 用户档案页 | 底部「已删除（N）」`recycle-entry`（**待建行**） | "删掉的人去哪了" | 同上 | 打开回收站浮层 |
| 用户档案页 | 回收站浮层 `recycle-*`（**待建行**） | "那个回收站" | 同上 | 恢复 / 彻底删除（强确认） |
| 档案详情页（新） | `detail-*` 一组 | "这个人的详情" | `pages/customer-detail/**` | 新页面，`app.json` 登记 |
| 入库/契约 | `purgeCustomer` | —（无屏上元素） | `utils/storage.js` | 回收站第二步的唯一写入口 |

## §6 强确认为什么"够强"（`recycle.js` 的 `PURGE_CONFIRM_WORD`）
选**逐字输入确认词**（`彻底删除`）而不是长按 ≥2s：① 小程序没有原生长按语义，自己计时要跟左滑的手势事件抢同一批触摸事件（互相干扰）；② 输入确认词是"**故意摩擦**"，误触成本高且**可纯函数断言**（`selftest` 能钉住"必须逐字"）；③ 文案必须写明"**不可逆、本项目没有备份/导出**"（这是事实，不许写成"可以恢复"）。

## §7 腾出行数（档案页正好 500 非空行 = 硬线）
把两段**零外部引用**的纯逻辑搬进零件（已 grep 证实无别处引用）：
1. `SHEET_*` 常量 + `computeSheetScrollHeight` → `sheet-flow.js`（**顺带首次可被断言**：R-08/TD-019 那三个参数的口径一起搬过去，注释里的事实保留）；
2. `applySheetLine`（一行粘贴 → 三格）→ `sheet-flow.js` 的纯函数（返回 patch，页面只 `setData`）⇒ 拆行规则**第一次可断言**。
⛔ **不重构** `abandonKey` 与 `chatKeyDigest` 相关块：`tools/selftest-wave5.js` 有两条**源码级正则断言**钉着它们（`abandonKey()` 体内必须有 `this.chatRoomId = ''`；`chatKeyDigest:` 赋值只许来自 `''`/`sheetFlow.fullChatKey(`）。

**实现期补充（写在这里而不是只写进回执）**：腾出来的配额还不够放 12 个新处理器（左滑/删除/回收站/详情跳转），
于是新处理器没有塞进页面，而是住进 **`pages/archive-list/row-actions.js`（方法混合件）**，由 `Page(Object.assign({...}, rowActions))` 并进来
（`this` 仍是页面实例）。这是本项目**第一次**用"方法混合件"这个形态 ⇒ 三点留痕：① 为什么必须这样（500 行硬线 + 页面层零断言 TD-016）；
② 纯判据仍分离在 `swipe.js`/`recycle.js`（那两个**可断言**，混合件只做"读盘 → 判据 → setData/写盘"的接线）；
③ 落地结果：页面从 500 → **491 非空行**，`row-actions.js` 159 行。
**另一处实现期决定**：详情页的「换绑」不自己拉起会话选择 —— `chatpick/` 选完固定 `switchTab` 回**档案格**，
从详情页拉起必然落错页 ⇒ 详情页把目标写进**上一个页面实例的字段**（`getCurrentPages()`，非 `globalData`：§11.1 禁隐式全局状态，
且 `app.js` 的槽声明不在本批写盘范围内），由档案页 `onShow` 走自己那条 `startPick → applyRebind`（同一份流程、同一个写入口）。

## §8 换绑：两条入口共用一个落点（不写第二套）
详情页的「换绑」不重复实现拉起流程：它把目标写进 `app.globalData.pendingRebind = {id, label}` 后 `switchTab` 回档案格；档案页 `onShow` 发现该槽 ⇒ 走**自己的** `startPick → applyRebind`（同一条流程、同一份 wheel、同一个写入口）⇒ 用完即清。
理由：`chatpick/` 的返回落点硬编码为**档案 tab**（`ARCHIVE_TAB_PATH`），从详情页直接拉起会话选择，回来必然落在档案页 ⇒ 与其让两页各写一套"回来往哪落"，不如让落点唯一。

## §9 预估与批次
预估 **≈420 行**（详情页 4 件 ≈150｜零件 2 个 ≈120｜档案页接线 ≈60｜storage+reason ≈35｜断言 ≈60）⇒ 暂停线 ×1.5 = 630。
