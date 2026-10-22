// pkg-customer/pages/order-create/parts/bootstrap.js · 下单页启动装配（配置 / 对方公开资料 / 服务类型 / 本人宿舍）
// 纯件（零 wx）：页面只 setData；缓存命中不重复外呼（config 已在 store 时不请求）。
'use strict';

const store = require('../../../../store/index');
const bindApi = require('../../../../api/modules/bind');
const configApi = require('../../../../api/modules/config');
const customerApi = require('../../../../api/modules/customer');
const model = require('./model');

function loadConfig() {
  const cached = store.snapshot().config;
  if (cached && cached.privacyVersion) return Promise.resolve(cached);
  return configApi.getPublic().then(function done(config) {
    store.patch({ config: config });
    return config;
  }).catch(function fallback() {
    // 配置读取失败时服务类型退化为空列表，页面仍可手填下单
    return store.snapshot().config;
  });
}

function loadPartner() {
  return bindApi.getCurrent().then(function done(data) {
    return (data && data.partnerPublic) || null;
  }).catch(function fallback() {
    return null;
  });
}

// D25：配送地址默认本人宿舍——顾客本人资料里才有 zone/buildingNo/room，bootstrap 快照不带，故单取一次。
function loadProfile() {
  return customerApi.getProfile().then(function done(profile) {
    return profile || null;
  }).catch(function fallback() {
    return null;
  });
}

/** 启动装配：配置 + 对方公开资料 + 本人资料 → 服务类型选项 + 配送地址默认值（只展示兼职已启用项） */
function load() {
  return Promise.all([loadConfig(), loadPartner(), loadProfile()]).then(function done(results) {
    const config = results[0];
    const partnerPublic = results[1];
    const profile = results[2];
    return {
      config: config,
      partnerPublic: partnerPublic,
      profile: profile,
      services: model.serviceOptions(config, partnerPublic)
    };
  });
}

/** 服务类型目录变化后校准 serviceCode/serviceIndex（目录未到时回退第一项） */
function serviceIndexes(items, services) {
  const list = services || [];
  return (items || []).map(function map(item) {
    const next = Object.assign({}, item);
    let index = -1;
    for (let i = 0; i < list.length; i += 1) {
      if (list[i] && list[i].code === next.serviceCode) index = i;
    }
    next.serviceIndex = index >= 0 ? index : 0;
    next.serviceCode = list.length > 0 ? list[next.serviceIndex].code : '';
    return next;
  });
}

module.exports = {
  load,
  loadConfig,
  loadPartner,
  loadProfile,
  serviceIndexes
};
