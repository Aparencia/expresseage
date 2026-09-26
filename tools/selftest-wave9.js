// tools/selftest-wave9.js · §29 迁移审计（TD-003：V1→V2 站点名归一）
//
// 为什么再开一个测试文件（wave5~wave8 之后）：wave7 已 592 行，且本节的性质与既有各节不同 —— 它**不是**再钉
// 几个手写样本，而是把 `tools/audit-migrate.js` 那份"外部真值驱动"的判据**接进总计数器**，让每次 `check.ps1`
// 都跑一遍。
// ⚠️ 节号说明：本节编号取 **§29**（**§28 已由 `tools/selftest-wave8.js`「单条保存入口」占用**，2026-09-26 批 3）。
//
// ⚠️ 与 `tools/selftest.js` §1 的分工（⛔ 不是抄一遍）：§1 钉的是**回归样本**（一条旧名、一条自建名）；
//    本节钉的是**全表扫描与属性**：每个别名 / 每个正式名 / 读数如实 / 键集合 / 掩码整库字节 / V2 方向零改写 /
//    畸形不许洗白 / "判定只能来自站点表"（静态）。
//
// ⚠️ 取数实现**必须复用** `tools/audit-migrate.js` 导出的原语（抽表正则、diff 引擎、掩码序列化、fixture）：
//    两边各写一份 = 规则与样例分叉（本项目最贵的一类返工），而且一旦分叉，"审计绿 + 断言绿"就不再是同一条判据。
//    `audit-migrate.js` 用 `require.main === module` 守卫"被 require 时不自动跑" ⇒ 这里 require 它没有副作用
//    （§29⑪ 那条接线钉把守卫本身钉住）。
'use strict';

const path = require('path');
const fs = require('fs');

const migrate = require('../utils/migrate.js');
const stations = require('../utils/stations.js');
const audit = require('./audit-migrate.js');

/** 某个库 up 之后第一条记录的站点名（取值不抛：null = up 没给出记录 ⇒ 让断言红，不让进程崩） */
function firstStationNameAfter(store) {
  const parcel = audit.parcelsOf(audit.stateOf(migrate.up(store)))[0];
  return parcel ? parcel.stationName : null;
}

/** 只喂一个站点名，取回它的归一结果 */
function nameAfter(name) {
  try {
    return firstStationNameAfter(audit.storeOf(1, [audit.parcelOf('p1', name)]));
  } catch (err) {
    return '<抛异常：' + String((err && err.message) || err) + '>';
  }
}

/** 全表扫描：返回没归一到"该别名指向的正式名"的那些别名 */
function aliasMisses(tables) {
  return tables.aliases.filter((item) => nameAfter(item.alias) !== audit.pointNameOf(tables, item.point));
}

/** 三个样本（0 条 / 1 条 / 多条改写）的 stationRenamed 读数 */
function renameReadings(tables) {
  const lastAlias = tables.aliases[tables.aliases.length - 1].alias;
  const zero = audit.storeOf(1, [audit.parcelOf('p1', tables.names[0]), audit.parcelOf('p2', '自建点-东门')]);
  const one = audit.storeOf(1, [audit.parcelOf('p1', tables.names[1]), audit.parcelOf('p2', lastAlias)]);
  const many = audit.storeOf(1, tables.aliases.map((item, i) => audit.parcelOf('a' + i, item.alias)));
  return [migrate.up(zero).stationRenamed, migrate.up(one).stationRenamed, migrate.up(many).stationRenamed];
}

/**
 * §29 迁移审计 —— TD-003 的机器闸
 * @param {{eq:function, check:function}} kit 判定器由调用方注入 ⇒ **同一个计数器**
 */
