// pages/archive-list/sheet-flow.js · 本页专用零件：**建档浮层的纯逻辑与上屏文案**（不是跨模块契约）
//
// 为什么单独成文件（三条都是 24 卡 `CODE_20260925_pick_friend.md` 点出来的）：
//   ① **R-01（P1）**：会话键在"换绑"之后残留在页面实例字段里，会被下一次**降级建档**写进第二条档案
//      ⇒ 破"一个键最多一条档案"这条 M5 的核心不变量。而 `selftest` 不 `require` 页面（TD-016）⇒
//      把"保存时该用哪个键"抽到这里：它是这条动线上**唯一**能被打断言的形状。
//   ② **R-11（P3）**：`onSheetSave` 76 行 > AGENTS §11.1 的 50 行；键决议、值域闸与三段上屏文案
//      拆出来后，页面回到线内、且这些规则第一次有断言。
//   ③ **R-03（P2）**：N2 老路的取证读数行（U-5 的现场）以前整段住在页面里 ⇒ "原文必须脱敏后才上屏"
//      这条 D3 纪律只能靠人看。`describeLegacyPickup` 把它变成可断言的东西。
//   ④ **R-14（P2，24 卡 r2）**：两条上屏路（老路／"拉起好友列表失败"路）**必须共用同一份脱敏器**——
//      原先各写各的，而老路在 `roomId === ''` 时 `maskRoomIds` 是恒等函数 ⇒ 平台原文里的会话标识原样上屏。
//      ⚠️ 同轮 **R-18** 的事实订正：r2 的变异 M5b（把老路三处 `maskRoomIds` 整段摘掉）**全绿** ⇒
//      本文件原先那句"调用点漏掉即判红"的自述不成立。本批补了**直接断言 `describeLegacyPickup` 输出**
//      的用例（见 `selftest` §11b 的"老路⑤/⑥"），调用点这才真的有牙。
// 刻意**不放 `utils/`**：放进 utils 会被当成公共能力（还得为它登记契约），这些函数只服务本页
// —— 与 `pages/recognize/form-parts.js` 同一条落点纪律（ARCHITECTURE §3）。
'use strict';

const aggregate = require('../../utils/aggregate.js');   // 客户标签单源（2026-09-25 同族 4 处收口）
const reason = require('../../utils/reason.js');

// ── 会话键：一次性令牌 ───────────────────────────────────────────────
// 语义：**写一次、读一次、读完即清**。"清"不是防御性代码，是接口语义 —— 残留就是 R-01 的病根
// （复现读数：换绑冲突后键仍在页面字段里，下一次降级建档把同一把键写进第二条档案 ⇒ 库里两条同键）。
function createKeyToken() {
  let pending = '';
  return {
    /** 写：非字符串一律当"没有"（键只会来自 `pairKeyOf` 的 hex，类型错了就不该被采纳） */
    set(value) { pending = typeof value === 'string' ? value : ''; },
    clear() { pending = ''; },
    peek() { return pending; },
    /** 读一次就拿走：第二次调用必定拿到 `''`（"槽被清空"那条断言靠它） */
    take() { const out = pending; pending = ''; return out; }
  };
}

/**
 * 保存时该用哪个键（纯函数；**R-01 的治根点**）
 * @param {{take:function}} token 一次性令牌（`createKeyToken()` 的产物）
 * @param {boolean} fromChatFlow 本次浮层是不是由"会话选择那条路"打开的
 * @param {string} platformRoomId **这一轮**的平台原值（DESIGN §10 待裁② = A：两种语义共存）
 *   ⚠️ 第三参的语义是"**这一轮**可用的原值"，不是"这台设备上最后一次拿到的原值"——页面必须在
 *   每一轮结束时（`abandonKey()`）把它清掉，否则上一轮的原值会被写进这一轮的新档案（24 卡 r2 的 R-16）。
 * @returns {{key:string, source:'token'|'platform'|'degraded'|'none'}}
 *   ⛔ `fromChatFlow === false` ⇒ **结构上拿不到键**：降级建档、换绑之后的残留、以及"上一轮
 *   会话没走完就改了主意"这三种情况一律落在这里 —— 这是 R-01 的硬约束，不是防御性分支。
 */
