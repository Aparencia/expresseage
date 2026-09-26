# DESIGN · 20260923_chat_pick（v2 第一批设计）

> 卡 22 产物｜2026-09-23｜上游：`SCOPE.md`（Must 清单以该文件 §1+§9 为唯一来源，条数不抄在这里）、`RESEARCH.md`（当时裁的方案 = **N3 普通分包内建档**）
> ⛔ **2026-09-25 改判公告（读这份设计前先看这条）**：U-1 真机/工具读数 `-80426 subPackage /chatpick/ for chatTools[0] should be independent` 证明 **`chatTools` 只接受独立分包** ⇒ **N3 出局，按预裁退回 N2**。所以下面 **K2**（"不带 `independent`"）、**K4**（建档成功后 `switchTab` 的发起方）、**K5**（`chatRoomId` 的唯一写入方 = 分包页）**三行契约已作废/反转**，现行口径以 `docs/registry/APIS.md` 的 K2/K5 行 + `docs/ARCHITECTURE.md` §1 为准；**K1（分包不碰存储）、K3（不改全局导航）、§9 P5（失败不回滚已写数据）三条不受影响，继续成立**。改判的完整理由与读数：`RESEARCH.md §6.2` 与 `STATE.md` 未决 14。本文件**不重写正文**（它是 22 卡当轮的历史产物），只挂这块告示。
> ⚠️ SQL / 迁移 / 真机空跑一律由人执行；agent 只产出文件与命令。**设计获你批准才算过。**
> 留痕：SCOPE 五查⑤ 要求"用户逐条看过并说确认"，实际以「继续」放行、未逐条批注 ⇒ 本卡把这条一并登记，24 卡审查时按**追认**处理（v1 有先例：`SCOPE.md §4` 五查⑤ 被"直接一口气做完"跳过后的追认条目）。

## ① 开工确认
1. **任务复述（从 Must 提取的设计对象）**：
 - 表：`Meta` / `Customer` / `Parcel`（v2 初版本机库，§1）
 - 接口/模块契约：`utils/storage.js`、`utils/migrate.js`、`utils/customer-input.js`、`utils/buildings.js`、`utils/aggregate.js`、`utils/chat-tool.js`（新）、`utils/ocr.js`、`utils/parse.js`、`utils/stations.js`、`utils/parcel-drafts.js`、`utils/privacy.js`、`utils/reason.js`（§2、§3）
 - 组件：底栏两格、档案页（列表 + 新建浮层）、录入页、分包建档页（§4）
2. **上游引用**：`docs/specs/20260923_chat_pick/SCOPE.md`；已确认方案一句话 = **用普通（非独立）分包承载聊天建档，分包页 `require` 主包 `utils/` 复用同一份校验规则，就地绑定→取 id→切分→建档**。
3. **澄清问题**：见 §9 待批准项（5 条，SCOPE/registry 里查不到答案的才列）。
4. **设计通过四证原文（逐字）**：
```text
① DATA_DICT diff 每行都标了敏感度 D1~D4
② APIS 每行都含错误码与鉴权列
③ 组件影响清单已列出（含"待建行"标注）
④ down 由人本地空跑通过，输出已贴回
```

## 1. 数据字典 diff（v2 初版：`SCHEMA_VERSION = 1`，存储键 `ex_college_v2.store`）

> ### 🔧 订正记录（2026-09-23，23 卡批 1 之后）
> 本节初版是**照记忆写的**，与批 1 逐字节搬来的 `utils/storage.js`/`aggregate.js` 冲突：它们引用了
> `status`、`doneAt`、`archivedAt`、`updatedAt`、`deleteBatch` 五个我没列的字段，而我还凭空造了一个
> `deliveredAt`。若照初版表写 `migrate.js`，就是教训卡 `2026-09-11_规则与样例分叉.md` 的第三次踩坑。
> ⇒ 下表已按 **v1 `utils/migrate.js` 的实际校验代码**（199 行，逐行核过）重列，v2 的差异只标 `[新增]`/`[改]`。
> **P2 的结论随之修正**：`archivedAt` v1 早就有（不是"新加"）；`deliveredAt` **不加**——"送达/完成"在 v1 里由
> `status: 'done'` + `doneAt` 表达，再造一个字段就是第二份事实源。

