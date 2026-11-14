// pages/partner/workbench/parts/subscribe-wiring.js · 工作台「开启新单提醒」/接单拒单续订接线（批 31 / D73）
// 判决在 utils/subscribe 纯件；本件只做 store 配置读取、页面 data 接线与结果文案（禁止假成功）。
// 从 page-actions 拆出以守源码单文件 ≤500 行（门禁 #18）。
'use strict';

const store = require('../../../../store/index');
const subscribe = require('../../../../utils/subscribe');

module.exports = {
  // 入口是否显示：订阅未启用/缺模板 ID 时隐藏（出厂 enabled=false，不摆死按钮）。
  // 批 32：本次会话已授权成功（subscribeOn）后也隐藏——用户明确要求「开启后应该消失」；
  // 一次性订阅的额度由接单/拒单点击续，不靠这个按钮反复点。
  syncSubscribeVisible() {
    const visible = this.data.subscribeOn !== true
      && subscribe.planForPartnerTap(store.get('config')).length > 0;
    if (visible !== this.data.subscribeEnabled) {
      this.setData({ subscribeEnabled: visible });
    }
  },

  // 批 42：入口可见性以「微信真实订阅状态」为准（wx.getSetting），不只看本次会话的 subscribeOn。
  // 已开启（accept）→ 隐藏按钮；未开启/总开关关闭 → 显示（点击时按真实结果给下一步）。
  refreshSubscribeStatus(force) {
    const ids = subscribe.planForPartnerTap(store.get('config'));
    const planId = ids.length ? ids[0] : '';
    if (force !== true && this._subscribeCheckedId === planId) {
      return;
    }
    this._subscribeCheckedId = planId;
    if (!planId || typeof wx === 'undefined' || typeof wx.getSetting !== 'function') {
      this.syncSubscribeVisible();
      return;
    }
    wx.getSetting({
      withSubscriptions: true,
      success: (res) => {
        const status = subscribe.settingStatusOf(res, planId);
        const on = status.state === 'on';
        this.setData({ subscribeOn: on, subscribeEnabled: !on });
      },
      fail: () => this.syncSubscribeVisible()
    });
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
        // 批 32：授权成功即隐藏入口（一次性订阅语义：一条授权只管一条通知，接单/拒单时滚动续额）
        this.setData({ subscribeOn: true, subscribeEnabled: false });
        this.toastMsg('已开启新单提醒');
        return;
      }
      this.toastMsg(subscribe.resultText(statuses) || '没有开启提醒，订单仍可在工作台查看');
    });
  }
};
