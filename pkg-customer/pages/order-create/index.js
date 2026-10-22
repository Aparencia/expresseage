// pkg-customer/pages/order-create/index.js · 下单四步（截图 → 核对 → 服务/地址 → 提交）
// v1.0（D23/D24/D25）：0~5 张截图 → 1~10 件包裹合成**一张订单**；无截图可手填（manualEntry）；
// Step3 加整单配送地址（默认本人宿舍，可改他人+收件人称呼）；提交按 order.create 单入口载荷。
// 页面只做取参/调 api/setData/事件转发；识别/模型/步骤细节在 parts/。
'use strict';

const store = require('../../../store/index');
const orderApi = require('../../../api/modules/order');
const route = require('../../../config/route');
const model = require('./parts/model');
const deliveryModel = require('./parts/delivery');
const ocrFlow = require('./parts/ocr-flow');
const bootstrap = require('./parts/bootstrap');
const reorder = require('./parts/reorder');
const filesFlow = require('./parts/files-flow');
const step3 = require('./parts/step3');
const submitFlow = require('./parts/submit');

const HOME_PAGE = '/pages/customer/home/index';
const MAX_PARCELS = model.MAX_PARCELS;
const MAX_IMAGES = model.MAX_IMAGES;

Page({
  data: {
    step: 1,
    readonly: false,
    profileReady: false,
    bindingReady: false,
    // 截图与识别（多图 0~5）
    files: [],
    perImage: [],
    images: [],
    tickets: [],
    ocrState: 'idle',
    ocrError: '',
    failureCode: '',
    failureText: '',
    failureNext: '',
    failureId: '',
    recognizeHint: '',
    imageFailures: [],
    aiHint: '',
    ocrText: '',
    ocrTextOpen: false,
    // 包裹（件）与整单服务/预约/备注（v1.0：服务类型/预约/备注每单一份）
    items: [],
    lowCopy: model.LOW_SUGGESTION_COPY,
    stations: [],
    services: [],
    slots: [],
    serviceCode: '',
    serviceIndex: 0,
    appointType: 'ASAP',
    slotIndex: -1,
    startAt: '',
    endAt: '',
    note: '',
    // A 批 P1-9：「其他代办」未填备注的行内红字（判据在 parts/precheck 纯件）
    noteError: '',
    // 配送地址（D25）
    delivery: deliveryModel.createState(null),
    deliveryText: '',
    deliverySelfText: '',
    deliveryZones: [],
    deliveryBuildings: deliveryModel.buildingOptions(),
    deliveryErrors: {},
    submitting: false,
    submitError: '',
    resultOrderNo: '',
    resultMerged: false,
    // 提交幂等键（clientRequestId）：进入 Step4 生成、失败重试复用、内容变更重生成、成功清空（UX §4.8）
    submission: null,
    reorderPrefill: null,
    manualPicked: false,
    maxParcels: MAX_PARCELS,
    maxImages: MAX_IMAGES
  },

  onLoad(options) {
    const snapshot = store.snapshot();
    const readonly = !!(snapshot.viewContext && snapshot.viewContext.viewMode === 'READONLY');
    this._reorderNo = reorder.orderNoOf(options);
    this.setData({
      readonly: readonly,
      stations: model.stationOptions(),
      slots: model.appointmentSlots(new Date()),
      profileReady: !!(snapshot.customer && snapshot.customer.profileComplete),
      bindingReady: !!snapshot.binding
    });
    this.loadBootstrap();
    if (this._reorderNo) this.loadReorder();
  },

  onShow() {
    const snapshot = store.snapshot();
    if (snapshot.viewContext) return;
    if (snapshot.activeRole !== 'CUSTOMER') wx.reLaunch({ url: route.ROLE_PAGE });
  },

  // 配置 + 对方公开资料 + 本人资料（配送地址默认值）→ 服务类型选项；装配在 parts/bootstrap
  loadBootstrap() {
    return bootstrap.load().then((state) => {
      const services = state.services || [];
      const delivery = deliveryModel.createState(state.profile, (state.config || {}).zoneLabels);
      this.setData({
        partnerPublic: state.partnerPublic,
        services: services,
        serviceCode: services.length > 0 ? services[0].code : '',
        serviceIndex: 0,
        delivery: delivery,
        deliveryText: deliveryModel.displayText(delivery),
        deliverySelfText: deliveryModel.selfDisplayText(delivery),
        deliveryZones: deliveryModel.zoneOptions(delivery)
      });
      step3.syncNoteError(this);
    });
  },

  // 再次下单：order.get 归属校验在服务端；失败静默回普通下单，只预填服务类型/站点（不复制取件码等 L3）
  loadReorder() {
    return reorder.load({ orderNo: this._reorderNo, getOrder: orderApi.get }).then((prefill) => {
      if (!prefill) return;
      this._applyReorderPrefill(prefill);
    });
  },

  _applyReorderPrefill(prefill) {
    const code = reorder.serviceCodeOf(prefill, this.data.services);
    const patch = { reorderPrefill: prefill };
    if (code) {
      let index = 0;
      this.data.services.forEach(function each(service, i) { if (service.code === code) index = i; });
      patch.serviceCode = code;
      patch.serviceIndex = index;
    }
    this.setData(patch);
  },

  // ── Step1：截图（多图 0~5，逐图识别合并；失败也有手填支路）─────────────────
  onPickFile(e) {
    return filesFlow.onPickFile(this, e);
  },

  onPickError(e) {
    filesFlow.onPickError(this, e);
  },

  onPickLimit() {
    // 组件已 toast 明确文案（已添加 n/max）；页面不再重复
  },

  onOcrPhase(state) {
    if (state && state.phase === 'upload') this.setData({ ocrState: 'upload' });
    if (state && state.phase === 'ocr') this.setData({ ocrState: 'ocr' });
    if (state && state.phase === 'ai') this.setData({ ocrState: 'ai' });
  },

  // P1-4：无本地图 → 打开选择器（不空转）；有图 → 原地重识别（复用已上传 fileId/票据，不重复上传）
  onRetryOcr() {
    return filesFlow.onRetryOcr(this);
  },

  itemDefaults() {
    return reorder.defaultsFor({}, this.data.reorderPrefill, this.data.services);
  },

  // §4.3.1 ③：识别进行中即可「先手动填写」——不阻塞手填，迟到的识别结果不再覆盖
  onManualTap() {
    const defaults = this.itemDefaults();
    this.setData({
      manualPicked: true,
      submission: model.clearSubmission(),
      items: [model.makeItem({ manual: true }, defaults)],
      step: 2,
      ocrState: 'manual',
      recognizeHint: '',
      aiHint: ''
    });
  },

  // D24：0 图直接手填提交（不进入识别链路、不调 AI、不写复核队列）
  onManualOnlyTap() {
    if (this.data.readonly) {
      wx.showToast({ title: '开发者只读视角不能操作', icon: 'none' });
      return;
    }
    this.setData({ files: [], perImage: [], images: [], tickets: [], imageFailures: [], aiHint: '' });
    this.onManualTap();
  },

  // §4.3.1 ③「取消」：放弃本次智能识别（迟到的建议丢弃），文案按取消态静默降级
  onCancelAi() {
    const copy = ocrFlow.aiFallbackCopy('USER_CANCEL');
    this.setData({
      manualPicked: true,
      ocrState: 'failed',
      failureText: copy.text,
      failureNext: copy.next,
      aiHint: ''
    });
  },

  onPreviewImage() {
    const urls = (this.data.files || []).map(function path(file) { return file.localPath; })
      .filter(function has(path) { return !!path; });
    if (urls.length === 0) {
      wx.showToast({ title: '还没有截图', icon: 'none' });
      return;
    }
    wx.previewImage({ urls: urls, current: urls[0] });
  },

  onToggleOcrText() {
    this.setData({ ocrTextOpen: !this.data.ocrTextOpen });
  },

  // ── Step2：包裹核对（逐件站点/码/柜/尾号；全选；加件）─────────────────────
  onAddItem() {
    if (this.data.readonly) return;
    if (this.data.items.length >= MAX_PARCELS) {
      wx.showToast({ title: '一单最多 ' + MAX_PARCELS + ' 件', icon: 'none' });
      return;
    }
    const defaults = this.itemDefaults();
    this.setData({ items: this.data.items.concat([model.makeItem({ manual: true }, defaults)]) });
  },

  onRemoveItem(e) {
    const index = Number(e.currentTarget.dataset.index);
    const items = this.data.items.slice();
    items.splice(index, 1);
    this.setData({ items: items });
  },

  onItemToggle(e) {
    const index = Number(e.currentTarget.dataset.index);
    const items = this.data.items.slice();
    items[index] = Object.assign({}, items[index], { checked: !items[index].checked });
    this.setData({ items: items });
  },

  // M-17：全选/取消全选（逐件缺码提示已在 wxml 行内）
  onToggleAll() {
    const items = this.data.items || [];
    const allChecked = items.length > 0 && items.every(function on(item) { return item.checked; });
    this.setData({
      items: items.map(function map(item) {
        return Object.assign({}, item, { checked: !allChecked });
      })
    });
  },

  onStationChange(e) {
    const index = Number(e.currentTarget.dataset.index);
    const station = this.data.stations[Number(e.detail.value)] || {};
    this.updateItem(index, { stationId: station.id || '', stationName: station.name || '' });
  },

  onCodeChange(e) {
    this.updateItem(Number(e.currentTarget.dataset.index), { pickupCode: e.detail.value });
  },

  onLockerChange(e) {
    this.updateItem(Number(e.currentTarget.dataset.index), { lockerNo: e.detail.value });
  },

  onTailChange(e) {
    this.updateItem(Number(e.currentTarget.dataset.index), { trackingTail: e.detail.value });
  },

  // 手改识别字段 → 来源降为 MANUAL（优先级 MANUAL > AI 来源 > RULE），由纯件统一口径
  updateItem(index, patch) {
    if (!(index >= 0)) return;
    const items = this.data.items.slice();
    items[index] = model.revalidateItem(model.withManualEdit(items[index], patch));
    this.setData({ items: items, submission: model.clearSubmission() });
  },

  goStep2Next() {
    const check = model.canSubmit(this.data.items);
    if (!check.ok) {
      wx.showToast({ title: check.reason, icon: 'none' });
      return;
    }
    this.setData({ step: 3 });
  },

  // D29：采纳低置信建议（只填空位、手填优先；采纳/清建议条逻辑在 model.adoptSuggestion 纯件）
  onAdoptSuggestion(e) {
    if (this.data.readonly) return;
    const index = Number(e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.index : -1);
    if (!(index >= 0)) return;
    const items = this.data.items.slice();
    const result = model.adoptSuggestion(items[index]);
    items[index] = result.item;
    this.setData({ items: items, submission: model.clearSubmission() });
    if (result.adopted) wx.showToast({ title: model.LOW_SUGGESTION_COPY.adopted, icon: 'none' });
  },

  // ── Step3：服务/预约/备注 + 配送地址（整单一份）────────────────────────────
  onServiceChange(e) {
    step3.setService(this, e);
  },

  onAppointType(e) {
    step3.setAppointType(this, e);
  },

  onSlotChange(e) {
    step3.setSlot(this, e);
  },

  onNoteInput(e) {
    step3.setNote(this, e);
  },

  onDeliveryModeChange(e) {
    step3.setMode(this, e);
  },

  onDeliveryZoneChange(e) {
    step3.setZone(this, e);
  },

  onDeliveryBuildingChange(e) {
    step3.setBuilding(this, e);
  },

  onDeliveryRoomInput(e) {
    step3.setRoom(this, e);
  },

  onDeliveryNameInput(e) {
    step3.setRecipient(this, e);
  },

  goStep3Next() {
    step3.goNext(this);
  },

  // ── Step4：确认提交（order.create 单入口 + 合并窗口提示）────────────────────
  goPrev() {
    this.setData({ step: Math.max(1, this.data.step - 1) });
  },

  submitFingerprint() {
    return submitFlow.fingerprintOf(this);
  },

  onSubmit() {
    return submitFlow.onSubmit(this);
  },

  onRetrySubmit() {
    this.onSubmit();
  },

  onViewOrder() {
    submitFlow.onViewOrder(this);
  },

  onBackHome() {
    wx.switchTab({ url: HOME_PAGE });
  }
});
