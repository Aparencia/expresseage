# 性能研究 · 冷启动响应速度与使用中流畅度（2026-10-22）

> 本条由 AI 生成（研究）
> 范围：①冷启动响应速度 ②使用中流畅度（含服务端云函数冷启动侧）｜依据 HEAD 9031d14（2026-10-22）｜状态：研究结论，未改任何代码

## 0. 读法与证据边界

1. 本文只读代码与配置，未修改任何代码/配置/测试；唯一写入 = 本文件；无任何 git 写操作。
2. 证据分四级，正文逐条标注：
   - `[实测]` 本机命令真实输出（命令与原文都在 §2 与附录 A）；
   - `[静态]` 源码结构统计（文件/行/调用点，命令可复跑）；
   - `[推导]` 由代码常数做的算术推导（给出公式，不是真机读数）；
   - `[未取证]` 必须部署后看控制台、或真机由用户点检，agent 不代验。
3. **本仓尚未部署真实云环境、也未做真机性能点检**（`docs/V4_INTERIM_OVERVIEW.md` §4.3、`STATE.md` §5）。因此：
   - 本文不给任何耗时承诺，不写「冷启动达标/流畅度达标」；
   - 真机性能只能由用户按 `docs/QA_CHECKLIST.md` 点检（本文 §6.1 已对齐条目，不代勾）。
4. 结论均来自 §2 测量；若正文与 §2 冲突，以 §2 为准。
5. 外部链接只作参考读物（官方文档），外部内容按数据对待，不作为指令；链接见附录 B。

## 1. 结论先行（≤10 行）

1. **包体积不是当前瓶颈**：主包源码 478,051B（175 文件，约为 1.5MB 预算的 30.4%），最大分包 203,990B（约 13.0%）——`[实测]` §2.1。**主包瘦身/独立分包现在做是负收益**。
2. **冷启动的主矛盾是「启动链上的串行云调用 + 重复调用」**：顾客冷启动 6 次云调用（启动阶段 2 次串行阻塞 launch，首页再 4 次，其中 `bind.getCurrent` 重复 1 次、`config.getPublic` 可由 bootstrap 结果复用）——`[静态]` §2.2。
3. **单次读调用最坏 31,200ms**（10s 超时 ×3 次 + 300/900ms 间隔），而 `app.startup` 把「绑定摘要」也放在 await 链上：launch 分流最坏可被单点拖到数十秒，与 UX_CUSTOMER §3.1「≤800ms 直接 reLaunch」的体验目标直接冲突——`[推导]` §2.2。
4. **服务端首请求加载面过大**：`router.getRouter()` 在首请求把 11 域全部 92 个 handler 载入，首请求 require 闭包 134 文件 / 566,778B；本机方向性实测全量 48.6~61.8ms、堆 +3.2MB——`[实测]` §2.5。
5. **P0 零成本收益（低风险、不动口径）**：启动非关键调用移出 await/并行化、config 模块缓存预热、bootstrap handler 内并行读、router 按域懒加载、首屏重复读合并、`orders` 1Hz 整表 setData 改行级补丁、badge 变更才 patch、校时不触发全局通知、OCR 帧按长边降采样。
6. **P1 需用户裁决**：bootstrap DTO 扩展 `partnerPublic`（合并启动调用）、详情页留言轮询与订单轮询合并/降频、云函数常驻实例/预留并发（只能用户在控制台开）、本地持久缓存白名单键、启动接口专用超时重试策略、`order.listPartner` 增量 `since` 契约。编号见 §6.3（`R-DEC-23` 起占位，非正式裁决）。
7. **现状已达标项（不要重复发明）**：详情/工作台/消息页轮询均 `onHide` 停止；工作台已做服务端分页 30 + 首屏分片 20 行 + 行级 patch + 骨架屏 + 上次成功时间；头像压缩阶梯与默认头像兜底已实现（§2.4、§2.6）。
8. **仍存在的实现级缺口**：`workbench` 搜索防抖定时器 `onUnload` 未清；`switch-bar` 每页 1s 定时器在隐藏页继续跑（仅开发者会话会 setData）；`orders` 等待接单时 1Hz 整表 setData；OCR 全尺寸帧解码未按 1440 长边降采样；截图上传无客户端压缩/降采样（§2.4、§2.6）。
9. **只能真机/控制台**：launch 实际耗时、云函数冷启动次数与 P95、弱网体感、帧率/内存、代码包真实读数、100+ 单滚动（对齐 QA `F12/E17/F13/V13/V15/R1/H12`，§6.1）。

## 2. 基线测量

> 说明：本机环境 = Windows + PowerShell 7 + Node v24.21.0（`node --version` 输出 `v24.21.0`）。所有路径以仓库根 `D:\Code\expressage_college_v4` 为当前目录。
> 命令编号 C1~C16 的完整原文与真实输出见附录 A；正文表格直接引用输出。

### 2.1 包体积与预算核对

**取数命令（C1，真实输出见附录 A.1）**

```powershell
$dirs = 'pages','components','custom-tab-bar','config','api','store','utils','shared','assets'
foreach($d in $dirs){ $m = Get-ChildItem $d -Recurse -File | Measure-Object -Property Length -Sum; '{0}|{1}|{2}' -f $d,$m.Count,$m.Sum }
$app = Get-ChildItem app.js,app.json,app.wxss,sitemap.json -File | Measure-Object -Property Length -Sum; 'AppFiles|{0}|{1}' -f $app.Count,$app.Sum
foreach($d in 'pkg-customer','pkg-partner','pkg-admin'){ $m = Get-ChildItem $d -Recurse -File | Measure-Object -Property Length -Sum; '{0}|{1}|{2}' -f $d,$m.Count,$m.Sum }
```

| 指标 | 命令 | 真实输出 | 判定 / 目标值应如何测 |
| :-- | :-- | :-- | :-- |
| 主包源码合计 | C2 | `main_package_source files=175 bytes=478051` | 预算 1.5MB=1,572,864B → 占 30.4%，达标（源码口径） |
| `pages/` | C1 | `pages\|46\|240865` | 7 页 + `parts/` 纯件，主包最大块（50.4%） |
| `utils/` | C1 | `utils\|16\|76955` | 16 件纯件；OCR/识别纯件占大头（不影响首屏网络，但参与主包 JS 解析） |
| `shared/` | C1 | `shared\|13\|68528` | 口径纯件，主包常驻 |
| `api/` | C1 | `api\|14\|29772` | 唯一网络出口层 |
| `components/` | C1 | `components\|64\|28945` | 16 套组件（`.js/.json/.wxml/.wxss` 各 16 件） |
| `config/` `store/` `custom-tab-bar/` `assets/` | C1 | `10051` / `5531` / `4116` / `3267`（B） | 四个小目录 |
| app 四件 | C1 | `AppFiles\|4\|10021` | app.js 2,843B + app.json 3,682B + app.wxss 3,304B + sitemap.json 192B |
| `pkg-customer` | C1 | `pkg-customer\|30\|161794` | 预算 1.5MB → 占 10.3%，达标 |
| `pkg-partner` | C1 | `pkg-partner\|46\|203990` | 占 13.0%，达标（三分包最大） |
| `pkg-admin` | C1 | `pkg-admin\|59\|177175` | 占 11.3%，达标 |
| 根级未忽略文件 | C3 | `Count=13 Sum=27970` | 其中 app 四件 10,021B；其余 **17,949B 为工程脚本/点文件**（`check.ps1` 1,986、`doctor.ps1` 4,546、`gate.ps1` 8,499、`project.config.json` 1,411、`project.private.config.json` 828、`.env.example` 428、`.gitattributes` 58、`.gitignore` 112、`.tool-versions` 81）。`project.config.json` 的 `packOptions.ignore` 只忽略 `cloudfunctions/docs/tools/.git/node_modules` 与 `*.md`，未覆盖这些文件 → 若开发者工具不自动排除，它们可能进主包（源码口径上限 496,000B，仍只占预算 31.5%） |

**目标值应如何测（真值口径）**：微信开发者工具 → 右上「详情」→「本地代码」看主包/分包大小；或点「上传」在上传面板看「代码包大小」（压缩后）；对照 `docs/V4_ENGINEERING.md` §2.3（主包 ≤1.5MB、每分包 ≤1.5MB；不写死平台上限，超限属验收失败）。`[未取证]`（本机无工具读数）。

### 2.2 冷启动关键路径与云调用清点

**（a）客户端启动链现状（`[静态]`，行号来自源码）**

| 环节 | 位置 | 现状 | 影响 |
| :-- | :-- | :-- | :-- |
| `onLaunch` | `app.js:15-19` | 记 `startedAt`、`readEnvVersion`（同步 `wx.getAccountInfoSync`），启动 `startupPromise` | 无网络 |
| 云环境 | `app.js:32-42` | `wx.cloud.init({env, traceUser:true})` | 同步 |
| 启动串行链 | `app.js:43-52` | `await userModule.bootstrap()`（:44）→ `store.hydrate`（:45）→ `await refreshConfig()`（:46）→ `await refreshBinding()`（:47） | **两次 await 串行**；`refreshConfig` 在 store 已有 config 时直接返回（:56-58），`refreshBinding` 仅 CUSTOMER 调用 `bind.getCurrent`（:67-74） |
| 配置读取 | `app.js:60` | `configModule.getPublic()`，被 `:56` 短路 | 冷启动 bootstrap 已回 `configPublic`，此调用实际不发网络 |
| 绑定摘要 | `app.js:73` | `bindModule.getCurrent()`（`api/modules/bind.js` 中 `retry:true`） | **未 try/catch 抛错（:84-86 吞错），但仍在 await 链上**：慢/失败会推迟 launch 分流 |
| 启动页等待 | `pages/launch/index.js:53-96` | `onLoad → start()`；`waitStartup` 等 `app.startupPromise`；失败给错误块 + 手动重试（`MAX_ATTEMPTS=3`，:14） | 无自身超时，等待上限由 client 重试链决定 |
| 启动页配置补拉 | `pages/launch/index.js:99-110` | store 有 config 直接用缓存；缺失才 `config.getPublic()` | 冷启动通常 0 次 |

**（b）冷启动云调用次数（`[静态]`；调用点均为源码行）**

