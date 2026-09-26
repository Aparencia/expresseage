// utils/chat-tool.js · 聊天工具模式的**判读与脱敏**单源（不再生成平台调用）
//
// ⚠️ 2026-09-25 改判 N2（U-1 实测：`chatTools` 只接受**独立分包**）之后，本文件的定位收窄了一格：
//   分包页 `chatpick/` 因为引不到主包，改为**只调接口、只塞原样返回**，不判读；
//   所有"这是什么意思 / 能不能上屏"的判断都留在这里，由主包 `pages/archive-list/` 消费。
//   ⇒ "唯一碰这几个 wx 接口"这句话已经不成立（`bind()`/`readRoomId()` 现在只在 Node 侧被自测驱动，
//     生产路径由分包页直调），但**三态判读、失败分类、指纹脱敏仍然只有一份**——这才是它存在的理由，
//     也正是 v1 当年否掉"分包里再写一份规则"的那条理由（教训卡 `2026-09-11_规则与样例分叉.md`）。
//
// 为什么仍单独成文件（三条都是踩出来的）：
//   ① AGENTS §11.1/§11.5：平台能力**依赖注入**进来，纯逻辑与副作用分开 ⇒ Node 侧能测失败分支
//      （`tools/selftest.js` §10 全部走 mock，不需要真机）。真机取证只验"平台到底给什么"，
//      不验"我们的分支写没写对"——那是这里的事。
//   ② 分层铁律：`wx.*Storage*` 只允许出现在 utils/（check.js 第 6 条），而 `wx.openChatTool` 这一类
//      接口如果散进页面，页面就会同时持有"业务判断 + 平台重试 + 文案拼装"三件事。
//   ③ 这个能力**至今未取证**（RESEARCH §6 的 U-1/U-5/U-6）：接口可能不存在（老基础库/未开放主体）、
//      可能返回结构与我们猜的不同。所以每个失败出口都分开命名，并把**原始读数**带上屏（脱敏后），
//      让人一眼看出该退 N2 还是该转 D 兜底轨。
//
// ⛔ 铁律（SCOPE M11 / DESIGN K5）：会话标识只允许进 `Customer.chatRoomId` 一个字段。
//   本模块**不写存储、不写日志、不进 URL query**；要在屏上出现只能经 `fingerprint()` 脱敏。
'use strict';

// 会话标识在平台文档里的字段名（单聊）。⚠️ 这正是 U-5 要证的三态之一：可能**根本没有这个键**。
const ROOM_ID_FIELD = 'open_single_roomid';
// 看门狗超时：接口在个别版本上出现过"既不 success 也不 fail"的挂死读数（v1 冒烟件同口径的担心）。
// 没有超时 = 页面永久停在"绑定中"，用户只能杀进程 —— 那是比失败更糟的失效模式。
const DEFAULT_TIMEOUT_MS = 8000;

/**
 * 进入聊天工具模式并绑定当前会话（封装 `wx.openChatTool`）
 * @param {string} url chatTools 分包内的入口页路径（与 `app.json` 的 `chatTools[0].entryPagePath` 同源；
 *   该值由调用方传，本模块不硬编码 —— 写成两处就会分叉；原先有 `check.js` 的形态对帐守 app.json 那一处，
 *   2026-09-25 裁决删除 ⇒ 现在这一致性没有机器闸，见 `docs/TECH_DEBT.md` TD-014）
 * @param {{wxApi?:object, setTimeout?:function, clearTimeout?:function, timeoutMs?:number}} [deps]
 *   注入点：`wxApi` 缺省时取全局 `wx`（小程序运行时）；Node 侧传 mock
 * @returns {Promise<{ok:boolean, reason?:string, detail?:string, rawErrMsg?:string}>}
 */

