'use strict';
/**
 * tools/lib/check-pack-ignore.js · 门禁 #34「打包忽略清单 + 体积预算」实现（TD-071；性能体检 2026-11-19 扩条）。
 * 判据（只读取数，不改 project.config.json、不跑 check.ps1）：
 *   ① 根目录下每个子目录必须 ∈ 小程序源码白名单，或 ∈ project.config.json 的
 *     packOptions.ignore 里 {type:'folder', value} 项；否则会被打进小程序包（工具/测试产物泄漏）。
 *   ② ignore 项归一化：去前导 "./"、去尾部 "/"（开发者工具两种写法都接受）。
 *   ③ ignore 指向不存在的目录不算错（node_modules/coverage 未生成是合法状态）。
 *   ④ project.config.json 缺失/不可解析/无 packOptions.ignore 数组 → 判红并给原因（不得静默通过）。
 *   ⑤ 空集不得判绿：根目录枚举为空 → 判红。
 *   ⑥ 体积预算（ENGINEERING §2.3）：主包源码 ≤1.5MB、每个分包 ≤1.5MB。字节口径 = 源码文件字节和
 *     （未压缩；压缩后真值以上传面板为准，见 PERFORMANCE_2026-11-01 §2.1）。主包 = 源码目录去掉
 *     pkg-* 三个分包 + 根 app 四件；分包缺失/为空同样判红（声明了就必须有内容，防路径写错静默通过）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

/** 小程序源码目录白名单（可被打包目录；单源在本文件，新增源码目录必须同步这里）。 */
const SOURCE_DIRS = [
  'api', 'assets', 'components', 'config', 'custom-tab-bar', 'pages',
  'pkg-admin', 'pkg-customer', 'pkg-partner', 'shared', 'store', 'utils',
];

/** 分包根目录（主包口径要扣除；与 app.json subPackages.root 对齐）。 */
const SUBPACKAGE_DIRS = ['pkg-customer', 'pkg-partner', 'pkg-admin'];

/** 主包根文件（不在目录里，但会打进主包）。 */
const MAIN_ROOT_FILES = ['app.js', 'app.json', 'app.wxss', 'sitemap.json'];

/** 体积预算：主包/每分包各 1.5MB（ENGINEERING §2.3；不写死平台上限）。 */
const BUDGET_BYTES = 1.5 * 1024 * 1024;

/** 归一化 ignore 项：去前导 "./" 与尾部 "/"。 */
function normalizeFolder(value) {
  return String(value).replace(/^\.\//, '').replace(/\/+$/, '');
}

/** 读 packOptions.ignore 的 folder 集合。成功返回 {folders:Set}，失败返回 {error:string}。 */
function readIgnoredFolders() {
  const file = path.join(ROOT, 'project.config.json');
  let config;
  try {
    config = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (err) {
    return { error: 'project.config.json 缺失/不可读/不可解析: ' + (err.message || err) };
  }
  if (!config || !config.packOptions || !Array.isArray(config.packOptions.ignore)) {
    return { error: 'project.config.json 缺 packOptions.ignore 数组（打包忽略清单不可取证）' };
  }
  const folders = new Set();
  config.packOptions.ignore.forEach((item) => {
    if (item && item.type === 'folder' && typeof item.value === 'string') {
      folders.add(normalizeFolder(item.value));
    }
  });
  return { folders };
}

/** 递归累计目录字节/文件数；目录不存在返回 {files:0, bytes:0}，由调用方决定是否判红。 */
function sumDir(relative) {
  const start = path.join(ROOT, relative);
  if (!fs.existsSync(start)) {
    return { files: 0, bytes: 0 };
  }
  const stack = [start];
  let files = 0;
  let bytes = 0;
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        files += 1;
        bytes += fs.statSync(full).size;
      }
    }
  }
  return { files, bytes };
}

/** 主包/分包源码字节（读盘）；返回 {main:{files,bytes}, packages:[{root,files,bytes}]}。 */
function measure() {
  const mainDirs = SOURCE_DIRS.filter((dir) => SUBPACKAGE_DIRS.indexOf(dir) < 0);
  let mainFiles = 0;
  let mainBytes = 0;
  mainDirs.forEach((dir) => {
    const part = sumDir(dir);
    mainFiles += part.files;
    mainBytes += part.bytes;
  });
  MAIN_ROOT_FILES.forEach((file) => {
    const full = path.join(ROOT, file);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      mainFiles += 1;
      mainBytes += fs.statSync(full).size;
    }
  });
  const packages = SUBPACKAGE_DIRS.map((root) => Object.assign({ root }, sumDir(root)));
  return { main: { files: mainFiles, bytes: mainBytes }, packages };
}

function formatBytes(bytes) {
  return String(bytes) + 'B（预算 ' + BUDGET_BYTES + 'B 的 ' + ((bytes / BUDGET_BYTES) * 100).toFixed(1) + '%）';
}

/**
 * 纯函数：按读数判预算。返回错误列表（空数组 = 通过）。
 * 注入 sizes 便于反例（先合法基线、再只有该闸能挡的超标读数），不读盘。
 */
function evaluate(sizes, budgetBytes) {
  const budget = typeof budgetBytes === 'number' ? budgetBytes : BUDGET_BYTES;
  const errors = [];
  const main = (sizes && sizes.main) || { files: 0, bytes: 0 };
  if (!main.files) errors.push('主包源码为空（空集不得判绿：目录口径或路径写错）');
  if (main.bytes > budget) errors.push('主包源码超预算: ' + formatBytes(main.bytes));
  const packages = (sizes && sizes.packages) || [];
  if (!packages.length) errors.push('分包读数为空（至少 3 个分包；空集不得判绿）');
  packages.forEach((pkg) => {
    const name = pkg && pkg.root ? pkg.root : '?';
    if (!pkg || !pkg.files) errors.push('分包缺失或为空: ' + name);
    else if (pkg.bytes > budget) errors.push('分包超预算: ' + name + ' ' + formatBytes(pkg.bytes));
  });
  return errors;
}

function run() {
  const ignored = readIgnoredFolders();
  if (ignored.error) return [ignored.error];
  let entries;
  try {
    entries = fs.readdirSync(ROOT, { withFileTypes: true });
  } catch (err) {
    return ['根目录不可枚举: ' + (err.message || err)];
  }
  const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  if (dirs.length === 0) return ['根目录枚举为空（空集不得判绿）'];
  const whitelist = new Set(SOURCE_DIRS);
  const leaked = dirs.filter((name) => !whitelist.has(name) && !ignored.folders.has(name));
  if (leaked.length) {
    return leaked.map((name) => '未在 packOptions.ignore（会被打进小程序包）: ' + name + '/');
  }
  const budgetErrors = evaluate(measure());
  return budgetErrors.length ? budgetErrors : null;
}

module.exports = { run, evaluate, measure, formatBytes, BUDGET_BYTES, SOURCE_DIRS, SUBPACKAGE_DIRS };
