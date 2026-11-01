// pkg-partner/pages/create-on-behalf/index.js · 代客下单（两条顾客路径：已绑定 bindingId / 新顾客 guest；均不写 bindings）
// 口径：docs/ux/V4_UX_PARTNER.md §3.4；docs/data/V4_DATA_MODEL.md §7.5 批 7（bindingId 与 guest 二选一）；
//       CONTRACT D44：逐件站点（默认继承首件、可逐件改、逐件必填）、截图 0~10 张、选图自动识别预填。
// 页面只做接线：校验/预填/请求体/视图快照全在 parts/（form-model / recognize-model / payload-model / view-model）。
const orderApi = require('../../../api/modules/order');
const partnerApi = require('../../../api/modules/partner');
const configApi = require('../../../api/modules/config');
const client = require('../../../api/client');
const store = require('../../../store/index');
const modeGuard = require('../../../api/mode-guard');
const formModel = require('./parts/form-model');
const payloadModel = require('./parts/payload-model');
const presetModel = require('./parts/preset-model');
const resultModel = require('./parts/result-model');
const viewModel = require('./parts/view-model');
const recognizeModel = require('./parts/recognize-model');
const recognizeFlow = require('./parts/recognize-flow');
const share = require('../../../utils/share/handlers');

const BINDING_OPTIONS_LIMIT = 50;

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// 服务端时间基准：store.serverTimeSkew = 本机时刻 - 服务端时刻（api/client 校时后写入）
function serverNowMs() {
  const skew = store.get('serverTimeSkew');
  return Date.now() - (typeof skew === 'number' && isFinite(skew) ? skew : 0);
}

