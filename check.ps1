# check.ps1 · 收工仪式（guardrail）· expresseage_college_v2
# "完成"的唯一合法定义 = 本脚本退出码 0 + 真实输出粘贴。
# 本项目的 STEPS（v2 骨架阶段）：
#   ① node tools/check.js —— 零依赖机械门禁（JSON 可解析/JS 语法/主包+分包页面三件套齐/骨架文件在位/
#      密钥卫生/分层不越界(存储只在 utils/)/PS 脚本 BOM/WXML↔WXSS class 对帐/全局 window 不得设
#      navigationStyle/app.json 顶层键拼错（含相邻转置））
#      ⛔ 2026-09-25 用户裁决删掉两条候选判据：chatTools↔subPackages↔分包页形态对帐（原 P-A）与
#         "没有悬挂的 if"（原 P-B）⇒ **这两处现在没有机器闸**，见 docs/TECH_DEBT.md TD-014
# ⚠️ 尚未接回的三条判据（登记在 docs/TECH_DEBT.md TD-003，禁止当成已存在）：
#      reason 码对帐 audit-codes / 迁移审计 audit-migrate（v2 初版库暂无迁移对象）/ 锚点门禁 gate.ps1
#      —— 本批用 git diff 手工读数替代锚点门禁，见 STATE 未决 2。
# 为什么不是 lint+test：原生小程序零依赖，装 eslint/jest 会让"新机器直接 check"跑不动。
#
# ⚠️ 本文件必须存为「UTF-8 带 BOM」：PS 5.1 读无 BOM 的 UTF-8 脚本会按 GBK 解析，中文串被撕开 = 直接解析失败。
#    tools/check.js 第 7 条会机械拦下丢 BOM 的情况（教训卡：docs/lessons/2026-09-11_UTF-16LE编码破坏.md）。
$STEPS = @('node tools/check.js', 'node tools/selftest.js')

if ($STEPS.Count -eq 0) {
    Write-Host "[未配置] check 步骤为空。" -ForegroundColor Yellow
    Write-Host "请在脚本顶部 STEPS 数组填入本项目的检查命令。"
    exit 2
}

$fail = 0
foreach ($s in $STEPS) {
    Write-Host "== $s =="
    cmd /c "$s 2>&1"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[FAIL] $s (exit $LASTEXITCODE)" -ForegroundColor Red
        $fail++
    } else {
        Write-Host "[OK] $s" -ForegroundColor Green
    }
}

if ($fail -gt 0) {
    Write-Host "收工仪式未通过：$fail 步失败。禁止宣布完成。" -ForegroundColor Red
    exit 1
}
Write-Host "全部通过（退出码 0）：完成声明成立。" -ForegroundColor Green
exit 0
