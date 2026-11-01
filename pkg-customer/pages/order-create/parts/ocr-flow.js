// pkg-customer/pages/order-create/parts/ocr-flow.js · 截图识别编排（页面零件，允许 wx 能力）
// 上传由 <image-picker> 完成（唯一上传路径 api/upload）；本零件只做 端侧识别 → AI 兜底 → 文本解析。
// v1.0（D23/D24/C2/P0-10）：
//   ① 多图 0~10 张逐张识别后由 recognize.mergeParcels 汇总（件上限 10），每件带 imageIndex 指向来源图；
//   ② AI 兜底口径（CONTRACT §4.3 v1.0）：规则解析任一包裹缺站点/码即调 AI 兜底接口（经 api/modules/ai）；
//      端侧 OCR 失败/无文本也**一定**调一次（ocrTextMasked 可为空串）——服务端负责入队 NO_TEXT、不外呼；
//   ③ OCR 画布帧按 frameSize 降采样到长边 ≤1440 再取像素（P0-10，降低大图内存峰值）。
// v1.1（D57 前置重构）：wx 平台适配层（VKSession/画布/图片信息/帧计划/依赖注入）已抽到
//   utils/ocr/wx-platform.js；本零件只保留识别编排，frameSizeOf/hasVision/imageInfo 按原名重导出
//   （既有测试与页面调用不变，后续本机清单页复用同一份平台层）。
'use strict';

const aiApi = require('../../../../api/modules/ai');
const configApi = require('../../../../api/modules/config');
const ocr = require('../../../../utils/ocr/index');
const wxPlatform = require('../../../../utils/ocr/wx-platform');
const recognize = require('../../../../utils/recognize/index');
const model = require('./model');
const aiFallback = require('./ai-fallback');
const pipeline = require('./pipeline');
const aggregate = require('./recognize-aggregate');

const {
  VISION_MAX_EDGE,
  frameSizeOf,
  hasVision,
  imageInfo,
  ocrDeps
} = wxPlatform;

const {
  AI_SUGGESTION_HINT,
  AI_FALLBACK_COPY,
  LOW_CODE_MISSING_COPY,
  aiFallbackCopy,
  contentHashOf,
  failureRequestIdOf,
  failureCopyFor,
  failureResultOf,
  failureRowsOf
} = aiFallback;

const OCR_TIMEOUT_MS = 40000;
const MAX_PARCELS = recognize.MAX_PARCELS_PER_ORDER;
const MAX_IMAGES = recognize.MAX_IMAGES_PER_ORDER;

// AI 兜底成功态提示（§4.3.1 ④：只填空字段、手填优先，仍需人核对；AI_SUGGESTION_HINT 单源在 ai-fallback）

/**
 * OCR 失败/无文本时也调一次 AI 兜底接口（CONTRACT §4.3 v1.0）：
 * ocrTextMasked 可为空串——服务端 branch① 直接入队 NO_TEXT、不外呼；带 fileId/uploadTicketId 供复核页看原图。
 * 无票据（上传就失败）时无处关联，返回 null（页面只给手填引导，不谎称已反馈）。
 */
