// utils/maintenance.js · 维护模式端侧纯件（零 wx、可直测）
// 口径：CONTRACT §5.3 config.getPublic 的 maintenance；DATA_MODEL §2.10 `maintenance{enabled,text}`；
//       UX_DEVELOPER §7.5「顾客/兼职端全屏公告 + 写接口拒绝（INVALID_STATE），读与切换会话不受影响」。
// 用法：const view = buildMaintenanceView(store.get('config')) → {enabled,text,title,blocked,copy}；
//       写动作失败：writeRejectedTextOf(err) 非空则用统一维护文案上屏（不吞错、不暴露英文 code）。
'use strict';

const DEFAULT_TITLE = '系统维护中';
const DEFAULT_TEXT = '系统维护中，请稍后再来；急单请留言或联系开发者。';
const WRITE_REJECTED_TEXT = '系统维护中，暂时不能提交；急单请留言或联系开发者。';
const MAINTENANCE_CODE = 'INVALID_STATE';

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// configPublic 或 maintenance 单对象都接受；缺失/非法一律回「未维护」，不猜。
function maintenanceOf(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { enabled: false, text: '' };
  }
  const source = Object.prototype.hasOwnProperty.call(config, 'maintenance') ? config.maintenance : config;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return { enabled: false, text: '' };
  }
  return { enabled: source.enabled === true, text: textOf(source.text) };
}

/**
 * 维护视图（页面全屏遮罩 + 写动作禁用共用）：
 *   {enabled:boolean, text:string, title:string, blocked:boolean, copy:string}
 * 未维护：全空串/false（页面直接隐藏）；维护中 text 为空 → 兜底真话文案，不显示占位符。
 */
function buildMaintenanceView(config, opts) {
  const options = opts || {};
  const state = maintenanceOf(config);
  if (!state.enabled) {
    return { enabled: false, text: '', title: '', blocked: false, copy: '' };
  }
  return {
    enabled: true,
    text: state.text || textOf(options.defaultText) || DEFAULT_TEXT,
    title: textOf(options.title) || DEFAULT_TITLE,
    blocked: true,
    copy: WRITE_REJECTED_TEXT
  };
}

// 服务端维护闸错误（middleware/auth.js）：INVALID_STATE + message 含「维护」；
// 隐私同意闸同为 INVALID_STATE 但文案不同，不能误判成维护。
function isMaintenanceError(err) {
  return !!err && err.code === MAINTENANCE_CODE && /维护/.test(String(err.message || ''));
}

/**
 * 写动作被拒的统一维护文案：命中维护错误返回文案，否则空串（调用方回落到原错误文案）。
 */
function writeRejectedTextOf(err) {
  return isMaintenanceError(err) ? WRITE_REJECTED_TEXT : '';
}

module.exports = {
  buildMaintenanceView,
  writeRejectedTextOf
};
