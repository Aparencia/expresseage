// pkg-customer/pages/order-create/parts/files-flow.js · 截图增删 → 多图识别 → 件合并（页面零件，允许 wx）
// 页面方法只做一行转发；这里的 page 形参 = 页面实例（提供 data/setData）。
// P1-4：① 无本地图时「重新识别」改为打开选择器（不空转）；② 有图时原地重识别——复用已上传的
//   fileId/票据，不重新上传；③ 清空已识别件前二次确认（UX §4.5「重新识别需确认清空」，手填件保留）；
// ④ 上传失败卡给两条真实出路：重新选择截图 / 不传截图手动填写（D24 下两者都合法）。
// P0-1（性能）：⑤ 组件每批上传完成即触发 uploaded——新增图立刻进识别会话（与后续上传重叠，不必等
//   全部上传完成）；change 收口时按 files 顺序汇总，同一 fileId 只识别一次（累计/重复事件不重复识别）。
'use strict';

const model = require('./model');
const ocrFlow = require('./ocr-flow');

const MAX_PARCELS = model.MAX_PARCELS;
const MAX_IMAGES = model.MAX_IMAGES;
// D24：上传失败不阻断下单——失败卡文案给「补截图」与「不传截图手填」两条路，不再指向不可能路径
const FAIL_NEXT_UPLOAD = '可以重新选择截图；也可以不传截图，手动填写后提交。';

/** 把「当前 files 对应的件/来源图快照」写回页面（保留已有手填件；0 件时停在 Step1 给失败卡） */
function applyIdentify(page, items, perImage, patch) {
  const built = model.buildImages(perImage);
  const defaults = page.itemDefaults();
  // P0-1：件级 imageIndex 是文件序号，必须先按 buildImages 的映射改成 images[] 下标（被过滤图对应件置 -1）
  const mapped = model.remapImageIndexes((items || []).slice(0, MAX_PARCELS)
    .map((item) => model.makeItem(item, defaults)), built.imageIndexMap);
  const next = Object.assign({
    perImage: perImage,
    images: built.images,
    tickets: built.tickets,
    items: mapped
  }, patch || {});
  if (next.ocrState === 'done' && page.data.step === 1) next.step = 2;
  page.setData(next);
}

/** 丢弃当前识别会话（重新识别/失败卡先丢旧会话：迟到的旧结果不再参与本次收口） */
function discardSession(page) {
  const session = page._ocrSession || null;
  page._ocrSession = null;
  return session;
}

/** 取消代次（页面实例态，不进 data）：取消/手动填写后旧会话进度与迟到收口据此作废 */
function cancelGenOf(page) {
  return typeof page._ocrCancelGen === 'number' ? page._ocrCancelGen : 0;
}

/** 迟到收口判据：取消代次已变 → 本轮结果作废（不覆盖已手填/已取消态、不自动跳步骤） */
function runCanceled(page, gen) {
  return cancelGenOf(page) !== gen;
}

/** 放弃本次智能识别（§4.3.1 ③）：丢弃在飞会话并让迟到结果作废（取消/先手动填写共用单源） */
function cancelRun(page) {
  discardSession(page);
  page._ocrCancelGen = cancelGenOf(page) + 1;
  return page._ocrCancelGen;
}

/** 当前选图轮的识别会话（P0-1：同一轮多批上传共用一个会话；会话只在页面实例上，不进 data） */
function sessionOf(page) {
  if (!page._ocrSession) {
    const gen = cancelGenOf(page);
    page._ocrSession = ocrFlow.createIdentifySession(function onState(state) {
      // P1-10：取消后旧会话的进度事件同样不上屏（避免取消后界面又跳回识别中）
      if (runCanceled(page, gen)) return;
      page.onOcrPhase(state);
    });
  }
  return page._ocrSession;
}

/** 已识别/已失败过来源图的 fileId（重复的累计事件只识别真正新增的图） */
function knownFileIdsOf(page) {
  const known = {};
  (page.data.perImage || []).forEach(function each(entry) {
    const fileId = (entry && entry.image && entry.image.fileId) || '';
    if (fileId) known[fileId] = true;
  });
  return known;
}

/** 本轮新增图（有本地路径且没识别过的来源图；手填件不算） */
function freshFilesOf(page, files) {
  const known = knownFileIdsOf(page);
  return (Array.isArray(files) ? files : []).filter(function keep(file) {
    return !!(file && file.localPath) && !known[file.fileId];
  });
}

/**
 * 组件 uploaded 事件（P0-1）：每批上传完成即把新增图交给识别会话——该图识别与后续批次上传重叠，
 * 不必等全部上传完成；页面只更新文件快照与上传态，判据/编排都在 parts/。
 */
function onUploaded(page, e) {
  if (page.data.readonly) return;
  const files = ((e && e.detail && e.detail.files) || []).slice(0, MAX_IMAGES);
  if (files.length === 0) return;
  const fresh = freshFilesOf(page, files);
  const patch = { files: files, ocrError: '' };
  // 识别已在进行时不要把进度态打回「上传中」（并发图识别与后一批上传同时存在）
  if (page.data.ocrState !== 'ocr' && page.data.ocrState !== 'ai') patch.ocrState = 'upload';
  page.setData(patch);
  if (fresh.length > 0) sessionOf(page).feed(fresh);
}

