# 代码审查与响应速度检查（2026-11-26 · HEAD `bc8a3c5`）

> 范围：当前 main 全仓的响应速度与代码质量面——客户端页面/组件、`api/`、`store/`、`cloudfunctions/`、`shared/`，以及性能相关门禁。
> 方法：静态审查 + 门禁实跑。未改任何代码、未部署、未连真实云端；真机与控制台读数缺失，相关项标注为「需实测」。
> 口径：CONTRACT / ENGINEERING / ARCHITECTURE。文档里的性能承诺一律回到代码核对，不把文档当证据。

## 0. 结论先行

1. 功能与安全基线扎实：权限、幂等、限流、入参总闸、错误文案收敛都成体系；门禁全绿。
2. 响应速度最大的浪费在云端：一次列表/统计动作被拆成 11~29 次**串行** DB 往返；消息中心聚合最坏约 45~65 次。独立查询改并行/批量后，端到端可省 3~5 倍 RTT。
3. 第二块在客户端等待策略：读动作最坏 **31.2s** 才失败（10s×3 次 + 300/900ms 退避），覆盖 bootstrap、绑定、列表、消息；工作台 30s 轮询会与在飞请求叠加。
4. 首页每次 onShow 固定 3 个云调用（绑定、订单、未读），其中未读走的是**全量消息聚合**接口；首屏又把绑定与订单合在一个 `Promise.all`，绑定失败会连已成功的订单一起丢。
5. 门禁对性能的「牙」不足：`selftest-performance` 多是「源码里有这个字符串」的锁，没有查询次数、并行度、延迟预算、包体积判据；带 12s 读预算与体积探针的性能分支（`perf-health-optim`）尚未合入 main。

## 1. 门禁基线（本次真实输出）

- 命令：`powershell -ExecutionPolicy Bypass -File check.ps1`（默认执行策略会拦截未签名脚本，故加 Bypass；这是环境限制，不是代码问题）。
- 结果：退出码 0；`check.js` 39/39；`check-docs.js` 12/12；零金额扫描 0 命中；`selftest` 39 套 0 失败；`selftest-performance` 149/149。
- 约定：本文数字均为本次实跑或源码静态计数；文档里的历史读数不作为结论依据。

## 2. 响应速度热点（按用户可感知度排序）

