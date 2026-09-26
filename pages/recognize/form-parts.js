// pages/recognize/form-parts.js · 录入页的模块级零件（从 index.js 搬出来）
//
// 为什么单独一个文件：`index.js` 在修复批涨到 521 行，破了 AGENTS §11.1 的"单文件 ≤500"硬上限
// （报告 R2-C12，登记在 TD-001）。M14 的布局实测还要再加代码 ⇒ 先按"事件层 / 零件层"切开：
// 这里放**页面专用零件**，页面只留事件与渲染。刻意不叫 `utils/`：它是**本页专用**零件，
// 放进 utils/ 会伪装成公共能力（registry 里就得登记一个没人用的模块）。
// ⚠️ 说"纯"要说到做到（r3 的 R3-09 抓过我一次）：这里所有函数要么完全纯，
// 要么把平台/全局依赖做成参数注入（`windowInnerHeight({wxApi})`、`readRoomHint({app})`），
// 否则"拆文件换取可测性"这句话对那几个函数就是空话。唯一允许直连全局的是 `BANNER_*` 这类常量。
'use strict';

const aggregate = require('../../utils/aggregate.js');
const parcelDrafts = require('../../utils/parcel-drafts.js');
// ⚠️ `customer-input`（建档值域闸）随 ② 内联新建那一簇搬去了 `./intake-parts.js`，本文件不再 require
// （"规则只有一处实现"那条纪律不变：值域闸仍是 `utils/customer-input.js` 一份，⛔ 别在任何地方再造一份）。
const stations = require('../../utils/stations.js');
// ⛔ BUG-04（2026-09-26 修）：下面两件是 2026-09-25 把 `planParsePatch` 搬进本文件时**漏掉的依赖** —— `parse.parseParcelText*` 与 `reasonText` 当时两个名字都没绑定 ⇒ 只要识别出字就抛 `ReferenceError`（真机屏上 =「识别流程异常：Can't find variable: parse」），全部预填静默失效。
// ⚠️ 它当时躲过两道门禁：683 条断言对该函数 **0 条覆盖**（证据 `docs/specs/20260926_recognize_fix/`；旧注释那句"`reason.js` 随它搬去 `./create-parts.js`"指向的文件**从未存在过** = TD-028）。
// 纪律：**搬迁 = 连依赖一起搬**；新增或搬出的 export 必须有断言在跑它（TD-029）。⚠️ 本文件非空行贴 500 硬线 ⇒ 下一次改动要**先搬迁**。
const parse = require('../../utils/parse.js');     // `planParsePatch`：识别文字行 → 站点/码/柜号
const reason = require('../../utils/reason.js');   // `reasonText`：认不全时那句人话（⛔ 页面不自己拼文案）

// 上区那条"状态条"的两句初始文案。⚠️ 文案里不许出现 markdown 星号（报告 R2-C09：
// 屏上不是 README，`**本机**` 会原样印在手机上）—— 这条在 TD-011 里记着，随本次拆文件一并清。
const BANNER_WAITING = '选好截图后会在本机识别站点与取件码；认不出就直接手填，两种都能存。';
const BANNER_RECOGNIZING = '正在本机识别…（不上传、不联网）';

// 会话提示在页面之间的两个容器的键名。K5：**只活于内存**，
// 禁止进 URL query（会留在跳转历史与日志里）、禁止进 `note`、禁止落任何存储键。
// ⚠️ 2026-09-25 范围扩展批把它们**拆成两个槽**：`chatRoomId` 只放平台原值（仅 N2 老路写，兼容分支用）、
// `chatKey` 放 16 hex 本地摘要（新路径写）。拆开的理由：一个槽两种语义时，"这次比对用的是摘要还是原值"判不出来。
const ROOM_HINT_KEY = 'chatRoomId';
const KEY_HINT_KEY = 'chatKey';

// ⚠️ `cleanTail` / `normalizeStation` / `planSingleSave`（单条件的落件决议）已搬到 `./intake-parts.js`，
// 本文件只 re-export（定义留在两处 = 规则分叉，见教训卡 2026-09-11_规则与样例分叉）。

// 两个取图接口的字段名**不同**：`chooseMessageFile` 给 `path`、`chooseMedia` 给 `tempFilePath`。
// 归一成"一条本地临时路径"后，下面的识别链路只剩一条 —— 来源不同就不会导致降级口径不同（M6）。
function firstTempPath(res) {
  const files = (res && res.tempFiles) || [];
  for (const file of files) {
    const path = file && (file.path || file.tempFilePath);
    if (typeof path === 'string' && path) return path;
  }
  return '';
}