Page({
  data: {
    step: 1,
    errorText: '',
    readonly: false,
    submitting: false,
    recognizing: false,
    recognizeText: '',
    result: null,
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
    serviceDesc: '',
    servicesEmpty: true,
    stationOptions: [],
    items: [],
    itemsCount: 0,
    canAddItem: true,
    stationLines: [],
    appointType: 'ASAP',
    appointDate: '',
    appointDateText: '',
    appointTime: '',
    appointTimeIndex: -1,
    appointDays: [],
    appointTimes: [],
    appointPresets: [],
    appointText: '',
    appointError: '',
    appointNotice: '',
    appointNote: '',
    appointMinDate: '',
    appointMaxDate: '',
    note: '',
    noteMax: formModel.NOTE_MAX,
    pickupCodeMax: formModel.PICKUP_CODE_MAX,
    lockerNoMax: formModel.LOCKER_NO_MAX,
    tailLength: formModel.TRACKING_TAIL_LENGTH,
    displayNameMax: formModel.DISPLAY_NAME_MAX,
    batchMax: formModel.BATCH_MAX,
    files: [],
    imageCount: 0,
    imageMax: formModel.IMAGE_MAX,
    noImage: true,
    reviewText: '',
    customerSummary: '',
    presetMiss: false
  },

  onLoad(options) {
    this.state = null;
    this.result = null;
    this.config = null;
    this.requestKey = { clientRequestId: '', signature: '' };
    this.step = 1;
    this.recognizeToken = 0;
    this.recognized = {};
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
        // TD-083：公开配置留本页一份（D43 autoCompleteAt 结果块文案 + 识别站点值域共用，不再各自取）
        this.config = config;
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

  // 视图快照单源在 parts/view-model（页面不堆字段拼装；行数/函数行数闸）
  render() {
    if (!this.state) {
      return;
    }
    this.setData(viewModel.build(this.state, {
      step: this.step,
      readonly: this.data.readonly,
      submitting: this.data.submitting,
      errorText: this.data.errorText,
      recognizing: this.data.recognizing,
      recognizeText: this.data.recognizeText,
      result: this.result
    }));
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
    if (this.data.readonly || !this.state) {
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
    if (this.data.readonly || !this.state) {
      return;
    }
    const field = event.currentTarget.dataset.field;
    const guest = Object.assign({}, this.state.guest);
    guest[field] = (event.detail && event.detail.value) || '';
    this.update({ guest: guest, result: null });
  },

  onZoneTap(event) {
    if (this.data.readonly || !this.state) {
      return;
    }
    const guest = Object.assign({}, this.state.guest);
    guest.zone = event.currentTarget.dataset.zone;
    this.update({ guest: guest });
  },

  onItemInput(event) {
    if (this.data.readonly || !this.state) {
      return;
    }
    const index = Number(event.currentTarget.dataset.index);
    const field = event.currentTarget.dataset.field;
    const items = this.state.items.map((item) => Object.assign({}, item));
    if (!items[index]) {
      return;
    }
    items[index][field] = (event.detail && event.detail.value) || '';
    this.update({ items: items, result: null });
  },

  // D44：每件独立站点；data-index 逐件写（旧实现页面级单值复制给所有件）
  onItemStationChange(event) {
    if (this.data.readonly || !this.state) {
      return;
    }
    this.update(formModel.applyItemStation(
      this.state,
      Number(event.currentTarget.dataset.index),
      Number(event.detail.value)
    ));
  },

  onAddItem() {
    if (this.data.readonly || !this.state || this.state.items.length >= formModel.BATCH_MAX) {
      return;
    }
    this.update(formModel.appendParcel(this.state));
  },

  onRemoveItem(event) {
    if (this.data.readonly || !this.state) {
      return;
    }
    this.update(formModel.removeParcel(this.state, Number(event.currentTarget.dataset.index)));
  },

  onServiceChange(event) {
    this.update({ serviceIndex: Number(event.detail.value) });
  },

  // D47 预约：尽快 / 最晚时间（日期 + 30 分钟一档时间 + 预设），判据在 shared/appoint
  onAppointType(event) {
    if (!this.state) return;
    this.update(formModel.appointPatchWithType(this.state, event.detail.value, serverNowMs()));
  },

  onAppointDate(event) {
    if (!this.state) return;
    this.update(formModel.appointPatchWithDate(this.state, event.detail.value, serverNowMs()));
  },

  onAppointTime(event) {
    if (!this.state) return;
    const times = this.data.appointTimes || [];
    const option = times[Number(event.detail.value)] || {};
    this.update(formModel.appointPatchWithTime(this.state, option.value || '', serverNowMs()));
  },

  onAppointPreset(event) {
    if (!this.state) return;
    const dataset = event.currentTarget.dataset || {};
    this.update(formModel.appointPatchWithPreset(this.state, String(dataset.time || ''), serverNowMs()));
  },

  onNoteInput(event) {
    const raw = (event.detail && event.detail.value) || '';
    this.update({ note: raw.slice(0, formModel.NOTE_MAX) });
  },

  // D44：多图（0~10）上传完成 → 对新增图自动识别预填；识别失败/取消都不阻塞手填与提交
  onImageChange(event) {
    if (!this.state) {
      return;
    }
    const files = (event.detail && event.detail.files) || [];
    this.update({ files: files, result: null });
    if (this.data.readonly) {
      return;
    }
    const pending = files.filter((file) => file && file.fileId && file.uploadTicketId && !this.recognized[file.fileId]);
    if (pending.length > 0) {
      this.runRecognize(pending);
    }
  },

  onImageError(event) {
    const detail = (event && event.detail) || {};
    this.setData({ errorText: detail.message || '截图上传失败，请重试或手填' });
  },

  // 识别编排在 parts/recognize-flow：OCR 降采样 + 逐图 aiApi.parseParcel 兜底；进度与取消只动 UI 状态
  runRecognize(files) {
    if (this.data.readonly || this.data.recognizing || !this.state) {
      return;
    }
    const list = (files || []).filter((file) => file && (file.localPath || file.path) && file.uploadTicketId);
    if (!list.length) {
      wx.showToast({ title: '先选一张取件截图，或直接手填', icon: 'none' });
      return;
    }
    const token = this.recognizeToken + 1;
    this.recognizeToken = token;
    const config = this.config || configApi.getCachedPublic() || store.get('config') || {};
    this.setData({
      recognizing: true,
      recognizeText: recognizeModel.progressTextOf({ index: 1, total: list.length }),
      errorText: ''
    });
    recognizeFlow.identifyFiles(list, {
      stations: config.stations,
      onProgress: (progress) => {
        if (this.recognizeToken !== token) return;
        this.setData({ recognizeText: recognizeModel.progressTextOf(progress) });
      },
      isCancelled: () => this.recognizeToken !== token
    }).then((result) => this.onRecognizeDone(result, list, token))
      .catch(() => this.onRecognizeFail(token));
  },

  // 识别完成：合并预填（只填空白、手填优先）；识别期间新加的图继续识别，不丢不阻塞
  onRecognizeDone(result, list, token) {
    if (this.recognizeToken !== token) return;
    this.setData({ recognizing: false, recognizeText: '' });
    if (!result || result.cancelled) return;
    list.forEach((file) => { this.recognized[file.fileId] = true; });
    const merged = recognizeModel.mergeRecognizedItems(this.state, result.items || []);
    const first = (result.items || [])[0] || {};
    this.update({
      items: merged.items,
      parcelSeq: merged.parcelSeq,
      reviewText: recognizeModel.recognitionTextOf({
        filled: merged.filled,
        overflow: merged.overflow,
        failed: result.failed,
        lowSuggestions: result.low,
        failureId: first.failureId || result.failureId || ''
      })
    });
    const pending = (this.state.files || []).filter((file) => file && file.fileId && !this.recognized[file.fileId]);
    if (pending.length > 0) {
      this.runRecognize(pending);
    }
  },

  onRecognizeFail(token) {
    if (this.recognizeToken !== token) return;
    this.setData({ recognizing: false, recognizeText: '' });
    this.update({ reviewText: recognizeModel.EMPTY_TEXT });
  },

  onRecognizeTap() {
    this.runRecognize(this.state ? this.state.files : []);
  },

  // 取消识别：token 前进 → 后续 OCR/AI 结果丢弃，页面立即可继续手填
  onCancelRecognize() {
    this.recognizeToken += 1;
    this.setData({ recognizing: false, recognizeText: '' });
    if (this.state) {
      this.update({ reviewText: recognizeModel.CANCEL_TEXT });
    }
  },

  onSubmit() {
    if (this.data.readonly) {
      wx.showToast({ title: '开发者只读视角不能操作', icon: 'none' });
      return;
    }
    if (this.data.submitting || !this.state) {
      return;
    }
    // TD-084④：本地校验取「请求时」最近一次服务端 serverNow（不用 onLoad 的时间快照——
    // 长停留后快照会把已过的最晚时间放行，提交到服务端才被拒）
    const built = payloadModel.buildPayload(this.state, { nowMs: serverNowMs() });
    if (!built.ok) {
      // D44：本地校验失败回到正确步骤（顾客问题回第 1 步、件/站点/截图回第 2 步、服务/备注回第 3 步）
      this.step = built.step || 1;
      this.setData({ errorText: built.message });
      this.render();
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
        // TD-083：guest 提示块的自动完成时刻按公开配置 config.autoCompleteAt 生成（缺配置回退出厂默认）
        this.result = resultModel.buildResult(result || {}, {
          customerMode: this.state.customerMode,
          config: this.config || {}
        });
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
