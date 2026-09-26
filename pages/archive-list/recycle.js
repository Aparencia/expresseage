// pages/archive-list/recycle.js · 回收站的**纯逻辑**（页面专用零件）
//
// 为什么住零件里：`selftest` 不 require 页面（TD-016）⇒ "哪些算已删除""两步按钮的文案与状态"
// 这三件事必须能被断言。彻底删除是本项目**唯一不可逆**的动作（没有备份、没有导出）⇒ 它的判据不能只活在页面里。
//
// ⚠️ 2026-09-25 真机反馈（用户原话）：「彻底删除应该有全部彻底删除入口，且**第二次确认应该由按钮承担**」
//   ⇒ 逐字输入确认词那条路**撤掉**（它把摩擦放进了输入法：真机上打不出/懒得打 = 要么放弃、要么乱打），
//      改成"同一颗按钮点两下"：第一下 arm（文案变「确认：不可逆删除」并摊开后果），第二下才真删。
//      arm 状态与后果文案都是这里的纯函数 ⇒ 可断言。
'use strict';

const aggregate = require('../../utils/aggregate.js');   // 客户标签**单源**（2026-09-25 同族第 5 处收口）

/**
 * 回收站列表：只放**已软删**的档案（未软删的不能进这里 ⇒ 也就走不到彻底删除）。
 * @param {Array} customers `storage.listCustomers({includeDeleted:true})` 的产物
 * @param {Object} totalCounts `aggregate.countActiveByCustomer(此时**含已删**的全量 parcels)`
 *   口径说明：这里要的是"点彻底删除会连带删掉多少件"，所以用**全量**（含已删）件数，
 *   与档案行确认框用的 `countActiveByCustomer`（只算未删）**不是同一个数**，两者别混。
 * @returns {Array<{id:string, label:string, parcelCount:number, deletedAt:number, purgeQuestion:string}>} 按删除时间倒序
 */
function deletedRows(customers, totalCounts) {
  const counts = totalCounts || {};
  return (customers || [])
    .filter((item) => item && item.deletedAt)
    .map((item) => {
      const row = {
        id: item.id,
        // ⛔ 不许在这里自己拼（旧写法 `[item.building, item.dorm, item.name].join(' ')` 会让空称呼
        //    客户显示成 `D4 555 D4 555 A`：派生名本身就带"楼栋 宿舍"前缀）。标签只由单源出。
        label: aggregate.customerLabel(item),
        parcelCount: counts[item.id] || 0,
        deletedAt: item.deletedAt
      };
      row.purgeQuestion = purgeQuestion(row);
      return row;
    })
    .sort((a, b) => b.deletedAt - a.deletedAt);
}

/** 底部入口上的数字：软删档案数（没有软删档案时不显示这个入口） */
function deletedCount(customers) {
  return (customers || []).filter((item) => item && item.deletedAt).length;
}

/** 回收站一行/全部的总量（"全部彻底删除"的二次确认要把这两个数摊开给人看） */
function purgeTotals(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let parcelCount = 0;
  for (const row of list) parcelCount += (row && row.parcelCount) || 0;
  return { count: list.length, parcelCount: parcelCount };
}

/**
 * 第一步（arm）的确认文案：⛔ 必须出现"不可逆"与"没有备份"这两件**事实**——
 * 写成"可以恢复"就是假承诺（本项目数据只存本机、没有导出/备份功能）。
 */
function purgeQuestion(row) {
  const label = (row && row.label) || '这条档案';
  const n = (row && row.parcelCount) || 0;
  return '彻底删除「' + label + '」？\n'
    + '这会从本机库里真删这条档案**和它名下的 ' + n + ' 条快件记录**。\n'
    + '⛔ 不可逆：本项目没有备份、没有导出，删掉就再也找不回来。\n'
    + '若只是想让它从列表里消失，请改用「删除」（可以恢复）。'
    + '\n再点一下右边那颗按钮才会删。';
}

