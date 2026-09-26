# CODE_20260923_chat_pick · 卡 24 代码审查报告（r1）

> 审查日 2026-09-23｜档位 L｜起点锚点 `b2a8a066f3607d80775af750b0d192d514ddb1d5`（`git log --oneline b2a8a06 -1` 实测存在）
> diff = `b2a8a06..HEAD` **6,386 行 / 40 文件**
> **独立性**：本卡由三名**未参与编码**的新鲜上下文审查者分阶段执行（阶段 1 数据层 3,484 行 / 阶段 2 页面 1,856 行 / 阶段 3 测试·配置·文档 972 行），主 agent 只做装配与去重，不改代码。
> **旧报告**：`docs/reviews/` 此前不存在 ⇒ 无历史 P0/P1 需核销。
> 人审替代车道不开放（L 档、5,990 行，远超"≤150 行"条件）。

## 1. 覆盖地图（✓ 已审 / — N/A+原因 / ○ 未审+原因）

| 文件域 | 1 装配 | 2 逻辑 | 3 牵连 | 4 性能 | 5 冗余 | 6 规范 | 7 安全 | ⑧ 可访问 | ⑨ 外部调用 | ⑩ 预算 | ⑪ 隐私 |
| :-- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `utils/migrate·reason`（新写） | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | —无 UI | —零网络 | ○无预算基线 | ✓ |
| `utils/storage·aggregate`（改） | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | ○ | ✓ |
| 7 个逐字节搬运件 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓（ocr 超时/降级） | ○ | ✓ |
| `app.js` / `app.json` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | ✓ | — | — | ✓ |
| `pages/pickup-list·archive-list·recognize` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓（D3 全查） | ✓ | — | ○ | ✓ |
| `pages/index/*`（删除） | ✓ | — | ✓零残留 | — | — | — | — | — | — | — | — |
| `tools/selftest·check` / `check.ps1` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | ○ | ✓ |
| registry 三份 / DESIGN / TECH_DEBT / CHANGELOG / STATE | ✓ | — | ✓ | — | — | ✓ | — | — | — | — | — |
| **波 5 未实现件**（`chatpick/`、`utils/chat-tool.js`、`subPackages`/`chatTools`） | ○ **不在本次 diff**（挡在 U-1/U-5/U-6 取证后，STATE/CHANGELOG 已显式登记） | | | | | | | | | | |

阶段声明：三阶段均有 diff 覆盖，无跳过。⑨ 对"新第三方依赖"为 N/A（本批 diff 零依赖变更、无 lockfile）。⑩ 项目无预算文件 ⇒ 按维度 4 定性并标"无预算基线"。

## 2. 问题清单（P0→P3；括号为来源审查者编号）

### P1
| # | 级别 | 位置 | 描述 | 影响（触发条件） | 修复建议 |
| :-- | :-: | :-- | :-- | :-- | :-- |
| **R-01** | P1 | `utils/migrate.js:21,212` × `utils/parcel-drafts.js:96-105` × `pages/recognize/index.js:105,305,428-443` | **一图多码时任一件判不出取件点 ⇒ 整批存不进去**。`saveableDrafts` 只按 `pickupCode` 过滤、`stationName` 允许空串（注释明写"绝不猜点"），但 `migrate` 把 `stationName` 列进 `PARCEL_REQUIRED` 且 `isNonEmptyString` 拒空；`addParcels` 是"先全量预校验再一次整键写" ⇒ 一行空站 = 全批 `VALIDATION_FAILED:PARCEL_INVALID:stationName` | 触发条件真实且**页面主动提供**：`rowStationPoints` 第一项就是「（留空：到点问客户）」，OCR 判不出取件点也会留空。M8"一键全存"失效，且提示不指明是第几件 | 两种口径需你选（见 §4 待裁决）：① 保存前按行拦空并指名"第 N 件没选点"（改页面，不动搬运件）；② 把 `stationName` 移出 `PARCEL_REQUIRED` 允许空串（改数据层语义，牵动清单分组与 `STATION_MAP`） |
> **主 agent 独立复核**：确认此洞**继承自 v1 而非本批引入**——v1/v2 的 `saveableDrafts` 逐字节相同、`addParcels` 除行号外内容一致且无兜底。v1 的「一图多码」真机验收过了，但从未碰到"某件判不出站点"的图，v1 的 228 条自测也没覆盖这条路径。