function resolveChatKeyForSave(token, fromChatFlow, platformRoomId) {
  const taken = token && typeof token.take === 'function' ? token.take() : '';
  if (!fromChatFlow) return { key: '', source: 'degraded' };
  if (taken) return { key: taken, source: 'token' };
  const fallback = typeof platformRoomId === 'string' ? platformRoomId : '';
  if (fallback) return { key: fallback, source: 'platform' };
  return { key: '', source: 'none' };
}

// ── 浮层表单：值域闸 ────────────────────────────────────────────────
/**
 * 三格手改后的值域闸（从 `onSheetSave` 抽出来的那一段；规则仍只认 `utils/buildings.js` 一份）
 * 为什么必须再跑一次闸：`splitCustomerLine` 只在整行输入那一刻跑，三格被手改之后的值不再经过它，
 * 而库里 `migrate` 只卡长度不卡值域 ⇒ 不补这道闸就能建出 `E99`/`D11`/宿舍号 99 这种"存得进、清单读不懂"的档案。
 * @param {{building?:string, dorm?:string}} form 三格（只用到楼栋与宿舍号）
 * @param {object} buildingsLib `utils/buildings.js`（**注入**，便于纯函数测试）
 * @returns {{ok:true, building:string, dorm:string}|{ok:false, reason?:string, message?:string}}
 *   `reason` = 单源 error 码（页面用 `reasonText` 翻译）；`message` = 需要带用户原话的句子
 */
function gateSheetForm(form, buildingsLib) {
  const building = form && typeof form.building === 'string' ? form.building : '';
  const dorm = form && typeof form.dorm === 'string' ? form.dorm : '';
  if (!building || !dorm) return { ok: false, message: '楼栋和宿舍号都要有 —— 照「D4-522」写' };
  const rawBuilding = building.trim();
  const rawDorm = dorm.trim();
  const gated = buildingsLib.parseRoomLine(rawBuilding + '-' + rawDorm);
  if (!gated.ok) return { ok: false, reason: gated.reason };
  // R2-C02：`parseRoomLine` 是**整行解析器**，拿它当字段闸会替用户改数据（`D4` + `522A` 会把 `A` 当称呼
  // 静默丢掉、`0522` 会被剥前导零）⇒ 唯一允许的改写是大小写规范（`d4`→`D4`），其余必须逐字相同。
  if (gated.building !== rawBuilding.toUpperCase() || gated.dorm !== rawDorm) {
    return {
      ok: false,
      message: '楼栋/宿舍号里有多余内容 —— 系统读到的是「' + gated.building + '」+「' + gated.dorm
        + '」，与你写的「' + rawBuilding + '」+「' + rawDorm + '」不一样。请照「D4-522」写。'
    };
  }
  return { ok: true, building: gated.building, dorm: gated.dorm };
}

// ── 三段上屏文案（页面只负责 setData；拼装规则全在这里，D3 纪律因此可断言）──────
/**
 * 键命中/未命中时，浮层顶部那两行该说什么（pick_friend M5）
 * ⛔ 只出**指纹**与**锚**（楼区/宿舍/称呼），绝不出键原值 —— 这是 D3 纪律在页面上的落点。
 * @param {string} printed 键的指纹（`chatTool.fingerprint(key)` 的产物）
 * @param {object|null} dup 命中到的档案（`findCustomerByChatKey` 的 customer），未命中传 null
 * @returns {{dup:boolean, label:string, chatState:string, chatEvidence:string, sheetDupText:string}}
 */
function describeSessionKey(printed, dup) {
  if (dup) {
    const label = aggregate.customerLabel(dup);   // 单源：⛔ 别在本文件再拼一次（空称呼派生名会重复）
    return {
      dup: true,
      label: label,
      chatState: '这条会话已经建过档案了，先别急着再建一条。',
      chatEvidence: 'reason=OK ｜ 会话键指纹=' + printed + ' ｜ 命中已有档案',
      sheetDupText: '这条会话已建档：' + label
        + '。看它点「去这条档案」；确实要另建一条点「仍要新建」——新建的这条不带会话键（键仍留在原档案）。'
    };
  }
  return {
    dup: false,
    label: '',
    chatState: '已绑定这条会话（指纹 ' + printed + '）—— 建好后这个客户的快递会按它自动归类。',
    chatEvidence: 'reason=OK ｜ 会话键指纹=' + printed + ' ｜ 来源=双方成员标识（明文通道）',
    sheetDupText: ''
  };
}

