// pkg-partner/pages/create-on-behalf/parts/recognize-flow.js · 代客下单识别编排（页面零件，允许 wx 能力）
// 口径：UX_PARTNER §3.4（选图自动识别预填、失败入队/手填引导不变、不阻塞页面、可取消、一图多码按件拆）；
//       CONTRACT D44；D29（AI 低置信不写入）；D40（端侧 OCR 画布帧降采样长边 ≤1440）。
// 链路：复用顾客端 utils/ocr + utils/recognize（纯件）→ 逐图 OCR → 规则解析 → 缺站点/码时逐图 aiApi.parseParcel 兜底。
// 边界：上传由 <image-picker> 完成（唯一上传路径 api/upload）；本文件只编排识别，不直连数据库/存储。
'use strict';

const aiApi = require('../../../../api/modules/ai');
const ocr = require('../../../../utils/ocr/index');
const recognize = require('../../../../utils/recognize/index');
const recognizeModel = require('./recognize-model');

const OCR_TIMEOUT_MS = 40000;
const VISION_MAX_EDGE = 1440;
const MAX_IMAGES = recognize.MAX_IMAGES_PER_ORDER;
const CANCEL_POLL_MS = 150;

function textOf(value) { return typeof value === 'string' ? value.trim() : ''; }

function hasVision() {
  return typeof wx !== 'undefined' && typeof wx.createVKSession === 'function';
}

function imageInfo(filePath) {
  return new Promise(function executor(resolve) {
    wx.getImageInfo({
      src: filePath,
      success: function ok(res) {
        resolve({ ok: true, width: res.width, height: res.height, path: res.path || filePath });
      },
      fail: function no() {
        resolve({ ok: false, code: 'IMAGE_DECODE_FAILED' });
      }
    });
  });
}

/** OCR 画布帧尺寸（P0-10 降采样：长边 ≤1440，纯计算便于断言） */
function frameSizeOf(img, maxEdge) {
  return ocr.frame.frameSize(img && img.width, img && img.height, maxEdge || VISION_MAX_EDGE);
}

/** 帧计划（条带裁剪矩形 + 输出尺寸）：纯计算，单帧 count=1 */
function framePlanOf(img, band) {
  const spec = band || {};
  const count = Math.max(1, Math.min(4, Number(spec.bands) || 1));
  const index = Math.max(0, Math.min(count - 1, Number(spec.index) || 0));
  const src = ocr.frame.bandSourceOf(img.width, img.height, count, index);
  if (!src.ok) return { ok: false, code: src.code, detail: src.detail };
  const sized = count === 1 ? frameSizeOf(img) : ocr.frame.frameSize(src.width, src.height, VISION_MAX_EDGE);
  if (!sized.ok) return { ok: false, code: sized.code, detail: sized.detail };
  return { ok: true, src: src, sized: sized, count: count, index: index };
}

/** 把「原图条带」画到离屏画布并取精确 RGBA 像素（D35 口径：先裁后缩 + buffer 精确切片） */
function drawFrame(imageSrc, plan) {
  return new Promise(function executor(resolve) {
    const sized = plan.sized;
    const src = plan.src;
    let canvas = null;
    try {
      canvas = wx.createOffscreenCanvas({ type: '2d', width: sized.width, height: sized.height });
    } catch (err) {
      resolve({ ok: false, code: 'VK_UNSUPPORTED', detail: '当前环境没有离屏画布' });
      return;
    }
    const ctx = canvas.getContext('2d');
    const image = canvas.createImage();
    image.onload = function onload() {
      try {
        ctx.drawImage(image, src.x, src.y, src.width, src.height, 0, 0, sized.width, sized.height);
        const data = ctx.getImageData(0, 0, sized.width, sized.height);
        const buffer = ocr.frame.rgbaBufferOf(data.data);
        if (!buffer) {
          resolve({ ok: false, code: 'IMAGE_DECODE_FAILED', detail: '画布取像素为空' });
          return;
        }
        resolve({ ok: true, frame: { width: sized.width, height: sized.height, buffer: buffer } });
      } catch (err) {
        resolve({ ok: false, code: 'IMAGE_DECODE_FAILED', detail: '画布取像素失败' });
      }
    };
    image.onerror = function onerror() {
      resolve({ ok: false, code: 'IMAGE_DECODE_FAILED', detail: '图片解码失败' });
    };
    image.src = imageSrc;
  });
}

