// pkg-customer/pages/order-create/parts/pipeline.js · 受控并发 / 有序回填 / 流式就绪调度（P0-1 页面编排侧纯件，零 wx）
// 口径：PERFORMANCE_2026-11-01 §4.5/§5 P0-1——10 图「选图→识别完成」从 Σ 串行等待降到 max 级重叠：
//   ① 组件每批上传完成即把该图交给 createSession 识别（不等全部上传完成）；
//   ② 上传/识别/AI 兜底共用同一并发上限常量（单源，页面与测试都读这里，不写第二份数字）；
//   ③ 结果按 key/图序回填（完成先后不影响顺序），单图失败只降级该图、不阻塞其它图；
//   ④ 进度序号单调（monotonicIndex），并发阶段事件交错时也不倒退（D40「第 n/N 张」口径不变）。
'use strict';

const PIPELINE_CONCURRENCY = 2;

/** 并发上限：正整数；缺省/非法回落单源常量（不写死到调用方） */
function limitOf(raw) {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : PIPELINE_CONCURRENCY;
}

/** 实际并发：不超过任务数（0 个任务 = 0，不空转） */
function concurrencyOf(count, rawLimit) {
  const total = Math.max(0, Math.floor(Number(count) || 0));
  if (total === 0) return 0;
  return Math.max(1, Math.min(limitOf(rawLimit), total));
}

/** 流式会话的文件键：fileId 优先、无 fileId 用本地路径（同一张图不重复识别/不重复上传） */
function fileKeyOf(file) {
  const value = file || {};
  const key = value.fileId || value.localPath || '';
  return String(key);
}

/** 进度序号单调：并发下各图阶段事件交错时，n 只增不减（D40） */
function monotonicIndex(previous, next) {
  const before = Math.floor(Number(previous) || 0);
  const after = Math.floor(Number(next) || 0);
  return Math.max(before, after);
}

function newSessionState(options) {
  const opts = options || {};
  return {
    work: opts.work,
    keyOf: typeof opts.keyOf === 'function' ? opts.keyOf : fileKeyOf,
    limit: limitOf(opts.concurrency),
    onStart: typeof opts.onStart === 'function' ? opts.onStart : null,
    entries: Object.create(null),
    keys: [],
    queue: [],
    waiters: [],
    active: 0,
    started: 0
  };
}

function sessionStart(state, key) {
  const entry = state.entries[key];
  entry.state = 'running';
  state.active += 1;
  state.started += 1;
  if (state.onStart) {
    state.onStart({ key: key, item: entry.item, index: entry.index, started: state.started, seen: state.keys.length });
  }
  let task;
  try {
    task = Promise.resolve(state.work(entry.item, entry.index));
  } catch (err) {
    task = Promise.reject(err);
  }
  task.then(function done(value) {
    sessionSettle(state, key, { ok: true, value: value });
  }, function fail(error) {
    sessionSettle(state, key, { ok: false, error: error });
  });
}

function sessionPump(state) {
  while (state.active < state.limit && state.queue.length > 0) {
    sessionStart(state, state.queue.shift());
  }
}

function sessionWake(state) {
  if (state.queue.length > 0 || state.active > 0) return;
  state.waiters.splice(0).forEach(function each(resolve) { resolve(); });
}

function sessionSettle(state, key, outcome) {
  const entry = state.entries[key];
  entry.state = outcome.ok ? 'done' : 'failed';
  entry.outcome = outcome;
  state.active -= 1;
  sessionPump(state);
  sessionWake(state);
}

function sessionFeed(state, items) {
  const list = Array.isArray(items) ? items.filter(function present(item) { return item !== undefined && item !== null; }) : [];
  const added = [];
  list.forEach(function each(item) {
    const key = String(state.keyOf(item, state.keys.length) || '');
    if (!key || state.entries[key]) return;
    state.entries[key] = { key: key, item: item, index: state.keys.length, state: 'queued', outcome: null };
    state.keys.push(key);
    state.queue.push(key);
    added.push(key);
  });
  sessionPump(state);
  return { added: added, seen: state.keys.length, started: state.started };
}

