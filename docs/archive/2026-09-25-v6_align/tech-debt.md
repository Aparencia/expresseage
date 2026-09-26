# tech-debt 快照 · 2026-09-25-v6_align（归档时点）

> 取数：`Select-String -Path docs/TECH_DEBT.md -Pattern '^\| TD-' | Measure-Object`（条目数）、
> 同文件按状态列分组。⛔ 本快照是**时点复制**，不替代 `docs/TECH_DEBT.md`（唯一事实源）。

- **closed（本任务清偿）1 条**：`TD-017` —— `gate.ps1` 零变更时仍打印权威 GREEN（假绿入口）。
  证据：修复落在 `10cbb87`；复跑副本"零变更"用例 ⇒ `[WARN] 变更文件 0 个 …这不是通过` + **退出码 2**（独立复核者亦复跑过同一用例）。
- **carried（未清偿，随任务结转）25 条**，关键项：
  - `TD-001` 超线文件 —— **部分偿还**：`storage.js` 758 → 四件（`storage-core` 102 / `storage-customers` 228 / `storage-parcels` 327 / `storage.js` 209，`selftest` 656/656 前后同数）；**另一半未还**：`parse.js` 688 行仍 > 500。
  - `TD-014 ③` —— "`chatTools.root` ↔ `subPackages` ↔ 分包页 url 三处对帐"判据已按裁决删除 ⇒ 配置/参数写歪**只有真机能撞见**；后续真机读数（`openChatTool:fail invaild chatTool subpackage url`）**实证了这条预言**。
  - `TD-016` / `TD-024` —— 页面层与 wxml 层零断言/无机器闸（本任务新增的 `gate.ps1` 属工具层，不减这条）。
  - `TD-020` —— 用户可见隐私文案：**草案已出**（`docs/privacy/`），未定稿、后台未填 ⇒ 未 closed。
- **本任务新增的机器闸**：`gate.ps1`（锚点/范围/行数/lockfile 四件）＋ `check.js` 骨架与 BOM 名单纳入它（M10）＋ **第 11 条"唯一写盘口"**（`utils/` 下 `wx.*Storage*` 只许出现在 `storage-core.js`，带两条空集防线）。
- **本任务留下的口径**：判据条数/项数一律**取数不写死**；范围/体量按"锚点 vs 工作树"统计；git 路径读取一律 `-c core.quotepath=false`。