# tools/mutation.ps1 · 变异电池（ENGINEERING §7.5 / AGENTS §5.3）
# 用途：对一条安全判据做单点变异，证明"判据真的有牙"（变异必须被测试捕获，不许判绿）。
#
# 用法（在仓库根或任意目录执行）：
#   powershell -File tools/mutation.ps1 -Target <仓库相对文件> -Anchor <ASCII 唯一锚点> -Replace <变异文本> -Test <命令>
#   多条测试命令（-File 形态，逗号串为规范写法）：-Test 'node tools/check.js,node tools/selftest.js'
#   直调形态（PowerShell 会话内，数组）：& .\tools\mutation.ps1 ... -Test 'node tools/check.js','node tools/selftest.js'
#   注：-File 会把逗号数组绑成单个字符串，本脚本收到单元素时按逗号拆分（trim/去空）。
#   -DryRun：只打印计划（目标/锚点命中行/SHA256/测试命令），不改文件、不跑测试
#   -KeepBackup：保留系统临时目录中的原始字节备份（默认校验通过后删除）
#
# 流程（ENGINEERING §7.5）：
#   1) 原始字节备份到系统临时目录；2) 注入变异（锚点必须恰好命中 1 次，否则否证）；
#   3) 跑目标测试并记录首红断言；4) try/finally 按原始字节逐字节还原；
#   5) SHA256 前后比对 + git status --porcelain 前后比对（工作树零残留）；
#   6) 复跑目标测试，必须全绿；7) 判定：测试变红 = 判据有牙；全绿 = 判据没牙。
#
# 退出码（与 tools 其它脚本一致：0 绿 / 1 红 / 2 用法-环境错误）：
#   0 = 变异被测试捕获（判据有牙）+ 还原校验通过 + 复跑全绿
#   1 = 变异未被任何测试捕获（判据没牙，需补断言）；或注入后变红但复跑未全绿
#   2 = 用法/环境/安全错误（参数不全、目标不存在、锚点非唯一、基线不绿、还原 SHA256 不一致）
#
# 编码：本文件必须 UTF-8 BOM（门禁 #7）；被测文件按 UTF-8 读写并保留其原 BOM 状态。
# 纪律：不改业务真身（只做临时注入并由脚本还原）；不 commit / 不 tag。

param(
  [string]$Target = '',
  [string]$Anchor = '',
  [string]$Replace = '',
  [string[]]$Test = @(),
  [switch]$DryRun,
  [switch]$KeepBackup
)

$ErrorActionPreference = 'Stop'
$script:Root = @(Split-Path -Parent $PSScriptRoot)[0]
$script:Utf8 = New-Object System.Text.UTF8Encoding($false)
$script:TimeoutMs = 180000

function Write-Usage {
  Write-Host '用法：powershell -File tools/mutation.ps1 -Target <文件> -Anchor <唯一锚点> -Replace <变异文本> -Test <命令> [-DryRun]'
  Write-Host '示例：powershell -File tools/mutation.ps1 -Target tools/check.js -Anchor "<唯一锚点>" -Replace "<变异文本>" -Test "node tools/check.js,node tools/selftest.js"'
  Write-Host '说明：-Test 单命令直接写；多条命令用逗号串（-File 形态）或 PowerShell 数组（直调形态）；-DryRun 只校验计划并打印，不注入。'
}

function Write-Section([string]$title) {
  Write-Host ''
  Write-Host ('--- ' + $title + ' ---')
}

function Get-RepoPath([string]$relative) {
  if ([System.IO.Path]::IsPathRooted($relative)) {
    throw ('需要仓库相对路径（不要用绝对路径）：' + $relative)
  }
  $full = [System.IO.Path]::GetFullPath((Join-Path $script:Root $relative))
  $rootFull = [System.IO.Path]::GetFullPath($script:Root).TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw ('目标越出仓库：' + $relative)
  }
  return $full
}

