# 性能研究 · 冷启动与使用流畅度（2026-11-01 增量）

> **性质**：研究快照（只读调研，**未改代码、未改口径、未动门禁**）。按归档规则登记于 `docs/archive/README.md`；不作为验收证据，现行性能口径以 `docs/engineering/V4_ENGINEERING.md` §8 与 `STATE.md` 为准。
> **基线**：HEAD `9526e37`（2026-10-31 技术债收口批）。
> **与上一份研究的关系**：`PERFORMANCE_2026-10-22.md`（HEAD `9031d14` 快照）解决的是「冷启动串行云调用 / 首请求加载面 / 单次 setData 过大」；本文只做**增量复核 + 新热点定位 + 候选排序**，不重复其结论。
> **用户诉求**：第 11 条反馈「新加性能优化研究，能不能再流畅一点」。
> **证据纪律**：只报真实输出；本机读数标 `[实测]`，只读审计脚本读数标 `[审计脚本]`（方向性，非真机），源码结构标 `[静态]`，算术推导标 `[推导]`，必须真机/控制台才能取的标 `[未取证]`。

---

## 0. 结论先行（≤10 行）

1. **性能工作不是从零开始**：P0-1~P0-11、批 11 D34 热路径、查询预算、打包忽略等 15 项已落地，并由 `node tools/selftest-performance.js` 锁定——本轮实跑 **106/106 PASS**。
2. **主包体已从「不是瓶颈」变成「要盯」**：主包源码 726,366B / 199 文件 = 1.5MB 预算的 **46.2%**；2026-10-22 同口径为 478,051B，10 天 **+52%**。仍不构成当前阻碍，但按此斜率 3~4 周后会逼近平台上限。
3. **没有真机基线就无法证明「更流畅」**：TD-074 开放（真机卡顿基线未建立）。本文只给「同路径前后对比」方法，**不承诺任何毫秒数**。
4. **最低风险、可先做的 4 条 P0**：工作台 `onShow` 重复拉历史摘要（TD-073）+ history 白算 6 个 count；订单详情**终态不停轮询**（最坏 720 次/小时 → 0）；首页每次刷新 4 次 setData 收口；隐藏页（profile 等）收到 store 通知仍全量 setData。
5. **结构性 P0（需真机确认体感）**：下单链路严格串行（逐张上传 → 全部完成才逐图识别 → 逐件 AI 兜底）；工作台分组结构一变就整表替换（100 行约 131KB），分片追加还会重发已渲染组。
6. **`store` 深拷贝不是主因**：快照 2,236B、1,000 次 notify 12.72ms（≈0.013ms/次）；真成本是隐藏页订阅者的无条件 setData。
7. **行数红线已实质阻碍优化**：`pkg-partner/pages/order-detail/index.js` 500/500、`pages/partner/workbench/index.js` 497/500、`pages/customer/home/index.js` 492；批 18 前必须先拆 `parts/`，否则改不动。
8. **本次其它新需求会放大热点**：#5 日期分组提高「结构变化」概率；#7 楼层清单是新的长列表；#10 聚合禁止二次扫描；#2 23:50 有写尖峰；#6 若加状态则每个列表多 1~2 个 count。
9. **附带发现一个真实缺陷**：`pkg-partner/pages/service-settings/index.js:164` 用 `store.set({partner})`（`set` 签名是 `(key,value)`）→ 兼职 `partner` 状态不更新，并写入 `[object Object]` 键；应在批 16 修（`store.patch`）。
10. **埋点默认不做**：服务端已有耗时日志、工具侧已有 Performance；若裁决要做，只做 develop 环境纯件（零上报/零 storage/零新集合/不含个人信息），且遵守 CONTRACT §14 第 4 条「数字不写死，给取数命令」。

---

## 1. 目标、边界与证据等级

