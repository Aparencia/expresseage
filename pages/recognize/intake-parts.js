// pages/recognize/intake-parts.js · 录入页的「落件决议 + 内联建档」这一簇（页面专用零件）
//
// 为什么会有这个文件（2026-09-25 真机反馈批 2）：
//   ① `form-parts.js` 原就贴在 498 行；本批的"**一次输入完成两件事**"（用户构想）再往里加会破
//      AGENTS §11.1 的"单文件 ≤500" ⇒ 按项目既有做法**先搬迁再改**（不压注释、不删 Why）。
//   ② 搬出来时必须避免**循环 require**：`savePendingFor` 要用 `planSingleSave`，
//      而 `planSingleSave` 又要 `normalizeStation` ⇒ 索性把这一族一起搬进来，让依赖成为**单向边**
//      （`form-parts` → 本文件；本文件**不** require `form-parts`）。第一次写反了方向，
//      被"期望值闸"当场抓住（`planSingleSave is not a function`：`form-parts` 末尾是整对象替换，
//      反向 eager require 只会拿到一张还没填的空表）。
//
// ⚠️ 2026-09-26 第 2 件批 3：第 ① 簇（`cleanTail` / `normalizeStation` / `planSingleSave`）**又搬了一次**，
// 这次搬到本目录的 **`save-parts.js`** —— 原因同上次：本文件 487/500 非空行，"单条保存入口"要再加两个纯函数，
// 不搬就顶破 AGENTS §11.1。搬出后依赖仍是**单向边**（本文件 → `save-parts`，后者只 require 两个 utils 叶子），
// 且本文件**逐个 re-export 旧名字**，所以 `form-parts.js` 的 re-export 链与既有断言一个字都不用改。
'use strict';

const parcelDrafts = require('../../utils/parcel-drafts.js');
const customerInput = require('../../utils/customer-input.js');   // 建档值域闸：与档案页**复用同一处**
const stations = require('../../utils/stations.js');              // 站点名归一的单源（⛔ 不写第二份比对）
const { reasonText, failureText } = require('../../utils/reason.js');   // 失败文案单源（⛔ 本页不自己造码/文案）
// ① 簇（写盘前决议）现住 `save-parts.js`：本文件只**转出**，⛔ 不再有第二份实现
const saveParts = require('./save-parts.js');

// ── ① 单条件的落件决议（实现已搬到 `./save-parts.js`，这里只转出 —— 见文件头）────────────
const cleanTail = saveParts.cleanTail;
const normalizeStation = saveParts.normalizeStation;
const planSingleSave = saveParts.planSingleSave;

// ── ② 内联新建客户（2026-09-25 用户裁决：「录入页内联新建，不离开当前屏」）────────────

/**
 * 打开/关闭新建浮层要写的 data 键。⚠️ 这个返回值就是"**已填内容不许丢**"的结构证据：只有 create* 三个键，
 * 一个 `draft.*` / `drafts` 都不含 ⇒ 浮层开合在**结构上**碰不到已填的站点/取件码/多码列表（不必另做快照）。
 * @param {boolean} open ｜ @param {string} [prefill] 打开时预填那一行（保存时裁决为"要建档"⇒ 把用户已输的串带回来）
 * @returns {{createOpen:boolean, createLine:string, createError:string}}
 */
function createSheetPatch(open, prefill) {
  return {
    createOpen: !!open,
    createLine: (!!open && typeof prefill === 'string') ? prefill : '',
    createError: '',
    // 取键那颗按钮**默认不出现**（⛔ 不常驻）：只有 `saveFlowPatch` 判成"真的没键"时才写上文案；
    // 开合浮层时归零 ⇒ 上一次的文案不会留在下一次的浮层上冒充
    createKeyActionText: ''
  };
}

