'use strict';
/**
 * tools/selftest-share.js · 分享能力断言套件（D36；ENGINEERING §8.2 #33）
 *
 * 覆盖：
 *   A. 好友转发卡片纯件：绑定卡只带 partnerNo（编码防注入）/其余一律通用邀请卡；
 *      卡片只有 {title,path,imageUrl} 三键，恶意多余字段（订单号/取件码/宿舍/尾号/头像/昵称）不泄漏；
 *      固定中性封面，禁止页面截图（页面层零封面/路径拼接）。
 *   B. 朋友圈卡片纯件：{title,query:'',imageUrl}，query 恒空、不自定义落地 path（平台限制）；
 *      单页模式场景 1154 判定与提示文案。
 *   C. 平台适配（注入假 api，不 mock 全局 wx）：切换会话隐藏/恢复菜单只调一次、单页模式识别与异常降级。
 *   D. 静态接线：19 页好友转发 / 3 页朋友圈 / 后台 11 页零分享；app.json 页面集与清单双向一致（D64 取件码页禁分享）；
 *      app.js 单页模式跳过云启动、switch-bar 会话禁分享收口、页面自拼卡片零命中（反例有牙）。
 *   E. 中性封面素材：存在、PNG 签名、尺寸 5:4 与 1:1、体积上限。
 *   S. D63 顾客邀请顾客：兼职/顾客同一张绑定卡（S1/S2）、无绑定回通用卡（S3）、切会话通用卡（S4）、
 *      零泄漏（S5）、页面/纯件静态零自拼 + 装配单源（S6）、check-share path 白名单门禁（S7）。
 *
 * 纪律：不 mock 全局 wx；先合法基线再反例；EXPECTED_ASSERTIONS 与实际断言数精确相等。
 * 取数：node tools/selftest-share.js | Select-Object -Last 2
 */
const fs = require('fs');
const path = require('path');
const { createHarness, installCrashGuard } = require('./selftest');
const zeroMoney = require('./zero-money-scan');

const ROOT = path.resolve(__dirname, '..');
const EXPECTED_ASSERTIONS = 248; // 实跑读数：node tools/selftest-share.js（D63：+S1~S7 共 52 条；D59：团队页禁分享 +1 条）

const sharePages = require('./lib/share-pages');
const checkShare = require('./lib/check-share');
const share = require(path.join(ROOT, 'utils/share/index.js'));
const platform = require(path.join(ROOT, 'utils/share/platform.js'));
const route = require(path.join(ROOT, 'config/route.js'));
const ids = require(path.join(ROOT, 'utils/ids.js'));
const enums = require(path.join(ROOT, 'shared/enums.js'));
const profileVm = require(path.join(ROOT, 'pages/profile/parts/view-model.js'));
const profileShareCard = require(path.join(ROOT, 'pages/profile/parts/share-card.js'));

const PAGES_JSON = path.join(ROOT, 'app.json');

