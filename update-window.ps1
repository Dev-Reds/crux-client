param([string]$Mode = 'window')
$ErrorActionPreference = 'SilentlyContinue'
$ProgressFile = Join-Path $env:TEMP 'crux-update-progress.json'

function Set-Prog([string]$phase, [int]$percent) {
  try {
    [System.IO.File]::WriteAllText($ProgressFile, ('{"phase":"' + $phase + '","percent":' + $percent + '}'), (New-Object System.Text.UTF8Encoding($false)))
  } catch {}
}

if ($Mode -eq 'set') {
  $ph = 'install'; $pc = 0
  if ($args.Count -gt 0) { $ph = [string]$args[0] }
  if ($args.Count -gt 1) { $pc = [int]$args[1] }
  Set-Prog $ph $pc
  exit 0
}

# Wird erst gestartet, wenn die Update-Datei vollstaendig auf der Platte liegt
# (main.js: startUpdateProgressWindow). Der Download laeuft davor im Launcher
# und wird dort angezeigt. Phasen: install -> launch -> done
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
    <TextBlock x:Name="Status" Text="Update wird installiert..." FontSize="13" Foreground="#CCCCCC" HorizontalAlignment="Center" Margin="0,0,0,14"/>
    <ProgressBar x:Name="Bar" Height="12" Maximum="100" Value="0" Foreground="#0088FF" Background="#222228"/>
    <TextBlock Text="Aktualisieren + Starten (keine Deinstallation)" FontSize="10" Foreground="#666666" HorizontalAlignment="Center" Margin="0,12,0,0"/>
  </StackPanel>
</Window>
'@
$sr = New-Object System.IO.StringReader($xaml)
$xr = New-Object System.Xml.XmlTextReader($sr)
$win = [System.Windows.Markup.XamlReader]::Load($xr)
$pctEl = $win.FindName('Pct')
$statusEl = $win.FindName('Status')
$barEl = $win.FindName('Bar')

# Der Tick-Handler laeuft in einem eigenen Scope - darum liegt der ganze Zustand
# in einem Hashtable. Mit normalen Variablen ($phase = ...) blieb die Aenderung
# im Child-Scope haengen: Text wechselte nie und das Fenster schloss nie.
$S = @{
  phase = 'install'
  cur = 15.0
  startPct = 15.0
  targetPct = 90.0
  animStart = [DateTime]::UtcNow
  animDur = 45
  closing = $false
}

function Read-Prog {
  try {
    $j = [System.IO.File]::ReadAllText($ProgressFile) | ConvertFrom-Json
    return ,$j
  } catch { return $null }
}

function Update-Text {
  $p = [Math]::Floor($S.cur)
  if ($p -lt 0) { $p = 0 }
  if ($p -gt 100) { $p = 100 }
  $pctEl.Text = "$p%"
  $barEl.Value = $p
  if ($S.phase -eq 'install') { $statusEl.Text = 'Update wird installiert...' }
  elseif ($S.phase -eq 'launch') { $statusEl.Text = 'Starte Crux Client...' }
  elseif ($S.phase -eq 'done') { $statusEl.Text = 'Fertig! Crux Client wird geoeffnet.' }
  elseif ($S.phase -eq 'cancel') { $statusEl.Text = 'Update fehlgeschlagen. Bitte erneut versuchen.' }
}

$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(150)
$timer.Add_Tick({
  if (-not $S.closing) {
    $d = Read-Prog
    if ($d -ne $null) {
      $np = [string]$d.phase
      if ($np -ne $S.phase) {
        if ($np -eq 'close') {
          $S.closing = $true
          $timer.Stop()
          try { $win.Close() } catch {}
          return
        }
        if ($np -eq 'install' -or $np -eq 'launch' -or $np -eq 'done' -or $np -eq 'cancel') {
          $S.phase = $np
          $S.startPct = $S.cur
          $S.animStart = [DateTime]::UtcNow
          if ($np -eq 'install') { $S.targetPct = 90.0; $S.animDur = 45 }
          elseif ($np -eq 'launch') { $S.targetPct = 99.0; $S.animDur = 12 }
          elseif ($np -eq 'done') { $S.targetPct = 100.0; $S.animDur = 1 }
          elseif ($np -eq 'cancel') { $S.targetPct = $S.cur; $S.animDur = 0.001 }
        }
      }
      if ($S.phase -eq 'install' -or $S.phase -eq 'launch') {
        $el = ([DateTime]::UtcNow - $S.animStart).TotalSeconds
        $t = 1
        if ($S.animDur -gt 0) { $t = $el / $S.animDur }
        if ($t -gt 1) { $t = 1 }
        $S.cur = $S.startPct + ($S.targetPct - $S.startPct) * $t
      }
    }
    Update-Text
    if (($S.phase -eq 'done' -and ([DateTime]::UtcNow - $S.animStart).TotalSeconds -ge 1.8) -or ($S.phase -eq 'cancel' -and ([DateTime]::UtcNow - $S.animStart).TotalSeconds -ge 5)) {
      $S.closing = $true
      $timer.Stop()
      try { $win.Close() } catch {}
    }
  }
})
$timer.Start()
try { $win.ShowDialog() | Out-Null } catch {}
try { $timer.Stop() } catch {}
