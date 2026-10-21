// components/empty-state/index.js · 空状态（文案 + 可选操作）
Component({
  properties: {
    text: { type: String, value: '暂无数据' },
    actionText: { type: String, value: '' }
  },

  methods: {
    onAction() {
      this.triggerEvent('action', {});
    }
  }
});
