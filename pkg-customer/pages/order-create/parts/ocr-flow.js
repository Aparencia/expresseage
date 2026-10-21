// pkg-customer/pages/order-create/parts/ocr-flow.js · 截图识别编排（页面零件，允许 wx 能力）
// 上传由 <image-picker> 完成（唯一上传路径 api/upload）；本零件只做 端侧识别 → AI 兜底 → 文本解析。
'use strict';

const aiApi = require('../../../../api/modules/ai');
const ocr = require('../../../../utils/ocr/index');
const recognize = require('../../../../utils/recognize/index');
const model = require('./model');

const OCR_TIMEOUT_MS = 40000;
const VISION_MAX_EDGE = 1440;

// §4.3.1 AI 兜底三态文案（关闭/超时/低置信；超限与关闭同句、不提示配额；用户取消 = 静默降级）
const AI_FALLBACK_COPY = {
  CLOSED: { text: '没识别出来，已反馈开发者复核，可手动填写。', next: '也可以换一张更清晰的图。' },
  TIMEOUT: { text: '智能识别超时，已反馈开发者复核，可手动填写或换一张图。', next: '手动填写不影响下单。' },
  LOW: { text: '识别结果不太确定，没自动填。', next: '已反馈开发者复核，可手动填写。' },
  USER_CANCEL: { text: '已取消智能识别，可以手动填写。', next: '也可以换一张更清晰的图。' }
};

/** 三态文案选择（纯函数；state 非法按关闭处理，不装懂） */
function aiFallbackCopy(state) {
  return AI_FALLBACK_COPY[state] || AI_FALLBACK_COPY.CLOSED;
}

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
      fail: function no(err) {
        resolve({ ok: false, code: 'IMAGE_DECODE_FAILED', detail: (err && err.errMsg) || '' });
      }
    });
  });
}

