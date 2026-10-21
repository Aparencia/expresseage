// components/customer-row/index.js · 顾客档案行（锚+键配对；不显示 openid）
Component({
  properties: {
    customer: { type: Object, value: {} }
  },

  methods: {
    onTap() {
      this.triggerEvent('tap', { customer: this.data.customer });
    }
  }
});
