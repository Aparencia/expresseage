// middleware/audit.js · 审计层（admin 审计 append-only；审计基础设施失败不静默吞）
// 说明：admin 业务 handler 自行写具体审计（detail 更准确）；本模块负责：
//   · 票据不能当后台凭据（admin.viewAsEnd 例外 = 退出会话）；
//   · 切换会话过期等「每票至多一条」的审计写入（writeOnce 按 requestKey 幂等）。
const { COLLECTIONS } = require('../db/collections');
const errors = require('../lib/errors');

function isAdminClientAction(action, spec) {
  return !!(spec && spec.visibility === 'client' && typeof action === 'string' && action.indexOf('admin.') === 0);
}

function buildRecord(ctx, record) {
  return {
    adminOpenid: record.adminOpenid !== undefined ? record.adminOpenid : ctx.identity.actorOpenid || ctx.openid || '',
    developerNo: record.developerNo !== undefined ? record.developerNo : ctx.identity.developerNo || '',
    action: record.action || '',
    target: record.target || { type: '', id: '' },
    detail: record.detail || {},
    at: record.at === undefined ? ctx.now : record.at,
    requestKey: record.requestKey || ''
  };
}

async function writeRecord(ctx, record) {
  try {
    return await ctx.dao.add(COLLECTIONS.ADMIN_AUDIT, buildRecord(ctx, record));
  } catch (error) {
    if (ctx.dao.isDuplicateError(error)) {
      return { duplicated: true };
    }
    console.error('[api] 审计写入失败', record && record.action, ctx.requestId);
    throw errors.internalError('审计写入失败，请稍后重试');
  }
}

// 同一 requestKey 至多一条（切换会话过期审计、审计类写动作幂等均走这里）。
async function writeOnce(ctx, record) {
  const doc = buildRecord(ctx, record);
  if (doc.requestKey) {
    const existing = await ctx.dao.findOne(COLLECTIONS.ADMIN_AUDIT, { where: { requestKey: doc.requestKey }, limit: 1 });
    if (existing) {
      return { duplicated: true };
    }
  }
  return writeRecord(ctx, doc);
}

function queue(state, record) {
  if (!state.meta.pendingAudit) {
    state.meta.pendingAudit = [];
  }
  state.meta.pendingAudit.push(record);
}

async function middleware(state) {
  const spec = state.meta.spec || {};
  const ctx = state.ctx;
  const exitAction = state.action === 'admin.viewAsEnd';
  if (state.meta.hasViewTicket && typeof state.action === 'string' && state.action.indexOf('admin.') === 0 && !exitAction) {
    throw errors.forbidden('切换会话不能执行开发者后台动作');
  }
  if (isAdminClientAction(state.action, spec) && !ctx.identity.developerNo) {
    throw errors.forbidden('当前身份无权使用开发者后台');
  }
  return state;
}

// handler 成功后的审计补写（由中间件在链路前段登记；目前用于每票至多一条的过期审计）。
async function finish(state) {
  const pending = state.meta.pendingAudit || [];
  for (let i = 0; i < pending.length; i += 1) {
    await writeOnce(state.ctx, pending[i]);
  }
  return state;
}

module.exports = {
  middleware,
  finish,
  queue,
  writeRecord,
  writeOnce,
  isAdminClientAction
};
