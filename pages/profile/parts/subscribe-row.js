// pages/profile/parts/subscribe-row.js · 「我的」页「微信提醒」行（批 31 / D73）
// 平台事实：订阅消息没有「应用内开关」——只能读取 wx.getSetting 状态、引导去小程序设置；
// 关闭订阅必须在微信设置页完成，代码不能代关。READONLY/TEST_WRITE 一律隐藏且不可操作。
// 真值口径：用户拒绝（reject/ban/filter）不得提示「已开启」；errCode 只在开发版显示排障。
'use strict';

const store = require('../../../store/index');
const modeGuard = require('../../../api/mode-guard');
const subscribe = require('../../../utils/subscribe');

function configOf() {
  return store.get('config') || {};
}

function templateIdOf(isCustomer) {
  const ids = subscribe.idsOf(configOf());
  return isCustomer ? ids.delivered : ids.newOrder;
}

function visibleOf(isCustomer) {
  return !!(subscribe.enabledOf(configOf()) && templateIdOf(isCustomer));
}

// READONLY/TEST_WRITE（含 viewSession 兜底）一律按隐藏处理：不读设置、不可操作。
function blockedOf(page) {
  return !!(page && page.data && (page.data.viewSession === true
    || modeGuard.isReadonly() || modeGuard.isTestWrite()));
}

function statusOf(settings, templateId) {
  const all = (settings && settings.subscriptionsSetting) || {};
  if (all.mainSwitch === false) return { state: 'blocked', text: '已关闭（去设置）' };
  const value = (all.itemSettings || {})[templateId];
  if (value === 'accept') return { state: 'on', text: '已开启' };
  if (value === 'reject') return { state: 'off', text: '未开启（点此开启）' };
  return { state: 'off', text: '未开启（点此开启）' };
}

function refresh(page) {
  const isCustomer = page.data.isCustomer === true;
  if (blockedOf(page) || !visibleOf(isCustomer)) {
    page.setData({ subscribeVisible: false });
    return;
  }
  const templateId = templateIdOf(isCustomer);
  if (typeof wx === 'undefined' || typeof wx.getSetting !== 'function') {
    page.setData({ subscribeVisible: false });
    return;
  }
  wx.getSetting({
    withSubscriptions: true,
    success: (res) => {
      const status = statusOf(res, templateId);
      page.setData({
        subscribeVisible: true,
        subscribeState: status.state,
        subscribeStatusText: status.text
      });
    },
    fail: () => page.setData({ subscribeVisible: false })
  });
}

function openSystemSetting() {
  subscribe.openSetting().then((result) => {
    if (result.ok && typeof wx !== 'undefined' && typeof wx.showToast === 'function') {
      wx.showToast({ title: '打开「订阅消息」后，可再次点击此处开启', icon: 'none' });
    }
  });
}

function envVersionOf() {
  try {
    const info = wx.getAccountInfoSync();
    return (info && info.miniProgram && info.miniProgram.envVersion) || '';
  } catch (error) {
    return '';
  }
}

function codeOf(result) {
  const error = result && result.error;
  const code = error && (error.errCode || error.errMsg);
  return code ? String(code) : '';
}

// 仅开发版显示 errCode 排障；体验版/正式版一律只进 console（不向用户暴露错误码）。
function showFailureDebug(result) {
  const code = codeOf(result);
  if (!code) return;
  if (envVersionOf() === 'develop') {
    wx.showModal({ title: '订阅失败（调试）', content: 'errCode: ' + code, showCancel: false });
    return;
  }
  console.warn('[subscribe] profile row failed', code);
}

function onTap(page) {
  if (blockedOf(page)) {
    wx.showToast({ title: '开发者视角下不能操作此提醒', icon: 'none' });
    return;
  }
  const templateId = templateIdOf(page.data.isCustomer === true);
  if (!templateId) {
    wx.showToast({ title: '提醒暂未开启', icon: 'none' });
    return;
  }
  if (page.data.subscribeState === 'blocked') {
    subscribe.guideMainSwitch('profile');
    return;
  }
  if (page.data.subscribeState === 'on') {
    wx.showModal({
      title: '微信提醒',
      content: '已开启。如需关闭，请到小程序设置里关闭「订阅消息」。',
      confirmText: '去设置',
      cancelText: '知道了',
      success: (res) => {
        if (res.confirm) openSystemSetting();
      }
    });
    return;
  }
  subscribe.request([templateId]).then((result) => {
    if (!result.ok && subscribe.isMainSwitchOff(result)) {
      subscribe.guideMainSwitch('profile');
      return;
    }
    if (!result.ok) {
      showFailureDebug(result);
      if (envVersionOf() !== 'develop') {
        wx.showToast({ title: '提醒没开启，可稍后再试', icon: 'none' });
      }
      return;
    }
    refresh(page);
    if (subscribe.acceptedOf(result.statuses)) {
      wx.showToast({ title: '已开启微信提醒', icon: 'none' });
      return;
    }
    // reject/ban/filter：按真实结果说没有开启（不冒充成功）。
    wx.showToast({
      title: subscribe.resultText(result.statuses) || '未开启，可在小程序设置里修改',
      icon: 'none'
    });
  });
}

module.exports = {
  visibleOf,
  statusOf,
  refresh,
  onTap
};
