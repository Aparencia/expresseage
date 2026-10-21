// pkg-admin/pages/recognition-review/index.js · 识别失败复核（按单看原图走 failure-image 组件；补录/忽略仅回填识别字段）
const admin = require('../../../api/modules/admin');
const C = require('../../common/constants');
const F = require('../../common/format');
const feedback = require('../../common/feedback');

const PAGE_SIZE = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
const STATION_PICKER = ['请选择站点'].concat(C.STATION_OPTIONS);

function buildStatusTabs(activeStatus, counts) {
  return C.FAILURE_STATUS_TABS.map(function (tab) {
    const raw = counts ? counts[tab.key] : undefined;
    return {
      key: tab.key,
      label: tab.label,
      active: tab.key === activeStatus,
      countText: raw === undefined || raw === null ? '' : ' ' + raw
    };
  });
}

function labelList(options) {
  return options.map(function (item) {
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
    statusTabs: buildStatusTabs(C.FAILURE_STATUS_PENDING, null),
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
    emptyText: '还没有识别失败记录。识别失败时系统会自动入队，可在这里排查。',
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
    const params = { status: this.data.activeStatus, limit: PAGE_SIZE };
    if (this.data.activeCode) params.failureCode = this.data.activeCode;
    if (this.data.activeSource) params.sourceRole = this.data.activeSource;
    const days = Number(this.data.activeDate);
    if (days > 0) params.dateFrom = Date.now() - days * DAY_MS;
    return params;
  },

  loadList(reset) {
    if (reset) this.setData({ loading: true, error: '' });
    return admin.listRecognitionFailures(this.buildParams()).then((result) => {
      const rows = ((result && result.list) || []).map((item) => this.decorateRow(item));
      const counts = (result && result.counts) || null;
      this.setData({
        list: reset ? rows : this.data.list.concat(rows),
        nextCursor: (result && result.nextCursor) || '',
        counts: counts,
        statusTabs: buildStatusTabs(this.data.activeStatus, counts || this.data.counts),
        emptyText: this.buildEmptyText(),
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

  focusPrefill(rows) {
    const target = this.prefillFailureNo;
    this.prefillFailureNo = '';
    if (rows.some(function (row) { return row.failureNo === target; })) {
      this.expand(target);
      return;
    }
    this.expand(target);
  },

  loadMore() {
    if (this.data.loading || this.data.loadingMore || !this.data.nextCursor) return;
    this.setData({ loadingMore: true });
    const params = this.buildParams();
    params.cursor = this.data.nextCursor;
    admin.listRecognitionFailures(params).then((result) => {
      const rows = ((result && result.list) || []).map((item) => this.decorateRow(item));
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

  buildEmptyText() {
    if (this.data.activeStatus === C.FAILURE_STATUS_PENDING) {
      return '还没有识别失败记录。识别失败时系统会自动入队，可在这里排查。';
    }
    return '没有符合当前筛选的识别失败记录。';
  },

  decorateRow(item) {
    return {
      failureNo: item.failureNo || '—',
      failureCodeText: C.FAILURE_CODE_LABELS[item.failureCode] || '识别失败',
      sourceRoleText: C.ROLE_LABELS[item.sourceRole] || '—',
      uploaderText: F.joinParts([item.uploaderNo, item.uploaderDisplayName], ' '),
      createdAtText: F.formatTime(item.createdAt),
      statusText: C.FAILURE_STATUS_LABELS[item.status] || '—',
      orderNo: item.orderNo || '',
      expanded: item.failureNo === this.data.expandedNo
    };
  },

  decorateDetail(data) {
    const ocrText = data.ocrTextMasked || '';
    const fold = C.LIMITS.ocrFoldAt;
    const ocrFoldable = ocrText.length > fold;
    const ruleText = this.buildRuleText(data.ruleResult);
    const resolution = data.resolution || {};
    return {
      failureNo: data.failureNo || '',
      failureCodeText: C.FAILURE_CODE_LABELS[data.failureCode] || '识别失败',
      sourceRoleText: C.ROLE_LABELS[data.sourceRole] || '—',
      uploaderText: F.joinParts([data.uploaderNo, data.uploaderDisplayName], ' '),
      orderNo: data.orderNo || '',
      statusText: C.FAILURE_STATUS_LABELS[data.status] || '—',
      canReview: data.status === C.FAILURE_STATUS_PENDING,
      createdAtText: F.formatTime(data.createdAt),
      reviewedAtText: data.reviewedAt ? F.formatTime(data.reviewedAt) : '',
      ocrText: ocrText,
      ocrShort: ocrFoldable ? ocrText.slice(0, fold) + '…' : ocrText,
      ocrFoldable: ocrFoldable,
      ocrExpanded: false,
      ruleText: ruleText,
      aiTriedText: data.aiTried ? '已尝试' : '未尝试',
      aiModelText: data.aiModel || '—',
      aiResultText: this.buildAiResultText(data.aiResult),
      aiErrorText: data.aiErrorCode ? '智能识别未成功' : '',
      resolutionNote: resolution.note || '',
      resolutionAtText: resolution.at ? F.formatTime(resolution.at) : ''
    };
  },

  buildRuleText(rule) {
    if (!rule) return '规则未识别到站点或取件码';
    if (typeof rule === 'string') return rule;
    const parts = [];
    if (rule.stationId) parts.push('站点 ' + rule.stationId);
    if (rule.pickupCode) parts.push('取件码 ' + rule.pickupCode);
    return parts.length ? parts.join(' · ') : '规则未识别到站点或取件码';
  },

  buildAiResultText(result) {
    if (!result) return '—';
    if (typeof result === 'string') return result;
    const parts = [];
    if (result.stationId) parts.push('站点 ' + result.stationId);
    if (result.pickupCode) parts.push('取件码 ' + result.pickupCode);
    if (result.confidence) parts.push('置信度 ' + result.confidence);
    return parts.length ? parts.join(' · ') : '—';
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
      this.setData({ detail: this.decorateDetail(data || {}), detailLoading: false });
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
      statusTabs: buildStatusTabs(key, this.data.counts),
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
    const stationId = this.selectedStationId();
    const pickupCode = String(this.data.pickupCode || '').trim();
    if (!stationId && !pickupCode) {
      feedback.toast('请选择站点或填写取件码后再补录。');
      return;
    }
    if (pickupCode.length > C.LIMITS.pickupCodeMax) {
      feedback.toast('取件码最多 40 位。');
      return;
    }
    feedback.confirm({
      title: '保存补录',
      content: '将把站点改为 ' + (stationId || '（未填写）') + '、取件码改为 ' + (pickupCode || '（未填写）') +
        '，仅回填识别字段；不改订单状态、不代确认、不创建订单。确定保存？',
      confirmText: '确认保存'
    }).then((res) => {
      if (res.confirm) this.submitFix(stationId, pickupCode);
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
    const note = String(this.data.ignoreNote || '').trim();
    if (!note) {
      feedback.toast('请填写忽略原因（最多 100 字）。');
      return;
    }
    if (note.length > C.LIMITS.ignoreNoteMax) {
      feedback.toast('忽略原因最多 100 字。');
      return;
    }
    feedback.confirm({
      title: '标记忽略',
      content: '忽略后该记录不再出现在待复核列表，但不会删除记录与审计。确定忽略？',
      confirmText: '确认忽略',
      danger: true
    }).then((res) => {
      if (res.confirm) this.submitIgnore(note);
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
