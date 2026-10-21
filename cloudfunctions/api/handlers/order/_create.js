// handlers/order/_create.js · 下单引擎（order.create / order.createBatch 共用）
// 口径：DATA_MODEL §4.8 块 A / §7.5；一张截图可拆 ≤5 单（单事务原子创建）；代客单不写 bindings。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const orderState = require('../../shared/order-state');
const idGenerator = require('../../lib/id-generator');
const { errors } = require('../../lib/errors');
const common = require('./_common');
const parcelUtil = require('./_parcel');
const dto = require('./_dto');

const MAX_BATCH = orderState.MAX_CREATE_BATCH;

function nextOrderNosOf(ctx) {
  const api = (ctx && ctx.ids) || {};
  if (typeof api.nextOrderNos === 'function') {
    return api.nextOrderNos;
  }
  return idGenerator.nextOrderNos;
}

async function loadConfigOf(ctx) {
  const config = await common.loadConfig(ctx);
  return config || {};
}

// 下单上下文：顾客=资料完整+ACTIVE 绑定；兼职=ACTIVE+接单开关；真实×测试双方必须同侧
async function prepareContext(ctx) {
  common.assertWritable(ctx);
  const scope = common.scopeOf(ctx);
  const config = await loadConfigOf(ctx);
  const now = common.nowMsOf(ctx);
  if (scope.role === enums.ROLES.CUSTOMER) {
    const customerId = common.customerScope(ctx);
    const customer = await common.getCustomerByOpenid(ctx, customerId);
    if (!customer || customer.profileCompleted !== true) {
      throw errors.invalidState('请先完善个人资料（苑/栋/宿舍号/昵称）');
    }
    const binding = await common.getActiveBinding(ctx, customerId);
    if (!binding) {
      throw errors.invalidState('还没有绑定兼职，请先在绑定页输入兼职编号完成绑定');
    }
    const partner = await common.getPartnerById(ctx, binding.partnerId);
    parcelUtil.assertPartnerOpen(partner);
    parcelUtil.assertAcceptingOrders(partner);
    const customerUser = await common.getUser(ctx, customerId);
    const partnerUser = await common.getUser(ctx, partner.openid);
    const customerIsTest = !!(customerUser && customerUser.isTestAccount);
    const partnerIsTest = !!(partnerUser && partnerUser.isTestAccount);
    if (!common.isSameTestSide(customerIsTest, partnerIsTest)) {
      throw errors.forbidden('测试账号与真实账号不能互相下单');
    }
    return {
      scope,
      config,
      now,
      mode: 'CUSTOMER',
      customerId,
      customerNo: typeof customer.customerNo === 'string' ? customer.customerNo : '',
      customer,
      binding,
      partner,
      dorm: parcelUtil.customerDorm(customer, binding.roomTag),
      isTest: customerIsTest,
      impersonatedBy: scope.impersonatedBy
    };
  }
  if (scope.role === enums.ROLES.PARTNER) {
    const partner = await common.loadWritablePartner(ctx);
    parcelUtil.assertAcceptingOrders(partner);
    const partnerUser = await common.getUser(ctx, partner.openid);
    return {
      scope,
      config,
      now,
      mode: 'PARTNER',
      customerId: '',
      customerNo: '',
      partner,
      isTest: !!(partnerUser && partnerUser.isTestAccount),
      impersonatedBy: scope.impersonatedBy
    };
  }
  throw errors.forbidden('仅顾客或兼职可以下单');
}

// 单条下单字段（batch 的 items[i] 与 create 的顶层同构）
function buildItemFields(context, item) {
  const input = parcelUtil.isPlainObject(item) ? item : {};
  const parcel = parcelUtil.normalizeParcel(input.parcel);
  const service = parcelUtil.pickService(context.config, context.partner, input.serviceCode);
  const appoint = parcelUtil.normalizeAppoint(input.appoint, context.now);
  const note = parcelUtil.normalizeOrderNote(input.note);
  if (context.mode === 'CUSTOMER') {
    parcelUtil.assertServiceRange(context.partner, context.dorm.zone);
    return {
      parcel,
      service,
      appoint,
      note,
      dorm: context.dorm,
      guest: null,
      phoneTail: typeof context.customer.phoneTail === 'string' ? context.customer.phoneTail : ''
    };
  }
  const guest = parcelUtil.normalizeGuest(input.guest);
  parcelUtil.assertServiceRange(context.partner, guest.zone);
  return {
    parcel,
    service,
    appoint,
    note,
    dorm: null,
    guest,
    phoneTail: parcelUtil.guestPhoneTail(guest)
  };
}

