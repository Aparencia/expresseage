// components/image-picker/state.js · 选图组件的纯判定（零 wx；组件与自检共用单源）
// 口径：UX_CUSTOMER §3.7.1/§4.2/§9.2；TD-060（相册选图不再请求 scope.writePhotosAlbum，P1-8）；
//       P1-4：单图模式（maxCount=1）再选图 = 替换旧图（F4「换图静默无效」），多图模式按 D23 追加。
'use strict';

const DEFAULT_MAX = 5;

// 选图被拒/失败的替代路径文案（UX §9.2：拒绝后改用其他来源或「不传截图，手动填写」，不阻断下单）
const DENIED_COPY = {
  album: '没能打开相册：可以用「拍照」或「从聊天选择」，也可以不传截图手动填写。',
  camera: '没有相机权限：可以用「从相册选择」或「从聊天选择」，也可以不传截图手动填写。',
  chat: '没能选择聊天里的图片：可以用「从相册选择」或「拍照」，也可以不传截图手动填写。'
};

function maxCountOf(raw) {
  const value = Number(raw);
  return value > 0 ? Math.floor(value) : DEFAULT_MAX;
}

function countOf(raw) {
  const value = Number(raw);
  return value > 0 ? Math.floor(value) : 0;
}

function remainingOf(count, rawMax) {
  return Math.max(0, maxCountOf(rawMax) - countOf(count));
}

function singleModeOf(rawMax) {
  return maxCountOf(rawMax) === 1;
}

/** 是否允许再次选图：单图模式满额也允许（再选=替换，F4）；多图模式满额拦（组件给上限文案） */
function pickGateOf(input) {
  const value = input || {};
  const max = maxCountOf(value.maxCount);
  if (value.disabled === true || value.uploading === true) {
    return { ok: false, limit: false, maxCount: max };
  }
  if (max === 1 || countOf(value.count) < max) {
    return { ok: true, limit: false, maxCount: max };
  }
  return { ok: false, limit: true, maxCount: max };
}

/** 一次可选张数：单图模式固定 1（替换）；多图模式为剩余名额（至少 1，满额由 pickGateOf 先拦） */
function pickCountOf(count, rawMax) {
  const max = maxCountOf(rawMax);
  return max === 1 ? 1 : Math.max(1, remainingOf(count, max));
}

/** 选图成功后的文件集合：单图模式新图替换旧图（P1-4/F4）；多图模式追加并截到上限（D23） */
function mergeFiles(current, uploaded, rawMax) {
  const max = maxCountOf(rawMax);
  const base = max === 1 ? [] : (Array.isArray(current) ? current : []);
  return base.concat(Array.isArray(uploaded) ? uploaded : []).slice(0, max);
}

/** 去重：已在列表中的临时路径不再重复上传（同一张图重试不重复扣票；换图才上传新图） */
function newPathsOf(current, picked) {
  const seen = {};
  (Array.isArray(current) ? current : []).forEach(function each(file) {
    const key = String((file && file.localPath) || '');
    if (key) seen[key] = true;
  });
  return (Array.isArray(picked) ? picked : []).map(function text(path) {
    return String(path || '');
  }).filter(function keep(path) {
    if (!path || seen[path]) return false;
    seen[path] = true;
    return true;
  });
}

/** 用户取消不算错误（UX §3.7.1「均用户主动点击后触发；取消不报错」） */
function isCancelOf(err) {
  const message = String((err && (err.errMsg || err.message)) || '');
  return /cancel/i.test(message);
}

function deniedCopyOf(sourceType) {
  return DENIED_COPY[sourceType] || DENIED_COPY.album;
}

module.exports = {
  DEFAULT_MAX,
  DENIED_COPY,
  maxCountOf,
  remainingOf,
  singleModeOf,
  pickGateOf,
  pickCountOf,
  mergeFiles,
  newPathsOf,
  isCancelOf,
  deniedCopyOf
};
