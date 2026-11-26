// pkg-admin/pages/overview/index.js · 开发者总览（统计卡 + 识别失败待复核 + 审计区块）
const admin = require('../../../api/modules/admin');
const C = require('../../common/constants');
const feedback = require('../../common/feedback');
const staleRequest = require('../../../utils/stale-request');
const vm = require('./parts/view-model');

const AUDIT_PAGE_SIZE = 20;

Page({
  data: {
    header: vm.buildHeader(null),
    loadedOnce: false,
    loading: true,
    loadingMore: false,
    error: '',
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
    this._loadToken = 0;
    this._unloaded = false;
    this.loadAll();
  },

  onUnload() {
    // 离页位先置 + 代次作废：统计/审计的迟到包不再 setData、不弹假错（TD-100 同类）
    this._unloaded = true;
    this._loadToken = (this._loadToken || 0) + 1;
  },

  onShow() {
    if (this.data.loadedOnce) {
      this.loadAll();
    }
  },

  onPullDownRefresh() {
    return feedback.refresh(this, 'loadAll');
  },

  loadAll() {
    if (this._unloaded === true) {
      return Promise.resolve();
    }
    // 2026-11-26 审查修复（TD-100 同类）：onShow/下拉可并发，只有最新代次能落地
    const taken = { token: (this._loadToken || 0) + 1 };
    this._loadToken = taken.token;
    this.setData({ loading: true, error: '' });
    const statsTask = admin.stats({});
    const auditTask = admin.listAudit({ limit: AUDIT_PAGE_SIZE });
    return Promise.all([statsTask, auditTask]).then((result) => {
      if (this._unloaded === true || staleRequest.isStaleRequest({ token: this._loadToken }, taken)) {
        return;
      }
      const stats = result[0] || {};
      const auditData = result[1] || {};
      this.applyStats(stats);
      this.applyAudit(auditData.list || [], auditData.nextCursor || '', false);
      this.setData({ loading: false, loadedOnce: true });
    }).catch((err) => {
      if (this._unloaded === true || staleRequest.isStaleRequest({ token: this._loadToken }, taken)) {
        return;
      }
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
    if (this._unloaded === true) return;
    if (this.data.loadingMore || !this.data.auditCursor) return;
    // 追加页同样领代次：刷新（loadAll）插队后，旧审计页不再拼接到新列表上
    const taken = { token: (this._loadToken || 0) + 1 };
    this._loadToken = taken.token;
    this.setData({ loadingMore: true });
    admin.listAudit({ cursor: this.data.auditCursor, limit: AUDIT_PAGE_SIZE }).then((result) => {
      if (this._unloaded === true || staleRequest.isStaleRequest({ token: this._loadToken }, taken)) {
        return;
      }
      this.applyAudit((result && result.list) || [], (result && result.nextCursor) || '', true);
    }).catch((err) => {
      if (this._unloaded === true || staleRequest.isStaleRequest({ token: this._loadToken }, taken)) {
        return;
      }
      this.setData({ loadingMore: false });
      feedback.toast(err && err.message);
    });
  },

  onRetry() {
    this.loadAll().catch(function () {});
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
