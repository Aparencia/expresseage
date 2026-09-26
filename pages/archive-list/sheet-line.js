// pages/archive-list/sheet-line.js · 建档浮层的"一行 → 三格"纯逻辑（页面专用零件）
//
// 为什么住零件里：这段原先写在页面上（`applySheetLine` 36 行，大半是 `setData` 与注释），
// 而**页面层没有断言能力**（TD-016）⇒ 拆行失败时"清空三格 + 写错误文案"这条分支可以整块失效而门禁全绿。
// 搬进来之后它是纯函数：喂 `customers` 与一行文本，返回"该写进 data 的 patch"。
'use strict';

const customerInput = require('../../utils/customer-input.js');
const { reasonText } = require('../../utils/reason.js');

// 读库失败时页面要写的那份 patch（空表单 + 把原因说出来）：
// 没有现有档案就没法算"同楼栋同宿舍的下一个后缀"，静默按空列表走会补出一个**重名**档案（§11.4 禁静默吞错）。
function storeFailedPatch(line, reason) {
  return {
    sheetLine: typeof line === 'string' ? line : '',
    sheetForm: { building: '', dorm: '', name: '' },
    sheetNameAuto: false,
    sheetError: reasonText(reason)
  };
}

/**
 * 一行输入 → 三格 patch（纯函数：不读盘、不 setData）。
 * @param {Array} customers 现有档案（算"同楼栋同宿舍的下一个后缀"要用）
 * @param {string} line 用户正在输入/粘贴的那一行
 * @returns {{hasError:boolean, patch:Object}} `hasError` 决定可滚区高度要不要加一条提示的配额
 */
function sheetLinePatch(customers, line) {
  const draft = typeof line === 'string' ? line : '';
  const result = customerInput.buildCustomerInput(customers || [], draft);
  if (!result.ok) {
    // 文案走 reasonText：`NO_BUILDING`（整行看不懂）与 `NO_DORM`（楼栋认得出、宿舍号不合法）指向不同修法，
    // 写死成一句就抹掉了这个区别（v1 2026-09-22 独立审查 P2-02 的"假修"）。
    // ⛔ 也**不要**拿失败返回值去覆盖输入框（那会把用户正在打的字改掉）。
    return { hasError: true, patch: storeFailedPatch(draft, result.reason) };
  }
  return {
    hasError: false,
    patch: {
      sheetLine: draft,
      sheetForm: { building: result.building, dorm: result.dorm, name: result.name },
      sheetNameAuto: result.auto === true,
      sheetError: ''
    }
  };
}

module.exports = { sheetLinePatch, storeFailedPatch };
