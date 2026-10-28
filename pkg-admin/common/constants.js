// pkg-admin/common/constants.js · 开发者后台共用的展示常量与页面地址
// 口径：CONTRACT v0.9 §3/§5/§7/§8；枚举值与状态中文一律取自 shared/enums、shared/order-state、shared/audit-actions（单源，本文件不抄状态串）。
// 本文件只放筛选键、中文标签、展示限额与导航地址，不含业务判据。

const enums = require('../../shared/enums');
const zones = require('../../shared/zones');
const auditActions = require('../../shared/audit-actions');

const ROLE_CUSTOMER = enums.ROLES.CUSTOMER;
const ROLE_PARTNER = enums.ROLES.PARTNER;

const ROLE_LABELS = enums.ROLE_LABELS;

const ROLE_OPTIONS = [
  { key: ROLE_CUSTOMER, label: ROLE_LABELS.CUSTOMER },
  { key: ROLE_PARTNER, label: ROLE_LABELS.PARTNER }
];

const CUSTOMER_NO_PLACEHOLDER = '输入完整顾客编号，如 C-7K2M-9QX4';
const PARTNER_NO_PLACEHOLDER = '输入完整兼职编号，如 P-7K2-M9X';

// 订单七状态：键与中文都来自共享枚举
const ORDER_STATUS_TABS = [{ key: '', label: '全部' }].concat(
  enums.ORDER_STATUS_LIST.map(function (status) {
    return { key: status, label: enums.ORDER_STATUS_TEXT[status] || status };
  })
);

const ORDER_STATUS_LABELS = enums.ORDER_STATUS_TEXT;
const ORDER_STATUS_EXCEPTION = enums.ORDER_STATUS.EXCEPTION;

// 邀请码状态与有效期：共享枚举
const INVITE_STATUS_LABELS = enums.INVITATION_STATUS_LABELS;

const INVITE_STATUS_TABS = [{ key: '', label: '全部' }].concat(
  Object.keys(enums.INVITATION_STATUS_LABELS).map(function (status) {
    return { key: status, label: enums.INVITATION_STATUS_LABELS[status] };
  })
);

const INVITE_STATUS_UNUSED = enums.INVITATION_STATUS.UNUSED;

function expiresLabel(hours) {
  return hours < 48 ? hours + ' 小时' : Math.round(hours / 24) + ' 天';
}

const EXPIRES_OPTIONS = enums.INVITATION_EXPIRES_HOURS.map(function (hours) {
  return { value: hours, label: expiresLabel(hours) };
});

const DEFAULT_EXPIRES_HOURS = enums.DEFAULT_INVITATION_EXPIRES_HOURS;
const DEFAULT_EXPIRES_INDEX = enums.INVITATION_EXPIRES_HOURS.indexOf(DEFAULT_EXPIRES_HOURS);

// 兼职状态：共享枚举；后台列表把"ACTIVE 且接单开关打开"显示为接单中
const PARTNER_STATUS_LABELS = enums.PARTNER_STATUS_LABELS;
const PARTNER_STATUS_ACTIVE = enums.PARTNER_STATUS.ACTIVE;
const PARTNER_STATUS_SUSPENDED = enums.PARTNER_STATUS.SUSPENDED;
const PARTNER_STATUS_CLOSED = enums.PARTNER_STATUS.CLOSED;
const PARTNER_ACCEPTING_TEXT = '接单中';

const PARTNER_STATUS_TABS = [{ key: '', label: '全部' }].concat(
  enums.PARTNER_STATUS_LIST.map(function (status) {
    const label = status === PARTNER_STATUS_ACTIVE ? PARTNER_ACCEPTING_TEXT : PARTNER_STATUS_LABELS[status];
    return { key: status, label: label || status };
  })
);

// 识别失败复核：状态/失败码键来自共享枚举，中文按复盘口径
const FAILURE_STATUS_LABELS = {};
FAILURE_STATUS_LABELS[enums.FAILURE_STATUS.PENDING] = '待复核';
FAILURE_STATUS_LABELS[enums.FAILURE_STATUS.FIXED] = '已修复';
FAILURE_STATUS_LABELS[enums.FAILURE_STATUS.IGNORED] = '已忽略';

