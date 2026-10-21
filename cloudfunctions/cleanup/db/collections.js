// db/collections.js · 集合名校验（集合名单一来源 = shared/collections；未知集合名属代码缺陷，直接抛错）
// 与 cloudfunctions/api/db/collections.js 同形：cleanup 部署单元独立，不能 require api 目录。
const shared = require('../shared/collections');

const COLLECTIONS = shared.COLLECTIONS;
const ALL_COLLECTIONS = shared.ALL_COLLECTIONS;
const COLLECTION_COUNT = shared.COLLECTION_COUNT;
const CONFIG_DOC_ID = shared.CONFIG_DOC_ID;

function isKnownCollection(name) {
  return typeof name === 'string' && name.length > 0 && ALL_COLLECTIONS.indexOf(name) >= 0;
}

function assertCollection(name) {
  if (!isKnownCollection(name)) {
    throw new Error('未注册的集合：' + String(name));
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
