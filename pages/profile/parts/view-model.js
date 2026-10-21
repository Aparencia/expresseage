// pages/profile/parts/view-model.js · 我的页视图模型（纯件：零 wx、零 setData、零业务写）
// 口径：V4_UX_CUSTOMER §3.5/§7/§9.4、V4_UX_PARTNER §3.10/§6；枚举/上行校验/苑标识全部来自 shared/，
// 页面只负责取 snapshot、调 api、setData 与事件转发（ARCHITECTURE §3.5 页面层零判据）。
'use strict';

const enums = require('../../../shared/enums');
const zones = require('../../../shared/zones');
const validate = require('../../../shared/validate');
const ids = require('../../../utils/ids');
const roomTagUtil = require('../../../utils/room-tag');

const NAME_LIMIT = validate.TEXT_LIMITS.displayName;
const RELEASE_NOTE_LIMIT = validate.TEXT_LIMITS.releaseNote;
const PHONE_TAIL_LIMIT = 4;
const DEFAULT_ORDER_SUMMARY = '进行中 — · 已完成 —';

const BUILDING_LABELS = (function buildBuildings() {
  const out = [];
  for (let n = zones.BUILDING_MIN; n <= zones.BUILDING_MAX; n += 1) {
    out.push(String(n));
  }
  return out;
})();

const ZONE_OPTIONS = zones.ZONES.map(function mapZone(code) {
  return { code: code, label: zones.zoneLabel(code) };
});
const ZONE_LABELS = ZONE_OPTIONS.map(function labelOf(item) {
  return item.label;
});

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function releaseReasonOf(code) {
  const hit = enums.RELEASE_REASONS.filter(function match(item) {
    return item.code === code;
  })[0];
  return { code: hit ? hit.code : '', text: hit ? hit.text : '' };
}

// 顾客解绑只能由顾客发起：动作码由角色枚举 + 固定后缀派生，页面不写死枚举字面量。
const CUSTOMER_RELEASE_REASON = releaseReasonOf(enums.ROLES.CUSTOMER + '_INITIATED');

function isBindingActive(binding) {
  return !!binding && binding.status !== enums.BINDING_STATUS.RELEASED;
}

function tailText(phoneTail) {
  const value = textOf(phoneTail);
  return /^[0-9]{4}$/.test(value) ? '尾号' + value : '';
}

function dormKeyOf(customer) {
  const doc = customer || {};
  if (textOf(doc.dormKey)) {
    return textOf(doc.dormKey);
  }
  if (doc.buildingNo === undefined || doc.buildingNo === null) {
    return '';
  }
  return zones.dormKey(doc.zone, doc.buildingNo, doc.room);
}

function dormTextOf(customer) {
  const doc = customer || {};
  const zoneLabel = zones.zoneLabel(doc.zone);
  const room = zones.canonicalRoom(doc.room);
  if (!zoneLabel || !zones.isBuildingNo(doc.buildingNo) || !room) {
    return '';
  }
  return zoneLabel + doc.buildingNo + '栋' + room + '室';
}

function roomTagOf(customer, binding) {
  if (!isBindingActive(binding) || !textOf(binding.roomTag)) {
    return null;
  }
  const dormKey = dormKeyOf(customer);
  const text = roomTagUtil.formatDormTag(dormKey, textOf(binding.roomTag));
  if (!text) {
    return null;
  }
  return { dormKey: dormKey, tag: textOf(binding.roomTag), text: text };
}

function countText(value) {
  return typeof value === 'number' && isFinite(value) && value >= 0 ? String(value) : '—';
}

// 订单概览只消费 DTO 下发的 counts（缺字段显示 —），页面不做任何前端计数/推算。
function orderSummaryOf(customer) {
  const counts = (customer && customer.counts) || {};
  const inProgress = typeof counts.inProgress === 'number' ? counts.inProgress : counts.doing;
  const completed = counts.completed;
  if (typeof inProgress === 'number' || typeof completed === 'number') {
    return '进行中 ' + countText(inProgress) + ' · 已完成 ' + countText(completed);
  }
  return '';
}

// bind.getCurrent → store.binding（对方头像/昵称只在 ACTIVE 绑定期间下发，解绑即失联）
function normalizeBinding(current) {
  const binding = current && current.binding;
  if (!binding) {
    return null;
  }
  const partner = (current && current.partnerPublic) || {};
  return Object.assign({}, binding, {
    partnerDisplayName: partner.displayName || '',
    partnerAvatarFileId: partner.avatarFileId || '',
    partnerNo: partner.partnerNo || binding.partnerNo || '',
    status: binding.status || enums.BINDING_STATUS.ACTIVE
  });
}

