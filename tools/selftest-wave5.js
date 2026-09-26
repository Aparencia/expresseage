// tools/selftest-wave5.js · 波 5 新增两节（§10 平台边界 / §11 页面零件）
//
// 为什么单独成文件：`tools/selftest.js` 加上这两节后到 1027 行，破了 AGENTS §11.1 给测试文件的
// ≤1000 行豁免上限（r3 审查同族问题：文件长到一定程度，读它的人开始漏行）。
// 判据本身一条没少，只是搬了家；主文件继续管 mock `wx`、存储层与同步节。
//
// ⚠️ 这个模块**不自己造判定器**：`eq`/`check` 由调用方传进来（同一个计数器），
// 否则两条链各数各的，末尾那个"断言 N 条"读数就是假的（R3-02 关心的是同一件事）。
'use strict';

/**
 * §10 聊天工具边界（`utils/chat-tool.js`，全靠注入的 mock，不需要真机）
 *
 * 这一节是**取证之前**该做完的部分：平台到底给什么字段属 U-5（只有真机答得了），
 * 但"给成任何一种样子时我们的出口对不对"必须先在 Node 侧钉死 —— 否则到了真机上
 * 分不清是"平台不支持"还是"我们分支写错了"（AGENTS §11.4：假设一切外部依赖会失败）。
 * @param {{eq:function, check:function, chatTool:object}} kit
 */