### P2（14 条，全部须登记 `docs/TECH_DEBT.md`，来源=本报告编号）
| # | 位置 | 描述 / 影响 / 建议 |
| :-- | :-- | :-- |
| R-02 (S2-02) | `pages/archive-list/index.js:119-152` | 三格手改后直送 `createCustomer`，未再过 `parseRoomLine`；`migrate` 只卡长度 ⇒ 可建出 `E99`/`D11`/宿舍号<100 的档案，破 M4/V4。**这正是 TD-005 请本卡复核的旁路，已证实存在**。建议 `onSheetSave` 内对 `building+dorm` 复跑 `splitCustomerLine` |
| R-03 (S2-03) | `pages/recognize/index.js:384,452-457` | `finishSaved` 立即置 `saving:false`，800ms toast 窗口内保存键仍可点 ⇒ 二次点击写两条；本期无删除入口（W1）⇒ 只能改库。建议窗口内保持 `saving` |
| R-04 (S2-04) | `pages/recognize/index.js:65-79,248` | `runRecognize` 无条件 `freshForm()` 清空人已手填的站点/码，与 M6"手输能存"意图相冲。建议有手填值时先确认 |
| R-05 (S2-05) | `pages/recognize/index.js:218,261,421,437`、`archive-list:155` | `reasonText(reason)+'（'+detail+'）'` 把 `PARCEL_INVALID:stationName` 这类**内部码原样上屏**（违 `reason.js` 纪律）。建议 `reasonText(detail||reason)` |
| R-06 (S1-01) | `utils/customer-input.js:43,76` | `ZONE_ADDRESS_SHAPE` 要求数字后紧跟分隔符/量词 ⇒ `E4 522`/`Z4 522`/`D11 522`/`D4 99` 全部绕过值域闸、静默落库。触发：浮层用空格代横杠。建议登记债、放宽为"字母+1~2 位数字即可疑"（**不顺手改搬运件**） |
| R-07 (S1-02) | `docs/registry/APIS.md:53` vs `utils/aggregate.js:84,178,232` | 文档写"未加三级排序"，实码有 `pickupTier`/`comparePickupItems` + 已取件/已归档分区 ⇒ DESIGN §5"搬+删"**未执行**。需裁决：按实码订正文档，还是补删（删它反违反 W2） |
| R-08 (S1-03) | `utils/migrate.js:121,46,32`、`storage.js:143,196,328` 等 | 登记面＞消费面：12 个 storage + 10 个 aggregate + `stations.listStationOptions/findSimilar` 生产零调用；`APIS.md:22` 称 `down` 由"人工回滚脚本"调用，`tools/` 实无此件。建议要么补调用方要么收登记 |
| R-09 (S1-04) | `app.json`（无 `subPackages`/`chatTools`）、`chatpick/` 与 `utils/chat-tool.js` 不存在、`reason.js:44-48` 五码有文案无产生者 | **M2 不可达**。按维度 1 字面应判 P1；因 STATE.md:16 与 CHANGELOG 已显式登记"挡在 U-1/U-5/U-6 真机取证后"、非静默断链 ⇒ 审查者判 P2 并**提请人裁决是否提级 P1** |
| R-10 (S3-01) | `tools/selftest.js:43-47` | **M8 零断言**：全文未调 `storage.addParcels`（grep 0 命中），而 M12 要求覆盖 M8、`APIS.md:37` 承诺"要么全成要么一条都不建"。⇒ R-01 这类半完成态回归抓不到。建议补全成/归属缺失/空数组/写盘失败四组并断言盘字节不变 |
| R-11 (S3-02) | `tools/selftest.js:329-330` | 断言不隔离：前一条失败即 `TypeError` 终止，后 145 条不跑、无计数行（**变异实验 B 实证**）。建议取值先判空或分段 try |
| R-12 (S3-03) | `docs/registry/APIS.md:58-59` | 未随 DESIGN §3.1 回灌：仍写 `ocr.recognize(imagePath,deps)` / `parseParcelTextMulti(text)`，实码是 `recognizeImage(options)` 单参、`parseParcelTextMulti(lines)` 收行数组；同两行"无页面入口"又与"调用方=录入页"自相矛盾（`pages/recognize/index.js:256,277` 在调） |
| R-13 (S3-04) | `utils/reason.js:25`、`selftest.js:271`、`APIS.md §3` | 码闸漏网：`PARCEL_NOT_FOUND` 有文案、被当契约码断言，却**未登记且全仓零产生处**（§3.1 已判实码为 `NOT_FOUND`）；`CONTRACT_CODES` 是手抄表不与实码比对。TD-003 的"audit-codes 在 24 卡前补"**未补** |
| R-14 (S3-05) | `STATE.md:14,35`、`CHANGELOG.md:6`、`AGENTS.md:78` | 回写数字过期：STATE 写"35 文件 / +5,939 / −76"，实测 **40 / +5,990 / −84**（35 是 `689b2fc` 的读数，写下它的 `e321a70` 自己又改了 8 个文件；同句"26 项"却是 e321a70 之后 ⇒ 混基线）。`STATE.md:35` 未决 2 仍称 selftest 未接回，与 `:15` 和 `check.ps1:6` 矛盾。**主 agent 已实测确认** |
| R-15 (S3-06 / S2-10) | `docs/ARCHITECTURE.md:9-12`、`README.md:26`、`STATE.md:24` | 已删页仍被当现状："单页外壳、无 tabBar""屏上只有 `pages/index` 占位卡片"——实为 3 页 + 底栏两格，`pages/index/` 本批已删；ARCHITECTURE §4 模块图仍整片标"规划" |

