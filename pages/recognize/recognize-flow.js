// pages/recognize/recognize-flow.js · 取图 → 识别 那条链路（**从 `index.js` 整体搬出来**，2026-09-26）
//
// 为什么搬：① `index.js` 当时正好 **500/500 非空行**（AGENTS §11.1 硬上限，TD-001 记着"下一次改动必须先搬迁"），
// 而第 2 件「一次性多选多录入」要改的正是这一簇；② 搬进零件后处理器第一次有机器闸可钉（页面层零断言 TD-016）。
// ⚠️ 搬迁纪律（本项目因反例付过代价）：**搬函数必须连依赖一起搬** —— 本文件需要
// `privacy` / `ocr` / `reason.failureText` / `form-parts`（取图与表单零件）/ `parse-patch`（补丁）/
// `parcel-drafts`（批次合并），一件都不能漏；漏了的表现是"一进这一屏就抛 ReferenceError"（BUG-04 同族）。
//
// ⚠️ 依赖单向：本文件 require `./form-parts.js` 与 `./parse-patch.js`，**它们不 require 本文件**；
// 只有 `index.js` 把这里的 `pageMethods` 并进页面（`Object.assign`，与 `share-flow`/`session-key-flow` 同形）。
'use strict';

const privacy = require('../../utils/privacy.js');
const ocr = require('../../utils/ocr.js');
const parcelDrafts = require('../../utils/parcel-drafts.js');
const storage = require('../../utils/storage.js');
const { failureText } = require('../../utils/reason.js');
const parts = require('./form-parts.js');
const parsePatch = require('./parse-patch.js');
const intake = require('./intake-parts.js');
const saveParts = require('./save-parts.js');

const hasFormContent = parts.hasFormContent;
const freshForm = parts.freshForm;
const firstTempPath = parts.firstTempPath;
const allTempPaths = parts.allTempPaths;
const BANNER_RECOGNIZING = parts.BANNER_RECOGNIZING;
const planParsePatch = parsePatch.planParsePatch;
const rowsFromPatch = parsePatch.rowsFromPatch;
const batchLines = parsePatch.batchLines;
const planBatchPatch = parsePatch.planBatchPatch;

// 一次最多选几张（第 2 件 · 用户诉求「一次性多选多录入」）。
// 取 9 的理由：① 微信两个取图接口的 `count` 上限就是 9；② 每张最多等 8s（首个文字）+ 可能再切段重试一次
// ⇒ 9 张最坏情况本来就是"很长的一屏"，再多只会让人以为卡死（屏上有"第 i/N 张"的进度行兜住认知）。
const MAX_BATCH = 9;

