# RESEARCH · 档案详情页 + 左滑软删 + 回收站（`20260925_detail_delete`）

> 触发：用户新开需求，**撤销** `chat_pick` 当初"左滑删除 W1 / 归档分区 W2 不做"的 Won't 裁决。
> 本卡只调研 + 落范围；实现见同目录 `SCOPE.md` / `DESIGN.md`。档位建议 **M**。

## 1. 上游引用（先查再动手）
| 上游 | 查到什么 |
| :-- | :-- |
| `docs/pool/IDEAS.md` | 无此想法（新开） |
| `docs/ARCHITECTURE.md §2/§3` | 分层铁律：**页面不直接读写本地存储**（`wx.*Storage*` 只许在 `utils/`）；新页面落 `pages/<页名>/` 并在 `app.json` 登记；页面专用零件放 `pages/<页名>/<件名>.js` |
| `docs/registry/APIS.md` | 已可复用：`storage.softDeleteCustomer`（打标记 + 名下"还活着"的记录打**同一批次串**）、`storage.restoreCustomer`（按批次串认领）、`storage.listCustomers({includeDeleted})`、`storage.listParcels({customerId,includeDeleted})`、`storage.updateCustomer`、`aggregate.countActiveByCustomer`（**删除确认框的 N 必须用它**，口径 = 未删除总数） |
| `docs/registry/DATA_DICT.md` | `Customer.deletedAt`/`deleteBatch`、`Parcel.deletedAt`/`deleteBatch` 都已存在 ⇒ **本次无结构变更** |
| `docs/registry/COMPONENTS.md` | 档案行（`card`/`row`/`row-acts`/`quick-add`/`key-tag`）、浮层（`sheet-*`）已登记；**新页面与左滑/回收站元素是本批新增行** |
| 撤销留痕 | `docs/specs/20260923_chat_pick/SCOPE.md` 的 Won't **W1（左滑删除）** 与 **W2（归档分区）**：本批**只撤 W1**（左滑软删），**W2 仍不做**；撤销人 = 用户（2026-09-25 新需求），影响 = `chat_pick` 的 25 卡验收清单里"左滑删除"从 Won't 移出，改由本任务承接 |

## 2. 关键事实（取证，不是猜）
1. **软删/恢复语义已实现且是"批次串"语义**：`softDeleteCustomer` 给档案 + 名下**还活着**的快递打**同一个 `deleteBatch`**；`restoreCustomer` 按该串**只复活同批**的记录（单独删过的记录不会被连坐复活）。
2. ⛔ **`purgeCustomer` 必须删掉该档案名下"全部"快递记录，不能只删同批**：`migrate.validate` 的归属判据是"每条快递的 `customerId` 必须指向**存在的**档案（软删档案也算存在）⇒ 否则 `PARCEL_CUSTOMER_MISSING`"。若只按 `deleteBatch` 删，**任何一条"单独删过、批次串不同"的快递都会变成悬空引用** ⇒ 整库 `validate` 失败 ⇒ **连读盘都读不出来（STORE_CORRUPT 级故障）**。⇒ 本条**偏离**派单里"同 `deleteBatch` 串"的字面要求，理由即此，已写进 DESIGN §3 与被否方案。
3. `pages/archive-list/index.js` **正好 500 非空行（硬线）**，且两处**源码级断言**钉着它：`abandonKey()` 体内必须有 `this.chatRoomId = ''`；`chatKeyDigest:` 的每处赋值只许来自 `''` 或 `sheetFlow.fullChatKey(` ⇒ 本批**不重构这两块**，改为把两段**纯函数**搬进零件腾出配额（见 DESIGN §2）。

## 3. 方案对比（≥2 + 被否案）
| 方案 | 改动面 | 风险 | 结论 |
| :-- | :-- | :-- | :-- |
| **A（采纳）：详情页 + 左滑软删 + 回收站浮层** | 新页面 4 件 + 档案页薄接线 + 两个零件 + storage 一个写入口 | 中（新页面无真机验证；左滑靠触摸事件） | 用户四条裁决都指向它 |
| B：不建详情页，全塞进档案页浮层 | 档案页 +100 行 | **破 500 硬线**、且浮层已承载建档，职责打架 | 被否（用户已裁"新页面"） |
| C：真删直接放在档案行（长按即真删） | 档案页 +60 | 误触即不可逆（本项目**没有备份/导出**） | 被否：真删只能从回收站进（用户裁决④） |

## 4. 影响面
`pages/customer-detail/**`（新）、`pages/archive-list/**`（左滑 + 回收站接线 + 腾行数）、`utils/storage.js`（+1 写入口）、`utils/reason.js`（+1 码）、`app.json`（登记新页）、`tools/selftest*.js`、`docs/registry/{COMPONENTS,APIS,DATA_DICT}.md`、`docs/ARCHITECTURE.md §3`。

## 5. 档位
**M**：>3 文件、跨页面 + 存储层，但**无依赖/无结构变更/无新页面体系**（新页面是常规 `pages/<名>/`）。
