# RUNBOOK · expresseage_college_v2（≤80 行）
> 这里写"怎么跑起来、出事先看哪"。⛔ 只写本机**真的验证过**的命令；没验过的一律标注"未验证"。
> 本项目：原生小程序（WXML/WXSS/JS）+ 本机存储；**无后端、无云、零依赖**。

## §1 启动（GUI：微信开发者工具）
1. 装微信开发者工具（`doctor.ps1` **不覆盖**它，只能人工确认）。
2. 导入项目：选本目录 `expresseage_college_v2/`；项目名与 `appid` 已写在 `project.config.json`（`appid` = 个人主体 AppID，**不是密钥**）。
3. 基础库：日常开发 ≥ **3.7.8**；要跑聊天工具相关（`wx.openChatTool` / `wx.getChatToolInfo` / `wx.selectGroupMembers`）必须 ≥ **3.7.12**（官方口径，见 `docs/specs/20260925_pick_friend/RESEARCH.md §2`）。
4. ⛔ 不要把 Skyline / `navigationStyle` 开到**全局**：主包三页走 webview；`chatpick` 分包页的 Skyline + glass-easel + 页面级自定义导航写在 `app.json` 的 `subPackages[0]` 与 `chatpick/index.json` 里，**别手改绕过**（`tools/check.js` 第 9 条会判红，v1 就是这么把全站导航弄没的）。
5. ⛔ 真机读数**一律用「预览」扫码**，模拟器读数不算数（教训卡 `2026-09-15_模拟器冒充真机.md`）。

## §2 日常检查（每条都是可复制的一行）
```powershell
powershell -File doctor.ps1     # 环境：必需项 node / git 各输出版本号 = 通过
node tools/check.js            # 机械判据（语法/三件套/class 对帐/密钥卫生/分层不越界…）
node tools/selftest.js         # 行为自测（纯函数与页面零件；末尾给"断言 N 条"）
powershell -File check.ps1     # 收工仪式 = 上面两条；**退出码 0 才可以说"完成"**
```
`gate.ps1`（锚点 / 范围 / 行数 / lockfile）用于**每批提交前后**：
```powershell
powershell -File gate.ps1 -Anchor <起点哈希> -ScopeFiles "utils/","pages/" -Estimate 600
# 退出码：0=绿 1=红（停下修） 2=黄（随批级知会转述）
```

## §3 数据：在哪、怎么处置
- 位置：**本机** `wx.setStorageSync` 的单键 `ex_college_v2.store`（`{schemaVersion, customers[], parcels[]}`；事实源 `docs/registry/DATA_DICT.md`）。
- ⛔ **v1 的键 `ex_college.store` 禁止读、写、清空**：v1/v2 同一个 `appid` ⇒ 同一台手机同一命名空间，动它就是删真实数据（AGENTS §9 红线）。
- ⛔ **不跨设备、无备份**（v1 已知风险在 v2 一字不改地继续成立）：换手机 = 数据不会跟过去。
- 导出 / 清库 / 迁移：**只有人能执行**（不可委托清单）。agent 只能给草案与证据。

## §4 `.env` 键含义
**无键**：本项目没有任何密钥或外部服务（无后端 / 无云 OCR / 无第三方 API）。`.env.example` 只有注释；将来说明见该文件末尾。小程序 AppID 不是密钥，填在 `project.config.json`。

## §5 故障先看哪（按症状）
| 症状 | 先看 |
| :-- | :-- |
| `check.ps1` 退出码非 0 | 它自己的输出：哪一条 `[FAIL]`（判据名逐条列在 `check.ps1` 头部与 `tools/check.js` 内） |
| 页面白屏 / 没样式 | 分包页：Skyline 下**裸文本不渲染**（文字必须包在 `<text>` 里）；主包页：`app.json` 声明的页面缺三件套 ⇒ `check.js` 第 3 条会报 |
| 识别没预填 | 只降级为"少预填"，**不阻断录入**：手工填写照样能存（相册/摄像头两道门禁各自独立，看页顶状态条） |
| 数据读不出来 | `STORE_CORRUPT`（库被改坏）或 `STORE_VERSION_MISMATCH`（装过更新版又回退）：**停止录入**，别再写盘 |
| 保存失败 | `WRITE_FAILED`（写盘异常）/ `QUOTA_EXCEEDED`（本机存储满）：先清已完成、已归档的记录 |
| 归类别错人 | 会话键相关：看 `docs/specs/20260925_pick_friend/DESIGN.md`（键 = 单聊双方 id 的无序对摘要；换会话即换键 ⇒ 走"重新绑定"） |

## §6 发布（未验证）
**本项目从未发布过**：`41 发布卡` 未走、没有版本标签、没有线上回滚点 ⇒ 本节**没有可写的历史经验**。
发布动作（提交审核 / 发布 / 打 tag）属不可委托清单，**只能人执行**；走之前先过 `check.ps1` 与 `docs/PRIVACY.md` 的口径。

## §7 未验证清单（诚实边界，别把"写了"当"通了"）
1. **界面从未在真机上点过**（本机没有微信开发者工具、没有真机）：`SCOPE` 的验收项一条都没点检。
2. 聊天工具三段能力（`wx.openChatTool` / `getChatToolInfo` / `selectGroupMembers`）**零真机读数**：U-2 / U-5 / U-6 / U-7 / U-9 / U-11 全部待取证，照点清单在 `docs/specs/20260923_chat_pick/RESEARCH.md §6.1` 与 `docs/specs/20260925_pick_friend/RESEARCH.md §2.1/§2.2`。
3. 发布、备案、隐私协议提交：未做（`docs/PRIVACY.md` 只写了口径，不代表已提交）。
