// pkg-partner/pages/create-on-behalf/parts/preset-model.js · `?bindingId=` 预置态纯件（零 wx、零请求）
// 口径：docs/V4_UX_PARTNER.md §3.4（已绑定路径按 bindingId 定位；顾客列表/档案行「代客下单」带参数进入）
// 边界：命中才选中；未命中不猜（bindingIndex=-1 → 「请选择顾客」态，不默认第 0 位误建单）。
'use strict';

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function listOf(value) {
  return Array.isArray(value) ? value : [];
}

// 无 bindingId 时原样返回（普通入口沿用默认路径）；未命中不猜，交用户手选/切新顾客
function applyPresetBinding(state, bindingId) {
  const source = state || {};
  const preset = textOf(bindingId);
  if (!preset) {
    return source;
  }
  const options = listOf(source.bindingOptions);
  for (let index = 0; index < options.length; index += 1) {
    if (options[index] && options[index].bindingId === preset) {
      return Object.assign({}, source, { customerMode: 'BOUND', bindingIndex: index, presetMiss: false });
    }
  }
  return Object.assign({}, source, { customerMode: 'BOUND', bindingIndex: -1, presetMiss: true });
}

module.exports = {
  applyPresetBinding
};
