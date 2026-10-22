// handlers/order/_create.js · 下单引擎（v1.0 单入口 order.create：一单多包裹 / 多截图 / 本单配送地址 / 无截图手填）
// 口径：CONTRACT v1.0 §4/§4.1/§5.2/§5.3（D23/D24/D25）；DATA_MODEL §4.8/§7.5。
// 一单 1~10 件包裹 + 0~5 张截图；合并窗口内追加同单（PARCELS_APPENDED）。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const idGenerator = require('../../lib/id-generator');
const { errors } = require('../../lib/errors');
const common = require('./_common');
const parcelUtil = require('./_parcel');
const parcelsInput = require('./_parcels-input');
const merge = require('./_merge');
const dto = require('./_dto');

// 入参白名单（DATA_MODEL §12 #12）：不认识字段一律 VALIDATION_FAILED 并回 data.field（不静默忽略）；v1.0 新增多包裹/配送/手填位。
// ticket/image 为旧单图形态兼容位（内部折算为 images[0]/tickets[0]）。
const CREATE_FIELDS = ['parcels', 'images', 'tickets', 'ticket', 'image', 'serviceCode', 'appoint', 'note', 'delivery',
  'guest', 'bindingId', 'manualEntry', 'mergeAppend', 'recognition', 'batchActionId'];

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
// 兼职代客（批 7）：bindingId（已绑定顾客）与 guest 二选一；绑定/代客地址在上下文一次性定好复用。
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
    phoneTail: typeof customer.phoneTail === 'string' ? customer.phoneTail : '',
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
      guest: null,
      phoneTail: ''
    });
  }
  const bound = await common.loadBoundCustomer(ctx, partner, bindingId);
  if (!common.isSameTestSide(bound.customerIsTest, base.isTest)) {
    throw errors.forbidden('测试账号与真实账号不能互相下单');
  }
  return Object.assign(base, parcelUtil.boundCustomerContext(bound, base.isTest));
}

// 双角色下单的动作域角色：带 guest/bindingId → 兼职代客（PARTNER）；否则按顾客本人（CUSTOMER）。
// 单角色保持 identity.role；bindingId 只解释为兼职代客选择器，顾客本人下单不得携带（assertCreateSelector 同口径）。
async function prepareContext(ctx, payload) {
  common.assertWritable(ctx);
  const scope = common.scopeOf(ctx);
  const input = parcelUtil.isPlainObject(payload) ? payload : {};
  const bindingId = parcelUtil.readBindingId(input);
  const guestGiven = parcelUtil.hasGuestField(input);
  const role = parcelUtil.resolveCreateRole(scope, bindingId, guestGiven);
  const selector = parcelUtil.assertCreateSelector(role, bindingId, guestGiven);
  const config = await loadConfigOf(ctx);
  const now = common.nowMsOf(ctx);
  const effectiveScope = Object.assign({}, scope, { role });
  if (role === enums.ROLES.CUSTOMER) {
    return prepareCustomerContext(ctx, effectiveScope, config, now);
  }
  if (role === enums.ROLES.PARTNER) {
    return preparePartnerContext(ctx, effectiveScope, config, now, selector, bindingId);
  }
  throw errors.forbidden('仅顾客或兼职可以下单');
}

// 本单配送地址默认值（D25）：顾客/绑定顾客=其当前宿舍 + 本人手机尾号；代客=guest 地址 + 收件人称呼 + 代客尾号
function defaultDeliveryOf(context) {
  if (context.mode === 'PARTNER' && context.customerMode === 'GUEST') {
    const guest = context.guest || {};
    return {
      zone: guest.zone,
      buildingNo: guest.buildingNo,
      room: guest.room,
      recipientName: guest.displayName || '',
      phoneTail: guest.phoneTail || ''
    };
  }
  const dorm = context.dorm || {};
  return {
    zone: dorm.zone,
    buildingNo: dorm.buildingNo,
    room: dorm.room,
    phoneTail: context.phoneTail || ''
  };
}

// 收件人称呼内容安全（D25）：与 message 域同款 msgSecCheck v2；平台不可用 → DEPENDENCY_FAILED（失败关闭）
async function assertRecipientNameSafe(ctx, delivery) {
  const name = delivery && delivery.recipientName;
  if (!name) {
    return;
  }
  const cloud = ctx.cloud;
  const security = cloud && cloud.openapi && cloud.openapi.security;
  if (!security || typeof security.msgSecCheck !== 'function') {
    return;
  }
  let result = null;
  try {
    result = await security.msgSecCheck({ content: name, version: 2 });
  } catch (error) {
    throw errors.dependencyFailed('内容检测暂时不可用，请稍后再试');
  }
  const errCode = result && typeof result.errCode === 'number' ? result.errCode : 0;
  if (errCode !== 0) {
    throw errors.dependencyFailed('内容检测暂时不可用，请稍后再试');
  }
  const suggest = result && result.result ? result.result.suggest : '';
  if (suggest && suggest !== 'pass') {
    throw errors.validation('recipientName', '收件人称呼包含不适合的内容，请修改后重试');
  }
}

