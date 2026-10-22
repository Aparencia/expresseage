// handlers/order/_parcels-input.js · v1.0 下单入参归一纯件（多包裹 / 多截图 / 本单配送地址 / 无截图手填）
// 口径：CONTRACT v1.0 §4/§4.1/§5.2/§5.3（D23 一单多包裹、D24 无截图手填、D25 本单配送地址）；DATA_MODEL §2.5/§4.8。
// 边界：纯入参归一（零 DB、零 wx）；票据归属/图片文件校验与内容安全在 _create.js 异步链路完成。
'use strict';

const enums = require('../../shared/enums');
const validate = require('../../shared/validate');
const orderState = require('../../shared/order-state');
const { errors } = require('../../lib/errors');
const parcelUtil = require('./_parcel');

const MAX_PARCELS = orderState.MAX_PARCELS_PER_ORDER;
const MAX_IMAGES = orderState.MAX_IMAGES_PER_ORDER;
const RECIPIENT_MAX = 20;

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// 包裹形态：定稿=每件扁平 {stationId,...}；兼容顾客端当前嵌套 {parcel:{...}, imageIndex?, failureId?}
function parcelBodyOf(item, index) {
  if (!isPlainObject(item)) {
    throw errors.validation('parcels', '第 ' + (index + 1) + ' 件取件信息格式不正确');
  }
  return isPlainObject(item.parcel) ? item.parcel : item;
}

// imageIndex = 本件来源截图在 images[] 的下标（0 起，合法域 0~images.length-1）。
// 手填件/无截图件必须省略该字段：客户端传 -1 视为省略；本批无截图时一律不落 imageIndex（不写 0 冒充）。
function normalizeImageIndex(value, index, imageCount) {
  if (imageCount <= 0 || value === undefined || value === null || Number(value) === -1) {
    return -1;
  }
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0 || num >= imageCount) {
    throw errors.validation('imageIndex', '第 ' + (index + 1) + ' 件的截图序号不正确');
  }
  return num;
}

// 复核队列关联号：非法形态静默丢弃（不阻断下单，与旧口径一致）
function normalizeFailureId(value) {
  const text = textOf(value);
  return text && enums.FAILURE_NO_PATTERN.test(text) ? text : '';
}

// parcels[1~MAX_PARCELS]：每件站点必填 + 取件码或运单尾号至少一个（NEED_CODE 只放宽取件码，不放宽站点）。
// imageCount = 本批 images 数量（先归一 images 再归一 parcels）；fallbackSource = 整单 recognition.source。
function normalizeParcels(input, fallbackSource, imageCount) {
  const raw = input && Array.isArray(input.parcels) ? input.parcels : null;
  if (!raw || raw.length < 1 || raw.length > MAX_PARCELS) {
    throw errors.validation('parcels', '一单需 1~' + MAX_PARCELS + ' 件包裹');
  }
  return raw.map((item, index) => {
    const body = parcelBodyOf(item, index);
    const parcel = parcelUtil.normalizeParcel(body, fallbackSource);
    if (!parcel.stationId) {
      throw errors.validation('stationId', '第 ' + (index + 1) + ' 件请选择驿站站点');
    }
    if (!parcel.pickupCode && !parcel.trackingTail) {
      throw errors.validation('pickupCode', '第 ' + (index + 1) + ' 件需填写取件码或运单尾号');
    }
    const imageIndex = normalizeImageIndex(item && item.imageIndex, index, imageCount);
    if (imageIndex >= 0) {
      parcel.imageIndex = imageIndex;
    }
    const failureId = normalizeFailureId(item && item.failureId);
    if (failureId) {
      parcel.failureId = failureId;
    }
    return parcel;
  });
}

// images[0~MAX_IMAGES] + tickets[] 同序一一对应（一张截图一个 ticket）。
// 旧单图形态兼容：顶层 {image,ticket}（无 images[] 时）折算为 images[0]/tickets[0]；image 缺 ticket → VALIDATION('ticket')。
function imagePairsOf(input) {
  if (input && Array.isArray(input.images)) {
    return {
      images: input.images,
      tickets: Array.isArray(input.tickets) ? input.tickets : []
    };
  }
  if (input && input.image !== undefined && input.image !== null) {
    const ticket = typeof input.ticket === 'string' ? input.ticket.trim() : '';
    if (!ticket) {
      throw errors.validation('ticket', '请先上传取件截图');
    }
    return { images: [input.image], tickets: [ticket] };
  }
  return { images: [], tickets: [] };
}

