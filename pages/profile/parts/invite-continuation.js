// pages/profile/parts/invite-continuation.js · 邀请续跳（D38）：消费 ?bind= 待绑定邀请 + 一次性可取消提示
// 口径：D37/D38；pending 只存会话级内存（utils/share/pending-invite），不落盘、不携带头像/昵称/订单。
// 页面只调两个函数：rememberFromOptions(options)（onLoad）与 prompt(page)（onShow），
// 让 pages/profile/index.js 只增加「调用行」而守住门禁 #18 单文件 ≤500 行。
'use strict';

const route = require('../../../config/route');
const ids = require('../../../utils/ids');
const pendingInvite = require('../../../utils/share/pending-invite');
const ui = require('./ui');

const PROMPT_TITLE = '邀请绑定';
const CANCEL_COPY = '已取消自动绑定，可稍后在首页绑定';

// onLoad：只认合法兼职编号（config/route.entryOf 归一/丢弃非法值），记入会话级 pending；
// 返回 canonical 供页面留档（无邀请为空串）。能进本页说明 launch 隐私闸已通过。
function rememberFromOptions(options) {
  const bind = route.entryOf(options).bind;
  if (bind) {
    pendingInvite.remember(bind);
  }
  return bind;
}

function displayOf(partnerNo) {
  return ids.displayNo(ids.NO_KIND.PARTNER, partnerNo) || partnerNo;
}

// onShow：资料未完善且存在 pending 时一次性提示「保存后将自动绑定」，允许取消（取消即清 pending）。
function prompt(page) {
  if (!page || page._invitePrompted || !page.data.isCustomer || page.data.customerComplete) {
    return;
  }
  const partnerNo = pendingInvite.peek();
  if (!partnerNo) {
    return;
  }
  page._invitePrompted = true;
  wx.showModal({
    title: PROMPT_TITLE,
    content: '资料保存后将自动为你绑定邀请的兼职（' + displayOf(partnerNo) + '）；如不需要可取消。',
    confirmText: '知道了',
    cancelText: '取消自动绑定',
    success(res) {
      if (res && res.cancel) {
        pendingInvite.clear();
        ui.toast(CANCEL_COPY);
      }
    }
  });
}

module.exports = {
  rememberFromOptions,
  prompt,
  displayOf
};
