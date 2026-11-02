// handlers/partner/listSubMembers.js · partner.listSubMembers（D59 团队摘要/成员/待用子码/名额）
// 口径：CONTRACT §13 D59；草案 §2.4 可见性矩阵：主兼职看本队 members（partnerNo+displayName+status+
// teamJoinedAt，无头像/fileId）+ 自己发的 pendingInvites（只后 4 位码）+ quota{used,max}；
// 子队员只回自己的队伍摘要（parentPartnerNo+memberCount），不看全队成员/名额。
'use strict';

const identity = require('../user/_common');
const configCommon = require('../config/_common');
const team = require('./_team');

async function mainPartnerView(ctx, partner, nowMs, config) {
  const members = await team.listTeamMembers(ctx, partner._id);
  return {
    team: null,
    members: members.map(team.memberBriefOf),
    pendingInvites: await team.pendingInvitesOf(ctx, partner._id, nowMs),
    quota: { used: members.length, max: team.teamMaxMembersOf(config) }
  };
}

async function subMemberView(ctx, partner) {
  const summary = await team.teamSummaryOf(ctx, partner);
  return { team: summary.team, members: [], pendingInvites: [], quota: null };
}

async function handler(ctx, payload) {
  const { partner } = await identity.requireActivePartner(ctx);
  const nowMs = identity.nowMs(ctx);
  if (team.isSubMember(partner)) {
    return subMemberView(ctx, partner);
  }
  const config = await configCommon.loadRuntimeConfig(ctx);
  return mainPartnerView(ctx, partner, nowMs, config);
}

module.exports = { handler };