/**
 * 换绑的三种结局各说一句什么（pick_friend M7 / 批 3）
 * 冲突时带上**持有者的锚 + 是否已删除**（页面才说得清"列表里找不到它"），⛔ 不出键原值。
 * @param {{ok:boolean, unchanged?:boolean, reason?:string, detail?:string, holder?:object}} outcome `rebindCustomerChatKey` 的返回
 * @param {{label:string}} target 换绑目标（锚，用于说人话）
 * @param {string} printed 新键的指纹
 * @returns {string} 顶部提示条文案
 */
function describeRebindNotice(outcome, target, printed) {
  if (outcome.ok) {
    return '换绑好了：「' + target.label + '」现在跟着这条会话（指纹 ' + printed + '）。'
      + (outcome.unchanged ? '本来就是它，没有改动。' : '');
  }
  if (outcome.reason === 'REBIND_CONFLICT') {
    const holder = outcome.holder || {};
    const who = aggregate.customerLabel(holder)
      + (holder.deleted ? '（那条档案已删除）' : '');
    return reason.failureText('REBIND_CONFLICT', '已属于「' + who + '」，指纹 ' + printed);
  }
  return '换绑没成功：' + reason.failureText(outcome.reason, outcome.detail) + '（指纹 ' + printed + '）';
}

/**
 * 内存桥里的包该走哪条路（**R-03 的判据**；24 卡 r2 的变异 M4 证明它必须可断言）
 * 为什么不是"有没有 `members` 键"：分包页 `writePickup` 的 base 模板**恒含** `members`（最差是 null）
 * ⇒ 用键判存在会让老路（连同 U-5 的屏上取证读数行）在生产上**永远不可达**。判"值是不是数组"才对。
 * @param {object|null} packet 内存桥的原样包
 * @returns {'key'|'legacy'} 有双方 id 数组 ⇒ 走会话键路；否则走 N2 老路（`getChatToolInfo` 三态）
 */
function pickupPathOf(packet) {
  const info = packet && typeof packet === 'object' ? packet : null;
  return info && Array.isArray(info.members) ? 'key' : 'legacy';
}

/**
 * N2 老路（`getChatToolInfo` 的三态，U-5 的现场）：把原样返回整理成**上屏用的两行**
 * 为什么放这里：① 页面少四十行 ② "平台原文必须脱敏后才上屏"这条纪律第一次能被打断言。
 * ⚠️ **R-18 的事实订正**：原先这里写着"`maskRoomIds` 一旦被漏掉，断言会当场判红"——r2 的变异 M5b
 * （把下面三处调用整段摘掉）实测**全绿**，说明当时有牙的只是 `maskRoomIds` 自己的单测，**调用点零覆盖**。
 * 本批补了直接断言本函数**输出**的用例（含"`roomId` 为空 + 原文里夹带长 id"这条 R-14 的现场）。
 * @param {{info?:object, infoErr?:string, bindErr?:string}} packet 内存桥的原样包
 * @param {object} chatTool `utils/chat-tool.js`（注入，便于纯函数测试）
 * @returns {{roomId:string, stateText:string, evidence:string}}
 */
function describeLegacyPickup(packet, chatTool) {
  const read = packet.info
    ? chatTool.readThreeStates(packet.info)
    : {
      ok: false,
      reason: 'CHAT_ID_UNAVAILABLE',
      detail: packet.infoErr || '分包页没拿到会话返回',
      rawKeys: ''
    };
  const mode = chatTool.modeSnapshot({});
  const roomId = read.ok ? read.roomId : '';
  let stateText;
  if (read.ok) {
    stateText = '已绑定当前会话（指纹 ' + chatTool.fingerprint(roomId) + '）—— 建好后这个客户的快递会按它自动归类。';
  } else {
    stateText = reason.reasonText(read.reason) + '（不影响建档；只是"按会话自动选客户"对它不生效）';
    if (packet.bindErr) stateText += '；绑定那一步：' + reason.reasonText(chatTool.failureReasonOf(packet.bindErr));
  }
  // 取证读数行：reason + 平台原文 + 真实返回字段名，**全部走共用脱敏器**才上屏（R-14：两条路同一份）。
  // 为什么还留着原文：U-5 的判读全靠它（字段到底叫什么、给没给，是唯一的裁决依据）。
  const parts = ['reason=' + (read.reason || 'OK')];
  const pushText = (label, text) => {
    const masked = redactEvidence(text, [roomId], chatTool);
    parts.push(label + (masked === null ? '（脱敏器不可用，原文已隐去）' : masked));
  };
  if (read.detail) pushText('原文=', read.detail);
  if (read.rawKeys) pushText('返回字段=', read.rawKeys);
  if (packet.bindErr) pushText('绑定原文=', packet.bindErr);
  if (mode.detail) parts.push('模式读数：' + mode.detail);
  else parts.push('isChatTool=' + (mode.inChatTool ? 'true' : 'false'));
  if (mode.apiCategory) parts.push('apiCategory=' + mode.apiCategory);
  return { roomId: roomId, stateText: stateText, evidence: parts.join(' ｜ ') };
}

