// pkg-customer/pages/help/index.js · 帮助 / 隐私 / 关于（静态口径，无网络）
// 隐私全文单源：pkg-customer/parts/privacy-text.js（与 docs/privacy/隐私保护指引.md 定稿候选 v1.0 对齐）；
// 版本号取 config.privacyVersion（store 缓存优先、出厂默认兜底），页面只做取数 → setData。
'use strict';

const store = require('../../../store/index');
const defaults = require('../../../config/defaults');
const privacyText = require('../../parts/privacy-text');
const share = require('../../../utils/share/handlers');
const sharePlatform = require('../../../utils/share/platform');

const FAQS = [
  {
    q: '怎么绑定兼职？',
    a: '两种方式：①兼职在「我的」点「分享绑定卡片给顾客」把卡片发给你，点开卡片会先过隐私同意闸，再点「绑定这位兼职」——你已同意隐私且资料完整时系统会自动完成绑定（D37/D38，不再手点确认）；资料缺失会先带你补齐、保存后自动继续绑定。②在首页「去绑定」输入完整兼职编号（P 开头，如 P-XXX-XXX）查询后绑定。绑定相关（预览+提交）合计每分钟最多尝试 5 次（滚动 60 秒，D39）；同一个微信号不能绑定自己的兼职账号；已绑定同一兼职会提示「已绑定·去下单」，换绑需在一次确认内完成。'
  },
  {
    q: '为什么会「需查明」？',
    a: '截图里没有取件码，但有运单后 5 位。可以先下单，兼职会拿这 5 位去驿站查码。'
  },
  {
    q: '怎么取消或删除订单？',
    a: '待接单、已接单可以取消；已取件后请留言协商或等异常处理；已完成订单可以删除记录（删除后 7 天物理删除）。'
  },
  {
    q: '截图和资料存在哪里？',
    a: '存在微信云开发，按角色隔离、仅订单双方可见；截图是自愿的（每单 0~10 张，D40），有截图的订单在完成/取消后 7 天删除，无截图单不产生截图；订单信息完成/取消后 180 天匿名化（去标识），再 30 天后物理删除；你主动删除的已完成订单 7 天后物理删除。'
  },
  {
    q: '可以不上传截图吗？',
    a: '可以。取件码截图是自愿的（每单 0~10 张，D40），你也可以不上传任何截图，直接手填每件的站点与取件码（或运单尾号）提交；这类订单会显示「无截图·手填」，兼职按你填的信息核对。无截图单不进入识别链路，不产生截图与识别失败数据；上传截图时识别更快、兼职核对也更快（一单最多 10 张，可分次添加）。'
  },
  {
    q: '可以让兼职送到其他宿舍吗？',
    a: '可以，下单时可以改本单配送地址（他人的苑/楼栋/宿舍号）并填收件人称呼（不超过 20 字，可不填），默认送到你自己的宿舍；仅本单有效，不写回你的账号资料（不改变宿舍信息、不触发重新绑定），可见范围只有该单的你、该单兼职与后台必要治理查看（后台默认脱敏）；不采集收件方的完整手机号，也不采集任何设备定位。'
  },
  {
    q: '识别失败会怎么样？',
    a: '先在本机识别与规则解析；仍失败时只把去敏文字发给第三方 AI 辅助识别（不含原图、账号标识、联系方式、头像与昵称，不用于训练），原图不出本程序云存储；失败原图可能进入开发者复核（临时查看并留审计，默认 30 天删除）。AI 兜底不设每人每日次数上限，但保留全应用每日配额，配额用尽/冷却/超时会静默降级，你始终可以手动填写提交（D40）。'
  },
  {
    q: '头像和昵称会被谁看到？',
    a: '头像来自微信头像选择（可拒绝，拒绝后用默认头像），昵称必填、最多 20 字、可改；兼职昵称在你凭完整兼职编号预览时即可看到，头像要绑定成功后才显示；头像存在私有云存储、经约 5 分钟临时链接展示，换头像后页面会重新拉取并立即显示新头像（加载失败可重试）；解绑、兼职停用或注销后立即不再展示；对方设备已缓存或已截图的内容无法从技术上撤回；分享卡片、通知与后台列表不含头像，昵称脱敏；注销会删除头像文件。'
  },
  {
    q: '怎么注销账号？',
    a: '在「我的 → 账号 → 注销账号」：有进行中订单需先处理，然后一键注销；注销后无法恢复，唯一编号作废，头像、截图与资料按隐私政策删除或匿名化，30 天内物理删除。'
  },
  {
    q: '需要付钱吗？',
    a: '不需要。本程序不涉及任何费用收付。'
  },
  {
    q: '未成年人可以使用吗？',
    a: '本程序面向在校大学生代取快递场景，不针对未成年人单独收集个人信息。如你未满 14 周岁，请在监护人陪同下阅读隐私政策并取得监护人同意后使用。'
  },
  {
    q: '我的信息可以查、改、删吗？',
    a: '可以在「我的」查看并修改昵称、头像、宿舍与手机尾号；已完成订单可删除记录（7 天后物理删除）；可解绑兼职、注销账号，注销后唯一编号作废。头像只有当前绑定对方可见，兼职昵称凭完整编号预览可见；解除绑定、停用或注销后双方不再互见。'
  },
  {
    q: '账号切换和测试账号是什么？',
    a: '开发者可切换账号排障：真实账号只能只读查看、不能代操作、每次留审计；测试账号是后台创建的合成账号，不含任何真实用户资料，数据独立标记、不计入统计并按期清理。平台不支持切换微信登录的账号。'
  },
  {
    q: '「标准代取」和「送至楼下」有什么区别？',
    a: '标准代取=驿站取件后送到寝室门口（上楼）；送至楼下=送到宿舍楼下或约定地点（不上楼）。下单时在「服务类型」里按需要选一档即可；原「送寝上门」已并入标准代取，不再作为新选项（D41），历史订单仍按原选择展示。'
  }
];

