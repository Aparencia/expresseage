'use strict';

/**
 * AI 识别兜底 · prompt 构造（纯件）。
 *
 * 口径：CONTRACT v0.9 §4.3 / ENGINEERING §4.10.2~§4.10.4
 * - system prompt 限定输出 JSON 字段集合；只把 payload 白名单里的去敏文本拼进消息。
 * - 站点表由调用方（handler，从共享注册表取）注入，本文件不硬编码站点、不访问数据库。
 * - 结果只作预填建议：不覆盖用户手填、不改订单状态、不创建订单。
 */

/** 期望模型返回的键集合（多余键由 parse 层剥离）。 */
const OUTPUT_KEYS = Object.freeze([
  'recognized',
  'stationId',
  'pickupCode',
  'trackingTail',
  'lockerNo',
  'confidence',
]);

const OUTPUT_SCHEMA = [
  '{',
  '  "recognized": boolean,',
  '  "stationId": string,',
  '  "pickupCode": string,',
  '  "trackingTail": string,',
  '  "lockerNo": string,',
  '  "confidence": "HIGH" | "MEDIUM" | "LOW"',
  '}',
].join('\n');

/**
 * 构造 system prompt。
 * @param {Array<{id: string, name?: string, aliases?: string[]}>} stations 站点表（服务端注入）
 * @returns {string}
 */
function buildSystemPrompt(stations) {
  const list = Array.isArray(stations) ? stations : [];
  const lines = [];
  lines.push('你是快递驿站取件截图的字段抽取器，只做信息整理，不做任何交易或计算。');
  lines.push('输入是一段已去敏的截图 OCR 文本，可能残缺、错行或含噪声。');
  lines.push('请从文本中抽取：驿站站点、取件码、运单尾号、柜号，并给出置信度。');
  lines.push('只输出一个 JSON 对象，不要输出解释、Markdown 代码块或多余文字。');
  lines.push('JSON 结构必须严格为：');
  lines.push(OUTPUT_SCHEMA);
  lines.push('抽取规则：');
  lines.push('1. stationId 只能取下列站点标识之一，识别不到就输出空字符串：');
  list.forEach((station) => {
    const id = station && station.id ? String(station.id) : '';
    if (!id) {
      return;
    }
    const name = station && station.name ? String(station.name) : '';
    const aliases = Array.isArray(station && station.aliases) ? station.aliases.filter(Boolean) : [];
    const parts = [id];
    if (name) {
      parts.push(name);
    }
    if (aliases.length > 0) {
      parts.push('别名：' + aliases.join('、'));
    }
    lines.push('   - ' + parts.join('｜'));
  });
  lines.push('2. pickupCode 去掉空格与连字符后应满足 4~12 位字母数字；不满足就输出空字符串，不要猜测或编造。');
  lines.push('3. trackingTail 必须是恰好 5 位数字，否则输出空字符串。');
  lines.push('4. lockerNo 是柜号，最多 10 个字符，识别不到就输出空字符串。');
  lines.push('5. recognized 只有在站点与取件码都可信时才为 true。');
  lines.push('6. 文本里出现的手机号、姓名、详细门牌与站点/取件码无关，一律忽略。');
  lines.push('7. 不要输出任何交易类字段或说明。');
  return lines.join('\n');
}

/**
 * 构造发往模型的 messages。只读取 payload 白名单键。
 * @param {{ocrTextMasked: string, hintTrackingTail?: string, role: string}} payload
 * @param {{stations: Array}} options
 * @returns {Array<{role: string, content: string}>}
 */
function buildMessages(payload, options) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const opts = options && typeof options === 'object' ? options : {};
  const text = typeof input.ocrTextMasked === 'string' ? input.ocrTextMasked : '';
  const userLines = ['OCR 文本（已去敏）：', text];
  if (typeof input.hintTrackingTail === 'string' && input.hintTrackingTail) {
    userLines.push('');
    userLines.push('运单尾号提示：' + input.hintTrackingTail);
  }
  if (typeof input.role === 'string' && input.role) {
    userLines.push('');
    userLines.push('业务角色：' + input.role);
  }
  return [
    { role: 'system', content: buildSystemPrompt(opts.stations) },
    { role: 'user', content: userLines.join('\n') },
  ];
}

module.exports = {
  OUTPUT_KEYS,
  buildSystemPrompt,
  buildMessages,
};