// 证据行的上屏长度上限：浮层顶部那一行要一眼读完，而平台 errMsg 可能很长（真机 errMsg 见过带整段参数原文的）
const PICK_EVIDENCE_MAX = 160;

// 第二层脱敏（**形状兜底**）：会话标识只在"知道它长什么样"时才能被 `maskRoomIds` 替掉，而首次运行时
// 调用方手里一个候选都没有（`this.chatRoomId` 还是空串）。此时若原样上屏，就等于赌 errMsg 里没有 D3。
// 只认 id 字符集且 ≥16 位、**中间没有空格**的长 token（`open_single_roomid_x` 这类）。
// ⚠️ 代价（已知并接受）：极少数"超长的非 id 串"（如整段无空格的中文拼音/垃圾串）也会被隐——隐去标记里
//    写了长度，必要时可让人补一份日志；而 D3 泄漏是不可逆的，取舍向"宁可不显示"倾斜。
const ID_LIKE_PATTERN = /[A-Za-z0-9_-]{16,}/g;

/** 把"看起来就是标识"的长 token 换成隐去标记（长度写进去，便于判断被隐掉的是什么量级） */
function redactIdLike(text) {
  return text.replace(ID_LIKE_PATTERN, (hit) => '（已隐去 ' + hit.length + ' 位标识）');
}

/**
 * 证据文本的**双层脱敏**（两条上屏路共用同一份 —— 24 卡 r2 的 R-14：单源，别各写各的）
 * ① 已知候选 → `chatTool.maskRoomIds` 换成项目既有口径的指纹（前 6 位 + 总长度）
 * ② 漏网的 → `redactIdLike` 按**形状**兜底（首次运行时调用方手里一个候选都没有，`roomId` 就是空串）
 * @param {string} text 要上屏的原文
 * @param {string[]} roomIds 已知的 id 候选（允许空数组 / 含空串；空串会被滤掉，避免"恒等替换"）
 * @param {object} chatTool `utils/chat-tool.js`（注入）
 * @returns {string|null} `null` = 脱敏器不可用 ⇒ 调用方**必须**宁可不显示原文（⛔ 不许原样上屏）
 */
function redactEvidence(text, roomIds, chatTool) {
  if (typeof text !== 'string' || !text) return '';
  if (!chatTool || typeof chatTool.maskRoomIds !== 'function') return null;
  const candidates = (Array.isArray(roomIds) ? roomIds : []).filter((id) => typeof id === 'string' && id);
  return redactIdLike(chatTool.maskRoomIds(text, candidates));
}

/**
 * 「拉起好友列表」失败时的**取证读数行**（真机读数① 暴露的仪器缺陷）
 *
 * 病灶：`startChatPick` 有五个失败出口（无接口 / url 空 / 平台 `fail` 带 errMsg / 同步抛 / 超时），
 * 每个出口都带自己的 `detail`（平台 fail 还带 `rawErrMsg`）。原先页面只把 `reason` 传出来、
 * 后面缀一句**写死的**"会话选择未完成" ⇒ 五个病因在屏上长得一模一样，**等于没取证**
 * （分包页注释原话："三态混成一句'读取失败'就等于没取证"）。本函数把整份结果变成一行可判读的证据。
 *
 * 三条纪律都落在这里，因此它们可被断言（页面层没有断言能力，TD-016）：
 *   ① **D3**：`detail`/`rawErrMsg` 里可能夹带会话标识 ⇒ 一律走 `redactEvidence`（**与老路同一份**，
 *      R-14）。**拿不到脱敏器时宁可不显示原文** —— "看不见"好过"原样上屏"。
 *   ② **兜底不静默**：没有任何原文时给明确句子，⛔ 不留空串（空串会让人以为"这里没东西"）。
 *   ③ **长度上限**：平台 errMsg 可能很长 ⇒ 截断并标注原文总字数，头部保留可判读的 `reason=`。
 * @param {{reason?:string, detail?:string, rawErrMsg?:string}|null} result `startChatPick` 的整份失败结果（允许 null/非对象）
 * @param {object} chatTool `utils/chat-tool.js`（注入，便于纯函数测试；缺 `maskRoomIds` 时原文隐去）
 * @param {{roomIds?:string[], maxLen?:number}} [opts] `roomIds` = 需要替换成指纹的 id 候选
 * @returns {string} 一行证据串，形如 `reason=<code> ｜ detail=<脱敏后的原文>`
 */
