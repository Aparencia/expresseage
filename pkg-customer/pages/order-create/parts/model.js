// pkg-customer/pages/order-create/parts/model.js · 下单四步视图模型（纯函数，零 wx）
// v1.0（D23/D24/D25）：一单多包裹——`order.create` 入参 {parcels[1~10], images[0~5], tickets?[],
//   serviceCode, appoint, note, delivery?, manualEntry, clientRequestId}；服务类型/预约/备注为**整单一份**
//   （订单级动作作用于全部包裹，CONTRACT §4.1/§5.2）。无截图手填：images=[] 且 manualEntry=true（D24）。
// 提交流程：submission id（= clientRequestId，防重复建单）在进入 Step4 生成，失败重试复用，
//           提交内容（含图片/配送地址）变更后重生成，成功后清空（UX §4.8 / AC-C-19）。
'use strict';

const client = require('../../../../api/client');
const enums = require('../../../../shared/enums');
const recognize = require('../../../../utils/recognize/index');

const STEP_TITLES = ['截图', '核对', '服务', '提交'];
// 一单上限（CONTRACT §5.2/D23）：包裹 ≤10、截图 ≤5
const MAX_PARCELS = recognize.MAX_PARCELS_PER_ORDER;
const MAX_IMAGES = recognize.MAX_IMAGES_PER_ORDER;
// 幂等键：服务端 validateClientRequestId 同口径 16~32 位 [A-Za-z0-9_-]
const SUBMISSION_ID_PATTERN = /^[A-Za-z0-9_-]{16,32}$/;
const SUBMISSION_ID_LENGTH = 24;
const SUBMISSION_ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnpqrstuvwxyz';
// 识别来源值域（客户端口径值在 shared/enums；AI 兜底来源由服务端下发、原样透传，端侧不硬编码第三方名）
const CLIENT_SOURCES = [enums.RECOGNITION_SOURCE.RULE, enums.RECOGNITION_SOURCE.MANUAL];
const SERVER_SOURCE_PATTERN = /^[A-Z][A-Z0-9_]{1,15}$/;
const UNRECOGNIZED_SOURCE = 'NONE';

function pad(value) {
  return value < 10 ? '0' + value : String(value);
}

function dateAt(base, dayOffset, hour) {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, hour, 0, 0, 0);
}

function iso(date) {
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
    + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':00+08:00';
}

/** 六个预约时段：今天/明天 × 上午/下午/晚上（服务端按 serverTime 再校验未来） */
function appointmentSlots(now) {
  const base = now || new Date();
  const defs = [
    { day: 0, label: '今天', from: 8, to: 12 },
    { day: 0, label: '今天', from: 12, to: 18 },
    { day: 0, label: '今天', from: 18, to: 22 },
    { day: 1, label: '明天', from: 8, to: 12 },
    { day: 1, label: '明天', from: 12, to: 18 },
    { day: 1, label: '明天', from: 18, to: 22 }
  ];
  return defs.map(function map(def, index) {
    const start = dateAt(base, def.day, def.from);
    const end = dateAt(base, def.day, def.to);
    return {
      index: index,
      label: def.label + ' ' + pad(def.from) + ':00-' + pad(def.to) + ':00',
      startAt: iso(start),
      endAt: iso(end),
      expired: end.getTime() <= base.getTime()
    };
  });
}

function stationOptions() {
  return recognize.station.listStations();
}

function stationName(id) {
  return recognize.station.stationName(id);
}

function serviceOptions(config, partnerPublic) {
  const catalog = (config && config.serviceCatalog) || [];
  const enabled = ((partnerPublic && partnerPublic.services) || [])
    .filter(function on(item) { return item.enabled !== false; })
    .map(function code(item) { return item.code; });
  return catalog.filter(function filter(item) {
    return enabled.length === 0 || enabled.indexOf(item.code) >= 0;
  }).map(function map(item) {
    return { code: item.code, name: item.name, desc: item.desc || '' };
  });
}

let itemSeq = 0;

function nextItemKey() {
  itemSeq += 1;
  return 'item_' + itemSeq;
}

/** 单件（包裹）视图模型：取件字段 + 来源图下标（缺省 0）+ 包裹级 failureId（D23 契约）
 * 手填件（manual=true）不绑定来源图（imageIndex=-1）：删图/换图不得丢掉用户手填的件。 */
