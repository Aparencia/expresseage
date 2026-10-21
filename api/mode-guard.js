// api/mode-guard.js · 切换会话写限制（本地二道闸；服务端 switch-session 才是安全边界）
const store = require('../store/index');
const ACTIONS = require('../shared/actions');

const TEST_BANNED_ACTIONS = [
  'partner.activate',
  'user.deleteAccount',
  'ai.parseParcel'
];

function isWriteAction(action) {
  const meta = ACTIONS.ACTION_MAP && ACTIONS.ACTION_MAP[action];
  return !!(meta && meta.write);
}

function isAdminAction(action) {
  return typeof action === 'string' && action.indexOf('admin.') === 0;
}

function isTestBanned(action) {
  return isAdminAction(action) || TEST_BANNED_ACTIONS.indexOf(action) >= 0;
}

function viewContextOf() {
  return store.getViewContext();
}

function isReadonly() {
  const view = viewContextOf();
  return !!(view && view.viewMode === 'READONLY');
}

function isTestWrite() {
  const view = viewContextOf();
  return !!(view && view.viewMode === 'TEST_WRITE');
}

function assertWritable(action) {
  const view = viewContextOf();
  if (!view) {
    return;
  }
  if (action === 'admin.viewAsEnd') {
    return;
  }
  if (view.viewMode === 'READONLY' && isWriteAction(action)) {
    const err = new Error('开发者只读视角不能操作');
    err.code = 'FORBIDDEN';
    throw err;
  }
  if (view.viewMode === 'TEST_WRITE' && isTestBanned(action)) {
    const err = new Error('测试账号会话不能执行该操作');
    err.code = 'FORBIDDEN';
    throw err;
  }
}

function canRenderWriteButton() {
  const view = viewContextOf();
  if (!view) {
    return true;
  }
  return view.viewMode === 'TEST_WRITE';
}

function sessionBanner() {
  const view = viewContextOf();
  if (!view) {
    return null;
  }
  return {
    mode: view.viewMode,
    role: view.role,
    targetNo: view.targetNo,
    targetDisplayName: view.targetDisplayName,
    targetIsTest: !!view.targetIsTest,
    expiresAt: view.expiresAt || 0,
    readonly: view.viewMode === 'READONLY'
  };
}

module.exports = {
  isWriteAction,
  isAdminAction,
  isTestBanned,
  isReadonly,
  isTestWrite,
  assertWritable,
  canRenderWriteButton,
  sessionBanner,
  TEST_BANNED_ACTIONS
};