### P3（21 条，合并去重后；来源编号保留）
| # | 位置 | 描述 / 建议 |
| :-- | :-- | :-- |
| R-16 (S2-06) | `pages/pickup-list/index.wxml:34` | `count===0` 永不为真（`aggregate.js:207-218` 只给 ≥1 项的组建组）⇒ 死分支 |
| R-17 (S2-07) | `pages/archive-list/index.js:18-26` | `300+116×3=648>620` ⇒ `computeSheetScrollHeight` 恒返 620rpx，两参数与"不能写死"的注释全部失效 |
| R-18 (S2-08) | `pages/archive-list/index.js:127,145,153` | 同步写盘下 `saving` 永不为真，`if (this.data.saving) return` 是假防护 |
| R-19 (S2-09 / S3-14) | `pages/recognize/index.js:54-58` | 注释仍称 `pickCustomerByRoom`"还没导出"（`aggregate.js:382` 已导出）；`:58` 的 `typeof` 防御分支自 `ad82ad1` 起恒假 = 死分支 |
| R-20 (S2-11) | `archive-list.wxss:154`、`recognize.wxss:123,142` | 触摸目标 ≈66/77/83rpx < 88rpx 基线（主点击件 `check-box`、`station-head`、`fab`、`sheet-btn`、`quick-add` 均达标） |
| R-21 (S2-12) | `archive-list:82`、`pickup-list:85-86`、`recognize:456` | 每次按键读整库并 validate（无防抖）；折叠重读两库；`setTimeout` 未在 `onUnload` 清理。无预算基线 |
| R-22 (S1-05 / S3-09) | `app.json:19` | 底栏右格文案「客户档案」vs SCOPE M1/V1 要求「用户档案」⇒ **V1 字面不通过**；`COMPONENTS.md:10` 直接登记新词未标偏离。待你裁决改哪边 |
| R-23 (S1-06) | `utils/reason.js:106` | 未登记字段会把内部名吐上屏（实测无 D3 回显，唯此一条） |
| R-24 (S1-07) | `utils/storage.js:143-159` | `updateCustomer` 对未声明键静默忽略：传 `chatRoomId` 返回 `ok:true` 而值未变 ⇒ 将来做 SCOPE C1 补录时会踩 |
| R-25 (S1-08) | `customer-input.js:76`(69 行)、`aggregate.js:178`(58)、`buildings.js:129`(51) | 函数 >50 行未挂账（TD-001 只记文件行数） |
| R-26 (S1-09) | `storage.js:220,410,456,20`、`ocr.js:92` | 查找用 `map().indexOf()` 造全量数组 ⇒ O(N×M)；每写全库深拷贝；`ocr.js:92` 空 catch（仅注释）。均 v1 原样 |
| R-27 (S1-10) | `tools/selftest.js:231-232` | 硬编码 64/65 而不读 `CHAT_ROOM_ID_MAX` ⇒ 双事实源 |
| R-28 (S1-11) | `app.json:11-12` | tabBar `#8a8a8a` on `#ffffff` 对比度 ≈3.4:1 < 4.5:1（⑧） |
| R-29 (S3-07) | `tools/check.js:120-122` | 第 9 条有**假绿通道**：`exists` 为假时不 OK 不 FAIL（条数 26→25 无人判）；`window||{}` 对非对象判绿；**实测小写 `navigationstyle` 判绿 26 项/0 失败（主 agent 已复现）**；`app.json` 非法 JSON 时 `:121` 抛未捕获异常丢掉汇总行。建议：`exists` 失败也 fail、键名不区分大小写、末尾断言预期条数 |
| R-30 (S3-08) | `check.ps1:4` | 注释仍写"机械门禁 8 条"，与同批新增的第 9 条矛盾 |
| R-31 (S3-10) | `DATA_DICT.md:21,34`、`DESIGN.md:34` | 文档写 `id`/`customerId` ≤32 与"版本必须 = 1"，实码无该长度闸、且实现是"数值且 ≤1"（`migrate.js:138`） |
| R-32 (S3-11) | `tools/check.js:121,86` | 重复 read+parse `app.json`（`:46` 已读）；BOM 名单硬编码，新增 `.ps1` 不覆盖 |
| R-33 (S3-12) | `check.ps1:15` | V15"STEPS 至少两条"无机器判据（只拦空数组）。建议加第 10 条解析 STEPS 含 selftest |
| R-34 (S3-13) | `DESIGN.md:68` K5 vs `app.js:14` + `recognize:47-51` | K5 写"id 只活于页面 data"，实现是 `globalData.chatRoomId` ⇒ **第 9 处口径差异**未进 §3.1/TECH_DEBT |
| R-35 (S3-15) | `check.ps1` 收尾 | 中文在 UTF-8 终端输出乱码（`ȫͨ˳ 0…`），削弱"粘贴真实输出"的可读性。建议首行设 `[Console]::OutputEncoding` |