function makeItem(partial, defaults) {
  const base = recognize.makeEmptyParcel();
  const item = Object.assign({}, base, partial || {});
  const def = defaults || {};
  item.key = nextItemKey();
  item.checked = true;
  item.manual = item.manual === true;
  item.imageIndex = item.manual
    ? -1
    : (typeof item.imageIndex === 'number' && item.imageIndex >= 0 ? item.imageIndex : 0);
  item.failureId = typeof item.failureId === 'string' ? item.failureId : '';
  // 再次下单只预填站点（取件码/尾号/柜号绝不继承）；识别已命中的站点优先，不覆盖
  if (!item.stationId && def.stationId) {
    item.stationId = def.stationId;
    item.stationName = def.stationName || stationName(def.stationId);
  }
  const result = recognize.validateParcel(item);
  item.codeStatus = result.codeStatus;
  item.formErrors = result.errors;
  return item;
}

function revalidateItem(item) {
  const result = recognize.validateParcel(item);
  item.codeStatus = result.codeStatus;
  item.formErrors = result.errors;
  return item;
}

/** 提交前形态闸：勾选件 1~MAX_PARCELS，每件站点 + 取件码或运单尾号（NEED_CODE 口径不变） */
function canSubmit(items) {
  const checked = (items || []).filter(function on(item) { return item.checked; });
  if (checked.length === 0) return { ok: false, reason: '至少选择一件再提交' };
  if (checked.length > MAX_PARCELS) return { ok: false, reason: '一单最多 ' + MAX_PARCELS + ' 件' };
  for (let i = 0; i < checked.length; i += 1) {
    const item = revalidateItem(checked[i]);
    if (!item.stationId) return { ok: false, reason: '请补全站点后再提交', index: items.indexOf(item) };
    if (item.codeStatus === 'NONE') return { ok: false, reason: '请补全取件码或运单后 5 位', index: items.indexOf(item) };
    if (Object.keys(item.formErrors).length > 0) {
      return { ok: false, reason: item.formErrors[Object.keys(item.formErrors)[0]], index: items.indexOf(item) };
    }
  }
  return { ok: true, items: checked };
}

// ── 提交幂等键（clientRequestId）生命周期 ─────────────────────────────────────
function isSubmissionId(value) {
  return typeof value === 'string' && SUBMISSION_ID_PATTERN.test(value);
}

/**
 * 生成提交幂等键：默认复用 api/client 的唯一随机源（页面与视图模型零 random）；
 * 测试可注入 seed() → [0,1) 便于断言。
 */
function createSubmissionId(seed) {
  if (typeof seed !== 'function') {
    return client.createRequestId();
  }
  let out = '';
  for (let i = 0; i < SUBMISSION_ID_LENGTH; i += 1) {
    out += SUBMISSION_ID_CHARS.charAt(Math.floor(seed() * SUBMISSION_ID_CHARS.length));
  }
  return out;
}

/**
 * 提交内容指纹：勾选件（提交顺序）+ 每件取件信息/来源图 + 图片 fileId 序列 + 服务/预约/备注 + 配送地址。
 * 内容变了幂等键必须重生成（否则服务端按重放处理，会吞掉新内容）。
 */
function submissionFingerprint(items, context) {
  const ctx = context || {};
  const rows = (items || []).filter(function on(item) { return item && item.checked; })
    .map(function map(item) {
      return [item.stationId || '', item.pickupCode || '', item.lockerNo || '',
        item.trackingTail || '', String(item.imageIndex || 0), item.failureId || ''].join('\u0001');
    });
  const images = (ctx.images || []).map(function map(image) { return String((image && image.fileId) || ''); });
  const tickets = (ctx.tickets || []).map(function map(ticket) { return String(ticket || ''); });
  return [
    rows.join('\u0002'),
    images.join('\u0003'),
    tickets.join('\u0003'),
    String(ctx.serviceCode || ''),
    String(ctx.appointType || 'ASAP'),
    String(ctx.startAt || ''),
    String(ctx.endAt || ''),
    String(ctx.note || ''),
    String(ctx.deliveryFingerprint || 'SELF'),
    ctx.manualEntry === true ? 'MANUAL' : 'SCREENSHOT'
  ].join('\u0004');
}

/** 进入 Step4 / 提交前：内容未变复用同一 id（失败重试不换键），变了重新生成 */
function ensureSubmission(current, fingerprint, seed) {
  const value = current || {};
  const next = String(fingerprint === null || fingerprint === undefined ? '' : fingerprint);
  if (isSubmissionId(value.id) && value.fingerprint === next) {
    return value;
  }
  return { id: createSubmissionId(seed), fingerprint: next };
}

