// components/bottom-bar/index.js · D65 全局底部固定条：slot 内容 + 可测高占位
// 占位高度 = 实测底条高度（ready 后测一次），CSS min-height 用 --v4-inset-bar+24rpx 兜底；
// 这样页面不再自造「静态垫高」，条高变化（如失败重试行出现）也不会把最后一项压在条下面。
Component({
  data: {
    placeholderHeight: 0
  },

  lifetimes: {
    ready() {
      this.measure();
    }
  },

  methods: {
    measure() {
      this.createSelectorQuery()
        .select('.bb-bar')
        .boundingClientRect((rect) => {
          if (rect && rect.height > 0) {
            this.setData({ placeholderHeight: rect.height });
          }
        })
        .exec();
    }
  }
});