/**
 * 浮层里那一行 → 建档入参（纯函数：不读盘、不写盘、不 setData）。
 * @param {Array} customers 现有档案（算"同楼栋同宿舍的下一个后缀"要用；缺了会补出重名档案）
 * @param {string} line 用户正在输入/粘贴的那一行
 * @param {string} [sessionKey] 当前会话的**本地摘要键**（页面从摘要槽读出来注入；缺省空串）
 * @returns {{ok:boolean, input?:{building:string,dorm:string,name:string,note:string,chatRoomId:string}, errorText:string}}
 *   `ok:false` 时文案走 `reasonText`（`NO_BUILDING` 与 `NO_DORM` 指向不同修法），
 *   且⛔ **不要拿返回值去覆盖输入框**（那会把用户正在打的字改掉 —— 与档案页同一条纪律）。
 *   ⚠️ 键的口径（2026-09-25 用户构想「没有用户档案时…可以获得会话键」）：**有则绑、无则为空**，
 *   且⛔ **绝不阻塞建档** —— 平台只在聊天工具模式下给明文 id，拿不到键是**常态**。
 *   这里只接**摘要槽**（`chatKey`：不可逆、非平台原文）；平台原值槽（`chatRoomId`）一律不由本路取
 *   （那条槽的一次性令牌与 `fromChatFlow` 闸门只归档案页那条动线，⛔ 别把原值塞进来）。
 */
function createCustomerDraft(customers, line, sessionKey) {
  const result = customerInput.buildCustomerInput(customers || [], typeof line === 'string' ? line : '');
  if (!result.ok) return { ok: false, errorText: reasonText(result.reason) };
  return {
    ok: true,
    input: {
      building: result.building,
      dorm: result.dorm,
      name: result.name,
      note: '',
      chatRoomId: typeof sessionKey === 'string' ? sessionKey : ''
    },
    errorText: ''
  };
}

/**
 * 建完当场把"**已经填好的这一件**"也存了 —— **一次输入完成两件事**（2026-09-25 用户构想原话：
 * 「只需要求输入类似 d3455 就能够完成建档与快递码录入」）。
 * 为什么住零件：这是"先建档、后落件、件挂新档案"这条顺序的**唯一实现**；页面层零断言（TD-016）⇒
 * 只活在页面里时，"存的时候用了旧 customerId"这类错没有任何门禁看得见。
 * @param {string} customerId 刚建出来的档案 id
 * @param {{draft?:object, drafts?:Array, recognitionUsed?:boolean}} bag 页面上**已填好**的内容
 * @param {object} store 注入的 storage
 * @returns {{kind:'single'|'multi'|'none', count:number, errorText:string}} `kind:'none'` 有两种含义：
 *   ① 还没填完（**不是错误**，errorText 空）② 写盘失败（errorText 有话说）——两者靠 errorText 区分
 */
function savePendingFor(customerId, bag, store) {
  const drafts = Array.isArray(bag.drafts) ? bag.drafts : [];
  if (drafts.length > 1) {
    // 有行没选取件点 ⇒ 整批不写（与页面 `saveDrafts` 同一条拦空口径），但**不报错**：人接着填完再存
    if (parcelDrafts.findRowsWithoutStation(drafts).length > 0) return { kind: 'none', count: 0, errorText: '' };
    const rows = parcelDrafts.saveableDrafts(drafts).map((row) => Object.assign({}, row, { customerId: customerId }));
    if (rows.length === 0) return { kind: 'none', count: 0, errorText: '' };
    const added = store.addParcels(rows);
    if (!added.ok) return { kind: 'none', count: 0, errorText: failureText(added.reason, added.detail) };
    return { kind: 'multi', count: added.created, errorText: '' };
  }
  const plan = planSingleSave(bag.draft || {}, bag.recognitionUsed === true);
  if (!plan.ok) return { kind: 'none', count: 0, errorText: '' };
  const added = store.addParcel(Object.assign({ customerId: customerId }, plan.parcel));
  if (!added.ok) return { kind: 'none', count: 0, errorText: failureText(added.reason, added.detail) };
  return { kind: 'single', count: 1, errorText: '' };
}

