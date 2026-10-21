// shared/enums.js · v4 枚举值与中文文案单源（零 wx 纯数据，客户端/云函数共用）
// 契约：docs/V4_CONTRACT.md v0.9 §3/§5/§6/§10；docs/V4_DATA_MODEL.md §2/§4/§8；docs/ARCHITECTURE.md §4.3。
// 纪律：枚举字面量只在本文件出现一次；长度/字母表/前缀、状态中文、取消原因等中文都由这里下发，
//       页面与云函数禁止各写一份。本文件不含任何生成/存储逻辑（编号与 roomTag 的生成只在云端）。
'use strict';

// ── 角色与账号 ────────────────────────────────────────────────────────────────
const ROLES = {
  CUSTOMER: 'CUSTOMER',
  PARTNER: 'PARTNER'
};
const ROLE_LIST = [ROLES.CUSTOMER, ROLES.PARTNER];
const ROLE_LABELS = { CUSTOMER: '顾客', PARTNER: '兼职' };

const USER_STATUS = {
  ACTIVE: 'ACTIVE',
  DEACTIVATED: 'DEACTIVATED'
};

const PARTNER_STATUS = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  CLOSED: 'CLOSED'
};
const PARTNER_STATUS_LIST = [PARTNER_STATUS.ACTIVE, PARTNER_STATUS.SUSPENDED, PARTNER_STATUS.CLOSED];
const PARTNER_STATUS_LABELS = {
  ACTIVE: '正常',
  SUSPENDED: '已停用',
  CLOSED: '已注销'
};

// ── 订单七状态（CONTRACT §5 唯一口径）────────────────────────────────────────
const ORDER_STATUS = {
  SUBMITTED: 'SUBMITTED',
  ACCEPTED: 'ACCEPTED',
  PICKED: 'PICKED',
  DELIVERED: 'DELIVERED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  EXCEPTION: 'EXCEPTION'
};
const ORDER_STATUS_LIST = [
  ORDER_STATUS.SUBMITTED,
  ORDER_STATUS.ACCEPTED,
  ORDER_STATUS.PICKED,
  ORDER_STATUS.DELIVERED,
  ORDER_STATUS.COMPLETED,
  ORDER_STATUS.CANCELLED,
  ORDER_STATUS.EXCEPTION
];
const ORDER_STATUS_TEXT = {
  SUBMITTED: '待接单',
  ACCEPTED: '已接单',
  PICKED: '已取件·配送中',
  DELIVERED: '已送达·待确认',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  EXCEPTION: '异常·待处理'
};
const ORDER_STATUS_TERMINAL = {
  COMPLETED: true,
  CANCELLED: true
};
// 进行中（非终态）集合：兼职工作台五类状态桶与"有进行中订单"守卫都用它
const ORDER_ACTIVE_STATUSES = [
  ORDER_STATUS.SUBMITTED,
  ORDER_STATUS.ACCEPTED,
  ORDER_STATUS.PICKED,
  ORDER_STATUS.DELIVERED,
  ORDER_STATUS.EXCEPTION
];
// 顾客进度条五步（异常/取消分支单独展示）
const ORDER_PROGRESS_STEPS = [
  ORDER_STATUS.SUBMITTED,
  ORDER_STATUS.ACCEPTED,
  ORDER_STATUS.PICKED,
  ORDER_STATUS.DELIVERED,
  ORDER_STATUS.COMPLETED
];

const ORDER_SOURCE = {
  CUSTOMER: 'CUSTOMER',
  PARTNER: 'PARTNER'
};
const ORDER_SOURCE_LABELS = {
  CUSTOMER: '顾客下单',
  PARTNER: '代客下单'
};

const CANCELLED_BY = {
  CUSTOMER: 'CUSTOMER',
  PARTNER: 'PARTNER',
  SYSTEM: 'SYSTEM',
  ADMIN: 'ADMIN'
};
const CANCELLED_BY_LABELS = {
  CUSTOMER: '顾客取消',
  PARTNER: '兼职取消',
  SYSTEM: '系统取消',
  ADMIN: '开发者介入'
};

// 取消原因：顾客 5 / 兼职 4 / 系统 1（CONTRACT §5.2）；OTHER 必填备注，中文文案由服务端下发
const OTHER_REASON_CODE = 'OTHER';
const CANCEL_REASONS = {
  CUSTOMER: [
    { code: 'CHANGED_MIND', text: '不需要了' },
    { code: 'WRONG_INFO', text: '信息填错' },
    { code: 'DUPLICATE', text: '重复下单' },
    { code: 'PARTNER_UNREACHABLE', text: '联系不上兼职' },
    { code: 'OTHER', text: '其他原因' }
  ],
  PARTNER: [
    { code: 'TOO_BUSY', text: '忙不过来' },
    { code: 'OUT_OF_RANGE', text: '不在服务范围' },
    { code: 'SERVICE_OFF', text: '服务未开' },
    { code: 'OTHER', text: '其他原因' }
  ],
  SYSTEM: [{ code: 'TIMEOUT_UNACCEPTED', text: '超时未接单' }]
};
const CANCEL_REASON_TEXT = {};
Object.keys(CANCEL_REASONS).forEach((by) => {
  CANCEL_REASONS[by].forEach((item) => {
    if (!CANCEL_REASON_TEXT[item.code]) {
      CANCEL_REASON_TEXT[item.code] = item.text;
    }
  });
});

