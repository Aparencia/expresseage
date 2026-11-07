// pages/profile/parts/logout.js · D69 退出登录（本机退出：清会话缓存，保留本机取件码清单）
// 口径：用户 2026-11-08 裁决 A——微信身份自动识别，退出＝停在本机「已退出」态，点重新登录即恢复；
// 只清 utils/storage 的会话键（lastRole/guides/pickupChecks），不删 ex_college_v4.pickcodes，不调用服务端。
'use strict';

const store = require('../../../store/index');
const storage = require('../../../utils/storage');

const LOGOUT_URL = '/pages/launch/index';

function confirmLogout() {
  wx.showModal({
    title: '退出登录',
    content: '退出后本机将清除登录状态与缓存，需重新登录；你的资料与订单仍保存在云端，不会删除。',
    confirmText: '退出登录',
    success(res) {
      if (!res.confirm) {
        return;
      }
      storage.clearSession();
      store.reset();
      wx.reLaunch({ url: LOGOUT_URL });
    }
  });
}

module.exports = { confirmLogout };
