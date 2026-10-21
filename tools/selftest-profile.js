'use strict';
/**
 * tools/selftest-profile.js — 头像/昵称/资料与本地存储纯件断言（S13；ENGINEERING §7.2 接入范式）。
 *
 * 覆盖：
 *   §4.1 头像选择校验（大小上限收敛/空文件/类型/超限/压缩计划）
 *   §4.2 默认头像（昵称首字色块，不占存储、不裂图）
 *   §5.6 本地存储白名单（唯一写口；只存 lastRole/guides/draftPointer；票据/视角上下文/L3 误写一律丢弃）
 *   §11  隐私同意三态（首次/版本变更/已同意/配置缺失 fail-closed；头像拒绝→默认头像不阻断）
 *   §4.2 昵称（必填、≤20 字符、超长截断而非报错、去首尾空白）
 *   §4.1 上传票据形态（avatarTicket 入参键；32 位不可猜票据）
 *   §4.1 AVATAR 云存储路径模板（服务端唯一构造点：avatars/{role}/{random}.jpg，零 openid）
 *
 * 纪律：不 mock 全局 wx（storage 走注入的内存 platform，avatar 只测纯函数）；
 *       云路径期望串用拼接构造，避免"路径模板字面量"误命中门禁口径；
 *       EXPECTED_ASSERTIONS 与实际断言数精确相等。
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const avatar = require(path.join(ROOT, 'utils/avatar.js'));
const storage = require(path.join(ROOT, 'utils/storage.js'));
const privacy = require(path.join(ROOT, 'utils/privacy-policy.js'));
const validate = require(path.join(ROOT, 'shared/validate.js'));
const launchRoute = require(path.join(ROOT, 'config/route.js'));
const uploadCommon = require(path.join(ROOT, 'cloudfunctions/api/handlers/upload/_common.js'));

const EXPECTED_ASSERTIONS = 98;

const TOKEN = 'T'.repeat(32);
const CONSENT_AT = 1700000000000;
const AVATAR_ROOT = ['ava', 'tars/'].join('');
const OPEN_ID_WORD = ['open', 'id'].join('');

function fakePlatform() {
  const bucket = {};
  return {
    bucket,
    api: {
      getStorageSync(key) {
        return bucket[key] === undefined ? '' : bucket[key];
      },
      setStorageSync(key, value) {
        bucket[key] = value;
      },
      removeStorageSync(key) {
        delete bucket[key];
      }
    }
  };
}

function keysOf(value) {
  return Object.keys(value || {}).sort();
}

function readSource(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function pick(source, fields) {
  const out = {};
  fields.forEach((key) => {
    out[key] = source[key];
  });
  return out;
}

function register(h) {
  // ---------------------------------------------------------------- §4.1 头像校验
  h.section('§4.1 头像选择校验（≤上限、jpg/png、超限压缩计划）', (t) => {
    t.eq(avatar.resolveMaxBytes(undefined), avatar.DEFAULT_MAX_BYTES, '配置缺失回默认上限（200KB）');
    t.eq(avatar.resolveMaxBytes(50 * 1024), avatar.MIN_MAX_BYTES, '过小上限收敛到下限（100KB）');
    t.eq(avatar.resolveMaxBytes(1024 * 1024), avatar.MAX_MAX_BYTES, '过大上限收敛到上限（500KB）');
    t.eq(pick(avatar.validatePicked({ size: 0, path: 'a.jpg' }), ['ok', 'reason']),
      { ok: false, reason: 'EMPTY' }, '空文件直拒（不给模糊提示）');
    t.eq(avatar.validatePicked({ size: 2048, path: 'a.gif', type: 'image/gif' }).reason, 'TYPE',
      '非 jpg/png 直拒');
    t.eq(avatar.validatePicked({ size: 300 * 1024, path: 'a.jpg', type: 'image/jpeg' }).reason, 'SIZE',
      '超过上限直拒');
    t.check(avatar.validatePicked({ size: 80 * 1024, path: 'a.jpg', type: 'image/jpeg' }).ok,
      '合法基线：80KB jpg 通过');
    const plan = avatar.planCompression({ width: 600, height: 400, size: 300 * 1024 }, 200 * 1024);
    t.eq(pick(plan, ['required', 'targetWidth', 'targetHeight', 'qualities']),
      { required: true, targetWidth: 200, targetHeight: 133, qualities: [85, 75, 65] },
      '超限才压缩：目标 200 长边 + 质量阶梯 85/75/65');
    const small = avatar.planCompression({ width: 100, height: 80, size: 50 * 1024 }, 200 * 1024);
    t.check(small.required === false && small.targetWidth === 100 && small.targetHeight === 80,
      '未超限不压缩、也不放大（100×80 原样）');
  });

  // ---------------------------------------------------------------- §4.2 默认头像
  h.section('§4.2 默认头像（昵称首字色块；无 fileId 不裂图）', (t) => {
    t.eq(avatar.initialOf('阿杰'), '阿', '中文取首字');
    t.eq(avatar.initialOf('  '), '?', '昵称空回兜底字符');
    t.eq(avatar.initialOf('alice'), 'A', '拉丁字母转大写首字');
    const fallback = avatar.viewModelOf('', '阿杰');
    t.check(fallback.isDefault === true && fallback.fileId === '' && fallback.initial === '阿'
      && typeof fallback.backgroundColor === 'string' && fallback.backgroundColor !== ''
      && typeof fallback.color === 'string' && fallback.color !== '',
      '无头像：默认头像视图模型齐备（首字 + 稳定色块）');
    const uploaded = avatar.viewModelOf('cloud://env/avatars/x.jpg', '阿杰');
    t.check(uploaded.isDefault === false && uploaded.fileId === 'cloud://env/avatars/x.jpg',
      '有 fileId：走真实头像（不覆盖为默认）');
    const blank = avatar.viewModelOf('   ', '阿杰');
    t.check(blank.isDefault === true && blank.fileId === '', '空白 fileId 归一为默认头像（不请求空地址裂图）');
    t.eq(avatar.defaultAvatarOf(''), avatar.defaultAvatarOf(''), '空昵称默认头像稳定（首字兜底 + 同色块）');
    t.check(avatar.initialOf('阿杰') === avatar.initialOf(' 阿杰 '), '首尾空白不改变默认头像首字');

    // 组件接线（静态有牙）：默认头像走纯件单源 + 图片加载失败必须兜底，删 require/binderror 即红
    const avatarViewJs = readSource('components/avatar-view/index.js');
    const avatarViewWxml = readSource('components/avatar-view/index.wxml');
    t.check(avatarViewJs.indexOf('utils/avatar') !== -1 && avatarViewJs.indexOf('viewModelOf') !== -1,
      'avatar-view 默认头像走 utils/avatar.js 纯件（组件内不另写一套首字/色块）');
    t.check(/binderror\s*=\s*"onError"/.test(avatarViewWxml),
      'avatar-view <image> 有 binderror 兜底（加载失败不裂图）');
    t.check(avatarViewWxml.indexOf('view.initial') !== -1 && avatarViewWxml.indexOf('view.backgroundColor') !== -1,
      'avatar-view 默认头像渲染首字 + 稳定色块（不空白）');
  });

  // ---------------------------------------------------------------- §5.6 存储白名单
  h.section('§5.6 本地存储白名单（唯一写口；票据/视角/L3 误写丢弃）', (t) => {
    t.eq(storage.KEY, 'ex_college_v4.store', '存储键唯一（v4 独立命名空间）');
    const sanitized = storage.normalize({
      lastRole: 'CUSTOMER',
      viewTicket: 'ticket-value',
      viewContext: { viewMode: 'READONLY' },
      viewMode: 'READONLY',
      targetIsTest: true,
      [OPEN_ID_WORD]: 'raw-identity'
    });
    t.eq(keysOf(sanitized), ['draftPointer', 'guides', 'lastRole'], '归一后只剩三个白名单字段');
    t.eq(storage.normalize({
      lastRole: 'PARTNER',
      guides: { PARTNER_WORKBENCH_V1: true, CUSTOMER_HOME_V1: 'yes' },
      draftPointer: 'draft_01'
    }), { lastRole: 'PARTNER', guides: { PARTNER_WORKBENCH_V1: true }, draftPointer: 'draft_01' },
    '合法值保留；非法 guide 值（非 true）丢弃');
    t.eq(storage.normalize({ lastRole: 'ADMIN' }).lastRole, null,
      'lastRole 只认两个业务角色（非法值读路径丢弃）');
    t.eq(storage.normalize({ lastRole: 123 }).lastRole, null,
      'lastRole 非字符串脏值丢弃（sanitize 不猜）');

    const plat = fakePlatform();
    t.check(storage.setLastRole('CUSTOMER', plat.api) === true
      && storage.getLastRole(plat.api) === 'CUSTOMER', 'lastRole 合法值可写可读');
    t.check(storage.setLastRole('ADMIN', plat.api) === false && storage.getLastRole(plat.api) === 'CUSTOMER',
      '非业务角色被拒且不覆盖原值');

    plat.bucket[storage.KEY] = JSON.stringify({
      lastRole: 'CUSTOMER',
      viewTicket: 'ticket-value',
      viewContext: { viewMode: 'READONLY' },
      viewMode: 'READONLY',
      targetIsTest: true
    });
    t.eq(keysOf(storage.load(plat.api)), ['draftPointer', 'guides', 'lastRole'],
      '历史/误写的票据与视角字段在读取时被剥掉');
    storage.setLastRole('PARTNER', plat.api);
    t.check(!/viewTicket|viewContext|viewMode|targetIsTest/.test(String(plat.bucket[storage.KEY])),
      '落盘 JSON 不含票据/视角上下文/L3 痕迹');

    t.check(storage.markGuideSeen('UNKNOWN_KEY', plat.api) === false
      && storage.markGuideSeen('CUSTOMER_HOME_V1', plat.api) === true
      && storage.isGuideSeen('CUSTOMER_HOME_V1', plat.api) === true, '引导标记只认白名单键');
    t.check(storage.clearGuideSeen('CUSTOMER_HOME_V1', plat.api) === true
      && storage.isGuideSeen('CUSTOMER_HOME_V1', plat.api) === false, '引导标记可清除（供重看）');
    t.check(storage.setDraftPointer('bad pointer!', plat.api) === false, '草稿指针非法字符被拒');
    t.check(storage.setDraftPointer('order-draft_01', plat.api) === true
      && storage.getDraftPointer(plat.api) === 'order-draft_01', '草稿指针合法值往返一致');
    t.check(storage.clearAll(plat.api) === true && JSON.stringify(storage.load(plat.api)) === JSON.stringify(storage.emptyState()),
      'clearAll 后回到空状态（换账号不留残渣）');
  });

  // ---------------------------------------------------------------- §3.6 启动分流矩阵
  h.section('§3.6 启动分流矩阵（单角色直进 / 双角色 CHOOSE_ROLE / 会话优先）', (t) => {
    t.eq(launchRoute.resolveLaunchRole({ roles: ['CUSTOMER'] }), 'CUSTOMER',
      '单角色直进：只有顾客角色时不需要 activeRole（AC-C-02）');
    t.eq(launchRoute.resolveLaunchRole({ roles: ['PARTNER'] }), 'PARTNER',
      '单角色直进：只有兼职角色时不需要 activeRole');
    t.eq(launchRoute.resolveLaunchRole({ roles: ['CUSTOMER', 'PARTNER'] }), '',
      '双角色无 activeRole：不猜角色（交角色页选择）');
    t.eq(launchRoute.resolveLaunchRole({ roles: ['CUSTOMER', 'PARTNER'], activeRole: 'PARTNER' }), 'PARTNER',
      '有 activeRole 时以显式角色为准（双角色优先级）');
    t.eq(launchRoute.decideLaunchRoute({ roles: ['CUSTOMER', 'PARTNER'] }),
      { url: launchRoute.ROLE_PAGE, reason: 'CHOOSE_ROLE' }, '双角色 → 角色页（CHOOSE_ROLE）');
    t.eq(launchRoute.decideLaunchRoute({ roles: ['CUSTOMER', 'PARTNER'], lastRole: 'CUSTOMER' }),
      { url: launchRoute.ROLE_PAGE, reason: 'CHOOSE_ROLE' },
      '路由输入不含 lastRole：建议只在角色页显示层消费（snapshot 形状冻结）');
    t.eq(launchRoute.decideLaunchRoute({ roles: ['CUSTOMER'], customer: { profileComplete: true } }),
      { url: launchRoute.CUSTOMER_HOME, reason: 'CUSTOMER_READY' }, '单角色顾客直进首页（无需 activeRole）');
    t.eq(launchRoute.decideLaunchRoute({ roles: ['CUSTOMER'], customer: { profileComplete: false } }),
      { url: launchRoute.PROFILE_PAGE, reason: 'CUSTOMER_PROFILE' }, '单角色顾客资料未完善 → 资料页');
    t.eq(launchRoute.decideLaunchRoute({ roles: ['PARTNER'], partner: { profileComplete: true, status: 'ACTIVE' } }),
      { url: launchRoute.PARTNER_WORKBENCH, reason: 'PARTNER_ACTIVE' }, '单角色兼职直进工作台（无需 activeRole）');
    t.eq(launchRoute.decideLaunchRoute({ roles: ['PARTNER'], partner: { profileComplete: false } }),
      { url: launchRoute.PROFILE_PAGE, reason: 'PARTNER_PROFILE' }, '单角色兼职资料未完善 → 资料页');
    t.eq(launchRoute.decideLaunchRoute({
      viewContext: { viewMode: 'TEST_WRITE', role: 'PARTNER' }, isDeveloper: true, roles: ['CUSTOMER', 'PARTNER']
    }), { url: launchRoute.PARTNER_WORKBENCH, reason: 'VIEW_CONTEXT' }, '切换会话优先于开发者与双角色选择');
    t.eq(launchRoute.decideLaunchRoute({ roles: [] }),
      { url: launchRoute.ROLE_PAGE, reason: 'NO_ROLE' }, '无角色 → 角色页（NO_ROLE，不空集放行）');

    t.eq(launchRoute.suggestedRoleOf(['CUSTOMER', 'PARTNER'], 'PARTNER'), 'PARTNER',
      '双角色：上次使用角色仍在列表内 → 给「上次使用」建议');
    t.eq(launchRoute.suggestedRoleOf(['CUSTOMER', 'PARTNER'], 'CUSTOMER'), 'CUSTOMER',
      '建议对称：上次是顾客就给顾客卡建议');
    t.eq(launchRoute.suggestedRoleOf(['CUSTOMER', 'PARTNER'], 'ADMIN'), '',
      '反例：非业务角色 lastRole（脏值）不给建议');
    t.eq(launchRoute.suggestedRoleOf(['CUSTOMER'], 'PARTNER'), '',
      '反例：上次角色已不在当前角色列表（换账号/注销）不给建议');
    t.eq(launchRoute.suggestedRoleOf(['CUSTOMER', 'PARTNER'], ''), '',
      '反例：没有 lastRole（首装/清缓存）不给建议，不自作主张');

    t.eq(launchRoute.roleOfDecision({ url: launchRoute.CUSTOMER_HOME, reason: 'CUSTOMER_READY' }), 'CUSTOMER',
      '进入顾客角色 → launch 记 lastRole（TD-008 生产调用点）');
    t.eq(launchRoute.roleOfDecision({ url: launchRoute.PROFILE_PAGE, reason: 'PARTNER_PROFILE' }), 'PARTNER',
      '进入兼职资料页 → 记 lastRole=PARTNER');
    t.eq(launchRoute.roleOfDecision({ url: launchRoute.ROLE_PAGE, reason: 'CHOOSE_ROLE' }), '',
      '选角色页不写 lastRole（用户还没选）');
    t.eq(launchRoute.roleOfDecision({ url: launchRoute.ADMIN_OVERVIEW, reason: 'DEVELOPER' }), '',
      '开发者后台不写 lastRole（不是业务角色）');
  });

  // ---------------------------------------------------------------- §5.6 lastRole 生产接入点
  h.section('§5.6 lastRole 生产接入点（TD-008 关闭证据：只经 utils/storage）', (t) => {
    const launchJs = readSource('pages/launch/index.js');
    const roleJs = readSource('pages/role/index.js');
    const profileJs = readSource('pages/profile/index.js');
    const activateJs = readSource('pkg-partner/pages/activate/index.js');
    const pageJs = [launchJs, roleJs, profileJs, activateJs].join('\n');
    t.check(launchJs.indexOf("require('../../utils/storage')") !== -1 && launchJs.indexOf('setLastRole') !== -1,
      'pages/launch 进入角色后写 lastRole（生产调用点 1）');
    t.check(roleJs.indexOf("require('../../utils/storage')") !== -1 && roleJs.indexOf('getLastRole') !== -1
      && roleJs.indexOf('suggestedRoleOf') !== -1,
    'pages/role 读 lastRole + 调纯件给「上次使用」建议（生产调用点 2）');
    t.check(roleJs.indexOf('setLastRole') !== -1, 'pages/role 选身份后写 lastRole（生产调用点 3）');
    t.check(profileJs.indexOf('setLastRole') !== -1, 'pages/profile 切换身份前写 lastRole（生产调用点 4）');
    t.check(activateJs.indexOf('setLastRole') !== -1, 'activate 成功进入兼职身份后写 lastRole（生产调用点 5）');
    t.check(!/wx\.(get|set|remove)StorageSync/.test(pageJs),
      '页面不直接摸平台 storage API（只经 utils/storage 唯一写口，门禁 #15 的判据侧）');
    t.check(!/privacyVersion/.test(launchJs),
      'launch 不在页面里比较隐私版本（状态机只在 utils/privacy-policy 纯件）');
    t.check(launchJs.indexOf('decideLaunchRoute') !== -1,
      'launch 分流走 config/route.js 纯函数（页面零业务判据）');
  });

  // ---------------------------------------------------------------- §11 隐私同意
  h.section('§11 隐私同意三态与降级（fail-closed）', (t) => {
    const config = { privacyVersion: '1.0.0' };
    t.eq(pick(privacy.consentStatus(null, config), ['reason', 'needsPrompt', 'canProceed', 'accepted']),
      { reason: 'FIRST_RUN', needsPrompt: true, canProceed: false, accepted: false }, '首次：必须弹窗');
    t.eq(pick(privacy.consentStatus({ version: '1.0.0', at: CONSENT_AT }, config),
      ['reason', 'needsPrompt', 'canProceed', 'accepted']),
    { reason: 'OK', needsPrompt: false, canProceed: true, accepted: true }, '版本一致：直接放行');
    t.eq(pick(privacy.consentStatus({ version: '0.9.0', at: CONSENT_AT }, config),
      ['reason', 'needsPrompt', 'canProceed']),
    { reason: 'VERSION_CHANGED', needsPrompt: true, canProceed: false }, '版本变更：重新征得同意');
    t.eq(pick(privacy.consentStatus({ version: '1.0.0', at: CONSENT_AT }, {}),
      ['reason', 'canProceed', 'needsPrompt']),
    { reason: 'CONFIG_MISSING', canProceed: false, needsPrompt: false }, '公开配置未就绪：fail-closed 不放行');
    t.check(privacy.buildConsent('', CONSENT_AT) === null
      && privacy.parseConsent({ version: '', at: 1 }) === null, '非法版本不得构造/解析出同意记录');
    t.eq(privacy.buildConsent('1.0.0', CONSENT_AT), { version: '1.0.0', at: CONSENT_AT },
      '同意记录时间戳取调用方传入的显式时间');
    t.eq(privacy.fallbackFor('AVATAR'),
      { scope: 'AVATAR', required: false, fallback: 'DEFAULT_AVATAR', blocking: false },
      '拒绝头像授权→默认头像，不阻断资料提交');
    t.eq(pick(privacy.consentStatus({ version: ' 1.0.0 ', at: CONSENT_AT }, config),
      ['reason', 'canProceed']), { reason: 'OK', canProceed: true },
    '同意记录与配置版本都去首尾空白后比较（不因空格反复弹窗）');
    t.eq(privacy.consentStatus({ version: '1.0.0', at: 0 }, config).reason, 'FIRST_RUN',
      '反例：无合法同意时间戳不算同意（重新弹窗）');
    t.eq(privacy.consentStatus({ version: '1.0.0', at: CONSENT_AT }, { privacyVersion: '1'.repeat(33) }).reason,
      'CONFIG_MISSING', '配置版本超 32 字符 → fail-closed 不放行');
    t.check(privacy.needsConsent(null, config) === true && privacy.isConsentValid(null, config) === false,
      'needsConsent/isConsentValid 与状态机一致（未同意不放行）');
    t.eq(privacy.docQuery('privacy'), '?doc=privacy', '隐私弹窗「查看全文」查询串单源');
    t.eq(privacy.docQuery('bogus'), '', '未知文档类型不拼查询串（不猜页面路径）');
    const matrix = privacy.scopeMatrix();
    t.check(matrix.length === privacy.SCOPES.length && matrix.every((row) => row.blocking === false),
      '授权拒绝矩阵：所有 scope 的降级都不阻断主流程');
    t.check(privacy.fallbackFor('NICKNAME').required === true && privacy.fallbackFor('AVATAR').required === false,
      '昵称必填、头像可拒绝→默认头像（D19 正反例）');
  });

  // ---------------------------------------------------------------- §4.2 昵称
  h.section('§4.2 昵称（必填、≤20 字符、超长截断）', (t) => {
    t.eq(pick(validate.validateDisplayName(''), ['ok', 'reason']), { ok: false, reason: 'REQUIRED' },
      '空昵称直拒');
    t.eq(pick(validate.validateDisplayName(123), ['ok', 'reason']), { ok: false, reason: 'TYPE' },
      '非字符串直拒');
    t.eq(pick(validate.validateDisplayName(' 阿杰 '), ['ok', 'value', 'truncated']),
      { ok: true, value: '阿杰', truncated: false }, '合法基线：去首尾空白');
    const longOne = '阿'.repeat(21);
    const truncated = validate.validateDisplayName(longOne);
    t.check(truncated.ok === true && truncated.truncated === true
      && truncated.value === '阿'.repeat(20) && Array.from(truncated.value).length === 20,
      '超 20 字符按口径截断到 20（不报错、不按字节截断）');
    t.check(validate.validateDisplayName('x'.repeat(20)).truncated === false,
      '边界：恰好 20 字符不截断');
  });

  // ---------------------------------------------------------------- §4.1 上传票据形态
  h.section('§4.1 上传票据入参键 avatarTicket（32 位不可猜票据）', (t) => {
    const tokenResult = validate.validateToken(TOKEN, 'avatarTicket');
    t.check(tokenResult.ok === true && tokenResult.field === 'avatarTicket' && tokenResult.value === TOKEN,
      '32 位票据合法且字段名为 avatarTicket');
    t.check(validate.validateToken('short', 'avatarTicket').ok === false
      && validate.validateToken('short', 'avatarTicket').field === 'avatarTicket',
    '长度不足直拒且错误定位到 avatarTicket 字段');
    t.check(validate.validateToken('a'.repeat(31) + '!', 'avatarTicket').ok === false,
      '含非法字符直拒（不猜、不自动修正）');
  });

  // ---------------------------------------------------------------- §4.1 AVATAR 路径模板
  h.section('§4.1 AVATAR 云路径模板（服务端唯一构造点、零 openid）', (t) => {
    const customerPath = uploadCommon.buildCloudPath('AVATAR', { role: 'CUSTOMER', random: 'abc123def456' });
    t.eq(customerPath, AVATAR_ROOT + 'customer/abc123def456' + '.jpg',
      '顾客头像路径 = avatars/customer/{random}.jpg');
    t.eq(uploadCommon.buildCloudPath('AVATAR', { role: 'PARTNER', random: 'r1' }),
      AVATAR_ROOT + 'partner/r1' + '.jpg', '兼职头像路径 = avatars/partner/{random}.jpg');
    t.eq(uploadCommon.buildCloudPath('AVATAR', { role: 'ADMIN', random: 'r2' }),
      AVATAR_ROOT + 'customer/r2' + '.jpg', '未知角色落 customer 目录（不新增第三目录）');
    t.eq(uploadCommon.buildCloudPath('TICKET', { ticket: TOKEN }), 'orders/' + TOKEN + '/image.jpg',
      '截图路径 = orders/{ticket}/image.jpg（与头像目录分离）');
    t.eq(uploadCommon.PATH_PREFIX.AVATAR, AVATAR_ROOT, '头像路径前缀单源常量与模板一致');
    t.check(customerPath.indexOf(OPEN_ID_WORD) === -1
      && uploadCommon.buildCloudPath('AVATAR', { role: 'PARTNER', random: 'r1' }).indexOf(OPEN_ID_WORD) === -1,
    '头像路径不含 ' + OPEN_ID_WORD + '（不可由身份枚举）');
  });

  // ---------------------------------------------------------------- §3.3 上传链顺序与入参
  h.section('§3.3 上传链顺序（本地校验/压缩 → prepare(size/contentType) → uploadFile）', (t) => {
    const uploadJs = readSource('api/upload.js');
    const start = uploadJs.indexOf('async function prepareAndUpload');
    const end = uploadJs.indexOf('async function cancelTicket');
    const body = start < 0 || end <= start ? '' : uploadJs.slice(start, end);
    const localAt = Math.min(body.indexOf('await prepareAvatar('), body.indexOf('await prepareTicket('));
    const prepareAt = body.indexOf('uploadModule.prepare(');
    const payloadAt = body.indexOf('const preparePayload =');
    const contentTypeAt = body.indexOf('preparePayload.contentType = contentTypeOf(');
    const guardAt = body.indexOf("if (purpose === 'AVATAR') {");
    t.check(body !== '' && localAt >= 0 && prepareAt > localAt,
      '先本地校验/压缩再申请票据（顺序反了服务端 size/类型闸空转，客户端可绕过）');
    t.check(/const preparePayload = \{ purpose, size: local\.size \};/.test(body),
      'prepare 入参带真实 size（压缩后 local.size；退回只传 purpose 即回归）');
    t.check(guardAt > payloadAt && guardAt < contentTypeAt && contentTypeAt < prepareAt,
      'AVATAR 才追加 contentType（由已校验扩展名派生）；TICKET 不传 contentType（聊天 gif 不误拦）');
    t.check(body.indexOf('uploadModule.prepare(preparePayload)') >= 0
      && body.indexOf('uploadModule.prepare({ purpose })') < 0,
    '旧形态 prepare({purpose})（无 size/contentType）不得回归');
    t.check(/jpg: 'image\/jpeg', jpeg: 'image\/jpeg', png: 'image\/png'/.test(uploadJs)
      && /avatar\.extensionOf\(filePath\) \|\| avatar\.extensionOf\(fallbackPath\)/.test(uploadJs),
    'contentType 由扩展名单源映射（jpg/jpeg→image/jpeg、png→image/png），不透传客户端自报 MIME');
    t.check(body.indexOf('await uploadFile(cloudPath, local.filePath)') > prepareAt,
      'uploadFile 在 prepare 之后（cloudPath/票据由服务端签发，size 用本地压缩后真实值）');
  });
}

module.exports = { EXPECTED_ASSERTIONS, register };

if (require.main === module) {
  const { createHarness, installCrashGuard } = require('./selftest');
  const h = createHarness({ name: 'selftest-profile' });
  installCrashGuard(() => ({ count: h.count, passed: h.passed, failures: h.failures.length }), 'selftest-profile');
  h.setExpected(EXPECTED_ASSERTIONS);
  register(h);
  const ret = h.finish();
  if (ret && typeof ret.then === 'function') ret.then(() => {});
}
