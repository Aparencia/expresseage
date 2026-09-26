// tools/check.js · v2 机械门禁（零依赖）
// 判据来源：v1 的 1~8 条是**架构不变量**（与具体页面无关），原样继承；
// v1 的 9~13 条钉的是 v1 的具体页面与当轮裁决（onShow 读库页白名单、站点候选面板两页同步、
// 面板可见性豁免表、可转发页封闭集合），v2 重建后页面集不同 ⇒ **刻意不继承**，
// 待 22 卡设计定稿后按 v2 实际重写（登记在 STATE.md「下一步」，不许悄悄丢掉）。
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let fails = 0;
let passes = 0;

function ok(msg) { passes++; console.log('  [OK] ' + msg); }
function fail(msg) { fails++; console.log('  [FAIL] ' + msg); }
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function exists(rel) { return fs.existsSync(path.join(ROOT, rel)); }

// 1. JSON 必须可解析（写坏配置文件在真机的表现是白屏，本地先拦）
//    为什么"读一次、解析一次、到处用"（修 R-29 的第 ④ 条通道）：原先第 3 条与第 9 条各自再
//    `JSON.parse(read('app.json'))` 一遍，而 app.json 非法时**第 1 条报完红、第 3 条就抛未捕获异常**
//    —— 末尾的汇总行整行消失。门禁"没有输出"比报红更糟：读的人分不清是没跑还是跑了没写完。
function parseJson(rel) {
  try {
    return { value: JSON.parse(read(rel)), error: '' };
  } catch (e) {
    return { value: null, error: e.message };
  }
}
const jsonFiles = ['app.json', 'sitemap.json', 'project.config.json'].filter(exists);
const parsedJson = {};
for (const rel of jsonFiles) {
  parsedJson[rel] = parseJson(rel);
  if (parsedJson[rel].error) fail('JSON 解析失败：' + rel + ' —— ' + parsedJson[rel].error);
  else ok('JSON 可解析：' + rel);
}
// 第 3/9 条共用这一份。`appConfig` 只在"解析成功且顶层是对象"时才有值 —— 后面每条**各自决定**
// 拿不到值时怎么报红，绝不许拿一个空壳把"读不懂"伪装成"没问题"。
const appJsonResult = parsedJson['app.json'];
const appConfig = appJsonResult && !appJsonResult.error && appJsonResult.value && typeof appJsonResult.value === 'object'
  && !Array.isArray(appJsonResult.value) ? appJsonResult.value : null;

// 主包页 + 分包页**一起**进同一批判据（波 5 起有了 `chatpick/`）：
// 只查 `pages` 的话，分包页的语法、三件套、class 对帐、分层越界全部裸奔 —— 而那正是最容易写错的一页。
const appPages = (appConfig && Array.isArray(appConfig.pages)) ? appConfig.pages : [];
const subPackages = (appConfig && Array.isArray(appConfig.subPackages)) ? appConfig.subPackages : [];
const subPageDirs = [];
for (const pkg of subPackages) {
  const root = pkg && typeof pkg.root === 'string' ? pkg.root.replace(/\/+$/, '') : '';
  const list = pkg && Array.isArray(pkg.pages) ? pkg.pages : [];
  for (const page of list) {
    if (root && typeof page === 'string') subPageDirs.push(root + '/' + page);
  }
}
const allPages = subPageDirs.length > 0 ? appPages.concat(subPageDirs) : appPages.slice();

// 2. JS 必须能编译（语法错误别等真机）
function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) { if (name !== 'node_modules') walk(full, out); }
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}
const subRoots = [];
for (const pkg of subPackages) {
  const root = pkg && typeof pkg.root === 'string' ? pkg.root.replace(/\/+$/, '') : '';
  if (root && subRoots.indexOf(root) < 0) subRoots.push(root);
}
const jsFiles = [
  path.join(ROOT, 'app.js'),
  ...walk(path.join(ROOT, 'pages'), []),
  ...walk(path.join(ROOT, 'utils'), []),
  // tools/ 也在编译范围内：`selftest.js` 拆出 `selftest-wave5.js` 之后，
  // 只靠"跑一次自测"来暴露语法错误的话，报错点是 require 栈而不是判据行，读起来像运行器坏了
  ...walk(path.join(ROOT, 'tools'), []),
  ...subRoots.reduce((out, root) => walk(path.join(ROOT, root), out), [])
].filter((f) => fs.existsSync(f));
for (const f of jsFiles) {
  try { new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f }); ok('JS 语法通过：' + path.relative(ROOT, f).replace(/\\/g, '/')); }
  catch (e) { fail('JS 语法失败：' + path.relative(ROOT, f).replace(/\\/g, '/') + ' —— ' + e.message); }
}

