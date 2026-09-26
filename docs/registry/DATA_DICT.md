# DATA_DICT · 数据结构登记表（v2）

> 约定：碰表结构 = 本项目红线（AGENTS.md §9），须设计卡 + 用户在场的迁移方案。
> 本项目**无数据库**："表"= 本机存储键里的对象与字段。事实源：`docs/specs/20260923_chat_pick/DESIGN.md` §1（已按 v1 `utils/migrate.js` 实码订正），校验实现处：`utils/migrate.js`。
> v2 是全新本机库 ⇒ `chatRoomId` **直接进初版 schema**，不需要 v1 那套 4→5 迁移三件套（DESIGN §7 本期 N/A）。
> **列口径（v6_align 批 3，2026-09-25）**：V6 契约列是 `表｜字段｜类型｜校验｜敏感度 D1~D4`。本表的 **`表` 列由分区标题表达**（§0 存储键 / §1 Meta / §2 Customer / §3 Parcel），不为每行重复一个表名列；列集合是契约的**超集**（保留 v2 的「空值语义」「备注」两列）。用户裁决 = "补列，不删列"。

## 0. 存储键（唯一键，整键覆盖写、无事务）
| 键 | 归属 | 内容与上限 | 说明 |
| :-- | :-- | :-- | :-- |
| `ex_college_v2.store` | **v2** | `{schemaVersion, customers[], parcels[]}`；全部 D3 字段只存本机，不跨设备 | 读写口只有 `utils/storage-core.js`（对外门面 `utils/storage.js`；`tools/check.js` 第 6 条机械拦越界） |
| ~~`ex_college.store`~~ | **v1**（已冻结） | — | ⛔ **v2 代码禁止读、写、清空它，也禁止把它当迁移源**：v1/v2 同一个 appid ⇒ 同一台手机同一个命名空间，动它就是删真实数据（AGENTS §9 红线） |

## 1. Meta
| 字段 | 类型 | 校验（实现处：`migrate.validate`） | 空值语义 | 敏感度 |
| :-- | :-- | :-- | :-- | :-- |
| `schemaVersion` | number | 必须**是数值**且 **≤ SCHEMA_VERSION(=2)**；`> 2` ⇒ `STORE_VERSION_MISMATCH`（装过更新版又回退 ⇒ 拒绝而不是覆盖）；非数值 ⇒ `validate`/`down` 一律拒绝。**V2 = 站点名归一**（2026-09-26 用户批准；`down` 对该版本**刻意拒绝** —— "本来就叫新名"与"从旧名改过来的"在同一字段上不可区分，改回去就是猜） | 缺失即非法 | D1 |

