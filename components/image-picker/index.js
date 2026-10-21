// components/image-picker/index.js · 截图/头像选择与上传（相册/拍照/聊天；唯一上传路径经 api/upload）
const uploadApi = require('../../api/upload');
const privacy = require('../../api/privacy');

Component({
  properties: {
    maxCount: { type: Number, value: 1 },
    purpose: { type: String, value: 'TICKET' }
  },

  data: {
    files: [],
    uploading: false,
    progressText: ''
  },

  methods: {
    async onChooseAlbum() {
      const allowed = await privacy.ensureAlbumAuth();
      if (!allowed) {
        this.triggerEvent('error', {
          reason: 'PRIVACY_DENIED',
          message: '需要相册权限才能选择图片，也可用拍照或从聊天选择'
        });
        return;
      }
      this.chooseMedia(['album']);
    },

    onChooseCamera() {
      this.chooseMedia(['camera']);
    },

    onChooseChat() {
      const count = this.data.maxCount;
      wx.chooseMessageFile({
        count,
        type: 'image',
        success: (res) => {
          const paths = (res.tempFiles || []).map((item) => item.path);
          this.uploadAll(paths);
        }
      });
    },

    chooseMedia(sourceType) {
      wx.chooseMedia({
        count: this.data.maxCount,
        mediaType: ['image'],
        sourceType,
        success: (res) => {
          const paths = (res.tempFiles || []).map((item) => item.tempFilePath);
          this.uploadAll(paths);
        }
      });
    },

    async uploadAll(paths) {
      if (!paths || !paths.length) {
        return;
      }
      this.setData({ uploading: true, progressText: '正在上传…' });
      const uploadedFiles = [];
      try {
        for (let i = 0; i < paths.length; i += 1) {
          const uploaded = await uploadApi.prepareAndUpload({
            purpose: this.data.purpose,
            filePath: paths[i]
          });
          uploadedFiles.push(Object.assign({ localPath: paths[i] }, uploaded));
        }
        const files = this.data.files.concat(uploadedFiles).slice(0, this.data.maxCount);
        this.setData({ files, uploading: false, progressText: '' });
        this.triggerEvent('change', { files });
      } catch (err) {
        this.setData({ uploading: false, progressText: '' });
        this.triggerEvent('error', {
          reason: err.code || 'UPLOAD_FAILED',
          message: err.message || '上传失败，请重试'
        });
      }
    },

    onRemove(event) {
      const index = Number(event.currentTarget.dataset.index);
      const files = this.data.files.slice();
      files.splice(index, 1);
      this.setData({ files });
      this.triggerEvent('change', { files });
    },

    onPreview(event) {
      const index = Number(event.currentTarget.dataset.index);
      const file = this.data.files[index];
      if (file && file.localPath) {
        wx.previewImage({ urls: [file.localPath], current: file.localPath });
      }
    }
  }
});
