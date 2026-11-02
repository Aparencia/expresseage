# 用户新需求理解、扩展与补全（2026-11-02）

> **性质**：需求分析稿。**只做现状核对、需求理解与方案选项/推荐，不改代码、不改口径、不动门禁**。用户拍板后先改 `docs/contract/V4_CONTRACT.md` §13 与 `docs/contract/V4_DECISIONS.md`（新编号接续 D57，裁决后登记），再回写 DATA_MODEL/UX/QA/ARCHITECTURE 并分批实现。
> **基线**：HEAD `82c397c`（批 23 收口；工作树干净）。`文件:行号` 均按该基线；推断项标「推断」；真机/控制台项标「只能人验」。
> **输入**：用户 11 条新需求（原文见各节「原话」）。
> **口径源**：`docs/contract/V4_CONTRACT.md` v1.8（D1~D57）、`V4_DECISIONS.md`、`docs/data/V4_DATA_MODEL.md`、`docs/engineering/V4_ARCHITECTURE.md`、`docs/engineering/V4_ENGINEERING.md`、三份 UX、`docs/delivery/V4_QA_CHECKLIST.md`。
> **研究附件**：第 3 条可行性研究单独落 `docs/archive/research/2026-11-02_PARCEL_SOURCE_FEASIBILITY.md`（含官方文档出处）。
> **裁决状态（2026-11-02 更新）**：用户已对 Q1~Q11 逐条答复（原文见 §7），全部定案并登记 `docs/contract/V4_CONTRACT.md` §13 D58~D66 与 `docs/contract/V4_DECISIONS.md`；本稿转为历史依据（不再改口径）。

---

## 0. 结论速览（先看这张表）

| # | 你的需求（摘要） | 现状核对（HEAD） | 定性 | 推荐方案 | 需你拍板 |
| :-: | :-- | :-- | :-- | :-- | :-- |
| 1 | 已接单订单可「路由给其他兼职人员」 | **全仓无改派/转单能力**；订单归属是接单时快照（`order/_store.js:288-305` 按 partnerOpenid 鉴权），`order.undo` 不覆盖接单（`shared/order-state.js:85-90`） | 新能力（跨账号履约） | 转单邀请 + 目标兼职确认（ACCEPTED 单可发起；不改变顾客绑定；通知顾客） | Q1 |
| 2 | 兼职可有「子队员」（可推送订单消息） | 兼职准入**只能开发者发邀请码**（D3）；`partners` 无层级字段；**无团队概念**；推送=站内轮询/红点，无订阅消息 | 新能力 + 改准入口径 | 分两档：A 轻量协作（已是兼职者被邀请入队，推荐 MVP）；B 主兼职直接发子邀请码开子账号 | Q2 |
| 3 | 小程序能否用手机号等直接读快递件信息 | 现状来源=截图 OCR + 规则解析 + DeepSeek 文本兜底 + 手填（D24）+ 本机清单（D57）；**永不收集完整手机号** | 研究项 | **受限可行→结论不可行**：个人主体不能用手机号组件；无可自助接入的「按手机号查件」接口；建议维持现状 + 可选 P1「粘贴短信文本端侧解析」 | Q3 |
| 4 | 兼职取件清单多站点单只按首个站点排序 | **属实且是已写进 UX 的设计**：分组键=首件站点（`pages/partner/workbench/parts/parcel-view.js:115-124`、`parts/group-view.js:218-239`、`pkg-partner/pages/pick-list/parts/pick-view.js:163-186`）；组内排序键也取整单最差件（`parcel-view.js:90-113`） | 口径变更（非纯 bug） | 按**件**的站点分组：一单可出现在多个站点组，行内只列本站件；组内四档按本站件算 | Q4 |
| 5 | 一单多快递时每件可独立取件 | **D23 明文「订单级动作作用于全部包裹、不设包裹级状态」**（CONTRACT:230/349）；`order.markPicked` 只写整单 `pickedAt`（`order/markPicked.js:9-37`）；DTO 件无取件状态 | **口径变更（推翻 D23 一半）** | 真实件级取件：`parcels[].pickedAt` + 逐件事件；订单 `PICKED` 由「全部件取完」聚合派生；送达/异常/取消仍整单 | Q4/Q5 |
| 6 | 一单多取件缩进区分、每码独立显示、独立已取件入口 | 工作台行内只有整单工具条（`workbench/index.wxml:131-175`）；多件只显示件数 tag（`row.parcelCountText`）；取件清单件行可复制但无逐件动作（`pick-view.js:75-112`） | 前端交付（依赖第 5 条） | 订单行下缩进逐件行：件号/站点/码/柜号独立行 + 每件「已取件/撤销」按钮 + 每码独立复制 | Q4/Q6 |
| 7 | 顾客邀请顾客，被邀请者默认绑邀请者的兼职 | 分享卡只允许**兼职**生成绑定卡（`utils/share/index.js:34-48`：`isCustomer===false` 才放 bind 卡），顾客只有通用卡；D38 自动绑定链路已就绪 | 新能力（低改动可复用） | 顾客也可生成绑定卡（path 仍只带 partnerNo，复用 D37/D38 自动绑定）；**不记录邀请关系**为 MVP 默认 | Q7 |
| 8 | 兼职端客户页加筛选器 | 只有 `keyword` 搜索 + 固定 `dormKey` 自然排序；服务端 `partner.listBindings` 仅收 `limit/keyword/cursor`（`handlers/partner/listBindings.js:82-102`、`_customer.js:75-225`） | 新交付（服务端只增参数） | 一期 chips：全部 / 资料未完善 / 按苑 / 有备注；「有进行中订单」只能对已加载行筛（P1 再做全量） | Q8 |
| 9 | 普遍存在下拉到底部显示不全 | **系统性真 bug**：`.page-body` 只垫 24rpx+safe（`app.wxss:28-32`），而自定义 tabBar 实占 100rpx+safe（`custom-tab-bar/index.wxss:1-16`）→ 每个 tab 页底部被压 76rpx；另有底部条/弹层三套静态垫高与 `enablePullDownRefresh` 缺配（23 页有 handler、仅 12 页开开关） | 真 bug（系统性） | 全局 layout token + `.page-body--tab` + 底部条组件 + 3 条机械门禁 + 逐页审计 | Q9 |
| 10 | 顾客取件清单升为与首页/订单/我 同级，改名，只留自建取件码 | 现页在分包 `pkg-customer/pages/pickup-list`（D26 订单区 + D57 本机区）；**平台 tabBar 最多 5 项且现已满 5 项**（`app.json:66-97`）→ 4 顾客格 + 3 兼职格共享「我的」= 6 个唯一页，**无法直接新增真 tab** | 信息架构调整 + 平台约束 | 推荐 C：页面迁主包为「伪 tab」（自绘共用底部栏 + reLaunch，视觉同级、不动现有 5 tab）；删除 D26 订单区，只留本机清单 | Q10 |
| 11 | 首页「上传取件码截图下单」改为「下单」 | 主 CTA 在 `pages/customer/home/index.wxml:86`；另有空态、引导、角色页、帮助 4 处近似文案 | 文案修复 | 首页主 CTA 改「下单」；建议同批统一空态/引导/角色页/帮助，不改功能 | Q11 |

