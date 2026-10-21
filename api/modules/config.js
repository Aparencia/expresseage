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

function getCachedPublic() {
  return cache.data;
}

function clearCache() {
  cache = { at: 0, data: null };
}

module.exports = {
  getPublic,
  getCachedPublic,
  clearCache,
  CACHE_TTL_MS
};
