// utils/avatar.js · 头像纯件（压缩计划 / 大小与类型校验 / 默认头像策略）
// 口径：CONTRACT §4.2/O5、ENGINEERING §4.12（头像只走 upload.prepare({purpose:'AVATAR'})，
// ≤config.avatarMaxBytes、jpg/png、建议 200×200；默认头像 = 昵称首字色块，不占存储）。
// 设计：平台能力（getImageInfo/compressImage/getFileSystemManager）由调用方注入，零全局依赖、可直测；
// 本文件不签发上传路径、不调 wx.cloud、不落任何本地存储。
'use strict';

const DEFAULT_MAX_BYTES = 200 * 1024;
const MIN_MAX_BYTES = 100 * 1024;
const MAX_MAX_BYTES = 500 * 1024;
const TARGET_SIDE = 200;
const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png'];
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png'];
const QUALITY_STEPS = [85, 75, 65];
const SIZE_RPX = { LIST: 64, DETAIL: 96 };
const FALLBACK_INITIAL = '?';
const PALETTE = [
  { backgroundColor: '#E8F0FF', color: '#2F5D9E' },
  { backgroundColor: '#FFF1E6', color: '#9A5B2D' },
  { backgroundColor: '#E9F7EF', color: '#2D6A4F' },
  { backgroundColor: '#F3E8FF', color: '#6B3FA0' },
  { backgroundColor: '#FFF7DB', color: '#8A6D1D' },
  { backgroundColor: '#E6F6FA', color: '#1F6F7E' },
  { backgroundColor: '#FDE8EC', color: '#9E3448' },
  { backgroundColor: '#EEF0F4', color: '#4A5568' }
];