function recognitionFallbackOf(payload) {
  const recognition = parcelUtil.isPlainObject(payload && payload.recognition) ? payload.recognition : {};
  return parcelUtil.normalizeRecognitionSource(recognition.source);
}

function readMergeAppend(input) {
  const value = input && input.mergeAppend;
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throw errors.validation('mergeAppend', '请求参数格式不正确，请刷新页面后重试');
  }
  return value;
}

// 下单入参归一（包裹/截图/配送/服务/预约/备注 + 票据校验 + 内容安全）
async function normalizeOrderInput(ctx, context, payload, now) {
  const input = parcelUtil.isPlainObject(payload) ? payload : {};
  if (context.mode === 'PARTNER' && context.customerMode === 'GUEST') {
    context.guest = parcelUtil.normalizeGuest(input.guest);
  }
  // 先归一 images 再归一 parcels：imageIndex 合法域依赖本批图片数（手填件省略该字段，-1 归一为省略）
  const imageParts = parcelsInput.normalizeImages(input);
  const parcels = parcelsInput.normalizeParcels(input, recognitionFallbackOf(input), imageParts.images.length);
  const manualEntry = parcelsInput.normalizeManualEntry(input, imageParts.images);
  const delivery = parcelsInput.normalizeDelivery(input, defaultDeliveryOf(context));
  await assertRecipientNameSafe(ctx, delivery);
  const service = parcelUtil.pickService(context.config, context.partner, input.serviceCode);
  parcelUtil.assertServiceRange(context.partner, delivery.zone);
  const tickets = [];
  for (let i = 0; i < imageParts.images.length; i += 1) {
    const ticket = await common.loadUploadTicket(ctx, imageParts.images[i].ticket, now);
    common.assertImageFile(imageParts.images[i], ticket);
    tickets.push(ticket);
  }
  return {
    parcels,
    images: imageParts.images,
    tickets,
    manualEntry,
    delivery,
    service,
    appoint: parcelUtil.normalizeAppoint(input.appoint, now),
    note: parcelUtil.normalizeOrderNote(input.note),
    batchActionId: common.readBatchActionId(input),
    mergeAppend: readMergeAppend(input)
  };
}

// 失败记录的来源截图：imageIndex 指向本批 images[]；手填件（未给 imageIndex）在单图批里回退 images[0]。
function failureImageOf(parcel, images) {
  const list = Array.isArray(images) ? images : [];
  const index = typeof parcel.imageIndex === 'number' ? parcel.imageIndex : (list.length === 1 ? 0 : -1);
  return index >= 0 && index < list.length ? list[index] : null;
}

// 失败记录关联（包裹×截图粒度，D23 修订）：只接受本人上传且票据与包裹来源图一致的记录；
// 非法/非本人一律静默丢关联（不阻断下单），落库只保留有效 failureId。
async function resolveFailureAssociations(ctx, context, input) {
  const list = [];
  for (let i = 0; i < input.parcels.length; i += 1) {
    const parcel = input.parcels[i];
    const failureNo = typeof parcel.failureId === 'string' ? parcel.failureId : '';
    if (!failureNo) {
      continue;
    }
    const record = await ctx.dao.findOne(COLLECTIONS.RECOGNITION_FAILURES, { where: { failureNo } });
    const image = failureImageOf(parcel, input.images);
    const ticketMatched = !record || !record.uploadTicketId || (image && record.uploadTicketId === image.ticket);
    if (!record || record.uploaderOpenid !== context.scope.openid || !ticketMatched) {
      delete parcel.failureId;
      continue;
    }
    // 落库关联 id = recognition_failures._id（与旧 orders.image.failureId 口径一致，供清理/复核引用）
    parcel.failureId = record._id;
    // 先记下来源图 fileId：合并追加后 order.images 下标会整体偏移，回填不依赖下标。
    list.push({ parcel, record, fileId: image && image.fileId ? image.fileId : '' });
  }
  return list;
}

async function backfillFailureRecords(ctx, associations, order) {
  for (let i = 0; i < associations.length; i += 1) {
    const item = associations[i];
    if (!item || !item.record || !order) {
      continue;
    }
    const patch = {};
    if (!item.record.orderId) {
      patch.orderId = order._id;
    }
    if (!item.record.fileId && item.fileId) {
      patch.fileId = item.fileId;
    }
    if (Object.keys(patch).length > 0) {
      await ctx.dao.update(COLLECTIONS.RECOGNITION_FAILURES, item.record._id, patch);
    }
  }
}

// 幂等键归属（§4.7/§4.8 块 A）：顾客本人与绑定顾客代客单用 customerId，guest 单用 partnerId。
function requestOwnerOf(context) {
  return context.customerId ? context.customerId : String(context.partner._id);
}