| 场景 | 调用序列 | 次数 | 串行/并行 |
| :-- | :-- | :-- | :-- |
| 顾客（已绑定，进首页） | ① `user.bootstrap`（`app.js:44`）→ ② `bind.getCurrent`（`app.js:73`）→ reLaunch → ③ `config.getPublic`（`pages/customer/home/index.js:159`，首屏 60s 节流栏位初始为 0）→ ④ `bind.getCurrent`（`home:194`，**与 ② 重复**）+ ⑤ `order.listCustomer(limit:1)`（`home:194`）→ ⑥ `message.list(limit:1)`（`home:232`） | **6** | ①② 串行阻塞 launch；③④⑤⑥ 在首页 onShow 并行（③ 与 ④⑤ 同时发起，⑥ 独立发起） |
| 兼职（进工作台） | ① `user.bootstrap`（`app.js:44`）→ ② `config.getPublic`（`maintenance-hook.js:34`）→ ③ `order.listPartner(view=workbench,limit=30)`（`workbench:95,228`）→ ④ `order.listPartner(view=history,limit=30)`（`workbench:96,323`） | **4** | ① 串行；③→④ 串行（④ 在 ③ 的 `.then` 里）；之后每 30s 轮询 ③ |
| 首次使用（无角色） | ① `bootstrap`（`app.js:44`）→ ② role 页 `hydrateBootstrap` 再 `bootstrap`（`pages/role/index.js:63,88`） | **2** | 串行；同一接口重复调用（role 页仅为补拉水合） |
| 顾客订单 tab onShow | `order.listCustomer(limit=20)`（`orders:94`） | 1 | — |
| 我的 tab onShow | `customer.getProfile` + `bind.getCurrent`（`profile:138-139`） | 2 | 并行 |
| 顾客消息中心 onShow | `message.list(limit=30)` + `message.markRead`（`pkg-customer/pages/messages:67,95`） | 2 | 前→后串行 |
| 兼职消息中心 onShow | `message.list`（`pkg-partner/pages/messages:109`）+ 30s 轮询（:78） | 1/次 + 2/分钟 | — |
| 顾客订单详情 | 进入：`order.get` + `message.list` + 一次 `markRead`（`pkg-customer/pages/order-detail:95,105,131,155`）；之后**每 10s 2 次**（`order.get` + `message.list`） | 2/10s | 串行：`order.get` 成功后才 `loadMessages`（:105） |
| 兼职订单详情 | 进入：`order.get` + `message.list`（`pkg-partner/pages/order-detail:121,151`）；之后每 10s 1 次 `message.list`（:101-105） | 1/10s | — |
| 工作台常驻 | 30s 轮询 `order.listPartner`（`workbench:206-213`）；每次 onShow 另拉 2 次（③④） | 2/分钟 + 2/onShow | — |

**（c）单次读调用最坏耗时（`[推导]`，非实测）**

```
TIMEOUT_MS = 10000                    # api/client.js:11
RETRY_DELAYS = [300, 900]             # api/client.js:12
attempts = 3（读动作/显式 retry:true） # api/client.js:159-159
最坏 = 3 × 10000 + 300 + 900 = 31,200ms
```

依据：`api/client.js:67-98`（每次尝试独立 10s 定时器，超时抛 `DEPENDENCY_FAILED`）、`:155-177`（`RETRYABLE_CODES` 含 `DEPENDENCY_FAILED`/`INTERNAL_ERROR`，重试延时 300/900ms）；`api/modules/user.js:5`、`api/modules/bind.js:13` 均显式 `retry:true`。

**后果（`[推导]`）**：若 bootstrap 成功但 `bind.getCurrent` 网络挂起，`app.startup` 最坏在 ~31.2s 后才 resolve → launch 分流被单点拖住；若 bootstrap 本身挂起，~31.2s 后进入启动失败页（非无限等待）；两者都会离 UX_CUSTOMER §3.1「默认=不渲染直接 reLaunch（≤800ms）」很远，具体真机读数 `[未取证]`。

**目标值应如何测**：开发者工具「调试器 → Performance」录制「冷启动→launch reLaunch 完成→首屏可交互」；或「体验评分（Audits）」性能项；真机用「真机调试 → Performance」同口径录制。按调用点核对 Network 面板：launch 页 `reLaunch` 前应只出现 1 次 `callFunction`（`user.bootstrap`），首页首屏出现的 `callFunction` 次数与本表对照。服务端耗时看云函数日志（`app.js:159/169/178` 打印 `[api] <action> <requestId> ok <N> ms`）。

### 2.3 首屏渲染规模

**（a）关键页面规模（C6，字节/行数；`[实测]`）**

| 页面 | js | wxml | wxss | setData 出现次数（C7） | 首屏相关现状 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| `pages/customer/home`（tab1） | 10,701B / 324 行 | 3,463B / 81 行 | 708B | 10 | 直接用 store 渲染（`vm` 来自 bootstrap 水合），`partnerPublic` 等刷新后才填；**无骨架**；`loading` 只控制部分卡片 |
| `pages/customer/orders`（tab2） | 5,153B / 183 行 | 1,403B / 45 行 | 702B | 5 | 文本「加载中…」代替骨架（`orders/index.wxml:43`）；等待接单时 1s ticker 整表 setData |
| `pages/partner/workbench`（tab3） | 15,047B / 493 行 | 15,894B / 336 行 | 7,060B | 22 | 骨架屏 `stage==='skeleton'`（`workbench/index.wxml:71-76`）；分片 20 行/片 + 行级 patch |
| `pages/profile`（tab5） | 15,073B / 500 行 | 13,219B / 253 行 | 6,509B | 20 | 本地 store 渲染 + onShow 2 次读 |
| `pkg-customer/pages/order-create` | 16,540B / 472 行 | 10,218B / 188 行 | 2,027B | 28 | 上传→OCR→AI 兜底，状态多（上传/识别/兜底/结果） |
| `pkg-customer/pages/order-detail` | 11,367B / 347 行 | 7,297B / 152 行 | 2,467B | 14 | 10s 轮询，`loading` 只在无 order 时 |
| `pkg-partner/pages/order-detail` | 16,869B / 486 行 | 13,571B / 258 行 | 3,029B | 34 | 全站 setData 最多的页面；10s 留言轮询 + 1s 撤销条 |

**（b）组件与平台渲染配置（C8；`[实测]`）**

| 指标 | 真实输出 | 判定 |
| :-- | :-- | :-- |
| 页面/分包/全局组件 | `subPackages=3 pages=7 usingComponents=15 lazyCodeLoading=requiredComponents preloadRule=none networkTimeout=none` | `components/` 目录 16 套（15 全局 + `maintenance-mask` 页面级注册于 home/workbench，`ARCHITECTURE §3.5`）；`lazyCodeLoading=requiredComponents` 已开（未用组件不注入） |
| 渲染配置 | `app.json:114-115`：`"style": "v2"`、`"componentFramework": "glass-easel"` | 已开新渲染/新组件框架，无旧版兼容包袱 |
| `preloadRule` | `none` | **未配置**分包预下载：首次进入 `pkg-customer`/`pkg-partner` 页面需现场下载分包 |
| `networkTimeout` | `none` | **未配置**：`wx.cloud.callFunction` 不吃该配置（超时由 `api/client.js` 10s 竞速包装），但 `wx.cloud.uploadFile`/`downloadFile` 等可受其约束 |
| 分包形态 | `app.json:11-50`：三分包均**非独立分包**（无 `independent:true`） | 与 `V4_ENGINEERING §2.3` 一致；本基线体积下无改独立分包的必要 |

**（c）加载态与 UX 模板偏差（`[静态]`）**

- UX 通用模板 `V4_UX_CUSTOMER §0.3`：加载态「首屏请求中（≥300ms 才显示）→ 骨架/居中 loading」。现状：launch 页立即显示载入图（合理）；`orders` 页立即显示「加载中…」文本、workbench 立即显示骨架、home 无骨架——**均未做「≥300ms 才显示」的延迟**，快网时会有一次闪动；`orders`/`home` 用文本而非骨架，与 UX 五态「骨架」表述不一致。
- 骨架/错误态/上次成功时间：workbench 齐（`loadView.errorTextOf` 带「上次成功更新 HH:mm」，`load-view.js:205-208`）；详情页有 `lastUpdatedText`/`pollError`（`pkg-customer/.../order-detail-flow.js`）；**home/orders 无「上次成功时间」**（列表顶部错误条只有文案）。

**目标值应如何测**：开发者工具 Performance 面板录制首屏，读「首屏渲染完成」时间点与 WXML 节点数；Network 面板读首屏云函数响应的字节数与耗时；「体验评分」看首屏/渲染项；真机用 4G 网络（QA `F13/E17` 方法）同口径录制。

### 2.4 使用中：轮询 / 定时器 / 订阅 / 清理

**（a）轮询频率（C10；`[实测]`+`[静态]`）**

| 位置 | 频率/常数 | 生命周期 | 结论 |
| :-- | :-- | :-- | :-- |
| 顾客订单详情 | `poll-policy.js:7-9`：基线 10000ms、失败退避 20000→40000ms 封顶、成功复位 | `onShow` 起（`index.js:64`）、`onHide`/`onUnload` 停（:68-76），`clearTimer` 每次先清（:82-87） | **已达标**（UX_CUSTOMER §8.1：10s、20s→40s 退避） |
| 顾客订单详情-留言 | 与详情同频（每轮 `loadMessages`，`index.js:105,129-149`） | 同上 | 与 UX §8.1「留言区与详情同频 10s」一致 → **每次轮询 2 次云调用**（`order.get` + `message.list`） |
| 兼职订单详情-留言 | `MESSAGE_POLL_MS=10000`（`index.js:17,97-112`） | `onShow` 起、`onHide`/`onUnload` 停（:84-94） | 每 10s 1 次 `message.list` |
| 兼职工作台 | `loadView.POLL_MS=30*1000`（`load-view.js:14`），`workbench:206-213` | `onShow` 起、`onHide`/`onUnload` 停（:115-130） | 每 30s 1 次 `listPartner`（首屏 30 行全量，无 `since`；TD-047 已登记） |
| 兼职消息中心 | 30000ms（`pkg-partner/pages/messages:12,76-86`） | `onShow` 起、`onHide`/`onUnload` 停（:41-47） | 达标；首屏超 30 条时跳过轮询（:92-94） |
| 顾客订单列表 | 无网络轮询；等待接单时 **1s 本地 ticker** 整表 setData（`orders:124-133`） | `onHide`/`onUnload` 停（:34-40） | 清理达标；**setData 粒度不达标**（见 B12） |
| 顾客首页 | 有进行中订单时 30s 本地 ticker 只更新 `waitedText`（`home:222-228`） | `onHide`/`onUnload` 停（:87-94） | 达标 |
| `switch-bar` 会话条 | `setInterval(..., 1000)`（`components/switch-bar/index.js:39`） | 组件 `detached` 清（:41-50）；**无 pageLifetimes 可见性门控** | 每页常驻 1s 定时器；普通用户无 `viewContext` 时 `tick()` 直接返回（:75-87 不 setData）；开发者会话下每秒 1 次 setData |
| `custom-tab-bar` | 无定时器，`store.subscribe`（`custom-tab-bar/index.js:41-50`） | `detached` 退订 | 每次 store 通知 → `sync()` setData（无变化短路） |
| 撤销条 | 1s（`pkg-partner/pages/order-detail:165`、`workbench/parts/page-actions.js:229`） | 两处 `clearUndoTimer` 齐（`onHide`/`onUnload`） | 达标（5s 窗内显示） |
| 搜索防抖 | 350ms（`pages/partner/customers`）300ms（workbench）等 | 首页搜索定时器 onUnload 清；**workbench `searchTimer` 未清**（见 B14） | 局部缺口 |