| 表 | 字段 | 类型 | 校验（照 v1 migrate 逐条） | 敏感度 |
| :-- | :-- | :-- | :-- | :-- |
| Meta | `schemaVersion` | number | 必须 = 1；**> 当前值 ⇒ `STORE_VERSION_MISMATCH`**（用户装过更新版又回退 ⇒ 拒绝而不是覆盖） | D1 |
| Customer | `id` | string ≤32 | **必填**（空/缺/`''` ⇒ `CUSTOMER_INVALID:id`）、本机唯一 ⇒ `CUSTOMER_ID_DUPLICATE` | D2 |
| Customer | `building` | string ≤20 | 必填非空；须过 `buildings.parseRoomLine`（楼区 ∈ {D,X,N,B,C}、栋号 1~10）`[改：v1 只卡长度，v2 写入侧加形态闸]` | **D3** |
| Customer | `dorm` | string ≤20 | 必填非空；宿舍号 ≥100 `[改：同上]` | **D3** |
| Customer | `name` | string ≤20 | 必填非空；留空 ⇒ `customer-input.nextCustomerName` 补 `A/B/C…` | **D3** |
| Customer | `note` | string ≤**100** | 可空（v1 口径：`undefined`/`null` 合法，非空时必须 ≤100 的字符串）；⛔ 禁止写入 `chatRoomId` 或取件码 | D3 |
| Customer | `chatRoomId` | string ≤64 | `[新增]` **可空**（`''` = 未绑定，与 `lockerNo`/`trackingTail` 同口径）；非空时须匹配 `^[A-Za-z0-9_-]+$`，不匹配 ⇒ **丢弃该值 + `ROOM_ID_INVALID` 提示，仍允许建档**；⛔ 不做唯一约束、不当主键 | **D3** |
| Customer | `createdAt` / `updatedAt` | number(ms) | 必填、`isFinite && > 0` ⇒ `CUSTOMER_INVALID:time` | D2 |
| Customer | `deletedAt` | number(ms) | 可选时间戳（`undefined`/`null`/合法值）；软删标记 | D2 |
| Customer | `deleteBatch` | string ≤40 | 可选；**区分"同一次删除"的批次标记，禁止用时间戳**（同毫秒两次删除会撞车，教训卡 `2026-09-15_时间戳当批次标记.md`） | D2 |
| Parcel | `id` | string ≤32 | 必填、唯一 ⇒ `PARCEL_ID_DUPLICATE` | D2 |
| Parcel | `customerId` | string ≤32 | 必填且必须指向存在的 Customer（**软删档案也算存在**，恢复时记录要一起回来）⇒ `PARCEL_CUSTOMER_MISSING` | D2 |
| Parcel | `stationName` | string ≤40 | 必填；命中 6 个正式名则 `matchBuiltinStation` 规范化回填，未命中允许自建 | D1 |
| Parcel | `pickupCode` | string ≤**40** | 必填非空 | **D3**（能冒领） |
| Parcel | `status` | 枚举 `todo` / `done` | 必填且在枚举内 ⇒ `PARCEL_INVALID:status` | D2 |
| Parcel | `source` | 枚举 `ocr` / `manual` | 必填且在枚举内 ⇒ `PARCEL_INVALID:source`。⚠️ **不加 `chat` 值**：该字段描述"取件码怎么来的"，不是"图从哪来"；两条取图来源不产生任何行为差异 ⇒ 不为它加字段（AGENTS §2.2 禁平行新建） | D2 |
| Parcel | `lockerNo` | string ≤10 | **必须存在**且是字符串（缺失 = 没走迁移，立刻报，不许当"没有柜号"放过）；**空串合法** = 未知；长度按 **trim 后**算 | D1 |
| Parcel | `trackingTail` | string | 必须存在且是字符串；空串 = 不适用；非空时 trim 后**恰好 5 位 ASCII 数字**（全角数字拒绝） | D3 |
| Parcel | `pickedAt` | number(ms) | 必须存在（`null` = 未取到）；M10 勾选写此刻时间戳 | D2 |
| Parcel | `doneAt` / `archivedAt` | number(ms) | 可选时间戳（v1 既有：完成 / 软归档） | D2 |
| Parcel | `createdAt` / `updatedAt` | number(ms) | 必填 | D2 |
| Parcel | `deletedAt` / `deleteBatch` | 同 Customer 两行 | 同上 | D2 |

