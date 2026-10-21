'use strict';
/**
 * tools/selftest-bind.js — 绑定方向与切换会话客户端侧纯件断言（S13；ENGINEERING §7.2 接入范式）。
 *
 * 覆盖：
 *   §4.2  绑定方向（canInitiateBind 仅 CUSTOMER；业务角色判定）+ bind.* 写标记
 *   §3.1  编号错前缀提示三句同源文案（utils/ids → shared/error-copy.PREFIX_HINT）
 *   §10   切换会话客户端二道闸（READONLY 禁写 / TEST_WRITE 禁 admin.* 与三项写动作 / viewAsEnd 放行）
 *   §5.3  action 写标记、internal 可见性与 13 码→人话映射（客户端侧同一份注册表）
 *   §7.2  请求包络（clientRequestId）、viewTicket 注入、13 码归一、读重试/写不重试（transport 注入，不 mock wx）
 *   §5.2  工作台四档动线排序（取件清单视图零件：S13 排序修正的判别力断言）
 *   §5.3  bind 模块 action 名只出现在 api/（页面层零直拼动作名）静态扫描
 *
 * 纪律：样本非空、先合法基线再反例；不 mock 全局 wx（api/client 用 setTransport 注入替身）；
 *       EXPECTED_ASSERTIONS 与实际断言数精确相等（少算/多算都判红）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const role = require(path.join(ROOT, 'shared/role.js'));
const ids = require(path.join(ROOT, 'utils/ids.js'));
const enums = require(path.join(ROOT, 'shared/enums.js'));
const errorCopy = require(path.join(ROOT, 'shared/error-copy.js'));
const actions = require(path.join(ROOT, 'shared/actions.js'));
const errorCodes = require(path.join(ROOT, 'shared/error-codes.js'));
const modeGuard = require(path.join(ROOT, 'api/mode-guard.js'));
const client = require(path.join(ROOT, 'api/client.js'));
const store = require(path.join(ROOT, 'store/index.js'));
const groupView = require(path.join(ROOT, 'pages/partner/workbench/parts/group-view.js'));

const EXPECTED_ASSERTIONS = 48;

const VIEW_TICKET = 'T'.repeat(enums.TOKEN_LENGTH);
const UI_DIRS = ['pages', 'pkg-customer', 'pkg-partner', 'pkg-admin', 'components'];
const BIND_ACTION_RE = /['"]bind\.[A-Za-z]+['"]/;

function noThrow(fn) {
  try {
    fn();
    return true;
  } catch (err) {
    return false;
  }
}

function errorCodeOf(fn) {
  try {
    fn();
    return '';
  } catch (err) {
    return err && err.code ? err.code : 'UNKNOWN_THROW';
  }
}

// 页面层静态扫描：只读源码字符串，不 require 页面（页面依赖 Page()/wx 全局）
function walkJs(dirRel) {
  const out = [];
  const stack = [path.join(ROOT, dirRel)];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      continue;
    }
    entries.forEach((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.name.endsWith('.js')) {
        out.push(full);
      }
    });
  }
  return out;
}

function register(h) {
  // ---------------------------------------------------------------- §4.2 绑定方向
  h.section('§4.2 绑定方向（只有顾客能发起，兼职端零入口）', (t) => {
    t.check(role.canInitiateBind(role.ROLES.CUSTOMER), '顾客可发起绑定');
    t.check(!role.canInitiateBind(role.ROLES.PARTNER), '兼职端零绑定入口：PARTNER 不得发起');
    t.check(!role.canInitiateBind('') && !role.canInitiateBind('ADMIN'), '未知/后台角色不得发起绑定');
    t.check(role.isBusinessRole(role.ROLES.CUSTOMER) && role.isBusinessRole(role.ROLES.PARTNER)
      && !role.isBusinessRole('DEVELOPER'), '业务角色只有 CUSTOMER/PARTNER，开发者不落业务身份');
    t.eq(actions.ACTION_MAP['bind.create'].write, true, 'bind.create 是写动作');
    t.eq(actions.ACTION_MAP['bind.getCurrent'].write, false, 'bind.getCurrent 是读动作');
    t.eq(actions.ACTION_MAP['bind.release'].write, true, 'bind.release 是写动作');
  });

  // ---------------------------------------------------------------- §3.1 错前缀提示
  h.section('§3.1 编号错前缀提示三句同源（只描述格式、不暴露存在性）', (t) => {
    t.eq(ids.prefixHint('C-ABCD-2345').reason, 'CUSTOMER_PREFIX', 'C 开头提示"这是顾客编号"');
    t.eq(ids.prefixHint('C-ABCD-2345').message, errorCopy.PREFIX_HINT.CUSTOMER_PREFIX,
      '顾客编号前缀提示取自 shared/error-copy 单源');
    t.eq(ids.prefixHint('DEV-01').message, errorCopy.PREFIX_HINT.DEVELOPER_PREFIX,
      '开发者编号前缀提示取自单源');
    t.eq(ids.prefixHint('P-ABC').message, errorCopy.PREFIX_HINT.FORMAT, '兼职编号格式不足时回格式提示');
    const hints = [errorCopy.PREFIX_HINT.CUSTOMER_PREFIX, errorCopy.PREFIX_HINT.DEVELOPER_PREFIX,
      errorCopy.PREFIX_HINT.FORMAT];
    t.check(new Set(hints).size === 3 && hints.every((s) => typeof s === 'string' && s.length > 0),
      '三句提示互不相同且非空（不得三处写同一句）');
  });

  // ---------------------------------------------------------------- §10 切换会话二道闸
  h.section('§10 切换会话客户端二道闸（READONLY 禁写 / TEST_WRITE 禁管理动作）', (t) => {
    const mode = enums.VIEW_MODE;
    store.reset();
    t.check(modeGuard.canRenderWriteButton() === true && modeGuard.isReadonly() === false,
      '无视角上下文：写按钮可渲染、非只读');
    t.check(noThrow(() => modeGuard.assertWritable('order.accept')), '无视角上下文：写动作放行');
    store.setViewContext({
      viewMode: mode.READONLY,
      role: role.ROLES.CUSTOMER,
      targetNo: 'C-ABCD-2345',
      targetDisplayName: '只读目标',
      targetIsTest: false,
      expiresAt: 0
    });
    t.eq(errorCodeOf(() => modeGuard.assertWritable('bind.create')), 'FORBIDDEN', 'READONLY：写动作被客户端二道闸挡住');
    t.check(noThrow(() => modeGuard.assertWritable('order.listPartner')), 'READONLY：读动作照常放行');
    t.check(modeGuard.canRenderWriteButton() === false, 'READONLY：写按钮不渲染');
    t.check(noThrow(() => modeGuard.assertWritable('admin.viewAsEnd')), 'READONLY：退出会话动作必须放行');
    store.setViewContext({
      viewMode: mode.TEST_WRITE,
      role: role.ROLES.CUSTOMER,
      targetNo: 'C-TEST-0001',
      targetDisplayName: '测试账号',
      targetIsTest: true,
      expiresAt: 0
    });
    t.eq(errorCodeOf(() => modeGuard.assertWritable('admin.purgeTestData')), 'FORBIDDEN', 'TEST_WRITE：admin.* 一律禁止');
    t.eq(errorCodeOf(() => modeGuard.assertWritable('partner.activate')), 'FORBIDDEN', 'TEST_WRITE：partner.activate 禁止');
    t.eq(errorCodeOf(() => modeGuard.assertWritable('user.deleteAccount')), 'FORBIDDEN', 'TEST_WRITE：user.deleteAccount 禁止');
    t.eq(errorCodeOf(() => modeGuard.assertWritable('ai.parseParcel')), 'FORBIDDEN', 'TEST_WRITE：ai.parseParcel 禁止（会外呼）');
    t.check(noThrow(() => modeGuard.assertWritable('order.accept')), 'TEST_WRITE：普通写动作放行');
    t.eq(modeGuard.TEST_BANNED_ACTIONS.slice().sort(),
      ['ai.parseParcel', 'partner.activate', 'user.deleteAccount'], 'TEST_WRITE 禁写清单精确三项');
    const banner = modeGuard.sessionBanner();
    t.check(banner !== null && banner.mode === mode.TEST_WRITE && banner.targetIsTest === true
      && banner.readonly === false, '会话黄/蓝条数据：TEST_WRITE 且标记目标为测试账号');
    store.reset();
    t.eq(modeGuard.sessionBanner(), null, '无视角上下文：不渲染会话条');
  });

  // ---------------------------------------------------------------- §5.3 写标记与 13 码
  h.section('§5.3 action 写标记/internal 可见性 + 13 码人话映射', (t) => {
    t.eq(errorCodes.ERROR_CODES.length, 13, '恰好 13 码（客户端只映射这 13 码）');
    t.check(errorCodes.ERROR_CODES.every((code) => !!errorCopy.copyOf(code)), '每码都有同源人话文案');
    t.eq(errorCopy.copyOf('INTERNAL_ERROR'), errorCopy.CODE_COPY.INTERNAL_ERROR, '已登记码直取 CODE_COPY');
    t.check(errorCopy.copyOf('BRAND_NEW_CODE') === errorCopy.UNKNOWN_CODE_COPY
      && errorCopy.UNKNOWN_CODE_COPY.length > 0, '未登记码走兜底文案（不装懂、给下一步）');
    t.check(actions.isWriteAction('order.accept') && !actions.isWriteAction('order.get'),
      '写标记判别力：order.accept 写、order.get 读');
    t.check(actions.isInternalAction('cleanup.files') && !actions.isClientAction('cleanup.files'),
      'cleanup.* 只 internal，不注册给客户端');
  });

  // ---------------------------------------------------------------- §7.2 请求包络（异步）
  h.section('§7.2 请求包络/viewTicket 注入/读重试写不重试（transport 注入替身）', async (t) => {
    const mode = enums.VIEW_MODE;
    store.reset();
    const seen = [];
    const okResult = (data) => ({ ok: true, data: data === undefined ? {} : data, serverTime: Date.now() });
    try {
      client.setTransport((payload) => {
        seen.push(payload);
        return Promise.resolve(okResult({ list: [] }));
      });
      const data = await client.call('order.listPartner', { view: 'workbench' });
      t.eq(seen[0] && seen[0].action, 'order.listPartner', '包络 action 原样透传');
      t.eq(seen[0] && seen[0].data, { view: 'workbench' }, '包络 data 原样透传');
      t.check(/^[A-Za-z0-9_-]{24}$/.test(String(seen[0] && seen[0].clientRequestId)),
        'clientRequestId 24 位 [A-Za-z0-9_-]');
      t.check(Array.isArray(data.list), '成功响应只返回 result.data');

      store.setViewContext({ viewMode: mode.TEST_WRITE, role: role.ROLES.CUSTOMER, targetIsTest: true, viewTicket: VIEW_TICKET });
      await client.call('order.listPartner', {});
      t.eq(seen[seen.length - 1].viewTicket, VIEW_TICKET, '有切换会话时注入 viewTicket 票据');

      client.setTransport(() => Promise.resolve({}));
      let caught = null;
      try {
        await client.call('order.listPartner', {});
      } catch (err) {
        caught = err;
      }
      t.eq(caught && caught.code, 'INTERNAL_ERROR', '返回体缺 ok 布尔 → 归一为 INTERNAL_ERROR');

      client.setTransport(() => Promise.resolve({ ok: false, code: 'CONFLICT' }));
      caught = null;
      try {
        await client.call('order.listPartner', {});
      } catch (err) {
        caught = err;
      }
      t.check(caught !== null && caught.code === 'CONFLICT'
        && caught.message === errorCopy.CODE_COPY.CONFLICT, '失败响应按 13 码取人话文案（不暴露英文码）');

      client.setTransport(() => Promise.resolve({ ok: false, code: 'BRAND_NEW_CODE' }));
      caught = null;
      try {
        await client.call('order.listPartner', {});
      } catch (err) {
        caught = err;
      }
      t.check(caught !== null && caught.message === errorCopy.UNKNOWN_CODE_COPY, '未登记码走兜底文案');

      store.setViewContext({ viewMode: mode.TEST_WRITE, role: role.ROLES.CUSTOMER, targetIsTest: true, viewTicket: VIEW_TICKET });
      client.setTransport(() => Promise.resolve({ ok: false, code: 'VIEW_TICKET_EXPIRED' }));
      caught = null;
      try {
        await client.call('order.listPartner', {});
      } catch (err) {
        caught = err;
      }
      t.check(caught !== null && caught.code === 'VIEW_TICKET_EXPIRED' && store.getViewContext() === null,
        '票据过期清本地视角上下文（回到账号切换）');

      store.reset();
      let attempts = 0;
      client.setTransport(() => {
        attempts += 1;
        if (attempts === 1) {
          return Promise.reject(new client.CallError('DEPENDENCY_FAILED', '读动作首次失败'));
        }
        return Promise.resolve(okResult({ list: [] }));
      });
      const retried = await client.call('order.listPartner', {});
      t.check(attempts === 2 && Array.isArray(retried.list), '读动作自动重试一次后成功（读可重放）');

      attempts = 0;
      client.setTransport(() => {
        attempts += 1;
        return Promise.reject(new client.CallError('DEPENDENCY_FAILED', '写动作失败'));
      });
      caught = null;
      try {
        await client.call('order.accept', { orderNo: 'D4-522A-0001' });
      } catch (err) {
        caught = err;
      }
      t.check(attempts === 1 && caught !== null && caught.code === 'DEPENDENCY_FAILED',
        '写动作不自动重试（重复提交风险由 clientRequestId/服务端幂等兜）');
    } finally {
      client.restoreTransport();
      store.reset();
    }
  });

  // ---------------------------------------------------------------- §5.2 四档动线排序
  h.section('§5.2 工作台四档动线排序（视图零件消费 shared/order-view）', (t) => {
    const orders = [
      { orderNo: 'D4-0004', parcel: { pickupCode: '1234' } },
      { orderNo: 'D4-0003', parcel: { pickupCode: 'A-12' } },
      { orderNo: 'D4-0002', parcel: { pickupCode: '6677', lockerNo: 'B-01' } },
      { orderNo: 'D4-0001', parcel: { codeStatus: 'NEED_CODE' } }
    ];
    const groups = groupView.toGroups({
      list: [{ stationId: 'S1', stationName: '站点一', orders: orders }]
    });
    const rows = (groups[0] && groups[0].rows) || [];
    t.notEmpty(rows, '四档排序样本');
    t.eq(rows.map((row) => row.orderNo), ['D4-0001', 'D4-0002', 'D4-0003', 'D4-0004'],
      '待处理按需查明→快递柜→分段码→其他四档排序（服务端不保证档内顺序）');
    const flat = groupView.toGroups({
      list: [
        { orderNo: 'D4-0009', parcel: { pickupCode: '9876' } },
        { orderNo: 'D4-0008', parcel: { pickupCode: '1234' } },
        { orderNo: 'D4-0007', parcel: { pickupCode: '5555' } }
      ]
    });
    t.eq(((flat[0] && flat[0].rows) || []).map((row) => row.orderNo), ['D4-0008', 'D4-0007', 'D4-0009'],
      '同档按码中数字升序，不用 orderNo 字符串序兜底');
  });

  // ---------------------------------------------------------------- §5.3 静态扫描
  h.section('§5.3 bind 模块 action 名只在 api/ 出现（页面层零直拼动作名）', (t) => {
    const bindModule = fs.readFileSync(path.join(ROOT, 'api/modules/bind.js'), 'utf8');
    t.check(['bind.create', 'bind.release', 'bind.getCurrent'].every((name) => bindModule.indexOf(name) !== -1),
      '基线：api/modules/bind.js 是三个 bind 动作名的调用点');
    let files = [];
    UI_DIRS.forEach((dir) => {
      files = files.concat(walkJs(dir));
    });
    const hits = files.filter((file) => BIND_ACTION_RE.test(fs.readFileSync(file, 'utf8')));
    t.check(files.length >= 20 && hits.length === 0,
      '页面层零直拼动作名（扫描 ' + files.length + ' 个 js，命中 ' + hits.length + '）');
  });
}

module.exports = { EXPECTED_ASSERTIONS, register };

if (require.main === module) {
  const { createHarness, installCrashGuard } = require('./selftest');
  const h = createHarness({ name: 'selftest-bind' });
  installCrashGuard(() => ({ count: h.count, passed: h.passed, failures: h.failures.length }), 'selftest-bind');
  h.setExpected(EXPECTED_ASSERTIONS);
  register(h);
  const ret = h.finish();
  if (ret && typeof ret.then === 'function') ret.then(() => {});
}
