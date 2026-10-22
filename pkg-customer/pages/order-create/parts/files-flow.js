// pkg-customer/pages/order-create/parts/files-flow.js · 截图增删 → 多图识别 → 件合并（页面零件，允许 wx）
// 页面方法只做一行转发；这里的 page 形参 = 页面实例（提供 data/setData）。
// P1-4：① 无本地图时「重新识别」改为打开选择器（不空转）；② 有图时原地重识别——复用已上传的
//   fileId/票据，不重新上传；③ 清空已识别件前二次确认（UX §4.5「重新识别需确认清空」，手填件保留）；
// ④ 上传失败卡给两条真实出路：重新选择截图 / 不传截图手动填写（D24 下两者都合法）。
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
  const next = Object.assign({
    perImage: perImage,
    images: built.images,
    tickets: built.tickets,
    items: (items || []).slice(0, MAX_PARCELS).map((item) => model.makeItem(item, defaults))
  }, patch || {});
  if (next.ocrState === 'done' && page.data.step === 1) next.step = 2;
  page.setData(next);
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
  const oldFileIdOfIndex = {};
  (page.data.perImage || []).forEach(function index(entry) {
    const fid = (entry.image && entry.image.fileId) || '';
    oldFileIdOfIndex[entry.imageIndex] = fid;
    if (fid) byFileId[fid] = entry;
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
    const fid = oldFileIdOfIndex[item.imageIndex] || '';
    let newIndex = -1;
    files.forEach(function find(file, i) {
      if (fid && file.fileId === fid) newIndex = i;
    });
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
    failureId: (result && result.failureId) || '',
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
  patch.failureCode = (result && result.failureCode) || 'NO_TEXT';
  patch.failureText = copy.text;
  patch.failureNext = copy.next;
  return patch;
}

/** 跑一轮识别并把结果写回页面（选图与重新识别共用；识别本身不重新上传） */
async function runIdentify(page, files, keptItems, keptPerImage) {
  page.setData({ ocrState: 'upload' });
  try {
    const result = await ocrFlow.identifyMany(files, (state) => page.onOcrPhase(state));
    const merged = ocrFlow.mergeItems(keptItems, keptPerImage, result);
    applyIdentify(page, merged.items, merged.perImage, resultPatchOf(result, merged));
  } catch (err) {
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
  const files = (page.data.files || []).slice(0, MAX_IMAGES);
  const manualItems = (page.data.items || []).filter(function isManual(item) {
    return !!item && item.manual === true;
  });
  page.setData({ failureText: '', failureNext: '', ocrError: '', imageFailures: [], aiHint: '' });
  await runIdentify(page, files, manualItems, []);
}

async function onPickFile(page, e) {
  if (page.data.readonly) {
    wx.showToast({ title: '开发者只读视角不能操作', icon: 'none' });
    return;
  }
  const files = ((e.detail && e.detail.files) || []).slice(0, MAX_IMAGES);
  const aligned = alignToFiles(page, files);
  page.setData({
    files: files,
    submission: model.clearSubmission(),
    ocrError: '',
    failureText: '',
    failureNext: '',
    imageFailures: [],
    aiHint: ''
  });
  if (aligned.added.length === 0) {
    applyIdentify(page, aligned.items, aligned.perImage, {
      ocrState: aligned.items.length > 0 ? page.data.ocrState : 'idle'
    });
    return;
  }
  await runIdentify(page, aligned.added, aligned.items, aligned.perImage);
}

function onPickError(page, e) {
  const detail = (e && e.detail) || {};
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
  retryPlanOf,
  onPickFile,
  onPickError,
  onRetryOcr
};