| # | 级别 | 位置 | 场景 | 证据 | 影响 | 建议 |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| 1 | P0 | `cloudfunctions/api/handlers/order/listCustomer.js:54-66,72-92`、`listPartner.js:136-152,271-298` | 顾客订单列表、兼职工作台主列表、首页「最近一单」 | 每页按状态**逐个** `await dao.find`（顾客进行中 5 次、工作台默认 7 次），计数再逐个 `await dao.count` 6 次；工作台另加转派计数与已转出查询；这些查询互不依赖 | 列表动作固定 11~16 次串行 DB 往返；首页 `limit:1` 也要付整套计数；工作台每 30s 轮询重复一次 | 用单条 `status in(...)` 查询（与 DATA_MODEL §5.2 的查询路径一致）或至少 `Promise.all` 并行；计数并行后按需缓存 |
| 2 | P0 | `api/client.js:11-12,74-105,166-188`、`api/modules/*.js` | 启动、首屏、下拉刷新、轮询读 | `TIMEOUT_MS=10000`、读动作最多 3 次、退避 300/900ms；超时只 reject、不取消底层 `callFunction`；客户端无在途去重 | 单次读最坏 31.2s；launch 等 bootstrap 也可能 31.2s 才给失败；同一读最多被执行 3 遍 | 读预算分层：启动/首屏/轮询读最多 2 次尝试、单次 6~8s；写动作保持现口径；页面暴露「重试中」而不是只转圈 |
| 3 | P0 | `pages/customer/home/index.js:322-332`、`cloudfunctions/api/handlers/message/list.js:131-185` | 顾客首页每次 onShow 的未读红点 | 首页用 `messageApi.list({limit:1})` 取未读，但后端无轻量接口：消息中心按≤20 单逐单查事件+留言（`:146-166`），再逐绑定查兼职（`:61-73`），另读 users/config/本人订单 | 首页每次显示都可能触发最多约 45~65 次串行 DB 往返；消息中心打开时同样慢 | 增轻量未读接口（或用服务端水位/计数器），首页 30~60s 节流；消息中心改 `orderId in(≤20)` 两次批量查询后内存分组 |
| 4 | P1 | `pages/customer/home/index.js:249-294`、`app.js:188-198` | 首页首屏 | `refresh()` 把绑定与订单放进同一 `Promise.all`，一个 try/catch 统一落错误；绑定复用窗口按**发起时刻**判定 | 绑定失败连订单一起丢成整页错误；慢网或隐私弹窗停留超 30s 会重复发起绑定请求（启动那次仍在飞） | 绑定/订单各自 setData、各自降级；复用窗口按「已返回」判定，尚未返回的 Promise 一律复用 |
| 5 | P1 | `pages/customer/orders/index.js:111-119,200-216` | 订单列表切 tab | `loadPage` 以 `this.data.loading` 单飞挡并发；`onTabTap` 清空列表后调 `refresh()` 又被同一闸挡回 | 请求在飞时切 tab：新 tab 不发请求，旧 tab 的响应按新 tab 落地 → 内容与 tab 不符，用户要再下拉 | 每次请求领代次并在落地时比对 `activeKey`；切 tab 必须发自己的请求（TD-100 同族，建议同批修） |
| 6 | P1 | `pages/customer/orders/index.js:99,111-119`（`scanLimit` 在服务端 `order/listCustomer.js:99`） | 「已完成/已取消」历史列表翻页 | 单状态查询每页只取「最新 60 条」窗口，游标过滤在内存；第 4 页起窗口内已无游标之后的行 | 历史单超过 60 条后列表静默提前结束（不是接口报错），旧单在列表不可达 | 游标下推 `where`（`(sortField,orderNo)` 复合条件），或提高窗口并显式说明上限；到边界时给「只显示最近 N 条」提示 |
| 7 | P1 | `pkg-partner/pages/order-detail/index.js:95-102,116-127` | 兼职订单详情返回/重试 | `onShow` 有数据也调 `load()`，`load()` 无条件 `setData({loading:true})`，模板 loading 分支优先 | 从后台/其他页返回整页变「加载中」；弱网读重试时最长可空白约 31s | 有缓存时静默刷新：仅无数据才置 loading；写成功用返回 DTO 局部更新；失败保留旧数据+顶部错误条 |
| 8 | P1 | `cloudfunctions/api/app.js:113-114,163-167`、`middleware/auth.js:81-112`、`handlers/admin/_common.js:104-108`、`handlers/admin/stats.js:107-129` | 所有云调用；后台各页 | 每个客户端请求先读 config、再读 users（固定 2 次），然后才跑中间件链；后台域又单独 `readConfig` 一次；后台总览串行 11 次 count + 2 次 500 条扫描 | 所有动作多付固定 2 次 DB 往返；后台首屏明显慢；大/非法入参也会先付一次 config 读 | request-guard 前移到任何 DB 读之前；`users` 读结果复用给 handler（`state.meta.actorUser` 已有）；config 短 TTL 缓存（失效路径随 `admin.updateConfig` 处理，ENGINEERING 已记为待裁决）；后台总览并行/范围 count |
| 9 | P1 | `pkg-customer/pages/order-detail/index.js:133-153,181-199`、`pages/partner/workbench/parts/load-flow.js:113-153`、`pkg-partner/pages/messages/index.js:36-41,78-149` | 停留型页面 | 顾客详情 10s 轮询每轮 `order.get` + `message.list(20)` 并整页重绘；工作台 30s 轮询每轮重建分组/深比较/无条件 setData，并重拉转派；兼职消息 30s 轮询两批 setData | 顾客详情 10 分钟约 60 轮、120 次云调用；长驻工作台/消息页持续耗电、弱机掉帧 | 轮询只取变化字段或加 `since`；留言独立低频（≥60s）；轮询结果先判等，无变化 0 批 setData |
| 10 | P1 | `store/index.js:25-30,40-54`、`api/client.js:137-143`、`pages/partner/workbench/index.js:183-195`、`custom-tab-bar/index.js:62-82` | 全局通知 | 每次 `set/patch` 都深拷贝整份 state 并同步遍历全部订阅者；无 key 过滤、无相等判定；skew 计算含 RTT 且在校验 ok 之前写入；工作台订阅回调无 `_hidden` 早退 | 任一成功响应都可能触发一次全量克隆+全订阅扇出（含 5 个 tab 页与各自的 tabBar 实例）；隐藏页仍在跑回调 | `notify(key)` 让订阅者按 key 早退；`set` 加引用/浅等值判定；skew 只用低频响应（或 min-RTT）更新且移入 ok 分支；workbench 回调补隐藏早退 |
| 11 | P1 | `pages/launch/index.js:124-135,216-221,170-193`、`api/modules/user.js:9` | 新用户首次进入、弱网重试 | 首次同意链路三段串行：bootstrap → `acceptPrivacy`（写，10s 超时、不自动重试）→ reLaunch → 首页 3 个读；启动页全程只有「正在进入…」，无尝试次数/无取消 | 新用户首屏 = 三段网络串联；弱网下最多 10s + 首页若干请求，页面无进度反馈 | `acceptPrivacy` 单独短超时并给进度文案；启动页显示「第 n/3 次」；startup 加在途 Promise 复用，重试不叠请求 |
| 12 | P2 | `pages/partner/pick-list/index.js:220-262`、`pages/profile/index.js:83-161`、`pkg-admin/common/list-flow.js:24-100`、`handlers/order/_create.js:45-80,226-230,255-276` | 取件清单复制、我的页、后台列表、下单提交 | 复制清单串行拉最多 10 页且只有一行文案；我的页每次 onShow 2~3 个云调用 + 整 VM 序列化判等；后台列表追加 `list.concat` 全量下发；下单前置串行读 + 每截图读票据 + 每件读失败记录 | 弱网下长任务无进度、无法取消；列表分页越多 setData 越小步长；下单「提交中」等待被串行 RTT 放大 | 长任务给「第 n/10 页」与取消；我的页 60s 节流；追加只发 `list[n]` 路径；票据/失败单号用 `in` 批量 |

