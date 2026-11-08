'use strict';
/**
 * tools/lib/admin-config-station-cases.js — selftest-admin-pages 的 H2 组「后台配置页站点卡」用例：
 * 口径：UX_DEVELOPER §3.8/§7.4；CONTRACT §13 D32（站点名称可改）、D70（截图识别/取件码反推双判据可开关）、
 *       D71（站点顺序可调、每站别名仅识别归一用）；严格判据/中文文案单源 = shared/stations + shared/station-rules。
 * 覆盖：8 行固定 id/名称回填与校验（既有 D32，纯搬移语义不变）+ 别名/取件码格式编辑（拆分/上行/严格拒绝）
 *       + 顺序移动 moveStation（上移/下移/边界/不改入参）+ 双判据开关回填与上行 + 变更清单（名称/顺序/开关）
 *       + 页面控件绑定与 D70/D71 说明口径。
 * 非独立套件：由 selftest-admin-pages 的 H2 组注册，断言数计入其 EXPECTED_ASSERTIONS。
 * 拆出原因：主套件已 999 行（门禁 #18 测试文件 ≤1000 行）。
 */
const path = require('path');
const fsutil = require('./fsutil');

const ROOT = path.resolve(__dirname, '..', '..');
const sharedStations = require(path.join(ROOT, 'shared/stations.js'));
const stationRules = require(path.join(ROOT, 'shared/station-rules.js'));
const C = require(path.join(ROOT, 'pkg-admin/common/constants.js'));

const PAGE_JS = 'pkg-admin/pages/config/index.js';
const PAGE_WXML = 'pkg-admin/pages/config/index.wxml';

function pageText(rel) {
  return fsutil.readText(path.join(ROOT, rel)) || '';
}

function cloneOf(value) {
  return JSON.parse(JSON.stringify(value));
}

// 配置站点的 8 个 id 基线（顺序 = 出厂顺序 P1~P8）
const DEFAULT_IDS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'];

