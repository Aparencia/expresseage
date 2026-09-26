// tools/audit-migrate.js · 迁移审计（TD-003 的机器闸；零依赖：只用 node 内置 + utils/{migrate,stations}.js）
//
// 为什么有它（TD-003）：欠账的触发条件 = **v2 第一次真实升版**；2026-09-26 V1→V2（站点名归一，用户批准的
// 数据写入「1、是」）就是那一次 ⇒ 按期落地。
// 与 `tools/selftest.js` §1 的分工（⛔ 不是把 §1 抄一遍）：§1 是**回归闸**，钉几条手写样本；本脚本是
// **外部真值驱动的审计**，两份真值都不经过 migrate.js 自己的实现 —— ① `utils/stations.js` 的**声明处**
// （两张表的字面量；它们刻意不进 module.exports，所以要读源码，且必须先 stripComments，理由见
// extractStationTables）；② `migrate.js` 自己写下的契约（`normalizedStationName` 函数头：能收敛就返回
// 正式名，否则原样返回，⛔ 绝不写空串）。
// 三类问题：ⓐ **全表扫描**（每个别名 / 每个正式名都过一遍，§1 只钉了一条旧名 `西苑邮政`）；ⓑ **属性式检查**
// （幂等 / 只动一个字段 / 键集合 / 掩码整库字节比 / 读数如实 / 畸形不许洗白）；ⓒ **静态判据**（去注释后的
// 迁移源码里不许出现任何站点名字面量 —— 取代 §1④ 那个"自己等于自己"的恒真式子）。
// 用法：`node tools/audit-migrate.js` —— 全过退出码 0；任一判据不成立退出 1（**1 是结论，不是脚本崩了**），
// 每条读数打到 stdout。⛔ 不许用 `|| true` 糊过去。
// ⚠️ 取值的纪律（R-11 同族）：**判据必须跑到** —— 被审代码坏掉时 `up()` 的返回可能没有 `.state`，直接取
//    深层字段会抛异常 ⇒ 那条判据变成"没跑"而不是"红"。所以一律走 `stateOf`/`parcelsOf`/`upStationName`。
// ⚠️ 行数：`gate.ps1` 只给**文件名含 `selftest`** 的文件 1000 行豁免，本文件名不含 ⇒ 必须守住 500 行。
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const migrate = require('../utils/migrate.js');
const stations = require('../utils/stations.js');

const ROOT = path.join(__dirname, '..');
const MIGRATE_SRC = path.join(ROOT, 'utils', 'migrate.js');
const STATIONS_SRC = path.join(ROOT, 'utils', 'stations.js');
const STORAGE_CORE_SRC = path.join(ROOT, 'utils', 'storage-core.js');
// up 的另一半职责是"补缺失字段"（与站点名归一无关）⇒ 键集合判据用它划边界：只有这三个字段允许新增
const ADDED_FIELD_WHITELIST = ['pickedAt', 'lockerNo', 'trackingTail'];
const T0 = 1700000000000;      // 固定时间戳：样本必须可复现（用 Date.now() 会让读数每次都不同）

function readSource(file) { return fs.readFileSync(file, 'utf8'); }
function sha256(text) { return crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12); }
function deepClone(value) { return JSON.parse(JSON.stringify(value)); }
function sameBytes(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function hasKey(obj, key) { return !!obj && Object.prototype.hasOwnProperty.call(obj, key); }
function keySet(obj) { return Object.keys(obj || {}).sort().join(','); }
// undefined 与"键不存在"必须区分得开：JSON.stringify(undefined) 是 undefined（不是字符串）
function fieldBytes(value) { return JSON.stringify(value === undefined ? '<undefined>' : value); }
/** 取值不抛（见文件头）：拿不到就给空对象/空数组，让判据红，不让进程崩 */
function stateOf(result) { return result && typeof result === 'object' && result.state ? result.state : {}; }
function parcelsOf(store) { return store && Array.isArray(store.parcels) ? store.parcels : []; }
/** 逐位配对的站点名读数（按**下标**配对，不用 indexOf：变异后对象会被复制，按引用找会取到 undefined） */
function pairNames(before, after) {
  const list = Array.isArray(after) ? after : [];
  return (before || []).map((i, k) => String(i && i.stationName) + '→' + String(list[k] && list[k].stationName)).join('、');
}

/**
 * 去掉 JS 注释（保留字符串字面量）。**只给静态判据用**：判断某个字面量是不是真的写进了代码。
 * 为什么必须去注释：`utils/migrate.js` 的注释里逐字写着新旧站点名（那正是本次迁移的说明文字；实测含注释的
 * 原文里有 2 处、去掉注释后 0 处）。不去注释，判据就变成"看谁注释写得多"。
 * 局限（如实记）：不识别正则字面量 —— 若被读源码出现含 `//` 的正则，其后的同行代码会被当成注释丢掉，
 * 那只可能**漏报**（少发现一处硬编码），不会误报成红。
 */
function stripComments(source) {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') { while (i < n && source[i] !== '\n') i++; continue; }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2; continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      out += ch; i++;
      while (i < n) {
        if (source[i] === '\\') { out += source[i] + (source[i + 1] || ''); i += 2; continue; }
        out += source[i];
        if (source[i] === ch) { i++; break; }
        i++;
      }
      continue;
    }
    out += ch; i++;
  }
  return out;
}

