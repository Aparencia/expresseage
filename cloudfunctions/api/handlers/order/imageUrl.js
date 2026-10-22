// handlers/order/imageUrl.js · order.imageUrl({orderNo,index})：鉴权后签发 5 分钟临时 URL（URL 不落库、不进日志）
// 完整 L3 截图只在本人订单与开发者只读视角可见；admin 真实会话需走只读视角（审计）。
// v1.0 一单多包裹（D23/D24）：images[] 多张，index 缺省 0；历史单 image{} 归一为单元素数组。
'use strict';

const { errors } = require('../../lib/errors');
const common = require('./_common');

const URL_TTL_SECONDS = 300;

async function signTempUrl(ctx, fileId) {
  const cloud = ctx.cloud;
  if (!cloud || typeof cloud.getTempFileURL !== 'function') {
    throw errors.dependencyFailed('图片地址暂时获取失败，请稍后再试');
  }
  let result = null;
  try {
    result = await cloud.getTempFileURL({ fileList: [{ fileID: fileId, maxAge: URL_TTL_SECONDS }] });
  } catch (error) {
    throw errors.dependencyFailed('图片地址暂时获取失败，请稍后再试');
  }
  const first = result && Array.isArray(result.fileList) ? result.fileList[0] : null;
  const url = first && typeof first.tempFileURL === 'string' ? first.tempFileURL : '';
  if (!url) {
    throw errors.dependencyFailed('图片地址暂时获取失败，请稍后再试');
  }
  return url;
}

// 截图序号：缺省 0；负数/小数/字符串 → VALIDATION_FAILED（不静默取第 0 张）
function readImageIndex(payload) {
  const value = payload && typeof payload === 'object' ? payload.index : undefined;
  if (value === undefined || value === null) {
    return 0;
  }
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0) {
    throw errors.validation('index', '截图序号不正确，请刷新页面后重试');
  }
  return num;
}

module.exports = async function orderImageUrl(ctx, payload) {
  const orderNo = common.normalizeOrderNoInput(payload && payload.orderNo);
  const index = readImageIndex(payload);
  const order = await common.getOrderByNo(ctx, orderNo);
  const side = common.assertOrderVisible(ctx, order);
  common.assertTestOrderVisible(ctx, order);
  if (side === 'ADMIN') {
    throw errors.forbidden('后台请通过开发者只读视角查看原图');
  }
  const images = common.orderImagesOf(order);
  if (images.length === 0 || index >= images.length) {
    throw errors.notFound('该订单没有可查看的截图');
  }
  const image = images[index] || {};
  // 批 5 契约 E：截图已被 cleanup 按隐私策略清理（cleanup 写该张图片 cleanedAt）→ NOT_FOUND，
  // 不向任何人再签发 URL；文案说明原因与保留口径（完成/取消 7 天后清理，CONTRACT D18/隐私指引）。
  if (image.cleanedAt) {
    throw errors.notFound('截图已按隐私策略删除（完成/取消 7 天后）');
  }
  const fileId = typeof image.fileId === 'string' ? image.fileId : '';
  if (!fileId) {
    throw errors.notFound('该订单没有可查看的截图');
  }
  const url = await signTempUrl(ctx, fileId);
  return {
    url,
    index,
    expiresAt: new Date(common.nowMsOf(ctx) + URL_TTL_SECONDS * 1000).toISOString()
  };
};
