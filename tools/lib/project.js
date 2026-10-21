'use strict';
/**
 * tools/lib/project.js — v4 口径镜像常量（工具链共用；文档仍是唯一权威）。
 * 来源：docs/V4_CONTRACT.md v0.9 §4/§5.3/§7/§4.2、docs/V4_ENGINEERING.md §8.2。
 * 用途：check.js / check-docs.js / seed-dev.js / selftest-core.js 的期望值；
 * 文档改动时先改文档，再同步这里（check-docs 会做双向对帐）。
 */
const path = require('path');

const MAIN_PAGES = [
  'pages/launch/index',
  'pages/role/index',
  'pages/customer/home/index',
  'pages/customer/orders/index',
  'pages/partner/workbench/index',
  'pages/partner/customers/index',
  'pages/profile/index',
];

const SUBPACKAGES = {
  'pkg-customer': [
    'pages/bind/index',
    'pages/order-create/index',
    'pages/order-detail/index',
    'pages/messages/index',
    'pages/help/index',
  ],
  'pkg-partner': [
    'pages/activate/index',
    'pages/order-detail/index',
    'pages/create-on-behalf/index',
    'pages/customer-detail/index',
    'pages/service-settings/index',
    'pages/stats/index',
    'pages/messages/index',
  ],
  'pkg-admin': [
    'pages/overview/index',
    'pages/invite-codes/index',
    'pages/customers/index',
    'pages/customer-detail/index',
    'pages/partners/index',
    'pages/orders/index',
    'pages/order-detail/index',
    'pages/config/index',
    'pages/account-switch/index',
    'pages/messages/index',
    'pages/recognition-review/index',
  ],
};

/** 全部分包页的完整路径（app.json subpackages 口径）。 */
function subpackagePages() {
  const out = [];
  Object.keys(SUBPACKAGES).forEach((pkg) => {
    SUBPACKAGES[pkg].forEach((p) => out.push(pkg + '/' + p));
  });
  return out;
}

const ALL_PAGES = MAIN_PAGES.concat(subpackagePages());

/** tabBar.list 恰好 5 项（CONTRACT §7）。 */
const TAB_LIST = [
  'pages/customer/home/index',
  'pages/customer/orders/index',
  'pages/partner/workbench/index',
  'pages/partner/customers/index',
  'pages/profile/index',
];

/** 每角色 3 格（自定义 tabBar 渲染口径）。 */
const TAB_PAGES_BY_ROLE = {
  CUSTOMER: ['pages/customer/home/index', 'pages/customer/orders/index', 'pages/profile/index'],
  PARTNER: ['pages/partner/workbench/index', 'pages/partner/customers/index', 'pages/profile/index'],
};

/** 必须引用 switch-bar 的页面（主包 5 tab + pkg-customer 5 + pkg-partner 7）。 */
const SWITCH_BAR_PAGES = MAIN_PAGES.filter((p) => p !== 'pages/launch/index' && p !== 'pages/role/index')
  .concat(SUBPACKAGES['pkg-customer'].map((p) => 'pkg-customer/' + p))
  .concat(SUBPACKAGES['pkg-partner'].map((p) => 'pkg-partner/' + p));

/** CONTRACT §5.3 动作全集：module.action → { visibility, write }。 */
const ACTIONS = {};
function add(moduleName, names, write, visibility) {
  names.forEach((n) => {
    ACTIONS[moduleName + '.' + n] = { visibility: visibility || 'client', write: write !== false };
  });
}
const READ = false;
const WRITE = true;
add('user', ['bootstrap'], READ);
add('user', ['acceptPrivacy', 'deleteAccount'], WRITE);
add('customer', ['saveProfile'], WRITE);
add('customer', ['getProfile'], READ);
add('partner', ['activate', 'saveProfile', 'saveServiceConfig', 'unbindCustomer', 'saveCustomerNote'], WRITE);
add('partner', ['getPublic', 'listBindings', 'getCustomer', 'stats'], READ);
add('bind', ['create', 'release'], WRITE);
add('bind', ['getCurrent'], READ);
add('bind', ['claimGuestOrder'], WRITE);
add('order', ['create', 'createBatch', 'accept', 'reject', 'markPicked', 'unmarkPicked', 'markDelivered',
  'unmarkDelivered', 'reportException', 'resolveException', 'cancel', 'confirmDelivery', 'correct', 'undo',
  'deleteRecord'], WRITE);
add('order', ['get', 'listCustomer', 'listPartner', 'imageUrl'], READ);
add('message', ['send', 'markRead'], WRITE);
add('message', ['list'], READ);
add('upload', ['prepare', 'cancel'], WRITE);
add('config', ['getPublic'], READ);
add('admin', ['createInvites', 'revokeInvite', 'setPartnerStatus', 'updateConfig', 'viewAsStart', 'viewAsEnd',
  'createTestAccount', 'deleteTestAccount', 'purgeTestData', 'fixRecognitionFailure', 'ignoreRecognitionFailure'], WRITE);
add('admin', ['listInvites', 'listCustomers', 'getCustomer', 'listPartners', 'listOrders', 'getOrder', 'listAudit',
  'stats', 'listTestAccounts', 'listRecognitionFailures', 'getRecognitionFailure'], READ);