function buildRequestKey(context, clientRequestId) {
  return requestOwnerOf(context) + ':' + clientRequestId;
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
    parcels: opt.input.parcels,
    images: parcelsInput.storedImagesOf(opt.input.images),
    manualEntry: opt.input.manualEntry,
    dorm: opt.context.dorm,
    delivery: opt.input.delivery,
    guest: opt.context.guest || null,
    service: opt.input.service,
    appoint: opt.input.appoint,
    note: opt.input.note,
    clientRequestId: opt.clientRequestId,
    version: 1,
    createdAt: opt.nowDate,
    updatedAt: opt.nowDate,
    statusUpdatedAt: opt.nowDate
  };
  if (opt.input.batchActionId) {
    doc.batchActionId = opt.input.batchActionId;
  }
  return doc;
}

function buildCreatedEvent(order, context, clientRequestId, nowDate) {
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
    payload: {
      source: order.source,
      serviceCode: order.service ? order.service.code : '',
      isTest: order.isTest === true,
      parcels: order.parcels.length,
      images: order.images.length,
      manualEntry: order.manualEntry === true
    },
    requestKey: String(order._id) + ':order.create:' + clientRequestId
  });
}

async function findExistingByRequestKey(ctx, requestKey) {
  return ctx.dao.findOne(COLLECTIONS.ORDERS, { where: { requestKey } });
}

function replayResult(ctx, order, side, merged) {
  return dto.buildOrderDto(ctx, order, { side }).then((orderDto) => ({
    orderNo: order.orderNo,
    order: orderDto,
    merged: merged === true,
    duplicated: true
  }));
}

async function createNewOrder(ctx, context, input, clientRequestId, associations) {
  const nowDate = common.toDate(context.now);
  const nextOrderNos = nextOrderNosOf();
  let created = null;
  try {
    created = await ctx.dao.transaction(async (trx) => {
      const orderNos = await nextOrderNos(trx, context.now, 1);
      const doc = buildOrderDocument({
        orderNo: orderNos[0],
        requestKey: buildRequestKey(context, clientRequestId),
        context,
        input,
        clientRequestId,
        nowDate
      });
      const added = await trx.add(COLLECTIONS.ORDERS, doc);
      const order = Object.assign({}, doc, { _id: added._id });
      const event = buildCreatedEvent(order, context, clientRequestId, nowDate);
      await trx.add(COLLECTIONS.ORDER_EVENTS, event);
      for (let i = 0; i < input.tickets.length; i += 1) {
        await trx.update(COLLECTIONS.UPLOAD_TICKETS, input.tickets[i]._id, { usedAt: nowDate });
      }
      return order;
    });
  } catch (error) {
    if (ctx.dao.isDuplicateError && ctx.dao.isDuplicateError(error)) {
      const replay = await findExistingByRequestKey(ctx, buildRequestKey(context, clientRequestId));
      if (replay) {
        return replayResult(ctx, replay, context.mode, false);
      }
    }
    throw error;
  }
  await backfillFailureRecords(ctx, associations, created);
  const fresh = await common.getOrderById(ctx, created._id);
  const order = fresh || created;
  return { orderNo: order.orderNo, order: await dto.buildOrderDto(ctx, order, { side: context.mode }), merged: false };
}

async function createOne(ctx, payload) {
  const input = assertKnownFields(payload, CREATE_FIELDS);
  const context = await prepareContext(ctx, payload);
  const clientRequestId = ctx.clientRequestId || '';
  const requestKey = buildRequestKey(context, clientRequestId);
  const existing = await findExistingByRequestKey(ctx, requestKey);
  if (existing) {
    return replayResult(ctx, existing, context.mode, false);
  }
  const normalized = await normalizeOrderInput(ctx, context, input, context.now);
  const associations = await resolveFailureAssociations(ctx, context, normalized);
  const replay = await merge.findReplayOrder(ctx, context, clientRequestId);
  if (replay) {
    return replayResult(ctx, await common.getOrderById(ctx, replay._id), context.mode, true);
  }
  const target = await merge.findAppendTarget(ctx, context, normalized, context.now, context.config);
  if (target) {
    const appended = await merge.appendWithRetry(ctx, target, normalized, context, clientRequestId, common.toDate(context.now));
    if (appended) {
      await backfillFailureRecords(ctx, associations, appended.order);
      const fresh = await common.getOrderById(ctx, appended.order._id);
      return {
        orderNo: (fresh || appended.order).orderNo,
        order: await dto.buildOrderDto(ctx, fresh || appended.order, { side: context.mode }),
        merged: true,
        duplicated: appended.duplicated === true
      };
    }
  }
  return createNewOrder(ctx, context, normalized, clientRequestId, associations);
}

module.exports = {
  prepareContext,
  createOne
};
