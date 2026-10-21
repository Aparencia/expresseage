// pkg-partner/pages/stats/parts/view-model.js · 单量统计视图模型（纯件，零 wx）
// 口径：docs/V4_UX_PARTNER.md §3.8（今日/本周/本月 tab、四格指标、近 7 天自绘柱、空/错态）、
//       §9（日报摘要数据源、单一来源 partner.stats、页面不做历史页累加）、§12（不引图表库）；
//       docs/V4_DATA_MODEL.md §7.4 partner.stats（已冻结出参形状，批 7）：
//       {range,counts:{completed,active,cancelled,exceptions},completionRate(0..1|null),
//        series[7]{date:'YYYY-MM-DD',label:'MM-DD',completed},recent[≤10]{orderNo,status,statusText,at},
//        todayCompleted}。页面只消费服务端 DTO，不本地猜状态/完成率/异常，不按历史页累加。
'use strict';

const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const RANGES = [
  { key: 'today', label: '今日' },
  { key: 'week', label: '本周' },
  { key: 'month', label: '本月' }
];
const RANGE_KEYS = RANGES.map(function keyOf(item) {
  return item.key;
});
const DEFAULT_RANGE = 'today';
const RANGE_LABEL = {};
RANGES.forEach(function fillLabel(item) {
  RANGE_LABEL[item.key] = item.label;
});

const CHART_EMPTY_TEXT = '近 7 天还没有完成订单';
const BAR_MIN_RPX = 24;
const BAR_MAX_RPX = 96;
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const LABEL_RE = /^\d{2}-\d{2}$/;

function cloneMetrics(source) {
  return {
    completed: source.completed,
    rateText: source.rateText,
    active: source.active,
    exceptions: source.exceptions,
    cancelled: source.cancelled,
    todayCompleted: source.todayCompleted
  };
}

// 完成率分母为 0 时服务端下发 null：页面显示「暂无」而不是 0%（DATA_MODEL §7.4 批 7 ③）
const EMPTY_METRICS = cloneMetrics({
  completed: 0,
  rateText: '暂无',
  active: 0,
  exceptions: 0,
  cancelled: 0,
  todayCompleted: 0
});

function resolveRange(value) {
  return RANGE_KEYS.indexOf(value) >= 0 ? value : DEFAULT_RANGE;
}

function rangeLabelOf(range) {
  return RANGE_LABEL[resolveRange(range)];
}

// 请求入参：只带 range 一个键（不夹带 from/to/cursor 等历史页参数）
function queryOf(range) {
  return { range: resolveRange(range) };
}

/** 服务端时间基准：store.serverTimeSkew = 本机时刻 - 服务端时刻（api/client 校时后写入） */
function serverNow(skew) {
  const offset = typeof skew === 'number' && isFinite(skew) ? skew : 0;
  return Date.now() - offset;
}

/** UTC+8 自然日起点（与云端 lib/time 日界公式一致；不用本机时区） */
function dayStartMs(ms) {
  const value = typeof ms === 'number' && isFinite(ms) ? ms : Date.now();
  return value - ((value + TZ_OFFSET_MS) % DAY_MS);
}