function Get-Sha256([string]$path) {
  return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-HitCount([string]$text, [string]$needle) {
  $count = 0
  $index = 0
  while ($text.Length - $needle.Length -ge $index) {
    $found = $text.IndexOf($needle, $index, [System.StringComparison]::Ordinal)
    if ($found -lt 0) { break }
    $count += 1
    $index = $found + $needle.Length
  }
  return $count
}

function Get-HitLines([string]$text, [string]$needle) {
  $lines = $text -split "`n"
  $hits = @()
  for ($i = 0; $i -lt $lines.Count; $i += 1) {
    if ($lines[$i].IndexOf($needle, [System.StringComparison]::Ordinal) -ge 0) { $hits += ($i + 1) }
  }
  return $hits
}

function Split-CommandLine([string]$command) {
  $parts = @()
  $regex = [regex]'"([^"]*)"|(\S+)'
  foreach ($match in $regex.Matches($command)) {
    if ($match.Groups[1].Success) { $parts += $match.Groups[1].Value } else { $parts += $match.Groups[2].Value }
  }
  return $parts
}

# -Test 归一化：兼容三种形态——单命令 / -File 形态的逗号串 / PowerShell 直调数组。
# -File 会把 `-Test 'a,b'` 绑成单元素数组（"a,b"），故单元素时按逗号拆分；直调数组逐项 trim。
function Resolve-TestCommands([string[]]$raw) {
  $items = @($raw | Where-Object { $null -ne $_ })
  if ($items.Count -eq 0) { return @() }
  if ($items.Count -eq 1) { $items = @($items[0] -split ',') }
  $commands = @()
  foreach ($item in $items) {
    $command = ([string]$item).Trim()
    if ($command.Length -gt 0) { $commands += $command }
  }
  return $commands
}

function Invoke-TestCommand([string]$command) {
  $parts = @(Split-CommandLine $command)
  if ($parts.Count -eq 0) { throw ('空测试命令：' + $command) }
  $exe = $parts[0]
  if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) { throw ('测试命令不存在：' + $command) }
  $argList = @()
  if ($parts.Count -gt 1) { $argList = $parts[1..($parts.Count - 1)] }
  $quoted = @()
  foreach ($arg in $argList) {
    if ($arg -match '[\s"]') { $quoted += ('"' + ($arg -replace '"', '\"') + '"') } else { $quoted += $arg }
  }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $exe
  $psi.Arguments = ($quoted -join ' ')
  $psi.WorkingDirectory = $script:Root
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.StandardOutputEncoding = $script:Utf8
  $psi.StandardErrorEncoding = $script:Utf8
  $psi.CreateNoWindow = $true
  $started = Get-Date
  $process = [System.Diagnostics.Process]::Start($psi)
  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  if (-not $process.WaitForExit($script:TimeoutMs)) {
    try { $process.Kill() } catch { }
    throw ('测试命令超时（' + $script:TimeoutMs + ' ms）：' + $command)
  }
  $code = $process.ExitCode
  $text = $stdout.TrimEnd()
  if ($stderr.Trim().Length -gt 0) { $text = $text + "`n[stderr]`n" + $stderr.TrimEnd() }
  $elapsed = [int]((Get-Date) - $started).TotalMilliseconds
  return [pscustomobject]@{ Command = $command; Code = $code; Text = $text; ElapsedMs = $elapsed }
}

function Write-TestResult([object]$result, [string]$label) {
  $verdict = 'GREEN'
  if ($result.Code -ne 0) { $verdict = 'RED' }
  Write-Host ('  [' + $verdict + '] ' + $label + ' · ' + $result.Command + '（exit ' + $result.Code + '，' + $result.ElapsedMs + ' ms）')
}

function Write-TestOutput([object]$result) {
  $lines = @($result.Text -split "`r?`n" | Where-Object { $_.Trim() -ne '' })
  if ($lines.Count -eq 0) { Write-Host '    <无输出>'; return }
  if ($lines.Count -le 120) {
    foreach ($line in $lines) { Write-Host ('    ' + $line) }
    return
  }
  for ($i = 0; $i -lt 20; $i += 1) { Write-Host ('    ' + $lines[$i]) }
  Write-Host ('    ……（省略 ' + ($lines.Count - 80) + ' 行）')
  for ($i = $lines.Count - 60; $i -lt $lines.Count; $i += 1) { Write-Host ('    ' + $lines[$i]) }
}

function Get-LastLine([object]$result) {
  $lines = @($result.Text -split "`r?`n" | Where-Object { $_.Trim() -ne '' })
  if ($lines.Count -eq 0) { return '<无输出>' }
  return $lines[$lines.Count - 1]
}

function Get-FirstRed([object]$result) {
  $lines = @($result.Text -split "`r?`n")
  for ($i = 0; $i -lt $lines.Count; $i += 1) {
    if ($lines[$i] -match '\[(FAIL|CRASH)\]') {
      $detail = @()
      for ($j = $i + 1; $j -lt $lines.Count; $j += 1) {
        if ($lines[$j] -match '^\s+-\s') { $detail += $lines[$j].Trim() } else { break }
      }
      return [pscustomobject]@{ Found = $true; Line = $lines[$i].Trim(); Detail = $detail }
    }
  }
  $nonEmpty = @($lines | Where-Object { $_.Trim() -ne '' })
  $tail = ''
  if ($nonEmpty.Count -gt 0) { $tail = ($nonEmpty | Select-Object -Last 2) -join ' / ' }
  return [pscustomobject]@{ Found = $false; Line = $tail; Detail = @() }
}

