'use strict';
/**
 * tools/sync-cloud-shared.js — 共享注册表 → 云函数 shared/ 最小子集副本（唯一生成器）。
 *
 * 口径：docs/engineering/V4_ARCHITECTURE.md §1/§2（"cloudfunctions/* /shared/** 只由本脚本生成，任何人不得手写"）、
 *       docs/engineering/V4_ENGINEERING.md §8.2 #17（按 SHARED_MANIFEST 逐目标 hash 对帐）。
 *
 * 源（source of truth）：
 *   1) shared/**               → 云函数 shared/ 同名相对路径
 *   2) utils/ids.js            → 云函数 shared/ids.js
 *   3) utils/room-tag.js       → 云函数 shared/room-tag.js
 *   4) config/defaults.js      → 云函数 shared/defaults.js
 * 目标：cloudfunctions/api/shared/、cloudfunctions/cleanup/shared/
 *
 * 清单唯一源 = SHARED_MANIFEST（本文件导出；门禁 #17 与 selftest-cleanup 同源读取）。
 * 每个目标只同步它的静态 require 闭包，不再全量复制。fail-closed：
 *   - 目标代码闭包 ⊄ 清单（漏同步）→ exit 1，不写盘；
 *   - 清单 ⊄ 目标闭包（陈旧清单）→ exit 1，不写盘；
 *   - 清单引用不存在的源 → exit 1。
 *
 * 用法：
 *   node tools/sync-cloud-shared.js           # 生成/更新副本（幂等；清掉目标中多余的旧文件）
 *   node tools/sync-cloud-shared.js --check   # 只对帐不写盘；有漂移/缺文件/多余 exit 1（gate 用）
 *   node tools/sync-cloud-shared.js --dry-run # 只打印将要写/删的文件
 * 输出纪律：必须打印"清单 N 件次 → 目标 M 套；hash 对帐 OK/FAIL"，无汇总 = 读数作废。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const EXTRA_SOURCES = [
  { from: 'utils/ids.js', to: 'ids.js' },
  { from: 'utils/room-tag.js', to: 'room-tag.js' },
  { from: 'config/defaults.js', to: 'defaults.js' },
];
const SKIP_DIRS = new Set(['.git', 'node_modules', '.dsh-code-index']);

// 清单唯一源：每个云函数实际 require 到的 shared 子集（按静态闭包维护；增删依赖必须同批改这里）。
const SHARED_MANIFEST = [
  {
    dir: 'cloudfunctions/api/shared',
    needed: [
      'actions.js', 'appoint.js', 'audit-actions.js', 'collections.js', 'defaults.js',
      'enums.js', 'error-codes.js', 'error-copy.js', 'gender.js', 'ids.js',
      'order-state.js', 'order-view.js', 'role.js', 'room-tag.js', 'stations.js',
      'validate.js', 'zones.js',
    ],
  },
  {
    dir: 'cloudfunctions/cleanup/shared',
    needed: ['audit-actions.js', 'collections.js', 'defaults.js', 'enums.js', 'stations.js', 'zones.js'],
  },
];

function posix(p) {
  return p.replace(/\\/g, '/');
}
function walk(dir, out) {
  out = out || [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return out;
  }
  for (const ent of entries) {
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      walk(path.join(dir, ent.name), out);
    } else if (ent.isFile()) {
      out.push(path.join(dir, ent.name));
    }
  }
  return out;
}
function sha(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
function rel(full) {
  return posix(path.relative(ROOT, full));
}
function exists(p) {
  try {
    return fs.existsSync(p);
  } catch (e) {
    return false;
  }
}
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

/** 清单项 → 源文件相对路径（shared/** 或三个别名单源）。 */
function sourceRelOf(name) {
  const extra = EXTRA_SOURCES.find((pair) => pair.to === name);
  return extra ? extra.from : 'shared/' + name;
}

/** 收集源清单：{ 'xxx.js': Buffer }（键 = 云函数 shared/ 下的相对路径）。 */
function collectSources() {
  const sources = new Map();
  const sharedDir = path.join(ROOT, 'shared');
  if (exists(sharedDir)) {
    walk(sharedDir, []).forEach((full) => {
      sources.set(posix(path.relative(sharedDir, full)), fs.readFileSync(full));
    });
  }
  EXTRA_SOURCES.forEach((pair) => {
    const full = path.join(ROOT, pair.from);
    if (exists(full)) sources.set(pair.to, fs.readFileSync(full));
  });
  return sources;
}

