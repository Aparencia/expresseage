// components/maintenance-mask/index.js · 维护模式全屏公告（纯展示 + ack 事件；页面级 usingComponents 注册）
'use strict';

Component({
  properties: {
    enabled: { type: Boolean, value: false },
    title: { type: String, value: '系统维护中' },
    text: { type: String, value: '' },
    actionText: { type: String, value: '知道了' }
  },

  methods: {
    onAck() {
      this.triggerEvent('ack', {});
    },

    // 遮罩自身吞掉点击/滑动，防止穿透到页面动作（维护期写动作语义上被服务端拒绝）
    noop() {}
  }
});
