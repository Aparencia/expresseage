# doctor.ps1 · v4 环境自检（ENGINEERING §8.5 / AGENTS §6）
# 用法：powershell -File doctor.ps1
# 检查：node 版本、git 身份、必需骨架文件、云函数目录、config/env.js 占位状态、ps1 BOM 两向纪律。
# 退出码：0 无失败（允许告警）/ 1 有失败。
# 编码：本文件必须 UTF-8 BOM（门禁 #7）。

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSCommandPath
Set-Location $root

$fail = 0
$warn = 0
$pass = 0
$report = @()
function Add-Result {
  param([string]$Level, [string]$Text)
  $script:report += ("[{0}] {1}" -f $Level, $Text)
  if ($Level -eq 'FAIL') { $script:fail = $script:fail + 1 }
  if ($Level -eq 'WARN') { $script:warn = $script:warn + 1 }
  if ($Level -eq 'PASS') { $script:pass = $script:pass + 1 }
}

# 1. node 可执行 + 版本
$nodeVer = 'unknown'
try { $nodeVer = (& node --version) } catch { }
if ($LASTEXITCODE -ne 0 -or -not $nodeVer) {
  Add-Result 'FAIL' 'node 不可执行（PATH 或安装问题）'
} else {
  Add-Result 'PASS' ("node {0}" -f $nodeVer)
}
# .tool-versions 期望（只告警，不阻塞）
if (Test-Path -LiteralPath '.tool-versions') {
  $expected = (Get-Content -LiteralPath '.tool-versions' -Encoding UTF8) -join '; '
  $m = [regex]::Match($nodeVer, 'v(\d+)')
  if ($m.Success) {
    Add-Result 'PASS' ("node 主版本 {0}；.tool-versions = {1}" -f $m.Groups[1].Value, $expected)
  } else {
    Add-Result 'WARN' ".tool-versions 存在但无法解析 node 版本：$expected"
  }
} else {
  Add-Result 'WARN' '.tool-versions 缺失（Lead 域）'
}

# 2. git 身份（显式配置）
$ident = & git var GIT_AUTHOR_IDENT 2>&1
if ($LASTEXITCODE -ne 0) {
  Add-Result 'FAIL' 'git 身份未配置（git var GIT_AUTHOR_IDENT 失败）'
} else {
  Add-Result 'PASS' ('git 身份：' + (($ident -join ' ').Trim()))
}

# 3. 必需骨架文件
$required = @('app.json', 'app.js', 'app.wxss', 'project.config.json', 'sitemap.json', 'README.md', 'AGENTS.md',
  'STATE.md', 'CHANGELOG.md', 'check.ps1', 'gate.ps1', 'doctor.ps1', '.gitignore', '.tool-versions', '.env.example')
$missing = @()
foreach ($f in $required) { if (-not (Test-Path -LiteralPath $f)) { $missing += $f } }
if ($missing.Count -gt 0) {
  Add-Result 'FAIL' ("必需文件缺失：{0}" -f ($missing -join '、'))
} else {
  Add-Result 'PASS' ("必需骨架文件 {0} 件齐全" -f $required.Count)
}

# 4. 云函数目录
$cloudDirs = @('cloudfunctions/api', 'cloudfunctions/cleanup')
$missingCloud = @()
foreach ($d in $cloudDirs) { if (-not (Test-Path -LiteralPath $d)) { $missingCloud += $d } }
if ($missingCloud.Count -gt 0) {
  Add-Result 'WARN' ("云函数目录待建：{0}" -f ($missingCloud -join '、'))
} else {
  Add-Result 'PASS' 'cloudfunctions/api、cloudfunctions/cleanup 均在'
}

# 5. config/env.js 占位状态（占位 = 待用户回填，告警不失败）
if (Test-Path -LiteralPath 'config/env.js') {
  $envText = Get-Content -LiteralPath 'config/env.js' -Raw -Encoding UTF8
  if ($envText -match '__DEV_ENV_ID__' -or $envText -match '__PROD_ENV_ID__') {
    Add-Result 'WARN' 'config/env.js 的 envId 仍为占位符（需用户在云控制台创建环境后回填）'
  } else {
    Add-Result 'PASS' 'config/env.js 已配置 envId（非占位）'
  }
} else {
  Add-Result 'FAIL' 'config/env.js 缺失'
}

# 6. ps1 BOM 两向纪律
foreach ($f in @('check.ps1', 'gate.ps1', 'doctor.ps1')) {
  if (-not (Test-Path -LiteralPath $f)) { Add-Result 'FAIL' ("{0} 缺失" -f $f); continue }
  $bytes = [System.IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $f).Path)
  $isBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
  if ($isBom) { Add-Result 'PASS' ("{0} 带 UTF-8 BOM" -f $f) } else { Add-Result 'FAIL' ("{0} 缺 UTF-8 BOM" -f $f) }
}

# 7. 工具链脚本存在性
foreach ($f in @('tools/check.js', 'tools/check-docs.js', 'tools/zero-money-scan.js', 'tools/selftest.js',
  'tools/fake-db.js', 'tools/sync-cloud-shared.js', 'tools/seed-dev.js')) {
  if (Test-Path -LiteralPath $f) { Add-Result 'PASS' ("工具存在：{0}" -f $f) } else { Add-Result 'FAIL' ("工具缺失：{0}" -f $f) }
}

Write-Host ''
Write-Host '------------------------------------------------------------'
foreach ($line in $report) { Write-Host $line }
Write-Host '------------------------------------------------------------'
Write-Host ("doctor.ps1：通过 {0} 项；告警 {1} 项；失败 {2} 项" -f $pass, $warn, $fail)
if ($fail -gt 0) { exit 1 }
exit 0
