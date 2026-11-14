// utils/subscribe.js · 一次性订阅（服务通知）客户端授权适配（批 31 / D73）
// 纯件：从公开配置取模板 ID、判断是否展示入口；平台调用只在此文件（页面零 wx.requestSubscribeMessage）。
// 真值口径：微信 success 回调按模板返回 accept/reject/ban/filter——只有 accept 才算用户允许（禁止假成功）。
'use strict';

const REQUEST_TIMEOUT_MS = 15000;

// resultText 五态文案；未知/空串 → ''，调用方必须给中性兜底，不得冒充成功。
const RESULT_TEXT = {
  accept: '已开启',
  reject: '没开启，可在小程序设置里修改',
  ban: '提醒被平台限制，可在小程序设置里修改',
  filter: '该提醒暂不可用，请稍后再试'
};

// 20004（用户关闭订阅消息主开关）引导文案：按角色/场景说对提醒名与再次开启时机。
const GUIDE_COPY = {
  customer: {
    content: '你在微信设置里关闭了「订阅消息」总开关，收不到送达提醒。打开「订阅消息」后，下次下单可再次开启。',
    toast: '打开「订阅消息」后，下次下单会再次询问'
  },
  partner: {
    content: '你在微信设置里关闭了「订阅消息」总开关，收不到新单提醒。打开「订阅消息」后，接单前可再次开启。',
    toast: '打开「订阅消息」后，接单前会再次询问'
  },
  profile: {
    content: '你在微信设置里关闭了「订阅消息」总开关，收不到微信提醒。打开「订阅消息」后，可再次点击此处开启。',
    toast: '打开「订阅消息」后，可再次点击此处开启'
  }
};

function enabledOf(config) {
  return !!(config && config.subscribeEnabled === true);
}

function idsOf(config) {
  const ids = (config && config.subscribeTemplateIds) || {};
  return {
    delivered: typeof ids.delivered === 'string' ? ids.delivered : '',
    newOrder: typeof ids.newOrder === 'string' ? ids.newOrder : ''
  };
}

function planForOrderSubmit(config) {
  if (!enabledOf(config)) return [];
  const id = idsOf(config).delivered;
  return id ? [id] : [];
}

function planForPartnerTap(config) {
  if (!enabledOf(config)) return [];
  const id = idsOf(config).newOrder;
  return id ? [id] : [];
}

// 只取 ids 对应键（忽略 errMsg 等其它键），值归一为字符串（缺键 → ''）。
function statusesOf(ids, res) {
  const out = {};
  const list = Array.isArray(ids) ? ids : [];
  const source = res && typeof res === 'object' ? res : {};
  list.forEach(function pick(id) {
    if (typeof id !== 'string' || !id) return;
    const value = source[id];
    out[id] = value === undefined || value === null ? '' : String(value);
  });
  return out;
}

// 只有全部模板都 accept 才算用户允许（本批一次只带 1 个模板）。
function acceptedOf(statuses) {
  const source = statuses && typeof statuses === 'object' ? statuses : {};
  const keys = Object.keys(source);
  return keys.length > 0 && keys.every(function isAccept(key) { return source[key] === 'accept'; });
}

// statuses → 人话：全 accept=已开启；含 reject/ban/filter=对应未开启原因；未知=''。
function resultText(statuses) {
  const source = statuses && typeof statuses === 'object' ? statuses : {};
  const values = Object.keys(source).map(function valueOf(key) { return source[key]; });
  if (!values.length) return '';
  if (values.every(function isAccept(value) { return value === 'accept'; })) return RESULT_TEXT.accept;
  const blocked = values.filter(function isBlocked(value) { return value && value !== 'accept'; })[0];
  return (blocked && RESULT_TEXT[blocked]) || '';
}

