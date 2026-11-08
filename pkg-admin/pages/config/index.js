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
    limits: C.LIMITS,
    stationLimits: vm.stationInputLimits(),
    // 站点编辑浮层（点行打开；只改草稿，点「确定」才回写 form.stations）
    sheet: vm.emptySheet()
  },

  onLoad() {
    this.original = null;
    this.loadConfig();
  },

  onUnload() {
    this.disableLeaveAlert();
  },

  onPullDownRefresh() {
    return feedback.refresh(this, 'loadConfig');
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

  // 站点行点击 → 底部浮层编辑（列表只留名称/别名格式计数/排序按钮，避免 8 行×3 输入把页面拉长）
  onStationOpen(event) {
    const index = Number(event.currentTarget.dataset.index);
    const row = (this.data.form.stations || [])[index];
    if (!row) return;
    this._sheetBase = { name: row.name, aliasesText: row.aliasesText, codePatternsText: row.codePatternsText };
    this.setData({ sheet: vm.stationDraftOf(row, index, this.data.form.stations.length) });
  },

  // v1.1（D32）站点正式名：浮层打开时改草稿；关闭态（旧入口/防御）仍直接改表单行
  onStationInput(event) {
    if (this.data.sheet.open) {
      this.setData({ 'sheet.name': event.detail.value, 'sheet.error': '' });
      return;
    }
    const index = Number(event.currentTarget.dataset.index);
    const stations = this.data.form.stations.slice();
    if (!stations[index]) return;
    stations[index].name = event.detail.value;
    this.setData({ 'form.stations': stations });
    this.markDirty();
  },

  // D71 站点别名（仅识别归一用；拆项/校验在 parts 纯件，页面只转发）
  onStationAliasInput(event) {
    if (this.data.sheet.open) {
      const text = event.detail.value;
      this.setData({ 'sheet.aliasesText': text, 'sheet.aliasCount': vm.stationTextCount(text), 'sheet.error': '' });
      return;
    }
    const index = Number(event.currentTarget.dataset.index);
    const stations = this.data.form.stations.slice();
    if (!stations[index]) return;
    stations[index].aliasesText = event.detail.value;
    stations[index].aliasCount = vm.stationTextCount(event.detail.value);
    this.setData({ 'form.stations': stations });
    this.markDirty();
  },

  // D70 站点取件码格式（`*`=任意字母数字，整串匹配；拆项/校验在 parts 纯件）
  onStationPatternInput(event) {
    if (this.data.sheet.open) {
      const text = event.detail.value;
      this.setData({ 'sheet.codePatternsText': text, 'sheet.patternCount': vm.stationTextCount(text), 'sheet.error': '' });
      return;
    }
    const index = Number(event.currentTarget.dataset.index);
    const stations = this.data.form.stations.slice();
    if (!stations[index]) return;
    stations[index].codePatternsText = event.detail.value;
    stations[index].patternCount = vm.stationTextCount(event.detail.value);
    this.setData({ 'form.stations': stations });
    this.markDirty();
  },

  // 浮层：遮罩/取消（有改动先二次确认放弃）；内容区点击不穿透
  onSheetNoop() {},

  onSheetClose() {
    const sheet = this.data.sheet;
    if (!sheet.open) return;
    const base = this._sheetBase || {};
    const changed = sheet.name !== base.name
      || sheet.aliasesText !== base.aliasesText
      || sheet.codePatternsText !== base.codePatternsText;
    if (!changed) {
      this.closeSheet();
      return;
    }
    feedback.confirm({
      title: '放弃修改',
      content: '本次对 ' + sheet.title + ' 的修改尚未确定，确定放弃？',
      confirmText: '放弃',
      danger: true
    }).then((res) => {
      if (res.confirm) this.closeSheet();
    });
  },

  closeSheet() {
    this._sheetBase = null;
    this.setData({ sheet: vm.emptySheet() });
  },

  // 浮层确定：单站即时校验 → 回写该行（页面「保存配置」仍负责整表严格校验与落库）
  onSheetConfirm() {
    const sheet = this.data.sheet;
    if (!sheet.open) return;
    const stations = this.data.form.stations.slice();
    const index = Number(sheet.index);
    if (!stations[index]) {
      this.closeSheet();
      return;
    }
    const error = vm.validateStationDraft(sheet, stations, index);
    if (error) {
      this.setData({ 'sheet.error': error });
      return;
    }
    stations[index] = vm.applyStationDraft(stations[index], sheet);
    this.setData({ 'form.stations': stations });
    this.closeSheet();
    this.markDirty();
  },

  // D71 站点顺序（数组顺序 = 展示顺序；越界由纯件兜底不移动）
  onStationMove(event) {
    const index = Number(event.currentTarget.dataset.index);
    const dir = Number(event.currentTarget.dataset.dir);
    this.setData({ 'form.stations': vm.moveStation(this.data.form.stations, index, dir) });
    this.markDirty();
  },

  // D70 站点双判据开关：dataset.field = fromImage（截图识别）/ fromCode（取件码反推）
  onStationInferToggle(event) {
    const field = event.currentTarget.dataset.field;
    if (field !== 'fromImage' && field !== 'fromCode') return;
    const stationInfer = this.data.form.stationInfer || vm.emptyForm().stationInfer;
    stationInfer[field] = event.detail.value === true;
    this.setData({ 'form.stationInfer': stationInfer });
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