**校验的三条结构性约束（v1 已验证，v2 原样继承）**：① 读盘后与写盘前都要过 `validate`；② 升级**之前**先用 `validateBody` 确认旧库没坏，否则损坏库会被当"待升级"跑 up、把 `STORE_CORRUPT` 掩盖成版本码；③ `up` 用"缺了才补"而非按版本分支，对初版库幂等。
**存储键隔离（本卡第一条硬约束）**：v1 与 v2 **同一个 appid** ⇒ 同一台手机上是**同一个 storage 命名空间**。v1 用 `ex_college.store`，v2 用 `ex_college_v2.store`。⇒ v2 的任何代码**禁止读、写、清空 `ex_college.store`**（那是"删真实数据"，AGENTS §9 红线），也禁止把它当迁移源。


## 2. 跨模块契约（N3 成立的机械前提，逐条可查）
| # | 契约 | 判据落点 |
| :-- | :-- | :-- |
| K1 | 分包页**只允许**通过 `require('../../utils/storage.js')` 落库；分包页自身出现 `wx.*Storage*` ⇒ 门禁 FAIL | `tools/check.js` 第 6 条（已继承，实测判绿） |
| K2 | `app.json` 的 `subPackages[0]` **不带** `independent`、**不带** `renderer:"skyline"`；`chatTools[0] = { root:'chatpick', entryPagePath:'index', desc }` | 23 卡人工在开发者工具验（U-1） |
| K3 | ⛔ **不改全局 `window.navigationStyle`**。若 Skyline 强制 custom 报错 ⇒ 只在 `chatpick/index.json` 里设局部 `navigationStyle:"custom"`。v1 的错就是把这条改到了全局，导致**所有页面失去系统导航栏** | `tools/check.js` 新增第 9 条：`app.json` 的 `window` 内不得出现 `navigationStyle` |
| K4 | 分包页建档成功后 `wx.switchTab('/pages/archive-list/index')`（**不是** `reLaunch` 带参——N3 在分包内就建完了，没有跨包传参需求）；`switchTab` 失败 ⇒ 红字提示 + 保留已建档案（**不得回滚已写数据去"保持一致"**） | 25 卡验收 V6 |
| K5 | `chatRoomId` 在页面间只活于**内存**，⛔ 不进 URL query、不进日志、不进 `note`。**实现载体 = `app.js` 的 `globalData.chatRoomId` 槽**（报告 R-34 订正：本行旧写"只活于 `data`"，与实现不符）——写它的唯一入口是页面 `onLoad` 从 `getApp()` 读一次进 `data`，⛔ 任何函数深处不得直连 `getApp()` 取业务数据（AGENTS §11.1） | 24 卡审查 + `check.js` 第 6 条间接覆盖 |
| K6 | 归类是**纯函数**且**宁可不猜**：`aggregate.pickCustomerByRoom(customers, roomId)` → 唯一命中返回该 id；零命中或多命中返回 `''`（多命中说明两人共用一个会话，属异常，交人判） | `tools/selftest.js` 三条断言（唯一/零/多） |

