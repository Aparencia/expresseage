// cloudfunctions/cleanup/entry-guard.js · cleanup 入口调用方来源校验（审查整改 M-14）
// 口径：cleanup 是内部定时任务（ENGINEERING §4.2 internal 动作；DATA_MODEL §10.2 单定时触发器），
//       不对客户端开放。平台事实：小程序端 wx.cloud.callFunction 必携带 OPENID；定时触发器与云控制台/
//       部署调用没有 OPENID。因此 fail-closed 规则 = OPENID 非空即判为非内部来源，直接拒绝且不执行任何
//       sweep、不写 CLEANUP 审计（防成本放大/审计灌水）；无 OPENID 且事件未声明其他类型时放行（触发器/
//       控制台/部署）。平台限制说明：本校验只能判别"是否有微信用户身份"；控制台/部署者天然无 OPENID，
//       属受信运维入口（控制台权限本身即运维边界），无法在函数内进一步区分二者。
'use strict';

const TIMER_TYPE = 'Timer';

function isInternalCaller(event, wxContext) {
  const context = wxContext || {};
  const openid = typeof context.OPENID === 'string' ? context.OPENID : '';
  if (openid !== '') {
    return false;
  }
  const payload = event && typeof event === 'object' ? event : {};
  const type = typeof payload.Type === 'string' ? payload.Type : '';
  return type === '' || type === TIMER_TYPE;
}

function forbiddenResult() {
  return {
    ok: false,
    code: 'FORBIDDEN',
    message: '清理任务不允许客户端调用',
    serverTime: Date.now(),
    requestId: '',
    durationMs: 0
  };
}

module.exports = {
  TIMER_TYPE,
  isInternalCaller,
  forbiddenResult
};