### 观察（不计级）
- **S1-12**：阶段 1 首轮自测曾报 4 条 §4 失败（`E4` 建档成功），重跑 3 次全绿；同期 `buildings.js` 的 mtime 晚于同批文件 ⇒ 判为**并发写入造成的撕裂读**（当时两条车道与主 agent 合并同时在跑），非代码缺陷。但它说明一句实话：**"176 条全绿"必须附实时输出**，隔屏读数不可信（教训卡 `2026-09-11_stale产物读数.md`）。

## 3. 通过项（逐维度 ✅ + 覆盖范围）
1. **接入性与装配** ✅ 三页在 `app.json:2-6` 全登记、`pages[0]=pickup-list`、`tabBar` 两 path 均在 `pages` 内；入口可达已核（清单/档案=tabBar，`recognize` 唯一入口 = `archive-list.wxml:15`「＋ 录快件」→ `:165-168` `navigateTo?customerId=`）；22 个 `bind*` 全部命中 handler 且终止于业务函数（`setParcelPicked`/`createCustomer`/`addParcel(s)`/`navigateTo`），**无孤儿、无断链**。
2. **逻辑性** ✅（除 R-01~04、R-06）空库/读库失败/`notFound`/连点均有分支且非空 catch；`addParcels` 先全量预校验再一次整键写 = 全成或全不建，**无半完成态**；`up` 对初版库幂等、`down` 在版本 1 原样返回不删字段；`validateBody` 先于 `up` 的次序成立。
3. **牵连性** ✅（除 R-12~15）页面 12 处 utils 调用逐一对过实码，签名与返回结构一致；`createCustomer` 增参向后兼容；被删的 `pages/index/` 在代码与 `app.json` 零残留。
4. **性能** ✅ 无 N+1、无无界查询（无 DB）、无请求路径同步长任务；`ocr.js` 定时器在收口处清理，无泄漏。定性判断，**无预算基线**。
5. **冗余死代码** ✅（清单见 R-16~19、R-27、R-32）
6. **开发规范** ✅ 本批**无新增超 500 行文件**（最大 `parse.js` 751 / `storage.js` 568 已挂 TD-001）；`selftest.js` 532 行在测试豁免线内；`recognize/index.js` 462 行 <500；命名与 DESIGN §3.1 订正一致；宪法 §11 六条逐条过（唯 R-25 函数超行、R-19 注释过期）。
7. **安全** ✅ 零网络、零密钥、无 eval/路径拼接、无新增依赖 ⇒ ⑨ 对新第三方依赖 N/A；WXML 自动转义；`check.js` 第 6/9 条判绿（K1 分层、K3 全局导航）。
⑧ **UI 可访问性** ✅（除 R-20、R-28）空态/错误态/加载态/降级态齐全；遮罩与面板为兄弟节点；两处可滚区均为 `<scroll-view>` + 固定高；`overflow:hidden` 只用于省略号。**真机未验，不算已验。**
⑩ **性能预算** ✅ 无预算文件 ⇒ 定性 + 标注。
⑪ **数据隐私** ✅ `ex_college.store` 全仓仅出现在注释与哨兵里，`selftest.js:518-522` 机械钉住"只碰 `ex_college_v2.store` 且访问次数 >20" ⇒ **v1 数据红线证伪为"未触碰"**；`chatRoomId` 不上屏、不进 toast、不进 query、不进 `note`；识别原文只在本页折叠显示、不落盘。
**错误码闸** ✅ 页面消费的 20 个码全部能在 `docs/registry/APIS.md` grep 命中；唯一例外是 R-13（`PARCEL_NOT_FOUND` 有文案无登记无产生者）。
**越界检查** ✅ 无红旗：diff 内无"顺手优化"性改动（搬运件 md5 逐字节一致，`storage`/`aggregate` 改动只落在声明的 3 hunk / 28 行）；W1 无 touch/swipe、W2 页面零 `.sort(`/`localeCompare`、W8 无 `onShare*`、W10 零图片且 tabBar 刻意无 `iconPath`、波 5 无 `subPackages`/`chatTools`/`openChatTool`；无 SCOPE 未讨论的文件。
**诚实性** ✅ 无任何一处把波 5 未做的事写成已完成、把未验的界面写成已验（`APIS.md:61-62` 标"契约先行"、`STATE.md:16`、`CHANGELOG.md:6`、`COMPONENTS.md:31` 一致）；SCOPE 五查⑤ 的「继续」追认已在 `DESIGN.md:5` 与 `STATE.md:22` 留痕。
**变异实验（阶段 3，做完逐字节还原并 `git status` 证明干净）**：A `buildings.js` ZONES 加 `'E'` → 红 4 条；B `storage.js` 去掉 `roomIdValid?` 三元 → 红 1 条后**进程崩溃**（暴露 R-11）；C `aggregate.js` 多命中取第一条 → 红 1 条。三处均还原、复跑 176 全绿。**结论：断言有判别力，但隔离性差（R-11）且 M8 无覆盖（R-10）。**