> 一句话：**第 4/5/6 条是同一件事（订单→件级履约改造，需先改 D23 口径）；第 1/2 条也是同一件事（团队+转派）；第 9 条是全局布局缺陷；第 10 条受微信 tabBar 5 项硬限制，必须选实现方式。**

---

## 1. 逐条需求理解与补全

### 1.1 第 1 条：已接单订单「路由给其他兼职人员」

**原话**：「已接单的订单新添路由给其他兼职人员选项。」

**理解与补全**（你没说、但实现必须定的边界）：
1. **发起人**：当前接单兼职（订单归属人）发起；顾客不发起、开发者不代操作。
2. **目标怎么选**：输入目标兼职**完整兼职编号**（与顾客绑定同源校验，防枚举）；若第 2 条团队落地，则限「本队队员」或允许队外。
3. **是否需要对方确认**：推荐要（否则对方无故多一单、且可能不在服务范围）。
4. **顾客是否知情**：必须知情——订单事件 + 消息中心一条「你的订单已转交给 P-XXX-XXX 履约，绑定关系不变」；顾客端订单详情显示当前履约兼职。
5. **绑定关系不变**：顾客仍绑原兼职（D4 1:1 不动）；转单只改订单归属；不产生新绑定、不改 roomTag、不影响换绑规则。
6. **状态限制**：推荐仅 `ACCEPTED`（未取件）可发起；`PICKED` 后已在履约中，转单语义混乱，不做（P1 可再议）。
7. **消息可见性**：目标兼职未绑定该顾客 → 只能通过**本订单 DTO**看到履约必需信息（站点/码/柜号/配送地址/宿舍锚/备注），**不展示顾客头像/昵称/客户档案**（D19/D42 边界不破）；顾客端展示的原兼职昵称/头像随绑定关系继续可见，B 的头像昵称不展示给顾客（顾客未绑定 B）。
8. **超时与撤回**：待确认转单建议 10 分钟过期自动取消；原兼职可撤回；确认后不可单方撤回（P1 可做「转回」）。
9. **审计与统计**：事件写 `order_events`（含 from/to 兼职编号、时间、actor）；单量统计按**当前归属**计（转出方历史单量不追溯）。
10. **测试隔离**：真实×测试订单禁止互转（与现绑定隔离同口径）。

**现状证据**：
- 无任何改派入口/动作：`cloudfunctions/api/handlers/order/index.js:4-24` 18 个动作无 assign/transfer；`shared/actions.js` 无相关项。
- 归属快照：`order/_create.js:299-300`（partnerId/partnerOpenid）；鉴权 `order/_store.js:288-305` 要求 `order.partnerOpenid === 当前 openid`。
- 顾客绑定唯一：`bind/_common.js:25,59-60`（`activeKey=customerId`）。
- 转单会撞的两处：① `order/_dto.js:106-138` 仅当 `binding.partnerId === order.partnerId` 才下发对方昵称/头像 → 转单后双方都看不到；② 顾客资料/客户档案仍按 binding 门禁（`partner/getCustomer.js:13-23`）→ 目标兼职能履约但打不开档案。
- 统计按 `partnerId`：`partner/stats.js:61,67`。

**方案**：

| 选项 | 说明 | 代价/风险 | 结论 |
| :-- | :-- | :-- | :-- |
| **A 转单邀请 + 目标确认（推荐）** | 原兼职 `requestTransfer(toPartnerNo)` → 目标兼职「待接收」入口确认/拒绝 → 确认后事务改 `partnerId/partnerOpenid/partnerNo` + 事件 + 双方通知；10 分钟过期；ACCEPTED 限 | 新增 4 个动作、`orders.transfer` 字段、pending 列表/红点、DTO、状态守卫；改动面 L | ✅ 推荐 |
| B 直接改派 | 原兼职选人即改归属，目标收到通知；不想要再转回 | 实现小（1 动作），但对方可能拒绝/不在范围、顾客无感、无确认留痕 | 备选（你要求「最简」时） |
| C 退回待接单 | 原兼职退单回 `SUBMITTED`，全服覆盖范围内兼职可接 | 改动小但推翻 CONTRACT:326「接单不可撤销」；顾客看到接单人可能变化；无定向路由 | 不推荐 |

**影响面**：`shared/{actions,order-state,enums,audit?}.js`、`order/{index,_common,_dto,_store,listPartner}.js`、`message/*`（通知）、`utils/...`、`pages/partner/workbench/**`（入口/待接收）、`pkg-partner/pages/order-detail/**`、`pkg-customer/pages/order-detail/**`（展示转交）、`api/middleware/ratelimit.js`（转单限流）；文档 CONTRACT §5/§5.1/§5.3/§10、DATA_MODEL §2.6/§8.4、UX_PARTNER/UX_CUSTOMER、QA；判据 `selftest-order-*` 新增组。**无新集合、无索引**（待确认列表可按 `orders.transfer.toPartnerId` 查，建议后置到 `listPartner` 的 view=transferIn，不新建集合）。

**待拍板**：Q1。

---

### 1.2 第 2 条：兼职有子队员（可推送订单消息）

**原话**：「允许兼职人员有子队员（允许推送订单消息）。」

**理解与补全**：
1. 「子队员」是**账号关系**还是**顺手推送对象**？若是账号，必须有独立登录/编号/可接单；若只是推送，就等于第 1 条转单。
2. 推荐**一层层级**：`partners.parentPartnerId`，不做多级/分队。
3. 准入：现 D3 规定邀请码**只能开发者发**。两条路：
   - **A 轻量协作（推荐 MVP）**：队员必须**先已是兼职**（走现有邀请码）；主兼职凭完整兼职编号邀请、对方在自己「我的」接受入队；不动 D3、不新增激活链路。
   - **B 真子账号**：主兼职可生成子邀请码、对方一键激活成为子兼职；需改 CONTRACT §1.1/§10「邀请码只有 admin 能发」，新增 `partner.createSubInvites/revokeSubInvite`、有效期/批次/审计，工作量与风险显著更大。