/**
 * 串行化识别收口（P0-1）：两轮选图/重新识别的收口不并发改 page.items/perImage——
 * 并发下后到的轮次会在前一轮合并完成后才对齐/合并，避免乱序或重复件（页面实例上排队，不进 data）。
 */
function queueRun(page, task) {
  const previous = page._ocrChain || Promise.resolve();
  const next = previous.then(task, task);
  page._ocrChain = next.then(function noop() {}, function noop() {});
  return next;
}

/** 失败卡出口计划（纯函数）：无本地图 → 打开选择器；有图 → 原地重识别（有已识别件先确认清空） */
function retryPlanOf(data) {
  const value = data || {};
  const files = Array.isArray(value.files) ? value.files : [];
  if (files.length === 0) {
    return { mode: 'picker', source: 'album', confirm: false };
  }
  const identified = (Array.isArray(value.items) ? value.items : []).filter(function isId(item) {
    return !!item && item.manual !== true;
  });
  return { mode: 'ocr', source: 'ocr', confirm: identified.length > 0 };
}

/** 现有件/来源图按 fileId 对齐到新 files 顺序（手填件保留，换图/删图不丢手填） */
function alignToFiles(page, files) {
  const byFileId = {};
  (page.data.perImage || []).forEach(function index(entry) {
    const fid = (entry.image && entry.image.fileId) || '';
    if (fid) byFileId[fid] = entry;
  });
  // P0-1：页面件的 imageIndex 已是 images[] 下标（applyIdentify 重映射后），先还原为来源图 fileId，
  // 再按新 files 顺序重新定位——不能拿它直接当文件序号（过滤过图时两者不相等）。
  const fileIdByImageIndex = (page.data.images || []).map(function map(image) {
    return (image && image.fileId) || '';
  });
  const indexByFileId = {};
  files.forEach(function order(file, newIndex) {
    if (file && file.fileId) indexByFileId[file.fileId] = newIndex;
  });
  const perImage = [];
  files.forEach(function order(file, newIndex) {
    if (byFileId[file.fileId]) perImage.push(Object.assign({}, byFileId[file.fileId], { imageIndex: newIndex }));
  });
  const items = [];
  (page.data.items || []).forEach(function keep(item) {
    if (item.manual === true) {
      items.push(Object.assign({}, item, { imageIndex: -1 }));
      return;
    }
    const fid = fileIdByImageIndex[item.imageIndex] || '';
    const newIndex = fid && Object.prototype.hasOwnProperty.call(indexByFileId, fid) ? indexByFileId[fid] : -1;
    if (newIndex >= 0) items.push(Object.assign({}, item, { imageIndex: newIndex }));
  });
  const added = files.filter(function picked(file) {
    return !byFileId[file.fileId];
  });
  return { items: items, perImage: perImage, added: added };
}

/** 识别结果 → 页面 patch（成功进 Step2；失败停在 Step1 给失败卡） */
function resultPatchOf(result, merged) {
  const patch = {
    imageFailures: (result && result.failures) || [],
    aiHint: result && result.aiUsed === true ? ocrFlow.AI_SUGGESTION_HINT : '',
    ocrText: (result && result.ocrText) || '',
    ocrTextOpen: false,
    manualPicked: false
  };
  if (merged.truncated) patch.recognizeHint = '一张订单最多 ' + MAX_PARCELS + ' 件，超出的件请分单提交';
  if (result && result.ok && merged.items.length > 0) {
    patch.ocrState = 'done';
    return patch;
  }
  const copy = (result && result.failureCopy) || { text: '没识别出来。', next: '可以手动填写。' };
  patch.ocrState = 'failed';
  patch.failureText = copy.text;
  patch.failureNext = copy.next;
  return patch;
}

/**
 * 跑一轮识别并把结果写回页面（选图与重新识别共用；识别本身不重新上传）。
 * session 非空时走「已经边上传边识别」的会话收口（同一 fileId 不重复识别），否则退化为一次性识别。
 * P1-10：收口前记录取消代次——用户取消/先手动填写后，迟到的识别结果整轮作废（不覆盖、不自动跳步骤）。
 */
async function runIdentify(page, files, keptItems, keptPerImage, session) {
  const list = (Array.isArray(files) ? files : []).slice(0, MAX_IMAGES);
  const gen = cancelGenOf(page);
  const phase = function phase(state) {
    if (!runCanceled(page, gen)) page.onOcrPhase(state);
  };
  page.setData({ ocrState: 'upload' });
  try {
    const result = session
      ? await session.finish(list)
      : await ocrFlow.identifyMany(list, phase);
    if (runCanceled(page, gen)) return;
    const merged = ocrFlow.mergeItems(keptItems, keptPerImage, result);
    applyIdentify(page, merged.items, merged.perImage, resultPatchOf(result, merged));
  } catch (err) {
    if (runCanceled(page, gen)) return;
    applyIdentify(page, keptItems, keptPerImage, {
      ocrState: 'failed',
      ocrError: (err && err.message) || '识别失败，可手动填写'
    });
  }
}

