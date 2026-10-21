// api/upload.js · 唯一 wx.cloud.uploadFile 出口（票据→压缩→上传）
const client = require('./client');
const store = require('../store/index');
const uploadModule = require('./modules/upload');

const MAX_TICKET_BYTES = 500 * 1024;
const DEFAULT_AVATAR_BYTES = 200 * 1024;
const TICKET_LONG_SIDE_LIMIT = 1440;

function getFileInfo(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().getFileInfo({
      filePath,
      success(res) {
        resolve(res || { size: 0 });
      },
      fail() {
        reject(new client.CallError('VALIDATION_FAILED', '无法读取所选文件，请重新选择'));
      }
    });
  });
}

function compressImage(filePath, quality) {
  return new Promise((resolve) => {
    if (typeof wx.compressImage !== 'function') {
      resolve(filePath);
      return;
    }
    wx.compressImage({
      src: filePath,
      quality: quality || 80,
      success(res) {
        resolve((res && res.tempFilePath) || filePath);
      },
      fail() {
        resolve(filePath);
      }
    });
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
  return typeof config.avatarMaxBytes === 'number' && config.avatarMaxBytes > 0
    ? config.avatarMaxBytes
    : DEFAULT_AVATAR_BYTES;
}

function tooLargeMessage(purpose) {
  if (purpose === 'AVATAR') {
    return '头像图片过大，请更换一张更小的图片';
  }
  return '截图文件过大，请重新选择或裁剪后上传';
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
  const maxBytes = purpose === 'AVATAR' ? avatarMaxBytes() : MAX_TICKET_BYTES;
  let filePath = sourcePath;
  let info = await getFileInfo(filePath);
  if (purpose === 'AVATAR' && info.size > maxBytes) {
    filePath = await compressImage(sourcePath, 75);
    info = await getFileInfo(filePath);
  }
  if (info.size > maxBytes) {
    throw new client.CallError('VALIDATION_FAILED', tooLargeMessage(purpose));
  }
  const fileId = await uploadFile(cloudPath, filePath);
  return {
    uploadTicketId,
    cloudPath,
    fileId,
    purpose,
    size: info.size,
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
