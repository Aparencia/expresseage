# check.ps1 · v4 收工仪式（ENGINEERING §8.1 / §7.6 DoD）
# 用法：powershell -File check.ps1 [-Batch 0|1]
#   默认 -Batch 1（严格）；设计阶段（批 0）显式传 -Batch 0 豁免"批 1 才建立"的六件文档。
# 纪律：任一步非 0 => exit 1，"完成"不成立；全过 => exit 0 并粘贴真实输出。
#   输出必须同时含：check.js 汇总行、check-docs 汇总行、零金额 0 命中行、selftest 全局汇总行。
#   只验退出码不够（M-46/R-C-04）：每步还必须命中该步汇总行正则，缺失或不符同样判失败
#   （"没有汇总输出 = 读数作废"；也禁止用 SKIP/空集把退出码骗成 0）。
# 编码：本文件必须 UTF-8 BOM（门禁 #7）；被编译的 js/wxml/wxss/json 必须无 BOM（门禁 #8）。

param(
  [int]$Batch = 1
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSCommandPath
Set-Location $root

$steps = @(
  @{ Name = 'check.js 代码/配置门禁（32 条）'; Args = @('tools/check.js');
     Summaries = @('通过 \d+ 项；失败 0 项') },
  @{ Name = "check-docs.js 设计文档门禁（--batch $Batch）"; Args = @('tools/check-docs.js', '--batch', "$Batch");
     Summaries = @('check-docs（--batch \d+）：通过 \d+ 项；失败 0 项') },
  @{ Name = 'zero-money-scan.js 零金额扫描（源码+页面+文档）'; Args = @('tools/zero-money-scan.js');
     Summaries = @('零金额扫描：0 命中（白名单 \d+ 项）') },
  @{ Name = 'selftest.js 全部断言 suite（EXPECTED_ASSERTIONS 闸）'; Args = @('tools/selftest.js');
     Summaries = @('selftest：运行 \d+ 套；失败 0 套；SKIP 0 套', '结果：PASS') }
)

$fail = 0
$i = 0
$summaries = @()
foreach ($step in $steps) {
  $i = $i + 1
  Write-Host ''
  Write-Host ("==> [{0}/{1}] {2}" -f $i, $steps.Count, $step.Name)
  $cmdArgs = $step.Args
  $stepOut = @()
  & node @cmdArgs 2>&1 | Tee-Object -Variable stepOut | Out-Host
  $code = $LASTEXITCODE
  $miss = @()
  $joined = (@($stepOut) -join "`n")
  foreach ($pat in $step.Summaries) {
    if ($joined -notmatch $pat) { $miss += $pat }
  }
  if ($code -ne 0) {
    $fail = $fail + 1
    $summaries += ("FAIL  {0}（exit {1}）" -f $step.Name, $code)
  } elseif ($miss.Count -gt 0) {
    $fail = $fail + 1
    $summaries += ("FAIL  {0}（缺或未命中汇总行：{1}）" -f $step.Name, ($miss -join ' / '))
  } else {
    $summaries += ("PASS  {0}" -f $step.Name)
  }
}

Write-Host ''
Write-Host '------------------------------------------------------------'
foreach ($line in $summaries) { Write-Host $line }
Write-Host '------------------------------------------------------------'
if ($fail -eq 0) {
  Write-Host ("check.ps1：全部通过（{0} 步，退出码 0）" -f $steps.Count)
  exit 0
}
Write-Host ("check.ps1：失败 {0} 步（退出码 1），见上方各步真实输出" -f $fail)
exit 1