## 3. 接口契约（小程序无 HTTP ⇒ 适配为"模块函数契约"；鉴权列一律"无（本机单人，零网络）"）
| 模块.函数 | 调用方 | 用途 | 失败码 | 鉴权 |
| :-- | :-- | :-- | :-- | :-- |
| `storage.createCustomer({building,dorm,name,note,chatRoomId})` | 档案页浮层、分包页 | 建档案（**唯一入口**，两路共用） | `CUSTOMER_INVALID:<field>` / `WRITE_FAILED` / `ROOM_ID_DISCARDED`（非致命，值被丢弃） | 无 |
| `storage.listCustomers()` / `listParcels()` | 三页 | 读（默认排除软删） | `STORE_VERSION_MISMATCH` | 无 |
| `storage.addParcels(list)`（**每条自带 `customerId`**，不是函数入参） | 录入页 | 一图多码**一次整键写**（不逐条写盘），要么全成要么一条都不建 | `VALIDATION_FAILED:PARCEL_INVALID:list`（空/非数组）/ `CUSTOMER_NOT_FOUND`（任一归属缺失）/ `WRITE_FAILED` / `QUOTA_EXCEEDED` | 无 |
| `storage.setParcelPicked(id, picked)` | 清单页 | 勾选已取件（写/清 `pickedAt`） | `NOT_FOUND`（实码，**不是** `PARCEL_NOT_FOUND`——该码已在 r1 R-13 删除）/ `WRITE_FAILED` | 无 |
| `chatTool.bind(url, deps)` | 分包页 | 封装 `wx.openChatTool`，**依赖注入**（Node 可测失败分支） | `CHAT_UNSUPPORTED` / `CHAT_BIND_FAILED` / `CHAT_BIND_CANCELLED` | 无 |
| `chatTool.readRoomId(deps)` | 分包页 | 封装 `wx.getChatToolInfo`，三态返回 `{ok, roomId, reason}` | `CHAT_ID_UNAVAILABLE`（无字段）/ `CHAT_ID_EMPTY`（有键但空）/ `CHAT_UNSUPPORTED` | 无 |
| `customerInput.splitCustomerLine(line)` | 两路建档入口 | 一行 → `{building,dorm,name}`；切不出 ⇒ `ok:false` **不猜** | `CUSTOMER_LINE_UNPARSED` / `ZONE_OUT_OF_RANGE` | 无 |
| `buildings.parseRoomLine(line)` | 上一层 | 楼区/栋号/宿舍号值域闸 | `ZONE_INVALID` / `BLOCK_INVALID` / `DORM_INVALID` | 无 |
| `ocr.recognizeImage(options)`（**单参对象**；依赖注入走 `options.wxApi`，不是第二个参数） | 录入页 | VisionKit 串行队列 | `OCR_UNAVAILABLE` / `OCR_FAILED` / `OCR_EMPTY`（**全部只降级为"少预填"，不阻断录入** = M6） | 需摄像头/相册授权 |
| `parse.parseParcelTextMulti(text)` | 录入页 | 文字行 → 多条 `{stationName,pickupCode,lockerNo,trackingTail}` | 无（纯函数，返回空数组即"没认出来"） | 无 |
| `privacy.ensureMediaAccess()` / `ensureCameraAccess()` | 录入页 | **两道独立**授权门禁 | `PRIVACY_ALBUM_DENIED` / `PRIVACY_CAMERA_DENIED` | — |

**最小示例（两条，≤4 行）**
```jsonc
// chatTool.readRoomId 成功 → { ok:true, roomId:"s7Ab9..." }（≤64，^[A-Za-z0-9_-]+$）
// 失败三态 → { ok:false, reason:"CHAT_ID_EMPTY" }   // 有键但值为空 ⇒ 与"无字段"分开报
// storage.addParcels 成功 → { ok:true, added:2 }    // 一图多码一次写
```
新增码全部同步 `docs/registry/APIS.md`，对外可见的须在 `utils/reason.js` 有人话文案（码的**条数不写在这里**——它会随批变；取数：读 `utils/reason.js` 的 `TEXTS` 或跑 `node tools/selftest.js`，§2/§3 有钉住码表的断言）。⚠️ 本行此前写“`tools/audit-codes.js` 机械对帐，23 卡第一批接回”，而**那个脚本从来不存在** ⇒ r2 报告 R2-D07 订正：机械对帐仍未建，挂在 **TD-003**。

## 3.1 🔧 与实码的对帐订正（23 卡合并后，单元 1/2 双双报出）
§3 的表是**设计时按记忆写的码名**，两车道合并后有 8 处与实码不符。**一律以实码为准**（`utils/reason.js` 与 `docs/registry/APIS.md` 是码的唯一事实源），订正如下：

