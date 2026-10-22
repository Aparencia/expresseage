// utils/storage.js · v4 唯一本地存储写口（键 ex_college_v4.store）
// 只存四样：最近角色 lastRole、引导已读标记 guides、草稿指针 draftPointer、取件清单本机勾选 pickupChecks。
// 边界（ENGINEERING §5.6）：不存身份标识 / 宿舍门牌 / 取件凭据等敏感值；不存切换会话的
// 票据与视角上下文；不读写 v1/v2/v3 的任何 storage 键（D2 裁决 2026-10-22：沿用 v3 appid
// `wxcb7e5b41b89bc806` ⇒ 同一 storage 命名空间；v4 只用本键 `ex_college_v4.store`，不碰 v3 的 `ex_college_v3.store`）。
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
const MEMORY = { value: '' };

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
    getStorageSync: function () {
      return MEMORY.value;
    },
    setStorageSync: function (key, value) {
      MEMORY.value = value;
    },
    removeStorageSync: function () {
      MEMORY.value = '';
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

function getDraftPointer(platform) {
  return load(platform).draftPointer;
}

function setDraftPointer(pointer, platform) {
  if (!isValidDraftPointer(pointer)) {
    return false;
  }
  return update(function (state) {
    state.draftPointer = pointer;
  }, platform);
}

function clearDraftPointer(platform) {
  return update(function (state) {
    state.draftPointer = null;
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

function clearAll(platform) {
  const api = resolvePlatform(platform);
  try {
    api.removeStorageSync(KEY);
    return true;
  } catch (err) {
    return false;
  }
}

module.exports = {
  KEY,
  ALLOWED_ROLES,
  GUIDE_KEYS,
  emptyState,
  normalize,
  isValidRole,
  isValidGuideKey,
  isValidDraftPointer,
  isValidPickupCheckKey,
  load,
  getLastRole,
  setLastRole,
  isGuideSeen,
  markGuideSeen,
  clearGuideSeen,
  getDraftPointer,
  setDraftPointer,
  clearDraftPointer,
  getPickupChecks,
  setPickupCheck,
  clearPickupChecks,
  clearAll
};
