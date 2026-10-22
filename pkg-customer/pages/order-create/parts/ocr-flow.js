// pkg-customer/pages/order-create/parts/ocr-flow.js · 截图识别编排（页面零件，允许 wx 能力）
// 上传由 <image-picker> 完成（唯一上传路径 api/upload）；本零件只做 端侧识别 → AI 兜底 → 文本解析。
// v1.0（D23/D24/C2/P0-10）：
//   ① 多图 0~5 张逐张识别后由 recognize.mergeParcels 汇总（件上限 10），每件带 imageIndex 指向来源图；
//   ② AI 兜底口径（CONTRACT §4.3 v1.0）：规则解析任一包裹缺站点/码即调 AI 兜底接口（经 api/modules/ai）；
//      端侧 OCR 失败/无文本也**一定**调一次（ocrTextMasked 可为空串）——服务端负责入队 NO_TEXT、不外呼；
//   ③ OCR 画布帧按 frameSize 降采样到长边 ≤1440 再取像素（P0-10，降低大图内存峰值）。
'use strict';

const aiApi = require('../../../../api/modules/ai');
const ocr = require('../../../../utils/ocr/index');
const recognize = require('../../../../utils/recognize/index');
const model = require('./model');

const OCR_TIMEOUT_MS = 40000;
const VISION_MAX_EDGE = 1440;
const MAX_PARCELS = recognize.MAX_PARCELS_PER_ORDER;
const MAX_IMAGES = recognize.MAX_IMAGES_PER_ORDER;

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

/**
 * OCR 画布帧尺寸（纯函数，P0-10）：长边压到 ≤VISION_MAX_EDGE，保持比例。
 * 测试直接断言本函数（不 mock wx），保证大图不会按原尺寸建画布/取像素。
 */
function frameSizeOf(img, maxEdge) {
  const width = img && img.width;
  const height = img && img.height;
  return ocr.frame.frameSize(width, height, maxEdge || VISION_MAX_EDGE);
}

/**
 * 失败态兜底文案（纯函数）：只有真的入队拿到 failureId 才敢说「已反馈开发者复核」；
 * 没入队（无票据/AI 调用异常）时用 OCR 单源文案，不撒谎。
 */
