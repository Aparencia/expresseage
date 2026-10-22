// pkg-partner/pages/activate/parts/code-input-model.js · 激活页邀请码输入回显纯件（零 wx / 零 setData）
// 口径：V4_UX_PARTNER §3.1/§3.2（去横杠·空格·全角、转大写、4 位分组回显、非 12 位不提交）；CONTRACT §3.1。
// 关键缺陷教训：输入回显**不能**复用 validateInvitationCode——它在"输入未满 12 位/含非法字符"时
// 返回 ok:false 且不带 canonical，照抄就会把用户刚敲的字清空（输入 1 个字符输入框即变空）。
// 回显必须用可部分归一的 validate.canonicalCode：半截输入也保留并分组，满 12 位才允许提交。
'use strict';

const validate = require('../../../../shared/validate');
const enums = require('../../../../shared/enums');

const CODE_GROUPS = enums.INVITATION_CODE_GROUPS.slice();
const CODE_LENGTH = enums.INVITATION_CODE_LENGTH;

// 4 位一组回显：ABCD2345EFGH → ABCD-2345-EFGH；半截输入按已有位数分组（ABCDE → ABCD-E）
function groupCode(canonical) {
  const parts = [];
  let cursor = 0;
  for (let index = 0; index < CODE_GROUPS.length && cursor < canonical.length; index += 1) {
    parts.push(canonical.slice(cursor, cursor + CODE_GROUPS[index]));
    cursor += CODE_GROUPS[index];
  }
  if (cursor < canonical.length) {
    parts.push(canonical.slice(cursor));
  }
  return parts.join('-');
}

// 输入事件 → 回显状态：归一（大写/去分隔符/全角转半角）后按 12 位截断，不因"没输完"清空
function stateOfInput(raw) {
  const canonical = validate.canonicalCode(raw).slice(0, CODE_LENGTH);
  return { codeRaw: canonical, codeDisplay: groupCode(canonical) };
}

// 提交闸：满 12 位且只含 32 字母表字符
function isValid(canonical) {
  return validate.validateInvitationCode(canonical).ok;
}

module.exports = {
  CODE_GROUPS,
  CODE_LENGTH,
  groupCode,
  stateOfInput,
  isValid
};
