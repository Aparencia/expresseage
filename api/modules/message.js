// api/modules/message.js · message 域
const client = require('../client');

module.exports = {
  send(payload) {
    return client.call('message.send', payload || {});
  },
  list(payload) {
    return client.call('message.list', payload || {}, { retry: true });
  },
  markRead(payload) {
    return client.call('message.markRead', payload || {});
  }
};
