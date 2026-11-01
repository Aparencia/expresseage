// pkg-customer/pages/bind/parts/service-view.js · 绑定预览「服务能力」展示纯件（零 wx）
// 口径：CONTRACT §6 / D41（2026-10-28 用户拍板「标准代取=送到寝室门口（上楼）、新增送至楼下=宿舍楼下/约定地点（不上楼）」）。
// 边界：只做展示字段适配——名称/说明取公开配置 serviceCatalog 单源（desc 由 shared/enums.js 派生，
//       前端不新增硬编码解释文案、不改 shared/enums.js 单源），未命中目录回退 code。
'use strict';

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// 预览只展示「已启用」项（enabled !== false，缺省视为启用）；同 code 去重保持兼职配置顺序
function enabledCodes(services) {
  const list = Array.isArray(services) ? services : [];
  const codes = [];
  list.forEach(function each(item) {
    const code = textOf(item && item.code);
    if (!code || item.enabled === false || codes.indexOf(code) >= 0) {
      return;
    }
    codes.push(code);
  });
  return codes;
}

function catalogEntryOf(catalog, code) {
  const list = Array.isArray(catalog) ? catalog : [];
  for (let i = 0; i < list.length; i += 1) {
    if (list[i] && list[i].code === code) {
      return list[i];
    }
  }
  return null;
}

// 预览卡服务能力两行：服务类型（名称串，口径与首页兼职卡一致）+ 说明行（逐项「名称：目录 desc」）
function capabilityOf(services, catalog) {
  const codes = enabledCodes(services);
  const names = [];
  const hints = [];
  codes.forEach(function each(code) {
    const hit = catalogEntryOf(catalog, code);
    const name = textOf(hit && hit.name) || code;
    names.push(name);
    const desc = textOf(hit && hit.desc);
    if (desc) {
      hints.push(name + '：' + desc);
    }
  });
  return {
    servicesText: names.length > 0 ? names.join(' / ') : '服务类型加载中',
    serviceHintText: hints.join('；')
  };
}

module.exports = {
  enabledCodes,
  capabilityOf
};
