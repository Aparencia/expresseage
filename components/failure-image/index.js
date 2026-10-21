// components/failure-image/index.js · 识别失败原图（每次进入取一次临时 URL；只经 api，审计由服务端写）
const adminModule = require('../../api/modules/admin');

Component({
  properties: {
    failureNo: { type: String, value: '' }
  },

  data: {
    url: '',
    loading: false,
    errorText: ''
  },

  observers: {
    failureNo(failureNo) {
      if (failureNo) {
        this.load();
      }
    }
  },

  lifetimes: {
    attached() {
      if (this.data.failureNo) {
        this.load();
      }
    }
  },

  methods: {
    async load() {
      if (!this.data.failureNo) {
        return;
      }
      this.setData({ loading: true, errorText: '', url: '' });
      try {
        const data = await adminModule.getRecognitionFailure({ failureNo: this.data.failureNo });
        const url = data && (data.tempFileURL || data.url || data.imageUrl);
        if (!url) {
          this.setData({ loading: false, errorText: '这条记录没有可查看的原图' });
          this.triggerEvent('error', { reason: 'NO_IMAGE' });
          return;
        }
        this.setData({ url, loading: false });
        this.triggerEvent('loaded', { url });
      } catch (err) {
        this.setData({ loading: false, errorText: err.message || '原图加载失败，可重试' });
        this.triggerEvent('error', { reason: err.code || 'LOAD_FAILED' });
      }
    },

    onRetry() {
      this.load();
    },

    onImageError() {
      this.setData({ url: '', errorText: '原图加载失败，可重试' });
      this.triggerEvent('error', { reason: 'IMAGE_ERROR' });
    }
  }
});