// 异常上报 6 值（ALTER 必填 text）
const EXCEPTION_CODES = [
  { code: 'CODE_INVALID', text: '取件码/柜号无效或已被取走' },
  { code: 'PARCEL_NOT_FOUND', text: '驿站找不到件' },
  { code: 'CABINET_ERROR', text: '柜门/设备故障' },
  { code: 'CUSTOMER_UNREACHABLE', text: '联系不上顾客' },
  { code: 'ADDRESS_ISSUE', text: '宿舍地址问题' },
  { code: 'OTHER', text: '其他异常（必填说明）' }
];
const EXCEPTION_OTHER_CODE = 'OTHER';

// 服务类型 5 类（CONTRACT §6：只写做什么，不含任何交易字段）
const SERVICES = [
  { code: 'PICKUP_STD', name: '标准代取', desc: '驿站取件送到宿舍楼下/约定地点' },
  { code: 'PICKUP_DOOR', name: '送寝上门', desc: '送到寝室门口（上楼）' },
  { code: 'PICKUP_URGENT', name: '加急代取', desc: '优先处理，承诺更快时效' },
  { code: 'DROP_OFF', name: '代寄快递', desc: '顾客把件交给兼职，兼职送驿站寄出' },
  { code: 'CUSTOM', name: '其他代办', desc: '需备注说明；兼职可拒单' }
];
const SERVICE_CODES = SERVICES.map((item) => item.code);
const SERVICE_NAME = {};
SERVICES.forEach((item) => {
  SERVICE_NAME[item.code] = item.name;
});
const URGENT_SERVICE_CODE = 'PICKUP_URGENT';
const DROP_OFF_SERVICE_CODE = 'DROP_OFF';

const CODE_STATUS = {
  OK: 'OK',
  NEED_CODE: 'NEED_CODE'
};
const CODE_STATUS_TEXT = {
  OK: '取件码可用',
  NEED_CODE: '需补充取件码'
};

const APPOINT_TYPE = {
  ASAP: 'ASAP',
  SLOT: 'SLOT'
};
const APPOINT_TYPE_TEXT = {
  ASAP: '尽快',
  SLOT: '预约时段'
};

// ── 绑定与 roomTag ───────────────────────────────────────────────────────────
const BINDING_STATUS = {
  ACTIVE: 'ACTIVE',
  RELEASED: 'RELEASED'
};
const RELEASE_REASONS = [
  { code: 'CUSTOMER_INITIATED', text: '顾客主动解绑' },
  { code: 'PARTNER_INITIATED', text: '兼职解除绑定' },
  { code: 'PARTNER_CLOSED', text: '兼职注销' },
  { code: 'ADMIN_ACTION', text: '开发者处理' },
  { code: 'CUSTOMER_ACCOUNT_CLOSED', text: '顾客注销' }
];
const RELEASE_REASON_TEXT = {};
RELEASE_REASONS.forEach((item) => {
  RELEASE_REASON_TEXT[item.code] = item.text;
});

// roomTag：Excel 列名式大写字母（A…Z、AA…），展示 D4-522A
const ROOM_TAG_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ROOM_TAG_PATTERN = /^[A-Z]+$/;
const ROOM_TAG_MIN_SEQ = 1;

// ── 邀请码 ───────────────────────────────────────────────────────────────────
const INVITATION_STATUS = {
  UNUSED: 'UNUSED',
  USED: 'USED',
  REVOKED: 'REVOKED',
  EXPIRED: 'EXPIRED'
};
const INVITATION_STATUS_LABELS = {
  UNUSED: '未使用',
  USED: '已使用',
  REVOKED: '已作废',
  EXPIRED: '已过期'
};
const INVITATION_EXPIRES_HOURS = [24, 72, 168, 720];
const DEFAULT_INVITATION_EXPIRES_HOURS = 168;
const INVITATION_BATCH_MAX = 50;
const INVITATION_NOTE_MAX = 50;

// ── 切换会话（真实账号只读 / 测试账号可写）──────────────────────────────────
const VIEW_MODE = {
  READONLY: 'READONLY',
  TEST_WRITE: 'TEST_WRITE'
};
const VIEW_MODE_LIST = [VIEW_MODE.READONLY, VIEW_MODE.TEST_WRITE];
const VIEW_MODE_TEXT = {
  READONLY: '开发者只读视角',
  TEST_WRITE: '测试账号'
};

