// handlers/order/_dto.js · 订单视图模型（本人完整；admin 真实会话走脱敏投影，完整 L3 只经只读视角）
// 规则：不返回 _id/partnerId/openid/clientRequestId/requestKey/batchActionId/cloudPath；
//       isTest/impersonatedBy 仅测试写会话可见；对方昵称头像只在「当前 ACTIVE 绑定」内现查，不落订单快照。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const enums = require('../../shared/enums');
const orderState = require('../../shared/order-state');
const orderView = require('../../shared/order-view');
const time = require('../../lib/time');
const mask = require('../../db/dto/mask');
const { recognitionSourceLabel } = require('../../lib/ai/parse');

const ACTION_LABELS = Object.freeze({
  accept: '接单',
  reject: '拒单',
  pick: '标记已取件',
  undoPick: '撤销已取件',
  deliver: '标记已送达',
  undoDeliver: '撤销已送达',
  exception: '上报异常',
  resolve: '解除异常',
  correct: '改取件码',
  cancel: '取消订单',
  confirm: '确认已收到',
  deleteRecord: '删除这条记录',
  reorder: '再次下单',
  message: '留言'
});

// 时间归一：只接受 number/Date/非空字符串；null/undefined/'' 一律视为「没有这个时间」。
// 不能直接调 lib/time.toMs 兜底：它对非 number/Date 返回 Date.now()，会把「已清空的时间戳」序列化成
// 当前真实时钟（撤销后 deliveredAt/pickedAt 变成看起来刚发生的时间），列表/详情出现假时间。
function isoOf(value) {
  const ms = msOf(value);
  return ms > 0 ? new Date(ms).toISOString() : '';
}

function msOf(value) {
  if (typeof value === 'number') {
    return isFinite(value) && value > 0 ? value : 0;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return isFinite(ms) && ms > 0 ? ms : 0;
  }
  if (typeof value === 'string' && value !== '') {
    const ms = time.toMs(value);
    return isFinite(ms) && ms > 0 ? ms : 0;
  }
  return 0;
}

function textOf(value) {
  return typeof value === 'string' ? value : '';
}

function numberOrZero(value) {
  return typeof value === 'number' && isFinite(value) ? value : 0;
}

function codeTextOf(code) {
  const hit = enums.EXCEPTION_CODES.filter((item) => item.code === code)[0];
  return hit ? hit.text : '';
}

function sameId(left, right) {
  if (left === undefined || left === null || right === undefined || right === null) {
    return false;
  }
  return String(left) === String(right);
}

async function loadPartnerById(ctx, partnerId) {
  if (partnerId === undefined || partnerId === null || partnerId === '') {
    return null;
  }
  return ctx.dao.get(COLLECTIONS.PARTNERS, partnerId);
}

async function loadActiveBinding(ctx, customerId) {
  if (!customerId) {
    return null;
  }
  return ctx.dao.findOne(COLLECTIONS.BINDINGS, {
    where: { customerId, status: enums.BINDING_STATUS.ACTIVE }
  });
}

// 对方公开资料：仅「当前 ACTIVE 绑定关系」内下发昵称与头像（解绑/停用/注销后不返回）
async function resolveCounterpart(ctx, order, side) {
  if (!order) {
    return null;
  }
  if (side === 'CUSTOMER') {
    const binding = await loadActiveBinding(ctx, order.customerId);
    if (!binding || !sameId(binding.partnerId, order.partnerId)) {
      return null;
    }
    const partner = await loadPartnerById(ctx, order.partnerId);
    if (!partner || partner.status !== enums.PARTNER_STATUS.ACTIVE || partner.deletedAt) {
      return null;
    }
    const out = { displayName: textOf(partner.displayName) };
    if (partner.avatarFileId) {
      out.avatarFileId = partner.avatarFileId;
    }
    return out;
  }
  if (side === 'PARTNER' && order.customerId) {
    const binding = await loadActiveBinding(ctx, order.customerId);
    if (!binding || !sameId(binding.partnerId, order.partnerId)) {
      return null;
    }
    const customer = await ctx.dao.get(COLLECTIONS.CUSTOMERS, order.customerId);
    if (!customer) {
      return null;
    }
    const out = { displayName: textOf(customer.displayName) };
    if (customer.avatarFileId) {
      out.avatarFileId = customer.avatarFileId;
    }
    return out;
  }
  return null;
}

