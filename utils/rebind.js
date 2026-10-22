// utils/rebind.js · 换绑一体化（D28）客户端纯件：一次确认内顺序 release→create + 单步恢复
// 口径：CONTRACT §13 D28、UX §6.1/§6.2/§12.6 AC-C-68。服务端接口/事务不变，只做客户端编排：
// 两步都成功才算换绑完成；任一步失败必须给单步恢复，且绝不产生「双重绑定」。
// 零 wx、零页面状态：release/create 由调用方注入（页面传 bindApi 包装），便于纯件单测。
'use strict';

const MODE = { CREATE: 'create', REBIND: 'rebind' };
const STEP = { RELEASE: 'release', CREATE: 'create' };
const STATUS = {
  REBOUND: 'REBOUND',
  BOUND: 'BOUND',
  RELEASE_FAILED: 'RELEASE_FAILED',
  CREATE_FAILED: 'CREATE_FAILED'
};
const RETRY = { NONE: 'none' };
// 顾客侧解绑原因只能是 CUSTOMER_INITIATED（handlers/bind/release 对 CUSTOMER 只接受该枚举）
const RELEASE_REASON = 'CUSTOMER_INITIATED';
const CONFIRM_CONTENT = '换绑后这位兼职看不到你的新订单，历史订单仍保留。确定换绑？';
const RETRY_CREATE_LABEL = '重新绑定';
const FALLBACK_REASON = '请稍后重试';

function objectOf(value) {
  return value && typeof value === 'object' ? value : {};
}

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function modeOf(options) {
  return textOf(objectOf(options).mode) === MODE.REBIND ? MODE.REBIND : MODE.CREATE;
}

/** 换绑页静态文案：一次确认语义（rebind）vs 普通绑定（create），页面零文案判据 */
function labelsOf(options) {
  const rebind = modeOf(options) === MODE.REBIND;
  return {
    confirm: rebind ? '确认换绑' : '确认绑定',
    submitting: rebind ? '换绑中…' : '绑定中…',
    previewTitle: rebind ? '确认换绑到这位兼职？' : '确认绑定这位兼职？',
    resultTitle: rebind ? '换绑成功' : '绑定成功'
  };
}

/** 编排计划：rebind 且当前有绑定才先 release；其余（普通绑定/换绑页无绑定）只 create */
function planRebind(input) {
  const options = objectOf(input);
  const steps = [];
  if (modeOf(options) === MODE.REBIND && options.hasCurrentBinding === true) {
    steps.push(STEP.RELEASE);
  }
  steps.push(STEP.CREATE);
  return { steps: steps };
}

// 原因取云端人话 message（13 码/校验文案已本地化）；句尾句号归一，避免「。。」
function reasonOf(error) {
  const raw = error && typeof error.message === 'string' ? error.message.trim() : '';
  const message = raw.replace(/。+$/, '');
  return message || FALLBACK_REASON;
}

function okResult(data, released) {
  const payload = objectOf(data);
  return {
    status: released ? STATUS.REBOUND : STATUS.BOUND,
    released: released,
    created: true,
    binding: objectOf(payload.binding),
    partnerPublic: payload.partnerPublic && typeof payload.partnerPublic === 'object' ? payload.partnerPublic : null
  };
}

async function runSteps(steps, ctx) {
  let released = ctx.released === true;
  if (steps.indexOf(STEP.RELEASE) >= 0) {
    try {
      await ctx.release({ reason: RELEASE_REASON });
      released = true;
    } catch (error) {
      // release 失败立刻终止：原绑定保持不变，零 create 调用
      return { status: STATUS.RELEASE_FAILED, released: false, created: false, error: error };
    }
  }
  try {
    return okResult(await ctx.create({ partnerNo: ctx.partnerNo }), released);
  } catch (error) {
    // release 已成功而 create 失败：保留 released:true，重试只补 create（绝不二次 release）
    return { status: STATUS.CREATE_FAILED, released: released, created: false, error: error };
  }
}

