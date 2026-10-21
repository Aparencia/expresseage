// pkg-partner/pages/create-on-behalf/index.js · 代客下单（guest 快照；不产生绑定；识别失败走 AI 兜底 + 开发者复核）
const orderApi = require('../../../api/modules/order');
const partnerApi = require('../../../api/modules/partner');
const configApi = require('../../../api/modules/config');
const aiApi = require('../../../api/modules/ai');
const store = require('../../../store/index');
const stations = require('../../../shared/stations');
const modeGuard = require('../../../api/mode-guard');

const SERVICE_FALLBACK = [
  { code: 'PICKUP_STD', name: '标准代取' },
  { code: 'PICKUP_DOOR', name: '送寝上门' },
  { code: 'PICKUP_URGENT', name: '加急代取' },
  { code: 'DROP_OFF', name: '代寄快递' },
  { code: 'CUSTOM', name: '其他代办' }
];
const NOTE_MAX = 200;
const ROOM_PATTERN = /^[0-9]{3,}$/;

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function buildDormKey(zone, buildingNo, room) {
  const building = textOf(buildingNo);
  const roomNo = textOf(room);
  if (!zone || !building || !roomNo) {
    return '';
  }
  return zone + building + '-' + roomNo;
}

function startOfNextHour() {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);
  return date.getTime();
}

