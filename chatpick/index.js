// chatpick/index.js · 聊天工具入口页（**独立分包**，方案 N2 / v1 的 A′ 那一半）
//
// 2026-09-25 的读数把这一页的形态定了死：`chatTools[0]` 只接受**独立分包**（预览报 `-80426
// subPackage /chatpick/ for chatTools[0] should be independent`）。而独立分包 **require 不到主包**
// ⇒ 本页不能再用 `utils/customer-input`、`utils/storage`、`utils/chat-tool`（用了就是白屏），
// 更不能"在分包里再抄一份规则"——那正是 v1 当年否掉分包建档的原罪（`规则与样例分叉` 教训卡）。
// 所以本页收窄成**只取数、不判读**：
//   ① `wx.openChatTool` 让用户选定要绑定的会话（失败原文不判读，只转发）
//   ② `wx.getChatToolInfo` 取平台**原样返回**，塞进 `app.globalData.chatToolPickup`（内存桥，K5）
//   ③ （pick_friend，2026-09-25）`wx.selectGroupMembers` 取**双方 id 原样数组** —— 官方口径：单聊下
//      直接返回双方的 `group_openid`（**明文**，不弹选择器），而 `getChatToolInfo` 那条是**加密**的。
//      两条通道互相独立：一条读不到不影响另一条。折成"本地摘要键"的动作在主包（规则单源）。
//   ④ `wx.switchTab` 把人送去主包「用户档案」那一格（tab 页不许带参数 ⇒ 数据只走内存桥，不走 URL）
// 三态判读、失败分类、指纹脱敏、折键、拆三段、建档落库**全部留在主包** ⇒ 规则仍然只有一份。
//
// ⛔ 本页屏上不显示任何平台原文：`errMsg` 与"返回字段名"都可能带上会话标识（D3 / M11），
//    而能脱敏的那段代码在引不到的主包里。固定文案 + 把原文交给主包脱敏后显示，是这条约束下唯一安全的做法。
//
// 渲染栈（2026-09-25 三条预览读数一条条问出来的，全在 `chatpick/index.json` 与 `app.json` 的分包项里）：
//   `independent: true` → `renderer: "skyline"` → `componentFramework: "glass-easel"`。
//   官方口径：「Skyline 只支持 glass-easel 组件框架」「只推荐同时使用上述两个配置项，不要单独使用其中一个」
//   ⇒ 后两项**成对**出现，分包项与页面 json 各写一份（页面级是文档明列的合法层级，分包级是平台报错指的层级；
//   两处同值，改一处必须改另一处 —— 与 TD-015 ① 同一类"引不到主包导致的无法单源"）。
//
// ⚠️ 还有一条没撞过但官方文档写了的硬约束：**聊天工具分包页内不能用 navigateTo/redirectTo 跳去非聊天工具分包页**。
//   本页走的是 `switchTab`（官方明说"该分包也可被普通模式打开"，且这条拦截只点名了那两个接口），
//   真机若连 switchTab 一起拦，就走 `fail` 分支那句"手动点底部那一格" ⇒ 跟读项 U-9。
'use strict';

// 与 `app.json` 的 `chatTools[0].entryPagePath` 同一个值；两处必须一致。
// ⚠️ 2026-09-25 裁决删掉了原来守这一行的机器对帐 ⇒ 现在**只靠人核**（TD-014）。
const CHAT_TOOL_ENTRY = 'index';
// 底栏那一格的 tab 路径（值取自 `app.json` 的 `tabBar.list[1].pagePath`，改动时两处一起看 —— TD-013）。
const ARCHIVE_TAB_PATH = '/pages/archive-list/index';
// 看门狗：这台微信在个别版本上会给一个"既不 success 也不 fail"的读数，没有超时就把人永久困在这一页。
// ⚠️ 与 `utils/chat-tool.js` 的 `DEFAULT_TIMEOUT_MS` **同值、两处各写一份**——独立分包引不到主包，
//    单源做不到，登记成 TD-015（改阈值必须两处一起看）。
const READ_TIMEOUT_MS = 8000;

