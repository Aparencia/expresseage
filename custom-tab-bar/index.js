// custom-tab-bar/index.js · 自定义 tabBar（按角色渲染 3 格；切换会话按目标角色渲染）
// 选中态：tab 页 onShow 会显式 getTabBar().setData({selected:n})（每页一份实例）；
// 本组件自身只做兜底推导 + 判等，避免每次 store 通知都重渲染 tabBar（PERFORMANCE §2.4 B10）。
const store = require('../store/index');

const CUSTOMER_TABS = [
  { pagePath: 'pages/customer/home/index', text: '首页', icon: '/assets/tabbar/customer-home.png', activeIcon: '/assets/tabbar/customer-home-active.png' },
  { pagePath: 'pages/customer/orders/index', text: '订单', icon: '/assets/tabbar/customer-orders.png', activeIcon: '/assets/tabbar/customer-orders-active.png', badgeKey: 'ordersOngoing' },
  { pagePath: 'pages/profile/index', text: '我的', icon: '/assets/tabbar/profile.png', activeIcon: '/assets/tabbar/profile-active.png', badgeKey: 'messages' }
];

const PARTNER_TABS = [
  { pagePath: 'pages/partner/workbench/index', text: '工作台', icon: '/assets/tabbar/partner-workbench.png', activeIcon: '/assets/tabbar/partner-workbench-active.png', badgeKey: 'workbenchPending' },
  { pagePath: 'pages/partner/customers/index', text: '客户', icon: '/assets/tabbar/partner-customers.png', activeIcon: '/assets/tabbar/partner-customers-active.png' },
  { pagePath: 'pages/profile/index', text: '我的', icon: '/assets/tabbar/profile.png', activeIcon: '/assets/tabbar/profile-active.png', badgeKey: 'messages' }
];

const BADGE_KEYS = ['workbenchPending', 'messages', 'ordersOngoing'];

function roleOf(viewContext, activeRole) {
  if (viewContext && viewContext.role) {
    return viewContext.role;
  }
  return activeRole || 'CUSTOMER';
}

function currentPath() {
  const pages = getCurrentPages();
  if (!pages || !pages.length) {
    return '';
  }
  return pages[pages.length - 1].route || '';
}

// 角标只比较三个已知键（值归一为 0），未变化就不 setData
function sameBadges(left, right) {
  const a = left || {};
  const b = right || {};
  return BADGE_KEYS.every(function eq(key) {
    return (a[key] || 0) === (b[key] || 0);
  });
}

// tabs 恒为某角色的常量表：按 pagePath 逐格比较（不依赖 setData 是否保留数组引用）
function sameTabs(left, right) {
  const a = Array.isArray(left) ? left : [];
  const b = Array.isArray(right) ? right : [];
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (!a[i] || !b[i] || a[i].pagePath !== b[i].pagePath) {
      return false;
    }
  }
  return true;
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
    // 用 store.get 逐键读（不做整份 snapshot clone），并按引用/值判等后跳过 setData
    sync() {
      const viewContext = store.get('viewContext');
      const activeRole = store.get('activeRole');
      const badges = store.get('badges') || {};
      const role = roleOf(viewContext, activeRole);
      const tabs = role === 'PARTNER' ? PARTNER_TABS : CUSTOMER_TABS;
      const path = currentPath();
      let selected = tabs.findIndex((tab) => tab.pagePath === path);
      if (selected < 0) {
        // 路径还没进栈时保留页面 onShow 显式设置的值（不回退成「首页」造成错格高亮）
        const previous = this.data.selected;
        selected = typeof previous === 'number' && previous >= 0 && previous < tabs.length ? previous : 0;
      }
      const current = this.data;
      if (current.role === role && current.selected === selected
        && sameTabs(current.tabs, tabs) && sameBadges(current.badges, badges)) {
        return;
      }
      this.setData({
        role: role,
        tabs: tabs,
        selected: selected,
        badges: badges
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
