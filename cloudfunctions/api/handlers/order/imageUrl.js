// handlers/order/imageUrl.js · order.imageUrl({orderNo,kind,index})：鉴权后签发 5 分钟临时 URL
// 口径：CONTRACT §5.3 / §4.1（D97/D98：kind ∈ {TICKET,DELIVERY,PICK}，缺省 TICKET 向后兼容）。
// 完整 L3 影像只在本人订单与开发者只读视角可见；admin 真实会话需走只读视角（审计）。
// v1.0 一单多包裹（D23/D24）：images[] 多张，index 缺省 0；历史单 image{} 归一为单元素数组。
'use strict';

const { errors } = require('../../lib/errors');
const common = require('./_common');

const URL_TTL_SECONDS = 300;
const KINDS = ['TICKET', 'DELIVERY', 'PICK'];

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

// 照片类型：缺省 TICKET（旧客户端零改动）；非法值不静默取第 0 张。
function readKind(payload) {
  const value = payload && typeof payload === 'object' ? payload.kind : undefined;
  if (value === undefined || value === null || value === '') {
    return 'TICKET';
  }
  const text = String(value).trim().toUpperCase();
  if (KINDS.indexOf(text) < 0) {
    throw errors.validation('kind', '照片类型不正确，请刷新页面后重试');
  }
  return text;
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

function textOf(value) {
  return typeof value === 'string' ? value : '';
}

// 现场照片：PICK 优先逐件（index 命中 parcels[i].pickProof），其次整单；DELIVERY 只取整单。
function proofImageOf(order, kind, index) {
  if (kind === 'PICK' && Array.isArray(order && order.parcels)) {
    const parcel = order.parcels[index];
    if (parcel && parcel.pickProof) {
      return parcel.pickProof;
    }
  }
  return kind === 'DELIVERY' ? (order && order.deliveryProof) : (order && order.pickProof);
}

function proofNotFoundText(kind) {
  return kind === 'DELIVERY' ? '该订单没有可查看的送达照片' : '该订单没有可查看的取件照片';
}

module.exports = async function orderImageUrl(ctx, payload) {
  const orderNo = common.normalizeOrderNoInput(payload && payload.orderNo);
  const kind = readKind(payload);
  const index = readImageIndex(payload);
  const order = await common.getOrderByNo(ctx, orderNo);
  // D85：转派发起者保留控制权（含查看本单照片）；普通越权仍 FORBIDDEN
  let side = common.orderSideOf(ctx, order);
  if (!side) {
    side = await common.resolveOrderSide(ctx, order);
  }
  if (!side) {
    throw errors.forbidden('无权查看该订单');
  }
  common.assertTestOrderVisible(ctx, order);
  if (side === 'ADMIN') {
    throw errors.forbidden('后台请通过开发者只读视角查看原图');
  }
  let image = null;
  if (kind === 'TICKET') {
    const images = common.orderImagesOf(order);
    if (images.length === 0 || index >= images.length) {
      throw errors.notFound('该订单没有可查看的截图');
    }
    image = images[index] || {};
  } else {
    image = proofImageOf(order, kind, index) || {};
  }
  // 批 5 契约 E：影像已被 cleanup 按隐私策略清理（写 cleanedAt）→ NOT_FOUND，不向任何人再签发 URL。
  if (image.cleanedAt) {
    throw errors.notFound(kind === 'TICKET'
      ? '截图已按隐私策略删除（完成/取消 7 天后）'
      : '照片已按隐私策略删除（完成/取消 7 天后）');
  }
  const fileId = textOf(image.fileId);
  if (!fileId) {
    throw errors.notFound(kind === 'TICKET' ? '该订单没有可查看的截图' : proofNotFoundText(kind));
  }
  const url = await signTempUrl(ctx, fileId);
  return {
    url,
    kind,
    index,
    expiresAt: new Date(common.nowMsOf(ctx) + URL_TTL_SECONDS * 1000).toISOString()
  };
};