function formatPickEvidence(result, chatTool, opts) {
  const info = result && typeof result === 'object' ? result : {};
  const code = typeof info.reason === 'string' && info.reason ? info.reason : 'CHAT_OPEN_FAILED';
  const raws = [];
  [info.detail, info.rawErrMsg].forEach((text) => {
    if (typeof text === 'string' && text && raws.indexOf(text) < 0) raws.push(text);
  });
  const canMask = !!(chatTool && typeof chatTool.maskRoomIds === 'function');
  const roomIds = opts && Array.isArray(opts.roomIds) ? opts.roomIds : [];
  let detail;
  if (!raws.length) {
    detail = '（平台没给 errMsg —— 这个出口本来就不带原文）';
  } else if (!canMask) {
    detail = '（脱敏器不可用，原文已隐去）';
  } else {
    // 与老路**同一个**脱敏器（R-14 的单源要求）：① 已知候选换指纹 ② 形状兜底扫一遍漏网的
    detail = raws.map((text) => redactEvidence(text, roomIds, chatTool)).join(' ⏎ ');
  }
  const cap = opts && typeof opts.maxLen === 'number' && opts.maxLen > 0 ? opts.maxLen : PICK_EVIDENCE_MAX;
  // 真机读数② 之后加：把**这次试过的 url 形态链**放进同一行（只有固定白名单候选，不含任何 D3）
  // ⇒ 用户一张截图就能读出"哪个形态被平台接受了"（第一名即赢家，全试完仍失败则一眼看到都试过）。
  const tried = opts && Array.isArray(opts.triedUrls)
    ? opts.triedUrls.filter((u) => typeof u === 'string' && u) : [];
  const prefix = tried.length ? 'url=' + tried.join('→') + ' ｜ ' : '';
  const line = prefix + 'reason=' + code + ' ｜ detail=' + detail;
  if (line.length <= cap) return line;
  const tail = '…（已截断，原文 ' + detail.length + ' 字）';
  return line.slice(0, Math.max(0, cap - tail.length)) + tail;
}

// ── 拉起好友列表：重入闸的判定（R-02 的可测核心）────────────────────────
// 超窗还停在 picking ⇒ 判"卡死"。为什么要有这个窗口：`picking` 原先只在 Promise 结算时复位，
// 而 tab 页实例常驻（`switchTab` 不销毁页面）⇒ 卡住就是"本会话内永久"，`fab` 与行内「换绑」全废。
// ⚠️ **序关系是这条闸成立的前提**（24 卡 r2 的 R-20）：`PICK_STALE_MS` 必须 **大于**
//    `chatTool.DEFAULT_TIMEOUT_MS`（看门狗先结算、先复位 `picking`）——否则"超窗允许重试"会与仍在飞的
//    调用叠成**两次**会话选择（第二次顶掉第一次的选择）。`selftest` §11b 有一条断言钉住它。
const PICK_STALE_MS = 10000;

/**
 * 这一下点击要不要真的发起会话选择
 * @param {{picking?:boolean, startedAt?:number}} state
 * @param {number} now 当前时间戳（注入，便于测"超窗"）
 * @returns {{start:boolean, hint:boolean}} `hint=true` ⇒ 给一句"正在拉起…"（⛔ 不静默吞点击）
 */
function shouldStartPick(state, now) {
  const picking = !!(state && state.picking);
  if (!picking) return { start: true, hint: false };
  const startedAt = state && typeof state.startedAt === 'number' ? state.startedAt : 0;
  const stale = !startedAt || (now - startedAt) > PICK_STALE_MS;
  return stale ? { start: true, hint: false } : { start: false, hint: true };
}