/**
 * 取定时器：**注入优先，缺省回退到全局**（24 卡 R-02）。
 * 为什么要有缺省：`bind`/`readRoomId`/`startChatPick` 原先一律写成"只有调用方注入才武装看门狗"，
 * 而生产调用点（`pages/archive-list` 的 `startPick`）没注入 ⇒ **运行时一次定时器都没注册**
 * （R-02 的复现读数：点「＋新建」后注册的定时器数 = 0）⇒ 平台一旦既不 success 也不 fail，
 * 页面就永久停在"绑定中"。从此三个函数同一条写法：测试注入 mock（可测失败分支），生产拿到真看门狗。
 * @param {object} [deps]
 * @returns {{set:function|null, clear:function|null}}
 */
function timersOf(deps) {
  const injected = deps || {};
  return {
    set: typeof injected.setTimeout === 'function' ? injected.setTimeout
      : (typeof setTimeout === 'function' ? setTimeout : null),
    clear: typeof injected.clearTimeout === 'function' ? injected.clearTimeout
      : (typeof clearTimeout === 'function' ? clearTimeout : null)
  };
}

function bind(url, deps) {
  const injected = deps || {};
  const api = injected.wxApi || (typeof wx === 'undefined' ? null : wx);
  const target = typeof url === 'string' ? url.trim() : '';
  const timers = timersOf(injected);
  const timeoutMs = injected.timeoutMs || DEFAULT_TIMEOUT_MS;
  if (!api || typeof api.openChatTool !== 'function') {
    // 老基础库或未开放该能力：这是 U-6/U-1 的判据之一，必须与"用户取消"分开的出口
    return Promise.resolve({
      ok: false,
      reason: 'CHAT_UNSUPPORTED',
      detail: '当前环境没有 wx.openChatTool（基础库或主体不支持）。'
    });
  }
  if (!target) {
    return Promise.resolve({ ok: false, reason: 'CHAT_BIND_FAILED', detail: '缺少会话入口路径（url 为空）' });
  }
  return new Promise((resolve) => {
    let done = false;
    // `timer` 必须先声明再赋值：mock 的 `openChatTool` 会**同步**回调，那时如果还用后面的
    // `const timer`，`finish` 里读它就是 TDZ 抛错（自测第一轮就是这么炸的）
    let timer = null;
    const finish = (result) => {
      if (done) return;
      done = true;
      if (timer && timers.clear) timers.clear(timer);
      resolve(result);
    };
    timer = timers.set
      ? timers.set(() => finish({
        ok: false,
        reason: 'CHAT_BIND_FAILED',
        detail: '等待微信响应超过 ' + timeoutMs + ' 毫秒 —— 可能这个能力对当前主体未开放（U-6）'
      }), timeoutMs)
      : null;
    api.openChatTool({
      url: target,
      success: () => finish({ ok: true }),
      fail: (err) => {
        const errMsg = (err && err.errMsg) || '（平台没给 errMsg）';
        finish({
          ok: false,
          reason: failureReasonOf(errMsg),
          detail: errMsg,
          rawErrMsg: errMsg
        });
      }
    });
  });
}

// 平台失败原文里"用户主动取消"的长相 —— **只有这一处判**。两条链路的码名不同（bind / 打开会话选择），
// 所以出口分成两个函数；但"什么算取消"若各抄一份，迟早有一天两边不一致。
function isCancel(errMsg) {
  return /cancel/i.test(typeof errMsg === 'string' ? errMsg : '');
}

// 平台失败原文 → 失败出口名（**这条分类只有一份**）。
// 为什么单独成函数：N2 之后 `wx.openChatTool` 由**独立分包页**直调（它引不到主包），分包页只把原文
// 塞进内存桥；分类与文案必须由主包按同一条规则得出，绝不能在分包里再抄一个 `/cancel/i`。
function failureReasonOf(errMsg) {
  return isCancel(errMsg) ? 'CHAT_BIND_CANCELLED' : 'CHAT_BIND_FAILED';
}

