# 用户反馈定位报告（2026-10-28）

> 对象：第 1 批（兼职端）5 条反馈 + 截图 1 中的运行错误；第 2 批（顾客端测试）6 条反馈。共 11 个问题，分见 §1~§9 与第二部分（§10~§19）。
> 性质：**只读定位 + 结果汇总**；本报告为新增分析文档，**未修改任何代码 / 契约 / 门禁**；提交仅含本文档。
> 基线：两批调查均按 `HEAD=298dda0`；调查时工作树仅本报告未跟踪；以下文件:行均按该提交。
> 口径源：`docs/contract/V4_CONTRACT.md`、`docs/ux/V4_UX_CUSTOMER.md`、`docs/ux/V4_UX_PARTNER.md`、`docs/ux/V4_UX_DEVELOPER.md`、`docs/delivery/V4_QA_CHECKLIST.md`、`docs/governance/V4_TECH_DEBT.md`。
> 调查方式：第 1 批 5 条 + 第 2 批 4 条并行只读调查 + Lead 交叉复核；关键结论均带代码/提交证据，推断项单独标注。

---

## 0. 结论速览

| # | 用户反馈/截图 | 定性 | 根因（一句话） | 首次引入 | 处理级别 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| ① | 兼职分享的界面，新用户无法同意隐私政策 | 契约冲突 + 实现缺口（非分享批次代码回归） | 隐私同意闸只挂在 `pages/launch`；分享卡直接落地 `pages/role`，`launch` 不在页面栈，端内再无第二个「同意」入口；服务端写动作全部 `INVALID_STATE` | 分享卡 path 自批 3 起未变；分享批次（`b8435b1`）把分享放大成新用户主入口 | P0（拉新死路） |
| ② | 兼职端「我的」默认页面有误 | 功能回归 | 自动展开判定对兼职取了**顾客资料**的完成度：纯兼职 `customer=null` → 完成度恒 false → 每次新实例进「我的」都自动进入编辑态，整段摘要（编号/分享/经营/账号）被隐藏 | `bf74a1c`（批 10 A P1-1，2026-10-23） | P0（主 tab 默认态错误） |
| ③ | 顾客端绑定兼职限制设置不合理 | 规则/交互设计缺陷 + 文案三源不一致 | 「每天 5 次」实为**两个独立桶**（预览 5 + 绑定提交 5）；输入/落地自动查询、同编号重复查询、失败尝试、客户端读重试都计数；被拒的是预览桶，页面只写 5 次且文案与契约不符 | 配额自批 1~3 起；批 10 A 自动查询放大误耗；research F18 早已记录未修 | P1（需裁决口径） |
| ④ | 识别失败复核页 toast「t.decorateRow is not a function」 | 运行期回归（后台详情链路 100% 断） | `refreshRows()` 仍调 `this.decorateRow`，该 Page 方法已在抽件重构时删除；点行展开/深链进入必抛错并被 toast 原样弹出 | `08cd421`（批 8，2026-10-22） | P0（后台治理闭环不可用） |
| ⑤ | 绑定兼职流程能否更方便（用户反馈「不会绑定兼职人员」） | 体验/契约缺口（非缺功能；叠加 ① 隐私与 ③ 限流） | 主链路能通，但「点我是顾客丢邀请、已绑定必失败、资料不完整最后才拒、bind 页无返回、续跳只存内存、成功后无下一步、兼职侧缺邀请说明」等让用户在 5 种常见进入方式下走进死胡同 | 多数为既有实现缺口（F1/F2/F3 修后残留） | P1（先修 ①/③ 再做 A 档） |

**为什么上述问题都在，门禁仍全绿**：现有自检覆盖「纯件逻辑 + 静态规范」，不覆盖「页面状态装配 / Page 方法完整性 / 分享落地路径 / 限流实际消耗 / 绑定导航状态」，五类缺口均无判据（详见 §5、附录 A）。其中 ② 的测试甚至把错误行为当成期望锁死（`selftest-profile.js` 兼职自动展开断言）。

> 第 2 批（顾客端测试 ⑥~⑪）的速览表、逐项根因与裁决见 §10~§15；两批合并排期与裁决清单见 §17~§18。

---

## 1. 反馈 ①：兼职分享入口，新用户无法同意隐私政策

### 1.1 已证实的链路

1. 兼职侧「我的 → 分享绑定卡片」：`pages/profile/index.js:479-485` → `pages/profile/parts/share-card.js` → `utils/share/handlers.js:10-18` → `utils/share/index.js:32-46`。
   卡片 path：绑定卡 = `/pages/role/index?bind={partnerNo}`；通用卡 = `/pages/role/index`（零 query）。**分享批（D36）与实现一致**。
2. 新用户点卡片：平台以卡片 path 作为本次入口页；`app.onLaunch` 仍执行，但**不会先加载 `pages/launch`**（`app.js:28-38` 不读入口 path/query，只做云初始化与 bootstrap）。落地页 = `pages/role`。
3. `pages/role` 只做 `sync → loadBindCard(partner.getPublic，读动作) / hydrateBootstrap`，**全页无隐私判定、无隐私弹窗**（`pages/role/index.js:54-80`；`pages/role/index.wxml` 无隐私节点）。
4. 用户点「绑定这位兼职」→ 资料未完善 → `reLaunch /pages/profile/index?bind=…`（`pages/role/index.js:166-178`）。
5. 资料页自动展开编辑态（顾客未完善是 P1-1 的预期行为）；「保存 / 选头像」首写即被服务端拒绝：
   - 服务端写闸：`cloudfunctions/api/middleware/auth.js:180-194`，`users.privacyConsent` 缺失/版本不符 → `INVALID_STATE "请先同意最新隐私保护指引"`（含 `customer.saveProfile`、`upload.prepare`、`bind.create`、`partner.activate` 等全部 client 写动作）。
   - 端侧直出服务端 message：`api/client.js:140-147` → `pages/profile/parts/save-flow.js:60-81` toast。
6. 用户找「同意」入口：**不存在**。唯一同意弹窗在 `pages/launch/index.js:112-154`，但该页从未加载；「我的 → 隐私与协议」只跳帮助页只读全文（`pages/profile/index.js:393-398`）。退出重进若仍走卡片/最近使用，回到同一死循环。

补充：直落页并非「数据没水合」——`store.privacyConsent/config` 已由启动 bootstrap 正常写入（`app.js:62-67`、`store/index.js:128-135`），role 页具备全部判定输入，只是**不判定**。全仓 `consentStatus` 唯一生产调用 = `pages/launch/index.js:113`。

### 1.2 根因

| 编号 | 结论 | 置信度 | 证据 |
| :-- | :-- | :-- | :-- |
| R1 | 分享/深链落地页无隐私闸；自定义闸只存在于 launch → 新用户无同意入口、写全拒 | 高（已证实） | `utils/share/index.js:32-46`；`pages/role/index.js:54-80`；`pages/launch/index.js:112-154`；`auth.js:191-194` |
| R2 | **契约自相矛盾**：CONTRACT「launch 唯一启动页 + 首启隐私检查」↔ CONTRACT/D36「绑定卡 path=role」；且 launch 的 `bind/orderNo` 白名单透传从未实现 | 高（已证实） | `CONTRACT:424`、`UX_CUSTOMER:90-97/120/666-669/799` ↔ `CONTRACT:443`、`UX_CUSTOMER:573/606-608`；`pages/launch/index.js:53-55/202-212` 无 options |
| R3 | 版本变更重同意同样只在 launch 生效；任何非 launch 首启（分享卡、朋友圈「前往小程序」、未来订阅消息深链）在 `privacyVersion` 变更后同样「无入口 + 写全拒」 | 中高（已证实） | `pages/launch/index.js:112-129`；QA P20 只覆盖冷启动（`QA_CHECKLIST:326`） |
| R4 | 自定义 `users.privacyConsent` 与微信官方隐私弹窗是两套互不相通的平面：官方弹窗同意不会写 `users.privacyConsent`，用户会「同意了还被拒」 | 中（推断，需真机） | `api/privacy.js` 全模块零生产 require（仅测试字符串）；`wx.onNeedPrivacyAuthorization/requirePrivacyAuthorize` 全仓 0 处 |
| R5 | 2026-10-22 `-502001` 隐私写库事故若线上云函数未重部署，会以「点同意报错」复现；当前代码已修并有回归断言 | 低（历史先例） | `db/dao.js` `command.set`；`selftest-cloud` §7.3；lessons 卡片 |

**不是最近两批的代码回归**：`git show --name-only b8435b1` 未改 launch/隐私闸；分享卡 path 自批 3 起就是 role。但分享批次（`b8435b1`）把「转发」铺到 19 个业务页、首页/帮助/我的新增可见分享入口，**把既有缺口放大成拉新主路径**，且把 role 落地 path 写进 CONTRACT/QA/`selftest-share` 断言，修复时必须同步改口径与判据。

### 1.3 影响面

- 所有「未同意过 v4 隐私」的新用户，从兼职分享卡进入即死路：资料不能存、头像不能传、绑定不能确认。
- 版本变更后的存量用户，从分享/深链进入同样无入口。
- 朋友圈单页「前往小程序」落地路径同属「非 launch 首启」，需一并核查。
- 用户已看到的文案「请先同意最新隐私保护指引」与其实际可操作路径不匹配，属「文案说真话但无出路」。

### 1.4 修复选项（需先裁决）

| 方案 | 做法 | 优点 | 代价/风险 |
| :-- | :-- | :-- | :-- |
| **A（推荐）** | 分享卡 path 改经 launch（`/pages/launch/index?bind=…`；通用卡同）；launch onLoad 读 options、按白名单透传 bind/orderNo；先过隐私闸再分流到 role/bind/profile | 单一闸、贴合「唯一启动页」契约与 UX §1.2 参数优先级；彻底覆盖版本变更 | 多一跳/可能闪一下；要改 `config/route` 冻结决策形状（需 Lead 授权）；同步 CONTRACT/UX/QA/`selftest-share`/check #33 |
| B | 产品坚持 role 直落：role（及未来可直落页）内置同一隐私闸 | 不改落地 path、改动集中 | 「launch 唯一启动页」口径作废（需裁决）；launch 7 条精简文案会变第三份，必须先抽单源（TD-052 约束） |
| C | app.onLaunch 拦截入口 path/query 后 `reLaunch` launch | 集中入口 | onLaunch 内跳转时序/单页模式/参数白名单复杂；仍需 launch 透传，不建议单独用 |

共同要求：新用户「分享首启」与「版本变更后分享进入」两条必须进 QA 真机项；不得以整页/整目录白名单跳过门禁（AGENTS §7）。

### 1.5 关联文档/技术债