async function prepareImage(ctx, payload, context) {
  const imageInput = payload.image;
  if (imageInput === undefined || imageInput === null) {
    return { image: null, ticket: null };
  }
  if (!parcelUtil.isPlainObject(imageInput)) {
    throw errors.validation('image', '截图参数不合法，请重新上传');
  }
  const ticketId = typeof payload.ticket === 'string' ? payload.ticket.trim() : '';
  if (!ticketId) {
    throw errors.validation('ticket', '请先上传取件截图');
  }
  const ticket = await common.loadUploadTicket(ctx, ticketId, context.now);
  common.assertImageFile(imageInput, ticket);
  return { image: imageInput, ticket };
}

function failureNoOf(payload) {
  const recognition = parcelUtil.isPlainObject(payload.recognition) ? payload.recognition : {};
  if (typeof recognition.failureId === 'string' && recognition.failureId) {
    return recognition.failureId;
  }
  const image = parcelUtil.isPlainObject(payload.image) ? payload.image : {};
  if (typeof image.failureId === 'string' && image.failureId) {
    return image.failureId;
  }
  return '';
}

// 识别失败关联：只接受本人上传的失败记录；失效/非本人不阻断下单，只丢关联
async function resolveFailureRecord(ctx, payload, context) {
  const failureNo = failureNoOf(payload);
  if (!failureNo || !enums.FAILURE_NO_PATTERN.test(failureNo)) {
    return null;
  }
  const record = await ctx.dao.findOne(COLLECTIONS.RECOGNITION_FAILURES, { where: { failureNo } });
  if (!record || record.uploaderOpenid !== context.scope.openid) {
    return null;
  }
  return record;
}

function buildImageSnapshot(imageInput, ticket, failureRecord, nowDate) {
  if (!imageInput) {
    return null;
  }
  const image = common.buildImageSnapshot(imageInput, ticket, nowDate);
  if (failureRecord) {
    image.failureId = failureRecord._id;
  }
  return image;
}

function buildRequestKey(context, clientRequestId, itemIndex) {
  const owner = context.mode === 'CUSTOMER' ? context.customerId : String(context.partner._id);
  const base = owner + ':' + clientRequestId;
  return typeof itemIndex === 'number' ? base + ':' + itemIndex : base;
}

function buildOrderDocument(options) {
  const opt = options;
  const doc = {
    orderNo: opt.orderNo,
    requestKey: opt.requestKey,
    customerId: opt.context.customerId,
    customerOpenid: opt.context.customerId,
    customerNo: opt.context.customerNo,
    partnerId: opt.context.partner._id,
    partnerOpenid: opt.context.partner.openid,
    partnerNo: typeof opt.context.partner.partnerNo === 'string' ? opt.context.partner.partnerNo : '',
    source: opt.context.mode === 'CUSTOMER' ? enums.ORDER_SOURCE.CUSTOMER : enums.ORDER_SOURCE.PARTNER,
    isTest: opt.context.isTest === true,
    impersonatedBy: opt.context.impersonatedBy || '',
    status: enums.ORDER_STATUS.SUBMITTED,
    parcel: opt.fields.parcel,
    dorm: opt.fields.dorm,
    guest: opt.fields.guest,
    phoneTail: opt.fields.phoneTail,
    service: opt.fields.service,
    appoint: opt.fields.appoint,
    note: opt.fields.note,
    image: opt.image,
    clientRequestId: opt.clientRequestId,
    version: 1,
    createdAt: opt.nowDate,
    updatedAt: opt.nowDate,
    statusUpdatedAt: opt.nowDate
  };
  if (opt.batchActionId) {
    doc.batchActionId = opt.batchActionId;
  }
  return doc;
}