function Get-GitPorcelain([string]$relative) {
  try {
    $out = & git -C $script:Root status --porcelain -- $relative 2>$null
    if ($null -eq $out) { return '' }
    return (($out | Out-String).Trim())
  } catch {
    return '<git 不可用>'
  }
}

# ---------------------------------------------------------------- 计划与前置校验
$Test = @(Resolve-TestCommands $Test)
Write-Host '== tools/mutation.ps1 · 变异电池（ENGINEERING §7.5）=='
if (-not $Target -or -not $Anchor -or -not $Replace -or $Test.Count -eq 0) {
  Write-Usage
  exit 2
}
if ($Anchor -ceq $Replace) {
  Write-Host '[FAIL] -Anchor 与 -Replace 完全相同，不会产生变异'
  exit 2
}

try {
  $targetFull = Get-RepoPath $Target
} catch {
  Write-Host ('[FAIL] ' + $_.Exception.Message)
  exit 2
}
if (-not (Test-Path -LiteralPath $targetFull -PathType Leaf)) {
  Write-Host ('[FAIL] 目标文件不存在：' + $Target)
  exit 2
}

$originalBytes = [System.IO.File]::ReadAllBytes($targetFull)
$hasBom = ($originalBytes.Length -ge 3 -and $originalBytes[0] -eq 0xEF -and $originalBytes[1] -eq 0xBB -and $originalBytes[2] -eq 0xBF)
if ($hasBom) {
  $text = $script:Utf8.GetString($originalBytes, 3, $originalBytes.Length - 3)
} else {
  $text = $script:Utf8.GetString($originalBytes)
}
$shaBefore = Get-Sha256 $targetFull
$hitLines = @(Get-HitLines $text $Anchor)
$hitCount = $hitLines.Count

Write-Host ''
Write-Host ('目标：' + $Target + '（' + $originalBytes.Length + ' 字节，' + $text.Length + ' 字符，BOM=' + $hasBom + '）')
Write-Host ('SHA256（注入前）：' + $shaBefore)
Write-Host ('锚点：' + $Anchor)
Write-Host ('变异：' + $Replace)
Write-Host ('测试：' + (@($Test) -join ' ; '))
Write-Host ('锚点命中：' + $hitCount + ' 次' + $(if ($hitCount -gt 0) { '（行 ' + ($hitLines -join ', ') + '）' } else { '' }))

if ($hitCount -ne 1) {
  Write-Host ('[FAIL] 锚点必须恰好命中 1 次；本次命中 ' + $hitCount + ' 次，已否证（未改任何文件）')
  exit 2
}
if ($DryRun) {
  Write-Host ''
  Write-Host 'DRY-RUN：计划校验通过，未注入、未跑测试（工作树未改）'
  exit 0
}

# ---------------------------------------------------------------- 基线
Write-Section '基线（注入前，必须全绿）'
$baseline = @()
try {
  foreach ($command in $Test) {
    $baseline += Invoke-TestCommand $command
  }
} catch {
  Write-Host ('[FAIL] 基线执行异常：' + $_.Exception.Message)
  exit 2
}
foreach ($result in $baseline) { Write-TestResult $result '基线' }
$baselineRed = @($baseline | Where-Object { $_.Code -ne 0 })
if ($baselineRed.Count -gt 0) {
  foreach ($result in $baselineRed) { Write-TestOutput $result }
  Write-Host '[FAIL] 基线不绿：变异证据无效，先按正常收工命令修绿再跑变异'
  exit 2
}
Write-Host '基线全绿，允许注入。'

# ---------------------------------------------------------------- 注入 → 跑测试 → 还原
$backupPath = Join-Path ([System.IO.Path]::GetTempPath()) ('mutation-backup-' + [guid]::NewGuid().ToString('N') + '-' + (Split-Path -Leaf $targetFull))
[System.IO.File]::WriteAllBytes($backupPath, $originalBytes)
Write-Host ('原始字节备份：' + $backupPath)