function buildProfileCard(isCustomer, customer, binding) {
  const doc = customer || {};
  const card = {
    displayName: textOf(doc.displayName),
    avatarFileId: textOf(doc.avatarFileId),
    complete: doc.profileComplete === true,
    dormText: isCustomer ? dormTextOf(doc) : '',
    tailText: isCustomer ? tailText(doc.phoneTail) : '',
    roomTag: isCustomer ? roomTagOf(doc, binding) : null
  };
  return card;
}

function buildBindingCard(binding) {
  if (!isBindingActive(binding)) {
    return null;
  }
  const partnerNo = textOf(binding.partnerNo);
  const partnerDisplayName = textOf(binding.partnerDisplayName);
  const partnerAvatarFileId = textOf(binding.partnerAvatarFileId);
  return {
    partnerDisplayName: partnerDisplayName,
    partnerAvatarFileId: partnerAvatarFileId,
    partnerNo: partnerNo,
    partnerNoDisplay: partnerNo ? ids.displayNo(enums.NO_KIND.PARTNER, partnerNo) : textOf(binding.targetNo),
    hidden: !partnerDisplayName && !partnerAvatarFileId
  };
}

function buildPartnerCard(partner) {
  const doc = partner || {};
  const partnerNo = textOf(doc.partnerNo);
  const status = textOf(doc.status);
  let statusText = enums.PARTNER_STATUS_LABELS[status] || '待激活';
  if (status === enums.PARTNER_STATUS.ACTIVE) {
    statusText = doc.acceptingOrders === false ? '暂停接单' : '接单中';
  }
  return {
    partnerNo: partnerNo,
    partnerNoDisplay: partnerNo ? ids.displayNo(enums.NO_KIND.PARTNER, partnerNo) : '',
    statusText: statusText,
    acceptingOrders: doc.acceptingOrders === true
  };
}

// snapshot → 页面数据（store 形状见 ARCHITECTURE §3.4；切换会话按 viewContext.role 渲染）
function buildVm(snapshot) {
  const snap = snapshot || {};
  const view = snap.viewContext || null;
  const role = (view && view.role) || snap.activeRole || '';
  const isCustomer = role === enums.ROLES.CUSTOMER;
  const customer = snap.customer || {};
  const partner = snap.partner || {};
  const binding = snap.binding || null;
  const partnerCard = isCustomer ? null : buildPartnerCard(partner);
  const customerNo = isCustomer ? textOf(customer.customerNo) : '';
  const status = textOf(partner.status);
  return {
    role: role,
    isCustomer: isCustomer,
    viewSession: !!view,
    roles: Array.isArray(snap.roles) ? snap.roles.slice() : [],
    suspended: !isCustomer && status === enums.PARTNER_STATUS.SUSPENDED,
    closed: !isCustomer && status === enums.PARTNER_STATUS.CLOSED,
    profile: {
      displayName: isCustomer ? textOf(customer.displayName) : textOf(partner.displayName),
      avatarFileId: isCustomer ? textOf(customer.avatarFileId) : textOf(partner.avatarFileId)
    },
    profileCard: buildProfileCard(isCustomer, customer, binding),
    bindingCard: isCustomer ? buildBindingCard(binding) : null,
    customerNo: customerNo,
    customerNoDisplay: customerNo ? ids.displayNo(enums.NO_KIND.CUSTOMER, customerNo) : '',
    customerComplete: isCustomer && customer.profileComplete === true,
    partnerCard: partnerCard,
    orderSummaryText: orderSummaryOf(customer) || DEFAULT_ORDER_SUMMARY,
    orderSummaryFromDto: orderSummaryOf(customer) !== '',
    messagesBadge: (snap.badges && snap.badges.messages) || 0
  };
}

function buildForm(profile, isCustomer) {
  const doc = profile || {};
  const zoneIndex = ZONE_OPTIONS.findIndex(function same(item) {
    return item.code === doc.zone;
  });
  const buildingIndex = BUILDING_LABELS.indexOf(String(doc.buildingNo === undefined ? '' : doc.buildingNo));
  const form = {
    displayName: textOf(doc.displayName),
    avatarFileId: textOf(doc.avatarFileId),
    avatarPreview: '',
    avatarTicket: '',
    avatarAction: 'keep',
    zoneIndex: zoneIndex,
    buildingIndex: buildingIndex,
    room: textOf(doc.room),
    phoneTail: textOf(doc.phoneTail),
    dormPreview: ''
  };
  form.dormPreview = isCustomer ? previewDorm(form) : '';
  return form;
}