const DOCS = {
  about: [
    '本程序用于校园快递代取：顾客上传取件码截图下单，兼职接单、取件、送达，双方在订单里沟通进度。',
    '服务只提供五类代取类型（标准代取=送到寝室门口、送至楼下=送到宿舍楼下/约定地点、加急代取、代寄快递、其他代办），不展示任何费用信息（D41）。',
    '隐私政策与用户协议是本程序的使用前提，可在本页「隐私政策 / 用户协议」标签查看全文；账号问题请先通过订单留言联系兼职。'
  ],
  terms: [
    '使用本程序即表示你同意按真实信息填写宿舍身份，并对提交的订单与留言负责。',
    '禁止上传他人取件码截图或用于非本人快递；违规账号可被停用。',
    '订单进度以服务端状态为准；异常订单可在订单详情留言与兼职协商处理。',
    '本程序不涉及任何费用收付，也不处理任何金钱交易。'
  ]
};

const DOC_TABS = [
  { key: 'about', label: '关于' },
  { key: 'privacy', label: '隐私政策' },
  { key: 'terms', label: '用户协议' }
];

const DOC_KEYS = ['about', 'privacy', 'terms'];

function readVersion() {
  try {
    const info = wx.getAccountInfoSync();
    const mini = info && info.miniProgram;
    return (mini && (mini.version || mini.envVersion)) || 'v1';
  } catch (err) {
    return 'v1';
  }
}

// 隐私版本单源：服务端配置（store 缓存）优先，缺失回落出厂默认（config/defaults.js）
function privacyVersionOf() {
  const config = store.get('config');
  const fromServer = config && typeof config.privacyVersion === 'string' ? config.privacyVersion.trim() : '';
  if (fromServer) {
    return fromServer;
  }
  return (defaults.DEFAULT_CONFIG && defaults.DEFAULT_CONFIG.privacyVersion) || '';
}

function docViewOf(key) {
  if (key === 'privacy') {
    return { sections: privacyText.buildSections(privacyVersionOf()), paragraphs: [] };
  }
  return { sections: [], paragraphs: DOCS[key] || DOCS.about };
}

Page({
  data: {
    doc: 'about',
    docTabs: DOC_TABS,
    faqs: FAQS,
    expanded: -1,
    sections: [],
    paragraphs: DOCS.about,
    statements: privacyText.STATEMENTS,
    privacyVersion: privacyVersionOf(),
    version: readVersion(),
    // 朋友圈单页模式（scene=1154）：本页是纯静态内容，可直接当朋友圈落地页；按钮类交互需隐藏
    singlePage: false,
    singlePageHint: '',
    shareTip: '',
    viewSession: false
  },

  onLoad(options) {
    const raw = String((options && options.doc) || 'about');
    const singlePage = sharePlatform.singlePageNow();
    this.setData({
      singlePage: singlePage,
      singlePageHint: singlePage ? share.SINGLE_PAGE_HINT : '',
      shareTip: share.SHARE_TIP,
      viewSession: !!store.getViewContext()
    });
    this.openDoc(DOC_KEYS.indexOf(raw) === -1 ? 'about' : raw);
  },

  onFaqTap(e) {
    const index = Number((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.index) || -1);
    this.setData({ expanded: this.data.expanded === index ? -1 : index });
  },

  onDocTap(e) {
    const key = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key) || 'about';
    if (DOC_KEYS.indexOf(key) === -1) {
      return;
    }
    this.openDoc(key);
  },

  openDoc(key) {
    const view = docViewOf(key);
    this.setData({ doc: key, sections: view.sections, paragraphs: view.paragraphs });
  },

  // 好友转发 + 朋友圈：卡片判据单源 utils/share（中性封面、零业务值；朋友圈落地=本页静态内容）
  onShareAppMessage() {
    return share.appMessage();
  },

  onShareTimeline() {
    return share.timeline();
  }
});
