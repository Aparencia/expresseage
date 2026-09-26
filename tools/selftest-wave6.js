// tools/selftest-wave6.js · §11 录入页零件（2026-09-25 从 `selftest-wave5.js` 整体搬出来）
//
// 为什么开第三个测试文件：wave5 撞了 AGENTS §11.1 的"测试文件 ≤1000 行"硬上限（范围扩展批加完断言后实测）。
// 与当初 §10/§11 从 `selftest.js` 搬进 wave5 是**同一条理由**（见 `selftest.js` 里那行注释）——
// 判定器 `eq`/`check` 仍由调用方注入 ⇒ **同一个计数器**，"断言 N 条"这个读数不会被切成两份。
// ⛔ 本文件只放测试；往 `tools/` 塞业务代码会绕过 check.js 的源码扫描豁免前提（R-21 同族）。
'use strict';

/**
 * §11 页面零件（`pages/recognize/form-parts.js`）
 *
 * 搬出来的唯一理由就是这个节能打到它们：R2-C05/R3-01 的共同教训是
 * "规则与调度住在页面里 = 删了也全绿"。预填纪律（只填空框）、多码计数、预选文案（M7/M11）、
 * M14 的高度算式，以前都只能在真机上靠人眼看。
 * @param {{eq:function, check:function, formParts:object}} kit
 */