function buildParcelDto(order) {
  const parcel = (order && order.parcel) || {};
  const codeStatus = parcel.codeStatus === enums.CODE_STATUS.NEED_CODE
    ? enums.CODE_STATUS.NEED_CODE
    : enums.CODE_STATUS.OK;
  const source = textOf(parcel.recognitionSource) || enums.RECOGNITION_SOURCE.RULE;
  return {
    stationId: textOf(parcel.stationId),
    stationName: textOf(parcel.stationName),
    pickupCode: textOf(parcel.pickupCode),
    lockerNo: textOf(parcel.lockerNo),
    trackingTail: textOf(parcel.trackingTail),
    codeStatus,
    codeStatusText: enums.CODE_STATUS_TEXT[codeStatus],
    recognitionSource: source,
    recognitionSourceLabel: recognitionSourceLabel(source),
    confidence: textOf(parcel.confidence)
  };
}

// 截图可见性（批 5 契约 B）：cleaned=已按隐私策略清理（cleanup 写 image.cleanedAt）；
// hasImage=有 fileId 且未被清理。只读投影——DTO 不清理、不改写订单，清理只由 cleanup 任务执行。
function buildImageDto(order) {
  const image = (order && order.image) || {};
  const cleaned = !!image.cleanedAt;
  return {
    hasImage: typeof image.fileId === 'string' && image.fileId !== '' && !cleaned,
    cleaned
  };
}

function buildDormDto(dorm) {
  if (!dorm || typeof dorm !== 'object') {
    return null;
  }
  return {
    zone: textOf(dorm.zone),
    buildingNo: numberOrZero(dorm.buildingNo),
    buildingText: textOf(dorm.buildingText),
    room: textOf(dorm.room),
    dormKey: textOf(dorm.dormKey),
    roomTag: textOf(dorm.roomTag)
  };
}

function buildGuestDto(guest) {
  if (!guest || typeof guest !== 'object') {
    return null;
  }
  return {
    displayName: textOf(guest.displayName),
    phoneTail: textOf(guest.phoneTail),
    zone: textOf(guest.zone),
    buildingNo: numberOrZero(guest.buildingNo),
    buildingText: textOf(guest.buildingText),
    room: textOf(guest.room),
    dormKey: textOf(guest.dormKey)
  };
}

function buildExceptionDto(exception) {
  if (!exception || typeof exception !== 'object') {
    return null;
  }
  return {
    code: textOf(exception.code),
    codeText: codeTextOf(exception.code),
    text: textOf(exception.text),
    fromStatus: textOf(exception.fromStatus),
    by: textOf(exception.by),
    at: isoOf(exception.at)
  };
}

function buildAppointDto(appoint) {
  const input = appoint && typeof appoint === 'object' ? appoint : {};
  const type = input.type === enums.APPOINT_TYPE.SLOT ? enums.APPOINT_TYPE.SLOT : enums.APPOINT_TYPE.ASAP;
  return {
    type,
    typeText: enums.APPOINT_TYPE_TEXT[type],
    startAt: isoOf(input.startAt),
    endAt: isoOf(input.endAt)
  };
}

function pushAction(list, key) {
  list.push({ key, label: ACTION_LABELS[key] || '' });
}

function withinUndoWindow(value, nowMs) {
  const ms = msOf(value);
  if (!ms) {
    return false;
  }
  return nowMs - ms <= orderState.UNDO_WINDOW_MS && nowMs >= ms;
}

// 底部动作条：由服务端按状态机 + 身份给出（页面只渲染，不自行判断状态机）
// 顾客侧矩阵（CONTRACT §5 状态表 / UX_CUSTOMER §5.4）：SUBMITTED/ACCEPTED 取消+留言；PICKED 仅留言；
// DELIVERED 确认已收到+留言；COMPLETED 删除记录(未软删时)+再次下单；CANCELLED 再次下单；
// EXCEPTION 留言 +（canCustomerCancel 时）取消。终态只读归档，不再给 message（留言矩阵 §5.4）。
function pushMessageIfOpen(actions, status) {
  if (!orderState.isTerminal(status)) {
    pushAction(actions, 'message');
  }
}

