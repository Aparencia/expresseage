// handlers/admin/_test-accounts.js · 测试账号创建与列表共用件（不含删除/清空级联，后者见 _test-account-ops）
'use strict';

const { COLLECTIONS } = require('../../shared/collections');
const {
  enums,
  errors,
  sharedValidate,
  getCustomerByNo,
  getPartnerByNo,
  getPartnerByOpenid,
  MAX_UNIQUE_ATTEMPTS
} = require('./_common');
const idGenerator = require('../../lib/id-generator');
const dto = require('./_dto');

const TOTAL_TEST_ACCOUNT_LIMIT = 6;
const TEST_OPENID_PREFIX = 'TEST-';
const ZERO_STATS = { totalOrders: 0, activeOrders: 0, completedOrders: 0, cancelledOrders: 0, todayOrders: 0 };

function isCustomerIdentifier(value) {
  return sharedValidate.validateCustomerNo(value).ok;
}

function isPartnerIdentifier(value) {
  return sharedValidate.validatePartnerNo(value).ok;
}

function assertSelfCreated(scope, user) {
  if (!user || user.isTestAccount !== true || user.createdByDeveloperNo !== scope.developerNo) {
    throw errors.notFound('测试账号不存在');
  }
}

async function checkTextSecurity(ctx, text) {
  const cloud = ctx && ctx.cloud;
  const openapi = cloud && cloud.openapi;
  const security = openapi && openapi.security;
  if (!security || typeof security.msgSecCheck !== 'function') {
    return true;
  }
  try {
    const result = await security.msgSecCheck({ content: text });
    const suggest = result && result.result ? result.result.suggest : '';
    if (suggest === 'risky') {
      throw errors.validation('displayName', '昵称包含不允许的内容，请修改');
    }
    return true;
  } catch (error) {
    if (error && error.code === 'VALIDATION_FAILED') {
      throw error;
    }
    if (error && error.errCode === 87014) {
      throw errors.validation('displayName', '昵称包含不允许的内容，请修改');
    }
    console.warn('[admin] msgSecCheck 不可用，昵称内容安全待人工复核');
    return true;
  }
}

async function testAccountsOfDeveloper(scope) {
  const rows = await scope.dao.find(COLLECTIONS.USERS, {
    where: { isTestAccount: true },
    orderBy: [['createdAt', 'desc']],
    limit: 100
  });
  return rows.filter((row) => row.createdByDeveloperNo === scope.developerNo);
}

function rolesOf(user) {
  return Array.isArray(user && user.roles) ? user.roles : [];
}

async function profileOf(scope, user) {
  const roles = rolesOf(user);
  if (roles.indexOf(enums.ROLES.CUSTOMER) >= 0) {
    return scope.dao.get(COLLECTIONS.CUSTOMERS, user._id);
  }
  if (roles.indexOf(enums.ROLES.PARTNER) >= 0) {
    return getPartnerByOpenid(scope, user._id);
  }
  return null;
}

async function quotaOf(scope) {
  const rows = await testAccountsOfDeveloper(scope);
  const perRole = { CUSTOMER: 0, PARTNER: 0 };
  rows.forEach((row) => {
    rolesOf(row).forEach((role) => {
      if (perRole[role] !== undefined) {
        perRole[role] += 1;
      }
    });
  });
  const maxPerRole = Number(scope.config.testAccountMaxPerRole) || 3;
  return { total: rows.length, perRole: perRole, maxPerRole: maxPerRole };
}

function buildCustomerDoc(openid, customerNo, displayName, nowDate) {
  return {
    _id: openid,
    customerNo: customerNo,
    displayName: displayName,
    avatarFileId: '',
    zone: 'D',
    buildingNo: 1,
    room: '101',
    dormKey: 'D1-101',
    phoneTail: '',
    profileCompleted: true,
    createdAt: nowDate,
    updatedAt: nowDate,
    profileUpdatedAt: nowDate
  };
}

function buildPartnerDoc(openid, partnerNo, displayName, nowDate) {
  return {
    openid: openid,
    partnerNo: partnerNo,
    displayName: displayName,
    avatarFileId: '',
    status: enums.PARTNER_STATUS.ACTIVE,
    serviceConfig: {
      services: enums.SERVICE_CODES.map((code) => ({ code: code, enabled: true })),
      zones: ['D', 'X', 'N', 'B', 'C'],
      acceptingOrders: true
    },
    stats: Object.assign({}, ZERO_STATS),
    activatedAt: nowDate,
    createdAt: nowDate,
    updatedAt: nowDate
  };
}

async function createOnce(scope, role, displayName) {
  for (let attempt = 0; attempt < MAX_UNIQUE_ATTEMPTS; attempt += 1) {
    const openid = idGenerator.generateTestOpenid();
    try {
      const result = await scope.dao.transaction(async (trx) => {
        await trx.add(COLLECTIONS.USERS, {
          _id: openid,
          roles: [role],
          status: 'ACTIVE',
          isTestAccount: true,
          createdByDeveloperNo: scope.developerNo,
          testLastUsedAt: null,
          messageReadAt: 0,
          privacyConsent: null,
          deletionRequestedAt: 0,
          createdAt: scope.nowDate,
          updatedAt: scope.nowDate
        });
        const generator = role === enums.ROLES.CUSTOMER ? idGenerator.generateCustomerNo : idGenerator.generatePartnerNo;
        const collection = role === enums.ROLES.CUSTOMER ? COLLECTIONS.CUSTOMERS : COLLECTIONS.PARTNERS;
        const field = role === enums.ROLES.CUSTOMER ? 'customerNo' : 'partnerNo';
        const inserted = await idGenerator.insertUnique(trx, collection, {
          field: field,
          generate: generator,
          build(no) {
            return role === enums.ROLES.CUSTOMER
              ? buildCustomerDoc(openid, no, displayName, scope.nowDate)
              : buildPartnerDoc(openid, no, displayName, scope.nowDate);
          }
        });
        return { openid: openid, targetNo: inserted.value, role: role };
      });
      return result;
    } catch (error) {
      if (!scope.dao.isDuplicateError(error)) {
        throw error;
      }
    }
  }
  throw errors.dependencyFailed('测试账号创建失败，请稍后重试');
}

async function replayCreate(scope, replay) {
  if (!replay || !replay.detail || !replay.detail.targetNo) {
    return null;
  }
  const role = replay.detail.role;
  const profile = role === enums.ROLES.CUSTOMER
    ? await getCustomerByNo(scope, replay.detail.targetNo)
    : await getPartnerByNo(scope, replay.detail.targetNo);
  return {
    targetNo: replay.detail.targetNo,
    role: role,
    displayName: replay.detail.displayNameMasked || (profile ? dto.maskedName(profile.displayName) : ''),
    isTestAccount: true,
    duplicated: true
  };
}

module.exports = {
  TOTAL_TEST_ACCOUNT_LIMIT,
  TEST_OPENID_PREFIX,
  ZERO_STATS,
  isCustomerIdentifier,
  isPartnerIdentifier,
  assertSelfCreated,
  checkTextSecurity,
  testAccountsOfDeveloper,
  rolesOf,
  profileOf,
  quotaOf,
  createOnce,
  replayCreate
};