/**
 * 「取消建档」的兜底落库（2026-09-25 用户裁决 A：加「未归类」占位客户，**改数据形态**）。
 * 为什么要有它：取消 ⇒ 这件没归属 ⇒ `migrate.validate` 的 `PARCEL_CUSTOMER_MISSING` 会让整次写盘失败
 * ⇒ 以前只能"丢掉 + 如实说没存"。现在件挂到**占位档案**名下：进得了库、清单里看得见、之后能一键重归。
 * ⛔ 顺序与 `submitCreateCustomer` 一致：**先拿到归属（惰性创建占位档案）、再落件**；
 * 件没填完（`planSingleSave` 拦空）⇒ 如实回 `kind:'none'`，⛔ 不许谎称已存。
 * @param {{draft?:object, drafts?:Array, recognitionUsed?:boolean}} bag 页面上**已填好**的内容
 * @param {object} store 注入的 storage（本文件不直连全局单例）
 * @returns {{ok:boolean, customerId:string, savedKind:'single'|'multi'|'none', savedCount:number, errorText:string}}
 */
function saveToUnassigned(bag, store) {
  const ensured = store.ensureUnassigned();
  if (!ensured.ok) {
    return { ok: false, customerId: '', savedKind: 'none', savedCount: 0, errorText: reasonText(ensured.reason) };
  }
  const customerId = (ensured.customer && ensured.customer.id) || '';
  const saved = savePendingFor(customerId, bag || {}, store);
  return { ok: true, customerId: customerId, savedKind: saved.kind, savedCount: saved.count, errorText: saved.errorText };
}

/**
 * 取消建档后**上屏什么**（纯函数、单源；页面只 setData 一次）。
 * 三种结果都要说实话：存成了 / 还没填完所以没存 / 写盘失败（把原因带上）。
 * @param {object} result `saveToUnassigned` 的产物
 * @returns {{saved:boolean, notice:string, back:boolean}} `back:true` = 件已进库 ⇒ 报一句并退回清单
 */
function unassignedOutcome(result) {
  const r = result || {};
  if (r.savedKind !== 'none') return { saved: true, notice: UNASSIGNED_SAVED_TEXT, back: true };
  if (!r.errorText) return { saved: false, notice: UNASSIGNED_UNSAVED_TEXT, back: false };
  return { saved: false, notice: '这件没存进去：' + r.errorText, back: false };
}

/**
 * 内联新建的**提交决议**：读库 → 过闸 → 落库 → **顺手把已填的那件也存了**（`storage` 注入，本文件不直连全局单例）。
 * 为什么连落库也放这里：页面层零断言（TD-016），"建完要能拿到 id 去当场选中"这步失效时
 * 屏上只是"建完了但没选上"，没有任何门禁看得见。副作用集中到注入的 `storage` 上，函数本身可测。
 * ⚠️ 顺序 = **先建档、再存件**（件必须挂新档案名下）；存件失败**不回滚建档** —— "档案已建好"就是用户要的那一半，
 * 把失败原因交回页面说出来，比把已经建好的档案悄悄删掉（那是删数据）诚实得多。
 * @param {string} line 浮层里那一行
 * @param {{storage:object, sessionKey?:string, draft?:object, drafts?:Array, recognitionUsed?:boolean}} deps
 * @returns {{ok:boolean, customerId:string, keyBound:boolean, savedKind:'single'|'multi'|'none',
 *   savedCount:number, errorText:string}}
 *   `keyBound`（2026-09-25 BUG 会话键修复）= **这次到底有没有把会话键落进新档案**。
 *   为什么要它：键是"有则绑、无则为空"的可选物，屏上过去只报"建好了"，
 *   于是"没带上键"这种**静默降级**只能靠人猜（用户真机报的正是"建档时没有会话键"）。
 *   它由**真实落库值**（`gate.input.chatRoomId`）推出，不是由入参类型猜的 —— 断言钉住这一点。
 */
