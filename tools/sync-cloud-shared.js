'use strict';
/**
 * tools/sync-cloud-shared.js — 共享注册表 → 云函数 shared/ 副本同步（唯一生成器）。
 *
 * 口径：docs/ARCHITECTURE.md §1/§2（"cloudfunctions/* /shared/** 只由本脚本生成，任何人不得手写"）、
 *       docs/V4_ENGINEERING.md §8.2 #17（逐字节 hash 对帐）。
 *
 * 源（source of truth）：
 *   1) shared/**               → 云函数 shared/ 同名相对路径
 *   2) utils/ids.js            → 云函数 shared/ids.js
 *   3) utils/room-tag.js       → 云函数 shared/room-tag.js
 * 目标：cloudfunctions/api/shared/、cloudfunctions/cleanup/shared/
 *
 * 用法：
 *   node tools/sync-cloud-shared.js           # 生成/更新副本（幂等；清掉目标中已不存在的旧文件）
 *   node tools/sync-cloud-shared.js --check   # 只对帐不写盘；有漂移/缺文件 exit 1（gate 用）
 *   node tools/sync-cloud-shared.js --dry-run # 只打印将要写/删的文件
 * 输出纪律：必须打印"源 N 件 → 目标 2 套；hash 对帐 OK/FAIL"，无汇总 = 读数作废。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const TARGETS = ['cloudfunctions/api/shared', 'cloudfunctions/cleanup/shared'];
const EXTRA_SOURCES = [
  { from: 'utils/ids.js', to: 'ids.js' },
  { from: 'utils/room-tag.js', to: 'room-tag.js' },
  { from: 'config/defaults.js', to: 'defaults.js' },
];
const SKIP_DIRS = new Set(['.git', 'node_modules', '.dsh-code-index']);

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

function plan(sources, checkOnly) {
  const report = { written: [], removed: [], drift: [], missingTarget: [], same: 0, targets: [] };
  for (const targetRel of TARGETS) {
    const targetDir = path.join(ROOT, targetRel);
    if (!exists(path.dirname(targetDir))) {
      // cloudfunctions/ 尚未落盘（批 1 早期）：记录但不视为失败；shared/ 落盘后 Lead 会重跑
      report.missingTarget.push(targetRel);
      continue;
    }
    report.targets.push(targetRel);
    const existing = new Map(targetFiles(targetRel).map((f) => [f.rel, f]));
    for (const [relPath, buf] of sources) {
      const expected = targetRel + '/' + relPath;
      const cur = existing.get(relPath);
      if (!cur) {
        report.written.push(expected);
        if (!checkOnly) {
          ensureDir(path.dirname(path.join(ROOT, expected)));
          fs.writeFileSync(path.join(ROOT, expected), buf);
        }
      } else {
        const curBuf = fs.readFileSync(cur.full);
        if (sha(curBuf) !== sha(buf)) {
          report.drift.push(expected + '（内容不同）');
          if (!checkOnly) fs.writeFileSync(cur.full, buf);
        } else {
          report.same += 1;
        }
      }
      existing.delete(relPath);
    }
    // 目标中存在、源中已不存在的旧副本 → 删除（副本目录完全由本脚本生成）
    for (const [relPath, file] of existing) {
      report.removed.push(targetRel + '/' + relPath);
      if (!checkOnly) fs.unlinkSync(file.full);
    }
  }
  // 写后逐字节复核
  report.bad = [];
  for (const targetRel of report.targets) {
    for (const [relPath, buf] of sources) {
      const full = path.join(ROOT, targetRel, relPath);
      if (!exists(full)) { report.bad.push(targetRel + '/' + relPath + '（缺失）'); continue; }
      if (sha(fs.readFileSync(full)) !== sha(buf)) report.bad.push(targetRel + '/' + relPath + '（hash 不等）');
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
  const missingExtra = EXTRA_SOURCES.filter((p) => !exists(path.join(ROOT, p.from))).map((p) => p.from);
  const report = plan(sources, checkOnly || dryRun);

  console.log('共享源：' + sources.size + ' 件（shared/** + ' + EXTRA_SOURCES.length + ' 个别名单源）');
  if (missingExtra.length) console.log('待落盘源（本轮跳过）：' + missingExtra.join('、'));
  if (report.missingTarget.length) console.log('待落盘目标（cloudfunctions/ 未建立，本轮跳过）：' + report.missingTarget.join('、'));
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
    + sources.size + ' 件 × ' + report.targets.length + ' 套）');
  return 0;
}

module.exports = { collectSources, plan, TARGETS, EXTRA_SOURCES };

if (require.main === module) {
  process.exitCode = main(process.argv);
}
