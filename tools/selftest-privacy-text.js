'use strict';
/**
 * tools/selftest-privacy-text.js — 批 8 T6「端内隐私文本同步」断言套件（ENGINEERING §7.2 接入范式）
 *
 * 覆盖（task-80 交付 4 的五组判据）：
 *   A. 定稿候选 v1.0 关键条目 ⊆ 端内全文：17 项数据表 / 8 个章节标题 / 必披露主题 / 留存数字，
 *      端内文本与 docs/privacy/隐私保护指引.md 同时存在（防双份漂移、防端内缺项）。
 *   B. launch 隐私弹窗 PRIVACY_ITEMS 与文档口径一致：头像/昵称可见边界（兼职昵称凭完整编号预览、
 *      头像绑定成功后才可见）、AI 仅去敏文字、账号切换/测试账号、留存期限、未成年人、注销/解绑；
 *      批 10 摘要同步（D24 截图自愿 0~5 张/可无截图手填/不进入识别链路、D25 本单配送地址/仅本单有效/
 *      不写回/不采集定位）与旧「必须先有截图」反例锁定。
 *   C. 文案纪律：零金额词（复用零金额扫描词表单源）、零 L3 敏感示例值、零英文错误码、零外链。
 *   D. 文本版本 ↔ config.privacyVersion 对应：版本号由调用方注入（文本里不写死），页面从
 *      store 缓存/出厂默认取 config.privacyVersion；文本版本号与 docs 头部一致。
 *   E. 静态纪律：#24 补偿断言（纯文本件零 Key/端点/URL/require/fetch/wx.cloud/ai.parseParcel）、
 *      #31 零孤立 TEST 字面量、页面四件套/行数/无 wx.cloud、弹窗长文可滚动、帮助页 sections 渲染。
 *   F. help 页 FAQ/口径说明与全文同口径（头像昵称、留存、未成年人、注销路径、权利 +
 *      批 10 两条：截图自愿/无截图手填、本单配送地址与收件人称呼）。
 *   G. 文档单源：docs/privacy 只有一份隐私指引、版本段落与配置键说明齐全。
 *   H. 批 10 口径（D24 无截图手填 / D25 每单配送地址 / 维持不采集定位）：三处文本
 *      （端内全文 / 定稿文档 / 补充文档派生物）关键句一致 + 旧「截图必须」口径反例锁死。
 *
 * 纪律：不 mock 全局 wx；只读文档/源码 + 纯件；先合法基线再反例；EXPECTED_ASSERTIONS 与实际断言数精确相等。
 * 取数：node tools/selftest-privacy-text.js | Select-Object -Last 2
 */
const path = require('path');
const fs = require('fs');
const { createHarness, installCrashGuard } = require('./selftest');
const zeroMoney = require('./zero-money-scan');
const privacyText = require(path.join(__dirname, '..', 'pkg-customer/parts/privacy-text.js'));
const defaults = require(path.join(__dirname, '..', 'config/defaults.js'));

const ROOT = path.resolve(__dirname, '..');
const EXPECTED_ASSERTIONS = 203; // 实跑读数：node tools/selftest-privacy-text.js

const PART_FILE = 'pkg-customer/parts/privacy-text.js';
const HELP_JS = 'pkg-customer/pages/help/index.js';
const HELP_WXML = 'pkg-customer/pages/help/index.wxml';
const HELP_WXSS = 'pkg-customer/pages/help/index.wxss';
const HELP_JSON = 'pkg-customer/pages/help/index.json';
const LAUNCH_JS = 'pages/launch/index.js';
const LAUNCH_WXML = 'pages/launch/index.wxml';
const LAUNCH_WXSS = 'pages/launch/index.wxss';
const LAUNCH_JSON = 'pages/launch/index.json';
const DOC_FILE = 'docs/privacy/隐私保护指引.md';

const CONFIG_VERSION = defaults.DEFAULT_CONFIG.privacyVersion;
const TEXT = privacyText.buildText(CONFIG_VERSION);
const SECTIONS = privacyText.buildSections(CONFIG_VERSION);

