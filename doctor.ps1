# doctor.ps1 · 环境自检
# 每项输出版本号 = 通过。哪项报"未检测到"就先装那一项。
# 11-选型初始化卡会把下方 REQUIRED 替换为本项目真正需要的工具清单。
$TOOLS    = @('git', 'node', 'python', 'pip', 'docker')   # 探测池
$REQUIRED = @('node', 'git')                               # 本项目必需：node 跑 tools/check.js；git 做锚点

$miss = 0
foreach ($t in $TOOLS) {
    $v = cmd /c "$t --version 2>nul"
    if ($v) {
        Write-Host "[OK] $t : $($v | Select-Object -First 1)" -ForegroundColor Green
    }
    elseif ($REQUIRED -contains $t) {
        Write-Host "[FAIL] 缺少必需工具：$t —— 请先安装（本项目的检查/启动依赖它）" -ForegroundColor Red
        $miss++
    }
    else {
        Write-Host "[--] 未检测到 $t（本项目可能用不到，可忽略）" -ForegroundColor DarkGray
    }
}

# 微信开发者工具是 GUI，不在探测池里；本项目跑界面必须装它（人工确认，见 docs/RUNBOOK.md §1）
Write-Host "[--] 微信开发者工具：GUI，需人工确认已安装（doctor 不覆盖）" -ForegroundColor DarkGray

if ($miss -gt 0) {
    Write-Host "环境自检未通过：缺 $miss 项必需工具。" -ForegroundColor Red
    exit 1
}
Write-Host "环境自检通过（必需项齐全；未列出的工具按需安装）。" -ForegroundColor Green
exit 0
