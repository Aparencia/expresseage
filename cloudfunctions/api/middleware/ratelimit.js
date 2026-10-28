// middleware/ratelimit.js · 限流（counters.rl:{scope}:{subject}:{window}；切换会话按 effectiveOpenid 独立计）
// 口径：CONTRACT §10、ENGINEERING §4.3 #5/#6.5；配额默认取 CONTRACT §10。
// ai.parseParcel 例外：本层不抛 RATE_LIMITED（handler 内静默降级并入队）。
const { COLLECTIONS } = require('../db/collections');
const time = require('../lib/time');
const errors = require('../lib/errors');

const AI_ACTION = 'ai.parseParcel';
const SUBJECT_IDENTITY = 'identity';
const SUBJECT_ACTOR = 'actor';
const SUBJECT_ORDER = 'order';

// 配额表（scope / limit / 主体 / 条件）；upload.prepare 按用途拆两条。
// v1.1/D34 安全基线增补：资料保存/服务配置/解绑/异常上报/临时 URL 签发/后台补录与配置写均限流，
// 防止刷写、头像反复替换、截图 URL 枚举与后台误操作轰炸；数值取「不伤正常 UX」的日额度。
const RATE_RULES = Object.freeze([
  { action: 'bind.create', scope: 'bind', limit: 5, subject: SUBJECT_IDENTITY },
  { action: 'bind.release', scope: 'bindRelease', limit: 10, subject: SUBJECT_IDENTITY },
  { action: 'partner.getPublic', scope: 'partnerPublic', limit: 5, subject: SUBJECT_IDENTITY },
  { action: 'partner.activate', scope: 'activate', limit: 5, subject: SUBJECT_IDENTITY, refundOnSuccess: true },
  { action: 'partner.saveProfile', scope: 'partnerProfileSave', limit: 30, subject: SUBJECT_IDENTITY },
  { action: 'partner.saveServiceConfig', scope: 'serviceConfigSave', limit: 30, subject: SUBJECT_IDENTITY },
  { action: 'partner.unbindCustomer', scope: 'partnerUnbind', limit: 10, subject: SUBJECT_IDENTITY },
  { action: 'customer.saveProfile', scope: 'profileSave', limit: 30, subject: SUBJECT_IDENTITY },
  { action: 'order.create', scope: 'order', limit: 20, subject: SUBJECT_IDENTITY },
  { action: 'order.imageUrl', scope: 'imageUrl', limit: 200, subject: SUBJECT_IDENTITY },
  { action: 'message.send', scope: 'message', limit: 30, subject: SUBJECT_ORDER },
  { action: 'order.correct', scope: 'orderCorrect', limit: 20, subject: SUBJECT_ORDER },
  { action: 'order.reportException', scope: 'orderException', limit: 10, subject: SUBJECT_ORDER },
  { action: 'order.resolveException', scope: 'orderResolve', limit: 10, subject: SUBJECT_ORDER },
  { action: 'upload.prepare', scope: 'upload', limit: 30, subject: SUBJECT_IDENTITY, purpose: 'TICKET' },
  { action: 'upload.prepare', scope: 'avatarUpload', limit: 5, subject: SUBJECT_IDENTITY, purpose: 'AVATAR' },
  { action: 'admin.viewAsStart', scope: 'accountSwitch', limit: 20, subject: SUBJECT_ACTOR },
  { action: 'admin.updateConfig', scope: 'adminConfig', limit: 20, subject: SUBJECT_ACTOR },
  { action: 'admin.getRecognitionFailure', scope: 'failureView', limit: 100, subject: SUBJECT_ACTOR },
  { action: 'admin.fixRecognitionFailure', scope: 'failureFix', limit: 50, subject: SUBJECT_ACTOR },
  { action: 'admin.ignoreRecognitionFailure', scope: 'failureIgnore', limit: 50, subject: SUBJECT_ACTOR }
]);

