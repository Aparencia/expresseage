// utils/ocr.js · 端侧识别（VisionKit OCR）封装；契约见 docs/registry/APIS.md §2
//
// 为什么长这样（两条实测教训，别简化掉）：
// ① **平台依赖全部注入**：VisionKit 在开发者工具里必然失败、在 Node 里根本不存在。核心的"开会话→start→runOCR→收文字"
//    是一段有顺序、有超时、必须销毁会话的编排逻辑——把它写成接受注入依赖的纯编排 + 一个薄适配层（platform），
//    才能在 tools/selftest.js 里零设备地测它的失败分支（errno=112 这类错误正是最该被钉住的分支）。
// ② **VKSession 在页面上是单例、生命周期间互斥**（官方 VisionKit 基础文档）→ 两个识别并发必然互相踩。
//    所以对外只暴露带串行队列的 `recognizeImage`，一次只跑一个会话。
//
// ⚠️ 隐私：VKSession 走的是**摄像头**隐私类型，调用方必须先过 `privacy.ensureCameraAccess()`
//    （与相册是两个独立类型；2026-09-17 真机实测：只声明相册时 start 返回 errno=112）。
// ⚠️ D3：返回的 `texts` 可能含取件码。**调用方禁止把 texts 写日志/上报/落库**（DATA_DICT §1.4）。
'use strict';

const MAX_EDGE = 1440;        // 长边上限：2d canvas 的 getImageData 在大图上有尺寸/内存风险（真机实测过）
// 送检帧的**下限**（见 `frameSize`）：低于它就是"图没解出来"，不是"图里没文字"。
// 取 64 的理由：OCR 要能读字，长边至少几十像素；而退化值（0×0/1×1）离它有一个数量级 ⇒ 这条闸判的是
// "解没解出来"，不会误伤正常图（正常截图缩放后长边恒 = 1440 或原尺寸）。
const MIN_FRAME_PX = 64;
const IDLE_MS = 300;          // 收到文字后多久没新文字就收口
const MAX_WAIT_MS = 8000;     // 首个文字到达前的最长等待：宁可等久一点，也不要"文字还没回来就判 NO_TEXT"
// ⚠️ 2026-09-26 由 3000 → **8000**（**真机两轮读数**，不是猜）：09:00 与 09:23 两次都在**首轮**报 NO_TEXT
//    （屏上「图里没认出文字，请手工填写。（没识别出文字）」），而紧接着 09:01 与 09:24 的**同图重试**都拿到了
//    文字、且 09:24 那次是 `partial:true` —— 说明"首个文字"恰好落在 3s 死线附近（到了就被判"没读完全"，没到就判"没认出来"）。
//    本常量原注释自己就写着"宁可等久一点"，3000 与这句话不符。⛔ 仍**不加重试**：先只动这一个杠杆，
//    下一轮真机读数（首轮是否还报 NO_TEXT）再决定要不要加"NO_TEXT 自动重试一次"。
const FRAME_TIMEOUT_MS = 8000; // 取像素的硬超时：解码大图可能慢，但**必须**能失败收口（超时 = 队列被永久堵死）

// start 回调的 errno → 归因（官方 VKSession.start 表）。**112 单独归因**：
// 它不是"设备不行"，而是"隐私类型没声明"——两者的处置完全不同（前者退方案 B，后者去公众平台补声明）。
function classifyStartErrno(errno) {
  if (errno === 112) {
    return { reason: 'VK_INIT_FAILED', detail: 'VisionKit 被隐私门禁拦住：接口未在隐私协议中声明（errno=112）。'
      + '需在公众平台「设置-服务内容声明-用户隐私保护指引」声明【摄像头】类型，生效后再试。' };
  }
  if (errno === 2003001 || errno === 2003002) {
    return { reason: 'VK_INIT_FAILED', detail: 'VisionKit 需要相机权限（errno=' + errno + '），请授权后重试。' };
  }
  if (errno === 104) {
    return { reason: 'PRIVACY_DENIED_CAMERA', detail: '用户取消了授权（errno=104）。' };
  }
  if (errno === 2000002 || errno === 2000004) {
    return { reason: 'VK_UNSUPPORTED', detail: '此设备不支持端侧识别（errno=' + errno + '），请手工填写。' };
  }
  return { reason: 'VK_INIT_FAILED', detail: 'session.start 失败（errno=' + errno + '）。' };
}