function runVision(frame, opts) {
  return new Promise(function executor(resolve) {
    let session = null;
    const texts = [];
    let settled = false;
    let idleTimer = null;
    let deadlineTimer = null;
    const idle = (opts && opts.idleMs) || 300;
    const maxWait = (opts && opts.maxWaitMs) || 8000;
    const finish = function finish(result) {
      if (settled) return;
      settled = true;
      if (idleTimer) clearTimeout(idleTimer);
      if (deadlineTimer) clearTimeout(deadlineTimer);
      try { if (session && typeof session.destroy === 'function') session.destroy(); } catch (err) { /* 销毁失败不覆盖结果 */ }
      resolve(result);
    };
    try {
      session = wx.createVKSession({ track: { OCR: { mode: 2 } } });
    } catch (err) {
      finish({ ok: false, code: 'VK_UNSUPPORTED', detail: '当前微信/机型不支持端侧识别' });
      return;
    }
    session.on('updateAnchors', function onUpdate(anchors) {
      (anchors || []).forEach(function each(anchor) { if (anchor && anchor.text) texts.push(anchor.text); });
      if (texts.length > 0) {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(function done() { finish({ ok: true, texts: texts }); }, idle);
      }
    });
    deadlineTimer = setTimeout(function timeout() {
      finish(texts.length > 0 ? { ok: true, texts: texts } : { ok: false, code: 'NO_TEXT', detail: '图里没认出文字' });
    }, maxWait);
    session.start(function onStart(err) {
      if (err) {
        finish({ ok: false, code: 'VK_INIT_FAILED', detail: '识别启动失败' });
        return;
      }
      try {
        session.runOCR({ frameBuffer: frame.buffer, width: frame.width, height: frame.height });
      } catch (runErr) {
        finish({ ok: false, code: 'VK_INIT_FAILED', detail: '识别执行失败' });
      }
    });
  });
}

/** 取消竞速：页面 token 变化 → 立刻结束等待（不阻塞后续操作；已发出的 OCR/AI 结果会被丢弃） */
function cancelRace(promise, isCancelled) {
  if (typeof isCancelled !== 'function') return promise;
  return new Promise(function executor(resolve) {
    let settled = false;
    const timer = setInterval(function poll() {
      if (settled) return;
      if (isCancelled()) {
        settled = true;
        clearInterval(timer);
        resolve({ ok: false, code: 'USER_CANCEL' });
      }
    }, CANCEL_POLL_MS);
    promise.then(function done(value) {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      resolve(value);
    }, function fail(err) {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      resolve({ ok: false, code: 'OCR_FAILED', detail: (err && err.message) || '' });
    });
  });
}

/** 单图端侧 OCR（含降采样画布 + 超时 + 可取消） */
async function runOcr(localPath, isCancelled) {
  if (!hasVision()) {
    return { ok: false, code: 'VK_UNSUPPORTED' };
  }
  const info = await imageInfo(localPath);
  if (!info.ok) {
    return { ok: false, code: info.code };
  }
  const plan = framePlanOf(info);
  if (!plan.ok) {
    return { ok: false, code: plan.code };
  }
  const drawn = await drawFrame(info.path || localPath, plan);
  if (!drawn.ok) {
    return { ok: false, code: drawn.code };
  }
  const vision = await cancelRace(runVision(drawn.frame), isCancelled);
  if (vision.code === 'USER_CANCEL') return { ok: false, code: 'USER_CANCEL' };
  if (!vision.ok) return { ok: false, code: vision.code };
  return { ok: true, text: (vision.texts || []).join('\n') };
}

/** 该件是否需要 AI 兜底：缺站点或缺可提交码（C2 触发口径，不以"是否抽到文本"为前置） */
function needsAiOf(item) {
  if (!item || !item.stationId) return true;
  const checked = recognize.validateParcel(item);
  return !!checked.errors.pickupCode || checked.codeStatus !== 'OK';
}

/** 单图 AI 兜底：服务端唯一外呼出口；D29 低置信不写入，只留提示。服务端负责失败入队（D33）。 */
async function aiFallbackOf(file, item, maskedText) {
  const requestId = recognizeModel.failureRequestIdOf(textOf(file.uploadTicketId), 0, maskedText);
  try {
    const value = (await aiApi.parseParcel({
      ocrTextMasked: String(maskedText || ''),
      hintTrackingTail: textOf(item && item.trackingTail),
      uploadTicketId: textOf(file.uploadTicketId),
      fileId: textOf(file.fileId),
      role: 'PARTNER'
    }, requestId ? { clientRequestId: requestId } : {})) || {};
    const merged = recognize.applyAiSuggestion(item, value);
    return {
      item: merged.parcel,
      changed: merged.changed.length,
      suggestion: merged.suggestion || null,
      failureId: textOf(value.failureId) || textOf(value.failureNo),
      error: value.error === true
    };
  } catch (err) {
    return { item: item, changed: 0, suggestion: null, failureId: '', error: true };
  }
}