function buildCreatedEvent(order, context, clientRequestId, itemIndex, nowDate) {
  const requestKey = String(order._id) + ':order.create:' + clientRequestId;
  const payload = {
    source: order.source,
    serviceCode: order.service ? order.service.code : '',
    isTest: order.isTest === true
  };
  if (typeof itemIndex === 'number') {
    payload.itemIndex = itemIndex;
  }
  return common.buildEventDocument({
    orderId: order._id,
    orderNo: order.orderNo,
    type: 'ORDER_CREATED',
    fromStatus: '',
    toStatus: enums.ORDER_STATUS.SUBMITTED,
    actorRole: context.scope.role,
    actorId: context.scope.openid,
    impersonatedBy: context.impersonatedBy,
    at: nowDate,
    note: '',
    payload,
    requestKey
  });
}

async function findExistingByRequestKey(ctx, requestKey) {
  return ctx.dao.findOne(COLLECTIONS.orders, { where: { requestKey } });
}

async function backfillFailureRecords(ctx, associations) {
  const list = Array.isArray(associations) ? associations : [];
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    if (!item || !item.record || !item.order) {
      continue;
    }
    const patch = {};
    if (!item.record.orderId) {
      patch.orderId = item.order._id;
    }
    if (!item.record.fileId && item.order.image && item.order.image.fileId) {
      patch.fileId = item.order.image.fileId;
    }
    if (Object.keys(patch).length > 0) {
      await ctx.dao.update(COLLECTIONS.RECOGNITION_FAILURES, item.record._id, patch);
    }
  }
}

// 除首单外不重复关联同一条失败记录（failureId 按单独立，见 DATA_MODEL §4.9）
function imageForItem(image, index) {
  if (!image) {
    return null;
  }
  if (index === 0) {
    return image;
  }
  const copy = Object.assign({}, image);
  delete copy.failureId;
  return copy;
}

async function createOne(ctx, payload) {
  const context = await prepareContext(ctx);
  const clientRequestId = ctx.clientRequestId || '';
  const fields = buildItemFields(context, payload);
  const imageCtx = await prepareImage(ctx, payload, context);
  const failureRecord = await resolveFailureRecord(ctx, payload, context);
  const requestKey = buildRequestKey(context, clientRequestId);
  const existing = await findExistingByRequestKey(ctx, requestKey);
  if (existing) {
    const side = existing.customerId === context.customerId ? 'CUSTOMER' : 'PARTNER';
    return { orderNo: existing.orderNo, order: await dto.buildOrderDto(ctx, existing, { side }), duplicated: true };
  }
  const nowDate = common.toDate(context.now);
  const image = buildImageSnapshot(imageCtx.image, imageCtx.ticket, failureRecord, nowDate);
  const nextOrderNos = nextOrderNosOf(ctx);
  let created = null;
  try {
    created = await ctx.dao.transaction(async (trx) => {
      const orderNos = await nextOrderNos(trx, context.now, 1);
      const doc = buildOrderDocument({
        orderNo: orderNos[0],
        requestKey,
        context,
        fields,
        image,
        clientRequestId,
        nowDate,
        batchActionId: typeof payload.batchActionId === 'string' ? payload.batchActionId : ''
      });
      const added = await trx.add(COLLECTIONS.ORDERS, doc);
      const order = Object.assign({}, doc, { _id: added._id });
      const event = buildCreatedEvent(order, context, clientRequestId, undefined, nowDate);
      await trx.add(COLLECTIONS.ORDER_EVENTS, event);
      if (imageCtx.ticket) {
        await trx.update(COLLECTIONS.UPLOAD_TICKETS, imageCtx.ticket._id, { usedAt: nowDate });
      }
      return order;
    });
  } catch (error) {
    if (ctx.dao.isDuplicateError && ctx.dao.isDuplicateError(error)) {
      const replay = await findExistingByRequestKey(ctx, requestKey);
      if (replay) {
        return { orderNo: replay.orderNo, order: await dto.buildOrderDto(ctx, replay, { side: context.mode }), duplicated: true };
      }
    }
    throw error;
  }
  await backfillFailureRecords(ctx, [{ record: failureRecord, order: created }]);
  const fresh = await common.getOrderById(ctx, created._id);
  return { orderNo: created.orderNo, order: await dto.buildOrderDto(ctx, fresh || created, { side: context.mode }) };
}

