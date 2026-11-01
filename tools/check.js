'use strict';
/**
 * tools/check.js — v4 代码/配置门禁（ENGINEERING §8.2 的 36 条判据逐条实现）。
 * 口径：docs/engineering/V4_ENGINEERING.md v0.9 §8.2；失败含义见同表。汇总行必须存在（没有汇总输出 = 读数作废）。
 *
 * 与 check-docs 的分工（文件头登记差异，§8.2 #18）：
 *   - #18 行数：本文件对**代码/测试文件**（*.js）执行 ≤500 / 测试 ≤1000；文档 *.md 的体量/结构判据
 *     由 tools/check-docs.js 负责（它按文档地图逐份登记），不在本文件重复计数。
 *   - #22 零金额：本文件只做"源码 + 页面文案"两范围（词表唯一单源在 tools/zero-money-scan.js）；
 *     文档范围（根 md + docs/**）由 check-docs #7 执行，避免同一读数重复。
 *
 * 用法：node tools/check.js            # 逐条打印 PASS/FAIL + 汇总行；有失败 exit 1
 *       node tools/check.js --fail-only
 * 纪律：本文件自身也受 #18 约束（≤500 行全文本）；新增判据先加进 docs/engineering/V4_ENGINEERING.md §8.2。
 */
const path = require('path');
const F = require('./lib/fsutil');
const P = require('./lib/project');
const ZM = require('./zero-money-scan');

const {
  ROOT, RELS, PAGE_SCOPES, CODE_EXT, text, raw, exists, rels, js, clientFiles, cloudJs,
  missing, shortList, requireRegistry, stringsOf, valuesOf
} = require('./lib/check-helpers');
const cloudRules = require('./lib/check-rules-cloud');
const clientRules = require('./lib/check-rules-client');

const results = [];

function check(no, id, title, fn) {
  const entry = { no, id, title };
  try {
    const r = fn();
    if (r === null || r === true || r === undefined) entry.pass = true;
    else if (r && typeof r === 'object' && !Array.isArray(r) && r.skip) {
      entry.pass = true;
      entry.skip = r.skip;
    } else {
      entry.pass = false;
      entry.detail = Array.isArray(r) ? r : [String(r)];
    }
  } catch (e) {
    entry.pass = false;
    entry.detail = ['判据执行异常: ' + e.message];
  }
  results.push(entry);
}

// ---------------------------------------------------------------- #01
check(1, 'JSON 可解析', 'app.json/sitemap/project.config + 全部页面 .json', () => {
  const pageJson = RELS.filter((r) => /(^|\/)pages\/.*\/index\.json$/.test(r));
  const files = ['app.json', 'sitemap.json', 'project.config.json'].concat(pageJson);
  const bad = [];
  for (const rel of Array.from(new Set(files))) {
    if (!exists(rel)) { bad.push('缺失: ' + rel); continue; }
    try { F.readJson(path.join(ROOT, rel)); } catch (e) { bad.push(rel + ': ' + e.message); }
  }
  if (bad.length) return shortList(bad, 12);
  if (files.length < 4) return ['JSON 样本为空（空集不得判绿）'];
  return null;
});

// ---------------------------------------------------------------- #02
check(2, 'JS 语法', '客户端 + shared/api/store/utils + tools + cloudfunctions（vm 编译）', () => {
  const bad = [];
  const files = js();
  for (const rel of files) {
    const s = text(rel);
    if (s === null) continue;
    const r = F.syntaxCheck(s, rel);
    if (!r.ok) bad.push(rel + ': ' + r.error);
  }
  if (files.length === 0) return ['JS 样本为空（空集不得判绿）'];
  return bad.length ? bad : null;
});

// ---------------------------------------------------------------- #03
check(3, '页面四件套', '主包 7 + 分包 25（顾客 6 / 兼职 8 / 开发者 11）', () => {
  const bad = [];
  for (const page of P.ALL_PAGES) {
    for (const ext of P.PAGE_EXTS) {
      const rel = page + ext;
      if (!exists(rel)) bad.push('缺失: ' + rel);
    }
  }
  return bad.length ? shortList(bad, 12) : null;
});

