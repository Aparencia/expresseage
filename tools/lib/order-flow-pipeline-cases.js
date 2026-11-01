'use strict';
/**
 * tools/lib/order-flow-pipeline-cases.js — selftest-order-flow P 组用例表（性能 P0-1 顾客下单流水线化：
 * 组件渐进上传事件 + 页面编排侧重叠调度），拆出以控测试文件 ≤1000 行（门禁 #18）。
 * 非独立套件：由 tools/selftest-order-flow.js require 后在其 P section 内调用。
 *
 * 口径：PERFORMANCE_2026-11-01 §4.5/§5 P0-1（10 图选图→识别完成从「Σ 串行等待」降到「max 级重叠」）、
 *      §7 P0-1 观察点（墙钟/内存峰值 + 失败重试仍可用、幂等键不重复）。
 * 纪律：纯件断言（零 wx、不依赖真机时序，用 deferred 控制完成顺序）；先首红后复绿；样本非空。
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const enums = require(path.join(ROOT, 'shared/enums.js'));

/** 新纯件允许「实现前不存在」：缺失返回 null，由断言显式判红（不 crash 整套） */
function tryRequire(rel) {
  try {
    return require(path.join(ROOT, rel));
  } catch (err) {
    return null;
  }
}

const pipeline = tryRequire('pkg-customer/pages/order-create/parts/pipeline.js');
const aggregate = tryRequire('pkg-customer/pages/order-create/parts/recognize-aggregate.js');

function deferred() {
  const box = {};
  box.promise = new Promise(function executor(resolve, reject) {
    box.resolve = resolve;
    box.reject = reject;
  });
  return box;
}

function flush() {
  return new Promise(function executor(resolve) {
    setTimeout(resolve, 0);
  });
}

function fileOf(seq) {
  return {
    fileId: 'cloud://test.env/orders/TKT/image-' + seq + '.jpg',
    localPath: 'wxfile://tmp/ticket-' + seq + '.jpg',
    uploadTicketId: 'TICKET' + String(seq).padStart(26, '0')
  };
}


function pipelineItemOf(extra, serviceCode) {
  // 避免依赖 deps 传递 model：这里只造「缺取件码、有站点」的件
  return Object.assign({
    stationId: 'P3', stationName: '西苑一栋南面菜鸟驿站', pickupCode: '', trackingTail: '',
    lockerNo: '', serviceCode: serviceCode, checked: true, manual: false, imageIndex: 0
  }, extra || {});
}

async function drainGates(gates, suggestionOf, isDone) {
  let guard = 0;
  while (!isDone() && guard < 200) {
    guard += 1;
    const pending = gates.filter(function open(entry) { return !entry.resolved; });
    pending.reverse().forEach(function fire(entry) {
      entry.resolved = true;
      entry.gate.resolve(suggestionOf(entry));
    });
    await flush();
  }
  return guard < 200;
}

/** runOrdered：并发上限/乱序回填/失败隔离/进度单调（占 P3~P7） */
async function orderedChecks(t) {
  const gates = [];
  const startedOrder = [];
  const startSeq = [];
  let active = 0;
  let maxActive = 0;
  let done = false;
  let outcome = null;
  if (pipeline && typeof pipeline.runOrdered === 'function') {
    pipeline.runOrdered([0, 1, 2, 3, 4, 5], function worker(item, index) {
      startedOrder.push(index);
      active += 1;
      maxActive = Math.max(maxActive, active);
      const gate = deferred();
      gates.push({ index: index, gate: gate });
      return gate.promise.then(function settled(value) {
        active -= 1;
        return value;
      });
    }, {
      concurrency: 2,
      onStart: function onStart(info) { startSeq.push(info.started); }
    }).then(function done2(out) { outcome = out; done = true; });
  }
  await flush();
  t.check(!!pipeline && typeof pipeline.runOrdered === 'function',
    'P1 新纯件 pipeline.runOrdered 存在（P0-1 页面编排侧基线）');
  t.check(maxActive === 2 && active === 2 && startedOrder.length === 2,
    'P2 识别/上传并发上限 2（首批只启动 2 个；旧实现逐图串行 maxActive=1）');
  // 乱序完成：先完成第 2 张再完成第 1 张，结果仍按 index 回填
  if (gates[1]) gates[1].gate.resolve('v1');
  await flush();
  if (gates[0]) gates[0].gate.resolve('v0');
  await flush();
  const drained = await drainGates(gates, function valueOf(entry) { return 'v' + entry.index; }, function isDone() { return done; });
  t.check(drained && done && outcome && outcome.results.length === 6
    && outcome.results[0].value === 'v0' && outcome.results[1].value === 'v1'
    && outcome.results.map(function value(out) { return out.value; }).join(',') === 'v0,v1,v2,v3,v4,v5',
  'P3 乱序完成按图序回填（imageIndex 顺序稳定，不因完成先后错位）');
  t.check(done && startSeq.length === 6 && startSeq.join(',') === '1,2,3,4,5,6',
    'P4 进度序号单调 1..N（并发下不倒退，D40「第 n/N 张」口径）');

  let failOut = null;
  if (pipeline && typeof pipeline.runOrdered === 'function') {
    failOut = await pipeline.runOrdered([0, 1, 2], function worker(item, index) {
      if (index === 1) return Promise.reject(new Error('boom'));
      return Promise.resolve('ok' + index);
    }, { concurrency: 2 });
  }
  t.check(!!failOut && failOut.results[1].ok === false
    && failOut.results[0].ok === true && failOut.results[2].ok === true && failOut.failed === 1,
  'P5 单图失败不阻塞其它图（失败只降级该图，failed 计数=1）');
  t.check(!pipeline || (pipeline.monotonicIndex(3, 1) === 3 && pipeline.monotonicIndex(1, 4) === 4),
    'P6 monotonicIndex 钳制（并发阶段事件交错时不倒退）');
}

