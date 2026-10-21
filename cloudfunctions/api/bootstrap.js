// bootstrap.js · 云函数入口装配（唯一做 cloud.init / getWXContext / deps 组装的位置）
// index.js 只负责 require wx-server-sdk 并把 sdk 注入本模块；本模块不 require 第三方库。
const app = require('./app');

// 注入式单测入口（fake DB 可注入）：createApi({ db, now, openid, env, cloud, requestId }) → { call }
function createApi(deps) {
  return app.createApi(deps);
}

// 生产入口：event/context 来自云函数运行时；cloud 为 wx-server-sdk 实例（仅 index.js 持有）
async function invoke(event, context, cloud) {
  if (!cloud || typeof cloud.init !== 'function' || typeof cloud.getWXContext !== 'function') {
    throw new Error('云开发 SDK 未注入');
  }
  cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
  const wxContext = cloud.getWXContext() || {};
  const deps = {
    db: cloud.database(),
    cloud,
    env: process.env || {},
    openid: wxContext.OPENID || '',
    requestId: event && typeof event.requestId === 'string' ? event.requestId : '',
    now: Date.now
  };
  return app.invoke(event, deps);
}

module.exports = {
  createApi,
  invoke
};
