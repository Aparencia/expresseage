// handlers/order/index.js · 订单域 action 注册表（19 个动作，键名逐字对齐 shared/actions.js）
'use strict';

module.exports = {
  actions: {
    'order.create': require('./create'),
    'order.createBatch': require('./createBatch'),
    'order.get': require('./get'),
    'order.listCustomer': require('./listCustomer'),
    'order.listPartner': require('./listPartner'),
    'order.accept': require('./accept'),
    'order.reject': require('./reject'),
    'order.markPicked': require('./markPicked'),
    'order.unmarkPicked': require('./unmarkPicked'),
    'order.markDelivered': require('./markDelivered'),
    'order.unmarkDelivered': require('./unmarkDelivered'),
    'order.reportException': require('./reportException'),
    'order.resolveException': require('./resolveException'),
    'order.cancel': require('./cancel'),
    'order.confirmDelivery': require('./confirmDelivery'),
    'order.correct': require('./correct'),
    'order.undo': require('./undo'),
    'order.deleteRecord': require('./deleteRecord'),
    'order.imageUrl': require('./imageUrl')
  }
};
