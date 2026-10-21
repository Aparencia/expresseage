// components/order-row/index.js · 订单行（渲染服务端视图模型；不做业务判据）
Component({
  properties: {
    order: { type: Object, value: {} }
  },

  methods: {
    onTap() {
      this.triggerEvent('tap', { order: this.data.order });
    }
  }
});
