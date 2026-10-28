// tools/lib/check-share.js · 门禁 #33「分享卡口中性」实现（从 tools/check.js 抽出，控制单文件 ≤1000 行）
// 判据（ENGINEERING §8.2 #33 / CONTRACT §8/§11、D36、D37）：
//   ① 19 个顾客/兼职业务页挂 onShareAppMessage；② 仅 role/home/help 三页挂 onShareTimeline；
//   ③ 后台 11 页零分享入口；④ 清单外页面不得私挂分享（新增页面必须同步 tools/lib/share-pages.js）；
//   ⑤ 卡片构造单源 utils/share/index.js：零 wx、零 L3 字段名、必须使用固定中性封面；
//   ⑥ 页面层零封面路径拼接；⑦ switch-bar 统一收口会话禁分享；⑧ app.js 识别单页模式（scene=1154）；
//   ⑨ D37 落地判据：好友转发卡片只能落 `/pages/launch/index`（绑定卡 `?bind=<合法兼职编号>`、通用卡零 query），
//      出现 role 等业务页直落即判红（否则新用户/版本变更会绕过启动页隐私同意闸）。
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const S = require('./share-pages');

const PAGE_DIRS = ['pages', 'pkg-customer', 'pkg-partner', 'pkg-admin'];
const L3_FIELDS = ['orderNo', 'pickupCode', 'dormKey', 'phoneTail', 'avatarFileId', 'displayName', 'viewTicket', 'openid'];

// D37 落地判据（纯函数，便于反例自检）：返回问题数组，空数组=合格。
// 合格形态只有两种：通用卡 path 逐字等于 LAUNCH_PAGE；绑定卡 LAUNCH_PAGE+'?bind='+合法兼职编号（canonical 归一后可解析）。
function landingProblemsOf(cardPath, launchPage, ids) {
  const problems = [];
  if (typeof cardPath !== 'string' || cardPath === '') {
    return ['卡片 path 为空/非字符串'];
  }
  if (cardPath === launchPage) {
    return problems;
  }
  const bindPrefix = launchPage + '?bind=';
  if (cardPath.indexOf(bindPrefix) !== 0) {
    problems.push('卡片 path 必须以 ' + launchPage + ' 开头（实际 ' + cardPath + '；直落业务页会绕过隐私同意闸）');
    return problems;
  }
  let raw = '';
  try {
    raw = decodeURIComponent(cardPath.slice(bindPrefix.length));
  } catch (err) {
    problems.push('卡片 path 的 bind 值不是合法编码');
    return problems;
  }
  const parsed = ids.parseNo(ids.normalizeInput(raw));
  if (!parsed.ok || parsed.kind !== ids.NO_KIND.PARTNER) {
    problems.push('卡片 path 的 bind 值不是合法兼职编号（实际 ' + raw + '）');
  }
  return problems;
}

function read(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
  } catch (err) {
    return '';
  }
}

function pageJsFiles() {
  const out = [];
  PAGE_DIRS.forEach((dir) => {
    const walk = (abs, rel) => {
      let entries = [];
      try {
        entries = fs.readdirSync(abs, { withFileTypes: true });
      } catch (err) {
        return;
      }
      entries.forEach((entry) => {
        const childAbs = path.join(abs, entry.name);
        const childRel = rel + '/' + entry.name;
        if (entry.isDirectory()) {
          walk(childAbs, childRel);
        } else if (entry.name === 'index.js') {
          out.push(childRel);
        }
      });
    };
    walk(path.join(ROOT, dir), dir);
  });
  return out;
}