Page({
  data: {
    step: 1,
    bindingOptions: [],
    customerMode: 'BOUND',
    guest: { displayName: '', phoneTail: '', zone: '', buildingNo: '', room: '', dormKey: '' },
    zones: [],
    services: [],
    serviceIndex: 0,
    stationOptions: [],
    stationIndex: 0,
    parcel: { pickupCode: '', lockerNo: '', trackingTail: '' },
    appointOptions: [{ key: 'ASAP', label: '尽快' }],
    appointIndex: 0,
    note: '',
    imageFileId: '',
    imageTicketId: '',
    recognizing: false,
    recognizeText: '',
    reviewText: '',
    submitting: false,
    readonly: false,
    errorText: ''
  },

  onLoad() {
    this.setData({ readonly: !modeGuard.canRenderWriteButton() });
    this.loadBase();
  },

  onShow() {
    this.setData({ readonly: !modeGuard.canRenderWriteButton() });
  },

  loadBase() {
    Promise.all([configApi.getPublic(), partnerApi.listBindings()])
      .then((results) => {
        const config = results[0] || {};
        const bindings = results[1] || {};
        const services = arr(config.serviceCatalog).length ? arr(config.serviceCatalog) : SERVICE_FALLBACK;
        const zoneLabels = config.zoneLabels || {};
        const zones = Object.keys(zoneLabels).map((key) => ({ key: key, label: zoneLabels[key] }));
        const bindingOptions = arr(bindings.list).map((item) => ({
          bindingId: item.bindingId,
          label: textOf(item.displayName) || '未填称呼',
          sub: textOf(item.dormKey) + (item.roomTag ? item.roomTag : '')
        }));
        this.setData({
          services: services,
          zones: zones,
          bindingOptions: bindingOptions,
          customerMode: bindingOptions.length ? 'BOUND' : 'GUEST',
          appointOptions: this.buildAppointOptions(),
          stationOptions: [{ id: '', name: '暂不指定（需查明）' }].concat(stations.listStations())
        });
      })
      .catch((err) => {
        this.setData({ errorText: (err && err.message) || '页面没加载出来，检查网络后重试' });
      });
  },

  buildAppointOptions() {
    const now = new Date();
    const base = now.getTime() + 2 * 60 * 60 * 1000;
    const slots = [{ key: 'ASAP', label: '尽快' }];
    ['上午 08:00-12:00', '下午 12:00-18:00', '晚上 18:00-22:00'].forEach((label, index) => {
      slots.push({ key: 'SLOT', label: '今天 ' + label, offset: index, baseTime: base });
    });
    return slots;
  },

  onStepTap(event) {
    const step = Number(event.currentTarget.dataset.step);
    if (step >= 1 && step <= 3) {
      this.setData({ step: step });
    }
  },

  onCustomerModeTap(event) {
    this.setData({ customerMode: event.currentTarget.dataset.mode });
  },

  onBindingPick(event) {
    const index = Number(event.detail.value);
    this.setData({ 'guest.boundIndex': index });
  },

  onGuestInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ ['guest.' + field]: (event.detail && event.detail.value) || '' });
  },

  onZoneTap(event) {
    const zone = event.currentTarget.dataset.zone;
    this.setData({ 'guest.zone': zone });
  },

  onParcelInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ ['parcel.' + field]: textOf((event.detail && event.detail.value) || '') });
  },

  onServiceChange(event) {
    this.setData({ serviceIndex: Number(event.detail.value) });
  },

  onStationChange(event) {
    this.setData({ stationIndex: Number(event.detail.value) });
  },

  onAppointChange(event) {
    this.setData({ appointIndex: Number(event.detail.value) });
  },

  onNoteInput(event) {
    const value = textOf((event.detail && event.detail.value) || '');
    this.setData({ note: value.slice(0, NOTE_MAX) });
  },

  onImageChange(event) {
    const files = (event.detail && event.detail.files) || [];
    if (!files.length) {
      return;
    }
    const uploaded = files[0] || {};
    this.setData({
      recognizeText: '',
      reviewText: '',
      imageFileId: uploaded.fileId || '',
      imageTicketId: uploaded.uploadTicketId || ''
    });
  },

  onImageError(event) {
    const detail = (event && event.detail) || {};
    this.setData({ errorText: detail.message || '截图上传失败，请重试或手填' });
  },

  onRecognizeTap() {
    if (this.data.recognizing) {
      return;
    }
    if (!this.data.imageTicketId) {
      wx.showToast({ title: '先选一张取件截图，或直接手填', icon: 'none' });
      return;
    }
    this.setData({ recognizing: true, errorText: '' });
    aiApi
      .parseParcel({
        ocrTextMasked: '',
        hintTrackingTail: this.data.parcel.trackingTail || undefined,
        uploadTicketId: this.data.imageTicketId,
        role: 'PARTNER'
      })
      .then((result) => {
        const data = result || {};
        const parcel = Object.assign({}, this.data.parcel);
        if (data.recognized) {
          if (data.pickupCode) {
            parcel.pickupCode = parcel.pickupCode || data.pickupCode;
          }
          if (data.lockerNo) {
            parcel.lockerNo = parcel.lockerNo || data.lockerNo;
          }
          if (data.trackingTail) {
            parcel.trackingTail = parcel.trackingTail || data.trackingTail;
          }
        }
        const review = data.recognized
          ? '已按截图预填，请核对（以手填为准）'
          : '这次没认出取件码/站点，已反馈开发者复核；可手填，或稍后看复核结果';
        this.setData({ parcel: parcel, recognizing: false, reviewText: review });
      })
      .catch((err) => {
        this.setData({ recognizing: false, reviewText: '识别没完成，可以直接手填' });
        if (err && err.code === 'VIEW_TICKET_EXPIRED') {
          store.clearViewContext();
          wx.reLaunch({ url: '/pkg-admin/pages/account-switch/index' });
        }
      });
  },

  validateForm() {
    const services = this.data.services || [];
    if (!services.length) {
      return '服务类型还没加载出来，请稍后重试';
    }
    if (this.data.customerMode === 'BOUND') {
      const options = this.data.bindingOptions;
      const index = Number(this.data.guest.boundIndex || 0);
      if (!options.length || !options[index]) {
        return '请选择一位已绑定的顾客';
      }
    } else {
      const guest = this.data.guest;
      if (!textOf(guest.displayName)) {
        return '代客单需要填顾客称呼（送达时要用）';
      }
      if (!guest.zone) {
        return '请选择苑';
      }
      if (!textOf(guest.buildingNo)) {
        return '请填楼栋号';
      }
      if (!ROOM_PATTERN.test(textOf(guest.room))) {
        return '宿舍号至少 3 位数字';
      }
      if (guest.phoneTail && !/^[0-9]{4}$/.test(textOf(guest.phoneTail))) {
        return '手机尾号是 4 位数字，或留空';
      }
    }
    const parcel = this.data.parcel;
    if (!textOf(parcel.pickupCode) && !textOf(parcel.trackingTail)) {
      return '至少填取件码或运单尾号，两者都空无法建单';
    }
    if (textOf(parcel.trackingTail) && !/^[0-9]{5}$/.test(textOf(parcel.trackingTail))) {
      return '运单尾号必须是 5 位数字';
    }
    return '';
  },

  buildGuest() {
    if (this.data.customerMode === 'BOUND') {
      return null;
    }
    const guest = this.data.guest;
    return {
      displayName: textOf(guest.displayName),
      phoneTail: textOf(guest.phoneTail),
      zone: guest.zone,
      buildingNo: Number(guest.buildingNo),
      room: textOf(guest.room),
      dormKey: buildDormKey(guest.zone, guest.buildingNo, guest.room)
    };
  },

  buildPayload() {
    const parcel = this.data.parcel;
    const appointOption = this.data.appointOptions[this.data.appointIndex] || { key: 'ASAP' };
    const appoint = { type: appointOption.key };
    if (appointOption.key === 'SLOT') {
      const start = new Date(appointOption.baseTime + appointOption.offset * 6 * 60 * 60 * 1000);
      const end = new Date(start.getTime() + 6 * 60 * 60 * 1000);
      appoint.startAt = start.getTime();
      appoint.endAt = end.getTime();
    }
    const service = this.data.services[this.data.serviceIndex] || this.data.services[0];
    const payload = {
      parcel: {
        pickupCode: textOf(parcel.pickupCode),
        lockerNo: textOf(parcel.lockerNo),
        trackingTail: textOf(parcel.trackingTail),
        stationId: this.data.stationOptions[this.data.stationIndex].id || '',
        stationName: this.data.stationOptions[this.data.stationIndex].name || ''
      },
      serviceCode: service.code,
      appoint: appoint,
      note: this.data.note,
      ticket: this.data.imageTicketId,
      image: this.data.imageFileId ? { fileId: this.data.imageFileId } : undefined
    };
    const guest = this.buildGuest();
    if (guest) {
      payload.guest = guest;
    }
    return payload;
  },

  onSubmit() {
    if (this.data.submitting || this.data.readonly) {
      return;
    }
    const message = this.validateForm();
    if (message) {
      this.setData({ errorText: message });
      return;
    }
    this.setData({ submitting: true, errorText: '' });
    orderApi
      .create(this.buildPayload())
      .then((result) => {
        const orderNo = (result && result.orderNo) || '';
        this.setData({ submitting: false });
        wx.showModal({
          title: '订单已提交',
          content: '本次为代客单：顾客未绑定，进度需线下告知；送达后由系统自动完成。绑定必须由顾客本人发起。',
          showCancel: false,
          success: () => {
            if (orderNo) {
              wx.redirectTo({ url: '/pkg-partner/pages/order-detail/index?orderNo=' + orderNo });
            } else {
              wx.navigateBack({ delta: 1 });
            }
          }
        });
      })
      .catch((err) => {
        this.setData({ submitting: false, errorText: (err && err.message) || '提交失败，请稍后重试' });
      });
  }
});
