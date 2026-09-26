// pages/customer-detail/parts.js · 详情页专用零件（纯函数；页面层零断言 TD-016 ⇒ 能搬的都搬进来）
'use strict';

const aggregate = require('../../utils/aggregate.js');

/**
 * 名下的快件按**站点**分组（详情页要的是"这个人的件散在哪些驿站"，与清单页的"按站点整合"不是同一个视图）。
 * @param {Array} parcels `storage.listParcels({customerId})`（不含已删；已归档的仍显示，标出来）
 * @returns {Array<{stationName:string, pending:number, items:Array}>} 站点名升序；组内按创建时间倒序
 */
function groupByStation(parcels) {
  const alive = (parcels || []).filter((parcel) => parcel && !parcel.deletedAt);
  const newestFirst = aggregate.byNewestFirst((parcel) => parcel.createdAt);
  const buckets = {};
  const order = [];
  for (const parcel of alive) {
    // 站点名可能有空（识别失败/手填留空的旧数据）⇒ 归到一个显式分组，⛔ 不静默丢掉（§11.4）
    const key = parcel.stationName || '（没记站点）';
    if (!buckets[key]) { buckets[key] = []; order.push(key); }
    buckets[key].push(parcel);
  }
  return order.sort().map((stationName) => {
    const list = buckets[stationName].sort(newestFirst);
    return {
      stationName,
      pending: list.filter((parcel) => parcel.status === 'todo').length,
      items: list.map((parcel) => ({
        id: parcel.id,
        pickupCode: parcel.pickupCode,
        // 人话状态：列表页那套四态（待取/已取/已完成/已归档）在这里收敛成三行小字就够
        stateText: parcel.archivedAt ? '已归档' : (parcel.pickedAt ? '已取件' : (parcel.status === 'done' ? '已完成' : '待取'))
      }))
    };
  });
}

/** 编辑表单的初值（⛔ 全部转成字符串：小程序 input 的 value 收到 undefined 会渲染成 "undefined"） */
function editForm(customer) {
  const one = customer || {};
  return {
    building: one.building || '',
    dorm: one.dorm || '',
    name: one.name || '',
    note: one.note || ''
  };
}

/**
 * 三格拼回"一行"，交给**建档同一个值域闸**（`customer-input.buildCustomerInput`）判合法性 ⇒
 * 编辑与建档的规则只有一份。⛔ 不在这里自己写楼栋/宿舍号正则（那就是第二份实现）。
 * 为什么拼 `-` 而不是空格：`D4 522` 与 `D4-522` 在拆行器里都认，但 `-` 是无歧义的那种。
 */
function composeLine(form) {
  const one = form || {};
  const place = [String(one.building || '').trim(), String(one.dorm || '').trim()].filter((part) => part).join('-');
  const name = String(one.name || '').trim();
  return name ? (place + ' ' + name) : place;
}

/** 有没有真的改动（没改动就不写盘：每次写都是整键覆盖，白写一次就多一次 QUOTA 风险） */
function changedFields(customer, form) {
  const before = editForm(customer);
  const after = editForm(form);
  return Object.keys(before).filter((key) => before[key] !== after[key]);
}

module.exports = { groupByStation, editForm, composeLine, changedFields };