/**
 * 落库前该做什么（**R-01 ③ 的纵深防御**，纯函数 + 注入查询口）：令牌已经给出"这次用不用键"，
 * 这里再对着库确认一遍 —— 命中别人的档案就不许带键写进去（"一个键最多一条档案"的第二道闸）。
 * @param {{key:string}} resolved `resolveChatKeyForSave` 的产物
 * @param {function} findByKey `(key) => {ok:boolean, customer?:object|null, reason?:string}`（注入 `storage.findCustomerByChatKey`）
 * @returns {{action:'create'}|{action:'error', reason:string}|{action:'dup', dup:object}}
 */
function planSave(resolved, findByKey) {
  if (!resolved || !resolved.key) return { action: 'create' };
  const found = findByKey(resolved.key);
  if (!found || !found.ok) return { action: 'error', reason: (found && found.reason) || 'STORE_CORRUPT' };
  if (found.customer) return { action: 'dup', dup: found.customer };
  return { action: 'create' };
}

// ── 拉起好友列表的 url 形态轮盘（真机读数②）────────────────────────────────
// 病因读数：`openChatTool:fail invaild chatTool subpackage url`（`invaild` 是平台自己的拼写）。
// 官方文档对 `url` 只写一句「聊天工具分包内的页面路径」、**示例代码里连 url 都没给**；而 `entryPagePath`
// 与分包 `pages` 都通过配置校验（三处一致）却仍被判不合法 ⇒ 形态只能靠真机试出来。
// 顺序 = 最可能的在前：① 绝对页路径（微信路由接口的通用口径）② 带分包根的相对路径 ③ 分包内相对路径（现行值）。
const CHAT_TOOL_URL_CANDIDATES = ['/chatpick/index', 'chatpick/index', 'index'];

// 平台"url 不合法"的签名：**从真机原文里截出来的**（不是猜的）。⛔ 只认这一句 ——
// 取消 / 超时 / 未开放 / 其它 errMsg 一律**不再换形态**：那些病因换 url 治不好，而多试一遍就要用户
// 重新预览扫码一次；更糟的是把"用户主动取消"当成"形态不对"连试三次。
const URL_REJECT_SIGNATURE = 'subpackage url';

/** 候选形态表（返回拷贝，避免调用方改到常量本身） */
function chatToolUrlCandidates() {
  return CHAT_TOOL_URL_CANDIDATES.slice();
}

/**
 * 这次失败之后还要不要再试下一个形态（**有界**：候选用尽 ⇒ `null`，绝不循环）
 * @param {string[]} tried 已试过的形态（按顺序）
 * @param {string} errMsg 平台原文 / `detail`（调用方把两者拼一起传进来）
 * @returns {string|null} 下一个待试形态；`null` = 停（成功 / 非签名失败 / 已无候选）
 */
function nextChatToolUrl(tried, errMsg) {
  if (typeof errMsg !== 'string' || errMsg.indexOf(URL_REJECT_SIGNATURE) < 0) return null;
  const done = Array.isArray(tried) ? tried : [];
  const rest = CHAT_TOOL_URL_CANDIDATES.filter((u) => done.indexOf(u) < 0);
  return rest.length ? rest[0] : null;
}

/**
 * 有界轮盘：按候选依次发起，只在"url 不合法"签名时换下一个形态（循环整段住在这里的原因有二：
 * ① 页面 AGENTS §11.1 的 500 行 / 函数 50 行两条硬限都只剩几个身位；② `selftest` 不 require 页面（TD-016），
 * 判定住在零件里才有机器闸）。页面只提供两个钩子：`attemptOnce`（发起一次）与 `onSettled`（成功/最终失败都只调一次）。
 * @param {function} attemptOnce `(url) => Promise<{ok:boolean, reason?:string, detail?:string, rawErrMsg?:string}>`
 * @param {function} onSettled `(result, tried:string[]) => void`
 */
