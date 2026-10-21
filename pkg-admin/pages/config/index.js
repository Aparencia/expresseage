// pkg-admin/pages/config/index.js · 全局配置（白名单字段可编辑；智能识别兜底只读展示）
// 口径：V4_UX_DEVELOPER §3.8/§7.4——保存前变更清单 + 二次确认；维护开启/关闭都二次确认；未保存返回拦截。
const admin = require('../../../api/modules/admin');
const C = require('../../common/constants');
const feedback = require('../../common/feedback');
const vm = require('./parts/view-model');

Page({
  data: {
    loading: true,
    error: '',
    errorAt: '',
    forbidden: false,
    saving: false,
    dirty: false,
    form: vm.emptyForm(),
    readonlyInfo: {
      aiFallbackText: '—',
      testAccountMaxPerRole: '—',
      testDataRetentionDays: '—'
    },
    ranges: C.CONFIG_RANGE,
    limits: C.LIMITS
  },

  onLoad() {
    this.original = null;
    this.loadConfig();
  },

  onUnload() {
    this.disableLeaveAlert();
  },

  onPullDownRefresh() {
    this.loadConfig().then(function () {
      wx.stopPullDownRefresh();
    }).catch(function () {
      wx.stopPullDownRefresh();
    });
  },

  loadConfig() {
    this.setData({ loading: true, error: '' });
    return admin.stats({}).then((stats) => {
      const config = (stats && stats.config) || {};
      const form = vm.buildForm(config);
      this.original = vm.buildPayload(form);
      this.setData({
        form: form,
        readonlyInfo: vm.buildReadonlyInfo(config),
        loading: false,
        dirty: false
      });
      this.disableLeaveAlert();
    }).catch((err) => {
      feedback.handleError(this, err);
      throw err;
    });
  },

  markDirty() {
    if (this.data.dirty) return;
    this.setData({ dirty: true });
    if (wx.enableAlertBeforeUnload) {
      wx.enableAlertBeforeUnload({ message: '配置尚未保存，确定离开？' });
    }
  },

  disableLeaveAlert() {
    if (wx.disableAlertBeforeUnload) {
      wx.disableAlertBeforeUnload();
    }
  },

  onZoneInput(event) {
    const index = Number(event.currentTarget.dataset.index);
    const zones = this.data.form.zones.slice();
    if (!zones[index]) return;
    zones[index].value = event.detail.value;
    this.setData({ 'form.zones': zones });
    this.markDirty();
  },

  onServiceInput(event) {
    const index = Number(event.currentTarget.dataset.index);
    const field = event.currentTarget.dataset.field;
    const services = this.data.form.services.slice();
    if (!services[index] || (field !== 'name' && field !== 'desc')) return;
    services[index][field] = event.detail.value;
    this.setData({ 'form.services': services });
    this.markDirty();
  },

  onAnnouncementToggle(event) {
    const form = this.data.form;
    form.announcement.enabled = event.detail.value === true;
    this.setData({ 'form.announcement': form.announcement });
    this.markDirty();
  },

  onAnnouncementInput(event) {
    const field = event.currentTarget.dataset.field;
    if (field !== 'title' && field !== 'text') return;
    const announcement = this.data.form.announcement;
    announcement[field] = event.detail.value;
    this.setData({ 'form.announcement': announcement });
    this.markDirty();
  },

  // 维护模式开启/关闭都是治理动作：都需二次确认（§7.5）
  onMaintenanceToggle(event) {
    const next = event.detail.value === true;
    feedback.confirm({
      title: next ? '开启维护模式' : '关闭维护模式',
      content: vm.maintenanceConfirmContent(next),
      confirmText: next ? '确认开启' : '确认关闭',
      danger: next
    }).then((res) => {
      this.setMaintenance(res.confirm === true ? next : !next);
    });
  },

  setMaintenance(enabled) {
    const maintenance = this.data.form.maintenance;
    maintenance.enabled = enabled;
    this.setData({ 'form.maintenance': maintenance });
    this.markDirty();
  },

  onMaintenanceInput(event) {
    const maintenance = this.data.form.maintenance;
    maintenance.text = event.detail.value;
    this.setData({ 'form.maintenance': maintenance });
    this.markDirty();
  },

  onNumberInput(event) {
    const field = event.currentTarget.dataset.field;
    if (!field) return;
    this.setData({ ['form.' + field]: event.detail.value });
    this.markDirty();
  },

  onRetry() {
    this.loadConfig().catch(function () {});
  },

  onSave() {
    if (this.data.saving) return;
    const payload = vm.buildPayload(this.data.form);
    const invalid = vm.validatePayload(payload);
    if (invalid) {
      feedback.toast(invalid);
      return;
    }
    const changes = vm.collectChanges(this.original || {}, payload);
    if (changes.length === 0) {
      feedback.toast('配置没有变化。');
      return;
    }
    feedback.confirm({
      title: '保存配置',
      content: '本次将修改：' + changes.join('、') + '。保存后对顾客/兼职端下一次请求生效。确定保存？',
      confirmText: '确认保存'
    }).then((res) => {
      if (res.confirm) this.submit(payload);
    });
  },

  submit(payload) {
    this.setData({ saving: true });
    admin.updateConfig({ config: vm.buildApiPayload(payload, C.CONFIG_TTL_KEY) }).then(() => {
      this.setData({ saving: false, dirty: false });
      this.original = payload;
      this.disableLeaveAlert();
      feedback.toast('配置已保存。');
      this.loadConfig().catch(function () {});
    }).catch((err) => {
      this.setData({ saving: false });
      feedback.toast(err && err.message);
    });
  }
});
