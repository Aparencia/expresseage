// pkg-partner/pages/stats/parts/summary.js · 单量统计纯件（无费用口径；测试数据不计入）
const DAY_MS = 24 * 60 * 60 * 1000;

function pad2(value) {
  return value < 10 ? '0' + value : String(value);
}

function dateKey(date) {
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
}

function parseTime(value) {
  if (!value) {
    return 0;
  }
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function startOfDay(now) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function startOfWeek(now) {
  const dayStart = startOfDay(now);
  const date = new Date(dayStart);
  const weekday = date.getDay();
  const offset = weekday === 0 ? 6 : weekday - 1;
  return dayStart - offset * DAY_MS;
}

function startOfMonth(now) {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

function rangeStartKey(range, now) {
  if (range === 'week') {
    return startOfWeek(now);
  }
  if (range === 'month') {
    return startOfMonth(now);
  }
  return startOfDay(now);
}

function isCompletedInRange(order, from) {
  const time = parseTime(order.completedAt);
  return time > 0 && time >= from;
}

function isCanceledInRange(order, from) {
  const time = parseTime(order.cancelledAt);
  return time > 0 && time >= from;
}

function serverNow(skew) {
  return Date.now() - (typeof skew === 'number' ? skew : 0);
}

function computeStats(options) {
  const opts = options || {};
  const history = Array.isArray(opts.history) ? opts.history : [];
  const counts = opts.counts || {};
  const from = rangeStartKey(opts.range, opts.now || Date.now());
  let completed = 0;
  let canceled = 0;
  history.forEach((order) => {
    if (isCompletedInRange(order, from)) {
      completed += 1;
    } else if (isCanceledInRange(order, from)) {
      canceled += 1;
    }
  });
  const running =
    (counts.submitted || 0) + (counts.accepted || 0) + (counts.picked || 0) + (counts.delivered || 0);
  const exception = counts.exception || 0;
  const denominator = completed + canceled + exception;
  const rate = denominator > 0 ? Math.round((completed / denominator) * 100) : 0;
  return {
    completed: completed,
    running: running,
    exception: exception,
    canceled: canceled,
    rateText: rate + '%',
    todayCompleted: counts.todayCompleted || 0
  };
}

function buildWeekBars(history, now) {
  const labels = [];
  const totals = [];
  const dayStart = startOfDay(now);
  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date(dayStart - offset * DAY_MS);
    labels.push(pad2(day.getMonth() + 1) + '/' + pad2(day.getDate()));
    totals.push(0);
  }
  const indexOf = {};
  labels.forEach((label, index) => {
    indexOf[label] = index;
  });
  history.forEach((order) => {
    const time = parseTime(order.completedAt);
    if (!time) {
      return;
    }
    const key = dateKey(new Date(time));
    const short = key.slice(5, 7) + '/' + key.slice(8, 10);
    if (indexOf[short] !== undefined) {
      totals[indexOf[short]] += 1;
    }
  });
  const max = Math.max.apply(null, totals.concat([1]));
  return labels.map((label, index) => ({
    label: label,
    value: totals[index],
    height: Math.max(8, Math.round((totals[index] / max) * 120))
  }));
}

module.exports = {
  DAY_MS,
  serverNow,
  rangeStartKey,
  computeStats,
  buildWeekBars,
  dateKey,
  parseTime
};
