// pages/profile/parts/delete-account.js · 注销账号两步确认与提交（从 index.js 拆出，D69 腾出 500 行余量）
// 口径不变：先不可撤销说明 → 输入「注销」二次确认 → user.deleteAccount（服务端校验进行中订单）。
'use strict';

const store = require('../../../store/index');
const userApi = require('../../../api/modules/user');
const route = require('../../../config/route');
const ui = require('./ui');

const DELETION_CONFIRM_TEXT = '注销';
const READONLY_COPY = '开发者只读视角不能操作';

function begin(page) {
  if (!page.data.canEdit) {
    ui.toast(READONLY_COPY);
    return;
  }
  wx.showModal({
    title: '注销账号',
    content: '注销不可撤销：订单与资料会被匿名化或删除，绑定会解除。进行中的订单会阻止注销。',
    confirmText: '继续',
    confirmColor: '#E54D42',
    success(res) {
      if (res.confirm) {
        askText(page);
      }
    }
  });
}

function askText(page) {
  wx.showModal({
    title: '确认注销',
    editable: true,
    placeholderText: '输入「注销」两个字',
    confirmText: '确定注销',
    confirmColor: '#E54D42',
    success(res) {
      if (!res.confirm) {
        return;
      }
      if (String(res.content || '').trim() !== DELETION_CONFIRM_TEXT) {
        ui.toast('请输入「注销」两个字确认');
        return;
      }
      commit(page);
    }
  });
}

function commit(page) {
  userApi.deleteAccount({ confirmText: DELETION_CONFIRM_TEXT }).then(() => {
    if (page.unsubscribe) {
      page.unsubscribe();
      page.unsubscribe = null;
    }
    store.reset();
    wx.showModal({
      title: '已注销',
      content: '订单与资料已匿名化或删除，30 天内完成彻底清理；重新登录将创建新的顾客资料与编号。',
      showCancel: false,
      confirmText: '知道了',
      success() {
        wx.reLaunch({ url: route.ROLE_PAGE });
      }
    });
  }).catch((err) => {
    ui.toast((err && err.message) || '注销失败，请稍后重试');
  });
}

module.exports = { begin, askText, commit };