1. **目标**：回答「现在卡在哪、改哪里最划算、怎么证明改完更流畅」，为批 18 排期提供依据；**不在本文直接改代码或改口径**。
2. **边界**：只读代码/配置与本地静态测量；不部署、不连真实云环境、不做真机点检（这些只能用户执行或点检）。
3. **证据等级**（正文逐条标注）：
   - `[实测]`：本轮本机真实命令输出，命令与输出都在 §2/§3；
   - `[审计脚本]`：只读审计（2026-11-01，本机 Node/静态采样）读数；脚本未入库，**只作方向性参考**；
   - `[静态]`：源码结构统计（文件:行，可复跑）；
   - `[推导]`：由代码常数做的算术推导（给公式，不是真机读数）；
   - `[未取证]`：必须真机/控制台/部署后才能取。
4. **不含承诺**：不写「冷启动 ≤Nms」「滚动 ≥Nfps」；只写「同机型、同网络、同路径改前/改后中位数对比」。
5. **平台约束**：不引入第三方前端依赖（门禁 #16/#24），因此长列表**不引第三方虚拟列表**，要么窗口渲染自研，要么先分页/分片。

---

## 2. 取数方法与命令（真机项只能用户点检）

### 2.1 C1 包体积（本轮实跑，替代 10-22 的 PowerShell 版）

Git Bash 口径（`D:/Code/expressage_college_v4` 下执行）：

```bash
for d in pages components custom-tab-bar config api store utils shared assets; do
  n=$(find "$d" -type f | wc -l); b=$(find "$d" -type f -print0 | xargs -0 cat | wc -c); echo "$d files=$n bytes=$b";
done
cat app.js app.json app.wxss sitemap.json | wc -c
for d in pkg-customer pkg-partner pkg-admin; do
  n=$(find "$d" -type f | wc -l); b=$(find "$d" -type f -print0 | xargs -0 cat | wc -c); echo "$d files=$n bytes=$b";
done
```

> 口径：**源码字节和**（未压缩、未剔除注释），不等于上传面板的「压缩后」读数。压缩后真值只能上传时看面板 `[未取证]`。

### 2.2 C2 真机/开发者工具指标（每场景录 5 次取中位数）

| 场景 | 指标 | 取法 |
| :-- | :-- | :-- |
| 冷启动 → 首页可交互 | 启动总时长、脚本注入/执行、首屏 callFunction 次数、首屏 setData 字节 | 开发者工具 Performance 录制；Network 过滤 `callFunction` |
| 工作台（30s 轮询 + 滚动 + 筛选） | setData 次数/字节、长任务 >50ms、FPS、100+ 单滚动是否掉帧 | Performance + Memory；QA `F12` |
| 下单选图 → 识别完成 | 墙钟等待、每图耗时、内存峰值、云调用数 | Performance/Memory；QA `W8` |
| 订单详情（10s 轮询） | 周期内 callFunction 次数、终态后是否归零 | Network 按 action 计数 |
| 消息红点/切换角色 | 切页耗时、隐藏页是否仍在 setData | Performance；Memory 快照 |
| 云函数 | 每 action P50/P95、冷启动次数 | 控制台日志 `[api] <action> <requestId> ok <N> ms` |

### 2.3 C3 代码行数与结构统计

```bash
wc -l pkg-partner/pages/order-detail/index.js pages/partner/workbench/index.js pages/customer/home/index.js
git status --short
```

### 2.4 C4 门禁与自检读数（数字不写死，一律以命令输出为准）

```bash
node tools/check.js            # 本轮 34/34
node tools/check-docs.js       # 本轮 12/12
node tools/zero-money-scan.js  # 本轮 0 命中（白名单 109 项）
node tools/selftest-performance.js   # 本轮断言全通过，末行 PASS
node tools/selftest.js         # 全套件汇总（断言总数取这里的输出）
```

---

## 3. 现状基线（本轮读数）

### 3.1 包体积 `[实测]`（C1，2026-11-01）