| §3 原写 | 实码 | 出处 |
| :-- | :-- | :-- |
| `CUSTOMER_LINE_UNPARSED` / `ZONE_OUT_OF_RANGE` | **`NO_BUILDING` / `NO_DORM`**（楼区三码 `ZONE_INVALID`/`BLOCK_INVALID`/`DORM_INVALID` 不存在） | `customer-input.js` + `buildings.js` |
| `OCR_UNAVAILABLE` / `OCR_FAILED` / `OCR_EMPTY` | **`VK_UNSUPPORTED` / `VK_INIT_FAILED` / `IMAGE_DECODE_FAILED` / `NO_TEXT`** | `ocr.js` |
| `PRIVACY_ALBUM_DENIED` | **`PRIVACY_DENIED`**（摄像头那道才是 `PRIVACY_DENIED_CAMERA`） | `privacy.js` |
| `PARCEL_NOT_FOUND`（`setParcelPicked`） | **`NOT_FOUND`** | `storage.js` |
| `ROOM_ID_INVALID`（§1 与 §3 两个名字） | **`ROOM_ID_DISCARDED`** 统一（非致命：丢弃该值但建档成功） | `storage.js` |
| `ocr.recognize(imagePath, deps)` | **`recognizeImage(options)`**（**单参对象**：`filePath`/`page` 在 `options` 里，依赖注入走 `options.wxApi`），返回 `{ok, reason, detail}` | `ocr.js:234` ⚠️ 本行上一版把订正结果写成 `recognizeImage({filePath, page}, deps)`（两参）⇒ 订正本身是错的，r2 R-12 再订正一次 |
| `parse.parseParcelTextMulti(text)` | 入参是**行数组**，不是整段字符串 | `parse.js` |
| `storage.addParcels(customerId, list)` | **`addParcels(list)`**，`customerId` 在每条草稿里 | `storage.js` |

**两条随之登记的实现限制**（不是 bug，是搬运带来的边界）：
1. `parcel-drafts` 的三个函数都不携带 `trackingTail` ⇒ **一图多码时尾号只能走单条预填行**，多码列表里逐条填不了尾号（单元 2 与 v1 做了同一取舍）。
2. §1 给 `building`/`dorm` 标的"写入侧形态闸"落在**入口层**（`splitCustomerLine → parseRoomLine`），`validate` 侧**没有**再加严——因为 `validate` 一严就会把 v1 搬来的历史形态判死。要机械保证"只有过闸的值能进库"，得靠入口唯一（两个建档入口都走 `customer-input`），这条留给 24 卡复核。

## 4. 组件影响清单（v2 registry 现为空表头 ⇒ 除占位卡片外全部"待建行"）

| 页面 | 界面元素 | 人话标识 | 文件 | 影响面 |
| :-- | :-- | :-- | :-- | :-- |
| 底栏 | tabBar 两格（无图标） | "底下那两个 tab" | `app.json` `tabBar` | **待建行**；`pages[0]` 必须 = 取件清单（启动页） |
| 取件清单 | 站点头 / 行 / `check-box` 方块 | "整站折叠""勾一下就是取到了" | `pages/pickup-list/*` | **待建行**；方块必须 ≥88rpx 可点（v1 M6 无障碍教训） |
| 取件清单 | 空态文案 | "还没有快递" | 同上 | **待建行** |
| 用户档案 | 档案卡片行 | "一行一个人" | `pages/archive-list/*` | **待建行**；主标识 = `楼栋 宿舍`，副行 = 称呼；⛔ 不显示待取数与 id（M9） |
| 用户档案 | `fab`「＋ 新建」 | "右下角加号" | 同上 | **待建行**（M3 手动建档入口） |
| 用户档案 | 新建浮层（单行输入 + 三格预览 + 错误行 + 两按钮） | "那个往上滑的框" | 同上 | **待建行**；遮罩与面板必须是**兄弟节点**；可滚区必须 `<scroll-view>`（v1 教训卡 `2026-09-19_view上的overflow不能滑.md`） |
| 录入 | 取图两按钮 / 识别中态 / 预填行 / 多码列表 / 客户选择区（含"已按会话预选"标记行） | "选图那两个按钮""预填出来的格子" | `pages/recognize/*` | **待建行**；非 tab 页，`navigateTo` 带 `customerId` |
| 分包建档 | 绑定状态行 / 楼区单行输入 / 错误行 / 「建好了」 | "从聊天进来那一屏" | `chatpick/index.*` | **新页面**；路由落点 `app.json` `subPackages[].pages`（漏登记 = 门禁 FAIL）；局部 `navigationStyle:"custom"` 仅当 K3 报错时才加 |
| 骨架占位页 | 占位卡片 | "打开看到的那张白卡" | `pages/index/*` | **删除**；`app.json` 的 `pages` 同步改，否则第 3 条报"声明缺文件" |

