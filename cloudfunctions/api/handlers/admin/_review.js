// handlers/admin/_review.js · 识别失败复核共用件（上传者脱敏信息 / 关联订单号 / 站内通知）
// 口径：DATA_MODEL §2.14、ENGINEERING §4.10.6；通知只写站内消息（订阅消息 P1），不含原图/失败码细节。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const time = require('../../lib/time');

const NOTIFY_TEMPLATE = 'RECOGNITION_REVIEW';
const NOTIFY_TEXT = '你的截图识别失败，开发者已处理；如需补充取件码，请到订单页面手动填写。';

async function loadUploader(scope, record) {
  const openid = record && record.uploaderOpenid ? record.uploaderOpenid : '';
  const result = { openid: openid, no: '', displayName: '' };
  if (!openid) {
    return result;
  }
  if (record.sourceRole === 'CUSTOMER') {
    const customer = await scope.dao.get(COLLECTIONS.CUSTOMERS, openid);
    if (customer) {
      result.no = customer.customerNo || '';
      result.displayName = customer.displayName || '';
    }
    return result;
  }
  const partner = await scope.dao.findOne(COLLECTIONS.PARTNERS, { where: { openid: openid } });
  if (partner) {
    result.no = partner.partnerNo || '';
    result.displayName = partner.displayName || '';
  }
  return result;
}

async function orderNoOf(scope, record) {
  if (!record || !record.orderId) {
    return '';
  }
  const order = await scope.dao.get(COLLECTIONS.ORDERS, record.orderId);
  return order ? order.orderNo || '' : '';
}

// 同一记录同日重复通知幂等（只发一条）；无关联订单时不写站内消息。
async function notifyUploader(scope, record, failureNo) {
  if (!record || !record.orderId) {
    return false;
  }
  const today = time.dayKey(scope.now);
  const rows = await scope.dao.find(COLLECTIONS.ORDER_MESSAGES, {
    where: { orderId: record.orderId, templateCode: NOTIFY_TEMPLATE },
    limit: 20
  });
  const existed = rows.some((row) => time.dayKey(time.toMs(row.createdAt)) === today);
  if (existed) {
    return true;
  }
  await scope.dao.add(COLLECTIONS.ORDER_MESSAGES, {
    orderId: record.orderId,
    fromRole: record.sourceRole || 'CUSTOMER',
    fromId: 'SYSTEM',
    text: NOTIFY_TEXT,
    templateCode: NOTIFY_TEMPLATE,
    referenceNo: failureNo || '',
    createdAt: scope.nowDate,
    readAt: null
  });
  return true;
}

module.exports = {
  NOTIFY_TEMPLATE,
  NOTIFY_TEXT,
  loadUploader,
  orderNoOf,
  notifyUploader
};
