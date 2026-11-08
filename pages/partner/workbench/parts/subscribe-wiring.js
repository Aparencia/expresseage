// pages/partner/workbench/parts/subscribe-wiring.js · 工作台「开启新单提醒」/接单拒单续订接线（批 31 / D73）
// 判决在 utils/subscribe 纯件；本件只做 store 配置读取、页面 data 接线与结果文案（禁止假成功）。
// 从 page-actions 拆出以守源码单文件 ≤500 行（门禁 #18）。
'use strict';

const store = require('../../../../store/index');
const subscribe = require('../../../../utils/subscribe');

module.exports = {
  // 入口是否显示：订阅未启用/缺模板 ID 时隐藏（出厂 enabled=false，不摆死按钮）。
  syncSubscribeVisible() {
    const visible = subscribe.planForPartnerTap(store.get('config')).length > 0;
    if (visible !== this.data.subscribeEnabled) {
      this.setData({ subscribeEnabled: visible });
    }
  },

  // 接单/拒单 tap 内先补 1 条额度（必须在 dispatch/确认框之前，保留点击手势；失败静默不阻断）。
  requestNewOrderSubscribe() {
    if (this.data.readonly || this.data.testWrite) return;
    const ids = subscribe.planForPartnerTap(store.get('config'));
    if (ids.length) subscribe.request(ids);
  },

  // 页头按钮：只有 accept 才提示已开启；reject/ban/filter 按真实原因提示（不冒充成功）。
  onSubscribeTap() {
    if (this.data.readonly || this.data.testWrite) return;
    const ids = subscribe.planForPartnerTap(store.get('config'));
    if (!ids.length) {
      this.toastMsg('提醒暂未开启');
      return;
    }
    subscribe.request(ids).then((result) => {
      if (!result.ok && subscribe.isMainSwitchOff(result)) {
        subscribe.guideMainSwitch('partner');
        return;
      }
      if (!result.ok) {
        this.toastMsg('提醒没开启，可稍后再试');
        return;
      }
      const statuses = result.statuses || subscribe.statusesOf(ids, result.result);
      if (subscribe.acceptedOf(statuses)) {
        this.toastMsg('已开启新单提醒');
        return;
      }
      this.toastMsg(subscribe.resultText(statuses) || '没有开启提醒，订单仍可在工作台查看');
    });
  }
};
