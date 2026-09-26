// pages/archive-list/index.js · 客户档案（底栏右格，SCOPE M1/M3）
// 分工（ARCHITECTURE §2）：一行地址怎么拆 → `utils/customer-input.js`；
// 档案怎么排 → `utils/aggregate.sortCustomers`；怎么落库 → `utils/storage.js`。本页只 setData。
//
// ⚠️ 2026-09-25 改判 N2 之后，本页多担一件事：**"从聊天建档"的表单搬回来了**。
//   `chatpick/` 现在是**独立分包**（平台只接受独立分包挂 `chatTools`），它引不到主包、也不能自己建档，
//   只把平台的**原样返回**塞进 `app.globalData.chatToolPickup`（内存桥）再 `switchTab` 过来。
//   于是三态判读、失败分类、指纹脱敏、折键、落库全部留在这里、留在 `utils/chat-tool.js`
//   ⇒ 规则仍然只有一份（这正是 v1 否掉"分包里再写一份"的那条理由）。
//
// pick_friend（2026-09-25 批 2 + 批 3）在本页加的四件事：
//   ① 「＋ 新建」**先**拉起"选择聊天好友"（官方 §2.1 方式 1：普通模式下调 `wx.openChatTool` 不传 roomid ⇒ 微信拉起会话列表），拿不到才降级手填 —— 降级**不许把人挡在门外**（SCOPE M6）；
//   ② 内存桥里若带 `members`（明文双方 id）⇒ 折成本地摘要键 ⇒ **查重**：这条会话已建过档就不再建第二条，但给人「仍要新建」这条明确出口（用户裁决）；
//   ③ **行内「换绑」**（批 3 / SCOPE M7）：平台换了会话 id 后把新键挂回同一条档案 —— 复用①那条拉起流程，差别只在"桥回来之后往哪落"（进 `applyRebind`）；冲突与"取不到键"都**一个字节都不写**；
//   ④ 键只走**页面实例字段**：进了 `data` 就可能被 WXML 印上屏（D3），上屏只允许指纹。
//
// 24 卡修复批（`CODE_20260925_pick_friend.md`）在本页改的三处：
//   · **R-01（P1）**：键收成**一次性令牌**（`sheet-flow.createKeyToken`）+ `fromChatFlow` 闸门 ——
//     降级建档那条路**结构上拿不到键**；落库前再用 `findCustomerByChatKey` 复检一次（纵深防御）。
//   · **R-02（P1）**：`startPick` 显式注入定时器（原来是"不注入 ⇒ 生产路径没有看门狗"）、
//     重入不再静默 `return`、卡死超窗允许重试，`onShow`/`onHide` 兜底复位 `picking`。
//   · **R-03（P2）**：内存桥分支判据从"有没有 `members` 键"改成 `Array.isArray(members)` ——
//     否则 N2 老路（含 U-5 的屏上取证读数行）在生产上永不可达。
'use strict';

const storage = require('../../utils/storage.js');
const aggregate = require('../../utils/aggregate.js');
const customerInput = require('../../utils/customer-input.js');
const buildings = require('../../utils/buildings.js');
const chatTool = require('../../utils/chat-tool.js');
const { reasonText, failureText } = require('../../utils/reason.js');
const sheetFlow = require('./sheet-flow.js');   // 本页专用零件（键令牌 / 值域闸 / 重入判定）
const sheetLine = require('./sheet-line.js');   // 一行 → 三格的纯逻辑（本批从本页搬出去，见 §7 腾行数）
// 行手势 / 软删 / 回收站：**方法混合件**（本页正好卡 500 行硬线 ⇒ 处理器住零件，页面只并进来）
const rowActions = require('./row-actions.js');
const recycle = require('./recycle.js');   // 回收站两步按钮的文案（data 初值要用 ⇒ 本页也得引）
// 取键的入槽 / 意图接管（2026-09-25 B 段）：摘要槽 `chatKey` 的**唯一写点**住在这里，
// 因为"清单动线也要能取键"要求它不再只属于本页（跨页 require 有先例：详情页就引了本页零件）
const sessionKeyFlow = require('../recognize/session-key-flow.js');