/** createSession：流式就绪（每图上传完成即识别）/去重/顺序回填/失败隔离（占 P7~P12） */
async function sessionChecks(t) {
  const gates = [];
  const startSeq = [];
  let active = 0;
  let maxActive = 0;
  const session = pipeline && typeof pipeline.createSession === 'function' ? pipeline.createSession({
    concurrency: 2,
    keyOf: pipeline.fileKeyOf,
    onStart: function onStart(info) {
      startSeq.push(info.started);
      active += 1;
      maxActive = Math.max(maxActive, active);
    },
    work: function work(file) {
      const gate = deferred();
      gates.push({ key: file.fileId, gate: gate, file: file });
      return gate.promise.then(function settled(value) {
        active -= 1;
        return value;
      });
    }
  }) : null;

  const firstFeed = session ? session.feed([fileOf(1), fileOf(2)]) : { added: [] };
  t.check(!!session && firstFeed.added.length === 2 && startSeq.length === 2,
    'P7 流式就绪：第一批两图上传完成即开始识别（不等第二批上传完成）');
  const repeatFeed = session ? session.feed([fileOf(1), fileOf(2), fileOf(3), fileOf(4)]) : { added: [] };
  t.check(!!session && repeatFeed.added.length === 2,
    'P8 重复/累计事件按 fileId 去重（同一张图不重复识别、不重复上传票据）');
  if (gates[0]) gates[0].gate.resolve(gates[0].file.fileId);
  await flush();
  t.check(startSeq.length === 3,
    'P9 第二批未完成前，前一张识别完成即启动下一张（重叠流水线，非全量等待）');
  t.check(maxActive <= 2,
    'P10 流式会话并发上限 2（不因多批叠加超限）');

  let finished = null;
  const finishOrder = [fileOf(2), fileOf(4), fileOf(1), fileOf(3)];
  const finishPromise = session ? session.finish(finishOrder).then(function done(out) { finished = out; }) : Promise.resolve();
  await drainGates(gates, function valueOf(entry) { return entry.file.fileId; },
    function isDone() { return !!finished; });
  await finishPromise;
  t.check(!!finished && finished.results.length === 4
    && finished.results.map(function value(out) { return out && out.value; }).join(',') === finishOrder.map(function id(f) { return f.fileId; }).join(','),
  'P11 收口结果按图序回填（finish 入参顺序即页面 files 顺序，重复事件不错位）');
  t.check(startSeq.length === 4 && startSeq.join(',') === '1,2,3,4',
    'P12 跨批进度序号仍单调 1..4（页面进度不倒退）');

  let failingSession = null;
  if (pipeline && typeof pipeline.createSession === 'function') {
    failingSession = pipeline.createSession({
      concurrency: 2,
      keyOf: pipeline.fileKeyOf,
      work: function work(file) {
        if (file.fileId.indexOf('image-2') >= 0) return Promise.reject(new Error('ocr boom'));
        return Promise.resolve(file.fileId);
      }
    });
    failingSession.feed([fileOf(1), fileOf(2), fileOf(3)]);
  }
  const failedOut = failingSession ? await failingSession.finish([fileOf(1), fileOf(2), fileOf(3)]) : null;
  t.check(!!failedOut && failedOut.results[1].ok === false && failedOut.results[0].ok === true
    && failedOut.results[2].ok === true && failedOut.failed === 1,
  'P13 流式会话单图失败不阻塞收口（其余图照常出结果）');
}

