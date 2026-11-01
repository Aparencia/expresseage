// components/image-picker/state.js · 选图组件的纯判定（零 wx；组件与自检共用单源）
// 口径：UX_CUSTOMER §3.7.1/§4.2/§9.2；TD-060（相册选图不再请求 scope.writePhotosAlbum，P1-8）；
//       P1-4：单图模式（maxCount=1）再选图 = 替换旧图（F4「换图静默无效」），多图模式按 D23 追加。
'use strict';

const DEFAULT_MAX = 5;
// P0-1（D44 同批）：上传并发上限 2——下单链路里「逐张串行上传」是性能热点（研究文档 §4.1）。
// 纯件给出并发计划，组件按计划分批跑；测试直接断言上限，不依赖真机时序。
const UPLOAD_CONCURRENCY = 2;

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

// ── P0-1/D44：选图元数据透传 + 上传并发计划（纯函数，零 wx）──────────────────────
/**
 * 选图接口返回项 → 统一元数据 {path,size,name,type}。
 * 聊天图（wx.chooseMessageFile）与相册/拍照（wx.chooseMedia）都自带真实 size/name/type；
 * 旧实现只取 path 把 size 丢掉，导致上传链路读到 size=0 被服务端误拒（D44 真 bug）。
 * 不存在/非法 size 归一为 0（表示"选图接口没给"，由上传链路按真实字节数兜底，不当成必拒）。
 */
function pickedFileOf(input) {
  if (typeof input === 'string') {
    return { path: String(input || ''), size: 0, name: '', type: '' };
  }
  const item = input || {};
  const path = typeof item.path === 'string' ? item.path
    : (typeof item.tempFilePath === 'string' ? item.tempFilePath : '');
  const size = Number(item.size);
  return {
    path: path,
    size: Number.isFinite(size) && size > 0 ? Math.floor(size) : 0,
    name: typeof item.name === 'string' ? item.name : '',
    type: typeof item.type === 'string' ? item.type : ''
  };
}

function pickedFilesOf(list) {
  return (Array.isArray(list) ? list : []).map(pickedFileOf).filter(function hasPath(item) {
    return !!item.path;
  });
}

/** 待上传文件：按路径去重（同一张图不重复上传），保留选图元数据 */
function newPickedOf(current, picked) {
  const list = pickedFilesOf(picked);
  const paths = newPathsOf(current, list.map(function path(item) { return item.path; }));
  return list.filter(function keep(item) {
    return paths.indexOf(item.path) >= 0;
  });
}

/**
 * 上传并发计划：总数 + 并发上限（默认 2）+ 分批下标。
 * 组件按 batches 逐批 Promise.all：一批最多 UPLOAD_CONCURRENCY 个并发，批内失败不丢已传文件。
 */
function uploadPlanOf(count, rawConcurrency) {
  const total = countOf(count);
  const capRaw = Number(rawConcurrency);
  const cap = Number.isFinite(capRaw) && capRaw > 0 ? Math.floor(capRaw) : UPLOAD_CONCURRENCY;
  const concurrency = Math.max(1, Math.min(cap, total || 1));
  const batches = [];
  for (let start = 0; start < total; start += concurrency) {
    const batch = [];
    const end = Math.min(start + concurrency, total);
    for (let index = start; index < end; index += 1) {
      batch.push(index);
    }
    batches.push(batch);
  }
  return { concurrency: concurrency, total: total, batches: batches };
}

/**
 * 组件事件里的文件快照：本地上传结果 + 选图元数据。
 * size 取上传链路读到的真实值（压缩后/读盘后），缺失回退选图接口值；name/type 原样透传，
 * 供页面与识别链路使用（聊天图 size/name/type 丢失是本轮修复的根因）。
 */
function fileSnapshotOf(meta, uploaded) {
  const picked = pickedFileOf(meta);
  const result = uploaded || {};
  const size = Number(result.size);
  return Object.assign({ localPath: picked.path }, result, {
    size: Number.isFinite(size) && size > 0 ? Math.floor(size) : picked.size,
    name: picked.name,
    type: picked.type
  });
}

module.exports = {
  DEFAULT_MAX,
  UPLOAD_CONCURRENCY,
  DENIED_COPY,
  maxCountOf,
  remainingOf,
  singleModeOf,
  pickGateOf,
  pickCountOf,
  mergeFiles,
  newPathsOf,
  newPickedOf,
  pickedFileOf,
  pickedFilesOf,
  uploadPlanOf,
  fileSnapshotOf,
  isCancelOf,
  deniedCopyOf
};