function submitCreateCustomer(line, deps) {
  const bag = deps || {};
  const store = bag.storage;
  const loaded = store.listCustomers();
  if (!loaded.ok) {
    return { ok: false, customerId: '', keyBound: false, savedKind: 'none', savedCount: 0, errorText: reasonText(loaded.reason) };
  }
  const gate = createCustomerDraft(loaded.customers, line, bag.sessionKey);
  if (!gate.ok) {
    return { ok: false, customerId: '', keyBound: false, savedKind: 'none', savedCount: 0, errorText: gate.errorText };
  }
  const created = store.createCustomer(gate.input);
  if (!created.ok) {
    return {
      ok: false, customerId: '', keyBound: false, savedKind: 'none', savedCount: 0,
      errorText: failureText(created.reason, created.detail)
    };
  }
  const customerId = (created.customer && created.customer.id) || '';
  const saved = savePendingFor(customerId, bag, store);
  return {
    ok: true, customerId: customerId, keyBound: gate.input.chatRoomId !== '',
    savedKind: saved.kind, savedCount: saved.count, errorText: saved.errorText
  };
}

/**
 * 建档提交后页面要写的 data（**收敛成一处**，页面只 setData 一次）。
 * ⚠️ `patch` 里**不含任何 `draft.*` / `drafts` / `lines`** —— 这就是"已填内容丢不了"的**结构**证据
 * （与 `createSheetPatch` 同一条纪律：快照还原反而多一处能写错）。
 * @returns {{patch:object, toast:string, back:boolean}} `back:true` = 两件事都办完 ⇒ 报一句就退回清单
 */
function createSubmitPatch(result, label) {
  const saved = result.savedKind !== 'none';
  const errorText = (!saved && result.errorText) ? ('档案建好了，但这件没存进去：' + result.errorText) : '';
  // 键的状态**由结果里的真实绑定值决定**（`keyBound` 是拿落库值算的，不是拿入参类型猜的）
  const keyText = result.keyBound === true ? KEY_BOUND_TEXT : KEY_MISSING_TEXT;
  const base = saved ? ('已建档并存入 ' + result.savedCount + ' 条：' + label) : ('已当场新建并选中：' + label);
  return {
    patch: {
      createOpen: false, createLine: '', createError: '',
      // 保存时裁决那三个键也一并复位：它们只在"这次保存要建档"的浮层上有意义，
      // 留着会污染下一次打开（挡板文案/按钮字会带着上一轮的痕迹）
      createBlockedText: '', createDuplicate: false, createSubmitLabel: '建好了',
      customerId: result.customerId, targetLabel: label, notFound: false, errorText: errorText,
      preselectNote: base + '｜' + keyText
    },
    // 退屏那句只在**键没绑上**时多说一句（提醒去哪补），绑上了就不啰嗦（正常路径保持短）
    toast: saved ? ('已建档并存入 ' + result.savedCount + ' 条' + (result.keyBound === true ? '' : '（没带会话键）')) : '',
    back: saved
  };
}

// ── ③ 保存时的归类裁决（2026-09-25 交互改判：不再"进页面先选人"）────────────────────
//
// 用户裁决与理由（真机第三轮反馈原话）：
//   「我希望给谁录中，的新建客户与点这里选一位客户**不应该持久显示**」
//   「新建客户应该在**选择完成快递码填写保存时发现没有对应会话键时要求新建**」
// ⇒ 屏上不再有常驻建档入口；归属在**保存那一刻**才裁决：① 手选过 ⇒ 落他 ② 有会话键且唯一命中 ⇒ 落他
//   ③ 无键 / 未命中 / 命中多条 ⇒ 弹建档浮层。⛔ 命中多条走挡板（挡住 + 人确认），不许静默挑第一个。

