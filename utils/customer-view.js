// utils/customer-view.js · 顾客档案视图模型（锚+键 + 编号 + 头像/昵称），纯件零 wx
// 数据来源：partner.listBindings 的 list 项（仅 ACTIVE 绑定返回头像/昵称；解绑后 DTO 不再返回）
const roomTag = require('./room-tag');

const PHONE_TAIL_LENGTH = 4;
const DATE_PARTS = 2;

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function tailText(value) {
  const tail = textOf(value);
  return tail.length === PHONE_TAIL_LENGTH ? '尾号' + tail : '';
}

function pad2(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '';
  }
  return number < 10 ? '0' + number : String(number);
}

function timeText(value) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
}

function formatDorm(dormKey, tag) {
  const key = textOf(dormKey);
  const suffix = textOf(tag);
  if (!key) {
    return suffix;
  }
  if (!suffix) {
    return key;
  }
  return typeof roomTag.formatDormTag === 'function' ? roomTag.formatDormTag(key, suffix) : key + suffix;
}

function buildKeyText(customer) {
  const parts = [];
  const tail = tailText(customer.phoneTail);
  const name = textOf(customer.displayName);
  if (tail) {
    parts.push(tail);
  }
  if (name) {
    parts.push(name);
  }
  return parts.join(' · ');
}

function buildCustomerView(item) {
  const customer = item || {};
  const anchor = formatDorm(customer.dormKey, customer.roomTag);
  const keyText = buildKeyText(customer);
  const parts = [];
  if (anchor) {
    parts.push(anchor);
  }
  if (keyText) {
    parts.push(keyText);
  }
  return {
    bindingId: textOf(customer.bindingId),
    customerNo: textOf(customer.customerNo),
    avatarFileId: textOf(customer.avatarFileId),
    displayName: textOf(customer.displayName),
    phoneTailText: tailText(customer.phoneTail),
    dormKey: textOf(customer.dormKey),
    roomTag: textOf(customer.roomTag),
    buildingText: textOf(customer.buildingText),
    anchorText: anchor,
    keyText: keyText,
    anchorKeyText: parts.join(' · '),
    partnerNote: textOf(customer.partnerNote),
    activeOrderCount: typeof customer.activeOrderCount === 'number' ? customer.activeOrderCount : 0,
    boundAtText: timeText(customer.boundAt)
  };
}

function buildCustomerViews(list) {
  return (Array.isArray(list) ? list : []).map(buildCustomerView);
}

function matchKeyword(view, keyword) {
  const word = textOf(keyword).toLowerCase();
  if (!word) {
    return true;
  }
  const fields = [view.displayName, view.customerNo, view.dormKey, view.roomTag, view.phoneTailText, view.buildingText];
  return fields.some((field) => textOf(field).toLowerCase().indexOf(word) >= 0);
}

function filterByKeyword(views, keyword) {
  return (Array.isArray(views) ? views : []).filter((view) => matchKeyword(view, keyword));
}

function findById(views, bindingId) {
  const id = textOf(bindingId);
  if (!id) {
    return null;
  }
  const list = Array.isArray(views) ? views : [];
  for (let index = 0; index < list.length; index += 1) {
    if (list[index].bindingId === id) {
      return list[index];
    }
  }
  return null;
}

module.exports = {
  PHONE_TAIL_LENGTH,
  DATE_PARTS,
  buildCustomerView,
  buildCustomerViews,
  filterByKeyword,
  findById,
  formatDorm,
  tailText,
  timeText
};
