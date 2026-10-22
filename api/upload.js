// api/upload.js · 唯一 wx.cloud.uploadFile 出口（票据→本地校验/压缩→上传）
// 口径：ARCHITECTURE §3.3 / CONTRACT §4.1；头像上限判定/类型校验/压缩计划一律走 utils/avatar.js 纯件
// （阈值与质量阶梯单源，TD-007 关闭依据）。顺序铁律：本地校验/压缩 → upload.prepare({purpose,size,contentType})
// → wx.cloud.uploadFile：服务端 size/类型闸必须收到真实入参（AVATAR 用压缩后 size + 扩展名派生 contentType；
// TICKET 只传 size、不传 contentType，兼容聊天来源 gif）。
// v1.0（P0-10）：截图 >500KB 先走 TICKET 压缩阶梯（utils/avatar.js planTicketCompression/compressTicket：
// 长边≤1440 + 质量 3 档，≤3 次仍超限才拒绝），压缩后按真实字节数走同一套服务端闸。
// 平台能力（getImageInfo/compressImage/getFileSystemManager/离屏画布）由本层注入纯件，纯件不直接吃全局 wx；
// uploadFile 仍只在本文件出现（门禁 #14）。
const client = require('./client');
const store = require('../store/index');
const avatar = require('../utils/avatar');
const uploadModule = require('./modules/upload');

// CONTRACT §4.1：截图 ≤500KB、长边 1440（压缩在服务端/后续批次，本层只登记上限）。
const MAX_TICKET_BYTES = 500 * 1024;
const DEFAULT_AVATAR_BYTES = avatar.DEFAULT_MAX_BYTES;
const TICKET_LONG_SIDE_LIMIT = 1440;

// upload.prepare 的 contentType 只由本地已校验文件的扩展名派生（客户端不自报 MIME）：
// AVATAR 仅 jpg/jpeg→image/jpeg、png→image/png；压缩产物丢失扩展名时回退原始路径（原始路径已过类型闸）。
const MIME_BY_EXTENSION = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };

function contentTypeOf(filePath, fallbackPath) {
  const extension = avatar.extensionOf(filePath) || avatar.extensionOf(fallbackPath);
  return MIME_BY_EXTENSION[extension] || '';
}

function platformNow() {
  return typeof wx !== 'undefined' ? wx : null;
}

function fileManagerOf(platform) {
  try {
    return platform && typeof platform.getFileSystemManager === 'function'
      ? platform.getFileSystemManager()
      : null;
  } catch (err) {
    return null;
  }
}

// 读不到大小一律回 0，由 validatePicked 归一为 EMPTY（单一判据，不在这里各写一套提示）。
function getFileSize(platform, filePath) {
  return new Promise((resolve) => {
    const manager = fileManagerOf(platform);
    if (!manager || typeof manager.getFileInfo !== 'function') {
      resolve(0);
      return;
    }
    try {
      manager.getFileInfo({
        filePath,
        success(res) {
          resolve(res && typeof res.size === 'number' ? Math.floor(res.size) : 0);
        },
        fail() {
          resolve(0);
        }
      });
    } catch (err) {
      resolve(0);
    }
  });
}

function getImageInfo(platform, filePath) {
  return new Promise((resolve) => {
    if (!platform || typeof platform.getImageInfo !== 'function') {
      resolve({});
      return;
    }
    try {
      platform.getImageInfo({
        src: filePath,
        success(res) {
          resolve(res || {});
        },
        fail() {
          resolve({});
        }
      });
    } catch (err) {
      resolve({});
    }
  });
}

function uploadFile(cloudPath, filePath) {
  return new Promise((resolve, reject) => {
    wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success(res) {
        if (!res || !res.fileID) {
          reject(new client.CallError('DEPENDENCY_FAILED', '文件上传失败，请重试'));
          return;
        }
        resolve(res.fileID);
      },
      fail() {
        reject(new client.CallError('DEPENDENCY_FAILED', '文件上传失败，请检查网络后重试'));
      }
    });
  });
}

function avatarMaxBytes() {
  const config = store.get('config') || {};
  return avatar.resolveMaxBytes(config.avatarMaxBytes);
}

function tooLargeMessage(purpose) {
  if (purpose === 'AVATAR') {
    return '头像图片过大，请更换一张更小的图片';
  }
  return '截图文件过大，请重新选择或裁剪后上传';
}

// reason → 用户可执行的中文提示（失败提示说真话并给下一步；不带错误码/英文）。
function invalidMessage(purpose, reason) {
  if (reason === 'SIZE') {
    return tooLargeMessage(purpose);
  }
  if (reason === 'TYPE') {
    return purpose === 'AVATAR' ? '头像仅支持 JPG / PNG 图片，请重新选择' : '图片格式不支持，请重新选择';
  }
  return '无法读取所选文件，请重新选择';
}