function sessionSettleAll(state) {
  if (state.active === 0 && state.queue.length === 0) return Promise.resolve();
  return new Promise(function executor(resolve) { state.waiters.push(resolve); });
}

async function sessionFinish(state, items) {
  await sessionSettleAll(state);
  const list = Array.isArray(items) ? items.filter(function present(item) { return item !== undefined && item !== null; }) : [];
  const results = list.map(function align(item, index) {
    const entry = state.entries[String(state.keyOf(item, index) || '')];
    return entry ? entry.outcome : null;
  });
  const failed = state.keys.filter(function isFailed(key) {
    return state.entries[key].state === 'failed';
  }).length;
  return { results: results, seen: state.keys.length, started: state.started, failed: failed };
}

/**
 * 流式会话：可随时 feed 新就绪的图（上传完成一批喂一批），并发上限内立即开跑；
 * finish 时按传入顺序（= 页面 files 顺序）回填结果，未喂过的项返回 null。
 * @param {object} options {work(item,index)→Promise, keyOf, concurrency, onStart({key,item,index,started,seen})}
 */
function createSession(options) {
  const state = newSessionState(options);
  return {
    feed: function feed(items) { return sessionFeed(state, items); },
    settle: function settle() { return sessionSettleAll(state); },
    finish: function finish(items) { return sessionFinish(state, items); },
    stats: function stats() {
      return { seen: state.keys.length, started: state.started, active: state.active, queued: state.queue.length };
    }
  };
}

/**
 * 定量任务的有序并发（识别一批图用）：结果数组按入参下标回填，单任务失败不阻塞其它任务。
 * @param {Array} items 任务项
 * @param {function} worker (item, index) → Promise
 * @param {object} options {concurrency, onStart({index,item,started,total})}
 * @returns {Promise<{results:Array<{index,ok,value?,error?}>,total,concurrency,started,failed}>}
 */
async function runOrdered(items, worker, options) {
  const list = (Array.isArray(items) ? items : []).slice();
  const opts = options || {};
  const session = createSession({
    work: worker,
    keyOf: function indexKey(item, index) { return String(index); },
    concurrency: opts.concurrency,
    onStart: function onStart(info) {
      if (typeof opts.onStart !== 'function') return;
      opts.onStart({ index: info.index, item: info.item, started: info.started, total: info.seen });
    }
  });
  session.feed(list);
  const out = await session.finish(list);
  return {
    results: out.results,
    total: list.length,
    concurrency: concurrencyOf(list.length, opts.concurrency),
    started: out.started,
    failed: out.failed
  };
}

function limiterPump(state) {
  while (state.active < state.limit && state.queue.length > 0) {
    limiterRunNext(state, state.queue.shift());
  }
}

function limiterRunNext(state, job) {
  state.active += 1;
  Promise.resolve().then(job.task).then(function done(value) {
    state.active -= 1;
    job.resolve(value);
    limiterPump(state);
  }, function fail(error) {
    state.active -= 1;
    job.reject(error);
    limiterPump(state);
  });
}

/**
 * 全局并发闸（跨图/跨批共享）：AI 兜底外呼按件并行时用，保证全局同时在飞的调用 ≤ limit。
 * @param {number} rawLimit 上限（缺省=单源常量 2）
 * @returns {{run:function(task):Promise, limit:number}}
 */
function createLimiter(rawLimit) {
  const state = { limit: limitOf(rawLimit), active: 0, queue: [] };
  return {
    limit: state.limit,
    run: function run(task) {
      return new Promise(function executor(resolve, reject) {
        state.queue.push({ task: task, resolve: resolve, reject: reject });
        limiterPump(state);
      });
    }
  };
}

module.exports = {
  PIPELINE_CONCURRENCY,
  fileKeyOf,
  monotonicIndex,
  runOrdered,
  createSession,
  createLimiter
};
