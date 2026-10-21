# gate.ps1 · v4 范围/体量门禁（ENGINEERING §8.4）
# 用法：powershell -File gate.ps1 -Anchor <批前HEAD> -ScopeFiles "pages/,pkg-customer/,shared/" -Estimate 600
# 退出码：0 绿 / 1 红 / 2 黄（仅有告警）
# 六项：①锚点可解析 ②变更集=锚点..HEAD+工作区(-uall, quotepath=false) ③范围前缀匹配
#       ④行数（全文本口径；本批新增越线红、锚点前已超黄）⑤lockfile/package.json 变更黄 ⑥体量 ≤ 预估×1.5
# 纪律（v3 教训）：并行写只走 git worktree；同树并行声明并集；锚点=本批真实前驱（开工自取 HEAD）；零变更=黄不是绿。
# 编码：本文件必须 UTF-8 BOM（门禁 #7）。

param(
  [Parameter(Mandatory = $true)][string]$Anchor,
  [string]$ScopeFiles = '',
  [int]$Estimate = 0
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSCommandPath
Set-Location $root
$CODE_LIMIT = 500
$TEST_LIMIT = 1000

function Run-Git {
  param([string[]]$GitArgs)
  $out = & git @GitArgs 2>&1
  return @{ Code = $LASTEXITCODE; Out = $out }
}

$red = 0
$yellow = 0
$report = @()
function Add-Result {
  param([string]$Level, [string]$Text)
  $script:report += ("[{0}] {1}" -f $Level, $Text)
  if ($Level -eq 'FAIL') { $script:red = $script:red + 1 }
  if ($Level -eq 'WARN') { $script:yellow = $script:yellow + 1 }
}

# ⓪ 前置：git 身份必须显式配置（ENGINEERING §8.5）
$ident = Run-Git @('var', 'GIT_AUTHOR_IDENT')
if ($ident.Code -ne 0) {
  Add-Result 'FAIL' 'git 身份未配置（git var GIT_AUTHOR_IDENT 失败）'
} else {
  Add-Result 'PASS' ('git 身份：' + ($ident.Out -join ' '))
}

# ① 锚点可解析
$rev = Run-Git @('-c', 'core.quotepath=false', 'rev-parse', '--verify', ($Anchor + '^{commit}'))
if ($rev.Code -ne 0) {
  Add-Result 'FAIL' ("锚点不可解析：{0}" -f $Anchor)
  Write-Host ''
  Write-Host '------------------------------------------------------------'
  foreach ($line in $report) { Write-Host $line }
  Write-Host ("gate.ps1：红色 {0} 项；黄色 {1} 项（退出码 1）" -f $red, $yellow)
  exit 1
}
$head = (Run-Git @('rev-parse', '--short', 'HEAD')).Out -join ''
Add-Result 'PASS' ("锚点可解析：{0}（HEAD={1}）" -f $Anchor, $head)

# ② 变更集 = 锚点..HEAD + 工作区（含未跟踪；-uall；quotepath=false）
$changed = New-Object System.Collections.Generic.List[string]
$diff = Run-Git @('-c', 'core.quotepath=false', 'diff', '--name-only', ($Anchor + '..HEAD'))
if ($diff.Code -eq 0) {
  foreach ($line in $diff.Out) {
    $t = ("$line").Trim()
    if ($t -ne '') { $changed.Add($t) }
  }
}
$status = Run-Git @('-c', 'core.quotepath=false', 'status', '--porcelain', '-uall')
if ($status.Code -eq 0) {
  foreach ($line in $status.Out) {
    $t = ("$line").Trim()
    if ($t.Length -lt 4) { continue }
    $path = $t.Substring(3).Trim()
    if ($path.Contains(' -> ')) { $path = $path.Split(' -> ')[-1].Trim() }
    $path = $path.Trim('"')
    if ($path -ne '') { $changed.Add($path) }
  }
}
$changedSet = @{}
foreach ($p in $changed) { $changedSet[$p] = $true }
$changedList = @($changedSet.Keys | Sort-Object)
if ($changedList.Count -eq 0) {
  Add-Result 'WARN' '零变更（零变更=黄不是绿）'
} else {
  Add-Result 'PASS' ("变更集 {0} 件（锚点..HEAD + 工作区）" -f $changedList.Count)
}

# ③ 范围前缀匹配
$prefixes = @()
if ($ScopeFiles -ne '') {
  foreach ($p in $ScopeFiles.Split(',')) {
    $v = $p.Trim()
    if ($v -ne '') {
      $v = $v.TrimEnd('/')
      $prefixes += ($v + '/')
    }
  }
}
if ($prefixes.Count -eq 0) {
  Add-Result 'WARN' '未传 -ScopeFiles（范围检查跳过）'
} else {
  $outOfScope = @()
  foreach ($f in $changedList) {
    $ok = $false
    foreach ($prefix in $prefixes) {
      if ($f.StartsWith($prefix) -or $f -eq $prefix.TrimEnd('/')) { $ok = $true; break }
    }
    if (-not $ok) { $outOfScope += $f }
  }
  if ($outOfScope.Count -gt 0) {
    Add-Result 'FAIL' ("越界文件 {0} 件：{1}" -f $outOfScope.Count, (($outOfScope | Select-Object -First 8) -join ', '))
  } else {
    Add-Result 'PASS' ("范围前缀匹配（{0} 个前缀，{1} 件变更）" -f $prefixes.Count, $changedList.Count)
  }
}

# ④ 行数（全文本口径；本批新超线红、锚点前已超线黄）
foreach ($f in $changedList) {
  if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { continue }
  if (-not ($f.EndsWith('.js') -or $f.EndsWith('.wxml') -or $f.EndsWith('.wxss') -or $f.EndsWith('.json'))) { continue }
  $isTest = $f -match '(^|/)tools/selftest'
  $limit = $CODE_LIMIT
  if ($isTest) { $limit = $TEST_LIMIT }
  $lines = 0
  try { $lines = (Get-Content -LiteralPath $f -ErrorAction Stop | Measure-Object -Line).Lines } catch { continue }
  if ($lines -le $limit) { continue }
  $existed = Run-Git @('cat-file', '-e', ($Anchor + ':' + $f))
  $before = 0
  if ($existed.Code -eq 0) {
    $old = Run-Git @('show', ($Anchor + ':' + $f))
    if ($old.Code -eq 0) { $before = @($old.Out).Count }
  }
  if ($before -gt $limit) {
    Add-Result 'WARN' ("{0}：{1} 行 > {2}（锚点前已超线 {3} 行）" -f $f, $lines, $limit, $before)
  } else {
    Add-Result 'FAIL' ("{0}：{1} 行 > {2}（本批新增越线）" -f $f, $lines, $limit)
  }
}
if ($changedList.Count -gt 0) { Add-Result 'PASS' '行数检查完成（全文本口径）' }

# ⑤ lockfile / package.json 变更黄
$lockHits = @()
foreach ($f in $changedList) {
  if ($f -match '(^|/)package\.json$' -or $f -match '(^|/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$') { $lockHits += $f }
}
if ($lockHits.Count -gt 0) {
  Add-Result 'WARN' ("lockfile/package.json 变更 {0} 件：{1}" -f $lockHits.Count, ($lockHits -join ', '))
} else {
  Add-Result 'PASS' '无 lockfile/package.json 变更'
}

# ⑥ 体量 ≤ 预估 × 1.5（added 行数：锚点..HEAD + 未跟踪文件行数）
$added = 0
$numstat = Run-Git @('-c', 'core.quotepath=false', 'diff', '--numstat', ($Anchor + '..HEAD'))
if ($numstat.Code -eq 0) {
  foreach ($line in $numstat.Out) {
    $t = ("$line").Trim()
    if ($t -eq '') { continue }
    $parts = $t -split "`t"
    if ($parts.Count -ge 1 -and $parts[0] -match '^\d+$') { $added = $added + [int]$parts[0] }
  }
}
$status2 = Run-Git @('-c', 'core.quotepath=false', 'status', '--porcelain', '-uall')
if ($status2.Code -eq 0) {
  foreach ($line in $status2.Out) {
    $t = ("$line").Trim()
    if (-not $t.StartsWith('??')) { continue }
    $path = $t.Substring(3).Trim().Trim('"')
    if (Test-Path -LiteralPath $path -PathType Leaf) {
      $added = $added + (Get-Content -LiteralPath $path | Measure-Object -Line).Lines
    }
  }
}
if ($Estimate -le 0) {
  Add-Result 'WARN' ("未传 -Estimate（本批新增 {0} 行，体量上限未校验）" -f $added)
} else {
  $cap = [math]::Floor($Estimate * 1.5)
  if ($added -gt $cap) {
    Add-Result 'FAIL' ("体量 {0} 行 > 预估 {1} × 1.5 = {2}" -f $added, $Estimate, $cap)
  } else {
    Add-Result 'PASS' ("体量 {0} 行 ≤ 预估 {1} × 1.5 = {2}" -f $added, $Estimate, $cap)
  }
}

# 提交信息格式（锚点..HEAD 的 subject）
$subjects = Run-Git @('log', '--format=%s', ($Anchor + '..HEAD'))
if ($subjects.Code -eq 0) {
  $badSubjects = @()
  foreach ($s in $subjects.Out) {
    $t = ("$s").Trim()
    if ($t -eq '') { continue }
    if ($t -notmatch '^(feat|fix|docs|test|chore)\(v4\):') { $badSubjects += $t }
  }
  if ($badSubjects.Count -gt 0) {
    Add-Result 'FAIL' ("提交信息不合规 {0} 条：{1}" -f $badSubjects.Count, (($badSubjects | Select-Object -First 3) -join ' | '))
  } else {
    Add-Result 'PASS' '提交信息格式合规'
  }
}

Write-Host ''
Write-Host '------------------------------------------------------------'
foreach ($line in $report) { Write-Host $line }
Write-Host '------------------------------------------------------------'
if ($red -gt 0) {
  Write-Host ("gate.ps1：红色 {0} 项；黄色 {1} 项（退出码 1）" -f $red, $yellow)
  exit 1
}
if ($yellow -gt 0) {
  Write-Host ("gate.ps1：红色 0 项；黄色 {0} 项（退出码 2，黄色不是绿）" -f $yellow)
  exit 2
}
Write-Host 'gate.ps1：红色 0 项；黄色 0 项（退出码 0）'
exit 0