- **TD-004（开放）**：头像/昵称/隐私弹窗真机能力未实测——本次隐私问题须与官方弹窗面一起真机取证。
- **TD-009（已关闭，关闭依据已失真）**：关闭证据说隐私闸由 launch 接入、`api/privacy` 提供适配；但 `api/privacy` 现为**整模块零生产调用**（仅测试引用），且 role 从未接入。
- **TD-010（已关闭，不完整）**：原描述「launch/role 接入」，实际 role 从未接入（`git log -S privacyConsent/consentStatus -- pages/role` 为空）。
- **TD-052（已关闭）**：隐私文本单源；若新增 role 闸，必须先抽单源防止第三份漂移。
- **TD-061（开放）**：官方隐私指引入口未接——本次扩大为「整模块无消费者」。
- **TD-075（开放）**：分享/朋友圈真机效果未取证——本次应新增「分享首启隐私」用例。
- 既有审查 R-B1-26 / M-83 曾把「path 直落 role」记为 P3「暂无实际断点」；本次证明断点在隐私闸，属审查盲点。

---

## 2. 反馈 ②：兼职端「我的」默认页面有误

### 2.1 结论

**「有误」= 兼职视图首次进入「我的」就被自动展开成「资料编辑态」**（置信度约 0.85）。截图中第二张卡（昵称输入 + 头像行 + 取消/保存）只在 `editMode=true` 时渲染（`pages/profile/index.wxml:29-88`）；默认本应是摘要态（兼职编号 / 分享绑定卡 / 经营 / 账号 / 版本，`index.wxml:90-243`）。编辑态把摘要整段隐藏，所以用户直观看到「页面不对」。

已排除：角色串数据（编辑表单无苑/楼栋/宿舍/尾号/性别行，证明走的是兼职分支）、tabBar 错格（已显式 `selected:2`）、默认头像异常（默认头像=昵称首字色块，属设计）、标题错误。

### 2.2 根因（已复现）

- 批 10 A P1-1（`bf74a1c`）新增自动展开：`pages/profile/parts/view-model.js:212-226 shouldAutoOpenEdit`。
- `buildVm` 无论角色都把**顾客资料**派生的 `profileCard` 传给它（`view-model.js:198`；`buildProfileCard` 的 `complete` 来自 `customer.profileComplete`，`:129-141`）。
- 纯兼职账号 bootstrap 返回 `customer:null`（`bootstrap.js:144`）→ `profileCard.complete=false` 恒成立 → 每个新页面实例（冷启动后首次进 tab）都 `openEditForm()`（`pages/profile/index.js:185-199`）。
- 复现矩阵（node 直跑纯件）：

| 场景 | autoOpen | 说明 |
| :-- | :-- | :-- |
| 纯兼职（昵称已填、接单中） | true | **截图状态** |
| 双角色·顾客资料完整·当前兼职 | false | 反证：判定读的是 `customer` |
| 顾客完整 | false | 正确 |
| 顾客未完成 | true | 契约要求 |

- 回归引入：`bf74a1c`（2026-10-23）；`b8435b1` 虽改 profile（性别/分享）但未改该判定；批 10 B/C 未触碰 `pages/profile`。

### 2.3 契约偏差

- 自动展开条款只在顾客视图：`UX_CUSTOMER §3.5:238`、AC-C-71、QA A1；`UX_PARTNER §3.10` 只定义摘要态 + 显式编辑入口，**无自动展开**。
- 但 `tools/selftest-profile.js:389-418` 把「兼职资料未完成 → 自动展开」当成期望锁死（`:405-410`），且用例直接注入 `profileCard:{complete:false}`，**从未经过 `buildVm` 的兼职真实输出**——装配与判定两段各自绿、集成处断链。
- 连带：编辑态下摘要全部不可见 → QA B4「兼职激活后看我的出现编号」真机会直接失败；QA B4 尚未点检，所以由用户真机先发现。

### 2.4 修复建议

1. **完成度必须角色感知**（推荐严格按契约）：`buildVm` 产出 `partnerComplete`（`bootstrap.js:51` 已下发 `partner.profileComplete = displayName 非空`），`shouldAutoOpenEdit` 改收显式 `complete`；或 `if (!isCustomer) return false`——兼职一律默认摘要态，走现有「编辑资料」入口/激活流程。
2. 若产品确实希望兼职未完善也自动展开（契约未授权），须先改 UX_PARTNER 并留裁决，不能继续由实现与测试单方面固化。
3. 补 buildVm → shouldAutoOpenEdit 集成断言（纯兼职完整/未完成、双角色顾客完整、顾客完整/未完成），并修正 `selftest-profile.js:405-410` 的错误期望；测试条数以真实输出为准。
4. 修后按 ENGINEERING §8.6 回写 CHANGELOG/STATE；未修则登记新 TD + STATE 风险节。

P3 顺带项（不夹带）：兼职编辑入口形态/文案（契约「头像与昵称（可编辑）>」 vs 现状右上「编辑资料」）、消息（N）计数、兼职 onShow 头像刷新、兼职「恢复默认」文案、取消编辑后已上传头像文件成孤儿（契约未定义）。

### 2.5 关联技术债

- TD-004（开放）：头像/昵称真机能力未实测。
- TD-027（跟踪中）：头像票据一次性/保存自愈——修复回归需复验。
- TD-007/TD-009（已关闭）：头像压缩与默认头像策略，说明截图默认头像不是缺陷。
- 既有审查 M-74/R-B1-16（订单概览恒「—」，P3）与本问题无关，避免混修。
- 本问题**无既有 TD/审查条目**，建议新增（见 §5.2）。

---

## 3. 反馈 ③：顾客端绑定兼职限制设置不合理

### 3.1 限流事实表

| 维度 | 事实 | 文件:行 |
| :-- | :-- | :-- |
| 桶键 | `counters.rl:{scope}:{effectiveOpenid}:d{YYYYMMDD}`（UTC+8 自然日，非滚动） | `ratelimit.js:61-63`；`lib/time.js:22-25` |
| 配额 | 绑定提交 `bind.create` 5/日；预览 `partner.getPublic` 5/日；解绑 10/日；激活 5/日且成功回退 | `ratelimit.js:17-20` |
| 计数时点 | 中间件 validate 之后、handler 之前先 +1 再判上限 ⇒ **失败/被拒也计数**；仅激活有 `refundOnSuccess` | `middleware/index.js:11-20`；`ratelimit.js:102-140` |
| 消耗来源 | 卡片落地 role 预览、bind 落地缓存未命中、输入/粘贴自动查询、手动「查询」（同编号/连点都发）、客户端读动作自动重试（最多 3 次）、资料续跳超缓存 TTL | `pages/role/index.js:116-138`；`auto-query.js:57-127`；`client.js:12-17/162-184`；`preview-cache.js:11-14` |
| 失败计数 | 格式错在 validate 被拦（不计数）；**合法格式但不存在/停用/冲突等 handler 失败仍计数** | `ratelimit.js:113-139`；`bind/create.js` |
| 文案 | 云端唯一 message「操作太频繁，请明天再试」；`shared/error-copy.js:15` 却写「请半小时后再试」；UX §3.6 规定「今天尝试绑定次数已用完（每天 5 次）…」未实现 | `ratelimit.js:130-132`；`error-copy.js:15`；`UX_CUSTOMER:266/601` |
| 页面说明 | 「每天最多尝试 5 次」两处（bind 页、帮助 FAQ），未说明预览也计数、未给剩余次数/恢复时刻 | `pkg-customer/pages/bind/index.wxml:13`；`help/index.js:15` |
| 测试账号 | 不豁免；TEST_WRITE 用测试账号合成 openid，同样 5/日 | `CONTRACT:94`；`ratelimit.js:50-59` |

截图输入 `P6L9E6B` **是合法兼职编号**（P+6 位字母数字，缺短横线不算格式错），归一后 canonical=`P6L9E6B`。所以红字不是格式错，是**预览桶额度耗尽**：该 openid 当天已发生 ≥5 次 `partner.getPublic`，第 6 次被拒。

### 3.2 为什么「不合理」

1. 页面说「5 次」，服务端是「预览 5 + 绑定 5」两个桶，被拒的是预览桶，用户以为只是「查询」。
2. 自动查询静默消耗：输入/粘贴到合法编号即查（300ms 防抖），用户没有「要查询」的明确动作也会扣次。
3. 同编号再点「查询」不去重、按钮 loading 可连点，每点一次都发请求。
4. 失败也计数；计数先于业务校验（不存在/停用/冲突均扣）。
5. 客户端读动作自动重试（网络抖动时一次调用最多 3 次尝试，每次到服务端都计数）。
6. 卡片落地双扣残留：role → bind 的预览缓存只有 30s TTL，资料续跳/慢操作后失效，role+bind 各 1。
7. 文案三源不一致（云端「明天」/ error-copy「半小时」/ UX 规定句未实现）。
8. 无剩余次数、无恢复时刻；自然日 0 点重置可能锁近 24h。
9. 测试账号同受 5/日限制，开发者调试绑定会被卡。

**安全前提**：5/日 是 `partnerNo`（唯一凭据，32^6≈1.07e9）的防撞库闸；任何提额/改计数方案必须保留对枚举的约束并在 CONTRACT §10 写明理由。

### 3.3 修复建议（分两段）

**先做、不改口径（低风险）**：

- A. 同编号手动「查询」直接复用已有预览、loading 禁用查询按钮；自动查询仅对「新编号」触发。
- B. 文案统一：按 scope 区分预览/绑定文案，`shared/error-copy.js` 与云端 message 同源，页面说明补「预览也计次」；UX 规定句落地。
- F. 落地去重：预览缓存 TTL 覆盖资料续跳链路，或 store 一次性传递预览，使分享落地整链路固定 1 次。

**再做、需先裁决口径**（改 CONTRACT §10 + DATA_MODEL §7.6 + ENGINEERING §7.3 + QA；`check-docs` 的 `D_MAX` 需先扩界）：

- C. 失败不计数/成功回退（注意防枚举：失败恰是撞库特征，需同时加每分钟速率限制，不能只做回退）。
- D. 预览提额并拆文案（如预览 20/日 + 绑定 5/日），或同编号去重计数。
- E. 窗口：保留自然日但文案写「次日 0 点恢复」，或改滚动 24h（成本更高）。
- G. 读动作自动重试与限流解耦（需改冻结的客户端请求口径）。
- H. 测试账号独立额度/豁免（需 CONTRACT §1.3/§10 回写）。

不建议只把 5 改成更大数字：不解决误耗/文案问题，且扩大枚举面。

### 3.4 关联技术债

- `docs/archive/research/CONVENIENCE_2026-10-22.md` **F18**（预览也计数、卡片落地双扣）早已记录，留待裁决未修。
- 审查 R-A2-19 / M-64：`error-copy` 与实际 message 不一致未修。
- TD-038（开放）：同族「计数时点/失败也占额度」先例（AI 配额）。
- TD-034（跟踪中）：同类配额随动作放大。
- 绑定预览限流**无专门 TD**，建议新增（见 §5.2）。

---

## 4. 截图 1：识别失败复核页 `t.decorateRow` 运行错误