| 指标 | 实测 | 说明 |
| :-- | :-- | :-- |
| 主包源码合计 | **726,366B / 199 文件** | 1.5MB=1,572,864B → 占 **46.2%**（2026-10-22 同口径 478,051B / 175 文件 = 30.4%） |
| `pages/` | 312,137B / 58 文件 | 主包最大块 |
| `utils/` | 130,744B / 24 文件 | OCR/识别纯件占大头 |
| `shared/` | 84,757B / 14 文件 | 口径纯件，主包常驻 |
| `assets/` | 84,471B / 12 文件 | 其中分享封面 `cover.png` 43,998B + `cover-timeline.png` 37,206B = **81,204B（96.1%）** |
| `components/` | 40,965B / 65 文件 | 16 套组件×四件套 + 其它 |
| `api/` | 32,645B / 14 文件 | 唯一网络出口层 |
| `config/` + `app` 四件 | 15,072B + 13,707B | app.js/app.json/app.wxss/sitemap.json |
| `custom-tab-bar/` + `store/` | 5,820B + 6,048B | 固定开销 |
| `pkg-customer` | 263,307B / 44 文件 | 占 1.5MB 预算 16.7% |
| `pkg-partner` | 224,852B / 50 文件 | 占 14.3% |
| `pkg-admin` | 188,971B / 59 文件 | 占 12.0% |

**判断**：主包 46.2% 仍低于 1.5MB 预算，**本轮不做独立分包迁移**；但 10 天 +248,315B 的增速需要进 §5 P1-10（封面临时瘦身）与后续观察。压缩后真值 `[未取证]`（上传面板）。

### 3.2 已落地的性能工作 `[静态]`（无需重复发明；行号来自只读审计）

| # | 项 | 落点 |
| :-- | :-- | :-- |
| 1 | 启动只 await bootstrap，绑定摘要转后台复用 | `app.js:62-74`、`:78-99` |
| 2 | config 模块缓存预热 | `api/modules/config.js:7-23` |
| 3 | bootstrap 五读并行 | `cloudfunctions/api/handlers/user/bootstrap.js:97-101` |
| 4 | router 按域懒加载 | `cloudfunctions/api/router.js:71-110`（首用域 42 文件/196,490B，P0-5 前为 134 文件/566,778B） |
| 5 | setData 行级补丁/角标判等/校时 1s 阈值 | `pages/customer/orders/parts/ticker-patch.js:15-33`、`pages/partner/workbench/index.js:316-322`、`api/client.js:18-20,137-143` |
| 6 | 分包预下载 + networkTimeout | `app.json`（`preloadRule` 两页、`networkTimeout{request:10000,uploadFile:60000}`） |
| 7 | OCR 长边 1440 降采样 + 截图压缩 | `pkg-customer/pages/order-create/parts/ocr-flow.js:37-73,120-127`、`api/upload.js:161-192` |
| 8 | 定时器清理 + ≥300ms 加载态 | `pages/partner/workbench/index.js:224-225`、`components/switch-bar/index.js:55-63` |
| 9 | 查询预算（固定 count） | `handlers/order/listCustomer.js:71-95`、`handlers/order/listPartner.js:233-259`；`selftest-query-window` 锁定 |
| 10 | 打包忽略（主包上传曾超限） | `project.config.json packOptions.ignore`；`tools/check.js` #34 |
| 11 | 预览缓存/防抖 | `utils/preview-cache.js:1-15`、`pkg-customer/pages/bind/parts/auto-query.js:1-15` |
| 12 | 朋友圈单页模式跳过初始化/bootstrap | `app.js:31-37` |

**锁定方式**：`tools/selftest-performance.js`（A~I 组，本轮 106/106 PASS）——性能项不是「说过就算」，而是有断言；新增优化同样要补断言，否则回归会静默丢。

### 3.3 行数红线 `[实测]`（C3）

| 文件 | 行数 | 门禁 |
| :-- | :-- | :-- |
| `pkg-partner/pages/order-detail/index.js` | **500** | 上限 500（#18），已顶满；单函数 ≤50（#32） |
| `pages/partner/workbench/index.js` | **497** | 只剩 3 行余量 |
| `pages/customer/home/index.js` | **492** | 只剩 8 行余量 |

