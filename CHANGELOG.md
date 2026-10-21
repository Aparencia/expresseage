# Changelog

> 格式：Keep a Changelog（未发布段可增补，发布时归档）。
> 分两段记录：**用户可见变更**（顾客/兼职/开发者能感知的行为）与**工程细节**（结构/门禁/测试/部署）。
> 维护：由 Lead 在每批收口时更新；其他 agent 把变更写进交付回报，不直接改本文件。
> 纪律：没有门禁真实输出不写"完成"；条目可追溯到 `docs/V4_CONTRACT.md`（§/D#）、`docs/V4_ENGINEERING.md`（§/E#）或提交哈希。

## [未发布]

> v4 尚未发布，首个版本随批 9 提审/发布产生；以下"用户可见变更"是已定稿（CONTRACT v0.9）的设计口径，实现随批 1~批 9 落地。

### 用户可见变更

- **只做下单、接单与信息整理**：服务类型只表达"做什么"，不涉及任何费用/交易语义（CONTRACT §0/§6，D5/D6）。
- **双角色唯一编号**：顾客 `C-XXXX-XXXX`、兼职 `P-XXX-XXX`、开发者 `DEV-01`（可按白名单扩展）；编号不可改、不复用（D15）。
- **微信昵称与头像**：昵称必填、可改；头像来自微信头像选择器，可拒绝并使用默认头像（昵称首字色块）；头像与昵称**只向当前绑定的对方展示**，解绑/停用/注销后不再可见；分享卡片/通知/后台列表不含头像（D19，CONTRACT §11）。
- **绑定只能由顾客发起**：兼职端没有绑定/代绑入口，只能分享绑定卡片邀请顾客自己绑定；代客下单不产生绑定（D20，CONTRACT §4.1/§4.2）。
- **roomTag 恒大写**：按（兼职, 宿舍）绑定顺序分配 `A…Z/AA…`，展示如 `D4-522A`（D21）。
- **开发者账号切换**：真实账号只读（黄条 + 服务端拒写 + 全程审计）；测试账号可写（蓝条 + `TEST` 角标，仅测试数据、不计入统计、可一键清理），用于一个微信号单机验收两端（D18，CONTRACT §1.3）。
- **识别失败兜底与复核**：规则识别失败时把**去敏文本**发给第三方 AI 辅助识别（原图不出本程序云存储）；仍失败进开发者复核队列，原图仅复核页临时查看且逐次审计，默认 30 天删除（D16/D17，CONTRACT §4.3）。
- **云端账号与治理访问**：订单与资料存微信云开发、按角色隔离；开发者后台默认脱敏；账号可注销并按隐私承诺删除/匿名化（CONTRACT §11.2/§11.4）。

### 工程细节

- **2026-10-21 · 批 0 设计定稿**：`docs/V4_CONTRACT.md` v0.9 及 `V4_DATA_MODEL.md`、三份 `V4_UX_*.md`、`V4_ENGINEERING.md`、`V4_DECISIONS.md`（D1~D21）、`QA_CHECKLIST.md`、`ARCHITECTURE.md`、`docs/privacy/` 两件定稿/更新；四次修订 D18~D21（账号切换、头像昵称、绑定方向、roomTag 大写）已回写全部引用。
- **2026-10-21 · 批 1 骨架开工**（提交 `d5ad214`）：app.json 页面地图冻结（主包 7 + 分包 23 页）、`docs/ARCHITECTURE.md` 代码接口与写作用域冻结、根配置改造（`app.js`/`app.wxss`/`project.config.json`/`.env.example`/`.gitattributes` 等）。
- **2026-10-21 · 批 1 并行写（进行中）**：S0~S10 分别落 `api/`（client/upload/privacy/mode-guard/modules）、`store/`、`shared/`、`utils/`、页面与组件、`cloudfunctions/**`、`tools/**` 与 `check.ps1`/`gate.ps1`/`doctor.ps1`；各域交付以 Lead 收口为准。
- **2026-10-21 · S6 新增**：仓库文档六件 `AGENTS.md`、`STATE.md`、`CHANGELOG.md`、`docs/RUNBOOK.md`、`docs/V4_FIXTURES.md`、`docs/TECH_DEBT.md`；客户端纯件 `utils/storage.js`（唯一本地写口，键 `ex_college_v4.store`）、`utils/privacy-policy.js`（隐私同意与版本判定）、`utils/avatar.js`（头像校验/压缩计划/默认头像策略，平台能力注入）。三个纯件均通过 `node --check` 与本地注入替身冒烟。
- **批 1 收口待办**：`check.ps1`（含 `check.js`/`check-docs.js --batch 1`/全部 `selftest*`/`zero-money-scan`）真实输出、云函数 `health.check`/`admin.bootstrap` 冒烟、提交与 `gate.ps1` 绿；未收口前不宣称批 1 完成（详见 `STATE.md` §8 与 `docs/RUNBOOK.md`）。
