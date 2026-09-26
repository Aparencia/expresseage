// pages/recognize/session-key-flow.js · 会话键的**取得 → 入槽 → 跨页交接**（2026-09-25 B 段）
//
// 为什么需要它：摘要槽 `globalData.chatKey` 原先**只有档案页一处写**（`pages/archive-list/index.js`
// 里"消费内存桥 → 折摘要 → 入槽"那一段）⇒ 从取件清单进来录件这条动线**结构上拿不到键**，
// 建档只能绑空键、M7 的按会话归类对它永远不生效。用户 2026-09-25 裁决
// **「A：给清单动线也加取键能力」** ⇒ 本文件把"取键"从档案页独占里解出来。
//
// 三条设计约束（都来自本项目既有裁决/教训，改这里前先读）：
//   ① **摘要入槽只许一处写**（`putSessionKey`）—— 同族纪律已在 `check.js` 立过"唯一写盘口"，
//      再分叉一个写点等于把那条纪律作废（本会话已因"两处写"吃过一次亏）；
//   ② 取键必须**离开本页**（`openChatTool` 进聊天工具模式），而分包页选完固定 `switchTab` 回**档案格**
//      （`switchTab` 不能带参）⇒ 回来时人不在出发的那一屏 ⇒ 必须记**意图**才能把他送回未完成的录件
//      （⛔ 不许静默把人扔在档案页：用户裁决里"不用离开这一屏"是常态，离开是被平台逼的，得自己接回来）；
//   ③ 意图与草稿**各消费一次**（`takePendingIntake` / `takeResume` 读后即清）且**都有 TTL**：
//      过期意图不许劫持下一次取键，草稿也不许在半小时后突然冒出来。
//
// D3 纪律：本文件只碰**摘要**（不可逆、允许上屏）；平台原值一个字符都不读、不写、不上屏。
'use strict';

const chatTool = require('../../utils/chat-tool.js');
const { reasonText } = require('../../utils/reason.js');   // 失败文案单源（⛔ 本文件不自己造句）
const sheetFlow = require('../archive-list/sheet-flow.js'); // url 轮盘单源（⛔ 不写第二份；跨页 require 有先例）
const formParts = require('./form-parts.js');               // 来源标记单源（`sourceOf`）

// ── 槽名与文案（单源；改字面量要同步 selftest §17）──────────────────────────
const SLOT_KEY = 'chatKey';              // 摘要槽（`app.js` 声明）
const SLOT_PENDING = 'pendingIntake';    // 取键意图**标志**（档案页消费一次）
const SLOT_RESUME = 'intakeResume';      // 未完成录件的**载荷**（录入页消费一次）
const SOURCE_LIST = 'list';              // 清单入口的来源标记（与 `list-parts.LIST_SOURCE` 同值）
const RESUME_FLAG = '1';                 // `?resume=1` 的约定值
const PENDING_TTL_MS = 10 * 60 * 1000;   // 意图/载荷只活 10 分钟
const HINT_TEXT = '正在拉起好友列表…稍等一下，或过一会儿再点一次';
const FAIL_PREFIX = '没取到会话键：';

/** 取 globalData 袋子（本文件与 `form-parts.hintBag` 同一条口径：注入优先，缺省回落 `getApp()`） */
function slotBag(app) {
  if (app && app.globalData) return app.globalData;
  if (typeof getApp === 'function') {
    const live = getApp();
    return live && live.globalData ? live.globalData : null;
  }
  return null;
}

/**
 * 摘要入槽 —— **全仓唯一写点**（`globalData.chatKey`）。
 * @param {object} app `getApp()` 的实例（注入便于测）
 * @param {string} key 摘要（16 位 hex）；非字符串 ⇒ 写空串（⛔ 不吐 undefined，也不回落原值槽）
 * @returns {string} 实际写进去的值
 */
function putSessionKey(app, key) {
  const bag = slotBag(app);
  const next = typeof key === 'string' ? key : '';
  if (!bag) return '';
  bag[SLOT_KEY] = next;
  return next;
}

/**
 * 记下"我要去取键、回来接着录件"：**标志 + 载荷**一起写（两个槽各有各的消费方，见文件头 ③）。
 * @param {{from?:string, draft?:object, drafts?:Array, recognitionUsed?:boolean}} intent
 * @param {number} [now] 时间戳（注入便于测 TTL）
 * @returns {object|null} 实际写入的载荷；没有 globalData ⇒ null（调用方据此放弃）
 */