// 3. app.json 声明的页面（主包 + 分包），三件套（js/wxml/wxss + json 配置）必须齐
if (!appConfig) {
  // 与第 9 条同一口径：读不出配置就等于"这条没核过"，必须说出来（否则总条数静默少一截 = R-29 的①）
  fail('第 3 条无法核验：app.json 读不出可用配置（见第 1 条）');
} else if (!Array.isArray(appConfig.pages) || appConfig.pages.length === 0) {
  // R2-C01（r2 代码侧审查·变异 E5 实证）：旧写法 `pages: []` 时既不 OK 也不 FAIL ⇒ 总条数 26→25 却 exit 0。
  // 空 pages 在真机上是"没有任何页面可开"，比缺一个文件更严重，绝不能长得像通过。
  fail('app.json 的 pages 不是非空数组（=' + JSON.stringify(appConfig.pages) + '）⇒ 小程序没有任何页面可开');
}
for (const page of allPages) {
  for (const ext of ['.js', '.wxml', '.wxss', '.json']) {
    if (exists(page + ext)) continue;
    fail('页面缺文件：' + page + ext + '（app.json 声明了它，缺一个真机就白屏）');
  }
}
if (allPages.length > 0) ok('app.json 声明的 ' + allPages.length + ' 个页面（含分包 ' + subPageDirs.length + ' 个）三件套齐');

// 3b. **反向**登记对帐：`pages/` 下每个页面都必须登记进 app.json（用户已批，2026-09-25）
//     为什么加（真机缺陷①）：详情页批只建了四件套、**漏登 app.json** ⇒ `wx.navigateTo` 静默失败
//     （只在 console 报错）⇒ 档案页"点整行没反应"；而第 3 条是**单向**的（声明了才查三件套）
//     ⇒ 漏登记 = 全绿。属 TD-014 同族："可机器拦而没拦"。
//     口径：**".js + 同名 .wxml"才算页面** —— 零件（sheet-flow.js / row-actions.js / parts.js …）
//     没有 wxml ⇒ 天然不误报（实测 4 个页面 / 7 个零件，区分零误差）。
//     ⚠️ 边界：将来若把**自定义组件**放进 `pages/`（组件也有 wxml），本判据会误报 ⇒ 届时把组件移出
//     `pages/`，或给判据加白名单（属新增判据，须人批），⛔ 别用"排除某个目录"糊过去。
function pageDirPages() {
  const out = [];
  const dir = path.join(ROOT, 'pages');
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (!fs.statSync(full).isDirectory()) continue;
    for (const file of fs.readdirSync(full)) {
      if (!file.endsWith('.js')) continue;
      if (!fs.existsSync(path.join(full, file.replace(/\.js$/, '.wxml')))) continue;
      out.push('pages/' + name + '/' + file.replace(/\.js$/, ''));
    }
  }
  return out;
}
if (!appConfig) {
  fail('第 3b 条无法核验：app.json 读不出可用配置（见第 1 条）');
} else {
  const declared = allPages.map((p) => String(p).replace(/^\/+/, '').replace(/\/+$/, ''));
  const found = pageDirPages();
  const missing = found.filter((p) => declared.indexOf(p) < 0);
  for (const p of missing) {
    fail('页面未登记进 app.json：' + p
      + ' —— 文件在但没声明 ⇒ wx.navigateTo 静默失败（真机表现是"点了没反应"，不是报错）');
  }
  if (found.length === 0) {
    // 空集上的全绿比报红更糟（R-29 的①）：目录走错/扫不到时，这条会静默通过
    fail('第 3b 条无法核验：`pages/` 下没扫到任何"js + 同名 wxml"的页面 ⇒ 反向对帐在空集上全绿');
  } else if (missing.length === 0) {
    ok('反向登记对帐：`pages/` 下 ' + found.length + ' 个页面全部已登记进 app.json');
  }
}

// 4. 骨架必需文件在位
const REQUIRED_FILES = ['README.md', 'AGENTS.md', 'STATE.md', 'CHANGELOG.md', 'check.ps1', 'doctor.ps1', 'gate.ps1',
  '.gitignore', '.tool-versions', '.env.example', 'app.js', 'app.json', 'app.wxss', 'sitemap.json',
  'project.config.json', 'docs/registry/APIS.md', 'docs/registry/COMPONENTS.md', 'docs/registry/DATA_DICT.md'];