/** 提交成功后清空（下一单重新生成，避免沿用上一单的幂等键） */
function clearSubmission() {
  return null;
}

// ── 识别来源快照（parcel.recognitionSource / parcel.confidence）───────────────
function recognitionSourceOf(item) {
  const value = item && typeof item.source === 'string' ? item.source : '';
  if (CLIENT_SOURCES.indexOf(value) >= 0) {
    return value;
  }
  // AI 兜底来源标识来自服务端建议（如第三方来源名）：原样透传，服务端校验值域
  if (item && item.aiApplied === true && value !== UNRECOGNIZED_SOURCE && SERVER_SOURCE_PATTERN.test(value)) {
    return value;
  }
  return enums.RECOGNITION_SOURCE.MANUAL;
}

function confidenceOf(item) {
  const value = item && typeof item.confidence === 'string' ? item.confidence.toUpperCase() : '';
  return enums.CONFIDENCE_LEVEL_LIST.indexOf(value) >= 0 ? value : '';
}

// ── 逐件 AI 兜底（决策逻辑纯件；外呼由调用方注入，页面只接线）──────────────────
const RECOGNITION_FIELDS = ['stationId', 'stationName', 'pickupCode', 'lockerNo', 'trackingTail'];

/** 该件是否需要 AI 兜底：缺站点，或取件码缺失/形态不可信（规则优先：已有可填码的件不外呼） */
function needsAiFallback(item) {
  if (!item || item.checked === false) return false;
  if (!item.stationId) return true;
  const result = recognize.validateParcel(item);
  return !!result.errors.pickupCode || result.codeStatus !== enums.CODE_STATUS.OK;
}

/** 用户手改识别字段 → 来源降为 MANUAL（优先级 MANUAL > AI 来源 > RULE），并清掉失真的置信度 */
function withManualEdit(item, patch) {
  const next = Object.assign({}, item, patch || {});
  const keys = Object.keys(patch || {});
  let touched = false;
  for (let i = 0; i < keys.length; i += 1) {
    if (RECOGNITION_FIELDS.indexOf(keys[i]) >= 0) touched = true;
  }
  if (touched) {
    next.source = enums.RECOGNITION_SOURCE.MANUAL;
    next.confidence = '';
    next.aiApplied = false;
  }
  return next;
}

function aiStateOf(suggestion) {
  const value = suggestion || {};
  if (value.error === true) return 'TIMEOUT';
  if (value.confidence === enums.CONFIDENCE_LEVEL.LOW) return 'LOW';
  if (value.recognized !== true) return 'CLOSED';
  return 'OK';
}

/**
 * 逐件 AI 兜底（DATA_MODEL §4.9「同图多单按单调用」）：只对缺站点/缺码的件各调一次 aiCall
 * （同一 uploadTicketId、各自独立 failureId），只填该件空字段；某件失败只降级该件。
 * @param {object[]} items 规则解析后的件
 * @param {object} context {ocrTextMasked, hintTrackingTail, uploadTicketId, role}
 * @param {function} aiCall payload → Promise<suggestion>（页面传 aiApi.parseParcel）
 * @returns {Promise<{items:object[],called:number,changed:number,failed:number}>}
 */
async function applyAiFallbacks(items, context, aiCall) {
  const ctx = context || {};
  const out = [];
  let called = 0;
  let changed = 0;
  let failed = 0;
  for (let i = 0; i < (items || []).length; i += 1) {
    const item = items[i];
    if (typeof aiCall !== 'function' || !needsAiFallback(item)) {
      out.push(item);
      continue;
    }
    called += 1;
    let suggestion = null;
    try {
      suggestion = (await aiCall({
        ocrTextMasked: ctx.ocrTextMasked || '',
        hintTrackingTail: item.trackingTail || ctx.hintTrackingTail || '',
        uploadTicketId: ctx.uploadTicketId || '',
        role: ctx.role || 'CUSTOMER'
      })) || {};
    } catch (err) {
      suggestion = { error: true };
    }
    const state = aiStateOf(suggestion);
    const merged = recognize.applyAiSuggestion(item, suggestion);
    const nextItem = merged.parcel;
    if (merged.changed.length > 0) changed += 1;
    const failureId = typeof suggestion.failureId === 'string' ? suggestion.failureId : '';
    nextItem.failureId = failureId || item.failureId || '';
    nextItem.aiState = state;
    if (state !== 'OK') failed += 1;
    out.push(nextItem);
  }
  return { items: out, called: called, changed: changed, failed: failed };
}