function readText(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function lineCount(source) {
  // 与门禁 #18（tools/lib/fsutil.countLines）同口径：结尾单换行不算多一行
  const text = String(source);
  if (text === '') {
    return 0;
  }
  const lines = text.split('\n');
  return text.endsWith('\n') ? lines.length - 1 : lines.length;
}

// 取页面分享钩子函数体（≤300 字符；用于"页面不自拼卡片"静态断言）
function handlerBody(source, name) {
  const matched = String(source).match(new RegExp(name + '\\(\\)\\s*\\{([\\s\\S]{0,300}?)\\n  \\}'));
  return matched ? matched[1] : '';
}

// 判据有牙：页面钩子体只允许"return 纯件结果"，出现 title/path/imageUrl 自拼即违规
function selfBuiltCard(source, name) {
  const body = handlerBody(source, name);
  return /(?:title|path|imageUrl)\s*:/.test(body);
}

function appPages() {
  const app = JSON.parse(fs.readFileSync(PAGES_JSON, 'utf8'));
  const list = (app.pages || []).slice();
  (app.subPackages || []).forEach((sub) => {
    (sub.pages || []).forEach((page) => list.push(sub.root + '/' + page));
  });
  return list;
}

function businessPageFiles() {
  return appPages()
    .map((page) => page + '.js')
    .filter((file) => file !== 'pages/launch/index.js' && file.indexOf('pkg-admin/') !== 0);
}

function pngSize(rel) {
  const buf = fs.readFileSync(path.join(ROOT, rel));
  const signatureOk = buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { signatureOk, width, height, bytes: buf.length };
}

// D37 落地判据（与门禁 #33 同口径）：好友转发卡片只能落 launch（隐私闸入口）——
// 通用卡 path 必须逐字等于 LAUNCH_PAGE；绑定卡必须 LAUNCH_PAGE + '?bind=' 前缀。
function landingOk(cardPath) {
  if (typeof cardPath !== 'string') {
    return false;
  }
  if (cardPath === route.LAUNCH_PAGE) {
    return true;
  }
  return cardPath.indexOf(route.LAUNCH_PAGE + '?bind=') === 0;
}

function register(h) {
  // ------------------------------------------------------------ A. 好友转发卡片
  h.section('A 好友转发卡片纯件（绑定卡只带编号 / 其余通用 / 零 L3 / 中性封面）', (t) => {
    const bind = share.buildAppMessage({
      isCustomer: false,
      viewSession: false,
      partnerCard: { partnerNo: 'P-7K2-M9X' }
    });
    t.eq(Object.keys(bind).sort(), ['imageUrl', 'path', 'title'], '绑定卡只有 {title,path,imageUrl} 三键');
    t.eq(bind.path, route.LAUNCH_PAGE + '?bind=P-7K2-M9X', 'D37 绑定卡 path=launch?bind=（经隐私闸再分流，不直落业务页）');
    t.eq(landingOk(bind.path), true, 'D37 绑定卡落地判据：launch 入口（landingOk）放行');
    t.check(bind.path.indexOf(route.ROLE_PAGE) === -1, 'D37 绑定卡不得直落 role（否则绕过隐私同意闸）');
    t.eq(bind.title, share.TITLES.BIND, '绑定卡标题固定（不含任何业务值）');
    t.eq(bind.imageUrl, share.COVER, '绑定卡使用固定中性封面（不用页面截图）');

    const encoded = share.buildAppMessage({
      isCustomer: false,
      viewSession: false,
      partnerCard: { partnerNo: 'P 7K2/M9X' }
    });
    t.eq(encoded.path, route.LAUNCH_PAGE + '?bind=P%207K2%2FM9X', '编号经 encodeURIComponent 转义（防 path 注入）');

    const generic = share.buildAppMessage({ isCustomer: true, viewSession: false, partnerCard: { partnerNo: 'P-7K2-M9X' } });
    t.eq(generic.path, route.LAUNCH_PAGE, 'D37 顾客 → 通用邀请卡 path=launch（零 query）');
    t.eq(generic.path.indexOf('?'), -1, '通用卡 path 不带任何 query');
    t.eq(generic.title, share.TITLES.GENERIC, '通用卡标题固定');
    t.eq(generic.imageUrl, share.COVER, '通用卡同样使用中性封面');

    const session = share.buildAppMessage({ isCustomer: false, viewSession: true, partnerCard: { partnerNo: 'P-7K2-M9X' } });
    const noCard = share.buildAppMessage({ isCustomer: false, viewSession: false, partnerCard: null });
    const blank = share.buildAppMessage({ isCustomer: false, viewSession: false, partnerCard: { partnerNo: '   ' } });
    const missing = share.buildAppMessage();
    [session, noCard, blank, missing].forEach((msg, index) => {
      t.eq(msg.path, route.LAUNCH_PAGE, 'D37 切换会话/无编号/缺省（#' + index + '）→ 通用卡（launch 零 query），不外发编号');
      t.eq(msg.title, share.TITLES.GENERIC, '切换会话/无编号/缺省（#' + index + '）→ 通用标题');
    });
    t.eq(route.LAUNCH_PAGE !== route.ROLE_PAGE, true, 'D37 launch 入口与 role 业务页是两个不同 path（判据不是空集）');
    t.eq(landingOk('/pages/role/index?bind=P-7K2-M9X'), false, 'D37 反例有牙：直落 role?bind= 的分享 path 必须判红');
    t.eq(landingOk(route.LAUNCH_PAGE + '?foo=1'), false, 'D37 反例有牙：launch 携带非 bind 参数必须判红');
    t.check(share.TITLES.BIND !== share.TITLES.GENERIC, '绑定卡与通用卡标题不同（不会误导）');

    // 恶意多余字段：卡片零业务值（L3 不进分享卡片，CONTRACT §11）
    const hostile = share.buildAppMessage({
      isCustomer: true,
      viewSession: false,
      partnerCard: { partnerNo: '', displayName: '小王', avatarFileId: 'cloud://avatars/x.png' },
      orderNo: 'C20261028000001',
      pickupCode: '207-3-1014',
      dormKey: 'D4-522',
      phoneTail: '6678',
      pickupCode2: '20731014'
    });
    const hostileText = JSON.stringify(hostile);
    ['C20261028000001', '207-3-1014', '20731014', 'D4-522', '6678', 'cloud://', '小王'].forEach((token) => {
      t.check(hostileText.indexOf(token) === -1, '恶意入参不泄漏「' + token + '」到分享卡片');
    });
    t.check(hostileText.indexOf('P-7K2-M9X') === -1, '无编号时通用卡不带任何编号');

    // 有牙：同一判据能抓到被写进卡片体的 L3 示例
    const badCard = { title: '校园快递代取', path: route.LAUNCH_PAGE + '?code=20731014', imageUrl: share.COVER };
    t.check(JSON.stringify(badCard).indexOf('20731014') !== -1, '反例命中：卡片体写入取件码会被本断言发现');
    t.eq(zeroMoney.scanText([share.TITLES.GENERIC, share.TITLES.BIND, share.TITLES.TIMELINE].join('\n')).length, 0,
      '分享标题零金额词（复用零金额扫描词表单源）');
  });

  // ------------------------------------------------------------ B. 朋友圈卡片
  h.section('B 朋友圈卡片纯件（query 恒空 / 不自定义 path / 中性封面 / 单页模式场景）', (t) => {
    const timeline = share.buildTimeline();
    t.eq(Object.keys(timeline).sort(), ['imageUrl', 'query', 'title'], '朋友圈卡片只有 {title,query,imageUrl} 三键');
    t.eq(timeline.query, '', '朋友圈 query 恒为空串（不把页面参数/业务值带进卡片）');
    t.eq(timeline.title, share.TITLES.TIMELINE, '朋友圈标题固定');
    t.eq(timeline.imageUrl, share.COVER_TIMELINE, '朋友圈使用 1:1 中性封面');
    t.eq(timeline.path, undefined, '朋友圈卡片不含 path（平台不允许自定义落地页）');
    t.check(JSON.stringify(timeline).indexOf('207') === -1 && JSON.stringify(timeline).indexOf('D4') === -1,
      '朋友圈卡片体零取件码/宿舍样例');

    t.eq(share.isSinglePage(1154), true, '场景值 1154 = 朋友圈单页模式');
    t.eq(share.isSinglePage('1154'), true, '场景值字符串同样识别（平台偶发字符串类型）');
    t.eq(share.isSinglePage(1001), false, '普通启动场景不是单页模式');
    t.eq(share.isSinglePage(undefined), false, '缺场景值按普通模式处理');
    t.check(share.SINGLE_PAGE_HINT.indexOf('前往小程序') !== -1, '单页模式提示写明「前往小程序」下一步');
    t.check(share.SHARE_TIP.indexOf('朋友圈') !== -1, '朋友圈入口提示文案存在');
  });

  // ------------------------------------------------------------ C. 平台适配（假 api）
  h.section('C 平台适配（注入假 api：会话隐藏菜单 / 单页模式识别）', (t) => {
    const calls = [];
    const fake = {
      hideShareMenu() { calls.push('hide'); },
      showShareMenu(options) { calls.push('show:' + JSON.stringify(options)); }
    };
    t.eq(platform.syncSession(false, fake), false, '非会话首次同步不调用平台 API');
    t.eq(calls.length, 0, '非会话首次同步零调用（不发多余 API）');
    t.eq(platform.syncSession(true, fake), true, '进入切换会话 → 调用一次隐藏');
    t.eq(calls, ['hide'], '隐藏菜单只调一次');
    t.eq(platform.syncSession(true, fake), false, '会话内重复同步不重复调 API');
    t.eq(calls.length, 1, '会话内 store 通知再密也只调一次');
    t.eq(platform.syncSession(false, fake), true, '退出切换会话 → 恢复菜单');
    t.eq(calls.length, 2, '恢复只调一次 showShareMenu');
    t.check(calls[1].indexOf('"withShareTicket":false') !== -1, '恢复时 withShareTicket=false（不索要群标识）');
    t.eq(platform.syncSession(false, fake), false, '已恢复后重复同步零调用');

    t.eq(platform.singlePageNow({ getLaunchOptionsSync: () => ({ scene: 1154 }) }), true, '启动场景 1154 → 单页模式');
    t.eq(platform.singlePageNow({ getLaunchOptionsSync: () => ({ scene: 1001 }) }), false, '正常启动不是单页模式');
    t.eq(platform.singlePageNow({
      getLaunchOptionsSync: () => ({ scene: 1001 }),
      getEnterOptionsSync: () => ({ scene: 1154 })
    }), true, '二次进入场景兜底（getEnterOptionsSync）');
    t.eq(platform.singlePageNow({ getLaunchOptionsSync: () => { throw new Error('boom'); } }), false,
      '平台 API 抛错降级为普通模式（不阻断启动）');
    t.eq(platform.singlePageNow({}), false, '平台缺 getLaunchOptionsSync 时降级为普通模式');
  });

  // ------------------------------------------------------------ D. 静态接线
  h.section('D 静态接线（19 页好友转发 / 3 页朋友圈 / 后台零分享 / 单源构造）', (t) => {
    const appJs = readText('app.js');
    const switchBarJs = readText('components/switch-bar/index.js');
    const cardsJs = readText('utils/share/index.js');
    const handlersJs = readText('utils/share/handlers.js');

    t.eq(sharePages.APP_MESSAGE.length, 19, '好友转发页面清单 19 页（D64：取件码本机 L3 页不参与分享）');
    t.eq(sharePages.TIMELINE.length, 3, '朋友圈页面清单 3 页（role/home/help）');
    t.eq(sharePages.ADMIN_PAGES.length, 11, '后台页面清单 11 页（零分享）');
    // D64：取件码页是本机 L3 明文页，明确禁分享——既不在清单、也不得私挂钩子（其余业务页仍双向对帐）
    // D59：团队页含子邀请码/成员信息（治理数据不外传），同样禁分享
    const NO_SHARE = ['pages/customer/pickcodes/index.js', 'pkg-partner/pages/team/index.js'];
    const noShareSource = readText(NO_SHARE[0]);
    t.check(noShareSource.indexOf('onShareAppMessage') === -1 && noShareSource.indexOf('onShareTimeline') === -1
      && sharePages.APP_MESSAGE.indexOf(NO_SHARE[0]) === -1,
    'D64 取件码页（本机 L3）不提供分享/转发：无分享钩子且不在好友转发清单');
    const teamPageSource = readText(NO_SHARE[1]);
    t.check(teamPageSource.indexOf('onShareAppMessage') === -1 && teamPageSource.indexOf('onShareTimeline') === -1
      && sharePages.APP_MESSAGE.indexOf(NO_SHARE[1]) === -1,
    'D59 团队页不提供分享/转发：无分享钩子且不在好友转发清单（邀请码/成员信息不外传）');
    const business = businessPageFiles().filter((rel) => NO_SHARE.indexOf(rel) === -1).sort();
    t.eq(business, sharePages.APP_MESSAGE.slice().sort(), 'app.json 业务页集合（除禁分享页外）= 好友转发清单（新增页面漏接即红）');

    sharePages.APP_MESSAGE.forEach((rel) => {
      const source = readText(rel);
      t.check(lineCount(source) <= 500, rel + ' ≤500 行（门禁 #18；实际 ' + lineCount(source) + '）');
      t.check(/onShareAppMessage\(\)\s*\{/.test(source), rel + ' 挂好友转发钩子');
      const body = handlerBody(source, 'onShareAppMessage');
      const delegated = body.indexOf('share.appMessage()') !== -1 || body.indexOf('shareCard.buildShareMessage(') !== -1;
      t.check(delegated, rel + ' 分享钩子只调纯件（不自拼卡片）');
      t.check(!selfBuiltCard(source, 'onShareAppMessage'), rel + ' 钩子体零 title/path/imageUrl 自拼');
    });

    sharePages.TIMELINE.forEach((rel) => {
      const source = readText(rel);
      t.check(/onShareTimeline\(\)\s*\{/.test(source), rel + ' 挂朋友圈钩子');
      const body = handlerBody(source, 'onShareTimeline');
      t.check(body.indexOf('share.timeline()') !== -1, rel + ' 朋友圈钩子只调纯件');
      t.check(!selfBuiltCard(source, 'onShareTimeline'), rel + ' 朋友圈钩子体零自拼');
    });

    sharePages.ADMIN_PAGES.forEach((rel) => {
      const source = readText(rel);
      t.check(!/onShareAppMessage|onShareTimeline/.test(source), rel + ' 后台零分享钩子（治理数据不外传）');
    });

    // 单向：有钩子的页面必须在清单里（防"偷偷开分享"）
    const extra = appPages().map((page) => page + '.js').filter((rel) => {
      if (rel === 'pages/launch/index.js' || rel.indexOf('pkg-admin/') === 0) {
        return false;
      }
      return /onShareAppMessage|onShareTimeline/.test(readText(rel));
    }).filter((rel) => sharePages.APP_MESSAGE.indexOf(rel) === -1);
    t.eq(extra, [], '没有清单外页面私自挂分享钩子');

    // 页面层零卡片构造：封面路径/标题模板只在 utils/share（页面只转发）
    const pageFiles = appPages().map((page) => page + '.js');
    const pageBuilt = pageFiles.filter((rel) => {
      const source = readText(rel);
      return source.indexOf('assets/share/') !== -1 || source.indexOf('cover-timeline.png') !== -1;
    });
    t.eq(pageBuilt, [], '页面层零封面路径拼接（素材路径只在 utils/share）');
    t.check(cardsJs.indexOf('assets/share/cover.png') !== -1, '卡片纯件持有中性封面路径（判据不是空集）');
    t.check(cardsJs.indexOf('cover-timeline.png') !== -1, '卡片纯件持有朋友圈封面路径');
    t.check(handlersJs.indexOf('store.snapshot()') !== -1, '页面钩子经 store 快照取身份（页面零判据）');

    // 单源：卡片纯件零 wx 调用、零 L3 字段名
    t.eq((cardsJs.match(/\bwx\./g) || []).length, 0, '卡片纯件零 wx 调用（可离线直测）');
    ['orderNo', 'pickupCode', 'dormKey', 'phoneTail', 'avatarFileId', 'displayName', 'viewTicket', 'openid'].forEach((token) => {
      t.check(cardsJs.indexOf(token) === -1, '卡片纯件零 L3 字段「' + token + '」（卡片零业务值）');
    });

    // 启动/会话收口
    t.check(appJs.indexOf('singlePageNow') !== -1 && appJs.indexOf('singlePage') !== -1,
      'app.js 启动即识别朋友圈单页模式（无登录态不调云）');
    t.check(appJs.indexOf('SINGLE_PAGE') !== -1, 'app.js 单页模式跳过云初始化与 bootstrap（明确降级码）');
    t.check(switchBarJs.indexOf('syncSession(') !== -1, 'switch-bar 统一收口切换会话禁分享（O3/M-33）');
    t.check(switchBarJs.indexOf('hideShareMenu') === -1, '组件层不直写 wx 分享 API（经 utils/share/platform 注入）');

    // D37：分享卡统一经 launch（隐私闸入口）落地，launch 先隐私闸后按入口参数分流
    const launchJs = readText('pages/launch/index.js');
    t.check(cardsJs.indexOf('route.LAUNCH_PAGE') !== -1, 'D37 卡片 path 走 config/route.LAUNCH_PAGE（单源，不写死页面）');
    t.check(cardsJs.indexOf('ROLE_PAGE') === -1, 'D37 卡片纯件不再引用 ROLE_PAGE（分享不直落业务页）');
    t.check(/\bonLoad\(options\)\s*\{/.test(launchJs), 'D37 launch 接 onLoad(options) 读入口参数');
    t.check(launchJs.indexOf('entryOf(options)') !== -1, 'D37 launch 入口参数经纯件 entryOf 归一/丢弃非法');
    t.check(launchJs.indexOf('decideEntryRoute(') !== -1, 'D37 launch 分流走 config/route.decideEntryRoute');
    t.check(launchJs.indexOf('this.route()') > launchJs.indexOf('applyPrivacyGate(config)'),
      'D37 隐私同意闸先于分流（route 只在闸通过/同意后被调用）');
    t.check(launchJs.indexOf('pendingInvite.remember(') > launchJs.indexOf('applyPrivacyGate(config)'),
      'D38 待绑定邀请只在隐私闸通过后记录（未同意不落会话状态）');

    // 有牙：合成违规钩子必须被判为"自拼卡片"
    const badPage = 'Page({\n  onShareAppMessage() {\n    return { title: "校园快递代取", path: "/pages/role/index?bind=P-7K2-M9X" };\n  }\n});';
    t.eq(selfBuiltCard(badPage, 'onShareAppMessage'), true, '反例命中：页面自拼 title/path 会被本断言判红');
    t.check(handlerBody(badPage, 'onShareAppMessage').indexOf('title:') !== -1, '钩子体抽取位置稳定（判据可复现）');
  });

  // ------------------------------------------------------------ S. D63 顾客邀请顾客
  h.section('S D63 顾客邀请顾客（同一张绑定卡 / 无绑定回通用 / 切会话通用 / 零泄漏 / 静态 / 门禁）', (t) => {
    const BOUND = { partnerNo: 'P-7K2-M9X' };
    const profileJs = readText('pages/profile/index.js');
    const profileWxml = readText('pages/profile/index.wxml');
    const roleWxml = readText('pages/role/index.wxml');
    const shareCardJs = readText('pages/profile/parts/share-card.js');
    const pageBoundPath = route.LAUNCH_PAGE + '?bind=P-7K2-M9X';

    // S1 基线-兼职：有编号 → 绑定卡（D63 不改兼职侧行为）
    const partnerCard = share.buildAppMessage({ isCustomer: false, viewSession: false, partnerCard: BOUND });
    t.eq(partnerCard.path, pageBoundPath, 'S1 兼职基线：绑定卡 path=launch?bind=<编号>（D36 口径不变）');
    t.eq(partnerCard.title, share.TITLES.BIND, 'S1 兼职基线：标题仍是兼职 BIND（D63 不改兼职文案）');

    // S2 基线-顾客：有 ACTIVE 绑定 → 同一张卡（同 path、同 query 键，只换中性标题）
    const customerBind = share.buildAppMessage({ isCustomer: true, viewSession: false, boundPartnerNo: 'P-7K2-M9X' });
    t.eq(customerBind.path, partnerCard.path, 'S2 顾客基线：有绑定时 path 与兼职卡逐字相同（同一张绑定卡）');
    t.eq(customerBind.title, share.TITLES.BIND_CUSTOMER, 'S2 顾客基线：标题=TITLES.BIND_CUSTOMER（单源常量）');
    t.check(customerBind.title !== share.TITLES.BIND, 'S2 顾客卡标题与兼职卡不同（顾客不说"我在做代取"）');
    t.check(!/(奖励|返现|红包|提成|佣金|邀请者|邀请人|分享者|昵称|头像|宿舍)/.test(customerBind.title),
      'S2 顾客卡标题零奖励/邀请者/个人信息字样（中性）');
    t.eq(zeroMoney.scanText(share.TITLES.BIND_CUSTOMER).length, 0, 'S2 顾客卡标题零金额词（复用零金额词表单源）');
    t.eq(Object.keys(customerBind).sort(), ['imageUrl', 'path', 'title'], 'S2 顾客绑定卡同样只有 {title,path,imageUrl} 三键');
    const noRole = share.buildAppMessage({ viewSession: false, partnerCard: BOUND, boundPartnerNo: 'P-7K2-M9X' });
    t.eq(noRole.path, route.LAUNCH_PAGE, 'S2 身份缺省 → 通用卡（放行式严格判 true/false，不看真值）');

    // S3 无绑定：顾客无 boundPartnerNo → 通用卡（零 query）；接 partnerCard 也不能放行（防扩面）
    const unbound = share.buildAppMessage({ isCustomer: true, viewSession: false });
    t.eq(unbound.path, route.LAUNCH_PAGE, 'S3 顾客无绑定 → 通用卡（launch 零 query，不拼 ?bind=）');
    t.eq(unbound.title, share.TITLES.GENERIC, 'S3 顾客无绑定 → 通用标题');
    const blankBound = share.buildAppMessage({ isCustomer: true, viewSession: false, boundPartnerNo: '   ' });
    t.eq(blankBound.path, route.LAUNCH_PAGE, 'S3 空白绑定编号按无绑定处理（不拼空 bind）');
    const customerWithPartnerCard = share.buildAppMessage({ isCustomer: true, viewSession: false, partnerCard: BOUND });
    t.eq(customerWithPartnerCard.path, route.LAUNCH_PAGE, 'S3 顾客不能靠 partnerCard 放行（只认 boundPartnerNo，防越权）');

    // S4 切会话：viewSession===true 一律通用卡（哪怕有编号/绑定，不外发目标账号编号）
    [{
      isCustomer: true, boundPartnerNo: 'P-7K2-M9X'
    }, {
      isCustomer: false, partnerCard: BOUND
    }].forEach((src, index) => {
      const msg = share.buildAppMessage(Object.assign({ viewSession: true }, src));
      t.eq(msg.path, route.LAUNCH_PAGE, 'S4 切换会话（#' + index + '）→ 通用卡，不外发编号');
      t.eq(msg.title, share.TITLES.GENERIC, 'S4 切换会话（#' + index + '）→ 通用标题');
    });

    // S5 零泄漏：卡片对象序列化后不含邀请者编号/昵称/头像/宿舍/尾号/订单/取件码/票据
    const leakCard = share.buildAppMessage({
      isCustomer: true,
      viewSession: false,
      boundPartnerNo: 'P-7K2-M9X',
      customerNo: 'C7K2M9X1',
      inviter: 'C7K2M9X1',
      displayName: '小王',
      avatarFileId: 'cloud://avatars/x.png',
      dormKey: 'D4-522',
      phoneTail: '6678',
      orderNo: 'C20261028000001',
      pickupCode: '207-3-1014',
      viewTicket: 'T'.repeat(32)
    });
    const leakText = JSON.stringify(leakCard);
    ['C7K2M9X1', '小王', 'cloud://', 'D4-522', '6678', 'C20261028000001', '207-3-1014', 'T'.repeat(32)]
      .forEach((token) => {
        t.check(leakText.indexOf(token) === -1, 'S5 顾客绑定卡零泄漏「' + token + '」');
      });
    t.eq(leakCard.path, pageBoundPath, 'S5 卡片 path 逐字等于 launch?bind=<编号>（零新增 query）');
    t.eq(leakCard.path.split('&').length, 1, 'S5 path 无第二个参数（无 inviter= 等追加）');

    // S6 静态：页面/纯件不自拼 path/title；装配单源在 view-model（顾客 ACTIVE 绑定 → partnerCard）
    t.check(/onShareAppMessage\(\)\s*\{/.test(profileJs), 'S6 我的页挂好友转发钩子');
    const body = handlerBody(profileJs, 'onShareAppMessage');
    t.check(body.indexOf('shareCard.buildShareMessage(') !== -1, 'S6 我的页钩子只调纯件（不自拼卡片）');
    t.check(!selfBuiltCard(profileJs, 'onShareAppMessage'), 'S6 我的页钩子零 title/path/imageUrl 自拼');
    t.check(body.indexOf('boundPartnerNo:') !== -1, 'S6 我的页钩子显式传 boundPartnerNo（D63 数据装配在页面）');
    t.check(profileJs.indexOf('?bind=') === -1 && profileWxml.indexOf('?bind=') === -1,
      'S6 我的页 js/wxml 零绑定 path 自拼（页面层零判据）');
    t.check(shareCardJs.indexOf('buildAppMessage') !== -1 && !/(?:title|path|imageUrl)\s*:/.test(shareCardJs),
      'S6 share-card 薄封装只透传（零标题/路径构造）');
    t.check(profileWxml.indexOf('open-type="share"') !== -1, 'S6 我的页保留分享按钮（Q15=A：唯一顾客分享入口）');
    t.eq((readText('utils/share/index.js').match(/\bwx\./g) || []).length, 0, 'S6 卡片纯件零 wx 调用（可离线直测）');
    t.check(roleWxml.indexOf('兼职绑定卡') !== -1 && roleWxml.indexOf('兼职邀请你绑定') === -1,
      'S6 落地邀请卡标题中性（D63：顾客分享的卡同样成立，不声称"兼职邀请你绑定"）');
    t.check(!/邀请者|邀请人/.test(roleWxml), 'S6 落地页零邀请者字样（顾客分享不暴露邀请者信息）');

    const vmBound = profileVm.buildVm({
      roles: ['CUSTOMER'],
      activeRole: 'CUSTOMER',
      customer: {},
      binding: { status: enums.BINDING_STATUS.ACTIVE, partnerNo: 'P-7K2-M9X' }
    });
    t.eq(vmBound.partnerCard && vmBound.partnerCard.partnerNo, 'P-7K2-M9X',
      'S6 顾客 ACTIVE 绑定 → 页面 partnerCard 带绑定兼职编号（装配单源）');
    const vmPublic = profileVm.buildVm({
      roles: ['CUSTOMER'],
      activeRole: 'CUSTOMER',
      customer: {},
      binding: { status: enums.BINDING_STATUS.ACTIVE, partnerNo: '', partnerPublic: { partnerNo: 'P-7K2-M9X' } }
    });
    t.eq(vmPublic.partnerCard && vmPublic.partnerCard.partnerNo, 'P-7K2-M9X',
      'S6 store.binding.partnerPublic.partnerNo 优先（P0-3 水合口径）');
    const vmUnbound = profileVm.buildVm({ roles: ['CUSTOMER'], activeRole: 'CUSTOMER', customer: {}, binding: null });
    t.eq(vmUnbound.partnerCard, null, 'S3 顾客无绑定 → partnerCard 为空（分享回通用卡）');
    const vmReleased = profileVm.buildVm({
      roles: ['CUSTOMER'],
      activeRole: 'CUSTOMER',
      customer: {},
      binding: { status: enums.BINDING_STATUS.RELEASED, partnerNo: 'P-7K2-M9X' }
    });
    t.eq(vmReleased.partnerCard, null, 'S3 已解绑（RELEASED）→ partnerCard 为空（不外发旧编号）');
    const vmPartner = profileVm.buildVm({
      roles: ['PARTNER'],
      activeRole: 'PARTNER',
      partner: { status: enums.PARTNER_STATUS.ACTIVE, acceptingOrders: true, partnerNo: 'P-8F3-K2M' }
    });
    t.eq(vmPartner.partnerCard && vmPartner.partnerCard.partnerNo, 'P-8F3-K2M', 'S1 兼职 partnerCard 不被 D63 误伤（仍是身份卡）');
    const pageMsg = profileShareCard.buildShareMessage({
      isCustomer: true,
      viewSession: false,
      partnerCard: vmBound.partnerCard,
      boundPartnerNo: vmBound.partnerCard.partnerNo
    });
    t.eq(pageMsg.path, pageBoundPath, 'S2 端到端：我的页数据 → 顾客绑定卡 path（页面零自拼）');
    const pageNoBind = profileShareCard.buildShareMessage({
      isCustomer: true, viewSession: false, partnerCard: null, boundPartnerNo: ''
    });
    t.eq(pageNoBind.path, route.LAUNCH_PAGE, 'S3 端到端：无绑定页面数据 → 通用卡');

    // S7 门禁：check-share path 白名单（bind 值必须过兼职编号形态，零新增 query）
    t.eq(checkShare.landingProblemsOf(route.LAUNCH_PAGE, route.LAUNCH_PAGE, ids), [], 'S7 通用卡 path（launch 零 query）放行');
    t.eq(checkShare.landingProblemsOf(pageBoundPath, route.LAUNCH_PAGE, ids), [], 'S7 绑定卡 path（bind=合法兼职编号）放行');
    t.check(checkShare.landingProblemsOf(route.LAUNCH_PAGE + '?bind=C7K2M9X', route.LAUNCH_PAGE, ids).length > 0,
      'S7 反例：bind=顾客编号必须判红');
    t.check(checkShare.landingProblemsOf(route.LAUNCH_PAGE + '?bind=P7K2M9X&inviter=C7K2M9X', route.LAUNCH_PAGE, ids).length > 0,
      'S7 反例：追加 inviter= 等 query 必须判红');
    t.check(checkShare.landingProblemsOf('/pages/role/index?bind=P7K2M9X', route.LAUNCH_PAGE, ids).length > 0,
      'S7 反例：直落 role 必须判红');
    t.eq(ids.isPartnerNo('P7K2M9X'), true, 'S7 bind 值归一后 = shared/validate 兼职编号形态（P+6 位）');
    t.eq(ids.isPartnerNo('P0O1I2X'), false, 'S7 反例：含易混字符的编号不算合法（判据有牙）');
    t.eq(checkShare.run(), null, 'S7 门禁 #33 全量通过（含 D63 顾客绑定卡 path 白名单）');
  });

  // ------------------------------------------------------------ E. 中性封面素材
  h.section('E 中性封面素材（存在 / PNG / 尺寸 / 体积）', (t) => {
    const cover = pngSize(share.COVER);
    const timeline = pngSize(share.COVER_TIMELINE);
    t.eq(cover.signatureOk, true, '好友转发封面是合法 PNG');
    t.eq(cover.width, 500, '好友转发封面宽 500');
    t.eq(cover.height, 400, '好友转发封面高 400（5:4 转发卡比例）');
    t.eq(timeline.signatureOk, true, '朋友圈封面是合法 PNG');
    t.eq(timeline.width, 400, '朋友圈封面宽 400');
    t.eq(timeline.height, 400, '朋友圈封面高 400（1:1 朋友圈比例）');
    t.check(cover.bytes <= 200 * 1024 && timeline.bytes <= 200 * 1024, '封面体积各 ≤200KB（主包体积可控）');
  });
}

module.exports = { EXPECTED_ASSERTIONS, register };

if (require.main === module) {
  const h = createHarness({ name: 'selftest-share' });
  installCrashGuard(() => ({ count: h.count, passed: h.passed, failures: h.failures.length }), 'selftest-share');
  h.setExpected(EXPECTED_ASSERTIONS);
  register(h);
  const ret = h.finish();
  if (ret && typeof ret.then === 'function') ret.then(() => {});
}
