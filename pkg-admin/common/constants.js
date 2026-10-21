// pkg-admin/common/constants.js · 开发者后台共用的展示常量与页面地址
// 口径：CONTRACT v0.9 §3/§5/§7/§8 与 docs/V4_UX_DEVELOPER.md；状态与脱敏数据一律以服务端 DTO 为准。
// 本文件只放筛选键、中文标签、展示限额与导航地址，不含业务判据。

const ROLE_CUSTOMER = 'CUSTOMER';
const ROLE_PARTNER = 'PARTNER';

const ROLE_LABELS = {
  CUSTOMER: '顾客',
  PARTNER: '兼职'
};

const ROLE_OPTIONS = [
  { key: ROLE_CUSTOMER, label: '顾客' },
  { key: ROLE_PARTNER, label: '兼职' }
];

const CUSTOMER_NO_PLACEHOLDER = '输入完整顾客编号，如 C-7K2M-9QX4';
const PARTNER_NO_PLACEHOLDER = '输入完整兼职编号，如 P-7K2-M9X';

const ORDER_STATUS_TABS = [
  { key: '', label: '全部' },
  { key: 'SUBMITTED', label: '待接单' },
  { key: 'ACCEPTED', label: '已接单' },
  { key: 'PICKED', label: '已取件' },
  { key: 'DELIVERED', label: '已送达' },
  { key: 'COMPLETED', label: '已完成' },
  { key: 'CANCELLED', label: '已取消' },
  { key: 'EXCEPTION', label: '异常' }
];

const ORDER_STATUS_LABELS = {
  SUBMITTED: '待接单',
  ACCEPTED: '已接单',
  PICKED: '已取件',
  DELIVERED: '已送达',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  EXCEPTION: '异常'
};

const ORDER_STATUS_EXCEPTION = 'EXCEPTION';

const INVITE_STATUS_TABS = [
  { key: '', label: '全部' },
  { key: 'UNUSED', label: '未使用' },
  { key: 'USED', label: '已使用' },
  { key: 'REVOKED', label: '已作废' },
  { key: 'EXPIRED', label: '已过期' }
];

const INVITE_STATUS_LABELS = {
  UNUSED: '未使用',
  USED: '已使用',
  REVOKED: '已作废',
  EXPIRED: '已过期'
};

const INVITE_STATUS_UNUSED = 'UNUSED';

const PARTNER_STATUS_TABS = [
  { key: '', label: '全部' },
  { key: 'ACTIVE', label: '接单中' },
  { key: 'SUSPENDED', label: '已停用' },
  { key: 'CLOSED', label: '已注销' }
];

const PARTNER_STATUS_LABELS = {
  ACTIVE: '接单中',
  SUSPENDED: '已停用',
  CLOSED: '已注销'
};

const PARTNER_STATUS_ACTIVE = 'ACTIVE';
const PARTNER_STATUS_SUSPENDED = 'SUSPENDED';
const PARTNER_STATUS_CLOSED = 'CLOSED';

const FAILURE_STATUS_TABS = [
  { key: 'PENDING', label: '待复核' },
  { key: 'FIXED', label: '已修复' },
  { key: 'IGNORED', label: '已忽略' }
];

const FAILURE_STATUS_LABELS = {
  PENDING: '待复核',
  FIXED: '已修复',
  IGNORED: '已忽略'
};

const FAILURE_STATUS_PENDING = 'PENDING';

const FAILURE_CODE_LABELS = {
  NO_TEXT: '未识别到文字',
  PARSE_MISS: '有文字但没认出站点或取件码',
  LOW_CONFIDENCE: '识别结果可信度低',
  LLM_ERROR: '智能识别服务不可用',
  IMAGE_UNREADABLE: '图片无法读取'
};

const FAILURE_CODE_TABS = [
  { key: '', label: '全部失败码' },
  { key: 'NO_TEXT', label: '未识别到文字' },
  { key: 'PARSE_MISS', label: '没认出站点或取件码' },
  { key: 'LOW_CONFIDENCE', label: '可信度低' },
  { key: 'LLM_ERROR', label: '识别服务不可用' },
  { key: 'IMAGE_UNREADABLE', label: '图片无法读取' }
];

const FAILURE_SOURCE_TABS = [
  { key: '', label: '全部角色' },
  { key: 'CUSTOMER', label: '顾客' },
  { key: 'PARTNER', label: '兼职' }
];

const FAILURE_DATE_TABS = [
  { key: '7', label: '近 7 天' },
  { key: '30', label: '近 30 天' },
  { key: '0', label: '全部日期' }
];

const STATION_OPTIONS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'];

const EXPIRES_OPTIONS = [
  { value: 24, label: '24 小时' },
  { value: 72, label: '72 小时' },
  { value: 168, label: '7 天' },
  { value: 720, label: '30 天' }
];

const DEFAULT_EXPIRES_HOURS = 168;

