// utils/ocr/index.js · OCR 统一出口（纯逻辑；wx 能力一律由调用方注入）
// 页面只拿 {ok,texts,code,detail}；失败码与 UX 文案映射单源在 utils/recognize。
'use strict';

const frame = require('./frame');
const vision = require('./vision');

const FAILURE_CODES = ['IMAGE_DECODE_FAILED', 'VK_UNSUPPORTED', 'VK_INIT_FAILED', 'NO_TEXT'];

/**
 * @param {object} deps 平台能力注入
 *   deps.hasVision:boolean
 *   deps.loadFrame(filePath, band) -> Promise<{ok,frame,code?,detail?}>
 *   deps.runVision(frame, opts)   -> Promise<{ok,texts,partial?,code?,detail?}>
 *   deps.now():number
 * @param {object} options {filePath,maxEdge}
 * @returns {Promise<{ok:boolean,texts?:string[],joined?:string,code?:string,detail?:string,partial?:boolean}>}
 */
async function recognize(options, deps) {
  const result = await vision.recognizeImage(deps || {}, options || {});
  if (!result.ok) {
    return { ok: false, code: result.code, detail: result.detail };
  }
  const texts = result.texts || [];
  return {
    ok: true,
    texts: texts,
    joined: texts.join('\n'),
    partial: !!result.partial
  };
}

/** 失败码 → 顾客文案 + 下一步（单源；页面不再自己拼） */
const FAILURE_COPY = {
  IMAGE_DECODE_FAILED: {
    text: '这张图没能读出来（可能格式不支持）。',
    next: '换一张图，或手动填写。'
  },
  VK_UNSUPPORTED: {
    text: '这台手机不支持自动识别。',
    next: '手动填写不影响下单。'
  },
  VK_INIT_FAILED: {
    text: '识别服务暂时不可用（可能未开通摄像头权限）。',
    next: '手动填写不影响下单。'
  },
  NO_TEXT: {
    text: '这张图里没认出取件码。',
    next: '可以手动填写，或先提交让兼职帮你核对。'
  }
};

function failureCopy(code) {
  return FAILURE_COPY[code] || {
    text: '识别没有成功。',
    next: '可以手动填写后提交。'
  };
}

module.exports = {
  FAILURE_CODES,
  FAILURE_COPY,
  recognize,
  failureCopy,
  frame,
  vision
};
