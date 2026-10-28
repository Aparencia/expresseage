// pkg-admin/pages/recognition-review/index.js · 识别失败复核（按单看原图走 failure-image 组件；补录/忽略仅回填识别字段）
const admin = require('../../../api/modules/admin');
const C = require('../../common/constants');
const feedback = require('../../common/feedback');
const vm = require('./parts/view-model');

const PAGE_SIZE = 20;
const STATION_PICKER = ['请选择站点'].concat(C.STATION_OPTIONS);

function labelList(options) {
  return options.map(function label(item) {
    return item.label;
  });
}

Page({
  data: {
    loading: true,
    loadingMore: false,
    error: '',
    errorAt: '',
    forbidden: false,
    searched: false,
    statusTabs: vm.buildStatusTabs(C.FAILURE_STATUS_PENDING, null),
    activeStatus: C.FAILURE_STATUS_PENDING,
    counts: null,
    codeOptions: C.FAILURE_CODE_TABS,
    codeLabels: labelList(C.FAILURE_CODE_TABS),
    activeCode: '',
    codeIndex: 0,
    sourceOptions: C.FAILURE_SOURCE_TABS,
    sourceLabels: labelList(C.FAILURE_SOURCE_TABS),
    activeSource: '',
    sourceIndex: 0,
    dateOptions: C.FAILURE_DATE_TABS,
    dateLabels: labelList(C.FAILURE_DATE_TABS),
    activeDate: C.FAILURE_DATE_DEFAULT,
    dateIndex: 0,
    list: [],
    nextCursor: '',
    emptyText: vm.buildEmptyText(C.FAILURE_STATUS_PENDING),
    aiStatusText: '',
    aiStatusWarn: false,
    expandedNo: '',
    detail: null,
    detailLoading: false,
    stationOptions: STATION_PICKER,
    stationIndex: 0,
    pickupCode: '',
    notifyUploader: true,
    ignoreNote: '',
    submitting: false,
    showImage: false,
    imageFailureNo: ''
  },

  onLoad(query) {
    this.prefillFailureNo = query && query.failureNo ? decodeURIComponent(query.failureNo) : '';
    this.loadList(true).catch(function () {});
  },

  onPullDownRefresh() {
    this.loadList(true).then(function () {
      wx.stopPullDownRefresh();
    }).catch(function () {
      wx.stopPullDownRefresh();
    });
  },

  onReachBottom() {
    this.loadMore();
  },

  buildParams() {
    return vm.buildParams({
      activeStatus: this.data.activeStatus,
      activeCode: this.data.activeCode,
      activeSource: this.data.activeSource,
      activeDate: this.data.activeDate,
      limit: PAGE_SIZE
    }, Date.now());
  },

  loadList(reset) {
    if (reset) this.setData({ loading: true, error: '' });
    return admin.listRecognitionFailures(this.buildParams()).then((result) => {
      const rows = vm.decorateList((result && result.list) || [], this.data.expandedNo);
      const counts = (result && result.counts) || null;
      const aiStatus = (result && result.aiStatus) || null;
      this.setData({
        list: reset ? rows : this.data.list.concat(rows),
        nextCursor: (result && result.nextCursor) || '',
        counts: counts,
        aiStatusText: vm.buildAiStatusText(aiStatus),
        aiStatusWarn: !!aiStatus && (aiStatus.enabled !== true || aiStatus.hasKey !== true),
        statusTabs: vm.buildStatusTabs(this.data.activeStatus, counts || this.data.counts),
        emptyText: vm.buildEmptyText(this.data.activeStatus),
        loading: false,
        loadingMore: false,
        searched: true
      });
      if (reset && this.prefillFailureNo) {
        this.focusPrefill(rows);
      }
    }).catch((err) => {
      feedback.handleError(this, err);
      throw err;
    });
  },

  // 首屏 ?failureNo= 定位：不在当前筛选首页时也打开详情，并提示如何找到该记录
  focusPrefill(rows) {
    const target = this.prefillFailureNo;
    this.prefillFailureNo = '';
    const found = (rows || []).some(function hasRow(row) {
      return row.failureNo === target;
    });
    if (!found) {
      feedback.toast('该记录不在当前筛选第一页，已打开详情；如无显示请调整筛选后重试。');
    }
    this.expand(target);
  },

  loadMore() {
    if (this.data.loading || this.data.loadingMore || !this.data.nextCursor) return;
    this.setData({ loadingMore: true });
    const params = this.buildParams();
    params.cursor = this.data.nextCursor;
    admin.listRecognitionFailures(params).then((result) => {
      const rows = vm.decorateList((result && result.list) || [], this.data.expandedNo);
      this.setData({
        list: this.data.list.concat(rows),
        nextCursor: (result && result.nextCursor) || '',
        loadingMore: false
      });
    }).catch((err) => {
      this.setData({ loadingMore: false });
      feedback.toast(err && err.message);
    });
  },

  onRowTap(event) {
    const failureNo = event.currentTarget.dataset.no;
    if (!failureNo) return;
    if (this.data.expandedNo === failureNo) {
      this.collapse();
      return;
    }
    this.expand(failureNo);
  },

  expand(failureNo) {
    this.setData({
      expandedNo: failureNo,
      detail: null,
      detailLoading: true,
      stationIndex: 0,
      pickupCode: '',
      ignoreNote: '',
      notifyUploader: true,
      error: ''
    });
    admin.getRecognitionFailure({ failureNo: failureNo }).then((data) => {
      this.setData({ detail: vm.decorateDetail(data || {}), detailLoading: false });
      this.refreshRows();
    }).catch((err) => {
      this.setData({ detailLoading: false, expandedNo: '' });
      feedback.toast(err && err.message);
    });
  },

  collapse() {
    this.setData({ expandedNo: '', detail: null, showImage: false });
  },

  refreshRows() {
    const rows = this.data.list.map((item) => this.decorateRow(item));
    this.setData({ list: rows });
  },

  onStatusTab(event) {
    const key = event.currentTarget.dataset.key;
    if (key === this.data.activeStatus) return;
    this.setData({
      activeStatus: key,
      statusTabs: vm.buildStatusTabs(key, this.data.counts),
      expandedNo: '',
      detail: null
    });
    this.loadList(true).catch(function () {});
  },

  onCodeChange(event) {
    const index = Number(event.detail.value);
    const option = this.data.codeOptions[index] || this.data.codeOptions[0];
    this.setData({ codeIndex: index, activeCode: option.key || '', expandedNo: '', detail: null });
    this.loadList(true).catch(function () {});
  },

  onSourceChange(event) {
    const index = Number(event.detail.value);
    const option = this.data.sourceOptions[index] || this.data.sourceOptions[0];
    this.setData({ sourceIndex: index, activeSource: option.key || '', expandedNo: '', detail: null });
    this.loadList(true).catch(function () {});
  },

  onDateChange(event) {
    const index = Number(event.detail.value);
    const option = this.data.dateOptions[index] || this.data.dateOptions[0];
    this.setData({ dateIndex: index, activeDate: option.key, expandedNo: '', detail: null });
    this.loadList(true).catch(function () {});
  },

  onRetry() {
    this.loadList(true).catch(function () {});
  },

  onToggleOcr() {
    if (!this.data.detail) return;
    this.setData({ 'detail.ocrExpanded': !this.data.detail.ocrExpanded });
  },

  onStationChange(event) {
    this.setData({ stationIndex: Number(event.detail.value) });
  },

  onPickupCodeInput(event) {
    this.setData({ pickupCode: event.detail.value });
  },

  onIgnoreNoteInput(event) {
    this.setData({ ignoreNote: event.detail.value });
  },

  onNotifyChange(event) {
    this.setData({ notifyUploader: event.detail.value === true });
  },

  selectedStationId() {
    return this.data.stationIndex > 0 ? this.data.stationOptions[this.data.stationIndex] || '' : '';
  },

  onFix() {
    if (this.data.submitting || !this.data.detail) return;
    const checked = vm.validateFix({
      stationId: this.selectedStationId(),
      pickupCode: this.data.pickupCode
    });
    if (!checked.ok) {
      feedback.toast(checked.error);
      return;
    }
    feedback.confirm({
      title: '保存补录',
      content: vm.fixConfirmContent(checked.stationId, checked.pickupCode),
      confirmText: '确认保存'
    }).then((res) => {
      if (res.confirm) this.submitFix(checked.stationId, checked.pickupCode);
    });
  },

  submitFix(stationId, pickupCode) {
    const failureNo = this.data.detail.failureNo;
    const payload = { failureNo: failureNo, notifyUploader: this.data.notifyUploader };
    if (stationId) payload.stationId = stationId;
    if (pickupCode) payload.pickupCode = pickupCode;
    this.setData({ submitting: true });
    admin.fixRecognitionFailure(payload).then((result) => {
      const orderNo = (result && result.orderNo) || this.data.detail.orderNo;
      this.setData({ submitting: false });
      feedback.toast(orderNo ? '已补录并回填关联订单 ' + orderNo + '。' : '已补录；该记录没有关联订单，未回填订单。');
      this.collapse();
      this.loadList(true).catch(function () {});
    }).catch((err) => {
      this.setData({ submitting: false });
      feedback.toast(err && err.message);
    });
  },

  onIgnore() {
    if (this.data.submitting || !this.data.detail) return;
    const checked = vm.validateIgnoreNote(this.data.ignoreNote);
    if (!checked.ok) {
      feedback.toast(checked.error);
      return;
    }
    feedback.confirm({
      title: '标记忽略',
      content: '忽略后该记录不再出现在待复核列表，但不会删除记录与审计；忽略原因已填写（最多 100 字）。确定忽略？',
      confirmText: '确认忽略',
      danger: true
    }).then((res) => {
      if (res.confirm) this.submitIgnore(checked.note);
    });
  },

  submitIgnore(note) {
    this.setData({ submitting: true });
    admin.ignoreRecognitionFailure({
      failureNo: this.data.detail.failureNo,
      note: note,
      notifyUploader: this.data.notifyUploader
    }).then(() => {
      this.setData({ submitting: false });
      feedback.toast('已标记忽略。');
      this.collapse();
      this.loadList(true).catch(function () {});
    }).catch((err) => {
      this.setData({ submitting: false });
      feedback.toast(err && err.message);
    });
  },

  onViewImage() {
    if (!this.data.detail) return;
    if (this.data.detail.hasImage !== true) {
      feedback.toast('该记录没有关联原图，无法查看。');
      return;
    }
    this.setData({ showImage: true, imageFailureNo: this.data.detail.failureNo });
  },

  onCloseImage() {
    this.setData({ showImage: false, imageFailureNo: '' });
  },

  onImageLoaded() {
    this.setData({ showImage: true });
  },

  onImageError() {
    this.setData({ showImage: false });
    feedback.toast('原图加载失败，请刷新后重试；多次失败请联系运维。');
  },

  onOpenOrder(event) {
    const no = event.currentTarget.dataset.no || (this.data.detail && this.data.detail.orderNo);
    if (!no) return;
    feedback.go(C.PAGE_URLS.orderDetail + '?orderNo=' + encodeURIComponent(no));
  },

  noop() {}
});