async function runChatToolSection(kit) {
  const eq = kit.eq;
  const check = kit.check;
  const chatTool = kit.chatTool;
  console.log('§10 聊天工具边界');
  const ROOM = 'aB3-xY9_zK2mNq4rT7uV';  // 20 位，合法形态（^[A-Za-z0-9_-]+$ ≤64）

  // ── bind：四种出口互不遮蔽 ────────────────────────────────
  const noApi = await chatTool.bind('index', { wxApi: {} });
  eq('bind 没有 openChatTool 接口 ⇒ CHAT_UNSUPPORTED（与"用户取消"分开）', noApi.reason, 'CHAT_UNSUPPORTED');
  eq('bind 的 url 为空 ⇒ 直接判失败，不发调用',
    (await chatTool.bind('   ', { wxApi: { openChatTool() {} } })).reason, 'CHAT_BIND_FAILED');

  let sentUrl = '';
  const cleared = [];
  const okDeps = {
    wxApi: { openChatTool(opts) { sentUrl = opts.url; opts.success({}); } },
    setTimeout: () => 'T1',
    clearTimeout: (id) => { cleared.push(id); }
  };
  eq('bind 成功 ⇒ ok:true', (await chatTool.bind('index', okDeps)).ok, true);
  eq('bind 把 url 原样交给平台（不加工、不补斜杠）', sentUrl, 'index');
  eq('bind 成功后看门狗被清掉（否则每次绑定留一个定时器 = 泄漏）', cleared.join(','), 'T1');

  const cancel = await chatTool.bind('index', {
    wxApi: { openChatTool: (o) => o.fail({ errMsg: 'openChatTool:fail cancel' }) }
  });
  eq('用户取消 ⇒ CHAT_BIND_CANCELLED（不能算失败率）', cancel.reason, 'CHAT_BIND_CANCELLED');
  const bad = await chatTool.bind('index', {
    wxApi: { openChatTool: (o) => o.fail({ errMsg: 'openChatTool:fail invalid chatTool subpackage url' }) }
  });
  eq('平台报"配置形态不对" ⇒ CHAT_BIND_FAILED 且**原文带上**（U-1 的读数就靠它）',
    bad.reason + '|' + bad.rawErrMsg, 'CHAT_BIND_FAILED|openChatTool:fail invalid chatTool subpackage url');

  let watchdog = null;
  let lateSuccess = null;
  // ⚠️ 不能 `await chatTool.bind(...)`：mock 既不 success 也不 fail，那个 Promise 永远不结算 ⇒ 整节卡死。
  // 先拿到 pending、手动引爆看门狗、再 await —— 定时器分支只有这么测得到。
  const pending = chatTool.bind('index', {
    wxApi: { openChatTool: (o) => { lateSuccess = o.success; } },
    setTimeout: (fn) => { watchdog = fn; return 'T2'; },
    clearTimeout: () => {},
    timeoutMs: 1234
  });
  check('注入的 setTimeout 被真的用上了（否则超时分支永不可测）', typeof watchdog === 'function', typeof watchdog);
  watchdog();
  lateSuccess({});   // 迟到的"成功"不许改写已经判出的失败结局
  const timeout = await pending;
  eq('挂死到点 ⇒ CHAT_BIND_FAILED 并说明等了多久（可能未开放 = U-6）',
    timeout.reason + '|' + /1234/.test(timeout.detail), 'CHAT_BIND_FAILED|true');
  eq('迟到的回调不产生第二个结局（done 闸门）', timeout.ok, false);

  // ── readRoomId：U-5 的三态必须三个出口 ─────────────────────
  eq('没有 getChatToolInfo ⇒ CHAT_UNSUPPORTED',
    (await chatTool.readRoomId({ wxApi: {} })).reason, 'CHAT_UNSUPPORTED');
  const noField = await chatTool.readRoomId({
    wxApi: { getChatToolInfo: (o) => o.success({ roomInfo: {}, mode: 'x' }) }
  });
  eq('返回里**没有那个键** ⇒ CHAT_ID_UNAVAILABLE', noField.reason, 'CHAT_ID_UNAVAILABLE');
  eq('CHAT_ID_UNAVAILABLE 把真实键名带出来（取证要看平台到底给了什么字段）', noField.rawKeys, 'roomInfo,mode');
  const emptyField = await chatTool.readRoomId({
    wxApi: { getChatToolInfo: (o) => o.success({ open_single_roomid: '   ' }) }
  });
  eq('有键但值是空串 ⇒ CHAT_ID_EMPTY（与"没有键"是两个不同病因）', emptyField.reason, 'CHAT_ID_EMPTY');
  const got = await chatTool.readRoomId({
    wxApi: { getChatToolInfo: (o) => o.success({ open_single_roomid: ROOM }) }
  });
  eq('非空 ⇒ 原值交出去（形态合法性由 migrate.isChatRoomId 在落库时判，这里不重抄规则）', got.roomId, ROOM);
  eq('fail 回调 ⇒ 也归 CHAT_ID_UNAVAILABLE 并带原文',
    (await chatTool.readRoomId({
      wxApi: { getChatToolInfo: (o) => o.fail({ errMsg: 'getChatToolInfo:fail privacy deny' }) }
    })).detail, 'getChatToolInfo:fail privacy deny');

  // R3-06：`readRoomId` 也要有自己的看门狗（只给 bind 加 = 半个纪律，挂死的这个才会真卡住用户）
  let roomWatchdog = null;
  const pendingRoom = chatTool.readRoomId({
    wxApi: { getChatToolInfo: () => {} },
    setTimeout: (fn) => { roomWatchdog = fn; return 'T9'; },
    clearTimeout: () => {},
    timeoutMs: 3210
  });
  check('readRoomId 也登记了看门狗（R3-06）', typeof roomWatchdog === 'function', typeof roomWatchdog);
  roomWatchdog();
  const roomTimeout = await pendingRoom;
  eq('读会话标识挂死到点 ⇒ CHAT_ID_UNAVAILABLE + 写明等了多久',
    roomTimeout.reason + '|' + /3210/.test(roomTimeout.detail), 'CHAT_ID_UNAVAILABLE|true');

  // ── modeSnapshot：接口缺失/抛错都不许把页面崩掉 ────────────
  eq('isChatTool 为真 ⇒ inChatTool:true',
    chatTool.modeSnapshot({ wxApi: { isChatTool: () => true, getApiCategory: () => 'default' } }).inChatTool, true);
  eq('getApiCategory 一并带出（U-6 的旁证）',
    chatTool.modeSnapshot({ wxApi: { isChatTool: () => false, getApiCategory: () => 'default' } }).apiCategory, 'default');
  check('isChatTool 直接抛错 ⇒ 只记 detail，不抛出去',
    chatTool.modeSnapshot({ wxApi: { isChatTool: () => { throw new Error('boom'); } } }).detail.indexOf('boom') >= 0, null);
  eq('完全没有 wxApi ⇒ 不崩，给一句可判读的话',
    chatTool.modeSnapshot({ wxApi: null }).detail.indexOf('没有 wx.isChatTool') >= 0, true);

  // ── 上屏卫生：id 原值不许出现在屏上 ───────────────────────
  eq('指纹 = 前 6 位 + 总长度（用户裁决口径）', chatTool.fingerprint(ROOM), 'aB3-xY…（共 20 位）');
  eq('指纹里不含 id 的后半段（截图转发出去也认不出人）',
    chatTool.fingerprint(ROOM).indexOf('zK2mNq4r'), -1);
  check('短 id（≤6）全部隐去，只给长度',
    chatTool.fingerprint('abc12').indexOf('abc12') < 0, chatTool.fingerprint('abc12'));
  eq('空值给"（无）"而不是空串（屏上不能出现空白状态行）', chatTool.fingerprint(''), '（无）');
  eq('errMsg 里混进 id 原值时，上屏前被替换成指纹',
    chatTool.maskRoomIds('fail ' + ROOM + ' denied', [ROOM]), 'fail aB3-xY…（共 20 位） denied');
  eq('长度 <4 的线索不当 id（避免把普通词替换掉）',
    chatTool.maskRoomIds('fail ok denied', ['ok']), 'fail ok denied');
  eq('本模块认的字段名写死在这里一处（页面不许各自猜）', chatTool.ROOM_ID_FIELD, 'open_single_roomid');

  // ── N2 改判后新增：内存桥的**判读侧**成为生产路径（2026-09-25）──────────────
  // 独立分包 `chatpick/` 引不到主包 ⇒ 它只把 `wx.getChatToolInfo` 的原样返回塞进
  // `app.globalData.chatToolPickup`；下面这两个纯函数从此由主包档案页在**真机路径上**调用，
  // 不再只是 `readRoomId` 的内部零件。是生产入口就得有断言（否则改了它们，Node 侧一声不响）。
  check('readThreeStates 已导出（分包只转发，三态判读必须在主包做）',
    typeof chatTool.readThreeStates === 'function', typeof chatTool.readThreeStates);
  eq('没有那个键 ⇒ CHAT_ID_UNAVAILABLE 并带出真实键名',
    chatTool.readThreeStates({ roomInfo: 1, mode: 'chat' }).reason, 'CHAT_ID_UNAVAILABLE');
  eq('有键但值是空白串 ⇒ CHAT_ID_EMPTY（与"没有键"两个病因）',
    chatTool.readThreeStates({ open_single_roomid: '   ' }).reason, 'CHAT_ID_EMPTY');
  eq('非空 ⇒ ok 且值去过空白（原样进内存桥，不在这里判形态）',
    chatTool.readThreeStates({ open_single_roomid: ' ' + ROOM + ' ' }).roomId, ROOM);
  eq('平台给了 null 也不能抛 ⇒ 判成"没有键"', chatTool.readThreeStates(null).reason, 'CHAT_ID_UNAVAILABLE');
  check('failureReasonOf 已导出（分类规则只有一份，分包里不许再抄 /cancel/i）',
    typeof chatTool.failureReasonOf === 'function', typeof chatTool.failureReasonOf);
  eq('用户取消的原文 ⇒ CHAT_BIND_CANCELLED（不计进失败率）',
    chatTool.failureReasonOf('openChatTool:fail cancel'), 'CHAT_BIND_CANCELLED');
  eq('配置形态类原文 ⇒ CHAT_BIND_FAILED（-80426 那种就得走这条，U-1 靠它）',
    chatTool.failureReasonOf('...subPackage `/chatpick/` for `chatTools[0]` should be independent'),
    'CHAT_BIND_FAILED');
  eq('原文不是字符串也不抛（平台给 undefined 是可能的）',
    chatTool.failureReasonOf(undefined), 'CHAT_BIND_FAILED');

  // ── 会话键（pick_friend，2026-09-25）：单聊双方 id 的**无序对摘要** ──────────────
  // 为什么这些能在 Node 侧钉住：平台到底给不给明文（U-11）只有真机答得了，但"给了之后我们怎么折键、
  // 形态坏了怎么分病因"必须先在本地钉死 —— 否则到了真机上分不清"平台不支持"还是"我们写错了"。
  check('readPairMembers / pairKeyOf 已导出（分包只转发数组，判读与折键必须在主包做）',
    typeof chatTool.readPairMembers === 'function' && typeof chatTool.pairKeyOf === 'function',
    typeof chatTool.readPairMembers + '/' + typeof chatTool.pairKeyOf);
  eq('没有 members 数组 ⇒ CHAT_MEMBERS_FAILED 且带出真实键名（取证要看平台到底给了什么）',
    chatTool.readPairMembers({ errMsg: 'ok' }).reason, 'CHAT_MEMBERS_FAILED');
  eq('返回是 null 也不抛 ⇒ 同样判 CHAT_MEMBERS_FAILED（平台给 null 是可能的）',
    chatTool.readPairMembers(null).reason, 'CHAT_MEMBERS_FAILED');
  eq('members 有 3 个（群聊会拉起成员选择器）⇒ CHAT_NOT_SINGLE_CHAT，与"结构坏了"分开',
    chatTool.readPairMembers({ members: ['a', 'b', 'c'] }).reason, 'CHAT_NOT_SINGLE_CHAT');
  eq('members 里有空串 ⇒ CHAT_MEMBERS_FAILED', chatTool.readPairMembers({ members: ['a', ''] }).reason,
    'CHAT_MEMBERS_FAILED');
  eq('正常两个 ⇒ ok 且各自去过空白',
    chatTool.readPairMembers({ members: [' id1 ', 'id2'] }).members.join('|'), 'id1|id2');
  check('键形态 = 16 位小写 hex（库里存的是摘要，不是平台原值）',
    /^[0-9a-f]{16}$/.test(chatTool.pairKeyOf(['idA_123', 'idB_456']).key),
    chatTool.pairKeyOf(['idA_123', 'idB_456']).key);
  eq('无序对：交换顺序 ⇒ 同一个键（用户先点谁都不该影响归类）',
    chatTool.pairKeyOf(['idB_456', 'idA_123']).key, chatTool.pairKeyOf(['idA_123', 'idB_456']).key);
  eq('已知向量：算法被改动/常数被换时这条必须判红（钉住 FNV-1a32 + djb2 的拼接口径）',
    chatTool.pairKeyOf(['idA_123', 'idB_456']).key, '78de35a10e586ed5');
  check('不同的一对 ⇒ 不同的键（否则两个好友会被归到同一条档案）',
    chatTool.pairKeyOf(['idA_123', 'idC_789']).key !== chatTool.pairKeyOf(['idA_123', 'idB_456']).key,
    chatTool.pairKeyOf(['idA_123', 'idC_789']).key);
  eq('入参不合法 ⇒ BAD_MEMBERS（内部码，不给它上屏的机会）',
    chatTool.pairKeyOf(['only_one']).reason, 'BAD_MEMBERS');
  check('键里不含任何一段原 id 片段（D3：库里与屏上都不该能反推出平台标识）',
    chatTool.pairKeyOf(['idA_123', 'idB_456']).key.indexOf('idA') < 0
      && chatTool.pairKeyOf(['idA_123', 'idB_456']).key.indexOf('idB') < 0,
    chatTool.pairKeyOf(['idA_123', 'idB_456']).key);

  // ── startChatPick（pick_friend 批 2）：主包侧"发起选择聊天好友" ─────────────
  // 官方 §2.1 方式 1 是"普通模式下调 openChatTool 不传 roomid ⇒ 拉起会话列表"。真机验的是"平台给不给"（U-2），
  // 这里先把"给成任何一种样子时我们的出口对不对"钉死，否则真机上分不清是平台不支持还是我们写错了。
  eq('startChatPick 没有 openChatTool 接口 ⇒ CHAT_OPEN_FAILED（与"用户取消"分开）',
    (await chatTool.startChatPick({ url: 'index', wxApi: {} })).reason, 'CHAT_OPEN_FAILED');
  eq('startChatPick 的 url 为空 ⇒ 直接判失败，不发调用',
    (await chatTool.startChatPick({ url: '   ', wxApi: { openChatTool() {} } })).reason, 'CHAT_OPEN_FAILED');
  let pickUrl = '';
  const pickOk = await chatTool.startChatPick({
    url: 'index', wxApi: { openChatTool: (o) => { pickUrl = o.url; o.success({}); } }
  });
  eq('startChatPick 成功 ⇒ ok:true', pickOk.ok, true);
  eq('startChatPick 把 url 原样交给平台（不加工、不补斜杠）', pickUrl, 'index');
  eq('用户在会话列表里取消 ⇒ CHAT_OPEN_CANCELLED（不计进失败率，与 bind 同口径）',
    (await chatTool.startChatPick({
      url: 'index', wxApi: { openChatTool: (o) => o.fail({ errMsg: 'openChatTool:fail cancel' }) }
    })).reason, 'CHAT_OPEN_CANCELLED');
  eq('平台拒绝（非取消）⇒ CHAT_OPEN_FAILED 且**原文带上**（U-2 的读数就靠它）',
    (await chatTool.startChatPick({
      url: 'index',
      wxApi: { openChatTool: (o) => o.fail({ errMsg: '-80426 subPackage `/chatpick/` should be independent' }) }
    })).rawErrMsg, '-80426 subPackage `/chatpick/` should be independent');
  eq('接口直接抛错 ⇒ CHAT_OPEN_FAILED（异常不冒泡成整页失败）',
    (await chatTool.startChatPick({
      url: 'index', wxApi: { openChatTool() { throw new Error('boom'); } }
    })).reason, 'CHAT_OPEN_FAILED');
  let pickWatchdog = null;
  let pickLate = null;
  // 与 bind 同一条：mock 既不 success 也不 fail ⇒ 那个 Promise 永不结算，必须手动引爆看门狗再 await
  const pickPending = chatTool.startChatPick({
    url: 'index',
    wxApi: { openChatTool: (o) => { pickLate = o.success; } },
    setTimeout: (fn) => { pickWatchdog = fn; return 'T9'; },
    clearTimeout: () => {},
    timeoutMs: 4321
  });
  check('startChatPick 也登记了看门狗（挂死分支必须可测）', typeof pickWatchdog === 'function', typeof pickWatchdog);
  pickWatchdog();
  pickLate({});   // 迟到的"成功"不许改写已经判出的失败结局
  const pickTimeout = await pickPending;
  eq('发起选择挂死到点 ⇒ CHAT_OPEN_FAILED 并说明等了多久（可能未开放 = U-6）',
    pickTimeout.reason + '|' + /4321/.test(pickTimeout.detail), 'CHAT_OPEN_FAILED|true');
  eq('迟到的回调不产生第二个结局（done 闸门）', pickTimeout.ok, false);

  // 独立分包**引不到主包**是平台事实（v1 的 A′ 就是被它逼出来的）：一旦有人把 require 加回去，
  // 真机的表现是这一页白屏 + `require is not defined`，而编译期什么都不报 ⇒ 只能在这里钉。
  // ⚠️ 第一版的正则写成 `[^=\n]*require\(`，跨不过赋值号 ⇒ 变异 M1 不红（= 判据没牙，不是"改对了"）；
  //    现在直接找 `require(` 后面跟 `..` 或 `/` 的那一行，注释行跳过。
  const bridgeSource = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'chatpick', 'index.js'), 'utf8');
  const crossPackage = bridgeSource.split('\n')
    .map((line) => line.trim())
    .filter((line) => line.indexOf('//') !== 0 && /require\(\s*['"](\.\.|\/)/.test(line));
  check('分包页 `chatpick/index.js` 零跨包 require（独立分包引不到主包 ⇒ 加了就白屏）',
    crossPackage.length === 0, crossPackage.join(' ⏎ '));

  // ── 看门狗：**不注入也要武装**（24 卡 R-02，P1）──────────────────────────
  // 复现读数（审查者给的）：生产调用点只传 `{url}`，而三个函数原先一律写成"只有调用方注入才武装"
  // ⇒ 注册定时器数 = 0；平台一旦既不 success 也不 fail（本仓注释记过这种读数），页面就永久停在"绑定中"。
  // 这组断言把"缺省回退"钉死：把全局定时器换成记账替身，看三个函数是不是都会注册。
  const realSet = global.setTimeout;
  const realClear = global.clearTimeout;
  const armedMs = [];
  const armedFns = [];
  const clearedIds = [];
  global.setTimeout = (fn, ms) => { armedMs.push(ms); armedFns.push(fn); return 'T' + armedMs.length; };
  global.clearTimeout = (id) => { clearedIds.push(id); };
  try {
    chatTool.startChatPick({ url: 'index', wxApi: { openChatTool() { /* 永不回调 = 挂死 */ } } });
    check('R-02：`startChatPick` 不注入定时器时也武装看门狗（缺省回退全局 setTimeout）',
      armedMs.length === 1, armedMs.join(','));
    eq('R-02：缺省看门狗用的是默认超时阈值', armedMs[0], chatTool.DEFAULT_TIMEOUT_MS);
    chatTool.bind('index', { wxApi: { openChatTool() {} } });
    check('R-02：`bind` 同样有缺省回退（三处同一条口径）', armedMs.length === 2, armedMs.join(','));
    chatTool.readRoomId({ wxApi: { getChatToolInfo() {} } });
    check('R-02：`readRoomId` 同样有缺省回退（三处同一条口径）', armedMs.length === 3, armedMs.join(','));
    chatTool.startChatPick({ url: 'index', wxApi: { openChatTool() {} }, setTimeout: () => 'M1' });
    check('R-02：注入优先（注入存在时不许走全局替身）', armedMs.length === 3, armedMs.join(','));
    // 到点结算：手动触发缺省看门狗的回调，证明它不只是"注册了"，而是真的会收口
    const hang = chatTool.startChatPick({ url: 'index', wxApi: { openChatTool() {} } });
    armedFns[armedFns.length - 1]();
    const hangResult = await hang;
    eq('R-02：缺省看门狗到点 ⇒ CHAT_OPEN_FAILED（不是永远挂着）', hangResult.reason, 'CHAT_OPEN_FAILED');
    check('R-02：到点文案写明等了多久（用户与审查者都看得出是超时而非平台拒绝）',
      hangResult.detail.indexOf(String(chatTool.DEFAULT_TIMEOUT_MS)) >= 0, hangResult.detail);
    check('R-02：结算时把定时器清掉（不许每次调用留一个定时器）', clearedIds.length >= 1, clearedIds.join(','));
  } finally {
    global.setTimeout = realSet;
    global.clearTimeout = realClear;
  }
}


/**
 * §11b 建档浮层的纯逻辑（`pages/archive-list/sheet-flow.js`）
 *
 * 为什么有这一节：24 卡 **R-01（P1）** 是**页面层**缺陷 —— "换绑之后残留的会话键被下一次降级建档
 * 写进第二条档案"，破"一个键最多一条档案"这条 M5 的核心不变量。`selftest` 不 require 页面（TD-016），
 * 所以那段逻辑被抽成页面专用零件（R-11），**这一节就是它的机器闸**：令牌的"读后即清"、
 * "降级路结构上拿不到键"、值域闸的"替用户改数据"三件都在这里被钉住。
 * @param {{eq:function, check:function, sheetFlow:object, storage:object}} kit
 */
/**
 * §11b-1 会话键的一次性令牌（R-01：写一次、读一次、读完即清；降级路**结构上**拿不到键）
 * ⚠️ **R-22（24 卡 r2）**：§11b 原先是一个 **139 行**的函数（> AGENTS §11.1 的 50 行）⇒ 按主题切成
 * 每节 ≤50 行的小函数，由文件末尾的 `runSheetFlowSection` 统一调度。判定器仍由调用方注入
 * （`kit.eq`/`kit.check`）⇒ **同一个计数器**，末尾"断言 N 条"这个读数不会被切成两份。
 */
function runSheetFlowKeySection(kit) {
  const eq = kit.eq;
  const check = kit.check;
  const sheetFlow = kit.sheetFlow;
  const storage = kit.storage;

  // ── R-01：会话键的一次性令牌 ─────────────────────────────────────
  const KEY_A = 'aaaa1111bbbb2222';
  const t1 = sheetFlow.createKeyToken();
  t1.set(KEY_A);
  const normal = sheetFlow.resolveChatKeyForSave(t1, true, '');
  eq('R-01①：正常路径（从会话进 + 令牌有键）⇒ 拿到键', normal.key, KEY_A);
  eq('R-01①：来源标 token（排查时能分清键从哪来）', normal.source, 'token');
  const second = sheetFlow.resolveChatKeyForSave(t1, true, '');
  eq('R-01④：令牌**读后即清** —— 第二次调用拿不到同一个键', second.key, '');
  eq('R-01④：清空后来源落 none（不是"又拿了一次 token"）', second.source, 'none');

  const t2 = sheetFlow.createKeyToken();
  t2.set(KEY_A);
  const degraded = sheetFlow.resolveChatKeyForSave(t2, false, '');
  eq('R-01②：降级路径（fromChatFlow=false）⇒ **拿不到键**，哪怕令牌里还有残留', degraded.key, '');
  eq('R-01②：来源标 degraded（这条读数就是"这次为什么没带键"的答案）', degraded.source, 'degraded');
  eq('R-01②：降级决议也会把令牌清掉（残留不会活到下一次保存）', t2.peek(), '');

  // 换绑冲突后的现场：`applyRebind` 三个出口都调 `abandonKey()`（= clear + fromChatFlow=false）
  const t3 = sheetFlow.createKeyToken();
  t3.set('cccc3333dddd4444');
  t3.clear();
  const afterRebind = sheetFlow.resolveChatKeyForSave(t3, false, '');
  eq('R-01③：换绑冲突之后 ⇒ 下一次保存拿不到键（R-01 的原始复现路径）', afterRebind.key, '');
  check('R-01：`peek()` 只剩只读语义（上一条已证 take 会清空，这里证明 peek 不会"复活"它）',
    t3.peek() === '', t3.peek());

  // 老路（N2）：令牌空但平台原值在 ⇒ 按 DESIGN §10 待裁②=A 的共存口径仍可用它
  const legacy = sheetFlow.resolveChatKeyForSave(sheetFlow.createKeyToken(), true, 'open_single_roomid_x');
  eq('待裁②=A：无令牌但有平台原值 ⇒ 用原值（chat_pick 老路不回归）', legacy.key, 'open_single_roomid_x');
  eq('待裁②=A：来源标 platform（与摘要键可区分）', legacy.source, 'platform');

  const t5 = sheetFlow.createKeyToken();
  t5.set(12345);
  eq('令牌只采纳字符串：数字被当"没有"（键只会来自 pairKeyOf 的 hex）', t5.peek(), '');

  // 与写盘口对齐：空键决议落库 ⇒ 库里就该是空串（"这次不带键"这件事库层看得见）
  const created = storage.createCustomer({ building: 'D4', dorm: '522', name: '降级建档', chatRoomId: degraded.key });
  eq('R-01②：降级决议落库 ⇒ 库里 chatRoomId 是空串（不是别人的键）',
    created.ok && created.customer.chatRoomId, '');

}

/**
 * §11b-2 值域闸 + 重入判定（R-11 的抽件 / R-02 的可测核心 / R-20 的序关系）
 */
function runSheetFlowFormSection(kit) {
  const eq = kit.eq;
  const check = kit.check;
  const sheetFlow = kit.sheetFlow;
  const chatTool = kit.chatTool;   // R-20 的序关系断言要它（`DEFAULT_TIMEOUT_MS`）
  const buildings = require('../utils/buildings.js');

  // ── 值域闸（R-11 从 `onSheetSave` 抽出来的那一段）──────────────────
  const okForm = sheetFlow.gateSheetForm({ building: 'd4', dorm: '522' }, buildings);
  eq('闸①：小写楼区被规范成大写（**唯一**允许的改写）', okForm.ok && okForm.building, 'D4');
  eq('闸①：宿舍号原样通过（不剥前导零、不截断）', okForm.dorm, '522');
  check('闸②：缺一格 ⇒ 拦住并给"照 D4-522 写"那句人话',
    sheetFlow.gateSheetForm({ building: '', dorm: '522' }, buildings).message.indexOf('D4-522') >= 0, true);
  check('闸③：`D4`+`522A`（多余内容）⇒ 拦住（旧实现会把 A 静默当称呼丢掉 = 替用户改数据，R2-C02 同族）',
    sheetFlow.gateSheetForm({ building: 'D4', dorm: '522A' }, buildings).ok === false, null);
  check('闸③：拦住时把"系统读到的"和"你写的"都说出来（不然人不知道该改哪）',
    sheetFlow.gateSheetForm({ building: 'D4', dorm: '522A' }, buildings).message.indexOf('522A') >= 0, true);
  check('闸④：`0522` 前导零 ⇒ 拦住（解析器会剥成 522，同样属于替用户改数据）',
    sheetFlow.gateSheetForm({ building: 'D4', dorm: '0522' }, buildings).ok === false, null);
  eq('闸⑤：楼区不在值域（`E9`）⇒ 复用 buildings 的**实际**码 NO_BUILDING（不是契约别名）',
    sheetFlow.gateSheetForm({ building: 'E9', dorm: '522' }, buildings).reason, 'NO_BUILDING');
  eq('闸⑥：宿舍号 99（<100）⇒ NO_DORM', sheetFlow.gateSheetForm({ building: 'D4', dorm: '99' }, buildings).reason,
    'NO_DORM');

  // ── 重入判定（R-02 的可测核心）──────────────────────────────────
  eq('重入①：没在拉起 ⇒ 放行', sheetFlow.shouldStartPick({ picking: false, startedAt: 0 }, 1000).start, true);
  const hold = sheetFlow.shouldStartPick({ picking: true, startedAt: 1000 }, 3000);
  eq('重入②：正在拉起且未超窗 ⇒ 不启动（防两次会话选择互相顶掉）', hold.start, false);
  eq('重入②：但要给提示（⛔ 不许静默吞点击 —— R-02 之前这里只 toast 一句就 return）', hold.hint, true);
  eq('重入③：卡死超窗 ⇒ **允许重试**（否则 picking 永久为真，fab 与「换绑」全废）',
    sheetFlow.shouldStartPick({ picking: true, startedAt: 1000 }, 1000 + sheetFlow.PICK_STALE_MS + 1).start, true);
  eq('重入④：`picking` 为真但没有时间戳（旧状态残留）⇒ 判卡死、放行',
    sheetFlow.shouldStartPick({ picking: true }, 1000).start, true);

  // ⚠️ R-20（24 卡 r2）：卡死窗口**必须大于**看门狗 —— 否则"超窗允许重试"会与仍在飞的调用叠成
  // 两次会话选择（第二次顶掉第一次的选择）。这条序关系是重入闸成立的前提，之前既无注释也无断言。
  check('R-20：`PICK_STALE_MS` > `chatTool.DEFAULT_TIMEOUT_MS`（看门狗先结算、先复位 picking）',
    sheetFlow.PICK_STALE_MS > chatTool.DEFAULT_TIMEOUT_MS,
    sheetFlow.PICK_STALE_MS + ' vs ' + chatTool.DEFAULT_TIMEOUT_MS);
}

/**
 * §11b-3 落库前复检（R-01 ③ 的第二道闸：`planSave`）
 */
function runSheetFlowPlanSection(kit) {
  const eq = kit.eq;
  const check = kit.check;
  const sheetFlow = kit.sheetFlow;
  const KEY_A = 'aaaa1111bbbb2222';

  // R-01③ 的第二道闸：落库前复检（`planSave`）
  eq('计划①：决议没给键 ⇒ 直接建档（不必查库）',
    sheetFlow.planSave({ key: '' }, () => ({ ok: true, customer: null })).action, 'create');
  const planDupRow = { building: 'D4', dorm: '522', name: '小王' };   // 本组自用（下面的文案组另有一份）
  const planHit = sheetFlow.planSave({ key: KEY_A }, () => ({ ok: true, customer: planDupRow }));
  check('计划②：带键且库里已有人持有 ⇒ 走挡板（不许带着别人的键建第二条）',
    planHit.action === 'dup' && planHit.dup === planDupRow, planHit.action);
  eq('计划③：带键但库里没人持有 ⇒ 正常建档',
    sheetFlow.planSave({ key: KEY_A }, () => ({ ok: true, customer: null })).action, 'create');
  eq('计划④：查库失败 ⇒ action=error（⛔ 不许把"读不出来"当"没建过"）',
    sheetFlow.planSave({ key: KEY_A }, () => ({ ok: false, reason: 'STORE_CORRUPT' })).action, 'error');

}

/**
 * §11b-4 三段上屏文案（D3 纪律的机器闸：只出指纹与锚，⛔ 绝不出键原值）
 */
function runSheetFlowCopySection(kit) {
  const eq = kit.eq;
  const check = kit.check;
  const sheetFlow = kit.sheetFlow;
  const chatTool = kit.chatTool;

  // ── 三段上屏文案：D3 纪律的机器闸（R-03 / M11）────────────────────────
  const RAW_KEY = 'aaaa1111bbbb2222';
  const printed = chatTool.fingerprint(RAW_KEY);
  const dupRow = { building: 'D4', dorm: '522', name: '小王' };
  const miss = sheetFlow.describeSessionKey(printed, null);
  eq('文案①：未命中 ⇒ 不显示查重提示', miss.dup === false && miss.sheetDupText === '', true);
  check('文案①：状态行带指纹（让人能核对"是不是这条会话"）', miss.chatState.indexOf(printed) >= 0, miss.chatState);
  const hit = sheetFlow.describeSessionKey(printed, dupRow);
  eq('文案②：命中 ⇒ 挡住并给出已有档案的锚（人话）', hit.dup === true && hit.label, 'D4 522 小王');
  check('文案②：查重提示里写明两条出路（去这条档案 / 仍要新建）',
    hit.sheetDupText.indexOf('去这条档案') >= 0 && hit.sheetDupText.indexOf('仍要新建') >= 0, hit.sheetDupText);
  check('文案②（D3 硬约束）：三段文案里**一个字符都不含键原值**（只允许指纹）',
    (hit.chatState + hit.chatEvidence + hit.sheetDupText + miss.chatState + miss.chatEvidence)
      .indexOf(RAW_KEY) < 0, printed);

  const target = { label: 'X3 301 占着的人' };
  const doneNotice = sheetFlow.describeRebindNotice({ ok: true }, target, printed);
  check('换绑文案①：成功 ⇒ 说清换了谁 + 指纹', doneNotice.indexOf('X3 301 占着的人') >= 0
    && doneNotice.indexOf(printed) >= 0, doneNotice);
  check('换绑文案②：本来就绑着它 ⇒ 明说"没有改动"（不让人以为发生了什么）',
    sheetFlow.describeRebindNotice({ ok: true, unchanged: true }, target, printed).indexOf('本来就是它') >= 0, null);
  const clashNotice = sheetFlow.describeRebindNotice({
    ok: false, reason: 'REBIND_CONFLICT',
    holder: { building: 'D4', dorm: '522', name: '先占的人', deleted: true }
  }, target, printed);
  check('换绑文案③：冲突 ⇒ 指名持有者的锚、标明"已删除"、带指纹',
    clashNotice.indexOf('D4 522 先占的人') >= 0 && clashNotice.indexOf('（那条档案已删除）') >= 0
      && clashNotice.indexOf(printed) >= 0, clashNotice);
  check('换绑文案③（D3）：冲突文案里不含键原值', clashNotice.indexOf(RAW_KEY) < 0, clashNotice);
  check('换绑文案④：其他失败 ⇒ 走 reason.js 单源的"换绑没成功"',
    sheetFlow.describeRebindNotice({ ok: false, reason: 'NOT_FOUND' }, target, printed).indexOf('换绑没成功') >= 0, null);

}

/**
 * §11b-5 N2 老路的读数行（U-5 的现场）+ R-14 脱敏调用点 + R-16 平台原值生命周期
 */
function runSheetFlowLegacySection(kit) {
  const eq = kit.eq;
  const check = kit.check;
  const sheetFlow = kit.sheetFlow;
  const chatTool = kit.chatTool;

  // ── N2 老路的读数行（U-5 的现场）：明文/密文/无返回三种形态 ──────────────
  const encrypted = sheetFlow.describeLegacyPickup(
    { info: { errMsg: 'getChatToolInfo:ok', encryptedData: 'E', iv: 'I' } }, chatTool);
  eq('老路①：**加密返回**（官方口径那条）⇒ 拿不到会话标识', encrypted.roomId, '');
  check('老路①：读数行带出真实返回字段名（U-5 就靠这一行判"平台到底给了什么"）',
    encrypted.evidence.indexOf('返回字段=errMsg,encryptedData,iv') >= 0, encrypted.evidence);
  check('老路①：状态行是"不影响建档"那条人话（降级不许吓人）',
    encrypted.stateText.indexOf('不影响建档') >= 0, encrypted.stateText);
  const RAW_ROOM = 'aB3-xY9_zK2mNq4rT7uV';
  const plain = sheetFlow.describeLegacyPickup({ info: { errMsg: 'ok', open_single_roomid: RAW_ROOM } }, chatTool);
  eq('老路②：明文返回（U-5 若当真给明文）⇒ 原值被采纳', plain.roomId, RAW_ROOM);
  check('老路②（D3）：状态行只出指纹', plain.stateText.indexOf(chatTool.fingerprint(RAW_ROOM)) >= 0
    && plain.stateText.indexOf(RAW_ROOM) < 0, plain.stateText);
  const noInfo = sheetFlow.describeLegacyPickup({ infoErr: 'openChatTool:fail something' }, chatTool);
  eq('老路③：桥里没有 `info` 只有 `infoErr` ⇒ 同样判"读不到"', noInfo.roomId, '');
  check('老路③：读数行带上失败原文（取证要原文，不许吞掉）',
    noInfo.evidence.indexOf('openChatTool:fail something') >= 0, noInfo.evidence);

  // ── R-14（24 卡 r2，P2）：老路的脱敏闸在"拿不到 roomId"时**空转** ⇒ 平台原文里的会话标识原样上屏 ──
  // 老路③ 恰好就是病灶现场：`roomId === ''` ⇒ `maskRoomIds(text, [''])` 是恒等函数。下面三条把**调用点**
  // 钉住（r2 的变异 M5b 证过：把三处 `maskRoomIds` 整段摘掉，当时全绿 = 这条纪律没人守）。
  const idInErr = 'getChatToolInfo:fail open_single_roomid=' + RAW_ROOM + ' (something)';
  const leakyLegacy = sheetFlow.describeLegacyPickup({ infoErr: idInErr }, chatTool);
  check('老路⑤（R-14）：`roomId` 为空 + 原文夹带长 id ⇒ **形状兜底**必须隐去它（原样上屏 = D3 泄漏）',
    leakyLegacy.evidence.indexOf(RAW_ROOM) < 0 && leakyLegacy.evidence.indexOf('已隐去') >= 0,
    leakyLegacy.evidence);
  const knownRoom = sheetFlow.describeLegacyPickup({
    info: { errMsg: 'ok', open_single_roomid: RAW_ROOM },
    bindErr: 'openChatTool:fail roomid=' + RAW_ROOM
  }, chatTool);
  check('老路⑥（R-14）：**已知 roomId** 的候选一律换成项目口径的指纹（这条是调用点的牙：变异必红）',
    knownRoom.evidence.indexOf(chatTool.fingerprint(RAW_ROOM)) >= 0
      && knownRoom.evidence.indexOf(RAW_ROOM) < 0, knownRoom.evidence);
  const partialTool = { modeSnapshot: () => ({}), fingerprint: () => '（无）' };
  const noMaskerLegacy = sheetFlow.describeLegacyPickup({ infoErr: 'raw ' + RAW_ROOM }, partialTool);
  check('老路⑦（R-14 兜底）：脱敏器不可用 ⇒ 原文一个字都不上屏（宁可看不见，不许原样上屏）',
    noMaskerLegacy.evidence.indexOf('脱敏器不可用') >= 0
      && noMaskerLegacy.evidence.indexOf(RAW_ROOM) < 0, noMaskerLegacy.evidence);

}

/**
 * §11b-5b 平台原值的生命周期（R-16；页面层没有断言能力 ⇒ 用 §10 既有先例的"源码扫描"钉住不变量）
 */
function runSheetFlowLifecycleSection(kit) {
  const check = kit.check;
  // R-16（24 卡 r2，P2）：平台原值必须与会话键**同一条生命周期** —— 否则上一轮老路拿到的原值会活到
  // 下一轮、被写进新档案（r2 的运行期复现：新档案挂上前一条会话的原值 ⇒ "按会话自动归类"归错人）。
  const pageSource = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'pages', 'archive-list', 'index.js'), 'utf8');
  const abandonBody = (/abandonKey\(\)\s*\{([\s\S]*?)\}/.exec(pageSource) || ['', ''])[1];
  check('R-16：`abandonKey()` 必须同时清掉平台原值（`this.chatRoomId = \'\'`）',
    abandonBody.indexOf("this.chatRoomId = ''") >= 0, abandonBody.trim().replace(/\s+/g, ' '));
}

