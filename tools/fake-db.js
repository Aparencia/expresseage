'use strict';
/**
 * tools/fake-db.js — 云函数 handler 单测用内存 fake DB（不 require wx-server-sdk，不进小程序包）。
 *
 * 覆盖（ENGINEERING §7.3）：
 *   collection/where/orderBy/limit/skip/get/add/update/remove/count、db.command._.inc、
 *   事务提交/回滚（runTransaction）、唯一索引冲突模拟（默认 _id，可配复合唯一索引）。
 *
 * 设计口径：
 *   - 与 wx-server-sdk 的调用形状保持一致（db.collection(name).where(...).get()），handler 不需要分支 mock。
 *   - 读写都走深拷贝，测试拿到的对象改不动库；每条写入计入 stats，便于断言"失败路径零写入"。
 *   - 冲突抛出带 code='UNIQUE_CONFLICT' / errCode=-502001 / collection / fields 的错误，handler 可按业务转 CONFLICT。
 *
 * 用法：
 *   const { createFakeDb } = require('../tools/fake-db');
 *   const db = createFakeDb({ uniqueIndexes: { orders: [['orderNo'], ['requestKey']] } });
 *   db.seed('orders', [{ _id: 'o1', orderNo: 'DX-1' }]);
 *   await db.collection('orders').where({ orderNo: 'DX-1' }).limit(1).get();
 */
const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

function getPath(obj, dotted) {
  const parts = String(dotted).split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[p];
  }
  return cur;
}

