// utils/privacy.js · 隐私接口授权检查（唯一实现处；契约见 docs/registry/APIS.md §2 与 DESIGN §3）
// 为什么单独一层：wx.chooseMedia 属隐私接口——未在公众平台声明《用户隐私保护指引》、或用户未同意时
// **必然失败**（2026-09-15 真机实测报 `chooseMedia:fail api scope is not declared in the privacy agreement`）。
// 页面不能靠 try/catch 猜，必须在这里拿到明确结论，才能走"降级为手工输入"的分支（M6）。
//
// 2026-09-17 补充：**VisionKit 的 VKSession 也要过同一道隐私门禁**，而且它要的是**摄像头**类型。
// 真机实测：只声明相册时，`session.start` 直接返回 errno=112（= 接口未在隐私协议中声明，官方 errno 表）。
// 所以"声明一次管所有隐私接口"是错的——**每个隐私接口对应各自的隐私类型**（见 RCA 2026-09-17_visionkit-112）。
'use strict';

function allowed() {
  return { ok: true };
}

function denied(reason, detail) {
  return { ok: false, reason: reason, detail: detail };
}

// 两个门禁的判定逻辑完全一致，差别只在**被拒时用哪个码与文案**：
// 相册与摄像头是两个独立隐私类型，被拒后用户要做的事不同（去相册权限 vs 去摄像头声明/授权），
// 所以码必须分开——否则页面只能显示相册专用文案，把人引去错的地方（2026-09-17 审查 R-03）。
function ensureAccess(deniedReason, deniedHint) {
  return new Promise((resolve) => {
    // 旧基础库没有隐私 API：不在这里拦，交给真实接口自己报错（错误原文会被页面展示）
    if (typeof wx.getPrivacySetting !== 'function') {
      resolve(allowed());
      return;
    }
    wx.getPrivacySetting({
      success: (res) => {
        if (!res || !res.needAuthorization) {
          resolve(allowed());
          return;
        }
        if (typeof wx.requirePrivacyAuthorize !== 'function') {
          resolve(denied(deniedReason, '基础库无 requirePrivacyAuthorize'));
          return;
        }
        wx.requirePrivacyAuthorize({
          success: () => resolve(allowed()),
          fail: (err) => resolve(denied(deniedReason, (err && err.errMsg) || deniedHint))
        });
      },
      fail: (err) => resolve(denied(deniedReason, (err && err.errMsg) || '隐私设置读取失败'))
    });
  });
}

// 相册（wx.chooseMedia 选图）
function ensureMediaAccess() {
  return ensureAccess('PRIVACY_DENIED', '用户未同意隐私协议');
}

// 摄像头（VisionKit VKSession）——与相册是两个独立的隐私类型，必须分别过门禁
function ensureCameraAccess() {
  return ensureAccess('PRIVACY_DENIED_CAMERA', '用户未同意隐私协议（摄像头）');
}

module.exports = { ensureMediaAccess, ensureCameraAccess };