4. **顾客绑定边界**：推荐**顾客仍只能绑主兼职**，子队员不可被顾客绑、不出现在 `partner.getPublic`（返回 `NOT_FOUND`）；子队员只经「转派/推送」拿到订单。这样 D4/D19/D42 与隐私边界改动最小。
5. **订单可见范围**：子队员只看到派给自己的订单（`partnerId=自己`），看不到主兼职其他顾客与订单；主兼职仍看全部自己名下订单（含已转出的历史？建议只看当前名下+自己参与记录，P1 再议）。
6. **推送定义**：MVP = 站内订单事件 + 红点/轮询（无订阅消息）；推送动作 = 第 1 条转单邀请（可批量选多单推给同一队员）。P1 再做订阅消息模板（模板 ID 进 config）。
7. **统计**：主兼职统计**不含**队员单量（`partner.stats` 现按 `partnerId`）；P1 可加「团队」聚合。
8. **停用/注销级联**：主兼职 SUSPENDED/CLOSED 时，子队员一并不可接新单（推荐 SUSPENDED 级联；CLOSED 级联由 admin 动作执行），待确认转单自动取消，未完成订单按现有异常/开发者介入口径。
9. **隐私披露（必须）**：顾客资料会因「转派/队员履约」被未绑定的兼职看到，隐私文本要加一句「为完成订单，你的订单可能由你绑定兼职的协作队员协助履约」；微信后台声明无需新增信息类型，但端内/指引需同步。
10. **数量/限流/审计**：队员上限（建议 ≤5）、入队邀请限流、加入/移出写事件/审计（P1 单独审计动作）。

**现状证据**：D3/CONTRACT:41/52-56、§10:474（邀请码仅 admin）；`partners` 字段 `partner/activate.js:28-40`（无 parent 字段）；`order/_store.js:288-305` 可见性单点；`message/_common.js` 无定向收件人；无订阅消息实现（CONTRACT:455 P1）。

**方案**：

| 选项 | 说明 | 代价 | 结论 |
| :-- | :-- | :-- | :-- |
| **A 轻量协作（推荐）** | 现有兼职互相组队（主兼职邀请、对方接受）；订单转派/推送给队员；顾客绑定不变；隐私披露同步 | 新增 `parentPartnerId`、4~6 个动作、团队页/入口、转派复用第 1 条；不动 D3 | ✅ MVP 推荐 |
| B 真子账号 | 主兼职发子邀请码，队员一键激活（独立 partnerNo）；其余同 A | 改 D3/§1.1/§10 + 邀请码生命周期 + 审计 + 停用级联；XL | 若你要「主兼职自己招人、不用找开发者」选 B |
| C 只做转单推送 | 不建队员关系，任何兼职可被推送/转单 | 最省，但「子队员」概念不成立 | 不满足需求原意 |

**影响面**：`partners`/`invitation_codes`（若 B）、`partner/{activate,listBindings,getCustomer,stats,_common}.js`、`order/_store.js`（若扩可见性）、`message/*`、`pages/partner/customers/**` 或新增「我的团队」页、`pages/profile/**`（入口）、`utils/privacy-*` + 端内隐私、`shared/actions.js`、限流；文档 CONTRACT §1/§1.1/§4.2/§10/§11、DATA_MODEL、UX_PARTNER、QA；真机/隐私文本项交你点检。

**待拍板**：Q2。

---

### 1.3 第 3 条：能否从小程序用手机号等直接读快递件信息

**结论（详见研究附件）**：**受限可行 → 对本项目不可行**。
1. 微信「手机号快速验证/实时验证」**只对非个人主体且已认证**开放，且只返回手机号，**不含任何快递数据**；本项目是个人主体+工具类目（D13），直接用不了。
2. 菜鸟/丰巢/快递100/顺丰/京东/EMS 等**没有公开、可自助接入的「按手机号查件」接口**；多数要企业资质/合同；微信物流消息/物流查询插件只服务**本小程序自有购物订单**，本项目零交易（D6/D30），不适用。
3. 小程序**无读取短信/通知的 API**；剪贴板只能在用户主动触发时读，且需隐私声明（现口径已覆盖）。
4. 现状路径（截图 OCR + 规则解析 + 云函数 DeepSeek 文本兜底 + 手填 + 本机清单）仍是**唯一零资质、零客户端外呼**的合法路径，**建议维持**。
5. 可选 P1（低成本、可验收）：**「粘贴取件短信/通知文本 → 端侧规则解析」**（用户自己粘贴到输入框，不调剪贴板、不新增云函数/集合/接口；端侧先掩码手机号/长数字）。P2/不做：线下与校园驿站/校方签数据合作（需企业主体或校方背书）。
6. 口径影响：**不需要改「永不收集完整手机号」**；零金额口径不受影响（第三方接口计费属运营成本，不进程序字段/文案）。

**待拍板**：Q3（是否接受结论；是否追加 P1 粘贴解析）。

---

### 1.4 第 4 条：兼职取件清单多站点单只按首个站点排序

**原话**：「兼职端取件清单有一个bug：同一个订单出现多个站点似乎只按首个站点排序。」

**现状证据（属实，且是已写进文档的设计）**：
- 分组键 = **首个有站点的件**：`pages/partner/workbench/parts/parcel-view.js:115-124 stationKeyOf`；工作台 `parts/group-view.js:218-239`（注释「跨站点单只归一组」）；兼职取件清单 `pkg-partner/pages/pick-list/parts/pick-view.js:163-186`（注释「首件站点定组」）。
- **组内排序键也是整单的**：`parcel-view.js:90-113` 的 `tierOf`/`routeNumberOf` 取「整单最差件」→ 多站点单在 P1 组里的位置由它 P6 的件决定（真实缺陷）。
- UX 明文写了该行为：`docs/ux/V4_UX_PARTNER.md:551/697/1024`；`docs/delivery/V4_QA_CHECKLIST.md:165`。
- 服务端数据没丢：DTO 逐件下发 `parcels[].stationId/stationName`（`order/_dto-fields.js:20-47`、`order/_dto.js:367`）。
- 现有补偿仅展示：行内站点聚合 chip（`parcel-view.js:136-154`、`workbench/index.wxml:140`）与跨站件行首站点前缀（`pick-view.js:75-93`）。

**方案**：

| 选项 | 说明 | 代价 | 结论 |
| :-- | :-- | :-- | :-- |
| **A 按件站点分组（推荐，与第 5/6 条同批）** | 一单在其每件所属站点组各出现一次，行内只列本站件 + 「另 N 件在 P6」提示；组内四档按**本站件**算；组头计数同时给单数/件数 | 改工作台/清单分组与排序纯件 + 两条 selftest + UX 口径；M | ✅ 推荐 |
| B 只修组内排序（最小修） | 仍首站定组，组内序改用「本站件」；多站单只在一个组 | 1 天内可修，但不满足「每个站点都看到」 | 可作为批 24 热修；与 A 同批则不必 |
| C 一包一行平铺 | 每件一行（key=orderNo#itemIndex），彻底贴合「每码独立」 | 订单级动作/计数/选中语义全要重做；L | 只在第 5 条选「真件级」后再评估，不单独做 |

**影响面**：`parcel-view.js`、`group-view.js`、`pick-view.js`、`workbench/index.wxml`、`pick-list/index.wxml`、`selftest-order-workbench`、`selftest-partner-pages`、`selftest-pick-list`、UX_PARTNER §4.3/§4.16、QA F24/AC4。

**待拍板**：Q4（与第 5/6 条一起）。

---

### 1.5 第 5 条：一单多快递时每件独立取件

