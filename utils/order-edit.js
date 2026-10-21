// utils/order-edit.js · 改码/柜号/运单尾号校验纯件（页面行内编辑用；校验口径调 shared/validate + shared/stations）
// 边界：不改订单归属、不改状态（服务端更正动作负责）；本文件只做输入归一与形态校验。
const validate = require('../shared/validate');
const stations = require('../shared/stations');

const PICKUP_CODE_MAX = validate.PICKUP_CODE_MAX_RAW;
const LOCKER_NO_MAX = validate.TEXT_LIMITS.lockerNo;
const TRACKING_TAIL_LENGTH = 5;
const FIELD_LABEL = {
  stationId: '站点',
  stationName: '站点',
  pickupCode: '取件码',
  lockerNo: '柜号',
  trackingTail: '运单尾号'
};
const FIELD_MESSAGE = {
  pickupCode: {
    TOO_LONG: '取件码最多 40 个字符',
    FORMAT: '取件码是 4~12 位字母数字，可带连字符',
    TYPE: '取件码格式不对，请核对后重填'
  },
  lockerNo: {
    TOO_LONG: '柜号最多 10 个字符',
    FORMAT: '柜号含不支持的字符，请核对后重填',
    TYPE: '柜号格式不对，请核对后重填'
  },
  trackingTail: {
    FORMAT: '运单尾号必须是 5 位数字',
    TYPE: '运单尾号必须是 5 位数字'
  }
};

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function messageOf(field, reason) {
  const table = FIELD_MESSAGE[field] || {};
  return table[reason] || '这一项格式不对，请核对后重填';
}

function fieldError(result) {
  const field = result.field || '';
  return {
    ok: false,
    field: field,
    message: messageOf(field, result.reason),
    patch: {}
  };
}

function normalizePatch(patch) {
  const source = patch || {};
  const next = {};
  ['stationId', 'stationName', 'pickupCode', 'lockerNo', 'trackingTail'].forEach((field) => {
    if (source[field] === undefined) {
      return;
    }
    next[field] = textOf(source[field]);
  });
  return next;
}

function patchFields(patch) {
  return Object.keys(patch || {});
}

function validatePatch(patch, options) {
  const opts = options || {};
  const next = normalizePatch(patch);
  const fields = patchFields(next);
  if (!fields.length) {
    return { ok: false, field: '', message: '没有要保存的修改', patch: next };
  }
  if (opts.pickedOnly) {
    const forbidden = fields.filter((field) => field !== 'lockerNo' && field !== 'trackingTail');
    if (forbidden.length) {
      return { ok: false, field: forbidden[0], message: '已取件后只能改柜号或运单尾号', patch: next };
    }
  }
  const normalized = {};
  if (next.pickupCode !== undefined) {
    const result = validate.validatePickupCode(next.pickupCode);
    if (!result.ok) {
      return fieldError(result);
    }
    normalized.pickupCode = result.value;
  }
  if (next.lockerNo !== undefined) {
    const result = validate.validateLockerNo(next.lockerNo);
    if (!result.ok) {
      return fieldError(result);
    }
    normalized.lockerNo = result.value;
  }
  if (next.trackingTail !== undefined) {
    const result = validate.validateTrackingTail(next.trackingTail);
    if (!result.ok) {
      return fieldError(result);
    }
    normalized.trackingTail = result.value;
  }
  if (next.stationId !== undefined || next.stationName !== undefined) {
    const stationResult = stations.validateStation(next.stationId || '', next.stationName || '');
    if (!stationResult.ok) {
      return { ok: false, field: 'stationId', message: '站点只能是 P1~P8 里的取件点', patch: normalized };
    }
    normalized.stationId = stationResult.id;
    normalized.stationName = stationResult.name;
  }
  return { ok: true, field: '', message: '', patch: normalized };
}

function buildPatch(form, options) {
  const opts = options || {};
  const patch = normalizePatch(form);
  if (!opts.keepStation) {
    delete patch.stationId;
    delete patch.stationName;
  }
  return patch;
}

function codeStatusOf(patch) {
  const next = normalizePatch(patch);
  return textOf(next.pickupCode) ? 'OK' : 'NEED_CODE';
}

function fieldLabel(field) {
  return FIELD_LABEL[field] || field;
}

module.exports = {
  PICKUP_CODE_MAX,
  LOCKER_NO_MAX,
  TRACKING_TAIL_LENGTH,
  normalizePatch,
  validatePatch,
  buildPatch,
  codeStatusOf,
  fieldLabel
};