function sliceDecl(code, start, end) {
  const from = code.indexOf(start);
  if (from < 0) return '';
  const to = code.indexOf(end, from + start.length);
  return to < 0 ? '' : code.slice(from + start.length, to);
}

/**
 * 抽出 `utils/stations.js` 的两张表（**外部真值**）。
 * 为什么不从 `module.exports` 取：这两张表**刻意不导出**（24 审查 R-13：导出而全仓零消费 = 死代码）——
 * 审计要的正是"声明处那一份"，这样它才独立于 migrate.js 眼里的站点表。
 * ⚠️ 必须先 stripComments：`STATION_POINTS` 表体里有一行注释逐字写着 `{alias: '西苑邮政', point: 'P7'}`，
 *    不去注释就会把它当表项抽进来（实测：会多出 `alias`/`point` 两个假键 ⇒ 真值当场被污染）。
 */
function extractStationTables() {
  const code = stripComments(readSource(STATIONS_SRC));
  const pointBody = sliceDecl(code, 'const STATION_POINTS = {', '\n};');
  const aliasBody = sliceDecl(code, 'const STATION_ALIASES = [', '\n];');
  const ids = [];
  const names = [];
  const rePoint = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*'([^']*)'/g;
  let m = rePoint.exec(pointBody);
  while (m !== null) { ids.push(m[1]); names.push(m[2]); m = rePoint.exec(pointBody); }
  const aliases = [];
  const reAlias = /\{\s*alias:\s*'([^']*)'\s*,\s*point:\s*'([^']*)'\s*\}/g;
  m = reAlias.exec(aliasBody);
  while (m !== null) { aliases.push({ alias: m[1], point: m[2] }); m = reAlias.exec(aliasBody); }
  return { ids: ids, names: names, aliases: aliases };
}

function pointNameOf(tables, pointId) {
  const index = tables.ids.indexOf(pointId);
  return index < 0 ? '' : tables.names[index];
}

// ── 样本（fixture）────────────────────────────────────────────────────────
function customerOf(id) {
  return { id: id || 'c1', name: '小王', building: 'D4', dorm: '522', note: '', chatRoomId: '',
    createdAt: T0, updatedAt: T0, deletedAt: null, deleteBatch: null };
}

/**
 * 一条**字段齐全**的 V1 记录：pickedAt/lockerNo/trackingTail 都在 ⇒ up 的"补缺失字段"那一半无事可做。
 * 为什么非得齐全：少一个字段，逐字段比较就被"补齐"污染，"只动 stationName"这条判据会变成假的。
 */
function parcelOf(id, stationName) {
  return { id: id, customerId: 'c1', stationName: stationName, pickupCode: '109-2-3003', status: 'todo',
    source: 'manual', createdAt: T0, updatedAt: T0, doneAt: null, pickedAt: null, archivedAt: null,
    deletedAt: null, deleteBatch: null, lockerNo: '3号柜', trackingTail: '12345' };
}

function storeOf(version, parcels, customers) {
  return { schemaVersion: version, customers: customers || [customerOf()], parcels: parcels };
}

/** 4 条记录的 V1 库：2 条别名（会被改）+ 1 条正式名 + 1 条自建名（都不许被动） */
function fullV1Store(tables) {
  return storeOf(1, [parcelOf('p1', tables.aliases[0].alias), parcelOf('p2', tables.names[0]),
    parcelOf('p3', '自建点-东门'), parcelOf('p4', tables.aliases[tables.aliases.length - 1].alias)]);
}

/** 字段缺失的旧库：只有"补缺失字段"那一半会动它 —— 用白名单把它与"归一"分开量 */
function legacyV1Store(tables) {
  return storeOf(1, [{ id: 'p9', customerId: 'c1', stationName: tables.aliases[tables.aliases.length - 1].alias,
    pickupCode: '1', status: 'todo', source: 'manual', createdAt: T0, updatedAt: T0 }]);
}