**原话**：「一个订单多个快递时，允许对每个快递进行独立取件操作。」

**理解与补全**（关键语义必须定，否则实现会漂移）：
1. **件级数据**：`parcels[].pickedAt`（服务端时间；可加 `pickedByNo` 审计用），`picked = !!pickedAt` 由 DTO 派生；旧单兼容：`status ∈ {PICKED,DELIVERED,COMPLETED}` → 全部件视为已取；`ACCEPTED` → 全未取。
2. **订单状态聚合**：订单 `PICKED` = **全部件已取**的派生结果；部分取件时订单仍是 `ACCEPTED`，但 DTO 新增 `pickedCount/totalCount`（顾客进度显示「已取 2/3 件」）。
3. **动作**：`order.markPicked` 增可选 `itemIndex`（缺省=整单全部件，保持批量兼容）；`order.unmarkPicked` 同样支持 `itemIndex`；服务端守卫：件下标越界 `VALIDATION_FAILED`、该件无码且非代寄 `INVALID_STATE`、非 `ACCEPTED`（取件）/非 `PICKED|ACCEPTED`（撤销）非法。
4. **事件**：新增 `PARCEL_PICKED` / `PARCEL_PICKED_REVERTED`（payload 带 `itemIndex`）；最后一次取件同时写订单级 `PICKED` 事件（顾客进度条只认它）。
5. **送达/异常/取消/自动完成**：仍**整单**（用户只要求取件独立）；`markDelivered` 维持要求订单 `PICKED`（即全部件已取）。
6. **撤销**：推荐逐件「撤销已取」在订单 `PICKED/ACCEPTED` 且未送达前可用（不沿用 5 秒条；5 秒撤销条仍只服务整单动作）；撤销导致不再全取 → 订单回 `ACCEPTED`。
7. **顾客可见**：订单详情逐件展示「已取/待取」；列表行/进度条显示件级进度；顾客不可对单件操作。
8. **统计/计数**：单量仍按订单计（合并窗口不变）；工作台 counts 不变（P1 可加件数）。
9. **权限/测试隔离**：仅该订单当前归属兼职可操作（含第 1 条转单后的新归属人）；测试单同口径。

**现状证据**：D23 明文（CONTRACT:230/349、DATA_MODEL:473）；状态机 `shared/order-state.js:40-45`（无 itemIndex）；`order/markPicked.js:9-37`（整单 pickedAt）；DTO 件字段无 picked（`_dto-fields.js:20-43`）；客户端整单工具条（`workbench/parts/row-actions.js:19-89`、`pkg-partner/pages/pick-list/index.js:326-365`）。

**方案**：

| 选项 | 说明 | 代价 | 结论 |
| :-- | :-- | :-- | :-- |
| A 仅本机勾选 | 复用顾客端「我已取到」本机标记思路，不写服务端 | 零服务端改动，但换设备丢失、进度不真实、兼职端无法据此确认 | ❌ 不推荐 |
| **B 真件级（推荐）** | `parcels[].pickedAt` + 逐件动作/事件；订单 PICKED 派生；其余整单 | 动状态机/DTO/守卫/DTO actions/两条端 + 判据；L | ✅ 推荐（需改 D23 口径） |
| C 订单仍整单一次取件 | 只做视觉逐件展示/勾选，提交仍一次整单 | 最小，但不满足「独立取件」 | ❌ 不满足需求 |

**影响面**：`shared/{order-state,enums,actions}.js`、`order/{markPicked,unmarkPicked,_common,_dto,_dto-fields,listPartner}.js`、`api/middleware/ratelimit.js`、工作台/清单/详情页、顾客详情/列表、`cleanup`（无需改自动完成，仅确认不依赖件级）、`selftest-order-*`；文档 CONTRACT §4/§5/§5.1/§5.3、DATA_MODEL §2.5/§8.4、UX 两册、QA；**无新集合/索引**。

**待拍板**：Q4（聚合语义/撤销窗口）。

---

### 1.6 第 6 条：一单多取件缩进区分、每码独立显示、独立已取件入口

**原话**：「同一个订单多个取件 采用缩进的方式进行区分，且每个取件码都需要独立显示，拥有独立已取件入口。」

**理解与补全**：
1. **视觉**：订单行保持一行摘要（状态/订单号/宿舍锚/件数），其下**缩进**渲染逐件行（建议左缩进 32rpx + 左侧竖线）；单件单不缩进、不显示「第 1 件」前缀（避免视觉噪声）。
2. **每件独立显示**：件号（第 n 件）、站点名（跨站时高亮）、取件码（大字等宽）、柜号、运单尾号、需查明/识别失败标记；长码允许换行不截断。
3. **独立入口**：每件行尾一个动作按钮——未取「已取件」、已取「撤销已取」；按钮为行内小按钮（≥88rpx 可点区域）；批量/整单工具条仍在订单行级（接单/送达/异常/转单），不重复。
4. **交互冲突**：逐件操作不弹二次确认（可撤销）；多选批量取件仍按订单勾选（提示「将标记整单全部件」）；工作台的「需查明·补码」仍整单入口、按件定位到具体件（现有 panel.multi 已按件选，`workbench/index.wxml:209-219`）。
5. **取件清单页**：待取件（ACCEPTED）按站点组显示时，每件一行、每件独立按钮（与第 4 条 A 方案联动）；待送达（PICKED）仍按楼层/订单整单（全部件已取）。
6. **可访问性**：缩进不改变行点击区；颜色+文字双编码（已取=绿底+「已取件」文字）。

**现状证据**：工作台行把多件压成一条（`workbench/index.wxml:131-175`；`row.parcelCountText` 仅件数 tag）；件级信息只在「补码」面板按件切换（`workbench/index.wxml:209-219`）；取件清单件行只读可复制（`pick-view.js:75-112`、`pick-list/index.wxml:69-71`）。

**方案**：随第 5 条 B 方案一并做（无独立口径）；若第 5 条选 A/C，本条只做视觉缩进、无真实入口（不推荐）。

**影响面**：`workbench/index.{wxml,wxss,js}` + `parts/{parcel-view,row-actions,group-view}.js`、`pick-list/**`、`pkg-partner/pages/order-detail/**`、顾客详情（只读展示件级状态）、`selftest-*`、UX_PARTNER §4.3/§4.16、QA。

**待拍板**：Q4/Q6（按钮文案：「已取件」/「已取到」/「取到了」，建议「已取件」）。

---

### 1.7 第 7 条：顾客邀请顾客，被邀请者默认绑邀请者的兼职

**原话**：「新添允许顾客邀请其他顾客功能，被邀请顾客默认绑定邀请者绑定的兼职人员。」