// 字段名与全项目契约保持一致：失败一律 `{ok:false, reason, detail}`（与 storage/privacy 同形），
// 页面才能统一走 reasonText(reason) + detail 后缀，不必为每个模块写特例
function fail(reason, detail) {
  return { ok: false, reason: reason, detail: detail };
}

// 两个等待窗口的**唯一管理点**。R-01 的教训：当初"首个文字前的等待"与"收尾等待"共用了同一个武装函数，
// 于是首个文字被 idle 死线掐死。这里做成两个具名方法、**同一时刻只允许一个在跑**，形态上就摆不错。
function createWindowTimers(expire, idleMs, maxWaitMs) {
  let idleTimer = null;
  let deadlineTimer = null;
  const clear = () => {
    if (idleTimer) clearTimeout(idleTimer);
    if (deadlineTimer) clearTimeout(deadlineTimer);
    idleTimer = null;
    deadlineTimer = null;
  };
  return {
    // 首个文字到达前：只由总时限兜底（**绝不**按 idle 掐）
    startDeadline() { deadlineTimer = setTimeout(expire, maxWaitMs); },
    // 收到文字后：把收尾窗口续期（只有收到过文字才可能"收工"）
    renewIdle() { clear(); idleTimer = setTimeout(expire, idleMs); },
    clear: clear
  };
}

// 订阅文字输出：锚点里的 text 才是要的东西；每收到新文字就通知调用方（把收尾窗口续期）
function subscribeTexts(session, texts, onText) {
  if (typeof session.on !== 'function') return;
  session.on('updateAnchors', (anchors) => {
    if (!anchors) return;
    for (const anchor of anchors) {
      if (anchor && anchor.text) texts.push(anchor.text);
    }
    if (texts.length > 0) onText();
  });
}

// 跑一个会话直到收口：会自己管窗口与销毁，**任何出口都必须 resolve**（绝不悬挂，见 R-02）
function runSession(session, frame, idleMs, maxWaitMs) {
  return new Promise((resolve) => {
    // 单例约束：无论成功失败，离开这一步前必须销毁会话，否则下一次识别建不起来
    let settled = false;
    const texts = [];
    const windows = createWindowTimers(() => finish(), idleMs, maxWaitMs);

    // 不带 result = 到时限收工：已收到文字就如实标 partial（"可能不全"，R-12），一个字都没有才报 NO_TEXT
    const finish = (result) => {
      if (settled) return;
      settled = true;
      windows.clear();
      try {
        if (typeof session.destroy === 'function') session.destroy();
      } catch (err) {
        // 销毁抛错绝不能吃掉 resolve：否则调用方（含串行队列）永久挂起（2026-09-17 审查 R-02）
      }
      if (result) { resolve(result); return; }
      // ⚠️ 2026-09-26：detail 里带上**送检像素与覆盖率** —— 它们把三种完全不同的情况分开：
      // "尺寸退化"（解码）、"空白帧"（解码器不认格式）、"正常帧却零 anchor"（引擎/图内容）。
      // 屏上一行就够人判读（用户那张失败的图，这两条读数就是下一步分岔的依据）。
      resolve(texts.length > 0 ? { ok: true, texts: texts, partial: true }
        : fail('NO_TEXT', '没识别出文字；送检像素 ' + (frame ? frame.width + '×' + frame.height : '未知')
          + (frame && typeof frame.coverage === 'number' ? '；不透明 ' + Math.round(frame.coverage * 100) + '%' : '')
          + (frame && typeof frame.spread === 'number' ? '；明暗跨度 ' + frame.spread : '')));
    };

    subscribeTexts(session, texts, () => windows.renewIdle());
    windows.startDeadline(); // 首个文字前的等待：只有它兜底

    try {
      session.start((errno) => {
        if (errno) {
          const verdict = classifyStartErrno(errno);
          finish(fail(verdict.reason, verdict.detail));
          return;
        }
        try {
          session.runOCR({ frameBuffer: frame.frameBuffer, width: frame.width, height: frame.height });
        } catch (err) {
          finish(fail('VK_INIT_FAILED', 'runOCR 抛错：' + ((err && err.message) || err)));
        }
      });
    } catch (err) {
      finish(fail('VK_INIT_FAILED', 'session.start 抛错：' + ((err && err.message) || err)));
    }
  });
}

