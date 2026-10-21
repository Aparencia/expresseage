// middleware/guard-bind.js · 绑定方向角色守卫（bind.create 仅顾客可调；在 validate 前先拒，避免通过报错差异探测）
// 口径：CONTRACT v0.9 §4.2 铁律、ENGINEERING §4.3「绑定方向角色守卫」。
const { COLLECTIONS } = require('../db/collections');
const { ROLES } = require('../shared/enums');
const { canInitiateBind } = require('../shared/role');
const errors = require('../lib/errors');

const BIND_CREATE = 'bind.create';

async function middleware(state) {
  if (state.action !== BIND_CREATE) {
    return state;
  }
  const ctx = state.ctx;
  const identity = ctx.identity;
  // 切换会话：业务角色来自票据（CUSTOMER 才允许；PARTNER 票据一律拒绝）
  if (identity.viewMode) {
    if (!canInitiateBind(identity.role)) {
      throw errors.forbidden('只有顾客可以发起绑定');
    }
    return state;
  }
  const user = state.meta.actorUser || {};
  const roles = Array.isArray(user.roles) ? user.roles : [];
  // 兼职身份（存在 partners 行）一律不能发起绑定，即使同一 openid 兼顾客身份
  if (roles.indexOf(ROLES.PARTNER) >= 0) {
    const partner = await ctx.dao.findOne(COLLECTIONS.PARTNERS, { where: { openid: ctx.openid } });
    if (partner) {
      throw errors.forbidden('兼职身份不能发起绑定');
    }
  }
  if (roles.indexOf(ROLES.CUSTOMER) < 0) {
    throw errors.forbidden('请先完成顾客资料后再绑定');
  }
  return state;
}

module.exports = {
  middleware,
  BIND_CREATE
};