function runMigrateAuditSection(kit) {
  const eq = kit.eq;
  const check = kit.check;
  console.log('§29 迁移审计（TD-003：V1→V2 站点名归一 —— 外部真值 / 全表扫描 / 属性 / 静态）');
  const tables = audit.extractStationTables();

  // ① 真值：抽不到表就说明本节"没跑"，绝不许长得像通过（《空集上的全绿》）
  eq('§29① 站点表真值取自声明处，且与导出的 listStationPoints() 逐字 + 顺序一致（正式名非空 / 别名非空）',
    [audit.sameBytes(tables.names, stations.listStationPoints()), tables.names.length > 0, tables.aliases.length > 0].join('|'),
    'true|true|true');

  // ② (d) 判定来自站点表：**全表扫描**每个别名（§1 只钉了 `西苑邮政` 一条）
  const misses = aliasMisses(tables);
  eq('§29② 每个别名都归一到它指向的正式名（读数 = 漏网数|别名总数>0）',
    [misses.length, tables.aliases.length > 0].join('|'), '0|true');

  // ③ (b) 只动 stationName：键集合全等 + 其他字段 0 变动 + 无缺键
  const before = audit.fullV1Store(tables);
  const after = audit.stateOf(migrate.up(before));
  const diff = audit.diffParcels(before.parcels, audit.parcelsOf(after));
  const keyDiff = before.parcels.filter((parcel, i) => audit.keySet(parcel) !== audit.keySet(audit.parcelsOf(after)[i]));
  eq('§29③ 只动 stationName：键集合逐条全等 + 其他字段变动 0 处 + 缺键 0 处（字段齐全的样本 ⇒ 补齐不掺进来）',
    [keyDiff.length, diff.otherChanged.length, diff.removed.length].join('|'), '0|0|0');

  // ④ 掩码整库字节比：除 schemaVersion 与 stationName 外一个字节都不许变
  eq('§29④ 掩码整库字节比：除 schemaVersion 与 stationName 外整库逐字节相同',
    String(audit.maskedBytes(before) === audit.maskedBytes(after)), 'true');

  // ⑤ (c) 读数如实：0 条 / 1 条 / 多条三种都 == 实际差异条数
  const readings = renameReadings(tables);
  eq('§29⑤ stationRenamed 读数如实（0 条 / 1 条 / 全别名库），期望值由站点表条数派生',
    readings.join(','), ['0', '1', String(tables.aliases.length)].join(','));

  // ⑥ (a) 幂等：深度相同 + 第二次**引用同一对象**（零改写；只比内容会让"删掉早返回"溜过去）
  const first = migrate.up(audit.fullV1Store(tables));
  const second = migrate.up(audit.stateOf(first));
  eq('§29⑥ 幂等：up(up(x).state).state 与 up(x).state 逐字节相同 + 第二次返回同一个对象',
    [audit.sameBytes(second.state, first.state), second.state === first.state].join('|'), 'true|true');

  // ⑦ (f) V2 方向：同一个对象 + 逐字节不动 + 别名形态不许被二次归一
  const v2 = audit.storeOf(migrate.SCHEMA_VERSION, [
    audit.parcelOf('p1', tables.aliases[tables.aliases.length - 1].alias),
    audit.parcelOf('p2', '自建点-东门')
  ]);
  const v2Result = migrate.up(v2);
  eq('§29⑦ 已是 V2 的库一个字节都不动（同一对象 / 逐字节 / 别名形态未被二次归一）',
    [v2Result.state === v2, audit.sameBytes(audit.stateOf(v2Result), v2),
      firstStationNameAfter(v2) === v2.parcels[0].stationName].join('|'),
    'true|true|true');

  // ⑧ (e) 畸形不许静默通过：件引用了不存在的档案 ⇒ up 后原因码必须原样
  const orphan = audit.storeOf(1, [audit.parcelOf('p1', tables.aliases[tables.aliases.length - 1].alias)], []);
  const beforeReason = migrate.validateBody(orphan).reason;
  const afterReason = migrate.validate(audit.stateOf(migrate.up(orphan))).reason;
  eq('§29⑧ 畸形输入不许被洗白：件引用不存在的档案 ⇒ up 前后原因码相同',
    [beforeReason, afterReason].join('>'), 'PARCEL_CUSTOMER_MISSING>PARCEL_CUSTOMER_MISSING');

  // ⑨【静态】判定只能来自站点表：去注释后的迁移源码里不许出现任何站点名字面量
  const migrateCode = audit.stripComments(fs.readFileSync(path.join(__dirname, '..', 'utils', 'migrate.js'), 'utf8'));
  const literals = tables.names.concat(tables.aliases.map((a) => a.alias));
  eq('§29⑨【静态】去注释后 utils/migrate.js 里站点名字面量 0 处（"不写死对照表"从宣称变成可机检）',
    String(literals.filter((name) => name && migrateCode.indexOf(name) >= 0).length), '0');

  // ⑩ 不可逆但安全：不造反向步骤
  const back = migrate.down(audit.stateOf(first));
  eq('§29⑩ 不可逆的处置正确：down(V2 产物) 拒绝（"本来就叫新名"与"改过来的"在同一字段上不可区分）',
    back.ok === false ? back.reason : '被接受了', 'STORE_VERSION_MISMATCH');

  // ⑪ 接线钉：本节 require 了审计脚本 ⇒ 那个脚本必须有"被 require 时不自动跑"的守卫，
  //    否则跑一次自测就会多打 33 行审计输出、并把进程退出码改掉（假红/假绿的入口）
  const auditSrc = fs.readFileSync(path.join(__dirname, 'audit-migrate.js'), 'utf8');
  check('§29⑪（接线钉）audit-migrate.js 保留了 `require.main === module` 守卫且导出 runAudit'
    + '（本节 require 它，守卫没了就会污染 selftest 的输出与退出码）',
    /if \(require\.main === module\) runAudit\(\);/.test(auditSrc)
      && typeof audit.runAudit === 'function' && require.main !== module,
    '守卫在位 + 导出 runAudit');

  // ⑫ (d) 的另一半：站点表**不认**的名字必须原样（表说"不认"，up 就不许把它改成任何东西 ——
  //    这条与①③互补："命不中 ⇒ 写空串"这类改动只有它抓得住）
  const selfBuilt = ['自建点-东门', '东门菜鸟驿站', '老图书馆后门', '校内代收点'];
  const notInTable = selfBuilt.filter((name) => stations.matchBuiltinStation(name).ok === false);
  const keptSelf = selfBuilt.filter((name) => nameAfter(name) === name);
  eq('§29⑫ 站点表**不认**的自建名原样留下（⛔ 绝不写空串；先证明这 4 个名字确实不在表里）',
    [notInTable.length === selfBuilt.length, keptSelf.length].join('|'), 'true|4');

  // ⑬【核心等价式】把"判定来自站点表"写成逐条等式：up 的结果 == 表说的结果（别名 + 正式名 + 自建 + 空串 + 拼接）
  const probes = audit.stationBattery(tables);
  const mismatched = probes.filter((name) => nameAfter(name) !== audit.expectedStationName(name));
  eq('§29⑬ up 的判定 ≡ 站点表的判定（' + probes.length + ' 条探针：别名/正式名/自建/空串/拼接，含 ambiguous 与 contains）',
    [mismatched.length, probes.length > 0].join('|'), '0|true');
}

module.exports = { runMigrateAuditSection };