// ── 上传票据与文件 ───────────────────────────────────────────────────────────
const UPLOAD_PURPOSE = {
  TICKET: 'TICKET',
  AVATAR: 'AVATAR'
};
// 云存储目录前缀只允许出现在云函数 handlers/upload 域（门禁 #29 头像路径口径），
// 客户端从不拼路径；本文件不登记路径前缀，避免小程序包内出现存储目录字面量。
const IMAGE_EXTENSIONS = ['jpg', 'png'];
const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png'];

// ── 识别兜底与失败复核（v0.8）───────────────────────────────────────────────
// 客户端可见的识别来源只有"规则命中/用户手改"两类；AI 兜底来源标识属云函数侧口径
// （lib/ai 与 handlers/ai 自持），不进 shared/**，保证小程序包内零第三方 AI 痕迹。
const RECOGNITION_SOURCE = {
  RULE: 'RULE',
  MANUAL: 'MANUAL'
};
const RECOGNITION_SOURCE_LIST = ['RULE', 'MANUAL'];
const RECOGNITION_SOURCE_TEXT = {
  RULE: '截图识别',
  MANUAL: '手动填写'
};
const CONFIDENCE_LEVEL = {
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW'
};
const CONFIDENCE_LEVEL_LIST = ['HIGH', 'MEDIUM', 'LOW'];
const FAILURE_CODE = {
  NO_TEXT: 'NO_TEXT',
  PARSE_MISS: 'PARSE_MISS',
  LOW_CONFIDENCE: 'LOW_CONFIDENCE',
  LLM_ERROR: 'LLM_ERROR',
  IMAGE_UNREADABLE: 'IMAGE_UNREADABLE'
};
const FAILURE_CODE_LIST = [
  FAILURE_CODE.NO_TEXT,
  FAILURE_CODE.PARSE_MISS,
  FAILURE_CODE.LOW_CONFIDENCE,
  FAILURE_CODE.LLM_ERROR,
  FAILURE_CODE.IMAGE_UNREADABLE
];
const FAILURE_STATUS = {
  PENDING: 'PENDING',
  FIXED: 'FIXED',
  IGNORED: 'IGNORED'
};
const FAILURE_STATUS_LIST = [FAILURE_STATUS.PENDING, FAILURE_STATUS.FIXED, FAILURE_STATUS.IGNORED];

// ── 订单事件类型（16 种，DATA_MODEL §8.4）────────────────────────────────────
const ORDER_EVENTS = [
  'ORDER_CREATED',
  'ACCEPTED',
  'REJECTED',
  'PICKED',
  'PICKED_REVERTED',
  'DELIVERED',
  'DELIVERED_REVERTED',
  'COMPLETED',
  'AUTO_COMPLETED',
  'CANCELLED',
  'TIMEOUT_CANCELLED',
  'EXCEPTION_REPORTED',
  'EXCEPTION_RESOLVED',
  'ORDER_CORRECTED',
  'DELETED_BY_CUSTOMER',
  'GUEST_ORDER_CLAIMED'
];
const ORDER_EVENT_COUNT = 16;

// ── 唯一编号（CONTRACT §3.1；32 字母表去掉易混的 0/O/1/I）──────────────────
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_ALPHABET_CLASS = '[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]';

