// custom-tab-bar/index.js · 自定义 tabBar（按角色渲染 3 格；切换会话按目标角色渲染）
const store = require('../store/index');

const CUSTOMER_TABS = [
  { pagePath: 'pages/customer/home/index', text: '首页', icon: '/assets/tabbar/customer-home.png', activeIcon: '/assets/tabbar/customer-home-active.png' },
  { pagePath: 'pages/customer/orders/index', text: '订单', icon: '/assets/tabbar/customer-orders.png', activeIcon: '/assets/tabbar/customer-orders-active.png' },
  { pagePath: 'pages/profile/index', text: '我的', icon: '/assets/tabbar/profile.png', activeIcon: '/assets/tabbar/profile-active.png', badgeKey: 'messages' }
];

const PARTNER_TABS = [
  { pagePath: 'pages/partner/workbench/index', text: '工作台', icon: '/assets/tabbar/partner-workbench.png', activeIcon: '/assets/tabbar/partner-workbench-active.png', badgeKey: 'workbenchPending' },
  { pagePath: 'pages/partner/customers/index', text: '客户', icon: '/assets/tabbar/partner-customers.png', activeIcon: '/assets/tabbar/partner-customers-active.png' },
  { pagePath: 'pages/profile/index', text: '我的', icon: '/assets/tabbar/profile.png', activeIcon: '/assets/tabbar/profile-active.png', badgeKey: 'messages' }
];

function roleOf(snapshot) {
  const view = snapshot.viewContext;
  if (view && view.role) {
    return view.role;
  }
  return snapshot.activeRole || 'CUSTOMER';
}

function currentPath() {
  const pages = getCurrentPages();
  if (!pages || !pages.length) {
    return '';
  }
  return pages[pages.length - 1].route || '';
}

Component({
  data: {
    tabs: [],
    selected: 0,
    role: 'CUSTOMER',
    badges: {}
  },

  lifetimes: {
    attached() {
      this.sync();
      this.unsubscribe = store.subscribe(() => this.sync());
    },
    detached() {
      if (this.unsubscribe) {
        this.unsubscribe();
        this.unsubscribe = null;
      }
    }
  },

  pageLifetimes: {
    show() {
      this.sync();
    }
  },

  methods: {
    sync() {
      const snapshot = store.snapshot();
      const role = roleOf(snapshot);
      const tabs = role === 'PARTNER' ? PARTNER_TABS : CUSTOMER_TABS;
      const path = currentPath();
      let selected = tabs.findIndex((tab) => tab.pagePath === path);
      if (selected < 0) {
        selected = 0;
      }
      this.setData({
        role,
        tabs,
        selected,
        badges: snapshot.badges || {}
      });
    },

    onTap(event) {
      const index = Number(event.currentTarget.dataset.index);
      const tab = this.data.tabs[index];
      if (!tab || tab.pagePath === currentPath()) {
        return;
      }
      wx.switchTab({ url: '/' + tab.pagePath });
    }
  }
});
