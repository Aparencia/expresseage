// components/status-pill/index.js · 订单状态胶囊（七状态 + 异常/取消分支；颜色+文字双编码）
const STATUS_MAP = {
  SUBMITTED: { text: '待接单', tone: 'pending' },
  ACCEPTED: { text: '已接单', tone: 'accepted' },
  PICKED: { text: '已取件', tone: 'picked' },
  DELIVERED: { text: '已送达', tone: 'delivered' },
  COMPLETED: { text: '已完成', tone: 'completed' },
  CANCELLED: { text: '已取消', tone: 'cancelled' },
  EXCEPTION: { text: '异常', tone: 'exception' }
};

Component({
  properties: {
    status: { type: String, value: '' }
  },

  data: {
    text: '',
    tone: 'pending'
  },

  observers: {
    status(status) {
      const meta = STATUS_MAP[status];
      this.setData({
        text: meta ? meta.text : '',
        tone: meta ? meta.tone : 'pending'
      });
    }
  }
});
