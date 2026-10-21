// api/upload.js · 唯一 wx.cloud.uploadFile 出口（票据→本地校验/压缩→上传）
// 口径：ARCHITECTURE §3.3 / CONTRACT §4.1；头像上限判定/类型校验/压缩计划一律走 utils/avatar.js 纯件
// （阈值与质量阶梯单源，TD-007 关闭依据）。平台能力（getImageInfo/compressImage/getFileSystemManager）
// 由本层注入纯件，纯件不直接吃全局 wx；uploadFile 仍只在本文件出现（门禁 #14）。
const client = require('./client');
const store = require('../store/index');
const avatar = require('../utils/avatar');
const uploadModule = require('./modules/upload');

// CONTRACT §4.1：截图 ≤500KB、长边 1440（压缩在服务端/后续批次，本层只登记上限）。
const MAX_TICKET_BYTES = 500 * 1024;
const DEFAULT_AVATAR_BYTES = avatar.DEFAULT_MAX_BYTES;
const TICKET_LONG_SIDE_LIMIT = 1440;

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

// 票据：只执行 ≤500KB 的大小闸与"能读到文件"闸。聊天来源的扩展名不受控，
// 类型不做客户端拦截（OCR 由服务端识别失败兜底，CONTRACT §4.3），因此 TYPE 不阻断。
async function prepareTicket(platform, filePath) {
  const size = await getFileSize(platform, filePath);
  const picked = avatar.validatePicked({ path: filePath, size }, MAX_TICKET_BYTES);
  if (!picked.ok && picked.reason !== 'TYPE') {
    throw new client.CallError('VALIDATION_FAILED', invalidMessage('TICKET', picked.reason));
  }
  return { filePath, size };
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
  const prepared = await uploadModule.prepare({ purpose });
  const cloudPath = prepared.cloudPath || prepared.path;
  const uploadTicketId = prepared.uploadTicketId || prepared.ticket || prepared.ticketId;
  if (!cloudPath || !uploadTicketId) {
    throw new client.CallError('DEPENDENCY_FAILED', '上传票据异常，请重试');
  }
  const platform = platformNow();
  const local = purpose === 'AVATAR'
    ? await prepareAvatar(platform, sourcePath)
    : await prepareTicket(platform, sourcePath);
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
