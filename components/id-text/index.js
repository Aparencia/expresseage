// components/id-text/index.js · 唯一编号展示（canonical → display；独立行可复制）
const ids = require('../../utils/ids');

Component({
  properties: {
    kind: { type: String, value: 'CUSTOMER' },
    no: { type: String, value: '' }
  },

  data: {
    display: ''
  },

  observers: {
    'kind, no'(kind, no) {
      let display = '';
      if (no && typeof ids.displayNo === 'function') {
        try {
          display = ids.displayNo(kind, no) || '';
        } catch (err) {
          display = '';
        }
      }
      this.setData({ display });
    }
  },

  methods: {
    onCopy() {
      const value = this.data.display;
      if (!value) {
        return;
      }
      wx.setClipboardData({
        data: value,
        success: () => {
          this.triggerEvent('copy', { display: value });
        }
      });
    }
  }
});