async function queueFailure(file, ocrTextMasked) {
  const ticket = (file && file.uploadTicketId) || '';
  if (!ticket) {
    return null;
  }
  try {
    const text = String(ocrTextMasked || '');
    const requestId = failureRequestIdOf(ticket, 0, text);
    const suggestion = await aiApi.parseParcel({
      ocrTextMasked: text,
      fileId: (file && file.fileId) || '',
      uploadTicketId: ticket,
      role: 'CUSTOMER'
    }, requestId ? { clientRequestId: requestId } : {});
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
    return failureResultOf(file, null, 'IMAGE_UNREADABLE', await queueFailure(file, ''), '');
  }
  const info = await imageInfo(localPath);
  if (!info.ok) {
    // 认不到图也补一次 AI（服务端负责入队；不外呼空文本），不让「失败=静默」
    return failureResultOf(file, null, info.code, await queueFailure(file, ''), info.detail);
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
    return failureResultOf(file, image, result.code, await queueFailure(file, ''), result.detail);
  }
  const maskedText = recognize.maskForAi(result.joined || '');
  const ticket = (file && file.uploadTicketId) || '';
  const stationsOption = (configApi.getCachedPublic() || {}).stations;
  const parsed = recognize.parseOcrText(result.joined || '', { stations: stationsOption });
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
      ocrTextMasked: maskedText,
      hintTrackingTail: parsed.trackingTail || '',
      uploadTicketId: ticket,
      fileId: (file && file.fileId) || '',
      role: 'CUSTOMER',
      requestIdOf: function requestIdOf(index) {
        return failureRequestIdOf(ticket, index, maskedText);
      }
    }, aiApi.parseParcel);
    items = fallback.items;
    aiUsed = fallback.changed > 0;
    aiFailed = fallback.failed;
    aiFallbackState = (items[0] && items[0].aiState) || '';
    items.forEach(function label(item) {
      if (item.aiPickupCodeUnaligned) unalignedCode = item.aiPickupCodeUnaligned;
      if (!item.aiSuggestion && item.aiState && item.aiState !== 'OK') item.aiHint = aiFallbackCopy(item.aiState, item).text;
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
 * 多图识别汇总（0~10 张 → 总包裹 ≤10）。
 * P0-1：识别并发上限 PIPELINE_CONCURRENCY（=2 单源），结果仍按图序回填（runOrdered 保序）；
 * 失败单图不阻塞其它图；合并/来源图/失败行口径在 recognize-aggregate 纯件（全量与流式同一份）。
 */
async function identifyMany(files, onState) {
  const list = validIdentifyFiles(files);
  if (list.length === 0) return aggregate.emptyResult();
  const progress = { max: 0 };
  const run = await pipeline.runOrdered(list, function one(file, index) {
    return identify(file, function phase(state) {
      emitOcrState(onState, progress, state || {}, index + 1, list.length);
    });
  }, {
    concurrency: pipeline.PIPELINE_CONCURRENCY,
    onStart: function start(info) {
      emitOcrState(onState, progress, { phase: 'ocr' }, info.started, list.length);
    }
  });
  return aggregate.summarize(list, resultsOfOutcomes(list, run.results));
}

/**
 * 流式识别会话（P0-1 页面编排侧）：组件每批上传完成即 feed 该批图——该图识别与后续上传重叠，
 * 不必等全部上传完成；change 收口时 finish 按「页面 files 顺序」汇总。同一 fileId 只识别一次
 *（累计/重复事件不重复识别、不重复上传票据）；结果按图序回填，进度序号单调。
 * @param {function} onState 逐图阶段回调（{phase,index,total}，index 单调不倒退）
 * @returns {{feed:function(files):object, finish:function(files):Promise<object>}}
 */
function createIdentifySession(onState) {
  const progress = { max: 0 };
  const session = pipeline.createSession({
    concurrency: pipeline.PIPELINE_CONCURRENCY,
    keyOf: pipeline.fileKeyOf,
    onStart: function start(info) {
      emitOcrState(onState, progress, { phase: 'ocr' }, info.started, info.seen);
    },
    work: function work(file, index) {
      return identify(file, function phase(state) {
        emitOcrState(onState, progress, state || {}, index + 1, 0);
      });
    }
  });
  return {
    feed: function feed(files) { return session.feed(validIdentifyFiles(files)); },
    finish: function finish(files) {
      const list = validIdentifyFiles(files);
      // 幂等补喂：即使 uploaded 事件漏发也不漏图（session.feed 内按 fileId 去重）
      session.feed(list);
      return session.finish(list).then(function done(out) {
        return aggregate.summarize(list, resultsOfOutcomes(list, out.results));
      });
    }
  };
}

/** 合法识别文件（有本地路径；D40 上限 MAX_IMAGES=10） */
function validIdentifyFiles(files) {
  return (Array.isArray(files) ? files : []).filter(function valid(file) {
    return !!(file && file.localPath);
  }).slice(0, MAX_IMAGES);
}

/** 逐图阶段回调：序号单调钳制（并发下 A 图 AI 阶段事件晚于 B 图开始时，n 不倒退，D40） */
function emitOcrState(onState, progress, state, index, total) {
  if (typeof onState !== 'function') return;
  progress.max = pipeline.monotonicIndex(progress.max, index);
  const totalValue = Math.max(Math.floor(Number(total) || 0), progress.max);
  onState(Object.assign({}, state, { index: progress.max, total: totalValue }));
}

/** 流水线结果 → 单图识别结果（单项异常按失败图降级，不让一张图拖垮整批） */
function resultsOfOutcomes(list, outcomes) {
  return (outcomes || []).map(function one(outcome, index) {
    if (outcome && outcome.ok) return outcome.value;
    const error = outcome && outcome.error;
    const detail = String((error && error.message) || '');
    return failureResultOf(list[index], null, 'IMAGE_UNREADABLE', null, detail);
  });
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
  LOW_CODE_MISSING_COPY,
  aiFallbackCopy,
  contentHashOf,
  failureRequestIdOf,
  failureResultOf,
  failureRowsOf,
  failureCopyFor,
  frameSizeOf,
  hasVision,
  createIdentifySession,
  identify,
  identifyMany,
  mergeItems,
  queueFailure,
  imageInfo
};
