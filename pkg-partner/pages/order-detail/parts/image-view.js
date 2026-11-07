// pkg-partner/pages/order-detail/parts/image-view.js · 取件截图多图预览（纯件：零 wx / 零请求）
// 口径：docs/ux/V4_UX_PARTNER.md §3.3「截图（v1.0/D23；D40 上限 0~10 张）」——
//       点「查看取件截图」应一次打开全部张数，左右滑动切换；旧实现只签 index=0 一张，多图单只能看第一张。
// 边界：本件只算「要签几张、按什么顺序拼 URL」；签发（order.imageUrl）与预览（wx.previewImage）留在页面。
const MAX_IMAGES = 10;

function countOf(order) {
  const raw = Number(order && order.imageCount);
  if (!Number.isFinite(raw) || raw <= 0) {
    return 0;
  }
  return Math.min(Math.floor(raw), MAX_IMAGES);
}

// 要逐张签发的下标：[0..count-1]；count=0 返回空数组（页面据此提示无图，不发无意义请求）
function indexesOf(order) {
  const count = countOf(order);
  const list = [];
  for (let index = 0; index < count; index += 1) {
    list.push(index);
  }
  return list;
}

// 签发结果（与 indexesOf 同序，元素为 url 或空串）→ 可预览 URL 列表：保持原顺序、剔除失败项、去重。
function urlsOf(results) {
  const seen = {};
  const urls = [];
  (Array.isArray(results) ? results : []).forEach((value) => {
    const url = typeof value === 'string' ? value.trim() : '';
    if (!url || seen[url]) {
      return;
    }
    seen[url] = true;
    urls.push(url);
  });
  return urls;
}

module.exports = {
  MAX_IMAGES,
  countOf,
  indexesOf,
  urlsOf
};
