// tools/lib/share-pages.js · 分享接线清单（门禁 #33 与 tools/selftest-share.js 的唯一单源）
// 口径（CONTRACT §8/§11、D36）：
//   - APP_MESSAGE：顾客/兼职业务页全部支持「转发给朋友」（卡片在中性纯件里构造，页面零自拼）；
//   - TIMELINE：仅 3 个「朋友圈单页模式可自洽」的页面（role=身份/邀请、home=顾客首页、help=静态帮助），
//     其它数据页打开在单页模式下无登录态/无云资源会空白，故不挂朋友圈；
//   - ADMIN_PAGES：后台 11 页零分享入口（治理数据不外传，selftest-admin-pages §N 同口径）。
'use strict';

const APP_MESSAGE = [
  'pages/role/index.js',
  'pages/customer/home/index.js',
  'pages/customer/orders/index.js',
  'pages/partner/workbench/index.js',
  'pages/partner/customers/index.js',
  'pages/profile/index.js',
  'pkg-customer/pages/bind/index.js',
  'pkg-customer/pages/order-create/index.js',
  'pkg-customer/pages/order-detail/index.js',
  'pkg-customer/pages/pickup-list/index.js',
  'pkg-customer/pages/messages/index.js',
  'pkg-customer/pages/help/index.js',
  'pkg-partner/pages/activate/index.js',
  'pkg-partner/pages/order-detail/index.js',
  'pkg-partner/pages/create-on-behalf/index.js',
  'pkg-partner/pages/customer-detail/index.js',
  'pkg-partner/pages/service-settings/index.js',
  'pkg-partner/pages/stats/index.js',
  'pkg-partner/pages/messages/index.js'
];

const TIMELINE = [
  'pages/role/index.js',
  'pages/customer/home/index.js',
  'pkg-customer/pages/help/index.js'
];

const ADMIN_PAGES = [
  'pkg-admin/pages/overview/index.js',
  'pkg-admin/pages/invite-codes/index.js',
  'pkg-admin/pages/customers/index.js',
  'pkg-admin/pages/customer-detail/index.js',
  'pkg-admin/pages/partners/index.js',
  'pkg-admin/pages/orders/index.js',
  'pkg-admin/pages/order-detail/index.js',
  'pkg-admin/pages/config/index.js',
  'pkg-admin/pages/account-switch/index.js',
  'pkg-admin/pages/messages/index.js',
  'pkg-admin/pages/recognition-review/index.js'
];

module.exports = { APP_MESSAGE, TIMELINE, ADMIN_PAGES };
