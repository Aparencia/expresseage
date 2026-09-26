# TD-001 偿还 · parse 半边：`utils/parse.js` 拆分（2026-09-26 · 卡 52 · 起点锚点 `c4bb624`）

> 本文件是**卡 52 的产物**（同 `SPLIT.md` 之于 storage 半边）。命令都在 `_tmp_parse_split/`（**仓库外**，同 `_tmp_bug30` / `_tmp_recognize` 先例）。

## 1 切法（依赖单向）

```
utils/parse.js            166 → 门面 + 顶层编排（cleanLines / extractLockerFromLines / firstLockerIn
                                  / parseParcelText / parseParcelTextMulti）
  ├── utils/parse-station.js  233 → 站点层（14 个函数）
  │     └── utils/parse-text.js  123 → 文本层（10 个函数；**零内部依赖**）
  └── utils/parse-codes.js    205 → 取件码层（14 个函数）
        └── utils/parse-text.js（同上）
```

- 依赖方向 **单向**：`parse-text` ← `parse-station` / `parse-codes` ← `parse`。生成器带方向自检（反向引用会打印 `⚠️ 反向/自环`）。
- 真环只有 `collectLabeledCodes ⇄ continueCollectNextLine`（同族，**同模块**）。
- `pickStation → parseParcelText` / `firstCodeAfterLabel → parseParcelText` 是**注释引用**，不是真调用（机械核实：行 401 与注释行 157 原句）。
- 门面**导出面逐名不变**：`Object.keys(require('./utils/parse.js'))` 仍为 `["parseParcelText","parseParcelTextMulti"]` —— 全仓唯一调用点 `pages/recognize/form-parts.js:24` **零改动**。

## 2 等价性证据（本模块**零直接断言**，所以 `selftest` 不变不能当证据）

取数：`Select-String -Path tools/selftest*.js -Pattern 'parse\.' | Measure-Object` ⇒ **0 命中**。

| 证据 | 读数 |
| :--- | :--- |
| **金样本逐字节比对**（84 例：三份 RCA/FIX 里收割的真机/转录文本 + 8 组真机样本 + 12 组边界） | `pre`(HEAD `c4bb624`) ↔ `post` **不同 0 / 84**；两侧抛异常 0；84/84 例产出非空结构（语料不是"全空陪跑"） |
| 复跑命令 | `node _tmp_parse_split/run.js <模块> <out.json> <仓库根>`；比对脚本 `goldendiff.js` |
| 行数 | 688 → 123 + 233 + 205 + 166（各 ≤500；**无一行原始内容丢失**：生成器逐行核对 688 非空行全覆盖，未被覆盖 0） |
| 未声明引用扫描（正面防 BUG-04 形态） | 四件共 43 个函数、逐函数检查引用是否"本地声明或已 import" ⇒ **0 处**（剥注释后；脚本 `identcheck.js`） |

## 3 变异（副本内；每次注入前后**盘上核实**）

| 变异 | 注入核实 | 读数 | 结论 |
| :--- | :--- | :--- | :--- |
| **M1** 门面漏一个导出 | ✓（导出数 2→1） | 金样本 **84/84 抛异常** | 被探针抓住；**两道门禁都不会红**（selftest 对本模块零引用） |
| **M3** 门面漏 `require`（= **BUG-04 形态**） | ✓ | 金样本 **84/84 抛异常**（`pickStation is not defined`） | 同上 —— 这正是 BUG-04 在识别链上造成"100% 崩而门禁全绿"的同一形态 |
| **M2** 把 `STATION_KEYWORDS` 复制成第二份并改用副本 | ✓（副本名出现 2 次） | 金样本 0/84 差异；扫描 0 处 | **没有任何机器闸**看得见"同类实现被复制" ⇒ 建议新判据**须人批** |

## 4 生成器/探针的三处自曝（都当场修掉）

1. **生成的 `parse.js` 出现两行 `module.exports`** —— 最后一个符号（`parseParcelTextMulti`）的行块连同原文件的 `module.exports` 一起被搬了进来；末行生效 ⇒ 导出"看着对"（侥幸），却**掩盖了 M1 变异**。修法：搬迁时跳过 `^module\.exports` 行。
2. **混行尾**（源行自带 `\r` + 生成的头是 `\n`）⇒ 修法：按原文件多数行尾重新拼接；修后四件**纯 CRLF、零纯 LF**。
3. **生成器不可重复运行**（对着已切好的门面再跑 ⇒ 顶层符号只剩 7 个 ⇒ TypeError）⇒ 加 `--from <原始文件>` 参数，从 `git show HEAD:utils/parse.js` 的副本复现。

另外两处**探针**自身的错（按项目规矩记下，别让它伪装成代码缺陷）：调用图探针 `\\b` 被 PowerShell 转义吞掉 ⇒ 报"每个函数无内部依赖"的假读数；命令里双引号套双引号 ⇒ 整条 PowerShell 解析失败、什么都没跑。

## 5 与 BUG-04 的关系（同时段发现的同族缺陷）

并行批的 BUG-04 RCA（`docs/specs/20260926_recognize_fix/RCA.md`）指出：`pages/recognize/form-parts.js` 的 `planParsePatch` **只搬了函数体、没搬依赖**（`parse`×2、`reasonText`×1 都没 require）⇒ 识别出字后 100% 抛异常，而两道门禁全绿（该函数全仓 **0 条断言**）。本次拆分把"**搬迁必须同时搬依赖**"做成了两道机械检查（生成器的引用计算 + `identcheck.js` 的未声明引用扫描），并把 M3 作为常驻变异用例 —— 这两处正好补上 TD-029 想解决的缺口的一半（**堆栈内可见**的那一半）。
