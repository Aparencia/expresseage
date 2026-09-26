# gate.ps1 · 锚点门禁（锚点/范围/行数/lockfile）· expresseage_college_v2 ｜ ⚠️ 本文件必须存为 UTF-8 带 BOM（PS 5.1 按 GBK 读会撕中文）
# 用法：powershell -File gate.ps1 -Anchor <起点哈希> -ScopeFiles "utils/,pages/" -Estimate 600 ｜ 退出码：0=绿；1=红（停下修）；2=黄（随批级知会转述给用户）
# ⚠️ `-ScopeFiles` 要传**一个**逗号分隔的字符串：PS 5.1 的 `-File` 把数组拆成多个位置参数 ⇒ 直接报"绑不上"（脚本内还会再拆一次，逗号最稳）
param([Parameter(Mandatory = $true)][string]$Anchor, [string[]]$ScopeFiles = @(), [int]$Estimate = 0, [int]$MaxLines = 500, [int]$TestMaxLines = 1000)
$ErrorActionPreference = 'Stop'; $fail = 0; $warn = 0
if ($PSScriptRoot) { Set-Location -LiteralPath $PSScriptRoot }
# ⚠️ `powershell -File` 传数组在 PS 5.1 下只得到一个串（"a,b"）⇒ 这里再拆一次，逗号/分号/空格都认
$scopes = @()
foreach ($s in $ScopeFiles) { foreach ($one in ($s -split '[,;\s]+')) { if ($one) { $scopes += $one.Trim() } } }
function Red($m) { Write-Host "[FAIL] $m" -ForegroundColor Red; $script:fail++ }
function Yel($m) { Write-Host "[WARN] $m" -ForegroundColor Yellow; $script:warn++ }
function Grn($m) { Write-Host "[OK] $m" -ForegroundColor Green }

# ① 锚点可解析（用 --quiet 的退出码说话，禁止 2>$null 那种假 exit 码写法）
git rev-parse --verify --quiet "$Anchor^{commit}" | Out-Null
if ($LASTEXITCODE -ne 0) { Red "锚点不可解析：$Anchor（24 卡没法审 diff、回滚没基准）"; exit 1 }
Grn "锚点可解析：$Anchor"

# ② 变更文件 = 锚点..HEAD + 工作区未提交/未跟踪（-uall 展开新目录，否则只报一个 dir/）
$changed = New-Object System.Collections.Generic.List[string]
git -c core.quotepath=false diff --name-only "$Anchor..HEAD" | Where-Object { $_ } | ForEach-Object { $changed.Add($_) }
git -c core.quotepath=false status --porcelain -uall | ForEach-Object {   # ⚠️ core.quotepath=false：否则非 ASCII 路径被转义成 "\345\271\266…" ⇒ 范围匹配假红
    $p = $_.Substring(3).Trim(); if ($p -match '->') { $p = ($p -split '->')[-1].Trim() }
    $changed.Add(($p -replace '"', ''))
}
$changed = @($changed | Sort-Object -Unique)
Write-Host ("变更文件 " + $changed.Count + " 个：" + ($changed -join '，'))
# ⚠️ 零变更不许打印权威 GREEN：锚点或 -ScopeFiles 填错时会得到同样的"全过"读数（v1 TD-048 ⇒ v2 TD-017）
if ($changed.Count -eq 0) { Yel "变更文件 0 个 ⇒ 本批的判据没测任何东西（锚点或 -ScopeFiles 可能填错）；**这不是通过**" }

# ③ 范围：每个变更文件都必须在 -ScopeFiles 内（前缀/通配）—— 这是五查① 的机器闸
if ($scopes.Count -eq 0) { Yel "未提供 -ScopeFiles ⇒ 五查① 本轮无机器闸" }
else {
    $before = $fail
    foreach ($f in $changed) {
        $in = $false; foreach ($s in $scopes) { if ($f -like $s -or $f -like "$s*") { $in = $true } }
        if (-not $in) { Red "越界：$f 不在本批 ScopeFiles 内（越界就还原；真想修登记 docs/TECH_DEBT.md）" }
    }
    if ($fail -eq $before) { Grn "范围检查：$($changed.Count) 个变更文件全部在 ScopeFiles 内" }
}

