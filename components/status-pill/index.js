// components/status-pill/index.js · 订单状态胶囊（七状态 + 异常/取消分支；颜色+文字双编码）
// 文案单源：shared/enums.ORDER_STATUS_TEXT（经 ./meta 纯件派生短文案与色调，见批 16 死代码专项）。
const meta = require('./meta');

Component({
  properties: {
    status: { type: String, value: '' }
  },

  data: {
    text: '',
    tone: meta.DEFAULT_TONE
  },

  observers: {
    status(status) {
      this.setData(meta.pillMetaOf(status));
    }
  }
});
