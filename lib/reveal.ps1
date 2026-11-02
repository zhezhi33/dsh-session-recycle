param(
  [Parameter(Mandatory = $true)][string]$Spec
)

# 打开资源管理器到一个目录，并把该目录里指定的条目多选高亮。
# $Spec 是 UTF-8 JSON：{ "dir": "D:\\path", "names": ["a.png", "b.html"] }
#
# 关键点：
#   - 窗口必须真的到前台，否则会被别的程序挡住，看起来像"点了没反应"
#   - 抢不到前台就直接 explorer /n 新开一个
#   - 选之前先清空旧选择，避免 SelectItem 把已选项又切回去
#   - 等 Items 就绪再选，选完校验，不符重试

$ErrorActionPreference = 'SilentlyContinue'

$winApiCode = @'
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
'@

try {
  Add-Type -Namespace DshReveal -Name Win -MemberDefinition $winApiCode -ErrorAction Stop
} catch { }

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

function Show-ExplorerWindow($win) {
  try {
    $h = [IntPtr][int64]$win.HWND
    if ($h -eq [IntPtr]::Zero) { return $false }
    [void][DshReveal.Win]::ShowWindow($h, 9)   # SW_RESTORE
    [void][DshReveal.Win]::BringWindowToTop($h)
    return [DshReveal.Win]::SetForegroundWindow($h)
  } catch { return $false }
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

function Open-NewWindow([string]$dir) {
  Start-Process explorer.exe -ArgumentList "/n,`"$dir`""
  return (Wait-ExplorerWindow $dir 10000)
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

# ── 1. 拿到一个可见的前台窗口 ──
$win = Get-ExplorerWindow $target
if ($win) {
  if (-not (Show-ExplorerWindow $win)) {
    # 抢不到前台（前台锁 / 最小化 / 别的程序占着），新开一个，保证看得见
    $win = Open-NewWindow $target
  }
} else {
  $win = Open-NewWindow $target
}
if (-not $win) { exit 1 }

# 新开的窗口可能不是第一个匹配到的，再确认一次最新的那个在前台
if (-not (Show-ExplorerWindow $win)) { [void](Open-NewWindow $target) }

# ── 2. 等列表项加载完 ──
if (-not (Wait-ItemsReady $win 8000)) { exit 1 }

$folder = (New-Object -ComObject Shell.Application).Namespace($target)
if (-not $folder) { exit 1 }

# ── 3. 选中：先清空，再逐个选，最后校验，不够重来 ──
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

  if ($hit -gt 0 -and $selected -ge $hit) { break }
}

exit 0
