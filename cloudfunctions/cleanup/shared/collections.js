// shared/collections.js · 云数据库集合注册表（唯一集合名来源，共 14 个）
// 契约：docs/V4_CONTRACT.md v0.9 §4 集合表；docs/ARCHITECTURE.md §4.3 冻结清单。
// 纪律：任何 handler / dao / sweep 只从这里取名；客户端不出现集合名字面量（ARCHITECTURE §1）。
//       本文件零 wx、零业务逻辑，可被客户端与云函数 shared/ 副本共同引用。
'use strict';

const COLLECTIONS = {
  USERS: 'users',
  CUSTOMERS: 'customers',
  PARTNERS: 'partners',
  BINDINGS: 'bindings',
  ORDERS: 'orders',
  ORDER_EVENTS: 'order_events',
  ORDER_MESSAGES: 'order_messages',
  INVITATION_CODES: 'invitation_codes',
  ADMIN_VIEW_SESSIONS: 'admin_view_sessions',
  COUNTERS: 'counters',
  CONFIG: 'config',
  ADMIN_AUDIT: 'admin_audit',
  UPLOAD_TICKETS: 'upload_tickets',
  RECOGNITION_FAILURES: 'recognition_failures'
};

// 固定顺序 = CONTRACT §4 表格顺序（admin.bootstrap 建集合/报错顺序与之一致）
const ALL_COLLECTIONS = Object.keys(COLLECTIONS).map((key) => COLLECTIONS[key]);

const COLLECTION_COUNT = 14;

// 单文档集合的固定 _id（config 只有一个全局文档）
const CONFIG_DOC_ID = 'global';

function isCollection(name) {
  return typeof name === 'string' && ALL_COLLECTIONS.indexOf(name) !== -1;
}

module.exports = {
  COLLECTIONS,
  ALL_COLLECTIONS,
  COLLECTION_COUNT,
  CONFIG_DOC_ID,
  isCollection
};
