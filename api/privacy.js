// api/privacy.js · 隐私授权与头像/昵称能力封装（拒绝不阻断主流程）
const configModule = require('./modules/config');

const CAMERA_SCOPE = 'scope.camera';
const ALBUM_SCOPE = 'scope.writePhotosAlbum';

function getSetting() {
  return new Promise((resolve) => {
    wx.getSetting({
      success(res) {
        resolve((res && res.authSetting) || {});
      },
      fail() {
        resolve({});
      }
    });
  });
}

function authorize(scope) {
  return new Promise((resolve) => {
    wx.authorize({
      scope,
      success() {
        resolve(true);
      },
      fail() {
        resolve(false);
      }
    });
  });
}

async function ensureScope(scope) {
  const setting = await getSetting();
  if (setting[scope]) {
    return true;
  }
  if (setting[scope] === false) {
    return false;
  }
  return authorize(scope);
}

function ensureCameraAuth() {
  return ensureScope(CAMERA_SCOPE);
}

function ensureAlbumAuth() {
  return ensureScope(ALBUM_SCOPE);
}

function openSetting() {
  return new Promise((resolve) => {
    wx.openSetting({
      success(res) {
        resolve((res && res.authSetting) || {});
      },
      fail() {
        resolve({});
      }
    });
  });
}

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

function checkPrivacySetting() {
  return new Promise((resolve) => {
    if (typeof wx.getPrivacySetting !== 'function') {
      resolve({ needAuthorization: false, privacyContractName: '' });
      return;
    }
    wx.getPrivacySetting({
      success(res) {
        resolve(res || { needAuthorization: false, privacyContractName: '' });
      },
      fail() {
        resolve({ needAuthorization: false, privacyContractName: '' });
      }
    });
  });
}

function getPrivacyVersion() {
  const config = configModule.getCachedPublic();
  return (config && config.privacyVersion) || '';
}

module.exports = {
  CAMERA_SCOPE,
  ALBUM_SCOPE,
  ensureCameraAuth,
  ensureAlbumAuth,
  ensureScope,
  openSetting,
  openPrivacyContract,
  checkPrivacySetting,
  getPrivacyVersion
};
