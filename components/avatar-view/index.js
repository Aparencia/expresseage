// components/avatar-view/index.js · 头像（圆形 + 默认头像首字色块兜底，不裂图）
// 默认头像视图模型统一走 utils/avatar.js 纯件（匿名/emoji 安全的首字 + 稳定色块），
// 无 fileId 或图片加载失败一律显示默认头像，不出现裂图/空白（CONTRACT §4.2/§8/O5）。
const avatarUtil = require('../../utils/avatar');

const DEFAULT_SIZE = 64;
const UNNAMED_INITIAL = '代';

function buildView(fileId, name, failed) {
  const displayName = typeof name === 'string' && name.trim() ? name : UNNAMED_INITIAL;
  return avatarUtil.viewModelOf(failed ? '' : fileId, displayName);
}

Component({
  properties: {
    fileId: { type: String, value: '' },
    name: { type: String, value: '' },
    size: { type: Number, value: DEFAULT_SIZE }
  },

  data: {
    failed: false,
    view: buildView('', '', false)
  },

  observers: {
    // fileId 换了就重新尝试加载；仅昵称变（头像没变）时保留失败兜底，不反复请求坏地址
    'fileId, name'(fileId, name) {
      const failed = !!this._failedFileId && this._failedFileId === fileId;
      this.setData({ failed: failed, view: buildView(fileId, name, failed) });
    }
  },

  lifetimes: {
    // 初始属性可能早于首次渲染就位：attached 再算一次，保证首帧就是正确的头像/默认头像
    attached() {
      const fileId = this.data.fileId || '';
      const failed = !!this._failedFileId && this._failedFileId === fileId;
      this.setData({ failed: failed, view: buildView(fileId, this.data.name || '', failed) });
    }
  },

  methods: {
    onError() {
      this._failedFileId = this.data.fileId || '';
      this.setData({ failed: true, view: buildView('', this.data.name, true) });
    }
  }
});