## 3. 代码质量与正确性

| # | 级别 | 位置 | 发现 | 影响 | 建议 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| 1 | P1 | `docs/data/V4_DATA_MODEL.md` §5.2 与 `handlers/order/listCustomer.js:54-66`、`listPartner.js:136-152` | 文档的查询路径写「`status in(...)` 一条查询命中 `idx_customer_inprogress/idx_partner_inprogress`」，代码实际按状态逐个等值查询 | 文档不能作为性能证据；也说明当前实现偏离设计 | 二选一对齐：改代码回单条查询，或改文档写清「按状态分桶 N 次」（不推荐） |
| 2 | P1 | 查询与索引清单 | 代码里出现但 §5.1 清单未覆盖的排序/过滤键：列表第二排序键 `orderNo`、`exception.at`、`transfer.resolvedAt`、`users(status, deletionRequestedAt)`、`admin_view_sessions(endedAt)`；DATA_MODEL §5.1 与 ENGINEERING §4.6 两份清单已漂移；RUNBOOK 不检测非唯一索引 | 数据量上去后退化为内存排序/大范围扫描，且无法用现有自检证明「索引已建齐」 | 逐条补索引并统一两份清单；控制台索引导出作为发布附件 |
| 3 | P2 | `cloudfunctions/cleanup/sweeps/storage.js:41-65`、`sweeps/stats.js:38-88` | 清理每轮对终态单做 2 状态×11 条件扫描、每张图再≤12 次计数；统计重算对≤100 个兼职逐个 7 状态 count + 今日 count | 与 api 共库，长轮次会抬高用户请求延迟；兼职增多后单轮线性变长 | 用 `images.fileId` 多值索引一次定位；引用计数批量 `in`；每轮设条数与耗时预算并记录 |
| 4 | P2 | `handlers/user/bootstrap.js:96-118,132`、`middleware/auth.js:82` | bootstrap 在 auth 已读 users 后再读一次；每次启动无条件写 `lastLoginAt/updatedAt` | 每次启动多 1 读 + 1 写；写放大直接落在首屏等待上 | 复用 `state.meta.actorUser`；登录时间写入按天/小时节流 |
| 5 | P2 | `app.js:200-210`、`api/modules/config.js:7-31` | `refreshConfig` 无调用方（死代码）；config 失败不缓存负结果；`store.config` 与模块缓存是两份对象 | 死代码误导后续改动；弱网下每次 onShow 重试配置读 | 删除或真正接线；单一缓存源；失败加 10~30s 负缓存 |
| 6 | P2 | `tools/selftest-performance.js:135` | A3 断言 `app.indexOf('await this.refreshConfig()') < 0`，而该字符串从来不存在 | 空断言=没有断言，给人「已锁住」的错觉 | 改成断言真实行为（如 getPublic 调用次数），并补首屏读次数断言 |
| 7 | P2 | `pkg-customer/pages/order-detail/index.js:244-263`、`pkg-partner/pages/review/index.js:111-124` | 预览图片先并行签发最多 10 张临时 URL 才打开；审核页同屏 10 张原图，无懒加载/缩略图 | 弱网点「查看截图」等最慢一张；审核页首屏流量与内存偏高 | 先签首张立即预览；审核页缩略图+懒加载，点按再取原图 |
| 8 | P2 | `pages/role/index.js:97,137-148,264` | 新用户 roles 为空时 role 页再拉一次 bootstrap（launch 已拉过） | 新用户首屏固定 2 次 bootstrap；每次都可能带重试 | role 信任已水合快照；仅真正缺失时重拉 |

