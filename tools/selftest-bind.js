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
 *   §6    分享绑定卡纯件（只带兼职编号/零昵称头像宿舍尾号）+ 绑定页预览零头像、云端 message 原样展示（静态扫描）
 *   §6    分享绑定卡 path 单一来源：全页面层零自拼，客户页/我的页都只调 parts/share-card 纯件
 *   §6.2  换绑一体化（D28/AC-C-68）：一次确认 release→create、失败单步恢复、零双重绑定（纯件 + 页面接线静态）
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
const shareCard = require(path.join(ROOT, 'pages/profile/parts/share-card.js'));
const rebind = require(path.join(ROOT, 'utils/rebind.js'));
const previewCache = require(path.join(ROOT, 'utils/preview-cache.js'));
const autoQuery = require(path.join(ROOT, 'pkg-customer/pages/bind/parts/auto-query.js'));
const avatarUtil = require(path.join(ROOT, 'utils/avatar.js'));

const EXPECTED_ASSERTIONS = 169;

// 异步用例：microtask 全清（client.call → transport → normalizeResult 都是 promise 链）
function flushAsync() {
  return new Promise((resolve) => setImmediate(resolve));
}

// 注入时钟/调度（不 mock 全局 setTimeout；防抖窗口可精确推进到 299/300ms）
function createFakeClock(start) {
  let current = typeof start === 'number' ? start : 1000000;
  const jobs = [];
  let nextId = 1;
  return {
    now() {
      return current;
    },
    schedule(fn, ms) {
      const job = { id: nextId, at: current + ms, fn: fn };
      nextId += 1;
      jobs.push(job);
      return job.id;
    },
    cancel(id) {
      const index = jobs.findIndex((job) => job.id === id);
      if (index >= 0) {
        jobs.splice(index, 1);
      }
    },
    advance(ms) {
      current += ms;
      const due = jobs.filter((job) => job.at <= current).sort((a, b) => a.at - b.at);
      due.forEach((job) => {
        const index = jobs.indexOf(job);
        if (index >= 0) {
          jobs.splice(index, 1);
        }
        job.fn();
      });
      return due.length;
    }
  };
}

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

  // ---------------------------------------------------------------- §6 分享卡 + 绑定页隐私
  h.section('§6 分享绑定卡只带编号、绑定页预览零头像与原样错误（纯件 + 静态）', (t) => {
    const profileJs = fs.readFileSync(path.join(ROOT, 'pages/profile/index.js'), 'utf8');
    const profileWxml = fs.readFileSync(path.join(ROOT, 'pages/profile/index.wxml'), 'utf8');
    const bindJs = fs.readFileSync(path.join(ROOT, 'pkg-customer/pages/bind/index.js'), 'utf8');
    const bindWxml = fs.readFileSync(path.join(ROOT, 'pkg-customer/pages/bind/index.wxml'), 'utf8');
    const card = {
      partnerNo: 'P-7K2-M9X',
      partnerNoDisplay: 'P-7K2-M9X',
      displayName: '张同学',
      avatarFileId: 'cloud://test-env.0000/avatar.png',
      dormKey: 'A-1-101',
      phoneTail: '4321'
    };

    // 纯件：兼职 + 非切换会话 + 有编号 → 绑定卡只带编号
    t.eq(typeof shareCard.buildShareMessage, 'function', 'share-card 纯件导出 buildShareMessage');
    t.check(noThrow(() => shareCard.buildShareMessage()), '缺省入参不抛错（回通用分享）');
    const generic = shareCard.buildShareMessage();
    t.eq(generic.path, '/pages/role/index', '缺省入参回通用首页分享');
    const bindMsg = shareCard.buildShareMessage({ isCustomer: false, viewSession: false, partnerCard: card });
    t.eq(bindMsg.path, '/pages/role/index?bind=' + encodeURIComponent(card.partnerNo),
      '兼职分享 path 只带编号（/pages/role/index?bind=<编号>）');
    t.check(bindMsg.path.split('?').length === 2 && bindMsg.path.split('&').length === 1,
      'path 只有一个 bind 查询参数，无其它信息');
    t.check([card.displayName, card.avatarFileId, card.dormKey, card.phoneTail]
      .every((value) => JSON.stringify(bindMsg).indexOf(value) === -1),
      '分享卡 payload 零昵称/头像/宿舍/尾号');
    t.check(bindMsg.title.indexOf('兼职编号') !== -1, '绑定卡标题点明"凭兼职编号找我下单"');
    t.check(!/(昵称|头像|宿舍|尾号)/.test(bindMsg.title), '绑定卡标题不含昵称/头像/宿舍/尾号字样');
    const otherMsg = shareCard.buildShareMessage({
      isCustomer: false, viewSession: false, partnerCard: { partnerNo: 'P-QQQ-1111', displayName: '另一位' }
    });
    t.check(otherMsg.title === bindMsg.title && otherMsg.path !== bindMsg.path,
      '标题固定不随被分享人变化；path 随编号变化（编号是唯一变量）');
    const encoded = shareCard.buildShareMessage({
      isCustomer: false, viewSession: false, partnerCard: { partnerNo: 'P 7K2/M9X' }
    });
    t.eq(encoded.path, '/pages/role/index?bind=P%207K2%2FM9X', 'encodeURIComponent 生效（特殊字符转义，防 path 注入）');

    // 顾客 / 切换会话 / 无编号 → 通用分享（不泄露目标账号编号）
    const customerMsg = shareCard.buildShareMessage({ isCustomer: true, viewSession: false, partnerCard: card });
    const sessionMsg = shareCard.buildShareMessage({ isCustomer: false, viewSession: true, partnerCard: card });
    const noCardMsg = shareCard.buildShareMessage({ isCustomer: false, viewSession: false, partnerCard: null });
    const blankMsg = shareCard.buildShareMessage({
      isCustomer: false, viewSession: false, partnerCard: { partnerNo: '   ' }
    });
    t.check([customerMsg, sessionMsg, noCardMsg, blankMsg]
      .every((msg) => msg.path === generic.path && msg.title === generic.title),
      '顾客/切换会话/无编号 → 通用分享（path 与标题都回通用）');
    t.check(generic.title !== bindMsg.title && generic.title.length > 0, '通用分享标题与绑定卡不同（不会误导顾客）');

    // 静态：bind 预览不回头像（绑定前）；同一扫描口径在"我的"页命中，证明判据有牙
    t.check(bindWxml.length > 0 && !/avatar/i.test(bindWxml), 'bind 预览页 wxml 零头像渲染（绑定前不回头像）');
    t.check(/avatar/i.test(profileWxml), '扫描判据有牙：我的页 wxml 命中 avatar');

    // 静态：分享纯件被页面生产调用（防"新导出无生产调用"），页面不再自拼 path
    t.check(/require\(['"]\.\/parts\/share-card['"]\)/.test(profileJs), '我的页 require 分享纯件');
    t.check(/onShareAppMessage\(\)\s*\{[\s\S]{0,240}?shareCard\.buildShareMessage\(\{[\s\S]{0,200}?partnerCard: this\.data\.partnerCard/
      .test(profileJs), 'onShareAppMessage 调纯件并传 {isCustomer, viewSession, partnerCard}');
    t.check(profileJs.indexOf('/pages/role/index?bind=') === -1, '页面不再自拼绑定分享 path（判据只在纯件）');

    // 静态：bind 页错误原样展示 + 前缀提示取 message + 编号判据只经 utils/ids
    t.check((bindJs.match(/\(err && err\.message\)/g) || []).length >= 2,
      'bind 页查询/提交失败都原样展示云端 message（catch err.message）');
    t.check(/prefixHint\([^)]*\)\.message/.test(bindJs),
      '前缀提示取 ids.prefixHint(...).message（不把 {reason,message} 对象塞 data）');
    t.check(/ids\.normalizeInput\(/.test(bindJs) && /ids\.prefixHint\(/.test(bindJs), '编号归一/前缀判据只经 utils/ids');

    // 静态：页面层零七状态字面量（复用 check #21 口径，反例证明有牙）
    const statuses = ['SUBMITTED', 'ACCEPTED', 'PICKED', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'EXCEPTION'];
    const scanStatus = (src) => statuses.filter((st) => new RegExp("['\"]" + st + "['\"]").test(src));
    t.eq(scanStatus(bindJs).length, 0, 'bind 页零七状态字面量（复用 check #21 页面层扫描口径）');
    t.eq(scanStatus("var x = 'SUBMITTED';").length, 1, '同一扫描口径对反例命中 1（判据有牙）');

    // 静态：READONLY 写控件禁用 + 提交事件层再挡
    t.check(/onConfirm\(\)\s*\{[\s\S]{0,80}?this\.data\.readonly/.test(bindJs),
      'READONLY：提交前事件层再挡（不靠按钮 disabled 兜底）');
    t.check(bindWxml.indexOf('disabled="{{readonly}}"') !== -1, 'READONLY：确认绑定按钮 disabled（写控件禁用）');
  });

  // ---------------------------------------------------------------- §6 分享 path 单一来源
  h.section('§6 分享绑定卡 path 单一来源（全页面层扫描 + 客户页接纯件）', (t) => {
    // 绑定卡分享 path 只有两种写法：字面量 /pages/role/index?bind=… 或纯件里的 route.ROLE_PAGE + '?bind='
    const SHARE_BIND_PATH_RE = /\/pages\/role\/index\?bind=|\bROLE_PAGE\s*\+\s*['"]\?bind=['"]/;
    // D36：卡片构造单源迁到 utils/share/index.js（页面层只转发）；扫描范围=页面层 + 卡片纯件
    const ALLOWED = 'utils/share/index.js';
    const scanFiles = [];
    ['pages', 'pkg-customer', 'pkg-partner', 'utils/share'].forEach((dir) => {
      walkJs(dir).forEach((full) => {
        scanFiles.push({
          rel: path.relative(ROOT, full).split(path.sep).join('/'),
          text: fs.readFileSync(full, 'utf8')
        });
      });
    });
    const hits = scanFiles
      .filter((item) => item.rel !== ALLOWED && SHARE_BIND_PATH_RE.test(item.text))
      .map((item) => item.rel);
    t.check(scanFiles.length >= 30 && hits.length === 0,
      '全页面层分享 path 零自拼（扫描 ' + scanFiles.length + ' 个 js，命中 ' + hits.length + '；唯一允许 ' + ALLOWED + '）');
    t.eq(SHARE_BIND_PATH_RE.test("return { path: '/pages/role/index?bind=' + no };") ? 1 : 0, 1,
      '反例命中 1（同一扫描口径有牙，不靠空集全绿）');
    const allowedFile = scanFiles.filter((item) => item.rel === ALLOWED)[0];
    t.check(!!allowedFile && SHARE_BIND_PATH_RE.test(allowedFile.text), '白名单文件确实构造分享 path（白名单不是空集）');

    // 客户页接纯件：require + 生产调用 + 零自拼 + 切换会话不可分享
    const customersJs = fs.readFileSync(path.join(ROOT, 'pages/partner/customers/index.js'), 'utf8');
    const customersWxml = fs.readFileSync(path.join(ROOT, 'pages/partner/customers/index.wxml'), 'utf8');
    t.check(/require\(['"]\.\.\/\.\.\/profile\/parts\/share-card['"]\)/.test(customersJs),
      '客户页 require 分享纯件（相对路径 ../../profile/parts/share-card）');
    t.check(/onShareAppMessage\(\)\s*\{[\s\S]{0,160}?shareCard\.buildShareMessage\(\{[\s\S]{0,200}?partnerCard: \{ partnerNo: this\.data\.partnerNo/
      .test(customersJs), '客户页 onShareAppMessage 调纯件并传 {isCustomer:false, session, partnerNo}');
    t.check(customersJs.indexOf("'/pages/role/index?bind='") === -1, '客户页零 path 自拼（不复制第二份口径）');
    t.check(/open-type="share"/.test(customersWxml) && /wx:if="\{\{!session\}\}"/.test(customersWxml),
      '客户页分享按钮仅在非切换会话渲染（切换会话不能分享）');
  });

  // ---------------------------------------------------------------- §6.2 换绑一体化（D28）
  h.section('§6.2 换绑一体化（D28/AC-C-68）：一次确认 release→create、失败单步恢复、零双重绑定', async (t) => {
    const REBOUND_OK = { binding: { roomTag: 'A' }, partnerPublic: { displayName: '张同学', partnerNo: 'P-7K2-M9X' } };
    // deps 注入 release/create：记录调用与载荷，可按需让某一步失败（不 mock wx）
    function depsOf(calls, fail) {
      const plan = fail || {};
      return {
        mode: 'rebind',
        hasCurrentBinding: true,
        partnerNo: 'P-7K2-M9X',
        release(payload) {
          calls.push({ action: 'release', payload: payload });
          return plan.release
            ? Promise.reject(new Error('网络不稳定，请稍后再试'))
            : Promise.resolve({ binding: {} });
        },
        create(payload) {
          calls.push({ action: 'create', payload: payload });
          return plan.create
            ? Promise.reject(new Error('这位兼职暂停接单'))
            : Promise.resolve(REBOUND_OK);
        }
      };
    }

    // 编排计划：只有 rebind+有当前绑定 才先 release
    t.eq(rebind.planRebind({ mode: 'rebind', hasCurrentBinding: true }).steps, ['release', 'create'],
      'D28 计划：rebind+有绑定 → release→create');
    t.eq(rebind.planRebind({ mode: 'rebind', hasCurrentBinding: false }).steps, ['create'],
      'rebind 页无当前绑定 → 只 create（按普通绑定，不空跑 release）');
    t.eq(rebind.planRebind({ mode: 'create', hasCurrentBinding: true }).steps, ['create'],
      '普通绑定入口 → 只 create（即使本地残留绑定也不先解绑）');
    t.eq(rebind.planRebind().steps, ['create'], '缺省入参 → 只 create（纯件不抛错）');

    // 成功路径：一次确认内顺序 release→create
    const successCalls = [];
    const rebound = await rebind.runRebind(depsOf(successCalls));
    t.eq(successCalls.map((call) => call.action), ['release', 'create'], '一次确认内顺序执行 release→create');
    t.eq(successCalls[0].payload, { reason: 'CUSTOMER_INITIATED' },
      '顾客侧解绑原因=CUSTOMER_INITIATED（服务端对 CUSTOMER 唯一接受的枚举）');
    t.eq(successCalls[1].payload, { partnerNo: 'P-7K2-M9X' }, 'create 只带新兼职编号（不夹带解绑信息）');
    t.eq([rebound.status, rebound.released, rebound.created, rebound.binding.roomTag,
      rebound.partnerPublic.displayName], ['REBOUND', true, true, 'A', '张同学'],
    '两步都成功 → REBOUND + 新 roomTag/公开资料（AC-C-68 换绑完成）');
    t.eq(rebind.successToast(rebound, '张同学'), '已换绑为「张同学」', '成功 toast 逐字「已换绑为「{displayName}」」');
    t.eq(rebind.resultText(rebound, '张同学'), '已换绑为「张同学」，同寝室标识已分配：',
      '成功卡片文案用换绑语义（不写死「已绑定」）');

    // release 失败：原绑定不变、零 create 调用、文案「换绑未开始」
    const releaseFailCalls = [];
    const releaseFailed = await rebind.runRebind(depsOf(releaseFailCalls, { release: true }));
    t.eq(releaseFailCalls.filter((call) => call.action === 'create').length, 0,
      'release 失败 → create 调用数=0（不可能出现半完成/双重绑定）');
    t.eq([releaseFailed.status, releaseFailed.released, releaseFailed.created],
      ['RELEASE_FAILED', false, false], 'release 失败：released=false（原绑定保持不变）');
    t.eq(rebind.recoveryCopy(releaseFailed), '换绑未开始：网络不稳定，请稍后再试。',
      'release 失败文案逐字「换绑未开始：{reason}。」');
    t.eq([rebind.retryAction(releaseFailed), rebind.retryDeps(releaseFailed)],
      ['release', { released: false }], 'release 失败 → 重新走 release→create（不是只补 create）');
    t.check(rebind.failureView(releaseFailed).retryVisible === false,
      'release 失败不显示「重新绑定」（原绑定还在，再点确认即可）');

    // release 成功 + create 失败：保留 released、文案 AC-C-68、重试只补 create
    const createFailCalls = [];
    const createFailed = await rebind.runRebind(depsOf(createFailCalls, { create: true }));
    t.eq(createFailCalls.map((call) => call.action), ['release', 'create'], '先 release 成功才会走到 create');
    t.eq([createFailed.status, createFailed.released, createFailed.created],
      ['CREATE_FAILED', true, false], 'create 失败：保留 released=true 供单步恢复');
    t.eq(rebind.recoveryCopy(createFailed),
      '已解除旧绑定，但绑定新兼职未完成：这位兼职暂停接单。可以重试绑定，或稍后再试。',
      'create 失败文案逐字「已解除旧绑定，但绑定新兼职未完成：{reason}。」+ 下一步');
    t.eq(rebind.retryAction(createFailed), 'create', 'create 失败 → 重试动作只补 create');
    const failView = rebind.failureView(createFailed);
    t.check(failView.retryVisible === true && failView.retryLabel === '重新绑定',
      'create 失败 → 展示「重新绑定」单步重试按钮');
    const plainFailCalls = [];
    const plainFail = await rebind.runRebind(Object.assign(depsOf(plainFailCalls, { create: true }),
      { hasCurrentBinding: false }));
    t.eq(rebind.recoveryCopy(plainFail), '绑定未完成：这位兼职暂停接单。可以重试绑定，或稍后再试。',
      '普通绑定失败不说「已解除旧绑定」（无旧绑定可说，说真话）');
    t.check(rebind.failureView(plainFail).retryTitle === '绑定未完成',
      '普通绑定失败的重试卡标题=「绑定未完成」（与换绑失败区分）');

    // 失败恢复全链路：release 只调用 1 次，绝不二次 release
    const recoverCalls = [];
    let createAttempts = 0;
    const flaky = {
      mode: 'rebind',
      hasCurrentBinding: true,
      partnerNo: 'P-7K2-M9X',
      release() {
        recoverCalls.push('release');
        return Promise.resolve({ binding: {} });
      },
      create() {
        recoverCalls.push('create');
        createAttempts += 1;
        return createAttempts === 1
          ? Promise.reject(new Error('网络不稳定'))
          : Promise.resolve(REBOUND_OK);
      }
    };
    const firstTry = await rebind.runRebind(flaky);
    const recovered = await rebind.runRebind(Object.assign({}, flaky, { released: firstTry.released }));
    t.eq(recoverCalls, ['release', 'create', 'create'],
      '失败恢复：release 总调用数=1，恢复只补 create（不产生双重绑定）');
    t.eq([firstTry.released, recovered.status, recovered.released], [true, 'REBOUND', true],
      '补 create 成功后按换绑收官（released 态延续，成功后无需再重试）');
    t.eq(rebind.retryAction(recovered), 'none', '成功后 retryAction=none');

    // 换绑页无绑定 / 普通绑定：只 create，不冒充「已换绑」
    const plainCalls = [];
    const plainDeps = Object.assign(depsOf(plainCalls), { hasCurrentBinding: false });
    const plain = await rebind.runRebind(plainDeps);
    t.eq(plainCalls.map((call) => call.action), ['create'], '换绑页无当前绑定 → 只 create（不空跑 release）');
    t.eq([plain.status, plain.released, rebind.successToast(plain, '张同学')], ['BOUND', false, '已绑定'],
      '普通绑定成功 → BOUND + 沿用「已绑定」toast（不冒充已换绑）');
    const broken = await rebind.runRebind({ mode: 'rebind', hasCurrentBinding: false });
    t.eq([broken.status, rebind.retryAction(broken)], ['CREATE_FAILED', 'create'],
      '依赖缺失不抛未捕获异常（归一为可重试的单步失败）');

    // 文案逐字（AC-C-68 / UX §6.2）+ 服务端句尾句号归一
    t.eq(rebind.confirmContent(), '换绑后这位兼职看不到你的新订单，历史订单仍保留。确定换绑？',
      '一次确认弹窗文案逐字（UX §6.2）');
    t.eq([rebind.successCopy('张同学'), rebind.successCopy('')], ['已换绑为「张同学」', '已换绑'],
      '成功文案缺昵称时不拼空书名号');
    const rebindLabels = rebind.labelsOf({ mode: 'rebind' });
    const createLabels = rebind.labelsOf({ mode: 'create' });
    t.eq([rebindLabels.confirm, rebindLabels.previewTitle, rebindLabels.resultTitle, createLabels.confirm],
      ['确认换绑', '确认换绑到这位兼职？', '换绑成功', '确认绑定'],
      'rebind/create 按钮与卡片标题分开（rebind 显式「换绑」语义）');
    t.eq(rebind.recoveryCopy({
      status: 'RELEASE_FAILED',
      error: new Error('你还有进行中的订单，完成或取消后才能换绑/解绑。')
    }), '换绑未开始：你还有进行中的订单，完成或取消后才能换绑/解绑。',
    '服务端句尾句号归一（不出现「。。」）');

    // 静态：页面接纯件、不再只 create、零业务常量、wxml 矛盾文案已删、失败重试按钮接线
    const bindJs = fs.readFileSync(path.join(ROOT, 'pkg-customer/pages/bind/index.js'), 'utf8');
    const bindWxml = fs.readFileSync(path.join(ROOT, 'pkg-customer/pages/bind/index.wxml'), 'utf8');
    const rebindSrc = fs.readFileSync(path.join(ROOT, 'utils/rebind.js'), 'utf8');
    t.check(/require\(['"]\.\.\/\.\.\/\.\.\/utils\/rebind['"]\)/.test(bindJs),
      'bind 页接 utils/rebind 纯件（编排不在页面）');
    t.check(/rebind\.planRebind\(/.test(bindJs) && /rebind\.runRebind\(/.test(bindJs)
      && /rebind\.failureView\(/.test(bindJs), '页面只弹窗/展示：计划、编排、失败呈现都取纯件');
    t.check(/bindApi\.release\(/.test(bindJs), '换绑实际调用 bindApi.release（旧实现只 create → 换绑不可用）');
    t.check(!/CUSTOMER_INITIATED/.test(bindJs) && !/rebind\.STEP/.test(bindJs),
      '解绑原因/步骤枚举只留 utils/rebind（页面零业务常量）');
    t.check(!/\bwx\./.test(rebindSrc), 'utils/rebind 零 wx（纯件可单测）');
    t.check(bindWxml.indexOf('解绑或换绑请到') === -1 && /labels\.confirm/.test(bindWxml),
      'wxml 删掉「解绑或换绑请到我的页操作」矛盾文案，确认按钮走换绑语义');
    t.check(/onRetryBind/.test(bindWxml) && /\{\{retryLabel\}\}/.test(bindWxml),
      'wxml 失败态「重新绑定」按钮接线（onRetryBind + retryLabel）');
    t.notEmpty(successCalls, '§6.2 换绑样本非空');
  });

  // ---------------------------------------------------------------- §3.6 P1-2 绑定页自动查询
  h.section('§3.6 P1-2 绑定页自动查询（预览缓存去双请求 / 300ms 去抖 / 同编号失败不自动重试）', async (t) => {
    const PREVIEW = {
      partnerNo: 'P7K2M9X',
      displayName: '张同学',
      status: 'ACTIVE',
      acceptingOrders: true,
      services: [{ code: 'PICKUP', enabled: true }],
      zones: ['东苑'],
      avatarFileId: 'cloud://env/avatars/customer/x.jpg'
    };
    const T0 = 1000000;

    // ---- 纯件：预览缓存（角色页 remember → 绑定页 take；TTL/有界/不含头像）
    t.eq(previewCache.canonicalOf('p-7k2 m9x'), 'P7K2M9X', '缓存键归一：小写/空格/斜杠 → canonical 兼职编号');
    t.eq(previewCache.canonicalOf('C-ABCD-2345'), '', '反例：顾客编号不进预览缓存');
    t.eq(previewCache.canonicalOf('P-ABC'), '', '反例：不完整编号不进预览缓存');
    t.check(previewCache.take('P-7K2-M9X', T0) === null, '未 remember 时 take 未命中（不猜、不造预览）');
    t.check(previewCache.remember('P-7K2-M9X', PREVIEW, T0) === true, '角色页预览成功 → remember 一次');
    const cached = previewCache.take('p-7k2 m9x', T0 + 1);
    t.check(cached !== null && cached.displayName === '张同学' && Array.isArray(cached.zones),
      'take 命中：归一键也能取到（绑定页落地 0 请求出预览）');
    t.check(cached !== null && cached.avatarFileId === undefined,
      '缓存只带绑定前公开字段：头像 fileId 不进入预览缓存（CONTRACT §5.3/D19）');
    t.check(previewCache.take('P-7K2-M9X', T0 + 2) === null, 'take 取后即失效（一次落地只用一次）');
    previewCache.remember('P-7K2-M9X', PREVIEW, T0);
    t.check(previewCache.take('P-7K2-M9X', T0 + 30001) === null, '超过 30s TTL 的预览不再命中（TTL=30000ms）');
    t.check(previewCache.remember('C-ABCD-2345', PREVIEW, T0) === false, 'remember 拒收非兼职编号（不污染缓存键）');
    const many = ['AAAA22', 'BBBB33', 'CCCC44', 'DDDD55', 'EEEE66', 'FFFF77', 'GGGG88', 'HHHH99', 'JJJK22'];
    many.forEach((body, index) => previewCache.remember('P' + body, { partnerNo: 'P' + body }, T0 + index));
    t.check(previewCache.take('P-AAAA-22', T0) === null && previewCache.take('P-JJJK-22', T0) !== null,
      '缓存条目有界（最多 8 条，最旧被淘汰：不无限增长）');

    // ---- 自动查询状态机（本区内联 transport 替身 + 注入时钟/调度；不碰全局 api/client，避免跨节干扰）
    const calls = [];
    const answers = {};
    function fakeTransport(partnerNo) {
      calls.push(partnerNo);
      const answer = answers[partnerNo];
      if (answer instanceof Error) {
        return Promise.reject(answer);
      }
      return Promise.resolve(answer === undefined
        ? { partnerNo: partnerNo, displayName: '张同学', services: [], zones: [] }
        : answer);
    }
    const clock = createFakeClock();
    const previews = [];
    const failures = [];
    const ctl = autoQuery.create({
      query(partnerNo) {
        return fakeTransport(partnerNo);
      },
      now: clock.now,
      schedule: clock.schedule,
      cancel: clock.cancel,
      onPreview(data, meta) {
        previews.push({ data: data, meta: meta });
      },
      onError(err) {
        failures.push(err);
      }
    });
    t.eq(autoQuery.DEBOUNCE_MS, 300, '防抖窗口 = 300ms（UX §3.6 单源常量）');
    t.eq(ctl.onInput('P-7K2-M9X'), 'debounce', '合法完整编号 → 安排自动查询（0 次「查询」点击）');
    t.eq(calls.length, 0, '防抖期内不发请求（连续输入不轰炸服务端/不白扣每日限额）');
    clock.advance(299);
    await flushAsync();
    t.eq(calls.length, 0, '299ms 时仍未请求');
    clock.advance(1);
    await flushAsync();
    t.eq(calls.length, 1, '300ms 到期自动查询 1 次并出预览');
    t.eq(calls[0], 'P7K2M9X', '自动查询传 canonical 兼职编号（归一口径同 utils/ids）');
    t.check(previews.length === 1 && previews[0].meta.cached === false, '预览回调 1 次且标记来自网络');
    t.eq(ctl.onInput('P-7K2-M9X'), 'done', '同编号已出预览后不再重复自动查');

    // 连续输入只查最后一次（去抖）
    clock.advance(1000);
    const beforeDebounce = calls.length;
    ctl.onInput('P-QQQ-222');
    ctl.onInput('P-RRR-333');
    clock.advance(300);
    await flushAsync();
    t.eq(calls.length - beforeDebounce, 1, '连续输入 A→B 只发 1 次请求（去抖）');
    t.eq(calls[calls.length - 1], 'PRRR333', '只查最后输入的编号');

    // 失败：同编号不自动重试、不循环；手动「查询」是唯一恢复口
    answers['PFAKE22'] = new Error('网络开小差了');
    clock.advance(1000);
    const beforeFail = calls.length;
    ctl.onInput('P-FAKE-22');
    clock.advance(300);
    await flushAsync();
    t.eq(calls.length - beforeFail, 1, '失败路径只请求 1 次');
    t.check(failures.length === 1 && failures[0].message === '网络开小差了',
      '失败如实回调（页面原样展示 message，不吞错）');
    t.eq(ctl.onInput('P-FAKE-22'), 'failed', '同编号失败后不再自动查（防自动循环）');
    clock.advance(2000);
    await flushAsync();
    t.eq(calls.length - beforeFail, 1, '等待再久也不会自动重试同编号');
    answers['PFAKE22'] = { partnerNo: 'PFAKE22', displayName: '恢复成功', services: [], zones: [] };
    const recovered = await ctl.onManual('P-FAKE-22');
    t.check(calls.length - beforeFail === 2 && recovered !== null && recovered.displayName === '恢复成功',
      '手动「查询」立即重试同编号并成功（失败保留手动重试）');

    // 不合法编号：零请求（不浪费每日 5 次限额）
    const beforeInvalid = calls.length;
    t.eq(ctl.onInput('P-ABC'), 'none', '不完整编号不自动查');
    t.eq(ctl.onInput('C-ABCD-2345'), 'none', '顾客编号不自动查（绑定只认兼职编号）');
    clock.advance(1000);
    await flushAsync();
    t.eq(calls.length, beforeInvalid, '不合法编号零请求');

    // 落地去双请求：角色页 1 次 getPublic → remember；绑定页 take 缓存 → 0 请求（整次落地 =1）
    const beforeLanding = calls.length;
    answers['P7K2M9X'] = { partnerNo: 'P7K2M9X', displayName: '张同学', services: [], zones: [] };
    await fakeTransport('P-7K2-M9X'); // 角色页卡片落地那次
    previewCache.remember('P-7K2-M9X', answers['P7K2M9X'], clock.now()); // 成功回调 remember 一次
    const landingPreviews = [];
    const landing = autoQuery.create({
      query(partnerNo) {
        return fakeTransport(partnerNo);
      },
      now: clock.now,
      schedule: clock.schedule,
      cancel: clock.cancel,
      onPreview(data, meta) {
        landingPreviews.push(meta);
      }
    });
    t.eq(landing.onInput('P-7K2-M9X'), 'cache', '绑定页落地命中角色页预览缓存（0 次「查询」点击）');
    await flushAsync();
    t.eq(calls.length - beforeLanding, 1,
      '卡片落地整次 getPublic 调用 =1（角色页 1 次 + 绑定页缓存 0 次，去双请求）');
    t.check(landingPreviews.length === 1 && landingPreviews[0].cached === true,
      '缓存命中预览标记 cached=true（页面可区分缓存/网络来源）');

    // dispose：离开页面取消防抖任务，不发幽灵请求
    const beforeDispose = calls.length;
    const disposed = autoQuery.create({
      query(partnerNo) {
        return fakeTransport(partnerNo);
      },
      now: clock.now,
      schedule: clock.schedule,
      cancel: clock.cancel
    });
    disposed.onInput('P-DSPT-22');
    disposed.dispose();
    clock.advance(300);
    await flushAsync();
    t.eq(calls.length, beforeDispose, 'dispose 后防抖任务取消（离开页面不再发请求）');

    // ---- 静态接线：role 页只 remember 一次；bind 页只经纯件（自动查询/去抖/失败策略不在页面）
    const roleJs = fs.readFileSync(path.join(ROOT, 'pages/role/index.js'), 'utf8');
    const bindJs = fs.readFileSync(path.join(ROOT, 'pkg-customer/pages/bind/index.js'), 'utf8');
    const bindWxml = fs.readFileSync(path.join(ROOT, 'pkg-customer/pages/bind/index.wxml'), 'utf8');
    const autoQuerySrc = fs.readFileSync(path.join(ROOT, 'pkg-customer/pages/bind/parts/auto-query.js'), 'utf8');
    t.check(/require\(['"]\.\.\/\.\.\/utils\/preview-cache['"]\)/.test(roleJs)
      && (roleJs.match(/previewCache\.remember\(/g) || []).length === 1,
    '角色页仅「成功回调 remember 一次」（不重复缓存、不改卡片渲染）');
    t.check(/require\(['"]\.\/parts\/auto-query['"]\)/.test(bindJs) && /autoQuery\.create\(/.test(bindJs),
      '绑定页接 auto-query 纯件（自动查询/去抖/失败策略不在页面）');
    t.check(/if \(parsed\.ok\) this\._auto\.onInput\(/.test(bindJs),
      '带合法编号落地即自动查（0 次点击出预览的接线点）');
    t.check(/onInput\(e\)[\s\S]{0,200}?this\._auto\.onInput\(/.test(bindJs),
      '输入合法编号走自动查询（300ms 去抖在纯件内）');
    t.check(/onQuery\(\)[\s\S]{0,320}?this\._auto\.onManual\(/.test(bindJs),
      '手动「查询」= onManual（自动查询失败后的唯一重试口）');
    t.check(/onUnload\(\)[\s\S]{0,120}?this\._auto\.dispose\(/.test(bindJs),
      '离开页面 dispose 定时器（不发幽灵请求）');
    t.check(!/\bwx\./.test(autoQuerySrc) && autoQuerySrc.indexOf("pick(opts, 'schedule'") !== -1,
      'auto-query 纯件零 wx（时钟/调度可注入，可脱离小程序单测）');
    t.check(bindWxml.indexOf('bindtap="onQuery"') !== -1, 'wxml 保留手动「查询」按钮（自动查询失败可重试）');
    t.check(bindJs.indexOf('preview-cache') === -1, '绑定页不直接碰预览缓存（唯一出口是 auto-query 纯件）');
  });

  // ---------------------------------------------------------------- §8 头像组件兜底（无头像/加载失败不裂图）
  h.section('§8 头像组件：有头像显示头像、无头像/加载失败显示对方昵称首字', (t) => {
    const named = avatarUtil.viewModelOf('', '小王');
    t.check(named.isDefault === true && named.fileId === '' && named.initial === '小',
      '§8-1 无头像 → 默认头像 + 对方昵称首字（不裂图、不空白）');
    t.check(typeof named.backgroundColor === 'string' && typeof named.color === 'string',
      '§8-2 默认头像底色/字色由 utils/avatar 色板下发（同昵称稳定同色）');
    const withFile = avatarUtil.viewModelOf('cloud://env/avatars/partner/x.jpg', '小王');
    t.check(withFile.isDefault === false && withFile.fileId === 'cloud://env/avatars/partner/x.jpg',
      '§8-3 有头像 → 直出云文件 ID（微信客户端直连存储，不经临时 URL）');
    const unnamed = avatarUtil.viewModelOf('', '');
    t.check(unnamed.isDefault === true && unnamed.initial === '?',
      '§8-4 昵称也为空 → 兜底首字（不把空串当头像）');
    const componentJs = fs.readFileSync(path.join(ROOT, 'components/avatar-view/index.js'), 'utf8');
    const componentWxml = fs.readFileSync(path.join(ROOT, 'components/avatar-view/index.wxml'), 'utf8');
    const componentWxss = fs.readFileSync(path.join(ROOT, 'components/avatar-view/index.wxss'), 'utf8');
    t.check(componentWxml.indexOf('binderror="onError"') !== -1 && componentWxml.indexOf('view.initial') !== -1,
      '§8-5 组件图片加载失败回默认头像首字（不出现裂图/空白）');
    t.check(componentJs.indexOf('_failedFileId') !== -1 && componentJs.indexOf("UNNAMED_INITIAL = '代'") !== -1,
      '§8-6 失败标记按 fileId 记忆（换头像会重试，坏地址不反复请求）+ 无昵称兜底字');
    t.check(/font-size:\s*1em/.test(componentWxss) && componentWxss.indexOf('44%') === -1,
      '§8-7 默认头像首字字号不再用百分比（44% 会相对页面 30rpx 缩成 13rpx）');
    t.check(componentWxml.indexOf('size * 0.42') !== -1,
      '§8-8 默认头像首字随 size 等比缩放（64/96rpx 卡片都可读）');
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
