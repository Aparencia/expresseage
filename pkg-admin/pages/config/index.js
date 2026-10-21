// pkg-admin/pages/config/index.js · 全局配置（白名单字段可编辑；智能识别兜底只读展示）
const admin = require('../../../api/modules/admin');
const C = require('../../common/constants');
const F = require('../../common/format');
const feedback = require('../../common/feedback');

const FIELD_LABELS = {
  zoneLabels: '苑名',
  serviceCatalog: '服务类型模板',
  announcement: '公告',
  maintenance: '维护模式',
  orderTimeoutMinutes: '接单超时',
  autoCompleteHours: '自动完成时长',
  screenshotRetentionDays: '截图留存天数',
  viewTicketTtlMinutes: '切换会话时长',
  avatarMaxBytes: '头像大小上限'
};

function toInt(value) {
  const parsed = Number(value);
  return isNaN(parsed) ? NaN : Math.floor(parsed);
}

function emptyForm() {
  return {
    zones: [],
    services: [],
    announcement: { enabled: false, title: '', text: '' },
    maintenance: { enabled: false, text: '' },
    orderTimeoutMinutes: '120',
    autoCompleteHours: '24',
    screenshotRetentionDays: '7',
    viewTicketTtlMinutes: '30',
    avatarMaxKb: '200'
  };
}

