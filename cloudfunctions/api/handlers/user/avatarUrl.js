// handlers/user/avatarUrl.js · user.avatarUrl（D42：本人头像 5 分钟临时 URL；私有存储不直读 cloud://）
// 口径：CONTRACT v1.3 D42、§4.2/§11.1；ARCHITECTURE §3.2/§4.3。读动作、无参数、无审计写入。
// 只读「当前业务身份」本人资料（真实会话=本人 openid；切换会话=effectiveOpenid），不接受任何 fileId/openid 入参 →
// 无法借参数读他人头像（越权面为零）。无头像/无文档一律返回空串。
// 双角色：一次签发两种角色的本人头像 URL（页面按当前渲染角色取，服务端不依赖客户端 activeRole）。
'use strict';

const identity = require('./_common');

const URL_TTL_SECONDS = identity.AVATAR_URL_TTL_SECONDS;

function fileIdOf(doc) {
  return doc && typeof doc.avatarFileId === 'string' ? doc.avatarFileId : '';
}

function sideDto(fileId, urls) {
  return {
    avatarFileId: fileId,
    avatarUrl: fileId && urls[fileId] ? urls[fileId] : ''
  };
}

async function handler(ctx) {
  const scope = identity.scopeOf(ctx);
  const [customer, partner] = await Promise.all([
    identity.loadCustomer(ctx, scope.openid),
    identity.loadPartnerByOpenid(ctx, scope.openid)
  ]);
  const customerFileId = fileIdOf(customer);
  const partnerFileId = fileIdOf(partner);
  const urls = await identity.signAvatarUrls(ctx, [customerFileId, partnerFileId]);
  return {
    customer: sideDto(customerFileId, urls),
    partner: sideDto(partnerFileId, urls),
    // 临时 URL 有效期（秒）：客户端可据此判断是否需要重签（不承诺精确到毫秒，页面 onShow 重签即可）
    ttlSeconds: URL_TTL_SECONDS
  };
}

module.exports = { handler };
