// pkg-partner/pages/team/parts/team-model.js · 我的团队（D59）视图模型纯件（零 wx、零请求、零全局状态）
// 口径：docs/contract/V4_CONTRACT.md §13 D59；docs/archive/reviews/2026-11-03_BATCH26_27_INTERFACE_DRAFT.md §2.3/§2.4；
//      批 26/27 派工单 §9。服务端 DTO：partner.listSubMembers
//        · 主兼职：{team:null, members[{partnerNo,displayName,status,teamJoinedAt}], pendingInvites[{codeTail,expiresAt,batchId}], quota{used,reserved,max}}
//        · 子队员：{team:{parentPartnerNo,memberCount}, members:[], pendingInvites:[], quota:null}（只有队伍摘要）
// 纪律：页面层零业务判据——成员状态中文只从 shared/enums 标签表取；成员/邀请码行只渲染 DTO 字段；
//      本件不出现队伍/邀请码/订单状态字符串字面量、不拼编号、不生成邀请码、不碰 wx。
// D59 作废口径（Lead 2026-11-03 裁决 = 批次级）：待使用子码按 batchId 分组展示（组内只显示尾 4 位/到期），
//      组头「作废本批」→ partner.revokeSubInvite({batchId}) → 作废该批全部未用码；完整码只在创建响应本次展示。
'use strict';

const enums = require('../../../../shared/enums');
const format = require('../../../../shared/format');
const ids = require('../../../../utils/ids');

// 一次发码数量上限（服务端 count 1~5，D59 登记口径）
const COUNT_MAX = 5;
// 备注上限与 shared/validate.TEXT_LIMITS.teamNote 同口径（服务端唯一权威，端侧只做输入框限长）
const NOTE_MAX = 50;
// 有效期选项（D59：24h/72h/7d）；key 与服务端校验枚举一致，label 只用于端侧展示
const VALIDITY_OPTIONS = [
  { key: '24H', label: '24 小时' },
  { key: '72H', label: '72 小时' },
  { key: '7D', label: '7 天' }
];
const DEFAULT_VALIDITY = '24H';

const READONLY_TEXT = '开发者只读视角不能操作';
const CREATE_HINT = '子邀请码用来给协作队员开独立子账号：对方在激活页输入后即失效（一次性），请当面告知，不要发到群聊或截图外传。';
const MEMBER_NOTE = '你是该队伍的协作队员：顾客只能绑定主兼职，不能绑定你；订单由主兼职转派给你。';
const RESULT_HINT = '完整码只显示这一次，请当面告知对方；对方用过即失效（一次性）。';
const MEMBERS_EMPTY = '还没有队员。发一个子邀请码，对方激活后就会出现在这里。';
const PENDING_EMPTY = '没有待使用的子邀请码。';

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function arrOf(value) {
  return Array.isArray(value) ? value : [];
}