// ── 判据引擎 ──────────────────────────────────────────────────────────────
const tally = { pass: 0, fail: 0 };

function report(name, ok, reading) {
  if (ok === true) { tally.pass += 1; console.log('[OK] ' + name + ' —— ' + reading); return; }
  tally.fail += 1;
  process.exitCode = 1;
  console.log('[FAIL] ' + name + ' —— ' + reading);
}

/**
 * 逐条比对 up 前后的记录集合，把"哪里变了"变成可打印的读数。判据只做"集合是否为空"的判断 ——
 * 失败时屏上直接写出是哪条记录、哪个字段（AGENTS §11.4 要能指向根因）。
 */
function diffParcels(before, after) {
  const out = { renamed: [], otherChanged: [], added: [], removed: [], order: [], length: '' };
  if (!Array.isArray(before) || !Array.isArray(after)) { out.length = '不是数组'; return out; }
  if (before.length !== after.length) out.length = before.length + '→' + after.length;
  for (let i = 0; i < Math.min(before.length, after.length); i++) {
    const a = before[i] || {};
    const b = after[i] || {};
    if (a.id !== b.id) out.order.push(i + ':' + a.id + '→' + b.id);
    for (const key of Object.keys(a)) {
      if (!hasKey(b, key)) { out.removed.push(a.id + ':' + key); continue; }
      if (key === 'stationName') {
        if (a[key] !== b[key]) out.renamed.push(a.id + ':' + String(a[key]) + '→' + String(b[key]));
        continue;
      }
      if (fieldBytes(a[key]) !== fieldBytes(b[key])) out.otherChanged.push(a.id + ':' + key);
    }
    for (const key of Object.keys(b)) if (!hasKey(a, key)) out.added.push(b.id + ':' + key);
  }
  return out;
}

/**
 * 掩码序列化：把**唯一允许变的两个位置**（顶层 schemaVersion、每条记录的 stationName）抹成同一个占位符后
 * 再序列化 ⇒ "整库除这两处外逐字节相同"退化成一次字符串比较，不必逐字段堆判据。
 * ⚠️ 只对字段齐全的输入用：缺字段的旧库会被 up 补三个字段，掩码比会红（那是另一条职责，不是缺陷）。
 */
function maskedBytes(store) {
  const copy = deepClone(store === undefined ? null : store);
  if (!copy || typeof copy !== 'object') return JSON.stringify(copy);
  copy.schemaVersion = '#';
  for (const parcel of copy.parcels || []) if (parcel && typeof parcel === 'object') parcel.stationName = '#';
  return JSON.stringify(copy);
}

/** 契约（migrate.js 函数头注释）+ 站点表 ⇒ up **应该**返回什么。⛔ 不从 migrate 的实现里反推 */
function expectedStationName(name) {
  if (typeof name !== 'string' || name === '') return name;
  const hit = stations.matchBuiltinStation(name);
  return hit && hit.ok ? hit.stationName : name;
}

/** 探针集合：**由两张表派生**，外加手工自建名、空串、拼接名（同时含两个正式名 ⇒ ambiguous） */
function stationBattery(tables) {
  const probes = [];
  for (const item of tables.aliases) probes.push(item.alias);
  for (const name of tables.names) probes.push(name);
  probes.push('自建点-东门', '东门菜鸟驿站', '老图书馆后门', '校内代收点', '');
  probes.push(tables.names[2] + '与' + tables.names[5], tables.names[0] + '8号柜');
  return probes;
}

/** 只喂一条记录、只取回它的站点名 —— **不抛**（异常收成读数，判据才跑得到） */
function upStationName(name) {
  try {
    const result = migrate.up(storeOf(1, [parcelOf('p1', name)]));
    if (!result || result.ok !== true) return '<up 拒绝：' + (result && result.reason) + '>';
    const parcel = parcelsOf(stateOf(result))[0];
    return parcel ? parcel.stationName : '<up 没返回记录>';
  } catch (err) { return '<抛异常：' + String((err && err.message) || err) + '>'; }
}

function joinReadings(list) { return list.length === 0 ? '' : '｜' + list.join('；'); }

