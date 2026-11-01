// api/privacy.js · 隐私授权与同意判定封装（拒绝不阻断主流程）
// 口径：CONTRACT §11 + UX_CUSTOMER §9（隐私弹窗/授权时机）。同意记录的版本判定/解析/构造/全文查询
// 一律走 utils/privacy-policy.js 纯件（TD-009 关闭依据）；本层只做 wx 能力调用与公开配置取数，
// 不做版本字符串比较、不写任何本地存储。
const configModule = require('./modules/config');
const store = require('../store/index');
const privacyPolicy = require('../utils/privacy-policy');

// 只保留官方隐私指引打开能力（TD-061）：原 scope 授权/设置跳转三件套（ensureCameraAuth/openSetting/
// checkPrivacySetting）与 help 页零消费后，整簇在批 16 死代码专项删除；本层零权限扩张、零授权预请求。

function openPrivacyContract() {
  return new Promise((resolve) => {
    if (typeof wx.openPrivacyContract !== 'function') {
      resolve(false);
      return;
    }
    wx.openPrivacyContract({
      success() {
        resolve(true);
      },
      fail() {
        resolve(false);
      }
    });
  });
}

// 公开配置：store 快照优先（bootstrap 已注入，含 privacyVersion），未就绪回退 config 模块缓存。
function privacyConfig() {
  const config = store.get('config');
  if (config && typeof config === 'object' && Object.keys(config).length > 0) {
    return config;
  }
  return configModule.getCachedPublic() || {};
}

function getPrivacyVersion() {
  return privacyPolicy.expectedVersionOf(privacyConfig());
}

// 同意记录读侧：入参缺省取 store.privacyConsent（bootstrap 注入）；返回 {version, at} 或 null。
function parseConsent(raw) {
  return privacyPolicy.parseConsent(raw === undefined ? store.get('privacyConsent') : raw);
}

// 判定结果：{expectedVersion, acceptedVersion, accepted, needsPrompt, canProceed, reason, consent}；
// 页面只按 needsPrompt/reason 决定弹窗与放行（CONTRACT §11），不自行比较版本字符串。
// configPublic 可显式传入（启动早期 store 尚未 hydrate 时由调用方持有配置），缺省用本层取数。
function consentStatus(raw, configPublic) {
  const consent = parseConsent(raw);
  const config = configPublic && typeof configPublic === 'object' ? configPublic : privacyConfig();
  return Object.assign({}, privacyPolicy.consentStatus(consent, config), { consent });
}

// 用户同意后的本机内存记录：服务端 users.privacyConsent 是权威来源，本函数不写库、不落盘。
function buildConsent(version, at) {
  return privacyPolicy.buildConsent(version === undefined ? getPrivacyVersion() : version, at);
}

// 隐私政策/用户协议/关于 的全文查询串（页面自己拼路由，本层不持有页面路径）。
function docQuery(kind) {
  return privacyPolicy.docQuery(kind);
}

module.exports = {
  openPrivacyContract,
  getPrivacyVersion,
  parseConsent,
  consentStatus,
  buildConsent,
  docQuery
};
