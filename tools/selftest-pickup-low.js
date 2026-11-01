'use strict';
/**
 * tools/selftest-pickup-low.js — D41/D49「送至楼下」解释展示位 + 历史停用标识 + 存量回填脚本（批 16 分项 C）。
 *
 * 覆盖：
 *   A. 服务端 DTO：历史已停用服务类型（PICKUP_DOOR）只回标记 `serviceDeprecated`（快照名不改、响应只增不减）
 *   B. 顾客订单详情解释展示位：订单快照名 + 目录 desc 单源（STD 上楼 / LOW 不上楼 / 其他沿用 desc / 停用标记）
 *   C. 顾客下单 Step4 摘要：服务行补说明行（复用服务目录 desc 单源，不硬编码层级文案）
 *   D. 兼职订单详情：历史停用类型渲染「送寝上门（已停用）」（主视图 + 履约凭证同源），普通单不变
 *   E. 绑定预览：服务能力说明行纯件（已启用项名称 + 目录 desc）+ 页面接线 + 死函数 onRetry 已删
 *   F. D49 回填脚本纯逻辑（fake DB 注入）：缺项补/已有保留/幂等/dry-run 不写/写前备份/失败不中断/CLI 安全
 *   G. 口径与门禁静态：D41 服务目录未被我改、停用名单源、新增文案零费用语义、页面层零 wx.cloud
 *
 * 纪律：fake DB/夹具注入，不连真库、不 mock 全局 wx；先合法基线再反例；样本非空；
 *       EXPECTED_ASSERTIONS 与本文件断言数精确相等（少算/多算都判红）。
 * 取数：node tools/selftest-pickup-low.js | Select-Object -Last 2
 * 注：聚合入口 tools/selftest.js 的 SUITES 注册由 Lead 统一做（本分项不改聚合文件）。
 */
const path = require('path');
const fsutil = require('./lib/fsutil');
const { createHarness, installCrashGuard, ROOT } = require('./selftest');
const enums = require(path.join(ROOT, 'shared/enums.js'));
const serverDto = require(path.join(ROOT, 'cloudfunctions/api/handlers/order/_dto.js'));
const parcelView = require(path.join(ROOT, 'pkg-customer/pages/order-detail/parts/parcel-view.js'));
const partnerOrderView = require(path.join(ROOT, 'pkg-partner/pages/order-detail/parts/order-view.js'));
const voucherPart = require(path.join(ROOT, 'pkg-partner/pages/order-detail/parts/voucher.js'));
const bindServiceView = require(path.join(ROOT, 'pkg-customer/pages/bind/parts/service-view.js'));
const backfill = require('./backfill-pickup-low.js');
const zeroMoney = require('./zero-money-scan.js');

// 实际断言总数（本套件自身完整性闸：与实际断言数精确相等，少算/多算都判红）
const EXPECTED_ASSERTIONS = 63;

const NOW_MS = Date.parse('2026-10-22T10:00:00+08:00');
const LOW_CODE = backfill.LOW_CODE;
const DEPRECATED_CODE = 'PICKUP_DOOR';
const LEGACY_SNAPSHOT_NAME = '送寝上门';

const FILES = {
  createWxml: 'pkg-customer/pages/order-create/index.wxml',
  createWxss: 'pkg-customer/pages/order-create/index.wxss',
  detailJs: 'pkg-customer/pages/order-detail/index.js',
  detailWxml: 'pkg-customer/pages/order-detail/index.wxml',
  detailWxss: 'pkg-customer/pages/order-detail/index.wxss',
  detailPart: 'pkg-customer/pages/order-detail/parts/parcel-view.js',
  bindJs: 'pkg-customer/pages/bind/index.js',
  bindWxml: 'pkg-customer/pages/bind/index.wxml',
  bindPart: 'pkg-customer/pages/bind/parts/service-view.js',
  partnerWxml: 'pkg-partner/pages/order-detail/index.wxml',
  partnerView: 'pkg-partner/pages/order-detail/parts/order-view.js',
  partnerVoucher: 'pkg-partner/pages/order-detail/parts/voucher.js',
  backfill: 'tools/backfill-pickup-low.js'
};

function textOf(rel) {
  return fsutil.readText(path.join(ROOT, rel)) || '';
}

