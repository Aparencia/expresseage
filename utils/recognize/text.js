// utils/recognize/text.js · OCR 文本归一/切行/去敏/尾号候选（纯函数，零 wx）
'use strict';

function toHalfWidth(value) {
  let out = '';
  const str = String(value === undefined || value === null ? '' : value);
  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i);
    if (code === 0x3000) {
      out += ' ';
    } else if (code >= 0xff01 && code <= 0xff5e) {
      out += String.fromCharCode(code - 0xfee0);
    } else {
      out += str.charAt(i);
    }
  }
  return out;
}

function normalizeText(value) {
  return toHalfWidth(value)
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function splitLines(value) {
  return normalizeText(value)
    .split('\n')
    .map(function trim(line) { return line.replace(/\s+/g, ' ').trim(); })
    .filter(function keep(line) { return line.length > 0; });
}

function dedupeLines(lines) {
  const seen = Object.create(null);
  const out = [];
  (lines || []).forEach(function each(line) {
    const key = String(line || '').trim();
    if (!key || seen[key]) return;
    seen[key] = true;
    out.push(key);
  });
  return out;
}

/** 去敏：手机号/身份证/连续长数字打码；保留 4~5 位尾号与短码 */
function maskSensitive(value, maxLength) {
  const limit = Math.max(1, Number(maxLength) || 2000);
  let text = normalizeText(value).slice(0, limit);
  text = text.replace(/\b1[3-9]\d{9}\b/g, '***');
  text = text.replace(/\b\d{17}[\dXx]\b/g, '***');
  text = text.replace(/(\d{2})(\d{4,})(\d{2})/g, function mask(match, head, middle, tail) {
    if (middle.length < 4) return match;
    return head + '****' + tail;
  });
  text = text.replace(/(?:湖工大)?[\u4e00-\u9fa5]{1,6}(?:苑|栋)[\u4e00-\u9fa5\d]{0,8}(?:\d{3,4})\s*(?:室|寝)/g, '***');
  return text.slice(0, limit);
}

function tailCandidatesFromLine(line) {
  const out = [];
  const patterns = [
    /(?:运单|单号|快递单|末尾|后)(?:尾号|尾数|后)?[^\d]{0,3}(\d{5})/g,
    /(\d{5})(?:\s*(?:尾号|末位|后五位))/g
  ];
  patterns.forEach(function each(re) {
    let match = re.exec(line);
    while (match) {
      out.push({ value: match[1], by: 'keyword' });
      match = re.exec(line);
    }
  });
  return out;
}

/** 从 OCR 行里挑运单尾号（恰好 5 位数字）；优先带关键词的行 */
function pickTrackingTail(lines) {
  const all = [];
  (lines || []).forEach(function each(line) {
    all.push({ line: line, candidates: tailCandidatesFromLine(line) });
  });
  for (let i = 0; i < all.length; i += 1) {
    if (all[i].candidates.length > 0) {
      return { value: all[i].candidates[0].value, by: 'keyword', line: all[i].line };
    }
  }
  for (let i = 0; i < lines.length; i += 1) {
    const match = String(lines[i]).match(/(?:^|\D)(\d{5})(?:\D|$)/);
    if (match) return { value: match[1], by: 'standalone', line: lines[i] };
  }
  return { value: '', by: 'none', line: '' };
}

module.exports = {
  toHalfWidth,
  normalizeText,
  splitLines,
  dedupeLines,
  maskSensitive,
  pickTrackingTail
};
