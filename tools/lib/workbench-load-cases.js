'use strict';
/**
 * tools/lib/workbench-load-cases.js — 工作台 P 组「迟到响应守卫」用例表（2026-11-26 真机反馈修复）。
 *
 * 背景（真机症状）：兼职工作台数据有时会乱跳、短暂显示「之前的数据」。根因 = 主列表加载没有请求代次守卫：
 *   30s 轮询 + 读动作自动重试（单次读最长在飞约 31s）+ 写后刷新/切 chip/搜索防抖/触底分页会叠在同一个
 *   在飞请求上，旧响应晚到时把新状态覆盖（行状态往回跳、旧行复活、红点回退、迟到失败弹假错）。
 * 判据（本表）：上表六类时序在真实代码路径（parts/load-flow + parts/load-view）上必须丢弃旧包；
 *   外加 isStaleRequest 真值表与三条接线静态闸（删守卫即红）。
 * 纪律：不 mock 全局 wx（唯一允许的桩 = api/client 的 transport 注入点）；样本非空；先合法基线再反例。
 *
 * 非独立套件：由 tools/selftest-order-workbench.js require（P 组）。
 */
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

const client = require(path.join(ROOT, 'api/client.js'));
const store = require(path.join(ROOT, 'store/index.js'));
const loadFlow = require(path.join(ROOT, 'pages/partner/workbench/parts/load-flow.js'));
const loadView = require(path.join(ROOT, 'pages/partner/workbench/parts/load-view.js'));
const fsutil = require('./fsutil');

const EXPECTED_ASSERTIONS = 13; // P01~P13
const ISO = '2026-11-26T02:00:00.000Z';
const COUNTS_ZERO = { submitted: 0, accepted: 0, picked: 0, delivered: 0, exception: 0, todayCompleted: 0 };

function dto(orderNo, status, version) {
  return {
    orderNo: orderNo,
    status: status,
    statusText: status,
    bucket: status === 'PICKED' ? 'picked' : 'accepted',
    version: version,
    parcel: { stationId: 'P4', stationName: '北部菜鸟驿站', pickupCode: '27-2-7016', codeStatus: 'OK' },
    service: { code: 'PICKUP_STD', name: '标准代取' },
    appoint: { typeText: '尽快' },
    dorm: { buildingText: 'D4', room: '522', dormKey: 'D4-522', roomTag: 'A' },
    actions: [],
    statusUpdatedAt: ISO,
    updatedAt: ISO
  };
}

function countsOf(overrides) {
  return Object.assign({}, COUNTS_ZERO, overrides || {});
}

function resp(list, counts, nextCursor) {
  return { ok: true, data: { list: list, counts: counts, nextCursor: nextCursor || null }, serverTime: Date.now() };
}

// 假页面：真实 parts/load-flow 方法 + 最小 data/setData；离页后的 setData 只计数（判据要证明它没发生）
function makePage(filter, keyword) {
  return Object.assign({}, loadFlow, {
    data: {
      filter: filter || 'all',
      keyword: keyword || '',
      stage: 'ready',
      selecting: false,
      groups: [],
      totalRows: 0,
      nextCursor: null,
      counts: countsOf(),
      lastSuccessText: '',
      syncError: '',
      errorText: '',
      loadingMore: false,
      hasRows: false
    },
    _list: [],
    _page1Keys: [],
    _chunkToken: 0,
    _loadToken: 0,
    _unloaded: false,
    unloadedSetData: 0,
    setData(patch) {
      if (this._unloaded) {
        this.unloadedSetData += 1;
      }
      Object.keys(patch).forEach((key) => {
        this.data[key] = patch[key];
      });
    },
    syncBanner() {},
    applyTransfer() {},
    maintenanceFallbackOf() {
      return null;
    },
    toastMsg() {}
  });
}

function deferredTransport() {
  const pending = [];
  return {
    pending: pending,
    transport() {
      return new Promise((resolve) => pending.push(resolve));
    }
  };
}

function orderNos(page) {
  return page._list.map((order) => order.orderNo);
}

