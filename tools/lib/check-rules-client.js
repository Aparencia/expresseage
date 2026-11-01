'use strict';
/**
 * tools/lib/check-rules-client.js — 门禁 #09/#14/#15/#19/#21/#23/#24/#29/#31 的判据实现（批 T5-C 从 tools/check.js 逐字搬移）
 * 口径：docs/engineering/V4_ENGINEERING.md §8.2；PASS 条件/扫描范围/期望值一律与拆分前一致（批 T5-C 纯拆件）。
 * 每个导出 = 一条判据的函数体：返回 null / 问题数组 / { skip }，由 tools/check.js 的 check() 统一装配与打印。
 */
const path = require('path');
const F = require('./fsutil');
const P = require('./project');
const {
  RELS, PAGE_SCOPES, text, exists, rels, js, pagesJs, clientFiles, grep, shortList
} = require('./check-helpers');

/** 门禁 #09 WXML class 有定义（原 tools/check.js 判据体，逐字搬移）。 */
function wxmlClassDefined() {
  const appWxss = text('app.wxss') || '';
  const defs = new Map();
  const classSet = (css) => {
    const set = new Set();
    const re = /\.([A-Za-z_][A-Za-z0-9_-]*)/g;
    let m;
    while ((m = re.exec(css))) set.add(m[1]);
    return set;
  };
  const bad = [];
  const wxmls = RELS.filter((r) => /\.wxml$/.test(r) && PAGE_SCOPES.some((p) => r.startsWith(p))
    || /^components\/.*\.wxml$/.test(r) || /^custom-tab-bar\/.*\.wxml$/.test(r));
  for (const wxml of wxmls) {
    const cssRel = wxml.replace(/\.wxml$/, '.wxss');
    let css = text(cssRel) || '';
    // 跟随 @import 相对路径
    const imports = css.match(/@import\s+["']([^"']+)["']/g) || [];
    for (const imp of imports) {
      const m = imp.match(/["']([^"']+)["']/);
      if (!m) continue;
      const target = path.posix.join(path.posix.dirname(cssRel), m[1]);
      css += '\n' + (text(target) || '');
    }
    const defined = defs.get(cssRel) || classSet(css + '\n' + appWxss);
    defs.set(cssRel, defined);
    const s = text(wxml);
    if (s === null) continue;
    const re = /class\s*=\s*"([^"]*)"/g;
    let m;
    while ((m = re.exec(s))) {
      const v = m[1];
      if (v.indexOf('{{') !== -1 || v.indexOf('}}') !== -1) continue;
      v.split(/\s+/).filter(Boolean).forEach((cls) => {
        if (!defined.has(cls)) bad.push(wxml + ': .' + cls);
      });
    }
  }
  return bad.length ? shortList(bad, 12) : (wxmls.length === 0 ? ['WXML 样本为空（空集不得判绿）'] : null);
}

/** 门禁 #14 客户端禁直连（原 tools/check.js 判据体，逐字搬移）。 */
function clientNoDirectConnect() {
  const out = [];
  const cf = clientFiles();
  grep(cf, /wx\.cloud\.database/).forEach((h) => out.push('wx.cloud.database: ' + h));
  grep(cf.filter((r) => r !== 'api/client.js'), /callFunction/).forEach((h) => out.push('callFunction 越界: ' + h));
  grep(cf.filter((r) => r !== 'api/upload.js'), /uploadFile/).forEach((h) => out.push('uploadFile 越界: ' + h));
  if (!exists('api/client.js')) out.push('缺失: api/client.js');
  return out.length ? shortList(out, 10) : null;
}

