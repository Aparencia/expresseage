// pkg-admin/pages/overview/index.js · 开发者总览（统计卡 + 识别失败待复核 + 审计区块）
const admin = require('../../../api/modules/admin');
const C = require('../../common/constants');
const feedback = require('../../common/feedback');
const vm = require('./parts/view-model');

const AUDIT_PAGE_SIZE = 20;

Page({
  data: {
    header: vm.buildHeader(null),
    loadedOnce: false,
    loading: true,
    loadingMore: false,
    error: '',
    errorAt: '',
    counts: {
      todayOrders: 0,
      exceptions: 0,
      activePartners: 0,
      customers: 0,
      pendingFailures: 0
    },
    badge: 0,
    statusBar: [],
    audit: [],
    auditCursor: '',
    auditHasMore: false
  },

  onLoad() {
    this.loadAll();
  },

  onShow() {
    if (this.data.loadedOnce) {
      this.loadAll();
    }
  },

  onPullDownRefresh() {
    this.loadAll().then(function () {
      wx.stopPullDownRefresh();
    }).catch(function () {
      wx.stopPullDownRefresh();
    });
  },

  loadAll() {
    this.setData({ loading: true, error: '' });
    const statsTask = admin.stats({});
    const auditTask = admin.listAudit({ limit: AUDIT_PAGE_SIZE });
    return Promise.all([statsTask, auditTask]).then((result) => {
      const stats = result[0] || {};
      const auditData = result[1] || {};
      this.applyStats(stats);
      this.applyAudit(auditData.list || [], auditData.nextCursor || '', false);
      this.setData({ loading: false, loadedOnce: true });
    }).catch((err) => {
      feedback.handleError(this, err);
      throw err;
    });
  },

  applyStats(stats) {
    const built = vm.buildCounts(stats);
    const config = (stats && stats.config) || {};
    this.setData({
      header: vm.buildHeader(stats),
      counts: built.counts,
      badge: built.badge,
      statusBar: vm.buildStatusBar(config)
    });
  },

  applyAudit(list, nextCursor, append) {
    const rows = vm.decorateAuditList(list);
    const merged = append ? this.data.audit.concat(rows) : rows;
    this.setData({
      audit: merged,
      auditCursor: nextCursor,
      auditHasMore: !!nextCursor,
      loadingMore: false
    });
  },

  onAuditMore() {
    if (this.data.loadingMore || !this.data.auditCursor) return;
    this.setData({ loadingMore: true });
    admin.listAudit({ cursor: this.data.auditCursor, limit: AUDIT_PAGE_SIZE }).then((result) => {
      this.applyAudit((result && result.list) || [], (result && result.nextCursor) || '', true);
    }).catch((err) => {
      this.setData({ loadingMore: false });
      feedback.toast(err && err.message);
    });
  },

  onRetry() {
    this.loadAll().catch(function () {});
  },

  onOpenCard(event) {
    feedback.go(event.currentTarget.dataset.url);
  },

  onOpenMessages() {
    feedback.go(C.PAGE_URLS.messages);
  },

  onOpenReview() {
    feedback.go(C.PAGE_URLS.recognitionReview);
  },

  onOpenCustomers() {
    feedback.go(C.PAGE_URLS.customers);
  },

  onOpenPartners() {
    feedback.go(C.PAGE_URLS.partners);
  },

  onOpenOrders() {
    feedback.go(C.PAGE_URLS.orders + '?status=' + C.ORDER_STATUS_EXCEPTION);
  },

  onOpenInviteCodes() {
    feedback.go(C.PAGE_URLS.inviteCodes);
  },

  onOpenAccountSwitch() {
    feedback.go(C.PAGE_URLS.accountSwitch);
  },

  onOpenConfig() {
    feedback.go(C.PAGE_URLS.config);
  }
});
