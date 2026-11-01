// pages/customer/home/parts/render-plan.js · 首页渲染批次纯件（零 wx、零 setData）
// 口径（PERFORMANCE_2026-11-01 §5 P0-4 / UX_CUSTOMER §0.3）：
//   一次 refresh 的 setData 从「4 批」收口为「2 批」：
//     第 1 批 = refresh 结果 + 全部派生字段（不再先 setData 结果、再单独 applyDerived 一批）；
//     第 2 批 = 单次 store.patch（config/binding/badges 合并为一次通知）触发 sync，vm + 派生同批下发。
//   页面隐藏（_hidden）时订阅回调挂起：0 次 build/0 批 setData，onShow 再补。
// 说明：派生值（兼职卡/服务范围/下单前置原因/维护遮罩）与旧页面 applyDerived 逐字段同口径，纯件便于单测。
'use strict';

const homeView = require('./home-view');
const maintenance = require('../../../../utils/maintenance');
const ordersView = require('../../parts/orders-view');
const format = require('../../parts/format');

// 公告配置：{enabled,title,text}；enabled=false 一律不展示（DATA_MODEL §2.10）
function announcementOf(config) {
  const value = config && config.announcement;
  if (!value || value.enabled === false) {
    return '';
  }
  return format.announcementText(value);
}

// 派生展示批次（旧页面 applyDerived 的纯件化）：readonly/公告/兼职卡/服务文案/范围/下单预检/维护遮罩。
// 返回 { patch, view }：patch 进 setData；view 是页面 _maintenanceView（写动作拦截用，不进 data）。
function derivedOf(input) {
  const ctx = input || {};
  const vm = ctx.vm || {};
  const partner = ctx.partnerPublic || null;
  const config = vm.config || {};
  const customer = vm.customer || {};
  const viewContext = vm.viewContext || null;
  const readonly = !!(viewContext && viewContext.viewMode === 'READONLY');
  const maintenanceView = maintenance.buildMaintenanceView(config);
  const maintenanceClosed = maintenanceView.enabled && ctx.maintenanceClosed === maintenanceView.text;
  // 下单前置预检（P1-6）：维护 > 资料 > 绑定 > 只读 > 接单开关 > 服务范围；本地仅预检，服务端仍是唯一权威
  const reason = homeView.orderBlockReasonOf({
    maintenanceText: maintenanceView.enabled ? maintenanceView.title : '',
    profileComplete: customer.profileComplete === true,
    bound: !!(vm.binding && vm.binding.bindingId),
    readonly: readonly,
    partnerClosed: !!(partner && partner.acceptingOrders === false),
    zoneAllowed: homeView.zoneAllowedOf(partner, customer.zone, config.zoneLabels)
  });
  return {
    view: maintenanceView,
    patch: {
      readonly: readonly,
      announcement: announcementOf(config),
      partnerCard: homeView.partnerCardOf(vm.binding, partner),
      servicesText: homeView.serviceTextOf(partner, config.serviceCatalog || []),
      scopeText: homeView.scopeTextOf(partner, config.zoneLabels),
      canOrder: reason === '',
      orderDisabledReason: reason,
      maintenance: {
        visible: maintenanceView.enabled && !maintenanceClosed,
        title: maintenanceView.title,
        text: maintenanceView.text
      }
    }
  };
}

function refsOf(vm) {
  const source = vm || {};
  return {
    customer: source.customer,
    binding: source.binding,
    config: source.config,
    viewContext: source.viewContext,
    badges: source.badges
  };
}

// 引用判等（P0-6/P0-4）：五个 store 引用都没变 → 无关通知不重渲染
function refsChanged(lastRefs, refs) {
  const last = lastRefs || {};
  return last.customer !== refs.customer || last.binding !== refs.binding
    || last.config !== refs.config || last.viewContext !== refs.viewContext
    || last.badges !== refs.badges;
}

// P1-5：订单 tab 数量角标 = 进行中订单数（不清零；只在变化时跟随 refresh 写一次 store）
function ongoingBadgesPatchOf(currentBadges, counts) {
  const current = currentBadges || {};
  const total = Number(counts && counts.ongoing);
  const ongoing = isFinite(total) && total > 0 ? Math.floor(total) : 0;
  if (current.ordersOngoing === ongoing) {
    return null;
  }
  return Object.assign({}, current, { ordersOngoing: ongoing });
}

// 订阅回调渲染计划：隐藏 → 0 批（挂起）；引用无变化 → 0 批；变化 → 1 批（vm + 派生合并）。
function syncPlanOf(input) {
  const ctx = input || {};
  if (ctx.hidden === true) {
    return { apply: false, reason: 'hidden' };
  }
  const vm = typeof ctx.readVm === 'function' ? ctx.readVm() : {};
  const refs = refsOf(vm);
  if (!refsChanged(ctx.lastRefs, refs)) {
    return { apply: false, reason: 'same', refs: refs };
  }
  const derived = derivedOf({ vm: vm, partnerPublic: ctx.partnerPublic, maintenanceClosed: ctx.maintenanceClosed });
  return {
    apply: true,
    reason: 'changed',
    refs: refs,
    view: derived.view,
    patch: Object.assign({ vm: vm }, derived.patch)
  };
}

// refresh 渲染计划：返回 { batches, setData(第 1 批), store(单次 store.patch), view }。
// batches = 1（第 1 批）+ 1（post-patch 通知触发的 sync 第 2 批）；store 永含 binding → 常态恒为 2。
function refreshPlanOf(input) {
  const ctx = input || {};
  const current = ctx.current || {};
  const config = ctx.config || current.config || {};
  const binding = ctx.binding || null;
  const partnerPublic = ctx.partnerPublic || null;
  const order = ctx.order || null;
  const bindingRef = binding ? Object.assign({}, binding, { partnerPublic: partnerPublic }) : null;
  const badges = ongoingBadgesPatchOf(current.badges, ctx.counts);
  const store = { binding: bindingRef };
  if (ctx.config) {
    store.config = ctx.config;
  }
  if (badges) {
    store.badges = badges;
  }
  const vm = {
    customer: current.customer,
    binding: bindingRef,
    config: config,
    viewContext: current.viewContext,
    badges: badges || current.badges
  };
  const derived = derivedOf({ vm: vm, partnerPublic: partnerPublic, maintenanceClosed: ctx.maintenanceClosed });
  const setData = {
    loading: false,
    partnerPublic: partnerPublic,
    order: order,
    orderRow: order ? ordersView.rowView(order, { nowMs: ctx.nowMs, config: config }) : null,
    waitedText: order ? '更新于 ' + format.formatTimeAgo(order.statusUpdatedAt) : ''
  };
  return {
    batches: Object.keys(store).length ? 2 : 1,
    setData: Object.assign(setData, derived.patch),
    store: store,
    view: derived.view
  };
}

module.exports = {
  derivedOf,
  syncPlanOf,
  refreshPlanOf
};