// ⛔ 只此一份（源码级断言 §14 钉住）：「给谁录」未选中时的**灰字占位**（不是蓝色 CTA）。
// 为什么必须回数据里渲染：这两句过去硬写在 wxml 里，于是"入口撤了、文案还指着它"这种分叉没人看得见
//（本项目为此栽过两次：B 条第一次是清单页拦入口，第二次是提示指着一颗不存在的按钮）。
const NO_TARGET_PLACEHOLDER = '暂无客户';
// 保存时归不上 ⇒ 弹建档浮层前给的理由（⛔ 一个字都不许指向屏上不存在的按钮）
const INTAKE_NEED_CREATE_TEXT = '这件还没有归属：没能按会话键归到任何一位客户，也没人手选过。当场建一位接着存（一行就行）。';
// 命中多条 ⇒ 挡板口径（DESIGN §10：挡住 + 人确认「仍要新建」，⛔ 不许静默选第一个）
const INTAKE_DUPLICATE_TEXT = '这条会话键对上了不止一位档案 —— 系统不替你猜。要新建请按「仍要新建」确认，或先去「用户档案」把那几位理清。';
// 真的**没有键**时的第三颗按钮（用户裁决 A：清单动线也能取键；2026-09-25 B 段）。
// ⛔ 只在 `NO_KEY` 给：`NO_HIT` = 有键但没对上任何档案 ⇒ 再取一次还是同一把键，给了就是骗人。
// 文案里的"不离开这一屏"是**承诺**，所以悬浮层之外还留了 `?resume=1` 把草稿接回来（见 session-key-flow.js）。
const INTAKE_KEY_ACTION_TEXT = '去取会话键（到聊天里选这条会话）';
// 在建档浮层里取消 ⇒ **不再把件丢掉**（2026-09-25 用户裁决 A：加「未归类」占位客户）。两条如实文案：
//   · 存成了 ⇒ 说清存到哪、之后怎么归（⛔ 不许含糊成"处理好了"）
//   · 没存成（这件还没填完）⇒ 说清为什么，⛔ 不许谎称已存
const UNASSIGNED_SAVED_TEXT = '这件先记到「未归类」了 —— 回取件清单能看到这一组，归给某位客户就行。';
const UNASSIGNED_UNSAVED_TEXT = '这件还没填完（缺取件点或取件码），所以先没存 —— 补完再点「保存」。';
// 建档后**会话键到底绑上没有**的两句（唯一出处；页面与断言都取这里，⛔ 别在页面里再写一遍）。
// 为什么必须说出来（2026-09-25 用户真机报"取件清单建档时没有会话键"）：键是"有则绑、无则为空"的可选物，
// 屏上过去只报"建好了" ⇒ "没带上键"是**静默降级**，人只能猜；而且键的**获取**只在档案页那条会话选择动线上
// （`globalData.chatKey` 全仓只有 `pages/archive-list/` 写），清单入口结构上拿不到 ⇒ 更要说清去哪拿。
const KEY_BOUND_TEXT = '已绑上会话键';
const KEY_MISSING_TEXT = '这条没带会话键 —— 本机还没取到会话；去「用户档案」做一次会话选择，之后再建档就会带上';

/**
 * 「会话键 → 命中档案」的计数。**镜像** `aggregate.pickCustomerByRoom` 的口径（跳过软删、只认字符串全等）。
 * 为什么不复用：那个函数只回"唯一命中 / 否则空串"，而本处必须**区分 0 命中与多命中** —— 两者后续动作不同
 * （0 ⇒ 直接建档；多 ⇒ 先走挡板）。`utils/**` 不在本批写盘范围，故在此镜像 + **配一条对帐断言**
 * （§14 对帐⑥：单命中 ⟺ `pickCustomerByRoom` 返回非空）。两处口径一旦分叉，那条断言就判红。
 * @param {Array} customers 档案数组（原始对象，需含 id/chatRoomId/deletedAt）
 * @param {string} sessionKey 本地摘要键（空 ⇒ 不命中任何东西）
 * @returns {Array<string>} 命中档案的 id（0/1/多条）
 */
