// utils/proof-photo.js · D97/D98 履约现场照片的唯一采集入口（拍照/相册 → 压缩上传 PROOF 票据）
// 口径：CONTRACT §4.1 第 8 条 / §5.1；页面不直接调 wx.chooseMedia（保证「一次操作 = 一张图」）。
// 返回 {ticket, fileId}；用户取消返回 null（调用方不得继续提交）；失败抛 CallError（message 可直接上屏）。
'use strict';

const upload = require('../api/upload');

function platformNow() {
  return typeof wx !== 'undefined' ? wx : null;
}

// 选一张（相机/相册由系统选择器提供）；取消/拒绝一律 null，不当作失败弹错。
function chooseOne() {
  return new Promise((resolve) => {
    const platform = platformNow();
    if (!platform || typeof platform.chooseMedia !== 'function') {
      resolve(null);
      return;
    }
    try {
      platform.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['camera', 'album'],
        success(res) {
          const file = res && Array.isArray(res.tempFiles) ? res.tempFiles[0] : null;
          if (!file || !file.tempFilePath) {
            resolve(null);
            return;
          }
          resolve({ path: file.tempFilePath, size: typeof file.size === 'number' ? file.size : 0 });
        },
        fail() {
          resolve(null);
        }
      });
    } catch (err) {
      resolve(null);
    }
  });
}

/**
 * 采集一张现场照片并上传。
 * @returns {Promise<null|{ticket:string,fileId:string,size:number}>}
 */
async function capture() {
  const file = await chooseOne();
  if (!file) {
    return null;
  }
  const uploaded = await upload.prepareAndUpload({
    purpose: 'PROOF',
    filePath: file.path,
    size: file.size
  });
  return {
    ticket: uploaded.uploadTicketId,
    fileId: uploaded.fileId,
    size: uploaded.size
  };
}

// D98：取件照片可跳过——先让用户二选一（拍照 / 跳过照片）；取消返回 null（中止动作）。
function chooseMode() {
  return new Promise((resolve) => {
    const platform = platformNow();
    if (!platform || typeof platform.showActionSheet !== 'function') {
      resolve('skip');
      return;
    }
    try {
      platform.showActionSheet({
        itemList: ['拍照 / 从相册选', '跳过照片'],
        success(res) {
          const index = res && typeof res.tapIndex === 'number' ? res.tapIndex : 1;
          resolve(index === 0 ? 'photo' : 'skip');
        },
        fail() {
          resolve(null);
        }
      });
    } catch (err) {
      resolve(null);
    }
  });
}

/**
 * 取件可选照片：null=用户取消动作；{skipped:true}=跳过；{skipped:false,photo}=带图。
 * @returns {Promise<null|{skipped:boolean,photo?:object}>}
 */
async function captureOptional() {
  const mode = await chooseMode();
  if (!mode) {
    return null;
  }
  if (mode === 'skip') {
    return { skipped: true };
  }
  const shot = await capture();
  if (!shot) {
    return null;
  }
  return { skipped: false, photo: shot };
}

module.exports = { capture, captureOptional, chooseOne, chooseMode };
