// utils/order-edit.js · 改码/柜号/运单尾号校验纯件（页面行内编辑用；校验口径调 shared/validate）
// 边界：不改订单归属、不改状态（服务端 order.correct 负责）；本文件只做输入归一与形态校验。
const validate = require('../shared/validate');

const PICKUP_CODE_MAX = 40;
const LOCKER_NO_MAX = 10;
const TRACKING_TAIL_LENGTH = 5;
const FIELD_LABEL = {
  stationId: '站点',
  stationName: '站点',
  pickupCode: '取件码',
  lockerNo: '柜号',
  trackingTail: '运单尾号'
};
const PICKUP_CODE_PATTERN = /^[0-9A-Za-z-]{4,40}$/;
const TRACKING_TAIL_PATTERN = /^[0-9]{5}$/;

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function hasText(value) {
  return textOf(value).length > 0;
}

function checkByShared(name, value) {
  const checker = validate && validate[name];
  return typeof checker === 'function' ? checker(value) : null;
}

function checkPickupCode(value) {
  const code = textOf(value);
  if (!code) {
    return { ok: true };
  }
  const shared = checkByShared('isValidPickupCode', code);
  const valid = shared === null ? PICKUP_CODE_PATTERN.test(code) : shared === true;
  return valid ? { ok: true } : { ok: false, field: 'pickupCode', message: '取件码格式不对，请核对后重填' };
}

function checkLockerNo(value) {
  const locker = textOf(value);
  if (!locker) {
    return { ok: true };
  }
  if (locker.length > LOCKER_NO_MAX) {
    return { ok: false, field: 'lockerNo', message: '柜号最多 10 个字符' };
  }
  const shared = checkByShared('isValidLockerNo', locker);
  if (shared === false) {
    return { ok: false, field: 'lockerNo', message: '柜号格式不对，请核对后重填' };
  }
  return { ok: true };
}

function checkTrackingTail(value) {
  const tail = textOf(value);
  if (!tail) {
    return { ok: true };
  }
  if (tail.length !== TRACKING_TAIL_LENGTH || !TRACKING_TAIL_PATTERN.test(tail)) {
    return { ok: false, field: 'trackingTail', message: '运单尾号必须是 5 位数字' };
  }
  const shared = checkByShared('isValidTrackingTail', tail);
  if (shared === false) {
    return { ok: false, field: 'trackingTail', message: '运单尾号必须是 5 位数字' };
  }
  return { ok: true };
}

function checkStation(patch) {
  if (!hasText(patch.stationId) && !hasText(patch.stationName)) {
    return { ok: true };
  }
  if (hasText(patch.stationId) && !hasText(patch.stationName)) {
    return { ok: false, field: 'stationName', message: '请从 P1~P8 里选择站点' };
  }
  const shared = checkByShared('isValidStationId', textOf(patch.stationId));
  if (shared === false) {
    return { ok: false, field: 'stationId', message: '站点只能是 P1~P8 里的取件点' };
  }
  return { ok: true };
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
  const checks = [checkStation(next), checkPickupCode(next.pickupCode), checkLockerNo(next.lockerNo), checkTrackingTail(next.trackingTail)];
  for (let index = 0; index < checks.length; index += 1) {
    if (!checks[index].ok) {
      return { ok: false, field: checks[index].field, message: checks[index].message, patch: next };
    }
  }
  return { ok: true, field: '', message: '', patch: next };
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
  return hasText(next.pickupCode) ? 'OK' : 'NEED_CODE';
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
