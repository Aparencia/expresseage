// utils/reason.js · reason 码 → 人话文案（**唯一的映射处**，登记见 docs/registry/APIS.md）
//
// 为什么单独一个文件：页面里散落 if/else 拼文案，改一处漏三处；这里集中，页面只调 reasonText()。
// 三条纪律（AGENTS §11.3 + SCOPE M11 + DESIGN §1 的敏感度列）：
//   ① ⛔ **禁止回显 D3 值**：文案里不出现取件码、运单尾号、柜号、手机号、楼区门牌等真实业务值。
//      要指问题就指**字段名**（"取件码这一项"），绝不把用户填进来的值再吐回去——
//      屏幕会被旁人看到、日志会被留存，而本项目承诺 D3 只留在本机库里。
//   ② ⛔ **禁止出现内部排期与文档编号**（卡号、SPEC 目录、§ 号、SCHEMA 版本号都是内部语言），
//      用户看到"见 DESIGN §1"只会更困惑。
//   ③ 未登记的码**不许静默变空串**：一律落到 UNKNOWN，让"缺文案"在页面上显形而不是消失。
//   ④ 页面向来拼"失败提示"只允许调本文件的 `failureText(reason, detail)`：
//      `reasonText(reason) + '（' + detail + '）'` 会把 `PARCEL_INVALID:stationName` 这类**内部码原样上屏**
//      （24 审查 R-05，全仓 5 处），而 detail 是人话时又必须保留 —— 这个取舍只在一处定一次。
//
// 覆盖面：DESIGN §3 契约里的每个失败码 + utils/migrate.js 实际会产生的每个码（含带字段后缀的两族）。
// ⚠️ 契约名与实际发出名不一致的地方（`ZONE_INVALID` vs 实际 `NO_BUILDING` 等）**两套都给了文案**：
//    只登记一套就会在另一套出现时掉进 UNKNOWN，而"缺文案"比"文案不够好"严重得多。差异已写进 23 卡回执。
'use strict';

