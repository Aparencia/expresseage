// components/switch-bar/index.js · 切换会话条（READONLY 黄条 / TEST_WRITE 蓝条 + TEST 角标）
const store = require('../../store/index');
const ids = require('../../utils/ids');
const session = require('../../utils/session');

const ROLE_LABEL = { CUSTOMER: '顾客', PARTNER: '兼职' };
const TICK_DEFAULT_MINUTES = 30;

function remainingText(expiresAt) {
  if (!expiresAt) {
    return '';
  }
  const left = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  if (left <= 0) {
    return '已过期';
  }
  const minutes = Math.floor(left / 60);
  const seconds = left % 60;
  return minutes + ':' + (seconds < 10 ? '0' + seconds : String(seconds));
}

Component({
  data: {
    visible: false,
    readonly: false,
    blue: false,
    roleLabel: '',
    targetNoDisplay: '',
    targetDisplayName: '',
    developerText: '',
    remaining: '',
    expiring: false
  },

  lifetimes: {
    attached() {
      this.refresh();
      this.unsubscribe = store.subscribe(() => this.refresh());
      this.timer = setInterval(() => this.tick(), 1000);
    },
    detached() {
      if (this.unsubscribe) {
        this.unsubscribe();
        this.unsubscribe = null;
      }
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    }
  },

  methods: {
    refresh() {
      const view = store.getViewContext();
      if (!view || !view.viewMode) {
        this.setData({ visible: false });
        return;
      }
      const readonly = view.viewMode === 'READONLY';
      const role = view.role === 'PARTNER' ? 'PARTNER' : 'CUSTOMER';
      this.setData({
        visible: true,
        readonly,
        blue: !readonly,
        roleLabel: ROLE_LABEL[role],
        targetNoDisplay: view.targetNo ? ids.displayNo(role, view.targetNo) : '',
        targetDisplayName: view.targetDisplayName || '',
        developerText: view.developerNo ? '由 ' + view.developerNo + ' 切换' : '由开发者切换',
        expiring: false
      });
      this.tick();
    },

    tick() {
      const view = store.getViewContext();
      if (!view || !view.viewMode) {
        return;
      }
      const expiresAt = view.expiresAt || 0;
      const remaining = remainingText(expiresAt);
      const leftMs = expiresAt ? expiresAt - Date.now() : TICK_DEFAULT_MINUTES * 60 * 1000;
      const expiring = leftMs > 0 && leftMs <= 5 * 60 * 1000;
      if (remaining !== this.data.remaining || expiring !== this.data.expiring) {
        this.setData({ remaining, expiring });
      }
    },

    onExit() {
      session.exitViewContext();
    }
  }
});
