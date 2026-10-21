// index.js · 云函数 api 入口（本部署单元唯一 require('wx-server-sdk') 的文件）
// 装配在 bootstrap.js：cloud.init / getWXContext / deps 由它完成；这里只做 sdk 注入与错误兜底。
const cloud = require('wx-server-sdk');
const bootstrap = require('./bootstrap');

exports.main = async (event, context) => {
  try {
    return await bootstrap.invoke(event, context, cloud);
  } catch (error) {
    // 装配期异常（如 SDK 未就绪）也必须返回 flat 包络，禁止把堆栈抛给客户端。
    console.error('[api] 入口装配失败');
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: '服务暂时不可用，请稍后重试',
      serverTime: Date.now(),
      requestId: ''
    };
  }
};