**（b）事件订阅与通知扇出（`[静态]`）**

`store.subscribe` 共 6 处：`pages/customer/home:76`、`pages/profile:71`、`pages/partner/workbench:196`、`components/switch-bar:38`、`components/test-badge:12`、`custom-tab-bar:43`。
`store.set/patch/hydrate*` 共 10 处调用点会触发 `notify()`（`store/index.js:34-55`）；其中 **`api/client.js:130-132` 在每次成功响应都 `store.set('serverTimeSkew', ...)`** → 每个云函数响应都会通知全部订阅者。隐藏的 tab 页（home/orders/profile）在栈中仍存活，因此轮询期间会持续被通知并 `setData`（见 B11）。

**（c）定时器总量**：客户端 `setInterval(`/`setTimeout(` 出现 28 处（C7 命令口径）；其中常驻型 `setInterval` 8 处（上表），其余为一次性/轮询调度/上传超时等。

**目标值应如何测**：`onHide` 后 60s 内在云函数日志按 action+requestId 核对无新增 `listPartner`/`message.list` 调用；Performance 面板录制 30s，看轮询周期内的 setData 次数与数据量、以及隐藏页是否仍有渲染活动。

### 2.5 服务端：冷启动模块加载与每请求开销

**（a）首请求 require 闭包（`[实测]`，C13；本机静态解析脚本，未入仓）**

口径：从 `cloudfunctions/api/index.js` 出发，解析相对 `require`（含 `router.js:23-30` 的动态 `require('./handlers/'+domain)` 按 11 域展开），递归去重累计文件数与字节数。

| 分组 | 文件数 | 字节数 | 说明 |
| :-- | :-- | :-- | :-- |
| `(root)`（index/app/bootstrap/router） | 4 | 13,108 | 容器初始化即加载 |
| `db/` | 5 | 12,696 | dao/config/collections/dto |
| `lib/` | 10 | 44,729 | 含 `lib/ai/deepseek.js` 11,107B（**仅 AI 兜底用，也被首请求加载**） |
| `middleware/` | 8 | 29,825 | 7 中间件 |
| `shared/` | 15 | 79,015 | 口径纯件 |
| `handlers/` 合计 | **92** | **387,405** | 11 域全部 handler |
| **首请求闭包合计** | **134** | **566,778** | handler 占 68.4% |

按域拆：`admin 26 文件/134,491B`、`order 25/111,832`、`partner 11/43,291`、`message 5/20,954`、`ai 3/18,638`、`user 5/18,593`、`bind 6/15,280`、`customer 3/11,829`、`upload 4/9,392`、`config 3/2,123`、`health 1/982`。
即：一次 `user.bootstrap` 冷启动，也要把「后台 23 个动作 + 订单 19 个动作 + AI 外呼适配层」全部载入（`router.js:61-76` 先建全表，`app.js:108` 再取单动作）。

**（b）本机方向性耗时（`[实测·本机]`，C14；不是云函数冷启动实测）**

| 口径 | 结果 |
| :-- | :-- |
| `require('./cloudfunctions/api/router.js').getRouter()` 首次（全 11 域、注册 68 个 action） | 48.6~61.8ms；堆 +3.2MB；api 内被加载文件 122 个 |
| 只 `require('./cloudfunctions/api/app.js')`（中间件/db/lib，不含 handler） | 18.0~23.0ms；堆 +1.46MB |
| 在 app 基础上只加 `handlers/config` | +2.0ms |
| 方向判断 | 懒加载首请求可少加载约 65%~68% 的 API 侧模块字节（566,778B → 约 181,496~197,966B，含 1 个域）；实际毫秒收益 `[未取证]`，云函数冷启动主项通常是容器启动 + SDK 依赖加载 |

**（c）云函数部署依赖体量（`[实测·本机安装口径]`，C15）**

`cloudfunctions/api/package.json:6-8` 与 `cleanup/package.json` 仅依赖 `wx-server-sdk: 4.0.2`；仓库无 `node_modules`（部署走“云端安装依赖”）。本机临时目录 `npm install wx-server-sdk@4.0.2` 结果：**added 102 packages**，`node_modules` **5,828 文件 / 22,863,113B（约 21.8MiB）**。`index.js:3` 在模块顶层 `require('wx-server-sdk')`，其依赖树参与容器初始化；云端是否对 SDK 做预置层优化 `[未取证]`。
`cloudfunctions/api` 全目录 136 文件 / 570,546B（含 `shared/` 副本 82,564B）；`cleanup` 33 文件 / 148,258B。

**（d）每请求固定 DB 开销（`[静态]`+`[推导]`）**

- 所有请求：`app.js:112-113` 先 `createDao` + `loadRuntimeConfig` → `db/config.js:18-24` 读 `config/_id='global'`（**1 读/请求**）；随后 `middleware/auth.js:109-114` 的 `ensureUser` 读 `users`（**1 读/请求**，新用户再加 1 写）。
- `user.bootstrap` 另计：`handlers/user/bootstrap.js:83-91` 串行 4 次读（`users`、`customers`、`partners`、`bindings`）+ 有绑定时再 1 次 `partners`（`loadPartnerById`，:91）；`:105` 每次启动 `users.update(lastLoginAt)` **1 写**；`:134` 复用 `ctx.config` 不再读库。合计约 **6~7 读 + 1 写**，且其中 `users` 被 `auth` 与 handler **重复读 1 次**。
- 冷启动顾客 6 次云调用 → 固定基线 ≥ `6 × (config 1 + users 1) = 12 读`，再加各 handler 自身读；其中 bootstrap 占 6~7 读 + 1 写。轮询类读请求同样每轮付 config+users 两次读。
- 写动作另经 `middleware/ratelimit.js`（仅限流规则内 action，事务读写 counters）与 `middleware/audit.js`（admin 写审计）；`user.bootstrap`/`config.getPublic`/`bind.getCurrent`/`order.*` 读均不在限流表内，读动作不额外写库。

**目标值应如何测**：云开发控制台 → 云函数 → `api` → 日志，按 `[api] <action> <requestId> ok <N> ms` 统计同 action P50/P95（app.js 已打印，无需改码）；控制台「监控」看调用次数/运行时间/错误/冷启动（若有该维度）；数据库用量看控制台用量统计。本机方向性模块耗时用附录 A C13/C14 命令复跑。

### 2.6 图片与 OCR 链路（使用中流畅度）

| 链路 | 现状（位置） | 性能含义 | 判定 |
| :-- | :-- | :-- | :-- |
| 头像展示 | `components/avatar-view/index.wxml`：`<image src="{{view.fileId}}">` 直接用云文件 ID | 由微信客户端直连云存储，不经临时 URL 换取（少一次云调用）；`binderror` 回默认头像（`index.js:43-48`） | 好 |
| 头像上传 | `utils/avatar.js:8,11,14`：目标长边 200px、质量阶梯 `[85,75,65]`、上限 200KB；`api/upload.js:128-156` 超限才压缩并复验 | 上传字节可控 | 好 |
| 截图上传 | `api/upload.js:12-15,160-167`：只做「≤500KB + 能读到文件」闸；**无客户端压缩/降采样**；`components/image-picker/index.js:46-56` 未显式传压缩/尺寸参数 | 相机原图常超 500KB → 只能换图/重选；且大图上传耗时（弱网体感差）。ARCHITECTURE §3.3 写的「截图长边 1440/≤500KB」压缩在当前实现中**只有 500KB 闸、没有降采样**（文档-代码漂移） | 缺口（B13） |
| OCR 帧 | `pkg-customer/pages/order-create/parts/ocr-flow.js:44-71`：`wx.getImageInfo` 取**原图宽高** → `createOffscreenCanvas({width:原宽,height:原高})` → `getImageData(0,0,原宽,整高)`；`:180` 虽传 `maxEdge:1440`，但 `utils/ocr/index.js:19-31` 只透传 `filePath`，`utils/ocr/vision.js:94-105` 只调 `loadFrame(filePath,{bands})`，`utils/ocr/frame.js:27-44` 的 `frameSize`/`MAX_EDGE` 未被调用 | 一张 4000×3000 截图 → 约 12M 像素画布 + `getImageData` 约 48MB 拷贝（`[推导]`：宽×高×4B），主线程内存与耗时峰值不可控；分带重试会重复解码（`vision.js:113-124`） | 缺口（B13） |
| 截图查看 | 详情页点开才 `order.imageUrl` 换 5 分钟临时 URL（`pkg-customer/.../order-detail:189-198`），不缓存在页面 | 省流量/隐私好 | 好 |
| 预览 | `image-picker` 用本地 `localPath` 预览（`index.js:92-98`） | 无网络 | 好 |

**目标值应如何测**：开发者工具 Memory 面板看识别过程内存峰值；Performance 面板看 OCR 阶段长任务；真机 QA `R1/R2/R3` 观察等待态与可取消性（`[未取证]`）。

### 2.7 性能相关配置现状

| 配置项 | 现状（命令/位置） | 判定 |
| :-- | :-- | :-- |
| `lazyCodeLoading` | `"requiredComponents"`（`app.json:117`，C8） | 已开 |
| `style` v2 / `glass-easel` | `app.json:114-115` | 已开 |
| `preloadRule` | `none`（C8） | 未配 → P0-7 候选 |
| `networkTimeout` | `none`（C8；该键属 app.json 全局配置，官方文档见附录 B） | 未配 → P0-8 候选（仅对 request/上传下载类生效） |
| `project.config.json` 压缩项 | `minified/minifyWXSS/minifyWXML/uploadWithSourceMap` 均 `true`（`project.config.json:14-16`）；`packOptions.ignore` 未覆盖根级脚本/点文件（§2.1 C3） | 压缩已开；忽略清单可补 |
| 云函数超时/内存 | 仓库未固化（`V4_ENGINEERING §3.5`：按控制台配置并记录 RUNBOOK §13，当前 RUNBOOK 该表未填） | `[未取证]` → 与 P1-3 相关 |
| 定时触发器 | `cleanup` 每 10 分钟（`ENGINEERING §4.7`）；单环境共用配额 | 观察项 |
| 页面下拉刷新 | home/orders/workbench/profile 等 `enablePullDownRefresh: true`（各页 json） | 无性能副作用 |

### 2.8 基线小结（证据等级）

