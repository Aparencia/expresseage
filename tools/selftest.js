'use strict';
/**
 * tools/selftest.js — v4 断言 harness（ENGINEERING §7.2）。
 *
 * 纪律：
 *   - 计数器只在 harness；分节统一 `h.section('§节号 标题', (t) => {...})`，t.check/t.eq/t.throws。
 *   - EXPECTED_ASSERTIONS 完整性闸：实际断言数 ≠ 登记数（少算/多算）都判红，防"空集全绿"。
 *   - 每条断言文字必须带 `§节号`；失败打印期望/实际。
 *   - uncaughtException / unhandledRejection 也打印当前总数并 exit 1（不许静默中断）。
 *   - 汇总行：`断言 N/N；失败 M 项` + `结果：PASS|FAIL`（取数 `node tools/selftest.js | Select-Object -Last 2`）。
 *
 * 其它 selftest-*.js 复用：
 *   const { createHarness } = require('./selftest');
 *   const h = createHarness({ name: 'selftest-cloud' });
 *   h.setExpected(require('./selftest-cloud-cases').EXPECTED_ASSERTIONS);
 *   h.section('§7.3 状态矩阵', (t) => { ... });
 *   h.finish();
 */
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function isPlainEqual(a, b) {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => isPlainEqual(v, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => isPlainEqual(a[k], b[k]));
  }
  return false;
}

function createHarness(options) {
  const opts = options || {};
  const h = {
    name: opts.name || 'selftest',
    expected: typeof opts.expected === 'number' ? opts.expected : null,
    count: 0,
    passed: 0,
    failures: [],
    sections: 0,
    sectionTitle: '',
    finished: false,
    pending: [],
    strict: opts.strict !== false,
  };

  function fail(message, detail) {
    h.failures.push({ section: h.sectionTitle, message, detail });
    console.log('[FAIL] ' + h.sectionTitle + ' · ' + message + (detail ? ' | ' + detail : ''));
  }
  function okMessage(section, message) {
    return (section ? section + ' · ' : '') + message;
  }

  h.setExpected = function setExpected(n) {
    h.expected = n;
    return h;
  };

  h.section = function section(title, fn) {
    h.sections += 1;
    h.sectionTitle = title;
    const api = {
      check(cond, message) {
        h.count += 1;
        if (cond) h.passed += 1;
        else fail(message, '条件为假');
        return !!cond;
      },
      eq(actual, expected, message) {
        h.count += 1;
        if (isPlainEqual(actual, expected)) {
          h.passed += 1;
          return true;
        }
        fail(message, '期望=' + JSON.stringify(expected) + ' 实际=' + JSON.stringify(actual));
        return false;
      },
      neq(actual, expected, message) {
        h.count += 1;
        if (!isPlainEqual(actual, expected)) {
          h.passed += 1;
          return true;
        }
        fail(message, '不应等于 ' + JSON.stringify(expected));
        return false;
      },
      throws(fn, matcher, message) {
        h.count += 1;
        let thrown = null;
        try {
          fn();
        } catch (e) {
          thrown = e;
        }
        if (!thrown) {
          fail(message, '未抛出异常');
          return false;
        }
        const detail = 'code=' + (thrown.code || thrown.message || String(thrown));
        const match = matcher === undefined ? true
          : matcher instanceof RegExp ? matcher.test(detail) || matcher.test(String(thrown.message))
            : typeof matcher === 'function' ? matcher(thrown)
              : detail.indexOf(String(matcher)) !== -1;
        if (match) {
          h.passed += 1;
          return true;
        }
        fail(message, '异常不匹配 ' + String(matcher) + '（' + detail + '）');
        return false;
      },
      notEmpty(arr, message) {
        const n = arr && typeof arr.length === 'number' ? arr.length : 0;
        return api.check(n > 0, okMessage(title, message) + '（样本 ' + n + ' 条，空集不得判绿）');
      },
    };
    try {
      const r = fn(api);
      if (r && typeof r.then === 'function') h.pending.push(r);
    } catch (e) {
      h.count += 1;
      h.failures.push({ section: title, message: '分节执行异常', detail: e.message });
      console.log('[FAIL] ' + title + ' · 分节执行异常 | ' + e.message);
    }
    return h;
  };

  h.finish = function finish() {
    const done = () => {
      if (h.finished) return 0;
      h.finished = true;
      console.log('------------------------------------------------------------');
      if (h.expected === null) {
        console.log('[FAIL] ' + h.name + ' · 未登记 EXPECTED_ASSERTIONS 完整性闸（读数作废）');
        h.failures.push({ section: 'harness', message: 'EXPECTED_ASSERTIONS 未登记' });
      } else if (h.count !== h.expected) {
        console.log('[FAIL] ' + h.name + ' · 断言数 ' + h.count + ' ≠ EXPECTED_ASSERTIONS ' + h.expected
          + '（少算/多算都判红）');
        h.failures.push({ section: 'harness', message: '断言数不符 ' + h.count + '/' + h.expected });
      }
      console.log(h.name + '：断言 ' + h.passed + '/' + h.count + '；失败 ' + h.failures.length + ' 项');
      if (h.failures.length === 0 && h.expected !== null && h.count === h.expected) {
        console.log('结果：PASS');
        return 0;
      }
      console.log('结果：FAIL');
      return 1;
    };
    if (h.pending.length === 0) {
      process.exitCode = done();
      return process.exitCode;
    }
    return Promise.all(h.pending.map((p) => p.catch((e) => {
      h.count += 1;
      h.failures.push({ section: h.sectionTitle, message: '异步分节异常', detail: e.message });
      console.log('[FAIL] ' + h.sectionTitle + ' · 异步分节异常 | ' + e.message);
    }))).then(() => {
      process.exitCode = done();
      return process.exitCode;
    });
  };

  return h;
}

