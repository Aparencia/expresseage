// cloudfunctions/cleanup/db/dao.js · cleanup 部署单元的数据访问层
// 云函数目录独立部署，cleanup 无法 require api/db/dao.js；本文件是第二处（经 Lead 授权）
// 允许出现 db.collection 的位置，接口与 api/db/dao.js 逐项一致，集合名仍来自 shared/collections。
// 写入语义与 api/db/dao.js 同步：update/updateWhere 的字段值是整值替换（普通对象值包成 command.set，
// 不交给 SDK 拍平点路径；拍平后父字段为 null 时会 -502001，且会残留旧子字段）。两文件改动必须成对。
const { assertCollection } = require('./collections');

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.prototype.toString.call(value) === '[object Object]';
}

function isUpdateCommand(value) {
  return isPlainObject(value) && typeof value.operator === 'string' && Array.isArray(value.operands);
}

function normalizeUpdateData(db, data) {
  const source = data || {};
  const out = {};
  Object.keys(source).forEach((key) => {
    const value = source[key];
    if (value === undefined) {
      return;
    }
    if (isPlainObject(value) && !isUpdateCommand(value)) {
      const command = db.command;
      if (!command || typeof command.set !== 'function') {
        throw new Error('当前数据库 SDK 不支持整值替换指令（command.set）');
      }
      out[key] = command.set(value);
      return;
    }
    out[key] = value;
  });
  return out;
}

function isDuplicateError(error) {
  if (!error) {
    return false;
  }
  const message = String(error.errMsg || error.message || '');
  return /duplicate key|E11000/i.test(message);
}

function normalizeOrderBy(orderBy) {
  if (!orderBy) {
    return [];
  }
  const list = Array.isArray(orderBy) ? orderBy : [orderBy];
  return list.map((item) => {
    if (Array.isArray(item)) {
      return [item[0], item[1]];
    }
    if (item && typeof item === 'object') {
      return [item.field, item.direction];
    }
    return null;
  }).filter((item) => item && item[0]);
}

function createBody(db, collectionOf) {
  const body = {};

  body.find = async (collection, options) => {
    const opts = options || {};
    let query = collectionOf(assertCollection(collection)).where(opts.where || {});
    normalizeOrderBy(opts.orderBy).forEach((pair) => {
      query = query.orderBy(pair[0], pair[1] === 'desc' ? 'desc' : 'asc');
    });
    if (opts.skip && opts.skip > 0) {
      query = query.skip(opts.skip);
    }
    if (opts.limit && opts.limit > 0) {
      query = query.limit(opts.limit);
    }
    const result = await query.get();
    return (result && result.data) || [];
  };

  body.get = async (collection, id) => {
    if (id === undefined || id === null || id === '') {
      return null;
    }
    const rows = await body.find(collection, { where: { _id: id }, limit: 1 });
    return rows[0] || null;
  };

  body.findOne = async (collection, options) => {
    const opts = options || {};
    const rows = await body.find(collection, {
      where: opts.where,
      orderBy: opts.orderBy,
      skip: opts.skip,
      limit: 1
    });
    return rows[0] || null;
  };

  body.count = async (collection, options) => {
    const opts = options || {};
    const result = await collectionOf(assertCollection(collection)).where(opts.where || {}).count();
    return result && typeof result.total === 'number' ? result.total : 0;
  };

  body.add = async (collection, data) => {
    const result = await collectionOf(assertCollection(collection)).add({ data: data || {} });
    return { _id: result && result._id };
  };

  body.updateWhere = async (collection, where, data) => {
    const result = await collectionOf(assertCollection(collection))
      .where(where || {})
      .update({ data: normalizeUpdateData(db, data) });
    const updated = result && result.stats && typeof result.stats.updated === 'number' ? result.stats.updated : 0;
    return { updated };
  };

  body.update = async (collection, id, data) => {
    if (id === undefined || id === null || id === '') {
      throw new Error('更新缺少主键');
    }
    return body.updateWhere(collection, { _id: id }, data);
  };

  body.removeWhere = async (collection, where) => {
    const result = await collectionOf(assertCollection(collection)).where(where || {}).remove();
    const removed = result && result.stats && typeof result.stats.removed === 'number' ? result.stats.removed : 0;
    return { removed };
  };

  body.remove = async (collection, id) => {
    if (id === undefined || id === null || id === '') {
      throw new Error('删除缺少主键');
    }
    return body.removeWhere(collection, { _id: id });
  };

  body.inc = (value) => db.command.inc(value);
  body.serverDate = () => db.serverDate();
  // 查询指令工厂：业务层需要范围/前缀/集合条件（gte/lt/gt/neq/in/exists）时经此构造，
  // 保持"云函数不出现 db.collection"铁律；指令对象仍由本层唯一的 db 实例生成（另一部署单元逐份一致）。
  body.command = (name, value) => {
    if (!db.command || typeof db.command[name] !== 'function') {
      throw new Error('当前数据库 SDK 不支持查询指令：' + name);
    }
    return db.command[name](value);
  };
  body.isDuplicateError = isDuplicateError;

  body.transaction = async (handler) => {
    if (!handler || typeof handler !== 'function') {
      throw new Error('事务缺少执行函数');
    }
    if (typeof db.runTransaction === 'function') {
      return db.runTransaction(async (transaction) => handler(createTransactionDao(transaction)));
    }
    if (typeof db.startTransaction === 'function') {
      const transaction = await db.startTransaction();
      try {
        const result = await handler(createTransactionDao(transaction));
        await transaction.commit();
        return result;
      } catch (error) {
        try {
          await transaction.rollback();
        } catch (rollbackError) {
          console.error('[cleanup.dao] 事务回滚失败');
        }
        throw error;
      }
    }
    throw new Error('当前数据库不支持事务');
  };

  function createTransactionDao(transaction) {
    return createBody(db, (name) => transaction.collection(assertCollection(name)));
  }

  return body;
}

function createDao(db) {
  if (!db || typeof db.collection !== 'function') {
    throw new Error('数据库实例未注入');
  }
  return createBody(db, (name) => db.collection(name));
}

module.exports = {
  createDao,
  isDuplicateError
};
