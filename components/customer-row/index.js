// components/customer-row/index.js · 顾客档案行（锚+键配对；不显示 openid）
// D42：src = 服务端 5 分钟临时 URL（优先展示）；fileId 由 customer.avatarFileId 回退；无头像显示默认头像色块。
Component({
  properties: {
    customer: { type: Object, value: {} },
    src: { type: String, value: '' }
  },

  methods: {
    onTap() {
      this.triggerEvent('tap', { customer: this.data.customer });
    }
  }
});
