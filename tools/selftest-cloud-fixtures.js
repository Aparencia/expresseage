'use strict';
/**
 * tools/selftest-cloud-fixtures.js · selftest-cloud 的假环境夹具（单文件 ≤1000 行红线的拆分，TD-029 同款）
 *
 * 只放"造环境"的件，不放断言：内容安全桩、14 集合预建 fake DB、dao 写入探针。
 * 拆分原因：selftest-cloud.js 已到 1000 行上限；夹具外移不改变套件注册与断言总数。
 */
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const API = path.join(ROOT, 'cloudfunctions/api');
const { COLLECTIONS } = require(path.join(API, 'shared/collections.js'));
const { createFakeDb, cmd } = require('./fake-db');

// 内容安全桩（v2）：customer.saveProfile / partner.* 会调 cloud.openapi.security.msgSecCheck；
// 单测零真实微信外呼，按 suggest 返回 pass/risky 两种结果。
function cloudStub(suggest) {
  const result = suggest || 'pass';
  return {
    openapi: {
      security: {
        msgSecCheck: async () => ({
          errCode: 0,
          result: { suggest: result, label: result === 'pass' ? 100 : 20001 }
        })
      }
    }
  };
}

function uniqueIndexesForApi() {
  return {
    users: [['_id']],
    customers: [['customerNo'], ['_id']],
    partners: [['openid'], ['partnerNo']],
    bindings: [['activeKey']],
    orders: [['orderNo'], ['requestKey']],
    order_events: [['requestKey']],
    counters: [['key']],
    admin_audit: [['requestKey']],
    admin_view_sessions: [['requestKey']],
    upload_tickets: [['ticket']],
    recognition_failures: [['failureNo'], ['requestKey']]
  };
}

const ALL_COLLECTION_NAMES = Object.keys(COLLECTIONS).map((key) => COLLECTIONS[key]);

// tools/fake-db.js 只在 seed 过的集合上持久化写入（未 seed 集合的写入落入临时 Map）；
// 测试库统一预建 14 个集合，避免"写入静默丢失"导致的假红。
function createTestDb() {
  const db = createFakeDb({ uniqueIndexes: uniqueIndexesForApi() });
  ALL_COLLECTION_NAMES.forEach((name) => db.seed(name, []));
  return db;
}

// dao.update 写入探针：只实现 updateWhere 需要的面，记录底层 payload。
// 用途：锁「对象字段必须包成整值替换指令 set」——真实 wx-server-sdk 会把嵌套对象拍平成点路径，
// 父字段为 null 时线上报 -502001（2026-10-22 隐私同意事故），fake DB 的替换语义曾掩盖该故障。
function createUpdateProbeDb() {
  const updates = [];
  const db = {
    command: cmd,
    collection(name) {
      return {
        where(condition) {
          return {
            async update(payload) {
              updates.push({ collection: name, condition, data: (payload && payload.data) || {} });
              return { stats: { updated: 1 } };
            }
          };
        }
      };
    }
  };
  return { db, updates };
}

module.exports = {
  cloudStub,
  uniqueIndexesForApi,
  createTestDb,
  createUpdateProbeDb
};