/**
 * §11b-6 失败证据行（真机读数① 暴露的仪器缺陷：`startChatPick` 五个出口曾被压成同一行）
 */
function runSheetFlowEvidenceSection(kit) {
  const check = kit.check;
  const sheetFlow = kit.sheetFlow;
  const chatTool = kit.chatTool;
  const RAW_ROOM = 'aB3-xY9_zK2mNq4rT7uV';   // 本组自用（老路组另有一份同值）

  // ── 失败证据行（真机读数① 暴露的仪器缺陷：五个出口被压成同一行）──────────────
  const boom = sheetFlow.formatPickEvidence(
    { reason: 'CHAT_OPEN_FAILED', detail: 'openChatTool:fail valid url' }, chatTool, { roomIds: [] });
  check('证据①：reason 与 detail 都带出来（原先只有 reason + 一句写死的"会话选择未完成"）',
    boom.indexOf('reason=CHAT_OPEN_FAILED') >= 0 && boom.indexOf('detail=openChatTool:fail valid url') >= 0, boom);
  check('证据②：没有任何原文 ⇒ 明说"平台没给 errMsg"，⛔ 不留空（真机读数① 那种"什么都说明不了"就是空）',
    sheetFlow.formatPickEvidence({ reason: 'CHAT_OPEN_FAILED' }, chatTool).indexOf('平台没给 errMsg') >= 0, null);
  const leaky = sheetFlow.formatPickEvidence(
    { reason: 'CHAT_OPEN_FAILED', rawErrMsg: 'fail: roomid=' + RAW_ROOM + ' rejected' }, chatTool,
    { roomIds: [RAW_ROOM] });
  check('证据③（D3）：已知候选被换成**指纹**（前 6 位 + 总长度，与项目既有口径一致）',
    leaky.indexOf(chatTool.fingerprint(RAW_ROOM)) >= 0 && leaky.indexOf(RAW_ROOM) < 0, leaky);
  const shapeOnly = sheetFlow.formatPickEvidence(
    { reason: 'CHAT_OPEN_FAILED', rawErrMsg: 'fail: id=' + RAW_ROOM }, chatTool, { roomIds: [] });
  check('证据④（D3 形状兜底）：一个候选都没有时，"≥16 位 id 字符集"的长 token 也必须隐去',
    shapeOnly.indexOf('（已隐去 20 位标识）') >= 0 && shapeOnly.indexOf(RAW_ROOM) < 0, shapeOnly);
  const noMasker = sheetFlow.formatPickEvidence(
    { reason: 'CHAT_OPEN_FAILED', detail: 'raw ' + RAW_ROOM }, {}, { roomIds: [RAW_ROOM] });
  check('证据⑤（D3 兜底）：脱敏器不可用 ⇒ **原文一个字都不上屏**（宁可看不见，不许原样上屏）',
    noMasker.indexOf('脱敏器不可用') >= 0 && noMasker.indexOf(RAW_ROOM) < 0, noMasker);
  const longEvidence = sheetFlow.formatPickEvidence(
    { reason: 'CHAT_OPEN_FAILED', detail: Array(121).join('fail 参数不对 ') }, chatTool, { maxLen: 60 });
  check('证据⑥：超长 ⇒ 截断并标注原文总字数，头部保留可判读的 reason=',
    longEvidence.length <= 60 && longEvidence.indexOf('reason=CHAT_OPEN_FAILED') === 0
      && longEvidence.indexOf('已截断') >= 0, longEvidence);
  check('证据⑦：`reason` 缺失/非字符串 ⇒ 落 CHAT_OPEN_FAILED，不崩',
    sheetFlow.formatPickEvidence({ detail: 'x' }, chatTool).indexOf('reason=CHAT_OPEN_FAILED') === 0
      && sheetFlow.formatPickEvidence({ reason: 42 }, chatTool).indexOf('reason=CHAT_OPEN_FAILED') === 0, null);
  check('证据⑧：入参 `null` / 非对象 ⇒ 不崩且给兜底句',
    sheetFlow.formatPickEvidence(null, chatTool).indexOf('平台没给 errMsg') >= 0
      && sheetFlow.formatPickEvidence('boom', chatTool).indexOf('reason=') === 0, null);
  const sameText = sheetFlow.formatPickEvidence(
    { reason: 'CHAT_OPEN_FAILED', detail: 'boom', rawErrMsg: 'boom' }, chatTool);
  check('证据⑨：`detail` 与 `rawErrMsg` 装同一句原文时只显示一次（平台 fail 两个字段常常同值）',
    sameText.indexOf('detail=boom') >= 0 && sameText.split('boom').length === 2, sameText);
}