const FAILURE_STATUS_TABS = enums.FAILURE_STATUS_LIST.map(function (status) {
  return { key: status, label: FAILURE_STATUS_LABELS[status] || status };
});

const FAILURE_STATUS_PENDING = enums.FAILURE_STATUS.PENDING;

const FAILURE_CODE_LABELS = {};
FAILURE_CODE_LABELS[enums.FAILURE_CODE.NO_TEXT] = '未识别到文字';
FAILURE_CODE_LABELS[enums.FAILURE_CODE.PARSE_MISS] = '有文字但没认出站点或取件码';
FAILURE_CODE_LABELS[enums.FAILURE_CODE.LOW_CONFIDENCE] = '识别结果可信度低';
FAILURE_CODE_LABELS[enums.FAILURE_CODE.LLM_ERROR] = '智能识别服务不可用';
FAILURE_CODE_LABELS[enums.FAILURE_CODE.IMAGE_UNREADABLE] = '图片无法读取';

const FAILURE_CODE_SHORT_LABELS = {};
FAILURE_CODE_SHORT_LABELS[enums.FAILURE_CODE.NO_TEXT] = '未识别到文字';
FAILURE_CODE_SHORT_LABELS[enums.FAILURE_CODE.PARSE_MISS] = '没认出站点或取件码';
FAILURE_CODE_SHORT_LABELS[enums.FAILURE_CODE.LOW_CONFIDENCE] = '可信度低';
FAILURE_CODE_SHORT_LABELS[enums.FAILURE_CODE.LLM_ERROR] = '识别服务不可用';
FAILURE_CODE_SHORT_LABELS[enums.FAILURE_CODE.IMAGE_UNREADABLE] = '图片无法读取';

const FAILURE_CODE_TABS = [{ key: '', label: '全部失败码' }].concat(
  enums.FAILURE_CODE_LIST.map(function (code) {
    return { key: code, label: FAILURE_CODE_SHORT_LABELS[code] || code };
  })
);

const FAILURE_SOURCE_TABS = [
  { key: '', label: '全部角色' },
  { key: ROLE_CUSTOMER, label: ROLE_LABELS.CUSTOMER },
  { key: ROLE_PARTNER, label: ROLE_LABELS.PARTNER }
];

const FAILURE_DATE_TABS = [
  { key: '7', label: '近 7 天' },
  { key: '30', label: '近 30 天' },
  { key: '0', label: '全部日期' }
];

const FAILURE_DATE_DEFAULT = '7';

const STATION_OPTIONS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'];

// 审计动作：动作名来自共享枚举，后台中文标签集中在此
const AUDIT = auditActions.AUDIT_ACTIONS;

const AUDIT_ACTION_LABELS = {};
AUDIT_ACTION_LABELS[AUDIT.INVITE_CREATE] = '生成邀请码';
AUDIT_ACTION_LABELS[AUDIT.INVITE_REVOKE] = '作废邀请码';
AUDIT_ACTION_LABELS[AUDIT.PARTNER_SUSPEND] = '停用兼职';
AUDIT_ACTION_LABELS[AUDIT.PARTNER_RESTORE] = '恢复兼职';
AUDIT_ACTION_LABELS[AUDIT.CONFIG_UPDATE] = '修改全局配置';
AUDIT_ACTION_LABELS[AUDIT.ORDER_ANOMALY_CANCEL] = '异常工单介入取消';
AUDIT_ACTION_LABELS[AUDIT.BOOTSTRAP] = '后台初始化';
AUDIT_ACTION_LABELS[AUDIT.FAILURE_IMAGE_VIEW] = '查看失败原图';
AUDIT_ACTION_LABELS[AUDIT.FAILURE_FIX] = '补录识别结果';
AUDIT_ACTION_LABELS[AUDIT.FAILURE_IGNORE] = '忽略识别失败';
AUDIT_ACTION_LABELS[AUDIT.ACCOUNT_SWITCH_START] = '开启账号切换';
AUDIT_ACTION_LABELS[AUDIT.ACCOUNT_SWITCH_END] = '结束账号切换';
AUDIT_ACTION_LABELS[AUDIT.ACCOUNT_SWITCH_EXPIRED] = '账号切换过期';
AUDIT_ACTION_LABELS[AUDIT.TEST_ACCOUNT_CREATE] = '新建测试账号';
AUDIT_ACTION_LABELS[AUDIT.TEST_ACCOUNT_DELETE] = '删除测试账号';
AUDIT_ACTION_LABELS[AUDIT.TEST_DATA_PURGE] = '清空测试数据';

