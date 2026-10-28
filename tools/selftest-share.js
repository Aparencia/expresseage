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
 *   D. 静态接线：19 页好友转发 / 3 页朋友圈 / 后台 11 页零分享；app.json 页面集与清单双向一致；
 *      app.js 单页模式跳过云启动、switch-bar 会话禁分享收口、页面自拼卡片零命中（反例有牙）。
 *   E. 中性封面素材：存在、PNG 签名、尺寸 5:4 与 1:1、体积上限。
 *
 * 纪律：不 mock 全局 wx；先合法基线再反例；EXPECTED_ASSERTIONS 与实际断言数精确相等。
 * 取数：node tools/selftest-share.js | Select-Object -Last 2
 */
const fs = require('fs');
const path = require('path');
const { createHarness, installCrashGuard } = require('./selftest');
const zeroMoney = require('./zero-money-scan');

const ROOT = path.resolve(__dirname, '..');
const EXPECTED_ASSERTIONS = 182; // 实跑读数：node tools/selftest-share.js

const sharePages = require('./lib/share-pages');
const share = require(path.join(ROOT, 'utils/share/index.js'));
const platform = require(path.join(ROOT, 'utils/share/platform.js'));
const route = require(path.join(ROOT, 'config/route.js'));

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

function register(h) {
  // ------------------------------------------------------------ A. 好友转发卡片
  h.section('A 好友转发卡片纯件（绑定卡只带编号 / 其余通用 / 零 L3 / 中性封面）', (t) => {
    const bind = share.buildAppMessage({
      isCustomer: false,
      viewSession: false,
      partnerCard: { partnerNo: 'P-7K2-M9X' }
    });
    t.eq(Object.keys(bind).sort(), ['imageUrl', 'path', 'title'], '绑定卡只有 {title,path,imageUrl} 三键');
    t.eq(bind.path, '/pages/role/index?bind=P-7K2-M9X', '绑定卡 path 只带 partnerNo');
    t.eq(bind.title, share.TITLES.BIND, '绑定卡标题固定（不含任何业务值）');
    t.eq(bind.imageUrl, share.COVER, '绑定卡使用固定中性封面（不用页面截图）');

    const encoded = share.buildAppMessage({
      isCustomer: false,
      viewSession: false,
      partnerCard: { partnerNo: 'P 7K2/M9X' }
    });
    t.eq(encoded.path, '/pages/role/index?bind=P%207K2%2FM9X', '编号经 encodeURIComponent 转义（防 path 注入）');

    const generic = share.buildAppMessage({ isCustomer: true, viewSession: false, partnerCard: { partnerNo: 'P-7K2-M9X' } });
    t.eq(generic.path, route.ROLE_PAGE, '顾客 → 通用卡 path=/pages/role/index');
    t.eq(generic.path.indexOf('?'), -1, '通用卡 path 不带任何 query');
    t.eq(generic.title, share.TITLES.GENERIC, '通用卡标题固定');
    t.eq(generic.imageUrl, route.ROLE_PAGE === '' ? '' : share.COVER, '通用卡同样使用中性封面');

    const session = share.buildAppMessage({ isCustomer: false, viewSession: true, partnerCard: { partnerNo: 'P-7K2-M9X' } });
    const noCard = share.buildAppMessage({ isCustomer: false, viewSession: false, partnerCard: null });
    const blank = share.buildAppMessage({ isCustomer: false, viewSession: false, partnerCard: { partnerNo: '   ' } });
    const missing = share.buildAppMessage();
    [session, noCard, blank, missing].forEach((msg, index) => {
      t.eq(msg.path, route.ROLE_PAGE, '切换会话/无编号/缺省（#' + index + '）→ 通用卡，不外发编号');
      t.eq(msg.title, share.TITLES.GENERIC, '切换会话/无编号/缺省（#' + index + '）→ 通用标题');
    });
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
    const badCard = { title: '校园快递代取', path: '/pages/role/index?code=20731014', imageUrl: share.COVER };
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

    t.eq(sharePages.APP_MESSAGE.length, 19, '好友转发页面清单 19 页');
    t.eq(sharePages.TIMELINE.length, 3, '朋友圈页面清单 3 页（role/home/help）');
    t.eq(sharePages.ADMIN_PAGES.length, 11, '后台页面清单 11 页（零分享）');
    const business = businessPageFiles().sort();
    t.eq(business, sharePages.APP_MESSAGE.slice().sort(), 'app.json 业务页集合 = 好友转发清单（新增页面漏接即红）');

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

    // 有牙：合成违规钩子必须被判为"自拼卡片"
    const badPage = 'Page({\n  onShareAppMessage() {\n    return { title: "校园快递代取", path: "/pages/role/index?bind=P-7K2-M9X" };\n  }\n});';
    t.eq(selfBuiltCard(badPage, 'onShareAppMessage'), true, '反例命中：页面自拼 title/path 会被本断言判红');
    t.check(handlerBody(badPage, 'onShareAppMessage').indexOf('title:') !== -1, '钩子体抽取位置稳定（判据可复现）');
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
