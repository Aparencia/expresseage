// pages/profile/parts/share-card.js · 分享卡片薄封装（兼容旧调用点/断言；判据单源在 utils/share/index.js）
// 口径：CONTRACT §8/§11、D36——分享卡片只带兼职编号（或回通用邀请卡），不带昵称/头像/宿舍/尾号/订单；
// 固定中性封面，禁止页面截图；切换会话一律回通用卡（不外发目标账号编号）。
'use strict';

const share = require('../../../utils/share/index');

module.exports = { buildShareMessage: share.buildAppMessage };