/** 无本地图时打开系统选择器（组件公开方法；不空转、不 toast 死胡同） */
function openPicker(page) {
  const picker = typeof page.selectComponent === 'function' ? page.selectComponent('#ticketPicker') : null;
  if (!picker || typeof picker.openSource !== 'function') {
    wx.showToast({ title: '请点「从相册选择」重新选择截图', icon: 'none' });
    return false;
  }
  picker.openSource('album');
  return true;
}

/** 重新识别前二次确认（UX §4.5：确认后清空该图识别出的件、保留手填件） */
function confirmClear() {
  return new Promise(function executor(resolve) {
    wx.showModal({
      title: '重新识别',
      content: '重新识别会清空这张图识别出的件（手填件保留），确定继续？',
      success: function done(res) {
        resolve(!!(res && res.confirm));
      },
      fail: function no() {
        resolve(false);
      }
    });
  });
}

async function onRetryOcr(page) {
  if (page.data.readonly) {
    wx.showToast({ title: '开发者只读视角不能操作', icon: 'none' });
    return;
  }
  const plan = retryPlanOf(page.data);
  if (plan.mode === 'picker') {
    openPicker(page);
    return;
  }
  if (plan.confirm && !(await confirmClear())) {
    return;
  }
  return queueRun(page, function retryRound() {
    const files = (page.data.files || []).slice(0, MAX_IMAGES);
    const manualItems = (page.data.items || []).filter(function isManual(item) {
      return !!item && item.manual === true;
    });
    discardSession(page); // 重新识别：先丢弃可能还在飞的旧会话，迟到的旧结果不再参与收口
    page.setData({ failureText: '', failureNext: '', ocrError: '', imageFailures: [], aiHint: '' });
    return runIdentify(page, files, manualItems, []);
  });
}

/**
 * §4.3.1 ③「取消」：放弃本次智能识别——丢弃在飞会话并推进取消代次，迟到的进度事件与识别结果
 * 都不再上屏，也不自动跳步骤（文案仍按 USER_CANCEL，口径在 parts/ai-fallback 单源）。
 */
function onCancelAi(page) {
  cancelRun(page);
  const copy = ocrFlow.aiFallbackCopy('USER_CANCEL');
  page.setData({
    manualPicked: true,
    ocrState: 'failed',
    failureText: copy.text,
    failureNext: copy.next,
    aiHint: ''
  });
}

async function onPickFile(page, e) {
  if (page.data.readonly) {
    wx.showToast({ title: '开发者只读视角不能操作', icon: 'none' });
    return;
  }
  const files = ((e.detail && e.detail.files) || []).slice(0, MAX_IMAGES);
  return queueRun(page, function pickRound() {
    return pickRoundOf(page, files);
  });
}

/** 一轮选图的收口：对齐已有件 → 用上传期间已边传边识别的会话收口 → 合并写回 */
async function pickRoundOf(page, files) {
  const aligned = alignToFiles(page, files);
  // P0-1：本轮上传期间 uploaded 可能已边传边识别——change 收口时用同一会话，按 files 顺序汇总。
  const session = discardSession(page);
  const added = freshFilesOf(page, aligned.added);
  page.setData({
    files: files,
    submission: model.clearSubmission(),
    ocrError: '',
    failureText: '',
    failureNext: '',
    imageFailures: [],
    aiHint: ''
  });
  if (added.length === 0 && !session) {
    applyIdentify(page, aligned.items, aligned.perImage, {
      ocrState: aligned.items.length > 0 ? page.data.ocrState : 'idle'
    });
    return;
  }
  await runIdentify(page, added, aligned.items, aligned.perImage, session);
}

function onPickError(page, e) {
  const detail = (e && e.detail) || {};
  discardSession(page);
  const files = (detail.files || page.data.files || []).slice(0, MAX_IMAGES);
  const message = detail.message || '截图上传失败。';
  if (files.length > 0) {
    // 多图半途失败：已上传的图保留，提示补传；不清空已识别件
    page.setData({ files: files, ocrError: message, ocrState: 'idle' });
    wx.showToast({ title: message, icon: 'none' });
    return;
  }
  page.setData({
    ocrState: 'failed',
    failureCode: detail.reason || 'IMAGE_UNREADABLE',
    failureText: message,
    failureNext: FAIL_NEXT_UPLOAD,
    files: [], perImage: [], images: [], tickets: [],
    ocrText: '',
    ocrTextOpen: false,
    aiHint: '',
    submission: model.clearSubmission(),
    manualPicked: false
  });
}

module.exports = {
  FAIL_NEXT_UPLOAD,
  applyIdentify,
  cancelRun,
  retryPlanOf,
  onUploaded,
  onPickFile,
  onPickError,
  onRetryOcr,
  onCancelAi,
  runIdentify
};