const pageMethods = {
  // ── 取图来源一：从聊天选图（客户把截图发在会话里时不必先存相册）───────────────
  // 为什么**不**过相册隐私门禁：隐私声明是按**接口**分类型的，聊天选图是"用户在自己会话里挑个文件"，
  // 不是访问相册（v1 2026-09-19 已按官方文档核过；相册那条声明管的是 chooseMedia）。
  onChooseFromChat() {
    if (this.data.busy || this.data.recognizing) return;
    if (typeof wx.chooseMessageFile !== 'function') {
      // 降级要"说一句"（不能静默换路径）：否则用户不明白为什么弹出来的不是聊天选择器
      this.setBanner('这台微信不支持"从聊天选图" —— 换右边那个按钮，或直接手填。');
      return;
    }
    this.setData({ busy: true });
    wx.chooseMessageFile({
      count: MAX_BATCH,   // 2026-09-26：1 → MAX_BATCH（第 2 件；页面上仍是"一次点一次"，只多选了不额外多一步）
      type: 'image', // 从源头排掉视频与文档
      success: (res) => {
        const paths = allTempPaths(res);
        if (paths.length === 0) { this.setBanner('没选到图片，请重试，或直接手填。'); return; }
        this.runRecognizePaths(paths);
      },
      fail: (err) => {
        const raw = (err && err.errMsg) || '';
        // 取消不是错误：不提示，否则点"取消"还挨一句红字
        if (raw.indexOf('cancel') < 0) this.setBanner('从聊天选图失败：' + raw + '（可以直接手填）');
      },
      complete: () => this.setData({ busy: false })
    });
  },

  // ── 取图来源二：相册或拍照（第一道门禁 = 相册隐私）─────────────────────────
  onChooseFromAlbum() {
    if (this.data.busy || this.data.recognizing) return;
    if (typeof wx.chooseMedia !== 'function') {
      this.setBanner('这台微信不支持相册选图 —— 换左边的按钮，或直接手填。');
      return;
    }
    this.setData({ busy: true });
    privacy.ensureMediaAccess().then((gate) => {
      if (!gate.ok) {
        // 门禁失败只说"相册不可用"，页面留在可手填的状态（M6 / 验收 V11）
        this.setBanner(failureText(gate.reason, gate.detail));
        return null;
      }
      return new Promise((resolve) => {
        wx.chooseMedia({
          count: MAX_BATCH,   // 2026-09-26：1 → MAX_BATCH（第 2 件；`sourceType` 仍含拍照）
          mediaType: ['image'],
          sourceType: ['album', 'camera'],
          success: (res) => {
            const paths = allTempPaths(res);
            if (paths.length === 0) this.setBanner('没选到图片，请重试，或直接手填。');
            else this.runRecognizePaths(paths);
            resolve();
          },
          fail: (err) => {
            const raw = (err && err.errMsg) || '未知原因';
            this.setBanner('选图失败：' + raw + '（可以直接手填）');
            resolve();
          }
        });
      });
    }).catch((err) => {
      this.setBanner('选图流程异常：' + ((err && err.message) || err) + '（可以直接手填）');
    }).then(() => this.setData({ busy: false }));
  },

  /**
   * 取图结果的**分流**（2026-09-26 第 2 件）：1 张 = 原路不变；≥2 张 = 走批次。
   * 为什么这么分：单张那条路是全项目真机验过最多的一条（批 1~11 的读数都在它上面），
   * ⛔ **不许为了多选去动它** —— 批次只在"人真的多选了"时才生效。
   */
  runRecognizePaths(paths) {
    const list = Array.isArray(paths) ? paths.filter((one) => typeof one === 'string' && one) : [];
    if (list.length === 0) return;
    if (list.length === 1) { this.runRecognize(list[0]); return; }
    this.startBatchRecognize(list);
  },

  // ── 识别链路（两条来源合流到这里，同一套降级口径）────────────────────────
  // 第二道门禁 = 摄像头隐私（VisionKit 的 VKSession 要的是**摄像头**类型，与相册是两个独立声明；
  // 只声明相册时 session.start 直接 errno=112）。第三道 = 识别与解析本身，在 applyParse 里。
  // 换图前先看这一屏有没有内容（R-04）：`freshForm()` 会把站点、码、整张多码列表一起清掉，
  // 而 M6 的底线是"手输能存" —— 静默清空人打了半天的格子，等于把这条底线反着写。
  // 只在**真的会丢东西**时弹确认：空屏还问一次就是拿对话框拦路（这一页每次选图都要过）。
  runRecognize(filePath) {
    // ⚠️ 整行替换的坑（R4-01，r4 抓出的 P1，由 r3 装配时的**逐行改写**造成）：这一行原本是
    // `if (!this.hasFormContent()) { this.startRecognize(filePath); return; }`，我把整行换成只有条件、
    // 函数体没了 ⇒ 下面那个 `wx.showModal` 变成 if 体：有内容时**既不识别也不提示，静默无反应**，
    // 空屏时反倒每次都弹框。`node --check` 与两道门禁全绿（selftest 不 require 页面）。
    if (!hasFormContent(this.data.drafts, this.data.draft)) { this.startRecognize(filePath); return; }
    wx.showModal({
      title: '换图会清掉现在填的内容',
      content: '继续识别会把上面填好的站点、取件码（或多码列表）全部清空，换成这张新图的结果。',
      confirmText: '继续识别',
      cancelText: '先不识别',
      success: (res) => {
        // 取消 = 什么都没发生（不动表单、不写库、不改提示），人可以接着改现在这几格
        if (res.confirm) this.startRecognize(filePath);
      },
      // 弹窗本身也会失败（低版本基础库/被系统拦掉）：不吭声 = 人以为识别卡住了
      fail: () => this.onRecognizeFailed('换图的确认框弹不出来，这次没有识别')
    });
  },

  startRecognize(filePath) {
    this.setDataMeasured(Object.assign(freshForm(), {
      recognizing: true,
      busy: false,
      imagePath: filePath,
      banner: BANNER_RECOGNIZING
    }));
    privacy.ensureCameraAccess().then((gate) => {
      if (!gate.ok) return { ok: false, reason: gate.reason, detail: gate.detail };
      return ocr.recognizeImage({ filePath: filePath, page: this });
    }).then((result) => {
      if (!result || !result.ok) {
        // reason 缺失也走文案口（它自带 UNKNOWN 兜底），页面不自己造码、也不自己拼 detail
        this.onRecognizeFailed(failureText(result && result.reason, result && result.detail));
        return;
      }
      this.applyParse(result.texts || [], result.partial === true);
    }).catch((err) => {
      this.onRecognizeFailed('识别流程异常：' + ((err && err.message) || err));
    });
  },

  /**
   * 批次识别（2026-09-26 第 2 件 · 用户裁决「A 但要有单条保存入口」）：N 张图**逐张串行**识别，
   * 结果并成**同一屏多码列表**（SCOPE M2/M3）。
   * 三条纪律：
   *   ① **绝不并发**：`ocr.recognizeImage` 内部有串行队列，但这里也**顺序等待**（VKSession 是页面单例，
   *      并发必然互踩；顺序等待还能让进度行"第 i/N 张"如实推进）；
   *   ② **一张失败不阻断其余**（SCOPE M7）：失败那张只留一句如实说明，其余照常进列表；
   *   ③ **识别原文逐张标号**（`batchLines`）：N 张的原文并排展开，但每段前面写"第 i 张"，不糊成一片（SCOPE M6）。
   */
  startBatchRecognize(paths) {
    const list = paths.slice();
    const total = list.length;
    this.setDataMeasured(Object.assign(freshForm(), {
      recognizing: true,
      busy: false,
      imagePath: list[0],
      banner: '正在识别第 1/' + total + ' 张…' + BANNER_RECOGNIZING
    }));
    const textsPerImage = [];
    const batches = [];
    let partialAny = false;
    let failedAny = 0;
    const step = (index) => {
      if (index >= total) return Promise.resolve();
      this.setBanner('正在识别第 ' + (index + 1) + '/' + total + ' 张…');
      return privacy.ensureCameraAccess().then((gate) => {
        if (!gate.ok) return { ok: false, reason: gate.reason, detail: gate.detail };
        return ocr.recognizeImage({ filePath: list[index], page: this });
      }).then((result) => {
        if (!result || !result.ok) {
          failedAny += 1;
          textsPerImage.push(['（第 ' + (index + 1) + ' 张没认出来：' + failureText(result && result.reason, result && result.detail) + '）']);
          batches.push({ items: [] });
          return;
        }
        const texts = result.texts || [];
        if (result.partial === true) partialAny = true;
        textsPerImage.push(texts);
        const patch = planParsePatch({
          texts: texts,
          partial: result.partial === true,
          draft: { stationName: '', pickupCode: '', lockerNo: '', trackingTail: '' },
          customerId: this.data.customerId
        }).patch;
        batches.push({ items: rowsFromPatch(patch) });
      }).then(() => step(index + 1));
    };
    // `privacy.ensureCameraAccess()` 理论上不会 reject（失败走 gate.ok=false），但链条上任何一段抛出都要收口：
    // 否则 `recognizing` 永远停在 true ⇒ 整屏点不动（这是"用一个 bug 盖住另一个"的老形态）。
    return step(0).then(() => {
      const merged = parcelDrafts.mergeBatchDrafts(batches);
      const patch = planBatchPatch({
        merged: merged,
        imageCount: total,
        partialAny: partialAny,
        failedAny: failedAny
      });
      patch.lines = batchLines(textsPerImage);
      this.setDataMeasured(patch);
    }).catch((err) => {
      this.onRecognizeFailed('批量识别异常：' + ((err && err.message) || err));
    });
  },

  // 识别侧任何失败的统一收口：复位状态 + 把话说清"卡在哪一步"，并明确"手填照样能存"（M6）
  onRecognizeFailed(message) {
    this.setDataMeasured({ recognizing: false, banner: message + ' —— 下面的格子照旧能手填，手填也算录进来。' });
  },

  // 认出来多少填多少；认不全就展开原文让人照着抄（第三道门禁的降级分支）。
  // 整簇判据（banner 说真话 / 站点提示上不上屏 / 多码展开 / `source` 算不算采信）都在
  // `parse-patch.planParsePatch` —— 留在页面里 = 自测够不到（TD-016），删掉那支自测仍全绿。
  applyParse(texts, partial) {
    this.setDataMeasured(planParsePatch({
      texts: texts,
      partial: partial === true,
      draft: this.data.draft,
      customerId: this.data.customerId
    }).patch);
  },

  /**
   * **单条保存入口**（2026-09-26 第 2 件批 3；用户补充要求「A 但要有单条保存入口」）：
   * 多码列表里点某一行的「存这条」⇒ 只落这一条、**其余留在屏上**继续存（D1：存掉的行从列表移除）。
   *
   * 与「全部保存」的关系（三条全部来自用户裁决，⛔ 不许各自为政）：
   *   · **拦空同一套**（D2）：能不能存由 `save-parts.planSingleSave` 一个函数说了算，写盘也走
   *     `intake.commitSingleSave` —— 与 `saveSingle` 那条路**同一份代码**，所以不会长出
   *     "整批存不进、单条却进去了"这种自相矛盾；
   *   · **归属仍在保存这一刻裁决**（2026-09-25 裁决未被取代）：手选 > 会话键唯一命中 > 当场建档。
   *     归属没定（要选人/要建档）时，照 `onSave` 的同一套把选择摆上屏并**说清"这一行还没存"**
   *     （⛔ 不许点了没反应 —— 那是本项目反复出现的坏形态）；
   *   · **存成功了才动屏**：先写盘、成功后再把那一行移出列表（反过来 = "行没了但没存上"，人会以为存住了）。
   * ⚠️ 与 `finishSaved` 的**刻意不同**：单条存完**不退屏**（还有别的件要存），所以也不上 saving 锁 ——
   *   锁住的话人就没法接着存剩下的了，而 D1 要的正是"存一条、剩的留着"。
   */
  onSaveRow(event) {
    if (this.data.saving) return;
    if (this.data.recognizing) {
      this.showError('识别还没停 —— 稍等一下再存（你填的内容不会被覆盖）。');
      return;
    }
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const list = this.data.drafts || [];
    const row = saveParts.findRowByKey(list, dataset.key);
    if (!row) {
      // key 对不上 = 列表刚被别的动作换过：如实说一句，让重进一次，而不是默默什么都不做
      this.showError('这一行已经不在列表里了 —— 回上一屏重进一次再试（列表每次刷新都会重编号）。');
      return;
    }
    const plan = saveParts.planRowSave(row, this.data.recognitionUsed === true, list);
    if (!plan.ok) { this.showError(plan.errorText); return; }
    const gate = intake.resolveSaveTarget({
      pickedCustomerId: this.data.customerId,
      sessionKey: parts.readRoomHint({ app: getApp() }),
      customers: this.customerList || [],
      pendingLine: this.data.createLine
    });
    const view = intake.saveFlowPatch(gate, parts.labelOf(this.data.customerOptions, gate.customerId));
    if (view.kind !== 'save') {
      this.setDataMeasured(view.patch);
      this.setBanner('这一行还没存 —— 先把归属定下来（上面选一位，或当场建一位），然后再点它的「存这条」。');
      return;
    }
    const result = intake.commitSingleSave({
      customerId: gate.customerId,
      draft: plan.parcel,
      recognitionUsed: this.data.recognitionUsed,
      storage: storage
    });
    if (!result.ok) { this.showError(result.errorText); return; }
    this.setDataMeasured(saveParts.remainingPatch(plan.remaining));
    wx.showToast({
      title: plan.remaining.length > 0 ? ('已存 1 条，还剩 ' + plan.remaining.length + ' 件') : '已存 1 条，这一屏清空了',
      icon: 'success'
    });
  }
};

module.exports = { MAX_BATCH, pageMethods };
