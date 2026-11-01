// utils/storage.js · v4 唯一本地存储写口（两个键：ex_college_v4.store / ex_college_v4.pickcodes）
// 键 ① ex_college_v4.store 只存三样：最近角色 lastRole、引导已读标记 guides、取件清单本机勾选 pickupChecks。
//     （draftPointer 仅为 normalize 白名单里的历史脏值剥离项，生产不读不写，见 ENGINEERING §5.6）
// 键 ② ex_college_v4.pickcodes = 顾客「我的取件码（本机）」清单（D57，2026-11-01 用户拍板）：
//     L3 明文存本机的唯一例外——只存本机、不上传/不进日志/通知/分享/URL、兼职与后台不可见、
//     上限 50 条按码去重、最新在前、可一键清空；结构 {v:1, items:[{code,stationId,stationName,checked,addedAt}]}。
// 边界（ENGINEERING §5.6）：不存身份标识 / 宿舍门牌 / 其余 L3 敏感值；不存切换会话的票据与视角上下文；
// 不读写 v1/v2/v3 的任何 storage 键（D2 裁决 2026-10-22：沿用 v3 appid `wxcb7e5b41b89bc806`
// ⇒ 同一 storage 命名空间；v4 只读写上面两个键，不碰 v3 的 `ex_college_v3.store`）。
// 门禁 ENGINEERING §8.2 #15：平台存储 API 只允许出现在本文件，页面/组件一律经本模块。
'use strict';

const KEY = 'ex_college_v4.store';
const ALLOWED_ROLES = ['CUSTOMER', 'PARTNER'];
// 引导已读标记：只认这两项（纯 UI 偏好，不含业务数据；换账号/清缓存会重看）。
const GUIDE_KEYS = ['CUSTOMER_HOME_V1', 'PARTNER_WORKBENCH_V1'];
const POINTER_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
// 取件清单本机勾选（D26）：key = `{orderNo}#{itemIndex}`，值=勾选时间戳（毫秒）。
// 只存"我已取到"的布尔标记，不存取件码/站点/地址等业务内容；上限 200 条，超出丢最旧。
const PICKUP_CHECK_PATTERN = /^[0-9]{8}-[0-9]{4}#[0-9]{1,2}$/;
const PICKUP_CHECK_MAX = 200;
// 无平台注入时的内存兜底：按键隔离（两个键互不覆盖；测试/非小程序环境用）。
const MEMORY = Object.create(null);

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function emptyState() {
  return { lastRole: null, guides: {}, draftPointer: null, pickupChecks: {} };
}

function isValidRole(role) {
  return ALLOWED_ROLES.indexOf(role) >= 0;
}

function isValidGuideKey(key) {
  return GUIDE_KEYS.indexOf(key) >= 0;
}

function isValidDraftPointer(pointer) {
  return typeof pointer === 'string' && POINTER_PATTERN.test(pointer);
}

function isValidPickupCheckKey(key) {
  return typeof key === 'string' && PICKUP_CHECK_PATTERN.test(key);
}

// 归一取件勾选：只保留合法 key + 数值时间戳；超过上限按时间戳丢最旧（保持确定性）。
function normalizePickupChecks(raw) {
  const out = {};
  if (!isPlainObject(raw)) {
    return out;
  }
  const entries = [];
  Object.keys(raw).forEach(function (key) {
    const ts = raw[key];
    if (isValidPickupCheckKey(key) && typeof ts === 'number' && isFinite(ts) && ts > 0) {
      entries.push({ key: key, ts: ts });
    }
  });
  entries.sort(function (a, b) {
    return a.ts - b.ts;
  });
  entries.slice(Math.max(0, entries.length - PICKUP_CHECK_MAX)).forEach(function (item) {
    out[item.key] = item.ts;
  });
  return out;
}

function normalizeGuides(raw) {
  const out = {};
  if (!isPlainObject(raw)) {
    return out;
  }
  GUIDE_KEYS.forEach(function (key) {
    if (raw[key] === true) {
      out[key] = true;
    }
  });
  return out;
}

