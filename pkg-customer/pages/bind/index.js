// pkg-customer/pages/bind/index.js · 绑定/换绑兼职（顾客唯一绑定入口；D28 换绑一体化）
// 绑定前预览只回昵称+编号+服务/范围/接单状态；头像在绑定成功后（bind.getCurrent）下发。
// 换绑（mode=rebind）一次确认内由 utils/rebind 纯件编排 release→create（服务端接口不变）：
// 本页只做取参/弹窗/调 api/setData，计划、编排、失败恢复文案与重试动作全在纯件（页面层零判据）。
'use strict';

const store = require('../../../store/index');
const bindApi = require('../../../api/modules/bind');
const partnerApi = require('../../../api/modules/partner');
const ids = require('../../../utils/ids');
const rebind = require('../../../utils/rebind');

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
    mode: rebind.MODE.CREATE,
    labels: rebind.labelsOf(null),
    input: '',
    canonical: '',
    hint: '',
    error: '',
    preview: null,
    servicesText: '',
    zonesText: '',
    currentBinding: null,
    currentPartnerName: '',
    roomTag: '',
    loading: false,
    submitting: false,
    readonly: false,
    boundName: '',
    successText: '',
    retryVisible: false,
    retryLabel: '',
    retryTitle: '',
    retryHint: ''
  },

  onLoad(options) {
    const opts = options || {};
    const prefill = String(opts.bind || '');
    const mode = rebind.modeOf(opts);
    const snapshot = store.snapshot();
    const readonly = !!(snapshot.viewContext && snapshot.viewContext.viewMode === 'READONLY');
    this.setData({ mode: mode, readonly: readonly, labels: rebind.labelsOf({ mode: mode }) });
    if (mode === rebind.MODE.REBIND) wx.setNavigationBarTitle({ title: '换绑兼职' });
    if (prefill) this.handleInput(prefill);
    if (mode === rebind.MODE.REBIND) this.loadCurrent();
  },

  loadCurrent() {
    bindApi.getCurrent().then((data) => {
      const binding = (data && data.binding) || null;
      const partnerPublic = (data && data.partnerPublic) || null;
      // 当前绑定的 roomTag 只经 currentBinding 展示；roomTag 字段专用于「绑定/换绑成功」卡片
      this.setData({
        currentBinding: binding,
        currentPartnerName: (partnerPublic && partnerPublic.displayName) || '',
        roomTag: ''
      });
    }).catch(function ignore() {
      this.setData({ currentBinding: null });
    }.bind(this));
  },

  handleInput(raw) {
    const normalized = ids.normalizeInput(raw);
    const parsed = ids.parseNo(normalized);
    let hint = '';
    if (normalized && !parsed.ok) {
      // utils/ids.prefixHint 返回 { reason, message }：页面只显示同源 message（与云端 VALIDATION_FAILED.message 同一句）
      hint = ids.prefixHint(normalized).message || '';
    }
    this.setData({
      input: String(raw || ''),
      canonical: parsed.ok ? (parsed.canonical || normalized) : '',
      hint: hint,
      error: '',
      retryVisible: false
    });
    if (parsed.ok && this.data.preview && this.data.preview.partnerNo !== parsed.canonical) {
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
      // partner.getPublic 直接返回 partnerPublic：{partnerNo,displayName,services,zones,acceptingOrders,status}
      // 绑定前只回昵称，不下发 avatarFileId（CONTRACT v0.9 §5.3）
      const partner = data || {};
      const config = store.snapshot().config || {};
      const catalog = config.serviceCatalog || [];
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
    const plan = rebind.planRebind({
      mode: this.data.mode,
      hasCurrentBinding: !!this.data.currentBinding
    });
    if (!rebind.confirmNeeded(plan)) {
      this.submit({});
      return;
    }
    // 换绑一次确认：release→create 两步都在确认后由纯件顺序执行（AC-C-68）
    wx.showModal({
      title: this.data.labels.confirm,
      content: rebind.confirmContent(),
      success: (res) => {
        if (res.confirm) this.submit({});
      }
    });
  },

  // 单次编排入口：换绑=release→create，普通绑定=create；extra 由纯件 retryDeps 给出（只补 create 时 released:true）
  submit(extra) {
    this.setData({ submitting: true, error: '', retryVisible: false });
    return rebind.runRebind(Object.assign({
      mode: this.data.mode,
      hasCurrentBinding: !!this.data.currentBinding,
      partnerNo: this.data.canonical,
      release: function release(payload) { return bindApi.release(payload); },
      create: function create(payload) { return bindApi.create(payload); }
    }, extra || {})).then((result) => {
      this._result = result;
      return this.applyResult(result);
    }).catch((err) => {
      this.setData({ submitting: false, error: (err && err.message) || '操作失败，请稍后重试' });
    });
  },

  applyResult(result) {
    if (result.status !== rebind.STATUS.REBOUND && result.status !== rebind.STATUS.BOUND) {
      const failView = rebind.failureView(result);
      this.setData({
        submitting: false,
        error: failView.text,
        retryVisible: failView.retryVisible,
        retryLabel: failView.retryLabel,
        retryTitle: failView.retryTitle,
        retryHint: failView.retryHint,
        // 失败不得露出「成功」态残留：roomTag 清空、旧绑定按 release 结果停「未绑定」
        roomTag: '',
        successText: '',
        boundName: '',
        currentBinding: result.released ? null : this.data.currentBinding
      });
      return result;
    }
    const binding = result.binding || {};
    const partnerPublic = result.partnerPublic || this.data.preview || {};
    const displayName = partnerPublic.displayName || '';
    this.setData({
      submitting: false,
      error: '',
      retryVisible: false,
      roomTag: binding.roomTag || '',
      boundName: displayName,
      successText: rebind.resultText(result, displayName)
    });
    store.patch({ binding: Object.assign({}, binding, { partnerPublic: partnerPublic }) });
    wx.showToast({ title: rebind.successToast(result, displayName), icon: 'success' });
    setTimeout(function goHome() {
      wx.switchTab({ url: HOME_PAGE });
    }, 800);
    return result;
  },

  // 单步恢复：release 成功 create 失败后只补 create（纯件 retryDeps 决定，不二次 release）
  onRetryBind() {
    if (this.data.readonly) {
      wx.showToast({ title: '开发者只读视角不能操作', icon: 'none' });
      return;
    }
    if (this.data.submitting) return;
    const deps = rebind.retryDeps(this._result);
    if (!deps) return;
    this.submit(deps);
  },

  onOpenProfile() {
    wx.switchTab({ url: PROFILE_PAGE });
  },

  onRetry() {
    this.onQuery();
  }
});
