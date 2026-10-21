// pkg-customer/pages/bind/index.js · 绑定兼职（顾客唯一绑定入口）
// 绑定前预览只回昵称+编号+服务/范围/接单状态；头像在绑定成功后（bind.getCurrent）下发。
'use strict';

const store = require('../../../store/index');
const bindApi = require('../../../api/modules/bind');
const partnerApi = require('../../../api/modules/partner');
const ids = require('../../../utils/ids');

const HOME_PAGE = '/pages/customer/home/index';
const PROFILE_PAGE = '/pages/profile/index';

function serviceNames(services, catalog) {
  return (services || [])
    .filter(function on(item) { return item.enabled !== false; })
    .map(function map(item) {
      const found = (catalog || []).filter(function match(entry) { return entry.code === item.code; })[0];
      return found ? found.name : item.code;
    });
}

Page({
  data: {
    mode: 'create',
    input: '',
    canonical: '',
    hint: '',
    error: '',
    preview: null,
    servicesText: '',
    zonesText: '',
    currentBinding: null,
    roomTag: '',
    loading: false,
    submitting: false,
    readonly: false,
    boundName: ''
  },

  onLoad(options) {
    const opts = options || {};
    const prefill = String(opts.bind || '');
    const mode = opts.mode === 'rebind' ? 'rebind' : 'create';
    const snapshot = store.snapshot();
    const readonly = !!(snapshot.viewContext && snapshot.viewContext.viewMode === 'READONLY');
    this.setData({ mode: mode, readonly: readonly });
    if (prefill) this.handleInput(prefill);
    if (mode === 'rebind') this.loadCurrent();
  },

  loadCurrent() {
    bindApi.getCurrent().then((data) => {
      const binding = (data && data.binding) || null;
      this.setData({
        currentBinding: binding,
        roomTag: binding ? binding.roomTag : ''
      });
    }).catch(function ignore() {
      this.setData({ currentBinding: null });
    }.bind(this));
  },

  handleInput(raw) {
    const idsApi = ids || {};
    const normalize = typeof idsApi.normalizeInput === 'function' ? idsApi.normalizeInput : String;
    const parse = typeof idsApi.parseNo === 'function' ? idsApi.parseNo : null;
    const normalized = normalize(raw);
    const parsed = parse ? parse(normalized) : { ok: false };
    let hint = '';
    if (normalized && !parsed.ok && typeof idsApi.prefixHint === 'function') {
      hint = idsApi.prefixHint(normalized) || '';
    }
    this.setData({
      input: String(raw || ''),
      canonical: parsed && parsed.ok ? (parsed.canonical || normalized) : '',
      hint: hint,
      error: ''
    });
    if (parsed && parsed.ok && this.data.preview && this.data.preview.partnerNo !== parsed.canonical) {
      this.setData({ preview: null });
    }
  },

  onInput(e) {
    this.handleInput((e.detail && e.detail.value) || '');
  },

  onPaste() {
    if (this.data.readonly) {
      wx.showToast({ title: '开发者只读视角不能操作', icon: 'none' });
      return;
    }
    wx.getClipboardData({
      success: (res) => {
        this.handleInput((res && res.data) || '');
        wx.showToast({ title: '已粘贴', icon: 'none' });
      },
      fail: () => wx.showToast({ title: '读取剪贴板失败，请手动输入', icon: 'none' })
    });
  },

  onQuery() {
    const partnerNo = this.data.canonical;
    if (!partnerNo) {
      this.setData({ error: this.data.hint || '请输入兼职编号后再查询' });
      return;
    }
    this.setData({ loading: true, error: '' });
    partnerApi.getPublic({ partnerNo: partnerNo }).then((data) => {
      const partner = (data && data.partnerPublic) || data || {};
      const catalog = (store.get('config') && store.get('config').serviceCatalog) || [];
      const names = serviceNames(partner.services, catalog);
      this.setData({
        loading: false,
        preview: {
          partnerNo: partner.partnerNo || partnerNo,
          displayName: partner.displayName || '',
          status: partner.status || '',
          acceptingOrders: partner.acceptingOrders !== false
        },
        servicesText: names.length > 0 ? names.join(' / ') : '服务类型加载中',
        zonesText: (partner.zones || []).join(' / ') || '全部苑'
      });
    }).catch((err) => {
      this.setData({ loading: false, preview: null, error: (err && err.message) || '查询失败，请稍后重试' });
    });
  },

  onConfirm() {
    if (this.data.readonly) {
      wx.showToast({ title: '开发者只读视角不能操作', icon: 'none' });
      return;
    }
    if (!this.data.canonical || this.data.submitting) return;
    this.setData({ submitting: true, error: '' });
    bindApi.create({ partnerNo: this.data.canonical }).then((data) => {
      const binding = (data && data.binding) || {};
      const partnerPublic = (data && data.partnerPublic) || this.data.preview || {};
      this.setData({
        submitting: false,
        roomTag: binding.roomTag || '',
        boundName: partnerPublic.displayName || ''
      });
      store.patch({
        binding: Object.assign({}, binding, { partnerPublic: partnerPublic })
      });
      wx.showToast({ title: '已绑定', icon: 'success' });
      setTimeout(function goHome() {
        wx.switchTab({ url: HOME_PAGE });
      }, 800);
    }).catch((err) => {
      this.setData({ submitting: false, error: (err && err.message) || '绑定失败，请稍后重试' });
    });
  },

  onOpenProfile() {
    wx.switchTab({ url: PROFILE_PAGE });
  },

  onRetry() {
    this.onQuery();
  }
});
