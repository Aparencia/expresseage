// pkg-partner/pages/create-on-behalf/index.js · 代客下单（两条顾客路径：已绑定 bindingId / 新顾客 guest；均不写 bindings）
// 口径：docs/V4_UX_PARTNER.md §3.4；docs/V4_DATA_MODEL.md §7.5 批 7（bindingId 与 guest 二选一）
const orderApi = require('../../../api/modules/order');
const partnerApi = require('../../../api/modules/partner');
const configApi = require('../../../api/modules/config');
const aiApi = require('../../../api/modules/ai');
const client = require('../../../api/client');
const store = require('../../../store/index');
const modeGuard = require('../../../api/mode-guard');
const formModel = require('./parts/form-model');
const payloadModel = require('./parts/payload-model');
const presetModel = require('./parts/preset-model');
const resultModel = require('./parts/result-model');
const share = require('../../../utils/share/handlers');

const BINDING_OPTIONS_LIMIT = 50;

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

// 服务端时间基准：store.serverTimeSkew = 本机时刻 - 服务端时刻（api/client 校时后写入）
function serverNowMs() {
  const skew = store.get('serverTimeSkew');
  return Date.now() - (typeof skew === 'number' && isFinite(skew) ? skew : 0);
}

Page({
  data: {
    step: 1,
    customerMode: 'GUEST',
    modes: [],
    bindingOptions: [],
    bindingIndex: 0,
    bindingLabel: '',
    bindingSub: '',
    guest: {},
    guestDormKeyText: '',
    zones: [],
    services: [],
    serviceIndex: 0,
    serviceName: '',
    servicesEmpty: true,
    stationOptions: [],
    stationIndex: 0,
    stationName: '',
    items: [],
    itemsCount: 0,
    canAddItem: true,
    appointOptions: [],
    appointIndex: 0,
    appointLabel: '',
    appointNotice: '',
    note: '',
    noteMax: formModel.NOTE_MAX,
    pickupCodeMax: formModel.PICKUP_CODE_MAX,
    lockerNoMax: formModel.LOCKER_NO_MAX,
    tailLength: formModel.TRACKING_TAIL_LENGTH,
    displayNameMax: formModel.DISPLAY_NAME_MAX,
    imageFileId: '',
    imageTicketId: '',
    noImage: true,
    reviewText: '',
    recognizing: false,
    presetMiss: false,
    submitting: false,
    readonly: false,
    errorText: '',
    customerSummary: '',
    result: null
  },

  onLoad(options) {
    this.state = null;
    this.result = null;
    this.requestKey = { clientRequestId: '', signature: '' };
    this.step = 1;
    this.setData({ readonly: !modeGuard.canRenderWriteButton() });
    this.loadBase((options && options.bindingId) || '');
  },

  onShow() {
    this.setData({ readonly: !modeGuard.canRenderWriteButton() });
  },

  loadBase(presetBindingId) {
    const cachedConfig = store.get('config');
    const configPromise = cachedConfig ? Promise.resolve(cachedConfig) : configApi.getPublic();
    Promise.all([configPromise, partnerApi.listBindings({ limit: BINDING_OPTIONS_LIMIT })])
      .then((results) => {
        const config = results[0] || {};
        const bindings = results[1] || {};
        const partner = store.get('partner') || {};
        this.state = presetModel.applyPresetBinding(formModel.createInitialState({
          config: config,
          partner: partner,
          bindingList: bindings.list,
          nowMs: serverNowMs()
        }), textOf(presetBindingId));
        this.render();
      })
      .catch((err) => {
        this.setData({ errorText: (err && err.message) || '页面没加载出来，检查网络后重试' });
      });
  },

  render() {
    const state = this.state;
    if (!state) {
      return;
    }
    const binding = formModel.currentBinding(state);
    const service = formModel.currentService(state);
    const station = formModel.currentStation(state);
    const appoint = formModel.currentAppoint(state);
    const guest = state.guest || {};
    const guestName = textOf(guest.displayName) || '未填称呼';
    this.setData({
      step: this.step,
      customerMode: state.customerMode,
      modes: formModel.CUSTOMER_MODES.map((key) => ({ key: key, label: formModel.MODE_LABEL[key] })),
      bindingOptions: state.bindingOptions,
      bindingIndex: state.bindingIndex,
      bindingLabel: binding ? binding.label : '',
      bindingSub: binding ? binding.sub : '',
      guest: state.guest,
      guestDormKeyText: formModel.guestDormKey(guest),
      zones: state.zones,
      services: state.services,
      servicesEmpty: state.services.length === 0,
      serviceIndex: state.serviceIndex,
      serviceName: service ? service.name : '',
      stationOptions: state.stationOptions,
      stationIndex: state.stationIndex,
      stationName: station ? station.name : '',
      items: state.items,
      itemsCount: state.items.length,
      canAddItem: state.items.length < formModel.BATCH_MAX,
      appointOptions: state.appointOptions,
      appointIndex: state.appointIndex,
      appointLabel: appoint.label || '',
      appointNotice: state.appointNotice || '',
      note: state.note,
      imageFileId: state.imageFileId,
      imageTicketId: state.imageTicketId,
      noImage: !state.imageFileId,
      reviewText: state.reviewText || '',
      presetMiss: state.presetMiss === true,
      customerSummary: state.customerMode === 'BOUND' ? '已绑定：' + (binding ? binding.label : '未选择')
        : '新顾客（代客单）：' + guestName + (textOf(guest.phoneTail) ? ' · 尾号' + textOf(guest.phoneTail) : ''),
      result: this.result
    });
  },

  update(patch) {
    this.state = Object.assign({}, this.state, patch);
    this.render();
  },

  onStepTap(event) {
    const step = Number(event.currentTarget.dataset.step);
    if (step >= 1 && step <= 3) {
      this.step = step;
      this.render();
    }
  },

  onModeTap(event) {
    if (this.data.readonly) {
      return;
    }
    const mode = event.currentTarget.dataset.mode === 'BOUND' ? 'BOUND' : 'GUEST';
    if (mode === this.state.customerMode) {
      return;
    }
    this.update({ customerMode: mode });
  },

  onBindingPick(event) {
    this.update({ bindingIndex: Number(event.detail.value), presetMiss: false });
  },

  onGuestInput(event) {
    if (this.data.readonly) {
      return;
    }
    const field = event.currentTarget.dataset.field;
    const guest = Object.assign({}, this.state.guest);
    guest[field] = (event.detail && event.detail.value) || '';
    this.update({ guest: guest, result: null });
  },

  onZoneTap(event) {
    if (this.data.readonly) {
      return;
    }
    const guest = Object.assign({}, this.state.guest);
    guest.zone = event.currentTarget.dataset.zone;
    this.update({ guest: guest });
  },

  onItemInput(event) {
    if (this.data.readonly) {
      return;
    }
    const index = Number(event.currentTarget.dataset.index);
    const field = event.currentTarget.dataset.field;
    const items = clone(this.state.items);
    if (!items[index]) {
      return;
    }
    items[index][field] = (event.detail && event.detail.value) || '';
    this.update({ items: items, result: null });
  },

  onAddItem() {
    if (this.data.readonly || this.state.items.length >= formModel.BATCH_MAX) {
      return;
    }
    this.update({ items: clone(this.state.items).concat([formModel.emptyParcel()]) });
  },

  onRemoveItem(event) {
    if (this.data.readonly || this.state.items.length <= 1) {
      return;
    }
    const index = Number(event.currentTarget.dataset.index);
    const items = clone(this.state.items);
    items.splice(index, 1);
    this.update({ items: items });
  },

  onServiceChange(event) {
    this.update({ serviceIndex: Number(event.detail.value) });
  },

  onStationChange(event) {
    this.update({ stationIndex: Number(event.detail.value) });
  },

  onAppointChange(event) {
    this.update({ appointIndex: Number(event.detail.value) });
  },

  onNoteInput(event) {
    const raw = (event.detail && event.detail.value) || '';
    this.update({ note: raw.slice(0, formModel.NOTE_MAX) });
  },

  onImageChange(event) {
    const files = (event.detail && event.detail.files) || [];
    if (!files.length) {
      return;
    }
    const uploaded = files[0] || {};
    this.update({
      imageFileId: uploaded.fileId || '',
      imageTicketId: uploaded.uploadTicketId || '',
      reviewText: '',
      recognitionFailureId: ''
    });
  },

  onImageError(event) {
    const detail = (event && event.detail) || {};
    this.setData({ errorText: detail.message || '截图上传失败，请重试或手填' });
  },

  // 识别失败兜底（D23/C2 口径：NO_TEXT 时服务端不外呼但必须入复核队列并给手填引导；无截图单不进识别链路）
  onRecognizeTap() {
    if (this.data.readonly) {
      wx.showToast({ title: '开发者只读视角不能操作', icon: 'none' });
      return;
    }
    if (this.data.recognizing) {
      return;
    }
    if (!this.state.imageTicketId) {
      wx.showToast({ title: '先选一张取件截图，或直接手填（无截图·手填）', icon: 'none' });
      return;
    }
    this.setData({ recognizing: true, errorText: '' });
    aiApi.parseParcel({
      ocrTextMasked: '',
      hintTrackingTail: textOf(this.state.items[0] && this.state.items[0].trackingTail) || undefined,
      uploadTicketId: this.state.imageTicketId,
      role: 'PARTNER'
    })
      .then((result) => {
        this.update(formModel.applyRecognition(this.state, result || {}));
        this.setData({ recognizing: false });
      })
      .catch((err) => {
        this.setData({ recognizing: false });
        this.update({ reviewText: '识别没完成，可以直接手填；提交后也可在订单详情里补码' });
        if (err && err.code === 'VIEW_TICKET_EXPIRED') {
          store.clearViewContext();
          wx.reLaunch({ url: '/pkg-admin/pages/account-switch/index' });
        }
      });
  },

  onSubmit() {
    if (this.data.readonly) {
      wx.showToast({ title: '开发者只读视角不能操作', icon: 'none' });
      return;
    }
    if (this.data.submitting) {
      return;
    }
    const built = payloadModel.buildPayload(this.state);
    if (!built.ok) {
      this.setData({ errorText: built.message, step: 1 });
      return;
    }
    const signature = payloadModel.contentSignature(this.state);
    this.requestKey = formModel.ensureRequestKey(this.requestKey, signature, {
      makeId: client.createRequestId,
      isValid: client.isValidClientRequestId
    });
    this.setData({ submitting: true, errorText: '' });
    // v1.0 单入口：多件包裹走同一 order.create（createBatch 已移除）
    orderApi.create(built.data, { clientRequestId: this.requestKey.clientRequestId })
      .then((result) => {
        this.result = resultModel.buildResult(result || {}, { customerMode: this.state.customerMode });
        if (modeGuard.isTestWrite() && this.result.visible) {
          this.result = Object.assign({}, this.result, {
            hintLines: this.result.hintLines.concat(['本次写入的是测试数据（开发者切换会话）'])
          });
        }
        this.setData({ submitting: false, errorText: '' });
        this.render();
      })
      .catch((err) => {
        this.setData({ submitting: false, errorText: formModel.failureText(err) });
      });
  },

  onResultOrderTap(event) {
    const orderNo = textOf(event.currentTarget.dataset.orderNo);
    if (!orderNo) {
      return;
    }
    wx.navigateTo({ url: '/pkg-partner/pages/order-detail/index?orderNo=' + encodeURIComponent(orderNo) });
  },

  onShareAppMessage() {
    return share.appMessage();
  }
});