## 4. 结论
**P0 = 0 ｜ P1 = 1 ｜ P2 = 14 ｜ P3 = 21**（旧报告核销：无）
**建议色：🔴 红**（判据：P1 ≥ 1 ⇒ 必须清零，禁止合入）。唯一 P1 是 R-01，且**继承自 v1、本批的自测没覆盖到它**（R-10 是它的成因）。

### 待你裁决（四条，不裁不回 23）
1. **R-01 修法**：① 页面保存前拦空站点并逐行指名（改页面，延续 v1 的"`stationName` 必填"语义）｜② 把 `stationName` 移出 `PARCEL_REQUIRED` 允许空串（改数据层，等于承认"件可以先没有取件点"，牵动清单分组与 `STATION_MAP`）。**agent 建议 ①**，并连带补 R-10 的 `addParcels` 断言组。
2. **R-09 是否提级 P1**：M2 不可达按维度 1 字面就是 P1；审查者因它**已显式登记在案、非静默断链**而判 P2。提级 ⇒ 修复清单加波 5（但波 5 挡在取证后，等于整批卡住）；不提级 ⇒ 维持"波 5 单独排期"。
3. **R-22 底栏文案**：改 `app.json` 为「用户档案」，还是订正 SCOPE 认「客户档案」。
4. **R-07 文档 vs 实码**：三级排序实码存在但 SCOPE W2 说本期不做 ⇒ 按实码订正文档，还是补删代码（删它反违反 W2"不许顺手改排序"）。

### 建议修复清单（回 23 时）
必修：R-01、R-02、R-03、R-05、R-10、R-11、R-14、R-15｜应修：R-04、R-12、R-13、R-29、R-30、R-34｜登记债：R-06、R-08、R-16~R-28、R-31~R-33、R-35。
**重审范围**（卡 24 ④）：修复 diff 跑全部七个维度 + 本报告 R-01~R-35 逐条核销（已修/未修/新引入），不是只看修复那几行。
