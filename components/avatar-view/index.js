// components/avatar-view/index.js · 头像（圆形 + 默认头像首字色块兜底，不裂图）
const DEFAULT_SIZE = 64;

Component({
  properties: {
    fileId: { type: String, value: '' },
    name: { type: String, value: '' },
    size: { type: Number, value: DEFAULT_SIZE }
  },

  data: {
    failed: false,
    initial: ''
  },

  observers: {
    fileId(fileId) {
      if (fileId && this.data.failed) {
        this.setData({ failed: false });
      }
    },
    name(name) {
      this.updateInitial(name);
    }
  },

  lifetimes: {
    attached() {
      this.updateInitial(this.data.name);
    }
  },

  methods: {
    updateInitial(name) {
      const value = (name || '').trim();
      this.setData({ initial: value ? value.charAt(0) : '代' });
    },
    onError() {
      this.setData({ failed: true });
    }
  }
});