### 4.1 根因（确定，可离线复现）

- `pkg-admin/pages/recognition-review/index.js:176-179 refreshRows()` 仍调 `this.decorateRow(item)`。
- 该 Page 方法已在 `08cd421`（批 8，2026-10-22）抽到 `parts/view-model.js:39` 时被删除，但 `refreshRows` 漏改（`loadList:84-109`、`loadMore:124-140` 已改 `vm.decorateList`）。
- 触发：点任意行 `onRowTap(:142)` → `expand(:152)` → `getRecognitionFailure` 成功 → `:165 this.refreshRows()` → `:177` TypeError → 同一 `catch(:166-169)` 清空展开态并 `feedback.toast(err.message)` **原样弹出英文运行错误**。
- 深链 `?failureNo=` 同路径（`onLoad` → `focusPrefill` → `expand`），首屏加载后即自动弹。
- 压缩名 `t` = 编译器对箭头函数 `this` 的降级别名（Page 实例），不是模块名；错误是**属性不存在**，不是 `map` 丢 this。
- 首屏列表正常是因为列表/分页/筛选都走 `vm.decorateList`；切 tab/筛选/下拉/加载更多不经过 `refreshRows`，故不报。

### 4.2 影响

- 本页详情链路 100% 不可用：展开、看原图、OCR/AI 只读、补录、忽略、通知上传者、关联订单跳转全部无法到达（D16/D17 复核闭环首屏后全断）。
- QA §R（R5~R8/R13/R14）首轮真机执行必红；批 8 宣称的「复核页达标」与实际不符。
- 附带：`expand` 先调 `getRecognitionFailure`（默认签原图临时 URL 并写 `FAILURE_IMAGE_VIEW`），后续真正看原图再取一次 → **一次查看可能产生 2 条审计**；页面未使用 `withImage:false`。属相邻问题，建议交审计/契约线确认，不混入热修。
- 同一抽件模式在 `partners/index.js:139-145` 存在**二次装饰**隐患（点行后已装饰字段被洗成空/0，实测 bindingText 6→0、orderText 240→0/0），建议同批修；`invite-codes/index.js:57/81` 当前安全但建议统一 `decorateList` 防腐。

### 4.3 修复建议

- 最小修：view-model 增纯件 `applyExpanded(list, expandedNo)`（只更新展开标志），`refreshRows` 改调它；**不要**直接把 `this.decorateRow` 换成 `vm.decorateRow`——已装饰行会被二次装饰洗掉文案（实测 failureCodeText 回退「识别失败」等）。
- 判据补牙：`selftest-admin-pages` M 节加「页面源码 `this.<name>(` ⊆ Page 方法∪白名单」静态断言；J 节加 `applyExpanded` 三断言（幂等、已装饰字段不变、expanded 正确切换）；partners 同测。
- 文案纪律：后台统一 `toastError(err)`（无 code → 通用文案，有 code → `copy.errorText`），页面 catch 禁直接 toast `err.message`；本次把 JSCore 英文原文弹给用户，违反「不向用户暴露错误码英文/堆栈」。
- 修后回写 CHANGELOG/STATE（批 8 描述需按真实情况补风险说明）。

---

## 5. 与技术债台账的映射

### 5.1 既有条目关系与状态校正

| 既有条目 | 状态 | 与本结果的关系 | 建议动作 |
| :-- | :-- | :-- | :-- |
| TD-004（头像/昵称/隐私弹窗真机能力） | 开放 | ① 必须与官方隐私弹窗面一起真机取证；② 头像能力影响我的页验收 | 保留，补「分享首启隐私」取证项 |
| TD-009（隐私闸/头像纯件生产调用） | 已关闭 | 关闭依据只说 launch 接入；`api/privacy.js` 现整模块零生产调用 | 重新评估关闭依据（并入新条目） |
| TD-010（`bootstrap.privacyConsent` 进 store、launch/role 接入） | 已关闭 | 描述含 role 接入，实际 role 从未接入 | 重新评估（并入新条目） |
| TD-052（端内隐私文本单源） | 已关闭 | 若新增 role 闸，必须先抽单源，否则第三份漂移 | 作为 ① 修复的硬约束 |
| TD-061（官方隐私指引入口） | 开放 | 本次扩大为「api/privacy 整模块无消费者」 | 保留，建议升级为死代码清理/接线项 |
| TD-075（分享/朋友圈真机未取证） | 开放 | 分享首启隐私、朋友圈「前往小程序」落地同属未取证 | 保留，补用例 |
| TD-038（配额计数时点/失败也占额度） | 开放 | ③ 的同族先例 | 保留，作为 ③ 裁决参考 |
| TD-034（逐件 AI 兜底与 5 次配额放大） | 跟踪中 | 同族「配额随动作放大」 | 保留 |
| TD-027（头像票据一次性/客户端自愈） | 跟踪中 | ② 修复回归时需复验保存链路 | 保留 |

### 5.2 建议新增条目（编号按台账追加，当前最大为 TD-075）

| 建议编号 | 条目 | 影响 | 来源 |
| :-- | :-- | :-- | :-- |
| TD-076 | **分享/深链直落页无隐私同意闸 + launch 参数透传未实现**：分享卡 path=role，自定义闸只在 launch；契约「唯一启动页」与 D36 落地 path 冲突 | 新用户拉新死路、版本变更重同意失效；修复需先裁决 | 本报告 §1 |
| TD-077 | **页面状态/方法完整性无判据**：抽件重构删除 Page 方法后残留 `this.xxx` 只在真机运行时报错；`profile` 自动展开判定与装配无集成断言；pkg-admin 二次装饰 | 后台复核详情全断；兼职「我的」默认态回归；门禁全绿假象 | §2、§4 |
| TD-078 | **绑定预览限流口径与文案**：预览/绑定双桶但页面只写 5 次；自动查询、重复查询、失败尝试、读重试、落地缓存过期均计数；文案三源不一致 | 正常用户被误锁一天；支持成本上升；需口径裁决 | §3 |
| TD-079 | **后台错误 toast 直出运行时英文/堆栈**：页面 catch 普遍 `feedback.toast(err.message)`，本地 TypeError 会把英文原文弹给用户 | 违反文案纪律；排障信息外泄到用户 | §4 |
| TD-080 | **复核页展开即签原图临时 URL 并写审计**：`expand` 未传 `withImage:false`，查看一次可能产生 2 条 `FAILURE_IMAGE_VIEW` | 审计噪声、原图临时访问面扩大 | §4 |
| TD-081 | **绑定链路体验缺口**：点「我是顾客」丢邀请、role 错误卡无真输入框、已绑定仍给「绑定」主 CTA 必 CONFLICT、资料不完整最后才拒、bind 页无返回出口、资料续跳只存内存/无提示/无取消、成功无下一步、兼职侧绑定成功无回执 | 用户「不会绑定/不敢点/点了必失败」；支持成本上升 | §9 |
| TD-082 | **role 落地卡未按目标角色渲染/未按登录态分流**：CONTRACT「落地卡按目标角色渲染」与「已登录+资料完整→bind」未落地；兼职身份也看到顾客绑定入口 | 身份错位、双角色歧义、邀请被截走 | §9 |

> 以上为本报告建议，**尚未写入 `docs/governance/V4_TECH_DEBT.md`**；待用户确认修复排期后由 S6 单写者登记并回写 STATE/CHANGELOG。

### 5.3 工程缺口（按 AGENTS 标记）