// ---------------------------------------------------------------- #04
check(4, '反向登记', 'pages/ 与 pkg-*/pages/ 每个页面必须在 app.json 声明', () => {
  const app = F.exists(path.join(ROOT, 'app.json')) ? F.readJson(path.join(ROOT, 'app.json')) : null;
  if (!app) return ['app.json 缺失/不可解析'];
  const declared = new Set((app.pages || []).slice());
  (app.subPackages || app.subpackages || []).forEach((sp) => {
    (sp.pages || []).forEach((p) => declared.add(sp.root + '/' + p));
  });
  const actual = RELS.filter((r) => r.endsWith('/index.js') && PAGE_SCOPES.some((p) => r.startsWith(p)))
    .map((r) => r.replace(/\.js$/, ''));
  const undeclared = actual.filter((r) => !declared.has(r));
  const broken = Array.from(declared).filter((r) => !exists(r + '.js'));
  const out = [];
  if (undeclared.length) out.push('未声明页面: ' + undeclared.join(', '));
  if (broken.length) out.push('声明缺文件: ' + broken.join(', '));
  if (actual.length === 0) out.push('页面样本为空（空集不得判绿）');
  return out.length ? out : null;
});

// ---------------------------------------------------------------- #05
check(5, '必需文件', '骨架/门禁/两云函数 package.json/设计文档地图', () => {
  const miss = missing(P.REQUIRED_FILES);
  return miss.length ? shortList(miss, 12) : null;
});

// ---------------------------------------------------------------- #06
check(6, '.gitignore', '挡 .env*、project.private.config.json、node_modules/、.dsh-code-index/', () => {
  const s = text('.gitignore');
  if (s === null) return ['.gitignore 缺失'];
  const rules = [/\*?\.env/, /project\.private\.config\.json/, /node_modules/, /\.dsh-code-index/];
  const miss = rules.filter((re) => !re.test(s));
  return miss.length ? ['缺少规则（' + miss.length + ' 条）: ' + miss.map(String).join(' | ')] : null;
});

// ---------------------------------------------------------------- #07
check(7, 'ps1 BOM', 'check/gate/doctor 等 *.ps1 必须 UTF-8 BOM', () => {
  const ps1 = RELS.filter((r) => r.endsWith('.ps1'));
  const bad = ps1.filter((r) => {
    const b = raw(r);
    return !b || b.length < 3 || b[0] !== 0xef || b[1] !== 0xbb || b[2] !== 0xbf;
  });
  const need = ['check.ps1', 'gate.ps1', 'doctor.ps1'].filter((r) => !ps1.includes(r));
  const out = bad.map((r) => '缺 BOM: ' + r).concat(need.map((r) => '缺失: ' + r));
  return out.length ? out : null;
});

// ---------------------------------------------------------------- #08
check(8, '编译产物无 BOM', 'js/wxml/wxss/json 首三字节非 EF BB BF', () => {
  const files = RELS.filter((r) => CODE_EXT.test(r));
  const bad = files.filter((r) => {
    const b = raw(r);
    return b && b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;
  });
  return bad.length ? shortList(bad.map((r) => '带 BOM: ' + r), 10) : null;
});

// ---------------------------------------------------------------- #09（实现：tools/lib/check-rules-client.js）
check(9, 'WXML class 有定义', '同页 WXSS 或 app.wxss（含组件）', clientRules.wxmlClassDefined);

// ---------------------------------------------------------------- #10
check(10, 'tabBar↔pages', 'list 恰好 5 项/主包页/custom-tab-bar 在根/每角色 3 格/pkg-admin 不在 list', () => {
  const app = F.readJson(path.join(ROOT, 'app.json'));
  const tb = app.tabBar || {};
  const out = [];
  if (tb.custom !== true) out.push('tabBar.custom 必须为 true');
  const list = (tb.list || []).map((x) => x.pagePath);
  if (list.length !== 5) out.push('tabBar.list 必须恰好 5 项，当前 ' + list.length);
  if (JSON.stringify(list.slice().sort()) !== JSON.stringify(P.TAB_LIST.slice().sort())) {
    out.push('tabBar.list 与 CONTRACT §7 五 tab 不一致: ' + list.join(', '));
  }
  list.filter((p) => !P.MAIN_PAGES.includes(p)).forEach((p) => out.push('非主包页进了 tabBar: ' + p));
  list.filter((p) => p.startsWith('pkg-admin/')).forEach((p) => out.push('pkg-admin 页面不得进 tabBar: ' + p));
  ['.js', '.json', '.wxml', '.wxss'].forEach((ext) => {
    if (!exists('custom-tab-bar/index' + ext)) out.push('缺 custom-tab-bar/index' + ext);
  });
  Object.keys(P.TAB_PAGES_BY_ROLE).forEach((role) => {
    P.TAB_PAGES_BY_ROLE[role].forEach((p) => {
      if (!list.includes(p)) out.push(role + ' 角色 tab 不可解析: ' + p);
    });
  });
  const comp = text('custom-tab-bar/index.js');
  if (comp !== null && !/tabBar|list|TAB/i.test(comp)) out.push('custom-tab-bar/index.js 未见 tab 清单');
  return out.length ? out : null;
});