/** 组件渐进上传事件：state 纯件快照 + 组件接线 + change/error 时机不变（占 P14~P18） */
function componentChecks(t, deps) {
  const pickerState = deps.pickerState;
  const textOf = deps.textOf;
  const pickerSrc = textOf('components/image-picker/index.js');
  const pickerStateSrc = textOf('components/image-picker/state.js');
  const stateFn = 'uploadSnapshotOf';
  const oldFile = { fileId: 'cloud://test.env/orders/TKT/old.jpg', localPath: 'wxfile://tmp/old.jpg' };
  const newFile = { fileId: 'cloud://test.env/orders/TKT/new.jpg', localPath: 'wxfile://tmp/new.jpg' };
  const fn = pickerState && typeof pickerState[stateFn] === 'function' ? pickerState[stateFn] : null;
  const snap1 = fn ? fn([], [oldFile], 5) : null;
  const snap2 = fn ? fn([], [oldFile, newFile], 5) : null;
  t.check(!!fn && snap1.length === 1 && snap2.length === 2
    && snap2[0].fileId === oldFile.fileId && snap2[1].fileId === newFile.fileId,
  'P14 渐进事件快照纯件：每批累计文件单调增（与最终 change 同源，不漏图）');
  const replaced = fn ? fn([oldFile], [newFile], 1) : null;
  t.check(!!replaced && replaced.length === 1 && replaced[0].fileId === newFile.fileId,
    'P15 单图模式换图：渐进快照=新图（旧图不计入，P1-4 换图口径不变）');
  const uploadedCount = (pickerSrc.match(/triggerEvent\('uploaded'/g) || []).length;
  const changeCount = (pickerSrc.match(/triggerEvent\('change'/g) || []).length;
  const uploadedAt = pickerSrc.indexOf("triggerEvent('uploaded'");
  const changeAt = pickerSrc.indexOf("triggerEvent('change'");
  t.check(uploadedCount === 1 && uploadedAt >= 0 && (changeCount === 1 || pickerSrc.indexOf('clear()') >= 0),
    'P16 组件每批上传完成触发 uploaded 事件（单处；既有 change/limit/error 事件不拆散）');
  t.check(uploadedAt >= 0 && changeAt > 0
    && pickerSrc.indexOf('this.emitUploaded(uploadedFiles)') < pickerSrc.indexOf("triggerEvent('change'"),
  'P17 uploaded 在批次内触发、change 仍在全部批次结束后一次触发（顾客端/代客端既有消费不变）');
  const plan10 = pickerState.uploadPlanOf(10);
  t.check(plan10.batches.length === 5 && plan10.batches.every(function batch(b) { return b.length <= 2; })
    && pickerSrc.indexOf('for (let round = 0; round < plan.batches.length; round += 1)') >= 0,
  'P18 每批上传完成即发一次 uploaded（并发 2 → 10 图 5 批 5 次；批大小 ≤2）');
  t.check(pickerStateSrc.indexOf(stateFn) >= 0 && pickerSrc.indexOf(stateFn) >= 0,
    'P19 快照纯件单源接线（state.js 定义 + 组件 index.js 消费）');
}

/** 页面编排接线：ocr-flow 并发/汇总拆分 + files-flow 流式会话 + 页面/WXML 只接线（占 P20~P26） */
function wiringChecks(t, deps) {
  const textOf = deps.textOf;
  const ocrFlow = deps.ocrFlow;
  const ocrSrc = textOf('pkg-customer/pages/order-create/parts/ocr-flow.js');
  const flowSrc = textOf('pkg-customer/pages/order-create/parts/files-flow.js');
  const modelSrc = textOf('pkg-customer/pages/order-create/parts/model.js');
  const pageSrc = textOf('pkg-customer/pages/order-create/index.js');
  const xml = textOf('pkg-customer/pages/order-create/index.wxml');
  t.check(!!ocrFlow && typeof ocrFlow.createIdentifySession === 'function'
    && !!aggregate && typeof aggregate.summarize === 'function',
  'P20 ocr-flow 导出流式识别会话 + 识别汇总拆为纯件（同一口径给全量与流式两条路径）');
  t.check(ocrSrc.indexOf('pipeline.runOrdered(') >= 0 && ocrSrc.indexOf('pipeline.createSession(') >= 0
    && ocrSrc.indexOf('pipeline.PIPELINE_CONCURRENCY') >= 0,
  'P21 多图识别接流水线（runOrdered 全量 / createSession 流式 / 并发常量单源）');
  t.check(!/for \(let i = 0; i < list\.length; i \+= 1\) \{[\s\S]{0,160}?await identify\(/.test(ocrSrc),
    'P22 旧「逐图串行等待」实现已移除（Σ → 并发上限 2）');
  t.check(modelSrc.indexOf('pipeline.createLimiter(') >= 0 && modelSrc.indexOf('pipeline.PIPELINE_CONCURRENCY') >= 0,
    'P23 AI 兜底按件并行接全局并发闸（上限 2 单源；跨图/跨批共享，顺带回填按件序）');
  t.check(flowSrc.indexOf('ocrFlow.createIdentifySession(') >= 0
    && flowSrc.indexOf('_ocrSession') >= 0 && flowSrc.indexOf('onUploaded') >= 0,
  'P24 files-flow 消费 uploaded：新到图入会话立即识别（页面零判据，编排在 parts/）');
  t.check(/onUploaded\(e\) \{\s*filesFlow\.onUploaded\(this, e\);\s*\}/.test(pageSrc)
    && xml.indexOf('bind:uploaded="onUploaded"') >= 0,
  'P25 页面只接线：WXML bind:uploaded → page.onUploaded 一行转发（页面零业务判据）');
  t.check(flowSrc.indexOf('discardSession(page)') >= 0
    && flowSrc.indexOf('discardSession(page)') < flowSrc.indexOf('createIdentifySession('),
  'P26 重新识别/失败卡路径先丢弃旧会话（失败后可重试，不重复 ticket/幂等键不变）');
  t.check((flowSrc.match(/queueRun\(page,/g) || []).length >= 3 && flowSrc.indexOf('_ocrChain') >= 0,
    'P26b 两轮识别收口串行化（并发选图/重新识别不并发改 items/perImage，防乱序/重复件）');
}

/** 逐件 AI 兜底并行：首轮同时外呼 2 件 / 乱序完成按件序回填 / 全局上限（占 P27~P29） */
async function aiParallelChecks(t, deps) {
  const model = deps.model;
  const ctx = { ocrTextMasked: '取件码 1234', hintTrackingTail: '', uploadTicketId: 'TICKET' + '0'.repeat(26), role: 'CUSTOMER' };
  const itemOf = function itemOf(tail) {
    return Object.assign(pipelineItemOf({ stationId: 'P3', trackingTail: tail }, enums.SERVICE_CODES[0]), {});
  };
  const gates = [];
  let active = 0;
  let maxActive = 0;
  let done = false;
  let outcome = null;
  const stub = function stub(payload) {
    active += 1;
    maxActive = Math.max(maxActive, active);
    const gate = deferred();
    gates.push({ payload: payload, gate: gate });
    return gate.promise.then(function settled(value) {
      active -= 1;
      return value;
    });
  };
  const items = [itemOf('T0'), itemOf('T1'), itemOf('T2')];
  model.applyAiFallbacks(items, ctx, stub).then(function done2(out) { outcome = out; done = true; });
  await flush();
  t.check(gates.length === 2,
    'P27 逐件 AI 兜底首轮同时外呼 2 件（旧实现串行：首轮只有 1 件在飞）');
  const suggestionOf = function suggestionOf(entry) {
    const tail = (entry.payload && entry.payload.hintTrackingTail) || 'T9';
    const seq = Number(String(tail).replace(/\D/g, ''));
    return {
      recognized: true, stationId: 'P6', stationName: '东苑食堂东侧菜鸟驿站',
      pickupCode: 'A' + String(10000 + seq), trackingTail: '', lockerNo: '',
      confidence: 'MEDIUM', source: 'RULE', needsReview: false, failureId: 'F-' + tail
    };
  };
  await drainGates(gates, suggestionOf, function isDone() { return done; });
  t.check(done && outcome && maxActive === 2 && outcome.called === 3 && outcome.failed === 0
    && outcome.items.map(function code(item) { return item.pickupCode; }).join(',') === 'A10000,A10001,A10002',
  'P28 AI 兜底乱序完成按件序回填（items[i] 对应第 i 件，逐件独立 failureId/不串件）');
  t.check(done && outcome && outcome.items.every(function state(item) { return item.aiState === 'OK'; }),
    'P29 AI 兜底并行后逐件状态口径不变（成功件 aiState=OK，只手填空字段）');
}

async function pipelineChecks(t, deps) {
  const d = deps || {};
  await orderedChecks(t);
  await sessionChecks(t);
  componentChecks(t, d);
  wiringChecks(t, d);
  await aiParallelChecks(t, d);
  const emptyAggregate = aggregate && typeof aggregate.emptyResult === 'function' ? aggregate.emptyResult() : null;
  t.check(!!emptyAggregate && emptyAggregate.ok === false && Array.isArray(emptyAggregate.items)
    && emptyAggregate.items.length === 0 && !!emptyAggregate.failureCopy,
  'P30 识别聚合纯件空集口径（0 图/全失败不空转，给失败卡人话文案）');
  t.notEmpty([fileOf(1), fileOf(2)], 'P 组样本非空（防止空集全绿）');
}

module.exports = { pipelineChecks };
