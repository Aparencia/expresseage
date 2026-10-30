'use strict';
/**
 * tools/selftest-core.js — 口径纯件骨架断言（ENGINEERING §7.1/§7.2；本文件是"骨架"，随落盘收口加断言）。
 * 覆盖：编号 ids / roomTag / 状态机 / 13 错误码 / 14 集合 / action 注册表 / 零金额扫描器牙口。
 * 纪律：有判别力（先合法基线、再只有该闸能挡的反例）；不许空集全绿；EXPECTED_ASSERTIONS 只在本文件登记。
 *
 * 零金额词样本一律用构造串（String.fromCharCode / 拼接），避免本测试文件自身被 #22 扫中。
 */
const path = require('path');
const fs = require('fs');
const project = require('./lib/project');

const ROOT = path.resolve(__dirname, '..');
const ids = require(path.join(ROOT, 'utils/ids.js'));
const roomTag = require(path.join(ROOT, 'utils/room-tag.js'));
const state = require(path.join(ROOT, 'shared/order-state.js'));
const errorCodes = require(path.join(ROOT, 'shared/error-codes.js'));
const errorCopy = require(path.join(ROOT, 'shared/error-copy.js'));
const collections = require(path.join(ROOT, 'shared/collections.js'));
const actions = require(path.join(ROOT, 'shared/actions.js'));
const stations = require(path.join(ROOT, 'shared/stations.js'));
const defaults = require(path.join(ROOT, 'config/defaults.js'));
const route = require(path.join(ROOT, 'config/route.js'));
const pendingInvite = require(path.join(ROOT, 'utils/share/pending-invite.js'));
const privacyGate = require(path.join(ROOT, 'utils/privacy-gate.js'));
const store = require(path.join(ROOT, 'store/index.js'));
const ZM = require('./zero-money-scan');

// 构造样本（源码中不出现连续词面，防止门禁自命中）
const SAMPLE_TRANSPORT = String.fromCharCode(0x8fd0, 0x8d39);
const SAMPLE_PRICE = 'pri' + 'ce';
const SAMPLE_FEN = 'total' + 'Fen';
// 费用类动作名禁词正则也用拼接构造，避免本文件被 #22 扫中
const FEE_ACTION_RE = new RegExp(['[Ff]' + 'en', 'pri' + 'ce', 'f' + 'ee'].join('|'));
const CLEAN_TEXT = '订单状态与取件码信息整理，本程序只做下单/接单/履约与消息通知。';

const EXPECTED_ASSERTIONS = 160; // 89 骨架 + 30 D37 入口白名单 + 25 D38 待绑定邀请/接线 + 16 D37-b 直落页隐私兜底