/** 「全部彻底删除」的确认文案：把"要删几位、名下共几件"摊开（比逐条更危险 ⇒ 数字必须显式） */
function purgeAllQuestion(rows) {
  const sum = purgeTotals(rows);
  if (sum.count === 0) return '回收站是空的，没有可彻底删除的档案。';
  return '彻底删除回收站里**全部 ' + sum.count + ' 位**档案？\n'
    + '会从本机库里真删这 ' + sum.count + ' 位，以及它们名下共 ' + sum.parcelCount + ' 条快件记录。\n'
    + '⛔ 不可逆：本项目没有备份、没有导出，删掉就再也找不回来。\n'
    + '只想让某一位从列表里消失，请用行内的「删除」（可以恢复）。'
    + '\n再点一下右边那颗按钮才会删。';
}

/** 按钮文案：第一下 = 提出；第二下 = 真删（"第二次确认由按钮承担"——用户 2026-09-25 裁决） */
function purgeButtonText(armed) {
  return armed ? '确认：不可逆删除' : '彻底删除';
}

/** 「全部彻底删除」的按钮文案（带上条数，避免人对着同一个词连点两下） */
function purgeAllButtonText(armed, count) {
  const n = count || 0;
  return armed ? '确认：全部删除 ' + n + ' 位' : '全部彻底删除';
}

/** 软删的确认文案：必须写明"名下 N 件会一起隐藏、可恢复"（用户裁决③） */
function softDeleteQuestion(row) {
  const label = (row && row.label) || '这条档案';
  const n = (row && row.parcelCount) || 0;
  return '删除「' + label + '」？\n'
    + '它名下未完成的 ' + n + ' 条快件会一起隐藏（不会真删）。\n'
    + '想找回来：列表底部「已删除」里可以恢复。';
}

/**
 * 客户档案发生任何增删改之后，页面**必须一次写全**的那几个 data 键（回收站三件 + 复位 arm 状态 + notice）。
 *
 * 为什么要有它：2026-09-25 真机反馈「**优化在删除后立即刷新**」的根因就是——四条路径（软删 / 恢复 /
 * 逐条彻底删除 / 全部彻底删除）里有三条只刷新了档案列表，**底部「已删除(N)」入口的计数与件数合计
 * 要等下一次 `onShow` 才更新**（页面层零断言 TD-016 ⇒ 少写一个键谁都看不见）。
 * 收敛到这一个纯函数之后，"漏键"这件事本身可以被断言钉住（见 selftest §11d 的"删除后立即刷新"三条）。
 *
 * @param {Array} rows `deletedRows(...)` 的产物（读库失败时传 `null`/非数组 ⇒ 按空处理，⛔ 但调用方
 *   应当在读库失败时**只写 notice、不要拿空数组覆盖计数**，否则"读不出来"会显示成"没有已删档案"）
 * @param {string} [notice] 这次要写在页面上的结果提示（空串 = 清掉上一条）
 * @returns {{deletedRows:Array, deletedCount:number, deletedParcelTotal:number,
 *   purgeArmedId:string, purgeQuestion:string, purgeAllArmed:boolean, purgeAllQuestion:string, notice:string}}
 */
function recyclePatch(rows, notice) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    deletedRows: list,
    deletedCount: list.length,
    deletedParcelTotal: purgeTotals(list).parcelCount,
    // arm 状态一律复位：删完还留着一个"已 arm"的按钮，下一个人点一下就会真删（本项目唯一不可逆的动作）
    purgeArmedId: '', purgeQuestion: '', purgeAllArmed: false, purgeAllQuestion: '',
    notice: typeof notice === 'string' ? notice : ''
  };
}

module.exports = {
  recyclePatch,
  deletedRows,
  deletedCount,
  purgeTotals,
  purgeQuestion,
  purgeAllQuestion,
  purgeButtonText,
  purgeAllButtonText,
  softDeleteQuestion
};
