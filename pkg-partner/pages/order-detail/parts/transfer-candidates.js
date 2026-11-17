// pkg-partner/pages/order-detail/parts/transfer-candidates.js · 转派候选（D87-a/b：检索 + 文字卡片）
// 口径：CONTRACT §13 D87；UX_PARTNER §3.3 转派面板。
//   · 候选只是「展示投影」：本队成员来自 partner.listSubMembers，检索结果来自 partner.searchTransferTargets；
//     谁可接收仍由服务端 order.requestTransfer 唯一权威（页面零权限判据）。
//   · 卡片只有文字：昵称 + 编号 + 接单状态；零头像、零 openid、零内部 id（D19/D42 不松绑）。
//   · 空态四态（搜索中 / 失败 / 无结果 / 无候选）各有下一步文案——不允许静默只剩输入框。
'use strict';

const ids = require('../../../../utils/ids');
const transferPart = require('./transfer');

const MAX_KEYWORD = 16;
const COPY = {
  placeholder: '搜在岗兼职（昵称，或编号 8F3 这类前 3 位）',
  actionText: '搜索',
  searchingText: '搜索中…',
  teamMeta: '本队',
  recentMeta: '最近使用',
  accepting: '接单中',
  paused: '已暂停接单',
  keywordHint: '至少 2 个字，或编号去掉 P 后至少 3 位（如 8F3），再点搜索',
  searching: '正在搜索在岗兼职…',
  failed: '没搜出来，检查网络后重试；也可以直接填对方编号',
  noResult: '没找到匹配的在岗兼职，换个关键词；或让对方把编号发给你',
  empty: '也可以直接填对方完整编号；不知道编号的话，让对方把编号发给你',
  searchFail: '搜索没成功，请重试',
  codeFail: '转派码没填上，请确认 6 位码后重试'
};

function textOf(value) {
  return String(value == null ? '' : value);
}

// 编号展示：canonical P8F3K2M → P-8F3-K2M（纯展示，提交仍用 canonical）
function displayOf(partnerNo) {
  const canonical = textOf(partnerNo);
  const parsed = ids.parseNo(canonical);
  return parsed && parsed.ok && parsed.display ? parsed.display : canonical;
}

function keywordOf(raw) {
  return textOf(raw).trim().slice(0, MAX_KEYWORD);
}

// 检索闸（与服务端同口径的「最小可搜」提示）：编号本体 ≥3，或 昵称中文 ≥2 字 / 任意 ≥4 字。
// 页面只用来减少空请求；是否合法仍由服务端 VALIDATION_FAILED 说真话。
function searchableOf(keyword) {
  const text = textOf(keyword).trim();
  const body = text.replace(/[\s\-_]/g, '').toUpperCase().replace(/^P/, '');
  const codeOk = /^[0-9A-Z]+$/.test(body) && body.length >= 3;
  const chars = Array.from(text);
  const nameOk = chars.length >= 2 && (/[^\x00-\x7F]/.test(text) || chars.length >= 4);
  return codeOk || nameOk;
}

function searchPanel() {
  return { placeholder: COPY.placeholder, actionText: COPY.actionText, searchingText: COPY.searchingText, maxLength: MAX_KEYWORD };
}

// 页面 data 的候选默认块（集中一处，避免页面 index.js 因字段铺开逼近行数闸）
function initialState() {
  return {
    transferCards: [],
    transferCardSource: '',
    transferPickIndex: -1,
    transferKeyword: '',
    transferSearching: false,
    transferSearchFailed: false,
    transferEmpty: emptyOf({ count: 0 }),
    transferSearch: searchPanel(),
    // D88：转派码（对方出示 → 我方输码 → 解析出编号后回填）
    transferCodeInput: '',
    transferCodeFilling: false,
    transferCodeTip: '',
    transferCodePlaceholder: '如 ABC-DEF'
  };
}

// D88 转派码输入归一：大写、去空格/连字符（与服务端 _transfer-code.normalizeCode 同形）
function codeOf(raw) {
  return textOf(raw).toUpperCase().replace(/[\s\-]/g, '').slice(0, 6);
}

function cardOf(partnerNo, displayName, meta) {
  const no = textOf(partnerNo);
  const name = textOf(displayName);
  return {
    partnerNo: no,
    title: (name ? name + ' · ' : '') + displayOf(no),
    meta: textOf(meta)
  };
}

// 本队候选卡片（主兼职=ACTIVE 成员 / 子队员=队长）：口径复用 transfer.candidatesOf
function cardsOfTeam(team) {
  return transferPart.candidatesOf(team).map((item) => cardOf(item.partnerNo, item.displayName, COPY.teamMeta));
}

// D90 最近使用（≤5，服务端已去重且只回本人转派成功过的对象）；暂停接单的在 meta 里点明
function cardsOfRecent(list) {
  return (Array.isArray(list) ? list : []).map((row) => cardOf(
    row && row.partnerNo,
    row && row.displayName,
    COPY.recentMeta + (row && row.acceptingOrders === false ? ' · ' + COPY.paused : '')
  ));
}

// 三段式合并（顺序：最近使用 → 本队；同编号只留先出现的一条）。搜索命中时整体替换显示。
function mergeCards(recent, team) {
  const out = [];
  const seen = {};
  [recent, team].forEach((cards) => {
    (Array.isArray(cards) ? cards : []).forEach((card) => {
      if (!card || !card.partnerNo || seen[card.partnerNo]) {
        return;
      }
      seen[card.partnerNo] = true;
      out.push(card);
    });
  });
  return out;
}

// 检索结果卡片：list[{partnerNo,displayName,acceptingOrders}]；接单状态直接说人话
function cardsOfSearch(result) {
  const list = result && Array.isArray(result.list) ? result.list : [];
  return list.map((row) => cardOf(row && row.partnerNo, row && row.displayName,
    row && row.acceptingOrders ? COPY.accepting : COPY.paused));
}

// 空态：优先级 搜索中 → 失败 → 有候选（不出空态）→ 有词无结果 → 无词无候选
function emptyOf(state) {
  const value = state || {};
  if (value.loading) {
    return { visible: true, text: COPY.searching };
  }
  if (value.failed) {
    return { visible: true, text: COPY.failed };
  }
  if (Number(value.count) > 0) {
    return { visible: false, text: '' };
  }
  return { visible: true, text: value.keyword ? COPY.noResult : COPY.empty };
}

module.exports = {
  MAX_KEYWORD,
  COPY,
  displayOf,
  keywordOf,
  searchableOf,
  searchPanel,
  initialState,
  codeOf,
  cardsOfTeam,
  cardsOfRecent,
  mergeCards,
  cardsOfSearch,
  emptyOf
};