function putPendingIntake(app, intent, now) {
  const bag = slotBag(app);
  if (!bag) return null;
  const src = intent || {};
  const at = typeof now === 'number' ? now : Date.now();
  const payload = {
    draft: src.draft || null,
    drafts: Array.isArray(src.drafts) ? src.drafts : [],
    recognitionUsed: src.recognitionUsed === true,
    at: at
  };
  bag[SLOT_PENDING] = {
    from: (typeof src.from === 'string' && src.from) ? src.from : SOURCE_LIST,
    at: at
  };
  bag[SLOT_RESUME] = payload;
  return payload;
}

/** 槽里那份还新鲜吗（统一 TTL 判定：过期就地清掉，返回 null） */
function freshOf(app, slot, now) {
  const bag = slotBag(app);
  const stored = bag ? bag[slot] : null;
  if (!stored || typeof stored !== 'object') return null;
  const at = typeof stored.at === 'number' ? stored.at : 0;
  const stamp = typeof now === 'number' ? now : Date.now();
  if (!at || (stamp - at) > PENDING_TTL_MS) {
    // 标志过期 ⇒ **两个槽一起清**（它俩是一起写的：只清标志会留下一个再也不会被读的草稿，
    // 而那个草稿万一被后来的 `?resume=1` 读到，就是半小时前的旧内容突然冒出来）
    if (slot === SLOT_PENDING) clearPendingIntake(app);
    else if (bag) bag[slot] = null;
    return null;
  }
  return stored;
}

/** 看一眼取键意图（**不消费**：档案页靠它决定"回不回头"） */
function peekPendingIntake(app, now) {
  return freshOf(app, SLOT_PENDING, now);
}

/** 消费取键意图（读后即清 ⇒ 同一个意图绝不会劫持两次） */
function takePendingIntake(app, now) {
  const found = freshOf(app, SLOT_PENDING, now);
  const bag = slotBag(app);
  if (bag) bag[SLOT_PENDING] = null;
  return found;
}

/** 消费未完成录件的载荷（录入页 `?resume=1` 时读它） */
function takeResume(app, now) {
  const found = freshOf(app, SLOT_RESUME, now);
  const bag = slotBag(app);
  if (bag) bag[SLOT_RESUME] = null;
  return found;
}

/** 清掉两个槽（取键最终失败、或人要重来时用） */
function clearPendingIntake(app) {
  const bag = slotBag(app);
  if (!bag) return;
  bag[SLOT_PENDING] = null;
  bag[SLOT_RESUME] = null;
}

/** 回录件那一屏的 URL（带来源与 resume 标记 —— `navigateTo` 能带参，与 `switchTab` 不同） */
function resumeUrl(from) {
  return '/pages/recognize/index?from=' + ((typeof from === 'string' && from) ? from : SOURCE_LIST)
    + '&resume=' + RESUME_FLAG;
}

/**
 * 键到手之后要不要把人送回录件那一屏（**纯判定**，不写槽、不导航）。
 * @returns {{redirect:boolean, url:string, from:string}} `redirect=false` ⇒ 走调用方原来的路
 */
function planResume(app, now) {
  const intent = peekPendingIntake(app, now);
  if (!intent) return { redirect: false, url: '', from: '' };
  return { redirect: true, url: resumeUrl(intent.from), from: intent.from };
}

/**
 * 档案页在"折出摘要"之后的落点：有人正等着这个键（在录件中途来取键的）⇒ 入槽并回那一屏。
 * **标志在这里被消费**（消费即清）⇒ 档案页自己的建档浮层不会被开出来打岔。
 * @param {object} wxApi 注入 `wx`（导航是副作用，必须可替换才测得了）
 * @returns {boolean} true = 已经接管（调用方**直接 return**，别再走建档/换绑那套）
 */
function resumeIfPending(app, key, wxApi, now) {
  const plan = planResume(app, now);
  if (!plan.redirect) return false;
  takePendingIntake(app, now);
  putSessionKey(app, key);
  if (wxApi && typeof wxApi.navigateTo === 'function') wxApi.navigateTo({ url: plan.url });
  return true;
}

