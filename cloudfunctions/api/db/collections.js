// db/collections.js · 集合名注册表校验（集合名唯一来源 = shared/collections，禁止第二套）
const shared = require('../shared/collections');

const COLLECTIONS = shared.COLLECTIONS;
const ALL_COLLECTIONS = shared.ALL_COLLECTIONS;
const COLLECTION_COUNT = shared.COLLECTION_COUNT;
const CONFIG_DOC_ID = shared.CONFIG_DOC_ID;

function isKnownCollection(name) {
  return typeof name === 'string' && name.length > 0 && ALL_COLLECTIONS.indexOf(name) >= 0;
}

// 未知集合名属于代码缺陷：直接抛错，由 app.js 收敛为 INTERNAL_ERROR，绝不落库。
function assertCollection(name) {
  if (!isKnownCollection(name)) {
    throw new Error('未登记的集合：' + String(name));
  }
  return name;
}

module.exports = {
  COLLECTIONS,
  ALL_COLLECTIONS,
  COLLECTION_COUNT,
  CONFIG_DOC_ID,
  isKnownCollection,
  assertCollection
};