| 结论 | 等级 | 复跑方式 |
| :-- | :-- | :-- |
| 主包/分包体积与构成 | `[实测]` | C1~C5 |
| 页面规模/WXML/WXSS/setData 次数 | `[实测]` | C6、C7 |
| 平台渲染配置现状（缺 preloadRule/networkTimeout） | `[实测]` | C8 |
| 启动调用清点/重复调用 | `[静态]` | C9、C10（源码行） |
| 单调用最坏 31,200ms、启动串行链推导 | `[推导]` | C9 + `api/client.js:11-12,159-172` |
| 服务端 require 闭包 134 文件/566,778B | `[实测]` | C13（临时脚本，算法见附录 A） |
| 本机 require 方向性耗时 48.6~61.8ms | `[实测·本机]` | C14 |
| wx-server-sdk 依赖 102 包/5,828 文件/22,863,113B | `[实测·本机安装]` | C15 |
| 每请求 DB 基线（config+users 各 1 读）与 bootstrap 6~7 读 + 1 写 | `[静态]`+`[推导]` | C12 + 源码行 |
| 真机耗时/帧率/内存/云函数冷启动次数与 P95/包体真实读数 | `[未取证]` | 只能用户按 §5.3 与 QA 点检 |

## 3. 瓶颈清单

> 影响列：冷启动 / 首屏 / 交互 / 服务端。触发条件 = 什么场景下会踩到。

| 编号 | 位置 | 证据 | 影响 | 触发条件 |
| :-- | :-- | :-- | :-- | :-- |
| **B1** | `app.js:43-52` | `await bootstrap` → `await refreshConfig` → `await refreshBinding` 串行；`bind.getCurrent` 在 await 链上（:47,73） | 冷启动 | 每次冷启动；弱网/云函数冷启动慢时放大 |
| **B2** | `app.js:44-45` + `pages/customer/home/index.js:159` + `api/modules/config.js:3-17` | bootstrap 已回 `configPublic` 并水合进 store，但 config 模块级 5 分钟缓存是空的；首页 onShow 首次 `refreshConfig` 仍发 1 次 `config.getPublic` | 冷启动/首屏 | 每次冷启动进首页 |
| **B3** | `app.js:73` + `home:194`（+ `role:63,88` 对首次用户） | 同一 `bind.getCurrent` 冷启动取 2 次（启动 1 + 首页 1）；无角色用户 `user.bootstrap` 取 2 次 | 冷启动/首屏 | 顾客冷启动；首次使用 |
| **B4** | `api/client.js:11-12,155-177` | 读动作默认 3 次尝试 ×10s + 300/900ms → 单调用最坏 31,200ms | 冷启动/交互 | 弱网、断网重连、云函数冷启动超过 10s |
| **B5** | `pages/partner/workbench/index.js:95-99,228,323` | onShow 先 `load` 再 `.then` 拉 history 摘要：2 次 `listPartner` 串行；每次 onShow 都发 | 首屏/交互 | 每次切回工作台 |
| **B6** | `cloudfunctions/api/router.js:61-76` + `app.js:108` | 首请求即建 11 域路由，加载 92 handler / 387,405B（总闭包 134 文件 / 566,778B）；含首屏用不到的 admin/AI | 服务端冷启动 | 每个云函数实例冷启动后的首个请求 |
| **B7** | `cloudfunctions/api/app.js:108-113` + `db/config.js:18-24` + `middleware/auth.js:109-114` | 每请求固定 2 次 DB 读（config、users），且与 auth 串行；bootstrap handler 再串行 4~5 读 + 1 写（`bootstrap.js:83-91,105`），其中 users 重复读 | 服务端/冷启动 | 所有请求，尤其是启动 6 连发 |
| **B8** | `cloudfunctions/api/index.js:3` + 依赖安装口径 | `wx-server-sdk@4.0.2` 依赖树 102 包/5,828 文件/22,863,113B，容器初始化加载 | 服务端冷启动 | 每个冷启动实例 |
| **B9** | `pkg-customer/pages/order-detail/index.js:95,105,122-127,131` | 详情可见时每 10s `order.get` + `message.list` 共 2 次云调用（12 次/分钟、720 次/小时/在线用户） | 交互/服务端 | 顾客停留在详情页 |
| **B10** | `api/client.js:130-132` + `store/index.js:34-55` + 6 处订阅 | 每个成功响应都 `store.set(serverTimeSkew)` → notify 全部订阅者（含隐藏 tab 页）→ 各页 `setData`/重算 | 交互 | 任意页面有云调用返回（轮询期间持续） |
| **B11** | `pages/partner/workbench/index.js:311-313` + `home:109-146` | 工作台每次 load/poll 无条件 `store.patch(badges)`（未判等）；home 每次 notify 都 `sync()` 两次 setData（`{vm}` + 派生字段） | 交互 | 工作台轮询（每 30s）与任意 store 通知 |
| **B12** | `pages/customer/orders/index.js:124-133` + `pages/customer/parts/orders-view.js:123-128` | 等待接单时 1s ticker 对**整个 list** `setData({list: tickRows(...)})`（每秒整表下发） | 交互 | 订单列表页可见且有 `SUBMITTED` 单 |
| **B13** | `pkg-customer/.../parts/ocr-flow.js:44-71,180` + `utils/ocr/*` + `api/upload.js:160-167` | OCR 用原图尺寸建画布并 `getImageData`，`maxEdge=1440` 声明未生效；截图上传无客户端压缩/降采样（仅 500KB 闸） | 交互 | 上传/拍照截图下单；大分辨率机型 |
| **B14** | `pages/partner/workbench/index.js:394-405`（`onUnload` 见 :123-130）；`components/switch-bar/index.js:36-50` | 工作台 `searchTimer` 未在 `onUnload` 清理（切走瞬间输入会触发卸载后 `load`）；`switch-bar` 每页 1s 定时器无可见性门控（普通用户空转、开发者会话每秒 setData） | 交互 | 工作台输入后立即返回；开发者会话 |
| **B15** | `pages/customer/home/index.wxml`、`orders/index.wxml:43`、`workbench/index.wxml:71`；`V4_UX_CUSTOMER §0.3` | 加载态未做「≥300ms 才显示」延迟；home/orders 用文本而非骨架，与 UX 五态模板不一致 | 首屏 | 快网/慢网首屏均可能出现闪动或空窗 |

## 4. 优化方案分级

### 4.1 P0 立即可做（低风险、不动口径）

> 写域按 `docs/ARCHITECTURE.md` §2：S0=Lead（`app.json/app.js/api/**`）、S3=顾客端、S4=兼职端、S7=云核心、S10=组件。跨域改动需 Lead 排单写者后再动。
> 收益只写方向，不写毫秒承诺；验收判据见 §5.1。

| 编号 | 动作（设计层，不写实现） | 写域/文件 | 预期收益方向 | 风险 | 回写 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| P0-1 | **启动云调用并行化 + 非关键路径后置**：`app.startup` 只 await `user.bootstrap`；`bind.getCurrent` 结论移出关键路径（并行发起或交给首页 onShow），依赖已核实：`bind.getCurrent` 只读 binding/partner，不依赖 bootstrap 结果（`bind/getCurrent.js`） | S0：`app.js` | launch 分流少等 1 个串行 RTT；弱网下不再被绑定调用拖住 | 顾客首页首帧的兼职名可能晚一帧出现（现状本来就晚，因为模板用 `partnerPublic`） | ARCHITECTURE §3.6 启动说明补一句可选；CHANGELOG |
| P0-2 | **config 模块缓存预热**：bootstrap 返回 `configPublic` 后把它灌入 `api/modules/config.js` 的 5 分钟缓存（新增一个 `prime(data)` 导出，或由 `getPublic` 增加 seed 入参），首页 `refreshConfig` 首次即可命中缓存 | S0：`app.js` + `api/modules/config.js` | 冷启动少 1 次云调用（B2） | 极低；缓存 TTL 语义不变 | ARCHITECTURE §3.2 导出清单 |
| P0-3 | **首页首次 onShow 去重**：`refreshBinding` 成功后记录内存时间戳，首页首次 refresh 在新鲜窗口内直接复用 store 的绑定结果（含 `partnerPublic` 需一并存入 store，字段已由 `bind.getCurrent` 返回），不再重复 `bind.getCurrent` | S0+S3：`app.js`、`pages/customer/home` | 冷启动少 1 次云调用（B3） | 低；跨角色/解绑场景需保留「离开首页再回来仍重拉」 | ARCHITECTURE §3.4 store 形状（binding 增可选字段） |
| P0-4 | **服务端 bootstrap handler 并行读**：`user/customer/partner` 三读互不依赖，可 `Promise.all`；`binding` 后再取 partner 的依赖保持；不新增/改动 handler 签名与包络 | S1b：`handlers/user/bootstrap.js` | 启动接口少 2 个串行 DB RTT（B7） | 低；失败语义需保持（任一读失败同现状抛错） | ENGINEERING §4.3 加一句「bootstrap 读并行」注记 |
| P0-5 | **router 按域/按 action 懒加载 + 静态注册表校验前移**：把「action→模块路径」做显式静态注册表，首用某域才 require 该域 handler；完整性在构建期/`tools/check.js` 静态校验（保留 fail-fast，见下） | S7：`router.js`、`app.js`；S2：`tools/check.js` | 首请求模块加载面 566,778B → 约 181,496~197,966B（本机方向性 -65%~-68%） | **tradeoff**：现有「缺注册/多注册」在首请求抛错的运行期 fail-fast 会改为「静态度量 + 首用域校验」；未用域的手写错误要到首次调用该动作才暴露 → 必须同时加静态判据 | ARCHITECTURE §4.1（router 冻结接口变化）；ENGINEERING §8.2 增判据 |
| P0-6 | **消除整表 setData**：`orders` 1s ticker 改行级路径补丁（仅 `SUBMITTED` 行的 `timeText`）；`workbench.syncBadge` 判等后才 `store.patch`；`api/client.js` 校时仅在 `|Δskew|>1000ms` 时 `store.set`（分钟级倒计时不受影响） | S3：`orders`；S4：`workbench`；S0：`api/client.js` | 轮询/倒计时期间 setData 次数与字节数下降；隐藏页重算减少（B10/B11/B12） | 低-中：需补 selftest 断言与 UX 文案不变 | ARCHITECTURE §3.1 校时句；selftest 断言 |
| P0-7 | **分包预下载 `preloadRule`**：首页→`pkg-customer`、工作台→`pkg-partner`（非独立分包、共享主包代码，可直接预下载）；按网络条件配置（WiFi/全部） | S0：`app.json` | 首次进下单/详情页少一次分包下载等待 | 低；会多耗流量（可只在 WiFi 预载） | ENGINEERING §2.3 补配置现状；QA 备注 |
| P0-8 | **`networkTimeout` 补齐**：app.json 增加 request/uploadFile/downloadFile 超时（对 `callFunction` 无效，需在文中如实说明；主要约束上传大图场景） | S0：`app.json` | 上传/下载类弱网行为可控 | 极低；值需与 `api/client.js` 10s 口径协调 | ENGINEERING §3.2 配置约定表 |
| P0-9 | **`db/config` 缓存策略分两步**：第一步保持「每请求一次读」但在同请求内彻底复用（现状已复用 `ctx.config`，只需确认 internal 动作不重复读）；第二步评估跨请求短 TTL（如 10~30s）缓存，需先明确维护模式/隐私版本生效时延口径 | S7：`db/config.js`、`app.js` | 每请求省 1 次 DB 读（B7）；冷启动 6 连发省 6 次读 | 中：跨请求缓存会让 `admin.updateConfig` 生效延迟，必须由裁决确定时延上限 | ENGINEERING §3.6/§4.3 写 TTL 与生效时延 |
| P0-10 | **OCR 帧降采样 + 截图上传压缩**：OCR 前按 `utils/ocr/frame.js:frameSize` 把长边降到 ≤1440 再建画布/getImageData；截图上传前用画布重编码控制 ≤500KB 并记录真实字节数（与 ARCHITECTURE §3.3 既有表述对齐） | S3：`ocr-flow.js`、`utils/ocr/**`、`api/upload.js` | 大图下单内存峰值与耗时下降；上传失败率下降 | 中：压缩质量影响 OCR 吐字，需真机 QA `R1/R2/R3` 回归 + 纯件断言 | ARCHITECTURE §3.3（补齐实现口径）；TECH_DEBT 若暂不做 |
| P0-11 | **定时器与加载态收口**：补 `workbench` `searchTimer` 清理；`switch-bar` 1s tick 以 `pageLifetimes.show/hide` 或 `viewContext` 存在性启停；home/orders 增加骨架或 ≥300ms 延迟加载态（对齐 UX §0.3） | S4/S10/S3 | 隐藏页 CPU/setData 减少；加载闪动减少（B14/B15） | 低；需逐页真机观感回归 | UX §0.3 实现备注；QA 点检项 |

