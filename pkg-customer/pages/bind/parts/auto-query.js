// pkg-customer/pages/bind/parts/auto-query.js · 绑定页自动查询状态机（纯件：零 wx；时钟/调度/网络全部注入）
// 口径：V4_UX_CUSTOMER §3.6「300ms 防抖自动查询」+ 批 10 A 批 P1-2 + CONTRACT D39（2026-10-28）：
//   - 合法完整编号即自动查（落地预填 = 0 次「查询」点击）；编号不全/错前缀一律不发请求；
//   - 300ms 防抖：连续输入只查最后一次；**自动查询只对新编号触发**（同编号已有预览/失败/在途不重复查）；
//   - 失败不自动重试同编号、不循环；手动「查询」（onManual）是唯一恢复口；
//   - **同编号 60 秒内复用已有预览**（不再发第二次 getPublic）；请求在途时连点只复用同一次请求；
//   - 落地优先 take 角色页预览缓存（0 请求），未命中才自动 query。
// 拆成模块级小函数（单函数 ≤50 行，门禁 #32）：状态放在 create 内，操作函数只吃 state/deps。
'use strict';

const previewCache = require('../../../../utils/preview-cache');

const DEBOUNCE_MS = 300;
// D39：同编号预览 60 秒内不重复查询（与限流 60 秒分片同口径，避免白耗一次尝试额度）
const SAME_NO_REUSE_MS = 60 * 1000;

function noop() {}

function pick(options, key, fallback) {
  return typeof options[key] === 'function' ? options[key] : fallback;
}

// 依赖归一：只注入 query，其余（时钟/调度/回调）都有安全默认值
function normalizeDeps(options) {
  const opts = options || {};
  if (typeof opts.query !== 'function') {
    throw new Error('auto-query 需要注入 query');
  }
  return {
    query: opts.query,
    now: pick(opts, 'now', function () { return Date.now(); }),
    schedule: pick(opts, 'schedule', function (fn, ms) { return setTimeout(fn, ms); }),
    cancel: pick(opts, 'cancel', function (timer) { clearTimeout(timer); }),
    onLoading: pick(opts, 'onLoading', noop),
    onPreview: pick(opts, 'onPreview', noop),
    onError: pick(opts, 'onError', noop)
  };
}

function newState() {
  return {
    timer: null,
    seq: 0,
    pendingNo: '',
    pendingPromise: null,
    previewNo: '',
    previewAt: 0,
    previewData: null,
    failedNo: '',
    disposed: false
  };
}

function stop(state, deps) {
  if (state.timer !== null) {
    deps.cancel(state.timer);
    state.timer = null;
  }
}

function apply(state, deps, partnerNo, data, cached) {
  state.previewNo = partnerNo;
  state.previewAt = deps.now();
  state.previewData = data;
  state.failedNo = '';
  state.pendingNo = '';
  deps.onLoading(false);
  deps.onPreview(data, { partnerNo: partnerNo, cached: cached });
}

// 立即请求：seq 作废旧在途响应（输入换号后旧响应不得覆盖新预览）
function request(state, deps, partnerNo, manual) {
  stop(state, deps);
  state.seq += 1;
  const requestSeq = state.seq;
  state.pendingNo = partnerNo;
  deps.onLoading(true);
  const promise = Promise.resolve().then(function run() {
    return deps.query(partnerNo);
  }).then(function done(data) {
    if (state.pendingPromise === promise) {
      state.pendingPromise = null;
    }
    if (state.disposed || requestSeq !== state.seq) {
      return null;
    }
    apply(state, deps, partnerNo, data, false);
    return data;
  }).catch(function failed(err) {
    if (state.pendingPromise === promise) {
      state.pendingPromise = null;
    }
    if (state.disposed || requestSeq !== state.seq) {
      return null;
    }
    state.pendingNo = '';
    if (!manual) {
      state.failedNo = partnerNo;
    }
    deps.onLoading(false);
    deps.onError(err, { partnerNo: partnerNo, manual: manual });
    return null;
  });
  state.pendingPromise = promise;
  return promise;
}

function autoQuery(state, deps, partnerNo) {
  const cached = previewCache.take(partnerNo, deps.now());
  if (cached) {
    state.seq += 1; // 缓存命中作废在途响应，避免旧响应覆盖缓存预览
    apply(state, deps, partnerNo, cached, true);
    return 'cache';
  }
  state.timer = deps.schedule(function onDebounce() {
    state.timer = null;
    request(state, deps, partnerNo, false);
  }, DEBOUNCE_MS);
  return 'debounce';
}

// 输入/落地预填：返回 'cache' | 'debounce' | 'failed' | 'done' | 'pending' | 'none'
function handleInput(state, deps, raw) {
  stop(state, deps);
  const partnerNo = previewCache.canonicalOf(raw);
  if (state.disposed || !partnerNo) {
    return 'none';
  }
  if (partnerNo === state.failedNo) {
    return 'failed';
  }
  if (partnerNo === state.previewNo) {
    return 'done';
  }
  if (partnerNo === state.pendingNo) {
    return 'pending';
  }
  return autoQuery(state, deps, partnerNo);
}

// 手动「查询」：失败后唯一恢复口（重置失败标记、立即请求，不再等防抖）
// D39：请求在途时连点只复用同一次请求；同编号预览 60 秒内直接复用（不发第二次 getPublic）。
function handleManual(state, deps, raw) {
  stop(state, deps);
  const partnerNo = previewCache.canonicalOf(raw);
  if (state.disposed || !partnerNo) {
    return Promise.resolve(null);
  }
  if (partnerNo === state.pendingNo && state.pendingPromise) {
    return state.pendingPromise;
  }
  if (partnerNo === state.previewNo && state.previewAt > 0
    && deps.now() - state.previewAt < SAME_NO_REUSE_MS) {
    state.seq += 1; // 作废旧在途响应，避免旧编号响应覆盖正在展示的预览
    return Promise.resolve(state.previewData);
  }
  state.failedNo = '';
  return request(state, deps, partnerNo, true);
}

function disposeState(state, deps) {
  state.disposed = true;
  stop(state, deps);
  state.seq += 1;
}

function create(options) {
  const deps = normalizeDeps(options);
  const state = newState();
  return {
    onInput(raw) {
      return handleInput(state, deps, raw);
    },
    onManual(raw) {
      return handleManual(state, deps, raw);
    },
    dispose() {
      disposeState(state, deps);
    }
  };
}

module.exports = {
  DEBOUNCE_MS,
  SAME_NO_REUSE_MS,
  create
};