Page({
  data: {
    loading: true,
    error: '',
    errorAt: '',
    forbidden: false,
    saving: false,
    dirty: false,
    form: emptyForm(),
    readonlyInfo: {
      aiFallbackText: '—',
      recognitionFailureRetentionDays: '—',
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
      const form = this.buildForm(config);
      this.original = this.buildPayload(form);
      this.setData({
        form: form,
        readonlyInfo: this.buildReadonly(config),
        loading: false,
        dirty: false
      });
      this.disableLeaveAlert();
    }).catch((err) => {
      feedback.handleError(this, err);
      throw err;
    });
  },

  buildReadonly(config) {
    const fallback = config.aiFallback || {};
    return {
      aiFallbackText: fallback.enabled === false ? '已关闭（只读展示，不可在此修改）' : '已开启（只读展示，不可在此修改）',
      recognitionFailureRetentionDays: F.textOrDash(config.recognitionFailureRetentionDays),
      testAccountMaxPerRole: F.textOrDash(config.testAccountMaxPerRole),
      testDataRetentionDays: F.textOrDash(config.testDataRetentionDays)
    };
  },

  buildForm(config) {
    const form = emptyForm();
    const zoneLabels = config.zoneLabels || {};
    form.zones = C.ZONE_KEYS.map(function (key) {
      return {
        key: key,
        placeHolder: C.ZONE_LABELS[key],
        value: zoneLabels[key] || ''
      };
    });
    form.services = (config.serviceCatalog || []).map(function (item) {
      return {
        code: item.code,
        name: item.name || '',
        desc: item.desc || '',
        enabled: item.enabled !== false
      };
    });
    const announcement = config.announcement || {};
    form.announcement = {
      enabled: announcement.enabled === true,
      title: announcement.title || '',
      text: announcement.text || ''
    };
    const maintenance = config.maintenance || {};
    form.maintenance = {
      enabled: maintenance.enabled === true,
      text: maintenance.text || ''
    };
    form.orderTimeoutMinutes = String(F.numOrZero(config.orderTimeoutMinutes) || 120);
    form.autoCompleteHours = String(F.numOrZero(config.autoCompleteHours) || 24);
    form.screenshotRetentionDays = String(F.numOrZero(config.screenshotRetentionDays) || 7);
    form.viewTicketTtlMinutes = String(F.numOrZero(config.viewTicketTtlMinutes) || C.DEFAULT_TTL_MINUTES);
    const avatarBytes = F.numOrZero(config.avatarMaxBytes) || C.CONFIG_RANGE.avatarKbMax * 1024;
    form.avatarMaxKb = String(Math.round(avatarBytes / 1024));
    return form;
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

  onServiceToggle(event) {
    const index = Number(event.currentTarget.dataset.index);
    const services = this.data.form.services.slice();
    if (!services[index]) return;
    services[index].enabled = event.detail.value === true;
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

  onMaintenanceToggle(event) {
    const next = event.detail.value === true;
    if (!next) {
      this.setMaintenance(false);
      return;
    }
    feedback.confirm({
      title: '开启维护模式',
      content: '开启维护模式后，顾客/兼职端将看到维护公告，写操作被拒绝；后台不受影响。确定开启？',
      confirmText: '确认开启',
      danger: true
    }).then((res) => {
      this.setMaintenance(res.confirm === true);
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

  buildPayload(form) {
    return {
      zoneLabels: form.zones.reduce(function (acc, item) {
        acc[item.key] = String(item.value || '').trim();
        return acc;
      }, {}),
      serviceCatalog: form.services.map(function (item) {
        return { code: item.code, name: String(item.name || '').trim(), desc: String(item.desc || '').trim(), enabled: item.enabled };
      }),
      announcement: {
        enabled: form.announcement.enabled,
        title: String(form.announcement.title || '').trim(),
        text: String(form.announcement.text || '').trim()
      },
      maintenance: {
        enabled: form.maintenance.enabled,
        text: String(form.maintenance.text || '').trim()
      },
      orderTimeoutMinutes: toInt(form.orderTimeoutMinutes),
      autoCompleteHours: toInt(form.autoCompleteHours),
      screenshotRetentionDays: toInt(form.screenshotRetentionDays),
      viewTicketTtlMinutes: toInt(form.viewTicketTtlMinutes),
      avatarMaxBytes: toInt(form.avatarMaxKb) * 1024
    };
  },

  collectChanges(payload) {
    const before = this.original || {};
    return Object.keys(FIELD_LABELS).filter(function (key) {
      return JSON.stringify(before[key]) !== JSON.stringify(payload[key]);
    }).map(function (key) {
      return FIELD_LABELS[key];
    });
  },

  validatePayload(payload) {
    const range = C.CONFIG_RANGE;
    if (!(payload.orderTimeoutMinutes >= range.orderTimeoutMin && payload.orderTimeoutMinutes <= range.orderTimeoutMax)) {
      return '接单超时请填 ' + range.orderTimeoutMin + '~' + range.orderTimeoutMax + ' 分钟。';
    }
    if (!(payload.autoCompleteHours >= range.autoCompleteMin && payload.autoCompleteHours <= range.autoCompleteMax)) {
      return '自动完成时长请填 ' + range.autoCompleteMin + '~' + range.autoCompleteMax + ' 小时。';
    }
    if (!(payload.screenshotRetentionDays > 0 && payload.screenshotRetentionDays <= range.screenshotMax)) {
      return '截图留存天数不能超过 ' + range.screenshotMax + ' 天。';
    }
    if (!(payload.viewTicketTtlMinutes >= range.ttlMin && payload.viewTicketTtlMinutes <= range.ttlMax)) {
      return '切换会话时长请填 ' + range.ttlMin + '~' + range.ttlMax + ' 分钟。';
    }
    if (!(payload.avatarMaxBytes >= range.avatarKbMin * 1024 && payload.avatarMaxBytes <= range.avatarKbMax * 1024)) {
      return '头像大小上限请填 ' + range.avatarKbMin + '~' + range.avatarKbMax + 'KB。';
    }
    if (payload.announcement.title.length > C.LIMITS.announcementTitleMax) {
      return '公告标题最多 ' + C.LIMITS.announcementTitleMax + ' 字。';
    }
    if (payload.announcement.text.length > C.LIMITS.announcementTextMax) {
      return '公告正文最多 ' + C.LIMITS.announcementTextMax + ' 字。';
    }
    if (payload.maintenance.text.length > C.LIMITS.maintenanceTextMax) {
      return '维护说明最多 ' + C.LIMITS.maintenanceTextMax + ' 字。';
    }
    if (payload.zoneLabels && Object.keys(payload.zoneLabels).some(function (key) { return !payload.zoneLabels[key]; })) {
      return '五个苑名都不能为空。';
    }
    return '';
  },

  onSave() {
    if (this.data.saving) return;
    const payload = this.buildPayload(this.data.form);
    const invalid = this.validatePayload(payload);
    if (invalid) {
      feedback.toast(invalid);
      return;
    }
    const changes = this.collectChanges(payload);
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
    admin.updateConfig({ config: payload }).then(() => {
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
