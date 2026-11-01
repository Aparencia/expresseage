// pkg-partner/pages/order-detail/parts/page-timers.js · 页面计时器（留言 10s 轮询 + 撤销条 1s 倒计时）
// 职责：只管理页面实例上的句柄（this.messageTimer / this.undoTimer）与启停；终态判定在 message-poll 纯件、倒计时在 undo 纯件。
// 边界：页面方法（与 index.js 合并为 Page 配置）；不 setData 业务快照、不发写请求，回调只读 this.data 并调页面已有方法 loadMessages。
'use strict';

const messagePoll = require('./message-poll');
const undoPart = require('./undo');
const UNDO_TICK_MS = 1000;
const MESSAGE_POLL_MS = 10000;

module.exports = {
  // 留言 10s 轮询（页面可见时；离页/终态停止，不在后台空转）
  startMessagePoll() {
    if (this.messageTimer || !this.data.orderNo || messagePoll.isTerminal(this.data.order)) {
      return;
    }
    this.messageTimer = setInterval(() => {
      if (!this.data.loading) {
        this.loadMessages();
      }
    }, MESSAGE_POLL_MS);
  },
  stopMessagePoll() {
    if (this.messageTimer) {
      clearInterval(this.messageTimer);
      this.messageTimer = null;
    }
  },

  // ---------- 撤销条（5 秒窗由服务端 actions 判定，本地只做倒计时展示） ----------
  syncUndoTimer() {
    if (!this.data.undoBar.visible) {
      this.clearUndoTimer();
      return;
    }
    if (this.undoTimer) {
      return;
    }
    this.undoTimer = setInterval(() => {
      const bar = undoPart.buildBar(this.data.order, this.data.actions, Date.now());
      this.setData({ undoBar: bar });
      if (!bar.visible) {
        this.clearUndoTimer();
      }
    }, UNDO_TICK_MS);
  },
  clearUndoTimer() {
    if (this.undoTimer) {
      clearInterval(this.undoTimer);
      this.undoTimer = null;
    }
  }
};