// ── A. 真值本身（先证明"真值不是空集"，再谈别的 —— 教训卡《空集上的全绿》）────────────
function auditTruth(tables, migrateRaw) {
  const listed = stations.listStationPoints();
  report('A1 真值非空（空集防御：判据不许跑在空集上还是绿的）',
    tables.names.length > 0 && tables.aliases.length > 0,
    '声明处抽到正式名 ' + tables.names.length + ' 条 / 别名 ' + tables.aliases.length + ' 条');
  const targets = tables.aliases.map((a) => a.point).filter((p, i, arr) => arr.indexOf(p) === i);
  const inTable = targets.every((p) => tables.ids.indexOf(p) >= 0);
  report('A2 两张表与导出真值一致：声明处 == listStationPoints()（逐字 + 顺序），别名目标都在表内',
    sameBytes(tables.names, listed) && inTable,
    '逐字+顺序一致=' + sameBytes(tables.names, listed) + '（' + tables.ids.join('/') + '）｜别名指向 '
      + targets.join('/') + ' 全在表内=' + inTable);
  const selfCheck = tables.aliases.filter((a) => {
    const hit = stations.matchBuiltinStation(a.alias);
    return !(hit && hit.ok === true && hit.stationName === pointNameOf(tables, a.point));
  });
  report('A3 别名表的自洽：每个别名在站点表自己的判定下都命中，且指向该点',
    tables.aliases.length > 0 && selfCheck.length === 0,
    (tables.aliases.length - selfCheck.length) + '/' + tables.aliases.length + ' 条自洽'
      + joinReadings(selfCheck.map((a) => a.alias)));
  const code = stripComments(migrateRaw);
  const literals = tables.names.concat(tables.aliases.map((a) => a.alias));
  const hits = literals.filter((name) => name && code.indexOf(name) >= 0);
  const rawHits = literals.filter((name) => name && migrateRaw.indexOf(name) >= 0);
  report('A4【静态】去掉注释后 migrate.js 里**不含任何站点名字面量**（判定只能来自 stations.js）',
    hits.length === 0, literals.length + ' 个字面量 → 代码里 ' + hits.length + ' 次（含注释的原文里有 '
      + rawHits.length + ' 次 = 迁移的说明文字，所以这条判据必须先去注释）' + joinReadings(hits));
}

// ── B. (d) 判定来自站点表：全表扫描 + 与站点表的判定逐条等价 ──────────────────────
function auditSweep(tables) {
  const misses = [];
  const byTarget = {};
  for (const item of tables.aliases) {
    const expected = pointNameOf(tables, item.point);
    const actual = upStationName(item.alias);
    if (actual !== expected) misses.push(item.alias + '→' + actual + '（期望 ' + expected + '）');
    byTarget[item.point] = (byTarget[item.point] || 0) + 1;
  }
  report('B1【(d)】每个别名都归一到**它指向的那个正式名**（全表扫描，不是抽一条样本）',
    tables.aliases.length > 0 && misses.length === 0,
    (tables.aliases.length - misses.length) + '/' + tables.aliases.length + ' 条命中（'
      + Object.keys(byTarget).map((k) => k + '×' + byTarget[k]).join('/') + '）' + joinReadings(misses));
  const movedOfficial = tables.names.filter((name) => upStationName(name) !== name);
  report('B2 每个正式名都**原样不动**（归一的目标集合自己是幂等的）',
    tables.names.length > 0 && movedOfficial.length === 0,
    (tables.names.length - movedOfficial.length) + '/' + tables.names.length + ' 条原样' + joinReadings(movedOfficial));
  const selfBuilt = ['自建点-东门', '东门菜鸟驿站', '老图书馆后门', '校内代收点'];
  const notOutOfTable = selfBuilt.filter((name) => stations.matchBuiltinStation(name).ok === true);
  const kept = selfBuilt.filter((name) => upStationName(name) === name);
  report('B3 自建名**原样留下**（⛔ 绝不写空串、绝不猜）—— 且先证明这 4 个名字确实不在站点表里',
    selfBuilt.length > 0 && notOutOfTable.length === 0 && kept.length === selfBuilt.length,
    kept.length + '/' + selfBuilt.length + ' 条原样｜"确实不在表里"=' + (notOutOfTable.length === 0)
      + joinReadings(notOutOfTable));
  const probes = stationBattery(tables);
  const mismatched = probes.filter((name) => upStationName(name) !== expectedStationName(name));
  report('B4【核心等价式】up 的判定 ≡ 站点表的判定（' + probes.length + ' 条探针：别名/正式名/自建/空串/拼接）',
    probes.length > 0 && mismatched.length === 0,
    (probes.length - mismatched.length) + '/' + probes.length + ' 条一致' + joinReadings(mismatched));
  const containsProbe = tables.names[0] + '8号柜';
  const containsHit = stations.matchBuiltinStation(containsProbe);
  report('B5 代价如实：恰好包含一个正式名的自建名会被一并收敛（migrate.js 注释已声明这条代价）',
    containsHit.ok === true && containsHit.kind === 'contains' && upStationName(containsProbe) === containsHit.stationName,
    '「' + containsProbe + '」kind=' + containsHit.kind + ' ⇒ 收敛成「' + upStationName(containsProbe) + '」');
  const ambiguousProbe = tables.names[2] + '与' + tables.names[5];
  const ambiguousHit = stations.matchBuiltinStation(ambiguousProbe);
  report('B6 不确定的输入（同时含两个正式名 ⇒ ambiguous）**一律不动** —— 不猜 = 不跑错驿站',
    ambiguousHit.ok === false && ambiguousHit.kind === 'ambiguous' && upStationName(ambiguousProbe) === ambiguousProbe,
    'kind=' + ambiguousHit.kind + ' ⇒ 原样留下=' + (upStationName(ambiguousProbe) === ambiguousProbe));
}