// 一次多选时的**全部**路径（2026-09-26 第 2 件「一次性多选多录入」）：与 `firstTempPath` 同一套字段归一，
// 只把"取第一条"换成"逐条收齐"。⚠️ 两条必须同口径 —— 漏一种字段名就会"单选能识别、多选少一张"，
// 所以取值表达式与上面逐字一致，⛔ 不另写一份判断。
function allTempPaths(res) {
  const files = (res && res.tempFiles) || [];
  const out = [];
  for (const file of files) {
    const path = file && (file.path || file.tempFilePath);
    if (typeof path === 'string' && path) out.push(path);
  }
  return out;
}

// 会话提示只从内存读。**优先级 = 摘要键 > 平台原值**（2026-09-25 范围扩展批用户裁决②：
// "摘要键为主、旧原值仅兼容；不命中一律不猜"）。两个都没有 ⇒ 空串 ⇒ M7 的"未命中"分支。
// @param {{app?:object}} [deps] R3-09：`getApp()` 也不直连——缺省才回落到全局（页面传 `getApp()` 进来）
function readRoomHint(deps) {
  const bag = hintBag(deps);
  const key = bag ? bag[KEY_HINT_KEY] : '';
  if (typeof key === 'string' && key) return key;
  const room = bag ? bag[ROOM_HINT_KEY] : '';
  return typeof room === 'string' ? room : '';
}

// 这次拿到的提示**来自哪个槽**（`'chatKey' | 'chatRoomId' | ''`）：预选文案要说清"按会话键"还是
// "按旧口径的会话标识" —— 两种来源的可核对性不同，不说明的话人没法判断这条预选可不可信。
function readRoomHintKind(deps) {
  const bag = hintBag(deps);
  const key = bag ? bag[KEY_HINT_KEY] : '';
  if (typeof key === 'string' && key) return 'chatKey';
  const room = bag ? bag[ROOM_HINT_KEY] : '';
  return typeof room === 'string' && room ? 'chatRoomId' : '';
}

// 会话**摘要槽**的专用读取（2026-09-25 BUG 会话键修复）：只认 `chatKey`，⛔ **不回落到平台原值槽**。
// 为什么"建档"必须用它、而不是上面的 `readRoomHint`（两条路的差别是刻意的，不是漏改）：
//   ① 页面原注释（今 `pages/recognize/index.js` 建档处）写的是"只取摘要槽"，而 `readRoomHint` 带原值回落
//      ⇒ 代码与注释分叉，且会把**平台原值**绑成新档案的键；
//   ② 归类比对（`intake-parts.keyHits` / `aggregate.pickCustomerByRoom`）比的是**摘要**
//      ⇒ 绑了原值等于**假键**："档案上看起来有键，却永远匹配不上任何会话"。
//      空键至少会被 `resolveSaveTarget` 判成 `NO_KEY` 而当场建档；假键是**静默不生效**，比空键更坏。
// 原值槽仍由 `readRoomHint` 供"归类比对"的兼容分支用（用户裁决②：摘要为主、旧原值仅兼容）。
// @param {{app?:object}} [deps] 同 `readRoomHint`（注入优先，缺省回落 `getApp()`）
// @returns {string} 摘要键；槽为空 / 类型不对 ⇒ 空串（⛔ 不吐 undefined，也不去读原值槽）
function readSessionKey(deps) {
  const bag = hintBag(deps);
  const key = bag ? bag[KEY_HINT_KEY] : '';
  return typeof key === 'string' ? key : '';
}

// 取 globalData 袋子（注入优先、缺省回落全局 `getApp()`）——上面几条共用，避免回落逻辑写两遍
function hintBag(deps) {
  const injected = deps || {};
  const app = injected.app !== undefined ? injected.app : (typeof getApp === 'function' ? getApp() : null);
  return app && app.globalData ? app.globalData : null;
}

// 归类规则只允许有一处实现（ARCHITECTURE §2.3）⇒ 页面**不自己比对 chatRoomId**，
// 一律调 `aggregate.pickCustomerByRoom`。返回非字符串一律按未命中处理：宁可不猜。
function roomPreselect(customers, roomId) {
  if (!roomId) return '';
  const hit = aggregate.pickCustomerByRoom(customers, roomId);
  return typeof hit === 'string' ? hit : '';
}