## 4. 性能门禁覆盖度（「有没有牙」）

| 缺口 | 现状 | 建议判据 |
| :-- | :-- | :-- |
| 查询次数/并行度 | 只有 bootstrap 五读并行有并发窗口断言（`selftest-performance.js:195-226`） | 用 fake DB 计数：`order.listCustomer`（进行中）读次数 ≤ 4、`listPartner` ≤ 6；独立查询并发窗口 ≥2 |
| 消息中心批量 | 无 | 断言 `message.list` 不再按单循环 `dao.find`（查询数不随订单数增长） |
| 客户端读预算 | 无（改 10s/3 次/退避全绿） | 断言启动/首屏/轮询读的最多尝试次数与总预算；写动作口径单独断言 |
| 延迟预算 | 无 SLO、无报表 | 云函数日志已有 `elapsedMs`（`app.js:170`），把它接成发布附件：bootstrap/listPartner/listCustomer/message.list 的 P50/P95 |
| 包体积 | main 无测量脚本（`check.js` 只查 ignore 名单）；`perf-health-optim` 分支有体积探针与读请求 12s 总预算，未合入 | 合入体积探针；把「读请求总预算」作为门禁而非文档口径 |

## 5. 建议整改顺序（按性价比）

**第一批·纯性能，不动口径**
1. `listCustomer`/`listPartner` 的状态分桶改为单条 `in` 查询（与文档查询路径一致），counts 改 `Promise.all`；预期列表动作 DB 往返 11~16 → 3~4。
2. `message.list` 改 `orderId in(≤20)` 两次批量查询 + 内存分组；系统通知的兼职资料 `_id in` 批量；首页未读换轻量接口或 30~60s 节流。
3. 客户端读预算分层：启动/首屏/轮询读最多 2 次尝试、单次 6~8s；工作台轮询加在飞跳过与失败退避。
4. 首页 `refresh` 拆绑定/订单两条独立落地与错误；绑定复用窗口按「是否已返回」判定并复用尚未返回的 Promise。
5. 兼职详情 `load()` 仅在无数据时置 loading；写成功用返回 DTO 局部更新。

**第二批·对齐口径与索引**
6. 单状态列表游标下推 `where`；历史翻页到边界时显式结束并给文案。
7. 补索引并统一 DATA_MODEL §5.1 / ENGINEERING §4.6 清单；RUNBOOK 增「非唯一索引核对」项。
8. 后台域复用 `ctx.config`（仅 `admin.bootstrap` 读 seeded）；后台总览并行 count + 范围 count 替代 500 行内存过滤。
9. cleanup 降频/设预算；storage 用 `images.fileId` 多值索引一次定位。

**第三批·会话内体验与门禁**
10. 顾客详情轮询降频/合并（留言 ≥60s）；store 通知按 key 早退；我的页/pick-list 单批 setData。
11. 图片先签首张、审核页懒加载。
12. 按第 4 节给门禁加牙，防止上述优化被后续改动悄悄退回。

## 6. 需真机/控制台确认

1. 工作台/订单列表 100+ 行滚动帧率与单次 setData 字节（当前无虚拟列表，仅分页+分片）。
2. 弱网（高 RTT/丢包）下 launch→首页可交互耗时、`callFunction` 次数，确认 31.2s 尾是否真实出现。
3. 云函数日志 `[api] <action> ... ok N ms` 的 bootstrap、bind.getCurrent、listPartner、listCustomer、message.list 的 P50/P95，以及超时重试对调用量的放大倍数。
4. 控制台索引实建情况（非唯一索引无法由 `admin.bootstrap` 自检）；DATA_MODEL §5.1 与 ENGINEERING §4.6 的差异逐条核对。
5. cleanup 每轮 `durationMs`/超时，是否与 api 抢资源（storage 扫描与 stats 重算两条最重）。
6. 首次同意链路（隐私弹窗→同意→首页）真机耗时。

## 7. 边界与声明

- 本次只读：未改代码、未改项目口径、未提交、未部署；本文件只是归档审查记录。
- 未做真机测量、未连真实库/云环境、未取控制台慢查询；结论 = 静态源码证据 + 门禁实跑输出。
- 建议先落第 5 节第一批（低风险、不动口径），再用第 4 节判据把「查询次数/并行度/读预算」变成可回归的门禁。