function cloneOf(value) {
  return JSON.parse(JSON.stringify(value));
}

// 公开配置 serviceCatalog 形状（config/defaults 由 shared/enums 派生；用例中使用同一形状而非现状拷贝）
function defaultCatalog() {
  return enums.SERVICES.map(function map(item) {
    return { code: item.code, name: item.name, desc: item.desc };
  });
}

function serviceCodeOf(index) {
  return enums.SERVICE_CODES[index];
}

// ── orders 文档夹具：交给真实 _dto.buildOrderDto 生成服务端 DTO（端云契约联调，同既有套件方式）──
function orderDoc(service) {
  return {
    _id: 'order-it-1',
    orderNo: '20261022-0031',
    customerId: 'customer-it',
    partnerId: 'partner-it',
    customerNo: 'C-7K2M-9QX4',
    partnerNo: 'P-8F3-K2M',
    status: enums.ORDER_STATUS.COMPLETED,
    version: 2,
    source: enums.ORDER_SOURCE.CUSTOMER,
    service: service,
    appoint: { type: enums.APPOINT_TYPE.ASAP },
    parcels: [{
      stationId: 'P4',
      stationName: '北部菜鸟驿站（北苑一食堂三楼）',
      pickupCode: '27-2-7016',
      lockerNo: '3 号柜',
      trackingTail: '66785',
      codeStatus: enums.CODE_STATUS.OK,
      recognitionSource: enums.RECOGNITION_SOURCE.RULE
    }],
    images: [],
    delivery: { zone: 'D', buildingNo: 4, buildingText: 'D4', room: '522', dormKey: 'D4-522' },
    dorm: { zone: 'D', buildingNo: 4, buildingText: 'D4', room: '522', dormKey: 'D4-522', roomTag: 'A' },
    note: '放宿舍门口鞋柜上',
    manualEntry: false,
    statusUpdatedAt: NOW_MS,
    createdAt: NOW_MS,
    updatedAt: NOW_MS
  };
}

const DTO_CTX = {
  dao: {
    get: function get() { return Promise.resolve(null); },
    find: function find() { return Promise.resolve([]); },
    findOne: function findOne() { return Promise.resolve(null); }
  },
  identity: {},
  now: NOW_MS
};

function realDto(doc) {
  return serverDto.buildOrderDto(DTO_CTX, doc, { side: 'CUSTOMER', withCounterpart: false, withActions: false });
}

// ── D49 回填 fake DB（依赖注入：listPartners/updatePartner/now/log）──
function fakeLedger(docList) {
  const state = {
    docs: cloneOf(docList),
    updates: [],
    logs: [],
    failIds: []
  };
  const deps = {
    listPartners: function listPartners() { return Promise.resolve(cloneOf(state.docs)); },
    updatePartner: function updatePartner(id, patch) {
      state.updates.push({ id: id, patch: patch });
      if (state.failIds.indexOf(id) >= 0) {
        return Promise.reject(new Error('注入的写入失败'));
      }
      state.docs.forEach(function each(doc) {
        if (doc._id === id) {
          doc.serviceConfig = patch.serviceConfig;
          doc.updatedAt = patch.updatedAt;
        }
      });
      return Promise.resolve();
    },
    now: function now() { return new Date(NOW_MS); },
    log: function log(line) { state.logs.push(line); }
  };
  return { state: state, deps: deps };
}

function partnerDoc(id, services, extra) {
  return Object.assign({
    _id: id,
    partnerNo: 'P-BACKFILL-' + id,
    status: enums.PARTNER_STATUS.ACTIVE,
    serviceConfig: { services: services, zones: ['D', 'X'], acceptingOrders: true }
  }, extra || {});
}

function captureIo() {
  const lines = [];
  const errors = [];
  return {
    lines: lines,
    errors: errors,
    log: function log(line) { lines.push(String(line)); },
    error: function error(line) { errors.push(String(line)); }
  };
}