## 2. Customer（客户档案）
| 字段 | 类型/约束 | 校验（照 v1 migrate 逐条 + v2 差异） | 空值语义 | 敏感度 | 备注 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| `id` | string ≤32 | 必填非空 ⇒ `CUSTOMER_INVALID:id`；本机唯一 ⇒ `CUSTOMER_ID_DUPLICATE`；由 `storage.newId('c',now)` 生成（时间戳 + 随机段，同毫秒不撞） | 无"空"这个选项 | D2 | 页面**不得显示**（SCOPE M9） |
| `building` | string ≤20 | 必填非空 + 长度闸 ⇒ `CUSTOMER_INVALID:building`。`[改]` 形态闸（楼区 ∈ D/X/N/B/C、栋号 1~10）在**入口层**：两条建档入口都必须先过 `customer-input.splitCustomerLine` → `buildings.parseRoomLine` | 同上 | **D3** | 落库形态是规范大写 `D4` |
| `dorm` | string ≤20 | 必填非空 + 长度闸 ⇒ `CUSTOMER_INVALID:dorm`。`[改]` 宿舍号 ≥100 的闸同 `building`（入口层） | 同上 | **D3** | 前导零在入口层已归一（`0522`→`522`） |
| `name` | string ≤20 | 必填非空 ⇒ `CUSTOMER_INVALID:name`；留空 ⇒ `customer-input.nextCustomerName` 补 `D4 522 A/B/C…`（**空名落不了库，所以必须补名**） | 同上 | **D3** | 允许重名（用户口径） |
| `note` | string ≤**100** | `undefined`/`null`/`''` 合法；非空时必须是不超 100 的字符串 ⇒ `CUSTOMER_INVALID:note`（长度按**原串**算，v1 口径） | `''` = 没备注 | D3 | ⛔ 禁止写 `chatRoomId` 或取件码（M11：D3 值不落进自由文本） |
| `chatRoomId` | string ≤64 | **`[新增]`** `undefined`/`null`/`''` 合法；非空时必须 string、≤64、匹配 `^[A-Za-z0-9_-]+$` ⇒ 否则 `CUSTOMER_INVALID:chatRoomId`。规则单点在 `migrate.isChatRoomId()`，storage 复用不重抄 | `''` = **未绑定**（与 `lockerNo`/`trackingTail` 同口径："没有"是一个明确的值） | **D3** | ⛔ 不做唯一约束、不当主键；不匹配 ⇒ 写入侧**丢弃该值 + `ROOM_ID_DISCARDED`，建档仍成功**（M11）。⛔ 不进 URL query、不进日志（K5）。⚠️ **2026-09-25（24 卡 R-05）语义口径**：自 `pick_friend` 批 1 起，**库里存的是本地摘要键**（单聊双方 id 的无序对摘要，16 位小写 hex、**不可逆**），不再是平台原值；字段类型/长度/字符集与形态闸 `migrate.isChatRoomId` **一个字没改**；**平台原值只活在内存桥里**（`globalData.chatToolPickup`，消费一次即清、上屏只出指纹）。DESIGN §10 待裁② = **A**：老路（`getChatToolInfo` 明文）若拿到原值仍可落库 ⇒ 该字段可能出现两种形态，二者都满足本行的形态闸。⚠️ **2026-09-25（范围扩展批，用户裁决②）**：**新路径只写摘要**（`chatTool.pairKeyOf` 的 16 hex），平台原值**仅存在于兼容分支**；形态闸与长度口径一个字未改 |
| `createdAt` / `updatedAt` | number(ms) | 必填且 `isFinite && > 0` ⇒ `CUSTOMER_INVALID:time` | 同上 | D2 | 列表按 `createdAt` 降序 |
| `deletedAt` | number(ms) | 可选：`undefined`/`null`/合法时间戳 ⇒ 否则 `CUSTOMER_INVALID:time` | `null` = 未删除 | D2 | 软删标记；软删档案的记录**仍算存在**（恢复时要一起回来） |
| `deleteBatch` | string ≤40 | 可选；有就必须是短字符串 ⇒ `CUSTOMER_INVALID:deleteBatch` | `null` = 不属于任何批次 | D2 | 区分"同一次删除"。⛔ **禁止用时间戳当批次标记**（同毫秒两次删除会撞车，教训卡 `2026-09-15_时间戳当批次标记.md`） |
| `placeholder` | boolean | **`[新增]`** 可选；只有**占位档案**才带它且必须是 `true` ⇒ 带它的记录走 `migrate.validateCustomer` 的**独立分支**（`CUSTOMER_REQUIRED` 六个必填字段对它不适用） | 真实档案不写这个字段 | D1 | 2026-09-25（用户裁决 A「加"未归类"占位客户」）：**「未归类」占位档案** = `id: migrate.PLACEHOLDER_CUSTOMER_ID`（`unassigned`）+ `name: '未归类'`，解决"取消建档那件没归属 ⇒ `PARCEL_CUSTOMER_MISSING` ⇒ 写不进库"。⛔ 一旦它被删/改名，名下快件立刻悬空 ⇒ **整库读不出来** ⇒ storage 四个破坏性入口（改名/换绑/软删/真删）对它一律 `PLACEHOLDER_PROTECTED`；默认不进 `listCustomers`（`includePlaceholder:true` 才取，清单分组用） |