// 白名单归一：只保留合法字段，其余（含历史遗留/误写的敏感键）一律丢弃。
function normalize(raw) {
  const state = emptyState();
  if (!isPlainObject(raw)) {
    return state;
  }
  if (isValidRole(raw.lastRole)) {
    state.lastRole = raw.lastRole;
  }
  state.guides = normalizeGuides(raw.guides);
  if (isValidDraftPointer(raw.draftPointer)) {
    state.draftPointer = raw.draftPointer;
  }
  state.pickupChecks = normalizePickupChecks(raw.pickupChecks);
  return state;
}

function parseRaw(raw) {
  if (isPlainObject(raw)) {
    return raw;
  }
  if (typeof raw !== 'string' || !raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function memoryPlatform() {
  return {
    getStorageSync: function (key) {
      return MEMORY[key] === undefined ? '' : MEMORY[key];
    },
    setStorageSync: function (key, value) {
      MEMORY[key] = value;
    },
    removeStorageSync: function (key) {
      delete MEMORY[key];
    }
  };
}

function resolvePlatform(platform) {
  if (
    platform &&
    typeof platform.getStorageSync === 'function' &&
    typeof platform.setStorageSync === 'function' &&
    typeof platform.removeStorageSync === 'function'
  ) {
    return platform;
  }
  if (typeof wx !== 'undefined' && wx && typeof wx.getStorageSync === 'function') {
    return {
      getStorageSync: function (key) {
        return wx.getStorageSync(key);
      },
      setStorageSync: function (key, value) {
        wx.setStorageSync(key, value);
      },
      removeStorageSync: function (key) {
        wx.removeStorageSync(key);
      }
    };
  }
  return memoryPlatform();
}

function load(platform) {
  const api = resolvePlatform(platform);
  let raw = '';
  try {
    raw = api.getStorageSync(KEY);
  } catch (err) {
    raw = '';
  }
  return normalize(parseRaw(raw));
}

function persist(state, api) {
  const safe = normalize(state);
  try {
    api.setStorageSync(KEY, JSON.stringify(safe));
    return safe;
  } catch (err) {
    return null;
  }
}

function update(mutator, platform) {
  const api = resolvePlatform(platform);
  const state = load(api);
  mutator(state);
  return !!persist(state, api);
}

function getLastRole(platform) {
  return load(platform).lastRole;
}

function setLastRole(role, platform) {
  if (!isValidRole(role)) {
    return false;
  }
  return update(function (state) {
    state.lastRole = role;
  }, platform);
}

function isGuideSeen(key, platform) {
  if (!isValidGuideKey(key)) {
    return false;
  }
  return load(platform).guides[key] === true;
}

function markGuideSeen(key, platform) {
  if (!isValidGuideKey(key)) {
    return false;
  }
  return update(function (state) {
    state.guides[key] = true;
  }, platform);
}

function clearGuideSeen(key, platform) {
  if (!isValidGuideKey(key)) {
    return false;
  }
  return update(function (state) {
    delete state.guides[key];
  }, platform);
}

// 取件清单本机勾选（D26）：只用于"我已取到"的视觉标记，不回写服务端、不影响订单状态。
function getPickupChecks(platform) {
  return load(platform).pickupChecks;
}

function setPickupCheck(key, checked, platform) {
  if (!isValidPickupCheckKey(key)) {
    return false;
  }
  return update(function (state) {
    if (checked === true) {
      state.pickupChecks[key] = Date.now();
    } else {
      delete state.pickupChecks[key];
    }
    state.pickupChecks = normalizePickupChecks(state.pickupChecks);
  }, platform);
}

function clearPickupChecks(platform) {
  return update(function (state) {
    state.pickupChecks = {};
  }, platform);
}

// ── 本机取件码清单（D57，2026-11-01 用户拍板）──────────────────────────────────
// 独立键 + 独立归一白名单：不并入 ex_college_v4.store（清勾选/票据剥离互不影响）。
// 读写永不抛：脏 JSON / 非法条目静默归一（丢弃或按形态收口），平台异常收口为 ok:false 或空清单。
// 上限 50 条、按 code 去重（先到先得；后者带站点可补前者空站点）、最新在前、超限丢最旧。
const PICKCODES_KEY = 'ex_college_v4.pickcodes';
const LOCAL_CODE_MAX = 50;
const LOCAL_CODE_PATTERN = /^[0-9A-Za-z][0-9A-Za-z\-_#]{3,39}$/;
const LOCAL_STATION_PATTERN = /^P[1-8]$/;
const LOCAL_STATION_NAME_MAX = 20;

// 码归一：去首尾空白 + 去所有内部空白后 4~40 位；不合法返回 ''
function normalizeLocalCode(raw) {
  if (typeof raw !== 'string') {
    return '';
  }
  const code = raw.trim().replace(/\s+/g, '');
  return LOCAL_CODE_PATTERN.test(code) ? code : '';
}

function normalizeLocalStationId(raw) {
  return typeof raw === 'string' && LOCAL_STATION_PATTERN.test(raw) ? raw : '';
}

function normalizeLocalStationName(raw) {
  if (typeof raw !== 'string') {
    return '';
  }
  return raw.trim().slice(0, LOCAL_STATION_NAME_MAX);
}

// 单条归一白名单：非法条目返回 null（调用方计入 skipped 或静默丢弃）；未知字段一律不保留。
function normalizeLocalEntry(raw, fallbackAt) {
  if (!isPlainObject(raw)) {
    return null;
  }
  const code = normalizeLocalCode(raw.code);
  if (!code) {
    return null;
  }
  const at = raw.addedAt;
  return {
    code: code,
    stationId: normalizeLocalStationId(raw.stationId),
    stationName: normalizeLocalStationName(raw.stationName),
    checked: raw.checked === true,
    addedAt: typeof at === 'number' && isFinite(at) && at > 0 ? Math.floor(at) : fallbackAt
  };
}

function findLocalEntry(items, code) {
  for (let i = 0; i < items.length; i += 1) {
    if (items[i].code === code) {
      return items[i];
    }
  }
  return null;
}

// 归一：按 code 去重（先到先得、后到补站点）→ 最新在前 → 截到上限（丢最旧）。
function normalizeLocalItems(rawItems) {
  const out = [];
  const byCode = Object.create(null);
  (Array.isArray(rawItems) ? rawItems : []).forEach(function (raw) {
    const entry = normalizeLocalEntry(raw, 0);
    if (!entry) {
      return;
    }
    const prev = byCode[entry.code];
    if (prev) {
      if (!prev.stationId && entry.stationId) {
        prev.stationId = entry.stationId;
        prev.stationName = entry.stationName;
      }
      return;
    }
    byCode[entry.code] = entry;
    out.push(entry);
  });
  out.sort(function newestFirst(a, b) {
    return b.addedAt - a.addedAt;
  });
  return out.slice(0, LOCAL_CODE_MAX);
}

function loadLocalItems(api) {
  let raw = '';
  try {
    raw = api.getStorageSync(PICKCODES_KEY);
  } catch (err) {
    raw = '';
  }
  const parsed = parseRaw(raw);
  return normalizeLocalItems(parsed ? parsed.items : []);
}

function persistLocalItems(items, api) {
  try {
    api.setStorageSync(PICKCODES_KEY, JSON.stringify({ v: 1, items: normalizeLocalItems(items) }));
    return true;
  } catch (err) {
    return false;
  }
}

/** 读本机取件码清单：{v:1, items}（缺键/脏 JSON/读失败一律给空清单；条目已归一、最新在前 ≤50） */
function loadLocalCodes(platform) {
  const api = resolvePlatform(platform);
  return { v: 1, items: loadLocalItems(api) };
}

/**
 * 批量添加本机取件码（页面把解析结果直接入库）。
 * @param {Array<{code:string, stationId?:string, stationName?:string, checked?:boolean, addedAt?:number}>} entries
 * @returns {{ok:boolean, added:number, skipped:number, items:object[]}}
 *   added=本次真正加入的条数（去重/非法之后的新增；含随后因上限被挤掉的新条目，页面据此算挤掉几条）；
 *   skipped=未加入条数（非法 + 已存在重复；重复且本次带站点而旧条目站点为空时补全旧条目）；
 *   items=写入后的完整清单（写失败时回旧清单，ok:false 由页面提示重试）。
 */
function addLocalCodes(entries, platform) {
  const api = resolvePlatform(platform);
  const items = loadLocalItems(api);
  const input = Array.isArray(entries) ? entries : [];
  // 未显式给 addedAt 时按入参顺序递推（后加入的更新，同一批里超限丢的是最前面的）：
  // 以「now - (批大小-1)」为基准，保证本批时间戳都 ≤ now、且后续批次的 now 不会比本批更旧。
  const base = Date.now() - Math.max(0, input.length - 1);
  const fresh = [];
  let skipped = 0;
  input.forEach(function each(raw, index) {
    const entry = normalizeLocalEntry(raw, base + index);
    if (!entry) {
      skipped += 1;
      return;
    }
    const dup = findLocalEntry(items, entry.code) || findLocalEntry(fresh, entry.code);
    if (dup) {
      if (!dup.stationId && entry.stationId) {
        dup.stationId = entry.stationId;
        dup.stationName = entry.stationName;
      }
      skipped += 1;
      return;
    }
    fresh.push(entry);
  });
  const ok = persistLocalItems(fresh.concat(items), api);
  return { ok: ok, added: fresh.length, skipped: skipped, items: ok ? loadLocalItems(api) : items };
}

/** 删除一条（按归一的 code 精确匹配）；非法码或不存在 → ok:false（items 回当前清单供页面刷新） */
function removeLocalCode(code, platform) {
  const api = resolvePlatform(platform);
  const items = loadLocalItems(api);
  const target = normalizeLocalCode(code);
  if (!target) {
    return { ok: false, items: items };
  }
  const next = items.filter(function keep(item) {
    return item.code !== target;
  });
  if (next.length === items.length) {
    return { ok: false, items: items };
  }
  const ok = persistLocalItems(next, api);
  return { ok: ok, items: ok ? loadLocalItems(api) : items };
}

/** 本机「我已取到」标记（只影响本机显示，不上传、不改订单）；不存在/非法码 → ok:false */
function setLocalCodeChecked(code, checked, platform) {
  const api = resolvePlatform(platform);
  const items = loadLocalItems(api);
  const target = normalizeLocalCode(code);
  const hit = target ? findLocalEntry(items, target) : null;
  if (!hit) {
    return { ok: false, items: items };
  }
  hit.checked = checked === true;
  const ok = persistLocalItems(items, api);
  return { ok: ok, items: ok ? loadLocalItems(api) : items };
}

/** 一键清空本机取件码（只清本键，不动 ex_college_v4.store 的勾选/引导/角色） */
function clearLocalCodes(platform) {
  const api = resolvePlatform(platform);
  try {
    api.removeStorageSync(PICKCODES_KEY);
    return true;
  } catch (err) {
    return false;
  }
}

// 清本机数据（换账号/隐私清理）：两个键一起删（D57 本机取件码也属本机数据，一并清）
function clearAll(platform) {
  const api = resolvePlatform(platform);
  let ok = true;
  [KEY, PICKCODES_KEY].forEach(function remove(key) {
    try {
      api.removeStorageSync(key);
    } catch (err) {
      ok = false;
    }
  });
  return ok;
}

module.exports = {
  KEY,
  PICKCODES_KEY,
  ALLOWED_ROLES,
  GUIDE_KEYS,
  LOCAL_CODE_MAX,
  emptyState,
  normalize,
  isValidRole,
  isValidGuideKey,
  isValidPickupCheckKey,
  load,
  getLastRole,
  setLastRole,
  isGuideSeen,
  markGuideSeen,
  clearGuideSeen,
  getPickupChecks,
  setPickupCheck,
  clearPickupChecks,
  loadLocalCodes,
  addLocalCodes,
  removeLocalCode,
  setLocalCodeChecked,
  clearLocalCodes,
  clearAll
};
