# FIX · 录入页「给谁录」标签重复（`D4 555 D4 555 A`）

- 卡：**31 修复** ｜ 上游：`docs/specs/20260925_label_dup/RCA.md`（卡 30）｜ 定级：**P2**
- 起点锚点：`baab42787d434927768221a10721f290f96697ee`（= `baab427`，开工时 `git rev-parse HEAD` 实取）
- 日期：2026-09-25

---

## 1. 根因复述（一句话，引用 RCA §3 第 4 层）

**两条规则分别正确、合起来错**：空称呼自动补名（`utils/customer-input.js:168 nextCustomerName()`）把「楼栋 宿舍」写进了 `Customer.name`（如 `D4 555 A`），而录入页的标签合成（`pages/recognize/form-parts.js:281`）仍假设 `name` 是纯人名、**又拼了一次前缀** ⇒ 同一段信息出现两遍。**缺一张"标签由谁拼"的单源约定。**

时间线（`git log -S` 取数）：自动补名 `ab15e0d`（2026-09-24）先落地；`buildCustomerOptions` 由 `c3f2a48`（2026-09-25，**r3 修另一个 P1 的那一批**）新增 ⇒ **"修 A 引入 B"**，且当时断言只喂"有人名"输入 ⇒ 对全部门禁不可见。

## 2. 修复（最小改动：**1 个实体文件**）

`pages/recognize/form-parts.js` 新增**纯函数** `customerLabel(customer)` 作为**标签唯一合成处**，`buildCustomerOptions` 改为调它：

```js
const prefix = building + ' ' + dorm + ' ';
// 派生名（如 `D4 555 A`）已以 prefix 开头 ⇒ 原样出；⛔ 别再拼一遍（否则 = 真机缺陷 `D4 555 D4 555 A`）
return name.indexOf(prefix) === 0 ? name : prefix + name;
```

- **为什么最小**：一个函数块 + 一个纯函数；**有人名的客户行为逐字不变**（`prefix + name` 分支原样保留）；不碰数据层（**无迁移**）、不碰 wxml（`index.wxml:22-24` 零拼接，RCA 候选 C 已排除）、**不碰** `nextCustomerName`（RCA 候选 B 已排除：它有 2026-09-21 用户裁定背书，改成只叫 `A` 会让清单行认不出人）。
- 为什么用"前缀包含"而非存档标志：`Customer` 无"是否自动补名"字段（加字段 = 改表结构 ⇒ 须另立卡）；派生名形态确定（`前缀 + 单后缀`）。
- 大小写/字段缺失均安全（`String(x == null ? '' : x)`），退化情形与旧行为逐字一致。

## 3. 断言（`tools/selftest-wave5.js`，`EXPECTED_ASSERTIONS` **486 → 491**）

| 断言 | 钉住什么 |
| :-- | :-- |
| **标签④** | 派生名（`D4 555 A`）⇒ 标签**不重复前缀**（直接钉用户报的那串）|
| **标签⑤** | 派生名标签里「楼栋 宿舍」**只出现一次**（结构性，防别的写法绕回）|
| **标签⑥** | 有人名的客户行为**逐字不变**（`D4 522 小王`）⇒ 修的是分歧支，不是改口径 |
| **标签⑦** | 同宿舍 A/B 两位派生名**仍可区分**（修法不许把可区分性弄丢）|
| **标签⑧** | 字段缺失 ⇒ **不吐 `"undefined"`** |

## 4. 变异证伪（副本内；注入前**盘上核实**注入确实生效）

| 步骤 | 读数 |
| :-- | :-- |
| 把 `customerLabel` 的返回改回**无条件拼接**（`return prefix + name;`）| 盘上核实：`return prefix + name;` 已在文件中 |
| 跑 `tools/selftest.js` | **退出码 1**；`[FAIL] 标签④ …实际 "期望 \"D4 555 A\"，实际 \"D4 555 D4 555 A\""`｜`[FAIL] 标签⑤ … 期望 1，实际 2`｜`断言 491 条：通过 488，失败 3` |

⇒ **新断言有牙，且红在预期断言上**（红出的正是用户报的那串 `D4 555 D4 555 A`）。

## 5. 四道读数（真实输出）

