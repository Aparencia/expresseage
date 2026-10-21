// lib/tag-allocator.js · roomTag 分配（counters 事务自增 → toTag 恒大写 A…Z/AA…）
// 触发点：bind.create 成功事务内按（兼职, dormKey）取号；换宿舍重新分配、旧 tag 不复用。
const { COLLECTIONS } = require('../db/collections');
const { ROOM_TAG_PATTERN } = require('../shared/enums');
const { toTag } = require('../shared/room-tag');
const errors = require('./errors');

function buildCounterKey(partnerId, dormKey) {
  return 'tag:' + partnerId + ':' + dormKey;
}

// trx 为 dao.transaction(fn) 注入的同接口事务对象；返回 { roomTag, seq }。
async function allocateRoomTag(trx, partnerId, dormKey, nowMs) {
  if (!partnerId || !dormKey) {
    throw errors.internalError('标签分配缺少参数');
  }
  const key = buildCounterKey(partnerId, dormKey);
  const row = await trx.findOne(COLLECTIONS.COUNTERS, { where: { key } });
  let seq;
  if (!row) {
    seq = 1;
    await trx.add(COLLECTIONS.COUNTERS, { key, seq, updatedAt: nowMs });
  } else {
    seq = (typeof row.seq === 'number' ? row.seq : 0) + 1;
    await trx.update(COLLECTIONS.COUNTERS, row._id, { seq, updatedAt: nowMs });
  }
  const roomTag = toTag(seq);
  if (typeof roomTag !== 'string' || !ROOM_TAG_PATTERN.test(roomTag)) {
    throw errors.internalError('标签生成结果非法');
  }
  return { roomTag, seq };
}

async function allocateRoomTagWithDao(dao, partnerId, dormKey, nowMs) {
  return dao.transaction(async (trx) => allocateRoomTag(trx, partnerId, dormKey, nowMs));
}

module.exports = {
  buildCounterKey,
  allocateRoomTag,
  allocateRoomTagWithDao
};