// 聊天工具分包入口页的路径：**不在这里留常量** —— 真机读数② 证明形态不是 `index`
// （平台回 `openChatTool:fail invaild chatTool subpackage url`），三种候选收在 `./sheet-flow.js`（单源）；
// 配置侧那两处（`app.json` 的 `chatTools[0]` 与分包 `pages`）与代码的一致性**只靠人核**（TD-014）。

// 新建浮层里可滚区的高度（教训卡 `2026-09-19_view上的overflow不能滑.md`：
// `<view>` + `overflow-y:auto` 在开发者工具里能用滚轮滑、**真机手指滑不动**，可滚区必须是 `<scroll-view>`，
// 而 `<scroll-view>` 竖向滚动**必须给固定高度**）。
// ⚠️ 2026-09-25（24 卡 R-08／旧 R-17）实测事实：`SHEET_BASE_RPX 300 + SHEET_FIELD_RPX 116×3 = 648`
//   已经**大于** `SHEET_MAX_RPX 620` ⇒ 本函数 16 种参数组合**只有一个返回值 `620rpx`**（恒等于上限）。
//   也就是说：现在真正生效的是"可滚区高度固定 = 上限"，三个参数暂时不改变结果。本批删掉了上一批
//   加进来的第 4 个死参数 `hasDup` 与常量 `SHEET_DUP_RPX`（它的加法永远被上限吃掉）；保留三个参数是
//   为了将来重算常数时不必改调用方。**重算常数必须先真机量一次实际排版**（页面排版没有机器判据 ——
//   TD-016 类），在那之前按"已知事实 + 欠账"处理，⛔ 别把注释写成"会随参数变化"。
const SHEET_BASE_RPX = 300; // 单行输入 + 写法说明
const SHEET_FIELD_RPX = 116; // 三格预览每格（标签 + 输入框 + 间距）
const SHEET_NOTE_RPX = 76; // 一条条件提示
const SHEET_CHAT_RPX = 150; // 会话状态行 + 脱敏取证行（只有从聊天进来时占位，两条都是会换行的小字）
const SHEET_MAX_RPX = 620; // 上限：再高就滚（约半屏，保证底部两颗按钮始终可见）
function computeSheetScrollHeight(hasError, hasAutoHint, hasChat) {
  const total = SHEET_BASE_RPX + SHEET_FIELD_RPX * 3
    + (hasError ? SHEET_NOTE_RPX : 0) + (hasAutoHint ? SHEET_NOTE_RPX : 0)
    + (hasChat ? SHEET_CHAT_RPX : 0);
  return Math.min(total, SHEET_MAX_RPX) + 'rpx';
}

