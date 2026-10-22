// pkg-admin/pages/account-switch/index.js · 账号切换（真实账号只读 / 测试账号可写 + 测试账号管理）
const admin = require('../../../api/modules/admin');
const session = require('../../../utils/session');
const enums = require('../../../shared/enums');
const C = require('../../common/constants');
const F = require('../../common/format');
const feedback = require('../../common/feedback');
const vm = require('./parts/view-model');

const ACCOUNT_LIMIT = 50;
const SEARCH_LIMIT = 10;

Page({
  data: {
    loading: true,
    error: '',
    errorAt: '',
    forbidden: false,
    submitting: false,
    activeTab: C.ACCOUNT_TAB_REAL,
    tabs: vm.buildTabs(C.ACCOUNT_TAB_REAL),
    isRealTab: true,
    isTestTab: false,
    ttlMinutes: C.DEFAULT_TTL_MINUTES,
    maxPerRole: C.DEFAULT_TEST_ACCOUNT_MAX_PER_ROLE,
    maxTotal: C.TEST_ACCOUNT_TOTAL_MAX,
    roleChips: vm.buildRoleChips(C.ROLE_CUSTOMER),
    role: C.ROLE_CUSTOMER,
    noPlaceholder: C.CUSTOMER_NO_PLACEHOLDER,
    keyword: '',
    searchLoading: false,
    searched: false,
    candidates: [],
    selected: null,
    testLoading: true,
    testAccounts: [],
    customerUsed: 0,
    partnerUsed: 0,
    totalUsed: 0,
    selectedTest: null,
    showCreate: false,
    roleLabels: C.ROLE_OPTIONS.map(function (option) { return option.label; }),
    createRoleIndex: 0,
    createRole: C.ROLE_CUSTOMER,
    createName: '',
    creating: false,
    showPurge: false,
    purgeLoading: false,
    purgeCounts: null,
    purgeSessionsEnded: 0,
    purgeCheck: false,
    purgeText: '',
    purgeError: ''
  },

  onLoad(query) {
    this.prefillTarget = '';
    this.applyQuery(query || {});
    this.loadStats();
  },

  applyQuery(query) {
    const tab = query.tab === C.ACCOUNT_TAB_TEST ? C.ACCOUNT_TAB_TEST : C.ACCOUNT_TAB_REAL;
    const role = query.role === C.ROLE_PARTNER ? C.ROLE_PARTNER : C.ROLE_CUSTOMER;
    const targetNo = query.targetNo ? decodeURIComponent(query.targetNo) : '';
    this.prefillTarget = targetNo;
    if (tab === C.ACCOUNT_TAB_TEST) {
      this.setData({ activeTab: tab, tabs: vm.buildTabs(tab), isRealTab: false, isTestTab: true });
      return;
    }
    this.setData({
      activeTab: tab,
      tabs: vm.buildTabs(tab),
      isRealTab: true,
      isTestTab: false,
      role: role,
      roleChips: vm.buildRoleChips(role),
      noPlaceholder: role === C.ROLE_PARTNER ? C.PARTNER_NO_PLACEHOLDER : C.CUSTOMER_NO_PLACEHOLDER,
      keyword: targetNo
    });
  },

  loadStats() {
    this.setData({ loading: true, error: '' });
    return admin.stats({}).then((stats) => {
      const config = (stats && stats.config) || {};
      const maxPerRole = F.numOrZero(config.testAccountMaxPerRole) || C.DEFAULT_TEST_ACCOUNT_MAX_PER_ROLE;
      this.setData({
        ttlMinutes: C.pickTtlMinutes(config),
        maxPerRole: maxPerRole,
        maxTotal: maxPerRole * 2,
        loading: false
      });
      if (this.data.isTestTab) {
        this.loadTestAccounts();
      } else if (this.prefillTarget) {
        this.searchReal();
      }
    }).catch((err) => {
      feedback.handleError(this, err);
    });
  },

  onRetry() {
    this.loadStats();
  },

  onTabTap(event) {
    const key = event.currentTarget.dataset.key;
    if (key === this.data.activeTab) return;
    const isTest = key === C.ACCOUNT_TAB_TEST;
    this.setData({
      activeTab: key,
      tabs: vm.buildTabs(key),
      isRealTab: !isTest,
      isTestTab: isTest,
      error: ''
    });
    if (isTest) {
      this.loadTestAccounts();
    }
  },

  onRoleTap(event) {
    const role = event.currentTarget.dataset.key;
    if (!role || role === this.data.role) return;
    this.setData({
      role: role,
      roleChips: vm.buildRoleChips(role),
      noPlaceholder: role === C.ROLE_PARTNER ? C.PARTNER_NO_PLACEHOLDER : C.CUSTOMER_NO_PLACEHOLDER,
      keyword: '',
      candidates: [],
      selected: null,
      searched: false
    });
  },

  onKeywordInput(event) {
    this.setData({ keyword: event.detail.value });
  },

  searchReal() {
    if (this.data.searchLoading) return;
    const keyword = String(this.data.keyword || '').trim();
    if (!keyword) {
      feedback.toast('请输入完整编号后再搜索。');
      return;
    }
    this.setData({ searchLoading: true, searched: false, candidates: [], selected: null });
    const plan = vm.buildRealSearchParams({ role: this.data.role, keyword: keyword, limit: SEARCH_LIMIT });
    const task = plan.action === 'listPartners'
      ? admin.listPartners(plan.payload)
      : admin.listCustomers(plan.payload);
    task.then((result) => {
      const list = (result && result.list) || [];
      const isPartner = this.data.role === C.ROLE_PARTNER;
      this.setData({
        candidates: list.map(function mapCandidate(item) {
          return vm.decorateCandidate(item, isPartner);
        }),
        searched: true,
        searchLoading: false
      });
      if (this.prefillTarget) {
        this.prefillTarget = '';
        const target = this.data.candidates.filter(function matchTarget(item) {
          return item.targetNo === keyword;
        })[0];
        if (target) {
          this.selectCandidate(target);
        } else {
          feedback.toast('该用户当前不可查看，请确认对方账号处于正常状态后再试。');
        }
      }
    }).catch((err) => {
      this.setData({ searchLoading: false, searched: true });
      feedback.toast(err && err.message);
    });
  },

  onSelectCandidate(event) {
    const index = Number(event.currentTarget.dataset.index);
    const candidate = this.data.candidates[index];
    if (!candidate) return;
    if (!candidate.rawTargetNo) {
      feedback.toast('该账号缺少可用编号，请刷新后重试。');
      return;
    }
    const candidates = this.data.candidates.map(function (item) {
      return Object.assign({}, item, { selected: false });
    });
    candidates[index].selected = true;
    this.setData({ candidates: candidates });
    this.selectCandidate(candidates[index]);
  },

  selectCandidate(candidate) {
    this.setData({
      selected: {
        role: candidate.role,
        roleText: candidate.roleText,
        targetNo: candidate.rawTargetNo,
        displayName: candidate.displayName
      }
    });
  },

  onClearSelected() {
    this.setData({ selected: null });
  },

  confirmEnter(options) {
    const content = options.testMode
      ? vm.buildTestConfirmContent(options, this.data.ttlMinutes)
      : vm.buildRealConfirmContent(options, this.data.ttlMinutes);
    feedback.confirm({
      title: options.testMode ? '进入测试视图' : '进入只读视图',
      content: content,
      confirmText: '确定进入'
    }).then((res) => {
      if (res.confirm) this.startView(options);
    });
  },

  startView(options) {
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    admin.viewAsStart({
      role: options.role,
      targetNo: options.targetNo,
      mode: options.mode
    }).then(function enterView(viewContext) {
      // viewContext 先入内存、再 bootstrap 水合目标身份：只写 viewContext 会让页面拿开发者空身份渲染
      return session.enterViewContext(viewContext);
    }).then((viewContext) => {
      this.setData({ submitting: false });
      feedback.toast(options.testMode
        ? '已进入测试视图（' + this.data.ttlMinutes + ' 分钟）'
        : '已进入只读视图（' + this.data.ttlMinutes + ' 分钟）');
      wx.reLaunch({ url: C.TARGET_HOME[options.role] || C.PAGE_URLS.overview });
    }).catch((err) => {
      this.setData({ submitting: false });
      feedback.toast(err && err.message);
    });
  },

  enterReal() {
    const selected = this.data.selected;
    if (!selected) return;
    this.confirmEnter({
      role: selected.role,
      roleText: selected.roleText,
      targetNo: selected.targetNo,
      displayName: selected.displayName,
      mode: enums.VIEW_MODE.READONLY,
      testMode: false
    });
  },

  enterTest() {
    const selected = this.data.selectedTest;
    if (!selected) return;
    if (selected.isTestAccount === false) {
      feedback.toast('该账号不是测试账号，不能进入测试视图。');
      return;
    }
    this.confirmEnter({
      role: selected.role,
      roleText: selected.roleText,
      targetNo: selected.targetNo,
      displayName: selected.displayName,
      mode: enums.VIEW_MODE.TEST_WRITE,
      testMode: true
    });
  },

  loadTestAccounts() {
    this.setData({ testLoading: true });
    admin.listTestAccounts({ limit: ACCOUNT_LIMIT }).then((result) => {
      const list = (result && result.list) || [];
      const rows = list.map((item) => vm.decorateTestAccount(item));
      const customerUsed = rows.filter(function (item) { return item.role === C.ROLE_CUSTOMER; }).length;
      const partnerUsed = rows.filter(function (item) { return item.role === C.ROLE_PARTNER; }).length;
      this.setData({
        testAccounts: rows,
        customerUsed: customerUsed,
        partnerUsed: partnerUsed,
        totalUsed: rows.length,
        testLoading: false
      });
      if (this.prefillTarget) {
        const target = rows.filter(function (item) {
          return item.targetNo === this.prefillTarget;
        }, this)[0];
        this.prefillTarget = '';
        if (target) {
          this.setData({ selectedTest: target });
        }
      }
    }).catch((err) => {
      this.setData({ testLoading: false });
      feedback.toast(err && err.message);
    });
  },

  onSelectTest(event) {
    const index = Number(event.currentTarget.dataset.index);
    const account = this.data.testAccounts[index];
    if (!account) return;
    this.setData({ selectedTest: account });
  },

  onClearSelectedTest() {
    this.setData({ selectedTest: null });
  },

  onOpenCreate() {
    this.setData({
      showCreate: true,
      createRoleIndex: 0,
      createRole: C.ROLE_CUSTOMER,
      createName: ''
    });
  },

  onCloseCreate() {
    if (this.data.creating) return;
    this.setData({ showCreate: false });
  },

  onCreateRoleChange(event) {
    const index = Number(event.detail.value);
    const option = C.ROLE_OPTIONS[index] || C.ROLE_OPTIONS[0];
    this.setData({ createRoleIndex: index, createRole: option.key });
  },

  onCreateNameInput(event) {
    this.setData({ createName: event.detail.value });
  },

  onCreateOnly() {
    this.createAccount(false);
  },

  onCreateAndSwitch() {
    this.createAccount(true);
  },

  createAccount(autoSwitch) {
    if (this.data.creating) return;
    const role = this.data.createRole;
    const quota = vm.quotaState({
      role: role,
      customerUsed: this.data.customerUsed,
      partnerUsed: this.data.partnerUsed,
      totalUsed: this.data.totalUsed,
      maxPerRole: this.data.maxPerRole,
      maxTotal: this.data.maxTotal
    });
    if (quota.blocked) {
      feedback.toast(quota.copy);
      return;
    }
    const checked = vm.validateCreateName(this.data.createName, C.LIMITS.testDisplayNameMax);
    if (!checked.ok) {
      feedback.toast(checked.error);
      return;
    }
    this.setData({ creating: true });
    admin.createTestAccount({ role: role, displayName: checked.displayName }).then((account) => {
      this.setData({ creating: false, showCreate: false });
      const targetNo = (account && (account.customerNo || account.partnerNo || account.targetNo)) || '';
      feedback.toast('已创建测试账号 ' + targetNo + '（' + vm.roleLabel(role) + '）。');
      if (autoSwitch && targetNo) {
        this.confirmEnter({
          role: role,
          roleText: vm.roleLabel(role),
          targetNo: targetNo,
          displayName: checked.displayName,
          mode: enums.VIEW_MODE.TEST_WRITE,
          testMode: true
        });
        return;
      }
      this.loadTestAccounts();
    }).catch((err) => {
      this.setData({ creating: false });
      feedback.toast(err && err.message);
    });
  },

  onDeleteTest(event) {
    const index = Number(event.currentTarget.dataset.index);
    const account = this.data.testAccounts[index];
    if (!account || this.data.submitting) return;
    // 先 dryRun 拿将删除条数（含订单/事件/留言/绑定/识别失败/avatarFiles 文件数与活跃会话数），
    // 再二次确认；真实引用时服务端直接拒绝并显示其原因。确认文案由 parts/view-model 纯件生成。
    this.setData({ submitting: true });
    admin.deleteTestAccount({ targetNo: account.targetNo, dryRun: true }).then((preview) => {
      this.setData({ submitting: false });
      return feedback.confirm({
        title: '删除测试账号',
        content: vm.buildDeleteConfirmContent(account, preview),
        confirmText: '确认删除',
        danger: true,
        editable: true,
        placeholderText: '请输入“删除”确认'
      });
    }).then((res) => {
      if (!res || !res.confirm) return;
      if (String(res.content || '').trim() !== '删除') {
        feedback.toast('请输入“删除”两个字后再确认。');
        return;
      }
      this.submitDelete(account);
    }).catch((err) => {
      this.setData({ submitting: false });
      feedback.toast((err && err.message) || '操作失败，请稍后重试。');
    });
  },

  submitDelete(account) {
    this.setData({ submitting: true });
    admin.deleteTestAccount({ targetNo: account.targetNo, confirmText: '删除' }).then(() => {
      this.setData({ submitting: false, selectedTest: null });
      feedback.toast('已删除测试账号 ' + account.targetNo + ' 及其测试数据。');
      this.loadTestAccounts();
    }).catch((err) => {
      this.setData({ submitting: false });
      feedback.toast(err && err.message);
    });
  },

  onOpenPurge() {
    this.setData({ showPurge: true, purgeLoading: true, purgeCounts: null, purgeSessionsEnded: 0, purgeCheck: false, purgeText: '', purgeError: '' });
    admin.purgeTestData({ dryRun: true }).then((result) => {
      this.setData({
        purgeLoading: false,
        purgeCounts: (result && result.counts) || {},
        purgeSessionsEnded: F.numOrZero(result && result.sessionsEnded)
      });
    }).catch((err) => {
      this.setData({ purgeLoading: false, purgeError: (err && err.message) || '统计失败，请重试。' });
    });
  },

  onClosePurge() {
    this.setData({ showPurge: false });
  },

  onPurgeCheck(event) {
    this.setData({ purgeCheck: event.detail.value === true });
  },

  onPurgeTextInput(event) {
    this.setData({ purgeText: event.detail.value });
  },

  onPurgeSubmit() {
    if (this.data.submitting) return;
    if (!this.data.purgeCheck) {
      feedback.toast('请先勾选“我已知晓清理不可恢复”。');
      return;
    }
    if (String(this.data.purgeText || '').trim() !== '清空') {
      feedback.toast('请输入“清空”两个字后再确认。');
      return;
    }
    const counts = this.data.purgeCounts || {};
    feedback.confirm({
      title: '确认清空测试数据',
      content: vm.buildPurgeConfirmContent(counts),
      confirmText: '确认清空',
      danger: true
    }).then((res) => {
      if (res.confirm) this.submitPurge();
    });
  },

  submitPurge() {
    this.setData({ submitting: true });
    admin.purgeTestData({ dryRun: false, confirmText: '清空' }).then(() => {
      this.setData({ submitting: false, showPurge: false, purgeCounts: null, purgeSessionsEnded: 0, purgeCheck: false, purgeText: '' });
      feedback.toast('已清空测试数据，已记审计。');
      this.loadTestAccounts();
    }).catch((err) => {
      this.setData({ submitting: false, purgeError: (err && err.message) || '清空失败，请重试。' });
    });
  },

  noop() {}
});