const TEXTS = {
  // ── 本机库与写入（storage / migrate）──────────────────────────────────
  STORE_CORRUPT: '本地数据读不出来，可能被改坏了。请先别再录入，把这条告诉我。',
  STORE_VERSION_MISMATCH: '本地数据的版本比当前程序新（可能装过更新的版本）。为避免覆盖，已停止读写。',
  VALIDATION_FAILED: '有必填项没填、或内容太长，请检查后再保存。',
  WRITE_FAILED: '保存失败（写入异常）。请重试；若一直失败，把这条告诉我。',
  QUOTA_EXCEEDED: '本机存储空间已满，保存失败。请先清理已完成、已归档的记录。',
  NOT_FOUND: '这条记录已经不存在了（可能已被删除）。',
  // `PARCEL_NOT_FOUND` 原先在这里挂着一句文案，但它是**死码**：`storage.js` 实际发的是 `NOT_FOUND`，
  // 全仓零产生处、APIS.md 也没登记（24 审查 R-13/R-14）。留着 = 下一轮又有人拿它当契约去调用。
  // 真要区分"快递不存在"时应当**先登记码**，而不是先写文案。
  PARCEL_BATCH_MISSING: '有几条记录已经不在了，所以这次改动**一条都没执行**。请刷新后重试。',
  CUSTOMER_NOT_FOUND: '找不到对应的客户档案（可能已被删除）。',
  CUSTOMER_ID_DUPLICATE: '客户档案编号重复了（同一个人被存了两次）。请先别再录入，把这条告诉我。',
  // 「未归类」占位档案（2026-09-25 用户裁决 A「加占位客户」）：它是系统资产，不是"少了一条档案"；
  // 这两句分别对应它的两个反向用法：拿它当普通档案去改/删，或把件往它名下归。
  PLACEHOLDER_PROTECTED: '「未归类」是系统占位档案，不能改名、换绑或删除 —— 把里面的快件归给某位客户就行。',
  PLACEHOLDER_TARGET: '不能把快件归到「未归类」—— 请选一位真实客户（它的用途正好相反）。',
  PARCEL_ID_DUPLICATE: '快递记录编号重复了（同一件被存了两次）。请先别再录入，把这条告诉我。',
  PARCEL_CUSTOMER_MISSING: '有快递记录没有找到对应的客户档案（归属断了）。请先别再录入，把这条告诉我。',

  // ── 建档与归类（SCOPE M2/M3/M4/M7/M11）──────────────────────────────
  // 会话标识被丢弃：**非致命**提示，档案已经建好了，别让用户以为失败
  ROOM_ID_DISCARDED: '聊天会话标识的格式不符，这次没有采用它；档案已经建好，但"按会话自动预选客户"对它暂不生效。',
  // DESIGN §3 给 splitCustomerLine 登记的码
  CUSTOMER_LINE_UNPARSED: '这一行没看懂。请写成「楼栋 + 空格 + 宿舍号 + 称呼」，称呼可以不填。',
  ZONE_OUT_OF_RANGE: '楼区不在已知范围内（只认 D、X、N、B、C 五个楼区）。',
  ZONE_INVALID: '楼区看不懂（只认 D、X、N、B、C 五个楼区，可小写输入）。',
  BLOCK_INVALID: '栋号看不懂（楼区后面的那个数字，范围是 1 到 10）。',
  DORM_INVALID: '宿舍号看不懂（要是不小于 100 的纯数字）。',
  // 实际实现（utils/buildings.js 与 utils/customer-input.js）发出的两个码：v1 就有，沿用
  NO_BUILDING: '楼栋看不懂 —— 写成「楼区字母 + 栋号」，再跟横杠或空格和宿舍号（称呼可以不填）。',
  NO_DORM: '宿舍号看不懂 —— 要是不小于 100 的纯数字；整行照「楼区栋号 + 分隔符 + 宿舍号」写。',

  // ── 聊天工具（分包页；波 5 才接上，文案先就位）───────────────────────
  CHAT_UNSUPPORTED: '这台设备上的微信没提供"从聊天绑定"的能力，请改用档案页的「＋ 新建」。',
  CHAT_BIND_FAILED: '绑定聊天会话失败。可以稍后再试一次，或先用「＋ 新建」手工建档。',
  CHAT_BIND_CANCELLED: '已取消绑定，没有建档。需要的话再点一次绑定。',
  CHAT_ID_UNAVAILABLE: '这个会话没有给出可用于归类的标识，建档仍然可以，但以后要手工选客户。',
  CHAT_ID_EMPTY: '这个会话的标识是空的，建档仍然可以，但以后要手工选客户。',
  // ── 会话键（pick_friend：单聊双方 id 的无序对摘要，走**明文**通道 selectGroupMembers）──
  CHAT_MEMBERS_FAILED: '这个会话没给到可用的成员标识，建档仍然可以，只是以后要手工选客户。',
  CHAT_NOT_SINGLE_CHAT: '这条会话不是单聊（本期只支持和某一位好友的单聊），建档仍然可以，只是这次不带会话键。',
  // ── 发起"选择聊天好友"（pick_friend 批 2：主包侧 openChatTool）──────────────
  CHAT_OPEN_FAILED: '没能打开好友列表（可能这台手机或这个账号还没开放这个能力）。手填一样能建档，只是这次不带会话键。',
  CHAT_OPEN_CANCELLED: '你取消了选择好友 —— 手填一样能建档，只是这次不带会话键。',
  // 内部码，不上屏（页面不会拿它当 reason 显示）；登记在此是为了"缺文案"不静默
  BAD_MEMBERS: '会话成员标识不完整，这次没有生成会话键；建档仍然可以。',
  // pick_friend 批 3（换绑）：冲突时**什么都没改**，所以文案要说的正是"没动"与"下一步找谁"
  REBIND_CONFLICT: '这个会话已经绑给另一位客户了，这次没有改动。请先处理那一条档案，或者换一条会话。',

  // ── 回收站的第二步：彻底删除（2026-09-25 详情页/回收站批；不可逆，本项目没有备份/导出）──
  // 未软删时给的是"下一步该做什么"，不是"出错了"（真删是第二步，第一步永远是软删）
  PURGE_REQUIRES_SOFT_DELETE: '这一步只能对「已删除」里的档案执行。请先在档案行（或详情页）点「删除」，它会进回收站，再回来彻底删除。',

  // ── 识别与取图（DESIGN §3 的 OCR_UNAVAILABLE 族 + ocr.js 实际码）──────
  // 三条口径同一句：识别失败**只降级为"少预填"，绝不挡住手工录入**（SCOPE M6）
  OCR_UNAVAILABLE: '这台机器上用不了本机识别，请手工填写站点与取件码。',
  OCR_FAILED: '识别没成功，请手工填写站点与取件码；也可以换一张更清楚的图。',
  OCR_EMPTY: '这张图里没认出可用的内容，请手工填写站点与取件码。',
  VK_UNSUPPORTED: '当前微信不支持本机识别，请手工填写。',
  VK_INIT_FAILED: '本机识别启动失败，请手工填写。',
  IMAGE_DECODE_FAILED: '这张图读不出来，换一张或手工填写。',
  NO_TEXT: '图里没认出文字，请手工填写。',

  // ── 隐私门禁（privacy.js 实际码 + DESIGN §3 登记的别名）───────────────
  PRIVACY_DENIED: '还没同意隐私协议，无法读取相册；你可以直接手工填写。',
  PRIVACY_DENIED_CAMERA: '还没同意隐私协议（或未声明摄像头），无法在本机识别截图；你可以直接手工填写站点与取件码。',
  PRIVACY_ALBUM_DENIED: '相册没被授权，这次跳过快选图；改用拍照或直接手工填写都可以。',
  PRIVACY_CAMERA_DENIED: '摄像头没被授权，这次跳过拍照；改用相册选图或直接手工填写都可以。',

  // ── 文字解析（parse.js）──────────────────────────────────────────────
  NO_STATION: '没认出站点，请手工填写。',
  NO_CODE: '没认出取件码，请手工填写。',
  AMBIGUOUS: '认出多组候选，请手工确认站点与取件码。',

  UNKNOWN: '出了点问题，请重试；若反复出现把这条告诉我。'
};

