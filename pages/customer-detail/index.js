// pages/customer-detail/index.js · 客户详情（用户裁决①②：新页面；基本字段可改 / 会话键 / 名下快件 + 操作区）
//
// 分层（ARCHITECTURE §2/§3）：页不直接读写本地存储、不重写业务规则 —— 取数走 `utils/storage.js`，
// 值域闸走 `utils/customer-input.js`（与建档**同一个闸**），键格式化走**档案页那份零件**
// （`../archive-list/sheet-flow.js`：⛔ 宁可跨页 require 也不写第二份格式化），分组/表单纯函数在 `./parts.js`。
// ⛔ 键只出摘要（不可逆）；平台原值一个字符都不上屏。
'use strict';

const storage = require('../../utils/storage.js');
const customerInput = require('../../utils/customer-input.js');
const { reasonText } = require('../../utils/reason.js');
const sheetFlow = require('../archive-list/sheet-flow.js');
const recycle = require('../archive-list/recycle.js');
const aggregate = require('../../utils/aggregate.js');   // 客户标签单源（页面头与列表主行同一份）
const parts = require('./parts.js');

Page({
  data: {
    loading: true,
    errorText: '',
    // 可改的基本字段（值域闸与建档同源；`note` 只有长度上限）
    form: { building: '', dorm: '', name: '', note: '' },
    header: '',   // 页头标签（单源 `aggregate.customerLabel`；编辑中随 form 同步）
    // 会话键：短键给标题旁的小标签，完整摘要给一行小字（用户裁决①"详情/浮层完整摘要"）
    keyShort: '',
    keyFull: '',
    isDeleted: false,
    groups: [],
    parcelTotal: 0,
    notice: ''
  },

  // 页面实例字段：`customerId` 不进 `data` 会更好（id 只在 data-* 与 URL 里流转），
  // 但 `onLoad` 之后每个方法都要用它 ⇒ 留在 data 里、⛔ 不上屏（wxml 里不许渲染 id）。
  customerId: '',

  onLoad(options) {
    const raw = options && options.customerId ? options.customerId : '';
    this.customerId = raw ? decodeURIComponent(raw) : '';
    this.load();
  },

  // 从"换绑"的档案页回来、或从其它页面返回时重算（件数/删除态可能已经变了）
  onShow() {
    if (this.customerId && !this.data.loading) this.load();
  },

  load() {
    const found = storage.getCustomer(this.customerId);
    if (!found.ok) {
      // M1：取数失败必须说出来（不白屏、不静默跳走）
      this.setData({
        loading: false,
        errorText: found.reason === 'NOT_FOUND'
          ? '这条档案不在了（可能刚被删除）。返回列表看看。'
          : ('读库失败：' + reasonText(found.reason))
      });
      return;
    }
    const customer = found.customer;
    const parcels = storage.listParcels({ customerId: customer.id });
    this.setData({
      loading: false,
      errorText: '',
      form: parts.editForm(customer),
      // 页头 = 单源标签（楼栋 宿舍 + 称呼）：空称呼派生名自带 A/B/C ⇒ 同宿舍两位在详情页也分得清
      header: aggregate.customerLabel(customer),
      keyShort: sheetFlow.shortChatKey(customer.chatRoomId),
      keyFull: sheetFlow.fullChatKey(customer.chatRoomId),
      isDeleted: !!customer.deletedAt,
      groups: parts.groupByStation(parcels.ok ? parcels.parcels : []),
      parcelTotal: parcels.ok ? parcels.parcels.length : 0
    });
  },

  onFieldInput(event) {
    const field = event.currentTarget.dataset.field;
    const form = Object.assign({}, this.data.form);
    form[field] = event.detail.value;
    this.setData({ form: form, notice: '', header: aggregate.customerLabel(form) });
  },

  onSave() {
    const form = this.data.form;
    const found = storage.getCustomer(this.customerId);
    if (!found.ok) { this.setData({ errorText: '保存失败：' + reasonText(found.reason) }); return; }
    if (found.customer.deletedAt) { this.setData({ notice: '这条档案已删除 —— 先恢复再改。' }); return; }
    if (parts.changedFields(found.customer, form).length === 0) { this.setData({ notice: '没有改动，什么都没写' }); return; }
    // 值域闸与建档**同一个**：拿"楼栋-宿舍号 称呼"这一行过 `buildCustomerInput`
    // （⛔ 不在本页写楼栋/宿舍号正则，那就是第二份实现）。备注不参与这一行。
    const all = storage.listCustomers();
    if (!all.ok) { this.setData({ errorText: '保存失败：' + reasonText(all.reason) }); return; }
    const gate = customerInput.buildCustomerInput(all.customers, parts.composeLine(form));
    if (!gate.ok) { this.setData({ errorText: reasonText(gate.reason) }); return; }
    const saved = storage.updateCustomer(this.customerId, {
      building: gate.building, dorm: gate.dorm, name: gate.name, note: form.note
    });
    if (!saved.ok) { this.setData({ errorText: '保存失败：' + reasonText(saved.reason) }); return; }
    this.setData({
      notice: gate.auto === true
        ? ('已保存（称呼留空 ⇒ 按同楼栋同宿舍的顺序分配为「' + gate.name + '」）')
        : '已保存'
    });
    this.load();
  },

  // 软删（用户裁决③的语义在详情页也一样：先软删、可恢复；真删只在回收站里做）
  onSoftDelete() {
    const label = [this.data.form.building, this.data.form.dorm, this.data.form.name].filter((one) => one).join(' ');
    wx.showModal({
      title: '删除档案',
      content: recycle.softDeleteQuestion({ label: label, parcelCount: this.data.parcelTotal }),
      confirmText: '删除',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return;
        const deleted = storage.softDeleteCustomer(this.customerId);
        if (!deleted.ok) { this.setData({ errorText: '删除失败：' + reasonText(deleted.reason) }); return; }
        wx.navigateBack();   // 列表的 onShow 会 syncAfterDetail() 重算
      }
    });
  },

  onRestore() {
    const restored = storage.restoreCustomer(this.customerId);
    this.setData({
      notice: restored.ok
        ? ('已恢复（名下 ' + restored.restoredParcels + ' 条快件一起回来）')
        : ('恢复失败：' + reasonText(restored.reason))
    });
    this.load();
  },

  // 换绑：**不在这里拉起好友列表** —— `chatpick/` 的返回落点硬编码是档案格，
  // 所以把目标交给上一个页面（档案页）实例，由它走自己那条 `startPick → applyRebind`（同一份流程、同一个写入口）。
  // 为什么不用 `globalData`：§11.1 禁"隐式全局状态"，而 `app.js` 的槽声明不在本批写盘范围内
  // ⇒ 用小程序标准的 `getCurrentPages()` 取父页实例（页面实例字段，不进 data、不上屏）。
  onRebind() {
    const stack = getCurrentPages();
    const prev = stack.length >= 2 ? stack[stack.length - 2] : null;
    if (!prev || typeof prev.consumePendingRebind !== 'function') {
      this.setData({ notice: '请回列表页点那一行的「换绑」（本页拿不到上一个页面）' });
      return;
    }
    prev.pendingRebindFromDetail = { id: this.customerId };
    wx.navigateBack();
  }
});