⇒ 任何工作台/详情/首页的性能改动**必须先拆 `parts/`**；这不只是重构偏好，是硬闸。

---

## 4. 热点清单（按用户可感知度排序）

### 4.1 启动链

- `[静态]` 串行 await 已消除，但 `bind.getCurrent` 在 bootstrap 之后才发起（`app.js:63→69`），首页又依赖它 ⇒ 首屏兼职卡 = bootstrap RTT + binding RTT（`[推导]`，需真机 Trace 确认）。
- `[审计脚本]` bootstrap 响应 2,044B（其中公开配置占 1,309B）；首请求 `user.bootstrap` 模块闭包 42 文件/196,490B。
- `[静态]` 冷启动顾客端约 4 次云调用（bootstrap、bind、listCustomer、message.list；config 命中预热）。

### 4.2 store.notify 与隐藏页订阅（TD-072）

- `[静态]` notify 仍是整快照深拷贝（`store/index.js:23-28,38-47`）；订阅点 6 处：`home:91`、`profile:75`、`workbench:198`、`switch-bar:43`、`test-badge:12`、`custom-tab-bar:70`。
- `[审计脚本]` 快照 2,236B、1,000 次 notify 12.72ms ⇒ **深拷贝不是 P0**。
- `[静态]` 真成本在**隐藏页仍 setData**：`pages/profile/index.js:73-75,119-131` 每次通知无条件全量 setData（含同步 API `pages/profile/parts/ui.js:11`）；`switch-bar` 挂在 19 页、`custom-tab-bar` 每个 tab 页一份实例，实例数被页面栈放大。`[未取证]` 需真机 Trace 看隐藏页 setData 次数。
- 高频源已被上一轮降过（校时只在 |Δ|>1s 写、工作台红点判等）；剩余高频源 = 首页每次 refresh 必 `store.patch({binding})`（`home:319`）。

### 4.3 setData 粒度

- `[静态]` 首页每次 refresh 触发约 **4 次 setData**：`home:308` → `store.patch`(`:319`)→`sync`(`:165`) → `applyDerived`(`:193`) → `:321` 又算一遍同样的派生；可收口为 2 次（`sync` 内合并）。
- `[审计脚本]` 工作台行 34 字段/1,308B（3 件单 2,267B）⇒ 30 行 39,326B、100 行 130,887B；订单列表行仅 8 字段/246B（已达标）。
- `[静态]` 结构签名一变化就整表替换（`parts/group-view.js:327-338`、`parts/load-view.js:247-256`）；分片追加用 `concat` 重发已渲染 groups（`workbench:298-314`）⇒ 100 行时 O(n²) 字节。
- 新需求风险：日期分组/楼栋分组会提高「结构变化」概率（跨日、新楼栋出现即整组重发）。

### 4.4 轮询与定时器

- `[静态]` 生产 6 处 `setInterval` 全部在 `onHide/onUnload` 清理（已达标）。
- **TD-073（开放）**：工作台 `onShow` 额外拉一次历史摘要（`workbench:96-98,331-334`），且服务端对 history 视图也白算 6 个 count（`handlers/order/listPartner.js:304-309`）。
- `[静态]` 工作台 30s 轮询拉第一页 30 行、无 `since`（TD-047）；`[审计脚本]` 响应 52,462B/次（30 单，单行约 1,741B）⇒ 在线兼职约 6MB/小时。`[未取证]` 线上调用量。
- **终态不停轮询**：顾客详情 10s（`pkg-customer/pages/order-detail/index.js:144-149`）、兼职详情 10s（`pkg-partner/pages/order-detail/index.js:98-108`），轮询策略无终态判断（`pkg-customer/pages/order-detail/parts/poll-policy.js:8-14`）⇒ COMPLETED/CANCELLED 停留 1 小时仍发约 **720 次**（计算：60分×6次）。这是纯浪费，修起来最便宜。