function driveChatToolUrlWheel(attemptOnce, onSettled) {
  const tried = [];
  const step = (url) => {
    tried.push(url);
    let task = null;
    try {
      task = attemptOnce(url);
    } catch (err) {
      onSettled({ ok: false, reason: 'CHAT_OPEN_FAILED', detail: '同步抛：' + ((err && err.message) || '（没有 message）') }, tried);
      return;
    }
    Promise.resolve(task).then((result) => {
      if (result && result.ok) { onSettled(result, tried); return; }
      const failure = result && typeof result === 'object' ? result : { ok: false, reason: 'CHAT_OPEN_FAILED' };
      const text = [failure.rawErrMsg, failure.detail].filter((one) => typeof one === 'string').join(' ');
      const next = nextChatToolUrl(tried, text);
      if (next) { step(next); return; }
      onSettled(failure, tried);
    });
  };
  step(chatToolUrlCandidates()[0]);
}

// ── 会话键的**可核对性**（pick_friend 范围扩展批；用户裁决①：列表短键 / 详情与浮层完整摘要）──────
// 键 = **本地摘要**（16 位小写 hex，`chatTool.pairKeyOf` 的产物，不可逆）⇒ 它的上屏边界与平台原值**不同**：
// 摘要**允许上屏**（用户 2026-09-25 裁），平台原值一个字符都不许。下面两个函数只做展示、不判合法性 ——
// 合法性由 `utils/chat-tool.js` 的摘要算法与 `storage` 的形态闸负责（这里再判一次就是第二份实现）。
const KEY_TAG_PREFIX = '会话键 …';   // 短键的固定小标识（人话化；改这个字面量要同步 §11b-9 的断言）
const KEY_FULL_PREFIX = '本地摘要 ';  // 完整摘要行的前缀

/** 列表副行用的**短键**（摘要后 6 位 + 固定小标识）；空/非字符串 ⇒ 空串（调用方用 `wx:if` 不渲染） */
function shortChatKey(key) {
  const text = typeof key === 'string' ? key.trim() : '';
  if (!text) return '';
  return KEY_TAG_PREFIX + text.slice(-6);
}

/** 浮层用的**完整摘要**行；空/非字符串 ⇒ 空串。⛔ 这里进来的必须已经是摘要（不可逆），不是平台原值 */
function fullChatKey(key) {
  const text = typeof key === 'string' ? key.trim() : '';
  if (!text) return '';
  return KEY_FULL_PREFIX + text;
}

/**
 * 档案列表**行对象**（页面只负责排序 + setData）：id / 楼栋 / 宿舍 / 称呼 / 副行短键。
 * 为什么搬到零件里：这段映射原先写在页面上（`refresh()` 里 6 行匿名 map），而**页面层没有断言能力**
 * （TD-016）⇒ 短键拼错、字段漏一个，两道门禁都看不见。搬来之后 `toRowViews` 是纯函数、可断言。
 * ⛔ 只出"人话 + 摘要短键"：platform 原值、id 都不许进这一层（id 仍由页面从原对象取，M9 负向判据）。
 */
function toRowViews(customers) {
  return (Array.isArray(customers) ? customers : []).map((customer) => {
    const label = aggregate.customerLabel(customer);
    const name = typeof customer.name === 'string' ? customer.name : '';
    const prefix = String(customer.building || '') + ' ' + String(customer.dorm || '');
    // 空称呼派生名（= "楼栋 宿舍 A/B/C"）已经把定位信息写进 name ⇒ 主行出 label 就够，副行不再重复它。
    // 2026-09-25 真机反馈（用户原话）：「标签应该同步显示 A,B,C 等等」⇒ 主行必须带后缀；
    // 副行只在称呼**另有信息**（人名/备注）时才出现，否则同一串字会在行里出现两遍。
    const derived = name.indexOf(prefix) === 0;
    return {
      id: customer.id,
      building: customer.building,
      dorm: customer.dorm,
      name: name,
      label: label,
      subName: derived ? '' : name,
      keyTag: shortChatKey(customer.chatRoomId)
    };
  });
}

module.exports = {
  createKeyToken,
  resolveChatKeyForSave,
  planSave,
  gateSheetForm,
  describeSessionKey,
  describeRebindNotice,
  describeLegacyPickup,
  formatPickEvidence,
  pickupPathOf,
  redactEvidence,
  shortChatKey,
  fullChatKey,
  toRowViews,
  shouldStartPick,
  chatToolUrlCandidates,
  nextChatToolUrl,
  driveChatToolUrlWheel,
  URL_REJECT_SIGNATURE,
  PICK_EVIDENCE_MAX,
  PICK_STALE_MS
};