for (const rel of REQUIRED_FILES) {
  if (exists(rel)) continue;
  fail('必需文件缺失：' + rel);
}
ok('骨架必需文件在位（' + REQUIRED_FILES.length + ' 项）');

// 5. 密钥卫生：.gitignore 必须挡住 .env
if (exists('.gitignore') && /\.env\s*($|\r?\n)/.test(read('.gitignore'))) {
  ok('.gitignore 挡住了 .env');
} else {
  fail('.gitignore 没有挡住 .env —— 密钥会被提交进仓库');
}

// 6. 分层：本地存储 API 只允许在 utils/ 下调用（v1 架构铁律，v2 沿用）
//    为什么单列：v1 的冒烟件第一版就是被这条判红的（分包页面直接写存储），说明它真的在工作。
const storageCall = /wx\s*\.\s*(set|get|remove|clear)Storage/;
for (const f of jsFiles) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  if (rel.indexOf('utils/') === 0) continue;
  // `tools/` 也在跳过之列：自测**必须**自己实现一套 `wx.setStorageSync` 的内存替身，
  // 那不是越界而是测试替身。本条管的是生产代码（app.js / pages / 分包页）—— 范围收窄是有意的，
  // 但它建立在"测试目录只放测试"这个前提上：往 tools/ 里塞业务代码就会绕过这条判据（r2 的 R-21 同族）
  if (rel.indexOf('tools/') === 0) continue;
  if (storageCall.test(fs.readFileSync(f, 'utf8'))) {
    fail('分层越界：' + rel + ' 直接调用了 wx.*Storage*（本项目只允许 utils/ 碰本地存储）');
  }
}
ok('分层检查：本地存储 API 未越界（只允许 utils/）');

// 7. PowerShell 脚本必须带 UTF-8 BOM（PS 5.1 读无 BOM 的 UTF-8 会按 GBK 解析，中文被撕开 = 直接解析失败）
for (const rel of ['check.ps1', 'doctor.ps1', 'gate.ps1']) {
  if (!exists(rel)) continue;
  const bytes = fs.readFileSync(path.join(ROOT, rel));
  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) ok(rel + ' 带 UTF-8 BOM');
  else fail(rel + ' 缺 UTF-8 BOM（PS 5.1 会按 GBK 解析中文 → 脚本直接崩）');
}

