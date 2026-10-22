// api/modules/config.js · config 域（公开配置缓存 TTL 5 分钟）
const client = require('../client');

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache = { at: 0, data: null };

async function getPublic(force) {
  if (!force && cache.data && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.data;
  }
  const data = await client.call('config.getPublic', {}, { retry: true });
  cache = { at: Date.now(), data };
  return data;
}

/** 启动预热（P0-2）：bootstrap 已回 configPublic 时灌入缓存，本次会话首次 getPublic 零云调用；TTL 语义不变。 */
function prime(data) {
  if (!data || typeof data !== 'object') {
    return false;
  }
  cache = { at: Date.now(), data };
  return true;
}

function getCachedPublic() {
  return cache.data;
}

function clearCache() {
  cache = { at: 0, data: null };
}

module.exports = {
  getPublic,
  prime,
  getCachedPublic,
  clearCache,
  CACHE_TTL_MS
};