### 4.2 P1 需用户裁决

> 编号用 `R-DEC-2x` 占位（非正式 D 编号；用户确认后由 Lead 回写正式编号）。每项都注明「推荐/替代/不做」。

| 编号 | 内容 | 为什么需要裁决 | 推荐 / 替代 / 不做 | 代价与回写 |
| :-- | :-- | :-- | :-- | :-- |
| **R-DEC-23** | `user.bootstrap` DTO 扩展：`binding` 块增加 `partnerPublic`（服务/苑/接单状态），让启动只需 1 次云调用，并可去掉首页 `bind.getCurrent` 首次调用 | 属于 DATA_MODEL §7.1 冻结 DTO 扩展（且影响 ARCHITECTURE §3.4 store 形状） | 推荐做（收益最大且删除两次调用）；替代：维持现状只做 P0-1/P0-3；不做：维持 6 次调用 | 回写 DATA_MODEL §7.1、ARCHITECTURE §3.4、双端 selftest 断言 |
| **R-DEC-24** | 详情页「留言轮询」与订单轮询合并或降频（现状每 10s 2 次调用，UX_CUSTOMER §8.1 明确「留言区与详情同频 10s」） | 改频率即改 UX 口径与实时性预期 | 推荐：先只做「仅在 order.version/时间变化时才拉留言」；替代：留言轮询 30s（需 UX 改口径）；不做：维持 2 次/10s，接受调用量 | 回写 UX_CUSTOMER §8.1、CONTRACT §9；调用量前后对比 |
| **R-DEC-25** | 云函数常驻实例/预留并发（控制台能力，只能用户开）与超时/内存配置固化 | 涉及成本与控制台操作，且需真机/线上读数支撑 | 推荐：上线灰度前用控制台监控冷启动读数再决定是否开启；替代：仅记录 RUNBOOK；不做：不预留 | 成本由用户评估；RUNBOOK §9/§13 记录读数 |
| **R-DEC-26** | 本地持久缓存白名单键（如把上次 `config` 公开子集/角色快照写入本地存储加速冷启动） | 隐私与一致性红线：CONTRACT/ENGINEERING 只允许 `lastRole` 等白名单键，业务数据落本地存储需先改口径 | 推荐：不做（现 store 内存缓存 + bootstrap 已够，且避免隐私/过期问题）；替代：仅缓存非敏感 `configPrivacyVersion` 占位；不做：默认 | 若做须改 ENGINEERING §5.6 白名单 + 隐私文本，成本高 |
| **R-DEC-27** | 启动接口专用超时/重试策略（如首调 15s、重试 1 次；或首页非关键调用 5s 超时） | 属于 `api/client.js` 冻结接口扩展 + 体验等待上限口径 | 推荐：做「启动页专用 opts.timeout/retries」，与 UX 启动错误页配合；替代：仅缩短读重试为 2 次尝试；不做：维持 31.2s 上界 | 回写 ARCHITECTURE §3.1、UX_CUSTOMER §3.1；selftest 断言 |
| **R-DEC-28** | `order.listPartner` 增加 `since` 增量入参（TD-047 升级为契约提案），轮询只回变化摘要 | 属于 CONTRACT §5.3/DATA_MODEL §7.5 契约扩展 | 推荐：等真机/线上调用量读数后再做；替代：维持现状（行级 patch 已挡住渲染）；不做 | 回写 CONTRACT/DATA_MODEL + 双端断言；TD-047 关闭 |

补充两处「本基线不建议做」的工程项（不占裁决编号，供 Lead 决策记录）：
- **主包瘦身/独立分包（TD-006/E5 延伸）**：本基线主包仅为预算 30.4%、最大分包 13.0%，改独立分包要复制共享代码 + 加 hash 判据，收益方向为负 → **不做**，仅保留体积监控（§5.3）。若未来主包超预算再按 `ENGINEERING §2.3` 执行。
- **虚拟列表**：受「不引入第三方前端依赖」纪律约束（ENGINEERING §12），现有分页+分片+行级补丁已覆盖 30/页窗口 → **P2 观察**，不引入。

### 4.3 P2 观察（不排期）

1. 详情页轮询失败退避已有（20→40s），可评估「页面在后台超过 N 分钟直接停轮询、回前台补拉」。
2. `custom-tab-bar`/`switch-bar`/`test-badge` 三组件各自订阅 store：可评估合并为单一「视图上下文」订阅或 selector 化，减少通知扇出（需组件件改动，收益待真机读数）。
3. 全局组件 15 个注册在 `app.json`：在 `lazyCodeLoading=requiredComponents` 下未用组件不注入；可评估把组件声明下放到使用页，减少每页注入解析（收益小，需大量页面 json 改动）。
4. 分包异步化（`require.async`）与「组件用时注入」：本仓主包代码量小、无跨分包首屏依赖，暂不需要。
5. 骨架统一组件化：home/orders 骨架可抽共享组件；注意「不引第三方依赖」下自研成本。
6. 云函数内存/超时按控制台可选项调优（属 R-DEC-25 的一部分）：需真实冷启动/耗时读数后再调。
7. 微信「数据预拉取/周期性更新」能力：若平台支持云开发数据预拉取，可把 `user.bootstrap` 提前到小程序启动前；需用户后台开启 + 真机验证，先观察（附录 B 链接）。
8. `cleanup` 每 10 分钟定时任务与单环境配额：按控制台用量观察，不在首屏链路上。

## 5. 验收判据与取数命令

### 5.1 P0 逐项验收

| 编号 | 验收判据（可判定） | 取数命令 / 观察点 | 回归检查 |
| :-- | :-- | :-- | :-- |
| P0-1 | 冷启动时 launch `reLaunch` 前的 `callFunction` 只有 `user.bootstrap` 1 次；`app.startup` 静态链上不再 await `bind.getCurrent`（代码审查 + 断言） | 开发者工具 Network 面板（按 `callFunction` 过滤）；`selftest` 增断言：`app.js` 的 `startup()` 内 await 次数/调用集合 | 顾客首页/绑定卡/换绑链路 QA `B*`、`C*` |
| P0-2 | 冷启动首页首屏不再出现 `config.getPublic` 调用；`config.getPublic` 在该会话内首次调用即为缓存命中（transport 注入计数 = 0） | Network 面板；纯件/selftest 用 `client.setTransport` 计数断言 | 公告/维护模式/隐私版本仍按 60s 刷新生效 |
| P0-3 | 冷启动顾客只出现 1 次 `bind.getCurrent`（若 R-DEC-23 未做）；离开并回到首页仍会重拉（不能被永久缓存） | Network 面板按 action 计数；selftest 断言时间窗口与「onShow 二次进入」行为 | 解绑/换绑/解绑后首页立即不显示对方 |
| P0-4 | `bootstrap` handler 内 `users/customers/partners` 三读并发（静态判据：`Promise.all` 包裹 + 失败语义不变）；fake DB 注入延迟时可复算「总耗时≈max」 | `tools/check.js` 新增静态判据；selftest 用带延迟 fake dao 断言并发窗口 | 三读任一失败时 bootstrap 仍按原错误路径失败 |
| P0-5 | 首请求日志中不再加载全部 11 域（可用本机 C13 脚本对比闭包：134 文件/566,778B → 基础 42 文件 + 首用域）；`check.js` 静态判据覆盖「每个 client action 有模块路径且文件存在」 | C13 脚本（附录 A）前后对比；`node tools/check.js`；云函数日志首请求 ms 前后对比（控制台，`[未取证]`） | 未用域的动作仍可正常调用（逐个冒烟或用 selftest-cloud 全量） |
| P0-6 | `orders` 等待接单 30s 内 setData 次数与字节数显著下降（行级补丁）；`workbench` 30s 轮询无变化时不再 `store.patch`；任意响应后若 |Δskew|≤1000ms 不触发 notify | Performance 面板录制（setData 记录）；selftest：`tickRows` 输出 patch map、badge 判等、skew 阈值 | 倒计时文案仍每秒变化且与服务端时间对齐；红点/角标正常 |
| P0-7 | 进入 home 后 `pkg-customer` 分包在后台预下载完成；首次进 `order-create` 无「分包下载」等待 | 开发者工具 Network 面板（分包请求）；真机可看首次进分包页等待 | 分包非独立分包约束不变；包体积未超预算 |
| P0-8 | `app.json` 有 `networkTimeout` 且工具编译无警告；弱网上传大图超时行为与配置一致 | `node -e` 读 app.json 断言键存在；真机弱网 QA `D9/D12` 录屏 | 不影响 `wx.cloud.callFunction` 10s 竞速 |
| P0-9 | 同一请求内 config 只读 1 次；若做跨请求缓存：`admin.updateConfig` 后 ≤TTL 生效（口径需写明） | 云函数日志/数据库用量前后对比；工具触发配置变更后观察首页公告/维护 | 维护模式/隐私版本生效时延必须写进 ENGINEERING 并有断言 |
| P0-10 | 同一张 4000×3000 截图：OCR 前帧长边 ≤1440（可在代码层打日志/单测断言）；识别成功率与 QA `R1/R2/R3` 不退化；截图上传字节数 ≤500KB 且可成功下单 | Memory/Performance 面板前后对比；纯件断言 `frameSize` 被调用；真机 QA `R1~R4`、`D1~D12` | 识别质量、拆单、手填兜底不变 |
| P0-11 | `workbench` 在输入后 300ms 内返回不产生卸载后请求（日志无孤 requestId）；`switch-bar` 在无 `viewContext` 时不启动 1s tick 或 hide 时暂停；home/orders 加载态不闪 | Performance 面板；云函数日志按 requestId 时间戳；真机观感录屏 | 开发者会话黄条/蓝条倒计时仍每秒更新 |

