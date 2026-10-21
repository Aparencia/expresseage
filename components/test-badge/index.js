// components/test-badge/index.js · TEST 角标（TEST 字面量只允许在本组件）
const store = require('../../store/index');

Component({
  data: {
    visible: false
  },

  lifetimes: {
    attached() {
      this.refresh();
      this.unsubscribe = store.subscribe(() => this.refresh());
    },
    detached() {
      if (this.unsubscribe) {
        this.unsubscribe();
        this.unsubscribe = null;
      }
    }
  },

  methods: {
    refresh() {
      const view = store.getViewContext();
      const visible = !!(view && view.viewMode === 'TEST_WRITE');
      if (visible !== this.data.visible) {
        this.setData({ visible });
      }
    }
  }
});