// ---------------------------------------------------------------- #11
check(11, '全局 navigationStyle 禁止', '仅页面局部 .json 允许', () => {
  const app = F.readJson(path.join(ROOT, 'app.json'));
  return app.window && app.window.navigationStyle ? ['app.json window.navigationStyle = ' + app.window.navigationStyle] : null;
});

// ---------------------------------------------------------------- #12
check(12, '集合名注册表', '云端 db.collection 字面量 ∈ shared/collections.js；客户端零带引号集合名（注册表自身除外）', () => {
  const reg = requireRegistry(['shared/collections.js']);
  if (!reg || reg.error) return [reg ? 'shared/collections.js 加载失败: ' + reg.error : 'shared/collections.js 缺失'];
  const known = new Set(Array.from(stringsOf(reg.value)).filter((s) => P.COLLECTIONS.includes(s)));
  const out = [];
  P.COLLECTIONS.filter((c) => !known.has(c)).forEach((c) => out.push('注册表缺集合: ' + c));
  if (known.size !== P.COLLECTIONS.length) out.push('注册表集合数 ' + known.size + ' ≠ 14');
  const lit = /\.collection\(\s*['"]([^'"]+)['"]/g;
  cloudJs().forEach((rel) => {
    const s = text(rel) || '';
    let m;
    while ((m = lit.exec(s))) if (!known.has(m[1])) out.push(rel + ': 未注册集合 ' + m[1]);
    lit.lastIndex = 0;
  });
  const REGISTRY = 'shared/collections.js';
  // `config` 同时是 store 键/公开配置模块名（client 里 store.get('config') 合法），
  // 客户端集合字面量检查排除它；其余 13 个集合名带引号出现即红。
  const clientCollectionNames = P.COLLECTIONS.filter((c) => c !== 'config');
  clientFiles().filter((rel) => rel !== REGISTRY).forEach((rel) => {
    const s = text(rel) || '';
    clientCollectionNames.forEach((c) => {
      if (new RegExp("(['\"])" + c + "\\1").test(s)) out.push(rel + ': 客户端出现带引号集合名 "' + c + '"');
    });
  });
  return out.length ? shortList(out, 10) : null;
});

// ---------------------------------------------------------------- #13（实现：tools/lib/check-rules-cloud.js）
// P0-5 补偿判据追踪锚点：router.staticRegistryProblems()（静态注册表完整性）+ loadDomain/expectedActionsOf/
// getHandler（按域懒加载契约）仍在本条判据内执行（实现模块 actionRegistry）；E20 依赖该标识符出现在本文件，
// 拆分只搬移判据体、不改判据语义——定位补偿判据时请顺此锚点查阅 tools/lib/check-rules-cloud.js。
check(13, 'action 注册表', 'shared/actions.js 覆盖 §5.3 全集 + visibility/write；api 调用 ⊆ client；router 静态注册表/按域懒加载', cloudRules.actionRegistry);

// ---------------------------------------------------------------- #14（实现：tools/lib/check-rules-client.js）
check(14, '客户端禁直连', 'wx.cloud.database 零命中；callFunction 仅 api/client.js；uploadFile 仅 api/upload.js', clientRules.clientNoDirectConnect);

// ---------------------------------------------------------------- #15（实现：tools/lib/check-rules-client.js）
check(15, '本地存储唯一写口', 'wx.*Storage* 仅 utils/storage.js（剥注释；空集判红）；票据不落盘', clientRules.localStorageOnly);

// ---------------------------------------------------------------- #16
check(16, '云函数依赖白名单', '两 package.json 依赖只允许 wx-server-sdk；非相对 require 只允许 sdk/Node 内置', () => {
  const NODE_BUILTINS = new Set(['assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants',
    'crypto', 'dgram', 'dns', 'domain', 'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net', 'os',
    'path', 'perf_hooks', 'process', 'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder', 'sys',
    'timers', 'tls', 'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib']);
  const out = [];
  ['cloudfunctions/api/package.json', 'cloudfunctions/cleanup/package.json'].forEach((rel) => {
    if (!exists(rel)) { out.push('缺失: ' + rel); return; }
    let pkg;
    try { pkg = F.readJson(path.join(ROOT, rel)); } catch (e) { out.push(rel + ': ' + e.message); return; }
    const deps = Object.assign({}, pkg.dependencies || {}, pkg.devDependencies || {});
    Object.keys(deps).filter((d) => d !== 'wx-server-sdk').forEach((d) => out.push(rel + ': 非法依赖 ' + d));
  });
  cloudJs().forEach((rel) => {
    const s = text(rel) || '';
    const re = /require\(\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(s))) {
      const id = m[1];
      if (id.startsWith('.') || id.startsWith('/') || id === 'wx-server-sdk') continue;
      const bare = id.replace(/^node:/, '').split('/')[0];
      if (!NODE_BUILTINS.has(bare)) out.push(rel + ': 非白名单 require ' + id);
    }
  });
  return out.length ? shortList(out, 10) : null;
});