/**
 * §11b-7 内存桥路径判据（R-03；r2 的变异 M4 证明它原先**没有机器闸**：改回"键存在"仍全绿）
 */
function runSheetFlowPathSection(kit) {
  const eq = kit.eq;
  const sheetFlow = kit.sheetFlow;
  eq('路径①（R-03）：桥里 `members` 是数组 ⇒ 走会话键路',
    sheetFlow.pickupPathOf({ members: ['a', 'b'] }), 'key');
  eq('路径②（R-03）：`members` 恒存在但是 null ⇒ **必须走老路**（否则 U-5 的取证行永不出现）',
    sheetFlow.pickupPathOf({ members: null, info: { errMsg: 'x' } }), 'legacy');
  eq('路径③：`members` 是别的类型（字符串）⇒ 老路（不把畸形值当数组用）',
    sheetFlow.pickupPathOf({ members: 'a,b' }), 'legacy');
  eq('路径④：桥里什么都没有 / `null` ⇒ 老路，且不崩', sheetFlow.pickupPathOf(null), 'legacy');
}

/**
 * §11b-8 url 形态轮盘（真机读数②：`openChatTool:fail invaild chatTool subpackage url`）
 *
 * 为什么要机器闸：形态只能靠真机试出来（官方文档没给样例），而"该不该试下一个"这条判定是**纯函数** ⇒
 * 它可以被断言。两条容易被写坏的：① 把"用户取消/超时"也当成形态不对 ⇒ 一次点击被拖成三次无效往返；
 * ② 候选用尽还继续试 ⇒ 无限重试。
 */