# ④ 行数：AGENTS §11.1 单文件 ≤500（测试文件豁免 ≤1000）。⚠️ 只判**本批造成的越线**为红：锚点前就已超线的属已登记欠账，见 docs/TECH_DEBT.md（TD-001）
$before = $fail; $over = 0
foreach ($f in $changed) {
    if ($f -notlike '*.js' -or -not (Test-Path -LiteralPath $f -PathType Leaf)) { continue }
    $limit = if ($f -match 'selftest') { $TestMaxLines } else { $MaxLines }
    $n = (Get-Content -LiteralPath $f -Encoding UTF8 | Measure-Object -Line).Lines
    if ($n -le $limit) { continue }
    $old = 0; $raw = git show "${Anchor}:$f" 2>$null   # ${Anchor} 必须带花括号：$Anchor:utils 会被当成变量名
    if ($LASTEXITCODE -eq 0 -and $raw) { $old = @($raw | Where-Object { $_.Trim() -ne '' }).Count }
    $over++
    if ($old -gt $limit) { Yel "行数超线（锚点前已超，本批只是碰了它）：$f = $n 行（锚点 $old 行）⇒ 拆分另立卡，查 docs/TECH_DEBT.md" }
    else { Red "行数超线（本批越线）：$f = $n 行 > $limit（AGENTS §11.1）" }
}
if ($over -eq 0 -and $fail -eq $before) { Grn "行数：本批变更的 .js 全在线内（源码 $MaxLines / 测试 $TestMaxLines）" }

# ⑤ 依赖：lockfile / package.json 有变更 ⇒ 黄（未请求的依赖变更必须单独说明）
$lock = @($changed | Where-Object { $_ -match '(^|/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$' })
if ($lock.Count -gt 0) { Yel ("依赖有变更：" + ($lock -join '，') + " —— 必须单独说明，禁止未请求的依赖升级") } else { Grn "依赖无变化（lockfile / package.json 未动）" }

# ⑥ 体量：累计改动行数 vs SCOPE 预估 ×1.5（超线 = 范围蔓延信号，触发条件暂停）
$lines = 0; foreach ($row in (git diff --numstat $Anchor)) {   # ⚠️ 锚点 vs **工作树**（含未提交）：用 `锚点..HEAD` 会漏掉"改了还没提交"，体量会假绿
    $p = $row -split "`t"
    if ($p.Count -ge 2 -and $p[0] -match '^\d+$' -and $p[1] -match '^\d+$') { $lines += [int]$p[0] + [int]$p[1] }
}
foreach ($f in (git -c core.quotepath=false ls-files --others --exclude-standard)) { if (Test-Path -LiteralPath $f -PathType Leaf -ErrorAction SilentlyContinue) { $lines += (Get-Content -LiteralPath $f -Encoding UTF8 | Measure-Object -Line).Lines } }   # ⚠️ 这条也必须 quotepath=false：转义路径会让 Test-Path 抛 Illegal characters ⇒ $ErrorActionPreference=Stop 会**在汇总行之前终止**（看起来像红，实则什么都没判）
$cap = [int]($Estimate * 1.5)
if ($Estimate -le 0) { Yel "未提供 -Estimate ⇒ 体量暂停线本轮无判据；累计 $lines 行" }
elseif ($lines -gt $cap) { Yel "体量超暂停线：$lines 行 > 预估 $Estimate ×1.5 = $cap 行 —— 条件触发暂停，等用户" }
else { Grn "体量 $lines 行 ≤ 暂停线 $cap 行（预估 $Estimate）" }

if ($fail -gt 0) { Write-Host "门禁红：$fail 项硬失败。停下修，禁止宣布完成。" -ForegroundColor Red; exit 1 }
if ($warn -gt 0) { Write-Host "门禁黄：$warn 项提示（随批级知会转述给用户）。" -ForegroundColor Yellow; exit 2 }
if ($changed.Count -gt 0) { Write-Host "门禁绿：锚点 / 范围 / 行数 / 依赖 四项全过。" -ForegroundColor Green }
exit 0
