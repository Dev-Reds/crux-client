param([string]$Mode = 'window')
$ErrorActionPreference = 'SilentlyContinue'
$ProgressFile = Join-Path $env:TEMP 'crux-update-progress.json'

function Set-Prog([string]$phase, [int]$percent) {
  try {
    [System.IO.File]::WriteAllText($ProgressFile, ('{"phase":"' + $phase + '","percent":' + $percent + '}'), (New-Object System.Text.UTF8Encoding($false)))
  } catch {}
}

if ($Mode -eq 'set') {
  $ph = 'download'; $pc = 0
  if ($args.Count -gt 0) { $ph = [string]$args[0] }
  if ($args.Count -gt 1) { $pc = [int]$args[1] }
  Set-Prog $ph $pc
  exit 0
}

Add-Type -AssemblyName PresentationFramework
$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Crux Client Update" Width="460" Height="270"
        WindowStartupLocation="CenterScreen" Topmost="True"
        ResizeMode="NoResize" WindowStyle="ToolWindow" Background="#101018">
  <StackPanel Margin="26,20">
    <TextBlock x:Name="Head" Text="Crux Client Update" FontSize="18" FontWeight="Bold" Foreground="#FFFFFF" HorizontalAlignment="Center"/>
    <TextBlock x:Name="Pct" Text="0%" FontSize="58" FontWeight="Bold" Foreground="#0088FF" HorizontalAlignment="Center" Margin="0,6,0,0"/>
    <TextBlock x:Name="Status" Text="Lade Update herunter..." FontSize="13" Foreground="#CCCCCC" HorizontalAlignment="Center" Margin="0,0,0,14"/>
    <ProgressBar x:Name="Bar" Height="12" Maximum="100" Value="0" Foreground="#0088FF" Background="#222228"/>
    <TextBlock Text="Download + Deinstallieren + Installieren + Starten" FontSize="10" Foreground="#666666" HorizontalAlignment="Center" Margin="0,12,0,0"/>
  </StackPanel>
</Window>
'@
$sr = New-Object System.IO.StringReader($xaml)
$xr = New-Object System.Xml.XmlTextReader($sr)
$win = [System.Windows.Markup.XamlReader]::Load($xr)
$pctEl = $win.FindName('Pct')
$statusEl = $win.FindName('Status')
$barEl = $win.FindName('Bar')

$phase = 'download'
$cur = 0.0
$startPct = 0.0
$targetPct = 25.0
$animStart = [DateTime]::UtcNow
$animDur = 0.5
$closing = $false

function Read-Prog {
  try {
    $j = [System.IO.File]::ReadAllText($ProgressFile) | ConvertFrom-Json
    return ,$j
  } catch { return $null }
}

function Update-Text {
  $p = [Math]::Floor($cur)
  if ($p -lt 0) { $p = 0 }
  if ($p -gt 100) { $p = 100 }
  $pctEl.Text = "$p%"
  $barEl.Value = $p
  if ($phase -eq 'download') { $statusEl.Text = 'Lade Update herunter...' }
  elseif ($phase -eq 'uninstall') {
    if ($cur -lt 50) { $statusEl.Text = 'Deinstalliere alte Version...' }
    else { $statusEl.Text = 'Installiere neue Version...' }
  }
  elseif ($phase -eq 'launch') { $statusEl.Text = 'Starte Crux Client...' }
  elseif ($phase -eq 'done') { $statusEl.Text = 'Fertig! Crux Client wird geoeffnet.' }
  elseif ($phase -eq 'cancel') { $statusEl.Text = 'Update fehlgeschlagen. Bitte erneut versuchen.' }
}

$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(150)
$timer.Add_Tick({
  if (-not $closing) {
    $d = Read-Prog
    if ($d -ne $null) {
      $np = [string]$d.phase
      if ($np -ne $phase) {
        $phase = $np
        $startPct = $cur
        $animStart = [DateTime]::UtcNow
        if ($np -eq 'download') { $targetPct = 25.0; $animDur = 0.5 }
        elseif ($np -eq 'uninstall') { $targetPct = 75.0; $animDur = 28 }
        elseif ($np -eq 'launch') { $targetPct = 99.0; $animDur = 12 }
        elseif ($np -eq 'done') { $targetPct = 100.0; $animDur = 1 }
        elseif ($np -eq 'cancel') { $targetPct = $cur; $animDur = 0.001 }
      }
      if ($phase -eq 'download') {
        $v = [double]$d.percent
        if ($v -lt 0) { $v = 0 }
        if ($v -gt 25) { $v = 25 }
        $cur = $v
        $animStart = [DateTime]::UtcNow
      } else {
        $el = ([DateTime]::UtcNow - $animStart).TotalSeconds
        $t = 1
        if ($animDur -gt 0) { $t = $el / $animDur }
        if ($t -gt 1) { $t = 1 }
        $cur = $startPct + ($targetPct - $startPct) * $t
      }
    }
    Update-Text
    if (($phase -eq 'done' -and ([DateTime]::UtcNow - $animStart).TotalSeconds -ge 1.8) -or ($phase -eq 'cancel' -and ([DateTime]::UtcNow - $animStart).TotalSeconds -ge 4)) {
      $closing = $true
      $timer.Stop()
      try { $win.Close() } catch {}
    }
  }
})
$timer.Start()
try { $win.ShowDialog() | Out-Null } catch {}
try { $timer.Stop() } catch {}
