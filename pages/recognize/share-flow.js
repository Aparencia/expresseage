// pages/recognize/share-flow.js · 录入页的「转发」（2026-09-26 用户裁决 A）
//
// 为什么单独一个文件：① 本页已有 `session-key-flow.js` 先例（处理器住零件才钉得住 —— 页面层零断言 TD-016）；
// ② 更重要的是：**"转发卡片上能出现什么"是对外承诺的一部分**。本项目对外的承诺是"取件码 / 手机号 /
// 站点只留本机"（`docs/privacy/隐私保护指引.md`）⇒ 一旦卡片里带上业务值，D3 就**跟着转发离开了设备**。
// 所以卡片内容必须是**纯函数**，并由断言（`selftest-wave7 §24`）钉死"一个业务值都不许出现"。
//
// ⛔ 纪律（改这一条 = 改对外承诺，须人批）：
//   卡片 = `{title, path, imageUrl}` 三个键，**恰好这三个**；title 里不许有数字、站点名、取件码、运单号、手机号，
//   也不写"有几件"（那同样是业务信息）。`imageUrl` **必须**指向仓库自带的中性封面（见下）——
//   缺了它平台会拿**当前页面截图**当封面，那等于绕过上面这条纪律把屏上的取件码转发出去。
//   想加内容先改 `docs/privacy/` 并取得用户裁决。
'use strict';

const SHARE_TITLE = '代取台账 · 校园快递代取';
const SHARE_PATH = '/pages/recognize/index';
// ⚠️ **必须自带封面**（2026-09-26 独立审查 F4 修，P1）：`onShareAppMessage` 不返回 `imageUrl` 时，微信默认拿
// **当前页面截图**当卡片封面 —— 而这一页上正摆着取件码/站点 ⇒ 转发一次就等于把 D3 送出设备（对外承诺破了）。
// 这张封面是**程序生成的中性渐变图**（`assets/share-cover.png`，500×400，零文字零图形，1352 字节），
// 它保证卡片封面**永远**与屏上内容无关。断言 §24⑥ 同时钉"路径指向自带资源"与"文件真的在"（只钉字符串会在删图后仍绿）。
const SHARE_IMAGE = '/assets/share-cover.png';

/**
 * 转发卡片（**纯函数**：同输入必同输出，不读 data、不读库）
 * @returns {{title:string, path:string, imageUrl:string}} 只有这三个键 —— 见文件头纪律
 */
function shareCard() {
  return { title: SHARE_TITLE, path: SHARE_PATH, imageUrl: SHARE_IMAGE };
}

module.exports = {
  SHARE_TITLE,
  SHARE_PATH,
  SHARE_IMAGE,
  shareCard,
  // 页面只转发事件（与 `session-key-flow.pageMethods` 同一形态：`Object.assign` 并进 `Page`）
  pageMethods: {
    // 未定义 `onShareAppMessage` 时，右上角菜单里的「转发」是**灰的**（2026-09-26 用户诉求「实现小程序转发正常」）
    onShareAppMessage() {
      return shareCard();
    }
  }
};