/**
 * 单图识别：OCR → 规则解析 → 缺站点/码时 AI 兜底（有可外发文本才外呼；无文本时服务端只入队）。
 * 失败不阻塞手填：认不出时返回空件行，页面只给手填/复核引导。
 */
async function identifyOne(file, context, imageIndex) {
  const result = { items: [], failureId: '', failed: 0, low: 0, cancelled: false };
  const localPath = textOf(file && file.localPath) || textOf(file && file.path);
  let parsed = { items: [] };
  let ocrText = '';
  if (localPath) {
    context.onProgress({ phase: 'ocr', index: imageIndex + 1, total: context.total });
    const seen = await runOcr(localPath, context.isCancelled);
    if (seen.code === 'USER_CANCEL') {
      result.cancelled = true;
      return result;
    }
    if (seen.ok === true) {
      ocrText = seen.text || '';
      parsed = recognize.parseOcrText(ocrText, { stations: context.stations });
    }
  }
  if (context.isCancelled()) {
    result.cancelled = true;
    return result;
  }
  let items = (parsed.items || []).map(function clone(item) { return Object.assign({}, item); });
  const maskedText = recognize.maskForAi(ocrText);
  const needAi = items.length === 0 || items.some(needsAiOf);
  if (!needAi) {
    result.items = items;
    return result;
  }
  context.onProgress({ phase: 'ai', index: imageIndex + 1, total: context.total });
  const ai = await aiFallbackOf(file, items[0] || recognize.makeEmptyParcel(), maskedText);
  if (context.isCancelled()) {
    result.cancelled = true;
    return result;
  }
  result.failureId = ai.failureId;
  if (ai.suggestion) result.low = 1;
  if (ai.changed > 0) {
    if (items.length === 0) items = [ai.item];
    else items[0] = ai.item;
  }
  if (items.length === 0) {
    // 只有真的入队拿到 failureId 才敢说「已反馈开发者复核」；外呼异常时不撒谎，只给手填引导
    result.failed = ai.failureId ? 1 : 0;
    result.error = ai.failureId ? 0 : 1;
  }
  result.items = items;
  return result;
}

/**
 * 多图识别（0~10 张）：逐图 OCR/AI，按图序汇总件行；失败图不影响成功图。
 * @param {object[]} files 已上传文件（localPath/fileId/uploadTicketId）
 * @param {object} options {stations,total,isCancelled,onProgress}
 * @returns {Promise<{cancelled:boolean,items:object[],failed:number,low:number}>}
 */
async function identifyFiles(files, options) {
  const opt = options || {};
  const list = (Array.isArray(files) ? files : []).filter(function valid(file) {
    return !!(file && (file.localPath || file.path) && file.uploadTicketId);
  }).slice(0, MAX_IMAGES);
  const context = {
    stations: opt.stations,
    total: list.length,
    onProgress: typeof opt.onProgress === 'function' ? opt.onProgress : function noop() {},
    isCancelled: typeof opt.isCancelled === 'function' ? opt.isCancelled : function never() { return false; }
  };
  const items = [];
  let failed = 0;
  let low = 0;
  for (let index = 0; index < list.length; index += 1) {
    if (context.isCancelled()) {
      return { cancelled: true, items: [], failed: failed, low: low };
    }
    const one = await identifyOne(list[index], context, index);
    if (one.cancelled) {
      return { cancelled: true, items: [], failed: failed, low: low };
    }
    failed += one.failed;
    low += one.low;
    one.items.forEach(function append(item) {
      items.push(Object.assign({ imageIndex: index, failureId: one.failureId }, item));
    });
  }
  return { cancelled: false, items: items, failed: failed, low: low };
}

module.exports = {
  MAX_IMAGES,
  OCR_TIMEOUT_MS,
  VISION_MAX_EDGE,
  aiFallbackOf,
  framePlanOf,
  frameSizeOf,
  hasVision,
  identifyFiles,
  identifyOne,
  needsAiOf,
  runOcr
};