/**
 * 这一屏**从哪进来的**（`'list'` = 取件清单的「＋ 录快件」，其余 = 档案页那一行进来的）。
 * 来源决定要不要显示会话命中说明（用户 2026-09-25 裁决：「清单的录快件不应该默认绑定」）。
 * @param {object} [query] 页面 `onLoad` 的 query
 * @returns {'list'|'customer'} 缺省 `'customer'`（档案行入口本来就会带 `customerId`）
 */
function sourceOf(query) {
  return query && query.from === 'list' ? 'list' : 'customer';
}

/**
 * 「给谁录」这一屏的落值 —— **A 条 P1 的机器闸**。2026-09-25 用户裁决：会话键不再自动绑定客户，
 * 只有上游显式给的 `customerId`（档案页那行「＋ 录快件」）才作数；清单等入口一律留空由人选。
 * ⛔ `hitId` 刻意不参与（加回来 = 回到"手选却被锁回前一个"）；它只去 `preselectNote` 当说明。
 * @param {object} [query] `onLoad` 的 query ｜ @param {string} [hitId] 命中的档案 id（仅说明用）
 * @returns {{targetId:string, boundBySession:boolean}} `boundBySession` 恒 `false`
 */
function resolveTarget(query, hitId) {
  const explicit = query && typeof query.customerId === 'string' ? query.customerId : '';
  return { targetId: explicit, boundBySession: false };
}

// 可滚区的最小高度（px）：宁可上面那条占满，也不给中区留一条缝 —— 缝里既看不见格子也点不到 picker。
const MIN_MID_PX = 160;

/**
 * 窗口可用高度（px）。`getWindowInfo` 是新接口、`getSystemInfoSync` 已废弃但老基础库只有它 ⇒ 两个都试。
 * @param {{wxApi?:object}} [deps] **依赖注入**（R3-09：本函数原先直连全局 `wx`，
 *   于是"拆文件换取可测性"的收益对它为零 —— 自测根本没法喂给它一个假的窗口高）
 * @returns {number} 读不到就返回 0，由调用方决定"不写高度"（不猜一个数）
 */
function windowInnerHeight(deps) {
  const api = (deps && deps.wxApi) || (typeof wx === 'undefined' ? null : wx);
  if (!api) return 0;
  if (typeof api.getWindowInfo === 'function') {
    const info = api.getWindowInfo();
    if (info && info.windowHeight) return info.windowHeight;
  }
  if (typeof api.getSystemInfoSync === 'function') {
    const legacy = api.getSystemInfoSync();
    if (legacy && legacy.windowHeight) return legacy.windowHeight;
  }
  return 0;
}

/**
 * M14：从"窗口高 / 上区高 / 操作栏高"算出可滚区应有的确定高度。
 * 抽成纯函数的理由（R3-01 的教训）：这条算式原来嵌在 `measureMid` 的调度逻辑里，
 * 而调度一旦写错（就是那条 P1：自调度无限循环），算式再对也从不执行，且两道门禁都看不见。
 * 把算式与调度分开，算式就能在 `tools/selftest.js` 里被直接钉住。
 * @param {number} totalPx 窗口可用高
 * @param {number} topPx 上区实测高（null/undefined 按 0：条件块没渲染时节点不存在）
 * @param {number} actionsPx 底部操作栏实测高
 * @returns {{ok:boolean, px:number, why:string}} 不可写时 `ok:false` 并带原因（给屏上读数用）
 */
function computeMidHeight(totalPx, topPx, actionsPx) {
  const total = Number(totalPx) || 0;
  if (!total) return { ok: false, px: 0, why: '读不到窗口高度' };
  const mid = Math.round(total - (Number(topPx) || 0) - (Number(actionsPx) || 0));
  // 上区把屏占满属异常布局：写进去就是"中区塌成一条缝，看不见也没法滑"⇒ 宁可不写，退回 CSS flex
  if (mid < MIN_MID_PX) return { ok: false, px: mid, why: '算出来只有 ' + mid + ' 像素，低于下限 ' + MIN_MID_PX };
  return { ok: true, px: mid, why: '' };
}