/**
 * 录入页恢复未完成录件要写的 data 补丁（纯函数：只搬运，不做判断）。
 * ⛔ 只写这三个键 —— 与"内联新建浮层不碰 `draft.*`"同一条纪律：恢复动作不许把别的字段带歪。
 * @returns {{drafts:Array, patch:object}|null} 没有载荷 ⇒ null（页面什么都不做）
 */
function resumePatch(payload) {
  if (!payload) return null;
  return {
    drafts: payload.drafts || [],
    patch: {
      draft: payload.draft || { stationName: '', pickupCode: '', lockerNo: '', trackingTail: '' },
      recognitionUsed: payload.recognitionUsed === true,
      errorText: ''
    }
  };
}

// ── 页面侧（**方法混合件**：与档案页 `row-actions.js` 同一形态）────────────────
// 为什么住这里而不是页面里：页面层零断言（TD-016）⇒ "取键前记没记意图、失败后清没清、回来怎么恢复"
// 三条要是只写在页面里，两道门禁都是绿的（这正是"清单建档丢键"能漏到真机的原因）。
const pageMethods = {
  // 取键的重入闸与请求时刻（页面实例字段，不进 data：它们不是渲染状态）
  keyPicking: false,
  keyPickStartedAt: 0,

  /**
   * `onLoad` 里转发一句就行：记下来源标记 + （若是 `?resume=1`）把未完成的录件恢复出来。
   * ⛔ 恢复**不碰** `draft.*` 以外的任何东西（与浮层同一条纪律）。
   */
  applyResumeFromQuery(query) {
    this.intakeSource = formParts.sourceOf(query);
    const resumed = resumePatch(this.keyResumeOf(query));
    if (!resumed) return;
    this.applyDraftList(resumed.drafts);
    this.setData(resumed.patch);
    wx.showToast({ title: '已取到会话键 —— 接着录就行', icon: 'none' });
  },

  /** 从 URL 与槽里取"未完成录件"的载荷（`?resume=1` 才消费；否则不碰槽） */
  keyResumeOf(query) {
    if (!query || query.resume !== RESUME_FLAG) return null;
    const app = (typeof getApp === 'function') ? getApp() : null;
    return takeResume(app, Date.now());
  },

  /**
   * 「去取会话键」（用户裁决 A）：清单动线也能取键。
   * 顺序要紧：**先记意图**（含草稿）再发起 —— `openChatTool` 一旦成功，本页马上就不在了。
   */
  onFetchSessionKey() {
    const app = (typeof getApp === 'function') ? getApp() : null;
    const decision = sheetFlow.shouldStartPick(
      { picking: this.keyPicking, startedAt: this.keyPickStartedAt }, Date.now());
    if (!decision.start) { wx.showToast({ title: HINT_TEXT, icon: 'none' }); return; }
    this.keyPicking = true;
    this.keyPickStartedAt = Date.now();
    const stored = putPendingIntake(app, {
      from: this.intakeSource || SOURCE_LIST,
      draft: this.data.draft,
      drafts: this.data.drafts,
      recognitionUsed: this.data.recognitionUsed
    }, Date.now());
    if (!stored) { this.keyPicking = false; this.keyPickStartedAt = 0; return; }
    // 轮盘整段复用档案页那一份（三种 url 形态、有界、只在"url 不合法"时换下一个）
    sheetFlow.driveChatToolUrlWheel(
      (url) => chatTool.startChatPick({ url: url, setTimeout: setTimeout, clearTimeout: clearTimeout }),
      (result) => {
        this.keyPicking = false;
        this.keyPickStartedAt = 0;
        if (result && result.ok) return;   // 成功 = 已进聊天工具模式，剩下交给档案页 onShow 收桥
        // 最终失败：**清掉意图**（否则十分钟内下一次取键会被这条过期意图劫持）
        clearPendingIntake(app);
        wx.showToast({ title: FAIL_PREFIX + reasonText((result && result.reason) || 'CHAT_OPEN_FAILED'), icon: 'none' });
      });
  }
};

module.exports = {
  SLOT_KEY, SLOT_PENDING, SLOT_RESUME, SOURCE_LIST, RESUME_FLAG, PENDING_TTL_MS, HINT_TEXT, FAIL_PREFIX,
  putSessionKey, putPendingIntake, peekPendingIntake, takePendingIntake, takeResume,
  clearPendingIntake, resumeUrl, planResume, resumeIfPending, resumePatch, pageMethods
};