function buildCustomerActions(actions, order) {
  const status = order.status;
  if (status === enums.ORDER_STATUS.SUBMITTED || status === enums.ORDER_STATUS.ACCEPTED) {
    pushAction(actions, 'cancel');
    pushMessageIfOpen(actions, status);
  } else if (status === enums.ORDER_STATUS.PICKED) {
    pushMessageIfOpen(actions, status);
  } else if (status === enums.ORDER_STATUS.DELIVERED) {
    pushAction(actions, 'confirm');
    pushMessageIfOpen(actions, status);
  } else if (status === enums.ORDER_STATUS.COMPLETED) {
    if (!order.deletedByCustomerAt) {
      pushAction(actions, 'deleteRecord');
    }
    pushAction(actions, 'reorder');
  } else if (status === enums.ORDER_STATUS.CANCELLED) {
    pushAction(actions, 'reorder');
  } else if (status === enums.ORDER_STATUS.EXCEPTION) {
    pushMessageIfOpen(actions, status);
    if (orderState.canCustomerCancel(order)) {
      pushAction(actions, 'cancel');
    }
  }
}

function buildActions(order, side, nowMs) {
  const actions = [];
  const status = order.status;
  if (side === 'PARTNER') {
    if (status === enums.ORDER_STATUS.SUBMITTED) {
      pushAction(actions, 'accept');
      pushAction(actions, 'reject');
      pushAction(actions, 'correct');
      pushAction(actions, 'cancel');
    } else if (status === enums.ORDER_STATUS.ACCEPTED) {
      pushAction(actions, 'pick');
      pushAction(actions, 'exception');
      pushAction(actions, 'correct');
      pushAction(actions, 'cancel');
    } else if (status === enums.ORDER_STATUS.PICKED) {
      pushAction(actions, 'deliver');
      if (withinUndoWindow(order.pickedAt, nowMs)) {
        pushAction(actions, 'undoPick');
      }
      pushAction(actions, 'exception');
      pushAction(actions, 'correct');
      pushAction(actions, 'cancel');
    } else if (status === enums.ORDER_STATUS.DELIVERED) {
      if (withinUndoWindow(order.deliveredAt, nowMs)) {
        pushAction(actions, 'undoDeliver');
      }
      pushAction(actions, 'exception');
      // DELIVERED 及之后不可补码（DATA_MODEL §7.5 order.correct 起始状态不含 DELIVERED / UX §4.4），
      // 动作条只下发状态机允许的动作，页面不再展示必然失败的按钮。
      pushAction(actions, 'cancel');
    } else if (status === enums.ORDER_STATUS.EXCEPTION) {
      pushAction(actions, 'resolve');
      pushAction(actions, 'correct');
      pushAction(actions, 'cancel');
    }
    // 兼职侧沿用现有键；终态（COMPLETED/CANCELLED）不再给 message（只读归档）
    pushMessageIfOpen(actions, status);
  } else if (side === 'CUSTOMER') {
    buildCustomerActions(actions, order);
  }
  return actions;
}

// admin 真实会话：默认脱敏（不返回完整 L3、不展示头像、昵称脱敏；完整 L3 只经只读视角）
function applyAdminMask(dto, counterpart) {
  dto.parcel.pickupCode = mask.maskPickupCode(dto.parcel.pickupCode);
  dto.phoneTail = mask.maskPhoneTail(dto.phoneTail);
  if (dto.dorm) {
    dto.dorm = {
      zone: dto.dorm.zone,
      buildingNo: dto.dorm.buildingNo,
      buildingText: mask.maskDorm(dto.dorm),
      room: '',
      dormKey: '',
      roomTag: ''
    };
  }
  if (dto.guest) {
    dto.guest = {
      displayName: mask.maskDisplayName(dto.guest.displayName),
      phoneTail: mask.maskPhoneTail(dto.guest.phoneTail),
      zone: dto.guest.zone,
      buildingNo: dto.guest.buildingNo,
      buildingText: mask.maskDorm(dto.guest),
      room: '',
      dormKey: ''
    };
  }
  dto.counterpart = counterpart
    ? { displayName: mask.maskDisplayName(counterpart.displayName) }
    : null;
}