// 换一张图 = 全部复位。为什么必须显式清：只往空框里填是本页的规矩，
// 带着上一张的值会让预填失效；留着上一张的多码列表会让人存错件。
function freshForm() {
  return {
    imagePath: '',
    lines: [],
    showLines: false,
    drafts: [],
    draftsReady: 0,
    draftsNoCode: 0,
    draft: { stationName: '', pickupCode: '', lockerNo: '', trackingTail: '' },
    stationNotice: '',
    // 站点那句"没认出来"的**唯一存放处**（`stationMissedHint` 的产物）；wxml 用 `!draft.stationName` 守卫
    stationHint: '',
    errorText: '',
    // 每张图重新判一次"这次到底采没采信识别结果"：不清零会让下一张全手打的记录被记成 ocr（统计说谎）
    recognitionUsed: false
  };
}

/**
 * 从可选项里取显示标签（选不到就是空串，页面据此判"上游指定的客户还在不在"）。
 */
function labelOf(options, id) {
  if (!id) return '';
  const hit = (options || []).filter((option) => option.id === id)[0];
  return hit ? hit.label : '';
}

/**
 * 预选说明行（M7 判据：命中就写依据，没命中就明说"不猜"）。⛔ 文案里不许出现 roomId 本身（M11/D3）。
 * @param {string} roomId 会话提示（摘要键优先，见 `readRoomHint`；空串 = 不是从会话进来的）
 * @param {string} hitId `aggregate.pickCustomerByRoom` 的结果（'' = 零命中或多命中）
 * @param {string} label 命中档案的显示标签（空串 = 命中了但列表里找不到它）｜@param {string} [kind] 命中依据来自哪个槽
 */
function preselectNote(roomId, hitId, label, kind, source) {
  // 清单入口**不谈会话**（那句话正是用户报的"锁回"错觉来源）；⛔ 文案里不许出现 roomId 本身（M11/D3）
  if (source === 'list') return '';
  if (!roomId) return '';
  const head = kind === 'chatRoomId' ? '这条会话（按旧口径的会话标识）' : '这条会话（按会话键）';
  if (hitId && label) {
    // 裁决之后**不再自动选中** ⇒ 必须说清"系统没替你选、要按会话归类怎么走"，否则读起来像"已经锁给这位了"
    return head + '只对上 ' + label + ' —— 系统不会替你选。要按会话归类，就从「用户档案」那一行点「＋ 录快件」进来。';
  }
  if (hitId) return head + '命中了档案，但它不在可选列表里 —— 请重选';
  return '这条会话没有唯一对上某个档案 —— 系统不猜，请手选客户';
}

/**
 * M14 的"量高度"调度器（把调度从页面里拿出来，是因为 R3-01 那条 P1 就长在调度里）。
 *
 * 页面原来的写法是 `if (wx.nextTick) { wx.nextTick(() => this.measureMid()); return; }` ——
 * `wx.nextTick` 只推迟一个渲染周期，回调里那个条件**依然成立** ⇒ 自己排给自己 = 无限循环，
 * 真正测量的那行永远到不了；`check.js` 只做语法、`selftest` 不 require 页面，两道门禁全看不见。
 * 所以这里把两条不变量做成**可断言的对象**：① 同一时刻只有一个在途 ② 回调之后闸门必须释放
 * （否则第二次改布局就再也量不到了 —— 那是另一种静默失效）。
 *
 * @param {{
 *   wxApi?:object,
 *   nextTick?:function,
 *   queryFactory:function,  // () => createSelectorQuery()：由页面给，取数过程也归到这里
 *   write:function,         // (pxString) => void：写进 data
 *   unloaded?:function
 * }} deps 全部注入，页面只留适配器
 * @returns {{measure:function, pendingCount:function}}
 */
function createLayoutMeter(deps) {
  const injected = deps || {};
  const nextTick = typeof injected.nextTick === 'function' ? injected.nextTick : (fn) => fn();
  let inFlight = 0;
  // 上区与操作栏的自然高度：节点没渲染就是 0，返回 null 表示"读不到"（此时宁可不写）
  const readBoxes = (callback) => {
    const query = injected.queryFactory();
    query.select('.top').boundingClientRect();
    query.select('.actions').boundingClientRect();
    query.exec((res) => {
      if (!Array.isArray(res)) { callback(null); return; }
      callback({
        top: res[0] && res[0].height ? res[0].height : 0,
        actions: res[1] && res[1].height ? res[1].height : 0
      });
    });
  };
  return {
    pendingCount: () => inFlight,
    measure: function measure() {
      if (inFlight > 0) return;              // ① 在途闸门：这就是 R3-01 缺的那一行
      inFlight += 1;
      nextTick(() => {
        readBoxes((boxes) => {
          inFlight -= 1;                     // ② 无论写不写，闸门都要释放
          if (!boxes) return;
          if (typeof injected.unloaded === 'function' && injected.unloaded()) return;
          const total = windowInnerHeight({ wxApi: injected.wxApi });
          const result = computeMidHeight(total, boxes.top, boxes.actions);
          if (!result.ok) return;            // 量不到就不写：让 CSS 的 flex 兜底，别写一个错值
          injected.write(result.px + 'px');
        });
      });
    }
  };
}

