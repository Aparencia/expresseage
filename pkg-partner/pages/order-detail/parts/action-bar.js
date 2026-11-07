// pkg-partner/pages/order-detail/parts/action-bar.js · 底部动作条分组（纯件：零 wx / 零请求 / 零状态机）
// 口径：docs/ux/V4_UX_PARTNER.md §3.3「底部操作条（随状态变）」+ §0 原则「主操作固定底部、危险动作与主操作拉开距离」。
// 边界：可见性仍 100% 由服务端 order.actions[] 决定——本件**只分组、不增删动作、不改文案**；
//       actions[] 原样保留在页面 data 供 onActionTap/findAction 使用。
// 布局：主操作（推进状态的那一个）独占最底行实心按钮；其余（异常/改码/留言 + 取消/拒单）在上一行小号次按钮；
//       危险动作排在次按钮行末尾（与主操作上下分离，避免误点）；件级取件按钮在件卡内，不在此列。
const PRIMARY_PRIORITY = ['deliver', 'pick', 'accept', 'resolve'];
const SECONDARY_KEYS = ['exception', 'correct', 'message'];
const DANGER_KEYS = ['cancel', 'reject'];
// 撤销动作已由 parts/undo 的 5 秒撤销条承载（唯一入口）；再进动作条会重复渲染同一动作。
const UNDO_KEYS = ['undoPick', 'undoDeliver'];

function keyOf(action) {
  return action && typeof action.key === 'string' ? action.key : '';
}

function firstOf(list, key) {
  return list.filter((item) => keyOf(item) === key)[0] || null;
}

// actions[] → { primary, secondary, visible }
//   primary   = 主操作（按 送达 > 取件 > 接单 > 解除异常 的推进优先级取第一个存在的）
//   secondary = 次操作（异常/改码/留言，保持服务端相对顺序）+ 未知动作兜底 + 危险动作（排最后）
//   visible   = 动作条是否出现（全空则不渲染，避免空白条压住页面）
function planOf(actions) {
  const list = (Array.isArray(actions) ? actions : []).filter((item) => item && keyOf(item));
  const usable = list.filter((item) => UNDO_KEYS.indexOf(keyOf(item)) < 0);
  const primary = PRIMARY_PRIORITY
    .map((key) => firstOf(usable, key))
    .filter((item) => item !== null)[0] || null;
  const rest = usable.filter((item) => item !== primary);
  const secondary = rest.filter((item) => SECONDARY_KEYS.indexOf(keyOf(item)) >= 0);
  const danger = rest.filter((item) => DANGER_KEYS.indexOf(keyOf(item)) >= 0);
  // 未登记 key：不猜行为、不丢动作——按「次操作」兜底渲染（服务端仍会二次校验）
  const others = rest.filter((item) => secondary.indexOf(item) < 0 && danger.indexOf(item) < 0);
  const secondRow = secondary.concat(others).concat(danger);
  return {
    primary: primary,
    secondary: secondRow,
    visible: secondRow.length > 0 || primary !== null
  };
}

module.exports = {
  PRIMARY_PRIORITY,
  SECONDARY_KEYS,
  DANGER_KEYS,
  UNDO_KEYS,
  planOf
};