function register(h) {
  // ---------------------------------------------------------------- §7.1 编号
  h.section('§7.1 编号 ids', (t) => {
    t.eq(ids.CUSTOMER_NO_PREFIX, 'C', '顾客编号前缀 C');
    t.eq(ids.PARTNER_NO_PREFIX, 'P', '兼职编号前缀 P');
    t.check(ids.isCustomerNo('C-ABCD-2345'), '合法顾客编号可解析');
    t.check(ids.isPartnerNo('P-ABC-234'), '合法兼职编号可解析');
    t.check(!ids.isCustomerNo('P-ABC-234'), '错前缀不得当顾客编号');
    t.eq(ids.parseNo('C-ABCD-2345').display, 'C-ABCD-2345', '展示分组幂等');
    t.eq(ids.displayNo(ids.NO_KIND.PARTNER, 'PABC234'), 'P-ABC-234', '兼职编号按 3-3 分组展示');
    t.eq(ids.CUSTOMER_NO_LENGTH, 9, '顾客编号长度 9（C+8）');
    t.check(ids.CUSTOMER_NO_PATTERN.test('CABCD2345'), '顾客编号正则匹配 canonical 串（去连字符口径）');
    t.eq(ids.prefixHint('C-ABCD-2345').reason, 'CUSTOMER_PREFIX', '错前缀提示命中"这是顾客编号"');
    t.check(ids.prefixHint('P-ABC-234').message.length > 0, '错前缀提示文案非空');
    t.notEmpty([ids.prefixHint('C-ABCD-2345').message], '错前缀提示样本');
  });

  // ---------------------------------------------------------------- §7.1 roomTag
  h.section('§7.1 roomTag（恒大写/Excel 序）', (t) => {
    t.eq(roomTag.toTag(1), 'A', '1→A');
    t.eq(roomTag.toTag(26), 'Z', '26→Z');
    t.eq(roomTag.toTag(27), 'AA', '27→AA');
    t.eq(roomTag.toTag(52), 'AZ', '52→AZ');
    t.eq(roomTag.toTag(53), 'BA', '53→BA');
    t.eq(roomTag.tagRank('AA'), 27, 'AA 回推 27');
    t.eq(roomTag.tagRank('Z'), 26, 'Z 回推 26');
    t.check(roomTag.isValidTag('AA'), '大写多字母合法');
    t.check(!roomTag.isValidTag('a') && !roomTag.isValidTag(''), '小写/空串非法（恒大写）');
    t.check(roomTag.compareByDormTag({ dormKey: 'D4-522', tag: 'A' }, { dormKey: 'D4-522', tag: 'AA' }) < 0,
      '同宿舍按 Excel 序（A 在 AA 前，禁字符串排序）');
    t.eq(roomTag.formatDormTag('D4-522', 'AA'), 'D4-522AA', '展示拼装');
    t.eq(roomTag.formatDormTag('D4-522', 'a'), 'D4-522', '非法 tag 不拼展示');
  });

  // ---------------------------------------------------------------- §7.1 状态机
  h.section('§7.1 订单状态机', (t) => {
    t.eq(state.STATUS_LIST.length, 7, '七状态');
    t.check(state.canTransition(state.STATUS.SUBMITTED, state.STATUS.ACCEPTED), '合法基线 SUBMITTED→ACCEPTED');
    t.check(!state.canTransition(state.STATUS.PICKED, state.STATUS.COMPLETED), '反例：PICKED→COMPLETED 直跳必须挡');
    t.check(!state.canTransition(state.STATUS.COMPLETED, state.STATUS.ACCEPTED), '终态不可回退');
    t.eq(state.UNDO_WINDOW_MS, 5000, 'undo 窗口 5 秒');
    t.notEmpty(Object.keys(state.ACTION_RULES || {}), '动作转移表非空');
    t.check(Object.keys(state.ACTION_RULES || {}).every((a) => !FEE_ACTION_RE.test(a)),
      '动作表零费用类动作名');
  });

  // ---------------------------------------------------------------- §7.1 错误码
  h.section('§7.1 错误码（13 码唯一集）', (t) => {
    t.eq(errorCodes.ERROR_CODES.length, 13, '恰好 13 码');
    t.eq(errorCodes.ERROR_CODE_COUNT, 13, 'ERROR_CODE_COUNT=13');
    t.eq(errorCodes.ERROR_CODES.slice().sort(), project.ERROR_CODES.slice().sort(), '与 CONTRACT 镜像双向一致');
    t.check(project.OLD_ERROR_CODES.every((c) => errorCodes.ERROR_CODES.indexOf(c) === -1), '旧错误码零残留');
    t.check(errorCodes.ERROR_CODES.every((c) => !!errorCopy.copyOf(c)), '每码都有同源文案');
    t.notEmpty(errorCodes.ERROR_CODES, '错误码样本');
  });

  // ---------------------------------------------------------------- §7.1 集合
  h.section('§7.1 集合（14 集合）', (t) => {
    t.eq(collections.COLLECTION_COUNT, 14, '恰好 14 集合');
    t.eq(collections.ALL_COLLECTIONS.slice().sort(), project.COLLECTIONS.slice().sort(), '集合注册表与 CONTRACT 镜像一致');
    t.notEmpty(collections.ALL_COLLECTIONS, '集合样本');
  });

  // ---------------------------------------------------------------- §7.1 action 注册表
  h.section('§7.1 action 注册表（visibility/write）', (t) => {
    const registered = Object.keys(actions.ACTION_MAP);
    const client = registered.filter((a) => actions.ACTION_MAP[a].visibility === 'client');
    const internal = registered.filter((a) => actions.ACTION_MAP[a].visibility === 'internal');
    const expectedClient = Object.keys(project.ACTIONS).filter((a) => project.ACTIONS[a].visibility === 'client');
    const expectedInternal = Object.keys(project.ACTIONS).filter((a) => project.ACTIONS[a].visibility === 'internal');
    t.eq(client.length, expectedClient.length, 'client 动作数与 CONTRACT 镜像一致');
    t.eq(internal.length, expectedInternal.length, 'internal 动作数与 CONTRACT 镜像一致');
    t.check(expectedClient.every((a) => registered.indexOf(a) !== -1), 'client 动作全部在册');
    t.check(expectedInternal.every((a) => registered.indexOf(a) !== -1), 'internal 动作全部在册');
    t.check(registered.every((a) => !!project.ACTIONS[a] || project.P1_ACTIONS.indexOf(a) !== -1), '注册表无未登记动作');
    t.check(registered.every((a) => typeof actions.ACTION_MAP[a].write === 'boolean'), '每条都有 write 布尔');
    t.check(internal.every((a) => /^(admin\.bootstrap|health\.check|cleanup\.)/.test(a)),
      'internal 只允许 admin.bootstrap/health.check/cleanup.*');
  });

  // ---------------------------------------------------------------- §3/§4.2 站点表与 config.stations（D32）
  h.section('§3/§4.2 站点表与 config.stations 净化（D32：固定 P1~P8、名称可改、缺省/非法回退默认）', (t) => {
    const defaults8 = stations.listStations();
    t.eq(defaults8.map((item) => item.id), ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'],
      '站点 id 固定 P1~P8（顺序固定，不自建站点）');
    t.eq(defaults8.length, 8, '站点恰好 8 个');
    t.eq(stations.stationsFromConfig(null).map((item) => item.name), defaults8.map((item) => item.name),
      '缺省 config → 回退内置默认名');
    t.eq(stations.STATION_NAME_MAX, 20, '站点名称上限 20 字（CONTRACT D32）');
    const custom = defaults8.map((item) => ({
      id: item.id,
      name: item.id === 'P5' ? '西苑菜鸟驿站东门' : item.name
    }));
    const sanitized = stations.stationsFromConfig({ stations: custom });
    t.eq([sanitized.length, sanitized[4].id, sanitized[4].name], [8, 'P5', '西苑菜鸟驿站东门'],
      '合法配置覆盖 P5 名称且固定 8 条');
    t.eq(stations.stationsFromConfig({ stations: custom.slice(0, 7) }).length, 8,
      '配置缺条目仍补齐 8 条（回退默认）');
    const bad = custom.map((item) => {
      if (item.id === 'P1') return { id: 'P1', name: '   ' };
      if (item.id === 'P2') return { id: 'P2', name: '一二三四五六七八九十一二三四五六七八九十一' };
      if (item.id === 'P6') return { id: 'P6', name: '西苑菜鸟驿站东门' };
      return item;
    });
    const sanitizedBad = stations.stationsFromConfig({ stations: bad });
    t.eq(sanitizedBad[0].name, defaults8[0].name, '空名条目回退默认');
    t.eq(sanitizedBad[1].name, defaults8[1].name, '超 20 字名称回退默认');
    t.eq(sanitizedBad[5].name, defaults8[5].name, '重名条目回退默认（名称必须唯一）');
    t.eq(new Set(sanitizedBad.map((item) => item.name)).size, 8, '净化后名称仍唯一');
    t.eq(stations.stationsFromConfig({ stations: [{ id: 'P9', name: '自建驿站' }] })[7].id, 'P8',
      '未知 id 忽略（只认 P1~P8）');
    t.eq(stations.listStations({ stations: custom })[4].name, '西苑菜鸟驿站东门',
      'listStations(options) 用配置名（客户端选择器数据源）');
    t.eq(stations.stationNameOf('P5', { stations: custom }), '西苑菜鸟驿站东门', 'stationNameOf 支持配置表');
    t.eq(stations.normalizeStation('西苑菜鸟驿站东门', { stations: custom }).id, 'P5',
      '配置名可归一到 P5（手输/选择器）');
    t.eq(stations.validateStation('P5', '', { stations: custom }).name, '西苑菜鸟驿站东门',
      'validateStation 回填配置名');
    t.eq(defaults.PUBLIC_CONFIG_KEYS.indexOf('stations') >= 0, true,
      'stations 进公开子集（客户端选择器/识别用名称）');
    t.eq(defaults.pickPublicConfig({ stations: bad }).stations[5].name, defaults8[5].name,
      'public 子集下发前净化 stations（脏配置不外泄）');
    t.eq(defaults.pickPublicConfig({}).stations.length, 8, '公开子集缺 stations 时补默认 8 条');
    t.eq(defaults.DEFAULT_CONFIG.stations.length, 8, 'admin.bootstrap 种子含 stations');
  });

  // ---------------------------------------------------------------- §4.2 多说法命中（D32）
  h.section('§4.2 D32 多说法命中（唯一最高分才采信，多解/无解不猜）', (t) => {
    const REAL_CASES = [
      ['湖工大西苑一栋南面菜鸟驿站', 'P3'],
      ['西苑一栋南面', 'P3'],
      ['五食堂21栋楼下', 'P3'],
      ['西苑菜鸟驿站', 'P5'],
      ['北苑食堂三楼', 'P4'],
      ['南苑菜鸟驿站', 'P6']
    ];
    const realHits = REAL_CASES.map((pair) => {
      const hit = stations.matchStationInText(pair[0]);
      return [hit.id, hit.conflict];
    });
    t.eq(realHits, [['P3', false], ['P3', false], ['P3', false], ['P5', false], ['P4', false], ['P6', false]],
      '真实截图说法必须全部命中对应站点（含静态别名与关键词两条路径）');
    t.eq(stations.matchStationInText('西苑菜鸟驿站').kind, 'keyword',
      '未登记为正式名/别名的真实说法走关键词命中（不是只认全名）');
    t.eq(stations.matchStationInText('南苑菜鸟驿站').kind, 'exact', '正式名逐字命中优先于关键词');
    t.check(stations.matchStationInText('西苑菜鸟驿站').hits[0] === 'P5', '命中时 hits[0] 为最优站点');
    const ambiguous1 = stations.matchStationInText('西苑一栋南面快递中心 与 西苑一栋邮政');
    t.eq([ambiguous1.id, ambiguous1.conflict], ['', true], '同时出现两个正式名 → 不猜（多解）');
    t.check(ambiguous1.hits.indexOf('P3') >= 0 && ambiguous1.hits.indexOf('P7') >= 0,
      '多解返回候选 hits（P3/P7 都在）');
    t.eq(stations.matchStationInText('西苑邮政 与 北苑食堂三楼').conflict, true, '两个别名指向不同站点 → 多解');
    t.eq([stations.matchStationInText('自建驿站到件').id,
      stations.matchStationInText('自建驿站到件').conflict], ['', false], '未登记站点不猜且不误报歧义');
    t.eq([stations.matchStationInText('湖工大取件码').id, stations.matchStationInText('').id], ['', ''],
      '只有学校名/空文本时不猜站点');
    t.eq(stations.matchStationInText('菜鸟驿站').id, '', '只命中品牌词（多站点共有）→ 不猜');
    t.eq(stations.matchStationInText('西苑一栋').conflict, true, '跨站点共有片段（P3/P7）→ 多解不猜');
    const renamed = stations.listStations().map((item) => ({
      id: item.id,
      name: item.id === 'P6' ? '南苑东门驿站' : item.name
    }));
    const renamedHit = stations.matchStationInText('南苑东门驿站取件通知', { stations: renamed });
    t.eq([renamedHit.id, renamedHit.name], ['P6', '南苑东门驿站'], '改配后的名称按当前配置命中（不是内置旧名）');
    const renamedOld = stations.matchStationInText('南苑菜鸟驿站', { stations: renamed });
    t.eq([renamedOld.id, renamedOld.kind], ['P6', 'keyword'],
      '改名后旧说法按「苑 + 专属词」仍归一到同一点（不误配其他苑的站点）');
  });

  // ---------------------------------------------------------------- §7.1/D37 launch 入口白名单与分流
  h.section('§7.1/D37 launch 入口白名单（分享卡统一经 launch + 隐私闸）', (t) => {
    t.eq(route.LAUNCH_PAGE, '/pages/launch/index', 'D37 分享落地页 = launch（唯一启动页）');
    t.eq(route.LAUNCH_PAGE !== route.ROLE_PAGE, true, 'launch 与 role 是两个路径（邀请卡由 launch 分流得到）');
    t.eq(route.entryOf(null), { bind: '', orderNo: '' }, '缺省入口参数为空（常规分流，不受影响）');
    t.eq(route.entryOf({ foo: 'x', bind: 'P-7K2-M9X' }).bind, 'P7K2M9X', 'bind 归一为 canonical 兼职编号，未知参数忽略');
    t.eq(route.entryOf({ bind: 'p7k2m9x' }).bind, 'P7K2M9X', '小写/无分隔统一归一（容错）');
    t.eq(route.entryOf({ bind: 'C-ABCD-2345' }).bind, '', '顾客编号不得当邀请卡参数（错对象丢弃）');
    t.eq(route.entryOf({ bind: 'DEV-01' }).bind, '', '开发者编号丢弃（不落到顾客邀请链路）');
    t.eq(route.entryOf({ bind: 'P-ABC' }).bind, '', '格式不合法的编号丢弃（不报错、不阻断启动）');
    t.eq(route.entryOf({ orderNo: '20261028-0042' }).orderNo, '20261028-0042', '合法 orderNo 透传');
    t.eq(route.entryOf({ orderNo: '2026-10-28' }).orderNo, '', '非法 orderNo 丢弃');
    t.eq(route.entryOf({ orderNo: '' }).orderNo, '', '空 orderNo 丢弃');
    t.eq(route.entryOf({ bind: 'P-7K2-M9X', orderNo: '20261028-0042' }),
      { bind: 'P7K2M9X', orderNo: '20261028-0042' }, '双参数都合法时均记录（分流时 bind 优先）');
    t.eq(route.decideEntryRoute(route.entryOf({ bind: 'P-7K2-M9X' }), { roles: [] }),
      { url: '/pages/role/index?bind=P7K2M9X', reason: 'BIND_INVITE' }, 'bind → role 邀请卡（canonical 编号）');
    t.eq(route.decideEntryRoute(route.entryOf({ orderNo: '20261028-0042' }), { roles: ['CUSTOMER'] }),
      { url: '/pkg-customer/pages/order-detail/index?orderNo=20261028-0042', reason: 'ORDER_DEEP_LINK' },
      'orderNo → 顾客订单详情（归属校验仍在服务端）');
    t.eq(route.decideEntryRoute(route.entryOf({ orderNo: '20261028-0042' }),
      { roles: ['PARTNER'], partner: { profileComplete: true, status: 'ACTIVE' } }),
    { url: '/pkg-partner/pages/order-detail/index?orderNo=20261028-0042', reason: 'ORDER_DEEP_LINK' },
    'orderNo → 兼职端订单详情（按当前业务角色）');
    t.eq(route.decideEntryRoute(route.entryOf({}), { roles: [] }), route.decideLaunchRoute({ roles: [] }),
      '无入口参数 → 常规分流（与 decideLaunchRoute 完全一致，不改变原行为）');
    t.eq(route.decideEntryRoute(route.entryOf({ bind: 'P-7K2-M9X', orderNo: '20261028-0042' }), { roles: [] }).reason,
      'BIND_INVITE', 'bind 优先于 orderNo（邀请卡是分享主场景）');
    t.eq(route.bindPagePathOf('P7K2M9X', { auto: true }),
      '/pkg-customer/pages/bind/index?bind=P7K2M9X&auto=1', 'D38 auto=1 绑定页路径单源');
    t.eq(route.bindPagePathOf('P7K2M9X', { mode: 'rebind' }),
      '/pkg-customer/pages/bind/index?bind=P7K2M9X&mode=rebind', 'D28 换绑入口路径沿用既有 mode=rebind');
    t.eq(route.profileEditPathOf('P7K2M9X'), '/pages/profile/index?edit=1&bind=P7K2M9X',
      '资料不完整 → profile?edit=1&bind=（保存后自动续绑）');
    t.eq(route.roleBindPathOf('P7K2M9X'), '/pages/role/index?bind=P7K2M9X', 'role 邀请卡路径单源');
    const launchJs = fs.readFileSync(path.join(ROOT, 'pages/launch/index.js'), 'utf8');
    t.check(/onLoad\(options\)[\s\S]{0,160}?entryOf\(options\)/.test(launchJs),
      'launch.onLoad 读入口参数并交 config/route 纯件（页面零参数判据）');
    t.check(launchJs.indexOf('decideEntryRoute(') !== -1, 'launch 分流走 decideEntryRoute（D37）');
    t.check(launchJs.indexOf('this.route()') > launchJs.indexOf('applyPrivacyGate(config)'),
      'launch 隐私同意闸先于分流（同意后才 route）');
    t.check(launchJs.indexOf('pendingInvite.remember(') > launchJs.indexOf('applyPrivacyGate(config)'),
      'D38 待绑定邀请在隐私闸通过后才记录（未同意不落会话状态）');
  });

  // ---------------------------------------------------------------- §7.1/D37-b 直落页隐私兜底
  h.section('§7.1/D37-b 非启动页直落兜底（旧分享卡/朋友圈卡回 launch 过闸）', (t) => {
    store.reset();
    store.patch({ config: { privacyVersion: 'v4.0.0' } });
    t.eq(privacyGate.launchRedirectOf({ bind: 'P7K2M9X' }),
      { needed: true, url: '/pages/launch/index?bind=P7K2M9X', reason: 'FIRST_RUN' },
      '未同意隐私 + 旧绑定卡直落 role → 回 launch 过闸且邀请编号不丢');
    t.eq(privacyGate.launchRedirectOf({ orderNo: '20261028-0042' }).url,
      '/pages/launch/index?orderNo=20261028-0042', '订单深链入口参数同样保留（同意后回订单详情）');
    t.eq(privacyGate.launchRedirectOf({}).url, '/pages/launch/index',
      '无入口参数（通用卡/朋友圈）回 launch 首页，不拼空 query');
    t.eq(route.launchPathOf({ bind: 'P7K2M9X' }), '/pages/launch/index?bind=P7K2M9X',
      '回启动页路径单源（页面不自拼 query）');
    t.eq(route.launchPathOf({}), '/pages/launch/index', '空入口回纯 launch 路径');
    store.patch({ privacyConsent: { version: 'v4.0.0', at: 1 } });
    t.eq(privacyGate.launchRedirectOf({ bind: 'P7K2M9X' }), { needed: false, url: '', reason: 'OK' },
      '已同意当前版本 → 直落页放行（不多跳、不重复弹窗）');
    store.patch({ config: { privacyVersion: 'v4.0.1' } });
    t.eq(privacyGate.launchRedirectOf({}).reason, 'VERSION_CHANGED',
      '隐私版本变更后直落页也必须回 launch 重新同意');
    store.patch({ config: null });
    t.eq(privacyGate.launchRedirectOf({}).needed, true, '配置未就绪 fail-closed（回 launch，不猜放行）');
    store.patch({ config: { privacyVersion: 'v4.0.0' }, privacyConsent: null });
    store.setViewContext({ viewMode: 'READONLY', role: 'CUSTOMER', target: { role: 'CUSTOMER' } });
    t.eq(privacyGate.launchRedirectOf({}).needed, false, '切换会话跳过兜底（后台排障不被隐私弹窗卡住）');
    store.clearViewContext();
    store.reset();
    t.eq(store.snapshot().privacyConsent, null, '判定用 store 当前值；测试后复位不留脏态');
    const roleJs = fs.readFileSync(path.join(ROOT, 'pages/role/index.js'), 'utf8');
    t.check(roleJs.indexOf("require('../../utils/privacy-gate')") !== -1,
      'role 邀请卡接直落兜底纯件');
    t.check(/onLoad\(options\) \{[\s\S]{0,600}?privacyGate\.redirectIfNeeded\(\{ bind: this\._bindNo \}\)/.test(roleJs),
      'role.onLoad 在邀请卡初始化前过兜底闸（旧卡直落也能回 launch 同意）');
    t.check(roleJs.indexOf('if (!blocked) this.enter();') !== -1,
      'role 只有闸放行后才进入邀请卡初始化（未同意不加载卡片/不发绑定动作）');
    const homeJs = fs.readFileSync(path.join(ROOT, 'pages/customer/home/index.js'), 'utf8');
    t.check(homeJs.indexOf("require('../../../utils/privacy-gate')") !== -1,
      '顾客首页接直落兜底纯件');
    t.check(/onShow\(\) \{[\s\S]{0,400}?privacyGate\.redirectIfNeeded\(\{\}\)/.test(homeJs),
      '首页 onShow 冷启动入口也过兜底闸（朋友圈「前往小程序」落地当前页）');
    t.check(homeJs.indexOf('if (!blocked) this.enter();') !== -1,
      '首页只有闸放行后才刷新/拉数（未同意不撞写动作）');
  });

  // ---------------------------------------------------------------- §7.1/D38 待绑定邀请（会话级 pending）
  h.section('§7.1/D38 待绑定邀请 pending（会话级 / TTL / 一次消费 / 可取消）', (t) => {
    const T0 = 1700000000000;
    pendingInvite.clear();
    t.eq(pendingInvite.peek(T0), '', '无邀请 → peek 空串（无 bind 不触发续跳）');
    t.eq(pendingInvite.take(T0), '', '无邀请 → take 空串（保存成功也不跳转）');
    t.eq(pendingInvite.remember('C-ABCD-2345', T0), false, '错对象编号不记（只认兼职编号）');
    t.eq(pendingInvite.remember('P-ABC', T0), false, '非法编号不记（不拿脏值兜底）');
    t.eq(pendingInvite.peek(T0), '', '非法编号后仍无邀请');
    t.eq(pendingInvite.remember('P-7K2-M9X', T0), true, '合法邀请编号被接受');
    t.eq(pendingInvite.peek(T0), 'P7K2M9X', 'peek 返回 canonical 且不消费（提示用）');
    t.eq(pendingInvite.peek(T0 + pendingInvite.TTL_MS - 1), 'P7K2M9X', 'TTL 内仍有效');
    t.eq(pendingInvite.take(T0 + pendingInvite.TTL_MS), '', '过期后 take 空串（不自动续跳旧邀请）');
    t.eq(pendingInvite.peek(T0 + pendingInvite.TTL_MS), '', '过期后 peek 空串');
    pendingInvite.remember('P-AAAAAA', T0);
    pendingInvite.remember('P-BBBBBB', T0 + 1);
    t.eq(pendingInvite.take(T0 + 2), 'PBBBBBB', '后一次邀请覆盖前一次（会话内只保留一条）');
    pendingInvite.remember('P7K2M9X', T0);
    t.eq(pendingInvite.take(T0 + 1), 'P7K2M9X', 'take 取后即清（自动绑定只触发一次）');
    t.eq(pendingInvite.peek(T0 + 1), '', 'take 后无残留');
    pendingInvite.remember('P7K2M9X', T0);
    pendingInvite.clear();
    t.eq(pendingInvite.peek(T0), '', 'clear 可取消自动绑定');
    t.check(pendingInvite.TTL_MS > 0 && pendingInvite.TTL_MS <= 60 * 60 * 1000,
      'TTL 短时有效（>0 且 ≤60 分钟；实际 ' + pendingInvite.TTL_MS + 'ms）');
    t.eq(pendingInvite.canonicalOf('P 7K2/M9X'), '', '无法归一的串拒收（路径参数不被当编号）');

    // 静态接线：profile 保存后自动续跳 + 可取消提示 + role 邀请卡三态（D38）
    const saveFlowJs = fs.readFileSync(path.join(ROOT, 'pages/profile/parts/save-flow.js'), 'utf8');
    t.check(saveFlowJs.indexOf("require('../../../utils/share/pending-invite')") !== -1,
      'save-flow 接会话级 pending 邀请纯件');
    t.check(/pendingInvite\.take\(\)/.test(saveFlowJs) && saveFlowJs.indexOf('if (!partnerNo)') !== -1,
      '无邀请直接 return（不触发续跳：无 bind 不动作）');
    t.check(saveFlowJs.indexOf('route.bindPagePathOf(partnerNo, { auto: true })') !== -1,
      'D38 保存成功后自动续跳 bind?auto=1');
    const partJs = fs.readFileSync(path.join(ROOT, 'pages/profile/parts/invite-continuation.js'), 'utf8');
    t.check(partJs.indexOf('pendingInvite') !== -1 && partJs.indexOf('route.entryOf(') !== -1,
      'profile 续跳 part 只经纯件消费 ?bind=（不手拼）');
    t.check(partJs.indexOf('wx.showModal(') !== -1 && partJs.indexOf('cancelText') !== -1
      && partJs.indexOf('pendingInvite.clear()') !== -1, '一次性可取消提示（取消即清 pending）');
    const profileJs = fs.readFileSync(path.join(ROOT, 'pages/profile/index.js'), 'utf8');
    t.check(profileJs.indexOf("require('./parts/invite-continuation')") !== -1,
      'profile 接邀请续跳 part（onLoad/onShow 各一行调用，守住 ≤500 行）');
    t.check(profileJs.indexOf('inviteFlow.rememberFromOptions(opts)') !== -1,
      'profile.onLoad 消费 ?bind= 写入会话级 pending');
    t.check(profileJs.indexOf('inviteFlow.prompt(this)') !== -1, 'profile.onShow 调一次性可取消提示');
    t.check(profileJs.indexOf("String(opts.bind || '').trim()") === -1,
      '旧页面自存 _pendingBind 已由会话级 pending 纯件取代（单源）');
    const roleJs = fs.readFileSync(path.join(ROOT, 'pages/role/index.js'), 'utf8');
    const roleWxml = fs.readFileSync(path.join(ROOT, 'pages/role/index.wxml'), 'utf8');
    t.check(roleJs.indexOf('route.bindPagePathOf(canonical, { auto: true })') !== -1,
      'D38 邀请卡未绑+资料完整 → bind?auto=1（落地自动 create）');
    t.check(roleJs.indexOf("route.bindPagePathOf(canonical, { mode: 'rebind' })") !== -1,
      'D38 已绑异号 → D28 换绑一次确认入口（不自动 create）');
    t.check(roleJs.indexOf('route.profileEditPathOf(canonical)') !== -1,
      'D38 资料不完整 → profile?edit=1&bind=（保存后自动续绑）');
    t.check(roleJs.indexOf('binding.partnerNo === canonical') !== -1,
      'D38 已绑同号兜底：不重复 create（与「已绑定·去下单」同口径）');
    t.check(roleWxml.indexOf('已绑定·去下单') !== -1, 'D38 已绑同号提示「已绑定·去下单」');
  });

  // ---------------------------------------------------------------- §7.6 零金额扫描器牙口
  h.section('§7.6 零金额扫描器（门禁自测）', (t) => {
    t.check(ZM.scanText(SAMPLE_TRANSPORT).length >= 1, '注入样本 1 必须命中');
    t.check(ZM.scanText(SAMPLE_PRICE).length >= 1, '注入样本 2 必须命中');
    t.check(ZM.scanText(SAMPLE_FEN).length >= 1, '注入样本 3（*Fen 后缀）必须命中');
    t.eq(ZM.scanText(CLEAN_TEXT).length, 0, '删除样本后必须绿');
    t.eq(ZM.scanText('零金额').length, 0, '固定术语「零金额」整体放行');
    t.eq(ZM.scanText('payload').length, 0, '英文按 token 边界，payload 不误报');
    const al = ZM.loadAllowlist(ROOT);
    t.eq(al.issues.length, 0, '白名单 schema 校验无问题');
    t.notEmpty(al.entries, '白名单项样本');
    t.check(al.entries.every((e) => !/[*?[\]{}]/.test(e.file)), '白名单无整文件/目录通配');
    t.check(al.entries.every((e) => typeof e.reason === 'string' && e.reason.trim().length > 0), '白名单每项都有理由');
  });
}

module.exports = { EXPECTED_ASSERTIONS, register };

if (require.main === module) {
  const { createHarness, installCrashGuard } = require('./selftest');
  const h = createHarness({ name: 'selftest-core' });
  installCrashGuard(() => ({ count: h.count, passed: h.passed, failures: h.failures.length }), 'selftest-core');
  h.setExpected(EXPECTED_ASSERTIONS);
  register(h);
  const ret = h.finish();
  if (ret && typeof ret.then === 'function') ret.then(() => {});
}