// ── C. (b) 只动 stationName：键集合 / 逐字段 / 顺序 / 客户 / 顶层键 / 掩码整库字节 ──────────
function auditOnlyStationName(tables) {
  const before = fullV1Store(tables);
  const after = stateOf(migrate.up(before));
  const afterParcels = parcelsOf(after);
  const diff = diffParcels(before.parcels, afterParcels);
  const keyDiffs = [];
  for (let i = 0; i < before.parcels.length; i++) {
    // ⚠️ 用下标配对（先 filter 再 map 会让读数里的下标错位 —— 那是"读数说谎"，比判据红更坏）
    if (keySet(before.parcels[i]) !== keySet(afterParcels[i])) {
      keyDiffs.push(before.parcels[i].id + ':' + keySet(before.parcels[i]) + ' vs ' + keySet(afterParcels[i]));
    }
  }
  report('C1【(b)】同一条记录的**键集合一致**（字段齐全的输入 ⇒ up 只许改值，不许增删键）',
    before.parcels.length > 0 && keyDiffs.length === 0,
    before.parcels.length + ' 条记录键集合全等｜样板键=' + keySet(before.parcels[0]) + joinReadings(keyDiffs));
  report('C2【(b)】除 stationName 外**逐字段深比**：一个字段都没动（取件码/柜号/尾号/时间戳…）',
    diff.otherChanged.length === 0 && diff.removed.length === 0 && diff.renamed.length === 2,
    '其他字段变动 ' + diff.otherChanged.length + ' 处 / 缺键 ' + diff.removed.length + ' 处｜实际归一 '
      + diff.renamed.length + ' 条：' + diff.renamed.join('、') + joinReadings(diff.otherChanged.concat(diff.removed)));
  report('C3【(b)】记录**条数与顺序一致**（id 序列逐位相同 ⇒ 不是重排后再比）',
    diff.length === '' && diff.order.length === 0,
    '条数 ' + before.parcels.length + '→' + afterParcels.length + '｜id 序列=' + afterParcels.map((p) => p.id).join('>')
      + joinReadings(diff.order.concat(diff.length ? [diff.length] : [])));
  report('C4【(b)】客户集合**一个字节没动**（深比 + 同一个对象：归一不该顺手重建档案）',
    sameBytes(before.customers, after.customers) && after.customers === before.customers,
    '深比相同=' + sameBytes(before.customers, after.customers) + '｜引用同一数组=' + (after.customers === before.customers));
}

function auditNoExtraKeys(tables) {
  const before = fullV1Store(tables);
  const result = migrate.up(before);
  const after = stateOf(result);
  const leaked = hasKey(after, 'stationRenamed') || JSON.stringify(after).indexOf('stationRenamed') >= 0;
  report('C5 顶层键集合不变、读数**不落库**（往库里塞 stationRenamed 等于扩 schema，那是另一件事）',
    keySet(after) === keySet(before) && leaked === false && hasKey(result, 'stationRenamed') === true,
    '顶层键=' + keySet(after) + '｜读数在结果对象上=' + hasKey(result, 'stationRenamed')
      + '、在 state 上=' + hasKey(after, 'stationRenamed'));
  report('C6 掩码整库字节比：除 schemaVersion 与 stationName 外，整库**逐字节相同**',
    maskedBytes(before) === maskedBytes(after),
    '掩码后 ' + maskedBytes(before).length + ' 字节 vs ' + maskedBytes(after).length + ' 字节｜相同='
      + (maskedBytes(before) === maskedBytes(after)));
  const legacy = legacyV1Store(tables);
  const legacyDiff = diffParcels(legacy.parcels, parcelsOf(stateOf(migrate.up(legacy))));
  const outOfWhitelist = legacyDiff.added.filter((text) => ADDED_FIELD_WHITELIST.indexOf(text.split(':')[1]) < 0);
  report('C7 缺字段的旧库：新增的键**只允许**是 ' + ADDED_FIELD_WHITELIST.join('/') + '（白名单外一个都不许）',
    outOfWhitelist.length === 0 && legacyDiff.otherChanged.length === 0 && legacyDiff.added.length === 3,
    '新增 ' + legacyDiff.added.map((t) => t.split(':')[1]).join('/') + '（' + legacyDiff.added.length + ' 个）'
      + '｜其他字段变动 ' + legacyDiff.otherChanged.length + ' 处' + joinReadings(outOfWhitelist));
}

