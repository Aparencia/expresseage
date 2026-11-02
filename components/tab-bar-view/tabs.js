// components/tab-bar-view/tabs.js · 底部栏数据单源（D64：custom-tab-bar 与取件码伪 tab 页共用同一份）
// 口径：CONTRACT §7/§8、D64——真实 tabBar.list 仍 5 项；顾客可见 4 格（首页/订单/取件码/我的），
// 其中「取件码」是伪 tab（不在 tabBar.list，页面内自绘本组件并 reLaunch 进入）；兼职可见 3 格。
// 边界：只放纯数据（零 wx、零 store），视觉渲染在 components/tab-bar-view，跳转判据在调用方。
'use strict';

// 伪 tab 标记：pagePath 不在 app.json tabBar.list，跳转必须 reLaunch（switchTab 只吃真 tab 页）
const CUSTOMER_TABS = [
  { pagePath: 'pages/customer/home/index', text: '首页', icon: '/assets/tabbar/customer-home.png', activeIcon: '/assets/tabbar/customer-home-active.png' },
  { pagePath: 'pages/customer/orders/index', text: '订单', icon: '/assets/tabbar/customer-orders.png', activeIcon: '/assets/tabbar/customer-orders-active.png', badgeKey: 'ordersOngoing' },
  { pagePath: 'pages/customer/pickcodes/index', text: '取件码', icon: '/assets/tabbar/customer-pickcodes.png', activeIcon: '/assets/tabbar/customer-pickcodes-active.png', pseudoTab: true },
  { pagePath: 'pages/profile/index', text: '我的', icon: '/assets/tabbar/profile.png', activeIcon: '/assets/tabbar/profile-active.png', badgeKey: 'messages' }
];

const PARTNER_TABS = [
  { pagePath: 'pages/partner/workbench/index', text: '工作台', icon: '/assets/tabbar/partner-workbench.png', activeIcon: '/assets/tabbar/partner-workbench-active.png', badgeKey: 'workbenchPending' },
  { pagePath: 'pages/partner/customers/index', text: '客户', icon: '/assets/tabbar/partner-customers.png', activeIcon: '/assets/tabbar/partner-customers-active.png' },
  { pagePath: 'pages/profile/index', text: '我的', icon: '/assets/tabbar/profile.png', activeIcon: '/assets/tabbar/profile-active.png', badgeKey: 'messages' }
];

module.exports = { CUSTOMER_TABS, PARTNER_TABS };