// docs §一 数据表逐项名（端内全文必须逐项覆盖；第 18 项为 D25 新增配送地址/收件人称呼）
const DATA_ITEMS = [
  '微信账号标识', '唯一编号', '微信昵称', '微信头像', '宿舍信息', '手机尾号', '订单信息',
  '取件码截图', '识别失败原图', '第三方 AI', '订单留言', '账号切换与测试账号', '已读水位',
  '登录与操作日志', '隐私同意记录', '邀请码使用记录', '限流计数', '配送地址', '收件人称呼'
];

// 批 10（D24/D25）关键句：端内全文 + 定稿文档 + 补充文档派生物三处必须同时出现（文本一致性）
const BATCH10_SENTENCES = [
  '0~5 张',
  '无截图·手填',
  '仅本单有效',
  '不写回',
  '收件人称呼',
  '不采集收件方的完整手机号',
  '不采集任何设备定位'
];

// docs 章节标题（两端必须一字不差：端内标题 = 文档标题）
const SECTION_TITLES = [
  '一、我们收集哪些信息、做什么用',
  '二、我们不收集、不做什么',
  '三、存储、保留期限与安全',
  '四、对外提供与委托处理',
  '五、你的权利（查、改、删、注销、解绑）',
  '六、未成年人保护',
  '七、变更通知',
  '八、与旧版本的关系'
];

// 必披露主题（每项都要求文档 + 端内全文同时出现）
const TOPICS = [
  '未满 14 周岁', 'DeepSeek', '去敏', '完整兼职编号', '只进不退',
  '注销账号', '解绑兼职', '拒绝非必要信息', '已缓存或已截图', '只读视角', '代客下单', '合成账号'
];

// 留存数字（docs §一/§三 与端内全文必须同值）
const RETENTIONS = ['180 天', '30 天', '7 天', '30 分钟', '5 分钟', '200KB', '500KB', '7~30', '7~90', '8 秒'];

// #24 补偿断言：豁免文件里禁止出现的一切「可执行痕迹」
const FORBIDDEN_IN_PART = [
  'DEEPSEEK_API_KEY', 'api.deepseek.com', 'http://', 'https://', 'fetch(', 'require(', 'wx.cloud', 'ai.parseParcel'
];

// #31 孤立 TEST 字面量（同 check.js #31 判据）
const ISOLATED_TEST = /(?<![A-Za-z0-9_])TEST(?![A-Za-z0-9_])/;

