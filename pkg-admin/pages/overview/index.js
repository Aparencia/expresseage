// pkg-admin/pages/overview/index.js · 开发者总览（统计卡 + 识别失败待复核 + 审计区块）
const admin = require('../../../api/modules/admin');
const C = require('../../common/constants');
const F = require('../../common/format');
const feedback = require('../../common/feedback');

const AUDIT_PAGE_SIZE = 20;

Page({
  data: {
    developerNo: '',
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
    const counts = stats.counts || {};
    const today = stats.today || {};
    const config = stats.config || {};
    const maintenance = config.maintenance || {};
    const announcement = config.announcement || {};
    const pendingFailures = F.numOrZero(counts.pendingFailures || counts.pendingRecognitionFailures);
    const exceptions = F.numOrZero(counts.exceptions);
    const statusBar = [];
    if (maintenance.enabled) {
      statusBar.push('维护中：' + (maintenance.text || '系统维护中'));
    }
    if (announcement.enabled) {
      statusBar.push('公告：' + (announcement.title || '已启用'));
    }
    this.setData({
      developerNo: stats.developerNo || '',
      counts: {
        todayOrders: F.numOrZero(today.orders || counts.todayOrders),
        exceptions: exceptions,
        activePartners: F.numOrZero(counts.activePartners),
        customers: F.numOrZero(counts.activeCustomers || counts.customers),
        pendingFailures: pendingFailures
      },
      badge: exceptions + pendingFailures,
      statusBar: statusBar
    });
  },

  applyAudit(list, nextCursor, append) {
    const rows = list.map((item) => this.decorateAudit(item));
    const merged = append ? this.data.audit.concat(rows) : rows;
    this.setData({
      audit: merged,
      auditCursor: nextCursor,
      auditHasMore: !!nextCursor,
      loadingMore: false
    });
  },

  decorateAudit(item) {
    const actionText = C.AUDIT_ACTION_LABELS[item.action] || '其他操作';
    return {
      actionText: actionText,
      developerNo: item.developerNo || '—',
      targetText: this.decorateTarget(item.target),
      timeText: F.formatTime(item.at)
    };
  },

  decorateTarget(target) {
    if (!target) return '—';
    if (typeof target === 'string') return target;
    const label = target.no || target.displayName || target.type || '';
    return label ? String(label) : '—';
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
