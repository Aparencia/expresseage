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

// 入参白名单（DATA_MODEL §12 #12）：不认识的顶层/条目字段一律 VALIDATION_FAILED 并回 data.field，
// 不做"静默忽略"——否则未知键会被悄悄丢弃，掩盖客户端契约漂移（零金额口径：交易类字段同样不得入库）。
const CREATE_FIELDS = ['parcel', 'serviceCode', 'appoint', 'note', 'ticket', 'image', 'recognition', 'guest', 'bindingId', 'batchActionId'];
const BATCH_ITEM_FIELDS = ['parcel', 'serviceCode', 'appoint', 'note', 'guest', 'recognition'];
const CREATE_BATCH_FIELDS = ['items', 'ticket', 'image', 'recognition', 'batchActionId', 'bindingId'];

function assertKnownFields(input, allowed) {
  const value = parcelUtil.isPlainObject(input) ? input : {};
  const unknown = Object.keys(value).filter((key) => allowed.indexOf(key) < 0);
  if (unknown.length > 0) {
    throw errors.validation(unknown[0], '请求包含不认识的字段，请刷新页面后重试');
  }
  return value;
}

// 订单号取号必须在同一事务内（counters 原子自增 + orders.orderNo 唯一索引兜底）
function nextOrderNosOf() {
  return idGenerator.nextOrderNos;
}

async function loadConfigOf(ctx) {
  const config = await common.loadConfig(ctx);
  return config || {};
}

