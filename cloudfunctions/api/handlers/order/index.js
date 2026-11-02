// handlers/order/index.js · 订单域 action 注册表（23 个动作，键名逐字对齐 shared/actions.js）
'use strict';

module.exports = {
  actions: {
    'order.create': require('./create'),
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
    'order.imageUrl': require('./imageUrl'),
    // D58（批 26）：转派四写动作（acceptTransfer 是唯一订单归属改写点）
    'order.requestTransfer': require('./requestTransfer'),
    'order.acceptTransfer': require('./acceptTransfer'),
    'order.declineTransfer': require('./declineTransfer'),
    'order.cancelTransfer': require('./cancelTransfer')
  }
};