async function createBatch(ctx, payload) {
  const context = await prepareContext(ctx);
  const clientRequestId = ctx.clientRequestId || '';
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (items.length < 1 || items.length > MAX_BATCH) {
    throw errors.validation('items', '一图多码最多拆 ' + MAX_BATCH + ' 单');
  }
  const fieldsList = items.map((item) => buildItemFields(context, item));
  const imageCtx = await prepareImage(ctx, payload, context);
  const failureRecord = await resolveFailureRecord(ctx, payload, context);
  const requestKeys = fieldsList.map((unused, index) => buildRequestKey(context, clientRequestId, index));
  const existingList = [];
  for (let i = 0; i < requestKeys.length; i += 1) {
    const existing = await findExistingByRequestKey(ctx, requestKeys[i]);
    existingList.push(existing);
  }
  const existingCount = existingList.filter((item) => !!item).length;
  if (existingCount === requestKeys.length) {
    const orders = await dto.buildOrderDtos(ctx, existingList, context.mode);
    return { orders, duplicated: true };
  }
  if (existingCount > 0) {
    throw errors.conflict('该批次已提交过，请刷新订单列表后重试');
  }
  const nowDate = common.toDate(context.now);
  const image = buildImageSnapshot(imageCtx.image, imageCtx.ticket, failureRecord, nowDate);
  const nextOrderNos = nextOrderNosOf(ctx);
  let created = [];
  try {
    created = await ctx.dao.transaction(async (trx) => {
      const orderNos = await nextOrderNos(trx, context.now, fieldsList.length);
      const orders = [];
      for (let i = 0; i < fieldsList.length; i += 1) {
        const doc = buildOrderDocument({
          orderNo: orderNos[i],
          requestKey: requestKeys[i],
          context,
          fields: fieldsList[i],
          image: imageForItem(image, i),
          clientRequestId,
          nowDate
        });
        const added = await trx.add(COLLECTIONS.ORDERS, doc);
        const order = Object.assign({}, doc, { _id: added._id });
        await trx.add(COLLECTIONS.ORDER_EVENTS, buildCreatedEvent(order, context, clientRequestId, i, nowDate));
        orders.push(order);
      }
      if (imageCtx.ticket) {
        await trx.update(COLLECTIONS.UPLOAD_TICKETS, imageCtx.ticket._id, { usedAt: nowDate });
      }
      return orders;
    });
  } catch (error) {
    if (ctx.dao.isDuplicateError && ctx.dao.isDuplicateError(error)) {
      const ordered = [];
      for (let i = 0; i < requestKeys.length; i += 1) {
        ordered.push(await findExistingByRequestKey(ctx, requestKeys[i]));
      }
      if (ordered.filter((item) => !!item).length === requestKeys.length) {
        return { orders: await dto.buildOrderDtos(ctx, ordered, context.mode), duplicated: true };
      }
    }
    throw error;
  }
  const associations = [{ record: failureRecord, order: created[0] }];
  await backfillFailureRecords(ctx, associations);
  const orderDtos = [];
  for (let i = 0; i < created.length; i += 1) {
    const fresh = await common.getOrderById(ctx, created[i]._id);
    orderDtos.push(await dto.buildOrderDto(ctx, fresh || created[i], { side: context.mode }));
  }
  return { orders: orderDtos };
}

module.exports = {
  prepareContext,
  buildItemFields,
  buildRequestKey,
  MAX_BATCH,
  createOne: order.create,
  createBatch: order.createBatch
};