**理解与补全**：
1. **复用现有链路**：绑定卡 path=`/pages/launch/index?bind={partnerNo}` → 隐私闸（D37）→ 邀请卡 → 隐私同意+资料完整后 **D38 自动 `bind.create`**。因此「被邀请顾客默认绑定邀请者绑定的兼职」= 让**顾客也能生成这张绑定卡**即可，零新接口。
2. **卡片内容**：仍只带 `partnerNo`（不带邀请者编号/昵称/头像/宿舍/尾号）——不扩大 PII 面；标题按角色分两句（兼职「我在做校园代取…」/ 顾客「同学邀请你绑定我的兼职」）。
3. **是否需要记录「谁邀请了谁」**：MVP 建议**不记录**（需求没要求、避免把顾客编号放进卡片/URL）。若需要统计/后续激励：用**一次性邀请 token**（新集合或 `bindings.invitedByToken`）而不是把 `customerNo` 放 URL（customerNo 现口径仅本人/绑定兼职/开发者可见，`CONTRACT:177`，直接外发是隐私扩面）。
4. **已绑定/换绑**：邀请者 B 已绑同一位兼职 → 提示「已绑定·去下单」不重复 create；已绑其他兼职 → 走 D28 一次确认换绑（不静默换绑）。
5. **失效路径**：邀请者已解绑 → 旧卡仍视为该兼职的卡（卡=兼职卡）；该兼职停用/注销 → 邀请卡显示停用/注销文案（现有 role 页已覆盖）；测试兼职对真实顾客 `NOT_FOUND`（天然失效）。
6. **入口**：建议「我的」页主入口「邀请同学」+ 现有分享按钮在已绑定时产出绑定卡；其他业务页的转发仍保持通用卡（避免误发）；朋友圈维持三页静态（D36 不变）。
7. **限流/防刷**：沿用绑定侧 D39（60 秒 5 次）与 `partner.getPublic` 预算；不新增。
8. **隐私文本**：卡片不含 PII，无需新增披露（若做「邀请关系记录」则需披露「邀请人编号」）。

**现状证据**：`utils/share/index.js:34-48`（顾客恒通用卡）；`pages/profile/parts/view-model.js:189` 顾客 `partnerCard=null`；`pages/role/index.js:209-245` 邀请卡五态；`bind/create.js` 守卫与 D38 自动绑定（`pkg-customer/pages/bind/parts/auto-bind.js:56-120`）。

**方案**：

| 选项 | 说明 | 代价 | 结论 |
| :-- | :-- | :-- | :-- |
| **A 复用绑定卡（推荐 MVP）** | 顾客在「我的」可分享其绑定兼职的卡；零新增字段/集合/接口；不记录邀请关系 | S~M（纯件 + 页面入口 + 测试/文档） | ✅ 推荐 |
| B 记录邀请关系 | 卡片加一次性 token，服务端校验并写 `bindings.invitedByToken`（或新集合）；可统计可撤销 | 新集合/字段 + 接口 + 隐私披露 + 清理；M~L | 若你要「谁邀请谁」统计/激励再选 |
| C 把邀请者 customerNo 放卡片 | 实现最省但违反 §3.1 可见性口径，等同把顾客编号外发 | 隐私扩面 | ❌ 不做 |

**影响面**：`utils/share/{index,handlers}.js`、`pages/profile/**`、`pages/role/index.*`（文案/标题）、`config/route.js`（仅 B 需扩参）、`tools/selftest-share.js`/`check-share`（卡片白名单判定）、文档 CONTRACT §8/§13、UX_CUSTOMER、QA、隐私（仅 B）。

**待拍板**：Q7。

---

### 1.8 第 8 条：兼职端客户页筛选器

**原话**：「兼职端客户页新添筛选器。」

**理解与补全**：
1. **筛选维度（建议一期）**：全部 / 资料未完善（`dormKey===''`）/ 按苑（D/X/N/B/C）/ 有备注（`partnerNote` 非空）；关键词搜索保留。
2. **「有进行中订单」**：D54 已把 `activeOrderCount` 收窄到**本页**（`listBindings.js:73-80`），服务端全量筛会破查询预算 → 一期只对**已加载行**客户端筛并明示「仅当前已加载 N 条」；二期再议。
3. **排序**：保持 `dormKey` 自然序 + roomTag（现口径），不新增 sort；「最近绑定」二期（需扩游标形状）。
4. **服务端入参（只增）**：`zone/buildingNo/profileIncomplete/hasNote`（+现有 keyword/cursor/limit），在 `listBindings.js` 过滤链、cursor 之前执行；无需新索引；`_customer.js` 已 497/500 行，**先拆排序/游标段再改**。
5. **交互**：chips 一行横滚（全部/资料未完善/苑/楼栋/有备注）+ 「重置」；状态保持（返回页面不丢）；筛选空态与真空态文案分离（UX_PARTNER:887 已要求）；D54 流式/骨架/行级 diff 不变。
6. **性能**：筛选变化从头拉一页（cursor 重置），走现有分页；不新增聚合计数（chips 不带数字）。
7. **测试隔离**：测试账号行不可被真实兼职看到（现口径），筛选不改变。

**现状证据**：服务端仅 3 入参（`listBindings.js:82-102`；`_customer.js:75-81/84-96/211-225`）；客户端只有 keyword（`pages/partner/customers/index.wxml:17-26`、`index.js:17-40/159-184`）；行 DTO（`bind/_common.js:123-142`）；`_customer.js` 497/500 贴边（CONTRACT:646 已提示先拆件）。

**方案**：一期 chips（推荐）→ 二期「有进行中单/最近绑定」。**影响面**：`partner/listBindings.js`、`partner/_customer.js`（先拆）、`pages/partner/customers/**`（wxml/wxss/js/parts/list-model.js）、`utils/customer-view.js`、`selftest-partner-customers/partner-pages/query-window`、DATA_MODEL §7.4、UX_PARTNER §3.5、QA（新增真机项）。**无新集合/索引**。

**待拍板**：Q8。

---

### 1.9 第 9 条：下拉到底部显示不全（普遍 bug）

**原话**：「当前普遍存在下拉底部无法完全显示的bug。」

**现状证据（系统性，非单页）**：
1. **根因 1：tabBar 高度没进全局 layout**——`.page-body{min-height:100vh;padding:24rpx 24rpx calc(24rpx + env(safe-area-inset-bottom))}`（`app.wxss:28-32`），而自定义 tabBar 固定占 `100rpx + safe`（`custom-tab-bar/index.wxss:1-16`）→ **每个 tab 页底部实际被压约 76rpx**；全仓 32 页根节点都用 `.page-body`（grep 32 命中）。
2. **根因 2：底部条/弹层用「目测静态垫高」**，三套数值互不一致且部分缺 env：`workbench/parts/list.wxss:2`（220rpx 直接覆盖 page-body）、`workbench/parts/overlay.wxss:91-104`（120rpx 对约 180rpx 批量条）、`pkg-partner/pages/pick-list/index.wxss:168-180`（160rpx、无 env）、`pkg-partner/pages/order-detail/index.wxss:78-111`（零余量）、`pages/profile/index.wxss:4-5`（48rpx 且覆盖 safe-area）；后台弹层 `invite-codes/index.wxss:47-67`、`account-switch/index.wxss:66-86` 同样缺 env。
3. **根因 3：下拉刷新开关与 handler 脱钩**——23 页有 `onPullDownRefresh`，仅 12 页 `enablePullDownRefresh:true`（如 `pkg-customer/pages/pickup-list/index.js:59-61` 有 handler，`index.json:1-3` 未开 → 下拉无响应；`pkg-admin` 全 10 页同）。
4. 其它：`pages/launch` 100vh 居中无滚动（小屏/大字号下隐私闸按钮可能被裁，`pages/launch/index.wxss:4-9/133-141`）；全仓**无纵向主 scroll-view**（横向 filter 与 launch 52vh 除外）→ 不是「scroll-view 高度算错」，是**页面底垫不足**。
5. 已有做对的参照：`pages/partner/customers/index.wxss:101-106`（120rpx + env，D54 落地）。

