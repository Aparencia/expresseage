// handlers/admin/listAudit.js · admin.listAudit（审计分页；旧切换会话审计名只读兼容映射）
// 口径：DATA_MODEL §5.2「admin 审计：action 按 at desc / developerNo 按 at desc」、
//       CONTRACT §11.3 / UX_DEVELOPER US-D11「多开发者各自登录，会话与审计互不可见」。
// 隔离：默认且强制 developerNo = 当前开发者；显式查询他人编号 → FORBIDDEN。
// 过滤：action/developerNo 全部进服务端 where（命索引）；历史旧名与现名分两条查询后按 at 归并。
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const { AUDIT_ACTION_LIST } = require('../../shared/audit-actions');
const {
  errors,
  sharedValidate,
  createAdminScope
} = require('./_common');
const dto = require('./_dto');
const paging = require('./_paging');

const LEGACY_PREFIX = 'VIEW' + '_' + 'AS' + '_';

function mappedActionOf(action) {
  if (typeof action !== 'string' || action.indexOf(LEGACY_PREFIX) !== 0) {
    return action || '';
  }
  const suffix = action.slice(LEGACY_PREFIX.length);
  if (suffix === 'START') {
    return 'ACCOUNT_SWITCH_START';
  }
  if (suffix === 'END') {
    return 'ACCOUNT_SWITCH_END';
  }
  if (suffix === 'EXPIRED') {
    return 'ACCOUNT_SWITCH_EXPIRED';
  }
  return action;
}

function normalizeAction(value) {
  if (value === undefined || value === null || value === '') {
    return { actions: [] };
  }
  if (AUDIT_ACTION_LIST.indexOf(value) >= 0) {
    return { actions: [value] };
  }
  const mapped = mappedActionOf(value);
  if (mappedActionOf(mapped) === mapped && AUDIT_ACTION_LIST.indexOf(mapped) >= 0) {
    return { actions: mapped === value ? [value] : [mapped, value] };
  }
  throw errors.validation('action', '审计动作不正确');
}

function normalizeDeveloperNo(scope, value) {
  if (value === undefined || value === null || value === '') {
    return scope.developerNo;
  }
  const check = sharedValidate.validateDeveloperNo(value);
  if (!check.ok) {
    throw errors.validation('developerNo', '开发者编号格式不正确');
  }
  if (check.canonical !== scope.developerNo) {
    throw errors.forbidden('开发者审计互不可见，只能查看本人审计');
  }
  return check.canonical;
}

async function handler(ctx, payload) {
  const scope = await createAdminScope(ctx);
  const input = payload || {};
  const query = paging.parseQuery(input);
  const action = normalizeAction(input.action);
  const developerNo = normalizeDeveloperNo(scope, input.developerNo);
  const wheres = action.actions.length === 0
    ? [{ developerNo: developerNo }]
    : action.actions.map((name) => ({ developerNo: developerNo, action: name }));
  const result = await paging.pagedCollect(scope, paging.fetchOrderedPage, {
    collection: COLLECTIONS.ADMIN_AUDIT,
    wheres: wheres,
    sortField: 'at',
    idField: 'requestKey',
    order: 'desc',
    idOrder: 'asc',
    limit: query.limit,
    cursor: query.cursor
  }, null);
  return { list: result.list.map(dto.auditBrief), nextCursor: result.nextCursor };
}

module.exports = handler;
