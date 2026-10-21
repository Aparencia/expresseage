// utils/ocr/frame.js · 帧诊断与图像规格（纯函数，零 wx）
// 输入：调用方注入的帧描述（宽高/像素/错误码）；输出：可送给识别内核的帧或统一失败形状。
'use strict';

const MIN_EDGE = 64; // 小于此边长的帧不可识别（对不出字）
const MAX_EDGE = 4096; // 大于此边长的帧先降采样（内存/性能守卫）
const DEFAULT_MAX_EDGE = 1440; // v3 阶梯：OCR 前长边压到 1440

function fail(code, detail) {
  return { ok: false, code: code, detail: detail || '' };
}

function clampMaxEdge(maxEdge) {
  const value = Number(maxEdge) || DEFAULT_MAX_EDGE;
  if (value < MIN_EDGE) return MIN_EDGE;
  if (value > MAX_EDGE) return MAX_EDGE;
  return value;
}

/**
 * 在保持比例的前提下计算识别用尺寸。
 * @param {number} width 原图宽
 * @param {number} height 原图高
 * @param {number} [maxEdge] 目标长边
 * @returns {{ok:boolean,width?:number,height?:number,scale?:number,code?:string,detail?:string}}
 */
function frameSize(width, height, maxEdge) {
  const w = Number(width);
  const h = Number(height);
  if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) {
    return fail('IMAGE_DECODE_FAILED', '读不到图片尺寸');
  }
  if (w < MIN_EDGE || h < MIN_EDGE) {
    return fail('IMAGE_DECODE_FAILED', '图片太小，无法识别');
  }
  const edge = clampMaxEdge(maxEdge);
  const scale = Math.min(1, edge / Math.max(w, h));
  return {
    ok: true,
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    scale: scale
  };
}

/**
 * 校验一个帧描述是否可送识别内核。
 * frame = {width,height,data?,errno?}
 * data 为像素时要求非空；data 缺省表示由平台层按 filePath 直接解码。
 */
function isUsableFrame(frame) {
  if (!frame || typeof frame !== 'object') {
    return fail('IMAGE_DECODE_FAILED', '没有取到图像帧');
  }
  if (frame.errno) {
    return fail('IMAGE_DECODE_FAILED', '解码失败（errno=' + frame.errno + '）');
  }
  const sized = frameSize(frame.width, frame.height, frame.maxEdge);
  if (!sized.ok) return sized;
  if (frame.data !== undefined && frame.data !== null && !(frame.data.byteLength > 0)) {
    return fail('IMAGE_DECODE_FAILED', '帧像素为空');
  }
  return { ok: true, frame: frame, size: sized };
}

/** 纵向按比例切成若干条带，用于 NO_TEXT 阶梯（逐带重试，最多 4 带）。 */
function bandRanges(bands) {
  const count = Math.max(1, Math.min(4, Number(bands) || 1));
  const ranges = [];
  for (let i = 0; i < count; i += 1) {
    ranges.push({ index: i, from: i / count, to: (i + 1) / count });
  }
  return ranges;
}

module.exports = {
  MIN_EDGE,
  MAX_EDGE,
  DEFAULT_MAX_EDGE,
  fail,
  frameSize,
  isUsableFrame,
  bandRanges
};
