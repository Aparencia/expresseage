// handlers/admin/createInvites.js · admin.createInvites（批量发邀请码；响应仅本次返回完整码）
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const { AUDIT_ACTIONS } = require('../../shared/audit-actions');
const {
  enums,
  errors,
  sharedValidate,
  createAdminScope,
  requireClientRequestId,
  auditKeyOf,
  assertValid,
  readNote,
  codeTailOf
} = require('./_common');
const idGenerator = require('../../lib/id-generator');
const time = require('../../lib/time');

const BATCH_SEQ_MAX = 99;

function pad2(value) {
  return value < 10 ? '0' + value : String(value);
}

async function nextBatchSeq(scope) {
  const day = time.dayKey(scope.now);
  const key = 'inviteBatch:' + day;
  return scope.dao.transaction(async (trx) => {
    const row = await trx.findOne(COLLECTIONS.COUNTERS, { where: { key } });
    if (!row) {
      await trx.add(COLLECTIONS.COUNTERS, { key, seq: 1, updatedAt: scope.now });
      return 1;
    }
    const seq = (Number(row.seq) || 0) + 1;
    if (seq > BATCH_SEQ_MAX) {
      throw errors.invalidState('今日发码批次已用完，请明天再试');
    }
    await trx.update(COLLECTIONS.COUNTERS, row._id, { seq, updatedAt: scope.now });
    return seq;
  });
}

function parseCount(value) {
  const count = Number(value === undefined ? 1 : value);
  if (!Number.isFinite(count) || Math.floor(count) !== count || count < 1 || count > enums.INVITATION_BATCH_MAX) {
    throw errors.validation('count', '单次生成数量需为 1~50 的整数');
  }
  return count;
}

function parseExpiresInHours(value) {
  const hours = Number(value === undefined ? enums.DEFAULT_INVITATION_EXPIRES_HOURS : value);
  if (enums.INVITATION_EXPIRES_HOURS.indexOf(hours) < 0) {
    throw errors.validation('expiresInHours', '有效期只支持 24/72/168/720 小时');
  }
  return hours;
}

async function replayOf(scope, replay) {
  if (!replay || !replay.detail || !replay.detail.batchId) {
    return null;
  }
  const rows = await scope.dao.find(COLLECTIONS.INVITATION_CODES, {
    where: { batchId: replay.detail.batchId },
    orderBy: [['createdAt', 'asc']],
    limit: enums.INVITATION_BATCH_MAX
  });
  return {
    batchId: replay.detail.batchId,
    expiresAt: replay.detail.expiresAt || null,
    codes: rows.map((row) => row.code),
    duplicated: true
  };
}

async function handler(ctx, payload) {
  const scope = await createAdminScope(ctx);
  requireClientRequestId(ctx);
  const input = payload || {};
  const count = parseCount(input.count);
  const expiresInHours = parseExpiresInHours(input.expiresInHours);
  const note = readNote(input.note, enums.INVITATION_NOTE_MAX, 'note');
  const requestKey = auditKeyOf(ctx);
  const replay = await replayOf(scope, await scope.findAudit(requestKey));
  if (replay) {
    return replay;
  }
  const seq = await nextBatchSeq(scope);
  const batchId = 'B' + time.dayKey(scope.now) + '-' + pad2(seq);
  const expiresAt = new Date(time.addHours(scope.now, expiresInHours));
  const codes = [];
  for (let i = 0; i < count; i += 1) {
    const inserted = await idGenerator.insertUnique(scope.dao, COLLECTIONS.INVITATION_CODES, {
      field: 'code',
      generate: idGenerator.generateInviteCode,
      build(code) {
        return {
          code: code,
          status: enums.INVITATION_STATUS.UNUSED,
          batchId: batchId,
          expiresAt: expiresAt,
          usedBy: '',
          usedAt: null,
          note: note,
          createdBy: scope.developerNo,
          createdAt: scope.nowDate,
          revokedAt: null,
          revokedBy: '',
          updatedAt: scope.nowDate
        };
      }
    });
    codes.push(inserted.value);
  }
  const audit = await scope.writeAudit(
    AUDIT_ACTIONS.INVITE_CREATE,
    { type: 'invitation_code', id: batchId },
    {
      batchId: batchId,
      count: count,
      expiresInHours: expiresInHours,
      codeTails: codes.map(codeTailOf)
    },
    requestKey
  );
  if (audit.duplicated) {
    const raced = await replayOf(scope, await scope.findAudit(requestKey));
    if (raced) {
      return raced;
    }
  }
  return { batchId: batchId, expiresAt: expiresAt, codes: codes };
}

module.exports = handler;
