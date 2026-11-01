// pkg-customer/pages/pickup-list/parts/local-ocr.js · 本机清单「识别截图」页面零件（允许 wx）
// D57：本机清单的截图识别是**端侧能力**——只做 wx.chooseMedia 选图 + VKSession 端侧 OCR：
//   零 wx.cloud、零 api/upload（不上传截图）、零 api/modules/ai（不外呼第三方 AI）、零本机存储写入。
// 平台适配单源在 utils/ocr/wx-platform.js（与顾客下单页 ocr-flow 共用）；纯逻辑单源在 utils/ocr。
// 页面只拿文本：parseCodeText/mergeEntries/addLocalCodes 由页面统一编排（本件不碰存储、不拼业务文案）。
'use strict';

const ocr = require('../../../../utils/ocr/index');
const platform = require('../../../../utils/ocr/wx-platform');

const MAX_IMAGES = 9; // 一次最多选 9 张（微信 chooseMedia 上限）
const EDGE = platform.VISION_MAX_EDGE;

function isCancelOf(err) {
  return /cancel/i.test(String((err && err.errMsg) || ''));
}

/** 选图（相册/拍照二选一入口统一；取消不算错误，不打扰用户） */
function pickImages() {
  return new Promise(function executor(resolve) {
    wx.chooseMedia({
      count: MAX_IMAGES,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: function ok(res) {
        const files = (res && res.tempFiles) || [];
        const paths = files.map(function pathOf(item) {
          return String((item && item.tempFilePath) || '');
        }).filter(function nonEmpty(path) {
          return !!path;
        });
        resolve({ ok: true, paths: paths });
      },
      fail: function no(err) {
        resolve({ ok: false, canceled: isCancelOf(err), detail: (err && err.errMsg) || '' });
      }
    });
  });
}

/** 单图端侧识别（不下载/不上传；失败只降级这一张） */
async function identifyOne(filePath) {
  const info = await platform.imageInfo(filePath);
  if (!info || info.ok !== true) {
    return { ok: false, code: (info && info.code) || 'IMAGE_DECODE_FAILED' };
  }
  const result = await ocr.recognize({ filePath: filePath, maxEdge: EDGE }, platform.ocrDeps(info));
  if (!result || result.ok !== true) {
    return { ok: false, code: (result && result.code) || 'NO_TEXT' };
  }
  return { ok: true, texts: result.texts || [] };
}

/**
 * 选图 + 逐张端侧识别（串行：VKSession/离屏画布争抢会互相打断；失败图跳过不阻塞其它图）。
 * @param {function} onState 进度回调（{phase:'pick'|'ocr',index,total}）
 * @returns {Promise<{ok:boolean,canceled:boolean,texts:string[],joined:string,failCount:number,failureCode:string}>}
 */
async function recognizeLocal(onState) {
  const notify = typeof onState === 'function' ? onState : function noop() {};
  if (!platform.hasVision()) {
    return { ok: false, canceled: false, texts: [], joined: '', failCount: 0, failureCode: 'VK_UNSUPPORTED' };
  }
  notify({ phase: 'pick', index: 0, total: 0 });
  const picked = await pickImages();
  if (!picked.ok) {
    return {
      ok: false, canceled: !!picked.canceled, texts: [], joined: '', failCount: 0,
      failureCode: picked.canceled ? '' : 'IMAGE_DECODE_FAILED'
    };
  }
  const paths = picked.paths || [];
  if (paths.length === 0) {
    return { ok: false, canceled: false, texts: [], joined: '', failCount: 0, failureCode: 'NO_TEXT' };
  }
  const texts = [];
  let failCount = 0;
  let failureCode = '';
  for (let index = 0; index < paths.length; index += 1) {
    notify({ phase: 'ocr', index: index + 1, total: paths.length });
    const one = await identifyOne(paths[index]);
    if (one.ok) {
      (one.texts || []).forEach(function push(text) { texts.push(text); });
    } else {
      failCount += 1;
      failureCode = failureCode || one.code;
    }
  }
  const joined = texts.join('\n');
  return {
    ok: joined.length > 0,
    canceled: false,
    texts: texts,
    joined: joined,
    failCount: failCount,
    failureCode: joined.length > 0 ? '' : (failureCode || 'NO_TEXT')
  };
}

/** 进度文案（单源；页面只回填） */
function progressTextOf(state) {
  const spec = state || {};
  const total = Math.max(0, Math.floor(Number(spec.total) || 0));
  const index = Math.max(0, Math.min(total || 0, Math.floor(Number(spec.index) || 0)));
  if (spec.phase === 'pick') return '正在打开相册…';
  if (total <= 0 || index <= 0) return '正在识别截图…';
  return '正在识别第 ' + index + '/' + total + ' 张…';
}

/** 失败码 → 顾客人话（复用 utils/ocr failureCopy 口径，单源不另拼） */
function failureCopyOf(code) {
  return ocr.failureCopy(code || 'NO_TEXT');
}

module.exports = {
  MAX_IMAGES,
  isCancelOf,
  pickImages,
  identifyOne,
  recognizeLocal,
  progressTextOf,
  failureCopyOf
};