## 5. 搬运清单（RESEARCH §4 的"搬纯函数 + 同步拆分"落到文件名）
| v1 文件 | 行数 | 处置 | 理由 |
| :-- | :-: | :-- | :-- |
| `buildings.js` | 279 | **搬**（原样） | 纯函数零依赖；含 D/X/N/B/C 枚举与三道值域闸，是单一事实源 |
| `customer-input.js` | 229 | **搬**（原样） | 纯函数；v1 为"静默错解 `D4-522 小王`"付过 P1，规则不许重写 |
| `stations.js` | 322 | **搬** + 同步 `docs/STATION_MAP.md` | 6 个正式名是词表事实源，规则表必须一起搬 |
| `parcel-drafts.js` | 139 | **搬** | 纯函数 |
| `privacy.js` | 59 | **搬** | 两道独立门禁，口径不变 |
| `ocr.js` | 252 | **搬**（依赖注入面保留） | VisionKit 串行队列是踩出来的，重写必踩第二次 |
| `aggregate.js` | 358 | **搬 + 加**：三级排序（`pickupTier`/`comparePickupItems`）与归档分区**原样保留**，另加 K6 的 `pickCustomerByRoom` | ⚠️ 本行原写"搬 + 删：删掉三级排序"，r1 的 **R-07** 查明那两级排序在搬运件里本来就有且被 `buildPickupList` 用着 ⇒ 用户裁决"按实码订正文档、不删代码"，W2 收窄为"v2 不新增按码首位聚合这一级"（见 STATE 未决 7④ 与 `APIS.md`） |
| `parse.js` | **751** | **搬 + 拆**（超 AGENTS §11.1 单文件 ≤500 硬上限）：拆成 `parse.js`（行归一 + 单条解析）与 `parse-code.js`（取件码形态与长度闸） | ⚠️ 拆分属重构，AGENTS §2.4 要求专门立项 ⇒ 见 §9 **P3** |
| `storage.js` | **548** | **搬 + 拆**（同样超线）：`storage.js`（读写与整键写）与 `records.js`（增删改的领域操作） | 同上 |
| `migrate.js` | 199 | **重写**：v2 初版只有 `SCHEMA_VERSION=1` + `validate`，**零历史版本链** | v1 那 4 条 up/down 链在 v2 无对应物 |
| `reason.js` | 34 | **重写**：只登记本期 16 个新码 | 码集不同 |
| `pickqueue.js` / `share.js` | 122 / 37 | **不搬** | 多选流水线与转发都不在本期（W8） |

## 6. 破坏性分级（先判再动）
**🟢 L1 纯追加** —— v2 是全新本机库，本期不升任何旧版本、不改任何旧字段、不删任何对象。回滚 = `git revert`（库是空的，删掉 `ex_college_v2.store` 即回到未建状态）。
唯一 🔴 相邻风险已在 §1 末写成硬约束：**同 appid ⇒ 同命名空间，v2 绝不碰 v1 的 `ex_college.store`**。

## 7. 迁移三件套：本期 **N/A**（四证④ 的诚实处理）
- 本期 `SCHEMA_VERSION = 1` 是**初版**，没有"up 之前的状态"可回滚 ⇒ 无 `_up/_down/_seed` 文件可写。硬造一份 down 脚本 = 造一个"删库"动作，反而踩红线。
- **将来**出现 v1→v2 升级时才写三件套，规则沿用 v1：`down` 手写精确反向、必须能恢复到 up 之前、`seed` 用假名（禁真实个人信息）、**只有你能跑**（教训卡 `2026-09-19_require迁移脚本等于执行迁移.md`：`require` 迁移脚本 = 执行迁移）。
- ⇒ **四证④ 本期标 N/A + 本节理由**，不冒充"已空跑通过"。这是与卡面的一条偏离，登记在此供你批准（§9 **P1**）。

## 8. 设计通过四证自检
① DATA_DICT diff 每行标了敏感度 ✓（§1，D1~D4 全列，`chatRoomId`/`pickupCode`/楼区三件套均 D3）
② APIS 每行含错误码与鉴权列 ✓（§3 两列齐；鉴权统一"无（本机单人，零网络）"，识别类标授权依赖）
③ 组件影响清单已列出含"待建行" ✓（§4，9 行全标待建行/删除/新页面）
④ down 人空跑 —— ⚠️ **N/A**（§7 理由），**不是"通过"**

