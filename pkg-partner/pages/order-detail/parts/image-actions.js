// pkg-partner/pages/order-detail/parts/image-actions.js · 页面方法：查看取件截图（多图一次打开、可左右滑动）
// 口径：docs/ux/V4_UX_PARTNER.md §3.3「截图（v1.0/D23；D40 上限 0~10 张）」——
//       一单 0~10 张，点一次打开全部张数；旧实现只签 index=0，多图单只能看第一张。
// 边界：本文件与 parts/panel-actions、parts/page-timers 同属「页面方法段」（并入 Page 配置，允许 wx）；
//       下标/URL 归一等纯逻辑在 parts/image-view。
const orderApi = require('../../../../api/modules/order');
const imageView = require('./image-view');

const COPY = {
  imageFail: '截图暂时打不开，可能已过保留期（订单完成/取消 7 天后删除）',
  loading: '正在加载截图…'
};

function onViewImage() {
  const indexes = imageView.indexesOf(this.data.order || {});
  if (!indexes.length) {
    wx.showToast({ title: COPY.imageFail, icon: 'none' });
    return;
  }
  wx.showLoading({ title: COPY.loading, mask: true });
  // 逐张签发（每张 5 分钟临时 URL）；单张失败不拖垮整组，全失败才提示——
  // 全失败时优先说服务端/网络的真实人话，不把「网络失败」冒充成「已过保留期」。
  Promise.all(indexes.map((index) => orderApi.imageUrl({ orderNo: this.data.orderNo, index: index })
    .then((data) => ({ url: (data && data.url) || '' }))
    .catch((err) => ({ url: '', code: err && err.code, message: err && err.message }))))
    .then((results) => {
      wx.hideLoading();
      const urls = imageView.urlsOf(results.map((item) => item.url));
      if (!urls.length) {
        const first = results.filter((item) => item && item.code)[0];
        wx.showToast({ title: (first && first.message) || COPY.imageFail, icon: 'none' });
        return;
      }
      wx.previewImage({ urls: urls, current: urls[0] });
    })
    .catch(() => {
      wx.hideLoading();
      wx.showToast({ title: COPY.imageFail, icon: 'none' });
    });
}

module.exports = { COPY, onViewImage };