### 4.5 重负载链路

- `[静态]` 下单：**逐张上传**（`components/image-picker/index.js:150-191`）→ 全部完成后才**逐图识别**（`parts/ocr-flow.js:358-383`）→ 每图**逐件 AI 兜底**（`parts/model.js:271-312`）。`[推导]` 10 图最坏等待 ≈ 10×(上传+OCR 8s 超时) + N×8s。
- `[静态]` OCR 已降采样到 1440，但 NO_TEXT 条带重试时每条带重新 `canvas.createImage()` 解码原图（`ocr-flow.js:76-127`、`utils/ocr/vision.js:118-145`）⇒ 大图重复全量解码（推断内存峰值）。
- `[静态]` 详情截图逐张签名（`pkg-customer/pages/order-detail/index.js:230-247`，TD-066）；列表头像已走批量临时 URL。

### 4.6 渲染

- `[静态]` 长列表无虚拟化：工作台嵌套 `wx:for` 全量渲染（`pages/partner/workbench/index.wxml:102-121`）；骨架屏只有工作台；home/orders 用 ≥300ms 文本 loading；动画仅 launch 页 1 处。
- 不引第三方（门禁），所以窗口渲染只能自研或先靠分页/分片控制行数。

### 4.7 附带真实缺陷（非性能，但同批该修）

- `[静态]` `pkg-partner/pages/service-settings/index.js:164`：`store.set({ partner: partner })`；`store.set` 签名是 `(key, value)`（`store/index.js:49-52`）⇒ 写入 `state['[object Object]'] = undefined`，真正的 `state.partner` 不更新，且污染快照。改为 `store.patch({ partner })` 即可；建议批 16 顺带修并补一条 store 断言（防止再误用）。

---

## 5. 优化候选清单（13 条，按低风险高收益排序）

| # | 级别 | 做法 | 涉及文件 | 预估收益 | 成本/风险 | 契约/门禁 | 依赖真机 |
| :-: | :-- | :-- | :-- | :-- | :-- | :-- | :-: |
| P0-1 | 链路面 | 下单流水线化：上传与识别重叠、上传并发 2、AI 兜底按件并行上限 | `components/image-picker/index.js:150-191`、`ocr-flow.js:358-383`、`parts/model.js:271-312` | 10 图等待从「Σ」降到「max 级」`[推导]` | 中/中（失败卡、重排、幂等键） | 无契约；补 `selftest-order-flow` | 是 |
| P0-2 | 调用面 | TD-073 去重：`onShow` 不再重复拉历史摘要；history 视图不算 counts | `workbench:96-98,331-334`、`listPartner.js:304-309` | 每次进工作台少 1 次调用 + 少 6 个 count | 低/低 | 响应形状不变；关 TD-073 | 否 |
| P0-3 | 调用面 | 终态停轮询（顾客+兼职详情） | `poll-policy.js:8-14`、两个详情页 | 终态 720 次/小时 → 0 | 低/低（终态只读） | 无契约；UX §8.1 补一句 | 否 |
| P0-4 | 渲染面 | 首页 setData 收口（4→2）+ profile/隐藏页订阅判等 | `home:292-327,149-167`、`profile:73-75,119-131` | 每次首页 −2 次 setData；隐藏页不再全量 setData | 低/低 | 补 store 单测 + 套件 F | 是（隐藏页 Trace） |
| P0-5 | 渲染面 | 分组结构变化只换变化组；分片追加不重发已渲染组 | `group-view.js:327-357`、`load-view.js:247-256`、`workbench:298-314` | 100 行 131KB → 增量几 KB | 中/中（顺序、`wx:key`） | 无契约；补 workbench 断言 | 是（100+ 单 F12） |
| P1-6 | 链路面 | 多图批量签名（TD-066） | `pkg-customer/pages/order-detail/index.js:230-247` | N 次 → 1 次临时 URL | 中/中 | 契约只增 `indexes[]`；限流评估 | 是 |
| P1-7 | 调用面 | `listPartner` 增 `since` 增量（TD-047） | `handlers/order/listPartner.js:304-309` | 30s 轮询响应体下降（现 52KB/次） | 中高/中 | 需改 CONTRACT/DATA_MODEL | 是（线上调用量） |
| P1-8 | 链路面 | OCR 单次解码、多带复用 | `ocr-flow.js:76-127`、`utils/ocr/vision.js:118-145` | NO_TEXT 最多 4 次解码 → 1 次 `[推导]` | 中/中（canvas 内存） | 无契约；QA `R1~R4` 回归 | 是 |
| P1-9 | 调用面 | 首页轻量读（counts 可选/合并红点读） | `handlers/order/listCustomer.js:112-119`、`home:292-300,353-362` | 每 onShow 省 5~6 个 count | 中/中 | 只增可选参数 | 是（控制台 DB 读数） |
| P1-10 | 包体面 | 分享封面瘦身（81,204B，压缩/降分辨率） | `assets/share/cover*.png`、`utils/share/index.js:14-15` | 主包 −70KB 级 | 低/低（封面视觉） | 无；分享卡真机看效果 | 是 |
| P2-11 | 渲染面 | 长列表窗口渲染（自研，不引第三方） | `pages/partner/workbench/index.wxml:102-121` | 待 F12 取证 | 高/中 | 无 | 是 |
| P2-12 | 渲染面 | store 按 key 订阅/selector（TD-072 完整形态） | `store/index.js:38-47` | 小（深拷贝 0.013ms/次） | 中/低 | 补 store 单测 + 套件 F | 是 |
| P2-13 | 调用面 | 23:50 自动完成削峰（随新需求 #2） | `cloudfunctions/cleanup/sweeps/orders.js:107-137` | 避免单轮大批量写 | 中/中 | 无新集合；KPI 口径回写 | 否（控制台触发器） |