function clamp(value, min, max) {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

// 客户端压缩目标：取 config.getPublic.avatarMaxBytes；缺失/非法回默认值，越界按平台范围收敛。
function resolveMaxBytes(value) {
  if (typeof value !== 'number' || !isFinite(value) || value <= 0) {
    return DEFAULT_MAX_BYTES;
  }
  return clamp(Math.floor(value), MIN_MAX_BYTES, MAX_MAX_BYTES);
}

function extensionOf(nameOrPath) {
  if (typeof nameOrPath !== 'string' || !nameOrPath) {
    return '';
  }
  const clean = nameOrPath.split('?')[0].split('#')[0];
  const dot = clean.lastIndexOf('.');
  if (dot < 0 || dot === clean.length - 1) {
    return '';
  }
  return clean.slice(dot + 1).toLowerCase();
}

function normalizeMime(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function validatePicked(file, maxBytes) {
  const picked = file || {};
  const max = resolveMaxBytes(maxBytes);
  const size = typeof picked.size === 'number' && isFinite(picked.size) ? Math.floor(picked.size) : 0;
  const extension = extensionOf(picked.path || picked.name);
  const mime = normalizeMime(picked.type);
  const result = { ok: false, reason: '', size: size, maxBytes: max, extension: extension };
  if (!size || size <= 0) {
    result.reason = 'EMPTY';
    return result;
  }
  if (mime) {
    if (ALLOWED_MIME_TYPES.indexOf(mime) < 0) {
      result.reason = 'TYPE';
      return result;
    }
  } else if (ALLOWED_EXTENSIONS.indexOf(extension) < 0) {
    result.reason = 'TYPE';
    return result;
  }
  if (extension && ALLOWED_EXTENSIONS.indexOf(extension) < 0) {
    result.reason = 'TYPE';
    return result;
  }
  if (size > max) {
    result.reason = 'SIZE';
    return result;
  }
  result.ok = true;
  return result;
}

function normalizeImageInfo(info) {
  const raw = info || {};
  const width = typeof raw.width === 'number' && isFinite(raw.width) && raw.width > 0 ? Math.round(raw.width) : 0;
  const height = typeof raw.height === 'number' && isFinite(raw.height) && raw.height > 0 ? Math.round(raw.height) : 0;
  const size = typeof raw.size === 'number' && isFinite(raw.size) && raw.size > 0 ? Math.floor(raw.size) : 0;
  if (!width || !height) {
    return { ok: false, width: 0, height: 0, size: size };
  }
  return { ok: true, width: width, height: height, size: size };
}

// 压缩计划：先看是否需要压缩（超上限才压），再给出目标边长与质量阶梯。
function planCompression(info, maxBytes) {
  const max = resolveMaxBytes(maxBytes);
  const normalized = normalizeImageInfo(info);
  if (!normalized.ok) {
    return { required: false, reason: 'UNREADABLE', maxBytes: max, qualities: [] };
  }
  const longSide = Math.max(normalized.width, normalized.height);
  const scale = longSide > TARGET_SIDE ? TARGET_SIDE / longSide : 1;
  const targetWidth = Math.max(1, Math.round(normalized.width * scale));
  const targetHeight = Math.max(1, Math.round(normalized.height * scale));
  return {
    required: normalized.size > max,
    reason: 'OK',
    maxBytes: max,
    size: normalized.size,
    width: normalized.width,
    height: normalized.height,
    targetWidth: targetWidth,
    targetHeight: targetHeight,
    qualities: QUALITY_STEPS.slice()
  };
}

function defaultPlatform() {
  return typeof wx !== 'undefined' ? wx : null;
}

function invoke(platform, method, options) {
  return new Promise(function (resolve) {
    if (!platform || typeof platform[method] !== 'function') {
      resolve(null);
      return;
    }
    try {
      platform[method](
        Object.assign({}, options, {
          success: function (res) {
            resolve(res || {});
          },
          fail: function () {
            resolve(null);
          }
        })
      );
    } catch (err) {
      resolve(null);
    }
  });
}

function fileSizeOf(platform, filePath) {
  return new Promise(function (resolve) {
    let manager = null;
    try {
      manager = platform && typeof platform.getFileSystemManager === 'function' ? platform.getFileSystemManager() : null;
    } catch (err) {
      manager = null;
    }
    if (!manager || typeof manager.getFileInfo !== 'function') {
      resolve(0);
      return;
    }
    try {
      manager.getFileInfo({
        filePath: filePath,
        success: function (res) {
          resolve(res && typeof res.size === 'number' ? Math.floor(res.size) : 0);
        },
        fail: function () {
          resolve(0);
        }
      });
    } catch (err) {
      resolve(0);
    }
  });
}

// 压缩到上限内：返回结果对象而非抛错，调用方按 reason 决定"用默认头像 / 提示重试"。
function compressAvatar(options) {
  const opts = options || {};
  const platform = opts.platform || defaultPlatform();
  const maxBytes = resolveMaxBytes(opts.maxBytes);
  const filePath = opts.filePath;
  if (!filePath) {
    return Promise.resolve({ ok: false, reason: 'EMPTY', maxBytes: maxBytes });
  }
  if (!platform || typeof platform.compressImage !== 'function') {
    return Promise.resolve({ ok: false, reason: 'UNSUPPORTED', maxBytes: maxBytes });
  }
  return invoke(platform, 'getImageInfo', { src: filePath }).then(function (info) {
    return normalizeImageInfo(info);
  }).then(function (info) {
    if (!info.ok) {
      return { ok: false, reason: 'UNREADABLE', maxBytes: maxBytes };
    }
    const sizePromise = info.size ? Promise.resolve(info.size) : fileSizeOf(platform, filePath);
    return sizePromise.then(function (size) {
      const plan = planCompression({ width: info.width, height: info.height, size: size }, maxBytes);
      if (!plan.required) {
        return {
          ok: true,
          tempFilePath: filePath,
          width: info.width,
          height: info.height,
          size: size,
          attempts: 0,
          maxBytes: maxBytes
        };
      }
      let index = 0;
      let lastSize = size;
      function next() {
        if (index >= plan.qualities.length) {
          return {
            ok: false,
            reason: 'TOO_LARGE',
            size: lastSize,
            attempts: index,
            maxBytes: maxBytes,
            plan: plan
          };
        }
        const quality = plan.qualities[index];
        index += 1;
        return invoke(platform, 'compressImage', { src: filePath, quality: quality }).then(function (out) {
          const tempFilePath = out && out.tempFilePath ? out.tempFilePath : '';
          if (!tempFilePath) {
            return next();
          }
          return fileSizeOf(platform, tempFilePath).then(function (nextSize) {
            if (!nextSize) {
              return { ok: false, reason: 'UNVERIFIED', attempts: index, maxBytes: maxBytes };
            }
            lastSize = nextSize;
            if (nextSize <= maxBytes) {
              return {
                ok: true,
                tempFilePath: tempFilePath,
                width: plan.targetWidth,
                height: plan.targetHeight,
                size: nextSize,
                attempts: index,
                maxBytes: maxBytes
              };
            }
            return next();
          });
        });
      }
      return next();
    });
  });
}

// ── 截图（TICKET）上传压缩（P0-10，与头像共用纯件工具，不改变头像既有行为）────────────────
// 口径：长边 ≤1440、质量阶梯 3 档、≤3 次仍超上限才拒绝（拒绝文案由 api/upload 说真话）。
const TICKET_TARGET_SIDE = 1440;
const TICKET_QUALITY_STEPS = [85, 65, 45];

/**
 * 截图压缩计划（纯函数）：超上限才压；长边超 1440 先缩放，否则只降质量。
 * @param {{width:number,height:number,size:number}} info
 * @param {number} maxBytes 服务端 500KB 上限
 */
function planTicketCompression(info, maxBytes) {
  const max = resolveMaxBytes(maxBytes);
  const normalized = normalizeImageInfo(info);
  if (!normalized.ok) {
    return { required: false, reason: 'UNREADABLE', maxBytes: max, qualities: [], needResize: false };
  }
  const longSide = Math.max(normalized.width, normalized.height);
  const scale = longSide > TICKET_TARGET_SIDE ? TICKET_TARGET_SIDE / longSide : 1;
  return {
    required: normalized.size > max,
    reason: 'OK',
    maxBytes: max,
    size: normalized.size,
    width: normalized.width,
    height: normalized.height,
    longSide: longSide,
    needResize: scale < 1,
    targetLongSide: TICKET_TARGET_SIDE,
    targetWidth: Math.max(1, Math.round(normalized.width * scale)),
    targetHeight: Math.max(1, Math.round(normalized.height * scale)),
    qualities: TICKET_QUALITY_STEPS.slice()
  };
}

// 画布降采样（平台能力经 platform 注入；失败返回 null，由质量阶梯兜底）——真机能力见 QA 点检
function downscaleImage(platform, filePath, targetLongSide, quality) {
  return invoke(platform, 'getImageInfo', { src: filePath }).then(function (raw) {
    const info = normalizeImageInfo(raw);
    if (!info.ok) return null;
    const longSide = Math.max(info.width, info.height);
    if (longSide <= targetLongSide) return null;
    if (!platform || typeof platform.createOffscreenCanvas !== 'function') return null;
    const scale = targetLongSide / longSide;
    const width = Math.max(1, Math.round(info.width * scale));
    const height = Math.max(1, Math.round(info.height * scale));
    let canvas = null;
    try {
      canvas = platform.createOffscreenCanvas({ type: '2d', width: width, height: height });
    } catch (err) {
      return null;
    }
    const ctx = canvas && typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    const image = canvas && typeof canvas.createImage === 'function' ? canvas.createImage() : null;
    if (!ctx || !image) return null;
    return new Promise(function executor(resolve) {
      image.onload = function onload() {
        try {
          ctx.drawImage(image, 0, 0, width, height);
          if (typeof platform.canvasToTempFilePath !== 'function') {
            resolve(null);
            return;
          }
          platform.canvasToTempFilePath({
            canvas: canvas,
            x: 0,
            y: 0,
            width: width,
            height: height,
            destWidth: width,
            destHeight: height,
            fileType: 'jpg',
            quality: quality,
            success: function ok(res) {
              resolve(res && res.tempFilePath ? res.tempFilePath : null);
            },
            fail: function fail() {
              resolve(null);
            }
          });
        } catch (err) {
          resolve(null);
        }
      };
      image.onerror = function onerror() {
        resolve(null);
      };
      image.src = filePath;
    });
  });
}

/**
 * 截图压缩执行：≤3 次阶梯（缩放/质量），压到上限内返回 ok；全失败返回 TOO_LARGE（不虚构成功）。
 * @returns {Promise<{ok:boolean,reason?:string,tempFilePath?:string,size?:number,attempts?:number,plan?:object}>}
 */
function compressTicket(options) {
  const opts = options || {};
  const platform = opts.platform || defaultPlatform();
  const maxBytes = resolveMaxBytes(opts.maxBytes);
  const filePath = opts.filePath;
  if (!filePath) {
    return Promise.resolve({ ok: false, reason: 'EMPTY', maxBytes: maxBytes });
  }
  if (!platform || (typeof platform.compressImage !== 'function' && typeof platform.createOffscreenCanvas !== 'function')) {
    return Promise.resolve({ ok: false, reason: 'UNSUPPORTED', maxBytes: maxBytes });
  }
  return invoke(platform, 'getImageInfo', { src: filePath }).then(function (raw) {
    return normalizeImageInfo(raw);
  }).then(function (info) {
    if (!info.ok) {
      return { ok: false, reason: 'UNREADABLE', maxBytes: maxBytes };
    }
    const sizePromise = info.size ? Promise.resolve(info.size) : fileSizeOf(platform, filePath);
    return sizePromise.then(function (size) {
      const plan = planTicketCompression({ width: info.width, height: info.height, size: size }, maxBytes);
      if (!plan.required) {
        return { ok: true, tempFilePath: filePath, width: info.width, height: info.height, size: size, attempts: 0, maxBytes: maxBytes };
      }
      let index = 0;
      let lastSize = size;
      function next() {
        if (index >= plan.qualities.length) {
          return { ok: false, reason: 'TOO_LARGE', size: lastSize, attempts: index, maxBytes: maxBytes, plan: plan };
        }
        const quality = plan.qualities[index];
        index += 1;
        const attempt = plan.needResize
          ? downscaleImage(platform, filePath, plan.targetLongSide, quality)
          : invoke(platform, 'compressImage', { src: filePath, quality: quality })
            .then(function (out) { return out && out.tempFilePath ? out.tempFilePath : ''; });
        return attempt.then(function (tempFilePath) {
          if (!tempFilePath) {
            return next();
          }
          return fileSizeOf(platform, tempFilePath).then(function (nextSize) {
            if (!nextSize) {
              return { ok: false, reason: 'UNVERIFIED', attempts: index, maxBytes: maxBytes };
            }
            lastSize = nextSize;
            if (nextSize <= maxBytes) {
              return {
                ok: true,
                tempFilePath: tempFilePath,
                width: plan.targetWidth,
                height: plan.targetHeight,
                size: nextSize,
                attempts: index,
                maxBytes: maxBytes
              };
            }
            return next();
          });
        });
      }
      return next();
    });
  });
}

// 默认头像：昵称首字 + 稳定色块（同一昵称每次同色，换账号不共享文件）。
function initialOf(displayName) {
  const text = typeof displayName === 'string' ? displayName.trim() : '';
  if (!text) {
    return FALLBACK_INITIAL;
  }
  const chars = Array.from(text);
  const first = chars.length ? chars[0] : FALLBACK_INITIAL;
  return /[a-z]/i.test(first) ? first.toUpperCase() : first;
}

function colorIndexOf(text) {
  let sum = 0;
  const value = typeof text === 'string' ? text : '';
  for (let i = 0; i < value.length; i += 1) {
    sum += value.charCodeAt(i);
  }
  return sum % PALETTE.length;
}

function defaultAvatarOf(displayName) {
  const palette = PALETTE[colorIndexOf(displayName)];
  return {
    initial: initialOf(displayName),
    backgroundColor: palette.backgroundColor,
    color: palette.color
  };
}

function isDefaultAvatar(fileId) {
  return !(typeof fileId === 'string' && fileId.trim());
}

// avatar-view 组件的视图模型：无 fileID / 加载失败一律走默认头像，不裂图。
function viewModelOf(fileId, displayName) {
  const fallback = defaultAvatarOf(displayName);
  return {
    fileId: isDefaultAvatar(fileId) ? '' : fileId,
    isDefault: isDefaultAvatar(fileId),
    initial: fallback.initial,
    backgroundColor: fallback.backgroundColor,
    color: fallback.color
  };
}

module.exports = {
  DEFAULT_MAX_BYTES,
  MIN_MAX_BYTES,
  MAX_MAX_BYTES,
  TARGET_SIDE,
  TICKET_TARGET_SIDE,
  TICKET_QUALITY_STEPS,
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  QUALITY_STEPS,
  SIZE_RPX,
  resolveMaxBytes,
  extensionOf,
  validatePicked,
  normalizeImageInfo,
  planCompression,
  planTicketCompression,
  compressAvatar,
  compressTicket,
  initialOf,
  defaultAvatarOf,
  isDefaultAvatar,
  viewModelOf
};
