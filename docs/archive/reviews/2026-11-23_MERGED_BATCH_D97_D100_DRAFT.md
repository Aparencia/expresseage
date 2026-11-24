# 送达图片 / 取件截图 / 已转出并入 / 订单卡统一 · 合并批次口径总表（草案）

> 日期：2026-11-23｜状态：**待用户确认后改 CONTRACT**（本轮只写设计与验收）｜撰写：lead
> 裁决候选：四条按登记顺序取 **D-97 ~ D-100**（裸编号在 CONTRACT §13 登记后生效；本文用连字符写法，避免文档门禁 #05 越界）
> 细则：订单卡与排序见同目录 `2026-11-23_ORDER_CARD_UNIFY_DRAFT.md`（D-100 全文）

---

## 1. 四条需求与依赖

| 候选 | 需求 | 用户已定 | 依赖 |
| :-- | :-- | :-- | :-- |
| D-97 | 送达图片：兼职点「送达」必须先拍照/选图；顾客可看 | 强制、一单一张、**逐单快门（批量送达也逐单）** | 上传地基 |
| D-98 | 取件截图：点「取件」时做一次拍照/上传；顾客可看 | **可跳过**（批量与单件都给跳过）；一张 | 上传地基 |
| D-99 | 已转出并入：不再有独立「已转出的单」卡，回到订单卡片 + 转派标记 | 只并入「已转出」（待接收转派保持原样）；**计入 counts**（按订单当前状态） | 订单卡 |
| D-100 | 订单卡统一与排序统一 | 保留两页；**码 40rpx 在第二行右侧**；四档→码自然序→订单号 | — |

上传地基（D-97/D-98 共用，先做）：`upload.prepare` 新增 `purpose='PROOF'`，路径 `proofs/{ticket}/image.jpg`（服务端唯一生成、不含 openid、≤500KB、jpg/png），独立限流桶，`TEST_WRITE` 白名单加 PROOF，`cleanup` 票据与文件同现有规则；**不新增集合**（`upload_tickets`、`counters` 复用）。

## 2. 逐条口径

### 2.1 D-97 送达图片（强制）

- 入参：`order.markDelivered({orderNo, deliveryNote?, deliveryPhotoTicket, clientRequestId})`；服务端校验票据归属/用途/未过期/未使用/路径一致 → 写 `orders.deliveryProof{fileId,size,at,byPartnerNo}`（单值，重复送达覆盖），票据置 `usedAt` 同事务。
- 缺票据 → `VALIDATION_FAILED(field='deliveryPhotoTicket')`，人话「请先拍一张送达现场照片」；历史单无该字段照常展示「未留存照片」。
- 撤销送达（`order.unmarkDelivered`）保留照片；`order.undo`（5 秒撤销条）同口径。
- 四类入口全覆盖：工作台行内、工作台批量（逐单按快门）、取件清单单个/批量（逐单）、订单详情送达浮层。
- 顾客可见：DTO 只下发 `{hasImage,cleaned,at}`；取图走既有 `order.imageUrl` 增 `kind='DELIVERY'`（默认 `TICKET` 兼容旧调用），5 分钟临时 URL；清理由 `cleanup` 写 `cleanedAt` 后返回 NOT_FOUND。
- 可见面：本单顾客、当前履约兼职、转派发起人（D85 双人可控）；后台不新增照片入口（仍按 D14 只走只读视角）。
- 留存：终态（完成/取消）后 7 天（`screenshotRetentionDays`）删文件；注销/匿名化同批清引用。
- 代客单（guest）同样强制；顾客侧无账号时可看者仅为履约兼职。

### 2.2 D-98 取件截图（可跳过）

- 整单取件：`order.markPicked({orderNo, pickPhotoTicket?, clientRequestId})`；带票据则校验后写 `orders.pickProof{fileId,size,at,byPartnerNo}`；**不带=跳过**，不阻断。
- 逐件取件（D61 `itemIndex`）：写 `parcels[i].pickProof{...}`；同样可跳过；撤销取件（`unmarkPicked`）保留照片，重取覆盖。
- 批量取件：一次可选拍照，**本批共用一张**（同一 `fileId` 记到各单，清理按引用计数，最后一个引用消失才删）。与 D-97 的「逐单快门」区分：取件是可选项，批量共用降低摩擦。
- 顾客可见：`order.imageUrl({kind:'PICK'})`；逐件照片在顾客端件行给「查看」入口；DTO 只给摘要。
- 可见面与留存同 D-97。

### 2.3 D-99 已转出并入订单卡片

- `order.listPartner` 的 `workbench`/`day` 视图行集合并入「`transfer.fromPartnerId=me` 且 `transfer.status='ACCEPTED'`」的单（D85 双人可控），行带 `handover:true` 与 `transfer` 块（接手人编号）；`counts` 六项改为并集统计（按订单当前状态归桶）。
- 工作台删除「已转出的单」常驻卡与行内「已转出」徽标来源；改由订单卡统一渲染「已转出 · 接手 P-XXX」标记。
- 「待接收转派（N）」顶部区块**保持不变**（`view='transfer'`）。
- `view='handover'` 动作保留（兼容深链/测试），页面不再调用；后续批次再评估下线。
- 多选允许已转出单；与接手人同时操作时以服务端状态为准（`INVALID_STATE`/`CONFLICT` 如实提示）。
- 排序沿用 D-100 单源；已转出单按订单当前状态进各自筛选项与 counts 桶。

