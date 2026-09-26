// tools/selftest-wave8.js · §28「单条保存入口」（第 2 件批 3，2026-09-26）
//
// 为什么单独一个 wave 文件：`tools/selftest.js` 与 wave5/6/7 都已贴线（≤1000 行硬上限，AGENTS §11.1），
// 按项目既有做法新开一个 wave 文件、由 `tools/selftest.js` 汇总接线（Lead 负责接线与断言计数）。
'use strict';

const fs = require('fs');
const path = require('path');

/**
 * §28 单条保存入口（`save-parts.planRowSave` / `remainingPatch` / `findRowByKey`）
 *
 * 这一节钉的是**用户裁决的原文**：「A 但要有单条保存入口」。三件事必须成立：
 *   ① **与「全部保存」同一套拦空**（D2）—— 否则会长出"整批存不进、单条却进去了"；
 *   ② **存掉的行出列表**（D1）且**重新编号**（屏上按 `data-key` 找行 ⇒ 撞 key = 行错位/存错件）；
 *   ③ 定位失败必须**显式**（"点了没反应"是本项目反复出现的坏形态）。
 * @param {{eq:function, check:function}} kit
 */
function runRowSaveSection(kit) {
  const eq = kit.eq;
  const saveParts = require('../pages/recognize/save-parts.js');
  const intake = require('../pages/recognize/intake-parts.js');
  const formParts = require('../pages/recognize/form-parts.js');
  console.log('§28 单条保存入口（planRowSave / remainingPatch / findRowByKey）');

  const rows = () => [
    { key: 'd0', stationName: '南苑菜鸟驿站', pickupCode: '1-1-1111', lockerNo: '', trackingTail: '' },
    { key: 'd1', stationName: '西苑一栋南面快递中心', pickupCode: '', lockerNo: '', trackingTail: '88888' },
    { key: 'd2', stationName: '', pickupCode: '', lockerNo: '', trackingTail: '' }
  ];

  const ok = saveParts.planRowSave(rows()[1], true, rows());
  eq('§28①：单条存 ⇒ 那一件**只用这一行的字段**（尾号件记成「尾号+5 位」），且 `remaining` = 原列表去掉该行并**重编号**',
    [ok.ok, ok.parcel.stationName, ok.parcel.pickupCode, ok.parcel.trackingTail, ok.remaining.length,
      ok.remaining.map((one) => one.key).join(','), ok.remaining.map((one) => one.pickupCode).join('|')].join(' / '),
    'true / 西苑一栋南面快递中心 / 尾号88888 / 88888 / 2 / d0,d1 / 1-1-1111|');

  // ② **同一套拦空**（D2）：把「全部保存」那条路的判据拿来做**逐字对照** —— 两个函数的裁决必须一模一样。
  //    ⛔ 这条是本节最值钱的一条：只要有人给单条路放宽一句，它当场红。
  const blank = rows()[2];
  const single = saveParts.planSingleSave(blank, true);
  const one = saveParts.planRowSave(blank, true, rows());
  eq('§28②：拦空判据与「全部保存」**同一套**（同一输入同一句话；不是"另一套规则"）',
    [one.ok, single.ok, one.errorText === single.errorText].join('|'), 'false|false|true');

  const tailBad = { key: 'd9', stationName: '南苑菜鸟驿站', pickupCode: '', lockerNo: '', trackingTail: '123' };
  const singleBad = saveParts.planSingleSave(tailBad, false);
  const oneBad = saveParts.planRowSave(tailBad, false, [tailBad]);
  eq('§28③：尾号位数不对 ⇒ 单条路与整批路给**同一句**错（且 `source` 按 recognitionUsed 如实）',
    [oneBad.ok === false, oneBad.errorText === singleBad.errorText,
      saveParts.planRowSave(tailBad, false, [tailBad]).ok].join('|'), 'true|true|false');

  // ⚠️ 这一条必须用**只有一行**的列表：意图是"存掉最后一件之后"。
  //    第一版拿三行列表来测，`remaining` 当然是 2 行 —— 断言当场红，正好证明它在真算而不是走过场。
  const last = saveParts.planRowSave(rows()[0], true, [rows()[0]]);
  const empty = saveParts.remainingPatch(last.remaining);
  eq('§28④：存掉最后一件后列表清空 ⇒ 单条卡那四格必须**清空**（否则"刚存的那件"还留在卡上，再点一次就是重复记录）',
    [empty.drafts.length, empty['draft.stationName'], empty['draft.pickupCode']].join('|'), '0||');

  const oneLeft = saveParts.remainingPatch([{ key: 'd0', stationName: '南苑菜鸟驿站', pickupCode: '9', lockerNo: '', trackingTail: '' }]);
  eq('§28⑤：只剩 1 行 ⇒ 同步到单条卡（wxml 判 `drafts.length <= 1` 渲染那张卡；不同步 = 行看不见）',
    [oneLeft.drafts.length, oneLeft['draft.stationName'], oneLeft['draft.pickupCode']].join('|'), '1|南苑菜鸟驿站|9');

  // ⚠️ 2026-09-26 独立审查 F3 的**兜底钉**：多选批次里"只有运单后 5 位"的件，走「全部保存」是**存不进的**
  //    （`saveableDrafts` 只认有码的行 ⇒ 0 条），而这一行的东西并没有丢 —— 它有 `trackingTail`，
  //    **走每行的「存这条」就能存**（本批的入口正是它的兜底）。这条断言把"两条路各自的结果"一起钉死：
  //    将来若有人把 `planRowSave` 改成也认码、或把批量路补上尾号，两个读数之一变了都会当场红。
  const tailOnly = { key: 'd0', stationName: '西苑一栋南面快递中心', pickupCode: '', lockerNo: '', trackingTail: '88888' };
  const tailPlan = saveParts.planRowSave(tailOnly, true, [tailOnly]);
  eq('§28⑨：只有尾号的件：**批量路存不进**（它的拦空）但**单条路存得进**（本批的兜底）—— 两条读数一起钉',
    [tailPlan.ok, tailPlan.parcel.pickupCode, tailPlan.parcel.trackingTail, tailPlan.remaining.length].join('|'),
    'true|尾号88888|88888|0');

  // ⚠️ 判据用**布尔**再 join：`[true, null].join('|')` 会把 null 变成空串 —— 第一版拿 `'true|null'` 当期望值，
  //    红得莫名其妙（"实际 true|||"）。要断"是不是 null"就得自己比出来，别指望 join 帮你显示。
  eq('§28⑥：定位失败必须**显式**回 null（"点了没反应"是本项目的坏形态）',
    [saveParts.findRowByKey(rows(), 'd1') !== null,
      saveParts.findRowByKey(rows(), 'd9') === null,
      saveParts.findRowByKey(rows(), '') === null,
      saveParts.findRowByKey(null, 'd0') === null,
      saveParts.findRowByKey(rows(), 'd0').pickupCode].join('|'),
    'true|true|true|true|1-1-1111');

  // ③ 搬迁不留孤儿：三个旧名字在 `intake-parts` 与 `form-parts` 两条 re-export 链上必须是**同一个函数**
  //    （否则 `planSingleSave` 会出现两个实现，正是教训卡《规则与样例分叉》的形态）
  eq('§28⑦：搬迁后 `planSingleSave` 在三处（save-parts / intake-parts / form-parts）是**同一个函数**',
    [intake.planSingleSave === saveParts.planSingleSave, formParts.planSingleSave === saveParts.planSingleSave,
      intake.cleanTail === saveParts.cleanTail, intake.normalizeStation === saveParts.normalizeStation].join('|'),
    'true|true|true|true');

  // ④ 接线钉·盯调用形状：WXML 的按钮（`bindtap="onSaveRow"` / `data-key`）↔ 零件里的处理器 ↔ 纯函数
  const flowSrc = fs.readFileSync(path.join(__dirname, '..', 'pages', 'recognize', 'recognize-flow.js'), 'utf8');
  const wxmlSrc = fs.readFileSync(path.join(__dirname, '..', 'pages', 'recognize', 'index.wxml'), 'utf8');
  kit.check('§28⑧（接线钉）：WXML 有「存这条」按钮且**绑的正是** `onSaveRow` + `data-key`；零件里该处理器走 `planRowSave` 与 `commitSingleSave`（与整批同一份写盘代码）',
    /bindtap="onSaveRow"/.test(wxmlSrc)
      && /data-key="\{\{row\.key\}\}"/.test(wxmlSrc)
      && /findRowByKey\(list, dataset\.key\)/.test(flowSrc)
      && /saveParts\.planRowSave\(row, this\.data\.recognitionUsed === true, list\)/.test(flowSrc)
      && /intake\.commitSingleSave\(\{/.test(flowSrc)
      && /saveParts\.remainingPatch\(plan\.remaining\)/.test(flowSrc),
    '按钮 → onSaveRow → planRowSave → commitSingleSave → remainingPatch');
}

module.exports = { runRowSaveSection };
