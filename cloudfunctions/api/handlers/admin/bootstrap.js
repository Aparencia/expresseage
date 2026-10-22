// handlers/admin/bootstrap.js · admin.bootstrap（内部动作：幂等建/校验 14 集合与索引清单、写 config 种子）
'use strict';

const { COLLECTIONS, ALL_COLLECTIONS, CONFIG_DOC_ID } = require('../../shared/collections');
const { AUDIT_ACTIONS } = require('../../shared/audit-actions');
const {
  createAdminScope,
  createInternalScope
} = require('./_common');
const { DEFAULT_CONFIG, cloneDefault } = require('../../db/config');

// 必需索引清单（平台不支持代码建索引时只返回清单，由部署者在控制台补齐；见 RUNBOOK）
const INDEX_SPECS = Object.freeze([
  { collection: COLLECTIONS.CUSTOMERS, name: 'uk_customer_no', unique: true, fields: ['customerNo'] },
  { collection: COLLECTIONS.PARTNERS, name: 'uk_openid', unique: true, fields: ['openid'] },
  { collection: COLLECTIONS.PARTNERS, name: 'uk_partner_no', unique: true, fields: ['partnerNo'] },
  { collection: COLLECTIONS.BINDINGS, name: 'uk_active_key', unique: true, fields: ['activeKey'] },
  { collection: COLLECTIONS.BINDINGS, name: 'uk_tag_key', unique: true, fields: ['tagKey'] },
  { collection: COLLECTIONS.ORDERS, name: 'uk_order_no', unique: true, fields: ['orderNo'] },
  { collection: COLLECTIONS.ORDERS, name: 'uk_request_key', unique: true, fields: ['requestKey'] },
  { collection: COLLECTIONS.ORDER_EVENTS, name: 'uk_request_key', unique: true, fields: ['requestKey'] },
  { collection: COLLECTIONS.INVITATION_CODES, name: 'uk_code', unique: true, fields: ['code'] },
  { collection: COLLECTIONS.ADMIN_VIEW_SESSIONS, name: 'uk_request_key', unique: true, fields: ['requestKey'] },
  { collection: COLLECTIONS.COUNTERS, name: 'uk_key', unique: true, fields: ['key'] },
  { collection: COLLECTIONS.ADMIN_AUDIT, name: 'uk_request_key', unique: true, fields: ['requestKey'] },
  { collection: COLLECTIONS.UPLOAD_TICKETS, name: 'uk_ticket', unique: true, fields: ['ticket'] },
  { collection: COLLECTIONS.RECOGNITION_FAILURES, name: 'uk_failure_no', unique: true, fields: ['failureNo'] },
  { collection: COLLECTIONS.RECOGNITION_FAILURES, name: 'uk_request_key', unique: true, fields: ['requestKey'] }
]);

async function inspectCollections(scope) {
  const present = [];
  const missing = [];
  for (let i = 0; i < ALL_COLLECTIONS.length; i += 1) {
    const name = ALL_COLLECTIONS[i];
    try {
      await scope.dao.count(name);
      present.push(name);
    } catch (error) {
      missing.push(name);
    }
  }
  return { present: present, missing: missing };
}

async function ensureConfig(scope) {
  if (!scope.configSeeded) {
    const seed = cloneDefault();
    seed._id = CONFIG_DOC_ID;
    seed.updatedAt = scope.nowDate;
    await scope.dao.add(COLLECTIONS.CONFIG, seed);
    return { configSeeded: true, filledKeys: Object.keys(DEFAULT_CONFIG) };
  }
  // 已落库时按「原始文档」检查缺键（readConfig 会把默认值补齐，不能用合并结果判断）
  const raw = await scope.dao.get(COLLECTIONS.CONFIG, CONFIG_DOC_ID);
  const missingPatch = {};
  Object.keys(DEFAULT_CONFIG).forEach((key) => {
    if (!raw || raw[key] === undefined) {
      missingPatch[key] = cloneDefault()[key];
    }
  });
  if (Object.keys(missingPatch).length > 0) {
    missingPatch.updatedAt = scope.nowDate;
    await scope.dao.update(COLLECTIONS.CONFIG, CONFIG_DOC_ID, missingPatch);
  }
  return { configSeeded: true, filledKeys: Object.keys(missingPatch).filter((key) => key !== 'updatedAt') };
}

async function handler(ctx) {
  // 内部动作：开发者后台可调；部署脚本/控制台部署上下文（无 OPENID）也允许，身份记 SYSTEM。
  const scope = ctx && ctx.openid ? await createAdminScope(ctx) : await createInternalScope(ctx);
  const collections = await inspectCollections(scope);
  const config = await ensureConfig(scope);
  await scope.writeAudit(
    AUDIT_ACTIONS.BOOTSTRAP,
    { type: 'config', id: CONFIG_DOC_ID },
    {
      configSeeded: config.configSeeded,
      filledKeys: config.filledKeys,
      missingCollections: collections.missing,
      indexCount: INDEX_SPECS.length
    },
    ''
  );
  return {
    collections: collections.present,
    missingCollections: collections.missing,
    indexes: INDEX_SPECS.map((item) => ({
      collection: item.collection,
      name: item.name,
      unique: item.unique,
      fields: item.fields.slice()
    })),
    configSeeded: config.configSeeded
  };
}

module.exports = handler;
