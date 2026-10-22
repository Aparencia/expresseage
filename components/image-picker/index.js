// components/image-picker/index.js · 截图/头像选择与上传（相册/拍照/聊天；唯一上传路径经 api/upload）
// v1.0（D23）：支持一次多选/分多次添加的 0~maxCount 张；去重、删除、超限明确文案；半途失败不丢已上传文件。
// change 事件：{files}（追加/删除后全量快照）；error：{reason,message,files}（失败时仍带已成功文件）；
// limit：{maxCount,message}（已达上限仍尝试添加）。页面只消费事件，不直接改组件内部状态。
const uploadApi = require('../../api/upload');
const privacy = require('../../api/privacy');

const DEFAULT_MAX = 5;
const LIMIT_MESSAGE = '最多只能添加 %d 张截图，可以先删除一张再添加';

function message(code, maxCount) {
  const raw = String(code || '');
  if (raw.indexOf('%d') >= 0) {
    return raw.split('%d').join(String(maxCount));
  }
  return raw;
}

Component({
  properties: {
    maxCount: { type: Number, value: 1 },
    purpose: { type: String, value: 'TICKET' },
    // 只读/禁用（开发者只读视角、提交中）：按钮置灰且不再选图
    disabled: { type: Boolean, value: false }
  },

  data: {
    files: [],
    uploading: false,
    progressText: '',
    maxReached: false
  },

  observers: {
    maxCount() {
      this.syncFlags();
    }
  },

  lifetimes: {
    attached() {
      this.syncFlags();
    }
  },

  methods: {
    maxCountOf() {
      const max = Number(this.data.maxCount);
      return max > 0 ? Math.floor(max) : DEFAULT_MAX;
    },

    remaining() {
      return Math.max(0, this.maxCountOf() - this.data.files.length);
    },

    syncFlags() {
      this.setData({ maxReached: this.remaining() <= 0 });
    },

    limitText() {
      return message(LIMIT_MESSAGE, this.maxCountOf());
    },

    rejectLimit() {
      const text = this.limitText();
      wx.showToast({ title: text, icon: 'none' });
      this.triggerEvent('limit', { maxCount: this.maxCountOf(), message: text });
    },

    canPick() {
      if (this.data.disabled || this.data.uploading) {
        return false;
      }
      if (this.remaining() <= 0) {
        this.rejectLimit();
        return false;
      }
      return true;
    },

    async onChooseAlbum() {
      if (!this.canPick()) {
        return;
      }
      const allowed = await privacy.ensureAlbumAuth();
      if (!allowed) {
        this.triggerEvent('error', {
          reason: 'PRIVACY_DENIED',
          message: '需要相册权限才能选择图片，也可用拍照或从聊天选择',
          files: this.data.files
        });
        return;
      }
      this.chooseMedia(['album']);
    },

    onChooseCamera() {
      if (!this.canPick()) {
        return;
      }
      this.chooseMedia(['camera']);
    },

    onChooseChat() {
      if (!this.canPick()) {
        return;
      }
      wx.chooseMessageFile({
        count: this.remaining(),
        type: 'image',
        success: (res) => {
          const paths = (res.tempFiles || []).map((item) => item.path);
          this.uploadAll(paths);
        }
      });
    },

    chooseMedia(sourceType) {
      wx.chooseMedia({
        count: this.remaining(),
        mediaType: ['image'],
        sourceType,
        success: (res) => {
          const paths = (res.tempFiles || []).map((item) => item.tempFilePath);
          this.uploadAll(paths);
        }
      });
    },

    // 去重：同一临时路径重复选择只留一次（相册/聊天来源可能返回相同 path）
    dedupe(paths) {
      const seen = {};
      this.data.files.forEach((file) => {
        const key = String((file && file.localPath) || '');
        if (key) {
          seen[key] = true;
        }
      });
      const out = [];
      (paths || []).forEach((path) => {
        const key = String(path || '');
        if (!key || seen[key]) {
          return;
        }
        seen[key] = true;
        out.push(path);
      });
      return out;
    },

    async uploadAll(paths) {
      if (this.data.disabled) {
        return;
      }
      const remaining = this.remaining();
      if (remaining <= 0) {
        this.rejectLimit();
        return;
      }
      const picked = this.dedupe(paths).slice(0, remaining);
      if (!picked.length) {
        return;
      }
      this.setData({ uploading: true, progressText: '正在上传…（' + picked.length + ' 张）' });
      const uploadedFiles = [];
      let failed = null;
      for (let i = 0; i < picked.length; i += 1) {
        try {
          const uploaded = await uploadApi.prepareAndUpload({
            purpose: this.data.purpose,
            filePath: picked[i]
          });
          uploadedFiles.push(Object.assign({ localPath: picked[i] }, uploaded));
        } catch (err) {
          failed = err || {};
          break;
        }
      }
      // 半途失败：已成功的文件仍然保留（不因一张失败把已上传的图丢掉），用 error.files 交给页面
      const files = this.data.files.concat(uploadedFiles).slice(0, this.maxCountOf());
      this.setData({ files, uploading: false, progressText: '' });
      this.syncFlags();
      if (uploadedFiles.length > 0) {
        this.triggerEvent('change', { files });
      }
      if (failed) {
        this.triggerEvent('error', {
          reason: failed.code || 'UPLOAD_FAILED',
          message: failed.message || '上传失败，请重试',
          files
        });
      }
    },

    onRemove(event) {
      if (this.data.uploading) {
        return;
      }
      const index = Number(event.currentTarget.dataset.index);
      const files = this.data.files.slice();
      if (!(index >= 0) || index >= files.length) {
        return;
      }
      files.splice(index, 1);
      this.setData({ files });
      this.syncFlags();
      this.triggerEvent('change', { files });
    },

    onPreview(event) {
      const index = Number(event.currentTarget.dataset.index);
      const file = this.data.files[index];
      if (!file || !file.localPath) {
        return;
      }
      const urls = this.data.files
        .map((item) => (item && item.localPath) || '')
        .filter((url) => !!url);
      wx.previewImage({ urls, current: file.localPath });
    },

    // 页面提交成功/切换手填后清空（含内部状态；change 由页面自己重置）
    clear() {
      this.setData({ files: [], uploading: false, progressText: '', maxReached: false });
    }
  }
});