function canvasFrame(img, band) {
  return new Promise(function executor(resolve) {
    let canvas = null;
    try {
      canvas = wx.createOffscreenCanvas({ type: '2d', width: img.width, height: img.height });
    } catch (err) {
      resolve({ ok: false, code: 'VK_UNSUPPORTED', detail: '当前环境没有离屏画布' });
      return;
    }
    const ctx = canvas.getContext('2d');
    const image = canvas.createImage();
    image.onload = function onload() {
      try {
        ctx.drawImage(image, 0, 0, img.width, img.height);
        const bands = (band && band.bands) || 1;
        const height = Math.max(1, Math.floor(img.height / bands));
        const data = ctx.getImageData(0, 0, img.width, height);
        resolve({ ok: true, frame: { width: img.width, height: height, data: data.data, bandCount: bands } });
      } catch (err) {
        resolve({ ok: false, code: 'IMAGE_DECODE_FAILED', detail: '画布取像素失败' });
      }
    };
    image.onerror = function onerror() {
      resolve({ ok: false, code: 'IMAGE_DECODE_FAILED', detail: '图片解码失败' });
    };
    image.src = img.path || img.src;
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
      try {
        if (session && typeof session.destroy === 'function') session.destroy();
      } catch (err) {
        // 会话销毁失败不覆盖识别结果
      }
      resolve(result);
    };
    try {
      session = wx.createVKSession({ track: { OCR: { mode: 2 } } });
    } catch (err) {
      finish({ ok: false, code: 'VK_UNSUPPORTED', detail: '当前微信/机型不支持端侧识别' });
      return;
    }
    session.on('updateAnchors', function onUpdate(anchors) {
      (anchors || []).forEach(function each(anchor) {
        if (anchor && anchor.text) texts.push(anchor.text);
      });
      if (texts.length > 0) {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(function done() {
          finish({ ok: true, texts: texts, partial: false });
        }, idle);
      }
    });
    deadlineTimer = setTimeout(function timeout() {
      if (texts.length > 0) finish({ ok: true, texts: texts, partial: true });
      else finish({ ok: false, code: 'NO_TEXT', detail: '图里没认出文字' });
    }, maxWait);
    session.start(function onStart(err) {
      if (err) {
        const classified = ocr.vision.classifyStartErrno(err.errno || err);
        finish({ ok: false, code: classified.reason, detail: classified.detail });
        return;
      }
      try {
        session.runOCR({
          frameBuffer: frame.data.buffer || frame.data,
          width: frame.width,
          height: frame.height
        });
      } catch (runErr) {
        finish({ ok: false, code: 'VK_INIT_FAILED', detail: '识别执行失败' });
      }
    });
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

// AI 兜底成功态提示（§4.3.1 ④：只填空字段、手填优先，仍需人核对）
const AI_SUGGESTION_HINT = '智能识别建议，请核对';

/**
 * 对已上传的截图跑识别。file 来自 <image-picker> 的 change 事件：
 * { localPath, fileId, uploadTicketId, cloudPath, ... }
 * @returns {Promise<{ok:boolean,file:object,image?:object,items?:object[],ocrText?:string,
 *   failureCode?:string,failureCopy?:object,aiTried?:boolean,aiUsed?:boolean,aiFailed?:number,
 *   aiFallbackState?:string,failureId?:string,trackingTail?:string,hint?:string,detail?:string}>}
 */
async function identify(file, onState) {
  const notify = typeof onState === 'function' ? onState : function noop() {};
  const localPath = (file && file.localPath) || '';
  if (!localPath) {
    return {
      ok: false,
      file: file || {},
      failureCode: 'IMAGE_UNREADABLE',
      failureCopy: ocr.failureCopy('IMAGE_UNREADABLE')
    };
  }
  const info = await imageInfo(localPath);
  if (!info.ok) {
    return {
      ok: false,
      file: file,
      failureCode: info.code,
      failureCopy: ocr.failureCopy(info.code),
      detail: info.detail
    };
  }
  const image = { fileId: (file && file.fileId) || '', width: info.width, height: info.height };
  if (file && typeof file.size === 'number' && file.size > 0) image.size = file.size;
  notify({ phase: 'ocr' });
  const result = await Promise.race([
    ocr.recognize({ filePath: localPath, maxEdge: VISION_MAX_EDGE }, ocrDeps(info)),
    new Promise(function timeout(resolve) {
      setTimeout(function fire() {
        resolve({ ok: false, code: 'IMAGE_DECODE_FAILED', detail: '识别超时' });
      }, OCR_TIMEOUT_MS + 5000);
    })
  ]);
  if (!result.ok) {
    return {
      ok: false,
      file: file,
      image: image,
      ocrText: '',
      failureCode: result.code,
      failureCopy: ocr.failureCopy(result.code),
      detail: result.detail
    };
  }
  const parsed = recognize.parseOcrText(result.joined || '');
  let items = parsed.items;
  let aiTried = false;
  let aiUsed = false;
  let aiFailed = 0;
  let aiFallbackState = '';
  let unaligned = '';
  // 「认出但不像」只在与"一个码都没填上"同时成立时提示；已填到码时不要拿别的长数字打扰用户
  const hasFilledCode = items.some(function filled(item) { return !!(item && item.pickupCode); });
  let unalignedCode = (parsed.unalignedCodes || []).length > 0 && !hasFilledCode ? parsed.unalignedCodes[0] : '';
  const needFallback = items.length === 0 || items.some(function need(item) {
    return model.needsAiFallback(item);
  });
  if (needFallback) {
    aiTried = true;
    notify({ phase: 'ai' });
    // 同图多单按单调用（DATA_MODEL §4.9）：每件缺站点/缺码各调一次、各自独立 failureId；
    // 规则已填好的件不外呼；某件失败只降级该件（applyAiFallbacks 为纯件，外呼经 api/modules 注入）
    const seeds = items.length > 0 ? items : [recognize.makeEmptyParcel()];
    const fallback = await model.applyAiFallbacks(seeds, {
      ocrTextMasked: recognize.maskForAi(result.joined || ''),
      hintTrackingTail: parsed.trackingTail || '',
      uploadTicketId: (file && file.uploadTicketId) || '',
      role: 'CUSTOMER'
    }, aiApi.parseParcel);
    items = fallback.items;
    aiUsed = fallback.changed > 0;
    aiFailed = fallback.failed;
    aiFallbackState = (items[0] && items[0].aiState) || '';
    items.forEach(function label(item) {
      if (item.aiPickupCodeUnaligned) unalignedCode = item.aiPickupCodeUnaligned;
      if (item.aiState && item.aiState !== 'OK') item.aiHint = aiFallbackCopy(item.aiState).text;
    });
  }
  if (unalignedCode) unaligned = recognize.FORM_ERROR.pickupCode;
  // 一件可提交字段都没拿到（空壳也按失败处理）：走失败卡 + 单源文案，页面据此给「手动填写」支路
  const shell = items.length === 1 ? items[0] : null;
  const shellEmpty = items.length === 0
    || (!!shell && !shell.stationId && !shell.pickupCode && !shell.trackingTail && !shell.lockerNo);
  const failureId = (items.filter(function has(item) { return !!item.failureId; })[0] || {}).failureId || '';
  if (shellEmpty) {
    const copy = aiTried ? aiFallbackCopy(aiFallbackState) : ocr.failureCopy('NO_TEXT');
    return {
      ok: true,
      file: file,
      image: image,
      ocrText: result.joined || '',
      items: [],
      needsReview: true,
      aiTried: aiTried,
      aiUsed: false,
      aiFallbackState: aiFallbackState,
      failureId: failureId,
      trackingTail: (shell && shell.trackingTail) || parsed.trackingTail || '',
      hint: unaligned,
      failureCode: 'NO_TEXT',
      failureCopy: copy
    };
  }
  return {
    ok: true,
    file: file,
    image: image,
    ocrText: result.joined || '',
    items: items,
    needsReview: parsed.needsReview || aiFailed > 0,
    aiTried: aiTried,
    aiUsed: aiUsed,
    aiFailed: aiFailed,
    aiFallbackState: aiFallbackState,
    failureId: failureId,
    trackingTail: parsed.trackingTail || '',
    // 「认出但不像」的码候选：不自动填，只在页面给现有行内文案提示
    hint: unaligned,
    failureCode: '',
    failureCopy: null
  };
}

module.exports = {
  OCR_TIMEOUT_MS,
  VISION_MAX_EDGE,
  AI_FALLBACK_COPY,
  AI_SUGGESTION_HINT,
  aiFallbackCopy,
  hasVision,
  identify,
  imageInfo
};
