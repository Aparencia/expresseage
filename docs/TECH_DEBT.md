# TECH_DEBT · v4 技术债台账

> 用途：登记**已知欠账/风险/有意推迟**，让"现在没做"是明账而不是暗坑。功能未开工不算债务；债务 = 已知偏差、待取证、临时方案、判据缺口。
> 编号：`TD-###` 从 TD-001 起连续分配，**不复用、不跳号**。
> 状态：`开放`（待排期）/`跟踪中`（有批次或负责人）/`已关闭`（必须写关闭依据：门禁输出/批次验收/裁决）。
> 纪律：发现即登记；关闭时回写 `CHANGELOG.md`；与 `STATE.md` 风险节互链；不把本批计划内未完成项伪装成债务。

| 编号 | 条目 | 影响 | 计划/批次 | 状态 | 来源 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| TD-001 | **批 1 骨架先行**：多 agent 并行落骨架，对象判据（如安全面变异、页面级真机证据）要等对象批次才"必须真红"；批 1 收口前门禁可能红灯 | 骨架期红灯易被误读为"完成" | 批 1 收口：Lead 跑 `check.ps1` 全绿并留真实输出 | 跟踪中 | ENGINEERING §11 批 1 |
| TD-002 | **门禁 #28~#31 判据骨架已登记，尚未在对象批次验证"必须真红"** | 判据无牙时可能假绿 | 批 2/3/8 涉及安全面时补变异首红证据 | 跟踪中 | ENGINEERING §11/§8.2 |
| TD-003 | **[E5] 云存储安全规则可选项与三分包是否独立分包未实测** | 上传链路/共享代码策略可能返工 | 批 1 真机实测后回填 ENGINEERING §2.3/§3.5；批 9 前评估 | 开放 | ENGINEERING §13 E5 |
| TD-004 | **[E12] 头像/昵称隐私接口与基础库能力未实测**（`chooseAvatar`、`nickname` 输入、隐私弹窗、真机压缩到上限内） | 批 2 采集可能降级 | 批 2 真机实测；不可用则头像保持默认、昵称手填（不阻断上线） | 开放 | ENGINEERING §13 E12 |
| TD-005 | **[D8] 五苑正式展示名未给定**：`config.zoneLabels` 暂用默认展示名，C 的含义待用户确认 | 展示文案验收无法定稿 | 用户给出名称后只改 `config.zoneLabels`（不改代码） | 开放 | CONTRACT §13 D8 |
| TD-006 | **独立分包预留**：当前三分包非独立分包；若主包体积/首屏不达标需改独立分包，并复制共享代码 + hash 判据 | 体积超限时返工 | 批 9 前按体积实测评估；届时按 ENGINEERING §2.3 执行 | 开放 | ENGINEERING §2.3 [E5 延伸] |
| TD-007 | **头像压缩逻辑重复**：`api/upload.js` 自带压缩/上限判定，与 `utils/avatar.js` 的阈值/质量阶梯是两份实现 | 两套阈值漂移、难单测 | 批 2 页面接入头像时统一到 `utils/avatar.js`（需 Lead 排期改 S0 域文件） | 开放 | S6 交付边界 |
| TD-008 | **`utils/storage.js` 尚无生产调用方**：`lastRole`/引导已读/草稿指针的页面接入在批 2/批 6 | 新增导出暂无调用（门禁纪律） | 批 2 接入 launch/profile/workbench；未用字段届时删除 | 跟踪中 | ENGINEERING §5.6 |
| TD-009 | **`utils/privacy-policy.js`、`utils/avatar.js` 尚无生产调用方**：隐私弹窗闸、头像校验/默认头像接入在批 2 | 同上 | 批 2 接入 launch/profile/`avatar-view` 组件；未用导出届时删除 | 跟踪中 | ENGINEERING §5.8 |
| TD-010 | **`bootstrap.privacyConsent` 未进 `store` 快照**：隐私同意闸（版本变更重现/阻断）需要调用方从返回体取，批 2 接入 launch/role | 隐私弹窗接入点未闭合 | 批 2 由 S0 补 store 形状（ARCHITECTURE §3.4）并在 launch/role 接入 | 开放 | ARCHITECTURE §3.4 + UX_CUSTOMER §9.1 |
| TD-011 | **[E11] DeepSeek 账号/服务条款/配额与用途合规未确认**，`DEEPSEEK_API_KEY` 未配置 | AI 兜底不能正式上线 | E11 确认前保持 `aiFallback.enabled=false`；上线前由用户确认并记 RUNBOOK | 开放 | ENGINEERING §13 E11 |
| TD-012 | **订阅消息 P1 未实现**（模板审批、开关、文案进 config） | 通知体验依赖站内轮询/红点 | 按 D10 走 P1；MVP 不阻塞 | 开放 | CONTRACT §13 D10 / §9 |
| TD-013 | **cleanup 单触发器每 10 分钟的高频查询成本未评估** | 云开发调用成本/配额 | 上线后按控制台调用日志评估，必要时降频或分批 | 开放 | ENGINEERING §4.7 / R13 |
| TD-014 | **[R3] VisionKit 在目标机型真实吐字未取证** | 识别规则可能过度/不足 | 批 4 前不扩规则；真机取证后按 `docs/V4_FIXTURES.md` §6 入册 | 开放 | ENGINEERING §12 R3 |
| TD-015 | **fake DB 与真实云环境行为差异**（事务/唯一索引冲突/分页/时间类型）未对照 | handler 单测可能"假绿" | 批 1 部署后挑关键路径在 dev 对照一次 | 开放 | ENGINEERING §7.3 / R14 |
| TD-016 | **`docs/lessons/` 目录尚未建立**：踩坑卡应先查重再建（≤12 行/卡） | 教训无法沉淀 | 出现踩坑即建（Lead 域）；v3 框架无关卡按 §9.3 搬迁清单逐步搬 | 开放 | ENGINEERING §9.1/§9.3 |

