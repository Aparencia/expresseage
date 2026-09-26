// pages/recognize/index.js · 添加快递（取图 → 本机识别 → 预填 → 人核对 → 存到该客户）
// 本批 M5/M6/M7/M8 的落点。三条贯穿全页的纪律：
// ① **三道门禁分别过**：相册隐私（选图前）→ 摄像头隐私（识别前）→ 识别/解析（出文字后）；任一失败只把这一屏降级成"少预填一点"，**手输始终能存**（M6，绝不阻断录入）。
// ② 识别原文属 D3（可能含取件码）：只进内存与本页显示，不落盘、不写日志、不联网。
// ③ 落库的 `source` 按"**实际有没有采信识别结果**"记 ocr/manual —— 选过图但一个字都没填进去 = manual
//    （v1 2026-09-17 审查 R-13：否则使用率统计会说谎）。
// 一次只处理**一张**图：多张串行流水线（v1 的 utils/pickqueue.js）在 DESIGN §5 判为"不搬"，两个选图接口都按 count:1 收。
'use strict';

const storage = require('../../utils/storage.js');
const aggregate = require('../../utils/aggregate.js');
const privacy = require('../../utils/privacy.js');
const ocr = require('../../utils/ocr.js');
const stations = require('../../utils/stations.js');
const parcelDrafts = require('../../utils/parcel-drafts.js');
const { reasonText, failureText } = require('../../utils/reason.js');
// 模块级零件（纯函数 + 常量）住 ./form-parts.js —— 本文件只管事件与渲染（R2-C12 / TD-001）
const parts = require('./form-parts.js');

const BANNER_WAITING = parts.BANNER_WAITING;
const BANNER_RECOGNIZING = parts.BANNER_RECOGNIZING;
const firstTempPath = parts.firstTempPath;
const readRoomHint = parts.readRoomHint;
const readRoomHintKind = parts.readRoomHintKind;
const readSessionKey = parts.readSessionKey;   // 建档绑键只认摘要槽（原值回落=假键，见 docs/specs/20260925_ui_feedback/RCA_sessionkey.md）
const roomPreselect = parts.roomPreselect;
const sourceOf = parts.sourceOf;         // 这一屏是从哪进来的（'list' | 'customer'）
const resolveTarget = parts.resolveTarget;  // 「给谁录」落值 —— ⛔ 会话键不参与（A 条 P1 的机器闸）
const freshForm = parts.freshForm;
const windowInnerHeight = parts.windowInnerHeight;
const computeMidHeight = parts.computeMidHeight;
const planParsePatch = parts.planParsePatch;   // 识别结果 → 数据补丁（含 banner 说真话 / 站点提示 / 多码展开）
const labelOf = parts.labelOf;
// 与 data 里的同名字段区分开：这里叫 roomNote，避免 setData 那行读起来像自赋值
const roomNote = parts.preselectNote;
const createLayoutMeter = parts.createLayoutMeter;
const buildCustomerOptions = parts.buildCustomerOptions;
const hasFormContent = parts.hasFormContent;
const stationBlurPatch = parts.stationBlurPatch;
// ② 内联新建（2026-09-25 范围扩展批）：开合 patch 与"读库 → 过闸 → 落库"的提交决议都在零件里
// （页面只转发事件 ⇒ 值域闸与落库口径都能被 `selftest` 直接钉住，见 TD-016）
const createSheetPatch = parts.createSheetPatch;
const submitCreateCustomer = parts.submitCreateCustomer;
const createSubmitPatch = parts.createSubmitPatch;   // 建档提交后的 data 与"要不要退"也在零件里定
// ③ 保存时的归类裁决（2026-09-25 交互改判）：常驻入口撤除、归属在保存那一刻才裁决 ⇒ 判据全在零件里
const intake = require('./intake-parts.js');
const resolveSaveTarget = intake.resolveSaveTarget;
const saveFlowPatch = intake.saveFlowPatch;
const commitSingleSave = intake.commitSingleSave;
const commitDraftsSave = intake.commitDraftsSave;
const screenOffer = intake.screenOffer;
// ④ 取会话键（2026-09-25 B 段 · 用户裁决「A：给清单动线也加取键能力」）：摘要入槽（全仓唯一写点）、
// 取键意图与草稿的跨页交接、三形态 url 轮盘全在零件里 —— 页面只并进它的两个方法
// （`Object.assign`，与档案页 `row-actions.js` 同一形态：处理器住零件才钉得住，页面层零断言 TD-016）
const sessionKeyFlow = require('./session-key-flow.js');
const shareFlow = require('./share-flow.js');   // ⑤ 转发：卡片是零件里的纯函数 `shareCard`（⛔ 零业务值，见 share-flow.js）
const recognizeFlow = require('./recognize-flow.js');   // ⑥ 取图 → 识别 那条链路（含第 2 件的"多选批次识别"）

