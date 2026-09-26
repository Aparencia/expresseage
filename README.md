# expresseage_college_v2 · 校园快递代取台账 v2

> 一句话：给大学校园里做快递代取的学生兼职——建客户档案、上传客户发来的快递截图、识别站点，
> 最后把多个客户的快递**按站点整合成一份取件清单**，少走回头路；数据全部存在本机。
> **v2 的核心变化**：客户档案带一个**单聊会话标识**，选图识别快递码时按它自动归类到对应档案。
>
> 立项：`docs/decisions/IDEA_2026-09-23_代取台账重构v2.md`｜选型：`docs/decisions/STACK_2026-09-23_沿用v1_A案.md`
> 前身：`../expresseage_college/`（v1，2026-09-23 冻结转只读参照；完整状态在其分支 `archive/v1` / 标签 `pre-rebuild-20260923`）

## ⛔ 开工门（第一批编码前必须过，三条都只有用户能跑）

见 IDEA 卡 §6：① 三种 `url` 写法哪种被接受 ② 能否真弹出「选择聊天」并绑定 ③ `chatTools` 是否对个人主体开放。
任一不通 ⇒ 建档动线降级为切片 A（手动建档 + 一行楼区输入，无 id），**不再临时讨论**。

## 快速启动

```powershell
powershell -File doctor.ps1   # 环境自检：每项输出版本号=通过
powershell -File check.ps1    # 收工仪式：退出码 0 = 可以说"完成"
```

跑起来（GUI）：微信开发者工具 → 导入项目 → 选本目录（`appid` 沿用 v1 同一个，已填）

## 现状（波 5 已落地并通过 r3/r4 两轮审查 · **待真机取证**）

- 屏上：**底栏两格（取件清单 / 用户档案）+ 录入页 + 清单页「＋ 录快件」入口** 已装配，11 卡的占位页已删；
  录入页是"上常驻 / 中可滚 / 下常驻保存"的三段布局（M14）。
- ⛔ **「从聊天进入并绑定」已改判 N2、代码就位、能力仍未取证**：`chatpick/` 是**独立分包薄入口**（只调 `wx.openChatTool`/`getChatToolInfo`、把平台原样返回塞进 `globalData.chatToolPickup`、再 `switchTab` 去档案格；**引不到主包 ⇒ 不判读、不建档、屏上不出现平台原文**），
  建档与三态判读、指纹脱敏都在主包 `pages/archive-list/` 的浮层里 ⇒ `globalData.chatRoomId` 的唯一写入点是**档案页的 `consumePickup()`**（不再是分包页）；
   但"平台到底给不给这个能力"是 **U-5/U-6**，另加 N2 带来的新开工门 **U-7（独立分包里 `getApp()` 拿不拿得到主包实例——内存桥成立与否全押它）**，**至今零读数** ⇒ 不能当成可用。照点清单：
  `docs/specs/20260923_chat_pick/RESEARCH.md` §6.1
- ⛔ **界面未验证**：没有微信开发者工具、没有真机，`SCOPE` 的 V1~V18 **一条都没点过**（V16/V17/V18 是波 5 新增的三条）
- 门禁 = `tools/check.js` 机械判据（**条数与项数不写在这里**，取数：`node tools/check.js | tail -2`）
  + 行为自测 `tools/selftest.js`（波 5 两节在 `tools/selftest-wave5.js`；条数取数：`node tools/selftest.js | tail -2`）
  + 收工仪式 `check.ps1`。仍未接回的判据见 `docs/TECH_DEBT.md` TD-003

- 零 npm 依赖、无后端、无云；数据只存本机 `ex_college_v2.store`（**与 v1 的 `ex_college.store` 严格隔离**，同 appid 同命名空间，绝不读写 v1 键）