// ── D. (c) stationRenamed 读数如实：0 条 / 1 条 / 多条 ─────────────────────────
function auditCounts(tables) {
  const aliasLast = tables.aliases[tables.aliases.length - 1].alias;
  const zeroStore = storeOf(1, [parcelOf('p1', tables.names[0]), parcelOf('p2', '自建点-东门')]);
  const zeroResult = migrate.up(zeroStore);
  const zeroDiff = diffParcels(zeroStore.parcels, parcelsOf(stateOf(zeroResult)));
  report('D1【(c)】**0 条**改写时读数如实为 0（且库里确实有 2 条记录，不是空集）',
    zeroResult.stationRenamed === 0 && zeroDiff.renamed.length === 0 && zeroStore.parcels.length === 2,
    '读数=' + zeroResult.stationRenamed + '｜实际差异 ' + zeroDiff.renamed.length + ' 条｜记录 ' + zeroStore.parcels.length + ' 条');
  const oneStore = storeOf(1, [parcelOf('p1', tables.names[1]), parcelOf('p2', aliasLast)]);
  const oneResult = migrate.up(oneStore);
  const oneDiff = diffParcels(oneStore.parcels, parcelsOf(stateOf(oneResult)));
  report('D2【(c)】**1 条**改写：读数 == 实际差异条数',
    oneResult.stationRenamed === 1 && oneDiff.renamed.length === 1,
    '读数=' + oneResult.stationRenamed + '｜实际 ' + oneDiff.renamed.length + ' 条=' + oneDiff.renamed.join('、'));
  const manyStore = storeOf(1, tables.aliases.map((item, i) => parcelOf('a' + i, item.alias)));
  const manyResult = migrate.up(manyStore);
  const manyDiff = diffParcels(manyStore.parcels, parcelsOf(stateOf(manyResult)));
  report('D3【(c)】**多条**改写：读数 == 实际差异条数（全别名库 ' + tables.aliases.length + ' 条）',
    manyResult.stationRenamed === manyDiff.renamed.length && manyDiff.renamed.length === tables.aliases.length,
    '读数=' + manyResult.stationRenamed + '｜实际 ' + manyDiff.renamed.length + ' 条（库内 ' + manyStore.parcels.length + ' 条）');
  const samples = [zeroStore, oneStore, manyStore, fullV1Store(tables), legacyV1Store(tables)];
  const readings = samples.map((sample) => migrate.up(sample).stationRenamed);
  const dishonest = samples.filter((sample, i) => readings[i]
    !== diffParcels(sample.parcels, parcelsOf(stateOf(migrate.up(sample)))).renamed.length);
  report('D4【(c)】读数在**全部 ' + samples.length + ' 个样本**上都等于独立数出来的条数（不是只对一条样本对）',
    dishonest.length === 0 && samples.length >= 4,
    (samples.length - dishonest.length) + '/' + samples.length + ' 个样本如实｜读数序列=' + readings.join(','));
}

// ── E. (a) 幂等：深度相等 + 第二次零改写（同一个对象）─────────────────────────────
function auditIdempotence(tables) {
  const first = migrate.up(fullV1Store(tables));
  const second = migrate.up(stateOf(first));
  report('E1【(a)】幂等（深度）：up(up(x).state).state 与 up(x).state **逐字节相同**',
    sameBytes(second.state, first.state),
    '字节相同=' + sameBytes(second.state, first.state) + '｜stationName='
      + parcelsOf(stateOf(first)).map((p) => p.stationName).join('>'));
  report('E2【(a)】幂等（零改写）：第二次返回**同一个对象**（早返回；不是"复制一份内容相同的"）',
    second.state === first.state,
    '引用同一对象=' + (second.state === first.state) + '｜同一 parcels 数组='
      + (stateOf(second).parcels === stateOf(first).parcels));
  const third = migrate.up(stateOf(second));
  report('E3 第三次仍是不动点（幂等不是"恰好第二次才对"）',
    third.state === first.state && sameBytes(third.state, first.state),
    '第三次同一对象=' + (third.state === first.state));
}

