// pages/archive-list/row-actions.js · 档案行的手势/删除/回收站 —— **页面方法混合件**
//
// 为什么是"混合件"而不是普通零件：这些处理器必须挂在页面上（`bindtap`/`bindtouch*` 只认页面方法），
// 而 `pages/archive-list/index.js` **正好卡在 500 行硬线**（AGENTS §11.1）⇒ 再往里塞 70 行就破线。
// 页面用 `Page(Object.assign({...}, rowActions))` 把它并进来，方法里的 `this` 仍是页面实例。
// 纯判据（阈值/方向/文案/确认词/刷新补丁）仍住在 `swipe.js` 与 `recycle.js` —— 那两个是**可断言**的，
// 本文件只做"读盘 → 判据 → setData/写盘"的接线（页面层零断言 TD-016）。
'use strict';

const storage = require('../../utils/storage.js');
const aggregate = require('../../utils/aggregate.js');
const { reasonText } = require('../../utils/reason.js');
const sheetFlow = require('./sheet-flow.js');
const recycle = require('./recycle.js');
const swipe = require('./swipe.js');

module.exports = {
  // ── 左滑（右→左划一下露出「删除」，再点它走二次确认）──────────────────────────
  // 判定放在 `touchend`：用"起点 vs 终点"算位移，不跟 `touchmove` 的连发抢渲染
  // （一次拖动会发几十个 move 事件，边拖边 setData 在长列表上就是抖）。
  onRowTouchStart(event) {
    const touch = (event.touches && event.touches[0]) || {};
    this.touchFrom = { x: touch.pageX || 0, y: touch.pageY || 0 };
  },

  onRowTouchEnd(event) {
    const from = this.touchFrom;
    this.touchFrom = null;
    if (!from) return;
    const touch = (event.changedTouches && event.changedTouches[0]) || {};
    const id = (event.currentTarget.dataset && event.currentTarget.dataset.id) || '';
    if (!id) return;
    const decision = swipe.decideSwipe({
      dx: (touch.pageX || 0) - from.x,
      dy: (touch.pageY || 0) - from.y,
      opened: this.data.swipeId === id
    });
    if (decision.action === 'open') this.setData({ swipeId: swipe.nextOpenId(id, this.data.swipeId).openId });
    else if (decision.action === 'close') this.setData({ swipeId: '' });
  },

  // ── 档案发生任何增删改之后**唯一的收口**（2026-09-25 真机反馈「优化在删除后立即刷新」）────────
  // 四条路径（软删 / 恢复 / 逐条彻底删除 / 全部彻底删除）都调它，一处都不许自己写 setData：
  // 根因就是有人只刷新了列表、漏了底部「已删除(N)」的计数与件数合计 ⇒ 要等下次 onShow 才更新，
  // 而这一页**没有任何页面级断言**（TD-016）看着这几个键。补丁本体在 `recycle.recyclePatch`（可断言）。
  afterCustomerMutation(notice) {
    this.refresh();
    const rows = this.recycleRows();
    // 读库失败时只写 notice：拿空数组去覆盖计数会把"读不出来"显示成"没有已删档案"（另一种假话）
    this.setData(rows ? recycle.recyclePatch(rows, notice) : { notice: notice });
  },

  // ── 软删（用户裁决③：软删 + 二次确认，可恢复）──────────────────────────────
  onRowDelete(event) {
    const id = event.currentTarget.dataset.id;
    const row = this.data.customers.filter((item) => item.id === id)[0];
    if (!row) return;
    const parcels = storage.listParcels();
    // 确认框里的 N 用 `countActiveByCustomer`（口径 = **未删除**总数，与 `softDeleteCustomer` 同源）
    const label = aggregate.customerLabel(row);   // 单源（聚合模块）：空称呼派生名不得把前缀拼第二遍
    const count = parcels.ok ? (aggregate.countActiveByCustomer(parcels.parcels)[id] || 0) : 0;
    wx.showModal({
      title: '删除档案',
      content: recycle.softDeleteQuestion({ label, parcelCount: count }),
      confirmText: '删除',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return;
        const deleted = storage.softDeleteCustomer(id);
        this.setData({ swipeId: '' });   // 行没了，左滑态也要跟着收
        // 软删之后底部「已删除(N)」必须**当场**出现/加一 ⇒ 走统一收口（计数与件数一起重算）
        this.afterCustomerMutation(deleted.ok
          ? ('已删除「' + label + '」（名下 ' + deleted.deletedParcels + ' 条快件一起隐藏；可恢复）')
          : ('删除没成功：' + reasonText(deleted.reason)));
      }
    });
  },

  // ── 进详情页（临时拼 URL：只有 id 进 URL，键与原值都不进）────────────────────
  onOpenDetail(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/customer-detail/index?customerId=' + encodeURIComponent(id) });
  },

  // ── 回收站（用户裁决④：软删要留一个真删的入口）─────────────────────────────
  recycleRows() {
    const loaded = storage.listCustomers({ includeDeleted: true });
    if (!loaded.ok) return null;
    // 这里要的是"真删会连带删掉多少件" ⇒ 用**全量**（含已删）件数，与档案行确认框那个"未删件数"不是一个数
    const parcels = storage.listParcels({ includeDeleted: true });
    const totals = {};
    for (const parcel of (parcels.ok ? parcels.parcels : [])) {
      totals[parcel.customerId] = (totals[parcel.customerId] || 0) + 1;
    }
    return recycle.deletedRows(loaded.customers, totals);
  },

  // 入口上的数字来自这里（`deletedCount`）——⛔ 不在 wxml 里现算（页面层零断言 TD-016）。
  // 补丁本体在 `recycle.recyclePatch`：行 / 计数 / 件数合计 / arm 复位**一次给全**，别在这里手写这几个键。
  refreshRecycle() {
    const rows = this.recycleRows();
    if (!rows) return;
    this.setData(recycle.recyclePatch(rows, this.data.notice));
  },

  onOpenRecycle() {
    const rows = this.recycleRows();
    if (!rows) { this.setData({ notice: '打不开回收站：读库失败' }); return; }
    this.setData({
      recycleOpen: true, deletedRows: rows, deletedCount: rows.length,
      deletedParcelTotal: recycle.purgeTotals(rows).parcelCount,
      purgeArmedId: '', purgeAllArmed: false, purgeQuestion: '', purgeAllQuestion: ''
    });
  },

  onCloseRecycle() {
    this.setData({ recycleOpen: false, purgeArmedId: '', purgeAllArmed: false, purgeQuestion: '', purgeAllQuestion: '' });
  },

  // 恢复：存储层按**批次串**认领 ⇒ 单独删过的快件不会被连坐复活（DESIGN §3 的两套口径之一）。
  // 恢复也要**当场**把入口计数改掉（用户 2026-09-25：「优化在删除后立即刷新」）⇒ 同一个收口。
  onRecycleRestore(event) {
    const id = event.currentTarget.dataset.id;
    const restored = storage.restoreCustomer(id);
    this.afterCustomerMutation(restored.ok
      ? ('已恢复（名下 ' + restored.restoredParcels + ' 条快件一起回来）')
      : ('恢复没成功：' + reasonText(restored.reason)));
  },

  // 彻底删除（两步按钮，2026-09-25 用户裁决「第二次确认应该由按钮承担」）：
  // 第一下只 arm —— 摊开后果（几位/几件/不可逆无备份）并让按钮换字；**同一行再点一下**才真删。
  // ⛔ 删除动作只由用户点出来；agent 不执行任何删除（AGENTS §4 不可委托清单）。
  onPurgeAsk(event) {
    const id = event.currentTarget.dataset.id;
    const row = this.data.deletedRows.filter((item) => item.id === id)[0];
    if (!row) return;
    if (this.data.purgeArmedId === id) {
      const purged = storage.purgeCustomer(id);
      this.afterCustomerMutation(purged.ok
        ? ('已彻底删除「' + row.label + '」及其名下 ' + purged.purgedParcels + ' 条快件记录（不可恢复）')
        : ('彻底删除没成功：' + reasonText(purged.reason)
          + (purged.reason === 'PURGE_REQUIRES_SOFT_DELETE' ? '（请先「删除」，再回来彻底删除）' : '')));
      return;
    }
    // 一次只 arm 一个：全部删除与逐条删除共用同一批按钮样式，同时 arm 会让人分不清哪一下删哪个
    this.setData({ purgeArmedId: id, purgeQuestion: row.purgeQuestion, purgeAllArmed: false, purgeAllQuestion: '', notice: '' });
  },

  // 「全部彻底删除」：同样两步。数字（几位/共几件）在 arm 时就算好并摊开 —— 比逐条更危险的一颗按钮。
  onPurgeAllAsk() {
    if (this.data.purgeAllArmed) {
      const purged = storage.purgeAllDeleted();
      this.afterCustomerMutation(purged.ok
        ? ('已彻底删除 ' + purged.purgedCustomers + ' 位档案与 ' + purged.purgedParcels + ' 条快件记录（不可恢复）')
        : ('全部彻底删除没成功：' + reasonText(purged.reason)));
      return;
    }
    const rows = this.data.deletedRows || [];
    this.setData({
      purgeAllArmed: true,
      purgeAllQuestion: recycle.purgeAllQuestion(rows),
      purgeAllArmedText: recycle.purgeAllButtonText(true, rows.length),
      purgeArmedId: '', purgeQuestion: '', notice: ''
    });
  },

  // ── 详情页发起的换绑：转到本页同一条流程（不写第二套拉起逻辑）──────────────────
  // 详情页把目标写进**本页实例字段** `pendingRebindFromDetail` 再 `navigateBack()`（详情页是 `navigateTo` 出来的，
  // `getCurrentPages()` 里上一页就是本页）。为什么不用 `globalData`：AGENTS §11.1 禁隐式全局状态，
  // 而 `app.js` 的槽声明不在本批写盘范围内；为什么不在详情页直接拉起会话选择：
  // `chatpick/` 选完固定 `switchTab` 回**档案格**，从详情页拉起必然落错页 ⇒ 落点只留一个。
  consumePendingRebind() {
    const slot = this.pendingRebindFromDetail;
    if (!slot || !slot.id) return;
    this.pendingRebindFromDetail = null;   // 用完即清（与内存桥同一条纪律）
    this.onRebindKey({ currentTarget: { dataset: { id: slot.id } } });
  },

  // 详情页用得到的键格式化（同一份单源：⛔ 不在详情页重写一份）
  keyTextOf(key) {
    return { short: sheetFlow.shortChatKey(key), full: sheetFlow.fullChatKey(key) };
  }
};
