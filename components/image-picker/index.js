// components/image-picker/index.js · 截图/头像选择与上传（相册/拍照/聊天；唯一上传路径经 api/upload）
// v1.0（D23）：支持一次多选/分多次添加的 0~maxCount 张；去重、删除、超限明确文案；半途失败不丢已上传文件。
// P1-8（TD-060）：相册/拍照/聊天直接走 wx.chooseMedia / wx.chooseMessageFile，不再预请求任何 scope
//   （尤其不请求 scope.writePhotosAlbum——那是「保存到相册」，不是选图所需）；首拒给替代路径文案。
// P1-4：单图模式（maxCount=1）再选图 = 替换旧图（修复换图静默无效）；多图模式按 D23 追加。
// change 事件：{files}（追加/替换/删除后全量快照）；error：{reason,message,files}（失败时仍带已成功文件）；
// limit：{maxCount,message}（已达上限仍尝试添加）。页面只消费事件，不直接改组件内部状态。
const uploadApi = require('../../api/upload');
const state = require('./state');

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
      return state.maxCountOf(this.data.maxCount);
    },

    remaining() {
      return state.remainingOf(this.data.files.length, this.data.maxCount);
    },

    syncFlags() {
      this.setData({ maxReached: this.remaining() <= 0 && !state.singleModeOf(this.data.maxCount) });
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
      const gate = state.pickGateOf({
        disabled: this.data.disabled,
        uploading: this.data.uploading,
        count: this.data.files.length,
        maxCount: this.data.maxCount
      });
      if (!gate.ok) {
        if (gate.limit) this.rejectLimit();
        return false;
      }
      return true;
    },

    // P1-8：相册选择不做任何前置授权（wx.chooseMedia 自带隐私流程，TD-060）
    onChooseAlbum() {
      if (!this.canPick()) return;
      this.chooseMedia(['album']);
    },

    onChooseCamera() {
      if (!this.canPick()) return;
      this.chooseMedia(['camera']);
    },

    onChooseChat() {
      if (!this.canPick()) return;
      wx.chooseMessageFile({
        count: state.pickCountOf(this.data.files.length, this.data.maxCount),
        type: 'image',
        success: (res) => {
          const paths = (res.tempFiles || []).map((item) => item.path);
          this.uploadAll(paths);
        },
        fail: (err) => {
          this.onChooseFail('chat', err);
        }
      });
    },

    chooseMedia(sourceType) {
      const list = Array.isArray(sourceType) ? sourceType : [String(sourceType || 'album')];
      const source = String(list[0] || 'album');
      wx.chooseMedia({
        count: state.pickCountOf(this.data.files.length, this.data.maxCount),
        mediaType: ['image'],
        sourceType: list,
        success: (res) => {
          const paths = (res.tempFiles || []).map((item) => item.tempFilePath);
          this.uploadAll(paths);
        },
        fail: (err) => {
          this.onChooseFail(source, err);
        }
      });
    },

    // 取消不报错；拒绝/失败给「换其他来源 / 不传截图手动填写」的替代路径（UX §9.2）
    onChooseFail(sourceType, err) {
      if (state.isCancelOf(err)) return;
      this.triggerEvent('error', {
        reason: 'PRIVACY_DENIED',
        message: state.deniedCopyOf(sourceType),
        files: this.data.files
      });
    },

    // 页面「重新识别」在无本地图时调用：直接打开选择器（不空转，P1-4）
    openSource(sourceType) {
      if (this.data.disabled || this.data.uploading) return;
      if (sourceType === 'camera') {
        this.onChooseCamera();
      } else if (sourceType === 'chat') {
        this.onChooseChat();
      } else {
        this.onChooseAlbum();
      }
    },

    async uploadAll(paths) {
      if (this.data.disabled) {
        return;
      }
      const picked = state.newPathsOf(this.data.files, paths)
        .slice(0, state.pickCountOf(this.data.files.length, this.data.maxCount));
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
      // 半途失败：已成功的文件仍然保留（不因一张失败把已上传的图丢掉），用 error.files 交给页面；
      // 单图模式替换失败时保留旧图（新图没有上传成功就不算替换，不能把可用旧图弄丢）
      const files = uploadedFiles.length === 0
        ? this.data.files
        : state.mergeFiles(this.data.files, uploadedFiles, this.data.maxCount);
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
