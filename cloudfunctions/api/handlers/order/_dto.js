// handlers/order/_dto.js · 订单视图模型（本人完整；admin 真实会话走脱敏投影，完整 L3 只经只读视角）
// v1.0 一单多包裹（D23/D24/D25）：parcels[]/images[]/delivery/manualEntry；历史单 parcel{}/image{} 只在本文件归一（不写库）。
// 规则：不返回 _id/partnerId/openid/clientRequestId/requestKey/batchActionId/cloudPath；
//       isTest/impersonatedBy 仅测试写会话可见；对方昵称头像只在「当前 ACTIVE 绑定」内现查，不落订单快照。
// 拆件：对方资料/事件裁剪/admin 脱敏/时间片段在 _dto-party.js（门禁 #18 单文件 ≤500 行），本文件只做动作矩阵与字段装配。
'use strict';

const enums = require('../../shared/enums');
const appointUtil = require('../../shared/appoint');
const orderState = require('../../shared/order-state');
const orderView = require('../../shared/order-view');
const time = require('../../lib/time');
const transfer = require('./_transfer');
const party = require('./_dto-party');
const {
  textOf,
  numberOrZero,
  msOf,
  isoOf,
  buildParcelDto,
  buildParcelDtos,
  buildImageDto,
  buildImageDtos,
  deliveryOf,
  needCodeOf,
  failureHintOf
} = require('./_dto-fields');

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
  message: '留言',
  // D58（批 26）：转派四动作（供订单详情/待接收区渲染，页面零判据）
  requestTransfer: '转派给其他兼职',
  cancelTransfer: '撤回转派',
  acceptTransfer: '确认接收',
  declineTransfer: '拒收'
});

function codeTextOf(code) {
  const hit = enums.EXCEPTION_CODES.filter((item) => item.code === code)[0];
  return hit ? hit.text : '';
}

// v1.0 聚合字段（parcels[]/images[]/delivery/manualEntry）由 _dto-fields 提供，本文件只负责订单视图组装。
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