Page(Object.assign({
  data: {
    customers: [],
    isEmpty: true,
    errorText: '',
    // 新建浮层（M3 手动建档）：`chatRoomId` 走空串 = 未绑定会话（DESIGN §1：空串合法）
    sheetOpen: false,
    sheetLine: '',
    sheetForm: { building: '', dorm: '', name: '' },
    sheetError: '',
    sheetNameAuto: false,
    sheetScrollHeight: SHEET_MAX_RPX + 'rpx',
    saving: false,
    // 从聊天进来时才有值：状态行 + 脱敏后的取证读数行（M2 / U-5 全靠这两行说话）
    chatState: '',
    chatEvidence: '',
    // 查重命中（pick_friend M5）：命中已有的会话键时显示；`sheetDupLabel` 只放"楼栋 宿舍 称呼"这类人话
    sheetDupText: '',
    sheetDupLabel: '',
    // 顶部提示条：一次落库成功但"会话标识没被采用"、或换绑的三态结果这类**必须让人看见**的事
    notice: '',
    // 完整会话键（本地摘要，不可逆 ⇒ 允许上屏；用户裁决①）
    chatKeyDigest: '',
    // ── 左滑删除 / 回收站（2026-09-25 详情页批；判据与文案在 swipe.js / recycle.js）──
    swipeId: '',            // 当前露出「删除」的那一行（空串 = 都没有；一次只开一行）
    recycleOpen: false,
    deletedRows: [],
    deletedCount: 0,
    // 两步按钮（2026-09-25 真机反馈用户裁决「第二次确认应该由按钮承担」）：第一下 arm、第二下真删。
    // 逐字输入确认词那条路撤掉了 —— 它把摩擦放进了输入法（真机上打不出/懒得打 = 要么放弃、要么乱打）。
    purgeArmedId: '',       // 哪一行的「彻底删除」已经 arm（空串 = 都没有）
    purgeQuestion: '',      // arm 之后摊开的后果文案（`recycle.purgeQuestion`，不进 wxml 手写）
    purgeArmedText: recycle.purgeButtonText(true),   // 第二下的按钮字（单源在 recycle.js）
    purgeAllArmed: false,   // 「全部彻底删除」是否已经 arm
    purgeAllQuestion: '',
    purgeAllIdleText: recycle.purgeAllButtonText(false, 0),
    purgeAllArmedText: '',
    deletedParcelTotal: 0   // 全部彻底删除要摊开的总件数
  },

  // ⛔ **平台原值**刻意不进 `data`（= D3）；只有过 `chatTool.fingerprint()` 变指纹才可上界面。**摘要**例外。
  chatRoomId: '',
  // 会话键的**一次性令牌**（24 卡 R-01）：写一次、读一次、读完即清。为什么不是字符串字段：
  // 残留的键会被下一次"降级建档"写进第二条档案（R-01 运行期复现：换绑冲突后残留 ⇒ 两点后库里两条同键）；
  // 而"读后即清 + 降级路拿不到"这两条只能靠 `sheet-flow.js` 的纯函数钉住（`selftest` 不 require 页面 ⇒ TD-016）。
  keyToken: sheetFlow.createKeyToken(),
  // 本次浮层是不是由"会话选择那条路"打开的（决定保存时能不能用键；R-01 的闸门）
  fromChatFlow: false,
  // 「正在拉起好友列表」的重入闸：连点两下会拉起两次会话选择（第二次把第一次的选择顶掉）
  picking: false,
  pickStartedAt: 0,
  // 「换绑」的目标（批 3）：`{id, label}` 走**页面实例字段**，不进 `data`、不进 URL。
  // 只存"改哪条档案 + 它的锚（列表里本来就显示的人话）"；键本身只在一次性令牌里。
  rebindTarget: null,

  onShow() {
    // R-02 的兜底复位：平台既不 success 也不 fail 时（本仓注释记过这种挂死读数），
    // `picking` 若不在这两处复位，`fab` 与行内「换绑」会在本会话内**永久**变成"点一下弹一句"
    this.picking = false;
    this.pickStartedAt = 0;
    // 详情页回来的两件事：① 它把"要换绑的目标"寄存在本页实例字段上 ② 删除态/件数可能变了
    this.consumePendingRebind();
    this.refreshRecycle();
    this.refresh();
    this.consumePickup();
  },

  onHide() {
    // 切走（包括"被微信拉去聊天工具模式"那一次）就放开重入闸：回来时 `onShow` 会再收一次内存桥
    this.picking = false;
    this.pickStartedAt = 0;
  },

  // ── 内存桥收件（方案 N2 / A′）───────────────────────────────
  // 独立分包页只把平台原样返回送过来；**判读规则全在 utils/chat-tool.js**，这里一份都不抄。
  consumePickup() {
    const app = getApp();
    const packet = app && app.globalData ? app.globalData.chatToolPickup : null;
    if (!packet) return;
    // 消费一次即清：否则以后每次进这一格都会再弹一次浮层、把同一条旧读数当新事实
    app.globalData.chatToolPickup = null;
    // 优先走**会话键**那条（明文通道）：折出键就不必再指望 `getChatToolInfo` 的解密通道（U-5）。
    // ⚠️ 判定搬进 `sheetFlow.pickupPathOf`（"值是数组"而非"有没有 members 键"；r2 的 M4 证明这段
    //    原先没有机器闸 ⇒ 判据 + 断言一起落在零件里，见 `sheet-flow.js` 与 `selftest` §11b）。
    if (sheetFlow.pickupPathOf(packet) === 'key') {
      this.applySessionKey(packet);
      return;
    }
    this.applyLegacyRoomId(packet);
  },

  // 清掉"这一轮还能用键/原值"的三个状态（R-01/R-16 的唯一出口点：放弃/失败/换绑/关浮层都调它）
  // ⚠️ R-16：`chatRoomId`（平台原值）**必须与会话键同一条生命周期** —— 它原先只被 `clearChatBinding`
  //    清，于是"上一轮老路拿到的原值"活到下一轮、被写进新档案（r2 运行期复现：新档案挂上前一条会话的原值）。
  abandonKey() {
    this.keyToken.clear();
    this.fromChatFlow = false;
    this.chatRoomId = '';
  },

  // pick_friend 的建档案半段：`members`（明文双方 id）→ 摘要键 → 查重（SCOPE M1/M5）
  // ⛔ 任何一条失败都只降级（手填照旧能建），不许把用户挡在门外（M6）
  applySessionKey(packet) {
    const app = getApp();
    const pair = chatTool.readPairMembers({ members: packet.members });
    if (!pair.ok) {
      // 取不到键：病因按单源文案说清（群聊 / 结构不符），本页不猜
      this.sessionKeyFailed(pair.reason || 'CHAT_MEMBERS_FAILED');
      return;
    }
    const folded = chatTool.pairKeyOf(pair.members);
    if (!folded.ok) {
      this.sessionKeyFailed(folded.reason || 'BAD_MEMBERS');
      return;
    }
    const printed = chatTool.fingerprint(folded.key);
    // 换绑路（点「换绑」→ 选完会话回来）：**只改键**，且键**不经过令牌**（R-01：令牌只服务
    // "新建一条档案"那条路；`applyRebind` 的三个出口都清令牌，残留不会被下一次建档捡走）
    if (this.rebindTarget) {
      this.applyRebind(folded.key, printed);
      return;
    }
    // 取键意图（2026-09-25 B 段）：有人是在**录件中途**来取键的 ⇒ 键到手就把他送回那一屏（草稿在槽里）。
    // 消费即清 ⇒ 同一个意图绝不会劫持两次；接管了就**别再开本页的建档浮层**打岔。
    if (sessionKeyFlow.resumeIfPending(app, folded.key, wx)) return;
    // 建档路：把键放进**一次性令牌**并打开 `fromChatFlow` 闸门（保存时能不能用键只看它）；摘要进专用槽
    this.keyToken.set(folded.key);
    this.fromChatFlow = true;
    sessionKeyFlow.putSessionKey(app, folded.key);   // 摘要入槽的**唯一写点**（单源；M7 预选用它比对）
    const found = storage.findCustomerByChatKey(folded.key);
    if (!found.ok) {
      // 读库失败必须说出来：把"读不出来"当成"没建过"会立刻建出重复档案（§11.4 禁静默吞错）。
      // 同时**收回令牌**：宁可这次不带键，也不冒"重复建档"的险。
      this.abandonKey();
      this.setData({
        chatState: reasonText(found.reason) + '（不影响建档）',
        chatEvidence: 'reason=' + found.reason,
        chatKeyDigest: sheetFlow.fullChatKey(folded.key)
      });
      return;
    }
    // 命中 ⇒ **默认挡住**（同一个键建出第二条档案，"按会话自动归类"当场二义 = M5 的核心矛盾）；
    // 文案拼装搬进 `sheet-flow.describeSessionKey` ⇒ D3 纪律（只出指纹与锚、不出键原值）第一次可断言
    const view = sheetFlow.describeSessionKey(printed, found.customer);
    this.setData({
      chatState: view.chatState,
      chatEvidence: view.chatEvidence,
      sheetDupLabel: view.label,
      sheetDupText: view.sheetDupText,
      chatKeyDigest: sheetFlow.fullChatKey(folded.key)
    });
    this.onOpenSheet();
  },

  // 取键失败的两个病因（群聊 / 结构不符）共用一条落点：
  // 建档路只降级（手填照样能建）；**换绑路一个字节都不写** —— 换绑是写操作，宁可什么都不做。
  sessionKeyFailed(why) {
    this.abandonKey();   // R-01：失败路同样不许留键（残留会被下一次降级建档捡走）
    if (this.rebindTarget) {
      const target = this.rebindTarget;
      this.rebindTarget = null;
      this.setData({
        notice: '换绑没成功：' + reasonText(why) + '（「' + target.label + '」的绑定没有改动）'
      });
      return;
    }
    this.setData({ chatState: reasonText(why) + '（不影响建档）', chatEvidence: 'reason=' + why });
  },

  // 换绑落地（批 3 / SCOPE M7）：成功 / 冲突 / 其他失败三种结果都要有明确落点，
  // 且⛔屏上只出**锚 + 指纹**，不出键原值（D3 纪律与建档路同一条）。
  applyRebind(key, printed) {
    const target = this.rebindTarget;
    this.rebindTarget = null;
    this.abandonKey();   // R-01：进这条路的三种结局都不许把键留在令牌里（换绑的键只在这里用一次）
    const rebound = storage.rebindCustomerChatKey(target.id, key);
    if (rebound.ok) this.refresh();
    // 三态文案搬进 `sheet-flow.describeRebindNotice`（冲突时带持有者的锚与"是否已删除"，⛔ 不出键原值）；
    // 主体文案仍走 `reason.js` 单源 —— 页面不另写一份人话（ARCHITECTURE §2.3 落点表）
    const view = sheetFlow.describeRebindNotice(rebound, target, printed);
    this.setData({ chatState: '', chatEvidence: '', notice: view });
  },

  // N2 那条老路：`getChatToolInfo` 的三态（U-5）。官方口径里它返回的是**加密数据**，
  // 所以这条路多半会落在"没有那个键"；留着它是因为读数本身是取证依据（U-5 要靠它说话）。
  // ⚠️ 24 卡 R-03 之后这条路**可达**了（判据看"值是不是数组"）：分包页拿不到成员标识但拿到了
  //    `getChatToolInfo` 的返回时，这一屏就是 U-5 唯一的现场。
  applyLegacyRoomId(packet) {
    const app = getApp();
    // 三态判读 + `maskRoomIds` 脱敏 + 读数行拼装全在 `sheet-flow.describeLegacyPickup`（纯函数、可断言）
    const view = sheetFlow.describeLegacyPickup(packet, chatTool);
    this.chatRoomId = view.roomId;
    // K5 内存槽的写入方：**只放平台原值**（供录入页兼容分支读）；摘要槽 `chatKey` 由新路径写（老路算不出摘要）
    if (this.chatRoomId) app.globalData.chatRoomId = this.chatRoomId;
    // 老路也是"从会话进来的"：拿到原值时允许保存带它（DESIGN §10 待裁② = A：两种语义共存）；
    // 拿不到时不许留任何"可以用键"的信号（与建档路的降级同一条闸门）
    if (view.roomId) this.fromChatFlow = true; else this.abandonKey();
    this.setData({ chatState: view.stateText, chatEvidence: view.evidence, notice: '', chatKeyDigest: '' });
    this.onOpenSheet();   // 从聊天进来的目的就是建档：不再让人多点一次「＋ 新建」
  },

  // 一次会话只够建一条档案：建完就解绑，免得下一次保存把同一个键静默挂到第二个人身上
  clearChatBinding() {
    const app = getApp();
    this.chatRoomId = '';
    this.abandonKey();
    // ⛔ 只清平台原值槽；摘要槽 `chatKey` 刻意**不清**（M7 预选发生在用户稍后打开录入页时 ⇒ 必须会话级存活）
    if (app && app.globalData) app.globalData.chatRoomId = '';
    this.setData({ chatState: '', chatEvidence: '', sheetDupText: '', sheetDupLabel: '', chatKeyDigest: '' });
  },

  // 拉起"选择聊天好友"的唯一入口（`＋ 新建` 与「换绑」共用）：成功什么都不用做 ——
  // 微信已进入聊天工具模式并落在 `chatpick` 页，选完会话由本页 `onShow` 收内存桥。
  // 为什么抽出来：两条动线的差别只在"桥回来之后往哪落"，抄两份必然分叉。
  // R-02 三条修复都在这段（① 显式注入定时器 ② 重入不静默 `return` ③ 结算与 `onShow`/`onHide` 复位 `picking`）；
  // 真机读数② 之后，`url` 形态的**有界轮盘**整段住在 `sheetFlow.driveChatToolUrlWheel`（页面只给两个钩子）。
  startPick(onFail) {
    const decision = sheetFlow.shouldStartPick(
      { picking: this.picking, startedAt: this.pickStartedAt }, Date.now());
    if (!decision.start) {
      // ⛔ 不许静默吞点击：R-02 之前这里只弹一句就 return，而 `picking` 再也回不来
      wx.showToast({ title: '正在拉起好友列表…稍等一下，或过一会儿再点一次', icon: 'none' });
      return;
    }
    this.picking = true;
    this.pickStartedAt = Date.now();
    // 真机读数②：`url` 形态不对时平台回 `openChatTool:fail invaild chatTool subpackage url` ⇒ 一次点击
    // **有界**试三种候选。轮盘整段住在 `sheet-flow`（含"只在 url 不合法时换形态"的判定）：页面只给两个钩子。
    sheetFlow.driveChatToolUrlWheel(
      (url) => chatTool.startChatPick({
        url: url,
        // 注入全局定时器：测试可换 mock，生产拿到真看门狗（与 `bind`/`readRoomId` 同一条口径）
        setTimeout: setTimeout,
        clearTimeout: clearTimeout
      }),
      (result, tried) => {
        this.picking = false;
        this.pickStartedAt = 0;
        if (result && result.ok) {
          // 赢家留在屏上（tab 页实例常驻，选完回来还看得见）：这是"哪种 url 形态被接受"的唯一读数
          this.pickUrlUsed = tried.length ? tried[tried.length - 1] : '';
          this.setData({ notice: '已进入聊天工具模式（url 形态 ' + this.pickUrlUsed + ' 被平台接受）' });
          return;
        }
        // 把**整份结果**交给调用方：`reason` 只够说人话，`detail`/`rawErrMsg` 才是病因（真机读数①：五个出口曾被压成一行）
        onFail(result && typeof result === 'object' ? result : { ok: false, reason: 'CHAT_OPEN_FAILED' }, tried);
      });
  },

  // fab「＋ 新建」：**先**拉起"选择聊天好友"（官方 §2.1 方式 1），拿不到才降级手填（SCOPE M1/M6）
  onNewCustomer() {
    // 降级只有一条路：把原因按单源文案写进状态行 + 照旧打开手填浮层。⛔ 平台原文**脱敏后**才上屏（D3）。
    // R-01：降级路**先**清令牌与闸门 —— 这条路上"保存时能拿到键"在结构上就是错的
    this.startPick((failure, tried) => {
      this.abandonKey();
      this.setData({
        chatState: reasonText(failure.reason) + '（下面手填一样能建）',
        // `triedUrls`：这次试过的形态链一起上屏 —— 真机读数② 之后，"哪个形态被接受"只看这一行
        chatEvidence: sheetFlow.formatPickEvidence(failure, chatTool, { roomIds: [this.chatRoomId], triedUrls: tried }),
        chatKeyDigest: ''   // 降级路 = 这次不带键 ⇒ 上一条的摘要不能留着冒充
      });
      this.onOpenSheet();
    });
  },

  // 行内「换绑」（批 3 / SCOPE M7）：平台换了会话 id ⇒ 把这位客户重新认回来。
  // 与「＋ 新建」共用 `startPick`；选择会话没完成就**不发写入**（写操作宁可什么都不做）。
  onRebindKey(event) {
    const id = event.currentTarget.dataset.id;
    // 列表刚刷新过、点到已消失的行：什么都不做 —— 不猜一条档案去改键
    const target = this.data.customers.filter((item) => item.id === id)[0];
    if (!target) return;
    // 锚只用于说人话（列表里本来就显示它）；⛔ 键不进 `data`，也不在这条路上进令牌
    this.rebindTarget = { id: target.id, label: aggregate.customerLabel(target) };   // 单源：⛔ 别在本页再拼一次
    this.abandonKey();
    this.startPick((failure, tried) => {
      this.rebindTarget = null;
      this.abandonKey();
      // 同一份仪器：这条降级路也要能读出病因（否则"换绑没进行"又是一句什么都说明不了的话）
      this.setData({
        notice: '换绑没进行：' + reasonText(failure.reason) + '（现有绑定没有改动） ｜ '
          + sheetFlow.formatPickEvidence(failure, chatTool, { roomIds: [this.chatRoomId], triedUrls: tried })
      });
    });
  },

  // 重新选一次好友：先关浮层（否则选完回来叠着两层），再走同一条拉起流程（不另写一份）
  onChatRetry() {
    this.setData({ sheetOpen: false });
    this.abandonKey();   // 上一轮的键作废：重新选就是重新来（R-01）
    this.onNewCustomer();
  },

  // 「仍要新建」：人明确放弃复用 ⇒ 清掉查重提示**与键**——键仍归原档案，
  // 带着同一个键建第二条 = 库里出现两条同键档案，"按会话自动归类"当场二义
  onForceNew() {
    this.abandonKey();
    this.setData({
      sheetDupText: '',
      sheetDupLabel: '',
      sheetError: '',
      chatState: '这次不带会话键（键仍留在原档案）。手填建档后照样能用清单。',
      chatKeyDigest: ''
    });
    this.syncSheetHeight(false);
  },

  // 「去这条档案」：档案列表就在浮层后面 ⇒ 关掉浮层 + 顶部说明是哪一条（不跳页、不猜 id）
  onGoDup() {
    const label = this.data.sheetDupLabel;
    this.abandonKey();   // 人选择了复用 ⇒ 这一轮的键作废（不留到下一次保存）
    this.setData({
      sheetOpen: false,
      notice: label ? '这条会话对应的档案是列表里的「' + label + '」（已建过，不再新建）。' : '这条会话已经建过档案。'
    });
  },

  refresh() {
    const loaded = storage.listCustomers(); // 默认已排除软删除
    if (!loaded.ok) {
      this.setData({ customers: [], isEmpty: true, errorText: reasonText(loaded.reason) });
      return;
    }
    // 排序只认 aggregate.sortCustomers（楼区固定序 → 宿舍号自然数字序）；页面不许自己 sort（W2 同一条纪律）

    const customers = sheetFlow.toRowViews(aggregate.sortCustomers(loaded.customers));
    // ⛔ 这里刻意**不算**"待取 N"（SCOPE M9 负向判据：档案行不显示待取计数、不显示 id）
    this.setData({ customers: customers, isEmpty: customers.length === 0, errorText: '' });
  },

  // 浮层里可滚区的高度只在这一处算（三处 setData 都调它，免得各写一份算式慢慢分叉）
  syncSheetHeight(hasError) {
    this.setData({
      sheetScrollHeight: computeSheetScrollHeight(
        hasError, this.data.sheetNameAuto, !!this.data.chatState)
    });
  },

  onOpenSheet() {
    this.setData({
      sheetOpen: true, sheetLine: '', sheetError: '', sheetNameAuto: false, saving: false,
      sheetForm: { building: '', dorm: '', name: '' }
    });
    // 查重提示**不在这里清**：命中时浮层就是被它打开的，清了人就没法判断该不该建
    this.syncSheetHeight(false);
  },

  onCloseSheet() {
    this.abandonKey();   // 人关掉浮层 = 这一轮作废（R-01：残留键不许活到下一次保存）
    this.setData({ sheetOpen: false });
  },

  // 那一行输入一变就拆（用户口径："粘贴完自动分段"）。拆解与补名全在 utils/customer-input.js，
  // 本批又把"patch 怎么拼"搬进 `./sheet-line.js`（纯函数 ⇒ 首次可断言；页面只 setData）。
  onSheetInput(event) {
    this.applySheetLine(event.detail.value);
  },

  applySheetLine(line) {
    const loaded = storage.listCustomers();
    if (!loaded.ok) {
      // 读库失败**必须说出来**（没有现有档案就算不出"同楼同宿舍的下一个后缀"，静默走空列表会补出重名档案）
      this.setData(sheetLine.storeFailedPatch(line, loaded.reason));
      this.syncSheetHeight(true);
      return;
    }
    const outcome = sheetLine.sheetLinePatch(loaded.customers, line);
    this.setData(outcome.patch);
    this.syncSheetHeight(outcome.hasError);
  },

  // 三格可逐格改（拆得不满意时人自己救得回来，不必重打整行）
  onSheetFieldInput(event) {
    const field = event.currentTarget.dataset.field;
    const form = Object.assign({}, this.data.sheetForm);
    form[field] = event.detail.value;
    this.setData({ sheetForm: form, sheetError: '' });
  },

  onSheetSave() {
    if (this.data.saving) return; // 防连点建出两条同一地址的档案
    // 命中已有档案时**不许**静默建第二条（M5）：要么「去这条档案」，要么先按「仍要新建」明确放弃复用
    if (this.data.sheetDupText) {
      this.setData({ sheetError: '这条会话已经建过档案了 —— 请先点上面的「去这条档案」或「仍要新建」。' });
      this.syncSheetHeight(true);
      return;
    }
    const showError = (text) => {
      this.setData({ sheetError: text });
      this.syncSheetHeight(true);
    };
    // 值域闸（R-11：从本函数抽到 `sheet-flow.js`；规则仍只认 `utils/buildings.js` 一份事实源）
    const gated = sheetFlow.gateSheetForm(this.data.sheetForm, buildings);
    if (!gated.ok) {
      showError(gated.message || reasonText(gated.reason));
      return;
    }
    const loaded = storage.listCustomers();
    if (!loaded.ok) {
      showError(reasonText(loaded.reason));
      return;
    }
    // 键决议（**R-01 的治根点**）：令牌读后即清；`fromChatFlow=false` 时结构上拿不到键
    // （降级建档、换绑之后的残留、上一轮没走完就改主意 —— 三种情况都在这里被挡住）
    const resolved = sheetFlow.resolveChatKeyForSave(this.keyToken, this.fromChatFlow, this.chatRoomId);
    // 纵深防御（R-01 ③）：决议给键之后**落库前再查一次**（第二道闸住在 `sheetFlow.planSave`，纯函数可断言）
    const plan = sheetFlow.planSave(resolved, (k) => storage.findCustomerByChatKey(k));
    if (plan.action === 'error') {
      showError(reasonText(plan.reason));   // 读不出来就当"没建过"会立刻建出重复档案（§11.4 禁静默吞错）
      return;
    }
    if (plan.action === 'dup') {
      const dupView = sheetFlow.describeSessionKey(chatTool.fingerprint(resolved.key), plan.dup);
      this.setData({ sheetDupLabel: dupView.label, sheetDupText: dupView.sheetDupText, sheetError: '' });
      this.syncSheetHeight(false);
      return;
    }
    this.createFromSheet(gated, resolved, loaded.customers, showError);
  },

  // 唯一建档口的调用点（抽出来只为把 `onSheetSave` 压回 ≤50 行 —— 24 卡 R-11）
  createFromSheet(gated, resolved, customers, showError) {
    // 称呼留空时先过补名规则（`D4 522 A/B/C…`）：库里 `Customer.name` 强制非空，空名会在写盘时被
    // `CUSTOMER_INVALID:name` 拒掉 —— 那是一条人看不懂的报错，所以在写盘前先补好
    const named = customerInput.nextCustomerName(customers, gated.building, gated.dorm, this.data.sheetForm.name);
    this.setData({ saving: true });
    // 落库用**闸的产出**（到这里它已与人写的值逐字一致，只差大小写规范），否则同一间房会按大小写裂成两条档案。
    // 会话键来自上面的决议：`resolved.key` 是空串时就是"未绑定会话"（DESIGN §1：空串合法）。
    const created = storage.createCustomer({
      building: gated.building,
      dorm: gated.dorm,
      name: named.name,
      note: '',
      chatRoomId: resolved.key
    });
    this.setData({ saving: false });
    if (!created.ok) {
      showError(failureText(created.reason, created.detail));
      return;
    }
    this.afterCreated(created);
  },

  // 落库之后的三件事（抽出来只为把 `onSheetSave` 压回 ≤50 行 —— 24 卡 R-11）
  afterCreated(created) {
    this.setData({ sheetOpen: false, notice: '' });
    this.clearChatBinding();   // 一次会话只建一条：不解除的话下一条档案会静默挂上同一个人
    this.refresh();
    if (created.reason === 'ROOM_ID_DISCARDED') {
      // 档案**已经写进去了**、只是那个 id 没被采用 ⇒ 必须说给人听，不许用一句 toast 糊过去（R3-05）
      this.setData({ notice: reasonText('ROOM_ID_DISCARDED') });
      return;
    }
    wx.showToast({ title: '建好了', icon: 'success' });
  },

  // 行内「＋ 录快件」→ 录入页。为什么从这一行进、且带 customerId：
  // 录入必须知道**给谁录**，而 tab 页不能带参数跳转 ⇒ 只有非 tab 的录入页能收这个参数（DESIGN §7 页面表）
  onGoRecognize(event) {
    const id = event.currentTarget.dataset.id;
    // 编码口径与清单页那个入口一致（r3 的 R3-13：同一条"带 customerId 进录入页"两处写法不同）：
    // 现在库里的 id 是 `c<时间戳><随机>` 不含特殊字符，但不该让"要不要编码"随拼法改变而分叉
    wx.navigateTo({ url: '/pages/recognize/index?customerId=' + encodeURIComponent(id) });
  }
  // 行手势 / 软删 / 回收站的方法由 `row-actions.js` 并进来（本页卡 500 行硬线；`this` 仍是本页实例）
}, rowActions));
