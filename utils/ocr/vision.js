// utils/ocr/vision.js · 端侧识别编排内核（纯逻辑，零 wx；平台能力由 deps 注入）
// 对齐 v3 阶梯：先整图一次；NO_TEXT 时按条带重试；任何出口都 resolve，永不悬挂。
'use strict';

const IDLE_MS = 300; // 收到文字后多久没有新文字就收口
const MAX_WAIT_MS = 8000; // 首个文字到达前的最长等待
const FRAME_TIMEOUT_MS = 8000; // 取像素硬超时
const OCR_MAX_MS = 40000; // 单张截图识别总预算（v3 阶梯预算）

const LADDER = [
  { stage: 0, bands: 1 },
  { stage: 1, bands: 2 },
  { stage: 2, bands: 4 }
];

function fail(code, detail) {
  return { ok: false, code: code, detail: detail || '' };
}

/** 平台 start 回调 errno → 统一失败码 */
function classifyStartErrno(errno) {
  const code = Number(errno);
  if (code === 112) {
    return { reason: 'VK_INIT_FAILED', detail: '识别服务未在隐私指引中声明（errno=112）' };
  }
  if (code === 2003001 || code === 2003002) {
    return { reason: 'VK_INIT_FAILED', detail: '识别需要相机权限（errno=' + code + '）' };
  }
  if (code === 104) {
    return { reason: 'VK_INIT_FAILED', detail: '用户取消了授权（errno=104）' };
  }
  if (code === 2000002 || code === 2000004) {
    return { reason: 'VK_UNSUPPORTED', detail: '当前设备不支持端侧识别（errno=' + code + '）' };
  }
  return { reason: 'VK_INIT_FAILED', detail: '识别启动失败（errno=' + code + '）' };
}

/** 合并多条识别结果并去重（保持原始顺序） */
function mergeTexts(results) {
  const seen = Object.create(null);
  const merged = [];
  (results || []).forEach(function each(result) {
    const list = result && result.texts ? result.texts : [];
    list.forEach(function add(text) {
      const line = String(text || '').trim();
      if (!line || seen[line]) return;
      seen[line] = true;
      merged.push(line);
    });
  });
  return merged;
}

function withTimeout(promise, ms, code, detail) {
  return new Promise(function executor(resolve) {
    let settled = false;
    const timer = setTimeout(function onTimeout() {
      if (settled) return;
      settled = true;
      resolve(fail(code, detail));
    }, Math.max(1, ms));
    Promise.resolve(promise).then(function onValue(value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }, function onError(err) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(fail(code, (err && err.message) || detail));
    });
  });
}

/**
 * 跑一次识别会话（deps.runVision 内部自管会话生命周期，外部只管超时与收口）。
 * @returns {Promise<{ok:boolean,texts?:string[],code?:string,detail?:string,partial?:boolean}>}
 */
function runVisionOnce(deps, frame, idleMs, maxWaitMs) {
  const run = deps && typeof deps.runVision === 'function' ? deps.runVision : null;
  if (!run) return Promise.resolve(fail('VK_UNSUPPORTED', '没有可用的识别内核'));
  const idle = Number(idleMs) || IDLE_MS;
  const wait = Number(maxWaitMs) || MAX_WAIT_MS;
  return withTimeout(run(frame, { idleMs: idle, maxWaitMs: wait }), wait + FRAME_TIMEOUT_MS,
    'IMAGE_DECODE_FAILED', '识别超时');
}

/**
 * 端侧识别主入口。
 * deps = { hasVision:boolean, loadFrame(filePath, band), runVision(frame, opts), now() }
 * options = { filePath, maxEdge, startedAt }
 */
async function recognizeImage(deps, options) {
  const opts = options || {};
  const startedAt = Number(opts.startedAt) || Date.now();
  if (!deps || deps.hasVision === false) {
    return fail('VK_UNSUPPORTED', '当前微信/机型不支持端侧识别');
  }
  if (typeof deps.loadFrame !== 'function' || typeof deps.runVision !== 'function') {
    return fail('VK_INIT_FAILED', '识别能力未注入');
  }
  const first = await withTimeout(deps.loadFrame(opts.filePath, { bands: 1 }),
    FRAME_TIMEOUT_MS, 'IMAGE_DECODE_FAILED', '读取图片超时');
  if (!first || first.ok === false) return first || fail('IMAGE_DECODE_FAILED');

  const firstRun = await runVisionOnce(deps, first.frame);
  if (!firstRun.ok) return firstRun;
  if (firstRun.texts && firstRun.texts.length > 0) {
    return { ok: true, texts: firstRun.texts, partial: !!firstRun.partial };
  }

  const collected = [];
  for (let i = 1; i < LADDER.length; i += 1) {
    if (Date.now() - startedAt > OCR_MAX_MS) break;
    const step = LADDER[i];
    const loaded = await withTimeout(deps.loadFrame(opts.filePath, { bands: step.bands }),
      FRAME_TIMEOUT_MS, 'IMAGE_DECODE_FAILED', '读取图片超时');
    if (!loaded || loaded.ok === false) continue;
    const result = await runVisionOnce(deps, loaded.frame);
    if (result && result.ok && result.texts && result.texts.length > 0) {
      result.texts.forEach(function push(text) { collected.push({ texts: [text] }); });
    }
  }
  const merged = mergeTexts(collected);
  if (merged.length === 0) {
    return fail('NO_TEXT', '图里没认出文字');
  }
  return { ok: true, texts: merged, partial: true };
}

module.exports = {
  IDLE_MS,
  MAX_WAIT_MS,
  FRAME_TIMEOUT_MS,
  OCR_MAX_MS,
  LADDER,
  fail,
  classifyStartErrno,
  mergeTexts,
  withTimeout,
  recognizeImage
};