function keyHits(customers, sessionKey) {
  if (typeof sessionKey !== 'string' || sessionKey === '') return [];
  const hits = [];
  for (const customer of customers || []) {
    if (!customer || customer.deletedAt) continue;
    if (typeof customer.chatRoomId !== 'string' || customer.chatRoomId !== sessionKey) continue;
    if (typeof customer.id === 'string' && customer.id) hits.push(customer.id);
  }
  return hits;
}

/**
 * **保存时的归类裁决**（纯函数，单源）。优先级严格按用户裁决：
 *   ① 手选过 ⇒ `picked`（人始终高于规则：⛔ 自动归类**不许抢**已手选）
 *   ② 没手选 + 有键且唯一命中 ⇒ `auto`（直接落，不问）
 *   ③ 无键 / 键未命中 / 命中多条 ⇒ `need-create`（弹浮层；多条另带 `duplicate` ⇒ 挡板）
 * @param {{pickedCustomerId?:string, sessionKey?:string, customers?:Array, pendingLine?:string}} state
 * @returns {{mode:'picked'|'auto'|'need-create', customerId:string, prefill:string, reason:string,
 *            duplicate:boolean, blockedText:string}} `reason` 取值：PICKED / AUTO / NO_KEY / NO_HIT / MULTI
 */
function resolveSaveTarget(state) {
  const s = state || {};
  const picked = (typeof s.pickedCustomerId === 'string' && s.pickedCustomerId) ? s.pickedCustomerId : '';
  if (picked) return { mode: 'picked', customerId: picked, prefill: '', reason: 'PICKED', duplicate: false, blockedText: '' };
  const key = (typeof s.sessionKey === 'string') ? s.sessionKey : '';
  const hits = keyHits(s.customers, key);
  if (hits.length === 1) {
    return { mode: 'auto', customerId: hits[0], prefill: '', reason: 'AUTO', duplicate: false, blockedText: '' };
  }
  const multi = hits.length > 1;
  return {
    mode: 'need-create',
    customerId: '',
    prefill: (typeof s.pendingLine === 'string') ? s.pendingLine : '',
    reason: multi ? 'MULTI' : (key ? 'NO_HIT' : 'NO_KEY'),
    duplicate: multi,
    blockedText: multi ? INTAKE_DUPLICATE_TEXT : INTAKE_NEED_CREATE_TEXT
  };
}

/**
 * **保存流程要写进 data 的补丁**（单源）：`picked`/`auto` ⇒ 把归属写进 data 后走落件；
 * `need-create` ⇒ 开建档浮层（带 prefill 与挡板文案）。页面只 setData 一次并照 `kind` 分流。
 * @param {object} gate `resolveSaveTarget` 的产物
 * @param {string} label 目标客户的标签（由调用方用单源 `aggregate.customerLabel` 取）
 * @returns {{kind:'save'|'create', patch:object}}
 */
function saveFlowPatch(gate, label) {
  const mode = gate && gate.mode;
  if (mode === 'need-create') {
    return {
      kind: 'create',
      patch: Object.assign(createSheetPatch(true, gate.prefill), {
        createBlockedText: gate.blockedText,
        createDuplicate: gate.duplicate === true,
        createSubmitLabel: gate.duplicate === true ? '仍要新建' : '建好了',
        // 取键入口只跟"真的没键"一起出现（见 INTAKE_KEY_ACTION_TEXT 的注释）；有键只是没命中 ⇒ 空串
        createKeyActionText: gate.reason === 'NO_KEY' ? INTAKE_KEY_ACTION_TEXT : ''
      })
    };
  }
  return {
    kind: 'save',
    patch: {
      customerId: gate.customerId,
      targetLabel: label,
      notFound: false,
      errorText: '',
      preselectNote: mode === 'auto' ? ('按会话键归到：' + label) : ('已选：' + label)
    }
  };
}