function targetFiles(targetRel) {
  const dir = path.join(ROOT, targetRel);
  return walk(dir, []).map((full) => ({
    rel: posix(path.relative(dir, full)),
    full,
  }));
}

/** 目标云函数的业务 .js（跳过 shared/ 与 node_modules），用于求 require 闭包。 */
function codeFilesOf(targetRel) {
  const root = path.dirname(path.join(ROOT, targetRel));
  const out = [];
  (function rec(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const ent of entries) {
      if (ent.isDirectory()) {
        if (ent.name === 'shared' || ent.name === 'node_modules') continue;
        rec(path.join(dir, ent.name));
      } else if (ent.isFile() && ent.name.endsWith('.js')) {
        out.push(path.join(dir, ent.name));
      }
    }
  })(root);
  return out;
}

/** 从源码里取出 require 的字面量（单/双引号；忽略模板串与动态表达式）。 */
function requiresOf(src) {
  const specs = [];
  let i = 0;
  while (true) {
    const at = src.indexOf('require(', i);
    if (at < 0) break;
    i = at + 'require('.length;
    let j = i;
    while (j < src.length && /\s/.test(src[j])) j += 1;
    const quote = src[j];
    if (quote !== '\'' && quote !== '"') continue;
    const end = src.indexOf(quote, j + 1);
    if (end < 0) break;
    specs.push(src.slice(j + 1, end));
    i = end + 1;
  }
  return specs;
}

/** 目标云函数对 shared/ 的静态 require 闭包（递归 shared 内互相 require）。 */
function sharedClosureOf(targetRel) {
  const sharedRoot = path.join(ROOT, targetRel);
  const seen = new Set();
  function scan(full) {
    const src = fs.readFileSync(full, 'utf8');
    for (const spec of requiresOf(src)) {
      if (spec.charAt(0) !== '.') continue;
      let resolved = path.resolve(path.dirname(full), spec);
      if (!resolved.endsWith('.js')) resolved += '.js';
      if (resolved.indexOf(sharedRoot + path.sep) !== 0) continue;
      const name = path.basename(resolved);
      if (!seen.has(name) && exists(resolved)) {
        seen.add(name);
        scan(resolved);
      }
    }
  }
  codeFilesOf(targetRel).forEach(scan);
  return Array.from(seen).sort();
}

/** 清单自检：每个已落盘目标必须「闭包 = 清单」；不写盘、fail-closed。 */
function manifestIssues(sources) {
  const issues = [];
  for (const entry of SHARED_MANIFEST) {
    if (!exists(path.join(ROOT, entry.dir))) continue; // cloudfunctions/ 未落盘：跳过
    const needed = new Set(entry.needed);
    entry.needed.forEach((name) => {
      if (!sources.has(name)) issues.push(entry.dir + ' 清单引用不存在的源: ' + sourceRelOf(name));
    });
    const closure = sharedClosureOf(entry.dir);
    closure.filter((name) => !needed.has(name)).forEach((name) => {
      issues.push(entry.dir + ' 闭包未被清单覆盖（漏同步）: ' + name);
    });
    entry.needed.filter((name) => closure.indexOf(name) < 0).forEach((name) => {
      issues.push(entry.dir + ' 清单含闭包未引用项（陈旧清单）: ' + name);
    });
  }
  return issues;
}

