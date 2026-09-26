// app.js · 应用入口
// 为什么这里几乎什么都不做：数据全部走 utils/ 的本地存储层，入口只负责进程级初始化，
// 避免"启动时顺手拉数据"把首屏拖慢（小程序冷启动预算很小）。
App({
  onLaunch() {
    // 只记录启动时间，供后续排查"用户是不是刚打开就遇到问题"用；不含任何业务数据。
    this.globalData.launchedAt = Date.now();
  },

  globalData: {
    launchedAt: 0,
    // 单聊会话标识的**内存槽**（DESIGN K5）。
    // ⚠️ 2026-09-25 改判 N2 之后写入方变了：分包页 `chatpick/` 现在是**独立分包**（平台的 `chatTools`
    //   只接受独立分包，U-1 实测 `-80426`），独立分包 require 不到主包 ⇒ 它**不做判读**，只把平台原样
    //   返回塞进下面那个 `chatToolPickup` 包；判读、脱敏、写 `chatRoomId`、建档全部在主包
    //   `pages/archive-list/` 完成 ⇒ 三态判读与指纹规则仍然只有一份。
    // 刻意只放内存——⛔ 不进 URL query、不写日志、不落 `ex_college_v2.store` 之外的键；
    // 唯一落库路径是 `storage.createCustomer({chatRoomId})`。
    // 声明在此而不是让页面读一个不存在的字段：隐式全局状态要能被查到（AGENTS §11.1）。
    chatRoomId: '',   // ⚠️ 只放**平台原值**（N2 老路的兼容分支）；2026-09-25 范围扩展批已把"摘要"从这里拆走
    // 会话键（**本地摘要**）的槽 —— 与上面那个刻意分开（原来一个槽两种语义，M7 预选分不清拿到的是哪种）：
    // `chatKey` 只放 `chatTool.pairKeyOf` 的 **16 位 hex 摘要**，且**会话级存活**：M7 预选发生在用户稍后
    // 打开录入页时，所以**不能**像 `chatToolPickup` 那样"消费一次即清"。写入方 = `pages/archive-list/`
    // （消费内存桥、算出摘要之后）。摘要不可逆 ⇒ **允许上屏**（用户裁决①：列表短键 / 浮层完整摘要）；
    // ⛔ 平台原值仍只走 `chatToolPickup` 与 `chatRoomId`，一个字符都不许上屏。
    chatKey: '',
    // 独立分包 → 主包的**内存桥**（方案 N2 / A′ 的载体；`switchTab` 不能带参数，所以走这里）。
    // 形状：`{ at, info, infoErr, bindErr, members, membersErr }`；`info` 是 `wx.getChatToolInfo` 的**原样返回**，
    // `members` 是 `wx.selectGroupMembers` 的**原样数组**（pick_friend，2026-09-25：那条通道官方口径是明文、
    // 单聊下直接返回双方 id；两段 id 由主包折成"本地摘要键"再落库，摘要不可逆 ⇒ 库里不再留平台原值）。
    // 两者都可能含会话标识，所以这一槽与 `chatRoomId` 同等级别的敏感：
    // **只在内存、上屏前必须过 `chatTool.maskRoomIds`、消费一次即清**。
    chatToolPickup: null,
    // ── 取键意图（2026-09-25 B 段：清单动线也能取键）────────────────────────────
    // 取键要**离开本页**（`openChatTool` 进聊天工具模式），而分包页选完固定 `switchTab` 回**档案格**
    // （`switchTab` 不能带参）⇒ 用户回来的落点不是他出发的地方。所以出发前记下"我正要录件"：
    //   `pendingIntake` = **标志**（谁在等这个键；档案页消费它一次 ⇒ 消费即清，绝不重复劫持）
    //   `intakeResume`  = **载荷**（未完成录件的草稿；录入页读 `resume=1` 时消费一次）
    // 两个槽刻意分开：标志由档案页消费、载荷由录入页消费，各有各的"读后即清"，不互相顶掉。
    // ⛔ 只放**本地数据**（草稿/来源），不放进来的会话语义；两槽都只在内存、都有 TTL（见 session-key-flow.js）。
    pendingIntake: null,
    intakeResume: null
  }
});