/**
 * 发起"选择聊天好友"（**主包侧**，封装 `wx.openChatTool`，不传 roomid）
 *
 * 官方《聊天工具模式开发指南》§2.1 方式 1 原文：「当小程序处于普通模式时，开发者调用 `wx.openChatTool`
 * 但不传入聊天室 id，微信会拉起聊天列表让用户选择，用户选择后绑定聊天室进入聊天工具模式」
 * ⇒ 这就是"点＋新建就自动进入选择好友"的官方支点（调用点是否被接受 = U-2，待真机）。
 *
 * @param {{wxApi?:object, url?:string, setTimeout?:function, clearTimeout?:function, timeoutMs?:number}} [deps]
 *   `url` = 聊天工具分包内的页面路径。⛔ **不硬编码**：它与 `chatpick/index.js` 的 `CHAT_TOOL_ENTRY`、
 *   `app.json` 的 `chatTools[0].entryPagePath` 必须同值，而这三处一致性**只靠人核**（TD-014：原来守它的
 *   机器对帐判据已按裁决删除）
 * @returns {Promise<{ok:boolean, reason?:string, detail?:string, rawErrMsg?:string}>}
 *   `CHAT_OPEN_CANCELLED` = 用户在会话列表里取消（**不计进失败率**，与 bind 的取消同口径）
 *   `CHAT_OPEN_FAILED` = 无接口 / url 为空 / 平台拒绝 / 接口抛错 / 超时
 */
/**
 * 会话选择的超时出口（抽出来只为把 `startChatPick` 压回 AGENTS §11.1 的 50 行内 —— 24 卡 R-11）
 * @param {number} timeoutMs
 * @returns {{ok:boolean, reason:string, detail:string}}
 */
function pickTimeoutResult(timeoutMs) {
  return {
    ok: false,
    reason: 'CHAT_OPEN_FAILED',
    detail: '等待微信响应超过 ' + timeoutMs + ' 毫秒 —— 可能这个能力对当前主体未开放（U-6）'
  };
}

function startChatPick(deps) {
  const injected = deps || {};
  const api = injected.wxApi || (typeof wx === 'undefined' ? null : wx);
  const target = typeof injected.url === 'string' ? injected.url.trim() : '';
  if (!api || typeof api.openChatTool !== 'function') {
    // 与 bind 同一条：能力不存在是 U-6/U-1 的判据之一，必须与"用户取消"分开的出口
    return Promise.resolve({
      ok: false,
      reason: 'CHAT_OPEN_FAILED',
      detail: '当前环境没有 wx.openChatTool（基础库或主体不支持）'
    });
  }
  if (!target) {
    return Promise.resolve({ ok: false, reason: 'CHAT_OPEN_FAILED', detail: '缺少会话入口路径（url 为空）' });
  }
  const timers = timersOf(injected);
  const timeoutMs = injected.timeoutMs || DEFAULT_TIMEOUT_MS;
  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    const finish = (result) => {
      if (done) return;
      done = true;
      if (timer && timers.clear) timers.clear(timer);
      resolve(result);
    };
    // 平台失败原文 → 出口（取消与失败**必须分开**：取消不计进失败率，与 bind 同口径）
    const pickFailed = (errMsg) => finish({
      ok: false,
      reason: isCancel(errMsg) ? 'CHAT_OPEN_CANCELLED' : 'CHAT_OPEN_FAILED',
      detail: errMsg,
      rawErrMsg: errMsg
    });
    // 看门狗与 bind/readRoomId 同一条口径（含 R-02 的**缺省回退**）：挂死的接口会让浮层永远等在那里，
    // 比失败更糟 —— 而"只有注入才武装"等于生产路径根本没有这道闸。
    timer = timers.set ? timers.set(() => finish(pickTimeoutResult(timeoutMs)), timeoutMs) : null;
    try {
      api.openChatTool({
        url: target,
        success: () => finish({ ok: true }),
        fail: (err) => pickFailed((err && err.errMsg) || '（平台没给 errMsg）')
      });
    } catch (err) {
      // 平台接口在个别版本上会直接抛：抛了就是"打不开"，不能让异常冒泡成整页失败（AGENTS §11.4）
      finish({ ok: false, reason: 'CHAT_OPEN_FAILED', detail: '接口调用抛错：' + String((err && err.message) || err) });
    }
  });
}