// 取像素带显式超时：onload/onerror 都不触发时（异常图/解码器边界/节点查询不回调）必须能失败收口，
// 否则串行队列被永久堵死——本次进程内后续识别全废，页面还卡在"识别中"（2026-09-17 审查 R-02）
function withTimeout(promise, ms, onTimeout) {
  return new Promise((resolve, reject) => {
    const guard = setTimeout(() => reject(onTimeout()), ms);
    promise.then(
      (value) => { clearTimeout(guard); resolve(value); },
      (err) => { clearTimeout(guard); reject(err); }
    );
  });
}

/**
 * 纯编排：把"一张图 → 文字行"的全过程跑完（**不碰 wx**，所有平台能力由 deps 注入）
 * @param {{filePath:string, createSession:Function, buildFrame:Function,
 *          idleMs?:number, maxWaitMs?:number, frameTimeoutMs?:number}} deps
 * @returns {Promise<{ok:boolean, texts?:string[], partial?:boolean, reason?:string, detail?:string}>}
 *   `partial:true` = 到时限收工时已收到部分文字（**不是**"识别完成"），页面应提示"可能不全、请核对"
 */
function runVisionOcr(deps) {
  const createSession = deps && deps.createSession;
  const buildFrame = deps && deps.buildFrame;
  const idleMs = (deps && deps.idleMs) || IDLE_MS;
  const maxWaitMs = (deps && deps.maxWaitMs) || MAX_WAIT_MS;
  const frameTimeoutMs = (deps && deps.frameTimeoutMs) || FRAME_TIMEOUT_MS;

  if (typeof createSession !== 'function' || typeof buildFrame !== 'function') {
    return Promise.resolve(fail('VK_UNSUPPORTED', '缺少平台能力注入（createSession/buildFrame）'));
  }
  if (!deps.filePath) {
    return Promise.resolve(fail('IMAGE_DECODE_FAILED', '没有图片路径'));
  }

  return withTimeout(
    Promise.resolve().then(() => buildFrame(deps.filePath)),
    frameTimeoutMs,
    () => ({ reason: 'IMAGE_DECODE_FAILED', detail: '图片处理超时（' + frameTimeoutMs + 'ms 内没读出像素）' })
  )
    .then((frame) => {
      let session;
      try {
        session = createSession();
      } catch (err) {
        return fail('VK_INIT_FAILED', 'createVKSession 抛错：' + ((err && err.message) || err));
      }
      if (!session || typeof session.start !== 'function') {
        return fail('VK_INIT_FAILED', 'createVKSession 没返回可用会话');
      }
      return runSession(session, frame, idleMs, maxWaitMs);
    })
    .catch((err) => fail(
      (err && err.reason) || 'IMAGE_DECODE_FAILED',
      (err && err.detail) || (err && err.message) || '图片读取失败'
    ));
}

// —— 平台适配层（唯一碰 wx 的地方）——
function createWxOcr(wxApi) {
  const api = wxApi || (typeof wx !== 'undefined' ? wx : null);
  if (!api || typeof api.createVKSession !== 'function') {
    return null; // 旧微信 / 模拟器：调用方据此走降级（不上抛异常）
  }
  return function createVisionSession() {
    return api.createVKSession({ track: { OCR: { mode: 2 } } }); // mode 2 = 手动传入图像（mode 1 是摄像头实时）
  };
}

