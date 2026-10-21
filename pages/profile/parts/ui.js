// pages/profile/parts/ui.js · 我的页 wx 交互小工具（toast/复制/版本号）
// 说明：视图模型（view-model.js）保持零 wx；只在页面事件层需要的小工具集中在本文件，避免页面重复实现。
'use strict';

function toast(title) {
  wx.showToast({ title: title || '操作失败', icon: 'none' });
}

function readVersion() {
  try {
    const info = wx.getAccountInfoSync();
    const version = info && info.miniProgram && info.miniProgram.version;
    return version || '开发版';
  } catch (err) {
    return '开发版';
  }
}

function copyText(value, successTitle) {
  if (!value) {
    return;
  }
  wx.setClipboardData({
    data: value,
    success() {
      toast(successTitle);
    }
  });
}

module.exports = {
  toast,
  readVersion,
  copyText
};
