'use strict';
/**
 * tools/selftest-privacy-text.js — 批 8 T6「端内隐私文本同步」断言套件（ENGINEERING §7.2 接入范式）
 *
 * 覆盖（task-80 交付 4 的五组判据）：
 *   A. 定稿 v1.10 关键条目 ⊆ 端内全文：17 项数据表 / 8 个章节标题 / 必披露主题 / 留存数字，
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
 *   I. 性别收集项（2026-10-27 task-1）：第一节新增第 19 项（默认按苑/楼栋推断、可手动修改、
 *      仅本人可见、未知不影响保存、注销删除）；旧「不采集微信头像以外的微信资料（如性别…）」表述删除。
 *   L. D57 本机取件码清单（2026-11-01）：第一节新增第 20 项「本机取件码清单」；端内全文/定稿文档/
 *      补充文档派生物三处同源写明「仅存本机、不上传不共享、可随时清空、换机/清缓存丢失」；
 *      兼职端与开发者后台（含只读视角）不可见、不强制建单或绑定、上限 50 条、端侧识别不外呼第三方 AI；
 *      定稿文档登记本机键 ex_college_v4.pickcodes 与 D57 留痕（附录 A 差异表 + 附录 C 核对表）；
 *      QA §AD AD1~AD6 与附录 E 计数 336 同源锁定；批 24 起 QA §AE AE1~AE7 与附录 E 计数 343 同源锁定（D64~D67）；批 25 起 QA §AF AF1~AF7 与计数 350 同源锁定（D61/D62）；批 26/27 起 QA §AG AG1~AG12 与计数 362 同源锁定（D58/D59/D63）。
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
const EXPECTED_ASSERTIONS = 305; // 295 + 10（2026-11-03 D58/D59/D63 隐私文本定稿 v1.10：转派协作履约披露/队内昵称可见/去候选状态 10 条 M 组）；291 + 4（2026-11-03 D58/D59/D63：QA §AG 分区声明/AG1~AG12 区间/12 行精确计数/人列且未代勾）；259 + 30（2026-11-01 D57 本机取件码清单）+ 1（2026-11-02 D64~D67 QA §AE 与计数 343）+ 1（2026-11-03 D61/D62 QA §AF 与计数 350）

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
// 2026-10-28 D40 修订：截图上限 0~5 → 0~10 张（旧口径仅允许在「已修订/留痕」上下文出现）
const BATCH10_SENTENCES = [
  '0~10 张',
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
  h.section('A 定稿 v1.10 关键条目 ⊆ 端内全文（数据项/章节/主题/留存）', (t) => {
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
    t.check(/0~10 张/.test(item(0)) && /自愿/.test(item(0)) && /手填/.test(item(0))
      && /每件仍需站点/.test(item(0)) && /取件码或运单尾号/.test(item(0))
      && /不进入识别链路/.test(item(0)),
    '批 10/D40 摘要·第 1 条：取件码截图自愿 0~10 张（D40 修订；原 0~5 已作废）、可无截图手填（每件仍需站点+取件码或尾号）、无截图单不进入识别链路（D24 改判 B）');
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
    t.eq(privacyText.TEXT_VERSION, 'v1.10', '文本版本 v1.10（定稿 v1.10；历史 v1.0 / 定稿候选 v1.3 留痕）');
    t.check(TEXT.indexOf(privacyText.TEXT_VERSION_LABEL) !== -1, '全文写明「定稿 v1.10」文本版本');
    t.check(privacyTextDocCache.indexOf(privacyText.TEXT_VERSION_LABEL) !== -1,
      '定稿文档头部同为「定稿 v1.10」（改版本必须两端同步）');
    t.check(privacyTextDocCache.indexOf(privacyText.TEXT_VERSION) !== -1,
      '定稿文档写明文本版本号 v1.10（与端内全文同一标签）');
    t.check(privacyTextDocCache.indexOf('历史版本') !== -1
      && privacyTextDocCache.indexOf('定稿候选 v1.0') !== -1,
    '定稿文档保留「历史版本 v1.0」留痕（版本标签统一不删证据）');
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
    t.eq((faqs || []).length, 14, 'FAQ 14 条（批 10 增 2 条；2026-10-28 D41 增「标准代取 vs 送至楼下」1 条）');
    const answer = (keyword) => {
      const hit = (faqs || []).filter((item) => String(item.q).indexOf(keyword) !== -1)[0];
      return hit ? String(hit.a) : '';
    };
    const avatarFaq = answer('头像和昵称');
    t.check(avatarFaq.indexOf('完整兼职编号') !== -1 && avatarFaq.indexOf('预览') !== -1
      && avatarFaq.indexOf('绑定成功后才显示') !== -1 && avatarFaq.indexOf('只向当前绑定') === -1,
    'FAQ 头像昵称：兼职昵称凭完整编号预览、头像绑定成功后才显示（与 launch 第 2 条同口径）');
    t.check(avatarFaq.indexOf('临时链接') !== -1 && avatarFaq.indexOf('可重试') !== -1,
      'FAQ 头像（D42）：头像经约 5 分钟临时链接展示、加载失败可重试（不永久默认头像）');
    t.check(answer('怎么绑定兼职').indexOf('分享绑定卡片') !== -1
      && answer('怎么绑定兼职').indexOf('自动完成绑定') !== -1
      && answer('怎么绑定兼职').indexOf('滚动 60 秒') !== -1,
    'FAQ 绑定（D37/D38/D39）：分享卡经隐私同意闸 + 资料完整自动完成绑定 + 绑定限流滚动 60 秒/5 次');
    t.check(answer('标准代取').indexOf('寝室门口') !== -1 && answer('标准代取').indexOf('楼下') !== -1
      && answer('标准代取').indexOf('送寝上门') !== -1,
    'FAQ 服务类型（D41）：标准代取=寝室门口 / 送至楼下=楼下、原「送寝上门」停用；两档可区分');
    t.check(answer('识别失败').indexOf('不设每人每日次数') !== -1,
      'FAQ AI（D40）：不设每人每日次数、保留全应用日配额与静默降级');
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
    t.check(noShotFaq.indexOf('0~10 张') !== -1 && noShotFaq.indexOf('自愿') !== -1
      && noShotFaq.indexOf('手填') !== -1 && noShotFaq.indexOf('无截图·手填') !== -1
      && noShotFaq.indexOf('不进入识别链路') !== -1,
    '批 10/D40 FAQ：截图自愿 0~10 张（D40 修订）、可无截图手填「无截图·手填」、不进入识别链路（D24）');
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
    t.check(supplement.indexOf('文本版本：' + privacyText.TEXT_VERSION_LABEL) !== -1,
      '补充文档头部文本版本与端内全文同标签（定稿 v1.10；派生物随文本重新生成）');
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

  // ------------------------------------------------------------ I. 性别收集项（2026-10-27 task-1）
  h.section('I 性别收集项（新增条款 / 旧「不采集性别」表述删除 / 派生物同源）', (t) => {
    const supplementFile = 'docs/privacy/补充文档.txt';
    const supplement = exists(supplementFile) ? readSource(supplementFile) : '';
    t.check(TEXT.indexOf('19. 性别：') !== -1, '端内全文第一节新增收集项「性别」（第 19 项）');
    t.check(TEXT.indexOf('默认按你填写的苑与楼栋推断') !== -1
      && TEXT.indexOf('也可以手动修改并保存') !== -1,
    '端内全文写明性别默认按苑/楼栋推断、也可手动修改（用户 2026-10-27 口径）');
    t.check(TEXT.indexOf('用于本人资料核对与后续按楼栋属性核对') !== -1,
      '端内全文写明性别用途（本人资料核对 / 后续按楼栋属性核对）');
    t.check(TEXT.indexOf('仅本人可见，不向兼职端、后台列表与其他用户展示') !== -1,
      '端内全文写明性别可见范围（仅本人；不向兼职端/后台列表/其他用户展示）');
    t.check(TEXT.indexOf('未知或未填写不影响资料保存') !== -1, '端内全文写明未知不阻塞资料保存');
    t.check(TEXT.indexOf('保存至账号存续期，注销时删除') !== -1,
      '端内全文写明性别留存期限=账号存续期、注销时删除');
    t.check(supplement.indexOf('19. 性别：') !== -1, '补充文档派生物与端内全文同源含性别条款（正文逐字节同源）');
    t.check(TEXT.indexOf('不采集微信头像以外的微信资料') === -1
      && TEXT.indexOf('（如性别、地区、好友列表）') === -1,
    '反例锁定：端内全文不得回归「不采集微信头像以外的微信资料（如性别…）」旧表述');
    t.check(TEXT.indexOf('性别不由微信资料获取') !== -1,
      '端内全文明确「性别不由微信资料获取」（与旧表述删除配套，如实披露来源=苑/楼栋推断或手改）');
    t.check(TEXT.indexOf('可修改微信昵称、头像、性别、苑/楼栋/宿舍号、手机尾号') !== -1,
      '第五节「改」权利清单加入性别（可手动修改）');
    t.check(TEXT.indexOf('性别可保持「未知」') !== -1,
      '第五节「拒绝非必要信息」写明性别可保持未知、不影响资料保存');
    t.check(privacyText.SECTIONS.some((section) => section.title === '一、我们收集哪些信息、做什么用')
      && privacyText.SECTIONS[1].paragraphs.some((line) => line.indexOf('19. 性别：') === 0),
    '性别条款落在第一节数据项列表（与收集清单同一结构，非散落正文）');
    t.check(privacyTextDocCache.indexOf('不采集微信头像以外的任何微信资料') === -1
      && privacyTextDocCache.indexOf('如性别、地区、好友列表') === -1,
    '定稿文档同步删除旧「不采集微信头像以外的微信资料（如性别…）」表述（三处同口径）');
    t.check(privacyTextDocCache.indexOf('性别') !== -1 && privacyTextDocCache.indexOf('D31') !== -1,
      '定稿文档登记性别条款（D31 可追溯到 CONTRACT/DECISIONS）');
  });

  // ------------------------------------------------------------ J. 2026-10-28 D37~D42 文本校准
  h.section('J 2026-10-28 D37~D42 文本校准（截图 10 / AI 不设每人每日 / 头像临时 URL / 服务类型两档 / 绑定限流）', (t) => {
    const supplementFile = 'docs/privacy/补充文档.txt';
    const supplement = exists(supplementFile) ? readSource(supplementFile) : '';
    const sides = [['端内全文', TEXT], ['定稿文档', privacyTextDocCache], ['补充文档派生物', supplement]];
    const SENTENCES = ['0~10 张', '不设每人每日', '临时链接', '送至楼下', '寝室门口'];
    SENTENCES.forEach((term) => {
      sides.forEach((pair) => {
        t.check(pair[1].indexOf(term) !== -1, pair[0] + '覆盖 D37~D42 关键句「' + term + '」');
      });
    });
    t.check(TEXT.indexOf('0~5 张') === -1, '反例锁定：端内全文无「0~5 张」旧截图上限（D40 已修订为 0~10）');
    t.check(supplement.indexOf('0~5 张') === -1, '反例锁定：补充文档派生物无「0~5 张」旧上限');
    t.check(privacyTextDocCache.indexOf('原口径 0~5 张保留留痕') !== -1,
      '定稿文档以「已修订/留痕」保留旧 0~5 张证据行（不删证据）');
    t.check(TEXT.indexOf('每账号每日最多 5 次') === -1 && privacyTextDocCache.indexOf('每账号每日最多 5 次') === -1,
      '反例锁定：端内/定稿文本不得回归「每账号每日最多 5 次」旧 AI 配额（D40 取消每人每日次数）');
    t.check(TEXT.indexOf('滚动 1 分钟窗口内最多 5 次尝试') !== -1, '端内全文：绑定限流=滚动 1 分钟最多 5 次（D39）');
    t.check(privacyTextDocCache.indexOf('滚动 60 秒') !== -1, '定稿文档：绑定限流=滚动 60 秒/5 次（D39）');
    t.check(TEXT.indexOf('约 5 分钟有效的临时链接') !== -1, '端内全文：头像经约 5 分钟临时链接展示（D42）');
    t.check(TEXT.indexOf('不会清空你已有的头像') !== -1, '端内全文：头像票据失效不清空已有头像（D42）');
    t.check(supplement.indexOf(TEXT) !== -1, '补充文档派生物仍为端内全文逐字节派生物（随文本重新生成）');
    t.check(stripComments(partSource).indexOf('0~5 张') === -1, '纯文本件正文无「0~5 张」旧上限（注释留痕不计；单源=CONTRACT D40）');
  });

  // ------------------------------------------------------------ K. TD-061 帮助页官方隐私保护指引入口
  h.section('K. TD-061 帮助页「查看官方隐私保护指引」入口（官方能力/失败轻提示/不外呼不采集）', (t) => {
    const privacyApiSource = readSource('api/privacy.js');
    const handlerStart = helpSource.indexOf('onOpenPrivacyContract()');
    const handlerBody = handlerStart < 0 ? ''
      : helpSource.slice(handlerStart, helpSource.indexOf('\n  },', handlerStart) + 1);
    t.check(privacyApiSource.indexOf('function openPrivacyContract()') >= 0
      && privacyApiSource.indexOf('wx.openPrivacyContract(') >= 0,
    'K1 api/privacy.js 仍封装微信官方 openPrivacyContract（入口复用既有能力，不新增外呼）');
    t.check(helpSource.indexOf("require('../../../api/privacy')") >= 0,
      'K2 help 页经 api/privacy 调用官方能力（页面层不直连 wx 官方 API）');
    t.check(handlerBody !== '' && handlerBody.indexOf('openPrivacyContract()') >= 0,
      'K3 help 页有入口点击处理器并真实调用 openPrivacyContract（不是只有文案）');
    t.check(helpSource.indexOf('privacyTip') >= 0 && /privacyTip:/.test(helpSource)
      && /setData\(\{\s*privacyTip:/.test(helpSource),
    'K4 打开失败给轻提示 privacyTip（不静默吞错、不向用户暴露错误码）');
    t.check(!/wx\.(openPrivacyContract|getPrivacySetting|request|cloud)/.test(helpSource),
      'K5 help 页零 wx 官方隐私 API 直调 / 零 wx.request / 零 wx.cloud（页面层零判据）');
    t.check(handlerBody !== '' && !/(wx\.|openid|getLocation|chooseMedia|chooseImage)/.test(handlerBody),
      'K6 处理器零 wx.* / 零 openid / 零定位与选图读取（官方能力打开，不采集任何用户数据）');
    t.check(helpWxml.indexOf('查看官方隐私保护指引') >= 0
      && helpWxml.indexOf('bindtap="onOpenPrivacyContract"') >= 0,
    'K7 WXML 有可点击入口（文案=查看官方隐私保护指引 + bindtap 接线）');
    t.check(/\{\{privacyTip\}\}/.test(helpWxml), 'K8 WXML 渲染失败轻提示 {{privacyTip}}');
    t.check(/wx:if="\{\{!singlePage\}\}"/.test(helpWxml),
      'K9 入口受 singlePage 隐藏（朋友圈落地页不出现按钮类交互，与分享入口同纪律）');
    const entryAt = helpWxml.indexOf('bindtap="onOpenPrivacyContract"');
    t.check(entryAt >= 0 && helpWxml.indexOf('version-card') > entryAt,
      'K10 入口位于隐私政策区与版本卡之间（帮助页可发现，不挤占既有 FAQ/全文）');
  });

  // ------------------------------------------------------------ L. D57 本机取件码清单（2026-11-01）
  h.section('L. D57 本机取件码清单（仅存本机/不上传不共享/可随时清空/换机或清缓存丢失）', (t) => {
    const supplementFile = 'docs/privacy/补充文档.txt';
    const supplement = exists(supplementFile) ? readSource(supplementFile) : '';
    const SIDES = [['端内全文', TEXT], ['定稿文档', privacyTextDocCache], ['补充文档派生物', supplement]];
    const D57_SENTENCES = ['仅存本机', '不上传不共享', '可随时清空', '换机/清缓存丢失'];
    D57_SENTENCES.forEach((term) => {
      SIDES.forEach((pair) => {
        t.check(pair[1].indexOf(term) !== -1, pair[0] + '覆盖 D57 关键句「' + term + '」（本机清单边界）');
      });
    });
    t.check(TEXT.indexOf('20. 本机取件码清单') !== -1,
      '端内全文第一节数据项新增「本机取件码清单」（第 20 项）');
    t.check(privacyText.SECTIONS[1].paragraphs.some((line) => line.indexOf('20. 本机取件码清单') === 0),
      '本机清单条款落在第一节数据项列表（与收集清单同一结构，非散落正文）');
    t.check(privacyTextDocCache.indexOf('| 20 | 本机取件码清单') !== -1,
      '定稿文档 §一 数据表新增第 20 项「本机取件码清单」');
    t.check(supplement.indexOf('20. 本机取件码清单') !== -1,
      '补充文档派生物含第 20 项（三处同源；派生物=端内全文逐字节副本）');
    t.check(TEXT.indexOf('兼职端与开发者后台（含只读视角）') !== -1
      && privacyTextDocCache.indexOf('兼职端与开发者后台（含只读视角）') !== -1,
    '端内全文 + 定稿文档：兼职端与开发者后台（含只读视角）均不可见（「不开放」边界）');
    t.check(TEXT.indexOf('不强制建单或绑定') !== -1 && privacyTextDocCache.indexOf('不强制建单或绑定') !== -1,
      '端内全文 + 定稿文档：不强制建单或绑定（「不强制绑定」边界）');
    t.check(TEXT.indexOf('上限 50 条') !== -1 && privacyTextDocCache.indexOf('上限 50 条') !== -1,
      '端内全文 + 定稿文档：本机清单上限 50 条（与 CONTRACT §11.2 同值，不写死其它数字）');
    t.check(TEXT.indexOf('唯一允许「取件码明文存本机」的例外') !== -1,
      '端内全文明确本机清单是本程序唯一允许「取件码明文存本机」的例外（L3 口径）');
    t.check(privacyTextDocCache.indexOf('取件码属 L3') !== -1
      && privacyTextDocCache.indexOf('唯一例外') !== -1,
    '定稿文档登记「取件码属 L3、本机存储为唯一例外」（可追溯 CONTRACT §11.2/§11.3）');
    t.check(TEXT.indexOf('不外呼第三方 AI') !== -1 && privacyTextDocCache.indexOf('不外呼第三方 AI') !== -1,
      '端内全文 + 定稿文档：截图识别为端侧能力、不外呼第三方 AI（零外呼，与 §R AI 兜底链路区分）');
    t.check(TEXT.indexOf('添加方式为手动输入或粘贴') !== -1 && TEXT.indexOf('端侧识别截图') !== -1,
      '端内全文写明添加方式=手动输入/粘贴 + 端侧识别截图（截图不上传）');
    t.check(TEXT.indexOf('ex_college_v4') === -1,
      '端内全文不出现本机存储键名（用户面不暴露实现键；键只登记在文档/CONTRACT）');
    t.check(privacyTextDocCache.indexOf('ex_college_v4.pickcodes') !== -1,
      '定稿文档登记本机键 ex_college_v4.pickcodes（独立于 ex_college_v4.store）');
    t.check(privacyTextDocCache.indexOf('2026-11-01 口径增补（D57 本机取件码清单）') !== -1,
      '定稿文档头部有 2026-11-01 D57 口径增补段落（改文本留痕可追溯）');
    t.check(privacyTextDocCache.split('本机取件码清单（2026-11-01，D57）').length - 1 >= 2,
      '定稿文档附录 A 差异表 + 附录 C 一致性核对表均登记 D57 本机清单（两处留痕）');
    t.check(TEXT.indexOf('无法找回') !== -1 && privacyTextDocCache.indexOf('换机/清缓存丢失') !== -1,
      '端内全文写明丢失后不可找回（与定稿文档「换机/清缓存丢失」同口径）');
    const qaDoc = readSource('docs/delivery/V4_QA_CHECKLIST.md');
    t.check(qaDoc.indexOf('## AD. v1.8 批 21 增补（D57 本机取件码清单') !== -1
      && qaDoc.indexOf('| AD1 |') !== -1 && qaDoc.indexOf('| AD6 |') !== -1,
    'QA 真机清单新增 §AD AD1~AD6（人（真机），agent 不代勾）');
    t.check(/^> 维护规则：[\s\S]{0,200}当前 \*\*362\*\* 条/m.test(qaDoc)
      && /→ \*\*362\*\*/.test(qaDoc),
    'QA 附录 E 计数与取数命令真实输出同步为 362（330 + §AD 6 + §AE 7 + §AF 7 + §AG 12）');
    t.check(qaDoc.indexOf('## AF. v2.0 批 25 增补（D61 件级取件 / D62 多站点按件分组') !== -1
      && qaDoc.indexOf('| AF1 |') !== -1 && qaDoc.indexOf('| AF7 |') !== -1,
    'QA 真机清单新增 §AF AF1~AF7（D61/D62；人（真机+控制台），agent 不代勾）');
    t.check(qaDoc.indexOf('## AE. v1.9 批 24 增补（D64/D65/D66/D67') !== -1
      && qaDoc.indexOf('| AE1 |') !== -1 && qaDoc.indexOf('| AE7 |') !== -1,
    'QA 真机清单新增 §AE AE1~AE7（D64~D67；人（真机），agent 不代勾）');
    // 审查 P2-10：旧判据只验附录 E 计数 362，未验 §AG 实体（计数可被手改而分区缺失仍绿）；补齐分区/区间/行数/人列四向。
    t.check(qaDoc.indexOf('## AG. v2.1 批 26/27 增补（D58 转派 / D59 子队员 / D63 顾客邀请顾客') !== -1
      && qaDoc.indexOf('全部为「人（真机/控制台）」项') !== -1,
    'QA 真机清单新增 §AG 分区并声明全部为「人（真机/控制台）」项（agent 不代勾）');
    t.check(qaDoc.indexOf('| AG1 |') !== -1 && qaDoc.indexOf('| AG12 |') !== -1,
      'QA §AG 覆盖 AG1~AG12（D58/D59/D63；人（真机/控制台），agent 不代勾）');
    const agRows = qaDoc.match(/^\| AG\d+ \|/gm) || [];
    t.eq(agRows.length, 12, 'QA §AG 精确 12 行（AG1~AG12 无缺号/无重复，与附录 E 合计口径同源）');
    const agHumanRows = qaDoc.match(/^\| AG\d+ \|.*\| 人（[^|]+） \| \[ \] \|/gm) || [];
    t.eq(agHumanRows.length, 12, 'QA §AG 每条都标「人（…）」且完成列为 [ ]（真机项只能用户点检，agent 不代勾）');
  });

  // ------------------------------------------------------------ M. 2026-11-03 D58/D59/D63 定稿 v1.10
  h.section('M 定稿 v1.10（D58/D59/D63：转派协作履约披露 + 队内昵称可见；privacyVersion 保持 v4.0.0）', (t) => {
    const supplementFile = 'docs/privacy/补充文档.txt';
    const supplement = exists(supplementFile) ? readSource(supplementFile) : '';
    t.check(TEXT.indexOf('例外 5（转派与协作履约）') !== -1,
      '端内全文新增「例外 5（转派与协作履约）」（D58/D59 定稿披露）');
    t.check(TEXT.indexOf('协作队员') !== -1 && TEXT.indexOf('不会获得你的头像、昵称或客户档案') !== -1,
      '端内全文写明承接方仅获履约必需信息、不获得头像/昵称/客户档案');
    t.check(TEXT.indexOf('实际履约兼职的编号') !== -1,
      '端内全文写明顾客只看实际履约兼职编号（不展示其头像/昵称）');
    t.check(TEXT.indexOf('团队页') !== -1 && TEXT.indexOf('不含头像') !== -1
      && TEXT.indexOf('顾客不能绑定子队员') !== -1,
    '端内全文写明队内昵称可见范围（团队页可见、不含头像、顾客不可绑子队员）');
    t.check(privacyTextDocCache.indexOf('转派与协作履约') !== -1
      && privacyTextDocCache.indexOf('协作队员') !== -1,
    '定稿文档写明转派与协作履约披露（三处同源）');
    t.check(privacyTextDocCache.indexOf('团队页') !== -1 && privacyTextDocCache.indexOf('不含头像') !== -1,
      '定稿文档写明队内昵称可见范围（不含头像）');
    t.check(privacyTextDocCache.indexOf('待用户终审') === -1,
      '定稿文档不再残留「待用户终审」（v1.10 已由用户 2026-11-03 确认）');
    t.check(privacyTextDocCache.indexOf('定稿 v1.10') !== -1
      && privacyTextDocCache.indexOf('2026-11-03 用户确认') !== -1,
    '定稿文档写明文本版本 v1.10 与用户确认日期');
    t.check(supplement.indexOf('转派与协作履约') !== -1 && supplement.indexOf('2026-11-03') !== -1,
      '补充文档派生物含 v1.10 定稿披露与 2026-11-03 定稿日期');
    t.check(supplement.indexOf('待用户终审') === -1 && supplement.indexOf('v1.10 候选') === -1,
      '反例锁定：补充文档不得残留「待用户终审 / v1.10 候选」旧状态');
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