// 送检帧的尺寸（**纯函数**，零设备可测）：把原图像素按长边上限等比缩到 `maxEdge` 以内。
// ⚠️ 2026-09-26 真机缺陷（用户实测"同一张图连试 2~3 次次次没文字"）：某些来源的图（聊天选图里的 HEIC /
// 无扩展名文件等）`createImage()` 读出的 `image.width/height` 是 **0** —— 旧算式 `min(1, 1440/max(0,0))`
// = 1、`max(1, round(0*1))` = 1 ⇒ 算出 **1×1** 的帧，把一个像素送去 OCR ⇒ 必然"认不出文字" ⇒
// 屏上报 `NO_TEXT`（"图里没文字"），而真相是"**这张图根本没解出来**"。这里把"解出来没有"变成**显式判断**：
// 长边 < `MIN_FRAME_PX`（64）一律判 null（= 不可用），交给调用方走"退回真实尺寸 / 如实报错"。
function frameSize(naturalWidth, naturalHeight, maxEdge) {
  const w = Number(naturalWidth) || 0;
  const h = Number(naturalHeight) || 0;
  if (w <= 0 || h <= 0) return null;
  const limit = Number(maxEdge) || MAX_EDGE;
  const scale = Math.min(1, limit / Math.max(w, h));
  const width = Math.max(1, Math.round(w * scale));
  const height = Math.max(1, Math.round(h * scale));
  if (Math.max(width, height) < MIN_FRAME_PX) return null;
  return { width: width, height: height };
}

// "这帧到底画上东西没有"：按步长采样 alpha 通道，返回**不透明像素占比** ∈ [0,1]（纯函数，零设备可测）。
//
// ⚠️ 为什么需要它（2026-09-26 真机第二读数）：用户那张图报的是 `NO_TEXT` + **送检像素 665×1440**
// （= 帧尺寸完全正常，`frameSize` 这条闸没拦住它）⇒ 尺寸不是问题，那就只剩两种可能：
// **① 这一帧其实是空白**（`drawImage` 没画上：解码器不认识这种相册格式 / 上下文静默失败）—— 空白图必然认不出字；
// **② 帧里有像素，是引擎对这张图不吐 anchor**。两者的修法完全不同，所以必须**量出来**而不是猜。
// ⚠️ 后者在 2026-09-26 的**第三读数**里被证实（覆盖 100% 却零 anchor）⇒ 判据从"只看 alpha"扩成
// `frameStats` 的**两个**读数（alpha 抓"没画上"、明暗跨度抓"画成了纯色"），见下。

// ── 送检形态阶梯（2026-09-26 用户读数「明暗跨度 255」之后新增）─────────────────────────────
// 真机结论：`不透明 100%、明暗跨度 255` ⇒ **帧完全正常**（有暗有亮、是真截图），而引擎**一个 anchor 都不吐**
// ⇒ 交付层（尺寸/健康度/buffer 精确切分）已经全部干净，只剩"**引擎对这张图的像素不吐字**"这一条。
// 用户原问「更改 ocr 模型能够修复吗？」—— 换模型要破两条既有裁决（`STACK` 无后端无云 + `W7` 云端 OCR 已否），
// 而**同一引擎、换送检形态**是端侧、零依赖、不破任何裁决里唯一还能动的杠杆：把整帧**纵向切成 N 段**各自送检，
// 每段独立按长边 1440 缩放 ⇒ 同一批文字在帧里变大 ~N 倍（若引擎的失效原因是"字太小/太密"，这一段就能救）。
// ⚠️ 代价如实记：① 多跑 N 次 OCR（每次最多 `MAX_WAIT_MS`）；② **正好压在切线上的一行文字**会被两侧各切一半
// （可能读不出）—— 兜底是"段数固定 2、失败时原文照旧展开给人抄"，⛔ 不为了这条去动切段算法。

/** 把整帧纵向切 `count` 段（**纯函数**）：返回 `[{from,to},…]`，值是**比例**（0~1），首尾相接无缝隙 */
function splitRanges(count) {
  const n = Math.max(1, Math.round(Number(count) || 1));
  const out = [];
  for (let i = 0; i < n; i++) out.push({ from: i / n, to: (i + 1) / n });
  return out;
}