/**
 * 客户选择区的数据源（纯映射）。⚠️ 关键形状约定：喂给 `roomPreselect` 的必须是**原始档案对象数组**
 * （要读 `chatRoomId`），而这个函数产出的是**显示用**的 `{id,label}` —— 把后者喂给归类函数，
 * 它拿不到 `chatRoomId` ⇒ 永远"未命中"，表现是"预选从来不生效"这种没有报错的错（页面注释里踩过一次）。
 * 标签口径与档案页一致：楼栋 宿舍 在前、称呼在后；库里仍是三个独立字段，这里只是给人认。
 * @param {Array<{id:string,building:string,dorm:string,name:string}>} customers 已排序的原始档案
 * @returns {{options:Array<{id:string,label:string}>, labels:string[]}}
 */
/**
 * 客户标签的**单源**在 `utils/aggregate.js` 的 `customerLabel`（2026-09-25 从本文件提升上去：
 * 档案页另有 4 处同款拼法，跨页共用只能有一个实现，见 AGENTS §2.2 禁平行新建）。
 * 这里只做 **re-export**：本页既有调用方与断言（`标签④~⑧`）逐条不用改，⛔ 不许在本文件再写一份实现。
 */
const customerLabel = aggregate.customerLabel;

function buildCustomerOptions(customers) {
  const list = Array.isArray(customers) ? customers : [];
  const options = list.map((customer) => ({
    id: customer.id,
    label: customerLabel(customer)   // 标签口径只在 customerLabel 里一处，⛔ 别在这里再拼
  }));
  return { options: options, labels: options.map((option) => option.label) };
}

/**
 * 这一屏有没有内容？（决定换图前要不要先让人确认，R-04）
 * 只看得了两类：多码列表有没有行、单条四格有没有非空值。
 */
function hasFormContent(drafts, draft) {
  if (Array.isArray(drafts) && drafts.length > 0) return true;
  const row = draft || {};
  return ['stationName', 'pickupCode', 'lockerNo', 'trackingTail']
    .some((field) => String(row[field] || '').trim() !== '');
}

// ⚠️ 站点名归一的**唯一实现**仍是 `utils/stations.matchBuiltinStation`：`normalizeStation`（决定写盘值）
// 与 `planSingleSave` 一起住在 `./intake-parts.js`（本文件只 re-export）。

// ── ① 识别结果 → 页面补丁（2026-09-26 **整体搬到 `./parse-patch.js`**）────────────────
// ⚠️ 为什么搬：本文件非空行已 **500/500**（AGENTS §11.1 硬上限），而下一批要改的正是这一簇 ⇒
// 按项目既有做法**先搬迁再改**（同 `intake-parts` / `session-key-flow` 先例）。
// ⛔ 搬迁纪律（本项目因反例付过代价）：**搬函数必须连依赖一起搬** —— 这次是把 `parse` / `reason`
// 两个 require 一起搬走的（BUG-04 就是漏了这一步）；本文件替它们 re-export，调用方与断言逐条不用改。
const parsePatch = require('./parse-patch.js');
const fillFromParse = parsePatch.fillFromParse;
const stationMissedHint = parsePatch.stationMissedHint;
const buildMultiPatch = parsePatch.buildMultiPatch;
const stationPrefill = parsePatch.stationPrefill;
const stationPrefillFromTexts = parsePatch.stationPrefillFromTexts;
const planParsePatch = parsePatch.planParsePatch;