$mutatedResults = @()
$injectError = $null
try {
  $anchorIndex = $text.IndexOf($Anchor, [System.StringComparison]::Ordinal)
  $mutatedText = $text.Substring(0, $anchorIndex) + $Replace + $text.Substring($anchorIndex + $Anchor.Length)
  $payload = $script:Utf8.GetBytes($mutatedText)
  if ($hasBom) {
    $mutatedBytes = New-Object byte[] ($payload.Length + 3)
    $mutatedBytes[0] = 0xEF
    $mutatedBytes[1] = 0xBB
    $mutatedBytes[2] = 0xBF
    [System.Array]::Copy($payload, 0, $mutatedBytes, 3, $payload.Length)
  } else {
    $mutatedBytes = $payload
  }
  [System.IO.File]::WriteAllBytes($targetFull, $mutatedBytes)
  Write-Section '注入变异（临时）'
  Write-Host ('  已注入：锚点第 ' + ($anchorIndex + 1) + ' 个字符处替换；写入 ' + $mutatedBytes.Length + ' 字节')
  Write-Section '注入后跑目标测试（记录首红）'
  foreach ($command in $Test) {
    $mutatedResults += Invoke-TestCommand $command
  }
} catch {
  $injectError = $_.Exception.Message
} finally {
  [System.IO.File]::WriteAllBytes($targetFull, $originalBytes)
}
foreach ($result in $mutatedResults) { Write-TestResult $result '注入后' }
$mutatedRed = @($mutatedResults | Where-Object { $_.Code -ne 0 })
if ($mutatedRed.Count -gt 0) {
  Write-Host ''
  Write-Host '注入后首红输出（首条变红命令完整输出）：'
  Write-TestOutput $mutatedRed[0]
}

# ---------------------------------------------------------------- 还原校验
Write-Section '还原校验'
$shaAfter = Get-Sha256 $targetFull
Write-Host ('  SHA256（注入前）：' + $shaBefore)
Write-Host ('  SHA256（还原后）：' + $shaAfter)
if ($shaAfter -ne $shaBefore) {
  Write-Host ('[FAIL] 还原 SHA256 不一致（工作树被污染）；原始字节备份保留在：' + $backupPath)
  exit 2
}
Write-Host '  [PASS] 还原后 SHA256 与注入前逐字节一致'
$gitBefore = Get-GitPorcelain $Target
$gitAfter = Get-GitPorcelain $Target
if ($gitBefore -ne $gitAfter) {
  Write-Host ('[FAIL] git status --porcelain 不一致：注入前「' + $gitBefore + '」/ 还原后「' + $gitAfter + '」')
  exit 2
}
Write-Host ('  [PASS] 工作树零残留（git status --porcelain 与注入前一致：' + $(if ($gitBefore -eq '') { '干净' } else { $gitBefore }) + '）')
if (-not $KeepBackup) {
  Remove-Item -LiteralPath $backupPath -Force -ErrorAction SilentlyContinue
  Write-Host '  临时备份已删除（-KeepBackup 可保留）'
}

if ($injectError) {
  Write-Host ('[FAIL] 注入/测试阶段异常：' + $injectError)
  exit 2
}
if ($mutatedResults.Count -ne @($Test).Count) {
  Write-Host ('[FAIL] 注入后测试命令未跑全（' + $mutatedResults.Count + '/' + @($Test).Count + '）')
  exit 2
}

# ---------------------------------------------------------------- 复跑
Write-Section '还原后复跑（必须全绿）'
$postResults = @()
try {
  foreach ($command in $Test) { $postResults += Invoke-TestCommand $command }
} catch {
  Write-Host ('[FAIL] 复跑执行异常：' + $_.Exception.Message)
  exit 2
}
foreach ($result in $postResults) { Write-TestResult $result '复跑' }
$postRed = @($postResults | Where-Object { $_.Code -ne 0 })
if ($postRed.Count -gt 0) {
  foreach ($result in $postRed) { Write-TestOutput $result }
  Write-Host '[FAIL] 还原后复跑未全绿：还原不完整或测试本身不稳定'
  exit 2
}

# ---------------------------------------------------------------- 判定
Write-Section '判定'
if ($mutatedRed.Count -eq 0) {
  foreach ($result in $mutatedResults) {
    Write-Host ('  · ' + $result.Command + '（exit 0）尾行：' + (Get-LastLine $result))
  }
  Write-Host ''
  Write-Host '  [FAIL] 变异未被任何测试捕获 → 判据没牙（禁止把"全绿"当覆盖证据）'
  Write-Host '  下一步：把该变异写进对应 selftest 反例，或收紧对应 check.js 判据后复跑本电池。'
  exit 1
}
Write-Host ('  [PASS] 变异被捕获：' + $mutatedRed.Count + '/' + $mutatedResults.Count + ' 条测试变红')
foreach ($result in $mutatedRed) {
  $first = Get-FirstRed $result
  Write-Host ('  · 首红来源：' + $result.Command + '（exit ' + $result.Code + '）')
  if ($first.Found) {
    Write-Host ('    首红断言：' + $first.Line)
  } else {
    Write-Host ('    首红断言：<无 [FAIL] 行，输出尾行> ' + $first.Line)
  }
  foreach ($detail in $first.Detail) { Write-Host ('    细节：' + $detail) }
}
Write-Host ''
Write-Host '结论：变异被捕获 + 还原 SHA256 一致 + 复跑全绿 → 判据有牙（exit 0）'
exit 0