// ── 提交载荷（order.create v1.0 单入口）──────────────────────────────────────
/** 整单预约：ASAP 不填时间；SLOT 必填时段（服务端按 serverTime 再校验） */
function appointPayloadOf(type, slot) {
  if (type !== 'SLOT' || !slot) {
    return { type: 'ASAP' };
  }
  return { type: 'SLOT', startAt: slot.startAt || '', endAt: slot.endAt || '' };
}

/** 图片快照：来自识别结果（含宽高）；同一顺序返回 tickets（images[i] ↔ tickets[i] 一一对应） */
function buildImages(perImage, maxCount) {
  const limit = typeof maxCount === 'number' ? maxCount : MAX_IMAGES;
  const images = [];
  const tickets = [];
  (perImage || []).forEach(function each(entry) {
    const image = entry && entry.image ? entry.image : null;
    const ticket = entry && typeof entry.ticket === 'string' ? entry.ticket : '';
    if (!image || !image.fileId || !ticket || images.length >= limit) {
      return;
    }
    const item = { fileId: image.fileId, width: image.width || 0, height: image.height || 0 };
    if (typeof image.size === 'number' && image.size > 0) item.size = image.size;
    images.push(item);
    tickets.push(ticket);
  });
  return { images: images, tickets: tickets };
}

/**
 * order.create 入参（CONTRACT §5.3 v1.0 单入口）：
 * {parcels[], images[], tickets[], serviceCode, appoint, note, delivery?, manualEntry}
 * 包裹级：{parcel:{stationId,stationName,pickupCode,lockerNo,trackingTail,codeStatus,recognitionSource?,confidence?},
 *          imageIndex?, failureId?}
 */
function buildPayload(options) {
  const opt = options || {};
  const checked = (opt.items || []).filter(function on(item) { return item && item.checked; });
  const parcels = checked.map(function map(item) {
    const parcel = {
      stationId: item.stationId,
      stationName: item.stationName || stationName(item.stationId),
      pickupCode: item.pickupCode || '',
      lockerNo: item.lockerNo || '',
      trackingTail: item.trackingTail || '',
      codeStatus: recognize.validateParcel(item).codeStatus,
      recognitionSource: recognitionSourceOf(item)
    };
    const confidence = confidenceOf(item);
    if (confidence) parcel.confidence = confidence;
    const row = { parcel: parcel };
    // imageIndex = 本件来源截图在 images[] 的下标（DATA_MODEL §2.5 / CONTRACT §4.2 v1.0）：
    // 手填件/无截图件（manual=true 或 imageIndex<0）必须省略该键——不写 0 冒充来自第 1 张图。
    const hasImageIndex = typeof item.imageIndex === 'number' && item.imageIndex >= 0;
    if (item.manual !== true && hasImageIndex) row.imageIndex = item.imageIndex;
    if (typeof item.failureId === 'string' && item.failureId) row.failureId = item.failureId;
    return row;
  });
  const images = Array.isArray(opt.images) ? opt.images : [];
  const tickets = Array.isArray(opt.tickets) ? opt.tickets : [];
  const payload = {
    parcels: parcels,
    images: images,
    tickets: tickets,
    serviceCode: opt.serviceCode || '',
    appoint: opt.appoint || { type: 'ASAP' },
    note: String(opt.note || ''),
    manualEntry: images.length === 0
  };
  if (opt.delivery) payload.delivery = opt.delivery;
  return payload;
}

function summaryText(item) {
  return recognize.summarizeParcel(revalidateItem(item)) || '待补充';
}

function stepTitle(step) {
  return STEP_TITLES[step - 1] || '';
}

module.exports = {
  STEP_TITLES,
  MAX_PARCELS,
  MAX_IMAGES,
  appointmentSlots,
  stationOptions,
  stationName,
  serviceOptions,
  makeItem,
  revalidateItem,
  canSubmit,
  appointPayloadOf,
  buildImages,
  buildPayload,
  summaryText,
  stepTitle,
  // 提交幂等键生命周期（clientRequestId）
  SUBMISSION_ID_PATTERN,
  isSubmissionId,
  createSubmissionId,
  submissionFingerprint,
  ensureSubmission,
  clearSubmission,
  // 识别来源快照 + 逐件 AI 兜底决策
  recognitionSourceOf,
  confidenceOf,
  needsAiFallback,
  withManualEdit,
  applyAiFallbacks
};