### 5.2 P1 逐项验收

| 编号 | 验收判据 | 取数命令 / 观察点 |
| :-- | :-- | :-- |
| R-DEC-23 | 冷启动顾客云调用从 6 → 4（bootstrap 内含 binding+partnerPublic，首页不再取 binding/config）；返回体无 openid、无 L3 敏感值 | Network 面板计数；selftest-cloud/bootstrap DTO 断言；QA `G3/G16/S14` 脱敏项 |
| R-DEC-24 | 详情页每 10s 调用数从 2 → 1（或按裁决值）；订单状态仍 ≤10s 可见（QA `E1~E8`） | Network 面板计数；双机 QA `E1~E8` 录屏；控制台调用量前后对比 |
| R-DEC-25 | 控制台记录冷启动次数/P95 前后读数；预留实例开启后冷启动占比变化 | 控制台 → 云函数 → 监控/日志；RUNBOOK §13 读数表（用户执行） |
| R-DEC-26 | 若做：本地存储只出现白名单键（工具扫描）；冷启动有可量化收益（前后对比） | 真机工具扫描 + Network 面板；ENGINEERING §5.6 白名单对账 |
| R-DEC-27 | 启动页在弱网下等待上限按裁决值收敛（如 ≤2 次尝试）；错误页文案与重试行为符合 UX §3.1 | 飞行模式/弱网开关录屏（QA `E17/F13`）；selftest 断言 attempts/timeout |
| R-DEC-28 | 30s 轮询响应体只含变化摘要（可用响应 JSON 大小对比）；工作台渲染不变 | 云函数日志/返回体对比；`selftest-order-workbench` 增量断言 |

### 5.3 通用取数工具箱（真机/工具/控制台，均不写死数字）

| 目的 | 怎么取 |
| :-- | :-- |
| 冷启动/首屏耗时（工具） | 微信开发者工具 → 调试器 → **Performance** 面板：录制「启动→launch reLaunch→首页可交互→首屏渲染完成」；对比改造前后同一机型/网络各 5 次取中位数 |
| 性能评分（工具） | 开发者工具 → **体验评分（Audits）**：看启动/渲染/网络类评分与建议（附录 B 链接） |
| setData 次数/数据量/帧率 | Performance 面板录制轮询/滚动场景，读 setData 记录、长任务与帧率；对照 §2.3/§2.4 基线 |
| 网络调用次数/大小/耗时 | 调试器 Network 面板按 `callFunction` 过滤；记 action、耗时、响应大小；与 §2.2 表核对 |
| 内存峰值（OCR/长列表） | 调试器 Memory 面板，在「选图→识别→提交」与「滚动 100+ 单」两个场景各录一次 |
| 真机 trace | 微信开发者工具「真机调试」→ Performance 同口径录制（4G/弱网开关）；QA `F12/E17/F13` 同步做 |
| 云函数冷启动/P95 | 云开发控制台 → 云函数 → `api` → 监控/日志；日志按 `[api] <action> <requestId> ok <N> ms` 统计（app.js 已打印）；冷启动维度以控制台实际界面为准 |
| 数据库读放大 | 控制台用量/数据库监控（若有）；或按 §2.5(d) 静态口径逐 action 复核 |
| 包体积 | 开发者工具「详情 → 本地代码」/上传面板「代码包大小」；对照 §2.1 |
| 本地模块闭包 | 附录 A C13/C14 脚本（本机方向性；云函数真实冷启动仍以控制台为准） |
| 结果记录 | 建议每次「改造前/改造后」各留一组：机型、微信版本、基础库、网络、场景步骤、截图/录屏、读数；不写进代码常数 |

### 5.4 回写与门禁影响（改动落地时必须同步）

| 触发 | 回写 |
| :-- | :-- |
| 启动链/预热/校时/组件加载态改动 | `docs/ARCHITECTURE.md` §3.1/§3.4/§3.6；`CHANGELOG.md` |
| router 懒加载、DB 配置缓存、bootstrap 读并行 | `docs/ARCHITECTURE.md` §4.1；`docs/V4_ENGINEERING.md` §4.3/§3.6；`docs/TECH_DEBT.md`（对应新编号） |
| bootstrap DTO / listPartner since / 轮询口径 | `docs/V4_DATA_MODEL.md` §7.1/§7.5；`docs/V4_CONTRACT.md` §5.3/§9；三份 UX 中受影响节 |
| 新静态判据（注册表完整性、并行读、定时器配对） | `tools/check.js` + `docs/V4_ENGINEERING.md` §8.2（判据编号顺延）；selftest 断言；必要时 `tools/mutation.ps1` 首红证据 |
| 任何性能结论/基线 | 本文 §2 命令复跑；不把读数写成代码常数或承诺 |

## 6. 风险与未决

### 6.1 只能真机/用户点检的项（对齐 `docs/QA_CHECKLIST.md`，agent 不代勾）

| QA 条目 | 内容 | 与本文关系 | 点检人 |
| :-- | :-- | :-- | :-- |
| `F12` | 长列表（100+ 单）滚动不卡、分页加载、勾选不重发全表 | 验证 §4.3 P2 与 P0-6 行级补丁 | 人（真机） |
| `E17` / `F13` | 弱网/断网：重试、最近成功时间、写幂等 | 验证 P0-1/P0-3/P0-6 与 B4；观测 31.2s 上界的体感 | 人（真机） |
| `E1~E8` | 双机 10s 内进度同步 | 验证 R-DEC-24 若降频/合并后实时性 | 人（双机） |
| `V13` | 冷启动/杀进程票据丢失 | 冷启动链路回归（切换会话） | 人（真机） |
| `V15` | 只读视角下轮询与刷新 | 轮询清理/可见性门控回归 | 人（双机） |
| `R1~R4` | OCR/AI 兜底等待态、成功/失败/降级 | 验证 P0-10 压缩/降采样不伤识别 | 人（真机） |
| `H12` | 灰度观测六类指标读数 | 冷启动/P95/调用量等性能读数的线上取数入口 | 人（控制台） |
| 判定规则 | QA「【一般】：…性能抖动等体验问题，可在发布后修」 | 本文优化项若引入新抖动，按 QA 判定规则记缺陷，不宣布达标 | — |

### 6.2 未取证清单 `[未取证]`

1. launch 实际耗时与「≤800ms」目标（UX_CUSTOMER §3.1）在真机/4G 的读数。
2. 云函数冷启动次数、冷启动耗时、各 action P50/P95（控制台日志/监控）。
3. `wx-server-sdk` 依赖树在云容器中的实际加载耗时与是否预置层优化。
4. 主包/分包真实代码包大小（工具读数）与根级工程文件是否进包。
5. 详情页轮询、工作台轮询的真实帧率/内存/CPU 影响；100+ 单滚动帧率。
6. OCR 降采样前后识别成功率与内存峰值真机对比。
7. 控制台索引/超时/内存配置现状（RUNBOOK §13 未填）。
8. 启动页「≤300ms 加载延迟」实现后快网观感是否改善（需真机确认）。
9. `preloadRule` 在网络条件受限时的实际预下载行为（真机/Wi-Fi/4G）。
10. P0 各项前后对比读数（本轮研究只给方法，不给读数）。

### 6.3 裁决与缺口编号（提案，未裁决）

- 需用户裁决（`R-DEC-23` ~ `R-DEC-28`，占位编号，确认后由 Lead 回写正式编号）：见 §4.2。
- 工程侧缺口（建议新增编号，待 Lead 确认；编号不超过 E18）：
  - **E13（建议）**：性能基线取证缺口——真机耗时/帧率/内存、云函数冷启动与 P95、包体真实读数均未做，阻塞性能结论转正；
  - **E14（建议）**：云函数运行时配置（超时/内存/预留并发）未固化进仓库/RUNBOOK，属控制台操作项。
- 技术债（建议登记，编号从 TD-059 起，待 Lead 确认）：TD-059 启动串行等待+非关键调用阻塞；TD-060 首请求全量 require；TD-061 OCR 全尺寸帧/截图无压缩；TD-062 全局 store 通知扇出与重复读；TD-063 性能基线取数缺口（与 E13 呼应）。

### 6.4 回写清单（按 §5.4 汇总）

- `docs/ARCHITECTURE.md`：§3.1（校时/超时/重试扩展）、§3.2（config 模块导出）、§3.4（binding 形状若扩）、§3.6（启动链）、§4.1（router 懒加载）；§3.3（截图压缩实现口径）。
- `docs/V4_ENGINEERING.md`：§2.3（preloadRule/忽略清单现状）、§3.6（配置缓存 TTL 与生效时延）、§4.3（bootstrap 读并行、每请求开销）、§8.2（新增静态判据编号）、附录 A（复跑命令可增性能取数）。
- `docs/V4_DATA_MODEL.md`：§7.1（bootstrap DTO 若扩）、§7.5（listPartner since 若做）。
- `docs/V4_CONTRACT.md`：§5.3/§9（轮询/接口口径若改）。
- `docs/V4_UX_CUSTOMER.md`：§0.3（加载 300ms/骨架落实）、§3.1（启动等待上限若改）、§8.1（留言轮询若改）。
- `docs/V4_UX_PARTNER.md`：§4.11（性能策略）补充「当前实现与 since 缺口的取数方法」。
- `docs/QA_CHECKLIST.md`：性能点检补充取数方法/记录模板（不改既有条目的预期结果，不代勾）。
- `docs/TECH_DEBT.md`：TD-047（升级/保留）、新增 TD-059~TD-063（编号待 Lead 确认）。
- `CHANGELOG.md` / `STATE.md`：落地批次记录与风险变更。
- `docs/V4_INTERIM_OVERVIEW.md`：§8 风险表「轮询成本/未真机」补本文结论链接。

### 6.5 边界与不做