/**
 * 读取当前会话标识（封装 `wx.getChatToolInfo`）—— **三态分开报**是 U-5 的取证要求
 * @param {{wxApi?:object}} [deps]
 * @returns {Promise<{ok:boolean, roomId?:string, reason?:string, detail?:string, rawKeys?:string}>}
 *   `ok:true` 时 `roomId` 是平台原值（形态合法性由 `migrate.isChatRoomId` 在落库时判，这里不重抄规则）
 *   `CHAT_ID_UNAVAILABLE` = 返回里**没有那个键**（⇒ 全案可能出局）
 *   `CHAT_ID_EMPTY` = **有键但值为空**（⇒ 换群/权限口径问题，与"没有键"是完全不同的病因）
 *   `CHAT_UNSUPPORTED` = 接口本身不存在
 */
function readRoomId(deps) {
  const injected = deps || {};
  const api = injected.wxApi || (typeof wx === 'undefined' ? null : wx);
  if (!api || typeof api.getChatToolInfo !== 'function') {
    return Promise.resolve({
      ok: false,
      reason: 'CHAT_UNSUPPORTED',
      detail: '当前环境没有 wx.getChatToolInfo（基础库或主体不支持）'
    });
  }
  const timers = timersOf(injected);
  const timeoutMs = injected.timeoutMs || DEFAULT_TIMEOUT_MS;
  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    const finish = (result) => {
      if (done) return;
      done = true;
      if (timer && timers.clear) timers.clear(timer);
      resolve(result);
    };
    // R3-06：超时口径与 bind 同一条 —— 只给一个接口加看门狗等于半个纪律，挂死的那个才是会卡住用户的。
    // 24 卡 R-02：与 `bind`/`startChatPick` 一样带**缺省回退**（不注入也拿全局 `setTimeout`）。
    timer = timers.set
      ? timers.set(() => finish({
        ok: false,
        reason: 'CHAT_ID_UNAVAILABLE',
        detail: '读取会话标识超过 ' + timeoutMs + ' 毫秒没有回应'
      }), timeoutMs)
      : null;
    api.getChatToolInfo({
      success: (res) => finish(readThreeStates(res)),
      fail: (err) => finish({
        ok: false,
        reason: 'CHAT_ID_UNAVAILABLE',
        detail: (err && err.errMsg) || '（平台没给 errMsg）'
      })
    });
  });
}

// U-5 的三态判读单列成纯函数：没有键 / 有键但空 / 非空 —— 三种的处置动作不同，混在一起就没法取证
function readThreeStates(res) {
  const info = res && typeof res === 'object' ? res : {};
  if (!Object.prototype.hasOwnProperty.call(info, ROOM_ID_FIELD)) {
    // 把真实键名带出来：U-5 要的正是“平台到底给了什么字段”，不看原始结构就只能猜
    return {
      ok: false,
      reason: 'CHAT_ID_UNAVAILABLE',
      detail: '返回里没有 ' + ROOM_ID_FIELD + ' 这个字段',
      rawKeys: Object.keys(info).join(',') || '（返回是空对象）'
    };
  }
  const value = info[ROOM_ID_FIELD];
  if (typeof value !== 'string' || value.trim() === '') {
    return {
      ok: false,
      reason: 'CHAT_ID_EMPTY',
      detail: ROOM_ID_FIELD + ' 有，但值是' + (typeof value === 'string' ? '空串' : typeof value),
      rawKeys: Object.keys(info).join(',')
    };
  }
  return { ok: true, roomId: value.trim() };
}

/**
 * 当前是否处在聊天工具模式（屏上"绑定状态行"用它说话，也顺手把 `getApiCategory` 的读数带出来）
 * @param {{wxApi?:object}} [deps]
 * @returns {{inChatTool:boolean, apiCategory:string, detail:string}}
 */
