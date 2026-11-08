'use strict';
/**
 * tools/selftest-review.js — 兼职「审核」核对页（2026-11-08 MVP）判据。
 * 覆盖：列表筛选（有截图 + 待接单/已接单/已取件）、旧单图兼容、编辑字段/patch 只提交改动、
 *       本地预校验、页面接线（order.correct / 无写状态动作）、工作台入口、禁分享、四件套。
 * 纪律：纯件 + 静态接线，不 mock 全局 wx；EXPECTED_ASSERTIONS 与实际断言数精确相等。
 * 取数：node tools/selftest-review.js | Select-Object -Last 2
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { createHarness } = require('./selftest');
const reviewModel = require(path.join(ROOT, 'pkg-partner/pages/review/parts/review-model.js'));

const EXPECTED_ASSERTIONS = 17;
const PAGE = 'pkg-partner/pages/review/index';

function readText(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
  } catch (e) {
    return '';
  }
}

function orderFixture(orderNo, status, extra) {
  return Object.assign({
    orderNo: orderNo,
    status: status,
    statusText: status,
    dorm: { dormKey: 'D4-522', roomTag: 'A' },
    parcels: [{ stationId: 'P3', stationName: 'P3 站', pickupCode: '8-2-3021', lockerNo: '7', trackingTail: '', codeStatus: 'OK', picked: false }]
  }, extra || {});
}

function register(h) {
  h.section('审核核对页：列表筛选/编辑归一/接线/禁分享', (t) => {
    const list = [
      orderFixture('R1', 'SUBMITTED', { images: [{}, {}] }),
      orderFixture('R2', 'ACCEPTED', { images: [{}] }),
      orderFixture('R3', 'COMPLETED', { images: [{}] }),
      orderFixture('R4', 'PICKED', { images: [] }),
      orderFixture('R5', 'PICKED', { image: { hasImage: true } })
    ];
    const rows = reviewModel.listRowsOf(list);
    t.eq(rows.map((row) => row.orderNo), ['R1', 'R2', 'R5'],
      '列表只保留「有截图 + 待接单/已接单/已取件」的单（无图/终态剔除，旧单图兼容）');
    t.eq(reviewModel.listRowsOf(list).filter((row) => row.orderNo === 'R1')[0].imageCount, 2,
      '截图张数按 images[] 计算');
    t.eq(reviewModel.imageCountOf(list[4]), 1, '旧单 image.hasImage 兼容为 1 张');
    t.eq(reviewModel.anchorOf(list[0]), 'D4-522A', '列表锚 = dormKey + roomTag');

    const editor = reviewModel.parcelEditorsOf(list[0])[0];
    t.eq([editor.indexText, editor.needCode, editor.picked], ['第 1 件', false, false],
      '件编辑初值：序号/需查明/已取状态来自 DTO');
    const changed = Object.assign({}, editor, { origin: reviewModel.originOf(editor), pickupCode: '9-9-9999' });
    t.eq(reviewModel.patchOf(changed), { pickupCode: '9-9-9999' }, 'patch 只提交改动过的字段（未改不发送）');
    const stationChanged = Object.assign({}, editor, {
      origin: reviewModel.originOf(editor), stationId: 'P5', stationName: 'P5 站'
    });
    t.eq(reviewModel.patchOf(stationChanged), { stationId: 'P5', stationName: 'P5 站' },
      '改站点时 patch 同时带 stationId + stationName');
    t.eq(reviewModel.validateEditor({ pickupCode: '', trackingTail: '' }).ok, false,
      '码/尾号都空 → 本地拦截（服务端仍权威）');
    t.eq(reviewModel.validateEditor({ pickupCode: '', trackingTail: '1234' }).ok, false,
      '运单尾号非 5 位 → 本地拦截');
    t.eq(reviewModel.validateEditor({ pickupCode: '', trackingTail: '12345' }).ok, true,
      '只有 5 位尾号 → 可保存');

    const pageJs = readText(PAGE + '.js');
    const pageWxml = readText(PAGE + '.wxml');
    const workbenchWxml = readText('pages/partner/workbench/index.wxml');
    t.check(/orderApi\.correct\(/.test(pageJs), '页面更正只走 order.correct（复用现有写动作）');
    t.check(/orderApi\.(accept|markPicked|markDelivered)\(/.test(pageJs) === false,
      '页面不擅自改订单状态（无 accept/markPicked/markDelivered）');
    t.check(/onFieldInput/.test(pageWxml) && /onStationChange/.test(pageWxml) && /swiper/.test(pageWxml),
      '一屏含截图 swiper + 站点/码/柜号/尾号编辑接线');
    t.check(/onReviewTap/.test(workbenchWxml) && readText('pages/partner/workbench/index.js').indexOf('/pkg-partner/pages/review/index') >= 0,
    '工作台顶部「审核」入口接线（wxml + 跳转）');
    t.check(/"enablePullDownRefresh":\s*true/.test(readText(PAGE + '.json')), '审核页开启下拉刷新');
    t.check(pageJs.indexOf('onShareAppMessage') === -1 && pageJs.indexOf('onShareTimeline') === -1,
      '审核页不挂分享（含顾客截图与订单信息）');
    const four = ['.js', '.json', '.wxml', '.wxss'].filter((ext) => readText(PAGE + ext) === '');
    t.eq(four, [], '审核页四件套齐全且非空');
  });
}

if (require.main === module) {
  const h = createHarness({ name: 'selftest-review' });
  h.setExpected(EXPECTED_ASSERTIONS);
  register(h);
  h.finish();
}

module.exports = { register, EXPECTED_ASSERTIONS };