- [E12 相关] TD-004 的「隐私弹窗真机能力」仍开放，本次新增「分享首启/版本变更后分享进入」两个真机场景。
- [E#] 页面级判据只能靠纯件集成或源码扫描（AGENTS §5.2 禁 mock 全局 wx/Page）；本次建议用「Page 方法完整性静态断言 + buildVm 集成断言」补牙，不破例建页面级 harness。

---

## 6. 修复排期建议（按写作用域）

| 顺序 | 内容 | 作用域 | 前置 |
| :-- | :-- | :-- | :-- |
| P0-1 | 复核页 `refreshRows` 热修 + `applyExpanded` 纯件 + J/M 判据；partners 二次装饰同修 | S5 `pkg-admin/**`；S2 `tools/**` | 无需裁决，可立即做 |
| P0-2 | 兼职「我的」默认态修复：角色感知完成度 + buildVm 集成断言 + 修正错误期望 | S0 `pages/profile/**`；S2 `tools/selftest-profile.js` | 无需裁决（推荐严格按契约）；若采纳「兼职也自动展开」需先改 UX_PARTNER |
| P0-3 | 分享/深链隐私闸：按方案 A 或 B 改 path/加闸 + launch 透传 + 文案单源 | S0 `app.js/pages/launch/config/route/utils/share`；S3 `pages/role`；S2 `selftest-share/check-share`；S6 文档/QA | **需裁决方案 A/B，先改 CONTRACT/UX 再改代码** |
| P1 | 绑定限流：先做 A/B/F（去重、禁点、文案统一、落地去重）；C/D/E/G/H 待裁决后再动服务端 | S3 `pkg-customer/pages/bind/**`、S7 `middleware/ratelimit.js`、S1 `shared/error-copy.js`、S6 文档/QA | 口径裁决 + 先改 CONTRACT §10 |
| P1 | 绑定易用性 A 档（§9.3）：优先 A3 已绑定态识别 / A6 资料前置拦截 / A4 续跳可恢复 / A7 错误态真出路；随后 A1/A2/A5/A9/A11/A12 | S3 为主；A4/A5/A6/A11 触 S0；A8 与上一行合并实施 | 无需裁决；先修 ① 隐私闸，否则新用户仍走不通 |
| P1 | 判据加固：Page 方法完整性、buildVm 集成、限流消耗路径、分享落地路径进 check/selftest | S2 | 随各修复同批 |
| P2 | 我的页 P3 顺带项、复核审计口径、TD-061 死代码清理 | 各自作用域 | 单列，避免夹带 |

**证据纪律**：每项修完按 `check.ps1` 真实输出 + 新增首红/还原复绿证据收口；agent 不代勾真机项。

---

## 7. 需要用户裁决 / 用户侧执行

### 7.1 需裁决（先改口径，再改代码；当前 D_MAX=36，需先扩界并同步 `check-docs`）

1. **隐私闸修法**：方案 A（分享卡改经 launch + 参数透传，推荐）或方案 B（role 内置闸、改「唯一启动页」口径）。若选 B，还需决定 launch 精简文案如何抽单源。
2. **绑定限流口径**：预览是否计数、预览/绑定配额值、自然日 vs 滚动窗、失败是否计数、是否展示剩余次数、测试账号是否豁免。任一变更都必须保留防枚举约束并写入 CONTRACT §10。
3. **绑定体验升级（§9.3 B 档）**：分享卡「一次确认绑定/换绑」的边界（必须用户确认、不得后台自动、不得跳过隐私/限流）、绑定成功后是否直达下单、落地页是否按登录态分流、换绑入口是否四端统一、邀请话术/卡片副标题是否调整为「点开→绑定」、绑定成功是否通知兼职、首次资料保存后是否自动续跳 bind。均须先改 CONTRACT/UX 并留新裁决编号（当前 `D_MAX=36`，先扩界再改文档）。

### 7.2 用户/控制台执行（agent 不能代做）

- 真机验证「新用户从兼职分享卡进入 → 是否出现同意入口 / 写操作 toast 原文」；再从冷启动 launch 同意，确认 `users.privacyConsent` 写入，以排除部署/官方弹窗因素。
- 真机验证兼职「我的」默认态（纯兼职、冷启动首次进 tab）；双角色作对照。
- 控制台查 `counters` 的 `rl:partnerPublic:{openid}:d{日期}` seq，或云函数日志按 `partner.getPublic` 计数，确认真实消耗序列（截图只能推断）。
- 真机按 §9.5 的 6 种进入方式点检绑定流程：新用户无卡/有卡（未同意隐私）、资料不完整、资料完整未绑定、已绑定异号、预览桶耗尽、兼职侧分享路径。
- 核对线上 `api` 云函数是否为含 `dao command.set` 修复的版本（防 `-502001` 旧部署复现）。
- 微信后台隐私指引逐项声明（昵称+头像、相册/摄像头/文件、剪贴板）——TD-004/TD-061/QA P8/P19/P24。
- 后台复核页按 QA §R 点检（R5~R8/R13/R14），确认热修后详情/原图/补录/忽略各链路。
- 决定本报告与新增 TD 是否登记、是否进入下一修复批次。

---

## 8. 未证实项与风险

1. 用户原话未给 toast 原文：① 的「服务端 `请先同意最新隐私保护指引`」是基于代码链路的**高置信推断**；若用户实际看到的是微信官方弹窗/`api scope is not declared`，则 R4/TD-004 面同样存在，需真机区分（判别步骤见 §7.2）。
2. 平台「分享卡以卡片 path 为首入口、不经过首页」属平台行为，仓内无断点；需真机确认落地页。
3. ③ 的真实请求序列无法从仓库取证，`counters` 读数需控制台；截图算术是「最可能」推断。
4. ② 若用户当时是**手动**点开编辑资料，则「默认自动展开」置信度下调；但「兼职编辑表单取代摘要、编号不可见」的观感问题与代码缺陷仍成立（纯兼职必复现）。
5. ④ 有代码级复现路径与离线探针，无需真机即可确认；真机只用于修复后回归。
6. ⑤ 的「不会绑定」原话无截图/点击序列；本报告按代码穷举 5 种进入方式，真实主因需用户确认（最可能是 ① 隐私死路 + 资料不完整/已绑定两类必失败路径）。
7. 上述问题在现有门禁下**全绿**（见附录 A），说明判据缺口本身是系统性风险，不能只修单点。

---

## 9. 新增反馈 ⑤：绑定兼职流程能不能更方便（用户反馈「不会绑定兼职人员」）

### 9.1 结论

- 主链路代码是通的：**资料完整 + 已同意隐私 + 未绑定**的成熟用户，从分享卡最快 **2 次点击**可绑成功（role 邀请卡「绑定这位兼职」→ bind 自动预览[缓存命中 0 次查询]→「确认绑定」）。
- 「不会绑定」不是缺功能，而是 **7 类体验/契约缺口 + 隐私闸/限流叠加**：一旦用户是「已绑定 / 资料不完整 / 预览被限流 / 中途不想绑」，链路直接变成必失败或死胡同。
- 最大叠加原因仍是 §1：新用户从分享卡进入没有同意入口，保存资料即报错——用户的主观表述就会是「不会绑定 / 绑不上」。

### 9.2 关键卡点（代码级已证实，按用户旅程排序）

| # | 卡点 | 证据 | 用户可能感受 |
| :-- | :-- | :-- | :-- |
| K1 | 「我是顾客」丢邀请：`onCustomerTap` 不携带 bind，直接 reLaunch home/profile；落地页无「离开会丢邀请」提示 | `pages/role/index.js:140-145`；`pages/role/index.wxml:14-48` | 我只是选了顾客，怎么邀请没了？ |
| K2 | role 错误卡写「可以手动输入完整兼职编号」，但 role 页无输入框；唯一按钮「重新加载」会再调一次 `partner.getPublic` | `pages/role/index.wxml:30-33/56`；`pages/role/index.js:180-188` | 让我输入，输入框在哪？越点越像被限制 |
| K3 | 已绑定用户仍看到「绑定这位兼职」；bind 页 create 模式不读当前绑定，确认必 `CONFLICT`，失败卡给必败的「重新绑定」 | `pages/role/index.js:166-178`；`pkg-customer/pages/bind/index.js:66`；`cloudfunctions/api/handlers/bind/create.js:76-78`；`utils/rebind.js:150-164` | 我明明绑过/想换人，怎么一直失败 |
| K4 | 资料不完整可从首页/我的直接进 bind，输完编号+确认才被服务端拒，失败后没有「去完善」按钮 | `pages/customer/home/index.wxml:43-50`；`pages/profile/index.wxml:125-144`；`bind/create.js:36-38` | 填完才告诉我资料没完善 |
| K5 | role 用 `reLaunch` 进 bind；bind 非 tab 且页面内无返回/回首页按钮 | `pages/role/index.js:177`；`pkg-customer/pages/bind/index.wxml` 全页 | 不想绑了，退不出去 |
| K6 | 资料续跳 `_pendingBind` 只存页面实例内存，无提示/无取消/无 TTL；取消编辑、切角色、杀进程即丢；旧邀请可能在日后任意一次保存时静默跳转 | `pages/profile/index.js:69/185-199`；`pages/profile/parts/save-flow.js:49-57/70-75` | 邀请丢了；又为什么突然跳到绑定页 |
| K7 | 成功 toast 不含昵称、成功卡（含 roomTag）800ms 后被首页顶掉、无「去下单/看订单」下一步 | `utils/rebind.js:176-178`；`pkg-customer/pages/bind/index.js:246-249` | 我到底绑上没？接下来做什么 |
| K8 | 兼职侧：分享卡标题不表达「点开→绑定」；激活成功 1.5s 自动跳配置、无「把卡片发给顾客」即时 CTA；顾客绑定成功后兼职无消息中心回执（UX_PARTNER:755 已写未实现） | `utils/share/index.js:17`；`pkg-partner/pages/activate/index.js:198-204`；`utils/customer-view.js:180-187` | 收卡人以为要拿编号自己去下单；兼职不知道谁绑了自己 |
| K9 | 顾客端空态/入口均不提「让兼职在『我的』点分享绑定卡片发你」；仅帮助 FAQ1 提到，且 role/bind 页没有帮助入口 | `pages/customer/home/index.wxml:45`；`pages/profile/index.wxml:140-143`；`home/parts/guide-view.js:9`；`pkg-customer/pages/help/index.js:14-16` | 编号从哪来？除了问人还有别的办法吗 |
| K10 | role 未按目标角色渲染绑定入口、未按登录态分流（CONTRACT「落地卡按目标角色渲染」「已登录+资料完整→bind」未落地） | `pages/role/index.wxml:14-24`；`pages/role/index.js:54-80`；`CONTRACT:424`；`UX_CUSTOMER:107/188` | 兼职身份也看到顾客绑定入口；已登录还要多跳 |
| K11 | 查询/确认按钮 loading 时不置灰、可连点；同编号已出预览再点查询仍发请求 | `pkg-customer/pages/bind/index.wxml:25/48`；`auto-query.js:119-127` | 点一次没反应又点一次（同时误耗预览额度） |
| K12 | 首页「去完善」用 `switchTab` 不带 `edit`，与 UX 规定「资料条→profile?edit=1」不一致，可能点了看不到表单 | `pages/customer/home/index.js:440-442`；`UX_CUSTOMER §3.3` | 点了去完善却没看到表单 |

### 9.3 改进方案

**A 档：不改口径，可随下一批（优先 A3 / A6 / A4 / A7）**

| # | 改法（改前 → 改后） | 作用域 | 验收判据 |
| :-- | :-- | :-- | :-- |
| A1 | 带 bind 落地时绑定卡升级为唯一主 CTA + 一句「这是同学发你的邀请卡」；角色卡降为次要样式；有 bind 时隐藏「有邀请码？」 | S3 `pages/role/**` | 首屏唯一主 CTA 可见；无 bind 不显示该说明 |
| A2 | 带 bind 点身份卡先弹确认「离开会丢本次邀请」；取消停留、确认才走 | S3 `pages/role/**` | 带 bind 点身份卡必弹；无 bind 不弹 |
| A3 | role/bind 读当前绑定：已绑同号→「已绑定·去下单」；异号→「换绑为这位兼职」（`bind?mode=rebind&bind=`）；create 模式不再撞 CONFLICT；删掉必败的「重新绑定」死循环 | S3 `pages/role/**`、`pkg-customer/pages/bind/**` | 已绑定异号从分享卡进入 = 0 次失败请求；C14 换绑路径可达 |
| A4 | 统一 role→`profile?bind=&edit=1`；profile 顶部提示「绑定邀请：XX（保存后自动继续/可取消）」；pending 移会话级内存 + TTL/清除规则；未保存不静默触发 | S0 `pages/profile/**`、S3 role、Lead 定新 util 作用域 | 保存后自动进 bind 且带编号；取消后同会话再保存仍续跳；超时不跳 |
| A5 | 「编号从哪来」文案统一：向兼职要编号；也可让兼职在「我的」点「分享绑定卡片」发你，点开卡片下一步就能绑定。落 home/profile/引导/bind；role/bind 加「怎么绑定兼职？」帮助入口 | S0+S3（home/profile/guide/bind/help） | 三处 grep 含关键词；role/bind 1 次点击到 FAQ1 |
| A6 | 资料前置拦截：资料不完整点绑定→提示「先完善苑/楼栋/宿舍号」+「去完善」→`profile?edit=1&bind=当前编号`；home/profile 同口径；保存后回 bind 带编号 | S0+S3（bind/home/profile） | 资料不完整不出现「确认绑定」；去完善保存后自动回 bind |
| A7 | role 错误卡删「重新加载」→「去手动输入完整编号」（navigateTo bind，保留返回栈）+「如何获取编号」；不再重复 `getPublic` | S3 `pages/role/**` | 1 次点击到 bind；role 页不再发第二次预览请求 |
| A8 | 查询按钮 `disabled=loading`、确认按钮 `disabled=submitting||readonly`；同编号已有预览不重复查询（与 §3 A 项合并实施） | S3 `pkg-customer/pages/bind/**` | 连点只 1 次请求；按钮视觉置灰 |
| A9 | 成功回执：toast/成功卡带昵称 + roomTag 白话说明 +「去下单」「回首页」；自动跳延到 1.5s 或改用户点击 | S3 `bind/**`、`utils/rebind.js` | 成功后可见昵称/roomTag/去下单；点去下单进 order-create |
| A10 | role 按目标角色渲染：兼职身份不显示顾客绑定主 CTA，只说明「这是顾客绑定入口」；若产品要双角色始终可绑则改口径（走 B） | S3 `pages/role/**` | 兼职身份落地无顾客绑定主 CTA、有说明 |
| A11 | rebind 页用 store.binding 预置 `currentBinding`，修慢网 race 导致退化为 create 撞 CONFLICT；首页「去完善」改 `reLaunch profile?edit=1` | S3 | 人为延迟 `getCurrent` 仍走 release→create；去完善直接编辑态 |

**B 档：需裁决（先改 CONTRACT/UX/QA，留新裁决编号；当前 `D_MAX=36`，先扩界）**

| # | 建议 | 收益 | 主要风险/约束 |
| :-- | :-- | :-- | :-- |
| B1 | 分享卡「一次确认绑定/换绑」：卡片+预览成功时，用户点一次→强确认弹窗（昵称+编号+服务范围+「绑定后即可下单」）→`bind.create`；已绑同号提示已绑+去下单、异号确认后 release→create。**必须用户确认，禁止自动/跳过隐私/绕限流/代客绑定** | 成熟用户 2C→1C；消除已绑定必失败 | 卡片可被转发，误绑风险；确认弹窗必须展示足够身份信息 |
| B2 | 分享卡 path 改经 launch + 参数透传（同 §1.4 方案 A） | 根治新用户无同意入口（「不会绑定」最大叠加原因） | 多一跳/闪；D36 path 与「唯一启动页」冲突需裁决 |
| B3 | 绑定成功后直达下单（可返回） | 回答「绑定完干嘛」，首单转化↑ | 用户可能还没准备截图；与现 UX「成功→home」冲突 |
| B4 | 落地分流按登录态：已登录+资料完整→直达 bind；未登录→role→登录后 bind；双角色/开发者/隐私未同意分支明确 | 少一跳、邀请不被身份卡截走 | 与 D36 path=role/身份选择语义冲突 |
| B5 | 换绑入口统一（首页/我的/bind/role 同一文案与流程） | 消除 K3 全链路 | 解绑成功而绑定失败的中间态需恢复文案（D28 已有） |
| B6 | 兼职邀请话术与卡片副标题明确「点开卡片→点『绑定这位兼职』才建立；不是下单链接」 | 收卡人知道用途，降低「不会绑定」 | 卡片标题受 UX/门禁固定，改动面大；不得有诱导分享/利益承诺 |
| B7 | 绑定成功回执给兼职（站内消息；UX_PARTNER:755 已写未实现） | 兼职及时知道谁绑了自己，形成闭环 | 新增通知口径与隐私披露；订阅消息需授权 |
| B8 | 首次资料保存后未绑定自动续跳 bind（research B-9） | 非邀请路径首单少 1C | 可能打断「先看看」；与 A4 续跳规则统一 |

### 9.4 与 §1 / §3 的去重

- §1 隐私闸：⑤ 的最大叠加原因；其修法即 B2（§1.4 方案 A），本节不重复代码细节。
- §3 限流：预览桶耗尽会让 role 卡片加载失败→错误卡无输入框→bind 页无预览/无确认按钮，用户表现同样是「不会绑定」；但「双桶、计数时点、自动查询误耗、文案三源」等根因归 §3，本节只补链路表现。A8 的「同编号不重复查询」与 §3 的 A 项合并实施，不重复立项。
- research F1/F2/F3 已在批 10 A/B 修复（P1-1/P1-2/D28）；本节只列残留（K3/K6/A11），不重开已关闭项。

### 9.5 真机验证（人执行，agent 不代勾）

1. **新用户无卡**：清缓存冷启→同意隐私→我是顾客→资料→首页；看首页未绑定卡是否提示「让兼职分享卡片」，从首页/我的各 1 次点击能找到绑定入口。
2. **新用户有卡·未同意隐私**：另一新号点分享卡；看是否出现同意入口（现状否）；点「绑定这位兼职」→资料保存→toast 原文；确认无第二同意入口。
3. **已同意·资料不完整·有卡**：看编辑态是否提示「保存后自动继续绑定 XX」；保存后是否自动进 bind 且 0 次查询出预览；取消后切 tab 回来再保存是否仍续跳；杀进程是否丢邀请。
4. **资料完整·未绑定·有卡**：bind 页是否有返回/回首页；成功后 0.8s 内能否看到昵称/roomTag、「去下单」是否存在。
5. **已绑定异号·有卡**：是否 CONFLICT+「重新绑定」必败；是否可一键换绑；无返回时如何退出。
6. **预览桶耗尽**：连续消耗 5 次预览后再点卡；看 role 错误文案与「重新加载」是否再发请求；bind 页是否因无预览而无确认按钮；控制台读 `counters` seq。
7. **兼职侧**：激活成功 1.5s 内是否有「分享绑定卡片」CTA；顾客绑定成功后兼职消息中心是否有事件；卡片标题在聊天列表是否能让收卡人理解为「点开→绑定」。

---

# 第二部分：顾客端测试批次（2026-10-28 第 2 批，反馈 ⑥~⑪）

> 来源：用户顾客端真机测试反馈 6 条（附「上传取件码下单」核对页截图 1 张）。
> 性质：只读定位 + 结果汇总；第 2 批未修改任何代码 / 契约 / 门禁。基线 `HEAD=298dda0`（与第 1 批相同）。
> 调查方式：4 条并行只读调查（⑥⑦ / ⑧⑨ / ⑩ / ⑪）+ Lead 交叉复核、编号归并与去重。

## 10. 本批结论速览

| # | 用户反馈 | 定性 | 根因（一句话） | 来源/首次引入 | 处理级别 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| ⑥ | 上传截图限制 5 张太少 | 口径变更请求（非 bug） | 「5 张」是契约 D23 明文口径，单源 `shared/order-state.js:99`，前端/服务端/清理/文档/断言全链引用；用户目标 10 张技术上可行，但属口径变更 | D23（批 1 起） | P1（用户已给目标 10，待扩界） |
| ⑦ | 取件码识别把非取件码数字也加入 | 功能回归（D35「修漏识别」的对称面「多识别」） | 客户端规则回退候选过宽：裸「取件」被当码上下文、上下文候选不查日期/手机号形态、token 兜底过宽 → 取件时间/日期/订单号/手机号都被当码；噪声件还会逐件触发 AI 外呼 | `b8435b1`（D35，2026-10-27）放宽候选后暴露 | **P0（错单 + 配额被吃掉）** |
| ⑧ | 核对页取件码无前置标签、不够显眼 | 展示实现缺口（不改口径） | 同卡内站点/柜号/运单尾号都是 `.form-row`+`.form-label`，唯独取件码是裸 `code-editor`（28rpx 灰底 64rpx、无 label），与「字段前置」的 UX 线框不同构 | 页面初版 | P1 |
| ⑨ | 从核对页返回截图页，无法重新进入核对页 | 状态机缺口 | `step` 只存页面内存；Step1 没有任何「带已填件回到核对」的前进迁移，唯一常驻前进按钮会清空已选图并把件重置为 1 条空白件；image-picker 无回显；系统返回整页弹出无拦截 | 页面初版 | **P0（数据丢失风险）** |
| ⑩ | 标准代取送寝室门口，要求新添「送至楼下」 | 用户前提与契约相反 + 口径空白 | 契约明文：标准代取＝楼下/约定地点，送寝上门＝寝室门口；真实问题是送达层级对用户不可见（选择器折叠只显示首项、地址卡显示房间级、兼职送达快捷语含「放宿舍门口」） | D5/D25 原口径；页面展示 | P1（先裁决，不新增 code） |
| ⑪ | 头像显示有问题（两端「我的」页） | 多因叠加：口径冲突 + 实现缺口 | 客户端唯一把 `cloud://` fileID 直塞 `<image>`，与 ENGINEERING「临时 URL」要求冲突且无 URL 通道；换头像票据失效的自愈会清空已有头像；兼职端 onShow 不刷新；2 处 `file-id` 驼峰写法不一致 | 多条历史（TD-003/TD-027/TD-034 家族） | P0/P1（判别后分级） |

**为什么门禁仍全绿**：本批 6 条全部落在现有判据盲区——识别候选只有正例无噪声负例、页面步骤迁移/回显无断言、展示与结构无静态判据、契约未定义送达层级、头像展示方案无门禁面。延续 §5.3 的结论：修复必须「先补判据、后改实现、留首红/复绿证据」。

---

## 11. 反馈 ⑥：上传截图上限 5 张→10 张

### 11.1 结论（高置信）

- 「5 张」不是实现常量，而是**契约口径 D23**：单源 `shared/order-state.js:99`（`MAX_IMAGES_PER_ORDER=5`），云函数副本由 `tools/sync-cloud-shared.js` 生成；前端 `utils/recognize/index.js:13-16`、`parts/{model,ocr-flow,files-flow}.js`、页面 data、服务端 `handlers/order/_parcels-input.js:104-105`、清理 `cleanup/sweeps/_util.js:14-16`、隐私文本、UX/DATA_MODEL/QA、6 套 selftest 断言全部引用。
- 用户已选目标 **10 张**。技术上可行、无硬阻断（AI 单图输入 2000 字上限与单图 500KB 闸不变；10 图约 5MB 总量）。
- 但**必须与 3 个联动同批**，否则出现隐私/体验事故：
  1. 清理槽 `IMAGE_INDEX_SLOTS=5`（`cleanup/sweeps/_util.js:14-16` 逐下标只查 0~4；`storage.js:2,25` 到期扫描/引用计数同样只 0~4）→ 10 图订单 `images[5..9]` 不参与 7 天到期删除与引用计数（隐私承诺违约/误删仍被引用文件）。
  2. AI 兜底配额维持 5 次/人/日（`config/defaults.js:40-45`、`handlers/ai/_common.js:250-257`）与 10 图不匹配：逐件外呼（`parts/model.js:222-227,271-313`）一图多噪声件即打光（与 ⑦ 叠加）。
  3. 识别逐图串行（`ocr-flow.js:377-380`，单图 maxWait 8s）最坏 10×8s≈80s+；页面文案「通常 3~10 秒」与进度（无第 n/N 张）不符。
- 另需注意：`upload.prepare` 票据限流 30/日（`middleware/ratelimit.js:31`）→ 10 图=3 单/日即锁；`wx.chooseMedia` 单次 count 平台上限（常见 9）待真机核对，若 9 则 10 张需两次选（组件支持分次添加，不阻断）。

### 11.2 实施清单（最小改动）

- 口径：CONTRACT §13 新增裁决（拟编号 37）并改 `:216/:334/:501/:606(D23)`；`tools/check-docs.js:233` `D_MAX=36→37`；`docs/contract/V4_DECISIONS.md` 留痕。
- 代码单源：`shared/order-state.js:97-99` 5→10 + 注释 → `node tools/sync-cloud-shared.js` 同步两套云副本；`utils/recognize/index.js:16` 兜底同步。
- 云端：`_parcels-input.js:104-105` 文案由常量拼出；`_merge.js` 常量驱动；`cleanup/sweeps/_util.js:14-16,165` 槽位 5→10。
- 前端文案：帮助页/端内隐私文本/launch 文案 0~10；`index.wxml:25-26` 改逐图进度（配合 `ocr-flow.js:252,283` 带 imageIndex/count）。
- 限流：`ratelimit.js:31` 30→60（否则 10 图=3 单/日）。
- 文档批量：UX_CUSTOMER 约 26 处、UX_PARTNER 5 处、DATA_MODEL 17 处（含「6 张」边界→11 张）、ARCHITECTURE、QA、隐私三份 + 端内派生物、REVIEW_MATERIALS、CHANGELOG（追加）、STATE。
- 测试：`selftest-state.js:589`、`selftest-recognize.js:567`、`selftest-order-flow.js:277`、`selftest-privacy-text.js:62/181/184/299/302` 同步；新增「10 图时 images[9] 参与到期扫描/引用计数」断言（当前无）。

### 11.3 待裁决

1. 件数上限维持 10（>10 件另建新单/截断提示，D23 既有）是否接受？建议维持。
2. AI 配额维持 5 次/人/日（10 图更多静默降级，推荐）还是提额（需隐私文本/CONTRACT §10 联动）？
3. 上传票据 30→60 是否随同批？

---

## 12. 反馈 ⑦：取件码识别误纳入非取件码数字（P0）

### 12.1 结论与复现（高置信，已离线复现）

生产识别链路（`utils/recognize`）对典型驿站短信产出 4 件：

- 输入：`取件码：207-3-1014`、`取件时间：2026-10-27 18:30`、`运单号：JT0001234567890`、`订单编号：202610270001`、`手机号：13800138000`。
- 输出 items=4：真码 `207-3-1014` + `2026102718`（时间）+ `202610270001`（订单号）+ `2026-10-27`（日期）；「联系电话」同行时手机号也成件。
- 默认 `checked=true`（`parts/model.js:97-99`）→ 用户不逐条核对就提交错单。

### 12.2 根因（[实]，三层）

1. 上下文标签过宽：`utils/recognize/codes.js:23-25` 的 `CODE_CONTEXT_RE` 含裸「取件/提货」→「取件时间/日期/人」行被当码上下文；`isContextCode`（`:104-110`）只查 4~12 字母数字，**不查日期/手机号**；`contextCodeRuns`（`:133-147`）把「2026-10-27 18」按空格合并成 `2026102718`。
2. 非上下文 token 兜底过宽：`codes.js:199-216` 只要 `isPlausibleCode`（4~40 字符、含数字、非日期/手机号/5 位）即入池；候选逐个产件（`utils/recognize/index.js:105-137`）。
3. AI 第二层放大：提示词已约束「运单号不是取件码」（`lib/ai/prompt.js:65-66`），但 `lib/ai/parse.js:113-119` 归一后不回查 OCR 原文、`MEDIUM` 直接写入（`utils/recognize/index.js:198-239`，D29 只锁 LOW）；服务端噪音词表缺「时间/日期/手机/电话/订单/编号/柜」（`handlers/ai/_common.js:19-26`）。
- 与 §4（后台复核页 `t.decorateRow`）不是同一缺陷；与 D35（`b8435b1` 修漏识别）同文件、对称面；现有 `selftest-recognize.js:246-289,591-615` 无噪声负例。

### 12.3 修复方案

- 最小（不改契约，先落客户端）：`codes.js` ①上下文标签收窄为「取件码/取货码/提货码/取件号」，新增 `NOISE_LABEL_RE`（取件时间|日期|时间|手机|电话|联系方式|订单号|订单编号|编号|运单|快递|物流|单号|尾号|柜|货架|取件人|收件人）并在 `contextCodeRuns` 先切段；②`isContextCode` 增加 `isDateLike/isPhoneLike/^\d{5}$` 排除；③token 兜底行含 NOISE_LABEL 整行跳过，非上下文纯数字降级为「未对齐候选」提示而不产件；④`index.js:126-134` 只对上下文/强形态候选产件。
- 服务端同判：`handlers/ai/_common.js:19-26` 补噪音词；`acceptCodeToken` 增日期/手机号排除。
- 推荐（二层）：AI 归一后回查「取件码上下文」文本，找不到则不写或降置信；`MEDIUM` 是否也降建议条需裁决（D29 边界）。
- 风险：收紧后「无标签纯数字码」可能漏识别 → 依赖未对齐候选提示 + AI fallback + 手填兜底；必须保留 D35 正例与「一图多码」正例并真机回归。
- 测试：`selftest-recognize` 新增负例（短信模板→只 1 件；手机号/订单号/时间/日期 0 件；`trackingTail` 取末 5 位）；`selftest-cloud` 加服务端负例；先红后绿留证。

---

## 13. 反馈 ⑧⑨：核对页取件码展示 + 返回后无法重进核对页

### 13.1 ⑧ 取件码缺前置标签、不显眼（成立 0.95）

- 证据：站点 `pkg-customer/pages/order-create/index.wxml:93-98`、柜号/运单尾号 `:108-115` 均为 `.form-row`+`.form-label`；取件码 `:100-106` 为裸 `<code-editor>`（组件内 `components/code-editor/index.wxss:1-13`：28rpx、灰底、min-height 64rpx；CONTRACT §8 正文字号刻度 40/34/30/26/24 → 28rpx 不在刻度；可点区 ≥88rpx 要求）；UX 线框是「取件码[8-2-3021]」前置式（`V4_UX_CUSTOMER.md:283`）。
- 最小改法（S3，0 新增类）：WXML 包 `.form-row`+`.form-label 取件码`（复用 `app.wxss:194-213`），placeholder 去掉重复「取件码」。全仓 `<code-editor` 唯一消费者 → 不动组件也能解决「没标签/不同构」。
- 推荐（+S10 排期）：`components/code-editor/index.wxss:6-13` 改 30rpx/600/96rpx/深色，与站点值同字号；需裁决是否本批动 S10。
- 判据：selftest-order-flow 加静态断言（含 `.form-label 取件码` 且在 code-editor 前；placeholder 正确），旧文本有牙正控。

### 13.2 ⑨ 返回截图页后无法重新进入核对页（成立：页面返回 0.9 / 系统返回 0.85）

- 状态机：`step` 初值 1、只存页面内存；1→2 仅识别完成自动跳（`parts/files-flow.js:26`）与「不传截图，手动填写」（`index.js:170-191`，会清空 files 并把 items 重置为 1 条空白件）；Step2 有「上一步」（`index.js:345-347` 只减 step），**Step1 没有任何带已填件回核对的前进迁移**（Step1 块 `index.wxml:19-62` 无「下一步」）→ 返回后唯一常驻前进按钮会重置数据，用户感受即「无法回到核对页」。
- 叠加：`components/image-picker` 无 files 回显 property（`index.js:24-38`）+ Step1 `wx:if` 销毁重建 → 回退后显示「已添加 0/N」，与仍保留的件不一致；再选图经 `alignToFiles`（`files-flow.js:44-73`）丢弃旧图已识别件且无二次确认。系统返回由首页 `navigateTo` 入栈（`pages/customer/home/index.js:420`），整页弹出、内存草稿全丢；UX 明文要求「有未提交内容返回拦截/上传中禁止离开/提交中返回拦截」（`UX_CUSTOMER.md:151/274/280/308`）四项均未实现（全仓仅 `pkg-admin/pages/config/index.js:65-72` 有 `enableAlertBeforeUnload` 先例）。
- 最小修（S3）：新增 `goStep1Next()` 仅 `setData({step:2})` + Step1 常驻「下一步：核对（N 件）」主按钮（`.btn` 已 ≥88rpx，符合 UX:274）；`onManualOnlyTap` 在有数据时先二次确认。
- 推荐：`enableAlertBeforeUnload` 返回拦截 + image-picker `files` 回显（S10+S3）+ 上传/识别中禁止离开。
- 规范缺口：UX §3.7.1「跳转」只写自动→Step2/手填→Step2，未写「Step2 上一步→Step1→再前进」，建议按补规范遗漏处理并由 S6 回写 QA 新项（D17 类）。
- 判据：`tools/selftest-order-flow.js:58 EXPECTED_ASSERTIONS=195` 需同步真实输出；加「Step1 有件→可进 Step2」「返回不丢件」纯件断言。

### 13.3 待裁决（⑧⑨）

1. Step1 增「下一步」按钮是否按「补规范遗漏」处理并把 UX §3.7.1 补一行（还是视为新交互先改文档）？
2. ⑧ 推荐项是否允许动 S10 `components/code-editor/**`？
3. 返回拦截采用「有未提交内容才弹」是否可接受真机体验？
4. 用户实际走法：点「上一步」还是系统返回键？（两路径都成立但修复优先级不同）

---

## 14. 反馈 ⑩：服务类型「送至楼下」（先纠偏，再裁决）

### 14.1 纠偏：用户前提与契约相反（高置信）

- 契约明文（`V4_CONTRACT.md:362-376` §6 表）：`PICKUP_STD` 标准代取＝驿站取件送到**宿舍楼下/约定地点（不上楼）**；`PICKUP_DOOR` 送寝上门＝送到**寝室门口（上楼）**。全仓 **0 处**把「标准代取」写成送寝室门口，「送至楼下」字面 **0 命中**（`shared/enums.js:156-169`、`config/defaults.js:28-29`、UX_CUSTOMER:293/303、UX_PARTNER:357 五处一致）。
- 因此**不缺类型**；「标准代取＝门口」的观感来源有三个实现/展示缺口：
  1. 顾客端服务类型 picker 折叠，只显示当前选中项（默认首项=标准代取），不点开看不到其余 4 类（`order-create/index.wxml:144-149`、`index.js:110`）。
  2. 地址卡/订单/兼职端展示**房间级**地址（D25；`index.wxml:206/236`、`pkg-partner/pages/order-detail/index.wxml:88-91`），用户从「具体到寝室」推断会送上楼。
  3. 兼职送达快捷语含「放宿舍门口/放楼下货架」（`pages/partner/workbench/parts/row-actions.js:90`）。
- 附带发现：`UX_PARTNER.md:767` 写「首次激活按目录生成草稿，全部默认未启用」，实现 `handlers/partner/activate.js:17-23` 是 5 类全部 `enabled:true` → 文档/代码漂移，影响「为什么只看到一项」的解释口径。

### 14.2 口径提案（推荐主案 A，不新增 code）

- 新增裁决（拟编号 38）：`CONTRACT §6` 表后补「送达位置层级」段：服务类型只表达「做什么 + 送到哪一档」；现 5 类已覆盖两档；顾客端只展示当前绑定兼职已启用类型；`orders.delivery` 只定位「哪苑/哪栋/哪间」，**不改写**层级承诺；楼下/门口由 `service.code` 派生，不新增位置字段/采集；默认说明须能区分两档。
- 配套：顾客端地址卡加 1 行 muted 说明（「标准代取送到楼下或约定地点；送寝上门才上楼」）；后台可直接改服务类型模板 name/desc（`updateConfig` 白名单，落审计）—最快让用户看到「送至楼下」字样；QA D6/M3 补「层级可见」点检项；顺带修 UX_PARTNER:767 漂移。
- 备选 B：默认名称改「标准代取（送至楼下）」（`enums`+CONTRACT §6+D5+UX/QA/帮助页文案）；存量环境须后台改或迁移才生效。
- 备选 C（完整版，仅当用户明确要「标准代取=门口 + 新类型=楼下」并存）：新增第 6 个 code（插在 `CUSTOM` 前，避免 TD-070 末项推导把「其他代办强制备注」挂到新码）；同时须处置 `PICKUP_DOOR` 同义冲突（弃用/改名/迁移）；波及 `shared/enums.js`、`saveServiceConfig` MAX_SERVICES、`updateConfig` 硬编码「全部 5 类」、后台「固定 5 项」说明、help 页硬编码、`config.serviceCatalog` 存量迁移（bootstrap 只补顶层键，新类型不下发）、6+ 测试断言、D_MAX 扩界、词表白名单整行核对。
- 结论：建议主案 A；若用户确认 C，需先处理 `PICKUP_DOOR` 去留并单列完整实施批次。

### 14.3 待裁决（⑩）

- Q1（必答）：用户「标准代取是送到寝室门口」是口误/体验误读，还是要求把标准代取**重新定义**为送门口？只想要「楼下」选项→主案 A/B；要「标准=门口 + 新类型=楼下」并存→提案 C。
- Q2：默认名称/说明是否改（不改=保留现名只补说明；改=加括号并处理存量环境生效）。
- Q3：顾客端是否显示「已启用 N 项/其余类型灰显」以消除「为什么只有一项」误解？
- Q4：主案口径文案确认。

---

## 15. 反馈 ⑪：头像显示问题（两端「我的」页）

### 15.1 链路与最可能现象

- 链路：`pages/profile/index.wxml:44-48`（编辑态头像行 + `chooseAvatar` +「使用默认头像」）→ 选完立即上传（`index.js:209-233`、`api/upload.js:132-227`）→ 服务端签票 `avatars/{role}/{随机20}.jpg`（`upload/prepare.js:56-71`）→ `saveProfile` 写 `avatarFileId`/删旧/消费票据 → DTO 下发（`db/dto/full.js:7-53`、`bootstrap.js:117-148`）→ store 水合 → `pages/profile/index.wxml:19/129` → `components/avatar-view`（首字色块兜底 + 失败锁）。
- 候选现象与置信度（需用户确认后定级）：
  1. **45%** 头像直接 `<image src="cloud://…">`（全客户端唯一），与 `V4_ENGINEERING.md:175`「展示用 fileID 换 5 分钟临时 URL」不符、无 URL 通道；若云存储权限按私有规则配置 → 两端头像全部静默回默认色块（`V4_RUNBOOK.md:80-84/333` 记权限配置未实测，TD-003 开放）。
  2. **25%** 换头像票据 TTL 仅 5 分钟（`upload/_common.js:16`）+ 自愈兜底 `clearAvatar`（`parts/avatar-save.js:37-43`，服务端语义=清空）→ 先选头像再慢慢填资料，保存时票据过期 → **已有头像反被清空**；再换可能撞上传日限。
  3. **15%** 兼职端 `pullLatest` 直接 return（`pages/profile/index.js:134-136`）不刷新 + `avatar-view` 同 fileId 失败后永久兜底（`components/avatar-view/index.js:26-31`）→「有时显示有时不显示，杀进程才恢复」。
  4. **10%** 测试账号创建即 `avatarFileId:''`（`admin/_test-accounts.js:101/119`，QA T4 设计要求默认头像）→ 蓝条测试会话里看到默认头像属设计。
  5. **5%** `chooseAvatar`/隐私声明未真机取证（TD-004，QA Q7「昵称+头像」未勾选）。
- 附加实锤：`file-id="{{...}}"` 驼峰写法 2 处（`pages/customer/home/index.wxml:26`、`pkg-customer/pages/order-detail/index.wxml:107`），其余 9 处为 `fileId=`；这正是 D34 用户原话「绑定的我的兼职人员头像显示有错」所在，批 11/12 只加了首帧兜底未改写法（需开发者工具 WXML 面板确认属性是否为空，1 行可修）。
- 台账：cleanup 未扫无主 `avatars/` 孤儿文件（ENGINEERING §3.5 承诺未实现），属隐私/配额欠账，与显示无关。

### 15.2 判别路径（用户 1 分钟可做）

1. 云存储权限截图：所有用户可读 / 仅创建者可读写 / 自定义 read=false（判别第 1 项）。
2. 是否见过「资料已保存；头像没换上…已用默认头像」这类提示（判别第 2 项）。
3. 不杀进程切走再回来 vs 杀进程重进，头像是否恢复（判别第 3 项）。
4. 是否在「测试账号·…由开发者切换」蓝条会话里看的（判别第 4 项）。
5. 两端是否期望同一张头像（当前 customers/partners 两头像字段独立，互不同步）。

### 15.3 修复方案

- 最小（不改口径）：`avatar-view` 增加 reload 重试入口；兼职端 `pullLatest` 补刷新（或 `user.bootstrap` 轻量重拉）；`avatar-save` cleared 分支改为保留旧头像（需 UX §4.10 P1-10 口径从「退化为清空」改为「保留原头像」，要裁决）；`file-id`→`fileId` 两处 1 行修正。
- 推荐（根治第 1 项）：新增头像临时 URL 通道（如 `user.getAvatarUrl`：本人或当前 ACTIVE 绑定对方可签，`getTempFileURL` maxAge 300，DTO 仍下发 fileID/URL 由页面按需签发）+ 云存储权限设 read=false；或按 CONTRACT/DATA_MODEL 字面改口径允许 `cloud://` 直读（须同步 ENGINEERING §3.5 与 R24，且承认开发者只读视角看别人头像会失败）。**需裁决**。
- 判据：avatar-save「票据失效且已有头像→保留」断言；avatar-view reload 复位断言；两端角色 buildVm 头像来源断言；全仓 `file-id=` 静态扫描；若做 URL 通道加鉴权矩阵/TTL 测试。
- 真机（用户点检）：换头像→保存→头卡/杀进程重进/双角色切换/测试账号会话/弱网重复。

---

## 16. 新增技术债建议与既有台账映射

> 以下为建议，**尚未写入 `docs/governance/V4_TECH_DEBT.md`**；编号按当前台账（最大 TD-075）与第 1 批建议（TD-076~TD-082）续排，实际登记时以台账当前最大号为准。

| 建议编号 | 条目 | 影响 | 来源 |
| :-- | :-- | :-- | :-- |
| TD-083 | **识别候选误纳入（D35 对称面）**：上下文标签过宽/形态过滤缺失/token 兜底过宽，取件时间、日期、订单号、手机号被当取件码；噪声件逐件触发 AI 外呼 | 错单、兼职白跑、AI 配额被打光、核对待办变多 | §12 |
| TD-084 | **截图上限 10 张的联动欠账**：cleanup 槽位 5→10、AI 配额与 10 图不匹配、串行识别无逐图进度、上传票据 30/日、文档批量回写 | 隐私承诺（7 天删除）违约、等待超时、误删风险 | §11 |
| TD-085 | **下单四步缺 Step1↔Step2 重入迁移/截图回显/返回拦截**：Step1 无「下一步」、手填会重置、image-picker 无回显、系统返回无拦截 | 返回即死路、数据丢失、重复上传 | §13 |
| TD-086 | **取件码展示与全局行结构不同构** + `code-editor` 无 disabled（READONLY 视角仍可输入） | 核对效率/一致性；视角越权可编辑风险 | §13 |
| TD-087 | **服务类型「送达层级」口径空白 + 激活默认全开与 UX 文档漂移**：层级不可见、地址卡房间级、UX_PARTNER:767 与 activate 实际不一致 | 用户误判服务范围、投诉风险 | §14 |
| TD-088 | **头像展示/刷新链路**：未走临时 URL（与 ENGINEERING §3.5 冲突）、票据失效自愈清空头像、兼职端不刷新、`file-id` 写法不一致 | 两端头像不显示/时好时坏/换头像反丢 | §15 |
| TD-089 | **cleanup 不扫无主 `avatars/` 孤儿**（ENGINEERING §3.5 承诺未实现） | 隐私/存储配额欠账 | §15 |

- 既有条目关系校正：TD-003（云存储规则未实测）是 ⑪ 第 1 项的判别前置；TD-004（chooseAvatar/隐私能力）是 ⑪ 第 5 项；TD-027（头像票据自愈）与 ⑪ 第 2 项同族；TD-034（逐件 AI 兜底与 5 次配额）与 ⑦/⑥ 联动；TD-070（CUSTOM 末项推导）是 ⑩ 备选 C 的硬约束；TD-077（页面状态无判据家族）吸收 ⑨。
- 工程缺口：⑨/⑧ 的页面级判据仍按 AGENTS §5.2「纯件集成 + 源码静态扫描」补牙，不建页面级 harness、不 mock 全局 wx。

---

## 17. 修复排期（合并第 1 批 + 第 2 批）

| 顺序 | 内容 | 作用域 | 前置/裁决 |
| :-- | :-- | :-- | :-- |
| P0-0 | 识别误判最小版（⑦）：`codes.js` 上下文/形态/兜底收紧 + 服务端噪音词表 + 负例断言；与 ⑥ 同批 | S2 `utils/recognize/**`、`tools/selftest-recognize.js`；S7 `handlers/ai/_common.js` | 无需裁决 |
| P0-1 | 下单四步 ⑨/⑧ 最小版：Step1「下一步」迁移 + 取件码前置标签 + 静态断言；UX §3.7.1 补一行 | S3 `pkg-customer/pages/order-create/**`；S2 `selftest-order-flow.js`；S6 UX/QA | 需确认 §13.3 第 1/2 项（建议按补规范遗漏） |
| P0-2 | 后台复核页 `refreshRows` 热修 + `applyExpanded` 纯件 + J/M 判据（第 1 批 §4） | S5、S2 | 无需裁决（第 1 批已有方案） |
| P0-3 | 兼职「我的」默认态修复（第 1 批 §2） | S0、S2 | 无需裁决 |
| P1-1 | 头像判别与修复：存储权限取证 + ⑪ 第 2/4 项最小修 + `file-id` 两处 1 行；URL 通道单独裁决 | S0 `components/avatar-view/**`、`pages/profile/**`；S6 文档/QA | 需用户确认现象 + 云存储权限取证 + §15.3 裁决 |
| P1-2 | 截图上限 10 张（⑥）：裁决扩界 + 常量/清理槽/文案/文档/断言同批 | S1 `shared/order-state.js`+sync；S2；S3 文案；S6 文档；S7 cleanup/限流 | 需裁决 §11.3 |
| P1-3 | 服务类型送达层级（⑩）：主案 A 文档+地址卡说明+QA；若走 C 单列 | S6 文档；S3 顾客端说明 | 需裁决 §14.3 Q1/Q2 |
| P1-4 | 第 1 批 P1：绑定限流、绑定易用性、判据加固 | 见 §6 | 见 §7.1 |
| P2 | 第 1 批 P2 + 本批 TD-086/089 欠账 | 各自作用域 | 单列 |

**证据纪律**：每项修完按 `check.ps1` 真实输出 + 新增首红/还原复绿证据收口；`EXPECTED_ASSERTIONS` 按真实输出改数；真机项只由用户点检。

---

## 18. 需用户裁决 / 用户侧执行（合并两批）

### 18.1 本批需裁决

1. **截图上限（⑥）**：确认 10 张；件数上限维持 10；AI 配额维持 5 次/人/日（推荐）或提额；上传票据 30→60 是否同批。（裁决落位拟编号 37）
2. **服务类型（⑩）**：Q1 口误/体验误读 vs 重新定义标准代取；Q2 默认名称是否加「（送至楼下）」；Q3 是否显示「已启用 N 项」；Q4 口径文案确认。（主案落位拟编号 38；走 C 则另立批次）
3. **头像（⑪）**：现象确认（一直默认 vs 时好时坏；是否测试账号蓝条会话；是否见过「头像没换上」提示；两端是否要同一张头像）+ 云存储权限取证；URL 通道 vs `cloud://` 直读口径二选一。
4. **下单四步（⑧⑨）**：Step1 增按钮按「补规范遗漏」处理是否同意；是否允许动 S10 组件；返回拦截「有未提交内容才弹」是否可接受；用户实际走法（上一步 vs 系统返回）。
5. 是否登记 TD-083~TD-089 与本批 QA 新项（D17 类）。

### 18.2 第 1 批遗留裁决（见 §7.1，未变）

- 隐私闸方案 A/B；绑定限流口径；绑定体验 B 档。

### 18.3 用户/控制台执行（agent 不能代做）

- 云存储权限截图（⑪ 判别关键，`V4_RUNBOOK.md` §3.7）；微信后台隐私指引「昵称+头像」勾选（QA Q7）。
- 修正后的真机回归：⑨ 返回路径（上一步/系统返回）、⑧ 标签与字号、⑦ 真实短信截图核对件数、⑥ 10 图全链路耗时与第 11 张被拒文案、⑩ 层级可见性、⑪ 换头像/重进/双角色/测试账号。
- 决定本报告与新增 TD 是否登记、是否进入下一修复批次。

---

## 19. 未证实项与风险（本批）

1. ⑦ 的噪声语料来自构造短信，真实用户截图的噪声形态需真机回归；收紧后有漏识别风险（无标签纯数字码）。
2. 服务端「单候选噪音被规则采纳」为推断，需构造 masked 文本单测验证。
3. ⑥ 的 `wx.chooseMedia` count 平台上限、10 图串行耗时/内存需真机；清理槽若不同批改 = 隐私超期/引用计数漏算（高危）。
4. ⑨ 的用户点击序列未知（上一步 vs 系统返回），两条路径修复重点不同；image-picker 销毁重建为空属平台生命周期推断。
5. ⑩ 用户当时绑定兼职启用项、线上部署版本未知，可能影响「只看到一项」的观感；用户原话可能为口误。
6. ⑪ 云存储权限是判别关键且从未实测；测试账号默认头像属设计要求；若用户测的是旧包，D34 旧问题可能已部分修复。
7. 本批 6 条在现有门禁下全部全绿，说明判据缺口是系统性风险（延续 §8 的结论）。
8. 编号说明：本报告拟用「D-37/D-38」写法标注待扩界的裁决位，**未在 CONTRACT §13 落行前不构成正式编号**；实施时按 §13 顺序落位并同步 `tools/check-docs.js` 的 `D_MAX`。

---

## 附录 A：基线命令与真实输出（2026-10-28，HEAD=298dda0）

| 命令 | 真实结果 |
| :-- | :-- |
| `node tools/selftest-profile.js` | 断言 154/154；失败 0 项；PASS（兼职自动展开错误期望被锁死） |
| `node tools/selftest-admin-pages.js` | 断言 170/170；失败 0 项；PASS（不执行页面 expand 路径） |
| `node tools/selftest-share.js` | 断言 182/182；失败 0 项；PASS（path=role 被写死） |
| `node tools/selftest-cloud.js` | 断言 179/179；失败 0 项；PASS |
| `node tools/selftest-bind.js` | 断言 169/169；失败 0 项；PASS |
| `node tools/selftest-bind-cloud.js` | 断言 108/108；失败 0 项；PASS |
| `node tools/check.js` | 通过 33 项；失败 0 项 |
| `node tools/selftest.js` | 运行 33 套；失败 0 套；完整性 0 项；PASS |
| `node tools/check-docs.js`（第 2 批追加后复跑） | 通过 10 项；失败 0 项（文档范围 66 份） |
| `node tools/zero-money-scan.js`（第 2 批追加后复跑） | 0 命中（白名单 136 项） |
| `node tools/selftest-profile.js`（第 2 批只读复核） | 断言 154/154；失败 0 项；PASS |
| `git status --porcelain` | 空（本报告写入前）；第 2 批调查结束时仅 `?? docs/archive/reviews/2026-10-28_USER_FEEDBACK_TRIAGE.md` |

关键离线复现（只读）：

- 纯兼职 `buildVm` → `profileCard.complete=false` → `shouldAutoOpenEdit=true`；双角色顾客资料完整时为 false。
- `parseNo('P6L9E6B')` → `{ok:true, canonical:'P6L9E6B', display:'P-6L9-E6B'}`。
- 限流实跑：前 5 次合法格式但失败的 `partner.getPublic`/`bind.create` 各计 1 次，第 6 次 `RATE_LIMITED`，message=「操作太频繁，请明天再试」；跨日恢复。
- 自动查询实跑：输入 1 次；同编号再点查询 → 第 2 次请求；改末位 → 第 3 次。

第 2 批 Lead 复核（只读，均为真实输出）：

- 识别噪声复现：生产 `utils/recognize` 解析 §12.1 构造短信 → items = `["207-3-1014","2026102718","202610270001","2026-10-27"]`（真码 + 取件时间 + 订单编号 + 日期），与调查结论一致。
- 常量复核：`shared/order-state.js:98-99` `MAX_PARCELS_PER_ORDER=10`、`MAX_IMAGES_PER_ORDER=5`；`cloudfunctions/cleanup/sweeps/_util.js:16` `IMAGE_INDEX_SLOTS=5`，`:169` 逐下标只扫 0~4。
- 核对页结构复核：`pkg-customer/pages/order-create/index.wxml:93-115` 站点/柜号/运单尾号均为 `.form-row`+`.form-label`；`:100-106` 取件码为裸 `code-editor`；`components/code-editor/index.wxss:6-13` 为 28rpx/灰底/64rpx；`index.js` 只有 `goStep2Next`/`goPrev`，无 Step1 前进方法。
- 头像写法复核：全仓 `file-id=` 2 处（`pages/customer/home/index.wxml:26`、`pkg-customer/pages/order-detail/index.wxml:107`），其余渲染点均为 `fileId=`。
- 服务类型复核：`shared/enums.js:157-158` 标准代取=`驿站取件送到宿舍楼下/约定地点`、送寝上门=`送到寝室门口（上楼）`。

## 附录 B：关键位置速查

| 主题 | 位置 |
| :-- | :-- |
| 分享卡 path | `utils/share/index.js:32-46` |
| 隐私闸（唯一生产点） | `pages/launch/index.js:112-154`；`consentStatus` 调用 `:113` |
| 分享落地页 | `pages/role/index.js:54-80`（无隐私判定）；绑定跳转 `:166-178` |
| 服务端隐私写闸 | `cloudfunctions/api/middleware/auth.js:180-194` |
| 我的页自动展开 | `pages/profile/index.js:185-199`；`pages/profile/parts/view-model.js:198/212-226` |
| 我的页错误期望 | `tools/selftest-profile.js:389-418`（尤其 `:405-410`） |
| 限流规则/计数/文案 | `cloudfunctions/api/middleware/ratelimit.js:17-20/61-63/102-140`；`shared/error-copy.js:15` |
| 绑定页自动查询 | `pkg-customer/pages/bind/parts/auto-query.js:57-127`；`utils/preview-cache.js:11-14` |
| 复核页报错 | `pkg-admin/pages/recognition-review/index.js:176-179`（`refreshRows`）、`:152-170`（`expand`） |
| 复核页历史回归 | `08cd421` 删 Page 方法（`bfcff89` 初始版 `:153-164` 存在）；`b8435b1` 仅 +9 行 AI 状态/原图守卫 |
| 后台 toast | `pkg-admin/common/feedback.js:10-13` |
| 绑定主链路 | `pages/role/index.js:116-178`；`pkg-customer/pages/bind/index.js:52-67/146-153/175-214`；`pages/customer/home/index.wxml:43-50` |
| 资料续跳 | `pages/profile/index.js:69/185-199`；`pages/profile/parts/save-flow.js:49-57/70-75` |
| 已绑定/换绑 | `utils/rebind.js:150-164`；`pkg-customer/pages/bind/index.js:66/216-233`；`cloudfunctions/api/handlers/bind/create.js:76-78` |
| 下单截图上限 | `shared/order-state.js:97-99`；清理槽 `cloudfunctions/cleanup/sweeps/_util.js:14-16/169`；服务端 `handlers/order/_parcels-input.js:13/104-105` |
| 识别候选误纳入 | `utils/recognize/codes.js:23-25/104-110/133-147/199-216`；`utils/recognize/index.js:105-137/198-239`；`lib/ai/parse.js:113-119` |
| 下单四步状态机 | `pkg-customer/pages/order-create/index.js:170-191/281-288/345-347`；`index.wxml:19-62/100-106/135-138` |
| 取件码展示 | `pkg-customer/pages/order-create/index.wxml:100-106`；`components/code-editor/index.wxss:1-13` |
| 服务类型 | `docs/contract/V4_CONTRACT.md:362-376`；`shared/enums.js:156-169`；`config/defaults.js:28-29` |
| 头像链路 | `components/avatar-view/index.wxml:2`；`api/upload.js:132-227`；`upload/prepare.js:56-71`；`pages/profile/index.js:209-233` |

---

> 本报告只列定位与建议，不含实现代码。下一步由用户确认 §7.1 与 §18.1 的裁决后，按 §17 顺序进入修复；修复必须按 AGENTS §1~§8、每项先补判据并留首红/还原复绿证据；真机项只由用户点检。