| 门 | 读数 |
| :-- | :-- |
| `node tools/check.js` | **机械门禁通过**（42 项、0 失败、0 警告）|
| `node tools/selftest.js` | **断言 491 条：通过 491，失败 0** |
| `powershell -File check.ps1` | **退出码 0**（"全部通过：完成声明成立"）|
| `gate.ps1 -Anchor baab427… -ScopeFiles 'pages/recognize/,tools/,docs/registry/,docs/specs/' -Estimate 150` | **绿 exit 0**：变更 **5 文件全部在范围内**、行数在线内、依赖无变化、**体量 102 ≤ 225** |

改动范围（`git diff --stat <锚点>`）：`pages/recognize/form-parts.js` +28/-1｜`tools/selftest-wave5.js` +15｜`tools/selftest.js` +1/-1｜`docs/registry/COMPONENTS.md` +1/-1 ⇒ **实体逻辑 1 文件、合计 44 行**。

**修复范围双维锁自评**：按"实体逻辑 1 文件 / ≤100 行"= ✅；按"文件总数"含 2 个测试文件与 1 处 registry 回写（均为卡 31 §② 强制项）= **⚠️ 黄牌边界**，已在开工回执里显式登记并请派单方复核。

## 6. 回写

- `docs/registry/COMPONENTS.md`「录入页客户选择区」行：补**标签单源 = `form-parts.customerLabel`**、改口径史（真机缺陷 `D4 555 D4 555 A`）、最近确认改 **2026-09-25**，影响面列加"改它会动断言 §标签④~⑧"。
- 数据字典/接口：**无变化**（无新字段、无新错误码、无迁移）。

## 7. 同族发现（**越界未修**，交派单方另立卡）

全仓共 **5 处**同款拼法 `楼栋 + ' ' + 宿舍 + ' ' + 称呼`，本批只修了 `form-parts.js:281`（在授权范围内）：

| 文件:行 | 用途 | 状态 |
| :-- | :-- | :-- |
| `pages/recognize/form-parts.js:281` | 录入页客户选择区标签 | ✅ **本批已修（单源 `customerLabel`）** |
| `pages/archive-list/sheet-flow.js:97` | 查重命中提示的客户标签 | ⛔ 未修（越界）|
| `pages/archive-list/sheet-flow.js:131` | 重锚冲突提示里的持有者标签 | ⛔ 未修（越界）|
| `pages/archive-list/row-actions.js:49` | 行内操作（换绑）目标标签 | ⛔ 未修（越界）|
| `pages/archive-list/index.js:331` | 换绑目标的 label | ⛔ 未修（越界）|

## 8. 同族收口（2026-09-25 第二批「A 段」，用户裁决「另立一小批一起收掉」）

| 处 | 修法 | 断言 |
| :-- | :-- | :-- |
| `pages/archive-list/recycle.js:25`（回收站行） | 改用单源 `aggregate.customerLabel(item)`（原写法是 `[item.building, item.dorm, item.name].filter(…).join(' ')`） | **标签⑮**（行为：无称呼客户的行标签 = `D4 555 A`） |

### 8.1 单源扫描扩到**两种形状**（附一次假红修复）
`标签⑬` 原来只认**前缀拼接**一种形状（`building + ' ' + x.dorm`），而回收站那处是**数组 join** ⇒ 抓不到它（就是它漏成"第 5 处"的原因）。
现在两种形状都认，并**报出形状名**（例：`pages/archive-list/recycle.js(数组 join)`），下一处冒出来时能被机器抓住。
⚠️ 扩展时先踩了一次**假红**：注释里引用旧写法解释 Why 也被正则命中 ⇒ 扫描改为**只扫代码行**（去掉纯注释行）。
局限已写进断言注释：行尾 `// 注释` 不清（真写在那里的同形字面量仍会误报 ⇒ 换个写法即可）。

### 8.2 变异读数（副本内，注入前**盘上核实**内容确已变）
| 变异 | 期望 | 实测 |
| :-- | :-- | :-- |
| 回收站改回数组 join | 标签⑮ + 标签⑬ 判红 | ✅ 退出码 1，红 2 条（⑮ 期望 `D4 555 A` 实际 `D4 555 D4 555 A`；⑬ 点名 `recycle.js(数组 join)`）|
| 页面上注入**前缀拼接**形状 | 标签⑬ 判红 | ✅ 判红（证明两种形状各自有牙）|

> ⛔ 本轮**未真机验证**：回收站入口要先软删一条档案才看得到，属 25 卡的真机点检项。