function runSheetFlowUrlWheelSection(kit) {
  const eq = kit.eq;
  const check = kit.check;
  const sheetFlow = kit.sheetFlow;
  const REAL_ERR = 'openChatTool:fail invaild chatTool subpackage url';   // 平台原文（含平台自己的拼写）
  const list = sheetFlow.chatToolUrlCandidates();
  eq('轮盘①：候选 3 个且顺序 = 绝对页路径 → 带根相对 → 分包内相对（最可能在前）',
    list.join('|'), '/chatpick/index|chatpick/index|index');
  eq('轮盘②：首试 = 绝对页路径（`index` 已被真机判不合法）', list[0], '/chatpick/index');
  eq('轮盘③：命中真机签名 ⇒ 给下一个', sheetFlow.nextChatToolUrl(['/chatpick/index'], REAL_ERR), 'chatpick/index');
  eq('轮盘④：第三个（已试两个）⇒ 最后一个候选', sheetFlow.nextChatToolUrl(['/chatpick/index', 'chatpick/index'], REAL_ERR), 'index');
  eq('轮盘⑤：候选用尽 ⇒ `null`（**有界**，绝不循环）',
    sheetFlow.nextChatToolUrl(['/chatpick/index', 'chatpick/index', 'index'], REAL_ERR), null);
  eq('轮盘⑥：用户取消的原文 ⇒ **不换形态**（换 url 治不好它，还会把用户的取消当失败连试三次）',
    sheetFlow.nextChatToolUrl(['/chatpick/index'], 'openChatTool:fail cancel'), null);
  eq('轮盘⑦：超时/mock 的 detail ⇒ 不换形态',
    sheetFlow.nextChatToolUrl(['/chatpick/index'], '等待微信响应超过 8000 毫秒'), null);
  check('轮盘⑧：入参畸形（`tried` 非数组 / errMsg 非字符串）⇒ 不抛，且仍按有界口径给答案',
    sheetFlow.nextChatToolUrl(null, REAL_ERR) === '/chatpick/index'
      && sheetFlow.nextChatToolUrl(['/chatpick/index'], null) === null
      && sheetFlow.nextChatToolUrl(['/chatpick/index'], undefined) === null,
    String(sheetFlow.nextChatToolUrl(null, REAL_ERR)));
  const withTried = sheetFlow.formatPickEvidence(
    { reason: 'CHAT_OPEN_FAILED', rawErrMsg: REAL_ERR },
    kit.chatTool,
    { roomIds: ['aB3-xY9_zK2mNq4rT7uV'], triedUrls: ['/chatpick/index', 'chatpick/index'] });
  check('轮盘⑨：证据行带出**试过的形态链**（第一名即赢家 ⇒ 一张截图可判读），且形态串里不含 D3',
    withTried.indexOf('url=/chatpick/index→chatpick/index ｜ reason=') === 0
      && withTried.indexOf('aB3-xY9') < 0,
    withTried);
}