Page(Object.assign({
  // 页面实例字段（刻意**不进 data**：它们不是渲染状态，进 data 就会被 setData 反复搬运）
  unloaded: false,     // 卸载后回调不许再 setData（小程序会报"操作已销毁的页面"）

  data: {
    customerId: '',
    targetLabel: '',
    customerLabels: [],
    customerOptions: [],
    preselectNote: '', // 会话预选的说明行（M7）；**文案里绝不出现 roomId 本身**（M11）
    notFound: false,
    banner: BANNER_WAITING,
    errorText: '',
    busy: false,        // 选图进行中（防重复触发系统面板）
    recognizing: false, // 识别进行中（VKSession 是页面单例，并发会互踩）
    saving: false,      // 防连点产生两条记录
    imagePath: '',
    lines: [],
    showLines: false,
    draft: { stationName: '', pickupCode: '', lockerNo: '', trackingTail: '' },
    drafts: [],
    draftsReady: 0,
    draftsNoCode: 0,
    recognitionUsed: false,
    stationNotice: '',
    // ② 内联新建客户浮层（2026-09-25 用户裁决）：开合只写这三个键 —— 见 `form-parts.createSheetPatch`，
    // 返回值里没有任何 `draft.*` ⇒ 浮层不可能碰掉已填的内容
    createOpen: false,
    createLine: '',
    createError: '',
    // ③ 交互改判（2026-09-25 真机第三轮）：常态**不再**有蓝色 CTA 与常驻建档按钮，占位文案由零件单源给出
    noTargetPlaceholder: parts.NO_TARGET_PLACEHOLDER,
    notFoundHint: '',
    // 保存时裁决为"要建档"时，浮层上要显示的理由与按钮字（挡板态另给「仍要新建」）
    createBlockedText: '',
    createDuplicate: false,
    createSubmitLabel: '建好了',
    // ④ 「去取会话键」那颗按钮的文案：**只在真的没有键时**由 `saveFlowPatch` 写上（⛔ 不常驻）
    createKeyActionText: '',
    // 点选清单：6 个正式取件点 / 内置 1~8 号柜（值域来自 utils/stations.js，页面不自己列）
    stationPoints: stations.listStationPoints(),
    // M14：中间可滚区的高度（px 字符串）。空串 = 还没量出来 ⇒ 交给 WXSS 的 `flex:1` 兜底，
    // 量出来之后写进 `style="height: …"`，`<scroll-view>` 才拿到教训卡要求的那个"确定高度"。
    midHeight: '',
    // 第一项「留空」是**给人点的意图出口**（我先不猜点），不是"允许空着入库"的口子：
    // 写盘前 `saveDrafts` 会按行拦下并指名第几件（R-01 方案①，库里 stationName 仍必填）
    rowStationPoints: ['（留空：到点问客户）'].concat(stations.listStationPoints()),
    lockerPoints: ['（不知道柜号）'].concat(stations.listLockerOptions())
  },

  onLoad(query) {
    const customers = this.refreshCustomers();
    // 摘要键优先、平台原值仅兼容（2026-09-25 范围扩展批）⇒ 两个槽分开读，并把"用了哪个"带到文案里
    const roomId = readRoomHint({ app: getApp() });
    const roomIdKind = readRoomHintKind({ app: getApp() });
    const hitId = roomPreselect(customers, roomId);
    const source = sourceOf(query);
    // ⛔ 会话键**不参与落值**（2026-09-25 真机反馈用户裁决「清单的录快件不应该默认绑定」）：
    //    只有档案页那一行显式带的 `customerId` 才作数；其余入口这一屏是空的，由人选或当场建。
    //    判据在 `form-parts.resolveTarget`（页面层零断言 TD-016 ⇒ 这条规则必须住在可断言的地方）。
    const targetId = resolveTarget(query, hitId).targetId;
    const label = labelOf(this.data.customerOptions, targetId);
    // 指定了客户但可选列表里没有（刚被删 / 参数写错）⇒ 给明确的失败态，
    // 不让人对着"给「」录快递"这种空标题猜（§11.4：错误信息要能指向根因）
    const notFound = !!targetId && !label;
    const offer = screenOffer({ notFound: notFound });
    this.setData({
      customerId: notFound ? '' : targetId,
      targetLabel: notFound ? '' : label,
      notFound: notFound,
      errorText: notFound ? reasonText('CUSTOMER_NOT_FOUND') : '',
      // ③ 占位文案与 `notFound` 说明都由零件单源给（wxml 只渲染 data）—— 文案与 UI 再分叉就会被 §14 判红
      noTargetPlaceholder: offer.noTargetPlaceholder,
      notFoundHint: offer.notFoundHint,
      // 命中说明里的标签取**命中者自己**的标签（不再拿"当前选中"的，两者已经不是同一个东西了）
      preselectNote: notFound ? '' : roomNote(roomId, hitId, labelOf(this.data.customerOptions, hitId), roomIdKind, source)
    });
    // ④ B 段：记下来源标记；若是"取键回来"（`?resume=1`）就把未完成的录件接回来（方法在 session-key-flow）
    this.applyResumeFromQuery(query);
    this.measureMid();
  },

  onReady() {
    // 首次布局完成后才能量到真实高度（早于此，boundingClientRect 拿到的全是 0）
    this.measureMid();
  },

  onResize() {
    // 诚实边界（r3 的 R3-11）：本项目 `app.json` 没开 `resizable` ⇒ 这条**基本不会触发**，
    // 留着是因为万一开了它，横竖屏切换正是"上区高度变了而中区还按旧值"的时刻。真正兜住失准的是
    // `setDataMeasured/showError/setBanner` 这三个出口（每次改写上区都重测）。
    this.measureMid();
  },

  /**
   * M14：把"中间还剩多少像素可滚"量出来，写成 `<scroll-view>` 的确定高度。
   * 调度、算式、取数全在 `form-parts.createLayoutMeter` —— R3-01 那条 P1 就长在调度里
   * （`wx.nextTick` 只推迟一个渲染周期，回调里再判一次同样的条件就成了无限自调度，
   * 而真正测量的那行永远到不了；`check.js` 只做语法、`selftest` 不 require 页面，两道门禁全看不见）。
   * 所以这里只留适配器。量不到就不写高度（退回 WXSS 的 `flex:1` 兜底）：写个错值比不写更糟。
   */
  measureMid() {
    if (!this.layoutMeter) {
      this.layoutMeter = createLayoutMeter({
        wxApi: typeof wx === 'undefined' ? null : wx,
        nextTick: typeof wx !== 'undefined' && typeof wx.nextTick === 'function' ? wx.nextTick : undefined,
        queryFactory: () => this.createSelectorQuery(),
        write: (px) => { if (px !== this.data.midHeight) this.setData({ midHeight: px }); },
        unloaded: () => this.unloaded
      });
    }
    this.layoutMeter.measure();
  },

  // 多键 setData 的出口：先写、后量（量的是新布局；在途闸门保证这不会变成循环 —— R3-01）
  setDataMeasured(patch) {
    this.setData(patch);
    this.measureMid();
  },

  // 上区（错误行 / banner）与预选说明任何一次改写都改变中区可用高 ⇒ 一律走这三个出口，
  // 别处不再手写 errorText/banner（R3-07：漏一处就潜伏一处"高度失准"）
  showError(text) { this.setDataMeasured({ errorText: text }); },
  setBanner(text) { this.setDataMeasured({ banner: text }); },

  // 读档案列表（选择区的数据源）。
  // ⚠️ **返回原始档案对象数组**、而不是派生出来的显示数组：会话归类要读 `chatRoomId` 字段，
  // 把 `{id,label}` 喂给 `pickCustomerByRoom` 它拿不到 chatRoomId ⇒ 永远"未命中"，
  // 表现是"预选从来不生效"这种没有报错的错。显示用的 options 只进 data。
  refreshCustomers() {
    const loaded = storage.listCustomers();
    if (!loaded.ok) {
      // 读库失败 ⇒ 归档数组必须跟着清空：否则保存时的归类裁决会拿**上一轮**的档案去命中（脏读数）
      this.customerList = [];
      this.setDataMeasured({ customerOptions: [], customerLabels: [], errorText: reasonText(loaded.reason) });
      return [];
    }
    const customers = aggregate.sortCustomers(loaded.customers);
    // 保存时的归类裁决要读 `chatRoomId`/`deletedAt` ⇒ 留**原始档案**在实例字段上（不是渲染状态，不进 data）
    this.customerList = customers;
    // 映射规则在 form-parts（可自测）；返回值刻意用**原始档案数组**给归类用，显示用的两份只进 data
    const view = buildCustomerOptions(customers);
    this.setData({
      customerOptions: view.options,
      customerLabels: view.labels
    });
    return customers;
  },

  // 换客户：手选**覆盖**预选（用户裁决：id 命中优先于人工记忆，但人始终可改）
  onPickCustomer(event) {
    const patch = intake.pickCustomerPatch(this.data.customerOptions[Number(event.detail.value)]);
    if (!patch) return;
    this.setData(patch);
    this.measureMid();  // 预选说明行在 .top 里 ⇒ 改写它就改变中区可用高（R3-07）
  },

  // ── 取图 → 识别 那条链路（2026-09-26 **整体搬去 `./recognize-flow.js`**）────────────────
  // 为什么搬：本文件当时正好 500/500 非空行（AGENTS §11.1 硬上限，TD-001 记着"下一次改动必须先搬迁"），
  // 而第 2 件「一次性多选多录入」要改的正是这一簇；搬进零件后处理器第一次有机器闸可钉（页面层零断言 TD-016）。
  // 那里面现在住着：`onChooseFromChat` / `onChooseFromAlbum` / `runRecognizePaths`（1 张走原路、≥2 张走批次）/
  // `runRecognize` / `startRecognize` / `startBatchRecognize` / `onRecognizeFailed` / `applyParse`。
  // ⛔ 别把任何一条再抄回本文件（那正是"规则两处实现"的入口）。


  // 一图多码（M8）的"每件一行 + 一键全存"补丁算法在 `form-parts.buildMultiPatch`；
  // 落库站点名只可能是 6 个正式名或空串（`parcel-drafts` 强制）⇒ 清单页的分组天然是"按取件点聚合"。
  // 判不出取件点的行只标 ❓，**不阻断保存**（用户裁决：猜点 = 可能跑错驿站，留空问一句更安全）。

  // ── 单条预填行的编辑 ──────────────────────────────────────────────
  onDraftInput(event) {
    const patch = {};
    patch['draft.' + event.currentTarget.dataset.field] = event.detail.value;
    this.setData(patch);
  },

  // 站点名失焦时归一化到正式名（用户 2026-09-21 裁决：命中就收敛，未命中允许自建）。
  // 为什么不在每次按键时替换：那会与打字抢（输入一半就被改掉 = 没法打字）。
  // 判据（两种文案 + 归一）在 `form-parts.stationBlurPatch`：页面层零断言，写这里等于没人看。
  onStationBlur() {
    this.setData(stationBlurPatch(this.data.draft.stationName));
  },

  // 单条行的"去哪取"点选（只给 6 个正式名：这一格是必填项，不给留空出口）
  onPickStationPoint(event) {
    const name = this.data.stationPoints[Number(event.detail.value)];
    if (name) this.setData({ 'draft.stationName': name, stationNotice: '' });
  },

  // 柜号点选：下标 0 = 「（不知道柜号）」→ 空串（空串 = 未知，是合法值）
  onPickLocker(event) {
    const name = this.data.lockerPoints[Number(event.detail.value)] || '';
    this.setData({ 'draft.lockerNo': name.indexOf('（') === 0 ? '' : name });
  },

  // ── 多码列表的行内编辑（不可变更新走 parcel-drafts.updateDraft，页面不自己改对象）──
  onRowCodeInput(event) {
    this.applyDraftList(parcelDrafts.updateDraft(this.data.drafts, event.currentTarget.dataset.key, {
      pickupCode: event.detail.value
    }));
  },

  onRowStationChange(event) {
    const name = this.data.rowStationPoints[Number(event.detail.value)] || '';
    this.applyDraftList(parcelDrafts.updateDraft(this.data.drafts, event.currentTarget.dataset.key, {
      stationName: name.indexOf('（') === 0 ? '' : name
    }));
  },

  onRowLockerChange(event) {
    const name = this.data.lockerPoints[Number(event.detail.value)] || '';
    this.applyDraftList(parcelDrafts.updateDraft(this.data.drafts, event.currentTarget.dataset.key, {
      lockerNo: name.indexOf('（') === 0 ? '' : name
    }));
  },

  // 列表变一次就把"存得下几行 / 几行还没码"重算一次：
  // 它决定提示行与按钮文案，算漏一次就会出现"按钮灰着但其实有码"（v1 24 审查 R-17 的同一族）
  applyDraftList(list) {
    this.setData(intake.draftListPatch(list));
  },

  onToggleLines() {
    this.setData({ showLines: !this.data.showLines });
  },

  // ── ② 内联新建客户（2026-09-25 交互改判：**只在保存时**触发；常态屏上不再有入口）──────────
  // ⚠️ 只写 create* 键 ⇒ 已填的站点/取件码/多码列表原样留着，"取消新建"也不会丢。
  //    裁决里那句"进入浮层前存草稿态、回来原样恢复"的实现方式就是**不动它**（快照反而多一处能写错）。
  onCreateLineInput(event) {
    this.setData({ createLine: event.detail.value, createError: '' });
  },

  // 取消建档（2026-09-25 裁决 A）：保存触发的这次 ⇒ 这件记到「未归类」（⛔ 不再丢掉）；否则只是关掉。
  onCreateCancel() {
    const wasSaving = this.createForSave === true;
    this.createForSave = false;
    if (!wasSaving) { this.setDataMeasured(createSheetPatch(false)); return; }
    const view = intake.cancelCreateView({ draft: this.data.draft, recognitionUsed: this.data.recognitionUsed, drafts: this.data.drafts }, storage);
    this.setDataMeasured(view.patch);
    if (view.back) this.finishSaved(view.notice);
  },

  // 一次输入完成两件事（2026-09-25 用户构想）：「只需要求输入类似 d3455 就能完成建档与快递码录入」。
  // 决议与落库全在 `form-parts.submitCreateCustomer`（页面层零断言 TD-016）；这里只转发 + 刷新列表取标签。
  onCreateSubmit() {
    this.createForSave = false;   // 提交即结束"这次保存要建档"的态；patch 里那三个键由零件复位
    const result = submitCreateCustomer(this.data.createLine, {
      storage: storage,
      // ⛔ 只取**摘要槽**（原值回落=假键、永远命不中，见 RCA_sessionkey.md）；取不到 ⇒ 空串，**键可选、照常建档**
      sessionKey: readSessionKey({ app: getApp() }),
      draft: this.data.draft,
      recognitionUsed: this.data.recognitionUsed,
      drafts: this.data.drafts
    });
    if (!result.ok) { this.setData({ createError: result.errorText }); return; }
    // 顺序要紧：新档案要先进可选列表（`refreshCustomers`），再按**新**列表取标签 —— 反了会取到空标签
    this.refreshCustomers();
    const view = createSubmitPatch(result, labelOf(this.data.customerOptions, result.customerId));
    this.setDataMeasured(view.patch);
    if (view.back) this.finishSaved(view.toast);   // 两件事都办完 ⇒ 报一句并退回清单
  },

  // ── 保存 ────────────────────────────────────────────────────────
  // 刻意**不用 disabled** 挡保存按钮：M6 的硬要求是"手输必须能存"。
  // 识别中确实不能写（同一条库、且识别结果马上要覆盖空框）⇒ 在函数里挡一下并说清为什么。
  onSave() {
    if (this.data.saving) return;
    if (this.data.recognizing) {
      this.showError('识别还没停 —— 稍等一下再存（你填的内容不会被覆盖）。');
      return;
    }
    // ③ 归属在**保存这一刻**裁决（2026-09-25 交互改判）：手选 > 会话键唯一命中 > 当场建档。
    //    优先级、挡板口径与文案全在 `intake-parts.resolveSaveTarget`（页面层零断言 TD-016 ⇒ 规则不许住这里）。
    const gate = resolveSaveTarget({
      pickedCustomerId: this.data.customerId,
      sessionKey: readRoomHint({ app: getApp() }),
      customers: this.customerList || [],
      pendingLine: this.data.createLine
    });
    const view = saveFlowPatch(gate, labelOf(this.data.customerOptions, gate.customerId));
    this.createForSave = view.kind === 'create';
    this.setDataMeasured(view.patch);
    if (view.kind === 'save') this.commitSave(gate.customerId);
  },

  // 归属定下来之后的落件分流（单条 / 一图多码）
  commitSave(customerId) {
    if (this.data.drafts.length > 1) { this.saveDrafts(customerId); return; }
    this.saveSingle(customerId);
  },

  // 三条拦空（站点 / 尾号位数 / 没码）+ 站点归一 + 尾号清洗 + 落库全在 `intake-parts`：
  // 它们是本页"存不进去"的全部理由，而页面层的分支没有任何门禁看着（TD-016）⇒ 搬进零件才钉得住。
  saveSingle(customerId) {
    const result = commitSingleSave({
      customerId: customerId,
      draft: this.data.draft,
      recognitionUsed: this.data.recognitionUsed,
      storage: storage
    });
    // 拦空与写盘失败都**不锁**保存按钮：人还看着这张表，让他改或自己决定退
    if (!result.ok) { this.showError(result.errorText); return; }
    this.setDataMeasured({ saving: true, errorText: '' });
    this.finishSaved('已保存 ' + result.created + ' 条');
  },

  // 一键全存（M8）：一次整键写 —— 要么全进、要么一条都不进（不存在半完成态）。
  // 拦空站点放在**写盘之前**（R-01，用户裁决方案①）：库里 `stationName` 是必填项（v1 语义，本批不动数据层），
  // 带着一行空站点去写 = 整批 `VALIDATION_FAILED`，那句报错既不说第几件、也不说怎么修 —— M8 直接失效。
  // 「（留空：到点问客户）」这个出口**保留**：它表达的是"我先不猜点"（猜错 = 跑错驿站，比多问一句贵），
  // 只是这个意图不许带着入库；判据与 `saveSingle` 同一条（站点名归一后为空），页面里只有一套空值口径。
  saveDrafts(customerId) {
    const result = commitDraftsSave({
      customerId: customerId,
      drafts: this.data.drafts,
      noCode: this.data.draftsNoCode,
      storage: storage
    });
    // 拦空（某行没选取件点 / 全都没码）与写盘失败都**不锁**按钮：人接着填完再点
    if (!result.ok) { this.showError(result.errorText); return; }
    this.setDataMeasured({ saving: true, errorText: '' });
    // 有行没码 → 如实说"哪几行没进去"，别让人以为全存了（不谎报是"禁止半完成态"的另一半）
    this.finishSaved(result.noCode > 0
      ? '已存 ' + result.created + ' 条，' + result.noCode + ' 行没码未存'
      : '已存 ' + result.created + ' 条');
  },

  // 站点名写盘前最后一次归一（识别预填与粘贴都会绕过失焦那条路）
  finishSaved(message) {
    wx.showToast({ title: message, icon: 'success' });
    // 提示窗口内**继续保持 saving**（R-03）：这一刻库已经写进去了，再点一次就是**第二条重复记录**，
    // 而本期没有删除入口（SCOPE W1）⇒ 只能改库。所以"能点"本身就是伤害，不是体验问题。
    this.setDataMeasured({ saving: true, errorText: '' });
    // 留出看提示的时间再退：退早了清单页 onShow 读库时人也来不及看这条提示
    this.backTimer = setTimeout(() => {
      this.backTimer = null;
      wx.navigateBack({
        // 退不掉（页面栈异常）时必须把锁放开，否则这一屏永远点不动保存 = 用一个 bug 盖住另一个
        fail: () => this.setDataMeasured({ saving: false, errorText: '退回上一页失败 —— 记录已经存好了，请手动返回。' })
      });
    }, 800);
  },

  onUnload() {
    // 定时器不在卸载时清掉 = 800ms 内被人用系统返回/滑动手势先退出去时，回调还在往已销毁的页面上 navigateBack（R-21）
    if (this.backTimer) {
      clearTimeout(this.backTimer);
      this.backTimer = null;
    }
    // R3-01：`measureMid` 的回调可能在销毁之后才回来（nextTick + 选择器都是异步的）
    // ⇒ 立 flag 让回调自己放弃，不给已销毁的页面 setData（在途闸门在 createLayoutMeter 里）
    this.unloaded = true;
  },

  onCancel() {
    wx.navigateBack();
  }
}, recognizeFlow.pageMethods, shareFlow.pageMethods, sessionKeyFlow.pageMethods));
