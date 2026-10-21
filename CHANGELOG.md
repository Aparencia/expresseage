# Changelog

> 格式：Keep a Changelog（未发布段可增补，发布时归档）。
> 分两段记录：**用户可见变更**（顾客/兼职/开发者能感知的行为）与**工程细节**（结构/门禁/测试/部署）。
> 维护：由 Lead 在每批收口时更新；其他 agent 把变更写进交付回报，不直接改本文件。
> 纪律：没有门禁真实输出不写"完成"；条目可追溯到 `docs/V4_CONTRACT.md`（§/D#）、`docs/V4_ENGINEERING.md`（§/E#）或提交哈希。

## [未发布]

> v4 尚未发布，首个版本随批 9 提审/发布产生；以下"用户可见变更"是已定稿（CONTRACT v0.9）的设计口径，实现随批 1~批 9 落地。

### 用户可见变更

- **只做下单、接单与信息整理**：服务类型只表达"做什么"，不涉及任何费用/交易语义（CONTRACT §0/§6，D5/D6）。
- **双角色唯一编号**：顾客 `C-7K2M-9QX4`、兼职 `P-7K2-M9X`、开发者 `DEV-01`（可按白名单扩展）；编号不可改、不复用（D15）。
- **微信昵称与头像**：昵称必填、可改；头像来自微信头像选择器，可拒绝并使用默认头像（昵称首字色块）；头像与昵称**只向当前绑定的对方展示**，解绑/停用/注销后不再可见；分享卡片/通知/后台列表不含头像（D19，CONTRACT §11）。
- **绑定只能由顾客发起**：兼职端没有绑定/代绑入口，只能分享绑定卡片邀请顾客自己绑定；代客下单不产生绑定（D20，CONTRACT §4.1/§4.2）。
- **roomTag 恒大写**：按（兼职, 宿舍）绑定顺序分配 `A…Z/AA…`，展示如 `D4-522A`（D21）。
- **开发者账号切换**：真实账号只读（黄条 + 服务端拒写 + 全程审计）；测试账号可写（蓝条 + `TEST` 角标，仅测试数据、不计入统计、可一键清理），用于一个微信号单机验收两端（D18，CONTRACT §1.3）。
- **识别失败兜底与复核**：规则识别失败时把**去敏文本**发给第三方 AI 辅助识别（原图不出本程序云存储）；仍失败进开发者复核队列，原图仅复核页临时查看且逐次审计，默认 30 天删除（D16/D17，CONTRACT §4.3）。
- **云端账号与治理访问**：订单与资料存微信云开发、按角色隔离；开发者后台默认脱敏；账号可注销并按隐私承诺删除/匿名化（CONTRACT §11.2/§11.4）。

### 工程细节

- **2026-10-21 · 批 0 设计定稿**：`docs/V4_CONTRACT.md` v0.9 及 `V4_DATA_MODEL.md`、三份 `V4_UX_*.md`、`V4_ENGINEERING.md`、`V4_DECISIONS.md`（D1~D21）、`QA_CHECKLIST.md`、`ARCHITECTURE.md`、`docs/privacy/` 两件定稿/更新；四次修订 D18~D21（账号切换、头像昵称、绑定方向、roomTag 大写）已回写全部引用。
- **2026-10-21 · 批 1 骨架开工**（提交 `d5ad214`）：app.json 页面地图冻结（主包 7 + 分包 23 页）、`docs/ARCHITECTURE.md` 代码接口与写作用域冻结、根配置改造（`app.js`/`app.wxss`/`project.config.json`/`.env.example`/`.gitattributes` 等）。
- **2026-10-21 · 批 1 并行开发（S0~S14）**：Agent Team 按 `docs/ARCHITECTURE.md` 写作用域并行交付——`api/`（client 唯一出口 + upload/privacy/mode-guard + 10 个域模块）、`store/`（内存快照 + 平铺 bootstrap 水合）、`shared/` 13 件口径纯件与 `utils/`（ids/room-tag/storage/privacy-policy/avatar/recognize/ocr/customer-view/order-edit）、主包 7 页 + 3 分包 23 页四件套、15 套组件 + 根 `custom-tab-bar` + tabbar 资产、`cloudfunctions/api`（index/bootstrap/app/router + 7 中间件 + db/dao + lib + 11 域 handlers 66 个 client 动作 + 2 个 internal）与 `cloudfunctions/cleanup`（13 个幂等 sweep + 独立 dao）、`tools/` 17 件与 `check.ps1`/`gate.ps1`/`doctor.ps1`。
- **2026-10-21 · 批 1 收口（提交 `d125b42`）**：`check.ps1` 4 步全 PASS、退出码 0 —— `check.js` **31/31**、`check-docs.js --batch 1` **10/10**、零金额扫描 **0 命中（白名单 136 项）**、`selftest.js` **9 套 1,014 条断言全 PASS**（core 58 / state 341 / recognize 187 / cloud 125 / ai 86 / bind 48 / profile 47 / switch 74 / testaccount 48）；`sync-cloud-shared.js` 16 源 × 2 套 hash 一致；`doctor.ps1` 通过 15/告警 1（envId 占位待用户回填）0 失败；`gate.ps1 -Anchor 71341c9` 红色 **0** 项 / 黄色 **0** 项（退出码 0）。
- **2026-10-21 · 批 1 计数勘误（文档，代码未变）**：批 1 收口条目首版把 selftest 合计误记为 **1,011**（cloud 122），与 `d125b42` 内 `tools/selftest-cloud.js` 的 `EXPECTED_ASSERTIONS=125` 不符；按 `node tools/selftest.js` 实跑修正为 **1,014**（cloud 125，其余 8 套计数不变），`STATE.md`/`README.md`/本文件同步。本轮 `selftest-cloud` 新增 listPartner DTO 判据 3 条（§7.3 节内、未改既有用例语义）：①正控——fake-db raw order 文档敏感键精确集（证明 10 键扫描有牙）；②响应无 `groups` 且顶层键恰为 `counts,list,nextCursor`；③`list` 非空且逐条递归不含 `_id/customerOpenid/partnerOpenid/customerId/partnerId/clientRequestId/requestKey/cloudPath/claimTokenHash/batchActionId`（用独立 fresh fake DB，不碰既有 order 矩阵/isTest 用例）。
- **批 1 期间关闭的工程裁决**（详见 `docs/TECH_DEBT.md`）：TD-017 四档排序改客户端零件层（CONTRACT §5.2 优先，文档已回写）、TD-018 公开配置含 `viewTicketTtlMinutes`、TD-007/008/009 upload/privacy 接 `utils` 纯件关闭；新增并跟踪 TD-019（未建单识别失败无原图降级）、TD-020（aiFallback.model 云侧默认）、TD-021（listPartner groups raw 文档已修）、TD-022（serviceConfig P1 字段）、TD-023（系统通知已读）、TD-024（票据类型闸）。
- **未执行（只能用户/批 2+）**：云开发环境创建与 envId 回填、14 集合/索引/安全规则、`ADMIN_OPENIDS`/`DEEPSEEK_API_KEY` 环境变量、定时触发器与存储权限、真机点检、隐私后台声明与提审；云函数尚未在真实云环境部署运行（fake-DB 单测覆盖核心路径）。
