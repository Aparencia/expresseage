// handlers/admin/_paging.js · 后台列表统一查询与游标分页（DATA_MODEL §5.2/§5.3）
// 口径：禁 skip、禁 where({}) 内存过滤截断；条件尽量进服务端 where（命中索引），游标 (sortValue,id)。
// 云 DB 不支持把「字段 OR」直接塞进 where，故「同值平局」拆成两条索引查询后归并（等价的游标语义）：
//   下一页 = sortField 更小(desc)/更大(asc) 的行  ∪  sortField 同值且 idField 更靠后的行。
// 前缀查询（昵称/编号）：服务端 gte(prefix) 起步 + 升序游标 gt(lastValue) 推进，内存只做 startsWith 收敛；
// 前缀段结束后立即停止（升序下首个不匹配即越界），不做全表内存过滤。
'use strict';

const time = require('../../lib/time');

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_FETCH_ROUNDS = 5;
const OVER_FETCH = 1;
const DEFAULT_ID_FIELD = '_id';

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseQuery(payload) {
  const input = isPlainObject(payload) ? payload : {};
  const rawLimit = Number(input.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(Math.floor(rawLimit), MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;
  return { limit, cursor: parseCursor(input.cursor) };
}

// 游标只接受 {sortValue, id}：sortValue 为毫秒时间（时间序）或字符串（前缀序），id 为稳定唯一键。
// 旧版 {offset} 游标直接忽略（客户端下一次翻页会从首页重新按新游标返回，不会静默漏页）。
function parseCursor(raw) {
  if (!isPlainObject(raw)) {
    return null;
  }
  const value = raw.sortValue;
  const valueOk = (typeof value === 'number' && isFinite(value))
    || (typeof value === 'string' && value !== '');
  if (!valueOk) {
    return null;
  }
  return { sortValue: value, id: typeof raw.id === 'string' ? raw.id : '' };
}

function sortValueOf(record, field) {
  const value = record ? record[field] : undefined;
  if (typeof value === 'string') {
    return value;
  }
  return time.toMs(value);
}

function idOf(record, idField) {
  const value = record ? record[idField || DEFAULT_ID_FIELD] : undefined;
  return value === undefined || value === null ? '' : String(value);
}

function cursorOf(record, sortField, idField) {
  return { sortValue: sortValueOf(record, sortField), id: idOf(record, idField) };
}

function compareCursor(left, right) {
  if (left.sortValue !== right.sortValue) {
    return left.sortValue < right.sortValue ? -1 : 1;
  }
  if (left.id === right.id) {
    return 0;
  }
  return left.id < right.id ? -1 : 1;
}

// 归并多路有序结果（每路已按 sortField + idField 排序）；desc 时主序倒序、平局按 idOrder 方向。
function mergeOrdered(lists, order, idOrder) {
  const out = [];
  for (let i = 0; i < lists.length; i += 1) {
    for (let j = 0; j < lists[i].length; j += 1) {
      out.push(lists[i][j]);
    }
  }
  const direction = order === 'asc' ? 1 : -1;
  const tieDirection = idOrder === 'desc' ? -1 : 1;
  out.sort((left, right) => {
    if (left.cursor.sortValue !== right.cursor.sortValue) {
      return left.cursor.sortValue < right.cursor.sortValue ? -1 * direction : 1 * direction;
    }
    if (left.cursor.id === right.cursor.id) {
      return 0;
    }
    return left.cursor.id < right.cursor.id ? -1 * tieDirection : 1 * tieDirection;
  });
  return out.map((item) => item.row);
}

function wrap(rows, options) {
  return rows.map((row) => ({ row: row, cursor: cursorOf(row, options.sortField, options.idField) }));
}

// 一条有序查询的 where：无游标时用基础条件；有游标时拆成「严格更靠后」与「同值平局」两条。
function whereListOf(options, cursor) {
  const baseList = Array.isArray(options.wheres) ? options.wheres : [options.where || {}];
  const sortField = options.sortField;
  const idField = options.idField || DEFAULT_ID_FIELD;
  const order = options.order === 'asc' ? 'asc' : 'desc';
  const idOrder = options.idOrder === 'desc' ? 'desc' : 'asc';
  if (!cursor) {
    return baseList;
  }
  const command = options.command;
  const list = [];
  for (let i = 0; i < baseList.length; i += 1) {
    const strict = Object.assign({}, baseList[i]);
    strict[sortField] = command(order === 'desc' ? 'lt' : 'gt', cursor.sortValue);
    list.push(strict);
    const tie = Object.assign({}, baseList[i]);
    tie[sortField] = new Date(cursor.sortValue);
    tie[idField] = command(idOrder === 'desc' ? 'lt' : 'gt', cursor.id);
    list.push(tie);
  }
  return list;
}

// 时间序页：单条或多条 where 并行查询后归并（多条用于历史审计动作名兼容等「同域分叉」查询）。
async function fetchOrderedPage(scope, options) {
  const opts = options || {};
  const limit = opts.limit || DEFAULT_PAGE_SIZE;
  const fetchSize = limit + OVER_FETCH;
  const order = opts.order === 'asc' ? 'asc' : 'desc';
  const idOrder = opts.idOrder === 'desc' ? 'desc' : 'asc';
  const idField = opts.idField || DEFAULT_ID_FIELD;
  const cursor = opts.cursor || null;
  const command = (name, value) => scope.dao.command(name, value);
  const whereList = whereListOf(Object.assign({}, opts, { command: command }), cursor);
  const orderBy = [[opts.sortField, order], [idField, idOrder]];
  const results = await Promise.all(whereList.map((where) => (
    scope.dao.find(opts.collection, { where: where, orderBy: orderBy, limit: fetchSize })
  )));
  const merged = mergeOrdered(results.map((rows) => wrap(rows, { sortField: opts.sortField, idField: idField })), order, idOrder);
  const rows = merged.slice(0, fetchSize);
  return {
    rows: rows,
    hasMore: merged.length > limit,
    cursor: rows.length > 0 ? cursorOf(rows[rows.length - 1], opts.sortField, idField) : null
  };
}

// 前缀页：gte(prefix) 起步、升序推进（游标 gt(lastValue) + 同值平局 id>lastId 两条查询归并）。
async function fetchPrefixPage(scope, options) {
  const opts = options || {};
  const field = opts.field;
  const prefix = opts.prefix;
  const limit = opts.limit || DEFAULT_PAGE_SIZE;
  const fetchSize = limit + OVER_FETCH;
  const base = opts.where || {};
  const idField = DEFAULT_ID_FIELD;
  const command = (name, value) => scope.dao.command(name, value);
  const orderBy = [[field, 'asc'], [idField, 'asc']];
  const cursor = opts.cursor || null;
  let rows = [];
  if (!cursor) {
    const where = Object.assign({}, base);
    where[field] = command('gte', prefix);
    rows = await scope.dao.find(opts.collection, { where: where, orderBy: orderBy, limit: fetchSize });
  } else {
    const first = Object.assign({}, base);
    first[field] = command('gt', cursor.sortValue);
    const tie = Object.assign({}, base);
    tie[field] = cursor.sortValue;
    tie[idField] = command('gt', cursor.id);
    const [firstRows, tieRows] = await Promise.all([
      scope.dao.find(opts.collection, { where: first, orderBy: orderBy, limit: fetchSize }),
      scope.dao.find(opts.collection, { where: tie, orderBy: orderBy, limit: fetchSize })
    ]);
    rows = mergeOrdered(
      [wrap(firstRows, { sortField: field, idField: idField }), wrap(tieRows, { sortField: field, idField: idField })],
      'asc', 'asc'
    ).slice(0, fetchSize);
  }
  const matched = [];
  let exhausted = false;
  for (let i = 0; i < rows.length; i += 1) {
    const value = rows[i][field];
    if (typeof value === 'string' && value.indexOf(prefix) === 0) {
      matched.push(rows[i]);
    } else {
      exhausted = true;
      break;
    }
  }
  const hasMore = matched.length > limit;
  return {
    rows: matched.slice(0, fetchSize),
    hasMore: hasMore,
    cursor: hasMore ? cursorOf(matched[matched.length - 1], field, idField) : null,
    exhausted: exhausted
  };
}

// 连续抓页直到凑满 limit 或取尽；accept(row) 可异步（测试账号过滤等）。每轮最多 limit+1 条，
// 轮数上限 5：只影响单次时延，不影响正确性——nextCursor 如实返回，客户端「加载更多」继续。
async function pagedCollect(scope, fetcher, options, accept) {
  const opts = options || {};
  const limit = opts.limit || DEFAULT_PAGE_SIZE;
  const idField = opts.idField || DEFAULT_ID_FIELD;
  const sortField = opts.sortField || opts.field;
  const list = [];
  let cursor = opts.cursor || null;
  for (let round = 0; round < MAX_FETCH_ROUNDS; round += 1) {
    const batch = await fetcher(scope, Object.assign({}, opts, { cursor: cursor }));
    const rows = batch.rows || [];
    let consumed = null;
    let i = 0;
    for (; i < rows.length; i += 1) {
      if (list.length >= limit) {
        break;
      }
      const row = rows[i];
      consumed = row;
      if (!accept || await accept(row)) {
        list.push(row);
      }
    }
    if (list.length >= limit) {
      const more = i < rows.length || batch.hasMore === true;
      return { list: list, nextCursor: more && consumed ? cursorOf(consumed, sortField, idField) : null };
    }
    if (!batch.hasMore || !batch.cursor) {
      return { list: list, nextCursor: null };
    }
    cursor = batch.cursor;
  }
  return { list: list, nextCursor: cursor };
}

function prefixOf(rawKeyword) {
  const text = typeof rawKeyword === 'string' ? rawKeyword.trim() : '';
  if (!text) {
    return '';
  }
  return text.replace(/[-\s]/g, '').toUpperCase();
}

module.exports = {
  parseQuery,
  prefixOf,
  fetchOrderedPage,
  fetchPrefixPage,
  pagedCollect
};