function runFormPartsSection(kit) {
  const eq = kit.eq;
  const check = kit.check;
  const formParts = kit.formParts;
  console.log('§11 录入页零件（预填、预选与高度）');
  const EMPTY = { stationName: '', pickupCode: '', lockerNo: '' };

  // ── 预填纪律：只往空框里填 ────────────────────────────────
  const all = formParts.fillFromParse(EMPTY, { stationName: '南苑菜鸟驿站', pickupCode: '600000', lockerNo: '3号柜' });
  eq('预填①：三格全空 ⇒ 识别到的三项都填进去',
    [all.patch['draft.stationName'], all.patch['draft.pickupCode'], all.patch['draft.lockerNo'], all.filled].join('|'),
    '南苑菜鸟驿站|600000|3号柜|true');
  const keep = formParts.fillFromParse(
    { stationName: '西苑菜鸟驿站（西苑五食堂22栋）', pickupCode: '', lockerNo: '' },
    { stationName: '南苑菜鸟驿站', pickupCode: '600000' }
  );
  eq('预填②：人改过的格子**不许被覆盖**，其余照填（本页最贵的一类错）',
    (keep.patch['draft.stationName'] === undefined) + '|' + keep.patch['draft.pickupCode'] + '|' + keep.filled,
    'true|600000|true');
  const none = formParts.fillFromParse(
    { stationName: 'A', pickupCode: 'B', lockerNo: 'C' },
    { stationName: 'X', pickupCode: 'Y' }
  );
  eq('预填③：格子都满 ⇒ 一个 draft.* 都不写、filled=false（统计不说谎的前提）',
    Object.keys(none.patch).length + '|' + none.filled, '0|false');
  eq('预填④：识别没给某项 ⇒ 不写出 undefined 键（否则输入框显示 "undefined"）',
    Object.prototype.hasOwnProperty.call(
      formParts.fillFromParse(EMPTY, { pickupCode: '600000' }).patch, 'draft.lockerNo'), false);

  // ── ③ 站点命中内置库 ⇒ 回填规范名 + 标明命中（2026-09-25 用户裁决「回填规范名 + 命中才回填」）──
  // 为什么这几条要有：识别出的站点名原来是**原样**填进格子的，要等人失焦才收敛 ⇒ 屏上那一刻看不出
  // "到底命中了内置站点没有"，人会以为还得自己再选一次。
  const stationHit = formParts.fillFromParse(EMPTY, { stationName: '南苑菜鸟驿站' });
  eq('站点命中①：命中内置站点 ⇒ 站点格写**规范名**、并给出「已命中内置站点」',
    stationHit.patch['draft.stationName'] + '|' + stationHit.stationNotice,
    '南苑菜鸟驿站|已命中内置站点：南苑菜鸟驿站');
  const stationMiss = formParts.fillFromParse(EMPTY, { stationName: '3 号柜旁边' });
  // ⚠️ 这条**于 2026-09-25 被真机推翻并改写**：旧期望是"命不中 ⇒ 保留原识别文本"（`'3 号柜旁边|'`），
  // 而真机上解析器会把**整行含时间戳**当站点候选 ⇒ `15:14湖工大西苑一栋南面菜鸟驿站` 被写进站点格，
  // 既不在 6 个正式名里、banner 还说"已自动填好"（**错值比空更危险**：人会照着它跑错驿站，SCOPE W1）。
  // 用户 2026-09-25 口径：「回填的内置站点是按钮从取件点里选一个里面的站点名称」⇒ 命不中**留空**，
  // 原文由"展开识别原文 + 明说没认出来"兜住（不丢信息，只是不进站点格）。
  eq('站点命中②（真机推翻旧口径）：命不中 ⇒ 站点格**留空** + 标"没认出来"（⛔ 绝不写整行原文）',
    stationMiss.patch['draft.stationName'] + '|' + stationMiss.stationNotice + '|' + stationMiss.stationMissed,
    'undefined||true');
  eq('站点命中③：空识别 ⇒ 两个都空串（不吐 undefined）',
    formParts.stationPrefill('   ').stationName + '|' + formParts.stationPrefill(undefined).notice, '|');
  eq('站点命中④：人已经填了站点 ⇒ 归一化也不许改写他填的字（与预填纪律同源）',
    formParts.fillFromParse({ stationName: '自建点', pickupCode: '', lockerNo: '' },
      { stationName: '南苑菜鸟驿站' }).patch['draft.stationName'], undefined);

  // ── ② 内联新建客户（2026-09-25 用户裁决「录入页内联新建，不离开当前屏」）────────────
  const openCreate = formParts.createSheetPatch(true);
  const createKeys = Object.keys(openCreate).sort();
  eq('内联新建①：开浮层只写 create* 键（每个都以 create 开头；不含任何 draft.* / drafts ⇒ 已填内容丢不了）',
    createKeys.every((key) => key.indexOf('create') === 0) + '|'
      + createKeys.some((key) => key.indexOf('draft') === 0) + '|' + createKeys.join(','),
    'true|false|createError,createKeyActionText,createLine,createOpen');
  const madeLine = formParts.createCustomerDraft([], 'D4-522');
  eq('内联新建②：空称呼 ⇒ 走同一个值域闸并自动补名，且**未绑定会话**（不绕开键的一次性令牌纪律）',
    madeLine.ok + '|' + madeLine.input.building + '|' + madeLine.input.dorm + '|'
      + madeLine.input.name + '|' + madeLine.input.chatRoomId,
    'true|D4|522|D4 522 A|');
  eq('内联新建③：填了称呼 ⇒ 原样用它（闸的产出即落库值，页面不再加工）',
    formParts.createCustomerDraft([], 'D4-522 小王').input.name, '小王');
  const badLine = formParts.createCustomerDraft([], '看不太懂');
  eq('内联新建④：过不了闸 ⇒ ok:false + 非空文案（文案走 reasonText 单源，页面不自己写）',
    badLine.ok + '|' + (badLine.errorText.length > 0), 'false|true');
  eq('内联新建⑤：补名的序号跟着现有档案走（同楼栋同宿舍已有 2 位 ⇒ 下一位 C）',
    formParts.createCustomerDraft([
      { building: 'D4', dorm: '522', name: 'D4 522 A' },
      { building: 'D4', dorm: '522', name: 'D4 522 B' }
    ], 'D4-522').input.name, 'D4 522 C');

  // ── 一次输入完成两件事（2026-09-25 真机反馈批 2 · 用户构想原话：「只需要求输入类似 d3455 就能够
  //    完成建档与快递码录入」）────────────────────────────────────────────────────
  // 桩记录**真实调用**：断言"建档 + 落件 + 有键则绑"三件事都发生，而不是只看返回值长得对。
  // 为什么必须这样测：上一版只到"建档 + 选中"，人还得再点一次保存 —— 与用户构想差的那一步正是这里。
  const intake = require('../pages/recognize/intake-parts.js');
  const calls = { created: [], parcels: [], batches: [] };
  const stubStore = {
    listCustomers: () => ({ ok: true, customers: [] }),
    createCustomer: (input) => { calls.created.push(input); return { ok: true, customer: { id: 'new1' } }; },
    addParcel: (parcel) => { calls.parcels.push(parcel); return { ok: true, created: 1 }; },
    addParcels: (list) => { calls.batches.push(list); return { ok: true, created: list.length }; }
  };
  const oneShot = formParts.submitCreateCustomer('d4555', {
    storage: stubStore, sessionKey: '78de35a10e586ed5',
    draft: { stationName: '南苑菜鸟驿站', pickupCode: '8-2-3021', lockerNo: '', trackingTail: '' },
    recognitionUsed: false, drafts: []
  });
  eq('一次输入①：建档 + 落件**两件事都发生**，且这件挂在新档案名下（用户构想的那个 d4555 形态）',
    [oneShot.ok, oneShot.customerId, oneShot.savedKind, oneShot.savedCount,
      calls.parcels[0].customerId, calls.parcels[0].pickupCode].join('|'),
    'true|new1|single|1|new1|8-2-3021');
  eq('一次输入②：**有键就绑**（摘要在建档时一起落库），走同一处值域闸（d4555 ⇒ D4 + 555 + 自动补名）',
    [calls.created[0].chatRoomId, calls.created[0].building, calls.created[0].dorm, calls.created[0].name].join('|'),
    '78de35a10e586ed5|D4|555|D4 555 A');
  const noKeyNoFill = formParts.submitCreateCustomer('D4-555', {
    storage: stubStore, draft: { stationName: '', pickupCode: '', lockerNo: '', trackingTail: '' }, drafts: []
  });
  eq('一次输入③：**没有键也照样建档**（键可选、绝不阻塞 —— 平台拿不到键是常态），且这件还没填完 ⇒ 只建不存、不报错',
    [noKeyNoFill.ok, noKeyNoFill.savedKind, noKeyNoFill.errorText, calls.created[1].chatRoomId].join('|'),
    'true|none||');
  const parcelDrafts = require('../utils/parcel-drafts.js');
  const batch = parcelDrafts.buildDrafts([
    { pickupCode: '1-1-1', stationName: '南苑菜鸟驿站', segment: 'x' },
    { pickupCode: '2-2-2', stationName: '南苑菜鸟驿站', segment: 'y' }
  ], { customerId: '', source: 'ocr' });
  const multiShot = formParts.submitCreateCustomer('D4-555', { storage: stubStore, drafts: batch });
  eq('一次输入④：一图多码 ⇒ 一次整批写，且每一行都挂新档案（不是旧归属）',
    [multiShot.savedKind, multiShot.savedCount, (calls.batches[0] || []).map((row) => row.customerId).join(',')].join('|'),
    'multi|2|new1,new1');
  const okPatch = formParts.createSubmitPatch(oneShot, 'D4 555 A');
  eq('一次输入⑤：提交后的 data **不含任何 draft.*/drafts/lines** ⇒ 已填内容在结构上丢不了（与"开浮层"同一把闸）',
    [Object.keys(okPatch.patch).filter((key) => key.indexOf('draft') === 0 || key === 'drafts' || key === 'lines').length,
      okPatch.back, okPatch.toast.length > 0].join('|'),
    '0|true|true');
  const halfSaved = formParts.submitCreateCustomer('D4-555', {
    storage: Object.assign({}, stubStore, { addParcel: () => ({ ok: false, reason: 'VALIDATION_FAILED', detail: 'pickupCode' }) }),
    draft: { stationName: '南苑菜鸟驿站', pickupCode: '8-2-3021', lockerNo: '', trackingTail: '' },
    recognitionUsed: false, drafts: []
  });
  const halfPatch = formParts.createSubmitPatch(halfSaved, 'lbl');
  eq('一次输入⑥：件没存进去 ⇒ **档案仍在**（不回滚建档）、失败摊开说、且不退屏（人还能改那几格）',
    [halfSaved.ok, halfSaved.customerId !== '', halfSaved.savedKind,
      halfPatch.patch.errorText.indexOf('档案建好了') >= 0, halfPatch.back].join('|'),
    'true|true|none|true|false');
  eq('一次输入⑦：`intake-parts` 与 `form-parts` 是**同一个函数对象**（re-export，不是第二份实现）',
    [formParts.planSingleSave === intake.planSingleSave,
      formParts.createCustomerDraft === intake.createCustomerDraft,
      formParts.submitCreateCustomer === intake.submitCreateCustomer].join('|'),
    'true|true|true');

  // ── 保存决议（`saveSingle` 的三条拦空从页面搬进零件后才第一次有断言）────────────
  // 搬家的理由就是这几条：它们是本页"存不进去"的全部理由，住在页面里时删掉任何一条都全绿。
  const noStation = formParts.planSingleSave(
    { stationName: '', pickupCode: '8-2-3021', lockerNo: '', trackingTail: '' }, false);
  eq('保存决议①：站点空 ⇒ ok:false，文案指向「去哪取」',
    noStation.ok + '|' + (noStation.errorText.indexOf('去哪取') >= 0), 'false|true');
  const built = formParts.planSingleSave(
    { stationName: '3 号柜旁边', pickupCode: ' 8-2-3021 ', lockerNo: ' 3 ', trackingTail: '12345' }, true);
  eq('保存决议②：一条记录的全部字段（站点归一/码去空格/尾号/来源）在一条断言里钉住',
    [built.ok, built.parcel.stationName, built.parcel.pickupCode, built.parcel.lockerNo,
      built.parcel.trackingTail, built.parcel.source].join('|'),
    'true|3 号柜旁边|8-2-3021|3|12345|ocr');
  eq('保存决议③：只有尾号 ⇒ 记成「尾号90123」（与清单页「需查明」档同源）',
    formParts.planSingleSave(
      { stationName: '南苑菜鸟驿站', pickupCode: '', lockerNo: '', trackingTail: 'SF1234567890123' }, false)
      .parcel.pickupCode, '尾号90123');
  eq('保存决议④：尾号不是 5 位 ⇒ ok:false（不许把 3 位数字当尾号存进去）',
    formParts.planSingleSave(
      { stationName: '南苑菜鸟驿站', pickupCode: '', lockerNo: '', trackingTail: '123' }, false).ok, false);

  // ── 站点失焦归一（同一批从页面搬进零件的那段）──────────────────────────────
  eq('站点失焦①：命中 ⇒ 收敛到正式名 + 「已归到正式名」（键名也钉住：就这两条）',
    Object.keys(formParts.stationBlurPatch(' 南苑菜鸟驿站 ')).sort().join(',') + '|'
      + formParts.stationBlurPatch('南苑菜鸟驿站').stationNotice,
    'draft.stationName,stationNotice|已归到正式名：南苑菜鸟驿站');
  eq('站点失焦②：未命中 ⇒ 原样留着 + 说明它是新站点（不许猜一个内置名给它）',
    formParts.stationBlurPatch('3 号柜旁边')['draft.stationName'] + '|'
      + formParts.stationBlurPatch('3 号柜旁边').stationNotice,
    '3 号柜旁边|新站点：保存后会出现在清单的分组里');

  // ── 内联新建的**提交决议**（读库 → 过闸 → 落库；`storage` 注入 ⇒ 喂假库就能测）──────────
  // 为什么这三条必须有：把这段从页面搬进零件**就是为了可测**（页面层零断言 TD-016）——
  // 搬完却不测，等于只搬了个地方。它也是"建完要拿到 id 才能当场选中"这条链的唯一机器闸。
  const makeStubStore = (customers, created) => {
    const calls = { create: 0 };
    return {
      calls: calls,
      listCustomers: () => ({ ok: true, customers: customers }),
      createCustomer: (input) => { calls.create++; return created(input); }
    };
  };
  const storeOk = makeStubStore([], (input) => ({ ok: true, customer: { id: 'c-new', name: input.name } }));
  const submitted = formParts.submitCreateCustomer('D4-522', { storage: storeOk });
  eq('提交决议①：过闸 ⇒ 落库一次并带回 id（页面靠它"当场选中"）',
    submitted.ok + '|' + submitted.customerId + '|' + storeOk.calls.create, 'true|c-new|1');
  const storeBad = makeStubStore([], () => ({ ok: true, customer: { id: 'x' } }));
  const refused = formParts.submitCreateCustomer('看不太懂', { storage: storeBad });
  eq('提交决议②：过不了闸 ⇒ 不落库（一次都不许写）且文案非空',
    refused.ok + '|' + storeBad.calls.create + '|' + (refused.errorText.length > 0), 'false|0|true');
  const storeDead = {
    listCustomers: () => ({ ok: false, reason: 'STORE_VERSION_MISMATCH' }),
    createCustomer: () => ({ ok: true, customer: { id: 'y' } })
  };
  eq('提交决议③：读库失败 ⇒ 如实报错、不硬着头皮建（§11.4 禁静默吞错）',
    formParts.submitCreateCustomer('D4-522', { storage: storeDead }).ok, false);
  eq('提交决议④：落库失败 ⇒ 把 storage 的码翻成人话（走 failureText 单源）',
    (() => {
      const store = makeStubStore([], () => ({ ok: false, reason: 'QUOTA_EXCEEDED', detail: '' }));
      const out = formParts.submitCreateCustomer('D4-522', { storage: store });
      return out.ok + '|' + (out.errorText.length > 0);
    })(), 'false|true');

  // ── 一图多码（M8）：计数、点名、降级 ───────────────────────
  // ⚠️ 码要挑**不会被推成站点**的形态：`109-2-3009` 这类分段码会走 R14 命中站点 ⇒ 测不到东西
  const twoOk = formParts.buildMultiPatch([
    { pickupCode: '600000', stationName: '', segment: '南苑菜鸟驿站' },
    { pickupCode: '8-1-3021', stationName: '', segment: '' }
  ], 'c-live', false);
  eq('多码①：两件都判出点 ⇒ ready=2、不出现 ❓ 那句',
    twoOk.draftsReady + '|' + /❓/.test(twoOk.banner), '2|false');
  eq('多码②：归属用**当前选定客户**，不是识别时的旧值', twoOk.drafts[0].customerId, 'c-live');
  const oneMissing = formParts.buildMultiPatch([
    { pickupCode: '600000', stationName: '', segment: '' },
    { pickupCode: '8-1-3021', stationName: '', segment: '南苑菜鸟驿站' }
  ], 'c-live', false);
  eq('多码③：有一件没判出点 ⇒ banner 逐件点名（与行内 ⚠ 同一批行）',
    /有 1 件没判出去哪个点/.test(oneMissing.banner) + '|' + oneMissing.drafts[0].needStation, 'true|true');
  const noCode = formParts.buildMultiPatch(
    [{ pickupCode: '', stationName: '', segment: '南苑菜鸟驿站' }], 'c-live', true);
  eq('多码④：有行没码 ⇒ 自动展开原文（让人照着抄），并算进 noCode',
    noCode.draftsNoCode + '|' + noCode.showLines, '1|true');
  eq('多码⑤：partial 读数要写明"可能没读完"（不把降级说成完成）',
    /可能没读完/.test(formParts.buildMultiPatch(
      [{ pickupCode: '600000', segment: '南苑菜鸟驿站' }], 'c', true).banner), true);

  // ── 客户选项与站点归一 ────────────────────────────────────
  const opts = formParts.buildCustomerOptions([
    { id: 'k1', building: 'D4', dorm: '522', name: '小王' },
    { id: 'k2', building: 'X1', dorm: '101', name: '小李' }
  ]);
  eq('选项①：标签口径 = 楼栋 宿舍 称呼（与档案页同一拼法）',
    opts.labels.join(','), 'D4 522 小王,X1 101 小李');
  eq('选项②：options 只带 {id,label} ⇒ 拿它去做会话归类必然永不命中（钉住这个踩过的坑）',
    Object.keys(opts.options[0]).sort().join(','), 'id,label');

  // ── 标签单源：空称呼派生名不得重复前缀（2026-09-25 真机缺陷 `D4 555 D4 555 A`，BUG 修复断言）──
  const derivedLabel = formParts.customerLabel({ building: 'D4', dorm: '555', name: 'D4 555 A' });
  eq('标签④：空称呼派生名（`D4 555 A`）⇒ 标签不再重复前缀', derivedLabel, 'D4 555 A');
  eq('标签⑤：派生名标签里「楼栋 宿舍」只出现一次（结构性，防别的写法绕回）',
    derivedLabel.split('D4 555').length - 1, 1);
  eq('标签⑥：有人名的客户行为逐字不变', formParts.customerLabel({ building: 'D4', dorm: '522', name: '小王' }),
    'D4 522 小王');
  eq('标签⑦：同宿舍 A/B 两位派生名仍可区分（修法不许把可区分性弄丢）',
    formParts.buildCustomerOptions([
      { id: 'a', building: 'D4', dorm: '555', name: 'D4 555 A' },
      { id: 'b', building: 'D4', dorm: '555', name: 'D4 555 B' }
    ]).labels.join(','), 'D4 555 A,D4 555 B');
  eq('标签⑧：字段缺失 ⇒ 不吐 "undefined"（脏数据不许把 UI 弄成 undefined）',
    formParts.customerLabel({}).indexOf('undefined') === -1, true);

  // ── 标签单源升级（2026-09-25「同族 4 处收口」）：跨页只留一份实现 ──────────────
  // 为什么这几条要有：① 缺陷 `D4 555 D4 555 A` 的形态是"两条规则分别正确、合起来错"；
  // ② 档案页另有 4 处同款拼法（查重提示 / 重锚冲突 / 行内换绑 / 换绑目标），只修其中一处 = 换个地方继续重复。
  const aggregateMod = require('../utils/aggregate.js');
  const sheetFlowMod = require('../pages/archive-list/sheet-flow.js');
  const dupCustomer = { building: 'D4', dorm: '555', name: 'D4 555 A' };   // 空称呼 ⇒ nextCustomerName 自动补名
  eq('标签⑨：单源引用 —— form-parts 的 customerLabel 与 aggregate 的是同一个函数（re-export，不是副本）',
    formParts.customerLabel === aggregateMod.customerLabel, true);
  const dupDerived = sheetFlowMod.describeSessionKey('fp1234', dupCustomer);
  eq('标签⑩：查重提示（档案页同族 4 处之一）对无称呼客户不重复前缀', dupDerived.label, 'D4 555 A');
  eq('标签⑪：查重提示整段文案里不出现重复形态',
    dupDerived.sheetDupText.indexOf('D4 555 D4 555') === -1, true);
  const conflictDerived = sheetFlowMod.describeRebindNotice(
    { ok: false, reason: 'REBIND_CONFLICT', holder: dupCustomer }, { label: 'D4 555 A' }, 'fp9');
  eq('标签⑫：重锚冲突提示（同族另一处）不出现重复形态',
    conflictDerived.indexOf('D4 555 D4 555') === -1, true);
  eq('标签⑭：这两条路上"有人名"客户逐字不变（修口径不许把正常形态改了）',
    sheetFlowMod.describeSessionKey('fp1234', { building: 'D4', dorm: '522', name: '小王' }).label, 'D4 522 小王');
  // 同族第 5 处（回收站行）：**行为**断言。它是 `[building,dorm,name].join(' ')` 形状 —— 上一版的
  // 源码级扫描只认 `+` 拼接，抓不到它（2026-09-25 补：扫描要同时认两种形状，否则下一处照样溜过去）。
  const recycleMod = require('../pages/archive-list/recycle.js');
  const recycleRow = recycleMod.deletedRows(
    [{ id: 'r1', building: 'D4', dorm: '555', name: 'D4 555 A', deletedAt: 1 }], {})[0];
  eq('标签⑮：回收站行（同族第 5 处）对无称呼客户不重复前缀', recycleRow.label, 'D4 555 A');

  // 源码级单源：`pages/` 与 `utils/` 里除 aggregate 外不许再出现"把客户字段拼成标签"的任一形状
  //  形状一 = 前缀拼接：`building + ' ' + x.dorm`
  //  形状二 = 数组 join：`[x.building, x.dorm, x.name].…join(' ')`（回收站那处的原始形态）
  const labelOffenders = [];
  const LABEL_SHAPES = [
    { name: '前缀拼接', re: /building\s*\+\s*' '\s*\+\s*\w+\.dorm/ },
    { name: '数组 join', re: /\[\s*\w+\.building\s*,\s*\w+\.dorm\s*,/ }
  ];
  // ⚠️ 只扫**代码行**：把纯注释行去掉。否则"在注释里引用旧写法解释 Why"会被判成违规
  //    （2026-09-25 实测：recycle.js 的 ⛔ 注释引用旧 `[…].join(' ')` ⇒ 本条假红一次）。
  //    局限：行尾 `// 注释` 不清（真写在那里的同形字面量仍会误报 ⇒ 换个写法即可）。
  const codeOnly = (src) => src.split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
  const walkLabelSrc = (dir) => {
    for (const entry of require('fs').readdirSync(dir, { withFileTypes: true })) {
      const full = require('path').join(dir, entry.name);
      if (entry.isDirectory()) { walkLabelSrc(full); continue; }
      if (!entry.name.endsWith('.js')) continue;
      const rel = require('path').relative(require('path').join(__dirname, '..'), full)
        .split(require('path').sep).join('/');
      if (rel === 'utils/aggregate.js') continue;   // 单源本身
      const src = codeOnly(require('fs').readFileSync(full, 'utf8'));
      const hit = LABEL_SHAPES.filter((shape) => shape.re.test(src))[0];
      if (hit) labelOffenders.push(rel + '(' + hit.name + ')');
    }
  };
  walkLabelSrc(require('path').join(__dirname, '..', 'pages'));
  walkLabelSrc(require('path').join(__dirname, '..', 'utils'));
  eq('标签⑬：单源源码级 —— pages/ 与 utils/ 下只有 utils/aggregate.js 出现这两种标签拼法之一（并报出形状名）',
    labelOffenders.join(','), '');

  const blankDraft = { stationName: '', pickupCode: '', lockerNo: '', trackingTail: '' };
  eq('内容判定①：空表单 ⇒ false（换图不该多问一次）',
    formParts.hasFormContent([], blankDraft), false);
  eq('内容判定②：只有一串空格不算内容（trim 之后才判）',
    formParts.hasFormContent([], Object.assign({}, blankDraft, { pickupCode: '   ' })), false);
  eq('内容判定③：有多码行 ⇒ true（不看单条那四格）',
    formParts.hasFormContent([{ key: 'd0' }], blankDraft), true);
  eq('站点归一①：命中官方名 ⇒ 收敛到正式名',
    formParts.normalizeStation('  南苑菜鸟驿站  '), '南苑菜鸟驿站');
  eq('站点归一②：没命中 ⇒ 原样交回（允许自建点，不许吞掉人写的字）',
    formParts.normalizeStation('3 号柜旁边'), '3 号柜旁边');

  // ── 预选说明行（M7 文案 + M11 卫生）───────────────────────
  const options = [{ id: 'k1', label: 'D4 522 小王' }];
  eq('标签①：id 为空 ⇒ 空串（不是 "undefined"）', formParts.labelOf(options, ''), '');
  eq('标签②：id 不在列表 ⇒ 空串（页面据此判 notFound，而不是显示空标题）',
    formParts.labelOf(options, 'gone'), '');
  eq('标签③：命中 ⇒ 拿显示标签', formParts.labelOf(options, 'k1'), 'D4 522 小王');
  const RID = 'zzA1b2C3d4E5f6';
  eq('预选①：不是从聊天进来（无 id）⇒ 这行话**不出现**', formParts.preselectNote('', '', ''), '');
  const hitNote = formParts.preselectNote(RID, 'k1', 'D4 522 小王');
  check('预选②：命中 ⇒ 写出标签，并明说系统**不会**替你选（2026-09-25 真机反馈后不再自动选中）',
    hitNote.indexOf('D4 522 小王') >= 0 && hitNote.indexOf('系统不会替你选') >= 0, hitNote);
  check('预选③（M11 卫生）：说明行里**不出现会话标识原值**', hitNote.indexOf(RID) < 0, hitNote);
  check('预选④：命中但列表里找不到它 ⇒ 说"请重选"，不静默',
    formParts.preselectNote(RID, 'k1', '').indexOf('请重选') >= 0, null);
  check('预选⑤：零命中/多命中 ⇒ 明说"系统不猜，请手选客户"',
    formParts.preselectNote(RID, '', '').indexOf('不猜') >= 0, null);

  // ── A 条（2026-09-25 真机反馈 P1）：会话键**不得再自动绑定客户** ──────────────
  // 真机症状：从取件清单进录件、手选另一位客户，却被"锁回前一个"，屏上还写着「这条会话只对上这个档案」。
  // 判据住在 `form-parts.resolveTarget`（页面层零断言 TD-016 ⇒ 不搬进零件就没人看着）。
  eq('A①：清单入口（无 customerId）⇒ 「给谁录」留空（会话命中不参与落值）',
    formParts.resolveTarget({ from: 'list' }, 'k1').targetId, '');
  eq('A②：档案入口带 customerId ⇒ 用它（这条才是允许的"默认绑定"）',
    formParts.resolveTarget({ customerId: 'k9' }, 'k1').targetId, 'k9');
  eq('A③：连"什么参数都没有"的入口也不许拿会话命中兜底',
    formParts.resolveTarget({}, 'k1').targetId, '');
  eq('A④：boundBySession 恒 false（谁把会话绑定加回来，这条先红）',
    String(formParts.resolveTarget({ from: 'list' }, 'k1').boundBySession), 'false');
  eq('A⑤：来源标记：只有 from=list 才算清单入口',
    formParts.sourceOf({ from: 'list' }) + '/' + formParts.sourceOf({}), 'list/customer');
  eq('A⑥：清单入口不显示会话说明行（那句多余的"只对上"）',
    formParts.preselectNote(RID, 'k1', 'D4 522 小王', 'chatKey', 'list'), '');

  // ── B 条（2026-09-25 真机反馈）：**没有档案也要能进录入页** ──────────────────
  // 真机症状：「没有用户档案时仍然无法进行录入操作」—— 清单页就地拦住，人根本到不了录入页的内联新建。
  const listParts = require('../pages/pickup-list/list-parts.js');
  eq('B①：一个档案都没有 ⇒ 照样给 URL（旧行为是就地拦住）',
    JSON.stringify(listParts.intakeTarget({ hasCustomers: false })),
    JSON.stringify({ ok: true, url: '/pages/recognize/index?from=list', errorText: '' }));
  eq('B②：入口 URL 带来源标记、且**不带 customerId**（清单入口不默认绑定）',
    listParts.intakeUrl().indexOf('from=list') >= 0 && listParts.intakeUrl().indexOf('customerId') < 0, true);
  eq('B③：有档案 ⇒ 一样进', listParts.intakeTarget({ hasCustomers: true }).ok, true);
  eq('B④：读库失败（null）⇒ 不导航，且文案说"读不出来"而不是"还没有"',
    listParts.intakeTarget({ hasCustomers: null }).ok === false
      && listParts.intakeTarget({ hasCustomers: null }).errorText.indexOf('读不出来') >= 0, true);

  // ── C 条（2026-09-25 真机反馈「站点回填失效」）：站点回填的**第二道** ──────────
  // 解析器的线索词表长在转录样本上（教训卡《样本是转录的 ≠ 真机输出》）；真机文本常见形态是
  // "整行**包含**一个正式名" ⇒ 第二道只认正式名，⛔ 命不中绝不把整行原文写进站点格。
  const stationPoints = require('../utils/stations.js').listStationPoints();
  const cHit = formParts.stationPrefillFromTexts([stationPoints[0] + '8号柜 取件码 8-2-3021']);
  eq('C①：原文"包含"唯一正式名 ⇒ 回填**规范名**', cHit.stationName, stationPoints[0]);
  eq('C②：命中要带标注', cHit.notice.indexOf('已命中内置站点') >= 0, true);
  eq('C③：认不出 ⇒ 空串（⛔ 绝不把整行原文写进站点格）',
    JSON.stringify(formParts.stationPrefillFromTexts(['随便一行 没有站名 8-2-3021'])),
    JSON.stringify({ stationName: '', notice: '' }));
  eq('C④：同时含两个正式名（多义）⇒ 不猜', 
    formParts.stationPrefillFromTexts([stationPoints[0] + ' 与 ' + stationPoints[1]]).stationName, '');
  eq('C⑤：认了码却没认站点 ⇒ 必须标出来（静默留空会被读成"回填坏了"）',
    formParts.fillFromParse({ stationName: '', pickupCode: '' }, { pickupCode: '8-2-3021' }, ['随便一行']).stationMissed, true);
  eq('C⑥：解析器给了站点 ⇒ 第一道优先（第二道不参与）',
    formParts.fillFromParse({ stationName: '', pickupCode: '', lockerNo: '' },
      { stationName: stationPoints[0], pickupCode: '' }, []).patch['draft.stationName'], stationPoints[0]);
  eq('C⑦：站点格已经有值 ⇒ 一律不覆盖（"只往空框里填"的老纪律不许被第二道破坏）',
    JSON.stringify(formParts.fillFromParse({ stationName: '人手填的' }, { pickupCode: '1-1-1' }, [stationPoints[0]]).patch),
    JSON.stringify({ 'draft.pickupCode': '1-1-1' }));

  // ── C 条追加（2026-09-25 **第二次**真机反馈，用户口径：「回填的内置站点是按钮从取件点里选一个里面的站点名称」）──
  // 样本**照录真机**（⛔ 不许换成理想转录样本 —— 教训卡《样本是转录的 ≠ 真机输出》）：
  // 解析器把整行含时间戳当站点候选 ⇒ `15:14湖工大西苑一栋南面菜鸟驿站`（不在 6 个正式名里）。
  const DIRTY_STATION_LINE = '15:14湖工大西苑一栋南面菜鸟驿站';
  const dirtyFill = formParts.fillFromParse({ stationName: '', pickupCode: '', lockerNo: '' },
    { stationName: DIRTY_STATION_LINE, pickupCode: '116-4-4053' }, [DIRTY_STATION_LINE]);
  // ⚠️ 2026-09-25 **口径变更**（用户澄清 + 别名表落地，处置 TD-025）：这行以前"永远命不中"（该站点
  // 不在 6 个正式名里）⇒ 旧期望着是"不写 + 标没认出来"。现在它经**别名表**命中 P3 正式名 ⇒
  // 期望改为"只许写正式名、⛔不许写原文、命中时也不许谎报没认出来"。
  // **不变的那条意图**（本条的牙）：带时间戳的整行原文**永不入格**。
  eq('C⑧：真机脏行 ⇒ 站点格只许写**正式名**（⛔ 绝不出现时间戳/整行原文），且不得谎报"没认出来"',
    dirtyFill.patch['draft.stationName'] + '|' + (dirtyFill.stationMissed === true) + '|'
      + (dirtyFill.patch['draft.stationName'] === DIRTY_STATION_LINE),
    '西苑一栋南面快递中心|false|false');
  eq('C⑨：站点格的值必须 ∈ 取件点列表，而**原文**（脏行）永远不在列表里 ⇒ 不许入格',
    stationPoints.indexOf(dirtyFill.patch['draft.stationName']) >= 0
      && stationPoints.indexOf(DIRTY_STATION_LINE) < 0, true);
  eq('C⑩：第一道没命中 ⇒ **必须继续走第二道**（原文里含唯一正式名时要回填它）',
    formParts.fillFromParse({ stationName: '', pickupCode: '', lockerNo: '' },
      { stationName: DIRTY_STATION_LINE, pickupCode: '' },
      [DIRTY_STATION_LINE, '西苑一栋南面快递中心8号柜']).patch['draft.stationName'], '西苑一栋南面快递中心');
  eq('C⑪：`stationPrefill` 经**别名**命中 ⇒ 正式名 + 标注（⛔ 仍不许返回原文 —— 旧写法返回原文才是真机脏值的入口）',
    JSON.stringify(formParts.stationPrefill(DIRTY_STATION_LINE)),
    JSON.stringify({ stationName: '西苑一栋南面快递中心', notice: '已命中内置站点：西苑一栋南面快递中心' }));
  eq('C⑫：手输那条路不受影响 —— 人自己打的字仍允许自建（2026-09-21 裁决，⛔ 别被本批误伤）',
    formParts.stationBlurPatch('妈妈驿站代收点')['draft.stationName'], '妈妈驿站代收点');

  // ── C 条第三次修复（2026-09-25 真机：「站点提示自相矛盾」）────────────────
  // 真机形态：站点格**填好了正式名**，banner 却同时说「站点没认出来」。
  // 复现（Lead 探针）**推翻了**"第二道命中后没清 stationMissed"这条嫌疑：单次调用本来就是 false。
  // 真因 = **单源被破坏**：那句原被拼进 `banner`，而站点格另有三个写者（失焦归一 / 从取件点选 / 手打）
  // ⇒ 格子被后来者填上后，banner 里那句**过期的话**留在屏上。修法 = 拆出 `stationHint` + wxml 守卫。
  const missFirstHitSecond = formParts.fillFromParse({ stationName: '', pickupCode: '', lockerNo: '' },
    { stationName: '15:14某某代收点', pickupCode: '666039', lockerNo: '8号柜' },
    ['15:14某某代收点 8号柜', '西苑一栋南面快递中心8号柜']);
  eq('C⑬：第一道未中、第二道命中 ⇒ `stationMissed` 必须是 **false**（由最终态推出；旧写法在 else 分支里置 true）',
    missFirstHitSecond.patch['draft.stationName'] + '|' + (missFirstHitSecond.stationMissed === true),
    '西苑一栋南面快递中心|false');
  const missBoth = formParts.fillFromParse({ stationName: '', pickupCode: '', lockerNo: '' },
    { stationName: '15:14某某代收点', pickupCode: '666039' }, ['15:14某某代收点 8号柜']);
  eq('C⑭：两道都没中 ⇒ 站点格留空 **且** `stationMissed` 为 true（该说就得说）',
    missBoth.patch['draft.stationName'] + '|' + missBoth.stationMissed, 'undefined|true');
  eq('C⑮：那句的**唯一出处**（`stationMissedHint`）两分支：该说 ⇒ 含「没认出来」；不该说 ⇒ 空串',
    formParts.stationMissedHint(true).indexOf('没认出来') >= 0 ? 'said|' + formParts.stationMissedHint(false) : 'silent|',
    'said|');
  const shownHint = (hint, cell) => ((hint && !cell) ? hint : '');
  eq('C⑯：**同屏不许矛盾** —— 站点格有值 ⇒ 那句不上屏；格子为空 ⇒ 必须上屏（等价 wxml 守卫）',
    (shownHint(formParts.stationMissedHint(true), '西苑一栋南面快递中心') === '') + '|'
      + (shownHint(formParts.stationMissedHint(true), '') !== ''),
    'true|true');
  const wxmlSrc = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'pages', 'recognize', 'index.wxml'), 'utf8');
  const pageSrc = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'pages', 'recognize', 'index.js'), 'utf8');
  eq('C⑰：wxml 必须带 `!draft.stationName` 守卫（防"填好了还说过期的话"回潮，源码级）',
    wxmlSrc.indexOf('stationHint && !draft.stationName') >= 0, true);
  eq('C⑱：那句的**字面量只许住在 form-parts** —— 页面里再出现一次 = 有人把它拼回 banner（源码级单源）',
    pageSrc.indexOf('站点没认出来') < 0, true);

  // ── M14 高度算式与调度（R3-01 那条 P1 的回归钉）───────────
  // 旧 bug 的形态：`if (wx.nextTick) { wx.nextTick(() => this.measureMid()); return; }` ——
  // 回调里那个条件依然成立 ⇒ 无限自调度，测量那行永远到不了；而 check.js 只做语法、
  // selftest 不 require 页面 ⇒ 两道门禁全看不见。下面 6 条把两条不变量钉成可断言的东西。
  eq('算式①：正常值 = 窗口高 - 上区 - 操作栏', formParts.computeMidHeight(800, 300, 120).px, 380);
  eq('算式②：上区占满 ⇒ ok:false 并给原因（此时宁可不写，让 CSS 兜底）',
    formParts.computeMidHeight(800, 700, 120).ok, false);
  eq('算式③：窗口高读不到 ⇒ ok:false（不猜一个数写上去）', formParts.computeMidHeight(0, 100, 100).ok, false);
  eq('算式④：盒子没渲染（undefined/null）按 0 算，不报错',
    formParts.computeMidHeight(600, undefined, null).px, 600);

  const hops = [];
  const queryStub = {
    select: () => queryStub,
    boundingClientRect: () => queryStub,
    exec: (cb) => cb([{ height: 300 }, { height: 100 }])
  };
  const written = [];
  let closed = false;
  const meter = formParts.createLayoutMeter({
    wxApi: { getWindowInfo: () => ({ windowHeight: 800 }) },
    nextTick: (fn) => { hops.push(fn); },
    queryFactory: () => queryStub,
    write: (px) => { written.push(px); },
    unloaded: () => closed
  });
  meter.measure();
  meter.measure();
  meter.measure();                       // 连点三次（真人的手抖就会这样）
  eq('调度①（R3-01 的牙）：三次 measure 只排一次 hop ⇒ 不存在自循环', hops.length, 1);
  hops[0]();
  eq('调度②：hop 执行后才写真值，且算的是 800-300-100', written.join(','), '400px');
  eq('调度③：回调跑完闸门必须释放（否则第二次改布局就永远量不到）', meter.pendingCount(), 0);
  meter.measure();
  eq('调度④：闸门释放后允许再排一次', hops.length, 2);
  eq('调度⑤：页面已销毁 ⇒ 不写（不给销毁页 setData）', (() => {
    closed = true;
    written.length = 0;
    hops[1]();                 // 这一次才是第二次排的那个回调
    return written.length;
  })(), 0);
  eq('调度⑥：选择器返回非数组（读不到）⇒ 不写也不抛', (() => {
    let got = null;
    const dead = formParts.createLayoutMeter({
      wxApi: { getWindowInfo: () => ({ windowHeight: 800 }) },
      queryFactory: () => ({
        select: () => ({ boundingClientRect: () => {} }),
        exec: (cb) => cb(null)
      }),
      write: (px) => { got = px; }
    });
    dead.measure();                       // nextTick 缺省 = 同步执行
    return String(got);
  })(), 'null');
}