/**
 * 多段 OCR 结果的合并（**纯函数**）
 * - `ok`：**任一段成功**即成功（一段空白不代表整张没字）
 * - `texts`：按**段的先后顺序**拼接（= 阅读顺序：上段在前）
 * - `partial`：任一段标了"可能没读完"就带出来（不隐瞒）
 * - **全失败** ⇒ 原样返回**第一个**失败（reason/detail 保持不变 ⇒ 屏上那句话稳定、可复现）
 */
function mergeOcrResults(results) {
  const list = Array.isArray(results) ? results : [];
  const okList = list.filter((one) => one && one.ok === true);
  if (okList.length === 0) return list[0] || fail('NO_TEXT', '没识别出文字');
  const texts = [];
  for (const one of okList) {
    const lines = Array.isArray(one.texts) ? one.texts : [];
    for (const line of lines) texts.push(line);
  }
  return { ok: true, texts: texts, partial: okList.some((one) => one.partial === true) };
}

// 送检形态的段数（切 2 段：文字变大约 1.8×，代价是 2 次会话；⛔ 不要再往上加 —— 时间与"切线切字"的风险同涨）
const SPLIT_SEGMENTS = 2;

// 空白判定阈值：覆盖率 < 2% 就当"没画上"（真机正常截图恒接近 100%；这里留 2% 的余量给抗锯齿边缘）
const BLANK_COVERAGE = 0.02;
// 明暗跨度下限（0~255）：**纯色帧**（"画失败了但画布是不透明白/黑"）的跨度 ≈ 0，而任何一张真截图恒远超它。
// ⚠️ 为什么需要这条（2026-09-26 真机**第三读数**：`NO_TEXT` + 送检像素 665×1440 + **画面覆盖 100%**）：
// 覆盖率只看 alpha ⇒ **一张纯黑/纯白的帧照样 100%** —— 所以"覆盖 100%"并不能证明"这帧画对了"。
// 用户那条读数把"透明假帧"排除掉之后，剩下的正是"纯色假帧"或"引擎不吐 anchor"，跨度把这两者分开。
const MIN_LUMA_SPREAD = 24;

// 一帧的**健康读数**（纯函数）：不透明占比 + 明暗跨度（0~255）。
// 两者一起才说明"画上了、而且画的是内容"：alpha 抓"没画上"，跨度抓"画成了纯色"。
function frameStats(rgba, step) {
  if (!rgba || typeof rgba.length !== 'number' || rgba.length < 4) return { coverage: 0, spread: 0 };
  const stride = Math.max(1, Math.round(Number(step) || 1));
  let total = 0;
  let painted = 0;
  let min = 255;
  let max = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4 * stride) {
    total += 1;
    if (rgba[i + 3] > 8) painted += 1;
    const luma = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000;
    if (luma < min) min = luma;
    if (luma > max) max = luma;
  }
  if (total === 0) return { coverage: 0, spread: 0 };
  return { coverage: painted / total, spread: Math.round(max - min) };
}

// 这帧**能不能送 OCR**（纯函数）：不透明够 + 明暗跨度够。⛔ 纯色帧与透明帧一律不送 ——
// 送进去只会得到一个"图里没文字"的假结论（真实原因在"我们没把图解码对"）。
function frameIsUsable(stats) {
  const one = stats || {};
  return Number(one.coverage) >= BLANK_COVERAGE && Number(one.spread) >= MIN_LUMA_SPREAD;
}

// 交给 VisionKit 的 ArrayBuffer 必须**恰好**是这块像素：`getImageData().data` 是 TypedArray **视图**，
// 它的 `byteOffset` 在真机上**未必是 0**（canvas 实现可能从池里给一段偏移的内存）⇒ 直接传 `data.buffer`
// 会把**整段池内存**（含前后别的数据）当成图像 ⇒ 引擎认不出任何文字、而屏上只会说"图里没文字"。
// 这条与"覆盖 100%"的读数完全吻合（读的是我们自己的 `data`，送的是另一段内存），2026-09-26 起一律切精确区间。
function frameBufferOf(data) {
  if (!data || typeof data.byteLength !== 'number') return null;
  const offset = Number(data.byteOffset) || 0;
  return data.buffer.slice(offset, offset + data.byteLength);
}

