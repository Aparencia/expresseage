'use strict';
/**
 * tools/lib/check-rules-cloud.js — 门禁 #13/#17/#20/#25/#28/#30 的判据实现（批 T5-C 从 tools/check.js 逐字搬移）
 * 口径：docs/engineering/V4_ENGINEERING.md §8.2；PASS 条件/扫描范围/期望值一律与拆分前一致（批 T5-C 纯拆件）。
 * 每个导出 = 一条判据的函数体：返回 null / 问题数组 / { skip }，由 tools/check.js 的 check() 统一装配与打印。
 */
const F = require('./fsutil');
const P = require('./project');
const {
  RELS, exists, raw, rels, js, pagesJs, text, shortList, requireRegistry,
  findActionMap, visibilityOf, hasWriteFlag, valuesOf
} = require('./check-helpers');

/** 门禁 #13 action 注册表（原 tools/check.js 判据体，逐字搬移）。 */
function actionRegistry() {
  const reg = requireRegistry(['shared/actions.js']);
  if (!reg || reg.error) return [reg ? 'shared/actions.js 加载失败: ' + reg.error : 'shared/actions.js 缺失'];
  const map = findActionMap(reg.value);
  if (!map) return ['shared/actions.js 未导出 action 映射（需 {module.action: {visibility,write}}）'];
  const got = new Set(Object.keys(map));
  const out = [];
  Object.keys(P.ACTIONS).filter((a) => !got.has(a)).forEach((a) => out.push('注册表缺 action: ' + a));
  got.forEach((a) => {
    if (!P.ACTIONS[a] && !P.P1_ACTIONS.includes(a)) out.push('注册表多出未登记 action: ' + a);
  });
  got.forEach((a) => {
    if (!P.ACTIONS[a]) return;
    const vis = visibilityOf(map[a]);
    if (!vis) out.push(a + ' 缺 visibility（client/internal）');
    else if (vis !== P.ACTIONS[a].visibility) out.push(a + ' visibility=' + vis + '，应为 ' + P.ACTIONS[a].visibility);
    if (!hasWriteFlag(map[a])) out.push(a + ' 缺 write 布尔标记');
  });
  const clientSet = new Set(Object.keys(P.ACTIONS).filter((a) => P.ACTIONS[a].visibility === 'client'));
  const mods = RELS.filter((r) => /^api\/modules\/.*\.js$/.test(r));
  if (mods.length === 0) out.push('api/modules/*.js 缺失');
  mods.forEach((rel) => {
    const s = text(rel) || '';
    const re = /['"]([a-z][a-zA-Z]+\.[a-zA-Z]+)['"]/g;
    let m;
    while ((m = re.exec(s))) if (!clientSet.has(m[1])) out.push(rel + ': 非 client 动作 ' + m[1]);
  });
  // 页面层不得直接拼 action 字符串（#21 的 action 侧延伸）
  pagesJs().forEach((rel) => {
    const s = text(rel) || '';
    const re = /['"]([a-z][a-zA-Z]+\.[a-zA-Z]+)['"]/g;
    let m;
    while ((m = re.exec(s))) if (P.ACTIONS[m[1]] || P.P1_ACTIONS.includes(m[1])) out.push(rel + ': 页面直拼 action ' + m[1]);
  });
  // P0-5 补偿判据（router 按域懒加载）：静态注册表完整性在构建期兜住——
  // ① client/放行 internal 动作前缀必须是 11 域之一；② 每域 handler 导出集 = 注册表集且都是函数；
  // ③ 请求热路径走 getHandler（首请求只加载首用域），不再 getRouter() 全量构建。
  const routerReg = requireRegistry(['cloudfunctions/api/router.js']);
  if (!routerReg || routerReg.error) {
    out.push(routerReg ? 'cloudfunctions/api/router.js 加载失败: ' + routerReg.error : 'cloudfunctions/api/router.js 缺失');
  } else {
    const r = routerReg.value;
    const domains = Array.isArray(r.DOMAIN_NAMES) ? r.DOMAIN_NAMES : [];
    if (domains.length !== 11) out.push('router DOMAIN_NAMES 应为 11 域，实际 ' + domains.length);
    const problems = typeof r.staticRegistryProblems === 'function' ? r.staticRegistryProblems() : ['router 缺 staticRegistryProblems'];
    problems.forEach((action) => out.push('router 静态注册表缺域: ' + action));
    if (typeof r.loadDomain !== 'function' || typeof r.expectedActionsOf !== 'function') {
      out.push('router 缺 loadDomain/expectedActionsOf（懒加载契约）');
    } else {
      domains.forEach((domain) => {
        let actions = null;
        try { actions = r.loadDomain(domain); } catch (e) { out.push('域加载失败 ' + domain + ': ' + e.message); return; }
        const expected = r.expectedActionsOf(domain);
        const got = Object.keys(actions || {}).sort();
        expected.filter((a) => got.indexOf(a) < 0).forEach((a) => out.push(domain + ' 缺 handler: ' + a));
        got.filter((a) => expected.indexOf(a) < 0).forEach((a) => out.push(domain + ' 多出 handler: ' + a));
        got.forEach((a) => { if (typeof actions[a] !== 'function') out.push(domain + ': handler 不是函数 ' + a); });
      });
    }
    if (typeof r.getHandler !== 'function') out.push('router 缺 getHandler（懒加载入口）');
    else if (typeof r.getHandler('user.bootstrap') !== 'function' || r.getHandler('cleanup.orderTimeout') !== null) {
      out.push('router.getHandler 未按域解析（user.bootstrap 应命中 / cleanup.* 应拒绝）');
    }
    if ((text('cloudfunctions/api/app.js') || '').indexOf('router.getHandler(') === -1) {
      out.push('app.js 请求热路径未走 router.getHandler 懒加载');
    }
  }
  return out.length ? shortList(out, 12) : null;
}

/** 门禁 #17 shared 副本对帐（原 tools/check.js 判据体，逐字搬移）。 */
function sharedCopies() {
  const out = [];
  const src = [];
  RELS.filter((r) => r.startsWith('shared/') && r.endsWith('.js')).forEach((r) => src.push({ rel: r, target: r.slice('shared/'.length) }));
  [['utils/ids.js', 'ids.js'], ['utils/room-tag.js', 'room-tag.js'], ['config/defaults.js', 'defaults.js']].forEach((pair) => {
    if (!exists(pair[0])) out.push('缺失源文件: ' + pair[0]);
    else src.push({ rel: pair[0], target: pair[1] });
  });
  if (src.length === 0) return ['shared 源文件为空（空集不得判绿）'];
  const missingTargets = [];
  for (const cfRoot of ['cloudfunctions/api', 'cloudfunctions/cleanup']) {
    if (!exists(cfRoot)) { missingTargets.push(cfRoot + '/shared（云函数目录待建）'); continue; }
    for (const item of src) {
      const target = cfRoot + '/shared/' + item.target;
      if (!exists(target)) { out.push('缺副本: ' + target); continue; }
      const a = raw(item.rel);
      const b = raw(target);
      if (!a || !b) continue;
      if (F.sha256(a) !== F.sha256(b)) out.push('漂移: ' + target + ' ≠ ' + item.rel);
    }
  }
  const miss = missingTargets.length ? { skip: missingTargets.join('；') + '（目录存在后必须真红）' } : null;
  if (out.length) return shortList(out, 10);
  return miss;
}

/** 门禁 #20 错误码注册表（原 tools/check.js 判据体，逐字搬移）。 */
function errorCodeRegistry() {
  const reg = requireRegistry(['shared/error-codes.js']);
  if (!reg || reg.error) return [reg ? 'shared/error-codes.js 加载失败: ' + reg.error : 'shared/error-codes.js 缺失'];
  const isCode = (s) => /^[A-Z][A-Z_]+$/.test(s);
  const values = Array.from(valuesOf(reg.value)).filter(isCode);
  const set = new Set(values);
  const out = [];
  P.ERROR_CODES.filter((c) => !set.has(c)).forEach((c) => out.push('缺错误码: ' + c));
  values.filter((c) => !P.ERROR_CODES.includes(c)).forEach((c) => out.push('未登记错误码: ' + c));
  P.OLD_ERROR_CODES.forEach((c) => {
    js().filter((r) => !r.startsWith('tools/')).forEach((rel) => {
      if ((text(rel) || '').indexOf("'" + c + "'") !== -1) out.push(rel + ': 旧错误码残留 ' + c);
    });
  });
  const copy = requireRegistry(['shared/error-copy.js']);
  if (!copy || copy.error) out.push(copy ? 'shared/error-copy.js 加载失败: ' + copy.error : '缺失: shared/error-copy.js');
  else {
    const codeCopy = copy.value && copy.value.CODE_COPY;
    if (!codeCopy) out.push('error-copy 缺 CODE_COPY');
    else {
      const keys = new Set(Object.keys(codeCopy));
      P.ERROR_CODES.filter((c) => !keys.has(c)).forEach((c) => out.push('CODE_COPY 缺文案: ' + c));
      Array.from(keys).filter((k) => !P.ERROR_CODES.includes(k)).forEach((k) => out.push('CODE_COPY 多出: ' + k));
    }
  }
  // 代码引用侧：只认"错误码语境"（throw/respond 的 code 赋值）；服务码/取消原因等业务枚举不在本判据范围
  const codeRef = /(?:err|error|resp|response|result|callError|fail\w*)\s*\.code\s*=\s*'([A-Z][A-Z_]+)'/g;
  js().filter((r) => !r.startsWith('tools/')).forEach((rel) => {
    const s = text(rel) || '';
    let m;
    while ((m = codeRef.exec(s))) {
      if (!set.has(m[1]) && P.OLD_ERROR_CODES.indexOf(m[1]) === -1) out.push(rel + ': 错误码语境引用未登记 code ' + m[1]);
    }
    codeRef.lastIndex = 0;
  });
  return out.length ? shortList(out, 12) : null;
}

/** 门禁 #25 AI 外发白名单（原 tools/check.js 判据体，逐字搬移）。 */
function aiWhitelist() {
  const out = [];
  const aiDir = 'cloudfunctions/api/lib/ai/';
  js().filter((r) => !r.startsWith('tools/')).forEach((rel) => {
    const s = text(rel) || '';
    const outside = !rel.startsWith(aiDir);
    if (outside && /https:\/\//.test(s)) out.push(rel + ': 出现 https 外呼');
    if (outside && /(^|[^.\w])fetch\s*\(/.test(s)) out.push(rel + ': 出现 fetch 调用');
    if (outside && s.indexOf('api.deepseek.com') !== -1) out.push(rel + ': 出现 deepseek 端点');
  });
  const ds = text(aiDir + 'deepseek.js');
  if (ds === null) out.push('缺失: ' + aiDir + 'deepseek.js');
  else {
    if (ds.indexOf('buildAiPayload') === -1) out.push('deepseek.js 未使用 buildAiPayload()');
    if (ds.indexOf('AI_PAYLOAD_KEYS') === -1) out.push('deepseek.js 未引用 AI_PAYLOAD_KEYS');
  }
  const payload = text(aiDir + 'payload.js');
  if (payload === null) out.push('缺失: ' + aiDir + 'payload.js');
  else if (payload.indexOf('AI_PAYLOAD_KEYS') === -1) out.push('payload.js 未导出 AI_PAYLOAD_KEYS');
  rels(aiDir).filter((r) => r.endsWith('.js')).forEach((rel) => {
    ['fileId', 'openid', 'orderId'].forEach((k) => {
      if ((text(rel) || '').indexOf(k) !== -1) out.push(rel + ': lib/ai 出现身份字段 ' + k);
    });
  });
  return out.length ? shortList(out, 10) : null;
}

/** 门禁 #28 绑定方向（原 tools/check.js 判据体，逐字搬移）。 */
function bindDirection() {
  const out = [];
  const bindJs = rels('cloudfunctions/api/handlers/bind/').filter((r) => r.endsWith('.js'));
  if (bindJs.length === 0) out.push('handlers/bind 缺失');
  // bind.create 实现文件：去注释后必须同时命中「角色守卫调用 + 真实抛 forbidden + 自绑比较」。
  // 旧判据只在全文件文本里找 CUSTOMER/FORBIDDEN（文件头注释即可满足）→ 删掉真守卫仍判绿（TD-031 空转）。
  const bindCreateRel = 'cloudfunctions/api/handlers/bind/create.js';
  const bindCreateSrc = text(bindCreateRel);
  if (bindCreateSrc === null) {
    out.push('bind.create 实现文件缺失: ' + bindCreateRel);
  } else {
    const code = F.stripComments(bindCreateSrc);
    if (!/(?:role\.canInitiateBind\s*\(|ROLES\.CUSTOMER)/.test(code)) {
      out.push(bindCreateRel + ': 去注释后未见角色守卫（canInitiateBind / ROLES.CUSTOMER 断言）');
    }
    if (!/errors\.forbidden\s*\(/.test(code)) {
      out.push(bindCreateRel + ': 去注释后未见真实抛错 errors.forbidden（注释里的字样不算）');
    }
    if (!/partner\.openid\s*===\s*effectiveOpenid/.test(code)) {
      out.push(bindCreateRel + ': 去注释后未见自绑比较 partner.openid === effectiveOpenid');
    }
  }
  const orderJs = rels('cloudfunctions/api/handlers/order/').filter((r) => r.endsWith('.js'));
  orderJs.forEach((rel) => {
    const s = text(rel) || '';
    // 代客单不产生绑定 = 订单路径不得"写"bindings（读 ACTIVE 绑定用于顾客单可见性是合法读路径）
    if (/(?:add|set|update|remove)\(\s*COLLECTIONS\.bindings\b/.test(s)) out.push(rel + ': 订单路径写入 bindings');
  });
  rels('pkg-partner/').filter((r) => /\.(js|wxml)$/.test(r)).forEach((rel) => {
    const s = text(rel) || '';
    ['bind.create', 'bind.release'].forEach((k) => { if (s.indexOf(k) !== -1) out.push(rel + ': 兼职端出现 ' + k); });
    ['绑定顾客', '添加顾客', '导入顾客'].forEach((k) => { if (s.indexOf(k) !== -1) out.push(rel + ': 兼职端出现文案 ' + k); });
  });
  if (!RELS.some((r) => /handlers\/admin\/.*testAccount/i.test(r))) out.push('缺 handlers/admin/testAccounts 专用 purge');
  return out.length ? shortList(out, 12) : null;
}

/** 门禁 #30 账号切换与测试数据隔离（原 tools/check.js 判据体，逐字搬移）。 */
function accountSwitch() {
  const out = [];
  const adminJs = rels('cloudfunctions/api/handlers/admin/').filter((r) => r.endsWith('.js'));
  const sessionWriters = adminJs.filter((r) => (text(r) || '').indexOf('admin_view_sessions') !== -1
    && /\.add\s*\(/.test(text(r) || ''));
  if (sessionWriters.length === 0) out.push('未见 admin_view_sessions 写入');
  sessionWriters.forEach((rel) => {
    const s = text(rel) || '';
    ['viewMode', 'targetIsTest'].forEach((k) => { if (s.indexOf(k) === -1) out.push(rel + ': 会话写入缺 ' + k); });
  });
  // TEST_WRITE 只约束"签发/校验处"（云函数 admin/testAccounts、switch-session 中间件）；
  // 客户端读 viewMode 是合法用途，不在本判据范围（客户端由 #23 拦票据外泄）。
  const issuance = RELS.filter((r) => r.endsWith('.js') && r.startsWith('cloudfunctions/')
    && /handlers\/admin\/|switch-session|middleware\//.test(r)
    && (text(r) || '').indexOf('TEST_WRITE') !== -1);
  issuance.forEach((rel) => {
    const s = text(rel) || '';
    if (!/isTestAccount/.test(s)) out.push(rel + ': TEST_WRITE 签发/校验处未断言 isTestAccount');
  });
  // 统计/列表查询隔离：只扫需要排除测试数据的后台数据面（邀请码/审计/配置等不需要 isTest 过滤）
  const testFilterTargets = [
    'cloudfunctions/api/handlers/admin/stats.js',
    'cloudfunctions/api/handlers/admin/listOrders.js',
    'cloudfunctions/api/handlers/admin/listCustomers.js',
    'cloudfunctions/api/handlers/admin/listPartners.js',
    'cloudfunctions/api/handlers/admin/listTestAccounts.js',
  ].concat(RELS.filter((r) => /handlers\/order\/.*listPartner.*\.js$/.test(r)));
  testFilterTargets.forEach((rel) => {
    if (!exists(rel)) return;
    const s = text(rel) || '';
    if (!/isTest/.test(s)) out.push(rel + ': 统计/列表查询未见 isTest 过滤');
  });
  // 兼职统计/红点聚合（若有）：查询须排除 isTest
  RELS.filter((r) => /handlers\/(partner|order)\/.*(stats|workbench|counts).*\.js$/.test(r)).forEach((rel) => {
    const s = text(rel) || '';
    if (/COUNT|count\(|aggregate/.test(s) && !/isTest/.test(s)) out.push(rel + ': 统计聚合未见 isTest 过滤');
  });
  RELS.filter((r) => /handlers\/order\/.*\.js$/.test(r)).forEach((rel) => {
    const s = text(rel) || '';
    // 只约束 orders 主表写入（order_events 用 impersonatedBy，不含 isTest 字段）
    if (/(?:add|set)\(\s*COLLECTIONS\.(?:ORDERS|orders)\b/.test(s) && s.indexOf('isTest') === -1) {
      out.push(rel + ': orders 写入缺 isTest 派生');
    }
    if (/(?:add|set)\(\s*COLLECTIONS\.(?:ORDER_EVENTS|order_events)\b/.test(s)
      && s.indexOf('impersonatedBy') === -1 && /TEST_WRITE|impersonat/.test(s)) {
      out.push(rel + ': order_events 测试写缺 impersonatedBy');
    }
  });
  // 审计枚举：只比对"动作字符串集合"，忽略 AUDIT_ACTIONS/AUDIT_ACTION_LIST 等聚合导出名
  const audit = requireRegistry(['shared/audit-actions.js']);
  if (!audit || audit.error) out.push(audit ? 'shared/audit-actions.js 加载失败: ' + audit.error : 'shared/audit-actions.js 缺失');
  else {
    const got = new Set(Array.from(valuesOf(audit.value)).filter((s) => /^[A-Z][A-Z_]+$/.test(s)));
    P.AUDIT_ACTIONS.filter((a) => !got.has(a)).forEach((a) => out.push('审计缺: ' + a));
    Array.from(got).filter((a) => !P.AUDIT_ACTIONS.includes(a)).forEach((a) => out.push('审计多出: ' + a));
    // VIEW_AS_* 只在审计枚举里有意义：审计注册表与云侧审计写入零残留（页面局部变量名不属于审计枚举）
    if ((text('shared/audit-actions.js') || '').indexOf('VIEW_AS_') !== -1) out.push('audit-actions.js 残留 VIEW_AS_*');
    RELS.filter((r) => r.startsWith('cloudfunctions/') && r.endsWith('.js')).forEach((rel) => {
      const s = text(rel) || '';
      if (/['"]VIEW_AS_[A-Z_]*['"]/.test(s)) out.push(rel + ': 审计写入残留 VIEW_AS_*');
    });
  }
  return out.length ? shortList(out, 14) : null;
}

module.exports = {
  actionRegistry,
  sharedCopies,
  errorCodeRegistry,
  aiWhitelist,
  bindDirection,
  accountSwitch
};