add('admin', ['bootstrap'], READ, 'internal');
add('ai', ['parseParcel'], WRITE);
add('health', ['check'], READ, 'internal');
// cleanup 定时任务（内部动作；只由定时触发器调用，不注册给客户端）
add('cleanup', ['orderTimeout', 'autoComplete', 'files', 'tickets', 'viewSessions', 'retention',
  'accountDeletion', 'invitationCodes', 'rateLimits', 'recomputeStats', 'recognitionFailures', 'testData',
  'testAccountsDeletion'], WRITE, 'internal');

/** P1 预留动作（CONTRACT 表在册但 MVP 不实现；注册表可缺省，出现则须 client）。 */
const P1_ACTIONS = ['order.guestClaim'];

/** internal 动作（不对客户端开放）。 */
const INTERNAL_ACTIONS = Object.keys(ACTIONS).filter((a) => ACTIONS[a].visibility === 'internal');

/** CONTRACT §5.3 错误码唯一集（13 个，v0.9）。 */
const ERROR_CODES = ['VALIDATION_FAILED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'INVALID_TRANSITION',
  'INVALID_STATE', 'RATE_LIMITED', 'INVITE_EXPIRED', 'INVITE_USED', 'VIEW_TICKET_EXPIRED', 'PARTNER_CLOSED',
  'DEPENDENCY_FAILED', 'INTERNAL_ERROR'];

/** v0.5 及以前的旧错误码（必须零残留）。 */
const OLD_ERROR_CODES = ['UNAUTHENTICATED', 'UNKNOWN_ACTION', 'INVALID_PARAM', 'VERSION_CONFLICT',
  'CODE_EXPIRED', 'CODE_USED', 'NOT_IMPLEMENTED'];

/** CONTRACT §4 集合（14 个）。 */
const COLLECTIONS = ['users', 'customers', 'partners', 'bindings', 'orders', 'order_events', 'order_messages',
  'invitation_codes', 'admin_view_sessions', 'counters', 'config', 'admin_audit', 'upload_tickets',
  'recognition_failures'];

/** CONTRACT §4.2 admin_audit.action 全集（16 个；VIEW_AS_* 作废）。 */
const AUDIT_ACTIONS = ['INVITE_CREATE', 'INVITE_REVOKE', 'PARTNER_SUSPEND', 'PARTNER_RESTORE', 'CONFIG_UPDATE',
  'ORDER_ANOMALY_CANCEL', 'BOOTSTRAP', 'FAILURE_IMAGE_VIEW', 'FAILURE_FIX', 'FAILURE_IGNORE',
  'ACCOUNT_SWITCH_START', 'ACCOUNT_SWITCH_END', 'ACCOUNT_SWITCH_EXPIRED', 'TEST_ACCOUNT_CREATE',
  'TEST_ACCOUNT_DELETE', 'TEST_DATA_PURGE'];

/** CONTRACT §7 / §12 文档地图（批 1 收口必须存在；batch 0 豁免集合见 ENGINEERING §8.3 #1）。 */
const DESIGN_DOCS = [
  'V4_REBUILD_SPEC.md',
  'docs/V4_CONTRACT.md',
  'docs/V4_DATA_MODEL.md',
  'docs/V4_UX_CUSTOMER.md',
  'docs/V4_UX_PARTNER.md',
  'docs/V4_UX_DEVELOPER.md',
  'docs/V4_ENGINEERING.md',
  'docs/V4_DECISIONS.md',
  'docs/QA_CHECKLIST.md',
  'docs/ARCHITECTURE.md',
  'docs/RUNBOOK.md',
  'docs/V4_FIXTURES.md',
];

const BATCH0_EXEMPT = ['AGENTS.md', 'STATE.md', 'CHANGELOG.md', 'docs/ARCHITECTURE.md', 'docs/RUNBOOK.md',
  'docs/V4_FIXTURES.md'];

/** check.js #5 必需文件（骨架 + 文档 + 云函数 package.json）。 */
const REQUIRED_FILES = ['README.md', 'AGENTS.md', 'STATE.md', 'CHANGELOG.md', 'check.ps1', 'gate.ps1', 'doctor.ps1',
  '.gitignore', '.tool-versions', '.env.example', 'cloudfunctions/api/package.json',
  'cloudfunctions/cleanup/package.json'].concat(DESIGN_DOCS);

/** 页面四件套扩展名。 */
const PAGE_EXTS = ['.js', '.json', '.wxml', '.wxss'];

/** check #23：viewTicket 字符串只允许出现在这两个位置。 */
const VIEW_TICKET_OWNERS = ['api/client.js', 'store/'];

/** check #24：客户端范围（零 AI Key/零外呼）。 */
const CLIENT_DIRS = ['pages', 'pkg-customer', 'pkg-partner', 'pkg-admin', 'api', 'store', 'utils', 'components',
  'config', 'shared'];

function pageDir(rel) {
  return path.posix.dirname(rel);
}

module.exports = {
  MAIN_PAGES,
  SUBPACKAGES,
  subpackagePages,
  ALL_PAGES,
  TAB_LIST,
  TAB_PAGES_BY_ROLE,
  SWITCH_BAR_PAGES,
  ACTIONS,
  P1_ACTIONS,
  INTERNAL_ACTIONS,
  ERROR_CODES,
  OLD_ERROR_CODES,
  COLLECTIONS,
  AUDIT_ACTIONS,
  DESIGN_DOCS,
  BATCH0_EXEMPT,
  REQUIRED_FILES,
  PAGE_EXTS,
  VIEW_TICKET_OWNERS,
  CLIENT_DIRS,
  pageDir,
};