// 备用取图路的**条数**与**选用决议**（纯函数，零设备可测）：这一帧不健康时，下一步该走哪条路？
//   0 = 没有可走的路（如实报错）；1 = `wx.compressImage` 重压成标准 JPEG 再画；2 = 读成 base64 data URL 再画。
// 为什么要有这几条（2026-09-26 真机**第三读数**：客户转发来的截图"尺寸对、覆盖 100%、引擎一个 anchor 都不吐"，
// 而同一台机上自己的截图全正常 ⇒ 嫌疑 = **这种文件我们的画布解不出正确像素**）：
// 换一条解码路（重压 / data URL）是唯一能在**端内**自救的做法。
// ⚠️ 为什么把"选哪条"抽成纯函数：它原来内联在 `paint` 里（依赖 wx/canvas ⇒ 零设备测不到），
// 第一版接线钉只查字符串 ⇒ 变异"把整段关掉"**判绿**（判据没牙，TD-029 同族）。抽出来后由 §23④ 行为级钉住。
const FRAME_ROUTES = 2;
function nextRouteStep(route, stats, caps) {
  if (frameIsUsable(stats)) return 0;
  const used = Number(route) || 0;
  const can = caps || {};
  if (used < 1 && can.compressImage === true) return 1;
  if (used < 2 && can.fileSystem === true) return 2;
  return 0;
}

