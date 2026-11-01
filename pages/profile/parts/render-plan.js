// pages/profile/parts/render-plan.js · 我的页渲染计划纯件（零 wx、零 setData）
// 口径（PERFORMANCE_2026-11-01 §5 P0-4）：store 通知扇出很密（每个成功响应都会 notify），
// 「我的」是 tab 页、被页面栈留在后台时不能继续全量 setData：
//   ① 页面隐藏时挂起——不 build 视图模型、不读版本号同步 API、0 批 setData；onShow 再补刷；
//   ② 可见时按视图模型判等——同键 0 批，变化才 1 批下发（loading/readonly/canEdit/派生同批）。
// 多店/多角色逻辑保持：isCustomer/showSwitchRole 等仍从 buildVm 结果逐字段下发（口径不变）。
'use strict';

// 判等键：视图模型 + 渲染时的模式开关（readonly/canEdit/editMode）稳定序列化。
// buildVm 是纯对象（同输入同 key 序），无变化 → 同键 → 页面跳过 setData。
function viewKeyOf(built, options) {
  const source = options || {};
  const payload = [built || null, source.readonly === true, source.canEdit === true, source.editMode === true];
  try {
    return JSON.stringify(payload);
  } catch (err) {
    return '';
  }
}

// 一次 setData 的完整补丁（与旧页面 refresh 的字段逐项同口径，只多不少）。
function patchOf(built, options) {
  const vm = built || {};
  const source = options || {};
  const canEdit = source.canEdit === true;
  const roles = Array.isArray(vm.roles) ? vm.roles : [];
  return Object.assign({}, vm, {
    loading: false,
    readonly: source.readonly === true,
    canEdit: canEdit,
    editMode: source.editMode === true && canEdit,
    showSwitchRole: roles.length > 1 && vm.viewSession !== true && canEdit && vm.closed !== true,
    version: source.version || '开发版'
  });
}

// 渲染计划：{apply, reason, key, patch}。
// build 是注入的取值入口（页面隐藏时不调用 → buildVm/modeGuard/readVersion 都不跑）。
function refreshPlanOf(input) {
  const ctx = input || {};
  if (ctx.hidden === true) {
    return { apply: false, reason: 'hidden', key: ctx.lastKey || '', patch: null };
  }
  const built = typeof ctx.build === 'function' ? ctx.build() : null;
  const vm = built ? built.vm : null;
  const options = built || {};
  options.editMode = ctx.editMode === true;
  const key = viewKeyOf(vm, options);
  if (ctx.lastKey === key) {
    return { apply: false, reason: 'same', key: key, patch: null };
  }
  return {
    apply: true,
    reason: ctx.lastKey ? 'changed' : 'cold',
    key: key,
    patch: patchOf(vm, options)
  };
}

module.exports = {
  refreshPlanOf
};