async function staleChecks(t) {
  const gate = deferredTransport();
  // 每个请求前重新装桩：本套件的 O 组（转派接线）也是异步分节，它会在自己的 await 结束后
  // restoreTransport() 还原默认桩；共用 api/client 这一个注入点时，只有「装桩→发起请求」在同一
  // 同步片段里才能保证请求落到本组的 deferred 队列（装桩与 load 调用之间不得有 await）。
  const runLoad = (page, opts) => {
    client.setTransport(gate.transport);
    return loadFlow.load.call(page, opts || {});
  };
  const runMore = (page) => {
    client.setTransport(gate.transport);
    return loadFlow.loadMore.call(page);
  };
  try {
    // ── 合法基线：单请求正常落地（先基线再反例）─────────────────────────────────
    const base = makePage();
    const first = runLoad(base, { poll: true });
    gate.pending[0](resp([dto('P-1', 'ACCEPTED', 1)], countsOf({ accepted: 1 })));
    await first;
    t.eq([orderNos(base), base.data.counts.accepted], [['P-1'], 1],
      'P01 合法基线：单请求落地（列表/计数按服务端响应上屏）');

    // ── 反例 1：旧响应晚到（轮询竞态的典型形态）────────────────────────────────
    const stale = runLoad(base, { poll: true });
    const newest = runLoad(base, { poll: true });
    gate.pending[2](resp([dto('P-2', 'PICKED', 2)], countsOf({ picked: 1 })));
    await newest;
    const afterNewest = orderNos(base);
    gate.pending[1](resp([dto('P-1', 'ACCEPTED', 1)], countsOf({ accepted: 1 })));
    await stale;
    t.eq([orderNos(base), afterNewest], [['P-2'], ['P-2']],
      'P02 乱序：旧响应晚到整包丢弃（行状态不往回跳；旧实现此处会退回 P-1/ACCEPTED）');
    t.eq([base.data.counts.picked, base.data.counts.accepted], [1, 0],
      'P03 乱序：旧 counts 不覆盖新 counts（角标/计数不回退）');

    // ── 反例 2：切筛选后旧筛选响应迟到 ────────────────────────────────────────
    const switched = makePage('accepted');
    const oldFilter = runLoad(switched, { poll: true });
    switched.data.filter = 'picked';
    switched._list = [];
    switched._page1Keys = [];
    const newFilter = runLoad(switched, { silent: true });
    gate.pending[4](resp([dto('NEW-PICKED', 'PICKED', 3)], countsOf({ picked: 1 })));
    await newFilter;
    gate.pending[3](resp([dto('OLD-ACCEPTED', 'ACCEPTED', 1)], countsOf({ accepted: 1 })));
    await oldFilter;
    t.eq(orderNos(switched), ['NEW-PICKED'],
      'P04 切筛选：旧筛选（待取件）迟到响应不落到新筛选（已取件）下');

    // ── 反例 3：搜索词在防抖窗内改变（新请求还没发出）─────────────────────────────
    const typing = makePage('all', '');
    const typedPoll = runLoad(typing, { poll: true });
    typing.data.keyword = 'D4-522';
    gate.pending[5](resp([dto('NOT-MATCH', 'ACCEPTED', 1)], countsOf({ accepted: 1 })));
    await typedPoll;
    t.eq([orderNos(typing), typing.data.keyword], [[], 'D4-522'],
      'P05 搜索词已变：按旧关键词取回的响应丢弃（不把不匹配的行挂在新关键词下）');

    // ── 反例 4：分页在飞时刷新插队 ────────────────────────────────────────────
    const paging = makePage();
    paging._list = [dto('R-1', 'ACCEPTED', 1)];
    paging._page1Keys = ['R-1'];
    paging.data.nextCursor = { sortValue: 1, orderNo: 'R-1' };
    const more = runMore(paging);
    const refresh = runLoad(paging, { poll: true });
    gate.pending[7](resp([dto('R-9', 'ACCEPTED', 2)], countsOf({ accepted: 1 })));
    await refresh;
    gate.pending[6](resp([dto('R-2', 'ACCEPTED', 1)], countsOf({ accepted: 2 }), null));
    await more;
    t.eq(orderNos(paging), ['R-9'],
      'P06 分页：刷新后迟到的第 2 页不追加（刷新前的旧行不复活）');
    t.eq(paging.data.loadingMore, false, 'P07 分页：迟到响应丢弃时复位 loadingMore（不卡住触底加载）');

    // ── 反例 5：离开页面后响应迟到 ────────────────────────────────────────────
    const left = makePage();
    const late = runLoad(left, { poll: true });
    left._unloaded = true;
    gate.pending[8](resp([dto('LATE-1', 'ACCEPTED', 1)], countsOf({ submitted: 3 })));
    await late;
    t.eq([left._list.length, left.unloadedSetData, (store.get('badges') || {}).workbenchPending], [0, 0, 0],
      'P08 离页：迟到响应不 setData、不改 tabBar 红点（onUnload 置 _unloaded）');

    // ── 反例 6：旧请求失败晚于新请求成功（假错误条）──────────────────────────────
    const failing = makePage();
    const olderFail = runLoad(failing, { poll: true });
    const newerOk = runLoad(failing, { poll: true });
    gate.pending[10](resp([dto('OK-1', 'ACCEPTED', 2)], countsOf({ accepted: 1 })));
    await newerOk;
    gate.pending[9]({ ok: false, code: 'VALIDATION_FAILED', message: '参数不合法' });
    await olderFail;
    t.eq([failing.data.syncError, orderNos(failing)], ['', ['OK-1']],
      'P09 迟到失败：不写 syncError（成功数据不被假错误条盖住）');

    // ── 判据单源真值表 ────────────────────────────────────────────────────────
    const current = { unloaded: false, token: 3, filterKey: 'all', keyword: '' };
    t.eq([
      loadView.isStaleRequest(current, { token: 3, filterKey: 'all', keyword: '' }),
      loadView.isStaleRequest(Object.assign({}, current, { unloaded: true }), { token: 3, filterKey: 'all', keyword: '' }),
      loadView.isStaleRequest(current, { token: 2, filterKey: 'all', keyword: '' }),
      loadView.isStaleRequest(current, { token: 3, filterKey: 'picked', keyword: '' }),
      loadView.isStaleRequest(current, { token: 3, filterKey: 'all', keyword: 'D4' }),
      loadView.isStaleRequest(current, null)
    ], [false, true, true, true, true, true],
      'P10 isStaleRequest 真值表：仅「未离页 + 代次/筛选/搜索词全一致」才落地（判据单源）');

    // ── 接线静态闸（删守卫即红）───────────────────────────────────────────────
    const flowSrc = fsutil.stripComments(fsutil.readText(path.join(ROOT, 'pages/partner/workbench/parts/load-flow.js')));
    const guardCount = (flowSrc.match(/isStaleRequest\(/g) || []).length;
    t.check(/taken\.token = taken\.token \+ 1;/.test(flowSrc) && /this\._loadToken = taken\.token;/.test(flowSrc)
      && guardCount >= 4,
      'P11 接线：load 领代次，applyResult/loadError/loadMore/applyAppendResult 四条落地路径统一走 isStaleRequest');
    const indexSrc = fsutil.stripComments(fsutil.readText(path.join(ROOT, 'pages/partner/workbench/index.js')));
    t.check(/this\._loadToken = 0;/.test(indexSrc) && /this\._unloaded = false;/.test(indexSrc)
      && /this\._unloaded = true;/.test(indexSrc) && /onReachBottom\(\) \{\s*this\.loadMore\(\);/.test(indexSrc),
      'P12 接线：onLoad 初始化代次/离页位、onUnload 置离页位、onReachBottom 委托 loadMore（同一判据）');
    const actionSrc = fsutil.stripComments(fsutil.readText(path.join(ROOT, 'pages/partner/workbench/parts/history-flow.js')));
    const actionGuards = (actionSrc.match(/this\._unloaded/g) || []).length;
    t.check(actionGuards >= 6,
      'P13 接线：历史摘要/展开/更早三处响应都判 _unloaded（离页不再 setData/toast；实测 ' + actionGuards + ' 处）');
  } finally {
    client.restoreTransport();
    store.patch({ badges: { workbenchPending: 0, messages: 0 } });
  }
}

module.exports = { EXPECTED_ASSERTIONS, staleChecks };