// 读取 wx.getSetting({withSubscriptions:true}) 的单模板状态（纯件，页面/工作台共用）。
// 平台事实：订阅消息没有应用内开关；on=用户已授权（可引导去设置关闭），off=未开启（可再次请求）。
function settingStatusOf(settings, templateId) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const all = source.subscriptionsSetting || {};
  if (all.mainSwitch === false) {
    return { state: 'blocked', text: '已关闭（去设置）' };
  }
  const value = (all.itemSettings || {})[templateId];
  if (value === 'accept') {
    return { state: 'on', text: '已开启' };
  }
  if (value === 'reject') {
    return { state: 'off', text: '未开启（点此开启）' };
  }
  return { state: 'off', text: '未开启（点此开启）' };
}

// 平台调用同步发起（保点击手势）；15s 兜底 resolve 为 timeout，绝不 reject、绝不重复 resolve。
function request(tmplIds) {
  return new Promise(function run(resolve) {
    const ids = Array.isArray(tmplIds) ? tmplIds.filter(Boolean) : [];
    if (!ids.length) {
      console.warn('[subscribe] skipped: empty template list');
      resolve({ ok: false, skipped: 'empty', statuses: {} });
      return;
    }
    if (typeof wx === 'undefined' || typeof wx.requestSubscribeMessage !== 'function') {
      console.warn('[subscribe] skipped: wx.requestSubscribeMessage unavailable');
      resolve({ ok: false, skipped: 'unsupported', statuses: {} });
      return;
    }
    let settled = false;
    let timer = null;
    function finish(payload) {
      if (settled) return;
      settled = true;
      if (timer) { clearTimeout(timer); timer = null; }
      resolve(payload);
    }
    function failWith(error) {
      console.warn('[subscribe] request failed', (error && (error.errCode || error.errMsg)) || '');
      finish({ ok: false, error: error || {}, skipped: '', statuses: {} });
    }
    timer = setTimeout(function onTimeout() {
      console.warn('[subscribe] request timeout');
      finish({ ok: false, skipped: 'timeout', statuses: {} });
    }, REQUEST_TIMEOUT_MS);
    if (timer && typeof timer.unref === 'function') timer.unref();
    try {
      wx.requestSubscribeMessage({
        tmplIds: ids,
        success: function onOk(res) {
          const source = res || {};
          finish({ ok: true, result: source, statuses: statusesOf(ids, source) });
        },
        fail: function onFail(err) { failWith(err); }
      });
    } catch (error) {
      failWith(error);
    }
  });
}

// 20004 = 用户在「小程序设置 → 订阅消息」关闭了主开关；只能引导去设置页手动打开，代码不能代开。
function isMainSwitchOff(result) {
  const error = result && result.error;
  const code = error && (error.errCode || error.errcode);
  return Number(code) === 20004;
}

function openSetting() {
  return new Promise(function run(resolve) {
    if (typeof wx === 'undefined' || typeof wx.openSetting !== 'function') {
      resolve({ ok: false });
      return;
    }
    try {
      wx.openSetting({
        success: function onOk(res) { resolve({ ok: true, result: res || {} }); },
        fail: function onFail() { resolve({ ok: false }); }
      });
    } catch (error) {
      resolve({ ok: false });
    }
  });
}

function guideCopyOf(scene) {
  return GUIDE_COPY[scene] || GUIDE_COPY.profile;
}

let mainSwitchGuided = false;

// 一次会话最多引导一次，避免每次动作都打断；scene ∈ customer|partner|profile 决定文案（角色不串）。
function guideMainSwitch(scene) {
  if (mainSwitchGuided) return;
  mainSwitchGuided = true;
  if (typeof wx === 'undefined' || typeof wx.showModal !== 'function') return;
  const copy = guideCopyOf(scene);
  wx.showModal({
    title: '提醒未开启',
    content: copy.content,
    confirmText: '去设置',
    cancelText: '暂不',
    success: function onChoose(res) {
      if (!res.confirm) return;
      openSetting().then(function afterOpen(result) {
        if (result.ok && typeof wx.showToast === 'function') {
          wx.showToast({ title: copy.toast, icon: 'none' });
        }
      });
    }
  });
}

module.exports = {
  enabledOf,
  idsOf,
  planForOrderSubmit,
  planForPartnerTap,
  statusesOf,
  settingStatusOf,
  acceptedOf,
  resultText,
  request,
  isMainSwitchOff,
  openSetting,
  guideMainSwitch
};
