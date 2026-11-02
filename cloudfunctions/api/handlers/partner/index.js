// handlers/partner/index.js · partner 域动作汇总（键 = shared/actions.js 的 client 动作名）
'use strict';

const activate = require('./activate');
const saveProfile = require('./saveProfile');
const saveServiceConfig = require('./saveServiceConfig');
const getPublic = require('./getPublic');
const listBindings = require('./listBindings');
const getCustomer = require('./getCustomer');
const stats = require('./stats');
const unbindCustomer = require('./unbindCustomer');
const saveCustomerNote = require('./saveCustomerNote');
const createSubInvites = require('./createSubInvites');
const revokeSubInvite = require('./revokeSubInvite');
const listSubMembers = require('./listSubMembers');
const removeSubMember = require('./removeSubMember');

module.exports = {
  actions: {
    'partner.activate': activate.handler,
    'partner.saveProfile': saveProfile.handler,
    'partner.saveServiceConfig': saveServiceConfig.handler,
    'partner.getPublic': getPublic.handler,
    'partner.listBindings': listBindings.handler,
    'partner.getCustomer': getCustomer.handler,
    'partner.stats': stats.handler,
    'partner.unbindCustomer': unbindCustomer.handler,
    'partner.saveCustomerNote': saveCustomerNote.handler,
    'partner.createSubInvites': createSubInvites.handler,
    'partner.revokeSubInvite': revokeSubInvite.handler,
    'partner.listSubMembers': listSubMembers.handler,
    'partner.removeSubMember': removeSubMember.handler
  }
};
