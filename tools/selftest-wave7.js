// tools/selftest-wave7.js · §18 识别补丁（`pages/recognize/form-parts.js` 的 `planParsePatch`）
//
// 为什么开第四个测试文件：wave6 已到 **990 非空行**（AGENTS §11.1「测试文件 ≤1000 行」的取数口径 = 非空行），
// 再往它里面塞一节就越线 —— 与当初 §10/§11 搬进 wave5、§11 再搬进 wave6 是**同一条理由**。
// 判定器 `eq`/`check` 仍由调用方注入 ⇒ **同一个计数器**（"断言 N 条"这个读数不会被切成两份）。
// ⛔ 本文件只放测试；往 `tools/` 塞业务代码会绕过 check.js 的源码扫描豁免前提（R-21 同族）。
'use strict';

/**
 * §18 `planParsePatch` —— BUG-04 的机器闸（**2026-09-26 之前这个函数一条断言都没有**）
 *
 * 为什么"真的调用一次"才算测到：BUG-04 的形态不是规则算错，而是**搬迁漏了依赖** ——
 * `parse` 与 `reasonText` 两个名字在零件里没有绑定 ⇒ 函数一进去就抛 `ReferenceError`，
 * 屏上只剩一句「识别流程异常」，所有预填静默失效，而 683 条断言全绿（RCA：`docs/specs/20260926_recognize_fix/`）。
 * ⚠️ 两条刻意的写法，都是为了"变异必须判红"这件事本身可核：
 *   ① **不在全局 stub `parse`/`reasonText`** —— stub 了的话，把 `require` 摘掉的变异仍会全绿；
 *   ② **异常用 `guard` 收成值，不让它抛穿 `await` 链** —— 抛穿会让后面的断言一条都不跑，
 *      而"判据没跑到"正是这条缺陷当初躲过全部断言的方式（教训卡《空集上的全绿》）。
 * @param {{eq:function, check:function, formParts:object, reason:object}} kit
 */