/**
 * §12 站点清单与别名（`utils/stations.js`）—— 2026-09-25 用户澄清后新增（处置 TD-025）
 *
 * 为什么单开一节：这张表**此前一条断言都没有**（全仓只有两处注释提到 `STATION_POINTS`），
 * 而它决定"去哪取"——并错 = 跑错驿站 = 本项目最贵的一类错（SCOPE W1）。
 * 语料**照录真机**（`15:14湖工大西苑一栋南面菜鸟驿站`，含时间戳噪声），
 * ⛔ 不许换成理想转录样本（教训卡《2026-09-17_样本是转录的不等于真机输出》）。
 * @param {{eq:function, check:function}} kit
 */
function runStationListSection(kit) {
  const eq = kit.eq;
  const check = kit.check;
  const stations = require('../utils/stations.js');
  console.log('§12 站点清单与别名（正式名 / 别名 / 规则顺序）');

  const points = stations.listStationPoints();
  const P3 = '西苑一栋南面快递中心';
  const DIRTY = '15:14湖工大西苑一栋南面菜鸟驿站';   // 真机原文（时间戳是卡片上的"待取件 今天 15:14"）
  const REAL = '湖工大西苑一栋南面菜鸟驿站';

  // ① 别名：真机原文与显而易见变体 ⇒ 一律收敛到那个**取件点正式名**
  const aliasHit = stations.matchBuiltinStation(DIRTY);
  eq('别名①：真机原文（带 `15:14` 噪声）⇒ 命中 P3 正式名 + kind=alias',
    aliasHit.ok + '|' + aliasHit.stationName + '|' + aliasHit.kind, 'true|' + P3 + '|alias');
  eq('别名②：去前缀 / `一栋`→`1栋` / OCR 空格 三种写法 ⇒ 同一正式名',
    [stations.matchBuiltinStation('西苑一栋南面菜鸟驿站').stationName,
      stations.matchBuiltinStation('湖工大西苑1栋南面菜鸟驿站').stationName,
      stations.matchBuiltinStation('湖工大 西苑 一栋南面 菜鸟驿站').stationName].join('|'),
    [P3, P3, P3].join('|'));

  // ② 别名**只给识别/手输归一化用**：⛔ 不许进"给人选"的清单（混进来 = 同一个点在选择器里出现两次）
  // ⚠️ 2026-09-26 扩到 8 点（用户指令新增 P8 `东苑一栋邮政`）：本节的"清单长度"与"末位"两条随之更新，
  //    并已在 `docs/STATION_MAP.md` §1/§2/§7 同步（先改本文再改代码）。
  eq('别名③：别名不进 `listStationPoints()`（长度 = 7 个旧点 + 1 个新邮政点）', points.length, 8);
  check('别名④：清单里没有任何别名串（只出正式名）',
    points.every((name) => name.indexOf('一栋南面菜鸟驿站') < 0), points.join('，'));

  // ③ 邮政点（P7/P8）的断言**整体搬去 `tools/selftest-wave7.js §19`**（2026-09-26）：
  // 本文件已被顶到 1006 行（>1000 硬上限，`gate.ps1 ④` 当场判红），而 wave7 §19 本来就是"站点别名/P8/改名"
  // 那一簇的家 ⇒ 邮政①~⑤ 连同 `POST`/`POST_EAST` 两个常量一起搬，**断言条数不变**（只换文件，不删判据）。
  // ⛔ 别在本节再把它们写回来。`POST` 唯一事实源仍是 `STATION_POINTS.P7`（wave7 §19 里同样只引用变量）。

  // ④ 反例：别名表⛔不许误伤别的菜鸟点 —— 那是"跑错驿站"的直接入口
  eq('反例①：西苑五食堂22栋菜鸟 ⇒ 仍是它自己（不被别名拉到一栋南面）',
    stations.matchBuiltinStation('西苑菜鸟驿站（西苑五食堂22栋）').stationName, '西苑菜鸟驿站（西苑五食堂22栋）');
  eq('反例②：北部菜鸟 ⇒ 仍是它自己',
    stations.matchBuiltinStation('北部菜鸟驿站（北苑一食堂三楼）').stationName, '北部菜鸟驿站（北苑一食堂三楼）');
  eq('反例③：别名 + 另一个正式名（一屏拼接）⇒ ambiguous，**不猜**',
    stations.matchBuiltinStation(REAL + ' 南苑菜鸟驿站').kind, 'ambiguous');
  eq('反例④：用户自建的站点名照旧不被吞（2026-09-21 裁决，⛔ 别被别名表误伤）',
    stations.matchBuiltinStation('东苑快递超市').ok, false);

  // ⑤ A 段规则表**逐条**（TD-026：此前 `R1/R3/R5~R12` 零断言 —— 全仓只有一处注释提到过 R1）
  // 每例钉**规则号 + 目标点**两件：屏上"依据"列是人核对的锚 ⇒ 依据错了人会以为规则对（§2 里 R5/R7 顺序存在的理由）。
  // 语料纪律：只用 `STATION_MAP §2/§3` 记过的形态与真机原文，⛔ 不凭空造（教训卡《2026-09-17_没有样本就不扩规则》）。
  // ⚠️ 本表同时是"删一条规则会红"的防线：每条规则各有 ≥1 例，规则被摘掉后该例会落到别的规则或 R15 ⇒ 判红。
  const RULE_CASES = [
    // [规则号, 识别原文, 取件码, 期望目标点（'' = 留空不猜）]
    ['R1', '西苑京东快递 取件码 1-2-3', '', '西苑京东快递（西苑五食堂）'],
    ['R1', '顺丰 京东 都在', '', '西苑京东快递（西苑五食堂）'],        // R1 排在 R2 之前（表序 = 优先级）
    ['R2', '西苑顺丰快递（西苑五食堂）', '', '西苑顺丰快递（西苑五食堂）'],
    ['R3', '妈妈驿站代收点', '', P3],
    ['R3', '妈妈驿站 22栋通道', '', P3],                                // R3 排在 R7 之前
    ['R4', '西苑一栋南面快递中心8号柜', '', P3],
    ['R5', '五食堂21栋楼下', '', P3],
    ['R5', '五食堂21栋楼下 菜鸟', '', P3],                              // 样本 S1 的真冲突：R5 必须在 R8 之前
    ['R6', '西苑快递中心', '', P3],
    ['R6', '北部菜鸟驿站 快递中心', '', P3],                            // §5-⚠️-1 的已知代价（待真机反例，非 bug）
    ['R7', '五食堂22栋通道菜鸟驿站', '23-5-3009', '西苑菜鸟驿站（西苑五食堂22栋）'],
    // ⚠️ 上一条的语料**必须**含 `五食堂`：`R8` 要求「`菜鸟` 且 (`西苑`|`五食堂`)」——
    // 语料若写成 `22栋通道菜鸟驿站`，R8 根本匹配不上，**顺序对它就无影响** ⇒ 顺序钉形同虚设。
    // （这是 TD-026 批的变异 M2 实测出来的：把 R7 移到 R8 之后，旧语料下 607 条全绿 = 判据没牙。）
    ['R8', '西苑菜鸟驿站', '', '西苑菜鸟驿站（西苑五食堂22栋）'],
    ['R8', '五食堂菜鸟驿站', '', '西苑菜鸟驿站（西苑五食堂22栋）'],
    ['R9', '北苑菜鸟驿站', '', '北部菜鸟驿站（北苑一食堂三楼）'],
    ['R9', '三楼菜鸟', '', '北部菜鸟驿站（北苑一食堂三楼）'],
    ['R10', '南苑菜鸟驿站', '', '南苑菜鸟驿站'],
    ['R11', '北苑一食堂', '', '北部菜鸟驿站（北苑一食堂三楼）'],
    ['R11', '北部代收点', '', '北部菜鸟驿站（北苑一食堂三楼）'],
    ['R12', '南苑快递点', '', '南苑菜鸟驿站'],
    ['R12', '南区代收点', '', '南苑菜鸟驿站'],
    ['R13', '请到5号柜取件', '', P3],
    ['R14', '湖南省株洲市天元区 湖南工业大学(河西校区)', '113-2-3003', P3],
    ['R14', '湖南工业大学', '12-3456', P3],                            // 两段码也算（§2 R14 按实现订正过）
    ['R15', '湖南工业大学(河西校区) 湖南省株洲市', '', ''],             // 无线索 ⇒ 留空，⛔ 绝不猜点
    ['R15', '', '', '']
  ];
  for (const [id, text, code, point] of RULE_CASES) {
    const got = stations.inferStation(text, code);
    eq('规则 ' + id + '：`' + (text || '（空串）') + '`' + (code ? ' + 码 `' + code + '`' : '')
      + ' ⇒ ' + id + ' → ' + (point || '留空') + '（⛔ 不猜点）',
      got.ruleId + '|' + got.stationName, id + '|' + point);
  }

  // ⑥ 「依据」单独钉：点相同但依据不同 = 屏上给人核对的那列错了（§2 明写这是 R5/R7/R9 顺序存在的理由）
  const evidence = (text, code) => {
    const r = stations.inferStation(text, code || '');
    return r.ruleId + '|' + r.matched;
  };
  eq('依据钉①：`五食堂22栋通道菜鸟驿站` ⇒ R7 且依据 = `22栋`（⛔ 不许被 R8 判成"菜鸟+五食堂"）',
    evidence('五食堂22栋通道菜鸟驿站'), 'R7|22栋');
  eq('依据钉②：`菜鸟 北苑 一食堂` ⇒ R9 且依据含 `菜鸟`（⛔ 不许被 R11 的"北苑"抢走）',
    evidence('菜鸟 北苑 一食堂'), 'R9|菜鸟+北苑');
  eq('依据钉③：`五食堂21栋楼下 菜鸟` ⇒ R5 且依据 = `21栋`（⛔ 不许被 R8 抢）',
    evidence('五食堂21栋楼下 菜鸟'), 'R5|21栋');
  // B 段是**兜底**不是同级（样本 #1 的真冲突）：站点线索命中时，分段码不许把它拉到 P3
  eq('B 段兜底位：`五食堂22栋通道菜鸟驿站 请到5号柜` + 分段码 `600000` ⇒ 仍走 A 段 R7/P5（⛔ 不许被 R13 拉到 P3）',
    evidence('五食堂22栋通道菜鸟驿站 请到5号柜', '600000'), 'R7|22栋');

  // ⑦ 覆盖面（`STATION_MAP §6.2`：**每个取件点 ≥1 条命中路径** + ≥1 条不该命中的反例）
  // 这条是"某条规则唯一路径被删掉"的报警器：点少了 ⇒ 那个点永远判不出来（人会跑错驿站，SCOPE W1）
  // ⚠️ 断言形态必须是**集合相等**，⛔ 不能用 `.length === 7`：某点判不出来时 `stationName` 会变成空串，
  //    空串也占一个"不同值" ⇒ `.length` 仍是 7 ⇒ 覆盖面形同虚设（TD-026 批的变异 M3 实测：摘掉 R2 后
  //    `.length === 7` 依然成立，只有逐名比对才判红）。
  //   ⚠️ 2026-09-26：**语料与期望同步扩到 8 点**（用户指令新增 P8 `东苑一栋邮政`）。为什么期望仍写死：
  //   它必须是一份**独立参照**——若改成从 `listStationPoints()` 派生，那么"某个点被从表里删掉"时
  //   两边一起缩水、断言照样全绿（空集上的全绿）。改语言=改这条：漏一个点的语料 ⇒ 逐名比对当场红。
  const reachable = ['京东 快递', '顺丰 快递', '妈妈驿站', '北苑菜鸟驿站', '五食堂22栋通道菜鸟驿站', '南苑菜鸟驿站', '邮政 代收点', '东苑一栋邮政']
    .map((text) => stations.inferStation(text, '').stationName);
  eq('覆盖面①：命中路径覆盖的取件点集合 == 官方 8 点（缺哪个 = 那个点永远判不出来；含空串即判红）',
    [...new Set(reachable)].sort().join('|'), stations.listStationPoints().slice().sort().join('|'));
  eq('覆盖面②：反例 —— 只写线索词 `菜鸟`（不是站名）⇒ 留空，⛔ 不猜点',
    stations.inferStation('菜鸟', '').stationName, '');
  eq('覆盖面③：反例 —— 无线索 + 6 位连数（⚠️-3 归属未知）⇒ 留空，⛔ 不猜点',
    stations.inferStation('湖南工业大学 校区', '600000').stationName, '');
}

