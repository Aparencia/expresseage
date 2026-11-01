// utils/ocr/wx-platform.js · 端侧 OCR 的 wx 平台适配层（VKSession / 离屏画布 / getImageInfo）
// 逐字节等价自 pkg-customer/pages/order-create/parts/ocr-flow.js 抽出（D57 前置重构），
// 供顾客下单页与本机清单页共用；纯逻辑单源仍在 ./frame 与 ./vision（本文件只做平台能力接线）。
// 纪律：零上传零外呼——只认本地图路径，不碰网络/存储；页面/零件通过本模块注入识别能力。
// v1.1（D57 收尾）：runVision 按「会话/收口/启动」拆小函数（行为逐项等价：#32 单函数 ≤50 行真绿）。
'use strict';

const frameLib = require('./frame');
const visionLib = require('./vision');

const VISION_MAX_EDGE = 1440;

function hasVision() {
  return typeof wx !== 'undefined' && typeof wx.createVKSession === 'function';
}

/**
 * OCR 画布帧尺寸（纯函数，P0-10）：长边压到 ≤VISION_MAX_EDGE，保持比例。
 * 测试直接断言本函数（不 mock wx），保证大图不会按原尺寸建画布/取像素。
 */
function frameSizeOf(img, maxEdge) {
  const width = img && img.width;
  const height = img && img.height;
  return frameLib.frameSize(width, height, maxEdge || VISION_MAX_EDGE);
}

function imageInfo(filePath) {
  return new Promise(function executor(resolve) {
    wx.getImageInfo({
      src: filePath,
      success: function ok(res) {
        resolve({ ok: true, width: res.width, height: res.height, path: res.path || filePath });
      },
      fail: function no(err) {
        resolve({ ok: false, code: 'IMAGE_DECODE_FAILED', detail: (err && err.errMsg) || '' });
      }
    });
  });
}

/** 帧计划（条带裁剪矩形 + 输出尺寸）：纯计算，便于排错与复用 */
function framePlanOf(img, band) {
  const spec = band || {};
  const count = Math.max(1, Math.min(4, Number(spec.bands) || 1));
  const index = Math.max(0, Math.min(count - 1, Number(spec.index) || 0));
  const src = frameLib.bandSourceOf(img.width, img.height, count, index);
  if (!src.ok) return { ok: false, code: src.code, detail: src.detail };
  const sized = count === 1
    ? frameSizeOf(img)
    : frameLib.frameSize(src.width, src.height, VISION_MAX_EDGE);
  if (!sized.ok) return { ok: false, code: sized.code, detail: sized.detail };
  return { ok: true, src: src, sized: sized, count: count, index: index };
}

/** 把「原图条带」画到离屏画布并取精确 RGBA 像素（D35：先裁后缩 + buffer 精确切片） */
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
        const buffer = frameLib.rgbaBufferOf(data.data);
        if (!buffer) {
          resolve({ ok: false, code: 'IMAGE_DECODE_FAILED', detail: '画布取像素为空' });
          return;
        }
        resolve({
          ok: true,
          frame: {
            width: sized.width,
            height: sized.height,
            data: data.data,
            buffer: buffer,
            bandCount: plan.count,
            bandIndex: plan.index
          }
        });
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

// P0-10 + D35：按条带从原图裁剪再缩放到长边 ≤VISION_MAX_EDGE（先裁后缩，条带重试才有放大收益）
function canvasFrame(img, band) {
  const plan = framePlanOf(img, band);
  if (!plan.ok) {
    return Promise.resolve({ ok: false, code: plan.code, detail: plan.detail });
  }
  return drawFrame(img.path || img.src, plan);
}

/**
 * 会话收口器（D57 收尾拆分）：只收口一次——清空闲/截止定时器、销毁会话、回传结果。
 * 销毁失败不覆盖识别结果；收口后重复调用直接忽略（永不悬挂）。
 */
function visionFinisherOf(state, resolve) {
  return function finish(result) {
    if (state.settled) return;
    state.settled = true;
    if (state.idleTimer) clearTimeout(state.idleTimer);
    if (state.deadlineTimer) clearTimeout(state.deadlineTimer);
    try {
      if (state.session && typeof state.session.destroy === 'function') state.session.destroy();
    } catch (err) {
      // 会话销毁失败不覆盖识别结果
    }
    resolve(result);
  };
}

/** 锚点收集（D57 收尾拆分）：收到文字后重置空闲计时——最后一条文字后 idleMs 内无新文字即成功收口。 */
function collectAnchors(state, anchors, finish) {
  (anchors || []).forEach(function each(anchor) {
    if (anchor && anchor.text) state.texts.push(anchor.text);
  });
  if (state.texts.length === 0) return;
  if (state.idleTimer) clearTimeout(state.idleTimer);
  state.idleTimer = setTimeout(function done() {
    finish({ ok: true, texts: state.texts, partial: false });
  }, state.idle);
}

/** 截止计时（D57 收尾拆分）：到点已有文字 → partial 成功；完全没有文字 → NO_TEXT（永不悬挂）。 */
function armVisionDeadline(state, finish) {
  state.deadlineTimer = setTimeout(function timeout() {
    if (state.texts.length > 0) finish({ ok: true, texts: state.texts, partial: true });
    else finish({ ok: false, code: 'NO_TEXT', detail: '图里没认出文字' });
  }, state.maxWait);
}

/** 启动会话并送帧（D57 收尾拆分）：start errno 分类口径不变；runOCR 抛错按 VK_INIT_FAILED 收口。 */
function startVision(state, frame, finish) {
  state.session.start(function onStart(err) {
    if (err) {
      const classified = visionLib.classifyStartErrno(err.errno || err);
      finish({ ok: false, code: classified.reason, detail: classified.detail });
      return;
    }
    try {
      state.session.runOCR({
        frameBuffer: frame.buffer || (frame.data && frame.data.buffer) || frame.data,
        width: frame.width,
        height: frame.height
      });
    } catch (runErr) {
      finish({ ok: false, code: 'VK_INIT_FAILED', detail: '识别执行失败' });
    }
  });
}

function runVision(frame, opts) {
  return new Promise(function executor(resolve) {
    const state = {
      session: null,
      texts: [],
      settled: false,
      idle: (opts && opts.idleMs) || visionLib.IDLE_MS,
      maxWait: (opts && opts.maxWaitMs) || visionLib.MAX_WAIT_MS,
      idleTimer: null,
      deadlineTimer: null
    };
    const finish = visionFinisherOf(state, resolve);
    try {
      state.session = wx.createVKSession({ track: { OCR: { mode: 2 } } });
    } catch (err) {
      finish({ ok: false, code: 'VK_UNSUPPORTED', detail: '当前微信/机型不支持端侧识别' });
      return;
    }
    state.session.on('updateAnchors', function onUpdate(anchors) {
      collectAnchors(state, anchors, finish);
    });
    armVisionDeadline(state, finish);
    startVision(state, frame, finish);
  });
}

function ocrDeps(img) {
  return {
    hasVision: hasVision(),
    loadFrame: function loadFrame(filePath, band) {
      return canvasFrame(img, band);
    },
    runVision: runVision,
    now: function now() { return Date.now(); }
  };
}

module.exports = {
  VISION_MAX_EDGE,
  hasVision,
  frameSizeOf,
  imageInfo,
  framePlanOf,
  drawFrame,
  canvasFrame,
  runVision,
  ocrDeps
};