### 2.4 D-100 订单卡统一与排序统一

见 `2026-11-23_ORDER_CARD_UNIFY_DRAFT.md`：三行卡 + 三个 variant、`components/partner-order-card`、`utils/order-sort.js` 单源（四档→码自然序→订单号）、V1/V2/V3 拆分。

## 3. 实现批次（先口径后代码，逐批可独立回滚）

| 批 | 内容 | 触达 |
| :-- | :-- | :-- |
| 0 | 口径：CONTRACT §4.1/§5.1/§5.2/§5.3/§11 + §13 登记 D-97~D-100 + DECISIONS + DATA_MODEL + UX×2 + ARCHITECTURE + ENGINEERING + QA + 隐私三处 + 提审材料 | 文档 |
| 1 | 上传地基：`shared/enums` `UPLOAD_PURPOSE.PROOF` + `config` 限流键 + `upload/prepare` 路径/闸 + `cleanup` + 判据 | 共享/云函数 |
| 2 | 送达图片：服务端强制票据 + 兼职四入口 + 批量逐单快门 + 顾客详情查看 + 判据 | 云函数/兼职/顾客 |
| 3 | 取件截图：可选票据 + 整单/逐件 + 跳过 + 顾客查看 + 判据 | 云函数/兼职/顾客 |
| 4 | 订单卡统一与排序：V1 排序 → V2 组件 → V3 收口 | 客户端 |
| 5 | 已转出并入 + counts 并集 + 移除独立卡 | 云函数/工作台 |
| 6 | 收口：`check.ps1` 真实输出、CHANGELOG/STATE、提审材料、真机项交用户 | 文档/门禁 |

依赖：1 → 2/3；4 → 5（卡片标记复用组件）；2/3 与 4/5 可并行，但**同文件冲突先停手**（工作台 `index.wxml/js`、`order-detail` 面板）。

## 4. 契约与文档回写矩阵（批 0 执行）

| 文档 | 位置 | 变更 |
| :-- | :-- | :-- |
| CONTRACT | §4.1 | 上传用途 `TICKET｜AVATAR｜PROOF`；`proofs/{ticket}/image.jpg`；限流桶 |
| CONTRACT | §4 订单字段 | `deliveryProof`、`pickProof`、`parcels[].pickProof`（单值，可缺省） |
| CONTRACT | §5.1 | 送达备注行补「送达照片」；新增取件照片与跳过规则；撤销保留口径 |
| CONTRACT | §5.2 | 排序改「四档 → 取件码自然序 → 订单号」 |
| CONTRACT | §5.3 | `order.markDelivered`/`markPicked` 入参、`order.imageUrl` 增 `kind`、`listPartner` 行集与 counts 并集 |
| CONTRACT | §11.1/§11.2 | 新增「取件/送达现场照片」信息类型与可见面、7 天留存、无第三方外发 |
| CONTRACT | §13 | 登记 D-97~D-100 |
| DATA_MODEL | §2.5/§7 | 三处照片字段、DTO 摘要、`imageUrl` 入参、cleanup 引用计数 |
| UX_PARTNER | §3.2/§3.11/§3.3 | 送达/取件拍照与跳过、批量逐单快门、已转出并入与标记 |
| UX_CUSTOMER | 订单详情 | 「送达图片」「取件照片」查看入口与空态文案 |
| ARCHITECTURE | §2/§3.5 | 新组件 `partner-order-card`、云端 handler 与 `imageUrl` 参数 |
| ENGINEERING | §5.7/§7.5/§8 | 组件清单、变异电池 M43~M48、套件增量 |
| QA / 隐私 ×3 / 提审材料 | — | 真机项、明确披露、截图清单与说明 |

## 5. 判据与变异电池

- 送达：无票据拒绝、票据越权（他人/过期/已用/用途不符/路径不符）拒绝、送达即完成（22:30+）仍写照片、撤销保留。
- 取件：跳过可提交、带票据归属校验、逐件与整单字段落位、批量共用同一 `fileId` 的引用计数。
- 并表：`counts` 六项含已转出行、`view='transfer'` 不变、`view='handover'` 仍可读、已转出行多选可用。
- 变异：**M43** 送达票据闸失效；**M44** 取件票据归属闸失效；**M45** counts 并集失效；**M46** 自然序退化字典序；**M47** 卡片 variant 分支删除；**M48** PROOF 路径前缀闸失效。

## 6. 真机项（用户点检，agent 不代勾）

送达逐单快门（含批量）在真机上的节流与失败重试；取件跳过与补拍；顾客端图片加载与 7 天后「已清理」文案；已转出单在主列表的标记与批量冲突提示；两页同一单顺序一致。

## 7. 不做

合并两页、投递单元/聚焦任务/站内批次（搁置）、新增费用语义、外呼第三方、后台新增照片入口、新增集合/索引（照片字段落在 `orders`）。