// ---------------------------------------------------------------- #17（实现：tools/lib/check-rules-cloud.js）
check(17, 'shared 副本对帐', 'shared/** + ids/room-tag/defaults 与两云函数副本逐字节 hash 相等', cloudRules.sharedCopies);

// ---------------------------------------------------------------- #18
check(18, '行数', '小程序源码 ≤500；工具链 tools/*.js 与测试 ≤1000（全文本口径；docs 由 check-docs 管，见文件头）', () => {
  const out = [];
  const files = js();
  files.forEach((rel) => {
    // 差异登记：tools/ 是开发期工具链（非小程序包内容，单文件预算与测试同档 ≤1000）；
    // 被小程序编译的源码（pages/pkg/api/shared/utils/store/cloudfunctions/config）仍 ≤500。
    const isTool = rel.startsWith('tools/');
    const limit = isTool ? 1000 : 500;
    const n = F.countLines(path.join(ROOT, rel));
    if (n > limit) out.push(rel + ': ' + n + ' 行 > ' + limit);
  });
  return out.length ? shortList(out, 12) : (files.length ? null : ['JS 样本为空（空集不得判绿）']);
});

// ---------------------------------------------------------------- #19（实现：tools/lib/check-rules-client.js）
check(19, '敏感字面量', 'openid 形态零命中；云环境 ID 只在 config/env.js（占位符合法）；ADMIN_OPENIDS 不硬编码', clientRules.sensitiveLiterals);

// ---------------------------------------------------------------- #20（实现：tools/lib/check-rules-cloud.js）
check(20, '错误码注册表', 'shared/error-codes.js 恰好 13 码；CODE_COPY 每码有文案；旧码零残留；引用无未知码', cloudRules.errorCodeRegistry);

// ---------------------------------------------------------------- #21（实现：tools/lib/check-rules-client.js）
check(21, '页面层零判据', 'pages/、pkg-*/pages/ .js 零 wx.cloud.* 与七状态字面量；pages/parts 零 random 与编号生成', clientRules.pageLayerZeroPolicy);

// ---------------------------------------------------------------- #22
check(22, '零金额扫描（源码+页面文案）', '§7.6 词表命中 0；白名单只认精确项', () => {
  const r = ZM.run({ scope: 'source' });
  if (r.allowlistIssues.length) return ['白名单校验问题: ' + r.allowlistIssues.slice(0, 4).join('；')];
  const hits = r.hits.filter((h) => h.file.startsWith('pages/') || h.file.startsWith('pkg-') || !h.file.startsWith('docs/'));
  return hits.length ? shortList(hits.map((h) => h.file + ':' + h.line + ' ' + h.token), 12) : null;
});