function countOf(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

// 成员状态文言只来自 shared/enums 的标签表（页面与纯件都不写状态字母）
function statusTextOf(status) {
  return enums.PARTNER_STATUS_LABELS[status] || '';
}

function memberRowOf(member, index) {
  const row = member || {};
  const partnerNo = textOf(row.partnerNo);
  const joined = format.formatDate(row.teamJoinedAt);
  return {
    key: partnerNo || 'member-' + index,
    partnerNo: partnerNo,
    displayNameText: textOf(row.displayName) || '未填称呼',
    statusText: statusTextOf(row.status),
    joinedText: joined ? '加入 ' + joined : ''
  };
}

// 待使用子码：服务端只下发尾 4 位（完整码只在创建响应），按 batchId 分组后组头可整批作废
function inviteGroupOf(list, nowMs) {
  const groups = [];
  const byKey = {};
  arrOf(list).forEach((invite) => {
    const row = invite || {};
    const batchId = textOf(row.batchId);
    const key = batchId || 'unknown';
    if (!byKey[key]) {
      byKey[key] = {
        key: key,
        batchId: batchId,
        batchText: batchId ? '批次 ' + batchId : '批次未知',
        rows: []
      };
      groups.push(byKey[key]);
    }
    byKey[key].rows.push({
      key: key + ':' + byKey[key].rows.length,
      codeTailText: textOf(row.codeTail) ? '尾号 ' + textOf(row.codeTail) : '尾号未知',
      expiresText: row.expiresAt ? '到期 ' + format.formatRelative(row.expiresAt, nowMs) : '到期时间未知'
    });
  });
  return groups.map((group) => Object.assign({}, group, {
    rowCountText: group.rows.length + ' 个待使用'
  }));
}

// 名额单源 = 服务端 quota{used,reserved,max}：reserved = 在队队员 + 未过期待用子码（与发码闸同口径），
// 剩余可发 = max - reserved——有 reserved 时不再叠加本页 pendingInvites（双计会把可发数量算少）；
// 仅旧服务端缺 reserved 时才回退本地 max-used-pendingCount 推导（兼容期兜底，不放宽服务端判据）。
function quotaOf(quota, pendingCount) {
  const used = countOf(quota && quota.used);
  const max = countOf(quota && quota.max);
  const pending = countOf(pendingCount);
  const hasReserved = !!quota && typeof quota.reserved === 'number'
    && Number.isFinite(quota.reserved) && quota.reserved >= 0;
  const reserved = hasReserved ? countOf(quota.reserved) : used + pending;
  if (max <= 0) {
    return {
      used: used,
      max: max,
      pending: pending,
      reserved: reserved,
      remaining: 0,
      canCreate: false,
      disabled: true,
      usedText: '',
      fullReasonText: '名额信息没取到，请刷新后重试'
    };
  }
  const remaining = Math.max(0, max - reserved);
  const canCreate = remaining > 0;
  // 满员原因按 reserved 判：队员本身占满说人数；队员没满而是被待用码占满则说清细分
  const pendingInReserved = Math.max(0, reserved - used);
  let fullReasonText = '';
  if (!canCreate) {
    fullReasonText = used >= max
      ? '人数已达上限（' + used + '/' + max + '），不能再发子邀请码；如需扩容请联系管理员'
      : '名额已满（队员+待用码已占用 ' + reserved + '/' + max + '，其中队员 ' + used
        + ' 名、待用码 ' + pendingInReserved + ' 个），不能再发子邀请码；如需扩容请联系管理员';
  }
  return {
    used: used,
    max: max,
    pending: pending,
    reserved: reserved,
    remaining: remaining,
    canCreate: canCreate,
    disabled: !canCreate,
    usedText: '已用 ' + reserved + ' / ' + max + ' 人（含待使用邀请码）',
    fullReasonText: fullReasonText
  };
}

// 数量选项按剩余名额收窄（1~5 上限内的整数；满员时不出选项）
function countOptionsOf(quota) {
  const info = quota || {};
  const room = info.canCreate === true ? Math.min(COUNT_MAX, countOf(info.remaining)) : 0;
  const options = [];
  for (let value = 1; value <= room; value += 1) {
    options.push(value);
  }
  return options;
}

function normalizeForm(form, quota) {
  const source = form || {};
  const options = countOptionsOf(quota);
  const wanted = Number(source.count);
  const validityOk = VALIDITY_OPTIONS.some((item) => item.key === source.validity);
  return {
    count: options.indexOf(wanted) >= 0 ? wanted : (options[0] || 1),
    validity: validityOk ? source.validity : DEFAULT_VALIDITY,
    note: typeof source.note === 'string' ? source.note : ''
  };
}

function emptyResult() {
  return {
    visible: false,
    title: '',
    codeRows: [],
    batchText: '',
    expiresText: '',
    hintText: ''
  };
}

// 创建响应：{batchId, codes[], expiresAt}；完整码分组展示只在本次结果块（D59 一次性口径）
function resultOf(response, nowMs) {
  const dto = response || {};
  const codes = arrOf(dto.codes)
    .map((item) => (typeof item === 'string' ? item : textOf(item && item.code)))
    .filter((code) => code !== '');
  const rows = codes.map((code, index) => ({
    key: String(index),
    display: ids.displayInvitationCode(code) || code
  }));
  return {
    visible: rows.length > 0,
    title: '已生成 ' + rows.length + ' 个子邀请码',
    codeRows: rows,
    batchText: textOf(dto.batchId) ? '批次 ' + textOf(dto.batchId) : '',
    expiresText: dto.expiresAt ? '有效期至 ' + format.formatDateTime(dto.expiresAt) : '',
    hintText: RESULT_HINT
  };
}

function initialView() {
  const quota = quotaOf({ used: 0, max: 0 });
  return {
    loading: true,
    error: '',
    hasData: false,
    captain: false,
    member: false,
    canWrite: false,
    readonly: false,
    readonlyText: '',
    introText: '',
    members: [],
    membersEmptyText: MEMBERS_EMPTY,
    inviteGroups: [],
    pendingEmptyText: PENDING_EMPTY,
    quota: quota,
    countOptions: [],
    validityOptions: VALIDITY_OPTIONS.slice(),
    noteMax: NOTE_MAX,
    form: normalizeForm({}, quota),
    showCreateForm: false,
    creating: false,
    createHintText: CREATE_HINT,
    result: emptyResult(),
    team: { parentPartnerNo: '', memberCountText: '', noteText: MEMBER_NOTE }
  };
}

// 由 listSubMembers DTO 装配整页视图；options={nowMs, readonly, form, result}
function buildSnapshot(dto, options) {
  const data = dto || {};
  const opts = options || {};
  const nowMs = typeof opts.nowMs === 'number' ? opts.nowMs : Date.now();
  const readonly = opts.readonly === true;
  const view = initialView();
  view.loading = false;
  view.error = '';
  view.readonly = readonly;
  view.readonlyText = readonly ? READONLY_TEXT : '';
  view.canWrite = !readonly;
  view.result = opts.result ? resultOf(opts.result, nowMs) : emptyResult();

  // 子队员视角：服务端回 {team:{parentPartnerNo,memberCount}, members:[], pendingInvites:[], quota:null}，
  // 页面只读展示队伍摘要，不出现任何写入口（D59 仅一层）
  const summary = data.team && typeof data.team === 'object' ? data.team : null;
  const memberView = !!summary
    && (textOf(summary.parentPartnerNo) !== '' || typeof summary.memberCount === 'number');
  if (memberView) {
    view.member = true;
    view.captain = false;
    view.hasData = true;
    view.showCreateForm = false;
    view.team = {
      parentPartnerNo: textOf(summary.parentPartnerNo),
      // P2-1：只给数值（「3 人」）——行标签「成员数」由 WXML 承载，避免渲染成「成员数 成员数 3 人」
      memberCountText: countOf(summary.memberCount) + ' 人',
      noteText: MEMBER_NOTE
    };
    return view;
  }

  // 主兼职（队长）视角：成员列表 + 待用子码分组 + 发码表单 + 名额（reserved 优先，缺省回退本地推导）
  view.captain = true;
  view.hasData = true;
  view.members = arrOf(data.members).map(memberRowOf);
  view.inviteGroups = inviteGroupOf(data.pendingInvites, nowMs);
  view.quota = quotaOf(data.quota, arrOf(data.pendingInvites).length);
  view.countOptions = countOptionsOf(view.quota);
  view.form = normalizeForm(opts.form, view.quota);
  view.showCreateForm = !readonly;
  view.introText = '队员是独立兼职账号（有自己的编号、昵称与服务设置）；顾客只绑定你本人，订单由你转派给队员。';
  return view;
}

// 发码提交体：数量/有效期/备注（服务端仍唯一权威校验；页面只做输入形状与限长）
function buildCreatePayload(form) {
  const source = form || {};
  const count = Number(source.count);
  if (!Number.isInteger(count) || count < 1 || count > COUNT_MAX) {
    return { ok: false, data: null, message: '请选择要生成的子邀请码数量' };
  }
  const validity = VALIDITY_OPTIONS.some((item) => item.key === source.validity) ? source.validity : '';
  if (!validity) {
    return { ok: false, data: null, message: '请选择有效期' };
  }
  const note = textOf(source.note);
  if (Array.from(note).length > NOTE_MAX) {
    return { ok: false, data: null, message: '备注最多 ' + NOTE_MAX + ' 字' };
  }
  return { ok: true, data: { count: count, validity: validity, note: note }, message: '' };
}

// 作废（批次级）提交体：{batchId}；该批无未用码/他人批次由服务端判错误码
function buildRevokePayload(group) {
  const batchId = textOf(group && group.batchId);
  if (!batchId) {
    return { ok: false, data: null, message: '这一批邀请码的批次号没取到，请刷新后重试' };
  }
  return { ok: true, data: { batchId: batchId }, message: '' };
}

// 移除队员提交体：{partnerNo}（服务端移除后对方被停用，恢复需管理员）
function buildRemovePayload(member) {
  const partnerNo = textOf(member && member.partnerNo);
  if (!partnerNo) {
    return { ok: false, data: null, message: '没有找到这位队员，请刷新后重试' };
  }
  return { ok: true, data: { partnerNo: partnerNo }, message: '' };
}

// 二次确认：作废整批（说清后果：该批未用码全部失效，已用码不受影响）
function revokeConfirmDialog(group) {
  const count = arrOf(group && group.rows).length;
  return {
    title: '作废本批邀请码',
    content: '本批还有 ' + count + ' 个未使用的邀请码，作废后全部失效、不能再用于注册；已使用的码不受影响。',
    confirmText: '确认作废',
    confirmColor: '#E54D42'
  };
}

// 二次确认：移除队员（说清后果：对方被停用、需联系管理员恢复）
function removeConfirmDialog(member) {
  const name = textOf(member && member.displayNameText) || '这位队员';
  return {
    title: '移除队员',
    content: '移除后「' + name + '」会被停用、不能再接单；如需恢复请联系管理员。确认移除？',
    confirmText: '确认移除',
    confirmColor: '#E54D42'
  };
}

function revokedTextOf(response) {
  const count = countOf(response && response.revokedCount);
  return count > 0 ? '已作废 ' + count + ' 个邀请码' : '邀请码已作废';
}

function failureText(err) {
  return (err && err.message) || '操作没成功，请重试';
}

function selectCount(form, value) {
  const next = Number(value);
  if (!Number.isInteger(next) || next < 1 || next > COUNT_MAX) {
    return form;
  }
  return Object.assign({}, form, { count: next });
}

function selectValidity(form, key) {
  const value = textOf(key);
  if (!VALIDITY_OPTIONS.some((item) => item.key === value)) {
    return form;
  }
  return Object.assign({}, form, { validity: value });
}

function inputNote(form, raw) {
  const value = typeof raw === 'string' ? raw : '';
  return Object.assign({}, form, { note: Array.from(value).slice(0, NOTE_MAX).join('') });
}

module.exports = {
  COUNT_MAX,
  NOTE_MAX,
  VALIDITY_OPTIONS,
  DEFAULT_VALIDITY,
  buildCreatePayload,
  buildRemovePayload,
  buildRevokePayload,
  buildSnapshot,
  countOptionsOf,
  emptyResult,
  failureText,
  initialView,
  inputNote,
  memberRowOf,
  quotaOf,
  removeConfirmDialog,
  resultOf,
  revokedTextOf,
  revokeConfirmDialog,
  selectCount,
  selectValidity,
  statusTextOf
};