// ── ② 落件决议 + 内联新建客户（2026-09-25 **整体搬到 `./intake-parts.js`**）────────────
// ⚠️ 为什么搬：「一次输入完成两件事」那一批把本文件顶到 563 行，破了 AGENTS §11.1 的单文件 ≤500 ⇒
// 按项目既有做法**先搬迁再改**（不压注释、不删 Why）。搬出去的是内聚的一簇：
// `cleanTail`/`normalizeStation`/`planSingleSave`（单条件的落件决议）+ 开浮层补丁 / 一行过闸 /
// 建完顺手落件 / 提交决议（内联新建全过程）。
// ⚠️ 依赖必须是**单向边**（本文件 → intake-parts；intake-parts **不** require 本文件）：写反了会拿到
// "还没填完的 exports"（本文件末尾是整对象替换）⇒ 运行时 `planSingleSave is not a function`，
// 这个错已被"期望值闸"当场抓过一次（只跑到 346 条，预期 547）。
// 这里只 **re-export**：既有断言（`保存决议①~④` / `内联新建①~⑤`）与页面调用方逐条不用改。
const intake = require('./intake-parts.js');
const cleanTail = intake.cleanTail;
const normalizeStation = intake.normalizeStation;
const planSingleSave = intake.planSingleSave;
const createSheetPatch = intake.createSheetPatch;
const createCustomerDraft = intake.createCustomerDraft;
const submitCreateCustomer = intake.submitCreateCustomer;
const createSubmitPatch = intake.createSubmitPatch;
// 「未选中客户时这一屏该提供什么」的单源裁决（占位文案 + `notFound` 说明）：B 条第二次真机失败后
// 从页面搬进零件；2026-09-25 交互改判后**常驻入口撤除**，它只剩"文案与 UI 同源"这一件事。
// ⛔ 旧的 `INTAKE_NO_TARGET_TEXT`（那句"点「＋ 新建客户」"）已随入口一起删除：文案不许再指着不存在的按钮。
const screenOffer = intake.screenOffer;
// ③ 占位文案也 re-export（页面 data 从这里取）：`intake-parts` 是唯一定义处，本文件只透传 ——
// 漏了这一行时页面拿到 `undefined`，屏上会是一片空白而不是"暂无客户"（§13 常态① 会判红）
const NO_TARGET_PLACEHOLDER = intake.NO_TARGET_PLACEHOLDER;

/**
 * 站点名**失焦**时要写的 data patch（站点归一只允许一处实现，与 `stationPrefill` 同一张表）。
 * 两种文案刻意不同：识别回填时说"已命中内置站点"（③ 裁决用词），人手打后失焦说"已归到正式名"
 * —— 同一件事在两条动线上"是不是系统替我改的"含义不同，文案不合并。
 * @returns {{'draft.stationName':string, stationNotice:string}}
 */
function stationBlurPatch(raw) {
  const text = String(raw === undefined || raw === null ? '' : raw);
  const hit = stations.matchBuiltinStation(text);
  return {
    'draft.stationName': hit.ok ? hit.stationName : text,
    stationNotice: hit.ok ? '已归到正式名：' + hit.stationName
      : (text.trim() ? '新站点：保存后会出现在清单的分组里' : '')
  };
}

// ⚠️ `planSingleSave`（含 `normalizeStation` / `cleanTail`）已搬到 `./intake-parts.js`，本文件只 re-export；
// 三条拦空文案与站点归一的单源都在那边（⛔ 别在这里再写一份 —— 同一个规则两处实现正是本页最贵的错之一）。

module.exports = {
  customerLabel,
  buildCustomerOptions,
  hasFormContent,
  normalizeStation,
  stationPrefill,
  stationBlurPatch,
  planSingleSave,
  submitCreateCustomer,
  createSubmitPatch,
  screenOffer,
  NO_TARGET_PLACEHOLDER,
  planParsePatch,
  createSheetPatch,
  createCustomerDraft,
  labelOf,
  sourceOf,
  resolveTarget,
  stationPrefillFromTexts,
  stationMissedHint,
  preselectNote,
  BANNER_WAITING,
  BANNER_RECOGNIZING,
  MIN_MID_PX,
  windowInnerHeight,
  cleanTail,
  firstTempPath,
  allTempPaths,
  readRoomHint,
  readRoomHintKind,
  readSessionKey,   // 摘要槽专用（建档绑键用）；`readRoomHint` 是"分类比对可用兼容原值"的那一个
  roomPreselect,
  freshForm,
  fillFromParse,
  buildMultiPatch,
  computeMidHeight,
  createLayoutMeter
};
