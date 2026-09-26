// pages/archive-list/swipe.js · 左滑手势的**纯判据**（页面专用零件）
//
// 为什么住零件里：`selftest` 不 require 页面（TD-016 已吃过两次亏：页面层分支可以整块失效而门禁全绿）
// ⇒ 阈值与方向判定这些"错了就会误删/误开"的东西，必须搬进能被断言的纯函数。
//
// 为什么不用原生 swipe-action：小程序没有这个组件（用户裁决③的语义只能自己实现）⇒ 触摸事件 + CSS transform。
// 判据口径（三个数都是"手指位移"，单位同 `event.touches[0].pageX/pageY`）：
//   · 横向位移取 `dx = 当前 X - 起始 X`（左滑为负）；纵向取 `dy`。
//   · 只认"横向意图"：|dx| 必须过阈值，且 |dx| 明显大于 |dy| —— 否则在长列表里竖着滑会把删除划出来。
'use strict';

// 打开阈值：48 与 CSS 里露出的删除按钮宽度同量级（太小会被手指抖动误开；太大滑不出来）
const OPEN_PX = 48;
// 关闭阈值：比打开阈值**小**（已经开着的行，轻轻回划就该关上 —— 关是安全方向，开是危险方向）
const CLOSE_PX = 24;
// 纵向容差：|dy| 超过它就判"这是竖向滚动"，一律不处理横向（宁可滑不动，不可误删）
const VERTICAL_SLOP_PX = 24;
// 已经开着的行再往左滑：不叠加（一次只开一行，避免露出半个按钮这种半吊子状态）
const MAX_OPEN_PX = -160;

/**
 * 判一次触摸该不该开/关某一行的删除。
 * @param {{dx:number, dy:number, opened:boolean}} input `opened` = 这一行当前是不是已经开着
 * @returns {{action:'none'|'open'|'close'}} 纯判据：不返回任何位移量（位移由 CSS 给，避免两处各算一份）
 */
function decideSwipe(input) {
  const dx = (input && typeof input.dx === 'number') ? input.dx : 0;
  const dy = (input && typeof input.dy === 'number') ? input.dy : 0;
  const opened = !!(input && input.opened);
  // 竖向意图优先：滚列表的时候不要开删除（这是本判据存在的主要理由）
  if (Math.abs(dy) > VERTICAL_SLOP_PX && Math.abs(dy) >= Math.abs(dx)) return { action: 'none' };
  if (!opened) {
    if (dx <= -OPEN_PX && Math.abs(dx) > Math.abs(dy)) return { action: 'open' };
    return { action: 'none' };
  }
  if (dx >= CLOSE_PX) return { action: 'close' };
  // 已经开着：继续左滑不做任何事（保持开着），也**不**把它当成"再确认一次"
  return { action: 'none' };
}

/**
 * 一次只开一行：这一行开着的时候，别的行关掉。
 * @param {string} id 本次触摸的行
 * @param {string} openedId 当前开着的行（空串 = 没有）
 * @returns {{openId:string}} 新的"开着的行"（点同一行两次 = 保持；点另一行 = 换过去）
 */
function nextOpenId(id, openedId) {
  return { openId: typeof id === 'string' ? id : String(id || '') };
}

/** 按钮露出的位移（CSS 用 `translateX({{...}}px)`）；只在开着时给负值，且夹在 `MAX_OPEN_PX` 上 */
function offsetFor(opened) {
  return opened ? MAX_OPEN_PX : 0;
}

module.exports = { decideSwipe, nextOpenId, offsetFor, OPEN_PX, CLOSE_PX, VERTICAL_SLOP_PX, MAX_OPEN_PX };