## 9. 待你批准项（一词可裁；不批就不进 23）
| # | 待批 | agent 建议 |
| :-- | :-- | :-- |
| **P1** | 四证④ 以"本期零迁移 ⇒ N/A"结案，不造假三件套 | 接受 N/A（造假更糟） |
| **P2** | ~~`deliveredAt` / `archivedAt` 现在进初版 schema 还是等 Should 再做时升版~~ → **已作废并订正**：核对 v1 `migrate.js` 后确认 `archivedAt`/`doneAt`/`status` v1 早就有，`deliveredAt` 是我凭空造的。结论 = **沿用 v1 的 `status:'done'` + `doneAt` 表达完成/送达，不新增字段** | 见 §1 订正记录（23 卡批 1 后） |

| **P3** | `parse.js`(751) 与 `storage.js`(548) 超单文件 500 硬上限 ⇒ 搬的时候拆分，属重构、AGENTS §2.4 要求专门立项。是"本期破例随批拆"还是"另立一张卡" | **另立卡**（登记 `docs/TECH_DEBT.md`）。随批拆会让本批再涨一次面，而本批已经是 v1 两任务之和 |
| **P4** | 新增门禁判据：`check.js` 第 9 条"`app.json` 的 `window` 内不得出现 `navigationStyle`"（把 K3 钉成机械判据） | 加。v1 为此吃过一次全局副作用 |
| **P5** | 分包建档失败时（已落库、`switchTab` 失败）只提示不回滚 | 接受。回滚已写数据去"保持一致"是更大的风险 |

## 10. 范围扩展设计（2026-09-25 · M15/M16，SCOPE §10）

### 10.1 内联新建的"草稿态" = **不动它**（不是做快照）
`form-parts.createSheetPatch(open)` 只返回 `{createOpen, createLine, createError}` —— **不含任何 `draft.*` / `drafts`**。
⇒ "打开/取消浮层会不会把已填的站点、取件码、多码列表弄丢"在**结构上**不成立；做快照反而多一处能写错的地方。
断言 §11「内联新建①」钉住这个键集（变异：给 patch 塞一个 `draft` ⇒ 实测判红）。
值域闸复用 `utils/customer-input.buildCustomerInput`（**一行输入**，与档案页同形态）⇒ 本页零正则、零文案；
落库经 `form-parts.submitCreateCustomer(line, {storage})`（`storage` **注入**，逻辑可测）；建完**当场选中**——
顺序要紧：先 `refreshCustomers()`（新档案进可选列表）再取标签，反了会取到空标签。

### 10.2 站点名的**两个时机**、一张表
| 时机 | 函数 | 命中内置库 | 命不中 |
| :-- | :-- | :-- | :-- |
| 识别**回填** | `stationPrefill(raw)` | 写**规范名** + 「已命中内置站点：X」 | **原样保留**（⛔ 不许覆盖成空、不许猜） |
| 人手打后**失焦** | `stationBlurPatch(raw)` | 收敛到正式名 + 「已归到正式名：X」 | 原样留着 + 「新站点：保存后会出现在清单的分组里」 |

两句文案刻意**不合并**：识别回填是"系统替你认出来了"，失焦是"系统帮你收敛了"，人手打的东西被改与没被改，含义不同。
一图多码那条路本来就走 `parcel-drafts`（`officialStationName` 强制 6 个正式名或空）+ 行内「命中依据」⇒ 不需要本节的改动。

### 10.3 为腾行数做的三处搬迁（AGENTS §2.4 的例外说明）
本批把 `pages/recognize/index.js` 顶到 **515 行**（>500 硬限）⇒ 按派单"确实顶破就先搬迁再改"，把三段**纯逻辑**搬进 `form-parts`：
`planSingleSave`（三条拦空 + 站点归一 + 拼码）、`stationBlurPatch`、`submitCreateCustomer`。页面回到 **486**。
搬迁的额外收益是**它们第一次可被断言**（页面层零断言 TD-016：`if (!stationName)` 整行删掉此前全绿）⇒
断言 §11「保存决议①~④」「站点失焦①②」，变异实测判红。
