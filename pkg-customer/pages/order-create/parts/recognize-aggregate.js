// pkg-customer/pages/order-create/parts/recognize-aggregate.js · 多图识别结果聚合（纯件，零 wx）
// 口径：CONTRACT §4.3 v1.0（NO_TEXT 也入队、失败卡说真话）、DATA_MODEL §4.9（同图多件逐件记录）、
//      D23 一单多包裹（0~10 张图 → 总件 ≤10，每件带 imageIndex 指向来源图）、D40 逐图识别。
// 全量识别（ocr-flow.identifyMany）与流式重叠识别（ocr-flow.createIdentifySession.finish）共用本口径，
// 避免两条路径各写一份合并/失败汇总（P0-1 拆出后仍一处判据）。
'use strict';

const ocr = require('../../../../utils/ocr/index');
const recognize = require('../../../../utils/recognize/index');
const aiFallback = require('./ai-fallback');

const MAX_PARCELS = recognize.MAX_PARCELS_PER_ORDER;

/** 0 图（或没进入识别）的失败形态：不空转、给失败卡人话文案（D24 手填支路仍在） */
function emptyResult() {
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

/** 每件补 imageIndex 指向来源图（合并前先打标，避免 mergeParcels 后无法回溯来源） */
function tagByImage(results) {
  return results.map(function map(result, index) {
    return (result.items || []).map(function tag(item) {
      return Object.assign({}, item, { imageIndex: index });
    });
  });
}

/** 来源图快照（只有拿到 fileId 的图才算数；images[i] ↔ tickets[i] 由 perImage 保序） */
function imagesOf(results) {
  return results.map(function map(result) { return result.image; }).filter(function has(image) {
    return !!(image && image.fileId);
  });
}

/** 每张来源图的快照与票据（D23 契约：按 imageIndex 与文件列表一一对应，不按过滤后下标猜） */
function perImageOf(list, results) {
  return results.map(function each(result, index) {
    const file = list[index] || {};
    return {
      imageIndex: index,
      ticket: typeof file.uploadTicketId === 'string' ? file.uploadTicketId : '',
      image: result.image || null,
      failureId: result.failureId || '',
      failureCode: result.failureCode || ''
    };
  });
}

function ocrTextOf(results) {
  return results.map(function text(result) { return result.ocrText || ''; })
    .filter(function nonEmpty(value) { return !!value; })
    .join('\n');
}

function baseFieldsOf(list, results) {
  return {
    ok: false,
    files: list,
    images: imagesOf(results),
    items: [],
    failureCode: 'NO_TEXT',
    failureCopy: ocr.failureCopy('NO_TEXT'),
    failureId: '',
    aiTried: results.some(function tried(result) { return result.aiTried === true; }),
    aiUsed: results.some(function used(result) { return result.aiUsed === true; }),
    ocrText: ocrTextOf(results),
    failures: aiFallback.failureRowsOf(results)
  };
}

/** 一件都没合并出（全失败/空壳）：取第一张有人话文案的失败图，不谎报成功 */
function failedResultOf(base, results) {
  const first = results.filter(function bad(result) { return !!result.failureCopy; })[0] || null;
  return Object.assign({}, base, {
    ok: false,
    aiUsed: false,
    failureCode: (first && first.failureCode) || 'NO_TEXT',
    failureCopy: (first && first.failureCopy) || ocr.failureCopy('NO_TEXT'),
    failureId: (first && first.failureId) || ''
  });
}

/**
 * 汇总多图识别结果（纯函数）。
 * @param {object[]} list 本次识别的文件（与 results 同序）
 * @param {object[]} results identify 单图结果（同序；失败项也在内）
 * @returns {object} 页面 resultPatchOf/mergeItems 消费的统一形状
 */
function summarize(list, results) {
  const files = (Array.isArray(list) ? list : []).slice();
  const rows = (Array.isArray(results) ? results : []).slice();
  const base = baseFieldsOf(files, rows);
  const merged = recognize.mergeParcels(tagByImage(rows), { max: MAX_PARCELS });
  if (merged.items.length === 0) {
    return failedResultOf(base, rows);
  }
  return Object.assign({}, base, {
    ok: true,
    perImage: perImageOf(files, rows),
    items: merged.items,
    duplicated: merged.duplicated,
    dropped: merged.dropped,
    truncated: merged.truncated,
    needsReview: rows.some(function review(result) { return result.needsReview === true; })
      || merged.truncated
  });
}

module.exports = { MAX_PARCELS, emptyResult, summarize };
