// pkg-admin/pages/messages/index.js · 后台消息（异常工单 + 识别失败待复核摘要 + 系统状态，聚合视图）
const admin = require('../../../api/modules/admin');
const C = require('../../common/constants');
const F = require('../../common/format');
const feedback = require('../../common/feedback');

Page({
  data: {
    loading: true,
    error: '',
    errorAt: '',
    forbidden: false,
    exceptions: [],
    failures: [],
    systemLines: [],
    loadedOnce: false
  },

  onLoad() {
    this.load();
  },

  onShow() {
    if (this.data.loadedOnce) {
      this.load();
    }
  },

  onPullDownRefresh() {
    this.load().then(function () {
      wx.stopPullDownRefresh();
    }).catch(function () {
      wx.stopPullDownRefresh();
    });
  },

  load() {
    this.setData({ loading: true, error: '' });
    return Promise.all([
      admin.listOrders({ status: C.ORDER_STATUS_EXCEPTION, limit: 20 }),
      admin.listRecognitionFailures({ status: C.FAILURE_STATUS_PENDING, limit: 5 }),
      admin.stats({})
    ]).then((result) => {
      const orderData = result[0] || {};
      const failureData = result[1] || {};
      const stats = result[2] || {};
      this.setData({
        exceptions: (orderData.list || []).map((item) => this.decorateOrder(item)),
        failures: (failureData.list || []).map((item) => this.decorateFailure(item)),
        systemLines: this.buildSystemLines(stats.config || {}),
        loading: false,
        loadedOnce: true
      });
    }).catch((err) => {
      this.setData({ loading: false });
      feedback.handleError(this, err);
      throw err;
    });
  },

  decorateOrder(item) {
    const exception = item.exception || {};
    return {
      orderNo: item.orderNo || '—',
      exceptionText: exception.codeText || exception.code || '异常工单',
      reportedAtText: exception.reportedAt ? F.formatTime(exception.reportedAt) : '',
      partnerNo: item.partnerNo || '',
      isTest: item.isTest === true
    };
  },

  decorateFailure(item) {
    return {
      failureNo: item.failureNo || '—',
      failureCodeText: C.FAILURE_CODE_LABELS[item.failureCode] || '识别失败',
      sourceRoleText: C.ROLE_LABELS[item.sourceRole] || '—',
      uploaderText: F.joinParts([item.uploaderNo, item.uploaderDisplayName], ' '),
      createdAtText: F.formatTime(item.createdAt),
      orderNo: item.orderNo || ''
    };
  },

  buildSystemLines(config) {
    const lines = [];
    const maintenance = config.maintenance || {};
    const announcement = config.announcement || {};
    if (maintenance.enabled) {
      lines.push('维护中：' + (maintenance.text || '系统维护中'));
    }
    if (announcement.enabled) {
      lines.push('公告已启用：' + (announcement.title || '请查看端侧公告'));
    }
    return lines;
  },

  onRetry() {
    this.load().catch(function () {});
  },

  onHandleOrder(event) {
    const no = event.currentTarget.dataset.no;
    if (!no) return;
    feedback.go(C.PAGE_URLS.orderDetail + '?orderNo=' + encodeURIComponent(no));
  },

  onReviewFailure(event) {
    const no = event.currentTarget.dataset.no;
    const url = no
      ? C.PAGE_URLS.recognitionReview + '?failureNo=' + encodeURIComponent(no)
      : C.PAGE_URLS.recognitionReview;
    feedback.go(url);
  }
});