function readSource(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function stripComments(source) {
  return String(source).replace(/\/\/[^\n]*/g, '');
}

function lineCount(text) {
  return String(text).split('\n').length;
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

// 从页面源码里抽出纯数据数组（只允许字符串/对象字面量，不执行页面逻辑）
function extractArray(rel, name) {
  const source = readSource(rel);
  const matched = source.match(new RegExp('const ' + name + ' = (\\[[\\s\\S]*?\\n\\]);'));
  if (!matched) {
    return null;
  }
  try {
    return Function('"use strict"; return (' + matched[1] + ');')();
  } catch (err) {
    return null;
  }
}

function checkTextSides(t, term) {
  t.check(TEXT.indexOf(term) !== -1, '端内隐私全文覆盖「' + term + '」（缺项即提审阻塞）');
  t.check(privacyTextDocCache.indexOf(term) !== -1, '定稿文档含「' + term + '」（文本单源基线）');
}

const privacyTextDocCache = readSource(DOC_FILE);

function register(h) {
  const helpSource = readSource(HELP_JS);
  const helpWxml = readSource(HELP_WXML);
  const launchSource = readSource(LAUNCH_JS);
  const launchWxml = readSource(LAUNCH_WXML);
  const partSource = readSource(PART_FILE);
  const launchItems = extractArray(LAUNCH_JS, 'PRIVACY_ITEMS');
  const faqs = extractArray(HELP_JS, 'FAQS');
  const statements = privacyText.STATEMENTS;
  const joined = [TEXT, (launchItems || []).join('\n')].join('\n');
  const allFaqText = (faqs || []).map((item) => item.q + '\n' + item.a).join('\n');
  const allStatements = Object.keys(statements || {}).map((key) => statements[key]).join('\n');

  // ------------------------------------------------------------ A. 定稿关键条目 ⊆ 端内全文
  h.section('A 定稿候选 v1.0 关键条目 ⊆ 端内全文（数据项/章节/主题/留存）', (t) => {
    DATA_ITEMS.forEach((term) => checkTextSides(t, term));
    SECTION_TITLES.forEach((title) => {
      t.check(SECTIONS.some((section) => section.title === title),
        '端内隐私全文有章节「' + title + '」');
      t.check(privacyTextDocCache.indexOf(title) !== -1,
        '定稿文档有同名字符串「' + title + '」（章节口径同源）');
    });
    TOPICS.forEach((term) => checkTextSides(t, term));
    RETENTIONS.forEach((term) => checkTextSides(t, term));
  });

  // ------------------------------------------------------------ B. launch 隐私弹窗口径
  h.section('B launch 隐私弹窗 PRIVACY_ITEMS 与文档口径一致', (t) => {
    t.eq((launchItems || []).length, 7, '弹窗条目 7 条（收集/可见边界/AI/账号切换/留存/注销/未成年人）');
    const item = (index) => String((launchItems || [])[index] || '');
    t.check(/完整兼职编号/.test(item(1)) && /预览/.test(item(1)) && /头像/.test(item(1))
      && /绑定成功后才显示/.test(item(1)),
    '第 2 条：兼职昵称凭完整编号预览可见、头像绑定成功后才可见（CONTRACT §11.1 v0.9 口径）');
    t.check(/第三方 AI/.test(item(2)) && /去敏/.test(item(2)) && /原图/.test(item(2))
      && /不用于训练/.test(item(2)),
    '第 3 条：仅识别失败发去敏文字、原图不外发、不用于训练');
    t.check(/只读/.test(item(3)) && /测试账号/.test(item(3)) && /合成账号/.test(item(3)),
      '第 4 条：真实账号只读 + 测试账号为后台合成账号（含审计）');
    t.check(/7 天/.test(item(4)) && /180 天/.test(item(4)) && /30 天/.test(item(4)),
      '第 5 条：截图 7 天、订单 180+30 天、识别失败原图默认 30 天');
    t.check(/我的 → 账号/.test(item(5)) && /注销账号/.test(item(5)) && /解绑/.test(item(5)),
      '第 6 条：注销路径「我的 → 账号 → 注销账号」+ 解绑后互不可见');
    t.check(/未满 14 周岁/.test(item(6)) && /监护人/.test(item(6)),
      '第 7 条：未成年人保护提示（未满 14 周岁 + 监护人）');
    t.check(/0~5 张/.test(item(0)) && /自愿/.test(item(0)) && /手填/.test(item(0))
      && /每件仍需站点/.test(item(0)) && /取件码或运单尾号/.test(item(0))
      && /不进入识别链路/.test(item(0)),
    '批 10 摘要·第 1 条：取件码截图自愿 0~5 张、可无截图手填（每件仍需站点+取件码或尾号）、无截图单不进入识别链路（D24 改判 B）');
    t.check(/本单配送地址/.test(item(0)) && /收件人称呼/.test(item(0)) && /仅本单有效/.test(item(0))
      && /不写回/.test(item(0)) && /不采集任何设备定位/.test(item(0)),
    '批 10 摘要·第 1 条：本单配送地址与收件人称呼可选/仅本单有效/不写回资料/不采集定位（D25）');
    t.check(/7 天/.test(item(4)) && /无截图/.test(item(4)),
      '批 10 摘要·第 5 条：留存区分有截图单 7 天删除与无截图手填单不产生截图数据（D24/D9 联动）');
    t.check(!/必须先有截图|截图必填|拒绝上传将无法完成下单/.test(launchSource),
      '反例锁定：launch 摘要不得回归「必须先有截图/截图必填」旧口径（D22=A 已作废）');
    t.check(!/头像与昵称只向当前绑定/.test(stripComments(launchSource) + stripComments(helpSource) + stripComments(partSource)),
      '反例锁定：端内不得回归「头像与昵称只向当前绑定对方展示」的窄口径');
    t.check(!/DeepSeek/.test(launchSource) && !/DeepSeek/.test(helpSource),
      'launch/help 页面源码零「DeepSeek」字面量（#24 客户端零外呼痕迹；品牌名只在豁免纯文本件）');
    t.check(/DeepSeek/.test(TEXT), '端内隐私全文保留第三方服务名披露（CONTRACT §11.2 必披露）');
  });

  // ------------------------------------------------------------ C. 文案纪律
  h.section('C 文案纪律（零金额 / 零 L3 示例 / 零英文错误码 / 零外链）', (t) => {
    const visible = [TEXT, (launchItems || []).join('\n'), allFaqText, allStatements].join('\n');
    t.eq(zeroMoney.scanText(visible).length, 0, '端内可见文案零金额词命中（词表复用 zero-money-scan 单源）');
    t.check(joined.indexOf('cloud://') === -1, '无云存储 fileId 示例（L3 不外露）');
    t.check(!/https?:\/\//.test(joined), '无任何外链 URL');
    t.check(!/openid/i.test(joined), '不暴露技术身份字段名（微信账号标识用中文表述）');
    t.check(!/\d{11}/.test(joined), '无 11 位连续数字（防真实手机号示例）');
    t.check(!/\bERR[A-Z0-9_]*/.test(joined) && !/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/.test(joined),
      '无英文错误码/堆栈式标识（如 NOT_FOUND / ERR_XXX）');
    const ids = joined.match(/[CP]-[A-Z0-9]{3,4}(?:-[A-Z0-9]{3,4})?/g) || [];
    t.check(ids.length >= 2 && ids.every((id) => /^[CP]-[X-]+$/.test(id)),
      '编号示例只用掩码（C-XXXX-XXXX / P-XXX-XXX），不得出现真实编号样例');
    t.check(TEXT.split(privacyText.CONTACT_PLACEHOLDER).length - 1 >= 2,
      '联系方式/变更通知保留发布前填写占位符（用户填写项，agent 不代填）');
    t.check(TEXT.indexOf('{version}') === -1 && TEXT.indexOf('{contact}') === -1,
      '构建后的全文无未替换占位符');
  });

  // ------------------------------------------------------------ D. 文本版本 ↔ config.privacyVersion
  h.section('D 文本版本 ↔ config.privacyVersion 对应（版本单源）', (t) => {
    t.eq(privacyText.TEXT_VERSION, 'v1.0', '文本版本 v1.0（与定稿候选一致）');
    t.check(TEXT.indexOf(privacyText.TEXT_VERSION_LABEL) !== -1, '全文写明「定稿候选 v1.0」文本版本');
    t.check(privacyTextDocCache.indexOf(privacyText.TEXT_VERSION_LABEL) !== -1,
      '定稿文档头部同为「定稿候选 v1.0」（改版本必须两端同步）');
    t.check(TEXT.indexOf(CONFIG_VERSION) !== -1, '全文展示 config.privacyVersion 实际同意版本（' + CONFIG_VERSION + '）');
    t.check(privacyTextDocCache.indexOf(CONFIG_VERSION) !== -1, '定稿文档写明当前出厂版本 ' + CONFIG_VERSION);
    const swapped = privacyText.buildText('v9.9.9');
    t.check(swapped.indexOf('v9.9.9') !== -1 && swapped.indexOf(CONFIG_VERSION) === -1,
      '版本号由调用方注入（改成 v9.9.9 后文本同步变化，证明没写死）');
    t.check(partSource.indexOf(CONFIG_VERSION) === -1, '纯文本件不写死出厂版本号（避免与配置漂移）');
    t.check(defaults.PUBLIC_CONFIG_KEYS.indexOf('privacyVersion') !== -1,
      'config.privacyVersion 在 getPublic 公开子集（启动弹窗/帮助页版本判定输入）');
    t.check(helpSource.indexOf("require('../../parts/privacy-text')") !== -1
      && helpSource.indexOf('buildSections') !== -1,
    'help 页从纯文本件取全文（不各写一份）');
    t.check(helpSource.indexOf("store.get('config')") !== -1 && helpSource.indexOf('privacyVersion') !== -1,
      'help 页把服务端配置的 privacyVersion 传给纯件（store 缓存优先）');
    t.check(/wx:for="\{\{sections\}\}"/.test(helpWxml) && /doc-section-title/.test(helpWxml),
      'help 页按章节渲染隐私全文（长文可读、标题可见）');
  });

  // ------------------------------------------------------------ E. 静态纪律与门禁补偿断言
  h.section('E 静态纪律（#24 补偿断言 / #31 零 TEST / 四件套 / 行数 / 可滚动）', (t) => {
    [HELP_JS, HELP_WXML, HELP_WXSS, HELP_JSON, LAUNCH_JS, LAUNCH_WXML, LAUNCH_WXSS, LAUNCH_JSON]
      .forEach((rel) => exists(rel));
    t.check([HELP_JS, HELP_WXML, HELP_WXSS, HELP_JSON].every(exists), 'help 页面四件套齐全');
    t.check([LAUNCH_JS, LAUNCH_WXML, LAUNCH_WXSS, LAUNCH_JSON].every(exists), 'launch 页面四件套齐全');
    t.check(lineCount(partSource) <= 500, '纯文本件源码 ≤500 行（' + lineCount(partSource) + '）');
    t.check(lineCount(helpSource) <= 500, 'help/index.js ≤500 行（' + lineCount(helpSource) + '）');
    t.check(lineCount(helpWxml) <= 500, 'help/index.wxml ≤500 行（' + lineCount(helpWxml) + '）');
    t.check(lineCount(launchSource) <= 500, 'launch/index.js ≤500 行（' + lineCount(launchSource) + '）');
    t.check(lineCount(launchWxml) <= 500, 'launch/index.wxml ≤500 行（' + lineCount(launchWxml) + '）');
    t.check(!/wx\.cloud\./.test(helpSource) && !/wx\.cloud\./.test(launchSource),
      'help/launch 零 wx.cloud（页面层零判据）');
    t.check(!/\bwx\./.test(partSource), '纯文本件零 wx 调用（离线可读纯数据）');
    FORBIDDEN_IN_PART.forEach((token) => {
      t.check(partSource.indexOf(token) === -1, '豁免件补偿断言：零「' + token + '」');
    });
    t.check(!ISOLATED_TEST.test(partSource) && !ISOLATED_TEST.test(helpSource)
      && !ISOLATED_TEST.test(launchSource) && !ISOLATED_TEST.test(helpWxml)
      && !ISOLATED_TEST.test(launchWxml),
    '零孤立 TEST 字面量（#31 判据；测试账号只用中文表述）');
    t.check(/<scroll-view scroll-y class="privacy-list">/.test(launchWxml),
      '隐私弹窗长文列表用 scroll-view（条目增多不把按钮挤出屏幕）');
    t.check(/\.privacy-list\s*\{[\s\S]*?max-height:/.test(readSource(LAUNCH_WXSS)),
      '弹窗列表有 max-height（弹窗层级可用、按钮可达）');
    [PART_FILE, HELP_JS, HELP_WXML, HELP_WXSS, LAUNCH_JS, LAUNCH_WXML].forEach((rel) => {
      const source = readSource(rel);
      t.check(source.indexOf('\uFEFF') !== 0 && source.slice(-1) === '\n',
        rel + ' 编码纪律：无 BOM + 结尾单换行');
    });
  });

  // ------------------------------------------------------------ F. help FAQ / 口径说明同口径
  h.section('F help 页 FAQ / 口径说明与全文同口径', (t) => {
    t.eq((faqs || []).length, 13, 'FAQ 13 条（批 10 增「可以不上传截图吗」「可以让兼职送到其他宿舍吗」两条）');
    const answer = (keyword) => {
      const hit = (faqs || []).filter((item) => String(item.q).indexOf(keyword) !== -1)[0];
      return hit ? String(hit.a) : '';
    };
    const avatarFaq = answer('头像和昵称');
    t.check(avatarFaq.indexOf('完整兼职编号') !== -1 && avatarFaq.indexOf('预览') !== -1
      && avatarFaq.indexOf('绑定成功后才显示') !== -1 && avatarFaq.indexOf('只向当前绑定') === -1,
    'FAQ 头像昵称：兼职昵称凭完整编号预览、头像绑定成功后才显示（与 launch 第 2 条同口径）');
    t.check(answer('截图和资料').indexOf('7 天') !== -1 && answer('截图和资料').indexOf('180 天') !== -1
      && answer('截图和资料').indexOf('30 天') !== -1,
    'FAQ 留存：截图 7 天 / 订单 180+30 天（与全文一致）');
    t.check(answer('未成年人').indexOf('未满 14 周岁') !== -1 && answer('未成年人').indexOf('监护人') !== -1,
      'FAQ 未成年人：监护人陪同并同意');
    t.check(/我的 → 账号/.test(answer('注销账号')) && answer('注销账号').indexOf('30 天') !== -1,
      'FAQ 注销：路径「我的 → 账号 → 注销账号」+ 30 天物理删除');
    const profileWxml = readSource('pages/profile/index.wxml');
    t.check(TEXT.indexOf('我的 → 账号 → 注销账号') !== -1
      && profileWxml.indexOf('<view class="list-title">账号</view>') !== -1
      && profileWxml.indexOf('注销账号') !== -1,
    '注销路径与「我的」页实际卡片标题/入口一致（不写走不通的路径）');
    t.check(answer('信息可以查').indexOf('解绑') !== -1 && answer('信息可以查').indexOf('唯一编号') !== -1,
      'FAQ 用户权利：查改删/解绑/编号作废说明');
    const noShotFaq = answer('不上传截图');
    t.check(noShotFaq.indexOf('0~5 张') !== -1 && noShotFaq.indexOf('自愿') !== -1
      && noShotFaq.indexOf('手填') !== -1 && noShotFaq.indexOf('无截图·手填') !== -1
      && noShotFaq.indexOf('不进入识别链路') !== -1,
    '批 10 FAQ：截图自愿 0~5 张、可无截图手填「无截图·手填」、不进入识别链路（D24）');
    const deliveryFaq = answer('其他宿舍');
    t.check(deliveryFaq.indexOf('本单配送地址') !== -1 && deliveryFaq.indexOf('默认') !== -1
      && deliveryFaq.indexOf('仅本单有效') !== -1 && deliveryFaq.indexOf('不写回') !== -1
      && deliveryFaq.indexOf('不采集任何设备定位') !== -1,
    '批 10 FAQ：本单配送地址默认本人宿舍、仅本单有效、不写回资料、不采集定位（D25）');
    t.check(statements.avatar.indexOf('完整兼职编号') !== -1 && statements.avatar.indexOf('绑定成功后才显示') !== -1,
      '口径说明·头像：同可见边界口径');
    t.check(statements.ai.indexOf('去敏') !== -1 && statements.ai.indexOf('原图') !== -1
      && statements.ai.indexOf('不用于训练') !== -1,
    '口径说明·AI：仅去敏文字、原图不出云、不用于训练');
    t.check(statements.audit.indexOf('只读视角') !== -1 && statements.audit.indexOf('审计') !== -1,
      '口径说明·治理：只读视角 + 审计');
    t.check(statements.zeroMoney.indexOf('不涉及任何费用收付') !== -1,
      '口径说明·零金额声明保留');
  });

  // ------------------------------------------------------------ G. 文档单源
  h.section('G 文档单源与发布前填写项（含补充文档派生物）', (t) => {
    const privacyDir = path.join(ROOT, 'docs/privacy');
    const guides = fs.readdirSync(privacyDir).filter((name) => name.indexOf('隐私保护指引') !== -1);
    t.eq(guides.length, 1, 'docs/privacy 只有一份隐私保护指引（文本单源，不复制全文到 docs）');
    t.check(privacyTextDocCache.indexOf('config.privacyVersion') !== -1,
      '定稿文档写明与 config.privacyVersion 的版本对应关系');
    const supplementFile = 'docs/privacy/补充文档.txt';
    const supplement = exists(supplementFile) ? readSource(supplementFile) : '';
    t.check(privacyTextDocCache.indexOf('__________') !== -1
      && privacyTextDocCache.indexOf('剪贴板') !== -1
      && TEXT.indexOf('剪贴板') !== -1
      && supplement.indexOf(TEXT) !== -1,
    '定稿文档保留用户填写占位符；剪贴板使用披露两端同源；补充文档为端内全文派生物（随文本重新生成，不单独维护）');
  });

  // ------------------------------------------------------------ H. 批 10 口径（D24/D25）
  h.section('H 批 10 口径（D24 无截图手填 / D25 每单配送地址 / 维持不采集定位）', (t) => {
    const supplementFile = 'docs/privacy/补充文档.txt';
    const supplement = exists(supplementFile) ? readSource(supplementFile) : '';
    BATCH10_SENTENCES.forEach((term) => {
      t.check(TEXT.indexOf(term) !== -1, '端内全文覆盖批 10 关键句「' + term + '」（D24/D25 口径）');
      t.check(privacyTextDocCache.indexOf(term) !== -1, '定稿文档覆盖批 10 关键句「' + term + '」（文本同源）');
      t.check(supplement.indexOf(term) !== -1, '补充文档派生物覆盖批 10 关键句「' + term + '」（三处一致）');
    });
    t.check(TEXT.indexOf('无截图') !== -1 && TEXT.indexOf('不进入识别链路') !== -1,
      '端内全文：无截图手填单不进入识别链路（D24 口径）');
    t.check(privacyTextDocCache.indexOf('不进入识别链路') !== -1,
      '定稿文档：无截图手填单不进入识别链路（D24 口径）');
    t.check(TEXT.indexOf('取件码截图') !== -1 && TEXT.indexOf('无截图') !== -1,
      '端内全文：取件码截图自愿、可无截图手填（D24 改判口径）');
    const oldMandatory = '拒绝上传将无法完成下单';
    [['端内全文', TEXT], ['定稿文档', privacyTextDocCache], ['补充文档派生物', supplement]].forEach((pair) => {
      t.check(pair[1].indexOf(oldMandatory) === -1,
        '反例锁定：' + pair[0] + '不得回归「截图必须、拒绝上传无法下单」旧口径（D22=A 已作废）');
    });
    t.check(TEXT.indexOf('不采集任何设备定位') !== -1 && privacyTextDocCache.indexOf('定位') !== -1,
      '维持「永不收集定位」现行口径（D27 待裁决，不写入楼栋自报/地图/定位采集）');
    t.check(TEXT.indexOf('如后续提供位置相关功能') !== -1
      && privacyTextDocCache.indexOf('如后续提供位置相关功能') !== -1,
    '位置相关功能留「另行更新本指引」表述，不承诺收集（D27 待裁决）');
  });
}

module.exports = { EXPECTED_ASSERTIONS, register };

if (require.main === module) {
  const h = createHarness({ name: 'selftest-privacy-text' });
  installCrashGuard(() => ({ count: h.count, passed: h.passed, failures: h.failures.length }), 'selftest-privacy-text');
  h.setExpected(EXPECTED_ASSERTIONS);
  register(h);
  const ret = h.finish();
  if (ret && typeof ret.then === 'function') ret.then(() => {});
}