/**
 * 单条落件（写盘前决议 + 落库，`storage` 注入）。⛔ 从页面搬进零件的原因与 `planSingleSave` 同：
 * 页面层零断言（TD-016），"用哪个 customerId 落库"这类错在页面里没有任何门禁看得见。
 * @param {{customerId:string, draft?:object, recognitionUsed?:boolean, storage:object}} deps
 * @returns {{ok:boolean, errorText:string, created:number}}
 */
function commitSingleSave(deps) {
  const bag = deps || {};
  const plan = planSingleSave(bag.draft || {}, bag.recognitionUsed === true);
  if (!plan.ok) return { ok: false, errorText: plan.errorText, created: 0 };
  const added = bag.storage.addParcel(Object.assign({ customerId: bag.customerId }, plan.parcel));
  if (!added.ok) return { ok: false, errorText: failureText(added.reason, added.detail), created: 0 };
  return { ok: true, errorText: '', created: 1 };
}

/**
 * 一图多码整批落件（要么全进、要么一条都不进）。拦空站点放在**写盘之前**（R-01）：
 * 带着一行空站点去写 = 整批 `VALIDATION_FAILED`，那句报错既不说第几件、也不说怎么修 ⇒ M8 直接失效。
 * @param {{customerId:string, drafts?:Array, noCode?:number, storage:object}} deps
 * @returns {{ok:boolean, errorText:string, created:number, noCode:number}}
 */
function commitDraftsSave(deps) {
  const bag = deps || {};
  const drafts = Array.isArray(bag.drafts) ? bag.drafts : [];
  const toSave = parcelDrafts.saveableDrafts(drafts).map((row) => Object.assign({}, row, { customerId: bag.customerId }));
  if (toSave.length === 0) {
    return { ok: false, errorText: '这些行都还没有取件码 —— 先逐行补上再存。', created: 0, noCode: 0 };
  }
  // 行号按**屏上显示的序号**数（含没码的行），否则"第 3 件"会指到另一行上去
  const noStation = parcelDrafts.findRowsWithoutStation(drafts).map((order) => order + 1);
  if (noStation.length > 0) return { ok: false, errorText: draftsBlockedText(noStation), created: 0, noCode: 0 };
  const added = bag.storage.addParcels(toSave);
  if (!added.ok) return { ok: false, errorText: failureText(added.reason, added.detail), created: 0, noCode: 0 };
  return { ok: true, errorText: '', created: added.created, noCode: bag.noCode || 0 };
}

/**
 * 「这几行还没有取件点」的文案（单源）：从页面搬出来才可断言 —— 它过去只在页面里，
 * 把整段删掉自测仍全绿，而人会得到一条"整批静默不写"的记录。
 * @param {Array<number>} noStation 屏上序号（1 起） ｜ @returns {string}
 */
function draftsBlockedText(noStation) {
  return '第 ' + (noStation || []).join(' 件、第 ') + ' 件还没选取件点 —— 到了驿站得先知道是替谁取的，'
    + '所以这一件存不进去。给这几件选好「去哪取」再点「全部保存」（这次一条都没存进去）。';
}

/**
 * 「这一屏常态该显示什么」的单源：占位文案与 `notFound` 说明都由这里给，wxml 只渲染 data。
 * 起因（2026-09-25 交互改判 + B 条两次真机失败）：常态的蓝色 CTA 与常驻建档按钮都撤了，
 * 而"文案指着已撤掉的按钮"这种分叉两次都是真机才发现的 ⇒ 文案与 UI 从此同源。
 * @param {{notFound?:boolean}} state
 * @returns {{noTargetPlaceholder:string, notFoundHint:string}}
 */
function screenOffer(state) {
  const notFound = !!(state && state.notFound);
  return {
    noTargetPlaceholder: NO_TARGET_PLACEHOLDER,
    notFoundHint: notFound
      ? '他可能刚被删掉。你可以回「用户档案」页从那一行重进；也可以把这件录完 —— 点「保存」时会让你当场建一位接着存。'
      : ''
  };
}