/** 门禁 #15 本地存储唯一写口（原 tools/check.js 判据体，逐字搬移）。 */
function localStorageOnly() {
  const out = [];
  const files = clientFiles().filter((r) => r.endsWith('.js'));
  let total = 0;
  files.forEach((rel) => {
    const s = text(rel) || '';
    const code = F.stripComments(s);
    const hits = code.match(/wx\.[A-Za-z]*Storage[A-Za-z]*/g) || [];
    total += hits.length;
    if (hits.length && rel !== 'utils/storage.js') out.push(rel + ': ' + hits.join(','));
  });
  if (total === 0) out.push('wx.*Storage* 空集（空集不得判绿）');
  const st = text('utils/storage.js');
  if (st === null) out.push('缺失: utils/storage.js');
  else {
    ['viewTicket', 'viewContext', 'viewMode', 'targetIsTest'].forEach((k) => {
      if (st.indexOf(k) !== -1) out.push('utils/storage.js 出现票据字段: ' + k);
    });
    // D57（2026-11-01 用户拍板）：本机取件码键是唯一「L3 明文存本机」例外——
    // 只允许由 utils/storage.js 读写；客户端其它文件直接引用键名 = 绕过唯一写口，判红。
    const pickKey = 'ex_college_v4.pickcodes';
    if (st.indexOf(pickKey) === -1) out.push('utils/storage.js 缺 D57 本机取件码键: ' + pickKey);
    files.forEach((rel) => {
      if (rel === 'utils/storage.js') return;
      const code = F.stripComments(text(rel) || '');
      if (code.indexOf(pickKey) !== -1) out.push(rel + ': 直接引用本机取件码键（应经 utils/storage.js）');
    });
  }
  return out.length ? shortList(out, 10) : null;
}

