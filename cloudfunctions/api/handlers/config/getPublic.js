// handlers/config/getPublic.js · config.getPublic（公开子集：含 avatarMaxBytes/viewTicketTtlMinutes，
// 不含模板 ID / aiFallback 细节 / 任何治理参数；客户端缓存 TTL 5 分钟 + onShow 刷新）
// 口径：CONTRACT v0.9 §4.2/§7；DATA_MODEL §7.6；ENGINEERING §3.6。
'use strict';

const { loadPublicConfig } = require('./_common');

async function handler(ctx) {
  return loadPublicConfig(ctx);
}

module.exports = { handler };
