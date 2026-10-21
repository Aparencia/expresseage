// shared/error-copy.js · 13 码中文人话唯一文案处（页面/云函数都从这里取，禁止各写一份）
// 契约：docs/V4_CONTRACT.md v0.9 §5.3；docs/ENGINEERING §4.4「客户端不写死文案」。
// 纪律：每句都要说真话并给下一步；不出现"请稍后重试"式空话；不含任何交易语义。
// 调用方：api/client.js（失败 toast）、云函数 respond/errors 组装 message、页面兜底文案。
'use strict';

// 键必须与 shared/error-codes.js 的 13 码逐一对应（tools 门禁双向核对，禁止多/少/错拼）
const CODE_COPY = {
  VALIDATION_FAILED: '填写内容不符合要求，请按提示修改标出的字段后再提交',
  FORBIDDEN: '没有权限执行该操作；如需帮助请联系开发者确认身份',
  NOT_FOUND: '该内容不存在或当前不可查看，请返回刷新后再试',
  CONFLICT: '数据已被其他人更新，请刷新页面后重新操作',
  INVALID_TRANSITION: '当前进度不支持该操作，请下拉刷新订单后再试',
  INVALID_STATE: '现在还不能执行该操作，请按提示补全资料或处理进行中的订单后再试',
  RATE_LIMITED: '操作太频繁，请半小时后再试',
  INVITE_EXPIRED: '邀请码已过期，请向开发者索取新的邀请码',
  INVITE_USED: '邀请码已被使用，请向开发者索取新的邀请码',
  VIEW_TICKET_EXPIRED: '切换会话已过期，请回到「切换账号」重新开启',
  PARTNER_CLOSED: '该兼职当前不接单（已停用或已注销），请稍后再试或联系对方',
  DEPENDENCY_FAILED: '服务暂时不可用，请检查网络后重试',
  INTERNAL_ERROR: '操作失败，请重试一次；若仍失败请把当前页面截图反馈给开发者'
};

// 编号输入前缀提示三句（CONTRACT §3.1 规则 4；只描述格式，不暴露该编号是否存在）
const PREFIX_HINT = {
  CUSTOMER_PREFIX: '这是顾客编号，请向兼职索取 P 开头的兼职编号',
  DEVELOPER_PREFIX: '这是开发者编号，不能用于绑定',
  FORMAT: '兼职编号是 P 开头、共 6 位字母数字，请核对'
};

const CUSTOMER_PREFIX = PREFIX_HINT.CUSTOMER_PREFIX;
const DEVELOPER_PREFIX = PREFIX_HINT.DEVELOPER_PREFIX;
const FORMAT = PREFIX_HINT.FORMAT;

// 未知 code（服务端新增/断网）兜底文案：不装懂、给下一步
const UNKNOWN_CODE_COPY = '操作失败，请刷新页面后重试；若持续失败请把当前页面截图反馈给开发者';

function copyOf(code) {
  return CODE_COPY[code] || UNKNOWN_CODE_COPY;
}

function prefixHintOf(reason) {
  return PREFIX_HINT[reason] || PREFIX_HINT.FORMAT;
}

module.exports = {
  CODE_COPY,
  PREFIX_HINT,
  CUSTOMER_PREFIX,
  DEVELOPER_PREFIX,
  FORMAT,
  UNKNOWN_CODE_COPY,
  copyOf,
  prefixHintOf
};