// 动态码（`CUSTOMER_INVALID:<field>` / `PARCEL_INVALID:<field>`）的字段中文名。
// 为什么单独一张表而不是把字段名直接吐给用户：`trackingTail` 这种内部字段名在页面上等于没说；
// 而**只翻字段名、不回显值**正是纪律 ① 的落法。漏登记会落到"未登记的字段"，自测会当场抓到。
const FIELD_LABELS = {
  id: '编号',
  name: '称呼',
  building: '楼栋',
  dorm: '宿舍号',
  note: '备注',
  // pick_friend（24 卡 R-07）：这个字段自批 1 起存的是**本地摘要键**，不再是"平台会话标识"；
  // 沿用旧中文名会让 `failureText` 吐出一句"请改这一项"（而它由平台/本页算出来，用户改不了）
  chatRoomId: '会话键',
  createdAt: '创建时间',
  updatedAt: '更新时间',
  time: '时间字段',
  deletedAt: '删除时间',
  deleteBatch: '删除批次标记',
  customerId: '所属客户',
  stationName: '站点名称',
  pickupCode: '取件码',
  status: '状态',
  source: '来源',
  lockerNo: '柜号',
  trackingTail: '运单后五位',
  pickedAt: '取件时间',
  picked: '取件勾选',
  ids: '要改的记录',
  list: '要保存的清单'
};

/** 取字段中文名；未登记时返回带标记的占位（不静默变空串） */
function fieldLabel(field) {
  return FIELD_LABELS[field] || '（未登记的字段 ' + field + '）';
}

/**
 * 带字段后缀的两族动态码 → 人话。
 * @param {string} code 形如 `CUSTOMER_INVALID:chatRoomId`
 * @returns {string} 不是这两族时返回 `''`
 */
function dynamicReasonText(code) {
  const match = /^(CUSTOMER|PARCEL)_INVALID:(.+)$/.exec(code);
  if (!match) return '';
  const subject = match[1] === 'CUSTOMER' ? '客户档案' : '快递记录';
  // 刻意不说"是多少"：值可能是取件码或手机号（D3），回显即违反纪律 ①
  return subject + '的「' + fieldLabel(match[2]) + '」这一项没填对（空白、过长或格式不符），请改这一项后重试。';
}

/**
 * reason 码 → 用户可见文案。
 * @param {string} reason 错误码（也接受 storage 放在 `detail` 里的字段级码）
 * @returns {string} 恒非空：查不到时落 UNKNOWN
 */
function reasonText(reason) {
  const code = typeof reason === 'string' ? reason : '';
  if (TEXTS[code]) return TEXTS[code];
  const dynamic = dynamicReasonText(code);
  if (dynamic) return dynamic;
  return TEXTS.UNKNOWN;
}

// 内部码的形态：全大写 + 下划线，可带 `:字段` 后缀（`PARCEL_INVALID:stationName`）。
// 为什么要**判形态**而不是"把 detail 一律当码"：全项目 `detail` 有两种血统 ——
//   ① 校验族（`saveStore` 的 `VALIDATION_FAILED`）放的是**内部码**，原样上屏就是 24 审查 R-05；
//   ② 系统族（`STORE_CORRUPT`/`WRITE_FAILED`/`QUOTA_EXCEEDED`、以及 ocr/privacy）放的是**errno / errMsg 原文**，
//      那正是能指向根因的话（"VisionKit 需要相机权限（errno=104）"），再过一遍 reasonText 只会变成 UNKNOWN ——
//      那就是把 R-05 修成一条新回归（教训卡 2026-09-19：修边界只修一半/修过头都会引入回归）。
const CODE_SHAPE = /^[A-Z][A-Z0-9_]*(?::[A-Za-z0-9_]+)?$/;

/**
 * 失败对象 `{reason, detail}` → **一行**用户可见中文（页面禁止自己拼 `'（' + detail + '）'`）。
 * @param {string} reason 主码
 * @param {string} [detail] 字段级码（换成它自己的文案）或系统原文（作括号后缀）
 * @returns {string} 恒非空
 */
function failureText(reason, detail) {
  const text = typeof detail === 'string' && detail ? detail : '';
  if (CODE_SHAPE.test(text)) return reasonText(text);
  const base = reasonText(reason);
  return text ? base + '（' + text + '）' : base;
}

module.exports = { TEXTS, FIELD_LABELS, reasonText, fieldLabel, failureText };