/**
 * 执行换绑/绑定编排。
 * @param {{mode?:string,hasCurrentBinding?:boolean,released?:boolean,partnerNo?:string,
 *   release?:Function,create?:Function}} deps
 *   released=true 表示旧绑定已在上一步解除（失败重试路径），本例只补 create。
 * @returns {Promise<{status:string,released:boolean,created:boolean,binding?:object,
 *   partnerPublic?:object|null,error?:Error}>}
 */
function runRebind(deps) {
  const options = objectOf(deps);
  const steps = options.released === true ? [STEP.CREATE] : planRebind(options).steps;
  return runSteps(steps, {
    released: options.released === true,
    release: options.release,
    create: options.create,
    partnerNo: textOf(options.partnerNo)
  });
}

/** 是否需要一次确认弹窗：只有会先解绑旧绑定的换绑才弹（普通绑定仍一键确认） */
function confirmNeeded(plan) {
  const steps = objectOf(plan).steps;
  return Array.isArray(steps) && steps.indexOf(STEP.RELEASE) >= 0;
}

/** 失败人话：release 失败=换绑未开始；release 成功 create 失败=已解除旧绑定但新绑定未完成 */
function recoveryCopy(result) {
  const target = objectOf(result);
  if (target.status === STATUS.RELEASE_FAILED) {
    return '换绑未开始：' + reasonOf(target.error) + '。';
  }
  if (target.status === STATUS.CREATE_FAILED) {
    if (target.released === true) {
      return '已解除旧绑定，但绑定新兼职未完成：' + reasonOf(target.error) + '。可以重试绑定，或稍后再试。';
    }
    // 普通绑定（无旧绑定可解）失败：不能说成「已解除旧绑定」
    return '绑定未完成：' + reasonOf(target.error) + '。可以重试绑定，或稍后再试。';
  }
  return '';
}

/** 重试动作：create 失败只补 create；release 失败重新走 release→create；成功无需重试 */
function retryAction(result) {
  const status = objectOf(result).status;
  if (status === STATUS.CREATE_FAILED) return STEP.CREATE;
  if (status === STATUS.RELEASE_FAILED) return STEP.RELEASE;
  return RETRY.NONE;
}

/** 重试入参：null=不重试；{released:true}=只补 create（release 调用总数不再增加） */
function retryDeps(result) {
  const action = retryAction(result);
  if (action === RETRY.NONE) return null;
  return { released: action === STEP.CREATE };
}

/** 失败呈现（页面直接 setData）：CREATE_FAILED 才给「重新绑定」单步重试按钮 */
function failureView(result) {
  const target = objectOf(result);
  const action = retryAction(target);
  const retryable = action === STEP.CREATE;
  const released = target.released === true;
  return {
    text: recoveryCopy(target),
    retryVisible: retryable,
    retryLabel: retryable ? RETRY_CREATE_LABEL : '',
    retryTitle: released ? '换绑未完成' : '绑定未完成',
    retryHint: released
      ? '旧绑定已解除，当前没有绑定；点下方按钮只补「绑定新兼职」这一步。'
      : '这次绑定没有成功；点下方按钮重试绑定这一步。'
  };
}

function confirmContent() {
  return CONFIRM_CONTENT;
}

function successCopy(displayName) {
  const name = textOf(displayName);
  return name ? '已换绑为「' + name + '」' : '已换绑';
}

/** 成功 toast：换绑（两步/补 create 均属换绑）用「已换绑为…」；普通绑定沿用「已绑定」 */
function successToast(result, displayName) {
  return objectOf(result).status === STATUS.REBOUND ? successCopy(displayName) : '已绑定';
}

/** 成功卡片文案（同寝室标识随后由 room-tag 渲染） */
function resultText(result, displayName) {
  const name = textOf(displayName);
  const who = name ? '「' + name + '」' : '新兼职';
  if (objectOf(result).status === STATUS.REBOUND) return '已换绑为' + who + '，同寝室标识已分配：';
  return '已绑定' + who + '，同寝室标识已分配：';
}

module.exports = {
  MODE,
  STEP,
  STATUS,
  modeOf,
  labelsOf,
  planRebind,
  confirmNeeded,
  runRebind,
  recoveryCopy,
  retryAction,
  retryDeps,
  failureView,
  confirmContent,
  successCopy,
  successToast,
  resultText
};