function dateKeyOf(ms) {
  const value = typeof ms === 'number' && isFinite(ms) ? ms : Date.now();
  return new Date(value + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

function isValidDateKey(value) {
  if (typeof value !== 'string' || !DATE_KEY_RE.test(value)) {
    return false;
  }
  const parsed = Date.parse(value + 'T00:00:00.000Z');
  return !Number.isNaN(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function labelOf(dateKey) {
  return isValidDateKey(dateKey) && LABEL_RE.test(dateKey.slice(5)) ? dateKey.slice(5) : '';
}

/** 服务端自然日时钟（HH:MM，UTC+8；不跟本机时区漂移） */
function clockText(ms) {
  const value = typeof ms === 'number' && isFinite(ms) && ms > 0 ? ms : 0;
  if (!value) {
    return '';
  }
  return new Date(value + TZ_OFFSET_MS).toISOString().slice(11, 16);
}

function countOf(value) {
  const number = Number(value);
  return isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

/** completionRate 是 0..1 比率（云端定稿）；null/缺失/非数 → 「暂无」 */
function rateTextOf(rate) {
  if (typeof rate !== 'number' || !isFinite(rate)) {
    return '暂无';
  }
  const clamped = Math.max(0, Math.min(1, rate));
  return Math.round(clamped * 100) + '%';
}

function metricOf(dto) {
  const source = dto && typeof dto === 'object' ? dto : null;
  if (!source) {
    return cloneMetrics(EMPTY_METRICS);
  }
  const counts = source.counts && typeof source.counts === 'object' ? source.counts : {};
  return {
    completed: countOf(counts.completed),
    rateText: rateTextOf(source.completionRate),
    active: countOf(counts.active),
    exceptions: countOf(counts.exceptions),
    cancelled: countOf(counts.cancelled),
    todayCompleted: countOf(source.todayCompleted)
  };
}

function normalizeSeriesItem(item) {
  if (!item || typeof item !== 'object' || !isValidDateKey(item.date)) {
    return null;
  }
  return {
    date: item.date,
    label: typeof item.label === 'string' && LABEL_RE.test(item.label) ? item.label : labelOf(item.date),
    completed: countOf(item.completed)
  };
}

// 固定 7 项（最早 → 今天）：服务端合法 7 项原样消费；不足/含非法日时按近 7 自然日补 0
function seriesOf(dto, nowMs) {
  const source = dto && typeof dto === 'object' && Array.isArray(dto.series) ? dto.series : [];
  const items = [];
  source.forEach(function take(item) {
    const normalized = normalizeSeriesItem(item);
    if (normalized) {
      items.push(normalized);
    }
  });
  if (items.length >= 7) {
    return items.slice(-7);
  }
  const byDate = {};
  items.forEach(function index(item) {
    byDate[item.date] = item.completed;
  });
  const todayStart = dayStartMs(nowMs);
  const out = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = dateKeyOf(todayStart - offset * DAY_MS);
    out.push({ date: date, label: labelOf(date), completed: byDate[date] || 0 });
  }
  return out;
}

/**
 * 柱状视图：高度按当日最大值等比缩放；0 单不画柱（hasBar=false / heightRpx=0），
 * 全 0 时 empty=true，页面显示空文案而不是假柱（UX §3.8 图表口径）。
 */
function barsOf(series) {
  const list = Array.isArray(series) ? series : [];
  const values = list.map(function valueOf(item) {
    return countOf(item && item.completed);
  });
  let max = 0;
  let total = 0;
  values.forEach(function scan(value) {
    if (value > max) {
      max = value;
    }
    total += value;
  });
  const bars = list.map(function barOf(item, index) {
    const value = values[index];
    const heightRpx = value > 0 && max > 0
      ? BAR_MIN_RPX + Math.round((value / max) * BAR_MAX_RPX)
      : 0;
    return {
      date: item.date,
      label: item.label,
      value: value,
      heightRpx: heightRpx,
      hasBar: value > 0,
      latest: index === list.length - 1
    };
  });
  return { total: total, empty: total === 0, bars: bars };
}

function emptyTextOf(range, completed) {
  if (countOf(completed) > 0) {
    return '';
  }
  const key = resolveRange(range);
  if (key === 'week') {
    return '本周还没有完成订单';
  }
  if (key === 'month') {
    return '本月还没有完成订单';
  }
  return '今天还没有完成订单';
}

// 图表下方一行：异常/取消分开计数（UX §3.8「今日异常 1 · 超时取消 0」的口径；无超时细分时如实说「取消」）
function summaryTextOf(range, metrics) {
  const source = metrics || EMPTY_METRICS;
  const label = rangeLabelOf(range);
  return label + '异常 ' + countOf(source.exceptions) + ' · 取消 ' + countOf(source.cancelled);
}

function errorTextOf(options) {
  const opts = options || {};
  if (!opts.hasData) {
    return '统计没加载出来，检查网络后重试';
  }
  const at = typeof opts.updatedAtText === 'string' ? opts.updatedAtText : '';
  if (at) {
    return '没连上服务器，显示的是 ' + at + ' 的数据。';
  }
  return '没连上服务器，显示的是上次成功的数据。';
}

/** 首次进入：骨架屏，不画任何假数（四格/柱/日报都等真实 DTO） */
function initialView() {
  return {
    ranges: RANGES,
    range: DEFAULT_RANGE,
    stage: 'skeleton',
    loading: true,
    metrics: cloneMetrics(EMPTY_METRICS),
    bars: [],
    chartEmpty: false,
    chartEmptyText: CHART_EMPTY_TEXT,
    rangeEmptyText: '',
    summaryText: '',
    updatedAtText: '',
    errorText: ''
  };
}

// 切 tab / 下拉刷新：只置 loading，旧值保留到新值返回（防闪空）
function loadingView() {
  return { loading: true };
}

function viewOf(context) {
  const ctx = context || {};
  const metrics = metricOf(ctx.dto);
  const series = seriesOf(ctx.dto, ctx.nowMs);
  const chart = barsOf(series);
  return {
    stage: 'ready',
    loading: false,
    errorText: '',
    metrics: metrics,
    bars: chart.bars,
    chartEmpty: chart.empty,
    chartEmptyText: CHART_EMPTY_TEXT,
    rangeEmptyText: emptyTextOf(ctx.range, metrics.completed),
    summaryText: summaryTextOf(ctx.range, metrics),
    updatedAtText: typeof ctx.lastSuccessAt === 'number' && ctx.lastSuccessAt > 0 ? clockText(ctx.lastSuccessAt) : ''
  };
}

/** 请求失败：有旧值 → 保留数据并给「显示的是 HH:MM 的数据」；无旧值 → 错误态 + 重试 */
function errorViewOf(context) {
  const ctx = context || {};
  const view = {
    loading: false,
    errorText: errorTextOf({ hasData: !!ctx.hasData, updatedAtText: ctx.updatedAtText })
  };
  if (!ctx.hasData) {
    view.stage = 'error';
  }
  return view;
}

/** 日报/跳转用「今天」日期：优先服务端 series 末项（契约 index 6 = 今天），缺失时按校时算 */
function todayDateKeyOf(todayDto, nowMs) {
  const series = todayDto && typeof todayDto === 'object' && Array.isArray(todayDto.series)
    ? todayDto.series
    : [];
  const items = [];
  series.forEach(function take(item) {
    const normalized = normalizeSeriesItem(item);
    if (normalized) {
      items.push(normalized);
    }
  });
  items.sort(function order(left, right) {
    return left.date < right.date ? -1 : 1;
  });
  return items.length ? items[items.length - 1].date : dateKeyOf(nowMs);
}

// 工作台是 tabBar 页：switchTab 不能带参，唯一能携带日期的是 reLaunch；参数只认 completedDate
function jumpUrlOf(baseUrl, dateKey) {
  const base = typeof baseUrl === 'string' ? baseUrl : '';
  if (!base) {
    return '';
  }
  const date = isValidDateKey(dateKey) ? dateKey : '';
  if (!date) {
    return base;
  }
  return base + (base.indexOf('?') >= 0 ? '&' : '?') + 'completedDate=' + date;
}

module.exports = {
  TZ_OFFSET_MS,
  DAY_MS,
  RANGES,
  RANGE_KEYS,
  DEFAULT_RANGE,
  RANGE_LABEL,
  CHART_EMPTY_TEXT,
  EMPTY_METRICS,
  resolveRange,
  rangeLabelOf,
  queryOf,
  serverNow,
  dayStartMs,
  dateKeyOf,
  isValidDateKey,
  labelOf,
  clockText,
  countOf,
  rateTextOf,
  metricOf,
  seriesOf,
  barsOf,
  emptyTextOf,
  summaryTextOf,
  errorTextOf,
  initialView,
  loadingView,
  viewOf,
  errorViewOf,
  todayDateKeyOf,
  jumpUrlOf
};