function rulesOf(action, payload) {
  const purpose = payload && typeof payload === 'object' ? payload.purpose : undefined;
  return RATE_RULES.filter((rule) => {
    if (rule.action !== action) {
      return false;
    }
    return !rule.purpose || rule.purpose === purpose;
  });
}

function subjectOf(ctx, rule, payload) {
  if (rule.subject === SUBJECT_ACTOR) {
    return ctx.openid || '';
  }
  if (rule.subject === SUBJECT_ORDER) {
    const orderNo = payload && typeof payload.orderNo === 'string' ? payload.orderNo : '';
    return orderNo ? ctx.identity.effectiveOpenid + ':' + orderNo : '';
  }
  return ctx.identity.effectiveOpenid || ctx.openid || '';
}

function counterKey(rule, subject, nowMs) {
  return 'rl:' + rule.scope + ':' + subject + ':' + 'd' + time.dayKey(nowMs);
}

async function increment(ctx, key, delta) {
  const step = delta && delta > 0 ? delta : 1;
  return ctx.dao.transaction(async (trx) => {
    const row = await trx.findOne(COLLECTIONS.COUNTERS, { where: { key } });
    if (!row) {
      await trx.add(COLLECTIONS.COUNTERS, { key, seq: step, updatedAt: ctx.now });
      return step;
    }
    const seq = (typeof row.seq === 'number' ? row.seq : 0) + step;
    await trx.update(COLLECTIONS.COUNTERS, row._id, { seq, updatedAt: ctx.now });
    return seq;
  });
}

async function decrement(ctx, key, delta) {
  const step = delta && delta > 0 ? delta : 1;
  try {
    await ctx.dao.transaction(async (trx) => {
      const row = await trx.findOne(COLLECTIONS.COUNTERS, { where: { key } });
      if (!row) {
        return;
      }
      const seq = Math.max(0, (typeof row.seq === 'number' ? row.seq : 0) - step);
      await trx.update(COLLECTIONS.COUNTERS, row._id, { seq, updatedAt: ctx.now });
    });
  } catch (error) {
    console.warn('[api] 限流计数回退失败', ctx.requestId);
  }
}

function itemCount(rule, payload) {
  if (!rule.perItem || !payload || !Array.isArray(payload.items)) {
    return 1;
  }
  return Math.max(1, payload.items.length);
}

async function middleware(state) {
  const spec = state.meta.spec || {};
  if (spec.visibility !== 'client' || state.action === AI_ACTION) {
    return state;
  }
  const payload = state.payload || {};
  const rules = rulesOf(state.action, payload);
  if (rules.length === 0) {
    return state;
  }
  const ctx = state.ctx;
  for (let i = 0; i < rules.length; i += 1) {
    const rule = rules[i];
    const subject = subjectOf(ctx, rule, payload);
    if (!subject) {
      continue;
    }
    const key = counterKey(rule, subject, ctx.now);
    let used;
    try {
      used = await increment(ctx, key, itemCount(rule, payload));
    } catch (error) {
      console.error('[api] 限流计数失败', state.action, ctx.requestId);
      if (spec.write) {
        throw errors.internalError('服务暂时不可用，请稍后重试');
      }
      continue;
    }
    if (used > rule.limit) {
      throw errors.rateLimited('操作太频繁，请明天再试');
    }
    if (rule.refundOnSuccess) {
      if (!state.meta.rateRefunds) {
        state.meta.rateRefunds = [];
      }
      state.meta.rateRefunds.push({ key, delta: itemCount(rule, payload) });
    }
  }
  return state;
}

// handler 成功后的计数回退（partner.activate 只计失败次数）
async function finish(state) {
  const refunds = state.meta.rateRefunds || [];
  for (let i = 0; i < refunds.length; i += 1) {
    await decrement(state.ctx, refunds[i].key, refunds[i].delta);
  }
  return state;
}

module.exports = {
  middleware,
  finish,
  RATE_RULES,
  rulesOf
};