// 把图片画进 2d canvas 再取 RGBA 像素——runOCR 要的就是这种 frameBuffer
// @param {object} [band] 只画**纵向一条带**（比例 `{from,to}`，见 `splitRanges`）；缺省 = 整张。
//   `band.skipHealth` = 送检形态阶梯里的分段：**不适用健康度闸** —— 那一段本来就可能是大片留白
//   （"纯色"在整帧上意味着"没画对"，在**一条带**上只意味着"这段没字"）⇒ 拒掉它等于白丢半张的字。
function buildCanvasFrame(page, wxApi, filePath, band) {
  const api = wxApi || (typeof wx !== 'undefined' ? wx : null);
  const slice = band || {};
  const from = Math.min(0.99, Math.max(0, Number(slice.from) || 0));
  const to = Math.min(1, Math.max(from + 0.01, Number(slice.to) || 1));
  const skipHealth = slice.skipHealth === true;
  return new Promise((resolve, reject) => {
    if (!api || !page || typeof api.createSelectorQuery !== 'function') {
      reject({ reason: 'IMAGE_DECODE_FAILED', message: '取不到 canvas（缺少页面上下文）' });
      return;
    }
    api.createSelectorQuery().in(page).select('#ocr-canvas').fields({ node: true, size: true }).exec((res) => {
      const canvas = res && res[0] && res[0].node;
      if (!canvas) {
        reject({ reason: 'IMAGE_DECODE_FAILED', message: '取不到 canvas 节点（检查 canvas type="2d" 与 id="ocr-canvas"）' });
        return;
      }
      const image = canvas.createImage();
      let route = 0;   // 已用过的备用取图路（0 = 还没用过；见 `nextRouteStep`）
      const badFrameFail = (stats) => reject({
        reason: 'IMAGE_DECODE_FAILED',
        message: '图片没解成可用画面（不透明 ' + Math.round(stats.coverage * 100) + '%、明暗跨度 ' + stats.spread
          + '；可能是不支持的相册格式）'
      });
      // 走备用取图路：把"另一条解码出来的路径"赋给 `image.src`，重新 onload 就会重新 paint。
      // ⛔ 这里只做**平台调用**（不判路），"该不该走、走哪条"全在纯函数 `nextRouteStep` 里。
      const useRoute = (step, stats) => {
        if (step === 1) {
          api.compressImage({
            src: filePath,
            quality: 80,
            success: (out) => {
              const next = out && out.tempFilePath;
              if (!next) { badFrameFail(stats); return; }
              image.src = next;
            },
            fail: () => badFrameFail(stats)
          });
          return;
        }
        const manager = api.getFileSystemManager();
        manager.readFile({
          filePath: filePath,
          encoding: 'base64',
          success: (res) => {
            const base64 = res && res.data;
            if (!base64) { badFrameFail(stats); return; }
            image.src = 'data:image/jpeg;base64,' + base64;
          },
          fail: () => badFrameFail(stats)
        });
      };
      // 画出真实像素的帧（尺寸由 `frameSize` 算、健康度由 `frameStats`/`frameIsUsable` 判、交给引擎的
      // ArrayBuffer 由 `frameBufferOf` **切精确区间**）
      const paint = (naturalWidth, naturalHeight) => {
        const fullW = Math.max(1, Math.round(naturalWidth));
        const fullH = Math.max(1, Math.round(naturalHeight));
        // 只画这一条带：源矩形 = 全宽 × [from,to] 那一段高度（整张时 from=0/to=1，与旧行为逐字节等价）
        const srcY = Math.floor(fullH * from);
        const srcH = Math.max(1, Math.min(fullH - srcY, Math.round(fullH * (to - from))));
        const size = frameSize(fullW, srcH, MAX_EDGE);
        if (!size) {
          reject({
            reason: 'IMAGE_DECODE_FAILED',
            message: '图片像素尺寸读不出来（读到 ' + naturalWidth + '×' + naturalHeight + '）'
          });
          return;
        }
        try {
          canvas.width = size.width;
          canvas.height = size.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(image, 0, srcY, fullW, srcH, 0, 0, size.width, size.height);
          const data = ctx.getImageData(0, 0, size.width, size.height).data;
          const stats = frameStats(data, Math.max(1, Math.round((size.width * size.height) / 2000)));
          if (!skipHealth && !frameIsUsable(stats)) {
            // 不健康的帧（透明 = 没画上 / 纯色 = 画成了空画面）⇒ 依次换**别的解码路**（重压 / data URL）再画一次；
            // 都走完仍不健康就如实报错。⛔ 绝不把这种帧送去 OCR —— 那只会得到一个"图里没文字"的假结论。
            const step = nextRouteStep(route, stats, {
              compressImage: typeof api.compressImage === 'function',
              fileSystem: typeof api.getFileSystemManager === 'function'
            });
            if (step > 0) {
              route = step;
              useRoute(step, stats);
              return;
            }
            badFrameFail(stats);
            return;
          }
          resolve({
            frameBuffer: frameBufferOf(data),
            width: size.width,
            height: size.height,
            coverage: stats.coverage,
            spread: stats.spread
          });
        } catch (err) {
          reject({ reason: 'IMAGE_DECODE_FAILED', message: 'getImageData 失败：' + ((err && err.message) || err) });
        }
      };
      image.onload = () => {
        // ⚠️ 2026-09-26 真机缺陷：某些来源的图（聊天选图里的 HEIC / 无扩展名文件等）`createImage()` 的
        // `image.width/height` 会是 **0** —— 旧算式此时算出 `1×1` 的帧（`min(1, 1440/0)=1`、`max(1,0)=1`），
        // 把**一个像素**送进 OCR ⇒ VisionKit 必然"认不出文字" ⇒ 屏上报 `NO_TEXT`（"图里没文字"），
        // 而真相是"**这张图我们根本没解出来**"。用户实测：同一张图连试 2~3 次**次次如此**（= 与偶发无关）。
        // 处置：① 先退回 `wx.getImageInfo` 取真实像素尺寸再画；② 仍拿不到 ⇒ 如实报 `IMAGE_DECODE_FAILED`
        // （屏上换一句能指向根因的话），⛔ 再也不用 1×1 的帧去冒充"认过了"。
        if (frameSize(image.width, image.height, MAX_EDGE)) { paint(image.width, image.height); return; }
        if (typeof api.getImageInfo !== 'function') { paint(image.width, image.height); return; }
        api.getImageInfo({
          src: filePath,
          success: (info) => paint(info && info.width, info && info.height),
          fail: (err) => reject({
            reason: 'IMAGE_DECODE_FAILED',
            message: '图片解码失败（' + (((err && err.errMsg) || 'createImage 报了 0×0，getImageInfo 也失败')) + '）'
          })
        });
      };
      image.onerror = () => reject({ reason: 'IMAGE_DECODE_FAILED', message: '图片解码失败' });
      image.src = filePath;
    });
  });
}