const CUSTOMER_NO_PREFIX = 'C';
const CUSTOMER_NO_BODY_LENGTH = 8;
const CUSTOMER_NO_LENGTH = 9;
const CUSTOMER_NO_GROUPS = [4, 4];
const CUSTOMER_NO_PATTERN = /^C[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/;

const PARTNER_NO_PREFIX = 'P';
const PARTNER_NO_BODY_LENGTH = 6;
const PARTNER_NO_LENGTH = 7;
const PARTNER_NO_GROUPS = [3, 3];
const PARTNER_NO_PATTERN = /^P[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;

const DEVELOPER_NO_PATTERN = /^DEV-\d{2}$/;
const DEVELOPER_NO_SAMPLE = 'DEV-01';
const DEVELOPER_NO_PREFIX = 'DEV-';

const ORDER_NO_PATTERN = /^\d{8}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/;
const ORDER_NO_LENGTH = 13;
const FAILURE_NO_PATTERN = /^F-\d{8}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;
const FAILURE_NO_LENGTH = 17;

const INVITATION_CODE_LENGTH = 12;
const INVITATION_CODE_GROUPS = [4, 4, 4];
const INVITATION_CODE_PATTERN = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/;

// 上传票据 / 切换会话票据：32 位不可猜随机串（生成只在云端 crypto）
const TOKEN_LENGTH = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9]{32}$/;

// 编号种类（utils/ids.js parseNo 的 kind 值）
const NO_KIND = {
  CUSTOMER: 'CUSTOMER',
  PARTNER: 'PARTNER',
  DEVELOPER: 'DEVELOPER',
  UNKNOWN: 'UNKNOWN'
};

// 小工具：文案取词（找不到时返回空串，调用方决定兜底）
function orderStatusText(status) {
  return ORDER_STATUS_TEXT[status] || '';
}

function serviceNameOf(code) {
  return SERVICE_NAME[code] || '';
}

function cancelReasonText(code) {
  return CANCEL_REASON_TEXT[code] || '';
}

function releaseReasonText(code) {
  return RELEASE_REASON_TEXT[code] || '';
}

function isOrderStatus(status) {
  return ORDER_STATUS_LIST.indexOf(status) !== -1;
}

function isActiveOrderStatus(status) {
  return ORDER_ACTIVE_STATUSES.indexOf(status) !== -1;
}

function isTerminalOrderStatus(status) {
  return ORDER_STATUS_TERMINAL[status] === true;
}

module.exports = {
  ROLES,
  ROLE_LIST,
  ROLE_LABELS,
  USER_STATUS,
  PARTNER_STATUS,
  PARTNER_STATUS_LIST,
  PARTNER_STATUS_LABELS,
  ORDER_STATUS,
  ORDER_STATUS_LIST,
  ORDER_STATUS_TEXT,
  ORDER_STATUS_TERMINAL,
  ORDER_ACTIVE_STATUSES,
  ORDER_PROGRESS_STEPS,
  ORDER_SOURCE,
  ORDER_SOURCE_LABELS,
  CANCELLED_BY,
  CANCELLED_BY_LABELS,
  OTHER_REASON_CODE,
  CANCEL_REASONS,
  CANCEL_REASON_TEXT,
  EXCEPTION_CODES,
  EXCEPTION_OTHER_CODE,
  SERVICES,
  SERVICE_CODES,
  SERVICE_NAME,
  URGENT_SERVICE_CODE,
  DROP_OFF_SERVICE_CODE,
  CODE_STATUS,
  CODE_STATUS_TEXT,
  APPOINT_TYPE,
  APPOINT_TYPE_TEXT,
  BINDING_STATUS,
  RELEASE_REASONS,
  RELEASE_REASON_TEXT,
  ROOM_TAG_ALPHABET,
  ROOM_TAG_PATTERN,
  ROOM_TAG_MIN_SEQ,
  INVITATION_STATUS,
  INVITATION_STATUS_LABELS,
  INVITATION_EXPIRES_HOURS,
  DEFAULT_INVITATION_EXPIRES_HOURS,
  INVITATION_BATCH_MAX,
  INVITATION_NOTE_MAX,
  VIEW_MODE,
  VIEW_MODE_LIST,
  VIEW_MODE_TEXT,
  UPLOAD_PURPOSE,
  IMAGE_EXTENSIONS,
  IMAGE_MIME_TYPES,
  RECOGNITION_SOURCE,
  RECOGNITION_SOURCE_LIST,
  RECOGNITION_SOURCE_TEXT,
  CONFIDENCE_LEVEL,
  CONFIDENCE_LEVEL_LIST,
  FAILURE_CODE,
  FAILURE_CODE_LIST,
  FAILURE_STATUS,
  FAILURE_STATUS_LIST,
  ORDER_EVENTS,
  ORDER_EVENT_COUNT,
  CODE_ALPHABET,
  CODE_ALPHABET_CLASS,
  CUSTOMER_NO_PREFIX,
  CUSTOMER_NO_BODY_LENGTH,
  CUSTOMER_NO_LENGTH,
  CUSTOMER_NO_GROUPS,
  CUSTOMER_NO_PATTERN,
  PARTNER_NO_PREFIX,
  PARTNER_NO_BODY_LENGTH,
  PARTNER_NO_LENGTH,
  PARTNER_NO_GROUPS,
  PARTNER_NO_PATTERN,
  DEVELOPER_NO_PATTERN,
  DEVELOPER_NO_SAMPLE,
  DEVELOPER_NO_PREFIX,
  ORDER_NO_PATTERN,
  ORDER_NO_LENGTH,
  FAILURE_NO_PATTERN,
  FAILURE_NO_LENGTH,
  INVITATION_CODE_LENGTH,
  INVITATION_CODE_GROUPS,
  INVITATION_CODE_PATTERN,
  TOKEN_LENGTH,
  TOKEN_PATTERN,
  NO_KIND,
  orderStatusText,
  serviceNameOf,
  cancelReasonText,
  releaseReasonText,
  isOrderStatus,
  isActiveOrderStatus,
  isTerminalOrderStatus
};