/**
 * §13 常态屏与文案单源（**2026-09-25 交互改判后重写**）
 *
 * 口径变更（裁决原文：「给谁录中的新建客户与点这里选一位客户**不应该持久显示**」）：
 *  旧口径 = 未选中时必须有**常驻**「＋ 新建客户」入口 + 文案与那颗入口同源（本节的 ①~⑦ 是那一版）；
 *  新口径 = 常态**没有**常驻入口、未选中显示**灰字占位**，建档只在**保存时归不上**才触发。
 * ⇒ 旧断言（`showCreateEntry`/`emptyHint`/`INTAKE_NO_TARGET_TEXT`）随入口一起**作废并重写**，
 *    保留其中不变的那条意图：**文案与 UI 必须同源，⛔ 不许指着屏幕上不存在的东西**。
 * ⚠️ 源码级扫描**只扫代码行**：注释里会提到旧写法（本轮就在注释里写了"曾经挂过 create-entry"），
 *    带注释扫会得到假红（本项目已因此踩过一次，见教训卡"注释被正则命中"）。
 * @param {{eq:function, check:function, formParts:object}} kit
 */
function runIntakeEntrySection(kit) {
  const eq = kit.eq;
  const parts = kit.formParts;
  const fs = require('fs');
  const path = require('path');
  console.log('§13 常态屏与文案单源（交互改判：常驻入口已撤除）');

  eq('常态①：未选中 ⇒ 占位文案来自零件单源',
    parts.screenOffer({ notFound: false }).noTargetPlaceholder, parts.NO_TARGET_PLACEHOLDER);
  eq('常态②：占位**不是**旧的蓝色 CTA（"点这里选一位客户"属被撤除的口径）',
    parts.screenOffer({ notFound: false }).noTargetPlaceholder.indexOf('点这里选一位客户') < 0, true);
  eq('常态③：notFound ⇒ 说明文案非空，且**不指向**已撤除的按钮',
    parts.screenOffer({ notFound: true }).notFoundHint.indexOf('＋ 新建客户') < 0
      && parts.screenOffer({ notFound: true }).notFoundHint.length > 0, true);
  eq('常态④：非 notFound ⇒ 不给 notFound 说明（避免两句话打架）',
    parts.screenOffer({ notFound: false }).notFoundHint, '');

  // ⚠️ 注释必须**按块**剥掉再扫：多行 `<!-- … -->` 的续行不以 `<!--` 开头，
  //    只按行首过滤会把它当代码 ⇒ 假红（本轮就踩了：注释里写了"曾经挂过 create-entry"）。
  const stripComments = (src) => src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');
  const codeLines = (file) => stripComments(fs.readFileSync(path.join(__dirname, '..', 'pages', 'recognize', file), 'utf8'));
  const wxmlCode = codeLines('index.wxml');
  const pageCode = codeLines('index.js');
  const partsCode = codeLines('intake-parts.js');
  eq('常态⑤（源码级）：wxml 里不再有常驻建档入口（handler 与 class 都 0 次）',
    wxmlCode.indexOf('onOpenCreateCustomer') < 0 && wxmlCode.indexOf('create-entry') < 0, true);
  eq('常态⑥（源码级）：未选中的蓝色 CTA 在 wxml 里 0 次（改渲染 `{{noTargetPlaceholder}}`）',
    wxmlCode.indexOf('点这里选一位客户') < 0 && wxmlCode.indexOf('{{noTargetPlaceholder}}') >= 0, true);
  eq('常态⑦（源码级）：页面 js 里那句旧提示 0 次（文案单源在零件）',
    pageCode.indexOf('还没有选给哪位客户录') < 0, true);
  eq('常态⑧（源码级）：占位文案在零件里正好 1 处定义（⛔ 别处再写一份）',
    (partsCode.match(/const NO_TARGET_PLACEHOLDER = /g) || []).length, 1);
}