function modeSnapshot(deps) {
  const injected = deps || {};
  const api = injected.wxApi || (typeof wx === 'undefined' ? null : wx);
  const snapshot = { inChatTool: false, apiCategory: '', detail: '' };
  if (!api) {
    snapshot.detail = '取不到 wx（只在 Node 侧发生）';
    return snapshot;
  }
  if (typeof api.isChatTool === 'function') {
    try {
      snapshot.inChatTool = !!api.isChatTool();
    } catch (err) {
      // 平台接口在个别版本上会直接抛；抛了就是"读不到"，不能让它把整页崩掉（AGENTS §11.4）
      snapshot.detail = 'isChatTool 抛错：' + String((err && err.message) || err);
    }
  } else {
    snapshot.detail = '当前环境没有 wx.isChatTool';
  }
  if (typeof api.getApiCategory === 'function') {
    try {
      snapshot.apiCategory = String(api.getApiCategory() || '');
    } catch (err) {
      snapshot.detail += '；getApiCategory 抛错：' + String((err && err.message) || err);
    }
  }
  return snapshot;
}

/**
 * 会话标识的屏上指纹：**只给前 6 位 + 总长度**（用户裁决口径："前 6 位 + 长度"）
 * 为什么屏上要有它：V6 要让人确认"绑的是这个会话"，而 M11 禁止把 id 原值上屏（会被截图转发出去）。
 * @param {string} roomId
 * @returns {string}
 */
function fingerprint(roomId) {
  const value = typeof roomId === 'string' ? roomId : '';
  if (!value) return '（无）';
  if (value.length <= 6) return '长度 ' + value.length + ' 位（太短，已全部隐去）';
  return value.slice(0, 6) + '…（共 ' + value.length + ' 位）';
}

/**
 * 把一段要上屏的文本里出现的 id 原值替换成指纹。
 * 平台失败原文（errMsg）有时会带上参数值 ⇒ 直接贴 = 把 D3 会话标识印到屏幕上再被转发出去。
 * @param {string} text
 * @param {string[]} [roomIds] 已知需要隐藏的原文
 * @returns {string}
 */
function maskRoomIds(text, roomIds) {
  let out = typeof text === 'string' ? text : '';
  const list = Array.isArray(roomIds) ? roomIds : [];
  for (const value of list) {
    if (typeof value !== 'string' || value.length < 4) continue;
    out = out.split(value).join(fingerprint(value));
  }
  return out;
}

// ── 会话键（2026-09-25 新需求 pick_friend）：单聊双方 id 的**无序对摘要** ──────────────
//
// 为什么需要它：`getChatToolInfo` 的返回是**加密数据**（官方三处互证），无后端/无云解不开；
// 而官方另有一条**明文**接口 `wx.selectGroupMembers` ——「若当前为单聊，则直接返回双方的 group_openid」。
// 于是键 = 这两个 id 的**无序对**摘要：单聊房间只有 {学生, 该好友} 两人 ⇒ 该对唯一标识这位好友，
// 且**不需要区分哪个是自己**（"同一用户在不同聊天室下 id 不同" ⇒ 自己那一半每个房间也不一样，
// 想靠排除自己来锁定对方根本不成立）。
//
// ⛔ 落库的是**摘要**不是原值：① D3 最小化（库里不再存平台会话标识）② 两段原值拼接可能超过
//    `Customer.chatRoomId` 的 64 上限、字符集也不保证（改字段约束 = 红线）③ 长度固定，比对稳定。
// ⚠️ 摘要不可逆 ⇒ 长期正确性靠"平台键 + 本地锚（楼区/宿舍/称呼）+ 可人工重锚"，不许全押平台键。
const PAIR_MEMBER_COUNT = 2;

/** 32 位无符号整数 → 8 位小写 hex（不用 padStart：老引擎上那是运行时方法，缺了会静默出错） */
function hex8(value) {
  let out = (value >>> 0).toString(16);
  while (out.length < 8) out = '0' + out;
  return out;
}

// `Math.imul` 缺省时自己算 32 位乘法：直接 `a * b` 会超过 2^53 丢精度（乘积可达 6.9e16）⇒ 结果会
// 悄悄变成错误的键，而不是报错。宁可多这五行，也不要一个"看着像 hash、其实是浮点残渣"的键。
const imul32 = typeof Math.imul === 'function' ? Math.imul : function (a, b) {
  const aHi = (a >>> 16) & 0xffff;
  const aLo = a & 0xffff;
  const bHi = (b >>> 16) & 0xffff;
  const bLo = b & 0xffff;
  return ((aLo * bLo) + ((((aHi * bLo) + (aLo * bHi)) << 16) >>> 0)) | 0;
};