function register(h, deps) {
  const configVm = deps.configVm;
  const sampleConfig = deps.sampleConfig;

  // ------------------------------------------------------------------ H2. 既有 D32：站点名称 8 行固定 id / 1~20 字唯一 / 变更清单 / 上行
  h.section('H2 §3.8/§7.4 D32 站点名称编辑卡：8 行固定 id/1~20 字唯一/变更清单/上行 payload', (t) => {
    const sample = sampleConfig();
    sample.stations = sharedStations.stationsFromConfig(null).map((item) => ({
      id: item.id,
      name: item.id === 'P6' ? '南苑东门驿站' : item.name
    }));
    const form = configVm.buildForm(sample);
    t.eq(form.stations.length, 8, '配置表单含站点名称 8 行（固定 P1~P8）');
    t.eq(form.stations.map((item) => item.id), DEFAULT_IDS, '站点行 id 顺序固定（不自建/不增删站点）');
    t.eq(form.stations[5].name, '南苑东门驿站', '站点名称按配置回填（改过的名字优先）');
    t.eq(form.stations[5].defaultName, sharedStations.stationNameOf('P6'),
      '站点行带内置默认名占位（清空/非法时提示可用默认）');
    const defaultForm = configVm.buildForm({});
    t.eq(defaultForm.stations.map((item) => item.name),
      sharedStations.listStations().map((item) => item.name), '配置缺 stations 时表单回填内置默认名（旧配置兼容）');
    const builtPayload = configVm.buildPayload({
      zones: [], stations: [{ id: 'P1', name: ' 西苑顺丰快递东门 ' }], services: [],
      announcement: { enabled: false, title: '', text: '' }, maintenance: { enabled: false, text: '' },
      orderTimeoutMinutes: '120', autoCompleteAt: '23:50', screenshotRetentionDays: '7',
      recognitionFailureRetentionDays: '30', ttlMinutes: '30', avatarMaxKb: '200'
    });
    t.eq([builtPayload.stations[0].name, builtPayload.stations[0].defaultName],
      ['西苑顺丰快递东门', undefined], '上行 payload 名称去空白且不带展示字段 defaultName');
    const basePayload = configVm.buildPayload(configVm.emptyForm());
    t.eq(configVm.validatePayload(basePayload), '', '站点默认名基线合法（合法基线先绿）');
    t.check(configVm.validatePayload(Object.assign({}, basePayload, {
      stations: basePayload.stations.map((item, index) => (index === 0 ? { id: item.id, name: '  ' } : item))
    })).indexOf('1~20') >= 0, '站点名称为空 → 提示 1~20 字');
    t.check(configVm.validatePayload(Object.assign({}, basePayload, {
      stations: basePayload.stations.map((item, index) => (index === 0 ? { id: item.id, name: '站'.repeat(21) } : item))
    })).indexOf('1~20') >= 0, '站点名称超 20 字 → 提示 1~20 字');
    t.check(configVm.validatePayload(Object.assign({}, basePayload, {
      stations: basePayload.stations.map((item, index) => (
        index === 1 ? { id: item.id, name: basePayload.stations[0].name } : item))
    })).indexOf('不能重复') >= 0, '两个站点同名 → 提示不能重复');
    t.check(configVm.validatePayload(Object.assign({}, basePayload, {
      stations: basePayload.stations.slice(0, 7)
    })).indexOf('8 个') >= 0, '站点行数不足 8 → 提示需覆盖 8 个站点');
    t.check(configVm.collectChanges(basePayload, Object.assign({}, basePayload, {
      stations: basePayload.stations.map((item, index) => (
        index === 5 ? { id: item.id, name: '南苑东门驿站' } : item))
    })).indexOf('站点名称') >= 0, '改站点名进入保存前变更清单（二次确认用中文字段名）');
    t.eq(configVm.collectChanges(basePayload, basePayload).indexOf('站点名称'), -1,
      '站点未变更时变更清单不含站点名称');
    const wxml = pageText(PAGE_WXML);
    const pageJs = pageText(PAGE_JS);
    t.check(wxml.indexOf('站点配置') >= 0 && wxml.indexOf('bindinput="onStationInput"') >= 0
      && wxml.indexOf('maxlength="{{limits.stationNameMax}}"') >= 0,
    '配置页渲染站点名称编辑（浮层输入，长度上限来自常量）');
    t.check(pageJs.indexOf('onStationInput') >= 0 && pageJs.indexOf('form.stations') >= 0,
      '配置页事件转发 onStationInput 更新 form.stations（页面零业务判据，名称校验在纯件）');
    t.eq(C.LIMITS.stationNameMax, 20, '后台常量站点名称上限 20（与 CONTRACT D32 一致）');
  });

  // ------------------------------------------------------------------ H3. D70/D71：别名/取件码格式/顺序/双判据开关
  h.section('H3 §13 D70/D71 站点：别名/取件码格式上行、顺序移动、双判据回填与开关、变更清单', (t) => {
    const zoneLabels = { D: 'D 区', X: 'X 区', N: 'N 区', B: 'B 区', C: 'C 区' };
    // 基线：P3 排首位并带 2 别名 + 2 个格式；双判据关掉「截图识别」
    const ordered = sharedStations.stationsFromConfig(null).map((item) => ({ id: item.id, name: item.name }));
    ordered.unshift(ordered.splice(2, 1)[0]); // P3 提前
    ordered[0].aliases = ['一栋南面', '五食堂21栋'];
    ordered[0].codePatterns = ['*-*-****', 'T-*-****'];
    const orderedForm = configVm.buildForm({
      zoneLabels: zoneLabels, stations: ordered, stationInfer: { fromImage: false, fromCode: true }
    });
    t.eq([orderedForm.stations[0].id, orderedForm.stations[0].aliasesText, orderedForm.stations[0].codePatternsText],
      ['P3', '一栋南面、五食堂21栋', '*-*-****、T-*-****'],
      'D71 编辑行回填别名/取件码格式（顿号连接）且 P3 排首位（顺序=配置顺序）');
    t.eq(orderedForm.stations.map((item) => item.id), ['P3', 'P1', 'P2', 'P4', 'P5', 'P6', 'P7', 'P8'],
      'D71 行顺序=配置顺序（8 行 id 不增删）');
    t.eq(orderedForm.stationInfer, { fromImage: false, fromCode: true }, 'D70 双判据开关按配置回填（显式 false 保留）');
    t.eq(configVm.buildForm({}).stationInfer, { fromImage: true, fromCode: true }, 'D70 开关缺省=两项都开');

    const orderedPayload = configVm.buildPayload(orderedForm);
    t.eq([orderedPayload.stations[0].aliases, orderedPayload.stations[0].codePatterns, orderedPayload.stationInfer],
      [['一栋南面', '五食堂21栋'], ['*-*-****', 'T-*-****'], { fromImage: false, fromCode: true }],
      'D70/D71 上行拆分别名/格式并带开关（顿号→数组）');
    t.eq(orderedPayload.stations.map((item) => item.id), ['P3', 'P1', 'P2', 'P4', 'P5', 'P6', 'P7', 'P8'],
      'D71 上行站点顺序=当前编辑行顺序');

    // 分隔符兼容：顿号/中文逗号/英文逗号/空白；空项丢弃
    const splitForm = configVm.buildForm({ zoneLabels: zoneLabels });
    splitForm.stations[0].aliasesText = '别名甲、别名乙，别名丙,别名丁 别名戊';
    splitForm.stations[0].codePatternsText = ' AB-****、CD-****,EF-**** ';
    const splitPayload = configVm.buildPayload(splitForm);
    t.eq([splitPayload.stations[0].aliases, splitPayload.stations[0].codePatterns],
      [['别名甲', '别名乙', '别名丙', '别名丁', '别名戊'], ['AB-****', 'CD-****', 'EF-****']],
      'D71 编辑文本按 [,，、\\s]+ 拆分去空（顿号/中英文逗号/空白都兼容）');
    t.eq(configVm.validatePayload(splitPayload), '', 'D70/D71 上限内的 5 别名/3 格式基线合法');

    // 严格拒绝（同一共享闸：复用 validateStationConfig + stationErrorText 中文文案）
    const brokenPayload = (index, patch) => {
      const payload = cloneOf(orderedPayload);
      Object.assign(payload.stations[index], patch);
      return configVm.validatePayload(payload);
    };
    t.eq([
      brokenPayload(0, { aliases: ['一栋南面', '一栋南面'] }).indexOf('别名不能') >= 0,
      brokenPayload(0, { aliases: ['西苑顺丰快递（西苑五食堂）'] }).indexOf('别名不能') >= 0,
      brokenPayload(1, { aliases: ['一栋南面'] }).indexOf('别名不能') >= 0,
      brokenPayload(0, { aliases: ['甲', '乙', '丙', '丁', '戊', '己'] }).indexOf('最多 5 个') >= 0,
      brokenPayload(0, { codePatterns: ['1234'] }).indexOf('必须包含 *') >= 0,
      brokenPayload(0, { codePatterns: ['*-*-快'] }).indexOf('取件码格式只能用') >= 0,
      brokenPayload(0, { codePatterns: ['*-*-****', '*-*-****'] }).indexOf('格式不能重复') >= 0,
      brokenPayload(0, { codePatterns: ['A-*-1', 'B-*-2', 'C-*-3', 'D-*-4'] }).indexOf('最多 3 个') >= 0
    ], [true, true, true, true, true, true, true, true],
    'D70/D71 严格拒绝：别名同站重复/与名称重复/跨站重复/超 5 个、格式无 */含中文/重复/超 3 个');
    t.eq([
      configVm.validatePayload(Object.assign({}, orderedPayload, { stationInfer: { fromImage: 'yes', fromCode: true } }))
        .indexOf('开关') >= 0,
      configVm.validatePayload(Object.assign({}, orderedPayload, { stationInfer: { fromImage: true } }))
        .indexOf('开关') >= 0,
      configVm.validatePayload(orderedPayload)
    ], [true, true, ''], 'D70 双判据开关只接受布尔（字符串/缺项拒绝，合法基线先绿）');

    // 顺序移动（D71）：返回新数组、不改入参；边界与非法方向不移动
    const rowIds = orderedPayload.stations.map((item) => item.id);
    const movedUp = configVm.moveStation(orderedPayload.stations, 1, -1);
    t.eq([movedUp.map((item) => item.id), orderedPayload.stations.map((item) => item.id)],
      [['P1', 'P3', 'P2', 'P4', 'P5', 'P6', 'P7', 'P8'], rowIds],
      'D71 moveStation 上移（index=1,dir=-1）返回新数组且不改入参');
    t.eq(configVm.moveStation(orderedPayload.stations, 3, 1).map((item) => item.id),
      ['P3', 'P1', 'P2', 'P5', 'P4', 'P6', 'P7', 'P8'], 'D71 moveStation 下移（index=3,dir=1）');
    t.eq([
      configVm.moveStation(orderedPayload.stations, 0, -1).map((item) => item.id),
      configVm.moveStation(orderedPayload.stations, rowIds.length - 1, 1).map((item) => item.id),
      configVm.moveStation(orderedPayload.stations, 2, 0).map((item) => item.id)
    ], [rowIds, rowIds, rowIds], 'D71 首行上移/末行下移/dir=0 均不移动（边界安全）');

    const reordered = Object.assign({}, orderedPayload, {
      stations: configVm.moveStation(orderedPayload.stations, 3, -1)
    });
    const inferToggled = Object.assign({}, orderedPayload, { stationInfer: { fromImage: true, fromCode: true } });
    t.eq([
      configVm.collectChanges(orderedPayload, reordered).indexOf('站点名称') >= 0,
      configVm.collectChanges(orderedPayload, inferToggled).indexOf('站点识别开关') >= 0,
      configVm.collectChanges(orderedPayload, orderedPayload).length
    ], [true, true, 0], 'D70/D71 站点顺序变化/双判据开关变化进入变更清单，未变化为空');
    t.eq(configVm.FIELD_LABELS.stationInfer, '站点识别开关', '变更清单字段名=「站点识别开关」');

    // 页面控件与说明口径（页面只转发，拆分/校验在 parts 纯件）
    const wxml = pageText(PAGE_WXML);
    const pageJs = pageText(PAGE_JS);
    t.check(wxml.indexOf('bindinput="onStationAliasInput"') >= 0
      && wxml.indexOf('bindinput="onStationPatternInput"') >= 0
      && wxml.indexOf('data-dir="-1"') >= 0 && wxml.indexOf('data-dir="1"') >= 0
      && wxml.indexOf('data-field="fromImage"') >= 0 && wxml.indexOf('data-field="fromCode"') >= 0
      && wxml.indexOf('checked="{{form.stationInfer.fromImage}}"') >= 0
      && wxml.indexOf('checked="{{form.stationInfer.fromCode}}"') >= 0,
    'D70/D71 配置页渲染别名/格式输入、上移/下移按钮（data-dir）与双判据开关（data-field/checked 回填）');
    t.check(wxml.indexOf('disabled="{{index === 0}}"') >= 0
      && wxml.indexOf('disabled="{{index === form.stations.length - 1}}"') >= 0,
    'D71 首行上移/末行下移按钮禁用');
    t.check(wxml.indexOf('stationLimits.aliasTextMax') >= 0 && wxml.indexOf('stationLimits.patternTextMax') >= 0,
      'D71 别名/格式输入 maxlength 取纯件上限（单源 shared/station-rules）');
    t.check(wxml.indexOf('兼职端仍按主站点归类') >= 0 && wxml.indexOf('仅用于识别') >= 0
      && wxml.indexOf('任意字母') >= 0,
    'D70/D71 说明小字口径：别名仅识别归一/兼职端仍按主站点归类/* 代表任意字母数字');
    t.check(pageJs.indexOf('onStationAliasInput') >= 0 && pageJs.indexOf('onStationPatternInput') >= 0
      && pageJs.indexOf('onStationMove') >= 0 && pageJs.indexOf('onStationInferToggle') >= 0,
    'D70/D71 页面事件转发齐全（拆项/校验/边界都在 parts 纯件，页面零业务判据）');
    const boundHandlers = (wxml.match(/bind(?:tap|input|change)="(on[A-Za-z]+)"/g) || [])
      .map((token) => token.replace(/^bind(?:tap|input|change)="/, '').replace(/"$/, ''));
    t.eq(boundHandlers.filter((name) => pageJs.indexOf(name + '(') < 0), [],
      '配置页 WXML 每个 bind 事件都有同名 Page 方法（防止改名/抽件后真机才炸）');
    t.eq(configVm.stationInputLimits(), {
      aliasTextMax: stationRules.STATION_ALIAS_MAX * (stationRules.STATION_ALIAS_LEN_MAX + 1) - 1,
      patternTextMax: stationRules.STATION_PATTERN_MAX * (stationRules.STATION_PATTERN_LEN_MAX + 1) - 1
    }, '编辑框文本上限由 shared/station-rules 单项上限推导（N 项 + N-1 个分隔符）');

    // 浮层编辑（列表只展示；点行出草稿；确定才回写；单站即时校验）
    t.eq([orderedForm.stations[0].aliasCount, orderedForm.stations[0].patternCount], [2, 2],
      'D71 列表行带别名/格式计数摘要（n 个别名 · n 个格式）');
    t.eq(configVm.emptySheet().open, false, 'D71 浮层初始关闭（页面 data 初值）');
    const sheetDraft = configVm.stationDraftOf(orderedForm.stations[0], 0, orderedForm.stations.length);
    t.eq([sheetDraft.open, sheetDraft.title, sheetDraft.position, sheetDraft.aliasCount],
      [true, 'P3', '第 1 位 / 共 8 位', 2], 'D71 点行生成草稿：标题只显示 P#，位次单独弱化展示');
    t.eq([configVm.stationTextCount('甲、乙，丙 丁'), configVm.stationTextCount('')], [4, 0],
      'D71 输入实时计数（顿号/逗号/空格拆分）');
    const applied = configVm.applyStationDraft(orderedForm.stations[0], Object.assign({}, sheetDraft, {
      name: ' 新名字 ', aliasesText: ' 甲 、 乙 ', codePatternsText: ' A-**** '
    }));
    t.eq([applied.name, applied.aliasCount, applied.patternCount], ['新名字', 2, 1],
      'D71 确定草稿回写：名称去空白、多项计数更新（数组拆分仍交给 buildPayload）');
    t.eq(configVm.validateStationDraft(sheetDraft, orderedForm.stations, 0), '',
      'D70/D71 浮层草稿基线合法（同一站点自己的别名/格式不与自己冲突）');
    const draftWith = (patch) => Object.assign({}, sheetDraft, patch);
    t.eq([
      configVm.validateStationDraft(draftWith({ name: orderedForm.stations[1].name }), orderedForm.stations, 0).indexOf('不能重复') >= 0,
      configVm.validateStationDraft(draftWith({ aliasesText: orderedForm.stations[1].name }), orderedForm.stations, 0).indexOf('不能与其他') >= 0,
      configVm.validateStationDraft(draftWith({ codePatternsText: '1234' }), orderedForm.stations, 0).indexOf('必须包含 *') >= 0,
      configVm.validateStationDraft(draftWith({ aliasesText: '甲、乙、丙、丁、戊、己' }), orderedForm.stations, 0).indexOf('最多 5 个') >= 0
    ], [true, true, true, true], 'D71 浮层即时校验：重名/别名撞名/格式无 * /别名超量在确定前就拦');
    // P2-A5 反例（判据有牙）：别名=本站正式名 / 名称撞其他站别名都必须行内红字（与写层 ALIAS_DUP 同判）
    t.eq([
      configVm.validateStationDraft(draftWith({ aliasesText: sheetDraft.name }), orderedForm.stations, 0).indexOf('不能重复') >= 0,
      configVm.validateStationDraft(draftWith({ name: '一栋南面' }), orderedForm.stations, 0).length > 0
    ], [true, true], 'P2-A5 浮层即时校验：别名=本站正式名 / 名称撞其他站别名均在确定前拦（与写层同判）');
    const sheetWxml = pageText(PAGE_WXML);
    const sheetJs = pageText(PAGE_JS);
    t.check(sheetWxml.indexOf('class="sheet-mask"') >= 0 && sheetWxml.indexOf('bindtap="onStationOpen"') >= 0
      && sheetWxml.indexOf('bindtap="onSheetConfirm"') >= 0 && sheetWxml.indexOf('bindtap="onSheetClose"') >= 0
      && sheetWxml.indexOf('catchtouchmove="onSheetNoop"') >= 0,
    'D71 站点改为列表 + 底部浮层：点行打开、遮罩/取消关闭、确定回写（背景滚动被遮罩拦截）');
    t.check(sheetJs.indexOf('onSheetConfirm(') >= 0 && sheetJs.indexOf('onSheetClose(') >= 0
      && sheetJs.indexOf('onStationOpen(') >= 0 && sheetJs.indexOf('closeSheet(') >= 0,
    'D71 浮层事件齐备（页面只转发；校验/回写在 parts 纯件）');
  });
}

const CLIENT_ASSERTIONS = 16 + 22 + 10; // +1：P2-A5 浮层别名/名称跨站冲突反例（一条 t.eq 两个反例）

module.exports = {
  CLIENT_ASSERTIONS,
  register
};
