param(
  [Parameter(Mandatory = $true)][string]$Spec
)

# 打开资源管理器到一个目录，并把该目录里指定的条目多选高亮。
# $Spec 是 UTF-8 JSON：{ "dir": "D:\\path", "names": ["a.png", "b.html"] }
#
# 连续点击的稳定性：
#   - 有窗口就复用，没有就用 explorer /n 强制新开（Explore 对同一路径会被节流）
#   - 选之前先清空当前选择，避免 SelectItem 把已选项又切回去
#   - 等 Items 真正就绪再选，选完校验数量，不符重试

$ErrorActionPreference = 'SilentlyContinue'

function Get-ExplorerWindow([string]$dir) {
  $shell = New-Object -ComObject Shell.Application
  $found = $null
  foreach ($w in @($shell.Windows())) {
    try {
      $p = $w.Document.Folder.Self.Path
      if ($p -and ($p.TrimEnd('\') -ieq $dir.TrimEnd('\'))) { $found = $w }
    } catch { }
  }
  return $found
}

function Wait-ExplorerWindow([string]$dir, [int]$timeoutMs) {
  $deadline = (Get-Date).AddMilliseconds($timeoutMs)
  while ((Get-Date) -lt $deadline) {
    $w = Get-ExplorerWindow $dir
    if ($w) { return $w }
    Start-Sleep -Milliseconds 200
  }
  return $null
}

function Get-ItemCount($win) {
  try { return $win.Document.Folder.Items().Count } catch { return 0 }
}

function Wait-ItemsReady($win, [int]$timeoutMs) {
  $deadline = (Get-Date).AddMilliseconds($timeoutMs)
  while ((Get-Date) -lt $deadline) {
    if ((Get-ItemCount $win) -gt 0) { return $true }
    Start-Sleep -Milliseconds 200
  }
  return ((Get-ItemCount $win) -gt 0)
}

function Clear-Selection($win) {
  try {
    foreach ($s in @($win.Document.SelectedItems())) {
      try { $win.Document.SelectItem($s, 0) } catch { }
    }
  } catch { }
}

try {
  $cfg = Get-Content -LiteralPath $Spec -Raw -Encoding UTF8 | ConvertFrom-Json
} catch { exit 1 }
if (-not $cfg -or -not $cfg.dir) { exit 1 }
try { Remove-Item -LiteralPath $Spec -Force } catch { }

try { $target = (Resolve-Path -LiteralPath $cfg.dir).Path } catch { exit 1 }
if (-not (Test-Path -LiteralPath $target)) { exit 1 }

$want = @{}
foreach ($n in @($cfg.names)) {
  if ($n) { $want[[string]$n.ToLower()] = $true }
}
if ($want.Count -eq 0) { exit 0 }

# ── 1. 有窗口就复用，没有就新开 ──
$win = Get-ExplorerWindow $target
if (-not $win) {
  Start-Process explorer.exe -ArgumentList "/n,`"$target`""
  $win = Wait-ExplorerWindow $target 10000
}
if (-not $win) { exit 1 }

# ── 2. 等列表项加载完 ──
if (-not (Wait-ItemsReady $win 8000)) { exit 1 }

$folder = (New-Object -ComObject Shell.Application).Namespace($target)
if (-not $folder) { exit 1 }

# ── 3. 选中（先清空，再逐个选，最后校验，不够就重来）──
$wantCount = 0
foreach ($item in $folder.Items()) {
  if ($want.ContainsKey($item.Name.ToLower())) { $wantCount++ }
}

for ($attempt = 1; $attempt -le 3; $attempt++) {
  Clear-Selection $win
  Start-Sleep -Milliseconds 150

  $hit = 0
  foreach ($item in $folder.Items()) {
    if ($want.ContainsKey($item.Name.ToLower())) {
      try { $win.Document.SelectItem($item, 1) } catch { }
      $hit++
      Start-Sleep -Milliseconds 15
      if ($hit -ge 500) { break }
    }
  }

  Start-Sleep -Milliseconds 300
  $selected = 0
  try { $selected = @($win.Document.SelectedItems()).Count } catch { $selected = 0 }

  if ($selected -ge $hit -and $hit -gt 0) { break }
}

exit 0