// ---------------------------------------------------------------- #23（实现：tools/lib/check-rules-client.js）
check(23, '切换会话接入', '业务页引用 switch-bar（清单见 tools/lib/project.js）；pkg-admin 零引用；viewTicket 只允许 api/client.js 与 store/', clientRules.switchSessionAccess);

// ---------------------------------------------------------------- #24（实现：tools/lib/check-rules-client.js）
check(24, '客户端零 AI 外呼/零 Key', '客户端范围零 deepseek 痕迹（SQL 枚举全大写 DEEPSEEK 合法；隐私披露纯文本文件单文件窄豁免+补偿断言）；ai.parseParcel 只经 api/', clientRules.clientNoAiKey);

// ---------------------------------------------------------------- #25（实现：tools/lib/check-rules-cloud.js）
check(25, 'AI 外发白名单', 'https/fetch 只在 lib/ai/deepseek.js；payload 由 buildAiPayload 构造；无身份字段', cloudRules.aiWhitelist);

// ---------------------------------------------------------------- #26
check(26, '失败必入队', 'handlers/ai 每个 recognized:false 返回点有 recordFailure；catch 不空吞', () => {
  const out = [];
  const files = rels('cloudfunctions/api/handlers/ai/').filter((r) => r.endsWith('.js'));
  if (files.length === 0) out.push('handlers/ai 缺失');
  files.forEach((rel) => {
    const s = text(rel) || '';
    const falseReturns = (s.match(/recognized\s*:\s*false/g) || []).length;
    const records = (s.match(/recordFailure\s*\(/g) || []).length;
    if (falseReturns > records) out.push(rel + ': recognized:false ' + falseReturns + ' 处 > recordFailure ' + records + ' 处');
    const empties = s.match(/catch\s*\([^)]*\)\s*\{\s*\}/g) || [];
    if (empties.length) out.push(rel + ': 空 catch ' + empties.length + ' 处');
  });
  const collections = text('shared/collections.js');
  if (collections === null) out.push('缺失: shared/collections.js');
  else if (collections.indexOf('recognition_failures') === -1) out.push('collections 缺 recognition_failures');
  return out.length ? shortList(out, 10) : null;
});

// ---------------------------------------------------------------- #27
check(27, '复核原图访问必审计', 'getTempFileURL 与 FAILURE_IMAGE_VIEW 同函数；复核页零直取；fix/ignore 写审计', () => {
  const out = [];
  const adminJs = rels('cloudfunctions/api/handlers/admin/').filter((r) => r.endsWith('.js'));
  // 只认"真正实现文件"（读写 dao/db 的 handler）；router/index.js 登记名字不算实现
  const hasImpl = (rel) => /ctx\.|dao\.|db\.|transaction/.test(text(rel) || '');
  const getFiles = adminJs.filter((r) => (text(r) || '').indexOf('getRecognitionFailure') !== -1 && hasImpl(r));
  if (getFiles.length === 0) out.push('handlers/admin 未落盘 getRecognitionFailure 实现（router 登记 ≠ 实现）');
  getFiles.forEach((rel) => {
    const s = text(rel) || '';
    if (s.indexOf('getTempFileURL') === -1) out.push(rel + ': 缺 getTempFileURL');
    if (s.indexOf('FAILURE_IMAGE_VIEW') === -1) out.push(rel + ': 缺 FAILURE_IMAGE_VIEW 审计');
  });
  adminJs.filter(hasImpl).forEach((rel) => {
    const s = text(rel) || '';
    if (s.indexOf('fixRecognitionFailure') !== -1 && s.indexOf('FAILURE_FIX') === -1) out.push(rel + ': fix 缺 FAILURE_FIX');
    if (s.indexOf('ignoreRecognitionFailure') !== -1 && s.indexOf('FAILURE_IGNORE') === -1) out.push(rel + ': ignore 缺 FAILURE_IGNORE');
  });
  const reviewJs = rels('pkg-admin/pages/recognition-review/').filter((r) => r.endsWith('.js'));
  reviewJs.forEach((rel) => {
    if ((text(rel) || '').indexOf('getTempFileURL') !== -1) out.push(rel + ': 复核页不得直取临时 URL');
  });
  if (reviewJs.length === 0) out.push('复核页 JS 缺失');
  return out.length ? shortList(out, 10) : null;
});

