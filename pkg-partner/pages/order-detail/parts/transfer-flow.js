// pkg-partner/pages/order-detail/parts/transfer-flow.js · 转派候选检索接线（D87-a/b，页面方法）
// 职责：把「搜索框输入 / 搜索 / 点卡片」接成 setData + api 请求；文案与投影在 transfer-candidates 纯件。
// 边界：页面方法（与 index.js 合并为 Page 配置）；不判订单状态、不判谁可接收（服务端唯一权威）、不直连 client。
'use strict';

const partnerApi = require('../../../../api/modules/partner');
const candidatesPart = require('./transfer-candidates');
const transferPart = require('./transfer');

module.exports = {
  onTransferKeywordInput(event) {
    const keyword = candidatesPart.keywordOf(event.detail && event.detail.value);
    this.setData({ transferKeyword: keyword, transferPickIndex: -1 });
  },
  // 检索：只发一次读请求（无游标、无自动翻页）；失败与空结果都给可执行的下一步
  onTransferSearch() {
    const keyword = candidatesPart.keywordOf(this.data.transferKeyword);
    if (!candidatesPart.searchableOf(keyword)) {
      this.setData({ transferEmpty: { visible: true, text: candidatesPart.COPY.keywordHint } });
      return Promise.resolve();
    }
    this.setData({ transferSearching: true, transferSearchFailed: false, transferPickIndex: -1 });
    return partnerApi.searchTransferTargets({ keyword: keyword })
      .then((data) => {
        // 迟到响应防串台：关键词已变（用户又改了输入）→ 丢弃本次结果
        if (String(this.data.transferKeyword || '') !== String(keyword)) return;
        const cards = candidatesPart.cardsOfSearch(data);
        this.setData({
          transferSearching: false,
          transferCards: cards,
          transferCardSource: 'search',
          transferEmpty: candidatesPart.emptyOf({ count: cards.length, keyword: keyword })
        });
      })
      .catch((err) => {
        if (String(this.data.transferKeyword || '') !== String(keyword)) return;
        this.setData({
          transferSearching: false,
          transferSearchFailed: true,
          transferCards: [],
          transferCardSource: 'search',
          transferEmpty: candidatesPart.emptyOf({ failed: true })
        });
        wx.showToast({ title: (err && err.message) || candidatesPart.COPY.searchFail, icon: 'none' });
      });
  },
  // D82/D87/D90：候选三段式先上屏（最近使用 ≤5 → 本队成员）；失败不阻断转派，仍有检索与手输兜底
  loadTransferCandidates() {
    const recentTask = partnerApi.recentTransferTargets().catch(() => null);
    const teamTask = partnerApi.listSubMembers({}).catch(() => null);
    return Promise.all([recentTask, teamTask]).then((results) => {
      // 迟到响应防串台：用户已发起搜索（有词或已切 search 源）→ 预置候选不再覆盖搜索结果
      if (this.data.transferCardSource === 'search' || String(this.data.transferKeyword || '') !== '') return;
      const cards = candidatesPart.mergeCards(
        candidatesPart.cardsOfRecent(results[0] && results[0].list),
        candidatesPart.cardsOfTeam(results[1] || {})
      );
      this.setData({
        transferCards: cards,
        transferCardSource: cards.length ? 'preset' : '',
        transferEmpty: candidatesPart.emptyOf({ count: cards.length })
      });
    });
  },
  // 手工输入编号（截断到输入上限；是否合法交给服务端）
  onTransferInput(event) {
    this.setData({
      transferInput: ((event.detail && event.detail.value) || '').slice(0, transferPart.INPUT_MAX),
      transferCodeTip: ''
    });
  },
  // 点卡片即回填编号（仍走「下一步」二次确认；服务端校验不变）
  onTransferPickCard(event) {
    const index = Number(event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.index);
    const card = (this.data.transferCards || [])[index];
    if (!card) {
      return;
    }
    this.setData({ transferPickIndex: index, transferInput: card.partnerNo, transferError: '', transferCodeTip: '' });
  },
  // ---------- D88 转派码：对方出示 6 位码 → 解析成编号 → 回填（转派动作本身零改动） ----------
  onTransferCodeInput(event) {
    this.setData({
      transferCodeInput: candidatesPart.codeOf(event.detail && event.detail.value),
      transferCodeTip: ''
    });
  },
  onTransferCodeFill() {
    const code = candidatesPart.codeOf(this.data.transferCodeInput);
    if (code.length !== 6) {
      this.setData({ transferCodeTip: '请输入对方给你的 6 位转派码' });
      return Promise.resolve();
    }
    this.setData({ transferCodeFilling: true, transferCodeTip: '' });
    return partnerApi.resolveTransferCode({ code: code })
      .then((data) => {
        const name = (data && data.displayName) ? data.displayName + ' · ' : '';
        this.setData({
          transferCodeFilling: false,
          transferInput: (data && data.partnerNo) || '',
          transferPickIndex: -1,
          transferError: '',
          transferCodeTip: '已填入 ' + name + candidatesPart.displayOf((data && data.partnerNo) || '')
        });
      })
      .catch((err) => {
        this.setData({
          transferCodeFilling: false,
          transferCodeTip: (err && err.message) || candidatesPart.COPY.codeFail
        });
      });
  }
};