/** 崩溃兜底：保证异常退出前也打印当前读数（count 由运行时闭包提供）。 */
function installCrashGuard(getStats, name) {
  const print = (label, err) => {
    const s = getStats();
    console.log('------------------------------------------------------------');
    console.log('[CRASH] ' + name + ' · ' + label + '：' + (err && err.message ? err.message : String(err)));
    console.log(name + '：断言 ' + s.passed + '/' + s.count + '；失败 ' + (s.failures + 1) + ' 项（含崩溃）');
    console.log('结果：FAIL');
  };
  process.on('uncaughtException', (err) => {
    print('uncaughtException', err);
    process.exit(1);
  });
  process.on('unhandledRejection', (err) => {
    print('unhandledRejection', err);
    process.exit(1);
  });
}

module.exports = { createHarness, installCrashGuard, isPlainEqual, ROOT };

if (require.main === module) {
  // 聚合入口：依次运行全部"已存在"的分域 suite（按 register 形态集成；未落盘/非 register 形态打印 SKIP 不算失败）。
  // 每套 suite 自己打印汇总行（断言 N/N；失败 M 项 + 结果：PASS|FAIL），最后再打印全局汇总。
  const fs = require('fs');
  const SUITES = ['selftest-core', 'selftest-state', 'selftest-recognize', 'selftest-cloud', 'selftest-ai',
    'selftest-bind', 'selftest-bind-cloud', 'selftest-order', 'selftest-order-flow', 'selftest-order-lifecycle',
    'selftest-order-customer', 'selftest-order-partner', 'selftest-order-workbench', 'selftest-order-detail-partner',
    'selftest-partner-customers', 'selftest-partner-orders', 'selftest-partner-pages', 'selftest-partner-stats',
    'selftest-profile', 'selftest-switch', 'selftest-testaccount',
    'selftest-admin', 'selftest-messages', 'selftest-cleanup', 'selftest-admin-pages',
    'selftest-message-pages', 'selftest-privacy-text', 'selftest-deletion'];
  const agg = { count: 0, passed: 0, failures: 0 };
  installCrashGuard(() => ({ count: agg.count, passed: agg.passed, failures: agg.failures }), 'selftest');
  (async () => {
    let failedSuites = 0;
    let ranSuites = 0;
    const skipped = [];
    for (const name of SUITES) {
      const file = path.join(__dirname, name + '.js');
      if (!fs.existsSync(file)) { skipped.push(name); continue; }
      let mod;
      try {
        mod = require(file);
      } catch (e) {
        console.log('[FAIL] ' + name + ' · require 异常 | ' + e.message);
        failedSuites += 1;
        ranSuites += 1;
        continue;
      }
      if (typeof mod.register !== 'function' || typeof mod.EXPECTED_ASSERTIONS !== 'number') {
        console.log('[SKIP] ' + name + '：非 register 聚合形态（可独立运行 node tools/' + name + '.js）');
        skipped.push(name);
        continue;
      }
      const h = createHarness({ name });
      h.setExpected(mod.EXPECTED_ASSERTIONS);
      mod.register(h);
      const ret = h.finish();
      const code = ret && typeof ret.then === 'function' ? await ret : ret;
      agg.count += h.count;
      agg.passed += h.passed;
      agg.failures += h.failures.length;
      ranSuites += 1;
      if (code !== 0) failedSuites += 1;
    }
    console.log('------------------------------------------------------------');
    console.log('selftest：运行 ' + ranSuites + ' 套；失败 ' + failedSuites + ' 套；SKIP ' + skipped.length
      + ' 套（' + (skipped.join('、') || '无') + '）');
    console.log('结果：' + (failedSuites === 0 ? 'PASS' : 'FAIL'));
    process.exitCode = failedSuites === 0 ? 0 : 1;
  })();
}