Page({
  data: {
    // 绑定状态行四种口径：**分开命名**是取证要求（三态混成一句"读取失败"就等于没取证）
    bindState: 'idle',
    bindText: '正在读取当前会话…',
    ready: false,   // 取到 / 取不到都算"可以走了"——不许把用户困在入口页
    busy: false,
    // **U-7 的读数行**：内存桥到底写没写进去，必须在这一屏看得见。
    // 拿不到 App 实例时，这一页一切"看起来正常"、主包却永远收不到会话信息 —— 静默断链比报错难查得多。
    bridgeText: '内存桥：还没写',
    // **U-11 的读数行**（pick_friend）：另一条通道（`selectGroupMembers`，官方口径是**明文**数组）
    // 到底给不给东西、给几个。它与上面那条加密通道**互相独立**，所以每次都单独试一次。
    pairText: '会话键：还没取',
    // 自画标题栏的两处尺寸（Skyline 页强制 `navigationStyle:"custom"` ⇒ 系统导航栏没了，得自己留白）：
    // `statusBarPx` = 状态栏高度；`capsuleRightPx` = 右上角胶囊占位（标题不许钻到它下面）
    statusBarPx: 20,
    capsuleRightPx: 100
  },

  // 内存桥的**唯一写入方**（K5）。刻意不放 `data`：放进 data 的任何东西都可能被 WXML 印到屏上（D3）。
  pickup: null,

  onLoad() {
    this.applyChrome();
    // 从聊天工具面板进来时上下文已经在，不该逼用户多点一次
    this.read('正在读取当前会话…');
  },

  // 自画标题栏的尺寸：能读到就按平台给的算，读不到退回保守缺省（20 / 100）。
  // ⛔ 不许因为"取不到尺寸"把整页卡住（AGENTS §11.4：外部依赖失败必须有分支，且不冒泡成整页失败）。
  applyChrome() {
    const patch = {};
    try {
      const win = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo()
        : (typeof wx.getSystemInfoSync === 'function' ? wx.getSystemInfoSync() : null);
      if (win && typeof win.statusBarHeight === 'number') patch.statusBarPx = win.statusBarHeight;
      const capsule = typeof wx.getMenuButtonBoundingClientRect === 'function'
        ? wx.getMenuButtonBoundingClientRect() : null;
      if (capsule && win && typeof capsule.left === 'number' && typeof win.windowWidth === 'number') {
        patch.capsuleRightPx = Math.max(0, win.windowWidth - capsule.left + 8);
      }
    } catch (err) {
      // 读不到只影响观感、不影响功能：保留缺省值即可
    }
    this.setData(patch);
  },

  onRetry() {
    if (this.data.busy) {
      wx.showToast({ title: '正在读取，先等它完成', icon: 'none' });   // 吞点击要说一声（R3-15 同口径）
      return;
    }
    this.read('正在重新读取当前会话…');
  },

  onEnterChatTool() {
    if (this.data.busy) {
      wx.showToast({ title: '正在读取，先等它完成', icon: 'none' });
      return;
    }
    if (!wx || typeof wx.openChatTool !== 'function') {
      this.writePickup({ bindErr: '这台微信没有 wx.openChatTool（基础库或主体不支持）' });
      this.setData({ bindState: 'unsupported', bindText: '这台微信不支持聊天工具模式 —— 照样能去建档，只是不会带上这个会话。', ready: true });
      return;
    }
    this.setData({ busy: true, bindState: 'idle', bindText: '请在微信里选择要绑定的会话…' });
    wx.openChatTool({
      url: CHAT_TOOL_ENTRY,
      success: () => { this.setData({ busy: false }); this.read('已绑定，正在读取会话标识…'); },
      fail: (err) => {
        // 原文只转发，不判读（分类规则在主包的 `chatTool.failureReasonOf`）
        this.writePickup({ bindErr: (err && err.errMsg) || '（平台没给 errMsg）' });
        this.setData({
          busy: false,
          ready: true,
          bindState: 'failed',
          bindText: '没能进入聊天工具模式 —— 可以直接去建档（只是不会带上这个会话）。'
        });
      }
    });
  },

  // 取会话标识：三态（没有键 / 有键但空 / 非空）**由主包判读**，这里只负责"拿到原样返回"或"记下失败原文"
  read(text) {
    const page = this;
    let done = false;
    let timer = null;
    this.setData({ busy: true, bindState: 'idle', bindText: text || '正在读取当前会话…' });

    const finish = (patch, view) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      page.writePickup(patch);
      const next = view || {};
      next.busy = false;
      next.ready = true;
      page.setData(next);
      // 两条通道互相独立：无论上面成败，都单独试一次取键（U-11 的读数不该被 U-5 的失败遮住）
      page.readPair();
    };

    if (!wx || typeof wx.getChatToolInfo !== 'function') {
      finish({ infoErr: '这台微信没有 wx.getChatToolInfo（基础库或主体不支持）' }, {
        bindState: 'unsupported',
        bindText: '这台微信读不到会话信息 —— 照样能去建档，只是"按会话自动归类"对它不生效。'
      });
      return;
    }
    timer = setTimeout(() => {
      finish({ infoErr: '读取会话标识超过 ' + READ_TIMEOUT_MS + ' 毫秒没有回应' }, {
        bindState: 'failed',
        bindText: '这台微信没有及时给出会话信息 —— 照样能去建档，只是不会带上这个会话。'
      });
    }, READ_TIMEOUT_MS);

    wx.getChatToolInfo({
      success: (res) => finish({ info: res }, {
        bindState: 'bound',
        bindText: '已取到当前会话，点下面「去建档」继续。'
      }),
      fail: (err) => finish({ infoErr: (err && err.errMsg) || '（平台没给 errMsg）' }, {
        bindState: 'failed',
        bindText: '没取到会话信息 —— 照样能去建档，只是"按会话自动归类"对它不生效。'
      })
    });
  },

  // 取双方标识（U-11 仪器）：单聊下官方口径是**直接返回双方** `group_openid`（明文数组、不弹选择器）；
  // 群聊下它会拉起成员选择器 ⇒ 本期不支持（SCOPE W1）。判读与折键都在主包（本页引不到 `utils/`）。
  // ⛔ 这一屏只出"取到几个 / 形态"，**绝不出原值**：原样数组只进内存桥（D3）。
  readPair() {
    const page = this;
    if (!wx || typeof wx.selectGroupMembers !== 'function') {
      page.writePickup({ membersErr: '这台微信没有 wx.selectGroupMembers（基础库或主体不支持）' });
      page.setData({ pairText: '会话键：这台微信没有取成员标识的接口' });
      return;
    }
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      page.writePickup({ membersErr: '取成员标识超过 ' + READ_TIMEOUT_MS + ' 毫秒没有回应' });
      page.setData({ pairText: '会话键：取成员标识超时（照样能建档）' });
    }, READ_TIMEOUT_MS);
    wx.selectGroupMembers({
      maxSelectCount: 1,
      success: (res) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        // 原样转发：`members` 是 D3，只进内存桥（进了 `data` 就可能被 WXML 印到屏上）
        page.writePickup({ members: res && res.members });
        const list = res && Array.isArray(res.members) ? res.members : null;
        page.setData({
          pairText: '会话键：' + (list ? '取到 ' + list.length + ' 个标识（形态交由主包判读）' : '返回里没有标识数组')
        });
      },
      fail: (err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        // 原文只转发（分类在主包）——本页屏上仍只出固定文案
        page.writePickup({ membersErr: (err && err.errMsg) || '（平台没给 errMsg）' });
        page.setData({ pairText: '会话键：没能取到成员标识（照样能建档）' });
      }
    });
  },

  // 只覆盖本轮真正拿到的字段：`bindErr` 与 `infoErr` 各留各的，别让后一次读数抹掉前一条证据
  writePickup(patch) {
    const base = this.pickup || { info: null, infoErr: '', bindErr: '', members: null, membersErr: '' };
    this.pickup = {
      at: Date.now(),
      info: patch && patch.info !== undefined ? patch.info : base.info,
      infoErr: patch && patch.infoErr ? patch.infoErr : base.infoErr,
      bindErr: patch && patch.bindErr ? patch.bindErr : base.bindErr,
      // pick_friend：`selectGroupMembers` 的原样 `members`（D3，与 `info` 同级别；消费一次即清）
      members: patch && patch.members !== undefined ? patch.members : base.members,
      membersErr: patch && patch.membersErr ? patch.membersErr : base.membersErr
    };
    const app = getApp();
    if (app && app.globalData) {
      app.globalData.chatToolPickup = this.pickup;
      this.setData({ bridgeText: '内存桥：通（已写入主包，第 ' + this.pickup.at + ' 毫秒那次）' });
    } else {
      // ⛔ 拿不到 App 实例 = N2 的内存桥断掉，U-7 的"不通"读数就长这样：
      //    分包页自己跑得挺好，主包什么也收不到。这一行是唯一能看出来的地方。
      this.setData({ bridgeText: '内存桥：断（拿不到 getApp().globalData ⇒ 主包收不到会话信息，U-7 不通）' });
    }
  },

  // 送去主包那一格建档案。`switchTab` 不能带参数（也不许带——K5 禁止 id 进 URL query），数据已经在内存桥里
  onGoForm() {
    if (!this.data.ready) {
      wx.showToast({ title: '先等这次读取完成', icon: 'none' });
      return;
    }
    wx.switchTab({
      url: ARCHIVE_TAB_PATH,
      fail: () => {
        // 跳不过去就直说，不假装"已经到了"（DESIGN §9 P5：界面不一致不等于可以撒谎）
        this.setData({
          bindState: 'failed',
          bindText: '没能自动跳过去 —— 手动点底部「用户档案」那一格也能建档（会话信息还在，不会丢）。'
        });
      }
    });
  }
});
