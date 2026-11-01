'use strict';
/**
 * tools/lib/order-flow-client-cases.js — selftest-order-flow F 组用例表（api/client 传输注入 +
 * order.create v1.0 载荷契约），拆出以控测试文件 ≤1000 行（门禁 #18）。
 * 非独立套件：由 tools/selftest-order-flow.js require 后在其 F section 内调用。
 * 口径：CONTRACT §5.3 单入口 order.create / ENGINEERING §6.3 transport 注入（不 mock wx）。
 * @param {object} t harness 断言对象
 * @param {object} deps {client, store, orderApi, aiApi, errorCopy, enums, createOrderDb, orderApiOf,
 *   payloadOf, stationItem, IT_TICKET, IT_IMAGE, IT_TICKET_BATCH, IT_IMAGE_BATCH}
 */
async function clientChecks(t, deps) {
  const d = deps || {};
  const client = d.client;
  const store = d.store;
  const orderApi = d.orderApi;
  const aiApi = d.aiApi;
  const errorCopy = d.errorCopy;
  const enums = d.enums;
  const createOrderDb = d.createOrderDb;
  const orderApiOf = d.orderApiOf;
  const payloadOf = d.payloadOf;
  const stationItem = d.stationItem;
  const IT_TICKET = d.IT_TICKET;
  const IT_IMAGE = d.IT_IMAGE;
  const IT_TICKET_BATCH = d.IT_TICKET_BATCH;
  const IT_IMAGE_BATCH = d.IT_IMAGE_BATCH;
  const seen = [];
  const okResult = (data) => ({ ok: true, data: data === undefined ? {} : data });
  store.reset();
  try {
    client.setTransport((payload) => {
      seen.push(payload);
      return Promise.resolve(okResult({ orderNo: '20261022-0001', order: { orderNo: '20261022-0001' } }));
    });
    const explicit = 'E'.repeat(24);
    const created = await orderApi.create({ parcel: { stationId: 'P3', pickupCode: 'A12345' } },
      { clientRequestId: explicit });
    t.eq(seen[0] && seen[0].action, 'order.create', 'F1 order.create 仍经 api/client 唯一出口');
    t.eq(seen[0] && seen[0].clientRequestId, explicit,
      'F2 显式 clientRequestId 原样进包络（页面重试复用同一键，不再每次现生成）');
    t.check(created && created.orderNo === '20261022-0001', 'F3 成功响应只返回 result.data');
    // F4（v1.0 收口）：order.createBatch 已从服务端移除 → 等价幂等改测单入口 order.create
    // （真实 handler + fake DB）：同一 clientRequestId 重放命中同单（duplicated=true）；
    // 不同 clientRequestId 且内容不同（备注不同，避开合并窗口）→ 新单。
    const idemDb = createOrderDb();
    const idemApi = orderApiOf(idemDb);
    const idemKey = 'idem' + 'E'.repeat(20);
    const idemBody = {
      parcels: [
        { parcel: { stationId: 'P3', pickupCode: 'A12345' } },
        { parcel: { stationId: 'P4', pickupCode: 'B23456' } }
      ],
      images: [IT_IMAGE],
      tickets: [IT_TICKET],
      serviceCode: enums.SERVICE_CODES[0],
      appoint: { type: 'ASAP' },
      note: '',
      manualEntry: false
    };
    const idemFirst = await idemApi.call('order.create', idemBody, { clientRequestId: idemKey });
    t.check(idemFirst.ok === true && !idemFirst.data.duplicated && !!idemFirst.data.orderNo,
      'F4 单入口 order.create 基线建单成功（一单多包裹；createBatch 已移除，等价幂等改测单入口）');
    const idemReplay = await idemApi.call('order.create', idemBody, { clientRequestId: idemKey });
    t.eq([idemReplay.data.duplicated, idemReplay.data.orderNo], [true, idemFirst.data.orderNo],
      'F4b 同 clientRequestId 重放 → duplicated=true 且 orderNo 相同（服务端幂等，不重复建单）');
    const idemOther = await idemApi.call('order.create', Object.assign({}, idemBody, {
      note: '另一张单',
      images: [IT_IMAGE_BATCH],
      tickets: [IT_TICKET_BATCH]
    }), { clientRequestId: 'idem' + 'F'.repeat(20) });
    t.check(idemOther.ok === true && idemOther.data.orderNo !== idemFirst.data.orderNo,
      'F4c 不同 clientRequestId（备注不同，避开合并窗口）→ 新订单，不复用旧单');

    client.setTransport((payload) => {
      seen.push(payload);
      return Promise.resolve(okResult({}));
    });
    await orderApi.create({}, { clientRequestId: 'too-short' });
    t.check(/^[A-Za-z0-9_-]{24}$/.test(String(seen[seen.length - 1].clientRequestId)),
      'F5 非法显式 id 静默回退自生成 24 位（不把格式错误抛给页面）');
    await orderApi.create({}, { clientRequestId: 'B'.repeat(33) });
    t.check(/^[A-Za-z0-9_-]{24}$/.test(String(seen[seen.length - 1].clientRequestId)),
      'F6 超过 32 位同样回退（服务端 16~32 位口径两端一致）');
    t.check(client.isValidClientRequestId('A'.repeat(16)) === true
      && client.isValidClientRequestId('A'.repeat(15)) === false
      && client.isValidClientRequestId('A'.repeat(33)) === false
      && client.isValidClientRequestId(null) === false,
    'F7 isValidClientRequestId 值域闸有牙（16 合法、15/33/null 非法）');

    let writeAttempts = 0;
    client.setTransport(() => {
      writeAttempts += 1;
      return Promise.reject(new client.CallError('DEPENDENCY_FAILED', errorCopy.CODE_COPY.DEPENDENCY_FAILED));
    });
    let writeError = null;
    try {
      await orderApi.create({}, { clientRequestId: explicit });
    } catch (err) {
      writeError = err;
    }
    t.check(writeAttempts === 1 && !!writeError && writeError.code === 'DEPENDENCY_FAILED',
      'F8 写动作不自动重试（attempts=1；重复建单风险由同一 clientRequestId + 服务端幂等兜）');
    t.check(writeError instanceof client.CallError && writeError.message === errorCopy.CODE_COPY.DEPENDENCY_FAILED,
      'F9 超时/网络失败以 CallError + 人话文案抛出（页面只 toast err.message，不暴露英文码）');

    let readAttempts = 0;
    client.setTransport(() => {
      readAttempts += 1;
      if (readAttempts === 1) {
        return Promise.reject(new client.CallError('DEPENDENCY_FAILED', '首次抖动'));
      }
      return Promise.resolve(okResult({ order: { orderNo: '20261022-0002' } }));
    });
    const read = await orderApi.get({ orderNo: '20261022-0002' });
    t.check(readAttempts === 2 && read.order.orderNo === '20261022-0002',
      'F10 读动作自动重试一次后成功（读可重放）');

    client.setTransport(() => Promise.resolve({ ok: false, code: 'PARTNER_CLOSED' }));
    let codeError = null;
    try {
      await orderApi.create({}, { clientRequestId: explicit });
    } catch (err) {
      codeError = err;
    }
    t.check(!!codeError && codeError.code === 'PARTNER_CLOSED'
      && codeError.message === errorCopy.CODE_COPY.PARTNER_CLOSED,
    'F11 13 码 → 人话（PARTNER_CLOSED 用 shared/error-copy 单源文案）');
    client.setTransport(() => Promise.resolve({ ok: false, code: 'BRAND_NEW_CODE' }));
    let unknownError = null;
    try {
      await orderApi.create({}, { clientRequestId: explicit });
    } catch (err) {
      unknownError = err;
    }
    t.eq(unknownError && unknownError.message, errorCopy.UNKNOWN_CODE_COPY,
      'F12 未登记码走兜底文案（不装懂）');

    client.setTransport(() => {
      readAttempts += 1;
      return Promise.reject(new client.CallError('DEPENDENCY_FAILED', errorCopy.CODE_COPY.DEPENDENCY_FAILED));
    });
    readAttempts = 0;
    let timeoutError = null;
    try {
      await orderApi.imageUrl({ orderNo: '20261022-0002' });
    } catch (err) {
      timeoutError = err;
    }
    t.check(readAttempts === 3 && !!timeoutError && timeoutError.code === 'DEPENDENCY_FAILED',
      'F13 读动作重试耗尽后按原错误抛出（有界重试，不无限重试）');
    t.check(!!timeoutError && typeof timeoutError.message === 'string' && timeoutError.message.length > 0
      && !/timeout|TIMEOUT|ECONN|errMsg/.test(timeoutError.message),
    'F14 超时对外只有人话 CallError（不外抛原始 timeout 错误/英文堆栈）');

    let aiAttempts = 0;
    client.setTransport(() => {
      aiAttempts += 1;
      return Promise.reject(new client.CallError('DEPENDENCY_FAILED', errorCopy.CODE_COPY.DEPENDENCY_FAILED));
    });
    let aiError = null;
    try {
      await aiApi.parseParcel({ ocrTextMasked: '取件码', role: 'CUSTOMER' });
    } catch (err) {
      aiError = err;
    }
    t.check(aiAttempts === 1 && !!aiError && aiError.code === 'DEPENDENCY_FAILED',
      'F15 AI 兜底页也不自动重试（attempts=1，避免重复外呼）');

    // v1.0（D23）order.create 载荷契约：单入口 + 多包裹同请求 + clientRequestId 进包络
    // （异步节并发执行，全局 transport 只能由本组独占；服务端 fake-DB 联调由 task-21 的 selftest-order.js 覆盖）
    const createSeen = [];
    client.setTransport((payload) => {
      createSeen.push(payload);
      return Promise.resolve(okResult({ order: { orderNo: '20261022-0003' }, merged: false }));
    });
    const v1Payload = payloadOf([stationItem({ pickupCode: 'A12345' }), stationItem({ pickupCode: 'B23456' })]);
    const createdV1 = await orderApi.create(v1Payload, { clientRequestId: 'ito' + 'E'.repeat(21) });
    t.check(!!createdV1 && !!createdV1.order && createdV1.order.orderNo === '20261022-0003',
      'F16 返回值透传 order（页面据此展示订单号/跳详情）');
    t.eq(createSeen.length, 1, 'F17 一次提交只发一次 order.create（失败重试由页面复用同一键）');
    const env = createSeen[0] || {};
    t.eq(env.action, 'order.create', 'F18 action 经 api/modules/order.create（页面零自拼 action 字面量）');
    t.check(typeof env.clientRequestId === 'string' && env.clientRequestId.length >= 16,
      'F19 clientRequestId 进调用包络（服务端幂等键，重试不重复建单）');
    const body = env.data || {};
    t.eq(Object.keys(body).sort(),
      ['appoint', 'images', 'manualEntry', 'note', 'parcels', 'serviceCode', 'tickets'].sort(),
      'F20 请求体顶层键恰为 CONTRACT §5.3 v1.0 白名单');
    t.eq(body.parcels.length, 2, 'F21 多件在同一请求内提交（多图/多件合成一张订单）');
    t.check(body.images.length === body.tickets.length && body.manualEntry === false,
      'F22 images[i] ↔ tickets[i] 等长；有图时 manualEntry=false');
    const manualPayload = payloadOf([stationItem({})], { images: [], tickets: [] });
    await orderApi.create(manualPayload, { clientRequestId: 'itman' + 'E'.repeat(20) });
    const manualBody = (createSeen[createSeen.length - 1] || {}).data || {};
    t.check((manualBody.images || []).length === 0 && manualBody.manualEntry === true,
      'F23 无截图手填载荷可上送（images=[] + manualEntry=true，D24）');
    t.notEmpty(seen, 'F 组样本非空');
  } finally {
    client.restoreTransport();
    store.reset();
  }
}

module.exports = { clientChecks };
