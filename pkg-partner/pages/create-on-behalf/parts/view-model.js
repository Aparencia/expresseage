// pkg-partner/pages/create-on-behalf/parts/view-model.js · 代客下单视图快照纯件（零 wx、零请求）
// 职责：把页面 state 装配成 setData 数据（字段名/兜底/摘要文本单源）；页面 render() 只做一次 setData。
// 口径：UX_PARTNER §3.4（三步页面；逐件取件卡；截图 0~10；识别进度/取消）；D44（站点逐件、多图）。
'use strict';

const formModel = require('./form-model');

function textOf(value) { return typeof value === 'string' ? value.trim() : ''; }
function listOf(value) { return Array.isArray(value) ? value : []; }
function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function customerSummaryOf(state, binding) {
  if (state.customerMode === 'BOUND') {
    return '已绑定：' + (binding ? binding.label : '未选择');
  }
  const guest = state.guest || {};
  const name = textOf(guest.displayName) || '未填称呼';
  return '新顾客（代客单）：' + name + (textOf(guest.phoneTail) ? ' · 尾号' + textOf(guest.phoneTail) : '');
}

function bindingsViewOf(state) {
  const binding = formModel.currentBinding(state);
  return {
    bindingOptions: listOf(state.bindingOptions),
    bindingIndex: numberOr(state.bindingIndex, 0),
    bindingLabel: binding ? binding.label : '',
    bindingSub: binding ? binding.sub : ''
  };
}

function servicesViewOf(state) {
  const service = formModel.currentService(state);
  return {
    services: listOf(state.services),
    servicesEmpty: listOf(state.services).length === 0,
    serviceIndex: numberOr(state.serviceIndex, 0),
    serviceName: service ? service.name : '',
    // D41 解释展示位：picker 下方一行说明（名称只说"做什么"，零费用语义）
    serviceDesc: service ? textOf(service.desc) : ''
  };
}

function appointViewOf(state) {
  const appoint = formModel.currentAppoint(state);
  return {
    appointOptions: listOf(state.appointOptions),
    appointIndex: numberOr(state.appointIndex, 0),
    appointLabel: appoint.label || '',
    appointNotice: state.appointNotice || ''
  };
}

function imagesViewOf(state) {
  const files = listOf(state.files).filter(function has(file) { return !!textOf(file.fileId); });
  return {
    files: listOf(state.files),
    imageCount: files.length,
    imageMax: formModel.IMAGE_MAX,
    noImage: files.length === 0
  };
}

function itemsViewOf(state) {
  const items = listOf(state.items);
  return {
    items: items,
    itemsCount: items.length,
    canAddItem: items.length < formModel.BATCH_MAX,
    stationLines: formModel.stationLinesOf(state)
  };
}

/** 页面 setData 快照：render() 唯一数据源（新逻辑进本纯件，页面不堆字段拼装） */
function build(state, options) {
  const source = state || {};
  const opt = options || {};
  const binding = formModel.currentBinding(source);
  return Object.assign({
    step: numberOr(opt.step, 1),
    readonly: opt.readonly === true,
    submitting: opt.submitting === true,
    errorText: textOf(opt.errorText),
    result: opt.result || null,
    customerMode: source.customerMode,
    modes: formModel.CUSTOMER_MODES.map(function map(key) {
      return { key: key, label: formModel.MODE_LABEL[key] };
    }),
    presetMiss: source.presetMiss === true,
    guest: source.guest || {},
    guestDormKeyText: formModel.guestDormKey(source.guest),
    zones: listOf(source.zones),
    stationOptions: listOf(source.stationOptions),
    note: textOf(source.note),
    noteMax: formModel.NOTE_MAX,
    pickupCodeMax: formModel.PICKUP_CODE_MAX,
    lockerNoMax: formModel.LOCKER_NO_MAX,
    tailLength: formModel.TRACKING_TAIL_LENGTH,
    displayNameMax: formModel.DISPLAY_NAME_MAX,
    batchMax: formModel.BATCH_MAX,
    reviewText: textOf(source.reviewText),
    recognizing: opt.recognizing === true,
    recognizeText: textOf(opt.recognizeText),
    customerSummary: customerSummaryOf(source, binding)
  }, bindingsViewOf(source), servicesViewOf(source), appointViewOf(source),
  itemsViewOf(source), imagesViewOf(source));
}

module.exports = {
  build,
  customerSummaryOf
};
