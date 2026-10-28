// pkg-customer/pages/bind/parts/auto-bind.js · 邀请卡落地自动绑定决策（D38）纯件：零 wx、零页面状态
// 口径：CONTRACT §4.2 ⑨ / D38（2026-10-28 用户拍板 3「隐私同意、资料完成后直接绑定，不再要求手动确认」）：
//   - `?bind=CODE&auto=1` 由邀请卡/资料保存后续跳带入；落地「预检 bind.getCurrent + 预览成功」后
//     自动发起**一次** bind.create（不自动重试）；
//   - 已绑定同号 → 只提示「已绑定·去下单」，绝不重复 create；
//   - 已绑定异号 → 仍按 D28 一次确认换绑（不静默解绑、不替用户点）；
//   - 预检失败/未就绪 → 不动（转人工「查询」/「确认绑定」），错误原样上抛给页面展示。
// 边界：仍由顾客本人 openid 发起，隐私同意/资料完整/自绑/测试隔离/限流全部由服务端校验，本件只做客户端编排。
// 拆成模块级小函数（单函数 ≤50 行，门禁 #32）：状态放在 create 内，操作函数只吃 state/deps。
'use strict';

const previewCache = require('../../../../utils/preview-cache');

const PLAN = Object.freeze({
  NONE: 'none', // 非邀请卡自动落地：保持手动确认
  WAIT: 'wait', // 预览或预检未就绪：等待，不动作
  SAME: 'same', // 已绑定同号：提示去下单，零 create
  REBIND: 'rebind', // 已绑定异号：D28 一次确认换绑
  CREATE: 'create' // 未绑定：自动 create 一次
});

// 文案单源（页面经 data 透传给 wxml，不在模板里再写一份）
const AUTO_LOADING_TEXT = '正在绑定…';
const ALREADY_BOUND_TEXT = '已绑定·去下单';
const GO_ORDER_TEXT = '去下单';
const ACTION_PLANS = [PLAN.CREATE, PLAN.SAME, PLAN.REBIND];

function noop() {}

function pick(options, key) {
  return typeof options[key] === 'function' ? options[key] : noop;
}

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function objectOf(value) {
  return value && typeof value === 'object' ? value : null;
}

// bind.getCurrent 响应形状 → 当前绑定的兼职编号（无绑定/无公开资料时为空串）
function partnerNoOf(current) {
  const payload = objectOf(current);
  const partnerPublic = payload ? objectOf(payload.partnerPublic) : null;
  return textOf(partnerPublic && partnerPublic.partnerNo);
}

function boundOf(current) {
  const payload = objectOf(current);
  return !!(payload && objectOf(payload.binding));
}

// 计划单源：auto=1 且预览 + 预检都就绪才动作；返回 PLAN 常量（页面零判据）。
// 编号归一同 utils/ids（P+6，容错连字符/空格/全角）：与绑定页 canonical、getPublic 返回口径一致。
function planOf(input) {
  const opts = input || {};
  const target = previewCache.canonicalOf(opts.partnerNo);
  if (opts.auto !== true || !target) {
    return PLAN.NONE;
  }
  if (opts.prechecked !== true || opts.hasPreview !== true) {
    return PLAN.WAIT;
  }
  const current = objectOf(opts.current);
  if (!boundOf(current)) {
    return PLAN.CREATE;
  }
  return partnerNoOf(current) === target ? PLAN.SAME : PLAN.REBIND;
}

function resolveDeps(options) {
  const opts = options || {};
  return {
    auto: opts.auto === true,
    current: typeof opts.current === 'function' ? opts.current : null,
    onCreate: pick(opts, 'onCreate'),
    onSame: pick(opts, 'onSame'),
    onRebind: pick(opts, 'onRebind'),
    onError: pick(opts, 'onError')
  };
}

function newState() {
  return {
    checkStarted: false,
    prechecked: false,
    failed: false,
    done: false,
    disposed: false,
    previewNo: '',
    current: null
  };
}

// 计划就绪才执行，且只执行一次（自动绑定绝不重复 create）
function evaluate(state, deps) {
  if (state.done || state.failed || state.disposed) {
    return PLAN.NONE;
  }
  const plan = planOf({
    auto: deps.auto,
    partnerNo: state.previewNo,
    hasPreview: state.previewNo !== '',
    prechecked: state.prechecked,
    current: state.current
  });
  if (ACTION_PLANS.indexOf(plan) < 0) {
    return plan;
  }
  state.done = true;
  if (plan === PLAN.CREATE) {
    deps.onCreate(state.previewNo);
  } else if (plan === PLAN.SAME) {
    deps.onSame(state.current);
  } else {
    deps.onRebind(state.current);
  }
  return plan;
}

function precheckDone(state, deps, data) {
  if (state.disposed) {
    return;
  }
  state.prechecked = true;
  state.current = objectOf(data);
  evaluate(state, deps);
}

function precheckFailed(state, deps, error) {
  if (state.disposed) {
    return;
  }
  state.prechecked = true;
  state.failed = true;
  deps.onError(error);
}

// 落地即预检一次（读，不走写限流）；成功后若预览已就绪会立刻执行计划
function startPrecheck(state, deps) {
  if (!deps.auto || state.checkStarted) {
    return;
  }
  state.checkStarted = true;
  if (!deps.current) {
    state.prechecked = true;
    evaluate(state, deps);
    return;
  }
  Promise.resolve().then(function ask() {
    return deps.current();
  }).then(function done(data) {
    precheckDone(state, deps, data);
  }, function failed(error) {
    precheckFailed(state, deps, error);
  });
}

// 预览成功（缓存命中/网络返回都会调）；返回当前计划，便于页面/测试断言
function onPreviewReady(state, deps, partnerNo) {
  state.previewNo = previewCache.canonicalOf(partnerNo);
  return evaluate(state, deps);
}

// 注入式编排：current()/onCreate()/onSame()/onRebind()/onError() 由页面提供，本件零 wx、可脱离小程序单测。
function create(options) {
  const deps = resolveDeps(options);
  const state = newState();
  return {
    arm: function arm() {
      startPrecheck(state, deps);
    },
    previewReady: function previewReady(partnerNo) {
      return onPreviewReady(state, deps, partnerNo);
    },
    dispose: function dispose() {
      state.disposed = true;
    }
  };
}

module.exports = {
  PLAN,
  AUTO_LOADING_TEXT,
  ALREADY_BOUND_TEXT,
  GO_ORDER_TEXT,
  partnerNoOf,
  planOf,
  create
};