- 本文不引入新依赖、不改分包结构、不改云控制台配置、不改隐私口径与任何文案。
- 不把「改造前/后」读数写成代码常数或验收承诺；不声称任何真机性能已达标。
- 与 CONTRACT 冲突的任何想法（如本地持久缓存业务数据）只放 §4.2 裁决提案，不默认执行。

## 附录 A · 复现命令与真实输出

> 环境：Windows + PowerShell 7 + Node v24.21.0；当前目录 `D:\Code\expressage_college_v4`。以下输出均为 2026-10-22 本机实跑原文。

### A.1 C1 目录/分包字节数

```powershell
$dirs = 'pages','components','custom-tab-bar','config','api','store','utils','shared','assets'
foreach($d in $dirs){ $m = Get-ChildItem $d -Recurse -File | Measure-Object -Property Length -Sum; '{0}|{1}|{2}' -f $d,$m.Count,$m.Sum }
$app = Get-ChildItem app.js,app.json,app.wxss,sitemap.json -File | Measure-Object -Property Length -Sum; 'AppFiles|{0}|{1}' -f $app.Count,$app.Sum
foreach($d in 'pkg-customer','pkg-partner','pkg-admin'){ $m = Get-ChildItem $d -Recurse -File | Measure-Object -Property Length -Sum; '{0}|{1}|{2}' -f $d,$m.Count,$m.Sum }
```

输出：

```
pages|46|240865
components|64|28945
custom-tab-bar|4|4116
config|3|10051
api|14|29772
store|1|5531
utils|16|76955
shared|13|68528
assets|10|3267
AppFiles|4|10021
pkg-customer|30|161794
pkg-partner|46|203990
pkg-admin|59|177175
```

### A.2 C2 主包源码合计

```powershell
$roots='pages','components','custom-tab-bar','config','api','store','utils','shared','assets'
$files=0;$bytes=0
foreach($r in $roots){ $m=Get-ChildItem $r -Recurse -File | Measure-Object Length -Sum; $files+=$m.Count; $bytes+=$m.Sum }
$m=Get-ChildItem app.js,app.json,app.wxss,sitemap.json -File | Measure-Object Length -Sum; $files+=$m.Count; $bytes+=$m.Sum
'main_package_source files={0} bytes={1}' -f $files,$bytes
```

输出：

```
main_package_source files=175 bytes=478051
```

### A.3 C3 根级非 md 文件

```powershell
Get-ChildItem -File | Where-Object { $_.Name -notlike '*.md' } | Select-Object Name,Length | Sort-Object Name | Format-Table -AutoSize
```

输出（节选；13 文件合计 27,970B）：

```
app.js                        2843
app.json                      3682
app.wxss                      3304
check.ps1                     1986
doctor.ps1                    4546
gate.ps1                      8499
project.config.json           1411
project.private.config.json    828
sitemap.json                   192
.env.example                   428
.gitattributes                  58
.gitignore                     112
.tool-versions                  81
```

### A.4 C4 文件类型构成

```powershell
$all = Get-ChildItem pages,components,custom-tab-bar,pkg-customer,pkg-partner,pkg-admin,app.js,app.wxss,app.json -Recurse -File -ErrorAction SilentlyContinue
foreach($ext in '.js','.wxml','.wxss','.json'){ $m = $all | Where-Object { $_.Extension -eq $ext } | Measure-Object Length -Sum; '{0} files={1} bytes={2}' -f $ext,$m.Count,$m.Sum }
```

输出：

```
.js files=110 bytes=610408
.wxml files=47 bytes=157490
.wxss files=48 bytes=60250
.json files=48 bytes=6916
```

### A.5 C5 主包 JS 字节

```powershell
$roots='pages','components','custom-tab-bar','config','api','store','utils','shared'
$sum=0
foreach($r in $roots){ $x=Get-ChildItem $r -Recurse -File -Filter *.js | Measure-Object Length -Sum; $sum+=$x.Sum; '{0}|js files={1}|bytes={2}' -f $r,$x.Count,$x.Sum }
$app=(Get-Item app.js).Length; $sum+=$app; 'app.js|bytes={0}' -f $app; 'MAIN_JS_TOTAL={0}' -f $sum
```

输出：

```
pages|js files=25|bytes=177161
components|js files=16|bytes=14978
custom-tab-bar|js files=1|bytes=2674
config|js files=3|bytes=10051
api|js files=14|bytes=29772
store|js files=1|bytes=5531
utils|js files=16|bytes=76955
shared|js files=13|bytes=68528
app.js|bytes=2843
MAIN_JS_TOTAL=388493
```

### A.6 C6 关键页面字节与行数

```powershell
$pages = 'pages/customer/home','pages/customer/orders','pages/partner/workbench','pages/partner/customers','pages/profile','pages/launch','pkg-customer/pages/order-detail','pkg-customer/pages/order-create','pkg-partner/pages/order-detail','pkg-partner/pages/messages','pkg-customer/pages/messages'
foreach($p in $pages){ $js=(Get-Item "$p/index.js").Length; $wxml=(Get-Item "$p/index.wxml").Length; $wxss=(Get-Item "$p/index.wxss").Length; $jsL=(node -e "const s=require('fs').readFileSync(process.argv[1],'utf8');console.log(s.split('\n').length-1)" "$p/index.js"); $wm=(node -e "const s=require('fs').readFileSync(process.argv[1],'utf8');console.log(s.split('\n').length-1)" "$p/index.wxml"); '{0}|js={1}B/{2}L|wxml={3}B/{4}L|wxss={5}B' -f $p,$js,$jsL,$wxml,$wm,$wxss }
```

输出：

```
pages/customer/home|js=10701B/324L|wxml=3463B/81L|wxss=708B
pages/customer/orders|js=5153B/183L|wxml=1403B/45L|wxss=702B
pages/partner/workbench|js=15047B/493L|wxml=15894B/336L|wxss=7060B
pages/partner/customers|js=5718B/203L|wxml=3239B/86L|wxss=1153B
pages/profile|js=15073B/500L|wxml=13219B/253L|wxss=6509B
pages/launch|js=9206B/213L|wxml=2911B/58L|wxss=2881B
pkg-customer/pages/order-detail|js=11367B/347L|wxml=7297B/152L|wxss=2467B
pkg-customer/pages/order-create|js=16540B/472L|wxml=10218B/188L|wxss=2027B
pkg-partner/pages/order-detail|js=16869B/486L|wxml=13571B/258L|wxss=3029B
pkg-partner/pages/messages|js=6287B/221L|wxml=1569B/40L|wxss=894B
pkg-customer/pages/messages|js=5485B/170L|wxml=1889B/46L|wxss=830B
```

### A.7 C7 setData 出现次数 / 定时器总量

```powershell
node -e "const fs=require('fs');for(const p of process.argv.slice(1)){console.log(p+' setData='+(fs.readFileSync(p,'utf8').match(/setData\(/g)||[]).length)}" pages/customer/home/index.js pages/customer/orders/index.js pages/partner/workbench/index.js pages/partner/customers/index.js pages/profile/index.js pages/launch/index.js pkg-customer/pages/order-detail/index.js pkg-customer/pages/order-create/index.js pkg-partner/pages/order-detail/index.js pkg-customer/pages/messages/index.js pkg-partner/pages/messages/index.js
(Get-ChildItem pages,pkg-customer,pkg-partner,pkg-admin,components,custom-tab-bar,utils,api -Recurse -Filter *.js | Select-String -Pattern 'setInterval\(|setTimeout\(' | Measure-Object).Count
```

输出：

```
pages/customer/home/index.js setData=10
pages/customer/orders/index.js setData=5
pages/partner/workbench/index.js setData=22
pages/partner/customers/index.js setData=5
pages/profile/index.js setData=20
pages/launch/index.js setData=9
pkg-customer/pages/order-detail/index.js setData=14
pkg-customer/pages/order-create/index.js setData=28
pkg-partner/pages/order-detail/index.js setData=34
pkg-customer/pages/messages/index.js setData=11
pkg-partner/pages/messages/index.js setData=6
28
```

### A.8 C8 app.json 性能配置与组件数

```powershell
Select-String -Path app.json -Pattern 'lazyCodeLoading|componentFramework|preloadRule|networkTimeout|"style"' | ForEach-Object { $_.LineNumber.ToString() + ': ' + $_.Line.Trim() }
node -e "const a=require('./app.json');console.log('subPackages='+a.subPackages.length+' pages='+a.pages.length+' usingComponents='+Object.keys(a.usingComponents).length+' lazyCodeLoading='+(a.lazyCodeLoading||'(none)')+' preloadRule='+(a.preloadRule?'yes':'none')+' networkTimeout='+(a.networkTimeout?'yes':'none'))"
(Get-ChildItem components -Directory | Measure-Object).Count
```

输出：

```
114: "style": "v2",
115: "componentFramework": "glass-easel",
117: "lazyCodeLoading": "requiredComponents"
subPackages=3 pages=7 usingComponents=15 lazyCodeLoading=requiredComponents preloadRule=none networkTimeout=none
16
```

（第 1 条命令未输出 `preloadRule`/`networkTimeout` 行 = 两键不存在。）

### A.9 C9 客户端超时/重试常数

```powershell
Select-String -Path api\client.js -Pattern 'TIMEOUT_MS|RETRY_DELAYS|const attempts' | ForEach-Object { $_.LineNumber.ToString() + ': ' + $_.Line.Trim() }
```

输出：

```
11: const TIMEOUT_MS = 10000;
12: const RETRY_DELAYS = [300, 900];
159: const attempts = options.retry === true || (options.retry !== false && isRetryAction(action)) ? 3 : 1;
```

### A.10 C10 冷启动调用点（源码行）

```powershell
Select-String -Path app.js,pages\customer\home\index.js,pages\partner\workbench\index.js,pages\role\index.js,pages\profile\index.js,pkg-customer\pages\order-detail\index.js,pkg-partner\pages\order-detail\index.js,pkg-partner\pages\messages\index.js -Pattern 'bootstrap\(|bindModule.getCurrent|refreshBinding|refreshConfig|configApi.getPublic|bindApi.getCurrent|orderApi.listCustomer|messageApi.list|orderApi.listPartner|orderApi.get|messageApi.markRead|store.subscribe|setInterval|setTimeout' | ForEach-Object { $_.Path.Replace('D:\Code\expressage_college_v4\','') + ':' + $_.LineNumber + ': ' + $_.Line.Trim() }
```

输出（节选，完整行为文档 §2.2/§2.4 引用依据）：