// 实时预览「你的宿舍：D4-522」（值域以 zones 单源为准，不做前端合法值表）
function previewDorm(form) {
  const zoneOption = ZONE_OPTIONS[form.zoneIndex];
  const buildingLabel = BUILDING_LABELS[form.buildingIndex];
  const room = zones.canonicalRoom(form.room);
  if (!zoneOption || !buildingLabel || !room) {
    return '';
  }
  return zones.dormKey(zoneOption.code, Number(buildingLabel), room);
}

// 昵称输入即截断（UX_CUSTOMER §7.2：截断 + toast，不做超长报错）
function clampNickname(value) {
  const raw = typeof value === 'string' ? value : '';
  const chars = Array.from(raw);
  if (chars.length <= NAME_LIMIT) {
    return { value: raw, truncated: false };
  }
  return { value: chars.slice(0, NAME_LIMIT).join(''), truncated: true };
}

function digitsOnly(value, maxLength) {
  const digits = String(value === undefined || value === null ? '' : value).replace(/[^0-9]/g, '');
  return maxLength ? digits.slice(0, maxLength) : digits;
}

// 保存入参：页面只把表单交给这里；校验规则与错误文案口径来自 shared/validate。
function buildSavePayload(options) {
  const opts = options || {};
  const form = opts.form || {};
  const nickname = validate.validateDisplayName(form.displayName);
  if (!nickname.ok) {
    return { ok: false, message: '昵称不能为空' };
  }
  const payload = { displayName: nickname.value };
  if (opts.isCustomer) {
    const zoneOption = ZONE_OPTIONS[form.zoneIndex];
    const buildingLabel = BUILDING_LABELS[form.buildingIndex];
    if (!zoneOption) {
      return { ok: false, message: '请选择苑/楼区' };
    }
    if (!buildingLabel) {
      return { ok: false, message: '请选择楼栋号（1~10）' };
    }
    const dorm = validate.validateDormIdentity({
      zone: zoneOption.code,
      buildingNo: Number(buildingLabel),
      room: form.room
    });
    if (!dorm.ok) {
      return {
        ok: false,
        message: dorm.field === 'room' ? '宿舍号要填 3 位以上数字（如 522）' : '请选择苑/楼区和楼栋号（1~10）'
      };
    }
    const tail = validate.validatePhoneTail(form.phoneTail);
    if (!tail.ok) {
      return { ok: false, message: '手机尾号写后 4 位数字，不知道就留空' };
    }
    payload.zone = dorm.zone;
    payload.buildingNo = dorm.buildingNo;
    payload.room = dorm.room;
    payload.phoneTail = tail.value;
  }
  if (form.avatarAction === 'replace' && form.avatarTicket) {
    payload.avatarTicket = form.avatarTicket;
    payload.avatarFileId = form.avatarFileId || '';
  } else if (form.avatarAction === 'default') {
    payload.avatarFileId = '';
  }
  return { ok: true, payload: payload };
}

// 保存成功后的 store 合并：资料字段 + profileComplete + 绑定 roomTag（改宿舍会重分配）
function mergeCustomer(previous, saved) {
  const base = previous || {};
  const result = saved && saved.profile ? saved.profile : (saved || {});
  const next = Object.assign({}, base, result);
  next.profileComplete = !!(result.profileCompleted !== undefined ? result.profileCompleted : next.profileCompleted);
  delete next.profileCompleted;
  if (!next.customerNo) {
    next.customerNo = base.customerNo || '';
  }
  return next;
}

function mergePartner(previous, saved) {
  const base = previous || {};
  const source = saved && saved.partner ? saved.partner : (saved || {});
  const next = Object.assign({}, base, source);
  next.profileComplete = !!next.displayName;
  if (next.serviceConfig === undefined) {
    next.serviceConfig = base.serviceConfig || {};
  }
  return next;
}

module.exports = {
  NAME_LIMIT,
  RELEASE_NOTE_LIMIT,
  PHONE_TAIL_LIMIT,
  DEFAULT_ORDER_SUMMARY,
  BUILDING_LABELS,
  ZONE_LABELS,
  buildVm,
  buildForm,
  previewDorm,
  clampNickname,
  digitsOnly,
  buildSavePayload,
  mergeCustomer,
  mergePartner,
  normalizeBinding,
  releaseReason: function releaseReason() {
    return { code: CUSTOMER_RELEASE_REASON.code, text: CUSTOMER_RELEASE_REASON.text };
  }
};