> 排批建议：先做 **P0-2/3/4**（低风险、当天可验证）→ 再做 **P0-5/1**（结构类，需真机确认体感）→ P1 按契约成本排；P2 仅在真机数据支持时做。

---

## 6. 与本次其它反馈的关系（性能约束必须写进各自验收项）

| 需求 | 会加重哪个热点 | 必须同批满足的性能约束 |
| :-- | :-- | :-- |
| #2 送达当日 23:50 自动完成 | 谓词改 cutoff，扫描频率不变但 23:50 有写尖峰 | 触发器仍是每 10 分钟一条；单轮完成数建议分批上限；事件仍逐单写；KPI 口径写 DATA_MODEL |
| #5 工作台按日期分组 | 「结构变化」概率↑、组更长；`index.js` 497/500 | 只在「新日期/新楼栋」出现时整组替换一次；组内走行级 patch；分页仍 30；先拆 `parts/` |
| #6 新增订单状态 | counts 桶 +1 ⇒ 每次列表 +1~2 个 count；`status-pill` 硬编码映射 | 新桶计数合并/缓存，不在轮询里重复累加；`status-pill` 映射改从 `shared` 取；`selftest-query-window` 预算更新 |
| #7 楼栋/楼层清单 | 新的长列表，全量渲染形态 | 分页/分片 ≤20 行；**不参与 30s 轮询**，切页才刷新；不新增头像临时 URL |
| #10 汇总文案（服务端聚合） | `listPartner` 已 1 find + 6 count | 只增 `summary`、复用本次 rows；**禁止第二次扫描/新 action**；轮询每轮 ≤1 次聚合 |

---

## 7. 验收判据与复测方法（不承诺数字，只比前后）