function runParsePatchSection(kit) {
  const eq = kit.eq;
  const check = kit.check;
  const plan = kit.formParts.planParsePatch;
  console.log('§18 识别补丁（planParsePatch：多码 / 单条 / 认不全三支 + 空框纪律 + 接线钉）');
  const EMPTY = { stationName: '', pickupCode: '', lockerNo: '', trackingTail: '' };
  const guard = (fn) => {
    try { return { patch: fn(), error: '' }; }
    catch (err) { return { patch: {}, error: String((err && err.message) || err) }; }
  };
  const run = (texts, draft, partial) => guard(() => plan({
    texts: texts, partial: partial === true, draft: draft || EMPTY, customerId: 'c1'
  }).patch);

  // ── ⓪ BUG-04 本体：这个函数必须"能被跑完" ────────────────────────
  // 断言值里带 `error`，失败时屏上会直接写出 ReferenceError 的名字（不用再去猜是哪一处绑定丢了）。
  const ping = run(['取件码 677426', '南苑菜鸟驿站']);
  eq('§18⓪（BUG-04 本体）：`planParsePatch` 不靠注入全局就能跑完（缺 `parse`/`reason` 绑定 ⇒ 这里带出 ReferenceError）',
    [Object.keys(ping.patch).length > 0, ping.error].join('|'), 'true|');

  // ── ① 多码支（`multi.items.length > 1`）────────────────────────
  const multi = run(['取件码 8-2-3021', '妈妈驿站代收点 湖工大西苑一栋南门面8号柜', '取件码 23-5-3009', '南苑菜鸟驿站']);
  eq('§18①：两个码 ⇒ 走多码支（drafts 逐条列码、原文上屏、recognizing 归位、算"采信了识别"）',
    [(multi.patch.drafts || []).map((d) => d.pickupCode).join(','), (multi.patch.lines || []).length,
      multi.patch.recognizing, multi.patch.recognitionUsed,
      String(multi.patch.banner).indexOf('这图里有 2 件') === 0].join('|'),
    '8-2-3021,23-5-3009|4|false|true|true');

  // ── ② 单条支：站点命中正式名 ⇒ 回填 + banner 说"已自动填好" ────────
  const single = run(['取件码 677426', '南苑菜鸟驿站']);
  eq('§18②：站名命中正式名 + 码唯一 ⇒ 两格都回填、"已自动填好"、**不**出站点提示、也不展开原文',
    [single.patch['draft.stationName'], single.patch['draft.pickupCode'], single.patch.stationHint,
      String(single.patch.banner).indexOf('已自动填好') === 0, String(single.patch.showLines)].join('|'),
    '南苑菜鸟驿站|677426||true|undefined');

  // ── ③ 认不全支（**BUG-04 的第二个缺失绑定只藏在这里**）────────────
  // 这一支才会去调 `reason.reasonText`；摘掉 `reason` 的 require 时 ①②照样绿、只有它炸 ⇒
  // 它是"缺 reason 绑定"的唯一机器闸。⚠️ 探针第一版只喂两张真机样本，就没喂到这一支，
  // 差点把缺陷收成"只缺 parse"（记在 RCA §2）。
  const miss = run(['取件码 8-2-3021']);
  eq('§18③：认不全（没站点）⇒ banner 走 `reasonText` 单源文案 + 展开原文 + 站点提示按单源字面量',
    [miss.patch.banner, miss.patch.showLines, miss.patch.stationHint === kit.formParts.stationMissedHint(true)].join('|'),
    kit.reason.TEXTS.NO_STATION + ' —— 没填的格子照旧手填即可。|true|true');

  // ── ④ 缺陷 C 的**判据钉**（2026-09-26 用户裁决 A 后重写；旧版钉的是"现状 = banner 说已自动填好"）──
  // 站名不是正式名 ⇒ 站点格留空。此时 banner **不许**再说"已自动填好"（它原来只看 `parsed.ok`，
  // 而 `parsed.ok` 判的是"解析层有没有找到站名"，与站点格的判据不同源 ⇒ 屏上自相矛盾）。
  // 现由 `fill.stationMissed`（站点格最终态）一处裁决；"站点没认出来"那句仍只在 `stationHint`（wxml 守卫）。
  const contradiction = run(['取件码 677426', '妈妈驿站代收点 湖工大西苑一栋南门面8号柜']);
  eq('§18④（缺陷 C 判据钉）：站名不是正式名 ⇒ 站点格留空 + banner 改说"取件码认出来了，站点没认出来" + stationHint 非空',
    [String(contradiction.patch['draft.stationName']), contradiction.patch.banner,
      contradiction.patch.stationHint !== '', contradiction.patch['draft.lockerNo']].join('|'),
    'undefined|取件码认出来了，站点没认出来。|true|8号柜');

  // ── ⑤ 空框纪律（人改过的格子不许被覆盖 —— 与 `预填②` 同源，这里走整条补丁路径）──
  const kept = run(['取件码 677426', '南苑菜鸟驿站'],
    { stationName: '', pickupCode: '手打码', lockerNo: '', trackingTail: '' });
  eq('§18⑤：人已经打过的取件码**不许被覆盖**，其余格子照填',
    [String(kept.patch['draft.pickupCode']), kept.patch['draft.stationName']].join('|'), 'undefined|南苑菜鸟驿站');

  // ── ⑥ `partial` 透传（识别可能没读完 ⇒ 屏上要如实说）──────────────
  const part = run(['取件码 677426', '南苑菜鸟驿站'], null, true);
  eq('§18⑥：`partial=true` ⇒ banner 末尾如实加"（识别可能没读完）"',
    String(part.patch.banner).indexOf('（识别可能没读完）') > 0, true);

  // ── ⑦ 接线钉（源码级）─────────────────────────────────────────
  // 与 §17⑯ 同形：上面六条测的都是**模块**，把页面里那次调用删掉它们照样全绿 ——
  // 而屏上识别会重新变成"选了图没反应"。判据必须同时盯着"页面还在调它"。
  const fs = require('fs');
  const path = require('path');
  const pageSrc = fs.readFileSync(path.join(__dirname, '..', 'pages', 'recognize', 'index.js'), 'utf8');
  // ⚠️ 2026-09-26：`applyParse` 随取图链路**整体搬进 `./recognize-flow.js`**（index.js 当时 500/500 非空行）
  // ⇒ 本条改盯新家，并**多钉一只脚**：页面必须仍把 `recognizeFlow.pageMethods` 并进 Page —— 两头都保住，
  // 删任一头（零件里那次调用 / 页面那次并进）都当场判红。
  const flowSrc = fs.readFileSync(path.join(__dirname, '..', 'pages', 'recognize', 'recognize-flow.js'), 'utf8');
  check('§18⑦（接线钉）：识别结果仍交给 `planParsePatch`（零件里）+ 页面仍并进该零件（搬迁后两只脚都钉住）',
    /setDataMeasured\(planParsePatch\(\{/.test(flowSrc)
      && /const planParsePatch = parsePatch\.planParsePatch;/.test(flowSrc)
      && /require\('\.\/recognize-flow\.js'\)/.test(pageSrc)
      && /recognizeFlow\.pageMethods/.test(pageSrc),
    '接线：index.js → recognizeFlow.pageMethods → applyParse → planParsePatch');
}

/**
 * §19 站点别名新增条（`五食堂21栋楼下` → P3）—— BUG-04 批 3（用户 2026-09-26 裁决「现在就加别名」）
 *
 * 为什么不并进 wave6 §12：那里已经 990 非空行（≤1000 上限）。
 * 事实源是 `docs/STATION_MAP.md` §5.5（本次**先改本文再改代码**，§6 规程）；别名**只**给识别/手输归一用。
 * @param {{eq:function, check:function}} kit
 */
function runStationAliasSection(kit) {
  const eq = kit.eq;
  const stations = require('../utils/stations.js');
  console.log('§19 站点别名新增条（五食堂21栋楼下 → 西苑一栋南面快递中心）');
  // 语料出处：用户真机截图（拼多多·物流服务页，**人工转录**）的站点行 `兔喜快递超市代收点 | 五食堂21栋楼下`。
  // ⚠️ 转录样本 ≠ 真机输出（教训卡）：真机原文到手后按原文形态补，别在这里"整理"输入。
  const raw = '兔喜快递超市代收点 五食堂21栋楼下';
  const hit = stations.matchBuiltinStation(raw);
  eq('§19①：真机那行 ⇒ 归一到 P3 正式名（走别名路 `kind:"alias"`，⛔ 不把原文写进站点格）',
    [hit.ok, hit.stationName, hit.kind].join('|'), 'true|西苑一栋南面快递中心|alias');
  eq('§19②：别名**不进**选择器（`listStationPoints()` 里没有这个词）—— 防"同一个点在选择器里出现两次"',
    stations.listStationPoints().indexOf('五食堂21栋楼下') >= 0, false);
  // 与既有 `R5`（`21栋` → P3）**同向**：同一行在"识别去哪取"与"回填成哪个正式名"两条路上必须指向同一点，
  // 否则会出现"识别说 P3、站点格填成别处"这种最难查的不一致。
  eq('§19③：与 `R5` 同向 —— `inferStation` 对该行也判 P3（识别路与回填路不许分叉）',
    [stations.inferStation(raw).ruleId, stations.inferStation(raw).stationName].join('|'),
    'R5|西苑一栋南面快递中心');
  // ── 邮政点（P7/P8）的五条（2026-09-26 **从 `selftest-wave6.js §12` 整体搬来**）──────────────
  // 为什么搬：wave6 被顶到 1006 行（>1000 硬上限，`gate.ps1 ④` 判红），而本节本来就是"站点别名/P8/改名"的家。
  // ⚠️ 搬迁只换文件、**不删判据**（条数不变）；`POST` 的唯一事实源仍是 `STATION_POINTS.P7`，这里只引用变量。
  const allPoints = stations.listStationPoints();
  const POST = '西苑一栋邮政';        // P7（2026-09-26 用户改名；2026-09-25 曾定名 `西苑邮政`）
  const POST_EAST = '东苑一栋邮政';   // P8（2026-09-26 用户指令新增）
  kit.check('邮政①：两个邮政点都在清单里（P7 + P8，且 P8 是末位）',
    allPoints.indexOf(POST) >= 0 && allPoints.indexOf(POST_EAST) >= 0 && allPoints[allPoints.length - 1] === POST_EAST,
    'P7=' + allPoints.indexOf(POST) + ' P8=' + allPoints.indexOf(POST_EAST) + ' 末位=' + allPoints[allPoints.length - 1]);
  eq('邮政②：认它自己的正式名 ⇒ exact', stations.matchBuiltinStation(POST).kind, 'exact');
  // 顺序钉（教训卡《2026-09-19_修一半的边界会引入回归》：只要"通过"依赖两条规则的相对顺序，就该钉死）：
  // 邮政点也在"西苑一栋南面"，R2B 若不排在 R4（`西苑一栋`）之前 ⇒ 这段文本会被判成 P3（结论与**依据**双错）。
  const postInfer = stations.inferStation('湖工大西苑一栋南面邮政快递中心', '');
  eq('邮政③（顺序钉）：含"邮政"又含"西苑一栋" ⇒ 必须走 R2B → 邮政点，⛔ 不许被判成 P3',
    postInfer.ruleId + '|' + postInfer.stationName, 'R2B|' + POST);
  // ⚠️ 样本用**别名那条真机行**（`湖工大西苑一栋南面菜鸟驿站`）：它同时含"西苑一栋"（R4）⇒ 两条路必须同目标。
  // （⛔ 别拿 `raw` 那条兔喜行来测这条：它走的是 R5，规则号不同但目标同为 P3，会把这颗钉子的意图测糊。）
  const aliasLine = '湖工大西苑一栋南面菜鸟驿站';
  eq('邮政④：别名那条路与规则那条路**同一目标**（两条路不许分叉）',
    stations.inferStation(aliasLine, '').stationName + '|' + stations.inferStation(aliasLine, '').ruleId,
    '西苑一栋南面快递中心|R4');
  // 改名不留孤儿（2026-09-25 改成 `西苑邮政`、2026-09-26 再改成 `西苑一栋邮政`）：**改名前的写法必须仍归一到
  // 新正式名**，否则历史记录里的旧名会在选择器/分组里长成"同一个点的第二个名字"。⚠️ 旧串用拼接构造、不写死字面。
  eq('邮政⑤：改名前的临时名（`POST` + 位置后缀）仍归一到新正式名',
    stations.matchBuiltinStation(POST + '（西苑一栋南面）').stationName, POST);

  // ── P8（2026-09-26 用户指令新增 `东苑一栋邮政`；同日用户把命中条件**收紧**为「东 + 邮政」）──────
  // ⚠️ 这几条的价值在**顺序**与**条件面**：P8 的正式名含"邮政"，与既有 `R2B`（`邮政`→P7）天然冲突
  // ⇒ 顺序错了就跑错驿站；条件放太宽就会把"东苑别的取件点"抢到 P8。
  const east = stations.inferStation('东苑一栋邮政 取件码 8-2-3021');
  kit.check('§19④（P8）：`东 + 邮政` 同现 ⇒ 判 P8 = `东苑一栋邮政`，**不许**被 `R2B` 抢成西苑那个邮政点',
    east.stationName === '东苑一栋邮政' && east.ruleId === 'R2C', '命中 ' + east.ruleId + ' → ' + (east.stationName || '(空)'));
  // ⚠️ 2026-09-26 独立审查 F5 修：原来直接在**原文**上找 `R2C`…`R2B` 的先后，而注释里出现这两个词也能满足它
  //   ⇒ 审稿人实测"把两条规则的**代码行**对调、注释不动"**仍然判绿**（钉子能被注释喂饱）。现在**先去注释**再找先后。
  const stationSrc = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'utils', 'stations.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  kit.check('§19⑤（顺序钉）：`R2C` 必须排在 `R2B` 之前（**去注释后**判先后）—— 只看"邮政"两字仍归 P7（既有行为不许改）',
    /id: 'R2C'[\s\S]*?id: 'R2B'/.test(stationSrc)
      && stations.inferStation('西苑一栋邮政 取件码 1-1-1111').stationName === '西苑一栋邮政',
    'R2C 在 R2B 之前（去注释）+ "西/裸 邮政" 仍 → 西苑一栋邮政');
  // 用户 2026-09-26 原话：「**同时命中 东+邮政 就归到东苑一栋邮政**」⇒ 只写"东苑"**不足以**断定它是邮政点：
  // 那种文本必须**不判**（R15 留空 + ❓ 问人），⛔ 不许被抢到 P8。
  kit.check('§19⑥（条件面·反向钉）：只写"东苑"（无"邮政"）⇒ **不许**判成 P8',
    stations.inferStation('东苑三栋菜鸟驿站 取件码 8-2-3021', '').ruleId !== 'R2C',
    '命中 ' + stations.inferStation('东苑三栋菜鸟驿站 取件码 8-2-3021', '').ruleId + '（不许是 R2C）');
  // 2026-09-26 用户改名 P7（`西苑邮政` → `西苑一栋邮政`）：旧名**不再被新名包含** ⇒ 靠别名归回来（改名不留孤儿）
  kit.check('§19⑦（改名不留孤儿）：旧正式名 `西苑邮政` 归一 ⇒ `西苑一栋邮政`（否则已落库的旧记录会成"第二个名字"）',
    stations.matchBuiltinStation('西苑邮政').stationName === '西苑一栋邮政',
    '别名路 → ' + (stations.matchBuiltinStation('西苑邮政').stationName || '(空)'));
}

/**
 * §20 **真机原文**：整屏被 VisionKit 吐成**一整行**（用户 2026-09-26 09:24 截图「识别原文（1 行）」）
 *
 * 为什么这一节比前面所有站点/码样本都重要：它的来源是 **真机原文**（本项目最高等级样本，教训卡
 * 《2026-09-17_样本是转录的不等于真机输出》规矩 ②），而此前所有"整屏一行"的规则都长在**人工转录**样本上。
 * 两处形态差异（照该卡规矩 ③ 写成钉子）：
 *   ① **一整行**（不是"一个字段一行"）⇒ 站点/时间/码/标签全挤在同一行；
 *   ② 卡片上"码"是大字、`取件码`三个字在它**后面** ⇒ 真机文本是 `…111-1-1111取件码复制…`，**值在标签前面**。
 *     ⚠️ 转录版（我按截图分行抄的）逼出了一个**真机不存在的**假件（`86-138****0000` 的末四位被当取件码）——
 *     它现在挂在 TD-032，⛔ 不凭转录样本改规则。
 * ⚠️ 本行含用户自己的**脱敏手机号与运单号**（D3）：只活在本机仓库的 fixture 里，⛔ 不外发、不进任何日志。
 * @param {{eq:function, check:function, formParts:object, reason:object}} kit
 */
// 照抄（⛔ 不许"整理"：空格、`*`、`|`、`>`、`~` 都按屏上原文；页面上它是一整行，截图的折行只是排版）
const REAL_OCR_LINE = '接驾中2分已放)客服包裹9栋距收货地135米公寓28栋学生公寓25栋站(湖南学店)学生公寓24栋公寓27栋西苑仔饭收货地址26号楼包裹旅行途中为你带回了惊喜!快点开看看吧~不感兴趣立即领取韵达快递435370431223307复制打电话待取件09-25 12:00湖工大西苑一栋南面菜鸟驿站湖南省株洲市天元区泰山路街道株洲龙凤呈祥宾馆湖南工业大学(河西校区)株洲龙凤呈祥宾馆湖南工业大学(河校区)111-1-1111取件码复制查看更多物流明细送至湖南工业大学(河西校区)西苑某生86-138****0000|号码保护中取件出示虚拟号>天猫美的制冰机旗舰店>美的小型车载冰箱宿舍储存迷...244.8极地白|家款14L899';

function runRealOcrSection(kit) {
  const eq = kit.eq;
  const plan = kit.formParts.planParsePatch;
  const parse = require('../utils/parse.js');
  const text = require('../utils/parse-text.js');
  console.log('§20 真机原文（整屏一整行 + 值在标签前：111-1-1111）');

  const parsed = parse.parseParcelText([REAL_OCR_LINE]);
  eq('§20①（真机原文）：整屏一行也能认出取件码 `111-1-1111`（`值在标签前` 那条路；修复前是 NO_CODE）',
    [parsed.ok, parsed.pickupCode].join('|'), 'true|111-1-1111');

  eq('§20②（真机原文）：站点原文带 `12:00` 前缀 ⇒ 归一成正式名（⛔ 带时间戳的原文字面永不入格）',
    [parsed.found.stationName, kit.formParts.stationPrefill(parsed.found.stationName).stationName].join('|'),
    '12:00湖工大西苑一栋南面菜鸟驿站|西苑一栋南面快递中心');

  const patch = plan({
    texts: [REAL_OCR_LINE], partial: true,
    draft: { stationName: '', pickupCode: '', lockerNo: '', trackingTail: '' }, customerId: 'c1'
  }).patch;
  eq('§20③（真机原文·端到端）：banner 不再说"没认出取件码"，两格都填上（真机那天的 banner 原文就是这句）',
    [patch['draft.pickupCode'], patch['draft.stationName'], patch.banner.indexOf('没认出取件码') < 0].join('|'),
    '111-1-1111|西苑一栋南面快递中心|true');

  // 结构标记的左边界：⛔ 不许把**分段码的尾段**当成"标签前的纯数字码"切开
  // （切开后 `5001` 还能被"值在标签前"那条路认走 = **认了一个错码**，比漏认更贵）。
  const broken = text.cleanLine(text.insertVirtualBreaks(text.cleanLine(REAL_OCR_LINE)));
  eq('§20④（钉）：`111-1-1111取件码` 不许被 virtual break 切成 `304-2-` + `5001取件码`',
    [broken.indexOf('111-1-1111') >= 0, broken.split('\n').some((one) => /^\s*5001\s*取件码/.test(one))].join('|'),
    'true|false');

  // 一图多码路径对这一形态**认不出就该说认不出**（ok=false），⛔ 不许退化成"认成 `5001`"。
  // 它对"多卡片同屏"的形态仍是缺口 —— 已登记 TD-031，翻案条件是**真机多卡片的原文**。
  const multi = parse.parseParcelTextMulti([REAL_OCR_LINE]);
  eq('§20⑤（钉）：多码路径对该形态如实报 NO_CODE、条数 0（⛔ 不退化成认错码 `5001`）',
    [multi.ok, multi.items.length, JSON.stringify(multi.items.map((one) => one.pickupCode))].join('|'),
    'false|0|[]');
  // 首个文字前的等待：真机两轮**首轮**都报 NO_TEXT、**重试**都拿到文字（且 `partial:true`）⇒ 首字到达落在
  // 3s 死线附近（缺陷 E 的读数）。这条钉住"别再被改回 3000"——它是纯时序常量，没有别的东西看得见它。
  const fs = require('fs');
  const path = require('path');
  const ocrSrc = fs.readFileSync(path.join(__dirname, '..', 'utils', 'ocr.js'), 'utf8');
  const wait = /const MAX_WAIT_MS = (\d+);/.exec(ocrSrc);
  kit.check('§20⑥（真机读数要求）：首个文字到达前的等待 ≥ 8000ms（09:00/09:23 首轮 NO_TEXT、09:01/09:24 重试成功）',
    !!wait && Number(wait[1]) >= 8000, 'MAX_WAIT_MS = ' + (wait ? wait[1] : '(没找到)'));
}

/**
 * §21 运单后 5 位（`取件出示快递单号后五位` 形态）—— 2026-09-26 用户反馈「需要运单号后五位，但是没有识别成功」
 *
 * 这条形态的取件凭据**不是取件码**，而是运单号的末五位：卡片上印着"取件出示快递单号后五位 88888"。
 * 库里早有 `Parcel.trackingTail` 字段（强制"恰好 5 位数字"或空串），保存路径
 * （`intake-parts.planSingleSave`）也早就会把它记成「尾号NNNNN」并进「需查明」档 —— 缺的只是
 * **识别端从不回填它**。本节钉住三件事：能认出来 / 不该认时不许认 / 认出来之后存得下。
 * @param {{eq:function, check:function, formParts:object}} kit
 */
// 第二份**真机原文**（用户 09:33 截图「识别原文（1 行）」，照抄；页面上它是一整行）：
// 卡上有"快递单号后五位"那句话、有运单号 `100000000011119`、站点写的是 `湖工大苑一栋南面菜鸟驿站`。
const TAIL_OCR_LINE = '12:25:5G3哭物流服务谷阳光奥园.神农养生城雨街道待取件，已放入代收点河西校区泰山东白金华府衡L房.湘江府王家坪街取件出示快递单号后五位1111分享取件9菜鸟驿站|湖工大苑一栋南面菜鸟驿站韵达快递:100000000011119复制快递员:吴洪涛拨打电话订单编号:260918-116329049723734复制收货地址:湖南省株洲市天元区湖南工业大学 展开待取件今天12:20:54订阅提醒[代收点]您的快件已暂存至湖工大西苑一栋南面菜鸟驿站，地址:快件已由展开';

function runTrackingTailSection(kit) {
  const eq = kit.eq;
  const check = kit.check;
  const parse = require('../utils/parse.js');
  const codes = require('../utils/parse-codes.js');
  const plan = kit.formParts.planParsePatch;
  console.log('§21 运单后 5 位（取件出示快递单号后五位）');

  // ① 用户第二张源图（**人工转录**：卡片逐行可读）—— 印着 `后五位 88888`，运单号 `YT0000000088888`
  const card2 = ['20:27', '拼多多', '待取件，已放入代收点', '取件出示快递单号后五位 88888',
    '菜鸟驿站 | 湖工大西苑一栋南面菜鸟驿站', '圆通快递：YT0000000088888', '订单编号：260101-100000000000001'];
  const p2 = plan({ texts: card2, partial: false, draft: { stationName: '', pickupCode: '', lockerNo: '', trackingTail: '' }, customerId: 'c1' }).patch;
  eq('§21①（源图 2）：印着 `后五位 88888` ⇒ 尾号格填 88888、码格留空，banner 换口径（不再说"没认出取件码"）',
    [p2['draft.trackingTail'], String(p2['draft.pickupCode']), p2.banner.indexOf('没认出取件码') < 0].join('|'),
    '88888|undefined|true');

  // ② 第二份真机原文：卡上印的那串被 OCR 切断成 4 位（`后五位1111`）⇒ 走**运单号末五位**这条路
  const p3 = plan({ texts: [TAIL_OCR_LINE], partial: true, draft: { stationName: '', pickupCode: '', lockerNo: '', trackingTail: '' }, customerId: 'c1' }).patch;
  eq('§21②（真机原文 09:33）：印的 4 位不成形 ⇒ 退到运单号末五位 `11119`，站点按别名归一（两格都填上）',
    [p3['draft.trackingTail'], p3['draft.stationName']].join('|'), '11119|西苑一栋南面快递中心');

  // ③ **不许乱填**：有取件码的卡即使同屏出现"后五位"也不填尾号
  //    （`aggregate.pickupTier` 把"尾号非空"判成「需查明」⇒ 有码还填会把正常件错分到"需查明"）
  const both = parse.parseParcelText(['取件码 8-2-3021', '取件出示快递单号后五位12345', '南苑菜鸟驿站']);
  eq('§21③（反向钉）：有取件码的卡 ⇒ 尾号恒空（否则会把正常件错分进「需查明」档）',
    [both.ok, both.pickupCode, both.found.trackingTail].join('|'), 'true|8-2-3021|');

  // ④ **不许乱填**：卡上没有"后五位"那句话 ⇒ 一个数字都不取（真机 09:24 那份原文就是这种卡）
  eq('§21④（反向钉）：没有"（快递单号|运单号）后五位"这句话的卡 ⇒ 尾号恒空',
    parse.parseParcelText([REAL_OCR_LINE]).found.trackingTail, '');

  // ⑤ 那句话与运单号被结构标记切成**相邻两行**时也要取到（真机实测形态；只认同一行会取空 —— 本函数第一版就是这样）
  eq('§21⑤（窗口）：那句话在第 0 行、运单号在第 1 行 ⇒ 仍取到末五位',
    codes.collectTrackingTail(['取件出示快递单号后五位1111', '韵达快递:100000000011119']), '11119');

  // ⑥ 不成形就不填：只有 4 位、又没有运单号可推 ⇒ 空串（⛔ 不拿 4 位去撞"恰好 5 位"的字段闸）
  eq('§21⑥（不成形）：只有 `后五位1234` 且无运单号 ⇒ 空串', codes.collectTrackingTail(['取件出示快递单号后五位1234']), '');

  // ⑦ 端到端闭路：只填尾号（码格空着）也**存得下** —— 库里记成「尾号88888」并进「需查明」档。
  //    "取件码那格留空就行"这句话必须真成立，否则 banner 又是在骗人。
  const saved = kit.intakeParts.planSingleSave(
    { stationName: '南苑菜鸟驿站', pickupCode: '', lockerNo: '', trackingTail: '88888' }, true);
  eq('§21⑦（保存闭路）：只带尾号也能存 ⇒ pickupCode="尾号88888" + trackingTail="88888" + source=ocr',
    [saved.ok, saved.parcel.pickupCode, saved.parcel.trackingTail, saved.parcel.source].join('|'),
    'true|尾号88888|88888|ocr');
  // ⚠️ 2026-09-26 批 3：本条的盯点从 `intake-parts.js` **改到 `save-parts.js`** —— `planSingleSave` 那一族
  // 为守 500 行硬线又搬了一次（`intake-parts` 只 re-export）。**判据的意图不变**（尾号兜底必须在），只是换家；
  // 搬迁时它当场判红，正好证明这枚钉子钉的是真东西。
  check('§21⑦补充：`planSingleSave` 里那条"尾号"兜底仍在（删掉它 = 尾号件存不进去）',
    /'尾号'\s*\+\s*tail/.test(require('fs').readFileSync(
      require('path').join(__dirname, '..', 'pages', 'recognize', 'save-parts.js'), 'utf8')),
    'save-parts 的尾号兜底在位');
}

/**
 * §22 送检帧的尺寸闸（`ocr.frameSize`）—— 2026-09-26 用户实测「第一张图连试 2~3 次次次没文字」
 *
 * 那一屏报的是 `NO_TEXT`（"图里没文字"），而代码里有一条会让**真相被说反**的路：`createImage()` 若报
 * `0×0`（某些来源的图，如聊天选图里的 HEIC），旧算式算出的是 **1×1** 的帧 —— 把一个像素送去 OCR，
 * 当然一个字都认不出。本节把"解出来没有"钉成显式判断：0×0 / 1×1 一律**不可用**。
 * ⚠️ 这只是**诊断闸**：它保证屏上不再把"图没解出来"说成"图里没文字"，不等于根因已定 ——
 * 真机读数（下一轮 banner 里的"送检像素"）才决定是加自动重试还是按图找根因。
 * @param {{eq:function, check:function}} kit
 */
function runFrameSizeSection(kit) {
  const eq = kit.eq;
  const ocr = require('../utils/ocr.js');
  console.log('§22 送检帧尺寸闸（0×0 / 1×1 不许冒充"认过了"）');

  eq('§22①：退化尺寸 ⇒ 判"不可用"（null），不再是 1×1 的假帧',
    [String(ocr.frameSize(0, 0)), String(ocr.frameSize(0, 2532)), String(ocr.frameSize(undefined, 100))].join('|'),
    'null|null|null');

  eq('§22②：正常截图 ⇒ 按长边 1440 等比缩（1170×2532 ⇒ 665×1440）',
    JSON.stringify(ocr.frameSize(1170, 2532)), JSON.stringify({ width: 665, height: 1440 }));

  eq('§22③：小图不放大（长边 < 1440 时保持原尺寸）',
    JSON.stringify(ocr.frameSize(320, 200)), JSON.stringify({ width: 320, height: 200 }));

  eq('§22④（下限）：长边 < 64 的小图一律判不可用（那是"没解出来"的量级，OCR 也读不出字）',
    [String(ocr.frameSize(10, 10)), ocr.frameSize(64, 64) === null].join('|'), 'null|false');

  // 接线钉：`buildCanvasFrame` 必须真的用这条闸（否则 §22① 全绿而屏上行为不变 —— 判据没牙）
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'utils', 'ocr.js'), 'utf8');
  kit.check('§22⑤（接线钉）：`buildCanvasFrame` 用 `frameSize` 判尺寸，且退回 `getImageInfo` 取真实尺寸',
    /frameSize\(image\.width, image\.height, MAX_EDGE\)/.test(src)
      && /api\.getImageInfo\(/.test(src)
      && /MIN_FRAME_PX/.test(src),
    'ocr.js 已接闸 + 有 getImageInfo 退路');
}

/**
 * §23 空白帧判据（`ocr.pixelCoverage`）—— 2026-09-26 用户**第二个读数**：`NO_TEXT` + 送检像素 665×1440
 *
 * 那个读数把 §22 的假设**当场否掉**（尺寸完全正常，`frameSize` 没拦住它）⇒ 只剩两种可能，而它们的修法完全不同：
 * **① 帧其实是空白**（`drawImage` 没画上：解码器不认这种相册格式 / 上下文静默失败）—— 空白图必然认不出字；
 * **② 帧里有像素，是引擎对这张图不吐 anchor**。
 * 本节把 ① 变成**可测的量**（并配 §23⑤ 的"空白帧绝不送 OCR"接线钉），让下一次真机读数能直接分岔。
 * @param {{eq:function, check:function}} kit
 */
function runFrameBlankSection(kit) {
  const eq = kit.eq;
  const ocr = require('../utils/ocr.js');
  console.log('§23 空白帧判据（画面覆盖率）');

  const solid = (alpha, luma) => {
    const buf = new Uint8ClampedArray(400);   // 100 像素 × 4
    for (let i = 0; i < buf.length; i += 4) {
      buf[i] = luma === undefined ? 200 : luma;
      buf[i + 1] = luma === undefined ? 200 : luma;
      buf[i + 2] = luma === undefined ? 200 : luma;
      buf[i + 3] = alpha;
    }
    return buf;
  };
  eq('§23①：全透明帧 ⇒ 不透明 0、跨度 0（= "没画上"）',
    [ocr.frameStats(solid(0), 1).coverage, ocr.frameStats(solid(0), 1).spread].join('|'), '0|0');

  // ⚠️ 这一条是 2026-09-26 第三读数的**核心**：覆盖 100% 的**纯色**帧照样是"没解出内容"，
  // 旧判据（只看 alpha）会放它过去 ⇒ 引擎对着一张纯色图必然零 anchor，而屏上只说"图里没文字"。
  eq('§23②（第三读数）：纯色帧 ⇒ 不透明 100% **但**跨度 0 ⇒ 判"不可用"（旧判据在这里会放行）',
    [ocr.frameStats(solid(255, 120), 1).coverage, ocr.frameStats(solid(255, 120), 1).spread,
      ocr.frameIsUsable(ocr.frameStats(solid(255, 120), 1))].join('|'), '1|0|false');

  const mixed = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 10, 10, 10, 255, 240, 240, 240, 255]);
  eq('§23③：有明暗内容的帧 ⇒ 可用（跨度非 0 且不透明）',
    [ocr.frameStats(mixed, 1).spread, ocr.frameIsUsable(ocr.frameStats(mixed, 1))].join('|') !== '0|false',
    true);

  // ArrayBuffer **视图偏移**：`getImageData().data` 是 TypedArray 视图，真机上 byteOffset 未必是 0 ⇒
  // 直接把 `data.buffer` 交给引擎可能送出**整段池内存**（引擎于是零 anchor，而屏上只说"图里没文字"）。
  const pool = new Uint8ClampedArray(16);
  const view = pool.subarray(4, 12);
  view[0] = 7; view[7] = 9;
  const exact = ocr.frameBufferOf(view);
  eq('§23④（视图偏移钉）：交给引擎的必须是**这一块**像素 —— byteLength 与内容都对齐（不是整段 buffer）',
    [exact.byteLength, new Uint8ClampedArray(exact)[0], new Uint8ClampedArray(exact)[7]].join('|'), '8|7|9');

  eq('§23⑤（备用取图路决议）：不健康 + 无退路 ⇒ 0；有 compressImage ⇒ 1；压过一轮且有 fs ⇒ 2；健康 ⇒ 0',
    [ocr.nextRouteStep(0, { coverage: 0, spread: 0 }, {}),
      ocr.nextRouteStep(0, { coverage: 0, spread: 0 }, { compressImage: true }),
      ocr.nextRouteStep(1, { coverage: 0, spread: 0 }, { compressImage: true, fileSystem: true }),
      ocr.nextRouteStep(0, { coverage: 1, spread: 200 }, { compressImage: true, fileSystem: true })].join('|'),
    '0|1|2|0');

  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'utils', 'ocr.js'), 'utf8');
  // ⚠️ 接线钉必须盯**调用形状**，不能只查"源码里有没有这几个字符串"（注释里也有）——
  // 第一版就是这样，于是变异"把整段关掉（`if (false)`）"**判绿**：判据没牙（本批自曝并改正）。
  // ⚠️ 2026-09-26 本条**因调用形状的正当变化而更新**：加送检形态阶梯（§25）后，健康度闸多了 `!skipHealth`
  //   ——**只有分段重试的那条带**才跳过它（整帧路径一字未改）。判据的**意图不变**（不健康帧必须走 `nextRouteStep`），
  //   只是形状跟着改；`skipHealth` 只许出现在 §25 的分段映射里，由 §25⑤ 反向守住。
  kit.check('§23⑥（接线钉·盯调用形状）：不健康帧**真的走** `nextRouteStep`；交给引擎的 buffer 必须过 `frameBufferOf`',
    /if \(!skipHealth && !frameIsUsable\(stats\)\) \{/.test(src)
      && /const step = nextRouteStep\(route, stats, \{/.test(src)
      && /frameBuffer: frameBufferOf\(data\),/.test(src)
      && /api\.compressImage\(\{/.test(src)
      && /data:image\/jpeg;base64,/.test(src),
    'ocr.js 的不健康帧决议与 buffer 切分都按调用形状接上');
}

/**
 * §24 转发卡片（2026-09-26 用户裁决 A：「只在**录入页**开转发，卡片不含任何业务值」）
 *
 * 为什么值得单独一节：**卡片上写什么 = 对外承诺**。本项目对外说"取件码/手机号/站点只留本机"
 * （`docs/privacy/隐私保护指引.md`）⇒ 卡片一旦带上业务值，D3 就**跟着转发离开设备**。
 * 所以这一节钉的不是"功能在不在"，而是"**卡片里一个业务值都不许有**"。
 * @param {{eq:function, check:function}} kit
 */
function runShareSection(kit) {
  const eq = kit.eq;
  const share = require('../pages/recognize/share-flow.js');
  console.log('§24 转发卡片（只有 title/path；⛔ 零业务值）');

  const card = share.shareCard();
  eq('§24①：卡片**恰好**三个键（多了任何键都要先过隐私裁决）',
    Object.keys(card).sort().join(','), 'imageUrl,path,title');
  eq('§24②：卡片里**零数字**（取件码/运单号/手机号/件数一个都不能漏进来）',
    /\d/.test(JSON.stringify(card)), false);
  eq('§24③：卡片里**不含任何取件点正式名**（站点也是业务信息）',
    require('../utils/stations.js').listStationPoints().some((name) => JSON.stringify(card).indexOf(name) >= 0), false);
  eq('§24④：`onShareAppMessage` 返回的正是同一个卡片（页面转发走的就是它）',
    JSON.stringify(share.pageMethods.onShareAppMessage()), JSON.stringify(card));

  const pageSrc = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'pages', 'recognize', 'index.js'), 'utf8');
  kit.check('§24⑤（接线钉）：录入页把 `shareFlow.pageMethods` 并进了 Page（只定义零件不并 = 转发还是灰的）',
    /require\('\.\/share-flow\.js'\)/.test(pageSrc) && /shareFlow\.pageMethods/.test(pageSrc),
    'index.js 已并进 shareFlow.pageMethods');
  // ⚠️ 2026-09-26 独立审查 F4 修：**不自带封面 = 平台默认拿当前页截图当封面**，而这一页上就摆着取件码
  // ⇒ 转发一次等于把 D3 送出设备。所以"有 imageUrl"+"文件真的在"必须一起钉：只钉字符串会在删掉图片后仍绿。
  // ⚠️ 判据自己先把 `imageUrl` 取成**带兜底的局部变量**：否则"撤掉封面"的变异会让下一行抛 TypeError、
  // 把 await 链整条打断（= 链断式红，不是断言红 —— §25① 立过这条规矩，这里同样适用）。
  const cover = typeof card.imageUrl === 'string' ? card.imageUrl : '';
  const coverExists = cover.indexOf('/assets/') === 0
    && require('fs').existsSync(require('path').join(__dirname, '..', cover.replace(/^\//, '')));
  kit.check('§24⑥（对外承诺）：卡片**自带中性封面**（不是平台默认的页面截图），且那个文件真的在仓库里',
    coverExists, 'imageUrl=' + (cover || '(缺)') + ' ｜ 文件在=' + coverExists);
}

/**
 * §25 送检形态阶梯（`splitRanges` / `mergeOcrResults`）—— 2026-09-26 用户读数「明暗跨度 255」之后
 *
 * 那条读数把"帧的问题"全部排除（不透明 100%、跨度 255 = 一张真截图），只剩"**引擎对这张图的像素不吐 anchor**"。
 * 用户问「更改 ocr 模型能够修复吗？」—— 换模型要破两条既有裁决（`STACK` 无后端无云 + `W7` 云端 OCR 已否），
 * 所以先走**同一引擎、换送检形态**这条端侧路：纵向切 2 段各自送检（文字在帧里大 ~1.8×）。
 * @param {{eq:function, check:function}} kit
 */
function runSplitDeliverySection(kit) {
  const eq = kit.eq;
  const ocr = require('../utils/ocr.js');
  console.log('§25 送检形态阶梯（切段重试 + 结果合并）');

  // ⚠️ 取值全部走 `rel`（带空数组兜底）：否则"切段被打回一段"的变异会让 `two[1]` 抛 TypeError、
  // 把 await 链整条打断 —— 那是"链断式红"，不是"断言红"（本会话在 §18⓪ 立过这条规矩）。
  const rel = ocr.splitRanges(2) || [];
  const one = ocr.splitRanges(1) || [];
  eq('§25①：切 2 段 ⇒ 比例首尾相接、无缝隙（0→0.5→1）；切 1 段 = 整帧',
    [rel.map((x) => x.from + '-' + x.to).join(','), (one[0] || {}).from + '-' + (one[0] || {}).to,
      rel.length === 2 && rel[0].to !== undefined && rel[0].to === rel[1].from].join('|'),
    '0-0.5,0.5-1|0-1|true');

  eq('§25②：合并两段成功结果 ⇒ 文本**按上→下拼接**（阅读顺序），partial 取或',
    JSON.stringify(ocr.mergeOcrResults([
      { ok: true, texts: ['上1', '上2'], partial: false },
      { ok: true, texts: ['下1'], partial: true }
    ])), JSON.stringify({ ok: true, texts: ['上1', '上2', '下1'], partial: true }));

  eq('§25③：一段成功一段失败 ⇒ 仍算成功，且只含成功那段的文本（一段空白 ≠ 整张没字）',
    JSON.stringify(ocr.mergeOcrResults([
      { ok: false, reason: 'NO_TEXT' },
      { ok: true, texts: ['下1'], partial: false }
    ])), JSON.stringify({ ok: true, texts: ['下1'], partial: false }));

  eq('§25④：全失败 ⇒ 原样返回**第一个**失败（reason 不变 ⇒ 屏上那句话可复现）',
    JSON.stringify(ocr.mergeOcrResults([
      { ok: false, reason: 'NO_TEXT', detail: '第一次' },
      { ok: false, reason: 'IMAGE_DECODE_FAILED' }
    ])), JSON.stringify({ ok: false, reason: 'NO_TEXT', detail: '第一次' }));

  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'utils', 'ocr.js'), 'utf8');
  kit.check('§25⑤（接线钉·盯调用形状）：`recognizeImage` 只在 `NO_TEXT` 时**真的走**分段重试，且分段带 `skipHealth`',
    /first\.reason !== 'NO_TEXT'/.test(src)
      && /splitRanges\(SPLIT_SEGMENTS\)\.map\(\(one\) => \(\{ from: one\.from, to: one\.to, skipHealth: true \}\)\)/.test(src)
      && /mergeOcrResults\(parts\)/.test(src),
    'ocr.js 的分段重试已按调用形状接上');
}

/**
 * §26 批次合并（`parcel-drafts.mergeBatchDrafts`）—— 第 2 件「一次性多选多录入」批 1
 *
 * 这一处是"多张图共用一屏列表"的**唯一入口**，而它最容易错的形态是**key 撞车**
 * （每张图各自从 `d0` 起编号 ⇒ 直接 concat 会让后一张覆盖前一张）——屏上按 `data-key` 找行、保存按 key
 * 定位 ⇒ 撞 key = 行错位/漏存。所以本节钉的不是"能不能合并"，而是"**合并后每行还能被唯一定位**"。
 * @param {{eq:function, check:function}} kit
 */
function runBatchMergeSection(kit) {
  const eq = kit.eq;
  const drafts = require('../utils/parcel-drafts.js');
  console.log('§26 批次合并（多张图 → 一个列表；key 必须重编号）');

  const row = (station, code) => ({ key: 'd0', stationName: station, pickupCode: code, lockerNo: '', trackingTail: '', unknown: false, needStation: false });
  const two = drafts.mergeBatchDrafts([
    { items: [row('南苑菜鸟驿站', '8-2-3021')] },
    { items: [row('西苑一栋南面快递中心', '1-1-1111')] }
  ]);
  eq('§26①：两张各 1 件 ⇒ 2 行、key **重编号为 d0/d1**（不撞车）、并标明来自第几张图',
    [two.total, two.drafts.map((one) => one.key).join(','), two.drafts.map((one) => one.fromImage).join(','),
      two.drafts.map((one) => one.pickupCode).join(',')].join('|'),
    '2|d0,d1|0,1|8-2-3021,1-1-1111');

  const withEmpty = drafts.mergeBatchDrafts([
    { items: [] },
    { items: [row('南苑菜鸟驿站', '8-2-3021')] },
    null
  ]);
  eq('§26②：一张没产出**不阻断**其余（空批/坏批只计入 noItem，其余照常进列表）',
    [withEmpty.total, withEmpty.noItem, withEmpty.drafts[0].fromImage].join('|'), '1|2|1');

  const empty = drafts.mergeBatchDrafts(null);
  eq('§26③：非数组/空入参 ⇒ 空列表且不抛（页面据此兜住任何意外形状）',
    [empty.total, empty.noItem, Array.isArray(empty.drafts)].join('|'), '0|0|true');

  // ⚠️ **不改入参**：调用方还要拿原批次结果展示"第 i 张的识别原文"，就地改写会让那份展示失真。
  const original = [row('南苑菜鸟驿站', '8-2-3021')];
  const batches = [{ items: original }];
  drafts.mergeBatchDrafts(batches);
  eq('§26④：**不改入参**（原行对象与原数组都原样；`key` 仍是调用方给的 d0）',
    [original[0].key, Object.prototype.hasOwnProperty.call(original[0], 'fromImage'), batches[0].items.length].join('|'),
    'd0|false|1');
}

/**
 * §27 多选批次（第 2 件批 2）：补丁 → 行 / 逐张原文 / 批次 → 一屏补丁 / 路径收齐
 *
 * 这一节钉的是**多张图那条路**的四块判据。它们全都放在**纯函数**里（`parse-patch` 三个 + `form-parts` 一个），
 * 因为页面层零断言（TD-016），一旦把它们写在页面上，删掉任意一支自测仍会全绿。
 * @param {{eq:function, check:function}} kit
 */
function runBatchFlowSection(kit) {
  const eq = kit.eq;
  const parsePatch = require('../pages/recognize/parse-patch.js');
  const formParts = require('../pages/recognize/form-parts.js');
  const drafts = require('../utils/parcel-drafts.js');
  console.log('§27 多选批次（补丁→行 / 逐张原文 / 批次→一屏 / 路径收齐）');

  eq('§27①：单条支的补丁 ⇒ 恰好一行（四格全空 ⇒ **零行**：这张图没认出东西，不许硬造空行）',
    [parsePatch.rowsFromPatch({ 'draft.pickupCode': '8-2-3021', 'draft.stationName': '南苑菜鸟驿站' }).length,
      parsePatch.rowsFromPatch({ 'draft.pickupCode': '8-2-3021', 'draft.stationName': '南苑菜鸟驿站' })[0].pickupCode,
      parsePatch.rowsFromPatch({ banner: '没认出来' }).length,
      parsePatch.rowsFromPatch({ 'draft.trackingTail': '88888' }).length].join('|'),
    '1|8-2-3021|0|1');

  eq('§27②：多码支的补丁 ⇒ 原样给出那些行（不重新造、不改字段）',
    JSON.stringify(parsePatch.rowsFromPatch({ drafts: [{ key: 'd1', pickupCode: 'X' }] })),
    JSON.stringify([{ key: 'd1', pickupCode: 'X' }]));

  eq('§27③：逐张原文带标号（N 张并排展开时，"这行字是哪张图里的"必须能看出来）',
    parsePatch.batchLines([['a1', 'a2'], ['b1']]).join('/'), '— 第 1 张 —/a1/a2/— 第 2 张 —/b1');

  // 批次 → 一屏：banner 说真话（张数/件数/几张没认出东西）+ 1 行时**同步到单条卡**（`drafts.length <= 1` 那条 UI 读 draft.*）
  // ⚠️ 2026-09-26 独立审查 F2 修：原来只钉 `stationName`/`pickupCode` **两格**，而 `trackingTail` 正是"运单后 5 位"
  //    形态的唯一落点 —— 审稿人实测"摘掉第 273 行"判据**仍绿**、行为却已退化（尾号掉了 ⇒ 那一行存不进去）。
  //    所以夹具改成四格**全都非空**、期望串**四格全钉**（锁住"漏一格也红"）。
  const oneRow = [{ key: 'd0', stationName: '南苑菜鸟驿站', pickupCode: '8-2-3021', lockerNo: '3号柜', trackingTail: '88888', unknown: false, needStation: false }];
  const mergedOne = drafts.mergeBatchDrafts([{ items: oneRow }, { items: [] }]);
  const patchOne = parsePatch.planBatchPatch({ merged: mergedOne, imageCount: 2, partialAny: false, failedAny: 1 });
  eq('§27④：批次补丁：1 行时**同步到单条卡**的**全部四格**（漏一格 = 那一格的东西存不进去）',
    [patchOne.drafts.length, patchOne['draft.pickupCode'], patchOne['draft.stationName'],
      patchOne['draft.lockerNo'], patchOne['draft.trackingTail'], patchOne.recognitionUsed].join('|'),
    '1|8-2-3021|南苑菜鸟驿站|3号柜|88888|true');
  eq('§27⑤：批次 banner 说真话（几张图 / 几件 / 几张没认出东西）',
    [patchOne.banner.indexOf('这 2 张图里有 1 件') >= 0, patchOne.banner.indexOf('有 1 张没认出东西') >= 0].join('|'),
    'true|true');
  const patchEmpty = parsePatch.planBatchPatch({
    merged: drafts.mergeBatchDrafts([{ items: [] }, { items: [] }]), imageCount: 2, partialAny: false, failedAny: 2
  });
  eq('§27⑥：一条都没产出 ⇒ `recognitionUsed` **不写**（选过图但没填进去 = manual，落库 source 不许说谎）',
    [patchEmpty.drafts.length, Object.prototype.hasOwnProperty.call(patchEmpty, 'recognitionUsed')].join('|'), '0|false');

  eq('§27⑦：两个取图接口的字段名都要收（单选那条路用的同一套表达式 ⇒ 多选不许少一张）',
    formParts.allTempPaths({ tempFiles: [{ path: 'p1' }, { tempFilePath: 'p2' }, {}, null, { path: '' }] }).join(','),
    'p1,p2');

  // 接线钉：多选必须真的接在两条取图动线上（`count` 放开 + 分流：1 张走原路、≥2 张走批次）
  const flowSrc = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'pages', 'recognize', 'recognize-flow.js'), 'utf8');
  kit.check('§27⑧（接线钉）：两条取图动线都 `count: MAX_BATCH`，且分流判据写着"1 张 = 原路"',
    (flowSrc.match(/count: MAX_BATCH/g) || []).length === 2
      && /if \(list\.length === 1\) \{ this\.runRecognize\(list\[0\]\); return; \}/.test(flowSrc)
      && /this\.startBatchRecognize\(list\)/.test(flowSrc),
    '两条动线的 count 都已放开 + 分流钉在位');
}

module.exports = {
  runParsePatchSection, runStationAliasSection, runRealOcrSection, runTrackingTailSection,
  runFrameSizeSection, runFrameBlankSection, runShareSection, runSplitDeliverySection, runBatchMergeSection,
  runBatchFlowSection
};