// ── F. (e) 产出仍合法；畸形输入不许静默通过 ────────────────────────────────
function auditValidate(tables) {
  const samples = [
    ['全字段 V1 库', fullV1Store(tables)],
    ['字段缺失的旧库', legacyV1Store(tables)],
    ['全别名库', storeOf(1, tables.aliases.map((item, i) => parcelOf('a' + i, item.alias)))],
    ['0 改写库', storeOf(1, [parcelOf('p1', tables.names[0])])],
    ['空记录库', storeOf(1, [])]
  ];
  const bad = samples.filter((pair) => {
    const result = migrate.up(pair[1]);
    return !result || result.ok !== true || migrate.validate(stateOf(result)).ok !== true;
  });
  report('F1【(e)】每个合法样本的产出都通过 validate（升级会**落盘** ⇒ 不合法就等于设备上写不回去）',
    bad.length === 0 && samples.length > 0,
    (samples.length - bad.length) + '/' + samples.length + ' 个样本产出合法' + joinReadings(bad.map((p) => p[0])));
  const orphan = storeOf(1, [parcelOf('p1', tables.aliases[tables.aliases.length - 1].alias)], []);
  const orphanBefore = migrate.validateBody(orphan);
  const orphanAfter = migrate.validate(stateOf(migrate.up(orphan)));
  report('F2【(e)】畸形（件引用了**不存在的档案**）：up 后**仍然不合法**且原因码原样 —— 不许被洗白成合法库',
    orphanBefore.ok === false && orphanAfter.ok === false && orphanAfter.reason === orphanBefore.reason,
    'up 前=' + orphanBefore.reason + ' ⇒ up 后=' + orphanAfter.reason);
  const malformed = [['null', null], ['数字', 12345], ['对象', { weird: true }], ['undefined', undefined], ['空串', '']];
  const survived = malformed.filter((pair) => {
    try {
      const after = parcelsOf(stateOf(migrate.up(storeOf(1, [parcelOf('p1', pair[1])]))))[0];
      if (!after || !hasKey(after, 'stationName') || after.stationName !== pair[1]) return false;
      return migrate.validate(storeOf(migrate.SCHEMA_VERSION, [after])).ok === false;
    } catch (err) { return false; }
  });
  report('F3【(e)】畸形 stationName（' + malformed.map((p) => p[0]).join('/') + '）：不抛异常、值一字不动、仍判不合法',
    survived.length === malformed.length,
    survived.length + '/' + malformed.length + ' 条形态按契约处理（非字符串/空串 ⇒ 原样返回，⛔ 不写空串）');
  const created = migrate.up(null);
  const tooNew = migrate.up({ schemaVersion: migrate.SCHEMA_VERSION + 1, customers: [], parcels: [] });
  report('F4【(e)】两个边界方向：null ⇒ 建当前版本空库；版本更高的库 ⇒ 拒绝（不许覆盖新数据）',
    created.ok === true && stateOf(created).schemaVersion === migrate.SCHEMA_VERSION
      && Array.isArray(stateOf(created).parcels) && migrate.validate(stateOf(created)).ok === true
      && tooNew.ok === false && tooNew.reason === 'STORE_VERSION_MISMATCH',
    'up(null) → v' + stateOf(created).schemaVersion + ' 空库（合法=' + migrate.validate(stateOf(created)).ok + '）｜v'
      + (migrate.SCHEMA_VERSION + 1) + ' → ' + (tooNew.ok === false ? tooNew.reason : '被接受了（危险）'));
  const core = stripComments(readSource(STORAGE_CORE_SRC));
  const atBody = core.indexOf('validateBody(raw)');
  const atUp = core.indexOf('migrate.up(raw)');
  report('F5【(e)】畸形闸在**上游**：storage-core 读盘时"先 validateBody 再 up"（缺了它，F2/F3 就没有生产意义）',
    atBody >= 0 && atUp >= 0 && atBody < atUp,
    'storage-core.js 去注释后：validateBody(raw)@' + atBody + ' < migrate.up(raw)@' + atUp);
}

