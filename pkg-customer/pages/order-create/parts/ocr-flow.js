// pkg-customer/pages/order-create/parts/ocr-flow.js · 截图识别编排（页面零件，允许 wx 能力）
// 上传由 <image-picker> 完成（唯一上传路径 api/upload）；本零件只做 端侧识别 → AI 兜底 → 文本解析。
'use strict';

const aiApi = require('../../../../api/modules/ai');
const ocr = require('../../../../utils/ocr/index');
const recognize = require('../../../../utils/recognize/index');

const OCR_TIMEOUT_MS = 40000;
const VISION_MAX_EDGE = 1440;

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

function applySuggestion(items, suggestion) {
  if (!suggestion || suggestion.recognized === false) {
    return { items: items, changed: false };
  }
  let changed = false;
  const next = (items || []).map(function map(item) {
    const result = recognize.applyAiSuggestion(item, suggestion);
    if (result.changed.length > 0) changed = true;
    return result.parcel;
  });
  return { items: next, changed: changed };
}

/**
 * 对已上传的截图跑识别。file 来自 <image-picker> 的 change 事件：
 * { localPath, fileId, uploadTicketId, cloudPath, ... }
 * @returns {Promise<{ok:boolean,file:object,image?:object,items?:object[],ocrText?:string,
 *   failureCode?:string,failureCopy?:object,aiTried?:boolean,aiUsed?:boolean,detail?:string}>}
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
  if (parsed.needsReview || items.length === 0) {
    aiTried = true;
    notify({ phase: 'ai' });
    try {
      const suggestion = await aiApi.parseParcel({
        ocrTextMasked: recognize.maskForAi(result.joined || ''),
        hintTrackingTail: parsed.trackingTail || '',
        uploadTicketId: (file && file.uploadTicketId) || '',
        role: 'CUSTOMER'
      });
      const applied = applySuggestion(items, suggestion || {});
      items = applied.items;
      aiUsed = applied.changed;
      if (items.length === 0 && suggestion && suggestion.recognized) {
        items = [recognize.applyAiSuggestion(recognize.makeEmptyParcel(), suggestion).parcel];
      }
    } catch (err) {
      aiUsed = false;
    }
  }
  return {
    ok: true,
    file: file,
    image: image,
    ocrText: result.joined || '',
    items: items,
    needsReview: parsed.needsReview || items.length === 0,
    aiTried: aiTried,
    aiUsed: aiUsed,
    failureCode: '',
    failureCopy: null
  };
}

module.exports = {
  OCR_TIMEOUT_MS,
  VISION_MAX_EDGE,
  hasVision,
  identify,
  imageInfo
};
