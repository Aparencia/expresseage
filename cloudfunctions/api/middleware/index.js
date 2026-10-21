// middleware/index.js · 中间件链装配（auth → switch-session → guard-bind → validate → ratelimit → idempotency → audit）
const auth = require('./auth');
const switchSession = require('./switch-session');
const guardBind = require('./guard-bind');
const validate = require('./validate');
const ratelimit = require('./ratelimit');
const idempotency = require('./idempotency');
const audit = require('./audit');

const CHAIN = Object.freeze([
  auth.middleware,
  switchSession.middleware,
  guardBind.middleware,
  validate.middleware,
  ratelimit.middleware,
  idempotency.middleware,
  audit.middleware
]);

module.exports = {
  CHAIN,
  auth,
  switchSession,
  guardBind,
  validate,
  ratelimit,
  idempotency,
  audit
};