// 下单上下文：顾客=资料完整+ACTIVE 绑定；兼职=ACTIVE+接单开关；真实×测试双方必须同侧
// 兼职代客（批 7）：bindingId（已绑定顾客，走正常订单）与 guest（新顾客）二选一；
// 绑定顾客的身份/dorm/phoneTail 在上下文里一次性定好，逐单字段组装复用（不写 bindings）。
async function prepareCustomerContext(ctx, scope, config, now) {
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

async function preparePartnerContext(ctx, scope, config, now, selector, bindingId) {
  const partner = await common.loadWritablePartner(ctx);
  parcelUtil.assertAcceptingOrders(partner);
  const partnerUser = await common.getUser(ctx, partner.openid);
  const base = {
    scope,
    config,
    now,
    mode: 'PARTNER',
    partner,
    isTest: !!(partnerUser && partnerUser.isTestAccount),
    impersonatedBy: scope.impersonatedBy
  };
  if (selector !== 'BOUND') {
    return Object.assign(base, {
      customerMode: 'GUEST',
      customerId: '',
      customerNo: '',
      customer: null,
      binding: null,
      dorm: null,
      phoneTail: ''
    });
  }
  const bound = await common.loadBoundCustomer(ctx, partner, bindingId);
  if (!common.isSameTestSide(bound.customerIsTest, base.isTest)) {
    throw errors.forbidden('测试账号与真实账号不能互相下单');
  }
  return Object.assign(base, parcelUtil.boundCustomerContext(bound, base.isTest));
}

async function prepareContext(ctx, payload) {
  common.assertWritable(ctx);
  const scope = common.scopeOf(ctx);
  const input = parcelUtil.isPlainObject(payload) ? payload : {};
  const bindingId = parcelUtil.readBindingId(input);
  const selector = parcelUtil.assertCreateSelector(scope.role, bindingId, parcelUtil.hasGuestField(input));
  const config = await loadConfigOf(ctx);
  const now = common.nowMsOf(ctx);
  if (scope.role === enums.ROLES.CUSTOMER) {
    return prepareCustomerContext(ctx, scope, config, now);
  }
  if (scope.role === enums.ROLES.PARTNER) {
    return preparePartnerContext(ctx, scope, config, now, selector, bindingId);
  }
  throw errors.forbidden('仅顾客或兼职可以下单');
}

// 单条下单字段（batch 的 items[i] 与 create 的顶层同构）
// fallbackSource = AI 兜底被采纳的来源（recognition.source；仅 parcel 未显式给 recognitionSource 时生效）
function buildItemFields(context, item, fallbackSource) {
  const input = parcelUtil.isPlainObject(item) ? item : {};
  const parcel = parcelUtil.normalizeParcel(input.parcel, fallbackSource);
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
  // 绑定顾客代客单：身份/地址/尾号全部来自绑定上下文，与顾客本人下单同构（顾客可见进度）。
  if (context.customerMode === 'BOUND') {
    parcelUtil.assertServiceRange(context.partner, context.dorm.zone);
    return {
      parcel,
      service,
      appoint,
      note,
      dorm: context.dorm,
      guest: null,
      phoneTail: context.phoneTail
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

function recognitionOf(input) {
  return parcelUtil.isPlainObject(input && input.recognition) ? input.recognition : {};
}

function failureNoOf(input) {
  const recognition = recognitionOf(input);
  if (typeof recognition.failureId === 'string' && recognition.failureId) {
    return recognition.failureId;
  }
  const image = parcelUtil.isPlainObject(input && input.image) ? input.image : {};
  if (typeof image.failureId === 'string' && image.failureId) {
    return image.failureId;
  }
  return '';
}

// 逐单失败记录号：items[i].recognition.failureId 优先；顶层 recognition.failureId 只作为 item0 的回退
//（CONTRACT §4.3 / DATA_MODEL §4.9：同图多单按单调用 ai.parseParcel，各单 failureId 独立）。
function itemFailureNo(item, payload, index) {
  const own = failureNoOf(item || {});
  if (own) {
    return own;
  }
  return index === 0 ? failureNoOf(payload || {}) : '';
}

// 逐单识别来源回退：item 级 recognition.source 优先，顶层只回退给 item0（非法/缺失返回 ''，不猜）。
function itemRecognitionSource(item, payload, index) {
  const own = parcelUtil.normalizeRecognitionSource(recognitionOf(item || {}).source);
  if (own) {
    return own;
  }
  return index === 0 ? parcelUtil.normalizeRecognitionSource(recognitionOf(payload || {}).source) : '';
}

// 识别失败关联：只接受本人上传的失败记录；失效/非本人不阻断下单，只丢关联
async function resolveFailureByNo(ctx, failureNo, context) {
  if (!failureNo || !enums.FAILURE_NO_PATTERN.test(failureNo)) {
    return null;
  }
  const record = await ctx.dao.findOne(COLLECTIONS.RECOGNITION_FAILURES, { where: { failureNo } });
  if (!record || record.uploaderOpenid !== context.scope.openid) {
    return null;
  }
  return record;
}

async function resolveFailureRecord(ctx, payload, context) {
  return resolveFailureByNo(ctx, failureNoOf(payload), context);
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

// 幂等键归属（§4.7/§4.8 块 A）：顾客本人与绑定顾客代客单用 customerId，guest 单用 partnerId。
function requestOwnerOf(context) {
  return context.customerId ? context.customerId : String(context.partner._id);
}

function buildRequestKey(context, clientRequestId, itemIndex) {
  const base = requestOwnerOf(context) + ':' + clientRequestId;
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
  return ctx.dao.findOne(COLLECTIONS.ORDERS, { where: { requestKey } });
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

async function createOne(ctx, payload) {
  assertKnownFields(payload, CREATE_FIELDS);
  // 批量分组标识按统一形态闸校验后再落库（DATA_MODEL §4.1：≤32 随机；不静默接收任意客户端串）。
  const batchActionId = common.readBatchActionId(payload);
  const context = await prepareContext(ctx, payload);
  const clientRequestId = ctx.clientRequestId || '';
  const fields = buildItemFields(context, payload, itemRecognitionSource(null, payload, 0));
  const imageCtx = await prepareImage(ctx, payload, context);
  const failureRecord = await resolveFailureRecord(ctx, payload, context);
  const requestKey = buildRequestKey(context, clientRequestId);
  const existing = await findExistingByRequestKey(ctx, requestKey);
  if (existing) {
    // 回放侧别按调用方模式取（guest 单两侧 customerId 都是 ''、绑定单两侧都是顾客 id，
    // 用 customerId 相等判侧会把代客单回放成顾客视图：guest=null + 顾客动作条）。
    return { orderNo: existing.orderNo, order: await dto.buildOrderDto(ctx, existing, { side: context.mode }), duplicated: true };
  }
  const nowDate = common.toDate(context.now);
  const image = buildImageSnapshot(imageCtx.image, imageCtx.ticket, failureRecord, nowDate);
  const nextOrderNos = nextOrderNosOf();
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
        batchActionId
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
  assertKnownFields(payload, CREATE_BATCH_FIELDS);
  const batchActionId = common.readBatchActionId(payload);
  const context = await prepareContext(ctx, payload);
  const clientRequestId = ctx.clientRequestId || '';
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (items.length < 1 || items.length > MAX_BATCH) {
    throw errors.validation('items', '一图多码最多拆 ' + MAX_BATCH + ' 单');
  }
  items.forEach((item) => {
    assertKnownFields(item, BATCH_ITEM_FIELDS);
  });
  // 条目级二选一（批 7）：顾客单/绑定顾客批量都不得再给 items[i].guest（整批不建）。
  parcelUtil.assertBatchGuestFields(context, items);
  const fieldsList = items.map((item, index) => buildItemFields(context, item, itemRecognitionSource(item, payload, index)));
  const imageCtx = await prepareImage(ctx, payload, context);
  // 逐单失败记录（items[i].recognition.failureId；顶层 recognition.failureId 只回退 item0）：
  // 非法形态/非本人一律静默丢关联（不阻断建单），每单 image.failureId 只写本单自己的记录 _id。
  const failureRecords = [];
  for (let i = 0; i < items.length; i += 1) {
    failureRecords.push(await resolveFailureByNo(ctx, itemFailureNo(items[i], payload, i), context));
  }
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
  const images = failureRecords.map((record) => buildImageSnapshot(imageCtx.image, imageCtx.ticket, record, nowDate));
  const nextOrderNos = nextOrderNosOf();
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
          image: images[i],
          clientRequestId,
          nowDate,
          batchActionId
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
  // 事务后逐单回填：每条记录只回填它自己那张单的 orderId/fileId（已回填的不覆盖，重放/复用不串）
  const associations = created.map((order, index) => ({ record: failureRecords[index], order }));
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
  createOne,
  createBatch
};
