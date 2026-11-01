// pkg-customer/pages/pickup-list/parts/local-view.js · 「我的取件码（本机）」纯视图映射（零 wx）
// D57：本机清单只存顾客本人设备（唯一写口 utils/storage.js 的 pickcodes 键），
// 不上传/不进服务端/兼职与后台不可见。本件只做 行/汇总/上限提示 的纯映射；
// 文案常量由页面 setData 注入 wxml（本文件不硬编码重复副本，门禁 #35 只留生产消费的导出）。
'use strict';

// 固定说明（页面顶部原句；换机/清缓存会丢失是产品口径，不软化）
const TIP_TEXT = '只存在这台手机：不上传、兼职看不到；换手机或清缓存会丢失。';
// READONLY（开发者只读视角）会话：不渲染本机区，只给解释；任何写动作拒绝并给人话
const READONLY_HINT = '本机清单只在你本人手机上，只读视角看不到。';
const READONLY_COPY = '开发者只读视角不能操作';
const EMPTY_TEXT = '还没有本机取件码。点「识别截图」或「手动粘贴」，只记在这台手机上。';
const NO_MATCH_TEXT = '没认出取件码：每行一个码（4~40 位字母数字），也可以先只存码。';
const STATION_FALLBACK = '未识别站点';

function stationTextOf(stationName) {
  const name = String(stationName || '').trim();
  return name || STATION_FALLBACK;
}

/** 添加时间人话：刚刚 / N 分钟前 / N 小时前 / M月D日（now 由调用方给，纯函数可测） */
function timeTextOf(addedAt, now) {
  const at = Number(addedAt);
  if (!isFinite(at) || at <= 0) return '';
  const current = Number(now) || Date.now();
  const diff = Math.max(0, current - at);
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return Math.floor(diff / (60 * 1000)) + ' 分钟前';
  if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / (60 * 60 * 1000)) + ' 小时前';
  const date = new Date(at);
  return (date.getMonth() + 1) + '月' + date.getDate() + '日';
}

function checkedTextOf(checked) {
  return checked === true ? '已取到' : '未取到';
}

/** 存储条目 → 行视图（码/站点名兜底/勾选/添加时间；时间取 now 便于确定性断言） */
function rowsOf(items, now) {
  const list = Array.isArray(items) ? items : [];
  return list.map(function one(item) {
    const code = String((item && item.code) || '').trim();
    const checked = !!(item && item.checked === true);
    return {
      code: code,
      stationText: stationTextOf(item && item.stationName),
      checked: checked,
      checkedText: checkedTextOf(checked),
      timeText: timeTextOf(item && item.addedAt, now)
    };
  });
}

function summaryOf(items) {
  const list = Array.isArray(items) ? items : [];
  const checked = list.filter(function done(item) { return !!item && item.checked === true; }).length;
  return { total: list.length, checked: checked, pending: list.length - checked };
}

/**
 * 添加结果 → 超上限人话（D57：上限 50，超了丢最旧）。
 * 入参：result = storage.addLocalCodes 的 {ok,added,skipped,items}；
 *   before = 添加前条数；requested = 本次提交条数（parse+merge 后）；max = 上限（storage.LOCAL_CODE_MAX）。
 * 未到上限返回 ''；到上限且本次真有条被挤掉时说明丢了几条（最多 50 是硬上限，不谎报"全部存下"）。
 * dropped = before + requested − skipped（重复已跳过）− 现存量。
 */
function limitHintOf(result, before, requested, max) {
  if (!result || result.ok !== true) return '';
  const cap = Math.max(1, Number(max) || 50);
  const items = Array.isArray(result.items) ? result.items : [];
  if (items.length < cap) return '';
  const skipped = Math.max(0, Number(result.skipped) || 0);
  const want = Math.max(0, Number(requested) || 0);
  const dropped = Math.max(0, (Number(before) || 0) + want - skipped - items.length);
  if (dropped > 0) return '本机最多存 ' + cap + ' 条：超出 ' + dropped + ' 条，最早的已自动清掉。';
  return '本机最多存 ' + cap + ' 条，新加的会顶掉最早的。';
}

/** 添加结果 → 结果提示（有站点补全/重复跳过时不说"已添加"骗人） */
function addedTipOf(result) {
  if (!result || result.ok !== true) return '保存到本机失败，请重试';
  const added = Number(result.added) || 0;
  const skipped = Number(result.skipped) || 0;
  if (added > 0 && skipped > 0) return '已添加 ' + added + ' 条（' + skipped + ' 条重复已跳过）';
  if (added > 0) return '已添加 ' + added + ' 条';
  if (skipped > 0) return '这些码已经在清单里了';
  return '没有新的取件码';
}

// 只导出生产调用（页面 setData/直接调用）与测试经本件消费的映射函数；
// stationTextOf/timeTextOf/checkedTextOf/STATION_FALLBACK 是 rowsOf 内部实现，不外泄（#35）。
module.exports = {
  TIP_TEXT,
  READONLY_HINT,
  READONLY_COPY,
  EMPTY_TEXT,
  NO_MATCH_TEXT,
  rowsOf,
  summaryOf,
  limitHintOf,
  addedTipOf
};
