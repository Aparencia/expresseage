// pkg-customer/pages/help/index.js · 帮助 / 隐私 / 关于（静态口径，无网络）
'use strict';

const FAQS = [
  {
    q: '怎么绑定兼职？',
    a: '向兼职要完整兼职编号（P 开头，如 P-7K2-M9X），在首页「去绑定」或兼职分享的卡片里绑定；每天最多尝试 5 次。同一个微信号不能绑定自己的兼职账号。'
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
    a: '存在微信云开发，按角色隔离、仅订单双方可见；截图在订单完成或取消后 7 天删除，订单信息 180 天后删除或匿名化。'
  },
  {
    q: '识别失败会怎么样？',
    a: '先在本机识别与规则解析；仍失败时只把去敏文字发给第三方 AI 辅助识别，原图不出本程序云存储；失败截图可能进入开发者复核（临时查看并留审计，默认 30 天删除）。你始终可以手动填写提交。'
  },
  {
    q: '头像和昵称会被谁看到？',
    a: '头像来自微信头像选择（可拒绝，拒绝后用默认头像），昵称由你确认（必填）；只向当前绑定的兼职展示，解绑或对方注销后立即不再展示；分享卡片、通知、后台都不含头像与昵称；注销会删除头像文件。'
  },
  {
    q: '怎么注销账号？',
    a: '在「我的-注销账号」：先完成或取消进行中的订单，然后一键注销，数据（含头像文件）按隐私政策删除或匿名化。'
  },
  {
    q: '需要付钱吗？',
    a: '不需要。本程序不涉及任何费用收付。'
  }
];

const DOCS = {
  about: [
    '本程序用于校园快递代取：顾客上传取件码截图下单，兼职接单、取件、送达，双方在订单里沟通进度。',
    '服务只提供代取类型（标准代取、送寝上门、加急代取、代寄快递、其他代办），不展示任何费用信息。',
    '账号问题请通过订单留言联系兼职；无法解决时联系开发者。'
  ],
  privacy: [
    '我们收集：微信登录标识、顾客编号、微信昵称（必填）、微信头像（可选，可拒绝后用默认头像）、苑/楼栋/宿舍号、可选手机尾号、订单信息与取件码截图。',
    '用途：下单履约与进度沟通；头像与昵称只向当前绑定的对方展示，解绑、停用或注销后不再展示。',
    '保存期限：截图在订单完成或取消后 7 天删除；订单信息 180 天后删除或匿名化；注销立即匿名化并删除头像文件，30 天内物理删除。',
    '识别失败时，去敏后的截图文字会发给第三方 AI 服务辅助识别；原图不出本程序云存储，也不会发给第三方。',
    '识别失败截图可能进入开发者复核（临时查看、每次审计、默认 30 天删除）。',
    '开发者账号可切换账号查看：真实账号只读，测试账号为后台合成账号（不含真实用户数据），均留审计。'
  ],
  terms: [
    '使用本程序即表示你同意按真实信息填写宿舍身份，并对提交的订单与留言负责。',
    '禁止上传他人取件码截图或用于非本人快递；违规账号可被停用。',
    '订单进度以服务端状态为准；异常订单可在订单详情留言与兼职协商处理。',
    '本程序不涉及任何费用收付，也不处理任何金钱交易。'
  ]
};

function readVersion() {
  try {
    const info = wx.getAccountInfoSync();
    const mini = info && info.miniProgram;
    return (mini && (mini.version || mini.envVersion)) || 'v1';
  } catch (err) {
    return 'v1';
  }
}

Page({
  data: {
    doc: 'about',
    docTabs: [
      { key: 'about', label: '关于' },
      { key: 'privacy', label: '隐私政策' },
      { key: 'terms', label: '用户协议' }
    ],
    faqs: FAQS,
    expanded: -1,
    paragraphs: DOCS.about,
    statements: {
      zeroMoney: '本程序不涉及任何费用收付。',
      audit: '开发者后台默认脱敏查看订单数据；完整数据查看需通过只读视角并留审计。',
      ai: '识别失败时：去敏截图文字会发给第三方 AI 辅助识别；原图不出本程序云存储；失败截图可能进入开发者复核（临时查看+审计，默认 30 天删除）。',
      avatar: '头像与昵称只向当前绑定对方展示；解绑/停用/注销后不再展示；头像可拒绝（使用默认头像）。'
    },
    version: readVersion()
  },

  onLoad(options) {
    const doc = String((options && options.doc) || 'about');
    if (DOCS[doc]) this.setData({ doc: doc, paragraphs: DOCS[doc] });
  },

  onFaqTap(e) {
    const index = Number((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.index) || -1);
    this.setData({ expanded: this.data.expanded === index ? -1 : index });
  },

  onDocTap(e) {
    const key = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key) || 'about';
    if (!DOCS[key]) return;
    this.setData({ doc: key, paragraphs: DOCS[key] });
  }
});