function register(h) {
  // ---------------------------------------------------------------- A 服务端 DTO 停用标记
  h.section('A. 服务端 DTO：历史停用类型只回标记 service.deprecated（快照名不改、行顶层键不变）', async (t) => {
    const current = [];
    const currentDtos = [];
    for (let i = 0; i < enums.SERVICE_CODES.length; i += 1) {
      const code = serviceCodeOf(i);
      const dto = await realDto(orderDoc({ code: code, name: enums.serviceNameOf(code) }));
      currentDtos.push(dto);
      current.push(dto.service.deprecated);
    }
    t.eq(current, enums.SERVICE_CODES.map(function mapFalse() { return false; }),
      'A1 现行 5 类服务（D41）service.deprecated 恒为 false（合法基线，样本非空）');
    const legacyDoc = orderDoc({ code: DEPRECATED_CODE, name: LEGACY_SNAPSHOT_NAME });
    const legacy = await realDto(legacyDoc);
    t.eq(legacy.service.deprecated, true,
      'A2 历史 PICKUP_DOOR 订单（DTO 只回快照名的既有形态）→ service.deprecated=true');
    t.eq(legacy.service.name, LEGACY_SNAPSHOT_NAME,
      'A3 只加标记不改快照名（历史单可读，客户端按名称单源渲染「（已停用）」）');
    const currentKeys = Object.keys(currentDtos[0] || {});
    t.eq(Object.keys(legacy).filter(function extra(key) { return currentKeys.indexOf(key) < 0; }), [],
      'A4 响应只增不减：行 DTO 顶层键集合与现行单一致（标记嵌在既有 service 键内，不动他人行键白名单）');
    const noService = await serverDto.buildOrderDto(DTO_CTX, orderDoc(undefined), { side: 'CUSTOMER', withCounterpart: false });
    const emptyService = await serverDto.buildOrderDto(DTO_CTX, orderDoc({ code: '', name: '' }), { side: 'CUSTOMER', withCounterpart: false });
    t.eq([noService.service.deprecated, emptyService.service.deprecated], [false, false],
      'A5 无 service / 空 code 的历史文档不误标（缺字段不等于已停用）');
    const listDtos = await serverDto.buildOrderDtos(DTO_CTX,
      [legacyDoc, orderDoc({ code: 'PICKUP_STD', name: enums.serviceNameOf('PICKUP_STD') })], 'CUSTOMER');
    t.eq(listDtos.map(function flag(item) { return item.service.deprecated; }), [true, false],
      'A6 列表 DTO（buildOrderDtos）同源带标记——顾客/兼职列表按订单详情同一 DTO 口径读取');
  });

  // ---------------------------------------------------------------- B 顾客详情解释展示位
  h.section('B. 顾客订单详情：快照名 + 目录 desc 单源（STD 上楼 / LOW 不上楼 / 其他沿用 / 停用标记）', async (t) => {
    const catalog = defaultCatalog();
    const stdEntry = catalog.filter(function pick(item) { return item.code === 'PICKUP_STD'; })[0];
    const lowEntry = catalog.filter(function pick(item) { return item.code === LOW_CODE; })[0];
    const stdOrder = await realDto(orderDoc({ code: stdEntry.code, name: stdEntry.name }));
    const stdView = parcelView.serviceView(stdOrder, { serviceCatalog: catalog });
    t.eq(stdView.serviceText, stdEntry.name,
      'B1 标准代取：服务类型展示订单快照名（不偷换成目录名）');
    t.eq([stdView.serviceDesc, stdView.serviceDesc === stdEntry.desc, stdView.serviceDesc.indexOf('上楼') >= 0,
      stdView.serviceDesc.indexOf('不上楼')], [stdEntry.desc, true, true, -1],
    'B2 标准代取说明=目录 desc 单源，且明确「上楼」不含「不上楼」（D41 送达层级）');
    const lowOrder = await realDto(orderDoc({ code: lowEntry.code, name: lowEntry.name }));
    const lowView = parcelView.serviceView(lowOrder, { serviceCatalog: catalog });
    t.eq([lowView.serviceText, lowView.serviceDesc === lowEntry.desc, lowView.serviceDesc.indexOf('不上楼') >= 0,
      lowView.serviceDesc.indexOf('楼下') >= 0], [lowEntry.name, true, true, true],
    'B3 送至楼下：名称「送至楼下」+ 说明含「楼下」「不上楼」（与标准代取可区分）');
    const urgentEntry = catalog.filter(function pick(item) { return item.code === 'PICKUP_URGENT'; })[0];
    const urgentOrder = await realDto(orderDoc({ code: urgentEntry.code, name: urgentEntry.name }));
    const urgentView = parcelView.serviceView(urgentOrder, { serviceCatalog: catalog });
    t.eq(urgentView.serviceDesc, urgentEntry.desc,
      'B4 其他类型不新增解释：沿用目录 desc（不硬编码长解释文案）');
    const legacyDto = await realDto(orderDoc({ code: DEPRECATED_CODE, name: LEGACY_SNAPSHOT_NAME }));
    const legacyView = parcelView.serviceView(legacyDto, { serviceCatalog: catalog });
    t.eq([legacyView.serviceText, legacyView.serviceDeprecated, legacyView.serviceDesc],
      [enums.serviceNameOf(DEPRECATED_CODE), true, ''],
      'B5 历史停用类型：DTO 标记 → 名称单源渲染「送寝上门（已停用）」且不显示现行目录说明');
    const legacyUnflagged = parcelView.serviceView({ service: { code: DEPRECATED_CODE, name: LEGACY_SNAPSHOT_NAME } },
      { serviceCatalog: catalog });
    t.eq([legacyUnflagged.serviceText, legacyUnflagged.serviceDeprecated], [LEGACY_SNAPSHOT_NAME, false],
      'B6 旧服务端（无标记）历史单兼容：仍显示快照名、不误判（只增不减的兼容窗口）');
    const custom = parcelView.serviceView(stdOrder, {
      serviceCatalog: [{ code: 'PICKUP_STD', name: '标准代取', desc: '后台自定义说明-仅用于断言' }]
    });
    t.eq(custom.serviceDesc, '后台自定义说明-仅用于断言',
      'B7 说明跟随后台目录配置（单源在 config.serviceCatalog，不在前端复制一份）');
    const extrasNoConfig = parcelView.pageExtras(stdOrder);
    t.eq([extrasNoConfig.serviceText, extrasNoConfig.serviceDesc], [stdEntry.name, ''],
      'B8 pageExtras 无 config 的兼容调用不抛错：说明为空但不影响名称渲染');
    t.eq([stdView.serviceDesc.indexOf('522'), stdView.serviceDesc.indexOf('66785')], [-1, -1],
      'B9 说明不泄漏 L3（房间号/手机尾号不进说明文本，说明只来自目录 desc）');
  });

  // ---------------------------------------------------------------- C 下单 Step4 摘要
  h.section('C. 顾客下单 Step4 摘要：服务行补说明行（复用目录 desc 单源）', (t) => {
    const wxml = textOf(FILES.createWxml);
    const wxss = textOf(FILES.createWxss);
    t.check(/服务：\{\{services\[serviceIndex\]\.name/.test(wxml),
      'C1 Step4 确认订单保留服务行（服务名称 + 预约文案同处一行）');
    const inStep4 = /wx:if="\{\{step === 4\}\}"[\s\S]*?\{\{services\[serviceIndex\]\.desc\}\}/.test(wxml);
    t.check(inStep4,
      'C2 Step4 摘要区出现说明行 {{services[serviceIndex].desc}}（第 3 步选择器的层级说明同时出现在确认页）');
    t.eq(wxml.split('\n').filter(function hasDescLine(line) {
      return line.indexOf('services[serviceIndex].desc') >= 0;
    }).length, 2,
    'C3 说明渲染点恰好 2 处（Step3 选择器 + Step4 摘要，不多不少；复用同一数据字段不新增判定）');
    t.check(/\.service-desc\s*\{/.test(wxss),
      'C4 说明行样式落点 .service-desc 存在（与 Step3 说明同一视觉层级）');
    t.eq([wxml.indexOf('不上楼'), wxml.indexOf('需要上楼')], [-1, -1],
      'C5 页面不硬编码层级文案（「不上楼/需要上楼」只在 shared/enums desc 单源，前端不复制一份）');
  });

  // ---------------------------------------------------------------- D 兼职详情停用标记
  h.section('D. 兼职订单详情：历史停用类型渲染「送寝上门（已停用）」（主视图 + 履约凭证同源）', async (t) => {
    const currentDto = await realDto(orderDoc({ code: 'PICKUP_STD', name: enums.serviceNameOf('PICKUP_STD') }));
    const currentDetail = partnerOrderView.buildDetail(currentDto);
    t.eq(currentDetail.serviceName, enums.serviceNameOf('PICKUP_STD'),
      'D1 现行类型：兼职详情仍显示订单快照名（合法基线，不误标）');
    const legacyDto = await realDto(orderDoc({ code: DEPRECATED_CODE, name: LEGACY_SNAPSHOT_NAME }));
    const legacyDetail = partnerOrderView.buildDetail(legacyDto);
    t.eq(legacyDetail.serviceName, enums.serviceNameOf(DEPRECATED_CODE),
      'D2 历史停用类型：兼职详情主视图渲染「送寝上门（已停用）」（DTO 标记 + shared/enums 名称单源）');
    const legacyRaw = partnerOrderView.buildDetail({ service: { code: DEPRECATED_CODE, name: LEGACY_SNAPSHOT_NAME } });
    t.eq(legacyRaw.serviceName, LEGACY_SNAPSHOT_NAME,
      'D3 旧服务端（无标记）兼职详情兼容：显示快照名而不误标（只增不减的兼容窗口）');
    const voucher = voucherPart.buildVoucher(legacyDto, []);
    const serviceRow = voucher.rows.filter(function pick(row) { return row.label === '服务类型'; })[0] || {};
    t.eq(serviceRow.value, enums.serviceNameOf(DEPRECATED_CODE),
      'D4 履约凭证卡「服务类型」行同源渲染「（已停用）」（同一详情页两处不打架）');
    t.eq(voucher.serviceName, enums.serviceNameOf(DEPRECATED_CODE),
      'D5 凭证卡 serviceName 字段同源（复制/展示字段口径一致）');
    t.check(/\{\{order\.serviceName/.test(textOf(FILES.partnerWxml)),
      'D6 兼职详情 WXML 仍按现有渲染方式消费 order.serviceName（标记在视图模型层完成，页面零判据）');
  });

  // ---------------------------------------------------------------- E 绑定预览
  h.section('E. 绑定预览：服务能力说明行纯件（已启用项 + 目录 desc）+ 页面接线 + 死函数清理', (t) => {
    const catalog = defaultCatalog();
    const stdEntry = catalog.filter(function pick(item) { return item.code === 'PICKUP_STD'; })[0];
    const lowEntry = catalog.filter(function pick(item) { return item.code === LOW_CODE; })[0];
    const capability = bindServiceView.capabilityOf([
      { code: 'PICKUP_STD', enabled: true },
      { code: LOW_CODE, enabled: true }
    ], catalog);
    t.eq(capability.servicesText, [stdEntry.name, lowEntry.name].join(' / '),
      'E1 预览服务能力名称串=已启用项目录名（顺序=兼职配置顺序）');
    t.eq(capability.serviceHintText, [stdEntry.name + '：' + stdEntry.desc, lowEntry.name + '：' + lowEntry.desc].join('；'),
      'E2 预览说明行=逐项「名称：目录 desc」（标准代取上楼 / 送至楼下不上楼，一眼可区分）');
    t.eq(bindServiceView.enabledCodes([
      { code: 'PICKUP_STD', enabled: false },
      { code: 'PICKUP_STD', enabled: true },
      { code: LOW_CODE },
      {},
      null,
      { code: '' },
      { code: LOW_CODE, enabled: true }
    ]), ['PICKUP_STD', LOW_CODE],
    'E3 只展示已启用项：enabled=false 过滤、缺省视为启用、同 code 去重、空条目忽略');
    const missingCatalog = bindServiceView.capabilityOf([{ code: LOW_CODE, enabled: true }], []);
    t.eq([missingCatalog.servicesText, missingCatalog.serviceHintText], [LOW_CODE, ''],
      'E4 目录缺项回退 code 且不产出说明段（旧配置/[加载中] 都不抛错）');
    t.eq(bindServiceView.capabilityOf([], catalog), { servicesText: '服务类型加载中', serviceHintText: '' },
      'E5 无已启用项保留原页面文案「服务类型加载中」（行为不变）');
    const bindJs = textOf(FILES.bindJs);
    t.check(bindJs.indexOf("require('./parts/service-view')") >= 0 && bindJs.indexOf('capabilityOf(') >= 0,
      'E6 绑定页已接入纯件 service-view（页面只 setData，不本地拼说明文案）');
    t.check(/\{\{serviceHintText\}\}/.test(textOf(FILES.bindWxml)),
      'E7 绑定预览 WXML 渲染服务能力说明行 {{serviceHintText}}');
    t.eq(/onRetry\s*\(/.test(bindJs), false,
      'E8 死函数 onRetry 已删除（WXML 实际绑 onRetryBind，proposal §1.1）');
    t.check(bindJs.indexOf('onRetryBind(') >= 0 && textOf(FILES.bindWxml).indexOf('bindtap="onRetryBind"') >= 0,
      'E9 有效恢复入口 onRetryBind 仍在（页面方法 + WXML 绑定两向都在）');
    t.check(/serviceHintText:\s*''/.test(bindJs),
      'E10 页面 data 初始化 serviceHintText（未出预览时不渲染空说明行）');
  });

  // ---------------------------------------------------------------- F D49 回填纯逻辑
  h.section('F. D49 存量回填脚本：fake DB 注入（缺项补/已有保留/幂等/dry-run 不写/写前备份/CLI 安全）', async (t) => {
    const baseServices = [
      { code: 'PICKUP_STD', enabled: true },
      { code: 'PICKUP_URGENT', enabled: false }
    ];
    const planAppend = backfill.planOf(partnerDoc('p1', baseServices));
    t.eq([planAppend.kind, planAppend.after.services.slice(-1), planAppend.before.services],
      ['APPEND', [{ code: LOW_CODE, enabled: true }], baseServices],
      'F1 缺 PICKUP_LOW → 在既有顺序末尾追加 {code,enabled:true}，原有顺序不变');
    t.eq([planAppend.after.zones, planAppend.after.acceptingOrders, planAppend.before === planAppend.before],
      [['D', 'X'], true, true],
      'F2 只改 services：zones/acceptingOrders 等其他服务配置原样保留（不覆盖其他类型/范围）');
    t.eq([backfill.planOf(partnerDoc('p2', [{ code: LOW_CODE, enabled: true }])).kind,
      backfill.planOf(partnerDoc('p3', [{ code: LOW_CODE, enabled: false }])).kind], ['KEEP', 'KEEP'],
    'F3 已有 PICKUP_LOW（无论启用/停用）→ KEEP，保留兼职自己的选择');
    const skipKinds = [
      backfill.planOf(partnerDoc('s1', baseServices, { status: 'CLOSED' })).kind,
      backfill.planOf({ _id: 's2', partnerNo: 'P-S2' }).kind,
      backfill.planOf(partnerDoc('s3', 'not-an-array')).kind,
      backfill.planOf(partnerDoc('s4', [])).kind
    ];
    t.eq(skipKinds, ['SKIP', 'SKIP', 'SKIP', 'SKIP'],
      'F4 无法安全回填的 4 类（已注销/缺 serviceConfig/services 非数组/空数组）一律 SKIP，不猜不改');
    const dry = fakeLedger([
      partnerDoc('p1', baseServices),
      partnerDoc('p2', [{ code: LOW_CODE, enabled: false }]),
      partnerDoc('p3', [{ code: 'PICKUP_STD', enabled: true }])
    ]);
    const dryBefore = cloneOf(dry.state.docs);
    const dryResult = await backfill.runBackfill(dry.deps, {});
    t.eq([dryResult.summary.scanned, dryResult.summary.pending, dryResult.summary.applied,
      dryResult.summary.skipped], [3, 2, 0, 0],
    'F5 dry-run 汇总：扫描 3 / 待改 2 / 已改 0 / 跳过 0');
    t.eq([dry.state.updates.length, dry.state.docs], [0, dryBefore],
      'F6 dry-run 绝不调用写依赖、库文档零变化（默认只读）');
    t.eq(dry.state.logs.filter(function isPlan(line) { return line.indexOf('[plan] ') === 0; }).length, 2,
      'F7 dry-run 逐人打印 [plan] 变化行（用户执行前可核对人数与预期）');
    const applyFlow = fakeLedger([
      partnerDoc('p1', baseServices),
      partnerDoc('p2', [{ code: LOW_CODE, enabled: false }]),
      partnerDoc('p3', [{ code: 'PICKUP_STD', enabled: true }])
    ]);
    const originalP1 = cloneOf(applyFlow.state.docs[0].serviceConfig);
    const applyResult = await backfill.runBackfill(applyFlow.deps, { apply: true });
    t.eq([applyResult.summary.pending, applyResult.summary.applied, applyResult.backup.length], [2, 2, 2],
      'F8 --apply 汇总：待改 2 / 已改 2，备份条目数与待改数一致');
    t.eq(applyResult.backup[0].serviceConfig, originalP1,
      'F9 写前备份=原 serviceConfig 完整快照（回滚依据，不含新增条目）');
    const backupAt = applyFlow.state.logs.findIndex(function find(line) { return line.indexOf('[backup] ') === 0; });
    const writeAt = applyFlow.state.logs.findIndex(function find(line) { return line.indexOf('[write] ') === 0; });
    t.check(backupAt >= 0 && writeAt > backupAt,
      'F10 备份日志先于任何写入（[backup] 在 [write] 之前，写坏可回滚）');
    t.eq(applyFlow.state.docs[0].serviceConfig.services.slice(-1), [{ code: LOW_CODE, enabled: true }],
      'F11 写入后库文档末尾出现 PICKUP_LOW enabled=true');
    t.eq(applyFlow.state.docs[1].serviceConfig.services, [{ code: LOW_CODE, enabled: false }],
      'F12 已有 PICKUP_LOW（停用）的兼职文档一字不动（不覆盖兼职选择）');
    const second = await backfill.runBackfill(applyFlow.deps, { apply: true });
    t.eq([second.summary.pending, second.summary.applied, applyFlow.state.updates.length],
      [0, 0, 2],
      'F13 幂等可重跑：第二次 pending=0/applied=0，未产生新写入');
    const failing = fakeLedger([
      partnerDoc('p1', baseServices),
      partnerDoc('p2', baseServices)
    ]);
    failing.state.failIds = ['p1'];
    const failedResult = await backfill.runBackfill(failing.deps, { apply: true });
    t.eq([failedResult.summary.failed, failedResult.summary.applied,
      failing.state.logs.some(function isFail(line) { return line.indexOf('[fail] ') === 0; })], [1, 1, true],
    'F14 单条写失败不中断：失败 1 / 成功 1，逐条打印 [fail] 供人工核对（幂等可重试）');
    t.eq(backfill.summaryLine({ scanned: 3, pending: 2, applied: 2, skipped: 1 }),
      'backfill-pickup-low：扫描 3 / 待改 2 / 已改 2 / 跳过 1',
      'F15 汇总行格式固定（扫描 N / 待改 M / 已改 K / 跳过 J，真机执行时按此行读数）');
    const cloudDryLedger = fakeLedger([partnerDoc('c1', baseServices)]);
    const cloudDry = await backfill.cloudMain({}, cloudDryLedger.deps);
    t.eq([cloudDry.ok, cloudDry.dryRun, cloudDry.summary.pending, cloudDry.summary.applied,
      cloudDry.summaryLine === backfill.summaryLine(cloudDry.summary)], [true, true, 1, 0, true],
    'F16 云函数形态事件 {} = dry-run：返回 ok/dryRun/汇总行，不写库（真实环境默认只读）');
    const cloudApplyLedger = fakeLedger([partnerDoc('c2', baseServices)]);
    const cloudApply = await backfill.cloudMain({ apply: true }, cloudApplyLedger.deps);
    t.eq([cloudApply.ok, cloudApply.dryRun, cloudApply.summary.applied], [true, false, 1],
      'F17 云函数形态事件 {"apply":true} 才写入（写入口唯一：控制台测试显式 apply）');
    const helpIo = captureIo();
    const helpCode = backfill.runCli(['--help'], helpIo);
    const helpText = helpIo.lines.join('\n');
    t.eq([helpCode, helpText.indexOf('--apply') >= 0, helpText.indexOf('临时云函数') >= 0,
      helpText.indexOf('回滚') >= 0, helpText.indexOf('汇总行') >= 0], [0, true, true, true, true],
    'F18 CLI --help：退出码 0 且含执行步骤（临时云函数/dry-run/apply/回滚/汇总行）');
    const safeIo = captureIo();
    const safeCode = backfill.runCli([], safeIo);
    const safeText = safeIo.lines.join('\n');
    t.eq([safeCode, safeText.indexOf('本机不连接云环境') >= 0, safeText.indexOf('dry-run 未写任何数据') >= 0,
      safeText.indexOf('扫描 0 / 待改 0 / 已改 0 / 跳过 0') >= 0], [0, true, true, true],
    'F19 CLI 无参数：安全提示 + 零值汇总行（不连接、不写任何数据）');
    const guardIo = captureIo();
    t.eq([backfill.runCli(['--apply'], guardIo), guardIo.errors.join('\n').indexOf('拒绝在本机执行写入') >= 0],
      [2, true],
      'F20 CLI --apply：本机守卫退出码 2（真实回填只能在云函数环境执行）');
    const unknownIo = captureIo();
    t.eq(backfill.runCli(['--input', 'partners.json'], unknownIo), 2,
      'F21 CLI 未知参数退出码 2（不做任何未定义行为）');
    const scriptSrc = textOf(FILES.backfill);
    t.eq([/cloud1-[a-z0-9]+/.test(scriptSrc), scriptSrc.indexOf('http://') >= 0 || scriptSrc.indexOf('https://') >= 0,
      (scriptSrc.match(/wx-server-sdk/g) || []).length], [false, false, 1],
    'F22 脚本静态：零真实环境 ID 字面量/零网络外呼/只一处 SDK 引用（仅云函数形态加载）');
  });

  // ---------------------------------------------------------------- G 口径与门禁静态
  h.section('G. 口径与门禁静态：D41 目录未改、停用名单源、新增文案零费用语义、页面层零 wx.cloud', (t) => {
    t.eq(enums.SERVICE_CODES, ['PICKUP_STD', 'PICKUP_LOW', 'PICKUP_URGENT', 'DROP_OFF', 'CUSTOM'],
      'G1 现行服务目录 5 类顺序未被本分项改动（D41 口径，CUSTOM 末项）');
    t.eq([enums.SERVICE_CODES.indexOf(DEPRECATED_CODE), enums.serviceNameOf(DEPRECATED_CODE)],
      [-1, '送寝上门（已停用）'],
      'G2 历史 PICKUP_DOOR 保持「不可新启用 + 展示名（已停用）」单源（shared/enums LEGACY_SERVICE_NAME）');
    const catalog = defaultCatalog();
    const stdEntry = catalog.filter(function pick(item) { return item.code === 'PICKUP_STD'; })[0];
    const lowEntry = catalog.filter(function pick(item) { return item.code === LOW_CODE; })[0];
    const copyText = [stdEntry.desc, lowEntry.desc,
      bindServiceView.capabilityOf([{ code: 'PICKUP_STD' }, { code: LOW_CODE }], catalog).serviceHintText,
      enums.serviceNameOf(DEPRECATED_CODE)].join('\n');
    t.eq(zeroMoney.scanText(copyText), [],
      'G3 新增展示文案（说明行/停用标记）过零金额扫描器词表（tools/zero-money-scan.js 单源）0 命中');
    const hardcoded = [FILES.detailPart, FILES.bindPart, FILES.partnerView, FILES.partnerVoucher]
      .map(textOf)
      .filter(function hasCopy(src) { return [stdEntry.desc, lowEntry.desc].some(function hit(desc) { return src.indexOf(desc) >= 0; }); });
    t.eq(hardcoded, [],
      'G4 前端源码零硬编码层级文案：说明只从目录 desc 单源渲染（文案类词无从脱离单源进入界面）');
    const clientSources = [FILES.detailJs, FILES.detailPart, FILES.bindJs, FILES.bindPart,
      FILES.partnerView, FILES.partnerVoucher].map(textOf);
    t.eq(clientSources.map(function scan(src) {
      return [/wx\.cloud\./.test(src), /Math\.random/.test(src)];
    }).filter(function hit(pair) { return pair[0] || pair[1]; }), [],
    'G5 页面/纯件层零 wx.cloud 与 random（check #21 同口径，本分项新增代码同样受约束）');
  });
}

module.exports = { EXPECTED_ASSERTIONS, register };

if (require.main === module) {
  const h = createHarness({ name: 'selftest-pickup-low' });
  installCrashGuard(() => ({ count: h.count, passed: h.passed, failures: h.failures.length }), 'selftest-pickup-low');
  h.setExpected(EXPECTED_ASSERTIONS);
  register(h);
  const ret = h.finish();
  if (ret && typeof ret.then === 'function') ret.then(() => {});
}