/**
 * 手选客户要写的 data 补丁（纯函数）。⛔ 返回 `null` = "这一项点不到"（列表刚刷新过 ⇒ 什么都不做，
 * 不猜一条档案去改归属）；文案"已改成手选："是**唯一出处**（页面再写一遍就是第二份口径）。
 * @param {{id:string,label:string}} [option] `data.customerOptions` 里那一条
 * @returns {object|null}
 */
function pickCustomerPatch(option) {
  if (!option || !option.id) return null;
  return {
    customerId: option.id,
    targetLabel: option.label,
    notFound: false,
    preselectNote: '已改成手选：' + option.label
  };
}

/**
 * 多码列表变化的 data 补丁（纯函数）：行数/可存数/没码数一次算全。
 * 为什么搬进零件：算漏一次就会出现"按钮灰着但其实有码"（v1 24 审查 R-17 同一族），
 * 而页面层零断言（TD-016）⇒ 这条算式只活在页面里时没有任何门禁看得见。
 * @param {Array} list `parcelDrafts` 的列表产物
 */
function draftListPatch(list) {
  const sum = parcelDrafts.summarizeDrafts(list);
  return { drafts: list, draftsReady: sum.ready, draftsNoCode: sum.noCode };
}

module.exports = {
  cleanTail,
  normalizeStation,
  planSingleSave,
  createSheetPatch,
  createCustomerDraft,
  savePendingFor,
  submitCreateCustomer,
  createSubmitPatch,
  screenOffer,
  // ③ 保存时的归类裁决（2026-09-25 交互改判）
  keyHits,
  resolveSaveTarget,
  saveFlowPatch,
  commitSingleSave,
  commitDraftsSave,
  draftsBlockedText,
  NO_TARGET_PLACEHOLDER,
  INTAKE_NEED_CREATE_TEXT,
  INTAKE_DUPLICATE_TEXT,
  INTAKE_KEY_ACTION_TEXT,
  // 「取消建档 ⇒ 记到未归类」（2026-09-25 用户裁决 A）
  UNASSIGNED_SAVED_TEXT,
  UNASSIGNED_UNSAVED_TEXT,
  // 建档后"键绑没绑上"的两句（2026-09-25 BUG 会话键修复；§16 断言取这里的字面量）
  KEY_BOUND_TEXT,
  KEY_MISSING_TEXT,
  saveToUnassigned,
  unassignedOutcome,
  cancelCreateView,
  // 页面瘦身搬迁（2026-09-25 B 段，守 500 行硬线）：手选补丁 / 多码汇总补丁
  pickCustomerPatch,
  draftListPatch
};

/**
 * 「取消建档」要写进 data 的**整段视图**（一次给全：补丁 + 报什么 + 要不要退屏）。
 * 为什么连"退屏"也在这里定：页面层零断言（TD-016）—— "取消之后到底写了什么、上屏什么、走不走"
 * 这三件只活在页面里时，没有任何门禁看得见（B 条两次真机失败都是这一族）。
 * @param {{draft?:object, drafts?:Array, recognitionUsed?:boolean}} bag 已填内容（只读，不修改）
 * @param {object} store 注入的 storage
 * @returns {{patch:object, notice:string, back:boolean}} `back:true` = 件已进库 ⇒ 报一句并退屏
 *   ⛔ `patch` 里**不含任何 `draft.*`**（`createSheetPatch` 的结构保证）：取消不会弄丢已填内容
 */
function cancelCreateView(bag, store) {
  const outcome = unassignedOutcome(saveToUnassigned(bag, store));
  // 没存成时把原因放进 `errorText`（那件确实还没进库，页面要说出来）；存成了就清空它
  return {
    patch: Object.assign(createSheetPatch(false), { errorText: outcome.saved ? '' : outcome.notice }),
    notice: outcome.notice,
    back: outcome.saved
  };
}