function run() {
  const out = [];
  const pageFiles = pageJsFiles();
  S.APP_MESSAGE.forEach((rel) => {
    const source = read(rel);
    if (!/onShareAppMessage\(\)\s*\{/.test(source)) {
      out.push(rel + ': 缺 onShareAppMessage 好友转发');
    }
    if (source.indexOf('utils/share/handlers') === -1 && source.indexOf('parts/share-card') === -1) {
      out.push(rel + ': 分享未接 utils/share 纯件（页面自拼卡片?）');
    }
  });
  S.TIMELINE.forEach((rel) => {
    if (!/onShareTimeline\(\)\s*\{/.test(read(rel))) {
      out.push(rel + ': 缺 onShareTimeline 朋友圈钩子');
    }
  });
  S.ADMIN_PAGES.forEach((rel) => {
    if (/onShareAppMessage|onShareTimeline|open-type="share"/.test(read(rel))) {
      out.push(rel + ': 后台页出现分享入口（治理数据不外传）');
    }
  });
  pageFiles.filter((rel) => rel !== 'pages/launch/index.js' && rel.indexOf('pkg-admin/') !== 0).forEach((rel) => {
    if (/onShareAppMessage|onShareTimeline/.test(read(rel)) && S.APP_MESSAGE.indexOf(rel) === -1) {
      out.push(rel + ': 私挂分享钩子但不在清单内');
    }
  });
  const cards = read('utils/share/index.js');
  if (!cards) {
    out.push('utils/share/index.js: 缺失（卡片判据单源）');
  } else {
    if (/(^|[^A-Za-z0-9_$])wx\./.test(cards)) {
      out.push('utils/share/index.js: 含 wx 调用（纯件应零平台依赖）');
    }
    L3_FIELDS.forEach((token) => {
      if (cards.indexOf(token) !== -1) out.push('utils/share/index.js: 出现 L3 字段名 ' + token);
    });
    if (cards.indexOf('/assets/share/cover.png') === -1) {
      out.push('utils/share/index.js: 未使用固定中性封面（默认页面截图会带出 L3）');
    }
  }
  pageFiles.forEach((rel) => {
    if (read(rel).indexOf('assets/share/') !== -1) out.push(rel + ': 页面层拼封面路径（应只在 utils/share）');
  });
  if (read('components/switch-bar/index.js').indexOf('syncSession(') === -1) {
    out.push('components/switch-bar/index.js: 未调 syncSession（切换会话禁分享失效）');
  }
  const appJs = read('app.js');
  if (appJs.indexOf('singlePageNow') === -1 || appJs.indexOf('singlePage') === -1) {
    out.push('app.js: 未识别朋友圈单页模式（scene=1154 会误调云/登录）');
  }
  // D37：分享卡落地判据——卡片只能经 launch（隐私同意闸入口）；绑定卡 bind 值必须是合法兼职编号。
  const route = require(path.join(ROOT, 'config/route.js'));
  const ids = require(path.join(ROOT, 'utils/ids.js'));
  if (cards.indexOf('ROLE_PAGE') !== -1) {
    out.push('utils/share/index.js: 卡片 path 仍引用 ROLE_PAGE（D37：分享卡不直落业务页）');
  }
  let cardsLib = null;
  try {
    cardsLib = require(path.join(ROOT, 'utils/share/index.js'));
  } catch (err) {
    out.push('utils/share/index.js: 无法加载（D37 落地判据无法取证）');
  }
  if (cardsLib && typeof cardsLib.buildAppMessage === 'function') {
    const genericCard = cardsLib.buildAppMessage({ isCustomer: true, viewSession: false });
    landingProblemsOf(genericCard.path, route.LAUNCH_PAGE, ids)
      .forEach((msg) => out.push('utils/share/index.js: 通用邀请卡 ' + msg));
    const bindCard = cardsLib.buildAppMessage({
      isCustomer: false,
      viewSession: false,
      partnerCard: { partnerNo: 'P-7K2-M9X' }
    });
    landingProblemsOf(bindCard.path, route.LAUNCH_PAGE, ids)
      .forEach((msg) => out.push('utils/share/index.js: 绑定卡 ' + msg));
  }
  if (landingProblemsOf('/pages/role/index?bind=P7K2M9X', route.LAUNCH_PAGE, ids).length === 0) {
    out.push('D37 落地判据无牙：role 直落卡片未被判红');
  }
  return out.length ? out : null;
}

module.exports = { run };
