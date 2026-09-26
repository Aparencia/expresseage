// pages/pickup-list/list-parts.js · 清单页的**纯决策**（页面专用零件）
//
// 为什么住零件里：`selftest` 不 require 页面（TD-016）⇒ "按了「＋ 录快件」会发生什么"这条分支
// 必须有断言看着。它住页面里时，把 `hasCustomers === false` 那个提前 return 删掉、或把来源标记
// 写错，两道门禁都是绿的（这正是 2026-09-25 真机反馈里 B 条能漏到用户手上的原因）。
//
// 2026-09-25 真机反馈（用户原话）：
//   ①「没有用户档案时仍然无法进行录入操作」⇒ 一个档案都没有时**照样进录入页**
//     （那一页有内联新建入口：建完当场选中，不用离开这一屏）；
//   ②「取件清单的录快件不应该默认绑定，而只有从用户档案进入的录快件才进行默认绑定」
//     ⇒ 本页**不再携带 `customerId`**：归属一律由人在录入页里选或建。
'use strict';

const aggregate = require('../../utils/aggregate.js');   // 客户标签单源（⛔ 别在别处再拼 name/building/dorm）
const migrate = require('../../utils/migrate.js');       // 「未归类」占位档案的 id 与判据（schema 是事实源）

const RECOGNIZE_URL = '/pages/recognize/index';

// `from=list` 是**来源标记**，不是装饰：录入页靠它区分"清单入口"与"档案入口"，
// 从而决定要不要显示会话键命中提示（清单入口一律不谈会话，见 `form-parts.preselectNote`）。
const LIST_SOURCE = 'list';

/** 清单入口的录入页 URL（带来源标记，不带 customerId） */
function intakeUrl() {
  return RECOGNIZE_URL + '?from=' + LIST_SOURCE;
}

/**
 * 「＋ 录快件」按下去要做什么。
 * @param {{hasCustomers:boolean|null}} state `hasCustomers`：`null` = **读库失败**（不知道有没有档案，
 *   与"没有档案"是两件事 —— 把读库失败说成"你还没建档"是本页旧文案犯过的错）
 * @returns {{ok:boolean, url:string, errorText:string}} `ok:false` 时**不许**导航（进一个读不出客户的
 *   页面只会让人对着空列表猜），错误要说清是"读不出来"而不是"没有"
 */
function intakeTarget(state) {
  const s = state || {};
  if (s.hasCustomers !== true && s.hasCustomers !== false) {
    return { ok: false, url: '', errorText: '档案列表现在读不出来 —— 先按上面的提示处理，再录快件。' };
  }
  return { ok: true, url: intakeUrl(), errorText: '' };
}

module.exports = { intakeTarget, intakeUrl, LIST_SOURCE, RECOGNIZE_URL, splitUnassigned, unassignedHeadText, reassignOptions, reassignText, unassignedHint };

// ── 「未归类」分组（2026-09-25 用户裁决 A：加占位客户）─────────────────────────────
// 为什么这几条判据必须住在零件里而不是页面里：页面层零断言（TD-016）。"取消建档留下的件在清单里
// 到底出不出现、能不能重归"要是只写在页面里，把 `wx:if` 写反、或把占位档案混进候选，
// 两道门禁**都是绿的** —— 而这批的整个意义就是"件不许变成看不见的黑洞"。
// ⛔ 占位档案的 id / 判据只从 schema 层（`utils/migrate.js`）取，别在这里写 'unassigned' 字面量。

/**
 * 把占位档案名下的件从待办里**分流出来**（原对象、不做拷贝：本函数只分流、不改内容）。
 * @param {Array} parcels `storage.listParcels()` 的产物（默认已排除软删；这里再挡一次 null/deletedAt）
 * @returns {{unassigned:Array, rest:Array}} `rest` 才交给 `aggregate.buildPickupList` 按站点分组
 */
function splitUnassigned(parcels) {
  const unassigned = [];
  const rest = [];
  for (const parcel of parcels || []) {
    if (!parcel || parcel.deletedAt) continue;
    if (parcel.customerId === migrate.PLACEHOLDER_CUSTOMER_ID) unassigned.push(parcel);
    else rest.push(parcel);
  }
  return { unassigned: unassigned, rest: rest };
}

/** 未归类分组的标题（件数上屏与断言共用同一份文案） */
function unassignedHeadText(count) {
  return '未归类（' + (count || 0) + ' 件）';
}

/**
 * 重归的候选项（只含真实客户）。
 * ⛔ 占位档案自己**不在**候选里 —— 否则"归给未归类"就是原地打转；软删档案也不给（归给已删的人会立刻悬空）。
 * @returns {Array<{id:string,label:string}>} `label` 走 `aggregate.customerLabel`（标签单源）
 */
function reassignOptions(customers) {
  return (customers || [])
    .filter((customer) => customer && !customer.deletedAt && !migrate.isPlaceholderCustomer(customer))
    .map((customer) => ({ id: customer.id, label: aggregate.customerLabel(customer) }));
}

/** 重归按钮文案：没有可选项时**不许**给一颗点了没用的按钮，要说清下一步 */
function reassignText(options) {
  const list = options || [];
  if (list.length === 0) return '还没有别的客户 —— 先去「用户档案」建一位，再回来把这一组归过去。';
  return '归给某位客户（' + list.length + ' 位可选）';
}

/** 未归类分组的说明（这些件从哪来、归完会去哪） */
function unassignedHint() {
  return '这些件还没归属（建档那次点了取消）。归给某位客户之后，它们会进对应的站点分组。';
}
