// pkg-partner/pages/review/index.js · 兼职「审核」核对页（2026-11-08 MVP；D92 增审核状态与件数增删）
// 目的：一屏查看顾客上传的每一张取件码截图与其订单信息，发现不一致可直接改订单字段（复用 order.correct）。
// D92：审核是订单级两级状态（未审核/已审核，可撤销重审）；未取件阶段可增减件数；审核不改订单状态、不阻塞取件。
// 边界：读写动作仍只经 api/；READONLY 不显示写入口且服务端二次拒绝。
'use strict';

const orderApi = require('../../../api/modules/order');
const client = require('../../../api/client');
const store = require('../../../store/index');
const stations = require('../../../shared/stations');
const reviewModel = require('./parts/review-model');

const EMPTY_TEXT = '今天没有需要核对的截图单。顾客上传截图后，订单会出现在这里。';

Page({
  data: {
    stage: 'list',
    rows: [],
    emptyText: EMPTY_TEXT,
    current: null,
    images: [],
    parcels: [],
    stationOptions: [],
    readonly: false,
    saving: false,
    loading: false,
    reviewLoading: false,
    error: ''
  },

  onLoad() {
    this.currentOrder = null;
    this._unloaded = false;
  },

  onUnload() {
    this._unloaded = true;
  },

  onShow() {
    if (this.data.stage === 'list') {
      this.loadList();
    }
  },

  onPullDownRefresh() {
    this.loadList().then(() => {
      if (!this._unloaded) wx.stopPullDownRefresh();
    }).catch(() => {
      if (!this._unloaded) wx.stopPullDownRefresh();
    });
  },

  loadList() {
    if (this.data.loading) return Promise.resolve();
    this.setData({ loading: true, error: '' });
    return orderApi.listPartner({ view: 'workbench' }).then((data) => {
      if (this._unloaded) return;
      const rows = reviewModel.listRowsOf((data && data.list) || []);
      this.setData({ loading: false, rows: rows, emptyText: rows.length ? '' : EMPTY_TEXT });
    }).catch((err) => {
      if (this._unloaded) return;
      this.setData({ loading: false, error: (err && err.message) || '审核列表没加载出来，请下拉重试' });
    });
  },

  onOpen(event) {
    const orderNo = (event.currentTarget.dataset || {}).orderNo;
    const row = (this.data.rows || []).filter((item) => item.orderNo === orderNo)[0];
    if (!row) return;
    this.setData({ stage: 'review', current: row, images: [], parcels: [], saving: false, reviewLoading: true, error: '' });
    orderApi.get({ orderNo: orderNo }).then((data) => {
      if (this._unloaded) return;
      const order = (data && data.order) || null;
      if (!order) {
        this.setData({ stage: 'list', reviewLoading: false, error: '订单没找到，请刷新后重试' });
        return;
      }
      this.currentOrder = order;
      this.renderOrder(order);
    }).catch((err) => {
      if (this._unloaded) return;
      this.setData({ stage: 'list', reviewLoading: false, error: (err && err.message) || '订单没加载出来，请重试' });
    });
  },

  renderOrder(order) {
    const parcels = reviewModel.parcelEditorsOf(order).map((item) => Object.assign({}, item, {
      origin: reviewModel.originOf(item)
    }));
    // 站点名/顺序以后台配置为单源（管理员改名后审核页不能拿出厂默认名回写）
    const config = store.get('config') || {};
    const options = stations.stationsFromConfig(config.stations).map((item) => ({ id: item.id, name: item.name }));
    const readonly = this.isReadonly();
    this.setData({
      current: {
        orderNo: order.orderNo,
        statusText: order.statusText || order.status,
        anchorText: reviewModel.anchorOf(order),
        // D92：审核状态与三个 can* 布尔（服务端下发，页面零判据）
        review: reviewModel.reviewOf(order)
      },
      parcels: parcels,
      stationOptions: options,
      readonly: readonly,
      reviewLoading: false
    });
    this.loadImages(order);
  },

  loadImages(order) {
    const count = reviewModel.imageCountOf(order);
    if (!count) {
      this.setData({ images: [] });
      return;
    }
    const indexes = [];
    for (let i = 0; i < count; i += 1) indexes.push(i);
    Promise.all(indexes.map((index) => orderApi.imageUrl({ orderNo: order.orderNo, index: index })
      .then((data) => ({ index: index, url: (data && data.url) || '' }))
      .catch(() => ({ index: index, url: '' })))).then((list) => {
      if (this._unloaded) return;
      this.setData({ images: list.filter((item) => item.url) });
    });
  },

  isReadonly() {
    const snapshot = store.snapshot();
    return !!(snapshot.viewContext && snapshot.viewContext.viewMode === 'READONLY');
  },

  onBack() {
    this.currentOrder = null;
    this.setData({ stage: 'list', current: null, images: [], parcels: [], error: '' });
    this.loadList();
  },

  // ---------- D92 审核状态与件数增删（全部走后端校验；页面只渲染 can* 与 toast） ----------
  submitReview(kind) {
    const order = this.currentOrder;
    if (!order) return Promise.resolve();
    if (this.data.readonly) {
      wx.showToast({ title: '开发者只读视角不能操作', icon: 'none' });
      return Promise.resolve();
    }
    // 幂等键进包络（api/client 只认 options.clientRequestId；放 data 里服务端读不到）
    const payload = { orderNo: order.orderNo };
    const opts = { expectedVersion: order.version, clientRequestId: client.createRequestId() };
    this.setData({ saving: true });
    return (kind === 'mark' ? orderApi.reviewMark(payload, opts) : orderApi.reviewReopen(payload, opts)).then((data) => {
      if (this._unloaded) return;
      this.currentOrder = (data && data.order) || order;
      this.renderOrder(this.currentOrder);
      this.setData({ saving: false });
      wx.showToast({ title: kind === 'mark' ? '已标记审核' : '已撤销审核', icon: 'none' });
    }).catch((err) => {
      if (this._unloaded) return;
      this.setData({ saving: false });
      wx.showToast({ title: (err && err.message) || '操作没成功，请重试', icon: 'none' });
    });
  },
  onReviewMark() {
    return this.submitReview('mark');
  },
  onReviewReopen() {
    return this.submitReview('reopen');
  },
  reviewParcels(payload) {
    const order = this.currentOrder;
    if (!order) return Promise.resolve();
    if (this.data.readonly) {
      wx.showToast({ title: '开发者只读视角不能操作', icon: 'none' });
      return Promise.resolve();
    }
    this.setData({ saving: true });
    return orderApi.reviewParcels(Object.assign({
      orderNo: order.orderNo
    }, payload), {
      expectedVersion: order.version,
      clientRequestId: client.createRequestId()
    }).then((data) => {
      if (this._unloaded) return;
      this.currentOrder = (data && data.order) || order;
      this.renderOrder(this.currentOrder);
      this.setData({ saving: false });
      wx.showToast({ title: payload.action === 'ADD' ? '已新增一件' : '已删除一件', icon: 'none' });
    }).catch((err) => {
      if (this._unloaded) return;
      this.setData({ saving: false });
      wx.showToast({ title: (err && err.message) || '操作没成功，请重试', icon: 'none' });
    });
  },
  onParcelAdd() {
    return this.reviewParcels({ action: 'ADD' });
  },
  onParcelRemove(event) {
    const index = Number((event.currentTarget.dataset || {}).index);
    if (!Number.isInteger(index) || index < 0) return Promise.resolve();
    return this.reviewParcels({ action: 'REMOVE', index: index });
  },

  onPreview(event) {
    const index = Number((event.currentTarget.dataset || {}).index);
    const urls = (this.data.images || []).map((item) => item.url);
    if (!urls.length) return;
    wx.previewImage({ urls: urls, current: urls[index] || urls[0] });
  },

  onFieldInput(event) {
    const dataset = event.currentTarget.dataset || {};
    const index = Number(dataset.index);
    const field = String(dataset.field || '');
    if (!Number.isInteger(index) || !field) return;
    this.setData({ ['parcels[' + index + '].' + field]: String((event.detail && event.detail.value) || '') });
  },

  onStationChange(event) {
    const index = Number((event.currentTarget.dataset || {}).index);
    const option = (this.data.stationOptions || [])[Number(event.detail.value)] || {};
    if (!Number.isInteger(index) || !option.id) return;
    this.setData({
      ['parcels[' + index + '].stationId']: option.id,
      ['parcels[' + index + '].stationName']: option.name
    });
  },

  onSave(event) {
    const index = Number((event.currentTarget.dataset || {}).index);
    if (this.data.readonly) {
      wx.showToast({ title: '只读视角不能修改', icon: 'none' });
      return;
    }
    const editor = (this.data.parcels || [])[index];
    if (!editor) return;
    const check = reviewModel.validateEditor(editor);
    if (!check.ok) {
      wx.showToast({ title: check.reason, icon: 'none' });
      return;
    }
    const patch = reviewModel.patchOf(editor);
    if (!Object.keys(patch).length) {
      wx.showToast({ title: '没有改动，改一处再保存', icon: 'none' });
      return;
    }
    if (this.data.saving) return;
    const orderNo = this.data.current ? this.data.current.orderNo : '';
    if (!orderNo) return;
    this.setData({ saving: true });
    const version = this.currentOrder && typeof this.currentOrder.version === 'number' ? this.currentOrder.version : 0;
    orderApi.correct({ orderNo: orderNo, itemIndex: index, patch: patch }, { expectedVersion: version })
      .then(() => {
        if (this._unloaded) return;
        this.setData({ saving: false });
        wx.showToast({ title: '第 ' + (index + 1) + ' 件已更正，顾客端同步', icon: 'none' });
        // 保存已成功：刷新失败不能再报「保存失败」（说真话），静默保留当前编辑值，用户可重进刷新
        return orderApi.get({ orderNo: orderNo }).then((data) => data || null).catch(() => null);
      })
      .then((data) => {
        if (this._unloaded || !data || !data.order) return;
        this.currentOrder = data.order;
        this.renderOrder(data.order);
      })
      .catch((err) => {
        if (this._unloaded) return;
        this.setData({ saving: false });
        wx.showToast({ title: (err && err.message) || '保存失败，请重试', icon: 'none' });
      });
  }
});
