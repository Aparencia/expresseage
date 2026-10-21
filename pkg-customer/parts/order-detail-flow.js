// pkg-customer/parts/order-detail-flow.js · 订单详情数据编排（纯件，零 wx：页面只做 setData 与定时器）
// 职责：拉取 order.get → 组装视图（状态/进度/动作/截图/留言/时间线/提示条）；
//      轮询成功/失败的状态合并（失败保留旧数据、只更新顶部条与轮询策略），写动作返回 DTO 立即重绘。
// 口径：docs/V4_UX_CUSTOMER.md §3.8/§5/§8.1；AC-C-21~29/45/46；QA E17。
'use strict';

const view = require('./status-view');
const format = require('./format');
const poll = require('./poll-policy');

// 轮询失败只说真话并给下一步（不覆盖旧数据；E17「最近成功时间」由 lastUpdatedText 给）
const POLL_ERROR_COPY = '网络不稳定，正在重试…';
const NOT_FOUND_COPY = '没有找到这条订单，已回到订单列表。';

function createSession() {
  return {
    order: null,
    events: [],
    view: null,
    needCode: null,
    lastUpdatedAt: 0,
    everSucceeded: false,
    error: '',
    pollError: '',
    poll: poll.create()
  };
}

function sessionOf(session) {
  return session || createSession();
}

function hasEvent(events, type) {
  const list = Array.isArray(events) ? events : [];
  for (let i = 0; i < list.length; i += 1) {
    if (list[i] && list[i].type === type) return true;
  }
  return false;
}

/**
 * order DTO + 事件列表 → 页面渲染切片（页面只 setData，不再二次判断状态）。
 * @param {object} order 顾客侧 order DTO（含 status/statusText/actions[]/image{hasImage,cleaned}）
 * @param {object[]} events 事件 DTO 列表（{type,at,actorRole,note}）
 * @param {{readonly?:boolean, config?:object, codeFilled?:boolean}} options
 */
function buildView(order, events, options) {
  const opts = options || {};
  const codeFilled = opts.codeFilled === true && hasEvent(events, 'ORDER_CORRECTED');
  const events_ = view.buildEvents(events, { codeFilled: codeFilled });
  const eventList = events_.map(function map(item) {
    return {
      id: item.id,
      type: item.type,
      text: item.text,
      note: item.note,
      time: format.formatDateTime(item.at)
    };
  });
  const image = view.imageView(order);
  const progress = view.progressView(order);
  return {
    order: order,
    statusText: (order && order.statusText) || view.statusText(order && order.status),
    statusDesc: view.statusDesc(order),
    progress: progress,
    actions: view.actionsView(order, opts.readonly === true),
    cancelGuide: view.cancelGuide(order, opts.readonly === true),
    image: image,
    events: eventList,
    notice: view.noticeText(events),
    message: view.messageView(order, opts.readonly === true),
    exception: progress.mode === 'exception'
      ? { label: progress.branchLabel, text: progress.branchText }
      : null,
    waitingHint: view.waitingHint(order, opts.config || {}, format),
    pickupCodeText: view.pickupCodeText(order),
    codeFilled: codeFilled
  };
}

/**
 * 拉取一轮并合并轮询状态。
 * 成功：返回新视图 + 最近更新时间；失败：保留旧视图，首次失败给整页错误、轮询失败只给顶部条。
 * @returns {Promise<object>} 新 session（从不 reject：页面不需要 try/catch）
 */
async function refresh(session, deps) {
  const current = sessionOf(session);
  const base = deps || {};
  const nowMs = typeof base.now === 'function' ? base.now() : Date.now();
  try {
    const data = await base.getOrder({ orderNo: base.orderNo });
    const order = data && data.order ? data.order : null;
    if (!order) {
      const missing = new Error(NOT_FOUND_COPY);
      missing.code = 'NOT_FOUND';
      throw missing;
    }
    const events = Array.isArray(data.events) ? data.events : [];
    const previousNeedCode = current.needCode;
    const next = {
      order: order,
      events: events,
      view: buildView(order, events, {
        readonly: base.readonly === true,
        config: base.config || {},
        codeFilled: view.codeFilledTransition(previousNeedCode, order)
      }),
      needCode: order.needCode === true,
      lastUpdatedAt: nowMs,
      everSucceeded: true,
      error: '',
      pollError: '',
      poll: poll.onSuccess(current.poll)
    };
    return next;
  } catch (err) {
    const next = Object.assign({}, current);
    next.poll = poll.onFailure(current.poll);
    if (current.everSucceeded) {
      // 旧数据继续展示：只更新顶部条与「最近更新」时间
      next.error = '';
      next.pollError = POLL_ERROR_COPY;
    } else {
      next.error = (err && err.message) || '网络开小差了，请检查网络后重试';
    }
    return next;
  }
}

/**
 * 写动作成功后：用服务端返回 order 立即重绘（不空等下一次轮询；事件列表等下一轮补齐）。
 */
function applyOrder(session, order, options) {
  const current = sessionOf(session);
  if (!order) return current;
  const opts = options || {};
  const nowMs = typeof opts.now === 'function' ? opts.now() : Date.now();
  return Object.assign({}, current, {
    order: order,
    view: buildView(order, current.events, {
      readonly: opts.readonly === true,
      config: opts.config || {},
      codeFilled: view.codeFilledTransition(current.needCode, order)
    }),
    needCode: order.needCode === true,
    lastUpdatedAt: nowMs,
    everSucceeded: true,
    error: '',
    pollError: ''
  });
}

/** 「最近更新 HH:mm:ss」：只展示最近一次成功读数的时刻，不把旧数据冒充最新（E17） */
function lastUpdatedText(session) {
  const current = sessionOf(session);
  if (!current.everSucceeded || !current.lastUpdatedAt) return '';
  return '最近更新 ' + format.clock(current.lastUpdatedAt);
}

function startPoll(session) {
  return Object.assign({}, sessionOf(session), { poll: poll.start(sessionOf(session).poll) });
}

function stopPoll(session) {
  return Object.assign({}, sessionOf(session), { poll: poll.stop() });
}

/** 下一页排程间隔（ms）；0 = 不再排程（已 stop / 页面不可见） */
function pollDelay(session) {
  return poll.delayOf(sessionOf(session).poll);
}

function shouldPoll(session) {
  return poll.shouldPoll(sessionOf(session).poll);
}

module.exports = {
  POLL_ERROR_COPY,
  NOT_FOUND_COPY,
  createSession,
  buildView,
  refresh,
  applyOrder,
  lastUpdatedText,
  startPoll,
  stopPoll,
  pollDelay,
  shouldPoll
};