const AUDIT_ACTION_LABELS = {
  INVITE_CREATE: '生成邀请码',
  INVITE_REVOKE: '作废邀请码',
  PARTNER_SUSPEND: '停用兼职',
  PARTNER_RESTORE: '恢复兼职',
  CONFIG_UPDATE: '修改全局配置',
  ORDER_ANOMALY_CANCEL: '异常工单介入取消',
  BOOTSTRAP: '后台初始化',
  FAILURE_IMAGE_VIEW: '查看失败原图',
  FAILURE_FIX: '补录识别结果',
  FAILURE_IGNORE: '忽略识别失败',
  ACCOUNT_SWITCH_START: '开启账号切换',
  ACCOUNT_SWITCH_END: '结束账号切换',
  ACCOUNT_SWITCH_EXPIRED: '账号切换过期',
  TEST_ACCOUNT_CREATE: '新建测试账号',
  TEST_ACCOUNT_DELETE: '删除测试账号',
  TEST_DATA_PURGE: '清空测试数据'
};

const LIMITS = {
  inviteCountMax: 50,
  inviteNoteMax: 50,
  revokeReasonMax: 100,
  suspendReasonMax: 100,
  cancelReasonMax: 200,
  ignoreNoteMax: 100,
  pickupCodeMax: 40,
  ocrFoldAt: 1200,
  announcementTitleMax: 30,
  announcementTextMax: 500,
  maintenanceTextMax: 200,
  serviceNameMax: 20,
  serviceDescMax: 60,
  testDisplayNameMax: 20
};

const CONFIG_RANGE = {
  orderTimeoutMin: 10,
  orderTimeoutMax: 1440,
  autoCompleteMin: 1,
  autoCompleteMax: 168,
  screenshotMax: 7,
  ttlMin: 5,
  ttlMax: 60,
  avatarKbMin: 100,
  avatarKbMax: 200
};

const DEFAULT_TTL_MINUTES = 30;
const DEFAULT_TEST_ACCOUNT_MAX_PER_ROLE = 3;
const TEST_ACCOUNT_TOTAL_MAX = 6;

const ACCOUNT_TAB_REAL = 'real';
const ACCOUNT_TAB_TEST = 'test';

const ACCOUNT_TABS = [
  { key: ACCOUNT_TAB_REAL, label: '真实账号（只读）' },
  { key: ACCOUNT_TAB_TEST, label: '测试账号（可写）' }
];

const VIEW_MODE_READONLY = 'READONLY';
const VIEW_MODE_TEST_WRITE = 'TEST_WRITE';

const REVOKE_REASON_DEFAULT = '后台作废';

const TARGET_HOME = {
  CUSTOMER: '/pages/customer/home/index',
  PARTNER: '/pages/partner/workbench/index'
};

const PAGE_URLS = {
  overview: '/pkg-admin/pages/overview/index',
  inviteCodes: '/pkg-admin/pages/invite-codes/index',
  customers: '/pkg-admin/pages/customers/index',
  customerDetail: '/pkg-admin/pages/customer-detail/index',
  partners: '/pkg-admin/pages/partners/index',
  orders: '/pkg-admin/pages/orders/index',
  orderDetail: '/pkg-admin/pages/order-detail/index',
  config: '/pkg-admin/pages/config/index',
  accountSwitch: '/pkg-admin/pages/account-switch/index',
  messages: '/pkg-admin/pages/messages/index',
  recognitionReview: '/pkg-admin/pages/recognition-review/index',
  launch: '/pages/launch/index'
};

const ZONE_KEYS = ['D', 'X', 'N', 'B', 'C'];

const ZONE_DEFAULT_LABELS = {
  D: 'D 区',
  X: 'X 区',
  N: 'N 区',
  B: 'B 区',
  C: 'C 区'
};

module.exports = {
  ROLE_CUSTOMER,
  ROLE_PARTNER,
  ROLE_LABELS,
  ROLE_OPTIONS,
  CUSTOMER_NO_PLACEHOLDER,
  PARTNER_NO_PLACEHOLDER,
  ORDER_STATUS_TABS,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_EXCEPTION,
  INVITE_STATUS_TABS,
  INVITE_STATUS_LABELS,
  INVITE_STATUS_UNUSED,
  PARTNER_STATUS_TABS,
  PARTNER_STATUS_LABELS,
  PARTNER_STATUS_ACTIVE,
  PARTNER_STATUS_SUSPENDED,
  PARTNER_STATUS_CLOSED,
  FAILURE_STATUS_TABS,
  FAILURE_STATUS_LABELS,
  FAILURE_STATUS_PENDING,
  FAILURE_CODE_LABELS,
  FAILURE_CODE_TABS,
  FAILURE_SOURCE_TABS,
  FAILURE_DATE_TABS,
  STATION_OPTIONS,
  EXPIRES_OPTIONS,
  DEFAULT_EXPIRES_HOURS,
  AUDIT_ACTION_LABELS,
  LIMITS,
  CONFIG_RANGE,
  DEFAULT_TTL_MINUTES,
  DEFAULT_TEST_ACCOUNT_MAX_PER_ROLE,
  TEST_ACCOUNT_TOTAL_MAX,
  ACCOUNT_TAB_REAL,
  ACCOUNT_TAB_TEST,
  ACCOUNT_TABS,
  VIEW_MODE_READONLY,
  VIEW_MODE_TEST_WRITE,
  REVOKE_REASON_DEFAULT,
  TARGET_HOME,
  PAGE_URLS,
  ZONE_KEYS,
  ZONE_DEFAULT_LABELS
};