// 8. WXML 引用的 class 必须在同页 WXSS 或 app.wxss 里有定义（用了没定义 = 真机静默无样式）
const appDefined = definedClasses(exists('app.wxss') ? read('app.wxss') : '');
for (const page of allPages) {
  if (!exists(page + '.wxml') || !exists(page + '.wxss')) continue;
  const defined = definedClasses(read(page + '.wxss'));
  for (const match of read(page + '.wxml').matchAll(/class=(?:"([^"]*)"|'([^']*)')/g)) {
    const value = match[1] !== undefined ? match[1] : match[2];
    if (/^\s*\{\{/.test(value)) { fail('WXML 的 class 整段插值，静态对帐查不到：' + page + '.wxml 的 class="' + value + '"'); continue; }
    // 先把**含插值的整段**摘掉再比对：`state-{{bindState}}` 若只删 `{{}}` 会留下 `state-` 这种假 class
    // 名（波 5 的 `chatpick` 第一次让这条撞到 —— 三元写法 `{{saving ? 'btn-wait' : ''}}` 还会把一段
    // 拆成五个词）。摘掉 = 动态部分本条**不覆盖**，与 v1 的已知边界一致：静态拼错仍然判红。
    const staticValue = value.replace(/[^\s]*\{\{[^\}]*\}\}[^\s]*/g, ' ');
    for (const name of staticValue.split(/\s+/)) {
      if (!name) continue;
      if (!defined[name] && !appDefined[name]) fail('WXML 引用了未定义的 class：' + page + '.wxml 的 .' + name);
    }
  }
}
ok('WXML 与 WXSS 的 class 对帐（已查 ' + allPages.length + ' 个页面的静态 class；插值部分不覆盖）');

function definedClasses(wxss) {
  const withoutComments = wxss.replace(/\/\*[\s\S]*?\*\//g, '');
  const set = {};
  for (const match of withoutComments.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) set[match[1]] = true;
  return set;
}

// 9. `app.json` 的 `window` 内不得出现 `navigationStyle`（DESIGN K3，用户批准项 P4）
//    为什么单列：v1 为了让 Skyline 分包页过强制校验，把 `navigationStyle:"custom"` 写进了**全局** `window`，
//    结果是所有页面一起失去系统导航栏、状态栏被内容盖住，且没人觉得是 bug。
//    自定义导航只允许出现在**单个页面的 .json** 里（分包页真需要时就这么做）。
//
//    ⚠️ 本条原先有四条**假绿通道**（24 审查 R-29，第 ③ 条是审查者实测复现的）：
//      ① `app.json` 不存在时既不 OK 也不 FAIL ⇒ 总条数从 26 掉到 25，没人判；
//      ② `window` 是字符串/数组时 `appConfig.window || {}` 判绿；
//      ③ 小写 `navigationstyle`（小程序配置对键名大小写并不敏感）躲过 `hasOwnProperty` 精确匹配；
//      ④ 非法 JSON 在这里抛未捕获异常、吞掉末尾汇总行（与第 1 条同源，已在上文统一解析）。
//    统一口径：**核验不了就判红**。"查不了"永远不等于"没问题"。
const K3_TARGET = 'app.json';
const K3_KEY = 'navigationstyle';
const K3_PASS = '全局 window 未设置 navigationStyle（自定义导航只许写在页面局部 json）';
function k3Unable(msg) { fail('第 9 条（K3）无法核验：' + msg + ' —— 无法核验按判红处理，不许静默放行'); }
if (!exists(K3_TARGET)) {
  k3Unable(K3_TARGET + ' 不存在');
} else if (appJsonResult.error) {
  k3Unable(K3_TARGET + ' 不是合法 JSON（' + appJsonResult.error + '）');
} else if (!appConfig) {
  k3Unable(K3_TARGET + ' 顶层不是对象（' + typeof appJsonResult.value + '）');
} else if (!Object.prototype.hasOwnProperty.call(appConfig, 'window')) {
  ok(K3_PASS);
} else {
  const windowConfig = appConfig.window;
  if (!windowConfig || typeof windowConfig !== 'object' || Array.isArray(windowConfig)) {
    k3Unable(K3_TARGET + ' 的 window 不是对象（' + (Array.isArray(windowConfig) ? 'array' : typeof windowConfig)
      + '）—— 里面有没有 navigationStyle 无从判断');
  } else {
    // 键名**不区分大小写**比对：写 `navigationstyle` 与写 `navigationStyle` 在真机上是一回事
    const hitKey = Object.keys(windowConfig).filter((key) => key.toLowerCase() === K3_KEY)[0];
    if (hitKey === undefined) {
      ok(K3_PASS);
    } else {
      fail(K3_TARGET + ' 的 window 里出现 ' + hitKey + '（=' + JSON.stringify(windowConfig[hitKey])
        + '）：这是全局生效，会让**所有页面**失去系统导航栏（v1 踩过）。需要自定义导航请写到那个页面的 .json 里');
    }
  }
}

// 10. `app.json` 顶层键拼写（R3-03 变异 M11 实证 + r4 R4-06 的转置补口）
//     编号沿革：2026-09-25 之前的这一节里还挂着"第 10 条 = `chatTools` 形态对帐（P-A）"与
//     "第 11 条 = 悬挂的 `if`（P-B）"，**两条均按用户裁决删除** ⇒ 本条才是第 10 条，且没有第 11 条。
// R3-03（r3 变异 M11 实证）：把顶层键 `chatTools` 写成 `chatTool` ⇒ 上面读到空数组、本条报绿，
// 而真机的表现是"聊天工具能力整个静默消失"。**"读不到"和"确实没配"必须分得开**（与第 3 条的空 `pages` 同族）。
// 做法：拿本项目会读的顶层键当字典，出现"像但不是"的键就判红——拼错键名是 JSON 配置的常态失效模式。
const KNOWN_TOP_KEYS = ['pages', 'entryPagePath', 'tabBar', 'window', 'style', 'sitemapLocation',
  'lazyCodeLoading', 'subPackages', 'subpackages', 'chatTools', 'permission', 'requiredPrivateInfos',
  'useExtendedLib', 'debugOptions', 'renderer', 'componentFramework'];
function oneEditApart(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let diffs = 0;
  while (i < a.length && j < b.length) {
    if (a[i] !== b[j]) {
      diffs++;
      if (diffs > 1) return false;
      if (a.length > b.length) i++;
      else if (a.length < b.length) j++;
      else { i++; j++; }
    } else { i++; j++; }
  }
  return diffs + (a.length - i) + (b.length - j) <= 1;
}
// r4 复测补的洞：上面是"插入/删除/替换"的一次编辑距离，**相邻两字符写反**（`chatTools`→`cahtTools`）
// 按它的算法算 2 次子代 ⇒ 判绿。而手打键名最常见的错法正是转置，所以补一条转置判定。
function swappedAdjacent(a, b) {
  if (a.length !== b.length || a.length < 2) return false;
  let first = -1;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) { first = i; break; }
  }
  if (first < 0 || first + 1 >= a.length) return false;
  if (!(a[first] === b[first + 1] && a[first + 1] === b[first])) return false;
  for (let i = first + 2; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
function looksLikeTypo(known, key) {
  const a = known.toLowerCase();
  const b = key.toLowerCase();
  if (a === b) return false;
  return oneEditApart(a, b) || swappedAdjacent(a, b);
}
if (appConfig) {
  const misspelled = Object.keys(appConfig).filter((key) => {
    if (KNOWN_TOP_KEYS.indexOf(key) >= 0) return false;
    return KNOWN_TOP_KEYS.some((known) => looksLikeTypo(known, key));
  });
  if (misspelled.length > 0) {
    fail('app.json 顶层键拼错：' + misspelled.join('、')
      + ' —— 平台会直接忽略不认识的键，表现是"这块配置静默失效"，而门禁原本会报绿（R3-03 的变异 M11）');
  } else {
    ok('app.json 顶层键没有"像但不是"的拼错（chatTools / subPackages 这类键拼错=能力静默消失）');
  }
} else {
  fail('顶层键拼写检查无法核验：app.json 读不出可用配置（见第 1 条）');
}

// 11. 「唯一写盘口」：`wx.*Storage*` 在 `utils/` 下**只许**出现在 `storage-core.js`（用户已批，2026-09-25）
//     为什么加（卡 52 的变异 M1 实证）：拆完 storage 之后，在实体文件里**再塞一份写盘**
//     ⇒ `selftest` 656/656 与 `check.js` 全绿 ⇒ "唯一写盘口"当时**根本没有机器闸**；
//     而第 6 条管的是"`utils/` **之外**"⇒ 在 **utils 同一层里**再写一份是它的盲区（拆件后新出现的洞）。
//     ⚠️ **剥注释是必须的**：`utils/storage.js:14` 的说明注释里**就写着** `wx.getStorageSync`/`setStorageSync`
//     ⇒ 不剥注释的逐行正则会在这行**假红**（本项目已有"注释里提到旧写法被正则命中"的教训）。
//     空集防线：扫不到 `storage-core.js`、或**全 utils 一个 StorageSync 调用都没有** ⇒ 判红
//     （"判据没测到东西"不许静默通过 —— 与第 3b 条、第 9 条同一口径）。
const STORAGE_OWNER = 'utils/storage-core.js';
const STORAGE_API = /wx\s*\.\s*[A-Za-z]*Storage[A-Za-z]*/;
// 剥注释但**保持行号**：块注释换成同数量空行、行注释只砍掉后半段（行本身保留）
function stripJsComments(src) {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));
  return noBlock.split('\n').map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
}
function storageLines(rel) {
  const hits = [];
  const lines = stripJsComments(read(rel)).split('\n');
  const raw = read(rel).split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (STORAGE_API.test(lines[i])) hits.push({ line: i + 1, text: (raw[i] || '').trim() });
  }
  return hits;
}
if (!exists(STORAGE_OWNER)) {
  fail('第 11 条无法核验：' + STORAGE_OWNER + ' 不存在 ⇒ 「唯一写盘口」无从对帐（无法核验按判红处理）');
} else {
  const utilsFiles = walk(path.join(ROOT, 'utils'), []);
  let total = 0;
  let offended = 0;
  for (const f of utilsFiles) {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    const hits = storageLines(rel);
    total += hits.length;
    if (rel === STORAGE_OWNER) continue;   // 唯一被允许写盘的文件
    for (const hit of hits) {
      offended++;
      fail('第二份写盘：' + rel + ':' + hit.line + ' 出现 ' + STORAGE_API.exec(hit.text)[0]
        + ' —— 本地存储只在 ' + STORAGE_OWNER + ' 里读写（拆件后同层再写一份会让单源静默失效）');
    }
  }
  if (total === 0) {
    fail('第 11 条无法核验：`utils/` 下没扫到任何 `wx.*Storage*` 调用 ⇒ 单源判据在空集上全绿');
  } else if (offended === 0) {
    ok('唯一写盘口：`wx.*Storage*` 只出现在 ' + STORAGE_OWNER + '（其余 ' + (utilsFiles.length - 1) + ' 个 utils 文件零命中）');
  }
}


console.log('\n通过 ' + passes + ' 项；失败 ' + fails + ' 项；警告 0 项');
if (fails > 0) { console.log('机械门禁未通过。禁止宣布完成。'); process.exit(1); }
console.log('机械门禁通过（行为验收另见 25 卡）。');
process.exit(0);