// 串行队列：VKSession 页面单例 + 生命周期间互斥 → 并发调用必然互相踩，宁可排队（也不并发）
let queue = Promise.resolve();

/**
 * 识别一张图（真实入口；页面只调这个）
 * @param {{filePath:string, page?:object, wxApi?:object}} options page 用于定位 canvas 节点
 * @returns {Promise<{ok:boolean, texts?:string[], reason?:string, message?:string}>}
 *   reason ∈ VK_UNSUPPORTED | VK_INIT_FAILED | IMAGE_DECODE_FAILED | NO_TEXT | PRIVACY_DENIED
 *   失败时 `detail` 带原文/errno，供页面附在 reasonText 之后（**不含识别原文**，D3 安全）
 */
function recognizeImage(options) {
  const page = options && options.page;
  const wxApi = options && options.wxApi;
  // 一次送检（`band` 缺省 = 整帧；给了 = 只送这一条带，见 `splitRanges`）
  const runOnce = (band) => {
    const createSession = createWxOcr(wxApi);
    if (!createSession) {
      return Promise.resolve(fail('VK_UNSUPPORTED', '当前微信/机型不支持端侧识别'));
    }
    return runVisionOcr({
      filePath: options.filePath,
      createSession: createSession,
      buildFrame: (filePath) => buildCanvasFrame(page, wxApi, filePath, band)
    });
  };
  const run = () => runOnce(null).then((first) => {
    // ⚠️ 2026-09-26 真机读数：`NO_TEXT` + 不透明 100% + 明暗跨度 255 ⇒ 帧完全正常而引擎零 anchor
    // ⇒ 此时**换送检形态**（纵向切 2 段，文字在帧里大 ~1.8×）再试一轮；两段都失败就**原样返回第一次的失败**
    // （reason/detail 不变 ⇒ 屏上那句话可复现）。⛔ 只对 `NO_TEXT` 这么做 —— 解码类失败换形态没意义。
    if (!first || first.ok === true || first.reason !== 'NO_TEXT') return first;
    const bands = splitRanges(SPLIT_SEGMENTS).map((one) => ({ from: one.from, to: one.to, skipHealth: true }));
    let chain = Promise.resolve([]);
    for (const band of bands) {
      chain = chain.then((acc) => runOnce(band).then((one) => acc.concat([one])));
    }
    return chain.then((parts) => {
      const merged = mergeOcrResults(parts);
      return (merged && merged.ok === true) ? merged : first;
    });
  });
  const result = queue.then(run, run); // 上一次无论成败，下一次照常跑
  queue = result.then(() => undefined, () => undefined); // 队列自身永不因失败而断
  return result;
}

// 只导出真实对外面：classifyStartErrno/MAX_EDGE 属内部实现，导出而未消费会被下一个人当活接口（R-06）。
// ⚠️ `frameSize` / `frameStats` / `frameIsUsable` / `frameBufferOf` / `nextRouteStep` 是 2026-09-26 破例加的
// 一组导出：它们都是**纯函数**，而"1×1 假帧 / 空白帧 / 纯色帧 / ArrayBuffer 视图偏移"这几条缺陷
// （各自注释里有真机读数）**只有零设备才测得出** —— 由 `tools/selftest-wave7.js §22/§23` 消费。
module.exports = {
  recognizeImage, runVisionOcr, frameSize, frameStats, frameIsUsable, frameBufferOf, nextRouteStep,
  splitRanges, mergeOcrResults
};