/**
 * §11b 建档浮层纯逻辑 —— **调度入口**（小节：1 令牌 / 2 值域闸+重入 / 3 落库前复检 / 4 上屏文案 /
 * 5 老路与脱敏 / 6 失败证据行 / 7 内存桥路径判据 / 8 url 形态轮盘 / 9 会话键可核对性）
 *
 * 为什么有这一节：24 卡 **R-01（P1）** 是**页面层**缺陷（残留会话键被写进第二条档案，破"一个键最多
 * 一条档案"这条 M5 核心不变量）。`selftest` 不 require 页面（TD-016）⇒ 那段逻辑被抽成页面专用零件
 * （R-11），**这一节就是它的机器闸**。R-22：本节原先是一个 139 行的函数 ⇒ 按主题切成 ≤50 行的小节。
 * @param {{eq:function, check:function, sheetFlow:object, storage:object, chatTool:object}} kit
 */
function runSheetFlowSection(kit) {
  console.log('§11b 建档浮层纯逻辑（令牌 / 值域闸 / 重入 / 文案 / 老路脱敏 / 路径判据 / url 轮盘）');
  runSheetFlowKeySection(kit);
  runSheetFlowFormSection(kit);
  runSheetFlowPlanSection(kit);
  runSheetFlowCopySection(kit);
  runSheetFlowLegacySection(kit);
  runSheetFlowLifecycleSection(kit);
  runSheetFlowEvidenceSection(kit);
  runSheetFlowPathSection(kit);
  runSheetFlowUrlWheelSection(kit);
  runSheetFlowKeyDisplaySection(kit);
}

/**
 * §11c 会话提示槽的优先级（pick_friend 范围扩展批；`pages/recognize/form-parts.js`）
 * 为什么单开一节：M7 归类是"自动归类"唯一的收益兑现处，而它读哪个槽（摘要 / 平台原值 / 都没有）
 * 决定了这次预选可不可信、文案该怎么说 —— 这三条以前散在页面里，页面层没有断言能力（TD-016）。
 * @param {{eq:function, formParts:object}} kit
 */
function runChatKeyHintSection(kit) {
  console.log('§11c 会话提示槽（摘要优先 / 旧原值仅兼容 / 不猜）');
  const { eq, formParts } = kit;
  const onlyKey = { app: { globalData: { chatKey: 'DIGEST', chatRoomId: 'RAW' } } };
  const onlyRaw = { app: { globalData: { chatRoomId: 'RAW' } } };
  const neither = { app: { globalData: {} } };
  eq('两个槽都有 ⇒ 用摘要键（用户裁决②：摘要为主、原值仅兼容）', formParts.readRoomHint(onlyKey), 'DIGEST');
  eq('只有平台原值 ⇒ 回退到兼容分支', formParts.readRoomHint(onlyRaw), 'RAW');
  eq('两个都没有 ⇒ 空串（M7 的"未命中"分支，不猜）', formParts.readRoomHint(neither), '');
  eq('来源标记 = chatKey（文案要说清按什么预选）', formParts.readRoomHintKind(onlyKey), 'chatKey');
  eq('来源标记 = chatRoomId（旧口径）', formParts.readRoomHintKind(onlyRaw), 'chatRoomId');
  eq('来源标记 = 空串（都读不到）', formParts.readRoomHintKind(neither), '');
  eq('非字符串槽值不许当命中（脏数据不进比对）',
    formParts.readRoomHint({ app: { globalData: { chatKey: 123, chatRoomId: 'RAW' } } }), 'RAW');
  const hitKey = formParts.preselectNote('DIGEST', 'c1', 'D4-522 小王', 'chatKey');
  const hitRaw = formParts.preselectNote('RAW', 'c1', 'D4-522 小王', 'chatRoomId');
  eq('命中文案（摘要）说明来源是会话键、且**明说系统不替你选**',
    hitKey.indexOf('按会话键') >= 0 && hitKey.indexOf('系统不会替你选') >= 0, true);
  eq('命中文案（旧口径）写明是旧口径，别让人以为摘要认过了', hitRaw.indexOf('旧口径的会话标识') >= 0, true);
  // 清单入口**不谈会话**（2026-09-25 真机反馈：用户手选另一位客户后，屏上还留着这句 ⇒ 读成"锁回前一个"）
  eq('清单入口不显示会话命中文案',
    formParts.preselectNote('DIGEST', 'c1', 'D4-522 小王', 'chatKey', 'list'), '');
  eq('未命中文案 = 系统不猜，请手选',
    formParts.preselectNote('DIGEST', '', '', 'chatKey'), '这条会话没有唯一对上某个档案 —— 系统不猜，请手选客户');
  eq('没有提示 ⇒ 不显示这一行', formParts.preselectNote('', '', '', ''), '');
  // ⛔ D3/M11：文案里绝不许出现键本身（两种来源都不许）
  eq('文案里不含摘要原文', hitKey.indexOf('DIGEST') < 0 && hitRaw.indexOf('RAW') < 0, true);
  // 归类入口本身也要有牙（M7 的核心："宁可不猜"必须在 roomPreselect 这一层也成立）
  const book2 = [{ id: 'c1', chatRoomId: 'DIGEST' }, { id: 'c2', chatRoomId: 'ffffffffffffffff' }];
  eq('归类入口：摘要命中 ⇒ 那条 id', formParts.roomPreselect(book2, 'DIGEST'), 'c1');
  eq('归类入口：零命中 ⇒ 空串（⛔ 不许猜第一个）', formParts.roomPreselect(book2, '0000000000000000'), '');
  eq('归类入口：多命中 ⇒ 空串（⛔ 不许挑一个）',
    formParts.roomPreselect([{ id: 'a', chatRoomId: 'DIGEST' }, { id: 'b', chatRoomId: 'DIGEST' }], 'DIGEST'), '');
}