// 预约 DTO（D47/CONTRACT §5.2）：ASAP → type/typeText/text；LATEST → 另出 latestAt(ISO)+text「最晚 M月D日 HH:MM」；
// 历史 SLOT 单仍输出 startAt/endAt（只读展示，不迁移历史数据，也不允许新单再产生 SLOT）。
function buildAppointDto(appoint) {
  const input = appoint && typeof appoint === 'object' ? appoint : {};
  const rawType = textOf(input.type);
  let type = enums.APPOINT_TYPE.ASAP;
  if (rawType === enums.APPOINT_TYPE.SLOT) {
    type = enums.APPOINT_TYPE.SLOT;
  } else if (rawType === enums.APPOINT_TYPE.LATEST) {
    type = enums.APPOINT_TYPE.LATEST;
  }
  const latestAt = type === enums.APPOINT_TYPE.LATEST ? appointUtil.latestAtOf(input) : 0;
  return {
    type,
    typeText: enums.APPOINT_TYPE_TEXT[type],
    text: latestAt ? appointUtil.latestText(latestAt) : enums.APPOINT_TYPE_TEXT[type],
    latestAt: latestAt ? isoOf(latestAt) : '',
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

// D58（批 26）转派动作：目标视角给"确认接收/拒收"；履约人视角 PENDING 给"撤回"、否则给"转派"。
// 一件已取（D61）不广告 requestTransfer（必然 INVALID_STATE）；终态/其它状态不广告（页面零判据）。
function buildTransferActions(actions, order, options) {
  const opts = options || {};
  if (opts.transferTarget) {
    if (transfer.isPending(order)) {
      pushAction(actions, 'acceptTransfer');
      pushAction(actions, 'declineTransfer');
    }
    return;
  }
  if (order.status !== enums.ORDER_STATUS.ACCEPTED || transfer.hasPickedAny(order)) {
    return;
  }
  if (transfer.isPending(order)) {
    pushAction(actions, 'cancelTransfer');
    return;
  }
  pushAction(actions, 'requestTransfer');
}

function buildActions(order, side, nowMs, options) {
  const opts = options || {};
  const actions = [];
  const status = order.status;
  // 转派目标视角（PENDING 邀请的目标兼职）：只下发邀请卡动作，无履约人动作（越权入口为零）
  if (opts.transferTarget) {
    buildTransferActions(actions, order, opts);
    return actions;
  }
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
    buildTransferActions(actions, order, opts);
    pushMessageIfOpen(actions, status);
  } else if (side === 'CUSTOMER') {
    buildCustomerActions(actions, order);
  }
  return actions;
}

// D41（2026-10-28 用户拍板）：服务目录固定 5 类，原 PICKUP_DOOR（送寝上门）停用、不可新启用，
// 仅历史订单保留订单快照名。历史单只补「已停用」标记（响应只增不减、快照名不改，客户端按
// shared/enums.LEGACY_SERVICE_NAME 渲染「送寝上门（已停用）」）；现行 5 类恒 false。
// 标记嵌在既有 service 键内 → 行 DTO 顶层键白名单不变。
function buildServiceDto(service) {
  const input = service && typeof service === 'object' ? service : {};
  const code = textOf(input.code);
  return {
    code: code,
    name: textOf(input.name),
    deprecated: code !== '' && enums.SERVICE_CODES.indexOf(code) < 0
  };
}

// D61 件级取件聚合：pickedCount/parcelCount/allPicked 由逐件 picked 标记派生（不落库计数字段）。
function pickSummaryFieldsOf(parcels) {
  const list = Array.isArray(parcels) ? parcels : [];
  const pickedCount = list.filter((parcel) => parcel.picked === true).length;
  return { pickedCount, parcelCount: list.length, allPicked: list.length > 0 && pickedCount === list.length };
}

// 订单视图字段装配（buildOrderDto 的主体；拆出以控单函数行数，参数 parts 见调用处）
function buildOrderFields(order, parts) {
  const side = parts.side;
  const parcels = parts.parcels;
  const images = parts.images;
  const delivery = parts.delivery;
  return Object.assign({
    orderNo: textOf(order.orderNo),
    status: parts.status,
    statusText: orderState.statusText(parts.status),
    bucket: orderView.bucketOf(parts.status),
    progressIndex: orderState.progressIndex(parts.status),
    needCode: needCodeOf(order),
    failureHint: failureHintOf(order),
    source: textOf(order.source),
    service: buildServiceDto(order.service),
    appoint: buildAppointDto(order.appoint),
    parcels,
    parcel: parcels[0] || buildParcelDto(null),
    images,
    image: images[0] || buildImageDto(null),
    delivery,
    manualEntry: order.manualEntry === true,
    note: textOf(order.note),
    phoneTail: textOf(order.phoneTail) || (delivery && delivery.phoneTail) || '',
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
    // D58：顾客据此看到"当前实际履约的是谁"（= orders.partnerNo 快照，只读派生，不落库）
    fulfillmentPartnerNo: textOf(order.partnerNo),
    counterpart: parts.counterpart,
    // D58：transfer 恒返回（无字段 ⇒ null，零迁移）；键集合由 _transfer.blockOf 按角色剪裁
    transfer: parts.transferBlock,
    actions: parts.withActions ? buildActions(order, side, parts.nowMs, { transferTarget: parts.transferTarget }) : [],
    version: numberOrZero(order.version)
  }, party.buildTimeFields(order), pickSummaryFieldsOf(parcels));
}

/**
 * 订单视图模型。
 * @param {object} ctx handler 上下文
 * @param {object} order orders 文档
 * @param {{side?: string, withCounterpart?: boolean, withActions?: boolean, transferTarget?: boolean}} options
 */
async function buildOrderDto(ctx, order, options) {
  const opts = options || {};
  const side = opts.side || '';
  const withActions = opts.withActions !== false;
  const withCounterpart = opts.withCounterpart !== false;
  const transferTarget = opts.transferTarget === true;
  const identity = (ctx && ctx.identity) || {};
  const counterpart = withCounterpart && side !== 'ADMIN' && !transferTarget
    ? await party.resolveCounterpart(ctx, order, side)
    : null;
  // 转派块按角色剪裁：转派目标 = 双方白名单 7 键；顾客只含 ACCEPTED 后的 status/toPartnerNo；admin 5 键
  const relation = transferTarget ? 'PARTNER' : side;
  const dto = buildOrderFields(order, {
    side,
    withActions,
    counterpart,
    transferBlock: transfer.blockOf(order, relation),
    transferTarget,
    nowMs: time.toMs(ctx && ctx.now),
    status: textOf(order.status),
    parcels: buildParcelDtos(order, side),
    images: buildImageDtos(order),
    delivery: deliveryOf(order)
  });
  // 目标兼职视角（§1.4）：D58 明示不给顾客昵称/头像/客户编号；清键而非置空值（字符串级零泄漏断言）
  if (transferTarget) {
    delete dto.customerNo;
    dto.counterpart = null;
    dto.guest = null;
  }
  if (side === 'ADMIN') {
    party.applyAdminMask(dto, counterpart);
    dto.actions = [];
  }
  if (identity.viewMode === enums.VIEW_MODE.TEST_WRITE) {
    dto.isTest = order.isTest === true;
    dto.impersonatedBy = textOf(order.impersonatedBy);
  }
  return dto;
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
  buildEventDtos: party.buildEventDtos,
  buildParcelDto,
  buildActions
};