// ---------------------------------------------------------------- #28（实现：tools/lib/check-rules-cloud.js）
check(28, '绑定方向', 'bind.create 仅 CUSTOMER + 拒自绑；代客单零 bindings；兼职端零绑定入口', cloudRules.bindDirection);

// ---------------------------------------------------------------- #29（实现：tools/lib/check-rules-client.js）
check(29, '头像昵称', '头像路径模板只在 upload 域且零 openid；avatarFileId 不进脱敏 DTO；昵称截断+msgSecCheck；roomTag 大写', clientRules.avatarNickname);

// ---------------------------------------------------------------- #30（实现：tools/lib/check-rules-cloud.js）
check(30, '账号切换与测试数据隔离', '会话含 viewMode/targetIsTest；云侧 TEST_WRITE 签发断言 isTestAccount；统计过滤；审计动作集合', cloudRules.accountSwitch);

// ---------------------------------------------------------------- #31（实现：tools/lib/check-rules-client.js）
check(31, '测试视觉', '孤立 TEST 字面量只在 test-badge；switch-bar 颜色/样式不旁路；后台零引用；角标受 viewMode 控制', clientRules.testVisual);

// ---------------------------------------------------------------- #32
check(32, '单函数行数', '生产源码单函数 ≤50 行（全文本口径；存量基线 tools/function-length-baseline.json，超基线/新增判红）', () => {
  const r = require('./check-functions').run();
  return r.problems.length ? shortList(r.problems, 12) : null;
});

// ---------------------------------------------------------------- #33
check(33, '分享卡口中性', '业务页挂好友转发（清单见 tools/lib/share-pages.js）/3 页朋友圈/后台零分享；卡片单源 utils/share；固定中性封面；会话禁分享收口 switch-bar', () => require('./lib/check-share').run());
// ---------------------------------------------------------------- #34
check(34, '打包忽略清单', '根目录每个目录 ∈ 源码白名单 或 project.config.json packOptions.ignore folder 项；配置缺失/不可解析/空集判红（TD-071）', () => require('./lib/check-pack-ignore').run());
// ---------------------------------------------------------------- #35/#36
check(35, '未引用导出扫描', '生产 0 引用且文件内不自用的导出必须逐条登记 tools/dead-export-baseline.json（history/test-only/contract-slot + 理由）；新增即红、基线失效即红', () => require('./lib/dead-code').runDeadExports());
check(36, '页面死函数扫描', '页面/组件目录内定义但 JS/WXML 均无引用的函数必须登记基线（平台生命周期/框架保留键豁免）；新增即红、页面死函数清理后基线项自动作废', () => require('./lib/dead-code').runPageDeadFunctions());
// ---------------------------------------------------------------- 输出
const opts = process.argv.slice(2);
const failOnly = opts.includes('--fail-only');
let pass = 0;
let failed = 0;
let skipped = 0;
console.log('== tools/check.js · v4 门禁（ENGINEERING §8.2 · 36 条）==');
for (const r of results) {
  const id = '#' + String(r.no).padStart(2, '0');
  if (r.pass) {
    pass += 1;
    if (r.skip) {
      skipped += 1;
      console.log('[PASS] ' + id + ' ' + r.title + '（SKIP：' + r.skip + '）');
    } else if (!failOnly) console.log('[PASS] ' + id + ' ' + r.title);
  } else {
    failed += 1;
    console.log('[FAIL] ' + id + ' ' + r.title);
    (r.detail || []).forEach((d) => console.log('        - ' + d));
  }
}
if (failed > 0) console.log('汇总（逐条）：' + results.map((r) => (r.pass ? (r.skip ? '⏭️' : '✅') : '❌') + r.no).join(' '));
console.log('------------------------------------------------------------');
console.log('通过 ' + pass + ' 项；失败 ' + failed + ' 项' + (skipped ? '（其中跳过 ' + skipped + ' 项，见 SKIP 行）' : ''));
process.exitCode = failed === 0 ? 0 : 1;
