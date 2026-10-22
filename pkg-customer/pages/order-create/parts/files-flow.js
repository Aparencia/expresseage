// pkg-customer/pages/order-create/parts/files-flow.js · 截图增删 → 多图识别 → 件合并（页面零件，允许 wx）
// 页面方法只做一行转发；这里的 page 形参 = 页面实例（提供 data/setData）。
'use strict';

const model = require('./model');
const ocrFlow = require('./ocr-flow');

const MAX_PARCELS = model.MAX_PARCELS;
const MAX_IMAGES = model.MAX_IMAGES;

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

async function onPickFile(page, e) {
  if (page.data.readonly) {
    wx.showToast({ title: '开发者只读视角不能操作', icon: 'none' });
    return;
  }
  const files = ((e.detail && e.detail.files) || []).slice(0, MAX_IMAGES);
  const oldPerImage = page.data.perImage || [];
  const byFileId = {};
  const oldFileIdOfIndex = {};
  oldPerImage.forEach(function index(entry) {
    const fid = (entry.image && entry.image.fileId) || '';
    oldFileIdOfIndex[entry.imageIndex] = fid;
    if (fid) byFileId[fid] = entry;
  });
  const keptPerImage = [];
  files.forEach(function order(file, newIndex) {
    if (byFileId[file.fileId]) keptPerImage.push(Object.assign({}, byFileId[file.fileId], { imageIndex: newIndex }));
  });
  const keptItems = [];
  (page.data.items || []).forEach(function keep(item) {
    if (item.manual === true) {
      keptItems.push(Object.assign({}, item, { imageIndex: -1 }));
      return;
    }
    const fid = oldFileIdOfIndex[item.imageIndex] || '';
    let newIndex = -1;
    files.forEach(function find(file, i) {
      if (fid && file.fileId === fid) newIndex = i;
    });
    if (newIndex >= 0) keptItems.push(Object.assign({}, item, { imageIndex: newIndex }));
  });
  const added = files.filter(function picked(file) { return !byFileId[file.fileId]; });
  page.setData({
    files: files,
    submission: model.clearSubmission(),
    ocrError: '',
    failureText: '',
    failureNext: '',
    imageFailures: [],
    aiHint: ''
  });
  if (added.length === 0) {
    applyIdentify(page, keptItems, keptPerImage, { ocrState: keptItems.length > 0 ? page.data.ocrState : 'idle' });
    return;
  }
  page.setData({ ocrState: 'upload' });
  try {
    const result = await ocrFlow.identifyMany(added, (state) => page.onOcrPhase(state));
    const merged = ocrFlow.mergeItems(keptItems, keptPerImage, result);
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
    } else {
      const copy = (result && result.failureCopy) || { text: '没识别出来。', next: '可以手动填写。' };
      patch.ocrState = 'failed';
      patch.failureCode = (result && result.failureCode) || 'NO_TEXT';
      patch.failureText = copy.text;
      patch.failureNext = copy.next;
    }
    applyIdentify(page, merged.items, merged.perImage, patch);
  } catch (err) {
    applyIdentify(page, keptItems, keptPerImage, {
      ocrState: 'failed',
      ocrError: (err && err.message) || '识别失败，可手动填写'
    });
  }
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
    failureNext: '可以重试，或手动填写后提交。',
    files: [], perImage: [], images: [], tickets: [],
    ocrText: '',
    ocrTextOpen: false,
    aiHint: '',
    submission: model.clearSubmission(),
    manualPicked: false
  });
}

module.exports = {
  applyIdentify,
  onPickFile,
  onPickError
};
