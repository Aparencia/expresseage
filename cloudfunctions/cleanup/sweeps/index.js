// cloudfunctions/cleanup/sweeps/index.js · cleanup sweep 注册表（单触发器每 10 分钟按到期条件幂等执行全部）
// cloudfunctions/cleanup/index.js 读取 { SWEEPS: [{name, run(ctx)}] }；缺注册表时入口不崩、只跳过本轮。
'use strict';

const orders = require('./orders');
const storage = require('./storage');
const retention = require('./retention');
const accounts = require('./accounts');
const invitations = require('./invitations');
const viewSessions = require('./viewSessions');
const counters = require('./counters');
const recognitionFailures = require('./recognitionFailures');
const testData = require('./testData');
const stats = require('./stats');

const SWEEPS = [
  { name: 'orderTimeout', run: orders.runOrderTimeout },
  { name: 'autoComplete', run: orders.runAutoComplete },
  { name: 'files', run: storage.runFiles },
  { name: 'tickets', run: storage.runTickets },
  { name: 'retention', run: retention.runRetention },
  { name: 'accountDeletion', run: accounts.runAccountDeletion },
  { name: 'testAccountsDeletion', run: accounts.runTestAccountsDeletion },
  { name: 'invitationCodes', run: invitations.runInvitationCodes },
  { name: 'viewSessions', run: viewSessions.runViewSessions },
  { name: 'rateLimits', run: counters.runRateLimits },
  { name: 'recognitionFailures', run: recognitionFailures.runRecognitionFailures },
  { name: 'testData', run: testData.runTestData },
  { name: 'recomputeStats', run: stats.runRecomputeStats }
];

module.exports = {
  SWEEPS
};