// ── G. (f) 两个输入方向：V1 必须改、已是 V2 的一个字节都不动 ─────────────────────
function auditVersions(tables) {
  const v1 = fullV1Store(tables);
  const v1Result = migrate.up(v1);
  const v1Diff = diffParcels(v1.parcels, parcelsOf(stateOf(v1Result)));
  report('G1【(f)】V1 方向：别名件**必须真的被改**（这是本次迁移存在的理由）+ 版本号升到当前',
    v1Diff.renamed.length === 2 && stateOf(v1Result).schemaVersion === migrate.SCHEMA_VERSION
      && v1Result.stationRenamed === 2,
    '归一 ' + v1Diff.renamed.join('、') + '｜读数=' + v1Result.stationRenamed + '｜schemaVersion '
      + v1.schemaVersion + '→' + stateOf(v1Result).schemaVersion);
  const v2 = storeOf(migrate.SCHEMA_VERSION, [parcelOf('p1', tables.names[0])]);
  const v2Result = migrate.up(v2);
  report('G2【(f)】V2 方向：**同一个对象**原样返回（零改写 —— 早返回，不重建库）',
    v2Result.ok === true && v2Result.state === v2,
    '引用同一对象=' + (v2Result.state === v2) + '｜读数 stationRenamed=' + String(v2Result.stationRenamed));
  const v2Ours = storeOf(migrate.SCHEMA_VERSION, [parcelOf('p1', tables.aliases[tables.aliases.length - 1].alias),
    parcelOf('p2', '自建点-东门'), parcelOf('p3', tables.names[3] + '8号柜')]);
  const after2 = stateOf(migrate.up(v2Ours));
  report('G3【(f)】V2 方向：**逐字节相同**（别名形态不许二次归一、包含形态不许被动、自建名不许被动）',
    sameBytes(after2, v2Ours) && v2Ours.parcels.length > 0,
    '逐字节相同=' + sameBytes(after2, v2Ours) + '｜' + pairNames(v2Ours.parcels, parcelsOf(after2)));
}

// ── H. 不可逆但安全：down 对 up 的产物拒绝（不造反向步骤 = 不猜）────────────────
function auditDown(tables) {
  const migrated = stateOf(migrate.up(fullV1Store(tables)));
  let back = {};
  try { back = migrate.down(migrated) || {}; }
  catch (err) { back = { ok: false, reason: '抛异常：' + String((err && err.message) || err) }; }
  report('H1 不可逆的处置正确：down(V2 产物) **拒绝**（"本来就叫新名"与"从旧名改来的"在同一字段上不可区分）',
    back.ok === false && back.reason === 'STORE_VERSION_MISMATCH',
    'down(up(V1).state) → ' + (back.ok === false ? back.reason : '被接受了（会猜坏数据）'));
}

function printSummary() {
  console.log('── 汇总：判据 ' + (tally.pass + tally.fail) + ' 条，通过 ' + tally.pass + '，失败 ' + tally.fail
    + '（被审对象 utils/migrate.js sha256:' + sha256(readSource(MIGRATE_SRC)) + '）');
  console.log(tally.fail === 0 ? '迁移纪律成立：退出码 0。'
    : '迁移纪律**不成立**：退出码 1 —— 上面每一条 [FAIL] 都是结论，不是脚本坏了。');
}

function runAudit() {
  const migrateRaw = readSource(MIGRATE_SRC);
  tally.pass = 0;
  tally.fail = 0;
  console.log('迁移审计（TD-003）· utils/migrate.js sha256:' + sha256(migrateRaw)
    + ' · SCHEMA_VERSION=' + migrate.SCHEMA_VERSION);
  const tables = extractStationTables();
  if (tables.names.length === 0 || tables.aliases.length === 0) {
    // 抽不出真值 = 这条审计**没跑**，绝不许长得像通过（教训卡《空集上的全绿》）
    report('A0 抽不出站点表（正式名 ' + tables.names.length + ' 条 / 别名 ' + tables.aliases.length + ' 条）',
      false, '真值缺失 ⇒ 后面所有判据都无法成立，直接判红');
    printSummary();
    return { pass: tally.pass, fail: tally.fail };
  }
  auditTruth(tables, migrateRaw);
  auditSweep(tables);
  auditOnlyStationName(tables);
  auditNoExtraKeys(tables);
  auditCounts(tables);
  auditIdempotence(tables);
  auditValidate(tables);
  auditVersions(tables);
  auditDown(tables);
  printSummary();
  return { pass: tally.pass, fail: tally.fail };
}

if (require.main === module) runAudit();

// ⚠️ 导出的是**取数与比对的原语**（不是判据本身）：`tools/selftest-wave9.js` 用同一份抽表/比对实现。
// 为什么必须共用：抽表正则与 diff 引擎各写两份 = 规则与样例分叉（本项目最贵的一类返工），
// 而且 wave9 一旦与审计脚本的取数分叉，"两边都绿"就不再是同一条判据了。
module.exports = {
  runAudit, extractStationTables, stripComments, diffParcels, maskedBytes, expectedStationName,
  stationBattery, pointNameOf, customerOf, parcelOf, storeOf, fullV1Store, legacyV1Store,
  stateOf, parcelsOf, sameBytes, keySet, hasKey
};