/** 门禁 #19 敏感字面量（原 tools/check.js 判据体，逐字搬移）。 */
function sensitiveLiterals() {
  const out = [];
  // openid 形态：o + 27 位 [A-Za-z0-9_-]，且前后不得是标识符字符（防 recognitionFailureRetentionDays 这类误报）
  const openidRe = /(?:^|[^A-Za-z0-9_-])o[A-Za-z0-9_-]{27}(?![A-Za-z0-9_-])/;
  js().filter((r) => !r.startsWith('tools/')).forEach((rel) => {
    const s = text(rel) || '';
    s.split('\n').forEach((line, i) => {
      if (!openidRe.test(line)) return;
      if (/TEST-|example|示例|文档|placeholder/.test(line)) return;
      out.push(rel + ':' + (i + 1) + ': 疑似 openid 字面量');
    });
  });
  const env = text('config/env.js');
  if (env === null) out.push('缺失: config/env.js');
  else {
    const literals = [];
    const re = /['"]([^'"]*ENV_ID[^'"]*)['"]/g;
    let m;
    while ((m = re.exec(env))) literals.push(m[1]);
    if (literals.length === 0) {
      const envIdMatch = env.match(/envId\s*:\s*['"]([^'"]*)['"]/);
      if (envIdMatch) literals.push(envIdMatch[1]);
    }
    const configured = literals.filter((v) => v && !/^__.*__$/.test(v) && v.indexOf('__') !== 0);
    if (literals.length === 0) out.push('config/env.js 未见 envId/ENV_MAP 配置');
    else if (configured.length === 0) console.log('  · 提示: config/env.js 的 envId 仍为占位符（待用户在控制台回填，不算门禁失败）');
    configured.forEach((envId) => {
      RELS.filter((r) => r.endsWith('.js') && r !== 'config/env.js' && !r.startsWith('tools/')).forEach((rel) => {
        if ((text(rel) || '').indexOf(envId) !== -1) out.push(rel + ': 云环境 ID 越界');
      });
    });
  }
  js().filter((r) => !r.startsWith('tools/')).forEach((rel) => {
    const s = text(rel) || '';
    if (/ADMIN_OPENIDS\s*[:=]\s*\[/.test(s)) out.push(rel + ': ADMIN_OPENIDS 硬编码数组');
    if (P.CLIENT_DIRS.some((d) => rel.startsWith(d + '/')) && s.indexOf('ADMIN_OPENIDS') !== -1) {
      out.push(rel + ': 客户端出现 ADMIN_OPENIDS');
    }
  });
  return out.length ? shortList(out, 10) : null;
}

/** 门禁 #21 页面层零判据（原 tools/check.js 判据体，逐字搬移）。 */
function pageLayerZeroPolicy() {
  const out = [];
  const statuses = ['SUBMITTED', 'ACCEPTED', 'PICKED', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'EXCEPTION'];
  // 只有"页面脚本"受状态字面量约束；pkg-*/parts/** 是纯视图模型（允许状态→文案映射，lead 口径）
  const pageLayer = RELS.filter((r) => r.endsWith('.js') && /(^|\/)pages\//.test(r));
  pageLayer.forEach((rel) => {
    const s = text(rel) || '';
    if (/wx\.cloud\./.test(s)) out.push(rel + ': wx.cloud.*');
    statuses.forEach((st) => {
      if (new RegExp("['\"]" + st + "['\"]").test(s)) out.push(rel + ': 状态字面量 ' + st);
    });
  });
  // random / 编号生成：pages 与 parts 都不得出现（文案映射可以，生成不行）
  RELS.filter((r) => r.endsWith('.js') && (/(^|\/)pages\//.test(r) || /\/parts\//.test(r))).forEach((rel) => {
    const s = text(rel) || '';
    if (/Math\.random|\brandom\(/.test(s)) out.push(rel + ': random');
    if (/generate[A-Za-z]*(No|Code|Tag)|nextRoomTag|allocRoomTag/.test(s)) out.push(rel + ': 编号/roomTag 生成');
  });
  return out.length ? shortList(out, 12) : null;
}

/** 门禁 #23 切换会话接入（原 tools/check.js 判据体，逐字搬移）。 */
function switchSessionAccess() {
  const out = [];
  P.SWITCH_BAR_PAGES.forEach((page) => {
    const s = text(page + '.wxml');
    if (s === null) out.push('缺页面: ' + page + '.wxml');
    else if (s.indexOf('switch-bar') === -1) out.push(page + '.wxml 未引用 switch-bar');
  });
  rels('pkg-admin/').filter((r) => /\.(wxml|js)$/.test(r)).forEach((rel) => {
    const s = text(rel) || '';
    ['switch-bar', 'test-badge'].forEach((k) => { if (s.indexOf(k) !== -1) out.push(rel + ': pkg-admin 不得引用 ' + k); });
  });
  clientFiles().filter((r) => r.endsWith('.js')).forEach((rel) => {
    if (rel === 'api/client.js' || rel.startsWith('store/')) return;
    // 只拦裸 viewTicket 字面量；公开配置键 viewTicketTtlMinutes / view_ticket 合法
    if (/(?<![A-Za-z0-9_])viewTicket(?![A-Za-z0-9])/.test(text(rel) || '')) out.push(rel + ': viewTicket 外泄');
  });
  return out.length ? shortList(out, 10) : null;
}

/** 门禁 #24 客户端零 AI 外呼/零 Key（原 tools/check.js 判据体，逐字搬移）。 */
function clientNoAiKey() {
  const out = [];
  const cf = clientFiles();
  ['DEEPSEEK_API_KEY', 'api.deepseek.com'].forEach((k) => {
    grep(cf, new RegExp(k.replace(/[.]/g, '\\.'))).forEach((h) => out.push(k + ': ' + h));
  });
  // 大小写敏感：源码枚举值 'DEEPSEEK'（RECOGNITION_SOURCE）是合法口径，只有 API 客户端痕迹（deepseek/DeepSeek）才拦。
  // 例外（批 8）：CONTRACT §11.2 要求端内隐私文本明文披露第三方 AI 服务名「DeepSeek」——仅该纯文本数据文件豁免，
  // 并由下方补偿断言锁「零 Key/零端点/零 URL/零 require/fetch/wx.cloud/ai.parseParcel」。
  const PRIVACY_TEXT = 'pkg-customer/parts/privacy-text.js';
  grep(cf, /deepseek|DeepSeek/).forEach((h) => {
    if (h.indexOf(PRIVACY_TEXT + ':') === 0) return;
    out.push('deepseek: ' + h);
  });
  const pt = text(PRIVACY_TEXT);
  if (pt === null) {
    out.push('缺失: ' + PRIVACY_TEXT);
  } else {
    ['DEEPSEEK_API_KEY', 'api.deepseek.com', 'http://', 'https://', 'fetch(', 'require(', 'wx.cloud', 'ai.parseParcel']
      .forEach((k) => { if (pt.indexOf(k) !== -1) out.push(PRIVACY_TEXT + ': 披露文本禁止出现 ' + k); });
  }
  pagesJs().forEach((rel) => {
    if ((text(rel) || '').indexOf('ai.parseParcel') !== -1) out.push(rel + ': 页面直调 ai.parseParcel');
  });
  const apiAi = RELS.filter((r) => /^api\/.*\.js$/.test(r));
  if (!apiAi.some((r) => (text(r) || '').indexOf('ai.parseParcel') !== -1)) out.push('api/ 未见 ai.parseParcel 出口');
  return out.length ? shortList(out, 10) : null;
}

/** 门禁 #29 头像昵称（原 tools/check.js 判据体，逐字搬移）。 */
function avatarNickname() {
  const out = [];
  const uploadDomain = (rel) => /(^|\/)handlers\/upload\//.test(rel) || rel === 'api/upload.js';
  js().filter((r) => !r.startsWith('tools/')).forEach((rel) => {
    const s = text(rel) || '';
    // 只禁"路径模板/路径拼接"（avatars/{role}/、'avatars/' + 拼接）；用途枚举常量 AVATAR: 'avatars/' 是合法口径
    const isPathTemplate = /avatars\/[^'"`\n]*\$\{/.test(s) || /['"]avatars\/['"]\s*\+/.test(s);
    if (isPathTemplate && !uploadDomain(rel)) out.push(rel + ': 头像路径模板越界');
    if (/avatars\/[^'"`\n]*openid/.test(s)) out.push(rel + ': 头像路径含 openid');
  });
  // 脱敏单源 = db/dto/mask.js；旧路径 handlers/admin/dto/mask.js 已废弃（读空会让判据空转，缺失必须判红）
  const maskRel = 'cloudfunctions/api/db/dto/mask.js';
  const mask = text(maskRel);
  if (mask === null) out.push('脱敏件缺失: ' + maskRel);
  else if (mask.indexOf('avatarFileId') !== -1) out.push(maskRel + ': 不得含 avatarFileId');
  // 后台 DTO 单出口 handlers/admin/_dto.js：去注释后零 avatarFileId（注释里写"无 avatarFileId"不算命中）
  const dtoRel = 'cloudfunctions/api/handlers/admin/_dto.js';
  const dtoSrc = text(dtoRel);
  if (dtoSrc === null) out.push('后台 DTO 缺失: ' + dtoRel);
  else if (F.stripComments(dtoSrc).indexOf('avatarFileId') !== -1) out.push(dtoRel + ': 后台脱敏 DTO 回吐 avatarFileId');
  // 其它 admin handler：返回/赋值键（key: value）不得回吐 avatarFileId；
  // 造测试账号资料时的默认空串写入（avatarFileId: ''）不是回吐，不判红。
  rels('cloudfunctions/api/handlers/admin/').filter((r) => r.endsWith('.js') && r !== dtoRel).forEach((rel) => {
    const code = F.stripComments(text(rel) || '');
    const re = /(^|[^A-Za-z0-9_$])avatarFileId\s*:\s*([^\n,}]*)/gm;
    let m = re.exec(code);
    while (m !== null) {
      const value = (m[2] || '').trim();
      if (value !== "''" && value !== '""') out.push(rel + ': 返回/赋值键出现 avatarFileId');
      m = re.exec(code);
    }
  });
  rels('pkg-admin/').filter((r) => /\.(js|wxml)$/.test(r)).forEach((rel) => {
    if ((text(rel) || '').indexOf('avatarFileId') !== -1) out.push(rel + ': 后台出现 avatarFileId');
  });
  const profileJs = RELS.filter((r) => /handlers\/(customer|partner)\/.*(profile|activate)/.test(r) && r.endsWith('.js'));
  if (profileJs.length === 0) out.push('资料保存 handler 缺失');
  profileJs.forEach((rel) => {
    const s = text(rel) || '';
    if (s.indexOf('msgSecCheck') === -1) out.push(rel + ': 缺 msgSecCheck');
  });
  const tagAlloc = RELS.filter((r) => /tag-allocator/.test(r) && r.endsWith('.js'));
  tagAlloc.forEach((rel) => {
    const s = text(rel) || '';
    // 大写校验可由 toTag/isValidTag 零件保证，也可由显式正则保证
    if (!/toTag|isValidTag|\^\[A-Z\]\+|\[A-Z\]\+\$?/.test(s)) out.push(rel + ': roomTag 未见大写校验');
  });
  const roomTag = text('utils/room-tag.js');
  if (roomTag !== null && roomTag.indexOf('random') !== -1) out.push('utils/room-tag.js 不得含 random');
  return out.length ? shortList(out, 12) : null;
}

/** 门禁 #31 测试视觉（原 tools/check.js 判据体，逐字搬移）。 */
function testVisual() {
  const out = [];
  const stripWxmlComments = (s) => String(s).replace(/<!--[\s\S]*?-->/g, '');
  const reTest = /(?<![A-Za-z0-9_])TEST(?![A-Za-z0-9_])/;
  // 判据范围 = 客户端 UI 产物（pages/pkg/components/custom-tab-bar）；云侧 TEST- 合成 openid 前缀是合法口径
  RELS.filter((r) => /\.(wxml|js)$/.test(r) && /^(pages\/|pkg-|components\/|custom-tab-bar\/)/.test(r)
    && !r.startsWith('components/test-badge/') && !r.startsWith('tools/'))
    .forEach((rel) => {
      const raw = text(rel) || '';
      // 注释里的"TEST 角标"是说明文字，不算字面量；TEST_WRITE 由词边界排除
      const s = rel.endsWith('.js') ? F.stripComments(raw) : stripWxmlComments(raw);
      if (reTest.test(s)) out.push(rel + ': 孤立 TEST 字面量越界');
    });
  const badgeWxml = text('components/test-badge/index.wxml');
  const badgeJs = text('components/test-badge/index.js');
  if (badgeWxml === null) out.push('缺失: components/test-badge/index.wxml');
  else if ((badgeWxml + (badgeJs || '')).indexOf('TEST_WRITE') === -1) out.push('test-badge 未受 viewMode=TEST_WRITE 条件控制');
  // 切换条黄/蓝样式只在 switch-bar 组件内定义；其它 wxss 不得出现 switch-bar 选择器（颜色旁路）
  RELS.filter((r) => r.endsWith('.wxss') && !r.startsWith('components/switch-bar/')).forEach((rel) => {
    if ((text(rel) || '').indexOf('switch-bar') !== -1) out.push(rel + ': switch-bar 样式越界');
  });
  rels('pkg-admin/').filter((r) => /\.(wxml|js)$/.test(r)).forEach((rel) => {
    const s = text(rel) || '';
    ['switch-bar', 'test-badge'].forEach((k) => { if (s.indexOf(k) !== -1) out.push(rel + ': 后台不得引用 ' + k); });
  });
  return out.length ? shortList(out, 10) : null;
}

module.exports = {
  wxmlClassDefined,
  clientNoDirectConnect,
  localStorageOnly,
  sensitiveLiterals,
  pageLayerZeroPolicy,
  switchSessionAccess,
  clientNoAiKey,
  avatarNickname,
  testVisual
};
