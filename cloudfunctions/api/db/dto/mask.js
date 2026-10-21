// db/dto/mask.js · 后台脱敏函数（admin 列表/详情/审计强制走这里；不提供"显示完整"变体）
// 口径 = DATA_MODEL §7.7：昵称首字 + `***`、取件码首末位、尾号仅后 2 位、宿舍只到苑 + 楼栋。
function maskDisplayName(name) {
  if (typeof name !== 'string' || name.length === 0) {
    return '';
  }
  const chars = Array.from(name);
  return chars[0] + '***';
}

function maskPickupCode(code) {
  if (typeof code !== 'string' || code.length === 0) {
    return '';
  }
  if (code.length <= 3) {
    return '***';
  }
  return code.charAt(0) + '***' + code.charAt(code.length - 1);
}

function maskPhoneTail(tail) {
  if (typeof tail !== 'string' || tail.length === 0) {
    return '';
  }
  const value = tail.replace(/\s+/g, '');
  if (value.length === 0) {
    return '';
  }
  return '**' + value.slice(-2);
}

function maskDorm(dorm) {
  if (!dorm || typeof dorm !== 'object') {
    return '';
  }
  const zone = typeof dorm.zone === 'string' ? dorm.zone : '';
  const building = dorm.buildingNo !== undefined ? dorm.buildingNo : dorm.buildingNumber;
  if (!zone && (building === undefined || building === null || building === '')) {
    return '';
  }
  return zone + (building === undefined || building === null ? '' : String(building));
}

module.exports = {
  maskDisplayName,
  maskPickupCode,
  maskPhoneTail,
  maskDorm
};