function plan(sources, checkOnly) {
  const report = { written: [], removed: [], drift: [], bad: [], missingTarget: [], same: 0, targets: [], expected: 0 };
  for (const entry of SHARED_MANIFEST) {
    const targetRel = entry.dir;
    if (!exists(path.join(ROOT, targetRel))) {
      if (exists(path.dirname(path.join(ROOT, targetRel)))) report.missingTarget.push(targetRel + '（目录缺失）');
      continue;
    }
    report.targets.push(targetRel);
    report.expected += entry.needed.length;
    const existing = new Map(targetFiles(targetRel).map((f) => [f.rel, f]));
    for (const name of entry.needed) {
      const buf = sources.get(name);
      if (!buf) {
        report.bad.push(targetRel + '/' + name + '（源缺失）');
        continue;
      }
      const target = targetRel + '/' + name;
      const cur = existing.get(name);
      if (!cur) {
        report.written.push(target);
        if (!checkOnly) {
          ensureDir(path.dirname(path.join(ROOT, target)));
          fs.writeFileSync(path.join(ROOT, target), buf);
        }
      } else {
        const curBuf = fs.readFileSync(cur.full);
        if (sha(curBuf) !== sha(buf)) {
          report.drift.push(target + '（内容不同）');
          if (!checkOnly) fs.writeFileSync(cur.full, buf);
        } else {
          report.same += 1;
        }
      }
      existing.delete(name);
    }
    // 目标中存在、清单中不需要的旧副本 → 删除（副本目录完全由本脚本生成）
    for (const [relPath, file] of existing) {
      report.removed.push(targetRel + '/' + relPath);
      if (!checkOnly) fs.unlinkSync(file.full);
    }
  }
  // 写后逐字节复核（只核清单项）
  for (const entry of SHARED_MANIFEST) {
    if (report.targets.indexOf(entry.dir) < 0) continue;
    for (const name of entry.needed) {
      const buf = sources.get(name);
      if (!buf) continue;
      const full = path.join(ROOT, entry.dir, name);
      if (!exists(full)) { report.bad.push(entry.dir + '/' + name + '（缺失）'); continue; }
      if (sha(fs.readFileSync(full)) !== sha(buf)) report.bad.push(entry.dir + '/' + name + '（hash 不等）');
    }
  }
  return report;
}

function main(argv) {
  const args = argv.slice(2);
  const checkOnly = args.includes('--check');
  const dryRun = args.includes('--dry-run');
  const sources = collectSources();
  if (sources.size === 0) {
    console.error('sync-cloud-shared: 源为空（shared/** 与 utils/ids.js、utils/room-tag.js 均不存在），生成中止');
    return 1;
  }
  const issues = manifestIssues(sources);
  if (issues.length) {
    issues.forEach((msg) => console.log('  FAIL 清单: ' + msg));
    console.log('同步中止：SHARED_MANIFEST 与 require 闭包不一致（fail-closed，未写盘）');
    return 1;
  }
  const missingExtra = EXTRA_SOURCES.filter((p) => !exists(path.join(ROOT, p.from))).map((p) => p.from);
  const report = plan(sources, checkOnly || dryRun);

  console.log('共享源：' + sources.size + ' 件（shared/** + ' + EXTRA_SOURCES.length + ' 个别名单源）');
  console.log('清单：' + SHARED_MANIFEST.map((entry) => entry.dir + ' ' + entry.needed.length + ' 件').join('、'));
  if (missingExtra.length) console.log('待落盘源（本轮跳过）：' + missingExtra.join('、'));
  if (report.missingTarget.length) console.log('待落盘目标（本轮跳过）：' + report.missingTarget.join('、'));
  console.log('对帐目标：' + (report.targets.length ? report.targets.join('、') : '（无）'));
  if (dryRun) {
    report.written.forEach((f) => console.log('  将写: ' + f));
    report.removed.forEach((f) => console.log('  将删: ' + f));
    console.log('dry-run：将写 ' + report.written.length + ' 件、删 ' + report.removed.length + ' 件、已一致 ' + report.same + ' 件');
    return 0;
  }
  report.written.forEach((f) => console.log('  写入: ' + f));
  report.removed.forEach((f) => console.log('  删除: ' + f));
  if (report.bad.length) {
    report.bad.forEach((f) => console.log('  FAIL hash: ' + f));
    console.log('同步完成：写 ' + report.written.length + ' 件、删 ' + report.removed.length + ' 件；hash 对帐 FAIL（' + report.bad.length + ' 件）');
    return 1;
  }
  console.log('同步完成：写 ' + report.written.length + ' 件、删 ' + report.removed.length + ' 件、已一致 ' + report.same + ' 件；hash 对帐 OK（'
    + report.expected + ' 件次 / ' + report.targets.length + ' 套）');
  return 0;
}

module.exports = {
  SHARED_MANIFEST,
  EXTRA_SOURCES,
  sourceRelOf,
  sharedClosureOf,
  collectSources,
  plan,
};

if (require.main === module) {
  process.exitCode = main(process.argv);
}
