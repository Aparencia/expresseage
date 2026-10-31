'use strict';
/**
 * tools/lib/check-pack-ignore.js · 门禁 #34「打包忽略清单」实现（TD-071）。
 * 判据（只读取数，不改 project.config.json、不跑 check.ps1）：
 *   ① 根目录下每个子目录必须 ∈ 小程序源码白名单，或 ∈ project.config.json 的
 *     packOptions.ignore 里 {type:'folder', value} 项；否则会被打进小程序包（工具/测试产物泄漏）。
 *   ② ignore 项归一化：去前导 "./"、去尾部 "/"（开发者工具两种写法都接受）。
 *   ③ ignore 指向不存在的目录不算错（node_modules/coverage 未生成是合法状态）。
 *   ④ project.config.json 缺失/不可解析/无 packOptions.ignore 数组 → 判红并给原因（不得静默通过）。
 *   ⑤ 空集不得判绿：根目录枚举为空 → 判红。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

/** 小程序源码目录白名单（可被打包目录；单源在本文件，新增源码目录必须同步这里）。 */
const SOURCE_DIRS = [
  'api', 'assets', 'components', 'config', 'custom-tab-bar', 'pages',
  'pkg-admin', 'pkg-customer', 'pkg-partner', 'shared', 'store', 'utils',
];

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
  return leaked.length
    ? leaked.map((name) => '未在 packOptions.ignore（会被打进小程序包）: ' + name + '/')
    : null;
}

module.exports = { run };