**修复方案（推荐 P-A，系统性）**：
1. `app.wxss` 增 token：`--v4-tabbar-h:100rpx`、`--v4-safe-b:env(safe-area-inset-bottom)`、`--v4-inset-tab:calc(var(--v4-tabbar-h)+var(--v4-safe-b))`、`--v4-inset-bar:calc(160rpx+var(--v4-safe-b))`；新增 `.page-body--tab`（tab 页必用，补足 tabbar+safe）与 `.page-body--bar`；禁止页面自造底垫常量。
2. 抽 `components/bottom-bar`（自带 env、可 `createSelectorQuery` 实测高度回填 spacer），替换 3 处静态 `.bottom-safe`；撤销条/批量条/详情操作条统一。
3. 全局审计 32 页：tab 页换 `.page-body--tab`（顾客 3+兼职 3+「我的」+新取件码伪 tab）；底部固定元素统一组件；`launch` 加可滚动兜底。
4. **3 条机械门禁**（防复发）：① tab 页根 class 含 `page-body--tab`；② wxss `position:fixed`+`bottom:0` 必含 `env(safe-area-inset-bottom)`（或使用组件）；③ 有 `onPullDownRefresh` 的页面 json 必须有 `enablePullDownRefresh:true`。
5. 真机点检（只能你验）：iPhone（home indicator）/iPhone SE/Android 三键导航/系统大字号，逐页滚到底看最后一项、批量条、撤销条、底部弹层。

**影响面**：`app.wxss`（S0 单写者）、32 页根 class、`custom-tab-bar/index.wxss`、~10 处底部条/弹层样式、`tools/check.js`（新判据/基线）、若干 selftest、QA §AD/§AC 新增真机项。**无服务端改动、无新页面**。

**待拍板**：Q9（是否采纳「系统性修复 + 3 条门禁」；仅做热修也需列出逐页清单）。

---

### 1.10 第 10 条：顾客取件清单升为一级入口、改名、只留自建取件码

**原话**：「顾客端把取件清单独立到与首页、订单、我的同级，修改名称，且该页面不显示上传的订单，只显示用户自己使用的取件码，只需提供写入和删除等能力。」

**现状证据**：
- 现页 `pkg-customer/pages/pickup-list/index`（分包）：上半 D57 本机区（`index.wxml:5-47`，能力：识别截图/手动粘贴/勾选已取到/复制/删除/清空，`index.js:196-334`；storage 键 `ex_college_v4.pickcodes`、上限 50、去重最新在前，`utils/storage.js:249-250/303-434`；端侧 OCR `parts/local-ocr.js:19-98`），下半 D26 进行中订单区（`index.wxml:49-102`、`index.js:90-194`）。
- **平台硬约束**：tabBar 页必须在主包；`tabBar.list` 官方**最少 2、最多 5 项**（官方文档 app.json#tabBar），当前 5 项已满（`app.json:66-97`）= 顾客 3 格 + 兼职 3 格共享「我的」；再加顾客第 4 格 = 6 个唯一页 → **平台不可能直接实现**。现有门禁 `tools/check.js:149-171` 也按 5 项校验。

**可选实现方式**：

| 选项 | 说明 | 代价/风险 | 结论 |
| :-- | :-- | :-- | :-- |
| **C 伪 tab（推荐）** | 页面迁到主包（如 `pages/customer/pickcodes/index`），把底部栏视觉抽成共用组件（`custom-tab-bar` 与页面共用），页内自绘 4 格底部栏、其他格用 `wx.switchTab`/`wx.reLaunch` 跳转；**app.json 仍 5 项** | 失去原生 tab 部分语义（页面栈/`getTabBar()` 选中态需自管、需给页面 json 配 `enablePullDownRefresh`）；新增 2 张 tabbar 图标；架构口径要写清（ARCHITECTURE） | ✅ 视觉同级且不动现有 IA |
| A 兼职「客户」退 tab | 腾出一项给顾客真 tab：tabBar 变「首页/订单/取件码/工作台/我的」，兼职客户页改从工作台进入 | 改动兼职 IA（D54/UX_PARTNER 联动）；真 tab 语义最标准 | 备选（你更看重标准 tab 时） |
| B 订单并入新页 | 顾客 3 格：首页/取件码(含订单)/我的 | 违背「与订单同级」 | ❌ 不做 |
| D 维持 3 tab + 首页入口 | = 现状 + 改名 | 不满足「同级」 | ❌ 不做 |

**页面内容调整（推荐）**：
1. **删除 D26 订单区**（D26 是 2026-10-22 用户指令，删除前先改 CONTRACT）：`index.wxml:49-102`、`index.js` 的 `loadAll/applyOrders/...`、`parts/pickup-view.js`、storage `pickupChecks` 相关；订单详情仍逐件显示站点+取件码（`pkg-customer/pages/order-detail/index.wxml:64-68`），不丢能力。
2. **只保留 D57 本机取件码**：写（截图识别/手动粘贴/改「已取到」标记）+ 删（单条/一键清空）+ 复制；不做订单关联、不做服务端存储；READONLY 会话只渲染说明卡并拒写（现逻辑保留）。
3. **改名**：tab 文字建议「**取件码**」（3 字，避开兼职端「取件清单」同名歧义）；页标题建议「**我的取件码**」；页内区块标题可保留「我的取件码（本机）」。
4. **入口**：首页原「取件清单」卡删除（`pages/customer/home/index.wxml:65-74` 附近），避免与 tab 重复；首用引导第 3 步文案如提「清单」处同步。
5. **同页分享**：本机取件码含 L3 明文且只存本机，**建议该页不提供分享/转发**（从 D36 的 19 页业务页清单中排除），减少误把码发出去。
6. 保留页面固定说明「只存这台手机、不上传、换机/清缓存丢失」。