/**
 * §11b-9 会话键的**可核对性**与归类槽（pick_friend 范围扩展批）
 * 用户裁决①：列表出**短键**、详情/浮层出**完整摘要**；裁决②：归类按**摘要键**为主、旧原值仅兼容。
 * 这里的源码级断言是"宁可钉一把粗的"：平台原值不许进 `setData`、`chatKeyDigest` 只许来自 `fullChatKey`
 * —— 24 卡 r2 的教训（两处判据没牙 ⇒ 改回去仍全绿）就发生在这一族不变量上。
 * @param {{eq:function, sheetFlow:object}} kit
 */
function runSheetFlowKeyDisplaySection(kit) {
  console.log('§11b-9 会话键的可核对性（短键 / 完整摘要 / 行对象 / 归类槽）');
  const { eq, sheetFlow } = kit;
  const fs = require('fs');
  const path = require('path');
  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  const KEY = 'a1b2c3d4e5f60718';
  eq('短键 = 固定标识 + 后 6 位', sheetFlow.shortChatKey(KEY), '会话键 …f60718');
  eq('短键⛔不许把整键端出去', sheetFlow.shortChatKey(KEY).indexOf(KEY) < 0, true);
  eq('短键：空串 ⇒ 空串（WXML 的 wx:if 不渲染）', sheetFlow.shortChatKey(''), '');
  eq('短键：非字符串 ⇒ 空串（脏数据不炸）', sheetFlow.shortChatKey(undefined), '');
  eq('完整摘要行带前缀', sheetFlow.fullChatKey(KEY), '本地摘要 ' + KEY);
  eq('完整摘要：空 ⇒ 空串', sheetFlow.fullChatKey('   '), '');
  const rows = sheetFlow.toRowViews([
    { id: 'c1', building: 'D4', dorm: '522', name: '小王', chatRoomId: KEY },
    { id: 'c2', building: 'D3', dorm: '444', name: '', chatRoomId: '' }
  ]);
  eq('行对象：字段齐全 + 单源标签 + 短键', JSON.stringify(rows[0]),
    JSON.stringify({ id: 'c1', building: 'D4', dorm: '522', name: '小王', label: 'D4 522 小王', subName: '小王', keyTag: '会话键 …f60718' }));
  // E 条（2026-09-25 真机反馈「标签应该同步显示 A,B,C 等等」）：
  // 主行必须是**单源标签**（空称呼派生名自带 A/B/C ⇒ 同宿舍两位分得清），副行不再把同一串字重复一遍。
  const derivedRow = sheetFlow.toRowViews([{ id: 'c3', building: 'D4', dorm: '555', name: 'D4 555 A' }])[0];
  eq('空称呼派生名 ⇒ 主行带 A/B/C 后缀', derivedRow.label, 'D4 555 A');
  eq('空称呼派生名 ⇒ 副行不再重复同一串字', derivedRow.subName, '');
  eq('行对象：没有键的档案 ⇒ 短键为空串（不编一个）', rows[1].keyTag, '');
  eq('行对象：非数组 ⇒ 空数组（不抛）', JSON.stringify(sheetFlow.toRowViews(null)), '[]');
  // 归类：喂摘要进去即可命中（`pickCustomerByRoom` 不变；多义/零命中一律不猜）
  const aggregate = require('../utils/aggregate.js');
  const book = [{ id: 'c1', chatRoomId: KEY }, { id: 'c2', chatRoomId: 'ffffffffffffffff' }];
  eq('归类：摘要键唯一命中', aggregate.pickCustomerByRoom(book, KEY), 'c1');
  eq('归类：未命中 ⇒ 空串（不猜）', aggregate.pickCustomerByRoom(book, '0000000000000000'), '');
  eq('归类：多命中 ⇒ 空串（不猜，M5 的核心矛盾）',
    aggregate.pickCustomerByRoom([{ id: 'a', chatRoomId: KEY }, { id: 'b', chatRoomId: KEY }], KEY), '');
  // ── 源码级断言（粗但有效：这一族不变量出问题= D3 回潮）────────────────────
  // 覆盖面 = `pages/` 下**所有 .js（递归）**。原来是硬编码 4 个文件，于是新页面全在覆盖之外
  // （`customer-detail/` 与详情批新增的 `swipe.js`/`recycle.js`/`row-actions.js`/`sheet-line.js`）——
  // 用户 2026-09-25 批"把新页面纳入既有这条源码扫描"。**判据本体一个字没改**（仍是"`chatRoomId` 进
  // `setData` 即判红"），只扩覆盖面 ⇒ 以后新增页面不必再"记得改清单"（这类"记得"就是我们最不信的东西）。
  const rootDir = path.join(__dirname, '..');
  const walkJs = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((ent) => {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) return walkJs(full);
    return ent.name.endsWith('.js') ? [full] : [];
  });
  const srcs = walkJs(path.join(rootDir, 'pages')).map((full) => ({
    rel: path.relative(rootDir, full).replace(/\\/g, '/'),
    text: fs.readFileSync(full, 'utf8')
  }));
  eq('扫描面非空（防"空集上的全绿"：走错目录会静默全过）', srcs.length >= 4, true);
  eq('新页面在扫描面内（customer-detail 详情批）',
    srcs.some((one) => one.rel.indexOf('pages/customer-detail/') === 0), true);
  const leaked = srcs.filter((one) => /setData\(\{[^}]{0,400}chatRoomId\s*:/.test(one.text)).map((one) => one.rel);
  eq('⛔ 平台原值不进 setData（pages/ 下所有 .js 源码扫描）', leaked.join(',') || '（无）', '（无）');
  const page = read('pages/archive-list/index.js');
  const assigns = (page.match(/chatKeyDigest\s*:/g) || []).length;
  const fromFormatter = (page.match(/chatKeyDigest\s*:\s*(''|sheetFlow\.fullChatKey\()/g) || []).length;
  eq('⛔ chatKeyDigest 的每一处赋值都只来自 fullChatKey 或空串', assigns === fromFormatter && assigns > 0, true);
}

/**
 * §11d 左滑删除 / 回收站 / 拆行（2026-09-25 详情页批）—— 三个**页面零件**的纯判据。
 * 为什么值得单开一节：左滑错了会误删、强确认错了会让"不可逆"变成一键、拆行错了会建出重名档案；
 * 而这三段原先要么不存在、要么写在页面上（页面层零断言 TD-016）。
 */
function runDeleteFlowSection(kit) {
  const check = kit.check;
  const eq = kit.eq;
  const swipe = require('../pages/archive-list/swipe.js');
  const recycle = require('../pages/archive-list/recycle.js');
  const sheetLine = require('../pages/archive-list/sheet-line.js');

  // ── 左滑判据 ──────────────────────────────────────────────────────────
  eq('左滑：横向过阈值、竖向没跑 ⇒ 开', swipe.decideSwipe({ dx: -70, dy: 6, opened: false }).action, 'open');
  eq('左滑：竖向意图优先 ⇒ 不开（滚列表不许划出删除）', swipe.decideSwipe({ dx: -70, dy: 90, opened: false }).action, 'none');
  eq('左滑：位移不够 ⇒ 不开', swipe.decideSwipe({ dx: -20, dy: 2, opened: false }).action, 'none');
  eq('左滑：已开着的行回划 ⇒ 关', swipe.decideSwipe({ dx: 30, dy: 2, opened: true }).action, 'close');
  eq('左滑：关的阈值必须比开的小（安全方向更容易触发）', swipe.CLOSE_PX < swipe.OPEN_PX, true);
  eq('左滑：位移只写在 CSS 一处（未开 = 0）', swipe.offsetFor(false), 0);
  eq('左滑：一次只开一行（换行就换过去）', swipe.nextOpenId('b', 'a').openId, 'b');

  // ── 回收站 ────────────────────────────────────────────────────────────
  const book = [
    { id: 'c1', building: 'D4', dorm: '522', name: '小王', deletedAt: 200 },
    { id: 'c2', building: 'D3', dorm: '444', name: '', deletedAt: 0 },
    { id: 'c3', building: 'X1', dorm: '101', name: '小李', deletedAt: 100 }
  ];
  eq('回收站：只收已软删，且按删除时间倒序', recycle.deletedRows(book, { c1: 2, c3: 5 }).map((row) => row.id).join(','), 'c1,c3');
  eq('回收站：件数 = "真删会连带删掉多少"（全量口径）', recycle.deletedRows(book, { c1: 2 })[0].parcelCount, 2);
  eq('回收站入口计数：没有已删档案 ⇒ 0（入口不渲染）', recycle.deletedCount([{ id: 'c2' }]), 0);
  // 二次确认 = **同一颗按钮点两下**（2026-09-25 真机反馈用户裁决「第二次确认应该由按钮承担」）
  // ⇒ 逐字输入确认词那条路撤掉：原来的四条 purgeConfirmed 断言随之换成下面这套两步按钮的断言。
  eq('两步按钮：第一下的字 = 彻底删除', recycle.purgeButtonText(false), '彻底删除');
  eq('两步按钮：arm 之后换字（第二下才是真删）', recycle.purgeButtonText(true), '确认：不可逆删除');
  eq('全部按钮：arm 后带上条数（不让人对着同一个词连点两下）', recycle.purgeAllButtonText(true, 3), '确认：全部删除 3 位');
  const allQ = recycle.purgeAllQuestion([{ parcelCount: 2 }, { parcelCount: 1 }]);
  eq('全部删除文案摊开"几位 / 名下共几件"', allQ.indexOf('全部 2 位') >= 0 && allQ.indexOf('共 3 条') >= 0, true);
  eq('全部删除文案写明不可逆 + 没有备份（不许假承诺）',
    allQ.indexOf('不可逆') >= 0 && allQ.indexOf('没有备份') >= 0, true);
  eq('回收站为空时全部删除给明说（不是空文案）', recycle.purgeAllQuestion([]).indexOf('回收站是空的') >= 0, true);
  eq('总量合计（入口数字与确认文案同一个数）',
    JSON.stringify(recycle.purgeTotals([{ parcelCount: 2 }, { parcelCount: 1 }])), JSON.stringify({ count: 2, parcelCount: 3 }));
  // ── 删除后立即刷新（2026-09-25 真机反馈批 2：「优化在删除后立即刷新」）──────────────────
  // 根因：四条路径（软删 / 恢复 / 逐条真删 / 全部真删）里有三条只刷了列表，**底部「已删除(N)」的计数与
  // 件数合计要等下次 onShow 才更新**；页面层零断言（TD-016）⇒ 漏写一个键谁都看不见。
  // 收敛成 `recyclePatch` 这一个纯补丁之后，"漏键"本身就能被钉住。
  const freshPatch = recycle.recyclePatch([{ id: 'c1', parcelCount: 2 }, { id: 'c3', parcelCount: 5 }], '已删除');
  eq('删除后立即刷新①：行 / 计数 / 件数合计 + arm 复位一次给全（少一个键 = 要等下次进页面才更新）',
    Object.keys(freshPatch).sort().join(','),
    'deletedCount,deletedParcelTotal,deletedRows,notice,purgeAllArmed,purgeAllQuestion,purgeArmedId,purgeQuestion');
  eq('删除后立即刷新②：计数与件数合计跟行一起变（入口才会当场出现/消失）',
    freshPatch.deletedCount + '|' + freshPatch.deletedParcelTotal + '|' + freshPatch.deletedRows.length + '|' + freshPatch.purgeAllArmed,
    '2|7|2|false');
  const emptyPatch = recycle.recyclePatch(null, '');
  eq('删除后立即刷新③：传 null（读库失败/清空）⇒ 0/0 不抛，且 arm 状态复位（不留一个"已 arm"的不可逆按钮）',
    emptyPatch.deletedCount + '|' + emptyPatch.deletedParcelTotal + '|' + emptyPatch.purgeArmedId + '|' + emptyPatch.notice,
    '0|0||');
  check('彻底删除的文案必须写明"不可逆"与"没有备份"，并带上件数',
    (() => {
      const q = recycle.purgeQuestion({ label: 'D4 522 小王', parcelCount: 3 });
      return q.indexOf('不可逆') >= 0 && q.indexOf('没有备份') >= 0 && q.indexOf('3') >= 0;
    })(), null);
  check('软删的文案必须写明"能恢复"并带上件数',
    (() => {
      const q = recycle.softDeleteQuestion({ label: 'D4 522 小王', parcelCount: 2 });
      // ⚠️ 断言写 `恢复` 而不是 `可恢复`：文案里是"可以恢复"，写成 `可恢复` 会漏判（本批首跑就是这么红的）
      return q.indexOf('恢复') >= 0 && q.indexOf('2') >= 0;
    })(), null);

  // ── 拆行（本批从页面搬出来的纯逻辑：搬之前它没有任何断言）────────────────
  const good = sheetLine.sheetLinePatch([], 'D4-522 小王');
  eq('拆行：合法行 ⇒ 三格填好且无错',
    good.hasError === false && good.patch.sheetForm.building === 'D4' && good.patch.sheetForm.dorm === '522', true);
  const bad = sheetLine.sheetLinePatch([], '今天天气不错');
  eq('拆行：看不懂 ⇒ hasError、三格清空、且错误文案不是空（不静默）',
    bad.hasError === true && bad.patch.sheetForm.dorm === '' && bad.patch.sheetError.length > 0, true);
}

/**
 * §11e 彻底删除（`storage.purgeCustomer`）—— 全项目**唯一不可逆**的写入口。
 * 用真写盘（测试库）跑：未软删被拒 → 软删 → 真删 → 悬空引用与整库校验。
 * ⚠️ 这一节必须**最后**跑（它会真删掉自己造的 fixture，不碰前面各节的档案）。
 */
function runPurgeSection(kit) {
  const check = kit.check;
  const eq = kit.eq;
  const storage = require('../utils/storage.js');
  const migrate = require('../utils/migrate.js');

  const created = storage.createCustomer({ building: 'D9', dorm: '901', name: '真删用例' });
  const id = created.customer.id;
  eq('彻底删除：未软删的档案被拒（真删是第二步，不是一步到位）', storage.purgeCustomer(id).reason, 'PURGE_REQUIRES_SOFT_DELETE');
  eq('彻底删除：被拒之后档案还在（零字节改动）', storage.getCustomer(id).ok, true);

  const one = storage.addParcel({ customerId: id, stationName: 'D9 驿站', pickupCode: '9-1-1001' });
  const two = storage.addParcel({ customerId: id, stationName: 'D9 驿站', pickupCode: '9-1-1002' });
  storage.softDeleteParcel(two.parcel.id);            // 单独删过 ⇒ 批次串与档案那批**不同**
  const soft = storage.softDeleteCustomer(id);
  eq('软删：只把"还活着"的那条打进本批（另一条早已单独删过）', soft.deletedParcels, 1);

  const purged = storage.purgeCustomer(id);
  eq('彻底删除：成功', purged.ok, true);
  eq('彻底删除：连"批次串不同、早已单独删过"的那条也删掉（否则留下悬空引用）', purged.purgedParcels, 2);
  eq('彻底删除：档案真的不在了', storage.getCustomer(id).reason, 'NOT_FOUND');
  const all = storage.listParcels({ includeDeleted: true });
  eq('彻底删除：名下快件一条不剩（含已删的）', all.parcels.filter((parcel) => parcel.customerId === id).length, 0);
  const loaded = storage.loadStore();
  // `migrate.validate` 返回的是 `{ok}` / `{ok:false, reason}`（不是 null）⇒ 断言取 `.ok`
  eq('彻底删除后整库仍过校验（没有悬空引用 —— 这条才是"不能只删同批"的理由）', migrate.validate(loaded.store).ok, true);
  eq('彻底删除：想恢复 ⇒ NOT_FOUND（不可逆，不是"藏起来了"）', storage.restoreCustomer(id).reason, 'NOT_FOUND');
  eq('彻底删除：不存在的 id ⇒ NOT_FOUND（不静默成功）', storage.purgeCustomer('c_not_exist_at_all').reason, 'NOT_FOUND');
}

module.exports = { runChatToolSection, runSheetFlowSection, runChatKeyHintSection,
  runDeleteFlowSection, runPurgeSection };
// ⚠️ `runFormPartsSection`（§11）2026-09-25 已**整体搬进** `./selftest-wave6.js`（wave5 撞了测试文件 1000 行
// 硬上限）—— 那里导出、由 `selftest.js` 调度；⛔ 别在这里再列一遍（列了就是 require 期 ReferenceError）。