1. **通用协议**：同机型、同微信版本、同基础库、同网络（先 4G 再弱网）、同路径；改前/改后各录 5 次，取**中位数**；记录时间与版本锚点，数字不写死。
2. **每候选的观察点**（改完必须能指出「哪个读数变了」）：
   - P0-2：进工作台一次 `callFunction` 数 −1；history 视图返回的 counts 不再计入（或 `selftest-query-window` 断言）。
   - P0-3：终态订单详情 Network 中该页轮询 action 计数 = 0（改前 60 分钟内约 720 次）。
   - P0-4：首页一次 refresh 的 setData 次数与字节（开发者工具 Console 钩 `setData` 或 Trace 面板）；隐藏页 setData 次数归零。
   - P0-5：100 单场景下一次结构变化的 setData 字节/次数；滚动 FPS 与长任务。
   - P0-1：10 图选图→识别完成墙钟与内存峰值；失败重试仍可用、幂等键不重复。
   - P1-10：主包源码字节（C1）与上传面板压缩后读数（用户上传时看）。
3. **真机基线采集（TD-074 的关闭条件）**：用户提供**机型/微信版本/基础库/网络/体验版上传时间 + 5 条路径录屏**（冷启动、工作台滚动+筛选、下单选图识别、订单详情、消息红点）；我们按 §2.2 同路径各录 5 次，形成「设备×场景×指标×现状」表 + 截图；**agent 不代勾真机项**（QA 清单对应条目）。
4. **回归**：性能改动不得让现有 34/34、12/12、零金额扫描与 selftest 全绿倒退；新增纯件必须有生产调用或先登记 TD（AGENTS §5.4）。

---

## 8. 裁决与回写（等用户拍板后执行）

| 事项 | 要裁决什么 | 回写位置 |
| :-- | :-- | :-- |
| Q10-① 优先级 | 研究先行（本文件已交付）/ 功能先行 / 并行 | 批 16/17/18 排期 |
| Q10-② 轻量埋点 | 默认不做；若做只限 develop 环境 `utils/perf-trace.js`（零上报/零 storage/零新集合/无个人信息） | ENGINEERING §8.2 + CONTRACT §14 第 4 条 |
| TD-072 | store 深拷贝改为按 key 订阅（P2-12）是否立项 | TECH_DEBT |
| TD-073 | 工作台 `onShow` 去重（P0-2）随批 18 修复并关闭 | TECH_DEBT + UX §4.11 |
| TD-074 | 真机基线（P0 前置）只能由用户提供设备/录屏后关闭 | QA + TECH_DEBT |
| 轮询口径 | 「终态订单详情不再轮询」写进 UX §8.1 | UX_PARTNER/UX_CUSTOMER |
| 行数红线 | 批 18 前先拆 `parts/`（order-detail 500/500、workbench 497、home 492） | ARCHITECTURE §2 写作用域说明 |
| 读数修正 | `STATE.md` 性能快照行「selftest-performance 97」已过期，本轮实跑为 106/106 PASS，已按新读数修正 | STATE.md |
| 真实缺陷 | `service-settings/index.js:164` 改 `store.patch`，并补断言 | 批 16（代码+断言） |

> 结论：**批 18 只做「有基线、有观察点」的候选**；没有真机读数前，只做 P0-2/3/4 这类「纯浪费消除」，不做体感承诺。

---

## 9. 风险与未决

1. **未部署真实云环境、未做真机点检**：本文所有耗时/内存结论都是本机方向性读数；真机项一律 `[未取证]`。
2. **主包增速**：10 天 +248KB（+52%）；若 `assets/` 继续涨，先做 P1-10 与包体回归门禁，再谈独立分包（当前 46% 尚可）。
3. **结构性改动风险**：P0-5/P0-1 会动分组/上传/识别顺序，必须补断言 + 首红证据；改坏比不改更贵。
4. **轮询/契约类**：P1-7（`since`）需要改 CONTRACT/DATA_MODEL，且线上调用量只能部署后看控制台。
5. **埋点红线**：任何埋点不得采集与任务无关的个人数据、不得上报、不得新增集合；默认不做，等 Q10 裁决。
6. **与 #2/#5/#6/#7/#10 同批实施时**：性能约束若不写进验收项，会在功能交付时被「先跑通」牺牲掉——这也是本文第 6 章存在的目的。