/**
 * §14 保存时的归类裁决（2026-09-25 交互改判的核心）
 *
 * 用户裁决口径：① 手选过 ⇒ 落他（人高于规则）② 没手选 + 会话键唯一命中 ⇒ 直接落、不问
 * ③ 无键 / 未命中 / 命中多条 ⇒ 弹建档浮层（多条还要走挡板：挡住 + 人确认「仍要新建」）。
 * 为什么整节住在这里：这些分支决定"件落到谁名下"，而页面层零断言（TD-016）——
 * 把"手选优先"那支写反（让自动归类抢手选）在页面上没有任何门禁看得见，而后果是**件记到别人头上**。
 * @param {{eq:function, check:function, formParts:object}} kit
 */
function runSaveGateSection(kit) {
  const eq = kit.eq;
  const intake = kit.intakeParts;
  const aggregate = require('../utils/aggregate.js');
  console.log('§14 保存时的归类裁决（手选 > 会话键唯一命中 > 当场建档）');

  const KEY = 'a1b2c3d4e5f60718';
  const customers = [
    { id: 'c1', building: 'D4', dorm: '511', name: 'D4 511 甲', chatRoomId: KEY },
    { id: 'c2', building: 'D4', dorm: '512', name: 'D4 512 乙', chatRoomId: 'ffffffffffffffff' },
    { id: 'c3', building: 'D4', dorm: '513', name: 'D4 513 丙', chatRoomId: KEY, deletedAt: '2026-09-01' }
  ];

  eq('保存①：手选过 ⇒ 落手选那位（人高于规则）',
    intake.resolveSaveTarget({ pickedCustomerId: 'c2', sessionKey: KEY, customers: customers }).mode, 'picked');
  eq('保存②：⛔ 自动归类**不许抢**已手选（真机 P1 就长在这一支）',
    intake.resolveSaveTarget({ pickedCustomerId: 'c2', sessionKey: KEY, customers: customers }).customerId, 'c2');
  eq('保存③：没手选 + 键唯一命中 ⇒ 直接落，且用的是命中者',
    intake.resolveSaveTarget({ pickedCustomerId: '', sessionKey: KEY, customers: customers }).customerId, 'c1');
  eq('保存④：没手选 + 键唯一命中 ⇒ 模式是 auto（不弹建档、不问）',
    intake.resolveSaveTarget({ pickedCustomerId: '', sessionKey: KEY, customers: customers }).mode, 'auto');
  eq('保存⑤：没有会话键 ⇒ 弹建档（reason=NO_KEY）',
    intake.resolveSaveTarget({ pickedCustomerId: '', sessionKey: '', customers: customers }).reason, 'NO_KEY');
  eq('保存⑥：键存在但没命中 ⇒ 弹建档（reason=NO_HIT），⛔ 不许挑一个凑数',
    intake.resolveSaveTarget({ pickedCustomerId: '', sessionKey: '0000000000000000', customers: customers }).reason, 'NO_HIT');
  eq('保存⑦：键命中多条 ⇒ 弹建档且带 duplicate（挡板态）',
    intake.resolveSaveTarget({ pickedCustomerId: '', sessionKey: KEY, customers: customers.concat([{ id: 'c9', chatRoomId: KEY }]) }).duplicate, true);
  eq('保存⑧：挡板文案必须让人**确认**（含「仍要新建」），⛔ 不许静默挑第一个',
    intake.resolveSaveTarget({ pickedCustomerId: '', sessionKey: KEY, customers: customers.concat([{ id: 'c9', chatRoomId: KEY }]) })
      .blockedText.indexOf('仍要新建') >= 0, true);
  eq('保存⑨：软删档案不算命中（与单源口径一致：c3 也是 KEY 但已软删）',
    intake.keyHits(customers, KEY).length, 1);
  // 对帐：本文件镜像的口径必须与 `aggregate.pickCustomerByRoom` 一致（唯一命中 ⟺ 返回非空；0/多 ⇒ 空）
  const mirrorAgrees = [[], [{ id: 'x', chatRoomId: KEY }], customers, customers.concat([{ id: 'y', chatRoomId: KEY }])]
    .every((list) => (intake.keyHits(list, KEY).length === 1) === (aggregate.pickCustomerByRoom(list, KEY) !== ''));
  eq('保存⑩（对帐）：`keyHits` 与 `aggregate.pickCustomerByRoom` 口径一致（分叉即判红）', mirrorAgrees, true);

  const gateAuto = intake.resolveSaveTarget({ pickedCustomerId: '', sessionKey: KEY, customers: customers });
  const viewSave = intake.saveFlowPatch(gateAuto, 'D4 511 甲');
  eq('保存⑪：auto/picked ⇒ 保存流程给 kind=save 且带归属与标签',
    viewSave.kind === 'save' && viewSave.patch.customerId === 'c1' && viewSave.patch.targetLabel === 'D4 511 甲', true);
  eq('保存⑫：save 分支⛔ 不许夹带建档浮层的键（否则浮层会被意外打开）',
    viewSave.patch.createOpen === undefined, true);
  const gateNew = intake.resolveSaveTarget({ pickedCustomerId: '', sessionKey: '', customers: customers, pendingLine: 'd4555' });
  const viewCreate = intake.saveFlowPatch(gateNew, '');
  eq('保存⑬：need-create ⇒ 保存流程给 kind=create 且打开浮层',
    viewCreate.kind === 'create' && viewCreate.patch.createOpen === true, true);
  eq('保存⑭：need-create ⇒ 预填**用户已输的串**（一次输入完成两件事的前提）',
    viewCreate.patch.createLine, 'd4555');
  const gateDup = intake.resolveSaveTarget({ pickedCustomerId: '', sessionKey: KEY, customers: customers.concat([{ id: 'c9', chatRoomId: KEY }]) });
  eq('保存⑮：挡板态 ⇒ 浮层按钮字变成「仍要新建」（人工确认那颗）',
    intake.saveFlowPatch(gateDup, '').patch.createSubmitLabel, '仍要新建');

  // 落件决议（storage 注入 stub ⇒ 能断言"拦空时**一条都没写**"）
  const writes = [];
  const storeStub = {
    addParcel: (p) => { writes.push(p); return { ok: true, created: 1 }; },
    addParcels: (rows) => { writes.push(rows); return { ok: true, created: rows.length }; }
  };
  const blocked = intake.commitSingleSave({ customerId: 'c1', draft: { stationName: '', pickupCode: '1-2-3' }, storage: storeStub });
  eq('保存⑯：站点空 ⇒ 单条拦下且**一条都没写**（拦空必须在写盘之前）',
    blocked.ok === false && writes.length, 0);
  const okSingle = intake.commitSingleSave({
    customerId: 'c1', draft: { stationName: '西苑一栋南面快递中心', pickupCode: '1-2-3' }, storage: storeStub
  });
  eq('保存⑰：正常单条 ⇒ 写 1 条且**归属是裁决出来的那位**（⛔ 不是页面里残留的旧 id）',
    okSingle.ok === true && writes.length === 1 && writes[0].customerId, 'c1');
  const multiBad = intake.commitDraftsSave({ customerId: 'c1', drafts: [{ pickupCode: '9-9-9', stationName: '' }], storage: storeStub });
  eq('保存⑱：多码里有行没选取件点 ⇒ 整批不写，且文案指名第几件',
    multiBad.ok === false && writes.length === 1 && multiBad.errorText.indexOf('第 1 件') >= 0, true);
  // 2026-09-25 裁决 A 之后这条断言换了口径：取消不再「丢掉这件」，而是记到「未归类」占位档案名下
  // （旧常量 `INTAKE_CANCEL_TEXT` 已随该裁决删除；行为断言见 §15）
  eq('保存⑲：取消建档的两句如实文案都在（存成了 / 还没填完），⛔ 都不谎称已存',
    intake.UNASSIGNED_SAVED_TEXT.indexOf('未归类') >= 0 && intake.UNASSIGNED_UNSAVED_TEXT.indexOf('还没填完') >= 0, true);
}


