// tools/lib/check-share.js · 门禁 #33「分享卡口中性」实现（从 tools/check.js 抽出，控制单文件 ≤1000 行）
// 判据（ENGINEERING §8.2 #33 / CONTRACT §8/§11、D36）：
//   ① 19 个顾客/兼职业务页挂 onShareAppMessage；② 仅 role/home/help 三页挂 onShareTimeline；
//   ③ 后台 11 页零分享入口；④ 清单外页面不得私挂分享（新增页面必须同步 tools/lib/share-pages.js）；
//   ⑤ 卡片构造单源 utils/share/index.js：零 wx、零 L3 字段名、必须使用固定中性封面；
//   ⑥ 页面层零封面路径拼接；⑦ switch-bar 统一收口会话禁分享；⑧ app.js 识别单页模式（scene=1154）。
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const S = require('./share-pages');

const PAGE_DIRS = ['pages', 'pkg-customer', 'pkg-partner', 'pkg-admin'];
const L3_FIELDS = ['orderNo', 'pickupCode', 'dormKey', 'phoneTail', 'avatarFileId', 'displayName', 'viewTicket', 'openid'];

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
  return out.length ? out : null;
}

module.exports = { run };
