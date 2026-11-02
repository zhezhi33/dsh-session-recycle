param(
  [Parameter(Mandatory = $true)][string]$Spec
)

# 打开资源管理器到一个目录，并把该目录里指定的条目多选高亮。
# $Spec 是 UTF-8 JSON：{ "dir": "D:\\path", "names": ["a.png", "b.html"] }
# 用文件传参而不是命令行参数，避免中文文件名在命令行编码转换时被吃掉。

$ErrorActionPreference = 'SilentlyContinue'

try {
  $cfg = Get-Content -LiteralPath $Spec -Raw -Encoding UTF8 | ConvertFrom-Json
} catch { exit 1 }
if (-not $cfg -or -not $cfg.dir) { exit 1 }

try { Remove-Item -LiteralPath $Spec -Force } catch { }

try { $target = (Resolve-Path -LiteralPath $cfg.dir).Path } catch { exit 1 }
if (-not (Test-Path -LiteralPath $target)) { exit 1 }

$shell = New-Object -ComObject Shell.Application
if (-not $shell) { exit 1 }
$shell.Explore($target)

# 等窗口建好（最多 ~4.5 秒）
$win = $null
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 150
  foreach ($w in $shell.Windows()) {
    try {
      $p = $w.Document.Folder.Self.Path
      if ($p -and ($p.TrimEnd('\') -ieq $target.TrimEnd('\'))) { $win = $w; break }
    } catch { }
  }
  if ($win) { break }
}
if (-not $win) { exit 1 }

$folder = $shell.Namespace($target)
if (-not $folder) { exit 1 }

$set = @{}
foreach ($n in @($cfg.names)) {
  if ($n) { $set[[string]$n.ToLower()] = $true }
}
if ($set.Count -eq 0) { exit 0 }

# 命中 0 个就不动选择，免得把用户当前的选择清掉
$hit = 0
foreach ($item in $folder.Items()) {
  if ($set.ContainsKey($item.Name.ToLower())) { $hit++; if ($hit -gt 500) { break } }
}
if ($hit -eq 0) { exit 0 }

# SelectItem(item, 1) = SVSI_SELECT，连续调用是累加
$done = 0
foreach ($item in $folder.Items()) {
  if ($set.ContainsKey($item.Name.ToLower())) {
    $win.Document.SelectItem($item, 1)
    $done++
    if ($done -ge 500) { break }
  }
}

exit 0
