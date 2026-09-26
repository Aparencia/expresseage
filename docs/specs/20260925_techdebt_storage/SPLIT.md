# TD-001（storage 半边）清偿 · 拆分记录（2026-09-25 卡 52）

起点锚点（开工自取）：`17f7fc6`｜**清偿提交 = `7cc6f37`**｜本卡对象 = **`utils/storage.js` 758 非空行**（TD-001 第四次增记）
产物：清偿提交（哈希见回执/台账"偿还证据"列）+ 本条记录

## 1. 切法（按职责，依赖单向）

```
utils/storage-core.js       102 行  读盘 / 写盘【单源】 + 共享工具（okOf/failOf/cloneStore/newId/newBatchId/normalizeText）
utils/storage-customers.js  228 行  档案读写（list/get/findByKey/create/update/ensureUnassigned/rebind + holderSummary）
utils/storage-parcels.js    327 行  快件读写（list/add/addParcels/update/status/picked/软删/恢复/归档/反归档）
utils/storage.js            209 行  对外门面（re-export）+ 跨实体生命周期（重归/软删档案/恢复/真删/全部真删）
```

**为什么内核单独一个文件**（与原派单建议的偏差，依证据调整并在此说明）：
派单建议"`storage.js` 保留读写单源 + 门面，实体外移"。但那样 `storage.js` 要 re-export 实体模块、
实体模块又要用 `storage.js` 的 `loadStore/saveStore` ⇒ **循环依赖**（本项目已因循环依赖被期望值闸抓过一次）。
把内核抽出后依赖是**单向**的：`storage-core` ← `storage-customers` / `storage-parcels` ← `storage`。
⛔ 由此立的不变量：**任何模块都不许再写第二份读盘/写盘**（要 IO 就 require 内核）。

**为什么生命周期留在 `storage.js`**：软删档案要连带名下的件、恢复要按批次串认领、真删不留悬空引用、
「未归类」重归要改件的归属 —— 这些**同时动 customers 与 parcels**，放进任一侧都会反向依赖另一侧。

## 2. 验收读数（逐条，取自真实命令输出）

| 项 | 读数 |
| :-- | :-- |
| **导出面** | 拆分前 **30** 名 / 拆分后 **30** 名，**双向差集为空**（`Object.keys` 对帐） |
| **唯一写盘口** | `wx.getStorageSync` / `wx.setStorageSync` 全仓只出现在 `utils/storage-core.js`（各一处） |
| 行为等价 | `node tools/selftest.js` = **656/656 通过**（**与拆分前逐字同数**，未加/未删任何断言） |
| 机械门禁 | `node tools/check.js` 通过；`powershell -File check.ps1` **退出码 0** |
| 行数 | core 102 / customers 228 / parcels 327 / storage 209 —— **每个 ≤500** ✓ |
| 体量 | 非空行合计 866（拆分前 758，+108 ≈ +14%：3 个新文件头 + 4 处 require + 逐名显式导出对象；**无逻辑新增**） |
| 调用点 | 4 处 require `utils/storage.js` 的调用方（档案页 2 处 + 两个测试文件）**一字未改**、全部照常工作 |

## 3. 变异证伪（副本内，注入前后均盘上核实）

| 变异 | 读数 |
| :-- | :-- |
| **M1** 在实体文件里塞第二份写盘（绕过单源） | 注入已核实生效 ⇒ **`selftest` 656/656 全绿、`check.js` 也全绿** ⇒ **现有断言与门禁抓不到"utils/ 内出现第二份写盘"**（详见 §4） |
| **M2** 门面漏掉一个导出（`setParcelsPicked`） | **判红**：`TypeError: storage.setParcelsPicked is not a function` + `只跑到 243 条，预期 656 条 ⇒ 这不是通过` ⇒ 导出面有真回归网 |

## 4. 诚实边界与新发现

1. **M1 暴露的缺口**：`check.js` 第 6 条只拦"`utils/` **之外**调 `wx.*Storage*`"，**不拦 `utils/` 内出现第二份实现** ⇒
   单源靠的是约定 + 本节记录，**当时没有机器闸**（本卡按禁令未加）。✅ **2026-09-25 用户已批并已落地 ⇒ 见 §5**。当时建议的形态：
   "`wx.*Storage*` 在 `utils/` 下必须只出现在 `storage-core.js`"（源码级，一行）。
2. **本卡未加任何断言、未改任何语义**（纯重构）；`CHANGELOG.md` 未回写（不在本卡写盘范围）。
3. **`parse.js` 仍是 688 非空行 > 500** ⇒ TD-001 的**另一半仍在**，本条只关掉 storage 那一半（台账已按此写）。
4. **真机无需复跑**：本卡不改行为、不改数据形态、不改导出面；但"取消建档 ⇒ 未归类"等真机项**与本卡无关**，仍按各批自己的照点清单走。

## 5. 判据落地（2026-09-25 追加微批：唯一写盘口）

用户裁决原文：**「批（推荐）：加"唯一写盘口"源码级判据」**。落地 = `tools/check.js` **第 11 条**（紧跟第 10 条之后，仍然没有第 12 条）。

- **口径**：`wx.*Storage*` 在 `utils/` 下**只许**出现在 `utils/storage-core.js`（第 6 条管的是 `utils/` **之外**；**同层再写一份**就是本节 §4 的 M1 洞）。
- **报红形态**：点名 `文件:行号 + 原句`，例：`[FAIL] 第二份写盘：utils/storage-parcels.js:359 出现 wx.setStorageSync —— 本地存储只在 utils/storage-core.js 里读写（拆件后同层再写一份会让单源静默失效）`。
- **剥注释是必须的**：`utils/storage.js:14` 的说明注释里**就写着** `wx.getStorageSync`/`setStorageSync` ⇒ 不剥注释的逐行正则会在那行**假红**（项目已有"注释里提到旧写法被正则命中"的教训）。实现 = 块注释换成等量空行（**保行号**）+ 行注释只砍掉后半段。
- **空集防线两条**：① 扫不到 `storage-core.js` ⇒ 判红（"无法核验"不许静默放行）；② **全 `utils/` 一个 `wx.*Storage*` 都没扫到** ⇒ 判红（"判据在空集上全绿"）。

**五条变异（副本内，**每条注入前都在盘上核实内容确已变**）**：

| 变异 | 读数 |
| :-- | :-- |
| M1 往 `utils/storage-parcels.js` 塞一句 `wx.setStorageSync('x',1)` | 注入前命中 **0** → 注入后 **1** ⇒ **判红**（点名 `storage-parcels.js:359`）、退出码 **1**；而修前同一用例**全绿**（正是 §4 的洞） |
| M2 还原那行 | 命中回落 **0** ⇒ 恢复绿（`通过 49 项；失败 0 项`）、退出码 **0** |
| M3 把 `storage-core.js` 改名（owner 缺失） | 判红：`第 11 条无法核验：utils/storage-core.js 不存在 ⇒ 「唯一写盘口」无从对帐`、退出码 **1** |
| M4 往 `utils/storage-customers.js` 塞**注释**提到 `wx.setStorageSync` | 盘上命中 **1**（注释）⇒ **仍然全绿**（证明剥注释生效、不误报） |
| M5 把 `storage-core.js` 两处调用改成 `undefined`（有 owner、零调用） | 判红：`没扫到任何 wx.*Storage* 调用 ⇒ 单源判据在空集上全绿`、退出码 **1** |

判据项数取数（⛔ 不写死）：`node tools/check.js | Select-Object -Last 2`。本批**不碰** `tools/selftest*.js`（断言数与拆分后同一水平）。