**影响面（C 方案）**：`app.json:2-10`（主包 pages 增页、分包减页）、`app.json:116-119`（preloadRule 不变）、`custom-tab-bar/**`（抽共用组件、顾客 4 格）、`pages/profile/index.js`（顾客 selected 2→3）、`pages/customer/home/**`（删入口卡）、页面目录迁移与其 require 路径、`assets/tabbar/*`（新增 2 张 81×81 PNG，自制）、`utils/storage.js`（删 pickupChecks 相关需评估导出引用）、`tools/lib/project.js`（ALL_PAGES 32→33）、`tools/check.js`（页数/门禁）、`tools/selftest-order-customer`/`pickup-local-cases`/`pick-list`/`performance`/`profile`/`share-pages`、CONTRACT §7/§13 D26/D57、DATA_MODEL、ARCHITECTURE §2/§3.5、ENGINEERING（页数）、UX_CUSTOMER、QA、review 材料（截图/图注）、`docs/README.md`。**无云函数改动、无新集合/索引**。

**待拍板**：Q10（C/A 选择；tab 名；首页入口卡删除；是否禁本页分享）。

---

### 1.11 第 11 条：首页「上传取件码截图下单」改为「下单」

**原话**：「顾客端首页的上传取件码截图下单改为下单。」

**现状证据**：主 CTA `pages/customer/home/index.wxml:86`（`{{canOrder ? '上传取件码截图下单' : orderDisabledReason}}`）；近似文案 4 处：`:77` 空态「还没有进行中的订单，上传取件码截图就能下单。」、`pages/customer/home/parts/guide-view.js:10` 引导第 2 步「截图下单」、`pages/role/index.wxml:6`「上传取件码截图，请兼职帮你取件送到宿舍。」、`pkg-customer/pages/help/index.js:74`「顾客上传取件码截图下单…」；下单页标题 `pkg-customer/pages/order-create/index.json:2`「上传取件码下单」、步骤标题 `order-create/index.wxml:27`「上传取件码截图（0~10 张）」。
**方案（推荐）**：主 CTA 改「**下单**」；空态改「还没有进行中的订单，点「下单」上传取件码或手填。」；引导第 2 步标题改「下单」；角色页副标题改「下单后请兼职代取，送到宿舍。」；帮助页首段去掉「上传取件码截图」前置、改为「顾客下单…」；**功能/跳转/截图链路不动**。下单页步骤标题是否一起改为「取件截图（0~10 张）」由你定（不影响功能）。
**影响面**：`pages/customer/home/index.wxml`、`parts/guide-view.js`、`pages/role/index.wxml`、`pkg-customer/pages/help/index.js`、可选 `order-create/index.json`/`index.wxml`、`tools/selftest-order-customer.js:608`（J14 断言三步标题）、UX_CUSTOMER §3.1/§3.3、QA A23、提审材料 `docs/delivery/review/02:21`（截图图注需重拍/改写，属人执行）；**无服务端改动**。
**待拍板**：Q11（是否连带统一其余 4 处 + 下单页标题）。

---

## 2. 交叉影响与冲突清单（必须一起处理）

| 冲突/联动 | 内容 | 处理顺序 |
| :-- | :-- | :-- |
| 第 5/6 条 vs **D23** | D23 明文「订单级动作作用于全部包裹、不设包裹级状态」（CONTRACT:230/349）；改为件级=改口径 | 先改 CONTRACT §4/§5/§5.1/§5.2/§5.3 + DECISIONS 新 D；再 DATA_MODEL/UX/QA；最后代码 |
| 第 4 条 vs **UX §4.3** | UX_PARTNER:551/697/1024 与 QA:165 明文「跨站点单只归一组」；按件分组是口径变更 | 同上，同批回写 |
| 第 1/2 条 vs **D3 / §10** | 邀请码现只能开发者发（§10:474）；B 方案（子账号）需改 §1.1/§10；A 方案不动 | 裁决后随批改 |
| 第 1/2 条 vs **D4/D19/D42 隐私边界** | 顾客资料会因转派/队员履约被未绑定兼职看到（履约必需）；需隐私文本新增披露与 DTO 最小化（不展示头像/昵称/客户档案） | 与实现同批改隐私指引 + 端内文本 + QA |
| 第 7 条 vs **D36/§3.1** | 顾客也可发绑定卡（卡类型不变）；若记录邀请关系则新增字段/披露；不要把 customerNo 放卡片 | 裁决后随批 |
| 第 10 条 vs **D26/D57 + 平台 5 tab** | 删 D26 区、升一级入口；tabBar 5 项硬限制 → 需选 C/A；改 CONTRACT §7 页表与页数门禁 | 先裁决再改 |
| 零金额/提审 | 11 条均不引入交易语义；第 3 条第三方计费属运营成本，不进程序字段/文案；第 2 条团队不得引入任何交易/分账语义 | 全批保持零金额扫描 0 命中 |
| 第 9 条 | 纯前端布局修复，但触及 `app.wxss`（S0 单写者）与 32 页，需与第 10 条页面迁移同批排期避免二次改 | 先修底座再迁页 |

---

## 3. 需要你拍板的问题（Q1~Q11）

| 编号 | 问题 | 选项（推荐在前） |
| :-: | :-- | :-- |
| **Q1** | 第 1 条转单流程怎么走？ | A 目标兼职确认接收（推荐）／B 直接改派（最简）／C 退回待接单；转单范围：任意 ACTIVE 兼职（凭编号，推荐）／仅本队（随 Q2）；只允许 ACCEPTED（推荐）／PICKED 也可 |
| **Q2** | 第 2 条「子队员」形态？ | A 轻量协作（已是兼职者被邀请入队，推荐 MVP）／B 主兼职直接发子邀请码开子账号（改 D3）／C 只做转单推送；顾客能否绑子队员：不能（推荐）／能；队员能否代客下单：暂不能（推荐）／能；队员上限（建议 5） |
| **Q3** | 第 3 条研究结论是否接受？ | 接受「不可行」并维持现状（推荐）／追加 P1「粘贴短信文本端侧解析」／线下与驿站/校方谈数据合作（P2，不做本期） |
| **Q4** | 第 4/5/6 条件级改造口径？ | 件级取件：B 真实件级+订单状态聚合（推荐，全件取完才「已取件」）／A 仅本机勾选／C 仅视觉；多站点分组：A 按件站点分组（推荐）／B 只修组内排序；订单后续：送达/异常/取消仍整单（推荐） |
| **Q5** | 件级撤销怎么算？ | 未送达前可逐件撤销（推荐）／仅 5 秒内／不支持撤销 |
| **Q6** | 第 6 条按钮文案与交互？ | 「已取件」/「撤销已取」（推荐）；逐件操作免二次确认（可撤销，推荐）／需二次确认 |
| **Q7** | 第 7 条邀请是否记录关系？ | A 不记录、复用绑定卡（推荐）／B 记录邀请关系（一次性 token，需新集合/字段+隐私披露） |
| **Q8** | 第 8 条筛选器一期维度？ | 资料未完善/按苑/按楼栋/有备注（推荐）；「有进行中订单」仅对已加载行（推荐）／二期做全量 |
| **Q9** | 第 9 条修复方式？ | 系统性修复+3 条门禁（推荐）／只做逐页热修（不推荐，会复发） |
| **Q10** | 第 10 条 4 格实现方式？ | C 伪 tab 自绘底部栏（推荐，不动现有 IA）／A 兼职「客户」退 tab 换真 tab；tab 名「取件码」（推荐）／「取件清单」／「我的取件码」；首页入口卡删除（推荐）；本页禁分享（推荐） |
| **Q11** | 第 11 条文案范围？ | 首页主 CTA + 空态 + 引导 + 角色页 + 帮助 统一（推荐）／仅首页主按钮；下单页标题是否改「取件截图」（可选） |