| TD-017 | **四档排序归属口径冲突**：CONTRACT §5.2 要求客户端零件层排序，DATA_MODEL §5/ENGINEERING §5.1 旧表述为服务端返回并禁止重排；已裁决按 CONTRACT（客户端 `shared/order-view.sortByPickupRoute`），三份文档已回写 | 若实现按旧表述会与 CONTRACT 冲突 | 批 1 收口前由 task-40（workbench 排序修正 + selftest-state 断言）验证；验证后关闭 | 跟踪中 | Lead 裁决 2026-10-21 |
| TD-018 | **`config.getPublic` 是否含 `viewTicketTtlMinutes`**：DATA_MODEL §2.10 曾写不含，ENGINEERING §3.6 要求含（黄条/蓝条倒计时）；已裁决 **含** 并回写 DATA_MODEL §2.10/§7.5、shared/defaults `PUBLIC_CONFIG_KEYS` | 客户端倒计时缺配置项 | 关闭依据：ENGINEERING §3.6 优先 + DATA_MODEL 已回写 + shared/defaults 补键 | 已关闭 | Lead 裁决 2026-10-21 |
| TD-019 | **未建单的识别失败记录无原图可看**：`recognition_failures.fileId` 需订单侧回填（fileId='' + uploadTicketId 入队，order.create 带 image.failureId 时用订单 image.fileId 回填）；未建单记录复核页降级为 OCR 文本（DTO `hasImage=false`） | 复核页对"未下单即失败"记录看不到图 | 批 9 QA 点检注明该降级；如产品必须看原图，P1 评估 upload ticket 携带 fileId 通道（需客户端输入白名单扩项） | 跟踪中 | cloud-orders 实现 + Lead 裁决 2026-10-21 |
| TD-020 | **`config.aiFallback.model` 默认空串**：DATA_MODEL §2.10 写默认 `deepseek-chat`，但该 token 不允许进 shared/客户端；云端 `lib/ai` 在 model 为空时使用自身默认模型名（token 只在 cloudfunctions/api/lib/ai/**） | 配置种子与文档默认值表现不一致（服务端行为一致） | 批 1 收口后由 Lead 回写 DATA_MODEL 该行备注"云侧解析默认值"；不改 aiFallback 只读口径 | 跟踪中 | Lead 裁决 2026-10-21 |

## 维护规则

1. 新增条目：编号追加、必填"影响/计划/来源"，不得只写空泛口号。
2. 关闭条目：状态改 `已关闭` 并在条目末尾补 `（关闭依据：…）`；不删除历史行。
3. 计划变更：改"计划/批次"并回写 `STATE.md` 对应风险项；涉及口径的必须先改 `docs/V4_CONTRACT.md`。
4. 与门禁的关系：债务不豁免门禁；任何人不得以"已有 TD 记录"为理由跳过判据（关闭前必须绿）。
5. 隐私/安全类债务（当前 TD-003/004/007/010/011/015）优先于体验类；上线前必须清零或由 Lead 明确接受风险。