function setPath(obj, dotted, value) {
  const parts = String(dotted).split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur[p] === null || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

function comparable(v) {
  return v instanceof Date ? v.getTime() : v;
}

// ---------------------------------------------------------------- command
const CMD = Symbol('fakeDbCommand');
function command(type, value) {
  return { [CMD]: true, type, value };
}
const cmd = {
  eq: (v) => command('eq', v),
  neq: (v) => command('neq', v),
  gt: (v) => command('gt', v),
  gte: (v) => command('gte', v),
  lt: (v) => command('lt', v),
  lte: (v) => command('lte', v),
  in: (v) => command('in', v),
  nin: (v) => command('nin', v),
  exists: (v) => command('exists', v),
  inc: (v) => command('inc', v),
  remove: () => command('remove', null),
};
cmd._ = cmd;
cmd.command = cmd;

function matchValue(actual, expected) {
  if (expected && expected[CMD]) {
    const a = comparable(actual);
    const e = comparable(expected.value);
    switch (expected.type) {
      case 'eq': return a === e;
      case 'neq': return a !== e;
      case 'gt': return a !== undefined && a > e;
      case 'gte': return a !== undefined && a >= e;
      case 'lt': return a !== undefined && a < e;
      case 'lte': return a !== undefined && a <= e;
      case 'in': return Array.isArray(expected.value) && expected.value.map(comparable).indexOf(a) !== -1;
      case 'nin': return !Array.isArray(expected.value) || expected.value.map(comparable).indexOf(a) === -1;
      case 'exists': return expected.value ? actual !== undefined : actual === undefined;
      default: return false;
    }
  }
  if (expected instanceof Date) return comparable(actual) === comparable(expected);
  if (Array.isArray(expected)) return JSON.stringify(actual) === JSON.stringify(expected);
  if (expected !== null && typeof expected === 'object') {
    if (actual !== null && typeof actual === 'object') {
      return Object.keys(expected).every((k) => matchValue(actual[k], expected[k]));
    }
    return false;
  }
  return actual === expected;
}

function matchDoc(doc, cond) {
  if (!cond || typeof cond !== 'object') return true;
  return Object.keys(cond).every((key) => {
    const expected = cond[key];
    const actual = getPath(doc, key);
    // 支持 { and: [...] } / { or: [...] } 逻辑组合
    if (key === 'and' || key === '$and') return Array.isArray(expected) && expected.every((c) => matchDoc(doc, c));
    if (key === 'or' || key === '$or') return Array.isArray(expected) && expected.some((c) => matchDoc(doc, c));
    return matchValue(actual, expected);
  });
}

// ---------------------------------------------------------------- fake db
function createFakeDb(options) {
  const opts = options || {};
  const uniqueIndexes = Object.assign({}, opts.uniqueIndexes || {});
  let collections = new Map(); // name -> Map<id, doc>
  let seq = 0;
  const stats = { adds: 0, updates: 0, removes: 0, reads: 0, commits: 0, rollbacks: 0 };

  function store(name, create) {
    if (!collections.has(name)) {
      if (!create) return null;
      collections.set(name, new Map());
    }
    return collections.get(name);
  }

  function uniqueError(collection, fields, value) {
    const err = new Error('唯一索引冲突: ' + collection + '.' + fields.join('+') + ' = ' + JSON.stringify(value));
    err.code = 'UNIQUE_CONFLICT';
    err.errCode = -502001;
    err.collection = collection;
    err.fields = fields.slice();
    return err;
  }

  function assertUnique(name, docs, candidateId, patch) {
    const indexes = (uniqueIndexes[name] || []).concat([['_id']]);
    for (const fields of indexes) {
      const vals = fields.map((f) => {
        const v = patch && Object.prototype.hasOwnProperty.call(patch, f) ? patch[f] : getPath(docs.get(candidateId) || {}, f);
        return comparable(v);
      });
      for (const [id, other] of docs) {
        if (id === candidateId) continue;
        const otherVals = fields.map((f) => comparable(getPath(other, f)));
        if (vals.every((v, i) => JSON.stringify(v) === JSON.stringify(otherVals[i]))) {
          throw uniqueError(name, fields, vals);
        }
      }
    }
  }

  function applyUpdate(doc, data) {
    Object.keys(data || {}).forEach((key) => {
      const value = data[key];
      if (value && value[CMD] && value.type === 'inc') {
        const cur = getPath(doc, key);
        setPath(doc, key, (typeof cur === 'number' ? cur : 0) + Number(value.value));
      } else if (value && value[CMD] && value.type === 'remove') {
        const parts = String(key).split('.');
        const parent = parts.length > 1 ? getPath(doc, parts.slice(0, -1).join('.')) : doc;
        if (parent && typeof parent === 'object') delete parent[parts[parts.length - 1]];
      } else {
        setPath(doc, key, clone(value));
      }
    });
  }

  function makeApi(getStore, tx) {
    function collection(name) {
      const docsOf = () => {
        const docs = getStore().get(name) || new Map();
        return docs;
      };
      function filter(cond) {
        const out = [];
        docsOf().forEach((doc, id) => {
          if (matchDoc(doc, cond)) out.push([id, doc]);
        });
        return out;
      }
      const builder = {
        _cond: null,
        _orders: [],
        _limit: 0,
        _skip: 0,
        where(cond) { this._cond = cond || {}; return this; },
        orderBy(field, dir) { this._orders.push([field, dir === 'desc' ? -1 : 1]); return this; },
        limit(n) { this._limit = Number(n) || 0; return this; },
        skip(n) { this._skip = Number(n) || 0; return this; },
        async get() {
          stats.reads += 1;
          let rows = filter(this._cond);
          if (this._orders.length) {
            rows = rows.slice().sort((a, b) => {
              for (const [field, dir] of this._orders) {
                const av = comparable(getPath(a[1], field));
                const bv = comparable(getPath(b[1], field));
                if (av === bv) continue;
                if (av === undefined) return 1;
                if (bv === undefined) return -1;
                return av > bv ? dir : -dir;
              }
              return 0;
            });
          }
          if (this._skip) rows = rows.slice(this._skip);
          if (this._limit) rows = rows.slice(0, this._limit);
          return { data: rows.map((r) => clone(r[1])), errMsg: 'collection.get:ok' };
        },
        async count() {
          stats.reads += 1;
          return { total: filter(this._cond).length, errMsg: 'collection.count:ok' };
        },
        async add(payload) {
          const data = Object.assign({}, clone(payload && payload.data ? payload.data : payload));
          const id = data._id !== undefined ? String(data._id) : 'id_' + (++seq);
          data._id = id;
          assertUnique(name, docsOf(), null, data);
          docsOf().set(id, data);
          stats.adds += 1;
          return { _id: id, errMsg: 'collection.add:ok' };
        },
        async update(payload) {
          const data = payload && payload.data ? payload.data : payload;
          let updated = 0;
          for (const [id, doc] of filter(this._cond)) {
            const next = clone(doc);
            applyUpdate(next, data);
            assertUnique(name, docsOf(), id, data);
            docsOf().set(id, next);
            updated += 1;
          }
          stats.updates += updated;
          return { stats: { updated }, errMsg: 'collection.update:ok' };
        },
        async remove() {
          const removed = filter(this._cond).map((r) => r[0]);
          removed.forEach((id) => docsOf().delete(id));
          stats.removes += removed.length;
          return { stats: { removed: removed.length }, errMsg: 'collection.remove:ok' };
        },
        doc(id) {
          return {
            async get() {
              stats.reads += 1;
              const doc = docsOf().get(String(id));
              if (!doc) {
                const err = new Error('document not exists: ' + name + '/' + id);
                err.code = 'NOT_FOUND';
                err.errCode = -502004;
                throw err;
              }
              return { data: clone(doc), errMsg: 'document.get:ok' };
            },
            async update(payload) {
              const data = payload && payload.data ? payload.data : payload;
              const doc = docsOf().get(String(id));
              if (!doc) return { stats: { updated: 0 }, errMsg: 'document.update:ok' };
              const next = clone(doc);
              applyUpdate(next, data);
              assertUnique(name, docsOf(), String(id), data);
              docsOf().set(String(id), next);
              stats.updates += 1;
              return { stats: { updated: 1 }, errMsg: 'document.update:ok' };
            },
            async remove() {
              const existed = docsOf().delete(String(id));
              stats.removes += existed ? 1 : 0;
              return { stats: { removed: existed ? 1 : 0 }, errMsg: 'document.remove:ok' };
            },
            async set(payload) {
              const data = Object.assign({}, clone(payload && payload.data ? payload.data : payload), { _id: String(id) });
              assertUnique(name, docsOf(), null, data);
              docsOf().set(String(id), data);
              return { _id: String(id), errMsg: 'document.set:ok' };
            },
          };
        },
      };
      return builder;
    }
    return {
      collection,
      command: cmd,
      ServerDate: () => new Date(),
      serverDate: () => new Date(),
      __tx: tx,
    };
  }

  const db = makeApi(() => collections, null);
  db.command = cmd;

  db.seed = function seed(name, docs) {
    const map = store(name, true);
    (docs || []).forEach((doc) => {
      const copy = clone(doc);
      const id = copy._id !== undefined ? String(copy._id) : 'id_' + (++seq);
      copy._id = id;
      map.set(id, copy);
    });
    return db;
  };

  db.dump = function dump(name) {
    if (name) return Array.from((store(name) || new Map()).values()).map((d) => clone(d));
    const out = {};
    collections.forEach((map, key) => {
      out[key] = Array.from(map.values()).map((d) => clone(d));
    });
    return out;
  };

  db.count = function count(name) {
    return (store(name) || new Map()).size;
  };

  db.stats = stats;

  db.reset = function reset() {
    collections = new Map();
    seq = 0;
    return db;
  };

  /** 事务：回调抛错（或调用 transaction.rollback()）→ 整体回滚并 reject；正常返回 → 提交。 */
  db.runTransaction = async function runTransaction(fn) {
    const snapshot = clone(db.dump());
    const rollbackError = { __fakeDbRollback: true };
    const tx = makeApi(() => collections, true);
    tx.rollback = function rollback() { throw rollbackError; };
    try {
      const result = await fn(tx);
      stats.commits += 1;
      return result;
    } catch (err) {
      collections = new Map();
      Object.keys(snapshot).forEach((name) => {
        const map = new Map();
        Object.keys(snapshot[name]).forEach((id) => map.set(id, snapshot[name][id]));
        collections.set(name, map);
      });
      stats.rollbacks += 1;
      if (err === rollbackError) return undefined;
      throw err;
    }
  };

  return db;
}

module.exports = { createFakeDb, cmd, command, matchDoc, matchValue, getPath };