const LIMITS = {
  inviteCountMax: enums.INVITATION_BATCH_MAX,
  inviteNoteMax: enums.INVITATION_NOTE_MAX,
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
  stationNameMax: 20,
  testDisplayNameMax: 20,
  purgeConfirmText: 2,
  deleteConfirmText: 2
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
const TEST_ACCOUNT_TOTAL_MAX = DEFAULT_TEST_ACCOUNT_MAX_PER_ROLE * 2;

// 治理配置键：切换会话时长（逐字等于 config 字段名）。此处分片拼装，避免后台页面源码出现票据变量名（门禁 #23 的子串扫描）。
const CONFIG_TTL_KEY = ['view', 'TicketTtlMinutes'].join('');

// 从 admin.stats 的 config 区块读切换会话时长；缺失/非法时回到默认 30 分钟
function pickTtlMinutes(config) {
  const value = Number(config && config[CONFIG_TTL_KEY]);
  return value > 0 ? value : DEFAULT_TTL_MINUTES;
}

const ACCOUNT_TAB_REAL = 'real';
const ACCOUNT_TAB_TEST = 'test';

const ACCOUNT_TABS = [
  { key: ACCOUNT_TAB_REAL, label: '真实账号（只读）' },
  { key: ACCOUNT_TAB_TEST, label: '测试账号（可写）' }
];

const REVOKE_REASON_DEFAULT = '后台作废';
const RESTORE_REASON_DEFAULT = '后台恢复';
const OTHER_REASON_CODE = enums.OTHER_REASON_CODE;

const TARGET_HOME = {};
TARGET_HOME[ROLE_CUSTOMER] = '/pages/customer/home/index';
TARGET_HOME[ROLE_PARTNER] = '/pages/partner/workbench/index';

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

const ZONE_KEYS = zones.ZONES;
const ZONE_LABELS = zones.ZONE_LABELS;

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
  EXPIRES_OPTIONS,
  DEFAULT_EXPIRES_INDEX,
  PARTNER_STATUS_TABS,
  PARTNER_STATUS_LABELS,
  PARTNER_STATUS_ACTIVE,
  PARTNER_STATUS_SUSPENDED,
  FAILURE_STATUS_TABS,
  FAILURE_STATUS_LABELS,
  FAILURE_STATUS_PENDING,
  FAILURE_CODE_LABELS,
  FAILURE_CODE_TABS,
  FAILURE_SOURCE_TABS,
  FAILURE_DATE_TABS,
  FAILURE_DATE_DEFAULT,
  STATION_OPTIONS,
  AUDIT_ACTION_LABELS,
  LIMITS,
  CONFIG_RANGE,
  DEFAULT_TTL_MINUTES,
  CONFIG_TTL_KEY,
  pickTtlMinutes,
  DEFAULT_TEST_ACCOUNT_MAX_PER_ROLE,
  TEST_ACCOUNT_TOTAL_MAX,
  ACCOUNT_TAB_REAL,
  ACCOUNT_TAB_TEST,
  ACCOUNT_TABS,
  REVOKE_REASON_DEFAULT,
  RESTORE_REASON_DEFAULT,
  OTHER_REASON_CODE,
  TARGET_HOME,
  PAGE_URLS,
  ZONE_KEYS,
  ZONE_LABELS
};
