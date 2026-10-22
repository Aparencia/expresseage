'use strict';
/**
 * tools/fake-db.js — 云函数 handler 单测用内存 fake DB（不 require wx-server-sdk，不进小程序包）。
 *
 * 覆盖（ENGINEERING §7.3）：
 *   collection/where/orderBy/limit/skip/get/add/update/remove/count、db.command.{inc,set,remove}、
 *   事务提交/回滚（runTransaction）、唯一索引冲突模拟（默认 _id，可配复合唯一索引）。
 *
 * 设计口径：
 *   - 与 wx-server-sdk 的调用形状保持一致（db.collection(name).where(...).get()），handler 不需要分支 mock。
 *   - **更新语义与真实云 DB 对齐**：普通对象值会被拍平成点路径 $set（部分合并），点路径不能穿过
 *     null/标量父级——与线上 -502001（Cannot create field ... in element {privacyConsent: null}）同形，
 *     旧实现"整对象替换"曾掩盖该真实故障；整值替换必须用 db.command.set（api/cleanup 的 dao.update 统一包）。
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

function comparable(v) {
  return v instanceof Date ? v.getTime() : v;
}

// ---------------------------------------------------------------- command
const CMD = Symbol('fakeDbCommand');
function command(type, value) {
  // 与真实 SDK 指令形状对齐：{ operator, operands }（db/dao.js 据此判断"已是指令、不再包整值替换"）
  return { [CMD]: true, type, value, operator: type, operands: value === undefined ? [] : [value] };
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
  set: (v) => command('set', v),
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
    const detail = collection + '.' + fields.join('+') + ' = ' + JSON.stringify(value);
    const err = new Error('唯一索引冲突: ' + detail);
    // 与真实云 DB 的错误形状对齐：errMsg 含 "duplicate key error"（db/dao.js 的 isDuplicateError 靠它识别），
    // 否则"唯一冲突 → CONFLICT"的 handler 分支在 fake DB 下永远走不到（假红）。
    err.errMsg = 'document.add:fail duplicate key error: ' + detail;
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
      // 缺失字段不产生唯一索引项：真实云 DB 对这些集合的唯一索引以"写入即带值"为前提
      // （requestKey/orderNo 等生产恒有值）。若把 undefined 当 null 值参与比较，
      // 任何"seed 样本不带该字段"的集合首次 update 都会被误判重复（假红）。
      if (vals.indexOf(undefined) !== -1 || vals.indexOf(null) !== -1) continue;
      for (const [id, other] of docs) {
        if (id === candidateId) continue;
        const otherVals = fields.map((f) => comparable(getPath(other, f)));
        if (vals.every((v, i) => JSON.stringify(v) === JSON.stringify(otherVals[i]))) {
          throw uniqueError(name, fields, vals);
        }
      }
    }
  }

  function isPlainObjectValue(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value)
      && Object.prototype.toString.call(value) === '[object Object]';
  }

  // 真实云 DB 语义：点路径 $set 不能穿过 null/标量父级。
  // 线上事故：users.privacyConsent=null 时 SDK 把 {version, at} 拍成 privacyConsent.at → -502001
  // "Cannot create field 'at' in element {privacyConsent: null}"，整次写入失败。
  function setByPath(doc, dotted, value) {
    const parts = String(dotted).split('.');
    let cur = doc;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const key = parts[i];
      const next = cur[key];
      if (next === undefined) {
        cur[key] = {};
        cur = cur[key];
        continue;
      }
      if (next === null || typeof next !== 'object' || Array.isArray(next)) {
        const err = new Error('collection.update:fail -502001 database request fail. [FailedOperation] '
          + "Cannot create field '" + parts[i + 1] + "' in element {" + key + ': ' + JSON.stringify(next) + '}');
        err.errMsg = err.message;
        err.code = 'DATABASE_REQUEST_FAILED';
        err.errCode = -502001;
        throw err;
      }
      cur = next;
    }
    cur[parts[parts.length - 1]] = clone(value);
  }

  // 普通对象值 → 与 wx-server-sdk 一致拍平成点路径 $set（部分合并）；标量/Date/数组按点路径整值写入
  function applyPlainValue(doc, key, value) {
    if (isPlainObjectValue(value)) {
      Object.keys(value).forEach((child) => applyPlainValue(doc, key + '.' + child, value[child]));
      return;
    }
    setByPath(doc, key, value);
  }

  function applyUpdate(doc, data) {
    Object.keys(data || {}).forEach((key) => {
      const value = data[key];
      if (value === undefined) {
        return; // SDK flatten 会直接丢弃 undefined 字段
      }
      if (value && value[CMD]) {
        switch (value.type) {
          case 'inc': {
            const cur = getPath(doc, key);
            setByPath(doc, key, (typeof cur === 'number' ? cur : 0) + Number(value.value));
            return;
          }
          case 'set': {
            setByPath(doc, key, value.value); // 整值替换：不拍平（dao.update 对对象字段统一走这里）
            return;
          }
          case 'remove': {
            const parts = String(key).split('.');
            const parent = parts.length > 1 ? getPath(doc, parts.slice(0, -1).join('.')) : doc;
            if (parent && typeof parent === 'object') {
              delete parent[parts[parts.length - 1]];
            }
            return;
          }
          default:
            throw new Error('不支持的更新指令：' + value.type);
        }
      }
      applyPlainValue(doc, key, value);
    });
  }

  function makeApi(getStore, tx) {
    function collection(name) {
      // 真实云 DB 在首次写入时自动建集合；fake DB 必须同样"未 seed 也建"，
      // 否则 add 写进游离 Map（丢了）、count/get 仍读旧 Map（读不到）——这是与环境的行为差异。
      const docsOf = () => {
        const s = getStore();
        if (!s.has(name)) s.set(name, new Map());
        return s.get(name);
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
