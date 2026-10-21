// components/role-switch/index.js · 顾客/兼职身份切换（只渲染当前可切身份）
Component({
  properties: {
    activeRole: { type: String, value: 'CUSTOMER' }
  },

  methods: {
    onSelect(event) {
      const role = event.currentTarget.dataset.role;
      if (!role || role === this.data.activeRole) {
        return;
      }
      this.triggerEvent('change', { role });
    }
  }
});