// 头像：按 config.avatarMaxBytes 校验 → 超限走纯件的质量阶梯压缩 → 压完复验上限。
async function prepareAvatar(platform, filePath) {
  const maxBytes = avatarMaxBytes();
  const size = await getFileSize(platform, filePath);
  const picked = avatar.validatePicked({ path: filePath, size }, maxBytes);
  if (picked.ok) {
    return { filePath, size };
  }
  if (picked.reason !== 'SIZE') {
    throw new client.CallError('VALIDATION_FAILED', invalidMessage('AVATAR', picked.reason));
  }
  const info = await getImageInfo(platform, filePath);
  const plan = avatar.planCompression({ width: info.width, height: info.height, size }, maxBytes);
  // plan.required 与 compressAvatar 内部判定同源；尺寸读不到（UNREADABLE）时交给压缩器再试一次。
  const compressed = plan.required || plan.reason === 'UNREADABLE'
    ? await avatar.compressAvatar({ platform, filePath, maxBytes })
    : null;
  if (!compressed || !compressed.ok) {
    const reason = compressed && (compressed.reason === 'EMPTY' || compressed.reason === 'UNREADABLE')
      ? 'EMPTY'
      : 'SIZE';
    throw new client.CallError('VALIDATION_FAILED', invalidMessage('AVATAR', reason));
  }
  const after = avatar.validatePicked({ path: compressed.tempFilePath, size: compressed.size }, maxBytes);
  if (!after.ok) {
    throw new client.CallError('VALIDATION_FAILED', invalidMessage('AVATAR', after.reason));
  }
  return { filePath: compressed.tempFilePath, size: compressed.size };
}

// 票据：先 ≤500KB 大小闸；超限走压缩阶梯（P0-10：长边≤1440 + 质量 3 档，≤3 次仍超限才拒绝）。
// 聊天来源的扩展名不受控，类型不做客户端拦截（OCR 由服务端识别失败兜底，CONTRACT §4.3），因此 TYPE 不阻断。
const TICKET_TOO_LARGE_MESSAGE = '截图超过 500KB，自动压缩后仍太大：请裁剪掉无关部分，或换一张截图再试';

async function prepareTicket(platform, filePath) {
  const size = await getFileSize(platform, filePath);
  const picked = avatar.validatePicked({ path: filePath, size }, MAX_TICKET_BYTES);
  if (picked.ok) {
    return { filePath, size, compressed: false };
  }
  if (picked.reason !== 'SIZE') {
    return { filePath, size };
  }
  // 压缩产物必须重新判大小（服务端仍按 500KB 闸；客户端压缩不替代服务端校验）
  const compressed = await avatar.compressTicket({ platform, filePath, maxBytes: MAX_TICKET_BYTES });
  if (compressed && compressed.ok && compressed.tempFilePath
    && compressed.size > 0 && compressed.size <= MAX_TICKET_BYTES) {
    return {
      filePath: compressed.tempFilePath,
      size: compressed.size,
      compressed: true,
      attempts: compressed.attempts
    };
  }
  const unreadable = compressed && (compressed.reason === 'EMPTY'
    || compressed.reason === 'UNREADABLE'
    || compressed.reason === 'UNSUPPORTED');
  if (unreadable) {
    throw new client.CallError('VALIDATION_FAILED', invalidMessage('TICKET', 'EMPTY'));
  }
  throw new client.CallError('VALIDATION_FAILED', TICKET_TOO_LARGE_MESSAGE);
}

async function prepareAndUpload(options) {
  const purpose = options && options.purpose;
  const sourcePath = options && options.filePath;
  if (purpose !== 'TICKET' && purpose !== 'AVATAR') {
    throw new client.CallError('VALIDATION_FAILED', '上传用途不正确');
  }
  if (!sourcePath) {
    throw new client.CallError('VALIDATION_FAILED', '请先选择文件');
  }
  // 先本地校验/压缩，再向服务端申请票据：prepare 必须收到真实 size/contentType，否则服务端闸空转。
  const platform = platformNow();
  const local = purpose === 'AVATAR'
    ? await prepareAvatar(platform, sourcePath)
    : await prepareTicket(platform, sourcePath);
  const preparePayload = { purpose, size: local.size };
  if (purpose === 'AVATAR') {
    preparePayload.contentType = contentTypeOf(local.filePath, sourcePath);
  }
  const prepared = await uploadModule.prepare(preparePayload);
  const cloudPath = prepared.cloudPath || prepared.path;
  const uploadTicketId = prepared.uploadTicketId || prepared.ticket || prepared.ticketId;
  if (!cloudPath || !uploadTicketId) {
    throw new client.CallError('DEPENDENCY_FAILED', '上传票据异常，请重试');
  }
  const fileId = await uploadFile(cloudPath, local.filePath);
  return {
    uploadTicketId,
    cloudPath,
    fileId,
    purpose,
    size: local.size,
    longSideLimit: purpose === 'TICKET' ? TICKET_LONG_SIDE_LIMIT : 0
  };
}

async function cancelTicket(uploadTicketId) {
  if (!uploadTicketId) {
    return { canceled: false };
  }
  return uploadModule.cancel({ uploadTicketId });
}

module.exports = {
  prepareAndUpload,
  cancelTicket,
  MAX_TICKET_BYTES,
  DEFAULT_AVATAR_BYTES
};