---

## 4. 建议批次排期（裁决后）

| 批次 | 内容 | 说明 |
| :-- | :-- | :-- |
| **批 24 前端结构/布局/文案/筛选** | #9 全局底部修复 + 3 条门禁；#10 伪 tab 化 + 删 D26 区 + 改名 + 首页入口调整；#11 文案统一；#8 客户页筛选器 | 无订单模型变更、无新云函数；第 10 条先改 CONTRACT §7/§13；真机项交你点检 |
| **批 25 件级履约改造** | #4 按件站点分组 + #5 件级取件 + #6 缩进逐件展示/独立入口 | **先改 D23 口径**（CONTRACT §4/§5/§5.1/§5.3 + 新 D + DATA_MODEL/UX/QA），再服务端/客户端；判据先红后绿 |
| **批 26 团队与转派** | #2 子队员（按 Q2 选 A/B）+ #1 转单邀请（目标限本队或任意） | 先改 D3/§10（若 B）/§5/§10；隐私文本与 DTO 最小化同批；XL，需拆 26a/26b |
| **批 27 顾客邀请 + 可选 P1** | #7 顾客绑定卡（+ Q7 若记录关系）；#3 若选 P1「粘贴短信文本解析」 | 纯件 + 页面入口 + 分享/隐私文本；无服务端（除 Q7-B） |

> 每批 DoD 沿用现有纪律：先口径文档 → 再判据 → 再代码 → 首红证据 → 复绿读数；`check.ps1` 4 步退出码 0 + 真实输出 + 文档回写（CONTRACT/DECISIONS/DATA_MODEL/UX/QA/ARCHITECTURE/CHANGELOG/STATE/TD）+ 真机项交用户点检；不写死测试条数。

## 5. 风险与依赖

| 风险/依赖 | 说明 | 处理 |
| :-- | :-- | :-- |
| 第 5 条推翻 D23 的一半 | 状态机/事件/DTO/动作矩阵/工作台/顾客进度/统计多处联动；旧单无件级字段 | DTO 派生兼容 + 无数据迁移（D11 空库起）；判据覆盖旧单形态 |
| 第 10 条平台限制 | tabBar 最多 5 项；伪 tab 失去原生 tab 部分语义 | 先裁决 C/A；架构文档写清；真机确认切换体验 |
| 第 1/2 条隐私扩面 | 顾客资料对未绑定兼职可见（履约必需） | DTO 最小化（不回头像/昵称/档案）+ 隐私文本披露 + QA 负向用例 |
| 第 2 条准入口径 | B 方案要改 D3；A 方案则「子队员必须先有兼职账号」 | 由 Q2 定；A 方案不动 CONTRACT §1.1 |
| 第 9 条 32 页审计 | 改动面大、易漏页；样式全局单写者 | 门禁机械检查 + 逐页真机点检 |
| 第 4/10 条文档回写量大 | CONTRACT/UX/QA/DATA_MODEL/ENGINEERING/README/review 材料共 20+ 处 | 按批次清单逐项勾销，收口门禁兜底 |
| 改动与「提审材料包」冲突 | 批 22/23 的 25 张真实截图与 6 份说明基于旧页面 | 新批完成后需重拍/更新截图与图注（只能人执行） |

## 6. 本稿边界（明确未做）

- 未改任何代码、未改 CONTRACT/DECISIONS/UX/DATA_MODEL、未动门禁、未新增 D 编号（编号待你裁决后登记，接续 D57）。
- 未承诺工作量为固定人日/测试条数；L/M/S 仅为相对规模。
- 真机效果（tab 切换手感、逐件按钮可点性、底部安全区、筛选体验、邀请落地）**只能你点检**，agent 不代勾。
- 第 3 条不做第三方外呼/接入口改造；研究引用以官方文档为准（链接见附件）。

---

## 7. 裁决回收（2026-11-02，用户答复后）

> 用户答复原文：Q1「A 任意兼职」；Q2「B 顾客不绑定子队员」；Q3「接受推荐」；Q4「采用推荐」；Q5「采用」；Q6「采用」；Q7「不记录 注意被邀请的顾客绑定的是邀请者绑定的兼职人员」；Q8「采用推荐」；Q9「采用推荐」；Q10「采用推荐」；Q11「采用推荐」。

| 编号 | 用户答复 | 最终裁决 | 登记 | 批次 |
| :-: | :-- | :-- | :-- | :-- |
| Q1 | A 任意兼职 | 转派：目标兼职确认接收；范围=任意 ACTIVE 兼职（凭完整编号）；仅 ACCEPTED 可发起 | D58 | 批 26 |
| Q2 | B 顾客不绑定子队员 | 子队员：主兼职发子邀请码开子账号（改 D3）；顾客不绑子队员；队员不可代客下单；上限 5 | D59 | 批 26 |
| Q3 | 接受推荐 | 快递来源结论「本项目不可行」，维持现状；不做 P1 粘贴解析 / P2 数据合作 | D60 | 不做（研究归档） |
| Q4 | 采用推荐 | 件级真实取件 + 订单状态聚合；多站点按件分组；送达/异常/取消仍整单 | D61/D62 | 批 25 |
| Q5 | 采用 | 未送达前可逐件撤销已取（不沿用 5 秒条） | D61 | 批 25 |
| Q6 | 采用 | 缩进逐件、每码独立、「已取件/撤销已取」、逐件免二次确认 | D61 | 批 25 |
| Q7 | 不记录 | 顾客可发绑定卡；被邀请者绑定邀请者当前绑定的兼职；不记录邀请关系 | D63 | 批 27 |
| Q8 | 采用推荐 | 客户页筛选一期：资料未完善/按苑/按楼栋/有备注（**「有进行中订单」一期不做，列入二期**）；关键词保留、筛选变化重置游标 | D67 | 批 24 |
| Q9 | 采用推荐 | 全局底部安全区修复 + 3 条机械门禁 | D65 | 批 24 |
| Q10 | 采用推荐 | 取件码伪 tab 一级入口、改名「取件码」、删 D26 订单区、首页入口卡删除、本页禁分享 | D64 | 批 24 |
| Q11 | 采用推荐 | 首页「下单」+ 4 处近似文案统一；下单页标题不改 | D66 | 批 24 |

> 说明：Q1~Q11 的最终边界与验收见 CONTRACT §13 D58~D67 与 `docs/contract/V4_DECISIONS.md` D58~D67 段（以 CONTRACT 为准）。
