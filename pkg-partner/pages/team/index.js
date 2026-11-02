// pkg-partner/pages/team/index.js · 我的团队（D59 兼职子队员）
// 口径：docs/contract/V4_CONTRACT.md §13 D59；docs/archive/reviews/2026-11-03_BATCH26_27_INTERFACE_DRAFT.md §2.3/§2.4；
//      批 26/27 派工单 §9。主兼职视角：成员列表（编号+昵称+状态+加入时间，无头像）+ 发子邀请码 +
//      待使用子码按批次分组（只显示尾 4 位/到期）+ 作废本批 + 移除成员 + 名额 quota{used,reserved,max}；
//      子队员视角：只显示所属队伍 P-XXX 与成员数。
// 数据全部来自 partner.listSubMembers（服务端分组/状态文案口径），写操作经 api/modules/partner 四个动作；
// 页面层零业务判据：本文件不写任何状态字符串、不拼编号、不生成邀请码、不直连 wx.cloud。
'use strict';

const partnerApi = require('../../../api/modules/partner');
const modeGuard = require('../../../api/mode-guard');
const teamModel = require('./parts/team-model');

// 切换会话（TEST_WRITE）下写操作成功提示必须点明"测试数据"
function writeHint(text) {
  return modeGuard.isTestWrite() ? text + '（测试数据）' : text;
}

Page({
  data: teamModel.initialView(),

  onLoad() {
    this.dto = null;
    this.result = null;
    this.creating = false;
    this.hidden = false;
  },

  onShow() {
    this.hidden = false;
    this.setData({ readonly: !modeGuard.canRenderWriteButton() });
    this.load();
  },

  // P2-2：完整子邀请码一次性（D59）——切后台/离开页面即丢弃本会话结果块，
  // 不落本地存储、不进 URL、不放分享卡片；回前台只重建空结果（不把旧完整码装回）。
  onHide() {
    this.hidden = true;
    this.result = null;
    this.setData({ result: teamModel.emptyResult() });
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  load() {
    this.setData({ loading: true, error: '' });
    return partnerApi
      .listSubMembers({})
      .then((dto) => {
        this.dto = dto || {};
        this.applyView();
        return true;
      })
      .catch((err) => {
        this.setData({ loading: false, error: (err && err.message) || '团队信息没加载出来，检查网络后重试' });
        return false;
      });
  },

  applyView() {
    this.setData(teamModel.buildSnapshot(this.dto, {
      nowMs: Date.now(),
      readonly: this.data.readonly,
      form: this.data.form,
      result: this.result
    }));
  },

  guardReadonly() {
    if (modeGuard.canRenderWriteButton()) {
      return false;
    }
    wx.showToast({ title: '开发者只读视角不能操作', icon: 'none' });
    return true;
  },

  onCountTap(event) {
    if (this.guardReadonly()) {
      return;
    }
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    this.setData({ form: teamModel.selectCount(this.data.form, dataset.count) });
  },

  onValidityTap(event) {
    if (this.guardReadonly()) {
      return;
    }
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    this.setData({ form: teamModel.selectValidity(this.data.form, dataset.key) });
  },

  onNoteInput(event) {
    this.setData({ form: teamModel.inputNote(this.data.form, event.detail && event.detail.value) });
  },

  onCreateTap() {
    if (this.creating || this.guardReadonly()) {
      return;
    }
    const quota = this.data.quota || {};
    if (quota.canCreate !== true) {
      wx.showToast({ title: quota.fullReasonText || '现在不能再发子邀请码', icon: 'none' });
      return;
    }
    const built = teamModel.buildCreatePayload(this.data.form);
    if (!built.ok) {
      wx.showToast({ title: built.message, icon: 'none' });
      return;
    }
    this.creating = true;
    this.setData({ creating: true });
    partnerApi
      .createSubInvites(built.data)
      .then((response) => {
        // D59：完整码只在本次响应展示（一次性）——先渲染结果块，再刷新名额/待用码列表；
        // P2-2：若创建响应回来时页面已切后台，直接丢弃（不能把完整码带回前台）
        this.result = this.hidden ? null : (response || null);
        this.setData({ form: { count: this.data.form.count, validity: this.data.form.validity, note: '' } });
        this.creating = false;
        this.setData({ creating: false });
        this.applyView();
        wx.showToast({ title: writeHint('子邀请码已生成'), icon: 'none' });
        return this.load();
      })
      .catch((err) => {
        this.creating = false;
        this.setData({ creating: false });
        wx.showToast({ title: teamModel.failureText(err), icon: 'none' });
      });
  },

  // P2-2：完整码可一键复制 / 长按复制（一次性口径不变）——只进剪贴板，不落本地存储、不进 URL、不放分享卡
  onCopyResultCode(event) {
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const code = typeof dataset.code === 'string' ? dataset.code : '';
    if (!code) {
      return;
    }
    wx.setClipboardData({
      data: code,
      success: () => wx.showToast({ title: '已复制，请当面告知对方', icon: 'none' })
    });
  },

  onRevokeTap(event) {
    if (this.guardReadonly()) {
      return;
    }
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const groups = this.data.inviteGroups || [];
    const group = groups[Number(dataset.index)];
    if (!group) {
      return;
    }
    const built = teamModel.buildRevokePayload(group);
    if (!built.ok) {
      wx.showToast({ title: built.message, icon: 'none' });
      return;
    }
    wx.showModal(Object.assign({}, teamModel.revokeConfirmDialog(group), {
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        partnerApi
          .revokeSubInvite(built.data)
          .then((response) => {
            wx.showToast({ title: writeHint(teamModel.revokedTextOf(response)), icon: 'none' });
            return this.load();
          })
          .catch((err) => {
            wx.showToast({ title: teamModel.failureText(err), icon: 'none' });
          });
      }
    }));
  },

  onRemoveTap(event) {
    if (this.guardReadonly()) {
      return;
    }
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const members = this.data.members || [];
    const member = members[Number(dataset.index)];
    if (!member) {
      return;
    }
    const built = teamModel.buildRemovePayload(member);
    if (!built.ok) {
      wx.showToast({ title: built.message, icon: 'none' });
      return;
    }
    wx.showModal(Object.assign({}, teamModel.removeConfirmDialog(member), {
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        partnerApi
          .removeSubMember(built.data)
          .then(() => {
            wx.showToast({ title: writeHint('已移除队员'), icon: 'none' });
            return this.load();
          })
          .catch((err) => {
            wx.showToast({ title: teamModel.failureText(err), icon: 'none' });
          });
      }
    }));
  }
});