function failureCopyFor(code, fallback) {
  const info = fallback || {};
  const base = ocr.failureCopy(code);
  if (!info.failureId) {
    return base;
  }
  const aiCopy = aiFallbackCopy(info.aiState);
  return {
    text: base.text,
    next: aiCopy.text.indexOf('已反馈') >= 0 ? '已反馈开发者复核，也可以手动填写后提交。' : base.next
  };
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

// P0-10：画布按降采样后的尺寸创建（长边 ≤VISION_MAX_EDGE），不再按原图全尺寸取像素。
function canvasFrame(img, band) {
  return new Promise(function executor(resolve) {
    const sized = frameSizeOf(img);
    if (!sized.ok) {
      resolve({ ok: false, code: sized.code, detail: sized.detail });
      return;
    }
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
        ctx.drawImage(image, 0, 0, sized.width, sized.height);
        const bands = (band && band.bands) || 1;
        const height = Math.max(1, Math.floor(sized.height / bands));
        const data = ctx.getImageData(0, 0, sized.width, height);
        resolve({ ok: true, frame: { width: sized.width, height: height, data: data.data, bandCount: bands } });
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
 * OCR 失败/无文本时也调一次 AI 兜底接口（CONTRACT §4.3 v1.0）：
 * ocrTextMasked 可为空串——服务端 branch① 直接入队 NO_TEXT、不外呼；返回 failureId 供建单回填。
 * 无票据（上传就失败）时无处关联，返回 null（页面只给手填引导，不谎称已反馈）。
 */
async function queueFailure(file, ocrTextMasked) {
  const ticket = (file && file.uploadTicketId) || '';
  if (!ticket) {
    return null;
  }
  try {
    const suggestion = await aiApi.parseParcel({
      ocrTextMasked: String(ocrTextMasked || ''),
      uploadTicketId: ticket,
      role: 'CUSTOMER'
    });
    const value = suggestion || {};
    const failureId = typeof value.failureId === 'string' ? value.failureId : '';
    return {
      failureId: failureId,
      aiState: value.error === true ? 'TIMEOUT' : (value.confidence === 'LOW' ? 'LOW' : 'CLOSED')
    };
  } catch (err) {
    return { failureId: '', aiState: 'TIMEOUT' };
  }
}

/**
 * 单图识别 + AI 兜底。
 * @returns {Promise<{ok:boolean,file:object,image?:object,items?:object[],ocrText?:string,
 *   failureCode?:string,failureCopy?:object,aiTried?:boolean,aiUsed?:boolean,aiFailed?:number,
 *   aiFallbackState?:string,failureId?:string,hint?:string,detail?:string}>}
 */
async function identify(file, onState) {
  const notify = typeof onState === 'function' ? onState : function noop() {};
  const localPath = (file && file.localPath) || '';
  if (!localPath) {
    const queued = await queueFailure(file, '');
    return {
      ok: false,
      file: file || {},
      failureCode: 'IMAGE_UNREADABLE',
      failureCopy: failureCopyFor('IMAGE_UNREADABLE', queued || {}),
      failureId: (queued && queued.failureId) || '',
      aiTried: !!(queued && queued.failureId)
    };
  }
  const info = await imageInfo(localPath);
  if (!info.ok) {
    // 认不到图也补一次 AI（服务端负责入队；不外呼空文本），不让「失败=静默」
    const queued = await queueFailure(file, '');
    return {
      ok: false,
      file: file,
      failureCode: info.code,
      failureCopy: failureCopyFor(info.code, queued || {}),
      failureId: (queued && queued.failureId) || '',
      aiTried: !!(queued && queued.failureId),
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
    const queued = await queueFailure(file, '');
    return {
      ok: false,
      file: file,
      image: image,
      ocrText: '',
      failureCode: result.code,
      failureCopy: failureCopyFor(result.code, queued || {}),
      failureId: (queued && queued.failureId) || '',
      aiTried: !!(queued && queued.failureId),
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
  // C2 触发口径：任一包裹缺站点/缺码即调 AI（即使 OCR 文本非空、规则已有部分命中）
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
      if (!item.aiSuggestion && item.aiState && item.aiState !== 'OK') item.aiHint = aiFallbackCopy(item.aiState).text;
    });
  }
  if (unalignedCode) unaligned = recognize.FORM_ERROR.pickupCode;
  // 一件可提交字段都没拿到（空壳也按失败处理）：走失败卡 + 单源文案，页面据此给「手动填写」支路
  const shell = items.length === 1 ? items[0] : null;
  const shellEmpty = items.length === 0
    || (!!shell && !shell.stationId && !shell.pickupCode && !shell.trackingTail && !shell.lockerNo);
  const failureId = (items.filter(function has(item) { return !!item.failureId; })[0] || {}).failureId || '';
  if (shellEmpty) {
    const copy = aiTried
      ? failureCopyFor('NO_TEXT', { failureId: failureId, aiState: aiFallbackState })
      : ocr.failureCopy('NO_TEXT');
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

/**
 * 多图识别汇总（0~5 张 → 总包裹 ≤10）。
 * 逐张跑 identify（含逐图 AI 兜底），再按图序合并去重；每件补 imageIndex 指向来源图。
 * 失败图不影响成功图；全部失败时给第一张失败的人话文案。
 */
async function identifyMany(files, onState) {
  const list = (Array.isArray(files) ? files : []).filter(function valid(file) {
    return !!(file && file.localPath);
  }).slice(0, MAX_IMAGES);
  if (list.length === 0) {
    return {
      ok: false,
      files: [],
      images: [],
      items: [],
      failureCode: 'NO_TEXT',
      failureCopy: ocr.failureCopy('NO_TEXT'),
      failureId: '',
      aiTried: false,
      aiUsed: false,
      failures: []
    };
  }
  const results = [];
  for (let i = 0; i < list.length; i += 1) {
    const one = await identify(list[i], onState);
    results.push(Object.assign({ imageIndex: i }, one));
  }
  const itemLists = results.map(function map(result, index) {
    return (result.items || []).map(function tag(item) {
      return Object.assign({}, item, { imageIndex: index });
    });
  });
  const merged = recognize.mergeParcels(itemLists, { max: MAX_PARCELS });
  const images = results.map(function image(result) { return result.image; }).filter(function has(image) {
    return !!(image && image.fileId);
  });
  // 每张来源图的快照与票据（images[i] ↔ tickets[i] 同序一一对应，D23 契约）；
  // 供页面组装 order.create 载荷时按 imageIndex 精确配对（不按过滤后的 images 下标猜）。
  const perImage = results.map(function each(result, index) {
    const file = list[index] || {};
    return {
      imageIndex: index,
      ticket: typeof file.uploadTicketId === 'string' ? file.uploadTicketId : '',
      image: result.image || null,
      failureId: result.failureId || '',
      failureCode: result.failureCode || ''
    };
  });
  const failures = results.filter(function failed(result) {
    return !!result.failureId || !!result.failureCode;
  }).map(function brief(result) {
    return {
      imageIndex: result.imageIndex,
      failureCode: result.failureCode || '',
      failureId: result.failureId || '',
      copy: result.failureCopy || null
    };
  });
  const ocrText = results.map(function text(result) { return result.ocrText || ''; })
    .filter(function nonEmpty(value) { return !!value; })
    .join('\n');
  const aiTried = results.some(function tried(result) { return result.aiTried === true; });
  const aiUsed = results.some(function used(result) { return result.aiUsed === true; });
  if (merged.items.length === 0) {
    const first = results.filter(function bad(result) { return !!result.failureCopy; })[0] || null;
    return {
      ok: false,
      files: list,
      images: images,
      items: [],
      failureCode: (first && first.failureCode) || 'NO_TEXT',
      failureCopy: (first && first.failureCopy) || ocr.failureCopy('NO_TEXT'),
      failureId: (first && first.failureId) || '',
      aiTried: aiTried,
      aiUsed: false,
      ocrText: ocrText,
      failures: failures
    };
  }
  return {
    ok: true,
    files: list,
    images: images,
    perImage: perImage,
    items: merged.items,
    duplicated: merged.duplicated,
    dropped: merged.dropped,
    truncated: merged.truncated,
    ocrText: ocrText,
    failures: failures,
    aiTried: aiTried,
    aiUsed: aiUsed,
    needsReview: results.some(function review(result) { return result.needsReview === true; })
      || merged.truncated
  };
}

/**
 * 页面增量合并（纯函数）：把「新增图」的识别结果并入已有件，不覆盖用户已手改的旧件。
 * @param {object[]} existingItems 页面已有件（imageIndex 指向已有 perImage）
 * @param {object[]} existingPerImage 已有来源图快照（与页面 files 当前顺序对齐）
 * @param {object} result identifyMany 对「新增图」的结果
 * @returns {{items:object[],perImage:object[],duplicated:number,truncated:boolean}}
 */
function mergeItems(existingItems, existingPerImage, result) {
  const oldPerImage = Array.isArray(existingPerImage) ? existingPerImage : [];
  const incoming = ((result && result.perImage) || []).slice();
  const perImage = oldPerImage.slice();
  incoming.forEach(function append(entry) {
    perImage.push(Object.assign({}, entry, { imageIndex: perImage.length }));
  });
  const offset = oldPerImage.length;
  const fresh = ((result && result.items) || []).map(function tag(item) {
    const local = typeof item.imageIndex === 'number' && item.imageIndex >= 0 ? item.imageIndex : 0;
    return Object.assign({}, item, { imageIndex: offset + local });
  });
  const merged = recognize.mergeParcels([existingItems || [], fresh], { max: MAX_PARCELS });
  return {
    items: merged.items,
    perImage: perImage,
    duplicated: merged.duplicated,
    truncated: merged.truncated
  };
}

module.exports = {
  OCR_TIMEOUT_MS,
  VISION_MAX_EDGE,
  MAX_PARCELS,
  MAX_IMAGES,
  AI_FALLBACK_COPY,
  AI_SUGGESTION_HINT,
  aiFallbackCopy,
  failureCopyFor,
  frameSizeOf,
  hasVision,
  identify,
  identifyMany,
  mergeItems,
  queueFailure,
  imageInfo
};