function normalizeImages(input) {
  const pairs = imagePairsOf(input);
  const rawImages = pairs.images;
  if (rawImages.length === 0) {
    return { images: [], tickets: [] };
  }
  if (rawImages.length > MAX_IMAGES) {
    throw errors.validation('images', '一单最多 ' + MAX_IMAGES + ' 张截图，请分单提交');
  }
  const rawTickets = pairs.tickets;
  if (rawTickets.length !== rawImages.length) {
    throw errors.validation('tickets', '截图与上传凭证数量不一致，请重新上传');
  }
  const images = rawImages.map((image, index) => {
    if (!isPlainObject(image)) {
      throw errors.validation('images', '第 ' + (index + 1) + ' 张截图参数不合法');
    }
    const fileId = textOf(image.fileId);
    if (!fileId || fileId.indexOf('cloud://') !== 0) {
      throw errors.validation('image', '第 ' + (index + 1) + ' 张截图未上传成功，请重新上传');
    }
    const ticket = textOf(rawTickets[index]);
    if (!ticket) {
      throw errors.validation('tickets', '第 ' + (index + 1) + ' 张截图缺少上传凭证');
    }
    const width = Number(image.width);
    const height = Number(image.height);
    const normalized = {
      fileId,
      width: Number.isFinite(width) && width > 0 ? Math.floor(width) : 0,
      height: Number.isFinite(height) && height > 0 ? Math.floor(height) : 0,
      ticket
    };
    // size/contentType 只用于服务端 assertImageFile 校验（落库前由 storedImagesOf 剔除）
    if (image.size !== undefined) {
      normalized.size = Number(image.size);
    }
    if (image.contentType !== undefined) {
      normalized.contentType = image.contentType;
    }
    return normalized;
  });
  return { images, tickets: images.map((item) => item.ticket) };
}

// 无截图手填标记与截图数量必须一致（D24：images=[] 且 manualEntry=true）
function normalizeManualEntry(input, images) {
  const expected = images.length === 0;
  if (input && input.manualEntry !== undefined && input.manualEntry !== expected) {
    throw errors.validation('manualEntry', '无截图标记与截图数量不一致，请刷新页面后重试');
  }
  return expected;
}

// 落库图片快照：只留 {fileId,width,height}（ticket/size 只用于校验与消费，不进订单）
function storedImagesOf(images) {
  return (Array.isArray(images) ? images : []).map((image) => ({
    fileId: image.fileId,
    width: image.width,
    height: image.height
  }));
}

function deliveryFieldError(field) {
  if (field === 'zone') {
    return '请选择苑';
  }
  if (field === 'buildingNo') {
    return '请选择楼栋（1~10 栋）';
  }
  if (field === 'room') {
    return '宿舍号要 100 以上的数字';
  }
  return '本单配送地址不合法，请核对后重试';
}

// 本单配送地址（D25）：显式 delivery 按宿舍规则校验并重算 dormKey/buildingText（不信任客户端派生值）；
// 缺省 = 下单人宿舍（base）。recipientName ≤20（内容安全在 _create 异步校验）、phoneTail 可选 4 位。
function normalizeDelivery(input, base) {
  const fallback = base || {};
  const raw = input && isPlainObject(input.delivery) ? input.delivery : null;
  const source = raw || fallback;
  const dorm = validate.validateDormIdentity(source);
  if (!dorm.ok) {
    throw errors.validation(dorm.field || 'delivery', deliveryFieldError(dorm.field));
  }
  const delivery = {
    zone: dorm.zone,
    buildingNo: dorm.buildingNo,
    room: dorm.room,
    dormKey: dorm.dormKey,
    buildingText: dorm.buildingText
  };
  // 显式地址（送他人）只采用入参自带的称呼/尾号，不继承下单人本人尾号（D25 L3 第三方地址最小化）
  const rawName = raw ? raw.recipientName : fallback.recipientName;
  if (rawName !== undefined && rawName !== null && rawName !== '') {
    const name = validate.validateDisplayName(rawName);
    if (!name.ok) {
      throw errors.validation('recipientName', '收件人称呼最多 ' + RECIPIENT_MAX + ' 字');
    }
    delivery.recipientName = name.value;
  }
  const rawTail = raw ? raw.phoneTail : fallback.phoneTail;
  if (rawTail !== undefined && rawTail !== null && rawTail !== '') {
    const tail = validate.validatePhoneTail(rawTail);
    if (!tail.ok) {
      throw errors.validation('phoneTail', '手机尾号需 4 位数字');
    }
    if (tail.value) {
      delivery.phoneTail = tail.value;
    }
  }
  return delivery;
}

// 合并窗口比较：配送地址完全相同才允许并入（D23/D25）
function deliveryEquals(left, right) {
  const a = left || {};
  const b = right || {};
  return textOf(a.zone) === textOf(b.zone)
    && Number(a.buildingNo) === Number(b.buildingNo)
    && textOf(a.room) === textOf(b.room)
    && textOf(a.dormKey) === textOf(b.dormKey)
    && textOf(a.recipientName) === textOf(b.recipientName)
    && textOf(a.phoneTail) === textOf(b.phoneTail);
}

module.exports = {
  MAX_PARCELS,
  MAX_IMAGES,
  RECIPIENT_MAX,
  isPlainObject,
  normalizeParcels,
  normalizeImages,
  normalizeManualEntry,
  storedImagesOf,
  normalizeDelivery,
  deliveryEquals
};