```
app.js:44: const data = await userModule.bootstrap();
app.js:46: await this.refreshConfig();
app.js:47: await this.refreshBinding();
app.js:60: const config = await configModule.getPublic();
app.js:73: const current = await bindModule.getCurrent();
pages/customer/home/index.js:76: this._off = store.subscribe(() => this.sync());
pages/customer/home/index.js:159: configApi.getPublic().then(function apply(cfg) {
pages/customer/home/index.js:194: const tasks = [bindApi.getCurrent(), orderApi.listCustomer({ limit: 1 })];
pages/customer/home/index.js:232: messageApi.list({ limit: 1 }).then((data) => {
pages/partner/workbench/index.js:208: this.poller = setInterval(() => {
pages/partner/workbench/index.js:228: return orderApi.listPartner(payload).then(...)
pages/partner/workbench/index.js:323: return orderApi.listPartner(historyView.summaryQuery(Date.now())).then(...)
pages/customer/home/index.js:224: this._ticker = setInterval(() => {
pages/customer/orders/index.js:126: this._ticker = setInterval(() => {
pkg-customer/pages/order-detail/index.js:95: return flow.refresh(this._session, {...})
pkg-customer/pages/order-detail/index.js:105: if (session.view) this.loadMessages();
pkg-customer/pages/order-detail/index.js:126: this._timer = setTimeout(() => this.refresh(), delay);
pkg-partner/pages/order-detail/index.js:101: this.messageTimer = setInterval(() => {
pkg-partner/pages/messages/index.js:78: this._poller = setInterval(() => this.poll(), POLL_MS);
pages/role/index.js:88: return userApi.bootstrap().then((data) => {
pages/profile/index.js:71: this.unsubscribe = store.subscribe(() => this.refresh());
```

### A.11 C11 定时器与订阅点清单

```powershell
Select-String -Path pages\**\*.js,components\**\*.js,custom-tab-bar\*.js -Pattern 'setInterval\(' | ForEach-Object { $_.Path.Replace('D:\Code\expressage_college_v4\','') + ':' + $_.LineNumber }
Select-String -Path pages\**\*.js,components\**\*.js,custom-tab-bar\*.js -Pattern 'store\.subscribe\(' | ForEach-Object { $_.Path.Replace('D:\Code\expressage_college_v4\','') + ':' + $_.LineNumber }
```

（说明：PowerShell 的 `**` 通配只匹配一层，本行仅作示例；完整清单实际由 `Get-ChildItem -Recurse | Select-String` 复核，结论已写入 §2.4。）
实际复核命令与结果：

```powershell
Get-ChildItem pages,components,custom-tab-bar -Recurse -Filter *.js | Select-String -Pattern 'store\.subscribe\(' | ForEach-Object { $_.Path.Replace('D:\Code\expressage_college_v4\','') + ':' + $_.LineNumber }
```

输出：

```
pages/profile/index.js:71
custom-tab-bar/index.js:43
components/test-badge/index.js:12
components/switch-bar/index.js:38
pages/partner/workbench/index.js:196
pages/customer/home/index.js:76
```

### A.12 C12 每请求 DB 读基线（静态依据）

```powershell
Select-String -Path cloudfunctions\api\app.js -Pattern 'createDao|loadRuntimeConfig' | ForEach-Object { $_.LineNumber.ToString() + ': ' + $_.Line.Trim() }
Select-String -Path cloudfunctions\api\db\config.js -Pattern 'async function readConfig|dao.get' | ForEach-Object { $_.LineNumber.ToString() + ': ' + $_.Line.Trim() }
Select-String -Path cloudfunctions\api\middleware\auth.js -Pattern 'ensureUser' | ForEach-Object { $_.LineNumber.ToString() + ': ' + $_.Line.Trim() }
Select-String -Path cloudfunctions\api\handlers\user\bootstrap.js -Pattern 'await identity\.|dao.update|loadPublicConfig' | ForEach-Object { $_.LineNumber.ToString() + ': ' + $_.Line.Trim() }
```

输出：

```
app.js:112: const dao = createDao(deps.db);
app.js:113: const runtime = await loadRuntimeConfig(dao);
config.js:18: async function readConfig(dao) {
config.js:19: const doc = await dao.get(COLLECTIONS.CONFIG, CONFIG_DOC_ID);
auth.js:109: async function middleware(state) {
auth.js:114: const user = await ensureUser(ctx);
bootstrap.js:83: const viewSession = await identity.loadViewSession(ctx);
bootstrap.js:84: const viewContext = identity.buildViewContext(viewSession);
bootstrap.js:87: const user = await identity.loadUser(ctx, scope.openid);
bootstrap.js:88: const customer = await identity.loadCustomer(ctx, scope.openid);
bootstrap.js:89: const partner = await identity.loadPartnerByOpenid(ctx, scope.openid);
bootstrap.js:90: const binding = await identity.getActiveBinding(ctx, scope.openid);
bootstrap.js:91: const boundPartner = binding && binding.partnerId ? await identity.loadPartnerById(ctx, binding.partnerId) : null;
bootstrap.js:105: await ctx.dao.update(COLLECTIONS.USERS, scope.openid, { lastLoginAt: nowDate, updatedAt: nowDate });
bootstrap.js:134: configPublic: await configCommon.loadPublicConfig(ctx),
```

### A.13 C13 云函数首请求 require 闭包（脚本口径 + 输出）

口径：临时脚本（本机 `%TEMP%`，不入仓）从 `cloudfunctions/api/index.js` 出发，正则解析相对 `require`，对 `router.js` 的动态 `require('./handlers/' + domain)` 按 11 域展开，递归去重；统计文件数与字节数、按目录分组。复跑建议：把该脚本登记为 `tools/perf-require-graph.js`（P2 建议，需 Lead 排期并补门禁）。

输出：

```
ENTRY=D:\Code\expressage_college_v4\cloudfunctions\api\index.js
closure files=134 bytes=566778
bare (external) modules=crypto,wx-server-sdk
--- groups (first-load require closure) ---
(root) files=4 bytes=13108
db files=5 bytes=12696
handlers/admin files=26 bytes=134491
handlers/ai files=3 bytes=18638
handlers/bind files=6 bytes=15280
handlers/config files=3 bytes=2123
handlers/customer files=3 bytes=11829
handlers/health files=1 bytes=982
handlers/message files=5 bytes=20954
handlers/order files=25 bytes=111832
handlers/partner files=11 bytes=43291
handlers/upload files=4 bytes=9392
handlers/user files=5 bytes=18593
lib files=10 bytes=44729
middleware files=8 bytes=29825
shared files=15 bytes=79015
```

### A.14 C14 本机首次 require 方向性耗时

```powershell
node -e "const t=process.hrtime.bigint(); require('D:/Code/expressage_college_v4/cloudfunctions/api/app.js'); console.log('base app.js only: ms='+(Number(process.hrtime.bigint()-t)/1e6).toFixed(1));"
node -e "const t=process.hrtime.bigint(); const r=require('D:/Code/expressage_college_v4/cloudfunctions/api/router.js').getRouter(); console.log('full router: actions='+Object.keys(r).length+' ms='+(Number(process.hrtime.bigint()-t)/1e6).toFixed(1));"
```

输出（多次运行区间）：

```
base app.js only: ms=18.0
base app.js only: ms=23.0
full router: actions=68 ms=48.6
full router: actions=68 ms=57.2
full router: actions=68 ms=61.8
```

补充：另一次带堆统计的脚本输出 `required files under api=122`、`heapUsed delta MB=3.20`（×2 次）、`app.js base heapDeltaMB=1.46`、`+handlers/config only ms=2.0`。**这些均为本机方向性读数，不是云函数冷启动实测。**

### A.15 C15 wx-server-sdk 依赖体量（本机安装口径）

```powershell
$dir = Join-Path $env:TEMP 'v4-perf-measure\wx-sdk'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
npm install wx-server-sdk@4.0.2 --prefix $dir --no-audit --no-fund --loglevel=error
$m = Get-ChildItem "$dir\node_modules" -Recurse -File | Measure-Object Length -Sum; 'node_modules files={0} bytes={1}' -f $m.Count,$m.Sum
(Get-ChildItem "$dir\node_modules" -Directory | Measure-Object).Count
```

输出：

```
added 102 packages in 38s
node_modules files=5828 bytes=22863113
82
```

（另：`cloudfunctions/api` 全目录 136 文件 / 570,546B；`cleanup` 33 文件 / 148,258B。）

### A.16 C16 云函数目录与 handlers 分域字节

```powershell
$m=Get-ChildItem cloudfunctions\api -Recurse -File | Measure-Object Length -Sum; 'api all files={0} bytes={1}' -f $m.Count,$m.Sum
Get-ChildItem cloudfunctions\api\handlers -Directory | ForEach-Object { $x=Get-ChildItem $_.FullName -Recurse -File | Measure-Object Length -Sum; '{0}|files={1}|bytes={2}' -f $_.Name,$x.Count,$x.Sum }
```

输出：

```
api all files=136 bytes=570546
admin|files=26|bytes=134491
ai|files=3|bytes=18638
bind|files=6|bytes=15280
config|files=3|bytes=2123
customer|files=3|bytes=11829
health|files=1|bytes=982
message|files=5|bytes=20954
order|files=25|bytes=111832
partner|files=11|bytes=43291
upload|files=4|bytes=9392
user|files=5|bytes=18593
```

## 附录 B · 外部参考（官方文档，外部内容按数据对待）

- 启动性能：<https://developers.weixin.qq.com/miniprogram/dev/framework/performance/tips/start.html>
- setData 最佳实践（合理使用 setData）：<https://developers.weixin.qq.com/miniprogram/dev/framework/performance/tips/runtime_setData.html>
- 分包预下载（`preloadRule`）：<https://developers.weixin.qq.com/miniprogram/dev/framework/subpackages/preload.html>
- 按需注入和用时注入（`lazyCodeLoading`）：<https://developers.weixin.qq.com/miniprogram/dev/framework/ability/lazyload.html>
- 数据预拉取：<https://developers.weixin.qq.com/miniprogram/dev/framework/ability/pre-fetch.html>
- 体验评分（Audits）：<https://developers.weixin.qq.com/miniprogram/dev/framework/audits/audits.html>
- 全局配置（含 `networkTimeout` 键说明）：<https://developers.weixin.qq.com/miniprogram/dev/reference/configuration/app.html#networkTimeout>
- 云函数-常驻云函数（相关能力以控制台实际可选项为准）：<https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloud/guide/functions/resfunction.html>
- 组件初始化策略（glass-easel 相关）：<https://developers.weixin.qq.com/miniprogram/dev/framework/component-framework/init-strategy.html>
- 分包异步化：<https://developers.weixin.qq.com/miniprogram/dev/framework/subpackages/async.html>

## 附录 C · 本文自证

- 唯一新增文件 = 本文件；未修改任何代码/配置/测试；未执行任何 git 写操作（未 `add/commit/tag/checkout/stash/reset`）。
- 文档门禁与零金额扫描结果见交付回执（`node tools/check-docs.js --batch 1`、`node tools/zero-money-scan.js --scope docs`）。