⇒ 涉及**无称呼客户**时，上述 4 处同样会显示重复串（`D4 555 D4 555 A`）。**建议**：另立一卡，把这 4 处改为调用同一份单源函数（可把 `customerLabel` 提到 `utils/` 或由档案页零件复用），并按本卡断言风格补断言。

## 8. 已知残余（本批不修，登记建议）

建档后若**改了楼栋/宿舍**，派生名里的旧前缀会与字段不再一致 ⇒ 该客户标签会**重新出现**"前缀 + 旧派生名"的重复形态（根因与本案同源：`name` 里存了冗余定位信息）。彻底解法二选一：① `name` 不再带前缀 + 清单行改为拼三字段；② 给 `Customer` 加 `autoNamed` 标志（**改表结构 ⇒ 红线，须人批**）。

## 9. 诚实边界（⛔ 不许当已验）

- **真机未验**：修好后必须由用户**看一眼录入页「给谁录」那一行**（应显示 `D4 555 A` 而非 `D4 555 D4 555 A`），本批只有纯函数复现 + 断言 + 变异证伪。
- **卡 30/31 §④ 的状态回写（`STATE.md`）不在我的写盘范围内**（派单明确禁止改 `STATE.md`）⇒ 「当前任务 = BUG-<序号>」「起点锚点」「下一步 = 32 回归验证」需由派单方或用户回写。
- 未跑：`audit` 类判据（TD-003 未接回）；未做的照点：档案页 4 处同款（§7）。

## 同族 4 处收口（2026-09-25 · 本批）

**为什么不能只修录入页那一处**：同一个拼法在档案页还有 4 处，无称呼客户走那几条路时同样会重复（"只修一处 = 换个地方继续显示"）。

| 处 | 位置 | 修法 |
| :-- | :-- | :-- |
| 查重提示 | `pages/archive-list/sheet-flow.js` `describeSessionKey` | 改调 `aggregate.customerLabel(dup)` |
| 重锚冲突提示 | 同文件 `describeRebindNotice` | 改调 `aggregate.customerLabel(holder)` |
| 行内换绑（软删确认框的标签） | `pages/archive-list/row-actions.js` `onRowDelete` | 改调 `aggregate.customerLabel(row)` |
| 换绑目标标签 | `pages/archive-list/index.js` `onRebindKey` | 改调 `aggregate.customerLabel(target)` |

**单源落点 = `utils/aggregate.js` 的 `customerLabel`**（AGENTS §2.2 禁平行新建 ⇒ 扩既有共享模块，不新开文件）。
`pages/recognize/form-parts.js` 只 **re-export**（`const customerLabel = aggregate.customerLabel;`），本页既有调用方与断言 §标签④~⑧ **逐条不动**。

**新增断言 6 条（§标签⑨~⑭）**：⑨ 单源引用是同一个函数（不是副本）｜⑩ 查重提示对无称呼客户不重复前缀｜⑪ 查重整段文案不出现重复形态｜⑫ 重锚冲突提示不出现重复形态｜⑭ 这两条路上"有人名"客户逐字不变｜⑬ **源码级单源**：扫 `pages/` 与 `utils/` 的全部 `.js`，除 `utils/aggregate.js` 外不得出现 `building + ' ' + dorm` 这种前缀拼接。

**自曝一处过程错（门禁当场抓住）**：第一版把 `customerLabel` 加进 `aggregate.js` 却**忘了加进 `module.exports`** ⇒ `form-parts` 拿到 `undefined`、一调就抛，`selftest` 立刻红（"只跑到 329 条，预期 491"）。补导出后复跑才全绿。⇒ 与"装配件漏一项"同族：**跨模块搬运必须两头都验**。

**残余（都进 `docs/TECH_DEBT.md` TD-022）**：
1. **同族第 5 处未收**：`pages/archive-list/recycle.js:25` 的 `[item.building, item.dorm, item.name].filter((part) => part).join(' ')` —— 同一缺陷、**形状不同**（数组 `join`，不是 `+` 拼接），而该文件**不在本批写盘范围** ⇒ 按 AGENTS §2.1 只登记、不顺手修；⚠️ 本批的源码级单源断言**只覆盖 `+` 形状 ⇒ 抓不到它**。
2. **改楼栋/宿舍后前缀失配**：派生名把定位前缀存进了 `Customer.name` ⇒ 改字段后判定不再命中、重复形态复现。彻底解法之一（给 `Customer` 加 `autoNamed`）属**改表结构 = 红线须人批**。