/**
 * §15 「未归类」占位档案（2026-09-25 用户裁决 A：加"未归类"占位客户 —— **改数据形态**）
 *
 * 它解决的死结：`migrate.validate` 要求每件都快挂**已知档案**（`PARCEL_CUSTOMER_MISSING`，每次写盘全库校验）
 * ⇒ "在建档浮层里取消"的那件**没有落脚点**，以前只能丢掉或谎称已存。裁决 A 给它一个固定 id 的占位档案：
 * 进得了库、清单里看得见、能一键重归；而它自己**不可被当客户**（改名/换绑/软删/真删全拒）。
 * 为什么整节住在这里：三个后果都落在**用户手上的数据**上 —— 件凭空消失、清单里冒出一条假客户、
 * 误删占位导致**整库读不出来**（名下件悬空 ⇒ 连读盘都失败）。这三件在页面层没有任何门禁看得见（TD-016）。
 * ⚠️ 本节**放在最后**（紧跟 §purge 之后）：它会真写库（客户 + 件），放前面会污染别人的 fixture 计数。
 * @param {{eq:function, storage:object, intakeParts:object}} kit
 */
function runUnassignedSection(kit) {
  const eq = kit.eq;
  const storage = kit.storage;
  const intake = kit.intakeParts;
  const listParts = require('../pages/pickup-list/list-parts.js');
  const migrate = require('../utils/migrate.js');
  console.log('§15 「未归类」占位档案（惰性创建 / 不可当客户 / 件可见可重归）');

  const ID = migrate.PLACEHOLDER_CUSTOMER_ID;
  const placeholders = (options) => storage.listCustomers(options).customers.filter((c) => migrate.isPlaceholderCustomer(c));
  eq('未归类①：还没用过"取消建档"时，库里**没有**占位档案（惰性创建，不凭空多一条）', placeholders({ includePlaceholder: true }).length, 0);
  const made = storage.ensureUnassigned();
  eq('未归类②：第一次真的需要时才建，且建出来就是固定 id + 名字「未归类」',
    made.ok === true && made.created === true && made.customer.id === ID && made.customer.name === '未归类', true);
  eq('未归类③：再要一次不再建（幂等）', storage.ensureUnassigned().created, false);
  eq('未归类④：⛔ 默认 listCustomers **不含**它（否则档案页/客户选择器里冒出一条假客户）', placeholders().length, 0);
  eq('未归类⑤：显式 includePlaceholder 才取得到（清单分组用）', placeholders({ includePlaceholder: true }).length, 1);

  const cancelled = intake.saveToUnassigned({
    draft: { stationName: '西苑一栋南面快递中心', pickupCode: '116-4-4053', lockerNo: '', trackingTail: '' }
  }, storage);
  eq('未归类⑥：取消建档 ⇒ 这件**真的进库了**（改动前它根本写不进去，只能丢）',
    cancelled.ok === true && cancelled.savedKind === 'single' && storage.listParcels({ customerId: ID }).parcels.length, 1);
  eq('未归类⑦：件还没填完 ⇒ 如实说"没存"，⛔ 不谎称已存',
    intake.unassignedOutcome(intake.saveToUnassigned({ draft: { stationName: '', pickupCode: '1-2-3' } }, storage)).saved, false);

  eq('未归类⑧：改名被拒（PLACEHOLDER_PROTECTED）', storage.updateCustomer(ID, { name: 'x' }).reason, 'PLACEHOLDER_PROTECTED');
  eq('未归类⑨：软删被拒', storage.softDeleteCustomer(ID).reason, 'PLACEHOLDER_PROTECTED');
  eq('未归类⑩：换绑被拒', storage.rebindCustomerChatKey(ID, 'k1').reason, 'PLACEHOLDER_PROTECTED');
  eq('未归类⑪：真删被拒（它连"先软删"那一步都走不到）', storage.purgeCustomer(ID).reason, 'PLACEHOLDER_PROTECTED');

  const parcelsNow = storage.listParcels().parcels;
  const split = listParts.splitUnassigned(parcelsNow);
  eq('未归类⑫：清单把它名下的件**分流出来**（混进站点组就再也看不出"哪些还没归属"）',
    split.unassigned.length === 1 && split.rest.length === parcelsNow.length - 1, true);
  eq('未归类⑬：重归候选**不含**占位档案自己（否则"归给未归类"是原地打转）',
    listParts.reassignOptions(storage.listCustomers({ includePlaceholder: true }).customers).filter((o) => o.id === ID).length, 0);

  const owner = storage.createCustomer({ name: '小王', building: 'D4', dorm: '555' });
  const moved = storage.reassignUnassigned(owner.customer.id);
  eq('未归类⑭：重归 ⇒ 件改挂真实客户，占位名下清零',
    moved.ok === true && moved.moved === 1 && storage.listParcels({ customerId: ID }).parcels.length === 0, true);
  eq('未归类⑮：重归之后**整库校验仍过**（不留悬空引用 ⇒ 读盘不受影响）', storage.loadStore().ok, true);
  eq('未归类⑯：方向反了被拒（目标是占位档案）', storage.reassignUnassigned(ID).reason, 'PLACEHOLDER_TARGET');
}