// 两个不同族的 32 位散列拼成 64 位（FNV-1a + djb2）。为什么不是 crypto：小程序端没有 Node 的
// `crypto`、本项目零依赖；这里只需抗**偶然碰撞**（数百好友量级），不是抗攻击场景。
// 碰撞的人兜底见 DESIGN §2：查重提示会同时显示已有档案的锚（楼区/宿舍/称呼），是两个人当场看得出来。
function digest16(text) {
  let fnv = 0x811c9dc5;
  let djb = 5381;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    fnv = imul32((fnv ^ code) >>> 0, 0x01000193) >>> 0;
    djb = (imul32(djb, 33) + code) >>> 0;
  }
  return hex8(fnv) + hex8(djb);
}

/**
 * `wx.selectGroupMembers` 的**原样返回** → 双方 id（纯函数；形态闸只在这里）
 * 为什么"个数不对"要单独成一个出口：群聊下平台会拉起成员选择器、可能回来 1~N 个，
 * 那与"返回结构被改坏了"是**两种病因**（处置不同：前者本期不支持，后者要查平台口径）。
 * @param {object} res 平台回调原样返回（允许 null）
 * @returns {{ok:boolean, members?:string[], reason?:string, detail?:string, rawKeys?:string}}
 */
function readPairMembers(res) {
  const info = res && typeof res === 'object' ? res : {};
  if (!Array.isArray(info.members)) {
    return {
      ok: false,
      reason: 'CHAT_MEMBERS_FAILED',
      detail: '返回里没有 members 数组',
      rawKeys: Object.keys(info).join(',') || '（返回是空对象）'
    };
  }
  if (info.members.length !== PAIR_MEMBER_COUNT) {
    return {
      ok: false,
      reason: 'CHAT_NOT_SINGLE_CHAT',
      detail: 'members 有 ' + info.members.length + ' 个（单聊应给双方 2 个）'
    };
  }
  const pair = [];
  for (const one of info.members) {
    if (typeof one !== 'string' || one.trim() === '') {
      return { ok: false, reason: 'CHAT_MEMBERS_FAILED', detail: 'members 里有非字符串或空值' };
    }
    pair.push(one.trim());
  }
  return { ok: true, members: pair };
}

/**
 * 无序对 → 会话键（**唯一生成器**；页面/页面零件不许自己拼一个）
 * @param {string[]} members 单聊双方的原始 id（顺序无关）
 * @returns {{ok:boolean, key?:string, reason?:string, detail?:string}} `key` = 16 位小写 hex
 */
function pairKeyOf(members) {
  const read = readPairMembers({ members: members });
  if (!read.ok) return { ok: false, reason: 'BAD_MEMBERS', detail: read.detail };
  const sorted = read.members.slice().sort();
  // 分隔符用 \u0000：id 里不可能出现它 ⇒ "ab"+"c" 与 "a"+"bc" 不会撞成同一个串
  return { ok: true, key: digest16(sorted[0] + '\u0000' + sorted[1]) };
}

module.exports = {
  bind,
  readRoomId,
  // ↓ N2 之后主包档案页要用这两条：分包页只塞原样返回，判读与分类全在这里（单源）
  readThreeStates,
  failureReasonOf,
  // ↓ pick_friend（2026-09-25）：取键与判读同样只有一份，分包页只转发 members 原样数组
  readPairMembers,
  pairKeyOf,
  // ↓ pick_friend 批 2：主包侧"发起选择聊天好友"（官方 §2.1 方式 1，不传 roomid）
  startChatPick,
  modeSnapshot,
  fingerprint,
  maskRoomIds,
  ROOM_ID_FIELD,
  DEFAULT_TIMEOUT_MS
};
