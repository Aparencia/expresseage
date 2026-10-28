// lib/avatar-url.js · D42 头像临时 URL 签发（服务端唯一签发点；跨域复用，不让 partner/order 依赖 user 域）
// 口径：CONTRACT v1.3 D42「头像展示统一走服务端临时 URL」；ARCHITECTURE §3.2/§4.3（客户端不直读云存储）。
// 纪律：读动作专用；URL 不落库、不进日志、不回写任何集合；批量签发（一次 getTempFileURL 可含多个 fileID）。
//      无头像/环境缺能力/平台失败 → 返回空 map：调用方保留 avatarFileId 回退，客户端再退默认头像，
//      读失败不得让页面整体失败（降级不抛错）。
'use strict';

const AVATAR_URL_TTL_SECONDS = 300;

function uniqueFileIds(fileIds) {
  const list = [];
  (Array.isArray(fileIds) ? fileIds : []).forEach((value) => {
    const fileId = typeof value === 'string' ? value.trim() : '';
    if (fileId && list.indexOf(fileId) < 0) {
      list.push(fileId);
    }
  });
  return list;
}

async function signAvatarUrls(ctx, fileIds) {
  const out = {};
  const list = uniqueFileIds(fileIds);
  if (list.length === 0) {
    return out;
  }
  const cloud = ctx && ctx.cloud;
  if (!cloud || typeof cloud.getTempFileURL !== 'function') {
    return out;
  }
  try {
    const result = await cloud.getTempFileURL({
      fileList: list.map((fileID) => ({ fileID: fileID, maxAge: AVATAR_URL_TTL_SECONDS }))
    });
    const rows = result && Array.isArray(result.fileList) ? result.fileList : [];
    rows.forEach((row) => {
      if (!row || typeof row.fileID !== 'string') {
        return;
      }
      if (typeof row.tempFileURL === 'string' && row.tempFileURL) {
        out[row.fileID] = row.tempFileURL;
      }
    });
  } catch (error) {
    console.warn('[api] 头像临时地址签发失败', ctx.requestId);
  }
  return out;
}

module.exports = {
  AVATAR_URL_TTL_SECONDS,
  uniqueFileIds,
  signAvatarUrls
};