/**
 * §16 会话键的**来源与绑定**（2026-09-25 BUG：从取件清单建档时会话键丢了）
 *
 * 病灶（复现读数见 `docs/specs/20260925_bug_sessionkey/RCA.md`）：建档那一步**绑定链本身是好的**
 * （注入键就绑上），丢键发生在**上游**——`globalData.chatKey` 全仓只有 `pages/archive-list/` 写，
 * 而清单入口（`from=list`）**结构上没有获取键的动线**，槽只在内存（冷启动即空）。
 * 所以本节钉三件事：
 *   ① 摘要槽专用读取器 `readSessionKey` 的口径（⛔ 不回落到平台原值槽 = 不造"假键"）；
 *   ② 建档链路"有键⇒绑、无键⇒空且成功"（页面那两行的注入面，不再只测"直接传键"的零件层）；
 *   ③ 绑没绑上必须**上屏说实话**（过去只报"建好了"，"没带键"是静默降级）。
 * ⚠️ 本节**不写库**（全部用 stub store）——它跑在 §15 之前，不许污染 §15 的真库夹具。
 */
function runSessionKeySourceSection(kit) {
  const eq = kit.eq;
  const check = kit.check;
  const formParts = kit.formParts;
  const intake = kit.intakeParts;
  console.log('§16 会话键的来源与绑定（摘要槽专用读取 / 有键则绑 / 没绑上要说出来）');

  const DIGEST = '78de35a10e586ed5';
  const RAW = 'open_single_roomid_raw';

  // ① 摘要槽专用读取器：只认 `chatKey`
  eq('§16①：摘要槽有值 ⇒ readSessionKey 原样返回',
    formParts.readSessionKey({ app: { globalData: { chatKey: DIGEST, chatRoomId: RAW } } }), DIGEST);
  eq('§16②：⛔ 摘要槽空、原值槽有值 ⇒ readSessionKey 返回空（**绝不回落原值** —— 那会绑出"假键"）',
    formParts.readSessionKey({ app: { globalData: { chatKey: '', chatRoomId: RAW } } }), '');
  eq('§16③：槽里是非字符串（数字/undefined）⇒ 空串（不吐 undefined、不当成键）',
    formParts.readSessionKey({ app: { globalData: { chatKey: 123 } } }) + '|'
      + formParts.readSessionKey({ app: { globalData: {} } }) + '|' + formParts.readSessionKey({}), '||');
  // 反向守门：`readRoomHint` **必须**保留原值回落（归类比对的兼容分支靠它），别被"顺手统一"改掉
  eq('§16④：`readRoomHint` 仍返回原值（兼容分支没被顺手改掉 —— 两条路口径**刻意不同**）',
    formParts.readRoomHint({ app: { globalData: { chatKey: '', chatRoomId: RAW } } }), RAW);

  // ② 页面那两行的注入面：`sessionKey: readSessionKey({app})`
  const calls = { created: [] };
  const stubStore = {
    listCustomers: () => ({ ok: true, customers: [] }),
    createCustomer: (input) => { calls.created.push(input); return { ok: true, customer: { id: 'new1' } }; },
    addParcel: () => ({ ok: true, created: 1 })
  };
  const filled = { stationName: '南苑菜鸟驿站', pickupCode: '8-2-3021', lockerNo: '', trackingTail: '' };
  const withKeyApp = { globalData: { chatKey: DIGEST, chatRoomId: '' } };
  const keyed = intake.submitCreateCustomer('d4555', {
    storage: stubStore, sessionKey: formParts.readSessionKey({ app: withKeyApp }), draft: filled, drafts: []
  });
  eq('§16⑤：清单入口 + 摘要槽有键 ⇒ 新档案**绑上摘要**（页面注入面走通：readSessionKey→建档）',
    [keyed.ok, keyed.keyBound, calls.created[0].chatRoomId].join('|'), 'true|true|' + DIGEST);
  eq('§16⑥：绑上之后**同一把摘要**能被归类命中（键不是摆设）',
    intake.keyHits([{ id: 'new1', chatRoomId: DIGEST }], DIGEST).join(','), 'new1');

  const rawOnly = intake.submitCreateCustomer('D4-555', {
    storage: stubStore, sessionKey: formParts.readSessionKey({ app: { globalData: { chatKey: '', chatRoomId: RAW } } }),
    draft: filled, drafts: []
  });
  eq('§16⑦：只有平台原值 ⇒ 建档**不绑**（假键比空键更坏：归类按摘要比对，永远命不中）',
    [rawOnly.ok, rawOnly.keyBound, calls.created[1].chatRoomId].join('|'), 'true|false|');

  const emptyApp = { globalData: { chatKey: '', chatRoomId: '' } };
  const noKey = intake.submitCreateCustomer('D5-100', {
    storage: stubStore, sessionKey: formParts.readSessionKey({ app: emptyApp }), draft: filled, drafts: []
  });
  eq('§16⑧：两个槽都空 ⇒ 照常建档、键为空、`keyBound:false`（键可选，⛔ 绝不阻塞建档）',
    [noKey.ok, noKey.keyBound, noKey.savedKind, calls.created[2].chatRoomId].join('|'), 'true|false|single|');

  // ③ 绑没绑上要上屏说实话（文案单源 = 零件里的两个常量）
  const boundView = intake.createSubmitPatch(keyed, 'D4 555 A');
  const unboundView = intake.createSubmitPatch(noKey, 'D5 100 A');
  check('§16⑨：绑上了 ⇒ 状态行说"已绑上会话键"（取零件的单源字面量）',
    boundView.patch.preselectNote.indexOf(intake.KEY_BOUND_TEXT) > 0,
    boundView.patch.preselectNote);
  check('§16⑩：没绑上 ⇒ 状态行**如实说**（含"没带会话键"与去哪补），退屏那句也多提醒一句',
    unboundView.patch.preselectNote.indexOf(intake.KEY_MISSING_TEXT) > 0
      && unboundView.toast.indexOf('没带会话键') > 0
      && boundView.toast.indexOf('没带会话键') < 0,
    unboundView.patch.preselectNote + ' ｜ toast=' + unboundView.toast);
  // 精确取 `onCreateSubmit` 的**函数体**再判：用"距离窗口"的正则会被中间注释长度撑破（本批第一次就栽在这）
  const pageSrc = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'pages', 'recognize', 'index.js'), 'utf8');
  const createBody = (/onCreateSubmit\(\)\s*\{([\s\S]*?)\n  \},/.exec(pageSrc) || ['', ''])[1];
  check('§16⑪：建档处取键**只走 `readSessionKey`**（⛔ 不许退回带原值回落的 `readRoomHint` —— 那会绑出假键）',
    createBody.length > 0 && /sessionKey:\s*readSessionKey\(/.test(createBody)
      && !/sessionKey:\s*readRoomHint\(/.test(createBody),
    createBody.length > 0 ? ('函数体 ' + createBody.length + ' 字符，注入行已核') : '取不到 onCreateSubmit 函数体');
}

/**
 * §17 取会话键的**跨动线**能力（2026-09-25 B 段 · 用户裁决「A：给清单动线也加取键能力」）
 * 三条不变量（都能被真机打脸，所以必须有机器闸）：
 *   ① 摘要入槽**只许一处写**（两处写 ⇒ 谁最后写谁赢，静默分叉；本会话已为"两处写"栽过一次）；
 *   ② 取键必须**离开本页**（平台限制）⇒ 意图与草稿要能把人接回未完成的录件（⛔ 不许静默扔在档案页）；
 *   ③ 意图/草稿**各消费一次**且有 TTL（过期意图不许劫持下一次取键）。
 * ⚠️ 本节**不碰库**（纯槽与源码扫描），跑在哪一节前后都不影响真库夹具。
 */
function runKeyFlowSection(kit) {
  const eq = kit.eq;
  const check = kit.check;
  const formParts = kit.formParts;
  const intake = kit.intakeParts;
  const fs = require('fs');
  const path = require('path');
  const flow = require('../pages/recognize/session-key-flow.js');
  console.log('§17 取会话键（清单动线）：形状契约 / 入槽单源 / 意图交接 / 只消费一次');

  const DIGEST = '78de35a10e586ed5';
  const rootDir = path.join(__dirname, '..');

  // ① A 段（2026-09-25 核销对帐）：`readSessionKey` 的**入参形状**是 `{app}`。
  //    传裸 `{globalData}` ⇒ 当作"没有 app"、回落 `getApp()`（Node 里没有）⇒ 空串。
  //    这不是函数错，是**调用形状错**（Lead 那次"函数恒返空"的读数就是这么来的）⇒ 断言把形状钉住。
  eq('§17①：形状契约 —— 裸 `{globalData}` 是**错形状**（值拿不到 ⇒ 空串）',
    formParts.readSessionKey({ globalData: { chatKey: DIGEST } }), '');
  eq('§17②：正形状 `{app:{globalData}}` 下摘要槽有值 ⇒ 原样返回（与 §16① 同一条，防"改错形状测试还绿"）',
    formParts.readSessionKey({ app: { globalData: { chatKey: DIGEST } } }), DIGEST);

  // ② 入槽 = 全仓唯一写点
  const app = { globalData: {} };
  eq('§17③：putSessionKey 写进摘要槽并回值；非字符串 ⇒ 写空串（⛔ 不造假键）',
    [flow.putSessionKey(app, DIGEST), app.globalData.chatKey, flow.putSessionKey(app, 123), app.globalData.chatKey].join('|'),
    [DIGEST, DIGEST, '', ''].join('|'));
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((ent) => {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) return walk(full);
    return ent.name.endsWith('.js') ? [full] : [];
  });
  const srcs = walk(path.join(rootDir, 'pages')).concat([path.join(rootDir, 'app.js')]).map((full) => ({
    rel: path.relative(rootDir, full).replace(/\\/g, '/'),
    text: fs.readFileSync(full, 'utf8')
  }));
  const writers = srcs.filter((one) => /\[SLOT_KEY\]\s*=/.test(one.text)).map((one) => one.rel);
  const direct = srcs.filter((one) => /(\.chatKey\s*=|\[['"]chatKey['"]\]\s*=)/.test(one.text)).map((one) => one.rel);
  eq('§17④（源码级单源）：摘要槽的写入只许在 session-key-flow.js；页面/app 里**一处直写都不许有**',
    writers.join(',') + '｜直写：' + (direct.join(',') || '（无）'),
    'pages/recognize/session-key-flow.js｜直写：（无）');

  // ③ 意图 + 草稿：两个槽各有各的消费方（标志=档案页，载荷=录入页）
  const bag = { globalData: {} };
  const payload = flow.putPendingIntake(bag, {
    from: 'list', draft: { pickupCode: '116-4-4053' }, drafts: [{ pickupCode: '1' }], recognitionUsed: true
  }, 1000);
  eq('§17⑤：记意图 ⇒ 标志（来源+时刻）与载荷（草稿）分别入槽',
    [!!bag.globalData.pendingIntake, bag.globalData.pendingIntake.from, bag.globalData.pendingIntake.at,
      payload.draft.pickupCode, payload.drafts.length, payload.recognitionUsed].join('|'),
    'true|list|1000|116-4-4053|1|true');
  eq('§17⑥：标志**看一眼不消费**（档案页靠它决定回不回头），消费后第二次必为空',
    [!!flow.peekPendingIntake(bag, 1001), !!flow.takePendingIntake(bag, 1002),
      !!flow.peekPendingIntake(bag, 1003), bag.globalData.pendingIntake === null].join('|'),
    'true|true|false|true');
  eq('§17⑦：载荷同样**只消费一次**（`?resume=1` 只恢复一次草稿）',
    [!!flow.takeResume(bag, 1004), flow.takeResume(bag, 1005) === null].join('|'), 'true|true');

  // ④ TTL：过期意图**两个槽一起清**（否则十分钟后它会突然把人拽走 / 冒出旧草稿）
  const stale = { globalData: {} };
  flow.putPendingIntake(stale, { from: 'list', draft: { pickupCode: 'x' }, drafts: [] }, 2000);
  const expired = flow.peekPendingIntake(stale, 2000 + flow.PENDING_TTL_MS + 1);
  eq('§17⑧：过期意图 ⇒ 不看，且标志与载荷**都被清掉**',
    [expired === null, stale.globalData.pendingIntake === null, stale.globalData.intakeResume === null].join('|'),
    'true|true|true');

  // ⑤ 键到手 ⇒ 接管（入槽 + 导航一次）；没意图 ⇒ 一个字都不写（档案页自己的路不受影响）
  const live = { globalData: {} };
  flow.putPendingIntake(live, { from: 'list', draft: { pickupCode: '116-4-4053' }, drafts: [], recognitionUsed: false }, 3000);
  const nav = [];
  const handled = flow.resumeIfPending(live, DIGEST, { navigateTo: (o) => nav.push(o.url) }, 3001);
  eq('§17⑨：有人等着这个键 ⇒ 入槽 + 导航回录件那一屏（带 `from` 与 `resume=1`）',
    [handled, live.globalData.chatKey, nav.join(',')].join('|'),
    'true|' + DIGEST + '|/pages/recognize/index?from=list&resume=1');
  eq('§17⑩：同一个意图**不会被消费两次**（第二次 false ⇒ 不会再把用户拽走一遍）',
    flow.resumeIfPending(live, DIGEST, { navigateTo: (o) => nav.push(o.url) }, 3002) + '|' + nav.length, 'false|1');
  const idle = { globalData: {} };
  eq('§17⑪：**没有**等待中的意图 ⇒ 不写槽、不导航（档案页自己的建档路必须原样）',
    [flow.resumeIfPending(idle, DIGEST, { navigateTo: (o) => nav.push(o.url) }, 3100),
      idle.globalData.chatKey, nav.length].join('|'), 'false||1');

  // ⑥ 恢复补丁：只写三个键（与"浮层不碰 draft.*"同一条纪律）
  const resumed = flow.resumePatch({ draft: { pickupCode: '116-4-4053' }, drafts: [{ pickupCode: '1' }], recognitionUsed: true });
  eq('§17⑫：恢复补丁只写 `draft` / `recognitionUsed` / `errorText`（⛔ 不许把别的字段带歪）',
    Object.keys(resumed.patch).sort().join(',') + '|' + resumed.drafts.length + '|' + (flow.resumePatch(null) === null),
    'draft,errorText,recognitionUsed|1|true');

  // ⑦ 取键入口只在**真的没键**时出现（⛔ 不常驻、不给假希望）
  const gateNoKey = intake.resolveSaveTarget({ pickedCustomerId: '', sessionKey: '', customers: [] });
  const gateNoHit = intake.resolveSaveTarget({ pickedCustomerId: '', sessionKey: DIGEST, customers: [{ id: 'c1', chatRoomId: 'other' }] });
  const patchNoKey = intake.saveFlowPatch(gateNoKey, 'D4 555 A').patch;
  const patchNoHit = intake.saveFlowPatch(gateNoHit, 'D4 555 A').patch;
  eq('§17⑬：`NO_KEY` ⇒ 浮层出现「去取会话键」；`NO_HIT`（有键只是没命中）⇒ 不出现（再取还是同一把键）',
    [gateNoKey.reason, patchNoKey.createKeyActionText === intake.INTAKE_KEY_ACTION_TEXT,
      gateNoHit.reason, patchNoHit.createKeyActionText].join('|'), 'NO_KEY|true|NO_HIT|');
  const pageSrc = fs.readFileSync(path.join(rootDir, 'pages', 'recognize', 'index.js'), 'utf8');
  const wxmlSrc = fs.readFileSync(path.join(rootDir, 'pages', 'recognize', 'index.wxml'), 'utf8');
  check('§17⑭：取键按钮**不常驻** —— 关浮层时归零，且 wxml 带 `createKeyActionText` 守卫',
    intake.createSheetPatch(false).createKeyActionText === ''
      && /wx:if="\{\{createKeyActionText\}\}"/.test(wxmlSrc),
    '关浮层归零 + wxml 守卫已核');
  check('§17⑮（源码级）：页面并进方法混合件（`Page(Object.assign(...))`），wxml 绑的 `onFetchSessionKey` 真在混合件里',
    /Page\(Object\.assign\(/.test(pageSrc)
      && /bindtap="onFetchSessionKey"/.test(wxmlSrc)
      && typeof flow.pageMethods.onFetchSessionKey === 'function'
      && typeof flow.pageMethods.applyResumeFromQuery === 'function'
      && /this\.applyResumeFromQuery\(query\)/.test(pageSrc),
    '混合件方法：' + Object.keys(flow.pageMethods).join(','));
  // ⚠️ 这一条是"接线钉"：上面那些断言测的都是**模块**，把档案页那次调用删掉它们照样全绿
  // （= 判据没牙）。所以必须有一条盯着"档案页确实在折出摘要之后问了意图"。
  const archiveSrc = fs.readFileSync(path.join(rootDir, 'pages', 'archive-list', 'index.js'), 'utf8');
  check('§17⑯（接线钉）：档案页在折出摘要之后**确实调**了 `resumeIfPending`（删掉它就等于功能没接上）',
    /require\('\.\.\/recognize\/session-key-flow\.js'\)/.test(archiveSrc)
      && /sessionKeyFlow\.resumeIfPending\(app,\s*folded\.key,\s*wx\)/.test(archiveSrc)
      && /sessionKeyFlow\.putSessionKey\(app,\s*folded\.key\)/.test(archiveSrc),
    '档案页已接线：resumeIfPending + putSessionKey');
}

module.exports = {
  runFormPartsSection, runStationListSection, runIntakeEntrySection, runSaveGateSection,
  runSessionKeySourceSection, runUnassignedSection, runKeyFlowSection
};