/**
 * 订单视图模型。
 * @param {object} ctx handler 上下文
 * @param {object} order orders 文档
 * @param {{side?: string, withCounterpart?: boolean, withActions?: boolean}} options
 */
async function buildOrderDto(ctx, order, options) {
  const opts = options || {};
  const side = opts.side || '';
  const withActions = opts.withActions !== false;
  const withCounterpart = opts.withCounterpart !== false;
  const identity = (ctx && ctx.identity) || {};
  const isTestWrite = identity.viewMode === enums.VIEW_MODE.TEST_WRITE;
  const nowMs = time.toMs(ctx && ctx.now);
  const status = textOf(order.status);
  const counterpart = withCounterpart && side !== 'ADMIN'
    ? await resolveCounterpart(ctx, order, side)
    : null;
  const dto = {
    orderNo: textOf(order.orderNo),
    status,
    statusText: orderState.statusText(status),
    bucket: orderView.bucketOf(status),
    progressIndex: orderState.progressIndex(status),
    needCode: (order.parcel || {}).codeStatus === enums.CODE_STATUS.NEED_CODE,
    failureHint: !!(order.image && order.image.failureId),
    source: textOf(order.source),
    service: {
      code: textOf(order.service && order.service.code),
      name: textOf(order.service && order.service.name)
    },
    appoint: buildAppointDto(order.appoint),
    parcel: buildParcelDto(order),
    note: textOf(order.note),
    phoneTail: textOf(order.phoneTail),
    dorm: buildDormDto(order.dorm),
    guest: side === 'PARTNER' ? buildGuestDto(order.guest) : null,
    exception: buildExceptionDto(order.exception),
    deliveryNote: textOf(order.deliveryNote),
    cancelReason: textOf(order.cancelReason),
    cancelReasonText: order.cancelReason ? enums.cancelReasonText(order.cancelReason) : '',
    cancelledBy: textOf(order.cancelledBy),
    cancelledByText: order.cancelledBy ? enums.CANCELLED_BY_LABELS[order.cancelledBy] || '' : '',
    customerNo: textOf(order.customerNo),
    partnerNo: textOf(order.partnerNo),
    image: buildImageDto(order),
    counterpart,
    actions: withActions ? buildActions(order, side, nowMs) : [],
    version: numberOrZero(order.version),
    statusUpdatedAt: isoOf(order.statusUpdatedAt),
    createdAt: isoOf(order.createdAt),
    updatedAt: isoOf(order.updatedAt),
    acceptedAt: isoOf(order.acceptedAt),
    pickedAt: isoOf(order.pickedAt),
    deliveredAt: isoOf(order.deliveredAt),
    completedAt: isoOf(order.completedAt),
    cancelledAt: isoOf(order.cancelledAt),
    deletedByCustomerAt: isoOf(order.deletedByCustomerAt)
  };
  if (side === 'ADMIN') {
    applyAdminMask(dto, counterpart);
    dto.actions = [];
  }
  if (isTestWrite) {
    dto.isTest = order.isTest === true;
    dto.impersonatedBy = textOf(order.impersonatedBy);
  }
  return dto;
}

// 裁剪事件：type/at/actorRole/note（去 actorId/payload）
function buildEventDtos(events) {
  const list = Array.isArray(events) ? events : [];
  return list.map((event) => ({
    type: textOf(event.type),
    at: isoOf(event.at),
    actorRole: textOf(event.actorRole),
    note: textOf(event.note)
  }));
}

async function buildOrderDtos(ctx, orders, side, options) {
  const list = Array.isArray(orders) ? orders : [];
  const opts = Object.assign({ withActions: false, withCounterpart: false }, options || {});
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    out.push(await buildOrderDto(ctx, list[i], Object.assign({ side }, opts)));
  }
  return out;
}

module.exports = {
  ACTION_LABELS,
  isoOf,
  msOf,
  buildOrderDto,
  buildOrderDtos,
  buildEventDtos,
  buildParcelDto,
  buildActions,
  sameId
};
