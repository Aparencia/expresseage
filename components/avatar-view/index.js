// components/avatar-view/index.js · 头像（圆形 + 默认头像首字色块兜底，不裂图）
// 口径：CONTRACT §4.2/§8/O5 + D42（头像展示统一走服务端临时 URL，src 优先；fileId 仅回退键）。
// 默认头像视图模型统一走 utils/avatar.js 纯件（匿名/emoji 安全的首字 + 稳定色块）；
// 无 src/fileId 或图片加载失败一律显示默认头像，不出现裂图/空白。
// 失败不永久锁死：src 变化（父页面重签 URL）自动重试；用户点默认头像位触发 retry 事件（父页面可重签）。
const avatarUtil = require('../../utils/avatar');

const DEFAULT_SIZE = 64;
const UNNAMED_INITIAL = '代';

function viewOf(source, name, failed) {
  const displayName = typeof name === 'string' && name.trim() ? name : UNNAMED_INITIAL;
  if (failed) {
    return avatarUtil.viewModelOf({ src: '', fileId: '' }, displayName);
  }
  return avatarUtil.viewModelOf(source, displayName);
}

Component({
  properties: {
    src: { type: String, value: '' },
    fileId: { type: String, value: '' },
    name: { type: String, value: '' },
    size: { type: Number, value: DEFAULT_SIZE }
  },

  data: {
    failed: false,
    view: viewOf({ src: '', fileId: '' }, '', false)
  },

  observers: {
    // src/fileId 变了就重新尝试加载：只有「同一来源失败过」才保留兜底，换 URL 自动解除失败态（不永久锁死）
    'src, fileId, name'(src, fileId, name) {
      const sourceKey = (src || fileId || '').trim();
      const failed = !!this._failedKey && this._failedKey === sourceKey;
      this.setData({ failed: failed, view: viewOf({ src: src, fileId: fileId }, name, failed) });
    }
  },

  lifetimes: {
    // 初始属性可能早于首次渲染就位：attached 再算一次，保证首帧就是正确的头像/默认头像
    attached() {
      const src = this.data.src || '';
      const fileId = this.data.fileId || '';
      const sourceKey = (src || fileId || '').trim();
      const failed = !!this._failedKey && this._failedKey === sourceKey;
      this.setData({ failed: failed, view: viewOf({ src: src, fileId: fileId }, this.data.name || '', failed) });
    }
  },

  methods: {
    sourceKey() {
      return String(this.data.src || this.data.fileId || '').trim();
    },

    onError() {
      this._failedKey = this.sourceKey();
      this.setData({ failed: true, view: viewOf({ src: '', fileId: '' }, this.data.name, true) });
    },

    // 点默认头像位重试：清失败态当场重试当前来源，并通知父页面重签 URL（父页面可把新 src 传进来）
    onRetryTap() {
      this._failedKey = '';
      this.setData({ failed: false, view: viewOf(this.data, this.data.name, false) });
      this.triggerEvent('retry', { src: this.data.src || '', fileId: this.data.fileId || '' });
    }
  }
});