## 3. Parcel（快递记录）
| 字段 | 类型/约束 | 校验 | 空值语义 | 敏感度 | 备注 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| `id` | string ≤32 | 必填非空 ⇒ `PARCEL_INVALID:id`；唯一 ⇒ `PARCEL_ID_DUPLICATE` | 同上 | D2 | — |
| `customerId` | string ≤32 | 必填且必须指向存在的 Customer（**软删档案也算存在**）⇒ `PARCEL_CUSTOMER_MISSING`；写入侧另有一道 `CUSTOMER_NOT_FOUND`（软删档案不可再挂新记录） | 同上 | D2 | 归属校验放在存储层，不放页面 |
| `stationName` | string ≤40 | 必填非空 ⇒ `PARCEL_INVALID:stationName`；命中 **7 个正式名**（P1~P7）或**别名**（`stations.STATION_ALIASES`，识别与手输归一用）由 `stations.matchBuiltinStation` 在入口规范化回填，未命中允许自建 | 同上 | D1 | 分组键就是原字符串（差一个空格就裂成两组） |
| `pickupCode` | string ≤**40** | 必填非空 ⇒ `PARCEL_INVALID:pickupCode`（上限照 v1 实码 40） | 同上 | **D3** | 能冒领 ⇒ 屏上/日志/文案都不回显（`reason.js` 纪律 ①） |
| `status` | 枚举 `todo`/`done` | 必填且在枚举内 ⇒ `PARCEL_INVALID:status` | 无第三态 | D2 | "已取件"**不是**状态值，见 `pickedAt` |
| `source` | 枚举 `ocr`/`manual` | 必填且在枚举内 ⇒ `PARCEL_INVALID:source` | — | D2 | ⛔ **不加 `chat` 值**：该字段描述"取件码怎么来的"，不是"图从哪来"，两条取图来源无行为差异 |
| `lockerNo` | string ≤10 | **v2 起：字段必须存在**（缺失 ⇒ `PARCEL_INVALID:lockerNo`，缺失 = 没走迁移，不许当"没有柜号"放过）+ 必须是**字符串** + 长度按 **trim 后**算 | **`''` = 未知**（合法，所以不能进必填表） | D1 | 值域内置 1~8 号柜（`stations.listLockerOptions`） |
| `trackingTail` | string | **必须存在** + 必须是字符串 + 非空时 trim 后**恰好 5 位 ASCII 数字**（`/^[0-9]{5}$/`，全角数字拒绝）⇒ 否则 `PARCEL_INVALID:trackingTail` | `''` = 不适用（绝大多数件有码就直接取） | **D3** | "待查"状态**不落冗余字段**，由本字段是否非空派生；位数不对就查不出码 ⇒ 放行等于存假线索 |
| `pickedAt` | number(ms) | **必须存在**（`undefined` ⇒ `PARCEL_INVALID:pickedAt`）+ 可空时间戳 | `null` = 未取到 | D2 | M10 勾选写**此刻**；不改 `status`（两段式） |
| `doneAt` / `archivedAt` | number(ms) | 可选时间戳 ⇒ 否则 `PARCEL_INVALID:time`（v1 既有：完成 / 软归档） | `null` = 未完成 / 未归档 | D2 | 送达/完成由 `status:'done'` + `doneAt` 表达 ⇒ **不新增 `deliveredAt`**（DESIGN §1 订正记录） |
| `createdAt` / `updatedAt` | number(ms) | 必填 `isFinite && >0` ⇒ `PARCEL_INVALID:time` | 同上 | D2 | 清单组内排序另有规则（`aggregate`） |
| `deletedAt` / `deleteBatch` | 同 Customer 两行 | 同 Customer 两行 | 同上 | D2 | 档案删除时同批记录打**同一个批次串**，恢复按串认领 |

## 4. 结构性约束（v1 已验证，v2 原样继承）
1. **读盘后与写盘前都要过 `validate`**（防手改、防半截写入导致真机白屏）；校验不过 ⇒ **不写盘**，失败带 `detail=<字段级码>`。
2. **升级之前先用 `validateBody`** 确认旧库没坏，否则损坏库会被当"待升级"跑 `up`，把 `STORE_CORRUPT` 掩盖成版本码。
3. **`up` 用"缺了才补"而不是按版本分支** ⇒ 对初版库幂等（跑第二遍一个字节都不改），且同一条记录跨版不会漏补。
4. **v2 没有历史版本链**：`up` 只补 `pickedAt/lockerNo/trackingTail` 三个"必须存在"的字段（`chatRoomId` 可缺 ⇒ 不补，要不要它由校验规则说了算）；`down` 在版本 1 上无事可做。
5. 派生值**不落库**（SCOPE W3：未取件数量一律现算），避免"改件/删件/归档三处都要同步"的漂移。
6. 数据只在本机 `wx.setStorageSync` ⇒ **不跨设备、不备份**（v1 已知风险 2 在 v2 一字不改地继续成立，SCOPE W9）。
7. **2026-09-25 详情页/回收站批：无结构变更** —— 软删所需的 `Customer.deletedAt`/`deleteBatch` 与 `Parcel.deletedAt`/`deleteBatch` **早已存在**（本表 §2/§3）；该批新增的 `storage.purgeCustomer(id)` 只是**新增一个写入口**（真删已软删档案 + 其名下全部快件），不改字段、不改类型、不改形态闸、不动 `SCHEMA_VERSION` ⇒ 迁移三件套与四证④ 均为 **N/A**。
